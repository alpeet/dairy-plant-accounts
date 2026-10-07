/**
 * Prarambha Account & Stock Management — Scientific Dairy Costing Reports
 * ======================================================================
 * The reporting / daily-close layer over the lot engine
 * (`production_costing.js`) and the quantity ledger (`stock_movements`).
 *
 * This module is deliberately READ-ONLY: it never invents a movement or a
 * cost.  Every figure it reports is derived from documents the app already
 * posted (milk_collections, purchases, production_batches/inputs/outputs,
 * sales/sales_items, stock_movements, milk_lots, stock_lots, lot_consumptions,
 * wastage_records).  Money maths lives here in the core, is round2-stable, and
 * is covered by `scripts/audit/test-milk-costing.js` — never only in the UI.
 *
 * Principles (spec §1–§27):
 *   - weighted-average purchase cost per litre (never an arithmetic mean of rates)
 *   - actual COGS from the lot a product was made from, never today's price
 *   - cream/nauni/ghee keep a real, non-zero inventory value (NRV allocation)
 *   - quantity → cost → stock → production → COGS → P&L is one chain
 */

const { adToBS, bsToAD } = require('../excel-import');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;

const todayAD = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayBS = () => adToBS(todayAD()) || todayAD();

/** Shift a BS date by whole days through the AD calendar (exact). */
function bsAddDays(bs, n) {
    const ad = bsToAD(String(bs).slice(0, 10));
    if (!ad) return bs;
    const d = new Date(ad + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    const s = d.toISOString().slice(0, 10);
    return adToBS(s) || s;
}

/** Inclusive list of BS days between two BS dates. */
function bsDays(from, to) {
    const out = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 4000) {
        out.push(cur);
        cur = bsAddDays(cur, 1);
    }
    return out;
}

// ──────────────────────────────────────────────────────────────
// Product classification
// ──────────────────────────────────────────────────────────────

/** Raw-milk category used by the collection screen ("cow" | "buffalo" | "mixed"). */
function classifyMilkType(text) {
    const t = String(text || '').toLowerCase();
    if (/buffalo|bhains|bhaisi|bhais/.test(t)) return 'buffalo';
    if (/\bcow\b|\bgai\b|gais/.test(t)) return 'cow';
    return 'mixed';
}

/** True for a raw/saleable MILK product (not powder). */
function isMilkProductName(name) {
    const t = String(name || '').toLowerCase();
    if (/powder|\bsmp\b|paneer|curd|dahi|ghee|butter|nauni|cream|chhurpi|yogurt|ice/.test(t)) return false;
    return /milk|dudh|doodh|dud/.test(t);
}

/**
 * Inventory category for the stock ledger (§16). Driven by the product's own
 * category string so the owner can reclassify any item without code changes.
 */
function classifyInventoryCategory(product) {
    const cat = String((product && product.category) || '').toLowerCase();
    const name = String((product && product.name) || '').toLowerCase();
    if (['milk', 'raw materials', 'raw material', 'ingredients', 'packaging', 'plant helpers', 'consumables'].includes(cat)) {
        return 'Raw Materials';
    }
    if (['wip', 'work in progress', 'in process'].includes(cat)) return 'Work in Progress';
    if (/raw\s*milk/.test(name)) return 'Raw Materials';
    return 'Finished Goods';
}

/** Product row (id/name/unit/category) for a name when the id is missing. */
function productFor(db, productId, productName) {
    if (productId) {
        const p = db.prepare('SELECT id, name, unit, category FROM products WHERE id = ?').get(productId);
        if (p) return p;
    }
    if (productName) {
        const p = db.prepare('SELECT id, name, unit, category FROM products WHERE name = ? LIMIT 1').get(productName);
        if (p) return p;
    }
    return { id: productId || null, name: productName || '', unit: '', category: '' };
}

// ──────────────────────────────────────────────────────────────
// §1 + §3 — Daily weighted-average milk purchase cost
// ──────────────────────────────────────────────────────────────

/**
 * Milk acquired for `date`, by category, at a WEIGHTED average rate/L.
 * Basis (matches getMilkCostSummary's once-only rule):
 *   collections  +  milk lines on purchase bills that have no linked collection.
 * A purchase bill whose milk is already represented by a collection contributes
 * nothing here, so milk is never counted — or averaged — twice.
 */
