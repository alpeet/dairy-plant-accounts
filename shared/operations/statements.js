/**
 * Prarambha Account & Stock Management — Customer/Supplier Statement Operations
 * ==============================================================
 * Generates party-wise statements with opening balance, debit/credit,
 * running balance, and closing balance for a given date range.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { todayBSDate } = require('../excel-import');
const partyLedger = require('./party_ledger');
const accountingDates = require('./accounting_dates');

// ── Number formatting helpers for statement display ──
// Kill floating-point noise (97.64999999999999 → "97.65") and trim needless
// trailing zeros (93.00 → "93"). Amounts keep exactly two decimals.
function round2(v) {
    const n = Number(v);
    return isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function trimNum(v, maxDp = 2) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    let s = n.toFixed(maxDp);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
}

function money2(v) {
    const n = round2(v);
    try {
        return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
        return n.toFixed(2);
    }
}

/**
 * Consolidated statement helpers.
 *
 * The statement is a REPORT: ledger rows plus any register row that is not
 * already represented in the ledger (petty cash, expenses). Nothing is copied
 * into a second table; source_table/source_id stay attached so every line can
 * be opened at its original record.
 */
const LEDGER_SOURCE = {
    sale: 'Sales',
    purchase: 'Purchases',
    milk_collection: 'Milk Collection',
    payment_received: 'Payment',
    payment_made: 'Payment',
    advance: 'Advance',
    adjustment: 'Adjustment',
    opening: 'Opening'
};

/** A ledger row still carries its own transaction/accounting dates. */
function normaliseLedgerEntry(e) {
    const description = String(e.description || '');
    let source = LEDGER_SOURCE[e.reference_type] || e.reference_type || '';
    let displayType = e.reference_type;

    // Registers that post a tagged adjustment (petty cash, expenses) are
    // labelled as the module they came from, not as a generic adjustment.
    if (e.reference_type === 'adjustment' && description.startsWith('PETTY:')) {
        source = 'Petty Cash';
        displayType = /\[Advance Receivable\]/.test(description) ? 'advance' : 'payment';
    } else if (e.reference_type === 'adjustment' && description.startsWith('EXPENSE:')) {
        source = 'Expenses';
        displayType = /\(bill\)/.test(description) ? 'expense' : 'expense_payment';
    } else if (e.reference_type === 'adjustment' && /Advance applied|Advance adjusted/i.test(description)) {
        source = 'Advance';
        displayType = 'advance_adjustment';
    } else if (e.reference_type === 'payment_received') {
        displayType = 'receipt';
        if (/\[Advance Receivable\]/.test(description)) { displayType = 'advance_returned'; source = 'Advance'; }
        else if (/\[Loan .*Receivable\]/.test(description)) { displayType = 'loan_repayment'; source = 'Payment'; }
        else if (/\[Loan .*Payable\]/.test(description)) { displayType = 'loan_received'; source = 'Payment'; }
    } else if (e.reference_type === 'payment_made') {
        displayType = 'payment';
        if (/\[Advance Receivable\]/.test(description)) { displayType = 'advance'; source = 'Advance'; }
        else if (/\[Loan .*Receivable\]/.test(description)) { displayType = 'loan_given'; source = 'Payment'; }
        else if (/\[Loan .*Payable\]/.test(description)) { displayType = 'loan_repayment'; source = 'Payment'; }
    }

    return {
        ...e,
        transaction_date: e.date,
        accounting_date: e.accounting_date || e.date,
        source_module: source,
        statement_type: displayType
    };
}

/** True when the ledger already carries this register row (never double it). */
function ledgerCoversDerived(ledger, d) {
    return ledger.some(e => {
        if (d.source_table === 'payments') {
            return ['payment_made', 'payment_received', 'adjustment', 'advance'].includes(e.reference_type)
                && Number(e.reference_id) === Number(d.source_id);
        }
        if (d.source_table === 'petty_cash') {
            if (e.reference_type === 'adjustment'
                && String(e.description || '').startsWith('PETTY:')
                && Number(e.reference_id) === Number(d.source_id)) return true;
            // A voucher that lives in the Payment / Advance register is already
            // on the account through its own payment row (posted by the importer
            // and by savePayment). The petty-cash row beside it records the cash
            // box only — deriving it too would show the same payment twice.
            if (d.party_id && d.amount != null) {
                const amount = Number(d.amount) || 0;
                return ledger.some(x => Number(x.party_id) === Number(d.party_id)
                    && String(x.date) === String(d.date)
                    && ['payment_made', 'advance'].includes(x.reference_type)
                    && Math.abs((Number(x.debit) || 0) - amount) < 0.005);
            }
            return false;
        }
        if (d.source_table === 'other_expenses') {
            const isBill = d.type === 'expense';
            return e.reference_type === 'adjustment'
                && String(e.description || '').startsWith('EXPENSE:')
                && Number(e.reference_id) === Number(d.source_id)
                && (isBill === /\(bill\)/.test(String(e.description || '')));
        }
        const refType = d.type === 'sale' ? 'sale' : d.type === 'purchase' ? 'purchase'
            : d.type === 'milk_collection' ? 'milk_collection' : d.type;
        if (e.reference_type !== refType) return false;
        if (Number(e.reference_id) === Number(d.source_id)) return true;
        // Imported rows carry the bill/invoice NUMBER as text.
        return String(e.reference_id || '').trim() !== ''
            && String(e.reference_id).trim() === String(d.reference || '').trim()
            && String(e.date) === String(d.date);
    });
}

