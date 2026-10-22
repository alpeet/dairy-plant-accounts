#!/usr/bin/env node
/**
 * Workbook → database reconciliation
 * ==================================
 * Reads the source workbook and the application database and reports, per
 * module, the source total, what the database holds, and the difference.
 *
 *   node scripts/audit/reconcile-workbook.js
 *   WORKBOOK_PATH=... DB_PATH=... node scripts/audit/reconcile-workbook.js
 *
 * Never writes anything. Exits 0 even when differences exist — the report is
 * the deliverable, and a difference is a finding, not a crash.
 */

const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const WORKBOOK_PATH = process.env.WORKBOOK_PATH || path.join(ROOT, 'Dairy_Accounts_Professional TRIAL.xlsx');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'dairy-plant.db');

const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
};
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function rowsOf(wb, name) {
    if (!wb.SheetNames.includes(name)) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: false });
}

/**
 * A row is "real" when its payee/party cell is present and it is not the
 * workbook's own TOTAL line or a cancelled voucher.
 */
function isRealRow(row, partyIdx) {
    const party = str(row[partyIdx]).toLowerCase();
    if (!party) return false;
    if (party === 'totals ►' || party.startsWith('total')) return false;
    if (party === 'canceled' || party === 'cancelled') return false;
    return true;
}

