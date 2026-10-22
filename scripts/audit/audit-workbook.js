#!/usr/bin/env node
/**
 * Read-only audit of an Excel workbook used as an import source.
 * =============================================================
 * Usage:
 *   node scripts/audit/audit-workbook.js "Dairy_Accounts_Professional TRIAL.xlsx"
 *   node scripts/audit/audit-workbook.js "file.xlsx" --json > /tmp/wb.json
 *
 * Prints, for every sheet (visible AND hidden):
 *   - visibility, dimensions, row count
 *   - detected header row + column headers
 *   - number of formula cells, number of #REF!/#VALUE!/#NAME? errors
 *   - a few sample data rows (as raw cell values)
 *   - date-looking columns and their min/max range
 *
 * Never writes to the workbook.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ERROR_VALUES = new Set([
    '#REF!', '#VALUE!', '#NAME?', '#DIV/0!', '#N/A', '#NULL!', '#NUM!', '#ERROR!'
]);

function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim();
}

function looksLikeHeader(row) {
    // A header row is mostly non-numeric, non-empty text.
    const cells = row.filter(c => cellText(c) !== '');
    if (cells.length === 0) return false;
    const texty = cells.filter(c => {
        const t = cellText(c);
        return t !== '' && isNaN(Number(t)) && !/^\d{4}-\d{2}-\d{2}/.test(t);
    }).length;
    return texty / cells.length >= 0.6;
}

function findHeaderRow(sheetRows) {
    const limit = Math.min(sheetRows.length, 25);
    for (let i = 0; i < limit; i++) {
        if (looksLikeHeader(sheetRows[i] || [])) return i;
    }
    return -1;
}

function auditWorkbook(file) {
    const wb = XLSX.readFile(file, { cellFormula: true, cellNF: true, cellStyles: false, cellDates: true });
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    const out = {
        file: path.resolve(file),
        sizeBytes: fs.statSync(file).size,
        sheetCount: wb.SheetNames.length,
        sheets: []
    };

    wb.SheetNames.forEach((name, idx) => {
        const ws = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
        const ref = ws['!ref'] || '(none)';
        const m = /!([A-Z]+)(\d+):([A-Z]+)(\d+)/.exec(ref) || [];
        const declaredRows = m[4] ? parseInt(m[4], 10) : rows.length;
        const declaredCols = m[3] ? XLSX.utils.decode_col(m[3]) + 1 : 0;

        let formulaCells = 0;
        const errors = {};
        const errorCells = [];
        for (const addr of Object.keys(ws)) {
            if (addr[0] === '!') continue;
            const cell = ws[addr];
            if (cell.f) formulaCells++;
            if (cell.t === 'e' || ERROR_VALUES.has(cellText(cell.v))) {
                const e = cellText(cell.v) || '#ERROR';
                errors[e] = (errors[e] || 0) + 1;
                if (errorCells.length < 40) errorCells.push(`${addr}=${e}`);
            }
        }

        const headerIdx = findHeaderRow(rows);
        const headers = headerIdx >= 0
            ? (rows[headerIdx] || []).map((h, i) => cellText(h) || `col${i + 1}`)
            : [];

        // Data rows = rows after the header with at least one non-empty cell.
        const dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
        const nonEmpty = dataRows.filter(r => (r || []).some(c => cellText(c) !== ''));

        // Date columns: header mentions date / month / period
        const dateCols = [];
        headers.forEach((h, i) => {
            if (/date|month|period|bs|ad/i.test(h)) dateCols.push(i);
        });

        const sample = [];
        for (let i = 0; i < Math.min(3, nonEmpty.length); i++) {
            sample.push((nonEmpty[i] || []).slice(0, 14).map(cellText));
        }

        // Rough "is this a transaction sheet" heuristic
        const looksNumeric = headers.filter(h => /amount|qty|quantity|rate|total|price|debit|credit|balance|paid/i.test(h)).length;

        out.sheets.push({
            index: idx,
            name,
            visibility: (meta[idx] && meta[idx].Hidden) ? 'hidden' : 'visible',
            ref,
            declaredRows,
            declaredCols,
            dataRowCount: nonEmpty.length,
            headerRowIndex: headerIdx,
            headers,
            dateColIndexes: dateCols,
            numericHeaderCount: looksNumeric,
            formulaCellCount: formulaCells,
            errorCounts: errors,
            errorCellSample: errorCells,
            sampleRows: sample
        });
    });

    return out;
}

function main() {
    const args = process.argv.slice(2);
    const file = args.find(a => !a.startsWith('--'));
    if (!file) {
        console.error('usage: node scripts/audit/audit-workbook.js <workbook.xlsx> [--json]');
        process.exit(2);
    }
    const report = auditWorkbook(file);
    if (args.includes('--json')) {
        console.log(JSON.stringify(report, null, 2));
        return;
    }
    console.log(`WORKBOOK: ${report.file}`);
    console.log(`SIZE: ${(report.sizeBytes / 1024 / 1024).toFixed(2)} MB   SHEETS: ${report.sheetCount}\n`);
    for (const s of report.sheets) {
        console.log('─'.repeat(78));
        console.log(`[${s.index}] "${s.name}"  [${s.visibility}]  ref=${s.ref}  rows=${s.dataRowCount}  cols=${s.declaredCols}`);
        console.log(`    header row: ${s.headerRowIndex >= 0 ? s.headerRowIndex + 1 : 'NOT FOUND'}`);
        if (s.headers.length) {
            console.log(`    columns(${s.headers.length}): ${s.headers.join(' | ')}`);
        }
        console.log(`    formulas: ${s.formulaCellCount}   errors: ${JSON.stringify(s.errorCounts)}`);
        if (s.errorCellSample.length) console.log(`    error cells: ${s.errorCellSample.join(', ')}`);
        for (const row of s.sampleRows) {
            console.log(`    · ${row.join(' | ')}`);
        }
    }
    console.log('─'.repeat(78));
}

if (require.main === module) main();
module.exports = { auditWorkbook };
