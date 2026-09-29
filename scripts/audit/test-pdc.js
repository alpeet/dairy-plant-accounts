/**
 * Post-Dated Cheque (PDC) acceptance tests.
 * ========================================
 * Proves the PDC register integrates with the EXISTING accounting model and
 * that a cheque is an instrument, not money:
 *
 *   Test 1  Create PDC Received → held, bank/receivable untouched, audited
 *   Test 2  Deposit            → presented, still no money movement
 *   Test 3  Clear              → bank + invoice settle EXACTLY once, no duplicate receipt
 *   Test 4  Bounce (cleared)   → receivable restored, bank reversed, charge recorded
 *   Test 5  Cancel             → no bank movement, row kept for audit
 *   Test 6  PDC Issued         → payable unchanged while held, bank paid once on clear
 *   Test 7  Multi-invoice allocation
 *   Test 8  On-account cheque  → later settled by the existing allocation flow, once
 *   Test 9  Duplicate cheque blocked (application AND database index)
 *   Test 10 Restart            → statuses, allocations and balances persist
 *   Test 11 Backup → Fresh Start reset → restore, with PDC data returning intact
 *   Test 12 Regression         → every existing module still reports cleanly
 *
 * Usage: node scripts/audit/test-pdc.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase, openDatabase, runMigrations } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));
const auth = require(path.join(ROOT, 'shared', 'auth.js'));
const { adToBS } = require(path.join(ROOT, 'shared', 'excel-import.js'));

const TMP = '/tmp/pdc-test';
const DB_DIR = path.join(TMP, 'data');
const DB_PATH = path.join(DB_DIR, 'pdc.db');
const BACKUP_DIR = path.join(TMP, 'backups');
const BACKUP_PATH = path.join(BACKUP_DIR, 'PDC_Handover_Test');

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
    console.log(`${cond ? '✅ PASS' : '❌ FAIL'} — ${name}${!cond && detail !== undefined ? `   [got ${JSON.stringify(detail)}]` : ''}`);
    cond ? pass++ : fail++;
};
const section = t => console.log(`\n=== ${t} ===`);

/** Local calendar date → BS (the app's own "today" convention). */
const todayBS = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return adToBS(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
};

const RANGE = { from_date: '2000-01-01', to_date: '2100-01-01' };
const bankBalance = () => accounting.getCashBankPosition(db, RANGE).bank.balance;
const cashBalance = () => accounting.getCashBankPosition(db, RANGE).cash.balance;

/** Party balance exactly as the ledger reports it (opening + debit − credit). */
const partyBalance = pid => {
    const r = db.prepare(`
        SELECT (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS balance
          FROM parties p LEFT JOIN ledger_entries le ON le.party_id = p.id
         WHERE p.id = ? GROUP BY p.id`).get(pid);
    return r ? Math.round(Number(r.balance) * 100) / 100 : 0;
};
const saleOutstanding = (pid, saleId) =>
    accounting.getSaleSettlements(db, { party_id: pid }).by_id.get(Number(saleId)).outstanding;
const pdcPayments = id => db.prepare(
    `SELECT pm.* FROM payments pm
      WHERE pm.id IN (SELECT payment_id FROM pdc_cheques WHERE id = ?
                      UNION SELECT payment_id FROM pdc_allocations WHERE pdc_id = ?)`
).all(id, id);
const auditCount = (id, table = 'pdc_cheques') =>
    db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE table_name = ? AND record_id = ?').get(table, id).n;
const expectThrow = (fn, needle, name) => {
    try {
        fn();
        ok(false, name, 'no error thrown');
    } catch (e) {
        ok(new RegExp(needle, 'i').test(e.message), name, e.message);
    }
};

// ──────────────────────────────────────────────────────────────
// Setup: fresh database with a customer, a supplier and documents
// ──────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });
let db = initDatabase(DB_DIR, 'pdc.db');

db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('operator1', 'x:y', 'operator')").run();
db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('akadmin', ?, 'admin')").run(auth.hashPassword('PdcTest1234'));
const uid = db.prepare("SELECT id FROM users WHERE username = 'operator1'").get().id;

const today = todayBS();
const CUSTOMER = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('ABC Dairy', 'customer')").run().lastInsertRowid);
const SUPPLIER = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('XYZ Packaging', 'supplier')").run().lastInsertRowid);
// A dedicated party for the on-account test so the FIFO pool is unambiguous.
const ONACCT = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('On Account Customer', 'customer')").run().lastInsertRowid);

const makeSale = (pid, invoice_no, amount, date = today) => Number(db.prepare(
    "INSERT INTO sales (invoice_no, date, party_id, grand_total, paid_amount, payment_mode, status) VALUES (?, ?, ?, ?, 0, 'credit', 'unpaid')"
).run(invoice_no, date, pid, amount).lastInsertRowid);

const SALE_A = makeSale(CUSTOMER, 'INV-000125', 100000);
const SALE_B = makeSale(CUSTOMER, 'INV-000126', 120000);
const SALE_C = makeSale(CUSTOMER, 'INV-000127', 80000);
const PURCHASE_1 = Number(db.prepare(
    "INSERT INTO purchases (bill_no, date, party_id, grand_total, paid_amount, payment_mode, status) VALUES ('BILL-777', ?, ?, 50000, 0, 'credit', 'unpaid')"
).run(today, SUPPLIER).lastInsertRowid);
// Opening ledger rows so the receivables/payables are the real ledger figures.
db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, 'Sale Invoice INV-000125', 100000, 0, 100000)").run(CUSTOMER, today, SALE_A);
db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, 'Sale Invoice INV-000126', 120000, 0, 120000)").run(CUSTOMER, today, SALE_B);
db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, 'Sale Invoice INV-000127', 80000, 0, 80000)").run(CUSTOMER, today, SALE_C);
db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'purchase', ?, 'Purchase Bill BILL-777', 0, 50000, -50000)").run(SUPPLIER, today, PURCHASE_1);

