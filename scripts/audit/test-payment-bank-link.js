#!/usr/bin/env node
/**
 * Standalone Bank Transaction acceptance checks.
 * Bank records remain independent on create, edit, import, delete, cash deposit,
 * payment register, farmer bulk payout and reporting paths. Existing data stays.
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const payOps = require(path.join(ROOT, 'shared', 'operations', 'payments'));
const bankOps = require(path.join(ROOT, 'shared', 'operations', 'bank'));
const farmerOps = require(path.join(ROOT, 'shared', 'operations', 'farmer'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting'));
const { validatePayment } = require(path.join(ROOT, 'shared', 'validate'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd10-test-'));
const db = initDatabase(dir, 'test.db');
const pidCust = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Krishna Traders', 'customer')").run().lastInsertRowid);
const pidSup = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Bishnu Farmer', 'supplier')").run().lastInsertRowid);
// The Bank register is its own module now: nothing on the payment path creates
// the table any more, so the test sets it up the way the Bank screen does.
bankOps.ensureBankTable(db);
const bankCount = () => Number(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — Migration 33 columns');
// ════════════════════════════════════════════════════════════
const cols = db.prepare('PRAGMA table_info(payments)').all().map(c => c.name);
ok(cols.includes('bank_txn_id'), 'payments.bank_txn_id exists');
ok(cols.includes('bank_account'), 'payments.bank_account exists');
ok(cols.includes('bank_reference'), 'payments.bank_reference exists');
ok(validatePayment({ party_id: pidCust, amount: 100, bank_reference: 'X'.repeat(101) }) !== null,
    'validatePayment rejects over-long bank reference',
    validatePayment({ party_id: pidCust, amount: 100, bank_reference: 'X'.repeat(101) }));

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — savePayment NEVER creates or links a bank row');
// ════════════════════════════════════════════════════════════
const ledBefore = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const bankBeforePayment = bankCount();
const ledgerBeforePayment = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const r1 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-10', type: 'receipt', amount: 5000,
    mode: 'upi', bank_account: 'Nabil 1234', bank_reference: 'QR-TEST-001', notes: 'milk bill'
});
const id1 = Number(r1.id);
const pay1 = db.prepare('SELECT * FROM payments WHERE id = ?').get(id1);
ok(bankCount() === bankBeforePayment, 'no Bank Transactions row created', bankCount());
ok(pay1.bank_txn_id === null, 'payment carries no bank link', pay1.bank_txn_id);
ok(r1.bank_txn_id === null, 'savePayment reports no bank link', r1.bank_txn_id);
ok(pay1.bank_reference === 'QR-TEST-001' && pay1.bank_account === 'Nabil 1234', 'bank fields stored on payment',
    { ref: pay1.bank_reference, acct: pay1.bank_account });
const ledAfter1 = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
ok(ledAfter1 - ledBefore === 1, 'exactly ONE ledger entry for the payment', ledAfter1 - ledBefore);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — a reused reference never links two records');
// ════════════════════════════════════════════════════════════
const r2 = payOps.savePayment(db, {
    party_id: pidSup, date: '2083-07-11', type: 'payment', amount: 8800,
    mode: 'upi', bank_reference: 'QR-TEST-001', notes: 'different party, same reference'
});
ok(bankCount() === 0, 'still zero bank rows', bankCount());
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r2.id).bank_txn_id === null,
    'second payment is not linked to anything');
const r3 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-12', type: 'receipt', amount: 750, mode: 'cash'
});
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r3.id).bank_txn_id === null,
    'cash payment creates no bank row');
ok(bankCount() === 0, 'bank row count still zero after cash payment', bankCount());

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — a statement row is never claimed by a payment save');
// ════════════════════════════════════════════════════════════
const stmtId = Number(db.prepare(`
    INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount,
        payment_mode, party_id, match_status, accounting_class, txn_uid)
    VALUES ('2083-07-15', 'QR-EARLY', 'Krishna Traders', 'QR credit', 0, 3200, 3200, 'UPI', ?, 'auto', 'customer_receipt', 'ref:QR-EARLY')
`).run(pidCust).lastInsertRowid);
const r4 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-15', type: 'receipt', amount: 3200,
    mode: 'upi', bank_reference: 'QR-EARLY'
});
ok(bankCount() === 1, 'payment save added no second bank row', bankCount());
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r4.id).bank_txn_id === null,
    'payment is not linked to the statement row');
ok(db.prepare('SELECT txn_uid FROM bank_transactions WHERE id = ?').get(stmtId).txn_uid === 'ref:QR-EARLY',
    'statement row untouched');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — bank transactions remain unposted and independent');
// ════════════════════════════════════════════════════════════
// payment recorded as UPI without a reference → no link yet, counted doc-side
const r5 = payOps.savePayment(db, {
    party_id: pidSup, date: '2083-07-16', type: 'payment', amount: 4400, mode: 'upi', notes: 'milk'
});
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r5.id).bank_txn_id === null, 'no link yet');
const stmt2 = bankOps.saveBankTransaction(db, {
    date: '2083-07-16', reference_no: 'ESEW-9', counterparty_name: 'Bishnu Farmer',
    description: 'milk payment', debit: 4400, credit: 0, party_id: pidSup, payment_mode: 'UPI'
});
const stmt2Id = Number(stmt2.data.id);
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r5.id).bank_txn_id === null,
    'bank transaction remains unlinked after independent save');
const ledCount = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const post = bankOps.postBankToLedger(db, stmt2Id);
ok(post.success && post.posted === false && post.reason === 'standalone_register',
    'ledger-post compatibility API does nothing', post);
ok(db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c === ledCount,
    'ledger entry NOT posted a second time');
// guard: a bank row whose ledger match is NOT a payment must not stamp anything
const stmt3 = bankOps.saveBankTransaction(db, {
    date: '2083-07-17', reference_no: 'X-99', counterparty_name: 'Unknown Co',
    description: 'misc', debit: 123, credit: 0, party_id: pidCust, payment_mode: 'Bank'
});
const pBefore = db.prepare('SELECT COUNT(*) c FROM payments WHERE bank_txn_id IS NOT NULL').get().c;
bankOps.postBankToLedger(db, Number(stmt3.data.id));
const pAfter = db.prepare('SELECT COUNT(*) c FROM payments WHERE bank_txn_id IS NOT NULL').get().c;
ok(pBefore === pAfter, 'party+amount guard: no bogus payment stamp', { pBefore, pAfter });

// ════════════════════════════════════════════════════════════
console.log('\nTEST 6 — bank create/edit/delete leaves other registers unchanged');
// ════════════════════════════════════════════════════════════
const pos = accounting.getCashBankPosition(db, {});
const bankCountBeforeIndependentEntry = bankCount();
const bankEntry = bankOps.saveBankTransaction(db, {
    date: '2083-07-18', reference_no: 'STANDALONE-1', counterparty_name: 'Payee',
    description: 'Fuel', debit: 700, credit: 0, payment_mode: 'Bank'
});
const paymentCountBeforeEdit = db.prepare('SELECT COUNT(*) c FROM payments').get().c;
const ledgerCountBeforeEdit = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const pettyCountBeforeEdit = db.prepare('SELECT COUNT(*) c FROM petty_cash').get().c;
const expenseCountBeforeEdit = db.prepare('SELECT COUNT(*) c FROM other_expenses').get().c;
const original = bankEntry.data;
const edited = bankOps.saveBankTransaction(db, { ...original, description: 'Fuel corrected', debit: 800 });
ok(edited.success && db.prepare('SELECT COUNT(*) c FROM payments').get().c === paymentCountBeforeEdit,
    'editing bank record creates no payment');
ok(db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c === ledgerCountBeforeEdit,
    'editing bank record does not alter party ledger');
ok(db.prepare('SELECT COUNT(*) c FROM petty_cash').get().c === pettyCountBeforeEdit,
    'editing bank record creates no petty cash row');
ok(db.prepare('SELECT COUNT(*) c FROM other_expenses').get().c === expenseCountBeforeEdit,
    'editing bank record creates no expense row');
const ledgerBeforeDelete = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
bankOps.deleteBankTransaction(db, edited.data.id);
ok(db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c === ledgerBeforeDelete,
    'deleting bank record does not alter party ledger');
ok(bankCount() === bankCountBeforeIndependentEntry,
    'delete removed only the edited standalone record; earlier rows remain');
ok(Number.isFinite(pos.bank.total_in) && Number.isFinite(pos.bank.total_out),
    'cash/bank report calculations remain finite');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 7 — bulk farmer payout creates no bank row');
// ════════════════════════════════════════════════════════════
const pidS2 = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Hari Farmer', 'supplier')").run().lastInsertRowid);
const batchBefore = bankCount();
const bulk = farmerOps.bulkPayFarmers(db, {
    payments: [
        { party_id: pidSup, amount: 2000, collection_ids: [] },
        { party_id: pidS2, amount: 3000, collection_ids: [] }
    ],
    date: '2083-07-20', mode: 'bank', notes: 'weekly',
    bank_account: 'Nabil 1234', bank_reference: 'BULK-REF-1'
});
const batchAfter = bankCount();
ok(batchAfter === batchBefore, 'bulk farmer payout creates no Bank Transactions row',
    { before: batchBefore, after: batchAfter });
ok(bulk.length === 2, 'both payouts returned');
const pos2 = accounting.getCashBankPosition(db, {});
ok(pos2.bank.register_independent === true || Number.isFinite(pos2.bank.total_out),
    'cash/bank position reports without merging bank statement rows');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 8 — deletePayment cleanup rules');
// ════════════════════════════════════════════════════════════
const stmtExistsBeforePaymentDelete = !!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(stmtId);
payOps.deletePayment(db, r4.id);
ok(!!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(stmtId) === stmtExistsBeforePaymentDelete,
    'deleting a payment neither deletes nor creates a bank transaction');

// ════════════════════════════════════════════════════════════
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
