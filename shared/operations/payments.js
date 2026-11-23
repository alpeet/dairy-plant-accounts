/**
 * Prarambha Account & Stock Management — Payment Operations
 * =========================================
 * Single source of truth for payment CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * ACCOUNTING RULE (master spec §9: "Payment does not automatically mean Expense"):
 * Each payment carries a transaction_type that decides its double entry:
 *
 *   actual_expense     Expense DR / Cash-Bank CR          → P&L expense
 *   advance            Advance Receivable DR / Cash-Bank CR → balance sheet only
 *   advance_returned   Cash-Bank DR / Advance Receivable CR → balance sheet only
 *                      (money came back — completes the recovery register)
 *   loan_given         Loan Receivable DR / Cash-Bank CR    → balance sheet only
 *   loan_received      Cash-Bank DR / Loan Payable CR       → balance sheet only
 *   loan_repayment     in: Cash-Bank DR / Loan Receivable CR
 *                      out: Loan Payable DR / Cash-Bank CR  → balance sheet only
 *   advance_adjustment Expense DR / Advance Receivable CR   → P&L (real usage)
 *   settlement/other   legacy settlement behaviour (receivable/payable)
 *   (none — legacy)    receipt→receivable, payment→payable
 *
 * Only genuine expenses/income reach P&L. Advances, loans and repayments
 * never do — only interest/finance charges typed as actual_expense do.
 */

const { logAudit } = require('./audit');
const accounting = require('./accounting');
const accountingDates = require('./accounting_dates');
const round2 = accounting.round2;

/** Payment modes that move money through the bank. */
const BANK_MODES = ['bank', 'upi', 'cheque'];

/** Deprecated compatibility helper: bank records are entered only in their standalone register. */
function linkPaymentToBank() {
    return null;
}

/**
 * Save a payment (receipt or payment made) with its transaction type,
 * posting the matching double entry to the ledger.
 */
function savePayment(db, payment) {
    // The receipt/payment date is when money moved; the accounting date is the
    // period it belongs to. They are stored independently (rent received on
    // 5 Nov for October keeps date=5 Nov, accounting_date=31 Oct).
    const dates = accountingDates.normalizeDates({
        date: payment.date,
        accounting_date: payment.accounting_date
    });
    const trx = db.transaction(() => {
        const transactionType = normalizeTransactionType(payment.transaction_type);
        const result = db.prepare(
            "INSERT INTO payments (party_id, date, accounting_date, accounting_date_source, type, transaction_type, amount, mode, reference_type, reference_id, notes, bank_account, bank_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            payment.party_id, dates.date, dates.accounting_date, dates.source,
            payment.type, transactionType, payment.amount,
            payment.mode, payment.reference_type || '',
            payment.reference_id || null, payment.notes || '',
            payment.bank_account || '', payment.bank_reference || ''
        );
        const paymentId = result.lastInsertRowid;

        postPaymentLedger(db, {
            id: paymentId,
            party_id: payment.party_id,
            date: dates.date,
            accounting_date: dates.accounting_date,
            type: payment.type,
            transaction_type: transactionType,
            amount: payment.amount,
            mode: payment.mode,
            reference_type: payment.reference_type || ''
        }, payment.notes || '');

        // A payment against a purchase bill or an expense settles that
        // document's payable. It never creates a second purchase/expense —
        // only the settlement counter on the original document moves.
        applySettlement(db, payment, transactionType, 1);

        // STANDALONE REGISTER (operator rule, 2026-10): recording a payment
        // never creates or links a Bank Transactions row, whatever its mode or
        // reference. The bank statement is its own register, filled only from
        // BANK RECON / the Bank screen. Auto-linking by bank_reference was also
        // unsafe here: the workbook repeats one reference across dozens of
        // rows (v76: 31 rows all called "QR-089"), so a reference-only match
        // attached a payment to an unrelated transaction.
        // No payment operation is allowed to create or link bank rows.
        const bank_txn_id = null;

        logAudit(db, 'payments', paymentId, 'create', null, { ...payment, transaction_type: transactionType }, payment.created_by);
        return { id: paymentId, transaction_type: transactionType, bank_txn_id };
    });
    return trx();
}

