/**
 * Rehearsal: run the full milk/production/salary migration on a throwaway
 * DB copy, then print a reconciliation table (DB vs Excel expectations).
 * Read-only against the live database — everything happens on the copy.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP = '/tmp/rehearsal-' + Date.now() + '.db';
const EXCEL = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');

fs.copyFileSync(SRC, TMP);
console.log('Rehearsal DB:', TMP);

const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const dbName = path.basename(TMP);
const excelImport = require(path.join(ROOT, 'shared', 'excel-import'));

initDatabase('/tmp', dbName);  // applies schema + migrations on the copy
// fresh connection so all reads see the migration's committed writes
let db = new Database(TMP);

const report = {};
report.milk_collections = () => db.prepare('SELECT COUNT(*) c FROM milk_collections').get().c;
report.milk_by_type = () => db.prepare('SELECT milk_type, COUNT(*) n, SUM(quantity_liters) qty, SUM(amount) amt FROM milk_collections GROUP BY milk_type').all();
report.purchase_items_milk_left = () => db.prepare("SELECT COUNT(*) c FROM purchase_items WHERE product_name LIKE '%ilk%'").get().c;
report.production_batches = () => db.prepare("SELECT COUNT(*) c FROM production_batches WHERE batch_no LIKE 'PRD-DRV-%'").get().c;
report.employees = () => db.prepare('SELECT code, name, position FROM employees ORDER BY id').all();
report.negative_stock = () => db.prepare(`
    SELECT p.name, SUM(sm.inward_qty - sm.outward_qty) net
    FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    GROUP BY p.id HAVING net < -0.01 ORDER BY net
`).all();

// totals reconciliation vs Excel Purchase_Entry
const wb = XLSX.readFile(EXCEL);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Purchase_Entry'], { header: 1, defval: '' });
let excelMilkQty = 0, excelMilkAmt = 0, excelAllAmt = 0;
for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[2]) continue;
    const prod = String(r[5] || '');
    const qty = Number(r[12]) || 0;
    const amt = Number(r[13]) || 0;
    excelAllAmt += amt;
    if (/\bmilks?\b/i.test(prod) && !/powder/i.test(prod)) { excelMilkQty += qty; excelMilkAmt += amt; }
}
const dbMilk = db.prepare('SELECT SUM(quantity_liters) q, SUM(amount) a FROM milk_collections WHERE collection_no LIKE \'MC-IMP-%\'').get();
report.reconcile = {
    excel_milk_qty: Math.round(excelMilkQty * 100) / 100,
    db_milk_qty: Math.round((dbMilk.q || 0) * 100) / 100,
    excel_milk_amt: Math.round(excelMilkAmt * 100) / 100,
    db_milk_amt: Math.round((dbMilk.a || 0) * 100) / 100,
    qty_match: Math.abs(excelMilkQty - (dbMilk.q || 0)) < 0.01,
    amt_match: Math.abs(excelMilkAmt - (dbMilk.a || 0)) < 1
};

// salary import on the copy
const salRows = XLSX.utils.sheet_to_json(wb.Sheets['Salary Advance'], { header: 1, defval: '' });
report.salary = excelImport.importSalaryAdvanceSheet(db, salRows, { log: () => {} });
report.salary_records = db.prepare('SELECT employee_name, month, net_salary, payment_date FROM salary_records ORDER BY id').all();

// ledger-driven receivable / payable
const { getPartyAccountSummary } = require(path.join(ROOT, 'shared', 'operations', 'party_account'));
const summary = getPartyAccountSummary(db);
report.totals = {
    receivable: Math.round(summary.filter(r => r.receivable > 0).reduce((s, r) => s + r.receivable, 0)),
    payable: Math.round(summary.filter(r => r.payable > 0).reduce((s, r) => s + r.payable, 0)),
    purchase_total: Math.round(summary.reduce((s, r) => s + r.purchase_total + r.milk_total, 0)),
    sales_total: Math.round(summary.reduce((s, r) => s + r.sales_total, 0))
};

report.milk_collections = report.milk_collections();
report.milk_by_type = report.milk_by_type();
report.purchase_items_milk_left = report.purchase_items_milk_left();
report.leftover_milk_detail = db.prepare(`
    SELECT pi.product_name, pi.quantity, pi.rate, pi.amount, p.bill_no, p.date
    FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    WHERE pi.product_name LIKE '%ilk%' LIMIT 12
`).all();
report.leftover_negpos = db.prepare(`
    SELECT SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END) neg,
           SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) pos,
           SUM(quantity) netqty
    FROM purchase_items WHERE product_name LIKE '%ilk%'
`).get();
report.production_batches = report.production_batches();
report.employees = report.employees();
report.negative_stock = report.negative_stock();

console.log('\n===== REHEARSAL REPORT =====');
console.log(JSON.stringify(report, (k, v) => v, 2));

db.close();
fs.unlinkSync(TMP);
console.log('\nRehearsal DB removed.');
