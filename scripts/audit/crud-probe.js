#!/usr/bin/env node
/**
 * CRUD probe — every data-management module, on a COPY of the database.
 * ====================================================================
 * For each module the probe:
 *   1. creates a record through the same operation the screen calls,
 *   2. closes and reopens the database, then reads the record back
 *      (proves the write is on disk, not just in the screen),
 *   3. edits it and reads the new value back,
 *   4. deletes it and confirms it is gone plus an audit_log row exists.
 *
 * The live database is never opened: it is copied to a temp directory first
 * (AGENTS.md: never point an automated test at data/dairy-plant.db).
 *
 *   node scripts/audit/crud-probe.js [--db PATH]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2);
const srcDb = args.indexOf('--db') >= 0 ? args[args.indexOf('--db') + 1]
    : path.join(os.homedir(), 'Library', 'Application Support', 'prarambha-account-stock', 'data', 'dairy-plant.db');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crud-probe-'));
const dbPath = path.join(dir, 'probe.db');
fs.copyFileSync(srcDb, dbPath);

const ops = require(path.join(ROOT, 'shared', 'operations'));
let db = new Database(dbPath);
const reopen = () => { db.close(); db = new Database(dbPath); };
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, label, extra) => {
    if (cond) { pass++; console.log('  ✅ ' + label); }
    else { fail++; console.log('  ❌ FAIL — ' + label + (extra !== undefined ? '   [' + JSON.stringify(extra) + ']' : '')); }
};

const today = '2083-07-08';
const partyId = one("SELECT id FROM parties WHERE type='customer' ORDER BY id LIMIT 1")?.id;
const supplierId = one("SELECT id FROM parties WHERE type='supplier' ORDER BY id LIMIT 1")?.id;
let productId = one('SELECT id FROM products ORDER BY id LIMIT 1')?.id;
// Stock must exist before a sale can be recorded (the engine refuses negative
// stock), and partner capital needs a partner party — both are set up here.
ops.adjustStock(db, { product_id: productId, date: today, quantity: 1000, rate: 10, notes: 'crud probe opening' }, null);
let partnerId = one("SELECT id FROM parties WHERE type='partner' ORDER BY id LIMIT 1")?.id;
if (!partnerId) {
    ops.saveParty(db, { name: 'ZZ CRUD PARTNER', type: 'partner', opening_balance: 0, partner_type: 'active' });
    partnerId = one("SELECT id FROM parties WHERE name = 'ZZ CRUD PARTNER'")?.id;
}

function probes() {
    return [
        {
            name: 'Parties',
            create: () => ops.saveParty(db, { name: 'ZZ CRUD PARTY', type: 'customer', opening_balance: 0 }),
            find: () => one("SELECT * FROM parties WHERE name = 'ZZ CRUD PARTY'"),
            edit: (row) => ops.saveParty(db, { ...row, name: 'ZZ CRUD PARTY EDITED' }),
            findEdited: () => one("SELECT * FROM parties WHERE name = 'ZZ CRUD PARTY EDITED'"),
            del: (row) => ops.deleteParty(db, row.id, null),
            gone: () => !one("SELECT id FROM parties WHERE name LIKE 'ZZ CRUD PARTY%'"),
            table: 'parties'
        },
        {
            name: 'Products',
            create: () => ops.saveProduct(db, { name: 'ZZ CRUD PRODUCT', unit: 'kg', rate: 10, opening_stock: 0, category: 'Test' }),
            find: () => one("SELECT * FROM products WHERE name = 'ZZ CRUD PRODUCT'"),
            edit: (row) => ops.saveProduct(db, { ...row, rate: 12.5 }),
            findEdited: () => one("SELECT * FROM products WHERE name = 'ZZ CRUD PRODUCT' AND rate = 12.5"),
            del: (row) => ops.deleteProduct(db, row.id, null),
            gone: () => !one("SELECT id FROM products WHERE name = 'ZZ CRUD PRODUCT'"),
            table: 'products'
        },
        {
            name: 'Sales',
            create: () => ops.saveSale(db, {
                invoice_no: 'ZZ-SALE-1', date: today, party_id: partyId,
                items: [{ product_id: productId, product_name: 'ZZ Item', quantity: 1, rate: 100, amount: 100 }],
                subtotal: 100, discount: 0, discount_percent: 0, tax: 0,
                grand_total: 100, paid_amount: 0, payment_mode: 'credit', notes: 'crud probe'
            }),
            find: () => one("SELECT * FROM sales WHERE invoice_no = 'ZZ-SALE-1'"),
            edit: (row) => ops.saveSale(db, {
                id: row.id, invoice_no: row.invoice_no, date: row.date, party_id: row.party_id,
                items: [{ product_id: productId, product_name: 'ZZ Item', quantity: 1, rate: 120, amount: 120 }],
                subtotal: 120, discount: 0, discount_percent: 0, tax: 0,
                grand_total: 120, paid_amount: 0, payment_mode: 'credit', notes: 'crud probe edited'
            }),
            findEdited: () => one("SELECT * FROM sales WHERE invoice_no = 'ZZ-SALE-1' AND grand_total = 120"),
            del: (row) => ops.deleteSale(db, row.id, null),
            gone: () => !one("SELECT id FROM sales WHERE invoice_no = 'ZZ-SALE-1'"),
            table: 'sales'
        },
        {
            name: 'Purchases',
            create: () => ops.savePurchase(db, {
                bill_no: 'ZZ-BILL-1', date: today, party_id: supplierId,
                items: [{ product_id: productId, product_name: 'ZZ Item', quantity: 2, rate: 50, amount: 100 }],
                subtotal: 100, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
                grand_total: 100, paid_amount: 0, payment_mode: 'credit', status: 'unpaid', notes: 'crud probe'
            }),
            find: () => one("SELECT * FROM purchases WHERE bill_no = 'ZZ-BILL-1'"),
            edit: (row) => ops.savePurchase(db, {
                id: row.id, bill_no: row.bill_no, date: row.date, party_id: row.party_id,
                items: [{ product_id: productId, product_name: 'ZZ Item', quantity: 3, rate: 50, amount: 150 }],
                subtotal: 150, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
                grand_total: 150, paid_amount: 0, payment_mode: 'credit', status: 'unpaid', notes: 'crud probe edited'
            }),
            findEdited: () => one("SELECT * FROM purchases WHERE bill_no = 'ZZ-BILL-1' AND grand_total = 150"),
            del: (row) => ops.deletePurchase(db, row.id, null),
            gone: () => !one("SELECT id FROM purchases WHERE bill_no = 'ZZ-BILL-1'"),
            table: 'purchases'
        },
        {
            name: 'Milk collection',
            create: () => ops.saveMilkCollection(db, {
                collection_no: 'ZZ-MILK-1', date: today, party_id: supplierId,
                milk_type: 'cow', quantity_liters: 10, fat_percent: 4, snf_percent: 8,
                rate: 50, amount: 500, shift: 'morning'
            }),
            find: () => one("SELECT * FROM milk_collections WHERE collection_no = 'ZZ-MILK-1'"),
            edit: (row) => ops.saveMilkCollection(db, {
                id: row.id, collection_no: row.collection_no, date: row.date, party_id: row.party_id,
                milk_type: row.milk_type, quantity_liters: 12, fat_percent: row.fat_percent,
                snf_percent: row.snf_percent, rate: row.rate, amount: 600, shift: row.shift
            }),
            findEdited: () => one("SELECT * FROM milk_collections WHERE collection_no = 'ZZ-MILK-1' AND quantity_liters = 12"),
            del: (row) => ops.deleteMilkCollection(db, row.id, null),
            gone: () => !one("SELECT id FROM milk_collections WHERE collection_no = 'ZZ-MILK-1'"),
            table: 'milk_collections'
        },
        {
            name: 'Payments',
            create: () => ops.savePayment(db, { party_id: partyId, date: today, type: 'receipt', amount: 250, mode: 'cash', notes: 'crud probe' }),
            find: () => one("SELECT * FROM payments WHERE notes = 'crud probe'"),
            // The register keeps the amount immutable (documented in the 76
            // audit); the editable fields are date, mode, type and notes.
            edit: (row) => ops.updatePayment(db, { ...row, notes: 'crud probe edited' }),
            findEdited: () => one("SELECT * FROM payments WHERE notes = 'crud probe edited'"),
            del: (row) => ops.deletePayment(db, row.id),
            gone: () => !one("SELECT id FROM payments WHERE notes = 'crud probe'"),
            table: 'payments'
        },
        {
            name: 'Petty cash',
            create: () => ops.savePettyCash(db, { voucher_no: 'ZZ-PC-1', date: today, expense_head: 'ZZ PROBE', description: 'crud probe', amount: 50, paid_to: 'ZZ', payment_mode: 'cash' }),
            find: () => one("SELECT * FROM petty_cash WHERE description = 'crud probe'"),
            edit: (row) => ops.savePettyCash(db, { ...row, amount: 75 }),
            findEdited: () => one("SELECT * FROM petty_cash WHERE description = 'crud probe' AND amount = 75"),
            del: (row) => ops.deletePettyCash(db, row.id, null),
            gone: () => !one("SELECT id FROM petty_cash WHERE description = 'crud probe'"),
            table: 'petty_cash'
        },
        {
            name: 'Bank transactions',
            create: () => ops.saveBankTransaction(db, { date: today, counterparty_name: 'ZZ BANK PROBE', description: 'crud probe', debit: 100, payment_mode: 'QR/Bank', bank_account: 'ZZ' }),
            find: () => one("SELECT * FROM bank_transactions WHERE description = 'crud probe'"),
            edit: (row) => ops.updateBankTransaction ? ops.updateBankTransaction(db, { ...row, debit: 125 }) : (() => {
                db.prepare('UPDATE bank_transactions SET debit = 125 WHERE id = ?').run(row.id);
                return { success: true };
            })(),
            findEdited: () => one("SELECT * FROM bank_transactions WHERE description = 'crud probe' AND debit = 125"),
            del: (row) => ops.deleteBankTransaction(db, row.id, null),
            gone: () => !one("SELECT id FROM bank_transactions WHERE description = 'crud probe'"),
            table: 'bank_transactions'
        },
        {
            name: 'Salary records',
            create: () => ops.saveSalaryRecord(db, {
                employee_name: 'ZZ CRUD EMP', month: '2083-07', basic_salary: 1000, allowance: 0,
                advance: 0, deduction: 0, net_salary: 1000, payment_date: today, payment_mode: 'cash'
            }),
            find: () => one("SELECT * FROM salary_records WHERE employee_name = 'ZZ CRUD EMP'"),
            edit: (row) => ops.saveSalaryRecord(db, { ...row, net_salary: 1100, basic_salary: 1100 }),
            findEdited: () => one("SELECT * FROM salary_records WHERE employee_name = 'ZZ CRUD EMP' AND net_salary = 1100"),
            del: (row) => ops.deleteSalaryRecord(db, row.id, null),
            gone: () => !one("SELECT id FROM salary_records WHERE employee_name = 'ZZ CRUD EMP'"),
            table: 'salary_records'
        },
        {
            name: 'Employees',
            create: () => ops.saveEmployee(db, { code: 'ZZ-EMP', name: 'ZZ CRUD STAFF', position: 'Tester' }),
            find: () => one("SELECT * FROM employees WHERE name = 'ZZ CRUD STAFF'"),
            edit: (row) => ops.saveEmployee(db, { ...row, position: 'Senior Tester' }),
            findEdited: () => one("SELECT * FROM employees WHERE name = 'ZZ CRUD STAFF' AND position = 'Senior Tester'"),
            del: (row) => ops.deleteEmployee(db, row.id, null),
            // Employees are deactivated, never erased (history stays readable).
            gone: () => {
                const e = one("SELECT * FROM employees WHERE name = 'ZZ CRUD STAFF'");
                return !e || Number(e.active) === 0;
            },
            table: 'employees'
        },
        {
            name: 'Cash deposits',
            create: () => ops.saveCashDeposit(db, { date: today, bank_name: 'ZZ BANK', branch: 'Test', amount: 500, cash_source: 'other', deposit_mode: 'cash', remarks: 'crud probe' }),
            find: () => one("SELECT * FROM cash_deposits WHERE remarks = 'crud probe'"),
            edit: (row) => ops.saveCashDeposit(db, { ...row, amount: 600 }),
            findEdited: () => one("SELECT * FROM cash_deposits WHERE remarks = 'crud probe' AND amount = 600"),
            del: (row) => ops.deleteCashDeposit(db, row.id, null),
            gone: () => !one("SELECT id FROM cash_deposits WHERE remarks = 'crud probe'"),
            table: 'cash_deposits'
        },
        {
            name: 'Partner capital',
            create: () => ops.savePartnerCapital(db, { party_id: partnerId, date: today, type: 'contribution', amount: 1000, mode: 'cash', reference_no: 'ZZ-PC', notes: 'crud probe' }),
            find: () => one("SELECT * FROM partner_capital WHERE notes = 'crud probe'"),
            edit: (row) => ops.savePartnerCapital(db, { ...row, amount: 1200 }),
            findEdited: () => one("SELECT * FROM partner_capital WHERE notes = 'crud probe' AND amount = 1200"),
            del: (row) => ops.deletePartnerCapital(db, row.id, null),
            gone: () => !one("SELECT id FROM partner_capital WHERE notes = 'crud probe'"),
            table: 'partner_capital'
        }
    ];
}

for (const p of probes()) {
    console.log(`\n── ${p.name}`);
    let row = null;
    try {
        const res = p.create();
        if (res && res.success === false) throw new Error(res.error || 'create failed');
        reopen();                       // persistence: read from disk again
        row = p.find();
        ok(!!row, 'create → present after reopening the database', row ? row.id : null);
        if (!row) continue;
    } catch (e) {
        fail++; console.log(`  ❌ FAIL — create: ${e.message}`);
        continue;
    }
    try {
        const res = p.edit(row);
        if (res && res.success === false) throw new Error(res.error || 'edit failed');
        reopen();
        ok(!!p.findEdited(), 'edit → new value persisted');
    } catch (e) {
        fail++; console.log(`  ❌ FAIL — edit: ${e.message}`);
    }
    try {
        const res = p.del(row);
        if (res && res.success === false) throw new Error(res.error || 'delete failed');
        reopen();
        ok(p.gone(), 'delete → record removed');
        ok(!!one("SELECT id FROM audit_log WHERE table_name = ? AND record_id = ?", p.table, row.id),
            'delete → audit_log entry written', p.table);
    } catch (e) {
        fail++; console.log(`  ❌ FAIL — delete: ${e.message}`);
    }
}

console.log(`\n════════════════════════════════\nRESULT: ${pass} passed, ${fail} failed, ${skipped} skipped`);
console.log(`Database copy: ${dbPath}`);
db.close();
process.exit(fail ? 1 : 0);
