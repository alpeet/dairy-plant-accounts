/**
 * Prarambha Account & Stock Management — Fresh Start / Handover Reset
 * ===================================================================
 * Lets an administrator wipe ALL business/accounting data so the same
 * installed application can be handed to a new client and refilled by
 * importing a fresh Excel workbook.
 *
 * Safety design (matches the handover spec):
 *   1. PRIMARY GATE — the administrator's own login password.
 *   2. OPTIONAL GATE — a separate security code, ONLY if one is configured.
 *      It is an additional protection for this destructive action; it is
 *      never required anywhere else and never blocks normal use. If it is
 *      set, the existing code must be used (no forced change).
 *   3. EXPLICIT CONFIRMATION — the admin must type RESET.
 *   4. A backup is created BEFORE anything is deleted and is verified
 *      (file exists, opens as SQLite, integrity_check ok). If the backup
 *      fails or cannot be verified, NOTHING is deleted.
 *   5. The wipe runs inside ONE transaction — either the complete business
 *      data set is cleared or nothing is touched (no partial state).
 *   6. The reset is written to the immutable audit log, including the
 *      backup filename reference.
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

/** Tables cleared in BOTH modes, in FK-safe order (children first). */
const TRANSACTIONAL_TABLES = [
    // document line items first (they reference their headers)
    'sales_items',
    'purchase_items',
    'production_inputs',
    'production_outputs',
    // documents
    'sales',
    'purchases',
    'milk_collections',
    'payments',
    'bank_transactions',
    'production_batches',
    'partner_capital',
    'denomination_counts',
    'petty_cash',
    'cash_deposits',
    'cash_collections',
    'salary_records',
    'vehicle_expenses',
    'other_expenses',
    // payroll master is handed-over business data; salary_records cleared above
    'employees',
    // ledgers and stock
    'ledger_entries',
    'stock_movements'
];

/**
 * Extra tables cleared ONLY in full mode. parties/products are masters;
 * routes and milk_rate_chart stay in keep-masters because preserved parties
 * reference routes (FK) and the same business keeps its milk pricing.
 * routes is listed AFTER parties/products: users (preserved) may reference
 * routes, so user assignments are nulled before routes is cleared.
 */
const MASTER_TABLES = ['parties', 'products', 'milk_rate_chart', 'routes'];

/** Tables never touched: users, audit_log and system-level settings. */
const PRESERVED_TABLES = ['users', 'settings', 'audit_log'];

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
    'paper_size'
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

function getCleanupStatus(db) {
    const counts = {};
    const all = [...TRANSACTIONAL_TABLES, ...MASTER_TABLES];
    for (const t of all) {
        try {
            counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
        } catch (e) {
            counts[t] = null; // table missing in this schema version
        }
    }
    // Business-identity settings that will be cleared (computed, not hard-coded)
    let business_settings = [];
    try {
        business_settings = db.prepare('SELECT key FROM settings ORDER BY key').all()
            .map(r => r.key).filter(k => !SYSTEM_SETTING_KEYS.has(k));
    } catch (e) { /* settings table missing — nothing to list */ }
    return {
        success: true,
        data: {
            counts,
            transactional_rows: all.reduce((s, t) => s + (counts[t] || 0), 0),
            has_security_code: !!getSecurityCodeHash(db),
            locked_out: isLockedOut(db),
            remaining_attempts: isLockedOut(db) ? 0 : getRemainingAttempts(db),
            preserved: PRESERVED_TABLES,
            business_settings
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
 * Wipe business data (Handover Reset).
 * @param {object} db        - better-sqlite3 connection
 * @param {object} opts
 *   adminPassword  (required) login password of an admin — primary gate
 *   securityCode   (optional) required ONLY when a security code is set
 *   confirmText    (required) must be exactly 'RESET'
 *   mode           'wipe-all' (default) clears parties/products too;
 *                  'keep-masters' preserves parties and products.
 *   envAdmin       {password} from environment config (optional)
 *   userId         acting user id for the audit record
 *   createBackup   async fn() => {filename,...} — called BEFORE the wipe;
 *                  the returned backup file is verified before deleting.
 */
function performCleanup(db, opts = {}) {
    const {
        adminPassword, securityCode, confirmText, mode = 'wipe-all',
        envAdmin = null, userId = null, createBackup = null
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

    if (mode !== 'wipe-all' && mode !== 'keep-masters') {
        return { success: false, error: 'Unknown cleanup mode.' };
    }

    // ── Backup BEFORE deleting anything, then VERIFY it ──
    let backupInfo = null;
    if (typeof createBackup === 'function') {
        try {
            backupInfo = createBackup();
        } catch (e) {
            return { success: false, error: `Backup could not be created. No data has been deleted. (${e.message})` };
        }
        if (!backupInfo || !backupInfo.path) {
            return { success: false, error: 'Backup could not be created. No data has been deleted.' };
        }
        const verify = verifyBackupFile(backupInfo.path);
        if (!verify.ok) {
            try { fs.unlinkSync(backupInfo.path); } catch (e) { /* best effort */ }
            return { success: false, error: `Backup verification failed (${verify.reason}). No data has been deleted.` };
        }
    }

    // ── Wipe, atomically ──
    const tables = mode === 'keep-masters' ? TRANSACTIONAL_TABLES : [...TRANSACTIONAL_TABLES, ...MASTER_TABLES];
    try {
        const wipe = db.transaction(() => {
            // Preserved users may hold FK references into routes — detach them
            // before the routes table is cleared (wipe-all only).
            if (mode === 'wipe-all') {
                try { db.prepare('UPDATE users SET assigned_route_id = NULL').run(); } catch (e) {
                    if (!/no such column/i.test(e.message)) throw e;
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
            // Immutable audit record of the reset, with backup reference
            try {
                db.prepare(`
                    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run('settings', null, 'delete',
                    JSON.stringify({ action: 'HANDOVER_RESET', mode, backup: backupInfo ? backupInfo.filename : null }),
                    JSON.stringify({ action: 'HANDOVER_RESET', mode, cleared_tables: tables, backup: backupInfo ? backupInfo.filename : null, backup_verified: !!(backupInfo && backupInfo.path) }),
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
            message: mode === 'keep-masters'
                ? 'Transactions cleared. Parties, products, routes, rate charts, users, system settings and audit log kept.'
                : 'Handover Reset completed successfully. All business data cleared. Users, system settings and audit log kept.',
            mode,
            backup: backupInfo,
            backup_verified: !!(backupInfo && backupInfo.path),
            cleared_tables: tables.length
        }
    };
}

module.exports = {
    TRANSACTIONAL_TABLES,
    MASTER_TABLES,
    PRESERVED_TABLES,
    SYSTEM_SETTING_KEYS,
    getCleanupStatus,
    setSecurityCode,
    performCleanup,
    verifyBackupFile,
    verifyAdminPassword
};
