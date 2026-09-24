/**
 * Prarambha Account & Stock Management — Customer/Supplier Statement Operations
 * ==============================================================
 * Generates party-wise statements with opening balance, debit/credit,
 * running balance, and closing balance for a given date range.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

// ── Number formatting helpers for statement display ──
// Kill floating-point noise (97.64999999999999 → "97.65") and trim needless
// trailing zeros (93.00 → "93"). Amounts keep exactly two decimals.
function round2(v) {
    const n = Number(v);
    return isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 : 0;
}

function trimNum(v, maxDp = 2) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    let s = n.toFixed(maxDp);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
}

function money2(v) {
    const n = round2(v);
    try {
        return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
        return n.toFixed(2);
    }
}

function titleCaseMilk(t) {
    const s = String(t || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

/**
 * Format ONE milk transaction as statement particulars:
 *   "Buffalo Milk 240 L @91.45 | Fat 5.9 | SNF 8.5"
 * Quality fields (Fat / SNF / Addition) appear only when actually stored
 * (non-null, non-zero) for that transaction — never invented, never zero-filled.
 */
function formatMilkLine(m) {
    const type = titleCaseMilk(m.milk_type) || 'Milk';
    const parts = [`${type} Milk ${trimNum(m.quantity_liters)} L @${trimNum(m.rate)}`];
    if (m.fat_percent != null && Number(m.fat_percent) !== 0) parts.push(`Fat ${trimNum(m.fat_percent)}`);
    if (m.snf_percent != null && Number(m.snf_percent) !== 0) parts.push(`SNF ${trimNum(m.snf_percent)}`);
    if (m.extra_per_unit != null && Number(m.extra_per_unit) !== 0) parts.push(`Addition ${trimNum(m.extra_per_unit)}`);
    return parts.join(' | ');
}

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
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.fat_percent END AS milk_fat,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.snf_percent END AS milk_snf,
            CASE WHEN le.reference_type = 'milk_collection' THEN mc.extra_per_unit END AS milk_extra,
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

    // Milk detail for purchase rows: resolve EACH ledger row to its OWN
    // purchase and attach only that purchase's milk collections.
    //
    // Ledger rows imported from the workbook's Party_Ledger sheet carry the
    // bill NUMBER as text in reference_id (e.g. 'BILL-5152') instead of the
    // purchases.id. Bill numbers REPEAT across dates in the source data, so
    // resolution must be by bill number + entry date — resolving by bill
    // number alone would print other days' milk on this row.
    const milkByEntry = {};
    try {
        const hasMilkRef = db.prepare(
            "SELECT COUNT(*) AS n FROM pragma_table_info('milk_collections') WHERE name = 'purchase_ref_id'"
        ).get().n > 0;
        if (hasMilkRef) {
            const purchaseEntries = entries.filter(e => e.reference_type === 'purchase');
            const resolveByBillDate = db.prepare(
                'SELECT id FROM purchases WHERE party_id = ? AND bill_no = ? AND date = ? ORDER BY id LIMIT 1'
            );
            const resolveByBill = db.prepare(
                'SELECT id FROM purchases WHERE party_id = ? AND bill_no = ? ORDER BY id LIMIT 1'
            );
            const pidByEntry = new Map();
            const purchaseIds = new Set();
            for (const e of purchaseEntries) {
                let pid = null;
                if (e.reference_id != null && Number.isInteger(e.reference_id)) {
                    pid = e.reference_id;
                } else if (e.reference_id != null && String(e.reference_id).trim() !== '') {
                    const bill = String(e.reference_id).trim();
                    const hit = resolveByBillDate.get(party_id, bill, e.date) || resolveByBill.get(party_id, bill);
                    pid = hit ? hit.id : null;
                }
                if (pid != null) {
                    pidByEntry.set(e.id, pid);
                    purchaseIds.add(pid);
                }
            }
            if (purchaseIds.size) {
                const ids = [...purchaseIds];
                const ph = ids.map(() => '?').join(',');
                const lines = db.prepare(`
                    SELECT mc.id, mc.purchase_ref_id, mc.milk_type, mc.quantity_liters, mc.rate, mc.amount,
                           mc.fat_percent, mc.snf_percent, mc.extra_per_unit
                    FROM milk_collections mc
                    WHERE mc.purchase_ref_id IN (${ph})
                    ORDER BY mc.date, mc.id
                `).all(...ids);
                const linesByPid = {};
                for (const l of lines) {
                    (linesByPid[l.purchase_ref_id] = linesByPid[l.purchase_ref_id] || []).push(l);
                }
                // Amount-based attribution: a ledger row may only display milk
                // lines whose qty×rate equals the ROW's own amount (the source
                // Party_Ledger transaction). Bill-level lines that the ledger
                // never posted (workbook-internal supply vs ledger gaps) must
                // NOT leak into the statement. Each line is consumed once so
                // repeated rows on a bill never show the same line twice.
                const lineValue = l => (l.amount != null ? Number(l.amount) : Number(l.quantity_liters || 0) * Number(l.rate || 0));
                const matchByDateAmount = db.prepare(`
                    SELECT id, milk_type, quantity_liters, rate, amount, fat_percent, snf_percent, extra_per_unit
                    FROM milk_collections
                    WHERE party_id = ? AND date = ? AND ABS(COALESCE(amount, quantity_liters * rate) - ?) <= 0.01
                    ORDER BY id LIMIT 1
                `);
                const usedLineIds = new Set();
                for (const e of purchaseEntries) {
                    const pid = pidByEntry.get(e.id);
                    const rowAmount = Math.abs((e.credit || 0) - (e.debit || 0));
                    let shown = [];
                    if (pid != null && rowAmount > 0) {
                        const candidates = (linesByPid[pid] || []).filter(l => !usedLineIds.has(l.id));
                        const exact = candidates.filter(l => Math.abs(lineValue(l) - rowAmount) <= 0.01);
                        const total = candidates.reduce((s, l) => s + lineValue(l), 0);
                        if (exact.length >= 1) {
                            shown = [exact[0]]; // the line this row actually charges
                        } else if (Math.abs(total - rowAmount) <= 0.01) {
                            shown = candidates; // full-bill row: all lines together equal the row amount
                        }
                    }
                    // Fallback: no attributable line on the linked purchase — try any
                    // of this party's collections on the SAME DATE worth exactly the
                    // row amount. Still transaction-true (date + amount match).
                    if (!shown.length && rowAmount > 0) {
                        const hit = matchByDateAmount.get(party_id, e.date, rowAmount);
                        if (hit && !usedLineIds.has(hit.id)) shown = [hit];
                    }
                    for (const l of shown) usedLineIds.add(l.id);
                    milkByEntry[e.id] = shown;
                }
            }
        }
    } catch (e) { /* schema difference — statements degrade to plain description */ }

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
            // ONLY this row's own milk lines (resolved by bill + date above).
            const milkLines = milkByEntry[entry.id] || [];
            if (milkLines.length) {
                const text = milkLines.map(formatMilkLine).join(' | ');
                const base = String(description).trim();
                // Imported purchase rows carry just the milk type ("Buffalo
                // Milk") as description — the formatted line already contains
                // it, so don't print it twice. Keep any other base text.
                const isPlainType = milkLines.every(m =>
                    base.toLowerCase() === (titleCaseMilk(m.milk_type) + ' milk').toLowerCase());
                description = (!base || isPlainType) ? text : base + ' — ' + text;
            }
        } else if (entry.reference_type === 'milk_collection' && entry.milk_type) {
            // Direct milk-collection ledger rows: their own joined fields only.
            description = formatMilkLine({
                milk_type: entry.milk_type,
                quantity_liters: entry.milk_quantity,
                rate: entry.milk_rate,
                fat_percent: entry.milk_fat,
                snf_percent: entry.milk_snf,
                extra_per_unit: entry.milk_extra
            });
        }
        if (entry.reference_type === 'payment_received' || entry.reference_type === 'payment_made') {
            const mode = entry.payment_mode || entry.payment_mode_made || '';
            const notes = entry.payment_notes || entry.payment_notes_made || '';
            const extras = [mode ? `mode: ${mode}` : '', notes ? notes : ''].filter(Boolean).join(' — ');
            if (extras) description = (description ? description + ' (' + extras + ')' : extras);
            // Imported rows whose description cell was empty (Excel filler "0")
            // must not render a blank Particulars — show the transaction kind.
            if (!description.trim()) {
                description = entry.reference_type === 'payment_received' ? 'Payment Received' : 'Payment Made';
            }
        } else if (!description.trim() && entry.reference_type === 'adjustment') {
            description = 'Adjustment';
        } else if (!description.trim()) {
            description = entry.reference_type.charAt(0).toUpperCase() + entry.reference_type.slice(1).replace(/_/g, ' ');
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
