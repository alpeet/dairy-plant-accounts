/**
 * Prarambha Account & Stock Management — Fresh Start / Handover Reset
 * ===================================================================
 * Lets an administrator wipe ALL business/accounting data so the same
 * installed application can be handed to a new client and refilled by
 * importing a fresh Excel workbook.
 *
 * Simple, fast workflow (no slow pre-reset record counting):
 *
 *   BACKUP FIRST  →  VERIFY BACKUP  →  CONFIRM  →  RESET  →  FRESH APP
 *
 *   1. PRIMARY GATE — the administrator's own login password.
 *   2. OPTIONAL GATE — a separate security code, ONLY if one is configured.
 *   3. EXPLICIT CONFIRMATION — the admin must type RESET.
 *   4. A COMPLETE backup is created BEFORE anything is deleted (the admin
 *      picks the location with a Save Backup As… dialog) and is verified
 *      (file exists, opens as SQLite, integrity_check ok). If the backup
 *      fails or cannot be verified, NOTHING is deleted.
 *   5. The wipe runs inside ONE transaction — either the complete business
 *      data set is cleared or nothing is touched (no partial state).
 *   6. The reset is written to the immutable audit log, including the
 *      backup filename reference.
 *
 * The business tables are discovered from the live schema (sqlite_master +
 * foreign_key graph + FRESH_START_KEEP_TABLES), NOT hard-coded per project.
 *
 * Preserved: user logins/admin access, security-code + auth settings,
 * system settings (behavior/system-level), database schema, audit log.
 * Cleared:  all transactional + master business tables, employees, and
 *           business-identity settings (company name/address/phone/email/
 *           PAN/VAT, signature, SMTP credentials, tax/currency overrides).
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const fs = require('fs');
const Database = require('better-sqlite3');
const auth = require('../auth');

/**
 * Tables NEVER cleared by the Fresh Start reset — login/system/audit only.
 * Everything else found in the live schema is treated as business data and
 * is cleared, children before parents (FK graph ordering).
 */
const FRESH_START_KEEP_TABLES = new Set(['users', 'settings', 'audit_log']);

/**
 * System-level settings keys that survive the reset (behavior/system config).
 * Everything else in settings is treated as business/handover data
 * (company name/address/phone/email/PAN, signature, SMTP credentials, etc.)
 * and is cleared so the next client enters their own.
 */
const SYSTEM_SETTING_KEYS = new Set([
    'security_code_hash',
    'security_code_attempts',
    'security_code_locked_until',
    'app_version',
    'allow_negative_stock',
    'paper_size',
    // Written by the reset itself: tells startup migrations/backfills that
    // this book was deliberately cleared, so they must not re-seed the
    // previous business's data (e.g. the staff master) on the next launch.
    'fresh_start_completed_at'
]);

const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ============================================================
// Security code (optional second gate, stored hashed in settings)
// ============================================================

function getSecurityCodeHash(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security_code_hash'").get();
        return row && row.value ? String(row.value) : null;
    } catch (e) {
        return null;
    }
}

function isLockedOut(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security_code_locked_until'").get();
        if (!row || !row.value) return false;
        return new Date(row.value).getTime() > Date.now();
    } catch (e) {
        return false;
    }
}

function getRemainingAttempts(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security_code_attempts'").get();
        const used = row && row.value ? parseInt(row.value, 10) || 0 : 0;
        return Math.max(0, MAX_CODE_ATTEMPTS - used);
    } catch (e) {
        return MAX_CODE_ATTEMPTS;
    }
}

function recordFailedAttempt(db) {
    const used = (MAX_CODE_ATTEMPTS - getRemainingAttempts(db)) + 1;
    if (used >= MAX_CODE_ATTEMPTS) {
        const until = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run('security_code_locked_until', until);
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('security_code_attempts', '0')").run();
        return { locked: true, lockedUntil: until };
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
        .run('security_code_attempts', String(used));
    return { locked: false, remaining: MAX_CODE_ATTEMPTS - used };
}

function clearAttempts(db) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('security_code_attempts', '0')").run();
    db.prepare("DELETE FROM settings WHERE key = 'security_code_locked_until'").run();
}

// ============================================================
// Gate 1 — admin password (primary authentication)
// ============================================================

/**
 * Verify an admin password against the environment admin (if configured)
 * or any active admin user row in the database.
 */
