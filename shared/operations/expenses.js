/**
 * Prarambha Account & Stock Management — Other Expenses Operations
 * ================================================
 * CRUD for other expenses register.
 *
 * Used by both Electron (main.js) and Web (server.js).
 *
 * NOTE: Petty Cash entries are surfaced here as "Petty Cash" category rows.
 * Both registers write to the same source (petty_cash + other_expenses) but the
 * Profit & Loss report reads other_expenses ONLY, so expenses created from the
 * Petty Cash tab are mirrored into other_expenses (category='Petty Cash') to
 * keep the P&L complete without double-counting.
 */

const { logAudit } = require('./audit');

/**
 * List other expenses with optional filters.
 * Petty cash entries are included as rows with category = 'Petty Cash'
 * (read-only in this tab: they are managed from the Petty Cash register).
 */
function listOtherExpenses(db, { from_date, to_date, category, expense_head } = {}) {
    let query = `
        SELECT oe.*, u.username as created_by_name, NULL as petty_cash_id
        FROM other_expenses oe LEFT JOIN users u ON oe.created_by = u.id
        WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND oe.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND oe.date <= ?"; params.push(to_date); }
    if (category) { query += " AND oe.category = ?"; params.push(category); }
    if (expense_head) { query += " AND (oe.expense_head LIKE ? OR oe.category LIKE ?)"; params.push(`%${expense_head}%`, `%${expense_head}%`); }
    query += " UNION ALL ";
    query += `
        SELECT pc.id as id, pc.date as date, 'Petty Cash' as category,
               pc.expense_head as expense_head, pc.description as description,
               pc.amount as amount, pc.paid_to as paid_to,
               pc.payment_mode as payment_mode, pc.voucher_no as reference_no,
               pc.remarks as remarks, pc.created_by as created_by,
               pc.created_at as created_at, pc.updated_at as updated_at,
               u2.username as created_by_name, pc.id as petty_cash_id
        FROM petty_cash pc LEFT JOIN users u2 ON pc.created_by = u2.id
        WHERE 1=1`;
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    if (category) { query += " AND 'Petty Cash' = ?"; params.push(category); }
    if (expense_head) { query += " AND pc.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    query += " ORDER BY date DESC, id DESC";
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
 * Petty-cash rows surfaced in this tab live only in petty_cash — if the id is
 * not found in other_expenses, try petty_cash so deletion works from either tab.
 */
function deleteOtherExpense(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
    if (oldEntry) {
        db.prepare("DELETE FROM other_expenses WHERE id = ?").run(id);
        logAudit(db, 'other_expenses', id, 'delete', oldEntry, null, changedBy);
        return { deleted: true };
    }
    const oldPc = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
    if (oldPc) {
        db.prepare("DELETE FROM petty_cash WHERE id = ?").run(id);
        logAudit(db, 'petty_cash', id, 'delete', oldPc, null, changedBy);
        return { deleted: true, petty_cash: true };
    }
    return { deleted: false, error: 'Entry not found' };
}

/**
 * Get expense categories list (distinct).
 * Includes the virtual 'Petty Cash' category when petty cash rows exist.
 */
function getExpenseCategories(db) {
    const rows = db.prepare(`
        SELECT category FROM (SELECT DISTINCT category FROM other_expenses WHERE category != ''
        UNION SELECT 'Petty Cash' WHERE EXISTS (SELECT 1 FROM petty_cash))
        ORDER BY category
    `).all();
    return rows;
}

/**
 * Get expenses summary by category.
 * Includes petty cash rows under the 'Petty Cash' category.
 */
function getExpensesSummary(db, { from_date, to_date } = {}) {
    let query = `
        SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total FROM (
            SELECT amount, date FROM other_expenses WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    query += " UNION ALL SELECT amount, date FROM petty_cash WHERE 1=1";
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    query += `)
    `;
    const total = db.prepare(query).get(...params);

    let catQuery = `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM (
        SELECT category, amount, date FROM other_expenses WHERE 1=1`;
    const catParams = [];
    if (from_date) { catQuery += " AND date >= ?"; catParams.push(from_date); }
    if (to_date) { catQuery += " AND date <= ?"; catParams.push(to_date); }
    catQuery += " UNION ALL SELECT 'Petty Cash' as category, amount, date FROM petty_cash WHERE 1=1";
    if (from_date) { catQuery += " AND date >= ?"; catParams.push(from_date); }
    if (to_date) { catQuery += " AND date <= ?"; catParams.push(to_date); }
    catQuery += " ) GROUP BY category ORDER BY total DESC";
    const byCategory = db.prepare(catQuery).all(...catParams);

    return { ...total, by_category: byCategory };
}

module.exports = { listOtherExpenses, getOtherExpense, saveOtherExpense, deleteOtherExpense, getExpenseCategories, getExpensesSummary };
