/**
 * Production Costing Acceptance Tests — spec items 3–14, 38, 39
 * =============================================================
 * Uses the REAL production_costing.js API signatures.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-production-costing.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const salesOps = require(path.join(ROOT, 'shared', 'operations', 'sales.js'));

const DB_PATH = '/tmp/production-costing-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'production-costing-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
function near(a, b, eps = 0.5) { return Math.abs(Number(a || 0) - Number(b || 0)) < eps; }

costing.setLotCutover(db, '2083-01-01');

// ── Seed ──
const custId = db.prepare("INSERT INTO parties (name, type) VALUES ('Costing Cust', 'customer')").run().lastInsertRowid;
const farmerId = db.prepare("INSERT INTO parties (name, type) VALUES ('Costing Farmer', 'farmer')").run().lastInsertRowid;
function productIdByName(n) { return db.prepare('SELECT id FROM products WHERE name = ?').get(n)?.id; }
const mixId = productIdByName('Mixed Milk') || db.prepare("INSERT INTO products (name, unit, rate, expiry_days) VALUES ('Mixed Milk', 'L', 85, 3)").run().lastInsertRowid;
const creamId = productIdByName('Cream') || db.prepare("INSERT INTO products (name, unit, rate, expiry_days) VALUES ('Cream', 'kg', 550, 7)").run().lastInsertRowid;
// Fresh-DB seeded products carry rate 0 — NRV needs standard selling prices.
db.prepare('UPDATE products SET rate = 85 WHERE id = ?').run(mixId);
db.prepare('UPDATE products SET rate = 550 WHERE id = ?').run(creamId);
// Ensure shelf-life columns exist for expiry assertions.
db.prepare('UPDATE products SET expiry_days = 3 WHERE id = ?').run(mixId);
db.prepare('UPDATE products SET expiry_days = 7 WHERE id = ?').run(creamId);

let mcSeq = 0;
function seedCollection(data) {
    mcSeq++;
    return milkOps.saveMilkCollection(db, {
        collection_no: `MC-T${String(mcSeq).padStart(3, '0')}`, status: 'pending',
        shift: 'morning', ...data,
    }, 1);
}

console.log('\n═══ 1. Raw milk lots: collection creates a lot ═══');
const c1 = seedCollection({ party_id: farmerId, date: '2083-06-01', milk_type: 'cow', quantity_liters: 100, fat_percent: 4.0, snf_percent: 8.5, rate: 80, amount: 8000 });
const c1Id = c1?.id || c1;
const lot1 = db.prepare('SELECT * FROM milk_lots WHERE collection_id = ?').get(c1Id);
check('milk lot created for collection', !!lot1, lot1);
check('lot milk_type stored as collected (cow)', lot1 && String(lot1.milk_type).toLowerCase() === 'cow', lot1 && lot1.milk_type);
check('lot unit_cost = rate 80', lot1 && near(lot1.unit_cost, 80), lot1 && lot1.unit_cost);
check('lot qty_remaining 100', lot1 && near(lot1.qty_remaining, 100), lot1 && lot1.qty_remaining);

const c2 = seedCollection({ party_id: farmerId, date: '2083-06-01', shift: 'evening', milk_type: 'buffalo', quantity_liters: 100, fat_percent: 6.0, snf_percent: 9.0, rate: 100, amount: 10000 });
const c2Id = c2?.id || c2;
const lot2 = db.prepare('SELECT * FROM milk_lots WHERE collection_id = ?').get(c2Id);
check('buffalo lot separate from cow', lot2 && String(lot2.milk_type).toLowerCase() === 'buffalo' && lot2.id !== lot1.id, lot2 && lot2.milk_type);

console.log('\n═══ 2. FIFO suggestion ═══');
const sugCow = costing.suggestMilkConsumption(db, { milk_type: 'cow', quantity: 100, date: '2083-06-02' });
check('FIFO suggestion returns plan for cow 100', sugCow?.plan?.length >= 1 && near(sugCow.plan[0].quantity, 100), sugCow);
const sugOver = costing.suggestMilkConsumption(db, { milk_type: 'cow', quantity: 150, date: '2083-06-02' });
check('over-available suggestion leaves shortfall', near(sugOver.plan.reduce((s, p) => s + p.quantity, 0), 100) && sugOver.shortfall === 50, { planned: sugOver.plan.reduce((s, p) => s + p.quantity, 0), shortfall: sugOver.shortfall });

console.log('\n═══ 3. Day-1 batch: NRV allocation (100 cow + 100 buffalo → 185 Mix + 5 Cream) ═══');
const batch1 = costing.postProductionBatch(db, {
    date: '2083-06-02', shift: 'morning', process_type: 'PASTEURIZE_AND_SEPARATE',
    processing_cost: 2000,
    inputs: [{ milk_type: 'cow', quantity: 100 }, { milk_type: 'buffalo', quantity: 100 }],
    outputs: [
        { product_id: mixId, product_name: 'Mixed Milk', quantity: 185, unit: 'L' },
        { product_id: creamId, product_name: 'Cream', quantity: 5, unit: 'kg' },
    ],
    yield_note: 'Day-1 test batch',
}, 1);
check('batch posted', !!(batch1?.id || batch1?.batchId), batch1);
const batch1Id = batch1.id || batch1.batchId;
const b1 = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batch1Id);
check('input cost = 18000 (100×80 + 100×100)', near(b1.input_cost, 18000), b1.input_cost);
check('total cost = 20000 (with 2000 processing)', near(b1.total_cost, 20000), b1.total_cost);
check('not flagged approximate (standard prices exist)', !b1.cost_approximate, b1.cost_approximate);

// NRV: mix 185×85=15725, cream 5×550=2750 → shares 17023.00/2977.00
const mixLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batch1Id, mixId);
const creamLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batch1Id, creamId);
check('mix lot qty 185', mixLot && near(mixLot.qty_remaining, 185), mixLot && mixLot.qty_remaining);
check('mix unit cost ≈ 92.02', mixLot && near(mixLot.unit_cost, 92.02, 0.1), mixLot && mixLot.unit_cost);
check('cream lot qty 5', creamLot && near(creamLot.qty_remaining, 5), creamLot && creamLot.qty_remaining);
check('cream unit cost ≈ 595.40', creamLot && near(creamLot.unit_cost, 595.40, 0.2), creamLot && creamLot.unit_cost);
check('NRV shares sum to total cost', near((mixLot.qty_remaining * mixLot.unit_cost) + (creamLot.qty_remaining * creamLot.unit_cost), 20000, 1),
    (mixLot.qty_remaining * mixLot.unit_cost) + (creamLot.qty_remaining * creamLot.unit_cost));

const lot1After = db.prepare('SELECT qty_remaining FROM milk_lots WHERE id = ?').get(lot1.id);
check('cow raw lot fully consumed', near(lot1After.qty_remaining, 0), lot1After.qty_remaining);
const lot2After = db.prepare('SELECT qty_remaining FROM milk_lots WHERE id = ?').get(lot2.id);
check('buffalo raw lot fully consumed', near(lot2After.qty_remaining, 0), lot2After.qty_remaining);

console.log('\n═══ 4. Negative stock prevention ═══');
let negErr = null;
try {
    costing.postProductionBatch(db, {
        date: '2083-06-02', process_type: 'DIRECT_MIX', processing_cost: 0,
        inputs: [{ milk_type: 'cow', quantity: 50 }],
        outputs: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 50, unit: 'L' }],
    }, 1);
} catch (e) { negErr = e; }
check('over-consumption of raw milk rejected', !!negErr, negErr && negErr.message);

console.log('\n═══ 5. Day-2 batch: different costs ═══');
const c3 = seedCollection({ party_id: farmerId, date: '2083-06-03', milk_type: 'cow', quantity_liters: 100, fat_percent: 4.0, snf_percent: 8.5, rate: 90, amount: 9000 });
const c3Id = c3?.id || c3;
const lot3 = db.prepare('SELECT * FROM milk_lots WHERE collection_id = ?').get(c3Id);
const batch2 = costing.postProductionBatch(db, {
    date: '2083-06-03', process_type: 'DIRECT_MIX', processing_cost: 1000,
    inputs: [{ milk_type: 'cow', quantity: 100 }],
    outputs: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 98, unit: 'L' }],
    yield_note: 'Day-2 test batch',
}, 1);
const b2 = db.prepare('SELECT * FROM production_batches B2 WHERE B2.id = ?').get(batch2.id || batch2.batchId);
check('Day-2 total cost = 10000', near(b2.total_cost, 10000), b2.total_cost);
const mixLot2 = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batch2.id || batch2.batchId, mixId);
check('Day-2 mix unit cost ≈ 102.04', mixLot2 && near(mixLot2.unit_cost, 102.04, 0.1), mixLot2 && mixLot2.unit_cost);

console.log('\n═══ 6. Day-3 sale spans both lots (FIFO COGS) ═══');
const sale = salesOps.saveSale(db, {
    invoice_no: 'INV-T001', party_id: custId, date: '2083-06-04', payment_mode: 'credit', status: 'unpaid',
    items: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 200, rate: 85, amount: 17000 }],
}, 1);
const saleId = sale?.id || sale;
check('sale posted', !!saleId, sale);
const saleConsumptions = db.prepare(
    "SELECT lc.* FROM lot_consumptions lc WHERE lc.lot_type='stock' AND lc.reference_type='sale' AND lc.reference_id = ? ORDER BY lc.id"
).all(saleId);
check('sale consumed exactly 2 finished-goods lots', saleConsumptions.length === 2, saleConsumptions.length);
const totalCogs = saleConsumptions.reduce((s, c) => s + c.total_cost, 0);
check('COGS = 185×92.02 + 15×102.04 ≈ 18554.30', near(totalCogs, 18554.30, 1), totalCogs);
const d1Lot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batch1Id, mixId);
const d2Lot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batch2.id || batch2.batchId, mixId);
check('Day-1 lot consumed first and fully (0 left)', near(d1Lot.qty_remaining, 0), d1Lot.qty_remaining);
check('Day-2 lot remaining 83', near(d2Lot.qty_remaining, 83), d2Lot.qty_remaining);

console.log('\n═══ 7. Sale reversal restores lots exactly ═══');
salesOps.deleteSale(db, saleId, 1);
const d1Del = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(d1Lot.id);
const d2Del = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(d2Lot.id);
check('Day-1 lot restored to 185', near(d1Del.qty_remaining, 185), d1Del.qty_remaining);
check('Day-2 lot restored to 98', near(d2Del.qty_remaining, 98), d2Del.qty_remaining);
const leftover = db.prepare("SELECT COUNT(*) c FROM lot_consumptions WHERE reference_type='sale' AND reference_id = ?").get(saleId).c;
check('sale consumptions removed on reversal', leftover === 0, leftover);

console.log('\n═══ 8. Batch reversal restores raw lots ═══');
// Reversal happens BEFORE expiry write-off: a batch whose goods were written
// off cannot be reversed (stock would go negative) — that guard is correct.
const rev = costing.reverseProductionBatch(db, batch2.id || batch2.batchId, { reason: 'test reversal', userId: 1 });
check('batch reversed', !!rev, rev);
const b2After = db.prepare('SELECT status FROM production_batches WHERE id = ?').get(batch2.id || batch2.batchId);
check('batch marked reversed', /revers|cancel/i.test(b2After?.status || ''), b2After && b2After.status);
const lot3After = db.prepare('SELECT qty_remaining FROM milk_lots WHERE id = ?').get(lot3.id);
check('raw lot restored on batch reversal', near(lot3After.qty_remaining, 100), lot3After.qty_remaining);
const d2Gone = db.prepare('SELECT COUNT(*) c FROM stock_lots WHERE id = ?').get(d2Lot.id).c;
check('reversed batch stock lots removed', d2Gone === 0, d2Gone);

console.log('\n═══ 9. Expiry detection + wastage write-off ═══');
// Mixed Milk expiry_days = 3; Day-1 lot produced 2083-06-02 → expires 2083-06-05
const expired = costing.getExpiredLots(db, { asOf: '2083-06-07' });
check('expired lot detected', expired.some(l => Number(l.id) === Number(d1Lot.id)), expired.map(l => l.id));
check('cream lot not yet expired (7-day shelf life)', !expired.some(l => Number(l.id) === Number(creamLot.id)), expired.map(l => l.id));
const wOff = costing.writeOffExpiredStock(db, { asOf: '2083-06-07', userId: 1 });
check('write-off ran', wOff.lots === 1, wOff);
const d1AfterWo = db.prepare('SELECT * FROM stock_lots WHERE id = ?').get(d1Lot.id);
check('lot zeroed after write-off', near(d1AfterWo.qty_remaining, 0), d1AfterWo.qty_remaining);
check('wastage valued at lot cost ≈ 17023.70 (185×92.02)', near(wOff.totalCost || wOff.total_cost, 17023.70, 1), wOff);
const wRow = db.prepare('SELECT * FROM wastage_records ORDER BY id DESC LIMIT 1').get();
check('wastage_records row created', !!wRow, wRow);

console.log('\n═══ 10. Daily reconciliation structure ═══');
const rec = costing.getDailyReconciliation(db, { from_date: '2083-06-01', to_date: '2083-06-04' });
check('reconciliation returns data', !!rec, rec && Object.keys(rec));
check('reconciliation has finished-goods rows', Array.isArray(rec.finished_goods) && rec.finished_goods.length >= 1, rec && rec.finished_goods && rec.finished_goods.length);
check('reconciliation has raw-milk rows', Array.isArray(rec.raw_milk) && rec.raw_milk.length >= 1, rec && rec.raw_milk && rec.raw_milk.length);

console.log('\n═══ 11. Finished-goods sale from a single lot ═══');
const creamSale = salesOps.saveSale(db, {
    invoice_no: 'INV-T002', party_id: custId, date: '2083-06-05', payment_mode: 'credit', status: 'unpaid',
    items: [{ product_id: creamId, product_name: 'Cream', quantity: 2, rate: 550, amount: 1100 }],
}, 1);
const creamSaleId = creamSale?.id || creamSale;
check('cream sale posts', !!creamSaleId, creamSale);
const creamConsumption = db.prepare(
    "SELECT * FROM lot_consumptions WHERE lot_type='stock' AND reference_type='sale' AND reference_id = ?"
).get(creamSaleId);
check('cream sale consumed 1 lot at lot cost', !!creamConsumption && near(creamConsumption.quantity, 2) && near(creamConsumption.total_cost, 1190.80, 1), creamConsumption);
const creamAfter = db.prepare('SELECT qty_remaining FROM stock_lots WHERE id = ?').get(creamLot.id);
check('cream lot remaining 3', near(creamAfter.qty_remaining, 3), creamAfter.qty_remaining);

db.close();
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);

console.log('\n════════════════════════════════════════');
console.log(`PRODUCTION COSTING RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
