#!/usr/bin/env node
/**
 * rebuild-from-excel.js — full fresh rebuild of the database from the Excel
 * workbook using the fixed importer, preserving app state and Trial1 rows.
 *
 * Phases:
 *   1. Safety backup of the current live DB (never overwritten if exists)
 *   2. Fresh DB (schema + migrations) -> runExcelImport(mode='fresh')
 *   3. Restore app state (settings, users, routes) from the old DB
 *   4. Replay Trial1 test rows (sale, purchase, milk, payments, bank, cash,
 *      batch, adjustment, partner contribution + their ledger/stock rows)
 *   5. Reconciliation report: rebuilt DB vs Excel per module + integrity checks
 *   6. Atomic swap: old DB -> data/dairy-plant.db.pre-rebuild-<ts>, new DB in place
 *
 * Usage: node scripts/audit/rebuild-from-excel.js [--apply]
 *   Without --apply everything runs against a throwaway copy and nothing is swapped.
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..', '..');
const EXCEL = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const WORK_DB = path.join(ROOT, 'data', 'dairy-plant.db.rebuild');

const APPLY = process.argv.includes('--apply');
const log = (m) => console.log(m);

// ---------- workbook helpers ----------
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();

function sheetRows(wb, name) {
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' });
}

// Party_Ledger: collect per-party rows with txn type, and total rows.
function excelPartyLedger() {
    const wb = XLSX.readFile(EXCEL);
    const rows = sheetRows(wb, 'Party_Ledger');
    const perParty = {};
    const byType = { sale: { n: 0, dr: 0 }, purchase: { n: 0, cr: 0 }, receipt: { n: 0, cr: 0 }, payment: { n: 0, dr: 0 } };
    let start = -1;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (Array.isArray(r) && r[0] === 'Date') { start = i + 1; continue; }
        if (i < start || !Array.isArray(r) || !r[2]) continue;
        const t = String(r[3] || '').trim().toLowerCase();
        if (t === '0' || t === 'total' || t.startsWith('totals')) continue;
        const p = norm(r[2]);
        const dr = Number(r[6]) || 0, cr = Number(r[7]) || 0;
        if (!dr && !cr) continue;
        (perParty[p] = perParty[p] || { net: 0, n: 0 });
        perParty[p].net += cr - dr;
        perParty[p].n += 1;
        if (t.includes('sale')) { byType.sale.n++; byType.sale.dr += dr; }
        else if (t.includes('purchase')) { byType.purchase.n++; byType.purchase.cr += cr; }
        else if (t.includes('collection') || t.includes('receipt')) { byType.receipt.n++; byType.receipt.cr += cr; }
        else if (t.includes('payment')) { byType.payment.n++; byType.payment.dr += dr; }
    }
    return { perParty, byType, wb };
}

function excelPurchaseMilk() {
    const wb = XLSX.readFile(EXCEL);
    const rows = sheetRows(wb, 'Purchase_Entry');
    let lines = 0, qty = 0, amt = 0;
    let start = -1;
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (Array.isArray(r) && r[0] === 'Date') { start = i + 1; continue; }
        if (i < start || !Array.isArray(r) || !r[2]) continue;
        const prod = String(r[5] || '').trim();
        if (!/milk/i.test(prod)) continue;
        const q = Number(r[12]) || 0;
        if (q === 0) continue;
        lines++; qty += q; amt += Number(r[13]) || 0;
    }
    return { lines, qty, amt };
}

// ---------- Trial1 replay ----------
function replayTrial1(ndb, odb) {
    log('  ↺ Replaying Trial1 test rows...');
    const stamp = '2026-09-20 07:12:06';

    // Parties (schema-flexible: intersect columns of old and new tables)
    const oldPCols = odb.prepare('PRAGMA table_info(parties)').all().map(c => c.name);
    const newPCols = new Set(ndb.prepare('PRAGMA table_info(parties)').all().map(c => c.name));
    const sharedP = oldPCols.filter(c => newPCols.has(c));
    const insParty = ndb.prepare(`INSERT INTO parties (${sharedP.join(', ')}) VALUES (${sharedP.map(() => '?').join(', ')})`);
    for (const p of odb.prepare("SELECT " + sharedP.join(', ') + " FROM parties WHERE name LIKE 'TRIAL1-%'").all()) {
        if (!newPCols.has('is_active') || sharedP.includes('is_active')) {
            if (sharedP.includes('is_active') && (p.is_active === null || p.is_active === undefined)) p.is_active = 1;
        }
        insParty.run(...sharedP.map(c => p[c]));
    }
    const buyer = 389, supplier = 390, farmer = 391, partner = 392;

    // Products needed: TRIAL1-ITEM + Cow Milk — resolve by name, create if missing
    const ensureProduct = (name, unit, rate) => {
        let hit = ndb.prepare('SELECT id FROM products WHERE name = ?').get(name);
        if (!hit) {
            const r = ndb.prepare(`INSERT INTO products (name, unit, category, rate, notes, created_at, updated_at)
                VALUES (?, ?, 'Other', ?, 'Trial1', ?, ?)`).run(name, unit, rate, stamp, stamp);
            return Number(r.lastInsertRowid);
        }
        return hit.id;
    };
    const item53 = ensureProduct('TRIAL1-ITEM', 'kg', 100);
    const cowId = ensureProduct('Cow Milk', 'Liter', 60);

    // Routes (milk row references route_id 5)
    if (!ndb.prepare('SELECT id FROM routes WHERE id = 5').get()) {
        ndb.prepare("INSERT INTO routes (id, name, created_at) VALUES (5, 'TRIAL1-ROUTE', ?)").run(stamp);
    }

    // Purchase
    const op = odb.prepare("SELECT * FROM purchases WHERE bill_no='TRIAL1-PURCH-1'").get();
    const np = ndb.prepare(`INSERT INTO purchases (bill_no, date, party_id, subtotal, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(op.bill_no, op.date, supplier, op.subtotal, op.grand_total, op.paid_amount, op.payment_mode, op.status, op.notes, stamp, stamp);
    const pid = np.lastInsertRowid;
    for (const it of odb.prepare('SELECT * FROM purchase_items WHERE purchase_id=?').all(op.id)) {
        ndb.prepare(`INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?,?,?,?,?,?,?)`)
            .run(pid, item53, it.product_name, it.quantity, it.unit, it.rate, it.amount);
    }
    // Milk collection (TRIAL1-MILK-1, links to nothing — plain collection)
    const om = odb.prepare("SELECT * FROM milk_collections WHERE collection_no='TRIAL1-MILK-1'").get();
    ndb.prepare(`INSERT INTO milk_collections (collection_no, date, party_id, route_id, milk_type, quantity_liters, fat_percent, snf_percent, rate_type, fat_multiplier, snf_multiplier, rate, amount, shift, status, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(om.collection_no, om.date, farmer, 5, om.milk_type, om.quantity_liters, om.fat_percent, om.snf_percent, om.rate_type, om.fat_multiplier, om.snf_multiplier, om.rate, om.amount, om.shift, om.status, om.notes, stamp, stamp);
    // Sale
    const os = odb.prepare("SELECT * FROM sales WHERE invoice_no='TRIAL1-SALE-1'").get();
    const ns = ndb.prepare(`INSERT INTO sales (invoice_no, date, party_id, subtotal, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(os.invoice_no, os.date, buyer, os.subtotal, os.grand_total, os.paid_amount, os.payment_mode, os.status, os.notes, stamp, stamp);
    const sid = ns.lastInsertRowid;
    for (const it of odb.prepare('SELECT * FROM sales_items WHERE sale_id=?').all(os.id)) {
        ndb.prepare(`INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?,?,?,?,?,?,?)`)
            .run(sid, item53, it.product_name, it.quantity, it.unit, it.rate, it.amount);
    }
    // Payments (3)
    for (const p of odb.prepare("SELECT * FROM payments WHERE created_at >= '2026-09-20'").all()) {
        const refId = p.reference_id === 1 ? null : p.reference_id; // cash_collections id=1 → recreated below
        ndb.prepare(`INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
            .run(p.party_id === buyer ? buyer : p.party_id, p.date, p.type, p.amount, p.mode, p.reference_type, refId, p.notes, stamp);
    }
    // Cash collection row
    const oc = odb.prepare('SELECT * FROM cash_collections WHERE id=1').get();
    ndb.prepare(`INSERT INTO cash_collections (date, ref_no, payment_mode, party_id, cash_sales, cash_receipts, cash_payments, other_receipts, notes, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(oc.date, oc.ref_no, oc.payment_mode, buyer, oc.cash_sales, oc.cash_receipts, oc.cash_payments, oc.other_receipts, oc.notes, stamp, stamp);
    // Bank transaction
    const ob = odb.prepare("SELECT * FROM bank_transactions WHERE reference_no='TRIAL1-BANK-1'").get();
    ndb.prepare(`INSERT INTO bank_transactions (date, reference_no, counterparty_name, description, debit, credit, amount, payment_mode, bank_account, txn_type, party_id, match_status, ledger_posted, remarks, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`)
        .run(ob.date, ob.reference_no, ob.counterparty_name, ob.description, ob.debit, ob.credit, ob.amount, ob.payment_mode, ob.bank_account, ob.txn_type, buyer, 'auto', ob.remarks, stamp, stamp);
    // Production batch + inputs/outputs
    const oba = odb.prepare("SELECT * FROM production_batches WHERE batch_no='TRIAL1-BATCH-1'").get();
    const nb = ndb.prepare(`INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity, input_unit, output_quantity, output_unit, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(oba.batch_no, oba.date, oba.shift, oba.process_type, oba.input_quantity, oba.input_unit, oba.output_quantity, oba.output_unit, oba.actual_yield_percent, oba.wastage_quantity, oba.wastage_reason, oba.operator_name, oba.remarks, stamp, stamp);
    const bid = nb.lastInsertRowid;
    for (const i of odb.prepare('SELECT * FROM production_inputs WHERE batch_id=?').all(oba.id)) {
        ndb.prepare(`INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?,?,?,?,?,?,?)`)
            .run(bid, item53, i.product_name, i.quantity, i.unit, i.rate, i.amount);
    }
    for (const o of odb.prepare('SELECT * FROM production_outputs WHERE batch_id=?').all(oba.id)) {
        ndb.prepare(`INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?,?,?,?,?,?,?)`)
            .run(bid, item53, o.product_name, o.quantity, o.unit, o.rate, o.amount);
    }
    // Partner contribution (live schema: partner_capital)
    const opc = odb.prepare('SELECT * FROM partner_capital WHERE notes = \'Trial1\'').get();
    if (opc) {
        const hasRefNo = ndb.prepare('PRAGMA table_info(partner_capital)').all().map(c => c.name).includes('reference_no');
        ndb.prepare(`INSERT INTO partner_capital (party_id, date, type, amount, mode, reference_no, notes, created_at) VALUES (?,?,?,?,?,?,?,?)`)
            .run(partner, opc.date || '2083-06-04', opc.type || 'contribution', opc.amount, opc.mode || 'bank', hasRefNo ? (opc.reference_no || '') : '', 'Trial1', stamp);
    }
    // Trial1 stock adjustment row is inserted later with the resolved product id.

    // Ledger rows (reference_ids re-derived: purchase/sale/milk ids differ in new DB)
    const newPur = pid, newSale = sid;
    const newMilk = ndb.prepare("SELECT id FROM milk_collections WHERE collection_no='TRIAL1-MILK-1'").get().id;
    const newBank = ndb.prepare("SELECT id FROM bank_transactions WHERE reference_no='TRIAL1-BANK-1'").get().id;
    const newPay = ndb.prepare("SELECT id FROM payments ORDER BY id DESC LIMIT 3").all().map(r => r.id).reverse();
    const insLed = ndb.prepare(`INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
    insLed.run(supplier, '2083-06-04', 'purchase', newPur, 'Purchase Bill TRIAL1-PURCH-1', 0, 800, 800, stamp);
    insLed.run(buyer, '2083-06-04', 'sale', newSale, 'Sale Invoice TRIAL1-SALE-1', 500, 0, 500, stamp);
    insLed.run(farmer, '2083-06-04', 'milk_collection', newMilk, 'Milk Collection TRIAL1-MILK-1', 0, 1200, 1200, stamp);
    insLed.run(buyer, '2083-06-04', 'payment_received', newBank, 'TRIAL1-BUYER Trial1 [TRIAL1-BANK-1]', 0, 1000, -500, stamp);
    insLed.run(buyer, '2083-06-04', 'payment_received', newPay[0], 'Payment Collection - Received', 0, 500, 0, stamp);
    insLed.run(buyer, '2083-06-04', 'payment_made', newPay[1], 'Payment Collection - Paid', 50, 0, 50, stamp);
    insLed.run(buyer, '2083-06-04', 'payment_received', newPay[2], 'Payment Received', 0, 300, -250, stamp);
    insLed.run(partner, '2083-06-04', 'partner_contribution', 1, 'Capital Contribution', 0, 5000, 5000, stamp);

    // Stock movements (re-derived balances)
    const insSm = ndb.prepare(`INSERT INTO stock_movements (product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    // running stock for TRIAL1-ITEM and Cow Milk depends on rebuild outputs; find current max balance
    const bal = (pid2) => ndb.prepare('SELECT COALESCE(MAX(balance_after),0) b FROM stock_movements WHERE product_id=?').get(pid2).b;
    const purDate = '2083-06-04';
    let b = bal(item53);
    insSm.run(item53, purDate, 'purchase', 'purchase', pid, 10, 0, b + 10, 80, 'Purchase TRIAL1-PURCH-1', stamp);
    b = bal(item53);
    insSm.run(item53, purDate, 'sale', 'sale', sid, 0, 5, b - 5, 100, 'Sale TRIAL1-SALE-1', stamp);
    b = bal(cowId);
    insSm.run(cowId, purDate, 'milk_collection', 'milk_collection', newMilk, 20, 0, b + 20, 60, 'Milk collection #TRIAL1-MILK-1', stamp);
    b = bal(item53);
    insSm.run(item53, purDate, 'production_input', 'production', bid, 0, 5, b - 5, 80, 'Production input: TRIAL1-BATCH-1', stamp);
    b = bal(item53);
    insSm.run(item53, purDate, 'production_output', 'production', bid, 4.5, 0, b + 4.5, 100, 'Production output: TRIAL1-BATCH-1', stamp);
    b = bal(item53);
    insSm.run(item53, purDate, 'adjustment', '', null, 2, 0, b + 2, 100, 'Trial1 stock adjustment', stamp);

    // Salary record
    const osal = odb.prepare("SELECT * FROM salary_records WHERE employee_name='TRIAL1-EMPLOYEE'").get();
    if (osal) {
        ndb.prepare(`INSERT INTO salary_records (employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(osal.employee_name, osal.position, osal.month, osal.basic_salary, osal.allowance, osal.advance, osal.deduction, osal.net_salary, osal.payment_date, osal.payment_mode, osal.remarks, stamp, stamp);
    }
    log(`  ↺ Trial1 replayed (sale/purchase/milk/payments/bank/batch/adjustment/salary).`);
}

// ---------- app state restore ----------
function restoreAppState(ndb, odb) {
    log('  ↺ Restoring settings, users, routes, employees...');
    // Settings: the old DB is authoritative for user-edited values (business
    // details, SMTP) — REPLACE whatever the workbook seed pre-filled.
    const settings = odb.prepare('SELECT key, value FROM settings').all();
    const insSetting = ndb.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const s of settings) insSetting.run(s.key, s.value);

    // Users: copy by intersecting columns (schemas differ across versions).
    const oldUserCols = odb.prepare('PRAGMA table_info(users)').all().map(c => c.name);
    const newUserCols = new Set(ndb.prepare('PRAGMA table_info(users)').all().map(c => c.name));
    const shared = oldUserCols.filter(c => newUserCols.has(c));
    const insUser = ndb.prepare(`INSERT OR REPLACE INTO users (${shared.join(', ')}) VALUES (${shared.map(() => '?').join(', ')})`);
    const users = odb.prepare(`SELECT ${shared.join(', ')} FROM users`).all();
    for (const u of users) insUser.run(...shared.map(c => u[c]));

    // Routes
    const routes = odb.prepare('SELECT * FROM routes').all();
    const routeCols = odb.prepare('PRAGMA table_info(routes)').all().map(c => c.name);
    const newRouteCols = new Set(ndb.prepare('PRAGMA table_info(routes)').all().map(c => c.name));
    const sharedRoutes = routeCols.filter(c => newRouteCols.has(c));
    const insRoute = ndb.prepare(`INSERT OR REPLACE INTO routes (${sharedRoutes.join(', ')}) VALUES (${sharedRoutes.map(() => '?').join(', ')})`);
    for (const r of routes) insRoute.run(...sharedRoutes.map(c => r[c]));

    // Employees: keep the master (may hold salary info beyond the 3 seeded).
    // The old DB may predate the employees table — the fresh DB is seeded with
    // the three required employees by initDatabase in that case.
    let nEmp = 0;
    try {
        const emp = odb.prepare('SELECT code, name, position, phone, monthly_salary, active, notes FROM employees').all();
        for (const e of emp) {
            const hit = ndb.prepare('SELECT id FROM employees WHERE LOWER(name) = LOWER(?)').get(e.name);
            if (hit) {
                ndb.prepare('UPDATE employees SET code=?, position=?, phone=?, monthly_salary=?, active=?, notes=? WHERE id=?')
                    .run(e.code || '', e.position || '', e.phone || '', e.monthly_salary || 0, e.active === 0 ? 0 : 1, e.notes || '', hit.id);
            } else {
                ndb.prepare('INSERT INTO employees (code, name, position, phone, monthly_salary, active, notes) VALUES (?,?,?,?,?,?,?)')
                    .run(e.code || '', e.name, e.position || '', e.phone || '', e.monthly_salary || 0, e.active === 0 ? 0 : 1, e.notes || '');
            }
            nEmp++;
        }
    } catch (e) { /* no employees in old db */ }
    log(`  ↺ settings: ${settings.length}, users: ${users.length}, routes: ${routes.length}, employees: ${nEmp}`);
}

