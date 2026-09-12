/**
 * Prarambha Account & Stock Management — Financial Reports Operations
 * ====================================================
 * Profit & Loss, Stock Statement, and other financial summary queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Profit & Loss Statement for a given date range (accrual basis).
 *
 * Income  = sales revenue for the period (+ Other Income rows in the
 *           Expenses register whose category is 'Income').
 *           Collection receipts are NOT income: they are cash movements
 *           against the same sales invoices — counting both double-counts.
 *
 * Expenses = purchases + milk collections (COGS), plus operating costs
 *           (salary, other expenses, petty cash, vehicle). Cash payments to
 *           suppliers are NOT expenses: they settle purchase liabilities
 *           already counted when the purchase was booked.
 *
 * Gross profit  = sales − COGS (purchases + milk collections)
 * Net profit    = total income − total expenses
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { from_date, to_date }
 * @returns {object} { income, expenses, gross_profit, net_profit, ... }
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

    // Cash receipts from payments — reference only (cash flow), NOT income:
    // these collect against the same sales invoices counted below.
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

    // Cash payments made (to suppliers/farmers) — reference only (cash flow),
    // NOT P&L expense: purchases are already expensed at invoice value.
    const totalCashPayments = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'payment'
    `).get(from, to);

    // Other income rows (category 'Income' in the Expenses register)
    const totalOtherIncome = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM other_expenses
        WHERE date >= ? AND date <= ? AND category = 'Income'
    `).get(from, to);

    // ── Build income breakdown ──
    // Receipts are shown for reference (cash flow) but excluded from income —
    // they collect against the sales already counted above.
    const income = {
        total_sales: totalSales.total,
        total_receipts: totalReceipts.total,
        total_other_income: totalOtherIncome.total,
        total_income: totalSales.total + totalOtherIncome.total
    };

    // Build expense breakdown (cash payments to suppliers are cash flow,
    // not P&L expense — purchases are already counted at invoice value)
    const expenses = {
        milk_collection: { total: totalMilkCost.total, count: totalMilkCost.count },
        purchases: { total: totalPurchases.total, count: totalPurchases.count },
        other_expenses: { total: totalOtherExpenses.total - totalOtherIncome.total, count: totalOtherExpenses.count - totalOtherIncome.count },
        petty_cash: { total: totalPettyCash.total, count: totalPettyCash.count },
        salary: { total: totalSalary.total, count: totalSalary.count },
        vehicle_expenses: { total: totalVehicle.total, count: totalVehicle.count },
        cash_payments: { total: totalCashPayments.total, count: totalCashPayments.count },
        total_expenses: totalMilkCost.total + totalPurchases.total +
                       (totalOtherExpenses.total - totalOtherIncome.total) +
                       totalPettyCash.total + totalSalary.total + totalVehicle.total
    };

    const cogs = (expenses.milk_collection.total || 0) + (expenses.purchases.total || 0);
    const operatingExpenses = expenses.total_expenses - cogs;
    const grossProfit = income.total_sales - cogs;
    const netProfit = income.total_income - expenses.total_expenses;

    return {
        from_date: from,
        to_date: to,
        income,
        expenses,
        cogs,
        operating_expenses: operatingExpenses,
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
