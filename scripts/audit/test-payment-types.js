/**
 * Payment Transaction-Type Accounting Tests — spec items 1–9
 * ==========================================================
 * Core rule: payment does NOT automatically mean expense.
 *   Advance paid       → Cash −, Advance Receivable +, P&L 0
 *   Loan received      → Cash +, Loan Payable +,      P&L 0 (not income)
 *   Loan given         → Cash −, Loan Receivable +,   P&L 0
 *   Loan repayment     → Cash/Payable movement only,  P&L 0
 *   Advance adjustment → P&L expense recognised, Advance Receivable −
 *   Actual expense     → P&L expense
 *
 * Run: NODE_PATH="$PWD/node_modules" node scripts/audit/test-payment-types.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const paymentsOps = require(path.join(ROOT, 'shared', 'operations', 'payments.js'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));
const { getProfitLoss } = require(path.join(ROOT, 'shared', 'operations', 'financial_reports.js'));
const { exportToDailyAccountExcel } = require(path.join(ROOT, 'shared', 'export-daily-account.js'));
const importer = require(path.join(ROOT, 'shared', 'excel-import.js'));

const DB_PATH = '/tmp/payment-types-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'payment-types-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
function near(a, b, eps = 0.01) { return Math.abs(Number(a || 0) - Number(b || 0)) < eps; }

const supplier = db.prepare("INSERT INTO parties (name, type) VALUES ('Advance Supplier', 'supplier')").run().lastInsertRowid;
const lender = db.prepare("INSERT INTO parties (name, type) VALUES ('Kind Lender', 'customer')").run().lastInsertRowid;
const borrower = db.prepare("INSERT INTO parties (name, type) VALUES ('Loan Borrower', 'customer')").run().lastInsertRowid;
const electricity = db.prepare("INSERT INTO parties (name, type) VALUES ('Electricity Office', 'supplier')").run().lastInsertRowid;/** Cash + ledger effect of a typed payment, checked against expectations. */
function postAndVerify(title, { party_id, type, transaction_type, amount, mode, direction }, expect) {
    const res = paymentsOps.savePayment(db, { party_id, date: '2083-07-15', type, transaction_type, amount, mode: mode || 'cash' }, 1);
    const pid = res.id || res;
    const rows = db.prepare(
        "SELECT reference_type, description, debit, credit FROM ledger_entries WHERE reference_type IN ('payment_received','payment_made','advance','adjustment') AND reference_id = ?"
    ).all(pid);
    // Cash movement: payment_received credits = money in; payment_made debits
    // = money out; a no-cash journal leg ('advance' ref) moves no money.
    const cashMovement = rows.reduce((s, r) =>
        r.reference_type === 'payment_received' ? s + (Number(r.credit) || 0)
        : r.reference_type === 'payment_made' ? s - (Number(r.debit) || 0)
        : s, 0);
    check(`${title}: cash/bank movement ${expect.cash > 0 ? '+' : ''}${expect.cash}`,
        near(cashMovement, expect.cash), rows);
    // Tagged BS/P&L account: find the row carrying the tag; its natural
    // balance movement = debit − credit.
    if (expect.account) {
        const tagRow = rows.find(r => String(r.description).includes(`[${expect.account}]`));
        check(`${title}: tagged with [${expect.account}]`, !!tagRow, rows.map(r => r.description));
        if (tagRow) {
            const tagMovement = (Number(tagRow.debit) || 0) - (Number(tagRow.credit) || 0);
            check(`${title}: ${expect.account} movement ${expect.accountDelta > 0 ? '+' : ''}${expect.accountDelta}`,
                near(tagMovement, expect.accountDelta), tagRow);
        }
    }
    if (expect.reference_type) {
        const moneyRow = rows.find(r => r.reference_type === expect.reference_type);
        check(`${title}: has a ${expect.reference_type} ledger row`, !!moneyRow, rows.map(r => r.reference_type));
    }
    return pid;
}

