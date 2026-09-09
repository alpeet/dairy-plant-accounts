/**
 * Backfill Collection-sheet rows that were dropped during the fresh import
 * because the sheet's party name didn't match a party exactly.
 * =====================================================
 * Known case: "KALIKA CANTEEN A" (8 rows, ₹21,675) — matched to party
 * "A KALIKA CANTEEN" (id 306) because its collection amounts mirror 306's
 * sales on the same dates (7 of 8 exact). Creates:
 *   - payments.type='receipt' with reference_type = receipt no
 *   - ledger entry reference_type='payment_received' (credit)
 * Idempotent: rows already in payments are skipped.
 * Any OTHER unmatched collection rows are listed for manual review (not inserted).
 *
 * Usage: node scripts/audit/import-collections-fix.js [dbPath]
 */

const path = require('path');
const XLSX = require('xlsx');
const { openDatabase, runMigrations } = require(path.join(__dirname, '..', '..', 'shared', 'db.js'));
const { toBSDate } = require(path.join(__dirname, '..', '..', 'shared', 'excel-import.js'));

const ROOT = path.join(__dirname, '..', '..');
const dbPath = process.argv[2] || path.join(ROOT, 'data', 'dairy-plant.db');
const excelPath = process.argv[3] || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const CUTOFF = '2083/05/18';

// Documented name-variant mappings (sheet name → party id), verified against sales data.
const VARIANT_MAP = {
    'kalika canteen a': 306
};

function normDate(v) {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'number') {
        if (v >= 58000) return toBSDate(v);
        return '';
    }
    return String(v).trim().replace(/-/g, '/');
}

const wb = XLSX.readFile(excelPath);
const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Collection'], { header: 1, defval: '' });

const db = openDatabase(dbPath);
runMigrations(db);

const partyByName = {};
for (const p of db.prepare('SELECT id, name FROM parties WHERE archived = 0').all()) {
    partyByName[String(p.name).trim().toLowerCase()] = p.id;
}

// Dedup by (date, party, amount) — reference strings differ between pipelines
// (e.g. NAR BAHADUR RANA's 33000 exists as reference 'advance received').
const existingPays = new Set(
    db.prepare("SELECT date, party_id, amount FROM payments WHERE type = 'receipt'").all()
        .map(r => `${r.date}|${r.party_id}|${Math.round(r.amount * 100)}`)
);

const insertPay = db.prepare(`
    INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes, created_by)
    VALUES (?, ?, 'receipt', ?, 'cash', ?, ?, NULL)
`);
const insertLedger = db.prepare(`
    INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
    VALUES (?, ?, 'payment_received', ?, ?, 0, ?, 0)
`);

const report = { read: 0, inserted: 0, matched: 0, skipped_dup: 0, unmatched: [] };

for (let i = 2; i < sheet.length; i++) {
    const r = sheet[i];
    if (!r) continue;
    const date = normDate(r[0]).replace(/\//g, '-');
    if (!date) continue;
    if (date > CUTOFF) continue;
    const name = String(r[3] || '').trim();
    const amount = parseFloat(r[7]) || 0;
    const receipt = String(r[2] || '').trim();
    if (!name || amount <= 0) continue;
    report.read++;

    const pid = partyByName[name.toLowerCase()] || VARIANT_MAP[name.toLowerCase()] || null;
    if (pid && existingPays.has(`${date}|${pid}|${Math.round(amount * 100)}`)) { report.skipped_dup++; continue; }
    if (pid) {
        const info = insertPay.run(pid, date, amount, receipt || '', name);
        insertLedger.run(pid, date, info.lastInsertRowid, `Collection ${receipt ? '#' + receipt : ''} ${name}`.trim(), amount);
        existingPays.add(`${date}|${pid}|${Math.round(amount * 100)}`);
        report.inserted++;
        if (VARIANT_MAP[name.toLowerCase()] === pid && !partyByName[name.toLowerCase()]) report.matched++;
    } else {
        report.unmatched.push(`${date} | ${receipt || ''} | ${name} | ${amount}`);
    }
}

console.log('=== COLLECTION BACKFILL REPORT ===');
console.log('Collection rows read (within cutoff, with amount):', report.read);
console.log('Inserted (payments + ledger):', report.inserted, report.matched ? `(${report.matched} via name-variant map KALIKA CANTEEN A → A KALIKA CANTEEN #306)` : '');
console.log('Skipped (already in payments):', report.skipped_dup);
console.log('Unmatched — NOT inserted, needs manual review (' + report.unmatched.length + '):');
for (const u of report.unmatched) console.log('  ', u);
db.close();