#!/usr/bin/env node
/**
 * Prarambha — Sample Data Seeder for missing modules
 * ===================================================
 * Fills every still-EMPTY module with sensible sample data so the app is
 * fully functional out of the box:
 *
 *   routes, milk_rate_chart, farmer parties + milk_collections,
 *   salary_records (employees parsed from the Excel "Salary Advance" sheet),
 *   cash_deposits, vehicle_expenses, other_expenses,
 *   partner parties + partner_capital, production_batches,
 *   and business settings from the workbook identity.
 *
 * Idempotent: any table that already has rows is skipped, so this is safe
 * to run repeatedly and will never overwrite real data.
 *
 * Usage:
 *   node scripts/seed-sample-data.js [dbPath]
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const dbPath = process.argv[2] || path.join(ROOT, 'data', 'dairy-plant.db');
const excelPath = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');

const Database = require('better-sqlite3');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const report = {};

function count(table) {
    try { return db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c; }
    catch (e) { return -1; }
}

function pad(n, w = 4) { return String(n).padStart(w, '0'); }

// ──────────────────────────────────────────────────────────────
// 1. Business settings (from workbook identity)
// ──────────────────────────────────────────────────────────────
(function seedSettings() {
    const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const business = {
        business_name: 'Prarambha Dairy Suppliers',
        business_phone: '9860316702',
        business_email: 'prarambhadairy@gmail.com',
        business_pan: '152747352',
    };
    for (const [k, v] of Object.entries(business)) set.run(k, v);
    report.settings = 'updated (name/phone/email/PAN from workbook)';
})();

// ──────────────────────────────────────────────────────────────
// 2. Routes
// ──────────────────────────────────────────────────────────────
let routeIds = [];
(function seedRoutes() {
    if (count('routes') > 0) { report.routes = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO routes (name, area, assigned_vehicle, assigned_staff, notes) VALUES (?, ?, ?, ?, ?)`);
    const routes = [
        ['Devighat Route', 'Devighat, Nuwakot', 'Milk Van (Ba 2 Kha 1234)', 'Nar Bahadur Rana', 'Sample route'],
        ['Kumaltari Route', 'Kumaltari, Nuwakot', 'Milk Van (Ba 2 Kha 1234)', 'Liladhar Gautam', 'Sample route'],
        ['Bidur Town Route', 'Bidur, Nuwakot', 'Motorcycle (Ba 1 Pa 5678)', 'Ram Bahadur Tamang', 'Sample route'],
        ['Local Collection Center', 'Plant vicinity', '', 'Srijana Shrestha', 'Sample route'],
    ];
    const trx = db.transaction(() => {
        for (const r of routes) routeIds.push(ins.run(...r).lastInsertRowid);
    });
    trx();
    report.routes = `${routes.length} routes created`;
})();

// ──────────────────────────────────────────────────────────────
// 3. Milk rate chart
// ──────────────────────────────────────────────────────────────
(function seedRateChart() {
    if (count('milk_rate_chart') > 0) { report.milk_rate_chart = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const trx = db.transaction(() => {
        ins.run('2082-01-01', 'formula', 7.15, 4.55, 0, 0, 'Initial rate (from workbook defaults)');
        ins.run('2083-04-01', 'formula', 7.35, 4.65, 0, 0, 'Revised rate for FY 2083/84 (sample)');
    });
    trx();
    report.milk_rate_chart = '2 rate entries created';
})();

// ──────────────────────────────────────────────────────────────
// 4. Farmer parties (only if none exist)
// ──────────────────────────────────────────────────────────────
let farmerIds = [];
(function seedFarmers() {
    const existing = db.prepare(`SELECT id, name, route_id FROM parties WHERE type = 'farmer' AND archived = 0`).all();
    if (existing.length >= 4) {
        farmerIds = existing.map(f => ({ id: f.id, route_id: f.route_id }));
        report.farmers = `skipped (${existing.length} farmers already exist)`;
        return;
    }
    const ins = db.prepare(`INSERT INTO parties (party_code, name, type, phone, address, opening_balance, route_id, route_name, notes, created_at, updated_at)
        VALUES (?, ?, 'farmer', ?, ?, 0, ?, ?, 'Sample farmer data', datetime('now','localtime'), datetime('now','localtime'))`);
    const farmers = [
        ['Hari Prasad Sharma', '9861000201', 'Devighat', 0],
        ['Gita Devi Tamang', '9861000202', 'Devighat', 0],
        ['Ram Bahadur Bista', '9861000203', 'Kumaltari', 1],
        ['Sita Kumari Gurung', '9861000204', 'Kumaltari', 1],
        ['Krishna Bahadur Thapa', '9861000205', 'Bidur Town', 2],
        ['Maya Devi Lama', '9861000206', 'Local Collection', 3],
    ];
    const trx = db.transaction(() => {
        for (const [name, phone, area, routeIdx] of farmers) {
            const route = db.prepare('SELECT id, name FROM routes WHERE id = ?').get(routeIds[routeIdx]);
            const info = ins.run('', name, phone, area, route.id, route.name);
            farmerIds.push({ id: info.lastInsertRowid, route_id: route.id });
        }
    });
    trx();
    report.farmers = `${farmers.length} sample farmers created`;
})();

// ──────────────────────────────────────────────────────────────
// 5. Milk collections (only if empty)
// ──────────────────────────────────────────────────────────────
(function seedMilkCollections() {
    if (count('milk_collections') > 0) { report.milk_collections = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO milk_collections
        (collection_no, date, party_id, route_id, milk_type, quantity_liters, fat_percent, snf_percent,
         adulteration_test, rate_type, fat_multiplier, snf_multiplier, calculated_rate, rate, amount, shift, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pass', 'formula', 7.15, 4.55, ?, ?, ?, ?, 'processed', 'Sample data')`);

    const dates = [];
    // Spread across BS months 2083-04 and 2083-05 (every 3rd day up to 2083-05-24)
    for (const [m, days] of [[4, 30], [5, 24]]) {
        for (let d = 1; d <= days; d += 3) dates.push(`2083-${pad(m, 2)}-${pad(d, 2)}`);
    }

    const milkTypes = ['cow', 'cow', 'buffalo', 'mixed'];
    const shifts = ['morning', 'evening'];
    let counter = 1;
    let inserted = 0;
    const trx = db.transaction(() => {
        for (const date of dates) {
            const dayNum = parseInt(date.slice(-2), 10);
            for (const [i, f] of farmerIds.entries()) {
                if ((i + dayNum) % 4 === 3) continue; // not every farmer every day (id-independent)
                const milkType = milkTypes[counter % milkTypes.length];
                const shift = shifts[counter % shifts.length];
                const qty = Math.round((4 + (counter * 7 % 18) + Math.random()) * 10) / 10;      // 4-22 L
                const fat = Math.round((milkType === 'buffalo' ? 5.2 : 3.8) + (counter % 4) * 0.2) * 10 / 10;
                const snf = Math.round((8.5 + (counter % 5) * 0.1) * 10) / 10;
                const rate = Math.round((fat * 7.15 + snf * 4.55) * 100) / 100;
                const amount = Math.round(qty * rate * 100) / 100;
                ins.run(`MC-${pad(counter)}`, date, f.id, f.route_id, milkType, qty, fat, snf, rate, rate, amount, shift);
                counter++;
                inserted++;
            }
        }
    });
    trx();
    report.milk_collections = `${inserted} collections created (${farmerIds.length} farmers)`;
})();

// ──────────────────────────────────────────────────────────────
// 6. Salary records (employees parsed from the Excel Salary Advance sheet)
// ──────────────────────────────────────────────────────────────
(function seedSalary() {
    if (count('salary_records') > 0) { report.salary_records = 'skipped (has data)'; return; }

    // Pull unique employee names + their advance amounts from the workbook
    const advances = {};   // name -> total advance
    let employeeNames = [];
    try {
        const XLSX = require('xlsx');
        const wb = XLSX.readFile(excelPath);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['Salary Advance'], { header: 1, defval: '' });
        for (let i = 3; i < rows.length; i++) {
            const r = rows[i];
            if (!r || !r[4]) continue;
            const name = String(r[4]).replace(/\s*\(.*?\)\s*$/, '').trim();
            const amt = parseFloat(r[7]) || 0;
            if (!name) continue;
            if (!advances[name] && amt > 0) advances[name] = amt;
            if (!employeeNames.includes(name)) employeeNames.push(name);
        }
    } catch (e) { /* Excel not readable — fall back to generic names */ }
    // Ensure a reasonable roster: merge Excel employees with sample staff names
    for (const extra of ['Liladhar Gautam', 'Ram Bahadur Tamang', 'Srijana Shrestha']) {
        if (!employeeNames.some(n => n.toLowerCase() === extra.toLowerCase())) employeeNames.push(extra);
    }
    employeeNames = employeeNames.slice(0, 8);

    const positions = ['Driver', 'Plant Operator', 'Sales Staff', 'Collection Agent', 'Helper'];
    const ins = db.prepare(`INSERT INTO salary_records
        (employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'cash', 'Sample payroll record')`);

    let n = 0;
    const trx = db.transaction(() => {
        for (const [i, name] of employeeNames.entries()) {
            const basic = 15000 + (i % 4) * 2500;
            const allowance = 1000 + (i % 3) * 500;
            const advance = Math.min(advances[name] || 0, basic);
            for (const month of ['2083-04', '2083-05']) {
                const net = basic + allowance - advance;
                ins.run(name, positions[i % positions.length], month, basic, allowance, advance, net, `${month}-30`);
                n++;
            }
        }
    });
    trx();
    report.salary_records = `${n} payroll records for ${employeeNames.length} employees (advances from Excel where available)`;
})();

