/**
 * Trust & Audit pack acceptance tests.
 * ===================================
 * Verifies Release-1 items 1–7 on a FRESH database (no live data touched):
 *
 *   1. getTodaySummary uses BS "today" (matches BS-stored business dates)
 *   2. Audit query: BS date filter converts to the AD changed_at range;
 *      rows always carry `username`; secrets are redacted
 *   3. New audit coverage: bank_transactions, cash_collections, cash_deposits,
 *      farmer bulk payments, settings changes all leave audit rows
 *   4. bsToAD round-trips adToBS (dates after the anchor)
 *   5. Password policy: MIN_PASSWORD_LENGTH = 8 enforced in shared/auth.js
 *   6. Invoice templates no longer contain a hard-coded PAN
 *
 * Usage: node scripts/audit/test-trust-pack.js
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const auth = require(path.join(ROOT, 'shared', 'auth.js'));
const { adToBS, bsToAD } = require(path.join(ROOT, 'shared', 'excel-import.js'));

const TMP = '/tmp/trust-pack-test';
let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
    console.log(`${cond ? '✅ PASS' : '❌ FAIL'} — ${name}${!cond && detail !== undefined ? `   [got ${JSON.stringify(detail)}]` : ''}`);
    cond ? pass++ : fail++;
};
// Local calendar date (the renderer and audit timestamps both run on local
// time — UTC-based "today" would disagree with them around midnight).
const todayADLocal = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const todayBS = () => adToBS(todayADLocal());

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const db = initDatabase(TMP, 'trust.db');
db.pragma('foreign_keys = OFF');

// Seed a user so changed_by resolves to a real username
db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('tester', 'x:y', 'admin')").run();
const uid = db.prepare("SELECT id FROM users WHERE username = 'tester'").get().id;

// ── Test 0: bsToAD ↔ adToBS round-trip ───────────────────────────────────────
console.log('\n=== bsToAD round-trip ===');
{
    const cases = ['2025-04-14', '2026-09-28', '2026-06-29', '2026-01-15'];
    let allOk = true;
    for (const c of cases) {
        const bs = adToBS(c);
        const back = bsToAD(bs);
        if (back !== c) { allOk = false; console.log(`   ${c} → ${bs} → ${back}`); }
    }
    ok(allOk, 'bsToAD(adToBS(d)) === d for post-anchor dates');
    ok(bsToAD('2082-01-01') === '2025-04-14', 'bsToAD anchor: BS 2082-01-01 = AD 2025-04-14', bsToAD('2082-01-01'));
    ok(bsToAD('2083-06-12') === '2026-09-28', 'bsToAD(BS today) = AD today', bsToAD('2083-06-12'));
}

// ── Test 1: dashboard Today summary uses BS dates ────────────────────────────
console.log('\n=== getTodaySummary BS dates ===');
{
    const pid = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('PC Cust', 'customer')").run().lastInsertRowid);
    const today = todayBS();
    ops.savePettyCash(db, { voucher_no: 'PV-T1', date: today, expense_head: 'Test', amount: 250, description: 'petty' }, null);
    ops.saveOtherExpense(db, { date: today, category: 'Utilities', expense_head: 'Electricity', amount: 400, description: 'power' }, null);
    const t = ops.getTodaySummary(db);
    ok(t.todayPettyCash.total === 250, 'Today Petty Cash shows the BS-today amount', t.todayPettyCash);
    ok(t.todayExpenses.total === 400, 'Today Expenses shows the BS-today amount', t.todayExpenses);
    ok(t.todayVehicleExpenses.total === 0, 'Vehicle sub-value present and correct', t.todayVehicleExpenses);
}

// ── Test 2+3: audit coverage + query semantics ───────────────────────────────
console.log('\n=== audit coverage & query ===');
{
    // Bank create/update/delete
    const b = ops.saveBankTransaction(db, {
        date: todayBS(), reference_no: 'TR-1', counterparty_name: 'Someone Pvt Ltd',
        description: 'customer payment via QR', credit: 5000, bank_account: 'NIC ASIA'
    }, uid);
    ok(b.success, 'saveBankTransaction succeeds', b);
    const bId = b.data.id;
    ops.saveBankTransaction(db, { ...b.data, amount: undefined, debit: 0, credit: 6500 }, uid);
    ops.deleteBankTransaction(db, bId, uid);

    // Cash collection
    const c = ops.saveCashCollection(db, {
        date: todayBS(), cash_sales: 1200, cash_receipts: 300, cash_payments: 0,
        other_receipts: 0, payment_mode: 'cash', ref_no: 'CC-1'
    }, uid);
    ok(c && c.id, 'saveCashCollection succeeds', c);
    ops.deleteCashCollection(db, c.id, uid);

    // Cash deposit
    const d = ops.saveCashDeposit(db, {
        date: todayBS(), bank_name: 'NIC Asia', branch: 'Bidur', account_no: '123',
        amount: 2000, cash_source: 'sales', deposit_mode: 'cash', reference_no: 'DEP-1',
        deposited_by: 'tester', created_by: uid
    }, uid);
    ok(d && d.id, 'saveCashDeposit succeeds', d);
    ops.deleteCashDeposit(db, d.id, uid);

    // Farmer bulk payment
    const fid = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Test Dairy Farmer', 'supplier')").run().lastInsertRowid);
    const mc = Number(db.prepare(
        "INSERT INTO milk_collections (party_id, date, collection_no, shift, quantity_liters, fat_percent, snf_percent, rate, amount, status) VALUES (?, ?, 'MC-T1', 'morning', 10, 4.0, 8.5, 50, 500, 'pending')"
    ).run(fid, todayBS()).lastInsertRowid);
    const bulk = ops.bulkPayFarmers(db, {
        payments: [{ party_id: fid, amount: 500, collection_ids: [mc] }],
        date: todayBS(), mode: 'cash', notes: 'cycle 1'
    }, uid);
    ok(Array.isArray(bulk) && bulk.length === 1, 'bulkPayFarmers succeeds', bulk);

    // Settings
    ops.saveSettings(db, { business_name: 'Trust Test Dairy', admin_password: 'super-secret-value' }, uid);

    // ── Query semantics ──
    const all = ops.getAuditLogs(db, {});
    ok(all.length >= 7, 'audit rows exist for bank/cash/deposit/farmer/settings', all.length);

    const tables = [...new Set(all.map(r => r.table_name))];
    for (const t of ['bank_transactions', 'cash_collections', 'cash_deposits', 'payments', 'settings']) {
        ok(tables.includes(t), `audit rows written for ${t}`, tables);
    }

    // Username mapping (renderer reads log.username)
    ok(all.every(r => 'username' in r), 'every audit row carries username');
    ok(all.some(r => r.username === 'tester'), 'username resolves to the acting user', all.map(r => r.username));

    // BS date filter matches rows whose changed_at is AD
    const bsFrom = todayBS();
    const filtered = ops.getAuditLogs(db, { from_date: bsFrom, to_date: bsFrom });
    ok(filtered.length >= 7, 'BS same-day filter returns rows (BS→AD conversion works)', filtered.length);
    // An impossible BS range (far future) returns nothing
    const none = ops.getAuditLogs(db, { from_date: '2090-01-01', to_date: '2090-01-02' });
    ok(none.length === 0, 'BS filter excludes rows outside the range', none.length);

    // Secret redaction: settings audit must not contain the secret value
    const setRows = all.filter(r => r.table_name === 'settings');
    const leaked = setRows.some(r => JSON.stringify([r.old_values, r.new_values]).includes('super-secret-value'));
    ok(!leaked, 'password-like settings values are redacted in the audit trail');
}

// ── Test 5: password policy ──────────────────────────────────────────────────
console.log('\n=== password policy ===');
{
    ok(auth.MIN_PASSWORD_LENGTH === 8, 'MIN_PASSWORD_LENGTH is 8', auth.MIN_PASSWORD_LENGTH);
    const short = auth.createUser(db, { username: 'shorty', password: 'abc12', role: 'operator' });
    ok(!short.success, 'createUser rejects passwords shorter than 8', short);
    const good = auth.createUser(db, { username: 'goodone', password: 'longenough1', role: 'operator' });
    ok(good.success, 'createUser accepts an 8+ char password', good);
}

// ── Test 6: no hard-coded PAN in invoice templates ──────────────────────────
console.log('\n=== invoice PAN ===');
{
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'invoice_generator.js'), 'utf8');
    ok(!src.includes('152747352'), 'invoice_generator.js has no hard-coded PAN');
    ok(src.includes("settings.business_pan"), 'invoice reads the configured business PAN');
}

db.close();

console.log('\n══════════════════════════════════════════');
console.log(` RESULT: ${pass} passed, ${fail} failed`);
console.log('══════════════════════════════════════════');
process.exit(fail === 0 ? 0 : 1);