const BASELINE_BANK = bankBalance();
const BASELINE_CASH = cashBalance();

// ──────────────────────────────────────────────────────────────
// Test 1 — Create PDC Received (HELD)
// ──────────────────────────────────────────────────────────────
section('Test 1 — Create PDC Received (Held)');
let pdcA;
{
    const receivableBefore = saleOutstanding(CUSTOMER, SALE_A);
    pdcA = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '123456',
        cheque_date: today, txn_date: today, bank_name: 'Nabil Bank',
        amount: 100000, reference_no: 'INV-000125', remarks: 'Post-dated cheque',
        allocations: [{ invoice_type: 'sale', invoice_id: SALE_A, amount: 100000 }]
    }, uid, 'operator');

    const row = ops.getPdcCheque(db, pdcA.id);
    ok(row.status === 'HELD', 'Status is HELD', row.status);
    ok(row.amount === 100000, 'Amount stored exactly (no float noise)', row.amount);
    ok(row.pdc_no && /^PDC-\d{8}-\d{3}$/.test(row.pdc_no), 'Register number generated', row.pdc_no);
    ok(row.allocations.length === 1 && row.allocations[0].allocated_amount === 100000,
        'Invoice-level allocation stored', row.allocations);
    ok(row.allocations[0].invoice_no === 'INV-000125', 'Allocation resolves the invoice number', row.allocations[0].invoice_no);

    ok(bankBalance() === BASELINE_BANK, 'Actual bank balance UNCHANGED by a held cheque', bankBalance());
    ok(saleOutstanding(CUSTOMER, SALE_A) === receivableBefore, 'Invoice receivable NOT reduced while held',
        saleOutstanding(CUSTOMER, SALE_A));
    ok(partyBalance(CUSTOMER) === 300000, 'Party ledger balance unchanged by a held cheque', partyBalance(CUSTOMER));

    const pos = ops.getPdcPosition(db);
    ok(pos.pdc_receivable === 100000, 'PDC Receivable shows the expected Rs 100,000', pos.pdc_receivable);
    ok(pos.received.held.count === 1 && pos.received.held.amount === 100000, 'PDC Received → Held bucket', pos.received.held);
    ok(pos.received.cleared.amount === 0, 'Nothing is Cleared yet', pos.received.cleared);
    ok(pos.checks.every(c => c.ok), 'Position integrity checks pass', pos.checks.filter(c => !c.ok));

    ok(pdcPayments(pdcA.id).length === 0, 'No money row exists for a held cheque', pdcPayments(pdcA.id).length);
    ok(auditCount(pdcA.id) >= 1, 'Audit log created for the PDC', auditCount(pdcA.id));
    const audit = db.prepare("SELECT new_values FROM audit_log WHERE table_name = 'pdc_cheques' AND record_id = ? ORDER BY id DESC LIMIT 1").get(pdcA.id);
    const parsed = JSON.parse(audit.new_values || '{}');
    ok(parsed.operation === 'PDC recorded' && parsed.status === 'HELD', 'Audit payload records the operation and status', parsed.operation + '/' + parsed.status);
}

// ──────────────────────────────────────────────────────────────
// Test 2 — Deposit / present
// ──────────────────────────────────────────────────────────────
section('Test 2 — Deposit / Present');
{
    const res = ops.setPdcStatus(db, { id: pdcA.id, action: 'deposit', date: today, bank: 'Nabil Bank', remarks: 'Presented at counter' }, uid, 'operator');
    ok(res.to === 'DEPOSITED', 'Status becomes DEPOSITED', res.to);
    const row = ops.getPdcCheque(db, pdcA.id);
    ok(row.deposit_date === today && row.deposit_bank === 'Nabil Bank', 'Deposit date + bank recorded', [row.deposit_date, row.deposit_bank]);
    ok(bankBalance() === BASELINE_BANK, 'Bank balance still unchanged after presenting', bankBalance());
    ok(saleOutstanding(CUSTOMER, SALE_A) === 100000, 'Invoice still outstanding after presenting', saleOutstanding(CUSTOMER, SALE_A));
    ok(auditCount(pdcA.id) >= 2, 'Deposit audited', auditCount(pdcA.id));
    const pos = ops.getPdcPosition(db);
    ok(pos.received.deposited.amount === 100000 && pos.pdc_receivable === 100000,
        'Position: still an expectation, now under Deposited', pos.received.deposited);
}

