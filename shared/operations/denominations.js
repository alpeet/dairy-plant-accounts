/**
 * Godhuli Dairy Plant — Denomination Count Operations
 * ====================================================
 * CRUD for daily cash denomination counting.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List denomination counts with optional date filter.
 */
function listDenominations(db, { from_date, to_date } = {}) {
    let query = "SELECT * FROM denomination_counts WHERE 1=1";
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    query += " ORDER BY date DESC, id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single denomination count by ID.
 */
function getDenomination(db, id) {
    return db.prepare("SELECT * FROM denomination_counts WHERE id = ?").get(id);
}

/**
 * Get denomination count for a specific date.
 */
function getDenominationByDate(db, date) {
    return db.prepare("SELECT * FROM denomination_counts WHERE date = ? ORDER BY id DESC LIMIT 1").get(date);
}

/**
 * Save a denomination count (create or update).
 * Calculates total_cash from note/coin counts and difference = total_cash - expected_cash.
 */
function saveDenomination(db, data) {
    const trx = db.transaction(() => {
        // Calculate total from denominations
        const totalCash = 
            (parseInt(data.note_1000 || 0) * 1000) +
            (parseInt(data.note_500 || 0) * 500) +
            (parseInt(data.note_100 || 0) * 100) +
            (parseInt(data.note_50 || 0) * 50) +
            (parseInt(data.note_20 || 0) * 20) +
            (parseInt(data.note_10 || 0) * 10) +
            (parseInt(data.coin_5 || 0) * 5) +
            (parseInt(data.coin_2 || 0) * 2) +
            (parseInt(data.coin_1 || 0) * 1);

        const expected = parseFloat(data.expected_cash || 0);
        const difference = totalCash - expected;

        if (data.id) {
            const oldEntry = db.prepare("SELECT * FROM denomination_counts WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE denomination_counts 
                SET date=?, note_1000=?, note_500=?, note_100=?, note_50=?, note_20=?, note_10=?,
                    coin_5=?, coin_2=?, coin_1=?, total_cash=?, expected_cash=?, difference=?,
                    remarks=?, counted_by=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.date, data.note_1000 || 0, data.note_500 || 0, data.note_100 || 0,
                data.note_50 || 0, data.note_20 || 0, data.note_10 || 0,
                data.coin_5 || 0, data.coin_2 || 0, data.coin_1 || 0,
                totalCash, expected, difference,
                data.remarks || '', data.counted_by || '', data.id
            );
            logAudit(db, 'denomination_counts', data.id, 'update', oldEntry, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO denomination_counts 
                (date, note_1000, note_500, note_100, note_50, note_20, note_10,
                 coin_5, coin_2, coin_1, total_cash, expected_cash, difference,
                 remarks, counted_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.date, data.note_1000 || 0, data.note_500 || 0, data.note_100 || 0,
                data.note_50 || 0, data.note_20 || 0, data.note_10 || 0,
                data.coin_5 || 0, data.coin_2 || 0, data.coin_1 || 0,
                totalCash, expected, difference,
                data.remarks || '', data.counted_by || ''
            );
            logAudit(db, 'denomination_counts', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete a denomination count.
 */
function deleteDenomination(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM denomination_counts WHERE id = ?").get(id);
    db.prepare("DELETE FROM denomination_counts WHERE id = ?").run(id);
    logAudit(db, 'denomination_counts', id, 'delete', oldEntry, null, changedBy);
    return { deleted: true };
}

module.exports = { listDenominations, getDenomination, getDenominationByDate, saveDenomination, deleteDenomination };
