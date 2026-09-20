#!/usr/bin/env node
/**
 * trial-entries.js — one labelled "Trial1" sample entry in every module
 * =====================================================================
 * Creates a single, clearly marked sample transaction in each module so the
 * customer can open every screen and see a real record — then read it back
 * through the app's own report/ledger functions to prove the entry actually
 * landed, moved stock and posted to the ledger.
 *
 *   node scripts/audit/trial-entries.js            # create (verified backup first)
 *   node scripts/audit/trial-entries.js --verify   # read every entry back
 *   node scripts/audit/trial-entries.js --remove   # delete exactly what it created
 *
 * Everything it writes is prefixed TRIAL1- (masters) or notes "Trial1", and the
 * exact ids are recorded in .freebuff/trial-manifest.json so removal is precise.
 * Entries go through the app's own operations, so this also exercises undo:
 * delete paths reverse stock and ledger the same way a real edit would.
 *
 * Env: DB_PATH (default data/dairy-plant.db).
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'dairy-plant.db');
const MANIFEST = path.join(ROOT, '.freebuff', 'trial-manifest.json');

const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const ops = require(path.join(ROOT, 'shared', 'operations'));
const { adToBS } = require(path.join(ROOT, 'shared', 'excel-import'));

const TAG = 'TRIAL1';
const MARK = 'Trial1';
const args = process.argv.slice(2);
const MODE = args.includes('--remove') ? 'remove' : (args.includes('--verify') ? 'verify' : 'create');

const num = (v) => (v === null || v === undefined ? 0 : Number(v));

const out = [];
const say = (s = '') => { console.log(s); out.push(s); };
const hr = (t) => say('\n' + '─'.repeat(72) + '\n  ' + t + '\n' + '─'.repeat(72));

function todayBS() {
    return adToBS(new Date().toISOString().slice(0, 10));
}
function todayAD() {
    return new Date().toISOString().slice(0, 10);
}

function backup(db) {
    const dir = path.join(ROOT, 'data', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `pre-trial1-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    return db.backup(dest).then(() => {
        const size = fs.statSync(dest).size;
        if (size === 0) throw new Error('backup is empty');
        say(`  🔒 Verified backup: ${dest} (${(size / 1024).toFixed(0)} KB)`);
        return dest;
    });
}

// ─────────────────────────────── CREATE ───────────────────────────────

async function create() {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    const bs = todayBS();
    const ad = todayAD();

    say(`  🐄  Prarambha — trial entries ("${MARK}" in every module)`);
    say(`     database : ${DB_PATH}`);
    say(`     date     : AD ${ad}  ·  BS ${bs}`);

    hr('1. BACKUP');
    const backupPath = await backup(db);
    // counts we must return to after --remove
    const TABLES = ['sales', 'sales_items', 'purchases', 'purchase_items', 'payments', 'ledger_entries',
        'stock_movements', 'petty_cash', 'salary_records', 'vehicle_expenses', 'other_expenses',
        'bank_transactions', 'cash_deposits', 'denomination_counts', 'cash_collections',
        'partner_capital', 'production_batches', 'production_inputs', 'production_outputs',
        'milk_collections', 'parties', 'products', 'routes', 'milk_rate_chart', 'audit_log'];
    const before = {};
    for (const t of TABLES) {
        try { before[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch (e) { before[t] = null; }
    }
    // Audit rows written from now on belong to the trial (monotonic id, no timezone games)
    const auditStartId = db.prepare('SELECT COALESCE(MAX(id), 0) m FROM audit_log').get().m;

    const ids = {};
    const made = [];

    hr('2. MASTERS');
    ids.customer = ops.saveParty(db, { name: `${TAG}-BUYER`, type: 'customer', phone: '9800000001', notes: MARK, address: 'Trial address' }).id;
    ids.supplier = ops.saveParty(db, { name: `${TAG}-SUPPLIER`, type: 'supplier', phone: '9800000002', notes: MARK }).id;
    ids.farmer = ops.saveParty(db, { name: `${TAG}-FARMER`, type: 'farmer', phone: '9800000003', notes: MARK }).id;
    ids.partner = ops.saveParty(db, { name: `${TAG}-PARTNER`, type: 'partner', notes: MARK, partner_type: 'active', profit_share_percent: 1 }).id;
    ids.product = ops.saveProduct(db, { name: `${TAG}-ITEM`, unit: 'kg', category: 'Other', opening_stock: 0, reorder_level: 5, rate: 100, notes: MARK }).id;
    ids.route = ops.saveRoute(db, { name: `${TAG}-ROUTE`, area: 'Trial area', assigned_vehicle: `${TAG}-VEHICLE`, assigned_staff: 'Trial staff' }).id;
    ids.rateChart = ops.saveRateChart(db, { effective_from: bs, rate_type: 'formula', fat_multiplier: 7.15, snf_multiplier: 4.55, extra_per_unit: 0, fixed_rate: 0, notes: MARK }).id;
    say(`  ✅ parties (customer ${ids.customer}, supplier ${ids.supplier}, farmer ${ids.farmer}, partner ${ids.partner})`);
    say(`  ✅ product ${ids.product} · route ${ids.route} · rate chart ${ids.rateChart}`);
    made.push(['Masters — add a party/product/route/rate chart', 'Parties, Stock, Routes, Rate Charts']);

    hr('3. TRANSACTIONS');
    // 3.1 Purchase first so there is stock to sell (10 kg @ 80)
    const purch = ops.savePurchase(db, {
        bill_no: `${TAG}-PURCH-1`, date: bs, party_id: ids.supplier,
        items: [{ product_id: ids.product, product_name: `${TAG}-ITEM`, quantity: 10, unit: 'kg', rate: 80, amount: 800 }],
        subtotal: 800, discount: 0, tax: 0, transport_charges: 0, extra_charges: 0,
        grand_total: 800, paid_amount: 0, payment_mode: 'credit', status: 'unpaid', notes: MARK,
    });
    ids.purchase = purch.id;
    say(`  ✅ Purchase   ${TAG}-PURCH-1  ·  10 kg @ 80 = ₹800  (stock in, party payable)`);
    made.push(['Purchase — bill with items, stock in, ledger credit', 'Purchases']);

    // 3.2 Sale of 5 kg @ 100
    const sale = ops.saveSale(db, {
        invoice_no: `${TAG}-SALE-1`, date: bs, party_id: ids.customer,
        items: [{ product_id: ids.product, product_name: `${TAG}-ITEM`, quantity: 5, unit: 'kg', rate: 100, amount: 500 }],
        subtotal: 500, discount: 0, discount_percent: 0, tax: 0, grand_total: 500,
        paid_amount: 200, payment_mode: 'credit', status: 'partial', notes: MARK,
    });
    ids.sale = sale.id;
    say(`  ✅ Sale       ${TAG}-SALE-1   ·  5 kg @ 100 = ₹500 (₹200 paid)  (stock out, party receivable)`);
    made.push(['Sales — invoice with items, stock out, ledger debit', 'Sales / Invoice generator']);

    // 3.3 Milk collection from the trial farmer (20 L)
    const milk = ops.saveMilkCollection(db, {
        collection_no: `${TAG}-MILK-1`, date: bs, party_id: ids.farmer, route_id: ids.route,
        milk_type: 'cow', quantity_liters: 20, fat_percent: 4, snf_percent: 8.5,
        rate: 60, amount: 1200, shift: 'morning', status: 'pending', notes: MARK,
    });
    ids.milk = milk.id || (milk.data && milk.data.id);
    say(`  ✅ Milk       ${TAG}-MILK-1   ·  20 L cow, fat 4 / snf 8.5 @ 60 = ₹1,200  (raw milk stock in, farmer payable)`);
    made.push(['Milk collection — farmer collection, raw milk stock in', 'Milk Collection']);

    // 3.4 Production batch: 5 kg in → 4.5 kg out (90% yield) + 50 g wastage
    const batch = ops.saveProductionBatch(db, {
        batch_no: `${TAG}-BATCH-1`, date: bs, shift: 'morning', process_type: 'Pasteurisation',
        inputs: [{ product_id: ids.product, product_name: `${TAG}-ITEM`, quantity: 5, unit: 'kg', rate: 80 }],
        outputs: [{ product_id: ids.product, product_name: `${TAG}-ITEM`, quantity: 4.5, unit: 'kg', rate: 100 }],
        operator_name: `${TAG}-OPERATOR`, wastage_quantity: 0.5, wastage_reason: MARK, remarks: MARK,
    });
    ids.batch = batch.id || batch;
    say(`  ✅ Production ${TAG}-BATCH-1  ·  5 kg in → 4.5 kg out (yield 90%), 0.5 kg wastage`);
    made.push(['Production — batch card, inputs out / outputs in of stock', 'Production']);

    // 3.5 Petty cash
    ids.petty = ops.savePettyCash(db, {
        voucher_no: `${TAG}-PC-1`, date: bs, expense_head: 'Trial expense', description: MARK,
        amount: 150, paid_to: 'Trial vendor', approved_by: 'Admin', payment_mode: 'cash', remarks: MARK,
    }).id;
    say(`  ✅ Petty cash ${TAG}-PC-1     ·  ₹150 cash expense`);
    made.push(['Petty cash — voucher with expense head', 'Petty Cash']);

    // 3.6 Salary
    ids.salary = ops.saveSalaryRecord(db, {
        // month must be the BS YYYY-MM the Salary screen filters on, otherwise the
        // record exists but is invisible behind the current-month filter.
        employee_name: `${TAG}-EMPLOYEE`, position: 'Helper', month: bs.substring(0, 7),
        basic_salary: 20000, allowance: 2000, advance: 1000, deduction: 500,
        payment_date: bs, payment_mode: 'cash', remarks: MARK,
    }).id;
    say(`  ✅ Salary     ${TAG}-EMPLOYEE ·  20,000 + 2,000 − 1,000 − 500 = ₹20,500 net`);
    made.push(['Salary — monthly salary with advance and deduction', 'Salary']);

    // 3.7 Vehicle expense
    ids.vehicle = ops.saveVehicleExpense(db, {
        date: bs, vehicle_name: `${TAG}-VEHICLE`, driver_name: `${TAG}-DRIVER`, expense_type: 'fuel',
        fuel_amount: 500, repair_amount: 0, maintenance_amount: 0, toll_parking_amount: 0,
        other_amount: 0, remarks: MARK,
    }).id;
    say(`  ✅ Vehicle    ${TAG}-VEHICLE ·  fuel ₹500`);
    made.push(['Vehicle expense — fuel/repair/maintenance/toll', 'Vehicle Expenses']);

    // 3.8 Other expense
    ids.expense = ops.saveOtherExpense(db, {
        date: bs, category: MARK, expense_head: 'Electricity', description: MARK,
        amount: 250, paid_to: 'Trial supplier', payment_mode: 'cash', reference_no: `${TAG}-EXP-1`, remarks: MARK,
    }).id;
    say(`  ✅ Expense    ${TAG}-EXP-1    ·  electricity ₹250 (category "${MARK}")`);
    made.push(['Other expense — category + head', 'Expenses']);

    // 3.9 Bank transaction (money in)
    const bank = ops.saveBankTransaction(db, {
        date: bs, reference_no: `${TAG}-BANK-1`, counterparty_name: `${TAG}-BUYER`, description: MARK,
        credit: 1000, debit: 0, payment_mode: 'QR/Bank', bank_account: `${TAG}-ACCOUNT`,
        txn_type: 'Customer Collection', party_id: ids.customer, remarks: MARK,
    });
    ids.bank = (bank.data && bank.data.id) || bank.id;
    say(`  ✅ Bank       ${TAG}-BANK-1   ·  ₹1,000 received into ${TAG}-ACCOUNT`);
    made.push(['Bank transaction — deposit matched to a party', 'Bank']);

    // 3.10 Cash deposit
    const dep = ops.saveCashDeposit(db, {
        date: bs, bank_name: `${TAG}-BANK`, branch: 'Trial branch', account_no: '0000000000',
        amount: 500, cash_source: 'other', deposit_mode: 'cash', reference_no: `${TAG}-DEP-1`,
        remarks: MARK, deposited_by: `${TAG}-OPERATOR`,
    });
    ids.deposit = dep.id || (dep.data && dep.data.id);
    say(`  ✅ Cash deposit ${TAG}-DEP-1 ·  ₹500 banked`);
    made.push(['Cash deposit — cash taken to the bank', 'Cash Deposit']);

    // 3.11 Cash collection (day cash summary)
    ids.cashCollection = ops.saveCashCollection(db, {
        date: bs, ref_no: `${TAG}-CASH-1`, payment_mode: 'cash', party_id: ids.customer,
        cash_sales: 300, cash_receipts: 200, cash_payments: 50, other_receipts: 0, notes: MARK,
    }).id || null;
    say(`  ✅ Cash collection ${TAG}-CASH-1 ·  sales ₹300, receipts ₹200, payments ₹50`);
    made.push(['Cash collection — day cash summary', 'Cash Collection']);

    // 3.12 Day-close denomination count
    ids.denomination = ops.saveDenomination(db, {
        date: bs, note_1000: 1, note_500: 2, note_100: 3, note_50: 1, note_20: 1, note_10: 1,
        note_5: 1, note_2: 1, note_1: 1, note_other: 0, note_other_value: 0, coin_5: 1, coin_2: 1, coin_1: 1,
        expected_cash: 1000 + 1000 + 300 + 50 + 20 + 10 + 5 + 2 + 1 + 5 + 2 + 1,
        remarks: MARK, counted_by: `${TAG}-OPERATOR`,
    }).id;
    say(`  ✅ Day close  ${TAG}       ·  denomination count, difference ₹0`);
    made.push(['Day close — cash denomination count', 'Cash / Day Book']);

    // 3.13 Payment received from the trial customer
    ids.receipt = ops.savePayment(db, {
        party_id: ids.customer, date: bs, type: 'receipt', amount: 300, mode: 'cash',
        reference_type: `${TAG}-RCPT-1`, reference_id: null, notes: MARK,
    }).id;
    say(`  ✅ Receipt    ${TAG}-RCPT-1   ·  ₹300 received from ${TAG}-BUYER (ledger credit)`);
    made.push(['Payment/receipt — money received against a party', 'Receivable / Payable']);

    // 3.14 Partner capital
    ids.capital = ops.savePartnerCapital(db, {
        party_id: ids.partner, date: bs, type: 'contribution', amount: 5000, mode: 'bank',
        reference_no: `${TAG}-CAP-1`, notes: MARK,
    }).id;
    say(`  ✅ Capital    ${TAG}-CAP-1    ·  partner contributed ₹5,000`);
    made.push(['Partner capital — contribution / drawing', 'Partner Capital']);

    // 3.15 Stock adjustment (+2 kg)
    ops.adjustStock(db, { product_id: ids.product, date: bs, quantity: 2, rate: 100, notes: `${MARK} stock adjustment` });
    ids.adjustment = db.prepare("SELECT id FROM stock_movements WHERE product_id = ? AND type = 'adjustment' AND notes = ? ORDER BY id DESC LIMIT 1")
        .get(ids.product, `${MARK} stock adjustment`).id;
    say(`  ✅ Stock adj  ${TAG}       ·  +2 kg adjustment on ${TAG}-ITEM`);
    made.push(['Stock adjustment — manual correction', 'Stock']);

    hr('4. WHAT WAS CREATED');
    say('  entry                                              where to look');
    for (const [what, where] of made) say('  ' + what.padEnd(50) + where);

    const manifest = { createdAt: new Date().toISOString(), bsDate: bs, adDate: ad, ids, before, auditStartId, backupPath, dbPath: DB_PATH };
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
    say(`\n  📄 Manifest (ids for removal): ${MANIFEST}`);
    say(`  🧹 To undo everything: node scripts/audit/trial-entries.js --remove`);

    db.close();
    return manifest;
}

// ─────────────────────────────── VERIFY ───────────────────────────────

function verify() {
    const db = new Database(DB_PATH, { readonly: true });
    const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const { ids, bsDate: bs } = man;
    let pass = 0, fail = 0;
    const check = (label, ok, detail) => {
        if (ok) pass++; else fail++;
        say(`  ${ok ? '✅' : '❌'} ${label}${detail ? ' — ' + detail : ''}`);
    };

    say(`  🐄  Prarambha — verifying the "${MARK}" entries (BS ${bs})`);

    hr('TRANSACTIONS');
    const salesReg = ops.getSalesRegister(db, { from_date: bs, to_date: bs });
    check('Sales register lists TRIAL1-SALE-1',
        (salesReg.sales || []).some((r) => String(r.invoice_no).startsWith(TAG)),
        `${salesReg.count} sale(s) today, total ${salesReg.total}`);
    const purchReg = ops.getPurchaseRegister(db, { from_date: bs, to_date: bs });
    check('Purchase register lists TRIAL1-PURCH-1',
        (purchReg.purchases || []).some((r) => String(r.bill_no).startsWith(TAG)),
        `${purchReg.count} purchase(s) today, total ${purchReg.total}`);
    check('Milk collection listed', !!db.prepare('SELECT 1 FROM milk_collections WHERE id=?').get(ids.milk));
    check('Production batch listed', !!db.prepare('SELECT 1 FROM production_batches WHERE id=?').get(ids.batch));
    check('Petty cash voucher listed', !!db.prepare('SELECT 1 FROM petty_cash WHERE id=?').get(ids.petty));
    check('Salary record listed', !!db.prepare('SELECT 1 FROM salary_records WHERE id=?').get(ids.salary));
    check('Vehicle expense listed', !!db.prepare('SELECT 1 FROM vehicle_expenses WHERE id=?').get(ids.vehicle));
    check('Other expense listed', !!db.prepare('SELECT 1 FROM other_expenses WHERE id=?').get(ids.expense));
    check('Bank transaction listed', !!db.prepare('SELECT 1 FROM bank_transactions WHERE id=?').get(ids.bank));
    check('Cash deposit listed', !!db.prepare('SELECT 1 FROM cash_deposits WHERE id=?').get(ids.deposit));
    check('Cash collection listed', !!db.prepare('SELECT 1 FROM cash_collections WHERE id=?').get(ids.cashCollection));
    check('Day-close denomination listed', !!db.prepare('SELECT 1 FROM denomination_counts WHERE id=?').get(ids.denomination));
    check('Payment receipt listed', !!db.prepare('SELECT 1 FROM payments WHERE id=?').get(ids.receipt));
    check('Partner capital listed', !!db.prepare('SELECT 1 FROM partner_capital WHERE id=?').get(ids.capital));

    hr('REPORTS THE CUSTOMER READS');
    const daybook = ops.getDaybook(db, { from_date: bs, to_date: bs });
    const daybookText = JSON.stringify(daybook);
    check('Day book shows today\'s trial vouchers',
        daybookText.includes(TAG) || daybookText.includes(`${MARK}`),
        `${(daybook.entries || []).length} entr(y/ies) · sales ${daybook.totalSales} · purchases ${daybook.totalPurchases} · payments ${daybook.totalPayments}`);
    const pl = ops.getProfitLoss(db, { from_date: bs, to_date: bs });
    check('Profit & loss picks up the trial sale and expenses',
        num(pl.income.total_income) >= 500 && num(pl.expenses.total_expenses) >= 250,
        `income ${pl.income.total_income} (sales ${pl.income.total_sales}) · expenses ${pl.expenses.total_expenses} ` +
        `(milk ${pl.expenses.milk_collection.total}, purchases ${pl.expenses.purchases.total}, salary ${pl.expenses.salary.total}, ` +
        `petty ${pl.expenses.petty_cash.total}, vehicle ${pl.expenses.vehicle_expenses.total}, other ${pl.expenses.other_expenses.total}) · net ${pl.net_profit}`);
    const recvRows = ops.getReceivables(db, {});
    const buyer = recvRows.find((r) => r.name === `${TAG}-BUYER`);
    check('Receivable shows the trial buyer\'s outstanding',
        !!buyer, buyer ? `name=${buyer.name} outstanding=₹${buyer.outstanding} (sale 500 − paid 200 − receipt 300)` : `${recvRows.length} party row(s), buyer missing`);
    const payRows = ops.getPayables(db, {});
    check('Payable report shows the unpaid trial purchase',
        payRows.some((r) => r.name === `${TAG}-SUPPLIER`),
        `${payRows.length} payable row(s) — the report is built from unpaid PURCHASE bills only`);
    // Informational: an unpaid milk collection is a payable too, but the generic
    // Payables report only reads purchase bills, so farmers live on their own screen.
    const farmers = ops.getFarmerOutstanding(db, {});
    const farmerRows = farmers.farmers || farmers.rows || (Array.isArray(farmers) ? farmers : []);
    const trialFarmer = farmerRows.find((r) => String(r.name || r.farmer_name || '').startsWith(TAG));
    say(`  ℹ️  unpaid milk is NOT in the Payables report (purchases only) — it appears under ` +
        `Farmer Payments${trialFarmer ? ` as ₹${trialFarmer.outstanding ?? trialFarmer.balance ?? trialFarmer.due}` : ''}`);
    const stmt = ops.getPartyStatement(db, { party_id: ids.customer, from_date: '2080-01-01', to_date: '2090-12-30' });
    check('Party statement shows sale + receipt for the trial buyer',
        (stmt.entries || []).length >= 2,
        `${(stmt.entries || []).length} ledger row(s) · debit ${stmt.total_debit} · credit ${stmt.total_credit} · closing ${stmt.closing_balance}`);
    const stockStatement = ops.getStockStatement(db, {});
    check('Stock statement includes TRIAL1-ITEM',
        (stockStatement.items || []).some((i) => String(i.name).startsWith(TAG)),
        `${stockStatement.total_products} product(s), value ₹${stockStatement.total_value}`);
    const milk = ops.getMilkSummary(db, { from_date: bs, to_date: bs });
    check('Milk summary counts the trial collection', num(milk.todayTotal.total_liters) >= 20,
        `${milk.todayTotal.total_liters} L / ₹${milk.todayTotal.total_amount} in ${milk.todayTotal.collection_count} collection(s); by type: ` +
        (milk.typeBreakdown || []).map((t) => `${t.milk_type} ${t.liters} L`).join(', '));
    check('Petty cash summary includes the trial voucher',
        num(ops.getPettyCashSummary(db, { from_date: bs, to_date: bs }).total) >= 150,
        `total ₹${ops.getPettyCashSummary(db, { from_date: bs, to_date: bs }).total}`);
    const sal = ops.getSalarySummary(db, { from_date: bs, to_date: bs });
    check('Salary summary includes the trial salary', num(sal.total) >= 20500, `net total ₹${sal.total}`);
    const veh = ops.getVehicleExpensesSummary(db, { from_date: bs, to_date: bs });
    check('Vehicle summary includes the trial fuel', num(veh.total_fuel) >= 500, `fuel ₹${veh.total_fuel}`);
    const exp = ops.getExpensesSummary(db, { from_date: bs, to_date: bs });
    check('Expense summary includes the trial expense', num(exp.total) >= 250, `total ₹${exp.total} across ${exp.count} entr(y/ies)`);
    const dep = ops.getCashDepositSummary(db, { from_date: bs, to_date: bs });
    check('Cash deposit summary includes the trial deposit', num(dep.total_deposited) >= 500, `deposited ₹${dep.total_deposited}`);
    check('Dashboard renders with the new stock', !!ops.getDashboard(db));
    const integrity = ops.runIntegrityChecks(db);
    check('Integrity doctor still runs after the trial entries', !!integrity && !!integrity.checks,
        integrity && integrity.summary ? `${integrity.summary.checks_failed} check(s) failing` : '');

    hr('STOCK AND LEDGER EFFECT');
    const bal = db.prepare('SELECT COALESCE(SUM(inward_qty - outward_qty), 0) v FROM stock_movements WHERE product_id = ?').get(ids.product).v;
    check('TRIAL1-ITEM balance = 10 (purch) − 5 (sale) − 5 (batch in) + 4.5 (batch out) + 2 (adj) = 6.5', Math.abs(bal - 6.5) < 0.001, `found ${bal}`);
    const ledgerRows = db.prepare('SELECT COUNT(*) c FROM ledger_entries WHERE party_id IN (?,?,?)').get(ids.customer, ids.supplier, ids.farmer).c;
    check('Ledger rows posted for the trial parties', ledgerRows >= 4, `${ledgerRows} row(s)`);
    const auditRows = db.prepare('SELECT table_name, action FROM audit_log WHERE id > ?').all(man.auditStartId);
    check('Audit log captured the trial changes', auditRows.length > 0, `${auditRows.length} audit row(s)`);

    hr('AUDIT TRAIL COVERAGE — WHAT THE TRIAL ENTRIES PROVED');
    const logged = {};
    for (const r of auditRows) {
        logged[r.table_name] = logged[r.table_name] || { create: 0, update: 0, delete: 0 };
        logged[r.table_name][r.action] = (logged[r.table_name][r.action] || 0) + 1;
    }
    const EXPECT = [
        ['sales', 'Sales invoice'], ['purchases', 'Purchase bill'], ['milk_collections', 'Milk collection'],
        ['production_batches', 'Production batch'], ['petty_cash', 'Petty cash voucher'],
        ['salary_records', 'Salary record'], ['vehicle_expenses', 'Vehicle expense'],
        ['other_expenses', 'Other expense'], ['payments', 'Payment / receipt'],
        ['bank_transactions', 'Bank transaction'], ['cash_deposits', 'Cash deposit'],
        ['denomination_counts', 'Day-close cash count'], ['partner_capital', 'Partner capital'],
    ];
    // Creates and deletes are counted separately: a delete row can only exist once
    // something has actually been deleted, so "no delete row" on a fresh create is
    // information, not a failure of the create path.
    let noCreate = 0, noDelete = 0;
    const total = EXPECT.length + 1;
    for (const [table, label] of EXPECT) {
        const l = logged[table];
        if (!l) { noCreate++; noDelete++; say(`  ❌ ${label.padEnd(22)} nothing written to audit_log`); continue; }
        if (l.create === 0) noCreate++;
        if (l.delete === 0) noDelete++;
        const mark = l.create === 0 ? '❌' : '✅';
        say(`  ${mark} ${label.padEnd(22)} logged ${Object.entries(l).filter(([, n]) => n).map(([k, n]) => `${k}×${n}`).join(' ')}` +
            (l.delete === 0 ? '  (no delete row yet)' : ''));
    }
    const stockAdj = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE table_name = 'stock_movements' AND id > ?").get(man.auditStartId).c;
    if (stockAdj === 0) { noCreate++; noDelete++; say('  ❌ Stock adjustment      nothing written to audit_log'); }
    else say(`  ✅ Stock adjustment      ${stockAdj} row(s)`);
    say(`  → creates audited: ${total - noCreate}/${total}   ·   deletes audited: ${total - noDelete}/${total}`);
    const lastMove = db.prepare('SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1').get(ids.product);
    check('Latest movement balance matches the replayed balance', !!lastMove && Math.abs(lastMove.balance_after - bal) < 0.001,
        `stored ${lastMove && lastMove.balance_after} vs replay ${bal}`);

    hr('RESULT');
    say(`  ${pass} passed, ${fail} failed`);
    if (fail) say('  ⚠ Some checks failed — see ❌ above.');
    db.close();
    process.exit(fail ? 1 : 0);
}

// ─────────────────────────────── REMOVE ───────────────────────────────

function remove() {
    const db = new Database(DB_PATH);
    db.pragma('foreign_keys = ON');
    const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    const { ids, before } = man;

    say(`  🧹  Removing the "${MARK}" trial entries`);

    hr('DELETING THROUGH THE APP\'S OWN DELETE PATHS');
    const del = [
        ['sale', () => ops.deleteSale(db, ids.sale), 'sale'],
        ['purchase', () => ops.deletePurchase(db, ids.purchase), 'purchase'],
        ['milk collection', () => ops.deleteMilkCollection(db, ids.milk), 'milk'],
        ['production batch', () => ops.deleteProductionBatch(db, ids.batch), 'production'],
        ['petty cash', () => ops.deletePettyCash(db, ids.petty), 'petty'],
        ['salary', () => ops.deleteSalaryRecord(db, ids.salary), 'salary'],
        ['vehicle expense', () => ops.deleteVehicleExpense(db, ids.vehicle), 'vehicle'],
        ['other expense', () => ops.deleteOtherExpense(db, ids.expense), 'expense'],
        ['bank transaction', () => ops.deleteBankTransaction(db, ids.bank), 'bank'],
        ['cash deposit', () => ops.deleteCashDeposit(db, ids.deposit), 'deposit'],
        ['cash collection', () => ops.deleteCashCollection(db, ids.cashCollection), 'cash collection'],
        ['denomination', () => ops.deleteDenomination(db, ids.denomination), 'denomination'],
        ['payment', () => ops.deletePayment(db, ids.receipt), 'receipt'],
        ['partner capital', () => ops.deletePartnerCapital(db, ids.capital), 'capital'],
    ];
    for (const [label, fn] of del) {
        try { fn(); say(`  ✅ deleted ${label}`); }
        catch (e) { say(`  ❌ could not delete ${label}: ${e.message}`); }
    }

    hr('LEFTOVERS');
    // the stock adjustment has no delete path → remove its movement explicitly
    // Deleting a document appends a *reversal* movement rather than erasing history, so
    // sweep every movement row whose note names a trial record (adjustment + reversals).
    const adj = db.prepare("DELETE FROM stock_movements WHERE notes LIKE ?").run(`%${TAG}%`);
    say(`  ✅ removed ${adj.changes} trial stock movement(s) (adjustment + delete reversals)`);
    db.prepare('DELETE FROM ledger_entries WHERE reference_id IN (SELECT id FROM sales WHERE invoice_no LIKE ?)').run(`${TAG}-%`);
    db.prepare('DELETE FROM ledger_entries WHERE reference_id IN (SELECT id FROM purchases WHERE bill_no LIKE ?)').run(`${TAG}-%`);
    db.prepare('DELETE FROM ledger_entries WHERE reference_id IN (SELECT id FROM milk_collections WHERE collection_no LIKE ?)').run(`${TAG}-%`);
    const stray = db.prepare("DELETE FROM stock_movements WHERE product_id = ?").run(ids.product);
    say(`  ✅ removed ${stray.changes} leftover stock movement(s) on ${TAG}-ITEM`);
    // masters last (documents reference them)
    for (const [label, fn] of [
        ['product', () => ops.deleteProduct(db, ids.product)],
        ['route', () => ops.deleteRoute(db, ids.route)],
        ['rate chart', () => ops.deleteRateChart(db, ids.rateChart)],
        ['party (customer)', () => ops.deleteParty(db, ids.customer)],
        ['party (supplier)', () => ops.deleteParty(db, ids.supplier)],
        ['party (farmer)', () => ops.deleteParty(db, ids.farmer)],
        ['party (partner)', () => ops.deleteParty(db, ids.partner)],
    ]) {
        try { fn(); say(`  ✅ deleted ${label}`); } catch (e) { say(`  ❌ could not delete ${label}: ${e.message}`); }
    }

    hr('ROW COUNTS vs BEFORE THE TRIAL');
    let drift = 0;
    for (const t of Object.keys(before)) {
        if (before[t] === null) continue;
        const now = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
        const d = now - before[t];
        if (d !== 0) { drift++; say(`  ⚠ ${t}: ${before[t]} → ${now} (${d > 0 ? '+' : ''}${d})`); }
    }
    if (!drift) say('  ✅ every table is back to its pre-trial count.');
    else say(`  ⚠ ${drift} table(s) still differ (audit_log keeps its history by design).`);

    db.close();
    fs.rmSync(MANIFEST, { force: true });
    say('\n  🧹 Done. Manifest removed.');
}

// ─────────────────────────────── MAIN ───────────────────────────────

(async () => {
    try {
        if (MODE === 'create') await create();
        else if (MODE === 'verify') verify();
        else remove();
    } catch (e) {
        console.error('\n  ❌ ' + e.message);
        console.error(e.stack);
        process.exit(1);
    }
})();
