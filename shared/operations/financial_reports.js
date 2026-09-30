/**
 * Prarambha Account & Stock Management — Financial Reports Operations
 * ====================================================
 * Profit & Loss, Stock Statement, and other financial summary queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

const accounting = require('./accounting');
const round2 = accounting.round2;

/**
 * Profit & Loss Statement for a given date range (accrual basis).
 *
 * Income  = sales revenue for the period (+ Other Income rows in the
 *           Expenses register whose category is 'Income').
 *           Collection receipts are NOT income: they are cash movements
 *           against the same sales invoices — counting both double-counts.
 *
 * Expenses = COGS + operating costs.
 *
 *   COGS  = milk purchase cost (counted ONCE) + non-milk purchases.
 *           Milk Collection is the operational source of the milk bought from
 *           suppliers. When the Excel importer also left the milk lines inside
 *           a Purchase bill, that bill is linked from milk_collections
 *           (purchase_ref_id) and its milk portion is taken out of "purchases"
 *           so the same milk is never recognised twice. See
 *           accounting.getMilkCostSummary().
 *
 *   Operating = salary + other expenses + petty cash + vehicle + office
 *           expenses paid straight from the bank (recognised once — a bank row
 *           already represented in the Expenses register is not added again).
 *
 *           Cash payments to suppliers are NOT expenses: they settle purchase
 *           liabilities already counted when the purchase was booked.
 *
 * Gross profit  = sales − COGS
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

    // ── Expense Sources ──

    // Milk purchase cost, recognised ONCE, together with the non-milk purchases
    // that are left after the milk already represented by a Milk Collection is
    // taken out of the purchase register.
    const milkCosts = accounting.getMilkCostSummary(db, { from_date: from, to_date: to });
    const totalMilkCost = { total: milkCosts.milk_cost, count: milkCosts.milk_collection_count };
    const totalPurchases = {
        total: milkCosts.non_milk_purchases,
        count: milkCosts.purchases_count,
        gross_total: milkCosts.purchases_total,
        linked_milk_excluded: milkCosts.linked_to_purchase,
        unlinked_milk_lines: milkCosts.unlinked_milk_lines
    };

    // Operating expenses — each recognised once. Also picks up office expenses
    // paid straight from the bank that never reached the Expenses register,
    // skipping any bank row the register already carries (linked by reference,
    // or by date + amount when there is no reference).
    const opEx = accounting.getExpenseSummary(db, { from_date: from, to_date: to });
    const totalOtherExpenses = { total: opEx.other_expenses, count: 0 };
    const totalPettyCash = { total: opEx.petty_cash, count: 0 };
    const totalSalary = { total: opEx.salary, count: 0 };
    const totalVehicle = { total: opEx.vehicle_expenses, count: 0 };
    const totalBankExpenses = { total: opEx.bank_expenses, count: opEx.bank_expense_rows.length };

    // Cash payments made (to suppliers/farmers) — reference only (cash flow),
    // NOT P&L expense: purchases are already expensed at invoice value.
    const totalCashPayments = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'payment'
    `).get(from, to);

    // Other income rows (category 'Income' in the Expenses register)
    const totalOtherIncome = { total: opEx.other_income, count: 0 };

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
        // Milk purchase cost — Milk Collection is the source transaction, and the
        // milk portion of any linked purchase bill is excluded from `purchases`
        // below, so this amount is recognised exactly once.
        milk_collection: { total: totalMilkCost.total, count: totalMilkCost.count },
        purchases: { total: totalPurchases.total, count: totalPurchases.count },
        other_expenses: { total: totalOtherExpenses.total, count: totalOtherExpenses.count },
        petty_cash: { total: totalPettyCash.total, count: totalPettyCash.count },
        salary: { total: totalSalary.total, count: totalSalary.count },
        vehicle_expenses: { total: totalVehicle.total, count: totalVehicle.count },
        bank_expenses: { total: totalBankExpenses.total, count: totalBankExpenses.count },
        cash_payments: { total: totalCashPayments.total, count: totalCashPayments.count },
        total_expenses: totalMilkCost.total + totalPurchases.total +
                       totalOtherExpenses.total +
                       totalPettyCash.total + totalSalary.total + totalVehicle.total +
                       totalBankExpenses.total
    };

    const cogs = round2((expenses.milk_collection.total || 0) + (expenses.purchases.total || 0));
    // Lot-basis COGS (FIFO actual cost of sold finished goods + wastage) is
    // reported alongside the purchase-basis COGS once lot tracking has begun.
    // It never changes the legacy figures — both bases stay visible.
    let lotCogs = 0; let lotCogsAvailable = false;
    try {
        const costing = require('./production_costing');
        const cut = costing.getLotCutover(db);
        if (cut && cut <= to) {
            const soldCogs = db.prepare(
                "SELECT COALESCE(SUM(lc.total_cost), 0) c FROM lot_consumptions lc WHERE lc.reference_type = 'sale' AND lc.date BETWEEN ? AND ?"
            ).get(cut > from ? cut : from, to).c;
            const wastageCogs = db.prepare(
                'SELECT COALESCE(SUM(total_cost), 0) c FROM wastage_records WHERE date BETWEEN ? AND ?'
            ).get(cut > from ? cut : from, to).c;
            lotCogs = round2(soldCogs + wastageCogs);
            lotCogsAvailable = true;
        }
    } catch (e) { /* costing module not present */ }
    const operatingExpenses = round2(expenses.total_expenses - cogs);
    const grossProfit = round2(income.total_sales - cogs);
    const netProfit = round2(income.total_income - expenses.total_expenses);

    return {
        from_date: from,
        to_date: to,
        income,
        expenses,
        cogs,
        lot_cogs: lotCogs,
        lot_cogs_available: lotCogsAvailable,
        operating_expenses: operatingExpenses,
        gross_profit: grossProfit,
        gross_profit_lot_basis: lotCogsAvailable ? round2(income.total_sales - lotCogs) : null,
        net_profit: netProfit,
        sales_count: totalSales.count,
        milk_collection_count: totalMilkCost.count,
        // Transparency: the gross purchase register and what was excluded from it.
        milk_cost_basis: {
            milk_collections: milkCosts.milk_collections,
            linked_milk_in_purchases: milkCosts.linked_to_purchase,
            unlinked_milk_lines: milkCosts.unlinked_milk_lines,
            purchases_gross: milkCosts.purchases_total,
            milk_cost: milkCosts.milk_cost,
            non_milk_purchases: milkCosts.non_milk_purchases
        },
        bank_expenses: opEx.bank_expense_rows
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
    // Milk already represented by a Milk Collection: excluded from purchases so
    // the milk purchase cost is recognised once (same rule as getProfitLoss).
    const linkedMilk = db.prepare(`
        SELECT substr(date, 1, 7) as ym, COALESCE(SUM(amount), 0) as total
        FROM milk_collections
        WHERE date >= ? AND date <= ? AND purchase_ref_id IS NOT NULL
        GROUP BY ym
    `).all(from, to);
    // Milk lines still sitting on purchase bills with no linked collection.
    const unlinkedMilkLines = db.prepare(`
        SELECT substr(p.date, 1, 7) as ym, pi.product_name, pi.amount
        FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.date >= ? AND p.date <= ?
          AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)
    `).all(from, to);
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
    // Office expenses paid straight from the bank that never reached the
    // Expenses register — added once, never on top of a register row.
    const registeredRefs = new Set(
        db.prepare(`SELECT reference_no FROM other_expenses WHERE date >= ? AND date <= ? AND COALESCE(reference_no,'') != ''`)
            .all(from, to).map(r => String(r.reference_no).trim())
    );
    const registeredAmounts = new Set(
        db.prepare(`SELECT date, amount FROM other_expenses WHERE date >= ? AND date <= ?`)
            .all(from, to).map(r => `${r.date}|${Math.round((Number(r.amount) + Number.EPSILON) * 100) / 100}`)
    );
    const bankExpenseRows = accounting.listClassifiedBankRows(db, { from_date: from, to_date: to })
        .filter(r => r.is_expense)
        .filter(r => {
            const amount = Math.round((Number(r.debit) + Number.EPSILON) * 100) / 100;
            if (!(amount > 0)) return false;
            const ref = String(r.reference_no || '').trim();
            if (ref) return !registeredRefs.has(ref);
            return !registeredAmounts.has(`${r.date}|${amount}`);
        });

    const byMonth = {};   // ym -> component map
    const ensure = (ym) => {
        if (!byMonth[ym]) byMonth[ym] = {
            sales: 0, sales_count: 0, other_income: 0, receipts: 0, receipts_count: 0,
            milk: 0, purchases_gross: 0, linked_milk: 0, unlinked_milk_lines: 0, purchases: 0,
            other_expense: 0, petty: 0, salary: 0, vehicle: 0, bank_expense: 0
        };
        return byMonth[ym];
    };
    // Milk purchase cost per month = collections + any unlinked raw-milk lines;
    // purchases per month = gross purchases − linked milk − unlinked milk lines.
    const settleMonth = (m) => {
        m.milk = r2(m.milk + m.unlinked_milk_lines);
        m.purchases = Math.max(0, r2(m.purchases_gross - m.linked_milk - m.unlinked_milk_lines));
        return m;
    };
    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const absorb = (rows, key, countKey) => rows.forEach(r => {
        const m = ensure(r.ym);
        m[key] = r.total;
        if (countKey) m[countKey] = r.count;
    });
    absorb(sales, 'sales', 'sales_count');
    absorb(otherIncome, 'other_income');
    absorb(receipts, 'receipts', 'receipts_count');
    absorb(milk, 'milk');
    absorb(purchases, 'purchases_gross');
    absorb(linkedMilk, 'linked_milk');
    absorb(otherExpense, 'other_expense');
    absorb(petty, 'petty');
    absorb(salary, 'salary');
    absorb(vehicle, 'vehicle');
    for (const row of unlinkedMilkLines) {
        if (row.ym && accounting.detectMilkLine(row.product_name)) {
            ensure(row.ym).unlinked_milk_lines = r2(ensure(row.ym).unlinked_milk_lines + (Number(row.amount) || 0));
        }
    }
    for (const row of bankExpenseRows) {
        const ym = String(row.date || '').slice(0, 7);
        if (!ym) continue;
        ensure(ym).bank_expense = r2(ensure(ym).bank_expense + (Number(row.debit) || 0));
    }

    const BS_MONTHS = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
        'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

    const round2 = (n) => Math.round(n * 100) / 100;
    const months = Object.keys(byMonth).sort().map(ym => {
        const m = byMonth[ym];
        settleMonth(m);
        const income = m.sales + m.other_income;
        const cogs = round2(m.milk + m.purchases);
        const opex = round2(m.other_expense + m.petty + m.salary + m.vehicle + m.bank_expense);
        const totalExpenses = round2(cogs + opex);
        const ymNum = parseInt(ym.slice(5, 7), 10);
        return {
            ym,
            label: `${ym} (${BS_MONTHS[ymNum - 1] || ''})`.trim(),
            sales: round2(m.sales),
            sales_count: m.sales_count,
            other_income: round2(m.other_income),
            total_income: round2(income),
            milk_collection: round2(m.milk),
            purchases: round2(m.purchases),
            bank_expenses: round2(m.bank_expense),
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
 *
 * Enhanced version that also carries the money movements that touch no party
 * account:
 *   · cash deposits / bank-account deposits  → Bank DR · Cash CR  (a transfer,
 *     never income, a sale or a customer payment)
 *   · office expenses paid straight from the bank → Office Expense DR · Bank CR
 *
 * Customer receipts and supplier payments carried by bank rows are deliberately
 * left out: they are already in the Daybook through the party documents, and
 * adding them again would count the same money twice.
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

    const depositRefs = new Set();
    // Add cash deposit entries — a Cash → Bank transfer (Bank DR · Cash CR)
    cashDeposits.forEach(cd => {
        if (cd.deposit_no) depositRefs.add(String(cd.deposit_no).trim());
        if (cd.reference_no) depositRefs.add(String(cd.reference_no).trim());
        const m = accounting.classifyTransaction({ type: 'cash_deposit' });
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
            status: 'completed',
            kind: m.kind,
            debit_account: m.debit_account,
            credit_account: m.credit_account,
            is_transfer: true
        });
    });

    // Bank statement rows that are internal transfers (cash/own-account deposits)
    // or office expenses paid from the bank. Rows matching a cash_deposits record
    // are skipped so the same deposit is not listed twice.
    const bankRows = accounting.listClassifiedBankRows(db, { from_date: from, to_date: to })
        .filter(r => r.is_transfer || r.is_expense)
        .filter(r => !(r.reference_no && depositRefs.has(String(r.reference_no).trim())));

    bankRows.forEach(r => {
        const isTransfer = r.is_transfer;
        const m = accounting.classifyTransaction({
            type: 'bank',
            accounting_class: r.accounting_class,
            direction: (Number(r.debit) || 0) > 0 ? 'out' : 'in'
        });
        const amount = isTransfer ? (Number(r.credit) || 0) || (Number(r.debit) || 0) : (Number(r.debit) || 0);
        baseDaybook.entries.push({
            date: r.date,
            ref_no: r.reference_no || `BNK-${r.id}`,
            transaction_type: isTransfer ? 'Cash → Bank Transfer' : 'Expense (Bank)',
            account: r.counterparty_name || r.bank_account || '',
            particulars: r.description || r.counterparty_name || '',
            // Transfer: money leaves cash (credit side). Expense: expense is a debit.
            debit: isTransfer ? 0 : amount,
            credit: isTransfer ? amount : 0,
            type: isTransfer ? 'cash_transfer' : 'bank_expense',
            id: r.id,
            status: 'completed',
            kind: m.kind,
            debit_account: m.debit_account,
            credit_account: m.credit_account,
            is_transfer: isTransfer,
            is_expense: !isTransfer
        });
    });

    // Re-sort and recalculate
    baseDaybook.entries.sort((a, b) => a.date.localeCompare(b.date) || String(a.type).localeCompare(String(b.type)));

    const totalDebit = baseDaybook.entries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = baseDaybook.entries.reduce((s, e) => s + e.credit, 0);

    return {
        ...baseDaybook,
        totalDebit,
        totalCredit,
        net: totalDebit - totalCredit,
        count: baseDaybook.entries.length,
        cashDeposits: cashDeposits.length,
        bankTransfers: bankRows.filter(r => r.is_transfer).length,
        bankExpenses: bankRows.filter(r => r.is_expense).length,
        milk: baseDaybook.milk
    };
}

module.exports = {
    getProfitLoss,
    getProfitLossByMonth,
    getStockStatement,
    getEnhancedDaybook
};
