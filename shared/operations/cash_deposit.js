/**
 * Godhuli Dairy Plant — Cash Deposit Operations
 * ===============================================
 * Manages bank deposits made from cash on hand.
 * Tracks deposits by date, bank, amount, and source.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Generate a unique deposit number for a given date.
 */
function generateDepositNo(db, date) {
    const d = date || new Date().toISOString().split('T')[0];
    const prefix = 'DEP';
    const count = db.prepare(
        "SELECT COUNT(*) as c FROM cash_deposits WHERE date = ?"
    ).get(d);
    const seq = (count.c || 0) + 1;
    return `${prefix}-${d.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

/**
 * List cash deposits with optional date range and bank filter.
 */
function listCashDeposits(db, { from_date, to_date, bank_name } = {}) {
    let query = "SELECT cd.* FROM cash_deposits cd WHERE 1=1";
    const params = [];
    if (from_date) { query += " AND cd.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND cd.date <= ?"; params.push(to_date); }
    if (bank_name) { query += " AND cd.bank_name LIKE ?"; params.push(`%${bank_name}%`); }
    query += " ORDER BY cd.date DESC, cd.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single cash deposit by ID.
 */
function getCashDeposit(db, id) {
    return db.prepare("SELECT * FROM cash_deposits WHERE id = ?").get(id);
}

/**
 * Save a cash deposit (create or update).
 */
function saveCashDeposit(db, data) {
    const trx = db.transaction(() => {
        const date = data.date || new Date().toISOString().split('T')[0];

        if (data.id) {
            // Update existing
            db.prepare(`
                UPDATE cash_deposits SET
                    date = ?, bank_name = ?, branch = ?, account_no = ?,
                    amount = ?, cash_source = ?, deposit_mode = ?,
                    reference_no = ?, remarks = ?, deposited_by = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                date,
                data.bank_name || '',
                data.branch || '',
                data.account_no || '',
                data.amount || 0,
                data.cash_source || 'mixed',
                data.deposit_mode || 'cash',
                data.reference_no || '',
                data.remarks || '',
                data.deposited_by || '',
                data.id
            );
            return { id: data.id, action: 'updated' };
        } else {
            // Create new
            const deposit_no = generateDepositNo(db, date);
            const result = db.prepare(`
                INSERT INTO cash_deposits (date, deposit_no, bank_name, branch, account_no, amount,
                    cash_source, deposit_mode, reference_no, remarks, deposited_by, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                date,
                deposit_no,
                data.bank_name || '',
                data.branch || '',
                data.account_no || '',
                data.amount || 0,
                data.cash_source || 'mixed',
                data.deposit_mode || 'cash',
                data.reference_no || '',
                data.remarks || '',
                data.deposited_by || '',
                data.created_by || null
            );
            return { id: result.lastInsertRowid, action: 'created', deposit_no };
        }
    });
    return trx();
}

/**
 * Delete a cash deposit by ID.
 */
function deleteCashDeposit(db, id) {
    const result = db.prepare("DELETE FROM cash_deposits WHERE id = ?").run(id);
    return { deleted: result.changes > 0 };
}

/**
 * Get cash deposit summary for a date range.
 */
function getCashDepositSummary(db, { from_date, to_date } = {}) {
    const from = from_date || '2000-01-01';
    const to = to_date || new Date().toISOString().split('T')[0];

    const total = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_deposited,
               COUNT(*) as total_count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
    `).get(from, to);

    const byBank = db.prepare(`
        SELECT bank_name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
        GROUP BY bank_name ORDER BY total DESC
    `).all(from, to);

    const byMode = db.prepare(`
        SELECT deposit_mode, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
        GROUP BY deposit_mode ORDER BY total DESC
    `).all(from, to);

    return {
        total_deposited: total.total_deposited,
        total_count: total.total_count,
        by_bank: byBank,
        by_mode: byMode
    };
}

module.exports = {
    listCashDeposits,
    getCashDeposit,
    saveCashDeposit,
    deleteCashDeposit,
    getCashDepositSummary,
    generateDepositNo
};
