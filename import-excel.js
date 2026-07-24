#!/usr/bin/env node
/**
 * Godhuli Dairy Plant — Import from Dairy_Accounts_Professional.xlsx
 * ===================================================================
 * Migrates all data from the Excel workbook into the SQLite database.
 *
 * Data Mapping:
 *   Party_Master    → parties
 *   Stock_Master    → products + stock_movements (opening)
 *   Sales_Entry     → sales + sales_items
 *   Purchase_Entry  → purchases + purchase_items
 *   Cash_Collection → payments
 *   Party_Ledger    → ledger_entries
 *
 * Usage:
 *   node import-excel.js
 *
 * This will:
 *   1. Initialize the database (create schema if missing)
 *   2. Clear existing business data (preserves users)
 *   3. Import all records from the Excel file
 */

const path = require('path');
const fs = require('fs');

// ── Configuration ──────────────────────────────────────────────
const PROJECT_ROOT = __dirname;
// Respect DB_DIR env var (used on Render for persistent disk), fall back to local ./data
const DB_DIR = process.env.DB_DIR || path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'dairy-plant.db');
const EXCEL_PATH = path.join(PROJECT_ROOT, 'Dairy_Accounts_Professional.xlsx');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'database', 'schema.sql');

// All Excel sheets in this workbook have: Row 0 = title, Row 1 = column headers, Row 2+ = data
const SHEET_DATA_START_ROW = 2;

// ── Dependencies ───────────────────────────────────────────────
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

/**
 * Convert a value (possibly Date or serial number) to a YYYY-MM-DD date string.
 */
