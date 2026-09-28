/**
 * Prarambha Account & Stock Management — Settings Operations
 * ==========================================
 * Single source of truth for settings CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get all settings as a key-value object.
 */
function getSettings(db) {
    const rows = db.prepare("SELECT * FROM settings").all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return settings;
}

/**
 * Save multiple settings at once (upsert by key).
 * Every changed key is recorded in the audit trail (old → new, secrets redacted
 * by the audit layer).
 */
function saveSettings(db, settings, userId = null) {
    const before = getSettings(db);
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    const trx = db.transaction(() => {
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, String(value));
        }
    });
    trx();
    const after = getSettings(db);
    // Audit only the keys that actually changed, and never record secret values
    const changed = {};
    for (const [key, value] of Object.entries(settings)) {
        if (String(before[key] ?? '') !== String(value ?? '')) changed[key] = value;
    }
    if (Object.keys(changed).length > 0) {
        logAudit(db, 'settings', null, 'update',
            Object.fromEntries(Object.keys(changed).map(k => [k, before[k] ?? null])),
            changed, userId);
    }
    return { success: true };
}

const { logAudit } = require('./audit');

module.exports = { getSettings, saveSettings };