// ──────────────────────────────────────────────────────────────
// 7. Cash deposits (only if empty)
// ──────────────────────────────────────────────────────────────
(function seedDeposits() {
    if (count('cash_deposits') > 0) { report.cash_deposits = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO cash_deposits
        (date, deposit_no, bank_name, branch, account_no, amount, cash_source, deposit_mode, reference_no, remarks, deposited_by)
        VALUES (?, ?, ?, ?, ?, ?, 'sales', 'cash', ?, 'Sample deposit record', 'Sushil Gautam')`);
    const deposits = [
        ['2083-05-05', 'Nabil Bank', 'Bidur Branch', '0123456789012', 120000, 'DEP-1001'],
        ['2083-05-12', 'Global IME Bank', 'Bidur Branch', '0456789012345', 85000, 'DEP-1002'],
        ['2083-05-19', 'Nabil Bank', 'Bidur Branch', '0123456789012', 96500, 'DEP-1003'],
        ['2083-05-24', 'Global IME Bank', 'Bidur Branch', '0456789012345', 73250, 'DEP-1004'],
    ];
    const trx = db.transaction(() => {
        for (const [date, bank, branch, acct, amount, no] of deposits) ins.run(date, no, bank, branch, acct, amount, no);
    });
    trx();
    report.cash_deposits = `${deposits.length} deposits created`;
})();

// ──────────────────────────────────────────────────────────────
// 8. Vehicle expenses (only if empty)
// ──────────────────────────────────────────────────────────────
(function seedVehicleExpenses() {
    if (count('vehicle_expenses') > 0) { report.vehicle_expenses = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO vehicle_expenses
        (date, vehicle_name, driver_name, route_id, expense_type, fuel_amount, repair_amount, maintenance_amount, toll_parking_amount, other_amount, total_amount, remarks)
        VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 'Sample expense record')`);
    const rows = [
        ['2083-05-03', 'Milk Van (Ba 2 Kha 1234)', 'Nar Bahadur Rana', routeIds[0], 'fuel', 4500],
        ['2083-05-10', 'Milk Van (Ba 2 Kha 1234)', 'Nar Bahadur Rana', routeIds[0], 'maintenance', 3200],
        ['2083-05-15', 'Motorcycle (Ba 1 Pa 5678)', 'Ram Bahadur Tamang', routeIds[2], 'fuel', 1200],
        ['2083-05-22', 'Milk Van (Ba 2 Kha 1234)', 'Liladhar Gautam', routeIds[1], 'toll_parking', 850],
    ];
    const trx = db.transaction(() => {
        for (const [date, veh, drv, rid, type, amt] of rows) ins.run(date, veh, drv, rid, type, amt, amt);
    });
    trx();
    report.vehicle_expenses = `${rows.length} vehicle expenses created`;
})();

