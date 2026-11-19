/**
 * Prarambha Account & Stock Management — Bank Transactions
 * =======================================================
 * Standalone bank transaction register. Bank rows are not posted to party
 * ledgers, payment/collection registers, petty cash, or expense registers.
 * Supports independent CRUD, import deduplication, classification labels,
 * and a bank statement with running balance.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const crypto = require('crypto');
const accounting = require('./accounting');
const { logAudit } = require('./audit');

const CLASS_META = {
    cash_to_bank_transfer: { reason: 'cash_to_bank_transfer', note: 'cash-to-bank transfer (classification only; standalone bank register)' },
    expense: { reason: 'expense_row', note: 'expense-like narration (classification only; standalone bank register)' }
};

/**
 * Content identity of a bank row: date + direction + amount + counterparty +
 * description + account + type. Used to build the stable txn_uid key so a
 * source statement re-imported later is recognised instead of re-inserted.
 * Never keyed on amount+date alone — two legitimate rows can share those.
 * @private
 */
function _rowIdentityKey(r) {
    const dir = (r.credit || 0) > 0 ? 'C' : 'D';
    const amt = Math.abs(Number((r.credit || r.debit || 0)) || 0).toFixed(2);
    const raw = [r.date || '', dir, amt, r.counterparty_name || '', r.description || '',
                 r.bank_account || '', r.txn_type || '', r.payment_mode || ''].join('|');
    return crypto.createHash('sha1').update(raw).digest('hex').slice(0, 20);
}

/**
 * Next free content-based uid (imp:<hash>#<n>) excluding one row id.
 * @private
 */
function _uidForContent(db, r, excludeId = null) {
    const prefix = `imp:${_rowIdentityKey(r)}#`;
    const rows = db.prepare(
        'SELECT id, txn_uid FROM bank_transactions WHERE txn_uid LIKE ?'
    ).all(prefix + '%');
    const used = new Set(rows.filter(x => x.id !== excludeId).map(x => x.txn_uid));
    let i = 0;
    while (used.has(prefix + i)) i++;
    return prefix + i;
}

/**
 * One-time idempotency migration: every bank row gets a stable txn_uid —
 * ref:<reference_no> when it has a reference, otherwise imp:<hash>#<n>
 * (identity key + occurrence rank so already-duplicated historical rows keep
 * distinct uids). A UNIQUE index then enforces "insert once" at the DB level.
 * Idempotent and cheap after the first run (0 pending rows → no-op).
 * @private
 */
function _migrateTxnUid(db) {
    const pending = db.prepare(`
        SELECT id, date, debit, credit, amount, counterparty_name, description,
               bank_account, txn_type, payment_mode, reference_no
          FROM bank_transactions WHERE txn_uid IS NULL ORDER BY id
    `).all();
    if (pending.length === 0) {
        try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_txn_uid ON bank_transactions(txn_uid)'); } catch (e) { /* ok */ }
        return;
    }
    const taken = new Set(
        db.prepare('SELECT txn_uid FROM bank_transactions WHERE txn_uid IS NOT NULL').all().map(x => x.txn_uid)
    );
    const upd = db.prepare('UPDATE bank_transactions SET txn_uid = ? WHERE id = ?');
    for (const r of pending) {
        const ref = String(r.reference_no || '').trim();
        let uid = ref ? `ref:${ref}` : null;
        if (uid && taken.has(uid)) uid = null; // duplicate reference already claimed
        if (!uid) {
            const prefix = `imp:${_rowIdentityKey(r)}#`;
            let i = 0;
            while (taken.has(prefix + i)) i++;
            uid = prefix + i;
        }
        upd.run(uid, r.id);
        taken.add(uid);
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_txn_uid ON bank_transactions(txn_uid)');
}

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
    // Stable idempotency key (Migration 27): ref:<reference> or imp:<hash>#<n>.
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN txn_uid TEXT DEFAULT NULL"); } catch (e) { /* ok */ }
    try { _migrateTxnUid(db); } catch (e) { console.log('txn_uid migration error (non-fatal):', e.message); }
    // Legacy rows are classified for display only. Healing never posts to or
    // creates a record in any other register.
    try { _healAccountingClass(db); } catch (e) { console.log('accounting_class heal error (non-fatal):', e.message); }
    // Multi-bank master + account assignment for existing rows (idempotent).
    try { ensureBankAccounts(db); } catch (e) { console.log('bank account migration error (non-fatal):', e.message); }
}

/**
 * Classify-on-read: derive and persist accounting_class for legacy rows whose
 * stored class is empty, from their own wording (one pass; afterwards the
 * WHERE matches nothing). Non-party rows also get the standard non-party
 * treatment (posted-in-place, match_status auto) so they leave the review
 * queue and become visible to the Cash Deposit view.
 * @private
 */
function _healAccountingClass(db) {
    const stale = db.prepare(
        "SELECT * FROM bank_transactions WHERE COALESCE(accounting_class, '') = ''"
    ).all();
    if (stale.length === 0) return;
    const setClass = db.prepare(
        `UPDATE bank_transactions SET accounting_class = ?, updated_at = datetime('now','localtime') WHERE id = ?`
    );
    for (const r of stale) {
        const cls = accounting.classifyBankRow(r) || 'unclassified';
        setClass.run(cls, r.id);
    }
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
        `UPDATE bank_transactions SET accounting_class = ?, party_id = NULL,
            ledger_posted = 0, ledger_entry_id = NULL,
            updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(cls, id);
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
        `SELECT id, reference_type, reference_id, description, date FROM ledger_entries
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
    const exists = db.prepare('SELECT id FROM bank_transactions WHERE id = ?').get(id);
    if (!exists) return { success: false, error: 'Bank transaction not found' };
    // Retained as a compatibility API for older clients; standalone bank rows
    // must never create, modify, or claim ledger/payment records.
    return { success: true, posted: false, reason: 'standalone_register' };
}

