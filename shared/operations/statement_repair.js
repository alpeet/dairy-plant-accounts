/**
 * Party-statement repair — make sure every party-linked register row has
 * exactly one statement posting.
 *
 * Why this exists
 * ---------------
 * The Excel importer used to insert PETTY CASH and Expenses rows without a
 * party and without any ledger posting, and a fresh import explicitly skipped
 * the Payment register's ledger post. A fresh import therefore rebuilt the
 * registers but left the supplier statement empty of those debits.
 *
 * The importer is fixed, but databases imported by the old code still hold the
 * rows with no posting. This runs at startup (after the date migration) and
 * again at the end of an import. It is idempotent, writes nothing twice, and
 * never changes a register row's date, amount, voucher number or party.
 *
 * Rules
 *   payments   (type payment / receipt, transaction_type advance …)
 *                → postPaymentLedger once, unless a ledger row already
 *                  references the payment id.
 *   petty_cash (party linked, not ADVANCE)
 *                → one tagged PETTY: row, unless a payment row for the same
 *                  party + date + amount already carries the account (the
 *                  Payment/Advance sheet voucher), or the PETTY row exists.
 *   other_expenses (party linked, not income)
 *                → EXPENSE: bill credit + EXPENSE: paid debit, unless present.
 *
 * Nothing is guessed: rows without a party are untouched.
 */

const paymentsOps = require('./payments');
const { postPettyLedgerRow } = require('./petty_cash');
const { postExpenseLedger, isIncomeCategory } = require('./expenses');

const MONEY_EPS = 0.005;

function hasLedgerForPayment(db, paymentId) {
    return !!db.prepare(
        "SELECT 1 FROM ledger_entries WHERE reference_id = ? AND reference_type IN ('payment_made','payment_received','advance','adjustment') LIMIT 1"
    ).get(paymentId);
}

function ensurePartyStatementRows(db) {
    const report = { payments_posted: 0, petty_posted: 0, expenses_posted: 0, skipped: 0, errors: [] };
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ledger_entries'").get()) return report;

    const tx = db.transaction(() => {
        // ── 1. Payments ────────────────────────────────────────────────
        let pays = [];
        try {
            pays = db.prepare(
                `SELECT id, party_id, date, accounting_date, type, transaction_type, amount, mode, notes
                   FROM payments
                  WHERE party_id IS NOT NULL
                    AND (type = 'payment' OR transaction_type IN ('advance','advance_returned','actual_expense','loan_given','loan_repayment','advance_adjustment'))`
            ).all();
        } catch (e) { pays = []; }
        // A Collection receipt already has its own payment_received row (keyed
        // to the collection id), so money-in rows are deliberately not repaired
        // here — posting them by party/date/amount would double the credit.
        for (const p of pays) {
            try {
                if (hasLedgerForPayment(db, p.id)) { report.skipped++; continue; }
                // Payment/advance rows imported before reference ids were kept:
                // the register's own debit on the same day for the same amount is
                // the same voucher, never a second payment.
                const twin = db.prepare(
                    "SELECT 1 FROM ledger_entries WHERE party_id = ? AND date = ? AND reference_type IN ('payment_made','advance') AND ABS(debit - ?) < 0.005 LIMIT 1"
                ).get(p.party_id, p.date, p.amount);
                if (twin) { report.skipped++; continue; }
                paymentsOps.postPaymentLedger(db, {
                    id: p.id, party_id: p.party_id, date: p.date,
                    accounting_date: p.accounting_date || p.date,
                    type: p.type, transaction_type: p.transaction_type,
                    amount: p.amount, mode: p.mode
                }, p.notes || '');
                report.payments_posted++;
            } catch (e) {
                report.errors.push(`payment ${p.id}: ${e.message}`);
            }
        }

        // ── 2. Petty cash vouchers ─────────────────────────────────────
        let petty = [];
        try {
            petty = db.prepare(
                `SELECT id, party_id, date, accounting_date, voucher_no,
                        expense_head, description, amount
                   FROM petty_cash
                  WHERE party_id IS NOT NULL`
            ).all();
        } catch (e) { petty = []; }
        const paymentKey = (partyId, date, amount) =>
            `${partyId}|${date}|${Math.round((Number(amount) || 0) * 100)}`;
        const covered = new Set();
        try {
            for (const l of db.prepare(
                "SELECT party_id, date, debit FROM ledger_entries WHERE debit > 0 AND reference_type IN ('payment_made','advance')"
            ).all()) {
                covered.add(paymentKey(l.party_id, l.date, l.debit));
            }
        } catch (e) { /* ledger shape */ }

        for (const pc of petty) {
            try {
                const isAdvance = String(pc.expense_head || '').trim().toUpperCase() === 'ADVANCE';
                const tagged = db.prepare(
                    "SELECT 1 FROM ledger_entries WHERE reference_type='adjustment' AND reference_id=? AND description LIKE 'PETTY:%' LIMIT 1"
                ).get(pc.id);
                // The voucher's own payment row already carries an ADVANCE.
                if (tagged || (isAdvance && covered.has(paymentKey(pc.party_id, pc.date, pc.amount)))) {
                    report.skipped++;
                    continue;
                }
                // A Payment/Expenses sheet voucher also lives in `payments`; its
                // payment row is the statement line, the petty row is cash only.
                if (!isAdvance && covered.has(paymentKey(pc.party_id, pc.date, pc.amount))) {
                    report.skipped++;
                    continue;
                }
                postPettyLedgerRow(db, pc, pc.party_id);
                report.petty_posted++;
            } catch (e) {
                report.errors.push(`petty ${pc.id}: ${e.message}`);
            }
        }

        // ── 3. Expenses ────────────────────────────────────────────────
        let expenses = [];
        try {
            expenses = db.prepare(
                `SELECT id, party_id, date, accounting_date, category, expense_head, reference_no,
                        amount, paid_amount, payment_mode
                   FROM other_expenses
                  WHERE party_id IS NOT NULL`
            ).all();
        } catch (e) { expenses = []; }
        for (const ex of expenses) {
            try {
                if (isIncomeCategory(ex.category)) { report.skipped++; continue; }
                const tagged = db.prepare(
                    "SELECT 1 FROM ledger_entries WHERE reference_type='adjustment' AND reference_id=? AND description LIKE 'EXPENSE:%' LIMIT 1"
                ).get(ex.id);
                if (tagged) { report.skipped++; continue; }
                postExpenseLedger(db, ex.id, {
                    party_id: ex.party_id, category: ex.category,
                    head: ex.expense_head || ex.category,
                    reference_no: ex.reference_no || '',
                    date: ex.date, accounting_date: ex.accounting_date || ex.date,
                    amount: ex.amount, paid_amount: ex.paid_amount || 0,
                    mode: ex.payment_mode || 'cash'
                });
                report.expenses_posted++;
            } catch (e) {
                report.errors.push(`expense ${ex.id}: ${e.message}`);
            }
        }
    });
    tx();

    if (report.payments_posted || report.petty_posted || report.expenses_posted) {
        console.log(`Party statement repair: ${report.payments_posted} payment(s), ${report.petty_posted} petty voucher(s), ${report.expenses_posted} expense(s) posted`);
    }
    if (report.errors.length) {
        console.log(`Party statement repair: ${report.errors.length} row(s) could not be posted`);
    }
    return report;
}

module.exports = { ensurePartyStatementRows, MONEY_EPS };
