/**
 * Bulk (date-wise) entry service
 * ===============================
 * Mode B data entry: save all records for one date in a single action.
 *
 * DESIGN CONTRACT (master spec §6, §13, §18):
 *   - This is a UI/entry method, NOT a second data model. Every row goes
 *     through the SAME saveMilkCollection / savePurchase / saveSale used by
 *     one-by-one entry and the Excel importer → identical validation,
 *     ledger, stock, milk-lot, audit and report effects.
 *   - One DB transaction per SAVE ALL; per-row failures are reported, not
 *     silently dropped. Nothing is left half-created.
 *   - Duplicate protection uses real business keys:
 *       milk      → (date, shift, party_id, milk_type) [+route_id when set]
 *       purchases → explicit bill_no (generated BULK-BILL-… when omitted)
 *       sales     → explicit invoice_no (generated BULK-INV-… when omitted)
 *     Existing matches are UPDATED (never duplicated).
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function _normName(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Resolve a party by id or by (fuzzy-tolerant) name; returns {id, name} or null. */
function resolveParty(db, { party_id, party_name }) {
    if (party_id) {
        const p = db.prepare('SELECT id, name FROM parties WHERE id = ?').get(Number(party_id));
        if (p) return p;
        return null;
    }
    const name = _normName(party_name);
    if (!name) return null;
    const exact = db.prepare('SELECT id, name FROM parties WHERE LOWER(name) = ? ORDER BY id LIMIT 1').get(name);
    if (exact) return exact;
    // Tolerant match (same spirit as bank row matching)
    const candidates = db.prepare('SELECT id, name FROM parties').all();
    const hit = candidates.find(p => _normName(p.name).includes(name) || name.includes(_normName(p.name)));
    return hit || null;
}

/** Resolve a product by id or name. */
function resolveProduct(db, { product_id, product_name }) {
    if (product_id) {
        const p = db.prepare('SELECT id, name, unit FROM products WHERE id = ?').get(Number(product_id));
        if (p) return p;
        return null;
    }
    const name = _normName(product_name);
    if (!name) return null;
    return db.prepare('SELECT id, name, unit FROM products WHERE LOWER(name) = ? ORDER BY id LIMIT 1').get(name) || null;
}

