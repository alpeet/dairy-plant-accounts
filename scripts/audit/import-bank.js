/**
 * Import the BANK RECON sheet from Dairy_Accounts_Professional.xlsx
 * into the new bank_transactions table (with party auto-match + review queue).
 * =====================================================
 * - Reads the BANK RECON sheet (header at row 2, data from row 3).
 * - Skips rows dated after the audit cutoff (2083/05/18).
 * - Idempotent: skips rows whose reference_no already exists.
 * - Exact party-name matches auto-post to the ledger (idempotent —
 *   rows the ledger already reflects are marked, not double-posted).
 * - Near/unmatched names land in the "Needs Review" queue.
 *
 * Usage: node scripts/audit/import-bank.js [dbPath]
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
const sheet = XLSX.utils.sheet_to_json(wb.Sheets['BANK RECON'], { header: 1, defval: '' });

const rows = [];
let afterCutoff = 0, empty = 0;
for (let i = 3; i < sheet.length; i++) {
    const r = sheet[i];
    if (!r) continue;
    const rawDate = r[0];
    const counterparty = String(r[3] || '').trim();
    const desc = String(r[4] || '').trim();
    const date = normDate(rawDate).replace(/\//g, '-');
    if (!date) { if (counterparty || desc) empty++; continue; }
    if (date > CUTOFF) { afterCutoff++; continue; }
    const debit = parseFloat(r[6]) || 0;
    const credit = parseFloat(r[7]) || 0;
    rows.push({
        date,
        reference_no: String(r[2] || '').trim(),
        counterparty_name: counterparty,
        description: desc,
        debit,
        credit,
        payment_mode: String(r[9] || 'QR/Bank').trim(),
        bank_account: String(r[10] || 'Sushil QR').trim(),
        txn_type: String(r[11] || '').trim()
    });
}

const db = openDatabase(dbPath);
runMigrations(db);
ops.ensureBankTable(db);

const report = ops.importBankRows(db, rows);
console.log('=== BANK RECON IMPORT REPORT ===');
console.log('Rows read from Excel (within cutoff):', report.read);
console.log('Rows skipped (already imported):', report.skipped_dup);
console.log('Rows after cutoff (not imported):', afterCutoff);
console.log('Rows with data but no usable date (skipped):', empty);
console.log('Rows inserted:', report.inserted);
console.log('  → auto-posted new ledger entries:', report.auto_posted);
console.log('  → already reflected in ledger (marked, not re-posted):', report.already_in_ledger);
console.log('  → sent to Needs Review queue:', report.review_queue);
console.log('  → unmatched (no counterparty):', report.unmatched);
if (report.errors.length) {
    console.log('Errors:');
    for (const e of report.errors) console.log('  ', JSON.stringify(e));
}

// Show the review queue
const queue = ops.getBankReviewQueue(db);
if (queue.length) {
    console.log('\n=== NEEDS REVIEW QUEUE (' + queue.length + ') ===');
    for (const q of queue) {
        console.log(`  ${q.date} ${q.reference_no || ''} ${q.counterparty_name || ''} ${q.description || ''} | Dr ${q.debit || 0} Cr ${q.credit || 0}`);
    }
}
db.close();