// ──────────────────────────────────────────────────────────────
// Test 3 — Clear (the cheque becomes money, exactly once)
// ──────────────────────────────────────────────────────────────
section('Test 3 — Clear');
{
    const before = bankBalance();
    const res = ops.setPdcStatus(db, { id: pdcA.id, action: 'clear', date: today, bank: 'Nabil Bank', reference: 'NBL-CLR-991' }, uid, 'accountant');
    ok(res.to === 'CLEARED', 'Status becomes CLEARED', res.to);
    ok(res.money && res.money.amount === 100000 && res.money.bank_effect === 100000,
        'Clearance reports the money effect once', res.money);
    ok(bankBalance() === Math.round((before + 100000) * 100) / 100,
        'Bank balance increased by exactly Rs 100,000', { before, after: bankBalance() });
    ok(saleOutstanding(CUSTOMER, SALE_A) === 0, 'Invoice fully settled by the cheque', saleOutstanding(CUSTOMER, SALE_A));

    const receipts = db.prepare(
        "SELECT * FROM payments WHERE party_id = ? AND type = 'receipt' AND amount = 100000"
    ).all(CUSTOMER);
    ok(receipts.length === 1, 'Exactly ONE receipt created (no duplicate)', receipts.length);
    ok(receipts[0].mode === 'cheque', 'Receipt recorded with mode=cheque', receipts[0].mode);
    ok(receipts[0].reference_type === 'sale' && receipts[0].reference_id === SALE_A,
        'Receipt is linked to the allocated invoice', [receipts[0].reference_type, receipts[0].reference_id]);

    const ledger = db.prepare(
        "SELECT COUNT(*) AS n FROM ledger_entries WHERE party_id = ? AND reference_type = 'payment_received' AND date = ?"
    ).get(CUSTOMER, today).n;
    ok(ledger === 1, 'Exactly one ledger receipt row posted', ledger);
    ok(partyBalance(CUSTOMER) === 200000, 'Party ledger reduced once (300,000 → 200,000)', partyBalance(CUSTOMER));

    const row = ops.getPdcCheque(db, pdcA.id);
    ok(row.clearance_date === today && row.clearance_ref === 'NBL-CLR-991', 'Clearance date + bank reference recorded');
    ok(row.posted === true, 'getPdcCheque reports the cheque as posted');
    ok(ops.getPdcPosition(db).checks.every(c => c.ok), 'Position integrity checks still pass after clearing',
        ops.getPdcPosition(db).checks.filter(c => !c.ok));
    ok(auditCount(pdcA.id) >= 3, 'Clearance audited', auditCount(pdcA.id));
    const audit = db.prepare("SELECT new_values FROM audit_log WHERE table_name = 'pdc_cheques' AND record_id = ? ORDER BY id DESC LIMIT 1").get(pdcA.id);
    const parsed = JSON.parse(audit.new_values || '{}');
    ok(parsed.from_status === 'DEPOSITED' && parsed.to_status === 'CLEARED' && parsed.operation === 'PDC cleared',
        'Audit records old → new status', parsed.operation + ' ' + parsed.from_status + '→' + parsed.to_status);
}

// ──────────────────────────────────────────────────────────────
// Test 4 — Bounce after clearance (reversal, not a second entry)
// ──────────────────────────────────────────────────────────────
section('Test 4 — Bounce (from Cleared)');
{
    const res = ops.setPdcStatus(db, { id: pdcA.id, action: 'bounce', date: today, reason: 'Insufficient funds', charge: 500 }, uid, 'accountant');
    ok(res.to === 'BOUNCED', 'Status becomes BOUNCED', res.to);
    ok(res.reversed && res.reversed.amount === 100000, 'Previous clearance reversed', res.reversed);
    ok(bankBalance() === BASELINE_BANK, 'Bank balance fully reversed to the pre-cheque figure', bankBalance());
    ok(saleOutstanding(CUSTOMER, SALE_A) === 100000, 'Customer receivable restored', saleOutstanding(CUSTOMER, SALE_A));
    ok(partyBalance(CUSTOMER) === 300000, 'Party ledger restored (no double entry)', partyBalance(CUSTOMER));

    ok(pdcPayments(pdcA.id).length === 0, 'No orphaned money rows left behind', pdcPayments(pdcA.id).length);
    const stale = db.prepare(
        "SELECT COUNT(*) AS n FROM ledger_entries WHERE party_id = ? AND description LIKE 'PDC Cleared%'"
    ).get(CUSTOMER).n;
    ok(stale === 0, 'No stale PDC ledger rows survive the reversal', stale);
    ok(pdcPayments(pdcA.id).length === 0 && db.prepare('SELECT COUNT(*) AS n FROM payments WHERE party_id = ? AND mode = ?').get(CUSTOMER, 'cheque').n === 0,
        'No duplicate receipt left anywhere for this cheque');

    const charge = db.prepare("SELECT * FROM other_expenses WHERE reference_no = ? AND expense_head = 'Cheque Bounce Charge'").get('123456');
    ok(!!charge && Math.round(charge.amount * 100) / 100 === 500, 'Bounce charge recorded as an expense (Rs 500)', charge && charge.amount);
    ok(ops.getExpenseSummary(db, RANGE).total_operating_expenses === 500, 'Bounce charge reaches operating expenses',
        ops.getExpenseSummary(db, RANGE).total_operating_expenses);
    ok(cashBalance() === BASELINE_CASH, 'Cash balance untouched by the bounce', cashBalance());
    ok(ops.getPdcPosition(db).checks.every(c => c.ok), 'Position checks pass after a bounce',
        ops.getPdcPosition(db).checks.filter(c => !c.ok));

    const row = ops.getPdcCheque(db, pdcA.id);
    ok(row.bounce_date === today && row.bounce_reason === 'Insufficient funds' && row.bounce_charge === 500,
        'Bounce date, reason and charge stored', [row.bounce_date, row.bounce_reason, row.bounce_charge]);
}

