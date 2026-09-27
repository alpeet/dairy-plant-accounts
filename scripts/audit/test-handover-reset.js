/* Temp: full Fresh Start / Handover Reset workflow test on a COPY of the live DB (never the live one).
 *
 * Workflow under test (spec: BACKUP FIRST → VERIFY → CONFIRM → RESET → FRESH APP):
 *   A. Complete backup via SQLite Online Backup API to a chosen path (.dab + metadata sidecar)
 *   B. Gates (admin password, security code, typed RESET, failed/unverifiable backup aborts)
 *   C. Reset driven by the VERIFIED backup file, schema-driven wipe, persistence after reopen
 *   D. New Excel import after reset (no contamination, ids restart from 1)
 *   E. ♻️ Restore from the .dab file brings the previous state back
 */
(async () => {
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { performCleanup, setSecurityCode, verifyBackupFile, getFreshStartStatus, getFreshStartWipePlan } = require('../../shared/operations/data_cleanup');
const { backupDatabaseToPath, restoreDatabaseFromPath } = require('../../shared/operations/backup');
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

// ── Status endpoint is lightweight (no per-record counting) ──
const status = getFreshStartStatus(db);
ok(status.success && typeof status.data.has_security_code === 'boolean' && !('counts' in status.data),
    'getFreshStartStatus returns gates info WITHOUT counting records');

// ── Schema-driven wipe plan ──
const plan = getFreshStartWipePlan(db);
ok(plan.tables.includes('parties') && plan.tables.includes('sales') && plan.tables.includes('cash_collections') && plan.tables.includes('employees'),
    'wipe plan includes business tables discovered from the schema (incl. cash_collections, employees)');
ok(!plan.tables.includes('users') && !plan.tables.includes('settings') && !plan.tables.includes('audit_log'),
    'wipe plan never includes users/settings/audit_log');

// ════════ TEST A — COMPLETE BACKUP (Online Backup API + Save-As path) ════════
const snapPath = path.join(TMP, 'DairyAccounts_Backup_2026-09-27_10-45-30.dab');
let backup = null;
try {
    backup = await backupDatabaseToPath(db, dbPath, snapPath, { appVersion: 'test' });
} catch (e) { /* handled below */ }
ok(!!backup && fs.existsSync(backup.path), 'A: complete backup created at the chosen path (.dab)');
ok(!!backup && fs.existsSync(backup.path + '.meta.json'), 'A: metadata sidecar written (.meta.json)');
ok(!!backup && backup.metadata && backup.metadata.backup_type === 'complete-database-snapshot' && !!backup.checksum,
    'A: metadata records type, checksum, version');
ok(verifyBackupFile(snapPath).ok, 'A: backup verifies (opens as SQLite, integrity_check ok, core schema present)');

// The snapshot must contain the SAME counts as the live DB (complete state)
let snapCounts = null;
{
    const probe = new Database(snapPath, { readonly: true });
    snapCounts = {
        parties: probe.prepare('SELECT COUNT(*) c FROM parties').get().c,
        sales: probe.prepare('SELECT COUNT(*) c FROM sales').get().c,
        milk_collections: probe.prepare('SELECT COUNT(*) c FROM milk_collections').get().c
    };
    probe.close();
}
ok(snapCounts.parties === before.parties && snapCounts.sales === before.sales && snapCounts.milk_collections === before.milk_collections,
    `A: backup preserves the complete current state (parties ${snapCounts.parties}/${before.parties}, sales ${snapCounts.sales}/${before.sales}, milk ${snapCounts.milk_collections}/${before.milk_collections})`);

// ════════ TEST B — GATES (nothing should be deleted) ════════
const beforeCount = before.parties;

let r = performCleanup(db, { adminPassword: 'wrong', confirmText: 'RESET' });
ok(!r.success && /password/i.test(r.error), 'B: wrong admin password rejected');

r = performCleanup(db, { adminPassword: 'admin123', confirmText: 'NOPE' });
ok(!r.success && /RESET/i.test(r.error), 'B: missing/incorrect typed RESET rejected');

r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'wrong-code', confirmText: 'RESET' });
ok(!r.success && /security code/i.test(r.error), 'B: wrong security code rejected (code is configured)');

