/**
 * Supplier-Specific Milk Pricing — acceptance tests (spec Phases 2–6)
 * ====================================================================
 * One authoritative pricing engine, four suppliers with different pricing
 * methods:
 *
 *   Supplier A  fixed      buffalo   Rs. 85/L
 *   Supplier B  fat/SNF    all milk  Chart 1 (fat 8.0, snf 5.0)
 *   Supplier C  fixed      cow       Rs. 72/L   (plus an inactive 99 chart)
 *   Supplier D  fat/SNF    cow       Chart 2 (fat 6.5, snf 4.2)
 *
 * Proves:
 *   - Migration 26 columns exist (supplier chart dimension + override reason)
 *   - chart precedence: supplier+type > supplier > plant+type > plant
 *   - effective_from / effective_to / is_active dating
 *   - resolveMilkRate is the single entry point (source/overridden/final)
 *   - rateOverrideError refuses unexplained deviations
 *   - saveMilkCollection prices server-side and derives the amount
 *   - override reason + calculated rate are both stored and audited
 *   - supplier-specific cost flows into milk lots, weighted daily cost,
 *     §6 procurement metrics (suppliers, min/max, fixed vs formula litres)
 *   - production consumes the supplier-specific lot costs (FIFO)
 *   - bulk entry prices every row from THAT supplier's chart
 *
 * Run:  NODE_PATH="$PWD/node_modules" node scripts/audit/test-supplier-pricing.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db.js'));
const rates = require(path.join(ROOT, 'shared', 'operations', 'rates.js'));
const milkOps = require(path.join(ROOT, 'shared', 'operations', 'milk.js'));
const bulk = require(path.join(ROOT, 'shared', 'operations', 'bulk_entry.js'));
const costing = require(path.join(ROOT, 'shared', 'operations', 'production_costing.js'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));

const DB_PATH = '/tmp/supplier-pricing-test.db';
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
const db = initDatabase('/tmp', 'supplier-pricing-test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.01) => Math.abs(Number(a || 0) - Number(b || 0)) < eps;
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

costing.setLotCutover(db, '2083-01-01');

// ── Seed parties ──
const party = (name, type) => Number(db.prepare('INSERT INTO parties (name, type) VALUES (?, ?)').run(name, type).lastInsertRowid);
const A = party('SP Supplier A', 'supplier');
const B = party('SP Supplier B', 'supplier');
const C = party('SP Supplier C', 'supplier');
const D = party('SP Supplier D', 'supplier');
const E = party('SP Supplier E', 'supplier'); // no chart at all

// ════════════════════════════════════════════════════════════
console.log('\n═══ 0. Migration 26 — supplier dimension exists ═══');
const rcCols = db.prepare('PRAGMA table_info(milk_rate_chart)').all().map(c => c.name);
const mcCols = db.prepare('PRAGMA table_info(milk_collections)').all().map(c => c.name);
check('0a. milk_rate_chart has party_id', rcCols.includes('party_id'));
check('0b. milk_rate_chart has effective_to', rcCols.includes('effective_to'));
check('0c. milk_rate_chart has milk_type + is_active', rcCols.includes('milk_type') && rcCols.includes('is_active'));
check('0d. milk_collections has rate_override_reason', mcCols.includes('rate_override_reason'));
check('0e. ops bundle exports resolveMilkRate + rateOverrideError',
    typeof ops.resolveMilkRate === 'function' && typeof ops.rateOverrideError === 'function');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 1. Rate chart CRUD with supplier column ═══');
const plantDefault = rates.saveRateChart(db, {
    effective_from: '2082-01-01', rate_type: 'formula',
    fat_multiplier: 7.15, snf_multiplier: 4.55, extra_per_unit: 0, fixed_rate: 0,
    notes: 'Plant default'
}).id;
const plantCow = rates.saveRateChart(db, {
    effective_from: '2082-06-01', rate_type: 'formula', milk_type: 'cow',
    fat_multiplier: 6, snf_multiplier: 4, extra_per_unit: 0, fixed_rate: 0,
    notes: 'Plant cow'
}).id;
const plantBuf = rates.saveRateChart(db, {
    effective_from: '2082-06-01', rate_type: 'formula', milk_type: 'buffalo',
    fat_multiplier: 8.5, snf_multiplier: 5, extra_per_unit: 0, fixed_rate: 0,
    notes: 'Plant buffalo'
}).id;

// Supplier A: fixed buffalo, three dated versions (effective_to history)
const aOld = rates.saveRateChart(db, {
    party_id: A, milk_type: 'buffalo', effective_from: '2082-01-01', effective_to: '2082-06-30',
    rate_type: 'fixed', fixed_rate: 70, notes: 'A v1'
}).id;
const aMid = rates.saveRateChart(db, {
    party_id: A, milk_type: 'buffalo', effective_from: '2082-07-01', effective_to: '2083-01-31',
    rate_type: 'fixed', fixed_rate: 80, notes: 'A v2'
}).id;
const aNow = rates.saveRateChart(db, {
    party_id: A, milk_type: 'buffalo', effective_from: '2083-02-01',
    rate_type: 'fixed', fixed_rate: 85, notes: 'A v3'
}).id;
// Supplier B: fat/SNF for every milk type
const bChart = rates.saveRateChart(db, {
    party_id: B, effective_from: '2082-01-01', rate_type: 'formula',
    fat_multiplier: 8, snf_multiplier: 5, extra_per_unit: 0, fixed_rate: 0,
    notes: 'B chart 1'
}).id;
// Supplier C: fixed cow (active 72, inactive 99)
const cChart = rates.saveRateChart(db, {
    party_id: C, milk_type: 'cow', effective_from: '2082-01-01',
    rate_type: 'fixed', fixed_rate: 72, notes: 'C active'
}).id;
const cInactive = rates.saveRateChart(db, {
    party_id: C, milk_type: 'cow', effective_from: '2082-01-01',
    rate_type: 'fixed', fixed_rate: 99, is_active: 0, notes: 'C inactive'
}).id;
// Supplier D: fat/SNF for cow
const dChart = rates.saveRateChart(db, {
    party_id: D, milk_type: 'cow', effective_from: '2082-01-01', rate_type: 'formula',
    fat_multiplier: 6.5, snf_multiplier: 4.2, extra_per_unit: 0, fixed_rate: 0,
    notes: 'D chart 2'
}).id;
void [plantDefault, plantCow, plantBuf, aOld, aMid, aNow, bChart, cChart, cInactive, dChart];

const aRows = rates.listRateCharts(db, { party_id: A });
check('1a. listRateCharts({party_id}) returns only that supplier (3 dated versions)', aRows.length === 3, aRows.length);
check('1b. supplier rows carry the party name for the UI', aRows.every(r => r.party_name === 'SP Supplier A'), aRows[0] && aRows[0].party_name);
const allCharts = rates.listRateCharts(db);
check('1c. plant rows keep party_id NULL', [plantDefault, plantCow, plantBuf].every(pid => allCharts.find(r => r.id === pid).party_id === null), allCharts.map(r => [r.id, r.party_id]));
check('1d. inactive flag round-trips through save', rates.getRateChart(db, cInactive).is_active === 0);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 2. Precedence: supplier+type > supplier > plant+type > plant ═══');
const D20 = '2083-06-20';
const resOf = (o) => rates.resolveMilkRate(db, Object.assign({ date: D20 }, o));

const tier1 = resOf({ party_id: A, milk_type: 'buffalo', fat: 6, snf: 9 });
check('2a. tier 1 — supplier + milk type (A fixed 85, fat/SNF ignored)', tier1.source === 'supplier' && near(tier1.calculated_rate, 85), tier1);
const tier2 = resOf({ party_id: B, milk_type: 'cow', fat: 4.2, snf: 8.3 });
check('2b. tier 2 — supplier for all types beats plant+type (B formula 75.10)',
    tier2.source === 'supplier' && near(tier2.calculated_rate, r2(4.2 * 8 + 8.3 * 5)), tier2);
const tier3 = resOf({ party_id: E, milk_type: 'cow', fat: 4.2, snf: 8.3 });
check('2c. tier 3 — plant + milk type when the supplier has no chart (58.40)',
    tier3.source === 'plant' && near(tier3.calculated_rate, r2(4.2 * 6 + 8.3 * 4)), tier3);
const tier3b = resOf({ party_id: E, milk_type: 'buffalo', fat: 6, snf: 9 });
check('2d. tier 3 — plant buffalo chart (96.00)', tier3.source !== '' && near(tier3b.calculated_rate, r2(6 * 8.5 + 9 * 5)), tier3b);
const tier4 = resOf({ party_id: E, milk_type: 'mixed', fat: 4.2, snf: 8.3 });
check('2e. tier 4 — plant default chart (67.80)', tier4.source === 'plant' && near(tier4.calculated_rate, r2(4.2 * 7.15 + 8.3 * 4.55), 0.011), tier4);
const aCow = resOf({ party_id: A, milk_type: 'cow', fat: 4.2, snf: 8.3 });
check('2f. supplier chart for buffalo does NOT price cow milk (falls to plant cow)',
    aCow.source === 'plant' && near(aCow.calculated_rate, r2(4.2 * 6 + 8.3 * 4)), aCow);

console.log('\n═══ 2g–2i. Dating: effective_from / effective_to / is_active ═══');
check('2g. A v1 applies until 2082-06-30 (70)',
    near(rates.resolveMilkRate(db, { date: '2082-06-30', party_id: A, milk_type: 'buffalo' }).calculated_rate, 70));
check('2h. A v2 takes over on 2082-07-01 (80)',
    near(rates.resolveMilkRate(db, { date: '2082-07-01', party_id: A, milk_type: 'buffalo' }).calculated_rate, 80));
check('2i. A v3 from 2083-02-01 (85); effective_to never leaks',
    near(rates.resolveMilkRate(db, { date: '2083-06-20', party_id: A, milk_type: 'buffalo' }).calculated_rate, 85)
    && near(rates.resolveMilkRate(db, { date: '2083-02-01', party_id: A, milk_type: 'buffalo' }).calculated_rate, 85));
check('2j. inactive chart (99) is never selected', near(resOf({ party_id: C, milk_type: 'cow' }).calculated_rate, 72));
check('2k. before any chart → settings default, source "default"',
    rates.resolveMilkRate(db, { date: '2081-01-01', party_id: E, milk_type: 'cow', fat: 4, snf: 8.5 }).source === 'default');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 3. resolveMilkRate semantics ═══');
const r3 = resOf({ party_id: B, milk_type: 'buffalo', fat: 6, snf: 9 });
check('3a. calculated = 6×8 + 9×5 = 93, not overridden', near(r3.calculated_rate, 93) && !r3.overridden && near(r3.final_rate, 93), r3);
const r3b = resOf({ party_id: B, milk_type: 'buffalo', fat: 6, snf: 9, rate: 100 });
check('3b. given rate 100 wins but is flagged overridden', r3b.overridden && near(r3b.final_rate, 100) && near(r3b.calculated_rate, 93), r3b);
const r3c = resOf({ party_id: B, milk_type: 'buffalo', fat: 6, snf: 9, rate: 93 });
check('3c. rate equal to calculated is NOT an override', !r3c.overridden, r3c);
check('3d. chart id exposed for audit (which rule priced this litre)', r3.chart && r3.chart.id === bChart, r3.chart && r3.chart.id);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 4. rateOverrideError — entry-point guard ═══');
check('4a. no rate given → clean', rates.rateOverrideError(db, { date: D20, party_id: B, milk_type: 'buffalo', fat: 6, snf: 9 }) === null);
const errNoReason = rates.rateOverrideError(db, { date: D20, party_id: B, milk_type: 'buffalo', fat: 6, snf: 9, rate: 100 });
check('4b. unexplained deviation refused', typeof errNoReason === 'string' && /reason/i.test(errNoReason), errNoReason);
check('4c. same deviation with a reason → clean',
    rates.rateOverrideError(db, { date: D20, party_id: B, milk_type: 'buffalo', fat: 6, snf: 9, rate: 100, rate_override_reason: 'Lab re-check approved' }) === null);
check('4d. rate = calculated → clean', rates.rateOverrideError(db, { date: D20, party_id: B, milk_type: 'buffalo', fat: 6, snf: 9, rate: 93 }) === null);
check('4e. declared fixed rate equal to the supplier fixed rate is a METHOD, not an override',
    rates.rateOverrideError(db, { date: D20, party_id: A, milk_type: 'buffalo', rate: 85, rate_type: 'fixed', fixed_rate: 85 }) === null);
check('4f. declared fixed but a different number is still an override',
    typeof rates.rateOverrideError(db, { date: D20, party_id: A, milk_type: 'buffalo', rate: 90, rate_type: 'fixed', fixed_rate: 85 }) === 'string');

// ════════════════════════════════════════════════════════════
console.log('\n═══ 5. Collection entry prices itself server-side ═══');
let mcSeq = 0;
const seed = (data) => {
    mcSeq++;
    return milkOps.saveMilkCollection(db, {
        collection_no: `MC-SP-${String(mcSeq).padStart(3, '0')}`,
        status: 'pending', shift: 'morning', ...data
    }, 1);
};
const rowOf = (res) => db.prepare('SELECT * FROM milk_collections WHERE id = ?').get(res.id || res);

// No rate, no amount anywhere — the engine decides.
const cA = rowOf(seed({ party_id: A, date: D20, milk_type: 'buffalo', quantity_liters: 200, fat_percent: 6, snf_percent: 9 }));
const cB = rowOf(seed({ party_id: B, date: D20, milk_type: 'buffalo', quantity_liters: 150, fat_percent: 6, snf_percent: 9 }));
const cC = rowOf(seed({ party_id: C, date: D20, milk_type: 'cow', quantity_liters: 100, fat_percent: 4.2, snf_percent: 8.3 }));
const cD = rowOf(seed({ party_id: D, date: D20, milk_type: 'cow', quantity_liters: 300, fat_percent: 4.2, snf_percent: 8.3 }));

check('5a. A priced at its fixed 85/L, amount derived (17,000)', near(cA.rate, 85) && near(cA.amount, 17000) && cA.rate_type === 'fixed', cA);
check('5b. B priced by its fat/SNF chart (93/L → 13,950)', near(cB.rate, 93) && near(cB.amount, 13950) && cB.rate_type === 'formula', cB);
check('5c. C priced at its fixed 72/L, not the inactive 99', near(cC.rate, 72) && near(cC.amount, 7200), cC);
check('5d. D priced by its own chart (62.16/L → 18,648)', near(cD.rate, 62.16) && near(cD.amount, 18648), cD);
check('5e. calculated_rate snapshot stored on every row',
    [cA, cB, cC, cD].every(r => near(r.calculated_rate, r.rate)), [cA.calculated_rate, cB.calculated_rate, cC.calculated_rate, cD.calculated_rate]);
check('5f. fat/SNF captured for analytics', near(cD.fat_percent, 4.2) && near(cD.snf_percent, 8.3));

const ledgerCredit = (id) => db.prepare("SELECT COALESCE(SUM(credit),0) c FROM ledger_entries WHERE reference_type='milk_collection' AND reference_id=?").get(id).c;
check('5g. supplier payable booked at the resolved amount for all four',
    near(ledgerCredit(cA.id), 17000) && near(ledgerCredit(cB.id), 13950)
    && near(ledgerCredit(cC.id), 7200) && near(ledgerCredit(cD.id), 18648),
    [ledgerCredit(cA.id), ledgerCredit(cB.id), ledgerCredit(cC.id), ledgerCredit(cD.id)]);

const lotOf = (cid) => db.prepare('SELECT * FROM milk_lots WHERE collection_id = ?').get(cid);
check('5h. each collection became its own cost layer at the supplier rate',
    lotOf(cA.id) && near(lotOf(cA.id).unit_cost, 85) && near(lotOf(cB.id).unit_cost, 93)
    && near(lotOf(cC.id).unit_cost, 72) && near(lotOf(cD.id).unit_cost, 62.16),
    [lotOf(cA.id) && lotOf(cA.id).unit_cost, lotOf(cB.id) && lotOf(cB.id).unit_cost]);
check('5i. lot keeps the supplier id (traceability)', [cA, cB, cC, cD].every(r => lotOf(r.id).party_id === r.party_id));

// ── override with reason ──
const overridePayload = {
    party_id: B, date: '2083-06-21', milk_type: 'buffalo', quantity_liters: 100,
    fat_percent: 6, snf_percent: 9, rate: 100,
    rate_override_reason: 'Lab re-check: fat corrected to 6.4, board-approved rate'
};
check('5j. entry point refuses the override without a reason',
    typeof rates.rateOverrideError(db, { ...overridePayload, rate_override_reason: undefined }) === 'string');
const cOv = rowOf(seed({ ...overridePayload, collection_no: 'MC-SP-OVR' }));
check('5k. override stored: final 100 AND calculated 93 both kept', near(cOv.rate, 100) && near(cOv.calculated_rate, 93), { rate: cOv.rate, calc: cOv.calculated_rate });
check('5l. reason persisted on the collection', /Lab re-check/.test(cOv.rate_override_reason || ''), cOv.rate_override_reason);
const ovAudit = db.prepare("SELECT * FROM audit_log WHERE table_name='milk_collections' AND record_id=? AND action='create'").get(cOv.id);
check('5m. audit row records the override (reason in new_values)', ovAudit && /Lab re-check/.test(ovAudit.new_values || ''), ovAudit && ovAudit.new_values);
check('5n. override amount = 100 × 100 L', near(cOv.amount, 10000), cOv.amount);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 6. Daily milk procurement report (§6) ═══');
const dmc = dairy.getDailyMilkCost(db, { date: D20 });
const bkt = t => dmc.categories.find(c => c.milk_type === t);
check('6a. four suppliers counted', dmc.supplier_count === 4, dmc.supplier_count);
check('6b. total 750 L / Rs 56,798 / avg 75.73',
    near(dmc.total_liters, 750) && near(dmc.total_amount, 56798) && near(dmc.avg_rate, 75.73),
    { liters: dmc.total_liters, amount: dmc.total_amount, avg: dmc.avg_rate });
check('6c. min rate 62.16 and max rate 93 across suppliers', near(dmc.min_rate, 62.16) && near(dmc.max_rate, 93), { min: dmc.min_rate, max: dmc.max_rate });
check('6d. fixed-rate litres 300 (A 200 + C 100)', near(dmc.fixed_liters, 300), dmc.fixed_liters);
check('6e. fat/SNF litres 450 (B 150 + D 300)', near(dmc.formula_liters, 450), dmc.formula_liters);
const buf = bkt('buffalo'), cow = bkt('cow');
check('6f. buffalo row: 350 L, 30,950, avg 88.43, 2 suppliers',
    buf && near(buf.liters, 350) && near(buf.amount, 30950) && near(buf.avg_rate, 88.43) && buf.supplier_count === 2, buf);
check('6g. cow row: 400 L, 25,848, avg 64.62, 2 suppliers',
    cow && near(cow.liters, 400) && near(cow.amount, 25848) && near(cow.avg_rate, 64.62) && cow.supplier_count === 2, cow);
check('6h. per-category fixed/formula split',
    near(buf.fixed_liters, 200) && near(buf.formula_liters, 150) && near(cow.fixed_liters, 100) && near(cow.formula_liters, 300),
    { buf, cow: { f: cow && cow.fixed_liters, fo: cow && cow.formula_liters } });

// ════════════════════════════════════════════════════════════
console.log('\n═══ 7. Supplier-specific cost flows into production (FIFO) ═══');
function ensureProduct(name, unit, rate) {
    let p = db.prepare('SELECT id FROM products WHERE name = ?').get(name);
    if (!p) p = { id: db.prepare('INSERT INTO products (name, unit, rate, category) VALUES (?, ?, ?, ?)').run(name, unit, rate, '').lastInsertRowid };
    return p.id;
}
const mixId = ensureProduct('Mixed Milk', 'L', 85);
const batch = costing.postProductionBatch(db, {
    date: '2083-06-21', shift: 'morning', process_type: 'PASTEURIZE', processing_cost: 500,
    inputs: [{ milk_type: 'cow', quantity: 400 }],
    outputs: [{ product_id: mixId, product_name: 'Mixed Milk', quantity: 380, unit: 'L' }],
}, 1);
check('7a. batch consumed all 400 L of cow milk', !!batch.id, batch);
check('7b. input cost = supplier-weighted FIFO (100×72 + 300×62.16 = 25,848)',
    near(batch.input_cost, 25848, 1), batch.input_cost);
check('7c. weighted cow cost/L into production = 64.62 (not one generic rate)',
    near(batch.input_cost / 400, 64.62, 0.01), batch.input_cost / 400);
check('7d. four distinct supplier lots exist for the day',
    db.prepare('SELECT COUNT(DISTINCT unit_cost) n FROM milk_lots WHERE date = ?').get(D20).n === 4);

// ════════════════════════════════════════════════════════════
console.log('\n═══ 8. Bulk entry prices every row from ITS supplier chart ═══');
const bulkDate = '2083-06-22';
const res1 = bulk.saveBulkCollections(db, {
    date: bulkDate, shift: 'morning',
    rows: [
        { party_name: 'SP Supplier A', milk_type: 'buffalo', quantity_liters: 50, fat_percent: 6, snf_percent: 9 },
        { party_name: 'SP Supplier B', milk_type: 'buffalo', quantity_liters: 40, fat_percent: 6, snf_percent: 9 },
        { party_name: 'SP Supplier C', milk_type: 'cow', quantity_liters: 60, fat_percent: 4.2, snf_percent: 8.3 },
        { party_name: 'SP Supplier D', milk_type: 'cow', quantity_liters: 70, fat_percent: 4.2, snf_percent: 8.3 },
        { party_name: 'SP Supplier D', milk_type: 'cow', quantity_liters: 10, fat_percent: 4.2, snf_percent: 8.3, rate: 90 },
    ],
}, 1);
check('8a. four clean rows added, one refused', res1.added === 4 && res1.failed === 1, { added: res1.added, failed: res1.failed, errors: res1.errors });
const bRow = partyId => db.prepare('SELECT * FROM milk_collections WHERE date=? AND party_id=? ORDER BY id DESC').get(bulkDate, partyId);
check('8b. A bulk row at its fixed 85 (4,250)', near(bRow(A).rate, 85) && near(bRow(A).amount, 4250), bRow(A));
check('8c. B bulk row at 93, C at 72, D at 62.16 — each from its own chart',
    near(bRow(B).rate, 93) && near(bRow(C).rate, 72) && near(bRow(D).rate, 62.16),
    [bRow(B).rate, bRow(C).rate, bRow(D).rate]);
check('8d. refusal message names the missing reason', /reason/i.test(JSON.stringify(res1.errors)), res1.errors);

const res2 = bulk.saveBulkCollections(db, {
    date: bulkDate, shift: 'evening',
    rows: [{ party_name: 'SP Supplier D', milk_type: 'cow', quantity_liters: 10, fat_percent: 4.2, snf_percent: 8.3, rate: 90, rate_override_reason: 'Operator entry, supervisor approved' }],
}, 1);
check('8e. same row accepted once a reason is supplied', res2.added === 1 && res2.failed === 0, res2);
const dEvening = db.prepare("SELECT * FROM milk_collections WHERE date=? AND party_id=? AND shift='evening'").get(bulkDate, D);
check('8f. override stored with final 90 / calculated 62.16 + reason',
    dEvening && near(dEvening.rate, 90) && near(dEvening.calculated_rate, 62.16) && /supervisor/.test(dEvening.rate_override_reason || ''),
    dEvening && { rate: dEvening.rate, calc: dEvening.calculated_rate, reason: dEvening.rate_override_reason });
check('8g. bulk rows also became supplier cost layers',
    !!lotOf(bRow(A).id) && near(lotOf(bRow(A).id).unit_cost, 85) && lotOf(bRow(A).id).party_id === A);

console.log(`\n═══════════════════════════════════════════`);
console.log(`  Supplier-Pricing tests: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
