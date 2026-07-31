/**
 * Prarambha Account & Stock Management — Payment Operations
 * =========================================
 * Single source of truth for payment CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * Save a payment (receipt or payment made).
 * Also creates the corresponding ledger entry.
 */
function savePayment(db, payment) {
    const trx = db.transaction(() => {
        const result = db.prepare(
            "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
            payment.party_id, payment.date, payment.type, payment.amount,
            payment.mode, payment.reference_type || '',
            payment.reference_id || null, payment.notes || ''
        );

        if (payment.type === 'receipt') {
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_received', ?, ?, 0, ?, ?)"
            ).run(payment.party_id, payment.date, result.lastInsertRowid, `Payment Received`, payment.amount, 0);
        } else {
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_made', ?, ?, ?, 0, ?)"
            ).run(payment.party_id, payment.date, result.lastInsertRowid, `Payment Made`, payment.amount, 0);
        }
        logAudit(db, 'payments', result.lastInsertRowid, 'create', null, payment, payment.created_by);
        return { id: result.lastInsertRowid };
    });
    return trx();
}

/**
 * List payments with optional filters.
 */
function listPayments(db, { party_id, from_date, to_date } = {}) {
    let query = "SELECT pm.*, p.name as party_name FROM payments pm LEFT JOIN parties p ON pm.party_id = p.id WHERE 1=1";
    const params = [];
    if (party_id) { query += " AND pm.party_id = ?"; params.push(party_id); }
    if (from_date) { query += " AND pm.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pm.date <= ?"; params.push(to_date); }
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
 * Update a payment record's mode, notes, and date.
 * Does NOT update amount to avoid ledger/collection reconciliation issues.
 */
function updatePayment(db, { id, mode, notes, date }) {
    const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(id);
    if (!payment) throw new Error('Payment not found');

    const trx = db.transaction(() => {
        db.prepare(
            "UPDATE payments SET mode = ?, notes = ?, date = ? WHERE id = ?"
        ).run(mode || payment.mode, notes !== undefined ? notes : payment.notes, date || payment.date, id);

        // Also update the associated ledger entry
        db.prepare(
            "UPDATE ledger_entries SET date = ?, description = ? WHERE reference_type IN ('payment_made', 'payment_received') AND reference_id = ?"
        ).run(date || payment.date, notes || (payment.type === 'payment' ? 'Payment Made' : 'Payment Received'), id);

        return { updated: true };
    });
    return trx();
}

module.exports = { savePayment, listPayments, deletePayment, updatePayment };