// ---------- reconciliation ----------
function reconcile(ndb, xl) {
    log('\n  ═══ RECONCILIATION vs EXCEL ═══');
    const out = [];
    // per-party ledger net
    const dbNets = ndb.prepare(`SELECT pa.name, SUM(le.credit - le.debit) v, COUNT(*) n
        FROM ledger_entries le JOIN parties pa ON pa.id = le.party_id GROUP BY le.party_id`).all();
    let match = 0, diff = 0, missing = 0;
    const diffs = [];
    for (const r of dbNets) {
        const k = norm(r.name);
        const xv = xl.perParty[k];
        if (xv === undefined) { missing++; continue; }
        if (Math.abs(r.v - xv.net) <= 1) match++;
        else { diff++; diffs.push({ party: r.name, excel: xv.net, db: r.v }); }
    }
    // excel parties absent from db
    const dbNames = new Set(dbNets.map(r => norm(r.name)));
    let excelMissing = 0;
    for (const k of Object.keys(xl.perParty)) if (!dbNames.has(k)) excelMissing++;
    log(`  Party ledger nets: ${match} match, ${diff} differ, ${missing} db-only, ${excelMissing} excel-only (of ${Object.keys(xl.perParty).length} excel parties)`);
    for (const d of diffs.slice(0, 20)) {
        log(`    ⚠ ${d.party.padEnd(36)} excel ${d.excel.toFixed(0).padStart(10)}  db ${d.db.toFixed(0).padStart(10)}`);
    }
    // milk
    const milk = ndb.prepare("SELECT COUNT(*) n, SUM(quantity_liters) q, SUM(amount) a FROM milk_collections").get();
    const epm = excelPurchaseMilk();
    log(`  Milk collections: db ${milk.n} rows / ${(+milk.q).toFixed(1)} L / Rs ${(milk.a || 0).toFixed(0)}  vs excel ${epm.lines} lines / ${epm.qty.toFixed(1)} L / Rs ${epm.amt.toFixed(0)}`);
    // sales & purchases totals
    const saleAgg = ndb.prepare('SELECT COUNT(*) n, SUM(grand_total) t FROM sales').get();
    const purAgg = ndb.prepare('SELECT COUNT(*) n, SUM(grand_total) t FROM purchases').get();
    log(`  Sales (module): ${saleAgg.n} / Rs ${(saleAgg.t || 0).toFixed(0)} | Purchases (module): ${purAgg.n} / Rs ${(purAgg.t || 0).toFixed(0)}`);
    log(`  Party_Ledger type totals: ${JSON.stringify(xl.byType)}`);
    // negative stock
    const neg = ndb.prepare(`
        SELECT p.name, SUM(sm.inward_qty - sm.outward_qty) q FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id GROUP BY sm.product_id HAVING q < -0.01`).all();
    log(`  Negative-stock items after rebuild: ${neg.length}`);
    for (const n of neg) log(`    ${n.name}: ${(+n.q).toFixed(1)}`);
    // ledger balance check: sum(debit) vs sum(credit) need not equal, but per-party net must equal balance column? skip.
    return { match, diff, missing, excelMissing, negCount: neg.length };
}