function main() {
    const wb = XLSX.readFile(WORKBOOK_PATH);
    const db = new Database(DB_PATH, { readonly: true });
    const q = (sql) => db.prepare(sql).get();

    const checks = [];
    const add = (module, sheet, srcRows, srcTotal, dbRows, dbTotal, note = '') => {
        checks.push({
            module, sheet,
            source_rows: srcRows,
            source_total: round2(srcTotal),
            db_rows: dbRows,
            db_total: round2(dbTotal),
            row_difference: dbRows - srcRows,
            total_difference: round2(dbTotal - srcTotal),
            note
        });
    };

    // ── Sales_Entry → sales (invoice level; sheet is line level) ──
    {
        const rows = rowsOf(wb, 'Sales_Entry');
        let lines = 0, total = 0;
        const invoices = new Set();
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            if (!str(r[3]) || !str(r[2])) continue;
            if (!isRealRow(r, 3)) continue;
            lines++;
            total += num(r[9]) || num(r[7]);
            invoices.add(`${str(r[2])}|${str(r[3])}|${str(r[0])}`);
        }
        const d = q("SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) t FROM sales");
        add('Sales', 'Sales_Entry', invoices.size, total, d.c, d.t,
            `${lines} sheet lines group into ${invoices.size} invoices`);
    }

    // ── Collection + Payment → payments ──
    // The Collection sheet carries ONE FEWER column than Payment/Expenses/Advance:
    // there is no Description column, so Type sits at 5, Collected at 7, Paid at 8.
    {
        const rows = rowsOf(wb, 'Collection');
        let n = 0, total = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const type = str(r[5]).toLowerCase();
            const amount = num(r[7]) || num(r[8]);
            if (!amount) continue;
            if (!isRealRow(r, 3)) continue;
            if (!/^(collection|receipt)$/.test(type)) continue;
            n++; total += amount;
        }
        const d = q("SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM payments WHERE type='receipt'");
        add('Collection', 'Collection', n, total, d.c, d.t,
            'receipts only; the sheet also holds payment/advance rows, which go to the Payment/Advance registers');
    }

    {
        const rows = rowsOf(wb, 'Payment');
        let n = 0, total = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const amount = num(r[9]);
            if (!amount) continue;
            if (str(r[6]).toLowerCase() !== 'payment') continue;
            if (!isRealRow(r, 3)) continue;
            n++; total += amount;
        }
        const d = q("SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM payments WHERE type='payment'");
        add('Payment register', 'Payment', n, total, d.c, d.t);
        const pc = q("SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM petty_cash WHERE LOWER(expense_head) NOT IN ('advance') AND LOWER(paid_to) NOT LIKE '%office expense%'");
        checks[checks.length - 1].note = `petty-cash vouchers with the same rows: ${pc.c} / ${round2(pc.t)}`;
    }

    // ── Expenses → petty_cash (office vouchers) ──
    {
        const rows = rowsOf(wb, 'Expenses');
        let n = 0, total = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const amount = num(r[9]);
            if (!amount) continue;
            if (str(r[6]).toUpperCase() !== 'OFFICE EXPENSES') continue;
            if (!isRealRow(r, 3)) continue;
            n++; total += amount;
        }
        const d = q(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM petty_cash
                     WHERE UPPER(TRIM(COALESCE(expense_head,''))) NOT IN ('ADVANCE')
                       AND LOWER(TRIM(COALESCE(paid_to,''))) LIKE '%office expense%'`);
        add('Expenses', 'Expenses', n, total, d.c, d.t);
    }

    // ── Advance → petty_cash 'Advance' + payments(type=advance) ──
    {
        const rows = rowsOf(wb, 'Advance');
        let n = 0, total = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const amount = num(r[9]);
            if (!amount) continue;
            if (str(r[6]).toLowerCase() !== 'advance') continue;
            if (!isRealRow(r, 3)) continue;
            n++; total += amount;
        }
        const d = q("SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM petty_cash WHERE UPPER(TRIM(COALESCE(expense_head,''))) = 'ADVANCE'");
        add('Advance', 'Advance', n, total, d.c, d.t);
    }

    // ── Salary Advance → salary_records ──
    {
        const rows = rowsOf(wb, 'Salary Advance');
        let n = 0, total = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const name = str(r[1]);
            if (!name) continue;
            const net = num(r[8]);
            if (!net) continue;
            n++; total += net;
        }
        const d = q('SELECT COUNT(*) c, COALESCE(SUM(net_salary),0) t FROM salary_records');
        add('Salary', 'Salary Advance', n, total, d.c, d.t);
    }

    // ── BANK RECON → bank_transactions ──
    {
        const rows = rowsOf(wb, 'BANK RECON');
        let n = 0, total = 0;
        for (let i = 3; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            const cp = str(r[3]);
            const desc = str(r[4]);
            if (!cp && !desc) continue;
            const amount = num(r[8]) || num(r[7]) || num(r[6]);
            if (!amount) continue;
            n++; total += amount;
        }
        const d = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM bank_transactions');
        add('Bank', 'BANK RECON', n, total, d.c, d.t);
    }

    // ── Party_Master → parties ──
    {
        const rows = rowsOf(wb, 'Party_Master');
        let n = 0;
        for (let i = 2; i < (rows ? rows.length : 0); i++) {
            if (str((rows[i] || [])[0])) n++;
        }
        const d = q('SELECT COUNT(*) c, 0 t FROM parties');
        add('Parties', 'Party_Master', n, 0, d.c, 0);
    }

    // ── Cash_Demon → denomination_counts ──
    {
        const rows = rowsOf(wb, 'Cash_Demon');
        let n = 0, total = 0;
        for (let i = 3; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            if (!str(r[0])) continue;
            const any = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].some((c) => num(r[c]));
            if (!any) continue;
            n++; total += num(r[12]);
        }
        const d = q('SELECT COUNT(*) c, COALESCE(SUM(total_cash),0) t FROM denomination_counts');
        add('Cash count', 'Cash_Demon', n, total, d.c, d.t);
    }

    // ── Purchase_Entry → purchases (+ milk split) ──
    {
        const rows = rowsOf(wb, 'Purchase_Entry');
        let n = 0, total = 0;
        for (let i = 3; i < (rows ? rows.length : 0); i++) {
            const r = rows[i] || [];
            if (!str(r[2]) || !str(r[3])) continue;
            if (!isRealRow(r, 3)) continue;
            n++; total += num(r[15]) || num(r[13]);
        }
        const d = q('SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) t FROM purchases');
        const milk = q('SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM milk_collections');
        add('Purchases', 'Purchase_Entry', n, total, d.c, d.t,
            `purchases ${d.c}/${round2(d.t)} + milk_collections ${milk.c}/${round2(milk.t)}`);
    }

    // ── report ──
    console.log(`WORKBOOK ${WORKBOOK_PATH}`);
    console.log(`DATABASE ${DB_PATH}\n`);
    const pad = (s, n) => String(s).padEnd(n);
    const lpad = (s, n) => String(s).padStart(n);
    console.log(pad('MODULE', 17) + pad('SHEET', 16) + lpad('SRC ROWS', 10) + lpad('DB ROWS', 10)
        + lpad('SRC TOTAL', 16) + lpad('DB TOTAL', 16) + lpad('DIFF', 14));
    console.log('─'.repeat(99));
    for (const c of checks) {
        console.log(pad(c.module, 17) + pad(c.sheet, 16) + lpad(c.source_rows, 10) + lpad(c.db_rows, 10)
            + lpad(c.source_total.toFixed(2), 16) + lpad(c.db_total.toFixed(2), 16)
            + lpad(c.total_difference.toFixed(2), 14));
        if (c.note) console.log(`${''.padEnd(17)}↳ ${c.note}`);
    }
    console.log('─'.repeat(99));

    const mismatched = checks.filter((c) => Math.abs(c.total_difference) > 1);
    console.log(`\n${checks.length} modules checked, ${mismatched.length} with a total difference > Rs 1.`);
    if (mismatched.length) {
        console.log('Modules needing explanation: ' + mismatched.map((m) => m.module).join(', '));
    }
    db.close();
}

if (require.main === module) main();
module.exports = { main };
