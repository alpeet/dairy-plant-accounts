/**
 * test-accounting-dates.js
 * ========================
 * Accepts the accounting-date corrections end to end, on a fresh temp database:
 *
 *   1. Rent for October received in November      → October P&L, November cash
 *   2. Purchase today, two payments later         → one purchase, payable zero
 *   3. Payment through Petty Cash                 → payable down, statement once
 *   4. Payment through the Payment module         → statement + payable update
 *   5. Expense paid to a party                    → recognised once, statement
 *   6. Supplier advance, then applied to a bill   → asset → settlement, no cash
 *   7. Migration: accounting date backfilled, never guessed; dates independent
 *
 * Run: NODE_PATH="$PWD/node_modules" node scripts/audit/test-accounting-dates.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const ops = require(path.join(ROOT, 'shared', 'operations'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-dates-'));
const db = initDatabase(dir, 'test.db');

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail !== undefined ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

// ── Fixtures ────────────────────────────────────────────────────────────
const product = db.prepare("SELECT * FROM products WHERE LOWER(name) NOT LIKE '%milk%' LIMIT 1").get()
    || db.prepare('SELECT * FROM products LIMIT 1').get();

const supplier = ops.saveParty(db, { name: 'ABC Supplier', type: 'supplier', opening_balance: 0 });
const tenant = ops.saveParty(db, { name: 'Tenant Ram', type: 'customer', opening_balance: 0 });

const APR = '2083-07';          // month the rent belongs to
const AUG = '2083-08';          // month the money moved

console.log('\n— 1. Previous-month rent received later —');
{
    const rent = ops.saveOtherExpense(db, {
        date: '2083-08-05',
        accounting_date: '2083-07-28',
        category: 'Income',
        expense_head: 'Rent Received',
        description: 'Rent for Kartik',
        amount: 30000,
        paid_amount: 30000,
        paid_to: tenant ? 'Tenant Ram' : '',
        payment_mode: 'bank',
        reference_no: 'RENT-K7'
    });

    const row = db.prepare('SELECT * FROM other_expenses WHERE id = ?').get(rent.id);
    check('transaction date stored as 2083-08-05', row.date === '2083-08-05', row.date);
    check('accounting date stored as 2083-07-28', row.accounting_date === '2083-07-28', row.accounting_date);
    check('the two dates are independent', row.date !== row.accounting_date);

    const oct = ops.getMonthlyReport(db, { month: APR });
    const octRent = (oct.income_heads || []).find(h => h.head === 'Rent Income');
    check('October (Kartik) P&L recognises Rs 30,000 rent', !!octRent && near(octRent.amount, 30000),
        octRent && octRent.amount);

    const nov = ops.getMonthlyReport(db, { month: AUG });
    const novRent = (nov.income_heads || []).find(h => h.head === 'Rent Income');
    check('November P&L does not recognise the rent again', !novRent || near(novRent.amount, 0),
        novRent && novRent.amount);

    const novCash = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' });
    check('November bank receipts include Rs 30,000', near(novCash.bank.other_income_received, 30000),
        novCash.bank.other_income_received);

    const octCash = ops.getCashBankPosition(db, { from_date: '2083-07-01', to_date: '2083-07-30' });
    check('October bank receipts do not include it', near(octCash.bank.other_income_received, 0),
        octCash.bank.other_income_received);
}

console.log('\n— 2. Purchase today, paid later (50,000 = 30,000 + 20,000) —');
let billId = null;
{
    const bill = ops.savePurchase(db, {
        bill_no: 'PUR-5001',
        date: '2083-08-19',
        accounting_date: '2083-08-19',
        party_id: supplier.id,
        items: [{ product_id: product.id, product_name: product.name, quantity: 10, unit: product.unit || 'kg', rate: 5000, amount: 50000 }],
        subtotal: 50000, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
        grand_total: 50000, paid_amount: 0, payment_mode: 'credit', status: 'unpaid'
    });
    billId = bill.id;

    const p1 = ops.savePayment(db, {
        party_id: supplier.id, date: '2083-08-22', type: 'payment',
        transaction_type: 'settlement', amount: 30000, mode: 'cash',
        reference_type: 'purchase', reference_id: billId, notes: 'part payment'
    });
    check('first payment saved', p1.id > 0);
    let billRow = db.prepare('SELECT paid_amount, status FROM purchases WHERE id = ?').get(billId);
    check('bill shows 30,000 paid / partial', near(billRow.paid_amount, 30000) && billRow.status === 'partial',
        `${billRow.paid_amount} ${billRow.status}`);

    ops.savePayment(db, {
        party_id: supplier.id, date: '2083-08-25', type: 'payment',
        transaction_type: 'settlement', amount: 20000, mode: 'bank',
        reference_type: 'purchase', reference_id: billId, notes: 'final payment'
    });
    billRow = db.prepare('SELECT paid_amount, status, grand_total FROM purchases WHERE id = ?').get(billId);
    check('bill still totals 50,000', near(billRow.grand_total, 50000), billRow.grand_total);
    check('bill fully settled (paid 50,000, status paid)', near(billRow.paid_amount, 50000) && billRow.status === 'paid',
        `${billRow.paid_amount} ${billRow.status}`);

    const stmt = ops.getPartyStatement(db, { party_id: supplier.id, from_date: '2083-07-01', to_date: '2083-08-30' });
    const purchases = stmt.entries.filter(e => e.statement_type === 'purchase');
    check('supplier statement shows the purchase once', purchases.length === 1, purchases.length);
    check('purchase credit is 50,000', near(purchases[0] && purchases[0].credit, 50000));
    const pays = stmt.entries.filter(e => e.statement_type === 'payment');
    check('two payments appear in the statement', pays.length === 2, pays.length);
    check('payments total 50,000', near(pays.reduce((s, e) => s + e.debit, 0), 50000));
    check('supplier closing balance is zero', near(stmt.closing_balance, 0), stmt.closing_balance);

    const aug = ops.getMonthlyReport(db, { month: AUG });
    check('August purchases (COGS) include 50,000 once', near(aug.summary.other_purchases, 50000),
        aug.summary.other_purchases);
    check('the payment is not a second expense', near(aug.summary.net_profit,
        aug.summary.total_income - aug.summary.cogs - aug.summary.operating_expenses));
}

console.log('\n— 3. Payment through Petty Cash —');
{
    const bill = ops.savePurchase(db, {
        bill_no: 'PUR-5002', date: '2083-08-10', accounting_date: '2083-08-10',
        party_id: supplier.id,
        items: [{ product_id: product.id, product_name: product.name, quantity: 2, unit: product.unit || 'kg', rate: 5000, amount: 10000 }],
        subtotal: 10000, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
        grand_total: 10000, paid_amount: 0, payment_mode: 'credit', status: 'unpaid'
    });

    const before = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    const pc = ops.savePettyCash(db, {
        voucher_no: 'PC-9001', date: '2083-08-12', accounting_date: '2083-08-12',
        expense_head: 'Purchase Payment', description: 'Paid ABC Supplier',
        amount: 10000, paid_to: 'ABC Supplier', payment_mode: 'cash'
    });
    const pcRow = db.prepare('SELECT party_id FROM petty_cash WHERE id = ?').get(pc.id);
    check('petty cash voucher linked to the supplier', Number(pcRow.party_id) === Number(supplier.id), pcRow.party_id);

    const after = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    check('petty cash reduces the cash balance by 10,000', near(before - after, 10000), before - after);

    const stmt = ops.getPartyStatement(db, { party_id: supplier.id, from_date: '2083-07-01', to_date: '2083-08-30' });
    const petty = stmt.entries.filter(e => e.source_module === 'Petty Cash');
    check('the payment appears once in the supplier statement', petty.length === 1, petty.length);
    check('it is a debit of 10,000', near(petty[0] && petty[0].debit, 10000));
    check('supplier payable reduced to zero by the petty-cash payment', near(stmt.closing_balance, 0), stmt.closing_balance);
}

console.log('\n— 4. Payment through the Payment module —');
{
    const before = ops.getPartyStatement(db, { party_id: supplier.id }).closing_balance;
    ops.savePayment(db, {
        party_id: supplier.id, date: '2083-08-15', type: 'payment',
        transaction_type: 'settlement', amount: 15000, mode: 'bank', notes: 'supplier payment'
    });
    const stmt = ops.getPartyStatement(db, { party_id: supplier.id });
    // A payment is a debit on a supplier account: it moves the balance 15,000
    // towards receivable (or clears payable).
    check('statement balance moves by exactly 15,000', near(stmt.closing_balance - before, 15000),
        stmt.closing_balance - before);
    check('payment row carries mode/particulars', stmt.entries.some(e =>
        e.statement_type === 'payment' && near(e.debit, 15000) && /supplier payment/.test(e.description || '')));
}

console.log('\n— 5. Expense paid to a party —');
{
    const cashBefore = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    const before = ops.getPartyStatement(db, { party_id: supplier.id }).closing_balance;
    const expensesBefore = ops.getMonthlyReport(db, { month: AUG }).summary.operating_expenses;
    const exp = ops.saveOtherExpense(db, {
        date: '2083-08-16', accounting_date: '2083-08-16', category: 'Office',
        expense_head: 'Stationery', description: 'Office supplies', amount: 5000,
        paid_amount: 5000, paid_to: 'ABC Supplier', payment_mode: 'cash', reference_no: 'EXP-77'
    });
    const row = db.prepare('SELECT * FROM other_expenses WHERE id = ?').get(exp.id);
    check('expense recognised once (5000)', near(row.amount, 5000));
    check('expense fully paid', near(row.paid_amount, 5000) && row.payment_status === 'paid');

    const cashAfter = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    check('cash balance falls by 5,000', near(cashBefore - cashAfter, 5000), cashBefore - cashAfter);

    const stmt = ops.getPartyStatement(db, { party_id: supplier.id, from_date: '2083-07-01', to_date: '2083-08-30' });
    const expRows = stmt.entries.filter(e => e.statement_type === 'expense');
    const expPays = stmt.entries.filter(e => e.statement_type === 'expense_payment');
    check('expense bill appears once', expRows.length === 1 && near(expRows[0].credit, 5000), expRows.length);
    check('its payment appears once', expPays.length === 1 && near(expPays[0].debit, 5000), expPays.length);
    check('party balance unchanged by a paid expense', near(before, stmt.closing_balance),
        `${before} → ${stmt.closing_balance}`);

    const aug = ops.getMonthlyReport(db, { month: AUG });
    check('stationery reaches P&L once (5,000)',
        near(aug.summary.operating_expenses - expensesBefore, 5000),
        `${expensesBefore} → ${aug.summary.operating_expenses}`);
}

console.log('\n— 6. Supplier advance, then applied to a purchase bill —');
{
    const advance = ops.savePayment(db, {
        party_id: supplier.id, date: '2083-08-17', type: 'payment',
        transaction_type: 'advance', amount: 20000, mode: 'cash', notes: 'advance to ABC'
    });
    let stmt = ops.getPartyStatement(db, { party_id: supplier.id, from_date: '2083-07-01', to_date: '2083-08-30' });
    const advRow = stmt.entries.find(e => e.statement_type === 'advance' && near(e.debit, 20000));
    check('advance shown as an advance in the statement', !!advRow);

    const laBefore = ops.getLoanAdvanceBalances(db);
    check('advance is an asset (20,000), not an expense', near(laBefore.advance_receivable, 20000),
        laBefore.advance_receivable);

    const augBefore = ops.getMonthlyReport(db, { month: AUG });
    const expBefore = augBefore.summary.operating_expenses;

    const bill = ops.savePurchase(db, {
        bill_no: 'PUR-5003', date: '2083-08-18', accounting_date: '2083-08-18',
        party_id: supplier.id,
        items: [{ product_id: product.id, product_name: product.name, quantity: 4, unit: product.unit || 'kg', rate: 5000, amount: 20000 }],
        subtotal: 20000, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
        grand_total: 20000, paid_amount: 0, payment_mode: 'credit', status: 'unpaid'
    });

    const cashBefore = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    const alloc = ops.applyAdvanceToPurchase(db, {
        advance_payment_id: advance.id, purchase_id: bill.id, amount: 20000,
        date: '2083-08-20', accounting_date: '2083-08-20', notes: 'advance applied'
    });
    check('allocation recorded', alloc.id > 0 && near(alloc.remaining_advance, 0), alloc.remaining_advance);

    const billRow = db.prepare('SELECT paid_amount, status FROM purchases WHERE id = ?').get(bill.id);
    check('bill settled by the advance (paid 20,000)', near(billRow.paid_amount, 20000) && billRow.status === 'paid',
        `${billRow.paid_amount} ${billRow.status}`);

    const laAfter = ops.getLoanAdvanceBalances(db);
    check('advance balance back to zero', near(laAfter.advance_receivable, 0), laAfter.advance_receivable);

    const cashAfter = ops.getCashBankPosition(db, { from_date: '2083-08-01', to_date: '2083-08-30' }).cash.balance;
    check('adjusting the advance moves no cash', near(cashBefore, cashAfter), `${cashBefore} → ${cashAfter}`);

    stmt = ops.getPartyStatement(db, { party_id: supplier.id, from_date: '2083-07-01', to_date: '2083-08-30' });
    const applied = stmt.entries.filter(e => e.statement_type === 'advance_adjustment');
    check('statement shows the advance application', applied.length >= 1, applied.length);

    const augAfter = ops.getMonthlyReport(db, { month: AUG });
    check('advance adjustment adds no operating expense', near(augAfter.summary.operating_expenses, expBefore),
        `${expBefore} → ${augAfter.summary.operating_expenses}`);
}

console.log('\n— 7. Migration + date independence —');
{
    const p = db.prepare("SELECT id FROM parties WHERE name = 'Tenant Ram'").get();
    const res = db.prepare(`
        INSERT INTO payments (party_id, date, accounting_date, accounting_date_source, type, amount, mode)
        VALUES (?, '2083-08-07', '', '', 'receipt', 100, 'cash')
    `).run(p.id);
    const first = ops.ensureAccountingDates(db);
    const row = db.prepare('SELECT date, accounting_date, accounting_date_source FROM payments WHERE id = ?')
        .get(res.lastInsertRowid);
    check('empty accounting date backfilled from the stored date', row.accounting_date === row.date, row.accounting_date);
    check('migration source recorded as migrated', row.accounting_date_source === 'migrated', row.accounting_date_source);
    check('first run reports the backfill', first.backfilled.payments >= 1, first.backfilled.payments);

    const second = ops.ensureAccountingDates(db);
    check('migration is idempotent (no columns added twice)', second.added_columns.length === 0);
    check('second run backfills nothing', Object.values(second.backfilled).every(n => n === 0));

    const review = ops.getDateReviewReport(db);
    check('review report sees no missing accounting dates',
        Object.values(review.tables).every(t => !t.missing), JSON.stringify(review.totals));

    // Changing the transaction date must not move the accounting date.
    const rent = db.prepare("SELECT * FROM other_expenses WHERE reference_no = 'RENT-K7'").get();
    ops.saveOtherExpense(db, {
        id: rent.id, date: '2083-08-06', accounting_date: rent.accounting_date,
        category: rent.category, expense_head: rent.expense_head, description: rent.description,
        amount: rent.amount, paid_amount: rent.paid_amount, paid_to: rent.paid_to,
        payment_mode: rent.payment_mode, reference_no: rent.reference_no
    });
    const moved = db.prepare('SELECT date, accounting_date FROM other_expenses WHERE id = ?').get(rent.id);
    check('transaction date changed independently', moved.date === '2083-08-06', moved.date);
    check('accounting date stayed in October', moved.accounting_date === '2083-07-28', moved.accounting_date);

    const jul = ops.getMonthlyReport(db, { month: APR });
    const rentHead = (jul.income_heads || []).find(h => h.head === 'Rent Income');
    check('October P&L still carries the rent after the date edit',
        !!rentHead && near(rentHead.amount, 30000), rentHead && rentHead.amount);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
try { db.close(); } catch (e) { /* ignore */ }
process.exit(failed === 0 ? 0 : 1);
