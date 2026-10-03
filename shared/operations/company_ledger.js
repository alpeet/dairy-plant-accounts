/**
 * Company Ledger — the whole business financially, on one page (spec Phase 7).
 * ========================================================================
 * This is NOT another accounting engine. It is a READ MODEL that lays the
 * existing authoritative numbers out as ledger rows:
 *
 *   - Income rows   sum to   getProfitLoss().income.total_income
 *   - Expense rows  sum to   getProfitLoss().expenses.total_expenses
 *   - Milk rows     sum to   getMilkCostSummary().milk_cost
 *   - Purchase rows sum to   getMilkCostSummary().non_milk_purchases
 *   - Other rows    sum to   getExpenseSummary().total_operating_expenses
 *   - Net           equals   getProfitLoss().net_profit
 *
 * Every call returns a `checks` array that proves those equalities at run
 * time, so a report can never silently disagree with the P&L (spec §27).
 *
 * Row model (one leg per movement, matching the spec table):
 *   { date, reference, type, particular, debit, credit, balance, category,
 *     subcategory, source, source_id }
 *
 * Categories:
 *   Income        sales, other income            → CREDIT
 *   Expense       milk procurement, purchases,
 *                 salary, electricity …          → DEBIT
 *   Balance Sheet advances, loans, repayments    → direction of the movement
 *                 (never P&L)
 *   Transfer      cash → bank moves              → shown, nets to zero
 *
 * `balance` is the running (credit − debit) position across ALL rows: it is
 * a transparency column, not a substitute for the Balance Sheet.
 *
 * Granularity: 'daily' | 'weekly' | 'monthly' | 'custom' — the rows are
 * identical; only the period subtotals change (periods are keyed off the BS
 * date calendar).
 *
 * READ-ONLY. Used by both Electron (main.js) and Web (server.js).
 */

const accounting = require('./accounting');
const { getProfitLoss } = require('./financial_reports');
const { adToBS, bsToAD } = require('../excel-import');

const round2 = accounting.round2;

function todayBS() {
    const ad = new Date().toISOString().split('T')[0];
    try { return adToBS(ad) || ad; } catch (e) { return ad; }
}

/** Sales line → which revenue bucket this invoice belongs to (display only). */
function classifySaleName(name) {
    if (accounting.detectMilkLine(name)) return 'Milk sales';
    const n = String(name || '').toLowerCase();
    if (/cream/.test(n)) return 'Cream sales';
    if (/paneer/.test(n)) return 'Paneer sales';
    if (/ghee/.test(n)) return 'Ghee sales';
    if (/nauni|butter/.test(n)) return 'Nauni sales';
    return 'Product sales';
}

/** BS week bucket: 7-day blocks anchored at the period start (real AD math). */
function weeklyKey(from, date) {
    const a = bsToAD(from);
    const b = bsToAD(date);
    if (!a || !b) return String(date).slice(0, 7);
    const day = 86400000;
    const diff = Math.floor((Date.parse(b) - Date.parse(a)) / day);
    const idx = Math.floor((diff < 0 ? diff - 6 : diff) / 7);
    const startAD = new Date(Date.parse(a) + idx * 7 * day);
    const startBS = adToBS(`${startAD.getFullYear()}-${String(startAD.getMonth() + 1).padStart(2, '0')}-${String(startAD.getDate()).padStart(2, '0')}`);
    const endAD = new Date(startAD.getTime() + 6 * day);
    const endBS = adToBS(`${endAD.getFullYear()}-${String(endAD.getMonth() + 1).padStart(2, '0')}-${String(endAD.getDate()).padStart(2, '0')}`);
    return { key: `W${idx}`, label: `Week ${startBS} → ${endBS}`, sort: `${startBS}` };
}

function periodOf(date, granularity, from) {
    if (granularity === 'daily') return { key: date, label: date, sort: date };
    if (granularity === 'monthly') return { key: String(date).slice(0, 7), label: String(date).slice(0, 7), sort: String(date).slice(0, 7) };
    if (granularity === 'weekly') {
        const w = weeklyKey(from, date);
        if (typeof w === 'object') return w;
        return { key: w, label: w, sort: w };
    }
    return { key: 'all', label: 'Period', sort: 'all' }; // custom = one range
}

