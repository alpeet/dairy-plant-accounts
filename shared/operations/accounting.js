/**
 * Prarambha Account & Stock Management — Accounting Core
 * =====================================================
 * ONE place that answers the accounting questions every report asks, so the
 * Daybook, Ledger, Cash/Demon, Bank, Sales, Receivable and Profit & Loss all
 * agree on the same transaction.
 *
 * It holds, and is the single source of truth for:
 *
 *   1. Money precision — every amount is rounded to 2 decimals and compared
 *      with CURRENCY_TOLERANCE, never with === on floats.
 *   2. The ledger direction convention used across the app (and by the
 *      integrity doctor):
 *          closing = opening_balance + Σ debit − Σ credit
 *          sale → debit · purchase → credit · receipt → credit · payment → debit
 *          milk collection → credit (the plant owes the farmer)
 *   3. Transaction → account mapping. Every document gets an explicit
 *      double-entry pair (debit account / credit account) from its type and
 *      reference — not from how a screen happens to label it.
 *          sale             Receivable            DR · Sales                CR
 *          receipt/advance  Cash / Bank           DR · Receivable           CR
 *          payment made     Payable               DR · Cash / Bank          CR
 *          purchase         Purchase (non-milk)   DR · Payable              CR
 *          milk collection  Milk Purchase (COGS)  DR · Farmer Payable       CR
 *          cash deposit     Bank                  DR · Cash                 CR   (transfer)
 *          bank expense     Office Expense        DR · Bank                 CR
 *          expense          Office Expense        DR · Cash / Bank/Payable  CR
 *   4. Milk purchase cost counted ONCE. Excel-imported milk is recorded both as
 *      Milk Collection rows and inside the Purchase bill (linked through
 *      milk_collections.purchase_ref_id), so the bill's milk portion is removed
 *      from "purchases" and re-added through the collections — the same money,
 *      recognised a single time.
 *   5. Bank row classification: a deposit of cash sales into the bank is a
 *      Cash→Bank TRANSFER (Bank DR / Cash CR), never a second sale, income,
 *      receivable or customer payment.
 *   6. Sale settlement: PAID / PARTIAL / UNPAID is derived from the actual
 *      receipts (with money tolerance), allocated against the party's open
 *      invoices oldest-first — a Rs 1,000 receipt against a Rs 10,000 invoice
 *      is Partial, never Paid.
 *   7. Cash / bank position and the cross-module reconciliation report.
 *
 * READ-ONLY: this module never writes to the database.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

// ──────────────────────────────────────────────────────────────
// Money precision
// ──────────────────────────────────────────────────────────────

/** Half-up rounding to 2 decimals — the currency precision used everywhere. */
function round2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Tolerance for money comparisons. Never compare money with === on floats. */
const CURRENCY_TOLERANCE = 0.005;

/** True when two amounts are equal at currency precision. */
function moneyEq(a, b, tol = CURRENCY_TOLERANCE) {
    return Math.abs(round2(a) - round2(b)) <= tol;
}

/** True when amount a is at least b (within currency tolerance). */
function moneyGte(a, b, tol = CURRENCY_TOLERANCE) {
    return round2(a) - round2(b) >= -tol;
}

/**
 * Payment status from the money actually received against a document.
 * PAID    received >= total (at currency precision)
 * PARTIAL 0 < received < total
 * UNPAID  received = 0
 */
function paymentStatus(received, total, tol = CURRENCY_TOLERANCE) {
    const r = round2(received);
    const t = round2(total);
    if (r <= tol) return 'unpaid';
    if (moneyGte(r, t, tol)) return 'paid';
    return 'partial';
}

// ──────────────────────────────────────────────────────────────
// Chart of accounts used by the transaction mapping
// ──────────────────────────────────────────────────────────────

const ACCOUNT = {
    RECEIVABLE: 'Customer / Receivable',
    SALES: 'Sales',
    CASH: 'Cash',
    BANK: 'Bank',
    PAYABLE: 'Supplier / Payable',
    FARMER_PAYABLE: 'Farmer / Payable',
    PURCHASE: 'Purchase (non-milk)',
    MILK_PURCHASE: 'Milk Purchase (COGS)',
    EXPENSE: 'Office / Operating Expense',
    ADJUSTMENT: 'Opening / Adjustment',
    SUSPENSE: 'Suspense / Unclassified',
    ADVANCE_RECEIVABLE: 'Advance Receivable',
    LOAN_RECEIVABLE: 'Loan / Sapati Receivable',
    LOAN_PAYABLE: 'Loan / Sapati Payable'
};

/**
 * Payment transaction types (payments.transaction_type).
 * Payment does not automatically mean expense — the type decides whether the
 * money is a P&L event or a balance-sheet (receivable/payable) movement.
 */
const TRANSACTION_TYPES = {
    ACTUAL_EXPENSE: 'actual_expense',
    ADVANCE: 'advance',
    // Money coming BACK from an advance holder: Cash/Bank DR → Advance
    // Receivable CR. The mirror image of 'advance' — still balance sheet,
    // never P&L, and it makes the recovery register complete.
    ADVANCE_RETURNED: 'advance_returned',
    LOAN_GIVEN: 'loan_given',
    LOAN_RECEIVED: 'loan_received',
    LOAN_REPAYMENT: 'loan_repayment',
    ADVANCE_ADJUSTMENT: 'advance_adjustment',
    SETTLEMENT: 'settlement',
    OTHER: 'other'
};
const TRANSACTION_TYPE_VALUES = Object.values(TRANSACTION_TYPES);

/**
 * Map a document/transaction to its double-entry accounts.
 *
 * @param {object} t - a transaction descriptor:
 *      { type, sub_type, mode, party_name, direction }
 *      type: 'sale' | 'purchase' | 'milk_collection' | 'receipt' | 'payment' |
 *            'advance' | 'cash_deposit' | 'bank' | 'expense' | 'salary' |
 *            'petty_cash' | 'vehicle' | 'adjustment'
 *      direction ('bank'): 'in' | 'out'; accounting_class may refine it.
 * @returns {object} { kind, debit_account, credit_account, party_side, settlement_account }
 *      party_side is the single-column direction used by the Daybook register
 *      ('debit' | 'credit' | null for internal transfers that touch no party).
 */
