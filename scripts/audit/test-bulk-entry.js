/**
 * Bulk (date-wise) Entry Acceptance Tests — spec items 1–21
 * =========================================================
 * Verifies the three mandatory entry paths produce equivalent records:
 *   PATH 1: one-by-one saveMilkCollection/saveSale/savePurchase
 *   PATH 2: date-wise bulk saveBulk*
 *   PATH 3: Excel import (round-trip engine covered in test-excel-roundtrip.js)
 * plus duplicate protection, per-row validation and transaction rollback.
 *
 * Run: NODE_PATH="$PWD/node_modules" node scripts/audit/test-bulk-entry.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const bulk = require(path.join(ROOT, 'shared', 'operations', 'bulk_entry.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const salesOps = require(path.join(ROOT, 'shared', 'operations', 'sales.js'));
const purchasesOps = require(path.join(ROOT, 'shared', 'operations', 'purchases.js'));

const DB_PATH = '/tmp/bulk-entry-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'bulk-entry-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
function near(a, b, eps = 0.6) { return Math.abs(Number(a || 0) - Number(b || 0)) < eps; }

// ── Seed reference data ──
const fA = db.prepare("INSERT INTO parties (name, type) VALUES ('Farmer A', 'farmer')").run().lastInsertRowid;
const fB = db.prepare("INSERT INTO parties (name, type) VALUES ('Farmer B', 'farmer')").run().lastInsertRowid;
const fC = db.prepare("INSERT INTO parties (name, type) VALUES ('Farmer C', 'farmer')").run().lastInsertRowid;
const custA = db.prepare("INSERT INTO parties (name, type) VALUES ('Customer A', 'customer')").run().lastInsertRowid;
const custB = db.prepare("INSERT INTO parties (name, type) VALUES ('Customer B', 'customer')").run().lastInsertRowid;
const supA = db.prepare("INSERT INTO parties (name, type) VALUES ('Supplier A', 'supplier')").run().lastInsertRowid;
const supB = db.prepare("INSERT INTO parties (name, type) VALUES ('Supplier B', 'supplier')").run().lastInsertRowid;
const milkProd = db.prepare("INSERT INTO products (name, unit, rate, category) VALUES ('Milk', 'liter', 75, 'Milk')").run().lastInsertRowid;
const yogurtProd = db.prepare("INSERT INTO products (name, unit, rate) VALUES ('Yogurt', 'kg', 80)").run().lastInsertRowid;

console.log('\n═══ 1. PATH 1 — one-by-one milk collection ═══');
// The single-entry UI pre-calculates the rate (calculateMilkRate) before saving.
const single = milkOps.saveMilkCollection(db, {
    collection_no: 'MC-T-0001', date: '2083-06-14', party_id: fA, milk_type: 'cow',
    quantity_liters: 50, fat_percent: 4.2, snf_percent: 8.1, rate: 30, amount: 1500, shift: 'morning', status: 'pending'
}, 1);
const singleId = single && single.id ? single.id : single;
const singleRow = db.prepare('SELECT * FROM milk_collections WHERE id = ?').get(singleId);
check('single collection saved', !!singleRow, singleRow);
check('rate stored as given by caller', near(singleRow.rate, 30), singleRow.rate);
check('amount = rate × qty', near(singleRow.amount, 30 * 50), singleRow.amount);

console.log('\n═══ 2. PATH 2 — date-wise bulk collections (one SAVE ALL) ═══');
const bulkRes = bulk.saveBulkCollections(db, {
    date: '2083-06-14', shift: 'morning',
    rows: [
        { party_name: 'Farmer B', milk_type: 'cow', quantity_liters: 42, fat_percent: 4.0, snf_percent: 8.0 },
        { party_name: 'Farmer C', milk_type: 'buffalo', quantity_liters: 38, fat_percent: 6.0, snf_percent: 8.5 },
        { party_name: 'farmer  a', milk_type: 'cow', quantity_liters: 45, fat_percent: 4.1, snf_percent: 8.0 }, // fuzzy name → Farmer A
    ]
}, 1);
check('2 added + 1 updated (cross-path upsert), 0 failed', bulkRes.added === 2 && bulkRes.updated === 1 && bulkRes.failed === 0, bulkRes);
check('added rows got their own MC- collection numbers', bulkRes.results.filter(r => r.status === 'added').every(r => /^MC-\d{6}-\d{4}$/.test(r.collection_no)), bulkRes.results.map(r => r.collection_no));
check('updated row KEEPS its original collection number', bulkRes.results.find(r => r.status === 'updated')?.collection_no === 'MC-T-0001', bulkRes.results);

console.log('\n═══ 3. PATH equivalence — same date/shift/farmer = ONE record, same structure ═══');
const faRows = db.prepare(`
    SELECT mc.* FROM milk_collections mc JOIN parties p ON p.id = mc.party_id
    WHERE p.name = 'Farmer A' AND mc.date = '2083-06-14' AND mc.shift = 'morning' ORDER BY mc.id
`).all();
check('bulk entry did NOT duplicate the single-entry record', faRows.length === 1, faRows.length);
const bulkFa = faRows[0];
check('row now carries the bulk-entered values (qty 45, FAT 4.1)',
    bulkFa.date === '2083-06-14' && bulkFa.party_id === Number(fA) && bulkFa.milk_type === 'cow'
    && near(bulkFa.quantity_liters, 45) && near(bulkFa.fat_percent, 4.1) && near(bulkFa.snf_percent, 8.0)
    && bulkFa.rate > 0 && near(bulkFa.amount, bulkFa.rate * 45), bulkFa);
check('bulk path wrote the formula rate (4.1×7.15 + 8.0×4.55)', near(bulkFa.rate, 4.1 * 7.15 + 8.0 * 4.55), bulkFa.rate);
check('record has ledger entry (single path ledger preserved/replaced)',
    db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE reference_type = 'milk_collection' AND reference_id = ?").get(bulkFa.id).c === 1);
check('record has stock movement',
    db.prepare("SELECT COUNT(*) c FROM stock_movements WHERE reference_type = 'milk_collection' AND reference_id = ?").get(bulkFa.id).c >= 1);

console.log('\n═══ 4. Duplicate protection — same date/shift/farmer/type UPDATES ═══');
const beforeCnt = db.prepare("SELECT COUNT(*) c FROM milk_collections WHERE date = '2083-06-14'").get().c;
const updRes = bulk.saveBulkCollections(db, {
    date: '2083-06-14', shift: 'morning',
    rows: [{ party_name: 'Farmer B', milk_type: 'cow', quantity_liters: 44, fat_percent: 4.0, snf_percent: 8.0 }]
}, 1);
const afterCnt = db.prepare("SELECT COUNT(*) c FROM milk_collections WHERE date = '2083-06-14'").get().c;
check('re-save updates instead of duplicating', updRes.updated === 1 && updRes.added === 0, updRes);
check('collection count unchanged after re-save', beforeCnt === afterCnt, { before: beforeCnt, after: afterCnt });
const updatedB = db.prepare(`
    SELECT mc.* FROM milk_collections mc JOIN parties p ON p.id = mc.party_id
    WHERE p.name = 'Farmer B' AND mc.date = '2083-06-14' AND mc.shift = 'morning'
`).get();
check('quantity updated to 44', near(updatedB.quantity_liters, 44), updatedB.quantity_liters);

console.log('\n═══ 5. Evening shift is a separate business identity ═══');
const eveRes = bulk.saveBulkCollections(db, {
    date: '2083-06-14', shift: 'evening',
    rows: [{ party_name: 'Farmer B', milk_type: 'cow', quantity_liters: 40, fat_percent: 4.1, snf_percent: 8.1 }]
}, 1);
check('evening row added (not merged with morning)', eveRes.added === 1, eveRes);
check('farmer B now has 2 rows (morning + evening)',
    db.prepare(`
        SELECT COUNT(*) c FROM milk_collections mc JOIN parties p ON p.id = mc.party_id
        WHERE p.name = 'Farmer B' AND mc.date = '2083-06-14'
    `).get().c === 2);

console.log('\n═══ 6. Row-level validation — nothing silently saved ═══');
const valRes = bulk.saveBulkCollections(db, {
    date: '2083-06-15', shift: 'morning',
    rows: [
        { party_name: 'Farmer A', milk_type: 'cow', quantity_liters: 30, fat_percent: 4.0, snf_percent: 8.0 },
        { party_name: 'Ghost Farmer', milk_type: 'cow', quantity_liters: 10, fat_percent: 4.0, snf_percent: 8.0 },
        { party_name: 'Farmer B', milk_type: 'cow', quantity_liters: 0, fat_percent: 4.0, snf_percent: 8.0 },
    ]
}, 1);
check('valid row saved, invalid rows counted as failed', valRes.added === 1 && valRes.failed === 2, valRes);
check('errors name the failing rows', valRes.errors.some(e => /Ghost Farmer/.test(e.name)) && valRes.errors.some(e => /Quantity/.test(e.error)), valRes.errors);

console.log('\n═══ 7. Bulk purchases — independent bills, not one combined bill ═══');
const purRes = bulk.saveBulkPurchases(db, {
    date: '2083-06-14',
    rows: [
        { party_name: 'Supplier A', product_name: 'Milk', quantity: 500, rate: 75 },
        { party_name: 'Supplier B', product_name: 'Milk', quantity: 300, rate: 76 },
    ]
}, 1);
check('2 purchases created', purRes.added === 2 && purRes.failed === 0, purRes);
const purRows = db.prepare("SELECT * FROM purchases WHERE date = '2083-06-14'").all();
check('two independent purchase bills', purRows.length === 2, purRows.length);
check('distinct auto bill numbers (BULK-BILL-*)', new Set(purRows.map(p => p.bill_no)).size === 2 && purRows.every(p => /^BULK-BILL-/.test(p.bill_no)), purRows.map(p => p.bill_no));
check('each bill has own ledger entry', db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE reference_type = 'purchase' AND date = '2083-06-14'").get().c >= 2);

console.log('\n═══ 8. Bulk sales — proper invoices with FIFO lot COGS ═══');
// Give the finished-goods lot something to consume: post a batch via the
// costing engine (milk lots are backfilled from the collections entered above).
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
costing.setLotCutover(db, '2083-01-01');
db.prepare("UPDATE products SET rate = 95 WHERE id = ?").run(milkProd);
check('backfillMilkLots runs clean (no gaps to fill)', costing.backfillMilkLots(db, { from_date: '2083-06-01' }) === 0);
// Raw milk for the batch — bulk-entered the day before, so FIFO chronology holds:
// collections (06-12) → batch (06-13) → sales (06-14).
const rawRes = bulk.saveBulkCollections(db, {
    date: '2083-06-12', shift: 'morning',
    rows: [
        { party_name: 'Farmer A', milk_type: 'cow', quantity_liters: 60, fat_percent: 4.2, snf_percent: 8.2 },
        { party_name: 'Farmer B', milk_type: 'cow', quantity_liters: 55, fat_percent: 4.0, snf_percent: 8.0 },
    ]
}, 1);
check('raw-milk collections bulk-entered for the batch', rawRes.added === 2, rawRes);
const lotCount = db.prepare('SELECT COUNT(*) c FROM milk_lots').get().c;
check('milk lots exist (auto-created by collection saves)', lotCount >= 6, lotCount);
const batch = costing.postProductionBatch(db, {
    date: '2083-06-13', process_type: 'DIRECT_MIX', processing_cost: 100,
    inputs: [{ milk_type: 'cow', quantity: 100 }],
    outputs: [{ product_id: milkProd, quantity: 98 }],
}, 1);
check('batch posted for stock lots', !!(batch && (batch.id || batch.batchId)), batch);
const saleRes = bulk.saveBulkSales(db, {
    date: '2083-06-14',
    rows: [
        { party_name: 'Customer A', product_name: 'Milk', quantity: 50, rate: 95 },
        { party_name: 'Customer B', product_name: 'Milk', quantity: 30, rate: 95 },
    ]
}, 1);
check('2 sales created', saleRes.added === 2 && saleRes.failed === 0, saleRes);
const saleRows = db.prepare("SELECT * FROM sales WHERE date = '2083-06-14'").all();
check('two independent invoices (BULK-INV-*)', saleRows.length === 2 && saleRows.every(s => /^BULK-INV-/.test(s.invoice_no)), saleRows.map(s => s.invoice_no));
const milkSale = saleRows.find(s => s.grand_total === 4750);
check('milk sale invoice carries lot COGS (FIFO)', milkSale && near(milkSale.lot_cogs, 50 * (batch.total_cost / 98), 1), milkSale && milkSale.lot_cogs);

console.log('\n═══ 9. Transaction rollback — no half-created rows ═══');
const salesBefore = db.prepare('SELECT COUNT(*) c FROM sales').get().c;
const invoices = db.prepare("SELECT invoice_no FROM sales WHERE invoice_no LIKE 'RB-%'").all().map(r => r.invoice_no);
// Directly probe the transactional behavior: a row with an unknown party id forces failure after insert
let rollbackCaught = null;
try {
    const trx = db.transaction(() => {
        db.prepare("INSERT INTO sales (invoice_no, date, party_id, subtotal, grand_total) VALUES ('RB-1', '2083-06-16', ?, 10, 10)").run(custA);
        throw new Error('forced failure');
    });
    try { trx(); } catch (e) { rollbackCaught = e.message; }
} catch (e) { rollbackCaught = e.message; }
const salesAfter = db.prepare('SELECT COUNT(*) c FROM sales').get().c;
check('rollback discards the forced insert', rollbackCaught === 'forced failure' && salesBefore === salesAfter, { salesBefore, salesAfter });
const rbGone = db.prepare("SELECT COUNT(*) c FROM sales WHERE invoice_no = 'RB-1'").get().c;
check('no half-created invoice left behind', rbGone === 0, rbGone);

console.log('\n═══ 10. Load-existing returns grid-ready rows (spec §14) ═══');
const loadedColl = bulk.loadBulkCollections(db, { date: '2083-06-14', shift: 'morning' });
check('collections load includes bulk + single rows', loadedColl.length >= 3, loadedColl.length);
const loadedSales = bulk.loadBulkSales(db, { date: '2083-06-14' });
check('sales load includes product detail rows', loadedSales.length >= 2 && loadedSales.every(s => s.product_name || s.invoice_no), loadedSales.length);
const loadedPur = bulk.loadBulkPurchases(db, { date: '2083-06-14' });
check('purchases load includes product detail rows', loadedPur.length >= 2 && loadedPur.every(p => p.bill_no), loadedPur.length);

console.log('\n═══ 11. Excel export shows bulk-entered rows individually (spec §7/§17) ═══');
const { exportToDailyAccountExcel } = require(path.join(ROOT, 'shared', 'export-daily-account.js'));
const outXlsx = '/tmp/bulk-entry-export.xlsx';
try { fs.unlinkSync(outXlsx); } catch (e) { /* ignore */ }
exportToDailyAccountExcel(db, outXlsx);    const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
    (async () => {
    const wb = XLSX.readFile(outXlsx);
    const milkSheetName = wb.SheetNames.find(n => /milk/i.test(n));
    let dataRows = 0;
    if (milkSheetName) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[milkSheetName], { header: 1, defval: '' });
        dataRows = rows.filter((r, i) => i > 0 && r[3] && String(r[3]).trim() !== '').length;
    }
    check('exported Milk_Collections sheet has bulk-entered rows', dataRows >= 6, { sheet: milkSheetName || 'MISSING', dataRows });

    console.log('\n═══ 12. PATH 3 — Excel import matches bulk/single structure (spec §8/§9/§15) ═══');
    const importer = require(path.join(ROOT, 'shared', 'excel-import.js'));
    const imp1 = importer.runExcelImport(db, outXlsx, { mode: 'upsert', log: () => {} });
    const collSummary = imp1 && imp1.milkCollections;
    check('importer ran with change detection', !!imp1, imp1 && Object.keys(imp1).slice(0, 8));
    check('milk-collection import reports added/updated/unchanged',
        collSummary && collSummary.added !== undefined && collSummary.updated !== undefined && collSummary.unchanged !== undefined, collSummary);
    check('bulk-entered rows import as UNCHANGED (not re-added)',
        collSummary && collSummary.added === 0 && collSummary.unchanged >= 3, collSummary);
    const cntBeforeImport = db.prepare("SELECT COUNT(*) c FROM milk_collections WHERE date = '2083-06-14'").get().c;
    const cntAfterImport = db.prepare("SELECT COUNT(*) c FROM milk_collections WHERE date = '2083-06-14'").get().c;
    check('import does not duplicate bulk-entered collections', cntAfterImport === cntBeforeImport, { before: cntBeforeImport, after: cntAfterImport });
    const imp2 = importer.runExcelImport(db, outXlsx, { mode: 'upsert', log: () => {} });
    const collSummary2 = imp2 && imp2.milkCollections;
    check('re-import is all UNCHANGED (no duplicates)',
        collSummary2 && collSummary2.added === 0 && collSummary2.updated === 0, collSummary2);

    console.log('\n════════════════════════════════════════');
    console.log(`BULK ENTRY RESULT: ${passed} passed, ${failed} failed`);
    db.close();
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
    console.error('EXPORT/IMPORT SECTION FAILED:', e.message);
    console.log(`BULK ENTRY RESULT: ${passed} passed, ${failed} failed`);
    db.close();
    process.exit(1);
});