/**
 * List bank transactions with optional filters.
 */
function listBankTransactions(db, { from_date, to_date, search, match_status, bank_account, account_id, txn_category } = {}) {
    ensureBankTable(db);
    const where = [];
    const params = [];
    if (from_date) { where.push('b.date >= ?'); params.push(from_date); }
    if (to_date) { where.push('b.date <= ?'); params.push(to_date); }
    if (search) { where.push('(b.counterparty_name LIKE ? OR b.description LIKE ? OR b.reference_no LIKE ?)'); params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (match_status) { where.push('b.match_status = ?'); params.push(match_status); }
    if (bank_account) { where.push('b.bank_account = ?'); params.push(bank_account); }
    if (account_id) { where.push('b.account_id = ?'); params.push(Number(account_id)); }
    if (txn_category) { where.push('b.txn_category = ?'); params.push(txn_category); }
    const sql = `
        SELECT b.*, '' AS party_name,
               COALESCE(a.bank_name, '') AS account_name,
               COALESCE(a.account_number, '') AS account_number,
               COALESCE(a.status, '') AS account_status
        FROM bank_transactions b
        LEFT JOIN bank_accounts a ON a.id = b.account_id
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
 * Review queue is retained for compatibility but standalone bank rows are not party-matched.
 */
function getBankReviewQueue(db) {
    ensureBankTable(db);
    return [];
}

/**
 * Get a single bank transaction.
 */
function getBankTransaction(db, id) {
    ensureBankTable(db);
    return db.prepare(`SELECT b.*, '' AS party_name,
            COALESCE(a.bank_name, '') AS account_name,
            COALESCE(a.account_number, '') AS account_number
        FROM bank_transactions b
        LEFT JOIN bank_accounts a ON a.id = b.account_id
        WHERE b.id = ?`).get(id);
}

/**
 * Save (insert or update) a bank transaction.
 * Bank rows remain self-contained: no party match or cross-module posting.
 */
function saveBankTransaction(db, data, userId = null) {
    ensureBankTable(db);
    const {
        id, date, reference_no, counterparty_name, description,
        debit, credit, payment_mode, bank_account, txn_type,
        party_id, match_status, remarks, account_id, txn_category
    } = data || {};
    const amount = parseFloat(credit || 0) > 0 ? parseFloat(credit || 0) : (parseFloat(debit || 0) || 0);

    // Every transaction belongs to one bank account. An explicit account is
    // validated; a name that matches a real account is used; anything else goes
    // to "Unassigned / Existing Bank" and is flagged — never guessed.
    const acct = resolveAccountForRow(db, { account_id, bank_account, txn_type });
    if (acct.error) return { success: false, error: acct.error };
    const category = normalizeTxnCategory(txn_category, { txn_type, bank_account, description, debit, credit });
    const accountText = String(bank_account || '').trim() || (acct.account ? acct.account.bank_name : '');
    const review = acct.review ? 1 : 0;
    const cls = accounting.classifyBankRow({
        txn_type, description, counterparty_name, reference_no, remarks, debit, credit
    });
    const status = match_status || 'none';

    const oldRow = id ? db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id) : null;
    const refTrim = String(reference_no || '').trim();

    if (id) {
        // Keep the idempotency key stable across edits: adopt ref:<ref> when a
        // reference is set (rejecting a clash with a different row), fall back
        // to content identity when the reference is cleared.
        let uid = (oldRow && oldRow.txn_uid) || null;
        if (refTrim) {
            const cand = `ref:${refTrim}`;
            const clash = db.prepare('SELECT id FROM bank_transactions WHERE txn_uid = ? AND id != ?').get(cand, id);
            if (clash) return { success: false, error: `Reference ${refTrim} already used by transaction #${clash.id}` };
            uid = cand;
        } else if (!uid || String(uid).startsWith('ref:')) {
            uid = _uidForContent(db, { date, debit, credit, counterparty_name, description, bank_account, txn_type, payment_mode }, id);
        }
        // A transfer leg keeps its account: moving one side to another bank
        // would leave the pair pointing at the wrong balances.
        if (oldRow && oldRow.transfer_group && Number(oldRow.account_id) !== Number(acct.id)) {
            return { success: false, error: 'This row is one side of an inter-bank transfer; its account cannot be changed. Delete the transfer and record it again.' };
        }
        db.prepare(`
            UPDATE bank_transactions SET
                date = ?, reference_no = ?, counterparty_name = ?, description = ?,
                debit = ?, credit = ?, amount = ?, payment_mode = ?, bank_account = ?,
                txn_type = ?, party_id = NULL, match_status = ?, accounting_class = ?, remarks = ?,
                txn_uid = ?, account_id = ?, txn_category = ?, account_review = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(date, reference_no || '', counterparty_name || '', description || '',
              debit || 0, credit || 0, amount, payment_mode || 'QR/Bank', accountText,
              txn_type || '', status, cls, remarks || '', uid, acct.id, category, review, id);
        logAudit(db, 'bank_transactions', id, 'update', oldRow || null,
            getBankTransaction(db, id), userId);
        return { success: true, data: getBankTransaction(db, id), accounting_class: cls };
    }

    // Idempotency (insert): a reference is the source transaction's identity —
    // never insert a second row for one. Identical payload re-submitted within
    // 10 seconds is a double-click/retry: return the existing row instead.
    if (refTrim) {
        const dup = db.prepare('SELECT id FROM bank_transactions WHERE txn_uid = ?').get(`ref:${refTrim}`);
        if (dup) return { success: false, error: `Reference ${refTrim} already exists on transaction #${dup.id} — duplicate skipped`, duplicate_of: dup.id };
    }
    const recent = db.prepare(`
        SELECT id FROM bank_transactions
         WHERE date = ? AND amount = ? AND COALESCE(reference_no, '') = ?
           AND COALESCE(counterparty_name, '') = ? AND COALESCE(description, '') = ?
           AND COALESCE(bank_account, '') = ? AND COALESCE(txn_type, '') = ?
           AND created_at >= datetime('now', 'localtime', '-10 seconds')
         LIMIT 1
    `).get(date, amount, reference_no || '', counterparty_name || '', description || '',
           // The row is stored with the ACCOUNT NAME (accountText), not the raw
           // request value — compare like with like or a double-click inserts twice.
           accountText, txn_type || '');
    if (recent) return { success: true, data: getBankTransaction(db, recent.id), accounting_class: cls, duplicate: true };
    const uid = refTrim
        ? `ref:${refTrim}`
        : _uidForContent(db, { date, debit, credit, counterparty_name, description, bank_account, txn_type, payment_mode });

    const ins = db.prepare(`
        INSERT INTO bank_transactions
            (date, reference_no, counterparty_name, description, debit, credit, amount,
             payment_mode, bank_account, txn_type, party_id, match_status, accounting_class, remarks, created_by, txn_uid,
             account_id, txn_category, account_review, recon_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreconciled')
    `).run(date, reference_no || '', counterparty_name || '', description || '',
           debit || 0, credit || 0, amount, payment_mode || 'QR/Bank', accountText,
           txn_type || '', null, status, cls, remarks || '', userId, uid,
           acct.id, category, review);
    const newId = Number(ins.lastInsertRowid);
    db.prepare(`UPDATE bank_transactions SET party_id = NULL, ledger_posted = 0, ledger_entry_id = NULL WHERE id = ?`).run(newId);
    logAudit(db, 'bank_transactions', newId, 'create', null, getBankTransaction(db, newId), userId);
    return { success: true, data: getBankTransaction(db, newId), accounting_class: cls };
}