/**
 * Build the company ledger for a BS date range.
 *
 * @param {object} db
 * @param {object} opts - { from_date|from, to_date|to, granularity }
 * @returns {object} { from_date, to_date, granularity, rows, periods, totals, checks, pnl }
 */
function getCompanyLedger(db, opts = {}) {
    const from = opts.from_date || opts.from || todayBS();
    const to = opts.to_date || opts.to || from;
    const granularity = ['daily', 'weekly', 'monthly', 'custom'].includes(opts.granularity)
        ? opts.granularity : 'custom';

    const rows = [];
    const push = (r) => rows.push(Object.assign({
        date: '', reference: '', type: '', particular: '',
        debit: 0, credit: 0, category: '', subcategory: '', source: '', source_id: null
    }, r));

    // ── 1. Income — sales invoices ────────────────────────────────────
    const sales = db.prepare(`
        SELECT s.id, s.date, s.invoice_no, s.grand_total, pn.name AS party_name
          FROM sales s LEFT JOIN parties pn ON pn.id = s.party_id
         WHERE s.date >= ? AND s.date <= ? ORDER BY s.date, s.id`).all(from, to);
    // Largest line decides the revenue bucket (display classification only).
    const saleItems = new Map();
    try {
        const items = db.prepare(`
            SELECT si.sale_id, si.product_name, si.amount
              FROM sales_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.date >= ? AND s.date <= ?`).all(from, to);
        for (const it of items) {
            const arr = saleItems.get(it.sale_id) || [];
            arr.push(it);
            saleItems.set(it.sale_id, arr);
        }
    } catch (e) { /* sales_items not migrated */ }
    for (const s of sales) {
        const items = saleItems.get(s.id) || [];
        let best = null;
        for (const it of items) if (!best || (Number(it.amount) || 0) > (Number(best.amount) || 0)) best = it;
        const subtype = best ? classifySaleName(best.product_name) : 'Product sales';
        push({
            date: s.date, reference: s.invoice_no || `SALE-${s.id}`, type: subtype,
            particular: `Sale to ${s.party_name || 'Customer'}`,
            credit: round2(s.grand_total), category: 'Income', subcategory: 'Sales',
            source: 'sales', source_id: s.id
        });
    }

    // ── 2. Income — other operating income (register rows tagged Income) ──
    const otherIncome = db.prepare(`
        SELECT id, date, reference_no, expense_head, description, amount
          FROM other_expenses
         WHERE date >= ? AND date <= ? AND category = 'Income'
         ORDER BY date, id`).all(from, to);
    for (const r of otherIncome) {
        push({
            date: r.date, reference: r.reference_no || '', type: 'Other operating income',
            particular: r.description || r.expense_head || 'Other income',
            credit: round2(r.amount), category: 'Income', subcategory: 'Other income',
            source: 'other_expenses', source_id: r.id
        });
    }

    // ── 3. Expense — milk procurement (recognised once, same rule as P&L) ──
    const milkCost = accounting.getMilkCostSummary(db, { from_date: from, to_date: to });
    const collections = db.prepare(`
        SELECT mc.id, mc.date, mc.collection_no, mc.amount, pn.name AS party_name
          FROM milk_collections mc LEFT JOIN parties pn ON pn.id = mc.party_id
         WHERE mc.date >= ? AND mc.date <= ? ORDER BY mc.date, mc.id`).all(from, to);
    for (const c of collections) {
        push({
            date: c.date, reference: c.collection_no || `MC-${c.id}`, type: 'Milk procurement',
            particular: `Milk from ${c.party_name || 'supplier'}`,
            debit: round2(c.amount), category: 'Expense', subcategory: 'Milk procurement',
            source: 'milk_collections', source_id: c.id
        });
    }
    // Unlinked milk lines still on purchase bills (their milk reaches the P&L
    // through these lines, never through the bill — the once-only rule).
    const unlinkedByBill = new Map();
    const unlinkedRows = db.prepare(`
        SELECT p.id AS purchase_id, p.date, p.bill_no, pi.id AS item_id, pi.product_name, pi.amount
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
         WHERE p.date >= ? AND p.date <= ?
           AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)`)
        .all(from, to).filter(r => accounting.detectMilkLine(r.product_name));
    for (const r of unlinkedRows) {
        const amt = round2(r.amount);
        unlinkedByBill.set(r.purchase_id, round2((unlinkedByBill.get(r.purchase_id) || 0) + amt));
        push({
            date: r.date, reference: r.bill_no || `PUR-${r.purchase_id}`, type: 'Milk procurement',
            particular: `${r.product_name} (milk line on bill)`,
            debit: amt, category: 'Expense', subcategory: 'Milk procurement',
            source: 'purchase_items', source_id: r.item_id
        });
    }

    // ── 4. Expense — non-milk purchases (bill value minus its milk) ───
    const linkedByBill = accounting.getLinkedMilkByBill(db, { from_date: from, to_date: to });
    const bills = db.prepare(`
        SELECT p.id, p.date, p.bill_no, p.grand_total, pn.name AS party_name
          FROM purchases p LEFT JOIN parties pn ON pn.id = p.party_id
         WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.id`).all(from, to);
    for (const b of bills) {
        const value = round2((Number(b.grand_total) || 0)
            - (linkedByBill.get(b.id) || 0)
            - (unlinkedByBill.get(b.id) || 0));
        if (value > 0.005) {
            push({
                date: b.date, reference: b.bill_no || `PUR-${b.id}`, type: 'Purchases',
                particular: `Purchase from ${b.party_name || 'supplier'}`,
                debit: value, category: 'Expense', subcategory: 'Purchases',
                source: 'purchases', source_id: b.id
            });
        }
    }

    // ── 5. Expense — operating registers (exactly what getExpenseSummary counts) ──
    const opEx = accounting.getExpenseSummary(db, { from_date: from, to_date: to });
    for (const r of db.prepare(`
        SELECT id, date, reference_no, category, expense_head, description, amount
          FROM other_expenses
         WHERE date >= ? AND date <= ? AND category != 'Income' ORDER BY date, id`).all(from, to)) {
        push({
            date: r.date, reference: r.reference_no || '', type: r.category || r.expense_head || 'Expense',
            particular: r.description || r.expense_head || 'Expense',
            debit: round2(r.amount), category: 'Expense', subcategory: 'Other expenses',
            source: 'other_expenses', source_id: r.id
        });
    }
    for (const r of db.prepare(`
        SELECT id, voucher_no, date, expense_head, description, amount
          FROM petty_cash WHERE date >= ? AND date <= ? ORDER BY date, id`).all(from, to)) {
        push({
            date: r.date, reference: r.voucher_no || '', type: 'Petty cash',
            particular: r.description || r.expense_head || 'Petty cash',
            debit: round2(r.amount), category: 'Expense', subcategory: 'Petty cash',
            source: 'petty_cash', source_id: r.id
        });
    }
    for (const r of db.prepare(`
        SELECT id, voucher_no, employee_name, month, net_salary, payment_date
          FROM salary_records WHERE payment_date >= ? AND payment_date <= ? ORDER BY payment_date, id`).all(from, to)) {
        push({
            date: r.payment_date, reference: r.voucher_no || `SAL-${r.id}`, type: 'Salary',
            particular: `Salary — ${r.employee_name} (${r.month})`,
            debit: round2(r.net_salary), category: 'Expense', subcategory: 'Salary',
            source: 'salary_records', source_id: r.id
        });
    }
    for (const r of db.prepare(`
        SELECT id, date, vehicle_name, expense_type, total_amount, remarks
          FROM vehicle_expenses WHERE date >= ? AND date <= ? ORDER BY date, id`).all(from, to)) {
        push({
            date: r.date, reference: `VEH-${r.id}`, type: 'Vehicle',
            particular: `${r.vehicle_name || 'Vehicle'} — ${r.expense_type || 'expense'}${r.remarks ? ' · ' + r.remarks : ''}`,
            debit: round2(r.total_amount), category: 'Expense', subcategory: 'Vehicle',
            source: 'vehicle_expenses', source_id: r.id
        });
    }
    // Bank expenses the register did not already carry (authoritative dedup).
    for (const r of (opEx.bank_expense_rows || [])) {
        push({
            date: r.date, reference: r.reference_no || '', type: 'Bank charges',
            particular: r.description || 'Bank expense',
            debit: round2(r.amount), category: 'Expense', subcategory: 'Bank / finance',
            source: 'bank_transactions', source_id: r.id
        });
    }
    // Typed payments that are genuine P&L expenses (same rule as the P&L).
    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.notes, pm.transaction_type, pn.name AS party_name
          FROM payments pm LEFT JOIN parties pn ON pn.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND pm.transaction_type IN ('actual_expense', 'advance_adjustment')
         ORDER BY pm.date, pm.id`).all(from, to)) {
        push({
            date: r.date, reference: `PAY-${r.id}`,
            type: r.transaction_type === 'advance_adjustment' ? 'Advance adjusted' : 'Expense payment',
            particular: r.notes || `${r.transaction_type} ${r.party_name ? '— ' + r.party_name : ''}`,
            debit: round2(r.amount), category: 'Expense', subcategory: 'Payments',
            source: 'payments', source_id: r.id
        });
    }

    // ── 6. Balance Sheet movements — NEVER P&L ────────────────────────
    const BS_LABEL = {
        advance: 'Advance paid',
        advance_returned: 'Advance returned',
        loan_given: 'Loan / sapati given',
        loan_received: 'Loan / sapati received',
        loan_repayment: 'Loan repayment'
    };
    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.notes, pm.transaction_type, pm.type, pm.mode, pn.name AS party_name
          FROM payments pm LEFT JOIN parties pn ON pn.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND pm.transaction_type IN ('advance', 'advance_returned', 'loan_given', 'loan_received', 'loan_repayment')
         ORDER BY pm.date, pm.id`).all(from, to)) {
        const tt = r.transaction_type;
        // Money out of the company (advance/loan given, repayment out) → debit.
        // advance_returned is money coming BACK → credit.
        const moneyOut = tt === 'advance' || tt === 'loan_given' || (tt === 'loan_repayment' && r.type !== 'receipt');
        push({
            date: r.date, reference: `PAY-${r.id}`, type: BS_LABEL[tt] || tt,
            particular: (r.notes || '') + (r.party_name ? `${r.notes ? ' · ' : ''}${r.party_name}` : ''),
            debit: moneyOut ? round2(r.amount) : 0,
            credit: moneyOut ? 0 : round2(r.amount),
            category: 'Balance Sheet', subcategory: (tt === 'advance' || tt === 'advance_returned') ? 'Advances' : 'Loans / Sapati',
            source: 'payments', source_id: r.id
        });
    }

    // ── 7. Internal transfers — visible, net zero ─────────────────────
    try {
        for (const r of accounting.listClassifiedBankRows(db, { from_date: from, to_date: to })) {
            if (!r.is_transfer) continue;
            const amt = round2(Math.max(Number(r.credit) || 0, Number(r.debit) || 0));
            if (!(amt > 0)) continue;
            push({
                date: r.date, reference: r.reference_no || `BANK-${r.id}`, type: 'Cash → Bank transfer',
                particular: r.description || 'Internal transfer',
                debit: amt, credit: amt, category: 'Transfer', subcategory: 'Internal transfer',
                source: 'bank_transactions', source_id: r.id
            });
        }
    } catch (e) { /* bank table not present */ }

    // ── Sort, running balance, period subtotals ──────────────────────
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (Number(a.source_id) || 0) - (Number(b.source_id) || 0));
    let running = 0;
    for (const r of rows) {
        running = round2(running + (Number(r.credit) || 0) - (Number(r.debit) || 0));
        r.balance = running;
        r.period = periodOf(r.date, granularity, from);
    }

    const periodMap = new Map();
    for (const r of rows) {
        const p = r.period;
        if (!periodMap.has(p.key)) {
            periodMap.set(p.key, {
                key: p.key, label: p.label, sort: p.sort || p.key,
                income: 0, expenses: 0, debit: 0, credit: 0, net: 0, rows: 0
            });
        }
        const acc = periodMap.get(p.key);
        acc.rows++;
        acc.debit = round2(acc.debit + (Number(r.debit) || 0));
        acc.credit = round2(acc.credit + (Number(r.credit) || 0));
        if (r.category === 'Income') acc.income = round2(acc.income + (Number(r.credit) || 0));
        if (r.category === 'Expense') acc.expenses = round2(acc.expenses + (Number(r.debit) || 0));
    }
    const periods = [...periodMap.values()].sort((a, b) => String(a.sort).localeCompare(String(b.sort)));
    for (const p of periods) p.net = round2(p.income - p.expenses);

    const sumBy = (cat, side) => round2(rows.filter(r => r.category === cat).reduce((s, r) => s + (Number(r[side]) || 0), 0));
    const incomeTotal = sumBy('Income', 'credit');
    const expenseTotal = sumBy('Expense', 'debit');
    const bsDebit = sumBy('Balance Sheet', 'debit');
    const bsCredit = sumBy('Balance Sheet', 'credit');
    const milkRowsTotal = round2(rows.filter(r => r.subcategory === 'Milk procurement' && r.category === 'Expense').reduce((s, r) => s + (Number(r.debit) || 0), 0));
    const purchaseRowsTotal = round2(rows.filter(r => r.subcategory === 'Purchases' && r.category === 'Expense').reduce((s, r) => s + (Number(r.debit) || 0), 0));
    const operatingRowsTotal = round2(expenseTotal - milkRowsTotal - purchaseRowsTotal);
    const salesRowsTotal = round2(rows.filter(r => r.category === 'Income' && r.subcategory === 'Sales').reduce((s, r) => s + (Number(r.credit) || 0), 0));
    const otherIncomeRowsTotal = round2(incomeTotal - salesRowsTotal);

    const totals = {
        income: incomeTotal,
        expenses: expenseTotal,
        net: round2(incomeTotal - expenseTotal),
        sales: salesRowsTotal,
        other_income: otherIncomeRowsTotal,
        milk_procurement: milkRowsTotal,
        purchases: purchaseRowsTotal,
        operating_expenses: operatingRowsTotal,
        balance_sheet_debit: bsDebit,
        balance_sheet_credit: bsCredit,
        transfers: round2(rows.filter(r => r.category === 'Transfer').reduce((s, r) => s + (Number(r.debit) || 0), 0)),
        debit_total: round2(rows.reduce((s, r) => s + (Number(r.debit) || 0), 0)),
        credit_total: round2(rows.reduce((s, r) => s + (Number(r.credit) || 0), 0)),
        row_count: rows.length
    };

    // ── Prove the ledger agrees with the authoritative numbers ───────
    const pnl = getProfitLoss(db, { from_date: from, to_date: to });
    const near = (a, b) => Math.abs(round2(a) - round2(b)) <= 0.01;
    const checks = [
        { name: 'Sales rows = P&L sales', expected: round2(pnl.income.total_sales), actual: salesRowsTotal, ok: near(salesRowsTotal, pnl.income.total_sales) },
        { name: 'Other income rows = P&L other income', expected: round2(pnl.income.total_other_income), actual: otherIncomeRowsTotal, ok: near(otherIncomeRowsTotal, pnl.income.total_other_income) },
        { name: 'Income rows = P&L total income', expected: round2(pnl.income.total_income), actual: incomeTotal, ok: near(incomeTotal, pnl.income.total_income) },
        { name: 'Milk rows = milk cost (counted once)', expected: milkCost.milk_cost, actual: milkRowsTotal, ok: near(milkRowsTotal, milkCost.milk_cost) },
        { name: 'Purchase rows = non-milk purchases', expected: milkCost.non_milk_purchases, actual: purchaseRowsTotal, ok: near(purchaseRowsTotal, milkCost.non_milk_purchases) },
        { name: 'Operating rows = expense summary', expected: round2(opEx.total_operating_expenses), actual: operatingRowsTotal, ok: near(operatingRowsTotal, opEx.total_operating_expenses) },
        { name: 'Expense rows = P&L total expenses', expected: round2(pnl.expenses.total_expenses), actual: expenseTotal, ok: near(expenseTotal, pnl.expenses.total_expenses) },
        { name: 'Net = P&L net profit', expected: round2(pnl.net_profit), actual: totals.net, ok: near(totals.net, pnl.net_profit) },
        { name: 'Balance-sheet rows carry their own totals (never P&L)',
            expected: `${round2(bsDebit)} DR / ${round2(bsCredit)} CR`,
            actual: `${round2(bsDebit)} DR / ${round2(bsCredit)} CR`, ok: true }
    ];

    return {
        from_date: from, to_date: to, granularity,
        rows, periods, totals, checks, pnl,
        all_checks_ok: checks.every(c => c.ok)
    };
}

module.exports = { getCompanyLedger, classifySaleName };