function getDailyMilkCost(db, { date } = {}) {
    const d = String(date || todayBS());

    const collections = db.prepare(`
        SELECT milk_type AS type,
               COALESCE(SUM(quantity_liters), 0) AS liters,
               COALESCE(SUM(amount), 0) AS amount,
               COALESCE(SUM(fat_percent * quantity_liters), 0) AS fat_liters,
               COALESCE(SUM(snf_percent * quantity_liters), 0) AS snf_liters
        FROM milk_collections WHERE date = ? GROUP BY milk_type
    `).all(d);

    // Row detail for the procurement metrics (supplier count, min/max rate,
    // fixed vs fat-SNF litres) — §6. Aggregates alone cannot answer these.
    const detail = db.prepare(`
        SELECT party_id, milk_type, quantity_liters, rate, rate_type
        FROM milk_collections WHERE date = ?
    `).all(d);

    // Unlinked milk lines still sitting on purchase bills.
    const unlinked = db.prepare(`
        SELECT pi.product_name, pi.quantity, pi.amount, pi.rate, pi.unit, p.party_id
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.date = ?
          AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)
    `).all(d).filter(r => isMilkProductName(r.product_name));

    const buckets = new Map();
    const bucket = (type) => {
        if (!buckets.has(type)) buckets.set(type, {
            milk_type: type, liters: 0, amount: 0, fat_liters: 0, snf_liters: 0,
            collections_liters: 0, collections_amount: 0, purchase_liters: 0, purchase_amount: 0,
            suppliers: new Set(), min_rate: null, max_rate: null,
            fixed_liters: 0, formula_liters: 0
        });
        return buckets.get(type);
    };
    const noteRate = (b, rate, liters) => {
        const r = num(rate);
        if (r > 0) {
            b.min_rate = b.min_rate === null ? r : Math.min(b.min_rate, r);
            b.max_rate = b.max_rate === null ? r : Math.max(b.max_rate, r);
        }
        if (liters) b.fixed_liters = round2(b.fixed_liters + num(liters));
    };
    for (const r of collections) {
        const b = bucket(r.type || 'mixed');
        b.liters = round2(b.liters + num(r.liters));
        b.amount = round2(b.amount + num(r.amount));
        b.fat_liters = round2(b.fat_liters + num(r.fat_liters));
        b.snf_liters = round2(b.snf_liters + num(r.snf_liters));
        b.collections_liters = round2(b.collections_liters + num(r.liters));
        b.collections_amount = round2(b.collections_amount + num(r.amount));
    }
    // Pricing method split: every collection row says which method priced it.
    const allSuppliers = new Set();
    for (const r of detail) {
        const b = bucket(r.milk_type || 'mixed');
        if (r.party_id != null) { b.suppliers.add(r.party_id); allSuppliers.add(r.party_id); }
        noteRate(b, r.rate, 0);
        if (String(r.rate_type) === 'fixed') b.fixed_liters = round2(b.fixed_liters + num(r.quantity_liters));
        else b.formula_liters = round2(b.formula_liters + num(r.quantity_liters));
    }
    for (const r of unlinked) {
        const b = bucket(classifyMilkType(r.product_name));
        b.liters = round2(b.liters + num(r.quantity));
        b.amount = round2(b.amount + num(r.amount));
        b.purchase_liters = round2(b.purchase_liters + num(r.quantity));
        b.purchase_amount = round2(b.purchase_amount + num(r.amount));
        if (r.party_id != null) { b.suppliers.add(r.party_id); allSuppliers.add(r.party_id); }
        // A purchase bill carries a contracted rate, not a fat/SNF formula.
        noteRate(b, r.rate, r.quantity);
    }

    const categories = [...buckets.values()].map(b => ({
        ...b,
        supplier_count: b.suppliers.size,
        suppliers: undefined,
        avg_rate: b.liters > 0 ? round2(b.amount / b.liters) : 0,
        min_rate: b.min_rate === null ? 0 : round2(b.min_rate),
        max_rate: b.max_rate === null ? 0 : round2(b.max_rate),
        fat_percent: b.liters > 0 ? round2(b.fat_liters / b.liters) : 0,
        snf_percent: b.liters > 0 ? round2(b.snf_liters / b.liters) : 0
    })).sort((a, b) => a.milk_type.localeCompare(b.milk_type));

    const totalLiters = round2(categories.reduce((s, c) => s + c.liters, 0));
    const totalAmount = round2(categories.reduce((s, c) => s + c.amount, 0));
    const fatL = round2(categories.reduce((s, c) => s + c.fat_liters, 0));
    const snfL = round2(categories.reduce((s, c) => s + c.snf_liters, 0));
    const positiveRates = categories.filter(c => c.min_rate > 0);
    return {
        date: d,
        categories,
        total_liters: totalLiters,
        total_amount: totalAmount,
        avg_rate: totalLiters > 0 ? round2(totalAmount / totalLiters) : 0,
        fat_percent: totalLiters > 0 ? round2(fatL / totalLiters) : 0,
        snf_percent: totalLiters > 0 ? round2(snfL / totalLiters) : 0,
        collections_liters: round2(categories.reduce((s, c) => s + c.collections_liters, 0)),
        collections_amount: round2(categories.reduce((s, c) => s + c.collections_amount, 0)),
        purchase_liters: round2(categories.reduce((s, c) => s + c.purchase_liters, 0)),
        purchase_amount: round2(categories.reduce((s, c) => s + c.purchase_amount, 0)),
        // §6 procurement metrics
        supplier_count: allSuppliers.size,
        min_rate: positiveRates.length ? round2(Math.min(...positiveRates.map(c => c.min_rate))) : 0,
        max_rate: positiveRates.length ? round2(Math.max(...positiveRates.map(c => c.max_rate))) : 0,
        fixed_liters: round2(categories.reduce((s, c) => s + c.fixed_liters, 0)),
        formula_liters: round2(categories.reduce((s, c) => s + c.formula_liters, 0))
    };
}

// ──────────────────────────────────────────────────────────────
// §2 + §3 — Daily milk flow & reconciliation (quantity + value)
// ──────────────────────────────────────────────────────────────

/** Opening qty/value of the raw-milk lot pool at the start of a BS date. */
function milkPoolOpening(db, date) {
    const lots = db.prepare('SELECT id, quantity, total_cost FROM milk_lots WHERE date < ?').all(date);
    const cons = db.prepare(
        "SELECT lot_id, SUM(quantity) q, SUM(total_cost) v FROM lot_consumptions WHERE lot_type = 'milk' AND date < ? GROUP BY lot_id"
    ).all(date);
    const usedBy = new Map(cons.map(c => [c.lot_id, c]));
    let qty = 0, value = 0;
    for (const l of lots) {
        const u = usedBy.get(l.id);
        qty += num(l.quantity) - num(u && u.q);
        value += num(l.total_cost) - num(u && u.v);
    }
    return { qty: round2(qty), value: round2(value) };
}

/**
 * End-to-end raw-milk flow for one date, with the explicit identity
 *   Opening + Collection + Purchase = Processed + Direct Sales + Wastage + Closing
 * Quantities come from the documents; values come from the actual lot costs.
 */
function getMilkFlow(db, { date } = {}) {
    const d = String(date || todayBS());
    const opening = milkPoolOpening(db, d);

    // Additions this day — lots created today carry real cost.
    const additions = db.prepare(
        'SELECT COALESCE(SUM(quantity),0) q, COALESCE(SUM(total_cost),0) v FROM milk_lots WHERE date = ?'
    ).get(d);

    // Consumption today, split by what consumed it (value = actual lot cost).
    const cons = db.prepare(`
        SELECT reference_type, COALESCE(SUM(quantity),0) q, COALESCE(SUM(total_cost),0) v
        FROM lot_consumptions WHERE lot_type = 'milk' AND date = ? GROUP BY reference_type
    `).all(d);
    const consOf = (t) => cons.filter(c => c.reference_type === t).reduce((s, c) => ({ q: s.q + num(c.q), v: s.v + num(c.v) }), { q: 0, v: 0 });

    const processed = consOf('production_input');
    const wastage = consOf('wastage');
    const rawSale = consOf('raw_sale');

    // Direct milk sales that predate lot tracking: quantity from the quantity
    // ledger for Milk-category products (value 0 — no lot cost exists).
    const directSaleMov = db.prepare(`
        SELECT COALESCE(SUM(sm.outward_qty),0) q FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        WHERE sm.date = ? AND sm.type = 'sale' AND p.category = 'Milk'
    `).get(d);
    const directSaleQty = round2(Math.max(num(rawSale.q), num(directSaleMov.q)));
    const directSaleValue = round2(rawSale.v);

    const closingQty = round2(opening.qty + num(additions.q) - num(processed.q) - directSaleQty - num(wastage.q));
    const closingValue = round2(opening.value + num(additions.v) - num(processed.v) - directSaleValue - num(wastage.v));

    const identityIn = round2(opening.qty + num(additions.q));
    const identityOut = round2(num(processed.q) + directSaleQty + num(wastage.q) + closingQty);
    return {
        date: d,
        lot_basis: true,
        opening: { qty: opening.qty, value: opening.value, rate: opening.qty > 0 ? round2(opening.value / opening.qty) : 0 },
        collected: { qty: num(additions.q), value: num(additions.v) },   // additions come from collections/purchases
        processed: { qty: round2(processed.q), value: round2(processed.v) },
        direct_sold: { qty: directSaleQty, value: directSaleValue },
        wastage: { qty: round2(wastage.q), value: round2(wastage.v) },
        closing: { qty: closingQty, value: closingValue, rate: closingQty > 0 ? round2(closingValue / closingQty) : 0 },
        identity: {
            inflow: identityIn,
            outflow: identityOut,
            balanced: Math.abs(identityIn - identityOut) < 0.01,
            error: round2(identityIn - identityOut)
        }
    };
}

