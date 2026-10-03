/**
 * Advance Recovery Register — acceptance tests (spec Phases 8–10)
 * ===============================================================
 * Works the spec's own example end to end:
 *
 *   Employee gets Rs. 50,000 advance        → balance sheet, P&L = 0
 *   Returns Rs. 20,000 in cash              → balance sheet, P&L = 0
 *   Adjusted against an approved expense
 *     of Rs. 15,000                         → P&L expense, receivable ↓
 *   Outstanding = 50,000 − 20,000 − 15,000  → Rs. 15,000
 *
 * Plus: ageing buckets (7/30/60/90+), register = Advance Receivable balance,
 * and the company ledger shows every movement as Balance Sheet, never P&L.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-advance-register.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const payments = require(path.join(ROOT, 'shared', 'operations', 'payments.js'));
const { getAdvanceRecoveryRegister } = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));
const { getCompanyLedger } = require(path.join(ROOT, 'shared', 'operations', 'company_ledger.js'));

const DB_PATH = '/tmp/advance-register-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'advance-register-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;

const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const emp = party('AR Employee', 'supplier');
const other = party('AR Contractor', 'supplier');

const AS_OF = '2083-07-01';

// ── The spec's example ────────────────────────────────────────
console.log('\n═══ 1. Advance → returned → adjusted → outstanding ═══');
payments.savePayment(db, { party_id: emp, date: '2083-06-25', type: 'payment', transaction_type: 'advance', amount: 50000, mode: 'cash', notes: 'Advance to employee' });
payments.savePayment(db, { party_id: emp, date: '2083-06-27', type: 'receipt', transaction_type: 'advance_returned', amount: 20000, mode: 'cash', notes: 'Returned unused cash' });
payments.savePayment(db, { party_id: emp, date: '2083-06-29', type: 'payment', transaction_type: 'advance_adjustment', amount: 15000, mode: 'cash', notes: 'Adjusted against approved expense' });

const reg = getAdvanceRecoveryRegister(db, { as_of: AS_OF });
const s = reg.summary;
check('1a. advance given 50,000', near(s.advance_given, 50000), s.advance_given);
check('1b. returned 20,000', near(s.returned, 20000), s.returned);
check('1c. adjusted 15,000', near(s.adjusted, 15000), s.adjusted);
check('1d. outstanding 15,000 (50k − 20k − 15k)', near(s.total_outstanding, 15000), s.total_outstanding);
check('1e. register checks all pass', reg.all_checks_ok, reg.checks.filter(c => !c.ok));
for (const c of reg.checks) check(`1f. ${c.name}`, c.ok, { expected: c.expected, actual: c.actual });

const lot = reg.lots.find(l => l.party_id === emp);
check('1g. one lot shows the full story', lot && near(lot.advance, 50000) && near(lot.returned, 20000)
    && near(lot.adjusted, 15000) && near(lot.outstanding, 15000), lot);
check('1h. movement history has 3 rows (given/returned/adjusted)',
    reg.movements.filter(m => m.party_id === emp).length === 3, reg.movements.filter(m => m.party_id === emp));

// ── 2. P&L separation ────────────────────────────────────────
console.log('\n═══ 2. Advances never reach P&L; the adjustment does ═══');
const pnl = ops.getProfitLoss(db, { from_date: '2083-06-01', to_date: AS_OF });
check('2a. advance is NOT an expense (expenses = only the 15,000 adjustment)',
    near(pnl.expenses.total_expenses, 15000), pnl.expenses.total_expenses);
check('2b. P&L balance_sheet_movements shows advances paid 50,000',
    near(pnl.balance_sheet_movements.advances_paid.total, 50000), pnl.balance_sheet_movements.advances_paid);
check('2c. P&L balance_sheet_movements shows advances returned 20,000',
    near(pnl.balance_sheet_movements.advances_returned.total, 20000), pnl.balance_sheet_movements.advances_returned);
check('2d. net profit = −15,000 (only the real expense)', near(pnl.net_profit, -15000), pnl.net_profit);

// ── 3. Balance = register ────────────────────────────────────
console.log('\n═══ 3. Register equals the Advance Receivable balance ═══');
const bal = ops.getLoanAdvanceBalances(db, { as_of: AS_OF });
check('3a. balance 15,000 = register outstanding', near(bal.advance_receivable, 15000) && near(s.total_outstanding, 15000),
    { balance: bal.advance_receivable, register: s.total_outstanding });

// ── 4. Ageing buckets ────────────────────────────────────────
console.log('\n═══ 4. Ageing (7 / 30 / 60 / 90+ days) ═══');
payments.savePayment(db, { party_id: other, date: '2083-01-01', type: 'payment', transaction_type: 'advance', amount: 10000, mode: 'cash', notes: 'Old advance' });
const reg2 = getAdvanceRecoveryRegister(db, { as_of: AS_OF });
const oldLot = reg2.lots.find(l => l.party_id === other);
check('4a. old advance is open and aged into the 90+ bucket', oldLot && oldLot.due_status === '90+' && oldLot.age_days >= 90, oldLot);
check('4b. outstanding = 15,000 current + 10,000 old = 25,000', near(reg2.summary.total_outstanding, 25000), reg2.summary.total_outstanding);
check('4c. current bucket (0–6 days) = 15,000', near(reg2.summary.current, 15000), reg2.summary.current);
check('4d. overdue (7+ days) = 10,000', near(reg2.summary.overdue, 10000), reg2.summary.overdue);
check('4e. 90+ bucket = 10,000', near(reg2.summary.bucket_90, 10000), reg2.summary.bucket_90);
check('4f. 30/60 buckets = 10,000 (cumulative from 30 up)', near(reg2.summary.bucket_30, 10000) && near(reg2.summary.bucket_60, 10000),
    { b30: reg2.summary.bucket_30, b60: reg2.summary.bucket_60 });
check('4g. new advance is current (age < 7 days)', reg2.lots.find(l => l.party_id === emp).due_status === 'current',
    reg2.lots.find(l => l.party_id === emp));
check('4h. second register still reconciles with the balance', reg2.all_checks_ok, reg2.checks.filter(c => !c.ok));
check('4i. balance now 25,000', near(ops.getLoanAdvanceBalances(db, { as_of: AS_OF }).advance_receivable, 25000));

// ── 5. Company ledger shows them as Balance Sheet ────────────
console.log('\n═══ 5. Company ledger classification ═══');
const cl = getCompanyLedger(db, { from_date: '2083-06-01', to_date: AS_OF, granularity: 'monthly' });
const givenRow = cl.rows.find(r => r.type === 'Advance paid');
const returnedRow = cl.rows.find(r => r.type === 'Advance returned');
const adjRow = cl.rows.find(r => r.type === 'Advance adjusted');
check('5a. advance paid = Balance Sheet debit 50,000', givenRow && givenRow.category === 'Balance Sheet' && near(givenRow.debit, 50000), givenRow);
check('5b. advance returned = Balance Sheet credit 20,000', returnedRow && returnedRow.category === 'Balance Sheet' && near(returnedRow.credit, 20000), returnedRow);
check('5c. adjustment = Expense debit 15,000', adjRow && adjRow.category === 'Expense' && near(adjRow.debit, 15000), adjRow);
check('5d. ledger still reconciles with the P&L', cl.all_checks_ok, cl.checks.filter(c => !c.ok));

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Advance-Register tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
