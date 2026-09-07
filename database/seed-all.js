#!/usr/bin/env node
/**
 * Prarambha Account & Stock Management — Seed ALL Tables
 * ======================================================
 * Adds realistic sample data to EVERY table so every module shows content.
 *
 * Usage:
 *   DB_PATH=/path/to/data-dir node database/seed-all.js
 *   (defaults to ./data — the project-local database)
 *
 * Behavior:
 *   - Idempotent: only seeds a table if it is currently EMPTY.
 *   - Preserves existing data (e.g. Excel-imported parties/products/sales).
 *   - References existing parties & products where applicable.
 */

const path = require('path');
const fs = require('fs');

const dbDir = process.env.DB_PATH || path.join(__dirname, '..', 'data');
const dbPath = path.join(dbDir, 'dairy-plant.db');

if (!fs.existsSync(dbPath)) {
    console.error('❌ Database not found:', dbPath);
    console.error('   Run "node import-excel.js" first, or set DB_PATH.');
    process.exit(1);
}

const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function count(table) {
    try { return db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c; } catch (e) { return 0; }
}
function lastId(table) {
    const r = db.prepare(`SELECT MAX(id) m FROM "${table}"`).get();
    return (r && r.m) || 0;
}
function today(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
// BS-style month string from an AD date (YYYY-MM)
function bsMonth(offsetMonths = 0) {
    const d = new Date();
    d.setMonth(d.getMonth() - offsetMonths);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function round2(n) { return Math.round(n * 100) / 100; }

// Reference data
const partyRows = db.prepare("SELECT id, name, type FROM parties ORDER BY id").all();
const customerIds = partyRows.filter(p => p.type === 'customer' || p.type === 'both').map(p => p.id);
const supplierIds = partyRows.filter(p => p.type === 'supplier' || p.type === 'both').map(p => p.id);
const farmerIds = partyRows.filter(p => p.type === 'farmer').map(p => p.id);
const allPartyIds = partyRows.map(p => p.id);
const productRows = db.prepare("SELECT id, name, unit, rate FROM products ORDER BY id").all();
const userIds = (() => { try { return db.prepare("SELECT id FROM users ORDER BY id").all().map(r => r.id); } catch (e) { return []; } })();
const uid = () => (userIds.length ? pick(userIds) : null);

const seeded = [];

// ──────────────────────────────────────────────────────────────
// 1. ROUTES
// ──────────────────────────────────────────────────────────────
if (count('routes') === 0) {
    const ins = db.prepare(`INSERT INTO routes (name, area, assigned_vehicle, assigned_staff, notes) VALUES (?, ?, ?, ?, ?)`);
    [
        ['Route 1 - Kathmandu East', 'Gaushala, Baneshwor, Koteshwor', 'Ba 1 Kha 1234', 'Ramesh Thapa', 'Morning collection route'],
        ['Route 2 - Kathmandu West', 'Kalanki, Balkhu, Kirtipur', 'Ba 1 Kha 5678', 'Sita Gurung', 'Evening delivery route'],
        ['Route 3 - Lalitpur', 'Patan, Jawalakhel, Lagankhel', 'Ba 2 Kha 3456', 'Krishna Maharjan', 'Combined route']
    ].forEach(r => ins.run(...r));
    seeded.push(`routes (3)`);
}

// ──────────────────────────────────────────────────────────────
// 2. MILK RATE CHART
// ──────────────────────────────────────────────────────────────
if (count('milk_rate_chart') === 0) {
    const ins = db.prepare(`INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    [
        [today(90), 'formula', 7.15, 4.55, 0, 0, 'Standard formula rate'],
        [today(30), 'formula', 7.25, 4.60, 0.5, 0, 'Adjusted with extra per unit'],
        [today(0), 'fixed', 0, 0, 0, 68, 'Fixed winter rate']
    ].forEach(r => ins.run(...r));
    seeded.push(`milk_rate_chart (3)`);
}

// ──────────────────────────────────────────────────────────────
// 3. DENOMINATION COUNTS
// ──────────────────────────────────────────────────────────────
if (count('denomination_counts') === 0) {
    const ins = db.prepare(`INSERT INTO denomination_counts (date, note_1000, note_500, note_100, note_50, note_20, note_10, note_5, note_other, note_other_value, coin_5, coin_2, coin_1, total_cash, expected_cash, difference, remarks, counted_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [];
    for (let i = 0; i < 5; i++) {
        const n1000 = Math.floor(Math.random() * 8) + 2;
        const n500 = Math.floor(Math.random() * 6) + 2;
        const n100 = Math.floor(Math.random() * 15) + 5;
        const n50 = Math.floor(Math.random() * 20) + 5;
        const n20 = Math.floor(Math.random() * 25) + 5;
        const n10 = Math.floor(Math.random() * 30) + 5;
        const c5 = Math.floor(Math.random() * 20) + 3;
        const c2 = Math.floor(Math.random() * 25) + 5;
        const c1 = Math.floor(Math.random() * 30) + 5;
        const total = n1000 * 1000 + n500 * 500 + n100 * 100 + n50 * 50 + n20 * 20 + n10 * 10 + c5 * 5 + c2 * 2 + c1;
        const expected = Math.round(total * (0.95 + Math.random() * 0.1));
        rows.push([today(i), n1000, n500, n100, n50, n20, n10, 0, 0, 0, c5, c2, c1, total, expected, round2(total - expected), `Day ${i + 1} count`, 'Cashier']);
    }
    rows.forEach(r => ins.run(...r));
    seeded.push(`denomination_counts (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 4. PETTY CASH
// ──────────────────────────────────────────────────────────────
if (count('petty_cash') === 0) {
    const ins = db.prepare(`INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, approved_by, payment_mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const heads = [['Stationery', 'Purchased registers, pens and ink', 450], ['Tea & Snacks', 'Staff tea for the week', 700], ['Transport', 'Taxi to bank for deposit', 300], ['Repairs', 'Small office equipment repair', 1200]];
    const rows = heads.map((h, i) => [`PC-${String(1001 + i)}`, today(i), h[0], h[1], h[2], 'Office', 'Manager', 'cash', 'Seeded sample']);
    rows.forEach(r => ins.run(...r));
    seeded.push(`petty_cash (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 5. CASH DEPOSITS
// ──────────────────────────────────────────────────────────────
if (count('cash_deposits') === 0) {
    const ins = db.prepare(`INSERT INTO cash_deposits (date, deposit_no, bank_name, branch, account_no, amount, cash_source, deposit_mode, reference_no, remarks, deposited_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [
        [today(1), 'CD-2026-0001', 'Nepal Bank Ltd', 'Baneshwor', '0101234567890', 125000, 'mixed', 'cash', 'DEP-001', 'Weekly cash deposit', 'Ramesh'],
        [today(2), 'CD-2026-0002', 'Global IME Bank', 'New Road', '2345678901', 98000, 'sales', 'transfer', 'DEP-002', 'Daily sales deposit', 'Sita'],
        [today(4), 'CD-2026-0003', 'Nepal Bank Ltd', 'Baneshwor', '0101234567890', 75000, 'receipts', 'cash', 'DEP-003', 'Customer receipts', 'Krishna']
    ];
    rows.forEach(r => ins.run(...r));
    seeded.push(`cash_deposits (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 6. SALARY RECORDS
// ──────────────────────────────────────────────────────────────
if (count('salary_records') === 0) {
    const ins = db.prepare(`INSERT INTO salary_records (employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const staff = [
        ['Ram Sharma', 'Plant Operator', 18000, 2000, 0, 500],
        ['Sita Gurung', 'Accountant', 25000, 3000, 5000, 1000],
        ['Hari Tamang', 'Delivery Driver', 15000, 1500, 0, 300],
        ['Gita Rai', 'Sales Executive', 17000, 2000, 2000, 400],
        ['Krishna Maharjan', 'Supervisor', 30000, 4000, 0, 1500]
    ];
    const rows = [];
    for (const m of [bsMonth(0), bsMonth(1)]) {
        staff.forEach((s, i) => {
            const basic = s[2], allowance = s[3], advance = s[4], deduction = s[5];
            const net = basic + allowance - advance - deduction;
            rows.push([s[0], s[1], m, basic, allowance, advance, deduction, net, today(i % 3), pick(['cash', 'bank', 'upi']), 'Monthly salary']);
        });
    }
    rows.forEach(r => ins.run(...r));
    seeded.push(`salary_records (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 7. VEHICLE EXPENSES
// ──────────────────────────────────────────────────────────────
if (count('vehicle_expenses') === 0) {
    const ins = db.prepare(`INSERT INTO vehicle_expenses (date, vehicle_name, driver_name, expense_type, fuel_amount, repair_amount, maintenance_amount, toll_parking_amount, other_amount, total_amount, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [
        [today(1), 'Ba 1 Kha 1234', 'Hari Tamang', 'fuel', 4500, 0, 0, 0, 0, 4500, 'Diesel fill'],
        [today(2), 'Ba 1 Kha 1234', 'Hari Tamang', 'maintenance', 0, 0, 3500, 0, 0, 3500, 'Oil change'],
        [today(4), 'Ba 2 Kha 3456', 'Krishna Maharjan', 'toll_parking', 0, 0, 0, 400, 0, 400, 'Toll fees'],
        [today(6), 'Ba 1 Kha 5678', 'Sita Gurung', 'repair', 0, 2800, 0, 0, 0, 2800, 'Tyre repair']
    ];
    rows.forEach(r => ins.run(...r));
    seeded.push(`vehicle_expenses (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 8. OTHER EXPENSES
// ──────────────────────────────────────────────────────────────
if (count('other_expenses') === 0) {
    const ins = db.prepare(`INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const rows = [
        [today(1), 'Electricity', 'NEA Bill', 'Plant electricity bill', 8500, 'NEA', 'bank', 'NEA-2026-001', 'Monthly bill'],
        [today(2), 'Office', 'Rent', 'Monthly office rent', 15000, 'Landlord', 'bank', 'RENT-03', 'Office rent'],
        [today(3), 'Marketing', 'Promotion', 'Flyer printing and distribution', 3000, 'Print Shop', 'cash', '', 'New campaign'],
        [today(5), 'Miscellaneous', 'Cleaning', 'Cleaning supplies', 950, 'Store', 'cash', '', 'Monthly supplies'],
        [today(7), 'Telephone', 'Internet', 'Internet and phone bill', 2200, 'NTC', 'upi', 'NTC-2026-01', 'Office connection']
    ];
    rows.forEach(r => ins.run(...r));
    seeded.push(`other_expenses (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 9. PARTNER CAPITAL
// ──────────────────────────────────────────────────────────────
if (count('partner_capital') === 0) {
    const partnerIds = partyRows.filter(p => p.type === 'partner').map(p => p.id);
    const useIds = partnerIds.length ? partnerIds : allPartyIds.slice(0, Math.min(2, allPartyIds.length));
    if (useIds.length) {
        const ins = db.prepare(`INSERT INTO partner_capital (party_id, date, type, amount, mode, reference_no, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const rows = [];
        useIds.forEach((pid, i) => {
            rows.push([pid, today(30 + i), 'contribution', 500000 + i * 100000, 'bank', `CONTRIB-${i + 1}`, 'Initial capital contribution']);
            rows.push([pid, today(10 + i), 'withdrawal', 50000 + i * 25000, 'bank', `WDL-${i + 1}`, 'Partial withdrawal']);
        });
        rows.forEach(r => ins.run(...r));
        seeded.push(`partner_capital (${rows.length})`);
    } else {
        console.log('  ℹ️  No partner parties — skipping partner_capital (create a partner party to seed this table)');
    }
}

// ──────────────────────────────────────────────────────────────
// 10. PRODUCTION BATCHES (inputs + outputs)
// ──────────────────────────────────────────────────────────────
if (count('production_batches') === 0) {
    const milkProduct = productRows.find(p => /milk/i.test(p.name)) || productRows[0];
    const paneerProduct = productRows.find(p => /paneer|chena|chhena/i.test(p.name));
    const gheeProduct = productRows.find(p => /ghee/i.test(p.name));
    const curdProduct = productRows.find(p => /curd|dahi/i.test(p.name));
    const outputProducts = [paneerProduct, gheeProduct, curdProduct].filter(Boolean);

    if (milkProduct && outputProducts.length) {
        const insBatch = db.prepare(`INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity, input_unit, output_quantity, output_unit, standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const insInput = db.prepare(`INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const insOutput = db.prepare(`INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);

        const processTypes = ['Pasteurization', 'Paneer Making', 'Ghee Making', 'Curd Setting'];
        for (let i = 0; i < 4; i++) {
            const inputQty = round2(80 + Math.random() * 120);
            const outputProd = outputProducts[i % outputProducts.length];
            const outputQty = round2(inputQty * 0.45);
            const batchId = lastId('production_batches') + 1;
            const batchNo = `PB-${String(202600 + batchId)}`;
            insBatch.run(batchNo, today(i), pick(['morning', 'evening']), processTypes[i % processTypes.length], inputQty, 'liter', outputQty, 'kg', 50, round2((outputQty / inputQty) * 100), round2(inputQty * 0.02), '', pick(['Ramesh', 'Hari', 'Gita']), 'Seeded sample batch');

            insInput.run(batchId, milkProduct.id, milkProduct.name, inputQty, 'liter', milkProduct.rate || 60, round2(inputQty * (milkProduct.rate || 60)));
            insOutput.run(batchId, outputProd.id, outputProd.name, outputQty, 'kg', outputProd.rate || 300, round2(outputQty * (outputProd.rate || 300)));
        }
        seeded.push(`production_batches (4) + inputs/outputs`);
    } else {
        console.log('  ℹ️  No suitable milk product/output products — skipping production seed');
    }
}

// ──────────────────────────────────────────────────────────────
// 11. FARMER PARTIES (if none) — needed by Milk Collection & Farmer Payment
// ──────────────────────────────────────────────────────────────
if (farmerIds.length === 0) {
    const insFarmer = db.prepare(`INSERT INTO parties (name, phone, address, type, opening_balance, notes, created_at) VALUES (?, ?, ?, 'farmer', 0, 'Seeded sample farmer', datetime('now', 'localtime'))`);
    const sampleFarmers = [
        ['Bishnu B.K.', '9841000001', 'Kotdanda, Lalitpur'],
        ['Devendra Shahi', '9841000002', 'Kirtipur, Kathmandu'],
        ['Maya Tamang', '9841000003', 'Thankot, Kathmandu'],
        ['Prakash Adhikari', '9841000004', 'Godawari, Lalitpur'],
        ['Sunita Gurung', '9841000005', 'Sundarijal, Kathmandu']
    ];
    for (const f of sampleFarmers) {
        insFarmer.run(...f);
    }
    console.log(`  ✅ farmers (${sampleFarmers.length} new farmer parties)`);
    farmerIds.push(...db.prepare("SELECT id FROM parties WHERE type = 'farmer' ORDER BY id").all().map(r => r.id));
    seeded.push(`farmers (${sampleFarmers.length})`);
}

// ──────────────────────────────────────────────────────────────
// 12. MILK COLLECTIONS (if none)
// ──────────────────────────────────────────────────────────────
if (count('milk_collections') === 0 && farmerIds.length) {
    const ins = db.prepare(`INSERT INTO milk_collections (collection_no, date, party_id, route_id, milk_type, quantity_liters, fat_percent, snf_percent, rate, amount, shift, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const routeIds = (() => { try { return db.prepare("SELECT id FROM routes ORDER BY id").all().map(r => r.id); } catch (e) { return []; } })();
    const milkTypes = ['cow', 'buffalo', 'mixed'];
    const shifts = ['morning', 'evening'];
    let cno = 3001;
    const rows = [];
    for (let d = 0; d < 7; d++) {
        farmerIds.slice(0, 4).forEach(fid => {
            const qty = round2(8 + Math.random() * 30);
            const fat = round2(3 + Math.random() * 3.5);
            const baseRate = 60 + Math.random() * 20;
            const amount = round2(qty * baseRate * (fat / 3.5));
            rows.push([`MC-${cno++}`, today(d), fid, routeIds.length ? pick(routeIds) : null, pick(milkTypes), qty, fat, round2(8 + Math.random() * 1.5), round2(baseRate), amount, pick(shifts), pick(['pending', 'processed', 'paid']), 'Seeded sample']);
        });
    }
    rows.forEach(r => ins.run(...r));
    seeded.push(`milk_collections (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 13. PAYMENTS (if none)
// ──────────────────────────────────────────────────────────────
if (count('payments') === 0 && allPartyIds.length) {
    const ins = db.prepare(`INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const modes = ['cash', 'bank', 'upi', 'cheque'];
    const rows = [];
    for (let i = 0; i < 8; i++) {
        const isReceipt = i % 2 === 0;
        const pid = isReceipt ? (customerIds.length ? pick(customerIds) : pick(allPartyIds)) : (supplierIds.length ? pick(supplierIds) : pick(allPartyIds));
        rows.push([pid, today(i), isReceipt ? 'receipt' : 'payment', round2(1000 + Math.random() * 20000), pick(modes), 'manual', null, 'Seeded sample']);
    }
    rows.forEach(r => ins.run(...r));
    seeded.push(`payments (${rows.length})`);
}

// ──────────────────────────────────────────────────────────────
// 14. AUDIT LOG
// ──────────────────────────────────────────────────────────────
if (count('audit_log') === 0) {
    const ins = db.prepare(`INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by) VALUES (?, ?, ?, ?, ?, ?)`);
    const entries = [
        ['parties', 1, 'create', '', '{"name":"Sample Party"}', uid()],
        ['sales', 1, 'create', '', '{"invoice_no":"INV-SEED"}', uid()],
        ['salary_records', 1, 'create', '', '{"employee_name":"Ram Sharma"}', uid()],
        ['settings', 1, 'update', '', '{"business_name":"Prarambha"}', uid()]
    ];
    entries.forEach(r => ins.run(...r));
    seeded.push(`audit_log (${entries.length})`);
}

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────
console.log('');
console.log('  🐄  Seed-All complete');
console.log('  ═══════════════════════════════════');
if (seeded.length) {
    seeded.forEach(s => console.log('  ✅', s));
} else {
    console.log('  ℹ️  All tables already contain data — nothing to seed.');
}
console.log('');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log('  📊 Final row counts:');
for (const t of tables) {
    try {
        const c = db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c;
        console.log(`  ${t.name.padEnd(24)} ${c}`);
    } catch (e) { /* skip */ }
}
db.close();
console.log('\n  ✅ Done!');
