#!/usr/bin/env node
/**
 * FIX — Excel `Stock_Statement`: a real running balance, nothing negative
 * ======================================================================
 * The sheet showed a negative Closing for almost every product. Causes:
 *
 * 1. **Opening Stock never carried forward.** Its "everything before the From
 *    date" SUMIFS pointed at the WRONG date column — `Purchase_Entry!$A:$A`
 *    (the *Bikram Sambat* text date) and `Sales_Entry!$A:$A` — while the From/To
 *    cells hold the **AD date serial**, which lives in column **B** on both
 *    sheets. A text date is "greater than" any number in Excel, so `"<"&$B$5`
 *    matched nothing and every Opening came out as `Stock_Master` opening = 0.
 * 2. **No production and no consumption.** Milk is bought as Cow Milk / Buffalo
 *    Milk and sold as Mix Milk (the mixing exists nowhere), and GHEE / NAUNI /
 *    PANEER are made in-house with no production record. The raw milk also never
 *    left the sheet, so it piled up.
 * 3. Ranges were hard-coded and had drifted (`$M$10:$M$1679` while
 *    Purchase_Entry has 1,682 rows; `$F$22:$F$2585` while Sales_Entry has 2,586).
 *
 * The sheet now mirrors the application's own model, expressed as one
 * self-consistent running balance for any From/To the operator types:
 *
 *   Opening   = opening stock (Stock_Master) + purchases + production
 *               − used in mixing − sales, all BEFORE the From date
 *   Production In = Mix Milk: the Cow + Buffalo milk mixed that period,
 *                   plus whatever is needed to keep the balance non-negative;
 *                   any other product: the amount needed to cover its sales
 *   Used in Mixing = the Cow + Buffalo milk consumed into Mix Milk
 *   Closing   = Opening + Purchases In + Production In − Used in Mixing − Sales Out
 *
 * Consequences: today's Opening is exactly yesterday's Closing (the rule the
 * operator described), and no row can close negative. Products whose books
 * record sales but no purchase/production now show the derived production that
 * makes them whole — the same rule `deriveShortfallBatches()` applies in the app.
 *
 * Scope: patches ONLY the Stock_Statement sheet XML inside the .xlsx zip (plus
 * the workbook print area and a recalculate-on-open flag), so the other 25
 * sheets, all styles and every other cell are left byte-for-byte untouched.
 * Refuses to write while Excel holds the file open; backs up first; verifies.
 *
 * Usage:
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/fix-stock-statement-running-balance.js          # dry run
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/fix-stock-statement-running-balance.js --apply  # write
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

const MIX_PRODUCT = 'Mix Milk';
const MIX_SOURCES = ['Cow Milk', 'Buffalo Milk'];
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
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

// ── 1. Workbook, header/totals/date rows, product vs blank vs subtotal rows ──
const wb = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const ws = wb.Sheets[SHEET];
if (!ws) { console.error(`Sheet "${SHEET}" not found.`); process.exit(1); }
const sheetsBefore = wb.SheetNames.slice();

let headerRow = null, totalsRow = null, dateRow = null;
for (let r = 1; r <= 300; r++) {
    const a = String(val(ws, 'A', r) || '');
    const b = String(val(ws, 'B', r) || '');
    if (!headerRow && a === 'Product' && b === 'Unit') headerRow = r;
    if (String(b).toUpperCase().includes('TOTAL')) totalsRow = r;
    if (/^From Date/.test(a) && dateRow === null) dateRow = r;
}
if (!headerRow || !totalsRow || !dateRow) { console.error('Could not locate the header / TOTALS / date row.'); process.exit(1); }

const formulaOf = (col, r) => { const c = ws[col + r]; return c && c.f ? String(c.f) : ''; };
const isSubtotalRow = (r) => /^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/i.test(formulaOf('D', r).trim());

const productRows = [], blankRows = [], subtotalRows = [];
for (let r = headerRow + 1; r < totalsRow; r++) {
    if (isSubtotalRow(r)) { subtotalRows.push(r); continue; }
    if (String(val(ws, 'A', r) || '').trim()) productRows.push(r);
    else if (/SUMIFS?\s*\(/i.test(formulaOf('C', r) + formulaOf('D', r))) blankRows.push(r);
}
const nameOf = (r) => String(val(ws, 'A', r) || '').trim();
const masterRowOf = (r) => {
    const m = formulaOf('C', r).match(/Stock_Master!\$C\$(\d+)/) || formulaOf('G', r).match(/Stock_Master!\$H\$(\d+)/);
    return m ? Number(m[1]) : null;
};

// ── 2. The workbook's own data → the numbers the new formulas must produce ───
const sheetRows = (name, fromRow) => XLSX.utils
    .sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })
    .slice(fromRow - 1);
// Purchase_Entry: B = AD date, F = product, M = quantity.  Sales_Entry: B, E, F.
const load = (name, prodCol, qtyCol) => sheetRows(name, 3)
    .filter((r) => Number.isFinite(Number(r[1])) && norm(r[prodCol]))
    .map((r) => ({ ad: Number(r[1]), product: norm(r[prodCol]), qty: num(r[qtyCol]) }));
const PURCHASES = load('Purchase_Entry', 5, 12);
const SALES = load('Sales_Entry', 4, 5);

const FROM_AD = num(val(ws, 'B', dateRow)), TO_AD = num(val(ws, 'D', dateRow));
const sumWhere = (list, product, test) => r2(list.filter((x) => x.product === product && test(x.ad)).reduce((s, x) => s + x.qty, 0));
/** before = everything strictly before From; in = the period; to = everything up to To. */
const flow = (list, product) => {
    const before = sumWhere(list, product, (ad) => ad < FROM_AD);
    const within = sumWhere(list, product, (ad) => ad >= FROM_AD && ad <= TO_AD);
    return { before, in: within, to: r2(before + within) };
};
const flowMix = () => {
    const before = r2(MIX_SOURCES.reduce((s, p) => s + sumWhere(PURCHASES, norm(p), (ad) => ad < FROM_AD), 0));
    const within = r2(MIX_SOURCES.reduce((s, p) => s + sumWhere(PURCHASES, norm(p), (ad) => ad >= FROM_AD && ad <= TO_AD), 0));
    return { before, in: within, to: r2(before + within) };
};