function toDateStr(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const d = String(val.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    if (typeof val === 'number') {
        // Excel serial date number
        const d = new Date((val - 25569) * 86400 * 1000);
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${dd}`;
        }
    }
    const s = String(val).trim();
    // Try parsing ISO date (with - or / as delimiter)
    const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    return s;
}

/**
 * Convert a value to a number (or 0).
 */
function toNum(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}

/**
 * Convert a value to a trimmed string (or '').
 */
function toStr(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

/**
 * Normalize a party/type name for comparison.
 */
function normalize(str) {
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Map Excel party type to DB party type.
 */
function mapPartyType(type) {
    const t = normalize(type);
    if (t === 'customer') return 'customer';
    if (t === 'supplier') return 'supplier';
    if (t === 'both') return 'both';
    if (t === 'farmer') return 'farmer';
    // Default: if name suggests supplier
    return 'customer';
}

/**
 * Map payment mode from Excel to DB.
 */
function mapPaymentMode(mode) {
    const m = normalize(mode);
    if (m === 'cash') return 'cash';
    if (m === 'credit') return 'credit';
    if (m === 'bank' || m === 'bank transfer' || m === 'bank_transfer') return 'bank';
    if (m === 'upi') return 'upi';
    if (m === 'cheque') return 'bank';
    return 'cash';
}

/**
 * Map payment status from Excel to DB.
 */
function mapStatus(status) {
    const s = normalize(status);
    if (s === 'paid' || s === 'payment') return 'paid';
    if (s === 'unpaid') return 'unpaid';
    if (s === 'partial') return 'partial';
    return 'paid';
}

// ════════════════════════════════════════════════════════════════
// INIT DATABASE
// ════════════════════════════════════════════════════════════════

function initDb() {
    // Ensure data directory
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema if tables don't exist
    const tableCount = db.prepare(
        "SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='parties'"
    ).get().c;

    if (tableCount === 0) {
        console.log('  → Initializing database schema...');
        const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
        db.exec(schema);
    }

    return db;
}

/**
 * Clear all business data from the database (preserves users table).
 */
function clearBusinessData(db) {
    const tables = [
        'ledger_entries', 'payments', 'stock_movements',
        'sales_items', 'sales', 'purchase_items', 'purchases',
        'milk_collections', 'production_inputs', 'production_outputs',
        'production_batches', 'partner_capital', 'denomination_counts',
        'petty_cash', 'salary_records', 'vehicle_expenses', 'other_expenses',
        'audit_log', 'milk_rate_chart', 'products', 'parties', 'routes'
    ];

    const trx = db.transaction(() => {
        for (const t of tables) {
            db.prepare(`DELETE FROM ${t}`).run();
        }
    });

    trx();
    console.log('  → Cleared existing business data');
}

// ════════════════════════════════════════════════════════════════
// IMPORT FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Import Party_Master → parties table.
 * Returns a map of party name → party id.
 */
function importParties(db, sheetData) {
    console.log('\n  📋 Importing Parties...');

    const insertParty = db.prepare(`
        INSERT INTO parties (name, type, phone, address, opening_balance, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'opening', 'Opening Balance', ?, 0, ?, ?)
    `);

    // Header mapping
    // Col 0: Party Name, 1: Type, 2: Phone, 3: Address, 4: Opening Balance
    const nameIdx = 0, typeIdx = 1, phoneIdx = 2, addrIdx = 3, balIdx = 4;

    let partyCount = 0;
    let ledgerCount = 0;
    const partyNameToId = {};

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[nameIdx]) continue;

            const name = toStr(row[nameIdx]);
            if (!name) continue;
            // Skip common header-like rows
            if (normalize(name) === 'party name') continue;

            const type = mapPartyType(toStr(row[typeIdx]));
            const phone = toStr(row[phoneIdx]);
            const address = toStr(row[addrIdx]);
            const openingBal = toNum(row[balIdx]);

            const result = insertParty.run(name, type, phone, address, openingBal, 'Imported from Excel', new Date().toISOString());
            const partyId = result.lastInsertRowid;
            partyNameToId[normalize(name)] = partyId;

            if (openingBal !== 0) {
                // Opening balance as debit (receivable) if positive, credit (payable) if negative
                const debit = openingBal > 0 ? openingBal : 0;
                const credit = openingBal < 0 ? Math.abs(openingBal) : 0;
                const balance = openingBal;
                insertLedger.run(partyId, new Date().toISOString().split('T')[0], debit, credit, balance, new Date().toISOString());
                ledgerCount++;
            }

            partyCount++;
        }
    });

    trx();
    console.log(`  ✅ ${partyCount} parties imported`);
    if (ledgerCount > 0) console.log(`  📊 ${ledgerCount} opening balance ledger entries created`);
    return partyNameToId;
}

/**
 * Import Stock_Master → products + opening stock movements.
 * Returns a map of product name → product id.
 */
function importProducts(db, sheetData) {
    console.log('\n  📋 Importing Products...');

    const insertProduct = db.prepare(`
        INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStock = db.prepare(`
        INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, created_at)
        VALUES (?, ?, 'opening', ?, 0, ?, ?, 'Opening Stock from Excel', ?)
    `);

    // Col 0: Product Name, 1: Unit, 2: Opening Stock, 3: Purchases In, 4: Sales Out,
    // 5: Current Stock, 6: Reorder Level, 7: Rate, 8: Stock Value, 9: Status
    const nameIdx = 0, unitIdx = 1, openingIdx = 2, reorderIdx = 6, rateIdx = 7;

    // Auto-detect category from product name
    function detectCategory(name) {
        const n = name.toLowerCase();
        if (n.includes('milk')) return 'Milk';
        if (n.includes('ghee')) return 'Ghee';
        if (n.includes('paneer') || n.includes('chena') || n.includes('chhena')) return 'Paneer';
        if (n.includes('curd') || n.includes('dahi') || n.includes('yogurt')) return 'Curd';
        if (n.includes('butter')) return 'Butter';
        if (n.includes('cream') || n.includes('malai')) return 'Cream';
        if (n.includes('khoya') || n.includes('khoa') || n.includes('mawa')) return 'Khoya';
        if (n.includes('lassi') || n.includes('buttermilk') || n.includes('chaas') || n.includes('chhach')) return 'Beverage';
        if (n.includes('ice cream')) return 'Ice Cream';
        return 'Other';
    }

    let prodCount = 0;
    const productNameToId = {};

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[nameIdx]) continue;

            const name = toStr(row[nameIdx]);
            if (!name) continue;
            // Skip common header-like rows
            if (normalize(name) === 'product name') continue;

            const unit = toStr(row[unitIdx]);
            const opening = toNum(row[openingIdx]);
            const reorder = toNum(row[reorderIdx]);
            const rate = toNum(row[rateIdx]);
            const category = detectCategory(name);

            const result = insertProduct.run(name, unit || 'kg', category, opening, reorder, rate,
                'Imported from Excel', new Date().toISOString());
            const prodId = result.lastInsertRowid;
            productNameToId[normalize(name)] = prodId;

            // Create stock movement for opening stock (use today's date)
            if (opening > 0) {
                insertStock.run(prodId, new Date().toISOString().split('T')[0], opening, opening, rate,
                    new Date().toISOString());
            }

            prodCount++;
        }
    });

    trx();
    console.log(`  ✅ ${prodCount} products imported`);
    return productNameToId;
}