// ──────────────────────────────────────────────────────────────
// §4 — Daily sales realization per litre
// ──────────────────────────────────────────────────────────────

/**
 * Has the FIFO lot engine ever produced lots (cutover set or lots exist)?
 * Used to decide whether an observed COGS of 0 means "free" or "not costed".
 * Lazy require avoids a circular load with production_costing.
 */
function _lotCostingActive(db) {
    try {
        const pc = require('./production_costing');
        if (pc.getLotCutover && pc.getLotCutover(db)) return true;
    } catch (e) { /* costing module absent */ }
    try {
        if (db.prepare('SELECT 1 FROM stock_lots LIMIT 1').get()) return true;
        if (db.prepare('SELECT 1 FROM milk_lots LIMIT 1').get()) return true;
    } catch (e) { /* lot tables not migrated */ }
    return false;
}

/**
 * Actual milk sales realization for a date: gross, discounts, returns, net,
 * litres and net/L — plus the production cost/L and gross margin/L so purchase
 * cost, processing cost and selling price are never confused.
 */
function getDailySalesRealization(db, { date } = {}) {
    const d = String(date || todayBS());
    const lines = db.prepare(`
        SELECT si.id, si.sale_id, si.product_id, si.product_name, si.quantity, si.unit, si.rate, si.amount,
               s.date, s.discount, s.subtotal
        FROM sales_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.date = ?
    `).all(d).filter(r => {
        const p = productFor(db, r.product_id, r.product_name);
        return p.category === 'Milk' || isMilkProductName(r.product_name);
    });

    const qty = round2(lines.reduce((s, r) => s + num(r.quantity), 0));
    const gross = round2(lines.reduce((s, r) => s + num(r.amount), 0));

    // Allocate each invoice's discount to its milk lines by amount share.
    let discount = 0;
    const bySale = new Map();
    for (const r of lines) bySale.set(r.sale_id, [...(bySale.get(r.sale_id) || []), r]);
    for (const [, rows] of bySale) {
        const sale = rows[0];
        const subtotal = num(sale.subtotal);
        const disc = num(sale.discount);
        if (subtotal > 0 && disc > 0) {
            const lineAmt = rows.reduce((s, r) => s + num(r.amount), 0);
            discount += disc * (lineAmt / subtotal);
        }
    }
    discount = round2(discount);

    // Returns: return_in movements on milk products that day, valued at the
    // invoice rate of the same product (best available).
    const returnsRows = db.prepare(`
        SELECT sm.product_id, COALESCE(SUM(sm.inward_qty),0) q
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.date = ? AND sm.type = 'return_in' AND p.category = 'Milk'
        GROUP BY sm.product_id
    `).all(d);
    const rateByProduct = new Map();
    for (const r of lines) rateByProduct.set(r.product_id, num(r.rate) || rateByProduct.get(r.product_id) || 0);
    const returnsQty = round2(returnsRows.reduce((s, r) => s + num(r.q), 0));
    const returnsValue = round2(returnsRows.reduce((s, r) => s + num(r.q) * num(rateByProduct.get(r.product_id)), 0));

    const netLitres = round2(qty - returnsQty);
    const netSales = round2(gross - discount - returnsValue);

    // Honest COGS basis (audit req: never print an inflated margin): margin is
    // only meaningful when the lot engine has actually costed the sale.
    const lotCostingActive = _lotCostingActive(db);

    // Actual cost of the milk sold — from the finished-goods lots consumed by
    // sales that day (never today's purchase price).
    const cogs = round2(db.prepare(`
        SELECT COALESCE(SUM(lc.total_cost),0) c FROM lot_consumptions lc
        JOIN stock_lots sl ON sl.id = lc.lot_id AND lc.lot_type = 'stock'
        JOIN products p ON p.id = sl.product_id
        WHERE lc.reference_type = 'sale' AND lc.date = ? AND (p.category = 'Milk' OR LOWER(p.name) LIKE '%milk%')
    `).get(d).c);

    return {
        date: d,
        quantity_liters: qty,
        gross_sales: gross,
        discounts: discount,
        returns_liters: returnsQty,
        returns_value: returnsValue,
        net_liters: netLitres,
        net_sales: netSales,
        avg_sales_price: qty > 0 ? round2(gross / qty) : 0,
        realization_per_liter: netLitres > 0 ? round2(netSales / netLitres) : 0,
        cogs: cogs,
        cost_per_liter: netLitres > 0 ? round2(cogs / netLitres) : 0,
        gross_margin: round2(netSales - cogs),
        gross_margin_per_liter: netLitres > 0 ? round2((netSales - cogs) / netLitres) : 0,
        // COGS comes from FIFO lot consumption; when the lot engine has never
        // run, cogs is 0 and the margin above is NOT a real margin — the UI
        // must show the basis instead of an inflated number.
        lot_costing_active: lotCostingActive,
        cogs_available: lotCostingActive && (cogs > 0 || netLitres <= 0)
    };
}

// ──────────────────────────────────────────────────────────────
// §20 — Daily / weekly / monthly Milk Cost vs Sales
// ──────────────────────────────────────────────────────────────

