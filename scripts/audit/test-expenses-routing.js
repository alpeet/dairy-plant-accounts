#!/usr/bin/env node
/**
 * test-expenses-routing.js — the Expenses sheet goes to `other_expenses`, once
 *
 * Part A (controlled): one office expense imported from the Expenses sheet must
 *   - land in other_expenses
 *   - NOT land in petty_cash
 *   - raise the P&L operating expenses by exactly its amount, not twice
 *
 * Part B (real workbook copy): a full import must leave no expense voucher in
 *   both registers, and the Expenses module must be populated.
 *
 * Never touches the live database or the real workbook.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..', '..');
const excelImport = require(path.join(ROOT, 'shared', 'excel-import'));
const monthly = require(path.join(ROOT, 'shared', 'operations', 'monthly_report'));
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const { workbookPath } = require(path.join(ROOT, 'shared', 'workbook-path'));

let passed = 0, failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;
const quiet = () => {};

// ── Part A: one expense, one register, one P&L charge ─────────
console.log('\nA. A single Expenses-sheet voucher');
const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-a-'));
const dbA = initDatabase(dirA);

// Expenses sheet layout: Date, AD, Receipt No, Payee, Against Bill, Description,
// Type, Opening Due, Collected, Paid, Mode, Closing Due, Remarks
const sheet = [
    ['PRARAMBHA DAIRY — EXPENSES'],
    ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Description',
        'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
    ['2083-04-20', '', 'E-9001', 'OFFICE EXPENSES', '', 'ELECTRICITY ASHADH', 'OFFICE EXPENSES', '', '', 900, 'cash', '', '']
];

const res = excelImport.importPettyCashSheet(dbA, sheet, { mode: 'fresh', log: quiet, sheetName: 'Expenses' });
const oe = dbA.prepare('SELECT * FROM other_expenses').all();
const pc = dbA.prepare('SELECT * FROM petty_cash').all();

check(res.other_expense === 1, 'importer reports one other_expense row', res);
check(oe.length === 1, 'the expense is in other_expenses (Expenses module)', oe.length);
check(pc.length === 0, 'the expense is NOT also in petty_cash', pc.length);
check(oe.length === 1 && near(oe[0].amount, 900), 'amount preserved', oe[0] && oe[0].amount);
check(oe.length === 1 && oe[0].expense_head === 'ELECTRICITY ASHADH', 'expense head is the description', oe[0] && oe[0].expense_head);
check(oe.length === 1 && oe[0].paid_to === 'OFFICE EXPENSES', 'payee preserved', oe[0] && oe[0].paid_to);
check(oe.length === 1 && oe[0].date === '2083-04-20', 'BS date preserved', oe[0] && oe[0].date);

const R = monthly.getMonthlyReport(dbA, { from_date: '2083-04-01', to_date: '2083-04-31' });
check(near(R.summary.operating_expenses, 900), 'P&L operating expenses count it exactly once (900)', R.summary.operating_expenses);
check(near(R.activity.expense_sources.other_expenses, 900), 'it is recognised from other_expenses', R.activity.expense_sources.other_expenses);
check(near(R.activity.expense_sources.petty_cash, 0), 'nothing is recognised from petty_cash', R.activity.expense_sources.petty_cash);

// Re-importing the same sheet must not add a second row.
const res2 = excelImport.importPettyCashSheet(dbA, sheet, { mode: 'upsert', log: quiet, sheetName: 'Expenses' });
check(dbA.prepare('SELECT COUNT(*) n FROM other_expenses').get().n === 1, 're-import adds no duplicate expense');
check(res2.other_expense === 0, 're-import reports nothing added', res2.other_expense);

// A PETTY CASH sheet voucher still belongs to the petty-cash box.
const pettySheet = [
    ['PETTY CASH'],
    ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Description',
        'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
    ['2083-04-21', '', 'PC-9001', 'OFFICE EXPENSES', '', 'TEA', 'PETTY CASH', '', '', 150, 'cash', '', '']
];
excelImport.importPettyCashSheet(dbA, pettySheet, { mode: 'upsert', log: quiet, sheetName: 'PETTY CASH' });
const oeAfter = dbA.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM other_expenses').get();
const pcAfter = dbA.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM petty_cash').get();
check(oeAfter.t === 900, 'a PETTY CASH voucher does not enter other_expenses', oeAfter);
check(pcAfter.n === 1 && near(pcAfter.t, 150), 'a PETTY CASH voucher stays in petty_cash', pcAfter);

const R2 = monthly.getMonthlyReport(dbA, { from_date: '2083-04-01', to_date: '2083-04-31' });
check(near(R2.summary.operating_expenses, 1050), 'P&L counts both, once each (900 + 150)', R2.summary.operating_expenses);

dbA.close();
fs.rmSync(dirA, { recursive: true, force: true });

// ── Part B: the real workbook ─────────────────────────────────
console.log('\nB. Full import of the real workbook copy');
const src = workbookPath();
if (!fs.existsSync(src)) { console.log(`Workbook not found: ${src}`); process.exit(2); }
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-b-'));
const book = path.join(dirB, 'workbook.xlsx');
fs.copyFileSync(src, book);

const dbB = initDatabase(dirB);
const full = excelImport.runExcelImport(dbB, book, { mode: 'fresh', log: quiet });

const oeRows = dbB.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM other_expenses WHERE COALESCE(category,'') <> 'Income'").get();
check(oeRows.n > 0, `the Expenses module is populated (${oeRows.n} rows)`, oeRows);
check(full.registers && full.registers.Expenses && full.registers.Expenses.other_expense > 0,
    'the import reports Expenses rows routed to other_expenses', full.registers && full.registers.Expenses);

// One expense must never sit in both registers.
const overlap = dbB.prepare(`
    SELECT COUNT(*) n FROM other_expenses oe
    WHERE COALESCE(oe.category,'') <> 'Income'
      AND EXISTS (
        SELECT 1 FROM petty_cash pc
         WHERE pc.date = oe.date
           AND ABS(pc.amount - oe.amount) < 0.005
           AND UPPER(TRIM(COALESCE(pc.paid_to,''))) = UPPER(TRIM(COALESCE(oe.paid_to,'')))
           AND UPPER(TRIM(COALESCE(pc.description,''))) = UPPER(TRIM(COALESCE(oe.description,'')))
      )
`).get().n;
check(overlap === 0, 'no expense voucher appears in both other_expenses and petty_cash', overlap);

// Every expense row must have exactly one home: the union has no duplicate keys.
const allKeys = [
    ...dbB.prepare("SELECT date, amount, paid_to, description FROM other_expenses WHERE COALESCE(category,'') <> 'Income'").all()
        .map(r => `OE|${r.date}|${Math.round(r.amount * 100)}|${String(r.paid_to).toUpperCase()}|${String(r.description).toUpperCase()}`),
    ...dbB.prepare("SELECT date, amount, paid_to, description FROM petty_cash WHERE UPPER(TRIM(COALESCE(expense_head,''))) <> 'ADVANCE'").all()
        .map(r => `OE|${r.date}|${Math.round(r.amount * 100)}|${String(r.paid_to).toUpperCase()}|${String(r.description).toUpperCase()}`)
];
check(new Set(allKeys).size === allKeys.length, 'every expense key is unique across both registers',
    { total: allKeys.length, unique: new Set(allKeys).size });

// The Expenses sheet's own vouchers must be readable through the Expenses module.
const sheetExpenses = XLSX.utils.sheet_to_json(
    XLSX.readFile(book).Sheets['Expenses'] || {}, { header: 1, defval: '' }
).slice(2).filter(r => r && String(r[0]).trim() !== '' && Number(r[9]) > 0);
check(sheetExpenses.length > 0, `Expenses sheet has ${sheetExpenses.length} paid vouchers`);
check(oeRows.n >= sheetExpenses.length - dbB.prepare("SELECT COUNT(*) n FROM petty_cash").get().n,
    'no more expenses than the sheet contains', { imported: oeRows.n, sheet: sheetExpenses.length });

// P&L must still reconcile: heads sum to the reported operating expenses.
const P = monthly.getMonthlyReport(dbB, {});
const headsTotal = P.expense_heads.reduce((s, h) => s + Number(h.amount || 0), 0);
check(near(headsTotal, P.summary.operating_expenses, 0.5), 'P&L expense heads sum to operating expenses (no double count)',
    { heads: headsTotal, opex: P.summary.operating_expenses });
// The report covers its own period, so compare like with like.
const oePeriod = dbB.prepare(`
    SELECT COALESCE(SUM(amount), 0) t FROM other_expenses
     WHERE COALESCE(category, '') <> 'Income' AND date >= ? AND date <= ?
`).get(P.from_date, P.to_date).t;
check(near(P.activity.expense_sources.other_expenses, oePeriod, 0.5),
    'P&L recognises exactly the other_expenses total for its period',
    { source: P.activity.expense_sources.other_expenses, rows: oePeriod, period: `${P.from_date}→${P.to_date}` });

dbB.close();
fs.rmSync(dirB, { recursive: true, force: true });

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
