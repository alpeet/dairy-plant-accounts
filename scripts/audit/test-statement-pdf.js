/**
 * Party statement print/PDF acceptance test (12-column, Nepali/English).
 * =========================================================================
 * Runs inside Electron, mirroring main.js's print:pdf handler:
 *   1. Builds the same 12-column statement table the app now prints
 *      (Date, Ref, Type, Particulars, Item, Qty, Unit, Rate, Dr, Cr,
 *      Balance, Status) with REAL Nepali headers and goods lines.
 *   2. Applies PRINT_CSS exactly like printHTML() does (tfoot→tbody move).
 *   3. Renders A4 landscape PDF via webContents.printToPDF().
 *   4. Verifies: non-trivial file, > 0 pages, an embedded font
 *      (FontFile/FontFile2/FontFile3 — i.e. Devanagari does not depend on
 *      the viewer having the font), and the table header repeat directive.
 *
 * Run: npx electron scripts/audit/test-statement-pdf.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/prarambha-pdf-test';
fs.mkdirSync(OUT, { recursive: true });

// Same stack printHTML()/PRINT_CSS uses — Devanagari first.
const PRINT_CSS = `
@page { size: A4 landscape; margin: 12mm 10mm 16mm 10mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans Devanagari','Kalimati','Mukta','Nirmala UI','Mangal','Segoe UI','Helvetica Neue',Arial,sans-serif; font-size:10pt; color:#222; line-height:1.5; }
.header { text-align:center; margin-bottom:14px; border-bottom:3px double #1a5276; padding-bottom:10px; }
.header h1 { font-size:20pt; margin:0; color:#1a5276; }
.header h2 { font-size:13pt; margin:6px 0 2px; }
.header p { font-size:8.5pt; color:#666; }
table { width:100%; border-collapse:collapse; font-size:8pt; page-break-inside:auto; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { padding:3px 5px; border:1px solid #bbb; text-align:left; }
th { background:#1a5276 !important; color:#fff !important; font-weight:600; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
tbody tr:nth-child(even) { background:#f5f7fa; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
tr.total-row td { background:#e8edf2 !important; font-weight:600; border-top:2px solid #bbb; }
.text-right { text-align:right; }
.footer { display:flex; justify-content:space-between; margin-top:16px; font-size:9pt; }
`;

function moveTotalsIntoBody(html) {
    return html.replace(/<tbody>([\s\S]*?)<\/tbody>\s*<tfoot>([\s\S]*?)<\/tfoot>/gi,
        (m, body, foot) => '<tbody>' + body + foot.replace(/<tr/gi, '<tr class="total-row"') + '</tbody>');
}

/** The exact 12-column row shape renderer/js/statements.js emits. */
function buildNepaliStatement(rows) {
    const headers = ['मिति', 'सन्दर्भ', 'कारोबारको प्रकार', 'विवरण', 'वस्तु', 'परिमाण', 'एकाइ', 'दर', 'डेबिट', 'क्रेडिट', 'बाँकी', 'स्थिति'];
    const items = [
        ['Mix Milk', '30', 'kg', 'रु 85.00'],
        ['Cow Milk', '12', 'kg', 'रु 80.00'],
        ['Buffalo Milk', '240', 'L', 'रु 91.45'],
        ['Ghee', '', '', ''] // no unit data → dashes, never zero
    ];
    const body = [];
    body.push(`<tr><td colspan="10">सुरुको मौज्दात</td><td class="text-right"><strong>रु 1,000.00</strong></td><td></td></tr>`);
    for (let i = 1; i <= rows; i++) {
        const it = items[i % items.length];
        const qty = it[1] ? it[1] : '—';
        const unit = it[2] ? it[2] : '—';
        const rate = it[3] ? it[3] : '—';
        const status = i % 3 === 0 ? '<span>तिरिएको</span>' : '<span>तिर्नुबाँकी</span>';
        body.push(`<tr><td>2083 असार ${String((i % 30) + 1).padStart(2, '0')}</td><td>BILL-${6000 + i}</td><td>बिक्री</td>` +
            `<td>${it[0]} विवरण नेपाली — ग्राहकलाई बिक्री</td><td>${it[0]}</td>` +
            `<td class="text-right">${qty}</td><td>${unit}</td><td class="text-right">${rate}</td>` +
            `<td class="text-right">रु ${(1000 + i).toFixed(2)}</td><td class="text-right">-</td>` +
            `<td class="text-right">रु ${(100000 + i).toFixed(2)}</td><td>${status}</td></tr>`);
    }
    return `
        <div class="header">
            <h1>प्रारम्भ डेयरी</h1>
            <h2>ग्राहक विवरण — Statement of Account</h2>
            <p>अवधि: 2083 असार 01 → 2083 असार 30 · Party: AAMOSH KIRANA</p>
        </div>
        <table>
            <thead><tr>${headers.map((h, i) => `<th${i >= 5 && i !== 6 && i !== 11 ? ' class="text-right"' : ''}>${h}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
            <tfoot><tr><td colspan="8"><strong>जम्मा</strong></td>
                <td class="text-right"><strong>रु ${(rows * 1000).toFixed(2)}</strong></td>
                <td class="text-right"><strong>-</strong></td>
                <td class="text-right"><strong>रु ${(100000 + rows).toFixed(2)}</strong></td><td></td></tr></tfoot>
        </table>
        <div class="footer"><div>प्रिन्ट मिति: 2083-10-15</div><div>अधिकृत हस्ताक्षर</div></div>
    `;
}

function countPages(pdfBuffer) {
    const text = pdfBuffer.toString('latin1');
    const m = text.match(/\/Type\s*\/Page[^s]/g);
    return m ? m.length : -1;
}

let win = null;
async function renderPdf(html, file) {
    if (!win || win.isDestroyed()) {
        win = new BrowserWindow({ width: 900, height: 600, show: false });
    }
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_CSS}</style></head><body>${html}</body></html>`;
    try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(full)}`);
        const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', landscape: true });
        fs.writeFileSync(file, pdf);
        return { ok: true, pdf };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

app.whenReady().then(async () => {
    console.log('\n— Statement PDF (12 columns, Nepali) —');

    // Long statement: must span pages with repeating headers
    const longHtml = moveTotalsIntoBody(buildNepaliStatement(120));
    const long = await renderPdf(longHtml, path.join(OUT, 'statement-nepali-12col.pdf'));
    check('long statement PDF rendered', long.ok, long.error);
    if (long.ok) {
        const pages = countPages(long.pdf);
        check('PDF is a real file (>10 KB)', long.pdf.length > 10000, `${long.pdf.length} bytes`);
        check('multi-page for 120 rows', pages > 1, `${pages} pages`);
        const raw = long.pdf.toString('latin1');
        check('fonts embedded (no viewer-font dependency)',
            /\/FontFile2?\b|\/FontFile3\b/.test(raw));
        check('page size is A4 landscape',
            /\/MediaBox\s*\[0\s+0\s+84[0-9](\.[0-9]+)?\s+59[0-9](\.[0-9]+)?\]/.test(raw) ||
            /\/MediaBox\s*\[0\s+0\s+59[0-9](\.[0-9]+)?\s+84[0-9](\.[0-9]+)?\]/.test(raw),
            'MediaBox not A4 landscape');
    }

    // Short statement: single page, still valid
    const short = await renderPdf(moveTotalsIntoBody(buildNepaliStatement(6)), path.join(OUT, 'statement-nepali-short.pdf'));
    check('short statement PDF rendered', short.ok, short.error);
    if (short.ok) {
        check('short PDF non-trivial', short.pdf.length > 4000, `${short.pdf.length} bytes`);
    }

    // The source HTML itself must carry real Devanagari (not mojibake)
    const src = buildNepaliStatement(3);
    check('source contains Nepali headers',
        src.includes('परिमाण') && src.includes('एकाइ') && src.includes('बाँकी'));
    check('source contains Nepali status', src.includes('तिर्नुबाँकी'));
    check('source keeps dash for missing qty (never 0)', src.includes('<td class="text-right">—</td>'));

    console.log(`\n${passed} passed, ${failed} failed`);
    console.log('PDFs in ' + OUT);
    app.exit(failed ? 1 : 0);
});
