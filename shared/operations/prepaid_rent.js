/**
 * Prarambha Account & Stock Management — Prepaid Expenses (advance rent)
 * =====================================================================
 * A payment for FUTURE use is an asset, not an expense. Expensing the whole
 * six-month rent cheque in the month it left the bank understates that month's
 * profit and overstates every later month's.
 *
 * This module keeps ONE record per prepaid payment and derives the monthly
 * recognition from it:
 *
 *   payment date  →  Debit  Prepaid Rent (asset)   /  Credit Cash-Bank
 *   each month    →  Debit  Rent Expense           /  Credit Prepaid Rent
 *
 * The cash movement is recorded by the payment itself (the operator enters it
 * in Petty Cash / Bank as an advance). Recognition is derived, never posted as
 * a second transaction, so the same rent can never be expensed twice.
 *
 * The real transaction this was built for (from the operator's workbook
 * PETTY CASH register, row dated 2083-06-30 = AD 2026-10-16):
 *
 *   SAI KRIPA KSS LTD · Rs 910,000 · cash
 *   "PAID TO SAIKRIPA FOR 6 MONTH ADVANCE RENT"
 *
 * => Rs 151,666.67 per month for six rental months starting 2083-07 (Kartik).
 * The start month is stored on the record (not inferred), so a different lease
 * period is a data change, not a code change.
 *
 * Dates are BS strings; month arithmetic uses shared/bs-calendar.js so a
 * 29/30/31/32-day month is pro-rated on its real day count.
 */

const {
    validateBSDate, validateBSRange, normalizeBSDate, getBSDaysInMonth,
    bsMonthRange, shiftBSMonth, bsMonthLabel, todayBSDate, pad2
} = require('../bs-calendar');
const accounting = require('./accounting');
const { logAudit } = require('./audit');