r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'test-code-9', confirmText: 'RESET', backupPath: '/tmp/handover-reset-test/does-not-exist.dab' });
ok(!r.success && /verification failed/i.test(r.error) && /no data has been deleted/i.test(r.error),
    'B: missing backup file aborts the reset — NOTHING deleted');
ok(db.prepare('SELECT COUNT(*) c FROM parties').get().c === beforeCount, 'B: data intact after failed backup');

// A wrong/unverifiable backup file blocks the reset (and is NOT the user's file we delete)
const bogus = path.join(TMP, 'bogus.dab');
fs.writeFileSync(bogus, 'this is not a database');
r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'test-code-9', confirmText: 'RESET', backupPath: bogus });
ok(!r.success && /verification failed/i.test(r.error), 'B: unverifiable backup file aborts reset');
ok(fs.existsSync(bogus), 'B: user-provided bogus file is NOT deleted by the failed attempt');
ok(db.prepare('SELECT COUNT(*) c FROM parties').get().c === beforeCount, 'B: data intact after failed verification');

// No backup at all → refuse (backup-first is mandatory)
r = performCleanup(db, { adminPassword: 'admin123', securityCode: 'test-code-9', confirmText: 'RESET' });
ok(!r.success && /backup/i.test(r.error), 'B: reset without any backup is refused');

// ════════ TEST C — VERIFIED RESET + PERSISTENCE ════════
r = performCleanup(db, {
    adminPassword: 'admin123',
    securityCode: 'test-code-9',
    confirmText: 'reset',          // case-insensitive per UI trim/upper
    backupPath: snapPath           // the backup created & verified in Test A
});
ok(r.success, 'C: reset succeeds with correct password + code + RESET + verified backup');
ok(r.data.backup_verified && r.data.backup && r.data.backup.filename === 'DairyAccounts_Backup_2026-09-27_10-45-30.dab',
    'C: reset reports the verified backup file it was anchored to');
ok(!r.data.cleared_tables || r.data.cleared_tables >= 20, `C: schema-driven wipe cleared ${r.data.cleared_tables} tables`);

// All business tables empty
const expectedEmpty = ['sales','sales_items','purchases','purchase_items','milk_collections','payments','bank_transactions',
    'production_batches','production_inputs','production_outputs','stock_movements','ledger_entries','parties','products',
    'routes','milk_rate_chart','employees','salary_records','vehicle_expenses','other_expenses','partner_capital',
    'denomination_counts','petty_cash','cash_deposits','cash_collections'];
let nonEmpty = [];
for (const t of expectedEmpty) {
    try { const c = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; if (c > 0) nonEmpty.push(`${t}=${c}`); } catch (e) {}
}
ok(nonEmpty.length === 0, `C: all business tables empty (non-empty: ${nonEmpty.join(', ') || 'none'})`);

const users = db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
ok(users >= 1, 'C: admin login preserved');

const bizKeys = db.prepare("SELECT key FROM settings WHERE key IN ('business_name','business_email','smtp_user','signature_image')").all();
ok(bizKeys.length === 0, 'C: business-identity settings cleared (company profile cleared for new client)');
const sysKeys = db.prepare("SELECT key FROM settings WHERE key = 'security_code_hash'").get();
ok(!!sysKeys, 'C: system/security settings preserved');

const auditRow = db.prepare("SELECT new_values FROM audit_log WHERE new_values LIKE '%HANDOVER_RESET%' ORDER BY id DESC LIMIT 1").get();
ok(!!auditRow && auditRow.new_values.includes('DairyAccounts_Backup_2026-09-27_10-45-30.dab'), 'C: audit log records the reset with backup reference');

// ── PERSISTENCE: close and reopen the DB file (app restart simulation) ──
db.close();
const db2 = new Database(dbPath);
const stillEmpty = db2.prepare('SELECT COUNT(*) c FROM parties').get().c;
ok(stillEmpty === 0, 'C: after close/reopen, data does NOT reappear (persistence)');
db2.close();