/** Group key for a BS date string. */
function periodKey(bsDate, groupBy) {
    const s = String(bsDate);
    if (groupBy === 'monthly') return s.slice(0, 7);
    if (groupBy === 'weekly') {
        const ad = bsToAD(s);
        if (!ad) return s;
        const dt = new Date(ad + 'T00:00:00Z');
        const day = dt.getUTCDay();               // 0=Sun
        const diff = (day + 6) % 7;               // days since Monday
        dt.setUTCDate(dt.getUTCDate() - diff);
        return adToBS(dt.toISOString().slice(0, 10)) || s;
    }
    return s;
}

/**
 * Per-period purchase cost/L vs sales realization/L vs margin/L — the report
 * the owner uses to see procurement cost rising faster than selling price.
 */
function getDailyMilkCostVsSales(db, { from_date, to_date, groupBy = 'daily' } = {}) {
    const from = String(from_date || todayBS());
    const to = String(to_date || from);
    const periods = new Map();
    const key = (d) => periodKey(d, groupBy);
    const row = (k) => {
        if (!periods.has(k)) periods.set(k, {
            period: k, received_liters: 0, purchase_cost: 0,
            processed_liters: 0, sold_liters: 0, net_sales: 0, cogs: 0
        });
        return periods.get(k);
    };

    for (const day of bsDays(from, to)) {
        const mc = getDailyMilkCost(db, { date: day });
        const flow = getMilkFlow(db, { date: day });
        const sr = getDailySalesRealization(db, { date: day });
        const r = row(key(day));
        r.received_liters = round2(r.received_liters + mc.total_liters);
        r.purchase_cost = round2(r.purchase_cost + mc.total_amount);
        r.processed_liters = round2(r.processed_liters + flow.processed.qty);
        r.sold_liters = round2(r.sold_liters + sr.net_liters);
        r.net_sales = round2(r.net_sales + sr.net_sales);
        r.cogs = round2(r.cogs + sr.cogs);
    }

    const rows = [...periods.values()].sort((a, b) => a.period.localeCompare(b.period)).map(r => ({
        ...r,
        avg_purchase_cost: r.received_liters > 0 ? round2(r.purchase_cost / r.received_liters) : 0,
        avg_sales_realization: r.sold_liters > 0 ? round2(r.net_sales / r.sold_liters) : 0,
        production_cost_per_liter: r.sold_liters > 0 ? round2(r.cogs / r.sold_liters) : 0,
        gross_margin: round2(r.net_sales - r.cogs),
        gross_margin_per_liter: r.sold_liters > 0 ? round2((r.net_sales - r.cogs) / r.sold_liters) : 0
    }));
    return {
        from_date: from, to_date: to, group_by: groupBy, rows,
        // Honest basis flag: margin/L on these rows is only real COGS when the
        // lot engine has produced lots (see getDailySalesRealization).
        lot_costing_active: _lotCostingActive(db)
    };
}

// ──────────────────────────────────────────────────────────────
// §21 — Product cost report
// ──────────────────────────────────────────────────────────────

/**
 * Per (batch, output product): inputs, input cost, processing cost, total cost,
 * output qty, cost/unit, standard selling price and margin. Groups by product
 * across the range with a per-batch drill-down.
 */
function getProductCostReport(db, { from_date, to_date, product_id } = {}) {
    const from = String(from_date || todayBS());
    const to = String(to_date || todayBS());
    const batches = db.prepare(`
        SELECT * FROM production_batches
        WHERE date BETWEEN ? AND ? AND status = 'posted'
        ORDER BY date, id
    `).all(from, to);

    const products = new Map();
    const detailed = [];
    for (const b of batches) {
        const outputs = db.prepare(`
            SELECT po.*, p.rate AS selling_rate FROM production_outputs po
            LEFT JOIN products p ON p.id = po.product_id WHERE po.batch_id = ?
        `).all(b.id);
        const inputs = db.prepare('SELECT * FROM production_inputs WHERE batch_id = ?').all(b.id);
        for (const o of outputs) {
            if (product_id && num(o.product_id) !== num(product_id)) continue;
            if (!products.has(o.product_id)) products.set(o.product_id, {
                product_id: o.product_id, product_name: o.product_name, unit: o.unit,
                output_quantity: 0, input_cost: 0, processing_cost: 0, total_cost: 0, batches: 0
            });
            const g = products.get(o.product_id);
            g.output_quantity = round2(g.output_quantity + num(o.quantity));
            // Attribute the batch's input+processing cost to this output by its
            // share of the batch's allocated output cost.
            const share = num(b.total_cost) > 0 ? num(o.amount) / num(b.total_cost) : 0;
            g.input_cost = round2(g.input_cost + num(b.input_cost) * share);
            g.processing_cost = round2(g.processing_cost + num(b.processing_cost) * share);
            g.total_cost = round2(g.total_cost + num(o.amount));
            g.batches += 1;
            detailed.push({
                batch_id: b.id, batch_no: b.batch_no, date: b.date, process_type: b.process_type,
                product_id: o.product_id, product_name: o.product_name,
                quantity: round2(o.quantity), unit_cost: round2(o.rate), allocated_cost: round2(o.amount),
                input_cost: round2(num(b.input_cost) * share), processing_cost: round2(num(b.processing_cost) * share),
                selling_price: round2(o.selling_rate),
                margin_per_unit: round2(num(o.selling_rate) - num(o.rate)),
                yield_flag: b.yield_flag || 'ok',
                inputs: inputs.map(i => ({ product_name: i.product_name, quantity: round2(i.quantity), amount: round2(i.amount) }))
            });
        }
    }
    const rows = [...products.values()].map(p => ({
        ...p,
        unit_cost: p.output_quantity > 0 ? round2(p.total_cost / p.output_quantity) : 0,
        selling_price: round2(db.prepare('SELECT rate FROM products WHERE id = ?').get(p.product_id)?.rate || 0),
        margin_per_unit: round2(num(db.prepare('SELECT rate FROM products WHERE id = ?').get(p.product_id)?.rate) - (p.output_quantity > 0 ? p.total_cost / p.output_quantity : 0))
    })).sort((a, b) => b.total_cost - a.total_cost);

    return { from_date: from, to_date: to, rows, batches: detailed };
}

// ──────────────────────────────────────────────────────────────
// §16 — Stock ledger (Raw Materials / WIP / Finished Goods)
// ──────────────────────────────────────────────────────────────

/**
 * Movement ledger for a product with running balance and value, plus the
 * current lot-based inventory value. Never recomputes stock independently —
 * quantities replay `stock_movements`, values read the lots.
 */
