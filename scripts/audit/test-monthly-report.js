#!/usr/bin/env node
/**
 * test-monthly-report.js — the Monthly Report acceptance checks
 * ============================================================
 *   node scripts/audit/test-monthly-report.js
 *
 * Runs against a THROWAWAY COPY of the real database (never the live file):
 *   DB_PATH            source database
 *                      (default: the installed app's userData DB when present,
 *                       else ./data/dairy-plant.db)
 * Exit 0 = all checks pass, 1 = at least one failure.
 *
 * Covers (req 11 acceptance list):
 *   · a full Bhadra 2083 report and Shrawan 2083 month ends
 *   · income heads vs the sales register, expense heads vs the registers
 *   · milk procurement counted once; purchases not expensed twice
 *   · loans / advances / prepaid amounts never inside P&L
 *   · two consecutive months: closing balances = next month's opening
 *   · the six-month advance rent: monthly recognition + remaining asset
 *   · the Excel sheet matching the engine, and the workbook edit preserving
 *     every existing sheet
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));

const cal = require(path.join(ROOT, 'shared', 'bs-calendar'));
const accounting = require(path.join(ROOT, 'shared', 'operations', 'accounting'));
const prepaid = require(path.join(ROOT, 'shared', 'operations', 'prepaid_rent'));
const monthly = require(path.join(ROOT, 'shared', 'operations', 'monthly_report'));
const exporter = require(path.join(ROOT, 'shared', 'export-monthly-report'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; return true; }
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    return false;
}
function eq(a, b, name) { return ok(a === b, name, `expected ${b}, got ${a}`); }
function near(a, b, tol, name) {
    const d = Math.abs((Number(a) || 0) - (Number(b) || 0));
    return ok(d <= tol, name, `expected ${b} ±${tol}, got ${a} (diff ${d.toFixed(4)})`);
}
const hr = (t) => console.log('\n' + '─'.repeat(68) + (t ? `\n  ${t}` : ''));

// ── Source database (always copied to /tmp first) ──
const LIVE_DB = path.join(os.homedir(), 'Library', 'Application Support',
    'prarambha-account-stock', 'data', 'dairy-plant.db');
const SRC = process.env.DB_PATH || (fs.existsSync(LIVE_DB) ? LIVE_DB : path.join(ROOT, 'data', 'dairy-plant.db'));
if (!fs.existsSync(SRC)) {
    console.error(`Database not found: ${SRC}`);
    process.exit(1);
}
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-test-'));
const DB = path.join(tmpDir, 'monthly-report-test.db');
fs.copyFileSync(SRC, DB);
console.log(`Source database : ${SRC}`);
console.log(`Working copy    : ${DB}`);

const db = new Database(DB);

// ──────────────────────────────────────────────────────────────
hr('1. Six months\' advance rent — the real transaction');
// ──────────────────────────────────────────────────────────────
const seeded = prepaid.seedAdvanceRent(db, null);
ok(seeded.success, 'the advance rent can be recorded');
eq(Number(seeded.record.amount), 910000, 'amount is the actual Rs 910,000 paid');
eq(seeded.record.payment_date, '2083-06-30', 'payment date is the real 2083-06-30 (AD 2026-10-16)');
eq(seeded.record.party_name, 'SAI KRIPA KSS LTD', 'party is the real payee');
eq(Number(seeded.record.months), 6, 'six rental months');
eq(seeded.record.start_month, '2083-07', 'rental period starts the month after payment');
const again = prepaid.seedAdvanceRent(db, null);
ok(again.duplicate, 'recording it twice creates no second payment');
eq(db.prepare('SELECT COUNT(*) c FROM prepaid_expenses').get().c, 1, 'exactly one prepaid record exists');

// Recognition: month by month, exactly the monthly share, asset runs to zero.
const per = {};
for (const key of ['2083-06', '2083-07', '2083-08', '2083-09', '2083-10', '2083-11', '2083-12']) {
    const r = cal.bsMonthRange(key);
    per[key] = { expense: prepaid.getPrepaidSummary(db, r).rent_expense, balance: prepaid.getPrepaidBalance(db, r.to_date) };
}
eq(per['2083-06'].expense, 0, 'the payment month (Ashwin 2083) recognises NO rent expense');
eq(per['2083-06'].balance, 910000, 'the whole amount is still an asset on the payment date');
for (const key of ['2083-07', '2083-08', '2083-09', '2083-10', '2083-11']) {
    near(per[key].expense, 151666.67, 0.01, `${key} recognises one monthly share (910,000 ÷ 6)`);
}
// The final rental month absorbs the rounding residual so the six add up exactly.
near(per['2083-12'].expense, 151666.65, 0.01, '2083-12 recognises the last monthly share + rounding residual');
near(per['2083-12'].balance, 0, 0.01, 'the prepaid asset is fully used after the sixth month');
const allSix = prepaid.getPrepaidSummary(db, cal.bsMonthRange('2083-07')).rent_expense
    + ['2083-08', '2083-09', '2083-10', '2083-11', '2083-12']
        .reduce((s, k) => s + prepaid.getPrepaidSummary(db, cal.bsMonthRange(k)).rent_expense, 0);
near(allSix, 910000, 0.001, 'the six months of expense add up to exactly the amount paid');
near(prepaid.getPrepaidSummary(db, { from_date: '2083-07-01', to_date: '2083-07-15' }).rent_expense,
    151666.67 / 30 * 15, 0.02, 'a partial period recognises a pro-rata share of the month');
ok(prepaid.getPrepaidBalance(db, '2083-06-29') === 0, 'nothing is an asset before the payment date');

// ──────────────────────────────────────────────────────────────
hr('2. The report over the whole book (Ashadh → Ashwin 2083)');
// ──────────────────────────────────────────────────────────────
const firstDate = db.prepare('SELECT MIN(d) m FROM (SELECT MIN(date) d FROM sales UNION SELECT MIN(date) FROM purchases UNION SELECT MIN(date) FROM milk_collections)').get().m;
const lastDate = monthly.latestDocumentDate(db).latest_document_date;
const R = monthly.getMonthlyReport(db, { from_date: firstDate, to_date: lastDate });
console.log(`  Period: ${R.from_date} → ${R.to_date} (${R.month_count} months)`);

near(R.summary.net_profit, R.summary.total_income - R.summary.cogs - R.summary.operating_expenses, 0.05,
    'net profit = total income − COGS − operating expenses');
near(R.summary.total_income, R.summary.sales_revenue + R.summary.other_income, 0.05,
    'total income = sales revenue + other income');
near(R.summary.gross_profit, R.summary.sales_revenue - R.summary.cogs, 0.05, 'gross profit = revenue − COGS');

// Income heads vs the sales register.
const headsTotal = R.income_heads.reduce((s, h) => s + h.amount, 0);
near(headsTotal, R.summary.sales_revenue, 1.0, 'income heads add up to the sales register (excl. opening balances)');
ok(R.income_heads.length >= 4, `income heads are broken out (${R.income_heads.map(h => h.head).join(', ')})`);
ok(R.income_heads.some(h => h.head === 'Milk Sales'), 'Milk Sales is its own income head');
ok(R.income_heads.some(h => /Paneer/.test(h.head)), 'Paneer Sales is its own income head');
ok(R.income_heads.some(h => /Cream/.test(h.head)), 'Cream Sales is its own income head');
ok(R.income_heads.some(h => /Nauni/.test(h.head)), 'Nauni/Butter Sales is its own income head');
ok(R.income_heads.some(h => /Ghee/.test(h.head)), 'Ghee Sales is its own income head');

// Opening-balance documents are NOT revenue (the 531,985 opening book).
ok(R.activity.opening_balance_documents > 0, 'opening-balance documents are detected and reported separately');
near(R.summary.sales_revenue, R.activity.sales_register_total - R.activity.opening_balance_documents, 0.05,
    'sales revenue = register total − opening-balance documents');

// ──────────────────────────────────────────────────────────────
hr('3. Milk counted once, purchases never expensed twice');
// ──────────────────────────────────────────────────────────────
const collections = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM milk_collections WHERE date >= ? AND date <= ?')
    .get(R.from_date, R.to_date).t;
near(R.summary.milk_cost, collections, 1.0, 'milk procurement equals the Milk Collection register');
const purchasesGross = db.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM purchases WHERE date >= ? AND date <= ?')
    .get(R.from_date, R.to_date).t;
near(R.activity.cogs_detail.purchases_gross, purchasesGross, 1.0,
    'the purchase register total is fully accounted for');
// The full purchase register must still be accounted for, now including the
// opening-balance documents (bill OPN-…) that are brought forward rather than
// expensed — the purchase-side mirror of the OPN invoices kept out of revenue.
near(purchasesGross,
    R.activity.cogs_detail.other_purchases + R.activity.cogs_detail.linked_milk_excluded
    + R.activity.cogs_detail.unlinked_milk_lines + (R.activity.cogs_detail.opening_purchase_documents || 0),
    1.0, 'purchases split into COGS purchases + milk already counted through collections + opening documents (no double count)');
near(R.summary.cogs, R.summary.milk_cost + R.summary.other_purchases, 0.05, 'COGS = milk + non-milk purchases');

// ──────────────────────────────────────────────────────────────
hr('4. Balance-sheet money never treated as P&L');
// ──────────────────────────────────────────────────────────────
const headsText = R.expense_heads.map(h => h.head.toUpperCase()).join(' | ');
ok(!/ADVANCE|LOAN|CAPITAL|TRANSFER|DEPOSIT/.test(headsText), 'no advance / loan / capital / transfer / deposit expense head exists');
// Advances and loans appear only in the closing balances.
ok(R.summary.advances >= 0 && typeof R.summary.advances === 'number', 'advances are reported as a balance-sheet item');
const la = accounting.getLoanAdvanceBalances(db, { as_of: R.to_date });
near(R.summary.advances, la.advance_receivable, 0.05, 'the advance balance matches the ledger');
ok(!('advances' in R.activity), 'advances are not part of the period activity (income/expense) object');

// Receipts are not income: receipts exist but income equals the invoices.
const receipts = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE date >= ? AND date <= ? AND type = 'receipt'")
    .get(R.from_date, R.to_date).t;
ok(receipts > 0, 'customer receipts exist in the period');
near(R.summary.sales_revenue, R.summary.total_income - R.summary.other_income, 0.05,
    'revenue is the invoiced amount — receipts are cash movement, never added as income');

// ──────────────────────────────────────────────────────────────
hr('5. Monthly closing balances carry forward');
// ──────────────────────────────────────────────────────────────
ok(R.months.length === R.month_count, 'one row per month in the period');
let continuityIssues = 0;
for (let i = 1; i < R.months.length; i++) {
    const p = R.months[i - 1], c = R.months[i];
    for (const key of ['cash', 'bank', 'inventory', 'receivables', 'payables', 'advances', 'prepaid_rent']) {
        const a = p['closing_' + key], b = c['opening_' + key];
        if (Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.05) {
            continuityIssues++;
            failures.push(`${p.label} closing_${key}=${a} ≠ ${c.label} opening_${key}=${b}`);
        }
    }
}
eq(continuityIssues, 0, 'every closing balance becomes the next month\'s opening balance');

const bhadra = R.months.find(m => m.month === '2083-05');
const ashwin = R.months.find(m => m.month === '2083-06');
if (bhadra && ashwin) {
    near(bhadra.closing_cash, ashwin.opening_cash, 0.05, 'Bhadra closing cash = Ashwin opening cash');
    near(bhadra.closing_bank, ashwin.opening_bank, 0.05, 'Bhadra closing bank = Ashwin opening bank');
    near(bhadra.closing_receivables, ashwin.opening_receivables, 0.05, 'Bhadra closing receivables = Ashwin opening receivables');
}
const m0 = R.months[0];
near(m0.opening_cash, R.opening.cash, 0.05, 'the first month opens at the period\'s opening cash');
near(R.closing.cash, R.months[R.months.length - 1].closing_cash, 0.05, 'period closing = last month closing');
near(R.summary.net_profit, R.months.reduce((s, m) => s + m.net_profit, 0), 1.0,
    'the period\'s profit is the sum of its months (closing balances are NOT added)');
near(R.months.reduce((s, m) => s + m.total_income, 0), R.summary.total_income, 1.0,
    'no month re-counts a previous month\'s income');

// ──────────────────────────────────────────────────────────────
hr('6. Single-month report (Bhadra 2083) and month-end boundaries');
// ──────────────────────────────────────────────────────────────
const bhadraReport = monthly.getMonthlyReport(db, { month: '2083-05' });
eq(bhadraReport.from_date, '2083-05-01', 'Bhadra 2083 starts on day 1');
eq(bhadraReport.to_date, '2083-05-31', 'Bhadra 2083 ends on day 31 — the real month end');
eq(bhadraReport.month_count, 1, 'the month selector reports exactly one month');
const lastDoc = db.prepare('SELECT MAX(date) d FROM sales WHERE date >= ? AND date <= ?')
    .get('2083-05-01', '2083-05-31').d;
if (lastDoc) {
    const lastSales = db.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales WHERE date = ? AND UPPER(invoice_no) NOT LIKE ?')
        .get(lastDoc, 'OPN-%').t;
    ok(lastSales > 0, `a transaction on the month's last day (${lastDoc}) exists`);
    const oneDayLess = db.prepare('SELECT COALESCE(SUM(grand_total),0) t FROM sales WHERE date >= ? AND date < ? AND UPPER(invoice_no) NOT LIKE ?')
        .get('2083-05-01', '2083-05-31', 'OPN-%').t;
    near(bhadraReport.summary.sales_revenue, oneDayLess + lastSales, 0.05,
        'the last day of the month is INSIDE the report (end date is inclusive)');
}
const shrawan = monthly.getMonthlyReport(db, { month: '2083-04' });
eq(shrawan.to_date, '2083-04-31', 'Shrawan 2083 ends on day 31');
const ashwinReport = monthly.getMonthlyReport(db, { month: '2083-06' });
eq(ashwinReport.to_date, '2083-06-31', 'Ashwin 2083 ends on day 31');
ok(R.summary.prepaid_rent >= 0, 'prepaid rent is reported as a closing balance');
eq(R.summary.prepaid_rent, prepaid.getPrepaidBalance(db, R.to_date), 'closing prepaid rent matches the prepaid engine');
// Rent may only appear once the rental period starts (the lease runs from
// start_month = 2083-07, six months AFTER the first books). Anchoring the check
// to the real lease start keeps it valid whenever the books grow past it.
const leaseStart = seeded.record.start_month;
const preLease = R.months.filter(m => m.month < leaseStart);
ok(!preLease.some(m => m.rent_expense > 0),
    `no rent expense is recognised in months before the lease starts (${preLease.length} months checked)`);
const firstLeaseMonth = R.months.find(m => m.month === leaseStart);
if (firstLeaseMonth) {
    ok(firstLeaseMonth.rent_expense > 0, 'the first rental month inside the window recognises rent');
}

// Rejecting bad input
let threw = false;
try { monthly.getMonthlyReport(db, { from_date: '2083-05-31', to_date: '2083-05-01' }); } catch (e) { threw = true; }
ok(threw, 'a reversed date range is rejected, not silently reported');
threw = false;
try { monthly.getMonthlyReport(db, { from_date: '2083-05-01', to_date: '2083-05-32' }); } catch (e) { threw = true; }
ok(threw, 'an impossible end date (Bhadra 32) is rejected');

// ──────────────────────────────────────────────────────────────
hr('7. Reconciliation section');
// ──────────────────────────────────────────────────────────────
ok(R.reconciliation.checks.length >= 8, `the report ships ${R.reconciliation.checks.length} reconciliation checks`);
for (const name of ['Sales invoices vs income heads', 'Milk procurement vs collection register',
    'Purchase register vs purchases used in COGS', 'Receivables vs party ledger',
    'Payables vs party ledger', 'Advances (balance sheet) vs ledger',
    'Prepaid rent: paid − recognised = asset']) {
    ok(R.reconciliation.checks.some(c => c.check === name), `reconciliation includes "${name}"`);
}
ok(R.reconciliation.checks.some(c => /Continuity/.test(c.check)), 'reconciliation includes month continuity');
const nonCash = R.reconciliation.differences.filter(c => c.check !== 'Cash on hand vs physical count');
eq(nonCash.length, 0, 'every check except the operator\'s cash count agrees',
    nonCash.map(c => `${c.check}: ${c.difference}`).join('; '));
if (!R.reconciliation.all_ok) {
    ok(R.notes.gaps.some(g => /physical count/i.test(g)),
        'the flagged cash difference is explained in the data-gap notes');
}

// ──────────────────────────────────────────────────────────────
hr('8. Excel sheet — same engine, same totals');
// ──────────────────────────────────────────────────────────────
const xlsxPath = path.join(tmpDir, 'Monthly_Report_Export.xlsx');
const exp = exporter.exportMonthlyReportExcel(db, xlsxPath, { from_date: R.from_date, to_date: R.to_date });
ok(exp.success, 'the Monthly Report workbook is written', exp.error);
const wb = XLSX.readFile(xlsxPath);
eq(wb.SheetNames.length, 1, 'the export contains the Monthly Report sheet');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
const findValue = (label) => {
    const row = rows.find(r => String(r[0]).trim() === label);
    return row ? Number(row[1]) : null;
};
near(findValue('Sales Revenue (excl. opening balances)'), R.summary.sales_revenue, 0.01, 'sheet sales revenue = engine');
near(findValue('Cost of Goods Sold'), R.summary.cogs, 0.01, 'sheet COGS = engine');
near(findValue('Gross Profit'), R.summary.gross_profit, 0.01, 'sheet gross profit = engine');
near(findValue('Total Operating Expenses'), R.summary.operating_expenses, 0.01, 'sheet operating expenses = engine');
near(findValue('Net Profit / (Loss)'), R.summary.net_profit, 0.01, 'sheet net profit = engine');
near(findValue('Closing Cash Balance'), R.summary.closing_cash, 0.01, 'sheet closing cash = engine');
near(findValue('Closing Bank Balance'), R.summary.closing_bank, 0.01, 'sheet closing bank = engine');
near(findValue('Prepaid Rent Balance (asset)'), R.summary.prepaid_rent, 0.01, 'sheet prepaid rent = engine');
for (const s of ['A', 'B', 'C', 'D', 'E']) {
    ok(rows.some(r => String(r[0]).startsWith(`SECTION ${s} —`)), `the sheet has Section ${s}`);
}
ok(rows.some(r => String(r[0]).startsWith('Month') && String(r[2]) === 'End (BS)'), 'Section D has a row per month with BS start/end');
for (const head of R.income_heads) {
    ok(rows.some(r => String(r[0]).trim() === head.head), `Section B lists the income head "${head.head}"`);
}
for (const head of R.expense_heads) {
    ok(rows.some(r => String(r[0]).trim() === head.head), `Section C lists the expense head "${head.head}"`);
}
ok(rows.some(r => String(r[0]).startsWith('FLAG') || String(r[4]) === 'FLAG') || R.reconciliation.all_ok,
    'Section E shows the status of every check');
ok(rows.some(r => /DATA GAPS/.test(String(r[0]))), 'the sheet states the data gaps');

// ──────────────────────────────────────────────────────────────
hr('9. The workbook edit preserves the customer\'s own workbook');
// ──────────────────────────────────────────────────────────────
const srcWb = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
if (!fs.existsSync(srcWb)) {
    console.log('  (skipped — workbook not present)');
} else {
    const workCopy = path.join(tmpDir, 'workbook-copy.xlsx');
    fs.copyFileSync(srcWb, workCopy);
    const before = XLSX.readFile(workCopy).SheetNames;
    const res = exporter.insertMonthlyReportSheet(workCopy, db, { from_date: R.from_date, to_date: R.to_date });
    ok(res.success, 'the sheet is inserted into the existing workbook', res.error);
    const afterWb = XLSX.readFile(workCopy);
    const after = afterWb.SheetNames;
    const lost = before.filter(s => !after.includes(s));
    eq(lost.length, 0, `all ${before.length} existing sheets are preserved`, lost.join(', '));
    ok(after.some(s => s.replace(/\s+$/, '') === 'Monthly Report'), 'the new sheet is named "Monthly Report"');
    // If the sheet was already there (the normal state after the first
    // --apply), inserting must REFRess in place; otherwise it must add one.
    const hadMR = before.some(s => /^Monthly Report\s*$/.test(s));
    const expectedOnce = hadMR ? before.length : before.length + 1;
    eq(after.length, expectedOnce, hadMR
        ? 'the existing Monthly Report sheet was refreshed in place (no duplicates)'
        : 'exactly one sheet was added');
    // Part-level preservation: a SheetJS read/write once destroyed the
    // workbook's 72 fonts, 296 number formats, its chart, table and printer
    // settings — prove that cannot happen again.
    const { readZip, locateSheetPart } = require(path.join(ROOT, 'shared', 'xlsx-parts'));
    const partA = readZip(fs.readFileSync(res.backupPath));
    const partB = readZip(fs.readFileSync(workCopy));
    const mutableParts = new Set([
        '[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml'
    ]);
    // …and the Monthly Report sheet's own part (before and/or after), which is
    // exactly what this operation is supposed to rewrite.
    for (const pz of [partA, partB]) {
        const p = locateSheetPart(pz, 'Monthly Report ');
        if (p) mutableParts.add(p);
    }
    const broken = partA.order.filter(n => !mutableParts.has(n)
        && (!partB.entries.has(n) || !partA.entries.get(n).data.equals(partB.entries.get(n).data)));
    eq(broken.length, 0, 'every other zipped part (styles, chart, table, drawings) is byte-identical', broken.join(', '));
    ok(fs.existsSync(res.backupPath), 'a timestamped backup of the workbook was written');
    // Every pre-existing sheet still has its data.
    const stillHasRows = before.every(s => {
        const r = XLSX.utils.sheet_to_json(afterWb.Sheets[s], { header: 1, defval: '' });
        return r.length > 0;
    });
    ok(stillHasRows, 'no existing sheet was emptied');
    // Refreshing must not duplicate the sheet.
    const res2 = exporter.insertMonthlyReportSheet(workCopy, db, { from_date: R.from_date, to_date: R.to_date });
    ok(res2.success, 'the sheet can be refreshed');
    eq(XLSX.readFile(workCopy).SheetNames.length, expectedOnce, 'refreshing does not add a second Monthly Report sheet');
}

// ──────────────────────────────────────────────────────────────
hr('10. Missing/unreliable data is reported, not hidden');
// ──────────────────────────────────────────────────────────────
ok(Array.isArray(R.notes.gaps), 'the report carries a data-gap list');
if (R.closing.inventory_value === 0 || R.balances_asof.negative_stock_lines.length) {
    ok(R.notes.gaps.some(g => /negative/i.test(g)),
        'negative closing stock is reported as a gap (stock cannot be valued)');
}
ok(R.notes.gaps.some(g => /Opening cash and bank balances/i.test(g)),
    'the missing opening cash/bank balances are stated');
console.log('  Data gaps reported:');
R.notes.gaps.forEach(g => console.log('   · ' + g));

// ──────────────────────────────────────────────────────────────
hr('RESULT');
console.log(`  ${pass} passed, ${fail} failed`);
console.log(`  Period: ${R.from_date} → ${R.to_date} · revenue ${R.summary.sales_revenue} · COGS ${R.summary.cogs}`
    + ` · opex ${R.summary.operating_expenses} · net ${R.summary.net_profit}`);
console.log(`  Closing: cash ${R.summary.closing_cash} · bank ${R.summary.closing_bank}`
    + ` · inventory ${R.summary.closing_inventory} · prepaid rent ${R.summary.prepaid_rent}`);
if (fail) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✅ Monthly Report verified against the real books.');
