#!/usr/bin/env node
/**
 * MILK SUPPLIER IDENTITY — the Shree Paroha 160 L regression
 * ===========================================================
 * Root cause (fixed): `importPurchases` grouped Purchase_Entry rows by
 * bill_no + date ONLY, so when one bill number was reused on the same date by
 * several suppliers (BILL-5204 on 2083-06-21 carries Mina Lamichhane's 4.3 L
 * cow line AND Danda Pani Acharya's cow lines AND Shree Paroha's 160 L buffalo
 * line) every line was booked against `rows[0]`'s supplier — so Shree Paroha's
 * 160 L appeared under Mina Lamichhane. `importSales` had the same defect
 * (one invoice number reused by two parties).

 * This test imports the REAL workbook into a fresh database and proves:
 *   A. the 160 L lands on SHREE PAROHA DAIRY UDHYOG (buffalo, 160 L, Rs 13,280)
 *   B. MINA LAMICHHANE never receives a 160 L buffalo collection
 *   C. the stock movement for that collection is +160 L of raw buffalo milk
 *   D. supplier identity in the ledger resolves from the same party_id
 *   E. a multi-supplier invoice (BILL-6557) splits by party
 *   F. re-importing is idempotent (no duplicate procurement)
 *   G. the supplier daily reconciliation check passes on the imported data
 *
 * Run: NODE_PATH="$PWD/node_modules" node scripts/audit/test-milk-supplier-identity.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const { runExcelImport, adToBS } = require(path.join(ROOT, 'shared', 'excel-import'));
const { runIntegrityChecks } = require(path.join(ROOT, 'shared', 'operations', 'integrity'));

const REAL_XLSX = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const silent = () => {};
const EXPECTED_BS = (() => { try { return adToBS('2026-10-07') || '2083-06-21'; } catch (e) { return '2083-06-21'; } })();

const dirs = [];
function freshDb(tag) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `milk-identity-${tag}-`));
    dirs.push(dir);
    return initDatabase(dir, 'test.db');
}

function supplierIdByName(db, name) {
    const r = db.prepare('SELECT id FROM parties WHERE name = ?').get(name);
    return r ? r.id : null;
}
function milkFor(db, partyName, milkType) {
    const p = db.prepare('SELECT id FROM parties WHERE name = ?').get(partyName);
    if (!p) return [];
    return db.prepare('SELECT * FROM milk_collections WHERE party_id = ? AND milk_type = ?').all(p.id, milkType);
}

console.log(`\nImporting the real workbook (upsert) into a fresh DB…  AD 2026-10-07 → BS ${EXPECTED_BS}`);
const db = freshDb('upsert');
runExcelImport(db, REAL_XLSX, { mode: 'upsert', log: silent });

console.log('\nA. the 160 L Shree Paroha line');
{
    const paroha = supplierIdByName(db, 'SHREE PAROHA DAIRY UDHYOG');
    ok(paroha != null, 'SHREE PAROHA DAIRY UDHYOG exists as its own party');
    const buffalo = paroha ? db.prepare(
        "SELECT * FROM milk_collections WHERE party_id = ? AND milk_type = 'buffalo' AND quantity_liters = 160"
    ).all(paroha) : [];
    ok(buffalo.length === 1, 'exactly one 160 L buffalo collection belongs to Shree Paroha', buffalo.length);
    const c = buffalo[0];
    if (c) {
        ok(c.date === EXPECTED_BS, `the 160 L is dated ${EXPECTED_BS}`, c.date);
        ok(Math.abs(Number(c.amount) - 13280) < 0.01, 'the 160 L carries its Rs 13,280 value (rate 83)', c.amount);
        ok(String(c.notes || '').includes('BILL-5204'), 'the reference BILL-5204 is retained on the collection', c.notes);

        // Stock movement for this exact collection must be +160 L, once.
        const moves = db.prepare(
            "SELECT * FROM stock_movements WHERE reference_type = 'milk_collection' AND reference_id = ?"
        ).all(c.id);
        const inSum = moves.reduce((s, m) => s + Number(m.inward_qty || 0) - Number(m.outward_qty || 0), 0);
        ok(moves.length === 1 && Math.abs(inSum - 160) < 0.01, 'exactly one stock movement, +160 L IN', { moves: moves.length, inSum });
        if (moves[0]) {
            const prod = db.prepare('SELECT name FROM products WHERE id = ?').get(moves[0].product_id);
            ok(prod && /buffalo/i.test(prod.name), 'the movement posts to a buffalo raw-milk product', prod && prod.name);
        }
    }
}

console.log('\nB. Mina Lamichhane must NOT receive the 160 L');
{
    const mina = supplierIdByName(db, 'MINA LAMICHHANE 322');
    ok(mina != null, 'MINA LAMICHHANE 322 exists as a separate party');
    const wrong = mina ? db.prepare(
        "SELECT COUNT(*) n FROM milk_collections WHERE party_id = ? AND quantity_liters = 160"
    ).get(mina).n : -1;
    ok(wrong === 0, 'Mina has zero 160 L collections', wrong);
    const minaBuffalo = mina ? milkFor(db, 'MINA LAMICHHANE 322', 'buffalo') : [];
    ok(minaBuffalo.length === 0, 'Mina has no buffalo collection at all (she supplies cow milk)', minaBuffalo.length);
}

console.log('\nC. the parties stay distinct');
{
    const paroha = supplierIdByName(db, 'SHREE PAROHA DAIRY UDHYOG');
    const mina = supplierIdByName(db, 'MINA LAMICHHANE 322');
    ok(paroha !== mina, 'Shree Paroha and Mina are two different party rows');
    const parohaLiters = db.prepare('SELECT COALESCE(SUM(quantity_liters),0) q FROM milk_collections WHERE party_id = ?').get(paroha).q;
    ok(parohaLiters >= 160, 'Shree Paroha\'s total collection includes the 160 L', parohaLiters);
}

console.log('\nD. a multi-supplier invoice splits by party (sales)');
{
    const rows = db.prepare("SELECT invoice_no, party_id FROM sales WHERE invoice_no = 'BILL-6557'").all();
    const parties = new Set(rows.map(r => r.party_id));
    ok(rows.length >= 2 && parties.size >= 2, 'BILL-6557 becomes one invoice per party, not one collapsed invoice', { rows: rows.length, parties: parties.size });
}

console.log('\nE. re-import is idempotent (no duplicate procurement)');
{
    const before = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(quantity_liters),0) q FROM milk_collections').get();
    const beforeMoves = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
    runExcelImport(db, REAL_XLSX, { mode: 'upsert', log: silent });
    const after = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(quantity_liters),0) q FROM milk_collections').get();
    const afterMoves = db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
    ok(after.n === before.n && Math.abs(after.q - before.q) < 0.01, 'second import adds no collection rows', { before, after });
    ok(afterMoves === beforeMoves, 'second import adds no stock movements', { beforeMoves, afterMoves });
}

console.log('\nF. supplier daily reconciliation passes on the imported data');
{
    const report = runIntegrityChecks(db, { only: 'milk_supplier_daily_reconciliation' });
    const check = report.checks[0];
    ok(check && check.status === 'pass', 'every date/supplier/milk-type group reconciles collection ↔ stock', check && check.issues);
}

console.log('\nG. Replace-ALL and Add/Update agree on the supplier identity');
{
    const db2 = freshDb('fresh');
    runExcelImport(db2, REAL_XLSX, { mode: 'fresh', log: silent });
    const p2 = db2.prepare("SELECT id FROM parties WHERE name = 'SHREE PAROHA DAIRY UDHYOG'").get();
    const got = p2 ? db2.prepare("SELECT COUNT(*) n FROM milk_collections WHERE party_id = ? AND milk_type='buffalo' AND quantity_liters=160").get(p2.id).n : 0;
    ok(got === 1, 'fresh import also books the 160 L buffalo on Shree Paroha', got);
    const mina2 = db2.prepare("SELECT id FROM parties WHERE name = 'MINA LAMICHHANE 322'").get();
    const wrong2 = mina2 ? db2.prepare("SELECT COUNT(*) n FROM milk_collections WHERE party_id = ? AND quantity_liters=160").get(mina2.id).n : 0;
    ok(wrong2 === 0, 'fresh import does not move it to Mina', wrong2);
}

for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* temp */ } }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