console.log('\n═══ 1. Advance paid: Cash −50,000, Advance Receivable +50,000, P&L 0 ═══');
postAndVerify('advance', {
    party_id: supplier, type: 'payment', transaction_type: 'advance', amount: 50000, mode: 'cash'
}, { cash: -50000, account: accounting.ACCOUNT.ADVANCE_RECEIVABLE, accountDelta: 50000, reference_type: 'payment_made' });

console.log('\n═══ 2. Loan received: Cash +100,000, Loan Payable +100,000, P&L income 0 ═══');
postAndVerify('loan received', {
    party_id: lender, type: 'receipt', transaction_type: 'loan_received', amount: 100000, mode: 'bank'
}, { cash: 100000, account: accounting.ACCOUNT.LOAN_PAYABLE, accountDelta: -100000, reference_type: 'payment_received' });

console.log('\n═══ 3. Loan/Sapati given: Cash −30,000, Loan Receivable +30,000, P&L 0 ═══');
postAndVerify('loan given', {
    party_id: borrower, type: 'payment', transaction_type: 'loan_given', amount: 30000, mode: 'cash'
}, { cash: -30000, account: accounting.ACCOUNT.LOAN_RECEIVABLE, accountDelta: 30000, reference_type: 'payment_made' });

console.log('\n═══ 4a. Loan repayment received: Cash +10,000, Loan Receivable −10,000 ═══');
postAndVerify('repayment received', {
    party_id: borrower, type: 'receipt', transaction_type: 'loan_repayment', amount: 10000, mode: 'cash', direction: 'in'
}, { cash: 10000, account: accounting.ACCOUNT.LOAN_RECEIVABLE, accountDelta: -10000, reference_type: 'payment_received' });

console.log('\n═══ 4b. Loan repaid: Cash −20,000, Loan Payable −20,000 ═══');
postAndVerify('loan repaid', {
    party_id: lender, type: 'payment', transaction_type: 'loan_repayment', amount: 20000, mode: 'cash', direction: 'out'
}, { cash: -20000, account: accounting.ACCOUNT.LOAN_PAYABLE, accountDelta: 20000, reference_type: 'payment_made' });

console.log('\n═══ 5. Actual expense: P&L recognises it ═══');
postAndVerify('actual expense', {
    party_id: electricity, type: 'payment', transaction_type: 'actual_expense', amount: 5000, mode: 'cash'
}, { cash: -5000, account: accounting.ACCOUNT.EXPENSE, accountDelta: 5000, reference_type: 'payment_made' });

console.log('\n═══ 6. Advance adjustment: expense recognised, advance reduced ═══');
postAndVerify('advance adjustment', {
    party_id: supplier, type: 'payment', transaction_type: 'advance_adjustment', amount: 20000, mode: 'cash'
}, { cash: 0, account: accounting.ACCOUNT.ADVANCE_RECEIVABLE, accountDelta: -20000, reference_type: 'adjustment' });

console.log('\n═══ 7. Balances (balance sheet) ═══');
const bal = accounting.getLoanAdvanceBalances(db);
check('advance receivable = 30,000 (50k − 20k)', near(bal.advance_receivable, 30000), bal);
check('loan receivable = 20,000 (30k − 10k)', near(bal.loan_receivable, 20000), bal);
check('loan payable = 80,000 (100k − 20k)', near(bal.loan_payable, 80000), bal);

console.log('\n═══ 8. P&L: genuine expenses only — 5k electricity + 20k advance consumed ═══');
const pl = getProfitLoss(db, { from_date: '2083-07-01', to_date: '2083-07-31' });
check('typed expenses recognised: 5k actual + 20k advance_adjustment', near(pl.expenses.typed_payment_expenses.total, 25000), pl.expenses.typed_payment_expenses);
check('advances/loans/repayments NOT in expense totals', near(pl.expenses.total_expenses, 25000), pl.expenses.total_expenses);
check('loan received NOT in income', near(pl.income.total_income, 0), pl.income.total_income);
check('net profit = −25,000 (only genuine expenses hit P&L)', near(pl.net_profit, -25000), pl.net_profit);
check('P&L reports balance-sheet movements transparently',
    pl.balance_sheet_movements && near(pl.balance_sheet_movements.advances_paid.total, 50000)
    && near(pl.balance_sheet_movements.loans_received.total, 100000), pl.balance_sheet_movements);

