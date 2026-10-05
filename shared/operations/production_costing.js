/**
 * Prarambha Account & Stock Management — Production Lot Costing Engine
 * ====================================================================
 * The cost/traceability layer over the existing stock_movements quantity
 * ledger. stock_movements stay the quantity source of truth (every screen
 * keeps working); lots carry the actual unit costs and the FIFO consumption
 * trail that turns sales into real COGS.
 *
 * Flow:  milk collection → milk lot → production batch (FIFO consumes lots)
 *        → stock lot (NRV-allocated cost) → sale (FIFO consumes lots)
 *        → actual COGS → gross profit.
 *
 * All money passes through round2; all dates are BS strings via the shared
 * converter. Cow and buffalo milk stay separate lots end to end.
 */

const { logAudit } = require('./audit');
const { adToBS, toBSDate } = require('../excel-import');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const todayAD = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayBS = () => adToBS(todayAD()) || todayAD();

// ──────────────────────────────────────────────────────────────
// Cutover
// ──────────────────────────────────────────────────────────────

/** BS date from which lots are tracked. Set on the first lot-tracked batch. */
function getLotCutover(db) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'lot_cutover_date'").get();
    return row && row.value ? row.value : null;
}

function setLotCutover(db, bsDate) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lot_cutover_date', ?)").run(String(bsDate));
}

/** Lot costing applies only to documents on/after the cutover date. */
function lotTracked(db, bsDate) {
    const cut = getLotCutover(db);
    return !!cut && String(bsDate) >= cut;
}

// ──────────────────────────────────────────────────────────────
// Milk lots
// ──────────────────────────────────────────────────────────────

/**
 * Create the raw-milk lot for a milk collection (idempotent per collection).
 * Unit cost is the collection's actual farmer rate; when the rate column is 0
 * it falls back to amount/quantity. `mixed` collections make a mixed lot —
 * cow and buffalo lots are never merged.
 */
function createMilkLot(db, collection) {
    const qty = round2(collection.quantity_liters);
    if (!(qty > 0)) return null;
    // Never build lot history for dates before the explicit cutover (§23): old
    // data keeps no lots and is never back-costed. When no cutover exists yet
    // (a fresh book) lots are created normally so FIFO works from day one.
    const cut = getLotCutover(db);
    if (cut && String(collection.date) < cut) return null;
    const existing = db.prepare('SELECT id FROM milk_lots WHERE collection_id = ?').get(collection.id);
    if (existing) return existing.id;

    const unitCost = round2((Number(collection.rate) || 0) > 0
        ? collection.rate
        : (qty > 0 ? (Number(collection.amount) || 0) / qty : 0));
    const totalCost = round2(qty * unitCost);
    const res = db.prepare(`
        INSERT INTO milk_lots (collection_id, milk_type, party_id, date, shift,
            quantity, fat_percent, snf_percent, unit_cost, total_cost, qty_remaining)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(collection.id, collection.milk_type || 'cow', collection.party_id || null,
          collection.date, collection.shift || 'morning',
          qty, round2(collection.fat_percent || 0), round2(collection.snf_percent || 0),
          unitCost, totalCost, qty);
    return Number(res.lastInsertRowid);
}

function deleteMilkLotByCollection(db, collectionId) {
    const used = db.prepare(
        "SELECT COUNT(*) n FROM lot_consumptions WHERE lot_type = 'milk' AND lot_id IN (SELECT id FROM milk_lots WHERE collection_id = ?)"
    ).get(collectionId).n;
    if (used > 0) throw new Error('Milk lot already consumed by production — reverse that batch first.');
    db.prepare('DELETE FROM milk_lots WHERE collection_id = ?').run(collectionId);
}

/** Ensure every eligible collection (on/after cutover) has its lot. */
function backfillMilkLots(db, { from_date } = {}) {
    const cut = getLotCutover(db);
    if (!cut) return 0;
    const rows = db.prepare(`
        SELECT mc.* FROM milk_collections mc
        WHERE mc.quantity_liters > 0 AND mc.date >= ?
          AND NOT EXISTS (SELECT 1 FROM milk_lots ml WHERE ml.collection_id = mc.id)
        ORDER BY mc.date, mc.id
    `).all(from_date || cut);
    let n = 0;
    for (const c of rows) { createMilkLot(db, c); n++; }
    return n;
}

// ──────────────────────────────────────────────────────────────
// FIFO consumption
// ──────────────────────────────────────────────────────────────

/**
 * Consume quantity FIFO from open lots. `lots` must be ordered oldest-first.
 * Writes one lot_consumptions row per lot touched and reduces qty_remaining.
 * Throws when available stock is short — negative stock is never allowed.
 * @returns {Array<{lot_id, quantity, unit_cost, total_cost}>} consumed rows
 */
function consumeFIFO(db, { lotType, lots, quantity, referenceType, referenceId, date }) {
    let remaining = round2(quantity);
    if (!(remaining > 0)) return [];
    const available = round2(lots.reduce((s, l) => s + (Number(l.qty_remaining) || 0), 0));
    if (remaining > available + 1e-9) {
        throw new Error(`Insufficient lot stock: need ${remaining}, only ${available} available (${referenceType}).`);
    }
    const out = [];
    const ins = db.prepare(`
        INSERT INTO lot_consumptions (lot_type, lot_id, reference_type, reference_id, date, quantity, unit_cost, total_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updMilk = db.prepare('UPDATE milk_lots SET qty_remaining = qty_remaining - ? WHERE id = ?');
    const updStock = db.prepare('UPDATE stock_lots SET qty_remaining = qty_remaining - ? WHERE id = ?');
    const update = lotType === 'milk' ? updMilk : updStock;

    for (const lot of lots) {
        if (remaining <= 1e-9) break;
        const take = Math.min(remaining, round2(lot.qty_remaining));
        if (!(take > 0)) continue;
        const unitCost = round2(lot.unit_cost);
        ins.run(lotType, lot.id, referenceType, referenceId || null, date, round2(take), unitCost, round2(take * unitCost));
        update.run(round2(take), lot.id);
        out.push({ lot_id: lot.id, quantity: round2(take), unit_cost: unitCost, total_cost: round2(take * unitCost) });
        remaining = round2(remaining - take);
    }
    if (remaining > 1e-9) {
        throw new Error(`Lot consumption shortfall of ${remaining} — refusing to consume phantom stock.`);
    }
    return out;
}

/** Sum of a consumption list. */
function consumptionTotal(consumptions) {
    return round2(consumptions.reduce((s, c) => s + c.total_cost, 0));
}

/** Remove every consumption made for a reference and restore the lots. */
function reverseConsumptions(db, { lotType, referenceType, referenceId }) {
    const rows = db.prepare(
        'SELECT * FROM lot_consumptions WHERE lot_type = ? AND reference_type = ? AND reference_id = ?'
    ).all(lotType, referenceType, referenceId);
    const updMilk = db.prepare('UPDATE milk_lots SET qty_remaining = qty_remaining + ? WHERE id = ?');
    const updStock = db.prepare('UPDATE stock_lots SET qty_remaining = qty_remaining + ? WHERE id = ?');
    for (const r of rows) {
        (lotType === 'milk' ? updMilk : updStock).run(round2(r.quantity), r.lot_id);
    }
    db.prepare(
        'DELETE FROM lot_consumptions WHERE lot_type = ? AND reference_type = ? AND reference_id = ?'
    ).run(lotType, referenceType, referenceId);
    return rows;
}

// ──────────────────────────────────────────────────────────────
// Production batches
// ──────────────────────────────────────────────────────────────

/**
 * FIFO suggestion for a production input: which milk lots to consume.
 * Pure read — the UI shows this; posting re-validates.
 */
function suggestMilkConsumption(db, { milk_type, quantity, date }) {
    const lots = db.prepare(`
        SELECT * FROM milk_lots
        WHERE milk_type = ? AND qty_remaining > 1e-9 AND date <= ?
        ORDER BY date, id
    `).all(String(milk_type || 'cow'), date);
    let remaining = round2(quantity);
    const plan = [];
    for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, round2(lot.qty_remaining));
        if (take > 0) {
            plan.push({ lot_id: lot.id, collection_id: lot.collection_id, date: lot.date,
                quantity: round2(take), unit_cost: round2(lot.unit_cost),
                total_cost: round2(take * lot.unit_cost) });
            remaining = round2(remaining - take);
        }
    }
    return {
        plan,
        suggested_input_cost: consumptionTotal(plan),
        available: round2(lots.reduce((s, l) => s + l.qty_remaining, 0)),
        shortfall: round2(Math.max(0, remaining))
    };
}

