#!/usr/bin/env node
/**
 * test-bank-isolation-restart.js
 * ==============================
 * The owner's acceptance table for a standalone Bank Transactions register,
 * including the one case that cannot be checked in a single process: a REAL
 * RESTART.
 *
 *   | Add / edit / delete / import a bank transaction | only the bank module changes |
 *   | Add a petty cash expense                        | no bank row is created      |
 *   | Record a payment collection / party payment     | no bank row is created      |
 *   | Restart the application                         | bank records stay correct   |
 *
 * "Restart" here means what the installed app does on launch: close the
 * connection, then `initDatabase()` again — schema, every startup migration,
 * the plant helper products and the bank table's own healing pass — and finally
 * the Bank screen's `ensureBankTable()` guard.
 *
 * Deliberately excluded from the "nothing else changed" set: `audit_log`.
 * Auditing a bank write is required behaviour, not cross-module posting, and
 * is asserted separately.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const bank = require(path.join(ROOT, 'shared', 'operations', 'bank'));
const payments = require(path.join(ROOT, 'shared', 'operations', 'payments'));
const pettyCash = require(path.join(ROOT, 'shared', 'operations', 'petty_cash'));

let pass = 0, fail = 0;
function check(cond, label, detail) {
    if (cond) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.error('  ❌ ' + label + (detail === undefined ? '' : ` — ${JSON.stringify(detail)}`)); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Registers the bank module must never write to, directly or indirectly. */
const BUSINESS_TABLES = [
    'ledger_entries', 'payments', 'petty_cash', 'other_expenses', 'cash_deposits',
    'stock_movements', 'milk_collections', 'sales', 'sales_items', 'purchases',
    'purchase_items', 'denomination_counts', 'salary_records', 'vehicle_expenses',
    'partner_capital', 'production_batches', 'production_inputs', 'production_outputs'
];
function businessCounts(db) {
    const out = {};
    for (const t of BUSINESS_TABLES) {
        try { out[t] = Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n); }
        catch (e) { out[t] = 'absent'; }
    }
    return out;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-isolation-'));
let db = initDatabase(dir, 'test.db');
bank.ensureBankTable(db);

function makeParty(name, type) {
    try {
        return Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
    } catch (e) {
        return Number(db.prepare('INSERT INTO parties (name) VALUES (?)').run(name).lastInsertRowid);
    }
}
const customer = makeParty('Restart Test Customer', 'customer');
const supplier = makeParty('Restart Test Supplier', 'supplier');

const bankCount = () => Number(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n);
/** What a restart must preserve, link columns included — a stale link is a bug. */
const bankSnapshot = () => db.prepare(`
    SELECT id, date, COALESCE(reference_no,'') ref,
           COALESCE(debit,0) debit, COALESCE(credit,0) credit,
           COALESCE(accounting_class,'') cls, COALESCE(txn_uid,'') uid,
           COALESCE(party_id,-1) party_id, COALESCE(ledger_entry_id,-1) ledger_entry_id,
           COALESCE(ledger_posted,0) ledger_posted
      FROM bank_transactions ORDER BY id
`).all();
const linkedRows = () => Number(db.prepare(`
    SELECT COUNT(*) n FROM bank_transactions
     WHERE party_id IS NOT NULL OR ledger_entry_id IS NOT NULL OR COALESCE(ledger_posted,0) <> 0
`).get().n);

console.log('\n1) Add / edit / import touch only the bank register');
let base = businessCounts(db);
const created = bank.saveBankTransaction(db, {
    date: '2083-07-01', reference_no: 'RST-1', counterparty_name: 'Restart Test Supplier',
    description: 'Diesel', debit: 700, credit: 0, payment_mode: 'Bank'
}, null);
check(created.success === true, 'a bank row is created', created);
check(same(base, businessCounts(db)), 'create changes no other register', businessCounts(db));
check(linkedRows() === 0, 'created row claims no party or ledger link', linkedRows());

