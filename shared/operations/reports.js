/**
 * Godhuli Dairy Plant — Report Operations
 * ========================================
 * Single source of truth for all report queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Sales report with summary total.
 */
function getSalesReport(db, { from_date, to_date, party_id } = {}) {
    let query = "SELECT s.*, p.name as party_name FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE 1=1";
    const params = [];
    if (from_date) { query += " AND s.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND s.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND s.party_id = ?"; params.push(party_id); }
    query += " ORDER BY s.date ASC";
    const sales = db.prepare(query).all(...params);
    const total = sales.reduce((sum, s) => sum + s.grand_total, 0);
    return { sales, total };
}

/**
 * Purchase report with summary total.
 */
function getPurchasesReport(db, { from_date, to_date, party_id } = {}) {
    let query = "SELECT pr.*, p.name as party_name FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE 1=1";
    const params = [];
    if (from_date) { query += " AND pr.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pr.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND pr.party_id = ?"; params.push(party_id); }
    query += " ORDER BY pr.date ASC";
    const purchases = db.prepare(query).all(...params);
    const total = purchases.reduce((sum, p) => sum + p.grand_total, 0);
    return { purchases, total };
}

/**
 * Daybook — all transactions for a given date.
 */
function getDaybook(db, { date } = {}) {
    const d = date || new Date().toISOString().split('T')[0];
    const sales = db.prepare(
        "SELECT s.*, p.name as party_name, 'sale' as type FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE s.date = ? ORDER BY s.id"
    ).all(d);
    const purchases = db.prepare(
        "SELECT pr.*, p.name as party_name, 'purchase' as type FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE pr.date = ? ORDER BY pr.id"
    ).all(d);
    const payments = db.prepare(
        "SELECT pm.*, p.name as party_name FROM payments pm LEFT JOIN parties p ON pm.party_id = p.id WHERE pm.date = ? ORDER BY pm.id"
    ).all(d);
    const totalSales = sales.reduce((s, x) => s + x.grand_total, 0);
    const totalPurchases = purchases.reduce((s, x) => s + x.grand_total, 0);
    const totalPayments = payments.reduce((s, x) => s + x.amount, 0);
    return { sales, purchases, payments, totalSales, totalPurchases, totalPayments };
}

/**
 * Outstanding receivables from sales.
 */
function getReceivables(db) {
    return db.prepare(`
        SELECT p.id, p.name, p.phone,
            COALESCE(SUM(s.grand_total - s.paid_amount), 0) as outstanding
        FROM sales s JOIN parties p ON s.party_id = p.id
        WHERE s.status IN ('unpaid', 'partial')
        GROUP BY s.party_id HAVING outstanding > 0
        ORDER BY outstanding DESC
    `).all();
}

/**
 * Outstanding payables from purchases.
 */
function getPayables(db) {
    return db.prepare(`
        SELECT p.id, p.name, p.phone,
            COALESCE(SUM(pr.grand_total - pr.paid_amount), 0) as outstanding
        FROM purchases pr JOIN parties p ON pr.party_id = p.id
        WHERE pr.status IN ('unpaid', 'partial')
        GROUP BY pr.party_id HAVING outstanding > 0
        ORDER BY outstanding DESC
    `).all();
}

module.exports = { getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables };
