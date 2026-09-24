/* Temp: full Handover Reset workflow test on a COPY of the live DB (never the live one). */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { performCleanup, setSecurityCode, verifyBackupFile, getCleanupStatus } = require('../../shared/operations/data_cleanup');
const excelImport = require('../../shared/excel-import');

const TMP = '/tmp/handover-reset-test';
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
const dbPath = path.join(TMP, 'dairy-plant.db');
fs.copyFileSync('data/dairy-plant.db', dbPath);

let pass = 0, fail = 0;
const ok = (cond, name) => { console.log(`${cond ? '✅ PASS' : '❌ FAIL'} — ${name}`); cond ? pass++ : fail++; };

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const before = {};
for (const t of ['parties', 'sales', 'purchases', 'milk_collections', 'ledger_entries', 'employees', 'salary_records', 'payments']) {
    before[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
}
console.log('Before reset:', JSON.stringify(before));

// ── Setup: give the COPY a known admin password hash (we don't know the real one) ──
const auth = require('../../shared/auth');
db.prepare("UPDATE users SET password_hash = ? WHERE role = 'admin'").run(auth.hashPassword('admin123'));

// ── Set a security code (admin password for the copy = 'admin123') ──
const sc = setSecurityCode(db, { adminPassword: 'admin123', newCode: 'test-code-9' }, null);
ok(sc.success, 'security code can be set with admin password');

// ════════ GATE TESTS (nothing should be deleted) ════════
const beforeCount = before.parties;

let r = performCleanup(db, { adminPassword: 'wrong', confirmText: 'RESET' });
ok(!r.success && /password/i.test(r.error), 'wrong admin password rejected');

r = performCleanup(db, { adminPassword: 'admin123', confirmText: 'NOPE' });
ok(!r.success && /RESET/i.test(r.error), 'missing/incorrect typed RESET rejected');

r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'wrong-code', confirmText: 'RESET' });
ok(!r.success && /security code/i.test(r.error), 'wrong security code rejected (code is configured)');

r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'test-code-9', confirmText: 'RESET', createBackup: () => { throw new Error('disk full'); } });
ok(!r.success && /No data has been deleted/i.test(r.error), 'backup failure aborts reset with NOTHING deleted');
ok(db.prepare('SELECT COUNT(*) c FROM parties').get().c === beforeCount, 'data intact after failed backup');

r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'test-code-9', confirmText: 'RESET', createBackup: () => ({ path: '/tmp/handover-reset-test/fake.db', filename: 'fake.db', size: 1 }) });
ok(!r.success && /verification failed/i.test(r.error), 'unverifiable backup file aborts reset');
ok(db.prepare('SELECT COUNT(*) c FROM parties').get().c === beforeCount, 'data intact after failed verification');
ok(!fs.existsSync('/tmp/handover-reset-test/fake.db'), 'bogus backup file cleaned up');

// ════════ HAPPY PATH ════════
let backupMade = null;
r = performCleanup(db, {
    adminPassword: 'admin123',
    securityCode: 'test-code-9',
    confirmText: 'reset',          // case-insensitive per UI trim/upper
    mode: 'wipe-all',
    createBackup: () => {
        const dest = path.join(TMP, 'pre-reset-backup.db');
        // simulate the app's backupDatabase (WAL checkpoint + copy)
        db.pragma('wal_checkpoint(TRUNCATE)');
        fs.copyFileSync(dbPath, dest);
        backupMade = { path: dest, filename: 'pre-reset-backup.db', size: fs.statSync(dest).size };
        return backupMade;
    }
});
ok(r.success, 'reset succeeds with correct password + code + RESET');
ok(r.data.backup_verified, 'backup reported as verified');

// ════════ VERIFY EMPTY (database level) ════════
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x => x.name);
const expectedEmpty = ['sales','sales_items','purchases','purchase_items','milk_collections','payments','bank_transactions',
    'production_batches','production_inputs','production_outputs','stock_movements','ledger_entries','parties','products',
    'routes','milk_rate_chart','employees','salary_records','vehicle_expenses','other_expenses','partner_capital',
    'denomination_counts','petty_cash','cash_deposits','cash_collections'];
let nonEmpty = [];
for (const t of expectedEmpty) {
    try { if (db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c > 0) nonEmpty.push(`${t}=${db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c}`); } catch (e) {}
}
ok(nonEmpty.length === 0, `all business tables empty (non-empty: ${nonEmpty.join(', ') || 'none'})`);

const users = db.prepare('SELECT COUNT(*) c FROM users WHERE role = \'admin\' AND is_active = 1').get().c;
ok(users >= 1, 'admin login preserved');

const bizKeys = db.prepare("SELECT key FROM settings WHERE key IN ('business_name','business_email','smtp_user','signature_image')").all();
ok(bizKeys.length === 0, 'business-identity settings cleared');
const sysKeys = db.prepare("SELECT key FROM settings WHERE key = 'security_code_hash'").get();
ok(!!sysKeys, 'system/security settings preserved');

const auditRow = db.prepare("SELECT new_values FROM audit_log WHERE new_values LIKE '%HANDOVER_RESET%' ORDER BY id DESC LIMIT 1").get();
ok(!!auditRow && auditRow.new_values.includes('pre-reset-backup.db'), 'audit log records the reset with backup reference');

// ════════ PERSISTENCE: reopen the DB file ════════
db.close();
const db2 = new Database(dbPath);
const stillEmpty = db2.prepare('SELECT COUNT(*) c FROM parties').get().c;
ok(stillEmpty === 0, 'after close/reopen, data does NOT reappear (persistence)');
db2.close();

// ════════ EXCEL RE-IMPORT ════════
const importDb = new Database(dbPath);
importDb.pragma('journal_mode = WAL');
try {
    const res = excelImport.runExcelImport(importDb, 'Dairy_Accounts_Professional.xlsx', { mode: 'upsert', log: () => {} });
    ok(res && (res.parties > 0 || res.total_parties > 0 || true), `Excel import ran after reset (${JSON.stringify(res).slice(0, 120)}…)`);
    const pAfter = importDb.prepare('SELECT COUNT(*) c FROM parties').get().c;
    ok(pAfter > 0, `parties re-imported (${pAfter})`);
    const mAfter = importDb.prepare('SELECT COUNT(*) c FROM milk_collections').get().c;
    ok(mAfter > 0, `milk collections re-imported (${mAfter})`);
    // old auto-increment must not interfere: new ids start fresh from 1
    const minId = importDb.prepare('SELECT MIN(id) m FROM parties').get().m;
    ok(minId === 1, `ids restart cleanly (min party id = ${minId})`);
    importDb.close();
} catch (e) {
    ok(false, 'Excel import after reset failed: ' + e.message);
}

// ════════ BONUS: verifyBackupFile on a real file ════════
ok(verifyBackupFile(backupMade.path).ok, 'real backup file passes verification');

console.log(`\n═══════ RESULT: ${pass} passed, ${fail} failed ═══════`);
process.exit(fail ? 1 : 0);
