/**
 * Godhuli Dairy Plant — Backup Operations
 * ========================================
 * Single source of truth for database backup.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * Features:
 *   - Creates timestamped backups in a dedicated directory
 *   - Auto-cleans old backups (keeps last MAX_BACKUPS)
 *   - Lists available backups with sizes and dates
 *   - Returns backup file path for download
 */

const path = require('path');
const fs = require('fs');

const MAX_BACKUPS = 20; // Keep at most this many backups

/**
 * Get the backup directory path.
 * Creates the directory if it doesn't exist.
 * @param {string} dbPath - Full path to the current database file
 * @returns {string} Backup directory path
 */
function getBackupDir(dbPath) {
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    return backupDir;
}

/**
 * Create a backup copy of the database file with a timestamped filename.
 * @param {string} dbPath - Full path to the current database file
 * @returns {object} { path: backupFilePath, filename: backupFileName, size: fileSize, createdAt: timestamp }
 */
function backupDatabase(dbPath) {
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file not found: ${dbPath}`);
    }

    const backupDir = getBackupDir(dbPath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, filename);

    fs.copyFileSync(dbPath, backupPath);

    const stats = fs.statSync(backupPath);

    // Clean up old backups
    cleanupOldBackups(dbPath);

    return {
        path: backupPath,
        filename: filename,
        size: stats.size,
        createdAt: new Date().toISOString()
    };
}

/**
 * List all available backups, sorted newest first.
 * @param {string} dbPath - Full path to the current database file
 * @returns {Array} Array of { filename, path, size, createdAt } objects
 */
function listBackups(dbPath) {
    const backupDir = getBackupDir(dbPath);

    let files = [];
    try {
        files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
            .map(f => {
                const fullPath = path.join(backupDir, f);
                try {
                    const stats = fs.statSync(fullPath);
                    return {
                        filename: f,
                        path: fullPath,
                        size: stats.size,
                        createdAt: stats.mtime.toISOString()
                    };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean)
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {
        // Backup dir might not exist yet
    }

    return files;
}

/**
 * Delete old backups beyond MAX_BACKUPS count.
 * @param {string} dbPath - Full path to the current database file
 */
function cleanupOldBackups(dbPath) {
    const backups = listBackups(dbPath);
    if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const b of toDelete) {
            try {
                fs.unlinkSync(b.path);
                console.log(`  → Deleted old backup: ${b.filename}`);
            } catch (e) {
                console.warn(`  ⚠️  Could not delete old backup ${b.filename}: ${e.message}`);
            }
        }
    }
}

/**
 * Delete a specific backup file.
 * @param {string} dbPath - Full path to the current database file
 * @param {string} filename - Backup filename to delete
 * @returns {boolean} Whether deletion was successful
 */
function deleteBackup(dbPath, filename) {
    const backups = listBackups(dbPath);
    const target = backups.find(b => b.filename === filename);
    if (!target) {
        throw new Error(`Backup not found: ${filename}`);
    }
    fs.unlinkSync(target.path);
    return true;
}

/**
 * Format file size for human readability.
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted size string
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

module.exports = {
    backupDatabase,
    listBackups,
    deleteBackup,
    formatFileSize,
    getBackupDir
};
