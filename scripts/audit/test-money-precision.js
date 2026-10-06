#!/usr/bin/env node
/**
 * D11 — MONEY PRECISION ON NEW WRITES (req 39/40)
 * ================================================
 *  1. saveSale stores 2-dp money: header fields, item amounts and item rates
 *  2. savePurchase stores 2-dp money: header fields, item amounts and rates
 *  3. adjustStock stores a 2-dp rate
 *  4. Historical rows are never rewritten (req 47) — a pre-existing
 *     >2-dp row survives an unrelated save untouched
 *  5. Aggregates stay rounding-invariant: Σ round2(row) equals the total
 *     whether or not the stored rows carry sub-paisa dust
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const salesOps = require(path.join(ROOT, 'shared', 'operations', 'sales'));
const purchaseOps = require(path.join(ROOT, 'shared', 'operations', 'purchases'));
const stockOps = require(path.join(ROOT, 'shared', 'operations', 'stock'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
const is2dp = (v) => Math.abs((Math.round((Number(v) + Number.EPSILON) * 100) / 100) - Number(v)) < 1e-9;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prec-test-'));
const db = initDatabase(dir, 'test.db');
const pidCust = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Precision Customer', 'customer')").run().lastInsertRowid);
const pidSup = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Precision Supplier', 'supplier')").run().lastInsertRowid);
const prodId = Number(db.prepare("INSERT INTO products (name, unit, rate, opening_stock) VALUES ('Butter', 'kg', 100, 500)").run().lastInsertRowid);
// Mirror what saveProduct does for opening_stock > 0: seed the opening movement
// row, so the sale's balance chain starts at 500 exactly as in the real app.
db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, '2083-07-31', 'opening', 500, 0, 500, 100, 'Opening Stock')").run(prodId);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — saveSale stores 2-dp money');
// ════════════════════════════════════════════════════════════
// quantity × rate gives classic float dust (3 × 82.15 = 246.44999999999997 style)
const sale = salesOps.saveSale(db, {
    invoice_no: 'INV-P1', date: '2083-08-01', party_id: pidCust,
    items: [{ product_id: prodId, product_name: 'Butter', quantity: 3, unit: 'kg', rate: 82.15, amount: 246.44999999999997 }],
    subtotal: 246.44999999999997, discount: 0.105, tax: 1.335, grand_total: 247.67999999999998,
    paid_amount: 100.005, payment_mode: 'cash'
});
const saleRow = db.prepare('SELECT * FROM sales WHERE id = ?').get(sale.id);
ok(is2dp(saleRow.subtotal), 'subtotal stored at 2 dp', saleRow.subtotal);
ok(is2dp(saleRow.discount), 'discount stored at 2 dp', saleRow.discount);
ok(is2dp(saleRow.tax), 'tax stored at 2 dp', saleRow.tax);
ok(is2dp(saleRow.grand_total), 'grand_total stored at 2 dp', saleRow.grand_total);
ok(is2dp(saleRow.paid_amount), 'paid_amount stored at 2 dp', saleRow.paid_amount);
const saleItems = db.prepare('SELECT * FROM sales_items WHERE sale_id = ?').all(sale.id);
ok(saleItems.every(i => is2dp(i.amount)), 'item amounts stored at 2 dp', saleItems.map(i => i.amount));
ok(saleItems.every(i => is2dp(i.rate)), 'item rates stored at 2 dp', saleItems.map(i => i.rate));
ok(Math.abs(saleRow.grand_total - 247.68) < 0.005, 'grand_total value is correct', saleRow.grand_total);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — savePurchase stores 2-dp money');
// ════════════════════════════════════════════════════════════
const pur = purchaseOps.savePurchase(db, {
    bill_no: 'BILL-P1', date: '2083-08-02', party_id: pidSup,
    items: [{ product_id: prodId, product_name: 'Butter', quantity: 10, unit: 'kg', rate: 99.99999999999999, amount: 999.9999999999999 }],
    subtotal: 999.9999999999999, discount: 0.055, tax: 12.335, transport_charges: 10.005, extra_charges: 5.555,
    grand_total: 1027.835, paid_amount: 500.005, payment_mode: 'bank'
});
const purRow = db.prepare('SELECT * FROM purchases WHERE id = ?').get(pur.id || pur);
ok(is2dp(purRow.subtotal), 'purchase subtotal at 2 dp', purRow.subtotal);
ok(is2dp(purRow.discount), 'purchase discount at 2 dp', purRow.discount);
ok(is2dp(purRow.tax), 'purchase tax at 2 dp', purRow.tax);
ok(is2dp(purRow.transport_charges), 'transport_charges at 2 dp', purRow.transport_charges);
ok(is2dp(purRow.extra_charges), 'extra_charges at 2 dp', purRow.extra_charges);
ok(is2dp(purRow.grand_total), 'purchase grand_total at 2 dp', purRow.grand_total);
ok(is2dp(purRow.paid_amount), 'purchase paid_amount at 2 dp', purRow.paid_amount);
const purItems = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').all(purRow.id);
ok(purItems.every(i => is2dp(i.amount)), 'purchase item amounts at 2 dp', purItems.map(i => i.amount));
ok(purItems.every(i => is2dp(i.rate)), 'purchase item rates at 2 dp', purItems.map(i => i.rate));

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — adjustStock stores a 2-dp rate');
// ════════════════════════════════════════════════════════════
const adj = stockOps.adjustStock(db, { product_id: prodId, date: '2083-08-03', quantity: 20, rate: 82.14999999999999, notes: 'test' }, null);
const mv = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(adj.id);
ok(is2dp(mv.rate), 'adjustment rate stored at 2 dp', mv.rate);
ok(Math.abs(mv.rate - 82.15) < 0.005, 'adjustment rate value correct', mv.rate);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — historical rows are never rewritten (req 47)');
// ════════════════════════════════════════════════════════════
// Plant a legacy >2-dp row the way the Excel import created them.
db.prepare("INSERT INTO milk_collections (collection_no, date, party_id, quantity_liters, rate, amount) VALUES ('LEGACY-PREC-1', '2083-08-04', ?, 143.5, 82.14999999999999, 11788.525)")
  .run(pidSup);
const legacy = db.prepare("SELECT * FROM milk_collections WHERE date = '2083-08-04'").get();
ok(Math.abs(legacy.amount - 11788.525) < 1e-9, 'legacy 3-dp row exists before the saves', legacy.amount);
// an unrelated new save must not touch it
salesOps.saveSale(db, {
    invoice_no: 'INV-P2', date: '2083-08-05', party_id: pidCust,
    items: [{ product_id: prodId, product_name: 'Butter', quantity: 1, unit: 'kg', rate: 10, amount: 10 }],
    subtotal: 10, discount: 0, tax: 0, grand_total: 10, paid_amount: 10, payment_mode: 'cash'
});
const legacyAfter = db.prepare("SELECT * FROM milk_collections WHERE date = '2083-08-04'").get();
ok(Math.abs(legacyAfter.amount - 11788.525) < 1e-9, 'legacy row untouched after a new save', legacyAfter.amount);
ok(Math.abs(legacyAfter.rate - 82.14999999999999) < 1e-9, 'legacy rate untouched', legacyAfter.rate);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — aggregates are rounding-invariant (Σ round2(row))');
// ════════════════════════════════════════════════════════════
const raw = db.prepare('SELECT amount FROM milk_collections').all().reduce((s, r) => s + r.amount, 0);
const sumRounded = db.prepare('SELECT amount FROM milk_collections').all()
    .reduce((s, r) => s + Math.round((Number(r.amount) + Number.EPSILON) * 100) / 100, 0);
ok(Math.abs(accounting.round2(sumRounded) - accounting.round2(raw)) < 0.01,
    'Σ round2(row) ≈ raw total for mixed-precision rows',
    { raw: accounting.round2(raw), sumRounded: accounting.round2(sumRounded) });
ok(accounting.round2(246.44999999999997) === 246.45, 'round2 normalises float dust', accounting.round2(246.44999999999997));

// ════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