/**
 * Import Sales_Entry → sales + sales_items.
 * Groups rows by invoice_no if same invoice appears on same date for same party.
 */
function importSales(db, sheetData, partyNameToId, productNameToId) {
    console.log('\n  📋 Importing Sales...');

    const insertSale = db.prepare(`
        INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, discount_percent,
            tax, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertSaleItem = db.prepare(`
        INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'sale', ?, ?, ?, 0, ?, ?)
    `);

    const insertStock = db.prepare(`
        INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty,
            balance_after, rate, notes, reference_type, reference_id, created_at)
        VALUES (?, ?, 'sale', 0, ?, ?, ?, ?, 'sale', ?, ?)
    `);

    // Col: 0=Date, 1=InvoiceNo, 2=PartyName, 3=Product, 4=Qty, 5=Rate,
    // 6=Amount, 7=Disc%, 8=NetAmount, 9=PaymentMode, 10=Status, 11=Remarks
    const dateIdx = 0, invIdx = 1, partyIdx = 2, prodIdx = 3,
          qtyIdx = 4, rateIdx = 5, amtIdx = 6, discPctIdx = 7,
          netIdx = 8, modeIdx = 9, statusIdx = 10, remarkIdx = 11;

    let saleCount = 0;
    let itemCount = 0;
    let skippedNoParty = 0;
    let skippedNoProduct = 0;

    // Group by invoice_no: some invoices may have multiple products on multiple rows
    const invoiceGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || !row[invIdx]) continue;

        const invNo = toStr(row[invIdx]);
        if (!invNo) continue;

        if (!invoiceGroups[invNo]) {
            invoiceGroups[invNo] = [];
        }
        invoiceGroups[invNo].push(row);
    }

    console.log(`  → Found ${Object.keys(invoiceGroups).length} unique invoices`);

    const trx = db.transaction(() => {
        for (const [invNo, rows] of Object.entries(invoiceGroups)) {
            const firstRow = rows[0];
            const dateStr = toDateStr(firstRow[dateIdx]) || new Date().toISOString().split('T')[0];
            const partyName = toStr(firstRow[partyIdx]);
            const partyId = partyNameToId[normalize(partyName)];

            if (!partyId) {
                skippedNoParty++;
                continue;
            }

            let subtotal = 0;
            let totalDiscPct = 0;
            let grandTotal = 0;
            const paymentMode = mapPaymentMode(toStr(firstRow[modeIdx]));
            const status = mapStatus(toStr(firstRow[statusIdx]));
            const remarks = toStr(firstRow[remarkIdx]);

            // Calculate totals from the group (all rows should have same date/party)
            for (const row of rows) {
                subtotal += toNum(row[amtIdx]);
                totalDiscPct = Math.max(totalDiscPct, toNum(row[discPctIdx]));
            }

            // Net amount - use the first row's net if group has 1 row, otherwise sum
            if (rows.length === 1) {
                grandTotal = toNum(firstRow[netIdx]);
            } else {
                // Sum all net amounts
                grandTotal = rows.reduce((sum, r) => sum + toNum(r[netIdx]), 0);
            }

            // Paid amount: same as grand total for paid, 0 for unpaid, half for partial
            let paidAmount = 0;
            if (status === 'paid') paidAmount = grandTotal;
            else if (status === 'partial') paidAmount = grandTotal * 0.5;

            const saleResult = insertSale.run(
                invNo, dateStr, partyId, subtotal, 0, totalDiscPct,
                grandTotal, paidAmount, paymentMode, status, remarks,
                new Date().toISOString(), new Date().toISOString()
            );
            const saleId = saleResult.lastInsertRowid;

            // Create ledger entry for the sale (debit = customer owes this amount)
            const ledgerDesc = `Sale Invoice ${invNo}${remarks ? ' - ' + remarks : ''}`;
            const ledgerBal = grandTotal;
            insertLedger.run(partyId, dateStr, invNo, ledgerDesc.substring(0, 200), grandTotal, ledgerBal, new Date().toISOString());

            // If paid, also create a receipt ledger entry (credit = customer paid)
            if (paidAmount > 0) {
                insertLedger.run(partyId, dateStr, invNo, `Payment received for Invoice ${invNo}`, 0, paidAmount, ledgerBal - paidAmount, new Date().toISOString());
            }

            // Insert items
            for (const row of rows) {
                const prodName = toStr(row[prodIdx]);
                const prodId = productNameToId[normalize(prodName)];

                if (!prodId) {
                    skippedNoProduct++;
                    continue;
                }

                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateIdx]);
                const amt = toNum(row[amtIdx]);
                const unit = 'kg';

                insertSaleItem.run(saleId, prodId, prodName, qty, unit, rate, amt);

                // Stock movement (outward)
                insertStock.run(prodId, dateStr, qty, 0, rate, invNo, saleId, new Date().toISOString());

                itemCount++;
            }

            saleCount++;
        }
    });

    trx();
    console.log(`  ✅ ${saleCount} sales imported (${itemCount} items)`);
    if (skippedNoParty > 0) console.log(`  ⚠️  ${skippedNoParty} sales skipped (party not found)`);
    if (skippedNoProduct > 0) console.log(`  ⚠️  ${skippedNoProduct} items skipped (product not found)`);
}

/**
 * Import Purchase_Entry → purchases + purchase_items.
 */
function importPurchases(db, sheetData, partyNameToId, productNameToId) {
    console.log('\n  📋 Importing Purchases...');

    const insertPurchase = db.prepare(`
        INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax,
            transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertPurchaseItem = db.prepare(`
        INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'purchase', ?, ?, 0, ?, ?, ?)
    `);

    const insertStock = db.prepare(`
        INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty,
            balance_after, rate, notes, reference_type, reference_id, created_at)
        VALUES (?, ?, 'purchase', ?, 0, ?, ?, ?, 'purchase', ?, ?)
    `);

    // Col: 0=Date, 1=BillNo, 2=Supplier, 3=Product, 4=FAT%, 5=SNF%, 6=Extra/Unit,
    // 7=RateType, 8=FixedRate, 9=Rate/Unit, 10=Qty, 11=Amount, 12=Transport, 13=NetAmount,
    // 14=PaymentMode, 15=Status, 16=Remarks
    const dateIdx = 0, billIdx = 1, suppIdx = 2, prodIdx = 3,
          fatIdx = 4, snfIdx = 5, extraIdx = 6, rateTypeIdx = 7,
          fixedRateIdx = 8, rateUnitIdx = 9, qtyIdx = 10, amtIdx = 11,
          transportIdx = 12, netIdx = 13, modeIdx = 14, statusIdx = 15, remarkIdx = 16;

    let purchaseCount = 0;
    let itemCount = 0;
    let skippedNoParty = 0;
    let skippedNoProduct = 0;

    // Group by bill_no
    const billGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || !row[billIdx]) continue;

        const billNo = toStr(row[billIdx]);
        if (!billNo) continue;

        if (!billGroups[billNo]) {
            billGroups[billNo] = [];
        }
        billGroups[billNo].push(row);
    }

    console.log(`  → Found ${Object.keys(billGroups).length} unique bills`);

    const trx = db.transaction(() => {
        for (const [billNo, rows] of Object.entries(billGroups)) {
            const firstRow = rows[0];
            const dateStr = toDateStr(firstRow[dateIdx]) || new Date().toISOString().split('T')[0];
            const supplierName = toStr(firstRow[suppIdx]);
            const partyId = partyNameToId[normalize(supplierName)];

            if (!partyId) {
                skippedNoParty++;
                continue;
            }

            let subtotal = rows.reduce((sum, r) => sum + toNum(r[amtIdx]), 0);
            let totalTransport = toNum(firstRow[transportIdx]);
            // Sum transport across all rows (usually only first row has it)
            for (const row of rows) {
                const t = toNum(row[transportIdx]);
                if (t > totalTransport) totalTransport = t;
            }
            const grandTotal = rows.reduce((sum, r) => sum + toNum(r[netIdx]), 0);
            const paymentMode = mapPaymentMode(toStr(firstRow[modeIdx]));
            const status = mapStatus(toStr(firstRow[statusIdx]));
            const remarks = toStr(firstRow[remarkIdx]);

            let paidAmount = 0;
            if (status === 'paid') paidAmount = grandTotal;
            else if (status === 'partial') paidAmount = grandTotal * 0.5;

            const purchaseResult = insertPurchase.run(
                billNo, dateStr, partyId, subtotal, totalTransport,
                grandTotal, paidAmount, paymentMode, status, remarks,
                new Date().toISOString(), new Date().toISOString()
            );
            const purchaseId = purchaseResult.lastInsertRowid;

            // Create ledger entry for the purchase (credit = we owe the supplier)
            const ledgerDesc = `Purchase Bill ${billNo}${remarks ? ' - ' + remarks : ''}`;
            const ledgerBal = -grandTotal;
            insertLedger.run(partyId, dateStr, billNo, ledgerDesc.substring(0, 200), grandTotal, ledgerBal, new Date().toISOString());

            // If paid, also create a payment ledger entry (debit = we paid the supplier)
            if (paidAmount > 0) {
                insertLedger.run(partyId, dateStr, billNo + '-payment', `Payment made for Bill ${billNo}`, paidAmount, ledgerBal + paidAmount, new Date().toISOString());
            }

            // Insert items
            for (const row of rows) {
                const prodName = toStr(row[prodIdx]);
                const prodId = productNameToId[normalize(prodName)];

                if (!prodId) {
                    skippedNoProduct++;
                    continue;
                }

                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateUnitIdx]) || toNum(row[fixedRateIdx]); // Rate/Unit or Fixed Rate
                const amt = toNum(row[amtIdx]);
                const unit = 'liter';

                insertPurchaseItem.run(purchaseId, prodId, prodName, qty, unit, rate, amt);

                // Stock movement (inward)
                insertStock.run(prodId, dateStr, qty, qty, rate, billNo, purchaseId, new Date().toISOString());

                itemCount++;
            }

            purchaseCount++;
        }
    });

    trx();
    console.log(`  ✅ ${purchaseCount} purchases imported (${itemCount} items)`);
    if (skippedNoParty > 0) console.log(`  ⚠️  ${skippedNoParty} purchases skipped (party not found)`);
    if (skippedNoProduct > 0) console.log(`  ⚠️  ${skippedNoProduct} items skipped (product not found)`);
}

