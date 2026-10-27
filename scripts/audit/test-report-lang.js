/**
 * Report language — proves the shared language layer works for both the
 * screens and the printed/PDF documents.
 *
 *   node scripts/audit/test-report-lang.js
 *
 * The renderer module is a classic browser script, so this harness gives it
 * just enough of a DOM (localStorage, document, window) to run under Node and
 * then exercises the real functions the report screens call.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', '..', 'renderer', 'js', 'report-lang.js');
const code = fs.readFileSync(SRC, 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
    if (cond) { pass++; return; }
    fails.push(name + (detail ? ' — ' + detail : ''));
}

function makeEnv(stored) {
    const store = Object.assign({}, stored || {});
    const elements = [];
    const document = {
        readyState: 'complete',
        addEventListener() {},
        querySelectorAll(sel) { return sel === '#reportLangGlobal, .report-lang-select, .report-lang-picker select' ? elements : []; },
        getElementById() { return null; },
        createElement() {
            const el = { innerHTML: '', firstChild: null, firstElementChild: null, className: '', dataset: {} };
            Object.defineProperty(el, 'innerHTML', {
                set(v) {
                    el._html = v;
                    const m = /<select[^>]*>[\s\S]*?<\/select>/.exec(v) || [v];
                    el.firstElementChild = { outerHTML: m[0], className: 'report-lang-picker' };
                },
                get() { return el._html || ''; }
            });
            return el;
        }
    };
    const localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; }
    };
    const printed = [];
    const pdfs = [];
    const window = {
        localStorage,
        document,
        printHTML(html) { printed.push(html); },
        api: {
            printToPDF(opts) { pdfs.push(opts); return Promise.resolve({ success: true }); }
        }
    };
    window.window = window;
    const ctx = {
        window,
        document,
        localStorage,
        setTimeout: (fn) => fn(),
        console,
        Math,
        Object,
        JSON,
        String,
        Number,
        RegExp
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: 'report-lang.js' });
    return { window, ctx, printed, pdfs, store };
}

// ── 1. Default language ────────────────────────────────────────────────
{
    const env = makeEnv();
    ok('default language is English', env.window.getReportLang() === 'en', env.window.getReportLang());
    ok('rl() returns English by default', env.window.rl('Total', 'जम्मा') === 'Total');
    ok('rlt() returns the English term', env.window.rlt('total_income') === 'Total Income');
}

// ── 2. Selecting Nepali ────────────────────────────────────────────────
{
    const env = makeEnv();
    env.window.setReportLang('np');
    ok('Nepali is stored', env.store.reportLang === 'np', env.store.reportLang);
    ok('getReportLang reports np', env.window.getReportLang() === 'np');
    ok('rl() returns Nepali', env.window.rl('Total', 'जम्मा') === 'जम्मा', env.window.rl('Total', 'जम्मा'));
    ok('rlt() returns Nepali', env.window.rlt('total_income') === 'कुल आम्दानी', env.window.rlt('total_income'));

    const env2 = makeEnv({ reportLang: 'np' });
    ok('Nepali survives a reload', env2.window.getReportLang() === 'np');
}

// ── 3. Legacy value 'ne' must not fall back to English ─────────────────
{
    const env = makeEnv({ reportLang: 'ne' });
    ok("legacy 'ne' loads as Nepali", env.window.getReportLang() === 'np', env.window.getReportLang());
    env.window.setReportLang('ne');
    ok("setReportLang('ne') stores 'np'", env.store.reportLang === 'np', env.store.reportLang);
}

// ── 4. Bilingual mode ──────────────────────────────────────────────────
{
    const env = makeEnv();
    env.window.setReportLang('both');
    ok('both: rl shows English / Nepali', env.window.rl('Total', 'जम्मा') === 'Total / जम्मा');
    ok('both: rlt shows both', env.window.rlt('date') === 'Date / मिति', env.window.rlt('date'));
}

// ── 5. Subscribers re-render on change ─────────────────────────────────
{
    const env = makeEnv();
    let calls = 0;
    env.window.onReportLangChange(() => { calls++; }, 'screen');
    env.window.setReportLang('np');
    ok('subscriber fired once on change', calls === 1, String(calls));
    env.window.setReportLang('np');
    ok('subscriber not fired when unchanged', calls === 1, String(calls));
    env.window.setReportLang('en');
    ok('subscriber fired again on real change', calls === 2, String(calls));
}

// ── 6. Printed document translation ────────────────────────────────────
{
    const env = makeEnv();
    const doc = '<html><head><title>Sales Report</title></head><body>' +
        '<div class="header"><h1>Prarambha Dairy</h1><h2>Daily Cash Collection Report</h2></div>' +
        '<table><thead><tr><th>Date</th><th class="text-right">Amount</th><th>Party</th></tr></thead>' +
        '<tbody><tr><td>2083-03-32</td><td>176877.78</td><td>Date Suppliers</td></tr></tbody></table>' +
        '<div class="value-card"><div class="value-label">Total Cash In</div><div>100</div></div></body></html>';

    const asEnglish = env.window.localizeReportHtml(doc);
    ok('English leaves the document alone', asEnglish.indexOf('<th>Date</th>') !== -1);

    env.window.setReportLang('np');
    const np = env.window.localizeReportHtml(doc);
    ok('heading translated', np.indexOf('<th>मिति</th>') !== -1, np.slice(0, 200));
    ok('column label translated', np.indexOf('रकम') !== -1);
    ok('report title translated', np.indexOf('दैनिक नगद संकलन प्रतिवेदन') !== -1);
    ok('document language tag set', np.indexOf('lang="ne"') !== -1);
    ok('transaction date untouched', np.indexOf('2083-03-32') !== -1);
    ok('amount untouched', np.indexOf('176877.78') !== -1);
    ok('party name untouched (not translated inside td)', np.indexOf('Date Suppliers') !== -1);
    ok('business name untouched', np.indexOf('Prarambha Dairy') !== -1);

    env.window.setReportLang('both');
    const both = env.window.localizeReportHtml(doc);
    ok('both: header shows both', both.indexOf('मिति / Date') !== -1 || both.indexOf('Date / मिति') !== -1, both.slice(0, 200));

    const again = env.window.localizeReportHtml(np);
    ok('translation is idempotent', again.indexOf('रकम') !== -1 && again.indexOf('Date / ') === -1);
}

// ── 7. Every Print button and every PDF export honours it ──────────────
{
    const env = makeEnv();
    env.window.setReportLang('np');
    env.window.printHTML('<table><thead><tr><th>Date</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>');
    ok('printHTML wrapper ran', env.printed.length === 1);
    ok('printed heading is Nepali', env.printed[0].indexOf('मिति') !== -1);
    ok('printHTML wrapper is installed once', env.window.printHTML.__langWrapped === true);
    ok('printToPDF wrapper is installed', env.window.api.printToPDF.__langWrapped === true);

    env.window.api.printToPDF({ html: '<table><thead><tr><th>Total</th></tr></thead></table>' })
        .then(() => {
            ok('PDF html localized before it is sent', env.pdfs.length === 1 && env.pdfs[0].html.indexOf('जम्मा') !== -1);
            finish();
        });
}

function finish() {
    console.log('');
    if (fails.length) {
        console.log('FAILED ' + fails.length + ' of ' + (pass + fails.length) + ' checks:');
        fails.forEach(f => console.log('  ✗ ' + f));
        process.exit(1);
    }
    console.log('OK — ' + pass + ' report-language checks passed.');
}
