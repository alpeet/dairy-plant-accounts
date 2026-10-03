/**
 * Company Ledger — acceptance tests (spec Phase 7)
 * ================================================
 * The ledger is a READ MODEL over the authoritative numbers. These tests seed
 * one small but complete period (sales, other income, milk, purchases,
 * expenses, salary, petty, vehicle, typed payments, an advance, a loan and a
 * cash→bank transfer) and prove:
 *
 *   - every row sums back into the existing P&L / milk / expense summaries
 *   - balance-sheet movements are visible but NEVER enter P&L totals
 *   - transfers net to zero
 *   - daily / weekly / monthly / custom period grouping works
 *   - the running balance is exactly credit − debit
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-company-ledger.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const { getCompanyLedger } = require(path.join(ROOT, 'shared', 'operations', 'company_ledger.js'));

const DB_PATH = '/tmp/company-ledger-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'company-ledger-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// ── Seed ──────────────────────────────────────────────────────
const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const cust = party('CL Customer', 'customer');
const farmer = party('CL Farmer', 'farmer');
const supplier = party('CL Supplier', 'supplier');

const D1 = '2083-07-05', D2 = '2083-07-06', D3 = '2083-07-12';

const ensureProduct = (name, unit, rate) => {
    let p = db.prepare('SELECT id FROM products WHERE name = ?').get(name);
    if (!p) p = { id: Number(db.prepare('INSERT INTO products (name, unit, rate, category) VALUES (?, ?, ?, ?)').run(name, unit, rate, 'Dairy').lastInsertRowid) };
    return p.id;
};
const milkProd = ensureProduct('Mixed Milk', 'L', 110);
const gheeProd = ensureProduct('Ghee', 'kg', 1500);
const creamProd = ensureProduct('Cream', 'kg', 450);
const cartonProd = ensureProduct('Packing Carton', 'pcs', 5);
const rawCowProd = ensureProduct('Cow Milk', 'L', 60);

// Sales (milk-led invoice + a cream invoice)
const sale = (no, date, total, items) => {
    const id = Number(db.prepare(
        'INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)'
    ).run(no, date, cust, total, total, 'credit', 'unpaid').lastInsertRowid);
    for (const it of items) {
        db.prepare('INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, it.product_id, it.name, it.qty, it.unit, it.rate, it.amount);
    }
    return id;
};
sale('INV-CL-1', D1, 15000, [
    { product_id: milkProd, name: 'Mixed Milk', qty: 100, unit: 'L', rate: 100, amount: 10000 },
    { product_id: gheeProd, name: 'Ghee', qty: 5, unit: 'kg', rate: 1000, amount: 5000 },
]);
sale('INV-CL-2', D3, 8000, [{ product_id: creamProd, name: 'Cream', qty: 20, unit: 'kg', rate: 400, amount: 8000 }]);

// Other income + expense registers
db.prepare("INSERT INTO other_expenses (date, category, expense_head, description, amount) VALUES (?, 'Income', 'Commission', 'Scrap commission', 1200)").run(D1);
db.prepare("INSERT INTO other_expenses (date, category, expense_head, description, amount) VALUES (?, 'Electricity', 'Electricity', 'Boiler bill', 3000)").run(D2);
db.prepare("INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount) VALUES ('PC-CL-1', ?, 'Stationery', 'Office stationary', 500)").run(D2);
db.prepare("INSERT INTO salary_records (employee_name, month, net_salary, payment_date) VALUES ('Ramesh', '2083-03', 15000, ?)").run(D2);
db.prepare("INSERT INTO vehicle_expenses (date, vehicle_name, expense_type, total_amount) VALUES (?, 'Truck-1', 'fuel', 4000)").run(D2);

// Milk: one collection + one unlinked milk line sitting on a purchase bill
milkOps.saveMilkCollection(db, {
    collection_no: 'MC-CL-001', date: D1, party_id: farmer, milk_type: 'cow',
    quantity_liters: 100, fat_percent: 4.2, snf_percent: 8.3, rate: 80, amount: 8000,
    shift: 'morning', status: 'pending'
}, 1);
const purchase = (bill, total, item, itemName, unit) => {
    const id = Number(db.prepare(
        'INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status) VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?)'
    ).run(bill, D2, supplier, total, total, 'credit', 'unpaid').lastInsertRowid);
    db.prepare('INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, item.product_id, itemName, item.qty, unit, item.rate, item.amount != null ? item.amount : item.qty * item.rate);
    return id;
};
purchase('PUR-CL-1', 5000, { product_id: cartonProd, qty: 1000, rate: 5 }, 'Packing Carton', 'pcs');   // non-milk
purchase('PUR-CL-2', 2000, { product_id: rawCowProd, qty: 40, rate: 50 }, 'Cow Milk', 'L');            // unlinked milk line

// Typed payments: real expense + advance + loan received
const pay = (type, tt, amount, mode, date, notes) => db.prepare(
    'INSERT INTO payments (party_id, date, type, transaction_type, amount, mode, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
).run(supplier, date, type, tt, amount, mode, notes).lastInsertRowid;
pay('payment', 'actual_expense', 2500, 'cash', D2, 'Repair bill settled');
pay('payment', 'advance', 50000, 'cash', D2, 'Advance to supplier');
pay('receipt', 'loan_received', 20000, 'bank', D3, 'Sapati received');

// Cash → bank transfer (classified by the bank row classifier)
db.prepare("INSERT INTO bank_transactions (date, reference_no, description, credit, debit) VALUES (?, 'DEP-1', 'Cash deposit', 10000, 0)").run(D2);

// ── 1. Rows reconcile with the authoritative numbers ─────────
console.log('\n═══ 1. Ledger agrees with P&L / milk / expense summaries ═══');
const ledger = getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'daily' });
check('0. ops bundle exposes getCompanyLedger', typeof ops.getCompanyLedger === 'function');
for (const c of ledger.checks) check(`1. ${c.name}`, c.ok, { expected: c.expected, actual: c.actual });
check('1z. every check passes (all_checks_ok)', ledger.all_checks_ok, ledger.checks.filter(c => !c.ok));

const t = ledger.totals;
check('2a. income = 15,000 + 8,000 + 1,200 = 24,200', near(t.income, 24200), t.income);
check('2b. expenses = milk 10,000 + purchases 5,000 + operating 25,000 = 40,000', near(t.expenses, 40000), t.expenses);
check('2c. milk rows = 8,000 collection + 2,000 unlinked line = 10,000', near(t.milk_procurement, 10000), t.milk_procurement);
check('2d. purchase rows exclude every milk line (5,000 only)', near(t.purchases, 5000), t.purchases);
check('2e. operating = 3,000 + 500 + 15,000 + 4,000 + 2,500 = 25,000', near(t.operating_expenses, 25000), t.operating_expenses);
check('2f. net = 24,200 − 40,000 = −15,800 = P&L net profit', near(t.net, -15800) && near(t.net, ledger.pnl.net_profit), { net: t.net, pnl: ledger.pnl.net_profit });

// ── 3. Balance-sheet movements are visible but never P&L ─────
console.log('\n═══ 3. Advances / loans never touch the P&L ═══');
const bsRows = ledger.rows.filter(r => r.category === 'Balance Sheet');
const advRow = bsRows.find(r => r.type === 'Advance paid');
const loanRow = bsRows.find(r => r.type === 'Loan / sapati received');
check('3a. advance row present as Balance Sheet debit 50,000', advRow && near(advRow.debit, 50000) && advRow.credit === 0, advRow);
check('3b. loan received row is a credit of 20,000', loanRow && near(loanRow.credit, 20000) && loanRow.debit === 0, loanRow);
check('3c. advance NOT inside expense totals', !bsRows.some(r => r.category === 'Expense') && near(t.expenses, 40000), t.expenses);
check('3d. BS totals reported separately (50,000 DR / 20,000 CR)', near(t.balance_sheet_debit, 50000) && near(t.balance_sheet_credit, 20000), { d: t.balance_sheet_debit, c: t.balance_sheet_credit });
check('3e. P&L balance_sheet_movements agrees with the advance total',
    near(ledger.pnl.balance_sheet_movements.advances_paid.total, 50000), ledger.pnl.balance_sheet_movements.advances_paid);

// ── 4. Transfers net to zero ─────────────────────────────────
console.log('\n═══ 4. Internal transfers ═══');
const tr = ledger.rows.filter(r => r.category === 'Transfer');
check('4a. cash → bank transfer row shown', tr.length === 1 && near(tr[0].debit, 10000) && near(tr[0].credit, 10000), tr);
check('4b. transfer is outside Income and Expense',
    !ledger.rows.some(r => r.category === 'Transfer' && (r.subcategory === 'Sales' || r.subcategory === 'Other expenses')), null);

// ── 5. Revenue classification ────────────────────────────────
console.log('\n═══ 5. Revenue subtype (factual classification) ═══');
const inv1 = ledger.rows.find(r => r.reference === 'INV-CL-1');
const inv2 = ledger.rows.find(r => r.reference === 'INV-CL-2');
check('5a. milk-led invoice reads Milk sales', inv1 && inv1.type === 'Milk sales', inv1 && inv1.type);
check('5b. cream invoice reads Cream sales', inv2 && inv2.type === 'Cream sales', inv2 && inv2.type);

// ── 6. Granularity ───────────────────────────────────────────
console.log('\n═══ 6. Daily / weekly / monthly / custom grouping ═══');
const daily = getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'daily' });
check('6a. daily → one period per active date (3 dates)', daily.periods.length === 3, daily.periods.map(p => p.key));
check('6b. daily period subtotals add up', near(daily.periods.reduce((s, p) => s + p.income, 0), t.income)
    && near(daily.periods.reduce((s, p) => s + p.expenses, 0), t.expenses), daily.periods.map(p => [p.key, p.income, p.expenses]));

const weekly = getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'weekly' });
check('6c. weekly → 7-day blocks (2 weeks: 05+06, 12)', weekly.periods.length === 2, weekly.periods.map(p => p.label));
check('6d. weekly totals still reconcile', weekly.all_checks_ok && near(weekly.periods.reduce((s, p) => s + p.income, 0), t.income), weekly.periods);

const monthly = getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'monthly' });
check('6e. monthly → single BS month bucket', monthly.periods.length === 1 && monthly.periods[0].key === '2083-07', monthly.periods.map(p => p.key));
check('6f. monthly net matches the daily net', near(monthly.periods[0].net, daily.periods.reduce((s, p) => s + p.net, 0)), monthly.periods[0]);

const custom = getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'custom' });
check('6g. custom → one range period', custom.periods.length === 1 && near(custom.periods[0].income, 24200) && near(custom.periods[0].expenses, 40000), custom.periods[0]);

// ── 7. Running balance ───────────────────────────────────────
console.log('\n═══ 7. Running balance = Σ credit − Σ debit ═══');
const last = ledger.rows[ledger.rows.length - 1];
check('7a. final running balance equals credit_total − debit_total',
    near(last.balance, r2(t.credit_total - t.debit_total)), { balance: last.balance, want: r2(t.credit_total - t.debit_total) });
let walk = 0, walkOk = true;
for (const r of ledger.rows) {
    walk = r2(walk + (r.credit || 0) - (r.debit || 0));
    if (!near(r.balance, walk)) { walkOk = false; break; }
}
check('7b. every row balance is internally consistent', walkOk, null);

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Company-Ledger tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
