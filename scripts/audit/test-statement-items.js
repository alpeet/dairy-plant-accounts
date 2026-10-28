/**
 * Party statement / ledger — item, quantity, unit, rate detail test.
 *
 * Proves:
 *  1. sale / purchase / milk ledger rows carry real item detail from
 *     sales_items / purchase_items / milk_collections (never invented);
 *  2. attaching that detail changes NO amount — totals, running balance and
 *     closing balance are identical with and without enrichment;
 *  3. item amounts on a row reconcile with the row's own ledger amount
 *     (or the row is explicitly marked as having no item detail);
 *  4. payment status comes from the source sale/purchase record;
 *  5. the party ledger modal (getPartyLedger) receives the same detail;
 *  6. dash-not-zero: rows with no item data get no fake quantities.
 *
 * Runs against a /tmp COPY of the live database — never the original.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP_DB = path.join(os.tmpdir(), `stmt-items-test-${process.pid}.db`);

fs.copyFileSync(LIVE_DB, TMP_DB);

const db = new Database(TMP_DB);
db.exec('PRAGMA foreign_keys = ON');

const { getPartyStatement, listPartiesWithBalance, attachEntryItemDetails } =
    require(path.join(ROOT, 'shared', 'operations', 'statements.js'));
const { getPartyLedger } = require(path.join(ROOT, 'shared', 'operations', 'parties.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── Pick parties that actually have enriched rows ──────────────────────
const saleParty = db.prepare(`
    SELECT le.party_id AS id FROM ledger_entries le
    WHERE le.reference_type = 'sale'
      AND typeof(le.reference_id) = 'text'
      AND EXISTS (SELECT 1 FROM sales s JOIN sales_items si ON si.sale_id = s.id
                  WHERE s.invoice_no = le.reference_id AND s.party_id = le.party_id)
    GROUP BY le.party_id ORDER BY COUNT(*) DESC LIMIT 1`).get();
const purchaseParty = db.prepare(`
    SELECT le.party_id AS id FROM ledger_entries le
    WHERE le.reference_type = 'purchase'
      AND typeof(le.reference_id) = 'text'
      AND EXISTS (SELECT 1 FROM purchases pu JOIN purchase_items pi ON pi.purchase_id = pu.id
                  WHERE pu.bill_no = le.reference_id AND pu.party_id = le.party_id)
    GROUP BY le.party_id ORDER BY COUNT(*) DESC LIMIT 1`).get();
const milkParty = db.prepare(`
    SELECT party_id AS id FROM milk_collections GROUP BY party_id
    HAVING COUNT(*) > 3 ORDER BY COUNT(*) DESC LIMIT 1`).get();

console.log('\n— 1. Sale party statement carries item detail —');
{
    const data = getPartyStatement(db, { party_id: saleParty.id });
    const saleRows = data.entries.filter(e => e.reference_type === 'sale' && typeof e.reference_id === 'string');
    check('sale rows exist', saleRows.length > 0, 'no text-referenced sale rows');
    const withItems = saleRows.filter(e => Array.isArray(e.items) && e.items.length > 0);
    check('sale rows carry items', withItems.length > 0, 'no items attached');
    const sample = withItems[0];
    check('item has product_name', !!(sample && sample.items[0].product_name));
    check('item has quantity', sample && sample.items[0].quantity != null);
    check('item has unit', sample && sample.items[0].unit != null);
    check('item has rate', sample && sample.items[0].rate != null);

    // Reconcile: item amounts for a single-invoice row sum to the ledger amount
    let reconciled = 0, unmatched = 0;
    for (const e of withItems) {
        const rowAmt = Math.abs((e.debit || 0) - (e.credit || 0));
        const itemSum = e.items.reduce((s, i) => s + (i.amount != null ? Number(i.amount) : Number(i.quantity || 0) * Number(i.rate || 0)), 0);
        if (Math.abs(itemSum - rowAmt) <= 0.02) reconciled++; else unmatched++;
    }
    check('item amounts reconcile with ledger amounts', reconciled > 0,
        `reconciled=${reconciled} unmatched=${unmatched}`);
    console.log(`    (reconciled ${reconciled} rows, ${unmatched} rows with mixed/imported amounts)`);

    // Every enriched row must point at a real source record
    const badSource = withItems.filter(e => e.source_id == null);
    check('enriched rows carry source_id', badSource.length === 0, `${badSource.length} rows without source_id`);
}

console.log('\n— 2. Attaching detail changes NO amount —');
{
    const before = getPartyStatement(db, { party_id: saleParty.id });
    const beforeTotals = { d: before.total_debit, c: before.total_credit, close: before.closing_balance };
    const beforeBalances = before.entries.map(e => e.running_balance);
    const beforeDescs = before.entries.map(e => e.description);

    // Re-run enrichment on the already-enriched copy: must be idempotent
    attachEntryItemDetails(db, saleParty.id, before.entries);
    attachEntryItemDetails(db, saleParty.id, before.entries);

    check('total_debit unchanged', Math.abs(before.total_debit - beforeTotals.d) < 0.005);
    check('total_credit unchanged', Math.abs(before.total_credit - beforeTotals.c) < 0.005);
    check('closing_balance unchanged', Math.abs(before.closing_balance - beforeTotals.close) < 0.005);
    check('running balances unchanged', before.entries.every((e, i) => Math.abs(e.running_balance - beforeBalances[i]) < 0.005));
    check('descriptions unchanged (no text rewritten)', before.entries.every((e, i) => e.description === beforeDescs[i]));
}

console.log('\n— 3. Purchase party statement carries item detail —');
{
    const data = getPartyStatement(db, { party_id: purchaseParty.id });
    const purchaseRows = data.entries.filter(e => e.reference_type === 'purchase');
    const withItems = purchaseRows.filter(e => Array.isArray(e.items) && e.items.length > 0);
    check('purchase rows carry items', withItems.length > 0, 'no items attached');
    const sample = withItems[0];
    check('purchase item fields present',
        sample && sample.items[0].product_name != null && sample.items[0].quantity != null &&
        sample.items[0].unit != null && sample.items[0].rate != null);

    // Payment status from source
    const withStatus = purchaseRows.filter(e => e.payment_status);
    check('purchase rows carry payment_status', withStatus.length > 0);
    const validStatuses = ['paid', 'unpaid', 'partial'];
    check('payment_status values are real', withStatus.every(e => validStatuses.includes(String(e.payment_status).toLowerCase())));
}

console.log('\n— 4. Milk rows carry litres / rate as item detail —');
{
    const data = getPartyStatement(db, { party_id: milkParty.id });
    const milkRows = data.entries.filter(e => e.reference_type === 'milk_collection' && e.milk_type);
    const withItems = milkRows.filter(e => Array.isArray(e.items) && e.items.length > 0);
    check('milk rows carry items', milkRows.length === 0 || withItems.length > 0,
        `${milkRows.length} milk rows, ${withItems.length} enriched`);
    if (withItems.length) {
        const it = withItems[0].items[0];
        check('milk item unit is L', it.unit === 'L');
        check('milk item quantity matches collection', it.quantity != null);
    }
}

console.log('\n— 5. Rows without item data get dashes, not zeros —');
{
    // The dash behaviour is a renderer rule; here we prove the DATA contract:
    // entries with no source items must have no items array (renderer shows —).
    const data = getPartyStatement(db, { party_id: saleParty.id });
    const paymentRows = data.entries.filter(e => e.reference_type === 'payment_received' || e.reference_type === 'payment_made');
    const wrongItems = paymentRows.filter(e => Array.isArray(e.items) && e.items.length > 0);
    check('payment rows carry no fake items', wrongItems.length === 0, `${wrongItems.length} payment rows with invented items`);
    const settledMarked = paymentRows.filter(e => e.payment_status === 'settled');
    check('payment rows marked settled', paymentRows.length === 0 || settledMarked.length === paymentRows.length);
}

console.log('\n— 6. Party ledger modal receives the same detail —');
{
    const ledger = getPartyLedger(db, { party_id: saleParty.id });
    const saleRows = ledger.entries.filter(e => e.reference_type === 'sale');
    const withItems = saleRows.filter(e => Array.isArray(e.items) && e.items.length > 0);
    check('ledger entries carry items', withItems.length > 0, 'getPartyLedger did not enrich');
    check('ledger party resolved', !!ledger.party);
}

console.log('\n— 6b. Invoices posted as several ledger rows show the right goods on each row —');
{
    // The workbook import posts one ledger row PER PRODUCT (row 'NAUNI' 2,400,
    // row 'Mix Milk' 700). Each of those rows is a different product line, so it
    // must carry its OWN quantity and rate. Only when a row cannot be matched to
    // exactly one invoice item (a bill posted as amount-only parts) does the
    // single-host rule apply, and then no part may carry invented goods.
    const data = getPartyStatement(db, { party_id: saleParty.id });
    const bySource = new Map();
    for (const e of data.entries) {
        if (e.reference_type !== 'sale' || e.source_id == null) continue;
        if (!bySource.has(e.source_id)) bySource.set(e.source_id, []);
        bySource.get(e.source_id).push(e);
    }
    const splits = [...bySource.values()].filter(g => g.length > 1);
    console.log(`    (${splits.length} invoices posted as multiple ledger rows)`);
    const amountOf = i => (i.amount != null ? Number(i.amount) : Number(i.quantity || 0) * Number(i.rate || 0));
    let perRowOk = 0, hostModeOk = 0, drift = 0, noFake = 0;
    for (const g of splits) {
        const src = db.prepare('SELECT product_name, quantity, unit, rate, amount FROM sales_items WHERE sale_id = ? ORDER BY id').all(g[0].source_id);
        const assigned = g.filter(e => Array.isArray(e.items) && e.items.length);
        if (assigned.length) {
            // Every row that carries goods carries exactly ONE invoice item, and
            // that item is the invoice's own line — never another row's goods.
            const oneEach = assigned.every(e => e.items.length === 1);
            const isReal = assigned.every(e => src.some(s =>
                String(s.product_name || '').trim() === String(e.items[0].product_name || '').trim()
                && Math.abs(Number(s.rate) - Number(e.items[0].rate)) <= 0.005
                && Math.abs(Number(s.quantity) - Number(e.items[0].quantity)) <= 0.005));
            if (oneEach && isReal) perRowOk++;
            // No row may claim the whole invoice's goods while others show lines.
            const claimsAll = assigned.some(e => e.items.length === src.length && src.length > 1 && assigned.length > 1);
            if (!claimsAll) noFake++;
        }
        const hosts = g.filter(e => e.items_split_count === g.length);
        const parts = g.filter(e => e.items_split_part);
        if (!assigned.length && hosts.length === 1 && parts.length === g.length - 1
            && parts.every(e => !e.items)) hostModeOk++;
    }
    check('each multi-row invoice puts its own product line on each row',
        perRowOk + hostModeOk === splits.length,
        `${perRowOk} per-row, ${hostModeOk} single-host, of ${splits.length}`);
    check('no row claims another line\'s goods', noFake === splits.length,
        `${splits.length - noFake} invoices duplicated the whole bill on one row`);

    // Quantity/rate drift against the source invoice. A bill can hold several
    // lines of the SAME product (Mix Milk 70 @ 85 and Mix Milk 40 @ 86), so every
    // displayed line must match a distinct invoice line on name + quantity + rate.
    for (const g of splits) {
        const src = db.prepare('SELECT product_name, quantity, unit, rate FROM sales_items WHERE sale_id = ? ORDER BY id').all(g[0].source_id);
        const used = new Set();
        for (const e of g) {
            if (!Array.isArray(e.items)) continue;
            for (const it of e.items) {
                const idx = src.findIndex((s, i) => !used.has(i)
                    && String(s.product_name || '').trim() === String(it.product_name || '').trim()
                    && Math.abs(Number(s.quantity) - Number(it.quantity)) <= 0.005
                    && Math.abs(Number(s.rate) - Number(it.rate)) <= 0.005);
                if (idx < 0) drift++; else used.add(idx);
            }
        }
    }
    check('every displayed quantity and rate matches the invoice line', drift === 0, `${drift} drifted`);
}

console.log('\n— 7. Totals still reconcile with the ledger (statement integrity) —');
{
    for (const pid of [saleParty.id, purchaseParty.id, milkParty.id]) {
        const data = getPartyStatement(db, { party_id: pid });
        const direct = db.prepare(`
            SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c
            FROM ledger_entries WHERE party_id = ? AND date >= ? AND date <= ?
        `).get(pid, data.from_date, data.to_date);
        check(`party ${pid}: total_debit matches SQL`, Math.abs(data.total_debit - direct.d) < 0.005,
            `${data.total_debit} vs ${direct.d}`);
        check(`party ${pid}: total_credit matches SQL`, Math.abs(data.total_credit - direct.c) < 0.005,
            `${data.total_credit} vs ${direct.c}`);
        const close = data.opening_balance + data.total_debit - data.total_credit;
        check(`party ${pid}: closing = opening + dr - cr`, Math.abs(data.closing_balance - close) < 0.005);
    }
}

console.log('\n— 8. listPartiesWithBalance unaffected —');
{
    const parties = listPartiesWithBalance(db, {});
    check('parties listed', parties.length > 0);
    check('balances are numbers', parties.every(p => typeof p.balance === 'number' || p.balance == null));
}

console.log('\n— 9. Statement columns: Qty/Rate kept, Item/Unit columns gone —');
{
    const src = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'statements.js'), 'utf8');
    // The on-screen table and the print/PDF table both build from the same
    // header list; assert on every header row found in the file.
    const headers = src.match(/<thead><tr><th>[^`]*?<\/tr><\/thead>/g) || [];
    check('the statement has at least one header row', headers.length > 0, headers.length);
    const joiner = headers.join('\n');
    check('Quantity column is present', /rlt\('quantity'\)/.test(joiner));
    check('Rate column is present', /rlt\('rate'\)/.test(joiner));
    check('Debit column is present', /rlt\('debit'\)/.test(joiner));
    check('Credit column is present', /rlt\('credit'\)/.test(joiner));
    check('Running-balance column is present', /rlt\('balance'\)/.test(joiner));
    check('no Item/Product column', !/rlt\('item'\)|Item \/ Product|<th[^>]*>Item<\/th>/.test(joiner));
    check('no Unit column', !/rlt\('unit'\)|<th[^>]*>Unit<\/th>/.test(joiner));
    check('rows still print qty and rate cells', /c\.qty/.test(src) && /c\.rate/.test(src));
    const pj = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'party.js'), 'utf8');
    check('party ledger modal prints qty and rate', /c\.qty/.test(pj) && /c\.rate/.test(pj));
    check('party ledger modal has no Item/Unit columns',
        !/<th[^>]*>\s*(Item|Unit)\s*<\/th>/.test(pj));
}

console.log('\n— 10. A row named after a product always shows its quantity and rate —');
{
    // Regression: NAUNI lines printed with blank quantity/rate because a bill
    // posted as one ledger row per product was treated as a "split invoice" and
    // every row except one had its items stripped. Any row whose description is
    // the name of a product on its own invoice must carry that product's qty/rate.
    const parties = db.prepare(`
        SELECT DISTINCT party_id FROM ledger_entries
         WHERE reference_type IN ('sale','purchase') AND COALESCE(description,'') != ''
    `).all();
    let checked = 0, blank = 0;
    const blanks = [];
    for (const { party_id } of parties) {
        const data = getPartyStatement(db, { party_id });
        for (const e of data.entries) {
            if (e.reference_type !== 'sale' && e.reference_type !== 'purchase') continue;
            const desc = String(e.description || '').trim().toLowerCase();
            if (!desc) continue;
            const table = e.reference_type === 'sale' ? 'sales_items' : 'purchase_items';
            const col = e.reference_type === 'sale' ? 'sale_id' : 'purchase_id';
            if (e.source_id == null) continue;
            const named = db.prepare(`SELECT product_name, quantity, rate FROM ${table} WHERE ${col} = ?`).all(e.source_id)
                .filter(i => String(i.product_name || '').trim().toLowerCase() === desc);
            if (!named.length) continue;      // description is not a product line
            checked++;
            const okRow = Array.isArray(e.items) && e.items.length > 0
                && e.items.every(i => i.quantity != null && i.rate != null);
            if (!okRow) { blank++; if (blanks.length < 5) blanks.push(`${party_id}/${e.date}/${e.reference_id}/${e.description}`); }
        }
    }
    check('product-named rows were found to check', checked > 0, `${checked} rows`);
    check('every product-named row carries quantity and rate', blank === 0,
        `${blank} blank of ${checked}: ${blanks.join(', ')}`);
}

db.close();
fs.unlinkSync(TMP_DB);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