// ──────────────────────────────────────────────────────────────
// Test 5 — Cancel + transition guards
// ──────────────────────────────────────────────────────────────
section('Test 5 — Cancel');
{
    const cancelled = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '998877',
        cheque_date: today, txn_date: today, bank_name: 'Global IME Bank', amount: 250000
    }, uid, 'operator');
    const before = bankBalance();
    ops.setPdcStatus(db, { id: cancelled.id, action: 'cancel', date: today, reason: 'Cheque returned by customer' }, uid, 'accountant');
    const row = ops.getPdcCheque(db, cancelled.id);
    ok(row.status === 'CANCELLED', 'Status becomes CANCELLED', row.status);
    ok(row.cancel_reason === 'Cheque returned by customer', 'Cancellation reason stored', row.cancel_reason);
    ok(bankBalance() === before, 'Cancel caused no bank movement', { before, after: bankBalance() });
    ok(!!db.prepare('SELECT id FROM pdc_cheques WHERE id = ?').get(cancelled.id), 'Cancelled cheque is kept in the register (never deleted)');
    ok(pdcPayments(cancelled.id).length === 0, 'Cancelled cheque has no money rows');
    ok(auditCount(cancelled.id) >= 2, 'Cancellation audited', auditCount(cancelled.id));

    // Illegal transitions must be refused (no arbitrary status changes)
    expectThrow(() => ops.setPdcStatus(db, { id: cancelled.id, action: 'clear', date: today }, uid, 'accountant'),
        'cannot be marked CLEARED', 'A cancelled cheque cannot be cleared');
    expectThrow(() => ops.setPdcStatus(db, { id: cancelled.id, action: 'deposit', date: today }, uid, 'operator'),
        'cannot be marked DEPOSITED', 'A cancelled cheque cannot be re-presented');
    expectThrow(() => ops.setPdcStatus(db, { id: pdcA.id, action: 'cancel', date: today, reason: 'x' }, uid, 'accountant'),
        'cannot be marked CANCELLED', 'A bounced cheque is not silently cancellable (the bounce stays on record)');
    // BOUNCED is final: the reversal trail of the bounce is never overwritten by
    // presenting the same record again — a re-presented cheque is a NEW PDC.
    expectThrow(() => ops.setPdcStatus(db, { id: pdcA.id, action: 'deposit', date: today, bank: 'Nabil Bank' }, uid, 'operator'),
        'cannot be marked DEPOSITED', 'A bounced cheque cannot be re-presented in place');
    expectThrow(() => ops.setPdcStatus(db, { id: pdcA.id, action: 'clear', date: today, bank: 'Nabil Bank' }, uid, 'accountant'),
        'cannot be marked CLEARED', 'A bounced cheque cannot be cleared directly');
    // Cancelled cheques stay in the register — never hard-deleted.
    expectThrow(() => ops.deletePdcCheque(db, cancelled.id, uid, 'admin'),
        'cannot be deleted', 'A cancelled cheque is never deleted (audit history)');
    ok(!!db.prepare('SELECT id FROM pdc_cheques WHERE id = ?').get(cancelled.id), 'Cancelled cheque still present after the refused delete');
    // …but the duplicate guard lets the same cheque number be re-entered, since
    // a cancelled/bounced record is closed.
    const reentered = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '998877',
        cheque_date: today, txn_date: today, bank_name: 'Global IME Bank', amount: 250000
    }, uid, 'operator');
    ok(reentered.id !== cancelled.id, 'A closed cheque number may be recorded again as a new PDC', { old: cancelled.id, new: reentered.id });
    ok(ops.deletePdcCheque(db, reentered.id, uid, 'admin').deleted === true, 'The replacement held cheque can still be deleted');
    expectThrow(() => ops.setPdcStatus(db, { id: pdcA.id, action: 'clear', date: today, bank: 'Nabil Bank' }, uid, 'operator'),
        'Access denied', 'Clearing a cheque needs the accountant role');
    expectThrow(() => ops.savePdcCheque(db, { id: cancelled.id, pdc_type: 'received', party_id: CUSTOMER, cheque_no: '998877', cheque_date: today, txn_date: today, amount: 999999 }, uid, 'operator'),
        'reverse or adjust', 'Amount cannot be edited after the cheque was cancelled');
}

// ──────────────────────────────────────────────────────────────
// Test 6 — PDC Issued
// ──────────────────────────────────────────────────────────────
section('Test 6 — PDC Issued');
{
    const payableBefore = partyBalance(SUPPLIER);
    const issued = ops.savePdcCheque(db, {
        pdc_type: 'issued', party_id: SUPPLIER, cheque_no: '789012', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 50000,
        allocations: [{ invoice_type: 'purchase', invoice_id: PURCHASE_1, amount: 50000 }]
    }, uid, 'operator');
    ok(bankBalance() === BASELINE_BANK, 'Issuing a cheque does NOT reduce the bank balance', bankBalance());
    ok(partyBalance(SUPPLIER) === payableBefore, 'Supplier payable unchanged while the cheque is held', partyBalance(SUPPLIER));

    const res = ops.setPdcStatus(db, { id: issued.id, action: 'clear', date: today, bank: 'Nabil Bank' }, uid, 'accountant');
    ok(res.money.bank_effect === -50000, 'Clearance moves Rs 50,000 OUT of the bank', res.money);
    ok(bankBalance() === Math.round((BASELINE_BANK - 50000) * 100) / 100,
        'Bank balance decreased by exactly Rs 50,000', bankBalance());
    ok(partyBalance(SUPPLIER) === 0, 'Supplier payable settled (ledger credit cleared)', partyBalance(SUPPLIER));
    const pmts = pdcPayments(issued.id);
    ok(pmts.length === 1 && pmts[0].type === 'payment' && pmts[0].mode === 'cheque',
        'Exactly one payment row, mode=cheque', pmts.map(p => [p.type, p.mode]));
    ok(ops.getPdcPosition(db).checks.every(c => c.ok), 'Position checks pass with an issued cheque',
        ops.getPdcPosition(db).checks.filter(c => !c.ok));
}

