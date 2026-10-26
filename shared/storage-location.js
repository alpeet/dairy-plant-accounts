/**
 * Prarambha Account & Stock Management — where the data actually lives
 * ====================================================================
 * ONE place that answers "which database file is this process using?".
 *
 * Why this exists
 * ---------------
 * The desktop app and the web server resolve their data folder differently:
 *   · packaged Electron  → app.getPath('userData')/data
 *   · portable .exe      → <folder containing the exe>/data
 *   · web / `npm start`  → <project>/data
 *
 * That is legitimate, but it means a Fresh Start performed in one of them does
 * NOT touch the database the other one opens. The reset used to report success
 * without ever naming the file it cleared, so "the old data came back after a
 * restart" was really "a different copy of the database was opened".
 *
 * Nothing here changes where the app stores data — it only makes the location
 * visible, and detects the other copies that exist on this machine so the UI
 * can warn instead of letting the operator reset the wrong book.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DB_FILENAME = 'dairy-plant.db';

/** Electron userData folder names this app has used over its life. */
const LEGACY_APP_FOLDERS = [
    'prarambha-account-stock',
    'dairy-plant-accounts',
    'godhuli-dairy-plant'
];

function fileInfo(dbPath) {
    try {
        const st = fs.statSync(dbPath);
        return {
            exists: true,
            size: st.size,
            modified: st.mtime.toISOString()
        };
    } catch (e) {
        return { exists: false, size: 0, modified: null };
    }
}

/**
 * Describe the active store.
 *
 * @param {object} opts
 *   dir    the resolved data folder (main.js getDbDir() / server.js dbDir)
 *   mode   'desktop' | 'portable' | 'web' — how the folder was chosen
 * @returns {object}
 */
function describe({ dir, mode }) {
    const dbPath = path.join(dir, DB_FILENAME);
    const info = fileInfo(dbPath);
    return {
        mode: mode || 'unknown',
        data_dir: dir,
        db_path: dbPath,
        filename: DB_FILENAME,
        ...info,
        wal: fileInfo(dbPath + '-wal').exists,
        backups_dir: path.join(dir, 'backups')
    };
}

/**
 * Every other copy of dairy-plant.db on this machine that the app could open
 * with a different launch method. Read-only — nothing is moved or deleted.
 *
 * @param {string} activeDir the folder in use
 * @returns {Array<{where: string, db_path: string, size: number, modified: string}>}
 */
function otherCopies(activeDir) {
    const candidates = [];
    const support = path.join(os.homedir(), 'Library', 'Application Support');
    if (process.platform === 'darwin' && fs.existsSync(support)) {
        for (const name of LEGACY_APP_FOLDERS) {
            candidates.push(path.join(support, name, 'data'));
            candidates.push(path.join(support, name));
        }
    }
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        for (const name of LEGACY_APP_FOLDERS) {
            candidates.push(path.join(appData, name, 'data'));
        }
    }
    // The project folder is the web/development store.
    candidates.push(path.join(__dirname, '..', 'data'));

    const seen = new Set();
    const out = [];
    for (const dir of candidates) {
        const full = path.resolve(dir);
        if (full === path.resolve(activeDir)) continue;
        if (seen.has(full)) continue;
        seen.add(full);
        const dbPath = path.join(full, DB_FILENAME);
        const info = fileInfo(dbPath);
        if (!info.exists) continue;
        out.push({
            where: full,
            db_path: dbPath,
            size: info.size,
            modified: info.modified
        });
    }
    return out.sort((a, b) => b.size - a.size);
}

/** Full report for the Settings screen and the Fresh Start confirmation. */
function report(active) {
    return {
        ...active,
        other_copies: otherCopies(active.data_dir),
        // More than one book on disk is the exact condition that made a reset
        // look like it had failed.
        multiple_copies: otherCopies(active.data_dir).length > 0
    };
}

module.exports = { DB_FILENAME, LEGACY_APP_FOLDERS, describe, otherCopies, report, fileInfo };
