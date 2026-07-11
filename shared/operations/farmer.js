/**
 * Godhuli Dairy Plant — Farmer Bulk Payment Operations
 * =====================================================
 * Single source of truth for farmer outstanding queries and bulk payments.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get all farmers with outstanding milk collection dues.
 */
function getFarmerOutstanding(db) {
    const farmers = db.prepare(`
        SELECT p.id, p.name, p.phone, p.address,
            COALESCE(SUM(mc.amount), 0) as total_due,
            COUNT(mc.id) as pending_collections
        FROM parties p
        JOIN milk_collections mc ON mc.party_id = p.id
        WHERE mc.status IN ('pending', 'processed')
          AND p.type IN ('supplier', 'both')
        GROUP BY p.id, p.name, p.phone, p.address
        HAVING total_due > 0
        ORDER BY p.name
    `).all();

    return farmers.map(f => {
        const collections = db.prepare(`
            SELECT id, collection_no, date, amount, status, quantity_liters
            FROM milk_collections
            WHERE party_id = ? AND status IN ('pending', 'processed')
            ORDER BY date DESC
        `).all(f.id);
        return { ...f, collections };
    });
}

/**
 * Process bulk payments to farmers.
 * Creates payment records, ledger entries, and updates collection statuses.
 */
function bulkPayFarmers(db, { payments, date, mode, notes }) {
    const trx = db.transaction(() => {
        const results = [];
        for (const payment of payments) {
            const { party_id, amount, collection_ids } = payment;
            if (!party_id || !amount || amount <= 0) continue;

            // Create payment record ('payment' type = money going out)
            const payResult = db.prepare(
                "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes) VALUES (?, ?, 'payment', ?, ?, 'milk_collection', ?)"
            ).run(party_id, date, amount, mode, notes || '');

            // Add ledger entry for payment made (debit reduces what we owe)
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_made', ?, ?, ?, 0, 0)"
            ).run(party_id, date, payResult.lastInsertRowid, `Bulk Payment - Milk Collection`, amount);

            // Update paid milk collections to 'paid' status
            if (collection_ids && collection_ids.length > 0) {
                const placeholders = collection_ids.map(() => '?').join(',');
                db.prepare(
                    `UPDATE milk_collections SET status = 'paid', updated_at = datetime('now','localtime') WHERE id IN (${placeholders}) AND party_id = ?`
                ).run(...collection_ids, party_id);

                // Update ledger entries for these collections to balance=0
                db.prepare(
                    `UPDATE ledger_entries SET balance = 0 WHERE reference_type = 'milk_collection' AND reference_id IN (${placeholders})`
                ).run(...collection_ids);
            }

            results.push({
                payment_id: payResult.lastInsertRowid,
                party_id,
                amount,
                collections_cleared: collection_ids ? collection_ids.length : 0
            });
        }
        return results;
    });
    return trx();
}

module.exports = { getFarmerOutstanding, bulkPayFarmers };