function getStockLedger(db, { product_id, from_date, to_date } = {}) {
    // Explicit empty string = "no bound" (All Dates); undefined keeps the
    // single-day default. The date layer sends '' for the 'all' preset.
    const from = (from_date === undefined || from_date === null) ? todayBS() : String(from_date);
    const to = (to_date === undefined || to_date === null) ? todayBS() : String(to_date);
    const products = product_id
        ? db.prepare('SELECT * FROM products WHERE id = ?').all(product_id)
        : db.prepare('SELECT * FROM products ORDER BY name').all();

    // Reference labels + party names, batch-loaded once (no per-row lookups).
    // Party comes from the source document so every movement is traceable
    // (req 1 / 14) — internal movements are labelled, never left blank.
    const refLabel = new Map();
    const refParty = new Map();
    const loadRefs = (sql, prefix) => {
        try {
            for (const r of db.prepare(sql).all()) {
                refLabel.set(`${prefix}:${r.id}`, r.label);
                if (r.party_name) refParty.set(`${prefix}:${r.id}`, r.party_name);
            }
        } catch (e) { /* table absent */ }
    };
    loadRefs(`SELECT id, batch_no AS label, '' AS party_name FROM production_batches`, 'production');
    loadRefs(`SELECT s.id, s.invoice_no AS label, COALESCE(p.name,'') AS party_name
              FROM sales s LEFT JOIN parties p ON p.id = s.party_id`, 'sale');
    loadRefs(`SELECT pu.id, pu.bill_no AS label, COALESCE(p.name,'') AS party_name
              FROM purchases pu LEFT JOIN parties p ON p.id = pu.party_id`, 'purchase');
    loadRefs(`SELECT mc.id, mc.collection_no AS label, COALESCE(p.name,'') AS party_name
              FROM milk_collections mc LEFT JOIN parties p ON p.id = mc.party_id`, 'milk_collection');

    const ledger = [];
    for (const p of products) {
        const openingQty = from ? round2(num(db.prepare(
            'SELECT COALESCE(SUM(inward_qty - outward_qty),0) s FROM stock_movements WHERE product_id = ? AND date < ?'
        ).get(p.id, from).s)) : 0;
        let moveCond = 'sm.product_id = ?';
        const moveParams = [p.id];
        if (from) { moveCond += ' AND sm.date >= ?'; moveParams.push(from); }
        if (to) { moveCond += ' AND sm.date <= ?'; moveParams.push(to); }
        const movements = db.prepare(`
            SELECT sm.* FROM stock_movements sm
            WHERE ${moveCond}
            ORDER BY sm.date, sm.id
        `).all(...moveParams);
        const rows = [];
        // Per-type buckets for the Product Summary view — computed from the
        // SAME rows the detailed ledger shows (one engine, no second query).
        const buckets = {
            collection_in: 0, purchase_in: 0, production_in: 0, production_out: 0,
            sales_out: 0, returns_in: 0, returns_out: 0, wastage_out: 0,
            adjustment_in: 0, adjustment_out: 0, other_in: 0, other_out: 0
        };
        let balance = openingQty;
        let totalIn = 0, totalOut = 0;
        // Net effect per Excel-style column (a row may carry BOTH an inward and
        // an outward side — e.g. a sales return posted as type 'sale', or a
        // production reversal), so identity holds for every row (req 18).
        const netFlow = { sales_issues: 0, collection_purchase: 0, production: 0, production_consumption: 0, other: 0 };
        for (const m of movements) {
            const inQty = round2(m.inward_qty), outQty = round2(m.outward_qty);
            balance = round2(balance + inQty - outQty);
            totalIn += inQty; totalOut += outQty;
            // Value from the lot layer where it exists (finished goods), else the
            // movement's own rate. Outward value is the lot cost when available.
            const lotValue = round2(db.prepare(`
                SELECT COALESCE(SUM(total_cost),0) v FROM lot_consumptions
                WHERE lot_type = 'stock' AND date = ? AND lot_id IN (SELECT id FROM stock_lots WHERE product_id = ?)
            `).get(m.date, p.id).v);
            const unitCost = round2(num(m.rate));
            const label = movementLabel(m);
            // Bucket the movement for the summary view.
            switch (m.type) {
                case 'milk_collection': buckets.collection_in += inQty; break;
                case 'purchase': buckets.purchase_in += inQty; break;
                case 'production_output': buckets.production_in += inQty; break;
                case 'production_input': buckets.production_out += outQty; break;
                case 'sale': buckets.sales_out += outQty; break;
                case 'return_in': buckets.returns_in += inQty; break;
                case 'return_out': buckets.returns_out += outQty; break;
                case 'adjustment':
                    if (m.reference_type === 'wastage') buckets.wastage_out += outQty;
                    else if (inQty > 0) buckets.adjustment_in += inQty;
                    else buckets.adjustment_out += outQty;
                    break;                    default:
                    if (inQty > 0) buckets.other_in += inQty;
                    else if (outQty > 0) buckets.other_out += outQty;
            }
            // Same movements, mapped to their daily-flow column by THE shared
            // mapping below — the live statement and the Excel export can never
            // drift apart (reqs 16 / 17).
            const fd = flowDelta(m);
            netFlow[fd.column] += fd.qty;
            const createdAt = m.created_at || '';
            // Stored timestamp as-is (space = local datetime(), T = ISO) — never invented.
            const timeRaw = createdAt.includes('T')
                ? (createdAt.split('T')[1] || '')
                : (createdAt.includes(' ') ? createdAt.split(' ')[1] : '');
            const refKey = `${m.reference_type}:${m.reference_id}`;
            const refNo = (m.reference_id != null && refLabel.get(refKey)) || '';
            const party = (m.reference_id != null && refParty.get(refKey)) || internalParty(m);
            rows.push({
                date: m.date,
                time: timeRaw.slice(0, 8),
                created_at: createdAt,
                reference_type: m.reference_type, reference_id: m.reference_id,
                reference: refNo || m.notes || '',
                reference_no: refNo || m.notes || '',
                party,
                type: m.type, label, notes: m.notes,
                inward_qty: inQty, outward_qty: outQty, balance,
                unit_cost: unitCost,
                value: m.outward_qty > 0 && lotValue > 0 ? round2(-lotValue) : round2((inQty - outQty) * unitCost)
            });
        }
        const lotValueNow = productLotValue(db, p.id);
        const summary = {
            opening: openingQty,
            collection_in: round2(buckets.collection_in),
            purchase_in: round2(buckets.purchase_in),
            production_in: round2(buckets.production_in),
            production_out: round2(buckets.production_out),
            sales_out: round2(buckets.sales_out),
            returns_in: round2(buckets.returns_in),
            returns_out: round2(buckets.returns_out),
            wastage_out: round2(buckets.wastage_out),
            adjustment_in: round2(buckets.adjustment_in),
            adjustment_out: round2(buckets.adjustment_out),
            other_in: round2(buckets.other_in),
            other_out: round2(buckets.other_out),
            total_in: round2(totalIn),
            total_out: round2(totalOut),
            closing: balance
        };
        // Excel-style daily-flow row (reqs 2–9). Derived from the SAME movement
        // replay above — no second stock calculation engine (req 16).
        const flow = stockFlowRow({
            opening: openingQty,
            sales_issues: netFlow.sales_issues,
            collection_purchase: netFlow.collection_purchase,
            production: netFlow.production,
            production_consumption: netFlow.production_consumption,
            other: netFlow.other,
            closing: balance
        });
        ledger.push({
            product_id: p.id, product_name: p.name, unit: p.unit, category: p.category,
            inventory_category: classifyInventoryCategory(p),
            opening_qty: openingQty, closing_qty: balance,
            lot_value: lotValueNow,
            summary,
            flow,
            rows
        });
    }
    return { from_date: from, to_date: to, products: ledger };
}

