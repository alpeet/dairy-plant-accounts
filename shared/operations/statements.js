/**
 * Godhuli Dairy Plant — Customer/Supplier Statement Operations
 * ==============================================================
 * Generates party-wise statements with opening balance, debit/credit,
 * running balance, and closing balance for a given date range.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get party statement with running balance.
 * Builds from ledger_entries with party info and opening balance.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { party_id, from_date, to_date }
 * @returns {object} { party, opening_balance, entries[], total_debit, total_credit, closing_balance }
 */
function getPartyStatement(db, { party_id, from_date, to_date } = {}) {
    if (!party_id) throw new Error('Party ID is required');

    const party = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    if (!party) throw new Error('Party not found');

    // Default date range: from beginning to today
    const from = from_date || '2000-01-01';
    const to = to_date || new Date().toISOString().split('T')[0];

    // Get opening balance (balance from before the from_date)
    // Opening balance is the closing balance from all entries before the from_date
    const openingEntry = db.prepare(`
        SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
        FROM ledger_entries
        WHERE party_id = ? AND date < ?
    `).get(party_id, from);

    const openingBalance = (openingEntry.total_credit || 0) - (openingEntry.total_debit || 0) + (party.opening_balance || 0);

    // Get entries for the period
    const entries = db.prepare(`
        SELECT le.*, 
            CASE 
                WHEN le.reference_type = 'sale' THEN (SELECT invoice_no FROM sales WHERE id = le.reference_id)
                WHEN le.reference_type = 'purchase' THEN (SELECT bill_no FROM purchases WHERE id = le.reference_id)
                WHEN le.reference_type = 'payment_received' THEN 'RCPT-' || le.reference_id
                WHEN le.reference_type = 'payment_made' THEN 'PMT-' || le.reference_id
                WHEN le.reference_type = 'milk_collection' THEN (SELECT collection_no FROM milk_collections WHERE id = le.reference_id)
                ELSE ''
            END as reference_no
        FROM ledger_entries le
        WHERE le.party_id = ? AND le.date >= ? AND le.date <= ?
        ORDER BY le.date ASC, le.id ASC
    `).all(party_id, from, to);

    // Calculate running balance
    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map(entry => {
        // In ledger_entries: debit = amount owed by party (sale), credit = amount paid/received
        // For customers (type=customer or both): debit increases balance (they owe more), credit decreases
        // For suppliers: credit increases balance (we owe more), debit decreases
        // We'll use a simple: running = previous + debit - credit
        runningBalance = runningBalance + (entry.debit || 0) - (entry.credit || 0);
        return {
            ...entry,
            running_balance: runningBalance
        };
    });

    const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    return {
        party,
        from_date: from,
        to_date: to,
        opening_balance: openingBalance,
        entries: entriesWithBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: closingBalance
    };
}

/**
 * List parties with their outstanding balance as of a given date.
 * Useful for statement selection screen.
 */
function listPartiesWithBalance(db, { type, as_of_date } = {}) {
    const asOf = as_of_date || new Date().toISOString().split('T')[0];
    let query = "SELECT * FROM parties WHERE 1=1";
    const params = [];
    if (type) {
        query += " AND (type = ? OR type = 'both')";
        params.push(type);
    }
    query += " ORDER BY name";
    const parties = db.prepare(query).all(...params);

    // Calculate balance for each party
    return parties.map(party => {
        const ledger = db.prepare(`
            SELECT COALESCE(SUM(debit), 0) as debit, COALESCE(SUM(credit), 0) as credit
            FROM ledger_entries WHERE party_id = ? AND date <= ?
        `).get(party.id, asOf);
        const balance = (party.opening_balance || 0) + (ledger.credit || 0) - (ledger.debit || 0);
        return { ...party, balance };
    });
}

module.exports = { getPartyStatement, listPartiesWithBalance };