// ---------- main ----------
function main() {
    if (!fs.existsSync(EXCEL)) throw new Error('Workbook not found: ' + EXCEL);
    if (!fs.existsSync(LIVE_DB)) throw new Error('Live DB not found: ' + LIVE_DB);

    // Phase 1: backup
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupPath = LIVE_DB + '.pre-rebuild-' + ts;
    if (APPLY) {
        fs.copyFileSync(LIVE_DB, backupPath);
        log(`💾 Safety backup: ${path.basename(backupPath)} (${(fs.statSync(backupPath).size / 1e6).toFixed(1)} MB)`);
    } else {
        log('🧪 DRY RUN — live DB untouched; swap skipped.');
    }

    // Phase 2: fresh DB
    if (fs.existsSync(WORK_DB)) fs.unlinkSync(WORK_DB);
    for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(WORK_DB + suffix)) fs.unlinkSync(WORK_DB + suffix);
    }
    const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
    initDatabase(path.join(ROOT, 'data'), 'dairy-plant.db.rebuild');
    const ndb = new Database(WORK_DB);
    ndb.pragma('foreign_keys = OFF');
    const odb = new Database(LIVE_DB, { readonly: true });

    const t0 = Date.now();
    const { runExcelImport } = require(path.join(ROOT, 'shared', 'excel-import'));
    const res = runExcelImport(ndb, EXCEL, { mode: 'fresh', log: (m) => log('  ' + m) });
    log(`  import done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Phase 3: app state
    ndb.transaction(() => restoreAppState(ndb, odb))();

    // Phase 4: Trial1
    ndb.transaction(() => replayTrial1(ndb, odb))();

    // Phase 5: reconcile
    const xl = excelPartyLedger();
    const rec = reconcile(ndb, xl);

    // integrity: try integrity check + close
    log('  integrity_check: ' + ndb.pragma('integrity_check', { simple: true }));
    const counts = {};
    for (const t of ['parties', 'products', 'sales', 'purchases', 'milk_collections', 'payments', 'ledger_entries', 'stock_movements', 'bank_transactions', 'petty_cash', 'denomination_counts', 'production_batches', 'salary_records', 'employees', 'settings', 'users']) {
        try { counts[t] = ndb.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n; } catch (e) { counts[t] = 'n/a'; }
    }
    log('  row counts: ' + JSON.stringify(counts));

    ndb.close();
    odb.close();

    // Phase 6: swap
    if (APPLY) {
        fs.renameSync(LIVE_DB, LIVE_DB + '.pre-rebuild-' + ts + '.retired');
        fs.copyFileSync(WORK_DB, LIVE_DB);
        // remove stale wal/shm of live db if any
        for (const suffix of ['-wal', '-shm']) {
            const f = LIVE_DB + suffix;
            if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        fs.renameSync(WORK_DB + '', WORK_DB + '.done');
        log(`✅ Swapped: retired DB kept as ${path.basename(backupPath)}.retired`);
        log(`   New live DB in place. Restart the app/server to pick it up.`);
    } else {
        log(`🧪 Dry run complete. Rebuilt DB kept at ${path.basename(WORK_DB)} for inspection.`);
    }
    log(`Reconciliation: ${rec.match} match / ${rec.diff} differ / neg-stock items: ${rec.negCount}`);
}

main();