const round2 = accounting.round2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prepaid_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Rent',
    party_id INTEGER DEFAULT NULL,
    party_name TEXT DEFAULT '',
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0.0,
    months INTEGER NOT NULL DEFAULT 1,
    start_month TEXT NOT NULL,
    payment_mode TEXT DEFAULT 'cash',
    reference_no TEXT DEFAULT '',
    source TEXT DEFAULT 'manual',
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_expenses_date ON prepaid_expenses(payment_date);
`;

function ensureSchema(db) {
    db.exec(SCHEMA);
}

/** Month keys covered by a record: start_month .. start_month + months − 1. */
function coveredMonths(record) {
    const out = [];
    let key = record.start_month;
    for (let i = 0; i < Number(record.months || 0); i++) {
        const range = bsMonthRange(key);
        if (!range) break;
        out.push(range);
        key = shiftBSMonth(key, 1);
    }
    return out;
}

/**
 * Recognised expense for one record between two BS dates (inclusive), plus the
 * asset balance left at `to_date`.
 *
 * Recognition is monthly (amount ÷ months) pro-rated by the real number of
 * days the period overlaps each rental month. A period that is exactly one
 * rental month therefore recognises exactly one monthly share.
 */
function recognizeRecord(record, fromDate, toDate) {
    const amount = round2(record.amount);
    // Before the cheque is written there is no asset and no expense.
    if (String(toDate) < String(record.payment_date)) {
        return {
            id: record.id, name: record.name, party_name: record.party_name,
            payment_date: record.payment_date, amount, months: Number(record.months) || 1,
            monthly_amount: round2(amount / (Number(record.months) || 1)),
            start_month: record.start_month, start_month_label: bsMonthLabel(record.start_month),
            end_month: null, period_expense: 0, recognized_to_date: 0,
            prepaid_balance: 0, schedule: []
        };
    }
    const months = Number(record.months) || 1;
    const monthly = round2(amount / months);
    // The last month absorbs the rounding residual so the six recognised months
    // add up to exactly the amount paid (151666.67 × 6 = 910000.02 otherwise).
    const base = coveredMonths(record);
    const monthsCovered = base.map((m, i) => ({
        ...m,
        monthly: i === base.length - 1 ? round2(amount - monthly * (base.length - 1)) : monthly
    }));
    let periodAmount = 0;
    let recognizedToDate = 0;

    for (const m of monthsCovered) {
        const days = m.days;
        // Days of this rental month inside [fromDate, toDate].
        const overlapFrom = fromDate > m.from_date ? fromDate : m.from_date;
        const overlapTo = toDate < m.to_date ? toDate : m.to_date;
        if (overlapFrom <= overlapTo) {
            const n = dayCount(overlapFrom, overlapTo);
            periodAmount = round2(periodAmount + round2((m.monthly * n) / days));
        }
        // Everything up to toDate (for the closing asset balance).
        if (toDate >= m.from_date) {
            const to = toDate < m.to_date ? toDate : m.to_date;
            recognizedToDate = round2(recognizedToDate + round2((m.monthly * dayCount(m.from_date, to)) / days));
        }
    }

    // Never recognise more than was paid, and round only at the end.
    const recognized = Math.min(amount, round2(recognizedToDate));
    return {
        id: record.id,
        name: record.name,
        party_name: record.party_name,
        payment_date: record.payment_date,
        amount,
        months,
        monthly_amount: monthly,
        start_month: record.start_month,
        start_month_label: bsMonthLabel(record.start_month),
        end_month: monthsCovered.length ? monthsCovered[monthsCovered.length - 1].from_date.slice(0, 7) : null,
        period_expense: round2(periodAmount),
        recognized_to_date: recognized,
        prepaid_balance: round2(amount - recognized),
        schedule: monthsCovered.map(m => ({ ...m, label: bsMonthLabel(m.from_date.slice(0, 7)), monthly }))
    };
}

function dayCount(fromBS, toBS) {
    const { bsToAD } = require('../bs-calendar');
    const a = bsToAD(fromBS), b = bsToAD(toBS);
    if (!a || !b) return 0;
    return Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000) + 1;
}

function listRecords(db) {
    ensureSchema(db);
    return db.prepare('SELECT * FROM prepaid_expenses ORDER BY payment_date, id').all();
}

/**
 * Prepaid summary for a BS period.
 * @returns {{
 *   from_date:string, to_date:string, records:Array,
 *   rent_expense:number, other_prepaid_expense:number, total_expense:number,
 *   paid_in_period:number, closing_balance:number, closing_by_category:object,
 *   schedule:Array
 * }}
 */
function getPrepaidSummary(db, { from_date, to_date } = {}) {
    ensureSchema(db);
    const range = validateBSRange(from_date, to_date);
    if (!range.valid) throw new Error(range.reason);

    const rows = listRecords(db).map(r => ({ record: r, calc: recognizeRecord(r, range.from_date, range.to_date) }));
    const sumBy = (cat) => round2(rows
        .filter(x => String(x.record.category || '').toLowerCase() === cat)
        .reduce((s, x) => s + x.calc.period_expense, 0));

    const closingByCategory = {};
    for (const x of rows) {
        const key = x.record.category || 'Other';
        closingByCategory[key] = round2((closingByCategory[key] || 0) + x.calc.prepaid_balance);
    }

    const paidInPeriod = round2(rows
        .filter(x => x.record.payment_date >= range.from_date && x.record.payment_date <= range.to_date)
        .reduce((s, x) => s + x.calc.amount, 0));

    return {
        from_date: range.from_date,
        to_date: range.to_date,
        records: rows.map(x => x.calc),
        rent_expense: sumBy('rent'),
        other_prepaid_expense: round2(rows
            .filter(x => String(x.record.category || '').toLowerCase() !== 'rent')
            .reduce((s, x) => s + x.calc.period_expense, 0)),
        total_expense: round2(rows.reduce((s, x) => s + x.calc.period_expense, 0)),
        paid_in_period: paidInPeriod,
        closing_balance: round2(rows.reduce((s, x) => s + x.calc.prepaid_balance, 0)),
        closing_by_category: closingByCategory
    };
}

/** Prepaid asset balance as of a BS date (all categories). */
function getPrepaidBalance(db, asOf) {
    const asOfDate = normalizeBSDate(asOf) || todayBSDate();
    ensureSchema(db);
    return round2(listRecords(db)
        .map(r => recognizeRecord(r, asOfDate, asOfDate).prepaid_balance)
        .reduce((s, v) => s + v, 0));
}

/**
 * Record a prepaid payment. Validates every field; refuses a duplicate
 * (same name + payment date + amount) so the same cheque cannot be entered
 * twice.
 */
function savePrepaidExpense(db, data = {}, changedBy = null) {
    ensureSchema(db);
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Name is required (e.g. "Advance rent — SAI KRIPA KSS LTD")');

    const paymentDate = normalizeBSDate(data.payment_date);
    const dateCheck = validateBSDate(data.payment_date);
    if (!dateCheck.valid) throw new Error('Payment date: ' + dateCheck.reason);

    const amount = round2(data.amount);
    if (!(amount > 0)) throw new Error('Amount must be greater than zero');

    const months = parseInt(data.months, 10);
    if (!(months >= 1 && months <= 60)) throw new Error('Months must be between 1 and 60');

    const startMonth = String(data.start_month || '').slice(0, 7);
    if (!bsMonthRange(startMonth)) throw new Error('Start month must be a valid BS month (YYYY-MM)');
    if (startMonth < paymentDate.slice(0, 7)) {
        throw new Error('Start month cannot be before the payment month');
    }

    const party = data.party_id
        ? db.prepare('SELECT id, name FROM parties WHERE id = ?').get(data.party_id)
        : null;

    const existing = db.prepare(
        'SELECT * FROM prepaid_expenses WHERE name = ? AND payment_date = ? AND amount = ?'
    ).get(name, paymentDate, amount);
    if (existing) {
        return { success: true, id: existing.id, duplicate: true, record: existing };
    }

    const info = db.prepare(`
        INSERT INTO prepaid_expenses
            (name, category, party_id, party_name, payment_date, amount, months, start_month,
             payment_mode, reference_no, source, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        name,
        String(data.category || 'Rent').trim() || 'Rent',
        party ? party.id : (data.party_id || null),
        party ? party.name : String(data.party_name || '').trim(),
        paymentDate,
        amount,
        months,
        startMonth,
        String(data.payment_mode || 'cash').toLowerCase(),
        String(data.reference_no || '').trim(),
        String(data.source || 'manual'),
        String(data.notes || '').trim(),
        changedBy
    );

    const record = db.prepare('SELECT * FROM prepaid_expenses WHERE id = ?').get(info.lastInsertRowid);
    try {
        logAudit(db, 'prepaid_expenses', record.id, 'create', null, {
            name: record.name, payment_date: record.payment_date, amount: record.amount,
            months: record.months, start_month: record.start_month, source: record.source
        }, changedBy);
    } catch (e) { /* audit optional */ }

    return { success: true, id: record.id, duplicate: false, record };
}

