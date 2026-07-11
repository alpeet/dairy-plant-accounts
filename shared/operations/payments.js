/**
 * Godhuli Dairy Plant — Payment Operations
 * =========================================
 * Single source of truth for payment CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 */

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

module.exports = { savePayment, listPayments };