// JS model of every row: purchases, consumption, production, sales, opening, closing.
const expect = {};
for (const r of [...productRows, ...blankRows]) {
    const name = norm(nameOf(r));
    const mr = masterRowOf(r);
    const master = mr ? num(val(wb.Sheets['Stock_Master'], 'C', mr)) : 0;
    const e = { name: nameOf(r), row: r, master, mr, inMix: MIX_SOURCES.map(norm).includes(name), isMix: name === norm(MIX_PRODUCT) };
    if (name) {
        const pur = flow(PURCHASES, name), sal = flow(SALES, name), mix = flowMix();
        // Production cumulative up to a cut: Mix Milk gets the milk mixed, every
        // product gets whatever is needed so its balance never goes negative.
        const cum = (cut) => {
            if (e.isMix) return r2(mix[cut] + Math.max(0, sal[cut] - pur[cut] - mix[cut] - master));
            if (e.inMix) return Math.max(0, r2(sal[cut] - master));
            return Math.max(0, r2(sal[cut] - pur[cut] - master));
        };
        e.purchases = pur.in;
        e.sales = sal.in;
        e.consumption = e.inMix ? pur.in : 0;
        e.production = r2(cum('to') - cum('before'));
        e.opening = r2(master + pur.before - (e.inMix ? pur.before : 0) + cum('before') - sal.before);
        e.closing = r2(e.opening + e.purchases + e.production - e.consumption - e.sales);
        e.cumBefore = cum('before');
        e.cumTo = cum('to');
    } else {
        Object.assign(e, { purchases: 0, sales: 0, consumption: 0, production: 0, opening: 0, closing: 0, cumBefore: 0, cumTo: 0 });
    }
    expect[r] = e;
}

