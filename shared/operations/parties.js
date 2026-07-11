/**
 * Godhuli Dairy Plant — Party Operations
 * =======================================
 * Single source of truth for party CRUD and ledger queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * List parties with optional search and type filter.
 */
function listParties(db, { search, type } = {}) {
    let query = "SELECT * FROM parties WHERE 1=1";
    const params = [];
    if (search) {
        query += " AND (name LIKE ? OR phone LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (type) {
        query += " AND (type = ? OR type = 'both')";
        params.push(type);
    }
    query += " ORDER BY name";
    return db.prepare(query).all(...params);
}

/**
 * Get a single party by ID.
 */
function getParty(db, id) {
    return db.prepare("SELECT * FROM parties WHERE id = ?").get(id);
}

/**
 * Create or update a party.
 * When creating with a non-zero opening balance, also inserts a ledger entry.
 */
function saveParty(db, party) {
    const trx = db.transaction(() => {
        if (party.id) {
            db.prepare(
                "UPDATE parties SET name=?, phone=?, address=?, pan_vat=?, type=?, opening_balance=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(
                party.name, party.phone || '', party.address || '',
                party.pan_vat || '', party.type || 'customer',
                party.opening_balance || 0, party.notes || '', party.id
            );
            return { id: party.id };
        } else {
            const result = db.prepare(
                "INSERT INTO parties (name, phone, address, pan_vat, type, opening_balance, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
            ).run(
                party.name, party.phone || '', party.address || '',
                party.pan_vat || '', party.type || 'customer',
                party.opening_balance || 0, party.notes || ''
            );
            const bal = parseFloat(party.opening_balance || 0);
            if (bal !== 0) {
                db.prepare(
                    "INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, date('now','localtime'), 'opening', 'Opening Balance', ?, 0, ?)"
                ).run(result.lastInsertRowid, bal > 0 ? bal : 0, bal);
            }
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete a party if it has no transactions.
 * Throws if the party has sales or purchases.
 */
function deleteParty(db, id) {
    const hasSales = db.prepare("SELECT COUNT(*) as count FROM sales WHERE party_id = ?").get(id);
    const hasPurchases = db.prepare("SELECT COUNT(*) as count FROM purchases WHERE party_id = ?").get(id);
    if (hasSales.count > 0 || hasPurchases.count > 0) {
        throw new Error('Cannot delete party with existing transactions. You can deactivate them instead.');
    }
    db.prepare("DELETE FROM parties WHERE id = ?").run(id);
    return { deleted: true };
}

/**
 * Get ledger entries for a party with optional date range.
 */
function getPartyLedger(db, { party_id, from_date, to_date }) {
    let query = "SELECT * FROM ledger_entries WHERE party_id = ?";
    const params = [party_id];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    query += " ORDER BY date, id";
    const entries = db.prepare(query).all(...params);
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    return { entries, party };
}

module.exports = { listParties, getParty, saveParty, deleteParty, getPartyLedger };
