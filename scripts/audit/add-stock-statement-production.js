#!/usr/bin/env node
/**
 * ADD — "Production In" column to the Excel `Stock_Statement` sheet
 * ================================================================
 * The workbook records no mixing at all: milk is bought as Cow Milk / Buffalo
 * Milk, then sold as Mix Milk. So Mix Milk shows Purchases In 4,356 L against
 * Sales Out 41,201 L and a large negative closing (e.g. −483 L on 07-Oct-2026),
 * because the mixing that produced it is nowhere in the workbook.
 *
 * This script adds a **Production In** column (column I) so the sheet reads:
 *
 *   Product | Unit | Opening Stock | Purchases In | Sales Out |
 *   Closing Stock | Rate (Rs) | Closing Value | Production In
 *
 * • Mix Milk's production = the Cow + Buffalo milk purchased in the period
 *   (that milk is mixed into Mix Milk).
 * • Every other product's production is 0 (the workbook holds no other
 *   production data).
 * • Closing Stock becomes Opening + Purchases In + Production In − Sales Out,
 *   so Mix Milk reconciles instead of showing a spurious negative. Cow/Buffalo
 *   keep their own stock (the lighter model, chosen deliberately).
 *
 * IMPORTANT — it patches ONLY the Stock_Statement sheet XML (plus the workbook
 * print area and a "recalculate on open" flag) inside the .xlsx zip, so every
 * other sheet, style and cell is left byte-for-byte untouched. Shared formulas
 * are handled explicitly: a shared MASTER keeps its group attributes and only
 * its text is rewritten (members inherit it); a shared MEMBER is left alone and
 * only its cached value is refreshed.
 *
 * Usage:
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/add-stock-statement-production.js           # dry run
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/add-stock-statement-production.js --apply   # write (Excel closed)
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

const MIX_PRODUCT = 'Mix Milk';                            // the mixed-milk output
const MIX_SOURCES = ['Cow Milk', 'Buffalo Milk'];          // milk that gets mixed
const NEW_HEADER = 'Production In';
const EPS = 0.005;

const lock = path.join(path.dirname(XLSX_PATH), '~$' + path.basename(XLSX_PATH));
if (APPLY && fs.existsSync(lock)) {
    console.error(`\n✋ Refusing to write: ${path.basename(XLSX_PATH)} is OPEN in Excel (found ${path.basename(lock)}).`);
    console.error('   Close the workbook, then re-run with --apply.\n');
    process.exit(2);
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const val = (source, col, r) => { const c = source[col + r]; return c ? c.v : undefined; };

// ── 1. Read the workbook and classify its rows ──────────────────────────
const wb = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`Sheet "${SHEET}" not found.`); process.exit(1); }
const sheetsBefore = wb.SheetNames.slice();

let headerRow = null, totalsRow = null, dateRow = null;
for (let r = 1; r <= 300; r++) {
    const a = String(val(ws, 'A', r) || '');
    const b = String(val(ws, 'B', r) || '');
    if (!headerRow && a === 'Product' && b === 'Unit') headerRow = r;
    if (b.toUpperCase().includes('TOTAL')) totalsRow = r;
    if (/^From Date/.test(a) && dateRow === null) dateRow = r;
}
if (!headerRow || !totalsRow || !dateRow) { console.error('Could not locate the header / TOTALS / date row.'); process.exit(1); }
const fromAD = val(ws, 'B', dateRow), toAD = val(ws, 'D', dateRow);

const formulaOf = (col, r) => { const c = ws[col + r]; return c && c.f ? String(c.f) : ''; };
const isSubtotalRow = (r) => /^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/i.test(formulaOf('D', r).trim());

const productRows = [], blankRows = [], subtotalRows = [];
for (let r = headerRow + 1; r < totalsRow; r++) {
    if (isSubtotalRow(r)) { subtotalRows.push(r); continue; }
    const a = String(val(ws, 'A', r) || '').trim();
    if (a) productRows.push(r);
    else if (/SUMIFS?\s*\(/i.test(formulaOf('D', r))) blankRows.push(r);
}

// ── 2. Mixing production for the sheet's own period ─────────────────────
const pe = XLSX.utils.sheet_to_json(wb.Sheets['Purchase_Entry'], { header: 1, defval: '' });
let mixProduction = 0;
for (let i = 9; i < pe.length; i++) {                    // Purchase_Entry rows 10.. (1-based)
    const row = pe[i]; if (!row) continue;
    if (!MIX_SOURCES.includes(String(row[5] || '').trim())) continue;
    const ad = Number(row[1]);
    if (!Number.isFinite(ad)) continue;
    if (Number.isFinite(Number(fromAD)) && ad < Number(fromAD)) continue;
    if (Number.isFinite(Number(toAD)) && ad > Number(toAD)) continue;
    mixProduction += num(row[12]);
}
mixProduction = r2(mixProduction);

console.log(`\n${SHEET}: header ${headerRow}, TOTALS ${totalsRow}, period row ${dateRow} (AD ${fromAD} → ${toAD})`);
console.log(`  product rows : ${productRows.join(', ')}`);
console.log(`  subtotal rows: ${subtotalRows.join(', ') || '(none)'}`);
console.log(`  blank slots  : ${blankRows.join(', ') || '(none)'}`);
console.log(`  ${MIX_PRODUCT} production this period = ${mixProduction} (${MIX_SOURCES.join(' + ')})`);

// ── 3. Formulas + expected cached values ────────────────────────────────
const mixSumifs = (product) =>
    `SUMIFS(Purchase_Entry!$M$10:$M$1679,Purchase_Entry!$F$10:$F$1679,"${product}",` +
    `Purchase_Entry!$B$10:$B$1679,">="&$B$${dateRow},Purchase_Entry!$B$10:$B$1679,"<="&$D$${dateRow})`;
const productionFormula = (r) =>
    `IF($A${r}="","",IF($A${r}="${MIX_PRODUCT}",${MIX_SOURCES.map(mixSumifs).join('+')},0))`;
const closingFormula = (r) => `IF($A${r}="","",$C${r}+$D${r}-$E${r}+$I${r})`;

const iValue = {}, fValue = {};
for (const r of productRows) iValue[r] = String(val(ws, 'A', r) || '').trim() === MIX_PRODUCT ? mixProduction : 0;
for (const r of blankRows) iValue[r] = '';
for (const r of subtotalRows) iValue[r] = r2(productRows.filter((x) => x < r).reduce((s, x) => s + num(iValue[x]), 0));
iValue[totalsRow] = r2(productRows.reduce((s, x) => s + num(iValue[x]), 0));

for (const r of productRows) fValue[r] = r2(num(val(ws, 'C', r)) + num(val(ws, 'D', r)) + num(iValue[r]) - num(val(ws, 'E', r)));
for (const r of blankRows) fValue[r] = '';
for (const r of subtotalRows) fValue[r] = r2(productRows.filter((x) => x < r).reduce((s, x) => s + num(fValue[x]), 0));
fValue[totalsRow] = r2(productRows.reduce((s, x) => s + num(fValue[x]), 0));

const mixRow = productRows.find((r) => String(val(ws, 'A', r) || '').trim() === MIX_PRODUCT);
if (mixRow) {
    console.log(`\n  preview (${MIX_PRODUCT}, row ${mixRow}):`);
    console.log(`    I${mixRow} += ${productionFormula(mixRow)}`);
    console.log(`    → production ${iValue[mixRow]}`);
    console.log(`    F${mixRow}:  ${formulaOf('F', mixRow)}   ⇒   ${closingFormula(mixRow)}`);
    console.log(`    → closing ${val(ws, 'F', mixRow)}  ⇒  ${fValue[mixRow]}`);
}
if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply (Excel closed).\n'); process.exit(0); }

// ── 4. Back up ──────────────────────────────────────────────────────────
const backupDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `Dairy_Accounts_Professional.xlsx.bak-production-${stamp}`);
fs.copyFileSync(XLSX_PATH, backup);
console.log(`\n  💾 backup: ${backup}`);

// ── 5. XML helpers ──────────────────────────────────────────────────────
// NB: every replacement below uses a FUNCTION, never a replacement string.
// Formulas are full of "$10", "$1679" … and `String.replace` would read "$10"
// as a capture-group reference and silently corrupt them.
function appendCell(xmlText, row, cellStr) {
    const re = new RegExp(`(<row r="${row}"[^>]*>[\\s\\S]*?)(</row>)`);
    if (!re.test(xmlText)) throw new Error(`row ${row} not found`);
    return xmlText.replace(re, (m0, head, tail) => head + cellStr + tail);
}

/**
 * Set a cell's formula text and cached value, preserving shared-formula groups:
 *  • shared MASTER (has `ref=`) → keep its attributes, rewrite only the text;
 *    members inherit the new formula by relative shift.
 *  • shared MEMBER (no text)    → leave the formula untouched, refresh <v>.
 *  • plain formula              → rewrite the text.
 */
