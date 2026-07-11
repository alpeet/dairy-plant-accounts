/**
 * Godhuli Dairy Plant — Dashboard Operations
 * ===========================================
 * Single source of truth for dashboard data assembly.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get all dashboard summary data.
 * @param {object} db - better-sqlite3 database instance
 * @returns {object} Dashboard data (todaySales, todayPurchases, receivables, etc.)
 */
function getDashboard(db) {
    const today = new Date().toISOString().split('T')[0];

    const todaySales = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM sales WHERE date = ?"
    ).get(today);

    const todayPurchases = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM purchases WHERE date = ?"
    ).get(today);

    const receivables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) as total FROM sales WHERE status IN ('unpaid', 'partial')"
    ).get();

    const payables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) as total FROM purchases WHERE status IN ('unpaid', 'partial')"
    ).get();

    const stockSummary = db.prepare(
        "SELECT COUNT(*) as product_count, COALESCE(SUM(balance_after * rate), 0) as stock_value FROM (SELECT product_id, rate, (SELECT inward_qty - outward_qty FROM stock_movements sm2 WHERE sm2.product_id = sm.product_id ORDER BY id DESC LIMIT 1) as balance_after FROM stock_movements sm GROUP BY product_id) WHERE balance_after > 0"
    ).get();

    const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get();

    const recentSales = db.prepare(
        "SELECT s.id, s.invoice_no as ref_no, s.date, s.grand_total, s.status, p.name as party_name, 'sale' as type FROM sales s LEFT JOIN parties p ON s.party_id = p.id ORDER BY s.created_at DESC LIMIT 5"
    ).all();

    const recentPurchases = db.prepare(
        "SELECT p.id, p.bill_no as ref_no, p.date, p.grand_total, p.status, pa.name as party_name, 'purchase' as type FROM purchases p LEFT JOIN parties pa ON p.party_id = pa.id ORDER BY p.created_at DESC LIMIT 5"
    ).all();

    const monthlySales = db.prepare(
        "SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(grand_total), 0) as total FROM sales WHERE date >= date('now', '-6 months') GROUP BY month ORDER BY month"
    ).all();

    const monthlyPurchases = db.prepare(
        "SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(grand_total), 0) as total FROM purchases WHERE date >= date('now', '-6 months') GROUP BY month ORDER BY month"
    ).all();

    const lowStock = db.prepare(
        "SELECT p.name, p.unit, p.reorder_level, COALESCE((SELECT inward_qty - outward_qty FROM stock_movements WHERE product_id = p.id ORDER BY id DESC LIMIT 1), p.opening_stock) as current_stock FROM products p WHERE COALESCE((SELECT inward_qty - outward_qty FROM stock_movements WHERE product_id = p.id ORDER BY id DESC LIMIT 1), p.opening_stock) <= p.reorder_level AND p.reorder_level > 0"
    ).all();

    const topCustomer = db.prepare(
        "SELECT p.name, COALESCE(SUM(s.grand_total), 0) as total FROM sales s JOIN parties p ON s.party_id = p.id GROUP BY s.party_id ORDER BY total DESC LIMIT 1"
    ).get();

    const topSupplier = db.prepare(
        "SELECT p.name, COALESCE(SUM(pr.grand_total), 0) as total FROM purchases pr JOIN parties p ON pr.party_id = p.id GROUP BY pr.party_id ORDER BY total DESC LIMIT 1"
    ).get();

    return {
        todaySales,
        todayPurchases,
        receivables,
        payables,
        stockSummary: {
            product_count: productCount ? productCount.count : 0,
            stock_value: stockSummary ? stockSummary.stock_value : 0
        },
        recentTransactions: [...recentSales, ...recentPurchases]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8),
        monthlySales,
        monthlyPurchases,
        lowStock: lowStock || [],
        topCustomer: topCustomer || { name: 'N/A', total: 0 },
        topSupplier: topSupplier || { name: 'N/A', total: 0 }
    };
}

module.exports = { getDashboard };