/** Accept legacy/loose synonyms from UI or imports; null for unknown. */
function normalizeTransactionType(v) {
    const t = String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!t) return null;
    if (t === 'expense' || t === 'actual') return accounting.TRANSACTION_TYPES.ACTUAL_EXPENSE;
    if (t === 'advance_payment' || t === 'advance_paid' || t === 'advance') return accounting.TRANSACTION_TYPES.ADVANCE;
    if (t === 'advance_returned' || t === 'advance_return' || t === 'return_advance' || t === 'advance_refund') return accounting.TRANSACTION_TYPES.ADVANCE_RETURNED;
    if (t === 'loan_given' || t === 'sapati_given' || t === 'loan') return accounting.TRANSACTION_TYPES.LOAN_GIVEN;
    if (t === 'loan_received' || t === 'sapati_received') return accounting.TRANSACTION_TYPES.LOAN_RECEIVED;
    if (t === 'loan_repayment' || t === 'repayment' || t === 'loan_paid') return accounting.TRANSACTION_TYPES.LOAN_REPAYMENT;
    if (t === 'advance_adjustment' || t === 'adjustment') return accounting.TRANSACTION_TYPES.ADVANCE_ADJUSTMENT;
    // A collection is money received against a party's outstanding balance —
    // an ordinary receivable settlement, never new income.
    if (t === 'collection' || t === 'receipt') return accounting.TRANSACTION_TYPES.SETTLEMENT;
    if (t === 'settlement' || t === 'other') return t === 'settlement'
        ? accounting.TRANSACTION_TYPES.SETTLEMENT
        : accounting.TRANSACTION_TYPES.OTHER;
    if (accounting.TRANSACTION_TYPE_VALUES.includes(t)) return t;
    return null;
}

/**
 * Post the double entry for one payment row according to its transaction type.
 * Exported so updates/imports reuse the exact same rule.
 */
function postPaymentLedger(db, p, notes = '') {
    const rule = accounting.getPaymentPostingRule({
        transaction_type: p.transaction_type,
        mode: p.mode,
        direction: p.direction || (p.type === 'receipt' ? 'in' : 'out')
    });

    const acct = p.accounting_date || p.date;

    if (rule) {
        const moneyDebit = rule.debit_account === accounting.ACCOUNT.CASH || rule.debit_account === accounting.ACCOUNT.BANK;
        const moneyCredit = rule.credit_account === accounting.ACCOUNT.CASH || rule.credit_account === accounting.ACCOUNT.BANK;

        if (!moneyDebit && !moneyCredit) {
            // No cash moves (advance adjustment): a true journal entry — the
            // expense leg AND the receivable leg, each tagged. Neither leg is
            // a payment_received/payment_made row, so cash flow is untouched.
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 0, 0)"
            ).run(p.party_id, p.date, acct, p.id,
                  `${rule.kind} [${rule.debit_account}]`, p.amount);
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'advance', ?, ?, 0, ?, 0)"
            ).run(p.party_id, p.date, acct, p.id,
                  `${rule.kind} [${rule.credit_account}]`, p.amount);
            return rule;
        }

        // Cash leg present — one row; the tagged account is the other side.
        const tagAccount = moneyDebit ? rule.credit_account : rule.debit_account;
        const desc = `${rule.kind.charAt(0).toUpperCase() + rule.kind.slice(1)}${notes ? ' — ' + notes : ''} [${tagAccount}]`;
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)"
        ).run(
            p.party_id, p.date, acct,
            moneyDebit ? 'payment_received' : 'payment_made',
            p.id, desc,
            moneyDebit ? 0 : p.amount,
            moneyDebit ? p.amount : 0
        );
        return rule;
    }

    // Legacy settlement entries (no transaction type / settlement / other)
    if (p.type === 'receipt') {
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'payment_received', ?, 'Payment Received', 0, ?, 0)"
        ).run(p.party_id, p.date, acct, p.id, p.amount);
    } else {
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'payment_made', ?, 'Payment Made', ?, 0, 0)"
        ).run(p.party_id, p.date, acct, p.id, p.amount);
    }
    return null;
}