function titleCaseMilk(t) {
    const s = String(t || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

// ── Milk type / shift classification ─────────────────────────────────
// Statement rows carry the milk type and shift RECORDED on their own
// transaction (milk_collections for milk purchases and collections). A sales
// or goods line has no shift column, and its milk type is only taken from the
// product NAME when that name states one ("Cow Milk" → cow). Anything else
// stays unclassified — a missing value is never guessed.
const MILK_TYPE_VALUES = ['cow', 'buffalo', 'mixed'];

function classifyMilkType(explicit, productName) {
    const raw = String(explicit || '').trim().toLowerCase();
    if (MILK_TYPE_VALUES.includes(raw)) return raw;
    const name = String(productName || '').toLowerCase();
    if (/\bmix(ed)?\b/.test(name)) return 'mixed';
    if (/\bbuffalo\b/.test(name)) return 'buffalo';
    if (/\bcow\b/.test(name)) return 'cow';
    return '';
}

/** 'morning' / 'evening' / 'combined' only — never a made-up shift. */
function normaliseShift(s) {
    const v = String(s || '').trim().toLowerCase();
    return (v === 'morning' || v === 'evening' || v === 'combined') ? v : '';
}

/** One quantity bucket (purchases or sales) for the statement summary. */
function emptyQtyBucket() {
    return {
        total_qty: 0, by_unit: {},
        cow: 0, buffalo: 0, mixed: 0, other: 0,
        morning: 0, evening: 0, shift_unknown: 0,
        // Every figure also keeps its own per-unit split, so a report never
        // adds litres to kilograms and calls the result a quantity.
        cow_by_unit: {}, buffalo_by_unit: {}, mixed_by_unit: {},
        other_by_unit: {}, morning_by_unit: {}, evening_by_unit: {},
        shift_unknown_by_unit: {},
        rows: 0
    };
}

/**
 * Quantity summary for the statement, computed ONLY from the quantity lines of
 * the rows currently shown (so it follows every filter). Purchase litres and
 * sales litres are kept in separate buckets — they are never added together
 * into one "business quantity". Payment / advance / expense rows carry no
 * quantity lines and therefore cannot affect any total.
 */
function summariseQuantities(entries) {
    const purchase = emptyQtyBucket();
    const sales = emptyQtyBucket();
    const touched = { purchase: false, sale: false };
    // Item-wise totals: one row per product name AND unit. A litre and a
    // kilogram can never share a row, and two different products are never
    // summed into one figure.
    const itemTotals = new Map();

    for (const e of entries) {
        const lines = Array.isArray(e.qty_lines) ? e.qty_lines : [];
        for (const l of lines) {
            const qty = Number(l.quantity) || 0;
            if (!(qty > 0)) continue;
            const bucket = l.kind === 'sale' ? sales : purchase;
            touched[l.kind === 'sale' ? 'sale' : 'purchase'] = true;
            bucket.total_qty += qty;
            const itemName = String(l.product_name || '').trim();
            if (itemName) {
                const itemUnit = String(l.unit || '').trim();
                const ikey = itemName.toLowerCase() + '|' + itemUnit.toLowerCase();
                let row = itemTotals.get(ikey);
                if (!row) {
                    row = { name: itemName, unit: itemUnit, purchase_qty: 0, sale_qty: 0 };
                    itemTotals.set(ikey, row);
                }
                if (l.kind === 'sale') row.sale_qty += qty;
                else row.purchase_qty += qty;
            }
            const unit = String(l.unit || '').trim();
            const addUnit = (key) => {
                const map = bucket[key] || (bucket[key] = {});
                map[unit] = (map[unit] || 0) + qty;
            };
            addUnit('by_unit');
            if (MILK_TYPE_VALUES.includes(l.milk_type)) {
                bucket[l.milk_type] += qty;
                addUnit(l.milk_type + '_by_unit');
            } else {
                bucket.other += qty;
                addUnit('other_by_unit');
            }
            if (l.shift === 'morning') { bucket.morning += qty; addUnit('morning_by_unit'); }
            else if (l.shift === 'evening') { bucket.evening += qty; addUnit('evening_by_unit'); }
            else { bucket.shift_unknown += qty; addUnit('shift_unknown_by_unit'); }
        }
        if (lines.some(l => (Number(l.quantity) || 0) > 0)) {
            if (lines.some(l => l.kind === 'sale')) sales.rows++;
            if (lines.some(l => l.kind !== 'sale')) purchase.rows++;
        }
    }

    const fields = ['total_qty', 'cow', 'buffalo', 'mixed', 'other', 'morning', 'evening', 'shift_unknown'];
    for (const b of [purchase, sales]) {
        for (const k of fields) b[k] = round2(b[k]);
        for (const k of Object.keys(b)) {
            if (!/_by_unit$/.test(k) && k !== 'by_unit') continue;
            for (const u of Object.keys(b[k])) b[k][u] = round2(b[k][u]);
        }
    }

    const units = [...new Set([...Object.keys(purchase.by_unit), ...Object.keys(sales.by_unit)])];
    const net = { total_qty: round2(sales.total_qty - purchase.total_qty), by_unit: {}, meaningful: false };
    for (const u of units) net.by_unit[u] = round2((sales.by_unit[u] || 0) - (purchase.by_unit[u] || 0));
    net.meaningful = touched.purchase && touched.sale && units.length === 1;

    const items = [...itemTotals.values()]
        .map(r => ({
            name: r.name, unit: r.unit,
            purchase_qty: round2(r.purchase_qty),
            sale_qty: round2(r.sale_qty)
        }))
        .filter(r => r.purchase_qty > 0 || r.sale_qty > 0)
        // Purchases first (biggest line first), then sales, then by name — a
        // stable order so two reports of the same data never shuffle rows.
        .sort((a, b) => (b.purchase_qty - a.purchase_qty)
            || (b.sale_qty - a.sale_qty)
            || a.name.localeCompare(b.name));

    return {
        purchase,
        sales,
        net,
        items,
        has_purchase: purchase.total_qty > 0,
        has_sales: sales.total_qty > 0,
        has_quantity: purchase.total_qty > 0 || sales.total_qty > 0
    };
}

/**
 * Format ONE milk transaction as statement particulars:
 *   "Buffalo Milk 240 L @91.45 | Fat 5.9 | SNF 8.5"
 * Quality fields (Fat / SNF / Addition) appear only when actually stored
 * (non-null, non-zero) for that transaction — never invented, never zero-filled.
 */
function formatMilkLine(m) {
    const type = titleCaseMilk(m.milk_type) || 'Milk';
    const parts = [`${type} Milk ${trimNum(m.quantity_liters)} L @${trimNum(m.rate)}`];
    if (m.fat_percent != null && Number(m.fat_percent) !== 0) parts.push(`Fat ${trimNum(m.fat_percent)}`);
    if (m.snf_percent != null && Number(m.snf_percent) !== 0) parts.push(`SNF ${trimNum(m.snf_percent)}`);
    if (m.extra_per_unit != null && Number(m.extra_per_unit) !== 0) parts.push(`Addition ${trimNum(m.extra_per_unit)}`);
    return parts.join(' | ');
}

/**
 * Attach item detail (product, quantity, unit, rate) and payment status to
 * sale / purchase / milk / payment ledger rows. Used by BOTH the party
 * statement and the party ledger modal so the two can never disagree.
 *
 * sales_items / purchase_items hold the real goods behind a ledger row.
 * Imported rows reference bills by NUMBER (text) and bill numbers REPEAT
 * across dates, so resolution is id → bill + date → bill.
 *
 * Purely presentational: it attaches display detail and never changes any
 * amount, balance or total.
 */
function attachEntryItemDetails(db, partyId, entries) {
    let saleItems, purchaseItems, saleByInvoice, saleByInvoiceAny,
        purchaseByBillDate, purchaseByBill, saleStatus, purchaseStatus;
    try {
        saleItems = db.prepare('SELECT product_name, quantity, unit, rate, amount FROM sales_items WHERE sale_id = ? ORDER BY id');
        purchaseItems = db.prepare('SELECT product_name, quantity, unit, rate, amount FROM purchase_items WHERE purchase_id = ? ORDER BY id');
        saleByInvoice = db.prepare('SELECT id, status FROM sales WHERE party_id = ? AND invoice_no = ? AND date = ? ORDER BY id LIMIT 1');
        saleByInvoiceAny = db.prepare('SELECT id, status FROM sales WHERE party_id = ? AND invoice_no = ? ORDER BY id LIMIT 1');
        purchaseByBillDate = db.prepare('SELECT id, status FROM purchases WHERE party_id = ? AND bill_no = ? AND date = ? ORDER BY id LIMIT 1');
        purchaseByBill = db.prepare('SELECT id, status FROM purchases WHERE party_id = ? AND bill_no = ? ORDER BY id LIMIT 1');
        saleStatus = db.prepare('SELECT status FROM sales WHERE id = ?');
        purchaseStatus = db.prepare('SELECT status FROM purchases WHERE id = ?');
    } catch (e) { return; } // schema without item tables — statements degrade gracefully

    for (const e of entries) {
        try {
            const type = String(e.reference_type || '');
            if (type === 'sale' || type === 'purchase') {
                let srcId = null, status = null;
                const ref = e.reference_id;
                if (Number.isInteger(ref)) {
                    srcId = ref;
                    const st = (type === 'sale' ? saleStatus : purchaseStatus).get(ref);
                    if (st) status = st.status;
                } else if (ref != null && String(ref).trim() !== '') {
                    const no = String(ref).trim();
                    const hit = type === 'sale'
                        ? (saleByInvoice.get(partyId, no, e.date) || saleByInvoiceAny.get(partyId, no))
                        : (purchaseByBillDate.get(partyId, no, e.date) || purchaseByBill.get(partyId, no));
                    if (hit) { srcId = hit.id; status = hit.status; }
                }
                if (srcId != null) {
                    e.source_id = srcId;
                    const items = (type === 'sale' ? saleItems : purchaseItems).all(srcId);
                    if (items.length) e.items = items;
                }
                if (status) e.payment_status = status;
            } else if (type === 'milk_collection' && e.milk_type) {
                e.items = [{
                    product_name: titleCaseMilk(e.milk_type) + ' Milk',
                    quantity: e.milk_quantity, unit: 'L', rate: e.milk_rate,
                    amount: (Number(e.milk_quantity) || 0) * (Number(e.milk_rate) || 0)
                }];
            } else if (type === 'payment_made' || type === 'payment_received') {
                e.payment_status = 'settled';
            }
        } catch (e2) { /* one bad row must not break the whole statement */ }
    }

    // ── Invoices split across several ledger rows ──────────────────────
    // The workbook import can post ONE invoice as multiple ledger rows
    // (e.g. BILL-6004 → 5,100 + 80 = 5,180). Every part resolves to the same
    // source invoice, so without this pass each part would print the FULL
    // invoice's goods against its own partial amount — a misleading line.
    //
    // Rule: show the item detail ONCE per invoice — on the part that matches
    // the invoice total if there is one, otherwise on the first part — and
    // stamp it with the invoice total and split count so the screen can say
    // why the goods belong to the whole invoice, not just this row. Other
    // parts show dashes (no invented quantities).
    const bySource = new Map();
    for (const e of entries) {
        if (!Array.isArray(e.items) || !e.items.length || e.source_id == null) continue;
        if (e.reference_type !== 'sale' && e.reference_type !== 'purchase') continue;
        const key = e.reference_type + ':' + e.source_id;
        if (!bySource.has(key)) bySource.set(key, []);
        bySource.get(key).push(e);
    }
    for (const group of bySource.values()) {
        if (group.length < 2) continue;
        const amountOf = (i) => (i.amount != null ? Number(i.amount) : Number(i.quantity || 0) * Number(i.rate || 0));
        // Snapshot: the loop below rewrites each row's `items`, including
        // group[0]'s, so the source list must not be read after that starts.
        const groupItems = group[0].items.slice();
        const itemsTotal = groupItems.reduce((s, i) => s + amountOf(i), 0);

        // ── One ledger row per product line ────────────────────────────
        // The workbook import posts an invoice as one ledger row PER PRODUCT
        // (row 'NAUNI' 2,400 · row 'Mix Milk' 700). Those rows are different
        // goods, not partials of the same goods, so each must carry its own
        // quantity and rate. Before this, every row but one was blanked and a
        // NAUNI line showed no quantity at all.
        // Only when the rows genuinely cannot be matched to the items one-for-one
        // (a bill posted as amount-only parts) do we keep the single-host rule.
        // Only UNIQUE evidence counts: a row must match exactly one item, by
        // product name first and then by its own amount. A row that matches
        // nothing (a product the item table never recorded) keeps blank
        // quantity/rate — it is never given another line's goods.
        const perRow = (() => {
            const unassigned = new Set(groupItems.map((_, idx) => idx));
            const pickByName = (e) => {
                const desc = String(e.description || '').trim().toLowerCase();
                if (!desc) return null;
                const hits = [...unassigned].filter(idx =>
                    String(groupItems[idx].product_name || '').trim().toLowerCase() === desc);
                return hits.length === 1 ? hits[0] : null;
            };
            const pickByAmount = (e) => {
                const rowAmount = Math.abs((Number(e.debit) || 0) - (Number(e.credit) || 0));
                const hits = [...unassigned].filter(idx => Math.abs(amountOf(groupItems[idx]) - rowAmount) <= 0.02);
                return hits.length === 1 ? hits[0] : null;
            };
            const assigned = new Map();
            for (const pass of [pickByName, pickByAmount]) {
                for (const e of group) {
                    if (assigned.has(e)) continue;
                    const idx = pass(e);
                    if (idx != null) { assigned.set(e, idx); unassigned.delete(idx); }
                }
            }
            return assigned;
        })();
        if (perRow.size) {
            for (const [e, idx] of perRow) {
                e.items = [groupItems[idx]];
                e.items_split_part = false;
                delete e.items_invoice_total;
                delete e.items_split_count;
                delete e.items_rows_total;
            }
            continue;
        }
        const rowTotal = group.reduce((s, e) => s + Math.abs((e.debit || 0) - (e.credit || 0)), 0);
        // Prefer the single row that carries the whole invoice amount.
        const whole = group.find(e =>
            Math.abs(Math.abs((e.debit || 0) - (e.credit || 0)) - itemsTotal) <= 0.02);
        const host = whole || group[0];
        host.items_invoice_total = Math.round(itemsTotal * 100) / 100;
        host.items_split_count = group.length;
        // Document when the parts do not add up to the invoice either.
        if (Math.abs(rowTotal - itemsTotal) > 0.02) {
            host.items_rows_total = Math.round(rowTotal * 100) / 100;
        }
        for (const e of group) {
            if (e === host) continue;
            e.items = undefined;
            e.items_split_part = true;
            e.items_invoice_total = host.items_invoice_total; // so the row can point at the main line
        }
    }
}

/**
 * Get party statement with running balance.
 * Builds from ledger_entries with party info and opening balance.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { party_id, from_date, to_date, transaction_type, source, reference, milk_type, shift }
 * @returns {object} { party, opening_balance, entries[], total_debit, total_credit, closing_balance }
 */
function getPartyStatement(db, { party_id, from_date, to_date, transaction_type, source, reference, milk_type, shift } = {}) {
    if (!party_id) throw new Error('Party ID is required');

    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    if (!party) throw new Error('Party not found');

    // Default date range: from beginning to the latest entry. Stored dates are
    // Bikram Sambat (BS) — defaulting the upper bound to AD "today" (2026-…)
    // excluded every BS-dated row from the filter, so the statement rendered
    // empty. MAX(date) is in the same calendar as the data itself.
    const from = from_date || '2000-01-01';
    // Books end, not "today": a future-dated BS document must not vanish from
    // an unfiltered statement.
    const to = to_date || '2090-12-30';

    // Get every ledger row for the party (no date cut yet: the opening balance
    // is computed after the module rows are merged in). Milk rows join
    // milk_collections for type/quantity/rate; payment rows carry mode/remarks.
    const ledgerEntries = db.prepare(`
        SELECT le.*, 
            CASE 
                WHEN le.reference_type = 'sale' THEN COALESCE((SELECT invoice_no FROM sales WHERE id = le.reference_id), CASE WHEN typeof(le.reference_id) = 'text' THEN le.reference_id END)
                WHEN le.reference_type = 'purchase' THEN COALESCE((SELECT bill_no FROM purchases WHERE id = le.reference_id), CASE WHEN typeof(le.reference_id) = 'text' THEN le.reference_id END)
                WHEN le.reference_type = 'payment_received' THEN 'RCPT-' || le.reference_id
                WHEN le.reference_type = 'payment_made' THEN 'PMT-' || le.reference_id
                WHEN le.reference_type = 'milk_collection' THEN (SELECT collection_no FROM milk_collections WHERE id = le.reference_id)
                ELSE ''
            END as reference_no,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.milk_type END AS milk_type,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.shift END AS milk_shift,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.quantity_liters END AS milk_quantity,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.rate END AS milk_rate,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.fat_percent END AS milk_fat,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.snf_percent END AS milk_snf,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.extra_per_unit END AS milk_extra,
            CASE WHEN le.reference_type = 'payment_received' THEN pay_r.mode END AS payment_mode,
            CASE WHEN le.reference_type = 'payment_made' THEN pay_m.mode END AS payment_mode_made,
            CASE WHEN le.reference_type = 'payment_received' THEN pay_r.notes END AS payment_notes,
            CASE WHEN le.reference_type = 'payment_made' THEN pay_m.notes END AS payment_notes_made
        FROM ledger_entries le
        LEFT JOIN milk_collections mc
            ON le.reference_type = 'milk_collection' AND mc.id = le.reference_id
        LEFT JOIN payments pay_r
            ON le.reference_type = 'payment_received' AND pay_r.id = le.reference_id
        LEFT JOIN payments pay_m
            ON le.reference_type = 'payment_made' AND pay_m.id = le.reference_id
        WHERE le.party_id = ?
        ORDER BY le.date ASC, le.id ASC
    `).all(party_id);

    // ── Consolidated view ──────────────────────────────────────────────
    // Every register row for this party is included exactly once: ledger rows
    // plus module rows the ledger does not already carry (petty cash, expenses
    // recorded before a party link existed). The statement never writes.
    const derivedRows = partyLedger.collectModuleRows(db)
        .filter(r => Number(r.party_id) === Number(party_id))
        // Purchases, sales, payments and milk post their own ledger row at entry
        // time (imported history is in the ledger too), so adding them again
        // would double the statement. Petty cash and expenses are the registers
        // that historically never reached the party account; they are merged
        // here, once, keyed by their tagged ledger row.
        .filter(r => r.source_table === 'petty_cash' || r.source_table === 'other_expenses')
        .filter(r => !ledgerCoversDerived(ledgerEntries, r))
        .map(r => ({
            id: null,
            party_id: r.party_id,
            date: r.date,
            transaction_date: r.date,
            accounting_date: r.accounting_date || r.date,
            reference_type: r.type,
            reference_id: r.source_id,
            reference_no: r.reference || '',
            description: r.particulars || '',
            debit: r.debit || 0,
            credit: r.credit || 0,
            balance: 0,
            is_derived: true,
            source_table: r.source_table,
            source_id: r.source_id,
            source_module: r.source_module || partyLedger.SOURCE_MODULE[r.type] || '',
            statement_type: r.type
        }));

    const acctOf = (r) => String(r.accounting_date || r.date || '');
    const allRows = [...ledgerEntries.map(normaliseLedgerEntry), ...derivedRows];

    // Opening balance: stored opening plus every row whose ACCOUNTING date is
    // before the period. No SQL date cut can miss a derived register row.
    const openingBalance = round2((party.opening_balance || 0)
        + allRows.filter(r => from && acctOf(r) < String(from))
            .reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0));

    const periodRows = allRows.filter(r => {
        const d = acctOf(r);
        if (from && d < String(from)) return false;
        if (to && d > String(to)) return false;
        return true;
    }).filter(r => {
        // Optional statement filters: transaction type, source module and
        // reference-number search. They never alter which rows exist.
        if (transaction_type && String(r.statement_type || r.reference_type) !== String(transaction_type)) return false;
        if (source && String(r.source_module || '').toLowerCase() !== String(source).toLowerCase()) return false;
        if (reference && !String(r.reference_no || '').toLowerCase().includes(String(reference).toLowerCase())) return false;
        return true;
    }).sort((a, b) => {
        const d = acctOf(a).localeCompare(acctOf(b));
        if (d !== 0) return d;
        const t = String(a.transaction_date || '').localeCompare(String(b.transaction_date || ''));
        if (t !== 0) return t;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
    });

    const entries = periodRows;
    // The statement's rows. Kept mutable so the milk-type / shift filters can
    // narrow them AFTER the milk detail is resolved (a filter needs to know
    // each row's own recorded milk type and shift, which is not a ledger column).
    let shownEntries = entries;

    // Milk detail for purchase rows: resolve EACH ledger row to its OWN
    // purchase and attach only that purchase's milk collections.
    //
    // Ledger rows imported from the workbook's Party_Ledger sheet carry the
    // bill NUMBER as text in reference_id (e.g. 'BILL-5152') instead of the
    // purchases.id. Bill numbers REPEAT across dates in the source data, so
    // resolution must be by bill number + entry date — resolving by bill
    // number alone would print other days' milk on this row.
    const milkByEntry = {};
    try {
        const hasMilkRef = db.prepare(
            "SELECT COUNT(*) AS n FROM pragma_table_info('milk_collections') WHERE name = 'purchase_ref_id'"
        ).get().n > 0;
        if (hasMilkRef) {
            const purchaseEntries = entries.filter(e => e.reference_type === 'purchase');
            // Explicit links written by the importer / startup repair. A link is
            // a fact recorded with the bill: this ledger line posts that milk
            // line. It is used BEFORE the amount heuristic, so a line whose
            // workbook amount drifted from the bill's milk line still shows the
            // milk it paid for; the row's Debit / Credit are never altered.
            let linksByEntry = {};
            try {
                linksByEntry = require('./milk_links').milkLinksForEntries(db, purchaseEntries.map(e => e.id));
            } catch (e) { linksByEntry = {}; }
            const resolveByBillDate = db.prepare(
                'SELECT id FROM purchases WHERE party_id = ? AND bill_no = ? AND date = ? ORDER BY id LIMIT 1'
            );
            const resolveByBill = db.prepare(
                'SELECT id FROM purchases WHERE party_id = ? AND bill_no = ? ORDER BY id LIMIT 1'
            );
            const pidByEntry = new Map();
            const purchaseIds = new Set();
            for (const e of purchaseEntries) {
                let pid = null;
                if (e.reference_id != null && Number.isInteger(e.reference_id)) {
                    pid = e.reference_id;
                } else if (e.reference_id != null && String(e.reference_id).trim() !== '') {
                    const bill = String(e.reference_id).trim();
                    const hit = resolveByBillDate.get(party_id, bill, e.date) || resolveByBill.get(party_id, bill);
                    pid = hit ? hit.id : null;
                }
                if (pid != null) {
                    pidByEntry.set(e.id, pid);
                    purchaseIds.add(pid);
                }
            }
            if (purchaseIds.size) {
                const ids = [...purchaseIds];
                const ph = ids.map(() => '?').join(',');
                const lines = db.prepare(`
                    SELECT mc.id, mc.purchase_ref_id, mc.milk_type, mc.quantity_liters, mc.rate, mc.amount,
                           mc.fat_percent, mc.snf_percent, mc.extra_per_unit, mc.shift
                    FROM milk_collections mc
                    WHERE mc.purchase_ref_id IN (${ph})
                    ORDER BY mc.date, mc.id
                `).all(...ids);
                const linesByPid = {};
                for (const l of lines) {
                    (linesByPid[l.purchase_ref_id] = linesByPid[l.purchase_ref_id] || []).push(l);
                }
                // Amount-based attribution: a ledger row may only display milk
                // lines whose qty×rate equals the ROW's own amount (the source
                // Party_Ledger transaction). Bill-level lines that the ledger
                // never posted (workbook-internal supply vs ledger gaps) must
                // NOT leak into the statement. Each line is consumed once so
                // repeated rows on a bill never show the same line twice.
                const lineValue = l => (l.amount != null ? Number(l.amount) : Number(l.quantity_liters || 0) * Number(l.rate || 0));
                const matchByDateAmount = db.prepare(`
                    SELECT id, milk_type, quantity_liters, rate, amount, fat_percent, snf_percent, extra_per_unit, shift
                    FROM milk_collections
                    WHERE party_id = ? AND date = ? AND ABS(COALESCE(amount, quantity_liters * rate) - ?) <= 0.01
                    ORDER BY id LIMIT 1
                `);
                const usedLineIds = new Set();
                for (const e of purchaseEntries) {
                    const pid = pidByEntry.get(e.id);
                    const rowAmount = Math.abs((e.credit || 0) - (e.debit || 0));
                    let shown = [];
                    const linked = (linksByEntry[e.id] || []).filter(l => !usedLineIds.has(l.id));
                    if (linked.length) {
                        shown = linked;
                        // The linked milk line is what the bill recorded; it can
                        // be worth more or less than this ledger line when the
                        // workbook posted a different figure. Say so once in the
                        // footnote (the amounts themselves stay as recorded).
                        if (rowAmount > 0) {
                            const linkedTotal = linked.reduce((s, l) => s + lineValue(l), 0);
                            if (Math.abs(linkedTotal - rowAmount) > 0.01) e.qty_link_diff = true;
                        }
                    } else if (pid != null && rowAmount > 0) {
                        const candidates = (linesByPid[pid] || []).filter(l => !usedLineIds.has(l.id));
                        const exact = candidates.filter(l => Math.abs(lineValue(l) - rowAmount) <= 0.01);
                        const total = candidates.reduce((s, l) => s + lineValue(l), 0);
                        if (exact.length >= 1) {
                            shown = [exact[0]]; // the line this row actually charges
                        } else if (Math.abs(total - rowAmount) <= 0.01) {
                            shown = candidates; // full-bill row: all lines together equal the row amount
                        }
                    }
                    // Fallback: no attributable line on the linked purchase — try any
                    // of this party's collections on the SAME DATE worth exactly the
                    // row amount. Still transaction-true (date + amount match).
                    if (!shown.length && rowAmount > 0) {
                        const hit = matchByDateAmount.get(party_id, e.date, rowAmount);
                        if (hit && !usedLineIds.has(hit.id)) shown = [hit];
                    }
                    for (const l of shown) usedLineIds.add(l.id);
                    milkByEntry[e.id] = shown;
                }
            }
        }
    } catch (e) { /* schema difference — statements degrade to plain description */ }

    // Fill in payment method/notes for receipt rows whose ledger reference is
    // textual (Party_Ledger import): match this party's payments by date +
    // amount + direction. Read-only — it only enriches what is displayed.
    try {
        const partyPayments = db.prepare('SELECT date, accounting_date, amount, mode, notes, type FROM payments WHERE party_id = ?').all(party_id);
        for (const e of entries) {
            if (e.reference_type !== 'payment_received' && e.reference_type !== 'payment_made') continue;
            if (e.payment_mode || e.payment_mode_made) continue;
            const amt = e.reference_type === 'payment_received' ? (e.credit || 0) : (e.debit || 0);
            if (!amt) continue;
            const hit = partyPayments.find(p =>
                p.date === e.date && Math.abs((p.amount || 0) - amt) < 0.01 &&
                (e.reference_type === 'payment_received' ? (p.type === 'receipt' || p.type === 'advance') : p.type === 'payment'));
            if (hit) {
                e.payment_mode = e.payment_mode || hit.mode || '';
                e.payment_notes = e.payment_notes || hit.notes || '';
            }
        }
    } catch (e) { /* payments table shape difference — skip enrichment */ }

    // Item / quantity / unit / rate behind sale, purchase and milk rows —
    // the same helper the party ledger modal uses, so the two views agree.
    attachEntryItemDetails(db, party_id, entries);

    // ── Quantity, milk type and shift per row ───────────────────────────
    // Every row's own quantity comes from its source transaction and nothing
    // else: milk lines for milk purchases and collections, the goods lines for
    // invoice / bill rows. A row with no quantity record gets an empty list, so
    // nothing is invented. Each milk collection is counted ONCE (a collection
    // already shown on its purchase bill is not counted again).
    const countedCollectionIds = new Set();
    for (const arr of Object.values(milkByEntry)) {
        for (const l of arr || []) countedCollectionIds.add(Number(l.id));
    }

    const qtyLinesForEntry = (e) => {
        const lines = [];
        const add = (l) => {
            if (!l) return;
            const qty = Number(l.quantity);
            if (!isFinite(qty) || qty <= 0) return; // no fake/zero quantity rows
            lines.push(l);
        };
        if (e.reference_type === 'purchase') {
            const milk = milkByEntry[e.id] || [];
            for (const l of milk) {
                add({
                    kind: 'purchase',
                    milk_type: classifyMilkType(l.milk_type),
                    shift: normaliseShift(l.shift),
                    quantity: Number(l.quantity_liters),
                    rate: Number(l.rate),
                    unit: 'L',
                    product_name: titleCaseMilk(l.milk_type) + ' Milk',
                    source: 'milk_collections',
                    source_id: l.id
                });
            }
            // A goods bill has no milk line — its own purchase_items are the
            // recorded quantity and rate.
            if (!lines.length) {
                for (const it of (Array.isArray(e.items) ? e.items : [])) {
                    add({
                        kind: 'purchase',
                        milk_type: classifyMilkType('', it.product_name),
                        shift: '',
                        quantity: Number(it.quantity),
                        rate: Number(it.rate),
                        unit: it.unit || '',
                        product_name: it.product_name || '',
                        amount: it.amount != null ? Number(it.amount) : null,
                        source: 'purchase_items'
                    });
                }
            }
        } else if (e.reference_type === 'milk_collection') {
            // A milk ledger row whose collection is already the milk line of a
            // purchase bill is not counted a second time.
            if (!countedCollectionIds.has(Number(e.reference_id))) {
                add({
                    kind: 'purchase',
                    milk_type: classifyMilkType(e.milk_type),
                    shift: normaliseShift(e.milk_shift),
                    quantity: Number(e.milk_quantity),
                    rate: Number(e.milk_rate),
                    unit: 'L',
                    product_name: titleCaseMilk(e.milk_type) + ' Milk',
                    source: 'milk_collections',
                    source_id: e.reference_id
                });
            }
        } else if (e.reference_type === 'sale') {
            for (const it of (Array.isArray(e.items) ? e.items : [])) {
                add({
                    kind: 'sale',
                    milk_type: classifyMilkType('', it.product_name),
                    shift: '',
                    quantity: Number(it.quantity),
                    rate: Number(it.rate),
                    unit: it.unit || '',
                    product_name: it.product_name || '',
                    amount: it.amount != null ? Number(it.amount) : null,
                    source: 'sales_items'
                });
            }
        }
        return lines;
    };

    const milkTypeFilter = MILK_TYPE_VALUES.includes(String(milk_type || '').toLowerCase())
        ? String(milk_type).toLowerCase() : '';
    const shiftFilter = ['morning', 'evening'].includes(String(shift || '').toLowerCase())
        ? String(shift).toLowerCase() : '';

    for (const e of entries) {
        const allLines = qtyLinesForEntry(e);
        e.qty_lines_all = allLines;
        const keep = l => (!milkTypeFilter || l.milk_type === milkTypeFilter)
            && (!shiftFilter || l.shift === shiftFilter);
        e.qty_lines = (milkTypeFilter || shiftFilter) ? allLines.filter(keep) : allLines;
        const types = [...new Set(e.qty_lines.map(l => l.milk_type).filter(Boolean))];
        e.milk_type_label = types.map(t => titleCaseMilk(t)).join(' · ');
        const shifts = [...new Set(e.qty_lines.map(l => l.shift).filter(Boolean))];
        e.shift_label = shifts.map(s => titleCaseMilk(s)).join(' · ');

        // ── Item-level display lines ───────────────────────────────────
        // One bill can carry several products (and a milk bill a morning and
        // an evening collection). Each recorded line is shown on its own line
        // with its own product, quantity, unit, rate, milk type and shift. The
        // row's debit/credit stay on the row ONCE, so a bill total is never
        // duplicated by its items.
        e.display_lines = e.qty_lines.map(l => ({
            product_name: String(l.product_name || '').trim(),
            quantity: Number(l.quantity),
            unit: String(l.unit || '').trim(),
            rate: (l.rate == null || !isFinite(Number(l.rate))) ? null : Number(l.rate),
            amount: l.amount != null ? round2(l.amount) : (l.rate == null ? null : round2(Number(l.quantity) * Number(l.rate))),
            milk_type: l.milk_type || '',
            milk_type_label: l.milk_type ? titleCaseMilk(l.milk_type) : '',
            shift: l.shift || '',
            shift_label: l.shift ? titleCaseMilk(l.shift) : '',
            kind: l.kind
        }));
    }

    // A purchase row that carries an amount but has neither a linked milk
    // collection nor its own goods lines is an import that did not reconcile:
    // its Milk Type / Quantity cannot be shown. Flag it (read-only) so the
    // statement says so, instead of leaving the reader to assume the milk was
    // never recorded. No amount, total or balance is touched by this flag.
    // Only a milk bill can have a milk line missing: an opening-balance row or
    // a party that never supplied milk is not a gap, so it is never flagged.
    let partyHasMilkCollections = false;
    try {
        partyHasMilkCollections = !!db.prepare('SELECT 1 FROM milk_collections WHERE party_id = ? LIMIT 1').get(party_id);
    } catch (e) { /* no collections table — nothing to match anyway */ }
    for (const e of entries) {
        if (e.reference_type !== 'purchase') continue;
        const desc = String(e.description || '').trim();
        const ref = String(e.reference_no || '').trim();
        if (/^opening\b/i.test(desc) || /^opn/i.test(ref)) continue; // opening balance, not a bill
        const milkish = partyHasMilkCollections || /milk/i.test(desc);
        const amount = Math.abs((e.debit || 0) - (e.credit || 0));
        const hasMilk = (milkByEntry[e.id] || []).length > 0;
        const hasItems = Array.isArray(e.items) && e.items.length > 0;
        e.qty_unreconciled = amount > 0 && milkish && !hasMilk && !hasItems;
    }

    // The filters narrow the STATEMENT (and its totals), never the opening
    // balance: the balance carried into the period is a fact of the account.
    if (milkTypeFilter || shiftFilter) {
        shownEntries = entries.filter(e => Array.isArray(e.qty_lines) && e.qty_lines.length > 0);
    } else {
        shownEntries = entries;
    }

    // ── Post-Dated Cheques (PDC) ──
    // A held cheque is a promise, not money. It is shown as a ZERO-AMOUNT memo
    // line so the statement never implies the invoice was paid while the cheque
    // is still Held, and a cleared cheque's ledger row is relabelled as
    // "PDC … Cleared" so it is never read as an ordinary cash/bank receipt. The
    // receivable itself keeps coming from the ledger, so no amount is invented
    // and no balance is adjusted for a cheque that has not cleared.
    let pdcSummary = { received_held: 0, received_held_count: 0, issued_held: 0, issued_held_count: 0, cleared: 0, bounced: 0 };
    try {
        const pdc = require('./pdc');
        pdc.ensurePdcTables(db);
        const pdcRows = db.prepare('SELECT * FROM pdc_cheques WHERE party_id = ? ORDER BY id').all(party_id);
        if (pdcRows.length) {
            // ledger payment row id → the cheque whose clearance it represents
            const chequeByPayment = new Map();
            for (const link of db.prepare('SELECT pdc_id, payment_id FROM pdc_allocations WHERE payment_id IS NOT NULL').all()) {
                const c = pdcRows.find(x => Number(x.id) === Number(link.pdc_id));
                if (c) chequeByPayment.set(Number(link.payment_id), c);
            }
            for (const c of pdcRows) if (c.payment_id) chequeByPayment.set(Number(c.payment_id), c);

            const label = c => `PDC ${c.pdc_type === 'received' ? 'Received' : 'Issued'}`;

            for (const c of pdcRows) {
                const amount = Number(c.amount) || 0;
                if (c.status === 'CLEARED') pdcSummary.cleared += amount;
                if (c.status === 'BOUNCED') pdcSummary.bounced += amount;
                if (c.status === 'HELD' || c.status === 'DEPOSITED') {
                    if (c.pdc_type === 'received') { pdcSummary.received_held += amount; pdcSummary.received_held_count++; }
                    else { pdcSummary.issued_held += amount; pdcSummary.issued_held_count++; }
                }
            }

            // Relabel the ledger rows the clearance produced.
            for (const e of entries) {
                if (e.reference_type !== 'payment_received' && e.reference_type !== 'payment_made') continue;
                const c = chequeByPayment.get(Number(e.reference_id));
                if (!c) continue;
                e.is_pdc = true;
                e.pdc_status = c.status;
                e.cheque_no = c.cheque_no;
                e.pdc_type = c.pdc_type;
                e.description = `${label(c)} — Cleared`;
                e.payment_mode = 'cheque';
                e.payment_notes = `Cheque ${c.cheque_no}${c.bank_name ? ' · ' + c.bank_name : ''}`;
            }

            // Memo lines: everything that has not (yet) moved money.
            for (const c of (milkTypeFilter || shiftFilter ? [] : pdcRows)) {
                if (c.status === 'CLEARED') continue;
                const memoDate = c.status === 'BOUNCED' ? (c.bounce_date || c.txn_date)
                    : c.status === 'CANCELLED' ? (c.cancel_date || c.txn_date)
                        : c.txn_date;
                if (!memoDate || memoDate < from || memoDate > to) continue;
                // A milk-type / shift filter selects quantity transactions only;
                // a zero-amount cheque memo line is not one of them.
                if (milkTypeFilter || shiftFilter) continue;
                const statusText = c.status === 'HELD' ? 'Held (not yet banked)'
                    : c.status === 'DEPOSITED' ? 'Deposited (presented, not cleared)'
                        : c.status === 'BOUNCED' ? `Bounced${c.bounce_reason ? ' — ' + c.bounce_reason : ''}`
                            : 'Cancelled';
                entries.push({
                    id: null,
                    party_id,
                    qty_lines: [],
                    qty_lines_all: [],
                    milk_type_label: '',
                    shift_label: '',
                    date: memoDate,
                    reference_type: 'pdc',
                    reference_id: c.id,
                    reference_no: `CHQ-${c.cheque_no}`,
                    description: `${label(c)} — Cheque ${c.cheque_no}${c.bank_name ? ' (' + c.bank_name + ')' : ''} — ${statusText}`,
                    debit: 0,
                    credit: 0,
                    balance: 0,
                    is_memo: true,
                    is_pdc: true,
                    pdc_status: c.status,
                    pdc_type: c.pdc_type,
                    cheque_no: c.cheque_no,
                    pdc_no: c.pdc_no,
                    pdc_amount: Number(c.amount) || 0,
                    payment_mode: '',
                    payment_notes: ''
                });
            }
            entries.sort((a, b) => {
                if (a.date === b.date) return (a.id || 0) - (b.id || 0);
                return a.date < b.date ? -1 : 1;
            });
            shownEntries = entries;
        }
    } catch (e) { /* no PDC register on this database — statement is unaffected */ }

    // Calculate running balance
    let runningBalance = openingBalance;
    const entriesWithBalance = shownEntries.map(entry => {
        // In ledger_entries: debit = amount owed by party (sale), credit = amount paid/received
        // For customers (type=customer or both): debit increases balance (they owe more), credit decreases
        // For suppliers: credit increases balance (we owe more), debit decreases
        // We'll use a simple: running = previous + debit - credit
        runningBalance = runningBalance + (entry.debit || 0) - (entry.credit || 0);

        let description = entry.description || '';
        if (String(description).trim() === '0') description = ''; // filler from Excel import
        if (entry.reference_type === 'purchase') {
            // ONLY this row's own milk lines (resolved by bill + date above).
            const milkLines = milkByEntry[entry.id] || [];
            if (milkLines.length) {
                const text = milkLines.map(formatMilkLine).join(' | ');
                const base = String(description).trim();
                // Imported purchase rows carry just the milk type ("Buffalo
                // Milk") as description — the formatted line already contains
                // it, so don't print it twice. Keep any other base text.
                const isPlainType = milkLines.every(m =>
                    base.toLowerCase() === (titleCaseMilk(m.milk_type) + ' milk').toLowerCase());
                description = (!base || isPlainType) ? text : base + ' — ' + text;
            }
        } else if (entry.reference_type === 'milk_collection' && entry.milk_type) {
            // Direct milk-collection ledger rows: their own joined fields only.
            description = formatMilkLine({
                milk_type: entry.milk_type,
                quantity_liters: entry.milk_quantity,
                rate: entry.milk_rate,
                fat_percent: entry.milk_fat,
                snf_percent: entry.milk_snf,
                extra_per_unit: entry.milk_extra
            });
        }
        if (entry.reference_type === 'payment_received' || entry.reference_type === 'payment_made') {
            const mode = entry.payment_mode || entry.payment_mode_made || '';
            const notes = entry.payment_notes || entry.payment_notes_made || '';
            const extras = [mode ? `mode: ${mode}` : '', notes ? notes : ''].filter(Boolean).join(' — ');
            if (extras) description = (description ? description + ' (' + extras + ')' : extras);
            // Imported rows whose description cell was empty (Excel filler "0")
            // must not render a blank Particulars — show the transaction kind.
            if (!description.trim()) {
                description = entry.reference_type === 'payment_received' ? 'Payment Received' : 'Payment Made';
            }
        } else if (!description.trim() && entry.reference_type === 'adjustment') {
            description = 'Adjustment';
        } else if (!description.trim()) {
            description = entry.reference_type.charAt(0).toUpperCase() + entry.reference_type.slice(1).replace(/_/g, ' ');
        }

        return {
            ...entry,
            description,
            running_balance: runningBalance
        };
    });

    const totalDebit = shownEntries.reduce((s, e) => s + (e.debit || 0), 0);
    const totalCredit = shownEntries.reduce((s, e) => s + (e.credit || 0), 0);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    // Purchase / milk and payment totals for the statement summary block
    const totals = {
        purchase_total: shownEntries.reduce((s, e) => s + (e.reference_type === 'purchase' ? (e.credit - e.debit) : 0), 0),
        milk_total: shownEntries.reduce((s, e) => {
            if (e.reference_type !== 'milk_collection') return s;
            return s + (e.milk_quantity != null ? Math.abs(e.milk_quantity * (e.milk_rate || 0)) : (e.credit - e.debit));
        }, 0),
        sales_total: shownEntries.reduce((s, e) => s + (e.reference_type === 'sale' ? (e.debit - e.credit) : 0), 0),
        paid_total: shownEntries.reduce((s, e) => s + (e.reference_type === 'payment_made' ? (e.debit - e.credit) : 0), 0),
        received_total: shownEntries.reduce((s, e) => s + (e.reference_type === 'payment_received' ? (e.credit - e.debit) : 0), 0)
    };
    totals.supply_total = totals.purchase_total + totals.milk_total;
    totals.payment_total = totals.paid_total + totals.received_total;
    totals.outstanding = closingBalance;

    return {
        party,
        from_date: from,
        to_date: to,
        opening_balance: openingBalance,
        entries: entriesWithBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: closingBalance,
        totals,
        // Quantity / litre summary for the rows actually shown. Purchase and
        // sales quantities stay in separate buckets, so they are never added
        // into one misleading "total business quantity".
        qty_summary: summariseQuantities(entriesWithBalance),
        // How many shown purchase rows could not be tied to a milk collection —
        // named in the footnote, never corrected by guessing quantity or rate.
        qty_unreconciled_count: entriesWithBalance.filter(e => e.qty_unreconciled).length,
        // Linked milk lines whose recorded value differs from the ledger line
        // they are posted on (a workbook figure, not a calculation). Disclosed
        // in the footnote; no amount is changed.
        qty_link_diff_count: entriesWithBalance.filter(e => e.qty_link_diff).length,
        // The filters applied to THIS statement (echoed into print and PDF).
        filters: {
            transaction_type: transaction_type || '',
            source: source || '',
            reference: reference || '',
            milk_type: milkTypeFilter,
            shift: shiftFilter
        },
        // Post-dated cheques are shown separately: what is still expected through
        // a cheque and is therefore NOT part of the closing balance yet.
        pdc: {
            received_held: round2(pdcSummary.received_held),
            received_held_count: pdcSummary.received_held_count,
            issued_held: round2(pdcSummary.issued_held),
            issued_held_count: pdcSummary.issued_held_count,
            cleared: round2(pdcSummary.cleared),
            bounced: round2(pdcSummary.bounced)
        }
    };
}

/**
 * List parties with their outstanding balance as of a given date.
 * Useful for statement selection screen.
 */
function listPartiesWithBalance(db, { type, as_of_date } = {}) {
    // BS as-of date: an AD default put the cutoff before every BS row and
    // returned zero balances for every party.
    const asOf = as_of_date || todayBSDate();
    let query = "SELECT * FROM parties WHERE 1=1";
    const params = [];
    if (type) {
        query += " AND (type = ? OR type = 'both')";
        params.push(type);
    }
    query += " ORDER BY name";
    const parties = db.prepare(query).all(...params);

    // Calculate balance for each party
    return parties.map(party => {
        const ledger = db.prepare(`
            SELECT COALESCE(SUM(debit), 0) as debit, COALESCE(SUM(credit), 0) as credit
            FROM ledger_entries WHERE party_id = ? AND date <= ?
        `).get(party.id, asOf);
        const balance = (party.opening_balance || 0) + (ledger.debit || 0) - (ledger.credit || 0);
        return { ...party, balance };
    });
}

module.exports = { getPartyStatement, listPartiesWithBalance, attachEntryItemDetails, summariseQuantities, classifyMilkType };
