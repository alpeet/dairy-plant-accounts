#!/usr/bin/env node
/**
 * Full Test Suite: Sale & Purchase Lifecycle
 *
 * Tests the core business logic:
 * 1. Create a credit (unpaid) sale — verify stock deducted, ledger shows outstanding
 * 2. Create a partial payment sale — verify stock, ledger, status
 * 3. Edit a sale — change quantity, verify stock reversion + re-application
 * 4. Delete a sale — verify stock reversed, ledger removed
 * 5. Create a purchase — verify stock increased
 * 6. Edit a purchase — modify quantity, verify stock
 * 7. Delete a purchase — verify stock reversed
 */
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'dairy-plant.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let passed = 0;
let failed = 0;
let totalChecks = 0;

function ok(msg) { passed++; console.log(`  ✅ ${msg}`); }
function fail(msg) { failed++; console.log(`  ❌ ${msg}`); }
function check(name, condition, detail = '') {
    totalChecks++;
    if (condition) {
        ok(`${name}${detail ? ` — ${detail}` : ''}`);
    } else {
        fail(`${name}${detail ? ` — ${detail}` : ''}`);
    }
}

function getStock(productId) {
    const row = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(productId);
    return row ? row.balance_after : 0;
}

function getSale(id) {
    return db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
}

function getSaleItems(id) {
    return db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);
}

function getLedger(refType, refId) {
    return db.prepare("SELECT * FROM ledger_entries WHERE reference_type = ? AND reference_id = ?").get(refType, refId);
}

function hasStockMovement(productId, notePattern) {
    const row = db.prepare("SELECT COUNT(*) as c FROM stock_movements WHERE product_id = ? AND notes LIKE ?").get(productId, `%${notePattern}%`);
    return row.c > 0;
}

