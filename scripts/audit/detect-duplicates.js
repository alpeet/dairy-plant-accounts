/**
 * Detect duplicate financial rows — READ-ONLY REPORT (never deletes).
 * ============================================================
 * Groups rows per table by a content key (date + amount + party/reference
 * fields that exist in the schema) and prints each group with its ids,
 * references, txn_uids and created_at timestamps so a human can decide
 * whether a group is a genuine double-entry or two legitimate transactions
 * that happen to share date + amount.
 *
 * The database is opened with `readonly: true` — this script cannot modify,
 * delete or migrate anything.
 *
 * Usage:
 *   NODE_PATH="$PWD/node_modules" node scripts/audit/detect-duplicates.js [dbPath] [--json]
 */
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(2).filter(a => a !== '--json');
const asJson = process.argv.includes('--json');
const dbPath = args[0] || path.join(ROOT, 'data', 'dairy-plant.db');

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Candidate key columns per table (only columns that actually exist are used).
// Report columns are printed for the human reviewer (created_at matters:
// genuine double-submits land seconds apart).
const TABLE_SPECS = {
    bank_transactions: {
        key: ['date', 'amount', 'debit', 'credit', 'counterparty_name', 'description', 'bank_account', 'reference_no'],
        report: ['id', 'date', 'amount', 'reference_no', 'txn_uid', 'counterparty_name', 'description', 'bank_account', 'accounting_class', 'match_status', 'created_at']
    },
    cash_deposits: {
        key: ['date', 'amount', 'bank_name', 'account_no', 'reference_no'],
        report: ['id', 'date', 'deposit_no', 'amount', 'bank_name', 'account_no', 'reference_no', 'cash_source', 'deposit_mode', 'created_at']
    },
    payments: {
        key: ['date', 'amount', 'party_id', 'type', 'mode', 'transaction_type', 'reference_no', 'reference'],
        report: ['id', 'date', 'amount', 'party_id', 'type', 'mode', 'transaction_type', 'reference_type', 'reference_id', 'notes', 'created_at']
    },
    sales: {
        key: ['date', 'party_id', 'grand_total'],
        report: ['id', 'date', 'invoice_no', 'party_id', 'grand_total', 'paid_amount', 'payment_mode', 'created_at']
    },
    purchases: {
        key: ['date', 'party_id', 'grand_total'],
        report: ['id', 'date', 'invoice_no', 'party_id', 'grand_total', 'paid_amount', 'payment_mode', 'created_at']
    },
    other_expenses: {
        key: ['date', 'amount', 'description', 'category', 'payment_mode'],
        report: ['id', 'date', 'amount', 'category', 'description', 'payment_mode', 'created_at']
    },
    petty_cash: {
        key: ['date', 'amount', 'description'],
        report: ['id', 'date', 'amount', 'description', 'created_at']
    },
    salary_records: {
        key: ['month', 'employee_id', 'employee_name'],
        report: ['id', 'month', 'employee_id', 'employee_name', 'basic_salary', 'advance', 'voucher_no', 'payment_date', 'created_at']
    },
    ledger_entries: {
        key: ['party_id', 'date', 'debit', 'credit', 'reference_type', 'reference_id', 'description'],
        report: ['id', 'party_id', 'date', 'debit', 'credit', 'reference_type', 'reference_id', 'description', 'created_at']
    }
};

function columnsOf(table) {
    try {
        return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    } catch (e) {
        return new Set();
    }
}

const existingTables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name)
);

const output = { db: dbPath, scanned_at: new Date().toISOString(), tables: [], total_groups: 0, total_rows_in_groups: 0, note: 'READ-ONLY report — nothing was deleted. Groups are candidates: two legitimate transactions can share date+amount. Verify created_at + reference + source before any cleanup.' };

for (const [table, spec] of Object.entries(TABLE_SPECS)) {
    if (!existingTables.has(table)) continue;
    const have = columnsOf(table);
    const keyCols = spec.key.filter(c => have.has(c));
    const reportCols = spec.report.filter(c => have.has(c));
    if (keyCols.length < 2) {
        output.tables.push({ table, skipped: 'not enough key columns exist', key: keyCols });
        continue;
    }
    const keyExpr = keyCols.map(c => `COALESCE(CAST(${c} AS TEXT), '')`).join(" || '|' || ");
    const groups = db.prepare(`
        SELECT ${keyExpr} AS grp, COUNT(*) AS n
          FROM ${table}
         GROUP BY grp
        HAVING n > 1
         ORDER BY n DESC
    `).all();
    const detail = [];
    for (const g of groups) {
        const rows = db.prepare(
            `SELECT ${reportCols.join(', ')} FROM ${table} WHERE ${keyExpr} = ? ORDER BY id`
        ).all(g.grp);
        detail.push({ rows_in_group: g.n, rows });
    }
    output.tables.push({
        table,
        key_columns: keyCols,
        duplicate_groups: detail.length,
        rows_in_groups: detail.reduce((s, d) => s + d.rows_in_group, 0),
        groups: detail
    });
    output.total_groups += detail.length;
    output.total_rows_in_groups += detail.reduce((s, d) => s + d.rows_in_group, 0);
}

db.close();

if (asJson) {
    console.log(JSON.stringify(output, null, 2));
} else {
    console.log('Duplicate detection — READ-ONLY (nothing deleted)');
    console.log('DB: ' + output.db);
    console.log('');
    for (const t of output.tables) {
        if (t.skipped) { console.log(`— ${t.table}: skipped (${t.skipped})`); continue; }
        console.log(`=== ${t.table} — ${t.duplicate_groups} group(s), ${t.rows_in_groups} row(s) | key: ${t.key_columns.join(', ')}`);
        t.groups.forEach((g, gi) => {
            console.log(`  [${t.table} #${gi + 1}] ${g.rows_in_group} rows:`);
            for (const r of g.rows) {
                const parts = Object.entries(r).map(([k, v]) => `${k}=${v === null || v === '' ? '∅' : v}`);
                console.log('    ' + parts.join(' | '));
            }
        });
        console.log('');
    }
    console.log(`TOTAL: ${output.total_groups} candidate group(s), ${output.total_rows_in_groups} row(s).`);
    console.log('Groups are candidates only — verify reference/created_at/source before any manual cleanup.');
}
