/**
 * Builds the REAL party-statement print document (renderer/js/statements.js
 * buildStatementHtml) for the Electron PDF acceptance test.
 *
 * Plain node, because better-sqlite3 is compiled for node's ABI; Electron only
 * renders the finished HTML.
 *
 * Usage: PVS_DB=/tmp/copy.db node scripts/audit/build-statement-quantity-html.js
 * Writes <OUT_DIR>/statement-quantity.html + meta.json
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.PVS_DB || path.join(ROOT, 'data', 'dairy-plant.db');
const OUT = process.env.OUT_DIR || '/tmp/prarambha-statement-qty';
fs.mkdirSync(OUT, { recursive: true });

const HTML_PATH = path.join(OUT, 'statement-quantity.html');
const META_PATH = path.join(OUT, 'meta.json');

function loadStatementBuilder() {
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'statements.js'), 'utf8');
    const labels = {
        quantity: 'Quantity', rate: 'Rate', debit: 'Debit', credit: 'Credit',
        balance: 'Balance', reference: 'Reference', transaction_type: 'Transaction Type',
        status: 'Status', opening_balance: 'Opening Balance', closing_balance: 'Closing Balance',
        total: 'Total', particulars: 'Particulars', period: 'Period', amount: 'Amount',
        customer: 'Customer', supplier: 'Supplier', pdf: 'PDF', print: 'Print', generate: 'Generate'
    };
    const ctx = {
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        console,
        rl: (en) => en,
        rlt: (k) => labels[k] || k,
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        formatCurrency: (v) => 'Rs ' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        formatDate: (d) => String(d || ''),
        formatNumber: (v) => String(v),
        showToast: () => {},
        getSettingsCached: async () => ({}),
        printHTML: () => {},
        moveTotalsIntoBody: (h) => h,
        Date,
        Intl
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'renderer/js/statements.js' });
    return ctx;
}

const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const db = new Database(DB_PATH, { readonly: true });
const ops = require(path.join(ROOT, 'shared', 'operations', 'statements.js'));

const supplier = db.prepare(`SELECT party_id AS id FROM milk_collections
    GROUP BY party_id HAVING COUNT(*) > 20 ORDER BY COUNT(*) DESC LIMIT 1`).get();
const from = '2083-03-01';
const to = '2083-04-32';

const data = ops.getPartyStatement(db, { party_id: supplier.id, from_date: from, to_date: to });
const sandbox = loadStatementBuilder();
const settings = { business_name: 'PRARAMBHA DAIRY & STOCK' };

const html = sandbox.buildStatementHtml(data, settings);
const filtered = ops.getPartyStatement(db, {
    party_id: supplier.id, from_date: from, to_date: to, milk_type: 'cow', shift: 'morning'
});
const filteredHtml = sandbox.buildStatementHtml(filtered, settings);

const printCss = fs.readFileSync(path.join(ROOT, 'renderer', 'css', 'print.css'), 'utf8');
const doc = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Party Statement</title>'
    + '<style>' + printCss + '</style><style>@page { size: A4 landscape; }</style></head><body>'
    + html + '</body></html>';
fs.writeFileSync(HTML_PATH, doc, 'utf8');

const safe = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
const meta = {
    party: data.party.name,
    from_date: from,
    to_date: to,
    rows: data.entries.length,
    htmlLength: html.length,
    htmlLengthFiltered: filteredHtml.length,
    filename: `Party_Statement_${safe(data.party.name)}_${from}_to_${to}.pdf`,
    html,
    filteredHtml,
    qty: data.qty_summary
};
fs.writeFileSync(META_PATH, JSON.stringify(meta), 'utf8');

db.close();
console.log(`Built ${meta.filename} — ${meta.rows} rows, ${meta.htmlLength} bytes of HTML`);
