/**
 * Godhuli Dairy Plant — Backup Operations
 * ========================================
 * Single source of truth for database backup.
 * Used by both Electron (main.js) and Web (server.js).
 */

const path = require('path');
const fs = require('fs');

/**
 * Create a backup copy of the database file.
 * @param {string} dbPath - Full path to the current database file
 * @returns {object} { path: backupFilePath }
 */
function backupDatabase(dbPath) {
    const backupPath = path.join(
        path.dirname(dbPath),
        `backup-${new Date().toISOString().split('T')[0]}.db`
    );
    fs.copyFileSync(dbPath, backupPath);
    return { path: backupPath };
}

module.exports = { backupDatabase };
