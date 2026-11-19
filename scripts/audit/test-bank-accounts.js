#!/usr/bin/env node
/**
 * test-bank-accounts.js — multi-bank accounts in the Bank Transactions module
 *
 * Proves, on throw-away databases:
 *   A. three bank accounts can be created, edited and deactivated, and an
 *      account with history cannot be deleted;
 *   B. deposits/withdrawals in each account keep INDEPENDENT running balances;
 *   C. filtering by one account hides every other account's transactions;
 *   D. "All Bank Accounts" shows every row with its bank and keeps per-account
 *      balances separate (never one combined balance);
 *   E. date-range filtering computes the period's own opening balance;
 *   F. an inter-bank transfer is two linked rows and never touches income or
 *      expense;
 *   G. no bank write creates or changes a row in another module;
 *   H. legacy transactions are migrated to accounts without being guessed at or
 *      modified, and unknown ones land in "Unassigned / Existing Bank" flagged
 *      for review;
 *   I. the Excel export reconciles with the statement.
 *
 * Never touches the live database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const bank = require(path.join(ROOT, 'shared', 'operations', 'bank'));
const fr = require(path.join(ROOT, 'shared', 'operations', 'financial_reports'));

let passed = 0, failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-acc-'));
const db = initDatabase(dir);
const OTHER_MODULES = ['petty_cash', 'other_expenses', 'payments', 'sales', 'purchases', 'ledger_entries', 'salary_records', 'stock_movements', 'cash_deposits'];
const snapshot = () => Object.fromEntries(OTHER_MODULES.map(t => {
    try { return [t, db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount), 0) t FROM ${t}`).get()]; }
    catch (e) { try { return [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get()]; } catch (e2) { return [t, 0]; } }
}));
const before = snapshot();

// ── A. Account management ─────────────────────────────────────────────────
console.log('\nA. Bank account management');
const a1 = bank.saveBankAccount(db, {
    bank_name: 'Nabil Bank', branch_name: 'Kalimati', account_holder: 'PRARAMBHA DAIRY',
    account_number: '0011223344', account_type: 'Current', opening_balance: 50000,
    opening_balance_date: '2083-04-01', remarks: 'main operations'
}).data;
const a2 = bank.saveBankAccount(db, {
    bank_name: 'NIC Asia', branch_name: 'Balkhu', account_number: '5566778899',
    account_type: 'Savings', opening_balance: 10000, opening_balance_date: '2083-04-01'
}).data;
const a3 = bank.saveBankAccount(db, {
    bank_name: 'Rastriya Banijya', account_number: '9988776655', account_type: 'Other', opening_balance: 0
}).data;
check(!!a1 && !!a2 && !!a3, 'three bank accounts created', [a1 && a1.id, a2 && a2.id, a3 && a3.id]);
check(bank.listBankAccounts(db).length === 3, 'all three are listed as Active', bank.listBankAccounts(db).length);
check(near(a1.current_balance, 50000), 'an account starts at its opening balance', a1.current_balance);

const dup = bank.saveBankAccount(db, { bank_name: 'Another Bank', account_number: '0011223344' });
check(dup.success === false, 'a duplicate account number is rejected', dup.error);

const edited = bank.saveBankAccount(db, { ...a3, bank_name: 'Rastriya Banijya Ltd', branch_name: 'Teku' });
check(edited.success && edited.data.bank_name === 'Rastriya Banijya Ltd', 'an account can be edited', edited.data && edited.data.bank_name);

// ── B. Deposits and withdrawals per account ───────────────────────────────
console.log('\nB. Independent running balances');
const add = (acct, date, ref, desc, debit, credit, cat) => bank.saveBankTransaction(db, {
    account_id: acct.id, date, reference_no: ref, description: desc,
    debit, credit, txn_category: cat, payment_mode: 'Bank'
});
const d1 = add(a1, '2083-04-05', 'NB-1', 'Customer deposit', 0, 20000, 'deposit');
const w1 = add(a1, '2083-04-10', 'NB-2', 'Supplier paid', 15000, 0, 'withdrawal');
const c1 = add(a1, '2083-04-15', 'NB-3', 'Bank charge', 500, 0, 'bank_charge');
const d2 = add(a2, '2083-04-06', 'NA-1', 'Cash deposited', 0, 30000, 'deposit');
const w2 = add(a2, '2083-04-20', 'NA-2', 'Diesel', 12000, 0, 'withdrawal');
const d3 = add(a3, '2083-04-07', 'RB-1', 'Interest', 0, 750, 'interest');

check([d1, w1, c1, d2, w2, d3].every(r => r.success), 'six transactions saved with an account', [d1.success, w2.success, d3.success]);
const noAcct = bank.saveBankTransaction(db, { date: '2083-04-09', description: 'no account', credit: 100 });
check(noAcct.success && db.prepare('SELECT account_review, (SELECT is_system FROM bank_accounts a WHERE a.id = b.account_id) sys FROM bank_transactions b WHERE id = ?').get(noAcct.data.id).sys === 1,
    'a row saved without an account is parked in Unassigned and flagged', noAcct.data && noAcct.data.account_id);
db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(noAcct.data.id);   // test fixture cleanup only

const s1 = bank.getBankStatement(db, { account_id: a1.id });
const s2 = bank.getBankStatement(db, { account_id: a2.id });
const s3 = bank.getBankStatement(db, { account_id: a3.id });
check(near(s1.opening_balance, 50000), 'Nabil opening balance is its own', s1.opening_balance);
check(near(s1.total_credit, 20000) && near(s1.total_debit, 15500), 'Nabil credits/debits are its own', [s1.total_credit, s1.total_debit]);
check(near(s1.closing_balance, 54500), 'Nabil closing = 50,000 + 20,000 − 15,000 − 500', s1.closing_balance);
check(near(s2.closing_balance, 28000), 'NIC Asia closing = 10,000 + 30,000 − 12,000', s2.closing_balance);
check(near(s3.closing_balance, 750), 'Rastriya closing = 0 + 750', s3.closing_balance);
check(near(s1.closing_balance, 54500) && near(s2.closing_balance, 28000), 'one account\'s transactions never move another\'s balance');
const runs = s1.entries.map(e => e.running_balance);
check(runs.length === 3 && near(runs[0], 70000) && near(runs[1], 55000) && near(runs[2], 54500), 'Nabil running balance is chronological', runs);

// ── C. Filtering one account hides the others ─────────────────────────────
console.log('\nC. One account hides the others');
check(s1.entries.every(e => Number(e.account_id) === Number(a1.id)), 'Nabil statement has only Nabil rows', s1.entries.length);
check(!s1.entries.some(e => String(e.reference_no || '').startsWith('NA-') || String(e.reference_no || '').startsWith('RB-')), 'no NIC Asia or Rastriya row leaks in');
const searchFiltered = bank.getBankStatement(db, { account_id: a1.id, search: 'NB-2' });
check(searchFiltered.entries.length === 1 && searchFiltered.entries[0].reference_no === 'NB-2', 'search by reference narrows the statement');
const catFiltered = bank.getBankStatement(db, { account_id: a1.id, txn_category: 'bank_charge' });
check(catFiltered.entries.length === 1 && near(catFiltered.total_debit, 500), 'transaction-type filter works');

// ── D. All bank accounts ──────────────────────────────────────────────────
console.log('\nD. All Bank Accounts');
const all = bank.getBankStatement(db, {});
check(all.mode === 'all' && all.entries.length === 6, 'every transaction is listed', all.entries.length);
check(all.entries.every(e => e.account_name), 'each row identifies its bank', all.entries.map(e => e.account_name));
check(new Set(all.entries.map(e => e.account_name)).size === 3, 'all three banks appear', [...new Set(all.entries.map(e => e.account_name))]);
check(near(all.total_credit, 20000 + 30000 + 750), 'deposits are totalled across accounts', all.total_credit);
check(near(all.total_debit, 15000 + 500 + 12000), 'withdrawals are totalled across accounts', all.total_debit);
check(all.closing_by_account.length === 3, 'balances stay per account', all.closing_by_account);
check(!all.accounts.some(a => 'combined' in a), 'no single combined bank balance is reported');
const byLabel = Object.fromEntries(all.closing_by_account.map(c => [c.label.split(' — ')[0], c.closing_balance]));
check(near(byLabel['Nabil Bank'], 54500) && near(byLabel['NIC Asia'], 28000) && near(byLabel['Rastriya Banijya Ltd'], 750),
    'per-account closing balances are correct', byLabel);

// ── E. Date range ─────────────────────────────────────────────────────────
console.log('\nE. Date-range filter');
const aprilEarly = bank.getBankStatement(db, { account_id: a1.id, from_date: '2083-04-11', to_date: '2083-04-31' });
check(near(aprilEarly.opening_balance, 55000), 'period opening = opening + earlier movements', aprilEarly.opening_balance);
check(near(aprilEarly.total_debit, 500) && near(aprilEarly.total_credit, 0), 'only in-range rows are counted', [aprilEarly.total_debit, aprilEarly.total_credit]);
check(near(aprilEarly.closing_balance, 54500), 'period closing balance', aprilEarly.closing_balance);
const empty = bank.getBankStatement(db, { account_id: a1.id, from_date: '2083-05-01', to_date: '2083-05-31' });
check(empty.entries.length === 0 && near(empty.closing_balance, 54500), 'an empty period carries the balance forward', empty.closing_balance);

// ── F. Inter-bank transfer ────────────────────────────────────────────────
console.log('\nF. Inter-bank transfer is never income or expense');
const pnlBefore = fr.getProfitLoss(db, { from_date: '2083-04-01', to_date: '2083-04-31' });
const tr = bank.saveBankTransfer(db, {
    from_account_id: a1.id, to_account_id: a2.id, date: '2083-04-25',
    amount: 7000, reference_no: 'TR-1', remarks: 'move funds'
});
check(tr.success && tr.transfer_group, 'transfer created', tr.error);
const pair = db.prepare('SELECT * FROM bank_transactions WHERE transfer_group = ? ORDER BY id').all(tr.transfer_group);
check(pair.length === 2, 'exactly two linked rows', pair.length);
check(pair.some(r => r.txn_category === 'transfer_out' && near(r.debit, 7000)) && pair.some(r => r.txn_category === 'transfer_in' && near(r.credit, 7000)),
    'one debit from the source and one credit to the destination', pair.map(r => [r.txn_category, r.debit, r.credit]));
check(Number(pair[0].account_id) === Number(a1.id) && Number(pair[1].account_id) === Number(a2.id), 'each leg belongs to its own account');
check(near(bank.getBankStatement(db, { account_id: a1.id }).closing_balance, 47500)
    && near(bank.getBankStatement(db, { account_id: a2.id }).closing_balance, 35000),
    'both account balances move by the transfer amount', [bank.getBankStatement(db, { account_id: a1.id }).closing_balance, bank.getBankStatement(db, { account_id: a2.id }).closing_balance]);
const pnlAfter = fr.getProfitLoss(db, { from_date: '2083-04-01', to_date: '2083-04-31' });
check(near(pnlAfter.income.total_income, pnlBefore.income.total_income)
    && near(pnlAfter.expenses.total_expenses, pnlBefore.expenses.total_expenses)
    && near(pnlAfter.net_profit, pnlBefore.net_profit),
    'the transfer changes neither income, expenses nor net profit',
    { before: pnlBefore.net_profit, after: pnlAfter.net_profit });
const sameAcct = bank.saveBankTransfer(db, { from_account_id: a1.id, to_account_id: a1.id, date: '2083-04-25', amount: 100 });
check(sameAcct.success === false, 'a transfer to the same account is refused', sameAcct.error);

// ── G. Independence from every other module ───────────────────────────────
console.log('\nG. No other module is touched');
const after = snapshot();
check(OTHER_MODULES.every(t => JSON.stringify(after[t]) === JSON.stringify(before[t])),
    'no bank write created or changed a row in another module', { before, after });
check(db.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE transfer_group != ''").get().n === 2, 'only the transfer legs are linked, nothing duplicated');

// ── H. Reconciliation ─────────────────────────────────────────────────────
console.log('\nH. Reconciliation marks, never edits');
const reconRow = db.prepare('SELECT * FROM bank_transactions WHERE reference_no = ?').get('NB-2');
const rec = bank.reconcileBank(db, { ids: [reconRow.id], status: 'reconciled', remarks: 'matched 30/04', recon_date: '2083-04-30' });
const reconAfter = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(reconRow.id);
check(rec.success && rec.updated === 1, 'one row reconciled', rec);
check(reconAfter.recon_status === 'reconciled' && reconAfter.recon_remarks === 'matched 30/04', 'status and remarks saved', reconAfter.recon_status);
check(near(reconAfter.debit, reconRow.debit) && reconAfter.date === reconRow.date && reconAfter.description === reconRow.description,
    'amount, date and particulars are unchanged by reconciliation');
const periodRec = bank.reconcileBank(db, { account_id: a2.id, status: 'reconciled', remarks: 'April statement' });
check(periodRec.success && periodRec.updated >= 3, 'a whole account/period can be reconciled at once', periodRec.updated);

// ── I. Excel export ───────────────────────────────────────────────────────
console.log('\nI. Excel export reconciles with the screen');
const { buildBankStatementWorkbook } = require(path.join(ROOT, 'shared', 'export-bank-statement'));
const oneBook = buildBankStatementWorkbook(db, { account_id: a1.id });
const oneSheet = oneBook.workbook.Sheets[oneBook.workbook.SheetNames[0]];
const flat = require('xlsx').utils.sheet_to_json(oneSheet, { header: 1, defval: '' });
const closingRow = flat.reverse().find(r => String(r[0]).startsWith('Closing Balance'));
check(!!closingRow && near(closingRow[6], bank.getBankStatement(db, { account_id: a1.id }).closing_balance),
    'the account sheet closes at the same balance as the screen', closingRow && closingRow[6]);
const allBook = buildBankStatementWorkbook(db, {});
check(allBook.workbook.SheetNames.includes('All_Banks'), 'consolidated sheet is included', allBook.workbook.SheetNames);
check(allBook.workbook.SheetNames.length === 1 + all.closing_by_account.length,
    'All_Banks plus one sheet per account with activity', { sheets: allBook.workbook.SheetNames, accounts: all.closing_by_account.length });
check(!allBook.workbook.SheetNames.some(n => n.toLowerCase().includes('unassigned')),
    'an empty review bucket is not printed as a blank account sheet', allBook.workbook.SheetNames);

// ── J. Legacy migration ───────────────────────────────────────────────────
console.log('\nJ. Legacy transactions migrate without being guessed at');
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-mig-'));
const db2 = initDatabase(dir2);
const legacy = db2.prepare(`INSERT INTO bank_transactions (date, reference_no, description, debit, credit, amount, bank_account, txn_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
// The workbook order: classification in bank_account, real bank in txn_type.
legacy.run('2083-03-27', 'L-1', 'old receipt', 0, 5000, 5000, 'Customer Collection', 'Sushil QR');
legacy.run('2083-03-28', 'L-2', 'old payment', 1200, 0, 1200, 'Supplier Payment', 'PRARAMBHA');
// The app's old form order: bank in bank_account, type in txn_type.
legacy.run('2083-03-29', 'L-3', 'old app row', 300, 0, 300, 'Sushil QR', 'Customer Collection');
// Nothing anywhere: must NOT be guessed.
legacy.run('2083-03-30', 'L-4', 'mystery row', 0, 900, 900, '', '');
const snapshotRows = JSON.stringify(db2.prepare('SELECT date, reference_no, description, debit, credit, amount, bank_account, txn_type FROM bank_transactions ORDER BY id').all());

bank.ensureBankTable(db2);
const accounts2 = bank.listBankAccounts(db2, { include_inactive: true });
const names2 = accounts2.map(a => a.bank_name).sort();
check(names2.includes('Sushil QR') && names2.includes('PRARAMBHA'), 'the two real banks named on the rows become accounts', names2);
check(names2.includes('Unassigned / Existing Bank'), 'the review bucket exists', names2);
check(!names2.includes('Customer Collection') && !names2.includes('Supplier Payment'),
    'a classification is never mistaken for a bank', names2);
const migrated = db2.prepare('SELECT b.*, a.bank_name FROM bank_transactions b LEFT JOIN bank_accounts a ON a.id = b.account_id ORDER BY b.id').all();
check(migrated.every(r => r.account_id), 'every legacy row has an account', migrated.map(r => r.account_id));
check(migrated[0].bank_name === 'Sushil QR' && migrated[1].bank_name === 'PRARAMBHA', 'workbook-order rows keep their real bank', migrated.map(r => r.bank_name));
check(migrated[2].bank_name === 'Sushil QR', 'app-order rows keep their real bank too', migrated[2].bank_name);
check(migrated[3].bank_name === 'Unassigned / Existing Bank' && Number(migrated[3].account_review) === 1,
    'a row with no bank is flagged for manual review, not assigned by guess', migrated[3].bank_name);
check(JSON.stringify(db2.prepare('SELECT date, reference_no, description, debit, credit, amount, bank_account, txn_type FROM bank_transactions ORDER BY id').all()) === snapshotRows,
    'every legacy amount, date and text is byte-identical after migration');
const migCount = db2.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n;
bank.ensureBankTable(db2);
check(db2.prepare('SELECT COUNT(*) n FROM bank_transactions').get().n === migCount
    && bank.listBankAccounts(db2, { include_inactive: true }).length === accounts2.length,
    're-running the migration creates nothing new (idempotent)');
check(db2.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE txn_category = ''").get().n === 0,
    'every legacy row gained a transaction type', db2.prepare("SELECT COUNT(*) n FROM bank_transactions WHERE txn_category = ''").get().n);
check(near(bank.getBankStatement(db2, { account_id: accounts2.find(a => a.bank_name === 'Sushil QR').id }).closing_balance, 5000 - 300),
    'the migrated statement adds up (5,000 − 300)', bank.getBankStatement(db2, { account_id: accounts2.find(a => a.bank_name === 'Sushil QR').id }).closing_balance);

// ── K. Deactivation and delete protection ─────────────────────────────────
console.log('\nK. Deactivate instead of delete');
const del = bank.deleteBankAccount(db, a1.id);
check(del.success === false && del.used > 0, 'an account with history cannot be deleted', del.error);
const off = bank.setBankAccountStatus(db, a2.id, 'Inactive');
check(off.success && off.data.status === 'Inactive', 'an account can be deactivated', off.data && off.data.status);
check(!bank.listBankAccounts(db).some(a => a.id === a2.id), 'an inactive account is hidden from the selector');
check(bank.listBankAccounts(db, { include_inactive: true }).some(a => a.id === a2.id), 'but its history stays available');
check(db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE account_id = ?').get(a2.id).n === 3,
    'deactivation deleted no transaction', db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE account_id = ?').get(a2.id).n);

db.close();
fs.rmSync(dir, { recursive: true, force: true });
try { db2.close(); fs.rmSync(dir2, { recursive: true, force: true }); } catch (e) { }

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
