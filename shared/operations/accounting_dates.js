/**
 * Prarambha Account & Stock Management — Transaction Date vs Accounting Date
 * ==========================================================================
 * Every money document carries TWO dates, stored independently:
 *
 *   date             — the TRANSACTION date: when money actually moved.
 *                      Drives Cash Book, Bank register, Cash Flow, Payment
 *                      history and every "what happened today" view.
 *   accounting_date  — the ACCOUNTING / EFFECTIVE date: the period the income
 *                      or expense belongs to. Drives Profit & Loss, expense
 *                      breakdown, income heads and the party statement date.
 *
 * Neither date is ever derived from the other after entry. Changing the
 * accounting date never rewrites the transaction date (and vice versa).
 *
 * Migration policy (no guessing):
 *   • A historical row's accounting date is its existing transaction date —
 *     that is the only date the books actually recorded. No historical row is
 *     moved to a different month.
 *   • `accounting_date_source` is stamped 'migrated' so the operator can see
 *     which rows still need a manual period correction.
 *   • Rows whose paid-to text matches no party are flagged `party_review=1`
 *     instead of being attached to a guessed party.
 *
 * BS dates are strings; nothing here parses them through Date/strftime.
 */

const bsCalendar = require('../bs-calendar');

/** Tables that carry money and therefore get an accounting date. */
const ACCOUNTING_TABLES = [
    'sales',
    'purchases',
    'payments',
    'petty_cash',
    'other_expenses',
    'milk_collections',
    'ledger_entries'
];

function hasColumn(db, table, column) {
    try {
        return db.prepare(
            `SELECT COUNT(*) AS n FROM pragma_table_info(?) WHERE name = ?`
        ).get(table, column).n > 0;
    } catch (e) {
        return false;
    }
}

function hasTable(db, table) {
    try {
        return !!db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(table);
    } catch (e) {
        return false;
    }
}

/**
 * Effective-date SQL for a table/alias. Falls back to the transaction date on
 * a book that has not run the migration yet, so no report can crash.
 */
function acctDateExpr(db, table, alias) {
    const a = alias || table;
    if (hasColumn(db, table, 'accounting_date')) {
        return `COALESCE(NULLIF(TRIM(${a}.accounting_date), ''), ${a}.date)`;
    }
    return `${a}.date`;
}

