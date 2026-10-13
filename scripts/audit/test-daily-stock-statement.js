#!/usr/bin/env node
/**
 * DAILY (CHAINED) STOCK STATEMENT — TC-01 … TC-14
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
 * TC-15 covers the OPERATOR'S REPORT RULE on top of that detailed chain — the
 * five figures the Stock Statement's Day by Day report shows:
 *
 *   Yesterday's Closing − Today's Total Sales + Today's Total Purchase
 *                      = Today's Closing
 *
 * with all three milk types combined into ONE stock and no production,
 * consumption or wastage term at all.
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
const round2ui15 = (n) => Math.round((Number(n) || 0) * 100) / 100;

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

// ── TC-12 — the combined milk total (Buffalo + Cow + Mix = ONE stock) ────
// Operator's rule: deduct today's TOTAL sales from yesterday's TOTAL closing,
// then add today's TOTAL collection — one row per day, in total only. A type
// selling beyond its own stock is covered by the other types' surplus, so the
// phantom per-type shortfalls disappear while a genuine whole-stock deficit
// still shows on the total.
console.log('\n── TC-12 milk chains as ONE total (sales from yesterday\'s TOTAL closing, then today\'s TOTAL collection) ──');
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-milk-'));
const db2 = initDatabase(dir2, 'test.db');
const mkMilk = (name) => Number(db2.prepare(
    "INSERT INTO products (name, unit, category, rate) VALUES (?, 'liter', 'Milk', 80)"
).run(name).lastInsertRowid);
const pBuf = mkMilk('Buffalo Milk');
const pCow = mkMilk('Cow Milk');
const pMix = mkMilk('Mix Milk');
const pCream = Number(db2.prepare(
    "INSERT INTO products (name, unit, category, rate) VALUES ('Cream', 'kg', 'Dairy', 300)"
).run().lastInsertRowid);
const mv2 = db2.prepare(`INSERT INTO stock_movements
    (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, 0, 'tc12')`);

// One day BEFORE the range: Cow collects 100 L while Mix sells 500 L. Per type
// that floors the Mix deficit away — Cow would carry 100 L forward — but as ONE
// stock the plant sold what it had, so the range must open at 0 (TC-13).
const D_PRE = '2083-05-31';
mv2.run(pCow, D_PRE, 'milk_collection', 100, 0);
mv2.run(pMix, D_PRE, 'sale', 0, 500);

// Day 1: only Buffalo collects (100 L) but MIX sells 60 L and Buffalo 50 L —
// a type selling beyond its own stock. Day 2: Cow collects 70 L, Mix sells 40.
mv2.run(pBuf, D[0], 'milk_collection', 100, 0);
mv2.run(pMix, D[0], 'sale', 0, 60);
mv2.run(pBuf, D[0], 'sale', 0, 50);
mv2.run(pCow, D[1], 'milk_collection', 70, 0);
mv2.run(pMix, D[1], 'sale', 0, 40);
// Cream (non-milk) keeps its own chain untouched by the milk grouping.
mv2.run(pCream, D[0], 'purchase', 10, 0);
mv2.run(pCream, D[0], 'sale', 0, 2);

const stmtAll = (from, to) => dairy.getDailyStockStatement(db2, { from_date: from, to_date: to });
const r12 = stmtAll(D[0], D[2]);
const milk = (r12.products || []).find(p => p.product_id === dairy.MILK_TOTAL_ID);
ok(!!milk, 'milk appears as ONE combined entry (product_id -1)', (r12.products || []).map(p => p.product_name));
ok(milk && milk.product_name === 'Milk Total (Buffalo+Cow+Mix)',
    'the total is named after its members', milk && milk.product_name);
ok(milk && (milk.members || []).length >= 3,
    'the total still reports each type\'s own chain (for valuation)',
    milk && (milk.members || []).map(m => m.product_name));
ok(!(r12.products || []).some(p => [pBuf, pCow, pMix].includes(p.product_id)),
    'no separate per-type milk rows anywhere in the statement');
ok((r12.products || []).some(p => p.product_id === pCream),
    'non-milk products (Cream) keep their own rows');

if (milk) {
    const mrows = milk.rows || [];
    // D0: 0 opening + 100 total collection − 110 total sales → shortfall 10.
    // Per type this would have been a phantom 60 L on Mix alone.
    ok(mrows.length === 3 && near(mrows[0].opening, 0) && near(mrows[0].collection, 100)
        && near(mrows[0].sales, 110) && near(mrows[0].closing, 0) && near(mrows[0].shortfall, 10)
        && mrows[0].is_shortfall === true,
        'day 1: 0 + 100 total collection − 110 total sales → closing 0, shortfall 10 (computed on the TOTAL)',
        mrows[0] && { open: mrows[0].opening, coll: mrows[0].collection, sal: mrows[0].sales, close: mrows[0].closing, short: mrows[0].shortfall });
    // D1: yesterday's TOTAL closing (0) + 70 collected − 40 sold = 30.
    ok(near(mrows[1].opening, 0) && near(mrows[1].collection, 70) && near(mrows[1].sales, 40)
        && near(mrows[1].closing, 30) && near(mrows[1].shortfall, 0) && mrows[1].is_shortfall === false,
        'day 2: yesterday\'s TOTAL closing 0 + 70 − 40 = 30, no shortfall',
        mrows[1] && { open: mrows[1].opening, coll: mrows[1].collection, sal: mrows[1].sales, close: mrows[1].closing });
    // D2: no records — the total's closing carries forward.
    ok(near(mrows[2].opening, 30) && mrows[2].has_data === false && near(mrows[2].closing, 30),
        'day 3: no records — the total\'s closing carries forward (30), opening never negative',
        mrows[2] && { open: mrows[2].opening, close: mrows[2].closing, has: mrows[2].has_data });
    ok(mrows.every(x => x.closing >= 0 && x.identity_ok !== false),
        'identity holds and no closing on the combined chain is negative');
    const bufM = (milk.members || []).find(m => m.product_id === pBuf);
    const cowM = (milk.members || []).find(m => m.product_id === pCow);
    const mixM = (milk.members || []).find(m => m.product_id === pMix);
    ok(!!bufM && !!cowM && !!mixM
        && near(bufM.last_closing, 50) && near(cowM.last_closing, 170) && near(mixM.last_closing, 0),
        'members keep their own floored chains (Buffalo 50, Cow 170 incl. its 100 L before the range, Mix 0) — only the TOTAL is presented',
        milk.members && milk.members.map(m => [m.product_name, m.last_closing]));
}
ok(r12.shortfall_days === 1 && near(r12.shortfall_total, 10),
    'the statement counts ONE shortfall day / 10 L — on the total, never per type',
    { days: r12.shortfall_days, total: r12.shortfall_total });
ok(r12.identity_ok === true, 'statement-wide identity_ok across the combined chain');

// The daily view's product dropdown drills by id — the sentinel selects the
// total, a real id still gets that type's own chain.
const r12b = dairy.getDailyStockStatement(db2, { from_date: D[0], to_date: D[2], product_id: dairy.MILK_TOTAL_ID });
ok(r12b.products.length === 1 && r12b.products[0].product_id === dairy.MILK_TOTAL_ID,
    'product_id = -1 selects exactly the combined milk total', r12b.products.map(p => p.product_name));
const r12c = dairy.getDailyStockStatement(db2, { from_date: D[0], to_date: D[2], product_id: pBuf });
ok(r12c.products.length === 1 && r12c.products[0].product_id === pBuf,
    'a single milk product still gets its own chain (per-type drill-down)',
    r12c.products.map(p => p.product_name));

// ── TC-13 — the opening really is yesterday's TOTAL closing ──────────────
// The day before the range sold 500 L against 100 L collected. Each type's own
// chain floors its deficit away (Cow would carry 100 L), but the total — the
// stock the statement actually presents — closed at 0 that day, so the range
// must OPEN at 0. A per-type sum would wrongly report 100 L of opening milk.
console.log('\n── TC-13 opening = yesterday\'s TOTAL closing (one combined replay) ──');
const r13 = stmtAll(D[0], D[2]);
const m13 = (r13.products || []).find(p => p.product_id === dairy.MILK_TOTAL_ID);
const memberSum = [pBuf, pCow, pMix].reduce((s, id) => s + dairy.stockOpeningBefore(db2, id, D[0]), 0);
ok(!!m13 && near(m13.rows[0].opening, 0),
    'the range opens at 0 — the day before it, the plant sold more milk than it had',
    m13 && m13.rows[0].opening);
ok(memberSum > 0 && !near(memberSum, m13.rows[0].opening),
    `a sum of per-type chains would have opened at ${Math.round(memberSum * 100) / 100} L instead`,
    { per_type_sum: memberSum, used: m13 && m13.rows[0].opening });
ok(near(dairy.groupOpeningBefore(db2, [pBuf, pCow, pMix], D[0]), 0),
    'groupOpeningBefore reproduces the combined replay (same floor rule as the visible days)',
    dairy.groupOpeningBefore(db2, [pBuf, pCow, pMix], D[0]));
ok(near(dairy.groupOpeningBefore(db2, [pCow], D[0]), 100),
    'the same replay for Cow alone still shows its own 100 L (per-type chain is untouched)',
    dairy.groupOpeningBefore(db2, [pCow], D[0]));

// ── TC-14 — Today's Stock reads the SAME report figures the statement shows ──
// The panel is fed by getStockLedger(group_milk): the report chain's opening and
// closing must equal the daily report's own numbers, or the two screens disagree.
console.log('\n── TC-14 Today\'s Stock panel figures = the report\'s own chain ──');
const ledMilk = (dairy.getStockLedger(db2, { from_date: D[0], to_date: D[2], group_milk: true }).products || [])
    .find(p => p.product_id === dairy.MILK_TOTAL_ID);
const stmtMilk = ((stmtAll(D[0], D[2]).products) || []).find(p => p.product_id === dairy.MILK_TOTAL_ID);
ok(!!ledMilk && !!stmtMilk
    && near(ledMilk.report_opening, stmtMilk.report.opening)
    && near(ledMilk.report_closing, stmtMilk.report.closing),
    'the grouped ledger entry carries the same report opening/closing the Day by Day shows',
    ledMilk && { open: ledMilk.report_opening, close: ledMilk.report_closing, stmt: stmtMilk && [stmtMilk.report.opening, stmtMilk.report.closing] });
ok(!!stmtMilk && near(stmtMilk.report.rows[0].opening, -400) && near(stmtMilk.report.closing, -380)
    && near(stmtMilk.report.rows[0].closing, -410),
    'the report reads the plain rule on this fixture: 100 − 500 = −400 carried in, then −110 + 100 → −410, then −40 + 70 → −380 (the books sold more milk than they collected, so the balance is genuinely negative)',
    stmtMilk && stmtMilk.report.rows.map(r => [r.opening, r.sales, r.purchase, r.closing]));
ok(!!ledMilk && ledMilk.is_milk_total === true && Array.isArray(ledMilk.members) && ledMilk.members.length >= 3,
    'the row is the combined milk total (one row, all types)',
    ledMilk && { name: ledMilk.product_name, members: (ledMilk.members || []).length });
db2.close();

// ── TC-15 — the operator's report rule (the five-figure report) ───────────
//   Yesterday's Closing − Today's Total Sales + Today's Total Purchase = Today's Closing
// with Cow + Buffalo + Mix as ONE stock, no production/consumption/wastage
// term, and the operator's own worked examples asserted to the rupee/litre.
console.log('\n── TC-15 report rule: Yesterday\'s Closing − Total Sales + Total Purchase = Closing ──');
const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-'));
const db3 = initDatabase(dir3, 'test.db');
const mk3 = (name) => Number(db3.prepare(
    "INSERT INTO products (name, unit, category, rate) VALUES (?, 'liter', 'Milk', 80)"
).run(name).lastInsertRowid);
const rCow = mk3('Cow Milk');
const rBuf = mk3('Buffalo Milk');
const rMix = mk3('Mix Milk');
const rGhee = Number(db3.prepare(
    "INSERT INTO products (name, unit, category, rate) VALUES ('Ghee', 'kg', 'Dairy', 1400)"
).run().lastInsertRowid);
const mv3 = db3.prepare(`INSERT INTO stock_movements
    (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
    VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, 0, 'tc15')`);
const R1 = '2083-06-01', R2 = '2083-06-02', R0 = '2083-05-31';
// Stock carried in from before the report (yesterday's closing = 710.60 L).
mv3.run(rBuf, R0, 'opening', 710.60, 0);
// The operator's worked example, all three types on the same day:
//   sales 100 (Cow) + 150 (Buffalo) + 234 (Mix) = 484
//   purchases 116.60 (Cow) + 594.00 (Buffalo) + 0 (Mix) = 710.60
mv3.run(rCow, R1, 'sale', 0, 100);
mv3.run(rBuf, R1, 'sale', 0, 150);
mv3.run(rMix, R1, 'sale', 0, 234);
mv3.run(rCow, R1, 'milk_collection', 116.60, 0);
mv3.run(rBuf, R1, 'milk_collection', 594.00, 0);
// Day 2: sales only — it must start from day 1's closing.
mv3.run(rMix, R2, 'sale', 0, 100);
// The spec's single-product example: 710.60 − 484 + 500 = 726.60.
mv3.run(rGhee, R0, 'opening', 710.60, 0);
mv3.run(rGhee, R1, 'sale', 0, 484);
mv3.run(rGhee, R1, 'purchase', 500, 0);

const r15 = dairy.getDailyStockStatement(db3, { from_date: R1, to_date: R2 });
const milk15 = (r15.products || []).find(p => p.product_id === dairy.MILK_TOTAL_ID);
ok(!!milk15 && milk15.report && milk15.report.rows.length === 2, 'the milk report has one row per day',
    milk15 && milk15.report && milk15.report.rows.length);
if (milk15 && milk15.report) {
    const m1 = milk15.report.rows[0], m2 = milk15.report.rows[1];
    ok(near(m1.opening, 710.60) && near(m1.sales, 484) && near(m1.purchase, 710.60) && near(m1.closing, 937.20),
        'day 1: 710.60 − 484 (Cow 100 + Buffalo 150 + Mix 234) + 710.60 (Cow 116.60 + Buffalo 594) = 937.20',
        { open: m1.opening, sales: m1.sales, purchase: m1.purchase, close: m1.closing });
    ok(near(m2.opening, 937.20) && near(m2.sales, 100) && near(m2.purchase, 0) && near(m2.closing, 837.20),
        'day 2 starts from day 1\'s closing: 937.20 − 100 + 0 = 837.20',
        { open: m2.opening, sales: m2.sales, close: m2.closing });
    ok(Object.keys(m1).sort().join(',') === 'closing,date,has_data,opening,purchase,sales',
        'a report row carries the date + the three figures + the closing, nothing else', Object.keys(m1));
    const totSales = round2ui15(milk15.report.rows.reduce((s, r) => s + r.sales, 0));
    const totPurchase = round2ui15(milk15.report.rows.reduce((s, r) => s + r.purchase, 0));
    ok(near(milk15.report.rows[0].opening - totSales + totPurchase, milk15.report.closing),
        'the bottom totals balance: period opening − total sales + total purchase = final closing',
        { open: milk15.report.rows[0].opening, totSales, totPurchase, close: milk15.report.closing });
    ok(near(milk15.report.opening, dairy.reportOpeningBefore(db3, [rCow, rBuf, rMix], R1)),
        'the report opening is ONE combined replay (yesterday\'s total closing), not a per-type sum',
        milk15.report.opening);
}
ok(!(r15.products || []).some(p => [rCow, rBuf, rMix].includes(p.product_id)),
    'no separate per-type milk rows — one combined closing for all three types',
    (r15.products || []).map(p => p.product_name));
const ghee15 = (r15.products || []).find(p => p.product_id === rGhee);
ok(!!ghee15 && near(ghee15.report.rows[0].opening, 710.60) && near(ghee15.report.rows[0].sales, 484)
    && near(ghee15.report.rows[0].purchase, 500) && near(ghee15.report.rows[0].closing, 726.60),
    'the report works per product too: 710.60 − 484 + 500 = 726.60',
    ghee15 && ghee15.report.rows[0]);
// Production is deliberately NOT part of this report — the closing must not move.
mv3.run(rMix, R2, 'production_output', 500, 0);
const m2b = (dairy.getDailyStockStatement(db3, { from_date: R1, to_date: R2 }).products || [])
    .find(p => p.product_id === dairy.MILK_TOTAL_ID).report.rows[1];
ok(near(m2b.closing, 837.20) && near(m2b.purchase, 0),
    'a production entry does not enter the report (closing stays 837.20, purchase stays 0)', m2b);
db3.close();

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) {
    console.log('❌ DAILY STOCK STATEMENT — TC-01…TC-14 not fully satisfied');
    process.exit(1);
}
console.log('✅ DAILY STOCK STATEMENT — TC-01…TC-14 all passed');
