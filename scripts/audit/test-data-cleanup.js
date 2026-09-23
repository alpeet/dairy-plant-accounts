#!/usr/bin/env node
/**
 * scripts/audit/test-data-cleanup.js
 * ==================================
 * Rehearses the Data Cleanup (factory reset) flow against a THROWAWAY COPY of
 * the database — never the live file. Covers: gates, lockout, both modes,
 * preserved tables, backup creation, sequence reset and the audit record.
 *
 * Usage: node scripts/audit/test-data-cleanup.js [adminPassword]
 * (default password: trial1check2026 — the audit user present in dev DBs)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const srcDb = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'dairy-plant.db');
const ADMIN_PW = process.argv[2] || 'trial1check2026';

// ── Make a throwaway copy ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-test-'));
const testDb = path.join(tmp, 'dairy-plant.db');
fs.copyFileSync(srcDb, testDb);
for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(srcDb + ext)) fs.copyFileSync(srcDb + ext, testDb + ext);
}

const db = new Database(testDb);
const cleanup = require(path.join(__dirname, '..', '..', 'shared', 'operations', 'data_cleanup'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}
const count = t => { try { return db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch (e) { return -1; } };

console.log(`\nRehearsing on copy: ${testDb}\n`);

// ── 1. Without a security code, cleanup must refuse ──
console.log('1 · Refuses without a security code');
let r = cleanup.performCleanup(db, { adminPassword: ADMIN_PW, securityCode: '0000' });
check('error is NO_SECURITY_CODE', r.success === false && r.code === 'NO_SECURITY_CODE', JSON.stringify(r));
check('sales untouched', count('sales') > 0);

// ── 2. Set the security code ──
console.log('2 · Set security code');
r = cleanup.setSecurityCode(db, { adminPassword: ADMIN_PW, newCode: '12' });
check('short code rejected', r.success === false && /4 characters/.test(r.error));
r = cleanup.setSecurityCode(db, { adminPassword: 'wrong-password', newCode: '2468' });
check('wrong admin password rejected', r.success === false && /Admin password/.test(r.error));
r = cleanup.setSecurityCode(db, { adminPassword: ADMIN_PW, newCode: '2468' });
check('code set', r.success === true, JSON.stringify(r));
check('hash stored', !!db.prepare("SELECT value FROM settings WHERE key='security_code_hash'").get());

// ── 3. Lockout after 5 wrong codes ──
console.log('3 · Lockout after 5 wrong codes');
let locked = null, lastMsg = '';
for (let i = 1; i <= 5; i++) {
    r = cleanup.performCleanup(db, { adminPassword: ADMIN_PW, securityCode: 'bad-' + i });
    lastMsg = r.error;
    if (i < 5) check(`wrong attempt ${i}: remaining shown`, /attempt/.test(r.error || ''));
}
check('locked after 5th wrong code', /locked/.test(lastMsg), lastMsg);
r = cleanup.performCleanup(db, { adminPassword: ADMIN_PW, securityCode: '2468' });
check('even the right code refused while locked', r.success === false && /locked/.test(r.error));

// ── 4. Unlock manually, then wrong admin password ──
console.log('4 · Wrong admin password');
db.prepare("DELETE FROM settings WHERE key IN ('security_code_locked_until','security_code_attempts')").run();
const salesBefore = count('sales');
r = cleanup.performCleanup(db, { adminPassword: 'not-my-password', securityCode: '2468' });
check('wrong admin password rejected', r.success === false && /Admin password/.test(r.error));
check('sales untouched', count('sales') === salesBefore);

// ── 5. keep-masters mode ──
console.log('5 · keep-masters cleanup');
r = cleanup.performCleanup(db, {
    adminPassword: ADMIN_PW, securityCode: '2468', mode: 'keep-masters',
    createBackup: () => ({ filename: 'test-backup.db', size: 1 })
});
check('succeeded', r.success === true, JSON.stringify(r.error || ''));
check('sales cleared', count('sales') === 0);
check('ledger cleared', count('ledger_entries') === 0);
check('parties KEPT', count('parties') > 0);
check('products KEPT', count('products') > 0);
check('users kept', count('users') > 0);
check('audit log kept', count('audit_log') > 0);
check('cleanup recorded in audit log',
    !!db.prepare("SELECT id FROM audit_log WHERE new_values LIKE '%DATA_CLEANUP%' AND new_values LIKE '%keep-masters%'").get());

// ── 6. sqlite_sequence reset ──
console.log('6 · Sequence reset');
let seqHasSales = false;
try {
    seqHasSales = !!db.prepare("SELECT name FROM sqlite_sequence WHERE name='sales'").get();
} catch (e) { /* table absent = nothing to reset */ }
check('sales sequence reset', !seqHasSales);

// ── 7. wipe-all mode (idempotent) ──
console.log('7 · wipe-all cleanup (run twice)');
for (let i = 1; i <= 2; i++) {
    r = cleanup.performCleanup(db, { adminPassword: ADMIN_PW, securityCode: '2468', mode: 'wipe-all' });
    check(`run ${i} succeeded`, r.success === true, JSON.stringify(r.error || ''));
}
check('parties cleared', count('parties') === 0);
check('products cleared', count('products') === 0);
check('settings kept (security code still set)',
    !!db.prepare("SELECT value FROM settings WHERE key='security_code_hash'").get());
check('status: has_security_code true', cleanup.getCleanupStatus(db).data.has_security_code === true);

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
