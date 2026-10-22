/**
 * Locate the operator's workbook.
 * =============================================================
 * The workbook is a file the user renames freely ("… TRIAL.xlsx" while
 * testing, "…Professional.xlsx" in production). Scripts and tests used to
 * hardcode one name, so the whole audit suite failed the day the file was
 * renamed — a test failure that said nothing about the code.
 *
 * Resolution order:
 *   1. an explicit path passed in (returned unchanged)
 *   2. WORKBOOK_PATH from the environment
 *   3. the first existing candidate name, in preference order
 *   4. the default name, so the caller's own "file not found" error still
 *      names the file it expected.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const CANDIDATES = [
    'Dairy_Accounts_Professional.xlsx',
    'Dairy_Accounts_Professional TRIAL.xlsx',
    'Dairy_Accounts_Professional_TRIAL.xlsx'
];

function workbookPath(explicit) {
    if (explicit) return explicit;
    if (process.env.WORKBOOK_PATH) return process.env.WORKBOOK_PATH;
    for (const name of CANDIDATES) {
        const full = path.join(ROOT, name);
        if (fs.existsSync(full)) return full;
    }
    return path.join(ROOT, CANDIDATES[0]);
}

/** true when a workbook is actually present on disk. */
function workbookExists(explicit) {
    return fs.existsSync(workbookPath(explicit));
}

module.exports = { ROOT, CANDIDATES, workbookPath, workbookExists };