function verifyAdminPassword(db, password, envAdmin) {
    if (!password) return false;
    if (envAdmin && envAdmin.password && auth.verifyPassword(password, envAdmin.password)) return true;
    try {
        const admins = db.prepare("SELECT password_hash FROM users WHERE role = 'admin' AND is_active = 1").all();
        return admins.some(u => auth.verifyPassword(password, u.password_hash));
    } catch (e) {
        return false;
    }
}

// ============================================================
// Status (for the Settings screen — real counts, no hard-coding)
// ============================================================

/**
 * Build the Fresh Start wipe plan from the LIVE database schema — never from
 * a hard-coded table list.
 *
 * 1. Read every user table from sqlite_master.
 * 2. Keep-tables (users/settings/audit_log) and internal tables are excluded.
 * 3. Order children before parents using the declared foreign keys so the
 *    DELETEs never violate an FK constraint (foreign_keys pragma is left as
 *    the caller configured it — ordering alone makes the wipe safe).
 * 4. Tables with declared FKs pointing OUT of the wipe set into a kept table
 *    (e.g. salary_records → employees — both business tables) are still
 *    cleared; FKs from a wiped table into a KEPT table (e.g. users → routes)
 *    are detached by an UPDATE … SET col = NULL before the wipe.
 *
 * @returns {{ tables: string[], detach: Array<{table: string, column: string}>, missing: string[] }}
 */
function getFreshStartWipePlan(database) {
    const fks = []; // { from, to, fromColumn }
    const db = database;

    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const keep = new Set([...FRESH_START_KEEP_TABLES].filter(t => names.includes(t)));
    const wipe = names.filter(t => !keep.has(t));
    const wipeSet = new Set(wipe);

    for (const t of wipe) {
        let fkRows = [];
        try {
            fkRows = db.pragma(`foreign_key_list('${t}')`);
        } catch (e) { /* pragma failed — treat as no FKs */ }
        for (const fk of fkRows) {
            if (fk.table && !wipeSet.has(fk.table)) {
                // Wiped table references a KEPT table — detach before wiping
                fks.push({ from: t, to: fk.table, fromColumn: fk.from });
            }
        }
    }

    // Kahn topological sort for DELETION: a table may only be emitted once
    // every table that REFERENCES it (its children) has already been emitted —
    // children are deleted before parents so FK constraints stay satisfied.
    const referencing = new Map(); // parent -> [tables that reference it]
    for (const t of wipe) {
        for (const target of fkTargets(t)) {
            if (target === t) continue;
            if (!referencing.has(target)) referencing.set(target, []);
            referencing.get(target).push(t);
        }
    }
    const emitted = new Set();
    const ordered = [];
    let pending = [...wipe];
    let guard = pending.length + 1;
    while (pending.length && guard-- > 0) {
        let progressed = false;
        const next = [];
        for (const t of pending) {
            const children = referencing.get(t) || [];
            const blocked = children.some(c => wipeSet.has(c) && !emitted.has(c));
            if (!blocked) {
                ordered.push(t);
                emitted.add(t);
                progressed = true;
            } else {
                next.push(t);
            }
        }
        pending = next;
        if (!progressed) break; // cyclic FKs — emit the rest in original order
    }
    for (const t of pending) ordered.push(t);

    return { tables: ordered, detach: fks };

    /** Tables (within the wipe set) that `t` declares FKs INTO. */
    function fkTargets(t) {
        const deps = [];
        try {
            for (const fk of db.pragma(`foreign_key_list('${t}')`)) {
                if (fk.table && fk.table !== t) deps.push(fk.table);
            }
        } catch (e) { /* none */ }
        return deps;
    }
}

// ============================================================
// Status (for the Settings screen — lightweight, NO record counting)
// ============================================================

/**
 * Everything the Fresh Start UI needs WITHOUT scanning business records.
 * Only the (tiny) settings and users tables are read.
 */
function getFreshStartStatus(db) {
    let business_settings = [];
    try {
        business_settings = db.prepare('SELECT key FROM settings ORDER BY key').all()
            .map(r => r.key).filter(k => !SYSTEM_SETTING_KEYS.has(k));
    } catch (e) { /* settings table missing — nothing to list */ }
    let admin_count = 0;
    try {
        admin_count = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1").get().c;
    } catch (e) { /* users table missing */ }
    return {
        success: true,
        data: {
            has_security_code: !!getSecurityCodeHash(db),
            locked_out: isLockedOut(db),
            remaining_attempts: isLockedOut(db) ? 0 : getRemainingAttempts(db),
            business_settings,
            admin_count,
            keep_tables: [...FRESH_START_KEEP_TABLES]
        }
    };
}

