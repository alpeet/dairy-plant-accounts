/**
 * Godhuli Dairy Plant — Settings Operations
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
 */
function saveSettings(db, settings) {
    const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
    const trx = db.transaction(() => {
        for (const [key, value] of Object.entries(settings)) {
            stmt.run(key, String(value));
        }
    });
    trx();
    return { success: true };
}

module.exports = { getSettings, saveSettings };
