#!/usr/bin/env node
/**
 * ERP ACCEPTANCE TESTS — requirement #38 (NEW behavior only)
 * =========================================================
 *  T1  Historical bank range + shared date-preset layer (req 4/13/14/15/33)
 *  T2  Cash deposit from a bank transaction: link + NO extra income (req 18/19)
 *  T3  Duplicate bank transaction: importing the same file twice = 1 row (req 20)
 *  T4  Advance period filter with correct outstanding (req 16/17)
 *  T5  Factory stock flow sequence: opening → morning sale → collection →
 *      production → closing, in real entry order (req 1/5/8/9/11)
 *  T6  Stock period identity Opening + IN − OUT = Closing, agreeing with the
 *      authoritative stock engine (req 2/6/7)
 *  T7  Reconciliation: sub-paisa milk rows reconcile EXACTLY (req 21–26)
 *  T8  Gross Margin/L: correct formula + honest COGS-availability flag (req 27–30)
 *  T9  Petty normalization: Collection-sheet petty-box mirror rows skipped,
 *      OFFICE EXPENSES vouchers imported with head=description, Migration 29
 *      voids only zero-value placeholders (D13/D14/D8, req 45/47)
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase, openDatabase, runMigrations } = require(path.join(ROOT, 'shared', 'db'));
const ops = require(path.join(ROOT, 'shared', 'operations'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting'));
const bankOps = require(path.join(ROOT, 'shared', 'operations', 'bank'));
const dairy = require(path.join(ROOT, 'shared', 'operations', 'dairy_costing'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}
function freshDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-acc-'));
    // initDatabase = schema.sql + migrations (the same bootstrap the app uses).
    return initDatabase(dir, 'test.db');
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — Historical bank range + shared date-preset layer');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    bankOps.listBankTransactions(db, {}); // ensure table
    const ins = db.prepare(
        'INSERT INTO bank_transactions (date, reference_no, description, debit, credit, amount) VALUES (?, ?, ?, ?, ?, ?)'
    );
    ins.run('2083-01-10', 'R-OLD', 'old january row', 0, 1000, 1000);
    ins.run('2083-05-20', 'R-MID', 'mid row', 0, 2000, 2000);
    ins.run('2083-06-15', 'R-NEW', 'new row', 0, 3000, 3000);

    const rRange = bankOps.listBankTransactions(db, { from_date: '2083-03-01', to_date: '2083-05-31' });
    ok(rRange.length === 1 && rRange[0].reference_no === 'R-MID',
        'a 90-day-style range returns rows older than the current month — and only the range', rRange.map(r => r.reference_no));
    const rWide = bankOps.listBankTransactions(db, { from_date: '2083-03-01', to_date: '2083-06-30' });
    ok(rWide.length === 2 && !rWide.some(r => r.reference_no === 'R-OLD'),
        'the wide custom range includes May+June and excludes January', rWide.map(r => r.reference_no));

    const rCustom = bankOps.listBankTransactions(db, { from_date: '2083-01-10', to_date: '2083-01-10' });
    ok(rCustom.length === 1 && rCustom[0].reference_no === 'R-OLD',
        'custom exact-date range returns exactly that period', rCustom.map(r => r.reference_no));

    const rAll = bankOps.listBankTransactions(db, { from_date: '', to_date: '' });
    ok(rAll.length === 3, 'empty range (the All preset) returns every row', rAll.length);
    db.close();
}
{
    // The renderer date layer, loaded exactly as the UI loads it.
    const elements = {};
    const sandbox = {
        console,
        window: {},
        document: {
            addEventListener: () => {},
            getElementById: (id) => (elements[id] = elements[id] || { value: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
            createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {}, remove() {} }),
            querySelectorAll: () => [],
            querySelector: () => null,
            body: { style: {} }
        },
        MutationObserver: class { observe() {} disconnect() {} },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
        navigator: { language: 'en' },
        localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer/js/nepali-date.js'), 'utf8'), sandbox, { filename: 'nepali-date.js' });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'renderer/js/utils.js'), 'utf8'), sandbox, { filename: 'utils.js' });

    const gp = sandbox.getDatePreset;
    const t = gp('today');
    ok(!!t.from && t.from === t.to, 'preset: today', t);
    const y = gp('yesterday');
    ok(y.from === y.to && !!y.to && y.to < t.to, 'preset: yesterday is a day before today', y);
    const l7 = gp('last_7');
    ok(l7.to === t.to && l7.from === sandbox.bsSubtractDays(t.to, 6), 'preset: last 7 = today−6 … today (inclusive)', l7);
    const l90 = gp('last_90');
    ok(l90.to === t.to && l90.from === sandbox.bsSubtractDays(t.to, 89), 'preset: last 90 = today−89 … today (inclusive)', l90);
    ok(l90.from < l7.from, 'last_90 reaches further back than last_7', { l90, l7 });
    const all = gp('all');
    ok(all.from === '' && all.to === '', 'preset: all = fully open range', all);
    const tm = gp('this_month');
    ok(/-01$/.test(tm.from) && tm.to === t.to, 'preset: this month starts on the 1st', tm);
    const lm = gp('last_month');
    ok(lm.from.endsWith('-01') && lm.to < tm.from, 'preset: previous month is a closed range before this month', lm);

    const bankBar = sandbox.datePresetBar('f', 't', 'refreshBank',
        ['today', 'yesterday', 'last_7', 'last_30', 'last_90', 'this_month', 'last_month', 'this_year', 'all']);
    ok(bankBar.includes('Last 90') && bankBar.includes('All') && bankBar.includes('Yesterday') && bankBar.includes('Prev Month'),
        'bank preset bar exposes all history presets from req #14');
    const stockBar = sandbox.datePresetBar('f', 't', 'showStockStatement',
        ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year', 'all']);
    ok(stockBar.includes('This Week') && stockBar.includes('All'), 'stock-statement preset bar matches req #4');

    let refreshed = 0;
    sandbox.window.refreshBank = () => { refreshed++; };
    sandbox.applyDatePreset('last_90', 'f', 't', 'refreshBank');
    ok(elements.f.value === l90.from && elements.t.value === l90.to && refreshed === 1,
        'applyDatePreset writes From/To and triggers the screen refresh', { from: elements.f.value, refreshed });
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — Cash deposit from a bank transaction (link, no extra income)');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    const save = bankOps.saveBankTransaction(db, {
        date: '2083-06-10', reference_no: 'CD-777', txn_type: 'CASH DEPOSIT',
        description: 'CASH DEPOSIT', credit: 70000, debit: 0
    });
    ok(save.success !== false && !!save.data, 'bank cash-deposit row saved', save.error);
    const row = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(save.data.id);
    ok(row && row.accounting_class === 'cash_to_bank_transfer', 'classified as cash → bank transfer', row && row.accounting_class);
    ok(row && row.ledger_posted === 1 && row.ledger_entry_id == null,
        'transfer is marked non-party: never posted to the ledger (never income)', row && { posted: row.ledger_posted, entry: row.ledger_entry_id });

    const pnlBefore = ops.getProfitLoss(db, { from_date: '0001-01-01', to_date: '9999-12-31' });
    const dep = ops.saveCashDeposit(db, {
        date: '2083-06-10', bank_name: 'Test Bank', amount: 70000,
        reference_no: 'CD-777', bank_txn_id: row.id
    });
    ok(!!dep.id, 'register deposit saved', dep);
    const depRow = db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(dep.id);
    ok(depRow && depRow.bank_txn_id === row.id, 'deposit PERSISTENTLY links to its bank statement row', depRow && depRow.bank_txn_id);

    const pnlAfter = ops.getProfitLoss(db, { from_date: '0001-01-01', to_date: '9999-12-31' });
    ok(pnlAfter.income.total_income === pnlBefore.income.total_income,
        'the deposit adds NO income and NO sales', { before: pnlBefore.income.total_income, after: pnlAfter.income.total_income });

    const list = ops.listCashDeposits(db, {});
    ok(list.some(d => d.bank_txn_id === row.id), 'register list exposes the bank link for the trace');

    const dep2 = ops.saveCashDeposit(db, { date: '2083-06-11', bank_name: 'X', amount: 100, bank_txn_id: 99999 });
    const dep2Row = db.prepare('SELECT bank_txn_id FROM cash_deposits WHERE id = ?').get(dep2.id);
    ok(dep2Row && dep2Row.bank_txn_id == null, 'unknown bank txn id is never stored as a dangling link', dep2Row);
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — Duplicate bank transaction (same file / same submission twice)');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    const rows = [
        { date: '2083-06-12', reference_no: 'IMP-001', description: 'UPI payment', counterparty_name: 'X', credit: 5000, debit: 0 },
        { date: '2083-06-12', reference_no: '', description: 'identical content row', counterparty_name: 'Y', credit: 100, debit: 0 }
    ];
    const r1 = bankOps.importBankRows(db, rows);
    const countAfterFirst = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
    const r2 = bankOps.importBankRows(db, rows);
    const countAfterSecond = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
    ok(countAfterFirst === 2 && r2.inserted === 0 && countAfterSecond === 2,
        'importing the same transaction file twice inserts NOTHING new (ref + content uid)', { countAfterFirst, secondInserted: r2.inserted });

    const payload = { date: '2083-06-13', reference_no: 'MAN-1', description: 'manual entry', credit: 700, debit: 0 };
    const m1 = bankOps.saveBankTransaction(db, payload);
    const m2 = bankOps.saveBankTransaction(db, payload);
    const countFinal = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
    ok(m1.success !== false && (m2.duplicate === true || m2.success === false) && countFinal === 3,
        'manual double submission (same payload, <10s) yields ONE row', { m2dup: m2.duplicate, countFinal });
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — Advance period filter + outstanding balance');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    const pid = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Advance Party', 'customer')").run().lastInsertRowid);
    const ins = db.prepare(
        "INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, ?, 'advance', ?, ?, ?, 0)"
    );
    ins.run(pid, '2083-04-01', 'Advance given [Advance Receivable] A1', 50000, 0);
    ins.run(pid, '2083-05-15', 'Advance given [Advance Receivable] A2', 30000, 0);
    ins.run(pid, '2083-06-01', 'Advance returned [Advance Receivable]', 0, 10000);

    const full = accounting.getAdvanceRecoveryRegister(db, { as_of: '2083-06-10' });
    ok(full.all_checks_ok === true, 'register-vs-balance checks pass on the full register', full.checks);
    ok(full.summary.total_outstanding === 70000, 'full outstanding = 50k + 30k − 10k', full.summary.total_outstanding);

    const period = accounting.getAdvanceRecoveryRegister(db, { from_date: '2083-05-01', to_date: '2083-06-10' });
    ok(period.filtered === true && period.lots.length === 1 && period.lots[0].date === '2083-05-15',
        'period filter shows only advances GIVEN in the range', period.lots.map(l => l.date));
    // FIFO: the 10k return consumed the OLDEST lot (A1), so A2 stands at 30k.
    ok(period.summary.total_outstanding === 30000,
        'period outstanding is correct against full adjustment history (A2 = 30k)', period.summary.total_outstanding);
    const idSum = accounting.round2(period.summary.advance_given
        - period.summary.returned - period.summary.adjusted - period.summary.total_outstanding);
    ok(Math.abs(idSum) <= 0.005, 'Given = Returned + Adjusted + Outstanding holds on the filtered set', idSum);
    ok(period.all_checks_ok === true, 'engine checks still validated against the FULL register', period.checks);
    ok(period.full_summary.total_outstanding === 70000, 'full summary preserved alongside the filtered view', period.full_summary.total_outstanding);
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — Factory stock flow sequence (opening → sale → collection → production → closing)');
// ════════════════════════════════════════════════════════════
let stockDb = null, stockPid = null;
{
    stockDb = freshDb();
    stockPid = Number(stockDb.prepare(
        "INSERT INTO products (name, category, unit, rate) VALUES ('Raw Milk Flow', 'Milk', 'liter', 60)"
    ).run().lastInsertRowid);
    const ins = stockDb.prepare(
        `INSERT INTO stock_movements (product_id, date, type, reference_type, reference_id,
            inward_qty, outward_qty, balance_after, rate, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    );
    // Yesterday closing = today's opening
    ins.run(stockPid, '2083-06-14', 'opening', '', null, 750, 0, 750, 60, 'Opening balance');
    // Today, morning: sale from YESTERDAY'S stock
    ins.run(stockPid, '2083-06-15', 'sale', '', null, 0, 350, 400, 65, 'Morning sale');
    // Today: fresh collection
    ins.run(stockPid, '2083-06-15', 'milk_collection', 'milk_collection', null, 700, 0, 1100, 60, 'Collection');
    // Today evening: production consumes, then produces
    ins.run(stockPid, '2083-06-15', 'production_input', 'production', 1, 0, 600, 500, 60, 'PB-001 consume');
    ins.run(stockPid, '2083-06-15', 'production_output', 'production', 1, 450, 0, 950, 62, 'PB-001 output');

    const led = dairy.getStockLedger(stockDb, { product_id: stockPid, from_date: '2083-06-15', to_date: '2083-06-15' });
    const L = led.products[0];
    ok(L.opening_qty === 750, "morning sale consumes YESTERDAY's closing (opening = 750)", L.opening_qty);
    const labels = L.rows.map(r => r.label);
    ok(JSON.stringify(labels) === JSON.stringify(['Sales', 'Milk Collection', 'Production Consumption', 'Production Output']),
        'movement sequence preserved in real entry order (date + id)', labels);
    ok(L.rows[0].balance === 400, 'balance after the morning sale = 400 (collection not yet arrived)', L.rows[0].balance);
    ok(L.closing_qty === 950, 'closing = 750 − 350 + 700 − 600 + 450 = 950', L.closing_qty);
    const s = L.summary;
    ok(s.sales_out === 350 && s.collection_in === 700 && s.production_out === 600 && s.production_in === 450,
        'product-summary buckets (req #7) match the movements exactly', s);
    ok(Math.abs((s.opening + s.total_in - s.total_out) - s.closing) < 0.005,
        'Opening + IN − OUT = Closing for the period', { o: s.opening, i: s.total_in, x: s.total_out, c: s.closing });
    ok(L.rows.every(r => !!r.time), 'every movement carries its stored timestamp (never invented)', L.rows.map(r => r.time));
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 6 — Stock date range agrees with the authoritative stock engine');
// ════════════════════════════════════════════════════════════
{
    const db = stockDb;
    // Multi-day period identity
    const period = dairy.getStockLedger(db, { product_id: stockPid, from_date: '2083-06-01', to_date: '2083-06-30' });
    const P = period.products[0];
    ok(P.opening_qty === 0 && P.closing_qty === 950 && P.rows.length === 5,
        'multi-day period: opening before the range, all movements inside, closing after', { o: P.opening_qty, c: P.closing_qty, rows: P.rows.length });
    ok(Math.abs((P.opening_qty + P.summary.total_in - P.summary.total_out) - P.closing_qty) < 0.005,
        'Opening + all IN − all OUT = Closing (TEST 6 identity)');

    // All Dates: the ledger must equal the stock engine's current balance.
    const all = dairy.getStockLedger(db, { product_id: stockPid, from_date: '', to_date: '' });
    const A = all.products[0];
    const current = require(path.join(ROOT, 'shared', 'operations', 'stock')).getCurrentStock(db, {})
        .find(r => r.id === stockPid);
    ok(current && A.closing_qty === current.current_stock,
        'All-Dates closing agrees with getCurrentStock (the Dairy Costing/stock engine)',
        { ledger: A.closing_qty, engine: current && current.current_stock });
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 7 — Reconciliation: sub-paisa milk rows reconcile EXACTLY');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    const pid = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('S1', 'supplier')").run().lastInsertRowid);
    const ins = db.prepare(
        `INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters, rate, amount, shift, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Sub-paisa amounts exactly like the Excel importer used to write them.
    ins.run('MC-1', '2083-06-01', pid, 'cow', 10, 48.17367, 481.7367, 'morning', 'pending');
    ins.run('MC-2', '2083-06-01', pid, 'cow', 24.4, 48.299, 1178.525, 'evening', 'pending');
    ins.run('MC-3', '2083-06-02', pid, 'cow', 5, 50, 250, 'morning', 'pending');

    const expectedMilk = accounting.round2(
        accounting.round2(481.7367) + accounting.round2(1178.525) + accounting.round2(250));

    const summary = accounting.getMilkCostSummary(db, { from_date: '2083-06-01', to_date: '2083-06-30' });
    ok(summary.milk_cost === expectedMilk,
        'milk cost = Σ round2(row) — ONE row-rounded policy (the authoritative amount)',
        { milk_cost: summary.milk_cost, expected: expectedMilk });

    const ledger = ops.getCompanyLedger(db, { from_date: '2083-06-01', to_date: '2083-06-30' });
    ok(ledger.totals.milk_procurement === summary.milk_cost,
        'company-ledger milk rows = milk cost EXACTLY (no Rs 0.05 gap)',
        { rows: ledger.totals.milk_procurement, summary: summary.milk_cost });

    const failed = ledger.checks.filter(c => !c.ok);
    ok(failed.length === 0, 'ALL reconciliation checks pass (milk / expense / net / income)',
        failed.map(c => `${c.name}: ${c.expected} vs ${c.actual}`));

    const pnl = ops.getProfitLoss(db, { from_date: '2083-06-01', to_date: '2083-06-30' });
    ok(ledger.totals.net === accounting.round2(pnl.net_profit),
        'Net = P&L net profit exactly (TEST 7: traceable, not hidden)',
        { ledger: ledger.totals.net, pnl: pnl.net_profit });
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 8 — Gross Margin/L: correct formula + honest basis flag');
// ════════════════════════════════════════════════════════════
{
    // 8a. With lots: margin must equal the manual calculation.
    const db = freshDb();
    const partyId = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('Cust', 'customer')").run().lastInsertRowid);
    const productId = Number(db.prepare(
        "INSERT INTO products (name, category, unit, rate) VALUES ('Toned Milk', 'Milk', 'liter', 50)"
    ).run().lastInsertRowid);
    const saleDate = '2083-06-10';
    const saleId = Number(db.prepare(
        `INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status)
         VALUES ('INV-1', ?, ?, 500, 0, 0, 0, 500, 0, 'cash', 'unpaid')`
    ).run(saleDate, partyId).lastInsertRowid);
    db.prepare(
        `INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
         VALUES (?, ?, ?, 10, 'liter', 50, 500)`
    ).run(saleId, productId, 'Toned Milk');
    const lotId = Number(db.prepare(
        `INSERT INTO stock_lots (batch_id, product_id, produced_date, quantity, qty_remaining, unit_cost)
         VALUES (NULL, ?, '2083-06-01', 10, 5, 30)`
    ).run(productId).lastInsertRowid);
    db.prepare(
        `INSERT INTO lot_consumptions (lot_type, lot_id, reference_type, reference_id, date, quantity, unit_cost, total_cost)
         VALUES ('stock', ?, 'sale', ?, ?, 5, 30, 150)`
    ).run(lotId, saleId, saleDate);

    const r1 = dairy.getDailySalesRealization(db, { date: saleDate });
    ok(r1.net_sales === 500 && r1.net_liters === 10, 'net milk sales & litres isolated (milk-only lines)', { ns: r1.net_sales, nl: r1.net_liters });
    ok(r1.cogs === 150, 'COGS = FIFO lot consumption of the sale (not today\'s price)', r1.cogs);
    const manual = Math.round(((500 - 150) / 10) * 100) / 100;
    ok(r1.gross_margin_per_liter === manual,
        'Gross Margin/L = (net milk sales − milk COGS) ÷ milk sales litres — manual = application',
        { manual, app: r1.gross_margin_per_liter });
    ok(r1.lot_costing_active === true && r1.cogs_available === true,
        'with lots present the margin is flagged as genuinely costed', { active: r1.lot_costing_active, avail: r1.cogs_available });
    db.close();

    // 8b. Without lots: COGS is structurally 0 → flag MUST be off (UI hides margin).
    const db2 = freshDb();
    const party2 = Number(db2.prepare("INSERT INTO parties (name, type) VALUES ('Cust2', 'customer')").run().lastInsertRowid);
    const prod2 = Number(db2.prepare(
        "INSERT INTO products (name, category, unit, rate) VALUES ('Toned Milk', 'Milk', 'liter', 50)"
    ).run().lastInsertRowid);
    const sale2 = Number(db2.prepare(
        `INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status)
         VALUES ('INV-2', '2083-06-11', ?, 500, 0, 0, 0, 500, 0, 'cash', 'unpaid')`
    ).run(party2).lastInsertRowid);
    db2.prepare(
        `INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
         VALUES (?, ?, ?, 10, 'liter', 50, 500)`
    ).run(sale2, prod2, 'Toned Milk');
    const r2 = dairy.getDailySalesRealization(db2, { date: '2083-06-11' });
    ok(r2.cogs === 0 && r2.lot_costing_active === false && r2.cogs_available === false,
        'without lots: COGS 0 AND basis flag off — UI must hide the margin, not inflate it',
        { cogs: r2.cogs, active: r2.lot_costing_active, avail: r2.cogs_available });
    const cvr = dairy.getDailyMilkCostVsSales(db2, { from_date: '2083-06-11', to_date: '2083-06-11' });
    ok(cvr.lot_costing_active === false, 'period report carries the same honest basis flag', cvr.lot_costing_active);
    db2.close();
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 9 — Petty normalization: no double-counted cash, office rows imported (D13/D14/D8)');
// ════════════════════════════════════════════════════════════
{
    const db = freshDb();
    const xl = require(path.join(ROOT, 'shared', 'excel-import'));
    xl.buildPartyIndex(db); // resolveParty refuses to work without the in-memory index

    // Collection sheet: two petty-box mirror rows + one real customer receipt.
    const coll = [
        ['Title', '', ''],
        ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
        ['2083/04/01', '', '', 'PETTY CASH', '', 'Petty Cash', '', '', '5000', 'Cash', '', ''],
        ['2083/04/02', '', '', 'PETTY CASH', '', 'Advance', '', '', '700', 'Cash', 'BY LILA SIR', ''],
        ['2083/04/03', '', '', 'SOME SHOP', '', 'Collection', '', '1200', '', 'Cash', '', '']
    ];
    const rc = xl.importCollections(db, coll, { log: () => {}, genLedger: true, mode: 'upsert' });
    ok(rc.skipped_petty === 2, 'D13: Collection-sheet petty-box mirror rows are skipped', rc);
    ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE type='payment'").get().c === 0,
        'D13: no phantom "payment to PETTY CASH" double-counting the same cash');
    ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE type='receipt'").get().c === 1,
        'the real customer receipt still imports');

    // PETTY CASH register: office expense with/without description + an advance.
    const pc = [
        ['', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['Date', 'AD Date', 'Receipt No', 'Customer Name', 'Against Bill', 'Description', 'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
        ['2083/04/05', '', '', 'OFFICE EXPENSES', '', 'DISEL', 'OFFICE EXPENSES', '', '', '5000', 'Cash', '', ''],
        ['2083/04/06', '', '', 'OFFICE EXPENSES', '', '', 'OFFICE EXPENSES', '', '', '300', 'Cash', '', ''],
        ['2083/04/07', '', '', 'NAR BAHADUR RANA', '', 'ADVANCE BY LILA SIR', 'Advance', '', '', '1000', 'Cash', '', '']
    ];
    const rp = xl.importPettyCashSheet(db, pc, { log: () => {}, mode: 'upsert' });
    ok(rp.office === 2, 'D14: OFFICE EXPENSES rows are imported (previously dropped)', rp.office);
    ok(rp.advance === 1, 'register advances still import');
    const disel = db.prepare("SELECT * FROM petty_cash WHERE expense_head='DISEL'").get();
    ok(!!disel && disel.amount === 5000 && disel.paid_to === 'OFFICE EXPENSES',
        'D8: office voucher head = the Excel description (real detail), paid_to preserved', disel);
    const blankHead = db.prepare("SELECT expense_head FROM petty_cash WHERE date='2083-04-06'").get();
    ok(blankHead && blankHead.expense_head === 'Payment',
        'blank description falls back to head "Payment" (legacy dedupe key)', blankHead);

    // Migration 29: mirror payments + zero-value ledger placeholders are voided;
    // real (non-zero) ledger rows are never touched.
    const pcParty = Number(db.prepare("INSERT INTO parties (name, type) VALUES ('PETTY CASH', 'customer')").run().lastInsertRowid);
    db.prepare("INSERT INTO payments (party_id, date, type, amount, mode) VALUES (?, '2083-04-01', 'payment', 5000, 'cash')").run(pcParty);
    db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, '2083-04-01', 'payment_received', 'Ledger entry', 0, 0, 0)").run(pcParty);
    db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, '2083-04-02', 'adjustment', 'Real row', 100, 0, 0)").run(pcParty);
    runMigrations(db);
    ok(db.prepare("SELECT COUNT(*) c FROM payments WHERE party_id = ? AND type='payment'").get(pcParty).c === 0,
        'Migration 29 voids the petty-mirror payment');
    const ledLeft = db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE party_id = ?").get(pcParty).c;
    ok(ledLeft === 1, 'Migration 29 removes only zero-value placeholder ledger rows', ledLeft);
    ok(db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE party_id = ? AND debit = 100").get(pcParty).c === 1,
        'a real non-zero ledger row is preserved for manual review');
    db.close();
}

// ════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════════');
console.log(`  ERP acceptance tests: ${pass} passed, ${fail} failed`);
console.log('═══════════════════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);
