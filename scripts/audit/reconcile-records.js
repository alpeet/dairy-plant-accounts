#!/usr/bin/env node
/**
 * Record-level workbook → database reconciliation
 * ===============================================
 * The coarse `reconcile-workbook.js` compares module totals. This script
 * compares *records*: every invoice, bill, voucher, bank row, salary row and
 * cash count in the workbook is looked up in the database, and every database
 * row is looked up in the workbook. Duplicates are handled as multisets, so a
 * genuinely repeated payment is not hidden by a single match.
 *
 *   WORKBOOK_PATH="Dairy_Accounts_Professional 76.xlsx" \
 *   DB_PATH=data/dairy-plant.db node scripts/audit/reconcile-records.js
 *
 * Never writes to the workbook or the database.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const WORKBOOK_PATH = process.env.WORKBOOK_PATH || path.join(ROOT, 'Dairy_Accounts_Professional 76.xlsx');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'dairy-plant.db');
const JSON_OUT = process.env.JSON_OUT || '';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/[, ]/g, '').replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
};
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const normName = (v) => str(v).toUpperCase().replace(/\s+/g, ' ').trim();

// BS dates are stored in the workbook as Excel serials of the *BS* day
// (214083-03-14 would be serial 66908) or as text "2083/03/15".
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function bsDate(v) {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number' && v > 10000) {
        const d = new Date(EXCEL_EPOCH + Math.round(v) * 86400000);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    if (v instanceof Date) {
        const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    const t = str(v);
    const m = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/.exec(t);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return t;
}

function sheetRows(wb, name) {
    if (!wb.SheetNames.includes(name)) return null;
    return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true });
}

/**
 * Multi-set matcher: source keys → database keys.
 *
 * Pass 1 pairs rows that agree on the payee as well as the key; pass 2 pairs
 * the leftovers on the key alone. Without this, two same-amount receipts on
 * one day can “match” each other's party and report a paid customer as
 * missing while hiding the mis-attribution.
 */
function compare(srcItems, dbItems, label) {
    const dbPool = new Map();
    for (const d of dbItems) {
        const list = dbPool.get(d.key) || [];
        list.push(d);
        dbPool.set(d.key, list);
    }
    const pick = (s, requireParty) => {
        const list = dbPool.get(s.key);
        if (!list) return null;
        const ix = requireParty && s.party
            ? list.findIndex((d) => d.party && d.party === s.party)
            : 0;
        if (ix < 0 || !list.length) return null;
        return list.splice(ix, 1)[0];
    };
    const matched = [];
    const missing = [];
    const pending = [];
    for (const s of srcItems) {
        const hit = pick(s, true);
        if (hit) matched.push({ src: s, db: hit });
        else pending.push(s);
    }
    for (const s of pending) {
        const hit = pick(s, false);
        if (hit) matched.push({ src: s, db: hit });
        else missing.push(s);
    }
    const extra = [];
    for (const list of dbPool.values()) extra.push(...list);
    const amountMismatch = matched.filter((m) => Math.abs(num(m.src.amount) - num(m.db.amount)) > 0.5);
    return {
        module: label,
        source_rows: srcItems.length,
        source_total: round2(srcItems.reduce((s, r) => s + num(r.amount), 0)),
        db_rows: dbItems.length,
        db_total: round2(dbItems.reduce((s, r) => s + num(r.amount), 0)),
        matched: matched.length,
        missing,
        extra,
        amount_mismatch: amountMismatch
    };
}