// ── 3. Formulas (whole-column SUMIFS, AD date column B on both sheets) ───────
const DATE_FROM = `$B$${dateRow}`, DATE_TO = `$D$${dateRow}`;
const P = { q: 'Purchase_Entry!$M:$M', p: 'Purchase_Entry!$F:$F', d: 'Purchase_Entry!$B:$B' };
const S = { q: 'Sales_Entry!$F:$F', p: 'Sales_Entry!$E:$E', d: 'Sales_Entry!$B:$B' };
// cut = 'before' (strictly before From) | 'to' (up to and including To)
const sum = (t, product, cut) => cut === 'before'
    ? `SUMIFS(${t.q},${t.p},${product},${t.d},"<"&${DATE_FROM})`
    : `SUMIFS(${t.q},${t.p},${product},${t.d},"<="&${DATE_TO})`;
const sumIn = (t, product) => `SUMIFS(${t.q},${t.p},${product},${t.d},">="&${DATE_FROM},${t.d},"<="&${DATE_TO})`;
const mixSum = (cut) => MIX_SOURCES.map((p) => sum(P, `"${p}"`, cut)).join('+');
const prodCum = (r, cut) => {
    const e = expect[r];
    const mc = `Stock_Master!$C$${e.mr}`;
    if (e.isMix) { const m = mixSum(cut); return `${m}+MAX(0,${sum(S, `$A${r}`, cut)}-${sum(P, `$A${r}`, cut)}-${m}-${mc})`; }
    if (e.inMix) return `MAX(0,${sum(S, `$A${r}`, cut)}-${mc})`;
    return `MAX(0,${sum(S, `$A${r}`, cut)}-${sum(P, `$A${r}`, cut)}-${mc})`;
};
const formulas = {};
for (const r of [...productRows, ...blankRows]) {
    const e = expect[r];
    if (!nameOf(r)) { formulas[r] = { C: '', D: '', E: '', I: '', J: '' }; continue; }
    const cons = e.inMix ? sum(P, `$A${r}`, 'before') : '0';
    formulas[r] = {
        C: `IF($A${r}="","",Stock_Master!$C$${e.mr}+${sum(P, `$A${r}`, 'before')}-${cons}+${prodCum(r, 'before')}-${sum(S, `$A${r}`, 'before')})`,
        D: `IF($A${r}="","",${sumIn(P, `$A${r}`)})`,
        E: `IF($A${r}="","",${sumIn(S, `$A${r}`)})`,
        F: `IF($A${r}="","",$C${r}+$D${r}+$I${r}-$J${r}-$E${r})`,
        I: `IF($A${r}="","",${prodCum(r, 'to')}-(${prodCum(r, 'before')}))`,
        J: `IF($A${r}="","",${e.inMix ? sumIn(P, `$A${r}`) : '0'})`,
    };
}
// Group subtotal / TOTALS rows.
for (const r of subtotalRows) {
    const members = productRows.filter((x) => x < r);
    const sumOf = (k) => r2(members.reduce((s, x) => s + expect[x][k], 0));
    expect[r] = { name: '(group subtotal)', members, opening: sumOf('opening'), purchases: sumOf('purchases'), production: sumOf('production'), consumption: sumOf('consumption'), sales: sumOf('sales'), closing: sumOf('closing') };
}
const bodyRows = productRows.filter((r) => !subtotalRows.includes(r));
const sumOfAll = (k) => r2(bodyRows.reduce((s, x) => s + expect[x][k], 0));
expect[totalsRow] = { name: 'TOTALS', opening: sumOfAll('opening'), purchases: sumOfAll('purchases'), production: sumOfAll('production'), consumption: sumOfAll('consumption'), sales: sumOfAll('sales'), closing: sumOfAll('closing') };