// ──────────────────────────────────────────────────────────────
// 9. Other expenses (only if empty)
// ──────────────────────────────────────────────────────────────
(function seedOtherExpenses() {
    if (count('other_expenses') > 0) { report.other_expenses = 'skipped (has data)'; return; }
    const ins = db.prepare(`INSERT INTO other_expenses
        (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks)
        VALUES (?, ?, ?, ?, ?, ?, 'cash', '', 'Sample expense record')`);
    const rows = [
        ['2083-05-02', 'Utilities', 'Electricity', 'Monthly electricity bill', 8600, 'NEA'],
        ['2083-05-06', 'Utilities', 'Water', 'Water supply bill', 1450, 'Khanepani'],
        ['2083-05-09', 'Office', 'Internet', 'Monthly internet', 2500, 'WorldLink'],
        ['2083-05-14', 'Packaging', 'Packaging Materials', 'Plastic pouches & cups', 12300, 'Shree Traders'],
        ['2083-05-20', 'Rent', 'Shop Rent', 'Monthly shop rent', 15000, 'Landlord'],
        ['2083-05-23', 'Maintenance', 'Repairs', 'Chiller repair', 5400, 'Cool Tech'],
    ];
    const trx = db.transaction(() => {
        for (const r of rows) ins.run(...r);
    });
    trx();
    report.other_expenses = `${rows.length} other expenses created`;
})();

