/**
 * Prarambha Account & Stock Management — Purchase vs Sales Report
 * ==============================================================
 * One question, answered from the original transaction tables:
 * what did we buy, what did we sell, day by day and party by party?
 *
 * Data sources — original transaction documents only:
 *   Purchases → `purchases` (the Purchase_Entry source) + `purchase_items`.
 *               A milk bill has no purchase_items rows: its liters live in the
 *               milk register, so the bill's own `milk_collections` rows
 *               (milk_collections.purchase_ref_id = the bill) supply quantity
 *               and product. That is the existing dairy purchase/milk-collection
 *               structure — not a second transaction source.
 *   Sales     → `sales` (the Sales_Entry source) + `sales_items`.
 *
 * Deliberately NOT used: `ledger_entries` / Party_Ledger (a derived ledger, not
 * a transaction source), `payments` (a payment to a supplier is not a purchase;
 * a collection from a customer is not a sale — they are only read to settle the
 * payment status of a sales invoice, never to add amount).
 *
 * Dates: the transaction's own `date`. Never a payment/collection date, and
 * deliberately not `accounting_date` (a period-allocation field, not the
 * business date this report compares).
 *
 * The difference is a trading gap (Sales − Purchase), NOT profit: operating
 * expenses, stock changes, other income and accounting adjustments are outside
 * this report.
 */

const bsCalendar = require('../bs-calendar');
const { lineDisplayUnit } = require('./unit_conversion');
const { round2, getSaleSettlements } = require('./accounting');

/** Milk collection type → the product name the purchase report shows. */
const MILK_PRODUCTS = { cow: 'Cow Milk', buffalo: 'Buffalo Milk', mixed: 'Mixed Milk' };
const MILK_UNIT = 'L';

/** Fill zero-activity days only for ranges that fit in a readable table. */
const MAX_FILLED_DAYS = 366;

/** How many line rows a filtered request may carry back to the UI. */
const MAX_LINES = 200000;

function milkProduct(milkType) {
    const key = String(milkType || '').toLowerCase();
    return MILK_PRODUCTS[key] || 'Milk';
}

/** Stored status, or a status derived from the amounts when none is stored. */
function purchaseStatus(doc) {
    const stored = String(doc.status || '').trim().toLowerCase();
    if (stored === 'paid' || stored === 'unpaid' || stored === 'partial') return stored;
    const total = Number(doc.grand_total) || 0;
    const paid = Number(doc.paid_amount) || 0;
    if (total > 0 && paid >= total - 0.005) return 'paid';
    if (paid > 0.005) return 'partial';
    return 'unpaid';
}

function partyLabel(id, name) {
    if (name) return name;
    return id == null ? 'Unassigned' : 'Party #' + id;
}

/**
 * Every BS date in an inclusive range, or [] when the range is unusable.
 * @private
 */
function enumerateDays(from, to) {
    const a = bsCalendar.parseBSDate(from);
    const b = bsCalendar.parseBSDate(to);
    if (!a || !b) return [];
    const start = bsCalendar.bsDayNumber(a.year, a.month, a.day);
    const end = bsCalendar.bsDayNumber(b.year, b.month, b.day);
    if (!(end >= start)) return [];
    const out = [];
    let cur = bsCalendar.normalizeBSDate(from);
    for (let n = start; n <= end && cur; n++) {
        out.push(cur);
        if (out.length >= MAX_FILLED_DAYS) break;
        cur = n < end ? bsCalendar.addBSDays(cur, 1) : null;
    }
    return out;
}

/** Sum a set of line rows into amount / quantity / document count. */
function summarizeLines(lines) {
    let amount = 0;
    let quantity = 0;
    const documents = new Set();
    const units = {};
    for (const line of lines) {
        amount = round2(amount + (Number(line.amount) || 0));
        quantity = round2(quantity + (Number(line.quantity) || 0));
        if (line.document_id != null) documents.add(Number(line.document_id));
        if (line.unit && Number(line.quantity)) {
            units[line.unit] = round2((units[line.unit] || 0) + Number(line.quantity));
        }
    }
    const unitKeys = Object.keys(units);
    return {
        amount,
        quantity,
        transactions: documents.size,
        lines: lines.length,
        units,
        // A single physical unit can be labelled on the card; a mixture cannot.
        quantity_unit: unitKeys.length === 1 ? unitKeys[0] : (unitKeys.length ? 'mixed' : '')
    };
}

