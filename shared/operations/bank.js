/**
 * Prarambha Account & Stock Management — Bank Transactions
 * =======================================================
 * Separate module for bank transactions (Sushil QR / bank account),
 * distinct from cash & petty cash. Supports:
 *   - CRUD for bank transactions
 *   - Auto-matching to party ledger by counterparty name (exact matches post
 *     automatically; near/unmatched go to a "needs review" queue)
 *   - Idempotent ledger posting (never double-posts what the ledger already has)
 *   - Bank statement with running balance
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const accounting = require('./accounting');
const { logAudit } = require('./audit');

const CLASS_META = {
    cash_to_bank_transfer: {
        reason: 'cash_to_bank_transfer',
        note: 'cash-to-bank transfer (internal): Bank DR / Cash CR — not income, not a customer payment'
    },
    expense: {
        reason: 'expense_row',
        note: 'office/operating expense paid from the bank: Expense DR / Bank CR — no party ledger posting'
    }
};

function ensureBankTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS bank_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
            reference_no TEXT DEFAULT '',
            counterparty_name TEXT DEFAULT '',
            description TEXT DEFAULT '',
            debit REAL DEFAULT 0.0,
            credit REAL DEFAULT 0.0,
            amount REAL DEFAULT 0.0,
            payment_mode TEXT DEFAULT 'QR/Bank',
            bank_account TEXT DEFAULT '',
            txn_type TEXT DEFAULT '',
            party_id INTEGER DEFAULT NULL,
            match_status TEXT DEFAULT 'none' CHECK(match_status IN ('auto', 'review', 'unmatched', 'none')),
            ledger_posted INTEGER DEFAULT 0,
            ledger_entry_id INTEGER DEFAULT NULL,
            remarks TEXT DEFAULT '',
            created_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (party_id) REFERENCES parties(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
    `);
    // Column migrations for existing tables
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN ledger_entry_id INTEGER DEFAULT NULL"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN txn_type TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN bank_account TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN payment_mode TEXT DEFAULT 'QR/Bank'"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN match_status TEXT DEFAULT 'none'"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN ledger_posted INTEGER DEFAULT 0"); } catch (e) { /* ok */ }
    // Accounting classification of the row (cash→bank transfer / expense /
    // customer receipt / supplier payment). A deposit of cash sales must never
    // be treated as a sale, income, receivable or customer payment again.
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN accounting_class TEXT DEFAULT ''"); } catch (e) { /* ok */ }
}

/**
 * The accounting classification of a bank row, preferring the stored value and
 * deriving it from the row's wording/reference for older rows.
 * @returns {'cash_to_bank_transfer'|'expense'|'customer_receipt'|'supplier_payment'|'unclassified'}
 */
function bankRowClass(row) {
    if (!row) return 'unclassified';
    return row.accounting_class || accounting.classifyBankRow(row);
}

/**
 * Rows that move money between the plant's own pockets (cash deposits, own
 * account transfers) or are expenses paid from the bank. These carry no party
 * relationship, so they are never posted to a party ledger and never queued
 * for party matching.
 * @private
 */
function isNonPartyRow(row) {
    const cls = bankRowClass(row);
    return cls === 'cash_to_bank_transfer' || cls === 'expense';
}

/** @private */
function _markNonParty(db, id, cls) {
    const meta = CLASS_META[cls] || { reason: cls, note: cls };
    db.prepare(
        `UPDATE bank_transactions
            SET accounting_class = ?, ledger_posted = 1, ledger_entry_id = NULL, match_status = 'auto',
                remarks = CASE WHEN COALESCE(remarks,'') = '' THEN ? ELSE remarks || '; ' || ? END,
                updated_at = datetime('now','localtime')
          WHERE id = ?`
    ).run(cls, meta.note, meta.note, id);
    return { success: true, posted: false, reason: meta.reason, ledger_entry_id: null };
}

