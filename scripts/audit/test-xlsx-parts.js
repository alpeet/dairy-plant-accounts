#!/usr/bin/env node
/**
 * test-xlsx-parts.js — lossless .xlsx worksheet surgery
 * =====================================================
 *   node scripts/audit/test-xlsx-parts.js
 *
 * Exit 0 = all checks pass, 1 = at least one failure.
 *
 * Why this test exists: inserting the "Monthly Report " sheet by
 * `XLSX.readFile()` → `XLSX.writeFile()` silently destroyed the customer
 * workbook's 72 fonts / 32 fills / 296 number formats, its chart, its Excel
 * table and its printer settings (caught 2026-10-17). shared/xlsx-parts.js now
 * splices the sheet in at the zip-part level; these checks prove that
 *  - every pre-existing part survives byte for byte,
 *  - the new sheet is readable by an INDEPENDENT reader (SheetJS),
 *  - sheet names keep their exact form (the trailing space in "Monthly Report "),
 *  - a second run refreshes in place instead of creating a duplicate, and
 *  - number styles are appended, never rewritten.
 *
 * Builds its own throwaway workbook in /tmp — it never touches
 * Dairy_Accounts_Professional.xlsx.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..', '..');
const { readZip, appendOrReplaceSheet } = require(path.join(ROOT, 'shared', 'xlsx-parts'));

let passed = 0, failed = 0, total = 0;
const check = (name, cond, detail = '') => {
    total++;
    if (cond) { passed++; console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`); }
    else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── A minimal but real .xlsx, built by hand so we control every part ──
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Original" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`;

const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Original sheet</t></is></c><c r="B1"><v>42</v></c></row></sheetData>
</worksheet>`;

function buildFixture(file) {
    const { writeZip } = require(path.join(ROOT, 'shared', 'xlsx-parts'));
    const entries = {
        '[Content_Types].xml': CONTENT_TYPES,
        '_rels/.rels': ROOT_RELS,
        'xl/workbook.xml': WORKBOOK,
        'xl/_rels/workbook.xml.rels': WORKBOOK_RELS,
        'xl/styles.xml': STYLES,
        'xl/worksheets/sheet1.xml': SHEET1
    };
    const order = Object.keys(entries);
    const map = new Map(order.map(n => [n, { data: Buffer.from(entries[n], 'utf8'), method: 0 }]));
    fs.writeFileSync(file, writeZip(order, map));
}

console.log('\n' + '─'.repeat(70));
console.log('  🧪 TEST: xlsx-parts — lossless worksheet surgery');
console.log('─'.repeat(70));

try {
    const file = path.join(os.tmpdir(), `xlsx-parts-test-${process.pid}.xlsx`);
    buildFixture(file);

    const origZip = readZip(fs.readFileSync(file));
    const origSheet1 = origZip.entries.get('xl/worksheets/sheet1.xml').data;

    // 1. An independent reader (SheetJS) must accept what writeZip produced.
    let wb = XLSX.readFile(file, { cellStyles: true });
    check('fixture written by the zip writer opens in SheetJS', wb.SheetNames.length === 1 && wb.Sheets.Original.B1.v === 42);

    // 2. Adding the sheet — exact name with its trailing space.
    const aoa = [
        ['Monthly Report '],
        ['Amount (Rs)', 1234.5],
        ['Angle & <quote> test', 7]
    ];
    const res1 = appendOrReplaceSheet(file, 'Monthly Report ', {
        aoa,
        columnWidths: [40, 18],
        freezeRow: 1,
        autoFilter: 'A1:B1',
        isMoney: (r, c) => !(r === 0 && c === 1),
        isDecimal: () => false,
        isInteger: () => false
    });
    check('append reports created', res1.created === true, res1.part);
    check('append returns the sheet list', res1.sheets.length === 2, JSON.stringify(res1.sheets));

    wb = XLSX.readFile(file, { cellStyles: true });
    check('independent reader sees both sheets', wb.SheetNames.length === 2, JSON.stringify(wb.SheetNames));
    check('sheet name keeps its exact trailing space',
        wb.SheetNames.includes('Monthly Report '), JSON.stringify(wb.SheetNames[1]));
    const mr = wb.Sheets['Monthly Report '];
    check('sheet cells readable', !!mr && mr.A1.v === 'Monthly Report ' && mr.B2.v === 1234.5);
    check('XML special characters round-trip', !!mr && mr.A3.v === 'Angle & <quote> test', mr && mr.A3.v);
    // SheetJS only parses <cols> when cellStyles is on (its own round-trip
    // loses it too), so read widths with that option and take the raw width.
    check('column widths were written', Array.isArray(mr['!cols'])
        && mr['!cols'][0] && Number(mr['!cols'][0].width) === 40,
    JSON.stringify(mr['!cols']));

    // 3. Every pre-existing CONTENT part must be byte identical. Only the four
    //    workbook-metadata parts may change when a sheet is registered.
    const MUTABLE = new Set([
        '[Content_Types].xml', 'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels', 'xl/styles.xml'
    ]);
    const zipAfter1 = readZip(fs.readFileSync(file));
    let identical = 0;
    for (const name of origZip.order) {
        if (MUTABLE.has(name)) continue;
        const a = origZip.entries.get(name).data;
        const b = zipAfter1.entries.get(name) && zipAfter1.entries.get(name).data;
        if (b && a.equals(b)) identical++;
        else console.log(`       part changed: ${name}`);
    }
    const contentParts = origZip.order.filter(n => !MUTABLE.has(n)).length;
    check('every original content part byte-identical after adding', identical === contentParts,
        `${identical}/${contentParts}`);
    check('original sheet1 part untouched',
        zipAfter1.entries.get('xl/worksheets/sheet1.xml').data.equals(origSheet1));

    // 4. Only the four expected parts changed / one part added.
    check('exactly one new part (the new sheet)', zipAfter1.order.filter(n => !origZip.entries.has(n)).length === 1,
        JSON.stringify(zipAfter1.order.filter(n => !origZip.entries.has(n))));
    check('styles gained cell formats (not rewritten)',
        /<cellXfs[^>]*count="4"/.test(zipAfter1.entries.get('xl/styles.xml').data.toString('utf8')));
    check('content types declares the new worksheet',
        zipAfter1.entries.get('[Content_Types].xml').data.toString('utf8').includes('/xl/worksheets/sheet2.xml'));
    check('workbook rels points at the new part',
        zipAfter1.entries.get('xl/_rels/workbook.xml.rels').data.toString('utf8').includes('worksheets/sheet2.xml'));

    // 5. A second run must REFRESH in place — no duplicate sheet, same part.
    const res2 = appendOrReplaceSheet(file, 'Monthly Report', {   // no trailing space
        aoa: [['Refreshed'], [999.25]],
        columnWidths: [40, 18]
    });
    check('refresh reports created=false', res2.created === false);
    check('refresh reuses the same part', res2.part === res1.part, res2.part);
    wb = XLSX.readFile(file, { cellStyles: true });
    check('still exactly two sheets after refresh', wb.SheetNames.length === 2, JSON.stringify(wb.SheetNames));
    const mr2 = wb.Sheets['Monthly Report '];
    check('refresh replaced the contents', !!mr2 && mr2.A1 && mr2.A1.v === 'Refreshed'
        && mr2.A2 && mr2.A2.v === 999.25);
    // Comparing against the POST-CREATE state: a refresh may only rewrite the
    // Monthly Report sheet itself — in particular it must NOT append the number
    // formats to styles.xml a second time.
    const zipAfter2 = readZip(fs.readFileSync(file));
    let unchanged = 0;
    const drifted = [];
    for (const name of zipAfter1.order) {
        if (name === res1.part) continue;
        const a = zipAfter1.entries.get(name).data;
        const b = zipAfter2.entries.get(name) && zipAfter2.entries.get(name).data;
        if (b && a.equals(b)) unchanged++; else drifted.push(name);
    }
    check('refresh rewrites only the sheet part (styles.xml not duplicated)', drifted.length === 0,
        `${unchanged} unchanged, drifted: ${JSON.stringify(drifted)}`);
    check('styles.xml did not grow on refresh',
        zipAfter1.entries.get('xl/styles.xml').data.equals(zipAfter2.entries.get('xl/styles.xml').data));

    // 6. Bad input fails loudly instead of corrupting anything.
    const junk = path.join(os.tmpdir(), `xlsx-parts-junk-${process.pid}.xlsx`);
    fs.writeFileSync(junk, Buffer.from('this is not a zip file at all'));
    let threw = false;
    try { appendOrReplaceSheet(junk, 'Monthly Report ', { aoa: [] }); } catch (e) { threw = true; }
    check('non-zip input throws instead of writing corruption', threw);

    fs.rmSync(file, { force: true });
    fs.rmSync(junk, { force: true });
} catch (err) {
    failed++;
    total++;
    console.log(`  ❌ test crashed: ${err.message}`); console.log(err.stack);
}

console.log('\n' + '─'.repeat(70));
console.log(`  Result: ${passed}/${total} passed${failed ? `, ${failed} FAILED` : ''}`);
console.log('─'.repeat(70) + '\n');
process.exit(failed ? 1 : 0);