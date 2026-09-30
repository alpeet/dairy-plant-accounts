/**
 * Excel Round-Trip Test — Export → Edit → Import → Verify → Re-Import
 * ====================================================================
 * Proves the mandated round trip (spec item 29/30):
 *   1. Export complete database to Excel.
 *   2. Modify several records in Excel (party, product, route, rate chart…).
 *   3. Import the Excel (upsert mode).
 *   4. Verify the database actually changed.
 *   5. Import the SAME file again → Added: 0, Updated: 0, Unchanged: all.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-excel-roundtrip.js
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const { exportToDailyAccountExcel } = require(path.join(ROOT, 'shared', 'export-daily-account.js'));
const { runExcelImport } = require(path.join(ROOT, 'shared', 'excel-import.js'));

const DB_PATH = '/tmp/excel-roundtrip-test.db';
const XLSX_PATH = '/tmp/excel-roundtrip-test.xlsx';

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── Setup: fresh temp database ─────────────────────────────────
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', XLSX_PATH]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
}
const db = initDatabase('/tmp', 'excel-roundtrip-test.db');

console.log('\n═══ STEP 0: seed every dataset ═══');
const seedParty = db.prepare("INSERT INTO parties (name, type, phone, address, opening_balance) VALUES (?, ?, ?, ?, ?)");
seedParty.run('Customer Alpha', 'customer', '9801000001', 'Kirtipur', 0);
seedParty.run('Supplier Beta', 'supplier', '9801000002', 'Kalanki', 0);
seedParty.run('Farmer Gamma', 'farmer', '9801000003', 'Pharping', 0);
seedParty.run('Partner Delta', 'partner', '9801000004', 'Kathmandu', 0);
db.prepare("INSERT INTO products (name, unit, category, rate, expiry_days) VALUES ('Mix Milk', 'L', 'milk', 85, 3)").run();
db.prepare("INSERT INTO routes (name, area, assigned_vehicle, assigned_staff) VALUES ('Kirtipur Route', 'West', 'Ba 2 Cha 1234', 'Ram')").run();
db.prepare("INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier) VALUES ('2083-06-01', 'formula', 7.15, 4.55)").run();
db.prepare("INSERT INTO vehicle_expenses (date, vehicle_name, expense_type, total_amount, remarks) VALUES ('2083-06-05', 'Van 1', 'fuel', 500, 'seed')").run();
db.prepare("INSERT INTO other_expenses (date, category, expense_head, amount, payment_mode) VALUES ('2083-06-05', 'utilities', 'electricity', 300, 'cash')").run();
db.prepare("INSERT INTO cash_deposits (date, deposit_no, bank_name, amount, cash_source) VALUES ('2083-06-05', 'CD-SEED-1', 'Nabil', 5000, 'sales')").run();
const partnerId = db.prepare("SELECT id FROM parties WHERE name = 'Partner Delta'").get().id;
db.prepare("INSERT INTO partner_capital (party_id, date, type, amount, mode) VALUES (?, '2083-06-05', 'contribution', 10000, 'cash')").run(partnerId);
db.prepare("INSERT INTO salary_records (employee_name, month, net_salary, payment_mode) VALUES ('Hari Bahadur', '2083-06', 20000, 'cash')").run();
console.log('  seeded: 4 parties, 1 product, 1 route, 1 rate, expenses, deposits, capital, salary');

console.log('\n═══ STEP 1: export to Excel ═══');
const exp = exportToDailyAccountExcel(db, XLSX_PATH);
check('export succeeded', exp.success, exp.error);

// ══ Helper: read a cell from a sheet ══
function readCell(sheetName, rowIdx, colIdx) {
    const wb = XLSX.readFile(XLSX_PATH);
    const ws = wb.Sheets[sheetName];
    if (!ws) return undefined;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return (data[rowIdx] || [])[colIdx];
}
function writeCell(sheetName, rowIdx, colIdx, value) {
    const wb = XLSX.readFile(XLSX_PATH);
    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    while (data.length <= rowIdx) data.push([]);
    while ((data[rowIdx] || []).length <= colIdx) data[rowIdx].push('');
    data[rowIdx][colIdx] = value;
    const newWs = XLSX.utils.aoa_to_sheet(data);
    wb.Sheets[sheetName] = newWs;
    XLSX.writeFile(wb, XLSX_PATH);
}
function sheetExists(name) {
    const wb = XLSX.readFile(XLSX_PATH);
    return wb.SheetNames.includes(name);
}

console.log('\n═══ STEP 2: edit the workbook ═══');
// Find the editable row indexes by name (exporters put headers on row 1).
function findRow(sheetName, colIdx, value) {
    const wb = XLSX.readFile(XLSX_PATH);
    const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
    for (let i = 0; i < data.length; i++) {
        if (String((data[i] || [])[colIdx] || '').trim() === value) return i;
    }
    return -1;
}

// Party edit — Customer Alpha phone (Party_Master: name col 0, phone col 2)
const partyRow = findRow('Party_Master', 0, 'Customer Alpha');
check('party row found in Party_Master', partyRow > 0);
writeCell('Party_Master', partyRow, 2, '9811111111');

// Product edit — Mix Milk rate (Stock_Master: name col 0, rate col 7)
const prodRow = findRow('Stock_Master', 0, 'Mix Milk');
check('product row found in Stock_Master', prodRow > 0);
writeCell('Stock_Master', prodRow, 7, 90);

// Route edit — area
const routeRow = findRow('Routes', 0, 'Kirtipur Route');
check('route sheet + row present', routeRow > 0);
writeCell('Routes', routeRow, 1, 'South-West');

// Farmer master edit (master data must sync for every party type)
const farmerRow = findRow('Party_Master', 0, 'Farmer Gamma');
check('farmer row found', farmerRow > 0);
writeCell('Party_Master', farmerRow, 4, 'Pharping South');

// Supplier edit
const supplierRow = findRow('Party_Master', 0, 'Supplier Beta');
check('supplier row found', supplierRow > 0);
writeCell('Party_Master', supplierRow, 2, '9822222222');

// Partner edit
const partnerRow = findRow('Party_Master', 0, 'Partner Delta');
check('partner row found', partnerRow > 0);
writeCell('Party_Master', partnerRow, 2, '9833333333');

console.log('\n═══ STEP 3: import the edited workbook (upsert) ═══');
const results = runExcelImport(db, XLSX_PATH, { mode: 'upsert', log: () => {} });

console.log('\n═══ STEP 4: verify the database actually changed ═══');
const alpha = db.prepare("SELECT phone, address FROM parties WHERE name = 'Customer Alpha'").get();
check('customer phone updated in DB', alpha && alpha.phone === '9811111111', JSON.stringify(alpha));

const beta = db.prepare("SELECT phone FROM parties WHERE name = 'Supplier Beta'").get();
check('supplier phone updated in DB', beta && beta.phone === '9822222222', JSON.stringify(beta));

const gamma = db.prepare("SELECT address FROM parties WHERE name = 'Farmer Gamma'").get();
check('farmer address updated in DB', gamma && gamma.address === 'Pharping South', JSON.stringify(gamma));

const delta = db.prepare("SELECT phone FROM parties WHERE name = 'Partner Delta'").get();
check('partner phone updated in DB', delta && delta.phone === '9833333333', JSON.stringify(delta));

const mix = db.prepare("SELECT rate FROM products WHERE name = 'Mix Milk'").get();
check('product rate updated in DB', mix && Number(mix.rate) === 90, JSON.stringify(mix));

const route = db.prepare("SELECT area FROM routes WHERE name = 'Kirtipur Route'").get();
check('route area updated in DB', route && route.area === 'South-West', JSON.stringify(route));

// No duplicate parties were created
const partyCount = db.prepare("SELECT COUNT(*) c FROM parties").get().c;
check('no duplicate parties created', partyCount === 4, `count=${partyCount}`);

// Product count: the fresh DB seeds 4 default plant products (Mixed Milk,
// Cream, SMP, Water) via initDatabase; the import must not add more.
const prodCount = db.prepare("SELECT COUNT(*) c FROM products").get().c;
check('no duplicate products created', prodCount === 5, `count=${prodCount} (4 defaults + 1 imported)`);

console.log('\n═══ STEP 5: re-import the SAME file → all UNCHANGED ═══');
const results2 = runExcelImport(db, XLSX_PATH, { mode: 'upsert', log: () => {} });
const partiesRes = results2.parties || { added: 0, updated: 0, unchanged: 0 };
check('parties re-import: 0 added', partiesRes.added === 0, JSON.stringify(partiesRes));
check('parties re-import: 0 updated', partiesRes.updated === 0, JSON.stringify(partiesRes));
check('parties re-import: 4 unchanged', partiesRes.unchanged === 4, JSON.stringify(partiesRes));
const prodsRes = results2.products || { added: 0, updated: 0, unchanged: 0 };
check('products re-import: 0 added/updated', prodsRes.added === 0 && prodsRes.updated === 0, JSON.stringify(prodsRes));
const routesRes = results2.routes || { added: 0, updated: 0, unchanged: 0 };
check('routes re-import: 0 added/updated', routesRes.added === 0 && routesRes.updated === 0, JSON.stringify(routesRes));
if (results2.rateChart) {
    check('rate chart re-import: 0 added/updated', results2.rateChart.added === 0 && results2.rateChart.updated === 0, JSON.stringify(results2.rateChart));
}

const partyCount2 = db.prepare("SELECT COUNT(*) c FROM parties").get().c;
check('still exactly 4 parties after re-import', partyCount2 === 4, `count=${partyCount2}`);
const prodCount2 = db.prepare("SELECT COUNT(*) c FROM products").get().c;
check('still exactly 5 products after re-import (4 defaults + 1)', prodCount2 === 5, `count=${prodCount2}`);
const routeCount2 = db.prepare("SELECT COUNT(*) c FROM routes").get().c;
check('still exactly 1 route after re-import', routeCount2 === 1, `count=${routeCount2}`);

// Export again and verify the changed values survive the second export
console.log('\n═══ STEP 6: export again — changed values must appear ═══');
const exp2 = exportToDailyAccountExcel(db, XLSX_PATH);
check('second export succeeded', exp2.success, exp2.error);
check('exported customer phone matches DB', readCell('Party_Master', partyRow, 2) === '9811111111',
    `got=${readCell('Party_Master', partyRow, 2)}`);
check('exported product rate matches DB', Number(readCell('Stock_Master', prodRow, 7)) === 90,
    `got=${readCell('Stock_Master', prodRow, 7)}`);
check('exported route area matches DB', readCell('Routes', routeRow, 1) === 'South-West',
    `got=${readCell('Routes', routeRow, 1)}`);

db.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);

console.log('\n════════════════════════════════════════');
console.log(`ROUND-TRIP RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
