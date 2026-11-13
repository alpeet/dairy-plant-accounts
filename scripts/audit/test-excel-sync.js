#!/usr/bin/env node
/**
 * test-excel-sync.js — per-module Excel write-back
 *
 * Proves, on a COPY of the operator's workbook:
 *   1. every module writes to its own worksheet only
 *   2. Party_Ledger is never written (part bytes identical)
 *   3. unrelated worksheets are byte-identical
 *   4. a dry run writes nothing
 *   5. editing a record updates its row instead of appending a duplicate
 *   6. an App Ref makes the row findable again
 *   7. bank never appears in any other module's sheet
 *   8. a deleted record is reported, not silently removed
 *   9. a locked/read-only workbook fails loudly
 *
 * Never touches the real workbook or the real database.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const sync = require(path.join(ROOT, 'shared', 'excel-sync'));
const parts = require(path.join(ROOT, 'shared', 'xlsx-parts'));
const { workbookPath } = require(path.join(ROOT, 'shared', 'workbook-path'));

let passed = 0, failed = 0;
const check = (ok, label, detail) => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

const src = workbookPath();
if (!fs.existsSync(src)) {
    console.log(`Workbook not found: ${src}`);
    process.exit(2);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xl-sync-'));
const book = path.join(dir, 'workbook.xlsx');
fs.copyFileSync(src, book);

const db = initDatabase(dir);
const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const partOf = (file, sheet) => {
    const zip = parts.readZip(fs.readFileSync(file));
    const part = parts.locateSheetPart(zip, sheet);
    return part ? crypto.createHash('sha256').update(zip.entries.get(part).data).digest('hex') : null;
};
const rowsOf = (file, sheet) => {
    const wb = XLSX.readFile(file, { cellFormula: true });
    const name = wb.SheetNames.find(n => n.toLowerCase() === sheet.toLowerCase());
    if (!name) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
};
const findRef = (file, sheet, ref) => {
    const rows = rowsOf(file, sheet);
    for (let r = 0; r < rows.length; r++) {
        const idx = (rows[r] || []).findIndex(v => String(v).trim() === ref);
        if (idx >= 0) return { row: r + 1, cells: rows[r], refCol: idx };
    }
    return null;
};

// ── party + one record in every register ─────────────────────
const pid = db.prepare("INSERT INTO parties (name,type,opening_balance) VALUES ('RAM KIRANA','customer',0)").run().lastInsertRowid;
const saleId = db.prepare(`INSERT INTO sales (invoice_no,date,party_id,subtotal,discount,discount_percent,tax,grand_total,paid_amount,payment_mode,status,notes)
    VALUES ('INV-9001','2083-04-10',?,1000,0,0,0,1000,0,'credit','unpaid','test sale')`).run(pid).lastInsertRowid;
db.prepare(`INSERT INTO sales_items (sale_id,product_name,quantity,unit,rate,amount) VALUES (?,'MIX MILK',10,'L',100,1000)`).run(saleId);

const prodId = db.prepare("INSERT INTO products (name,unit,opening_stock,rate) VALUES ('MIX MILK','L',0,100)").run().lastInsertRowid;
const purId = db.prepare(`INSERT INTO purchases (bill_no,date,party_id,subtotal,discount,tax,transport_charges,extra_charges,grand_total,paid_amount,payment_mode,status,notes)
    VALUES ('BILL-9001','2083-04-11',?,800,0,0,0,0,800,0,'credit','unpaid','test purchase')`).run(pid).lastInsertRowid;
db.prepare(`INSERT INTO purchase_items (purchase_id,product_id,product_name,quantity,unit,rate,amount) VALUES (?,?,'MIX MILK',8,'L',100,800)`).run(purId, prodId);

const milkId = db.prepare(`INSERT INTO milk_collections (collection_no,date,party_id,milk_type,shift,quantity_liters,fat_percent,snf_percent,rate,amount,status)
    VALUES ('MC-9001','2083-04-12',?,'cow','morning',50,4.2,8.5,50,2500,'pending')`).run(pid).lastInsertRowid;

const receiptId = db.prepare(`INSERT INTO payments (party_id,date,type,transaction_type,amount,mode,reference_type,reference_id,notes)
    VALUES (?, '2083-04-13','receipt','receipt',500,'cash','sale','9001','test receipt')`).run(pid).lastInsertRowid;
const payId = db.prepare(`INSERT INTO payments (party_id,date,type,transaction_type,amount,mode,reference_type,reference_id,notes)
    VALUES (?, '2083-04-14','payment','payment',300,'cash','purchase','BILL-9002','test payment')`).run(pid).lastInsertRowid;
const advId = db.prepare(`INSERT INTO payments (party_id,date,type,transaction_type,amount,mode,reference_type,notes)
    VALUES (?, '2083-04-15','advance','advance',1000,'cash','advance','test advance')`).run(pid).lastInsertRowid;

const pcId = db.prepare(`INSERT INTO petty_cash (voucher_no,date,expense_head,description,amount,paid_to,payment_mode,remarks)
    VALUES ('PC-9001','2083-04-16','TEA','tea for staff',150,'OFFICE EXPENSES','cash','test petty')`).run().lastInsertRowid;
const expId = db.prepare(`INSERT INTO other_expenses (date,category,expense_head,description,amount,paid_to,payment_mode,remarks)
    VALUES ('2083-04-17','Operating','ELECTRICITY','shop bill',900,'NEA','cash','test expense')`).run().lastInsertRowid;
const rentId = db.prepare(`INSERT INTO other_expenses (date,category,expense_head,description,amount,paid_to,payment_mode,remarks)
    VALUES ('2083-04-18','Income','Rent Received','shop rent',2500,'TENANT SHOP','cash','test rent')`).run().lastInsertRowid;
// A fresh schema has no accounting_class column (it is added by a migration on
// an existing book), so the test writes only the columns both schemas share.
const bankId = db.prepare(`INSERT INTO bank_transactions (date,reference_no,counterparty_name,description,debit,credit,amount,payment_mode,remarks)
    VALUES ('2083-04-19','TXN-9001','NEA','electricity paid',900,0,900,'bank','test bank')`).run().lastInsertRowid;
const empId = db.prepare("INSERT INTO employees (name,position) VALUES ('SITA KARKI','helper')").run().lastInsertRowid;
const salId = db.prepare(`INSERT INTO salary_records (employee_id,employee_name,position,month,basic_salary,allowance,advance,deduction,net_salary,payment_date,payment_mode,voucher_no,remarks)
    VALUES (?, 'SITA KARKI','helper','2083-04',8000,500,0,0,8500,'2083-04-20','cash','SAL-9001','test salary')`).run(empId).lastInsertRowid;

console.log(`\nWorkbook copy : ${book}\nDatabase      : ${path.join(dir, 'dairy-plant.db')}\n`);

// ── 1. Report-only tabs never claim a sheet ───────────────────
console.log('1. Module registry');
check(!sync.MODULES['party-ledger'] && !sync.MODULES.ledger, 'Party Ledger is not a sync target');
check(!Object.values(sync.MODULES).some(m => /party.?ledger/i.test(m.sheet)), 'no module names Party_Ledger as its worksheet');
check(sync.MODULES.bank.sheet === 'BANK RECON', 'bank maps to BANK RECON');
check(sync.MODULES.collection.sheet === 'Collection', 'collection maps to Collection');
check(sync.MODULES.payments.sheet === 'Payment', 'payments map to Payment');
check(sync.MODULES.petty_cash.sheet === 'PETTY CASH', 'petty cash maps to PETTY CASH');
check(sync.MODULES.expenses.sheet === 'Expenses', 'expenses map to Expenses');
check(sync.MODULES.salary.sheet === 'Salary', 'salary maps to Salary');
check(sync.moduleIds().length >= 9, 'at least nine register modules are syncable', sync.moduleIds().length);

// ── 2. Dry run writes nothing ─────────────────────────────────
console.log('\n2. Dry run');
const before = hash(book);
const dry = sync.syncModule(db, 'sales', { workbookPath: book, apply: false });
check(dry.success && dry.applied === false, 'dry run succeeds and reports no write', dry.error);
check(hash(book) === before, 'workbook bytes unchanged by a dry run');
check(dry.appended === 1, 'one sale row planned', dry.appended);
check(dry.columns['Invoice No'] === 'C', 'Invoice No resolved to column C from the real header', dry.columns);

// ── 3. Each module writes only its own sheet ──────────────────
console.log('\n3. Per-module write-back');
const ledgerBefore = partOf(book, 'Party_Ledger');
const plBefore = partOf(book, 'Profit_Loss');
const results = {};
for (const id of sync.moduleIds()) {
    results[id] = sync.syncModule(db, id, { workbookPath: book, apply: true });
}
for (const id of sync.moduleIds()) {
    check(results[id].success && results[id].applied, `${id} wrote successfully`, results[id].error);
}
check(partOf(book, 'Party_Ledger') === ledgerBefore, 'Party_Ledger part is byte-identical after every module synced');
check(partOf(book, 'Profit_Loss') === plBefore, 'Profit_Loss part is byte-identical');

// ── 4. Values landed in the right sheet and columns ───────────
console.log('\n4. Row placement and column mapping');
const saleRow = findRef(book, 'Sales_Entry', `SALE-${saleId}#1`);
check(!!saleRow, 'sale row found in Sales_Entry by App Ref');
check(saleRow && String(saleRow.cells[2]) === 'INV-9001', 'invoice number in column C', saleRow && saleRow.cells[2]);
check(saleRow && String(saleRow.cells[0]) === '2083-04-10', 'BS date in column A', saleRow && saleRow.cells[0]);
check(saleRow && String(saleRow.cells[1]).startsWith('2026-'), 'AD date written in column B', saleRow && saleRow.cells[1]);
check(saleRow && near(saleRow.cells[9], 1000), 'net amount in column J', saleRow && saleRow.cells[9]);
check(saleRow && String(saleRow.cells[saleRow.refCol]) === `SALE-${saleId}#1`, 'App Ref stored in its own column', saleRow && saleRow.refCol);

const milkRow = findRef(book, 'Purchase_Entry', `MILK-${milkId}`);
check(!!milkRow, 'milk row found in Purchase_Entry');
check(milkRow && near(milkRow.cells[12], 50), 'milk quantity in column M', milkRow && milkRow.cells[12]);
check(milkRow && near(milkRow.cells[6], 4.2), 'FAT in column G', milkRow && milkRow.cells[6]);

const purRow = findRef(book, 'Purchase_Entry', `PUR-${purId}#1`);
check(!!purRow, 'purchase row found in Purchase_Entry too');
check(purRow && String(purRow.cells[2]) === 'BILL-9001', 'purchase bill no in column C');

const colRow = findRef(book, 'Collection', `COL-${receiptId}`);
check(!!colRow, 'receipt found in Collection');
check(colRow && near(colRow.cells[7], 500), 'receipt amount in Collected (H)', colRow && colRow.cells[7]);
check(colRow && String(colRow.cells[5]) === 'Collection', 'Type = Collection', colRow && colRow.cells[5]);

const rentRow = findRef(book, 'Collection', `COL-RENT-${rentId}`);
check(!!rentRow, 'rent income row found in Collection');
check(rentRow && String(rentRow.cells[5]) === 'Rent', 'rent keeps Type = Rent (the P&L reads it there)', rentRow && rentRow.cells[5]);

const payRow = findRef(book, 'Payment', `PAY-${payId}`);
check(!!payRow, 'supplier payment found in Payment');
// Payment's real header puts Type in G and Paid in J (Collection uses F/H).
const payHeader = rowsOf(book, 'Payment').find(r => (r || []).some(v => /^paid$/i.test(String(v).trim()))) || [];
const paidIdx = payHeader.findIndex(v => /^paid$/i.test(String(v).trim()));
check(paidIdx === 9, 'Payment sheet keeps Paid in column J (resolved from the real header)', paidIdx);
check(payRow && near(payRow.cells[paidIdx], 300), 'payment amount in the Paid column', payRow && payRow.cells[paidIdx]);
check(payRow && String(payRow.cells[6]) === 'Payment', 'payment Type in column G', payRow && payRow.cells[6]);

const advRow = findRef(book, 'Advance', `ADV-${advId}`);
check(!!advRow, 'advance found in Advance');

const pcRow = findRef(book, 'PETTY CASH', `PC-${pcId}`);
check(!!pcRow, 'petty cash row found in PETTY CASH');

const expRow = findRef(book, 'Expenses', `EXP-${expId}`);
check(!!expRow, 'expense found in Expenses');
check(expRow && !findRef(book, 'PETTY CASH', `EXP-${expId}`), 'the expense did not also go into PETTY CASH');

const bankRow = findRef(book, 'BANK RECON', `BANK-${bankId}`);
check(!!bankRow, 'bank row found in BANK RECON');
check(bankRow && near(bankRow.cells[6], 900), 'bank debit in column G', bankRow && bankRow.cells[6]);

const salRow = findRef(book, 'Salary', `SAL-${salId}`);
check(!!salRow, 'salary row found in Salary');

// ── 5. Bank is nowhere else ───────────────────────────────────
console.log('\n5. Bank stays in BANK RECON');
const bankSheets = [];
for (const sheet of XLSX.readFile(book).SheetNames) {
    const rows = rowsOf(book, sheet);
    if (rows.some(r => (r || []).some(v => String(v).startsWith(`BANK-${bankId}`)))) bankSheets.push(sheet);
}
check(bankSheets.length === 1 && bankSheets[0].toLowerCase() === 'bank recon',
    'the bank row appears in exactly one worksheet', bankSheets);

// ── 6. Re-sync updates, never duplicates ──────────────────────
console.log('\n6. Edit updates the same row');
const salesRowsBefore = rowsOf(book, 'Sales_Entry').length;
db.prepare("UPDATE sales SET grand_total = 1234.5 WHERE id = ?").run(saleId);
const resync = sync.syncModule(db, 'sales', { workbookPath: book, apply: true });
check(resync.success && resync.appended === 0, 'second sync appends nothing', { appended: resync.appended });
check(rowsOf(book, 'Sales_Entry').length === salesRowsBefore, 'sheet row count unchanged');
const saleRow2 = findRef(book, 'Sales_Entry', `SALE-${saleId}#1`);
check(saleRow2 && near(saleRow2.cells[9], 1234.5), 'edited amount landed in the same row', saleRow2 && saleRow2.cells[9]);
check(saleRow2 && saleRow2.row === saleRow.row, 'the Excel row did not move', { before: saleRow.row, after: saleRow2 && saleRow2.row });

// ── 7. Deleted record is reported, not erased ─────────────────
console.log('\n7. Deletion policy');
db.prepare("DELETE FROM payments WHERE id = ?").run(payId);
const afterDelete = sync.syncModule(db, 'payments', { workbookPath: book, apply: true });
check(afterDelete.success, 'sync still succeeds after a delete', afterDelete.error);
check(afterDelete.orphans.some(o => o.ref === `PAY-${payId}`), 'deleted record reported as orphaned', afterDelete.orphans.map(o => o.ref));
check(!!findRef(book, 'Payment', `PAY-${payId}`), 'the workbook row is kept (archive, not silently deleted)');

// ── 8. Locked workbook fails loudly ──────────────────────────
console.log('\n8. Read-only workbook');
const locked = path.join(dir, 'locked.xlsx');
fs.copyFileSync(book, locked);
// Excel marks an open workbook with an owner file "~$<name>".
fs.writeFileSync(path.join(dir, '~$locked.xlsx'), 'owner');
db.prepare("UPDATE sales SET grand_total = 999 WHERE id = ?").run(saleId);
const beforeLocked = hash(locked);
const lockedRes = sync.syncModule(db, 'sales', { workbookPath: locked, apply: true });
check(lockedRes.success === false, 'a workbook open in Excel is reported as a failure, not a success', lockedRes.message);
check(hash(locked) === beforeLocked, 'the open workbook was not modified');
fs.unlinkSync(path.join(dir, '~$locked.xlsx'));
const unlocked = sync.syncModule(db, 'sales', { workbookPath: locked, apply: true });
check(unlocked.success && unlocked.applied, 'sync works again once Excel releases the file', unlocked.error);

// ── done ─────────────────────────────────────────────────────
db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
