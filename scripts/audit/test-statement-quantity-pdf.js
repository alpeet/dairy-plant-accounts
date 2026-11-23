/**
 * Party statement print/PDF acceptance test (quantity + milk type + shift).
 * ==========================================================================
 * Runs the REAL document builder from renderer/js/statements.js (loaded in a
 * sandbox with the renderer helpers stubbed), then prints it exactly the way
 * main.js's print:pdf handler does:
 *   · PRARAMBHA print.css + `@page { size: A4 landscape; }`
 *   · Electron webContents.printToPDF, A4 landscape, displayHeaderFooter
 *   · "Page X of Y" footer + a report line on the left
 *
 * Verifies the PDF honestly: real %PDF file, several pages, A4 LANDSCAPE media
 * box, complete %%EOF, the suggested filename, and that the document the PDF
 * was printed from contains the repeated table header, the quantity columns,
 * the quantity summary and the filters line. Also rasterises the pages through
 * Chromium's own PDF viewer for visual inspection when it is available.
 *
 * Run: PVS_DB=/tmp/copy.db npx electron scripts/audit/test-statement-quantity-pdf.js
 */

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const DB_PATH = process.env.PVS_DB || path.join(ROOT, "data", "dairy-plant.db");
const OUT = process.env.OUT_DIR || "/tmp/prarambha-statement-qty";
fs.mkdirSync(OUT, { recursive: true });

