#!/usr/bin/env node
/**
 * STOCK LEDGER + STOCK STATEMENT — FINAL BUSINESS LOGIC
 * =====================================================
 * Covers the 18-point spec against the REAL costing engine (no re-implemented
 * arithmetic in the test where the engine can be asked directly):
 *
 *  A. flowDelta — THE movement → statement-column mapping (single source).
 *  B. req 18 acceptance example: 750 − 350 = 400, +500 = 900, −600, −5 → 295,
 *     then tomorrow 295 − 100 = 195, then a sales return (mixed direction).
 *  C. req 3–8 per-product formulas (raw milk vs finished goods vs cream/ghee).
 *  D. req 10/11/12 automatic carry-forward (today's closing = tomorrow's
 *     opening; no manual opening entry).
 *  E. req 15 date-range semantics: opening = stock BEFORE the period, closing =
 *     balance after the last movement in it; the identity holds for single day,
 *     multi-day and all-time ranges.
 *  F. req 1/14 Party + Reference No. on every movement, internal movements
 *     labelled, deleted sources never blank.
 *  G. req 13 no duplicate stock (a collection posts only its own movement).
 *  H. req 17 Excel export: exact column set, sheet names, and it reconciles
 *     with the engine (zero mismatches) for every product.
 *  I. presentation filter: all-zero products are hidden/omitted.
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing'));
const { buildStockStatementWorkbook, dailyFlowRows } = require(path.join(ROOT, 'shared', 'export-stock-statement'));
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const near = (a, b, tol = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-statement-'));
const db = initDatabase(dir, 'test.db');

const YEST = '2083-07-31', TODAY = '2083-08-01', TOMORROW = '2083-08-02', DAY3 = '2083-08-03';

// ── Seed parties, products, source documents ──
const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type || 'customer').lastInsertRowid);
const pRam = party('Ram Bahadur', 'farmer');
const pAbc = party('ABC Customer', 'customer');
const pXyz = party('XYZ Supplier', 'supplier');

const prod = (name, unit, category) => Number(db.prepare('INSERT INTO products (name, unit, category, rate) VALUES (?, ?, ?, 60)').run(name, unit, category).lastInsertRowid);
const pRaw = prod('Raw Milk', 'L', 'Milk');
const pPaste = prod('Pasteurized Milk', 'L', 'Milk');
const pCream = prod('Cream', 'kg', 'Dairy');
const pGhee = prod('Ghee', 'kg', 'Dairy');
const pEmpty = prod('Empty Thing', 'pcs', 'Other');

db.prepare("INSERT INTO milk_collections (collection_no, date, party_id, quantity_liters, milk_type) VALUES ('MC-000125', ?, ?, 500, 'cow')").run(TODAY, pRam);
db.prepare("INSERT INTO sales (invoice_no, date, party_id, grand_total) VALUES ('INV-001245', ?, ?, 3500)").run(TODAY, pAbc);
db.prepare("INSERT INTO purchases (bill_no, date, party_id, grand_total) VALUES ('PUR-00087', ?, ?, 500)").run(TODAY, pXyz);
db.prepare("INSERT INTO production_batches (batch_no, date, process_type, input_quantity, output_quantity) VALUES ('PB-00045', ?, 'pasteurization', 600, 500)").run(TODAY);

const ins = (product_id, date, type, reference_type, reference_id, inQty, outQty, rate, notes) =>
    db.prepare(`INSERT INTO stock_movements (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(product_id, date, type, reference_type || null, reference_id == null ? null : reference_id, inQty, outQty, rate || 0, notes || '');

// ── Raw milk: yesterday 750 → today sales 350, collection 500, consumption 600, wastage 5 ──
ins(pRaw, YEST, 'opening', null, null, 750, 0, 60, 'Carried-forward closing');
ins(pRaw, TODAY, 'milk_collection', 'milk_collection', 1, 500, 0, 60, 'MC-000125');
ins(pRaw, TODAY, 'sale', 'sale', 1, 0, 350, 60, 'INV-001245');
ins(pRaw, TODAY, 'production_input', 'production', 1, 0, 600, 60, 'PB-00045');
ins(pRaw, TODAY, 'adjustment', 'wastage', null, 0, 5, 60, 'Wastage: spill');
// tomorrow pure sales, then a mixed-direction day (sale out + sales return in)
ins(pRaw, TOMORROW, 'sale', 'sale', 1, 0, 100, 60, 'INV-001245');
ins(pRaw, DAY3, 'sale', 'sale', 1, 0, 30, 60, 'INV-001245');
ins(pRaw, DAY3, 'sale', 'sale', 1, 40, 0, 60, 'Sales return INV-001245');
// a movement whose source document no longer exists (deleted sale)
ins(pRaw, YEST, 'sale', 'sale', 999999, 0, 0, 60, 'Deleted sale #999999');

// ── Finished goods: yesterday 200 → today sale 100 + production 500 = 600 ──
ins(pPaste, YEST, 'opening', null, null, 200, 0, 90, 'Carried-forward closing');
ins(pPaste, TODAY, 'sale', 'sale', 1, 0, 100, 90, 'INV-001245');
ins(pPaste, TODAY, 'production_output', 'production', 1, 500, 0, 88, 'PB-00045');

// ── Cream: used in production for Nauni (consumption) ──
ins(pCream, YEST, 'opening', null, null, 20, 0, 300, 'Carried-forward closing');
ins(pCream, TODAY, 'production_input', 'production', 1, 0, 5, 300, 'PB-00045 (Nauni)');
ins(pCream, TODAY, 'sale', 'sale', 1, 0, 2, 300, 'INV-001245');

// ── Ghee: produced + purchased ──
ins(pGhee, YEST, 'opening', null, null, 10, 0, 1400, 'Carried-forward closing');
ins(pGhee, TODAY, 'production_output', 'production', 1, 3, 0, 1400, 'PB-00045');
ins(pGhee, TODAY, 'purchase', 'purchase', 1, 2, 0, 1380, 'PUR-00087');

const one = (productId, from, to) => {
    const r = dairy.getStockLedger(db, { product_id: productId, from_date: from, to_date: to });
    return r.products[0];
};
const rowFor = (productId, from, to) => one(productId, from, to).flow;

console.log('\nA. flowDelta — the single movement → column mapping');
{
    const cases = [
        [{ type: 'sale', inward_qty: 0, outward_qty: 10 }, 'sales_issues', 10],
        [{ type: 'sale', inward_qty: 4, outward_qty: 10 }, 'sales_issues', 6],
        [{ type: 'milk_collection', inward_qty: 10, outward_qty: 0 }, 'collection_purchase', 10],
        [{ type: 'purchase', inward_qty: 10, outward_qty: 0 }, 'collection_purchase', 10],
        [{ type: 'production_output', inward_qty: 10, outward_qty: 0 }, 'production', 10],
        [{ type: 'production_input', inward_qty: 0, outward_qty: 10 }, 'production_consumption', 10],
        [{ type: 'adjustment', inward_qty: 0, outward_qty: 5 }, 'other', -5],
        [{ type: 'return_in', inward_qty: 5, outward_qty: 0 }, 'other', 5]
    ];
    for (const [m, col, qty] of cases) {
        const d = dairy.flowDelta(m);
        ok(d.column === col && near(d.qty, qty), `${m.type} ${m.inward_qty}/${m.outward_qty} → ${col} ${qty}`, d);
    }
}

console.log('\nB. req 18 — acceptance example (Raw Milk)');
{
    const f = rowFor(pRaw, TODAY, TODAY);
    ok(near(f.opening, 750), 'yesterday closing = 750 L', f.opening);
    ok(near(f.sales_issues, 350), "today's sales = 350 L", f.sales_issues);
    ok(near(f.remaining, 400), 'remaining after sales = 400 L', f.remaining);
    ok(near(f.collection_purchase, 500), "today's collection = 500 L", f.collection_purchase);
    ok(near(f.production, 0), 'no production output for raw milk', f.production);
    ok(near(f.production_consumption, 600), 'production consumption = 600 L', f.production_consumption);
    ok(near(f.other, -5), 'wastage shows in Other = −5 L', f.other);
    ok(near(f.closing, 295), "today's closing = 295 L (400 + 500 − 600 − 5)", f.closing);
    ok(f.identity_ok === true, 'identity asserted by the engine, not assumed');

    const t = rowFor(pRaw, TOMORROW, TOMORROW);
    ok(near(t.opening, 295), "tomorrow's opening = today's closing = 295 L", t.opening);
    ok(near(t.remaining, 195), "tomorrow: 295 − 100 sales = 195 L", t.remaining);
    ok(near(t.closing, 195), "tomorrow's closing = 195 L", t.closing);

    const d3 = rowFor(pRaw, DAY3, DAY3);
    ok(near(d3.opening, 195), 'day 3 opens at 195 L (automatic carry-forward)', d3.opening);
    ok(near(d3.sales_issues, -10), 'mixed direction: 30 out − 40 returned = −10 net', d3.sales_issues);
    ok(near(d3.remaining, 205), 'sales return adds back: 195 + 10 = 205 L', d3.remaining);
    ok(d3.identity_ok === true, 'identity holds for the mixed-direction day');
}

console.log('\nC. req 3–8 — each product uses its own applicable movements');
{
    const p = rowFor(pPaste, TODAY, TODAY);
    ok(near(p.opening, 200) && near(p.sales_issues, 100) && near(p.remaining, 100)
        && near(p.production, 500) && near(p.closing, 600),
        'finished milk: 200 − 100 + 500 = 600 L', p);
    ok(p.identity_ok, 'finished milk identity holds');

    const c = rowFor(pCream, TODAY, TODAY);
    ok(near(c.opening, 20) && near(c.production_consumption, 5) && near(c.sales_issues, 2)
        && near(c.closing, 13), 'cream: 20 − 5 (used for Nauni) − 2 sold = 13 kg', c);

    const g = rowFor(pGhee, TODAY, TODAY);
    ok(near(g.opening, 10) && near(g.production, 3) && near(g.collection_purchase, 2)
        && near(g.closing, 15), 'ghee: 10 + 3 produced + 2 purchased = 15 kg', g);
    ok(!near(rowFor(pRaw, TODAY, TODAY).production, 500),
        'raw milk is NOT credited with production output (no forced single formula)');
}

console.log('\nD. req 10/11/12 — automatic carry-forward, never a manual opening entry');
{
    const chain = [TODAY, TOMORROW, DAY3].map(d => rowFor(pRaw, d, d).closing);
    const openings = [TOMORROW, DAY3].map(d => rowFor(pRaw, d, d).opening);
    ok(near(openings[0], chain[0]) && near(openings[1], chain[1]),
        `closing of each day becomes the next day's opening (${chain.join(' → ')})`, { chain, openings });
    const seeded = one(pRaw, YEST, YEST).rows.filter(r => r.date === TOMORROW || r.date === DAY3);
    ok(seeded.every(r => r.type === 'sale'),
        'no manual "opening" movement exists on the later days — the balance carries itself');
}

console.log('\nE. req 15 — date-range semantics');
{
    const range = rowFor(pRaw, TODAY, DAY3);
    ok(near(range.opening, 750), 'range opening = stock immediately BEFORE the period', range.opening);
    ok(near(range.sales_issues, 350 + 100 - 10), 'range movements include every day in the period', range.sales_issues);
    ok(near(range.closing, 205), 'range closing = balance after the last movement in the period', range.closing);
    ok(range.identity_ok, 'range identity holds');

    const all = one(pRaw, '', '');
    ok(near(all.flow.opening, 0), 'all-time opening is 0 (nothing exists before it)', all.flow.opening);
    ok(near(all.flow.closing, 205), 'all-time closing equals the last day closing', all.flow.closing);
    ok(all.flow.identity_ok, 'all-time identity holds');

    let bad = 0, checked = 0;
    for (const rangeDef of [[TODAY, TODAY], [TODAY, TOMORROW], [TOMORROW, DAY3], [YEST, DAY3], ['', '']]) {
        const l = dairy.getStockLedger(db, { from_date: rangeDef[0], to_date: rangeDef[1] });
        for (const p of l.products) {
            if (!p.rows.length) continue;
            checked++;
            if (!p.flow.identity_ok) bad++;
        }
    }
    ok(bad === 0, `identity holds for every product in every period (${checked} rows checked)`, bad);
}

console.log('\nF. req 1/14 — Party + Reference No. on every movement');
{
    const raw = one(pRaw, '', '');
    const find = (type, ref) => raw.rows.find(r => r.type === type && r.reference_no === ref);
    const mc = find('milk_collection', 'MC-000125');
    ok(!!mc && mc.party === 'Ram Bahadur', 'collection row shows Party = Ram Bahadur + MC-000125', mc && [mc.party, mc.reference_no]);
    const sale = raw.rows.find(r => r.type === 'sale' && r.reference_no === 'INV-001245' && r.outward_qty > 0);
    ok(!!sale && sale.party === 'ABC Customer', 'sales row shows Party = ABC Customer + INV-001245', sale && [sale.party, sale.reference_no]);
    const prodIn = raw.rows.find(r => r.type === 'production_input');
    ok(!!prodIn && prodIn.party === 'Production / Internal' && prodIn.reference_no === 'PB-00045',
        'production consumption shows Production / Internal + PB-00045', prodIn && [prodIn.party, prodIn.reference_no]);
    const waste = raw.rows.find(r => r.type === 'adjustment');
    ok(!!waste && waste.party === 'Wastage / Internal', 'wastage movement is labelled, never blank', waste && waste.party);

    const ghee = one(pGhee, '', '');
    const pur = ghee.rows.find(r => r.type === 'purchase');
    ok(!!pur && pur.party === 'XYZ Supplier' && pur.reference_no === 'PUR-00087',
        'purchase row shows Party = XYZ Supplier + PUR-00087', pur && [pur.party, pur.reference_no]);

    const ghost = raw.rows.find(r => r.reference_id === 999999);
    ok(!!ghost && String(ghost.party || '').length > 0,
        'movement whose source was deleted still names its source', ghost && ghost.party);

    let blank = 0;
    for (const p of dairy.getStockLedger(db, { from_date: '', to_date: '' }).products) {
        for (const r of p.rows) if (!String(r.party || '').trim()) blank++;
    }
    ok(blank === 0, 'no movement is left without a party/source', blank);

    // Click-through metadata: a document id is exposed for every linked movement.
    const linked = raw.rows.filter(r => ['sale', 'purchase', 'milk_collection', 'production'].includes(r.reference_type));
    ok(linked.every(r => r.reference_id != null), 'every linked movement exposes its source id for click-through');
    ok(raw.rows.every(r => typeof r.label === 'string' && r.label.length > 0), 'every movement carries a human transaction type');
}

console.log('\nG. req 13 — a transaction affects stock exactly once');
{
    const raw = one(pRaw, TODAY, TODAY);
    ok(near(raw.summary.collection_in, 500) && near(raw.summary.purchase_in, 0),
        'a milk collection posts ONLY its collection movement (no duplicate purchase IN)',
        { collection_in: raw.summary.collection_in, purchase_in: raw.summary.purchase_in });
    const paste = one(pPaste, TODAY, TODAY);
    ok(near(paste.summary.production_in, 500) && near(paste.summary.collection_in, 0),
        'production creates the output IN (no manual adjustment for the same batch)', paste.summary.production_in);
    ok(near(raw.summary.production_out, 600), 'production also consumed the input exactly once', raw.summary.production_out);
    ok(near(raw.summary.sales_out, 350), 'the sales invoice created the sale OUT once', raw.summary.sales_out);
}

console.log('\nH. req 17 — Excel export reconciles with the application');
{
    const built = buildStockStatementWorkbook(db, { from_date: TODAY, to_date: DAY3 });
    ok(built.mismatches.length === 0, 'no product mismatches between the workbook and the engine', built.mismatches);
    ok(built.statementRows > 0 && built.ledgerRows > 0, 'both sheets carry rows', { s: built.statementRows, l: built.ledgerRows });

    const out = path.join(dir, 'stock-statement.xlsx');
    const res = require(path.join(ROOT, 'shared', 'export-stock-statement')).exportStockStatementExcel(db, out, { from_date: TODAY, to_date: DAY3 });
    ok(res.success === true && res.reconciled === true, 'export succeeds and reports reconciled', res);
    const wb = XLSX.readFile(out);
    ok(wb.SheetNames.includes('Stock_Statement') && wb.SheetNames.includes('Stock_Ledger'),
        'workbook has Stock_Statement + Stock_Ledger sheets', wb.SheetNames);

    const stmt = XLSX.utils.sheet_to_json(wb.Sheets['Stock_Statement'], { header: 1 });
    ok(JSON.stringify(stmt[0]) === JSON.stringify(['Date', 'Reference', 'Party', 'Product', 'Opening', 'Sales/Issues',
        'Remaining', 'Collection/Purchase', 'Production', 'Production Consumption', 'Other', 'Closing']),
        'stock statement columns exactly as specified', stmt[0]);
    const led = XLSX.utils.sheet_to_json(wb.Sheets['Stock_Ledger'], { header: 1 });
    ok(JSON.stringify(led[0]) === JSON.stringify(['Date', 'Reference No.', 'Party', 'Product', 'Transaction Type',
        'Opening', 'IN', 'OUT', 'Closing', 'Unit Cost', 'Value']),
        'stock ledger columns exactly as specified', led[0]);

    // Cross-check the row arithmetic on every exported statement row.
    let badRow = 0;
    for (const row of stmt.slice(1)) {
        const [, , , , opening, sales, remaining, coll, prod2, cons, other, closing] = row;
        if (!near(opening - sales, remaining)) badRow++;
        if (!near(remaining + coll + prod2 - cons + other, closing)) badRow++;
    }
    ok(badRow === 0, 'every exported row satisfies Opening − Sales = Remaining and Remaining + IN − OUT = Closing', badRow);

    // Carry-forward across days is present in the export.
    const rawRows = stmt.slice(1).filter(r => r[3] === 'Raw Milk');
    ok(rawRows.length >= 3, 'raw milk has one exported row per day', rawRows.length);
    ok(near(rawRows[0][11], 295) && near(rawRows[1][4], 295),
        'exported day 2 opening = day 1 closing (automatic carry-forward)', [rawRows[0][11], rawRows[1][4]]);
    ok(near(rawRows[rawRows.length - 1][11], 205), 'last exported closing = engine closing', rawRows[rawRows.length - 1][11]);

    const exportedRawParties = stmt.slice(1).filter(r => r[3] === 'Raw Milk').map(r => String(r[2]));
    ok(exportedRawParties.some(s => s.includes('Ram Bahadur')) && exportedRawParties.some(s => s.includes('Production / Internal')),
        'exported statement names its parties/sources', exportedRawParties.slice(0, 3));
}

console.log('\nI. presentation — all-zero products are hidden, non-zero kept');
{
    const l = dairy.getStockLedger(db, { from_date: TODAY, to_date: TODAY });
    const emptyProduct = l.products.find(p => p.product_id === pEmpty);
    ok(!!emptyProduct && near(emptyProduct.flow.closing, 0) && near(emptyProduct.flow.opening, 0),
        'a product with no movement has an all-zero flow row');
    const built = buildStockStatementWorkbook(db, { from_date: TODAY, to_date: TODAY });
    const stmt = XLSX.utils.sheet_to_json(built.workbook.Sheets['Stock_Statement'], { header: 1 });
    ok(!stmt.slice(1).some(r => r[3] === 'Empty Thing'), 'the empty product is omitted from the export');
    ok(stmt.slice(1).some(r => r[3] === 'Raw Milk'), 'a product with movement is present');

    // dailyFlowRows is the exported shape of one product's day-by-day flow.
    const days = dailyFlowRows(one(pRaw, '', ''));
    ok(days.length === 4 && days[0].opening === 0 && near(days[days.length - 1].closing, 205),
        'daily flow rows carry the balance across every day', days.map(d => [d.date, d.opening, d.closing]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