function setFormulaAndCache(xmlText, ref, newText, value) {
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    const m = xmlText.match(re);
    if (!m) throw new Error(`cell ${ref} not found`);
    const style = (m[1].match(/s="(\d+)"/) || [, '0'])[1];
    const inner = m[2] || '';
    const fm = inner.match(/<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/);
    const cached = value === '' ? '' : value;
    if (!fm) return xmlText.replace(re, () => `<c r="${ref}" s="${style}"><v>${cached}</v></c>`);
    const fAttrs = fm[1] || '';
    const isMember = /t="shared"/.test(fAttrs) && !/ref=/.test(fAttrs);
    const newF = isMember ? `<f${fAttrs}/>` : `<f${fAttrs}>${esc(newText)}</f>`;
    return xmlText.replace(re, () => `<c r="${ref}" s="${style}">${newF}<v>${cached}</v></c>`);
}

/** Refresh only a cell's cached value, leaving its formula (incl. shared) alone. */
function setCacheOnly(xmlText, ref, value) {
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    const m = xmlText.match(re);
    if (!m) throw new Error(`cell ${ref} not found`);
    const style = (m[1].match(/s="(\d+)"/) || [, '0'])[1];
    const inner = m[2] || '';
    // Re-emit the formula element VERBATIM (self-closing shared member or a full
    // formula), so nothing about the group is altered.
    const fm = inner.match(/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/);
    const cached = value === '' ? '' : value;
    return xmlText.replace(re, () => `<c r="${ref}" s="${style}">${fm ? fm[0] : ''}<v>${cached}</v></c>`);
}

