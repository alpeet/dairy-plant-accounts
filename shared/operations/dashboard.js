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
// BS calendar — the only source of BS month lengths and date movement.
const bs = require('../bs-calendar');
// Cash/bank position — same function the Cash & Bank module uses.
const accounting = require('./accounting');

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
        advances,
        // Chart / KPI aggregates for the dashboard screen (read-only).
        analytics: buildAnalytics(db, today, recentSales, recentPurchases)
    };
}

/**
 * Read-only analytics for the dashboard screen.
 *
 * Every figure is an aggregate over the SAME tables and the SAME P&L engine
 * (financial_reports.getProfitLoss) the module screens use. Nothing here
 * introduces a new accounting rule, a new table, or a write: it only shapes
 * existing numbers for the chart and KPI cards.
 *
 * @param {object} db - better-sqlite3 instance
 * @param {string} today - today's BS date
 * @param {Array} recentSales - latest sales rows already fetched above
 * @param {Array} recentPurchases - latest purchase rows already fetched above
 */
function buildAnalytics(db, today, recentSales, recentPurchases) {
    const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

    // Current BS month to date, and the same number of days in the previous
    // BS month — an honest "equivalent period" for the trend badges.
    const monthKey = String(today).slice(0, 7);
    const monthRange = bs.bsMonthRange(monthKey) || { from_date: `${monthKey}-01`, to_date: today, days: 30 };
    const prevKey = bs.shiftBSMonth(monthKey, -1);
    const prevRange = prevKey ? bs.bsMonthRange(prevKey) : null;
    const dayOfMonth = Number(String(today).slice(8, 10)) || 1;
    const prevTo = prevRange
        ? `${prevKey}-${bs.pad2(Math.min(dayOfMonth, prevRange.days))}`
        : null;

    let pnl = null;
    let prevPnl = null;
    const { getProfitLoss } = require('./financial_reports');
    try {
        pnl = getProfitLoss(db, { from_date: monthRange.from_date, to_date: today });
    } catch (e) {
        pnl = null;
    }

    // KPI window — the last 90 BS days against the 90 days before that (the
    // same span as the chart's widest filter, so the books always have data in
    // it). The comparison badge only appears when BOTH sides are real P&L
    // output — a percentage is never estimated.
    const kpiFrom = bs.addBSDays(today, -89) || today;
    const kpiPrevTo = bs.addBSDays(kpiFrom, -1);
    const kpiPrevFrom = kpiPrevTo ? bs.addBSDays(kpiPrevTo, -89) : null;
    let kpiCur = null;
    let kpiPrev = null;
    try {
        kpiCur = getProfitLoss(db, { from_date: kpiFrom, to_date: today });
        if (kpiPrevFrom && kpiPrevTo) {
            kpiPrev = getProfitLoss(db, { from_date: kpiPrevFrom, to_date: kpiPrevTo });
        }
    } catch (e) {
        kpiCur = null;
        kpiPrev = null;
    }
    if (prevRange && prevTo) {
        try { prevPnl = getProfitLoss(db, { from_date: prevRange.from_date, to_date: prevTo }); } catch (e) { prevPnl = null; }
    }

    // Gross purchase bills for the KPI window — this is what the Purchases
    // register and the chart show. The P&L total is smaller because milk
    // purchases are recognised once, through Milk Collection.
    const purchaseBills = (from, to) => (from && to)
        ? round2(db.prepare(
            'SELECT COALESCE(SUM(grand_total), 0) AS total FROM purchases WHERE date >= ? AND date <= ?'
        ).get(from, to).total)
        : 0;

    // 90 calendar-continuous BS dates ending today, zero-filled so the 7/30/90
    // filters show real gaps instead of skipping quiet days.
    const start = bs.addBSDays(today, -89) || today;
    const dates = [];
    for (let i = 0; i < 90; i += 1) {
        const d = bs.addBSDays(start, i);
        if (d && d <= today) dates.push(d);
    }
    const totalsByDate = (table) => new Map(
        db.prepare(
            `SELECT date, COALESCE(SUM(grand_total), 0) AS total FROM ${table}
              WHERE date >= ? AND date <= ? AND date LIKE '____-__-__'
              GROUP BY date`
        ).all(start, today).map((r) => [r.date, r.total])
    );
    const salesByDate = totalsByDate('sales');
    const purchasesByDate = totalsByDate('purchases');
    const daily = dates.map((date) => ({
        date,
        sales: round2(salesByDate.get(date) || 0),
        purchases: round2(purchasesByDate.get(date) || 0)
    }));

    // Expense heads straight from the P&L breakdown — never re-derived here.
    const heads = [
        ['milk_collection', 'Milk collection'],
        ['purchases', 'Purchases'],
        ['rent', 'Rent'],
        ['salary', 'Salary'],
        ['other_expenses', 'Other expenses'],
        ['petty_cash', 'Petty cash'],
        ['vehicle_expenses', 'Vehicle'],
        ['typed_payment_expenses', 'Typed expenses'],
        ['bank_expenses', 'Bank charges']
    ];
    const expenseHeads = pnl
        ? heads
            .map(([key, label]) => ({ key, label, amount: round2(pnl.expenses[key] && pnl.expenses[key].total) }))
            .filter((h) => h.amount > 0)
            .sort((a, b) => b.amount - a.amount)
        : [];

    // Cash & bank balances from the ledger's own position function. A held
    // cheque (PDC) still moves no money, so it is not added here.
    let cashBank = null;
    try {
        const cb = accounting.getCashBankPosition(db);
        cashBank = { cash: round2(cb.cash.balance), bank: round2(cb.bank.balance) };
    } catch (e) {
        cashBank = null;
    }

    return {
        month: {
            key: monthKey,
            label: bs.bsMonthLabel(monthKey),
            from_date: monthRange.from_date,
            to_date: today
        },
        previous_period: prevRange ? { key: prevKey, from_date: prevRange.from_date, to_date: prevTo } : null,
        kpi: (kpiCur && kpiPrev) ? {
            days: 90,
            from_date: kpiFrom,
            to_date: today,
            previous_from_date: kpiPrevFrom,
            previous_to_date: kpiPrevTo,
            current: {
                sales: round2(kpiCur.income.total_sales),
                purchases: round2(kpiCur.expenses.purchases.total),
                purchases_bills: purchaseBills(kpiFrom, today),
                net_profit: kpiCur.net_profit
            },
            previous: {
                sales: round2(kpiPrev.income.total_sales),
                purchases: round2(kpiPrev.expenses.purchases.total),
                purchases_bills: purchaseBills(kpiPrevFrom, kpiPrevTo),
                net_profit: kpiPrev.net_profit
            }
        } : null,
        totals: pnl ? {
            sales: round2(pnl.income.total_sales),
            purchases: round2(pnl.expenses.purchases.total),
            income: round2(pnl.income.total_income),
            expenses: round2(pnl.expenses.total_expenses),
            gross_profit: pnl.gross_profit,
            net_profit: pnl.net_profit,
            receipts: round2(pnl.income.total_receipts)
        } : null,
        previous: prevPnl ? {
            sales: round2(prevPnl.income.total_sales),
            purchases: round2(prevPnl.expenses.purchases.total),
            net_profit: prevPnl.net_profit
        } : null,
        daily,
        expense_heads: expenseHeads,
        cash_bank: cashBank,
        recent_sales: recentSales || [],
        recent_purchases: recentPurchases || []
    };
}

module.exports = { getDashboard, buildAnalytics };
