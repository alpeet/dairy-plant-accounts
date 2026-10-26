#!/usr/bin/env node
/**
 * test-report-drilldown.js — Monthly Report drill-down acceptance checks
 * ======================================================================
 *   node scripts/audit/test-report-drilldown.js
 *
 * Proves requirement 1 of the drill-down brief:
 *   · every Monthly Report line the UI shows has a working drill-down;
 *   · the drill-down's rows are the SAME records the report counted — its
 *     total reconciles to the figure printed on the report (≤ 5 paisa);
 *   · the selected month / date range is preserved when opening a detail;
 *   · filters narrow the ROW LIST but never change the reported figure;
 *   · every row names its module, workbook sheet, record id and the screen
 *     where the user can open the original record;
 *   · an unknown line or an invalid month is refused, never silently priced.
 *
 * Runs against a THROWAWAY COPY of the real database (never the live file).
 * Exit 0 = all checks pass, 1 = at least one failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
const cal = require(path.join(ROOT, 'shared', 'bs-calendar'));
const monthly = require(path.join(ROOT, 'shared', 'operations', 'monthly_report'));
const drill = require(path.join(ROOT, 'shared', 'operations', 'report_drilldown'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; return true; }
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    return false;
}
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-test-'));
const DB = path.join(tmpDir, 'drilldown-test.db');
fs.copyFileSync(SRC, DB);
console.log(`Source database : ${SRC}`);
console.log(`Working copy    : ${DB}`);
const db = new Database(DB);

// ──────────────────────────────────────────────────────────────
hr('1. The line registry covers every figure the report prints');
// ──────────────────────────────────────────────────────────────
const lines = drill.listLines();
ok(lines.length === 21, '21 report lines are offered for drill-down', `got ${lines.length}`);
const summaryKeys = [
    'opening_cash', 'opening_bank', 'opening_inventory', 'sales_revenue', 'other_income',
    'total_income', 'milk_cost', 'other_purchases', 'cogs', 'gross_profit',
    'total_operating_expenses', 'net_profit', 'closing_cash', 'closing_bank',
    'closing_inventory', 'receivables', 'payables', 'advances',
    'loan_receivable', 'loan_payable', 'prepaid_rent'
];
for (const key of summaryKeys) {
    const line = lines.find(l => l.key === key);
    ok(!!line, `line "${key}" exists in the registry`);
    ok(!!line && !!line.label && !!line.label_np, `line "${key}" has an English AND a Nepali label`);
    ok(!!line && ['transaction', 'balance', 'formula'].includes(line.basis), `line "${key}" declares a basis`);
}

// ──────────────────────────────────────────────────────────────
hr('2. Every line reconciles for every month in the book');
// ──────────────────────────────────────────────────────────────
const MS_NAMES = { '01': 'Baisakh', '02': 'Jestha', '03': 'Ashadh', '04': 'Shrawan', '05': 'Bhadra', '06': 'Ashoj', '07': 'Kartik' };
const months = ['2083-04', '2083-05', '2083-06', '2083-07'];
let reconciled = 0, flagged = 0;

for (const month of months) {
    const range = cal.bsMonthRange(month);
    const report = monthly.getMonthlyReport(db, { from_date: range.from_date, to_date: range.to_date });
    console.log(`\n  ${month} (${MS_NAMES[month.slice(5)]} 2083) — ${range.from_date} → ${range.to_date}`);

    for (const key of summaryKeys) {
        const d = drill.getMonthlyReportLine(db, { month, line: key });
        const tag = `${key} @ ${month}`;
        // The printed figure is the report's own number, not a second calculation.
        near(d.reported, report.summary[key], 0.005, `${tag}: reported figure is the report's figure`);
        // The rows reconcile to that figure.
        ok(d.matches, `${tag}: rows reconcile to the figure`, `diff ${d.difference} (reported ${d.reported}, detail ${d.detail_total})`);
        if (d.matches) reconciled++; else flagged++;
        // Month navigation is preserved.
        ok(d.from_date === range.from_date && d.to_date === range.to_date,
            `${tag}: drill-down covers exactly the selected month`);
        ok(d.row_count === d.rows.length, `${tag}: row count matches the row list`);
        // A difference is surfaced as an audit defect, never hidden.
        ok(d.flagged === !d.matches, `${tag}: flagged state mirrors the reconciliation`);
        if (d.flagged) ok(!!d.flag_reason, `${tag}: a flagged line explains why`);
        // Every row is traceable.
        for (const r of d.rows.slice(0, 40)) {
            if (!r || typeof r !== 'object') { ok(false, `${tag}: row is an object`); break; }
        }
        const badRow = d.rows.find(r => !r.record_table || r.record_id == null);
        if (d.basis === 'transaction') {
            ok(!badRow, `${tag}: every row names its table and record id`,
                badRow ? `${badRow.record_table}#${badRow.record_id}` : '');
        }
        if (d.rows.length) {
            const noModule = d.rows.find(r => !r.source_module);
            ok(!noModule, `${tag}: every row names the app module it came from`);
            const noEdit = d.rows.find(r => r.record_table && r.record_table !== 'ledger_entries' && !r.edit_page);
            ok(!noEdit, `${tag}: every row can be opened on a screen`,
                noEdit ? `${noEdit.record_table}#${noEdit.record_id}` : '');
        }
        if (d.basis === 'formula') {
            ok(Array.isArray(d.formula) && d.formula.length > 0, `${tag}: a calculated total shows its components`);
        }
        if (d.basis === 'transaction' && d.rows.length) {
            const rowSum = Math.round(d.rows.reduce((s, r) => s + (r.amount || 0), 0) * 100 + Number.EPSILON) / 100;
            near(rowSum, d.reported, 0.05, `${tag}: the listed amounts add up to ₹${d.reported}`);
        }
    }
}

ok(reconciled === months.length * summaryKeys.length,
    `every one of the ${months.length * summaryKeys.length} line checks reconciled clean`, `${flagged} flagged`);

// ──────────────────────────────────────────────────────────────
hr('3. Source sheets and voucher fields are named');
// ──────────────────────────────────────────────────────────────
const ashoj = '2083-06';
const sales = drill.getMonthlyReportLine(db, { month: ashoj, line: 'sales_revenue' });
ok(sales.source_sheets.includes('Sales'), 'sales revenue rows name the Sales workbook sheet');
ok(sales.rows.length > 0 && sales.rows.every(r => r.date && r.voucher), 'each sales row has a date and a voucher number');
ok(sales.rows.every(r => r.party !== undefined), 'each sales row carries the party name');
const milk = drill.getMonthlyReportLine(db, { month: ashoj, line: 'milk_cost' });
ok(milk.source_sheets.includes('Milk_Collection'), 'milk cost rows name the Milk_Collection sheet');
ok(milk.rows.some(r => r.quantity != null && r.rate != null), 'milk rows carry quantity and rate');
const expenses = drill.getMonthlyReportLine(db, { month: ashoj, line: 'total_operating_expenses' });
ok(expenses.rows.every(r => r.category), 'expense rows carry an account category');
ok(expenses.source_sheets.length > 0, 'expense rows name their source sheet(s)');

// ──────────────────────────────────────────────────────────────
hr('4. Filters narrow the rows but never the figure');
// ──────────────────────────────────────────────────────────────
const allPurchases = drill.getMonthlyReportLine(db, { month: ashoj, line: 'other_purchases' });
const party = (allPurchases.rows.find(r => r.party) || {}).party;
if (party) {
    const filtered = drill.getMonthlyReportLine(db, { month: ashoj, line: 'other_purchases', filters: { party } });
    ok(filtered.rows.length <= allPurchases.rows.length, 'a party filter returns a subset of rows');
    near(filtered.reported, allPurchases.reported, 0.005, 'a filter never changes the reported figure');
    ok(filtered.row_count === filtered.rows.length, 'a filtered drill-down reports its own row count');
    ok(filtered.total_rows_before_filters === allPurchases.rows.length, 'the unfiltered row count is kept');
}
const dateFiltered = drill.getMonthlyReportLine(db, {
    month: ashoj, line: 'sales_revenue',
    filters: { from: cal.bsMonthRange(ashoj).from_date, to: cal.bsMonthRange(ashoj).from_date }
});
ok(dateFiltered.rows.every(r => !r.date || r.date === dateFiltered.from_date), 'a date filter keeps only that day');
near(dateFiltered.reported, sales.reported, 0.005, 'a date filter never changes the reported figure');
const byModule = drill.getMonthlyReportLine(db, { month: ashoj, line: 'net_profit', filters: { type: 'sales' } });
ok(byModule.rows.every(r => /sales/.test((r.source_module || '').toLowerCase()) || /sales/.test(r.record_table)),
    'a type filter keeps only that module');

// ──────────────────────────────────────────────────────────────
hr('5. A date-range call gives the same answer as the month call');
// ──────────────────────────────────────────────────────────────
const rng = cal.bsMonthRange(ashoj);
for (const key of ['sales_revenue', 'other_purchases', 'net_profit', 'closing_cash']) {
    const a = drill.getMonthlyReportLine(db, { month: ashoj, line: key });
    const b = drill.getMonthlyReportLine(db, { from_date: rng.from_date, to_date: rng.to_date, line: key });
    near(b.reported, a.reported, 0.005, `${key}: month and date-range drill-downs agree`);
    near(b.detail_total, a.detail_total, 0.005, `${key}: the same rows are listed either way`);
}

// ──────────────────────────────────────────────────────────────
hr('6. Bad input is refused, not priced');
// ──────────────────────────────────────────────────────────────
let threw = false;
try { drill.getMonthlyReportLine(db, { month: ashoj, line: 'not_a_line' }); } catch (e) { threw = /Unknown Monthly Report line/.test(e.message); }
ok(threw, 'an unknown line is refused with a clear message');
threw = false;
try { drill.getMonthlyReportLine(db, { month: '2083-00', line: 'sales_revenue' }); } catch (e) { threw = true; }
ok(threw, 'an invalid BS month is refused');
threw = false;
try { drill.getMonthlyReportLine(db, { from_date: '2083-06-31', to_date: '2083-06-01', line: 'sales_revenue' }); } catch (e) { threw = true; }
ok(threw, 'a reversed date range is refused');

// ──────────────────────────────────────────────────────────────
hr('7. Balance lines explain themselves (opening → additions → reductions)');
// ──────────────────────────────────────────────────────────────
for (const key of ['opening_cash', 'closing_cash', 'opening_bank', 'closing_bank', 'closing_inventory', 'prepaid_rent', 'receivables', 'payables']) {
    const d = drill.getMonthlyReportLine(db, { month: ashoj, line: key });
    ok(!!d.scope_note, `${key}: explains what the rows cover`);
    ok(Array.isArray(d.formula) && d.formula.length > 0, `${key}: shows how the balance is made up`);
}

// ──────────────────────────────────────────────────────────────
hr('8. The drill-down never mutates the book');
// ──────────────────────────────────────────────────────────────
const SIGNATURE_SQL = {
    sales: 'SELECT COUNT(*) c, COALESCE(SUM(grand_total), 0) s FROM sales',
    purchases: 'SELECT COUNT(*) c, COALESCE(SUM(grand_total), 0) s FROM purchases',
    milk: 'SELECT COUNT(*) c, COALESCE(SUM(amount), 0) s FROM milk_collections'
};
const signatures = t => db.prepare(SIGNATURE_SQL[t]).get();
const before = { sales: signatures('sales'), purchases: signatures('purchases'), milk: signatures('milk') };
for (const key of summaryKeys) drill.getMonthlyReportLine(db, { month: ashoj, line: key });
const after = { sales: signatures('sales'), purchases: signatures('purchases'), milk: signatures('milk') };
ok(JSON.stringify(before) === JSON.stringify(after), 'reading a drill-down leaves the data untouched');

// ──────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(68));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('\n  FAILURES:');
    for (const f of failures) console.log('   · ' + f);
    console.log('═'.repeat(68));
    process.exit(1);
}
console.log('  ✅ Every Monthly Report line drills down to its own records.');
console.log('═'.repeat(68));