function classifyTransaction(t = {}) {
    const type = String(t.type || '').toLowerCase();
    const cls = String(t.accounting_class || '').toLowerCase();
    const isCash = String(t.mode || '').toLowerCase() === 'cash';
    const money = isCash ? ACCOUNT.CASH : ACCOUNT.BANK;

    switch (type) {
        case 'sale':
            return { kind: 'sale', debit_account: ACCOUNT.RECEIVABLE, credit_account: ACCOUNT.SALES, party_side: 'debit', settlement_account: ACCOUNT.RECEIVABLE };

        case 'receipt':
            return { kind: 'customer_receipt', debit_account: isCash ? ACCOUNT.CASH : ACCOUNT.BANK, credit_account: ACCOUNT.RECEIVABLE, party_side: 'credit', settlement_account: ACCOUNT.RECEIVABLE };

        case 'advance':
            return { kind: 'customer_advance', debit_account: isCash ? ACCOUNT.CASH : ACCOUNT.BANK, credit_account: ACCOUNT.RECEIVABLE, party_side: 'credit', settlement_account: ACCOUNT.RECEIVABLE };

        case 'payment':
            return { kind: 'supplier_payment', debit_account: ACCOUNT.PAYABLE, credit_account: isCash ? ACCOUNT.CASH : ACCOUNT.BANK, party_side: 'debit', settlement_account: ACCOUNT.PAYABLE };

        case 'purchase':
            return { kind: 'purchase', debit_account: ACCOUNT.PURCHASE, credit_account: ACCOUNT.PAYABLE, party_side: 'credit', settlement_account: ACCOUNT.PAYABLE };

        case 'milk_collection':
            return { kind: 'milk_collection', debit_account: ACCOUNT.MILK_PURCHASE, credit_account: ACCOUNT.FARMER_PAYABLE, party_side: 'credit', settlement_account: ACCOUNT.PAYABLE };

        case 'cash_deposit':
            // Cash on hand moved into the bank: Bank DR / Cash CR. Internal
            // transfer — no party, no sale, no income.
            return { kind: 'cash_to_bank_transfer', debit_account: ACCOUNT.BANK, credit_account: ACCOUNT.CASH, party_side: null, settlement_account: null };

        case 'bank': {
            if (cls === 'cash_to_bank_transfer') {
                return { kind: 'cash_to_bank_transfer', debit_account: ACCOUNT.BANK, credit_account: ACCOUNT.CASH, party_side: null, settlement_account: null };
            }
            if (cls === 'expense') {
                return { kind: 'expense_paid_by_bank', debit_account: ACCOUNT.EXPENSE, credit_account: ACCOUNT.BANK, party_side: null, settlement_account: null };
            }
            if (cls === 'customer_receipt') {
                return { kind: 'customer_receipt', debit_account: ACCOUNT.BANK, credit_account: ACCOUNT.RECEIVABLE, party_side: 'credit', settlement_account: ACCOUNT.RECEIVABLE };
            }
            if (cls === 'supplier_payment') {
                return { kind: 'supplier_payment', debit_account: ACCOUNT.PAYABLE, credit_account: ACCOUNT.BANK, party_side: 'debit', settlement_account: ACCOUNT.PAYABLE };
            }
            // Fall back to the money direction when the row is unclassified.
            return String(t.direction) === 'out'
                ? { kind: 'supplier_payment', debit_account: ACCOUNT.PAYABLE, credit_account: ACCOUNT.BANK, party_side: 'debit', settlement_account: ACCOUNT.PAYABLE }
                : { kind: 'customer_receipt', debit_account: ACCOUNT.BANK, credit_account: ACCOUNT.RECEIVABLE, party_side: 'credit', settlement_account: ACCOUNT.RECEIVABLE };
        }

        case 'expense':
        case 'petty_cash':
        case 'vehicle':
        case 'salary':
            // Expense recognition: Expense DR / Cash-Bank-Payable CR. The credit
            // is the payment side, so the expense itself is never a credit.
            return { kind: 'expense', debit_account: ACCOUNT.EXPENSE, credit_account: money, party_side: 'debit', settlement_account: null };

        case 'adjustment':
            return { kind: 'adjustment', debit_account: ACCOUNT.ADJUSTMENT, credit_account: ACCOUNT.SUSPENSE, party_side: null, settlement_account: null };

        default:
            return { kind: 'unknown', debit_account: ACCOUNT.SUSPENSE, credit_account: ACCOUNT.SUSPENSE, party_side: null, settlement_account: null };
    }
}

// ──────────────────────────────────────────────────────────────
// Period helpers (dates are stored as Bikram Sambat strings)
// ──────────────────────────────────────────────────────────────

function periodBounds({ from_date, to_date } = {}) {
    const from = from_date || '0001-01-01';
    const to = to_date || '9999-12-32';
    return { from, to };
}

/** Inclusive BETWEEN range used by every query in this module. */
const RANGE = 'date >= ? AND date <= ?';

// ──────────────────────────────────────────────────────────────
// Milk purchase cost — counted ONCE
// ──────────────────────────────────────────────────────────────

/**
 * Raw-milk line detection. Mirrors shared/excel-import.js classifyMilkLine()
 * (the importer's own rule for "this purchase line is a milk collection").
 * Resolved lazily to avoid a require cycle.
 */
function detectMilkLine(productName) {
    try {
        const { classifyMilkLine } = require('../excel-import');
        if (typeof classifyMilkLine === 'function') return classifyMilkLine(productName);
    } catch (e) { /* fall through to the local rule */ }
    const n = String(productName || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!n || !/\bmilks?\b/.test(n)) return null;
    if (/powder/.test(n)) return null;
    if (/\bbuffal/.test(n)) return 'buffalo';
    if (/\bcow\b/.test(n)) return 'cow';
    return 'mixed';
}

/**
 * Profit & Loss cost of goods, with the milk purchase recognised once.
 *
 * Milk Collection is the operational source of milk bought from suppliers: the
 * Excel importer writes the milk lines of a Purchase bill as milk_collections
 * rows linked back to the bill (purchase_ref_id), while the bill itself keeps
 * the full grand_total (milk + transport). Counting both would post the milk
 * money twice, so the bill's milk portion is taken out of "purchases" and the
 * milk reaches the P&L through the collections only.
 *
 * A purchase bill that is NOT linked to any collection still counts in full;
 * any raw-milk item lines on such a bill are moved to the milk bucket so they
 * are counted once as well.
 *
 * @returns {object} { milk_collections, linked_to_purchase, linked_bills,
 *   unlinked_milk_lines, milk_cost, purchases_total, non_milk_purchases, cogs }
 */
function getMilkCostSummary(db, opts = {}) {
    const { from, to } = periodBounds(opts);

    const collectionCount = db.prepare(
        `SELECT COUNT(*) as count FROM milk_collections WHERE ${RANGE}`
    ).get(from, to).count;

    // ── Single milk-money policy (audit: Rs 0.05) ─────────────────────
    // Milk collections can carry sub-paisa amounts (qty × rate from imports).
    // Every aggregate here is the sum of ROW-rounded (2 dp) values — the exact
    // same expression the company ledger uses per displayed row — so summary,
    // ledger rows, P&L and net profit agree to the paisa by construction.
    const collectionAmounts = db.prepare(
        `SELECT amount, purchase_ref_id FROM milk_collections WHERE ${RANGE}`
    ).all(from, to);
    let collectionsTotal = 0;
    let linkedTotal = 0;
    for (const r of collectionAmounts) {
        const a = round2(r.amount);
        collectionsTotal += a;
        if (r.purchase_ref_id != null) linkedTotal += a;
    }
    collectionsTotal = round2(collectionsTotal);
    const linkedToPurchase = round2(linkedTotal);

    // Milk lines still sitting on purchase bills that have no linked collection
    // (manually entered purchases, or imports where the link was not written).
    const unlinkedItems = db.prepare(
        `SELECT pi.purchase_id, pi.product_name, pi.amount
           FROM purchase_items pi
           JOIN purchases p ON p.id = pi.purchase_id
          WHERE p.date >= ? AND p.date <= ?
            AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)`
    ).all(from, to);

    let unlinkedMilkLines = 0;
    const unlinkedByBill = new Map();
    for (const it of unlinkedItems) {
        if (!detectMilkLine(it.product_name)) continue;
        const amt = round2(it.amount);
        unlinkedMilkLines += amt;
        unlinkedByBill.set(it.purchase_id, round2((unlinkedByBill.get(it.purchase_id) || 0) + amt));
    }
    const unlinkedLines = round2(unlinkedMilkLines);

    // ── Non-milk purchases: same per-bill expression as the company ledger ──
    const billRows = db.prepare(
        `SELECT id, grand_total FROM purchases WHERE ${RANGE}`
    ).all(from, to);
    const linkedByBill = getLinkedMilkByBill(db, opts);
    let purchasesGross = 0;
    let nonMilkRaw = 0;
    for (const b of billRows) {
        purchasesGross += round2(b.grand_total);
        const value = round2((Number(b.grand_total) || 0)
            - (linkedByBill.get(b.id) || 0)
            - (unlinkedByBill.get(b.id) || 0));
        if (value > 0.005) nonMilkRaw += value;
    }
    const purchasesGrossR2 = round2(purchasesGross);
    const nonMilkPurchases = round2(nonMilkRaw);

    const milkCost = round2(collectionsTotal + unlinkedLines);

    return {
        milk_collections: collectionsTotal,
        milk_collection_count: collectionCount,
        linked_to_purchase: linkedToPurchase,
        unlinked_milk_lines: unlinkedLines,
        milk_cost: milkCost,
        purchases_total: purchasesGrossR2,
        purchases_count: billRows.length,
        non_milk_purchases: nonMilkPurchases,
        cogs: round2(milkCost + nonMilkPurchases)
    };
}

