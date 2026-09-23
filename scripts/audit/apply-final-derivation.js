#!/usr/bin/env node
/**
 * apply-final-derivation.js — run the FINAL derivation pass on the live DB.
 *
 * The live swap used an intermediate derivation (mixing batches only, no
 * FG-shortfall pass), leaving residual negative stock. This script runs the
 * complete, idempotent sequence against an existing DB:
 *
 *   1. deriveProductionBatches   (replace PRD-DRV-MIX-* mixing batches)
 *   2. rebuildStockLedger        (idempotent: wipe + re-derive movements)
 *   3. deriveShortfallBatches    (PRD-DRV-FG-* for any still-negative product)
 *   4. rebuildStockLedger        (final movements incl. shortfall outputs)
 *
 * Usage: node scripts/audit/apply-final-derivation.js [--db <path>]
 * Reads nothing from Excel; operates purely on the DB contents.
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
let dbPath = 'data/dairy-plant.db';
const dbIdx = args.indexOf('--db');
if (dbIdx >= 0 && args[dbIdx + 1]) dbPath = args[dbIdx + 1];

const root = path.resolve(__dirname, '..', '..');
const Database = require(path.join(root, 'node_modules', 'better-sqlite3'));
const {
    deriveProductionBatches,
    deriveShortfallBatches,
    rebuildStockLedger,
} = require(path.join(root, 'shared', 'excel-import.js'));

const log = m => console.log(m);

// ── Safety backup before touching anything ──
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = dbPath + '.pre-derivation-' + stamp;
fs.copyFileSync(path.join(root, dbPath), path.join(root, backupPath));
log(`💾 Safety backup: ${backupPath}`);

const db = new Database(path.join(root, dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF');

const before = db.prepare(`
    SELECT p.name, ROUND(COALESCE(SUM(COALESCE(sm.inward_qty,0) - COALESCE(sm.outward_qty,0)),0), 2) bal
    FROM products p LEFT JOIN stock_movements sm ON sm.product_id = p.id
    GROUP BY p.id HAVING bal < 0 ORDER BY bal`).all();
log(`\n── BEFORE: ${before.length} product(s) negative`);
before.forEach(r => log(`   ${r.name}: ${r.bal}`));

log('\n── Step 1: deriveProductionBatches (mixing)');
deriveProductionBatches(db, log);
log('── Step 2: rebuildStockLedger');
rebuildStockLedger(db, log);
log('── Step 3: deriveShortfallBatches (FG gaps)');
deriveShortfallBatches(db, log);
log('── Step 4: rebuildStockLedger (final)');
rebuildStockLedger(db, log);

const after = db.prepare(`
    SELECT p.name, ROUND(COALESCE(SUM(COALESCE(sm.inward_qty,0) - COALESCE(sm.outward_qty,0)),0), 2) bal
    FROM products p LEFT JOIN stock_movements sm ON sm.product_id = p.id
    GROUP BY p.id ORDER BY bal`).all();
const negatives = after.filter(r => r.bal < -0.001);
log(`\n── AFTER: ${negatives.length} product(s) negative`);
after.forEach(r => log(`   ${r.name}: ${r.bal}`));

const counts = {
    movements: db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,
    batches: db.prepare('SELECT COUNT(*) n FROM production_batches').get().n,
    mix: db.prepare("SELECT COUNT(*) n FROM production_batches WHERE batch_no LIKE 'PRD-DRV-MIX-%'").get().n,
    fg: db.prepare("SELECT COUNT(*) n FROM production_batches WHERE batch_no LIKE 'PRD-DRV-FG-%'").get().n,
    collections: db.prepare('SELECT COUNT(*) n FROM milk_collections').get().n,
};
log('\n── Counts: ' + JSON.stringify(counts));

db.close();
if (negatives.length === 0) {
    log('\n✅ PASS — no negative stock remains.');
} else {
    log(`\n❌ ${negatives.length} product(s) still negative — investigate before proceeding.`);
    process.exit(1);
}