const edited = bank.saveBankTransaction(db, {
    ...created.data, description: 'Diesel (corrected)', debit: 800
}, null);
check(edited.success === true && edited.data.description === 'Diesel (corrected)' && Number(edited.data.debit) === 800,
    'edit updates only its own bank row', edited);
check(same(base, businessCounts(db)), 'edit changes no other register', businessCounts(db));

const imported = bank.importBankRows(db, [
    { date: '2083-07-02', reference_no: 'RST-2', counterparty_name: 'Restart Test Supplier', description: 'Cash deposit', debit: 0, credit: 500, txn_type: 'Bank Deposit (own)' },
    { date: '2083-07-03', reference_no: 'RST-3', counterparty_name: 'Restart Test Customer', description: 'QR receipt', debit: 0, credit: 1250, payment_mode: 'QR/Bank' }
]);
check(imported.inserted === 2, 'bank import inserts its rows', imported);
check(same(base, businessCounts(db)), 'import changes no other register', businessCounts(db));
check(linkedRows() === 0, 'imported rows claim no party or ledger link', linkedRows());
const reimport = bank.importBankRows(db, [
    { date: '2083-07-02', reference_no: 'RST-2', counterparty_name: 'Restart Test Supplier', description: 'Cash deposit', debit: 0, credit: 500, txn_type: 'Bank Deposit (own)' },
    { date: '2083-07-03', reference_no: 'RST-3', counterparty_name: 'Restart Test Customer', description: 'QR receipt', debit: 0, credit: 1250, payment_mode: 'QR/Bank' }
]);
check(reimport.inserted === 0 && bankCount() === 3, 're-importing the same statement adds nothing', { inserted: reimport.inserted, rows: bankCount() });
check(same(base, businessCounts(db)), 're-import changes no other register', businessCounts(db));

console.log('\n2) Other modules never create a bank row');
const bankBeforeOthers = bankCount();
const expense = pettyCash.savePettyCash(db, {
    voucher_no: 'PC-RST-1', date: '2083-07-04', expense_head: 'Transport',
    description: 'Milk van diesel', amount: 450, paid_to: 'Driver', payment_mode: 'cash'
});
check(bankCount() === bankBeforeOthers, 'a petty cash expense creates no bank row', { before: bankBeforeOthers, after: bankCount(), expense });

const collection = payments.savePayment(db, {
    party_id: customer, date: '2083-07-05', type: 'receipt', transaction_type: 'collection',
    amount: 1000, mode: 'bank', notes: 'Counter collection'
});
check(bankCount() === bankBeforeOthers, 'a payment collection creates no bank row', { after: bankCount(), collection });
check(collection.bank_txn_id === null, 'the collection is not linked to any bank row', collection.bank_txn_id);

const partyPayment = payments.savePayment(db, {
    party_id: supplier, date: '2083-07-06', type: 'payment', transaction_type: 'actual_expense',
    amount: 600, mode: 'bank', notes: 'Supplier paid by bank'
});
check(bankCount() === bankBeforeOthers, 'a party payment creates no bank row', { after: bankCount(), partyPayment });
check(partyPayment.bank_txn_id === null, 'the party payment is not linked to any bank row', partyPayment.bank_txn_id);
check(Number(db.prepare('SELECT COUNT(*) n FROM payments WHERE bank_txn_id IS NOT NULL').get().n) === 0,
    'no payment anywhere carries a bank link');

console.log('\n3) Delete touches only the bank register');
const toDelete = created.data.id;
const beforeDelete = bankCount();
// Snapshot immediately before the delete: section 2 deliberately created a
// petty-cash voucher and two payments, so `base` from section 1 is stale here.
const beforeDeleteCounts = businessCounts(db);
const del = bank.deleteBankTransaction(db, toDelete, null);
check(del.success === true && bank.getBankTransaction(db, toDelete) === undefined, 'the bank row is gone');
check(bankCount() === beforeDelete - 1, 'exactly one row was removed', { before: beforeDelete, after: bankCount() });
const afterDeleteCounts = businessCounts(db);
check(same(beforeDeleteCounts, afterDeleteCounts), 'delete changes no other register', afterDeleteCounts);
// create + edit + delete = one audit record each.
const auditRows = Number(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE table_name = 'bank_transactions'").get().n);
check(auditRows >= 3, 'every bank write (create, edit, delete) is audit-logged', auditRows);

console.log('\n4) RESTART — close the database and reopen it like the app does');
const beforeRestartRows = bankSnapshot();
const beforeRestartCounts = businessCounts(db);
const deletedRef = String(created.data.reference_no);
db.close();
db = initDatabase(dir, 'test.db');   // schema + all startup migrations + plant products
bank.ensureBankTable(db);            // the Bank screen's own guard
const afterRestartRows = bankSnapshot();

check(same(beforeRestartRows, afterRestartRows),
    'every bank row survives the restart exactly as it was',
    { before: beforeRestartRows.length, after: afterRestartRows.length });
check(bankCount() === beforeRestartRows.length, 'no bank row is created by startup', { rows: bankCount() });
check(!afterRestartRows.some(r => r.ref === deletedRef), 'the deleted bank row does not come back', deletedRef);
check(same(beforeRestartCounts, businessCounts(db)),
    'startup recreates no record in any other register',
    { before: beforeRestartCounts, after: businessCounts(db) });
check(linkedRows() === 0, 'startup re-links no bank row to a party or ledger', linkedRows());
check(Number(db.prepare('SELECT COUNT(*) n FROM payments WHERE bank_txn_id IS NOT NULL').get().n) === 0,
    'startup links no payment to a bank row');

console.log('\n5) Bank reports read only bank rows');
const statement = bank.getBankStatement(db, {});
const sumDebit = Number(db.prepare('SELECT COALESCE(SUM(debit),0) s FROM bank_transactions').get().s);
const sumCredit = Number(db.prepare('SELECT COALESCE(SUM(credit),0) s FROM bank_transactions').get().s);
check(Math.abs(statement.total_debit - sumDebit) < 0.005, 'statement total debit sums the bank rows', { statement: statement.total_debit, rows: sumDebit });
check(Math.abs(statement.total_credit - sumCredit) < 0.005, 'statement total credit sums the bank rows', { statement: statement.total_credit, rows: sumCredit });
check(Math.abs(statement.net - (sumCredit - sumDebit)) < 0.005, 'statement net is credit minus debit', statement.net);
check(statement.entries.length === bankCount(), 'statement lists every bank row once', { entries: statement.entries.length, rows: bankCount() });
const runningOk = statement.entries.every((r, i) => i === 0
    || Math.abs(r.running_balance - (statement.entries[i - 1].running_balance + (r.credit || 0) - (r.debit || 0))) < 0.005);
check(runningOk, 'running balance is continuous from the first row');

console.log('\n6) Source invariant — only bank.js may write bank rows');
const WRITES_BANK = /(INSERT\s+INTO\s+bank_transactions|UPDATE\s+bank_transactions|DELETE\s+FROM\s+bank_transactions)/i;
const walk = (p, acc) => {
    try {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
            const full = path.join(p, e.name);
            if (e.isDirectory()) walk(full, acc);
            else if (e.name.endsWith('.js')) acc.push(full);
        }
    } catch (err) { /* unreadable directory — skip */ }
    return acc;
};
const sources = [];
for (const d of ['shared', 'renderer']) walk(path.join(ROOT, d), sources);
for (const f of ['main.js', 'server.js', 'preload.js', 'data-exchange.js']) {
    const full = path.join(ROOT, f);
    if (fs.existsSync(full)) sources.push(full);
}
const offenders = sources
    .filter(f => !/[\\/]shared[\\/]operations[\\/]bank\.js$/.test(f))
    .filter(f => WRITES_BANK.test(fs.readFileSync(f, 'utf8')))
    .map(f => path.relative(ROOT, f));
check(offenders.length === 0, 'no runtime module outside shared/operations/bank.js writes a bank row', offenders);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
db.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