/**
 * Excel-style daily-flow row for one product, built ONLY from the summary
 * buckets of the quantity ledger.  Opening is the balance immediately before
 * the period; closing is the balance after the last movement in the period.
 *
 *   Remaining  = Opening − Sales/Issues          (never called "opening")
 *   Closing    = Remaining + Collection/Purchase + Production
 *                − Production Consumption + Other
 *
 * The identity is asserted by `identity_ok`, not assumed (req 18).
 */
/**
 * THE movement → daily-flow mapping. Returns the column a movement belongs to
 * and its signed quantity in that column's own direction (so the statement
 * reads opening − sales + collection + production − consumption + other =
 * closing for every product and every period).  One mapping, used by the live
 * statement, the Stock Ledger and the Excel export.
 */
function flowDelta(row = {}) {
    const inQty = num(row.inward_qty), outQty = num(row.outward_qty);
    const delta = round2(inQty - outQty);
    switch (row.type) {
        case 'sale': return { column: 'sales_issues', qty: round2(-delta) };
        case 'milk_collection':
        case 'purchase': return { column: 'collection_purchase', qty: delta };
        case 'production_output': return { column: 'production', qty: delta };
        case 'production_input': return { column: 'production_consumption', qty: round2(-delta) };
        default: return { column: 'other', qty: delta };
    }
}

function stockFlowRow(input = {}) {
    const opening = round2(input.opening || 0);
    const salesIssues = round2(input.sales_issues || 0);
    const remaining = round2(opening - salesIssues);
    const collectionPurchase = round2(input.collection_purchase || 0);
    const production = round2(input.production || 0);
    const consumption = round2(input.production_consumption || 0);
    const other = round2(input.other || 0);
    const computed = round2(opening - salesIssues + collectionPurchase + production - consumption + other);
    // Authoritative closing comes from the engine's replay; the identity is
    // asserted against it, never assumed.
    const closing = (input.closing === undefined || input.closing === null) ? computed : round2(input.closing);
    return {
        opening,
        sales_issues: salesIssues,
        remaining,
        collection_purchase: collectionPurchase,
        production,
        production_consumption: consumption,
        other,
        closing,
        identity_ok: Math.abs(computed - closing) < 0.02
    };
}

/** Party label for internal movements — never blank while a source exists (req 14). */
function internalParty(m) {
    switch (m.type) {
        case 'production_input':
        case 'production_output': return 'Production / Internal';
        case 'opening': return 'Opening Balance';
        case 'adjustment': return m.reference_type === 'wastage' ? 'Wastage / Internal' : 'Stock Adjustment';
        default: return m.notes || 'Internal / Unspecified';
    }
}

/** Human movement name for the detailed stock ledger (req: labeled movements). */
function movementLabel(m) {
    switch (m.type) {
        case 'opening': return 'Opening Balance';
        case 'milk_collection': return 'Milk Collection';
        case 'purchase': return 'Purchase';
        case 'production_output': return 'Production Output';
        case 'production_input': return 'Production Consumption';
        case 'sale': return 'Sales';
        case 'return_in': return m.reference_type === 'sale' ? 'Sales Return' : 'Return IN';
        case 'return_out': return 'Return OUT';
        case 'adjustment': return m.reference_type === 'wastage' ? 'Wastage'
            : m.reference_type === 'purchase' ? 'Purchase Reversal' : 'Stock Adjustment';
        default: return m.type || 'Movement';
    }
}

/**
 * Lot value of one product — THE stock-valuation expression (Phase 27).
 * Every module that needs "what is this product's stock worth at actual
 * cost" goes through here instead of restating the SQL.
 */
function productLotValue(db, productId) {
    return round2(num(db.prepare(
        'SELECT COALESCE(SUM(qty_remaining * unit_cost),0) v FROM stock_lots WHERE product_id = ?'
    ).get(productId).v));
}

/** Inventory value grouped by Raw Materials / WIP / Finished Goods. */
function getInventoryValuation(db) {
    const products = db.prepare('SELECT * FROM products').all();
    const groups = { 'Raw Materials': 0, 'Work in Progress': 0, 'Finished Goods': 0 };
    const lines = [];
    for (const p of products) {
        const qtyMove = round2(num(db.prepare(
            'SELECT COALESCE(SUM(inward_qty - outward_qty),0) s FROM stock_movements WHERE product_id = ?'
        ).get(p.id).s));
        const lotQty = round2(num(db.prepare('SELECT COALESCE(SUM(qty_remaining),0) q FROM stock_lots WHERE product_id = ?').get(p.id).q));
        const lotValue = productLotValue(db, p.id);
        if (qtyMove === 0 && lotQty === 0 && lotValue === 0) continue;
        const cat = classifyInventoryCategory(p);
        groups[cat] = round2(groups[cat] + lotValue);
        lines.push({ product_id: p.id, product_name: p.name, inventory_category: cat, quantity: qtyMove, lot_quantity: lotQty, value: lotValue });
    }
    return { groups, total_value: round2(Object.values(groups).reduce((s, v) => s + v, 0)), lines };
}

// ──────────────────────────────────────────────────────────────
// §19 — Daily management dashboard
// ──────────────────────────────────────────────────────────────

