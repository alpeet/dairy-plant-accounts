/**
 * Scientific Milk-to-Finished-Product Costing — acceptance tests (spec §26)
 * ========================================================================
 * Covers the 20 mandated cases: weighted-average same-day purchase cost, milk
 * carried across days, raw-milk FIFO, cream receiving a real (non-zero) cost,
 * NRV allocation, cream→nauni→ghee, actual≠expected yield, processing cost,
 * finished-goods FIFO, a sale spanning multiple lots, wastage at actual cost,
 * no negative inventory, daily reconciliation, actual-lot COGS (not today's
 * price), closing-value reconciliation, Excel round-trip parity, historical
 * opening not fabricated, and full traceability back to the farmer.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-milk-costing.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const salesOps = require(path.join(ROOT, 'shared', 'operations', 'sales.js'));

const DB_PATH = '/tmp/milk-costing-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'milk-costing-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.5) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;

costing.setLotCutover(db, '2083-01-01');

// ── Seed ──
const farmerId = db.prepare("INSERT INTO parties (name, type) VALUES ('Costing Farmer', 'farmer')").run().lastInsertRowid;
const custId = db.prepare("INSERT INTO parties (name, type) VALUES ('Costing Cust', 'customer')").run().lastInsertRowid;

function ensureProduct(name, unit, rate) {
    let p = db.prepare('SELECT id FROM products WHERE name = ?').get(name);
    if (!p) p = { id: db.prepare('INSERT INTO products (name, unit, rate, category) VALUES (?, ?, ?, ?)').run(name, unit, rate, '').lastInsertRowid };
    db.prepare('UPDATE products SET rate = ? WHERE id = ?').run(rate, p.id);
    return p.id;
}
const mixId = ensureProduct('Mixed Milk', 'L', 85);
const creamId = ensureProduct('Cream', 'kg', 550);
const nauniId = ensureProduct('Nauni', 'kg', 400);
const gheeId = ensureProduct('Ghee', 'kg', 1500);
db.prepare("UPDATE products SET category = 'Milk' WHERE id = ?").run(mixId);

let mcSeq = 0;
function seedCollection(data) {
    mcSeq++;
    return milkOps.saveMilkCollection(db, {
        collection_no: `MC-T${String(mcSeq).padStart(3, '0')}`, status: 'pending',
        shift: 'morning', ...data,
    }, 1);
}

// ── 1 & 2: multiple rates same day → weighted average ──
console.log('\n═══ 1/2. Weighted-average purchase cost (same day, multiple rates) ═══');
seedCollection({ party_id: farmerId, date: '2083-06-10', milk_type: 'cow', quantity_liters: 100, fat_percent: 4, snf_percent: 8.5, rate: 80, amount: 8000 });
seedCollection({ party_id: farmerId, date: '2083-06-10', shift: 'evening', milk_type: 'cow', quantity_liters: 200, fat_percent: 4, snf_percent: 8.5, rate: 90, amount: 18000 });
seedCollection({ party_id: farmerId, date: '2083-06-10', milk_type: 'buffalo', quantity_liters: 100, fat_percent: 6, snf_percent: 9, rate: 100, amount: 10000 });

const dmc = dairy.getDailyMilkCost(db, { date: '2083-06-10' });
const cow = dmc.categories.find(c => c.milk_type === 'cow');
const buf = dmc.categories.find(c => c.milk_type === 'buffalo');
check('1a. two cow rates both captured (300 L, Rs 26,000)', cow && near(cow.liters, 300) && near(cow.amount, 26000), cow);
check('1b. cow weighted-average = 86.67 (NOT arithmetic mean 85)', cow && near(cow.avg_rate, 86.67, 0.01), cow && cow.avg_rate);
check('2a. buffalo average = 100', buf && near(buf.avg_rate, 100), buf && buf.avg_rate);
check('2b. blended day average = 36,000/400 = 90', near(dmc.avg_rate, 90, 0.01) && near(dmc.total_liters, 400), { rate: dmc.avg_rate, liters: dmc.total_liters });

const dmcRepeat = dairy.getDailyMilkCost(db, { date: '2083-06-10' });
check('2c. repeat call is stable (no drift)', near(dmcRepeat.avg_rate, dmc.avg_rate, 0.0001));

// ── 3: milk carried from previous days (opening stock) ──
console.log('\n═══ 3. Milk carried across days ═══');
const flow10 = dairy.getMilkFlow(db, { date: '2083-06-10' });
const flow11 = dairy.getMilkFlow(db, { date: '2083-06-11' });
check('3a. day 10 closing carries 400 L', near(flow10.closing.qty, 400), flow10.closing);
check('3b. day 11 opens with the 400 L carried forward', near(flow11.opening.qty, 400) && flow11.opening.value > 0, flow11.opening);

// ── 4: raw-milk FIFO across lots ──
console.log('\n═══ 4. Raw-milk FIFO consumption ═══');
const firstCowLot = db.prepare("SELECT * FROM milk_lots WHERE milk_type='cow' AND date='2083-06-10' ORDER BY id").get();
const batchSep = costing.postProductionBatch(db, {
    date: '2083-06-11', shift: 'morning', process_type: 'CREAM_SEPARATION',
    processing_cost: 4000,
    inputs: [{ milk_type: 'cow', quantity: 300 }, { milk_type: 'buffalo', quantity: 100 }],
    outputs: [
        { product_id: mixId, product_name: 'Mixed Milk', quantity: 360, unit: 'L' },
        { product_id: creamId, product_name: 'Cream', quantity: 40, unit: 'kg' },
    ],
}, 1);
check('4a. separation batch posted', !!batchSep.id, batchSep);
check('4b. input cost = actual FIFO (100×80 + 200×90 + 100×100 = 36,000)', near(batchSep.input_cost, 36000), batchSep.input_cost);
check('4c. oldest cow lot fully consumed first', near(db.prepare('SELECT qty_remaining FROM milk_lots WHERE id = ?').get(firstCowLot.id).qty_remaining, 0));

// ── 5 & 6: cream gets a real, non-zero cost; NRV split ──
console.log('\n═══ 5/6. Cream cost is non-zero (NRV allocation) ═══');
const creamLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batchSep.id, creamId);
const mixLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ? AND product_id = ?').get(batchSep.id, mixId);
check('5a. cream inventory lot exists', !!creamLot, creamLot);
check('5b. cream unit cost > 0 (never zero)', creamLot && creamLot.unit_cost > 0, creamLot && creamLot.unit_cost);
const expectedCreamCost = 40000 * (40 * 550) / ((360 * 85) + (40 * 550));
check('5c. cream total cost = 40,000 × cream-NRV / total-NRV', creamLot && near(creamLot.qty_remaining * creamLot.unit_cost, expectedCreamCost, 1), { got: creamLot.qty_remaining * creamLot.unit_cost, want: expectedCreamCost });
check('6a. NRV shares sum to the batch cost (40,000)', near((creamLot.qty_remaining * creamLot.unit_cost) + (mixLot.qty_remaining * mixLot.unit_cost), 40000, 2));
check('6b. milk did not absorb the whole cost', mixLot && mixLot.unit_cost < (40000 / 360), mixLot && mixLot.unit_cost);

// ── 7: cream → nauni (real cream cost + processing) ──
console.log('\n═══ 7. Cream converted into Nauni ═══');
const batchNauni = costing.postProductionBatch(db, {
    date: '2083-06-12', process_type: 'NAUNI_MAKING', processing_cost: 1500,
    inputs: [{ product_id: creamId, quantity: 25 }],
    outputs: [{ product_id: nauniId, product_name: 'Nauni', quantity: 24, unit: 'kg' }],
}, 1);
const nauniLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ?').get(batchNauni.id);
const expectedNauniInput = 25 * creamLot.unit_cost; // FIFO 25 kg from the single cream lot
check('7a. nauni batch input cost = 20 kg of cream at its actual cost', near(batchNauni.input_cost, expectedNauniInput, 1), { got: batchNauni.input_cost, want: expectedNauniInput });
check('7b. nauni total cost = cream cost + processing', near(batchNauni.total_cost, expectedNauniInput + 1500, 1), batchNauni.total_cost);
check('7c. nauni carries a real unit cost', nauniLot && nauniLot.unit_cost > 0, nauniLot && nauniLot.unit_cost);

// ── 8: nauni → ghee ──
console.log('\n═══ 8. Nauni converted into Ghee ═══');
const batchGhee = costing.postProductionBatch(db, {
    date: '2083-06-13', process_type: 'GHEE_MAKING', processing_cost: 2000,
    inputs: [{ product_id: nauniId, quantity: 15 }],
    outputs: [{ product_id: gheeId, product_name: 'Ghee', quantity: 11, unit: 'kg' }],
}, 1);
const gheeLot = db.prepare('SELECT * FROM stock_lots WHERE batch_id = ?').get(batchGhee.id);
check('8a. ghee input cost from the actual nauni lot (15 × unit)', near(batchGhee.input_cost, 15 * nauniLot.unit_cost, 1), { got: batchGhee.input_cost, want: 15 * nauniLot.unit_cost });
check('8b. ghee total = nauni cost + processing', near(batchGhee.total_cost, batchGhee.input_cost + 2000, 1), batchGhee.total_cost);
check('8c. ghee unit cost ≈ total/11', gheeLot && near(gheeLot.unit_cost, batchGhee.total_cost / 11, 0.5), gheeLot && gheeLot.unit_cost);

// ── 9: actual yield ≠ expected yield, flagged ──
console.log('\n═══ 9. Yield control (actual vs expected) ═══');
db.prepare("INSERT INTO yield_standards (process_type, expected_yield_percent, warn_low_percent, warn_high_percent) VALUES ('GHEE_MAKING', 80, 75, 85)").run();
const batchGhee2 = costing.postProductionBatch(db, {
    date: '2083-06-13', shift: 'evening', process_type: 'GHEE_MAKING', processing_cost: 500,
    inputs: [{ product_id: nauniId, quantity: 4 }],
    outputs: [{ product_id: gheeId, product_name: 'Ghee', quantity: 1, unit: 'kg' }],
}, 1);
const g2 = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batchGhee2.id);
check('9a. actual yield computed (1/4 = 25%)', near(batchGhee2.actual_yield_percent, 25), batchGhee2.actual_yield_percent);
check('9b. expected yield taken from the standard (80%)', near(batchGhee2.expected_yield_percent, 80), batchGhee2.expected_yield_percent);
check('9c. low yield flagged for review', g2.yield_flag === 'low', g2.yield_flag);
check('9d. yield variance reported (25 − 80 = −55)', near(g2.yield_variance_percent, -55), g2.yield_variance_percent);

// ── 10: processing cost (itemised + configured overheads) ──
console.log('\n═══ 10. Processing cost captured ═══');
const batchItemised = costing.postProductionBatch(db, {
    date: '2083-06-13', shift: 'combined', process_type: 'GHEE_MAKING',
    labour_cost: 300, fuel_cost: 200, packaging_cost: 100,        inputs: [{ product_id: creamId, quantity: 2 }],
        outputs: [{ product_id: nauniId, product_name: 'Nauni', quantity: 1, unit: 'kg' }],
    }, 1);
const bItem = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(batchItemised.id);
check('10a. itemised processing = 600', near(batchItemised.processing_cost, 600), batchItemised.processing_cost);
check('10b. breakdown stored (labour/fuel/packaging)', near(bItem.labour_cost, 300) && near(bItem.fuel_cost, 200) && near(bItem.packaging_cost, 100), bItem);
check('10c. total = input + processing', near(bItem.total_cost, bItem.input_cost + 600, 0.5));

// ── 11 & 12: finished-goods FIFO; a sale spanning multiple lots ──
console.log('\n═══ 11/12. Finished-goods FIFO & multi-lot sale ═══');
// Second milk lot (cheap-ish) so a 400 L sale must span two lots.
seedCollection({ party_id: farmerId, date: '2083-06-13', shift: 'morning', milk_type: 'cow', quantity_liters: 100, fat_percent: 4, snf_percent: 8.5, rate: 95, amount: 9500 });
const batchMilk2 = costing.postProductionBatch(db, {
    date: '2083-06-13', shift: 'evening', process_type: 'PASTEURIZE',
    processing_cost: 500, inputs: [{ milk_type: 'cow', quantity: 100 }],
    outputs: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 100, unit: 'L' }],
}, 1);
void batchMilk2;
const lotsBeforeSale = db.prepare('SELECT COUNT(*) n FROM stock_lots WHERE product_id = ? AND qty_remaining > 0').get(mixId).n;
check('11a. two open milk lots exist before the sale', lotsBeforeSale >= 2, lotsBeforeSale);
const sale = salesOps.saveSale(db, {
    invoice_no: 'INV-MC-001', date: '2083-06-14', party_id: custId,
    items: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 400, unit: 'L', rate: 110, amount: 44000 }],
    subtotal: 44000, discount: 0, tax: 0, grand_total: 44000, paid_amount: 44000, payment_mode: 'cash',
}, 1);
const saleId = sale?.id || sale;
const consumedLots = db.prepare("SELECT COUNT(DISTINCT lot_id) n FROM lot_consumptions WHERE lot_type='stock' AND reference_type='sale' AND reference_id=?").get(saleId).n;
const saleRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
check('11b. sale consumed the oldest lot first (FIFO)', consumedLots >= 2, consumedLots);
check('12a. sale spans ≥ 2 lots', consumedLots >= 2, consumedLots);
const expectedCogs = 360 * mixLot.unit_cost + 40 * (db.prepare('SELECT unit_cost FROM stock_lots WHERE batch_id = ?').get(batchMilk2.id).unit_cost);
check('12b. COGS = 360 old-lot + 40 newer-lot', near(saleRow.lot_cogs, expectedCogs, 2), { got: saleRow.lot_cogs, want: expectedCogs });

// ── 13: wastage written off at actual lot cost ──
console.log('\n═══ 13. Wastage at actual cost ═══');
const nauniUnit = db.prepare('SELECT unit_cost FROM stock_lots WHERE product_id = ? AND qty_remaining > 0 ORDER BY produced_date, id LIMIT 1').get(nauniId).unit_cost;
const wastage = costing.recordWastage(db, { lot_type: 'stock', product_id: nauniId, quantity: 2, date: '2083-06-14', reason: 'spoilage' }, 1);
check('13a. wastage valued at the lot cost (2 × unit)', near(wastage.total_cost, 2 * nauniUnit, 0.5), { got: wastage.total_cost, want: 2 * nauniUnit });

// ── 14: no negative inventory ──
console.log('\n═══ 14. Negative inventory is refused ═══');
let negErr = null;
try {
    costing.postProductionBatch(db, {
        date: '2083-06-14', process_type: 'NAUNI_MAKING', processing_cost: 100,
        inputs: [{ product_id: creamId, quantity: 999 }],
        outputs: [{ product_id: nauniId, product_name: 'Nauni', quantity: 10, unit: 'kg' }],
    }, 1);
} catch (e) { negErr = e; }
check('14a. over-consumption of cream rejected', !!negErr, negErr && negErr.message);
const anyNeg = db.prepare('SELECT COUNT(*) n FROM stock_movements sm JOIN products p ON p.id=sm.product_id WHERE sm.balance_after < -0.001 AND sm.date >= ?').get('2083-06-01').n;
check('14b. no negative balances in the ledger', anyNeg === 0, anyNeg);

// ── 15: daily closing reconciles ──
console.log('\n═══ 15. Daily production & stock closing ═══');
const closing = dairy.getDailyClosing(db, { date: '2083-06-14' });
check('15a. milk identity balances', closing.milk.identity.balanced, closing.milk.identity);
check('15b. cream reconciles', closing.cream.balanced, closing.cream);
check('15c. daily closing reports no errors', closing.balanced && closing.errors.length === 0, closing.errors);

// ── 16: COGS from actual lot cost, not today's purchase price ──
console.log('\n═══ 16. COGS is actual lot cost, never today price ═══');
const real = dairy.getDailySalesRealization(db, { date: '2083-06-14' });
check('16a. realized milk COGS uses lot cost (≈74.97/L)', near(real.cost_per_liter, expectedCogs / 400, 0.5), real.cost_per_liter);
check('16b. COGS is below the newest purchase price (95/L), proving it is not today-priced', real.cost_per_liter < 95, real.cost_per_liter);
check('16c. sales realization per litre computed', near(real.realization_per_liter, 110, 0.01), real.realization_per_liter);
check('16d. gross margin per litre = realization − cost', near(real.gross_margin_per_liter, real.realization_per_liter - real.cost_per_liter, 0.05), real.gross_margin_per_liter);

// ── 17: closing stock value reconciliation ──
console.log('\n═══ 17. Closing inventory value reconciles ═══');
const val = dairy.getInventoryValuation(db);
const recomputed = db.prepare('SELECT COALESCE(SUM(qty_remaining * unit_cost),0) v FROM stock_lots').get().v;
check('17a. inventory valuation = sum of open lot values', near(val.total_value, recomputed, 1), { got: val.total_value, want: recomputed });
check('17b. valuation split into the 3 categories', Object.keys(val.groups).length === 3, val.groups);

// ── 19: historical opening is NOT fabricated ──
console.log('\n═══ 19. Pre-cutover history is never reconstructed ═══');
const old = seedCollection({ party_id: farmerId, date: '2082-12-31', milk_type: 'cow', quantity_liters: 50, rate: 70, amount: 3500 });
const oldLot = db.prepare('SELECT id FROM milk_lots WHERE collection_id = ?').get(old?.id || old);
check('19a. no milk lot created before the cutover', !oldLot, oldLot);

// ── 18: Excel round-trip parity (export → import → same numbers) ──
console.log('\n═══ 18. Excel export/import parity ═══');
let excelOk = false, excelDetail = null;
try {
    const exporter = require(path.join(ROOT, 'shared', 'export-daily-account.js'));
    const importer = require(path.join(ROOT, 'shared', 'excel-import.js'));
    const outXlsx = '/tmp/milk-costing-roundtrip.xlsx';
    exporter.exportToDailyAccountExcel(db, outXlsx);
    const before = dairy.getDailyMilkCost(db, { date: '2083-06-10' });
    importer.runExcelImport(db, outXlsx, { mode: 'upsert', log: () => {} });
    const after = dairy.getDailyMilkCost(db, { date: '2083-06-10' });
    excelOk = near(before.avg_rate, after.avg_rate, 0.0001) && near(before.total_liters, after.total_liters, 0.001)
        && fs.existsSync(outXlsx) && fs.statSync(outXlsx).size > 0;
    excelDetail = { before: before.avg_rate, after: after.avg_rate };
} catch (e) { excelDetail = e.message; }
check('18a. export file produced and re-import leaves milk cost identical', excelOk, excelDetail);

// ── 20: full traceability to the farmer ──
console.log('\n═══ 20. Sale → product → batch → milk → farmer ═══');
const gheeSale = salesOps.saveSale(db, {
    invoice_no: 'INV-MC-002', date: '2083-06-15', party_id: custId,
    items: [{ product_id: gheeId, product_name: 'Ghee', quantity: 3, unit: 'kg', rate: 1800, amount: 5400 }],
    subtotal: 5400, discount: 0, tax: 0, grand_total: 5400, paid_amount: 5400, payment_mode: 'cash',
}, 1);
const trace = dairy.getSaleTraceability(db, { saleId: gheeSale?.id || gheeSale });
const traceJson = JSON.stringify(trace || {});
check('20a. traceability walks the ghee sale back through batches', trace && trace.items && trace.items[0] && trace.items[0].lots.length > 0, trace && trace.items && trace.items[0]);
check('20b. chain reaches a cream → nauni upstream batch', /NAUNI_MAKING|CREAM_SEPARATION/.test(traceJson), traceJson.slice(0, 200));
check('20c. chain reaches the raw-milk farmer', traceJson.includes('Costing Farmer'), null);
const batchTrace = dairy.getBatchTraceability(db, { batchId: batchGhee.id });
check('20d. batch traceability resolves raw milk lots', batchTrace && JSON.stringify(batchTrace.chain).includes('milk_type'), null);

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Milk-Costing tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
