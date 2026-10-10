#!/usr/bin/env node
/**
 * DAILY (CHAINED) STOCK STATEMENT — TC-01 … TC-10
 * ===============================================
 * Implements the acceptance test file for the daily running-balance statement:
 *
 *   Closing(N)   = max(0, Opening(N) + Collection + Purchase − Sales)
 *   Shortfall(N) = max(0, −(Opening(N) + Collection + Purchase − Sales))
 *   Opening(N+1) = Closing(N)
 *   opening(first day) = initial stock + Σ(collection + purchase − sales) before the range,
 *                        replayed with the same floor rule
 *
 * A day deducts only what the stock actually has: sales take yesterday's
 * closing first, the excess takes today's purchase — whatever neither covers
 * is reported as a red Shortfall figure instead of a negative closing
 * (operator's rule, 2026-10).
 *
 * NOTE ON DATES: the spec's fixtures are written in AD (2026/10/01 … 2026/10/06).
 * This database stores Bikram Sambat date strings (AGENTS.md: never parse them
 * with Date/strftime — compare and slice strings), so the same six consecutive
 * days are used as BS 2083-06-01 … 2083-06-06. Every other value in the spec is
 * asserted exactly as written.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-daily-stock-statement.js
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

// ── Fixture (spec §2) — six consecutive days, 10/06 has no records at all ──
const D = ['2083-06-01', '2083-06-02', '2083-06-03', '2083-06-04', '2083-06-05', '2083-06-06'];
const INITIAL = 100;
const COLLECTION = [500, 450, 600, 0, 700];
const PURCHASE = [200, 150, 250, 100, 50];
const SALES = [300, 400, 500, 150, 650];

// Spec §3 — the full statement TC-01 must reproduce.
const EXPECT = [
    { open: 100, col: 500, pur: 200, sal: 300, close: 500 },
    { open: 500, col: 450, pur: 150, sal: 400, close: 700 },
    { open: 700, col: 600, pur: 250, sal: 500, close: 1050 },
    { open: 1050, col: 0, pur: 100, sal: 150, close: 1000 },
    { open: 1000, col: 700, pur: 50, sal: 650, close: 1100 },
    { open: 1100, col: 0, pur: 0, sal: 0, close: 1100 }
];

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-ss-'));
const db = initDatabase(dir, 'test.db');

// Opening stock lives on the product (spec Q1: Stock_Master opening stock).
// Insert with plain SQL so NO 'opening' movement is created — the initial
// stock must come from products.opening_stock on its own.
const pid = Number(db.prepare(
    "INSERT INTO products (name, unit, category, rate, opening_stock) VALUES ('Milk', 'liter', 'Milk', 80, ?)"
).run(INITIAL).lastInsertRowid);
ok(near((db.prepare('SELECT opening_stock o FROM products WHERE id = ?').get(pid).o), INITIAL), 'product seeded with opening stock 100');
ok(db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE product_id = ? AND type = 'opening'").get(pid).c === 0,
    'no opening movement (initial stock is the product opening stock)');

const mv = db.prepare(`INSERT INTO stock_movements
    (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, 0, 'test')`);
const collect = (date, qty) => mv.run(pid, date, 'milk_collection', qty, 0);
const purchase = (date, qty) => mv.run(pid, date, 'purchase', qty, 0);
const sell = (date, qty) => mv.run(pid, date, 'sale', 0, qty);
const extraSales = [];
const extraCollect = [];

D.slice(0, 5).forEach((date, i) => {
    if (COLLECTION[i] > 0) collect(date, COLLECTION[i]);
    if (PURCHASE[i] > 0) purchase(date, PURCHASE[i]);
    if (SALES[i] > 0) sell(date, SALES[i]);
});

const stmt = (from, to) => dairy.getDailyStockStatement(db, { from_date: from, to_date: to, product_id: pid });
const rowsOf = (r) => ((r.products[0] || {}).rows || []);

// ── TC-01 — full range from the first day ────────────────────────────────
console.log('\n── TC-01 full range (spec §3) ──');
let r = stmt(D[0], D[5]);
let rows = rowsOf(r);
ok(rows.length === 6, 'one row per day (6)', rows.length);
EXPECT.forEach((e, i) => {
    const row = rows[i];
    if (!row) { ok(false, `row ${D[i]} missing`); return; }
    ok(row.date === D[i] && near(row.opening, e.open) && near(row.collection, e.col)
        && near(row.purchase, e.pur) && near(row.sales, e.sal) && near(row.closing, e.close),
        `${D[i]}: ${e.open} + ${e.col} + ${e.pur} − ${e.sal} = ${e.close}`,
        { date: row.date, open: row.opening, col: row.collection, pur: row.purchase, sal: row.sales, close: row.closing });
});
ok(rows.every(x => x.identity_ok !== false), 'identity holds on every row');
ok(r.identity_ok === true, 'statement-wide identity_ok flag');
// Acceptance: ordering strictly by date ASC.
ok(rows.every((x, i) => i === 0 || rows[i - 1].date < x.date), 'dates strictly ascending');
// Acceptance: Opening(N+1) = Closing(N) for every consecutive pair.
ok(rows.every((x, i) => i === 0 || near(x.opening, rows[i - 1].closing)), 'Opening(N+1) = Closing(N) everywhere');

// ── TC-02 — range starting mid-way: opening walked back from history ─────
console.log('\n── TC-02 mid-range query ──');
r = stmt(D[2], D[4]);
rows = rowsOf(r);
ok(rows.length === 3, '3 rows for a 3-day range', rows.length);
ok(rows[0] && rows[0].date === D[2] && near(rows[0].opening, 700) && near(rows[0].closing, 1050),
    '10/03 opening 700 derived from prior days (not 0)', rows[0] && rows[0].opening);
ok(rows[1] && near(rows[1].opening, 1050) && near(rows[1].closing, 1000), '10/04 chains from 10/03');
ok(rows[2] && near(rows[2].opening, 1000) && near(rows[2].closing, 1100), '10/05 chains from 10/04');

// ── TC-03 — single day query ─────────────────────────────────────────────
console.log('\n── TC-03 single day ──');
rows = rowsOf(stmt(D[3], D[3]));
ok(rows.length === 1 && near(rows[0].opening, 1050) && near(rows[0].collection, 0)
    && near(rows[0].purchase, 100) && near(rows[0].sales, 150) && near(rows[0].closing, 1000),
    'opening 1050, collection 0, purchase 100, sales 150, closing 1000',
    rows[0] && { open: rows[0].opening, pur: rows[0].purchase, close: rows[0].closing });

// ── TC-04 — missing day still produces a row (carry-forward) ─────────────
console.log('\n── TC-04 missing day ──');
rows = rowsOf(stmt(D[5], D[5]));
ok(rows.length === 1, 'the empty day is NOT skipped', rows.length);
ok(rows[0] && near(rows[0].opening, 1100) && near(rows[0].collection, 0)
    && near(rows[0].purchase, 0) && near(rows[0].sales, 0) && near(rows[0].closing, 1100),
    'opening 1100, all flows 0, closing 1100', rows[0] && { open: rows[0].opening, close: rows[0].closing });
ok(rows[0] && rows[0].has_data === false, 'row flagged as having no records');

// ── TC-05 — zero collection with purchase + sales present ────────────────
console.log('\n── TC-05 zero-collection day ──');
rows = rowsOf(stmt(D[3], D[3]));
ok(rows.length === 1 && near(rows[0].collection, 0), 'collection = 0', rows[0] && rows[0].collection);
ok(rows[0] && near(rows[0].closing, 1000), 'closing still computed correctly (1000)', rows[0] && rows[0].closing);

// ── TC-06 — backdated entry re-chains every later day ────────────────────
console.log('\n── TC-06 backdated entry ──');
sell(D[1], 100);   // 10/02 sales: 400 → 500
rows = rowsOf(stmt(D[1], D[5]));
const after = [
    { d: D[1], open: 500, sal: 500, close: 600 },
    { d: D[2], open: 600, sal: 500, close: 950 },
    { d: D[3], open: 950, sal: 150, close: 900 },
    { d: D[4], open: 900, sal: 650, close: 1000 },
    { d: D[5], open: 1000, sal: 0, close: 1000 }
];
after.forEach((e, i) => {
    const row = rows[i];
    ok(row && row.date === e.d && near(row.opening, e.open) && near(row.sales, e.sal) && near(row.closing, e.close),
        `${e.d}: ${e.open} + … − ${e.sal} = ${e.close}`,
        row && { open: row.opening, sal: row.sales, close: row.closing });
});
db.prepare('DELETE FROM stock_movements WHERE product_id = ? AND type = ? AND date = ? AND outward_qty = 100').run(pid, 'sale', D[1]);
ok(near(rowsOf(stmt(D[0], D[5]))[5].closing, 1100), 'recomputed back to the original chain after the entry is removed');

// ── TC-07 — several records on one day are summed first ──────────────────
console.log('\n── TC-07 multiple records per day ──');
collect(D[0], 50);
rows = rowsOf(stmt(D[0], D[1]));
ok(rows.length === 2 && near(rows[0].collection, 550), 'collection on 10/01 = 500 + 50 = 550', rows[0] && rows[0].collection);
ok(rows[0] && near(rows[0].closing, 550), 'closing on 10/01 = 550', rows[0] && rows[0].closing);
ok(rows[1] && near(rows[1].opening, 550), '10/02 opening follows the shift (550)', rows[1] && rows[1].opening);
db.prepare('DELETE FROM stock_movements WHERE product_id = ? AND type = ? AND date = ? AND inward_qty = 50').run(pid, 'milk_collection', D[0]);
ok(near(rowsOf(stmt(D[0], D[5]))[0].closing, 500), 'recomputed back after the extra record is removed');

// ── TC-08 — empty range: rows with carry-forward, nothing else ───────────
console.log('\n── TC-08 empty range ──');
r = stmt('2083-07-01', '2083-07-03');
rows = rowsOf(r);
ok(rows.length === 3, 'a row for each of the three days', rows.length);
ok(rows.every(x => near(x.opening, 1100) && near(x.closing, 1100)
    && near(x.collection, 0) && near(x.purchase, 0) && near(x.sales, 0)),
    'opening = last known closing (1100), flows 0, closing unchanged',
    rows.map(x => [x.opening, x.closing]));

// ── TC-09 — range before any data: opening = initial stock ───────────────
console.log('\n── TC-09 range before any data ──');
rows = rowsOf(stmt('2083-05-01', '2083-05-03'));
ok(rows.length === 3, '3 rows', rows.length);
ok(rows.every(x => near(x.opening, INITIAL) && near(x.closing, INITIAL)),
    'opening = closing = initial stock 100 on every day', rows.map(x => [x.opening, x.closing]));

// ── TC-10 — over-sales: closing capped at zero, shortfall reported ───────
console.log('\n── TC-10 over-sales: cap closing at 0 + report shortfall ──');
sell(D[4], 2000);   // way beyond available stock
r = stmt(D[0], D[5]);
rows = rowsOf(r);
ok(r.shortfall_days > 0 && r.shortfall_total > 0, 'statement reports shortfall days + total',
    { days: r.shortfall_days, total: r.shortfall_total });
ok(rows[4].is_shortfall === true && near(rows[4].closing, 0) && rows[4].closing >= 0,
    '10/05 closes at 0 (never negative) and is flagged as a shortfall day',
    { close: rows[4].closing, flag: rows[4].is_shortfall });
ok(near(rows[4].shortfall, 900), '10/05 shortfall = the 900 the stock could not cover', rows[4].shortfall);
ok(rows[4].identity_ok !== false
    && near(rows[4].opening + rows[4].collection + rows[4].purchase - rows[4].sales + rows[4].shortfall, rows[4].closing),
    '10/05 identity: opening + in − out + shortfall = closing',
    { open: rows[4].opening, in: rows[4].collection + rows[4].purchase, out: rows[4].sales, short: rows[4].shortfall, close: rows[4].closing });
ok(rows[5].is_shortfall === false && near(rows[5].opening, 0) && near(rows[5].closing, 0),
    '10/06 carries the zero forward (no negative opening anywhere)',
    rows[5] && { open: rows[5].opening, close: rows[5].closing });
ok(rows[0].is_shortfall === false, 'earlier days are not flagged');
ok(rows.every(x => x.closing >= 0), 'no closing anywhere in the statement is negative',
    rows.map(x => x.closing));

// ── TC-11 — the operator's cover rule ────────────────────────────────────
// Sales deduct from yesterday's closing first; the excess deducts from
// today's purchase; anything still uncovered becomes the day's shortfall —
// and a later range opens at the floored chain, never at a negative.
console.log('\n── TC-11 sales deduct from yesterday\'s closing, excess from today\'s purchase ──');
db.prepare('DELETE FROM stock_movements WHERE product_id = ? AND type = ? AND date = ? AND outward_qty = 2000').run(pid, 'sale', D[4]);
ok(near(rowsOf(stmt(D[0], D[5]))[5].closing, 1100), 'chain restored to 1100 after removing the over-sale');

// A. sales exceed yesterday's closing by 100 → today's purchase (200) covers it.
purchase(D[5], 200);
sell(D[5], 1200);
rows = rowsOf(stmt(D[5], D[5]));
ok(rows.length === 1 && near(rows[0].opening, 1100) && near(rows[0].sales, 1200)
    && near(rows[0].purchase, 200) && near(rows[0].closing, 100) && near(rows[0].shortfall, 0)
    && rows[0].is_shortfall === false,
    '1100 − 1200 + 200 = 100: the 100 beyond yesterday\'s closing comes out of today\'s purchase, no shortfall',
    rows[0] && { open: rows[0].opening, sal: rows[0].sales, pur: rows[0].purchase, close: rows[0].closing, short: rows[0].shortfall });

// B. purchase cannot cover the excess → the uncovered part is the shortfall.
db.prepare('DELETE FROM stock_movements WHERE product_id = ? AND type = ? AND date = ? AND outward_qty = 1200').run(pid, 'sale', D[5]);
sell(D[5], 1500);
rows = rowsOf(stmt(D[5], D[5]));
ok(rows.length === 1 && near(rows[0].opening, 1100) && near(rows[0].closing, 0)
    && near(rows[0].shortfall, 200) && rows[0].is_shortfall === true,
    '1100 − 1500 + 200 < 0 → closing 0, shortfall 200 (the part neither stock nor purchase covered)',
    rows[0] && { close: rows[0].closing, short: rows[0].shortfall });

// C. a later range opens at the floored chain — never at a negative balance.
// (A product with no movement at all in the range is hidden by the
// presentation filter, so give the range one entry to observe the opening.)
collect('2083-07-02', 50);
rows = rowsOf(stmt('2083-07-01', '2083-07-03'));
ok(rows.length === 3 && near(rows[0].opening, 0) && rows[0].opening >= 0
    && near(rows[1].opening, 0) && near(rows[1].collection, 50) && near(rows[1].closing, 50),
    'a range after the short day opens at 0 (floored chain), not at −200',
    rows.map(x => [x.date, x.opening, x.closing]));

db.close();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) {
    console.log('❌ DAILY STOCK STATEMENT — TC-01…TC-11 not fully satisfied');
    process.exit(1);
}
console.log('✅ DAILY STOCK STATEMENT — TC-01…TC-11 all passed');