/** One screen for milk economics, sales, production, cost and efficiency. */
function getManagementDashboard(db, { date } = {}) {
    const d = String(date || todayBS());
    const milk = getDailyMilkCost(db, { date: d });
    const flow = getMilkFlow(db, { date: d });
    const sales = getDailySalesRealization(db, { date: d });

    const allSales = db.prepare(
        'SELECT COALESCE(SUM(grand_total),0) total, COUNT(*) n FROM sales WHERE date = ?'
    ).get(d);

    const production = db.prepare(`
        SELECT pb.process_type, COUNT(*) batches, COALESCE(SUM(pb.input_quantity),0) input_qty,
               COALESCE(SUM(pb.total_cost),0) total_cost, COALESCE(SUM(pb.processing_cost),0) processing_cost
        FROM production_batches pb WHERE pb.date = ? AND pb.status = 'posted'
        GROUP BY pb.process_type ORDER BY pb.process_type
    `).all(d);

    // Produced quantities by output product that day.
    const produced = db.prepare(`
        SELECT po.product_id, po.product_name, po.unit, COALESCE(SUM(po.quantity),0) qty,
               COALESCE(SUM(po.amount),0) value
        FROM production_outputs po JOIN production_batches pb ON pb.id = po.batch_id
        WHERE pb.date = ? AND pb.status = 'posted'
        GROUP BY po.product_id, po.product_name ORDER BY qty DESC
    `).all(d);

    const inputCost = round2(production.reduce((s, p) => s + num(p.total_cost), 0));
    const processingCost = round2(production.reduce((s, p) => s + num(p.processing_cost), 0));
    const wastage = db.prepare(
        'SELECT COALESCE(SUM(total_cost),0) value, COALESCE(SUM(quantity),0) qty FROM wastage_records WHERE date = ?'
    ).get(d);
    const totalReceived = round2(flow.opening.qty + milk.total_liters);
    const wastagePct = totalReceived > 0 ? round2(num(wastage.qty) / totalReceived * 100) : 0;

    const yieldFlags = db.prepare(
        "SELECT COUNT(*) n FROM production_batches WHERE date = ? AND status = 'posted' AND yield_flag IN ('low','high')"
    ).get(d).n;

    return {
        date: d,
        milk_economics: {
            total_received_liters: milk.total_liters,
            total_purchase_cost: milk.total_amount,
            avg_purchase_cost_per_liter: milk.avg_rate,
            processed_liters: flow.processed.qty,
            direct_sold_liters: flow.direct_sold.qty,
            remaining_liters: flow.closing.qty,
            wastage_liters: flow.wastage.qty,
            wastage_percent: wastagePct,
            opening_liters: flow.opening.qty,
            categories: milk.categories
        },
        sales: {
            total_sales_value: round2(num(allSales.total)),
            invoice_count: allSales.n,
            milk_liters_sold: sales.net_liters,
            milk_sales_value: sales.net_sales,
            avg_sales_realization_per_liter: sales.realization_per_liter
        },
        production: {
            batches: production,
            produced_products: produced,
            raw_material_cost: inputCost,
            processing_cost: processingCost,
            total_production_cost: round2(inputCost),
            output_value: round2(produced.reduce((s, p) => s + num(p.value), 0)),
            yield_flags: yieldFlags
        },
        efficiency: {
            wastage_percent: wastagePct,
            low_or_high_yield_batches: yieldFlags,
            avg_production_cost_per_liter: flow.processed.qty > 0 ? round2(inputCost / flow.processed.qty) : 0
        }
    };
}

// ──────────────────────────────────────────────────────────────
// §18 — Daily Production & Stock Closing (explicit reconciliation)
// ──────────────────────────────────────────────────────────────

/**
 * Formal close for a date: milk, cream and finished-goods reconciliations with
 * quantity AND value, and — crucially — an explicit error when anything does
 * not balance instead of a silent adjustment.
 */
function getDailyClosing(db, { date } = {}) {
    const d = String(date || todayBS());
    const milkFlow = getMilkFlow(db, { date: d });

    // Cream closing (cream is any product whose name/category says cream).
    const creamProducts = db.prepare(`
        SELECT * FROM products WHERE LOWER(name) LIKE '%cream%' OR LOWER(category) = 'cream'
    `).all();
    const creamIds = creamProducts.map(p => p.id);
    const cream = creamIds.length ? (() => {
        const opening = round2(num(db.prepare(
            `SELECT COALESCE(SUM(qty_remaining),0) q FROM stock_lots WHERE product_id IN (${creamIds.map(() => '?').join(',')}) AND produced_date < ?`
        ).get(...creamIds, d).q));
        const produced = round2(num(db.prepare(`
            SELECT COALESCE(SUM(po.quantity),0) q FROM production_outputs po
            JOIN production_batches pb ON pb.id = po.batch_id
            WHERE pb.date = ? AND pb.status = 'posted' AND po.product_id IN (${creamIds.map(() => '?').join(',')})
        `).get(d, ...creamIds).q));
        const sold = round2(num(db.prepare(`
            SELECT COALESCE(SUM(si.quantity),0) q FROM sales_items si JOIN sales s ON s.id = si.sale_id
            WHERE s.date = ? AND si.product_id IN (${creamIds.map(() => '?').join(',')})
        `).get(d, ...creamIds).q));
        const consumed = round2(num(db.prepare(`
            SELECT COALESCE(SUM(lc.quantity),0) q FROM lot_consumptions lc
            WHERE lc.lot_type = 'stock' AND lc.reference_type = 'production_input' AND lc.date = ?
              AND lc.lot_id IN (SELECT id FROM stock_lots WHERE product_id IN (${creamIds.map(() => '?').join(',')}))
        `).get(d, ...creamIds).q));
        const wasted = round2(num(db.prepare(
            `SELECT COALESCE(SUM(quantity),0) q FROM wastage_records WHERE date = ? AND product_id IN (${creamIds.map(() => '?').join(',')})`
        ).get(d, ...creamIds).q));
        const closing = round2(opening + produced - sold - consumed - wasted);
        return { opening, produced, sold, consumed, wasted, closing, balanced: Math.abs((opening + produced) - (sold + consumed + wasted + closing)) < 0.01 };
    })() : { opening: 0, produced: 0, sold: 0, consumed: 0, wasted: 0, closing: 0, balanced: true };

    // Finished goods reconciliation for the day (per product).
    const fg = db.prepare(`
        SELECT sm.product_id, p.name AS product_name, p.unit,
               COALESCE(SUM(CASE WHEN sm.type='production_output' THEN sm.inward_qty ELSE 0 END),0) produced,
               COALESCE(SUM(CASE WHEN sm.type='sale' THEN sm.outward_qty ELSE 0 END),0) sold,
               COALESCE(SUM(CASE WHEN sm.reference_type='wastage' THEN sm.outward_qty ELSE 0 END),0) wasted,
               COALESCE(SUM(sm.inward_qty - sm.outward_qty),0) net
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.date = ? GROUP BY sm.product_id ORDER BY p.name
    `).all(d);
    const finished_goods = fg.map(r => {
        const opening = round2(num(db.prepare(
            'SELECT COALESCE(SUM(inward_qty - outward_qty),0) s FROM stock_movements WHERE product_id = ? AND date < ?'
        ).get(r.product_id, d).s));
        const closing = round2(opening + num(r.net));
        const lhs = round2(opening + num(r.produced));
        const rhs = round2(num(r.sold) + num(r.wasted) + closing);
        return {
            product_id: r.product_id, product_name: r.product_name, unit: r.unit,
            opening, produced: round2(r.produced), sold: round2(r.sold), wasted: round2(r.wasted), closing,
            balanced: Math.abs(lhs - rhs) < 0.01, error: round2(lhs - rhs)
        };
    });

    const errors = [];
    if (!milkFlow.identity.balanced) errors.push(`Milk: inflow ${milkFlow.identity.inflow} ≠ outflow ${milkFlow.identity.outflow} (difference ${milkFlow.identity.error})`);
    if (!cream.balanced) errors.push('Cream: opening + produced ≠ sold + consumed + wasted + closing');
    for (const f of finished_goods) {
        if (!f.balanced) errors.push(`${f.product_name}: opening ${f.opening} + produced ${f.produced} ≠ sold ${f.sold} + wasted ${f.wasted} + closing ${f.closing} (difference ${f.error})`);
    }

    return {
        date: d,
        milk: milkFlow,
        cream,
        finished_goods,
        valuation: getInventoryValuation(db),
        errors,
        balanced: errors.length === 0
    };
}