/**
 * Normalize a party name for matching (lowercase, collapse whitespace, trim suffixes like " -317").
 * Exact-name matching for auto-post uses the raw trimmed name; the normalized form is used
 * only for the review queue so near-matches are surfaced for human confirmation.
 */
function normalizeName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find a party by exact name (case-insensitive, trimmed). Returns id or null.
 */
function findPartyByName(db, name) {
    const row = db.prepare('SELECT id FROM parties WHERE LOWER(TRIM(name)) = ? AND archived = 0').get(normalizeName(name));
    return row ? row.id : null;
}

/**
 * Check whether an equivalent ledger entry already exists for a bank row
 * (same party, same date, same amount, collection/payment direction).
 * Used to avoid double-posting rows the Party_Ledger already reflects.
 */
function findExistingLedgerEntry(db, { party_id, date, debit, credit, reference_no }) {
    // The workbook records the same QR transfer on slightly different dates in
    // Party_Ledger vs BANK RECON (±2 days in practice). Match same-date rows
    // first, then accept a ±5-day same-amount lookalike so the party ledger is
    // never double-counted by the bank import.
    const rows = db.prepare(
        `SELECT id, reference_type, description, date FROM ledger_entries
         WHERE party_id = ? AND debit = ? AND credit = ?
           AND date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
         ORDER BY CASE WHEN date = ? THEN 0 ELSE 1 END, id`
    ).all(party_id, debit, credit, date, date, date);
    if (rows.length === 0) return null;
    // Prefer an entry that references this bank transaction or the same reference number
    const byRef = rows.find(r => (r.description || '').includes(String(reference_no || '')));
    if (byRef) return byRef;
    // Otherwise prefer an exact-date match, and never swallow a sale/purchase
    // document row — only receipt/payment/adjustment rows can represent the
    // same money as a bank transfer.
    const postable = rows.filter(r => ['payment_received', 'payment_made', 'adjustment'].includes(r.reference_type));
    return postable.find(r => r.date === date) || postable[0] || null;
}

/**
 * Post a bank transaction to the party ledger (idempotent).
 * - If the row already has a ledger_entry_id → already posted, no-op.
 * - If an equivalent ledger entry already exists → mark posted (reflected), no new entry.
 * - Otherwise create a ledger entry (credit → payment_received, debit → payment_made).
 * Returns { posted: true|false, reason, ledger_entry_id }.
 */
