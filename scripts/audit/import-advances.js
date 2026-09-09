/**
 * Import the Salary Advance sheet into advance payments + ledger entries.
 * =====================================================
 * - Header at row 2, data from row 3.
 * - Columns: Date, [AD], Voucher No, Employee ID, Employee Name, Department,
 *            Description, Advance Amount, SALARY PAYMENT, BALANCE, Payment Mode, Approved By
 * - Employee name is matched to an existing party by exact name after stripping
 *   parenthetical suffixes (e.g. "NAR BAHADUR RANA (DRIVER)" → "NAR BAHADUR RANA").
 * - Creates: payments.type='advance' (reference = voucher no) + ledger entry
 *   reference_type='advance' (debit = advance amount).
 * - Idempotent: skipped when the same (party, date, amount, voucher) already exists.
 *
 * Usage: node scripts/audit/import-advances.js [dbPath]
 */

const path = require('path');
const XLSX = require('xlsx');
const { openDatabase, runMigrations } = require(path.join(__dirname, '..', '..', 'shared', 'db.js'));
const { toBSDate } = require(path.join(__dirname, '..', '..', 'shared', 'excel-import.js'));

const ROOT = path.join(__dirname, '..', '..');
const dbPath = process.argv[2] || path.join(ROOT, 'data', 'dairy-plant.db');
const excelPath = process.argv[3] || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const CUTOFF = '2083/05/18';

function normDate(v) {
    if (v === undefined || v === null || v === '') return '';
    if (typeof v === 'number') {
        if (v >= 58000) return toBSDate(v);
        return '';
    }
    return String(v).trim().replace(/-/g, '/');
}
function stripSuffix(name) {
    return String(name || '').replace(/\s*\(.*?\)\s*$/, '').trim();
}

const wb = XLSX.readFile(excelPath);
const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Salary Advance'], { header: 1, defval: '' });

const db = openDatabase(dbPath);
runMigrations(db);

const partyByName = {};
for (const p of db.prepare('SELECT id, name FROM parties WHERE archived = 0').all()) {
    partyByName[String(p.name).trim().toLowerCase()] = p.id;
}

// Dedup against the LEDGER itself: the Salary Advance sheet, the PETTY CASH register,
// and the Party_Ledger sheet record the same advances under different references.
const existing = new Set(
    db.prepare("SELECT date, party_id, debit FROM ledger_entries WHERE debit > 0").all()
        .map(r => `${r.date}|${r.party_id}|${Math.round(r.debit * 100)}`)
);

const insertPay = db.prepare(`
    INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes, created_by)
    VALUES (?, ?, 'advance', ?, ?, ?, ?, NULL)
`);
const insertLedger = db.prepare(`
    INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
    VALUES (?, ?, 'advance', ?, ?, ?, 0, 0)
`);

const report = { read: 0, imported: 0, skipped_dup: 0, after_cutoff: 0, unmatched: [] };

for (let i = 3; i < sheet.length; i++) {
    const r = sheet[i];
    if (!r) continue;
    const date = normDate(r[0]).replace(/\//g, '-');
    if (!date) continue;
    report.read++;
    if (date > CUTOFF) { report.after_cutoff++; continue; }

    const voucher = String(r[2] || '').trim();
    const empName = String(r[4] || '').trim();
    const empId = String(r[3] || '').trim();
    const amount = parseFloat(r[7]) || 0;
    const mode = String(r[10] || 'CASH').trim();
    const approvedBy = String(r[11] || '').trim();
    if (amount <= 0) continue;

    const pid = partyByName[stripSuffix(empName).toLowerCase()];
    if (pid && existing.has(`${date}|${pid}|${Math.round(amount * 100)}`)) { report.skipped_dup++; continue; }

    const payMode = mode.toLowerCase().includes('bank') ? 'bank' : mode.toLowerCase().includes('upi') ? 'upi' : 'cash';
    if (pid) {
        const info = insertPay.run(pid, date, amount, payMode, voucher || '', `Salary advance ${voucher} (${empId}) approved by ${approvedBy}`.trim());
        insertLedger.run(pid, date, info.lastInsertRowid, `Salary advance ${voucher} (${empId})`, amount);
        existing.add(`${date}|${pid}|${Math.round(amount * 100)}`);
        report.imported++;
    } else {
        report.unmatched.push(`${date} | ${voucher || ''} | ${empName} (${empId}) | ${amount}`);
    }
}

console.log('=== SALARY ADVANCE IMPORT REPORT ===');
console.log('Rows read:', report.read);
console.log('Imported as advance payments + ledger entries:', report.imported);
console.log('Skipped (already present):', report.skipped_dup);
console.log('After cutoff (not imported):', report.after_cutoff);
console.log('Unmatched employee → party (' + report.unmatched.length + '):');
for (const u of report.unmatched) console.log('  ', u);
db.close();