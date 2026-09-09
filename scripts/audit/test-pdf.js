/**
 * Reproduce & verify the PDF export fix (Task 11).
 * =================================================
 * Runs inside Electron, mirroring main.js's print:pdf handler:
 *   1. Prints a statement HTML with the OLD margins (10 inches) → documents the
 *      near-blank-page bug.
 *   2. Prints the same HTML with the FIXED margins (0.4") + tfoot→tbody move →
 *      verifies a valid multi-page PDF is produced.
 *   3. Prints a Devanagari-containing statement to check text encoding.
 * PDFs are saved to /tmp/prarambha-pdf-test/.
 *
 * Run: npx electron scripts/audit/test-pdf.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/prarambha-pdf-test';
fs.mkdirSync(OUT, { recursive: true });

const CSS = `
@page { size: A4; margin: 15mm 12mm 20mm 12mm; }
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Segoe UI','Helvetica Neue',Arial,sans-serif; font-size:10pt; color:#222; }
table { width:100%; border-collapse:collapse; font-size:9pt; }
thead { display: table-header-group; }
th, td { padding:5px 8px; border:1px solid #bbb; text-align:left; }
th { background:#1a5276; color:#fff; }
tr.total-row td { background:#e8edf2; font-weight:600; border-top:2px solid #bbb; }
`;

function moveTotalsIntoBody(html) {
    return html.replace(/<tbody>([\s\S]*?)<\/tbody>\s*<tfoot>([\s\S]*?)<\/tfoot>/gi,
        (m, body, foot) => '<tbody>' + body + foot.replace(/<tr/gi, '<tr class="total-row"') + '</tbody>');
}

function buildStatement(rows, name) {
    const entries = [];
    for (let i = 1; i <= rows; i++) {
        entries.push(`<tr><td>2083/0${(i % 5) + 1}/1${i % 9}</td><td>REF-${i}</td><td>sale</td><td>${name} — item ${i} विवरण नेपाली</td><td class="text-right">${1000 + i}</td><td class="text-right">-</td><td class="text-right">${100000 + i}</td></tr>`);
    }
    return `
        <div class="header"><h1>PRARAMBHA DAIRY SUPPLIERS</h1><h2>${name} — Statement of Account</h2><p>Period: 2083/03/15 to 2083/05/18</p></div>
        <table>
            <thead><tr><th>Date</th><th>Ref</th><th>Type</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                ${entries.join('')}
            </tbody>
            <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${rows * 1000}</strong></td><td class="text-right"><strong>-</strong></td><td class="text-right"><strong>${100000 + rows}</strong></td></tr></tfoot>
        </table>
        <div class="footer"><div>Printed: test</div><div class="signature">Authorized Signature</div></div>
    `;
}

function countPages(pdfBuffer) {
    const text = pdfBuffer.toString('latin1');
    const m = text.match(/\/Type\s*\/Page[^s]/g);
    return m ? m.length : -1;
}

let win = null;
async function renderPdf(html, margins, file) {
    if (!win) win = new BrowserWindow({ width: 800, height: 600, show: false });
    const full = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`;
    try {
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(full)}`);
    } catch (e) {
        return { ok: false, error: 'load failed: ' + e.message };
    }
    try {
        const pdf = await win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins
        });
        fs.writeFileSync(file, pdf);
        return { ok: true, bytes: pdf.length, pages: countPages(pdf) };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

app.whenReady().then(async () => {
    // 1. OLD margins (10 inches) — the reported bug
    const html = buildStatement(120, 'AAMOSH KIRANA');
    const old = await renderPdf(html, { top: 10, bottom: 10, left: 10, right: 10 }, path.join(OUT, 'old-margins.pdf'));
    console.log('OLD margins (10"):', old.ok ? `OK ${old.bytes} bytes, ${old.pages} page(s)` : `ERROR: ${old.error}`);

    // 2. FIXED margins + tfoot move
    const fixed = await renderPdf(moveTotalsIntoBody(html), { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, path.join(OUT, 'fixed-multipage.pdf'));
    console.log('FIXED (0.4", tfoot moved):', fixed.ok ? `OK ${fixed.bytes} bytes, ${fixed.pages} page(s)` : `ERROR: ${fixed.error}`);

    // 3. Devanagari short statement
    const dev = await renderPdf(moveTotalsIntoBody(buildStatement(12, 'नव दुर्गा किराना पसल')), { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, path.join(OUT, 'fixed-devanagari.pdf'));
    console.log('FIXED Devanagari (12 rows):', dev.ok ? `OK ${dev.bytes} bytes, ${dev.pages} page(s)` : `ERROR: ${dev.error}`);

    // 4. Short statement (single page)
    const short = await renderPdf(moveTotalsIntoBody(buildStatement(5, 'THE DARBAR PARTY PALACE')), { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }, path.join(OUT, 'fixed-short.pdf'));
    console.log('FIXED short (5 rows):', short.ok ? `OK ${short.bytes} bytes, ${short.pages} page(s)` : `ERROR: ${short.error}`);

    // Show where the total row landed in the transformed HTML
    const transformed = moveTotalsIntoBody(html);
    const snippet = transformed.split('</tbody>').pop();
    console.log('\ntfoot present after transform:', /<tfoot>/.test(transformed));
    console.log('total-row in tbody:', /<tbody>[\s\S]*?class="total-row"/.test(transformed));

    console.log('\nPDFs written to ' + OUT);
    app.quit();
});