/**
 * FIFO suggestion for a finished/semi-finished input (cream, nauni, curd…).
 * Mirrors suggestMilkConsumption but reads stock_lots, so the multi-stage
 * cost chain can be previewed before it is posted.
 */
function suggestStockConsumption(db, { product_id, quantity, date }) {
    const lots = db.prepare(`
        SELECT * FROM stock_lots
        WHERE product_id = ? AND qty_remaining > 1e-9 AND produced_date <= ?
        ORDER BY produced_date, id
    `).all(Number(product_id), date);
    let remaining = round2(quantity);
    const plan = [];
    for (const lot of lots) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, round2(lot.qty_remaining));
        if (take > 0) {
            plan.push({ lot_id: lot.id, date: lot.produced_date,
                quantity: round2(take), unit_cost: round2(lot.unit_cost),
                total_cost: round2(take * lot.unit_cost) });
            remaining = round2(remaining - take);
        }
    }
    return {
        plan,
        suggested_input_cost: consumptionTotal(plan),
        available: round2(lots.reduce((s, l) => s + l.qty_remaining, 0)),
        shortfall: round2(Math.max(0, remaining))
    };
}

/** Standard selling price of a product for NRV: products.rate, else 0. */
function standardPrice(db, productId) {
    const p = db.prepare('SELECT rate FROM products WHERE id = ?').get(productId);
    return round2(p ? p.rate : 0);
}

/**
 * Allocate total batch cost across outputs.
 * NRV when every output has a standard price, volume otherwise (flagged).
 * Residual rounding goes to the LAST output — deterministic.
 */
function allocateOutputs(db, outputs, totalCost) {
    const nrvs = outputs.map(o => round2(round2(o.quantity) * standardPrice(db, o.product_id)));
    const nrvTotal = round2(nrvs.reduce((s, n) => s + n, 0));
    const approximate = nrvTotal <= 0;
    let method = 'nrv';
    let shares;
    if (approximate) {
        method = 'volume';
        const qtyTotal = round2(outputs.reduce((s, o) => s + (Number(o.quantity) || 0), 0));
        if (!(qtyTotal > 0)) {
            shares = outputs.map(() => 0);
        } else {
            shares = outputs.map(o => round2(o.quantity) / qtyTotal);
        }
    } else {
        shares = nrvs.map(n => n / nrvTotal);
    }
    let assigned = 0;
    const alloc = outputs.map((o, i) => {
        const isLast = i === outputs.length - 1;
        const cost = isLast ? round2(totalCost - assigned) : round2(totalCost * shares[i]);
        if (!isLast) assigned = round2(assigned + cost);
        return {
            ...o,
            nrv: nrvs[i],
            allocated_cost: cost,
            unit_cost: round2(o.quantity) > 0 ? round2(cost / round2(o.quantity)) : 0
        };
    });
    return { allocations: alloc, method, approximate };
}

/**
 * Total processing cost for a batch. Precedence (never a silent double count):
 *   1. the operator's itemised breakdown (labour/fuel/electricity/packaging/
 *      water/CIP/refrigeration/other), else
 *   2. an explicit scalar processing_cost, else
 *   3. the configured production_overheads applied on their basis, else
 *   4. the per-litre setting fallback.
 * Rates default to 0 — a cost is never invented.
 */
function computeProcessingCost(db, { data, inputLiters, inputCost }) {
    const breakdown = {
        labour_cost: round2(data.labour_cost),
        fuel_cost: round2(data.fuel_cost),
        electricity_cost: round2(data.electricity_cost),
        packaging_cost: round2(data.packaging_cost),
        water_cost: round2(data.water_cost),
        cip_cost: round2(data.cip_cost),
        refrigeration_cost: round2(data.refrigeration_cost),
        other_processing_cost: round2(data.other_processing_cost)
    };
    const itemised = round2(Object.values(breakdown).reduce((s, v) => s + v, 0));

    let configured = 0;
    const overheads = [];
    if (itemised <= 0) {
        const rows = db.prepare('SELECT * FROM production_overheads WHERE active = 1 ORDER BY id').all();
        for (const o of rows) {
            let cost = 0;
            if (o.basis === 'per_input_liter') cost = round2((Number(o.rate) || 0) * inputLiters);
            else if (o.basis === 'per_batch') cost = round2(o.rate);
            else if (o.basis === 'percent_of_input_cost') cost = round2((Number(o.rate) || 0) / 100 * inputCost);
            if (cost > 0) { overheads.push({ name: o.name, basis: o.basis, cost }); configured = round2(configured + cost); }
        }
    }

    const scalar = round2(data.processing_cost);
    let total = 0;
    if (itemised > 0) total = itemised;
    else if (scalar > 0) total = scalar;
    else if (configured > 0) total = configured;
    else if (data.processing_cost === undefined || data.processing_cost === null) {
        const perLiter = round2(db.prepare(
            "SELECT value FROM settings WHERE key = 'production_processing_cost_per_liter'"
        ).get()?.value || 0);
        if (perLiter > 0) total = round2(perLiter * inputLiters);
    }

    return { total, itemised, configured, breakdown, overheads };
}

