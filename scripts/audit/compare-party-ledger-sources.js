#!/usr/bin/env node
/**
 * compare-party-ledger-sources.js
 * ===============================
 * Read-only. Answers one question with numbers: if the Party Ledger were built
 * from the module registers (the way the workbook builds it from its entry
 * sheets), how would each party's balance differ from the stored
 * `ledger_entries` table?
 *
 *   node scripts/audit/compare-party-ledger-sources.js            # live book
 *   node scripts/audit/compare-party-ledger-sources.js <db path>
 *   node scripts/audit/compare-party-ledger-sources.js <db> --json
 *
 * Writes nothing. Never opens the configured database for writing.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const ROOT = path.join(__dirname, '..', '..');
const ledger = require(path.join(ROOT, 'shared', 'operations', 'party_ledger'));

function livePath() {
    try {
        const p = path.join(os.homedir(), 'Library', 'Application Support', 'prarambha-account-stock', 'data', 'dairy-plant.db');
        if (fs.existsSync(p)) return p;
    } catch (e) { /* fall through */ }
    return path.join(ROOT, 'data', 'dairy-plant.db');
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dbPath = args.find(a => !a.startsWith('--')) || livePath();

if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(2);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const report = ledger.reconcileWithStoredLedger(db);

if (asJson) {
    console.log(JSON.stringify(report, null, 1));
    db.close();
    process.exit(0);
}

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`\nParty Ledger source comparison`);
console.log(`  database : ${dbPath}`);
console.log(`  stored   : ledger_entries (written by 11 modules + the Excel import)`);
console.log(`  derived  : module registers via shared/operations/party_ledger.js`);
console.log(`\nStored ledger composition:`);
for (const r of report.by_source_type) {
    console.log(`  ${String(r.reference_type).padEnd(18)} ${String(r.n).padStart(6)} rows   Dr ${money(r.dr).padStart(15)}   Cr ${money(r.cr).padStart(15)}`);
}

console.log(`\nTotals`);
console.log(`  derived Dr ${money(report.totals.derived_debit)}   Cr ${money(report.totals.derived_credit)}`);
console.log(`  stored  Dr ${money(report.totals.stored_debit)}   Cr ${money(report.totals.stored_credit)}`);
console.log(`  net difference ${money(report.totals.difference)}`);
console.log(`  parties matching ${report.totals.parties_matched}, differing ${report.totals.parties_differing}`);

const top = report.parties.filter(p => Math.abs(p.difference) >= 0.005).slice(0, 20);
if (top.length) {
    console.log(`\nLargest differences (derived − stored):`);
    console.log(`  ${'party'.padEnd(30)} ${'derived'.padStart(14)} ${'stored'.padStart(14)} ${'diff'.padStart(14)}  rows(src/led)`);
    for (const p of top) {
        console.log(`  ${String(p.name).slice(0, 30).padEnd(30)} ${money(p.derived_balance).padStart(14)} ${money(p.stored_balance).padStart(14)} ${money(p.difference).padStart(14)}  ${p.source_rows}/${p.stored_rows}`);
    }
}

console.log(`\nNothing was written. Run with --json for the full per-party report.\n`);
db.close();
