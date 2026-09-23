/**
 * Prarambha Account & Stock Management — Party Account Summary
 * ============================================================
 * ONE ledger-driven calculation that every outstanding view shares:
 * Parties tab, Receivable/Payable reports, statements and the dashboard.
 *
 * Ledger semantics (matching statements.js):
 *   debit  = the party owes us more   (sale, advance given, payment made)
 *   credit = we owe the party more    (purchase, milk collection, receipt)
 *   balance = opening_balance + SUM(debit) - SUM(credit)
 *   balance > 0 -> Receivable (Dr), balance < 0 -> Payable (Cr)
 */

/**
 * Per-party accounting summary computed from ledger_entries.
 */
function getPartyAccountSummary(db, { type, search, as_of_date } = {}) {
    let query = `
        SELECT p.id, p.name, p.type, p.phone, p.party_code, p.opening_balance,
            COALESCE(SUM(CASE WHEN le.reference_type = 'purchase' THEN le.credit - le.debit ELSE 0 END), 0) AS purchase_total,
            COALESCE(SUM(CASE WHEN le.reference_type = 'milk_collection' THEN le.credit - le.debit ELSE 0 END), 0) AS milk_total,
            COALESCE(SUM(CASE WHEN le.reference_type = 'sale' THEN le.debit - le.credit ELSE 0 END), 0) AS sales_total,
            COALESCE(SUM(CASE WHEN le.reference_type IN ('payment_made', 'partner_withdrawal') THEN le.debit - le.credit ELSE 0 END), 0) AS paid_total,
            COALESCE(SUM(CASE WHEN le.reference_type IN ('payment_received', 'partner_contribution') THEN le.credit - le.debit ELSE 0 END), 0) AS received_total,
            COALESCE(SUM(CASE WHEN le.reference_type = 'advance' THEN le.debit - le.credit ELSE 0 END), 0) AS advance_total,
            COALESCE(SUM(le.debit), 0) AS total_debit,
            COALESCE(SUM(le.credit), 0) AS total_credit
        FROM parties p
        LEFT JOIN ledger_entries le ON le.party_id = p.id
            @ASOF
        GROUP BY p.id
    `;
    const params = [];
    query = query.replace('@ASOF', as_of_date ? 'AND le.date <= ?' : '');
    if (as_of_date) params.push(as_of_date);

    const conds = [];
    if (type) { conds.push("(p.type = ? OR p.type = 'both')"); params.push(type); }
    if (search) { conds.push('(p.name LIKE ? OR p.phone LIKE ?)'); const like = `%${search}%`; params.push(like, like); }
    if (conds.length) query += ' WHERE ' + conds.join(' AND ');
    query += ' ORDER BY p.name COLLATE NOCASE';

    const rows = db.prepare(query).all(...params);
    for (const r of rows) {
        const opening = r.opening_balance || 0;
        r.balance = opening + (r.total_debit || 0) - (r.total_credit || 0);
        r.receivable = r.balance > 0 ? r.balance : 0;
        r.payable = r.balance < 0 ? -r.balance : 0;
        r.balance_type = r.balance > 0.005 ? 'Receivable' : r.balance < -0.005 ? 'Payable' : 'Settled';
    }
    return rows;
}

module.exports = { getPartyAccountSummary };