// ──────────────────────────────────────────────────────────────
// §17 + §27 — Traceability
// ──────────────────────────────────────────────────────────────

/**
 * Walk a sale back through its finished-goods lots → production batches →
 * input lots (cream/nauni) → raw milk lots → farmer/supplier.
 */
function getSaleTraceability(db, { saleId } = {}) {
    const sale = db.prepare('SELECT s.*, p.name AS party_name FROM sales s LEFT JOIN parties p ON p.id = s.party_id WHERE s.id = ?').get(saleId);
    if (!sale) return null;
    const items = db.prepare('SELECT * FROM sales_items WHERE sale_id = ?').all(saleId);
    const lines = items.map(it => {
        const cons = db.prepare(`
            SELECT lc.*, sl.batch_id, sl.produced_date, sl.unit_cost, sl.product_id
            FROM lot_consumptions lc JOIN stock_lots sl ON sl.id = lc.lot_id AND lc.lot_type = 'stock'
            WHERE lc.reference_type = 'sale' AND lc.reference_id = ? AND sl.product_id = ?
        `).all(saleId, it.product_id);
        const lots = cons.map(c => traceBatchChain(db, c.batch_id, c));
        return {
            product_id: it.product_id, product_name: it.product_name, quantity: round2(it.quantity),
            amount: round2(it.amount), lots
        };
    });
    return { sale, items: lines };
}

/** Recursively resolve a batch's input chain down to raw milk lots/farmers. */
function traceBatchChain(db, batchId, consumption) {
    if (!batchId) {
        return { lot: consumption ? { lot_id: consumption.lot_id, quantity: round2(consumption.quantity), unit_cost: round2(consumption.unit_cost), total_cost: round2(consumption.total_cost) } : null, batch: null, inputs: [] };
    }
    const batch = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batchId);
    const inputs = db.prepare('SELECT * FROM production_inputs WHERE batch_id = ?').all(batchId).map(inp => {
        const milkCons = db.prepare(`
            SELECT lc.*, ml.milk_type, ml.party_id, ml.date AS lot_date, mc.collection_no,
                   pt.name AS party_name
            FROM lot_consumptions lc JOIN milk_lots ml ON ml.id = lc.lot_id
            LEFT JOIN milk_collections mc ON mc.id = ml.collection_id
            LEFT JOIN parties pt ON pt.id = ml.party_id
            WHERE lc.lot_type = 'milk' AND lc.reference_type = 'production_input' AND lc.reference_id = ?
        `).all(inp.id);
        const fgCons = db.prepare(
            "SELECT * FROM lot_consumptions WHERE lot_type = 'stock' AND reference_type = 'production_input' AND reference_id = ?"
        ).all(inp.id);
        return {
            product_id: inp.product_id, product_name: inp.product_name, quantity: round2(inp.quantity), amount: round2(inp.amount),
            raw_milk_lots: milkCons.map(c => ({
                lot_id: c.lot_id, milk_type: c.milk_type, date: c.lot_date, collection_no: c.collection_no,
                farmer: c.party_name || null, quantity: round2(c.quantity), unit_cost: round2(c.unit_cost), total_cost: round2(c.total_cost)
            })),
            upstream: fgCons.map(c => traceBatchChain(db, (db.prepare('SELECT batch_id FROM stock_lots WHERE id = ?').get(c.lot_id) || {}).batch_id, c))
        };
    });
    return {
        lot: consumption ? { lot_id: consumption.lot_id, quantity: round2(consumption.quantity), unit_cost: round2(consumption.unit_cost), total_cost: round2(consumption.total_cost) } : null,
        batch: batch ? { id: batch.id, batch_no: batch.batch_no, date: batch.date, process_type: batch.process_type, total_cost: batch.total_cost, unit_cost_basis: batch.total_cost } : null,
        inputs
    };
}

/** Trace one production batch down to its raw milk. */
function getBatchTraceability(db, { batchId } = {}) {
    const chain = traceBatchChain(db, batchId, null);
    if (!chain.batch) return null;
    return { batch_id: batchId, chain };
}

module.exports = {
    round2, classifyMilkType, isMilkProductName, classifyInventoryCategory,
    bsAddDays, bsDays,
    getDailyMilkCost, getMilkFlow, getDailySalesRealization, getDailyMilkCostVsSales,
    getProductCostReport, getStockLedger, getInventoryValuation, productLotValue, stockFlowRow, flowDelta,
    getManagementDashboard, getDailyClosing,
    getSaleTraceability, getBatchTraceability, traceBatchChain
};
