/**
 * Production Setup acceptance tests — overheads register & yield standards
 * ========================================================================
 * CRUD, validation, audit, and integration with the batch costing engine:
 * a configured overhead must feed the next batch's processing cost, and a
 * configured yield standard must set the expected yield / flag.
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-production-settings.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const ps = require(path.join(ROOT, 'shared', 'operations', 'production_settings.js'));
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));

const DB_PATH = '/tmp/production-settings-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'production-settings-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.5) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;
function throws(fn) { try { fn(); return null; } catch (e) { return e; } }

costing.setLotCutover(db, '2083-01-01');
// A real user so the audit trail's changed_by FK is satisfied (production always has one).
const USER_ID = Number(db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('ps-admin','x','admin')").run().lastInsertRowid);

console.log('\n═══ Overheads: defaults & CRUD ═══');
const defaults = ps.listProductionOverheads(db);
check('seeds the 7 spec categories on an empty register', defaults.length === 7, defaults.length);
check('all seeded rates start at 0 (never invented)', defaults.every(o => o.rate === 0), defaults.map(o => o.rate));

const created = ps.saveProductionOverhead(db, { name: 'Electricity', basis: 'per_input_liter', rate: 5 }, USER_ID);
check('create returns an id', !!created.id, created);
check('create stores basis label', (ps.listProductionOverheads(db).find(o => o.id === created.id) || {}).basis_label === 'Per input litre');
check('duplicate names allowed (owner may split lines)', ps.saveProductionOverhead(db, { name: 'Electricity', basis: 'per_batch', rate: 10 }, USER_ID).id > 0);

const upd = ps.saveProductionOverhead(db, { id: created.id, name: 'Electricity', basis: 'percent_of_input_cost', rate: 2, active: false }, USER_ID);
check('update changes basis', upd.basis === 'percent_of_input_cost', upd);
check('active:false deactivates', ps.listProductionOverheads(db).find(o => o.id === created.id).active === false);
check('active-only filter excludes inactive', !ps.listProductionOverheads(db, { active_only: true }).some(o => o.id === created.id));

console.log('\n═══ Overheads: validation ═══');
check('blank name rejected', !!throws(() => ps.saveProductionOverhead(db, { name: '  ', basis: 'per_batch', rate: 1 })));
check('bad basis rejected', !!throws(() => ps.saveProductionOverhead(db, { name: 'X', basis: 'per_kg', rate: 1 })));
check('negative rate rejected', !!throws(() => ps.saveProductionOverhead(db, { name: 'X', basis: 'per_batch', rate: -1 })));
check('delete unknown id throws', !!throws(() => ps.deleteProductionOverhead(db, 99999)));

console.log('\n═══ Overheads: audit trail ═══');
const audit = db.prepare("SELECT * FROM audit_log WHERE table_name='production_overheads' ORDER BY id DESC LIMIT 1").get();
check('every overhead change is audited', !!audit, audit && audit.id);

console.log('\n═══ Yield standards: CRUD & validation ═══');
check('starts empty', ps.listYieldStandards(db).length === 0);
const y1 = ps.saveYieldStandard(db, { process_type: 'GHEE_MAKING', expected_yield_percent: 80, warn_low_percent: 75, warn_high_percent: 85 }, USER_ID);
check('create yield standard returns id', !!y1.id, y1);
check('lists with values', ps.listYieldStandards(db)[0].expected_yield_percent === 80);
check('blank process rejected', !!throws(() => ps.saveYieldStandard(db, { process_type: '', expected_yield_percent: 50 })));
check('expected > 100 rejected', !!throws(() => ps.saveYieldStandard(db, { process_type: 'X', expected_yield_percent: 120 })));
check('warn-low > warn-high rejected', !!throws(() => ps.saveYieldStandard(db, { process_type: 'X', expected_yield_percent: 50, warn_low_percent: 90, warn_high_percent: 80 })));
const yUpd = ps.saveYieldStandard(db, { id: y1.id, process_type: 'GHEE_MAKING', expected_yield_percent: 82, warn_low_percent: 75, warn_high_percent: 88 }, USER_ID);
check('update changes expected', yUpd.expected_yield_percent === 82);
check('delete removes it', ps.deleteYieldStandard(db, y1.id).deleted === true && ps.listYieldStandards(db).length === 0);

console.log('\n═══ Integration: configured overhead feeds the next batch ═══');
// Clean slate: configure exactly ONE active overhead at Rs 5 per input litre.
for (const o of ps.listProductionOverheads(db)) ps.deleteProductionOverhead(db, o.id, USER_ID);
ps.saveProductionOverhead(db, { name: 'Electricity', basis: 'per_input_liter', rate: 5 }, USER_ID);
const farmerId = db.prepare("INSERT INTO parties (name, type) VALUES ('PS Farmer', 'farmer')").run().lastInsertRowid;
milkOps.saveMilkCollection(db, { collection_no: 'MC-PS-1', status: 'pending', shift: 'morning', party_id: farmerId, date: '2083-07-01', milk_type: 'cow', quantity_liters: 100, rate: 80, amount: 8000 }, USER_ID);
const mixId = (() => { const p = db.prepare("SELECT id FROM products WHERE name='Mix Milk'").get(); return p ? p.id : db.prepare("INSERT INTO products (name, unit, rate) VALUES ('Mix Milk','L',85)").run().lastInsertRowid; })();
db.prepare('UPDATE products SET rate = 85 WHERE id = ?').run(mixId);

const b1 = costing.postProductionBatch(db, {
    date: '2083-07-02', process_type: 'PASTEURIZE',
    inputs: [{ milk_type: 'cow', quantity: 100 }],
    outputs: [{ product_id: mixId, product_name: 'Mix Milk', quantity: 90, unit: 'L' }]
}, USER_ID);
check('overhead applied: processing = 5 × 100 L = 500', near(b1.processing_cost, 500, 0.5), b1.processing_cost);
check('input cost from actual lot = 8,000', near(b1.input_cost, 8000, 0.5), b1.input_cost);
check('total = 8,000 + 500 = 8,500', near(b1.total_cost, 8500, 0.5), b1.total_cost);
check('overhead cost recorded on the batch', near(db.prepare('SELECT overhead_cost FROM production_batches WHERE id = ?').get(b1.id).overhead_cost, 500));

console.log('\n═══ Integration: itemised breakdown overrides overheads (no double count) ═══');
milkOps.saveMilkCollection(db, { collection_no: 'MC-PS-2', status: 'pending', shift: 'morning', party_id: farmerId, date: '2083-07-03', milk_type: 'cow', quantity_liters: 100, rate: 80, amount: 8000 }, USER_ID);
const b2 = costing.postProductionBatch(db, {
    date: '2083-07-04', process_type: 'PASTEURIZE',
    labour_cost: 300, packaging_cost: 100,
    inputs: [{ milk_type: 'cow', quantity: 100 }],
    outputs: [{ product_id: mixId, product_name: 'Mix Milk', quantity: 95, unit: 'L' }]
}, USER_ID);
check('itemised processing used instead of configured overheads', near(b2.processing_cost, 400, 0.5), b2.processing_cost);

console.log('\n═══ Integration: configured yield standard sets expected & flag ═══');
ps.saveYieldStandard(db, { process_type: 'GHEE_MAKING', expected_yield_percent: 80, warn_low_percent: 75, warn_high_percent: 85 }, USER_ID);
const creamId = (() => { const p = db.prepare("SELECT id FROM products WHERE name='Cream'").get(); return p ? p.id : db.prepare("INSERT INTO products (name, unit, rate) VALUES ('Cream','kg',550)").run().lastInsertRowid; })();
const gheeId = (() => { const p = db.prepare("SELECT id FROM products WHERE name='Ghee'").get(); return p ? p.id : db.prepare("INSERT INTO products (name, unit, rate) VALUES ('Ghee','kg',1500)").run().lastInsertRowid; })();
db.prepare('UPDATE products SET rate=550 WHERE id=?').run(creamId);
db.prepare('UPDATE products SET rate=1500 WHERE id=?').run(gheeId);
// Make cream via a separation batch, then convert some to ghee at a low yield.
milkOps.saveMilkCollection(db, { collection_no: 'MC-PS-3', status: 'pending', shift: 'morning', party_id: farmerId, date: '2083-07-04', milk_type: 'cow', quantity_liters: 100, rate: 80, amount: 8000 }, USER_ID);
costing.postProductionBatch(db, { date: '2083-07-05', process_type: 'SEP', processing_cost: 0, inputs: [{ milk_type: 'cow', quantity: 100 }], outputs: [{ product_id: creamId, product_name: 'Cream', quantity: 10, unit: 'kg' }], allow_zero_processing_cost: true }, USER_ID);
const b3 = costing.postProductionBatch(db, { date: '2083-07-06', process_type: 'GHEE_MAKING', processing_cost: 100, inputs: [{ product_id: creamId, quantity: 10 }], outputs: [{ product_id: gheeId, product_name: 'Ghee', quantity: 5, unit: 'kg' }] }, USER_ID);
const row3 = db.prepare('SELECT * FROM production_batches WHERE id = ?').get(b3.id);
check('expected yield taken from the configured standard (80%)', near(row3.standard_yield_percent, 80), row3.standard_yield_percent);
check('low actual yield (50%) is flagged', row3.yield_flag === 'low', row3.yield_flag);
check('yield variance reported (50 − 80 = −30)', near(row3.yield_variance_percent, -30), row3.yield_variance_percent);

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Production Setup tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