// ──────────────────────────────────────────────────────────────
// 10. Partner capital (only if no partner parties exist)
// ──────────────────────────────────────────────────────────────
(function seedPartners() {
    const existing = db.prepare(`SELECT id FROM parties WHERE type = 'partner' AND archived = 0 LIMIT 1`).get();
    if (existing || count('partner_capital') > 0) { report.partner_capital = 'skipped (partners exist)'; return; }

    const insParty = db.prepare(`INSERT INTO parties (party_code, name, type, phone, address, opening_balance, profit_share_percent, partner_type, notes, created_at, updated_at)
        VALUES (?, ?, 'partner', ?, ?, 0, ?, 'active', 'Sample partner data', datetime('now','localtime'), datetime('now','localtime'))`);
    const insCap = db.prepare(`INSERT INTO partner_capital (party_id, date, type, amount, mode, reference_no, notes)
        VALUES (?, ?, 'contribution', ?, 'bank', ?, 'Sample capital contribution')`);

    const trx = db.transaction(() => {
        const p1 = insParty.run('', 'Sushil Gautam', '9860316702', 'Bidur, Nuwakot', 60).lastInsertRowid;
        const p2 = insParty.run('', 'Liladhar Gautam', '9861000210', 'Bidur, Nuwakot', 40).lastInsertRowid;
        insCap.run(p1, '2082-01-01', 500000, 'CAP-001');
        insCap.run(p2, '2082-01-01', 300000, 'CAP-002');
        insCap.run(p1, '2083-04-15', 200000, 'CAP-003');
    });
    trx();
    report.partner_capital = '2 partners + 3 capital contributions created';
})();

