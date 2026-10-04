/**
 * Prarambha Account & Stock Management — Dashboard Operations
 * ===========================================
 * Single source of truth for dashboard data assembly.
 * Used by both Electron (main.js) and Web (server.js).
 */

// Exact AD → BS conversion (the whole ledger uses BS dates)
const { adToBS, todayBSDate } = require('../excel-import');
// Post-dated cheque position (read-only — a held cheque moves no money)
const pdcOps = require('./pdc');

/**
 * Get all dashboard summary data.
 * @param {object} db - better-sqlite3 database instance
 * @returns {object} Dashboard data (todaySales, todayPurchases, receivables, etc.)
 */
function getDashboard(db) {
    // All stored dates are BS (Bikram Sambat) — "today" must be BS too,
    // otherwise the Today panels always compare against the wrong day.
    const today = todayBSDate();

    const todaySales = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM sales WHERE date = ?"
    ).get(today);

    const todayPurchases = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM purchases WHERE date = ?"
    ).get(today);

    // ── Cash Position ──
    const todayCashSales = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM sales WHERE date = ? AND payment_mode = 'cash'"
    ).get(today);

    const todayCashReceipts = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE date = ? AND type = 'receipt' AND mode = 'cash'"
    ).get(today);

    const todayCashPayments = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE date = ? AND type = 'payment' AND mode = 'cash'"
    ).get(today);

    const todayPettyCash = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM petty_cash WHERE date = ?"
    ).get(today);

    const todayExpenses = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM other_expenses WHERE date = ?"
    ).get(today);

    const todayVehicle = db.prepare(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM vehicle_expenses WHERE date = ?"
    ).get(today);

    const todayCashDeposits = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM cash_deposits WHERE date = ?"
    ).get(today);

    const cashIn = (todayCashSales.total || 0) + (todayCashReceipts.total || 0);
    const cashOut = (todayCashPayments.total || 0) + (todayPettyCash.total || 0) + (todayExpenses.total || 0) + (todayVehicle.total || 0) + (todayCashDeposits.total || 0);
    const netCash = cashIn - cashOut;

    // ── Receivables & Payables ──
    const receivables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) as total FROM sales WHERE status IN ('unpaid', 'partial')"
    ).get();

    const payables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) as total FROM purchases WHERE status IN ('unpaid', 'partial')"
    ).get();

    // ── Quick Profit Snapshot (Today) ──
    // Legacy fallback components (only used if the P&L module is unavailable).
    const todayMilkLegacy = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM milk_collections WHERE date = ?"
    ).get(today).total || 0;
    const todaySalaryLegacy = db.prepare(
        "SELECT COALESCE(SUM(net_salary), 0) as total FROM salary_records WHERE payment_date = ?"
    ).get(today).total || 0;
    // ONE authoritative calculation (spec Phases 14 & 27): the dashboard calls
    // the SAME getProfitLoss the P&L page uses, so "today's profit" can never
    // disagree with the reports. The legacy formula stays only as a fallback
    // if the reports module is unavailable.
    let todayPnl = null;
    try {
        const { getProfitLoss } = require('./financial_reports');
        todayPnl = getProfitLoss(db, { from_date: today, to_date: today });
    } catch (e) { todayPnl = null; }
    const todayTotalExpenses = todayPnl
        ? Math.round((todayPnl.expenses.total_expenses + Number.EPSILON) * 100) / 100
        : (todayPurchases.total || 0) + todayMilkLegacy + (todayPettyCash.total || 0) + (todayExpenses.total || 0) + (todayVehicle.total || 0) + todaySalaryLegacy;
    const todayProfit = todayPnl ? todayPnl.net_profit : ((todaySales.total || 0) - todayTotalExpenses);

    // ── Stock Summary ──
    // Closing balance is replayed from the movements. Taking "inward - outward of the
    // latest movement" reported that single movement's quantity as the stock on hand
    // (16,753 L of buffalo milk showed as 19.5 L and the stock value as a fraction of
    // the real one).
    const closingBalanceSql = 'COALESCE((SELECT SUM(inward_qty - outward_qty) FROM stock_movements sm WHERE sm.product_id = p.id), p.opening_stock)';
    const stockSummary = db.prepare(
        `SELECT COUNT(*) as product_count, COALESCE(SUM(bal * rate), 0) as stock_value
           FROM (SELECT p.id, p.rate, ${closingBalanceSql} AS bal FROM products p)
          WHERE bal > 0`
    ).get();

    const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get();

    const recentSales = db.prepare(
        "SELECT s.id, s.invoice_no as ref_no, s.date, s.grand_total, s.status, p.name as party_name, 'sale' as type FROM sales s LEFT JOIN parties p ON s.party_id = p.id ORDER BY s.created_at DESC LIMIT 5"
    ).all();

    const recentPurchases = db.prepare(
        "SELECT p.id, p.bill_no as ref_no, p.date, p.grand_total, p.status, pa.name as party_name, 'purchase' as type FROM purchases p LEFT JOIN parties pa ON p.party_id = pa.id ORDER BY p.created_at DESC LIMIT 5"
    ).all();

    // Group by BS month prefix (YYYY-MM). strftime() returns NULL for valid BS
    // dates like 2083-03-32 (BS months can have 29–32 days, not valid AD dates),
    // so use a plain string slice instead.
    const monthlySales = db.prepare(
        "SELECT substr(date, 1, 7) as month, COALESCE(SUM(grand_total), 0) as total FROM sales WHERE date LIKE '____-__-__' GROUP BY month ORDER BY month"
    ).all().slice(-6);

    const monthlyPurchases = db.prepare(
        "SELECT substr(date, 1, 7) as month, COALESCE(SUM(grand_total), 0) as total FROM purchases WHERE date LIKE '____-__-__' GROUP BY month ORDER BY month"
    ).all().slice(-6);

    // Milk received per BS month — same slice pattern as sales/purchases so
    // all three dashboard series group identically.
    const monthlyMilk = db.prepare(
        "SELECT substr(date, 1, 7) as month, COALESCE(SUM(quantity_liters), 0) as total FROM milk_collections WHERE date LIKE '____-__-__' GROUP BY month ORDER BY month"
    ).all().slice(-6);

    const lowStock = db.prepare(
        `SELECT p.name, p.unit, p.reorder_level, ${closingBalanceSql} as current_stock
           FROM products p
          WHERE ${closingBalanceSql} <= p.reorder_level AND p.reorder_level > 0
          ORDER BY ${closingBalanceSql}`
    ).all();

    const topCustomer = db.prepare(
        "SELECT p.name, COALESCE(SUM(s.grand_total), 0) as total FROM sales s JOIN parties p ON s.party_id = p.id GROUP BY s.party_id ORDER BY total DESC LIMIT 1"
    ).get();

    const topSupplier = db.prepare(
        "SELECT p.name, COALESCE(SUM(pr.grand_total), 0) as total FROM purchases pr JOIN parties p ON pr.party_id = p.id GROUP BY pr.party_id ORDER BY total DESC LIMIT 1"
    ).get();

    // ── Post-Dated Cheques (PDC) ──
    // Kept deliberately SEPARATE from the cash/bank figures above: a cheque that
    // is still held has moved no money, so it must never be added to the bank
    // balance. It is reported as what it is — money expected through a cheque
    // (PDC receivable) and money we expect to pay out (PDC payable).
    let pdc = null;
    try {
        pdc = pdcOps.getPdcPosition(db);
    } catch (e) {
        pdc = null; // older database without the PDC register
    }

    // ── Advance recovery alert (spec Phase 10) ──
    // Outstanding advances + ageing buckets from the SAME register the
    // Advances page shows — the dashboard never computes its own numbers.
    let advances = null;
    try {
        advances = require('./accounting').getAdvanceRecoveryRegister(db, { as_of: today }).summary;
    } catch (e) {
        advances = null;
    }

    return {
        todaySales,
        todayPurchases,
        // Cash position
        cashPosition: {
            cash_in: cashIn,
            cash_out: cashOut,
            net_cash: netCash,
            cash_sales: todayCashSales.total || 0,
            cash_receipts: todayCashReceipts.total || 0,
            cash_payments: todayCashPayments.total || 0,
            petty_cash: todayPettyCash.total || 0,
            expenses: todayExpenses.total || 0,
            vehicle: todayVehicle.total || 0,
            cash_deposits: todayCashDeposits.total || 0
        },
        // Receivables / Payables
        receivables,
        payables,
        netReceivable: (receivables?.total || 0) - (payables?.total || 0),
        // Quick profit snapshot — now the SAME figures as the P&L page
        // (revenue / COGS / gross profit / operating expenses / net).
        profitSnapshot: {
            total_income: todayPnl ? todayPnl.income.total_income : (todaySales.total || 0),
            total_expenses: todayTotalExpenses,
            net_profit: todayProfit,
            total_receipts: todayCashReceipts.total || 0,
            revenue: todayPnl ? todayPnl.income.total_sales : (todaySales.total || 0),
            cogs: todayPnl ? todayPnl.cogs : 0,
            gross_profit: todayPnl ? todayPnl.gross_profit : null,
            operating_expenses: todayPnl ? todayPnl.operating_expenses : null,
            // Milk component of COGS from the SAME P&L — the dashboard never
            // re-derives it, it only divides by liters for the per-litre KPI.
            milk_cost: todayPnl ? todayPnl.expenses.milk_collection.total : todayMilkLegacy,
            pnl_basis: !!todayPnl
        },
        // Stock
        stockSummary: {
            product_count: productCount ? productCount.count : 0,
            stock_value: stockSummary ? stockSummary.stock_value : 0
        },
        recentTransactions: [...recentSales, ...recentPurchases]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 8),
        monthlySales,
        monthlyPurchases,
        monthlyMilk,
        lowStock: lowStock || [],
        topCustomer: topCustomer || { name: 'N/A', total: 0 },
        topSupplier: topSupplier || { name: 'N/A', total: 0 },
        // PDC position — never mixed into cash/bank, receivable or payable.
        pdc,
        // Advance recovery control — outstanding + 7/30/60/90+ ageing.
        advances
    };
}

module.exports = { getDashboard };