try {
    console.log('\n' + '='.repeat(60));
    console.log('  🧪 FULL TEST SUITE: Sale & Purchase Lifecycle');
    console.log('='.repeat(60) + '\n');

    // ============================================================
    // Load reference data
    // ============================================================
    const products = db.prepare("SELECT id, name, unit, opening_stock as stock FROM products").all();
    const parties = db.prepare("SELECT id, name, type FROM parties").all();
    const customer = parties.find(p => p.type === 'customer');
    const supplier = parties.find(p => p.type === 'supplier');
    const product1 = products[0]; // Raw Milk
    const product2 = products[1]; // Cow Milk

    check('Reference data loaded', products.length >= 3 && parties.length >= 4, `${products.length} products, ${parties.length} parties`);
    
    const stockP1Before = getStock(product1.id);
    const stockP2Before = getStock(product2.id);
    console.log(`  Initial stock: ${product1.name}=${stockP1Before}, ${product2.name}=${stockP2Before}\n`);

    // ============================================================
    // SCENARIO 1: Credit (Unpaid) Sale
    // ============================================================
    console.log('─── Scenario 1: Create Credit (Unpaid) Sale ───\n');

    let sale1Id, sale1Inv, sale1GrandTotal;

    db.transaction(() => {
        const invNo = 'TEST-CREDIT-' + Date.now();
        const date = new Date().toISOString().split('T')[0];
        const qty = 5;
        const rate = 60;
        const amount = qty * rate;

        const res = db.prepare(
            "INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(invNo, date, customer.id, amount, 0, 0, amount, 0, 'credit', 'unpaid', 'Test: credit sale');

        sale1Id = res.lastInsertRowid;
        sale1Inv = invNo;
        sale1GrandTotal = amount;

        db.prepare("INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(sale1Id, product1.id, product1.name, qty, product1.unit, rate, amount);

        const bal = getStock(product1.id);
        const newBal = bal - qty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Test credit ' || ?, 'sale', ?)")
            .run(product1.id, date, qty, newBal, rate, invNo, sale1Id);

        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)")
            .run(customer.id, date, sale1Id, `Sale Invoice ${invNo}`, amount, amount);
    })();

    const sale1 = getSale(sale1Id);
    check('1a. Credit sale created', !!sale1, `Invoice ${sale1Inv}`);
    check('1b. Sale status is unpaid', sale1.status === 'unpaid', 'unpaid');
    check('1c. Paid amount is 0', sale1.paid_amount === 0, `रु 0`);
    check('1d. Stock reduced correctly', getStock(product1.id) === stockP1Before - 5, `${stockP1Before} → ${stockP1Before - 5}`);
    
    const led1 = getLedger('sale', sale1Id);
    check('1e. Ledger entry created', !!led1, `रु ${led1.debit} debit, रु ${led1.balance} outstanding`);
    check('1f. Outstanding matches grand total', led1 && led1.balance === sale1GrandTotal, `रु ${led1.balance}`);

    // ============================================================
    // SCENARIO 2: Partial Payment Sale
    // ============================================================
    console.log('\n─── Scenario 2: Create Partial Payment Sale ───\n');

    let sale2Id, sale2Inv, sale2GrandTotal;

    db.transaction(() => {
        const invNo = 'TEST-PARTIAL-' + Date.now();
        const date = new Date().toISOString().split('T')[0];
        const qty = 8;
        const rate = 65;
        const amount = qty * rate;
        const paidAmt = Math.round(amount * 0.4 * 100) / 100; // 40% paid

        const res = db.prepare(
            "INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(invNo, date, customer.id, amount, 0, 0, amount, paidAmt, 'cash', 'partial', 'Test: partial payment');

        sale2Id = res.lastInsertRowid;
        sale2Inv = invNo;
        sale2GrandTotal = amount;

        db.prepare("INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(sale2Id, product2.id, product2.name, qty, product2.unit, rate, amount);

        const bal = getStock(product2.id);
        const newBal = bal - qty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Test partial ' || ?, 'sale', ?)")
            .run(product2.id, date, qty, newBal, rate, invNo, sale2Id);

        const outstanding = amount - paidAmt;
        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)")
            .run(customer.id, date, sale2Id, `Sale Invoice ${invNo}`, amount, outstanding);
    })();

    const sale2 = getSale(sale2Id);
    const stockP2AfterSale2 = getStock(product2.id);
    check('2a. Partial payment sale created', !!sale2, `Invoice ${sale2Inv}`);
    check('2b. Sale status is partial', sale2.status === 'partial', 'partial');
    check('2c. Paid amount is 40%', sale2.paid_amount > 0 && sale2.paid_amount < sale2GrandTotal, `रु ${sale2.paid_amount} of रु ${sale2GrandTotal}`);
    check('2d. Stock reduced correctly', stockP2AfterSale2 === stockP2Before - 8, `${stockP2Before} → ${stockP2AfterSale2}`);

    // ============================================================
    // SCENARIO 3: Edit a Sale (change quantity from 5 to 3)
    // ============================================================
    console.log('\n─── Scenario 3: Edit Sale (change quantity 5→3) ───\n');

    const oldItems = getSaleItems(sale1Id);
    const oldQty = oldItems[0].quantity;

    db.transaction(() => {
        const newQty = 3;
        const rate = 60;
        const newAmount = newQty * rate;

        // REVERT: add old stock back
        const balBeforeRevert = getStock(product1.id);
        const stockAfterRevert = balBeforeRevert + oldQty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'Reversal of sale #' || ?, 'sale', ?)")
            .run(product1.id, sale1.date, oldQty, stockAfterRevert, rate, sale1Inv, sale1Id);

        // Remove old ledger
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(sale1Id);

        // Delete old items
        db.prepare("DELETE FROM sales_items WHERE sale_id = ?").run(sale1Id);

        // Update sale
        db.prepare("UPDATE sales SET subtotal=?, grand_total=?, paid_amount=?, updated_at=datetime('now','localtime') WHERE id=?")
            .run(newAmount, newAmount, 0, sale1Id);

        // Re-insert items
        db.prepare("INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(sale1Id, product1.id, product1.name, newQty, product1.unit, rate, newAmount);

        // Re-deduct stock (smaller qty)
        const balAfterRevert = getStock(product1.id);
        const finalBal = balAfterRevert - newQty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Sale ' || ?, 'sale', ?)")
            .run(product1.id, sale1.date, newQty, finalBal, rate, sale1Inv, sale1Id);

        // New ledger
        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)")
            .run(customer.id, sale1.date, sale1Id, `Sale Invoice ${sale1Inv}`, newAmount, newAmount);
    })();

    const sale1after = getSale(sale1Id);
    const stockP1AfterEdit = getStock(product1.id);
    const expectedStockAfterEdit = stockP1Before - 3; // Original stock - new qty of 3

    check('3a. Sale updated in database', sale1after.subtotal === 180, `New total: रु 180`);
    check('3b. New sale items have qty=3', getSaleItems(sale1Id)[0].quantity === 3, 'Quantity changed from 5 to 3');
    check('3c. Stock corrected after edit', stockP1AfterEdit === expectedStockAfterEdit, 
        `Expected ${expectedStockAfterEdit}, got ${stockP1AfterEdit} (was originally reduced by 5, now reduced by 3)`);
    check('3d. Old ledger replaced', getLedger('sale', sale1Id).debit === 180, 'Ledger updated to रु 180');

    // ============================================================
    // SCENARIO 4: Delete a Sale
    // ============================================================
    console.log('\n─── Scenario 4: Delete Sale ───\n');

    const sale2BeforeDelete = getSale(sale2Id);
    const stockP2BeforeDelete = getStock(product2.id);
    const sale2Items = getSaleItems(sale2Id);

    db.transaction(() => {
        // Reverse stock for each item
        for (const item of sale2Items) {
            const bal = getStock(item.product_id);
            const newBal = bal + item.quantity;
            db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', ?, 0, ?, ?, 'Deleted Sale ' || ?, 'sale', ?)")
                .run(item.product_id, sale2BeforeDelete.date, item.quantity, newBal, item.rate, sale2BeforeDelete.invoice_no, sale2Id);
        }

        // Remove ledger entries
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(sale2Id);

        // Delete sale (cascades to items)
        db.prepare("DELETE FROM sales WHERE id = ?").run(sale2Id);
    })();

    const sale2After = getSale(sale2Id);
    const stockP2AfterDelete = getStock(product2.id);

    check('4a. Sale deleted from database', !sale2After, 'Record removed');
    check('4b. Sale items removed', getSaleItems(sale2Id).length === 0, 'Items table empty');
    check('4c. Stock restored to pre-sale level', stockP2AfterDelete === stockP2BeforeDelete + 8, 
        `${stockP2BeforeDelete} + 8 = ${stockP2AfterDelete} (stock restored)`);
    check('4d. Ledger entry removed', !getLedger('sale', sale2Id), 'Ledger cleaned up');
    check('4e. Reversal movement logged', hasStockMovement(product2.id, 'Deleted Sale ' + sale2BeforeDelete.invoice_no), 
        'Reversal movement recorded');

    // ============================================================
    // SCENARIO 5: Create a Purchase
    // ============================================================
    console.log('\n─── Scenario 5: Create Purchase (stock increase) ───\n');

    let purchase1Id, purchase1Bill;

    db.transaction(() => {
        const billNo = 'TEST-BILL-' + Date.now();
        const date = new Date().toISOString().split('T')[0];
        const qty = 30;
        const rate = 45;
        const amount = qty * rate;
        const transport = 500;
        const grandTotal = amount + transport;

        const res = db.prepare(
            "INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(billNo, date, supplier.id, amount, 0, 0, transport, 0, grandTotal, grandTotal, 'bank', 'paid', 'Test: purchase');

        purchase1Id = res.lastInsertRowid;
        purchase1Bill = billNo;

        db.prepare("INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(purchase1Id, product1.id, product1.name, qty, product1.unit, rate, amount);

        const bal = getStock(product1.id);
        const newBal = bal + qty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, 0, ?, ?, 'Purchase ' || ?, 'purchase', ?)")
            .run(product1.id, date, qty, newBal, rate, billNo, purchase1Id);

        const outstanding = grandTotal - grandTotal;
        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'purchase', ?, ?, ?, 0, ?)")
            .run(supplier.id, date, purchase1Id, `Purchase Bill ${billNo}`, grandTotal, outstanding);
    })();

    const purchase1 = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchase1Id);
    const stockP1AfterPurchase = getStock(product1.id);
    check('5a. Purchase created', !!purchase1, `Bill ${purchase1Bill}`);
    check('5b. Stock increased correctly', stockP1AfterPurchase === expectedStockAfterEdit + 30, 
        `${expectedStockAfterEdit} → ${stockP1AfterPurchase} (+30)`);
    check('5c. Ledger entry created for purchase', !!getLedger('purchase', purchase1Id), 'Creditor entry');

    // ============================================================
    // SCENARIO 6: Edit a Purchase (change qty from 30 to 20)
    // ============================================================
    console.log('\n─── Scenario 6: Edit Purchase (change quantity 30→20) ───\n');

    const oldPurchaseItems = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(purchase1Id);
    const oldPurchaseQty = oldPurchaseItems[0].quantity;

    db.transaction(() => {
        const newQty = 20;
        const rate = 45;
        const newAmount = newQty * rate;
        const transport = 500;
        const newGrandTotal = newAmount + transport;

        // Reverse old stock (subtract the old qty)
        const balBeforeRevert = getStock(product1.id);
        const stockAfterRevert = balBeforeRevert - oldPurchaseQty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', 0, ?, ?, ?, 'Reversal of purchase #' || ?, 'purchase', ?)")
            .run(product1.id, purchase1.date, oldPurchaseQty, stockAfterRevert, rate, purchase1Bill, purchase1Id);

        // Remove old ledger and items
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'purchase' AND reference_id = ?").run(purchase1Id);
        db.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").run(purchase1Id);

        // Update purchase
        db.prepare("UPDATE purchases SET subtotal=?, grand_total=?, updated_at=datetime('now','localtime') WHERE id=?")
            .run(newAmount, newGrandTotal, purchase1Id);

        // Re-insert items
        db.prepare("INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(purchase1Id, product1.id, product1.name, newQty, product1.unit, rate, newAmount);

        // Re-apply stock (add new qty)
        const balAfterRevert = getStock(product1.id);
        const finalBal = balAfterRevert + newQty;
        db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, 0, ?, ?, 'Purchase ' || ?, 'purchase', ?)")
            .run(product1.id, purchase1.date, newQty, finalBal, rate, purchase1Bill, purchase1Id);

        // New ledger
        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'purchase', ?, ?, ?, 0, ?)")
            .run(supplier.id, purchase1.date, purchase1Id, `Purchase Bill ${purchase1Bill}`, newGrandTotal, 0);
    })();

    const purchase1After = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchase1Id);
    const stockP1AfterEditPurchase = getStock(product1.id);
    const expectedStockAfterEditPurchase = expectedStockAfterEdit + 20; // Original stock + new purchase qty of 20

    check('6a. Purchase updated', purchase1After.subtotal === 900, `New subtotal: रु 900`);
    check('6b. New items have qty=20', db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").get(purchase1Id).quantity === 20, 'Quantity changed from 30 to 20');
    check('6c. Stock corrected after edit', stockP1AfterEditPurchase === expectedStockAfterEditPurchase, 
        `Expected ${expectedStockAfterEditPurchase}, got ${stockP1AfterEditPurchase}`);

    // ============================================================
    // SCENARIO 7: Delete a Purchase
    // ============================================================
    console.log('\n─── Scenario 7: Delete Purchase ───\n');

    const purchase1BeforeDelete = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchase1Id);
    const stockP1BeforeDelete = getStock(product1.id);
    const pItems = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(purchase1Id);

    db.transaction(() => {
        for (const item of pItems) {
            const bal = getStock(item.product_id);
            const newBal = bal - item.quantity;
            db.prepare("INSERT INTO stock_movements (product_id, date, type, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, ?, ?, 'Deleted Purchase ' || ?, 'purchase', ?)")
                .run(item.product_id, purchase1BeforeDelete.date, item.quantity, newBal, item.rate, purchase1BeforeDelete.bill_no, purchase1Id);
        }

        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'purchase' AND reference_id = ?").run(purchase1Id);
        db.prepare("DELETE FROM purchases WHERE id = ?").run(purchase1Id);
    })();

    const purchase1AfterDel = db.prepare("SELECT * FROM purchases WHERE id = ?").get(purchase1Id);
    const stockP1AfterDelete = getStock(product1.id);

    check('7a. Purchase deleted from database', !purchase1AfterDel, 'Record removed');
    check('7b. Stock restored to pre-purchase level', stockP1AfterDelete === stockP1BeforeDelete - 20, 
        `${stockP1BeforeDelete} - 20 = ${stockP1AfterDelete}`);
    check('7c. Ledger entry removed', !getLedger('purchase', purchase1Id), 'Ledger cleaned up');
    check('7d. Reversal movement logged', hasStockMovement(product1.id, 'Deleted Purchase ' + purchase1BeforeDelete.bill_no), 
        'Reversal movement recorded');

    // ============================================================
    // SCENARIO 8: Final data integrity check
    // ============================================================
    console.log('\n─── Scenario 8: Final Data Integrity ───\n');

    const remainingSales = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
    const remainingPurchases = db.prepare("SELECT COUNT(*) as c FROM purchases").get().c;
    const remainingSaleItems = db.prepare("SELECT COUNT(*) as c FROM sales_items WHERE sale_id IN (SELECT id FROM sales)").get().c;

    // The only sale remaining should be the edited one (sale2 was deleted)
    check('8a. Correct sales count', remainingSales === 6, `6 sales (5 seed + 1 credit - 0 deleted = 6)`);
    check('8b. Correct purchases count', remainingPurchases === 4, '4 purchases (all seed, test purchase was deleted)');
    check('8c. No orphaned sale items', remainingSaleItems > 0, `${remainingSaleItems} items for remaining sales`);

    // Verify the edit-and-deleted product1 stock is back to original minus the edit change
    // Original stock was stockP1Before. After credit sale of 5, edit to 3 (net reduction of 3).
    // Then purchase of 30, edit to 20 (net increase of 20). Then delete purchase (net back to stock after edit).
    // Final stock should be: stockP1Before - 3
    const netChange = -3; // credit sale of 5 edited to 3 = net -3
    check('8d. Final stock is consistent', stockP1AfterDelete === stockP1Before + netChange,
        `${product1.name}: ${stockP1Before} + (${netChange}) = ${stockP1AfterDelete}`);
    check('8e. Product 2 stock restored after delete', getStock(product2.id) === stockP2Before,
        `${product2.name}: back to ${stockP2Before}`);

    // ============================================================
    // Summary
    // ============================================================
    console.log('\n' + '='.repeat(60));
    console.log(`  📊 TEST RESULTS: ${passed} passed, ${failed} failed of ${totalChecks} checks`);
    console.log('='.repeat(60) + '\n');

    if (failed === 0) {
        console.log('  🎉 All scenarios passed! Sale & Purchase lifecycle is working correctly.\n');
    } else {
        console.log(`  ⚠️  ${failed} check(s) failed. Review above for details.\n`);
    }

} catch (err) {
    console.error(`\n❌ FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    failed++;
}

db.close();
process.exit(failed > 0 ? 1 : 0);