/**
 * Delete only the standalone bank row. Never modify another register.
 */
function deleteBankTransaction(db, id, userId = null) {
    ensureBankTable(db);
    const txn = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    if (!txn) return { success: false, error: 'Bank transaction not found' };
    // One half of an inter-bank transfer is never deleted alone: the pair is
    // one movement, so both legs go together and both accounts stay correct.
    const group = String(txn.transfer_group || '');
    if (group) {
        const pair = db.prepare('SELECT * FROM bank_transactions WHERE transfer_group = ?').all(group);
        db.transaction(() => {
            for (const row of pair) {
                db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(row.id);
                logAudit(db, 'bank_transactions', row.id, 'delete', row, null, userId);
            }
        })();
        return { success: true, deleted: pair.length, transfer: true };
    }
    db.prepare('DELETE FROM bank_transactions WHERE id = ?').run(id);
    logAudit(db, 'bank_transactions', id, 'delete', txn, null, userId);
    return { success: true };
}

/**
 * Legacy matcher compatibility API: cannot connect a standalone bank row elsewhere.
 */
function setBankMatch(db, id, { party_id, match_status, post } = {}, userId = null) {
    ensureBankTable(db);
    const oldRow = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    if (!oldRow) return { success: false, error: 'Bank transaction not found' };
    if (party_id || post) return { success: false, error: 'Bank transactions are standalone and cannot be matched or posted to a party ledger.' };
    return { success: true, data: getBankTransaction(db, id), standalone: true };
}

/**
 * Manually override the bank-only classification label (audited). This never posts to other modules.
 */
