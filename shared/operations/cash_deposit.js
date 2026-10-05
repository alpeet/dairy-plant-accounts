/**
 * Prarambha Account & Stock Management — Cash Deposit Operations
 * ===============================================
 * Manages bank deposits made from cash on hand.
 * Tracks deposits by date, bank, amount, and source.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');
const accounting = require('./accounting');
const { todayBSDate } = require('../excel-import');

/**
 * Generate a unique deposit number for a given date.
 */
function generateDepositNo(db, date) {
    const d = date || todayBSDate();
    const prefix = 'DEP';
    // Highest existing sequence for the day, NOT COUNT(*) — COUNT breaks and
    // reissues an already-used number after any deletion (two deposits then
    // share a deposit_no). Position 14 = after "DEP-YYYYMMDD-".
    const row = db.prepare(
        `SELECT COALESCE(MAX(CAST(SUBSTR(deposit_no, 14) AS INTEGER)), 0) AS m
           FROM cash_deposits WHERE date = ? AND deposit_no LIKE 'DEP-%'`
    ).get(d);
    const seq = (row.m || 0) + 1;
    return `${prefix}-${d.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

/**
 * List cash deposits with optional date range and bank filter.
 */
function listCashDeposits(db, { from_date, to_date, bank_name } = {}) {
    let query = "SELECT cd.* FROM cash_deposits cd WHERE 1=1";
    const params = [];
    if (from_date) { query += " AND cd.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND cd.date <= ?"; params.push(to_date); }
    if (bank_name) { query += " AND cd.bank_name LIKE ?"; params.push(`%${bank_name}%`); }
    query += " ORDER BY cd.date DESC, cd.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single cash deposit by ID.
 */
function getCashDeposit(db, id) {
    return db.prepare("SELECT * FROM cash_deposits WHERE id = ?").get(id);
}

/**
 * Save a cash deposit (create or update).
 */
function saveCashDeposit(db, data, userId = null) {
    const oldRow = data.id ? db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(data.id) : null;

    // Persistent statement link (audit requirement 19). An update that does not
    // mention the link keeps the one it had; unknown transaction ids are dropped
    // rather than stored as dangling references.
    let bankTxnId = data.bank_txn_id !== undefined
        ? (data.bank_txn_id || null)
        : (oldRow ? (oldRow.bank_txn_id || null) : null);
    if (bankTxnId != null) {
        try {
            if (!db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(bankTxnId)) bankTxnId = null;
        } catch (e) { bankTxnId = null; /* bank module not present on this DB */ }
    }

    const trx = db.transaction(() => {
        const date = data.date || todayBSDate();

        if (data.id) {
            // Update existing
            db.prepare(`
                UPDATE cash_deposits SET
                    date = ?, bank_name = ?, branch = ?, account_no = ?,
                    amount = ?, cash_source = ?, deposit_mode = ?,
                    reference_no = ?, remarks = ?, deposited_by = ?,
                    bank_txn_id = ?,
                    updated_at = datetime('now', 'localtime')
                WHERE id = ?
            `).run(
                date,
                data.bank_name || '',
                data.branch || '',
                data.account_no || '',
                data.amount || 0,
                data.cash_source || 'mixed',
                data.deposit_mode || 'cash',
                data.reference_no || '',
                data.remarks || '',
                data.deposited_by || '',
                bankTxnId,
                data.id
            );
            return { id: data.id, action: 'updated' };
        } else {
            // Double-submit / retry guard: the same deposit payload submitted
            // within 10 seconds returns the row already created — it never
            // inserts a second deposit for the same money.
            const recent = db.prepare(`
                SELECT id, deposit_no FROM cash_deposits
                 WHERE date = ? AND amount = ?
                   AND COALESCE(bank_name, '') = ? AND COALESCE(account_no, '') = ?
                   AND COALESCE(reference_no, '') = ?
                   AND created_at >= datetime('now', 'localtime', '-10 seconds')
                 LIMIT 1
            `).get(date, data.amount || 0, data.bank_name || '', data.account_no || '', data.reference_no || '');
            if (recent) return { id: recent.id, action: 'duplicate_skipped', deposit_no: recent.deposit_no };
            const deposit_no = generateDepositNo(db, date);
            const result = db.prepare(`
                INSERT INTO cash_deposits (date, deposit_no, bank_name, branch, account_no, amount,
                    cash_source, deposit_mode, reference_no, remarks, deposited_by, created_by, bank_txn_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                date,
                deposit_no,
                data.bank_name || '',
                data.branch || '',
                data.account_no || '',
                data.amount || 0,
                data.cash_source || 'mixed',
                data.deposit_mode || 'cash',
                data.reference_no || '',
                data.remarks || '',
                data.deposited_by || '',
                data.created_by || null,
                bankTxnId
            );
            return { id: result.lastInsertRowid, action: 'created', deposit_no };
        }
    });
    const result = trx();
    logAudit(db, 'cash_deposits', result.id, oldRow ? 'update' : 'create', oldRow || null,
        db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(result.id), userId);
    return result;
}

