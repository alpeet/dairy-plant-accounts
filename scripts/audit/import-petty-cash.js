/**
 * Import the PETTY CASH register sheet into petty_cash, and post
 * "Advance" rows to party ledgers as advance payments (Task 8 + 9).
 * =====================================================
 * - Type "Payment" rows → petty_cash expense entries.
 * - Type "Advance" rows → petty_cash entry + 'advance' payment + ledger entry
 *   against the party matched by exact name (unmatched reported).
 * - Type "Collection" rows → skipped: they duplicate the Collection sheet
 *   which already produced payments/ledger entries.
 * - Idempotent: existing petty_cash rows (date+amount+paid_to+head) and
 *   existing advance payments (party+date+amount+ref) are skipped.
 *
 * Usage: node scripts/audit/import-petty-cash.js [dbPath]
 */

const path = require('path');
const XLSX = require('xlsx');
const { openDatabase, runMigrations } = require(path.join(__dirname, '..', '..', 'shared', 'db.js'));
const ops = require(path.join(__dirname, '..', '..', 'shared', 'operations', 'index.js'));
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

const wb = XLSX.readFile(excelPath);
const sheet = XLSX.utils.sheet_to_json(wb.Sheets['PETTY CASH'], { header: 1, defval: '' });

const db = openDatabase(dbPath);
runMigrations(db);

const partyByName = {};
for (const p of db.prepare('SELECT id, name FROM parties WHERE archived = 0').all()) {
    partyByName[String(p.name).trim().toLowerCase()] = p.id;
}

const existingPC = new Set(
    db.prepare("SELECT date, amount, paid_to, expense_head FROM petty_cash").all()
        .map(r => `${r.date}|${Math.round(r.amount * 100)}|${(r.paid_to || '').trim().toLowerCase()}|${(r.expense_head || '').trim().toLowerCase()}`)
);
// Advance postings dedup against the LEDGER itself (single source of truth):
// the Salary Advance sheet, the PETTY CASH register, and the Party_Ledger sheet
// all record the same advances under different reference strings, and some were
// already posted as payment_received rows by the fresh import.
const existingAdv = new Set(
    db.prepare("SELECT date, party_id, debit FROM ledger_entries WHERE debit > 0").all()
        .map(r => `${r.date}|${r.party_id}|${Math.round(r.debit * 100)}`)
);

const insertPC = db.prepare(`
    INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, payment_mode, remarks, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertPay = db.prepare(`
    INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes, created_by)
    VALUES (?, ?, 'advance', ?, ?, ?, ?, NULL)
`);
const insertLedger = db.prepare(`
    INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
    VALUES (?, ?, 'advance', ?, ?, ?, 0, 0)
`);

const report = { payment: 0, advance: 0, collection_skipped: 0, unmatched: [], dup_skipped: 0, after_cutoff: 0, undated: 0 };
let seq = db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(voucher_no, 4) AS INTEGER)), 0) m FROM petty_cash').get().m;

for (let i = 2; i < sheet.length; i++) {
    const r = sheet[i];
    if (!r) continue;
    const date = normDate(r[0]).replace(/\//g, '-');
    const type = String(r[6] || '').trim();
    if (!date) { if (r.some(x => String(x).trim() !== '')) report.undated++; continue; }
    if (date > CUTOFF) { report.after_cutoff++; continue; }

    const receiptNo = String(r[2] || '').trim();
    const customer = String(r[3] || '').trim();
    const desc = String(r[5] || '').trim();
    const collected = parseFloat(r[8]) || 0;
    const paid = parseFloat(r[9]) || 0;
    const mode = String(r[10] || 'Cash').trim();
    const payMode = mode.toLowerCase().includes('bank') ? 'bank' : mode.toLowerCase().includes('upi') ? 'upi' : 'cash';

    if (type === 'Collection') { report.collection_skipped++; continue; }
    if (type === 'Payment' && paid > 0) {
        const key = `${date}|${Math.round(paid * 100)}|${customer.toLowerCase()}|payment`;
        if (existingPC.has(key)) { report.dup_skipped++; continue; }
        seq++;
        const voucher = receiptNo || `PC-${String(seq).padStart(4, '0')}`;
        insertPC.run(voucher, date, 'Payment', desc, paid, customer, payMode, '', '');
        existingPC.add(key);
        report.payment++;
    } else if (type === 'Advance' && paid > 0) {
        const pid = partyByName[customer.trim().toLowerCase()];
        const pcKey = `${date}|${Math.round(paid * 100)}|${customer.toLowerCase()}|advance`;
        seq++;
        const voucher = receiptNo || `PC-${String(seq).padStart(4, '0')}`;
        // The register always records the advance; the ledger posting is deduped
        // against advance payments already created (e.g. from the Salary Advance sheet).
        let pcInserted = false;
        if (!existingPC.has(pcKey)) {
            insertPC.run(voucher, date, 'Advance', desc || 'Advance paid', paid, customer, payMode, '', '');
            existingPC.add(pcKey);
            pcInserted = true;
        }
        if (pid && existingAdv.has(`${date}|${pid}|${Math.round(paid * 100)}`)) {
            report.dup_skipped++;
            continue;
        }
        if (pcInserted) report.advance++;
        if (pid) {
            const info = insertPay.run(pid, date, paid, payMode, receiptNo || '', `Advance: ${desc || customer}`);
            insertLedger.run(pid, date, info.lastInsertRowid, `Advance: ${desc || customer}`, paid);
            existingAdv.add(`${date}|${pid}|${Math.round(paid * 100)}`);
        } else {
            report.unmatched.push(`${date} | ${customer} | ${paid} | ${desc}`);
        }
    }
}

console.log('=== PETTY CASH IMPORT REPORT ===');
console.log('Payment rows imported into petty_cash:', report.payment);
console.log('Advance rows imported (petty_cash + party ledger):', report.advance);
console.log('Collection rows skipped (duplicate of Collection sheet):', report.collection_skipped);
console.log('Skipped (already present):', report.dup_skipped);
console.log('After cutoff (not imported):', report.after_cutoff);
console.log('Undated rows (skipped):', report.undated);
console.log('Advances without an exact party match (' + report.unmatched.length + '):');
for (const u of report.unmatched) console.log('  ', u);
db.close();