/**
 * Daily Purchase vs Sales report.
 *
 * @param {object} db  better-sqlite3 database
 * @param {object} opts
 *   from_date, to_date      — BS 'YYYY-MM-DD' bounds (inclusive, from `date`)
 *   purchase_party_id       — supplier filter (purchases only)
 *   sales_party_id          — customer filter (sales only)
 *   product                 — item / product text filter (either side)
 *   reference               — bill_no / invoice_no text filter (either side)
 *   payment_mode            — cash | credit | bank | upi (either side)
 *   include_zero_days       — default true: fill days with no activity
 */
function getPurchaseVsSales(db, opts = {}) {
    const from = String(opts.from_date || '').trim();
    const to = String(opts.to_date || '').trim();

    // A BS date is a string comparison in this database — validate it as a real
    // calendar date first so an impossible bound cannot silently return nothing.
    if (from) {
        const check = bsCalendar.validateBSDate(from);
        if (!check.valid) throw new Error('From date: ' + check.reason);
    }
    if (to) {
        const check = bsCalendar.validateBSDate(to);
        if (!check.valid) throw new Error('To date: ' + check.reason);
    }
    if (from && to && from > to) throw new Error('From date must be on or before the to date');

    const purchasePartyId = opts.purchase_party_id ? Number(opts.purchase_party_id) : null;
    const salesPartyId = opts.sales_party_id ? Number(opts.sales_party_id) : null;
    const productFilter = String(opts.product || '').trim().toLowerCase();
    const referenceFilter = String(opts.reference || '').trim().toLowerCase();
    const modeFilter = String(opts.payment_mode || '').trim().toLowerCase();
    const includeZeroDays = opts.include_zero_days !== false && opts.include_zero_days !== 'false';

    // ── Shared filter fragments ──────────────────────────────────────────────
    // Every query below applies the same date / party / mode conditions so the
    // document rows and their item rows can never describe different records.
    const rangeSql = [];
    const rangeParams = [];
    if (from) { rangeSql.push(' AND pr.date >= ?'); rangeParams.push(from); }
    if (to) { rangeSql.push(' AND pr.date <= ?'); rangeParams.push(to); }
    if (purchasePartyId) { rangeSql.push(' AND pr.party_id = ?'); rangeParams.push(purchasePartyId); }
    if (modeFilter) { rangeSql.push(' AND pr.payment_mode = ?'); rangeParams.push(modeFilter); }

    const salesRangeSql = [];
    const salesRangeParams = [];
    if (from) { salesRangeSql.push(' AND s.date >= ?'); salesRangeParams.push(from); }
    if (to) { salesRangeSql.push(' AND s.date <= ?'); salesRangeParams.push(to); }
    if (salesPartyId) { salesRangeSql.push(' AND s.party_id = ?'); salesRangeParams.push(salesPartyId); }
    if (modeFilter) { salesRangeSql.push(' AND s.payment_mode = ?'); salesRangeParams.push(modeFilter); }

    // ── Purchase documents (Purchase_Entry source) ───────────────────────────
    const purchaseDocs = db.prepare(`
        SELECT pr.id, pr.bill_no, pr.date, pr.party_id,
               COALESCE(p.name, '') AS party_name,
               pr.grand_total, pr.paid_amount, pr.payment_mode, pr.status
          FROM purchases pr
          LEFT JOIN parties p ON p.id = pr.party_id
         WHERE 1=1 ${rangeSql.join('')}
         ORDER BY pr.date ASC, pr.id ASC
    `).all(...rangeParams);

    const purchaseItems = db.prepare(`
        SELECT pi.purchase_id, pi.product_name, pi.quantity, pi.unit, pi.rate, pi.amount,
               pi.stock_quantity, pi.stock_unit
          FROM purchase_items pi
          JOIN purchases pr ON pr.id = pi.purchase_id
         WHERE 1=1 ${rangeSql.join('')}
         ORDER BY pi.purchase_id ASC, pi.id ASC
    `).all(...rangeParams);

    // Milk bills: the quantity lives in the milk register, keyed to the bill.
    const milkRows = db.prepare(`
        SELECT mc.purchase_ref_id AS purchase_id, mc.milk_type,
               SUM(mc.quantity_liters) AS quantity,
               SUM(mc.amount) AS amount
          FROM milk_collections mc
          JOIN purchases pr ON pr.id = mc.purchase_ref_id
         WHERE 1=1 ${rangeSql.join('')}
         GROUP BY mc.purchase_ref_id, mc.milk_type
    `).all(...rangeParams);

    // ── Sales documents (Sales_Entry source) ─────────────────────────────────
    const salesDocs = db.prepare(`
        SELECT s.id, s.invoice_no, s.date, s.party_id,
               COALESCE(p.name, '') AS party_name,
               s.grand_total, s.paid_amount, s.payment_mode, s.status
          FROM sales s
          LEFT JOIN parties p ON p.id = s.party_id
         WHERE 1=1 ${salesRangeSql.join('')}
         ORDER BY s.date ASC, s.id ASC
    `).all(...salesRangeParams);

    const salesItems = db.prepare(`
        SELECT si.sale_id, si.product_name, si.quantity, si.unit, si.rate, si.amount,
               si.stock_quantity, si.stock_unit
          FROM sales_items si
          JOIN sales s ON s.id = si.sale_id
         WHERE 1=1 ${salesRangeSql.join('')}
         ORDER BY si.sale_id ASC, si.id ASC
    `).all(...salesRangeParams);

    // Payment status of a sales invoice follows the money actually received —
    // the same derivation the Sales screen and party statement use.
    let saleSettlements = new Map();
    try {
        const settled = getSaleSettlements(db, {});
        if (settled && settled.by_id) saleSettlements = settled.by_id;
    } catch (e) {
        // Older database without receipts support: fall back to the stored status.
    }

    // ── Group item rows by their document ────────────────────────────────────
    const itemsByPurchase = new Map();
    for (const row of purchaseItems) {
        const id = Number(row.purchase_id);
        if (!itemsByPurchase.has(id)) itemsByPurchase.set(id, []);
        itemsByPurchase.get(id).push(row);
    }
    const milkByPurchase = new Map();
    for (const row of milkRows) {
        const id = Number(row.purchase_id);
        if (!milkByPurchase.has(id)) milkByPurchase.set(id, []);
        milkByPurchase.get(id).push(row);
    }
    const itemsBySale = new Map();
    for (const row of salesItems) {
        const id = Number(row.sale_id);
        if (!itemsBySale.has(id)) itemsBySale.set(id, []);
        itemsBySale.get(id).push(row);
    }

    // ── Build line rows ──────────────────────────────────────────────────────
    // A line is the smallest record the report shows. The sum of a document's
    // lines always equals that document's grand_total: when the stored item
    // rows do not add up (bill charges, discounts, an imported bill with its
    // own total) the difference is carried by an explicit adjustment line, so
    // nothing is silently lost or invented.
    const purchaseLines = [];
    for (const doc of purchaseDocs) {
        const its = itemsByPurchase.get(Number(doc.id)) || [];
        const milks = milkByPurchase.get(Number(doc.id)) || [];
        const base = {
            side: 'purchase',
            document_id: Number(doc.id),
            date: doc.date,
            party_id: doc.party_id == null ? null : Number(doc.party_id),
            party_name: partyLabel(doc.party_id, doc.party_name),
            reference: doc.bill_no || '',
            status: purchaseStatus(doc),
            payment_mode: doc.payment_mode || ''
        };
        let allocated = 0;
        let added = 0;

        for (const item of its) {
            const amount = round2(item.amount);
            const quantity = round2(item.quantity);
            // Placeholder item rows written by old milk-bill imports carry no
            // quantity and no amount (the litres live on the milk collection).
            // They add nothing to any total, so they are not shown as records.
            if (amount === 0 && quantity === 0) continue;
            purchaseLines.push({
                ...base,
                product: item.product_name || 'Item',
                quantity,
                unit: lineDisplayUnit(item),
                rate: round2(item.rate),
                amount,
                source: 'purchase_items'
            });
            added++;
            allocated = round2(allocated + amount);
        }
        for (const milk of milks) {
            const quantity = round2(milk.quantity);
            const amount = round2(milk.amount);
            purchaseLines.push({
                ...base,
                product: milkProduct(milk.milk_type),
                quantity,
                unit: MILK_UNIT,
                rate: quantity > 0 ? round2(amount / quantity) : 0,
                amount,
                source: 'milk_collections'
            });
            added++;
            allocated = round2(allocated + amount);
        }

        const total = round2(doc.grand_total);
        // A bill with no usable detail row (imported total only, or only
        // placeholder items) is shown as one bill-total line.
        if (added === 0) {
            purchaseLines.push({
                ...base,
                product: 'Purchase bill (no item detail)',
                quantity: 0,
                unit: '',
                rate: 0,
                amount: total,
                source: 'bill_total'
            });
        } else {
            const difference = round2(total - allocated);
            if (difference !== 0) {
                purchaseLines.push({
                    ...base,
                    product: 'Bill charges / adjustment',
                    quantity: 0,
                    unit: '',
                    rate: 0,
                    amount: difference,
                    source: 'adjustment'
                });
            }
        }
    }

    const salesLines = [];
    for (const doc of salesDocs) {
        const its = itemsBySale.get(Number(doc.id)) || [];
        const settlement = saleSettlements.get(Number(doc.id));
        const base = {
            side: 'sales',
            document_id: Number(doc.id),
            date: doc.date,
            party_id: doc.party_id == null ? null : Number(doc.party_id),
            party_name: partyLabel(doc.party_id, doc.party_name),
            reference: doc.invoice_no || '',
            status: settlement ? settlement.status : purchaseStatus(doc),
            payment_mode: doc.payment_mode || ''
        };
        let allocated = 0;
        let added = 0;
        for (const item of its) {
            const amount = round2(item.amount);
            // A zero-quantity, zero-amount placeholder row is not a sold record.
            if (amount === 0 && round2(item.quantity) === 0) continue;
            salesLines.push({
                ...base,
                product: item.product_name || 'Item',
                quantity: round2(item.quantity),
                unit: lineDisplayUnit(item),
                rate: round2(item.rate),
                amount,
                source: 'sales_items'
            });
            added++;
            allocated = round2(allocated + amount);
        }
        const total = round2(doc.grand_total);
        if (added === 0) {
            salesLines.push({
                ...base,
                product: 'Sales invoice (no item detail)',
                quantity: 0,
                unit: '',
                rate: 0,
                amount: total,
                source: 'bill_total'
            });
        } else {
            const difference = round2(total - allocated);
            if (difference !== 0) {
                salesLines.push({
                    ...base,
                    product: 'Invoice discount / adjustment',
                    quantity: 0,
                    unit: '',
                    rate: 0,
                    amount: difference,
                    source: 'adjustment'
                });
            }
        }
    }

    // ── Reconciliation against the document totals ───────────────────────────
    // Computed before any product/reference filter, so it always compares the
    // whole filtered period with the original documents.
    // Money precision policy (same as the rest of the app): every aggregate is
    // Σ round2(row), so a document total and the sum of its lines compare as
    // stored 2-dp values instead of accumulated float noise.
    const purchaseDocumentTotal = round2(purchaseDocs.reduce((sum, d) => sum + round2(d.grand_total), 0));
    const salesDocumentTotal = round2(salesDocs.reduce((sum, d) => sum + round2(d.grand_total), 0));
    const purchaseLineTotal = round2(purchaseLines.reduce((sum, l) => sum + l.amount, 0));
    const salesLineTotal = round2(salesLines.reduce((sum, l) => sum + l.amount, 0));

    // Filter options are taken from the period BEFORE the line filters, so the
    // dropdown never narrows to the value the user just picked.
    const toOptions = (lines) => {
        const parties = new Map();
        const products = new Set();
        for (const line of lines) {
            if (line.party_id != null && !parties.has(line.party_id)) {
                parties.set(line.party_id, line.party_name);
            }
            if (line.product) products.add(line.product);
        }
        return {
            parties: [...parties.entries()]
                .map(([id, name]) => ({ id, name }))
                .sort((a, b) => String(a.name).localeCompare(String(b.name))),
            products: [...products].sort((a, b) => String(a).localeCompare(String(b)))
        };
    };
    const purchaseOptions = toOptions(purchaseLines);
    const salesOptions = toOptions(salesLines);

    // ── Apply the product / reference filters (line level) ───────────────────
    const matchesLine = (line) => {
        if (productFilter && !String(line.product || '').toLowerCase().includes(productFilter)) return false;
        if (referenceFilter && !String(line.reference || '').toLowerCase().includes(referenceFilter)) return false;
        return true;
    };
    const filteredPurchaseLines = purchaseLines.filter(matchesLine).slice(0, MAX_LINES);
    const filteredSalesLines = salesLines.filter(matchesLine).slice(0, MAX_LINES);

    // ── Summary ──────────────────────────────────────────────────────────────
    const purchaseSummary = summarizeLines(filteredPurchaseLines);
    const salesSummary = summarizeLines(filteredSalesLines);
    const difference = round2(salesSummary.amount - purchaseSummary.amount);

    // ── Daily comparison ─────────────────────────────────────────────────────
    const purchaseDaily = new Map();   // date → {amount, quantity, units, docs:Set}
    const salesDaily = new Map();
    const collectDaily = (map, lines) => {
        for (const line of lines) {
            if (!map.has(line.date)) map.set(line.date, { amount: 0, quantity: 0, units: {}, docs: new Set() });
            const bucket = map.get(line.date);
            bucket.amount = round2(bucket.amount + line.amount);
            bucket.quantity = round2(bucket.quantity + line.quantity);
            // Keep each day's quantity per unit: a day that bought 20 L and
            // 5 kg must never present 25 as one quantity.
            if (line.unit && Number(line.quantity)) {
                bucket.units[line.unit] = round2((bucket.units[line.unit] || 0) + Number(line.quantity));
            }
            bucket.docs.add(line.document_id);
        }
    };
    collectDaily(purchaseDaily, filteredPurchaseLines);
    collectDaily(salesDaily, filteredSalesLines);

    const dailyMap = new Map();
    const seed = (map, side) => {
        for (const [date, bucket] of map) {
            if (!dailyMap.has(date)) dailyMap.set(date, emptyDay(date));
            const row = dailyMap.get(date);
            row[side + '_amount'] = bucket.amount;
            row[side + '_quantity'] = bucket.quantity;
            row[side + '_count'] = bucket.docs.size;
            row[side + '_units'] = bucket.units;
            const keys = Object.keys(bucket.units);
            row[side + '_quantity_unit'] = keys.length === 1 ? keys[0] : (keys.length ? 'mixed' : '');
        }
    };
    seed(purchaseDaily, 'purchase');
    seed(salesDaily, 'sales');

    // Days with no activity inside the range are part of the comparison.
    let span = 0;
    if (from && to) {
        const startPart = bsCalendar.parseBSDate(from);
        const endPart = bsCalendar.parseBSDate(to);
        if (startPart && endPart) {
            span = bsCalendar.bsDayNumber(endPart.year, endPart.month, endPart.day)
                - bsCalendar.bsDayNumber(startPart.year, startPart.month, startPart.day) + 1;
        }
    }
    let zeroDaysFilled = false;
    if (includeZeroDays && span > 0 && span <= MAX_FILLED_DAYS) {
        for (const date of enumerateDays(from, to)) {
            if (!dailyMap.has(date)) dailyMap.set(date, emptyDay(date));
        }
        zeroDaysFilled = true;
    }

    const daily = [...dailyMap.values()]
        .map(row => ({
            ...row,
            difference: round2(row.sales_amount - row.purchase_amount)
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // ── Party-wise summaries ─────────────────────────────────────────────────
    const partySummary = (lines) => {
        const map = new Map();
        for (const line of lines) {
            const key = line.party_id == null ? 'none' : String(line.party_id);
            if (!map.has(key)) {
                map.set(key, {
                    party_id: line.party_id,
                    party_name: line.party_name,
                    amount: 0,
                    quantity: 0,
                    units: {},
                    docs: new Set()
                });
            }
            const row = map.get(key);
            row.amount = round2(row.amount + line.amount);
            row.quantity = round2(row.quantity + line.quantity);
            if (line.unit && Number(line.quantity)) row.units[line.unit] = round2((row.units[line.unit] || 0) + Number(line.quantity));
            row.docs.add(line.document_id);
        }
        return [...map.values()]
            .map(row => {
                const unitKeys = Object.keys(row.units);
                return {
                    party_id: row.party_id,
                    party_name: row.party_name,
                    transactions: row.docs.size,
                    quantity: row.quantity,
                    units: row.units,
                    quantity_unit: unitKeys.length === 1 ? unitKeys[0] : (unitKeys.length ? 'mixed' : ''),
                    amount: row.amount
                };
            })
            .sort((a, b) => b.amount - a.amount || String(a.party_name).localeCompare(String(b.party_name)));
    };

    const purchaseParties = partySummary(filteredPurchaseLines);
    const salesParties = partySummary(filteredSalesLines);

    return {
        from_date: from,
        to_date: to,
        filters: {
            purchase_party_id: purchasePartyId,
            sales_party_id: salesPartyId,
            product: opts.product || '',
            reference: opts.reference || '',
            payment_mode: modeFilter,
            include_zero_days: includeZeroDays
        },
        summary: {
            purchase_amount: purchaseSummary.amount,
            sales_amount: salesSummary.amount,
            difference,
            purchase_quantity: purchaseSummary.quantity,
            sales_quantity: salesSummary.quantity,
            purchase_quantity_unit: purchaseSummary.quantity_unit,
            sales_quantity_unit: salesSummary.quantity_unit,
            purchase_transactions: purchaseSummary.transactions,
            sales_transactions: salesSummary.transactions,
            purchase_parties: purchaseParties.length,
            sales_parties: salesParties.length,
            purchase_line_count: filteredPurchaseLines.length,
            sales_line_count: filteredSalesLines.length
        },
        daily,
        purchase_parties: purchaseParties,
        sales_parties: salesParties,
        purchase_lines: filteredPurchaseLines,
        sales_lines: filteredSalesLines,
        options: {
            purchase_parties: purchaseOptions.parties,
            sales_parties: salesOptions.parties,
            products: [...new Set([...purchaseOptions.products, ...salesOptions.products])]
                .sort((a, b) => String(a).localeCompare(String(b)))
        },
        reconciliation: {
            purchase_document_total: purchaseDocumentTotal,
            purchase_line_total: purchaseLineTotal,
            sales_document_total: salesDocumentTotal,
            sales_line_total: salesLineTotal,
            purchase_delta: round2(purchaseLineTotal - purchaseDocumentTotal),
            sales_delta: round2(salesLineTotal - salesDocumentTotal),
            purchase_documents: purchaseDocs.length,
            sales_documents: salesDocs.length,
            purchase_reconciled: Math.abs(purchaseLineTotal - purchaseDocumentTotal) < 0.05,
            sales_reconciled: Math.abs(salesLineTotal - salesDocumentTotal) < 0.05
        },
        day_count: daily.length,
        zero_days_filled: zeroDaysFilled,
        range_span_days: span
    };
}

/** Empty daily row — one shape for every date the report returns. */
function emptyDay(date) {
    return {
        date,
        purchase_amount: 0,
        sales_amount: 0,
        difference: 0,
        purchase_quantity: 0,
        sales_quantity: 0,
        purchase_count: 0,
        sales_count: 0,
        purchase_units: {},
        sales_units: {},
        purchase_quantity_unit: '',
        sales_quantity_unit: ''
    };
}

module.exports = {
    getPurchaseVsSales,
    milkProduct,
    purchaseStatus
};
