#!/usr/bin/env node
/**
 * FIX — Excel `Stock_Statement` TOTALS row double-counts the subtotal row
 * =====================================================================
 * The workbook lists the products, inserts a group SUBTOTAL row, then a TOTALS
 * row whose formula is `=SUM(D9:D23)`. That range INCLUDES the subtotal row
 * (row 12 = `=SUM(D9:D11)`), so the first product group is counted twice:
 *
 *     Purchases In   1421.20 = 2 × 710.60      (the "missing 710.60 L")
 *     Sales Out       972.00 vs 488.00
 *     Closing         449.20 vs 222.60
 *
 * No hidden transactions, duplicates or date-filter errors — the whole gap is
 * the TOTALS range overlapping the subtotal row. `Closing Value` (H24) is NOT
 * doubled, because the subtotal row carries no H12 formula.
 *
 * IMPORTANT — this script patches ONLY the Stock_Statement sheet XML inside the
 * .xlsx zip (`unzip -p` → edit → `zip`), so every other sheet, every style and
 * every other cell is left byte-for-byte untouched. Re-writing the whole
 * workbook with the community xlsx writer would strip the workbook's formatting.
 *
 * Usage:
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/fix-stock-statement-totals.js            # dry run
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/fix-stock-statement-totals.js --apply    # write (Excel closed)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const XLSX_PATH = process.argv.find((a) => a.endsWith('.xlsx')) || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const APPLY = process.argv.includes('--apply');
const SHEET = 'Stock_Statement';
const EPS = 0.005;

// ── Guard: never write while Excel holds the workbook open ──────────────
const lock = path.join(path.dirname(XLSX_PATH), '~$' + path.basename(XLSX_PATH));
if (APPLY && fs.existsSync(lock)) {
    console.error(`\n✋ Refusing to write: ${path.basename(XLSX_PATH)} is OPEN in Excel (found ${path.basename(lock)}).`);
    console.error('   Close the workbook, then re-run with --apply.\n');
    process.exit(2);
}

// ── 1. Read the sheet to classify rows and compute the correct totals ───
const wb = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`Sheet "${SHEET}" not found.`); process.exit(1); }
const sheetNamesBefore = wb.SheetNames.slice();

const cellVal = (col, r) => (ws[col + r] ? ws[col + r].v : undefined);

let headerRow = null, totalsRow = null;
for (let r = 1; r <= 300; r++) {
    const a = String(cellVal('A', r) || '');
    const b = String(cellVal('B', r) || '');
    if (!headerRow && a === 'Product' && b === 'Unit') headerRow = r;
    if (b.toUpperCase().includes('TOTAL')) totalsRow = r;
}
if (!headerRow || !totalsRow) { console.error('Could not locate the header / TOTALS row.'); process.exit(1); }

// Classify each row by the SHAPE of its formula, not just by whether the
// product name is filled in:
//   • a product slot  → its D formula is a SUMIFS over the entry sheet (it is a
//     real product row whose name happens to be blank right now, e.g. when the
//     matching Stock_Master row is empty). It MUST stay in the TOTALS.
//   • a subtotal row  → its D formula is a bare SUM of same-column cells above
//     it (`SUM(D9:D11)`). It MUST be excluded, or the total double-counts.
const productRows = [];
const subtotalRows = [];
const blankRows = [];
for (let r = headerRow + 1; r < totalsRow; r++) {
    const a = String(cellVal('A', r) || '').trim();
    const dFormula = (ws['D' + r] && ws['D' + r].f) ? String(ws['D' + r].f) : '';
    const isSubtotal = /^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/i.test(dFormula.trim());
    const isProductSlot = a !== '' || /SUMIFS?\s*\(/i.test(dFormula);
    if (isSubtotal) subtotalRows.push(r);
    else if (isProductSlot) productRows.push(r);
    else blankRows.push(r);
}

/** Compress [9,10,11,13,14,…] into "D9:D11,D13:D17" for a readable formula. */
function rangesFor(col, rows) {
    const parts = [];
    let start = null, prev = null;
    for (const r of rows) {
        if (start === null) { start = r; prev = r; continue; }
        if (r === prev + 1) { prev = r; continue; }
        parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
        start = r; prev = r;
    }
    if (start !== null) parts.push(start === prev ? `${col}${start}` : `${col}${start}:${col}${prev}`);
    return parts.join(',');
}

console.log(`\n${SHEET}: header row ${headerRow}, TOTALS row ${totalsRow}`);
console.log(`  product rows : ${productRows.join(', ')}`);
console.log(`  subtotal rows: ${subtotalRows.join(', ') || '(none)'}  ← excluded from TOTALS`);
if (blankRows.length) console.log(`  skipped rows : ${blankRows.join(', ')} (no product name and no formula)`);

const cols = ['C', 'D', 'E', 'F'];
const names = { C: 'Opening', D: 'Purchases In', E: 'Sales Out', F: 'Closing' };
const before = {}, after = {}, newFormula = {};
for (const col of cols) {
    before[col] = cellVal(col, totalsRow);
    let sum = 0;
    for (const r of productRows) {
        const v = cellVal(col, r);
        if (typeof v === 'number') sum += v;
    }
    after[col] = Math.round((sum + Number.EPSILON) * 100) / 100;
    newFormula[col] = `SUM(${rangesFor(col, productRows)})`;
}

