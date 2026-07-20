/**
 * Godhuli Dairy Plant — Other Expenses Operations
 * ================================================
 * CRUD for other expenses register.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List other expenses with optional filters.
 */
function listOtherExpenses(db, { from_date, to_date, category, expense_head } = {}) {
    let query = `SELECT oe.*, u.username as created_by_name 
                 FROM other_expenses oe LEFT JOIN users u ON oe.created_by = u.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND oe.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND oe.date <= ?"; params.push(to_date); }
    if (category) { query += " AND oe.category = ?"; params.push(category); }
    if (expense_head) { query += " AND oe.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    query += " ORDER BY oe.date DESC, oe.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single expense entry.
 */
function getOtherExpense(db, id) {
    return db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
}

/**
 * Save an expense entry (create or update).
 */
function saveOtherExpense(db, data) {
    const trx = db.transaction(() => {
        if (data.id) {
            const oldEntry = db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE other_expenses SET date=?, category=?, expense_head=?, description=?,
                    amount=?, paid_to=?, payment_mode=?, reference_no=?, remarks=?,
                    updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.date, data.category, data.expense_head, data.description || '',
                data.amount, data.paid_to || '', data.payment_mode || 'cash',
                data.reference_no || '', data.remarks || '', data.id
            );
            logAudit(db, 'other_expenses', data.id, 'update', oldEntry, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.date, data.category, data.expense_head, data.description || '',
                data.amount, data.paid_to || '', data.payment_mode || 'cash',
                data.reference_no || '', data.remarks || '', data.created_by || null
            );
            logAudit(db, 'other_expenses', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete an expense entry.
 */
function deleteOtherExpense(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
    db.prepare("DELETE FROM other_expenses WHERE id = ?").run(id);
    logAudit(db, 'other_expenses', id, 'delete', oldEntry, null, changedBy);
    return { deleted: true };
}

/**
 * Get expense categories list (distinct).
 */
function getExpenseCategories(db) {
    return db.prepare("SELECT DISTINCT category FROM other_expenses WHERE category != '' ORDER BY category").all();
}

/**
 * Get expenses summary by category.
 */
function getExpensesSummary(db, { from_date, to_date } = {}) {
    let query = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total FROM other_expenses WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    const total = db.prepare(query).get(...params);

    let catQuery = `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count 
                    FROM other_expenses WHERE 1=1`;
    const catParams = [];
    if (from_date) { catQuery += " AND date >= ?"; catParams.push(from_date); }
    if (to_date) { catQuery += " AND date <= ?"; catParams.push(to_date); }
    catQuery += " GROUP BY category ORDER BY total DESC";
    const byCategory = db.prepare(catQuery).all(...catParams);

    return { ...total, by_category: byCategory };
}

module.exports = { listOtherExpenses, getOtherExpense, saveOtherExpense, deleteOtherExpense, getExpenseCategories, getExpensesSummary };