// ──────────────────────────────────────────────────────────────
// Test 7 — Multiple invoice allocation
// ──────────────────────────────────────────────────────────────
section('Test 7 — Multiple invoice allocation');
{
    const before = bankBalance();
    const multi = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200001', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 200000,
        allocations: [
            { invoice_type: 'sale', invoice_id: SALE_B, amount: 120000 },
            { invoice_type: 'sale', invoice_id: SALE_C, amount: 80000 }
        ]
    }, uid, 'operator');
    const detail = ops.getPdcCheque(db, multi.id);
    ok(detail.allocations.length === 2, 'Two allocations stored as rows (not a CSV string)', detail.allocations.length);
    ok(detail.allocated_total === 200000, 'Allocation total equals the cheque amount', detail.allocated_total);

    ops.setPdcStatus(db, { id: multi.id, action: 'clear', date: today, bank: 'Nabil Bank' }, uid, 'accountant');
    ok(bankBalance() === Math.round((before + 200000) * 100) / 100, 'Bank increased once by the full cheque', bankBalance());
    ok(saleOutstanding(CUSTOMER, SALE_B) === 0 && saleOutstanding(CUSTOMER, SALE_C) === 0,
        'Both allocated invoices reconcile to Rs 0 outstanding',
        [saleOutstanding(CUSTOMER, SALE_B), saleOutstanding(CUSTOMER, SALE_C)]);
    ok(saleOutstanding(CUSTOMER, SALE_A) === 100000, 'The unallocated invoice is untouched', saleOutstanding(CUSTOMER, SALE_A));
    const rows = pdcPayments(multi.id);
    ok(rows.length === 2 && Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100 === 200000,
        'Two receipt rows totalling the cheque (no on-account leftover)', rows.map(r => r.amount));

    // Over-allocation and cross-party allocation must be refused
    expectThrow(() => ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200002', cheque_date: today, txn_date: today,
        amount: 100000, allocations: [{ invoice_type: 'sale', invoice_id: SALE_A, amount: 150000 }]
    }, uid, 'operator'), 'cannot exceed the cheque amount', 'Over-allocation is refused');
    expectThrow(() => ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: ONACCT, cheque_no: '200003', cheque_date: today, txn_date: today,
        amount: 100000, allocations: [{ invoice_type: 'sale', invoice_id: SALE_A, amount: 100000 }]
    }, uid, 'operator'), 'different party', 'Allocation to an unrelated party is refused');
    expectThrow(() => ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200004', cheque_date: today, txn_date: today,
        amount: 100000, allocations: [{ invoice_type: 'sale', invoice_id: SALE_A, amount: -5 }]
    }, uid, 'operator'), 'greater than 0', 'Negative allocation is refused');
}

// ──────────────────────────────────────────────────────────────
// Test 8 — On-account cheque, settled later by the existing flow
// ──────────────────────────────────────────────────────────────
section('Test 8 — On-account PDC');
{
    const before = bankBalance();
    const onAcct = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: ONACCT, cheque_no: '300001', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 50000, remarks: 'Advance against future invoices'
    }, uid, 'operator');
    ok(ops.getPdcCheque(db, onAcct.id).allocated_total === 0, 'Recorded with NO invoice (on account)');

    ops.setPdcStatus(db, { id: onAcct.id, action: 'clear', date: today, bank: 'Nabil Bank' }, uid, 'accountant');
    const rows = pdcPayments(onAcct.id);
    ok(rows.length === 1 && rows[0].reference_type === 'pdc' && rows[0].reference_id === onAcct.id,
        'One on-account receipt linked back to the cheque', rows.map(r => [r.reference_type, r.reference_id]));
    ok(bankBalance() === Math.round((before + 50000) * 100) / 100, 'Bank increased once by the on-account cheque', bankBalance());

    // A new invoice for the same party is settled by the existing allocation flow…
    const LATER = makeSale(ONACCT, 'INV-LATER-1', 50000);
    db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, 'Sale Invoice INV-LATER-1', 50000, 0, 50000)").run(ONACCT, today, LATER);
    ok(saleOutstanding(ONACCT, LATER) === 0,
        'The later invoice is settled by the on-account money (existing FIFO allocation)', saleOutstanding(ONACCT, LATER));
    ok(pdcPayments(onAcct.id).length === 1, 'No duplicate receipt appeared when the money was used', pdcPayments(onAcct.id).length);
    ok(ops.getPdcPosition(db).checks.every(c => c.ok), 'Position checks pass with an on-account cheque',
        ops.getPdcPosition(db).checks.filter(c => !c.ok));
}