// ============================================================
// Security code set / change (kept per spec §14)
// ============================================================

/**
 * Set or change the security code.
 * - First time: admin password is enough.
 * - Changing an existing code: admin password AND the current code.
 */
function setSecurityCode(db, { adminPassword, currentCode, newCode }, envAdmin) {
    if (!newCode || String(newCode).length < 4) {
        return { success: false, error: 'The security code must be at least 4 characters long.' };
    }
    if (!verifyAdminPassword(db, adminPassword, envAdmin)) {
        return { success: false, error: 'Admin password is incorrect. The security code was not changed.' };
    }
    const existing = getSecurityCodeHash(db);
    if (existing) {
        if (!currentCode) {
            return { success: false, error: 'Enter the CURRENT security code to change it.' };
        }
        if (!auth.verifyPassword(String(currentCode), existing)) {
            return { success: false, error: 'The current security code is incorrect.' };
        }
    }
    const hashed = auth.hashPassword(String(newCode));
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('security_code_hash', ?)").run(hashed);
    clearAttempts(db);
    return { success: true, data: { message: existing ? 'Security code changed.' : 'Security code set.' } };
}

// ============================================================
// Backup verification (spec §7 — verify BEFORE deleting)
// ============================================================

/**
 * Verify a backup file is complete and restorable: it must exist, be
 * non-trivially sized, open as a SQLite database, pass integrity_check
 * and contain the core schema. Read-only — the live DB is untouched.
 */
