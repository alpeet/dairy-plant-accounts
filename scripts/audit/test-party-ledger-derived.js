#!/usr/bin/env node
/**
 * test-party-ledger-derived.js
 * ============================
 * 1) The Party Ledger is a REPORT built from the registers that own each
 *    transaction — it never writes, and never needs a duplicate ledger row.
 * 2) A milk collection already carried on a purchase bill is counted once.
 * 3) A Collection-sheet row typed "Rent" is INCOME (other income), never a party
 *    receipt — matching the workbook's own `Profit_Loss!C8`, which sums
 *    `Party_Ledger!H` where `Txn Type = rent`.
 * 4) Re-importing the same Collection sheet adds nothing twice.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const ledger = require(path.join(ROOT, 'shared', 'operations', 'party_ledger'));
const excelImport = require(path.join(ROOT, 'shared', 'excel-import'));

let pass = 0, fail = 0;
function check(cond, label, detail) {
    if (cond) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.error('  ❌ ' + label + (detail === undefined ? '' : ` — ${JSON.stringify(detail)}`)); }
}
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prarambha-derived-'));
const db = initDatabase(dir);

const party = (name, type, opening = 0) =>
    Number(db.prepare('INSERT INTO parties (name, type, opening_balance) VALUES (?, ?, ?)').run(name, type, opening).lastInsertRowid);

const customer = party('RAM KIRANA', 'customer', 1000);
const supplier = party('MUKTESHWOR ENTERPRISES', 'supplier', 0);
const farmer = party('DIL BAHADUR', 'supplier', 0);

// The importer resolves names through a module-level index that is built by the
// import entry point. Build it here so the Collection import can find the
// parties created above (without it, resolveParty() returns null by design).
excelImport.buildPartyIndex(db);

const sale = (invoice, date, pid, amount) =>
    Number(db.prepare(`INSERT INTO sales (invoice_no, date, party_id, subtotal, grand_total, paid_amount, status)
                       VALUES (?, ?, ?, ?, ?, 0, 'unpaid')`).run(invoice, date, pid, amount, amount).lastInsertRowid);
const purchase = (bill, date, pid, amount) =>
    Number(db.prepare(`INSERT INTO purchases (bill_no, date, party_id, subtotal, grand_total, paid_amount, status)
                       VALUES (?, ?, ?, ?, ?, 0, 'unpaid')`).run(bill, date, pid, amount, amount).lastInsertRowid);
const milk = (no, date, pid, amount, purchaseId = null) =>
    Number(db.prepare(`INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters, rate, amount, shift, status, purchase_ref_id)
                       VALUES (?, ?, ?, 'cow', 100, 10, ?, 'morning', 'pending', ?)`).run(no, date, pid, amount, purchaseId).lastInsertRowid);
const payment = (date, pid, type, amount, tt = null) =>
    Number(db.prepare(`INSERT INTO payments (party_id, date, type, transaction_type, amount, mode, notes)
                       VALUES (?, ?, ?, ?, ?, 'cash', ?)`).run(pid, date, type, tt, amount, `${type} test`).lastInsertRowid);

console.log('\n1. Derived statement reads the owning modules');
const s1 = sale('INV-1', '2083-04-01', customer, 10000);
const r1 = payment('2083-04-05', customer, 'receipt', 4000);
const b1 = purchase('PB-1', '2083-04-02', supplier, 7000);
const pm1 = payment('2083-04-06', supplier, 'payment', 2000);
const m1 = milk('MC-1', '2083-04-03', farmer, 3000);
const bogusPurchase = purchase('PB-MILK', '2083-04-03', farmer, 3000);
db.prepare('UPDATE milk_collections SET purchase_ref_id = ? WHERE id = ?').run(bogusPurchase, m1);

let st = ledger.getDerivedPartyLedger(db, { party_id: customer });
check(st && st.rows.length === 2, 'customer statement has the sale + the receipt', st && st.rows.length);
check(near(st.totals.closing, 7000), 'closing = opening 1,000 + 10,000 Dr − 4,000 Cr', st.totals.closing);
check(st.rows.some(r => r.source_table === 'sales' && r.source_id === s1), 'sale line carries source_table/source_id');
check(st.rows.some(r => r.source_table === 'payments' && r.source_id === r1), 'receipt line carries source_table/source_id');
check(st.rows.every(r => 'balance' in r), 'every line has a running balance');
check(near(st.rows[st.rows.length - 1].balance, st.totals.closing), 'last running balance equals the closing balance');

st = ledger.getDerivedPartyLedger(db, { party_id: supplier });
check(near(st.totals.closing, -5000), 'supplier: 7,000 Cr − 2,000 Dr = −5,000 (payable)', st.totals.closing);

st = ledger.getDerivedPartyLedger(db, { party_id: farmer });
check(near(st.totals.closing, -3000), 'milk already on a purchase bill is counted ONCE (3,000, not 6,000)', st.totals.closing);
check(st.rows.filter(r => r.type === 'purchase').length === 1, 'the linked milk row contributes no second line');
check(st.rows.filter(r => r.type === 'milk_collection').length === 0, 'linked milk collection is represented by its purchase bill');

console.log('\n2. Date filtering produces the right brought-forward figure');
st = ledger.getDerivedPartyLedger(db, { party_id: customer, from_date: '2083-04-04', to_date: '2083-04-30' });
check(near(st.opening_bf, 11000), 'opening b/f = 1,000 + 10,000 (sale before the period)', st.opening_bf);
check(st.rows.length === 1 && st.rows[0].source_id === r1, 'only the in-period receipt is listed', st.rows.length);
check(near(st.totals.closing, 7000), 'closing still reconciles across the period cut', st.totals.closing);

console.log('\n3. Balances and reconciliation are read-only');
const balances = ledger.getDerivedPartyBalances(db);
check(balances.length === 3, 'one balance row per party', balances.length);
check(balances.some(b => b.party_id === supplier && b.balance_type === 'Payable'), 'supplier classified Payable');
check(balances.some(b => b.party_id === customer && b.balance_type === 'Receivable' && near(b.receivable, 7000)), 'customer classified Receivable 7,000');

const before = Number(db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n);
ledger.getDerivedPartyLedger(db, { party_id: customer });
ledger.getDerivedPartyBalances(db);
const rec0 = ledger.reconcileWithStoredLedger(db);
const after = Number(db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n);
check(before === after, 'deriving a statement writes no ledger entry', { before, after });
check(rec0.parties.length === 3, 'reconciliation covers every party with a balance', rec0.parties.length);
check(rec0.totals.parties_differing === 3, 'with an empty stored ledger every party differs (as expected)');

// Store a ledger that matches the modules for the customer only.
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit)
            VALUES (?, '2083-04-01', 'sale', ?, 'INV-1', 10000, 0)`).run(customer, s1);
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit)
            VALUES (?, '2083-04-05', 'payment_received', ?, 'receipt', 0, 4000)`).run(customer, r1);
const rec1 = ledger.reconcileWithStoredLedger(db);
const c = rec1.parties.find(p => p.party_id === customer);
check(near(c.difference, 1000), 'the 1,000 opening in parties but not in the stored ledger is reported as the gap', c && c.difference);
check(near(rec1.parties.find(p => p.party_id === supplier).difference, -5000), 'supplier gap is reported as −5,000');

// Store the opening the way the legacy import did (a ledger row), then the party
// must reconcile exactly — this is the BUG-019 decision in test form.
db.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit)
            VALUES (?, '2083-04-01', 'opening', 'Opening Balance', 1000, 0)`).run(customer);
const rec2 = ledger.reconcileWithStoredLedger(db);
const c2 = rec2.parties.find(p => p.party_id === customer);
check(near(c2.difference, 0), 'once the opening is represented in the ledger the party reconciles to 0', c2 && c2.difference);
check(rec2.totals.parties_matched === 1, 'exactly one party matches', rec2.totals.parties_matched);

console.log('\n4. A Collection row typed "Rent" is income, not a party receipt');
const sheet = [
    ['PRARAMBHA DAIRY — collection register'],
    ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'Remarks'],
    ['2083-04-10', '', '9001', 'RAM KIRANA', 'INV-1', 'Collection', 0, 5000, 0, 'Cash', -5000, 'bill settlement'],
    ['2083-04-11', '', '9002', 'TENANT SHOP', '', 'Rent', 0, 2500, 0, 'Cash', -2500, 'shop rent april'],
    ['2083-04-12', '', '9003', 'SANA KISAN', '', 'Advance', 0, 0, 1000, 'Cash', -1000, 'advance paid'],
    ['2083-04-13', '', '9004', 'PETTY CASH', '', 'Petty Cash', 0, 0, 300, 'Cash', -300, 'petty box']
];
const counter = () => ({
    payments: Number(db.prepare('SELECT COUNT(*) n FROM payments').get().n),
    income: Number(db.prepare("SELECT COUNT(*) n FROM other_expenses WHERE category = 'Income'").get().n),
    ledger: Number(db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n)
});
const c0 = counter();
const res1 = excelImport.importCollections(db, sheet, { log: () => {}, genLedger: true });
const c1 = counter();
check(res1.rent_income === 1, 'one rent row classified as income', res1);
check(c1.income - c0.income === 1, 'rent created exactly one other_expenses income row', c1.income - c0.income);
check(c1.payments - c0.payments === 2, 'only the receipt and the advance became payments (rent and petty did not)', c1.payments - c0.payments);
const incomeRow = db.prepare("SELECT * FROM other_expenses WHERE category = 'Income'").get();
check(incomeRow && near(incomeRow.amount, 2500), 'income row keeps the received amount (2,500)', incomeRow && incomeRow.amount);
check(incomeRow && incomeRow.date === '2083-04-11', 'income row keeps the BS date', incomeRow && incomeRow.date);
check(incomeRow && /rent/i.test(incomeRow.expense_head), 'income head names the rent', incomeRow && incomeRow.expense_head);
check(incomeRow && incomeRow.paid_to === 'TENANT SHOP', 'payer is preserved on the income row', incomeRow && incomeRow.paid_to);
const rentPayment = db.prepare("SELECT * FROM payments WHERE notes LIKE '%shop rent%'").get();
check(!rentPayment, 'rent did NOT become a customer receipt (no outstanding to a tenant)');
const tenant = db.prepare("SELECT * FROM parties WHERE name = 'TENANT SHOP'").get();
check(!tenant, 'rent did not even create a party record');

console.log('\n5. Re-import is idempotent');
const res2 = excelImport.importCollections(db, sheet, { log: () => {}, genLedger: true });
const c2run = counter();
check(c1.payments === c2run.payments, 'second run adds no payment', { first: c1.payments, second: c2run.payments });
check(c1.income === c2run.income, 'second run adds no income row', { first: c1.income, second: c2run.income });
check((res2.added || 0) === 0 && (res2.rent_income || 0) === 0, 'nothing reported as added on the second run', res2);

console.log('\n6. Party Ledger never invents bank, stock or cash rows');
check(Number(db.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n) === 0, 'no bank row from statements or collections');
check(Number(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n) === 0, 'no stock movement from the statement layer');

db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
