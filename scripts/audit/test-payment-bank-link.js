#!/usr/bin/env node
/**
 * D10 — PAYMENT ↔ BANK ↔ LEDGER: ONE TRANSACTION ID (req 6/7/30/31)
 * ==================================================================
 *  1. Migration 33 — payments.bank_txn_id / bank_account / bank_reference
 *  2. savePayment with a bank reference creates EXACTLY ONE linked
 *     bank_transactions row (txn_uid='pay:<id>'), linked both ways,
 *     ledger posted ONCE (by the payment, never again by the bank row)
 *  3. Same reference twice → no second bank row (import sees it, skips)
 *  4. Statement row imported FIRST → payment links to it, no new row
 *  5. postBankToLedger stamps payments.bank_txn_id back when the bank row
 *     matches an existing payment ledger entry (with party+amount guard)
 *  6. Cash/bank position counts the money ONCE (doc side OR bank side)
 *  7. Bulk farmer payout with a bank reference → ONE bank row for the batch
 *  8. deletePayment removes OUR bank row only when no payment references it;
 *     a statement-imported row survives
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
console.log('\nTEST 2 — savePayment + bank reference creates ONE linked row');
// ════════════════════════════════════════════════════════════
const ledBefore = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
const r1 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-10', type: 'receipt', amount: 5000,
    mode: 'upi', bank_account: 'Nabil 1234', bank_reference: 'QR-TEST-001', notes: 'milk bill'
});
const id1 = Number(r1.id);
const pay1 = db.prepare('SELECT * FROM payments WHERE id = ?').get(id1);
ok(!!pay1.bank_txn_id, 'payment carries bank_txn_id', pay1);
ok(pay1.bank_reference === 'QR-TEST-001' && pay1.bank_account === 'Nabil 1234', 'bank fields stored on payment',
    { ref: pay1.bank_reference, acct: pay1.bank_account });
const b1 = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(pay1.bank_txn_id);
ok(!!b1, 'linked bank row exists');
ok(b1.txn_uid === `pay:${id1}`, 'bank row txn_uid is pay:<id>', b1.txn_uid);
ok(b1.reference_no === 'QR-TEST-001', 'bank row carries the reference');
ok(Math.abs(b1.credit - 5000) < 0.005 && b1.debit === 0, 'receipt → credit on the bank row', { d: b1.debit, c: b1.credit });
ok(b1.party_id === pidCust, 'bank row carries the party');
ok(b1.accounting_class === 'customer_receipt', 'explicit class (never expense/transfer)', b1.accounting_class);
ok(b1.ledger_posted === 1 && b1.ledger_entry_id === null, 'bank row does NOT claim a ledger entry',
    { posted: b1.ledger_posted, entry: b1.ledger_entry_id });
const ledAfter1 = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get().c;
ok(ledAfter1 - ledBefore === 1, 'exactly ONE ledger entry for the payment', ledAfter1 - ledBefore);
ok(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c === 1, 'exactly ONE bank row so far');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — same reference again → no duplicate bank row');
// ════════════════════════════════════════════════════════════
const r2 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-11', type: 'receipt', amount: 5000,
    mode: 'upi', bank_reference: 'QR-TEST-001', notes: 'retry'
});
ok(Number(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c) === 1,
    'still one bank row (reference reused → linked, not duplicated)');
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r2.id).bank_txn_id === b1.id,
    'second payment links to the same statement row');

// cash payment with no bank fields → no bank row at all
const r3 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-12', type: 'receipt', amount: 750, mode: 'cash'
});
ok(!db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r3.id).bank_txn_id,
    'cash payment creates no bank row');
ok(Number(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c) === 1,
    'bank row count unchanged after cash payment');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — statement imported FIRST → payment links to the existing row');
// ════════════════════════════════════════════════════════════
const insStmt = db.prepare(`
    INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount,
        payment_mode, party_id, match_status, accounting_class, txn_uid)
    VALUES ('2083-07-15', 'QR-EARLY', 'Krishna Traders', 'QR credit', 0, 3200, 3200, 'UPI', ?, 'auto', 'customer_receipt', 'ref:QR-EARLY')
`);
const stmtId = Number(insStmt.run(pidCust).lastInsertRowid);
const r4 = payOps.savePayment(db, {
    party_id: pidCust, date: '2083-07-15', type: 'receipt', amount: 3200,
    mode: 'upi', bank_reference: 'QR-EARLY'
});
ok(db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c === 2,
    'no new bank row when the statement row already exists');
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r4.id).bank_txn_id === stmtId,
    'payment linked to the pre-imported statement row');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — bank import matching an existing payment stamps the link back');
// ════════════════════════════════════════════════════════════
// payment recorded as UPI but without a reference → no link yet, counted doc-side
const r5 = payOps.savePayment(db, {
    party_id: pidSup, date: '2083-07-16', type: 'payment', amount: 4400, mode: 'upi', notes: 'milk'
});
ok(!db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r5.id).bank_txn_id, 'no link yet');
// now the statement arrives for the same money
const stmt2 = bankOps.saveBankTransaction(db, {
    date: '2083-07-16', reference_no: 'ESEW-9', counterparty_name: 'Bishnu Farmer',
    description: 'milk payment', debit: 4400, credit: 0, party_id: pidSup, payment_mode: 'UPI'
});
const stmt2Id = Number(stmt2.data.id);
ok(db.prepare('SELECT bank_txn_id FROM payments WHERE id = ?').get(r5.id).bank_txn_id === stmt2Id,
    'payments.bank_txn_id stamped back by the import');
// re-running post must be a no-op: no second ledger entry, no stamp churn
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
const bankTotalIn = pos.bank.total_in;
// Independent count: every bank row once + doc-side non-cash payments with NO linked row
const stmtIn = db.prepare(`SELECT COALESCE(SUM(credit),0) s FROM bank_transactions WHERE accounting_class = 'customer_receipt'`).get().s;
const unlinkedDoc = db.prepare(`
    SELECT COALESCE(SUM(amount),0) s FROM payments
     WHERE type = 'receipt' AND LOWER(COALESCE(mode,'cash')) IN ('bank','upi','cheque')
       AND (bank_txn_id IS NULL OR bank_txn_id NOT IN (SELECT id FROM bank_transactions))
`).get().s;
ok(Math.abs(bankTotalIn - (stmtIn + unlinkedDoc + pos.bank.cash_deposits_in)) < 0.01,
    'bank in = statement rows + unlinked docs + deposits (no double count)',
    { bankTotalIn, stmtIn, unlinkedDoc, deposits: pos.bank.cash_deposits_in });
// The linked QR-TEST-001 payment (5000) must appear exactly once
const bothSides = db.prepare(`
    SELECT COUNT(*) c FROM payments p JOIN bank_transactions b ON b.id = p.bank_txn_id
     WHERE LOWER(COALESCE(p.mode,'cash')) IN ('bank','upi','cheque')
`).get().c;
ok(bothSides >= 4, 'linked non-cash payments join to their bank rows', bothSides);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 7 — bulk farmer payout: ONE bank row for the batch');
// ════════════════════════════════════════════════════════════
const pidS2 = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Hari Farmer', 'supplier')").run().lastInsertRowid);
const batchBefore = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
const bulk = farmerOps.bulkPayFarmers(db, {
    payments: [
        { party_id: pidSup, amount: 2000, collection_ids: [] },
        { party_id: pidS2, amount: 3000, collection_ids: [] }
    ],
    date: '2083-07-20', mode: 'bank', notes: 'weekly',
    bank_account: 'Nabil 1234', bank_reference: 'BULK-REF-1'
});
const batchAfter = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
ok(batchAfter - batchBefore === 1, 'exactly ONE bank row for a 2-payment batch',
    { before: batchBefore, after: batchAfter });
const batchRow = db.prepare("SELECT * FROM bank_transactions WHERE reference_no = 'BULK-REF-1'").get();
ok(batchRow && Math.abs(batchRow.debit - 5000) < 0.005, 'batch bank row covers the batch total', batchRow && batchRow.debit);
const linkedBatch = db.prepare('SELECT COUNT(*) c FROM payments WHERE bank_txn_id = ?').get(batchRow.id).c;
ok(linkedBatch === 2, 'both batch payments point at the same bank row', linkedBatch);
ok(bulk.length === 2, 'both payouts returned');

// position: batch total counted once (bank row), not twice (payments)
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
// deleting ONE of the two batch payments keeps the shared row (the other still uses it)
const batchPayIds = db.prepare('SELECT id FROM payments WHERE bank_txn_id = ?').all(batchRow.id).map(r => r.id);
payOps.deletePayment(db, batchPayIds[0]);
ok(!!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(batchRow.id),
    'shared batch bank row survives while another payment still references it');
payOps.deletePayment(db, batchPayIds[1]);
ok(!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(batchRow.id),
    'our bank row deleted with the last payment that referenced it');
// a statement-imported row must survive its payment
const pay4 = db.prepare('SELECT * FROM payments WHERE id = ?').get(r4.id);
payOps.deletePayment(db, r4.id);
ok(!!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(stmtId),
    'statement-imported bank row survives payment deletion (bank data preserved)');
// a payment we created (pay: uid) with no other claimant is removed
const pay1row = db.prepare('SELECT * FROM payments WHERE id = ?').get(id1);
if (pay1row && pay1row.bank_txn_id) {
    // TEST 3 linked r2 to the SAME row — clear that claim first
    const alsoClaiming = db.prepare('SELECT id FROM payments WHERE bank_txn_id = ? AND id != ?').all(pay1row.bank_txn_id, id1);
    for (const c of alsoClaiming) payOps.deletePayment(db, c.id);
    payOps.deletePayment(db, id1);
    ok(!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(pay1row.bank_txn_id),
        'our own bank row removed with the last payment that referenced it');
} else {
    ok(false, 'payment 1 still linked before delete', pay1row);
}

// ════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