/**
 * Milk already represented by a Milk Collection, grouped by its purchase bill
 * (Phase 27 — single source). Read models subtract this from each bill to get
 * the bill's non-milk value; before this helper the same query existed three
 * times (company ledger, expense analysis, monthly P&L trend).
 *
 * @returns {Map<number, number>} purchase_id → linked milk amount
 */
function getLinkedMilkByBill(db, opts = {}) {
    const { from, to } = periodBounds(opts);
    const map = new Map();
    for (const r of db.prepare(
        `SELECT purchase_ref_id AS pid, amount FROM milk_collections
          WHERE ${RANGE} AND purchase_ref_id IS NOT NULL`
    ).all(from, to)) {
        // Row-rounded, matching the ledger's per-row rounding exactly.
        map.set(r.pid, round2((map.get(r.pid) || 0) + round2(r.amount)));
    }
    return map;
}

/**
 * Same linked-milk split grouped by BS month (YYYY-MM) for trend series.
 *
 * @returns {Array<{ym: string, total: number}>}
 */
function getLinkedMilkByMonth(db, opts = {}) {
    const { from, to } = periodBounds(opts);
    const map = new Map();
    for (const r of db.prepare(
        `SELECT substr(date, 1, 7) as ym, amount
           FROM milk_collections
          WHERE ${RANGE} AND purchase_ref_id IS NOT NULL`
    ).all(from, to)) {
        map.set(r.ym, round2((map.get(r.ym) || 0) + round2(r.amount)));
    }
    return [...map.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([ym, total]) => ({ ym, total }));
}

// ──────────────────────────────────────────────────────────────
// Bank row classification (Cash→Bank transfers, expenses, payments)
// ──────────────────────────────────────────────────────────────

const TRANSFER_PATTERNS = [
    /bank\s*deposit/i, /cash\s*deposit/i, /deposit\s*\(own\)/i, /^deposit/i,
    /deposited/i, /cash\s*sales\s*(deposit|bank)/i, /self\s*deposit/i,
    /a\/?c\s*clearance/i, /own\s*account/i
];

const EXPENSE_PATTERNS = [
    /office\s*expense/i, /expense/i, /\bbank\s*charge/i, /\belectric/i, /water\s*bill/i,
    /\brent\b/i, /\bsalary\b/i, /\bstationery/i, /telephone/i, /internet/i,
    /\bmobile\b/i, /maintenance/i, /repair/i, /\bfuel\b/i, /\bbill\b/i, /\btax\b/i,
    /license/i, /licence/i, /insurance/i, /audit\s*fee/i, /refreshment/i, /\btea\b/i
];

/**
 * Classify a bank_transactions row.
 * Order matters: an explicit cash-deposit signal always beats the generic
 * "money came in" reading, so deposits are never posted as customer receipts.
 *
 * @returns {'cash_to_bank_transfer'|'expense'|'customer_receipt'|'supplier_payment'|'unclassified'}
 */
function classifyBankRow(row = {}) {
    const debit = Number(row.debit) || 0;
    const credit = Number(row.credit) || 0;
    const text = [row.txn_type, row.description, row.counterparty_name, row.reference_no, row.remarks]
        .filter(Boolean).join(' ');

    for (const re of TRANSFER_PATTERNS) {
        if (re.test(text)) return 'cash_to_bank_transfer';
    }
    for (const re of EXPENSE_PATTERNS) {
        if (re.test(text)) return 'expense';
    }
    if (debit > 0 && credit <= 0) return 'supplier_payment';
    if (credit > 0 && debit <= 0) return 'customer_receipt';
    return 'unclassified';
}

/**
 * Every bank row for a period with its accounting classification. Prefers the
 * stored accounting_class column when present (written on import), and derives
 * it for older rows that predate the column.
 */
function listClassifiedBankRows(db, opts = {}) {
    const { from, to } = periodBounds(opts);
    let rows;
    try {
        rows = db.prepare(
            `SELECT b.*, COALESCE(b.accounting_class, '') as stored_class
               FROM bank_transactions b WHERE b.${RANGE} ORDER BY b.date, b.id`
        ).all(from, to);
    } catch (e) {
        rows = db.prepare(
            `SELECT b.*, '' as stored_class FROM bank_transactions b WHERE b.${RANGE} ORDER BY b.date, b.id`
        ).all(from, to);
    }
    return rows.map(r => {
        const cls = r.stored_class || classifyBankRow(r);
        return { ...r, accounting_class: cls, is_transfer: cls === 'cash_to_bank_transfer', is_expense: cls === 'expense' };
    });
}

// ──────────────────────────────────────────────────────────────
// Sale settlement — PAID / PARTIAL / UNPAID from actual receipts
// ──────────────────────────────────────────────────────────────

/** Is a payment row money received from a customer? */
function isCustomerReceipt(type) {
    const t = String(type || '').toLowerCase();
    return t === 'receipt' || t === 'advance';
}

/**
 * Work out what each sale has actually been paid, from the receipt
 * transactions themselves (never from a stored flag or the mere existence of a
 * payment row).
 *
 * Linking, in order of reliability:
 *   1. An explicit link — payments.reference_type in ('sale','sale_invoice')
 *      with reference_id = the sale id, or reference_type = a sale id that
 *      belongs to the same party (only trusted when it really resolves).
 *   2. Everything else is allocated oldest-invoice-first within the party,
 *      which is what the receivable (Sales − receipts) requires.
 *
 * @param {object} db
 * @param {object} opts - { from_date, to_date, party_id, sale_ids }
 * @returns {object} { sales: [{ id, party_id, date, invoice_no, grand_total,
 *                      received, outstanding, status, linked }], by_id, totals }
 */
