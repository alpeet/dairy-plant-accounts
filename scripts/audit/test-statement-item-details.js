/**
 * Party Statement — item-level lines, item-wise quantity totals, column settings.
 *
 * Proves:
 *  1. a bill with several products (Mixed Milk, Cow Milk, Paneer, Ghee, Nauni)
 *     is shown as one line per item, each with its own quantity, unit and rate;
 *  2. the bill's debit / credit appears ONCE — a multi-item bill never repeats
 *     its total, and running balance / closing balance are untouched;
 *  3. item-wise quantity totals keep every product and every unit separate
 *     (litres are never added to kilograms), and purchases stay apart from
 *     sales; payment rows contribute nothing;
 *  4. column settings: supplier defaults include Shift, customer defaults hide
 *     it, a hidden column can be re-enabled, and the choice survives a restart;
 *  5. the screen table, the printed page and the PDF use the SAME columns,
 *     repeat the table header, and never change an amount when a column is
 *     hidden.
 *
 * Engine checks run against a /tmp COPY of the live database with one synthetic
 * multi-item bill inserted into the copy only — the live database is never
 * opened for writing and no historical row is modified.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP_DB = path.join(os.tmpdir(), `stmt-item-detail-test-${process.pid}.db`);

fs.copyFileSync(LIVE_DB, TMP_DB);
const db = new Database(TMP_DB);

const { getPartyStatement } = require(path.join(ROOT, 'shared', 'operations', 'statements.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

// ── One synthetic multi-item bill, inserted into the COPY only ─────────
const customer = db.prepare(`
    SELECT id FROM parties WHERE type IN ('customer','both')
    ORDER BY id LIMIT 1`).get();
const supplier = db.prepare(`
    SELECT p.id FROM parties p
    WHERE p.type IN ('supplier','both')
      AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.party_id = p.id)
    ORDER BY p.id LIMIT 1`).get() || db.prepare("SELECT id FROM parties WHERE type IN ('supplier','both') ORDER BY id LIMIT 1").get();

const SALE_DATE = '2090-01-05';
const PURCHASE_DATE = '2090-01-06';
const SALE_ITEMS = [
    ['Mix Milk', 50, 'L', 100, 5000],
    ['Cow Milk', 20, 'L', 100, 2000],
    ['Paneer', 10, 'kg', 400, 4000],
    ['Ghee', 2, 'kg', 900, 1800],
    ['NAUNI', 5, 'kg', 500, 2500]
];
const SALE_TOTAL = SALE_ITEMS.reduce((s, i) => s + i[4], 0); // 15,300
const PURCHASE_ITEMS = [
    ['Ghee', 5, 'kg', 900, 4500],
    ['Paneer', 2, 'kg', 700, 1400]
];
const PURCHASE_TOTAL = PURCHASE_ITEMS.reduce((s, i) => s + i[4], 0); // 5,900

const saleId = db.prepare(`
    INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total,
                       paid_amount, payment_mode, status, notes)
    VALUES ('TEST-MULTI-1', ?, ?, ?, 0, 0, ?, 0, 'credit', 'unpaid', 'synthetic multi-item test bill')
`).run(SALE_DATE, customer.id, SALE_TOTAL, SALE_TOTAL).lastInsertRowid;
for (const [name, qty, unit, rate, amount] of SALE_ITEMS) {
    db.prepare(`INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, NULL, ?, ?, ?, ?, ?)`).run(saleId, name, qty, unit, rate, amount);
}
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
            VALUES (?, ?, 'sale', ?, 'Sale Invoice TEST-MULTI-1', ?, 0, 0)`)
    .run(customer.id, SALE_DATE, saleId, SALE_TOTAL);

const purchaseId = db.prepare(`
    INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, transport_charges,
                           extra_charges, grand_total, paid_amount, payment_mode, status, notes)
    VALUES ('TEST-MULTI-P1', ?, ?, ?, 0, 0, 0, 0, ?, 0, 'credit', 'unpaid', 'synthetic multi-item purchase')
`).run(PURCHASE_DATE, supplier.id, PURCHASE_TOTAL, PURCHASE_TOTAL).lastInsertRowid;
for (const [name, qty, unit, rate, amount] of PURCHASE_ITEMS) {
    const pid = db.prepare('SELECT id FROM products WHERE name = ? LIMIT 1').get(name);
    db.prepare(`INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(purchaseId, pid ? pid.id : db.prepare('SELECT id FROM products LIMIT 1').get().id, name, qty, unit, rate, amount);
}
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance)
            VALUES (?, ?, 'purchase', ?, 'Purchase Bill TEST-MULTI-P1', ?, 0, 0)`)
    .run(supplier.id, PURCHASE_DATE, purchaseId, PURCHASE_TOTAL);

const customerStatement = getPartyStatement(db, {
    party_id: customer.id, from_date: '2090-01-01', to_date: '2090-01-31'
});
const supplierStatement = getPartyStatement(db, {
    party_id: supplier.id, from_date: '2090-01-01', to_date: '2090-01-31'
});

console.log('\n— 1. One bill, one line per item —');
const bill = customerStatement.entries.filter(e => e.reference_no === 'TEST-MULTI-1');
{
    check('the multi-item bill is ONE ledger row', bill.length === 1, `${bill.length} rows`);
    const e = bill[0] || {};
    const lines = Array.isArray(e.display_lines) ? e.display_lines : [];
    check('the bill renders one display line per item', lines.length === SALE_ITEMS.length, `${lines.length} lines`);
    check('the item names are the real product names',
        lines.map(l => l.product_name).join('|') === SALE_ITEMS.map(i => i[0]).join('|'),
        lines.map(l => l.product_name).join('|'));
    let qtyOk = true, unitOk = true, rateOk = true, amountOk = true;
    SALE_ITEMS.forEach(([name, qty, unit, rate, amount], i) => {
        const l = lines[i] || {};
        if (!near(l.quantity, qty, 0.0001)) qtyOk = false;
        if (String(l.unit) !== unit) unitOk = false;
        if (!near(l.rate, rate)) rateOk = false;
        if (!near(l.amount, amount, 0.01)) amountOk = false;
    });
    check('every item keeps its own quantity', qtyOk);
    check('every item keeps its own unit (L / kg)', unitOk);
    check('every item keeps its own rate', rateOk);
    check('every item keeps its own amount', amountOk);
    check('no line is a generic "Sales"/"Purchase"/"Milk"/"Product" label',
        lines.every(l => !/^(sales?|purchases?|milk|product)$/i.test(String(l.product_name).trim())));
    check('the item amounts add up to the bill total',
        near(lines.reduce((s, l) => s + Number(l.amount || 0), 0), SALE_TOTAL, 0.01));
}

console.log('\n— 2. The bill total is counted once —');
{
    const e = bill[0] || {};
    check('the bill carries its debit once', near(e.debit, SALE_TOTAL));
    check('the statement total debit is the bill, not a multiple of it',
        near(customerStatement.total_debit, SALE_TOTAL), `${customerStatement.total_debit}`);
    check('no other row repeats the bill amount',
        customerStatement.entries.filter(x => near(x.debit || 0, SALE_TOTAL) && x !== e).length === 0);
    const sql = db.prepare(`
        SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c FROM ledger_entries
        WHERE party_id = ? AND date BETWEEN '2090-01-01' AND '2090-01-31'`).get(customer.id);
    check('total debit still equals the ledger', near(customerStatement.total_debit, sql.d));
    check('closing balance is still opening + debit − credit',
        near(customerStatement.closing_balance,
            customerStatement.opening_balance + customerStatement.total_debit - customerStatement.total_credit));
    const last = customerStatement.entries[customerStatement.entries.length - 1];
    check('running balance still ends at the closing balance',
        near(last.running_balance, customerStatement.closing_balance));
}

console.log('\n— 3. Item-wise quantity totals —');
{
    const q = customerStatement.qty_summary;
    const items = Array.isArray(q.items) ? q.items : [];
    check('an item-wise summary is produced', items.length >= SALE_ITEMS.length, `${items.length}`);
    const find = (name, unit) => items.find(i => i.name.toLowerCase() === name.toLowerCase() && i.unit === unit);
    let allOk = true;
    for (const [name, qty, unit] of SALE_ITEMS) {
        const row = find(name, unit);
        if (!row || !near(row.sale_qty, qty, 0.0001) || !near(row.purchase_qty, 0, 0.0001)) allOk = false;
    }
    check('each item has its own sales quantity and unit', allOk);
    check('litres and kilograms are never one row',
        items.every(i => ['L', 'kg'].includes(i.unit)));
    check('mixed milk and paneer stay separate rows',
        !!find('Mix Milk', 'L') && !!find('Paneer', 'kg') && find('Mix Milk', 'L') !== find('Paneer', 'kg'));
    check('the sales quantity total is litres + kilograms by unit',
        near(q.sales.total_qty, SALE_ITEMS.reduce((s, i) => s + i[1], 0), 0.01));
    check('purchases stay in their own bucket (nothing on this customer)',
        near(q.purchase.total_qty, 0));
    check('a payment row contributes no item quantity',
        customerStatement.entries.filter(e => e.reference_type === 'payment_received'
            || e.reference_type === 'payment_made')
            .every(e => (e.display_lines || []).length === 0));
    check('the milk-type summary is retained', !!q.sales.mixed || !!q.sales.cow);
}

console.log('\n— 4. Supplier purchase bill: items and separate totals —');
{
    const billRows = supplierStatement.entries.filter(e => e.reference_no === 'TEST-MULTI-P1');
    check('the purchase bill is one row', billRows.length === 1);
    const e = billRows[0] || {};
    const lines = Array.isArray(e.display_lines) ? e.display_lines : [];
    check('the purchase bill shows one line per item', lines.length === PURCHASE_ITEMS.length, `${lines.length}`);
    check('purchase item names are the real products',
        lines.map(l => l.product_name).join('|') === PURCHASE_ITEMS.map(i => i[0]).join('|'));
    check('the purchase bill carries its credit once', near(e.credit, PURCHASE_TOTAL));
    const items = supplierStatement.qty_summary.items || [];
    const ghee = items.find(i => i.name === 'Ghee' && i.unit === 'kg');
    const paneer = items.find(i => i.name === 'Paneer' && i.unit === 'kg');
    check('purchase items are totalled by item', !!ghee && near(ghee.purchase_qty, 5) && !!paneer && near(paneer.purchase_qty, 2));
    check('purchase and sales quantity summary fields are separate objects',
        supplierStatement.qty_summary.purchase !== supplierStatement.qty_summary.sales);
    check('purchase closing balance unchanged by the item detail',
        near(supplierStatement.closing_balance,
            supplierStatement.opening_balance + supplierStatement.total_debit - supplierStatement.total_credit));
}

// ── Renderer loaded in a sandbox: real screen / print HTML ─────────────
const rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'statements.js'), 'utf8');

function loadRenderer(storage) {
    const sandbox = {
        console,
        setTimeout,
        localStorage: {
            getItem: k => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: k => { delete storage[k]; }
        },
        document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
        rl: (en) => en,
        rlt: (k) => k,
        escapeHtml: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        formatCurrency: (v) => 'Rs ' + (Number(v) || 0).toFixed(2),
        formatDate: (d) => String(d || ''),
        getSettingsCached: async () => ({ business_name: 'TEST DAIRY' }),
        showToast: () => {},
        printHTML: () => {},
        navigateTo: () => {}
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(rendererSrc, sandbox, { filename: 'renderer/js/statements.js' });
    return sandbox;
}

const storage = {};
const R = loadRenderer(storage);
const billEntry = bill[0];

const fakeCustomer = {
    party: { name: 'TEST CUSTOMER', type: 'customer' },
    from_date: '2090-01-01', to_date: '2090-01-31',
    opening_balance: 0, entries: [billEntry],
    total_debit: SALE_TOTAL, total_credit: 0, closing_balance: SALE_TOTAL,
    qty_summary: customerStatement.qty_summary,
    qty_unreconciled_count: 0,
    filters: {}, pdc: { received_held: 0, issued_held: 0, received_held_count: 0, issued_held_count: 0 }
};
const fakeSupplier = {
    ...fakeCustomer,
    party: { name: 'TEST SUPPLIER', type: 'supplier' },
    entries: supplierStatement.entries.filter(e => e.reference_no === 'TEST-MULTI-P1'),
    total_debit: 0, total_credit: PURCHASE_TOTAL, closing_balance: -PURCHASE_TOTAL,
    qty_summary: supplierStatement.qty_summary
};

console.log('\n— 5. Default columns follow the party type —');
{
    const supplierCols = R.statementVisibleColumns(fakeSupplier).map(c => c.key);
    const customerCols = R.statementVisibleColumns(fakeCustomer).map(c => c.key);
    check('supplier default includes Shift', supplierCols.includes('shift'));
    check('supplier default includes Milk Type', supplierCols.includes('milk_type'));
    check('supplier default includes Quantity, Unit and Rate',
        supplierCols.includes('qty') && supplierCols.includes('unit') && supplierCols.includes('rate'));
    check('customer default hides Shift', !customerCols.includes('shift'));
    check('customer default hides Milk Type', !customerCols.includes('milk_type'));
    check('customer default still shows Date, Particulars, Debit, Credit and Balance',
        ['acct_date', 'particulars', 'debit', 'credit', 'balance'].every(k => customerCols.includes(k)));
    check('customer default keeps Quantity, Unit and Rate',
        ['qty', 'unit', 'rate'].every(k => customerCols.includes(k)));
}

console.log('\n— 6. Showing / hiding columns, and remembering the choice —');
{
    const customerCols = R.statementVisibleColumns(fakeCustomer).map(c => c.key);
    R.statementSetColumns(fakeCustomer, customerCols.concat(['shift']), false);
    check('Shift can be enabled on a customer statement',
        R.statementVisibleColumns(fakeCustomer).some(c => c.key === 'shift'));
    const stored = JSON.parse(storage.statementColumnSettings || '{}');
    check('the choice is saved', Array.isArray(stored.customer.visible) && stored.customer.visible.includes('shift'));

    // A fresh load of the module is what "close and reopen the app" does.
    const R2 = loadRenderer(storage);
    check('the saved choice survives a restart',
        R2.statementVisibleColumns(fakeCustomer).some(c => c.key === 'shift'));

    R.statementSetColumns(fakeCustomer, ['acct_date', 'particulars', 'debit', 'credit', 'balance'], false);
    const keys = R.statementVisibleColumns(fakeCustomer).map(c => c.key);
    check('columns can be hidden', !keys.includes('qty') && !keys.includes('rate'));
    check('essential columns stay', keys.includes('acct_date') && keys.includes('particulars')
        && keys.includes('debit') && keys.includes('credit') && keys.includes('balance'));

    R.statementShowAllColumns.call(null);
    // no _lastStatement in this sandbox yet — set it and use the real handler
    R._lastStatement = fakeCustomer;
    R.statementShowAllColumns();
    check('Show All turns every column on',
        R.statementVisibleColumns(fakeCustomer).length === R.STATEMENT_COLUMN_DEFS().length);
    R.statementResetColumns();
    check('Reset Default restores the customer layout',
        R.statementVisibleColumns(fakeCustomer).map(c => c.key).join(',') ===
        R.statementDefaultColumns('customer').join(','));
}

console.log('\n— 7. Print / PDF use the same columns and never duplicate the bill —');
{
    const R3 = loadRenderer({});
    const supplierLay = R3.statementPrintLayout(fakeSupplier);
    check('supplier print layout includes the Shift column',
        supplierLay.cols.some(c => c.key === 'shift'));
    check('supplier print layout is landscape (12 columns)', supplierLay.landscape === true);

    const html = R3.buildStatementHtml(fakeSupplier, { business_name: 'TEST DAIRY' }, supplierLay);
    check('the printed page has a <thead> (headers repeat on every page)', /<thead>/.test(html));
    check('the printed page keeps the bill reference', html.includes('TEST-MULTI-P1'));
    check('each purchase item is on its own printed line',
        PURCHASE_ITEMS.every(i => html.split(i[0]).length - 1 >= 1));
    check('the printed page includes the item-wise quantity summary',
        /Item-wise Quantity Summary/.test(html) && /stmt-item-summary/.test(html));
    check('the printed page includes the purchase/sales quantity summary',
        /Quantity Summary/.test(html));
    check('the printed page includes the filters line when filters exist',
        /Filters/.test(R3.buildStatementHtml({ ...fakeSupplier, filters: { milk_type: 'cow' } }, {}, supplierLay)));

    // Count printed cells carrying the bill amount: exactly one row should.
    const purchaseRows = R3.statementPrintRows(fakeSupplier, supplierLay.cols);
    const rowChunks = purchaseRows.split('<tr>').slice(1);
    check('the bill prints one row per item', rowChunks.length === PURCHASE_ITEMS.length, `${rowChunks.length}`);
    const amountRows = rowChunks.filter(r => r.includes('5,900.00'));
    check('the bill total appears on exactly one printed row', amountRows.length === 1, `${amountRows.length}`);

    // Hide money-irrelevant columns: the amounts must be identical.
    const customerLay = R3.statementPrintLayout(fakeCustomer);
    const full = R3.buildStatementHtml(fakeCustomer, {}, customerLay);
    R3.statementSetColumns(fakeCustomer, ['acct_date', 'particulars', 'qty', 'unit', 'rate', 'debit', 'credit', 'balance'], false);
    const slimLay = R3.statementPrintLayout(fakeCustomer);
    const slim = R3.buildStatementHtml(fakeCustomer, {}, slimLay);
    check('hiding columns removes their headers', !/>Shift</.test(slim) && !/Reference Number|reference/.test(slim.split('<tbody>')[0]));
    check('hiding columns keeps every item line',
        SALE_ITEMS.filter(i => slim.split(i[0]).length - 1 >= 1).length === SALE_ITEMS.length);
    check('hiding columns does not change the printed totals',
        slim.includes('Rs 15300.00') && full.includes('Rs 15300.00'));
    check('compact layout is used when many columns are on', R3.statementPrintLayout(fakeSupplier).compact === true);

    const compactLay = { cols: supplierLay.cols, compact: true, landscape: true };
    check('compact layout is applied to the table', /stmt-table stmt-compact/.test(
        R3.buildStatementHtml(fakeSupplier, {}, compactLay)));
    check('page orientation follows the column count',
        /@page \{ size: A4 landscape/.test(full) &&
        /@page \{ size: A4 portrait/.test(R3.buildStatementHtml(fakeCustomer, {}, { ...slimLay, landscape: false })));
}

console.log('\n— 8. Screen table: item lines, one amount, same columns —');
{
    const R4 = loadRenderer({});
    let captured = '';
    R4.document.getElementById = (id) => (id === 'statementResult'
        ? { set innerHTML(v) { captured = v; }, get innerHTML() { return captured; } }
        : null);
    R4.renderStatementResult(fakeCustomer);

    check('the screen renders one row per item', (captured.match(/class="mr-line"/g) || []).length === SALE_ITEMS.length,
        `${(captured.match(/class="mr-line"/g) || []).length}`);
    check('every screen line keeps the bill reference',
        captured.split('TEST-MULTI-1').length - 1 >= SALE_ITEMS.length);
    check('the screen shows the real item names', SALE_ITEMS.every(i => captured.includes(i[0])));
    check('the customer screen has no Shift header', !/>Shift</.test(captured));
    const ledgerRows = captured.split('<tr').filter(r => /class="mr-line"/.test(r));
    check('the row amount is printed on one line only, not per item',
        ledgerRows.filter(r => r.includes('Rs 15300.00')).length === 1,
        `${ledgerRows.filter(r => r.includes('Rs 15300.00')).length}`);
    check('the screen includes the item-wise summary', /stmt-item-summary/.test(captured));
    check('the screen includes Column Settings', /stColumnPanel/.test(captured) && /Column Settings/.test(captured));
    check('the screen includes Show All and Reset Default',
        /statementShowAllColumns\(\)/.test(captured) && /statementResetColumns\(\)/.test(captured));

    // The debit cell exists once for a multi-line row.
    const qtyCells = R4.statementQtyCells(billEntry);
    const firstDebit = R4.statementCellHtml('debit', billEntry, null, true, qtyCells, {});
    const laterDebit = R4.statementCellHtml('debit', billEntry, null, false, qtyCells, {});
    check('the debit cell is filled on the first item line', /Rs 15300\.00/.test(firstDebit));
    check('the debit cell is empty on the following item lines', laterDebit === '<td></td>');
}

console.log('\n— 9. Columns and totals come from the engine, not the display —');
{
    const src = rendererSrc;
    check('the screen table is built from the shared column plan', /statementVisibleColumns\(data\)/.test(src));
    check('print / PDF use the same plan', /statementPrintLayout\(data\)/.test(src));
    check('print uses the visible columns', /statementPrintRows\(data, cols\)/.test(src));
    check('column settings are persisted', /localStorage\.setItem\(STATEMENT_COLUMN_STORAGE/.test(src));
    check('totals are still taken from the engine data',
        /data\.total_debit/.test(src) && /data\.total_credit/.test(src) && /data\.closing_balance/.test(src));
    check('the statement table is never written to the database',
        !/INSERT INTO|UPDATE ledger_entries|DELETE FROM/.test(src));
}

db.close();
try { fs.unlinkSync(TMP_DB); } catch (e) { /* temp cleanup */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
