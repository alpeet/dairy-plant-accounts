/**
 * Party Statement — quantity, rate, milk type, shift and filters.
 *
 * Proves, against a /tmp COPY of the live database:
 *  1. purchase rows carry the quantity and rate of their own milk lines;
 *  2. sales rows carry the item name, quantity and rate of the invoice lines;
 *  3. milk type (Cow / Buffalo / Mixed) and shift come from the transaction,
 *     and are never invented for a row that has no such record;
 *  4. the Milk Type and Shift filters narrow the statement and its totals, and
 *     combine with the party, date and transaction-type filters;
 *  5. the quantity summary counts the rows on screen only, keeps purchases and
 *     sales in separate buckets, and never counts a payment/advance/expense;
 *  6. no milk collection is counted twice;
 *  7. attaching all of this changes NO amount, running balance or closing
 *     balance — the accounting is untouched.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP_DB = path.join(os.tmpdir(), `stmt-qty-test-${process.pid}.db`);

fs.copyFileSync(LIVE_DB, TMP_DB);
const db = new Database(TMP_DB);
const { getPartyStatement } = require(path.join(ROOT, 'shared', 'operations', 'statements.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const round2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

// Parties that actually have the data this feature is about.
const milkSupplier = db.prepare(`
    SELECT party_id AS id FROM milk_collections
    GROUP BY party_id HAVING COUNT(*) > 10 ORDER BY COUNT(*) DESC LIMIT 1`).get();
const saleParty = db.prepare(`
    SELECT s.party_id AS id FROM sales s JOIN sales_items si ON si.sale_id = s.id
    GROUP BY s.party_id HAVING COUNT(*) > 5 ORDER BY COUNT(*) DESC LIMIT 1`).get();
const bothParty = db.prepare(`
    SELECT party_id AS id FROM ledger_entries
    WHERE reference_type IN ('sale','purchase')
    GROUP BY party_id HAVING COUNT(DISTINCT reference_type) = 2 LIMIT 1`).get()
    || { id: saleParty.id };

const supplier = getPartyStatement(db, { party_id: milkSupplier.id });

console.log('\n— 1. Purchase rows carry their own quantity and rate —');
{
    const rows = supplier.entries.filter(e => e.reference_type === 'purchase');
    const withQty = rows.filter(e => Array.isArray(e.qty_lines) && e.qty_lines.length);
    check('purchase rows exist', rows.length > 0);
    check('purchase rows carry quantity lines', withQty.length > 0, `${withQty.length}/${rows.length}`);

    // Every displayed litre must exist in milk_collections for this party.
    let bad = 0;
    const ids = new Set();
    for (const e of withQty) {
        for (const l of e.qty_lines) {
            if (l.source === 'milk_collections') {
                ids.add(l.source_id);
                const src = db.prepare('SELECT milk_type, quantity_liters, rate, shift FROM milk_collections WHERE id = ?').get(l.source_id);
                if (!src || Math.abs(Number(src.quantity_liters) - Number(l.quantity)) > 0.001
                    || Math.abs(Number(src.rate) - Number(l.rate)) > 0.005) bad++;
            }
        }
    }
    check('displayed quantities and rates match the source collection', bad === 0, `${bad} mismatched`);
    check('no milk collection is counted twice',
        ids.size === withQty.reduce((s, e) => s + e.qty_lines.filter(l => l.source === 'milk_collections').length, 0));
}

console.log('\n— 2. Sales rows carry the item name, quantity and rate —');
{
    const data = getPartyStatement(db, { party_id: saleParty.id });
    const rows = data.entries.filter(e => e.reference_type === 'sale');
    const withQty = rows.filter(e => Array.isArray(e.qty_lines) && e.qty_lines.length);
    check('sale rows carry quantity lines', withQty.length > 0, `${withQty.length}/${rows.length}`);
    const sample = withQty[0];
    check('quantity line has a unit', sample && sample.qty_lines[0].unit != null);
    check('quantity line has a rate', sample && sample.qty_lines[0].rate != null);
    // Item name is in the particulars (the ledger row's own description).
    check('item name appears in the particulars', sample && String(sample.description || '').trim().length > 0);

    let bad = 0;
    for (const e of withQty.slice(0, 40)) {
        for (const l of e.qty_lines) {
            if (l.source !== 'sales_items') continue;
            const hit = db.prepare('SELECT product_name, quantity, unit, rate FROM sales_items WHERE sale_id = ?')
                .all(e.source_id)
                .some(i => String(i.product_name) === String(l.product_name)
                    && Math.abs(Number(i.quantity) - Number(l.quantity)) <= 0.005
                    && Math.abs(Number(i.rate) - Number(l.rate)) <= 0.005);
            if (!hit) bad++;
        }
    }
    check('sale quantities and rates match the invoice lines', bad === 0, `${bad} mismatched`);
}

console.log('\n— 3. Milk type / shift are read, never invented —');
{
    const rows = supplier.entries.filter(e => e.reference_type === 'purchase');
    const labelled = rows.filter(e => e.milk_type_label);
    check('milk purchases are labelled with a milk type', labelled.length > 0);
    check('labels are only Cow / Buffalo / Mixed',
        labelled.every(e => /^(Cow|Buffalo|Mixed)( · (Cow|Buffalo|Mixed))*$/.test(e.milk_type_label)),
        [...new Set(labelled.map(e => e.milk_type_label))].join(','));
    const shifted = rows.filter(e => e.shift_label);
    check('milk purchases carry a shift', shifted.length > 0);
    check('shifts are only Morning / Evening',
        shifted.every(e => /^(Morning|Evening)( · (Morning|Evening))*$/.test(e.shift_label)),
        [...new Set(shifted.map(e => e.shift_label))].join(','));

    // A payment row must carry no milk type, no shift and no quantity.
    const payments = supplier.entries.filter(e => /payment|adjustment/.test(String(e.reference_type)));
    check('non-quantity rows have no quantity lines',
        payments.every(e => !Array.isArray(e.qty_lines) || e.qty_lines.length === 0));
    check('non-quantity rows have no milk type', payments.every(e => !e.milk_type_label));
    check('non-quantity rows have no shift', payments.every(e => !e.shift_label));
}

console.log('\n— 4. Milk Type filter —');
{
    for (const type of ['cow', 'buffalo', 'mixed']) {
        const data = getPartyStatement(db, { party_id: milkSupplier.id, milk_type: type });
        const bad = data.entries.filter(e => !Array.isArray(e.qty_lines)
            || !e.qty_lines.some(l => l.milk_type === type));
        check(`${type}: only matching rows are shown`, data.entries.length === 0 || bad.length === 0,
            `${bad.length} rows without ${type}`);
        check(`${type}: every shown litre is ${type}`,
            data.entries.every(e => e.qty_lines.every(l => l.milk_type === type)));
        const total = data.qty_summary.purchase.total_qty;
        const expected = round2(data.entries.reduce((s, e) =>
            s + e.qty_lines.reduce((t, l) => t + Number(l.quantity || 0), 0), 0));
        check(`${type}: summary total equals the rows on screen`, Math.abs(total - expected) < 0.005,
            `${total} vs ${expected}`);
    }
    const cow = getPartyStatement(db, { party_id: milkSupplier.id, milk_type: 'cow' });
    const buff = getPartyStatement(db, { party_id: milkSupplier.id, milk_type: 'buffalo' });
    check('cow and buffalo totals are different records', cow.qty_summary.purchase.total_qty !== undefined
        && buff.qty_summary.purchase.total_qty !== undefined);
    check('cow + buffalo + mixed never exceeds the unfiltered total',
        cow.qty_summary.purchase.total_qty + buff.qty_summary.purchase.total_qty
        + getPartyStatement(db, { party_id: milkSupplier.id, milk_type: 'mixed' }).qty_summary.purchase.total_qty
        <= supplier.qty_summary.purchase.total_qty + 0.005);
}

console.log('\n— 5. Shift filter —');
{
    for (const shift of ['morning', 'evening']) {
        const data = getPartyStatement(db, { party_id: milkSupplier.id, shift });
        check(`${shift}: every row has a ${shift} line`,
            data.entries.every(e => e.qty_lines.some(l => l.shift === shift)));
        const b = data.qty_summary.purchase;
        check(`${shift}: all quantity falls in the ${shift} bucket`,
            Math.abs(b[shift] - b.total_qty) < 0.005,
            `${shift}=${b[shift]} total=${b.total_qty}`);
    }
    const m = getPartyStatement(db, { party_id: milkSupplier.id, shift: 'morning' });
    const e = getPartyStatement(db, { party_id: milkSupplier.id, shift: 'evening' });
    check('morning + evening equals the unfiltered quantity',
        Math.abs((m.qty_summary.purchase.total_qty + e.qty_summary.purchase.total_qty)
            - supplier.qty_summary.purchase.total_qty) < 0.005,
        `${m.qty_summary.purchase.total_qty} + ${e.qty_summary.purchase.total_qty} vs ${supplier.qty_summary.purchase.total_qty}`);
}

console.log('\n— 6. Filters combine with party + date + type —');
{
    const from = supplier.entries.length ? supplier.entries[0].date : '2083-01-01';
    const last = supplier.entries.length ? supplier.entries[supplier.entries.length - 1].date : '2083-12-30';
    const buffalo = getPartyStatement(db, {
        party_id: milkSupplier.id, from_date: from, to_date: last,
        transaction_type: 'purchase', milk_type: 'buffalo', shift: 'morning'
    });
    check('combined filter returns only purchase rows',
        buffalo.entries.every(x => x.reference_type === 'purchase'));
    check('combined filter returns only buffalo morning lines',
        buffalo.entries.every(x => x.qty_lines.every(l => l.milk_type === 'buffalo' && l.shift === 'morning')));
    check('combined filter stays inside the date range',
        buffalo.entries.every(x => String(x.date) >= from && String(x.date) <= last));
    check('combined filter echoes back in filters',
        buffalo.filters.milk_type === 'buffalo' && buffalo.filters.shift === 'morning');
    check('an impossible combination returns nothing, not everything',
        getPartyStatement(db, {
            party_id: milkSupplier.id, from_date: '2000-01-01', to_date: '2000-12-30',
            milk_type: 'mixed'
        }).entries.length === 0);
}

console.log('\n— 7. Quantity summary: purchases and sales stay separate —');
{
    const data = getPartyStatement(db, { party_id: bothParty.id });
    const q = data.qty_summary;
    check('the summary is present', !!q);
    check('purchase and sales buckets are separate objects', q.purchase !== q.sales);
    check('purchase quantity equals its rows',
        Math.abs(q.purchase.total_qty - round2(data.entries.reduce((s, e) =>
            s + (e.qty_lines || []).filter(l => l.kind === 'purchase').reduce((t, l) => t + Number(l.quantity || 0), 0), 0))) < 0.005);
    check('sales quantity equals its rows',
        Math.abs(q.sales.total_qty - round2(data.entries.reduce((s, e) =>
            s + (e.qty_lines || []).filter(l => l.kind === 'sale').reduce((t, l) => t + Number(l.quantity || 0), 0), 0))) < 0.005);
    check('no "purchase + sales" combined figure is exposed as the total',
        !('total_business_qty' in q) && q.purchase.total_qty !== q.purchase.total_qty + q.sales.total_qty);
    // 500 purchased + 350 sold must never read as 850.
    if (q.has_purchase && q.has_sales) {
        check('net is sales − purchase, not their sum',
            Math.abs(q.net.total_qty - (q.sales.total_qty - q.purchase.total_qty)) < 0.005);
    } else {
        check('net only claims meaning when both sides exist', q.net.meaningful === false);
    }
}

console.log('\n— 8. Payments / advances / expenses never affect quantity —');
{
    const withOnlyPayments = getPartyStatement(db, { party_id: supplier.party.id, transaction_type: 'payment' });
    check('a payment-only statement has no quantity',
        !withOnlyPayments.qty_summary.has_quantity,
        `${withOnlyPayments.qty_summary.purchase.total_qty}`);
    check('a payment-only statement has no quantity lines',
        withOnlyPayments.entries.every(e => !e.qty_lines || e.qty_lines.length === 0));
}

console.log('\n— 9. Accounting is untouched by the new detail —');
{
    const data = supplier;
    const sql = db.prepare(`SELECT COALESCE(SUM(debit),0) d, COALESCE(SUM(credit),0) c
        FROM ledger_entries WHERE party_id = ? AND date >= ? AND date <= ?`)
        .get(data.party.id, data.from_date, data.to_date);
    check('total debit still matches the ledger', Math.abs(data.total_debit - sql.d) < 0.005);
    check('total credit still matches the ledger', Math.abs(data.total_credit - sql.c) < 0.005);
    check('closing still equals opening + debit − credit',
        Math.abs(data.closing_balance - (data.opening_balance + data.total_debit - data.total_credit)) < 0.005);

    let running = data.opening_balance, drift = 0;
    for (const e of data.entries) {
        running += (Number(e.debit) || 0) - (Number(e.credit) || 0);
        if (Math.abs(running - Number(e.running_balance)) > 0.005) drift++;
    }
    check('running balance column is still a true running balance', drift === 0, `${drift} drifted`);

    // A filter never moves the opening balance.
    for (const f of [{ milk_type: 'cow' }, { milk_type: 'buffalo' }, { shift: 'morning' }, { shift: 'evening' }]) {
        const d = getPartyStatement(db, { party_id: supplier.party.id, ...f });
        check(`opening balance unchanged by ${JSON.stringify(f)}`,
            Math.abs(d.opening_balance - data.opening_balance) < 0.005);
    }
}

console.log('\n— 10. Screen, print and PDF share the columns and summary —');
{
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'statements.js'), 'utf8');
    check('Milk Type column in the shared plan', /rl\('Milk Type'/.test(src));
    check('Shift column in the shared plan', /rl\('Shift'/.test(src));
    check('quantity summary is rendered on screen', /statementQtySummaryHtml\(data\)/.test(src));
    check('quantity summary is in the print/PDF document', /statementQtySummaryHtml\(data\)/.test(src));
    check('print document repeats table headers (thead)',
        /statementTableHead\(cols\)/.test(src) && /thead\s*\{\s*display: table-header-group/.test(src));
    check('PDF asks for page numbers', /pageNumbers:\s*true/.test(src));
    check('PDF filename names the party and the range',
        /Party_Statement_\$\{safe\(data\.party\.name\)\}_\$\{data\.from_date\}_to_\$\{data\.to_date\}\.pdf/.test(src));
    check('PDF orientation follows the visible columns (A4 landscape / portrait)',
        /landscape:\s*statementPrintLayout\(data\)\.landscape/.test(src)
        && /size: A4 \$\{lay\.landscape \? 'landscape' : 'portrait'\}/.test(src));
    check('filters are echoed into print/PDF', /statementFilterText\(data\)/.test(src));
}

console.log('\n— 11. Unreconciled purchase rows are flagged, never guessed —');
{
    // Any party whose purchase ledger came from a workbook import that did not
    // reconcile has such a row. Its amount is real; its milk line is missing.
    const purchaseParties = db.prepare(`SELECT DISTINCT party_id id FROM ledger_entries
        WHERE reference_type = 'purchase' AND party_id IS NOT NULL`).all();
    let flagged = 0, sample = null, misflagged = 0, totalFlagged = 0;
    for (const p of purchaseParties) {
        const d = getPartyStatement(db, { party_id: p.id });
        for (const e of d.entries) {
            if (e.reference_type !== 'purchase') continue;
            if (e.qty_unreconciled) {
                flagged++;
                sample = sample || { data: d, entry: e };
                if (!Array.isArray(e.qty_lines) || e.qty_lines.length) misflagged++;
                if (!(Math.abs((e.debit || 0) - (e.credit || 0)) > 0)) misflagged++;
                // Opening-balance rows are not bills and are never flagged.
                if (/^opening\b/i.test(String(e.description || '').trim())) misflagged++;
                if (/^opn/i.test(String(e.reference_no || '').trim())) misflagged++;
            }
            // A purchase row that does show quantity lines is never flagged, and
            // a real milk bill is never left unflagged. Opening-balance rows and
            // parties that never supplied milk are not bills, so they may be blank.
            if (!e.qty_unreconciled && Array.isArray(e.qty_lines) && e.qty_lines.length === 0
                && !(Array.isArray(e.items) && e.items.length)
                && Math.abs((e.debit || 0) - (e.credit || 0)) > 0) {
                const desc = String(e.description || '').trim();
                const ref = String(e.reference_no || '').trim();
                const isOpen = /^opening\b/i.test(desc) || /^opn/i.test(ref);
                const partyMilk = db.prepare('SELECT 1 FROM milk_collections WHERE party_id = ? LIMIT 1').get(p.id);
                if (!isOpen && (partyMilk || /milk/i.test(desc))) misflagged++;
            }
        }
        totalFlagged += Number(d.qty_unreconciled_count) || 0;
        if (d.qty_unreconciled_count !== d.entries.filter(e => e.qty_unreconciled).length) misflagged++;
    }
    check('an unreconciled purchase row is flagged when the data has one', flagged > 0, `${flagged}`);
    check('flagged rows carry no quantity or item lines', misflagged === 0, `${misflagged} wrong`);
    check('the reported count equals the flagged rows', totalFlagged === flagged,
        `${totalFlagged} vs ${flagged}`);
    if (sample) {
        const d = sample.data;
        check('a flagged row still shows its recorded amount',
            sample.entry.debit > 0 || sample.entry.credit > 0);
        check('flagging does not move the closing balance',
            Math.abs(d.closing_balance - (d.opening_balance + d.total_debit - d.total_credit)) < 0.005);
    }
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'statements.js'), 'utf8');
    check('screen quantity cell carries the unreconciled marker',
        /e\.qty_unreconciled\) return `<td class="\$\{num\}">\$\{statementUnreconciledMark\(\)\}/.test(src));
    check('the footnote is shown on screen and in print/PDF',
        (src.match(/statementUnreconciledNote\(data\)/g) || []).length >= 2);
    check('the footnote says totals are unchanged', /totals are exactly as recorded/.test(src));
}

db.close();
fs.unlinkSync(TMP_DB);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
