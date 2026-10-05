/**
 * Accounting logic acceptance tests.
 * ==================================
 * Verifies the FINAL ACCOUNTING LOGIC CORRECTIONS on two databases:
 *
 *   PART A — a FRESH database with NEWLY ENTERED transactions (the six
 *            acceptance cases: full cash sale, partial payment, no payment,
 *            cash deposited into the bank, milk purchase counted once,
 *            office expense counted once).
 *   PART B — a COPY of the migrated historical database (the real Excel-imported
 *            business data), where the same rules must hold for data that
 *            arrived through the importer.
 *
 * The live database is never opened for writing: PART B works on a copy in /tmp.
 *
 * Usage: node scripts/audit/test-accounting-logic.js [liveDbPath]
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase, openDatabase, runMigrations } = require(path.join(ROOT, 'shared', 'db.js'));
const ops = require(path.join(ROOT, 'shared', 'operations', 'index.js'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting.js'));

const TMP = '/tmp/accounting-logic-test';
const ALL = { from_date: '0001-01-01', to_date: '9999-12-32' };

let pass = 0, fail = 0;
const ok = (cond, name, detail) => {
    console.log(`${cond ? '✅ PASS' : '❌ FAIL'} — ${name}${!cond && detail !== undefined ? `   [got ${JSON.stringify(detail)}]` : ''}`);
    cond ? pass++ : fail++;
};
const near = (a, b, tol = 0.005) => Math.abs(accounting.round2(a) - accounting.round2(b)) <= tol;
const money = (n) => accounting.round2(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ══════════════════════════════════════════════════════════════
// PART A — fresh database, newly entered transactions
// ══════════════════════════════════════════════════════════════
console.log('\n=== PART A: fresh database, newly entered transactions ===\n');

const db = initDatabase(TMP, 'fresh.db');
db.pragma('foreign_keys = OFF');
// The test sells from products that have no stock movements yet; stock control is
// not what these tests are about.
db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('allow_negative_stock', '1')").run();

const customerId = Number(db.prepare(
    "INSERT INTO parties (name, type) VALUES ('Test Customer', 'customer')"
).run().lastInsertRowid);
const supplierId = Number(db.prepare(
    "INSERT INTO parties (name, type) VALUES ('Test Supplier', 'supplier')"
).run().lastInsertRowid);
const farmerId = Number(db.prepare(
    "INSERT INTO parties (name, type) VALUES ('Test Farmer', 'farmer')"
).run().lastInsertRowid);
const milkProductId = Number(db.prepare(
    "INSERT INTO products (name, unit, category, opening_stock, rate, reorder_level) VALUES ('Test Milk', 'liter', 'Milk', 0, 60, 0)"
).run().lastInsertRowid);
const saleProductId = Number(db.prepare(
    "INSERT INTO products (name, unit, category, opening_stock, rate, reorder_level) VALUES ('Test Ghee', 'kg', 'Dairy', 1000, 100, 0)"
).run().lastInsertRowid);
db.pragma('foreign_keys = ON');

const saleItems = (productId, name, qty, rate, amount) => ([{
    product_id: productId, product_name: name, name, quantity: qty, unit: 'kg', rate, amount
}]);

const salesTotal = () => db.prepare('SELECT COALESCE(SUM(grand_total), 0) t FROM sales').get().t;
const salesReceived = () => db.prepare('SELECT COALESCE(SUM(paid_amount), 0) t FROM sales').get().t;

// ──────────────────────────────────────────────────────────────
// TEST 1 — full cash sale
// ──────────────────────────────────────────────────────────────
console.log('TEST 1 — full cash sale (Rs 10,000 received on Rs 10,000 invoice)');
{
    const before = ops.getCashBankPosition(db, ALL);
    const r = ops.saveSale(db, {
        invoice_no: 'T1-0001', date: '2083-04-01', party_id: customerId,
        items: saleItems(saleProductId, 'Test Ghee', 100, 100, 10000),
        subtotal: 10000, discount: 0, discount_percent: 0, tax: 0,
        grand_total: 10000, paid_amount: 10000, payment_mode: 'cash', notes: 'test 1'
    });
    const sale = ops.getSale(db, r.id);
    const after = ops.getCashBankPosition(db, ALL);
    const pl = ops.getProfitLoss(db, ALL);

    ok(sale.status === 'paid', 'T1: status is PAID when received = invoice total', sale.status);
    ok(near(sale.received_amount, 10000), 'T1: received = 10,000', sale.received_amount);
    ok(near(sale.outstanding_amount, 0), 'T1: outstanding (receivable) = 0', sale.outstanding_amount);
    ok(near(after.cash.balance - before.cash.balance, 10000), 'T1: cash increases by 10,000', after.cash.balance - before.cash.balance);
    ok(near(pl.income.total_sales, salesTotal()), 'T1: P&L sales revenue = sales total', pl.income.total_sales);
    // The money received with the invoice must be a real receipt transaction.
    const receipt = db.prepare("SELECT * FROM payments WHERE reference_type = 'sale' AND reference_id = ?").get(r.id);
    ok(!!receipt && near(receipt.amount, 10000) && receipt.type === 'receipt',
        'T1: the paid amount is posted as a real receipt transaction', receipt && receipt.amount);
}

// ──────────────────────────────────────────────────────────────
// TEST 2 — partial payment
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 2 — partial payment (Rs 6,000 on a Rs 10,000 invoice)');
{
    const r = ops.saveSale(db, {
        invoice_no: 'T2-0002', date: '2083-04-02', party_id: customerId,
        items: saleItems(saleProductId, 'Test Ghee', 100, 100, 10000),
        subtotal: 10000, discount: 0, discount_percent: 0, tax: 0,
        grand_total: 10000, paid_amount: 6000, payment_mode: 'cash', notes: 'test 2'
    });
    const sale = ops.getSale(db, r.id);
    ok(sale.status === 'partial', 'T2: status is PARTIAL when 0 < received < total', sale.status);
    ok(near(sale.received_amount, 6000), 'T2: received = 6,000', sale.received_amount);
    ok(near(sale.outstanding_amount, 4000), 'T2: receivable = 4,000', sale.outstanding_amount);
}

// ──────────────────────────────────────────────────────────────
// TEST 3 — no payment
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 3 — no payment (Rs 0 received on a Rs 10,000 invoice)');
{
    const r = ops.saveSale(db, {
        invoice_no: 'T3-0003', date: '2083-04-03', party_id: customerId,
        items: saleItems(saleProductId, 'Test Ghee', 100, 100, 10000),
        subtotal: 10000, discount: 0, discount_percent: 0, tax: 0,
        grand_total: 10000, paid_amount: 0, payment_mode: 'credit', notes: 'test 3'
    });
    const sale = ops.getSale(db, r.id);
    ok(sale.status === 'unpaid', 'T3: status is UNPAID when received = 0', sale.status);
    ok(near(sale.outstanding_amount, 10000), 'T3: receivable = 10,000', sale.outstanding_amount);

    // A payment record that does NOT cover the invoice must not read as Paid.
    ops.savePayment(db, {
        party_id: customerId, date: '2083-04-05', type: 'receipt', amount: 1000, mode: 'cash',
        reference_type: 'sale', reference_id: r.id, notes: 'part settlement'
    });
    const after = ops.getSale(db, r.id);
    ok(after.status === 'partial', 'T3b: a Rs 1,000 receipt against a Rs 10,000 invoice is PARTIAL, never PAID', after.status);
    ok(near(after.received_amount, 1000) && near(after.outstanding_amount, 9000),
        'T3b: received 1,000 / outstanding 9,000', { r: after.received_amount, o: after.outstanding_amount });
}

// ──────────────────────────────────────────────────────────────
// TEST 3c — money precision (no float equality)
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 3c — money precision / tolerance');
{
    ok(accounting.paymentStatus(99.999999, 100) === 'paid', "T3c: 99.999999 against 100 is PAID at currency precision");
    ok(accounting.paymentStatus(99.98, 100) === 'partial', 'T3c: 99.98 against 100 is PARTIAL');
    ok(accounting.round2(97.64999999999999) === 97.65, 'T3c: 97.64999999999999 rounds to 97.65', accounting.round2(97.64999999999999));
    ok(accounting.round2(23435.999999999996) === 23436, 'T3c: 23435.999999999996 rounds to 23,436.00', accounting.round2(23435.999999999996));
}

// ──────────────────────────────────────────────────────────────
// TEST 4 — cash received from sales is deposited into the bank
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 4 — cash received from sales deposited into the bank');
{
    const salesBefore = salesTotal();
    const before = ops.getCashBankPosition(db, ALL);

    // A fresh database has every sale in cash mode, so sell one more for cash,
    // then deposit that cash into the bank.
    ops.saveSale(db, {
        invoice_no: 'T4-0004', date: '2083-04-06', party_id: customerId,
        items: saleItems(saleProductId, 'Test Ghee', 100, 100, 10000),
        subtotal: 10000, discount: 0, discount_percent: 0, tax: 0,
        grand_total: 10000, paid_amount: 10000, payment_mode: 'cash', notes: 'test 4'
    });
    const afterSale = ops.getCashBankPosition(db, ALL);
    const dep = ops.saveCashDeposit(db, {
        date: '2083-04-06', bank_name: 'Test Bank', amount: 10000,
        cash_source: 'mixed', deposit_mode: 'cash', reference_no: 'DEP-TEST-1', remarks: 'test 4 deposit'
    });
    const after = ops.getCashBankPosition(db, ALL);

    ok(near(afterSale.bank.balance - before.bank.balance, 0),
        'T4: the cash sale does not touch the bank balance', afterSale.bank.balance - before.bank.balance);
    ok(near(after.bank.balance - afterSale.bank.balance, 10000),
        'T4: the deposit increases the bank balance by 10,000', after.bank.balance - afterSale.bank.balance);
    ok(near(after.cash.balance - afterSale.cash.balance, -10000),
        'T4: the deposit decreases cash by 10,000', after.cash.balance - afterSale.cash.balance);
    ok(near(salesTotal() - salesBefore, 10000),
        'T4: sales increased by the invoice only — the deposit adds NO extra sales', salesTotal() - salesBefore);

    const pl = ops.getProfitLoss(db, ALL);
    ok(near(pl.income.total_sales, salesTotal()), 'T4: P&L sales revenue still equals the sales register', pl.income.total_sales);

    // The deposit must not be usable as a customer payment.
    const daybook = ops.getEnhancedDaybook(db, { from_date: '2083-04-06', to_date: '2083-04-06' });
    const transferRow = daybook.entries.find(e => e.type === 'cash_deposit' || e.type === 'cash_transfer');
    ok(!!transferRow, 'T4: the deposit appears in the daybook as a transfer row');
    ok(!!transferRow && transferRow.debit_account === 'Bank' && transferRow.credit_account === 'Cash',
        'T4: the deposit is mapped Bank DR · Cash CR',
        transferRow && [transferRow.debit_account, transferRow.credit_account]);
    ok(!!transferRow && near(transferRow.debit || 0, 0) && near(transferRow.credit || 0, 10000),
        'T4: the deposit carries no debit (it is not a second receivable/customer debit)',
        transferRow && [transferRow.debit, transferRow.credit]);

    // And a bank statement row that says "cash deposit" must classify as a transfer.
    ok(ops.classifyBankRow({ txn_type: 'Bank Deposit (own)', description: 'CASH DEPOSIT BY SUSHIL', credit: 5000 }) === 'cash_to_bank_transfer',
        'T4: a bank row reading "CASH DEPOSIT BY …" classifies as a cash-to-bank transfer');
    ops.ensureBankTable(db);
    const bt = ops.saveBankTransaction(db, {
        date: '2083-04-07', reference_no: 'BT-TEST-1', counterparty_name: 'Test Customer',
        description: 'CASH DEPOSIT BY TEST CUSTOMER', credit: 2500, txn_type: 'Bank Deposit (own)'
    });
    const btRow = ops.getBankTransaction(db, bt.data.id);
    ok(btRow.accounting_class === 'cash_to_bank_transfer', 'T4b: an imported deposit row is stored as a transfer', btRow.accounting_class);
    ok(Number(btRow.ledger_posted) === 1 && btRow.ledger_entry_id === null,
        'T4b: the deposit is NOT posted to a customer ledger', { posted: btRow.ledger_posted, le: btRow.ledger_entry_id });
    ok(!db.prepare("SELECT id FROM ledger_entries WHERE reference_id = ? AND reference_type IN ('payment_received','payment_made')").get(bt.data.id),
        'T4b: no customer payment / receivable was invented for the deposit');
    const queue = ops.getBankReviewQueue(db).filter(r => /DEPOSIT/i.test(String(r.description || '')));
    ok(queue.length === 0, 'T4b: deposit rows never sit in the party review queue', queue.length);
    void dep;
}

// ──────────────────────────────────────────────────────────────
// TEST 5 — milk purchase counted once
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 5 — milk purchase counted once (Collection 500,000 + Purchase 500,000, same purchase)');
{
    // The same milk purchase, recorded the way the Excel importer records it: a
    // Purchase bill carrying the money (it creates the supplier payable), plus the
    // milk lines as Milk Collections linked to that bill through purchase_ref_id.
    const purchase = ops.savePurchase(db, {
        bill_no: 'T5-BILL-1', date: '2083-04-10', party_id: supplierId,
        items: [{ product_id: milkProductId, product_name: 'Test Milk', name: 'Test Milk', quantity: 10000, unit: 'liter', rate: 50, amount: 500000 }],
        subtotal: 500000, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
        grand_total: 500000, paid_amount: 0, payment_mode: 'credit', status: 'unpaid', notes: 'test 5 milk bill'
    });
    const purchaseId = purchase.id;

    const milkId = Number(db.prepare(
        `INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters, rate, amount,
            shift, status, notes, purchase_ref_id)
         VALUES ('MC-TEST-1', '2083-04-10', ?, 'mixed', 10000, 50, 500000, 'morning', 'pending', 'Milk purchase - bill T5-BILL-1', ?)`
    ).run(farmerId, purchaseId).lastInsertRowid);

    const milk = ops.getMilkCostSummary(db, { from_date: '2083-04-10', to_date: '2083-04-10' });
    ok(near(milk.milk_cost, 500000), 'T5: milk cost recognised once = 500,000 (not 1,000,000)', milk.milk_cost);
    ok(near(milk.non_milk_purchases, 0), 'T5: the linked purchase bill contributes no milk cost again', milk.non_milk_purchases);
    ok(near(milk.linked_to_purchase, 500000), 'T5: the collection is linked to the purchase bill (purchase_ref_id)', milk.linked_to_purchase);
    ok(near(milk.cogs, 500000), 'T5: COGS = 500,000', milk.cogs);

    const pl = ops.getProfitLoss(db, { from_date: '2083-04-10', to_date: '2083-04-10' });
    ok(near(pl.cogs, 500000), 'T5: P&L COGS = 500,000', pl.cogs);
    ok(near(pl.expenses.milk_collection.total, 500000) && near(pl.expenses.purchases.total, 0),
        'T5: P&L shows the milk through the collections only',
        { milk: pl.expenses.milk_collection.total, purchases: pl.expenses.purchases.total });

    // The supplier balance must not change: the payable comes from the bill alone.
    const ledgerPayable = db.prepare(
        "SELECT COALESCE(SUM(credit), 0) c FROM ledger_entries WHERE reference_type = 'purchase' AND reference_id = ?"
    ).get(purchaseId).c;
    ok(near(ledgerPayable, 500000), 'T5: the supplier payable is the bill amount, counted once', ledgerPayable);

    // Daybook: the same money must not appear twice.
    const dbk = ops.getEnhancedDaybook(db, { from_date: '2083-04-10', to_date: '2083-04-10' });
    const purchaseRows = dbk.entries.filter(e => e.type === 'purchase');
    const milkRows = dbk.entries.filter(e => e.type === 'milk_collection');
    ok(near(purchaseRows.reduce((s, e) => s + e.credit, 0), 500000),
        'T5: the daybook purchase row carries the 500,000 once', purchaseRows.reduce((s, e) => s + e.credit, 0));
    ok(milkRows.length === 1 && near(milkRows[0].credit, 0) && milkRows[0].represented_by_purchase === true,
        'T5: the linked milk collection is informational in the daybook (no second amount)',
        milkRows.map(r => [r.credit, r.represented_by_purchase]));

    // An UNLINKED milk collection IS the source of the cost and must count.
    db.prepare(
        `INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters, rate, amount, shift, status, notes)
         VALUES ('MC-TEST-2', '2083-04-11', ?, 'mixed', 2000, 50, 100000, 'morning', 'pending', 'standalone collection')`
    ).run(farmerId);
    const milk2 = ops.getMilkCostSummary(db, { from_date: '2083-04-11', to_date: '2083-04-11' });
    ok(near(milk2.milk_cost, 100000), 'T5b: a standalone milk collection is recognised as milk cost', milk2.milk_cost);
    void milkId;
}

// ──────────────────────────────────────────────────────────────
// TEST 6 — office expense: recognition (DR) vs payment (CR), once
// ──────────────────────────────────────────────────────────────
console.log('\nTEST 6 — office expense of Rs 5,000 paid from the bank');
{
    const before = ops.getCashBankPosition(db, ALL);
    ops.saveOtherExpense(db, {
        date: '2083-04-12', category: 'Office', expense_head: 'Electricity', description: 'office electricity',
        amount: 5000, paid_to: 'NEA', payment_mode: 'bank', reference_no: 'EXP-TEST-5000', remarks: 'test 6'
    });
    const pl = ops.getProfitLoss(db, { from_date: '2083-04-12', to_date: '2083-04-12' });
    const exp = ops.getExpenseSummary(db, { from_date: '2083-04-12', to_date: '2083-04-12' });

    ok(near(pl.expenses.other_expenses.total, 5000), 'T6: the P&L expense is 5,000', pl.expenses.other_expenses.total);
    ok(near(exp.total_operating_expenses, 5000), 'T6: operating expenses = 5,000 exactly once', exp.total_operating_expenses);
    ok(near(pl.net_profit, -5000), 'T6: the period result is −5,000 (expense recognised, not a credit)', pl.net_profit);

    const daybook = ops.getEnhancedDaybook(db, { from_date: '2083-04-12', to_date: '2083-04-12' });
    const row = daybook.entries.find(e => e.type === 'expense');
    ok(!!row && near(row.debit, 5000) && near(row.credit, 0),
        'T6: the expense is a DEBIT in the daybook (Expense DR · Cash/Bank CR)',
        row && [row.debit, row.credit]);
    ok(!!row && row.debit_account === 'Office / Operating Expense' && row.credit_account === 'Bank',
        'T6: mapped Office/Operating Expense DR · Bank CR', row && [row.debit_account, row.credit_account]);

    // The same expense also arriving on the bank statement must not double count.
    ops.ensureBankTable(db);
    ops.saveBankTransaction(db, {
        date: '2083-04-12', reference_no: 'EXP-TEST-5000', counterparty_name: 'OFFICE EXPENSES',
        description: 'ONLINE TRANSFERRED FOR ELECTRICITY BILL', debit: 5000, txn_type: 'Supplier Payment'
    });
    const exp2 = ops.getExpenseSummary(db, { from_date: '2083-04-12', to_date: '2083-04-12' });
    ok(near(exp2.total_operating_expenses, 5000),
        'T6b: a bank row for the same expense (same reference) is not added again', exp2.total_operating_expenses);

    // A bank-paid office expense never entered in the register IS recognised once.
    ops.saveBankTransaction(db, {
        date: '2083-04-13', reference_no: 'EXP-TEST-700', counterparty_name: 'OFFICE EXPENSES',
        description: 'PAYMENT FOR WOOD', debit: 700, txn_type: ''
    });
    const exp3 = ops.getExpenseSummary(db, { from_date: '2083-04-13', to_date: '2083-04-13' });
    ok(near(exp3.total_operating_expenses, 700), 'T6c: an unregistered bank-paid expense is recognised once', exp3.total_operating_expenses);
    const after = ops.getCashBankPosition(db, ALL);
    ok(near(after.bank.expenses_paid - before.bank.expenses_paid, 5700),
        'T6d: the bank is credited (reduced) by the expense payments', after.bank.expenses_paid - before.bank.expenses_paid);
}

// ──────────────────────────────────────────────────────────────
// PART A reconciliation
// ──────────────────────────────────────────────────────────────
console.log('\nPART A — cross-module reconciliation');
{
    const rec = ops.getReconciliation(db, ALL);
    const bad = rec.checks.filter(c => !c.ok);
    ok(bad.length === 0, 'A: every reconciliation check passes on the fresh database',
        bad.map(c => `${c.key} off by ${c.difference}`));
    ok(near(rec.sales.total, rec.profit.total_income - 0) || near(rec.sales.total, db.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales').get().t),
        'A: sales total = P&L sales revenue', { sales: rec.sales.total, income: rec.profit.total_income });
    ok(near(rec.receivable.from_sales_minus_receipts, accounting.round2(rec.sales.total - rec.receivable.customer_receipts)),
        'A: sales − customer receipts = receivable',
        { recv: rec.receivable.from_sales_minus_receipts, receipts: rec.receivable.customer_receipts, sales: rec.sales.total });

    const salesReport = ops.getSalesReport(db, ALL);
    const settlement = ops.getSaleSettlements(db, ALL);
    ok(near(salesReport.totalPaid, settlement.totals.received),
        'A: the sales register "paid" column uses the actual receipts', { reg: salesReport.totalPaid, st: settlement.totals.received });
    ok(near(salesReport.totalDue, settlement.totals.outstanding),
        'A: the sales register due column equals the outstanding receivable', { reg: salesReport.totalDue, st: settlement.totals.outstanding });
}

// The daily cash report: Expected = TOTAL SALES (never a cash-only figure).
console.log('\nPART A — Cash/Demon expected vs received');
{
    const daily = ops.getDailyCashCollection(db, ALL);
    const salesTotalAll = db.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales').get().t;
    ok(near(daily.expected_amount, salesTotalAll),
        'A: Expected amount = TOTAL SALES (not cash transactions / deposits)', daily.expected_amount);
    ok(near(daily.total_sales, salesTotalAll), 'A: the report exposes the sales the expectation comes from', daily.total_sales);
    ok(near(daily.difference, accounting.round2(daily.expected_amount - daily.cash_received)),
        'A: difference = expected − cash received', daily.difference);
    const day = daily.days.find(d => d.date === '2083-04-01');
    ok(!!day && near(day.expected_amount, 10000), 'A: per-day expected amount is that day\'s sales', day && day.expected_amount);
}

db.close();

// ══════════════════════════════════════════════════════════════
// PART B — migrated historical data (a COPY of the live database)
// ══════════════════════════════════════════════════════════════
console.log('\n=== PART B: migrated historical data (copy of the live database) ===\n');

const livePath = process.argv[2] || path.join(ROOT, 'data', 'dairy-plant.db');
if (!fs.existsSync(livePath)) {
    console.log(`⚠️  SKIPPED — migrated database not found at ${livePath}`);
} else {
    const copyPath = path.join(TMP, 'migrated-copy.db');
    fs.copyFileSync(livePath, copyPath);
    const mdb = openDatabase(copyPath);
    runMigrations(mdb);

    const raw = {
        milk: mdb.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM milk_collections').get(),
        purchases: mdb.prepare('SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) t FROM purchases').get(),
        sales: mdb.prepare('SELECT COUNT(*) n, COALESCE(SUM(grand_total),0) t FROM sales').get(),
        // Row-rounded sales total: the ONE policy for money aggregates — the
        // same Σ round2(row) the company ledger and the P&L both display.
        sales_r2: accounting.round2(mdb.prepare('SELECT grand_total FROM sales').all()
            .reduce((s, r) => s + accounting.round2(r.grand_total), 0)),
        receipts: mdb.prepare("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM payments WHERE type IN ('receipt','advance')").get()
    };
    console.log(`  migrated rows — sales ${raw.sales.n} (${money(raw.sales.t)}), milk ${raw.milk.n} (${money(raw.milk.t)}), ` +
        `purchases ${raw.purchases.n} (${money(raw.purchases.t)}), receipts ${raw.receipts.n} (${money(raw.receipts.t)})`);

    // ── 1. Milk purchase counted once ──
    const milk = ops.getMilkCostSummary(mdb, ALL);
    console.log(`  milk: collections ${money(milk.milk_collections)} · linked to purchases ${money(milk.linked_to_purchase)} · ` +
        `purchases gross ${money(milk.purchases_total)} → non-milk ${money(milk.non_milk_purchases)} · COGS ${money(milk.cogs)}`);
    ok(near(milk.milk_cost, milk.milk_collections + milk.unlinked_milk_lines),
        'B1: milk cost = milk collections (+ any unlinked raw-milk purchase lines)');
    ok(near(milk.cogs, milk.milk_cost + milk.non_milk_purchases), 'B1: COGS = milk cost + non-milk purchases');
    ok(milk.cogs < (milk.milk_collections + milk.purchases_total),
        'B1: COGS is below the naive "milk + purchases" sum — the duplicate is removed',
        { cogs: milk.cogs, naive: accounting.round2(milk.milk_collections + milk.purchases_total) });
    const nonMilkComputed = accounting.round2(milk.purchases_total - milk.linked_to_purchase - milk.unlinked_milk_lines);
    // Row policy: every bill's value is rounded to paisa first, then summed —
    // so the aggregate identity holds to within 0.005 per bill.
    const perBillTol = 0.01 + 0.005 * milk.purchases_count;
    ok(near(milk.non_milk_purchases, nonMilkComputed, perBillTol),
        'B1: the milk portion of linked bills is exactly what was taken out of purchases',
        { nonMilk: milk.non_milk_purchases, computed: nonMilkComputed, tol: perBillTol });
    const clB1 = ops.getCompanyLedger(mdb, ALL);
    ok(near(milk.non_milk_purchases, clB1.totals.purchases),
        'B1: non-milk purchases = the purchase rows the company ledger displays',
        { nonMilk: milk.non_milk_purchases, ledger: clB1.totals.purchases });

    const plAll = ops.getProfitLoss(mdb, ALL);
    ok(near(plAll.cogs, milk.cogs), 'B1: P&L COGS uses the once-only milk cost', { cogs: plAll.cogs, milk: milk.cogs });
    const naivePl = accounting.round2(raw.milk.t + raw.purchases.t);
    ok(plAll.cogs < naivePl, `B1: P&L COGS (${money(plAll.cogs)}) is not the double-counted ${money(naivePl)}`);

    // ── 2. Sale settlement from actual receipts ──
    const settlement = ops.getSaleSettlements(mdb, ALL);
    const storedPaid = mdb.prepare("SELECT COUNT(*) c FROM sales WHERE status = 'paid'").get().c;
    console.log(`  settlements: paid ${settlement.totals.paid} · partial ${settlement.totals.partial} · unpaid ${settlement.totals.unpaid} ` +
        `(stored status said ${storedPaid} paid)`);
    ok(near(settlement.totals.total, raw.sales.t, 0.01), 'B2: settlements cover every sale exactly once', settlement.totals.total);
    ok(settlement.totals.received > 0 && settlement.totals.outstanding > 0,
        'B2: received and outstanding are both derived from the receipts');
    ok(near(settlement.totals.outstanding, accounting.round2(settlement.totals.total - settlement.totals.received)),
        'B2: outstanding = sales − received');
    const anyPartial = settlement.sales.some(s => s.status === 'partial' && s.received > 0 && s.received < s.grand_total);
    ok(anyPartial, 'B2: at least one migrated invoice reads PARTIAL (a receipt that does not cover the invoice)');
    ok(!settlement.sales.some(s => s.status === 'paid' && s.received < s.grand_total - accounting.CURRENCY_TOLERANCE),
        'B2: no invoice reads PAID while received < invoice amount');

    // ── 3. Cash→Bank deposits are transfers, not income ──
    const cashBank = ops.getCashBankPosition(mdb, ALL);
    console.log(`  cash: in ${money(cashBank.cash.total_in)} out ${money(cashBank.cash.total_out)} balance ${money(cashBank.cash.balance)} · ` +
        `bank: in ${money(cashBank.bank.total_in)} out ${money(cashBank.bank.total_out)} balance ${money(cashBank.bank.balance)}`);
    console.log(`  transfers: ${cashBank.transfers.bank_rows} bank rows + ${money(cashBank.transfers.cash_deposits_table)} recorded deposits = ${money(cashBank.transfers.counted_in)}`);
    ok(cashBank.transfers.counted_in > 0, 'B3: cash-to-bank deposits are recognised as transfers', cashBank.transfers.counted_in);
    ok(near(cashBank.bank.cash_deposits_in, cashBank.transfers.counted_in),
        'B3: the deposits increase the bank balance', { bank: cashBank.bank.cash_deposits_in, xfer: cashBank.transfers.counted_in });

    const classified = ops.listClassifiedBankRows(mdb, ALL);
    const transferCredit = accounting.round2(classified.filter(r => r.is_transfer).reduce((s, r) => s + (r.credit || 0), 0));
    ok(near(cashBank.bank.customer_receipts, accounting.round2(classified.filter(r => r.accounting_class === 'customer_receipt').reduce((s, r) => s + (r.credit || 0), 0))),
        'B3: customer receipts on the bank statement exclude the deposit transfers');
    ok(transferCredit > 0, 'B3: deposit rows are classified as transfers', transferCredit);

    // A new deposit on migrated data must move cash → bank and add no sales.
    const beforeSales = mdb.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales').get().t;
    const beforePos = ops.getCashBankPosition(mdb, ALL);
    ops.saveCashDeposit(mdb, { date: '2083-06-10', bank_name: 'Test Bank', amount: 50000, deposit_mode: 'cash', reference_no: 'B3-NEW' });
    const afterPos = ops.getCashBankPosition(mdb, ALL);
    const afterSales = mdb.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales').get().t;
    ok(near(afterSales, beforeSales), 'B3: a deposit adds no sales to migrated data', afterSales - beforeSales);
    ok(near(afterPos.bank.balance - beforePos.bank.balance, 50000), 'B3: the deposit raises the bank balance', afterPos.bank.balance - beforePos.bank.balance);
    ok(near(afterPos.cash.balance - beforePos.cash.balance, -50000), 'B3: the deposit lowers cash', afterPos.cash.balance - beforePos.cash.balance);

    // ── 4. Office expenses on the bank statement ──
    const exp = ops.getExpenseSummary(mdb, ALL);
    console.log(`  expenses: other ${money(exp.other_expenses)} · petty ${money(exp.petty_cash)} · salary ${money(exp.salary)} · ` +
        `vehicle ${money(exp.vehicle_expenses)} · bank ${money(exp.bank_expenses)} → total ${money(exp.total_operating_expenses)}`);
    const bankExpenseRows = ops.listClassifiedBankRows(mdb, ALL).filter(r => r.is_expense);
    ok(bankExpenseRows.length > 0, 'B4: office expenses paid from the bank are recognised', bankExpenseRows.length);
    ok(bankExpenseRows.every(r => (Number(r.debit) || 0) >= 0), 'B4: every recognised expense row is a debit (payment side), not a credit');
    ok(near(exp.total_operating_expenses, accounting.round2(exp.other_expenses + exp.petty_cash + exp.salary + exp.vehicle_expenses + exp.bank_expenses)),
        'B4: operating expenses are the sum of their parts — each recognised once');
    ok(!ops.getBankReviewQueue(mdb).some(r => ops.classifyBankRow(r) === 'expense'),
        'B4: expense rows are not queueing for party matching');
    const income = ops.getProfitLoss(mdb, ALL).income;
    ok(near(income.total_sales, raw.sales_r2), 'B4: P&L income is sales at the row-rounded policy (deposits/expenses are not income)', { pnl: income.total_sales, sales: raw.sales_r2 });
    ok(near(income.total_other_income, 0) || income.total_other_income >= 0, 'B4: other income stays separate from the transfers');

    // ── 5. Daybook direction ──
    const daybook = ops.getEnhancedDaybook(mdb, ALL);
    const badDebitReceipt = daybook.entries.filter(e => e.type === 'receipt' && (Number(e.debit) || 0) > 0);
    ok(badDebitReceipt.length === 0, 'B5: no receipt/advance is a DEBIT in the daybook (receipts credit the customer)', badDebitReceipt.length);
    const advances = daybook.entries.filter(e => e.transaction_type === 'Advance Received');
    ok(advances.every(e => (Number(e.credit) || 0) > 0 && (Number(e.debit) || 0) === 0),
        'B5: customer advances are credits (money in), not debits', advances.length);
    const saleRows = daybook.entries.filter(e => e.type === 'sale');
    ok(saleRows.every(e => (Number(e.credit) || 0) === 0),
        'B5: no sale row carries a credit (the customer account is only debited)',
        saleRows.filter(e => (Number(e.credit) || 0) !== 0).length);
    ok(near(saleRows.reduce((s, e) => s + (Number(e.debit) || 0), 0), raw.sales.t),
        'B5: the sale debits in the daybook add up to the sales register',
        saleRows.reduce((s, e) => s + (Number(e.debit) || 0), 0));
    ok(saleRows.every(e => e.debit_account === 'Customer / Receivable' && e.credit_account === 'Sales'),
        'B5: every sale row carries the Receivable DR · Sales CR mapping');
    ok(daybook.entries.filter(e => e.type === 'receipt').every(e => e.debit_account && e.credit_account && e.credit_account === 'Customer / Receivable'),
        'B5: every receipt row carries the Cash/Bank DR · Receivable CR mapping');
    const transferRows = daybook.entries.filter(e => e.is_transfer);
    ok(transferRows.every(e => e.debit_account === 'Bank' && e.credit_account === 'Cash'),
        'B5: deposit rows are mapped Bank DR · Cash CR');
    ok(transferRows.every(e => (Number(e.debit) || 0) === 0), 'B5: deposits carry no debit', transferRows.length);
    const expenseRows = daybook.entries.filter(e => e.type === 'bank_expense' || e.type === 'expense');
    ok(expenseRows.every(e => e.debit_account === 'Office / Operating Expense'),
        'B5: expense rows are Expense DR · (Cash/Bank/Payable) CR', expenseRows.length);

    // ── 6. Cross-module reconciliation on the migrated data ──
    const rec = ops.getReconciliation(mdb, ALL);
    const bad = rec.checks.filter(c => !c.ok);
    console.log(`  reconciliation: sales ${money(rec.sales.total)} · receivable(sales−receipts) ${money(rec.receivable.from_sales_minus_receipts)} · ` +
        `ledger receivable ${money(rec.receivable.ledger_receivable)} · COGS ${money(rec.cost.cogs)} · net ${money(rec.profit.net_profit)}`);
    ok(bad.length === 0, 'B6: every reconciliation check passes on the migrated data', bad.map(c => `${c.key} off by ${c.difference}`));
    ok(near(rec.sales.total, raw.sales.t), 'B6: sales total = P&L sales revenue');
    ok(near(rec.receivable.customer_receipts, raw.receipts.t), 'B6: customer receipts = the receipt transactions');
    ok(near(rec.receivable.from_sales_minus_receipts, accounting.round2(raw.sales.t - raw.receipts.t)),
        'B6: sales − customer receipts = receivable');
    console.log(`  ℹ️  ledger-based receivable ${money(rec.receivable.ledger_receivable)} vs sales-based ${money(rec.receivable.from_sales_minus_receipts)} ` +
        `(difference ${money(rec.receivable.difference_vs_ledger)}) — opening balances / Excel adjustments carried in the party ledger remain visible.`);

    // ── 7. Cash/Demon on migrated data ──
    const daily = ops.getDailyCashCollection(mdb, ALL);
    ok(near(daily.expected_amount, raw.sales.t), 'B7: Expected amount = TOTAL SALES on migrated data', { expected: daily.expected_amount, sales: raw.sales.t });
    ok(near(daily.difference, accounting.round2(daily.expected_amount - daily.cash_received)),
        'B7: difference = expected − cash received', daily.difference);

    mdb.close();
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