console.log('\n  column          current      corrected    new formula');
for (const col of cols) {
    console.log(`  ${names[col].padEnd(14)} ${String(before[col]).padEnd(12)} ${String(after[col]).padEnd(12)} =${newFormula[col]}`);
}
// Patch every TOTALS formula whose text differs from the corrected one — this
// also normalises a column whose value happens to be unaffected (e.g. Opening),
// so a later subtotal edit can never leak back into the total.
const fixCols = cols.filter((c) => {
    const cur = ws[c + totalsRow] ? ws[c + totalsRow].f : undefined;
    return cur !== newFormula[c];
});
const valueChanged = cols.filter((c) => typeof before[c] !== 'number' || Math.abs(before[c] - after[c]) > EPS);
if (!fixCols.length) { console.log('\nTOTALS already excludes the subtotal row — nothing to do.\n'); process.exit(0); }

if (!APPLY) {
    console.log(`\nDRY RUN — nothing written.`);
    console.log(`columns whose formula changes : ${fixCols.join(', ')}`);
    console.log(`columns whose value changes   : ${valueChanged.join(', ') || '(none)'}`);
    console.log('Re-run with --apply (Excel closed) to write the fix.\n');
    process.exit(0);
}

// ── 2. Back up ──────────────────────────────────────────────────────────
const backupDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `Dairy_Accounts_Professional.xlsx.bak-stockstatement-${stamp}`);
fs.copyFileSync(XLSX_PATH, backup);
console.log(`\n  💾 backup: ${backup}`);

// ── 3. Resolve the sheet's XML part ─────────────────────────────────────
const unzip = (entry) => execFileSync('unzip', ['-p', XLSX_PATH, entry], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
const wbXml = unzip('xl/workbook.xml');
const relsXml = unzip('xl/_rels/workbook.xml.rels');
const relTarget = {};
for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget[m[1]] = m[2];
let sheetPart = null;
for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    if (m[1] === SHEET) sheetPart = 'xl/' + relTarget[m[2]].replace(/^\/?xl\//, '');
}
if (!sheetPart) { console.error('Could not resolve the sheet XML part.'); process.exit(1); }
console.log(`  🧩 sheet part: ${sheetPart}`);

// ── 4. Patch just the TOTALS row's C/D/E/F formulas + cached values ─────
let xml = unzip(sheetPart);
const xmlBefore = xml;
const rowRe = new RegExp(`(<row r="${totalsRow}"[^>]*>)([\\s\\S]*?)(</row>)`);
const rowMatch = xml.match(rowRe);
if (!rowMatch) { console.error(`Row ${totalsRow} not found in ${sheetPart}.`); process.exit(1); }
let inner = rowMatch[2];
for (const col of fixCols) {
    const cellRe = new RegExp(`(<c r="${col}${totalsRow}"[^>]*>)([\\s\\S]*?)(</c>)`);
    const cm = inner.match(cellRe);
    if (!cm) continue;
    const patched = `${cm[1]}<f>${newFormula[col]}</f><v>${after[col]}</v>${cm[3]}`;
    inner = inner.replace(cellRe, patched);
}
xml = xml.replace(rowRe, `${rowMatch[1]}${inner}${rowMatch[3]}`);
if (xml === xmlBefore) { console.error('Patch produced no change — aborting.'); process.exit(1); }

// ── 5. Repack ONLY that entry, leaving every other part byte-identical ──
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-patch-'));
try {
    const dest = path.join(stage, sheetPart);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, xml, 'utf8');
    execFileSync('zip', ['-X', XLSX_PATH, sheetPart], { cwd: stage, stdio: 'pipe' });
} finally {
    fs.rmSync(stage, { recursive: true, force: true });
}

// ── 6. Verify: same sheets, correct totals, identity holds ──────────────
const check = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const cws = check.Sheets[SHEET];
const sheetsSame = JSON.stringify(check.SheetNames) === JSON.stringify(sheetNamesBefore);
const problems = [];
if (!sheetsSame) problems.push('sheet list changed');
for (const col of cols) {
    const got = cws[col + totalsRow] ? cws[col + totalsRow].v : undefined;
    if (typeof got !== 'number' || Math.abs(got - after[col]) > EPS) problems.push(`${col}${totalsRow}=${got} expected ${after[col]}`);
}
// A corrected column must no longer show the doubled value it showed before.
for (const col of valueChanged) {
    const got = cws[col + totalsRow] ? cws[col + totalsRow].v : undefined;
    if (typeof got === 'number' && Math.abs(got - before[col]) < EPS) problems.push(`${col}${totalsRow} still shows the old doubled value ${before[col]}`);
}
// And the corrected TOTALS must equal the sum of the visible product rows.
for (const col of cols) {
    let sum = 0;
    for (let r = headerRow + 1; r < totalsRow; r++) {
        const a = String((cws['A' + r] ? cws['A' + r].v : '') || '').trim();
        const v = cws[col + r] ? cws[col + r].v : undefined;
        if (a && typeof v === 'number') sum += v;
    }
    if (Math.abs(Math.round((sum + Number.EPSILON) * 100) / 100 - after[col]) > EPS) problems.push(`${col} TOTALS does not equal the product-row sum`);
}

console.log('\n  ── verification ──');
console.log(`  sheets preserved : ${sheetsSame} (${check.SheetNames.length} sheets)`);
for (const col of cols) console.log(`  ${names[col].padEnd(14)} TOTALS after = ${cws[col + totalsRow] ? cws[col + totalsRow].v : '(none)'}  (was ${before[col]})`);
if (problems.length) {
    console.log(`\n  ❌ VERIFY FAILED: ${problems.join('; ')}`);
    console.log(`  Restore from backup: cp "${backup}" "${XLSX_PATH}"\n`);
    process.exit(1);
}
console.log('\n  ✅ TOTALS row now sums the product rows only. Open the workbook and confirm TOTALS = the visible product rows.\n');