/**
 * Import Cash_Collection → payments (receipts).
 */
function importCashCollections(db, sheetData, partyNameToId) {
    console.log('\n  📋 Importing Cash Collections...');

    const insertPayment = db.prepare(`
        INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, 'receipt', ?, ?, 'cash_collection', ?, ?, ?)
    `);

    // Col: 0=Date, 1=ReceiptNo, 2=CustomerName, 3=AgainstBill, 4=OpeningDue,
    // 5=Collected, 6=PaymentMode, 7=ClosingDue, 8=Remarks
    const dateIdx = 0, recIdx = 1, custIdx = 2, billIdx = 3,
          collectedIdx = 5, modeIdx = 6, remarkIdx = 8;

    let count = 0;
    let skipped = 0;

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[custIdx]) continue;

            const customerName = toStr(row[custIdx]);
            const partyId = partyNameToId[normalize(customerName)];

            if (!partyId) {
                skipped++;
                continue;
            }

            const dateStr = toDateStr(row[dateIdx]) || new Date().toISOString().split('T')[0];
            const amount = toNum(row[collectedIdx]);
            if (amount <= 0) continue;

            const receiptNo = toNum(row[recIdx]) > 0 ? String(toNum(row[recIdx])) : '';
            const againstBill = toStr(row[billIdx]);
            const mode = mapPaymentMode(toStr(row[modeIdx]));
            const remarks = `${againstBill ? 'Against: ' + againstBill + ' | ' : ''}${toStr(row[remarkIdx])}`;

            insertPayment.run(partyId, dateStr, amount, mode,
                receiptNo || againstBill, receiptNo || againstBill, remarks,
                new Date().toISOString());
            count++;
        }
    });

    trx();
    console.log(`  ✅ ${count} cash collections imported (as payments/receipts)`);
    if (skipped > 0) console.log(`  ⚠️  ${skipped} collections skipped (party not found)`);
}

