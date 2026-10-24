#!/usr/bin/env node
/**
 * PAYMENT IS A STANDALONE REGISTER (operator rule, 2026-10)
 * =========================================================
 * Recording a payment must never create or link a Bank Transactions row.
 * The bank statement is its own register (BANK RECON / the Bank screen).
 *
 *  1. Migration 33 — payments.bank_txn_id / bank_account / bank_reference
 *  2. savePayment with a bank mode + reference → ZERO bank rows, no link,
 *     bank fields still stored on the payment, ledger posted ONCE
 *  3. A reused reference never links two unrelated records
 *  4. A statement row imported first is never claimed by a later payment
 *  5. The bank import may still stamp the link back when it recognises the
 *     payment's own ledger entry (explicit import-side reconciliation), and
 *     re-posting stays a no-op
 *  6. Cash/bank position counts the money ONCE
 *  7. Bulk farmer payout (an explicit batch action, not savePayment) still
 *     writes ONE bank row for the whole batch
 *  8. deletePayment removes only OUR bulk row, never a statement row
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
const r1 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-10', type: 'receipt', amount: 5000,
    mode: 'upi', bank_account: 'Nabil 1234', bank_reference: 'QR-TEST-001', notes: 'milk bill'
});
const id1 = Number(r1.id);
const pay1 = db.prepare('SELECT * FROM payments WHERE id = ?').get(id1);
ok(bankCount() === 0, 'no Bank Transactions row created', bankCount());
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
console.log('\nTEST 5 — bank import may stamp the link back (explicit reconciliation)');
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
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r5.id).bank_txn_id === stmt2Id,
    'the IMPORT (not the payment save) stamped the link');
const ledCount = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const post = bankOps.postBankToLedger(db, stmt2Id);
ok(post.success && post.posted === false &&
    (post.reason === 'already_in_ledger' || post.reason === 'already_posted'),
    're-post is a no-op', post);
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
console.log('\nTEST 6 — cash/bank position counts linked money ONCE');
// ════════════════════════════════════════════════════════════
const pos = accounting.getCashBankPosition(db, {});
const stmtIn = db.prepare(`SELECT COALESCE(SUM(credit),0) s FROM bank_transactions WHERE accounting_class = 'customer_receipt'`).get().s;
const unlinkedDoc = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM payments
     WHERE type = 'receipt' AND LOWER(COALESCE(mode,'cash')) IN ('bank','upi','cheque')
       AND (bank_txn_id IS NULL OR bank_txn_id NOT IN (SELECT id FROM bank_transactions))
`).get().s;
ok(Math.abs(pos.bank.total_in - (stmtIn + unlinkedDoc + pos.bank.cash_deposits_in)) < 0.01,
    'bank in = statement rows + unlinked docs + deposits (no double count)',
    { total_in: pos.bank.total_in, stmtIn, unlinkedDoc, deposits: pos.bank.cash_deposits_in });
const linkedReceipt = db.prepare(`
    SELECT COALESCE(SUM(p.amount),0) s FROM payments p
      JOIN bank_transactions b ON b.id = p.bank_txn_id
     WHERE p.type = 'receipt' AND LOWER(COALESCE(p.mode,'cash')) IN ('bank','upi','cheque')
`).get().s;
ok(Math.abs(linkedReceipt - 8800) < 0.01 || linkedReceipt === 0,
    'no payment is double counted through a link', linkedReceipt);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 7 — bulk farmer payout: ONE bank row for the batch');
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
ok(batchAfter - batchBefore === 1, 'exactly ONE bank row for a 2-payment batch',
    { before: batchBefore, after: batchAfter });
const batchRow = db.prepare("SELECT * FROM bank_transactions WHERE reference_no = 'BULK-REF-1'").get();
ok(batchRow && Math.abs(batchRow.debit - 5000) < 0.005, 'batch bank row covers the batch total', batchRow && batchRow.debit);
const linkedBatch = db.prepare('SELECT COUNT(*) c FROM payments WHERE bank_txn_id = ?').get(batchRow.id).c;
ok(linkedBatch === 2, 'both batch payments point at the same bank row', linkedBatch);
ok(bulk.length === 2, 'both payouts returned');
const pos2 = accounting.getCashBankPosition(db, {});
const docBatch = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM payments
     WHERE LOWER(COALESCE(mode,'cash')) IN ('bank','upi','cheque') AND type IN ('payment','advance')
       AND (bank_txn_id IS NULL OR bank_txn_id NOT IN (SELECT id FROM bank_transactions))
`).get().s;
const bankPaymentsSide = db.prepare(`
    SELECT COALESCE(SUM(debit),0) s FROM bank_transactions
     WHERE accounting_class IN ('supplier_payment','unclassified')
`).get().s;
ok(Math.abs(pos2.bank.total_out - (bankPaymentsSide + docBatch + pos2.bank.transfers_out + pos2.bank.expenses_paid)) < 0.01,
    'bank out = statement payments + unlinked docs + transfers + expenses (batch counted once)',
    { total_out: pos2.bank.total_out, bankPaymentsSide, docBatch });

// ════════════════════════════════════════════════════════════
console.log('\nTEST 8 — deletePayment cleanup rules');
// ════════════════════════════════════════════════════════════
const batchPayIds = db.prepare('SELECT id FROM payments WHERE bank_txn_id = ?').all(batchRow.id).map(r => r.id);
payOps.deletePayment(db, batchPayIds[0]);
ok(!!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(batchRow.id),
    'shared batch bank row survives while another payment still references it');
payOps.deletePayment(db, batchPayIds[1]);
ok(!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(batchRow.id),
    'our bank row deleted with the last payment that referenced it');
payOps.deletePayment(db, r4.id);
ok(!!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(stmtId),
    'statement-imported bank row survives payment deletion (bank data preserved)');

// ════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
