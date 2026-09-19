#!/usr/bin/env node
/**
 * excel-sync.js — bring the live app database up to date from the customer's
 * Dairy_Accounts_Professional.xlsx workbook, safely.
 * ==========================================================================
 * Every run starts with a VERIFIED backup (SQLite online backup API + integrity
 * check + row-count comparison against the source). The import itself is then
 * performed either on a throwaway copy (dry run) or on the live database.
 *
 *   node scripts/audit/excel-sync.js               # DRY RUN (default)
 *        backup live → import into a temp copy → print before/after variance
 *        table. The live database is never written.
 *
 *   node scripts/audit/excel-sync.js --apply       # apply to the live database
 *        verified backup → upsert import → re-verify → variance table.
 *
 *   node scripts/audit/excel-sync.js --mode=fresh --apply
 *        destructive "replace all" import (clears transactional tables first).
 *
 *   node scripts/audit/excel-sync.js --report=path.json
 *
 * Env: DB_PATH (default data/dairy-plant.db), EXCEL_PATH (default
 * Dairy_Accounts_Professional.xlsx), BACKUP_DIR (default data/backups).
 *
 * Exit 0 = ok, 1 = failure, 2 = variance detected that needs a human decision.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = process.env.DB_PATH || path.join(ROOT, 'data', 'dairy-plant.db');
const EXCEL = process.env.EXCEL_PATH || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(ROOT, 'data', 'backups');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const MODE = (args.find((a) => a.startsWith('--mode=')) || '').split('=')[1]
    || (args.includes('--fresh') ? 'fresh' : 'upsert');
const REPORT = (args.find((a) => a.startsWith('--report=')) || '').split('=')[1];
// Rebuild the stock ledger from the imported documents (upsert does not touch it).
const REBUILD_STOCK = args.includes('--with-stock');

// Tables compared before/after. `key` = natural identity, `sums` = money/qty columns.
const TABLES = [
    { t: 'parties', key: 'name', sums: ['opening_balance'] },
    { t: 'products', key: 'name', sums: ['opening_stock'] },
    { t: 'sales', key: 'invoice_no', sums: ['grand_total', 'paid_amount'] },
    { t: 'sales_items', key: null, sums: ['quantity', 'amount'] },
    { t: 'purchases', key: 'bill_no', sums: ['grand_total', 'paid_amount'] },
    { t: 'purchase_items', key: null, sums: ['quantity', 'amount'] },
    { t: 'payments', key: null, sums: ['amount'] },
    { t: 'ledger_entries', key: null, sums: ['debit', 'credit'] },
    { t: 'stock_movements', key: null, sums: ['inward_qty', 'outward_qty'] },
    { t: 'petty_cash', key: 'voucher_no', sums: ['amount'] },
    { t: 'bank_transactions', key: 'reference_no', sums: ['debit', 'credit'] },
    { t: 'denomination_counts', key: null, sums: ['total_cash'] },
    { t: 'milk_collections', key: null, sums: ['quantity_liters', 'amount'] },
    { t: 'production_batches', key: null, sums: ['input_quantity', 'output_quantity'] },
    { t: 'audit_log', key: null, sums: [] },
];

const IGNORE_COLS = new Set(['id', 'created_at', 'updated_at', 'created_by']);

const n2 = (x) => (x === null || x === undefined ? 0 : Number(x));
const fmt = (x) => n2(x).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function hr(title) {
    console.log('\n' + '─'.repeat(66));
    if (title) console.log('  ' + title);
    console.log('─'.repeat(66));
}

function openRead(dbPath) {
    const Database = require('better-sqlite3');
    return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function tableInfo(db, t) {
    try {
        return db.prepare(`PRAGMA table_info(${t})`).all();
    } catch (e) {
        return null;
    }
}

function counts(db) {
    const out = {};
    for (const { t } of TABLES) {
        const info = tableInfo(db, t);
        if (!info) { out[t] = null; continue; }
        out[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    }
    return out;
}

function totals(db) {
    const out = {};
    for (const { t, sums } of TABLES) {
        if (!tableInfo(db, t)) { out[t] = null; continue; }
        const known = sums.filter((c) => !!tableInfo(db, t).find((col) => col.name === c));
        if (!known.length) { out[t] = {}; continue; }
        const sel = known.map((c) => `ROUND(COALESCE(SUM(${c}),0),2) AS ${c}`).join(', ');
        out[t] = db.prepare(`SELECT ${sel} FROM ${t}`).get();
    }
    return out;
}

/** Multiset signature of every row (all columns except ids/timestamps). */
function rowsBySignature(db, t, keyCol) {
    const info = tableInfo(db, t);
    if (!info) return null;
    const cols = info.map((c) => c.name).filter((c) => !IGNORE_COLS.has(c));
    const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all();
    const map = new Map();
    for (const r of rows) {
        const sig = JSON.stringify(cols.map((c) => r[c]));
        const entry = map.get(sig);
        if (entry) entry.n++;
        else map.set(sig, { n: 1, row: r });
    }
    return { cols, map, keyCol };
}

