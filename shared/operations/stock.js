/**
 * Prarambha Account & Stock Management — Stock Operations
 * =======================================
 * Single source of truth for stock queries and adjustments.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');
const { todayBSDate } = require('../excel-import');
const { round2 } = require('./accounting');

/**
 * Get current stock levels for all products with optional search.
 * `active_only` — quick stock in/out pickers pass this so archived products
 * (D7) leave the entry dropdowns while the master list still shows them.
 */
function getCurrentStock(db, { search, active_only } = {}) {
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
    if (active_only) query += ' AND p.active = 1';
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
function adjustStock(db, { product_id, date, quantity, rate, notes }, userId) {
    const qty = parseFloat(quantity) || 0;
    // D11: adjustment rates are money — stored at 2 dp like every new write.
    const moveRate = round2(rate || 0);
    const movementDate = date || todayBSDate();
    const trx = db.transaction(() => {
        // Current balance must be computed EXACTLY like getCurrentStock replays it
        // (SUM of movements, falling back to opening_stock when there are none).
        // The old code read the latest row's balance_after, which can drift from
        // the replay and ignored opening_stock entirely.
        const replay = db.prepare(
            "SELECT COALESCE(SUM(inward_qty - outward_qty), (SELECT opening_stock FROM products WHERE id = ?)) AS bal FROM stock_movements WHERE product_id = ?"
        ).get(product_id, product_id);
        const currentBal = (replay && replay.bal) || 0;
        const newBalance = currentBal + qty;

        // A negative adjustment is an OUTWARD movement. Writing 0 for both sides
        // (the old behaviour) left balance_after reduced while the replayed
        // closing balance never changed — the two silently disagreed.
        const result = db.prepare(
            "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?)"
        ).run(
            product_id,
            movementDate,
            qty > 0 ? qty : 0,
            qty < 0 ? Math.abs(qty) : 0,
            newBalance,
            moveRate,
            notes || 'Stock Adjustment'
        );
        logAudit(db, 'stock_movements', result.lastInsertRowid, 'create', null, {
            product_id, date: movementDate, quantity: qty, rate: moveRate,
            notes: notes || 'Stock Adjustment', balance_after: newBalance
        }, userId || null);
        return { success: true, id: result.lastInsertRowid, balance_after: newBalance };
    });
    return trx();
}

module.exports = { getCurrentStock, getStockMovements, adjustStock };
