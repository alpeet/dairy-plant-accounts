#!/usr/bin/env node
/**
 * Confirm workbook → database totals, sheet by sheet.
 * ==================================================
 * A second, independent check to `reconcile-records.js`: instead of matching
 * rows, this adds up each sheet's money column and the corresponding database
 * module and prints the difference. Row matching can hide a pair of errors that
 * cancel out; totals cannot.
 *
 *   WORKBOOK_PATH="Dairy_Accounts_Professional 76.xlsx" \
 *   DB_PATH=data/dairy-plant.db node scripts/audit/confirm-workbook-totals.js
 *
 * Read-only. Exits 1 when a sheet differs by more than the tolerance.
 */

const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const { workbookPath } = require('../../shared/workbook-path');

const ROOT = path.join(__dirname, '..', '..');
const WORKBOOK_PATH = process.env.WORKBOOK_PATH || workbookPath();
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'dairy-plant.db');
const TOL = Number(process.env.TOL || 1);

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/[, ]/g, '').replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
};
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function bsDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 10000) {
        const d = new Date(EXCEL_EPOCH + Math.round(v) * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(str(v));
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : str(v);
}

function rows(wb, name) {
    if (!wb.SheetNames.includes(name)) return [];
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true });
}

function main() {
    const wb = XLSX.readFile(WORKBOOK_PATH);
    const db = new Database(DB_PATH, { readonly: true });
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const checks = [];
    const add = (label, sheet, src, dbTotal, note = '') =>
        checks.push({ label, sheet, source: r2(src), database: r2(dbTotal), difference: r2(dbTotal - src), note });

    // ── Sales: revenue documents, opening (OPN-) and void rows excluded ────
    {
        let total = 0, lines = 0, invoices = new Set(), excluded = 0, internal = 0, internalRows = 0;
        for (const [i, r] of rows(wb, 'Sales_Entry').entries()) {
            if (i < 2) continue;
            const inv = str(r[2]); const party = str(r[3]).toUpperCase(); const net = num(r[9]) || num(r[7]);
            if (!party) continue;                       // totals / heading rows carry no party
            if (/^TOTALS/i.test(party)) continue;        // summary line, not a transaction
            if (/^CANCELED|^CANCELLED/.test(party)) { excluded += net; continue; }
            if (/^OPN-/.test(inv)) continue;            // brought-forward receivable, not revenue
            total += net; lines++;
            if (inv) invoices.add(inv + '|' + party + '|' + bsDate(r[0]));
            else { internal += net; internalRows++; }   // internal issue rows: no invoice number
        }
        // Rent income lives in Party_Ledger (type "rent"), never in Sales_Entry;
        // the app books the same money as internal documents, so it has to be
        // added here for the two sides to describe the same thing.
        let rent = 0, rentRows = 0;
        for (const [i, r] of rows(wb, 'Party_Ledger').entries()) {
            if (i < 2 || str(r[3]).toLowerCase() !== 'rent') continue;
            if (!bsDate(r[0])) continue;
            rent += num(r[7]) || num(r[6]); rentRows++;
        }
        const d = one(`SELECT COALESCE(SUM(grand_total),0) t, COUNT(*) c FROM sales
                       WHERE UPPER(COALESCE(invoice_no,'')) NOT LIKE 'OPN-%'`);
        add('Sales revenue + rent income (excl. opening)', 'Sales_Entry', total + rent, d.t,
            `${invoices.size} invoices + ${internalRows} internal-issue rows (Rs ${r2(internal)}) · ${lines} lines · ` +
            `${rentRows} rent rows Rs ${r2(rent)} from Party_Ledger · ${d.c} documents · void rows ignored ${r2(excluded)}`);
        // Opening documents: the workbook's Profit_Loss sums them into revenue,
        // the app keeps them out — reported so the difference is never a mystery.
        let opn = 0, opnRows = 0;
        for (const [i, r] of rows(wb, 'Sales_Entry').entries()) {
            if (i < 2 || !/^OPN-/.test(str(r[2]))) continue;
            opn += num(r[9]) || num(r[7]); opnRows++;
        }
        const dbOpn = one(`SELECT COALESCE(SUM(grand_total),0) t FROM sales WHERE UPPER(COALESCE(invoice_no,'')) LIKE 'OPN-%'`);
        add('Opening (OPN-) documents, held out of revenue', 'Sales_Entry', opn, dbOpn.t,
            `${opnRows} opening rows · workbook Profit_Loss includes them in Total Sales Revenue, the app carries them as brought-forward balances`);
        // Item-line sum: every stored invoice's items must add to its header.
        const bad = db.prepare(`SELECT s.id, s.invoice_no, s.grand_total,
                (SELECT COALESCE(SUM(amount),0) FROM sales_items WHERE sale_id=s.id) items
                FROM sales s WHERE s.grand_total > 0.009
                  AND UPPER(COALESCE(s.invoice_no,'')) NOT LIKE 'OPN-%'
                  AND ABS(s.grand_total - (SELECT COALESCE(SUM(amount),0) FROM sales_items WHERE sale_id=s.id)) > 0.5`)
            .all();
        checks.push({ label: 'Sales: item lines vs invoice total', sheet: 'Sales_Entry',
            source: 0, database: bad.length, difference: bad.length, note: bad.length ? 'invoices where lines ≠ total' : 'every invoice foots (opening documents carry no items)' });
    }

    // ── Purchases ─────────────────────────────────────────────────────────
    {
        let total = 0, lines = 0;
        for (const [i, r] of rows(wb, 'Purchase_Entry').entries()) {
            if (i < 2) continue;
            const bill = str(r[2]); const party = str(r[3]).toUpperCase(); const net = num(r[15]) || num(r[13]);
            if (!bill || !party || !net) continue;
            if (/^OPN/.test(bill)) continue;
            total += net; lines++;
        }
        const d = one(`SELECT COALESCE(SUM(grand_total),0) t, COUNT(*) c FROM purchases
                       WHERE UPPER(COALESCE(bill_no,'')) NOT LIKE 'OPN%'`);
        add('Purchases (excl. opening bills)', 'Purchase_Entry', total, d.t, `${lines} sheet lines · ${d.c} documents`);
    }

    // ── Collection receipts ───────────────────────────────────────────────
    {
        let total = 0, n = 0, returned = 0, returnedRows = 0;
        for (const [i, r] of rows(wb, 'Collection').entries()) {
            if (i < 2) continue;
            const type = str(r[5]).toLowerCase();
            if (type && !/^(collection|receipt|advance returned)$/.test(type)) continue;
            const amt = num(r[7]) || num(r[8]);
            if (!amt || !str(r[3])) continue;
            total += amt; n++;
            if (type === 'advance returned') { returned += amt; returnedRows++; }
        }
        const rentReceipts = one(`SELECT COALESCE(SUM(amount),0) t FROM payments
                       WHERE type='receipt' AND COALESCE(transaction_type,'') = ''
                         AND COALESCE(notes,'') LIKE '%ELECTRICITY%'`);
        const d = one(`SELECT COALESCE(SUM(amount),0) t, COUNT(*) c FROM payments
                       WHERE type='receipt'
                         AND NOT (COALESCE(transaction_type,'') = '' AND COALESCE(notes,'') LIKE '%ELECTRICITY%')`);
        add('Collections (receipts)', 'Collection', total, d.t,
            `${n} sheet rows (incl. ${returnedRows} advance returns Rs ${r2(returned)}) · ${d.c} receipts · ` +
            `the 3 rent receipts Rs ${r2(rentReceipts.t)} are excluded here and checked on their own line below`);
    }

    // ── Rent income: Party_Ledger → rent receipts + internal documents ─────
    {
        let rent = 0, rentRows = 0;
        for (const [i, r] of rows(wb, 'Party_Ledger').entries()) {
            if (i < 2 || str(r[3]).toLowerCase() !== 'rent') continue;
            if (!bsDate(r[0])) continue;
            rent += num(r[7]) || num(r[6]); rentRows++;
        }
        const rentReceipts2 = one(`SELECT COALESCE(SUM(amount),0) t, COUNT(*) c FROM payments
                       WHERE type='receipt' AND COALESCE(transaction_type,'') = ''
                         AND COALESCE(notes,'') LIKE '%ELECTRICITY%'`);
        add('Rent income (Party_Ledger → rent receipts)', 'Party_Ledger', rent, rentReceipts2.t,
            `${rentRows} ledger rows · ${rentReceipts2.c} receipt rows · the same money is also booked as internal sale documents so it enters income once`);
    }

    // ── Payment register ──────────────────────────────────────────────────
    {
        let total = 0, n = 0;
        for (const [i, r] of rows(wb, 'Payment').entries()) {
            if (i < 2) continue;
            if (str(r[6]).toLowerCase() !== 'payment') continue;
            const amt = num(r[9]);
            if (!amt || !str(r[3])) continue;
            total += amt; n++;
        }
        const d = one("SELECT COALESCE(SUM(amount),0) t, COUNT(*) c FROM payments WHERE type='payment'");
        add('Payment register', 'Payment', total, d.t, `${n} sheet rows · ${d.c} payments`);
    }

    // ── Expense registers (Expenses + PETTY CASH sheets) ──────────────────
    // Both sheets carry the same columns; the Type column decides where a row
    // belongs: OFFICE EXPENSES / PETTY CASH / SALARY / INVESTMENT. A voucher
    // is looked up by amount + description, never by date — the bank statement
    // copies two of these rows with a different date.
    {
        const wanted = ['OFFICE EXPENSES', 'PETTY CASH', 'SALARY', 'INVESTMENT'];
        const source = { };
        for (const sheetName of ['Expenses', 'PETTY CASH']) {
            for (const [i, r] of rows(wb, sheetName).entries()) {
                if (i < 2) continue;
                const type = str(r[6]).toUpperCase(); const amt = num(r[9]);
                if (!wanted.includes(type) || !amt) continue;
                source[type] = source[type] || { rows: 0, total: 0 };
                source[type].rows++; source[type].total += amt;
            }
        }
        const vouchers = db.prepare(`SELECT id, date, amount, description, paid_to, expense_head FROM petty_cash`).all();
        const pool = new Map();
        const keyOf = (amount, text) => `${r2(amount)}|${String(text || '').toUpperCase().replace(/\s+/g, ' ').trim().slice(0, 30)}`;
        for (const v of vouchers) {
            const k = keyOf(v.amount, v.description);
            pool.set(k, (pool.get(k) || 0) + 1);
        }
        const match = (rowsForType) => {
            let hit = 0, missing = [];
            for (const row of rowsForType) {
                const k = keyOf(row.amt, row.desc);
                const n = pool.get(k) || 0;
                if (n > 0) { pool.set(k, n - 1); hit++; }
                else missing.push(row);
            }
            return { hit, missing };
        };
        const collect = (types) => {
            const out = [];
            for (const sheetName of ['Expenses', 'PETTY CASH']) {
                for (const [i, r] of rows(wb, sheetName).entries()) {
                    if (i < 2) continue;
                    const type = str(r[6]).toUpperCase(); const amt = num(r[9]);
                    if (!types.includes(type) || !amt) continue;
                    out.push({ sheet: sheetName, row: i + 1, type, amt, desc: str(r[5]) });
                }
            }
            return out;
        };
        const officeAndPetty = collect(['OFFICE EXPENSES', 'PETTY CASH']);
        const res = match(officeAndPetty);
        add('Expense registers → petty-cash vouchers', 'Expenses + PETTY CASH',
            officeAndPetty.reduce((s, r) => s + r.amt, 0),
            officeAndPetty.reduce((s, r) => s + r.amt, 0) - res.missing.reduce((s, r) => s + r.amt, 0),
            `${officeAndPetty.length - res.missing.length}/${officeAndPetty.length} rows have a voucher · ` +
            (res.missing.length ? `MISSING: ${res.missing.map((m) => `${m.sheet}#${m.row} ${m.amt} ${m.desc}`).join('; ')}` : 'none missing'));

        const salaryRows = collect(['SALARY']);
        const salary = one('SELECT COALESCE(SUM(net_salary),0) t, COUNT(*) c FROM salary_records');
        add('Salary register → salary records', 'Expenses', salaryRows.reduce((s, r) => s + r.amt, 0), salary.t,
            `${salaryRows.length} sheet rows · ${salary.c} records · the same 12 rows are also vouchers in petty_cash and the P&L guards exclude them (petty_salary_duplicates)`);

        const investmentRows = collect(['INVESTMENT']);
        const invMatch = match(investmentRows);
        add('INVESTMENT rows → vouchers (capital)', 'Expenses', investmentRows.reduce((s, r) => s + r.amt, 0),
            investmentRows.reduce((s, r) => s + r.amt, 0) - invMatch.missing.reduce((s, r) => s + r.amt, 0),
            `${investmentRows.length} rows · workbook keeps them out of P&L as capital (its C26 only sums office + salary + petty), ` +
            'the app books them as operating expense — a policy difference of Rs ' + r2(investmentRows.reduce((s, r) => s + r.amt, 0)));
    }

    // ── Advances ──────────────────────────────────────────────────────────
    {
        let total = 0, n = 0;
        for (const [i, r] of rows(wb, 'Advance').entries()) {
            if (i < 2) continue;
            if (str(r[6]).toLowerCase() !== 'advance') continue;
            const amt = num(r[9]);
            if (!amt || !str(r[3])) continue;
            total += amt; n++;
        }
        const d = one("SELECT COALESCE(SUM(amount),0) t, COUNT(*) c FROM payments WHERE type='advance'");
        add('Advances', 'Advance', total, d.t, `${n} sheet rows · ${d.c} advances`);
    }

    // ── Salary ────────────────────────────────────────────────────────────
    {
        const sheetName = ['Salary Advance', 'Salary_Advance', 'Salary'].find((n) => wb.SheetNames.includes(n));
        let total = 0, n = 0;
        const all = rows(wb, sheetName);
        for (const [i, r] of all.entries()) {
            if (i < 3) continue;                       // title, totals line, header
            if (!str(r[1]) || !str(r[3])) continue;
            total += num(r[8]); n++;
        }
        const d = one('SELECT COALESCE(SUM(net_salary),0) t, COUNT(*) c FROM salary_records');
        add(`Salary (${sheetName})`, sheetName || 'Salary', total, d.t, `${n} sheet rows · ${d.c} records`);
    }

    // ── Bank statement ────────────────────────────────────────────────────
    {
        let debit = 0, credit = 0, n = 0, hdr = -1;
        const all = rows(wb, 'BANK RECON');
        for (let i = 0; i < Math.min(8, all.length); i++) if (/transaction date/i.test(str((all[i] || [])[0]))) { hdr = i; break; }
        for (let i = hdr + 1; i < all.length; i++) {
            const r = all[i] || [];
            if (!str(r[3]) && !str(r[4])) continue;
            const dr = num(r[6]), cr = num(r[7]);
            if (!dr && !cr) continue;
            debit += dr; credit += cr; n++;
        }
        const d = one('SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c, COUNT(*) n FROM bank_transactions');
        add('Bank debits (money out)', 'BANK RECON', debit, d.d, `${n} sheet rows · ${d.n} DB rows`);
        add('Bank credits (money in)', 'BANK RECON', credit, d.c, `${n} sheet rows · ${d.n} DB rows`);
    }

    // ── Cash counts ───────────────────────────────────────────────────────
    {
        let total = 0, n = 0;
        const all = rows(wb, 'Cash_Demon');
        let hdr = -1;
        for (let i = 0; i < Math.min(8, all.length); i++) if (str((all[i] || [])[0]).toLowerCase() === 'date') { hdr = i; break; }
        for (let i = hdr + 1; i < all.length; i++) {
            const r = all[i] || [];
            const amt = num(r[12]);
            if (!bsDate(r[0]) || !amt || !/^\d{4}/.test(bsDate(r[0]))) continue;
            total += amt; n++;
        }
        const d = one('SELECT COALESCE(SUM(total_cash),0) t, COUNT(*) c FROM denomination_counts');
        add('Cash counts total', 'Cash_Demon', total, d.t, `${n} sheet days · ${d.c} DB days`);
    }

    // ── Party opening balances ────────────────────────────────────────────
    {
        let total = 0, n = 0;
        for (const [i, r] of rows(wb, 'Party_Master').entries()) {
            if (i < 2) continue;
            if (!str(r[0])) continue;
            total += num(r[4]); n++;
        }
        const d = one('SELECT COALESCE(SUM(opening_balance),0) t, COUNT(*) c FROM parties');
        add('Party opening balances', 'Party_Master', total, d.t, `${n} parties listed · ${d.c} in DB (including app-created)`);
    }

    // ── Report ────────────────────────────────────────────────────────────
    const pad = (s, n) => String(s).padEnd(n);
    const lpad = (s, n) => String(s).padStart(n);
    console.log(`WORKBOOK ${WORKBOOK_PATH}`);
    console.log(`DATABASE ${DB_PATH}\n`);
    console.log(pad('CHECK', 38) + pad('SHEET', 16) + lpad('WORKBOOK', 16) + lpad('DATABASE', 16) + lpad('DIFF', 12));
    console.log('─'.repeat(98));
    let failed = 0;
    for (const c of checks) {
        const flag = Math.abs(c.difference) > TOL ? '  ←' : '';
        if (Math.abs(c.difference) > TOL) failed++;
        console.log(pad(c.label, 38) + pad(c.sheet, 16) + lpad(c.source.toFixed(2), 16)
            + lpad(c.database.toFixed(2), 16) + lpad(c.difference.toFixed(2), 12) + flag);
        if (c.note) console.log(`${''.padEnd(38)}↳ ${c.note}`);
    }
    console.log('─'.repeat(98));
    console.log(`\n${checks.length} totals checked against the workbook; ${failed} differ by more than Rs ${TOL}.`);
    db.close();
    process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