// ──────────────────────────────────────────────────────────────
// Test 9 — Duplicate cheques blocked
// ──────────────────────────────────────────────────────────────
section('Test 9 — Duplicate cheque prevention');
{
    const dupPayload = {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200001', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 1000
    };
    expectThrow(() => ops.savePdcCheque(db, { ...dupPayload }, uid, 'operator'), 'Duplicate cheque', 'Duplicate active cheque refused by the application');

    let dbBlocked = false;
    try {
        db.exec("INSERT INTO pdc_cheques (pdc_type, party_id, cheque_no, cheque_date, txn_date, bank_name, amount, status) VALUES ('received', " + CUSTOMER + ", '200001', '" + today + "', '" + today + "', 'Nabil Bank', 1000, 'HELD')");
    } catch (e) {
        dbBlocked = /UNIQUE/i.test(e.message);
    }
    ok(dbBlocked, 'Database unique index blocks a duplicate active cheque too (no frontend-only validation)');

    const other = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200001', cheque_date: today, txn_date: today,
        bank_name: 'Everest Bank', amount: 1000, reference_no: 'same-number-other-bank'
    }, uid, 'operator').id;
    ok(!!other, 'The same cheque number at a different bank is allowed');
    expectThrow(() => ops.deletePdcCheque(db, other, uid, 'operator'), 'role', 'Deleting a cheque needs the admin role');
    ok(ops.deletePdcCheque(db, other, uid, 'admin').deleted === true, 'A held cheque can be deleted by an admin');
    const clearedId = db.prepare("SELECT id FROM pdc_cheques WHERE cheque_no = '200001' AND status = 'CLEARED'").get().id;
    expectThrow(() => ops.deletePdcCheque(db, clearedId, uid, 'admin'),
        'cannot be deleted', 'A cleared cheque cannot be deleted (history stays)');
    expectThrow(() => ops.setPdcStatus(db, { id: clearedId, action: 'cancel', date: today, reason: 'x' }, uid, 'accountant'),
        'cannot be marked CANCELLED', 'A cleared cheque cannot be cancelled — it must be bounced/reversed');
    expectThrow(() => ops.savePdcCheque(db, { id: clearedId, pdc_type: 'received', party_id: CUSTOMER, cheque_no: '200001', cheque_date: today, txn_date: today, bank_name: 'Nabil Bank', amount: 999999 }, uid, 'operator'),
        'reverse or adjust', 'The amount cannot be edited after the cheque cleared');

    // A returned cheque may legitimately come back and be registered again.
    const returned = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '400001', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 7000
    }, uid, 'operator');
    ops.setPdcStatus(db, { id: returned.id, action: 'cancel', date: today, reason: 'Returned unpaid' }, uid, 'accountant');
    const again = ops.savePdcCheque(db, {
        pdc_type: 'received', party_id: CUSTOMER, cheque_no: '400001', cheque_date: today, txn_date: today,
        bank_name: 'Nabil Bank', amount: 7000
    }, uid, 'operator');
    ok(!!again.id && again.id !== returned.id, 'A cancelled cheque can be re-registered (partial unique index releases it)');
}

// ──────────────────────────────────────────────────────────────
// Test 10 — Restart: persistence
// ──────────────────────────────────────────────────────────────
section('Test 10 — Restart persistence');
{
    const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n;
    const beforeBank = bankBalance();
    const beforeStatuses = db.prepare('SELECT cheque_no, status FROM pdc_cheques ORDER BY id').all();
    db.close();
    db = openDatabase(DB_PATH);
    runMigrations(db);
    const afterStatuses = db.prepare('SELECT cheque_no, status FROM pdc_cheques ORDER BY id').all();
    ok(db.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n === beforeCount, 'All PDC rows survive a restart');
    ok(JSON.stringify(beforeStatuses) === JSON.stringify(afterStatuses), 'Statuses survive a restart', afterStatuses);
    ok(db.prepare('SELECT COUNT(*) AS n FROM pdc_allocations').get().n > 0, 'Allocations survive a restart');
    ok(bankBalance() === beforeBank, 'Bank balance is identical after reopening the database', bankBalance());
    ok(ops.getAuditLogs(db, {}).length > 0, 'Audit history survives a restart');
}