/** Expected yield % for a process (batch value first, then the standards table). */
function expectedYieldFor(db, processType, productId, explicitPct) {
    const explicit = round2(explicitPct);
    if (explicit > 0) return explicit;
    const row = db.prepare(`
        SELECT expected_yield_percent e FROM yield_standards
        WHERE process_type = ? AND (output_product_id IS NULL OR output_product_id = ?)
        ORDER BY (output_product_id IS NULL) ASC, id LIMIT 1
    `).get(String(processType || ''), productId || null);
    return row ? round2(row.e) : 0;
}

/** Compare actual vs expected yield and classify (§14). Never blocks posting. */
function evaluateYield(db, processType, actualPct, expectedPct) {
    if (!(expectedPct > 0)) return { flag: 'ok', variance: 0, expected_low: 0, expected_high: 0 };
    const std = db.prepare(
        'SELECT warn_low_percent, warn_high_percent FROM yield_standards WHERE process_type = ? ORDER BY id LIMIT 1'
    ).get(String(processType || ''));
    const low = std && round2(std.warn_low_percent) > 0 ? round2(std.warn_low_percent) : round2(expectedPct * 0.9);
    const high = std && round2(std.warn_high_percent) > 0 ? round2(std.warn_high_percent) : round2(expectedPct * 1.1);
    const variance = round2(actualPct - expectedPct);
    let flag = 'ok';
    if (actualPct < low) flag = 'low';
    else if (actualPct > high) flag = 'high';
    return { flag, variance, expected_low: low, expected_high: high };
}

/**
 * Post a production batch through the lot engine.
 * Consumes milk lots FIFO for each input, costs the batch, allocates to
 * outputs, creates stock lots, and writes the production stock movements —
 * all in one transaction. Returns the batch id and full cost breakdown.
 *
 * data: { date, shift, process_type, inputs: [{milk_type|product_id, quantity}],
 *         outputs: [{product_id, quantity}], processing_cost, yield_note, remarks,
 *         created_by }
 */