/**
 * Import Party_Ledger → ledger_entries.
 * Skips entries that were already auto-generated by importSales/importPurchases
 * (i.e. entries with matching party_id, date, and reference_id).
 */
function importPartyLedger(db, sheetData, partyNameToId) {
    console.log('\n  📋 Importing Party Ledger...');

    const checkExisting = db.prepare(`
        SELECT COUNT(*) as c FROM ledger_entries 
        WHERE party_id = ? AND date = ? AND reference_type = ? AND reference_id = ?
    `);

    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Col: 0=Date, 1=PartyName, 2=TxnType, 3=Reference, 4=Description,
    // 5=Debit, 6=Credit, 7=Balance, 8=Remarks, 9=MatchIdx
    const dateIdx = 0, partyIdx = 1, txnIdx = 2, refIdx = 3, descIdx = 4,
          debitIdx = 5, creditIdx = 6, balIdx = 7, remarkIdx = 8;

    let count = 0;
    let skipped = 0;
    let duplicateSkipped = 0;

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[partyIdx]) continue;

            const partyName = toStr(row[partyIdx]);
            const partyId = partyNameToId[normalize(partyName)];

            if (!partyId) {
                skipped++;
                continue;
            }

            const dateStr = toDateStr(row[dateIdx]) || new Date().toISOString().split('T')[0];
            const txnType = toStr(row[txnIdx]).toLowerCase();
            const ref = toStr(row[refIdx]);
            const desc = toStr(row[descIdx]);
            const debit = toNum(row[debitIdx]);
            const credit = toNum(row[creditIdx]);
            const balance = toNum(row[balIdx]);

            // Map txn type to reference_type
            let refType = 'adjustment';
            if (txnType.includes('sale')) refType = 'sale';
            else if (txnType.includes('purchase') || txnType.includes('purchase')) refType = 'purchase';
            else if (txnType.includes('receipt') || txnType.includes('payment')) refType = 'payment_received';
            else if (txnType.includes('opening')) refType = 'opening';

            // Skip if already exists (auto-generated by importSales/importPurchases)
            const existing = checkExisting.get(partyId, dateStr, refType, ref);
            if (existing.c > 0) {
                duplicateSkipped++;
                continue;
            }

            insertLedger.run(partyId, dateStr, refType, ref || null, desc || 'Ledger entry',
                debit, credit, balance, new Date().toISOString());
            count++;
        }
    });

    trx();
    console.log(`  ✅ ${count} ledger entries imported from Party_Ledger`);
    if (duplicateSkipped > 0) console.log(`  ℹ️  ${duplicateSkipped} duplicates skipped (already auto-generated)`);
    if (skipped > 0) console.log(`  ⚠️  ${skipped} entries skipped (party not found)`);
}