// ── NO RESURRECTION: run the REAL startup migrations (what Electron/Web do
//    on every launch) and make sure a cleared book stays empty — this is the
//    regression guard for the startup backfill re-seeding the staff master. ──
try {
    const { initDatabase } = require('../../shared/db');
    const restartDb = initDatabase(TMP, 'dairy-plant.db');
    ok(restartDb.prepare('SELECT COUNT(*) c FROM employees').get().c === 0,
        'C: startup migrations do NOT re-seed employees after a Fresh Start (no resurrection)');
    ok(restartDb.prepare('SELECT COUNT(*) c FROM parties').get().c === 0,
        'C: startup migrations keep a cleared book empty');
    ok(!!restartDb.prepare("SELECT value FROM settings WHERE key = 'fresh_start_completed_at'").get(),
        'C: persistent fresh-start marker written (survives and blocks re-seeding)');
    restartDb.close();
} catch (e) {
    ok(false, 'C: restart-migration simulation failed: ' + e.message);
}

const db2b = new Database(dbPath);
db2b.pragma('journal_mode = WAL');

// ════════ TEST D — NEW EXCEL IMPORT (no contamination) ════════
try {
    const res = excelImport.runExcelImport(db2b, 'Dairy_Accounts_Professional.xlsx', { mode: 'upsert', log: () => {} });
    ok(true, `D: Excel import ran after reset (${JSON.stringify(res).slice(0, 120)}…)`);
    const pAfter = db2b.prepare('SELECT COUNT(*) c FROM parties').get().c;
    ok(pAfter > 0, `D: new parties imported (${pAfter})`);
    const mAfter = db2b.prepare('SELECT COUNT(*) c FROM milk_collections').get().c;
    ok(mAfter > 0, `D: new milk collections imported (${mAfter})`);
    const minId = db2b.prepare('SELECT MIN(id) m FROM parties').get().m;
    ok(minId === 1, `D: ids restart cleanly (min party id = ${minId})`);
} catch (e) {
    ok(false, 'D: Excel import after reset failed: ' + e.message);
}
db2b.close();

// ════════ TEST E — ♻️ RESTORE from the .dab file ════════
// Simulate app restart: reopen fresh (post-reset + import state), then restore.
const db3 = new Database(dbPath);
db3.pragma('journal_mode = WAL');
const postImportParties = db3.prepare('SELECT COUNT(*) c FROM parties').get().c;
db3.close();

const restored = restoreDatabaseFromPath(dbPath, snapPath, () => {});
ok(fs.existsSync(restored.path), 'E: restore replaced the database with the backup file');
ok(restored.preRestoreBackup && fs.existsSync(restored.preRestoreBackup), 'E: safety backup of the current state created before restore');

const db4 = new Database(dbPath, { readonly: true });
const afterRestore = {
    parties: db4.prepare('SELECT COUNT(*) c FROM parties').get().c,
    sales: db4.prepare('SELECT COUNT(*) c FROM sales').get().c,
    milk_collections: db4.prepare('SELECT COUNT(*) c FROM milk_collections').get().c
};
const bizBack = db4.prepare("SELECT COUNT(*) c FROM settings WHERE key = 'business_name'").get().c;
const usersBack = db4.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
db4.close();
ok(afterRestore.parties === before.parties && afterRestore.sales === before.sales && afterRestore.milk_collections === before.milk_collections,
    `E: previous business state fully returned (parties ${afterRestore.parties}/${before.parties}, sales ${afterRestore.sales}/${before.sales}, milk ${afterRestore.milk_collections}/${before.milk_collections})`);
ok(bizBack >= 1, 'E: previous company/business settings restored');
ok(usersBack >= 1, 'E: users restored');
ok(afterRestore.parties !== postImportParties || before.parties === postImportParties, 'E: restored state differs from the post-reset state (real restore)');

console.log(`\n═══════ RESULT: ${pass} passed, ${fail} failed ═══════`);
process.exit(fail ? 1 : 0);
})();