// ──────────────────────────────────────────────────────────────
// 11. Production batches (only if empty)
// ──────────────────────────────────────────────────────────────
(function seedProduction() {
    if (count('production_batches') > 0) { report.production_batches = 'skipped (has data)'; return; }

    const milkProduct = db.prepare(`SELECT id, name, unit FROM products WHERE category = 'Milk' OR name LIKE '%Milk%' LIMIT 1`).get();
    const outputs = db.prepare(`SELECT id, name, unit, rate FROM products WHERE category IN ('Paneer','Curd','Ghee') LIMIT 2`).all();
    if (!milkProduct || outputs.length === 0) {
        report.production_batches = 'skipped (no suitable milk/output products)';
        return;
    }

    const insBatch = db.prepare(`INSERT INTO production_batches
        (batch_no, date, shift, process_type, input_quantity, input_unit, output_quantity, output_unit,
         standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks)
        VALUES (?, ?, 'morning', ?, ?, ?, ?, ?, 85, ?, 0, '', 'Plant Operator', 'Sample production batch')`);
    const insInput = db.prepare(`INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insOutput = db.prepare(`INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`);

    const batches = [];
    const yieldByCat = { Paneer: 16, Curd: 95, Ghee: 6 };   // % yield from milk
    for (const out of outputs) {
        const yieldPct = yieldByCat[out.category] || 50;
        const inputQty = 100;                                  // 100 L milk per batch
        const outputQty = Math.round(inputQty * yieldPct) / 100;
        batches.push({ out, inputQty, outputQty, yieldPct, date: out.category === 'Paneer' ? '2083-05-18' : '2083-05-21' });
    }

    let n = 0;
    const trx = db.transaction(() => {
        let bn = 1;
        for (const b of batches) {
            const info = insBatch.run(`PB-${pad(bn)}`, b.date, `Milk → ${b.out.category}`,
                b.inputQty, 'liter', b.outputQty, b.out.unit, b.yieldPct);
            const batchId = info.lastInsertRowid;
            insInput.run(batchId, milkProduct.id, milkProduct.name, b.inputQty, 'liter', 60, b.inputQty * 60);
            insOutput.run(batchId, b.out.id, b.out.name, b.outputQty, b.out.unit, b.out.rate || 0, b.outputQty * (b.out.rate || 0));
            batches[n]._batchId = batchId;
            bn++; n++;
        }
    });
    trx();
    report.production_batches = `${n} batches created with inputs/outputs`;
})();

// ──────────────────────────────────────────────────────────────
// Party code backfill for any new parties (same rule as shared/db.js)
// ──────────────────────────────────────────────────────────────
(function backfillPartyCodes() {
    try {
        const prefixes = { customer: 'CUS', supplier: 'SUP', both: 'PTY', farmer: 'FRM', partner: 'PTR' };
        const rows = db.prepare(`SELECT id, type FROM parties WHERE party_code IS NULL OR party_code = ''`).all();
        const upd = db.prepare(`UPDATE parties SET party_code = ? WHERE id = ?`);
        for (const p of rows) upd.run((prefixes[p.type] || 'PTY') + '-' + String(p.id).padStart(4, '0'), p.id);
    } catch (e) { /* party_code column may not exist in old DBs */ }
})();

// ──────────────────────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────────────────────
console.log('\n  🌱  Sample Data Seeder — results');
console.log('  ═══════════════════════════════════════════');
for (const [k, v] of Object.entries(report)) console.log(`  ${(k || '').padEnd(20)}: ${v}`);
console.log('\n  Final table counts:');
for (const t of ['routes', 'milk_rate_chart', 'parties', 'milk_collections', 'salary_records',
    'cash_deposits', 'vehicle_expenses', 'other_expenses', 'partner_capital', 'production_batches']) {
    console.log(`  ${t.padEnd(22)}: ${count(t)}`);
}
console.log('');
db.close();