function main() {
    const wb = XLSX.readFile(WORKBOOK_PATH, { cellDates: false });
    const db = new Database(DB_PATH, { readonly: true });
    const all = (sql, ...p) => db.prepare(sql).all(...p);
    const reports = [];
    const notes = [];

    // ── Sales (invoices: one sheet invoice = several lines) ────────────────
    {
        const rows = sheetRows(wb, 'Sales_Entry') || [];
        const invoices = new Map();
        for (let i = 2; i < rows.length; i++) {
            const r = rows[i] || [];
            const inv = str(r[2]);
            const party = normName(r[3]);
            if (!inv || !party) continue;
            if (/^(CANCELED|CANCELLED)$/.test(party)) continue;   // void document, not a transaction
            const date = bsDate(r[0]);
            const key = `${inv.toUpperCase()}|${party}|${date}`;
            const net = num(r[9]) || num(r[7]);
            const rec = invoices.get(key) || { key, invoice: inv, date, party, amount: 0, lines: 0, row: i + 1 };
            rec.amount = round2(rec.amount + net);
            rec.lines++;
            invoices.set(key, rec);
        }
        const dbItems = all(`SELECT s.id, s.invoice_no, s.date, s.grand_total amount, p.name party
                             FROM sales s LEFT JOIN parties p ON p.id = s.party_id`)
            .map((r) => ({ key: `${str(r.invoice_no).toUpperCase()}|${normName(r.party)}|${r.date}`, invoice_no: r.invoice_no, date: r.date, amount: round2(r.amount), party: normName(r.party) }));
        reports.push(compare([...invoices.values()], dbItems, 'Sales (invoice+party+date)'));
    }

    // ── Purchases (bills) ─────────────────────────────────────────────────
    {
        const rows = sheetRows(wb, 'Purchase_Entry') || [];
        const bills = new Map();
        for (let i = 2; i < rows.length; i++) {
            const r = rows[i] || [];
            const bill = str(r[2]);
            const supplier = normName(r[3]);
            if (!bill || !supplier) continue;
            if (/^TOTALS/.test(supplier)) continue;
            const date = bsDate(r[0]);
            const net = num(r[15]) || num(r[13]);
            if (!net) continue;                                    // template / empty line
            const key = `${bill.toUpperCase()}|${supplier}|${date}`;
            const rec = bills.get(key) || { key, bill, date, party: supplier, amount: 0, lines: 0, row: i + 1 };
            rec.amount = round2(rec.amount + net);
            rec.lines++;
            bills.set(key, rec);
        }
        const dbItems = all(`SELECT p.id, p.bill_no, p.date, p.grand_total amount, pa.name party
                             FROM purchases p LEFT JOIN parties pa ON pa.id = p.party_id`)
            .map((r) => ({ key: `${str(r.bill_no).toUpperCase()}|${normName(r.party)}|${r.date}`, bill_no: r.bill_no, date: r.date, amount: round2(r.amount), party: normName(r.party) }));
        reports.push(compare([...bills.values()], dbItems, 'Purchases (bill+party+date)'));
    }

    // ── Collection → payments(type=receipt) ───────────────────────────────
    {
        const rows = sheetRows(wb, 'Collection') || [];
        const src = [];
        for (let i = 2; i < rows.length; i++) {
            const r = rows[i] || [];
            const type = str(r[5]).toLowerCase();
            const amount = num(r[7]);
            if (!amount) continue;
            if (type && !/^(collection|receipt)$/.test(type)) continue;
            if (!str(r[3])) continue;
            src.push({ key: `${bsDate(r[0])}|${round2(amount)}`, date: bsDate(r[0]), amount: round2(amount), party: normName(r[3]), row: i + 1 });
        }
        const dbItems = all(`SELECT y.id, y.date, y.amount, p.name party FROM payments y
                             LEFT JOIN parties p ON p.id = y.party_id
                             WHERE y.type='receipt'`)
            .map((r) => ({ key: `${r.date}|${round2(r.amount)}`, date: r.date, amount: round2(r.amount), party: normName(r.party) }));
        reports.push(compare(src, dbItems, 'Collection (receipts)'));
    }

    // ── Register sheets: Payment / Expenses / Advance ─────────────────────
    const sheetToPetty = { Expenses: 'OFFICE EXPENSES', 'PETTY CASH': 'PETTY CASH', Payment: 'Payment', Advance: 'Advance' };
    for (const [sheetName, pettyHead] of Object.entries(sheetToPetty)) {
        const rows = sheetRows(wb, sheetName);
        if (!rows) continue;
        let src = [];
        if (sheetName === 'Payment') {
            for (let i = 2; i < rows.length; i++) {
                const r = rows[i] || [];
                const amount = num(r[9]);
                if (!amount || !str(r[3])) continue;
                if (str(r[6]).toLowerCase() !== 'payment') continue;
                src.push({ key: `${bsDate(r[0])}|${round2(amount)}`, date: bsDate(r[0]), amount: round2(amount), party: normName(r[3]), row: i + 1 });
            }
            const dbItems = all(`SELECT y.id, y.date, y.amount, p.name party FROM payments y
                                 LEFT JOIN parties p ON p.id=y.party_id
                                 WHERE y.type='payment'`)
                .map((r) => ({ key: `${r.date}|${round2(r.amount)}`, date: r.date, amount: round2(r.amount), party: normName(r.party) }));
            reports.push(compare(src, dbItems, 'Payment register (payments)'));
            continue;
        }
        if (sheetName === 'Advance') {
            for (let i = 2; i < rows.length; i++) {
                const r = rows[i] || [];
                const amount = num(r[9]);
                if (!amount || !str(r[3])) continue;
                if (str(r[6]).toLowerCase() !== 'advance') continue;
                src.push({ key: `${bsDate(r[0])}|${round2(amount)}`, date: bsDate(r[0]), amount: round2(amount), party: normName(r[3]), row: i + 1 });
            }
            const dbItems = all(`SELECT y.id, y.date, y.amount, p.name party FROM payments y
                                 LEFT JOIN parties p ON p.id=y.party_id
                                 WHERE y.type='advance'`)
                .map((r) => ({ key: `${r.date}|${round2(r.amount)}`, date: r.date, amount: round2(r.amount), party: normName(r.party) }));
            reports.push(compare(src, dbItems, 'Advance (payments)'));
            continue;
        }
        // Expenses / PETTY CASH → petty_cash rows with that head
        for (let i = 2; i < rows.length; i++) {
            const r = rows[i] || [];
            const amount = num(r[9]);
            if (!amount || !str(r[3])) continue;
            const typeHead = str(r[6]).toUpperCase();
            if (pettyHead !== 'PETTY CASH' && typeHead !== pettyHead) continue;
            if (pettyHead === 'PETTY CASH' && !/PETTY/.test(typeHead)) continue;
            src.push({ key: `${bsDate(r[0])}|${round2(amount)}`, date: bsDate(r[0]), amount: round2(amount), party: normName(r[3]), row: i + 1 });
        }
        // petty_cash rows carry the voucher text in expense_head, not the sheet's
        // Type column, so identity is date + amount + payee.
        const dbItems = all(`SELECT id, date, amount, paid_to party, expense_head FROM petty_cash`)
            .map((r) => ({ key: `${r.date}|${round2(r.amount)}`, date: r.date, amount: round2(r.amount), party: normName(r.party), head: r.expense_head }));
        reports.push(compare(src, dbItems, `${sheetName} → petty_cash`));
    }

    // ── Salary (sheet is named "Salary" in v76, "Salary Advance" earlier) ─
    {
        const sheetName = ['Salary Advance', 'Salary'].find((n) => wb.SheetNames.includes(n));
        const rows = sheetName ? sheetRows(wb, sheetName) : [];
        let header = -1;
        for (let i = 0; i < Math.min(8, rows.length); i++) {
            if (str((rows[i] || [])[0]).toLowerCase() === 'id' && /employee/i.test(str((rows[i] || [])[1]))) { header = i; break; }
        }
        const src = [];
        if (header >= 0) {
            for (let i = header + 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const name = normName(r[1]);
                if (!name) continue;
                const net = num(r[8]);
                const month = str(r[3]);
                if (!month && !net) continue;
                src.push({ key: `${name}|${month}`, date: bsDate(r[9]), month, amount: round2(net), party: name, row: i + 1 });
            }
        }
        const dbItems = all(`SELECT id, employee_name, month, net_salary amount, payment_date FROM salary_records`)
            .map((r) => ({ key: `${normName(r.employee_name)}|${str(r.month)}`, date: r.payment_date, month: r.month, amount: round2(r.amount), party: normName(r.employee_name) }));
        const rep = compare(src, dbItems, `Salary (${sheetName || 'sheet missing'})`);
        if (sheetName !== 'Salary Advance') {
            notes.push(`Salary sheet is named "${sheetName}" — the importer only accepts "Salary Advance", so this sheet is currently skipped.`);
        }
        reports.push(rep);
    }

    // ── Bank statement ────────────────────────────────────────────────────
    {
        const rows = sheetRows(wb, 'BANK RECON') || [];
        let header = -1;
        for (let i = 0; i < Math.min(8, rows.length); i++) {
            if (/transaction date/i.test(str((rows[i] || [])[0]))) { header = i; break; }
        }
        const src = [];
        if (header >= 0) {
            for (let i = header + 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const cp = normName(r[3]);
                const desc = normName(r[4]);
                const debit = num(r[6]);
                const credit = num(r[7]);
                const amount = round2(debit || credit);
                if ((!cp && !desc) || !amount) continue;
                const dir = debit ? 'out' : 'in';
                src.push({ key: `${bsDate(r[0])}|${dir}|${amount}`, date: bsDate(r[0]), amount, party: cp, desc, ref: str(r[2]), row: i + 1 });
            }
        }
        const dbItems = all(`SELECT id, date, debit, credit, counterparty_name party, description, reference_no FROM bank_transactions`)
            .map((r) => {
                const amount = round2(num(r.debit) || num(r.credit));
                return {
                    key: `${r.date}|${num(r.debit) ? 'out' : 'in'}|${amount}`,
                    date: r.date, amount, party: normName(r.party), desc: normName(r.description), ref: r.reference_no
                };
            });
        reports.push(compare(src, dbItems, 'Bank (BANK RECON)'));
    }

    // ── Physical cash counts ──────────────────────────────────────────────
    {
        const rows = sheetRows(wb, 'Cash_Demon') || [];
        let header = -1;
        for (let i = 0; i < Math.min(8, rows.length); i++) {
            if (str((rows[i] || [])[0]).toLowerCase() === 'date') { header = i; break; }
        }
        const src = [];
        if (header >= 0) {
            for (let i = header + 1; i < rows.length; i++) {
                const r = rows[i] || [];
                const date = bsDate(r[0]);
                const amount = num(r[12]);
                if (!date || !amount) continue;
                src.push({ key: date, date, amount: round2(amount), row: i + 1 });
            }
        }
        const dbItems = all(`SELECT id, date, total_cash amount FROM denomination_counts`)
            .map((r) => ({ key: r.date, date: r.date, amount: round2(r.amount) }));
        const rep = compare(src, dbItems, 'Cash count (Cash_Demon)');
        // Amount comparison needs the matched pairs; recompute here on the date key.
        rep.amount_mismatch = [];
        const byDate = new Map(dbItems.map((d) => [d.date, d]));
        for (const s of src) {
            const d = byDate.get(s.date);
            if (d && Math.abs(num(s.amount) - num(d.amount)) > 0.5) rep.amount_mismatch.push({ src: s, db: d });
        }
        reports.push(rep);
    }

    // ── Master data ───────────────────────────────────────────────────────
    {
        const rows = sheetRows(wb, 'Party_Master') || [];
        const src = [];
        for (let i = 2; i < rows.length; i++) {
            const name = normName((rows[i] || [])[0]);
            if (!name) continue;
            src.push({ key: name, party: name, amount: num((rows[i] || [])[4]), row: i + 1 });
        }
        const dbItems = all('SELECT id, name, opening_balance amount FROM parties')
            .map((r) => ({ key: normName(r.name), party: normName(r.name), amount: round2(r.amount) }));
        reports.push(compare(src, dbItems, 'Party master'));
    }
    {
        const rows = sheetRows(wb, 'Stock_Master') || [];
        const src = [];
        for (let i = 2; i < rows.length; i++) {
            const name = normName((rows[i] || [])[0]);
            if (!name || /^TOTAL/.test(name)) continue;   // sheet totals line, not a product
            src.push({ key: name, party: name, amount: 0, row: i + 1 });
        }
        const dbItems = all('SELECT id, name FROM products').map((r) => ({ key: normName(r.name), party: normName(r.name), amount: 0 }));
        reports.push(compare(src, dbItems, 'Product master'));
    }

    // ── Output ────────────────────────────────────────────────────────────
    const pad = (s, n) => String(s).padEnd(n);
    const lpad = (s, n) => String(s).padStart(n);
    console.log(`WORKBOOK ${WORKBOOK_PATH}`);
    console.log(`DATABASE ${DB_PATH}\n`);
    console.log(pad('MODULE', 30) + lpad('SRC', 6) + lpad('DB', 6) + lpad('MATCH', 7) + lpad('MISSING', 9) + lpad('EXTRA', 7) + lpad('AMT≠', 6));
    console.log('─'.repeat(71));
    for (const r of reports) {
        console.log(pad(r.module, 30) + lpad(r.source_rows, 6) + lpad(r.db_rows, 6) + lpad(r.matched, 7)
            + lpad(r.missing.length, 9) + lpad(r.extra.length, 7) + lpad(r.amount_mismatch.length, 6));
    }
    console.log('─'.repeat(71));
    const problem = reports.filter((r) => r.missing.length || r.extra.length || r.amount_mismatch.length);
    console.log(`\n${reports.length} modules, ${problem.length} with an unmatched record.`);
    for (const r of problem) {
        if (r.missing.length) {
            console.log(`\nMISSING FROM DATABASE — ${r.module} (${r.missing.length}, first 25)`);
            for (const m of r.missing.slice(0, 25)) {
                console.log(`  row ${m.row || '?'}  ${m.date || ''}  ${m.party || ''}  ${m.ref || m.invoice || m.bill || ''}  Rs ${num(m.amount).toFixed(2)}`);
            }
        }
        if (r.extra.length) {
            console.log(`\nIN DATABASE, NOT IN WORKBOOK — ${r.module} (${r.extra.length}, first 25)`);
            for (const m of r.extra.slice(0, 25)) {
                console.log(`  ${m.date || ''}  ${m.party || ''}  ${m.ref || m.invoice_no || m.bill_no || ''}  Rs ${num(m.amount).toFixed(2)}`);
            }
        }
        if (r.amount_mismatch.length) {
            console.log(`\nAMOUNT DIFFERS — ${r.module} (${r.amount_mismatch.length}, first 25)`);
            for (const m of r.amount_mismatch.slice(0, 25)) {
                console.log(`  ${m.src.date || ''}  ${m.src.party || ''}  sheet Rs ${num(m.src.amount).toFixed(2)}  db Rs ${num(m.db.amount).toFixed(2)}`);
            }
        }
    }
    for (const n of notes) console.log(`\nNOTE: ${n}`);

    if (JSON_OUT) {
        fs.writeFileSync(JSON_OUT, JSON.stringify({
            workbook: path.resolve(WORKBOOK_PATH), database: path.resolve(DB_PATH),
            generated_at: new Date().toISOString(), notes, modules: reports
        }, null, 2));
        console.log(`\nJSON written to ${JSON_OUT}`);
    }
    db.close();
}

if (require.main === module) main();
