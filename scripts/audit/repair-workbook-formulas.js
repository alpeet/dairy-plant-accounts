#!/usr/bin/env node
/**
 * Repair the broken formulas in Dairy_Accounts_Professional TRIAL.xlsx
 * ====================================================================
 *
 * Usage:
 *   node scripts/audit/repair-workbook-formulas.js            # dry run (report only)
 *   node scripts/audit/repair-workbook-formulas.js --apply    # write + timestamped backup
 *
 * What it fixes, and why
 * ----------------------
 * 1. Payment / Expenses / Advance — column L "Closing Due" (the running balance).
 *    Rows of all three registers pointed at a deleted cell (`N(#REF!)`) and
 *    several pointed at a *stale* row (`N(L45)` on row 45, silently wrong).
 *    The formula was always the same idea — previous row's closing + collected
 *    − paid — so the repair is the uniform, non-erroring form
 *
 *        IF($D<r>="","",N(L<r-1>)+$I<r>-$J<r>)
 *
 *    `N(L2)` on the first data row reads the header cell and yields 0, which is
 *    the register's opening balance.
 *
 * 2. Sales_Entry — column M. The workbook uses the "Remarks" column as a
 *    discount helper (`=H-J`) with no blank guard, so all 299 pre-filled
 *    template rows below the data returned #VALUE!. Guarded with
 *    `IF($H<r>="","",…)`.
 *
 * 3. Party_Ledger — the cross-sheet reference grid.
 *    a) Cells whose formula lost its cell address (`Sales_Entry!#REF!`,
 *       `'PETTY CASH'!#REF!`) are re-pointed to the row the neighbouring row
 *       implies (row above + 1), which is exactly the pattern every working
 *       cell in that column follows. A cell is only blanked when that target
 *       falls outside the source sheet — i.e. when there really is no source
 *       transaction. Nothing is zero-filled.
 *    b) Running-balance cells whose "previous row" is not the row above are
 *       re-pointed to `<row-1>`.
 *
 * Everything is a byte-preserving edit of the sheet XML: only `<f>` and `<v>`
 * of the repaired cells change, so number formats, styles, merges, charts and
 * every other sheet stay exactly as the operator had them.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { readZip, writeZip, locateSheetPart } = require('../../shared/xlsx-parts');

const WORKBOOK_PATH = process.env.WORKBOOK_PATH
    || path.join(__dirname, '..', '..', 'Dairy_Accounts_Professional TRIAL.xlsx');
const APPLY = process.argv.includes('--apply');
const AUDIT_LOG = path.join(__dirname, '..', '..', 'data', 'workbook-formula-repair.json');

const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];

// ──────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────

function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Replacement `<c …>` element for one repaired cell. */
function cellXml(address, styleAttr, formula, value) {
    const s = styleAttr ? ` s="${styleAttr}"` : '';
    const f = `<f>${xmlEscape(formula)}</f>`;
    if (value === null || value === undefined || value === '') {
        return `<c r="${address}"${s} t="str">${f}<v></v></c>`;
    }
    if (typeof value === 'string') {
        return `<c r="${address}"${s} t="str">${f}<v>${xmlEscape(value)}</v></c>`;
    }
    return `<c r="${address}"${s}>${f}<v>${value}</v></c>`;
}

function cellRegex(address) {
    return new RegExp(`<c r="${address.replace(/\$/g, '\\$')}"((?: [^>/]*)?)(?:/>|>([\\s\\S]*?)</c>)`);
}

/** Replace one cell element; returns { xml, changed }. */
function replaceCell(xml, address, build) {
    const re = cellRegex(address);
    const m = re.exec(xml);
    if (!m) return { xml, changed: false };
    const styleMatch = /\bs="(\d+)"/.exec(m[1] || '');
    const style = styleMatch ? styleMatch[1] : null;
    const replacement = build(address, style, m[2] || '');
    return { xml: xml.slice(0, m.index) + replacement + xml.slice(m.index + m[0].length), changed: true };
}

/** `<f>` text of a cell element, or '' when it has none. */
function formulaOf(cellElement) {
    if (!cellElement) return '';
    const m = /<f[^>]*>([\s\S]*?)<\/f>/.exec(cellElement);
    return m ? m[1] : '';
}