function verifyBackupFile(backupPath) {
    try {
        const stats = fs.statSync(backupPath);
        if (!stats.isFile() || stats.size < 4096) return { ok: false, reason: 'file missing or too small' };
        const check = new Database(backupPath, { readonly: true, fileMustExist: true });
        try {
            const ok = check.pragma('integrity_check', { simple: true });
            if (String(ok) !== 'ok') return { ok: false, reason: `integrity_check: ${ok}` };
            const core = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('users','settings','parties','sales','milk_collections')").get().n;
            if (core < 3) return { ok: false, reason: 'core schema missing from backup' };
        } finally {
            check.close();
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

// ============================================================
// The cleanup itself
// ============================================================

/**
 * Wipe business data (Fresh Start / Handover Reset).
 * The wipe set is computed from the LIVE schema — see getFreshStartWipePlan().
 * @param {object} db        - better-sqlite3 connection
 * @param {object} opts
 *   adminPassword  (required) login password of an admin — primary gate
 *   securityCode   (optional) required ONLY when a security code is set
 *   confirmText    (required) must be exactly 'RESET'
 *   envAdmin       {password} from environment config (optional)
 *   userId         acting user id for the audit record
 *   backupPath     (required) path of the COMPLETE backup created in Step 1
 *                  (Save Backup As… / Online Backup API). The reset NEVER runs
 *                  without one: the file must exist and pass verification
 *                  before anything is deleted.
 *   verifyBackup   optional alternate verifier fn(path) => {ok, reason}
 */
function performCleanup(db, opts = {}) {
    const {
        adminPassword, securityCode, confirmText,
        envAdmin = null, userId = null,
        backupPath = null, verifyBackup = null
    } = opts;

    // ── Gate 0: lockout (only applies when a security code is configured) ──
    const storedHash = getSecurityCodeHash(db);
    if (storedHash && isLockedOut(db)) {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security_code_locked_until'").get();
        const until = row && row.value ? row.value : 'soon';
        return { success: false, error: `Too many wrong security codes. Cleanup is locked until ${until}.` };
    }

    // ── Gate 1: admin password (primary) ──
    if (!adminPassword) {
        return { success: false, error: 'Enter your admin password to continue.' };
    }
    if (!verifyAdminPassword(db, adminPassword, envAdmin)) {
        return { success: false, error: 'Admin password is incorrect. Nothing was deleted.' };
    }

    // ── Gate 2: explicit typed confirmation (cheap check, before the code gate
    // so a typo in RESET never burns a security-code attempt) ──
    if (String(confirmText || '').trim().toUpperCase() !== 'RESET') {
        return { success: false, error: 'Type RESET (in capitals) to confirm the handover reset.' };
    }

    // ── Gate 3: security code — only if one is configured ──
    if (storedHash) {
        if (!securityCode || !auth.verifyPassword(String(securityCode), storedHash)) {
            const res = recordFailedAttempt(db);
            if (res.locked) {
                return { success: false, error: `Wrong security code. Cleanup is locked for ${LOCKOUT_MINUTES} minutes (until ${res.lockedUntil}).` };
            }
            return { success: false, error: `Wrong security code. Nothing was deleted. ${res.remaining} attempt(s) left before a ${LOCKOUT_MINUTES}-minute lock.` };
        }
        clearAttempts(db);
    }

    // ── BACKUP FIRST: the reset is anchored to a VERIFIED backup file ──
    // (Step 1 of the UI flow already created it via the Save Backup As… dialog
    // / Online Backup API; here we require it and verify it again.)
    if (!backupPath) {
        return { success: false, error: 'No backup found. Create the complete backup first (Step 1) — nothing has been deleted.' };
    }
    if (!fs.existsSync(backupPath)) {
        return { success: false, error: `Backup verification failed (file not found: ${backupPath}). Create the backup first (Step 1). No data has been deleted.` };
    }
    const verify = (typeof verifyBackup === 'function' ? verifyBackup : verifyBackupFile)(backupPath);
    if (!verify.ok) {
        return { success: false, error: `Backup verification failed (${verify.reason}). No data has been deleted.` };
    }
    const backupInfo = { path: backupPath, filename: backupPath.split(/[\\/]/).pop() };

    // ── Wipe plan from the LIVE schema (children before parents) ──
    const plan = getFreshStartWipePlan(db);
    const tables = plan.tables;

    // ── Wipe, atomically ──
    try {
        const wipe = db.transaction(() => {
            // Detach FKs from wiped tables into KEPT tables (e.g. users → routes)
            for (const d of plan.detach) {
                try {
                    db.prepare(`UPDATE "${d.from}" SET "${d.fromColumn}" = NULL`).run();
                } catch (e) {
                    if (!/no such (column|table)/i.test(e.message)) throw e;
                }
            }
            for (const t of tables) {
                try {
                    db.prepare(`DELETE FROM "${t}"`).run();
                } catch (e) {
                    if (!/no such table/i.test(e.message)) throw e;
                }
            }
            // Business-identity settings are handover data: clear them so the
            // next client enters their own company profile. System keys survive.
            try {
                const keys = db.prepare('SELECT key FROM settings').all().map(r => r.key);
                for (const k of keys) {
                    if (!SYSTEM_SETTING_KEYS.has(k)) {
                        db.prepare('DELETE FROM settings WHERE key = ?').run(k);
                    }
                }
            } catch (e) { /* settings table missing — skip */ }
            // Reset auto-increment counters of wiped tables only
            try {
                const seqTables = db.prepare("SELECT name FROM sqlite_sequence").all().map(r => r.name);
                const wipeSet = new Set(tables);
                for (const name of seqTables) {
                    if (wipeSet.has(name)) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name);
                }
            } catch (e) {
                // sqlite_sequence does not exist until the first AUTOINCREMENT insert
            }
            // Persistent Fresh Start marker — keeps the book empty across
            // app restarts by telling startup backfills not to re-seed the
            // previous business's master data.
            try {
                db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('fresh_start_completed_at', ?)")
                    .run(new Date().toISOString());
            } catch (e) { /* settings table missing — skip */ }
            // Immutable audit record of the reset, with backup reference
            try {
                db.prepare(`
                    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run('settings', null, 'delete',
                    JSON.stringify({ action: 'HANDOVER_RESET', backup: backupInfo ? backupInfo.filename : null }),
                    JSON.stringify({ action: 'HANDOVER_RESET', cleared_tables: tables, backup: backupInfo ? backupInfo.filename : null, backup_verified: !!(backupInfo && backupInfo.path) }),
                    userId || null);
            } catch (e) { /* audit must never break the wipe */ }
        });
        wipe();
    } catch (err) {
        return { success: false, error: `The reset failed and was rolled back — your data is unchanged. (${err.message})` };
    }

    return {
        success: true,
        data: {
            message: 'Fresh Start completed successfully. All business data cleared. Users, system settings and audit log kept.',
            backup: backupInfo,
            backup_verified: !!(backupInfo && backupInfo.path),
            cleared_tables: tables.length
        }
    };
}

module.exports = {
    FRESH_START_KEEP_TABLES,
    getFreshStartWipePlan,
    getFreshStartStatus,
    SYSTEM_SETTING_KEYS,
    setSecurityCode,
    performCleanup,
    verifyBackupFile,
    verifyAdminPassword
};