function postProductionBatch(db, data) {
    const date = String(data.date || todayBS());
    if (!lotTracked(db, date)) {
        // Before cutover, fall back to the legacy engine (rates stay as given).
        const legacy = require('./production');
        return legacy.saveProductionBatch(db, data);
    }

    const trx = db.transaction(() => {
        const shift = data.shift || 'morning';
        const processType = data.process_type || 'DIRECT_MIX';
        const batchNo = data.batch_no || nextBatchNo(db, date);

        // ── 1. Resolve inputs FIFO ──
        // A batch input is EITHER raw milk ({ milk_type, quantity } → milk_lots)
        // OR a semi/finished product ({ product_id, quantity } → stock_lots).
        // The second form is what makes Cream → Nauni → Ghee traceable: each
        // stage consumes the previous stage's real inventory at its actual cost.
        const inputPlans = [];
        let inputCost = 0;
        let fatWeighted = 0, fatQty = 0;
        for (const inp of (data.inputs || [])) {
            const qty = round2(inp.quantity);
            if (!(qty > 0)) continue;
            if (inp.product_id && !inp.milk_type) {
                const productId = Number(inp.product_id);
                const lots = db.prepare(`
                    SELECT * FROM stock_lots WHERE product_id = ? AND qty_remaining > 1e-9 AND produced_date <= ?
                    ORDER BY produced_date, id
                `).all(productId, date);
                const cons = consumeFIFO(db, {
                    lotType: 'stock', lots, quantity: qty,
                    referenceType: 'production_input', referenceId: null, date
                });
                inputPlans.push({ product_id: productId, quantity: qty, consumptions: cons });
                inputCost = round2(inputCost + consumptionTotal(cons));
            } else {
                const milkType = String(inp.milk_type || 'cow').toLowerCase();
                const lots = db.prepare(`
                    SELECT * FROM milk_lots WHERE milk_type = ? AND qty_remaining > 1e-9 AND date <= ?
                    ORDER BY date, id
                `).all(milkType, date);
                const cons = consumeFIFO(db, {
                    lotType: 'milk', lots, quantity: qty,
                    referenceType: 'production_input', referenceId: null, date
                });
                inputPlans.push({ milk_type: milkType, quantity: qty, consumptions: cons });
                for (const c of cons) {
                    const lot = db.prepare('SELECT fat_percent FROM milk_lots WHERE id = ?').get(c.lot_id);
                    if (lot) { fatWeighted += (Number(lot.fat_percent) || 0) * c.quantity; fatQty += c.quantity; }
                }
                inputCost = round2(inputCost + consumptionTotal(cons));
            }
        }
        if (!inputPlans.length) throw new Error('A batch needs at least one input.');

        // ── 2. Processing cost (never a silent zero) ──
        const inputLiters = round2(inputPlans.reduce((s, p) => s + p.quantity, 0));
        const proc = computeProcessingCost(db, { data, inputLiters, inputCost });
        const processingCost = proc.total;
        if (!(processingCost > 0) && !data.allow_zero_processing_cost) {
            throw new Error('Processing cost is 0 — itemise the processing costs, configure Production Overheads, or set production_processing_cost_per_liter in Settings (pass allow_zero_processing_cost to override).');
        }
        const totalCost = round2(inputCost + processingCost);

        // ── 3. Validate outputs ──
        const outputs = (data.outputs || []).map(o => ({
            product_id: Number(o.product_id),
            quantity: round2(o.quantity)
        })).filter(o => o.product_id && o.quantity > 0);
        if (!outputs.length) throw new Error('A batch needs at least one output.');
        for (const o of outputs) {
            if (!db.prepare('SELECT id FROM products WHERE id = ?').get(o.product_id)) {
                throw new Error(`Unknown output product #${o.product_id}`);
            }
        }

        // ── 4. NRV allocation ──
        const { allocations, method, approximate } = allocateOutputs(db, outputs, totalCost);

        // ── 5. Batch row (with yield control + cost breakdown) ──
        const outQty = round2(outputs.reduce((s, o) => s + o.quantity, 0));
        const yieldPct = inputLiters > 0 ? round2(outQty / inputLiters * 100) : 0;
        const expectedYield = expectedYieldFor(db, processType, outputs[0] && outputs[0].product_id, data.expected_yield_percent);
        const expectedOutQty = round2(data.expected_output_quantity) || (expectedYield > 0 ? round2(inputLiters * expectedYield / 100) : 0);
        const yieldEval = evaluateYield(db, processType, yieldPct, expectedYield);
        const inputFat = fatQty > 0 ? round2(fatWeighted / fatQty) : round2(data.input_fat_percent);
        const outputFat = round2(data.output_fat_percent);
        const bd = proc.breakdown;
        const ins = db.prepare(`
            INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity,
                input_unit, output_quantity, output_unit, standard_yield_percent, actual_yield_percent,
                wastage_quantity, wastage_reason, operator_name, remarks, input_cost, processing_cost,
                total_cost, cost_allocation, cost_approximate, status, yield_note,
                labour_cost, fuel_cost, electricity_cost, packaging_cost, water_cost, cip_cost,
                refrigeration_cost, other_processing_cost, overhead_cost,
                expected_output_quantity, yield_variance_percent, yield_flag,
                input_fat_percent, output_fat_percent, created_by)
            VALUES (?, ?, ?, ?, ?, 'liter', ?, 'kg', ?, ?, 0, '', ?, ?, ?, ?, ?, ?, ?, 'posted', ?,
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const res = ins.run(batchNo, date, shift, processType, inputLiters, outQty, expectedYield, yieldPct,
            data.operator_name || '', data.remarks || '', inputCost, processingCost, totalCost,
            method, approximate ? 1 : 0, data.yield_note || '',
            bd.labour_cost, bd.fuel_cost, bd.electricity_cost, bd.packaging_cost, bd.water_cost,
            bd.cip_cost, bd.refrigeration_cost, bd.other_processing_cost, proc.configured,
            expectedOutQty, yieldEval.variance, yieldEval.flag, inputFat, outputFat, data.created_by || null);
        const batchId = Number(res.lastInsertRowid);

        // ── 6. Input rows + lot consumption links + stock movements ──
        const { getOrCreateRawMilkProduct } = require('./milk');
        for (const plan of inputPlans) {
            const isProduct = !!plan.product_id;
            const product = isProduct
                ? db.prepare('SELECT id, name FROM products WHERE id = ?').get(plan.product_id)
                : getOrCreateRawMilkProduct(db, plan.milk_type);
            const lotType = isProduct ? 'stock' : 'milk';
            const consumedCost = round2(consumptionTotal(plan.consumptions));
            db.prepare(`
                INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(batchId, product.id, product.name, plan.quantity,
                  isProduct ? (product.unit || 'kg') : 'liter',
                  plan.quantity > 0 ? round2(consumedCost / plan.quantity) : 0, consumedCost);
            // Re-point the placeholder consumptions at this input row.
            const inputRowId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
            for (const c of plan.consumptions) {
                db.prepare(
                    "UPDATE lot_consumptions SET reference_id = ? WHERE lot_type = ? AND lot_id = ? AND reference_id IS NULL AND date = ?"
                ).run(inputRowId, lotType, c.lot_id, date);
            }
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(product.id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) - plan.quantity);
            if (newBalance < -1e-9) throw new Error(`Negative stock for ${product.name}`);
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'production_input', 0, ?, ?, ?, ?, 'production', ?)
            `).run(product.id, date, plan.quantity, newBalance,
                  plan.quantity > 0 ? round2(consumedCost / plan.quantity) : 0,
                  `Production ${batchNo}`, batchId);
        }

        // ── 7. Outputs: stock lots + movements ──
        for (const a of allocations) {
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(a.product_id);
            const expires = shelfLifeExpiry(db, a.product_id, date);
            const lotRes = db.prepare(`
                INSERT INTO stock_lots (batch_id, product_id, produced_date, expires_date,
                    quantity, qty_remaining, unit_cost)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(batchId, a.product_id, date, expires, a.quantity, a.quantity, a.unit_cost);
            db.prepare(`
                INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(batchId, a.product_id, product.name, a.quantity, product.unit || 'kg', a.unit_cost, a.allocated_cost);
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(a.product_id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) + a.quantity);
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'production_output', ?, 0, ?, ?, ?, 'production', ?)
            `).run(a.product_id, date, a.quantity, newBalance, a.unit_cost, `Production ${batchNo}`, batchId);
            void lotRes;
        }

        logAudit(db, 'production_batches', batchId, 'create', null, {
            operation: 'Batch posted (lot costing)', batch_no: batchNo, date, shift, process_type: processType,
            input_cost: inputCost, processing_cost: processingCost, total_cost: totalCost,
            processing_breakdown: bd, overheads: proc.overheads,
            yield_percent: yieldPct, expected_yield_percent: expectedYield, yield_flag: yieldEval.flag,
            input_fat_percent: inputFat, output_fat_percent: outputFat,
            allocation: method, approximate, outputs: allocations.map(a => ({ product_id: a.product_id, qty: a.quantity, unit_cost: a.unit_cost }))
        }, data.created_by || null);

        return {
            id: batchId, batch_no: batchNo, input_cost: inputCost,
            processing_cost: processingCost, total_cost: totalCost,
            processing_breakdown: { ...bd, overheads: proc.overheads, overhead_cost: proc.configured },
            actual_yield_percent: yieldPct, expected_yield_percent: expectedYield,
            yield_variance_percent: yieldEval.variance, yield_flag: yieldEval.flag,
            input_fat_percent: inputFat, output_fat_percent: outputFat,
            allocation_method: method, approximate,
            allocations: allocations.map(a => ({
                product_id: a.product_id, quantity: a.quantity, nrv: a.nrv,
                allocated_cost: a.allocated_cost, unit_cost: a.unit_cost
            }))
        };
    });
    return trx();
}