function setBankAccountingClass(db, id, accounting_class, userId = null) {
    ensureBankTable(db);
    const allowed = ['cash_to_bank_transfer', 'expense', 'customer_receipt', 'supplier_payment', 'unclassified'];
    if (!allowed.includes(accounting_class)) return { success: false, error: 'Unknown classification: ' + accounting_class };
    const oldRow = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(id);
    if (!oldRow) return { success: false, error: 'Bank transaction not found' };
    db.prepare(
        `UPDATE bank_transactions SET accounting_class = ?, party_id = NULL, ledger_posted = 0,
            ledger_entry_id = NULL, match_status = 'none',
            updated_at = datetime('now','localtime') WHERE id = ?`
    ).run(accounting_class, id);
    const after = getBankTransaction(db, id);
    logAudit(db, 'bank_transactions', id, 'update', oldRow, after, userId);
    return { success: true, data: after };
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

    // Existing rows, indexed by uid and by content identity. A reference number
    // is NOT a unique key: the workbook's Transaction ID column repeats one
    // value down the whole sheet (Dairy_Accounts_Professional 76 has 31 rows
    // all called "QR-089"), and a bank charge can legitimately share a
    // reference with the transfer it belongs to. Skipping on reference alone
    // silently dropped every row after the first — that is why nothing after
    // 2083 Ashoj 12 ever appeared.
    const existingRows = db.prepare(
        'SELECT id, reference_no, txn_uid, date, counterparty_name, description, debit, credit, bank_account, payment_mode, txn_type FROM bank_transactions'
    ).all();
    const takenUids = new Set(existingRows.map(r => r.txn_uid).filter(Boolean));
    // Transaction identity without the descriptive columns. The bank ACCOUNT and
    // payment mode are edited between workbook copies (v76 moved 30 statement
    // rows from "Sushil QR" to "PRARAMBHA"), so they must not be part of the
    // duplicate test — date + direction + amount + counterparty + description
    // is the composite key that identifies the transaction itself.
    const txnKey = (r) => [
        r.date || '',
        (r.credit || 0) > 0 ? 'C' : 'D',
        Math.abs(Number(r.credit || r.debit || 0) || 0).toFixed(2),
        String(r.counterparty_name || '').replace(/\s+/g, ' ').trim(),
        String(r.description || '').replace(/\s+/g, ' ').trim()
    ].join('|');
    // how many times the DB already holds each transaction identity
    const dbTxn = new Map();
    const refUidTxn = new Map();
    for (const row of existingRows) {
        const key = txnKey(row);
        dbTxn.set(key, (dbTxn.get(key) || 0) + 1);
        if (row.txn_uid && String(row.txn_uid).startsWith('ref:')) refUidTxn.set(row.txn_uid, key);
    }
    const fileTxnOcc = new Map();
    // How many times each reference occurs in this file.
    const fileRefCount = new Map();
    for (const r of rows) {
        const ref = String(r.reference_no || '').trim();
        if (ref) fileRefCount.set(ref, (fileRefCount.get(ref) || 0) + 1);
    }
    // Occurrence rank of each content identity *within this file*, so a file
    // legitimately containing two identical no-reference rows still imports
    // both, while re-importing the same file imports neither twice.
    const fileOcc = new Map();

    const insert = db.prepare(`
        INSERT INTO bank_transactions
            (date, reference_no, counterparty_name, description, debit, credit, amount,
             payment_mode, bank_account, txn_type, party_id, match_status, accounting_class, txn_uid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const doImport = db.transaction(() => {
        for (const r of rows) {
            if (!r.date) { report.errors.push({ ref: r.reference_no || '?', reason: 'missing date' }); continue; }
            report.read++;
            const ref = String(r.reference_no || '').trim();
            const hash = _rowIdentityKey(r);
            const occ = fileOcc.get(hash) || 0;
            fileOcc.set(hash, occ + 1);

            // Identity of this row. A reference that appears ONCE in the file and
            // owns its `ref:` uid keeps the plain `ref:<no>` uid, so files
            // imported before this change stay idempotent. A reference that is
            // reused (same ref, different transaction) gets a content suffix, so
            // every genuinely distinct row is imported exactly once.
            const refIsUnique = !!ref && fileRefCount.get(ref) === 1;
            const uid = refIsUnique ? `ref:${ref}` : `imp:${hash}#${occ}`;
            // A reused reference also needs its own content check: the same
            // transaction can already be stored under `ref:<no>` from an earlier
            // workbook copy whose bank-account column has since been edited.
            const key = txnKey(r);
            const keyOcc = fileTxnOcc.get(key) || 0;
            fileTxnOcc.set(key, keyOcc + 1);
            if (!refIsUnique && (dbTxn.get(key) || 0) > keyOcc) { report.skipped_dup++; continue; }
            if (takenUids.has(uid)) { report.skipped_dup++; continue; }

            const isCredit = (r.credit || 0) > 0;
            const debit = isCredit ? 0 : (r.debit || 0);
            const credit = isCredit ? (r.credit || 0) : 0;
            const amount = isCredit ? credit : debit;

            // Classify BEFORE matching: a cash deposit into the bank (or an
            // expense paid from it) carries no customer/supplier relationship,
            // so it is never auto-matched to a party by name.
            const cls = accounting.classifyBankRow(r);
                    const status = 'none';
            const res = insert.run(r.date, ref, r.counterparty_name || '', r.description || '',
                debit, credit, amount, r.payment_mode || 'QR/Bank', r.bank_account || '',
                r.txn_type || '', null, status, cls, uid);
            const newId = Number(res.lastInsertRowid);
            takenUids.add(uid);
            if (refIsUnique) refUidTxn.set(`ref:${ref}`, key);
            dbTxn.set(key, (dbTxn.get(key) || 0) + 1);
            report.inserted++;

            if (cls === 'cash_to_bank_transfer') report.transfers++;
            else if (cls === 'expense') report.expenses++;
            else report.unmatched++;
        }
    });
    doImport();
    // Give the imported rows their account right away (or the review bucket)
    // instead of leaving them unassigned until the next screen load.
    try { migrateBankAccounts(db); } catch (e) { /* assigned on next open */ }
    return report;
}

// ══════════════════════════════════════════════════════════════
// MULTI-BANK ACCOUNT MASTER
// ══════════════════════════════════════════════════════════════

const round2 = accounting.round2;

const ACCOUNT_TYPES = ['Current', 'Savings', 'Other'];
const SYSTEM_ACCOUNT_NAME = 'Unassigned / Existing Bank';
const RECON_STATUSES = ['unreconciled', 'reconciled', 'disputed'];
const TXN_CATEGORIES = ['deposit', 'withdrawal', 'bank_charge', 'interest', 'transfer_in', 'transfer_out', 'other'];

const TXN_CATEGORY_LABELS = {
    deposit: 'Deposit', withdrawal: 'Withdrawal', bank_charge: 'Bank Charge',
    interest: 'Interest', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', other: 'Other'
};

