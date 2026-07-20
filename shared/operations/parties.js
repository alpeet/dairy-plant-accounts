/**
 * Godhuli Dairy Plant — Party Operations
 * =======================================
 * Single source of truth for party CRUD and ledger queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List parties with optional search and type filter.
 */
function listParties(db, { search, type } = {}) {
    let query = `SELECT p.*, r.name as route_name
                 FROM parties p
                 LEFT JOIN routes r ON p.route_id = r.id
                 WHERE 1=1`;
    const params = [];
    if (search) {
        query += " AND (p.name LIKE ? OR p.phone LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (type) {
        query += " AND (p.type = ? OR p.type = 'both')";
        params.push(type);
    }
    query += " ORDER BY p.name";
    return db.prepare(query).all(...params);
}

/**
 * Get a single party by ID.
 */
function getParty(db, id) {
    return db.prepare(
        `SELECT p.*, r.name as route_name
         FROM parties p
         LEFT JOIN routes r ON p.route_id = r.id
         WHERE p.id = ?`
    ).get(id);
}

/**
 * Create or update a party.
 * When creating with a non-zero opening balance, also inserts a ledger entry.
 * Supports extended fields: route_id, partner_type, profit_share_percent.
 */
function saveParty(db, party) {
    const trx = db.transaction(() => {
        if (party.id) {
            const oldParty = db.prepare("SELECT * FROM parties WHERE id = ?").get(party.id);
            db.prepare(
                `UPDATE parties SET name=?, phone=?, address=?, pan_vat=?, type=?,
                 opening_balance=?, route_id=?, partner_type=?, profit_share_percent=?,
                 notes=?, updated_at=datetime('now','localtime') WHERE id=?`
            ).run(
                party.name, party.phone || '', party.address || '',
                party.pan_vat || '', party.type || 'customer',
                party.opening_balance || 0,
                party.route_id || null,
                party.partner_type || '',
                party.profit_share_percent || 0,
                party.notes || '', party.id
            );
            logAudit(db, 'parties', party.id, 'update', oldParty, party, party.created_by);
            return { id: party.id };
        } else {
            const result = db.prepare(
                `INSERT INTO parties (name, phone, address, pan_vat, type, opening_balance,
                 route_id, partner_type, profit_share_percent, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                party.name, party.phone || '', party.address || '',
                party.pan_vat || '', party.type || 'customer',
                party.opening_balance || 0,
                party.route_id || null,
                party.partner_type || '',
                party.profit_share_percent || 0,
                party.notes || ''
            );
            const newId = result.lastInsertRowid;
            logAudit(db, 'parties', newId, 'create', null, party, party.created_by);
            const bal = parseFloat(party.opening_balance || 0);
            if (bal !== 0) {
                db.prepare(
                    "INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (?, date('now','localtime'), 'opening', 'Opening Balance', ?, 0, ?)"
                ).run(newId, bal > 0 ? bal : 0, bal);
            }
            return { id: newId };
        }
    });
    return trx();
}

/**
 * Delete a party if it has no transactions.
 * Throws if the party has sales or purchases.
 */
function deleteParty(db, id, changedBy = null) {
    const hasSales = db.prepare("SELECT COUNT(*) as count FROM sales WHERE party_id = ?").get(id);
    const hasPurchases = db.prepare("SELECT COUNT(*) as count FROM purchases WHERE party_id = ?").get(id);
    if (hasSales.count > 0 || hasPurchases.count > 0) {
        throw new Error('Cannot delete party with existing transactions. You can deactivate them instead.');
    }
    const oldParty = db.prepare("SELECT * FROM parties WHERE id = ?").get(id);
    db.prepare("DELETE FROM parties WHERE id = ?").run(id);
    logAudit(db, 'parties', id, 'delete', oldParty, null, changedBy);
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