/** Expiry date from the product master (never hard-coded). Null when 0. */
function shelfLifeExpiry(db, productId, producedDateBS) {
    const p = db.prepare('SELECT expiry_days FROM products WHERE id = ?').get(productId);
    const days = Number(p && p.expiry_days) || 0;
    if (days <= 0) return null;
    const ad = toBSDate(producedDateBS) ? producedDateBS : producedDateBS; // BS in, BS out
    const bsToADLocal = require('../excel-import').bsToAD;
    const producedAD = bsToADLocal(String(producedDateBS).slice(0, 10));
    if (!producedAD) return null;
    const d = new Date(producedAD + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    const p2 = (n) => String(n).padStart(2, '0');
    const adStr = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
    void ad; void adStr;
    // Keep the BS calendar as the storage format: expiry is stored as BS.
    const { adToBS: a2b } = require('../excel-import');
    return a2b(adStr) || null;
}

function nextBatchNo(db, date) {
    const ymd = String(date).replace(/-/g, '');
    const n = db.prepare(
        "SELECT COUNT(*) c FROM production_batches WHERE batch_no LIKE ?"
    ).get(`PRD-${ymd}-%`).c + 1;
    return `PRD-${ymd}-${String(n).padStart(3, '0')}`;
}

/**
 * Reverse a posted batch: restore milk lots, delete its stock lots (with any
 * unconsumed remainder), remove its consumptions and mark it reversed.
 * Sales that consumed its lots must be reversed first — enforced.
 */
function reverseProductionBatch(db, batchId, { reason, userId } = {}) {
    const trx = db.transaction(() => {
        const batch = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batchId);
        if (!batch) throw new Error('Batch not found');
        if (batch.status === 'reversed') throw new Error('Batch is already reversed.');

        const sold = db.prepare(`
            SELECT COUNT(*) n FROM lot_consumptions lc
            JOIN stock_lots sl ON sl.id = lc.lot_id AND lc.lot_type = 'stock'
            WHERE sl.batch_id = ? AND lc.reference_type = 'sale'
        `).get(batchId).n;
        if (sold > 0) {
            throw new Error('Stock from this batch has already been sold — reverse those sales first.');
        }

        // Restore every lot this batch consumed — raw milk AND finished goods
        // (cream/nauni/... inputs each live under their own lot_type).
        const inputs = db.prepare('SELECT * FROM production_inputs WHERE batch_id = ?').all(batchId);
        for (const inp of inputs) {
            reverseConsumptions(db, { lotType: 'milk', referenceType: 'production_input', referenceId: inp.id });
            reverseConsumptions(db, { lotType: 'stock', referenceType: 'production_input', referenceId: inp.id });
        }

        // Remove the batch's stock lots (nothing consumed them — enforced above).
        db.prepare('DELETE FROM stock_lots WHERE batch_id = ?').run(batchId);

        // Reverse the stock movements (same replayed-ledger convention as before).
        for (const inp of inputs) {
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(inp.product_id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) + inp.quantity);
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'adjustment', ?, 0, ?, ?, ?, 'production', ?)
            `).run(inp.product_id, batch.date, inp.quantity, newBalance, inp.rate,
                  `Reversal of batch ${batch.batch_no}`, batchId);
        }
        const outputs = db.prepare('SELECT * FROM production_outputs WHERE batch_id = ?').all(batchId);
        for (const out of outputs) {
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(out.product_id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) - out.quantity);
            if (newBalance < -1e-9) throw new Error(`Reversal would drive ${out.product_name} stock negative`);
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'adjustment', 0, ?, ?, ?, ?, 'production', ?)
            `).run(out.product_id, batch.date, out.quantity, newBalance, out.rate,
                  `Reversal of batch ${batch.batch_no}`, batchId);
        }
        db.prepare('DELETE FROM production_inputs WHERE batch_id = ?').run(batchId);
        db.prepare('DELETE FROM production_outputs WHERE batch_id = ?').run(batchId);
        db.prepare("UPDATE production_batches SET status = 'reversed', updated_at = datetime('now','localtime') WHERE id = ?").run(batchId);
        logAudit(db, 'production_batches', batchId, 'update', batch, {
            operation: 'Batch reversed', reason: reason || ''
        }, userId || null);
        return { reversed: true, id: batchId };
    });
    return trx();
}

// ──────────────────────────────────────────────────────────────
// Sales FIFO costing hooks
// ──────────────────────────────────────────────────────────────

/**
 * Consume finished-goods lots FIFO for one sale item. Returns the COGS.
 * Sales operators never pick lots — oldest valid lot first.
 */
function costSaleItem(db, { saleId, product_id, quantity, date }) {
    if (!lotTracked(db, date)) return { cogs: 0, consumptions: [] };
    const lots = db.prepare(`
        SELECT sl.* FROM stock_lots sl
        WHERE sl.product_id = ? AND sl.qty_remaining > 1e-9 AND sl.produced_date <= ?
        ORDER BY sl.produced_date, sl.id
    `).all(product_id, date);
    if (!lots.length) return { cogs: 0, consumptions: [] }; // pre-cutover stock
    const consumptions = consumeFIFO(db, {
        lotType: 'stock', lots, quantity,
        referenceType: 'sale', referenceId: saleId, date
    });
    return { cogs: consumptionTotal(consumptions), consumptions };
}

/** Remove a sale's lot consumptions (before update/delete). Returns removed cost. */
function reverseSaleCosting(db, saleId) {
    const rows = db.prepare(
        "SELECT * FROM lot_consumptions WHERE lot_type = 'stock' AND reference_type = 'sale' AND reference_id = ?"
    ).all(saleId);
    const upd = db.prepare('UPDATE stock_lots SET qty_remaining = qty_remaining + ? WHERE id = ?');
    for (const r of rows) upd.run(round2(r.quantity), r.lot_id);
    db.prepare(
        "DELETE FROM lot_consumptions WHERE lot_type = 'stock' AND reference_type = 'sale' AND reference_id = ?"
    ).run(saleId);
    return consumptionTotal(rows);
}

// ──────────────────────────────────────────────────────────────
// Expiry & wastage
// ──────────────────────────────────────────────────────────────

/** Lots past expiry with stock still on them. */
function getExpiredLots(db, { asOf } = {}) {
    const today = asOf || todayBS();
    const todayAD_ = require('../excel-import').bsToAD(today) || today;
    const rows = db.prepare('SELECT * FROM stock_lots WHERE qty_remaining > 1e-9 AND expires_date IS NOT NULL').all();
    return rows.map(r => {
        const expAD = require('../excel-import').bsToAD(r.expires_date) || r.expires_date;
        return { ...r, expired: expAD < todayAD_ };
    }).filter(r => r.expired);
}

/**
 * Write off expired finished-goods lots at actual lot cost.
 * One wastage_records row per lot; stock movement `adjustment` outward keeps
 * the quantity ledger in step; qty_remaining → 0. Never deletes the lot.
 */