/**
 * Delete a cash deposit by ID.
 */
function deleteCashDeposit(db, id, userId = null) {
    const oldRow = db.prepare('SELECT * FROM cash_deposits WHERE id = ?').get(id);
    const result = db.prepare("DELETE FROM cash_deposits WHERE id = ?").run(id);
    const deleted = result.changes > 0;
    if (deleted) logAudit(db, 'cash_deposits', id, 'delete', oldRow, null, userId);
    return { deleted };
}

/**
 * Get cash deposit summary for a date range.
 */
function getCashDepositSummary(db, { from_date, to_date } = {}) {
    const from = from_date || '2000-01-01';
    // Open upper bound when not supplied — a UTC AD "today" fallback excluded
    // every BS row and made an unbounded summary come back empty.
    const to = to_date || '2999-12-31';

    const total = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_deposited,
               COUNT(*) as total_count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
    `).get(from, to);

    const byBank = db.prepare(`
        SELECT bank_name, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
        GROUP BY bank_name ORDER BY total DESC
    `).all(from, to);

    const byMode = db.prepare(`
        SELECT deposit_mode, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
        FROM cash_deposits
        WHERE date >= ? AND date <= ?
        GROUP BY deposit_mode ORDER BY total DESC
    `).all(from, to);

    // ── Bank-statement deposits with no register row (surfaced once) ──
    // Classification + mirror-dedup come from getCashBankPosition — the single
    // authoritative place that decides what counts as a cash-to-bank transfer.
    const position = accounting.getCashBankPosition(db, { from_date: from, to_date: to });
    const bankRows = position.unmatched_transfer_rows || [];
    const round2 = accounting.round2;

    // ── Expected vs actual cash (full history — actual = latest count) ──
    // Expected Closing = Opening + Cash Receipts − Cash Payments − Cash Deposits
    const allTime = accounting.getCashBankPosition(db);
    const lastCount = db.prepare(
        `SELECT date, total_cash, expected_cash, difference FROM denomination_counts
          ORDER BY date DESC, id DESC LIMIT 1`
    ).get() || null;
    const expectedClosing = allTime.cash.balance;
    const actualCash = lastCount ? (Number(lastCount.total_cash) || 0) : null;

    return {
        total_deposited: total.total_deposited,
        total_count: total.total_count,
        by_bank: byBank,
        by_mode: byMode,
        bank_transfers: {
            rows: bankRows,
            count: bankRows.length,
            total_in: round2(bankRows.reduce((s, r) => s + (Number(r.credit) || 0), 0)),
            total_out: round2(bankRows.reduce((s, r) => s + (Number(r.debit) || 0), 0))
        },
        reconciliation: {
            opening_cash: 0,
            cash_sales: allTime.cash.cash_sales,
            cash_receipts: allTime.cash.cash_receipts,
            cash_payments: allTime.cash.cash_payments,
            cash_expenses: allTime.cash.cash_expenses,
            petty_cash: allTime.cash.petty_cash,
            cash_deposited: allTime.cash.deposited_to_bank,
            expected_closing: expectedClosing,
            actual_count_date: lastCount ? lastCount.date : null,
            actual_cash: actualCash,
            difference: (actualCash === null) ? null : round2(expectedClosing - actualCash)
        }
    };
}

module.exports = {
    listCashDeposits,
    getCashDeposit,
    saveCashDeposit,
    deleteCashDeposit,
    getCashDepositSummary,
    generateDepositNo
};