/**
 * Move the settlement counter on the document a payment settles.
 *
 *   reference_type = 'purchase' → purchases.paid_amount/status
 *   reference_type = 'expense'  → other_expenses.paid_amount/payment_status
 *
 * The payment is the only record of the money; the bill keeps its original
 * amount. Nothing is re-posted as a second purchase or expense.
 * `direction` is +1 when the payment is saved and -1 when it is deleted.
 */
function applySettlement(db, payment, transactionType, direction) {
    const refType = String(payment.reference_type || '').toLowerCase();
    const refId = payment.reference_id;
    if (!refId || !['purchase', 'expense'].includes(refType)) return null;
    // An advance adjustment is a period/advance movement, not new money; it is
    // handled by the advance allocation, never as a cash settlement.
    if (transactionType === accounting.TRANSACTION_TYPES.ADVANCE_ADJUSTMENT) return null;
    const amount = round2(payment.amount) * (direction < 0 ? -1 : 1);

    if (refType === 'purchase') {
        const bill = db.prepare('SELECT id, grand_total, COALESCE(paid_amount, 0) AS paid FROM purchases WHERE id = ?').get(refId);
        if (!bill) return null;
        const paid = round2(Math.min(round2(bill.grand_total), Math.max(0, round2(bill.paid) + amount)));
        const status = paid <= 0.005 ? 'unpaid' : (paid + 0.005 >= round2(bill.grand_total) ? 'paid' : 'partial');
        db.prepare("UPDATE purchases SET paid_amount = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(paid, status, refId);
        return { document: 'purchase', paid, status };
    }

    const exp = db.prepare('SELECT id, amount, COALESCE(paid_amount, 0) AS paid FROM other_expenses WHERE id = ?').get(refId);
    if (!exp) return null;
    const total = round2(exp.amount);
    const paid = round2(Math.min(total, Math.max(0, round2(exp.paid) + amount)));
    const status = paid <= 0.005 ? 'unpaid' : (paid + 0.005 >= total ? 'paid' : 'partial');
    db.prepare("UPDATE other_expenses SET paid_amount = ?, payment_status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(paid, status, refId);
    return { document: 'expense', paid, status };
}

/** Subtract a deleted payment from the document it settled. */
function reverseSettlement(db, payment) {
    return applySettlement(db, payment, payment.transaction_type, -1);
}

/**
 * Advance allocations: an advance paid earlier is applied to a purchase bill.
 * No cash moves and no new expense/payment is created — the advance asset is
 * reduced and the bill's payable is settled by the same amount.
 */
function ensureAdvanceAllocations(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS advance_allocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            advance_payment_id INTEGER NOT NULL,
            purchase_id INTEGER NOT NULL,
            party_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            accounting_date TEXT DEFAULT '',
            amount REAL NOT NULL DEFAULT 0,
            notes TEXT DEFAULT '',
            created_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_adv_alloc_payment ON advance_allocations(advance_payment_id);
        CREATE INDEX IF NOT EXISTS idx_adv_alloc_purchase ON advance_allocations(purchase_id);
    `);
}

function applyAdvanceToPurchase(db, data = {}) {
    ensureAdvanceAllocations(db);
    const amount = round2(data.amount);
    if (!(amount > 0)) throw new Error('Allocation amount must be greater than zero');
    const dates = accountingDates.normalizeDates({
        date: data.date || new Date().toISOString().slice(0, 10),
        accounting_date: data.accounting_date
    });

    const trx = db.transaction(() => {
        const advance = db.prepare(
            "SELECT * FROM payments WHERE id = ? AND transaction_type = 'advance'"
        ).get(data.advance_payment_id);
        if (!advance) throw new Error('Advance payment not found');
        const bill = db.prepare('SELECT * FROM purchases WHERE id = ?').get(data.purchase_id);
        if (!bill) throw new Error('Purchase bill not found');
        if (Number(bill.party_id) !== Number(advance.party_id)) {
            throw new Error('The advance and the purchase bill belong to different parties');
        }

        const allocated = round2(db.prepare(
            'SELECT COALESCE(SUM(amount), 0) AS t FROM advance_allocations WHERE advance_payment_id = ?'
        ).get(advance.id).t);
        const available = round2(round2(advance.amount) - allocated);
        if (amount > available + 0.005) {
            throw new Error(`Only ${available.toFixed(2)} of this advance is still available`);
        }

        const result = db.prepare(`
            INSERT INTO advance_allocations
                (advance_payment_id, purchase_id, party_id, date, accounting_date, amount, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(advance.id, bill.id, advance.party_id, dates.date, dates.accounting_date,
              amount, data.notes || '', data.created_by || null);

        // Two tagged ledger rows: the advance asset falls, the bill payable
        // falls. Neither leg is cash, so no cash-flow report moves.
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, 0, ?, 0)"
        ).run(advance.party_id, dates.date, dates.accounting_date, bill.id,
              `Advance applied to purchase bill ${bill.bill_no} [${accounting.ACCOUNT.ADVANCE_RECEIVABLE}]`, amount);
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 0, 0)"
        ).run(advance.party_id, dates.date, dates.accounting_date, bill.id,
              `Advance applied to purchase bill ${bill.bill_no} (settlement)`, amount);

        const total = round2(bill.grand_total);
        const paid = round2(Math.min(total, round2(bill.paid_amount) + amount));
        const status = paid <= 0.005 ? 'unpaid' : (paid + 0.005 >= total ? 'paid' : 'partial');
        db.prepare("UPDATE purchases SET paid_amount = ?, status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(paid, status, bill.id);

        logAudit(db, 'advance_allocations', result.lastInsertRowid, 'create', null,
            { ...data, amount }, data.created_by);
        return { id: result.lastInsertRowid, remaining_advance: round2(available - amount), purchase_paid: paid };
    });
    return trx();
}

