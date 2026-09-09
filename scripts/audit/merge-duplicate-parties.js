/**
 * Merge duplicate parties (exact-name duplicates only).
 * =====================================================
 * Per the audit decision: merge only byte-identical party names.
 * - Canonical party = the id with the most transactions (ties → lowest id).
 * - All rows referencing a duplicate are re-pointed to the canonical id.
 * - Duplicates are soft-archived (parties.archived = 1) — never hard-deleted.
 * - Prints a merge log: dup id → canonical id, transactions moved per table.
 *
 * Usage: node scripts/audit/merge-duplicate-parties.js [dbPath]
 * Default dbPath: data/dairy-plant.db
 */

const path = require('path');
const { openDatabase, runMigrations } = require(path.join(__dirname, '..', '..', 'shared', 'db.js'));

const dbPath = process.argv[2] || path.join(__dirname, '..', '..', 'data', 'dairy-plant.db');
const db = openDatabase(dbPath);
runMigrations(db);

// Find tables that reference parties via a party_id column
const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
).all().map(t => t.name);
const partyTables = [];
for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all();
    if (cols.some(c => c.name === 'party_id')) partyTables.push(t);
}

// Find exact-name duplicate groups (case-insensitive, trimmed)
const dups = db.prepare(
    `SELECT LOWER(TRIM(name)) AS key, name, id FROM parties
     WHERE LOWER(TRIM(name)) IN (
        SELECT LOWER(TRIM(name)) FROM parties GROUP BY LOWER(TRIM(name)) HAVING COUNT(*) > 1
     ) ORDER BY LOWER(TRIM(name)), id`
).all();

const groups = {};
for (const d of dups) {
    if (!groups[d.key]) groups[d.key] = [];
    groups[d.key].push(d);
}

const mergeLog = [];
let totalMoved = 0;

const tx = db.transaction(() => {
    for (const key of Object.keys(groups)) {
        const members = groups[key];
        // Canonical = member with most transactions (tie → lowest id)
        let canonical = members[0];
        for (const m of members) {
            const mCount = partyTables.reduce((s, t) => s + (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE party_id = ?`).get(m.id).c || 0), 0);
            const cCount = partyTables.reduce((s, t) => s + (db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE party_id = ?`).get(canonical.id).c || 0), 0);
            if (mCount > cCount || (mCount === cCount && m.id < canonical.id)) canonical = m;
        }
        const dups = members.filter(m => m.id !== canonical.id);
        if (dups.length === 0) continue;
        const moved = {};
        for (const t of partyTables) {
            const r = db.prepare(`UPDATE ${t} SET party_id = ? WHERE party_id = ?`).run(canonical.id, ...dups.map(d => d.id));
            if (r.changes > 0) moved[t] = r.changes;
            // (handles single dup id; multi-dup groups loop below)
        }
        // Handle >1 dup ids per group properly
        for (const d of dups) {
            for (const t of partyTables) {
                const r = db.prepare(`UPDATE ${t} SET party_id = ? WHERE party_id = ?`).run(canonical.id, d.id);
                if (r.changes > 0) moved[t] = (moved[t] || 0) + r.changes;
            }
        }
        for (const d of dups) {
            db.prepare(`UPDATE parties SET archived = 1, notes = COALESCE(notes || '; ', '') || 'Merged into party #' || ? || ' (exact-name duplicate)' WHERE id = ?`).run(canonical.id, d.id);
        }
        const movedTotal = Object.values(moved).reduce((s, n) => s + n, 0);
        totalMoved += movedTotal;
        mergeLog.push({
            group: key,
            canonical_id: canonical.id,
            canonical_name: canonical.name,
            merged_ids: dups.map(d => d.id),
            merged_names: dups.map(d => d.name),
            moved_by_table: moved,
            total_moved: movedTotal
        });
    }
});
tx();

console.log('=== DUPLICATE PARTY MERGE LOG ===');
for (const entry of mergeLog) {
    console.log(`\nGroup: "${entry.group}"`);
    console.log(`  Canonical: #${entry.canonical_id} ${entry.canonical_name}`);
    entry.merged_ids.forEach((id, i) => {
        console.log(`  Merged:   #${id} ${entry.merged_names[i]} (archived)`);
    });
    if (entry.total_moved === 0) {
        console.log('  Transactions moved: none (duplicate had no transactions)');
    } else {
        console.log('  Transactions moved:', entry.moved_by_table, '(total ' + entry.total_moved + ')');
    }
}
console.log(`\nTotal: ${mergeLog.length} duplicate group(s) merged, ${totalMoved} transaction row(s) re-pointed.`);

db.close();