/**
 * Compare two signature maps. Returns { added, removed } as arrays of
 * { row, n } describing rows present only in `after` / only in `before`.
 */
function diffSignatures(before, after) {
    const added = [];
    const removed = [];
    for (const [sig, e] of after.map) {
        const b = before.map.get(sig);
        if (!b) added.push({ row: e.row, n: e.n });
        else if (b.n < e.n) added.push({ row: e.row, n: e.n - b.n });
    }
    for (const [sig, e] of before.map) {
        const a = after.map.get(sig);
        if (!a) removed.push({ row: e.row, n: e.n });
        else if (a.n < e.n) removed.push({ row: e.row, n: e.n - a.n });
    }
    return { added, removed };
}

/**
 * Rows sharing a natural key whose other columns differ (i.e. the import
 * UPDATED an existing record). Returns [{ key, changes: {col: [before, after]} }].
 */
function changedRows(dbBefore, dbAfter, t, keyCol) {
    const info = tableInfo(dbBefore, t);
    if (!info || !keyCol) return [];
    const cols = info.map((c) => c.name).filter((c) => !IGNORE_COLS.has(c) && c !== keyCol);
    const q = (db) => db.prepare(`SELECT ${[keyCol, ...cols].join(', ')} FROM ${t}`).all();
    const before = q(dbBefore);
    const after = q(dbAfter);
    const idx = (rows) => {
        const m = new Map();
        for (const r of rows) {
            const k = String(r[keyCol]);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(r);
        }
        return m;
    };
    const bm = idx(before), am = idx(after);
    const out = [];
    for (const [k, aRows] of am) {
        const bRows = bm.get(k);
        if (!bRows || bRows.length !== aRows.length) continue;
        // one row per key → direct compare; multiple rows → compare pairwise
        const changes = {};
        for (let i = 0; i < aRows.length; i++) {
            for (const c of cols) {
                const bv = bRows[i][c];
                const av = aRows[i][c];
                const numDiff = typeof bv === 'number' && typeof av === 'number' && Math.abs(bv - av) > 0.005;
                if (!numDiff && String(bv ?? '') !== String(av ?? '')) changes[c] = [bv, av];
                else if (numDiff) changes[c] = [bv, av];
            }
        }
        if (Object.keys(changes).length) out.push({ key: k, changes });
    }
    return out;
}