function postBankToLedger(db, id) {
    ensureBankTable(db);
    const txn = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    if (!txn) return { success: false, error: 'Bank transaction not found' };
    // Cash→Bank deposits and expenses paid from the bank are internal money
    // movements: they must never become a second sale, income, receivable or
    // customer payment in a party's ledger.
    if (isNonPartyRow(txn)) {
        return _markNonParty(db, id, bankRowClass(txn));
    }
    if (txn.ledger_posted && txn.ledger_entry_id) {
        return { success: true, posted: false, reason: 'already_posted' };
    }
    if (!txn.party_id) {
        return { success: false, error: 'No party matched — resolve from the review queue first' };
    }
    const isCredit = (txn.credit || 0) > 0;
    const debit = isCredit ? 0 : (txn.debit || 0);
    const credit = isCredit ? (txn.credit || 0) : 0;
    const existing = findExistingLedgerEntry(db, {
        party_id: txn.party_id, date: txn.date, debit, credit, reference_no: txn.reference_no
    });
    if (existing) {
        // Mark as reflected WITHOUT claiming the pre-existing ledger entry:
        // ledger_entry_id stays NULL so deleting this bank row can never delete
        // an entry that the Party_Ledger import created.
        db.prepare(
            `UPDATE bank_transactions SET ledger_posted = 1, ledger_entry_id = NULL, match_status = 'auto',
             remarks = CASE WHEN remarks = '' THEN 'already reflected in ledger (no new posting)' ELSE remarks || '; already reflected in ledger' END,
             updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(id);
        return { success: true, posted: false, reason: 'already_in_ledger', ledger_entry_id: null };
    }
    const refType = isCredit ? 'payment_received' : 'payment_made';
    const desc = `${txn.counterparty_name || ''} ${txn.description || ''} [${txn.reference_no || 'BANK'}]`.trim();
    const ins = db.prepare(
        `INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(txn.party_id, txn.date, refType, id, desc, debit, credit);
    db.prepare(
        `UPDATE bank_transactions SET ledger_posted = 1, ledger_entry_id = ?, match_status = 'auto',
         updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(ins.lastInsertRowid, id);
    return { success: true, posted: true, ledger_entry_id: ins.lastInsertRowid };
}

/**
 * List bank transactions with optional filters.
 */
function listBankTransactions(db, { from_date, to_date, search, match_status, bank_account } = {}) {
    ensureBankTable(db);
    const where = [];
    const params = [];
    if (from_date) { where.push('date >= ?'); params.push(from_date); }
    if (to_date) { where.push('date <= ?'); params.push(to_date); }
    if (search) { where.push('(counterparty_name LIKE ? OR description LIKE ? OR reference_no LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (match_status) { where.push('match_status = ?'); params.push(match_status); }
    if (bank_account) { where.push('bank_account = ?'); params.push(bank_account); }
    const sql = `
        SELECT b.*, p.name AS party_name
        FROM bank_transactions b
        LEFT JOIN parties p ON p.id = b.party_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY b.date, b.id
    `;
    const rows = db.prepare(sql).all(...params);
    let balance = 0;
    return rows.map(r => {
        balance = balance + (r.credit || 0) - (r.debit || 0);
        return { ...r, running_balance: balance };
    });
}

/**
 * Review queue: near-match / unmatched rows awaiting human decision.
 */
function getBankReviewQueue(db) {
    ensureBankTable(db);
    // Internal transfers and bank-paid expenses need no party, so they are not
    // "needs review" items: resolving them to a party would invent a customer
    // receipt / supplier payment that does not exist.
    return db.prepare(`
        SELECT b.*, p.name AS party_name
        FROM bank_transactions b
        LEFT JOIN parties p ON p.id = b.party_id
        WHERE b.match_status IN ('review', 'unmatched')
          AND COALESCE(b.accounting_class, '') NOT IN ('cash_to_bank_transfer', 'expense')
          AND b.id NOT IN (
              SELECT id FROM bank_transactions
               WHERE accounting_class = '' AND (
                   UPPER(COALESCE(txn_type,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(counterparty_name,'')) LIKE '%DEPOSIT%'
                OR UPPER(COALESCE(txn_type,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(counterparty_name,'')) LIKE '%OFFICE EXPENSE%'
               )
          )
        ORDER BY b.date, b.id
    `).all();
}

/**
 * Get a single bank transaction.
 */
function getBankTransaction(db, id) {
    ensureBankTable(db);
    return db.prepare(`
        SELECT b.*, p.name AS party_name FROM bank_transactions b
        LEFT JOIN parties p ON p.id = b.party_id WHERE b.id = ?
    `).get(id);
}

/**
 * Save (insert or update) a bank transaction.
 * On insert with a party_id, posts to the ledger idempotently.
 * Editing an already-posted row re-syncs its ledger entry.
 */
function saveBankTransaction(db, data, userId = null) {
    ensureBankTable(db);
    const {
        id, date, reference_no, counterparty_name, description,
        debit, credit, payment_mode, bank_account, txn_type,
        party_id, match_status, remarks
    } = data || {};
    const amount = parseFloat(credit || 0) > 0 ? parseFloat(credit || 0) : (parseFloat(debit || 0) || 0);
    const cls = accounting.classifyBankRow({
        txn_type, description, counterparty_name, reference_no, remarks, debit, credit
    });
    const nonParty = cls === 'cash_to_bank_transfer' || cls === 'expense';
    const status = nonParty ? 'auto' : (match_status || (party_id ? 'auto' : 'review'));

    const oldRow = id ? db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id) : null;

    if (id) {
        db.prepare(`
            UPDATE bank_transactions SET
                date = ?, reference_no = ?, counterparty_name = ?, description = ?,
                debit = ?, credit = ?, amount = ?, payment_mode = ?, bank_account = ?,
                txn_type = ?, party_id = ?, match_status = ?, accounting_class = ?, remarks = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(date, reference_no || '', counterparty_name || '', description || '',
              debit || 0, credit || 0, amount, payment_mode || 'QR/Bank', bank_account || '',
              txn_type || '', party_id || null, status, cls, remarks || '', id);
        logAudit(db, 'bank_transactions', id, 'update', oldRow || null,
            getBankTransaction(db, id), userId);
        if (nonParty) return { success: true, data: getBankTransaction(db, id), accounting_class: cls };
        return { success: true, data: getBankTransaction(db, id) };
    }

    const ins = db.prepare(`
        INSERT INTO bank_transactions
            (date, reference_no, counterparty_name, description, debit, credit, amount,
             payment_mode, bank_account, txn_type, party_id, match_status, accounting_class, remarks, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(date, reference_no || '', counterparty_name || '', description || '',
           debit || 0, credit || 0, amount, payment_mode || 'QR/Bank', bank_account || '',
           txn_type || '', nonParty ? null : (party_id || null), status, cls, remarks || '', userId);
    const newId = Number(ins.lastInsertRowid);
    if (nonParty) {
        _markNonParty(db, newId, cls);
    } else if (party_id) {
        postBankToLedger(db, newId);
    }
    logAudit(db, 'bank_transactions', newId, 'create', null, getBankTransaction(db, newId), userId);
    return { success: true, data: getBankTransaction(db, newId), accounting_class: cls };
}

/**
 * Delete a bank transaction and, if we created its ledger entry, remove it too.
 */
function deleteBankTransaction(db, id, userId = null) {
    ensureBankTable(db);
    const txn = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    if (!txn) return { success: false, error: 'Bank transaction not found' };
    if (txn.ledger_entry_id) {
        // Only delete the ledger entry if WE created it (its reference points back
        // to this bank transaction). Never delete pre-existing Party_Ledger rows.
        const ours = db.prepare('SELECT id FROM ledger_entries WHERE id = ? AND reference_id = ?').get(txn.ledger_entry_id, id);
        if (ours) {
            db.prepare('DELETE FROM ledger_entries WHERE id = ?').run(txn.ledger_entry_id);
        } else {
            db.prepare("UPDATE bank_transactions SET ledger_entry_id = NULL WHERE id = ?").run(id);
        }
    }
    db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(id);
    logAudit(db, 'bank_transactions', id, 'delete', txn, null, userId);
    return { success: true };
}

/**
 * Manually resolve a review-queue row: set party + status, then post if requested.
 */
function setBankMatch(db, id, { party_id, match_status, post } = {}, userId = null) {
    ensureBankTable(db);
    const oldRow = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    db.prepare(`
        UPDATE bank_transactions SET party_id = ?, match_status = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
    `).run(party_id || null, match_status || 'review', id);
    const result = { success: true, data: getBankTransaction(db, id) };
    if (post && party_id) {
        result.post = postBankToLedger(db, id);
    }
    logAudit(db, 'bank_transactions', id, 'update', oldRow || null, result.data, userId);
    return result;
}

/**
 * Bank statement with running balance (optionally per account).
 */
function getBankStatement(db, { bank_account, from_date, to_date } = {}) {
    ensureBankTable(db);
    const rows = listBankTransactions(db, { bank_account, from_date, to_date });
    const total_debit = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const total_credit = rows.reduce((s, r) => s + (r.credit || 0), 0);
    return {
        entries: rows,
        total_debit,
        total_credit,
        net: total_credit - total_debit,
        closing_balance: rows.length ? rows[rows.length - 1].running_balance : 0
    };
}

/**
 * Bulk import of bank rows from the Excel Bank sheet.
 * Dedup by reference_no (or date+amount+counterparty when no reference).
 * Exact party-name matches → match_status 'auto' (posted idempotently);
 * near/unmatched → 'review' queue.
 *
 * @param {object} db
 * @param {Array} rows - [{ date, reference_no, counterparty_name, description, debit, credit, payment_mode, bank_account, txn_type }]
 * @returns {object} report { read, inserted, skipped_dup, auto_posted, already_in_ledger, review_queue, unmatched }
 */
function importBankRows(db, rows) {
    ensureBankTable(db);
    const report = { read: 0, inserted: 0, skipped_dup: 0, auto_posted: 0, already_in_ledger: 0, review_queue: 0, unmatched: 0, transfers: 0, expenses: 0, errors: [] };

    const existingRefs = new Set(
        db.prepare("SELECT reference_no FROM bank_transactions WHERE reference_no != ''").all().map(r => r.reference_no)
    );
    const allParties = db.prepare('SELECT id, name FROM parties WHERE archived = 0').all();
    const exactNameMap = new Map();
    for (const p of allParties) exactNameMap.set(normalizeName(p.name), p.id);

    const insert = db.prepare(`
        INSERT INTO bank_transactions
            (date, reference_no, counterparty_name, description, debit, credit, amount,
             payment_mode, bank_account, txn_type, party_id, match_status, accounting_class)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const doImport = db.transaction(() => {
        for (const r of rows) {
            if (!r.date) { report.errors.push({ ref: r.reference_no || '?', reason: 'missing date' }); continue; }
            report.read++;
            const ref = String(r.reference_no || '').trim();
            if (ref && existingRefs.has(ref)) { report.skipped_dup++; continue; }

            const isCredit = (r.credit || 0) > 0;
            const debit = isCredit ? 0 : (r.debit || 0);
            const credit = isCredit ? (r.credit || 0) : 0;
            const amount = isCredit ? credit : debit;

            // Classify BEFORE matching: a cash deposit into the bank (or an
            // expense paid from it) carries no customer/supplier relationship,
            // so it is never auto-matched to a party by name.
            const cls = accounting.classifyBankRow(r);
            const nonParty = cls === 'cash_to_bank_transfer' || cls === 'expense';
            const partyId = nonParty ? null : (exactNameMap.get(normalizeName(r.counterparty_name)) || null);
            const status = nonParty ? 'auto' : (partyId ? 'auto' : (r.counterparty_name ? 'review' : 'none'));

            const res = insert.run(r.date, ref, r.counterparty_name || '', r.description || '',
                debit, credit, amount, r.payment_mode || 'QR/Bank', r.bank_account || '',
                r.txn_type || '', partyId, status, cls);
            const newId = Number(res.lastInsertRowid);
            if (ref) existingRefs.add(ref);
            report.inserted++;

            if (nonParty) {
                _markNonParty(db, newId, cls);
                if (cls === 'cash_to_bank_transfer') report.transfers++;
                else report.expenses++;
                continue;
            }

            if (partyId) {
                const posted = postBankToLedger(db, newId);
                if (posted.success && posted.posted) report.auto_posted++;
                else if (posted.success && !posted.posted && posted.reason === 'already_in_ledger') report.already_in_ledger++;
                else if (!posted.success) report.errors.push({ ref: ref || newId, reason: posted.error });
            } else if (status === 'review') {
                report.review_queue++;
            } else {
                report.unmatched++;
            }
        }
    });
    doImport();
    return report;
}

module.exports = {
    ensureBankTable,
    listBankTransactions,
    getBankTransaction,
    getBankReviewQueue,
    getBankStatement,
    saveBankTransaction,
    deleteBankTransaction,
    setBankMatch,
    postBankToLedger,
    importBankRows,
    findPartyByName,
    normalizeName,
    bankRowClass,
    isNonPartyRow
};