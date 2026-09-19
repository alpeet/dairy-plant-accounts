/**
 * Prarambha Account & Stock Management — Stock Operations
 * =======================================
 * Single source of truth for stock queries and adjustments.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get current stock levels for all products with optional search.
 */
function getCurrentStock(db, { search } = {}) {
    // Both fields are the closing balance replayed from the movements, not the last
    // row's own delta or a stored balance_after. "inward - outward of the latest
    // movement" is only that one movement's quantity — it made the dashboard low-stock
    // list and the balance-sheet stock value read e.g. 19.5 L instead of 16,753 L.
    const closingBalance = `COALESCE((SELECT SUM(inward_qty - outward_qty) FROM stock_movements WHERE product_id = p.id), p.opening_stock)`;
    let query = `
        SELECT p.*,
            ${closingBalance} as current_stock,
            ${closingBalance} as current_balance
        FROM products p WHERE 1=1
    `;
    const params = [];
    if (search) {
        query += " AND (p.name LIKE ? OR p.category LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY p.name";
    return db.prepare(query).all(...params);
}

/**
 * Get stock movement history with optional filters.
 */
function getStockMovements(db, { product_id, from_date, to_date } = {}) {
    let query = `SELECT sm.*, p.name as product_name, p.unit
                 FROM stock_movements sm JOIN products p ON sm.product_id = p.id WHERE 1=1`;
    const params = [];
    if (product_id) { query += " AND sm.product_id = ?"; params.push(product_id); }
    if (from_date) { query += " AND sm.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND sm.date <= ?"; params.push(to_date); }
    query += " ORDER BY sm.date DESC, sm.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Adjust stock for a product (positive = add, negative = remove).
 */
function adjustStock(db, { product_id, date, quantity, rate, notes }) {
    const trx = db.transaction(() => {
        const lastBalance = db.prepare(
            "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
        ).get(product_id);
        const currentBal = lastBalance ? lastBalance.balance_after : 0;
        const newBalance = currentBal + parseFloat(quantity);

        db.prepare(
            "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, ?)"
        ).run(
            product_id,
            date || new Date().toISOString().split('T')[0],
            quantity > 0 ? quantity : 0,
            newBalance,
            rate || 0,
            notes || 'Stock Adjustment'
        );
        return { success: true };
    });
    return trx();
}

module.exports = { getCurrentStock, getStockMovements, adjustStock };