// ── 4. Report ───────────────────────────────────────────────────────────────
console.log(`\n${SHEET}: header ${headerRow}, TOTALS ${totalsRow}, period row ${dateRow} (AD ${num(val(ws, 'B', dateRow))} → ${num(val(ws, 'D', dateRow))})`);
console.log(`  product rows ${productRows.join(', ')} | subtotal ${subtotalRows.join(', ') || '(none)'} | blank slots ${blankRows.join(', ') || '(none)'}`);
console.log('\n                    BEFORE              AFTER');
console.log('product'.padEnd(14) + 'open'.padStart(8) + 'close'.padStart(11) + '  →  ' + 'open'.padStart(9) + 'pur'.padStart(9) + 'prod'.padStart(9) + 'used'.padStart(9) + 'sale'.padStart(9) + 'close'.padStart(10));
for (const r of productRows) {
    const e = expect[r];
    if (!nameOf(r)) continue;
    console.log(String(e.name).slice(0, 13).padEnd(14) +
        String(num(val(ws, 'C', r)).toFixed(2)).padStart(8) + String(num(val(ws, 'F', r)).toFixed(2)).padStart(11) + '  →  ' +
        String(e.opening.toFixed(2)).padStart(9) + String(e.purchases.toFixed(2)).padStart(9) + String(e.production.toFixed(2)).padStart(9) +
        String(e.consumption.toFixed(2)).padStart(9) + String(e.sales.toFixed(2)).padStart(9) + String(e.closing.toFixed(2)).padStart(10) +
        (e.closing < -EPS ? '   <<< NEGATIVE' : ''));
}
const negatives = productRows.filter((r) => nameOf(r) && expect[r].closing < -EPS);
console.log(`\n  negative closings: ${negatives.length}${negatives.length ? ' — ' + negatives.map((r) => expect[r].name).join(', ') : ''}`);
const identityErrors = [...productRows, ...blankRows].filter((r) => {
    const e = expect[r];
    return Math.abs((e.opening + e.purchases + e.production - e.consumption - e.sales) - e.closing) > EPS;
});
console.log(`  identity (Opening + Purchases + Production − Used − Sales = Closing) errors: ${identityErrors.length}`);

if (!APPLY) { console.log('\nDRY RUN — nothing written. Re-run with --apply (Excel closed).\n'); process.exit(0); }

// ── 5. Back up ──────────────────────────────────────────────────────────────
const backupDir = path.join(ROOT, 'data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `Dairy_Accounts_Professional.xlsx.bak-runningbalance-${stamp}`);
fs.copyFileSync(XLSX_PATH, backup);
console.log(`\n  💾 backup: ${backup}`);

// ── 6. XML helpers ──────────────────────────────────────────────────────────
// NB: every replacement uses a FUNCTION, never a replacement string — formulas
// contain "$10" / "$1679" and `String.replace` would read those as capture-group
// references and silently corrupt them.
function rowOf(xmlText, row) {
    const m = xmlText.match(new RegExp(`(<row r="${row}"[^>]*>)([\\s\\S]*?)(</row>)`));
    if (!m) throw new Error(`row ${row} not found`);
    return m;
}
function appendCell(xmlText, row, cellStr) {
    const m = rowOf(xmlText, row);
    const idx = m.index + m[1].length + m[2].length;
    return xmlText.slice(0, idx) + cellStr + xmlText.slice(idx);
}
function upsertCell(xmlText, row, ref, cellStr) {
    const re = new RegExp(`<c r="${ref}"(?:[^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    if (re.test(xmlText)) return xmlText.replace(re, () => cellStr);
    const m = rowOf(xmlText, row);
    const col = ref.match(/^[A-Z]+/)[0];
    const inner = m[2];
    const after = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)].filter((x) => x[1] < col).pop();
    if (after) {
        const innerStart = m.index + m[1].length;
        const cellRe = new RegExp(`<c r="${after[1]}\\d+"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
        const mm = inner.match(cellRe);
        const idx = innerStart + mm.index + mm[0].length;
        return xmlText.slice(0, idx) + cellStr + xmlText.slice(idx);
    }
    const idx = m.index + m[1].length;
    return xmlText.slice(0, idx) + cellStr + xmlText.slice(idx);
}
/** Set formula text + cached value, preserving shared-formula groups. */
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
    const f = isMember ? `<f${fAttrs}/>` : `<f${fAttrs}>${esc(newText)}</f>`;
    return xmlText.replace(re, () => `<c r="${ref}" s="${style}">${f}<v>${cached}</v></c>`);
}
/** Refresh only the cached value; the formula element is re-emitted verbatim. */
function setCacheOnly(xmlText, ref, value) {
    const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
    const m = xmlText.match(re);
    if (!m) throw new Error(`cell ${ref} not found`);
    const style = (m[1].match(/s="(\d+)"/) || [, '0'])[1];
    const inner = m[2] || '';
    const fm = inner.match(/<f[^>]*\/>|<f[^>]*>[\s\S]*?<\/f>/);
    const cached = value === '' ? '' : value;
    return xmlText.replace(re, () => `<c r="${ref}" s="${style}">${fm ? fm[0] : ''}<v>${cached}</v></c>`);
}
const styleOf = (col, r) => { const c = ws[col + r]; return c && c.s !== undefined ? c.s : ((ws['D' + r] || {}).s || 0); };

