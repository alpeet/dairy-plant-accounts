#!/usr/bin/env node
/**
 * copy-settings.js — copy the settings table from one database into another.
 *
 * WHY THIS EXISTS
 * Company settings (business_name, business_pan, smtp_* …) live ONLY in the
 * settings table of each database. They are NOT part of the Excel import,
 * NOT part of the Excel export, and the in-app restore picker only sees
 * backups inside the same install's data/backups folder. Moving to a new
 * install therefore starts with blank company details even though business
 * data comes across via the bundled workbook.
 *
 * USAGE
 *   node scripts/audit/copy-settings.js --source <db> --target <db> [--all] [--dry-run] [--no-backup]
 *
 *   default     : fill only — writes a value where the target key is missing or blank
 *   --all       : overwrite every target key that has a non-blank source value
 *   --dry-run   : show what would change, write nothing
 *   --no-backup : skip the automatic safety backup of the target (not recommended)
 *
 * A backup of the target is written next to it as <target>.pre-settings-<ts>
 * before any change (unless --no-backup). smtp_pass values are masked in output.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function parseArgs(argv) {
    const args = { source: null, target: null, all: false, dryRun: false, noBackup: false };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--source') args.source = argv[++i];
        else if (a === '--target') args.target = argv[++i];
        else if (a === '--all') args.all = true;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--no-backup') args.noBackup = true;
        else if (a === '--help' || a === '-h') args.help = true;
    }
    return args;
}

function mask(key, value) {
    if (/pass|secret|token/i.test(key) && value) {
        return value.slice(0, 2) + '•••••• (masked)';
    }
    return value;
}

function main() {
    const args = parseArgs(process.argv);
    if (args.help || !args.source || !args.target) {
        console.log('Usage: node scripts/audit/copy-settings.js --source <db> --target <db> [--all] [--dry-run] [--no-backup]');
        process.exit(args.help ? 0 : 1);
    }
    if (!fs.existsSync(args.source)) { console.error('❌ Source not found: ' + args.source); process.exit(1); }
    if (!fs.existsSync(args.target)) { console.error('❌ Target not found: ' + args.target); process.exit(1); }
    if (path.resolve(args.source) === path.resolve(args.target)) {
        console.error('❌ Source and target are the same file.');
        process.exit(1);
    }

    const src = new Database(args.source, { readonly: true });
    const srcRows = src.prepare('SELECT key, value FROM settings ORDER BY key').all();
    src.close();

    const tgt = new Database(args.target);
    const tgtRows = tgt.prepare('SELECT key, value FROM settings ORDER BY key').all();
    const tgtMap = new Map(tgtRows.map(r => [r.key, r.value]));

    const upsert = tgt.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

    const SYSTEM_KEYS = new Set(['app_version']); // app-managed, never copy
    const plan = [];
    for (const r of srcRows) {
        if (SYSTEM_KEYS.has(r.key)) continue;
        const value = String(r.value ?? '').trim();
        if (!value) continue; // never copy blank source values
        const current = tgtMap.get(r.key);
        const currentTrimmed = String(current ?? '').trim();
        const willWrite = args.all ? currentTrimmed !== value : currentTrimmed === '';
        if (willWrite) plan.push({ key: r.key, from: currentTrimmed, to: value });
    }

    console.log(`Source: ${args.source}  (${srcRows.length} settings keys)`);
    console.log(`Target: ${args.target}  (${tgtRows.length} settings keys)`);
    console.log(`Mode  : ${args.all ? 'OVERWRITE (--all)' : 'fill-blank-only'}`);
    console.log('');
    if (plan.length === 0) {
        console.log('✅ Nothing to do — target already has a value for every non-blank source setting.');
        tgt.close();
        return;
    }
    console.log('Changes:');
    for (const p of plan) {
        const from = p.from === '' ? '(blank)' : mask(p.key, p.from);
        console.log(`  ${p.key.padEnd(24)} ${from}  →  ${mask(p.key, p.to)}`);
    }

    if (args.dryRun) {
        console.log('\n(dry run — nothing written)');
        tgt.close();
        return;
    }

    if (!args.noBackup) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = args.target + '.pre-settings-' + ts;
        try { tgt.pragma('wal_checkpoint(TRUNCATE)'); } catch (_) { /* non-WAL or busy — copy still safe */ }
        fs.copyFileSync(args.target, backupPath);
        console.log(`\n🛟 Safety backup of target: ${backupPath}`);
    }

    const tx = tgt.transaction(() => {
        for (const p of plan) upsert.run(p.key, p.to);
    });
    tx();

    const after = tgt.prepare('SELECT COUNT(*) c FROM settings').get().c;
    console.log(`✅ Applied ${plan.length} setting(s). Target now has ${after} keys.`);
    tgt.close();
}

main();
