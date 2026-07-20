/**
 * Godhuli Dairy Plant — Daily Cash Collection Operations
 * =======================================================
 * Generates daily cash collection reports by aggregating
 * cash sales, cash receipts, and cash payments.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get daily cash collection report for a given date range.
 * Aggregates: cash sales, cash receipts, cash payments, payment mode breakdown.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { from_date, to_date }
 * @returns {object} { days[], total_cash_in, total_cash_out, net_cash }
 */
function getDailyCashCollection(db, { from_date, to_date } = {}) {
    const from = from_date || new Date().toISOString().split('T')[0];
    const to = to_date || from;

    // Cash sales (payment_mode = 'cash')
    const cashSales = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
        FROM sales
        WHERE date >= ? AND date <= ? AND payment_mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Cash receipts from payments table
    const cashReceipts = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'receipt' AND mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Cash payments made
    const cashPayments = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'payment' AND mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Build daily breakdown
    const dateMap = {};
    
    cashSales.forEach(s => {
        if (!dateMap[s.date]) dateMap[s.date] = { date: s.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0 };
        dateMap[s.date].cash_sales_count = s.count;
        dateMap[s.date].cash_sales_total = s.total;
    });

    cashReceipts.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0 };
        dateMap[r.date].cash_receipts_count = r.count;
        dateMap[r.date].cash_receipts_total = r.total;
    });

    cashPayments.forEach(p => {
        if (!dateMap[p.date]) dateMap[p.date] = { date: p.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0 };
        dateMap[p.date].cash_payments_count = p.count;
        dateMap[p.date].cash_payments_total = p.total;
    });

    // Also get sales by other modes (bank, upi, credit) for completeness
    const otherSales = db.prepare(`
        SELECT date, payment_mode, COALESCE(SUM(paid_amount), 0) as total
        FROM sales
        WHERE date >= ? AND date <= ? AND payment_mode != 'cash'
        GROUP BY date, payment_mode ORDER BY date
    `).all(from, to);

    otherSales.forEach(s => {
        if (!dateMap[s.date]) dateMap[s.date] = { date: s.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0 };
        dateMap[s.date].other_receipts_total += s.total;
    });

    const days = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate per-day net
    days.forEach(d => {
        d.total_cash_in = d.cash_sales_total + d.cash_receipts_total;
        d.total_cash_out = d.cash_payments_total;
        d.net_cash = d.total_cash_in - d.total_cash_out;
    });

    // Totals
    const total_cash_in = days.reduce((s, d) => s + d.total_cash_in, 0);
    const total_cash_out = days.reduce((s, d) => s + d.total_cash_out, 0);
    const net_cash = total_cash_in - total_cash_out;

    return { days, total_cash_in, total_cash_out, net_cash, from_date: from, to_date: to };
}

module.exports = { getDailyCashCollection };
