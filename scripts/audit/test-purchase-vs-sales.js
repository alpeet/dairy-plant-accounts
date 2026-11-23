#!/usr/bin/env node
/**
 * Purchase vs Sales report — acceptance tests
 * ===========================================
 * Two layers of proof:
 *
 *   1. A small deterministic database (dates relative to today, so Today /
 *      Yesterday really are today and yesterday) proves every business rule:
 *      daily totals, a day with purchases but no sales, a day with sales but
 *      no purchases, several suppliers / customers on one day, party totals,
 *      every filter alone and combined, zero-activity days, and that payments
 *      and receipts are NOT counted again as purchases or sales.
 *
 *   2. A /tmp COPY of the live database proves the report reconciles with the
 *      original purchase and sales documents — SQL is the referee, never the
 *      report's own arithmetic — and that the printed document and workbook
 *      carry the same filtered numbers.
 *
 * Printing / PDF are Electron-only and live in test-purchase-vs-sales-pdf.js.
 *
 * Run:  node scripts/audit/test-purchase-vs-sales.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const bs = require(path.join(ROOT, 'shared', 'bs-calendar.js'));
const { getPurchaseVsSales } = require(path.join(ROOT, 'shared', 'operations', 'purchase_vs_sales.js'));
const { buildPurchaseVsSalesHTML } = require(path.join(ROOT, 'shared', 'report-purchase-vs-sales.js'));
const { buildPurchaseVsSalesWorkbook, exportPurchaseVsSalesExcel } = require(path.join(ROOT, 'shared', 'export-purchase-vs-sales.js'));

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail) {
    if (condition) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
function skip(name, reason) {
    skipped++;
    console.log(`  ⏭  ${name} — ${reason}`);
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Deterministic fixture database
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 1. Deterministic fixtures ═══');

const FIXTURE_DIR = '/tmp';
const FIXTURE_FILE = 'pvs-report-fixture.db';
for (const suffix of ['', '-wal', '-shm']) {
    const file = path.join(FIXTURE_DIR, FIXTURE_FILE + suffix);
    if (fs.existsSync(file)) fs.unlinkSync(file);
}
const db = initDatabase(FIXTURE_DIR, FIXTURE_FILE);

const TODAY = bs.todayBSDate();
const YESTERDAY = bs.addBSDays(TODAY, -1);
const TWO_AGO = bs.addBSDays(TODAY, -2);
const THREE_AGO = bs.addBSDays(TODAY, -3);   // deliberately empty → zero-activity day

const addParty = (name, type) =>
    Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const addProduct = (name, unit, rate) =>
    Number(db.prepare('INSERT INTO products (name, unit, category, rate) VALUES (?, ?, ?, ?)').run(name, unit, name, rate).lastInsertRowid);

const supplierA = addParty('PVS Supplier A', 'supplier');
const supplierB = addParty('PVS Supplier B', 'supplier');
const customerA = addParty('PVS Customer A', 'customer');
const customerB = addParty('PVS Customer B', 'customer');
const ghee = addProduct('PVS Ghee', 'kg', 900);
const paneer = addProduct('PVS Paneer', 'kg', 700);

const insertPurchase = (billNo, date, partyId, mode, status, items) => {
    const total = round2(items.reduce((sum, item) => sum + item.amount, 0));
    const id = Number(db.prepare(`
        INSERT INTO purchases (bill_no, date, accounting_date, party_id, subtotal, grand_total,
                               paid_amount, payment_mode, status)
        VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)
    `).run(billNo, date, partyId, total, total, status === 'paid' ? total : 0, mode, status).lastInsertRowid);
    for (const item of items) {
        db.prepare(`
            INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, item.product_id, item.product, item.quantity, item.unit, item.rate, item.amount);
    }
    return id;
};

const insertSale = (invoiceNo, date, partyId, mode, status, items) => {
    const total = round2(items.reduce((sum, item) => sum + item.amount, 0));
    const id = Number(db.prepare(`
        INSERT INTO sales (invoice_no, date, party_id, subtotal, grand_total, paid_amount,
                           payment_mode, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNo, date, partyId, total, total, status === 'paid' ? total : 0, mode, status).lastInsertRowid);
    for (const item of items) {
        db.prepare(`
            INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, item.product_id, item.product, item.quantity, item.unit, item.rate, item.amount);
    }
    return id;
};

// Today — two suppliers, one customer
insertPurchase('PVS-P1', TODAY, supplierA, 'cash', 'paid', [
    { product_id: ghee, product: 'PVS Ghee', quantity: 10, unit: 'kg', rate: 900, amount: 9000 }
]);
insertPurchase('PVS-P2', TODAY, supplierB, 'credit', 'unpaid', [
    { product_id: paneer, product: 'PVS Paneer', quantity: 5, unit: 'kg', rate: 700, amount: 3500 }
]);
insertSale('PVS-S1', TODAY, customerA, 'cash', 'paid', [
    { product_id: ghee, product: 'PVS Ghee', quantity: 2, unit: 'kg', rate: 1000, amount: 2000 },
    { product_id: paneer, product: 'PVS Paneer', quantity: 3, unit: 'kg', rate: 800, amount: 2400 }
]);

// Yesterday — a purchase and no sale at all
insertPurchase('PVS-P3', YESTERDAY, supplierB, 'credit', 'unpaid', [
    { product_id: ghee, product: 'PVS Ghee', quantity: 4, unit: 'kg', rate: 900, amount: 3600 }
]);

// Two days ago — sales only, from two customers
insertSale('PVS-S2', TWO_AGO, customerA, 'credit', 'unpaid', [
    { product_id: ghee, product: 'PVS Ghee', quantity: 1, unit: 'kg', rate: 1000, amount: 1000 }
]);
insertSale('PVS-S3', TWO_AGO, customerB, 'credit', 'unpaid', [
    { product_id: paneer, product: 'PVS Paneer', quantity: 2, unit: 'kg', rate: 800, amount: 1600 }
]);

// Three days ago — nothing. Its date must still appear in the comparison.

// Money settlements that must NEVER be read as purchases or sales.
const addPayment = (partyId, date, type, amount, mode) =>
    db.prepare("INSERT INTO payments (party_id, date, type, amount, mode) VALUES (?, ?, ?, ?, ?)")
        .run(partyId, date, type, amount, mode);
addPayment(supplierA, TODAY, 'payment', 999999, 'cash');
addPayment(customerA, TODAY, 'receipt', 888888, 'cash');

console.log(`  (fixture dates: today ${TODAY}, yesterday ${YESTERDAY}, empty day ${THREE_AGO})`);

// ═══════════════════════════════════════════════════════════════════════════
// 2. Today / Yesterday
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 2. Today and Yesterday ═══');

const todayReport = getPurchaseVsSales(db, { from_date: TODAY, to_date: TODAY });
check('2a. today: purchase amount = 12,500', near(todayReport.summary.purchase_amount, 12500), todayReport.summary);
check('2b. today: sales amount = 4,400', near(todayReport.summary.sales_amount, 4400));
check('2c. today: difference = sales − purchase = −8,100', near(todayReport.summary.difference, -8100), todayReport.summary.difference);
check('2d. today: 2 purchase bills and 1 sales invoice',
    todayReport.summary.purchase_transactions === 2 && todayReport.summary.sales_transactions === 1, todayReport.summary);
check('2e. today: one day row only', todayReport.daily.length === 1 && todayReport.daily[0].date === TODAY, todayReport.daily.length);

const yesterdayReport = getPurchaseVsSales(db, { from_date: YESTERDAY, to_date: YESTERDAY });
check('2f. yesterday: purchase 3,600 and sales 0 (purchases but no sales)',
    near(yesterdayReport.summary.purchase_amount, 3600) && near(yesterdayReport.summary.sales_amount, 0), yesterdayReport.summary);
check('2g. yesterday: daily row keeps the date with zero sales',
    yesterdayReport.daily.length === 1 && yesterdayReport.daily[0].date === YESTERDAY
    && near(yesterdayReport.daily[0].purchase_amount, 3600) && near(yesterdayReport.daily[0].sales_amount, 0), yesterdayReport.daily);

// ═══════════════════════════════════════════════════════════════════════════
// 3. Custom range, empty days, sales-only day
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 3. Custom range, empty days, sales-only day ═══');

const salesOnly = getPurchaseVsSales(db, { from_date: TWO_AGO, to_date: TWO_AGO });
check('3a. two days ago: sales 2,600 and purchase 0 (sales but no purchases)',
    near(salesOnly.summary.sales_amount, 2600) && near(salesOnly.summary.purchase_amount, 0), salesOnly.summary);
check('3b. two days ago: two customers on the same date', salesOnly.summary.sales_parties === 2, salesOnly.summary);

const range = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY });
check('3c. four-day range: purchase 16,100 / sales 7,000',
    near(range.summary.purchase_amount, 16100) && near(range.summary.sales_amount, 7000), range.summary);
check('3d. four-day range lists all 4 days including the empty one',
    range.daily.length === 4 && range.daily.map(d => d.date).join(',') === [THREE_AGO, TWO_AGO, YESTERDAY, TODAY].join(','), range.daily.map(d => d.date));
const emptyDay = range.daily.find(day => day.date === THREE_AGO);
check('3e. the empty day is present with 0 purchase and 0 sales',
    emptyDay && near(emptyDay.purchase_amount, 0) && near(emptyDay.sales_amount, 0), emptyDay);
check('3f. zero-activity days can be switched off',
    getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, include_zero_days: false }).daily.length === 3);

// ═══════════════════════════════════════════════════════════════════════════
// 4. Multiple suppliers / multiple customers on one date
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 4. Multiple parties on one date ═══');

const todaySuppliers = todayReport.purchase_parties;
check('4a. today has 2 supplier rows', todaySuppliers.length === 2, todaySuppliers.map(p => p.party_name));
check('4b. supplier A = 9,000 and supplier B = 3,500',
    near(todaySuppliers.find(p => p.party_name === 'PVS Supplier A')?.amount, 9000)
    && near(todaySuppliers.find(p => p.party_name === 'PVS Supplier B')?.amount, 3500), todaySuppliers);
check('4c. supplier quantities are carried (10 kg + 5 kg)',
    near(todaySuppliers.reduce((sum, row) => sum + row.quantity, 0), 15), todaySuppliers.map(p => p.quantity));
check('4d. today has 1 customer row worth 4,400',
    todayReport.sales_parties.length === 1 && near(todayReport.sales_parties[0].amount, 4400), todayReport.sales_parties);

// ═══════════════════════════════════════════════════════════════════════════
// 5. Party-wise totals
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 5. Party-wise totals ═══');

const all = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY });
const supplierBRow = all.purchase_parties.find(row => row.party_name === 'PVS Supplier B');
const customerARow = all.sales_parties.find(row => row.party_name === 'PVS Customer A');
const customerBRow = all.sales_parties.find(row => row.party_name === 'PVS Customer B');
check('5a. supplier B total = 7,100 over 2 bills', near(supplierBRow?.amount, 7100) && supplierBRow?.transactions === 2, supplierBRow);
check('5b. customer A total = 5,400 over 2 invoices', near(customerARow?.amount, 5400) && customerARow?.transactions === 2, customerARow);
check('5c. customer B total = 1,600', near(customerBRow?.amount, 1600), customerBRow);
check('5d. party totals add up to the period total',
    near(all.purchase_parties.reduce((sum, row) => sum + row.amount, 0), all.summary.purchase_amount)
    && near(all.sales_parties.reduce((sum, row) => sum + row.amount, 0), all.summary.sales_amount),
    { purchase: all.purchase_parties.reduce((sum, row) => sum + row.amount, 0), summary: all.summary });

// ═══════════════════════════════════════════════════════════════════════════
// 6. Payments and receipts are not another purchase or sale
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 6. Payments / receipts excluded ═══');

check('6a. a Rs 999,999 supplier payment did not change purchases', near(all.summary.purchase_amount, 16100), all.summary.purchase_amount);
check('6b. a Rs 888,888 customer receipt did not change sales', near(all.summary.sales_amount, 7000), all.summary.sales_amount);
const engineSource = fs.readFileSync(path.join(ROOT, 'shared', 'operations', 'purchase_vs_sales.js'), 'utf8');
check('6c. the engine never queries ledger_entries', !/FROM\s+ledger_entries/i.test(engineSource));
check('6d. the engine never sums the payments table', !/FROM\s+payments/i.test(engineSource));

// ═══════════════════════════════════════════════════════════════════════════
// 7. Filters — individually and together
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 7. Filters ═══');

const bySupplier = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, purchase_party_id: supplierA });
check('7a. supplier filter narrows purchases to 9,000 and leaves sales at 7,000',
    near(bySupplier.summary.purchase_amount, 9000) && near(bySupplier.summary.sales_amount, 7000), bySupplier.summary);

const byCustomer = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, sales_party_id: customerB });
check('7b. customer filter narrows sales to 1,600 and leaves purchases at 16,100',
    near(byCustomer.summary.sales_amount, 1600) && near(byCustomer.summary.purchase_amount, 16100), byCustomer.summary);

const byProduct = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, product: 'Paneer' });
check('7c. product filter: Paneer purchase 3,500 / sales 4,000',
    near(byProduct.summary.purchase_amount, 3500) && near(byProduct.summary.sales_amount, 4000), byProduct.summary);
check('7d. product filter returns only matching rows',
    byProduct.purchase_lines.every(line => /paneer/i.test(line.product)) && byProduct.sales_lines.every(line => /paneer/i.test(line.product)));

const byReference = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, reference: 'PVS-P1' });
check('7e. reference filter finds one bill (9,000) and no sale',
    near(byReference.summary.purchase_amount, 9000) && near(byReference.summary.sales_amount, 0), byReference.summary);

const cashOnly = getPurchaseVsSales(db, { from_date: THREE_AGO, to_date: TODAY, payment_mode: 'cash' });
check('7f. cash mode: 9,000 purchase / 4,400 sales (only cash documents)',
    near(cashOnly.summary.purchase_amount, 9000) && near(cashOnly.summary.sales_amount, 4400), cashOnly.summary);

const combined = getPurchaseVsSales(db, {
    from_date: THREE_AGO, to_date: TODAY,
    purchase_party_id: supplierB, product: 'Ghee', payment_mode: 'credit'
});
// Supplier B narrows only the purchase side; Ghee + credit then keep the one
// credit Ghee sale (customer A, 1,000) — the two sides filter independently.
check('7g. combined filters (supplier B + Ghee + credit) = 3,600 purchase / 1,000 sales',
    near(combined.summary.purchase_amount, 3600) && near(combined.summary.sales_amount, 1000), combined.summary);
check('7h. combined filters keep the daily table consistent',
    near(combined.daily.reduce((sum, day) => sum + day.purchase_amount, 0), combined.summary.purchase_amount)
    && near(combined.daily.reduce((sum, day) => sum + day.sales_amount, 0), combined.summary.sales_amount));

// ═══════════════════════════════════════════════════════════════════════════
// 8. No duplication + input validation
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 8. No duplication, validation ═══');

const lineTotal = all.purchase_lines.reduce((sum, line) => sum + line.amount, 0);
const salesLineTotal = all.sales_lines.reduce((sum, line) => sum + line.amount, 0);
check('8a. purchase detail rows add up to the summary once', near(lineTotal, all.summary.purchase_amount), { lineTotal, summary: all.summary.purchase_amount });
check('8b. sales detail rows add up to the summary once', near(salesLineTotal, all.summary.sales_amount));
check('8c. daily rows add up to the summary once',
    near(all.daily.reduce((sum, day) => sum + day.purchase_amount, 0), all.summary.purchase_amount)
    && near(all.daily.reduce((sum, day) => sum + day.sales_amount, 0), all.summary.sales_amount));
const documentIds = new Set(all.purchase_lines.map(line => line.document_id));
check('8d. every purchase bill appears as one document, never two',
    documentIds.size === all.summary.purchase_transactions, { docs: documentIds.size, summary: all.summary.purchase_transactions });
check('8e. an impossible BS date is rejected', (() => {
    try { getPurchaseVsSales(db, { from_date: '2083-00-10', to_date: TODAY }); return false; }
    catch (e) { return /From date/.test(e.message); }
})());
check('8f. an inverted range is rejected', (() => {
    try { getPurchaseVsSales(db, { from_date: TODAY, to_date: YESTERDAY }); return false; }
    catch (e) { return /on or before/.test(e.message); }
})());

// ═══════════════════════════════════════════════════════════════════════════
// 9. Printable document + workbook from the same data
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 9. Print document and workbook ═══');

const doc = buildPurchaseVsSalesHTML(db, { from_date: THREE_AGO, to_date: TODAY });
check('9a. document filename carries both dates',
    doc.filename === `Purchase_vs_Sales_${THREE_AGO}_to_${TODAY}.pdf`, doc.filename);
check('9b. document has the report title and the selected period',
    doc.html.includes('Daily Purchase vs Sales Report') && doc.html.includes(THREE_AGO) && doc.html.includes(TODAY));
check('9c. document carries every required section',
    ['Daily Comparison', 'Supplier-wise Purchases', 'Customer-wise Sales', 'Purchase Records', 'Sales Records']
        .every(section => doc.html.includes(section)));
check('9d. every table repeats its header (thead per table)',
    (doc.html.match(/<thead>/g) || []).length === 5, (doc.html.match(/<thead>/g) || []).length);
check('9e. detail sections start on a new page', (doc.html.match(/class="section-title page-break"/g) || []).length === 2);
check('9f. print date is present', /Printed: \d/.test(doc.html));
check('9g. no undefined / NaN leaked into the document', !/undefined|NaN/.test(doc.html));
check('9h. difference is labelled as a trading gap, not profit',
    /not profit/i.test(doc.html) && !/>profit</i.test(doc.html));

const workbook = buildPurchaseVsSalesWorkbook(db, { from_date: THREE_AGO, to_date: TODAY });
check('9i. workbook has the six report sheets',
    workbook.workbook.SheetNames.join(',') === 'Summary,Daily_Comparison,Purchase_Parties,Sales_Parties,Purchase_Details,Sales_Details',
    workbook.workbook.SheetNames);
const dailySheet = workbook.workbook.Sheets.Daily_Comparison;
const dailyRows = require(path.join(ROOT, 'node_modules', 'xlsx')).utils.sheet_to_json(dailySheet, { header: 1 });
check('9j. workbook daily sheet has a row per day plus header and total',
    dailyRows.length === workbook.report.daily.length + 2, { rows: dailyRows.length, days: workbook.report.daily.length });
check('9k. workbook total row equals the report totals',
    near(dailyRows[dailyRows.length - 1][1], workbook.report.summary.purchase_amount)
    && near(dailyRows[dailyRows.length - 1][2], workbook.report.summary.sales_amount),
    dailyRows[dailyRows.length - 1]);

const excelPath = '/tmp/pvs-report-fixture.xlsx';
const excel = exportPurchaseVsSalesExcel(db, excelPath, { from_date: THREE_AGO, to_date: TODAY });
check('9l. Excel export writes a real workbook file',
    excel.success === true && fs.existsSync(excelPath) && fs.statSync(excelPath).size > 3000, excel);

// ═══════════════════════════════════════════════════════════════════════════
// 10. Reconciliation against the original documents (live copy)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══ 10. Live database copy — reconciliation with the original records ═══');

const LIVE_DB = path.join(os.homedir(), 'Library', 'Application Support', 'prarambha-account-stock', 'data', 'dairy-plant.db');
const COPY_DB = '/tmp/pvs-report-live-copy.db';
let live = null;
if (fs.existsSync(LIVE_DB)) {
    for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(COPY_DB + suffix)) fs.unlinkSync(COPY_DB + suffix);
    }
    fs.copyFileSync(LIVE_DB, COPY_DB);
    live = require('better-sqlite3')(COPY_DB, { readonly: true });
    console.log(`  (working on a copy: ${COPY_DB})`);
} else {
    skip('live-database reconciliation', 'live database not found on this machine');
}

if (live) {
    const bounds = live.prepare('SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM purchases').get();
    const from = bounds.min_date;
    const to = bounds.max_date;

    // Reference aggregates are built in JS with the app's own money policy
    // (Σ round2(row), shared/operations/accounting.js). SQLite's ROUND follows
    // a different half-way convention, so it is not a fair referee for the
    // last cent; the original document rows still are.
    const referenceDocuments = (table) => live.prepare(
        `SELECT date, party_id, grand_total FROM ${table} WHERE date >= ? AND date <= ?`
    ).all(from, to);
    const sumRounded = (rows, pick) => round2(rows.reduce((sum, row) => sum + round2(pick ? pick(row) : row.grand_total), 0));

    const purchaseRefRows = referenceDocuments('purchases');
    const salesRefRows = referenceDocuments('sales');
    const sqlPurchaseTotal = sumRounded(purchaseRefRows);
    const sqlSalesTotal = sumRounded(salesRefRows);

    const full = getPurchaseVsSales(live, { from_date: from, to_date: to });
    check('10a. whole period: purchase total equals the purchase documents',
        near(full.summary.purchase_amount, sqlPurchaseTotal), { report: full.summary.purchase_amount, sql: sqlPurchaseTotal });
    check('10b. whole period: sales total equals the sales documents',
        near(full.summary.sales_amount, sqlSalesTotal), { report: full.summary.sales_amount, sql: sqlSalesTotal });
    check('10c. document count equals the purchase and sales row counts',
        full.summary.purchase_transactions === live.prepare('SELECT COUNT(*) AS n FROM purchases WHERE date >= ? AND date <= ?').get(from, to).n
        && full.summary.sales_transactions === live.prepare('SELECT COUNT(*) AS n FROM sales WHERE date >= ? AND date <= ?').get(from, to).n,
        { purchase: full.summary.purchase_transactions, sales: full.summary.sales_transactions });
    check('10d. detail rows reconcile with the document totals',
        full.reconciliation.purchase_reconciled && full.reconciliation.sales_reconciled, full.reconciliation);

    // Every single day against the original documents.
    const sqlDaily = new Map();
    const emptyRef = () => ({ purchase: 0, sales: 0, purchaseDocs: 0, salesDocs: 0 });
    for (const row of purchaseRefRows) {
        if (!sqlDaily.has(row.date)) sqlDaily.set(row.date, emptyRef());
        const bucket = sqlDaily.get(row.date);
        bucket.purchase = round2(bucket.purchase + round2(row.grand_total));
        bucket.purchaseDocs += 1;
    }
    for (const row of salesRefRows) {
        if (!sqlDaily.has(row.date)) sqlDaily.set(row.date, emptyRef());
        const bucket = sqlDaily.get(row.date);
        bucket.sales = round2(bucket.sales + round2(row.grand_total));
        bucket.salesDocs += 1;
    }
    let dailyMismatch = null;
    for (const day of full.daily) {
        const expected = sqlDaily.get(day.date);
        if (!expected) {
            if (day.purchase_amount || day.sales_amount) { dailyMismatch = { date: day.date, expected: null, day }; break; }
            continue;
        }
        if (!near(day.purchase_amount, expected.purchase) || !near(day.sales_amount, expected.sales)
            || day.purchase_count !== expected.purchaseDocs || day.sales_count !== expected.salesDocs) {
            dailyMismatch = { date: day.date, expected, day };
            break;
        }
    }
    check('10e. every daily row equals that day in the original documents', dailyMismatch === null, dailyMismatch);
    check('10f. daily rows cover every date in the period',
        full.daily.length === bs.bsDayNumber(...Object.values(bs.parseBSDate(to))) - bs.bsDayNumber(...Object.values(bs.parseBSDate(from))) + 1,
        full.daily.length);

    // Party-wise against the original documents for the five largest parties.
    const partyReference = (rows, partyId) => {
        const mine = rows.filter(row => Number(row.party_id) === Number(partyId));
        return { total: sumRounded(mine), documents: mine.length };
    };

    let partyMismatch = null;
    for (const row of full.purchase_parties.slice(0, 5)) {
        if (row.party_id == null) continue;
        const ref = partyReference(purchaseRefRows, row.party_id);
        if (!near(row.amount, ref.total) || row.transactions !== ref.documents) {
            partyMismatch = { side: 'purchase', row, expected: ref };
            break;
        }
    }
    for (const row of full.sales_parties.slice(0, 5)) {
        if (partyMismatch) break;
        if (row.party_id == null) continue;
        const ref = partyReference(salesRefRows, row.party_id);
        if (!near(row.amount, ref.total) || row.transactions !== ref.documents) {
            partyMismatch = { side: 'sales', row, expected: ref };
            break;
        }
    }
    check('10g. the five largest parties on each side equal their documents', partyMismatch === null, partyMismatch);
    check('10h. party totals add up to the period totals',
        near(full.purchase_parties.reduce((sum, row) => sum + row.amount, 0), full.summary.purchase_amount)
        && near(full.sales_parties.reduce((sum, row) => sum + row.amount, 0), full.summary.sales_amount));

    // Milk: a milk bill's quantity comes from its own milk collections.
    const milkBill = live.prepare(`
        SELECT purchase_ref_id AS id, SUM(quantity_liters) AS liters
          FROM milk_collections WHERE purchase_ref_id IS NOT NULL
         GROUP BY purchase_ref_id ORDER BY SUM(quantity_liters) DESC LIMIT 1
    `).get();
    if (milkBill) {
        const lines = full.purchase_lines.filter(line => line.document_id === Number(milkBill.id));
        const liters = lines.reduce((sum, line) => sum + line.quantity, 0);
        check('10i. a milk bill quantity equals its milk collections',
            near(liters, milkBill.liters), { bill: milkBill.id, lines: liters, collections: milkBill.liters });
        check('10j. the milk bill quantity is labelled in litres',
            lines.some(line => line.unit === 'L'), lines.map(line => line.unit));
    } else {
        skip('10i/10j milk bill quantity', 'no milk-linked purchase bill in this database');
    }

    // Agreement with the existing Purchase / Sales report modules.
    const monthFrom = from;
    const monthTo = bs.bsMonthRange(String(from).slice(0, 7)).to_date;
    const purchaseReport = ops.getPurchasesReport(live, { from_date: monthFrom, to_date: monthTo });
    const salesReport = ops.getSalesReport(live, { from_date: monthFrom, to_date: monthTo });
    const monthPvs = getPurchaseVsSales(live, { from_date: monthFrom, to_date: monthTo });
    check('10k. purchase total agrees with the existing Purchase report',
        near(monthPvs.summary.purchase_amount, round2(purchaseReport.purchases.reduce((sum, row) => sum + round2(row.grand_total), 0))),
        { pvs: monthPvs.summary.purchase_amount, register: purchaseReport.total });
    check('10l. sales total agrees with the existing Sales report',
        near(monthPvs.summary.sales_amount, round2(salesReport.sales.reduce((sum, row) => sum + round2(row.grand_total), 0))),
        { pvs: monthPvs.summary.sales_amount, register: salesReport.total });

    // Other reports still run untouched.
    const otherReports = (() => {
        try {
            const pl = ops.getProfitLoss(live, { from_date: from, to_date: to });
            const partyId = live.prepare('SELECT id FROM parties ORDER BY id LIMIT 1').get().id;
            const statement = ops.getPartyStatement(live, { party_id: partyId, from_date: from, to_date: to });
            const stock = ops.getStockStatement(live, {});
            return !!(pl && statement && stock);
        } catch (err) {
            return err.message;
        }
    })();
    check('10m. P&L, party statement and stock reports still run', otherReports === true, otherReports);

    // The printed document for a real month carries the same totals.
    const monthDoc = buildPurchaseVsSalesHTML(live, { from_date: monthFrom, to_date: monthTo });
    check('10n. printed document carries the same purchase and sales totals',
        monthDoc.html.includes(monthPvs.summary.purchase_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        && monthDoc.html.includes(monthPvs.summary.sales_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
    check('10o. a full-month document is large enough to paginate', monthDoc.html.length > 100000, monthDoc.html.length);

    live.close();
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`  Purchase-vs-Sales tests: ${passed} passed, ${failed} failed, ${skipped} skipped`);
console.log('═══════════════════════════════════════════\n');
process.exit(failed > 0 ? 1 : 0);
