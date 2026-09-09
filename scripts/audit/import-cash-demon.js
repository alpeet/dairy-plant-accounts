/**
 * Import the Cash_Demon sheet (physical cash denomination counts)
 * into denomination_counts, flagging discrepancies vs the app's own
 * calculated cash — never silently overwriting.
 * =====================================================
 * - Column map: Date, [AD], 1000, 500, 100, 50, 20, 10, 5, 2, 1, IC, Amount, Collections, Short/(Over), [Deposited], [blank], Remarks
 * - 2 → coin_2, 1 → coin_1, IC → note_other (value 0 — unvalued coinage)
 * - expected_cash = the app's own daily cash-in total (getDailyCashCollection);
 *   difference = counted − expected. Every non-zero difference is listed for review.
 * - Idempotent: dates already in denomination_counts are skipped.
 *
 * Usage: node scripts/audit/import-cash-demon.js [dbPath]
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
const sheet = XLSX.utils.sheet_to_json(wb.Sheets['Cash_Demon'], { header: 1, defval: '' });

const db = openDatabase(dbPath);
runMigrations(db);

const existing = new Set(db.prepare('SELECT date FROM denomination_counts').all().map(r => r.date));
const insert = db.prepare(`
    INSERT INTO denomination_counts
        (date, note_1000, note_500, note_100, note_50, note_20, note_10, note_5,
         note_other, note_other_value, coin_5, coin_2, coin_1, total_cash,
         expected_cash, difference, remarks, counted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let imported = 0, skipped = 0, afterCutoff = 0, undated = 0;
const discrepancies = [];

for (let i = 3; i < sheet.length; i++) {
    const r = sheet[i];
    if (!r) continue;
    const date = normDate(r[0]).replace(/\//g, '-');
    if (!date) { if (r.some(x => String(x).trim() !== '')) undated++; continue; }
    if (date > CUTOFF) { afterCutoff++; continue; }
    if (existing.has(date)) { skipped++; continue; }

    const n1000 = parseInt(r[2]) || 0, n500 = parseInt(r[3]) || 0, n100 = parseInt(r[4]) || 0,
        n50 = parseInt(r[5]) || 0, n20 = parseInt(r[6]) || 0, n10 = parseInt(r[7]) || 0,
        n5 = parseInt(r[8]) || 0, n2 = parseInt(r[9]) || 0, n1 = parseInt(r[10]) || 0,
        ic = parseInt(r[11]) || 0;

    const total = n1000 * 1000 + n500 * 500 + n100 * 100 + n50 * 50 + n20 * 20 + n10 * 10 + n5 * 5 + n2 * 2 + n1 * 1;
    const countedBy = String(r[17] || '').trim() || String(r[14] || '').trim();

    // App's own calculated daily cash-in for this date
    let expected = 0;
    try {
        const cash = ops.getDailyCashCollection(db, { from_date: date, to_date: date });
        const day = (cash.days || []).find(d => d.date === date);
        expected = day ? (day.total_cash_in || 0) : 0;
    } catch (e) { /* cash table may be empty */ }

    const difference = Math.round((total - expected) * 100) / 100;
    const sheetShort = parseFloat(r[14]) || 0;
    const remarks = sheetShort !== 0 ? `Excel short/(over): ${sheetShort}` : '';

    insert.run(date, n1000, n500, n100, n50, n20, n10, n5, ic, 0, 0, n2, n1,
        total, expected, difference, remarks, countedBy);
    imported++;
    existing.add(date);
    if (difference !== 0) {
        discrepancies.push({ date, counted: total, expected, difference, counted_by: countedBy, excel_short_over: sheetShort });
    }
}

console.log('=== CASH & DENOMINATION IMPORT REPORT ===');
console.log('Imported dates:', imported);
console.log('Skipped (already present):', skipped);
console.log('After cutoff (not imported):', afterCutoff);
console.log('Undated rows (skipped):', undated);
console.log(`Discrepancies (counted ≠ app expected): ${discrepancies.length}`);
for (const d of discrepancies.slice(0, 60)) {
    console.log(`  ${d.date} | counted ${d.counted} | app-expected ${d.expected} | diff ${d.difference} | by ${d.counted_by} | excel-short/over ${d.excel_short_over}`);
}
if (discrepancies.length > 60) console.log(`  ... and ${discrepancies.length - 60} more`);
db.close();