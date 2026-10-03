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

/**
 * Save a payment (receipt or payment made) with its transaction type,
 * posting the matching double entry to the ledger.
 */
function savePayment(db, payment) {
    const trx = db.transaction(() => {
        const transactionType = normalizeTransactionType(payment.transaction_type);
        const result = db.prepare(
            "INSERT INTO payments (party_id, date, type, transaction_type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            payment.party_id, payment.date, payment.type, transactionType, payment.amount,
            payment.mode, payment.reference_type || '',
            payment.reference_id || null, payment.notes || ''
        );
        const paymentId = result.lastInsertRowid;

        postPaymentLedger(db, {
            id: paymentId,
            party_id: payment.party_id,
            date: payment.date,
            type: payment.type,
            transaction_type: transactionType,
            amount: payment.amount,
            mode: payment.mode
        }, payment.notes || '');

        logAudit(db, 'payments', paymentId, 'create', null, { ...payment, transaction_type: transactionType }, payment.created_by);
        return { id: paymentId, transaction_type: transactionType };
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

    if (rule) {
        const moneyDebit = rule.debit_account === accounting.ACCOUNT.CASH || rule.debit_account === accounting.ACCOUNT.BANK;
        const moneyCredit = rule.credit_account === accounting.ACCOUNT.CASH || rule.credit_account === accounting.ACCOUNT.BANK;

        if (!moneyDebit && !moneyCredit) {
            // No cash moves (advance adjustment): a true journal entry — the
            // expense leg AND the receivable leg, each tagged. Neither leg is
            // a payment_received/payment_made row, so cash flow is untouched.
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'adjustment', ?, ?, ?, 0, 0)"
            ).run(p.party_id, p.date, p.id,
                  `${rule.kind} [${rule.debit_account}]`, p.amount);
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'advance', ?, ?, 0, ?, 0)"
            ).run(p.party_id, p.date, p.id,
                  `${rule.kind} [${rule.credit_account}]`, p.amount);
            return rule;
        }

        // Cash leg present — one row; the tagged account is the other side.
        const tagAccount = moneyDebit ? rule.credit_account : rule.debit_account;
        const desc = `${rule.kind.charAt(0).toUpperCase() + rule.kind.slice(1)}${notes ? ' — ' + notes : ''} [${tagAccount}]`;
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
        ).run(
            p.party_id, p.date,
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
            "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_received', ?, 'Payment Received', 0, ?, 0)"
        ).run(p.party_id, p.date, p.id, p.amount);
    } else {
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_made', ?, 'Payment Made', ?, 0, 0)"
        ).run(p.party_id, p.date, p.id, p.amount);
    }
    return null;
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

        // Delete the payment record
        db.prepare("DELETE FROM payments WHERE id = ?").run(id);

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

        db.prepare(
            "UPDATE payments SET date = ?, mode = ?, notes = ?, transaction_type = ? WHERE id = ?"
        ).run(
            data.date || existing.date,
            data.mode || existing.mode,
            data.notes !== undefined ? data.notes : existing.notes,
            newType,
            data.id
        );

        // Re-post the ledger entry if the accounting-relevant fields changed
        if (data.date !== existing.date || data.mode !== existing.mode || newType !== existing.transaction_type) {
            db.prepare(
                "DELETE FROM ledger_entries WHERE reference_type IN ('payment_made', 'payment_received') AND reference_id = ?"
            ).run(data.id);
            postPaymentLedger(db, {
                id: data.id,
                party_id: existing.party_id,
                date: data.date || existing.date,
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
    normalizeTransactionType
};