/**
 * The actual six-month advance rent found in the operator's workbook.
 * Idempotent: running it twice never creates a second payment.
 */
const ADVANCE_RENT = {
    name: 'Advance rent — 6 months (SAI KRIPA KSS LTD)',
    category: 'Rent',
    party_name: 'SAI KRIPA KSS LTD',
    payment_date: '2083-06-30',       // AD 2026-10-16, per the PETTY CASH register
    amount: 910000,
    months: 6,
    start_month: '2083-07',           // first rental month: Kartik 2083
    payment_mode: 'cash',
    reference_no: 'PETTY-2083-06-30-RENT',
    source: 'workbook:PETTY CASH row 183 / Party_Ledger 2083-06-30',
    notes: 'PAID TO SAIKRIPA FOR 6 MONTH ADVANCE RENT. Six rental months from 2083-07 '
        + '(Kartik) at Rs 151,666.67/month. Recorded as Prepaid Rent (asset); '
        + 'recognised month by month, never expensed in full on the payment date.'
};

function seedAdvanceRent(db, changedBy = null) {
    ensureSchema(db);
    if (!validateBSDate(ADVANCE_RENT.payment_date).valid) {
        throw new Error('The workbook rent date is not valid in the BS calendar');
    }
    let party = db.prepare('SELECT id, name FROM parties WHERE UPPER(TRIM(name)) = ?')
        .get(ADVANCE_RENT.party_name.toUpperCase());
    if (!party) {
        party = db.prepare("SELECT id, name FROM parties WHERE UPPER(name) LIKE '%SAI%KRIPA%' LIMIT 1").get();
    }
    return savePrepaidExpense(db, {
        ...ADVANCE_RENT,
        party_id: party ? party.id : null
    }, changedBy);
}

module.exports = {
    ensureSchema,
    coveredMonths,
    recognizeRecord,
    listRecords,
    getPrepaidSummary,
    getPrepaidBalance,
    savePrepaidExpense,
    seedAdvanceRent,
    ADVANCE_RENT
};
