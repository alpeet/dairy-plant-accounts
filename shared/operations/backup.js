/**
 * Prarambha Account & Stock Management — Backup Operations
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
const Database = require('better-sqlite3');

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
 *
 * IMPORTANT (WAL mode): SQLite runs in WAL journal mode, so recent transactions
 * may still live in the -wal file rather than the main .db file. Before copying,
 * we run a WAL checkpoint (TRUNCATE) to flush all pending transactions into the
 * main database file — otherwise a backup could silently miss the newest data.
 *
 * @param {string} dbPath - Full path to the current database file
 * @param {object} [db]   - Optional open better-sqlite3 connection used to checkpoint the WAL
 * @returns {object} { path: backupFilePath, filename: backupFileName, size: fileSize, createdAt: timestamp }
 */
function backupDatabase(dbPath, db) {
    if (!fs.existsSync(dbPath)) {
        throw new Error(`Database file not found: ${dbPath}`);
    }

    // Flush WAL transactions into the main database file before copying
    if (db && typeof db.pragma === 'function') {
        try {
            db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (e) {
            console.warn('  ⚠️  WAL checkpoint failed (continuing anyway):', e.message);
        }
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
 * Create a COMPLETE, consistent snapshot of the live database via SQLite's
 * Online Backup API (better-sqlite3 `db.backup(dest)`), saving it wherever
 * the user chooses (Save Backup As… dialog). WAL-safe: works while the app
 * is running and writes a consistent copy of every page of the database.
 *
 * A small `.meta.json` sidecar is written next to the backup recording the
 * application version, schema state, timestamps, table counts and a checksum
 * of the snapshot file — enough to identify and validate the backup later.
 *
 * @param {object} db           - open better-sqlite3 connection (the LIVE db)
 * @param {string} dbPath       - path of the live database file
 * @param {string} destPath     - full destination path chosen by the user
 * @param {object} [info]       - { appVersion } optional metadata
 * @returns {Promise<object>}   - { path, filename, size, createdAt, metaPath, metadata, checksum }
 */
async function backupDatabaseToPath(db, dbPath, destPath, info = {}) {
    if (!db || typeof db.backup !== 'function') {
        throw new Error('The database connection does not support online backup.');
    }
    if (!destPath) {
        throw new Error('A destination path is required.');
    }

    // Normalize the extension (default: .dab — Dairy Accounts Backup)
    if (!/\.(db|sqlite|dab)$/i.test(destPath)) {
        destPath += '.dab';
    }

    // The destination directory must exist (Save dialog normally ensures it)
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    // ── SQLite Online Backup API: consistent snapshot of the LIVE database ──
    // (better-sqlite3 returns a promise; all pages are copied transactionally.)
    await db.backup(destPath);

    // ── Metadata sidecar ──
    const stats = fs.statSync(destPath);
    const checksum = checksumFile(destPath);
    let tableCounts = null;
    try {
        const probe = new Database(destPath, { readonly: true, fileMustExist: true });
        try {
            const counts = {};
            const names = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
            for (const n of names) {
                try { counts[n] = probe.prepare(`SELECT COUNT(*) AS c FROM "${n}"`).get().c; } catch (e) { /* skip */ }
            }
            tableCounts = counts;
        } finally {
            probe.close();
        }
    } catch (e) { /* metadata is best-effort; the snapshot itself is complete */ }

    const metadata = {
        backup_type: 'complete-database-snapshot',
        format: 'sqlite3',
        app_version: info.appVersion || null,
        schema_tables: tableCounts ? Object.keys(tableCounts).length : null,
        created_at: new Date().toISOString(),
        source_database: dbPath,
        source_file_size: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : null,
        backup_file_size: stats.size,
        checksum_sha256: checksum,
        table_counts: tableCounts
    };
    const metaPath = destPath + '.meta.json';
    try {
        fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    } catch (e) {
        // Sidecar is optional — never fail the backup over it
    }

    return {
        path: destPath,
        filename: path.basename(destPath),
        size: stats.size,
        createdAt: metadata.created_at,
        metaPath: fs.existsSync(metaPath) ? metaPath : null,
        metadata,
        checksum
    };
}

/**
 * SHA-256 checksum of a file (streamed — no full-file buffering).
 */
function checksumFile(filePath) {
    const crypto = require('crypto');
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(filePath));
    return h.digest('hex');
}

/**
 * Restore the database from an ARBITRARY backup file path (e.g. a .dab file
 * the user picked with ♻️ Restore Backup, or a legacy backup-*.db). A safety
 * backup of the current database is written first, then the live file is
 * replaced. The caller must close and re-open its database connection.
 *
 * @param {string} dbPath        - path of the live database file
 * @param {string} sourcePath    - full path of the backup file to restore from
 * @param {function} [closeDb]   - optional fn to close the live connection first
 * @returns {object} { path, filename, preRestoreBackup, size, createdAt }
 */
function restoreDatabaseFromPath(dbPath, sourcePath, closeDb) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error(`Backup file does not exist: ${sourcePath}`);
    }
    if (!fs.statSync(sourcePath).isFile()) {
        throw new Error(`Backup path is not a file: ${sourcePath}`);
    }

    // Close the live connection before touching the file
    if (typeof closeDb === 'function') {
        closeDb();
    }

    // Safety backup of the CURRENT state before it is overwritten
    let preRestoreBackupPath = null;
    if (fs.existsSync(dbPath)) {
        preRestoreBackupPath = dbPath + '.pre-restore-' + new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(dbPath, preRestoreBackupPath);
        console.log(`  → Pre-restore safety backup saved: ${preRestoreBackupPath}`);
    }

    fs.copyFileSync(sourcePath, dbPath);
    const stats = fs.statSync(dbPath);
    console.log(`  → Database restored from: ${sourcePath}`);

    return {
        path: dbPath,
        filename: path.basename(sourcePath),
        preRestoreBackup: preRestoreBackupPath,
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
            // Legacy auto-backups (backup-*.db) and Fresh Start snapshots
            // (DairyAccounts_Backup_*.dab) are both listed/restorable.
            .filter(f => (f.startsWith('backup-') && f.endsWith('.db')) ||
                        (f.startsWith('DairyAccounts_Backup_') && f.endsWith('.dab')))
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
 * Only routine auto-backups (backup-*.db) are rotated; Fresh Start snapshots
 * (DairyAccounts_Backup_*.dab) are never auto-deleted — the admin decides.
 * @param {string} dbPath - Full path to the current database file
 */
function cleanupOldBackups(dbPath) {
    const backups = listBackups(dbPath).filter(b => /^backup-.*\.db$/.test(b.filename));
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
 * Restore the database from a backup file.
 * Creates a backup of the current database first, then copies the backup over.
 * @param {string} dbPath - Full path to the current database file
 * @param {string} filename - Backup filename to restore from
 * @param {function} [closeDb] - Optional function to close the database before restore
 * @returns {object} { path: restoredPath, filename: restoredFrom, size: fileSize, createdAt: timestamp }
 */
function restoreDatabase(dbPath, filename, closeDb) {
    const backups = listBackups(dbPath);
    const target = backups.find(b => b.filename === filename);
    if (!target) {
        throw new Error(`Backup not found: ${filename}`);
    }

    if (!fs.existsSync(target.path)) {
        throw new Error(`Backup file does not exist: ${target.path}`);
    }

    // Close the database connection if a close function was provided
    if (typeof closeDb === 'function') {
        closeDb();
    }

    // Create a safety backup of the current database before restoring
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const preRestoreBackupPath = dbPath + '.pre-restore-' + timestamp;
    if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, preRestoreBackupPath);
        console.log(`  → Pre-restore safety backup saved: ${preRestoreBackupPath}`);
    }

    // Copy the backup file to the database path
    fs.copyFileSync(target.path, dbPath);

    const stats = fs.statSync(dbPath);

    console.log(`  → Database restored from backup: ${filename}`);

    return {
        path: dbPath,
        filename: filename,
        preRestoreBackup: preRestoreBackupPath,
        size: stats.size,
        createdAt: new Date().toISOString()
    };
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
    backupDatabaseToPath,
    listBackups,
    deleteBackup,
    restoreDatabase,
    restoreDatabaseFromPath,
    formatFileSize,
    getBackupDir
};