/** List allocations, optionally for one party / advance / purchase. */
function listAdvanceAllocations(db, { party_id, advance_payment_id, purchase_id } = {}) {
    ensureAdvanceAllocations(db);
    let q = 'SELECT * FROM advance_allocations WHERE 1=1';
    const p = [];
    if (party_id) { q += ' AND party_id = ?'; p.push(party_id); }
    if (advance_payment_id) { q += ' AND advance_payment_id = ?'; p.push(advance_payment_id); }
    if (purchase_id) { q += ' AND purchase_id = ?'; p.push(purchase_id); }
    q += ' ORDER BY date DESC, id DESC';
    return db.prepare(q).all(...p);
}

/**
 * List payments with optional filters (includes transaction_type).
 */
function listPayments(db, { party_id, from_date, to_date, transaction_type } = {}) {
    let query = "SELECT pm.*, p.name as party_name FROM payments pm LEFT JOIN parties p ON pm.party_id = p.id WHERE 1=1";
    const params = [];
    if (party_id) { query += " AND pm.party_id = ?"; params.push(party_id); }
    if (from_date) { query += " AND pm.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pm.date <= ?"; params.push(to_date); }
    if (transaction_type) { query += " AND pm.transaction_type = ?"; params.push(transaction_type); }
    query += " ORDER BY pm.date DESC";
    return db.prepare(query).all(...params);
}

/**
 * Delete a payment record and its associated ledger entries.
 * For farmer milk-collection payments, also reverts collection statuses back to 'pending'.
 */
