/**
 * Phase 26 — Realistic 4-supplier end-to-end reconciliation
 * ==========================================================
 * One continuous scenario, every module must agree with the next:
 *
 *   Supplier A  fixed    buffalo  85/L
 *   Supplier B  fat/SNF  (all)    fat 8.0 + snf 5.0
 *   Supplier C  fixed    cow      72/L
 *   Supplier D  fat/SNF  cow      6.5/4.2
 *
 *   Day 1  4 collections (750 L · Rs 56,798) → payables + raw-milk lots
 *   Day 2  cow  → Mixed Milk batch;  buffalo → Cream batch
 *   Day 3  sell Mixed Milk + Cream   → FIFO lot COGS
 *   then   stock statement, P&L, company ledger, board report,
 *          expense analysis, supplier payment, dashboard — all reconcile.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-phase26-reconcile.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const { adToBS } = require(path.join(ROOT, 'shared', 'excel-import.js'));
const rates = require(path.join(ROOT, 'shared', 'operations', 'rates.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
const salesOps = require(path.join(ROOT, 'shared', 'operations', 'sales.js'));
const farmerOps = require(path.join(ROOT, 'shared', 'operations', 'farmer.js'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing.js'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));

const DB_PATH = '/tmp/phase26-reconcile-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'phase26-reconcile-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

const D1 = '2083-06-20', D2 = '2083-06-21', D3 = '2083-06-22';
costing.setLotCutover(db, '2083-01-01');
// Real user so audit_log FKs succeed (Phase 25: every write lands in the trail).
const USER_ID = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('p26', 'x', 'admin')").run().lastInsertRowid);

// ── Seed ─────────────────────────────────────────────────────
const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const A = party('P26 Supplier A', 'supplier');
const B = party('P26 Supplier B', 'supplier');
const C = party('P26 Supplier C', 'supplier');
const D = party('P26 Supplier D', 'supplier');
const E = party('P26 Supplier E', 'supplier'); // no chart → plant default
const cust = party('P26 Customer', 'customer');

rates.saveRateChart(db, { effective_from: '2082-01-01', rate_type: 'formula', fat_multiplier: 7.15, snf_multiplier: 4.55, extra_per_unit: 0, fixed_rate: 0, notes: 'Plant default' });
rates.saveRateChart(db, { party_id: A, milk_type: 'buffalo', effective_from: '2082-01-01', rate_type: 'fixed', fixed_rate: 85, notes: 'A fixed' });
rates.saveRateChart(db, { party_id: B, effective_from: '2082-01-01', rate_type: 'formula', fat_multiplier: 8, snf_multiplier: 5, extra_per_unit: 0, fixed_rate: 0, notes: 'B formula' });
rates.saveRateChart(db, { party_id: C, milk_type: 'cow', effective_from: '2082-01-01', rate_type: 'fixed', fixed_rate: 72, notes: 'C fixed' });
rates.saveRateChart(db, { party_id: D, milk_type: 'cow', effective_from: '2082-01-01', rate_type: 'formula', fat_multiplier: 6.5, snf_multiplier: 4.2, extra_per_unit: 0, fixed_rate: 0, notes: 'D formula' });

function ensureProduct(name, unit, rate, expiry) {
    let p = db.prepare('SELECT id FROM products WHERE name = ?').get(name);
    if (!p) p = { id: db.prepare('INSERT INTO products (name, unit, rate, expiry_days, category) VALUES (?, ?, ?, ?, ?)').run(name, unit, rate, expiry || 0, '').lastInsertRowid };
    db.prepare('UPDATE products SET rate = ?, expiry_days = ? WHERE id = ?').run(rate, expiry || 0, p.id);
    return p.id;
}
const mixId = ensureProduct('Mixed Milk', 'L', 85, 3);
const creamId = ensureProduct('Cream', 'kg', 550, 7);

let mcSeq = 0;
const seed = data => {
    mcSeq++;
    const res = milkOps.saveMilkCollection(db, { collection_no: `MC-P26-${String(mcSeq).padStart(3, '0')}`, status: 'pending', shift: 'morning', ...data }, USER_ID);
    return db.prepare('SELECT * FROM milk_collections WHERE id = ?').get(res.id || res);
};

// ════════════════════════════════════════════════════════════
console.log('\n═══ 1. Day 1 — four suppliers, four pricing methods ═══');
const cA = seed({ party_id: A, date: D1, milk_type: 'buffalo', quantity_liters: 200, fat_percent: 6, snf_percent: 9 });
const cB = seed({ party_id: B, date: D1, milk_type: 'buffalo', quantity_liters: 150, fat_percent: 6, snf_percent: 9 });
const cC = seed({ party_id: C, date: D1, milk_type: 'cow', quantity_liters: 100, fat_percent: 4.2, snf_percent: 8.3 });
const cD = seed({ party_id: D, date: D1, milk_type: 'cow', quantity_liters: 300, fat_percent: 4.2, snf_percent: 8.3 });

check('1a. A fixed 85 → 17,000', near(cA.rate, 85) && near(cA.amount, 17000), { rate: cA.rate, amount: cA.amount });
check('1b. B formula 93 → 13,950', near(cB.rate, 93) && near(cB.amount, 13950), { rate: cB.rate, amount: cB.amount });
check('1c. C fixed 72 → 7,200', near(cC.rate, 72) && near(cC.amount, 7200), { rate: cC.rate, amount: cC.amount });
check('1d. D formula 62.16 → 18,648', near(cD.rate, 62.16) && near(cD.amount, 18648), { rate: cD.rate, amount: cD.amount });
const day1Total = r2(cA.amount + cB.amount + cC.amount + cD.amount);
check('1e. day-1 collection total 56,798', near(day1Total, 56798), day1Total);

const creditOf = id => db.prepare("SELECT COALESCE(SUM(credit),0) c FROM ledger_entries WHERE reference_type='milk_collection' AND reference_id=?").get(id).c;
check('1f. supplier payable = collection amount for each supplier',
    near(creditOf(cA.id), 17000) && near(creditOf(cB.id), 13950) && near(creditOf(cC.id), 7200) && near(creditOf(cD.id), 18648),
    [creditOf(cA.id), creditOf(cB.id), creditOf(cC.id), creditOf(cD.id)]);

const lotVal = db.prepare("SELECT COALESCE(SUM(quantity*unit_cost),0) v FROM milk_lots WHERE date = ?").get(D1).v;
const lotCnt = db.prepare('SELECT COUNT(*) n FROM milk_lots WHERE date = ?').get(D1).n;
check('1g. raw-milk inventory = 4 cost layers totalling 56,798', lotCnt === 4 && near(lotVal, 56798), { lotCnt, lotVal });

// ════════════════════════════════════════════════════════════
console.log('\n═══ 2. Supplier payable register (farmer outstanding) ═══');
const outstanding0 = farmerOps.getFarmerOutstanding(db);
const outTotal0 = r2(outstanding0.reduce((s, f) => s + Number(f.total_due || 0), 0));
check('2a. payables owed = day-1 collections (56,798)', near(outTotal0, 56798), outTotal0);
check('2b. four suppliers listed with per-party amounts',
    outstanding0.length === 4 && outstanding0.some(f => f.id === A && near(f.total_due, 17000)) && outstanding0.some(f => f.id === D && near(f.total_due, 18648)),
    outstanding0.map(f => [f.id, f.total_due]));

// ════════════════════════════════════════════════════════════
console.log('\n═══ 3. Daily milk procurement report (§6) ═══');
const dmc = dairy.getDailyMilkCost(db, { date: D1 });
check('3a. 750 L · 56,798 · avg 75.73', near(dmc.total_liters, 750) && near(dmc.total_amount, 56798) && near(dmc.avg_rate, 75.73),
    { liters: dmc.total_liters, amount: dmc.total_amount, avg: dmc.avg_rate });
check('3b. 4 suppliers, min 62.16, max 93', dmc.supplier_count === 4 && near(dmc.min_rate, 62.16) && near(dmc.max_rate, 93),
    { n: dmc.supplier_count, min: dmc.min_rate, max: dmc.max_rate });
check('3c. fixed 300 L vs formula 450 L', near(dmc.fixed_liters, 300) && near(dmc.formula_liters, 450), { f: dmc.fixed_liters, fo: dmc.formula_liters });
const milkSummary = accounting.getMilkCostSummary(db, { from_date: D1, to_date: D1 });
check('3d. independent milk-cost module agrees with daily report (56,798)', near(milkSummary.milk_cost, dmc.total_amount), milkSummary.milk_cost);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 4. Production — supplier-specific cost flows through ═══');
const b1 = costing.postProductionBatch(db, {
    date: D2, shift: 'morning', process_type: 'PASTEURIZE', processing_cost: 500,
    inputs: [{ milk_type: 'cow', quantity: 400 }],
    outputs: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 380, unit: 'L' }],
}, USER_ID);
check('4a. cow batch input = FIFO supplier mix (100×72 + 300×62.16 = 25,848)', near(b1.input_cost, 25848), b1.input_cost);
check('4b. batch total = input + processing (26,348)', near(b1.total_cost, 26348), b1.total_cost);
const mixLot = db.prepare('SELECT * FROM stock_lots WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(mixId);
check('4c. Mixed Milk lot 380 L at 69.34/L (round2)', mixLot && near(mixLot.quantity, 380) && near(mixLot.unit_cost, 69.34), mixLot && { q: mixLot.quantity, u: mixLot.unit_cost });

const b2 = costing.postProductionBatch(db, {
    date: D2, shift: 'evening', process_type: 'CREAM_SEPARATION', processing_cost: 400,
    inputs: [{ milk_type: 'buffalo', quantity: 350 }],
    outputs: [{ product_id: creamId, product_name: 'Cream', quantity: 35, unit: 'kg' }],
}, USER_ID);
check('4d. cream batch input = supplier buffalo mix (200×85 + 150×93 = 30,950)', near(b2.input_cost, 30950), b2.input_cost);
const creamLot = db.prepare('SELECT * FROM stock_lots WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(creamId);
check('4e. cream cost non-zero: 35 kg at 895.71/kg', creamLot && near(creamLot.quantity, 35) && near(creamLot.unit_cost, 895.71) && creamLot.unit_cost > 0,
    creamLot && { q: creamLot.quantity, u: creamLot.unit_cost });
check('4f. all day-1 raw-milk lots fully consumed (0 L left)',
    near(db.prepare("SELECT COALESCE(SUM(qty_remaining),0) q FROM milk_lots WHERE date = ?").get(D1).q, 0));

// ════════════════════════════════════════════════════════════
console.log('\n═══ 5. Sales — COGS is the actual lot cost ═══');
const s1 = salesOps.saveSale(db, {
    invoice_no: 'INV-P26-001', date: D3, party_id: cust,
    items: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 200, unit: 'L', rate: 90, amount: 18000 }],
    subtotal: 18000, discount: 0, tax: 0, grand_total: 18000, paid_amount: 18000, payment_mode: 'cash',
}, USER_ID);
const s2 = salesOps.saveSale(db, {
    invoice_no: 'INV-P26-002', date: D3, party_id: cust,
    items: [{ product_id: creamId, product_name: 'Cream', quantity: 10, unit: 'kg', rate: 1200, amount: 12000 }],
    subtotal: 12000, discount: 0, tax: 0, grand_total: 12000, paid_amount: 12000, payment_mode: 'cash',
}, USER_ID);
const sale1 = db.prepare('SELECT * FROM sales WHERE id = ?').get(s1.id || s1);
const sale2 = db.prepare('SELECT * FROM sales WHERE id = ?').get(s2.id || s2);
check('5a. Mixed Milk COGS = 200 × 69.34 = 13,868', near(sale1.lot_cogs, 13868), sale1.lot_cogs);
check('5b. Cream COGS = 10 × 895.71 = 8,957.10', near(sale2.lot_cogs, 8957.10), sale2.lot_cogs);
const soldCost = r2(sale1.lot_cogs + sale2.lot_cogs);
check('5c. total lot COGS 22,825.10', near(soldCost, 22825.10), soldCost);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 6. Stock valuation — statement = lot engine = conservation ═══');
const st = ops.getStockStatement(db);
const stMix = st.items.find(i => i.id === mixId);
const stCream = st.items.find(i => i.id === creamId);
check('6a. Mixed Milk on hand 180 L · lot value 12,481.20', stMix && near(stMix.current_stock, 180) && near(stMix.lot_quantity, 180) && near(stMix.lot_value, 12481.20),
    stMix && { q: stMix.current_stock, lq: stMix.lot_quantity, lv: stMix.lot_value });
check('6b. Cream on hand 25 kg · lot value 22,392.75', stCream && near(stCream.current_stock, 25) && near(stCream.lot_quantity, 25) && near(stCream.lot_value, 22392.75),
    stCream && { q: stCream.current_stock, lq: stCream.lot_quantity, lv: stCream.lot_value });
check('6c. lot valuation available and total 34,873.95', st.lot_valuation_available === true && near(st.total_lot_value, 34873.95), st.total_lot_value);
const invVal = dairy.getInventoryValuation(db);
const invLotTotal = r2(invVal.lines.reduce((s, l) => s + Number(l.value || 0), 0));
check('6d. stock statement reads THE SAME lot engine (single source)', near(invLotTotal, st.total_lot_value), { invLotTotal, st: st.total_lot_value });
// Money conservation: day-1 milk + processing must equal sold cost + stock left (± unit rounding).
const moneyIn = r2(56798 + 500 + 400);
const moneyAccounted = r2(soldCost + st.total_lot_value);
check('6e. conservation: milk+processing 57,698 = sold 22,825.10 + stock 34,873.95 (±2)',
    Math.abs(moneyIn - moneyAccounted) <= 2, { moneyIn, moneyAccounted, diff: r2(moneyAccounted - moneyIn) });

// ════════════════════════════════════════════════════════════
console.log('\n═══ 7. P&L — one authoritative number, two bases ═══');
const pnl = ops.getProfitLoss(db, { from_date: D1, to_date: D3 });
check('7a. sales 30,000', near(pnl.income.total_sales, 30000), pnl.income.total_sales);
check('7b. milk cost counted once = 56,798; purchases 0', near(pnl.expenses.milk_collection.total, 56798) && near(pnl.expenses.purchases.total, 0),
    { milk: pnl.expenses.milk_collection.total, pur: pnl.expenses.purchases.total });
check('7c. purchase-basis COGS = 56,798', near(pnl.cogs, 56798), pnl.cogs);
check('7d. lot-basis COGS = sold lot cost (22,825.10)', pnl.lot_cogs_available === true && near(pnl.lot_cogs, soldCost), pnl.lot_cogs);
check('7e. lot gross profit = 30,000 − 22,825.10 = 7,174.90', near(pnl.gross_profit_lot_basis, 7174.90), pnl.gross_profit_lot_basis);
check('7f. net = income − expenses (both bases agree on net)', near(pnl.net_profit, r2(pnl.income.total_income - pnl.expenses.total_expenses)), pnl.net_profit);
check('7g. milk-cost transparency: 0 unlinked lines, no double count',
    near(pnl.milk_cost_basis.milk_collections, 56798) && near(pnl.milk_cost_basis.unlinked_milk_lines, 0), pnl.milk_cost_basis);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 8. Company ledger proves it agrees with the P&L ═══');
const cl = ops.getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'custom' });
for (const c of cl.checks) check(`8x. ${c.name}`, c.ok, { expected: c.expected, actual: c.actual });
check('8a. all company-ledger checks pass', cl.all_checks_ok === true);
check('8b. sales rows 30,000 = P&L sales', near(cl.totals.sales, 30000), cl.totals.sales);
check('8c. milk rows 56,798 = milk cost', near(cl.totals.milk_procurement, 56798), cl.totals.milk_procurement);
check('8d. net = P&L net', near(cl.totals.net, pnl.net_profit), { ledger: cl.totals.net, pnl: pnl.net_profit });

// ════════════════════════════════════════════════════════════
console.log('\n═══ 9. Board report + expense analysis = same numbers ═══');
const board = ops.getBoardReport(db, { from_date: D1, to_date: D3 });
check('9a. board checks all pass', board.all_checks_ok === true, board.checks);
check('9b. board revenue = P&L income', near(board.revenue.total_income, pnl.income.total_income), { board: board.revenue.total_income, pnl: pnl.income.total_income });
check('9c. board net = P&L net', near(board.net.net_profit, pnl.net_profit), board.net);
const ea = ops.getExpenseAnalysis(db, { from_date: D1, to_date: D3, group_by: 'category' });
check('9d. expense analysis checks pass', ea.all_checks_ok === true, ea.checks);
check('9e. analysis total = P&L total expenses (56,798)', near(ea.total, pnl.expenses.total_expenses), { ea: ea.total, pnl: pnl.expenses.total_expenses });
check('9f. milk procurement row = 56,798 (counted once)', near(ea.split.milk_procurement, 56798), ea.split.milk_procurement);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 10. Paying a supplier is NOT an expense ═══');
farmerOps.bulkPayFarmers(db, { payments: [{ party_id: C, amount: 7200, collection_ids: [cC.id] }], date: D3, mode: 'cash', notes: 'P26 full settlement' }, USER_ID);
const outstanding1 = farmerOps.getFarmerOutstanding(db);
const outTotal1 = r2(outstanding1.reduce((s, f) => s + Number(f.total_due || 0), 0));
check('10a. C settled → payable drops to 49,598', near(outTotal1, 49598), outTotal1);
const pnlAfter = ops.getProfitLoss(db, { from_date: D1, to_date: D3 });
check('10b. payment did NOT touch P&L (milk still 56,798, net unchanged)',
    near(pnlAfter.expenses.milk_collection.total, 56798) && near(pnlAfter.net_profit, pnl.net_profit),
    { milk: pnlAfter.expenses.milk_collection.total, net: pnlAfter.net_profit });
const clAfter = ops.getCompanyLedger(db, { from_date: D1, to_date: D3, granularity: 'custom' });
check('10c. company ledger still fully reconciles after the payment', clAfter.all_checks_ok === true, clAfter.checks.filter(c => !c.ok));
const cBal = db.prepare("SELECT COALESCE(SUM(credit),0)-COALESCE(SUM(debit),0) b FROM ledger_entries WHERE party_id=?").get(C).b;
check('10d. supplier C party balance cleared to 0', near(cBal, 0), cBal);
const payAudit = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE table_name='payments' AND new_values LIKE '%farmer_payout%'").get().n;
check('10e. payout recorded in the audit trail', payAudit >= 1, payAudit);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 11. Dashboard reads the same sources (today) ═══');
let todayBS = null;
try { todayBS = adToBS(new Date().toISOString().split('T')[0]); } catch (e) { todayBS = null; }
if (todayBS) {
    const cT = seed({ party_id: E, date: todayBS, milk_type: 'mixed', quantity_liters: 10, fat_percent: 4.2, snf_percent: 8.3 });
    const pnlToday = ops.getProfitLoss(db, { from_date: todayBS, to_date: todayBS });
    const dash = ops.getDashboard(db);
    check('11a. fallback supplier E priced by plant default (67.80 → 678)', near(cT.rate, 67.8) && near(cT.amount, 678), { rate: cT.rate, amount: cT.amount });
    check('11b. dashboard milk cost = P&L milk cost (single source)',
        near(dash.profitSnapshot.milk_cost, pnlToday.expenses.milk_collection.total) && dash.profitSnapshot.pnl_basis === true,
        { dash: dash.profitSnapshot.milk_cost, pnl: pnlToday.expenses.milk_collection.total });
    check('11c. dashboard revenue = P&L revenue', near(dash.profitSnapshot.revenue, pnlToday.income.total_sales), { dash: dash.profitSnapshot.revenue, pnl: pnlToday.income.total_sales });
    check('11d. monthly milk series populated', Array.isArray(dash.monthlyMilk) && dash.monthlyMilk.length > 0, dash.monthlyMilk);
} else {
    check('11. adToBS unavailable — dashboard checks skipped', false, todayBS);
}

console.log(`\n═══════════════════════════════════════════════`);
console.log(`  Phase-26 reconciliation: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
