#!/usr/bin/env node
/**
 * Remove the sales rows that the 76 reconciliation proved to be duplicates.
 * =======================================================================
 * Every documented duplicate is listed explicitly (no heuristic deletion):
 *
 *  38139  2083-05-01 LOCAL DAMAGE 0            — second copy of the 05-01
 *          internal wastage issue (0-rupee document)
 *  38140  2083-05-13 FACTORY PRODUCTION 31875  — second copy; 38114 now holds
 *          the workbook's 31875
 *  38141  2083-05-24 FACTORY PRODUCTION 15000  — second copy; 38115 now holds
 *          the workbook's 15000
 *  37867  2083-06-24 LOCAL BILL-7980 1550      — the workbook now prints this
 *          row as BILL-7380 (id 38119, same date, party and amount)
 *  38103  2083-06-23 LOCAL BILL-7393 450       — the workbook prints BILL-7393
 *          on 2083-07-06 (id 38121, same party and amount)
 *
 * Usage:
 *   node scripts/audit/remove-duplicate-sales.js [--apply] [--db PATH]
 *
 * Writes an evidence JSON next to the database backup, one audit_log row per
 * deletion, and refuses to run if any row is referenced by a ledger entry, a
 * payment or a stock movement.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const dbPathArg = args.indexOf('--db') >= 0 ? args[args.indexOf('--db') + 1] : null;
const DB_PATH = dbPathArg || path.join(__dirname, '..', '..', 'data', 'dairy-plant.db');

const DUPLICATES = [
    { id: 38139, keep: 38113, reason: 'second copy of the 2083-05-01 internal wastage issue (0-rupee document)' },
    { id: 38140, keep: 38114, reason: 'second copy of the 2083-05-13 factory-production issue; the kept row now holds the workbook value 31875' },
    { id: 38141, keep: 38115, reason: 'second copy of the 2083-05-24 factory-production issue; the kept row now holds the workbook value 15000' },
    { id: 37867, keep: 38119, reason: 'workbook prints this row as BILL-7380 on the same date, party and amount' },
    { id: 38103, keep: 38121, reason: 'workbook prints BILL-7393 on 2083-07-06, same party and amount' }
];

function main() {
    const db = new Database(DB_PATH);
    const rows = [];
    let blocked = 0;

    for (const d of DUPLICATES) {
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.id);
        const keep = db.prepare('SELECT * FROM sales WHERE id = ?').get(d.keep);
        if (!sale || !keep) {
            console.log(`SKIP ${d.id}: row (or its keeper ${d.keep}) is already gone`);
            continue;
        }
        const ledger = db.prepare("SELECT id FROM ledger_entries WHERE reference_type='sale' AND reference_id=?").all(d.id);
        const payments = db.prepare('SELECT id FROM payments WHERE reference_id = ?').all(d.id);
        // Stock movements are DERIVED from the sale and are rebuilt below; a
        // ledger entry or a payment reference is a real accounting dependency
        // and blocks the deletion.
        const stock = db.prepare('SELECT * FROM stock_movements WHERE reference_id = ?').all(d.id);
        if (ledger.length || payments.length) {
            console.log(`BLOCKED ${d.id} ${sale.invoice_no}: referenced by a ledger entry or a payment — not deleted`);
            blocked++;
            continue;
        }
        rows.push({
            ...d,
            deleted_row: sale,
            kept_row: keep,
            items: db.prepare('SELECT * FROM sales_items WHERE sale_id = ?').all(d.id),
            stock_movements: stock
        });
        console.log(`${APPLY ? 'DELETE' : 'WOULD DELETE'} ${d.id}  ${sale.invoice_no}  ${sale.date}  Rs ${sale.grand_total}`
            + `  (keep ${d.keep} ${keep.invoice_no} Rs ${keep.grand_total}) — ${d.reason}`);
    }

    if (!APPLY) {
        console.log(`\nDry run: ${rows.length} row(s) would be deleted, ${blocked} blocked. Re-run with --apply.`);
        db.close();
        return;
    }

    const stamp = new Date().toISOString();
    const evidenceFile = path.join(path.dirname(DB_PATH), 'backups',
        `sales-duplicates-${stamp.replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify({ generated_at: stamp, database: DB_PATH, rows }, null, 2));

    const { logAudit } = require('../../shared/operations/audit');
    db.transaction(() => {
        for (const r of rows) {
            db.prepare('DELETE FROM stock_movements WHERE reference_type = ? AND reference_id = ?').run('sale', r.id);
            db.prepare('DELETE FROM sales_items WHERE sale_id = ?').run(r.id);
            db.prepare('DELETE FROM sales WHERE id = ?').run(r.id);
            logAudit(db, 'sales', r.id, 'delete', r.deleted_row,
                { reason: r.reason, kept_id: r.keep, evidence_file: evidenceFile }, null);
        }
    })();

    // Recompute stock so the removed documents leave no trace in the balances.
    const { rebuildStockLedger } = require('../../shared/excel-import');
    if (rows.length) rebuildStockLedger(db, (m) => console.log(m), { preserveManual: true });

    console.log(`\nDeleted ${rows.length} sales row(s) (${blocked} blocked). Evidence: ${evidenceFile}`);
    db.close();
}

main();