function newCell(ref, style, formula, value, isText) {
    const t = isText ? ' t="str"' : '';
    const v = value === '' ? '<v></v>' : `<v>${value}</v>`;
    return `<c r="${ref}" s="${style}"${t}><f>${esc(formula)}</f>${v}</c>`;
}

// ── 6. Patch the sheet XML ──────────────────────────────────────────────
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

const styleOf = (col, r) => { const c = ws[col + r]; return c && c.s !== undefined ? c.s : ((ws['E' + r] || {}).s || 0); };

let xml = unzip(sheetPart);
const xmlBefore = xml;

xml = xml.replace(/<dimension ref="A1:H(\d+)"\/>/, '<dimension ref="A1:I$1"/>');
xml = xml.replace(/<\/cols>/, '<col min="9" max="9" width="14" customWidth="1"/></cols>');
// H8 is the last cell of the header row, so the new label can simply follow it.
xml = appendCell(xml, headerRow, `<c r="I${headerRow}" s="3" t="inlineStr"><is><t>${NEW_HEADER}</t></is></c>`);

// New Production In cells (always fresh, so plain formulas).
for (const r of productRows) xml = appendCell(xml, r, newCell('I' + r, styleOf('D', r), productionFormula(r), iValue[r], false));
for (const r of blankRows) xml = appendCell(xml, r, newCell('I' + r, styleOf('D', r), productionFormula(r), '', true));
for (const r of subtotalRows) xml = appendCell(xml, r, newCell('I' + r, styleOf('D', r), `SUM(${productRows.filter((x) => x < r).map((x) => 'I' + x).join(',')})`, iValue[r], false));
xml = appendCell(xml, totalsRow, newCell('I' + totalsRow, styleOf('F', totalsRow), `SUM(${productRows.map((r) => 'I' + r).join(',')})`, iValue[totalsRow], false));

// Closing now includes Production In.
for (const r of productRows) xml = setFormulaAndCache(xml, 'F' + r, closingFormula(r), fValue[r]);
for (const r of blankRows) xml = setFormulaAndCache(xml, 'F' + r, '', '');
for (const r of subtotalRows) xml = setCacheOnly(xml, 'F' + r, fValue[r]);   // SUM(...) formula stays
xml = setFormulaAndCache(xml, 'F' + totalsRow, `SUM(${productRows.map((r) => 'F' + r).join(',')})`, fValue[totalsRow]);

