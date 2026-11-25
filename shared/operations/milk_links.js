/**
 * Milk ↔ purchase-statement links.
 *
 * Why this exists
 * ---------------
 * A supplier's statement is built from `ledger_entries`. A milk purchase can
 * be posted as ONE ledger row for the whole bill (what the importer writes
 * today) or as one row per milk line (what the workbook's Party_Ledger sheet
 * held). The statement used to re-discover the milk behind each row by
 * matching amounts: a row shows a collection only when qty × rate equals the
 * row's amount. That is safe, but it hides milk whenever the workbook posted a
 * line for a different amount than the bill's own milk line, which is exactly
 * what happened on some MODERN AGRO days: the ledger says 10 L, the bill says
 * 14.7 L.
 *
 * The importer knows the document that produced every collection
 * (`milk_collections.purchase_ref_id`), so the link does not have to be
 * guessed at statement time. This module records it once, at import time, and
 * repairs databases imported by older code.
 *
 * Rules — amounts are NEVER touched
 *   1. A collection is linked to at most one ledger row (unique index), and a
 *      row's links are only ever collections of the purchase it belongs to.
 *   2. A bill posted as a single ledger row gets all of its collections.
 *   3. A bill posted as several rows pairs row ↔ collection:
 *        a. exact amount (qty × rate) and, when the row's description names a
 *           milk type, the same type — basis 'amount';
 *        b. otherwise, when the leftovers of one milk type form exactly one
 *           collection per row of that type, they are paired in document
 *           order (both sides are written in the sheet's morning/evening
 *           order) — basis 'bill-order'.
 *      Anything that does not pair unambiguously is left unlinked and stays
 *      flagged on the statement.
 *   4. Only rows and collections of the same purchase are ever paired, so a
 *      repeated bill number on another date cannot leak milk onto a row.
 */

const MONEY_EPS = 0.01;

function ensureLinkTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS milk_statement_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ledger_entry_id INTEGER NOT NULL,
            milk_collection_id INTEGER NOT NULL,
            basis TEXT NOT NULL DEFAULT 'amount',
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UNIQUE (ledger_entry_id, milk_collection_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_milk_links_collection
            ON milk_statement_links (milk_collection_id);
        CREATE INDEX IF NOT EXISTS idx_milk_links_entry
            ON milk_statement_links (ledger_entry_id);
    `);
}

function normalMilkType(value) {
    const t = String(value || '').trim().toLowerCase();
    if (!t) return '';
    if (t.includes('buffalo')) return 'buffalo';
    if (t.includes('mix')) return 'mixed';
    if (/\bcow\b/.test(t)) return 'cow';
    return t;
}

/** Milk type named by a ledger row's description ("Cow Milk", "Buffalo Milk"). */
function rowMilkType(description) {
    return normalMilkType(description);
}

function lineValue(l) {
    const amount = Number(l.amount);
    if (isFinite(amount) && amount !== 0) return amount;
    return Number(l.quantity_liters || 0) * Number(l.rate || 0);
}

const COLLECTION_COLUMNS = `mc.id, mc.purchase_ref_id, mc.milk_type, mc.quantity_liters, mc.rate,
    mc.amount, mc.fat_percent, mc.snf_percent, mc.extra_per_unit, mc.shift`;

/**
 * Collections linked to the given ledger rows, keyed by ledger_entry_id.
 * Returns {} when the link table does not exist yet (old database, no repair
 * run), so the statement simply falls back to amount matching.
 */
function milkLinksForEntries(db, ids) {
    const out = {};
    const list = (Array.isArray(ids) ? ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!list.length) return out;
    let hasTable = false;
    try {
        hasTable = !!db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','index') AND name IN ('milk_statement_links','idx_milk_links_entry') LIMIT 1"
        ).get();
    } catch (e) { hasTable = false; }
    if (!hasTable) return out;
    const ph = list.map(() => '?').join(',');
    try {
        const rows = db.prepare(`
            SELECT l.ledger_entry_id, ${COLLECTION_COLUMNS}
              FROM milk_statement_links l
              JOIN milk_collections mc ON mc.id = l.milk_collection_id
             WHERE l.ledger_entry_id IN (${ph})
             ORDER BY mc.date, mc.id
        `).all(...list);
        for (const r of rows) {
            const key = r.ledger_entry_id;
            (out[key] = out[key] || []).push(r);
        }
    } catch (e) { return {}; }
    return out;
}

/**
 * Link a purchase bill's collections to its statement row(s).
 * Idempotent; safe to call for one bill after an import.
 */
function linkPurchase(db, purchaseId, opts = {}) {
    return repairMilkLinks(db, Object.assign({ purchaseId: Number(purchaseId) }, opts));
}

/**
 * Repair / create the links. Idempotent. Returns a report; writes nothing but
 * rows in `milk_statement_links` and removes links to deleted rows.
 */
function repairMilkLinks(db, opts = {}) {
    const report = { linked: 0, bills: 0, existing: 0, ambiguous: 0, unresolved: 0, orphans_removed: 0 };
    let hasCollections = false;
    try {
        hasCollections = !!db.prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='milk_collections' LIMIT 1"
        ).get();
    } catch (e) { hasCollections = false; }
    if (!hasCollections) return report;

    ensureLinkTable(db);

    const scopeParty = opts.partyId != null ? Number(opts.partyId) : null;
    const scopeDate = opts.date || null;
    const scopeBill = opts.billNo != null ? String(opts.billNo) : null;
    const scopePurchase = opts.purchaseId != null ? Number(opts.purchaseId) : null;

    const tx = db.transaction(() => {
        // Links whose collection or ledger row no longer exists (a re-import
        // deletes and recreates the collections of a changed bill).
        report.orphans_removed = db.prepare(`
            DELETE FROM milk_statement_links
             WHERE milk_collection_id NOT IN (SELECT id FROM milk_collections)
                OR ledger_entry_id NOT IN (SELECT id FROM ledger_entries)
        `).run().changes;

        const ledgerRows = db.prepare(`
            SELECT id, party_id, date, reference_id, description, debit, credit
              FROM ledger_entries
             WHERE reference_type = 'purchase' AND party_id IS NOT NULL
             ORDER BY id
        `).all().filter(r =>
            (scopeParty == null || Number(r.party_id) === scopeParty) &&
            (!scopeDate || r.date === scopeDate) &&
            (!scopeBill || String(r.reference_id) === scopeBill));

        if (!ledgerRows.length) return;

        const byId = db.prepare('SELECT id, party_id, date, bill_no FROM purchases WHERE id = ?');
        const byBillDate = db.prepare(
            'SELECT id, party_id, date, bill_no FROM purchases WHERE party_id = ? AND bill_no = ? AND date = ? ORDER BY id LIMIT 1'
        );
        const byBill = db.prepare(
            'SELECT id, party_id, date, bill_no FROM purchases WHERE party_id = ? AND bill_no = ? ORDER BY id LIMIT 1'
        );

        const groups = new Map();
        for (const r of ledgerRows) {
            let purchase = null;
            const ref = r.reference_id;
            if (ref != null && /^\d+$/.test(String(ref))) {
                purchase = byId.get(Number(ref)) || null;
            }
            if (!purchase && ref != null && String(ref).trim() !== '') {
                const bill = String(ref).trim();
                purchase = byBillDate.get(r.party_id, bill, r.date) || byBill.get(r.party_id, bill) || null;
            }
            if (!purchase) { report.unresolved++; continue; }
            if (scopePurchase != null && Number(purchase.id) !== scopePurchase) continue;
            const key = purchase.id;
            if (!groups.has(key)) groups.set(key, { purchase, rows: [] });
            groups.get(key).rows.push(r);
        }

        const linkedEntryIds = new Set();
        for (const g of groups.values()) for (const r of g.rows) linkedEntryIds.add(r.id);
        const existingByEntry = {};
        const linkedCollections = new Set();
        if (linkedEntryIds.size) {
            const ids = [...linkedEntryIds];
            const chunk = ids.map(() => '?').join(',');
            for (const l of db.prepare(
                `SELECT ledger_entry_id, milk_collection_id FROM milk_statement_links WHERE ledger_entry_id IN (${chunk})`
            ).all(...ids)) {
                (existingByEntry[l.ledger_entry_id] = existingByEntry[l.ledger_entry_id] || new Set())
                    .add(Number(l.milk_collection_id));
                linkedCollections.add(Number(l.milk_collection_id));
                report.existing++;
            }
        }

        const insertLink = db.prepare(`
            INSERT OR IGNORE INTO milk_statement_links (ledger_entry_id, milk_collection_id, basis)
            VALUES (?, ?, ?)
        `);
        const addLink = (row, collection, basis) => {
            const entryLinks = existingByEntry[row.id] = existingByEntry[row.id] || new Set();
            if (entryLinks.has(collection.id) || linkedCollections.has(collection.id)) return false;
            insertLink.run(row.id, collection.id, basis);
            entryLinks.add(collection.id);
            linkedCollections.add(collection.id);
            report.linked++;
            return true;
        };

        for (const g of groups.values()) {
            const cols = db.prepare(`
                SELECT ${COLLECTION_COLUMNS} FROM milk_collections mc
                 WHERE mc.purchase_ref_id = ? ORDER BY mc.date, mc.id
            `).all(g.purchase.id);
            if (!cols.length) continue;
            const openCols = cols.filter(c => !linkedCollections.has(c.id));
            if (!openCols.length) continue;
            const openRows = g.rows.filter(r => !(existingByEntry[r.id] && existingByEntry[r.id].size));
            if (!openRows.length) continue;
            const linkedBefore = report.linked;

            // 1. The whole bill lives on one row: it carries all its milk.
            if (g.rows.length === 1) {
                for (const c of openCols) addLink(g.rows[0], c, 'bill');
                continue;
            }

            // 2. Exact amount (and same milk type when the row names one).
            let remainingCols = openCols.slice();
            let remainingRows = openRows.slice();
            for (const row of remainingRows.slice()) {
                const amount = Math.abs((Number(row.credit) || 0) - (Number(row.debit) || 0));
                if (amount <= 0) continue;
                const type = rowMilkType(row.description);
                const hits = remainingCols.filter(c =>
                    Math.abs(lineValue(c) - amount) <= MONEY_EPS &&
                    (!type || normalMilkType(c.milk_type) === type));
                if (hits.length === 1) {
                    addLink(row, hits[0], 'amount');
                    remainingCols = remainingCols.filter(c => c.id !== hits[0].id);
                    remainingRows = remainingRows.filter(r => r.id !== row.id);
                }
            }

            // 3. Leftovers of one milk type, one collection per row: pair in
            //    document order (the sheet writes morning before evening).
            const collectionsByType = new Map();
            for (const c of remainingCols) {
                const t = normalMilkType(c.milk_type);
                if (!collectionsByType.has(t)) collectionsByType.set(t, []);
                collectionsByType.get(t).push(c);
            }
            const rowsByType = new Map();
            for (const row of remainingRows) {
                const t = rowMilkType(row.description);
                if (!t) continue;
                if (!rowsByType.has(t)) rowsByType.set(t, []);
                rowsByType.get(t).push(row);
            }
            for (const [type, typeRows] of rowsByType) {
                const typeCols = collectionsByType.get(type) || [];
                if (!typeRows.length || typeRows.length !== typeCols.length) continue;
                typeRows.sort((a, b) => a.id - b.id);
                typeCols.sort((a, b) => a.id - b.id);
                for (let i = 0; i < typeRows.length; i++) {
                    addLink(typeRows[i], typeCols[i], 'bill-order');
                }
                collectionsByType.set(type, []);
                for (const r of typeRows) remainingRows = remainingRows.filter(x => x.id !== r.id);
            }

            if (report.linked > linkedBefore) report.bills++;
            if (remainingRows.length) report.ambiguous += remainingRows.length;
        }
    });
    tx();

    return report;
}

module.exports = {
    ensureLinkTable,
    repairMilkLinks,
    linkPurchase,
    milkLinksForEntries,
    rowMilkType,
    MONEY_EPS
};
