#!/usr/bin/env node
/**
 * Excel sync CLI — write each module back into its OWN worksheet.
 *
 *   node scripts/excel-sync.js                     # dry run, every module
 *   node scripts/excel-sync.js --apply             # write (backup first)
 *   node scripts/excel-sync.js sales collection    # chosen modules
 *   node scripts/excel-sync.js bank --apply
 *   node scripts/excel-sync.js --list              # what maps where
 *   node scripts/excel-sync.js --json
 *
 * Never writes Party_Ledger: it is a formula sheet in the workbook.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..');
const sync = require(path.join(ROOT, 'shared', 'excel-sync'));
const { openDatabase } = require(path.join(ROOT, 'shared', 'db'));

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const json = argv.includes('--json');
const list = argv.includes('--list');
const modules = argv.filter(a => !a.startsWith('--'));

function liveDbPath() {
    const live = path.join(require('os').homedir(), 'Library', 'Application Support', 'prarambha-account-stock', 'data', 'dairy-plant.db');
    return fs.existsSync(live) ? live : path.join(ROOT, 'data', 'dairy-plant.db');
}

if (list) {
    console.log('\nModule                Worksheet        Ref prefix');
    console.log('--------------------  ---------------  ----------');
    for (const id of sync.moduleIds()) {
        const m = sync.MODULES[id];
        console.log(`${m.label.padEnd(20)}  ${m.sheet.padEnd(15)}  ${m.idPrefix}`);
    }
    console.log('\nReport-only (no register worksheet):');
    for (const [tab, why] of Object.entries(sync.REPORT_ONLY)) console.log(`  ${tab.padEnd(20)} ${why}`);
    console.log('');
    process.exit(0);
}

const dbPath = process.env.DB_PATH || liveDbPath();
if (!fs.existsSync(dbPath)) { console.error(`Database not found: ${dbPath}`); process.exit(2); }

// Read-only unless we are actually writing to Excel, which never touches the DB.
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const ids = modules.length ? modules : sync.moduleIds();
const results = [];

for (const id of ids) {
    if (!sync.MODULES[id]) { results.push({ module: id, success: false, error: `Unknown module (try --list)` }); continue; }
    results.push(sync.syncModule(db, id, { apply, backup: true }));
}
db.close();

if (json) {
    console.log(JSON.stringify(results, null, 1));
    process.exit(results.every(r => r.success) ? 0 : 1);
}

console.log(`\nExcel write-back — ${apply ? 'APPLY' : 'DRY RUN'}  (database: ${dbPath})\n`);
for (const r of results) {
    if (!r.success) {
        console.log(`  ❌ ${r.module.padEnd(12)} ${r.error}`);
        continue;
    }
    const prefix = r.applied ? '✅' : (r.appended || r.matched ? '•' : '·');
    console.log(`  ${prefix} ${String(r.label).padEnd(20)} → ${String(r.sheet).padEnd(15)} `
        + `update ${String(r.matched).padStart(5)}   append ${String(r.appended).padStart(5)}`
        + (r.orphans && r.orphans.length ? `   orphaned ${r.orphans.length}` : ''));
    if (r.backupPath) console.log(`      backup: ${path.basename(r.backupPath)}`);
}
if (!apply) console.log('\nDry run only. Re-run with --apply to write (a .bak copy is made first).');
console.log('');
process.exit(results.every(r => r.success) ? 0 : 1);