function getSaleSettlements(db, opts = {}) {
    const { from, to } = periodBounds(opts);

    let saleSql = `SELECT id, invoice_no, date, party_id, grand_total, paid_amount, status, payment_mode
                     FROM sales WHERE ${RANGE}`;
    const saleParams = [from, to];
    const partyFilter = opts.party_ids && opts.party_ids.length
        ? opts.party_ids
        : (opts.party_id ? [opts.party_id] : null);
    if (partyFilter) {
        saleSql += ` AND party_id IN (${partyFilter.map(() => '?').join(',')})`;
        saleParams.push(...partyFilter);
    }
    if (Array.isArray(opts.sale_ids) && opts.sale_ids.length) {
        saleSql += ` AND id IN (${opts.sale_ids.map(() => '?').join(',')})`;
        saleParams.push(...opts.sale_ids);
    }
    saleSql += ' ORDER BY party_id, date, id';
    const sales = db.prepare(saleSql).all(...saleParams);

    // Receipts (money received from customers) grouped by party.
    let receiptSql = `
        SELECT id, party_id, date, amount, type, mode, reference_type, reference_id
          FROM payments
         WHERE type IN ('receipt', 'advance') AND party_id IS NOT NULL`;
    if (partyFilter) receiptSql += ` AND party_id IN (${partyFilter.map(() => '?').join(',')})`;
    receiptSql += ' ORDER BY party_id, date, id';
    const receipts = db.prepare(receiptSql).all(...(partyFilter || []));

    // Receipts that can be tied to a specific sale for the SAME party.
    const saleById = new Map(sales.map(s => [Number(s.id), s]));
    const explicit = new Map();     // sale id -> amount
    const consumed = new Set();     // receipt ids applied explicitly
    for (const r of receipts) {
        const sale = saleById.get(Number(r.reference_id));
        let targetId = null;
        const refType = String(r.reference_type || '').trim().toLowerCase();
        if (sale && sale.party_id === r.party_id && (refType === 'sale' || refType === 'sale_invoice' || refType === '' || /^\d+$/.test(refType))) {
            targetId = sale.id;
        } else if (/^\d+$/.test(refType)) {
            // Some imports carry the sale id in reference_type instead
            const viaType = saleById.get(Number(refType));
            if (viaType && viaType.party_id === r.party_id) targetId = viaType.id;
        }
        if (targetId) {
            explicit.set(targetId, round2((explicit.get(targetId) || 0) + (Number(r.amount) || 0)));
            consumed.add(r.id);
        }
    }

    // Remaining receipts per party, allocated oldest-invoice-first.
    const poolByParty = new Map();
    for (const r of receipts) {
        if (consumed.has(r.id)) continue;
        poolByParty.set(r.party_id, round2((poolByParty.get(r.party_id) || 0) + (Number(r.amount) || 0)));
    }

    const result = [];
    const byPartyCursor = new Map();
    for (const s of sales) {
        const total = round2(s.grand_total);
        let received = round2(explicit.get(s.id) || 0);
        const partyPool = poolByParty.get(s.party_id) || 0;
        if (partyPool > 0) {
            const used = byPartyCursor.get(s.party_id) || 0;
            const outstanding = Math.max(0, round2(total - received));
            const available = Math.max(0, round2(partyPool - used));
            const applied = Math.min(available, outstanding);
            if (applied > 0) {
                received = round2(received + applied);
                byPartyCursor.set(s.party_id, round2(used + applied));
            }
        }
        const outstandingAmount = Math.max(0, round2(total - received));
        result.push({
            id: s.id,
            invoice_no: s.invoice_no,
            date: s.date,
            party_id: s.party_id,
            grand_total: total,
            // Unrounded document value, used only to total the period exactly.
            raw_grand_total: Number(s.grand_total) || 0,
            received,
            outstanding: outstandingAmount,
            status: paymentStatus(received, total),
            linked: explicit.has(s.id),
            // Kept for reference: what the document itself claimed.
            stored_status: s.status,
            stored_paid_amount: round2(s.paid_amount || 0)
        });
    }

    const byId = new Map(result.map(r => [Number(r.id), r]));
    // Accumulate at full precision and round once, so the period totals match the
    // amounts in the database exactly instead of drifting by cents per row.
    const raw = result.reduce((acc, r) => {
        acc.total += r.raw_grand_total;
        acc.received += r.received;
        acc.count++;
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
    }, { total: 0, received: 0, count: 0, paid: 0, partial: 0, unpaid: 0 });

    const totals = {
        total: round2(raw.total),
        received: round2(raw.received),
        // Receivable view of the same receipts: sales − money received.
        outstanding: round2(raw.total - raw.received),
        count: raw.count,
        paid: raw.paid,
        partial: raw.partial,
        unpaid: raw.unpaid
    };

    // Receipts that could not be applied to any invoice in scope (money received
    // against earlier periods, or an overpayment) — reported, never silently lost.
    const allReceipts = round2(receipts.reduce((s, r) => s + (Number(r.amount) || 0), 0));
    totals.receipts_total = allReceipts;
    totals.unallocated = round2(allReceipts - totals.received);

    return { sales: result, by_id: byId, totals };
}

// ──────────────────────────────────────────────────────────────
// Cash / Bank position
// ──────────────────────────────────────────────────────────────

const NON_CASH_MODES = "('bank', 'upi', 'cheque', 'qr/bank', 'qr', 'online', 'bank transfer')";

/**
 * Cash and bank movement for a period, built from the documents so deposits,
 * receipts and payments are each counted once.
 *
 *   cash balance = cash sales + cash receipts + other cash receipts
 *                  − cash payments − cash expenses − cash deposited to bank
 *   bank balance = bank receipts + cash-to-bank deposits
 *                  − bank payments − expenses paid from bank
 *
 * @returns {object}
 */
