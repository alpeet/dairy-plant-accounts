#!/usr/bin/env node
/**
 * add-monthly-report-sheet.js — put the Monthly Report into the customer's OWN
 * workbook (`Dairy_Accounts_Professional.xlsx`) without replacing it.
 * ========================================================================
 *   node scripts/audit/add-monthly-report-sheet.js                       # dry run
 *   node scripts/audit/add-monthly-report-sheet.js --apply               # write
 *   node scripts/audit/add-monthly-report-sheet.js --apply --month=2083-06
 *   node scripts/audit/add-monthly-report-sheet.js --apply --from=2083-01-01 --to=2083-06-31
 *
 * What it does
 *  1. records the real six-month advance rent (Rs 910,000 to SAI KRIPA KSS LTD,
 *     2083-06-30) as a PREPAID expense if it is not already recorded — that is
 *     what keeps it out of one month's P&L;
 *  2. builds the "Monthly Report " sheet from shared/operations/monthly_report.js
 *     (the same engine the app screen uses, so both agree);
 *  3. copies the workbook to `<file>.bak-monthly-report-<timestamp>` first, then
 *     writes the sheet in and leaves every other sheet exactly as it was.
 *
 * Env:
 *   DB_PATH        app database (default: the installed app's userData DB when it
 *                  exists, else ./data/dairy-plant.db)
 *   WORKBOOK_PATH  workbook to modify (default ./Dairy_Accounts_Professional.xlsx)
 *
 * Exit 0 = done (or dry run OK), 1 = failure.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (name) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
};

const LIVE_DB = path.join(os.homedir(), 'Library', 'Application Support',
    'prarambha-account-stock', 'data', 'dairy-plant.db');
const DB_PATH = process.env.DB_PATH
    || (fs.existsSync(LIVE_DB) ? LIVE_DB : path.join(ROOT, 'data', 'dairy-plant.db'));
const WORKBOOK = process.env.WORKBOOK_PATH
    || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');

const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const bs = require(path.join(ROOT, 'shared', 'bs-calendar'));
const prepaid = require(path.join(ROOT, 'shared', 'operations', 'prepaid_rent'));
const monthly = require(path.join(ROOT, 'shared', 'operations', 'monthly_report'));
const exporter = require(path.join(ROOT, 'shared', 'export-monthly-report'));

const hr = (t) => console.log('\n' + '─'.repeat(70) + (t ? `\n  ${t}` : ''));

function firstDocumentDate(db) {
    const pick = (sql) => {
        try {
            const r = db.prepare(sql).get();
            return r ? r.d : null;
        } catch (e) { return null; }
    };
    const dates = [
        pick('SELECT MIN(date) d FROM sales'),
        pick('SELECT MIN(date) d FROM purchases'),
        pick('SELECT MIN(date) d FROM milk_collections'),
        pick('SELECT MIN(date) d FROM payments')
    ].filter(Boolean).sort();
    return dates.length ? dates[0] : null;
}

function main() {
    if (!fs.existsSync(DB_PATH)) {
        console.error(`Database not found: ${DB_PATH}`);
        process.exit(1);
    }
    if (!fs.existsSync(WORKBOOK)) {
        console.error(`Workbook not found: ${WORKBOOK}`);
        process.exit(1);
    }

    hr('SOURCE');
    console.log(`  Database : ${DB_PATH}`);
    console.log(`  Workbook : ${WORKBOOK}`);

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // ── 1. The real advance rent ──
    const seed = prepaid.seedAdvanceRent(db, null);
    console.log(`  Advance rent : ${seed.duplicate ? 'already recorded' : 'recorded'} `
        + `(id ${seed.id}, Rs ${seed.record.amount}, ${seed.record.months} months from ${seed.record.start_month})`);

    // ── 2. Period ──
    const latest = monthly.latestDocumentDate(db);
    const from = argVal('from') || firstDocumentDate(db) || '2083-01-01';
    const month = argVal('month') || null;
    const to = argVal('to') || latest.latest_document_date || bs.todayBSDate();
    const opts = month ? { month } : { from_date: from, to_date: to };

    const built = exporter.buildMonthlyReportSheet(db, opts);
    const r = built.report;
    hr('REPORT');
    console.log(`  Period        : ${r.from_date} → ${r.to_date} (BS)`);
    console.log(`  Months        : ${r.month_count}`);
    console.log(`  Sales revenue : ${r.summary.sales_revenue}`);
    console.log(`  COGS          : ${r.summary.cogs}`);
    console.log(`  Gross profit  : ${r.summary.gross_profit}`);
    console.log(`  Net profit    : ${r.summary.net_profit}`);
    console.log(`  Closing cash  : ${r.summary.closing_cash}   bank: ${r.summary.closing_bank}`);
    console.log(`  Prepaid rent  : ${r.summary.prepaid_rent}`);
    console.log(`  Sheet rows    : ${built.rows.length}`);
    console.log(`  Reconciliation: ${r.reconciliation.all_ok ? 'all checks agree'
        : `${r.reconciliation.differences.length} FLAGGED → ${r.reconciliation.differences.map(c => c.check).join('; ')}`}`);

    const lock = path.join(path.dirname(WORKBOOK), `~$${path.basename(WORKBOOK)}`);
    if (fs.existsSync(lock)) {
        console.log(`\n  ⚠  ${path.basename(lock)} exists — the workbook looks open in Excel.`);
        console.log('     Close it before applying so Excel does not overwrite the new sheet.');
    }

    if (!APPLY) {
        hr('DRY RUN — nothing written');
        console.log('  Re-run with --apply to record the rent and write the sheet.');
        return;
    }

    // ── 3. Write the sheet into the existing workbook ──
    const before = XLSX.readFile(WORKBOOK).SheetNames;
    const res = exporter.insertMonthlyReportSheet(WORKBOOK, db, opts);
    if (!res.success) {
        console.error('\n  ✗ ' + res.error);
        process.exit(1);
    }
    hr('WRITTEN');
    console.log(`  Sheet         : "${res.sheetName}" (${res.created ? 'added' : 'refreshed'}), ${res.rows} rows`);
    console.log(`  Backup        : ${res.backupPath}`);
    const after = XLSX.readFile(WORKBOOK).SheetNames;
    const lost = before.filter(s => !after.includes(s));
    console.log(`  Sheets before : ${before.length}; after: ${after.length}${lost.length ? ` — LOST: ${lost.join(', ')}` : ' (all preserved)'}`);
    if (lost.length) process.exit(1);
}

try {
    main();
} catch (err) {
    console.error('\n✗ Failed:', err.message);
    process.exit(1);
}
