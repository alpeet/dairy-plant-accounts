#!/usr/bin/env node
/**
 * D7/D9 — PRODUCT MASTER NORMALIZATION (req 10/11/12/33/34/45)
 * ============================================================
 *  1. Migration 32 — products.code / active / four type flags +
 *     product_rate_history exist (fresh DB and re-opened DB)
 *  2. Expense guard — "Electricity"/"Office Expenses" etc. are not products
 *     (both operations layer and validate.js agree)
 *  3. saveProduct — code/flags/active persisted; rate history written on
 *     create ("Initial rate") and on every real rate change (reason +
 *     effective date); no history row when the rate does not change
 *  4. deleteProduct — product WITH history is ARCHIVED (active=0, rows kept,
 *     leaves every entry picker via active_only), product with NO history is
 *     hard-deleted (rate history cleaned up)
 *  5. listProducts({active_only}) + getCurrentStock({active_only}) filters
 *  6. getExpenseCategories — shared 14-category vocabulary with `used` flags
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const productsOps = require(path.join(ROOT, 'shared', 'operations', 'products'));
const stockOps = require(path.join(ROOT, 'shared', 'operations', 'stock'));
const expensesOps = require(path.join(ROOT, 'shared', 'operations', 'expenses'));
const { validateProduct } = require(path.join(ROOT, 'shared', 'validate'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-test-'));
const db = initDatabase(dir, 'test.db');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — Migration 32: product master columns + rate history table');
// ════════════════════════════════════════════════════════════
const cols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
for (const c of ['code', 'active', 'is_stocked', 'is_saleable', 'is_purchaseable', 'is_produced']) {
    ok(cols.includes(c), `products.${c} column exists`);
}
const histCols = db.prepare('PRAGMA table_info(product_rate_history)').all().map(c => c.name);
ok(histCols.includes('effective_from') && histCols.includes('reason') && histCols.includes('changed_by'),
    'product_rate_history has effective_from/reason/changed_by', histCols);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — expenses are not products (operations + validator)');
// ════════════════════════════════════════════════════════════
let threw = '';
try { productsOps.saveProduct(db, { name: 'Electricity', unit: 'kg', rate: 100 }); } catch (e) { threw = e.message; }
ok(/expense category/.test(threw), 'saveProduct rejects "Electricity"', threw);
threw = '';
try { productsOps.saveProduct(db, { name: 'Office Expenses', unit: 'kg' }); } catch (e) { threw = e.message; }
ok(/expense category/.test(threw), 'saveProduct rejects "Office Expenses"', threw);
ok(/expense category/.test(String(validateProduct({ name: 'Internet Bill', unit: 'kg' }) || '')),
    'validateProduct rejects "Internet Bill"', validateProduct({ name: 'Internet Bill', unit: 'kg' }));
ok(validateProduct({ name: 'Paneer 1kg', unit: 'kg', rate: 600 }) === null,
    'validateProduct accepts a real product', validateProduct({ name: 'Paneer 1kg', unit: 'kg', rate: 600 }));
ok(validateProduct({ name: 'X'.repeat(101) }) !== null, 'validateProduct rejects over-long name');
ok(validateProduct({ name: 'Milk', code: 'Y'.repeat(31) }) !== null, 'validateProduct rejects over-long code',
    validateProduct({ name: 'Milk', code: 'Y'.repeat(31) }));

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — saveProduct: code/flags/active + rate history');
// ════════════════════════════════════════════════════════════
const created = productsOps.saveProduct(db, {
    name: 'Full Cream Milk', unit: 'liter', category: 'Milk', rate: 80,
    code: 'FCM-1L', is_stocked: 1, is_saleable: 1, is_purchaseable: 0, is_produced: 1
});
const idMilk = Number(created.id);
const row = productsOps.getProduct(db, idMilk);
ok(row.code === 'FCM-1L', 'code persisted', row.code);
ok(row.is_purchaseable === 0 && row.is_saleable === 1 && row.is_produced === 1, 'type flags persisted',
    { saleable: row.is_saleable, purchaseable: row.is_purchaseable, produced: row.is_produced });
ok(row.active === 1, 'new product is active', row.active);

let hist = productsOps.getProductRateHistory(db, { product_id: idMilk });
ok(hist.length === 1 && hist[0].reason === 'Initial rate' && Math.abs(hist[0].new_rate - 80) < 0.005,
    'create with a rate writes the "Initial rate" history row', hist);

// rate change with reason + effective date
productsOps.saveProduct(db, {
    id: idMilk, name: 'Full Cream Milk', unit: 'liter', category: 'Milk', rate: 85,
    code: 'FCM-1L', is_stocked: 1, is_saleable: 1, is_purchaseable: 0, is_produced: 1,
    rate_effective_from: '2083-07-01', rate_reason: 'New rate chart from Asar'
});
hist = productsOps.getProductRateHistory(db, { product_id: idMilk });
ok(hist.length === 2, 'rate change adds a history row', hist.length);
ok(hist[0].reason === 'New rate chart from Asar' && hist[0].effective_from === '2083-07-01'
    && Math.abs(hist[0].old_rate - 80) < 0.005 && Math.abs(hist[0].new_rate - 85) < 0.005,
    'history row records old → new with reason and effective date', hist[0]);

// no-op save must NOT add history
productsOps.saveProduct(db, {
    id: idMilk, name: 'Full Cream Milk', unit: 'liter', category: 'Milk', rate: 85,
    code: 'FCM-1L', is_stocked: 1, is_saleable: 1, is_purchaseable: 0, is_produced: 1
});
hist = productsOps.getProductRateHistory(db, { product_id: idMilk });
ok(hist.length === 2, 'saving without a rate change writes no history', hist.length);

// deactivate
productsOps.saveProduct(db, {
    id: idMilk, name: 'Full Cream Milk', unit: 'liter', category: 'Milk', rate: 85,
    code: 'FCM-1L', active: 0, is_stocked: 1, is_saleable: 1, is_purchaseable: 0, is_produced: 1
});
ok(productsOps.getProduct(db, idMilk).active === 0, 'active=0 persists (archive toggle)');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — entry pickers drop archived products (active_only)');
// ════════════════════════════════════════════════════════════
productsOps.saveProduct(db, { id: idMilk, name: 'Full Cream Milk', unit: 'liter', category: 'Milk', rate: 85, code: 'FCM-1L', active: 1, is_stocked: 1, is_saleable: 1, is_purchaseable: 0, is_produced: 1 });
productsOps.saveProduct(db, { name: 'Curd Cup', unit: 'piece', category: 'Curd', rate: 35, code: 'CRD-PC', active: 0 });
const activeIds = productsOps.listProducts(db, { active_only: true }).map(p => p.name);
ok(activeIds.includes('Full Cream Milk') && !activeIds.includes('Curd Cup'),
    'listProducts({active_only}) keeps active, drops archived', activeIds);
const searched = productsOps.listProducts(db, { search: 'FCM' });
ok(searched.some(p => p.name === 'Full Cream Milk'), 'search matches on code', searched.map(p => p.name));
const allList = productsOps.listProducts(db, {});
ok(allList.some(p => p.name === 'Curd Cup'), 'master list still shows archived rows', allList.length);
const stockActive = stockOps.getCurrentStock(db, { active_only: true }).map(p => p.name);
ok(!stockActive.includes('Curd Cup') && stockActive.includes('Full Cream Milk'),
    'getCurrentStock({active_only}) drops archived', stockActive);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — delete: history survives (archive), no history (hard delete)');
// ════════════════════════════════════════════════════════════
// product with a stock movement → must archive
const withHist = productsOps.saveProduct(db, { name: 'Ghee 1kg', unit: 'kg', category: 'Ghee', rate: 1200, rate: 1200 });
const idGhee = Number(withHist.id);
db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, '2083-06-10', 'purchase', 10, 0, 10, 1200, 'test')")
  .run(idGhee);
const del1 = productsOps.deleteProduct(db, idGhee);
ok(del1.archived === true && del1.deleted === false, 'product with stock history is archived, not deleted', del1);
ok(productsOps.getProduct(db, idGhee) && productsOps.getProduct(db, idGhee).active === 0, 'archived row still exists with active=0');
ok(db.prepare('SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?').get(idGhee).c === 1,
    'stock history kept for archived product');
const del1b = productsOps.deleteProduct(db, idGhee);
ok(del1b.archived === true && /already archived/.test(del1b.reason || ''), 'archiving twice is a safe no-op', del1b);

// product with a sale line → must archive
const idCurd = productsOps.listProducts(db, {}).find(p => p.name === 'Curd Cup').id;
const partyId = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Test Customer', 'customer')").run().lastInsertRowid);
const saleId = Number(db.prepare("INSERT INTO sales (invoice_no, date, party_id, grand_total) VALUES ('INV-T1', '2083-06-11', ?, 70)").run(partyId).lastInsertRowid);
db.prepare("INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, 'Curd Cup', 2, 'piece', 35, 70)").run(saleId, idCurd);
const del2 = productsOps.deleteProduct(db, idCurd);
ok(del2.archived === true, 'product with a sale line is archived, not deleted', del2);
ok(db.prepare('SELECT COUNT(*) c FROM sales_items WHERE product_id = ?').get(idCurd).c === 1,
    'sale line keeps pointing at the archived product');

// clean product → hard delete, rate history cleaned
const idClean = Number(productsOps.saveProduct(db, { name: 'Disposable Glass', unit: 'piece', category: 'Packaging', rate: 2 }).id);
ok(productsOps.getProductRateHistory(db, { product_id: idClean }).length === 1, 'clean product has its initial history row');
const del3 = productsOps.deleteProduct(db, idClean);
ok(del3.deleted === true, 'product with no history is hard-deleted', del3);
ok(!productsOps.getProduct(db, idClean), 'deleted product no longer exists');
ok(productsOps.getProductRateHistory(db, { product_id: idClean }).length === 0, 'rate history cleaned up on hard delete');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 6 — expense vocabulary on the Expenses screen');
// ════════════════════════════════════════════════════════════
const cats = expensesOps.getExpenseCategories(db);
ok(cats.length > 0 && cats.every(c => typeof c.category === 'string' && (c.used === 0 || c.used === 1)),
    'getExpenseCategories returns {category, used} rows', cats.slice(0, 3));
const vocab = require(path.join(ROOT, 'shared', 'operations', 'management_reports')).EXPENSE_CATEGORIES;
ok(vocab.length === 14, 'shared vocabulary has 14 categories', vocab.length);
ok(vocab.every(v => cats.some(c => c.category === v)), 'every shared category is offered to the screen');
ok(cats.filter(c => c.used).length === 0 || cats.filter(c => c.used)[0].used === 1, 'used rows sort first');
db.prepare("INSERT INTO other_expenses (date, category, expense_head, description, amount, payment_mode) VALUES ('2083-06-11', 'Transport', 'Diesel', 'test', 500, 'cash')").run();
const cats2 = expensesOps.getExpenseCategories(db);
ok(cats2.some(c => c.category === 'Transport' && c.used === 1), 'a saved expense marks its category used', cats2);
ok(cats2.some(c => c.category === 'Transport' && c.used === 1) && cats2.some(c => c.category === 'Rent' && c.used === 0),
    'unused vocabulary categories remain available but flagged unused', cats2);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 7 — re-opening the database is idempotent');
// ════════════════════════════════════════════════════════════
db.close();
const db2 = initDatabase(dir, 'test.db');
const cols2 = db2.prepare('PRAGMA table_info(products)').all().map(c => c.name);
ok(cols2.filter(c => ['code', 'active', 'is_stocked', 'is_saleable', 'is_purchaseable', 'is_produced'].includes(c)).length === 6,
    'second open adds no duplicate columns', cols2);
ok(db2.prepare('SELECT COUNT(*) c FROM product_rate_history').get().c >= 2, 'rate history survives reopen');
const milk2 = db2.prepare("SELECT * FROM products WHERE name = 'Full Cream Milk'").get();
ok(milk2 && milk2.rate === 85 && milk2.active === 1, 'product state survives reopen', milk2 && { rate: milk2.rate, active: milk2.active });
db2.close();

// ════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