/** Generate a unique MC-YYMMDD-#### collection number (server-side, sequential). */
function nextCollectionNo(db, date) {
    const d = new Date(String(date) + 'T00:00:00Z');
    const ymd = `${String(d.getUTCFullYear()).slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    let n = db.prepare("SELECT COUNT(*) c FROM milk_collections WHERE collection_no LIKE ?").get(`MC-${ymd}-%`).c + 1;
    let no = `MC-${ymd}-${String(n).padStart(4, '0')}`;
    while (db.prepare('SELECT id FROM milk_collections WHERE collection_no = ?').get(no)) {
        n += 1;
        no = `MC-${ymd}-${String(n).padStart(4, '0')}`;
    }
    return no;
}

/** Generate a unique document number with the given prefix, e.g. BULK-BILL-YYMMDD-001. */
function nextDocNo(db, table, column, prefix, date) {
    const d = new Date(String(date) + 'T00:00:00Z');
    const ymd = `${String(d.getUTCFullYear()).slice(-2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const pattern = `${prefix}-${ymd}-%`;
    let n = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} LIKE ?`).get(pattern).c + 1;
    let no = `${prefix}-${ymd}-${String(n).padStart(3, '0')}`;
    while (db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(no)) {
        n += 1;
        no = `${prefix}-${ymd}-${String(n).padStart(3, '0')}`;
    }
    return no;
}

function _rowError(rowNo, name, error) {
    return { row: rowNo, name: name || '', error };
}

/** Locate an existing milk collection by the real business key. */
function findExistingCollection(db, { date, shift, party_id, milk_type, route_id }) {
    const rows = db.prepare(`
        SELECT * FROM milk_collections
        WHERE date = ? AND IFNULL(shift,'') = IFNULL(?, '') AND party_id = ? AND LOWER(IFNULL(milk_type,'')) = LOWER(?)
          AND (IFNULL(route_id,0) = IFNULL(?,0))
        ORDER BY id LIMIT 1
    `).all(date, shift || 'morning', party_id, milk_type || '', route_id || null);
    return rows[0] || null;
}

/**
 * Save all milk collections for one date in one transaction.
 *
 * data: { date, shift?, route_id?, rows: [{ party_id|party_name, milk_type,
 *         quantity_liters, fat_percent, snf_percent, rate?, notes? }] }
 * Rate when omitted/0 comes from the effective rate chart formula — the same
 * engine the single-entry screen uses.
 *
 * Returns { date, added, updated, failed, total, errors, results }.
 */
function saveBulkCollections(db, data, userId = null) {
    const date = String(data.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid collection date (YYYY-MM-DD) is required.');
    const shift = String(data.shift || 'morning');
    const routeId = data.route_id ? Number(data.route_id) : null;
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) throw new Error('No rows to save.');

    const { resolveMilkRate, rateOverrideError } = require('./rates');

    const errors = [];
    const results = [];
    let added = 0, updated = 0, failed = 0;

    // ── Pre-validation (row level, before touching the DB) ──
    // Rows rejected here count as failed: they are reported, never saved.
    const prepared = rows.map((r, i) => {
        const rowNo = i + 1;
        const party = resolveParty(db, r);
        if (!party) {
            errors.push(_rowError(rowNo, r.party_name || r.party_id, 'Unknown farmer/party'));
            return null;
        }
        const qty = round2(r.quantity_liters);
        if (!(qty > 0)) {
            errors.push(_rowError(rowNo, party.name, 'Quantity must be greater than zero'));
            return null;
        }
        const milkType = String(r.milk_type || 'cow').toLowerCase();
        return {
            rowNo, party, qty, milkType, fat: round2(r.fat_percent || 0), snf: round2(r.snf_percent || 0),
            explicitRate: round2(r.rate || 0), notes: r.notes || '',
            rateType: r.rate_type || '', fixedRate: r.fixed_rate != null ? r.fixed_rate : null,
            overrideReason: String(r.rate_override_reason || r.override_reason || '').trim()
        };
    }).filter(Boolean);

    const trx = db.transaction(() => {
        for (const p of prepared) {
            try {
                const existing = findExistingCollection(db, {
                    date, shift: shift, party_id: p.party.id, milk_type: p.milkType, route_id: routeId
                });
                // One authoritative price per row: the supplier's own chart
                // (falls back to the plant chart). Explicit row rate wins only
                // when it is not an unexplained deviation.
                const resolved = resolveMilkRate(db, {
                    date, party_id: p.party.id, milk_type: p.milkType,
                    fat: p.fat, snf: p.snf, rate: p.explicitRate > 0 ? p.explicitRate : null,
                    rate_override_reason: p.overrideReason
                });
                const overrideError = rateOverrideError(db, {
                    date, party_id: p.party.id, milk_type: p.milkType,
                    fat: p.fat, snf: p.snf, rate: p.explicitRate > 0 ? p.explicitRate : null,
                    rate_type: p.rateType, fixed_rate: p.fixedRate,
                    rate_override_reason: p.overrideReason
                });
                if (overrideError) throw new Error(overrideError);
                const chart = resolved.chart || {};
                const calcRate = resolved.calculated_rate;
                const rate = p.explicitRate > 0 ? p.explicitRate : calcRate;
                const payload = {
                    id: existing ? existing.id : undefined,
                    collection_no: existing ? existing.collection_no : nextCollectionNo(db, date),
                    date,
                    party_id: p.party.id,
                    milk_type: p.milkType,
                    quantity_liters: p.qty,
                    fat_percent: p.fat,
                    snf_percent: p.snf,
                    rate,
                    amount: round2(rate * p.qty),
                    shift,
                    status: 'pending',   // schema CHECK: pending|processed|paid
                    notes: p.notes,
                    route_id: routeId,
                    rate_type: p.rateType || chart.rate_type || 'formula',
                    fat_multiplier: chart.fat_multiplier,
                    snf_multiplier: chart.snf_multiplier,
                    calculated_rate: calcRate,
                    rate_override_reason: p.overrideReason || ''
                };
                const res = require('./milk').saveMilkCollection(db, payload, userId);
                const id = res && res.id ? res.id : (existing ? existing.id : res);
                results.push({ id, collection_no: payload.collection_no, party: p.party.name, status: existing ? 'updated' : 'added' });
                if (existing) updated++; else added++;
            } catch (e) {
                failed++;
                errors.push(_rowError(p.rowNo, p.party.name, e.message || String(e)));
            }
        }
    });
    try {
        trx();
    } catch (e) {
        // Whole transaction rolled back by better-sqlite3 — surface clearly.
        throw new Error(`Bulk collection save rolled back: ${e.message}`);
    }
    failed += rows.length - prepared.length; // pre-validation rejects
    return { module: 'milk', date, shift, added, updated, failed, total: rows.length, valid: prepared.length, errors, results };
}

/**
 * Save all purchases for one date — each row stays an INDEPENDENT purchase
 * bill with its own number, items, ledger and stock movements.
 *
 * data: { date, rows: [{ party_id|party_name, product_id|product_name,
 *         quantity, rate, bill_no?, payment_mode?, status?, notes? }] }
 */
function saveBulkPurchases(db, data, userId = null) {
    const date = String(data.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid purchase date (YYYY-MM-DD) is required.');
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) throw new Error('No rows to save.');

    const errors = [];
    const results = [];
    let added = 0, failed = 0;

    const prepared = rows.map((r, i) => {
        const rowNo = i + 1;
        const party = resolveParty(db, r);
        if (!party) {
            errors.push(_rowError(rowNo, r.party_name || r.party_id, 'Unknown supplier/party'));
            return null;
        }
        const product = resolveProduct(db, r);
        if (!product) {
            errors.push(_rowError(rowNo, party.name, 'Unknown product'));
            return null;
        }
        const qty = round2(r.quantity);
        if (!(qty > 0)) {
            errors.push(_rowError(rowNo, party.name, 'Quantity must be greater than zero'));
            return null;
        }
        const rate = round2(r.rate);
        if (!(rate > 0)) {
            errors.push(_rowError(rowNo, party.name, 'Rate must be greater than zero'));
            return null;
        }
        return { rowNo, party, product, qty, rate, billNo: String(r.bill_no || '').trim(), paymentMode: r.payment_mode || 'credit', status: r.status || 'unpaid', notes: r.notes || '' };
    }).filter(Boolean);

    const trx = db.transaction(() => {
        for (const p of prepared) {
            try {
                const billNo = p.billNo || nextDocNo(db, 'purchases', 'bill_no', 'BULK-BILL', date);
                const amount = round2(p.qty * p.rate);
                const res = require('./purchases').savePurchase(db, {
                    bill_no: billNo,
                    date,
                    party_id: p.party.id,
                    items: [{ product_id: p.product.id, product_name: p.product.name, quantity: p.qty, unit: p.product.unit || 'liter', rate: p.rate, amount }],
                    subtotal: amount, discount: 0, tax: 0,
                    transport_charges: 0, extra_charges: 0,
                    grand_total: amount, paid_amount: 0,
                    payment_mode: p.paymentMode, status: p.status, notes: p.notes,
                    created_by: userId
                }, userId);
                const id = res && res.id ? res.id : res;
                results.push({ id, bill_no: billNo, party: p.party.name, status: 'added' });
                added++;
            } catch (e) {
                failed++;
                errors.push(_rowError(p.rowNo, p.party.name, e.message || String(e)));
            }
        }
    });
    try {
        trx();
    } catch (e) {
        throw new Error(`Bulk purchase save rolled back: ${e.message}`);
    }
    return { module: 'purchases', date, added, updated: 0, failed, total: rows.length, valid: prepared.length, errors, results };
}

/**
 * Save all sales for one date — one invoice per row (single-item invoice),
 * preserving the existing invoice architecture, FIFO lot COGS included.
 *
 * data: { date, rows: [{ party_id|party_name, product_id|product_name,
 *         quantity, rate, invoice_no?, payment_mode?, status?, notes? }] }
 */
function saveBulkSales(db, data, userId = null) {
    const date = String(data.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('A valid sales date (YYYY-MM-DD) is required.');
    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (!rows.length) throw new Error('No rows to save.');

    const errors = [];
    const results = [];
    let added = 0, failed = 0;

    const prepared = rows.map((r, i) => {
        const rowNo = i + 1;
        const party = resolveParty(db, r);
        if (!party) {
            errors.push(_rowError(rowNo, r.party_name || r.party_id, 'Unknown customer/party'));
            return null;
        }
        const product = resolveProduct(db, r);
        if (!product) {
            errors.push(_rowError(rowNo, party.name, 'Unknown product'));
            return null;
        }
        const qty = round2(r.quantity);
        if (!(qty > 0)) {
            errors.push(_rowError(rowNo, party.name, 'Quantity must be greater than zero'));
            return null;
        }
        const rate = round2(r.rate);
        if (!(rate > 0)) {
            errors.push(_rowError(rowNo, party.name, 'Rate must be greater than zero'));
            return null;
        }
        return { rowNo, party, product, qty, rate, invoiceNo: String(r.invoice_no || '').trim(), paymentMode: r.payment_mode || 'credit', status: r.status || 'unpaid', notes: r.notes || '' };
    }).filter(Boolean);

    const trx = db.transaction(() => {
        for (const p of prepared) {
            try {
                const invoiceNo = p.invoiceNo || nextDocNo(db, 'sales', 'invoice_no', 'BULK-INV', date);
                const amount = round2(p.qty * p.rate);
                const res = require('./sales').saveSale(db, {
                    invoice_no: invoiceNo,
                    date,
                    party_id: p.party.id,
                    items: [{ product_id: p.product.id, product_name: p.product.name, quantity: p.qty, unit: p.product.unit || 'kg', rate: p.rate, amount }],
                    subtotal: amount, discount: 0, discount_percent: 0, tax: 0,
                    grand_total: amount, paid_amount: 0,
                    payment_mode: p.paymentMode, status: p.status, notes: p.notes,
                    created_by: userId
                }, userId);
                const id = res && res.id ? res.id : res;
                results.push({ id, invoice_no: invoiceNo, party: p.party.name, status: 'added' });
                added++;
            } catch (e) {
                failed++;
                errors.push(_rowError(p.rowNo, p.party.name, e.message || String(e)));
            }
        }
    });
    try {
        trx();
    } catch (e) {
        throw new Error(`Bulk sales save rolled back: ${e.message}`);
    }
    return { module: 'sales', date, added, updated: 0, failed, total: rows.length, valid: prepared.length, errors, results };
}

/** Load a date's existing milk collections into the bulk grid (spec §14). */
function loadBulkCollections(db, { date, shift } = {}) {
    const d = String(date || '').trim();
    if (!d) throw new Error('Date is required.');
    let query = `
        SELECT mc.*, p.name AS party_name FROM milk_collections mc
        LEFT JOIN parties p ON p.id = mc.party_id
        WHERE mc.date = ?`;
    const params = [d];
    if (shift) { query += ' AND IFNULL(mc.shift,\'\') = ?'; params.push(shift); }
    query += ' ORDER BY p.name, mc.id';
    return db.prepare(query).all(...params);
}

/** Load a date's existing sales (with single-item details) for the bulk grid. */
function loadBulkSales(db, { date } = {}) {
    const d = String(date || '').trim();
    if (!d) throw new Error('Date is required.');
    return db.prepare(`
        SELECT s.id, s.invoice_no, s.date, s.party_id, p.name AS party_name,
               si.product_id, si.product_name, si.quantity, si.rate, si.amount,
               s.payment_mode, s.status
        FROM sales s
        LEFT JOIN parties p ON p.id = s.party_id
        LEFT JOIN sales_items si ON si.sale_id = s.id
        WHERE s.date = ?
        ORDER BY p.name, s.id
    `).all(d);
}

/** Load a date's existing purchases (with single-item details) for the bulk grid. */
function loadBulkPurchases(db, { date } = {}) {
    const d = String(date || '').trim();
    if (!d) throw new Error('Date is required.');
    return db.prepare(`
        SELECT pr.id, pr.bill_no, pr.date, pr.party_id, p.name AS party_name,
               pi.product_id, pi.product_name, pi.quantity, pi.rate, pi.amount,
               pr.payment_mode, pr.status
        FROM purchases pr
        LEFT JOIN parties p ON p.id = pr.party_id
        LEFT JOIN purchase_items pi ON pi.purchase_id = pr.id
        WHERE pr.date = ?
        ORDER BY p.name, pr.id
    `).all(d);
}

module.exports = {
    saveBulkCollections,
    saveBulkPurchases,
    saveBulkSales,
    loadBulkCollections,
    loadBulkSales,
    loadBulkPurchases,
    resolveParty,
    resolveProduct
};
