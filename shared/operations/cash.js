/**
 * Godhuli Dairy Plant — Daily Cash Collection Operations
 * =======================================================
 * Generates daily cash collection reports by aggregating
 * cash sales, cash receipts, and cash payments.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

/**
 * Get daily cash collection report for a given date range.
 * Aggregates: cash sales, cash receipts, cash payments, payment mode breakdown.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { from_date, to_date }
 * @returns {object} { days[], total_cash_in, total_cash_out, net_cash }
 */
// ============================================================
// Manual Cash Collection Records (user-entered daily summaries)
// ============================================================

/**
 * Save a manual daily payment collection record.
 * These records supplement auto-aggregated data from sales/payments.
 * Supports payment modes: cash, cheque, online/upi, bank transfer.
 * When a party_id is provided, also creates payments + ledger entries
 * so the data flows into party statements, daybook, and reports.
 */
function saveCashCollection(db, { id, date, cash_sales, cash_receipts, cash_payments, other_receipts, payment_mode, party_id, notes, ref_no } = {}) {
    // Ensure the table exists with all columns
    db.exec(`
        CREATE TABLE IF NOT EXISTS cash_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
            ref_no TEXT DEFAULT '',
            payment_mode TEXT DEFAULT 'cash',
            party_id INTEGER DEFAULT NULL,
            cash_sales REAL DEFAULT 0.0,
            cash_receipts REAL DEFAULT 0.0,
            cash_payments REAL DEFAULT 0.0,
            other_receipts REAL DEFAULT 0.0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);
    
    // Add columns if missing (migration for existing tables)
    try { db.exec("ALTER TABLE cash_collections ADD COLUMN payment_mode TEXT DEFAULT 'cash'"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE cash_collections ADD COLUMN party_id INTEGER DEFAULT NULL"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE cash_collections ADD COLUMN ref_no TEXT DEFAULT ''"); } catch (e) { /* ok */ }

    const saveAndCreateLedger = db.transaction(() => {
        // 1. Save / update the cash_collections record
        let cashId;
        if (id) {
            db.prepare(`
                UPDATE cash_collections SET
                    date = ?, ref_no = ?, payment_mode = ?, party_id = ?, cash_sales = ?, cash_receipts = ?, 
                    cash_payments = ?, other_receipts = ?, notes = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(date, ref_no || '', payment_mode || 'cash', party_id || null, cash_sales || 0, cash_receipts || 0, 
                   cash_payments || 0, other_receipts || 0, notes || '', id);
            cashId = id;
        } else {
            const r = db.prepare(`
                INSERT INTO cash_collections (date, ref_no, payment_mode, party_id, cash_sales, cash_receipts, cash_payments, other_receipts, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(date, ref_no || '', payment_mode || 'cash', party_id || null, cash_sales || 0, cash_receipts || 0, 
                   cash_payments || 0, other_receipts || 0, notes || '');
            cashId = r.lastInsertRowid;
        }

        // 2. If a party was selected, create payment records + ledger entries
        //    so the amounts flow into party statements, daybook, and reports.
        if (party_id) {
            const amount = parseFloat(cash_sales || 0) + parseFloat(cash_receipts || 0) + parseFloat(other_receipts || 0);
            const paymentsOut = parseFloat(cash_payments || 0);

            // First get existing payment IDs for this cash record, so we can clean up properly
            const oldPaymentIds = db.prepare(
                "SELECT id FROM payments WHERE reference_type = 'cash_collection' AND reference_id = ?"
            ).all(cashId).map(p => p.id);

            // Delete old ledger entries linked to those payments, then delete the payments
            if (oldPaymentIds.length > 0) {
                const ph = oldPaymentIds.map(() => '?').join(',');
                db.prepare(`DELETE FROM ledger_entries WHERE reference_id IN (${ph}) AND (reference_type = 'payment_received' OR reference_type = 'payment_made')`)
                  .run(...oldPaymentIds);
                db.prepare(`DELETE FROM payments WHERE id IN (${ph})`).run(...oldPaymentIds);
            }

            // Create payment receipt for incoming amounts (sales + receipts + other)
            if (amount > 0) {
                const pRes = db.prepare(
                    "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, 'receipt', ?, ?, 'cash_collection', ?, ?)"
                ).run(party_id, date, amount, payment_mode || 'cash', cashId, notes || 'Payment Collection');

                db.prepare(
                    "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_received', ?, ?, 0, ?, 0)"
                ).run(party_id, date, pRes.lastInsertRowid, 'Payment Collection - Received', amount);
            }

            // Create payment record for outgoing amounts
            if (paymentsOut > 0) {
                const pRes = db.prepare(
                    "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, 'payment', ?, ?, 'cash_collection', ?, ?)"
                ).run(party_id, date, paymentsOut, payment_mode || 'cash', cashId, notes || 'Payment Collection');

                db.prepare(
                    "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_made', ?, ?, ?, 0, 0)"
                ).run(party_id, date, pRes.lastInsertRowid, 'Payment Collection - Paid', paymentsOut);
            }
        }

        return { id: cashId };
    });

    return saveAndCreateLedger();
}

/**
 * Delete a manual cash collection record.
 */
function deleteCashCollection(db, id) {
    const del = db.transaction(() => {
        // Find related payment IDs to clean up ledger entries
        const paymentIds = db.prepare(
            "SELECT id FROM payments WHERE reference_type = 'cash_collection' AND reference_id = ?"
        ).all(id).map(p => p.id);

        if (paymentIds.length > 0) {
            const ph = paymentIds.map(() => '?').join(',');
            db.prepare(`DELETE FROM ledger_entries WHERE reference_id IN (${ph}) AND (reference_type = 'payment_received' OR reference_type = 'payment_made')`)
              .run(...paymentIds);
            db.prepare(`DELETE FROM payments WHERE id IN (${ph})`).run(...paymentIds);
        }

        // Delete the cash collection record itself
        db.prepare("DELETE FROM cash_collections WHERE id = ?").run(id);
    });
    del();
    return { success: true };
}

function getDailyCashCollection(db, { from_date, to_date } = {}) {
    const from = from_date || new Date().toISOString().split('T')[0];
    const to = to_date || from;

    // Cash sales (payment_mode = 'cash')
    const cashSales = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid
        FROM sales
        WHERE date >= ? AND date <= ? AND payment_mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Cash receipts from payments table
    const cashReceipts = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'receipt' AND mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Cash payments made
    const cashPayments = db.prepare(`
        SELECT date, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
        FROM payments
        WHERE date >= ? AND date <= ? AND type = 'payment' AND mode = 'cash'
        GROUP BY date ORDER BY date
    `).all(from, to);

    // Build daily breakdown
    const dateMap = {};
    
    cashSales.forEach(s => {
        if (!dateMap[s.date]) dateMap[s.date] = { date: s.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0, manual_entry: false };
        dateMap[s.date].cash_sales_count = s.count;
        dateMap[s.date].cash_sales_total = s.total;
    });

    cashReceipts.forEach(r => {
        if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0, manual_entry: false };
        dateMap[r.date].cash_receipts_count = r.count;
        dateMap[r.date].cash_receipts_total = r.total;
    });

    cashPayments.forEach(p => {
        if (!dateMap[p.date]) dateMap[p.date] = { date: p.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0, manual_entry: false };
        dateMap[p.date].cash_payments_count = p.count;
        dateMap[p.date].cash_payments_total = p.total;
    });

    // Also get sales by other modes (bank, upi, credit) for completeness
    const otherSales = db.prepare(`
        SELECT date, payment_mode, COALESCE(SUM(paid_amount), 0) as total
        FROM sales
        WHERE date >= ? AND date <= ? AND payment_mode != 'cash'
        GROUP BY date, payment_mode ORDER BY date
    `).all(from, to);

    otherSales.forEach(s => {
        if (!dateMap[s.date]) dateMap[s.date] = { date: s.date, cash_sales_count: 0, cash_sales_total: 0, cash_receipts_count: 0, cash_receipts_total: 0, cash_payments_count: 0, cash_payments_total: 0, other_receipts_total: 0, manual_entry: false };
        dateMap[s.date].other_receipts_total += s.total;
    });

    // Include manual cash collection entries
    let manual_entries = [];
    try {
        // Ensure table exists first (might not on fresh DB)
        db.exec(`CREATE TABLE IF NOT EXISTS cash_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
            ref_no TEXT DEFAULT '',
            payment_mode TEXT DEFAULT 'cash',
            party_id INTEGER DEFAULT NULL,
            cash_sales REAL DEFAULT 0.0,
            cash_receipts REAL DEFAULT 0.0,
            cash_payments REAL DEFAULT 0.0,
            other_receipts REAL DEFAULT 0.0,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )`);
        // Migration: add columns if missing
        try { db.exec("ALTER TABLE cash_collections ADD COLUMN ref_no TEXT DEFAULT ''"); } catch (e) { /* ok */ }
        try { db.exec("ALTER TABLE cash_collections ADD COLUMN payment_mode TEXT DEFAULT 'cash'"); } catch (e) { /* ok */ }
        try { db.exec("ALTER TABLE cash_collections ADD COLUMN party_id INTEGER DEFAULT NULL"); } catch (e) { /* ok */ }

        manual_entries = db.prepare(`
            SELECT cc.*, p.name as party_name
            FROM cash_collections cc
            LEFT JOIN parties p ON cc.party_id = p.id
            WHERE cc.date >= ? AND cc.date <= ?
            ORDER BY cc.date
        `).all(from, to);

        manual_entries.forEach(e => {
            if (!dateMap[e.date]) {
                dateMap[e.date] = { 
                    date: e.date, cash_sales_count: 0, cash_sales_total: 0, 
                    cash_receipts_count: 0, cash_receipts_total: 0, 
                    cash_payments_count: 0, cash_payments_total: 0, 
                    other_receipts_total: 0, manual_entry: true,
                    payment_mode: e.payment_mode || 'cash',
                    party_names: []
                };
            }
            // Merge manual entries on top of auto-aggregated
            dateMap[e.date].cash_sales_total += (e.cash_sales || 0);
            dateMap[e.date].cash_receipts_total += (e.cash_receipts || 0);
            dateMap[e.date].cash_payments_total += (e.cash_payments || 0);
            dateMap[e.date].other_receipts_total += (e.other_receipts || 0);
            dateMap[e.date].manual_entry = true;
            dateMap[e.date].payment_mode = e.payment_mode || 'cash';
            // Collect unique party names for display in the main report table
            if (e.party_name && e.party_name.trim()) {
                if (!dateMap[e.date].party_names.includes(e.party_name)) {
                    dateMap[e.date].party_names.push(e.party_name);
                }
            }
        });
    } catch (err) {
        // Table might not exist yet, that's fine
    }

    const days = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate per-day net
    days.forEach(d => {
        d.total_cash_in = d.cash_sales_total + d.cash_receipts_total + d.other_receipts_total;
        d.total_cash_out = d.cash_payments_total;
        d.net_cash = d.total_cash_in - d.total_cash_out;
    });

    // Totals
    const total_cash_in = days.reduce((s, d) => s + d.total_cash_in, 0);
    const total_cash_out = days.reduce((s, d) => s + d.total_cash_out, 0);
    const net_cash = total_cash_in - total_cash_out;

    return { days, manual_entries, total_cash_in, total_cash_out, net_cash, from_date: from, to_date: to };
}

module.exports = { getDailyCashCollection, saveCashCollection, deleteCashCollection };