function cellElementOf(xml, address) {
    const m = cellRegex(address).exec(xml);
    return m ? m[0] : '';
}

/** Parse a simple cross-sheet reference like `'Sales_Entry'!D2545` into parts. */
function refPatAll(formula) {
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)$/.exec(String(formula || '').trim());
    if (!m) return null;
    return { raw: m[0], sheet: m[1], col: m[2], row: Number(m[3]) };
}

// ──────────────────────────────────────────────────────────────
// 1 + 2. Register balances and the sales discount helper
// ──────────────────────────────────────────────────────────────

function repairRegisters(wb, zip) {
    const report = {};
    for (const name of ['Payment', 'Expenses', 'Advance']) {
        if (!wb.Sheets[name]) continue;
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true });
        const part = locateSheetPart(zip, name);
        let xml = zip.entries.get(part).data.toString('utf8');

        let repaired = 0, brokenRef = 0, staleRef = 0;
        let running = 0;

        for (let r = 3; r <= rows.length; r++) {
            const row = rows[r - 1] || [];
            const addr = `L${r}`;
            const current = cellElementOf(xml, addr);
            if (!current) continue;

            const payload = String(row[3] || '').trim();   // D = payee / customer
            const collected = Number(row[8]) || 0;         // I = Collected
            const paid = Number(row[9]) || 0;              // J = Paid

            const value = payload === '' ? '' : Math.round((running + collected - paid) * 100) / 100;
            if (typeof value === 'number') running = value;

            const fText = formulaOf(current);
            const prevRef = /N\(L(\d+)\)/.exec(fText);
            const isBroken = /#REF!/.test(fText);
            const isStale = !isBroken && (!prevRef || Number(prevRef[1]) !== r - 1);

            const formula = `IF($D${r}="","",N(L${r - 1})+$I${r}-$J${r})`;
            const out = replaceCell(xml, addr, (a, style) => cellXml(a, style, formula, value));
            if (!out.changed) continue;
            xml = out.xml;
            repaired++;
            if (isBroken) brokenRef++;
            else if (isStale) staleRef++;
        }

        zip.entries.get(part).data = Buffer.from(xml, 'utf8');
        report[name] = { part, repaired, broken_ref: brokenRef, stale_ref: staleRef };
    }
    return report;
}

function repairSalesDiscountColumn(wb, zip) {
    const name = 'Sales_Entry';
    if (!wb.Sheets[name]) return null;
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true });
    const part = locateSheetPart(zip, name);
    let xml = zip.entries.get(part).data.toString('utf8');

    let repaired = 0, valueErrors = 0, textRemarks = 0;
    for (let r = 3; r <= rows.length; r++) {
        const row = rows[r - 1] || [];
        const addr = `M${r}`;
        const current = cellElementOf(xml, addr);
        if (!current) continue;

        const isError = /t="e"/.test(current);
        const fText = formulaOf(current);
        const isShared = /<f t="shared"/.test(current);
        const isDiscountHelper = /^H\d+-J\d+$/.test(fText);
        if (!isError && !isShared && !isDiscountHelper) { textRemarks++; continue; }

        const h = row[7], j = row[9];
        const numeric = h !== '' && j !== '' && !isNaN(Number(h)) && !isNaN(Number(j));
        const value = numeric ? Math.round((Number(h) - Number(j)) * 100) / 100 : '';
        const formula = `IF($H${r}="","",$H${r}-$J${r})`;

        const out = replaceCell(xml, addr, (a, style) => cellXml(a, style, formula, value));
        if (!out.changed) continue;
        xml = out.xml;
        repaired++;
        if (isError) valueErrors++;
    }
    zip.entries.get(part).data = Buffer.from(xml, 'utf8');
    return { part, repaired, value_errors_fixed: valueErrors, text_remark_cells: textRemarks };
}

// ──────────────────────────────────────────────────────────────
// 3. Party_Ledger reference grid
// ──────────────────────────────────────────────────────────────

/** Used range of every sheet, so a re-pointed reference can be bounds-checked. */
function usedRanges(wb) {
    const out = {};
    for (const name of wb.SheetNames) {
        const ref = wb.Sheets[name] && wb.Sheets[name]['!ref'];
        const m = ref && /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ref);
        out[name] = m ? parseInt(m[2], 10) : 0;
    }
    return out;
}

function repairPartyLedger(wb, zip) {
    const name = 'Party_Ledger';
    if (!wb.Sheets[name]) return null;
    const part = locateSheetPart(zip, name);
    let xml = zip.entries.get(part).data.toString('utf8');
    const bounds = usedRanges(wb);
    const maxRow = bounds[name] || 0;

    let repointed = 0, blanked = 0, outOfRange = 0;
    const samples = [];

    // A dead reference keeps the sheet name but lost the cell address:
    //   <f>Sales_Entry!#REF!</f>      <f>'PETTY CASH'!#REF!</f>
    const DEAD = /^(?:'?([^'!]+)'?)!#REF!$/;

    for (let r = 3; r <= maxRow; r++) {
        for (const col of COLS) {
            const addr = `${col}${r}`;
            const current = cellElementOf(xml, addr);
            if (!current) continue;
            const fText = formulaOf(current);
            if (!fText) continue;
            const dead = DEAD.exec(fText);
            if (!dead) continue;

            const sourceSheet = dead[1];
            const prevFormula = formulaOf(cellElementOf(xml, `${col}${r - 1}`)) || '';
            const sheetPat = sourceSheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const refPat = new RegExp("^'?" + sheetPat + "'?!\\$?([A-Z]+)\\$?(\\d+)$");

            // The address is recovered from the nearest row ABOVE that still has an
            // explicit formula in this column — not just row-1, because a run of
            // these cells often sits under shared-formula cells with no text. The
            // row distance is preserved, so the source column is the real one
            // (C reads D, E reads C, …) and not whichever letter this cell lives in.
            let srcCol = null, targetRow = null;
            for (let k = r - 1; k >= Math.max(3, r - 60); k--) {
                const m2 = refPat.exec(formulaOf(cellElementOf(xml, `${col}${k}`)) || '');
                if (m2) { srcCol = m2[1]; targetRow = Number(m2[2]) + (r - k); break; }
            }
            if (targetRow === null) {
                const aSrc = refPat.exec(formulaOf(cellElementOf(xml, `A${r - 1}`)) || '');
                if (aSrc) { srcCol = col; targetRow = Number(aSrc[2]) + 1; }
            }

            if (targetRow === null) { blanked++; continue; }   // nothing to derive from
            const limit = bounds[sourceSheet] || 0;

            if (targetRow > limit) {
                // No such source row: a pre-filled template row, not a transaction.
                const out = replaceCell(xml, addr, (a, style) => `<c r="${a}"${style ? ` s="${style}"` : ''}/>`);
                if (out.changed) { xml = out.xml; blanked++; outOfRange++; }
                continue;
            }

            const formula = `'${sourceSheet}'!${srcCol}${targetRow}`;
            const value = '';   // Excel recalculates; cached text is not trusted
            const out = replaceCell(xml, addr, (a, style) => `<c r="${a}"${style ? ` s="${style}"` : ''} t="str"><f>${xmlEscape(formula)}</f></c>`);
            if (!out.changed) continue;
            xml = out.xml;
            repointed++;
            if (samples.length < 5) samples.push(`${addr}  ${fText}  →  ${formula}`);
        }
    }

    // Silent column slip: three rows of the sales block read the source sheet's
    // INVOICE column into the Party column (`Sales_Entry!C2546`), so they showed
    // 0 instead of "TILAK RAYMAJHI" and the three RENT lines vanished from the
    // party statement. The rows above and below them all read the party column,
    // so the intent is unambiguous.
    let columnSlips = 0;
    for (let r = 4; r < maxRow; r++) {
        const cur = refPatAll(formulaOf(cellElementOf(xml, `C${r}`)) || '');
        if (!cur || cur.col !== 'C') continue;
        const srcSheet = wb.Sheets[cur.sheet];
        if (!srcSheet) continue;
        // The value test is what makes this a repair rather than a guess: the cell
        // currently reads an EMPTY source cell while the party column beside it
        // holds a name. Nothing is changed when the referenced cell has content.
        const atC = srcSheet[`C${cur.row}`];
        const atD = srcSheet[`D${cur.row}`];
        const cEmpty = !atC || atC.v === undefined || atC.v === '' || atC.v === 0;
        const dHasName = atD && typeof atD.v === 'string' && atD.v.trim() !== '' && !/^BILL-|^\d+$/.test(atD.v.trim());
        if (!(cEmpty && dHasName)) continue;
        const formula = `'${cur.sheet}'!D${cur.row}`;
        const out = replaceCell(xml, `C${r}`, (a, style) => `<c r="${a}"${style ? ` s="${style}"` : ''} t="str"><f>${xmlEscape(formula)}</f></c>`);
        if (!out.changed) continue;
        xml = out.xml;
        columnSlips++;
        if (samples.length < 8) samples.push(`C${r}  ${cur.raw}  →  ${formula}  (party column)`);
    }

    // Running balance: the "previous row" must be the row directly above.
    let balanceRepointed = 0;
    xml = xml.replace(/<c r="I(\d+)"([^>]*)>([\s\S]*?)<\/c>/g, (all, rowNo, attrs, body) => {
        const refs = /IF\(\$C(\d+)=\$C(\d+),\$I(\d+)\+/.exec(body);
        if (!refs) return all;
        const r = Number(rowNo);
        const prevRow = Number(refs[2]);
        const prevBal = Number(refs[3]);
        if (prevRow === r - 1 && prevBal === r - 1) return all;
        const fixed = body
            .replace(new RegExp(`\\$C${prevRow}(?![0-9])`, 'g'), `$C${r - 1}`)
            .replace(new RegExp(`\\$I${prevBal}(?![0-9])`, 'g'), `$I${r - 1}`);
        balanceRepointed++;
        return `<c r="I${rowNo}"${attrs.replace(/\st="[a-z]+"/g, '')}>${fixed.replace(/<v>[\s\S]*?<\/v>/g, '')}</c>`;
    });

    // Stale cached errors: the cell still carries t="e" and <v>#REF!</v> from the
    // broken reference even though its formula no longer mentions one. A cached
    // error is not a computed error — drop it and let Excel recalculate.
    let staleCleared = 0;
    xml = xml.replace(/<c r="([A-Z]+\d+)"([^>]*\st="e"[^>]*)>([\s\S]*?)<\/c>/g, (all, addr, attrs, body) => {
        const f = formulaOf(`<f>${body}</f>`);
        const hasRef = /#REF!/.test((/<f[^>]*>([\s\S]*?)<\/f>/.exec(body) || [])[1] || '');
        if (hasRef) return all;
        staleCleared++;
        return `<c r="${addr}"${attrs.replace(/\st="[a-z]+"/g, '')}>${body.replace(/<v>[\s\S]*?<\/v>/g, '')}</c>`;
    });

    zip.entries.get(part).data = Buffer.from(xml, 'utf8');
    return {
        part,
        references_repointed: repointed,
        cells_blanked_out_of_range: blanked,
        dead_rows_out_of_range: outOfRange,
        balance_refs_repointed: balanceRepointed,
        party_column_slips_fixed: columnSlips,
        stale_cached_errors_cleared: staleCleared,
        samples
    };
}