// ── 7. Resolve the sheet part, then patch it ────────────────────────────────
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

let xml = unzip(sheetPart);
const xmlBefore = xml;

// New "Used in Mixing" column (J) + the header label, then every row's cells.
xml = xml.replace(/<dimension ref="A1:I(\d+)"\/>/, '<dimension ref="A1:J$1"/>');
if (!/<col min="10"/.test(xml)) xml = xml.replace(/<\/cols>/, '<col min="10" max="10" width="15" customWidth="1"/></cols>');
xml = xml.replace(/spans="1:9"/g, 'spans="1:10"');
xml = appendCell(xml, headerRow, `<c r="J${headerRow}" s="${styleOf('I', headerRow)}" t="inlineStr"><is><t>Used in Mixing</t></is></c>`);

for (const r of [...productRows, ...blankRows]) {
    const e = expect[r];
    if (!nameOf(r)) { continue; }
    xml = setFormulaAndCache(xml, 'C' + r, formulas[r].C, e.opening);
    xml = setFormulaAndCache(xml, 'D' + r, formulas[r].D, e.purchases);
    xml = setFormulaAndCache(xml, 'E' + r, formulas[r].E, e.sales);
    xml = setFormulaAndCache(xml, 'F' + r, formulas[r].F, e.closing);
    xml = setFormulaAndCache(xml, 'I' + r, formulas[r].I, e.production);
    const jCell = `<c r="J${r}" s="${styleOf('I', r)}"><f>${esc(formulas[r].J)}</f><v>${e.consumption === '' ? '' : e.consumption}</v></c>`;
    xml = upsertCell(xml, r, 'J' + r, jCell);
    if (e.closing !== undefined) xml = setCacheOnly(xml, 'H' + r, r2(e.closing * num(val(ws, 'G', r))));
}
// Unpopulated slots keep guarded formulas and show blank.
for (const r of blankRows) {
    if (nameOf(r)) continue;
    xml = setFormulaAndCache(xml, 'C' + r, formulas[r].C, '');
    xml = setFormulaAndCache(xml, 'D' + r, formulas[r].D, '');
    xml = setFormulaAndCache(xml, 'E' + r, formulas[r].E, '');
    xml = setFormulaAndCache(xml, 'F' + r, '', '');
    xml = setFormulaAndCache(xml, 'I' + r, formulas[r].I, '');
    xml = upsertCell(xml, r, 'J' + r, `<c r="J${r}" s="${styleOf('I', r)}" t="str"><f>${esc(formulas[r].J)}</f><v></v></c>`);
}
// Group subtotal rows: keep the SUM formulas, refresh caches, add C and J totals.
for (const r of subtotalRows) {
    const members = expect[r].members;
    for (const col of ['C', 'J']) {
        const ref = col + r;
        const key = col === 'C' ? 'opening' : 'consumption';
        const style = (ws[ref] && ws[ref].s !== undefined) ? ws[ref].s : styleOf('C', r);
        xml = upsertCell(xml, r, ref, `<c r="${ref}" s="${style}"><f>SUM(${members.map((x) => col + x).join(',')})</f><v>${expect[r][key]}</v></c>`);
    }
    for (const [col, key] of [['D', 'purchases'], ['E', 'sales'], ['F', 'closing'], ['I', 'production']]) {
        const ref = col + r;
        if (ws[ref] && ws[ref].f) xml = setCacheOnly(xml, ref, expect[r][key]);
    }
}
// TOTALS row: same columns, refreshed (its SUM ranges are already correct).
const totalValue = r2(bodyRows.reduce((s, r) => s + r2(expect[r].closing * num(val(ws, 'G', r))), 0));
for (const [col, key] of [['C', 'opening'], ['D', 'purchases'], ['E', 'sales'], ['F', 'closing'], ['I', 'production']]) {
    const ref = col + totalsRow;
    if (ws[ref] && ws[ref].f) xml = setCacheOnly(xml, ref, expect[totalsRow][key]);
}
xml = setCacheOnly(xml, 'H' + totalsRow, totalValue);
xml = upsertCell(xml, totalsRow, 'J' + totalsRow,
    `<c r="J${totalsRow}" s="${styleOf('I', totalsRow)}"><f>SUM(${bodyRows.map((r) => 'J' + r).join(',')})</f><v>${expect[totalsRow].consumption}</v></c>`);
