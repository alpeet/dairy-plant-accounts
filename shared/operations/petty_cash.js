/**
 * Godhuli Dairy Plant — Petty Cash Operations
 * ============================================
 * CRUD for petty cash register entries.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List petty cash entries with optional date filter.
 */
function listPettyCash(db, { from_date, to_date, expense_head } = {}) {
    let query = `SELECT pc.*, u.username as created_by_name 
                 FROM petty_cash pc LEFT JOIN users u ON pc.created_by = u.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    if (expense_head) { query += " AND pc.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    query += " ORDER BY pc.date DESC, pc.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single petty cash entry.
 */
function getPettyCash(db, id) {
    return db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
}

/**
 * Save a petty cash entry (create or update).
 */
function savePettyCash(db, data) {
    const trx = db.transaction(() => {
        if (data.id) {
            const oldEntry = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE petty_cash SET voucher_no=?, date=?, expense_head=?, description=?,
                    amount=?, paid_to=?, approved_by=?, payment_mode=?, remarks=?,
                    updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.voucher_no, data.date, data.expense_head, data.description || '',
                data.amount, data.paid_to || '', data.approved_by || '',
                data.payment_mode || 'cash', data.remarks || '', data.id
            );
            logAudit(db, 'petty_cash', data.id, 'update', oldEntry, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, approved_by, payment_mode, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.voucher_no, data.date, data.expense_head, data.description || '',
                data.amount, data.paid_to || '', data.approved_by || '',
                data.payment_mode || 'cash', data.remarks || '', data.created_by || null
            );
            logAudit(db, 'petty_cash', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete a petty cash entry.
 */
function deletePettyCash(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
    db.prepare("DELETE FROM petty_cash WHERE id = ?").run(id);
    logAudit(db, 'petty_cash', id, 'delete', oldEntry, null, changedBy);
    return { deleted: true };
}

/**
 * Get petty cash summary (totals for a period).
 */
function getPettyCashSummary(db, { from_date, to_date } = {}) {
    let query = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total FROM petty_cash WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    return db.prepare(query).get(...params);
}

module.exports = { listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary };
