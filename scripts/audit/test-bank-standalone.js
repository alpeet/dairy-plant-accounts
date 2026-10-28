#!/usr/bin/env node
/** Standalone Bank Transactions — no cross-module side effects. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const bank = require(path.join(ROOT, 'shared', 'operations', 'bank'));
let pass = 0, fail = 0;
function check(condition, label, detail) {
    if (condition) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.error('  ❌ ' + label + (detail === undefined ? '' : ` — ${JSON.stringify(detail)}`)); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-standalone-'));
const db = initDatabase(dir, 'test.db');
bank.ensureBankTable(db);
const counts = () => Object.fromEntries(['ledger_entries','payments','petty_cash','other_expenses','cash_deposits','stock_movements'].map(t => [t, Number(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n)]));
const base = counts();
const saved = bank.saveBankTransaction(db, { date:'2083-07-01', reference_no:'ST-1', counterparty_name:'Supplier', description:'Diesel', debit:700, credit:0, payment_mode:'Bank', party_id:1, match_status:'auto' });
check(saved.success && saved.data.party_id === null && saved.data.ledger_posted === 0, 'create stores only standalone bank row', saved);
check(JSON.stringify(counts()) === JSON.stringify(base), 'create leaves all other module counts unchanged', counts());
const edit = bank.saveBankTransaction(db, { ...saved.data, description:'Diesel corrected', debit:800, party_id:1, match_status:'auto' });
check(edit.success && edit.data.description === 'Diesel corrected' && edit.data.party_id === null, 'edit remains standalone');
check(JSON.stringify(counts()) === JSON.stringify(base), 'edit leaves all other module counts unchanged', counts());
const imported = bank.importBankRows(db, [{ date:'2083-07-02', reference_no:'ST-2', counterparty_name:'Supplier', description:'Cash deposit', debit:0, credit:500, txn_type:'Bank Deposit (own)' }]);
check(imported.inserted === 1, 'bank import inserts a bank-only record', imported);
check(JSON.stringify(counts()) === JSON.stringify(base), 'import leaves all other module counts unchanged', counts());
const cls = bank.setBankAccountingClass(db, saved.data.id, 'expense');
check(cls.success && cls.data.party_id === null && cls.data.ledger_posted === 0, 'classification is descriptive only');
const post = bank.postBankToLedger(db, saved.data.id);
check(post.success && post.posted === false && post.reason === 'standalone_register', 'legacy posting API is no-op', post);
const match = bank.setBankMatch(db, saved.data.id, { party_id:1, match_status:'auto', post:true });
check(!match.success, 'legacy match/post API rejects linking');
const del = bank.deleteBankTransaction(db, saved.data.id);
check(del.success && bank.getBankTransaction(db, saved.data.id) === undefined, 'delete removes only its bank row');
check(JSON.stringify(counts()) === JSON.stringify(base), 'delete leaves all other module counts unchanged', counts());
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
db.close();
fs.rmSync(dir, { recursive:true, force:true });
process.exit(fail ? 1 : 0);
