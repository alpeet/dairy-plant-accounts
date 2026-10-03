/**
 * Management Reports — acceptance tests (spec Phases 11–16)
 * =========================================================
 * Two comparable weeks of data (current 2083-07-01…07, previous
 * 2083-06-24…30) then prove:
 *
 *   - normalizeExpenseCategory maps the five registers onto ONE vocabulary
 *   - Expense Analysis totals = P&L totals (milk / purchases / operating)
 *   - Board Report: revenue split, COGS, gross, op-ex table with
 *     previous-period change and % of sales, net waterfall = P&L net
 *   - Indicators are FACTUAL numbers only (never good/bad judgements)
 *   - Weekly / monthly / daily management reports + comparisons
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-management-reports.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const mgmt = require(path.join(ROOT, 'shared', 'operations', 'management_reports.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const payments = require(path.join(ROOT, 'shared', 'operations', 'payments.js'));

const DB_PATH = '/tmp/mgmt-reports-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'mgmt-reports-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;

// ── Seed ──────────────────────────────────────────────────────
const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const cust = party('MR Customer', 'customer');
const farmer = party('MR Farmer', 'farmer');
const supplier = party('MR Supplier', 'supplier');

const ensureProduct = (name, unit, rate) => {
    let p = db.prepare('SELECT id FROM products WHERE name = ?').get(name);
    if (!p) p = { id: Number(db.prepare('INSERT INTO products (name, unit, rate, category) VALUES (?, ?, ?, ?)').run(name, unit, rate, 'Dairy').lastInsertRowid) };
    return p.id;
};
const milkProd = ensureProduct('Mixed Milk', 'L', 120);
const gheeProd = ensureProduct('Ghee', 'kg', 2000);
const cartonProd = ensureProduct('Packing Carton', 'pcs', 10);

const sale = (no, date, items) => {
    const total = items.reduce((s, i) => s + i.amount, 0);
    const id = Number(db.prepare(
        'INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)'
    ).run(no, date, cust, total, total, 'credit', 'unpaid').lastInsertRowid);
    for (const it of items) {
        db.prepare('INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, it.product_id, it.name, it.qty, it.unit, it.rate, it.amount);
    }
    return id;
};
const expense = (date, category, head, desc, amount) =>
    db.prepare("INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode) VALUES (?, ?, ?, ?, ?, ?, 'cash')")
        .run(date, category, head, desc, amount, 'Vendor');

// Current week: 2083-07-01 … 2083-07-07
milkOps.saveMilkCollection(db, {
    collection_no: 'MR-MC-1', date: '2083-07-02', party_id: farmer, milk_type: 'cow',
    quantity_liters: 500, fat_percent: 4.2, snf_percent: 8.3, rate: 80, amount: 40000,
    shift: 'morning', status: 'pending'
}, 1);
sale('INV-MR-1', '2083-07-03', [
    { product_id: milkProd, name: 'Mixed Milk', qty: 500, unit: 'L', rate: 120, amount: 60000 },
    { product_id: gheeProd, name: 'Ghee', qty: 20, unit: 'kg', rate: 2000, amount: 40000 },
]);
// Non-milk purchase bill (packaging) — the cogs purchases side
{
    const id = Number(db.prepare(
        'INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)'
    ).run('PUR-MR-1', '2083-07-02', supplier, 10000, 10000, 'credit', 'unpaid').lastInsertRowid);
    db.prepare('INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, cartonProd, 'Packing Carton', 1000, 'pcs', 10, 10000);
}
expense('2083-07-03', 'Electricity', 'Electricity', 'Boiler electricity bill', 6000);
expense('2083-07-05', 'Office', 'Office', 'Stationery and printing', 1000);
db.prepare("INSERT INTO salary_records (employee_name, month, net_salary, payment_date, payment_mode) VALUES ('Ramesh', '2083-03', 20000, '2083-07-05', 'cash')").run();
db.prepare("INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount) VALUES ('PC-MR-1', '2083-07-04', 'Office', 'Tea for staff', 500)").run();
db.prepare("INSERT INTO vehicle_expenses (date, vehicle_name, expense_type, total_amount) VALUES ('2083-07-04', 'Truck-1', 'fuel', 2000)").run();
expense('2083-07-04', 'Income', 'Commission', 'Scrap sale commission', 2000);   // other income
payments.savePayment(db, { party_id: supplier, date: '2083-07-01', type: 'payment', transaction_type: 'advance', amount: 30000, mode: 'cash', notes: 'Advance' });

// Previous week: 2083-06-24 … 2083-06-30
milkOps.saveMilkCollection(db, {
    collection_no: 'MR-MC-2', date: '2083-06-25', party_id: farmer, milk_type: 'cow',
    quantity_liters: 400, fat_percent: 4.1, snf_percent: 8.2, rate: 75, amount: 30000,
    shift: 'morning', status: 'pending'
}, 1);
sale('INV-MR-2', '2083-06-25', [
    { product_id: milkProd, name: 'Mixed Milk', qty: 400, unit: 'L', rate: 115, amount: 46000 },
    { product_id: gheeProd, name: 'Ghee', qty: 17, unit: 'kg', rate: 2000, amount: 34000 },
]);
expense('2083-06-26', 'Electricity', 'Electricity', 'Boiler electricity bill', 4000);
db.prepare("INSERT INTO salary_records (employee_name, month, net_salary, payment_date, payment_mode) VALUES ('Ramesh', '2083-02', 20000, '2083-06-27', 'cash')").run();

// ── 1. One vocabulary ─────────────────────────────────────────
console.log('\n═══ 1. normalizeExpenseCategory — one vocabulary ═══');
check('1a. electricity', mgmt.normalizeExpenseCategory({ category: 'Electricity' }) === 'Electricity');
check('1b. boiler fuel text → Fuel', mgmt.normalizeExpenseCategory({ expense_head: 'Fuel', description: 'Diesel for boiler' }) === 'Fuel');
check('1c. salary rows → Salary', mgmt.normalizeExpenseCategory({ category: 'Salary' }) === 'Salary');
check('1d. stationery → Office', mgmt.normalizeExpenseCategory({ description: 'Office stationery purchase' }) === 'Office');
check('1e. bank charge → Bank / finance', mgmt.normalizeExpenseCategory({ description: 'Bank charge for transfer' }) === 'Bank / finance');
check('1f. cartons → Packaging', mgmt.normalizeExpenseCategory({ item_names: 'Packing Carton, Poly bag' }) === 'Packaging');
check('1g. unknown → Other', mgmt.normalizeExpenseCategory({ description: 'Sundry something' }) === 'Other');
check('1h. bare string accepted', mgmt.normalizeExpenseCategory('Monthly rent of godown') === 'Rent');
check('1i. vocabulary has 14 fixed categories', mgmt.EXPENSE_CATEGORIES.length === 14, mgmt.EXPENSE_CATEGORIES);

// ── 2. Expense analysis ───────────────────────────────────────
console.log('\n═══ 2. Expense Analysis (current week) ═══');
const ae = mgmt.getExpenseAnalysis(db, { from_date: '2083-07-01', to_date: '2083-07-07', group_by: 'category' });
for (const c of ae.checks) check(`2. ${c.name}`, c.ok, { expected: c.expected, actual: c.actual });
check('2z. all checks pass', ae.all_checks_ok, ae.checks.filter(c => !c.ok));
check('2a. total = 40,000 milk + 10,000 purchases + 29,500 operating = 79,500', near(ae.total, 79500), ae.total);
check('2b. split correct', near(ae.split.milk_procurement, 40000) && near(ae.split.purchases, 10000) && near(ae.split.operating, 29500), ae.split);
const elec = ae.rows.find(r => r.key === 'Electricity');
check('2c. Electricity grouped: 6,000 now vs 4,000 before (+2,000)',
    elec && near(elec.amount, 6000) && near(elec.previous, 4000) && near(elec.change, 2000), elec);
check('2d. Electricity = 6% of sales (6,000 / 100,000)', elec && near(elec.percent_of_sales, 6), elec && elec.percent_of_sales);
check('2e. Sales revenue picked up (100,000)', near(ae.sales, 100000), ae.sales);
const salaryRow = ae.rows.find(r => r.key === 'Salary');
check('2f. Salary present with previous period comparison', salaryRow && near(salaryRow.amount, 20000) && near(salaryRow.previous, 20000), salaryRow);

const byParty = mgmt.getExpenseAnalysis(db, { from_date: '2083-07-01', to_date: '2083-07-07', group_by: 'party', compare: false });
check('2g. group_by=party works and totals still match', byParty.all_checks_ok && near(byParty.total, 79500), byParty.total);
const byDate = mgmt.getExpenseAnalysis(db, { from_date: '2083-07-01', to_date: '2083-07-07', group_by: 'date', compare: false });
check('2h. group_by=date works and totals still match', byDate.all_checks_ok && near(byDate.total, 79500), byDate.rows.length);

// ── 3. Board report ───────────────────────────────────────────
console.log('\n═══ 3. Board Management Report ═══');
const board = mgmt.getBoardReport(db, { from_date: '2083-07-01', to_date: '2083-07-07' });
for (const c of board.checks) check(`3. ${c.name}`, c.ok, { expected: c.expected, actual: c.actual });
check('3z. all board checks pass', board.all_checks_ok, board.checks.filter(c => !c.ok));
check('3a. previous period auto-resolved to 2083-06-24 … 06-30',
    board.previous_period.from_date === '2083-06-24' && board.previous_period.to_date === '2083-06-30', board.previous_period);
check('3b. revenue: total 100,000 · milk 60,000 · product (ghee) 40,000',
    near(board.revenue.total_sales, 100000) && near(board.revenue.milk_sales, 60000) && near(board.revenue.product_sales, 40000),
    board.revenue);
check('3c. other income 2,000 → total income 102,000', near(board.revenue.other_income, 2000) && near(board.revenue.total_income, 102000), board.revenue);
check('3d. COGS = raw milk 40,000 + purchases 10,000 = 50,000',
    near(board.cogs.raw_milk_cost, 40000) && near(board.cogs.production_purchases, 10000) && near(board.cogs.total, 50000), board.cogs);
check('3e. gross profit = 100,000 − 50,000 = 50,000', near(board.gross_profit, 50000), board.gross_profit);
check('3f. op-ex table totals 29,500', near(board.operating_expenses_total, 29500), board.operating_expenses_total);
check('3g. waterfall: 102,000 − 50,000 − 29,500 = 22,500 = P&L net',
    near(board.net.net_profit, 22500) && near(board.net.net_profit, board.pnl.net_profit), board.net);
const bElec = board.operating_expenses.find(r => r.category === 'Electricity');
check('3h. op-ex row has current / previous / change / % of sales',
    bElec && near(bElec.current, 6000) && near(bElec.previous, 4000) && near(bElec.change, 2000) && near(bElec.percent_of_sales, 6), bElec);

// ── 4. Factual indicators only ────────────────────────────────
console.log('\n═══ 4. Expense-control indicators (factual only) ═══');
const texts = board.indicators.map(i => i.text);
check('4a. electricity increase stated with %', texts.some(t => /Electricity expense increased by 50%/.test(t)), texts);
check('4b. milk cost per litre stated (Rs 80/L vs Rs 75/L)', texts.some(t => /Milk procurement cost: Rs 80\/L/.test(t) && /Rs 75\/L/.test(t)), texts);
check('4c. salary as % of sales stated', texts.some(t => /Salary cost represents 20% of sales/.test(t)), texts);
check('4d. milk procurement as % of revenue stated', texts.some(t => /Milk procurement cost represents/.test(t)), texts);
check('4e. sales change stated', texts.some(t => /Sales increased by 25%/.test(t)), texts);
check('4f. outstanding advance movement stated', texts.some(t => /Outstanding advances increased by Rs 30,000/.test(t)), texts);
check('4g. no subjective judgements', !texts.some(t => /\b(good|bad|excellent|poor|great|terrible)\b/i.test(t)), texts);
check('4h. every indicator carries current + previous numbers', board.indicators.every(i => i.current !== undefined && i.previous !== undefined), board.indicators.length);

// ── 5. Weekly / monthly / daily management reports ────────────
console.log('\n═══ 5. Weekly management report ═══');
const wk = mgmt.getManagementReport(db, { period: 'weekly', as_of: '2083-07-07' });
const cw = wk.current, pw = wk.previous;
check('5a. week = 2083-07-01 … 07-07, previous = 06-24 … 06-30',
    cw.from_date === '2083-07-01' && cw.to_date === '2083-07-07' && pw.from_date === '2083-06-24' && pw.to_date === '2083-06-30',
    { c: [cw.from_date, cw.to_date], p: [pw.from_date, pw.to_date] });
check('5b. milk received 500 L · cost 40,000 · avg 80/L',
    near(cw.milk_received_liters, 500) && near(cw.milk_cost, 40000) && near(cw.avg_milk_cost_per_liter, 80), cw);
check('5c. milk sold 500 L · realization 120/L', near(cw.milk_sold_liters, 500) && near(cw.avg_sales_realization_per_liter, 120), { q: cw.milk_sold_liters, r: cw.avg_sales_realization_per_liter });
check('5d. sales 100,000 · COGS 50,000 · gross 50,000 · net 22,500',
    near(cw.total_sales, 100000) && near(cw.cogs, 50000) && near(cw.gross_profit, 50000) && near(cw.net_profit, 22500), cw);
check('5e. previous week: 400 L, sales 80,000, avg cost 75/L',
    near(pw.milk_received_liters, 400) && near(pw.total_sales, 80000) && near(pw.avg_milk_cost_per_liter, 75), pw);
check('5f. comparison deltas present (income +22,000)', wk.compare.total_income && near(wk.compare.total_income.change, 22000), wk.compare.total_income);
check('5g. receivables = both unpaid invoices (180,000)', near(cw.receivables, 180000), cw.receivables);
check('5h. outstanding advances = 30,000', near(cw.advances_outstanding, 30000), cw.advances_outstanding);
check('5i. report checks pass (net & COGS = P&L)', wk.all_checks_ok, wk.checks);

console.log('\n═══ 6. Daily + monthly management reports ═══');
const day = mgmt.getManagementReport(db, { period: 'daily', as_of: '2083-07-03' });
check('6a. daily report = that day (sales 100,000, milk 0)', near(day.current.total_sales, 100000) && near(day.current.milk_received_liters, 0), day.current);
check('6b. previous day carried the 500 L milk', day.previous && near(day.previous.milk_received_liters, 500), day.previous);

const mo = mgmt.getManagementReport(db, { period: 'monthly', as_of: '2083-07-07' });
check('6c. monthly period spans the whole BS month', mo.current.from_date === '2083-07-01' && String(mo.current.to_date).startsWith('2083-07-'), [mo.current.from_date, mo.current.to_date]);
check('6d. monthly current includes every July row (milk 500 L, sales 100,000)',
    near(mo.current.milk_received_liters, 500) && near(mo.current.total_sales, 100000), mo.current);
check('6e. previous month = June (400 L, sales 80,000)',
    mo.previous && near(mo.previous.milk_received_liters, 400) && near(mo.previous.total_sales, 80000), mo.previous);
check('6f. monthly report carries the P&L trend series', mo.trend && Array.isArray(mo.trend.months), mo.trend && Object.keys(mo.trend));
check('6g. monthly checks pass', mo.all_checks_ok, mo.checks);

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Management-Reports tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
