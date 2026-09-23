/**
 * Prarambha Account & Stock Management — Customer/Supplier Statement Operations
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

    // Default date range: from beginning to the latest entry. Stored dates are
    // Bikram Sambat (BS) — defaulting the upper bound to AD "today" (2026-…)
    // excluded every BS-dated row from the filter, so the statement rendered
    // empty. MAX(date) is in the same calendar as the data itself.
    const from = from_date || '2000-01-01';
    const to = to_date || (db.prepare('SELECT COALESCE(MAX(date), ?) AS d FROM ledger_entries WHERE party_id = ?')
        .get(new Date().toISOString().split('T')[0], party_id).d);

    // Get opening balance (balance from before the from_date)
    // Opening balance is the closing balance from all entries before the from_date
    const openingEntry = db.prepare(`
        SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
        FROM ledger_entries
        WHERE party_id = ? AND date < ?
    `).get(party_id, from);

    const openingBalance = (party.opening_balance || 0) + (openingEntry.total_debit || 0) - (openingEntry.total_credit || 0);

    // Get entries for the period (milk rows join milk_collections for the
    // type/quantity/rate detail; payment rows carry method and remarks)
    const entries = db.prepare(`
        SELECT le.*, 
            CASE 
                WHEN le.reference_type = 'sale' THEN (SELECT invoice_no FROM sales WHERE id = le.reference_id)
                WHEN le.reference_type = 'purchase' THEN (SELECT bill_no FROM purchases WHERE id = le.reference_id)
                WHEN le.reference_type = 'payment_received' THEN 'RCPT-' || le.reference_id
                WHEN le.reference_type = 'payment_made' THEN 'PMT-' || le.reference_id
                WHEN le.reference_type = 'milk_collection' THEN (SELECT collection_no FROM milk_collections WHERE id = le.reference_id)
                ELSE ''
            END as reference_no,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.milk_type END AS milk_type,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.quantity_liters END AS milk_quantity,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.rate END AS milk_rate,
            CASE WHEN le.reference_type = 'payment_received' THEN pay_r.mode END AS payment_mode,
            CASE WHEN le.reference_type = 'payment_made' THEN pay_m.mode END AS payment_mode_made,
            CASE WHEN le.reference_type = 'payment_received' THEN pay_r.notes END AS payment_notes,
            CASE WHEN le.reference_type = 'payment_made' THEN pay_m.notes END AS payment_notes_made
        FROM ledger_entries le
        LEFT JOIN milk_collections mc
            ON le.reference_type = 'milk_collection' AND mc.id = le.reference_id
        LEFT JOIN payments pay_r
            ON le.reference_type = 'payment_received' AND pay_r.id = le.reference_id
        LEFT JOIN payments pay_m
            ON le.reference_type = 'payment_made' AND pay_m.id = le.reference_id
        WHERE le.party_id = ? AND le.date >= ? AND le.date <= ?
        ORDER BY le.date ASC, le.id ASC
    `).all(party_id, from, to);

    // Milk detail for imported purchases: milk collections linked to the bill
    // (purchase_ref_id) are shown as a breakdown on the purchase line, so the
    // statement shows type / quantity / rate / amount for every milk supply.
    const milkByPurchase = {};
    const textRefToId = {};
    try {
        // Ledger rows imported from the workbook's Party_Ledger sheet carry the
        // bill NUMBER as text in reference_id (e.g. 'BILL-5006') instead of the
        // purchases.id — resolve them so the milk breakdown still attaches.
        const textBillRefs = [...new Set(entries
            .filter(e => e.reference_type === 'purchase' && e.reference_id && !Number.isInteger(e.reference_id))
            .map(e => String(e.reference_id)))];
        if (textBillRefs.length) {
            const ph = textBillRefs.map(() => '?').join(',');
            const byBill = db.prepare(`SELECT id, bill_no FROM purchases WHERE party_id = ? AND bill_no IN (${ph})`).all(party_id, ...textBillRefs);
            for (const p of byBill) {
                textRefToId[p.bill_no] = p.id;
                const milkLines = db.prepare(`
                    SELECT mc.milk_type, mc.quantity_liters, mc.rate, mc.amount
                    FROM milk_collections mc WHERE mc.purchase_ref_id = ?
                `).all(p.id);
                if (milkLines.length) milkByPurchase[p.id] = milkLines;
            }
        }
        const milkRows = db.prepare(`
            SELECT mc.purchase_ref_id, mc.milk_type, mc.quantity_liters, mc.rate, mc.amount
            FROM milk_collections mc
            JOIN purchases p ON p.id = mc.purchase_ref_id
            WHERE p.party_id = ? AND mc.date >= ? AND mc.date <= ?
        `).all(party_id, from, to);
        for (const m of milkRows) {
            // Skip purchases already enriched via the bill-number path above —
            // adding them again would print each milk line twice.
            if (milkByPurchase[m.purchase_ref_id]) continue;
            if (!milkByPurchase[m.purchase_ref_id]) milkByPurchase[m.purchase_ref_id] = [];
            milkByPurchase[m.purchase_ref_id].push(m);
        }
    } catch (e) { /* purchase_ref_id column not present yet */ }

    // Fill in payment method/notes for receipt rows whose ledger reference is
    // textual (Party_Ledger import): match this party's payments by date +
    // amount + direction. Read-only — it only enriches what is displayed.
    try {
        const partyPayments = db.prepare('SELECT date, amount, mode, notes, type FROM payments WHERE party_id = ?').all(party_id);
        for (const e of entries) {
            if (e.reference_type !== 'payment_received' && e.reference_type !== 'payment_made') continue;
            if (e.payment_mode || e.payment_mode_made) continue;
            const amt = e.reference_type === 'payment_received' ? (e.credit || 0) : (e.debit || 0);
            if (!amt) continue;
            const hit = partyPayments.find(p =>
                p.date === e.date && Math.abs((p.amount || 0) - amt) < 0.01 &&
                (e.reference_type === 'payment_received' ? (p.type === 'receipt' || p.type === 'advance') : p.type === 'payment'));
            if (hit) {
                e.payment_mode = e.payment_mode || hit.mode || '';
                e.payment_notes = e.payment_notes || hit.notes || '';
            }
        }
    } catch (e) { /* payments table shape difference — skip enrichment */ }

    // Calculate running balance
    let runningBalance = openingBalance;
    const entriesWithBalance = entries.map(entry => {
        // In ledger_entries: debit = amount owed by party (sale), credit = amount paid/received
        // For customers (type=customer or both): debit increases balance (they owe more), credit decreases
        // For suppliers: credit increases balance (we owe more), debit decreases
        // We'll use a simple: running = previous + debit - credit
        runningBalance = runningBalance + (entry.debit || 0) - (entry.credit || 0);

        let description = entry.description || '';
        if (String(description).trim() === '0') description = ''; // filler from Excel import
        if (entry.reference_type === 'purchase') {
            const milkLines = milkByPurchase[entry.reference_id] || milkByPurchase[textRefToId[String(entry.reference_id)]] || [];
            if (milkLines.length) {
                const n2 = v => { const s = Number(v).toFixed(2); return s.endsWith('.00') ? s.slice(0, -3) : s; };
                const lines = milkLines.map(m =>
                    `${String(m.milk_type || 'mixed').toUpperCase()} Milk ${n2(m.quantity_liters)}L @${n2(m.rate)} = ${n2(m.amount)}`
                ).join(' | ');
                if (lines) description = (description ? description + ' — ' : '') + lines;
            }
        }
        if (entry.reference_type === 'payment_received' || entry.reference_type === 'payment_made') {
            const mode = entry.payment_mode || entry.payment_mode_made || '';
            const notes = entry.payment_notes || entry.payment_notes_made || '';
            const extras = [mode ? `mode: ${mode}` : '', notes ? notes : ''].filter(Boolean).join(' — ');
            if (extras) description = (description ? description + ' (' + extras + ')' : extras);
        }

        return {
            ...entry,
            description,
            running_balance: runningBalance
        };
    });

    const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
    const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);
    const closingBalance = openingBalance + totalDebit - totalCredit;

    // Purchase / milk and payment totals for the statement summary block
    const totals = {
        purchase_total: entries.reduce((s, e) => s + (e.reference_type === 'purchase' ? (e.credit - e.debit) : 0), 0),
        milk_total: entries.reduce((s, e) => {
            if (e.reference_type !== 'milk_collection') return s;
            return s + (e.milk_quantity != null ? Math.abs(e.milk_quantity * (e.milk_rate || 0)) : (e.credit - e.debit));
        }, 0),
        sales_total: entries.reduce((s, e) => s + (e.reference_type === 'sale' ? (e.debit - e.credit) : 0), 0),
        paid_total: entries.reduce((s, e) => s + (e.reference_type === 'payment_made' ? (e.debit - e.credit) : 0), 0),
        received_total: entries.reduce((s, e) => s + (e.reference_type === 'payment_received' ? (e.credit - e.debit) : 0), 0)
    };
    totals.supply_total = totals.purchase_total + totals.milk_total;
    totals.payment_total = totals.paid_total + totals.received_total;
    totals.outstanding = closingBalance;

    return {
        party,
        from_date: from,
        to_date: to,
        opening_balance: openingBalance,
        entries: entriesWithBalance,
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: closingBalance,
        totals
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
        const balance = (party.opening_balance || 0) + (ledger.debit || 0) - (ledger.credit || 0);
        return { ...party, balance };
    });
}

module.exports = { getPartyStatement, listPartiesWithBalance };