const HTML_PATH = path.join(OUT, "statement-quantity.html");
const META_PATH = path.join(OUT, "meta.json");

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  \u2713 ${name}`); }
    else { failed++; console.error(`  \u2717 ${name}${detail ? " \u2014 " + detail : ""}`); }
}

function pdfPageCount(pdf) {
    const m = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
    return m ? m.length : -1;
}

/** Plain node builds the document (better-sqlite3 is a node ABI module). */
function buildDocument() {
    const res = require("child_process").spawnSync(process.env.NODE_BIN || "node", ["scripts/audit/build-statement-quantity-html.js"], {
        cwd: ROOT,
        env: { ...process.env, PVS_DB: DB_PATH, OUT_DIR: OUT },
        encoding: "utf8"
    });
    if (res.status !== 0) throw new Error("Could not build the statement document: " + ((res.stderr || res.stdout || "").trim()));
    return JSON.parse(fs.readFileSync(META_PATH, "utf8"));
}

app.whenReady().then(async () => {
    let win = null;
    try {
        const meta = buildDocument();
        const doc = fs.readFileSync(HTML_PATH, 'utf8');
        check('statement document built from the real renderer', meta.html.length > 8000, meta.html.length + ' bytes');
        check('quantity summary present in the print document', meta.html.includes('stmt-qty-summary'));
        check('Milk Type + Shift columns present',
            meta.html.includes('Milk Type') && meta.html.includes('Shift'));
        check('quantity and rate columns present',
            meta.html.includes('>Quantity<') || meta.html.includes('Quantity</th>'));
        check('table header repeats on every page',
            /thead\s*\{\s*display:\s*table-header-group/.test(doc));
        check('fixed column plan keeps columns on the page', meta.html.includes('table-layout: fixed'));
        check('document is A4 landscape', /size:\s*A4 landscape/.test(meta.html));
        check('closing balance + generated date in the document',
            meta.html.includes('Closing Balance') && meta.html.includes('Generated'));
        check('filtered document names its filters',
            meta.filteredHtml.includes('Milk Type: Cow') && meta.filteredHtml.includes('Shift: Morning'));
        check('filtered document shows a smaller quantity summary',
            !meta.filteredHtml.includes('Buffalo Milk'));

        win = new BrowserWindow({ width: 1200, height: 900, show: false });
        await win.loadFile(HTML_PATH);

        const footer = String(`${meta.party} — Statement of Account (2083-03-01 → 2083-04-32)`)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const pdf = await win.webContents.printToPDF({
            printBackground: true,
            landscape: true,
            pageSize: 'A4',
            margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
            displayHeaderFooter: true,
            headerTemplate: '<span></span>',
            footerTemplate: '<div style="width:100%;padding:0 10mm;font-size:7pt;color:#777;font-family:Arial,Helvetica,sans-serif;">'
                + '<span>' + footer + '</span>'
                + '<span style="float:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>'
                + '</div>'
        });

        const pdfPath = path.join(OUT, meta.filename);
        fs.writeFileSync(pdfPath, pdf);

        const size = fs.statSync(pdfPath).size;
        const pages = pdfPageCount(pdf);
        const header = pdf.slice(0, 5).toString('latin1');
        const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);

        check('PDF written with the statement filename', fs.existsSync(pdfPath) && /\.pdf$/.test(pdfPath), pdfPath);
        check('real %PDF file (not renamed HTML)', header === '%PDF-', header);
        check('PDF is substantial', size > 20000, size + ' bytes');
        check('multi-page statement (rows exceed one page)', pages > 1, pages + ' pages');
        check('page media box is A4 landscape (842 × 595 pt)', !!mediaBox
            && Math.abs(Number(mediaBox[1]) - 842) < 3 && Math.abs(Number(mediaBox[2]) - 595) < 3,
            mediaBox && mediaBox.slice(1).join(' x '));
        check('PDF ends with %%EOF (complete file)', pdf.toString('latin1').trimEnd().endsWith('%%EOF'));

        console.log(`\n   HTML: ${HTML_PATH}`);
        console.log(`   PDF : ${pdfPath}`);
        console.log(`   pages: ${pages}, size: ${(size / 1024).toFixed(1)} KB`);

        // Print-media rendering of the SAME document at A4-landscape content
        // width, so the bottom of the statement (quantity summary, closing
        // balance, signature) can be inspected visually.
        try {
            win.setSize(1100, 1400);
            win.webContents.debugger.attach('1.3');
            await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { media: 'print' });
            await win.loadFile(HTML_PATH);
            await new Promise(r => setTimeout(r, 800));
            const overflow = await win.webContents.executeJavaScript(`
                (() => {
                    const cells = [...document.querySelectorAll('table.stmt-table td.num')];
                    const clipped = cells.filter(td => td.scrollWidth > td.clientWidth + 1);
                    return { cells: cells.length, clipped: clipped.length,
                             sample: clipped.slice(0, 3).map(td => td.textContent.trim()).join(' | ') };
                })()`);
            check('no amount is clipped inside its column', overflow.clipped === 0,
                `${overflow.clipped} of ${overflow.cells} numeric cells: ${overflow.sample}`);
            const top = await win.webContents.capturePage();
            fs.writeFileSync(path.join(OUT, 'print-media-top.png'), top.toPNG());
            await win.webContents.executeJavaScript('window.scrollTo(0, document.body.scrollHeight); 1');
            await new Promise(r => setTimeout(r, 500));
            const bottom = await win.webContents.capturePage();
            fs.writeFileSync(path.join(OUT, 'print-media-bottom.png'), bottom.toPNG());
            check('print-media screenshots captured',
                fs.statSync(path.join(OUT, 'print-media-bottom.png')).size > 5000);
        } catch (e) {
            check('print-media rendering available', false, e.message);
        }

        // Visual page check through Chromium's own PDF viewer (when available).
        try {
            const viewer = new BrowserWindow({
                width: 1400, height: 900, show: false,
                webPreferences: { plugins: true }
            });
            await viewer.loadURL('file://' + pdfPath);
            await new Promise(r => setTimeout(r, 2500));
            const shot1 = await viewer.webContents.capturePage();
            fs.writeFileSync(path.join(OUT, 'pdf-page-1.png'), shot1.toPNG());
            viewer.destroy();

            // A fresh viewer honours #page=N on load — capture the last page,
            // where the totals, closing balance and quantity summary sit.
            const lastPage = new BrowserWindow({
                width: 1400, height: 900, show: false,
                webPreferences: { plugins: true }
            });
            await lastPage.loadURL('file://' + pdfPath + '#page=' + pages);
            await new Promise(r => setTimeout(r, 3000));
            fs.writeFileSync(path.join(OUT, 'pdf-last-page.png'), (await lastPage.webContents.capturePage()).toPNG());
            lastPage.destroy();
            check('PDF page images captured for visual inspection',
                fs.statSync(path.join(OUT, 'pdf-page-1.png')).size > 5000,
                fs.statSync(path.join(OUT, 'pdf-page-1.png')).size + ' bytes');
            check('PDF last-page image captured',
                fs.statSync(path.join(OUT, 'pdf-last-page.png')).size > 5000);
        } catch (e) {
            console.log('   (PDF page rasterisation unavailable: ' + e.message + ')');
        }

        win.destroy();
    } catch (err) {
        failed++;
        console.error('PDF verification failed:', err && err.stack ? err.stack : err);
    }

    console.log(`\n═══════════════════════════════════════════`);
    console.log(`  Statement quantity PDF: ${passed} passed, ${failed} failed`);
    console.log(`═══════════════════════════════════════════\n`);
    app.exit(failed > 0 ? 1 : 0);
});