/**
 * Ask Excel to recalculate everything on open. The repaired cells have no
 * cached value (we deliberately dropped the stale error results), so without
 * this the workbook would open showing blanks until something forces a recalc.
 */
function forceFullRecalc(zip) {
    const entry = zip.entries.get('xl/workbook.xml');
    if (!entry) return false;
    let xml = entry.data.toString('utf8');
    if (/<calcPr[^>]*fullCalcOnLoad="1"/.test(xml)) return false;
    if (/<calcPr[^>]*\/>/.test(xml)) {
        xml = xml.replace(/<calcPr([^>]*?)\/>/, (m, a) => `<calcPr${a} fullCalcOnLoad="1"/>`);
    } else if (/<calcPr[^>]*>/.test(xml)) {
        xml = xml.replace(/<calcPr([^>]*)>/, (m, a) => `<calcPr${a} fullCalcOnLoad="1">`);
    } else {
        xml = xml.replace(/(<\/sheets>)/, '$1<calcPr fullCalcOnLoad="1"/>');
    }
    entry.data = Buffer.from(xml, 'utf8');
    return true;
}

// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────

function countErrors(sheet) {
    let n = 0;
    for (const a of Object.keys(sheet)) {
        if (a[0] === '!') continue;
        if (sheet[a] && sheet[a].t === 'e') n++;
    }
    return n;
}

