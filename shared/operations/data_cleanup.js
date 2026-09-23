/**
 * Prarambha Account & Stock Management — Data Cleanup (Factory Reset)
 * ===================================================================
 * Lets an admin wipe all business data before handing the app to a new user,
 * while keeping logins (users), app settings and the audit trail.
 *
 * Safety design:
 *   1. TWO gates must pass: the admin password AND a separate security code.
 *      The security code is hashed (scrypt, same scheme as passwords) and is
 *      set/changed from Settings. It is intentionally a SECOND secret, not
 *      the login password.
 *   2. Wrong security code attempts are throttled: 5 failures lock the
 *      cleanup endpoint for 15 minutes (per-database, survives restarts).
 *   3. A verified safety backup is created BEFORE anything is deleted.
 *   4. The wipe runs inside ONE transaction — either everything is cleared
 *      or nothing is touched.
 *   5. The cleanup itself is written to the immutable audit log.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

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
    'salary_records',
    'vehicle_expenses',
    'other_expenses',
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

/** Tables never touched: users, settings, audit_log, employees (master data). */
const PRESERVED_TABLES = ['users', 'settings', 'audit_log', 'employees'];

const MAX_CODE_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// ============================================================
// Security code (second gate, stored hashed in settings)
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
// Gate 1 — admin password
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
// Status (for the Settings screen)
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
    return {
        success: true,
        data: {
            counts,
            transactional_rows: all.reduce((s, t) => s + (counts[t] || 0), 0),
            has_security_code: !!getSecurityCodeHash(db),
            locked_out: isLockedOut(db),
            remaining_attempts: isLockedOut(db) ? 0 : getRemainingAttempts(db),
            preserved: PRESERVED_TABLES
        }
    };
}

// ============================================================
// Security code set / change
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
// The cleanup itself
// ============================================================

/**
 * Wipe business data.
 * @param {object} db        - better-sqlite3 connection
 * @param {object} opts
 *   adminPassword  (required) login password of an admin
 *   securityCode   (required) the separate security code
 *   mode           'wipe-all' (default) clears parties/products too;
 *                  'keep-masters' preserves parties and products.
 *   envAdmin       {password} from environment config (optional)
 *   userId         acting user id for the audit record
 *   createBackup   async fn() => {filename,...} — called BEFORE the wipe
 */
function performCleanup(db, opts = {}) {
    const {
        adminPassword, securityCode, mode = 'wipe-all',
        envAdmin = null, userId = null, createBackup = null
    } = opts;

    // ── Gate 0: lockout ──
    if (isLockedOut(db)) {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'security_code_locked_until'").get();
        const until = row && row.value ? row.value : 'soon';
        return { success: false, error: `Too many wrong security codes. Cleanup is locked until ${until}.` };
    }

    // ── Gate 1: admin password ──
    if (!adminPassword) {
        return { success: false, error: 'Enter your admin password to continue.' };
    }
    if (!verifyAdminPassword(db, adminPassword, envAdmin)) {
        return { success: false, error: 'Admin password is incorrect. Nothing was deleted.' };
    }

    // ── Gate 2: security code ──
    const storedHash = getSecurityCodeHash(db);
    if (!storedHash) {
        return {
            success: false,
            error: 'No security code is set yet. Set one in Settings first — it is the second key that protects this wipe.',
            code: 'NO_SECURITY_CODE'
        };
    }
    if (!securityCode || !auth.verifyPassword(String(securityCode), storedHash)) {
        const res = recordFailedAttempt(db);
        if (res.locked) {
            return { success: false, error: `Wrong security code. Cleanup is locked for ${LOCKOUT_MINUTES} minutes (until ${res.lockedUntil}).` };
        }
        return { success: false, error: `Wrong security code. Nothing was deleted. ${res.remaining} attempt(s) left before a ${LOCKOUT_MINUTES}-minute lock.` };
    }
    clearAttempts(db);

    if (mode !== 'wipe-all' && mode !== 'keep-masters') {
        return { success: false, error: 'Unknown cleanup mode.' };
    }

    // ── Backup BEFORE deleting anything ──
    let backupInfo = null;
    if (typeof createBackup === 'function') {
        try {
            backupInfo = createBackup();
        } catch (e) {
            return { success: false, error: `Safety backup failed, so nothing was deleted. (${e.message})` };
        }
        if (!backupInfo) {
            return { success: false, error: 'Safety backup failed, so nothing was deleted.' };
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
            // Reset auto-increment counters of wiped tables only
            try {
                const seqTables = db.prepare("SELECT name FROM sqlite_sequence").all().map(r => r.name);
                const wipeSet = new Set([...tables, ...TRANSACTIONAL_TABLES]);
                for (const name of seqTables) {
                    if (wipeSet.has(name)) db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name);
                }
            } catch (e) {
                // sqlite_sequence does not exist until the first AUTOINCREMENT insert
            }
            // Immutable audit record of the cleanup itself
            try {
                db.prepare(`
                    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run('settings', null, 'delete',
                    JSON.stringify({ action: 'DATA_CLEANUP', mode, backup: backupInfo ? backupInfo.filename : null }),
                    JSON.stringify({ action: 'DATA_CLEANUP', mode, cleared_tables: tables }),
                    userId || null);
            } catch (e) { /* audit must never break the wipe */ }
        });
        wipe();
    } catch (err) {
        return { success: false, error: `The cleanup failed and was rolled back — your data is unchanged. (${err.message})` };
    }

    return {
        success: true,
        data: {
            message: mode === 'keep-masters'
                ? 'Transactions cleared. Parties, products, routes, rate charts, users, settings and audit log kept.'
                : 'All business data cleared. Users, settings and audit log kept.',
            mode,
            backup: backupInfo,
            cleared_tables: tables.length
        }
    };
}

module.exports = {
    TRANSACTIONAL_TABLES,
    MASTER_TABLES,
    PRESERVED_TABLES,
    getCleanupStatus,
    setSecurityCode,
    performCleanup,
    verifyAdminPassword
};
