#!/usr/bin/env node
/**
 * cleanup-trial1.js — remove all Trial1 test data from the live DB.
 *
 * Safety properties:
 *  - Backup file written before any change
 *  - Every delete runs inside ONE transaction (all-or-nothing)
 *  - Schema-aware: deletes any row whose text columns contain 'trial1'
 *    (case-insensitive), covering every table the full-scan found
 *  - Verifies zero remaining hits afterwards
 *  - Appends an audit_log entry documenting the cleanup
 *  - Never touches users other than 'trial1', never touches masters
 *    beyond the Trial1-created ones (parties 389-392, product 14, route 5)
 *
 * Usage: node scripts/audit/cleanup-trial1.js [--db <path>] [--apply]
 * Without --apply it runs in DRY-RUN mode and reports what it would delete.
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
let dbPath = 'data/dairy-plant.db';
const dbIdx = args.indexOf('--db');
if (dbIdx >= 0 && args[dbIdx + 1]) dbPath = args[dbIdx + 1];

const root = path.resolve(__dirname, '..', '..');
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));
const log = m => console.log(m);

if (apply) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = dbPath + '.pre-trial1-cleanup-' + stamp;
    fs.copyFileSync(path.join(root, dbPath), path.join(root, backupPath));
    log(`💾 Safety backup: ${backupPath}`);
}

const db = new Database(path.join(root, dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(t => t.name);

// ── Phase 1: collect every Trial1 row (schema-aware scan) ──
const plan = [];
for (const tbl of tables) {
    const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().filter(c => /CHAR|TEXT|CLOB/i.test(c.type || '') || c.type === '');
    const cond = cols.map(c => `"${c.name}" LIKE '%trial1%' COLLATE NOCASE`).join(' OR ');
    if (!cond) continue;
    try {
        const ids = db.prepare(`SELECT rowid FROM "${tbl}" WHERE ${cond}`).all().map(r => r.rowid);
        if (ids.length) plan.push({ tbl, ids });
    } catch (e) { /* WITHOUT ROWID table — skip */ }
}

log('\n── Cleanup plan ──');
let total = 0;
for (const { tbl, ids } of plan) {
    log(`   ${tbl}: ${ids.length} row(s)`);
    total += ids.length;
}
log(`   TOTAL: ${total} row(s) across ${plan.length} table(s)`);

// ── Phase 2: known-id masters (belt & braces — text scan already covers these
//    via name/notes, but delete them explicitly by exact id) ──
const masterIds = {
    parties: [389, 390, 391, 392],
    products: [14],
    routes: [5],
};
const explicitPlan = [];
for (const [tbl, ids] of Object.entries(masterIds)) {
    const placeholders = ids.map(() => '?').join(',');
    const hits = db.prepare(`SELECT id FROM ${tbl} WHERE id IN (${placeholders})`).all(...ids);
    if (hits.length) explicitPlan.push({ tbl, ids: hits.map(h => h.id) });
}

// user 'trial1'
const trialUser = db.prepare("SELECT id FROM users WHERE username = 'trial1' COLLATE NOCASE").get();

if (!apply) {
    log('\n[DRY RUN] No changes made. Re-run with --apply to execute.');
    if (trialUser) log(`[DRY RUN] Would delete user 'trial1' (id ${trialUser.id})`);
    explicitPlan.forEach(({ tbl, ids }) => log(`[DRY RUN] Would delete ${tbl} ids: ${ids.join(',')}`));
    db.close();
    process.exit(0);
}

// ── Phase 3: execute in ONE transaction ──
let deleted = 0;
const deletedRows = [];
const trx = db.transaction(() => {
    // Children first (explicit high-fanout tables), then generic scan.
    const order = [
        'sales_items', 'purchase_items', 'production_inputs', 'production_outputs',
        'production_batches', 'stock_movements', 'ledger_entries', 'milk_collections',
        'payments', 'bank_transactions', 'cash_collections', 'salary_records',
        'partner_capital', 'sales', 'purchases', 'parties', 'products', 'routes', 'users',
    ];
    const byTable = Object.fromEntries(plan.map(p => [p.tbl, p.ids]));
    // merge explicit master ids into plan
    for (const { tbl, ids } of explicitPlan) {
        byTable[tbl] = [...new Set([...(byTable[tbl] || []), ...ids])];
    }
    if (trialUser) byTable.users = [...new Set([...(byTable.users || []), trialUser.id])];

    for (const tbl of order) {
        const ids = byTable[tbl];
        if (!ids || !ids.length) continue;
        const placeholders = ids.map(() => '?').join(',');
        const info = db.prepare(`DELETE FROM "${tbl}" WHERE rowid IN (${placeholders})`).run(...ids);
        deleted += info.changes;
        deletedRows.push(`${tbl}:${info.changes}`);
    }

    // Audit trail entry (append-only table — insert, never update)
    try {
        db.prepare(`INSERT INTO audit_log (user_id, username, action, table_name, record_id, old_value, new_value, ip, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
          .run(null, 'system-cleanup', 'DELETE', 'trial1_cleanup', null,
               JSON.stringify(deletedRows), null, 'localhost');
    } catch (e) {
        // audit_log schema differs — try minimal columns
        try {
            db.prepare(`INSERT INTO audit_log (username, action, table_name, details, created_at)
                        VALUES (?, ?, ?, ?, datetime('now'))`)
              .run('system-cleanup', 'DELETE', 'trial1_cleanup', JSON.stringify(deletedRows));
        } catch (e2) { log(`   ⚠ audit_log write skipped: ${e2.message.slice(0, 80)}`); }
    }
});
trx();

log(`\n── Deleted: ${deleted} row(s)`);
log('   ' + deletedRows.join(', '));

// ── Phase 4: verify ──
let remaining = 0;
for (const tbl of tables) {
    const cols = db.prepare(`PRAGMA table_info("${tbl}")`).all().filter(c => /CHAR|TEXT|CLOB/i.test(c.type || '') || c.type === '');
    const cond = cols.map(c => `"${c.name}" LIKE '%trial1%' COLLATE NOCASE`).join(' OR ');
    if (!cond) continue;
    try {
        const n = db.prepare(`SELECT COUNT(*) n FROM "${tbl}" WHERE ${cond}`).get().n;
        remaining += n;
        if (n) log(`   ⚠ ${tbl}: ${n} row(s) still contain 'trial1'`);
    } catch (e) {}
}
const userLeft = db.prepare("SELECT COUNT(*) n FROM users WHERE username = 'trial1' COLLATE NOCASE").get().n;

if (remaining === 0 && userLeft === 0) {
    log('\n✅ PASS — zero Trial1 rows remain, trial1 user removed.');
} else {
    log(`\n❌ ${remaining} row(s) remain, userLeft=${userLeft}`);
    process.exit(1);
}

// ── Phase 5: stock + ledger sanity after cleanup ──
const negatives = db.prepare(`
    SELECT p.name FROM products p
    JOIN stock_movements sm ON sm.product_id = p.id
    GROUP BY p.id
    HAVING SUM(COALESCE(sm.inward_qty,0) - COALESCE(sm.outward_qty,0)) < -0.001`).all();
log(`Negative stock after cleanup: ${negatives.length ? negatives.map(n => n.name).join(', ') : 'none'}`);

const collections = db.prepare('SELECT COUNT(*) n FROM milk_collections').get().n;
const ledger = db.prepare('SELECT COUNT(*) n FROM ledger_entries').get().n;
log(`milk_collections: ${collections} | ledger_entries: ${ledger}`);

db.close();