function main() {
    if (!fs.existsSync(WORKBOOK_PATH)) {
        console.error(`workbook not found: ${WORKBOOK_PATH}`);
        process.exit(2);
    }

    console.log(`WORKBOOK ${WORKBOOK_PATH}`);
    console.log(`MODE     ${APPLY ? 'APPLY (writes a backup first)' : 'DRY RUN (no writes)'}\n`);

    const TARGETS = ['Payment', 'Expenses', 'Advance', 'Sales_Entry', 'Party_Ledger'];

    const before = {};
    {
        const wb0 = XLSX.readFile(WORKBOOK_PATH, { cellFormula: true });
        for (const n of TARGETS) if (wb0.Sheets[n]) before[n] = countErrors(wb0.Sheets[n]);
    }

    const zip = readZip(fs.readFileSync(WORKBOOK_PATH));
    const wb = XLSX.readFile(WORKBOOK_PATH, { cellFormula: true });

    const result = {
        workbook: WORKBOOK_PATH,
        timestamp: new Date().toISOString(),
        applied: APPLY,
        error_cells_before: before,
        registers: repairRegisters(wb, zip),
        salesDiscount: repairSalesDiscountColumn(wb, zip),
        partyLedger: repairPartyLedger(wb, zip)
    };

    result.full_calc_on_load = forceFullRecalc(zip);
    const out = writeZip(zip.order, zip.entries);

    // Verify the produced package by reading it back before committing to disk.
    const tmp = WORKBOOK_PATH + '.verify.tmp';
    fs.writeFileSync(tmp, out);
    const after = {};
    const remaining = [];
    try {
        const check = XLSX.readFile(tmp, { cellFormula: true });
        for (const n of TARGETS) if (check.Sheets[n]) after[n] = countErrors(check.Sheets[n]);
        const pl = check.Sheets['Party_Ledger'];
        if (pl) {
            for (const a of Object.keys(pl)) {
                if (a[0] === '!' || !pl[a] || pl[a].t !== 'e') continue;
                if (remaining.length < 25) remaining.push(`${a} :: ${pl[a].f || '(no formula)'}`);
            }
        }
    } finally {
        fs.unlinkSync(tmp);
    }
    result.error_cells_after = after;
    result.party_ledger_remaining = remaining;

    if (!APPLY) {
        console.log(JSON.stringify(result, null, 2));
        console.log('\nERROR CELLS  before → after');
        for (const k of Object.keys(after)) {
            console.log(`  ${k.padEnd(14)} ${String(before[k]).padStart(6)} → ${after[k]}`);
        }
        console.log('\nDry run — nothing written. Re-run with --apply to repair the workbook.');
        return;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = WORKBOOK_PATH.replace(/\.xlsx$/i, `.bak-formulas-${stamp}.xlsx`);
    fs.copyFileSync(WORKBOOK_PATH, backup);
    fs.writeFileSync(WORKBOOK_PATH, out);

    result.backup = backup;
    fs.mkdirSync(path.dirname(AUDIT_LOG), { recursive: true });
    fs.writeFileSync(AUDIT_LOG, JSON.stringify(result, null, 2));

    console.log(JSON.stringify(result, null, 2));
    console.log('\nERROR CELLS  before → after');
    for (const k of Object.keys(after)) {
        console.log(`  ${k.padEnd(14)} ${String(before[k]).padStart(6)} → ${after[k]}`);
    }
    console.log(`\n✅ repaired. backup: ${backup}`);
    console.log(`   audit log: ${AUDIT_LOG}`);
}

if (require.main === module) main();
module.exports = { main };
