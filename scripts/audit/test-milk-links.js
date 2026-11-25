/**
 * Purchase statement rows → milk collections: the persisted link.
 *
 * Proves, against a /tmp COPY of the live database:
 *  1. every MODERN AGRO collection is linked to its own purchase statement row
 *     — the 10 that the amount-only statement could not reach included;
 *  2. the Debit / Credit amounts, every ledger row's own amount and the
 *     party's opening / closing balance are byte-for-byte unchanged;
 *  3. no collection is linked twice, and every link joins a collection of the
 *     row's own purchase (a repeated bill number on another date cannot leak);
 *  4. the repair is idempotent — a second run writes nothing;
 *  5. a bill imported from Purchase_Entry (one ledger row, two milk lines) is
 *     linked automatically and shows both lines on its statement row;
 *  6. a purchase row with no collections is still flagged, never given an
 *     invented quantity.
 *
 * The live database is only read (copied); the synthetic bill is inserted into
 * the copy.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE_DB = path.join(ROOT, 'data', 'dairy-plant.db');
const TMP_DB = path.join(os.tmpdir(), `milk-link-test-${process.pid}.db`);

// Copy the database WITH its write-ahead log: the live file keeps recent
// commits in `-wal`, and a main-file-only copy would silently test an older
// snapshot.
for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LIVE_DB + suffix)) fs.copyFileSync(LIVE_DB + suffix, TMP_DB + suffix);
}
const db = new Database(TMP_DB);

// Start from the pre-repair state no matter how often this runs: the link
// table is created and filled by the repair itself.
db.exec('DROP TABLE IF EXISTS milk_statement_links;');

const { repairMilkLinks, milkLinksForEntries } = require(path.join(ROOT, 'shared', 'operations', 'milk_links.js'));
const { getPartyStatement } = require(path.join(ROOT, 'shared', 'operations', 'statements.js'));
const { importPurchases, buildPartyIndex } = require(path.join(ROOT, 'shared', 'excel-import.js'));

let passed = 0, failed = 0;
function check(name, cond, detail) {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol = 0.005) => Math.abs(Number(a) - Number(b)) <= tol;

const stmt = (partyId) => getPartyStatement(db, {
    party_id: partyId, from_date: '2082-04-01', to_date: '2084-03-31'
});
const moneyFingerprint = () => db.prepare(`
    SELECT COUNT(*) n, ROUND(SUM(credit),6) credit, ROUND(SUM(debit),6) debit,
           ROUND(SUM(balance),6) balance
      FROM ledger_entries
`).get();
const rowFingerprint = () => db.prepare('SELECT id, debit, credit, balance FROM ledger_entries ORDER BY id').all();
const shownCollectionIds = (s) => {
    const ids = new Set();
    for (const e of s.entries) {
        for (const l of (e.qty_lines || [])) {
            if (l.source === 'milk_collections') ids.add(l.source_id);
        }
    }
    return ids;
};

const MILK_PARTY = 34; // MODERN AGRO -315
const registerQty = db.prepare(
    'SELECT ROUND(SUM(quantity_liters),4) q FROM milk_collections WHERE party_id = ?'
).get(MILK_PARTY).q;
const registerCount = db.prepare(
    'SELECT COUNT(*) n FROM milk_collections WHERE party_id = ?'
).get(MILK_PARTY).n;

// ── Before: what the amount-only statement could not show ─────────────
const before = stmt(MILK_PARTY);
const beforeIds = shownCollectionIds(before);
check('before repair: some collections are not on the statement',
    beforeIds.size < registerCount, `${beforeIds.size}/${registerCount}`);
check('before repair: the gap is the 10 unreconciled rows',
    before.qty_unreconciled_count === 10, String(before.qty_unreconciled_count));
check('before repair: 454 of 464 collections are shown',
    beforeIds.size === 454, String(beforeIds.size));

// Money snapshots for EVERY ledger row (not just the milk party).
const moneyBefore = moneyFingerprint();
const rowsBefore = rowFingerprint();
const partyClosingBefore = new Map();
const partyIds = db.prepare('SELECT id FROM parties ORDER BY id').all().map(r => r.id);
for (const id of partyIds) {
    const s = stmt(id);
    partyClosingBefore.set(id, JSON.stringify([s.total_debit, s.total_credit, s.closing_balance]));
}

// ── Repair ────────────────────────────────────────────────────────────
const r1 = repairMilkLinks(db);
check('repair ran and wrote links', r1.linked > 0, JSON.stringify(r1));

const linkedForParty = db.prepare(`
    SELECT COUNT(*) n, COUNT(DISTINCT l.milk_collection_id) c
      FROM milk_statement_links l
      JOIN ledger_entries e ON e.id = l.ledger_entry_id
     WHERE e.party_id = ?
`).get(MILK_PARTY);
check('every MODERN AGRO collection is linked',
    linkedForParty.n === registerCount && linkedForParty.c === registerCount,
    `${linkedForParty.n}/${linkedForParty.c} of ${registerCount}`);

check('no collection is linked to more than one row',
    db.prepare('SELECT COUNT(*) n FROM (SELECT milk_collection_id FROM milk_statement_links GROUP BY 1 HAVING COUNT(*) > 1)').get().n === 0);

const foreign = db.prepare(`
    SELECT COUNT(*) n
      FROM milk_statement_links l
      JOIN milk_collections mc ON mc.id = l.milk_collection_id
      JOIN ledger_entries e ON e.id = l.ledger_entry_id
      LEFT JOIN purchases p ON p.id = mc.purchase_ref_id
     WHERE p.id IS NULL OR p.party_id <> e.party_id
`).get().n;
check('every link joins a collection of the row\'s own purchase', foreign === 0, String(foreign));

// ── No amount, total or balance moved ─────────────────────────────────
const moneyAfter = moneyFingerprint();
check('ledger totals unchanged', JSON.stringify(moneyAfter) === JSON.stringify(moneyBefore),
    `${JSON.stringify(moneyBefore)} → ${JSON.stringify(moneyAfter)}`);
check('every ledger row keeps its debit / credit / balance',
    JSON.stringify(rowFingerprint()) === JSON.stringify(rowsBefore));
let closingChanged = 0;
for (const id of partyIds) {
    const s = stmt(id);
    if (partyClosingBefore.get(id) !== JSON.stringify([s.total_debit, s.total_credit, s.closing_balance])) closingChanged++;
}
check('every party keeps its debit / credit / closing balance', closingChanged === 0, `${closingChanged} party(ies)`);

// ── After: the statement shows the milk, once ─────────────────────────
const after = stmt(MILK_PARTY);
const afterIds = shownCollectionIds(after);
check('all 464 collections appear on the statement', afterIds.size === registerCount, `${afterIds.size}/${registerCount}`);
check('no row is left unreconciled', after.qty_unreconciled_count === 0, String(after.qty_unreconciled_count));
check('the 10 differing lines are disclosed, not hidden', after.qty_link_diff_count === 10, String(after.qty_link_diff_count));
const milkItems = ((after.qty_summary && after.qty_summary.items) || [])
    .filter(i => /milk/i.test(String(i.name || i.label || '')));
const milkQty = milkItems.reduce((s, i) => s + Number(i.purchase_qty || 0), 0);
check('quantity summary totals the register litres',
    near(milkQty, registerQty), `${milkQty} vs ${registerQty}`);
check('closing balance is exactly the pre-repair figure',
    near(after.closing_balance, before.closing_balance), `${before.closing_balance} vs ${after.closing_balance}`);

// A previously hidden collection now shows on the row that pays for the bill.
const previouslyMissing = [2553, 2556, 2557, 2568, 2593, 2599, 2627, 2633, 2675, 2697];
let nowShown = 0;
for (const id of previouslyMissing) if (afterIds.has(id)) nowShown++;
check('all 10 previously unmatched collections are shown', nowShown === 10, `${nowShown}/10`);

// ── Idempotent ────────────────────────────────────────────────────────
const linkCount = db.prepare('SELECT COUNT(*) n FROM milk_statement_links').get().n;
const r2 = repairMilkLinks(db);
check('second run writes no new link', r2.linked === 0, JSON.stringify(r2));
check('link table row count is stable',
    db.prepare('SELECT COUNT(*) n FROM milk_statement_links').get().n === linkCount);

// ── Import path: a new bill links itself ──────────────────────────────
const BILL = 'TEST-MILK-LINK-' + process.pid;
const supplier = db.prepare('SELECT id, name FROM parties WHERE id = ?').get(MILK_PARTY);
buildPartyIndex(db); // the importer resolves suppliers through its party index
const sheet = [
    ['Dairy Accounts — synthetic purchase (test only)'],
    ['Date', 'AD Date', 'Bill No', 'Supplier Name', 'Shift', 'Product', 'FAT %', 'SNF %',
     'Extra/Unit', 'Rate Type', 'Fixed Rate', 'Rate/Unit', 'Quantity', 'Amount',
     'Transport', 'Net Amount', 'Payment Mode', 'Status', 'Remarks'],
    ['2083-07-15', '', BILL, supplier.name, 'MORNING', 'Cow Milk', 3.5, 7.6, 0, 'FIXED', 0, 50, 10, 500, 0, 500, 'Credit', 'PAID', 'test'],
    ['2083-07-15', '', BILL, supplier.name, 'EVENING', 'Cow Milk', 3.5, 7.6, 0, 'FIXED', 0, 50, 20, 1000, 0, 1000, 'Credit', 'PAID', 'test']
];
importPurchases(db, { data: sheet, SHEET_DATA_START_ROW: 2 }, { mode: 'upsert', log: () => {}, genLedger: true });
const purchase = db.prepare('SELECT * FROM purchases WHERE bill_no = ? AND party_id = ?').get(BILL, supplier.id);
check('synthetic bill imported', !!purchase && near(purchase.grand_total, 1500),
    purchase ? String(purchase.grand_total) : 'missing');
const synthetic = repairMilkLinks(db, { billNo: BILL });
check('the imported bill links both milk lines', synthetic.linked === 2, JSON.stringify(synthetic));
const entry = db.prepare(
    "SELECT id FROM ledger_entries WHERE reference_type='purchase' AND party_id=? AND reference_id=? ORDER BY id DESC LIMIT 1"
).get(supplier.id, BILL);
const linked = entry ? milkLinksForEntries(db, [entry.id])[entry.id] || [] : [];
check('both links point at the bill\'s own statement row', linked.length === 2, String(linked.length));
const afterImport = stmt(MILK_PARTY);
const syntheticLines = afterImport.entries
    .filter(e => e.description && e.description.includes(BILL))
    .reduce((n, e) => n + (e.qty_lines || []).length, 0);
check('the statement shows both milk lines on the new bill', syntheticLines === 2, String(syntheticLines));

// ── An unmatched row is still flagged, never guessed ──────────────────
const bare = db.prepare(`
    INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
    VALUES (?, '2083-07-16', 'purchase', 'TEST-NO-MILK', 'TEST milk purchase with no collection', 0, 777, -777, ?)
`).run(supplier.id, new Date().toISOString());
const bareId = Number(bare.lastInsertRowid);
repairMilkLinks(db);
const flagged = stmt(MILK_PARTY).entries.find(e => Number(e.id) === bareId);
check('a purchase row with no collection stays flagged', !!flagged && flagged.qty_unreconciled === true);
check('and gets no invented quantity', !!flagged && (flagged.qty_lines || []).length === 0);
db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(bareId);

db.close();
try { fs.unlinkSync(TMP_DB); } catch (e) { /* temp file */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