xml = xml.replace(/spans="1:8"/g, 'spans="1:9"');
if (xml === xmlBefore) { console.error('Patch produced no change — aborting.'); process.exit(1); }

// ── 7. Workbook-level: recalc on open + widen the print area ────────────
let wbPatch = wbXml;
wbPatch = /<calcPr[^>]*\/>/.test(wbPatch)
    ? wbPatch.replace(/<calcPr([^>]*)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>')
    : wbPatch.replace(/<calcPr([^>]*)>/, '<calcPr$1 fullCalcOnLoad="1">');
wbPatch = wbPatch.replace(/(Stock_Statement'?!\$A\$1:\$)[A-Z](\$\d+)/, '$1I$2');

// ── 8. Repack only the changed entries ──────────────────────────────────
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-production-'));
try {
    const write = (rel, content) => {
        const dest = path.join(stage, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, 'utf8');
    };
    write(sheetPart, xml);
    write('xl/workbook.xml', wbPatch);
    execFileSync('zip', ['-X', XLSX_PATH, sheetPart, 'xl/workbook.xml'], { cwd: stage, stdio: 'pipe' });
} finally {
    fs.rmSync(stage, { recursive: true, force: true });
}

// ── 9. Verify ───────────────────────────────────────────────────────────
const chk = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const cws = chk.Sheets[SHEET];
const problems = [];
if (JSON.stringify(chk.SheetNames) !== JSON.stringify(sheetsBefore)) problems.push('sheet list changed');
if (String((cws['I' + headerRow] || {}).v) !== NEW_HEADER) problems.push(`header I${headerRow} = ${(cws['I' + headerRow] || {}).v}`);
for (const r of productRows) {
    const f = String((cws['F' + r] || {}).f || '');
    if (!f.includes(`+$I${r}`)) problems.push(`F${r} does not include Production In: ${f}`);
    const got = (cws['F' + r] || {}).v;
    if (typeof got === 'number' && Math.abs(got - fValue[r]) > EPS) problems.push(`F${r} cached ${got} expected ${fValue[r]}`);
}
// Every other product row must also have picked production up (shared members).
for (const r of [13, 14, 15, 16, 17]) {
    if (!productRows.includes(r)) continue;
    const f = String((cws['F' + r] || {}).f || '');
    if (!f.includes(`+$I${r}`)) problems.push(`F${r} (shared member) did not inherit Production In: ${f}`);
}
// Subtotal rows keep their SUM formula but must show the refreshed cached total.
for (const r of subtotalRows) {
    const got = (cws['F' + r] || {}).v;
    if (typeof got === 'number' && Math.abs(got - fValue[r]) > EPS) problems.push(`subtotal F${r} cached ${got} expected ${fValue[r]}`);
}
if (mixRow) {
    const closing = (cws['F' + mixRow] || {}).v;
    const prod = (cws['I' + mixRow] || {}).v;
    if (typeof prod !== 'number' || Math.abs(prod - mixProduction) > EPS) problems.push(`${MIX_PRODUCT} production ${prod} expected ${mixProduction}`);
    if (typeof closing === 'number' && closing < -EPS) problems.push(`${MIX_PRODUCT} still closes negative (${closing})`);
}

console.log('\n  ── verification ──');
console.log(`  sheets preserved : ${chk.SheetNames.length}`);
console.log(`  header I${headerRow} = ${JSON.stringify((cws['I' + headerRow] || {}).v)}`);
for (const r of productRows) {
    console.log(`  row ${String(r).padStart(2)} ${String((cws['A' + r] || {}).v || '(blank slot)').padEnd(14)} prod ${String((cws['I' + r] || {}).v).padStart(8)}  closing ${String((cws['F' + r] || {}).v).padStart(10)}  (was ${val(ws, 'F', r)})`);
}
if (problems.length) {
    console.log(`\n  ❌ VERIFY FAILED: ${problems.slice(0, 8).join('; ')}`);
    console.log(`  Restore from backup: cp "${backup}" "${XLSX_PATH}"\n`);
    process.exit(1);
}
console.log('\n  ✅ Production In column added; every Closing now includes it.\n');