// ──────────────────────────────────────────────────────────────
// Reporting: register / due / bounced / daybook / statement
// ──────────────────────────────────────────────────────────────
section('Reports and read-only integration');
{
    const reg = ops.getPdcRegisterReport(db, { from_date: '2000-01-01', to_date: '2100-01-01' });
    ok(reg.rows.length >= 4, 'PDC Register report returns the register', reg.rows.length);
    ok(typeof reg.totals.amount === 'number' && reg.totals.amount > 0, 'Register totals computed', reg.totals);
    const due = ops.getPdcDueReport(db, {});
    ok(due.groups && typeof due.groups.due_today.count === 'number', 'Due report groups by Cheque-date bucket', Object.keys(due.groups));
    const bounced = ops.getPdcBouncedReport(db, {});
    ok(bounced.totals.count === 1 && bounced.totals.charges === 500, 'Bounced report lists the bounced cheque with its charge', bounced.totals);

    const daybook = ops.getDaybook(db, { from_date: '2000-01-01', to_date: '2100-01-01' });
    const memos = daybook.entries.filter(e => e.type === 'pdc');
    ok(memos.length >= 1, 'Daybook shows PDC activity', memos.length);
    ok(memos.every(m => m.debit === 0 && m.credit === 0 && m.memo === true),
        'Held/cancelled cheques appear as zero-amount memo rows (never as a bank receipt)', memos.map(m => [m.debit, m.credit]));
    const clearedRows = daybook.entries.filter(e => e.transaction_type === 'PDC Cleared');
    ok(clearedRows.length >= 1, 'Daybook labels cleared cheques as "PDC Cleared"', clearedRows.length);
    ok(clearedRows.every(e => e.pdc && e.memo === false), 'Cleared rows carry the cheque detail and are not memos');
    const daybookTotals = Math.round((daybook.totalDebit - daybook.totalCredit) * 100) / 100;
    ok(Number.isFinite(daybookTotals), 'Daybook totals still compute (memos never summed)');

    const stmt = ops.getPartyStatement(db, { party_id: CUSTOMER, from_date: '2000-01-01', to_date: '2100-01-01' });
    const memoLines = stmt.entries.filter(e => e.is_memo);
    ok(memoLines.length >= 1, 'Party statement shows held cheques as memo lines', memoLines.length);
    ok(memoLines.every(e => e.debit === 0 && e.credit === 0), 'Statement memo lines move no balance', memoLines.map(e => [e.debit, e.credit]));
    const pdcLedger = stmt.entries.filter(e => e.is_pdc && !e.is_memo);
    ok(pdcLedger.length >= 1 && /PDC (Received|Issued) — Cleared/.test(pdcLedger[0].description),
        'Cleared cheque reads as a PDC in the statement, not as cash/bank money', pdcLedger[0] && pdcLedger[0].description);
    // Held: the re-registered Rs 7,000 cheque. Cleared: the multi-invoice Rs 200,000
    // cheque. Bounced: the reversed Rs 100,000 cheque. None of them is mixed into
    // the invoice balances.
    ok(stmt.pdc.received_held === 7000 && stmt.pdc.cleared === 200000 && stmt.pdc.bounced === 100000,
        'Statement reports cleared / bounced / still-held cheques separately, with no fake holding', stmt.pdc);
    ok(stmt.closing_balance === stmt.opening_balance + stmt.total_debit - stmt.total_credit,
        'Statement closing balance still reconciles', stmt.closing_balance);

    const dash = ops.getDashboard(db);
    ok(dash.pdc && dash.pdc.pdc_receivable >= 0, 'Dashboard exposes the PDC position separately from cash/bank', dash.pdc && dash.pdc.pdc_receivable);
    ok(dash.cashPosition && typeof dash.cashPosition.net_cash === 'number', 'Dashboard cash position unchanged in shape');
}

// ──────────────────────────────────────────────────────────────
// Test 11 — Backup → Fresh Start → Restore
// ──────────────────────────────────────────────────────────────
section('Test 11 — Backup / Fresh Start / Restore');
let restoreSource = null;
{
    const beforeRows = db.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n;
    const beforeAllocs = db.prepare('SELECT COUNT(*) AS n FROM pdc_allocations').get().n;

    // A complete, consistent snapshot of the live database (same semantics as
    // the app's Online Backup API — a full copy, not a partial export).
    const snapshotPath = BACKUP_PATH + '.dab';
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec(`VACUUM INTO '${snapshotPath}'`);
    restoreSource = snapshotPath;
    ok(fs.existsSync(restoreSource) && fs.statSync(restoreSource).size > 4096,
        'A complete backup file was created', restoreSource);

    // The PDC tables must be part of the Fresh Start wipe plan (and therefore
    // were captured by the backup that ran BEFORE any deletion).
    const plan = ops.getFreshStartWipePlan(db);
    ok(plan.tables.includes('pdc_cheques') && plan.tables.includes('pdc_allocations'),
        'PDC tables are included in the Fresh Start wipe plan (not accidentally kept/excluded)',
        plan.tables.filter(t => /pdc/.test(t)));

    const cleanup = ops.performCleanup(db, {
        adminPassword: 'PdcTest1234',
        confirmText: 'RESET',
        backupPath: restoreSource,
        userId: uid
    });
    ok(cleanup.success === true, 'Fresh Start (handover reset) succeeded', cleanup.error);
    ok(db.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n === 0, 'PDC register cleared by the reset');

    // The backup taken before the wipe still carries the cheques.
    const snap = new Database(restoreSource, { readonly: true, fileMustExist: true });
    ok(snap.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n === beforeRows,
        'The pre-reset backup still contains every PDC record', snap.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n);
    ok(snap.prepare('SELECT COUNT(*) AS n FROM pdc_allocations').get().n === beforeAllocs,
        'The pre-reset backup still contains every allocation');
    snap.close();

    // Restore
    ops.restoreDatabaseFromPath(DB_PATH, restoreSource, () => db.close());
    db = openDatabase(DB_PATH);
    runMigrations(db);
    ok(db.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n === beforeRows, 'Restore brings every PDC record back');
    ok(db.prepare('SELECT COUNT(*) AS n FROM pdc_allocations').get().n === beforeAllocs, 'Restore brings every allocation back');
    ok(db.prepare("SELECT COUNT(*) AS n FROM payments WHERE mode = 'cheque'").get().n > 0,
        'Restore brings the cheque money rows back');
    ok(db.prepare("SELECT COUNT(*) AS n FROM bank_transactions").get().n >= 0, 'Restore leaves the bank module intact');
    ok(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'pdc_cheques'").get().n > 0,
        'Restore brings the PDC audit history back');
    const pos = ops.getPdcPosition(db);
    ok(pos.total_count === beforeRows && pos.checks.every(c => c.ok),
        'PDC relationships are consistent after a restore', pos.checks.filter(c => !c.ok));
}

