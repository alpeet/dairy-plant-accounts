/**
 * Prarambha Account & Stock Management — Petty Cash Operations
 * ============================================
 * CRUD for petty cash register entries.
 *
 * Used by both Electron (main.js) and Web (server.js).
 *
 * Party status on a voucher:
 *   party_id set                    → linked, appears on that party's statement
 *   party_id NULL, party_review = 1 → payee name matched no party: needs review
 *   party_id NULL, party_review = 2 → deliberately marked "not related to a party"
 *   party_id NULL, party_review = 0 → no payee at all
 *
 * Only a deliberate operator action moves a voucher from one state to another
 * (see assignPettyCashParty). Name matching during save uses the exact-unique
 * rule in accounting_dates.resolveParty — never similarity, never a guess.
 */

const { logAudit } = require('./audit');
const accountingDates = require('./accounting_dates');
const { ACCOUNT } = require('./accounting');

/** party_review values for a voucher that has no party. */
const PARTY_REVIEW = { CLEAR: 0, NEEDS_REVIEW: 1, NOT_RELATED: 2 };

/**
 * List petty cash entries with optional date / head / party-status filter.
 * party_status: 'assigned' | 'unassigned' | 'not_related'
 */
function listPettyCash(db, { from_date, to_date, expense_head, party_status } = {}) {
    let query = `SELECT pc.*, u.username as created_by_name, p.name as party_name
                 FROM petty_cash pc
                 LEFT JOIN users u ON pc.created_by = u.id
                 LEFT JOIN parties p ON pc.party_id = p.id
                 WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    if (expense_head) { query += " AND pc.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    if (party_status === 'assigned') {
        query += " AND pc.party_id IS NOT NULL";
    } else if (party_status === 'not_related') {
        query += " AND pc.party_id IS NULL AND COALESCE(pc.party_review, 0) = ?";
        params.push(PARTY_REVIEW.NOT_RELATED);
    } else if (party_status === 'unassigned') {
        query += " AND pc.party_id IS NULL AND COALESCE(pc.party_review, 0) <> ?";
        params.push(PARTY_REVIEW.NOT_RELATED);
    }
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
 * Post (or remove) the ONE tagged ledger row a voucher has on a party account.
 * A payment reduces that party's payable; an ADVANCE voucher is an advance
 * receivable (never an expense). The row is tagged 'PETTY:' so the party
 * statement can label its source module and never count it twice.
 */
function postPettyLedgerRow(db, row, partyId) {
    db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'PETTY:%'")
        .run(row.id);
    if (!partyId) return;
    const isAdvance = String(row.expense_head || '').trim().toUpperCase() === 'ADVANCE';
    const label = isAdvance
        ? `PETTY: Advance paid — ${row.voucher_no}`
        : `PETTY: ${row.expense_head} — ${row.voucher_no}`;
    const desc = isAdvance ? `${label} [${ACCOUNT.ADVANCE_RECEIVABLE}]` : label;
    db.prepare(
        "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 0, 0)"
    ).run(partyId, row.date, row.accounting_date || row.date, row.id, desc, row.amount);
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
    // An explicit "not related to a party" decision must survive an edit.
    const notRelated = !!data.party_not_related || (data.party_id === null && data.party_not_related === true);
    const finalPartyId = notRelated ? null : party.party_id;
    const finalReview = notRelated ? PARTY_REVIEW.NOT_RELATED : party.review;

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
                finalPartyId, finalReview, data.paid_to || '', data.approved_by || '',
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
                finalPartyId, finalReview, data.paid_to || '', data.approved_by || '',
                data.payment_mode || 'cash', data.remarks || '', data.created_by || null
            );
            id = result.lastInsertRowid;
            logAudit(db, 'petty_cash', id, 'create', null, data, data.created_by);
        }

        const row = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
        postPettyLedgerRow(db, row, finalPartyId);

        return { id };
    });
    return trx();
}

/**
 * Assign a party to an existing voucher — the ONLY way a historical voucher
 * changes party. Date, amount, voucher number and every accounting value are
 * left exactly as they were; only party_id / party_review move, and the
 * voucher's single tagged ledger row is re-posted to the chosen party.
 *
 * Pass party_id = null and not_related = true to record "this voucher does not
 * belong to a party" instead.
 */
function assignPettyCashParty(db, { id, party_id, not_related, changed_by } = {}) {
    const row = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
    if (!row) throw new Error('Petty cash voucher not found');

    let newPartyId = null;
    let newReview = PARTY_REVIEW.NOT_RELATED;
    let partyName = null;

    if (!not_related) {
        if (!party_id) throw new Error('Select a party, or mark the voucher as not related to a party');
        const party = db.prepare("SELECT id, name FROM parties WHERE id = ?").get(party_id);
        if (!party) throw new Error('Party not found');
        newPartyId = party.id;
        newReview = PARTY_REVIEW.CLEAR;
        partyName = party.name;
    }

    const trx = db.transaction(() => {
        db.prepare("UPDATE petty_cash SET party_id = ?, party_review = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(newPartyId, newReview, id);
        postPettyLedgerRow(db, row, newPartyId);
        logAudit(db, 'petty_cash', id, 'update',
            { party_id: row.party_id, party_review: row.party_review },
            { party_id: newPartyId, party_review: newReview, assignment: not_related ? 'not_related' : 'party' },
            changed_by || null);
        return { id, party_id: newPartyId, party_name: partyName, party_review: newReview };
    });
    return trx();
}

/**
 * Progress counters for the "Party Not Assigned" review.
 */
function getPettyCashPartyReviewStats(db) {
    const r = db.prepare(`
        SELECT COUNT(*) AS total,
               COALESCE(SUM(CASE WHEN party_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS assigned,
               COALESCE(SUM(CASE WHEN party_id IS NULL AND COALESCE(party_review, 0) <> ? THEN 1 ELSE 0 END), 0) AS unassigned,
               COALESCE(SUM(CASE WHEN party_id IS NULL AND COALESCE(party_review, 0) = ? THEN 1 ELSE 0 END), 0) AS not_related
        FROM petty_cash
    `).get(PARTY_REVIEW.NOT_RELATED, PARTY_REVIEW.NOT_RELATED);
    return { ...r, remaining: r.unassigned };
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

module.exports = {
    PARTY_REVIEW,
    listPettyCash,
    getPettyCash,
    savePettyCash,
    assignPettyCashParty,
    getPettyCashPartyReviewStats,
    postPettyLedgerRow,
    deletePettyCash,
    getPettyCashSummary
};
