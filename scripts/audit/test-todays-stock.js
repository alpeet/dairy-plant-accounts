#!/usr/bin/env node
/**
 * N16/N44 — "TODAY'S STOCK" PANEL IDENTITY
 * =========================================
 * The panel (renderer/js/stock.js renderTodaysStock) is presentation only:
 * it reads ONE getStockLedger summary and renders
 *
 *   Opening + Collection/Purchase + Production − Sales − Consumption
 *   − Wastage ± Other = Closing
 *
 * with Other = the residual (returns, adjustments, reversals, opening
 * entries — including the leak cases where a deletion writes the wrong
 * direction under a named type, e.g. type='purchase' with outward_qty).
 *
 * This test mirrors the panel arithmetic over the SAME engine and asserts:
 *  1. every product row balances (identity exact to 0.01)
 *  2. per-unit subtotals balance (totals of rows are internally consistent)
 *  3. all-zero products are hidden by the panel filter
 *  4. the identity holds for a single day, a month and the all-time range
 *  5. closing equals the engine's replayed balance (no second engine)
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const dairyCosting = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** The panel's row computation — kept in lockstep with renderTodaysStock. */
function panelRows(ledger) {
    const rows = [];
    let hidden = 0;
    for (const p of (ledger.products || [])) {
        const b = p.summary || {};
        const opening = r2(b.opening || 0);
        const collection = r2((b.collection_in || 0) + (b.purchase_in || 0));
        const production = r2(b.production_in || 0);
        const sales = r2(b.sales_out || 0);
        const consumption = r2(b.production_out || 0);
        const wastage = r2(b.wastage_out || 0);
        const closing = r2(b.closing !== undefined && b.closing !== null ? b.closing : p.closing_qty);
        const other = r2((closing - opening) - (collection + production - sales - consumption - wastage));
        const vals = [opening, collection, production, sales, consumption, wastage, other, closing];
        if (vals.every(v => Math.abs(v) < 0.005)) { hidden++; continue; }
        const lhs = r2(r2(r2(opening + collection + production) - r2(sales + consumption + wastage)) + other);
        rows.push({ p, opening, collection, production, sales, consumption, wastage, other, closing, ok: Math.abs(lhs - closing) < 0.01 });
    }
    return { rows, hidden };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'todays-stock-'));
const db = initDatabase(dir, 'test.db');

const ins = (product_id, date, type, reference_type, inQty, outQty, bal, rate, notes) =>
    db.prepare(`INSERT INTO stock_movements (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
                VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`)
      .run(product_id, date, type, reference_type || null, inQty, outQty, bal, rate || 0, notes || '');

// ── Seed ──
const pRaw = Number(db.prepare("INSERT INTO products (name, unit, category, rate) VALUES ('Raw Milk', 'L', 'Milk', 60)").run().lastInsertRowid);
const pGhee = Number(db.prepare("INSERT INTO products (name, unit, category, rate) VALUES ('Ghee', 'kg', 'Dairy', 1400)").run().lastInsertRowid);
const pEmpty = Number(db.prepare("INSERT INTO products (name, unit, category, rate) VALUES ('Empty Thing', 'pcs', 'Other', 10)").run().lastInsertRowid);

// Raw milk: opening → collection in → production consumption → wastage
ins(pRaw, '2083-07-30', 'opening', null, 200, 0, 200, 60, 'Opening Stock');
ins(pRaw, '2083-08-01', 'milk_collection', 'milk_collection', 50, 0, 250, 60, 'Milk collection #1');
ins(pRaw, '2083-08-01', 'production_input', 'production', 0, 180, 70, 60, 'Production input: Batch A');
ins(pRaw, '2083-08-01', 'adjustment', 'wastage', 0, 10, 60, 60, 'Wastage: spill');
// Leak case 1 — deleted milk collection writes type='milk_collection' OUTWARD
ins(pRaw, '2083-08-01', 'milk_collection', 'milk_collection', 0, 5, 55, 60, 'Deleted milk collection #9');

// Ghee: opening → production out → sale → purchase → sale reversal (adjustment in)
ins(pGhee, '2083-07-30', 'opening', null, 50, 0, 50, 1400, 'Opening Stock');
ins(pGhee, '2083-08-01', 'production_output', 'production', 30, 0, 80, 1350, 'Production output: Batch A');
ins(pGhee, '2083-08-01', 'sale', 'sale', 0, 20, 60, 1400, 'Sale INV-1');
ins(pGhee, '2083-08-01', 'purchase', 'purchase', 15, 0, 75, 1380, 'Purchase BILL-1');
ins(pGhee, '2083-08-01', 'adjustment', 'sale', 5, 0, 80, 1400, 'Reversal of sale #2');
// Leak case 2 — deleted purchase writes type='purchase' OUTWARD
ins(pGhee, '2083-08-01', 'purchase', 'purchase', 0, 3, 77, 1380, 'Deleted Purchase BILL-2');
// Leak case 3 — an opening movement dated INSIDE the period (product created today)
const pNew = Number(db.prepare("INSERT INTO products (name, unit, category, rate) VALUES ('Fresh Product', 'kg', 'Dairy', 100)").run().lastInsertRowid);
ins(pNew, '2083-08-01', 'opening', null, 40, 0, 40, 100, 'Opening Stock');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — single day (2083-08-01): every row balances');
// ════════════════════════════════════════════════════════════
const day = dairyCosting.getStockLedger(db, { from_date: '2083-08-01', to_date: '2083-08-01' });
const d = panelRows(day);
ok(d.rows.length === 3, 'activity rows present (raw milk, ghee, fresh product)', d.rows.map(r => r.p.product_name));
ok(d.hidden >= 1, 'all-zero product hidden', d.hidden);
ok(d.rows.every(r => r.ok), 'identity exact for every row', d.rows.filter(r => !r.ok).map(r => r.p.product_name));

const raw = d.rows.find(r => r.p.product_id === pRaw);
ok(raw && raw.collection === 50, 'raw milk collection = 50 L (deleted 5 NOT netted into the bucket)', raw && raw.collection);
ok(raw && raw.consumption === 180, 'raw milk consumption = 180 L', raw && raw.consumption);
ok(raw && raw.wastage === 10, 'raw milk wastage = 10 L', raw && raw.wastage);
ok(raw && raw.other === -5, 'deleted collection leak lands in Other as −5', raw && raw.other);
ok(raw && raw.closing === 55, 'raw milk closing = 55 L', raw && raw.closing);

const ghee = d.rows.find(r => r.p.product_id === pGhee);
ok(ghee && ghee.production === 30, 'ghee production in = 30', ghee && ghee.production);
ok(ghee && ghee.sales === 20, 'ghee sales out = 20', ghee && ghee.sales);
ok(ghee && ghee.collection === 15, 'ghee purchase counted in Collection/Purchase = 15', ghee && ghee.collection);
ok(ghee && ghee.other === 2, 'reversal +5 and deleted-purchase −3 net to Other = +2', ghee && ghee.other);
ok(ghee && ghee.closing === 77, 'ghee closing = 77', ghee && ghee.closing);

const fresh = d.rows.find(r => r.p.product_id === pNew);
ok(fresh && fresh.opening === 0 && fresh.other === 40 && fresh.closing === 40,
    'opening movement dated inside the period shows as Other +40, closing 40', fresh);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — per-unit subtotals balance');
// ════════════════════════════════════════════════════════════
const units = new Map();
for (const r of d.rows) {
    const u = r.p.unit || 'qty';
    let t = units.get(u);
    if (!t) { t = { opening: 0, collection: 0, production: 0, sales: 0, consumption: 0, wastage: 0, other: 0, closing: 0 }; units.set(u, t); }
    for (const k of ['opening', 'collection', 'production', 'sales', 'consumption', 'wastage', 'other', 'closing']) t[k] = r2(t[k] + r[k]);
}
let subtotalsOk = true;
for (const [, t] of units) {
    const lhs = r2(r2(r2(t.opening + t.collection + t.production) - r2(t.sales + t.consumption + t.wastage)) + t.other);
    if (Math.abs(lhs - t.closing) >= 0.01) subtotalsOk = false;
}
ok(units.size === 2, 'units kept separate (L and kg, never mixed)', [...units.keys()]);
ok(subtotalsOk, 'every unit subtotal satisfies the identity', Object.fromEntries(units));

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — closing equals the engine replay (no second engine)');
// ════════════════════════════════════════════════════════════
const replayMismatches = d.rows.filter(r => {
    const replay = r2(db.prepare('SELECT COALESCE(SUM(inward_qty - outward_qty), 0) s FROM stock_movements WHERE product_id = ?').get(r.p.product_id).s);
    return Math.abs(replay - r.closing) >= 0.01;
});
ok(replayMismatches.length === 0, 'all closings equal SUM(inward − outward) replay', replayMismatches.map(r => r.p.product_name));

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — month and all-time ranges hold too');
// ════════════════════════════════════════════════════════════
const month = panelRows(dairyCosting.getStockLedger(db, { from_date: '2083-07-01', to_date: '2083-08-31' }));
ok(month.rows.length === 3 && month.rows.every(r => r.ok), 'month range: every row balances', month.rows.filter(r => !r.ok).map(r => r.p.product_name));
const all = panelRows(dairyCosting.getStockLedger(db, { from_date: '', to_date: '' }));
ok(all.rows.every(r => r.ok), 'all-time range: every row balances (opening = 0)', all.rows.filter(r => !r.ok).map(r => r.p.product_name));
ok(all.rows.every(r => r.opening === 0), 'all-time range starts at opening 0');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — empty period renders cleanly');
// ════════════════════════════════════════════════════════════
const emptyDay = panelRows(dairyCosting.getStockLedger(db, { from_date: '2082-01-01', to_date: '2082-01-01' }));
ok(emptyDay.rows.length === 0, 'a period with no history and no prior stock shows zero rows', emptyDay.rows.length);

console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
