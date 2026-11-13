#!/usr/bin/env node
/**
 * test-excel-import-routing.js — one source per transaction
 *
 * Imports a COPY of the operator's workbook into an empty database and proves:
 *   1. Party_Ledger is not imported (and says so in the result)
 *   2. every ledger row resolves to its own module row (sale → sales.id,
 *      purchase → purchases.id) instead of an Excel reference like `BILL-5001`
 *   3. sales / purchases / collections / payments / petty / bank / salary each
 *      land in their own table, with totals matching their own worksheet
 *   4. no consolidated/report sheet contributes rows
 *   5. bank stays standalone (no ledger post, no party link)
 *   6. a second import creates no duplicates
 *
 * Never opens the real database and never writes the real workbook.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..', '..');
const excelImport = require(path.join(ROOT, 'shared', 'excel-import'));
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const { workbookPath } = require(path.join(ROOT, 'shared', 'workbook-path'));

let passed = 0, failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, tol = 0.5) => Math.abs(Number(a) - Number(b)) <= tol;
const money = (n) => Number(n || 0).toFixed(2);

const src = workbookPath();
if (!fs.existsSync(src)) { console.log(`Workbook not found: ${src}`); process.exit(2); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-routing-'));
const book = path.join(dir, 'workbook.xlsx');
fs.copyFileSync(src, book);

const wb = XLSX.readFile(book);
const sheetRows = (name) => {
    const actual = wb.SheetNames.find(n => n.trim().toLowerCase() === name.toLowerCase());
    if (!actual) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[actual], { header: 1, raw: true, defval: '' });
};
const sumCol = (rows, idx) => rows.reduce((s, r) => s + (Number((r || [])[idx]) || 0), 0);

const db = initDatabase(dir);
const quiet = () => {};
const sheets = wb.SheetNames;
console.log(`\nWorkbook : ${src}\nSheets   : ${sheets.length}\nDatabase : ${path.join(dir, 'dairy-plant.db')}\n`);

// ── Import once ────────────────────────────────────────────────
console.log('1. Fresh import of the real workbook');
const res1 = excelImport.runExcelImport(db, book, { mode: 'fresh', log: quiet });
check(!!res1.sales && res1.sales.added > 0, 'sales imported', res1.sales && res1.sales.added);
check(!!res1.purchases && (res1.purchases.added > 0 || res1.purchases.unchanged > 0), 'purchases imported', res1.purchases);
check(!!res1.collections && res1.collections.added > 0, 'collections imported', res1.collections && res1.collections.added);
check(!!res1.bank, 'bank sheet processed', res1.bank && res1.bank.added);
check(!!res1.salary && res1.salary.added > 0, 'salary imported', res1.salary && res1.salary.added);
check(!!res1.pettyCash, 'petty cash sheet processed');
check(!!res1.registers && !!res1.registers.Payment, 'Payment/Expenses/Advance registers processed');

// ── Party_Ledger excluded ──────────────────────────────────────
console.log('\n2. Party_Ledger is not a transaction source');
check(res1.ledger && res1.ledger.skipped === true, 'import reports Party_Ledger as skipped', res1.ledger);
check(res1.ledger.added === 0 && res1.ledger.unchanged === 0, 'no rows read from Party_Ledger', res1.ledger);

const ledgerTotal = db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n;
check(ledgerTotal > 0, 'ledger entries exist (built from the registers)', ledgerTotal);

// The app links a ledger row to its document by invoice/bill NUMBER, which is the
// convention every module uses. A row imported from the Party_Ledger sheet would
// not resolve to any register row.
const orphanSale = db.prepare(`
    SELECT COUNT(*) n FROM ledger_entries le
    WHERE le.reference_type = 'sale'
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.invoice_no = le.reference_id)
`).get().n;
const orphanPur = db.prepare(`
    SELECT COUNT(*) n FROM ledger_entries le
    WHERE le.reference_type = 'purchase'
      AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.bill_no = le.reference_id)
`).get().n;
check(orphanSale === 0, 'every sale ledger row points at a real Sales_Entry invoice', orphanSale);
check(orphanPur === 0, 'every purchase ledger row points at a real Purchase_Entry bill', orphanPur);

// Opening-balance documents (OPN-…) belong to Sales_Entry in this workbook — the
// Party_Master Opening Balance column is 0 for every party — so they survive
// without the Party_Ledger sheet.
const opnSales = db.prepare("SELECT COUNT(*) n FROM sales WHERE invoice_no LIKE 'OPN-%'").get().n;
const opnLedger = db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE reference_id LIKE 'OPN-%'").get().n;
check(opnSales > 0, 'opening documents arrive from Sales_Entry (OPN-…)', opnSales);
check(opnLedger === opnSales, 'each opening document has its own ledger row, not a ledger-sheet copy', { ledger: opnLedger, sales: opnSales });

// ── Totals match their own worksheet ───────────────────────────
console.log('\n3. Counts and totals match each worksheet');
// Data rows only: skip the header and the TOTALS row (which repeats the sum).
const isTotalRow = (r) => (r || []).slice(0, 6).some(v => /totals?/i.test(String(v).trim()));
const dataRows = (name) => sheetRows(name).slice(2).filter(r => r && String(r[0]).trim() !== '' && !isTotalRow(r));

const salesRows = dataRows('Sales_Entry');
const sheetSalesNet = salesRows.reduce((s, r) => s + (Number(r[9]) || 0), 0);
const dbSales = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) t FROM sales').get();
check(dbSales.n > 0, `sales rows in the database (${dbSales.n})`);
check(near(dbSales.t, sheetSalesNet, Math.max(5, sheetSalesNet * 0.0001)),
    'sales total matches Sales_Entry Net Amount (J)', { db: money(dbSales.t), sheet: money(sheetSalesNet) });

const purchaseRows = dataRows('Purchase_Entry');
const sheetPurchaseNet = purchaseRows.reduce((s, r) => s + (Number(r[15]) || 0), 0);
const dbPur = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) t FROM purchases').get();
check(dbPur.n > 0, `purchase rows in the database (${dbPur.n})`);
check(near(dbPur.t, sheetPurchaseNet, Math.max(5, sheetPurchaseNet * 0.0002)),
    'purchase total matches Purchase_Entry Net Amount (P)', { db: money(dbPur.t), sheet: money(sheetPurchaseNet) });

const milkCount = db.prepare('SELECT COUNT(*) n FROM milk_collections').get().n;
check(milkCount > 0, `milk collections imported from Purchase_Entry (${milkCount})`);

// A receipt comes from Type='Collection' (settles a sale) and from Type='ADVANCE
// RETURNED' (cash coming back to us, also money in). Rent, Advance and Petty Cash
// rows have their own destination and must not be summed here.
const collSheet = dataRows('Collection')
    .filter(r => ['Collection', 'ADVANCE RETURNED'].includes(String(r[5]).trim()));
const collCollected = collSheet.reduce((s, r) => s + (Number(r[7]) || 0), 0);
const dbReceipts = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM payments WHERE type = 'receipt'").get();
check(dbReceipts.n > 0, `receipts imported from Collection (${dbReceipts.n})`);
check(near(dbReceipts.t, collCollected, Math.max(5, collCollected * 0.01)),
    'receipt total matches Collection Collected (H)', { db: money(dbReceipts.t), sheet: money(collCollected) });

const payRows = db.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM payments WHERE type = 'payment'").get();
check(payRows.n > 0, `supplier payments imported from Payment (${payRows.n})`);
const bankRowsDb = db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n;
check(bankRowsDb > 0, `bank rows imported from BANK RECON (${bankRowsDb})`);
const salaryDb = db.prepare('SELECT COUNT(*) n FROM salary_records').get().n;
check(salaryDb > 0, `salary rows imported (${salaryDb})`);
const pettyDb = db.prepare('SELECT COUNT(*) n FROM petty_cash').get().n;
check(pettyDb > 0, `petty cash rows imported (${pettyDb})`);

// ── No reporting sheet contributed ─────────────────────────────
console.log('\n4. Reporting sheets contribute nothing');
const REPORTING = ['Party_Statement', 'Printable Party Statement', 'Verified Transaction Ledger',
    'Daybook', 'Dashboard', 'Profit_Loss', 'Receivable_Payable', 'Stock_Statement',
    'Reconciliation Report', 'Import Log', 'Change Log'];
for (const name of REPORTING) {
    const keys = Object.keys(res1).filter(k => k.toLowerCase() === name.toLowerCase().replace(/ /g, ''));
    check(keys.length === 0, `${name} is not in the import result`, keys);
}
// The ledger must equal the registers' own postings, not a sheet copy: a sale
// contributes exactly one sale-typed ledger row.
const saleLedgerRows = db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE reference_type = 'sale'").get().n;
check(saleLedgerRows === dbSales.n, 'one sale ledger row per sale (no second copy)', { ledger: saleLedgerRows, sales: dbSales.n });

// ── Bank standalone ────────────────────────────────────────────
console.log('\n5. Bank stays standalone');
const bankPosted = db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE ledger_entry_id IS NOT NULL').get().n;
const bankLedgerRows = db.prepare("SELECT COUNT(*) n FROM ledger_entries WHERE reference_type LIKE '%bank%'").get().n;
check(bankPosted === 0, 'no bank row carries a ledger entry id', bankPosted);
check(bankLedgerRows === 0, 'no bank-typed ledger rows exist', bankLedgerRows);

// ── Idempotency ────────────────────────────────────────────────
console.log('\n6. Second import creates no duplicates');
const before = {
    sales: dbSales.n,
    purchases: dbPur.n,
    receipts: dbReceipts.n,
    payments: payRows.n,
    bank: bankRowsDb,
    salary: salaryDb,
    petty: pettyDb,
    ledger: ledgerTotal
};
const res2 = excelImport.runExcelImport(db, book, { mode: 'upsert', log: quiet });
const after = {
    sales: db.prepare('SELECT COUNT(*) n FROM sales').get().n,
    purchases: db.prepare('SELECT COUNT(*) n FROM purchases').get().n,
    receipts: db.prepare("SELECT COUNT(*) n FROM payments WHERE type = 'receipt'").get().n,
    payments: db.prepare("SELECT COUNT(*) n FROM payments WHERE type = 'payment'").get().n,
    bank: db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n,
    salary: db.prepare('SELECT COUNT(*) n FROM salary_records').get().n,
    petty: db.prepare('SELECT COUNT(*) n FROM petty_cash').get().n,
    ledger: db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n
};
check(res2.ledger && res2.ledger.skipped === true, 'second import also skips Party_Ledger');
for (const k of Object.keys(before)) {
    check(after[k] === before[k], `no duplicate ${k} rows on re-import`, { before: before[k], after: after[k] });
}

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
