/**
 * Prarambha Account & Stock Management — Other Expenses Operations
 * ================================================
 * CRUD for other expenses register.
 *
 * Used by both Electron (main.js) and Web (server.js).
 *
 * NOTE: Petty Cash entries are surfaced here as "Petty Cash" category rows.
 * Both registers write to the same source (petty_cash + other_expenses) but the
 * Profit & Loss report reads other_expenses ONLY, so expenses created from the
 * Petty Cash tab are mirrored into other_expenses (category='Petty Cash') to
 * keep the P&L complete without double-counting.
 */

const { logAudit } = require('./audit');
const { round2 } = require('./accounting');
const accountingDates = require('./accounting_dates');
// One expense vocabulary for the whole app (Phase 3). The Expenses screen
// offers it as datalist suggestions so free-text categories converge on it.
const { EXPENSE_CATEGORIES } = require('./management_reports');

/**
 * List other expenses with optional filters.
 * Petty cash entries are included as rows with category = 'Petty Cash'
 * (read-only in this tab: they are managed from the Petty Cash register).
 */
function listOtherExpenses(db, { from_date, to_date, category, expense_head } = {}) {
    // Lazy migration (the app's existing pattern): a book opened by a tool that
    // skipped initDatabase still gets the accounting-date / party columns.
    try { accountingDates.ensureAccountingDates(db); } catch (e) { /* read-only book */ }
    let query = `
        SELECT oe.*, u.username as created_by_name, NULL as petty_cash_id
        FROM other_expenses oe LEFT JOIN users u ON oe.created_by = u.id
        WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND oe.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND oe.date <= ?"; params.push(to_date); }
    if (category) { query += " AND oe.category = ?"; params.push(category); }
    if (expense_head) { query += " AND (oe.expense_head LIKE ? OR oe.category LIKE ?)"; params.push(`%${expense_head}%`, `%${expense_head}%`); }
    query += " UNION ALL ";
    query += `
        SELECT pc.id as id, pc.date as date, pc.accounting_date as accounting_date,
               pc.accounting_date_source as accounting_date_source,
               'Petty Cash' as category,
               pc.expense_head as expense_head, pc.description as description,
               pc.amount as amount, pc.amount as paid_amount,
               'paid' as payment_status, pc.party_id as party_id,
               pc.party_review as party_review,
               pc.paid_to as paid_to,
               pc.payment_mode as payment_mode, pc.voucher_no as reference_no,
               pc.remarks as remarks, pc.created_by as created_by,
               pc.created_at as created_at, pc.updated_at as updated_at,
               u2.username as created_by_name, pc.id as petty_cash_id
        FROM petty_cash pc LEFT JOIN users u2 ON pc.created_by = u2.id
        WHERE UPPER(TRIM(COALESCE(pc.expense_head, ''))) != 'ADVANCE'`;
    // Advances are balance-sheet money-out (Advance tab), never expenses.
    if (from_date) { query += " AND pc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pc.date <= ?"; params.push(to_date); }
    if (category) { query += " AND 'Petty Cash' = ?"; params.push(category); }
    if (expense_head) { query += " AND pc.expense_head LIKE ?"; params.push(`%${expense_head}%`); }
    query += " ORDER BY date DESC, id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single expense entry.
 */
function getOtherExpense(db, id) {
    return db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
}

/**
 * Save an expense entry (create or update).
 */
function saveOtherExpense(db, data) {
    // Expense date = when the cost was incurred; accounting date = the period
    // it belongs to (rent received for October but banked in November).
    const dates = accountingDates.normalizeDates({
        date: data.date,
        accounting_date: data.accounting_date
    });
    const amount = round2(data.amount);
    const paidAmount = data.paid_amount === undefined || data.paid_amount === null || data.paid_amount === ''
        ? amount
        : round2(data.paid_amount);
    if (paidAmount < -0.005 || paidAmount > amount + 0.005) {
        throw new Error('Paid amount must be between 0 and the expense amount');
    }
    const paymentStatus = paidAmount <= 0.005 ? 'unpaid'
        : (paidAmount + 0.005 >= amount ? 'paid' : 'partial');
    const party = accountingDates.resolveParty(db, {
        party_id: data.party_id,
        paid_to: data.paid_to
    });

    const trx = db.transaction(() => {
        let id = data.id;
        if (id) {
            const oldEntry = db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
            db.prepare(`
                UPDATE other_expenses SET date=?, accounting_date=?, accounting_date_source=?,
                    category=?, expense_head=?, description=?, amount=?, paid_amount=?,
                    payment_status=?, party_id=?, party_review=?, paid_to=?, payment_mode=?,
                    reference_no=?, remarks=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                dates.date, dates.accounting_date, dates.source,
                data.category, data.expense_head, data.description || '',
                amount, paidAmount, paymentStatus, party.party_id, party.review,
                data.paid_to || '', data.payment_mode || 'cash',
                data.reference_no || '', data.remarks || '', id
            );
            logAudit(db, 'other_expenses', id, 'update', oldEntry, data, data.created_by);
        } else {
            const result = db.prepare(`
                INSERT INTO other_expenses (date, accounting_date, accounting_date_source,
                    category, expense_head, description, amount, paid_amount, payment_status,
                    party_id, party_review, paid_to, payment_mode, reference_no, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                dates.date, dates.accounting_date, dates.source,
                data.category, data.expense_head, data.description || '',
                amount, paidAmount, paymentStatus, party.party_id, party.review,
                data.paid_to || '', data.payment_mode || 'cash',
                data.reference_no || '', data.remarks || '', data.created_by || null
            );
            id = result.lastInsertRowid;
            logAudit(db, 'other_expenses', id, 'create', null, data, data.created_by);
        }

        // A party-linked expense posts to that party's account: the bill is the
        // credit (payable), the money already paid is the debit (settlement).
        // A later payment through the Payment module adds its own debit — the
        // expense itself is never posted twice and never counted twice in P&L.
        postExpenseLedger(db, id, {
            party_id: party.party_id,
            date: dates.date,
            accounting_date: dates.accounting_date,
            amount,
            paid_amount: paidAmount,
            head: data.expense_head,
            reference_no: data.reference_no || '',
            mode: data.payment_mode || 'cash',
            category: data.category
        });

        return { id };
    });
    return trx();
}

/** Ledger rows for a party-linked expense (stable reference prefix 'EXPENSE:'). */
function postExpenseLedger(db, expenseId, e) {
    db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'EXPENSE:%'")
        .run(expenseId);
    if (!e.party_id) return;
    // Income rows are money in, never a supplier payable.
    if (isIncomeCategory(e.category)) return;
    const ref = e.reference_no ? ` ${e.reference_no}` : '';
    db.prepare(
        "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, 0, ?, 0)"
    ).run(e.party_id, e.date, e.accounting_date, expenseId,
          `EXPENSE: ${e.head}${ref} (bill)`, e.amount);
    if (e.paid_amount > 0.005) {
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, accounting_date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, ?, 'adjustment', ?, ?, ?, 0, 0)"
        ).run(e.party_id, e.date, e.accounting_date, expenseId,
              `EXPENSE: ${e.head}${ref} (paid ${e.mode})`, e.paid_amount);
    }
}

/**
 * Delete an expense entry.
 * Petty-cash rows surfaced in this tab live only in petty_cash — if the id is
 * not found in other_expenses, try petty_cash so deletion works from either tab.
 */
function deleteOtherExpense(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM other_expenses WHERE id = ?").get(id);
    if (oldEntry) {
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'EXPENSE:%'")
            .run(id);
        db.prepare("DELETE FROM other_expenses WHERE id = ?").run(id);
        logAudit(db, 'other_expenses', id, 'delete', oldEntry, null, changedBy);
        return { deleted: true };
    }
    const oldPc = db.prepare("SELECT * FROM petty_cash WHERE id = ?").get(id);
    if (oldPc) {
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'adjustment' AND reference_id = ? AND description LIKE 'PETTY:%'")
            .run(id);
        db.prepare("DELETE FROM petty_cash WHERE id = ?").run(id);
        logAudit(db, 'petty_cash', id, 'delete', oldPc, null, changedBy);
        return { deleted: true, petty_cash: true };
    }
    return { deleted: false, error: 'Entry not found' };
}

/**
 * Get expense categories list.
 * Rows: { category, used } — `used`=1 when the register actually has rows in
 * that category. The shared EXPENSE_CATEGORIES vocabulary is always present
 * (so the New Expense datalist suggests it), plus any legacy category the data
 * still uses. Includes the virtual 'Petty Cash' category when petty rows exist.
 */
function getExpenseCategories(db) {
    const usedRows = db.prepare(`
        SELECT DISTINCT category FROM (SELECT DISTINCT category FROM other_expenses WHERE category != ''
        UNION SELECT 'Petty Cash' WHERE EXISTS (SELECT 1 FROM petty_cash WHERE UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'))
    `).all();
    const used = new Set(usedRows.map(r => String(r.category).trim()));
    const rows = [];
    const seen = new Set();
    const push = (cat, isUsed) => {
        const key = String(cat).trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        rows.push({ category: key, used: isUsed ? 1 : 0 });
    };
    for (const c of used) push(c, true);
    for (const c of EXPENSE_CATEGORIES) push(c, used.has(c));
    rows.sort((a, b) => (b.used - a.used) || a.category.localeCompare(b.category));
    return rows;
}

/**
 * Rows entered in this register with an income category (rent received,
 * scrap sale, commission) are INCOME, not expense. They are kept in the same
 * table so one screen can record both, but they must never be added to an
 * expense total — that would understate profit twice.
 */
const INCOME_CATEGORY_SQL = `UPPER(TRIM(COALESCE(category, ''))) IN ('INCOME', 'OTHER INCOME', 'RENT RECEIVED', 'RENT INCOME', 'INTEREST RECEIVED')`;

/** True when a register row is income rather than expense. */
function isIncomeCategory(category) {
    const c = String(category || '').trim().toUpperCase();
    return ['INCOME', 'OTHER INCOME', 'RENT RECEIVED', 'RENT INCOME', 'INTEREST RECEIVED'].indexOf(c) !== -1;
}

/**
 * Get expenses summary by category.
 * Includes petty cash rows under the 'Petty Cash' category.
 * `total`/`count`/`by_category` cover EXPENSES only; income rows are returned
 * separately as `income_total` / `income_count`.
 */
function getExpensesSummary(db, { from_date, to_date } = {}) {
    try { accountingDates.ensureAccountingDates(db); } catch (e) { /* read-only book */ }
    // Expense breakdown is accrual-based: the accounting date decides the
    // period (see shared/operations/accounting_dates.js).
    const oAcct = accountingDates.acctDateExpr(db, 'other_expenses');
    const pcAcct = accountingDates.acctDateExpr(db, 'petty_cash');
    let query = `
        SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total FROM (
            SELECT amount, ${oAcct} AS date, category FROM other_expenses WHERE 1=1 AND NOT (${INCOME_CATEGORY_SQL})`;
    const params = [];
    if (from_date) { query += ` AND ${oAcct} >= ?`; params.push(from_date); }
    if (to_date) { query += ` AND ${oAcct} <= ?`; params.push(to_date); }
    query += ` UNION ALL SELECT amount, ${pcAcct} AS date, 'Petty Cash' as category FROM petty_cash WHERE UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'`;
    if (from_date) { query += ` AND ${pcAcct} >= ?`; params.push(from_date); }
    if (to_date) { query += ` AND ${pcAcct} <= ?`; params.push(to_date); }
    query += `)
    `;
    const total = db.prepare(query).get(...params);

    // Income rows counted separately, never inside the expense total.
    let incomeQuery = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(amount), 0) as total
        FROM other_expenses WHERE 1=1 AND (${INCOME_CATEGORY_SQL})`;
    const incomeParams = [];
    if (from_date) { incomeQuery += ` AND ${oAcct} >= ?`; incomeParams.push(from_date); }
    if (to_date) { incomeQuery += ` AND ${oAcct} <= ?`; incomeParams.push(to_date); }
    const income = db.prepare(incomeQuery).get(...incomeParams);

    let catQuery = `SELECT category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM (
        SELECT category, amount, ${oAcct} AS date FROM other_expenses WHERE 1=1 AND NOT (${INCOME_CATEGORY_SQL})`;
    const catParams = [];
    if (from_date) { catQuery += ` AND ${oAcct} >= ?`; catParams.push(from_date); }
    if (to_date) { catQuery += ` AND ${oAcct} <= ?`; catParams.push(to_date); }
    catQuery += ` UNION ALL SELECT 'Petty Cash' as category, amount, ${pcAcct} AS date FROM petty_cash WHERE UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'`;
    if (from_date) { catQuery += ` AND ${pcAcct} >= ?`; catParams.push(from_date); }
    if (to_date) { catQuery += ` AND ${pcAcct} <= ?`; catParams.push(to_date); }
    catQuery += " ) GROUP BY category ORDER BY total DESC";
    const byCategory = db.prepare(catQuery).all(...catParams);

    return {
        ...total,
        income_total: round2(income.total),
        income_count: income.count,
        by_category: byCategory
    };
}

module.exports = {
    listOtherExpenses, getOtherExpense, saveOtherExpense, deleteOtherExpense,
    getExpenseCategories, getExpensesSummary, isIncomeCategory,
    // Shared by the Excel importer so an imported party-linked expense posts
    // the exact same two statement rows as one typed in the app.
    postExpenseLedger
};