function deletePayment(db, id) {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!payment) throw new Error('Payment not found');

    // An advance already applied to a bill is part of that bill's settlement:
    // deleting the payment would leave the bill paid by nothing. Refuse until
    // the allocation is removed.
    ensureAdvanceAllocations(db);
    const allocations = db.prepare(
        'SELECT COUNT(*) AS n FROM advance_allocations WHERE advance_payment_id = ?'
    ).get(id).n;
    if (allocations > 0) {
        throw new Error(`This advance is already applied to ${allocations} bill(s). Remove the allocation before deleting it.`);
    }

    const trx = db.transaction(() => {
        // If this payment is linked to milk collections, revert their status
        if (payment.reference_type === 'milk_collection') {
            // Revert milk collection statuses for this party on this date
            db.prepare(
                `UPDATE milk_collections SET status = 'pending', updated_at = datetime('now','localtime')
                 WHERE party_id = ? AND date = ? AND status = 'paid'`
            ).run(payment.party_id, payment.date);
        }

        // Delete ledger entries associated with this payment
        db.prepare(
            "DELETE FROM ledger_entries WHERE reference_type IN ('payment_made', 'payment_received') AND reference_id = ?"
        ).run(id);

        // Undo the settlement counter on the purchase/expense this payment
        // settled — the bill itself stays, only its outstanding grows back.
        reverseSettlement(db, payment);

        // Delete the payment record
        db.prepare("DELETE FROM payments WHERE id = ?").run(id);

        // Standalone bank records are deliberately untouched by payment deletion.

        return { deleted: true };
    });
    return trx();
}

/**
 * Update the editable fields of a payment. transaction_type changes re-post
 * the ledger entry so the accounting treatment always matches the type.
 */
function updatePayment(db, data) {
    const existing = db.prepare("SELECT * FROM payments WHERE id = ?").get(data.id);
    if (!existing) throw new Error('Payment not found');

    const trx = db.transaction(() => {
        const newType = data.transaction_type !== undefined
            ? normalizeTransactionType(data.transaction_type)
            : existing.transaction_type;
        const dates = accountingDates.normalizeDates({
            date: data.date || existing.date,
            accounting_date: data.accounting_date !== undefined
                ? data.accounting_date
                : existing.accounting_date
        });

        db.prepare(
            "UPDATE payments SET date = ?, accounting_date = ?, accounting_date_source = ?, mode = ?, notes = ?, bank_reference = ?, transaction_type = ? WHERE id = ?"
        ).run(
            dates.date,
            dates.accounting_date,
            dates.source,
            data.mode || existing.mode,
            data.notes !== undefined ? data.notes : existing.notes,
            data.bank_reference !== undefined ? data.bank_reference : (existing.bank_reference || ''),
            newType,
            data.id
        );

        // Re-post the ledger entry if the accounting-relevant fields changed
        if (dates.date !== existing.date || dates.accounting_date !== existing.accounting_date
            || data.mode !== existing.mode || newType !== existing.transaction_type) {
            db.prepare(
                "DELETE FROM ledger_entries WHERE reference_type IN ('payment_made', 'payment_received') AND reference_id = ?"
            ).run(data.id);
            postPaymentLedger(db, {
                id: data.id,
                party_id: existing.party_id,
                date: dates.date,
                accounting_date: dates.accounting_date,
                type: existing.type,
                transaction_type: newType,
                amount: existing.amount,
                mode: data.mode || existing.mode
            }, data.notes !== undefined ? data.notes : existing.notes);
        }

        logAudit(db, 'payments', data.id, 'update', existing, data, data.changed_by || null);
        return { updated: true };
    });
    return trx();
}

module.exports = {
    savePayment,
    listPayments,
    deletePayment,
    updatePayment,
    postPaymentLedger,
    normalizeTransactionType,
    linkPaymentToBank,
    ensureAdvanceAllocations,
    applyAdvanceToPurchase,
    listAdvanceAllocations
};
