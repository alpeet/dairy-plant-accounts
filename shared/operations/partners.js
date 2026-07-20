/**
 * Godhuli Dairy Plant — Partner Capital Operations
 * ==================================================
 * CRUD for partner capital contributions and withdrawals with running balance.
 */

const { logAudit } = require('./audit');

/**
 * List partner capital transactions for a specific partner.
 */
function listPartnerCapital(db, { party_id, from_date, to_date } = {}) {
    let query = `SELECT pc.*, u.username as created_by_name 
                 FROM partner_capital pc LEFT JOIN users u ON pc.created_by = u.id WHERE 1=1`;
    const params = [];
    if (party_id) { query += " AND pc.party_id = ?"; params.push(party_id); }
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    query += " ORDER BY pc.date ASC, pc.id ASC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single partner capital transaction.
 */
function getPartnerCapital(db, id) {
    return db.prepare("SELECT * FROM partner_capital WHERE id = ?").get(id);
}

/**
 * Save a partner capital transaction (create or update).
 * Also updates ledger_entries.
 */
function savePartnerCapital(db, data) {
    const trx = db.transaction(() => {
        if (data.id) {
            const oldTxn = db.prepare("SELECT * FROM partner_capital WHERE id = ?").get(data.id);
            // Remove old ledger entry
            db.prepare("DELETE FROM ledger_entries WHERE reference_type IN ('partner_contribution', 'partner_withdrawal') AND reference_id = ?").run(data.id);

            db.prepare(`
                UPDATE partner_capital SET party_id=?, date=?, type=?, amount=?, mode=?,
                    reference_no=?, notes=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(data.party_id, data.date, data.type, data.amount, data.mode || 'bank',
                  data.reference_no || '', data.notes || '', data.id);

            logAudit(db, 'partner_capital', data.id, 'update', oldTxn, data, data.created_by);
        } else {
            const result = db.prepare(`
                INSERT INTO partner_capital (party_id, date, type, amount, mode, reference_no, notes, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(data.party_id, data.date, data.type, data.amount, data.mode || 'bank',
                  data.reference_no || '', data.notes || '', data.created_by || null);
            data.id = result.lastInsertRowid;
            logAudit(db, 'partner_capital', data.id, 'create', null, data, data.created_by);
        }

        // Add ledger entry
        const refType = data.type === 'contribution' ? 'partner_contribution' : 'partner_withdrawal';
        const description = data.type === 'contribution' ? 'Capital Contribution' : 'Capital Withdrawal/Drawings';
        
        if (data.type === 'contribution') {
            db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit) VALUES (?, ?, ?, ?, ?, ?, 0)")
                .run(data.party_id, data.date, refType, data.id, description, data.amount);
        } else {
            db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit) VALUES (?, ?, ?, ?, ?, ?, 0)")
                .run(data.party_id, data.date, refType, data.id, description, data.amount);
        }

        return { id: data.id };
    });
    return trx();
}

/**
 * Delete a partner capital transaction.
 */
function deletePartnerCapital(db, id, changedBy = null) {
    const oldTxn = db.prepare("SELECT * FROM partner_capital WHERE id = ?").get(id);
    db.prepare("DELETE FROM ledger_entries WHERE reference_type IN ('partner_contribution', 'partner_withdrawal') AND reference_id = ?").run(id);
    db.prepare("DELETE FROM partner_capital WHERE id = ?").run(id);
    logAudit(db, 'partner_capital', id, 'delete', oldTxn, null, changedBy);
    return { deleted: true };
}

/**
 * Get partner capital statement with running balance.
 */
function getPartnerStatement(db, { party_id, from_date, to_date } = {}) {
    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    if (!party) throw new Error('Partner not found');

    const from = from_date || '2000-01-01';
    const to = to_date || new Date().toISOString().split('T')[0];

    // Get opening balance (before from_date)
    const opening = db.prepare(`
        SELECT COALESCE(SUM(CASE WHEN type='contribution' THEN amount ELSE 0 END), 0) as total_in,
               COALESCE(SUM(CASE WHEN type='withdrawal' THEN amount ELSE 0 END), 0) as total_out
        FROM partner_capital WHERE party_id = ? AND date < ?
    `).get(party_id, from);

    const openingBalance = (opening.total_in || 0) - (opening.total_out || 0) + (party.opening_balance || 0);

    // Get transactions in range
    const transactions = db.prepare(`
        SELECT * FROM partner_capital WHERE party_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC, id ASC
    `).all(party_id, from, to);

    // Calculate running balance
    let running = openingBalance;
    const txnsWithBalance = transactions.map(t => {
        const amount = parseFloat(t.amount || 0);
        if (t.type === 'contribution') running += amount;
        else running -= amount;
        return { ...t, running_balance: running };
    });

    const totalIn = transactions.filter(t => t.type === 'contribution').reduce((s, t) => s + t.amount, 0);
    const totalOut = transactions.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);

    return {
        party,
        from_date: from,
        to_date: to,
        opening_balance: openingBalance,
        transactions: txnsWithBalance,
        total_contributions: totalIn,
        total_withdrawals: totalOut,
        closing_balance: openingBalance + totalIn - totalOut
    };
}

/**
 * Get all partners with their current capital balance.
 */
function listPartnersWithBalance(db) {
    const partners = db.prepare("SELECT * FROM parties WHERE type = 'partner' ORDER BY name").all();
    return partners.map(p => {
        const cap = db.prepare(`
            SELECT COALESCE(SUM(CASE WHEN type='contribution' THEN amount ELSE 0 END), 0) as total_in,
                   COALESCE(SUM(CASE WHEN type='withdrawal' THEN amount ELSE 0 END), 0) as total_out
            FROM partner_capital WHERE party_id = ?
        `).get(p.id);
        const balance = (p.opening_balance || 0) + (cap.total_in || 0) - (cap.total_out || 0);
        return { ...p, capital_balance: balance, total_contributions: cap.total_in || 0, total_withdrawals: cap.total_out || 0 };
    });
}

module.exports = { listPartnerCapital, getPartnerCapital, savePartnerCapital, deletePartnerCapital, getPartnerStatement, listPartnersWithBalance };