// Values the workbook import left in `bank_account`: they are CLASSIFICATIONS,
// never account names. Used by the migration so a classification can never be
// mistaken for a bank.
const CLASSIFICATION_VALUES = new Set([
    '', 'advance', 'customer collection', 'supplier payment', 'expenses', 'expense',
    'transfer between own accounts', 'bank charge', 'unclassified', 'other'
]);

// The import also leaves transaction KINDS in the type column (for example
// "Bank Deposit (own)"). None of these can be a bank name, so the migration
// must never invent an account from one — those rows go to the review bucket.
const TXN_KIND_WORDS = /\b(deposit|withdrawal|withdraw|transfer|expense|expenses|collection|payment|charge|interest|advance|cash)\b/i;

const ACCOUNT_SCHEMA = `
CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bank_name TEXT NOT NULL DEFAULT '',
    branch_name TEXT DEFAULT '',
    account_holder TEXT DEFAULT '',
    account_number TEXT DEFAULT '',
    account_type TEXT DEFAULT 'Current' CHECK(account_type IN ('Current', 'Savings', 'Other')),
    opening_balance REAL DEFAULT 0.0,
    opening_balance_date TEXT DEFAULT '',
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    remarks TEXT DEFAULT '',
    is_system INTEGER DEFAULT 0,
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_number ON bank_accounts(account_number) WHERE account_number <> '';
CREATE INDEX IF NOT EXISTS idx_bank_accounts_name ON bank_accounts(bank_name);
`;

/**
 * Create the account master and add the account columns to an existing
 * `bank_transactions` table, then migrate legacy rows once. Safe to call on
 * every start: every step is idempotent and no row is ever deleted.
 */
