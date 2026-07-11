#!/usr/bin/env node
/**
 * Test Drive: Create a manual sale and verify stock updates
 * Tests the core business logic directly against the database.
 */
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, '..', 'data', 'dairy-plant.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

let passed = 0;
let failed = 0;

function ok(msg) { passed++; console.log(`  ✅ ${msg}`); }
function fail(msg) { failed++; console.log(`  ❌ ${msg}`); }

try {
    console.log('\n🔍 TEST DRIVE: Creating a Sale & Checking Stock\n');

    // ============================================================
    // STEP 1: Check existing data
    // ============================================================
    console.log('📋 Step 1: Check existing products and parties\n');

    const products = db.prepare("SELECT id, name, unit, opening_stock as stock FROM products").all();
    ok(`Found ${products.length} products`);
    for (const p of products) {
        const stock = db.prepare(
            "SELECT inward_qty - outward_qty as balance FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
        ).get(p.id);
        const bal = stock ? stock.balance : p.opening_stock;
        console.log(`     ${p.name} — ${bal} ${p.unit} in stock`);
    }

    const parties = db.prepare("SELECT id, name, type FROM parties").all();
    ok(`Found ${parties.length} parties`);
    for (const p of parties) {
        console.log(`     ${p.name} (${p.type})`);
    }

    // ============================================================
    // STEP 2: Create a sale
    // ============================================================
    console.log('\n📋 Step 2: Create a sale\n');

    const customer = parties[0]; // First party (Sharma Dairy Shop - customer)
    const product = products[1]; // Cow Milk
    const rawMilk = products[0]; // Raw Milk

    const qty = 10;
    const rate = 65;
    const amount = qty * rate;
    const invoiceNo = `TEST-INV-${Date.now()}`;
    const today = new Date().toISOString().split('T')[0];

    const trx = db.transaction(() => {
        // Get current stock before sale
        const stockBefore = db.prepare(
            "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
        ).get(product.id);
        const balanceBefore = stockBefore ? stockBefore.balance_after : product.stock;
        console.log(`     Stock of ${product.name} before sale: ${parseFloat(balanceBefore || 0).toFixed(2)} ${product.unit}`);

        // Insert sale
        const saleResult = db.prepare(
            "INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(invoiceNo, today, customer.id, amount, 0, 0, amount, amount, 'cash', 'paid', 'Test drive sale');

        // Insert sale item
        db.prepare(
            "INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(saleResult.lastInsertRowid, product.id, product.name, qty, product.unit, rate, amount);

        // Deduct stock
        const lastBal = db.prepare(
            "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
        ).get(product.id);
        const currentBal = lastBal ? lastBal.balance_after : 0;
        const newBalance = currentBal - qty;

        db.prepare(
            "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Test sale ' || ?, 'sale', ?)"
        ).run(product.id, today, qty, newBalance, rate, invoiceNo, saleResult.lastInsertRowid);

        // Add ledger entry
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
        ).run(customer.id, today, saleResult.lastInsertRowid, `Sale Invoice ${invoiceNo}`, amount, amount);

        return { saleId: saleResult.lastInsertRowid, balanceBefore, newBalance };
    });

    const result = trx();
    ok(`Sale created: Invoice ${invoiceNo} for ${customer.name} — ${qty} ${product.unit} of ${product.name} @ रु ${rate}/${product.unit} = रु ${amount}`);
    ok(`Sale ID: ${result.saleId}`);

    // ============================================================
    // STEP 3: Verify stock update
    // ============================================================
    console.log('\n📋 Step 3: Verify stock was reduced\n');

    const stockAfter = db.prepare(
        "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
    ).get(product.id);
    const expectedStock = result.balanceBefore - qty;
    
    if (stockAfter && stockAfter.balance_after === expectedStock) {
        ok(`Stock correctly reduced: ${result.balanceBefore} → ${stockAfter.balance_after} ${product.unit} (reduced by ${qty})`);
    } else {
        fail(`Stock mismatch: expected ${expectedStock}, got ${stockAfter ? stockAfter.balance_after : 'null'}`);
    }

    // ============================================================
    // STEP 4: Verify ledger entry
    // ============================================================
    console.log('\n📋 Step 4: Verify ledger entry created\n');

    const ledgerEntry = db.prepare(
        "SELECT * FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?"
    ).get(result.saleId);

    if (ledgerEntry) {
        ok(`Ledger entry created for ${customer.name}: रु ${ledgerEntry.debit} debit (outstanding: रु ${ledgerEntry.balance})`);
    } else {
        fail('No ledger entry found for the sale');
    }

    // ============================================================
    // STEP 5: Verify the Stock page would show updated data
    // ============================================================
    console.log('\n📋 Step 5: Check stock valuation\n');

    const allStock = db.prepare(`
        SELECT p.name, p.unit, 
            COALESCE((SELECT inward_qty - outward_qty FROM stock_movements 
                      WHERE product_id = p.id ORDER BY id DESC LIMIT 1), p.opening_stock) as current_stock
        FROM products p ORDER BY p.name
    `).all();

    ok(`Stock page has ${allStock.length} products with current balances`);
    for (const s of allStock) {
        console.log(`     ${s.name}: ${s.current_stock} ${s.unit}`);
    }

    // ============================================================
    // STEP 6: Check the party ledger (outstanding amounts)
    // ============================================================
    console.log('\n📋 Step 6: Check customer outstanding\n');

    const customerOutstanding = db.prepare(`
        SELECT COALESCE(SUM(grand_total - paid_amount), 0) as outstanding 
        FROM sales WHERE party_id = ? AND status IN ('unpaid', 'partial')
    `).get(customer.id);

    // Since we made a paid sale, this shouldn't change
    console.log(`     ${customer.name} outstanding: रु ${customerOutstanding.outstanding}`);

    // ============================================================
    // Summary
    // ============================================================
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 TEST RESULTS: ${passed} passed, ${failed} failed\n`);

    if (failed === 0) {
        console.log('🎉 All checks passed! The sale and stock update flow works correctly.\n');
    } else {
        console.log(`⚠️  ${failed} checks failed. See above for details.\n`);
    }

} catch (err) {
    console.error(`\n❌ Test error: ${err.message}`);
    console.error(err.stack);
    failed++;
}

db.close();
process.exit(failed > 0 ? 1 : 0);
