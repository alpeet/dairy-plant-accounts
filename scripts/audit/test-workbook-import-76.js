#!/usr/bin/env node
/**
 * test-workbook-import-76.js — regressions found auditing
 * `Dairy_Accounts_Professional 76.xlsx`
 * ================================================================
 * 1. BANK RECON — the Transaction ID column repeats one value down the sheet
 *    (v76 has 31 rows all called "QR-089"). A reference is not a unique key:
 *    every distinct row must import exactly once, and a re-import must add
 *    nothing. This is why nothing after 2083 Ashoj 12 reached the app.
 * 2. BANK RECON — the same transaction already stored under `ref:<no>` is not
 *    duplicated when the bank-account column has been edited between copies.
 * 3. SALARY ADVANCE — the Month column wins over a copied-down remark, and an
 *    employee saved earlier under the wrong month (same payment date) is
 *    CORRECTED, not duplicated. v76 dropped 4 of 12 salary records.
 * 4. Payment sheet → `payments` only. Importing payments never creates or
 *    links a Bank Transactions row.
 *
 * Exit 0 = all passed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'));

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const bank = require(path.join(ROOT, 'shared', 'operations', 'bank'));
const { runExcelImport } = require(path.join(ROOT, 'shared', 'excel-import'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const eq = (a, b, name, extra) => ok(Math.abs(Number(a) - Number(b)) < 0.005, name, extra === undefined ? { got: a, want: b } : extra);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb76-'));
const xlsxPath = path.join(dir, 'v76.xlsx');
const db = initDatabase(path.join(dir, 'db'), 'test.db');
bank.ensureBankTable(db);

// ════════════════════════════════════════════════════════════
// Build a miniature v76: one repeated reference block, one legacy-stored row,
// and a Salary Advance sheet whose remarks disagree with the Month column.
// ════════════════════════════════════════════════════════════
const bankRows = [
    ['Transaction Date', 'AD Date', 'Transaction ID', 'Counterparty Name', 'Description', 'Party ID', 'Debit', 'Credit', 'Amount', 'Payment Mode', 'Bank Account', 'Transaction Type', 'Classification', 'Verification Status', 'Ledger Posting Status'],
    ['2083/06/28', '', 'QR-089', 'MODERN AGRO  -315', 'MILK SUPPLY FINAL BHADRA', '', 91712, 0, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/28', '', 'QR-089', 'LOCAL', 'LOCAL SALES RECEIVED BY QR', '', 0, 2400, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/29', '', 'QR-089', 'BANK', 'CASH DEPOSIT BY KESHAB', '', 0, 108655, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/29', '', 'QR-089', 'OFFICE EXPENSES', 'MILK ANALYZER MAINTENANCE', '', 1815, 0, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/29', '', 'QR-089', 'BAGESHWARI ICE CREAM', 'ONLINE PAYMENT RECEIVED', '', 0, 40000, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/30', '', 'QR-089', 'OFFICE EXPENSES', 'VEHICLE MAINTINANCE', '', 6810, 0, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    ['2083/06/31', '', 'QR-089', 'INVESTMENT', 'CCTV CAMERA INSTALATION', '', 16800, 0, 0, '', 'PRARAMBHA', '', '', 'Verified', ''],
    // unique reference, stored earlier under a different bank account
    ['2083/06/25', '', 'QR-090', 'BASUDEV DAIRY 316', 'ONLINE PAID FOR MILK 0606', '', 103664, 0, 0, '', 'PRARAMBHA', '', '', 'Verified', '']
];
const salaryRows = [
    ['PRARAMBHA DAIRY — SALARY ADVANCE RECORD'],
    ['Total Advances Imported (Rs):', '', 0, 'Records:', 12],
    ['ID', 'Employee Name *', 'Position', 'Month *', 'Basic Salary', 'Allowance', 'Advance', 'Deduction', 'Net Salary', 'Payment Date', 'Payment Mode', 'Remarks'],
    ['1', 'SARASWATI RAYMAJHI', 'ASSISTANT', '2083-05', 10000, 0, 0, 0, 10000, '2083-05-31', 'cash', '2083 SHRAWAN SALARY'],
    ['2', 'DIPAK NEPAL', 'ADMIN ASSISTANT', '2083-05', 15000, 0, 0, 0, 15000, '2083-05-31', 'cash', '2083 SHRAWAN SALARY'],
    // Remark copied down from the row above: the Month column is the truth.
    ['3', 'Nar Bahadur Rana', 'Driver', '2083-06', 22000, 0, 0, 0, 22000, '2083-06-31', 'cash', '2083 SHRAWAN SALARY'],
    ['4', 'OM BOMDEL', 'Driver', '2083-06', 22000, 0, 0, 0, 22000, '2083-06-31', 'cash', '2083 BHADRA SALARY']
];
const paymentRows = [
    ['PETTY CASH REGISTER — small daily expense record'],
    ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Description', 'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
    ['2083/06/29', '', '', 'MINA LAMICHHANE 322', '', 'PAYMENT FOR MILK SUPPLY UNTIL ASHOJ 15', 'Payment', '', '', 5690, 'Cash', '', ''],
    ['2083/06/30', '', '', 'BASUDEV DAIRY 316', '', '', 'Payment', '', '', 15000, 'Cash', '', '']
];
const wb = XLSX.utils.book_new();
// The real sheet keeps two title rows above the header (the importer starts at
// row 3); pad the fixture the same way so the offsets match the workbook.
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['PRARAMBHA DAIRY —BANK ACCOUNT'],
    ['From Date ►', '2083/03/15'],
    ...bankRows
]), 'BANK RECON');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(salaryRows), 'Salary Advance');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paymentRows), 'Payment');
XLSX.writeFile(wb, xlsxPath);

// Parties the Payment sheet will resolve (autoCreate is on for that sheet).
db.prepare("INSERT INTO parties (name, type) VALUES ('MINA LAMICHHANE 322', 'supplier')").run();
db.prepare("INSERT INTO parties (name, type) VALUES ('BASUDEV DAIRY 316', 'supplier')").run();

// A salary row saved earlier by the buggy importer: right payment date, WRONG
// month (the remark overrode the sheet). It must be corrected, not duplicated.
const staleEmp = Number(db.prepare("INSERT INTO employees (code, name, position) VALUES ('EMP-003', 'Nar Bahadur Rana', 'Driver')").run().lastInsertRowid);
db.prepare(`INSERT INTO salary_records (employee_id, employee_name, position, month, basic_salary, allowance, advance,
    deduction, net_salary, payment_date, payment_mode, remarks, voucher_no)
    VALUES (?, 'Nar Bahadur Rana', 'Driver', '2083-05', 22000, 0, 0, 0, 22000, '2083-06-31', 'cash', '2083 BHADRA SALARY', '')`)
    .run(staleEmp);
const salaryCount = () => Number(db.prepare('SELECT COUNT(*) c FROM salary_records').get().c);
const bankCount = () => Number(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c);

// A bank row already stored from an earlier workbook copy: same transaction,
// old bank account, stored under its reference uid.
db.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount,
    payment_mode, bank_account, txn_type, match_status, accounting_class, txn_uid)
    VALUES ('2083-06-25', 'QR-090', 'BASUDEV DAIRY 316', 'ONLINE PAID FOR MILK 0606', 103664, 0, 103664,
    'QR/Bank', 'Sushil QR', '', 'auto', 'supplier_payment', 'ref:QR-090')`).run();

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — a repeated reference imports every distinct row once');
// ════════════════════════════════════════════════════════════
runExcelImport(db, xlsxPath, { mode: 'upsert', log: () => {} });
// 6 brand-new QR-089 rows + the pre-existing QR-090 (no duplicate)
ok(bankCount() === 8, 'seven distinct QR-089 rows imported, QR-090 not duplicated', bankCount());
const dup = db.prepare("SELECT COUNT(*) c FROM bank_transactions WHERE reference_no = 'QR-089' AND counterparty_name = 'MODERN AGRO  -315'").get().c;
ok(dup === 1, 'the MODERN AGRO row exists exactly once', dup);
eq(db.prepare("SELECT SUM(credit) s FROM bank_transactions WHERE reference_no='QR-089' AND counterparty_name='BANK'").get().s,
    108655, 'the cash deposit landed with its own amount');
eq(db.prepare("SELECT SUM(debit) s FROM bank_transactions WHERE accounting_class='expense'").get().s,
    8625, 'both office-expense rows imported (1815 + 6810)');
eq(db.prepare("SELECT SUM(debit) s FROM bank_transactions").get().s, 91712 + 1815 + 6810 + 16800 + 103664,
    'bank debit total matches the sheet');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — re-import adds nothing');
// ════════════════════════════════════════════════════════════
const bankBefore = bankCount(), salBefore = salaryCount();
const payBefore = Number(db.prepare('SELECT COUNT(*) c FROM payments').get().c);
runExcelImport(db, xlsxPath, { mode: 'upsert', log: () => {} });
ok(bankCount() === bankBefore, 'bank rows unchanged on a second import', { before: bankBefore, after: bankCount() });
ok(salaryCount() === salBefore, 'salary rows unchanged on a second import', { before: salBefore, after: salaryCount() });
ok(Number(db.prepare('SELECT COUNT(*) c FROM payments').get().c) === payBefore, 'payments unchanged on a second import');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — Salary: Month column wins, stale month corrected');
// ════════════════════════════════════════════════════════════
ok(salaryCount() === 4, 'all four salary rows stored (no row dropped by a copied remark)', salaryCount());
const nar = db.prepare("SELECT * FROM salary_records WHERE LOWER(employee_name) = 'nar bahadur rana'").all();
ok(nar.length === 1, 'the stale Bhadra row was corrected in place, not duplicated', nar.length);
ok(nar[0] && nar[0].month === '2083-06', 'its month is the sheet month (2083-06)', nar[0] && nar[0].month);
const om = db.prepare("SELECT * FROM salary_records WHERE LOWER(employee_name) = 'om bomdel'").get();
ok(!!om, 'the newly added employee has a salary record');
eq(om && om.net_salary, 22000, 'OM BOMDEL net salary');
eq(db.prepare('SELECT SUM(net_salary) s FROM salary_records').get().s, 10000 + 15000 + 22000 + 22000,
    'salary total matches the sheet');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — Payment sheet stays out of Bank Transactions');
// ════════════════════════════════════════════════════════════
const bankSnapshot = JSON.stringify(db.prepare('SELECT * FROM bank_transactions ORDER BY id').all());
const paidRows = db.prepare("SELECT * FROM payments WHERE type = 'payment'").all();
ok(paidRows.length >= 2, 'the Payment sheet reached the Payment register', paidRows.length);
eq(paidRows.reduce((s, p) => s + p.amount, 0), 5690 + 15000, 'payment register total matches the sheet');
ok(JSON.stringify(db.prepare('SELECT * FROM bank_transactions ORDER BY id').all()) === bankSnapshot,
    'no bank row was created or altered by importing payments');
ok(db.prepare('SELECT COUNT(*) c FROM payments WHERE bank_txn_id IS NOT NULL').get().c === 0,
    'no imported payment carries a bank link');

console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
