/**
 * Godhuli Dairy Plant — Financial Reports Operations
 * ====================================================
 * Profit & Loss, Stock Statement, and other financial summary queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Profit & Loss Statement for a given date range.
 * Calculates total income (sales + receipts) vs total expenses
 * (purchases + other expenses + petty cash + salary + vehicle expenses).
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { from_date, to_date }
 * @returns {object} { income, expenses, income_breakdown, expense_breakdown, gross_profit, net_profit }
 */
function getProfitLoss(db, { from_date, to_date } = {}) {
    const from = from_date || new Date().toISOString().split('T')[0];
    const to = to_date || from;

    // ── Income Sources ──

    // Total sales (all modes)
    const totalSales = db.prepare(`
        SELECT COALESCE(SUM(grand_total), 0) as total,
               COALESCE(SUM(paid_amount), 0) as paid,
               COUNT(*) as count
        FROM sales WHERE date >= ? AND date <= ?
    `).get(from, to);

    // Cash receipts from payments (receipts not tied to sales)
    const totalReceipts = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'receipt'
    `).get(from, to);

    // Milk collection value (income for farmers, but for the plant this is a cost)
    // Actually milk collection is raw material cost, not income
    const totalMilkCost = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM milk_collections WHERE date >= ? AND date <= ?
    `).get(from, to);

    // ── Expense Sources ──

    // Total purchases (non-milk)
    const totalPurchases = db.prepare(`
        SELECT COALESCE(SUM(grand_total), 0) as total,
               COALESCE(SUM(paid_amount), 0) as paid,
               COUNT(*) as count
        FROM purchases WHERE date >= ? AND date <= ?
    `).get(from, to);

    // Other expenses
    const totalOtherExpenses = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM other_expenses WHERE date >= ? AND date <= ?
    `).get(from, to);

    // Petty cash
    const totalPettyCash = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM petty_cash WHERE date >= ? AND date <= ?
    `).get(from, to);

    // Salary
    const totalSalary = db.prepare(`
        SELECT COALESCE(SUM(net_salary), 0) as total, COUNT(*) as count
        FROM salary_records WHERE payment_date >= ? AND payment_date <= ?
    `).get(from, to);

    // Vehicle expenses
    const totalVehicle = db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
        FROM vehicle_expenses WHERE date >= ? AND date <= ?
    `).get(from, to);

    // Cash payments made (to suppliers/farmers)
    const totalCashPayments = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'payment'
    `).get(from, to);

    // ── Build income breakdown ──
    const income = {
        total_sales: totalSales.total,
        total_receipts: totalReceipts.total,
        total_income: totalSales.total + totalReceipts.total
    };

    // Build expense breakdown
    const expenses = {
        milk_collection: { total: totalMilkCost.total, count: totalMilkCost.count },
        purchases: { total: totalPurchases.total, count: totalPurchases.count },
        other_expenses: { total: totalOtherExpenses.total, count: totalOtherExpenses.count },
        petty_cash: { total: totalPettyCash.total, count: totalPettyCash.count },
        salary: { total: totalSalary.total, count: totalSalary.count },
        vehicle_expenses: { total: totalVehicle.total, count: totalVehicle.count },
        cash_payments: { total: totalCashPayments.total, count: totalCashPayments.count },
        total_expenses: totalMilkCost.total + totalPurchases.total + totalOtherExpenses.total +
                       totalPettyCash.total + totalSalary.total + totalVehicle.total
    };

    const grossProfit = income.total_sales - expenses.milk_collection - expenses.purchases;
    const netProfit = income.total_income - expenses.total_expenses;

    return {
        from_date: from,
        to_date: to,
        income,
        expenses,
        gross_profit: grossProfit,
        net_profit: netProfit,
        sales_count: totalSales.count,
        milk_collection_count: totalMilkCost.count
    };
}

/**
 * Stock Statement — current stock valuation with quantities, rates, and values.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { category, search }
 * @returns {object} { items[], total_value, total_products }
 */
function getStockStatement(db, { category, search } = {}) {
    let query = `
        SELECT p.*,
            COALESCE((
                SELECT balance_after FROM stock_movements
                WHERE product_id = p.id ORDER BY id DESC LIMIT 1
            ), p.opening_stock) as current_stock,
            p.rate as current_rate,
            (COALESCE((
                SELECT balance_after FROM stock_movements
                WHERE product_id = p.id ORDER BY id DESC LIMIT 1
            ), p.opening_stock) * p.rate) as stock_value
        FROM products p WHERE 1=1
    `;
    const params = [];
    if (category) {
        query += " AND p.category = ?";
        params.push(category);
    }
    if (search) {
        query += " AND (p.name LIKE ? OR p.category LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY p.name";

    const items = db.prepare(query).all(...params);
    const totalValue = items.reduce((sum, i) => sum + (i.stock_value || 0), 0);
    const totalProducts = items.length;
    const totalQuantity = items.reduce((sum, i) => sum + (i.current_stock || 0), 0);

    // Get categories for filter
    const categories = db.prepare(
        "SELECT DISTINCT category FROM products WHERE category != '' ORDER BY category"
    ).all().map(r => r.category);

    return {
        items,
        total_value: totalValue,
        total_products: totalProducts,
        total_quantity: totalQuantity,
        categories
    };
}

/**
 * Daybook — full transaction listing for a date range.
 * Enhanced version that also includes cash deposits.
 */
function getEnhancedDaybook(db, { from_date, to_date } = {}) {
    const from = from_date || new Date().toISOString().split('T')[0];
    const to = to_date || from;

    // Get base daybook from existing reports module
    const baseDaybook = require('./reports').getDaybook(db, { from_date: from, to_date: to });

    // Add cash deposits
    const cashDeposits = db.prepare(`
        SELECT cd.*, 'cash_deposit' as type, cd.deposit_no as ref_no
        FROM cash_deposits cd
        WHERE cd.date >= ? AND cd.date <= ? ORDER BY cd.date, cd.id
    `).all(from, to);

    // Add cash deposit entries (credit from cash perspective - cash leaves)
    cashDeposits.forEach(cd => {
        baseDaybook.entries.push({
            date: cd.date,
            ref_no: cd.deposit_no,
            transaction_type: 'Cash Deposit',
            account: cd.bank_name,
            particulars: `Bank Deposit: ${cd.bank_name}${cd.reference_no ? ' (Ref: ' + cd.reference_no + ')' : ''}`,
            debit: 0,
            credit: cd.amount,
            type: 'cash_deposit',
            id: cd.id,
            status: 'completed'
        });
    });

    // Re-sort and recalculate
    baseDaybook.entries.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

    const totalDebit = baseDaybook.entries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = baseDaybook.entries.reduce((s, e) => s + e.credit, 0);

    return {
        ...baseDaybook,
        totalDebit,
        totalCredit,
        net: totalDebit - totalCredit,
        count: baseDaybook.entries.length,
        cashDeposits: cashDeposits.length
    };
}

module.exports = {
    getProfitLoss,
    getStockStatement,
    getEnhancedDaybook
};