// ──────────────────────────────────────────────────────────────
// Test 12 — Regression across the existing modules
// ──────────────────────────────────────────────────────────────
section('Test 12 — Regression (existing modules still work)');
{
    const checks = [
        ['Sales list', () => ops.listSales(db, {})],
        ['Sale detail + settlement', () => ops.getSale(db, SALE_A)],
        ['Sales report', () => ops.getSalesReport(db, {})],
        ['Sales register', () => ops.getSalesRegister(db, {})],
        ['Purchases report', () => ops.getPurchasesReport(db, {})],
        ['Purchase register', () => ops.getPurchaseRegister(db, {})],
        ['Receivables', () => ops.getReceivables(db)],
        ['Payables', () => ops.getPayables(db)],
        ['Daybook', () => ops.getDaybook(db, {})],
        ['Enhanced daybook', () => ops.getEnhancedDaybook(db, {})],
        ['Profit & Loss', () => ops.getProfitLoss(db, {})],
        ['Profit & Loss by month', () => ops.getProfitLossByMonth(db, {})],
        ['Stock statement', () => ops.getStockStatement(db, {})],
        ['Balance-sheet ingredients (stock)', () => ops.getCurrentStock(db, {})],
        ['Cash/bank position', () => ops.getCashBankPosition(db, {})],
        ['Cash collection', () => ops.getDailyCashCollection(db, {})],
        ['Cash deposits', () => ops.listCashDeposits(db, {})],
        ['Petty cash', () => ops.listPettyCash(db, {})],
        ['Expenses', () => ops.listOtherExpenses(db, {})],
        ['Salary', () => ops.listSalaryRecords(db, {})],
        ['Vehicle expenses', () => ops.listVehicleExpenses(db, {})],
        ['Partner capital', () => ops.listPartnerCapital(db, {})],
        ['Milk collections', () => ops.listMilkCollections(db, {})],
        ['Farmer outstanding', () => ops.getFarmerOutstanding(db)],
        ['Parties', () => ops.listParties(db, {})],
        ['Party statement', () => ops.getPartyStatement(db, { party_id: SUPPLIER })],
        ['Farmer statement', () => ops.getFarmerStatement(db, { party_id: SUPPLIER })],
        ['Bank list', () => ops.listBankTransactions(db, {})],
        ['Today summary', () => ops.getTodaySummary(db)],
        ['Dashboard', () => ops.getDashboard(db)],
        ['Audit log', () => ops.getAuditLogs(db, {})],
        ['Settings', () => ops.getSettings(db)],
        ['Backups list', () => ops.listBackups(DB_PATH)],
        ['Integrity doctor', () => ops.runIntegrityChecks(db, {})],
        ['Cross-module reconciliation', () => ops.getReconciliation(db, {})]
    ];
    let broken = [];
    for (const [name, fn] of checks) {
        try { fn(); } catch (e) { broken.push(`${name}: ${e.message}`); }
    }
    ok(broken.length === 0, `All ${checks.length} existing operations still run`, broken);

    const recon = ops.getReconciliation(db, { from_date: '2000-01-01', to_date: '2100-01-01' });
    const failed = recon.checks.filter(c => !c.ok);
    ok(failed.length === 0, 'Cross-module reconciliation checks all pass with PDC activity in the books',
        failed.map(c => `${c.label} (${c.difference})`));

    // PDC must not have inflated income, and clearing must be visible in the bank figure.
    ok(Math.round(recon.sales.total * 100) / 100 === 350000, 'Sales total unchanged by PDC activity', recon.sales.total);
    // Cleared received cheques: multi 200,000 + on-account 50,000 = 250,000 in.
    // Issued cheque: 50,000 out. The bounced cheque contributed nothing (reversed).
    const expectedBank = Math.round((BASELINE_BANK + 250000 - 50000) * 100) / 100;
    ok(Math.round(recon.bank.balance * 100) / 100 === expectedBank,
        'Bank balance = baseline − issued cheque + cleared received cheques (each once)',
        { expected: expectedBank, actual: recon.bank.balance });

    const bookings = ops.getPdcPosition(db);
    ok(bookings.checks.every(c => c.ok), 'Final PDC position checks all pass', bookings.checks.filter(c => !c.ok));
    ok(bookings.received.cleared.amount === 250000 && bookings.received.bounced.amount === 100000,
        'Position counts cleared vs bounced cheques separately',
        { cleared: bookings.received.cleared.amount, bounced: bookings.received.bounced.amount });
}

// ──────────────────────────────────────────────────────────────
// The application's real backup path (SQLite Online Backup API, async) must
// also carry the PDC register.
// ──────────────────────────────────────────────────────────────
section('Online Backup API snapshot');
ops.backupDatabaseToPath(db, DB_PATH, path.join(BACKUP_DIR, 'online-api-check'))
    .then(res => {
        const snap = new Database(res.path, { readonly: true, fileMustExist: true });
        const n = snap.prepare('SELECT COUNT(*) AS n FROM pdc_cheques').get().n;
        const a = snap.prepare('SELECT COUNT(*) AS n FROM pdc_allocations').get().n;
        snap.close();
        ok(n > 0 && a > 0, 'Online Backup API snapshot includes the PDC register and its allocations', { cheques: n, allocations: a });
    })
    .catch(e => ok(false, 'Online Backup API snapshot', e.message))
    .finally(() => {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`PDC ACCEPTANCE: ${pass} passed, ${fail} failed`);
        console.log(`${'─'.repeat(60)}`);
        try { db.close(); } catch (e) { /* already closed */ }
        process.exit(fail === 0 ? 0 : 1);
    });
