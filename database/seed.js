/**
 * Seed script for Godhuli Dairy Plant
 * Run: node database/seed.js
 * 
 * This script creates demo data for testing the application.
 * It can be run independently to populate an existing database.
 */

const path = require('path');
const fs = require('fs');

// Determine database path
const dbDir = process.env.DB_PATH || path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'dairy-plant.db');

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

console.log('Database seeded at:', dbPath);

const trx = db.transaction(() => {
    // ============================================================
    // Sample Dairy Products
    // ============================================================
    const products = [
        { name: 'Raw Milk', unit: 'liter', category: 'Milk', opening_stock: 1000, reorder_level: 200, rate: 60 },
        { name: 'Cow Milk', unit: 'liter', category: 'Milk', opening_stock: 500, reorder_level: 100, rate: 60 },
        { name: 'Curd (Dahi)', unit: 'kg', category: 'Curd', opening_stock: 100, reorder_level: 20, rate: 100 },
        { name: 'Ghee', unit: 'kg', category: 'Ghee', opening_stock: 50, reorder_level: 10, rate: 600 },
        { name: 'Paneer', unit: 'kg', category: 'Paneer', opening_stock: 30, reorder_level: 5, rate: 320 }
    ];

    const insertProduct = db.prepare(
        "INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertStockMovement = db.prepare(
        "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, date('now', 'localtime'), 'opening', ?, 0, ?, ?, 'Opening Stock')"
    );

    for (const p of products) {
        const result = insertProduct.run(p.name, p.unit, p.category, p.opening_stock, p.reorder_level, p.rate);
        insertStockMovement.run(result.lastInsertRowid, p.opening_stock, p.opening_stock, p.rate);
    }

    // ============================================================
    // Sample Parties
    // ============================================================
    const parties = [
        { name: 'Sharma Dairy Shop', phone: '9812345670', address: 'New Road, Kathmandu', type: 'customer', opening_balance: 15000 },
        { name: 'Bhatbhateni Supermarket', phone: '9812345672', address: 'Durbar Marg, Kathmandu', type: 'customer', opening_balance: 45000 },
        { name: 'Gurung Dairy Farm', phone: '9852345673', address: 'Budhanilkantha, Kathmandu', type: 'supplier', opening_balance: 50000 },
        { name: 'Fresh Valley Suppliers', phone: '9841234570', address: 'Bhaktapur', type: 'supplier', opening_balance: 12000 },
        { name: 'Patan Dairy Cooperative', phone: '9852345675', address: 'Patan, Lalitpur', type: 'both', opening_balance: 0 }
    ];

    const insertParty = db.prepare(
        "INSERT INTO parties (name, phone, address, type, opening_balance) VALUES (?, ?, ?, ?, ?)"
    );

    const insertLedgerEntry = db.prepare(
        "INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, date('now', 'localtime'), 'opening', 'Opening Balance', ?, 0, ?)"
    );

    let partyIds = {};
    for (const p of parties) {
        const result = insertParty.run(p.name, p.phone, p.address, p.type, p.opening_balance || 0);
        partyIds[p.name] = result.lastInsertRowid;
        if (p.opening_balance && p.opening_balance > 0) {
            insertLedgerEntry.run(result.lastInsertRowid, p.opening_balance, p.opening_balance);
        }
    }

    // ============================================================
    // Sample Sales (last 30 days)
    // ============================================================
    const saleParties = ['Sharma Dairy Shop', 'Bhatbhateni Supermarket', 'Patan Dairy Cooperative'];
    const productsList = db.prepare("SELECT * FROM products").all();

    const insertSale = db.prepare(
        "INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertSaleItem = db.prepare(
        "INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertSaleLedger = db.prepare(
        "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
    );
    const insertStockOut = db.prepare(
        "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, ?, 'sale', ?)"
    );

    let invoiceCounter = 1001;
    const paymentModes = ['cash', 'credit', 'bank', 'upi'];
    const statuses = ['paid', 'paid', 'unpaid', 'partial'];

    // 5 sample sales over the past week
    const saleDates = [0, 1, 3, 5, 7];
    for (const dayOffset of saleDates) {
        const date = new Date();
        date.setDate(date.getDate() - dayOffset);
        const dateStr = date.toISOString().split('T')[0];

        const partyName = saleParties[Math.floor(Math.random() * saleParties.length)];
        const partyId = partyIds[partyName];
        const numItems = Math.floor(Math.random() * 2) + 1; // 1-2 items
        let items = [];
        let subtotal = 0;

        const usedProducts = new Set();
        for (let i = 0; i < numItems; i++) {
            let product;
            do {
                product = productsList[Math.floor(Math.random() * productsList.length)];
            } while (usedProducts.has(product.id));
            usedProducts.add(product.id);

            const qty = Math.round((Math.random() * 20 + 1) * 100) / 100;
            const rate = product.rate + Math.round((Math.random() - 0.5) * 20);
            const amount = Math.round(qty * rate * 100) / 100;
            items.push({ product_id: product.id, name: product.name, unit: product.unit, quantity: qty, rate, amount });
            subtotal += amount;
        }

        const discount = Math.round(subtotal * (Math.random() * 0.05) * 100) / 100;
        const grandTotal = Math.round((subtotal - discount) * 100) / 100;
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const paidAmount = status === 'paid' ? grandTotal : (status === 'partial' ? Math.round(grandTotal * 0.5 * 100) / 100 : 0);
        const paymentMode = paidAmount > 0 ? paymentModes[Math.floor(Math.random() * paymentModes.length)] : 'credit';

        const invoiceNo = `INV-${invoiceCounter++}`;
        const saleResult = insertSale.run(invoiceNo, dateStr, partyId, subtotal, discount, 0, grandTotal, paidAmount, paymentMode, status, `Sample sale ${invoiceNo}`);

        for (const item of items) {
            insertSaleItem.run(saleResult.lastInsertRowid, item.product_id, item.name, item.quantity, item.unit, item.rate, item.amount);

            // Update stock (reduce)
            const lastBal = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(item.product_id);
            const currentBal = lastBal ? lastBal.balance_after : item.quantity * 10;
            const newBalance = currentBal - item.quantity;
            insertStockOut.run(item.product_id, dateStr, item.quantity, newBalance, item.rate, invoiceNo, saleResult.lastInsertRowid);
        }

        const outstanding = grandTotal - paidAmount;
        insertSaleLedger.run(partyId, dateStr, saleResult.lastInsertRowid, `Sale Invoice ${invoiceNo}`, grandTotal, Math.max(0, outstanding));
    }

    // ============================================================
    // Sample Purchases (last 30 days)
    // ============================================================
    const purchaseParties = ['Gurung Dairy Farm', 'Fresh Valley Suppliers', 'Patan Dairy Cooperative'];

    const insertPurchase = db.prepare(
        "INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertPurchaseItem = db.prepare(
        "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertPurchaseLedger = db.prepare(
        "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'purchase', ?, ?, ?, 0, ?)"
    );
    const insertStockIn = db.prepare(
        "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, 0, ?, ?, ?, 'purchase', ?)"
    );

    let billCounter = 5001;

    // 4 sample purchases over the past week
    const purchaseDates = [0, 2, 4, 6];
    for (const dayOffset of purchaseDates) {
        const date = new Date();
        date.setDate(date.getDate() - dayOffset);
        const dateStr = date.toISOString().split('T')[0];

        const partyName = purchaseParties[Math.floor(Math.random() * purchaseParties.length)];
        const partyId = partyIds[partyName];
        const numItems = Math.floor(Math.random() * 2) + 1; // 1-2 items
        let items = [];
        let subtotal = 0;

        const usedProducts = new Set();
        for (let i = 0; i < numItems; i++) {
            let product;
            do {
                product = productsList[Math.floor(Math.random() * productsList.length)];
            } while (usedProducts.has(product.id));
            usedProducts.add(product.id);

            const qty = Math.round((Math.random() * 50 + 10) * 100) / 100;
            const rate = Math.round((product.rate * 0.7 + Math.random() * 10) * 100) / 100;
            const amount = Math.round(qty * rate * 100) / 100;
            items.push({ product_id: product.id, name: product.name, unit: product.unit, quantity: qty, rate, amount });
            subtotal += amount;
        }

        const transportCharges = Math.round(Math.random() * 2000 * 100) / 100;
        const grandTotal = Math.round((subtotal + transportCharges) * 100) / 100;
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        const paidAmount = status === 'paid' ? grandTotal : (status === 'partial' ? Math.round(grandTotal * 0.6 * 100) / 100 : 0);

        const billNo = `BILL-${billCounter++}`;
        const purchaseResult = insertPurchase.run(billNo, dateStr, partyId, subtotal, 0, 0, transportCharges, 0, grandTotal, paidAmount, 'bank', status, `Sample purchase ${billNo}`);

        for (const item of items) {
            insertPurchaseItem.run(purchaseResult.lastInsertRowid, item.product_id, item.name, item.quantity, item.unit, item.rate, item.amount);

            // Update stock (increase)
            const lastBal = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(item.product_id);
            const currentBal = lastBal ? lastBal.balance_after : 0;
            const newBalance = currentBal + item.quantity;
            insertStockIn.run(item.product_id, dateStr, item.quantity, newBalance, item.rate, billNo, purchaseResult.lastInsertRowid);
        }

        const outstanding = grandTotal - paidAmount;
        insertPurchaseLedger.run(partyId, dateStr, purchaseResult.lastInsertRowid, `Purchase Bill ${billNo}`, grandTotal, Math.max(0, outstanding));
    }

    // ============================================================
    // Sample Milk Collections (last 14 days)
    // ============================================================
    const farmers = ['Gurung Dairy Farm', 'Fresh Valley Suppliers', 'Patan Dairy Cooperative'];
    const milkTypes = ['cow', 'buffalo', 'mixed'];
    const shifts = ['morning', 'evening'];

    const insertMilk = db.prepare(
        "INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters, fat_percent, snf_percent, rate, amount, shift, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertMilkStock = db.prepare(
        "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', ?, 0, ?, 60, 'Milk collection #' || ?, 'milk_collection', ?)"
    );

    // Find the Raw Milk product ID (it should be the first product inserted)
    const rawMilkProduct = db.prepare("SELECT id FROM products WHERE name = 'Raw Milk'").get();
    const rawMilkProductId = rawMilkProduct ? rawMilkProduct.id : 1;

    let milkCounter = 2001;

    // 4 sample milk collections
    const collectionDates = [0, 1, 3, 5];
    for (const dayOffset of collectionDates) {
        const date = new Date();
        date.setDate(date.getDate() - dayOffset);
        const dateStr = date.toISOString().split('T')[0];

        const farmerName = farmers[Math.floor(Math.random() * farmers.length)];
        const farmerId = partyIds[farmerName];
        if (!farmerId) continue;

        const milkType = milkTypes[Math.floor(Math.random() * milkTypes.length)];
        const shift = shifts[Math.floor(Math.random() * shifts.length)];
        const quantity = Math.round((Math.random() * 40 + 10) * 100) / 100; // 10-50 liters
        const fat = Math.round((Math.random() * 4 + 3) * 10) / 10; // 3-7%
        const baseRate = milkType === 'buffalo' ? 80 : milkType === 'mixed' ? 70 : 60;
        const rate = baseRate + Math.round((Math.random() - 0.5) * 10);
        const adjustedRate = rate * (fat / 3.5);
        const amount = Math.round(quantity * adjustedRate * 100) / 100;

        const collectionNo = `MILK-${milkCounter++}`;
        const milkStatuses = ['pending', 'processed', 'paid'];
        const status = milkStatuses[Math.floor(Math.random() * milkStatuses.length)];

        const result = insertMilk.run(collectionNo, dateStr, farmerId, milkType, quantity, fat, Math.round((Math.random() * 2 + 8) * 10) / 10, Math.round(rate * 100) / 100, amount, shift, status);
        const collectionId = result.lastInsertRowid;

        // Also create stock movement for each collection (increase raw milk inventory)
        const lastBal = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(rawMilkProductId);
        const currentBal = lastBal ? lastBal.balance_after : 1000;
        const newBalance = currentBal + quantity;
        insertMilkStock.run(rawMilkProductId, dateStr, quantity, newBalance, collectionNo, collectionId);
    }

    console.log(`Seeded ${products.length} products, ${parties.length} parties, ${saleDates.length} sales, ${purchaseDates.length} purchases, and ${collectionDates.length} milk collections.`);
});

trx();
db.close();
console.log('Seed completed successfully!');