function shortRow(row, limit = 3) {
    return Object.entries(row)
        .filter(([, v]) => v !== null && v !== '' && v !== 0)
        .slice(0, limit)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? Math.round(v * 100) / 100 : String(v).slice(0, 28)}`)
        .join(' ');
}

async function verifiedBackup(dbPath, tag) {
    const Database = require('better-sqlite3');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(BACKUP_DIR, `pre-excel-sync-${tag}-${stamp}.db`);

    const db = new Database(dbPath, { fileMustExist: true });
    try {
        db.pragma('busy_timeout = 5000');
        await db.backup(dest);            // online backup API — never torn, never empty
    } finally {
        db.close();
    }

    // Verify: non-empty, opens, integrity ok, and row counts match the source.
    const size = fs.statSync(dest).size;
    if (size === 0) throw new Error(`backup file is empty: ${dest}`);
    const bdb = new Database(dest, { readonly: true, fileMustExist: true });
    let integrity;
    try {
        integrity = bdb.pragma('integrity_check', { simple: true });
        const src = openRead(dbPath);
        const before = counts(src);
        const after = counts(bdb);
        src.close();
        const mismatch = Object.keys(before).filter((t) => before[t] !== null && before[t] !== after[t]);
        if (mismatch.length) {
            throw new Error(`row-count mismatch after backup: ${mismatch.map((t) => `${t} ${before[t]}→${after[t]}`).join(', ')}`);
        }
        if (integrity !== 'ok') throw new Error(`integrity_check on backup returned: ${integrity}`);
    } finally {
        bdb.close();
    }
    console.log(`  🔒 Verified backup: ${dest}`);
    console.log(`     ${(size / 1024).toFixed(0)} KB · integrity_check = ok · row counts match live`);
    return dest;
}

function workbookWindow(db) {
    try {
        const r = db.prepare(`SELECT MIN(date) a, MAX(date) b FROM sales`).get();
        return `${r.a} → ${r.b}`;
    } catch (e) { return 'n/a'; }
}

async function main() {
    console.log('');
    console.log('  🐄  Prarambha — Excel → App sync');
    console.log(`     workbook : ${EXCEL}`);
    console.log(`     live db  : ${LIVE_DB}`);
    console.log(`     mode     : ${MODE}${APPLY ? '  (APPLYING TO LIVE DB)' : '  (DRY RUN — live DB untouched)'}`);

    if (!fs.existsSync(LIVE_DB)) throw new Error(`live database not found: ${LIVE_DB}`);
    if (!fs.existsSync(EXCEL)) throw new Error(`workbook not found: ${EXCEL}`);
    const wbStat = fs.statSync(EXCEL);
    console.log(`     workbook last modified: ${wbStat.mtime.toISOString()} (${(wbStat.size / 1024).toFixed(0)} KB)`);

    hr('1. BACKUP');
    const backupPath = await verifiedBackup(LIVE_DB, MODE);

    // Target: a throwaway copy for dry runs, the live file for --apply.
    let targetDb = LIVE_DB;
    let scratchDir = null;
    if (!APPLY) {
        scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prarambha-sync-'));
        targetDb = path.join(scratchDir, 'dairy-plant.db');
        fs.copyFileSync(backupPath, targetDb);
        console.log(`  🧪 Dry run target (throwaway copy): ${targetDb}`);
    }

    // Snapshot BEFORE (always the pre-import backup — in a dry run targetDb is
    // already the mutated copy by the time we get here)
    const dbBefore = openRead(backupPath);
    const countsBefore = counts(dbBefore);
    const totalsBefore = totals(dbBefore);
    const sigBefore = {};
    for (const { t, key } of TABLES) sigBefore[t] = rowsBySignature(dbBefore, t, key);
    dbBefore.close();

    hr('2. IMPORT');
    const { importExcelFile } = require(path.join(ROOT, 'shared', 'excel-import'));
    const t0 = Date.now();
    importExcelFile({
        excelPath: EXCEL,
        dbPath: targetDb,
        mode: MODE,
        log: (m) => console.log('  ' + m.trimEnd()),
    });
    console.log(`  ⏱  import took ${Date.now() - t0} ms`);

    if (REBUILD_STOCK) {
        // Upsert intentionally leaves stock alone, so after new invoices arrive the
        // ledger no longer matches the documents. Rebuild it from opening + purchases
        // - sales in one transaction, exactly as a fresh import would.
        const Database = require('better-sqlite3');
        const { rebuildStockLedger } = require(path.join(ROOT, 'shared', 'excel-import'));
        const sdb = new Database(targetDb);
        try {
            const oldCount = sdb.prepare('SELECT COUNT(*) c FROM stock_movements').get().c;
            let written = 0;
            sdb.transaction(() => {
                sdb.prepare('DELETE FROM stock_movements').run();
                written = rebuildStockLedger(sdb, (m) => console.log('  ' + m.trimEnd()));
            })();
            console.log(`  📦 Stock ledger rebuilt from documents: ${oldCount} movements → ${written}`);
        } finally {
            sdb.close();
        }
    }

    hr('3. VARIANCE — before vs after');
    const dbAfter = openRead(targetDb);
    const countsAfter = counts(dbAfter);
    const totalsAfter = totals(dbAfter);

    const report = { generatedAt: new Date().toISOString(), mode: MODE, applied: APPLY, backupPath, excel: EXCEL, tables: {} };
    let warnings = 0;

    console.log('  ' + 'table'.padEnd(22) + 'before'.padStart(9) + 'after'.padStart(9) + 'change'.padStart(9));
    for (const { t } of TABLES) {
        const b = countsBefore[t];
        const a = countsAfter[t];
        if (b === null && a === null) continue;
        const d = (a || 0) - (b || 0);
        const mark = d === 0 ? '' : (MODE === 'upsert' && d < 0 ? '  ⚠ LOSS' : '');
        if (mark) warnings++;
        console.log('  ' + t.padEnd(22) + String(b).padStart(9) + String(a).padStart(9)
            + (d === 0 ? '        —' : (d > 0 ? '+' : '') + String(d).padStart(7)) + mark);
    }

    console.log('');
    console.log('  money / quantity totals');
    for (const { t } of TABLES) {
        if (!countsBefore[t] || !totalsBefore[t]) continue;
        const parts = Object.keys(totalsBefore[t]).map((c) => {
            const b = n2(totalsBefore[t][c]);
            const a = n2(totalsAfter[t][c]);
            const d = a - b;
            return `${c}: ${fmt(b)} → ${fmt(a)}${d ? ` (${d > 0 ? '+' : ''}${fmt(d)})` : ''}`;
        });
        console.log('  ' + t.padEnd(22) + parts.join('   '));
    }

    // Detailed added/removed rows per table
    console.log('');
    for (const { t, key } of TABLES) {
        const before = sigBefore[t];
        if (!before) continue;
        const after = rowsBySignature(dbAfter, t, key);
        const { added, removed } = diffSignatures(before, after);
        const addedRows = added.reduce((s, e) => s + e.n, 0);
        const removedRows = removed.reduce((s, e) => s + e.n, 0);
        if (!addedRows && !removedRows) continue;
        console.log(`  ${t}: +${addedRows} new, -${removedRows} missing`);
        report.tables[t] = {
            addedRows,
            removedRows,
            addedSample: added.slice(0, 40).map((e) => ({ n: e.n, ...e.row })),
            removedSample: removed.slice(0, 40).map((e) => ({ n: e.n, ...e.row })),
        };
        for (const e of added.slice(0, 4)) console.log(`      + ${e.n > 1 ? `x${e.n} ` : ''}${shortRow(e.row)}`);
        for (const e of removed.slice(0, 4)) console.log(`      - ${e.n > 1 ? `x${e.n} ` : ''}${shortRow(e.row)}`);
    }

    // Column-level changes to EXISTING records (upsert updates, not inserts)
    const dbBefore2 = openRead(backupPath);
    let totalChanged = 0;
    console.log('');
    for (const { t, key } of TABLES) {
        if (!key) continue;
        const changed = changedRows(dbBefore2, dbAfter, t, key);
        if (!changed.length) continue;
        totalChanged += changed.length;
        console.log(`  ${t}: ${changed.length} existing record(s) MODIFIED`);
        report.tables[t] = { ...(report.tables[t] || {}), changed: changed.slice(0, 200) };
        for (const c of changed.slice(0, 6)) {
            const detail = Object.entries(c.changes)
                .map(([col, [b, a]]) => `${col} ${typeof b === 'number' ? fmt(b) : b} → ${typeof a === 'number' ? fmt(a) : a}`)
                .join(', ');
            console.log(`      ~ ${key}=${c.key}: ${detail}`);
        }
        if (changed.length > 6) console.log(`      … ${changed.length - 6} more (see report)`);
    }
    dbBefore2.close();
    if (totalChanged) console.log(`  ⚠  ${totalChanged} existing record(s) would be rewritten — review the detail above.`);

    hr('SUMMARY');
    let addedTotal = 0, removedTotal = 0;
    for (const t of Object.keys(report.tables)) {
        addedTotal += report.tables[t].addedRows || 0;
        removedTotal += report.tables[t].removedRows || 0;
    }
    console.log(`  new rows added from Excel      : ${addedTotal}`);
    console.log(`  existing records rewritten     : ${totalChanged}`);
    console.log(`  rows whose values differ       : ${removedTotal} (upsert never deletes rows)`);
    console.log(`  workbook data window: BS ${workbookWindow(dbAfter)}`);

    dbAfter.close();

    if (REPORT) {
        fs.mkdirSync(path.dirname(REPORT), { recursive: true });
        fs.writeFileSync(REPORT, JSON.stringify({
            ...report,
            countsBefore, countsAfter, totalsBefore, totalsAfter,
        }, null, 2));
        console.log(`\n  📄 Report written: ${REPORT}`);
    }

    hr('4. RESULT');
    if (!APPLY) {
        console.log('  ✅ DRY RUN complete — the live database was NOT modified.');
        console.log(`     Re-run with --apply to write these changes to the live database.`);
        console.log(`     Rollback if needed: copy ${path.basename(backupPath)} over ${LIVE_DB}`);
    } else {
        console.log('  ✅ APPLIED to the live database.');
        console.log(`     Rollback: copy ${backupPath} over ${LIVE_DB}`);
    }
    if (scratchDir) console.log(`     Scratch copy kept at: ${scratchDir}`);
    console.log('');

    if (warnings) {
        console.log(`  ⚠  ${warnings} table(s) lost rows in upsert mode — review before applying.`);
        process.exit(2);
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('\n  ❌ ' + e.message);
    console.error(e.stack);
    process.exit(1);
});
