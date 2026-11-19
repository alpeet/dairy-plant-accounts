/**
 * Prarambha Account & Stock Management — Petty Cash Operations
 * ============================================
 * CRUD for petty cash register entries.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');
const accountingDates = require('./accounting_dates');
const { ACCOUNT } = require('./accounting');

/**
 * List petty cash entries with optional date filter.
 */
function listPettyCash(db, { from_date, to_date, expense_head } = {}) {
    let query = `SELECT pc.*, u.username as created_by_name 
                 FROM petty_cash pc LEFT JOIN users u ON pc.created_by = u.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    if (expense_head) { query += " AND pc.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    query += " ORDER BY pc.date DESC, pc.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single petty cash entry.
 */
function getPettyCash(db, id) {
    return db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
}

/**
 * Save a petty cash entry (create or update).
 */
function savePettyCash(db, data) {
    const dates = accountingDates.normalizeDates({
        date: data.date,
        accounting_date: data.accounting_date
    });
    const party = accountingDates.resolveParty(db, {
        party_id: data.party_id,
        paid_to: data.paid_to
    });
    const isAdvance = String(data.expense_head || '').trim().toUpperCase() === 'ADVANCE';

    const trx = db.transaction(() => {
        let id = data.id;
        if (id) {
            const oldEntry = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
            db.prepare(`
                UPDATE petty_cash SET voucher_no=?, date=?, accounting_date=?, accounting_date_source=?,
                    expense_head=?, description=?, amount=?, party_id=?, party_review=?, paid_to=?,
                    approved_by=?, payment_mode=?, remarks=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.voucher_no, dates.date, dates.accounting_date, dates.source,
                data.expense_head, data.description || '', data.amount,
                party.party_id, party.review, data.paid_to || '', data.approved_by || '',
                data.payment_mode || 'cash', data.remarks || '', id
            );
            logAudit(db, 'petty_cash', id, 'update', oldEntry, data, data.created_by);
        } else {
            const result = db.prepare(`
                INSERT INTO petty_cash (voucher_no, date, accounting_date, accounting_date_source,
                    expense_head, description, amount, party_id, party_review, paid_to, approved_by,
                    payment_mode, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.voucher_no, dates.date, dates.accounting_date, dates.source,
                data.expense_head, data.description || '', data.amount,
                party.party_id, party.review, data.paid_to || '', data.approved_by || '',
                data.payment_mode || 'cash', data.remarks || '', data.created_by || null
            );
            id = result.lastInsertRowid;
            logAudit(db, 'petty_cash', id, 'create', null, data, data.created_by);
        }

        // A voucher paid to a supplier/party reaches that party's account:
        // a payment reduces the payable, an ADVANCE is a receivable (never an
        // expense). The row is tagged 'PETTY:' so the party statement can label
        // its true source module and never count it twice.
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'PETTY:%'")
            .run(id);
        if (party.party_id) {
            const label = isAdvance
                ? `PETTY: Advance paid — ${data.voucher_no}`
                : `PETTY: ${data.expense_head} — ${data.voucher_no}`;
            const desc = isAdvance ? `${label} [${ACCOUNT.ADVANCE_RECEIVABLE}]` : label;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 0, 0)"
            ).run(party.party_id, dates.date, dates.accounting_date, id, desc, data.amount);
        }

        return { id };
    });
    return trx();
}

/**
 * Delete a petty cash entry.
 */
function deletePettyCash(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
    db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'PETTY:%'")
        .run(id);
    db.prepare("DELETE FROM petty_cash WHERE id = ?").run(id);
    logAudit(db, 'petty_cash', id, 'delete', oldEntry, null, changedBy);
    return { deleted: true };
}

/**
 * Get petty cash summary (totals for a period).
 */
function getPettyCashSummary(db, { from_date, to_date } = {}) {
    let query = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total FROM petty_cash WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    return db.prepare(query).get(...params);
}

module.exports = { listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary };
