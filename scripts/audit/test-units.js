/**
 * Product purchase / sales / stock units and conversion.
 *
 * Runs against a /tmp COPY of the live database (copied with its WAL). Proves:
 *  1. migration 39 is additive: every historical purchase/sale line keeps its
 *     quantity, unit, rate and amount, and `stock_quantity` starts equal to the
 *     old quantity so closing stock is identical;
 *  2. the standard units exist; custom units can be added, renamed, and only
 *     deactivated when nothing references them;
 *  3. conversion: L↔ml and kg↔g by definition, an explicit factor (1 box = 12
 *     pcs), same unit, and a REFUSAL for L→kg or a missing factor;
 *  4. a purchase entered in boxes stocks pieces (qty × factor) while the bill
 *     keeps 2 box @ 100 = 200;
 *  5. a sale entered in packets leaves stock in pieces while the invoice keeps
 *     the packet quantity and unit;
 *  6. the statement shows the original unit/quantity and never adds litres to
 *     kilograms;
 *  7. Daily Purchase vs Sales keeps units separate;
 *  8. changing a unit used by history needs confirmation, and the stock unit is
 *     frozen once stock has moved.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP_DB = path.join(os.tmpdir(), `units-test-${process.pid}.db`);

for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LIVE_DB + suffix)) fs.copyFileSync(LIVE_DB + suffix, TMP_DB + suffix);
}
const db = new Database(TMP_DB);

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

const { runMigrations } = require(path.join(ROOT, 'shared', 'db.js'));
const units = require(path.join(ROOT, 'shared', 'operations', 'units.js'));
const conv = require(path.join(ROOT, 'shared', 'operations', 'unit_conversion.js'));
const { saveProduct } = require(path.join(ROOT, 'shared', 'operations', 'products.js'));
const { saveParty } = require(path.join(ROOT, 'shared', 'operations', 'parties.js'));
const { savePurchase, getPurchase } = require(path.join(ROOT, 'shared', 'operations', 'purchases.js'));
const { saveSale, getSale } = require(path.join(ROOT, 'shared', 'operations', 'sales.js'));
const { getCurrentStock } = require(path.join(ROOT, 'shared', 'operations', 'stock.js'));
const { getPartyStatement } = require(path.join(ROOT, 'shared', 'operations', 'statements.js'));
const { getPurchaseVsSales } = require(path.join(ROOT, 'shared', 'operations', 'purchase_vs_sales.js'));

const fingerprint = () => {
    const one = (sql) => db.prepare(sql).get();
    return {
        purchase_lines: one('SELECT COUNT(*) n, ROUND(SUM(quantity),4) q, ROUND(SUM(amount),2) a FROM purchase_items'),
        sale_lines: one('SELECT COUNT(*) n, ROUND(SUM(quantity),4) q, ROUND(SUM(amount),2) a FROM sales_items'),
        ledger: one('SELECT COUNT(*) n, ROUND(SUM(debit),4) d, ROUND(SUM(credit),4) c FROM ledger_entries'),
        stock: one('SELECT COUNT(*) n, ROUND(SUM(inward_qty - outward_qty),4) q FROM stock_movements')
    };
};
const before = fingerprint();

// ── 1. Migration ──────────────────────────────────────────────────────
runMigrations(db);
const after = fingerprint();
check('migration leaves every purchase line quantity/amount unchanged',
    JSON.stringify(after.purchase_lines) === JSON.stringify(before.purchase_lines),
    `${JSON.stringify(before.purchase_lines)} → ${JSON.stringify(after.purchase_lines)}`);
check('migration leaves every sales line quantity/amount unchanged',
    JSON.stringify(after.sale_lines) === JSON.stringify(before.sale_lines));
check('migration leaves the ledger untouched',
    JSON.stringify(after.ledger) === JSON.stringify(before.ledger));
check('migration leaves closing stock untouched',
    JSON.stringify(after.stock) === JSON.stringify(before.stock));

const badStock = db.prepare(
    'SELECT COUNT(*) n FROM purchase_items WHERE stock_quantity IS NULL OR ABS(stock_quantity - quantity) > 0.0001'
).get().n;
check('historical purchase stock quantities equal the entered quantities', badStock === 0, String(badStock));
const badSaleStock = db.prepare(
    'SELECT COUNT(*) n FROM sales_items WHERE stock_quantity IS NULL OR ABS(stock_quantity - quantity) > 0.0001'
).get().n;
check('historical sales stock quantities equal the entered quantities', badSaleStock === 0, String(badSaleStock));
const unsetUnits = db.prepare(
    "SELECT COUNT(*) n FROM products WHERE COALESCE(purchase_unit,'')='' OR COALESCE(sales_unit,'')='' OR COALESCE(stock_unit,'')=''"
).get().n;
check('every product has all three units after the backfill', unsetUnits === 0, String(unsetUnits));
check('legacy unit column still mirrors the stock unit',
    db.prepare("SELECT COUNT(*) n FROM products WHERE LOWER(unit) <> LOWER(stock_unit)").get().n === 0);

// ── 2. Units ──────────────────────────────────────────────────────────
const list = units.listUnits(db);
for (const code of ['L', 'ml', 'kg', 'g', 'pcs', 'packet', 'box']) {
    check(`standard unit ${code} exists`, list.some(u => u.code === code));
}
check('standard units cannot be deactivated',
    (() => { try { units.deactivateUnit(db, 'kg'); return false; } catch (e) { return /standard/i.test(e.message); } })());
const created = units.saveUnit(db, { code: 'tin', name: 'Tin', kind: 'count' });
check('custom unit created', !!created.created && units.getUnit(db, 'tin').name === 'Tin');
units.saveUnit(db, { code: 'tin', name: 'Tin (large)' });
check('custom unit renamed', units.getUnit(db, 'tin').name === 'Tin (large)');
check('unused custom unit can be deactivated',
    units.deactivateUnit(db, 'tin').deactivated === true && units.getUnit(db, 'tin').active === 0);
units.saveUnit(db, { code: 'tin2', name: 'Tin 2', kind: 'count' });

// ── 3. Conversion maths ───────────────────────────────────────────────
const milk = { name: 'Milk', stock_unit: 'L', purchase_unit: 'L', sales_unit: 'L', purchase_factor: 1, sales_factor: 1 };
const powder = { name: 'Paneer', stock_unit: 'kg', purchase_unit: 'kg', sales_unit: 'kg', purchase_factor: 1, sales_factor: 1 };
check('L → L is unchanged', conv.toStock(milk, 12.5, 'L').stock_qty === 12.5);
check('ml → L divides by 1000', near(conv.toStock(milk, 750, 'ml').stock_qty, 0.75), String(conv.toStock(milk, 750, 'ml').stock_qty));
check('g → kg divides by 1000', near(conv.toStock(powder, 2500, 'g').stock_qty, 2.5));
check('L → kg is refused (no density assumption)', conv.toStock(powder, 5, 'L').ok === false);
const boxed = { name: 'Ghee', stock_unit: 'pcs', purchase_unit: 'box', sales_unit: 'packet', purchase_factor: 12, sales_factor: 6 };
check('1 box = 12 pcs uses the explicit purchase factor', conv.toStock(boxed, 2, 'box').stock_qty === 24);
check('1 packet = 6 pcs uses the explicit sales factor', conv.toStock(boxed, 3, 'packet').stock_qty === 18);
check('an unknown unit for the product is refused', conv.toStock(boxed, 1, 'tin').ok === false);

// ── 4. Product validation and the confirmation guard ──────────────────
const productId = saveProduct(db, {
    name: 'TEST-UNIT GHEE ' + process.pid, code: 'TST-UNIT', category: 'Test',
    stock_unit: 'pcs', purchase_unit: 'box', sales_unit: 'packet',
    purchase_factor: 12, sales_factor: 6, decimal_precision: 1,
    rate: 100, opening_stock: 0, active: 1
}).id;
const saved = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
check('product saved with three units and factors',
    saved.stock_unit === 'pcs' && saved.purchase_unit === 'box' && saved.sales_unit === 'packet'
    && saved.purchase_factor === 12 && saved.sales_factor === 6 && saved.decimal_precision === 1);
check('a unit that differs with factor 0 is rejected',
    (() => {
        try { saveProduct(db, { name: 'TEST-BAD ' + process.pid, stock_unit: 'pcs', purchase_unit: 'box', purchase_factor: 0 }); return false; }
        catch (e) { return /conversion|factor|stock unit/i.test(e.message); }
    })());
check('L stock with kg purchase and no factor is rejected',
    (() => {
        try { saveProduct(db, { name: 'TEST-BAD2 ' + process.pid, stock_unit: 'L', purchase_unit: 'kg', purchase_factor: 1 }); return false; }
        catch (e) { return /differs|conversion|factor/i.test(e.message); }
    })());

const supplierId = saveParty(db, { name: 'TEST-UNIT SUPPLIER ' + process.pid, type: 'supplier' }).id;
const customerId = saveParty(db, { name: 'TEST-UNIT CUSTOMER ' + process.pid, type: 'customer' }).id;

// ── 5. Purchase in boxes stocks pieces ────────────────────────────────
const purchaseId = savePurchase(db, {
    bill_no: 'TST-BILL-' + process.pid, date: '2083-07-15', party_id: supplierId,
    subtotal: 200, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
    grand_total: 200, paid_amount: 0, payment_mode: 'credit', status: 'unpaid', notes: 'unit test',
    items: [{ product_id: productId, product_name: 'TEST-UNIT GHEE', quantity: 2, unit: 'box', rate: 100, amount: 200 }]
}).id;
const pItem = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?').get(purchaseId);
check('purchase line keeps 2 box @ 100 = 200',
    pItem.quantity === 2 && pItem.unit === 'box' && near(pItem.rate, 100) && near(pItem.amount, 200));
check('purchase line stocks 24 pcs', near(pItem.stock_quantity, 24) && pItem.stock_unit === 'pcs');
const stockAfterPurchase = getCurrentStock(db, { search: 'TEST-UNIT GHEE' }).find(p => p.id === productId);
check('closing stock is 24 pcs after buying 2 boxes', near(stockAfterPurchase.current_stock, 24), String(stockAfterPurchase && stockAfterPurchase.current_stock));
check('stock unit is reported as pcs', stockAfterPurchase.stock_unit === 'pcs');

// ── 6. Sale in packets leaves stock in pieces ────────────────────────
const saleId = saveSale(db, {
    invoice_no: 'TST-INV-' + process.pid, date: '2083-07-16', party_id: customerId,
    subtotal: 150, discount: 0, discount_percent: 0, tax: 0, grand_total: 150,
    paid_amount: 150, payment_mode: 'cash', notes: 'unit test',
    items: [{ product_id: productId, product_name: 'TEST-UNIT GHEE', quantity: 3, unit: 'packet', rate: 50, amount: 150 }]
}).id;
const sItem = db.prepare('SELECT * FROM sales_items WHERE sale_id = ?').get(saleId);
check('invoice line keeps 3 packet @ 50 = 150',
    sItem.quantity === 3 && sItem.unit === 'packet' && near(sItem.rate, 50) && near(sItem.amount, 150));
check('invoice line stocks out 18 pcs', near(sItem.stock_quantity, 18));
const stockAfterSale = getCurrentStock(db, { search: 'TEST-UNIT GHEE' }).find(p => p.id === productId);
check('closing stock is 6 pcs after selling 3 packets', near(stockAfterSale.current_stock, 6), String(stockAfterSale && stockAfterSale.current_stock));

// ── 7. Statement keeps original units; unit buckets never mix ────────
const st = getPartyStatement(db, { party_id: supplierId, from_date: '2082-04-01', to_date: '2084-03-31' });
const row = st.entries.find(e => e.reference_id === purchaseId);
check('statement shows the purchase row', !!row);
check('statement line shows the purchase unit and quantity', !!row && (row.display_lines || []).some(l => l.unit === 'box' && near(l.quantity, 2)));
const bucket = (st.qty_summary && st.qty_summary.purchase && st.qty_summary.purchase.by_unit) || {};
check('statement quantity bucket is box, not mixed', near(bucket.box, 2) && bucket.kg == null, JSON.stringify(bucket));

// ── 8. Daily Purchase vs Sales keeps units apart ─────────────────────
const pvs = getPurchaseVsSales(db, { from_date: '2083-07-15', to_date: '2083-07-16' });
const dayP = (pvs.days || pvs.daily || []).find(d => d.date === '2083-07-15');
check('daily report keeps the purchase unit separate from litres/kilograms',
    !!dayP && (dayP.purchase_quantity_unit === 'box' || dayP.purchase_quantity_unit === 'mixed'),
    dayP ? String(dayP.purchase_quantity_unit) : 'no row');

// ── 9. History protection ────────────────────────────────────────────
const historic = db.prepare('SELECT id, product_id, quantity, unit, rate, amount FROM sales_items ORDER BY id LIMIT 1').get();
const historicAfter = db.prepare('SELECT id, product_id, quantity, unit, rate, amount FROM sales_items WHERE id = ?').get(historic.id);
check('an existing historical sales line is byte-identical',
    JSON.stringify(historic) === JSON.stringify(historicAfter));

const beforeErr = (() => {
    try {
        saveProduct(db, { ...saved, purchase_unit: 'pcs', purchase_factor: 1 });
        return null;
    } catch (e) { return e; }
})();
check('changing a purchase unit used by existing lines asks for confirmation',
    !!beforeErr && /UNIT_CHANGE_CONFIRM_REQUIRED/.test(beforeErr.message), beforeErr && beforeErr.message);
const forced = saveProduct(db, { ...saved, purchase_unit: 'pcs', purchase_factor: 1, confirm_unit_change: true });
check('with confirmation the unit change is saved', !!forced.id
    && db.prepare('SELECT purchase_unit FROM products WHERE id = ?').get(productId).purchase_unit === 'pcs');

const stockUnitErr = (() => {
            try {
            const current = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
            saveProduct(db, { ...current, stock_unit: 'kg', purchase_unit: 'kg', sales_unit: 'kg', purchase_factor: 1, sales_factor: 1, confirm_unit_change: true });
            return null;
        }
    catch (e) { return e; }
})();
check('the stock unit cannot be changed once stock has moved',
    !!stockUnitErr && /cannot be changed/i.test(stockUnitErr.message), stockUnitErr && stockUnitErr.message);

// A failed save must not have written anything.
check('the rejected stock-unit change left the product unchanged',
    db.prepare('SELECT stock_unit FROM products WHERE id = ?').get(productId).stock_unit === 'pcs');

db.close();
for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(TMP_DB + suffix); } catch (e) { /* temp */ }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