console.log('\n═══ 9. Excel round-trip preserves transaction types (§8) ═══');
const xlsxPath = '/tmp/payment-types-export.xlsx';
try { fs.unlinkSync(xlsxPath); } catch (e) { /* ignore */ }
exportToDailyAccountExcel(db, xlsxPath);
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
{
    const wb = XLSX.readFile(xlsxPath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Collection'], { header: 1, defval: '' });
    const ttCol = 11;
    const loanRow = rows.find(r => String(r[ttCol]) === 'loan_received');
    const advRow = rows.find(r => String(r[ttCol]) === 'advance');
    check('exporter writes transaction_type column', !!loanRow && !!advRow, rows.map(r => r[ttCol]).filter(Boolean));
    check('loan received shown as money IN', loanRow && near(Number(loanRow[7]) || 0, 100000), loanRow && loanRow[7]);
}

// Import the same file into the same DB (upsert): no duplicates, types preserved
const payBefore = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
const imp1 = importer.runExcelImport(db, xlsxPath, { mode: 'upsert', log: () => {} });
const payAfter = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
check('re-import does not duplicate payments', payAfter === payBefore, { before: payBefore, after: payAfter });
const ttCounts = db.prepare(
    "SELECT transaction_type, COUNT(*) c FROM payments WHERE transaction_type IS NOT NULL GROUP BY transaction_type"
).all();
const ttMap = Object.fromEntries(ttCounts.map(r => [r.transaction_type, r.c]));
check('all typed payments kept their type (2 loan_repayment: given-side received + repaid)',
    ttMap.advance === 1 && ttMap.loan_given === 1 && ttMap.loan_received === 1
    && ttMap.loan_repayment === 2 && ttMap.actual_expense === 1 && ttMap.advance_adjustment === 1, ttMap);

// Fresh-DB import: typed rows must land typed
{
    for (const f of ['/tmp/pt2.db', '/tmp/pt2.db-wal', '/tmp/pt2.db-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
    const db2 = initDatabase('/tmp', 'pt2.db');
    importer.runExcelImport(db2, xlsxPath, { mode: 'fresh', log: () => {} });
    const imported = db2.prepare("SELECT transaction_type, COUNT(*) c FROM payments GROUP BY transaction_type ORDER BY c DESC").all();
    const hasLoan = imported.some(r => r.transaction_type === 'loan_received');
    const hasAdv = imported.some(r => r.transaction_type === 'advance');
    check('fresh import keeps advance + loan_received types', hasLoan && hasAdv, imported);
    db2.close();
    for (const f of ['/tmp/pt2.db', '/tmp/pt2.db-wal', '/tmp/pt2.db-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
}

console.log('\n═══ 10. Type change re-posts the accounting (edit UI path) ═══');
{
    const advPay = db.prepare("SELECT id FROM payments WHERE transaction_type = 'advance' ORDER BY id LIMIT 1").get();
    paymentsOps.updatePayment(db, { id: advPay.id, transaction_type: 'actual_expense', notes: 'reclassified' });
    const led2 = db.prepare("SELECT description FROM ledger_entries WHERE reference_id = ? AND reference_type = 'payment_made'").get(advPay.id);
    check('reclassification re-posts ledger to Expense account',
        led2 && led2.description.includes(`[${accounting.ACCOUNT.EXPENSE}]`), led2 && led2.description);
    const bal2 = accounting.getLoanAdvanceBalances(db);
    check('advance receivable drops by the reclassified 50,000 (30k − 50k)', near(bal2.advance_receivable, -20000), bal2);
}

console.log('\n════════════════════════════════════════');
console.log(`PAYMENT TYPES RESULT: ${passed} passed, ${failed} failed`);
db.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
process.exit(failed > 0 ? 1 : 0);
