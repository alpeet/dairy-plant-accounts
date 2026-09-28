#!/usr/bin/env node
/**
 * backup-verified.js — P0 "backup and safety first" tool.
 *
 * Creates a COMPLETE, consistent snapshot of a database via better-sqlite3's
 * Online Backup API (WAL-safe: works while the app is running), then VERIFIES
 * the backup before declaring success:
 *
 *   1. File exists and is non-trivial in size
 *   2. Opens as SQLite and passes PRAGMA integrity_check
 *   3. Core tables present
 *   4. Row counts of core tables match the live database
 *
 * Usage:
 *   node scripts/audit/backup-verified.js [--db <path>] [--dest <path>]
 *
 * Defaults: --db data/dairy-plant.db, --dest data/backups/<prefix>-<timestamp>.db
 * Exit code 0 only if every verification passed.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.resolve(__dirname, '..', '..');

// ── Args ─────────────────────────────────────────────────────────────────────
function arg(name, fallback) {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dbPath = path.resolve(ROOT, arg('--db', 'data/dairy-plant.db'));
const prefix = arg('--prefix', 'pre-trust-pack');
let destPath = arg('--dest', null);
if (!destPath) {
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    destPath = path.join(backupDir, `${prefix}-${ts}.db`);
}
destPath = path.resolve(ROOT, destPath);

// ── Core tables to compare between live DB and backup ────────────────────────
const CORE_TABLES = [
    'parties', 'products', 'sales', 'sales_items', 'purchases', 'purchase_items',
    'milk_collections', 'payments', 'ledger_entries', 'bank_transactions',
    'cash_deposits', 'petty_cash', 'salary_records', 'vehicle_expenses',
    'other_expenses', 'stock_movements', 'audit_log', 'users'
];

function countAll(db) {
    const counts = {};
    for (const t of CORE_TABLES) {
        try { counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c; }
        catch (e) { counts[t] = null; } // table may not exist in older DBs
    }
    return counts;
}

function verify(backupFile, liveCounts) {
    const problems = [];
    if (!fs.existsSync(backupFile)) return ['backup file was not created'];
    const size = fs.statSync(backupFile).size;
    if (size < 4096) problems.push(`backup suspiciously small (${size} bytes)`);

    let probe;
    try {
        probe = new Database(backupFile, { readonly: true, fileMustExist: true });
    } catch (e) {
        return [`backup does not open as SQLite: ${e.message}`];
    }
    try {
        const ic = probe.pragma('integrity_check', { simple: true });
        if (ic !== 'ok') problems.push(`integrity_check: ${ic}`);

        const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        for (const t of CORE_TABLES) {
            if (liveCounts[t] !== null && !tables.includes(t)) problems.push(`core table missing from backup: ${t}`);
        }

        const backupCounts = countAll(probe);
        for (const t of CORE_TABLES) {
            if (liveCounts[t] === null || backupCounts[t] === null) continue;
            if (liveCounts[t] !== backupCounts[t]) {
                problems.push(`row count mismatch on ${t}: live=${liveCounts[t]} backup=${backupCounts[t]}`);
            }
        }
        return { problems, backupCounts, size };
    } finally {
        probe.close();
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('════════════════════════════════════════════════════════');
    console.log(' VERIFIED BACKUP (P0 — safety first)');
    console.log('════════════════════════════════════════════════════════');
    if (!fs.existsSync(dbPath)) {
        console.error(`❌ Live database not found: ${dbPath}`);
        process.exit(1);
    }
    console.log(`  Live DB : ${dbPath}`);

    const live = new Database(dbPath);
    try {
        // Consistent read snapshot for counting (Online Backup API takes its own)
        const liveCounts = countAll(live);
        console.log('  Creating snapshot via Online Backup API (WAL-safe)…');
        await live.backup(destPath);
        console.log(`  Snapshot: ${destPath}`);

        const { problems, backupCounts, size } = verify(destPath, liveCounts) || { problems: ['verify() returned nothing'] };

        console.log('');
        console.log('  Row counts (live = backup must hold):');
        for (const t of CORE_TABLES) {
            if (liveCounts[t] === null) continue;
            const ok = problems.length === 0 || !problems.some(p => p.startsWith(`row count mismatch on ${t}`) || p === `core table missing from backup: ${t}`);
            console.log(`    ${ok ? '✅' : '❌'} ${t.padEnd(20)} ${String(liveCounts[t]).padStart(7)}${backupCounts && backupCounts[t] !== null && backupCounts[t] !== liveCounts[t] ? `  (backup: ${backupCounts[t]})` : ''}`);
        }
        console.log('');
        console.log(`  Backup size: ${(size / 1024 / 1024).toFixed(2)} MB`);

        if (problems.length > 0) {
            console.error('');
            console.error('❌ BACKUP FAILED VERIFICATION — do not treat this file as a recovery point:');
            for (const p of problems) console.error(`   - ${p}`);
            process.exit(1);
        }
        console.log('');
        console.log('✅ BACKUP VERIFIED — safe to proceed with migrations/edits.');
        console.log(`   Recovery path: restore this file over ${dbPath}`);
        process.exit(0);
    } finally {
        live.close();
    }
}

main().catch(err => {
    console.error('❌ Backup failed:', err.message);
    process.exit(1);
});