/** BS month (YYYY-MM) of a date string, or ''. */
function periodOf(dateStr) {
    const s = String(dateStr || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : '';
}

/**
 * Normalise the pair of dates for a new/edited document.
 * Throws on an invalid BS date instead of silently storing it.
 *
 * @returns {{date: string, accounting_date: string, source: string}}
 */
function normalizeDates({ date, accounting_date, transaction_date } = {}) {
    const txn = String(transaction_date || date || '').trim();
    const txnCheck = bsCalendar.validateBSDate(txn);
    if (!txnCheck.valid) throw new Error('Transaction date: ' + txnCheck.reason);

    let acct = String(accounting_date || '').trim();
    if (!acct) return { date: txn, accounting_date: txn, source: 'same_as_transaction' };
    const acctCheck = bsCalendar.validateBSDate(acct);
    if (!acctCheck.valid) throw new Error('Accounting date: ' + acctCheck.reason);
    return {
        date: txn,
        accounting_date: acct,
        source: acct === txn ? 'same_as_transaction' : 'explicit'
    };
}

/**
 * Create the accounting-date columns and backfill them from the stored
 * transaction dates. Idempotent: safe to run on every start.
 *
 * Also adds the party link on the two registers that only kept a free-text
 * payee (petty_cash, other_expenses) so a payment there can reach the party
 * statement — but only an exact, unique name match is linked.
 */
function ensureAccountingDates(db) {
    const report = {
        added_columns: [],
        backfilled: {},
        linked_parties: { petty_cash: 0, other_expenses: 0 },
        flagged_for_review: { petty_cash: 0, other_expenses: 0 },
        already_current: true
    };

    const addColumn = (table, column, ddl) => {
        if (!hasTable(db, table)) return false;
        if (hasColumn(db, table, column)) return false;
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`).run();
        report.added_columns.push(`${table}.${column}`);
        return true;
    };

    const tx = db.transaction(() => {
        for (const table of ACCOUNTING_TABLES) {
            addColumn(table, 'accounting_date', "TEXT DEFAULT ''");
            addColumn(table, 'accounting_date_source', "TEXT DEFAULT ''");
        }
        addColumn('petty_cash', 'party_id', 'INTEGER DEFAULT NULL');
        addColumn('other_expenses', 'party_id', 'INTEGER DEFAULT NULL');
        addColumn('other_expenses', 'paid_amount', 'REAL DEFAULT NULL');
        addColumn('other_expenses', 'payment_status', "TEXT DEFAULT 'paid'");
        addColumn('petty_cash', 'party_review', 'INTEGER DEFAULT 0');
        addColumn('other_expenses', 'party_review', 'INTEGER DEFAULT 0');

        for (const table of ACCOUNTING_TABLES) {
            if (!hasTable(db, table)) continue;
            if (!hasColumn(db, table, 'accounting_date')) continue;
            // Only empty values are filled; an operator-entered accounting date
            // is never overwritten.
            const hasSource = hasColumn(db, table, 'accounting_date_source');
            const sql = hasSource
                ? `UPDATE ${table}
                      SET accounting_date = date,
                          accounting_date_source = CASE
                              WHEN COALESCE(accounting_date_source, '') = '' THEN 'migrated'
                              ELSE accounting_date_source END
                    WHERE COALESCE(TRIM(accounting_date), '') = '' AND COALESCE(date, '') <> ''`
                : `UPDATE ${table} SET accounting_date = date
                    WHERE COALESCE(TRIM(accounting_date), '') = '' AND COALESCE(date, '') <> ''`;
            const info = db.prepare(sql).run();
            report.backfilled[table] = info.changes;
            if (info.changes > 0) report.already_current = false;
        }

        // Historical expenses were paid when they were recorded; treating that
        // as the paid amount creates no payable and changes no total.
        if (hasTable(db, 'other_expenses') && hasColumn(db, 'other_expenses', 'paid_amount')) {
            db.prepare(`UPDATE other_expenses SET paid_amount = amount
                         WHERE paid_amount IS NULL`).run();
        }

        // Exact, unique party-name link. No fuzzy matching, no guessing.
        if (hasTable(db, 'parties')) {
            for (const table of ['petty_cash', 'other_expenses']) {
                if (!hasTable(db, table) || !hasColumn(db, table, 'party_id')) continue;
                const rows = db.prepare(
                    `SELECT id, paid_to FROM ${table}
                      WHERE party_id IS NULL AND COALESCE(TRIM(paid_to), '') <> ''`
                ).all();
                const find = db.prepare(
                    'SELECT id FROM parties WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))'
                );
                const link = db.prepare(`UPDATE ${table} SET party_id = ? WHERE id = ?`);
                for (const r of rows) {
                    const hits = find.all(r.paid_to);
                    if (hits.length === 1) {
                        link.run(hits[0].id, r.id);
                        report.linked_parties[table]++;
                    } else {
                        db.prepare(`UPDATE ${table} SET party_review = 1 WHERE id = ?`).run(r.id);
                        report.flagged_for_review[table]++;
                    }
                }
            }
        }
    });
    tx();
    return report;
}

/**
 * Resolve a party id from an explicit id or an exact unique `paid_to` name.
 * @returns {{party_id: number|null, review: number}}
 */
function resolveParty(db, { party_id, paid_to } = {}) {
    if (party_id) {
        const hit = db.prepare('SELECT id FROM parties WHERE id = ?').get(party_id);
        return hit ? { party_id: hit.id, review: 0 } : { party_id: null, review: 1 };
    }
    const name = String(paid_to || '').trim();
    if (!name) return { party_id: null, review: 0 };
    const hits = db.prepare(
        'SELECT id FROM parties WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))'
    ).all(name);
    if (hits.length === 1) return { party_id: hits[0].id, review: 0 };
    return { party_id: null, review: 1 };
}

/**
 * Read-only audit: which documents still need a period or party decision.
 * Used by the integrity doctor and the release verification.
 */
function getDateReviewReport(db) {
    const out = { tables: {}, totals: { rows: 0, moved_to_another_period: 0, party_review: 0 } };
    for (const table of ACCOUNTING_TABLES) {
        if (!hasTable(db, table) || !hasColumn(db, table, 'accounting_date')) continue;
        const row = db.prepare(`SELECT COUNT(*) n,
                COALESCE(SUM(CASE WHEN accounting_date <> date THEN 1 ELSE 0 END), 0) moved,
                COALESCE(SUM(CASE WHEN COALESCE(TRIM(accounting_date), '') = '' THEN 1 ELSE 0 END), 0) missing
            FROM ${table}`).get();
        out.tables[table] = { rows: row.n, moved_to_another_period: row.moved, missing: row.missing };
        out.totals.rows += row.n;
        out.totals.moved_to_another_period += row.moved;
    }
    for (const table of ['petty_cash', 'other_expenses']) {
        if (!hasTable(db, table) || !hasColumn(db, table, 'party_review')) continue;
        const n = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE party_review = 1`).get().n;
        out.tables[table] = { ...(out.tables[table] || {}), party_review: n };
        out.totals.party_review += n;
    }
    return out;
}

module.exports = {
    ACCOUNTING_TABLES,
    hasColumn,
    hasTable,
    acctDateExpr,
    periodOf,
    normalizeDates,
    ensureAccountingDates,
    resolveParty,
    getDateReviewReport
};
