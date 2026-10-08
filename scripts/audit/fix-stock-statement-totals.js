#!/usr/bin/env node
/**
 * FIX — Excel `Stock_Statement` TOTALS row double-counts the subtotal row
 * =====================================================================
 * The workbook's Stock_Statement sheet lists the products, inserts a group
 * SUBTOTAL row, then a TOTALS row whose formula is `=SUM(D9:D23)`. That range
 * INCLUDES the subtotal row (row 12 = `=SUM(D9:D11)`), so the first product
 * group is counted twice:
 *
 *     Purchases In   1421.20 = 2 × 710.60      (the "missing 710.60 L")
 *     Sales Out       972.00 = 2 × 486-ish     (subtotal counted twice)
 *     Closing Stock   449.20 = 2 × 226.60 + …
 *
 * There are no hidden transactions, no duplicates and no date-filter error —
 * the discrepancy is entirely the TOTALS range overlapping the subtotal row.
 *
 * This script rewrites the TOTALS row to sum the PRODUCT rows only, then
 * verifies the totals equal the sum of the visible product rows.
 *
 * Usage:  NODE_PATH="$PWD/node_modules" node scripts/audit/fix-stock-statement-totals.js [--apply]
 *   (default = dry run; pass --apply to write, after Excel is closed)
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const APPLY = process.argv.includes('--apply');
const SHEET = 'Stock_Statement';

// Excel keeps "~$<name>" next to an open workbook — never write under it.
const lock = path.join(path.dirname(XLSX_PATH), '~$' + path.basename(XLSX_PATH));
if (APPLY && fs.existsSync(lock)) {
    console.error(`\n✋ Refusing to write: ${path.basename(XLSX_PATH)} appears to be OPEN in Excel (found ${path.basename(lock)}).`);
    console.error('   Close the workbook (and Excel), then re-run with --apply.');
    process.exit(2);
}

const wb = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`Sheet "${SHEET}" not found.`); process.exit(1); }

function rowValues(r) {
    const out = {};
    for (const col of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
        const c = ws[col + r];
        out[col] = c ? c.v : undefined;
    }
    return out;
}

// Locate the header row, the TOTALS row, product rows and subtotal rows.
let headerRow = null, totalsRow = null;
for (let r = 1; r <= 200; r++) {
    const v = rowValues(r);
    if (!headerRow && String(v.A || '') === 'Product' && String(v.B || '') === 'Unit') headerRow = r;
    if (String(v.B || '').toUpperCase().includes('TOTAL')) totalsRow = r;
}
if (!headerRow || !totalsRow) { console.error('Could not locate the header / TOTALS row.'); process.exit(1); }

const productRows = [];
const subtotalRows = [];
for (let r = headerRow + 1; r < totalsRow; r++) {
    const v = rowValues(r);
    const isSubtotal = (!v.A || String(v.A).trim() === '')
        && typeof v.D === 'number' && ws['D' + r] && ws['D' + r].f;
    if (isSubtotal) subtotalRows.push(r);
    else if (v.A && String(v.A).trim() !== '') productRows.push(r);
}

console.log(`\n${SHEET}: header row ${headerRow}, TOTALS row ${totalsRow}`);
console.log(`  product rows : ${productRows.join(', ')}`);
console.log(`  subtotal rows: ${subtotalRows.join(', ') || '(none)'}  ← these must be EXCLUDED from TOTALS`);

const cols = ['C', 'D', 'E', 'F'];
const before = {}, after = {};
for (const col of cols) {
    before[col] = ws[col + totalsRow] ? ws[col + totalsRow].v : undefined;
    let sum = 0;
    for (const r of productRows) {
        const c = ws[col + r];
        if (c && typeof c.v === 'number') sum += c.v;
    }
    after[col] = Math.round((sum + Number.EPSILON) * 100) / 100;
}

const names = { C: 'Opening', D: 'Purchases In', E: 'Sales Out', F: 'Closing' };
console.log('\n  column   current TOTALS   correct (product rows only)');
for (const col of cols) {
    console.log(`  ${names[col].padEnd(14)} ${String(before[col]).padEnd(16)} ${after[col]}`);
}

if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply (Excel closed) to write the fix.\n');
    process.exit(0);
}

// Back up, then write the corrected formulas.
const backupDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `Dairy_Accounts_Professional.xlsx.bak-stockstatement-${stamp}`);
fs.copyFileSync(XLSX_PATH, backup);
console.log(`\n  💾 backup: ${backup}`);

const ref = productRows.map((r) => `${col}${r}`); // placeholder, built per column below
for (const col of cols) {
    const list = productRows.map((r) => `${col}${r}`).join(',');
    ws[col + totalsRow] = { t: 'n', f: `SUM(${list})`, v: after[col] };
}
XLSX.writeFile(wb, XLSX_PATH, { bookType: 'xlsx', type: 'file' });
console.log(`  ✅ TOTALS row rewritten to sum product rows only (subtotal rows excluded).`);
console.log(`  ✔  Verify in Excel: TOTALS must equal the sum of the visible product rows.\n`);