// ════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════

function main() {
    const args = process.argv.slice(2);
    const forceReimport = args.includes('--force') || args.includes('-f');

    console.log('');
    console.log('  🐄  Godhuli Dairy Plant — Excel Data Import');
    console.log('  ═══════════════════════════════════════════════');
    console.log('');

    // Check if database already has data (for idempotent mode)
    const rawDbExists = fs.existsSync(DB_PATH);
    if (rawDbExists && !forceReimport) {
        try {
            const checkDb = new Database(DB_PATH);
            checkDb.pragma('journal_mode = WAL');
            const partyCount = checkDb.prepare("SELECT COUNT(*) as c FROM parties").get().c;
            checkDb.close();
            if (partyCount > 0) {
                console.log(`  ℹ️  Database already has ${partyCount} parties. Skipping import.`);
                console.log('  ℹ️  Use --force or -f flag to re-import (will clear existing data).');
                console.log('');
                return;
            }
        } catch (e) {
            // DB might not have parties table yet, continue with import
            console.log('  ℹ️  Database exists but appears empty, proceeding with import.');
        }
    }

    // Check Excel file
    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`  ❌ Excel file not found: ${EXCEL_PATH}`);
        console.error(`     Expected at: ${EXCEL_PATH}`);
        process.exit(1);
    }

    // Check schema
    if (!fs.existsSync(SCHEMA_PATH)) {
        console.error(`  ❌ Schema file not found: ${SCHEMA_PATH}`);
        process.exit(1);
    }

    // Load workbook
    console.log('  📂 Loading workbook...');
    const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });

    // Verify required sheets exist
    const requiredSheets = ['Party_Master', 'Stock_Master', 'Sales_Entry', 'Purchase_Entry'];
    for (const s of requiredSheets) {
        if (!workbook.SheetNames.includes(s)) {
            console.error(`  ❌ Required sheet "${s}" not found in workbook`);
            process.exit(1);
        }
    }
    console.log(`  ✅ Found ${workbook.SheetNames.length} sheets in workbook`);

    // Initialize database
    console.log('\n  🗄️  Initializing database...');
    const db = initDb();

    // ═══════════════════════════════════════════════════════════
    // ALL STEPS wrapped in a single outer transaction for atomicity
    // INCLUDING clearBusinessData - so if import fails, old data is preserved
    // ═══════════════════════════════════════════════════════════
    const masterTrx = db.transaction(() => {

        // Clear existing business data (inside transaction = rollback on failure)
        clearBusinessData(db);

        // STEP 1: Import Parties
        const partySheet = XLSX.utils.sheet_to_json(workbook.Sheets['Party_Master'], { header: 1, defval: '' });
        console.log(`  → Party_Master: ${Math.max(0, partySheet.length - 2)} data rows (${partySheet.length} total rows)`);
        const partyNameToId = importParties(db, partySheet);

        // STEP 2: Import Products
        const stockSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Stock_Master'], { header: 1, defval: '' });
        console.log(`  → Stock_Master: ${Math.max(0, stockSheet.length - 2)} data rows (${stockSheet.length} total rows)`);
        const productNameToId = importProducts(db, stockSheet);

        // STEP 3: Import Sales
        if (workbook.SheetNames.includes('Sales_Entry')) {
            const saleSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Sales_Entry'], { header: 1, defval: '' });
            if (saleSheet.length > 2) {
                console.log(`  → Sales_Entry: ${Math.max(0, saleSheet.length - 2)} data rows (${saleSheet.length} total rows)`);
                importSales(db, saleSheet, partyNameToId, productNameToId);
            }
        }

        // STEP 4: Import Purchases
        if (workbook.SheetNames.includes('Purchase_Entry')) {
            const purchSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Purchase_Entry'], { header: 1, defval: '' });
            if (purchSheet.length > 2) {
                console.log(`  → Purchase_Entry: ${Math.max(0, purchSheet.length - 2)} data rows (${purchSheet.length} total rows)`);
                importPurchases(db, purchSheet, partyNameToId, productNameToId);
            }
        }

        // STEP 5: Import Cash Collections
        if (workbook.SheetNames.includes('Cash_Collection')) {
            const cashSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Cash_Collection'], { header: 1, defval: '' });
            if (cashSheet.length > 2) {
                console.log(`  → Cash_Collection: ${Math.max(0, cashSheet.length - 2)} data rows (${cashSheet.length} total rows)`);
                importCashCollections(db, cashSheet, partyNameToId);
            }
        }

        // STEP 6: Import Party Ledger
        if (workbook.SheetNames.includes('Party_Ledger')) {
            const ledgerSheet = XLSX.utils.sheet_to_json(workbook.Sheets['Party_Ledger'], { header: 1, defval: '' });
            if (ledgerSheet.length > 2) {
                console.log(`  → Party_Ledger: ${Math.max(0, ledgerSheet.length - 2)} data rows (${ledgerSheet.length} total rows)`);
                importPartyLedger(db, ledgerSheet, partyNameToId);
            }
        }

    });

    masterTrx();

    // ═══════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════
    console.log('\n  ═══════════════════════════════════════════════');
    console.log('  📊 IMPORT SUMMARY');
    console.log('');

    const tables = ['parties', 'products', 'sales', 'sales_items', 'purchases',
        'purchase_items', 'payments', 'ledger_entries', 'stock_movements'];

    for (const t of tables) {
        try {
            const count = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
            console.log(`  ${t.padEnd(20)}: ${count}`);
        } catch (e) {
            console.log(`  ${t.padEnd(20)}: error - ${e.message}`);
        }
    }

    db.close();
    console.log('\n  ✅ Import complete!');
    console.log('  🚀 Run "npm start" to launch the app with your data.');
    console.log('');
}

// Export main for use by server.js (auto-import on startup)
module.exports = { main };

// Only run main() when executed directly (node import-excel.js)
if (require.main === module) {
    main();
}
