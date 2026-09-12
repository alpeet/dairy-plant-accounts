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
 * Month-by-month comparative Profit & Loss for a BS date range.
 * Same accrual basis as getProfitLoss: sales revenue (+ 'Income' category
 * rows) vs COGS (purchases + milk collections) and operating costs.
 * Collection receipts are reported per month for cash-flow reference only.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { from_date, to_date } (BS dates; defaults to the
 *                        current BS year start → today)
 * @returns {object} { from_date, to_date, months: [...], totals: {...} }
 */
function getProfitLossByMonth(db, { from_date, to_date } = {}) {
    const { adToBS } = require('../excel-import');
    const todayBS = adToBS(new Date().toISOString().split('T')[0]) || new Date().toISOString().split('T')[0];
    const from = from_date || `${String(todayBS).slice(0, 4)}-01-01`;
    const to = to_date || todayBS;

    // Every transaction table grouped by BS month prefix (YYYY-MM). Stored dates
    // are zero-padded BS strings; substr gives the month key. strftime() is not
    // usable here (BS dates like 2083-03-32 are not valid AD dates).
    const groupSum = (table, dateCol, expr) => db.prepare(`
        SELECT substr(${dateCol}, 1, 7) as ym, COALESCE(SUM(${expr}), 0) as total, COUNT(*) as count
        FROM ${table}
        WHERE ${dateCol} >= ? AND ${dateCol} <= ? AND ${dateCol} IS NOT NULL AND ${dateCol} != ''
        GROUP BY ym
    `);

    const sales = groupSum('sales', 'date', 'grand_total').all(from, to);
    const milk = groupSum('milk_collections', 'date', 'amount').all(from, to);
    const purchases = groupSum('purchases', 'date', 'grand_total').all(from, to);
    const petty = groupSum('petty_cash', 'date', 'amount').all(from, to);
    const salary = groupSum('salary_records', 'payment_date', 'net_salary').all(from, to);
    const vehicle = groupSum('vehicle_expenses', 'date', 'total_amount').all(from, to);
    const receipts = db.prepare(`
        SELECT substr(date, 1, 7) as ym, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM payments WHERE date >= ? AND date <= ? AND type = 'receipt'
        GROUP BY ym
    `).all(from, to);
    // 'Income' rows are revenue; the rest of other_expenses are operating costs
    const otherIncome = db.prepare(`
        SELECT substr(date, 1, 7) as ym, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM other_expenses WHERE date >= ? AND date <= ? AND category = 'Income' GROUP BY ym
    `).all(from, to);
    const otherExpense = db.prepare(`
        SELECT substr(date, 1, 7) as ym, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM other_expenses WHERE date >= ? AND date <= ? AND category != 'Income' GROUP BY ym
    `).all(from, to);

    const byMonth = {};   // ym -> component map
    const ensure = (ym) => {
        if (!byMonth[ym]) byMonth[ym] = {
            sales: 0, sales_count: 0, other_income: 0, receipts: 0, receipts_count: 0,
            milk: 0, purchases: 0, other_expense: 0, petty: 0, salary: 0, vehicle: 0
        };
        return byMonth[ym];
    };
    const absorb = (rows, key, countKey) => rows.forEach(r => {
        const m = ensure(r.ym);
        m[key] = r.total;
        if (countKey) m[countKey] = r.count;
    });
    absorb(sales, 'sales', 'sales_count');
    absorb(otherIncome, 'other_income');
    absorb(receipts, 'receipts', 'receipts_count');
    absorb(milk, 'milk');
    absorb(purchases, 'purchases');
    absorb(otherExpense, 'other_expense');
    absorb(petty, 'petty');
    absorb(salary, 'salary');
    absorb(vehicle, 'vehicle');

    const BS_MONTHS = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
        'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

    const round2 = (n) => Math.round(n * 100) / 100;
    const months = Object.keys(byMonth).sort().map(ym => {
        const m = byMonth[ym];
        const income = m.sales + m.other_income;
        const cogs = m.milk + m.purchases;
        const opex = m.other_expense + m.petty + m.salary + m.vehicle;
        const totalExpenses = cogs + opex;
        const ymNum = parseInt(ym.slice(5, 7), 10);
        return {
            ym,
            label: `${ym} (${BS_MONTHS[ymNum - 1] || ''})`.trim(),
            sales: round2(m.sales),
            sales_count: m.sales_count,
            other_income: round2(m.other_income),
            total_income: round2(income),
            cogs: round2(cogs),
            gross_profit: round2(income - cogs),
            operating_expenses: round2(opex),
            total_expenses: round2(totalExpenses),
            net_profit: round2(income - totalExpenses),
            receipts: round2(m.receipts),
            receipts_count: m.receipts_count
        };
    });

    const sum = (key) => round2(months.reduce((s, m) => s + (m[key] || 0), 0));
    const sumCount = (key) => months.reduce((s, m) => s + (m[key] || 0), 0);
    const totals = {
        sales: sum('sales'), sales_count: sumCount('sales_count'),
        other_income: sum('other_income'),
        total_income: sum('total_income'),
        cogs: sum('cogs'),
        gross_profit: sum('gross_profit'),
        operating_expenses: sum('operating_expenses'),
        total_expenses: sum('total_expenses'),
        net_profit: sum('net_profit'),
        receipts: sum('receipts'), receipts_count: sumCount('receipts_count')
    };

    return { from_date: from, to_date: to, months, totals };
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
    getProfitLossByMonth,
    getStockStatement,
    getEnhancedDaybook
};
