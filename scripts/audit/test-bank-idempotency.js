/**
 * Bank idempotency + date defaults + classification — targeted tests
 * ================================================================
 * Covers ONLY the new behaviour from the Bank/Cash/Salary audit round:
 *   1. txn_uid stable ids + unique index + legacy backfill
 *   2. importBankRows re-import is a no-op (refs AND no-ref content keys)
 *   3. manual save: ref conflict rejected, 10s double-submit returns existing
 *   4. deposit_no MAX sequencing (no collision after a delete)
 *   5. todayBSDate() + report bound defaults return data (not empty results)
 *   6. classify-on-read healing of legacy ''-class rows
 *   7. setBankAccountingClass manual override (persisted + audited)
 *   8. Cash Deposit summary: statement transfers surfaced once + reconciliation
 *
 * Run: NODE_PATH="$PWD/node_modules" node scripts/audit/test-bank-idempotency.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const bank = require(path.join(ROOT, 'shared', 'operations', 'bank.js'));
const cashDeposit = require(path.join(ROOT, 'shared', 'operations', 'cash_deposit.js'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));
const { todayBSDate, adToBS } = require(path.join(ROOT, 'shared', 'excel-import.js'));

const DB_PATH = '/tmp/bank-idem-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'bank-idem-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;

// Real user row (audit_log has FK changed_by → users.id)
const userId = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('idem-tester', 'x', 'admin')").run().lastInsertRowid);

// ── 1. Legacy backfill: raw rows with txn_uid NULL + class '' ───────────────
console.log('\n1) txn_uid migration + legacy backfill');
db.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount, match_status)
            VALUES ('2083-06-10', 'QR-LEG-1', 'Legacy Party', 'old row', 0, 5000, 5000, 'none')`).run();
db.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount, match_status)
            VALUES ('2083-06-11', '', 'No Ref Party', 'old row no ref', 2500, 0, 2500, 'none')`).run();
bank.ensureBankTable(db);
const legacyRows = db.prepare('SELECT id, txn_uid, reference_no FROM bank_transactions').all();
check('every bank row has a txn_uid', legacyRows.length > 0 && legacyRows.every(r => !!r.txn_uid), legacyRows.map(r => r.txn_uid));
check('ref row keyed as ref:<reference>', legacyRows.some(r => r.txn_uid === 'ref:QR-LEG-1'));
check('no-ref row keyed as content hash', legacyRows.some(r => String(r.txn_uid).startsWith('imp:')));
const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bank_txn_uid'").get();
check('unique index idx_bank_txn_uid exists', !!idx);
let uniqueErr = null;
try {
    db.prepare('UPDATE bank_transactions SET txn_uid = ? WHERE id = ?').run(legacyRows[0].txn_uid, legacyRows[1].id);
} catch (e) { uniqueErr = e; }
check('unique index rejects duplicate txn_uid', !!uniqueErr, uniqueErr && uniqueErr.message);
db.prepare('UPDATE bank_transactions SET txn_uid = ? WHERE id = ?').run(legacyRows[0].txn_uid === 'ref:QR-LEG-1' ? 'ref:QR-LEG-1' : legacyRows[0].txn_uid, legacyRows[0].id);

// ── 2. Import idempotency ───────────────────────────────────────────────────
console.log('\n2) importBankRows re-import is a no-op');
const stmt1 = { date: '2083-06-12', reference_no: 'IMP-R1', counterparty_name: 'Alpha Traders', description: 'QR settlement', credit: 100000, debit: 0 };
const stmt2 = { date: '2083-06-12', reference_no: 'IMP-R2', counterparty_name: 'Beta Suppliers', description: 'transfer out', credit: 0, debit: 45000 };
const noRefA = { date: '2083-06-13', reference_no: '', counterparty_name: 'Gamma', description: 'no-ref row', credit: 7000, debit: 0 };
const noRefA2 = { date: '2083-06-13', reference_no: '', counterparty_name: 'Gamma', description: 'no-ref row', credit: 7000, debit: 0 }; // identical twin
const before = db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get().c;
const run1 = bank.importBankRows(db, [stmt1, stmt2, noRefA, noRefA2]);
check('first import inserts all 4 rows (incl. identical no-ref twins)', run1.inserted === 4, run1);
const after1 = db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get().c;
check('row count grew by 4', after1 - before === 4, { before, after1 });
const run2 = bank.importBankRows(db, [stmt1, stmt2, noRefA, noRefA2]);
check('re-import inserts 0 rows', run2.inserted === 0, run2);
check('re-import reports 4 skipped duplicates', run2.skipped_dup === 4, run2);
const after2 = db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get().c;
check('row count unchanged after re-import', after2 === after1, { after1, after2 });

// ── 3. Manual save guards ───────────────────────────────────────────────────
console.log('\n3) manual save: ref conflict + double-submit');
const m1 = bank.saveBankTransaction(db, {
    date: '2083-06-14', reference_no: 'MAN-001', counterparty_name: 'Manual Party',
    description: 'manual entry', credit: 0, debit: 9000
}, userId);
check('first manual save succeeds', m1.success === true, m1);
const m2 = bank.saveBankTransaction(db, {
    date: '2083-06-14', reference_no: 'MAN-001', counterparty_name: 'Manual Party',
    description: 'manual entry', credit: 0, debit: 9000
}, userId);
check('same reference rejected as duplicate', m2.success === false && !!m2.duplicate_of, m2);
const cntBefore = db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get().c;
const d1 = bank.saveBankTransaction(db, {
    date: '2083-06-15', reference_no: '', counterparty_name: 'NoRef Co',
    description: 'double click', credit: 0, debit: 1234
}, userId);
const d2 = bank.saveBankTransaction(db, {
    date: '2083-06-15', reference_no: '', counterparty_name: 'NoRef Co',
    description: 'double click', credit: 0, debit: 1234
}, userId);
check('double-submit returns duplicate:true with same id', d1.success && d2.success && d2.duplicate === true && d2.data.id === d1.data.id, { d1: d1.success, d2 });
check('no extra row from double-submit', db.prepare('SELECT COUNT(*) AS c FROM bank_transactions').get().c === cntBefore + 1);

// ── 4. deposit_no sequencing ────────────────────────────────────────────────
console.log('\n4) deposit_no MAX sequencing');
const dep1 = cashDeposit.saveCashDeposit(db, { date: '2083-06-16', bank_name: 'Test Bank', amount: 5000 }, userId);
const dep2 = cashDeposit.saveCashDeposit(db, { date: '2083-06-16', bank_name: 'Test Bank', amount: 6000 }, userId);
check('first two deposits numbered 001/002', /-001$/.test(dep1.deposit_no) && /-002$/.test(dep2.deposit_no), { dep1: dep1.deposit_no, dep2: dep2.deposit_no });
cashDeposit.deleteCashDeposit(db, dep1.id, userId); // remove the FIRST (count becomes 1 — old COUNT(*) bug reissued 002)
const dep3 = cashDeposit.saveCashDeposit(db, { date: '2083-06-16', bank_name: 'Test Bank', amount: 7000 }, userId);
check('after deleting 001 the next number is 003 (no collision)', /-003$/.test(dep3.deposit_no), dep3.deposit_no);
const dupDep = cashDeposit.saveCashDeposit(db, { date: '2083-06-16', bank_name: 'Test Bank', amount: 7000 }, userId);
check('double-submit deposit returns duplicate_skipped', dupDep.action === 'duplicate_skipped' && dupDep.id === dep3.id, dupDep);
check('deposit row count not grown by double-submit', db.prepare("SELECT COUNT(*) AS c FROM cash_deposits WHERE date='2083-06-16'").get().c === 2);

// ── 5. Date defaults ────────────────────────────────────────────────────────
console.log('\n5) shared BS today helper + report bound defaults');
const now = new Date();
const adLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
check('todayBSDate matches local-time adToBS', todayBSDate() === adToBS(adLocal), { todayBSDate: todayBSDate(), expected: adToBS(adLocal) });
check('todayBSDate is a BS-shaped date', /^20\d\d-\d\d-\d\d$/.test(todayBSDate()), todayBSDate());

// A ledger row dated TODAY must be visible to an unbounded daybook/P&L-style query.
const custId = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Date Test Customer', 'customer')").run().lastInsertRowid);
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance)
            VALUES (?, ?, 'payment_received', 'today receipt', 0, 15000, 0)`).run(custId, todayBSDate());
const daybook = require(path.join(ROOT, 'shared', 'operations', 'reports.js')).getDaybook(db);
check('getDaybook() default bounds are BS today (was UTC AD → excluded every row)', daybook.from_date === todayBSDate() && daybook.to_date === todayBSDate(), { from: daybook.from_date, to: daybook.to_date, expected: todayBSDate() });
const withBal = require(path.join(ROOT, 'shared', 'operations', 'statements.js')).listPartiesWithBalance(db, {});
const custBal = (withBal || []).find(p => p.id === custId);
check('listPartiesWithBalance default as_of (BS today) includes the row', !!custBal && Number(custBal.balance || 0) !== 0, custBal && custBal.balance);
const sum0 = cashDeposit.getCashDepositSummary(db, {});
check('unbounded getCashDepositSummary totals all deposits (was AD-bounded → 0)', Number(sum0.total_deposited) > 0, sum0.total_deposited);
const pl = require(path.join(ROOT, 'shared', 'operations', 'financial_reports.js')).getProfitLoss(db, {});
check('getProfitLoss() default range is BS fiscal-year-to-date with expenses', pl && typeof pl.from_date === 'string' && pl.from_date.startsWith(todayBSDate().slice(0, 4)) && typeof pl.expenses === 'object', pl && { from: pl.from_date, to: pl.to_date });

// ── 6. Classify-on-read healing ─────────────────────────────────────────────
console.log('\n6) classify-on-read healing of legacy empty-class rows');
db.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount, match_status, accounting_class)
            VALUES ('2083-06-17', 'CDM-9001', '', 'CASH DEPOSIT MACHINE', 0, 100000, 100000, 'review', '')`).run();
db.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount, match_status, accounting_class)
            VALUES ('2083-06-17', 'RCT-9002', 'Neelam Store', 'invoice settlement', 0, 4400, 4400, 'review', '')`).run();
const healedList = bank.listBankTransactions(db, {});
const healedDeposit = healedList.find(r => r.reference_no === 'CDM-9001');
const healedReceipt = healedList.find(r => r.reference_no === 'RCT-9002');
check('deposit-text legacy row healed to cash_to_bank_transfer', healedDeposit && healedDeposit.accounting_class === 'cash_to_bank_transfer', healedDeposit && healedDeposit.accounting_class);
check('healed deposit row is auto + ledger_posted (out of review queue)', healedDeposit && healedDeposit.match_status === 'auto' && healedDeposit.ledger_posted === 1, healedDeposit && { ms: healedDeposit.match_status, lp: healedDeposit.ledger_posted });
check('plain receipt legacy row healed to customer_receipt', healedReceipt && healedReceipt.accounting_class === 'customer_receipt', healedReceipt && healedReceipt.accounting_class);
const queue = bank.getBankReviewQueue(db);
check('healed deposit row excluded from review queue', !queue.some(r => r.reference_no === 'CDM-9001'));
check('receipt row stays in review queue for matching', queue.some(r => r.reference_no === 'RCT-9002'));

// ── 7. Manual classification (persisted + audited) ──────────────────────────
console.log('\n7) setBankAccountingClass manual override');
const rcId = healedReceipt.id;
const cls1 = bank.setBankAccountingClass(db, rcId, 'expense', userId);
check('classify to expense succeeds', cls1.success === true, cls1);
check('class persisted + non-party treatment applied', cls1.data.accounting_class === 'expense' && cls1.data.match_status === 'auto' && cls1.data.ledger_posted === 1, cls1.data);
const auditRow = db.prepare("SELECT * FROM audit_log WHERE table_name = 'bank_transactions' AND record_id = ? ORDER BY id DESC LIMIT 1").get(rcId);
check('audit log entry written with user', !!auditRow && auditRow.changed_by === userId, auditRow && auditRow.changed_by);
const cls2 = bank.setBankAccountingClass(db, rcId, 'customer_receipt', userId);
check('flip back to receipt re-opens matching', cls2.success === true && cls2.data.match_status === 'review' && cls2.data.ledger_posted === 0, cls2.data);
const clsBad = bank.setBankAccountingClass(db, rcId, 'banana', userId);
check('unknown class rejected', clsBad.success === false, clsBad);

// ── 8. Cash Deposit summary: statement rows + reconciliation ────────────────
console.log('\n8) cash deposit: statement transfers surfaced + reconciliation');
// Register deposit WITH a reference that the statement row mirrors (must be counted once)
const reg = cashDeposit.saveCashDeposit(db, { date: '2083-06-18', bank_name: 'Mirror Bank', amount: 20000, reference_no: 'MIR-1' }, userId);
// Statement-only deposit (no register row → must surface)
bank.importBankRows(db, [
    { date: '2083-06-18', reference_no: 'MIR-1', counterparty_name: '', description: 'CASH DEPOSIT (register mirror)', credit: 20000, debit: 0 },
    { date: '2083-06-18', reference_no: 'CDM-ONLY-1', counterparty_name: '', description: 'Cash Deposit Machine', credit: 80000, debit: 0 }
]);
const summary = cashDeposit.getCashDepositSummary(db, { from_date: '2000-01-01', to_date: '2999-12-31' });
check('summary carries bank_transfers block', summary.bank_transfers && Array.isArray(summary.bank_transfers.rows), summary.bank_transfers && summary.bank_transfers.rows.length);
check('register-mirrored statement row NOT double-surfaced', !summary.bank_transfers.rows.some(r => r.reference_no === 'MIR-1'), summary.bank_transfers.rows.map(r => r.reference_no));
check('statement-only deposit IS surfaced', summary.bank_transfers.rows.some(r => r.reference_no === 'CDM-ONLY-1'), summary.bank_transfers.rows.map(r => r.reference_no));
const pos = accounting.getCashBankPosition(db, { from_date: '2000-01-01', to_date: '2999-12-31' });
check('position exposes unmatched_transfer_rows (same single source)', Array.isArray(pos.unmatched_transfer_rows) && pos.unmatched_transfer_rows.some(r => r.reference_no === 'CDM-ONLY-1'), pos.unmatched_transfer_rows && pos.unmatched_transfer_rows.map(r => r.reference_no));
db.prepare("INSERT INTO denomination_counts (date, total_cash) VALUES (?, 99999)").run(todayBSDate());
const summary2 = cashDeposit.getCashDepositSummary(db, { from_date: '2000-01-01', to_date: '2999-12-31' });
const recon = summary2.reconciliation;
check('reconciliation block present with spec fields', !!recon && ['cash_sales', 'cash_payments', 'cash_expenses', 'cash_deposited', 'expected_closing', 'actual_cash', 'difference'].every(k => k in recon), recon && Object.keys(recon));
check('actual_cash = latest denomination count', recon && Number(recon.actual_cash) === 99999, recon && recon.actual_cash);
check('difference = expected_closing − actual_cash', recon && recon.difference !== null && near(recon.difference, Number(recon.expected_closing) - 99999), recon && { e: recon.expected_closing, d: recon.difference });

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
db.close();
process.exit(failed > 0 ? 1 : 0);
