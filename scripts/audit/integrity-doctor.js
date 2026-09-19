#!/usr/bin/env node
/**
 * Data Integrity Doctor — command line
 * ====================================
 * Runs the same read-only checks as the app's "Data Integrity" screen.
 * NEVER writes: the database is opened read-only when possible.
 *
 * Usage:
 *   node scripts/audit/integrity-doctor.js                 # data/dairy-plant.db
 *   node scripts/audit/integrity-doctor.js path/to.db
 *   node scripts/audit/integrity-doctor.js --only=stock    # one check or category
 *   node scripts/audit/integrity-doctor.js --limit=20      # issues shown per check
 *   node scripts/audit/integrity-doctor.js --json          # raw JSON (for cron/CI)
 *
 * Exit code: 0 = every check passed, 1 = at least one check found problems.
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const sqlite = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const Database = sqlite.Database || sqlite.default || sqlite;
const { runIntegrityChecks } = require(path.join(ROOT, 'shared', 'operations', 'integrity.js'));

// ── Args ──
const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of args) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] === undefined ? '1' : m[2];
    else positional.push(a);
}

const dbPath = positional[0] || path.join(ROOT, 'data', 'dairy-plant.db');
if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(2);
}

// Prefer a true read-only handle; fall back if the WAL sidecars are unavailable.
let db;
try {
    db = new Database(dbPath, { readonly: true });
    db.prepare('SELECT 1').get();
} catch (err) {
    try { if (db) db.close(); } catch (e) { /* ignore */ }
    db = new Database(dbPath);
}

let report;
try {
    report = runIntegrityChecks(db, { limit: flags.limit, only: flags.only });
} catch (err) {
    console.error('Integrity check failed to run:', err.message);
    process.exit(2);
} finally {
    try { db.close(); } catch (e) { /* ignore */ }
}

if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    const bar = '─'.repeat(78);
    console.log(bar);
    console.log(`DATA INTEGRITY DOCTOR   ${report.generated_at}   (${report.duration_ms} ms, read-only)`);
    console.log(`Database: ${report.database || dbPath}`);
    console.log(bar);
    console.log(report.summary.headline);
    console.log('');

    let category = '';
    for (const c of report.checks) {
        if (c.category !== category) { category = c.category; console.log(`\n■ ${category.toUpperCase()}`); }
        const tag = c.status === 'pass' ? 'PASS' : (c.status === 'error' ? 'ERR ' : 'FAIL');
        const count = c.status === 'pass' ? '' : `  (${c.issue_count} issue${c.issue_count === 1 ? '' : 's'})`;
        console.log(`  [${tag}] ${c.title}${count}`);
        if (c.note) console.log(`         ${c.note}`);
        if (c.error) console.log(`         error: ${c.error}`);
        for (const i of c.issues) {
            console.log(`         • ${i.label}`);
            console.log(`           ${i.problem}`);
            if (i.expected !== '' || i.actual !== '') {
                console.log(`           expected ${i.expected} · found ${i.actual}${i.difference !== '' ? ` · difference ${i.difference}` : ''}`);
            }
            if (i.detail) console.log(`           ${i.detail}`);
        }
        if (c.truncated) console.log(`         … more issues not shown (use --limit=…)`);
    }
    console.log(`\n${bar}`);
}

process.exit(report.summary.failed > 0 ? 1 : 0);
