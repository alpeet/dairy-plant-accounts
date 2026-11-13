#!/usr/bin/env node
/**
 * test-profit-loss-rent.js — Rent is its own P&L category, counted exactly once
 *
 * Proves, on a throw-away database:
 *   · rent vouchers already inside other_expenses / petty_cash are shown under
 *     Rent and REMOVED from those buckets, so no total moves;
 *   · rent received (an Income row) is never treated as rent expense;
 *   · an 'Advance' voucher for six months of rent is NOT rent expense — only
 *     the month of prepaid rent actually used is charged, once;
 *   · the month's rent, Total Operating Expenses and Net Profit agree with the
 *     sum of the categories, for both a single month and a date range;
 *   · the monthly report shows the same rent under a 'Rent' head;
 *   · every other category is unchanged.
 *
 * Never touches the live database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const financialReports = require(path.join(ROOT, 'shared', 'operations', 'financial_reports'));
const monthlyReport = require(path.join(ROOT, 'shared', 'operations', 'monthly_report'));
const prepaid = require(path.join(ROOT, 'shared', 'operations', 'prepaid_rent'));
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));

let passed = 0, failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

// ── Fixtures ────────────────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rent-'));
const db = initDatabase(dir);
const run = (sql, ...args) => db.prepare(sql).run(...args);

// Rent PAID in the Expenses register (the workbook's "Type = RENT" voucher).
run(`INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no)
     VALUES ('2083-04-10', 'Operating', 'RENT PAID ASHADH', 'RENT PAID FOR THE MONTH OF ASHADH-2083', 12000, 'SAI KRIPA KSS LTD', 'cash', 'OE-R1')`);
// A non-rent expense, must stay in Other Expenses.
run(`INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no)
     VALUES ('2083-04-11', 'Operating', 'ELECTRICITY ASHADH', 'NEA BILL', 2000, 'NEA', 'cash', 'OE-E1')`);
// Rent RECEIVED — income, never rent expense.
run(`INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode)
     VALUES ('2083-04-12', 'Income', 'Rent Received', 'Rent received - TILAK RAYMAJHI', 5000, '', 'cash')`);
// Rent paid through the petty-cash register, plus unrelated petty items.
run(`INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, payment_mode)
     VALUES ('PV-1', '2083-04-13', 'RENT', 'SHOP RENT PAID', 3000, 'LANDLORD', 'cash')`);
run(`INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, payment_mode)
     VALUES ('PV-2', '2083-04-14', 'ELECTRICITY', 'NEA BILL PART PAYMENT', 1000, 'NEA', 'cash')`);
// The six-month advance: an ASSET, not rent expense. Must never reach Rent.
run(`INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, payment_mode)
     VALUES ('PV-3', '2083-04-15', 'Advance', 'PAID 6 MONTH ADVANCE RENT', 910000, 'SAI KRIPA KSS LTD', 'cash')`);
run(`INSERT INTO salary_records (employee_name, month, basic_salary, net_salary, payment_date)
     VALUES ('RAM BAHADUR', '2083-04', 8000, 8000, '2083-04-16')`);

// Prepaid rent: 60,000 for three months starting 2083-04, paid in March.
prepaid.savePrepaidExpense(db, {
    name: 'Advance rent - test', category: 'Rent', payment_date: '2083-03-25',
    amount: 60000, months: 3, start_month: '2083-04', party_name: 'LANDLORD'
});

const APRIL = { from_date: '2083-04-01', to_date: '2083-04-31' };
const MAY = { from_date: '2083-05-01', to_date: '2083-05-31' };
const BOTH = { from_date: '2083-04-01', to_date: '2083-05-31' };

// ── A. Rent appears separately ──────────────────────────────────────────────
console.log('\nA. Rent is its own category');
const p = financialReports.getProfitLoss(db, APRIL);
const rent = p.expenses.rent;

check(!!rent, 'P&L exposes an expenses.rent category', Object.keys(p.expenses));
check(near(rent.total, 35000), 'April rent = 12,000 register + 3,000 petty + 20,000 prepaid used', rent.total);
check(near(rent.sources.other_expenses, 12000), 'rent sourced from the Expenses register', rent.sources);
check(near(rent.sources.petty_cash, 3000), 'rent sourced from petty cash', rent.sources);
check(near(rent.sources.typed_payments, 0), 'no typed payment rent', rent.sources);
check(near(rent.sources.prepaid_recognised, 20000), 'one month of the 3-month advance is charged', rent.sources);

// ── B. Counted exactly once ────────────────────────────────────────────────
console.log('\nB. Rent is counted once, not inside another category');
check(near(p.expenses.other_expenses.total, 2000), 'Other Expenses holds only the non-rent voucher', p.expenses.other_expenses.total);
check(near(p.expenses.petty_cash.total, 1000), 'Petty Cash holds only the non-rent voucher', p.expenses.petty_cash.total);
check(near(p.expenses.salary.total, 8000), 'Salary unchanged', p.expenses.salary.total);
check(rent.total < 100000, 'the 910,000 advance is NOT rent expense', rent.total);

const componentSum = near(
    p.expenses.milk_collection.total + p.expenses.purchases.total + rent.total
    + p.expenses.other_expenses.total + p.expenses.petty_cash.total
    + p.expenses.salary.total + p.expenses.vehicle_expenses.total
    + p.expenses.bank_expenses.total + p.expenses.typed_payment_expenses.total,
    p.expenses.total_expenses);
check(componentSum, 'components sum to total expenses (rent in exactly one line)', {
    sum: componentSum, total: p.expenses.total_expenses
});
check(near(p.expenses.total_expenses, 46000), 'Total expenses = 35,000 rent + 2,000 + 1,000 + 8,000', p.expenses.total_expenses);
check(near(p.operating_expenses, 46000), 'Total Operating Expenses includes rent once', p.operating_expenses);

// ── C. Net profit ──────────────────────────────────────────────────────────
console.log('\nC. Net profit / loss');
check(near(p.net_profit, 5000 - 46000), 'net = income (5,000 rent received) - expenses (46,000)', p.net_profit);
check(near(p.net_profit, p.income.total_income - p.expenses.total_expenses), 'net equals income - total expenses');

// ── D. One more rent voucher changes net by exactly its amount ─────────────
console.log('\nD. Adding a rent voucher moves net by exactly that amount');
const beforeRent = p.expenses.rent.total;
const beforeOther = p.expenses.other_expenses.total;
const beforeSalary = p.expenses.salary.total;
run(`INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode)
     VALUES ('2083-04-20', 'Operating', 'RENT EXTRA', 'EXTRA RENT FOR ASHADH', 5000, 'LANDLORD', 'cash')`);
const after = financialReports.getProfitLoss(db, APRIL);
check(near(after.expenses.rent.total, beforeRent + 5000), 'rent rises by 5,000', after.expenses.rent.total);
check(near(after.net_profit, p.net_profit - 5000), 'net falls by exactly 5,000', after.net_profit);
check(near(after.expenses.other_expenses.total, beforeOther), 'other expenses unchanged', after.expenses.other_expenses.total);
check(near(after.expenses.salary.total, beforeSalary), 'salary unchanged', after.expenses.salary.total);

// ── E. Monthly and date-range filtering ────────────────────────────────────
console.log('\nE. Monthly and date-range filtering');
const may = financialReports.getProfitLoss(db, MAY);
check(near(may.expenses.rent.total, 20000), 'May rent = May\'s prepaid month only', may.expenses.rent.total);
check(near(may.expenses.other_expenses.total, 0), 'May has no other expenses', may.expenses.other_expenses.total);

const both = financialReports.getProfitLoss(db, BOTH);
check(near(both.expenses.rent.total, 35000 + 5000 + 20000), 'April-May range rent = 60,000', both.expenses.rent.total);

const monthly = financialReports.getProfitLossByMonth(db, BOTH);
const mApr = monthly.months.find(m => m.ym === '2083-04');
const mMay = monthly.months.find(m => m.ym === '2083-05');
check(!!mApr && near(mApr.rent, 40000), 'monthly table: April rent 40,000', mApr && mApr.rent);
check(!!mMay && near(mMay.rent, 20000), 'monthly table: May rent 20,000', mMay && mMay.rent);
check(!!mApr && near(mApr.operating_expenses, 51000), 'monthly table: April operating includes rent once', mApr && mApr.operating_expenses);
check(near(monthly.totals.rent, 60000), 'monthly totals carry rent', monthly.totals.rent);
check(near(monthly.totals.rent, both.expenses.rent.total), 'monthly rent total equals the period P&L rent');

// ── F. The monthly report uses the same 'Rent' head ────────────────────────
console.log('\nF. Monthly report head');
const rep = monthlyReport.getMonthlyReport(db, APRIL);
const rentHead = (rep.expense_heads || []).find(h => h.head === 'Rent');
check(!!rentHead, 'monthly report has a Rent head', (rep.expense_heads || []).map(h => h.head));
check(!!rentHead && near(rentHead.amount, 40000), 'monthly report rent equals the P&L rent', rentHead && rentHead.amount);
check(!(rep.expense_heads || []).some(h => h.head === 'Factory Rent'), 'no separate Factory Rent head');
check(near(rep.summary.operating_expenses, 51000), 'monthly report operating expenses include rent once',
    { operating: rep.summary.operating_expenses, heads: (rep.expense_heads || []).map(h => [h.head, h.amount]) });

// ── G. The real workbook's own rent voucher ────────────────────────────────
// The Expenses sheet types this row 'RENT' (Rs 165,000, Ashwin 2083). It used to
// be dropped entirely, which is why the P&L had no rent line.
console.log('\nG. Real workbook rent voucher');
try {
    const XLSX = require('xlsx');
    const excelImport = require(path.join(ROOT, 'shared', 'excel-import'));
    const { workbookPath } = require(path.join(ROOT, 'shared', 'workbook-path'));
    const src = workbookPath();
    if (src && fs.existsSync(src)) {
        const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'rent-wb-'));
        const dbB = initDatabase(dirB);
        const book = path.join(dirB, 'book.xlsx');
        fs.copyFileSync(src, book);
        excelImport.runExcelImport(dbB, book, { mode: 'fresh', log: () => {} });

        const rentRows = dbB.prepare(`SELECT date, expense_head, amount FROM other_expenses
            WHERE category != 'Income' AND UPPER(COALESCE(expense_head,'')||' '||COALESCE(description,'')) LIKE '%RENT%'`).all();
        check(rentRows.length === 1, 'the sheet\'s RENT-typed voucher is imported (1 row)', rentRows.length);
        check(rentRows.length === 1 && near(rentRows[0].amount, 165000), 'its amount is 165,000', rentRows[0] && rentRows[0].amount);

        const wbPnl = financialReports.getProfitLoss(dbB, { from_date: '2083-01-01', to_date: '2090-12-30' });
        check(near(wbPnl.expenses.rent.total, 165000), 'the P&L shows 165,000 under Rent', wbPnl.expenses.rent);
        check(near(wbPnl.expenses.rent.sources.other_expenses, 165000), 'sourced from the Expenses register', wbPnl.expenses.rent.sources);

        const ashwin = financialReports.getProfitLoss(dbB, { from_date: '2083-06-01', to_date: '2083-06-31' });
        check(near(ashwin.expenses.rent.total, 165000), 'Ashwin (2083-06) rent is 165,000', ashwin.expenses.rent.total);
        const wbRep = monthlyReport.getMonthlyReport(dbB, { from_date: '2083-06-01', to_date: '2083-06-31' });
        const wbHead = (wbRep.expense_heads || []).find(h => h.head === 'Rent');
        check(!!wbHead && near(wbHead.amount, 165000), 'the monthly report shows the same rent', wbHead && wbHead.amount);
        check(near(wbRep.summary.operating_expenses, ashwin.operating_expenses),
            'monthly report and P&L operating expenses agree',
            { report: wbRep.summary.operating_expenses, pnl: ashwin.operating_expenses });
        const wbSum = near(
            ashwin.expenses.milk_collection.total + ashwin.expenses.purchases.total + ashwin.expenses.rent.total
            + ashwin.expenses.other_expenses.total + ashwin.expenses.petty_cash.total + ashwin.expenses.salary.total
            + ashwin.expenses.vehicle_expenses.total + ashwin.expenses.bank_expenses.total
            + ashwin.expenses.typed_payment_expenses.total, ashwin.expenses.total_expenses);
        check(wbSum, 'rent is counted once in the real book\'s totals', ashwin.expenses.total_expenses);

        dbB.close();
        fs.rmSync(dirB, { recursive: true, force: true });
    } else {
        console.log('  ⏭  workbook not found — real-book check skipped');
    }
} catch (e) {
    check(false, 'real workbook check ran', e.message);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
try { db.close(); } catch (e) {}
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
