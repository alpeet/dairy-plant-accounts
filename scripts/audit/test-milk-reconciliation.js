#!/usr/bin/env node
/**
 * MONTH-END MILK RECONCILIATION — MR-01 … MR-12
 * ============================================
 * One month, one summary for the combined milk stock (Buffalo + Cow + Mix as
 * ONE stock):
 *
 *   available   = opening (yesterday's closing) + collected + produced + Other IN
 *   out         = sold + used in production/mixing + wasted + Other OUT
 *   unexplained = closing stock − (available − out)
 *
 * `unexplained` is the volume that left stock with NO collection or production
 * behind it, and it must equal the daily chain's own floor absorption
 * (`shortfall`) — the reconciliation can never disagree with the Stock
 * Statement.  A month whose books cover every litre reconciles to zero.
 *
 * The fixtures use BS dates (this database never stores AD): BS months run
 * 29–32 days, so the month length is asserted through the engine's own calendar
 * walk, never hardcoded.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-milk-reconciliation.js
 * Exit: 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const near = (a, b, tol = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'milk-recon-'));
const prod = (db, name, unit, category, opening) => Number(db.prepare(
    "INSERT INTO products (name, unit, category, rate, opening_stock) VALUES (?, ?, ?, 60, ?)"
).run(name, unit, category, opening || 0).lastInsertRowid);
const mv = (db, pid, date, type, inQty, outQty, refType) => db.prepare(
    `INSERT INTO stock_movements (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
     VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 0, 'test')`
).run(pid, date, type, refType === undefined ? null : refType, inQty, outQty);

// ══════════════════════════════════════════════════════════════
// DB 1 — the month in the operator's example: 710.60 − 484 + 710.60 = 937.20
// ══════════════════════════════════════════════════════════════
const db1 = initDatabase(tmp(), 'test.db');
const pBuf = prod(db1, 'Buffalo Milk', 'liter', 'Milk', 400);
const pCow = prod(db1, 'Cow Milk', 'liter', 'Milk', 200);
const pMix = prod(db1, 'Mixed Milk', 'liter', 'Milk', 110.60);
const pGhee = prod(db1, 'Ghee', 'kg', 'Dairy', 50);   // NOT milk — must never appear

const M1 = '2083-06';            // Ashoj
const M2 = '2083-07';            // Kartik
const d = (m, day) => `${m}-${String(day).padStart(2, '0')}`;

// Month 1 — combined opening 710.60, sold 484 (across all three types),
// collected/purchased 710.60 (across two types) ⇒ closing 937.20.
mv(db1, pCow, d(M1, 2), 'sale', 0, 100);
mv(db1, pBuf, d(M1, 2), 'sale', 0, 150);
mv(db1, pMix, d(M1, 3), 'sale', 0, 234);
mv(db1, pCow, d(M1, 3), 'purchase', 116.60, 0);
mv(db1, pBuf, d(M1, 4), 'milk_collection', 594, 0);
// Decoys: a non-milk product and a milk movement in ANOTHER month.
mv(db1, pGhee, d(M1, 5), 'sale', 0, 30);
mv(db1, pBuf, d(M2, 3), 'sale', 0, 1000);

console.log('\n── MR-01 month of the operator\'s example (combined milk) ──');
let r = dairy.getMilkMonthReconciliation(db1, { month: M1 });
ok(r.month === M1 && r.from_date === `${M1}-01` && String(r.to_date).slice(0, 7) === M1,
    'month resolved to its own BS date bounds', { from: r.from_date, to: r.to_date });
ok(near(r.opening, 710.60), 'opening = yesterday\'s TOTAL closing (all three types)', r.opening);
ok(near(r.sold, 484) && near(r.collected, 710.60),
    'sold 484.00 combined (Cow+Buffalo+Mix) and collected 710.60 combined', { sold: r.sold, collected: r.collected });
ok(near(r.closing, 937.20), 'closing = 710.60 − 484.00 + 710.60 = 937.20', r.closing);
ok(near(r.unexplained, 0) && r.balanced === true, 'no unexplained volume — the month reconciles', r.unexplained);
ok(r.identity_ok === true, 'identity_ok: the flag equals the daily chain\'s own absorption');
ok(near(r.available - r.out_total, r.closing), 'available − out = closing', { a: r.available, o: r.out_total, c: r.closing });

console.log('\n── MR-02 one combined stock, never per-type balances ──');
// Scope = every milk product in the books: the three types above plus any
// seeded twin (initDatabase seeds a spare "Mixed Milk" with no movements).
ok(r.milk_products.every(p => /milk/i.test(p.product_name))
    && ['Buffalo Milk', 'Cow Milk', 'Mixed Milk'].every(n => r.milk_products.some(p => p.product_name === n)),
    'the reconciliation\'s scope is exactly the milk products', r.milk_products);
ok(!('members' in r) && r.rows === undefined, 'no per-type rows/balances in the summary');
ok(near(r.closing, 937.20) && near(r.sold, 484),
    'one closing and one sales figure for the combined stock (no per-type split)', { closing: r.closing, sold: r.sold });
ok(!JSON.stringify(r).includes('Ghee'), 'a non-milk product never enters the milk reconciliation');

console.log('\n── MR-03 production, mixing, wastage and Other IN/OUT are all accounted ──');
ok(r.used === 0 && r.wastage === 0 && r.produced === 0 && r.other_in === 0 && r.other_out === 0,
    'a plain month reports zero production/wastage/other — no invented movements',
    { used: r.used, wastage: r.wastage, produced: r.produced, other_in: r.other_in, other_out: r.other_out });

console.log('\n── MR-04 a month that cannot be covered flags the unexplained volume ──');
const r2 = dairy.getMilkMonthReconciliation(db1, { month: M2 });
ok(near(r2.opening, 937.20), 'next month opens from the previous month\'s closing (re-chained)', r2.opening);
ok(near(r2.sold, 1000) && near(r2.collected, 0), 'month 2 sold 1,000 L with nothing collected', { sold: r2.sold, collected: r2.collected });
ok(near(r2.closing_movements, -62.80), 'the movements imply a closing of −62.80 L (stock cannot go below zero)', r2.closing_movements);
ok(near(r2.closing, 0) && near(r2.unexplained, 62.80) && r2.balanced === false,
    '62.80 L left stock with no collection/production behind it — FLAGGED', { closing: r2.closing, unexplained: r2.unexplained });
ok(r2.shortfall_days.length === 1 && r2.shortfall_days[0].date === d(M2, 3) && near(r2.shortfall_days[0].litres, 62.80),
    'the flag names the day it happened', r2.shortfall_days);

console.log('\n── MR-05 the flag is the daily chain\'s own figure (one stock calculation) ──');
const chain = (m, month) => {
    const days = dairy.bsMonthDays(month);
    const daily = dairy.getDailyStockStatement(db1, { from_date: days[0], to_date: days[days.length - 1], product_id: dairy.MILK_TOTAL_ID });
    return (daily.products || [])[0] || {};
};
const c1 = chain(db1, M1), c2 = chain(db1, M2);
ok(near(c1.rows[0].opening, r.opening) && near(c1.rows[c1.rows.length - 1].closing, r.closing),
    'month 1 opening/closing equal the statement chain', { o: c1.rows[0].opening, cl: c1.rows[c1.rows.length - 1].closing });
ok(near(c2.shortfall, r2.unexplained), 'the unexplained volume equals the chain\'s shortfall, month 2',
    { chainShortfall: c2.shortfall, recon: r2.unexplained });

console.log('\n── MR-06 historical correctness: a backdated entry re-chains later months ──');
mv(db1, pCow, d(M1, 5), 'sale', 0, 37.20);        // late entry, dated in month 1
const r1b = dairy.getMilkMonthReconciliation(db1, { month: M1 });
const r2b = dairy.getMilkMonthReconciliation(db1, { month: M2 });
ok(near(r1b.closing, 900) && near(r1b.unexplained, 0),
    'month 1 closing drops to 900.00 and still reconciles', r1b.closing);
ok(near(r2b.opening, 900) && near(r2b.unexplained, 100),
    'month 2 re-opens at 900.00 and its unexplained volume becomes 100.00', { opening: r2b.opening, unex: r2b.unexplained });

console.log('\n── MR-07 month picker: the months the milk ledger actually moves in ──');
ok(r.months.includes(M1) && r.months.includes(M2), 'both months are offered', r.months);
ok(r.months.every(x => /^\d{4}-\d{2}$/.test(x)) && r.months[0] >= r.months[r.months.length - 1],
    'months are BS "YYYY-MM" strings, newest first', r.months);
const rDefault = dairy.getMilkMonthReconciliation(db1, {});
ok(rDefault.month === M2, 'no month asked → the newest month with milk movements', rDefault.month);

console.log('\n── MR-08 BS month lengths come off the calendar (29–32 days) ──');
const days1 = dairy.bsMonthDays(M1);
ok(days1.length >= 29 && days1.length <= 32, `${M1} has a real BS month length (${days1.length})`, days1.length);
ok(R0(days1), 'the month is one unbroken run of days', days1.slice(0, 3));
function R0(days) {
    return days.every((x, i) => i === 0 || dairy.bsAddDays(days[i - 1], 1) === x);
}
ok(r.days === days1.length && r.to_date === days1[days1.length - 1],
    'the summary covers exactly that month', { days: r.days, to: r.to_date });
const M0 = '2083-05';
const r0 = dairy.getMilkMonthReconciliation(db1, { month: M0 });
ok(r0.days === dairy.bsMonthDays(M0).length && near(r0.collected, 0) && near(r0.sold, 0),
    'an earlier month with no movements reports nothing collected/sold and reconciles', { days: r0.days, c: r0.collected, s: r0.sold });
ok(near(r0.unexplained, 0) && r0.balanced === true, 'an empty month is balanced', r0.unexplained);

console.log('\n── MR-13 the summary also reaches the Excel workbook ──');
const { buildStockStatementWorkbook } = require(path.join(ROOT, 'shared', 'export-stock-statement'));
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const built = buildStockStatementWorkbook(db1, { from_date: `${M1}-01`, to_date: dairy.bsMonthDays(M2).slice(-1)[0], month: M2 });
ok(built.workbook.SheetNames.includes('Milk_Reconciliation'),
    'the workbook carries a Milk_Reconciliation sheet', built.workbook.SheetNames);
const rws = XLSX.utils.sheet_to_json(built.workbook.Sheets['Milk_Reconciliation'], { header: 1 });
const cell = (label) => {
    const line = rws.find(x => x[0] === label);
    return line ? Number(line[1]) : null;
};
ok(near(cell("Opening stock — yesterday's closing carried in"), r2b.opening)
    && near(cell('(+) Collected — milk collections + milk purchases'), r2b.collected)
    && near(cell('(−) Sold'), r2b.sold)
    && near(cell('= Closing stock (book)'), r2b.closing)
    && near(cell('Unexplained volume — no collection or production behind it'), r2b.unexplained),
    'the sheet repeats the engine figures line for line',
    { opening: cell("Opening stock — yesterday's closing carried in"), sold: cell('(−) Sold'), unex: cell('Unexplained volume — no collection or production behind it') });
ok(built.milkReconciliation.balanced === false
    && near(built.milkReconciliation.unexplained, r2b.unexplained)
    && built.mismatches.length === 0,
    'the export reports the same flag and still reconciles (no mismatches)', built.milkReconciliation);
ok(rws.some(x => String(x[0] || '').startsWith('FLAG:')),
    'the flag is written into the sheet', rws.filter(x => String(x[0] || '').startsWith('FLAG')));
db1.close();

// ══════════════════════════════════════════════════════════════
// DB 2 — production / mixing / wastage / adjustments in the identity
// ══════════════════════════════════════════════════════════════
const db2 = initDatabase(tmp(), 'test.db');
const pRaw = prod(db2, 'Raw Milk', 'liter', 'Milk', 0);
prod(db2, 'Buffalo Milk', 'liter', 'Milk', 0);          // second type ⇒ combined entry
const M3 = '2083-08';
mv(db2, pRaw, d(M3, 1), 'milk_collection', 1000, 0);
mv(db2, pRaw, d(M3, 2), 'production_output', 100, 0);         // produced
mv(db2, pRaw, d(M3, 3), 'production_input', 0, 40);           // used in mixing
mv(db2, pRaw, d(M3, 4), 'adjustment', 0, 10, 'wastage');      // wasted
mv(db2, pRaw, d(M3, 5), 'adjustment', 5, 0);                  // other IN
mv(db2, pRaw, d(M3, 6), 'adjustment', 0, 7);                  // other OUT
mv(db2, pRaw, d(M3, 7), 'sale', 0, 600);                      // sold

console.log('\n── MR-09 every in/out bucket is inside the identity ──');
const r3 = dairy.getMilkMonthReconciliation(db2, { month: M3 });
ok(near(r3.opening, 0) && near(r3.collected, 1000), 'opening 0, collected 1,000 L', { o: r3.opening, c: r3.collected });
ok(near(r3.produced, 100) && near(r3.used, 40) && near(r3.wastage, 10),
    'produced 100, used 40, wasted 10', { p: r3.produced, u: r3.used, w: r3.wastage });
ok(near(r3.other_in, 5) && near(r3.other_out, 7), 'Other IN 5, Other OUT 7', { i: r3.other_in, o: r3.other_out });
ok(near(r3.sold, 600), 'sold 600', r3.sold);
ok(near(r3.available, 1105), 'available = 0 + 1,000 + 100 + 5 = 1,105', r3.available);
ok(near(r3.out_total, 657), 'out = 600 + 40 + 10 + 7 = 657', r3.out_total);
ok(near(r3.closing_movements, 448) && near(r3.closing, 448),
    'closing = 1,105 − 657 = 448 L (movements and books agree)', { m: r3.closing_movements, c: r3.closing });
ok(near(r3.unexplained, 0) && r3.balanced === true,
    'no unexplained volume once production/mixing/wastage are counted', r3.unexplained);
ok(near(r3.unexplained, dairy.getMilkMonthReconciliation(db2, { month: M3 }).shortfall_days.reduce((s, x) => s + x.litres, 0)),
    'flag equals the sum of the flagged days', r3.shortfall_days);

console.log('\n── MR-10 a deficit month flags only the uncovered litres ──');
mv(db2, pRaw, d(M3, 8), 'sale', 0, 500);                      // 500 more sold, only 448 in stock
const r4 = dairy.getMilkMonthReconciliation(db2, { month: M3 });
ok(near(r4.closing_movements, -52) && near(r4.closing, 0) && near(r4.unexplained, 52),
    'selling 52 L more than the stock holds flags exactly 52 L', { cm: r4.closing_movements, c: r4.closing, u: r4.unexplained });
ok(r4.shortfall_days.length === 1 && r4.shortfall_days[0].date === d(M3, 8),
    'the flagged day is the day the stock ran out', r4.shortfall_days);
// Production of a NON-milk product must not enter the milk reconciliation.
const pCurd = prod(db2, 'Curd', 'kg', 'Dairy', 0);
mv(db2, pCurd, d(M3, 9), 'production_output', 500, 0);
const r5 = dairy.getMilkMonthReconciliation(db2, { month: M3 });
ok(near(r5.produced, 100) && near(r5.unexplained, 52),
    'a non-milk production entry is invisible here (milk produced stays 100)', { produced: r5.produced, unex: r5.unexplained });
db2.close();

// ══════════════════════════════════════════════════════════════
// DB 3 — a single milk product (no grouping) and no milk at all
// ══════════════════════════════════════════════════════════════
const db3 = initDatabase(tmp(), 'test.db');
const pOnly = prod(db3, 'Raw Milk (Cow)', 'liter', 'Milk', 200);
const M4 = '2083-06';
mv(db3, pOnly, d(M4, 1), 'milk_collection', 300, 0);
mv(db3, pOnly, d(M4, 2), 'sale', 0, 150);

console.log('\n── MR-11 one milk product still reconciles on its own ──');
const r6 = dairy.getMilkMonthReconciliation(db3, { month: M4 });
ok(near(r6.opening, 200) && near(r6.collected, 300) && near(r6.sold, 150) && near(r6.closing, 350),
    '200 + 300 − 150 = 350 L', { o: r6.opening, c: r6.collected, s: r6.sold, cl: r6.closing });
ok(near(r6.unexplained, 0) && r6.balanced === true, 'reconciles to the paisa', r6.unexplained);
db3.close();

// A fresh book: milk products exist (seeded) but no milk movement has ever
// been posted — the reconciliation must still answer, not throw.
const db4 = initDatabase(tmp(), 'test.db');

console.log('\n── MR-12 a book with no milk movements at all ──');
const r7 = dairy.getMilkMonthReconciliation(db4, {});
ok(r7.milk_products.length > 0 && r7.milk_products.every(p => /milk/i.test(p.product_name)),
    'only the (seeded) milk products are in scope', r7.milk_products.map(p => p.product_name));
ok(near(r7.opening, 0) && near(r7.closing, 0) && near(r7.unexplained, 0) && r7.balanced === true,
    'a zeroed, balanced summary instead of an error', { o: r7.opening, c: r7.closing, u: r7.unexplained });
ok(Array.isArray(r7.months) && r7.months.length <= 1, 'months fall back to the current BS month', r7.months);
ok(typeof r7.month_label === 'string' && r7.month_label.length > 0, 'the month still carries a label', r7.month_label);
db4.close();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