function ensureBankAccounts(db) {
    db.exec(ACCOUNT_SCHEMA);
    try { db.exec('ALTER TABLE bank_transactions ADD COLUMN account_id INTEGER DEFAULT NULL'); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN txn_category TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN transfer_group TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN recon_status TEXT DEFAULT 'unreconciled'"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN recon_date TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec("ALTER TABLE bank_transactions ADD COLUMN recon_remarks TEXT DEFAULT ''"); } catch (e) { /* ok */ }
    try { db.exec('ALTER TABLE bank_transactions ADD COLUMN account_review INTEGER DEFAULT 0'); } catch (e) { /* ok */ }
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(account_id)'); } catch (e) { /* ok */ }
    const report = migrateBankAccounts(db);
    return report;
}

/** Look an account up by its number, or by its name (case-insensitive). */
function findBankAccount(db, value) {
    const v = String(value || '').trim();
    if (!v) return null;
    return db.prepare(
        `SELECT * FROM bank_accounts WHERE account_number = ? OR UPPER(TRIM(bank_name)) = UPPER(TRIM(?))
         ORDER BY CASE WHEN account_number = ? THEN 0 ELSE 1 END, id LIMIT 1`
    ).get(v, v, v) || null;
}

/** The system bucket every row with an unknown bank goes to. Never guessed. */
function systemAccountId(db) {
    const row = db.prepare('SELECT id FROM bank_accounts WHERE is_system = 1 ORDER BY id LIMIT 1').get();
    if (row) return row.id;
    const info = db.prepare(
        `INSERT INTO bank_accounts (bank_name, account_type, opening_balance, status, is_system, remarks)
         VALUES (?, 'Other', 0, 'Active', 1, ?)`
    ).run(SYSTEM_ACCOUNT_NAME, 'Existing transactions whose bank was not recorded. Reassign them from the Bank Transactions screen once the bank is known.');
    return Number(info.lastInsertRowid);
}

/**
 * Account name a legacy row actually carries.
 *
 * The workbook's "Bank Account" column (index 11) reached `txn_type`, while the
 * Classification column (index 10) reached `bank_account`. The app's own form
 * wrote the opposite way. Both orders are therefore tried, and a value that is
 * a known classification is never treated as a bank name.
 * @private
 */
function legacyAccountName(row) {
    for (const raw of [row && row.txn_type, row && row.bank_account]) {
        const v = String(raw || '').trim();
        if (v && !CLASSIFICATION_VALUES.has(v.toLowerCase())) return v;
    }
    return '';
}

/**
 * One-time, idempotent assignment of existing transactions to accounts.
 *
 * A bank named on the row is used as-is (never guessed); a row with no usable
 * bank name goes to "Unassigned / Existing Bank" and is flagged for review.
 * No row is edited except to fill account_id / txn_category / the review flag,
 * and no amount, date or text is changed.
 */
function migrateBankAccounts(db) {
    const report = { created: [], assigned: 0, unassigned: 0, already: 0, flagged: 0 };
    const pending = db.prepare('SELECT * FROM bank_transactions WHERE account_id IS NULL ORDER BY id').all();
    if (pending.length === 0) return report;

    // updated_at is deliberately NOT touched: the migration must leave every
    // historical row byte-identical apart from the account link itself.
    const upd = db.prepare(
        `UPDATE bank_transactions SET account_id = ?, txn_category = CASE WHEN COALESCE(txn_category,'') = '' THEN ? ELSE txn_category END,
            account_review = ? WHERE id = ?`
    );
    const run = db.transaction(() => {
        for (const row of pending) {
            const name = legacyAccountName(row);
            let account = name ? findBankAccount(db, name) : null;
            let review = 0;
            // An existing account is always reused; a NEW one is only created
            // from something that reads like a bank, never from a transaction
            // kind such as "Bank Deposit (own)".
            if (name && !account && !TXN_KIND_WORDS.test(name)) {
                const info = db.prepare(
                    `INSERT INTO bank_accounts (bank_name, account_type, opening_balance, status, remarks)
                     VALUES (?, 'Current', 0, 'Active', ?)`
                ).run(name, 'Created from existing bank transactions. Set the branch, number and opening balance, then confirm them against the bank statement.');
                account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(info.lastInsertRowid);
                report.created.push(name);
            }
            if (!account) { review = 1; report.unassigned++; report.flagged++; }
            else report.assigned++;
            const accountId = account ? account.id : systemAccountId(db);
            upd.run(accountId, deriveTxnCategory(row), review, row.id);
        }
    });
    run();
    return report;
}

/** Transaction type implied by a legacy row's own wording. */
function deriveTxnCategory(row) {
    const text = [row && row.txn_type, row && row.bank_account, row && row.description].join(' ').toUpperCase();
    if (/BANK\s*CHARGE|SERVICE\s*CHARGE|SMS\s*CHARGE|TRANSFER\s*CHARGE/.test(text)) return 'bank_charge';
    if (/INTEREST/.test(text)) return 'interest';
    if (/TRANSFER\s*BETWEEN|OWN\s*ACCOUNT/.test(text)) return (Number(row.debit) || 0) > 0 ? 'transfer_out' : 'transfer_in';
    return (Number(row.credit) || 0) > 0 ? 'deposit' : 'withdrawal';
}

/** Normalise a requested type; unknown values fall back to the direction. */
function normalizeTxnCategory(value, row = {}) {
    const v = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (TXN_CATEGORIES.includes(v)) return v;
    return deriveTxnCategory(row);
}

/** All accounts, each with its own balance (never one combined figure). */
function listBankAccounts(db, { include_inactive = false } = {}) {
    ensureBankAccounts(db);
    const rows = db.prepare(`
        SELECT a.*,
               (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) AS tx_count,
               (SELECT COALESCE(SUM(t.credit - t.debit), 0) FROM bank_transactions t WHERE t.account_id = a.id) AS movement
        FROM bank_accounts a
        ${include_inactive ? '' : "WHERE a.status = 'Active'"}
        ORDER BY a.is_system, a.bank_name, a.account_number, a.id
    `).all();
    return rows.map(a => ({ ...a, current_balance: round2((a.opening_balance || 0) + (a.movement || 0)) }));
}

function getBankAccount(db, id) {
    ensureBankAccounts(db);
    const a = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
    if (!a) return null;
    const mv = db.prepare('SELECT COALESCE(SUM(credit - debit), 0) m, COUNT(*) n FROM bank_transactions WHERE account_id = ?').get(a.id);
    return { ...a, movement: round2(mv.m), tx_count: mv.n, current_balance: round2((a.opening_balance || 0) + mv.m) };
}

/** Create or update a bank account (audited). Duplicate numbers are rejected. */
function saveBankAccount(db, data = {}, userId = null) {
    ensureBankAccounts(db);
    const { id, bank_name, branch_name, account_holder, account_number, account_type,
        opening_balance, opening_balance_date, status, remarks } = data;

    const name = String(bank_name || '').trim();
    if (!name) return { success: false, error: 'Bank name is required' };
    const type = ACCOUNT_TYPES.includes(String(account_type)) ? String(account_type) : 'Current';
    const state = String(status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
    const number = String(account_number || '').trim();
    const opening = round2(Number(opening_balance) || 0);
    const openingDate = String(opening_balance_date || '').trim();
    if (openingDate) {
        const { validateBSDate } = require('../bs-calendar');
        const check = validateBSDate(openingDate);
        if (!check.valid) return { success: false, error: 'Opening balance date: ' + check.reason };
    }
    if (number) {
        const clash = db.prepare('SELECT id FROM bank_accounts WHERE account_number = ? AND id != ?')
            .get(number, id || 0);
        if (clash) return { success: false, error: `Account number ${number} is already used by account #${clash.id}` };
    }

    if (id) {
        const old = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
        if (!old) return { success: false, error: 'Bank account not found' };
        db.prepare(`
            UPDATE bank_accounts SET bank_name = ?, branch_name = ?, account_holder = ?, account_number = ?,
                account_type = ?, opening_balance = ?, opening_balance_date = ?, status = ?, remarks = ?,
                updated_at = datetime('now','localtime') WHERE id = ?
        `).run(name, String(branch_name || '').trim(), String(account_holder || '').trim(), number,
               type, opening, openingDate, state, String(remarks || '').trim(), id);
        logAudit(db, 'bank_accounts', id, 'update', old, getBankAccount(db, id), userId);
        return { success: true, data: getBankAccount(db, id) };
    }

    const info = db.prepare(`
        INSERT INTO bank_accounts (bank_name, branch_name, account_holder, account_number, account_type,
            opening_balance, opening_balance_date, status, remarks, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, String(branch_name || '').trim(), String(account_holder || '').trim(), number,
           type, opening, openingDate, state, String(remarks || '').trim(), userId);
    const newId = Number(info.lastInsertRowid);
    logAudit(db, 'bank_accounts', newId, 'create', null, getBankAccount(db, newId), userId);
    return { success: true, data: getBankAccount(db, newId) };
}

/** Activate / deactivate. History is never touched. */
function setBankAccountStatus(db, id, status, userId = null) {
    ensureBankAccounts(db);
    const old = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
    if (!old) return { success: false, error: 'Bank account not found' };
    const state = String(status) === 'Inactive' ? 'Inactive' : 'Active';
    db.prepare("UPDATE bank_accounts SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(state, id);
    logAudit(db, 'bank_accounts', id, 'update', old, getBankAccount(db, id), userId);
    return { success: true, data: getBankAccount(db, id) };
}

/**
 * Delete an account ONLY when it has no transactions. An account with history
 * is deactivated instead, so no statement row can ever be orphaned.
 */
function deleteBankAccount(db, id, userId = null) {
    ensureBankAccounts(db);
    const old = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id);
    if (!old) return { success: false, error: 'Bank account not found' };
    const used = db.prepare('SELECT COUNT(*) n FROM bank_transactions WHERE account_id = ?').get(id).n;
    if (used > 0) {
        return {
            success: false, used,
            error: `This account has ${used} transaction(s) — it cannot be deleted. Set it to Inactive instead; the history stays available.`
        };
    }
    if (old.is_system) return { success: false, error: 'The "Unassigned / Existing Bank" account is required and cannot be deleted.' };
    db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id);
    logAudit(db, 'bank_accounts', id, 'delete', old, null, userId);
    return { success: true };
}

/**
 * Resolve the account a transaction belongs to, without ever guessing:
 * an explicit id wins; a name that matches a real account is used; anything
 * else is parked in the system bucket and flagged for review.
 * @private
 */
function resolveAccountForRow(db, { account_id, bank_account, txn_type } = {}) {
    if (account_id) {
        const a = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(account_id);
        if (!a) return { error: 'Bank account not found' };
        return { id: a.id, account: a, review: 0 };
    }
    const name = String(bank_account || '').trim()
        || (CLASSIFICATION_VALUES.has(String(txn_type || '').trim().toLowerCase()) ? '' : String(txn_type || '').trim());
    const found = name ? findBankAccount(db, name) : null;
    if (found) return { id: found.id, account: found, review: 0 };
    return { id: systemAccountId(db), account: db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(systemAccountId(db)), review: 1 };
}

/**
 * Bank statement. One account → its own opening balance and running balance.
 * All accounts → per-account sections with their own balances; the totals are
 * reported separately and never merged into one misleading bank balance.
 */
function getBankStatement(db, { account_id, from_date, to_date, txn_category, search, bank_account } = {}) {
    ensureBankTable(db);
    const accounts = listBankAccounts(db, { include_inactive: true });
    const inRange = (r) => (!from_date || r.date >= from_date) && (!to_date || r.date <= to_date);
    const matches = (r) => (!txn_category || (r.txn_category || '') === txn_category)
        && (!search || [r.reference_no, r.description, r.counterparty_name].some(v => String(v || '').toLowerCase().includes(String(search).toLowerCase())));

    const rowsFor = (accountId) => db.prepare(
        `SELECT * FROM bank_transactions WHERE account_id = ? ORDER BY date, id`
    ).all(accountId);

    const runAccount = (account) => {
        const all = rowsFor(account.id);
        const before = all.filter(r => from_date && r.date < from_date);
        const opening = round2((account.opening_balance || 0)
            + before.reduce((s, r) => s + (r.credit || 0) - (r.debit || 0), 0));
        let running = opening;
        const entries = [];
        for (const r of all.filter(inRange)) {
            running = round2(running + (r.credit || 0) - (r.debit || 0));
            if (!matches(r)) continue;
            entries.push({
                ...r, running_balance: running,
                account_name: account.bank_name, account_number: account.account_number,
                account_label: account.bank_name + (account.account_number ? ' — ' + account.account_number : '')
            });
        }
        const debits = round2(entries.reduce((s, r) => s + (r.debit || 0), 0));
        const credits = round2(entries.reduce((s, r) => s + (r.credit || 0), 0));
        return {
            account: { id: account.id, bank_name: account.bank_name, account_number: account.account_number,
                branch_name: account.branch_name, account_type: account.account_type, status: account.status,
                is_system: account.is_system, tx_count: account.tx_count },
            opening_balance: opening, total_debit: debits, total_credit: credits,
            closing_balance: round2(opening + credits - debits), entries
        };
    };

    if (account_id) {
        const account = accounts.find(a => Number(a.id) === Number(account_id));
        if (!account) return { success: false, error: 'Bank account not found', entries: [], total_debit: 0, total_credit: 0, closing_balance: 0 };
        const s = runAccount(account);
        return {
            success: true, mode: 'account', ...s,
            net: round2(s.total_credit - s.total_debit),
            from_date, to_date, accounts
        };
    }

    // An account with no history at all (typically the empty review bucket) is
    // not a bank balance and is left out of the consolidated view. Accounts
    // whose rows merely fall outside the period stay, with their balance.
    const per = accounts
        .filter(a => (a.tx_count || 0) > 0 || round2(a.opening_balance) !== 0)
        .map(runAccount);
    const entries = per.flatMap(p => p.entries)
        .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    const total_debit = round2(per.reduce((s, p) => s + p.total_debit, 0));
    const total_credit = round2(per.reduce((s, p) => s + p.total_credit, 0));
    return {
        success: true, mode: 'all', entries, total_debit, total_credit,
        net: round2(total_credit - total_debit),
        // Per-account balances stay separate on purpose: adding bank balances
        // together hides which bank holds what.
        accounts: per.map(p => ({ ...p.account, opening_balance: p.opening_balance, total_debit: p.total_debit,
            total_credit: p.total_credit, closing_balance: p.closing_balance })),
        closing_by_account: per.map(p => ({ account_id: p.account.id, label: p.account.bank_name + (p.account.account_number ? ' — ' + p.account.account_number : ''), closing_balance: p.closing_balance })),
        from_date, to_date
    };
}

/**
 * Inter-bank transfer: TWO linked rows (debit source, credit destination).
 * Money moving between the company's own accounts is never income or expense.
 */
function saveBankTransfer(db, data = {}, userId = null) {
    ensureBankAccounts(db);
    const fromId = Number(data.from_account_id);
    const toId = Number(data.to_account_id);
    const amount = round2(Number(data.amount) || 0);
    const date = String(data.date || '').trim();
    if (!fromId || !toId) return { success: false, error: 'Select both the source and the destination account' };
    if (fromId === toId) return { success: false, error: 'Source and destination must be different accounts' };
    if (!(amount > 0)) return { success: false, error: 'Amount must be greater than zero' };
    if (!date) return { success: false, error: 'Date is required' };
    const from = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(fromId);
    const to = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(toId);
    if (!from || !to) return { success: false, error: 'Bank account not found' };
    if (from.status === 'Inactive' || to.status === 'Inactive') return { success: false, error: 'Both accounts must be Active' };

    const group = 'tr:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2, 8);
    const reference = String(data.reference_no || '').trim();
    const remarks = String(data.remarks || '').trim();
    const insert = db.prepare(`
        INSERT INTO bank_transactions
            (date, reference_no, counterparty_name, description, debit, credit, amount, payment_mode,
             bank_account, txn_type, party_id, match_status, accounting_class, remarks, created_by,
             txn_uid, account_id, txn_category, transfer_group, recon_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', ?, ?, ?, ?, ?, ?, ?, 'unreconciled')
    `);
    const fromLabel = from.bank_name + (from.account_number ? ' — ' + from.account_number : '');
    const toLabel = to.bank_name + (to.account_number ? ' — ' + to.account_number : '');

    const run = db.transaction(() => {
        const outInfo = insert.run(date, reference, to.bank_name, `Transfer to ${toLabel}`, amount, 0, amount,
            'Bank', from.bank_name, 'Transfer Between Own Accounts', 'cash_to_bank_transfer', remarks, userId,
            `${group}#out`, from.id, 'transfer_out', group);
        const inInfo = insert.run(date, reference, from.bank_name, `Transfer from ${fromLabel}`, 0, amount, amount,
            'Bank', to.bank_name, 'Transfer Between Own Accounts', 'cash_to_bank_transfer', remarks, userId,
            `${group}#in`, to.id, 'transfer_in', group);
        const out = getBankTransaction(db, Number(outInfo.lastInsertRowid));
        const inn = getBankTransaction(db, Number(inInfo.lastInsertRowid));
        logAudit(db, 'bank_transactions', out.id, 'create', null, out, userId);
        logAudit(db, 'bank_transactions', inn.id, 'create', null, inn, userId);
        return { out, in: inn };
    });
    const pair = run();
    return {
        success: true, transfer_group: group, amount,
        from: pair.out, to: pair.in,
        note: 'Two linked rows. Money between your own accounts — never income or expense.'
    };
}

/**
 * Reconciliation status / remarks on existing rows. Never changes an amount,
 * date, account or description — a reconciliation marker only.
 */
function reconcileBank(db, data = {}, userId = null) {
    ensureBankAccounts(db);
    const status = RECON_STATUSES.includes(String(data.status)) ? String(data.status) : 'reconciled';
    const remarks = String(data.remarks || '').trim();
    const reconDate = String(data.recon_date || data.date || '').trim();
    let ids = Array.isArray(data.ids) ? data.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) {
        const where = [];
        const params = [];
        if (data.account_id) { where.push('account_id = ?'); params.push(Number(data.account_id)); }
        if (data.from_date) { where.push('date >= ?'); params.push(data.from_date); }
        if (data.to_date) { where.push('date <= ?'); params.push(data.to_date); }
        if (where.length === 0) return { success: false, error: 'Choose an account or a date range to reconcile' };
        ids = db.prepare(`SELECT id FROM bank_transactions WHERE ${where.join(' AND ')}`).all(...params).map(r => r.id);
    }
    const get = db.prepare('SELECT * FROM bank_transactions WHERE id = ?');
    const upd = db.prepare(`UPDATE bank_transactions SET recon_status = ?, recon_date = ?, recon_remarks = ?,
        updated_at = datetime('now','localtime') WHERE id = ?`);
    let changed = 0;
    db.transaction(() => {
        for (const id of ids) {
            const old = get.get(id);
            if (!old) continue;
            upd.run(status, reconDate, remarks, id);
            logAudit(db, 'bank_transactions', id, 'update', old, get.get(id), userId);
            changed++;
        }
    })();
    return { success: true, updated: changed, status, remarks };
}

module.exports = {
    ensureBankTable,
    ACCOUNT_TYPES, TXN_CATEGORIES, TXN_CATEGORY_LABELS, SYSTEM_ACCOUNT_NAME,
    ensureBankAccounts, migrateBankAccounts, listBankAccounts, getBankAccount,
    saveBankAccount, setBankAccountStatus, deleteBankAccount, findBankAccount,
    saveBankTransfer, reconcileBank,
    listBankTransactions,
    getBankTransaction,
    getBankReviewQueue,
    getBankStatement,
    saveBankTransaction,
    deleteBankTransaction,
    setBankMatch,
    setBankAccountingClass,
    postBankToLedger,
    importBankRows,
    findPartyByName,
    normalizeName,
    bankRowClass,
    isNonPartyRow
};