function getCashBankPosition(db, opts = {}) {
    const { from, to } = periodBounds(opts);
    const p = [from, to];

    // ── Cash: money in ──
    // Money taken at the counter on a cash invoice. When the invoice also posted
    // its received amount as a real receipt transaction (saveSale does), that
    // receipt already counts below — the same money is never taken twice.
    const cashSales = db.prepare(
        `SELECT COALESCE(SUM(s.paid_amount), 0) as total, COUNT(*) as count
           FROM sales s
          WHERE s.${RANGE} AND LOWER(s.payment_mode) = 'cash'
            AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.reference_type = 'sale' AND p.reference_id = s.id)`
    ).get(...p);

    const cashReceipts = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM payments
          WHERE ${RANGE} AND type IN ('receipt', 'advance') AND LOWER(COALESCE(mode,'cash')) = 'cash'`
    ).get(...p);

    // ── Cash: money out ──
    const cashPayments = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM payments
          WHERE ${RANGE} AND type = 'payment' AND LOWER(COALESCE(mode,'cash')) = 'cash'`
    ).get(...p);

    const cashExpenses = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM other_expenses WHERE ${RANGE} AND LOWER(COALESCE(payment_mode,'cash')) = 'cash'`
    ).get(...p);

    const pettyCash = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM petty_cash WHERE ${RANGE}`
    ).get(...p);

    // ── Cash deposited into the bank (internal transfer, never income) ──
    const cashDepositRows = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM cash_deposits WHERE ${RANGE}`
    ).get(...p);
    const depositRefs = new Set(
        db.prepare(`SELECT deposit_no, reference_no FROM cash_deposits WHERE ${RANGE}`).all(...p)
            .flatMap(r => [String(r.deposit_no || '').trim(), String(r.reference_no || '').trim()])
            .filter(Boolean)
    );

    const bankRows = listClassifiedBankRows(db, { from_date: from, to_date: to });
    const transferRows = bankRows.filter(r => r.is_transfer);
    const expenseRows = bankRows.filter(r => r.is_expense);
    const receiptRows = bankRows.filter(r => r.accounting_class === 'customer_receipt');
    const paymentRows = bankRows.filter(r => r.accounting_class === 'supplier_payment' || r.accounting_class === 'unclassified');

    // A bank row that mirrors a cash_deposits record must not be counted again.
    const unmatchedTransfers = transferRows.filter(r => {
        const ref = String(r.reference_no || '').trim();
        return !(ref && depositRefs.has(ref));
    });
    const transferIn = round2(unmatchedTransfers.reduce((s, r) => s + (Number(r.credit) || 0), 0));
    const transferOut = round2(unmatchedTransfers.reduce((s, r) => s + (Number(r.debit) || 0), 0));
    const duplicateTransfers = transferRows.length - unmatchedTransfers.length;

    // ── Bank: money in / out ──
    const bankReceiptsDoc = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM payments
          WHERE ${RANGE} AND type IN ('receipt', 'advance') AND LOWER(COALESCE(mode,'cash')) IN ${NON_CASH_MODES}`
    ).get(...p);
    const bankPaymentsDoc = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
           FROM payments
          WHERE ${RANGE} AND type = 'payment' AND LOWER(COALESCE(mode,'cash')) IN ${NON_CASH_MODES}`
    ).get(...p);

    // Payments already reflected by an imported bank row (same reference, or the
    // same party-less date+amount) are not counted twice.
    const bankRefs = new Set(bankRows.map(r => String(r.reference_no || '').trim()).filter(Boolean));
    const docReceipts = db.prepare(
        `SELECT id, date, amount, mode, reference_type, reference_id FROM payments
          WHERE ${RANGE} AND type IN ('receipt','advance') AND LOWER(COALESCE(mode,'cash')) IN ${NON_CASH_MODES}`
    ).all(...p);
    const docPayments = db.prepare(
        `SELECT id, date, amount, mode, reference_type, reference_id FROM payments
          WHERE ${RANGE} AND type = 'payment' AND LOWER(COALESCE(mode,'cash')) IN ${NON_CASH_MODES}`
    ).all(...p);
    const dupReceipts = docReceipts.filter(r => bankRefs.has(String(r.reference_type || '').trim()));
    const dupPayments = docPayments.filter(r => bankRefs.has(String(r.reference_type || '').trim()));

    // Money into the bank: customer receipts on the statement + every recorded
    // cash deposit (both the cash_deposits register and the statement rows that
    // represent one, counted once each) + bank-mode receipts not already on the
    // statement.
    const cashToBank = round2(cashDepositRows.total + transferIn);
    const bankCustomerReceipts = round2(receiptRows.reduce((s, r) => s + (Number(r.credit) || 0), 0));
    const bankIn = round2(bankCustomerReceipts + cashToBank
        + (bankReceiptsDoc.total - dupReceipts.reduce((s, r) => s + (Number(r.amount) || 0), 0)));
    const bankExpenseOut = round2(expenseRows.reduce((s, r) => s + (Number(r.debit) || 0), 0));
    const bankOut = round2(paymentRows.reduce((s, r) => s + (Number(r.debit) || 0), 0) + transferOut + bankExpenseOut
        + (bankPaymentsDoc.total - dupPayments.reduce((s, r) => s + (Number(r.amount) || 0), 0)));

    const cashIn = round2(cashSales.total + cashReceipts.total);
    const cashOut = round2(cashPayments.total + cashExpenses.total + pettyCash.total + cashToBank);
    const cashBalance = round2(cashIn - cashOut);
    const bankBalance = round2(bankIn - bankOut);

    return {
        from_date: from,
        to_date: to,
        cash: {
            cash_sales: round2(cashSales.total),
            cash_sales_count: cashSales.count,
            cash_receipts: round2(cashReceipts.total),
            cash_receipts_count: cashReceipts.count,
            cash_payments: round2(cashPayments.total),
            cash_expenses: round2(cashExpenses.total),
            petty_cash: round2(pettyCash.total),
            deposited_to_bank: cashToBank,
            total_in: cashIn,
            total_out: cashOut,
            balance: cashBalance
        },
        bank: {
            receipts: bankIn,
            customer_receipts: bankCustomerReceipts,
            cash_deposits_in: cashToBank,
            cash_deposits_count: cashDepositRows.count + unmatchedTransfers.filter(r => (Number(r.credit) || 0) > 0).length,
            payments: round2(paymentRows.reduce((s, r) => s + (Number(r.debit) || 0), 0)),
            expenses_paid: bankExpenseOut,
            transfers_out: transferOut,
            total_in: bankIn,
            total_out: bankOut,
            balance: bankBalance
        },
        transfers: {
            cash_deposits_table: round2(cashDepositRows.total),
            bank_rows: transferRows.length,
            counted_in: transferIn,
            duplicate_of_cash_deposits: duplicateTransfers,
            out_counted: transferOut
        },
        duplicates_removed: {
            receipts: dupReceipts.length,
            payments: dupPayments.length
        },
        expense_bank_rows: expenseRows.map(r => ({
            id: r.id, date: r.date, reference_no: r.reference_no,
            counterparty_name: r.counterparty_name, description: r.description,
            amount: round2(Number(r.debit) || 0)
        })),
        // Bank-statement deposits with NO matching cash_deposits register row —
        // surfaced once by the Cash Deposit view so statement-side deposits are
        // never invisible. Same single-source rule used for cash-to-bank above.
        unmatched_transfer_rows: unmatchedTransfers.map(r => ({
            id: r.id, date: r.date, reference_no: r.reference_no,
            counterparty_name: r.counterparty_name, description: r.description,
            bank_account: r.bank_account,
            credit: round2(Number(r.credit) || 0),
            debit: round2(Number(r.debit) || 0)
        }))
    };
}

// ──────────────────────────────────────────────────────────────
// Expenses — recognised once (documents + expense-classified bank rows)
// ──────────────────────────────────────────────────────────────

/**
 * Operating expenses for the period, each counted once.
 * Documents (other_expenses, petty cash, salary, vehicle) are the recognition
 * side; an expense-classified bank row is only added when it is not already
 * represented by one of those documents (linked by reference number, then by
 * date + amount) — never by amount alone when a reference exists.
 */
function getExpenseSummary(db, opts = {}) {
    const { from, to } = periodBounds(opts);
    const p = [from, to];

    const otherExpenses = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM other_expenses WHERE ${RANGE}`
    ).get(...p);
    const petty = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM petty_cash WHERE ${RANGE}`
    ).get(...p);
    const salary = db.prepare(
        `SELECT COALESCE(SUM(net_salary), 0) as total, COUNT(*) as count FROM salary_records WHERE payment_date >= ? AND payment_date <= ?`
    ).get(...p);
    const vehicle = db.prepare(
        `SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count FROM vehicle_expenses WHERE ${RANGE}`
    ).get(...p);

    const otherIncome = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM other_expenses WHERE ${RANGE} AND category = 'Income'`
    ).get(...p);

    const knownRefs = new Set(
        db.prepare(`SELECT reference_no FROM other_expenses WHERE ${RANGE} AND COALESCE(reference_no,'') != ''`).all(...p)
            .map(r => String(r.reference_no).trim())
    );
    const knownAmounts = new Set(
        db.prepare(`SELECT date, amount FROM other_expenses WHERE ${RANGE}`).all(...p)
            .map(r => `${r.date}|${round2(r.amount)}`)
    );

    const bankExpenses = listClassifiedBankRows(db, { from_date: from, to_date: to })
        .filter(r => r.is_expense);
    const extraBankExpenses = [];
    for (const r of bankExpenses) {
        const amount = round2(Number(r.debit) || 0);
        if (amount <= 0) continue;
        const ref = String(r.reference_no || '').trim();
        if (ref && knownRefs.has(ref)) continue;                    // already recognised by reference
        if (!ref && knownAmounts.has(`${r.date}|${amount}`)) continue; // no reference → date + amount
        extraBankExpenses.push({ ...r, amount });
    }
    const bankExpenseTotal = round2(extraBankExpenses.reduce((s, r) => s + r.amount, 0));

    // Typed payments that ARE genuine P&L expenses: actual_expense (rent,
    // salary, electricity paid as a payment) and advance_adjustment (an
    // advance consumed by a real expense). Advances and loans never count —
    // payment does not automatically mean expense.
    const typedExpenses = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments
        WHERE date >= ? AND date <= ? AND transaction_type IN ('actual_expense', 'advance_adjustment')
    `).get(...p);

    const operating = round2(
        (otherExpenses.total - otherIncome.total) + petty.total + salary.total + vehicle.total + bankExpenseTotal
        + typedExpenses.total
    );

    return {
        other_expenses: round2(otherExpenses.total - otherIncome.total),
        other_income: round2(otherIncome.total),
        petty_cash: round2(petty.total),
        salary: round2(salary.total),
        vehicle_expenses: round2(vehicle.total),
        bank_expenses: bankExpenseTotal,
        typed_payment_expenses: round2(typedExpenses.total),
        typed_payment_expense_count: typedExpenses.count,
        bank_expense_rows: extraBankExpenses.map(r => ({
            id: r.id, date: r.date, reference_no: r.reference_no, description: r.description, amount: r.amount
        })),
        total_operating_expenses: operating
    };
}

// ──────────────────────────────────────────────────────────────
// Cross-module reconciliation
// ──────────────────────────────────────────────────────────────

/**
 * Reconcile every module for a period:
 *   sales = P&L sales revenue
 *   sales − customer receipts = receivable
 *   cash receipts − cash payments − cash deposited = cash balance
 *   bank receipts + cash-to-bank − bank payments = bank movement
 *   milk purchase cost recognised once
 *   each expense recognised once
 *
 * @returns {object} { period, sales, receivable, cash, bank, cost, profit, checks }
 */
function getReconciliation(db, opts = {}) {
    const { from, to } = periodBounds(opts);

    const salesTotals = db.prepare(
        `SELECT COALESCE(SUM(grand_total), 0) as total, COUNT(*) as count FROM sales WHERE ${RANGE}`
    ).get(from, to);

    const settlement = getSaleSettlements(db, { from_date: from, to_date: to });
    const milk = getMilkCostSummary(db, { from_date: from, to_date: to });
    const expenses = getExpenseSummary(db, { from_date: from, to_date: to });
    const cashBank = getCashBankPosition(db, { from_date: from, to_date: to });

    const receiptsTotal = db.prepare(
        `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM payments
          WHERE ${RANGE} AND type IN ('receipt','advance')`
    ).get(from, to);

    // Ledger-based party balances (the app's own convention, unchanged).
    const ledger = db.prepare(
        `SELECT
            COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) as receivable,
            COALESCE(SUM(CASE WHEN balance < 0 THEN -balance ELSE 0 END), 0) as payable
         FROM (
            SELECT (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) as balance
              FROM parties p LEFT JOIN ledger_entries le ON le.party_id = p.id
             GROUP BY p.id
         )`
    ).get();

    const receivable = round2(salesTotals.total - receiptsTotal.total);
    const totalIncome = round2(salesTotals.total);
    const totalExpenses = round2(milk.cogs + expenses.total_operating_expenses);
    const netProfit = round2(totalIncome - totalExpenses);

    const checks = [];
    const check = (key, label, expected, actual, tol = 1) => {
        const difference = round2(actual - expected);
        checks.push({
            key, label,
            expected: round2(expected), actual: round2(actual), difference,
            ok: Math.abs(difference) <= tol
        });
    };

    check('sales_vs_settlement', 'Sales total = sum of sale settlements', salesTotals.total, settlement.totals.total);
    check('receivable_from_sales', 'Sales − customer receipts = receivable', receivable,
        round2(settlement.totals.total - receiptsTotal.total));
    check('settlement_parts', 'Sales = received + outstanding (per invoice)', settlement.totals.total,
        round2(settlement.totals.received + settlement.totals.outstanding));
    check('milk_cost_once', 'Milk cost = collections + unlinked raw-milk purchase lines', milk.milk_cost,
        round2(milk.milk_collections + milk.unlinked_milk_lines));
    // Independent of how `cogs` is assembled internally: taking the gross purchase
    // register and adding the milk only for the collections that no bill already
    // carries must land on the same COGS. If the linked milk were counted twice,
    // the two sides would differ by exactly `linked_to_purchase`.
    check('milk_never_double', 'COGS never adds the linked milk a second time',
        round2(milk.purchases_total + milk.milk_collections - milk.linked_to_purchase),
        milk.cogs);
    check('cogs_parts', 'COGS = milk cost (once) + non-milk purchases', milk.cogs,
        round2(milk.milk_cost + milk.non_milk_purchases));
    check('expenses_total', 'Operating expenses = sum of their parts', expenses.total_operating_expenses,
        round2(expenses.other_expenses + expenses.petty_cash + expenses.salary + expenses.vehicle_expenses + expenses.bank_expenses));
    check('cash_balance', 'Cash receipts + other receipts − payments − deposits = cash balance', cashBank.cash.balance,
        round2(cashBank.cash.total_in - cashBank.cash.total_out));
    check('bank_balance', 'Bank receipts + cash deposits − bank payments = bank balance', cashBank.bank.balance,
        round2(cashBank.bank.total_in - cashBank.bank.total_out));
    // Income is sales + other income only: bank deposits / transfers contribute nothing.
    check('transfers_not_income', 'Income = sales + other income (deposits are not income)',
        round2(salesTotals.total + expenses.other_income), totalIncome);

    return {
        from_date: from,
        to_date: to,
        sales: {
            total: round2(salesTotals.total),
            count: salesTotals.count,
            received: settlement.totals.received,
            outstanding: settlement.totals.outstanding,
            paid_count: settlement.totals.paid || 0,
            partial_count: settlement.totals.partial || 0,
            unpaid_count: settlement.totals.unpaid || 0
        },
        receivable: {
            from_sales_minus_receipts: receivable,
            customer_receipts: round2(receiptsTotal.total),
            receipt_count: receiptsTotal.count,
            ledger_receivable: round2(ledger.receivable),
            ledger_payable: round2(ledger.payable),
            difference_vs_ledger: round2(ledger.receivable - receivable)
        },
        cash: cashBank.cash,
        bank: cashBank.bank,
        transfers: cashBank.transfers,
        cost: {
            milk_cost: milk.milk_cost,
            milk_collections: milk.milk_collections,
            linked_to_purchase: milk.linked_to_purchase,
            unlinked_milk_lines: milk.unlinked_milk_lines,
            purchases_total: milk.purchases_total,
            non_milk_purchases: milk.non_milk_purchases,
            cogs: milk.cogs
        },
        expenses: {
            other_expenses: expenses.other_expenses,
            petty_cash: expenses.petty_cash,
            salary: expenses.salary,
            vehicle_expenses: expenses.vehicle_expenses,
            bank_expenses: expenses.bank_expenses,
            total_operating_expenses: expenses.total_operating_expenses
        },
        profit: {
            total_income: totalIncome,
            total_expenses: totalExpenses,
            gross_profit: round2(totalIncome - milk.cogs),
            net_profit: netProfit
        },
        checks
    };
}

/**
 * Double-entry rule for a payment row by transaction_type.
 * Returns null for legacy/untyped rows — they keep their historical
 * settlement treatment (receipt→receivable, payment→payable).
 *
 * Rules (master spec):
 *   advance            Cash/Bank CR, Advance Receivable DR — never P&L
 *   loan_given         Cash/Bank CR, Loan Receivable DR — never P&L
 *   loan_received      Cash/Bank DR, Loan Payable CR — never income
 *   loan_repayment     receiving: Cash DR / Loan Receivable CR;
 *                      repaying:  Loan Payable DR / Cash-Bank CR — never P&L
 *   advance_adjustment Advance Receivable CR / (Expense or Purchase) DR —
 *                      only the underlying expense/purchase hits P&L
 *   actual_expense     Expense DR / Cash-Bank CR
 */
function getPaymentPostingRule(t = {}) {
    const tt = String(t.transaction_type || '').toLowerCase();
    const money = String(t.mode || '').toLowerCase() === 'cash' ? ACCOUNT.CASH : ACCOUNT.BANK;
    switch (tt) {
        case TRANSACTION_TYPES.ACTUAL_EXPENSE:
            return { kind: 'expense', debit_account: ACCOUNT.EXPENSE, credit_account: money, pnl: 'expense' };
        case TRANSACTION_TYPES.ADVANCE:
            return { kind: 'advance_receivable', debit_account: ACCOUNT.ADVANCE_RECEIVABLE, credit_account: money, pnl: null };
        case TRANSACTION_TYPES.ADVANCE_RETURNED:
            // The advance holder gave the money back: Cash/Bank DR,
            // Advance Receivable CR. Reduces the receivable, no P&L.
            return { kind: 'advance_returned', debit_account: money, credit_account: ACCOUNT.ADVANCE_RECEIVABLE, pnl: null };
        case TRANSACTION_TYPES.LOAN_GIVEN:
            return { kind: 'loan_receivable', debit_account: ACCOUNT.LOAN_RECEIVABLE, credit_account: money, pnl: null };
        case TRANSACTION_TYPES.LOAN_RECEIVED:
            return { kind: 'loan_payable', debit_account: money, credit_account: ACCOUNT.LOAN_PAYABLE, pnl: null };
        case TRANSACTION_TYPES.LOAN_REPAYMENT:
            // direction 'in' = we receive repayment; 'out' (default) = we repay
            return String(t.direction).toLowerCase() === 'in'
                ? { kind: 'loan_receive_repayment', debit_account: money, credit_account: ACCOUNT.LOAN_RECEIVABLE, pnl: null }
                : { kind: 'loan_repay', debit_account: ACCOUNT.LOAN_PAYABLE, credit_account: money, pnl: null };
        case TRANSACTION_TYPES.ADVANCE_ADJUSTMENT:
            // The advance is consumed by a real expense: Advance Receivable CR
            // (it reduces) and the underlying Expense/Purchase DR hits P&L.
            // No cash moves — the money left at advance time.
            return { kind: 'advance_adjustment', debit_account: ACCOUNT.EXPENSE, credit_account: ACCOUNT.ADVANCE_RECEIVABLE, pnl: 'expense' };
        case TRANSACTION_TYPES.SETTLEMENT:
            return null; // ordinary receivable/payable settlement
        case TRANSACTION_TYPES.OTHER:
            return null;
        default:
            return null;
    }
}

/**
 * Loan & advance balances (balance sheet) as of a date.
 * Reads ledger_entries by account-tagged descriptions written by savePayment
 * ('[Advance Receivable]', '[Loan / Sapati Receivable]', '[Loan / Sapati Payable]').
 */
function getLoanAdvanceBalances(db, { as_of } = {}) {
    const tagMap = {
        [ACCOUNT.ADVANCE_RECEIVABLE]: 'advance_receivable',
        [ACCOUNT.LOAN_RECEIVABLE]: 'loan_receivable',
        [ACCOUNT.LOAN_PAYABLE]: 'loan_payable'
    };
    const where = as_of ? "AND date <= ?" : "";
    const params = as_of ? [as_of] : [];
    const out = { advance_receivable: 0, loan_receivable: 0, loan_payable: 0 };
    for (const [tag, key] of Object.entries(tagMap)) {
        const rows = db.prepare(`
            SELECT debit, credit FROM ledger_entries
            WHERE description LIKE ? ${where}
        `).all(`%[${tag}]%`, ...params);
        out[key] = round2(rows.reduce((s, r) => s + (Number(r.debit) || 0) - (Number(r.credit) || 0), 0));
    }
    // Loan payable is a credit-natured account: report its balance positively.
    out.loan_payable = round2(-out.loan_payable);
    return out;
}

// ──────────────────────────────────────────────────────────────
// Advance recovery register (balance sheet control — spec Phase 9)
// ──────────────────────────────────────────────────────────────

/** Age of a BS date (in days) relative to `as_of`, via real AD dates. */
function _bsAgeDays(fromBS, toBS) {
    try {
        const { bsToAD } = require('../excel-import');
        const a = bsToAD(fromBS), b = bsToAD(toBS);
        if (!a || !b) return 0;
        return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
    } catch (e) { return 0; }
}

/** Ageing bucket label for an advance outstanding at `age` days old. */
function _ageBucket(age) {
    if (age >= 90) return '90+';
    if (age >= 60) return '60+';
    if (age >= 30) return '30+';
    if (age >= 7) return '7+';
    return 'current';
}

/**
 * Advance Recovery Register (spec Phase 9): per-advance outstanding with what
 * was adjusted against an approved expense and what was returned in cash.
 *
 * Source of truth: the EXISTING `[Advance Receivable]`-tagged ledger rows
 * (the same rows getLoanAdvanceBalances totals), allocated FIFO per party so
 * every rupee of recovery is traced back to the advance it clears:
 *
 *   Outstanding = Advance Given − Returned − Properly Adjusted
 *
 * A credit row whose source payment is typed `advance_adjustment` is an
 * ADJUSTMENT (it already reached the P&L as a real expense); every other
 * tagged credit is a RETURN of cash. No new table, no new posting rule.
 *
 * @param {object} db
 * @param {object} opts - { as_of (BS date, default today), party_id }
 * @returns {object} { as_of, lots, movements, summary, checks }
 *   summary: { advance_given, adjusted, returned, total_outstanding,
 *              current, overdue, bucket_7, bucket_30, bucket_60, bucket_90 }
 */
function getAdvanceRecoveryRegister(db, { as_of, party_id, from_date, to_date } = {}) {
    // `to_date` doubles as the as-of cutoff: the register is always computed
    // complete up to that day, then (optionally) filtered to advances GIVEN
    // inside the period. Checks always run against the FULL register so the
    // register-vs-balance-sheet guarantee never depends on the display filter.
    let cutoff = to_date || as_of;
    if (!cutoff) {
        const { todayBSDate } = require('../excel-import');
        cutoff = todayBSDate();
    }

    let sql = `SELECT id, party_id, date, reference_type, reference_id, description, debit, credit
                 FROM ledger_entries
                WHERE description LIKE '%[${ACCOUNT.ADVANCE_RECEIVABLE}]%'
                  AND date <= ?`;
    const params = [cutoff];
    if (party_id) { sql += ' AND party_id = ?'; params.push(party_id); }
    sql += ' ORDER BY date, id';
    const rows = db.prepare(sql).all(...params);

    // Batch-resolve the source payments so each credit row can be classified.
    const paymentIds = [...new Set(rows
        .filter(r => r.credit > 0 && r.reference_id != null)
        .map(r => r.reference_id))];
    const ttById = new Map();
    if (paymentIds.length) {
        const ph = paymentIds.map(() => '?').join(',');
        for (const p of db.prepare(`SELECT id, transaction_type FROM payments WHERE id IN (${ph})`).all(...paymentIds)) {
            ttById.set(p.id, String(p.transaction_type || ''));
        }
    }
    const partyIds = [...new Set(rows.map(r => r.party_id).filter(v => v != null))];
    const names = new Map();
    if (partyIds.length) {
        const ph = partyIds.map(() => '?').join(',');
        for (const p of db.prepare(`SELECT id, name FROM parties WHERE id IN (${ph})`).all(...partyIds)) names.set(p.id, p.name);
    }

    const byParty = new Map();
    for (const r of rows) {
        const key = r.party_id || 0;
        if (!byParty.has(key)) byParty.set(key, []);
        byParty.get(key).push(r);
    }

    let lots = [];
    let movements = [];
    for (const [pid, list] of byParty) {
        const open = []; // FIFO advance lots still holding money
        for (const r of list) {
            const name = names.get(pid) || (pid ? `Party #${pid}` : '(unassigned)');
            if (Number(r.debit) > 0) {
                const amt = round2(r.debit);
                open.push({ ledger_id: r.id, party_id: pid, party_name: name, date: r.date, advance: amt, adjusted: 0, returned: 0, outstanding: amt });
                movements.push({ ledger_id: r.id, party_id: pid, party_name: name, date: r.date, kind: 'given', amount: amt, particular: r.description });
                continue;
            }
            const credit = round2(r.credit);
            if (!(credit > 0)) continue;
            // The receivable leg of an adjustment posts with reference_type
            // 'advance' (the expense leg carries 'adjustment'), so the source
            // payment's transaction_type is what decides the classification.
            const isAdjustment = ttById.get(r.reference_id) === TRANSACTION_TYPES.ADVANCE_ADJUSTMENT;
            const kind = isAdjustment ? 'adjusted' : 'returned';
            let left = credit;
            for (const lot of open) {
                if (left <= 0.005 || lot.outstanding <= 0.005) continue;
                const take = Math.min(left, lot.outstanding);
                if (kind === 'adjusted') lot.adjusted = round2(lot.adjusted + take);
                else lot.returned = round2(lot.returned + take);
                lot.outstanding = round2(lot.outstanding - take);
                left = round2(left - take);
            }
            movements.push({ ledger_id: r.id, party_id: pid, party_name: name, date: r.date, kind, amount: credit, particular: r.description });
        }
        for (const lot of open) {
            lot.age_days = _bsAgeDays(lot.date, cutoff);
            lot.due_status = lot.outstanding > 0.005 ? _ageBucket(lot.age_days) : 'settled';
            lots.push(lot);
        }
    }
    lots.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.party_id - b.party_id);
    movements.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.ledger_id - b.ledger_id);

    const sum = (f) => round2(lots.reduce((s, l) => s + (Number(l[f]) || 0), 0));
    const out = (minAge, maxAge) => round2(lots.filter(l => l.age_days >= minAge && (maxAge === undefined || l.age_days < maxAge))
        .reduce((s, l) => s + (Number(l.outstanding) || 0), 0));
    let summary = {
        advance_given: round2(movements.filter(m => m.kind === 'given').reduce((s, m) => s + m.amount, 0)),
        adjusted: round2(movements.filter(m => m.kind === 'adjusted').reduce((s, m) => s + m.amount, 0)),
        returned: round2(movements.filter(m => m.kind === 'returned').reduce((s, m) => s + m.amount, 0)),
        total_outstanding: sum('outstanding'),
        open_advances: lots.filter(l => l.outstanding > 0.005).length,
        current: out(0, 7),
        overdue: out(7),
        bucket_7: out(7),
        bucket_30: out(30),
        bucket_60: out(60),
        bucket_90: out(90)
    };

    // The register must never disagree with the balance it is a register OF.
    // Computed on the FULL (unfiltered) register — period filtering below is a
    // display filter and must not weaken this guarantee.
    const balances = getLoanAdvanceBalances(db, { as_of: cutoff });
    const checks = [{
        name: 'Register outstanding = Advance Receivable balance',
        expected: balances.advance_receivable,
        actual: summary.total_outstanding,
        ok: Math.abs(round2(balances.advance_receivable) - summary.total_outstanding) <= 0.01
    }, {
        name: 'Given = returned + adjusted + outstanding',
        expected: round2(summary.advance_given),
        actual: round2(summary.returned + summary.adjusted + summary.total_outstanding),
        ok: Math.abs(round2(summary.advance_given) - round2(summary.returned + summary.adjusted + summary.total_outstanding)) <= 0.01
    }];

    const fullSummary = summary;
    const from = from_date ? String(from_date) : '';
    if (from) {
        // Period view: only advances GIVEN on/after `from`. Each kept lot carries
        // its full adjustment/return history up to the cutoff, so its outstanding
        // stays correct and the per-lot identity still holds across the filtered set.
        lots = lots.filter(l => String(l.date) >= from);
        movements = movements.filter(m => String(m.date) >= from);
        summary = {
            advance_given: round2(lots.reduce((s, l) => s + (Number(l.advance) || 0), 0)),
            adjusted: round2(lots.reduce((s, l) => s + (Number(l.adjusted) || 0), 0)),
            returned: round2(lots.reduce((s, l) => s + (Number(l.returned) || 0), 0)),
            total_outstanding: round2(lots.reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            open_advances: lots.filter(l => l.outstanding > 0.005).length,
            current: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days < 7).reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            overdue: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days >= 7).reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            bucket_7: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days >= 7).reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            bucket_30: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days >= 30).reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            bucket_60: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days >= 60).reduce((s, l) => s + (Number(l.outstanding) || 0), 0)),
            bucket_90: round2(lots.filter(l => l.outstanding > 0.005 && l.age_days >= 90).reduce((s, l) => s + (Number(l.outstanding) || 0), 0))
        };
    }

    return {
        as_of: cutoff, from_date: from || null, filtered: !!from,
        lots, movements, summary, full_summary: fullSummary,
        checks, all_checks_ok: checks.every(c => c.ok)
    };
}

module.exports = {
    // money
    round2, moneyEq, moneyGte, CURRENCY_TOLERANCE, paymentStatus,
    // accounts
    ACCOUNT, TRANSACTION_TYPES, TRANSACTION_TYPE_VALUES, classifyTransaction, getPaymentPostingRule,
    getLoanAdvanceBalances,
    // milk / purchases
    getMilkCostSummary, getLinkedMilkByBill, getLinkedMilkByMonth, detectMilkLine,
    // bank classification
    classifyBankRow, listClassifiedBankRows,
    // sales settlement
    getSaleSettlements, isCustomerReceipt,
    // cash / bank / expenses
    getCashBankPosition, getExpenseSummary,
    // advances / loans
    getAdvanceRecoveryRegister,
    // reconciliation
    getReconciliation
};