// The header block's own "Total Closing Value" cell shows the same total.
let valueRow = null;
for (let r = 1; r < headerRow; r++) if (/Total Closing Value/i.test(String(val(ws, 'F', r) || ''))) valueRow = r;
if (valueRow && ws['H' + valueRow] && ws['H' + valueRow].f) xml = setCacheOnly(xml, 'H' + valueRow, totalValue);

if (xml === xmlBefore) { console.error('Patch produced no change — aborting.'); process.exit(1); }

// Workbook-level: recalculate on open + widen the print area to column J.
let wbPatch = wbXml.replace(/<calcPr([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>');
wbPatch = wbPatch.replace(/(Stock_Statement'?!\$A\$1:\$)[A-Z](\$\d+)/, '$1J$2');

// The sheet's footnote describes the old (wrong) rule — rewrite it, but only if
// that shared string is used by exactly one cell.
const OLD_NOTE = 'Opening Stock = master opening';
const NEW_NOTE = 'Opening = opening stock + purchases + production − used in mixing − sales BEFORE the From date '
    + '(today\u2019s opening = yesterday\u2019s closing); Closing = Opening + Purchases + Production − Used − Sales.';
const ssPart = 'xl/sharedStrings.xml';
let ssXml = null, ssPatched = null;
try {
    ssXml = unzip(ssPart);
    const si = [...ssXml.matchAll(/<si>[\s\S]*?<\/si>/g)];
    const hit = si.findIndex((m) => m[0].includes(OLD_NOTE));
    if (hit >= 0) {
        const parts = execFileSync('unzip', ['-l', XLSX_PATH], { maxBuffer: 16 * 1024 * 1024 }).toString()
            .split('\n').map((l) => l.trim().split(/\s+/).pop())
            .filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n));
        let refs = 0;
        for (const p of parts) for (const c of unzip(p).matchAll(/<c[^>]*t="s"[^>]*><v>(\d+)<\/v>/g)) if (Number(c[1]) === hit) refs++;
        if (refs === 1) { ssPatched = si[hit][0].replace(/<t[^>]*>[\s\S]*?<\/t>/, () => `<t>${esc(NEW_NOTE)}</t>`); ssXml = ssXml.replace(si[hit][0], () => ssPatched); }
        else console.log(`\n  ℹ︎ note left unchanged: shared string ${hit} is used by ${refs} cells.`);
    }
} catch (err) { ssXml = null; ssPatched = null; }

// ── 8. Repack only the changed entries ──────────────────────────────────────
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-running-balance-'));
try {
    const write = (rel, content) => {
        const dest = path.join(stage, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, 'utf8');
    };
    write(sheetPart, xml);
    write('xl/workbook.xml', wbPatch);
    const entries = [sheetPart, 'xl/workbook.xml'];
    if (ssXml && ssPatched) { write(ssPart, ssXml); entries.push(ssPart); }
    execFileSync('zip', ['-X', XLSX_PATH, ...entries], { cwd: stage, stdio: 'pipe' });
} finally {
    fs.rmSync(stage, { recursive: true, force: true });
}

// ── 9. Verify what is now on disk ───────────────────────────────────────────
const chk = XLSX.readFile(XLSX_PATH, { cellFormula: true });
const cws = chk.Sheets[SHEET];
const problems = [];
if (JSON.stringify(chk.SheetNames) !== JSON.stringify(sheetsBefore)) problems.push('sheet list changed');
if (String((cws['J' + headerRow] || {}).v) !== 'Used in Mixing') problems.push(`header J${headerRow} = ${JSON.stringify((cws['J' + headerRow] || {}).v)}`);
for (const r of productRows) {
    const e = expect[r];
    if (!nameOf(r)) continue;
    const f = String((cws['F' + r] || {}).f || '');
    if (!f.includes(`+$I${r}`) || !f.includes(`-$J${r}`)) problems.push(`F${r} lost Production/Used: ${f}`);
    const c = String((cws['C' + r] || {}).f || '');
    if (!/Purchase_Entry!\$B:\$B/.test(c) || !/Sales_Entry!\$B:\$B/.test(c)) problems.push(`C${r} not using the AD date column`);
    if (/Sales_Entry!\$A:/.test(c) || /Purchase_Entry!\$A:/.test(c)) problems.push(`C${r} still points at a column A`);
    for (const [col, key] of [['C', 'opening'], ['D', 'purchases'], ['E', 'sales'], ['F', 'closing'], ['I', 'production'], ['J', 'consumption']]) {
        const got = (cws[col + r] || {}).v;
        if (typeof got === 'number' && Math.abs(got - e[key]) > EPS) problems.push(`${col}${r} cached ${got} expected ${e[key]}`);
    }
    if (e.closing < -EPS) problems.push(`${e.name} still closes negative (${e.closing})`);
    const h = (cws['H' + r] || {}).v;
    if (typeof h === 'number' && Math.abs(h - r2(e.closing * num(val(ws, 'G', r)))) > 0.02) problems.push(`H${r} cached ${h} expected ${r2(e.closing * num(val(ws, 'G', r)))}`);
}
for (const r of subtotalRows) {
    const got = (cws['F' + r] || {}).v;
    if (typeof got === 'number' && Math.abs(got - expect[r].closing) > EPS) problems.push(`subtotal F${r} cached ${got} expected ${expect[r].closing}`);
}
// The operator's rule: today's Opening must equal everything before it.
for (const r of productRows) {
    if (!nameOf(r)) continue;
    const e = expect[r];
    const beforeNet = r2(e.master + (e.inMix ? 0 : flow(PURCHASES, norm(e.name)).before) + e.cumBefore - flow(SALES, norm(e.name)).before);
    if (Math.abs(beforeNet - e.opening) > EPS) problems.push(`carry-forward mismatch on ${e.name}`);
}

console.log('\n  ── verification ──');
console.log(`  sheets preserved : ${chk.SheetNames.length}`);
for (const r of productRows) {
    const e = expect[r];
    if (!nameOf(r)) continue;
    console.log(`  row ${String(r).padStart(2)} ${e.name.padEnd(13)} open ${String(e.opening).padStart(8)} +pur ${String(e.purchases).padStart(7)} +prod ${String(e.production).padStart(7)} −used ${String(e.consumption).padStart(7)} −sale ${String(e.sales).padStart(6)} = close ${String(e.closing).padStart(7)}  value ${r2(e.closing * num(val(ws, 'G', r)))}`);
}
const totalValueChk = r2(bodyRows.reduce((s, r) => s + r2(expect[r].closing * num(val(ws, 'G', r))), 0));
console.log(`  Total Closing Value : ${totalValueChk}`);
if (String((cws['H' + totalsRow] || {}).v) !== String(totalValueChk)) problems.push(`H${totalsRow} cached ${(cws['H' + totalsRow] || {}).v} expected ${totalValueChk}`);
if (problems.length) {
    console.log(`\n  ❌ VERIFY FAILED: ${problems.slice(0, 8).join('; ')}`);
    console.log(`  Restore from backup: cp "${backup}" "${XLSX_PATH}"\n`);
    process.exit(1);
}
console.log('\n  ✅ Opening carries forward, production/consumption are explicit, and no row closes negative.\n');