function writeOffExpiredStock(db, { asOf, reason, userId } = {}) {
    const today = asOf || todayBS();
    const trx = db.transaction(() => {
        const lots = getExpiredLots(db, { asOf: today });
        let writtenOff = 0, totalCost = 0;
        for (const lot of lots) {
            const qty = round2(lot.qty_remaining);
            if (!(qty > 0)) continue;
            const cost = round2(qty * lot.unit_cost);
            const res = db.prepare(`
                INSERT INTO wastage_records (lot_type, lot_id, product_id, date, quantity, unit_cost, total_cost, reason, reference_type, reference_id, created_by)
                VALUES ('stock', ?, ?, ?, ?, ?, ?, ?, 'wastage', ?, ?)
            `).run(lot.id, lot.product_id, today, qty, round2(lot.unit_cost), cost,
                  reason || 'Expired stock write-off', lot.id, userId || null);
            db.prepare('UPDATE stock_lots SET qty_remaining = 0 WHERE id = ?').run(lot.id);
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(lot.product_id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) - qty);
            if (newBalance < -1e-9) throw new Error('Write-off would drive stock negative');
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'adjustment', 0, ?, ?, ?, ?, 'wastage', ?)
            `).run(lot.product_id, today, qty, newBalance, round2(lot.unit_cost),
                  `Expired stock write-off (${reason || 'expiry'})`, Number(res.lastInsertRowid));
            writtenOff++;
            totalCost = round2(totalCost + cost);
        }
        if (writtenOff > 0) {
            logAudit(db, 'wastage_records', null, 'create', null, {
                operation: 'Expired stock written off', lots: writtenOff, total_cost: totalCost, as_of: today
            }, userId || null);
        }
        return { lots: writtenOff, total_cost: totalCost };
    });
    return trx();
}

/** Manual wastage of finished-goods or raw milk (FIFO from open lots). */
function recordWastage(db, { lot_type, product_id, milk_type, quantity, date, reason, userId }) {
    const d = String(date || todayBS());
    const qty = round2(quantity);
    if (!(qty > 0)) throw new Error('Wastage quantity must be positive.');
    const trx = db.transaction(() => {
        let consumptions;
        if (lot_type === 'milk') {
            const lots = db.prepare(
                'SELECT * FROM milk_lots WHERE milk_type = ? AND qty_remaining > 1e-9 AND date <= ? ORDER BY date, id'
            ).all(String(milk_type || 'cow'), d);
            consumptions = consumeFIFO(db, { lotType: 'milk', lots, quantity: qty, referenceType: 'wastage', referenceId: null, date: d });
        } else {
            const lots = db.prepare(
                'SELECT * FROM stock_lots WHERE product_id = ? AND qty_remaining > 1e-9 AND produced_date <= ? ORDER BY produced_date, id'
            ).all(product_id, d);
            if (!lots.length) throw new Error('No lot stock available for this product.');
            consumptions = consumeFIFO(db, { lotType: 'stock', lots, quantity: qty, referenceType: 'wastage', referenceId: null, date: d });
        }
        const total = consumptionTotal(consumptions);
        const res = db.prepare(`
            INSERT INTO wastage_records (lot_type, lot_id, product_id, date, quantity, unit_cost, total_cost, reason, reference_type, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'wastage', ?)
        `).run(lot_type, consumptions[0] ? consumptions[0].lot_id : null,
              lot_type === 'stock' ? product_id : null, d, qty,
              round2(qty > 0 ? total / qty : 0), total, reason || '', userId || null);
        const wastageId = Number(res.lastInsertRowid);
        for (const c of consumptions) {
            db.prepare(
                "UPDATE lot_consumptions SET reference_id = ? WHERE lot_type = ? AND lot_id = ? AND reference_type = 'wastage' AND reference_id IS NULL"
            ).run(wastageId, lot_type, c.lot_id);
        }
        // Quantity ledger keeps in step for finished goods.
        if (lot_type === 'stock') {
            const lastBalance = db.prepare(
                'SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1'
            ).get(product_id);
            const newBalance = round2((lastBalance ? lastBalance.balance_after : 0) - qty);
            if (newBalance < -1e-9) throw new Error('Wastage would drive stock negative');
            db.prepare(`
                INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id)
                VALUES (?, ?, 'adjustment', 0, ?, ?, ?, ?, 'wastage', ?)
            `).run(product_id, d, qty, newBalance, round2(qty > 0 ? total / qty : 0), `Wastage: ${reason || ''}`, wastageId);
        }
        logAudit(db, 'wastage_records', wastageId, 'create', null, {
            operation: 'Wastage recorded', lot_type, quantity: qty, total_cost: total, reason: reason || ''
        }, userId || null);
        return { id: wastageId, quantity: qty, total_cost: total, consumptions };
    });
    return trx();
}

// ──────────────────────────────────────────────────────────────
// Reports
// ──────────────────────────────────────────────────────────────

/** Stock lots for a product (or all), oldest first, with expiry flags. */
function getStockLots(db, { product_id, open_only = true, asOf } = {}) {
    const today = asOf || todayBS();
    const todayAD = require('../excel-import').bsToAD(today) || today;
    let sql = `
        SELECT sl.*, p.name AS product_name, p.unit, pb.batch_no,
               COALESCE((SELECT SUM(lc.quantity) FROM lot_consumptions lc
                         WHERE lc.lot_type='stock' AND lc.lot_id = sl.id), 0) AS consumed_qty
        FROM stock_lots sl
        JOIN products p ON p.id = sl.product_id
        LEFT JOIN production_batches pb ON pb.id = sl.batch_id
        WHERE 1=1`;
    const params = [];
    if (product_id) { sql += ' AND sl.product_id = ?'; params.push(product_id); }
    if (open_only) sql += ' AND sl.qty_remaining > 1e-9';
    sql += ' ORDER BY sl.produced_date, sl.id';
    return db.prepare(sql).all(...params).map(r => {
        const expAD = r.expires_date ? (require('../excel-import').bsToAD(r.expires_date) || r.expires_date) : null;
        const daysLeft = expAD ? Math.round((new Date(expAD + 'T00:00:00Z') - new Date(todayAD + 'T00:00:00Z')) / 86400000) : null;
        return {
            ...r,
            age_days: Math.round((new Date(todayAD + 'T00:00:00Z') - new Date((require('../excel-import').bsToAD(r.produced_date) || r.produced_date) + 'T00:00:00Z')) / 86400000),
            days_to_expiry: daysLeft,
            status: daysLeft === null ? 'no-shelf-life'
                : daysLeft < 0 ? 'expired'
                : daysLeft === 0 ? 'expires-today'
                : daysLeft <= 1 ? 'expires-1-day'
                : daysLeft <= 3 ? 'expires-3-days' : 'ok'
        };
    });
}

/** Raw milk lots (cow/buffalo separate), oldest first. */
function getMilkLots(db, { milk_type, open_only = true } = {}) {
    let sql = `
        SELECT ml.*, p.name AS party_name, mc.collection_no
        FROM milk_lots ml
        LEFT JOIN parties p ON p.id = ml.party_id
        LEFT JOIN milk_collections mc ON mc.id = ml.collection_id
        WHERE 1=1`;
    const params = [];
    if (milk_type) { sql += ' AND ml.milk_type = ?'; params.push(milk_type); }
    if (open_only) sql += ' AND ml.qty_remaining > 1e-9';
    sql += ' ORDER BY ml.date, ml.id';
    return db.prepare(sql).all(...params);
}

/**
 * Daily stock reconciliation for a BS date range — the owner's "why is closing
 * stock this number" report. Finished goods and raw milk, with lot-level
 * detail behind every figure.
 */
function getDailyReconciliation(db, { from_date, to_date } = {}) {
    const from = from_date || getLotCutover(db) || todayBS();
    const to = to_date || todayBS();
    const p2 = (n) => String(n).padStart(2, '0');
    const bsRange = (fromBS, toBS) => {
        // Walk BS days via AD conversion — exact through the shared calendar.
        const fromAD = require('../excel-import').bsToAD(fromBS);
        const toAD = require('../excel-import').bsToAD(toBS);
        const days = [];
        if (!fromAD || !toAD) return days;
        const d = new Date(fromAD + 'T00:00:00Z');
        const end = new Date(toAD + 'T00:00:00Z');
        while (d <= end) {
            const ad = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
            days.push(require('../excel-import').adToBS(ad) || ad);
            d.setUTCDate(d.getUTCDate() + 1);
        }
        return days;
    };
    const days = bsRange(from, to);
    const inClause = days.map(() => '?').join(',');
    if (!days.length) return { from_date: from, to_date: to, finished_goods: [], raw_milk: [], days: 0 };

    // Per-product movement sums inside the window.
    const moveRows = db.prepare(`
        SELECT sm.product_id, p.name AS product_name, p.unit,
               SUM(CASE WHEN sm.type = 'production_output' THEN sm.inward_qty ELSE 0 END) AS production_in,
               SUM(CASE WHEN sm.type = 'sale' THEN sm.outward_qty ELSE 0 END) AS sold,
               SUM(CASE WHEN sm.reference_type = 'wastage' THEN sm.outward_qty ELSE 0 END) AS wasted,
               SUM(sm.inward_qty - sm.outward_qty) AS net_change
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.date BETWEEN ? AND ?
        GROUP BY sm.product_id ORDER BY p.name
    `).all(from, to);
    const opening = (productId) => round2(db.prepare(
        'SELECT COALESCE(SUM(inward_qty - outward_qty), 0) s FROM stock_movements WHERE product_id = ? AND date < ?'
    ).get(productId, from).s);
    const finished_goods = moveRows.map(r => ({
        product_id: r.product_id,
        product_name: r.product_name,
        unit: r.unit,
        opening: opening(r.product_id),
        production: round2(r.production_in),
        sold: round2(r.sold),
        wastage: round2(r.wasted),
        closing: round2(opening(r.product_id) + (Number(r.net_change) || 0)),
        identity_ok: Math.abs((opening(r.product_id) + round2(r.production_in) - round2(r.sold) - round2(r.wasted)) - (opening(r.product_id) + round2(r.net_change))) < 0.01
            || Math.abs(round2(r.production_in) - round2(r.sold) - round2(r.wasted) - round2(r.net_change)) < 0.01
    }));
    const rawMilkRows = db.prepare(`
        SELECT p.id AS product_id, p.name AS product_name, p.unit,
               SUM(sm.inward_qty) AS deliveries, SUM(sm.outward_qty) AS consumed
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.date BETWEEN ? AND ? AND p.category = 'Milk'
        GROUP BY p.id
    `).all(from, to);
    const raw_milk = rawMilkRows.map(r => ({
        product_id: r.product_id,
        product_name: r.product_name,
        unit: r.unit,
        opening: opening(r.product_id),
        deliveries: round2(r.deliveries),
        consumed: round2(r.consumed),
        closing: round2(opening(r.product_id) + (Number(r.deliveries) || 0) - (Number(r.consumed) || 0)),
        lots: db.prepare(
            `SELECT milk_type, ROUND(SUM(qty_remaining),2) remaining FROM milk_lots WHERE date <= ? GROUP BY milk_type`
        ).all(to)
    }));
    // Morning/evening collection split + purchases (the daily factory view):
    // actual shift data from the milk register, never invented.
    const shiftRows = db.prepare(`
        SELECT shift, COALESCE(SUM(quantity_liters),0) q, COALESCE(SUM(amount),0) a
        FROM milk_collections WHERE date BETWEEN ? AND ? GROUP BY shift
    `).all(from, to);
    const milkCollections = {
        morning: round2(shiftRows.filter(r => String(r.shift).toLowerCase() === 'morning').reduce((s, r) => s + r.q, 0)),
        evening: round2(shiftRows.filter(r => String(r.shift).toLowerCase() === 'evening').reduce((s, r) => s + r.q, 0)),
        total_liters: round2(shiftRows.reduce((s, r) => s + r.q, 0)),
        total_amount: round2(shiftRows.reduce((s, r) => s + r.a, 0))
    };
    const purchasesRow = db.prepare(`
        SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) t FROM purchases WHERE date BETWEEN ? AND ?
    `).get(from, to);
    const milkPurchases = { count: purchasesRow.n, total: round2(purchasesRow.t) };
    return { from_date: from, to_date: to, days: days.length, finished_goods, raw_milk,
        milk_collections: milkCollections, purchases: milkPurchases, window_days: inClause ? days.length : 0 };
}

/** Batch margin / profitability for a date range. */
function getBatchMargin(db, { from_date, to_date } = {}) {
    const from = from_date || getLotCutover(db) || todayBS();
    const to = to_date || todayBS();
    const batches = db.prepare(`
        SELECT pb.* FROM production_batches pb
        WHERE pb.date BETWEEN ? AND ? AND pb.status = 'posted' AND pb.total_cost > 0
        ORDER BY pb.date, pb.id
    `).all(from, to);
    return batches.map(b => {
        const outputs = db.prepare('SELECT * FROM production_outputs WHERE batch_id = ?').all(b.id);
        const inputs = db.prepare('SELECT * FROM production_inputs WHERE batch_id = ?').all(b.id);
        const rows = outputs.map(o => {
            const soldQty = round2(db.prepare(`
                SELECT COALESCE(SUM(lc.quantity), 0) q FROM lot_consumptions lc
                WHERE lc.lot_type = 'stock' AND lc.reference_type = 'sale' AND lc.lot_id IN
                    (SELECT id FROM stock_lots WHERE batch_id = ? AND product_id = ?)
            `).get(b.id, o.product_id).q);
            const cogs = round2(db.prepare(`
                SELECT COALESCE(SUM(lc.total_cost), 0) c FROM lot_consumptions lc
                WHERE lc.lot_type = 'stock' AND lc.reference_type = 'sale' AND lc.lot_id IN
                    (SELECT id FROM stock_lots WHERE batch_id = ? AND product_id = ?)
            `).get(b.id, o.product_id).c);
            const remaining = round2(db.prepare(
                'SELECT COALESCE(SUM(qty_remaining),0) q FROM stock_lots WHERE batch_id = ? AND product_id = ?'
            ).get(b.id, o.product_id).q);
            // Revenue: actual sale line value for this batch's lots (invoice rate),
            // derived from the sale items matching the consumption dates is complex —
            // revenue is attributed via the sale-side: unit selling price is not
            // stored per consumption, so revenue is computed from sales_items joined
            // by product & date window. Kept simple and honest:
            const revenue = round2(db.prepare(`
                SELECT COALESCE(SUM(si.amount), 0) a FROM sales_items si
                JOIN sales s ON s.id = si.sale_id
                WHERE si.product_id = ? AND s.date BETWEEN ? AND ?
            `).get(o.product_id, b.date, to).a);
            return {
                product_id: o.product_id,
                product_name: o.product_name,
                output_quantity: round2(o.quantity),
                allocated_unit_cost: round2(o.rate),
                qty_sold: soldQty,
                revenue: revenue,
                actual_cogs: cogs,
                gross_margin: round2(revenue - cogs),
                remaining_stock: remaining
            };
        });
        return {
            batch_id: b.id, batch_no: b.batch_no, date: b.date, shift: b.shift,
            process_type: b.process_type,
            input_quantity: round2(b.input_quantity),
            input_cost: round2(b.input_cost),
            processing_cost: round2(b.processing_cost),
            total_cost: round2(b.total_cost),
            allocation_method: b.cost_allocation,
            approximate: !!b.cost_approximate,
            inputs: inputs.map(i => ({ product_name: i.product_name, quantity: round2(i.quantity), amount: round2(i.amount) })),
            outputs: rows,
            batch_gross_margin: round2(rows.reduce((s, r) => s + r.gross_margin, 0))
        };
    });
}

/** Wastage report for a range. */
function getWastageReport(db, { from_date, to_date } = {}) {
    const from = from_date || getLotCutover(db) || todayBS();
    const to = to_date || todayBS();
    const rows = db.prepare(`
        SELECT w.*, p.name AS product_name FROM wastage_records w
        LEFT JOIN products p ON p.id = w.product_id
        WHERE w.date BETWEEN ? AND ? ORDER BY w.date, w.id
    `).all(from, to);
    return {
        from_date: from, to_date: to,
        rows,
        total_cost: round2(rows.reduce((s, r) => s + (Number(r.total_cost) || 0), 0)),
        total_quantity: round2(rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0))
    };
}

/** FIFO preview for the production screen (per milk type). */
function previewBatchCosting(db, data) {
    const date = String(data.date || todayBS());
    let inputCost = 0;
    const inputs = [];
    for (const inp of (data.inputs || [])) {
        const qty = round2(inp.quantity);
        if (!(qty > 0)) continue;
        if (inp.product_id && !inp.milk_type) {
            const product = db.prepare('SELECT name FROM products WHERE id = ?').get(Number(inp.product_id));
            const sug = suggestStockConsumption(db, { product_id: inp.product_id, quantity: qty, date });
            inputs.push({ product_id: Number(inp.product_id), product_name: product ? product.name : '', quantity: qty, ...sug });
            inputCost = round2(inputCost + sug.suggested_input_cost);
        } else {
            const milkType = String(inp.milk_type || 'cow').toLowerCase();
            const sug = suggestMilkConsumption(db, { milk_type: milkType, quantity: qty, date });
            inputs.push({ milk_type: milkType, quantity: qty, ...sug });
            inputCost = round2(inputCost + sug.suggested_input_cost);
        }
    }
    const inputLiters = round2(inputs.reduce((s, i) => s + i.quantity, 0));
    const proc = computeProcessingCost(db, { data, inputLiters, inputCost });
    const processingCost = proc.total;
    const totalCost = round2(inputCost + processingCost);
    const outputs = (data.outputs || []).map(o => ({ product_id: Number(o.product_id), quantity: round2(o.quantity) }))
        .filter(o => o.product_id && o.quantity > 0);
    const { allocations, method, approximate } = outputs.length ? allocateOutputs(db, outputs, totalCost) : { allocations: [], method: 'single', approximate: false };
    const outQty = round2(outputs.reduce((s, o) => s + o.quantity, 0));
    const actualYield = inputLiters > 0 ? round2(outQty / inputLiters * 100) : 0;
    const expectedYield = expectedYieldFor(db, data.process_type || 'DIRECT_MIX', outputs[0] && outputs[0].product_id, data.expected_yield_percent);
    const yieldEval = evaluateYield(db, data.process_type || 'DIRECT_MIX', actualYield, expectedYield);
    return {
        date, inputs, input_cost: inputCost, processing_cost: processingCost,
        processing_breakdown: { ...proc.breakdown, overheads: proc.overheads, overhead_cost: proc.configured },
        total_cost: totalCost, allocation_method: method, approximate,
        allocations, actual_yield_pct: actualYield, expected_yield_pct: expectedYield,
        yield_variance_percent: yieldEval.variance, yield_flag: yieldEval.flag,
        warnings: [
            ...inputs.filter(i => i.shortfall > 0).map(i => `Insufficient ${i.milk_type ? i.milk_type + ' milk' : i.product_name}: short by ${i.shortfall}`),
            ...(approximate && outputs.length > 1 ? ['Standard selling price missing — volume allocation used (COST ALLOCATION APPROXIMATE)'] : []),
            ...(processingCost <= 0 ? ['Processing cost is zero'] : []),
            ...(yieldEval.flag === 'low' ? [`Low yield: ${actualYield}% vs expected ${expectedYield}%`] : []),
            ...(yieldEval.flag === 'high' ? [`High yield: ${actualYield}% vs expected ${expectedYield}%`] : []),
            ...(outputs.length === 0 ? ['No outputs yet'] : [])
        ]
    };
}

/** Opening stock lots at the cutover (estimated cost flagged). */
function createOpeningStockLots(db, { date, unit_costs, userId } = {}, actorId = null) {
    const d = String(date || todayBS());
    const trx = db.transaction(() => {
        const results = [];
        for (const { product_id, unit_cost } of (unit_costs || [])) {
            const qty = round2(db.prepare(
                'SELECT COALESCE(SUM(inward_qty - outward_qty), 0) s FROM stock_movements WHERE product_id = ? AND date <= ?'
            ).get(product_id, d).s);
            if (!(qty > 0)) continue;
            const cost = round2(unit_cost > 0 ? unit_cost : standardPrice(db, product_id));
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
            db.prepare(`
                INSERT INTO stock_lots (batch_id, product_id, produced_date, expires_date, quantity, qty_remaining, unit_cost, estimated_opening_cost, notes)
                VALUES (NULL, ?, ?, NULL, ?, ?, ?, 1, 'Opening stock at lot-tracking cutover (estimated cost)')
            `).run(product_id, d, qty, qty, cost);
            results.push({ product_id, product_name: product.name, quantity: qty, unit_cost: cost });
        }
        if (!getLotCutover(db)) setLotCutover(db, d);
        logAudit(db, 'stock_lots', null, 'create', null, {
            operation: 'Opening stock lots created (estimated)', date: d, lots: results
        }, (userId || actorId) || null);
        return results;
    });
    return trx();
}

module.exports = {
    round2,
    getLotCutover, setLotCutover, lotTracked,
    createMilkLot, deleteMilkLotByCollection, backfillMilkLots,
    consumeFIFO, consumptionTotal, reverseConsumptions,
    suggestMilkConsumption, suggestStockConsumption, standardPrice, allocateOutputs,
    computeProcessingCost, expectedYieldFor, evaluateYield,
    postProductionBatch, reverseProductionBatch,
    costSaleItem, reverseSaleCosting,
    getExpiredLots, writeOffExpiredStock, recordWastage,
    getStockLots, getMilkLots, getDailyReconciliation, getBatchMargin,
    getWastageReport, previewBatchCosting, createOpeningStockLots,
    shelfLifeExpiry
};
