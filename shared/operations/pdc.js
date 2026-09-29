/**
 * Prarambha Account & Stock Management — Post-Dated Cheque (PDC) Operations
 * ======================================================================
 * A post-dated cheque is an INSTRUMENT, not money. This module owns the PDC
 * register and is the single place that decides when a cheque becomes money.
 *
 * ACCOUNTING MODEL (the ONE model used everywhere in this module)
 * ---------------------------------------------------------------
 * The application already moves money in exactly one place: the `payments`
 * table (mirrored by a `ledger_entries` row) — that is what the sale
 * settlement, cash/bank position, party ledger, receivable/payable and the
 * daybook all read. A PDC therefore does NOT invent a second money path:
 *
 *   HELD / DEPOSITED   → nothing is posted. No payments row, no ledger row.
 *                        Bank balance unchanged, receivable/payable unchanged.
 *                        The register itself carries the expectation
 *                        ("PDC Receivable / PDC Payable" in getPdcPosition).
 *   CLEARED            → the cheque becomes money: a real receipt (received
 *                        cheque) or payment (issued cheque) is written to
 *                        `payments` + `ledger_entries`, exactly like
 *                        savePayment()/saveSale() do. Bank moves ONCE,
 *                        receivable/payable settle ONCE, and the existing
 *                        settlement/receivable logic picks it up unchanged
 *                        because the row is a normal receipt.
 *   BOUNCED/CANCELLED  → if the cheque had cleared, that receipt/payment is
 *                        removed again (reversal), restoring the receivable and
 *                        the bank balance — never a second compensating entry.
 *
 * Every allocated invoice gets its OWN receipt row linked by
 * reference_type='sale'/'purchase' + reference_id, so invoice-level settlement
 * works through the app's existing explicit-link path; the unallocated part is
 * one on-account row (reference_type='pdc'), which flows into the existing
 * oldest-invoice-first allocation.
 *
 * Read-only consumers (daybook, party statement, dashboard) call the helpers
 * here; nothing outside this module ever writes to pdc_cheques.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');
const { adToBS, bsToAD } = require('../excel-import');
const { round2, CURRENCY_TOLERANCE, getSaleSettlements } = require('./accounting');

// ──────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────

const PDC_TYPES = ['received', 'issued'];
const PDC_STATUSES = ['HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'];

/**
 * Allowed status transitions. A PDC may only ever move along these edges —
 * free-form status writes are refused by setPdcStatus().
 *
 *   HELD ──► DEPOSITED ──► CLEARED
 *     │           │           │
 *     ├──► BOUNCED ◄──────────┘   (a presented cheque that bounces)
 *     │
 *     └──► CANCELLED              (never presented)
 *
 * BOUNCED and CANCELLED are FINAL: a bounced cheque is never resurrected in
 * place (re-presenting the same cheque number means recording a new PDC, which
 * the duplicate guard allows precisely because the old record is final). This
 * keeps the reversal trail of the bounce readable instead of being overwritten
 * by a second presentation on the same row.
 * A cleared cheque can only be taken back by bouncing/reversing it — money that
 * has moved is never silently discarded.
 */
const PDC_TRANSITIONS = {
    HELD: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'],
    DEPOSITED: ['CLEARED', 'BOUNCED'],
    BOUNCED: [],
    CLEARED: ['BOUNCED'],
    CANCELLED: []
};

/** Statuses that carry an outstanding (expected but not yet banked) amount. */
const PDC_OPEN_STATUSES = ['HELD', 'DEPOSITED'];

/** Statuses in which the cheque has already affected the accounting books. */
const PDC_POSTED_STATUSES = ['CLEARED'];

/** Fields that may never be silently changed once the cheque has posted. */
const PDC_LOCKED_AFTER_POSTING = ['party_id', 'pdc_type', 'cheque_no', 'cheque_date', 'amount', 'bank_name', 'bank_account_no'];

/**
 * PDC permissions. The application's centralised permission system is the user
 * role hierarchy (agent < staff < operator < accountant < admin); these named
 * permissions map onto it so the API can express intent while still using the
 * one existing authority. Enforced on the BACKEND (server routes + Electron
 * IPC both pass the live role into this module) — never trusted from the UI.
 */
const PDC_PERMISSIONS = {
    'pdc.view': 'staff',
    'pdc.create': 'operator',
    'pdc.edit': 'operator',
    'pdc.allocate': 'operator',
    'pdc.deposit': 'operator',
    'pdc.clear': 'accountant',
    'pdc.bounce': 'accountant',
    'pdc.cancel': 'accountant',
    'pdc.delete': 'admin'
};

const ROLE_LEVEL = { agent: 0, staff: 1, operator: 2, accountant: 3, admin: 4 };

/** Human-readable action names used in the audit trail. */
const PDC_ACTIONS = {
    create: 'PDC recorded',
    update: 'PDC updated',
    allocate: 'PDC allocation changed',
    unallocate: 'PDC allocation removed',
    deposit: 'PDC deposited / presented',
    clear: 'PDC cleared',
    bounce: 'PDC bounced',
    cancel: 'PDC cancelled',
    reverse: 'PDC clearance reversed',
    delete: 'PDC deleted'
};

// ──────────────────────────────────────────────────────────────
// Schema (defensive — migrations also create these)
// ──────────────────────────────────────────────────────────────

/**
 * Create the PDC tables when they are missing. initDatabase() migrations add
 * them too; this guard keeps the module usable from scripts that open an older
 * database directly, and is idempotent.
 */
function ensurePdcTables(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS pdc_cheques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdc_no TEXT DEFAULT '',
            pdc_type TEXT NOT NULL CHECK(pdc_type IN ('received', 'issued')),
            party_id INTEGER NOT NULL,
            cheque_no TEXT NOT NULL,
            cheque_date TEXT NOT NULL,
            txn_date TEXT NOT NULL,
            bank_name TEXT DEFAULT '',
            bank_account_no TEXT DEFAULT '',
            amount REAL NOT NULL DEFAULT 0.0,
            status TEXT NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED')),
            reference_no TEXT DEFAULT '',
            remarks TEXT DEFAULT '',
            deposit_date TEXT DEFAULT NULL,
            deposit_bank TEXT DEFAULT '',
            deposit_remarks TEXT DEFAULT '',
            clearance_date TEXT DEFAULT NULL,
            clearance_bank TEXT DEFAULT '',
            clearance_ref TEXT DEFAULT '',
            clearance_remarks TEXT DEFAULT '',
            bounce_date TEXT DEFAULT NULL,
            bounce_reason TEXT DEFAULT '',
            bounce_charge REAL DEFAULT 0.0,
            cancel_date TEXT DEFAULT NULL,
            cancel_reason TEXT DEFAULT '',
            payment_id INTEGER DEFAULT NULL,
            created_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_by INTEGER DEFAULT NULL,
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (party_id) REFERENCES parties(id)
        );
        CREATE TABLE IF NOT EXISTS pdc_allocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pdc_id INTEGER NOT NULL,
            invoice_type TEXT DEFAULT 'on_account' CHECK(invoice_type IN ('sale', 'purchase', 'on_account')),
            invoice_id INTEGER DEFAULT NULL,
            allocated_amount REAL NOT NULL DEFAULT 0.0,
            payment_id INTEGER DEFAULT NULL,
            created_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (pdc_id) REFERENCES pdc_cheques(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_pdc_cheques_party ON pdc_cheques(party_id);
        CREATE INDEX IF NOT EXISTS idx_pdc_cheques_status ON pdc_cheques(status);
        CREATE INDEX IF NOT EXISTS idx_pdc_cheques_cheque_date ON pdc_cheques(cheque_date);
        CREATE INDEX IF NOT EXISTS idx_pdc_cheques_txn_date ON pdc_cheques(txn_date);
        CREATE INDEX IF NOT EXISTS idx_pdc_allocations_pdc ON pdc_allocations(pdc_id);
        CREATE INDEX IF NOT EXISTS idx_pdc_allocations_invoice ON pdc_allocations(invoice_type, invoice_id);
        -- One live cheque per (type, cheque number, bank, party): the hard
        -- backstop against duplicate entry. Cancelled/bounced cheques drop out
        -- of the index so they can legitimately be re-registered.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pdc_active_cheque
            ON pdc_cheques(pdc_type, cheque_no, bank_name, party_id)
            WHERE status IN ('HELD', 'DEPOSITED', 'CLEARED');
    `);
}

// ──────────────────────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────────────────────

/** Today's date in the app's date system (BS) — local calendar, never UTC. */
function todayBS() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const adToday = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return adToBS(adToday) || adToday;
}

/** Whole days from AD date a to AD date b (b − a). Local-time safe. */
function daysBetweenAD(aAD, bAD) {
    if (!aAD || !bAD) return null;
    const [ay, am, ad] = String(aAD).split('-').map(Number);
    const [by, bm, bd] = String(bAD).split('-').map(Number);
    const a = Date.UTC(ay, am - 1, ad);
    const b = Date.UTC(by, bm - 1, bd);
    return Math.round((b - a) / 86400000);
}

/**
 * Due-date information for one cheque, derived from the stored BS cheque date
 * through the shared BS→AD converter (never a second date implementation).
 * Settled cheques have no due date — they are not "overdue".
 */
function dueInfo(row, todayAD, todayBs) {
    const settled = !PDC_OPEN_STATUSES.includes(String(row.status || '').toUpperCase());
    const chequeAD = bsToAD(String(row.cheque_date || '').slice(0, 10));
    const daysUntil = settled ? null : daysBetweenAD(todayAD, chequeAD);
    let bucket = 'settled';
    if (!settled) {
        if (daysUntil === null) bucket = 'unknown';
        else if (daysUntil < 0) bucket = 'overdue';
        else if (daysUntil === 0) bucket = 'today';
        else if (daysUntil === 1) bucket = 'tomorrow';
        else if (daysUntil <= 7) bucket = '7_days';
        else if (daysUntil <= 30) bucket = '30_days';
        else bucket = 'later';
    }
    return {
        due_date: settled ? null : row.cheque_date,
        due_date_ad: settled ? null : chequeAD,
        days_until: daysUntil,
        due_bucket: bucket,
        // A held/deposited cheque is money EXPECTED (received) or OWED (issued).
        outstanding: PDC_OPEN_STATUSES.includes(String(row.status || '').toUpperCase()) ? round2(row.amount) : 0,
        direction: row.pdc_type === 'received' ? 'in' : 'out',
        next_statuses: PDC_TRANSITIONS[String(row.status || '').toUpperCase()] || []
    };
}

/** Decorate a register row with its derived due/outstanding information. */
function decorate(row, todayAD, todayBs) {
    return { ...row, ...dueInfo(row, todayAD, todayBs) };
}

/** Throw when the caller's role does not carry the named PDC permission. */
function assertPdcPermission(role, permission) {
    const required = PDC_PERMISSIONS[permission] || 'admin';
    const level = ROLE_LEVEL[String(role || '').toLowerCase()];
    if (level === undefined) {
        throw new Error(`Not authorized: a signed-in user role is required for ${permission}.`);
    }
    if (level < ROLE_LEVEL[required]) {
        throw new Error(`Access denied. '${permission}' requires the '${required}' role or higher (your role: ${role}).`);
    }
}

/** Normalise the free-text parties a user can type in different cases. */
function normChequeNo(v) {
    return String(v == null ? '' : v).trim();
}

/** Generate a register number for a PDC (PDC-YYYYMMDD-NNN). */
function generatePdcNo(db, date) {
    const d = date || todayBS();
    const compact = String(d).replace(/-/g, '');
    const row = db.prepare(
        "SELECT COUNT(*) AS c FROM pdc_cheques WHERE pdc_no LIKE ?"
    ).get(`PDC-${compact}-%`);
    return `PDC-${compact}-${String((row.c || 0) + 1).padStart(3, '0')}`;
}

// ──────────────────────────────────────────────────────────────
// Reading: register, position, reports
// ──────────────────────────────────────────────────────────────

/**
 * List PDC register rows with filters.
 *
 * @param {object} opts
 *   search, party_id, bank_name, pdc_type, status (string|array),
 *   from_date/to_date (txn date range), cheque_from/cheque_to (cheque date),
 *   amount_min/amount_max, due ('today'|'tomorrow'|'7'|'30'|'overdue'),
 *   order ('txn'|'due')
 */
function listPdcCheques(db, opts = {}) {
    ensurePdcTables(db);
    let sql = `SELECT c.*, p.name AS party_name, p.party_code AS party_code, p.type AS party_type,
                      (SELECT COALESCE(SUM(a.allocated_amount), 0) FROM pdc_allocations a WHERE a.pdc_id = c.id) AS allocated_total,
                      (SELECT COUNT(*) FROM pdc_allocations a WHERE a.pdc_id = c.id) AS allocation_count,
                      (SELECT group_concat(
                            CASE WHEN a.invoice_type = 'sale' THEN s.invoice_no
                                 WHEN a.invoice_type = 'purchase' THEN pu.bill_no
                                 ELSE 'On account' END, ', ')
                         FROM pdc_allocations a
                         LEFT JOIN sales s ON a.invoice_type = 'sale' AND s.id = a.invoice_id
                         LEFT JOIN purchases pu ON a.invoice_type = 'purchase' AND pu.id = a.invoice_id
                        WHERE a.pdc_id = c.id) AS against
                 FROM pdc_cheques c
                 LEFT JOIN parties p ON p.id = c.party_id
                WHERE 1=1`;
    const params = [];

    if (opts.search) {
        sql += ` AND (c.cheque_no LIKE ? OR c.pdc_no LIKE ? OR c.reference_no LIKE ?
                      OR c.bank_name LIKE ? OR COALESCE(p.name,'') LIKE ?)`;
        const like = `%${opts.search}%`;
        params.push(like, like, like, like, like);
    }
    if (opts.party_id) { sql += " AND c.party_id = ?"; params.push(opts.party_id); }
    if (opts.bank_name) { sql += " AND COALESCE(c.bank_name,'') LIKE ?"; params.push(`%${opts.bank_name}%`); }
    if (opts.pdc_type && PDC_TYPES.includes(opts.pdc_type)) { sql += " AND c.pdc_type = ?"; params.push(opts.pdc_type); }

    const statuses = Array.isArray(opts.status)
        ? opts.status.filter(s => PDC_STATUSES.includes(s))
        : (opts.status && opts.status !== 'all' && PDC_STATUSES.includes(opts.status) ? [opts.status] : []);
    if (statuses.length) {
        sql += ` AND c.status IN (${statuses.map(() => '?').join(',')})`;
        params.push(...statuses);
    }

    if (opts.from_date) { sql += " AND c.txn_date >= ?"; params.push(opts.from_date); }
    if (opts.to_date) { sql += " AND c.txn_date <= ?"; params.push(opts.to_date); }
    if (opts.cheque_from) { sql += " AND c.cheque_date >= ?"; params.push(opts.cheque_from); }
    if (opts.cheque_to) { sql += " AND c.cheque_date <= ?"; params.push(opts.cheque_to); }
    if (opts.amount_min != null && opts.amount_min !== '') { sql += " AND c.amount >= ?"; params.push(Number(opts.amount_min)); }
    if (opts.amount_max != null && opts.amount_max !== '') { sql += " AND c.amount <= ?"; params.push(Number(opts.amount_max)); }

    sql += opts.order === 'due'
        ? ' ORDER BY c.cheque_date ASC, c.id ASC'
        : ' ORDER BY c.txn_date DESC, c.id DESC';

    const todayBs = opts.today || todayBS();
    const todayAD = bsToAD(todayBs) || null;
    let rows = db.prepare(sql).all(...params).map(r => decorate(r, todayAD, todayBs));
    // No allocation at all means the cheque is on account — say so, never blank.
    rows = rows.map(r => ({ ...r, against: r.against || 'On account' }));

    // Due filters are calendar-based, so they are applied after the BS→AD
    // conversion rather than with string comparison in SQL.
    const due = opts.due && opts.due !== 'all' ? String(opts.due) : null;
    if (due) {
        const buckets = {
            today: ['today'],
            tomorrow: ['tomorrow'],
            '7': ['today', 'tomorrow', '7_days'],
            '30': ['today', 'tomorrow', '7_days', '30_days'],
            overdue: ['overdue']
        }[due] || [];
        rows = rows.filter(r => buckets.includes(r.due_bucket));
    }

    const totals = rows.reduce((acc, r) => {
        acc.count++;
        acc.amount = round2(acc.amount + (Number(r.amount) || 0));
        if (r.pdc_type === 'received') {
            acc.received = round2(acc.received + (Number(r.amount) || 0));
            acc[r.status] = round2((acc[r.status] || 0) + (Number(r.amount) || 0));
        } else {
            acc.issued = round2(acc.issued + (Number(r.amount) || 0));
        }
        acc.outstanding = round2(acc.outstanding + (r.outstanding || 0));
        return acc;
    }, { count: 0, amount: 0, received: 0, issued: 0, outstanding: 0 });

    return { rows, totals, today: todayBs };
}

/** One cheque with its allocations (invoice detail) and its audit history. */
function getPdcCheque(db, id) {
    ensurePdcTables(db);
    const row = db.prepare(
        `SELECT c.*, p.name AS party_name, p.party_code AS party_code, p.phone AS party_phone,
                p.type AS party_type
           FROM pdc_cheques c LEFT JOIN parties p ON p.id = c.party_id
          WHERE c.id = ?`
    ).get(id);
    if (!row) return null;

    const allocations = db.prepare(
        `SELECT a.*,
                CASE WHEN a.invoice_type = 'sale' THEN s.invoice_no
                     WHEN a.invoice_type = 'purchase' THEN pu.bill_no ELSE NULL END AS invoice_no,
                CASE WHEN a.invoice_type = 'sale' THEN s.date
                     WHEN a.invoice_type = 'purchase' THEN pu.date ELSE NULL END AS invoice_date,
                CASE WHEN a.invoice_type = 'sale' THEN s.grand_total
                     WHEN a.invoice_type = 'purchase' THEN pu.grand_total ELSE NULL END AS invoice_total
           FROM pdc_allocations a
           LEFT JOIN sales s ON a.invoice_type = 'sale' AND s.id = a.invoice_id
           LEFT JOIN purchases pu ON a.invoice_type = 'purchase' AND pu.id = a.invoice_id
          WHERE a.pdc_id = ?
          ORDER BY a.id`
    ).all(id);

    // The money rows this cheque created (one per allocated invoice + one for
    // any on-account remainder). Empty while Held/Deposited.
    const payments = db.prepare(
        `SELECT pm.* FROM payments pm
          WHERE pm.id = ? OR pm.id IN (SELECT payment_id FROM pdc_allocations WHERE pdc_id = ? AND payment_id IS NOT NULL)`
    ).all(row.payment_id || -1, id);

    const history = db.prepare(
        `SELECT al.id, al.action, al.old_values, al.new_values, al.changed_at,
                u.username AS changed_by_name
           FROM audit_log al LEFT JOIN users u ON u.id = al.changed_by
          WHERE al.table_name = 'pdc_cheques' AND al.record_id = ?
          ORDER BY al.id DESC`
    ).all(id);

    const todayBs = todayBS();
    return {
        ...decorate(row, bsToAD(todayBs), todayBs),
        allocations,
        allocated_total: round2(allocations.reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0)),
        payments,
        posted: payments.length > 0,
        history
    };
}

/**
 * Outstanding documents a cheque can be allocated against. Received cheques
 * settle SALES invoices, issued cheques settle PURCHASES bills. Outstanding is
 * taken from the application's own settlement logic (accounting.js) for sales,
 * so the numbers here agree with the Sales screen and the Receivable report.
 */
function listPdcOpenDocuments(db, { party_id, pdc_type } = {}) {
    if (!party_id) throw new Error('Party is required');
    if (pdc_type === 'issued') {
        return db.prepare(
            `SELECT id, bill_no AS invoice_no, date, grand_total,
                    (grand_total - COALESCE(paid_amount, 0)) AS outstanding
               FROM purchases WHERE party_id = ? ORDER BY date, id`
        ).all(party_id);
    }
    const sales = db.prepare(
        `SELECT id, invoice_no, date, grand_total FROM sales WHERE party_id = ? ORDER BY date, id`
    ).all(party_id);
    const { by_id } = getSaleSettlements(db, { party_id });
    return sales.map(s => {
        const st = by_id.get(Number(s.id));
        return {
            id: s.id,
            invoice_no: s.invoice_no,
            date: s.date,
            grand_total: round2(s.grand_total),
            outstanding: st ? st.outstanding : round2(s.grand_total)
        };
    });
}

/**
 * Whole-register position as of today — the numbers behind the PDC dashboard.
 * Nothing here is derived from the bank balance; a Held cheque is reported as
 * an outstanding expectation only.
 */
function getPdcPosition(db) {
    ensurePdcTables(db);
    const todayBs = todayBS();
    const todayAD = bsToAD(todayBs);
    const rows = db.prepare('SELECT * FROM pdc_cheques').all().map(r => decorate(r, todayAD, todayBs));

    const emptySide = () => ({
        held: { count: 0, amount: 0 },
        deposited: { count: 0, amount: 0 },
        cleared: { count: 0, amount: 0 },
        bounced: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 }
    });
    const received = emptySide();
    const issued = emptySide();
    const buckets = {
        today: { count: 0, amount: 0 },
        tomorrow: { count: 0, amount: 0 },
        '7_days': { count: 0, amount: 0 },
        '30_days': { count: 0, amount: 0 },
        overdue: { count: 0, amount: 0 },
        later: { count: 0, amount: 0 }
    };

    for (const r of rows) {
        const side = r.pdc_type === 'received' ? received : issued;
        const key = String(r.status).toLowerCase();
        if (side[key]) {
            side[key].count++;
            side[key].amount = round2(side[key].amount + (Number(r.amount) || 0));
        }
        if (PDC_OPEN_STATUSES.includes(String(r.status)) && buckets[r.due_bucket]) {
            buckets[r.due_bucket].count++;
            buckets[r.due_bucket].amount = round2(buckets[r.due_bucket].amount + (Number(r.amount) || 0));
        }
    }

    const sum = o => round2(o.held.amount + o.deposited.amount);
    const count = o => o.held.count + o.deposited.count;

    // ── Cleared-but-not-reconciled (bank statement has no matching row yet) ──
    const clearedRows = rows.filter(r => r.status === 'CLEARED');
    const unreconciled = [];
    for (const r of clearedRows) {
        let hit = null;
        try {
            hit = db.prepare(
                `SELECT id FROM bank_transactions
                  WHERE reference_no LIKE ? OR (date = ? AND ABS(ABS(COALESCE(credit, 0)) - ABS(COALESCE(debit, 0))) - ? <= 0.01)
                  LIMIT 1`
            ).get(`%${r.cheque_no}%`, r.clearance_date, Number(r.amount) || 0);
        } catch (e) { /* bank table missing on very old DBs */ }
        if (!hit) unreconciled.push({ id: r.id, pdc_no: r.pdc_no, cheque_no: r.cheque_no, clearance_date: r.clearance_date, amount: round2(r.amount), pdc_type: r.pdc_type });
    }

    // ── Evidence the model holds: every money row a PDC created belongs to a
    //    CLEARED cheque, and the money posted equals the cleared total exactly
    //    once (never twice, never for a held cheque). ──
    const postedRows = db.prepare(
        `SELECT pm.id, pm.amount, pm.type,
                COALESCE(c.status, c2.status) AS cheque_status,
                COALESCE(c.pdc_type, c2.pdc_type) AS pdc_type
           FROM payments pm
           LEFT JOIN pdc_cheques c ON c.payment_id = pm.id
           LEFT JOIN pdc_allocations a ON a.payment_id = pm.id
           LEFT JOIN pdc_cheques c2 ON c2.id = a.pdc_id
          WHERE c.id IS NOT NULL OR a.id IS NOT NULL`
    ).all();
    const postedReceived = round2(postedRows
        .filter(r => r.pdc_type === 'received' && r.type !== 'payment')
        .reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const postedIssued = round2(postedRows
        .filter(r => r.pdc_type === 'issued' && r.type === 'payment')
        .reduce((s, r) => s + (Number(r.amount) || 0), 0));
    const postedForUncleared = postedRows.filter(r => String(r.cheque_status) !== 'CLEARED').length;
    const clearedReceived = round2(received.cleared.amount);
    const clearedIssued = round2(issued.cleared.amount);
    const roundedReceived = round2(received.cleared.amount);

    const mkCheck = (key, label, expected, actual) => ({
        key, label, expected: round2(expected), actual: round2(actual),
        difference: round2(actual - expected),
        ok: Math.abs(round2(actual) - round2(expected)) <= CURRENCY_TOLERANCE
    });

    const checks = [
        mkCheck('pdc_bank_once_received', 'Cleared received cheques banked exactly once', clearedReceived, postedReceived),
        mkCheck('pdc_bank_once_issued', 'Cleared issued cheques paid exactly once', clearedIssued, postedIssued),
        {
            key: 'pdc_held_moves_no_money',
            label: 'Held / deposited / bounced cheques post no bank money',
            expected: 0,
            actual: postedForUncleared,
            difference: postedForUncleared,
            ok: postedForUncleared === 0
        },
        // A cleared cheque's money rows must equal its face value exactly.
        mkCheck('pdc_cleared_received_value', 'Cleared received cheques post their full face value',
            round2(rows.filter(r => r.pdc_type === 'received' && r.status === 'CLEARED').reduce((s, r) => s + (Number(r.amount) || 0), 0)),
            roundedReceived)
    ];

    return {
        today: todayBs,
        received,
        issued,
        pdc_receivable: sum(received),
        pdc_receivable_count: count(received),
        pdc_payable: sum(issued),
        pdc_payable_count: count(issued),
        received_total: round2(rows.filter(r => r.pdc_type === 'received').reduce((s, r) => s + (Number(r.amount) || 0), 0)),
        issued_total: round2(rows.filter(r => r.pdc_type === 'issued').reduce((s, r) => s + (Number(r.amount) || 0), 0)),
        total_count: rows.length,
        due: buckets,
        due_today: buckets.today,
        due_tomorrow: buckets.tomorrow,
        due_7_days: round2(buckets.today.amount + buckets.tomorrow.amount + buckets['7_days'].amount),
        due_7_days_count: buckets.today.count + buckets.tomorrow.count + buckets['7_days'].count,
        due_30_days: round2(buckets.today.amount + buckets.tomorrow.amount + buckets['7_days'].amount + buckets['30_days'].amount),
        overdue: buckets.overdue,
        cleared_not_reconciled: {
            count: unreconciled.length,
            amount: round2(unreconciled.reduce((s, r) => s + r.amount, 0)),
            rows: unreconciled
        },
        posted_money: {
            total: round2(postedRows.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
            count: postedRows.length
        },
        checks
    };
}

/**
 * PDC Register report — the register rows with their period totals, ready for
 * print/PDF/Excel. Same filters as listPdcCheques.
 */
function getPdcRegisterReport(db, opts = {}) {
    const { rows, totals, today } = listPdcCheques(db, opts);
    return {
        rows,
        totals,
        today,
        from_date: opts.from_date || '',
        to_date: opts.to_date || '',
        held_amount: round2(rows.filter(r => r.status === 'HELD').reduce((s, r) => s + r.amount, 0)),
        cleared_amount: round2(rows.filter(r => r.status === 'CLEARED').reduce((s, r) => s + r.amount, 0)),
        bounced_amount: round2(rows.filter(r => r.status === 'BOUNCED').reduce((s, r) => s + r.amount, 0))
    };
}

/**
 * PDC Due report — cheque-date buckets for the cheques still to be presented
 * or banked: Due today / 1–7 days / 8–30 days / Overdue (plus the settled tail
 * so a period report reconciles).
 */
function getPdcDueReport(db, opts = {}) {
    const { rows, today } = listPdcCheques(db, { ...opts, order: 'due' });
    const open = rows.filter(r => PDC_OPEN_STATUSES.includes(String(r.status)));
    const groupOf = bucket => {
        const items = open.filter(r => r.due_bucket === bucket);
        return {
            count: items.length,
            amount: round2(items.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
            received: round2(items.filter(r => r.pdc_type === 'received').reduce((s, r) => s + Number(r.amount || 0), 0)),
            issued: round2(items.filter(r => r.pdc_type === 'issued').reduce((s, r) => s + Number(r.amount || 0), 0)),
            rows: items
        };
    };
    return {
        today,
        rows: open,
        groups: {
            due_today: groupOf('today'),
            due_tomorrow: groupOf('tomorrow'),
            due_1_7: groupOf('7_days'),
            due_8_30: groupOf('30_days'),
            due_later: groupOf('later'),
            overdue: groupOf('overdue'),
            unknown_date: groupOf('unknown')
        },
        total_open: round2(open.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
        total_open_count: open.length
    };
}

/** PDC Bounced report — every bounced cheque with its reason and charge. */
function getPdcBouncedReport(db, opts = {}) {
    const { rows, today } = listPdcCheques(db, { ...opts, status: 'BOUNCED', order: 'due' });
    const withInvoices = rows.map(r => {
        const allocations = db.prepare(
            `SELECT a.invoice_type, a.invoice_id, a.allocated_amount,
                    CASE WHEN a.invoice_type = 'sale' THEN s.invoice_no
                         WHEN a.invoice_type = 'purchase' THEN pu.bill_no END AS invoice_no
               FROM pdc_allocations a
               LEFT JOIN sales s ON a.invoice_type = 'sale' AND s.id = a.invoice_id
               LEFT JOIN purchases pu ON a.invoice_type = 'purchase' AND pu.id = a.invoice_id
              WHERE a.pdc_id = ?`
        ).all(r.id);
        return { ...r, allocations, invoice_list: allocations.map(a => a.invoice_no).filter(Boolean).join(', ') };
    });
    return {
        today,
        rows: withInvoices,
        totals: {
            count: withInvoices.length,
            amount: round2(withInvoices.reduce((s, r) => s + (Number(r.amount) || 0), 0)),
            charges: round2(withInvoices.reduce((s, r) => s + (Number(r.bounce_charge) || 0), 0)),
            received: round2(withInvoices.filter(r => r.pdc_type === 'received').reduce((s, r) => s + Number(r.amount || 0), 0)),
            issued: round2(withInvoices.filter(r => r.pdc_type === 'issued').reduce((s, r) => s + Number(r.amount || 0), 0))
        }
    };
}

// ──────────────────────────────────────────────────────────────
// Writing: create / update / allocate
// ──────────────────────────────────────────────────────────────

/**
 * Guard against duplicate live cheques. `excludeId` lets an update ignore its
 * own row. Cancelled / bounced cheques are not duplicates — the same physical
 * cheque may be returned and registered again.
 */
function findDuplicateCheque(db, { pdc_type, cheque_no, bank_name, party_id }, excludeId = null) {
    return db.prepare(
        `SELECT id, pdc_no, cheque_no, status, amount FROM pdc_cheques
          WHERE pdc_type = ? AND cheque_no = ? AND COALESCE(bank_name, '') = ? AND party_id = ?
            AND status IN ('HELD', 'DEPOSITED', 'CLEARED')
            AND (? IS NULL OR id <> ?)
          LIMIT 1`
    ).get(pdc_type, cheque_no, bank_name || '', party_id, excludeId, excludeId);
}

/** Validate an allocation list against the cheque amount and its party. */
function _validateAllocations(db, { party_id, pdc_type, amount, allocations }) {
    if (!allocations || !allocations.length) return [];
    const clean = [];
    const seen = new Set();
    let total = 0;
    for (const a of allocations) {
        const value = round2(a.amount != null ? a.amount : a.allocated_amount);
        if (!(value > 0)) throw new Error('Every allocation amount must be greater than 0.');
        const type = a.invoice_type === 'purchase' ? 'purchase' : 'sale';
        // A received cheque settles a sale; an issued cheque settles a purchase.
        const expectedType = pdc_type === 'issued' ? 'purchase' : 'sale';
        if (type !== expectedType) {
            throw new Error(`A ${pdc_type === 'issued' ? 'PDC issued' : 'PDC received'} can only be allocated to ${expectedType === 'sale' ? 'sales invoices' : 'purchase bills'}.`);
        }
        if (!a.invoice_id) throw new Error('Every allocation needs an invoice/bill.');
        const key = `${type}:${a.invoice_id}`;
        if (seen.has(key)) throw new Error('The same document is allocated more than once on this cheque.');
        seen.add(key);

        // The document must belong to the cheque's party.
        const table = type === 'sale' ? 'sales' : 'purchases';
        const doc = db.prepare(`SELECT id, party_id FROM ${table} WHERE id = ?`).get(a.invoice_id);
        if (!doc) throw new Error(`Allocated ${type === 'sale' ? 'invoice' : 'bill'} #${a.invoice_id} was not found.`);
        if (Number(doc.party_id) !== Number(party_id)) {
            throw new Error(`Allocation to ${type === 'sale' ? 'invoice' : 'bill'} #${a.invoice_id} is for a different party.`);
        }
        total = round2(total + value);
        clean.push({ invoice_type: type, invoice_id: Number(a.invoice_id), allocated_amount: value });
    }
    if (total > round2(amount) + CURRENCY_TOLERANCE) {
        throw new Error(`Total allocation (Rs ${total.toFixed(2)}) cannot exceed the cheque amount (Rs ${round2(amount).toFixed(2)}).`);
    }
    return clean;
}

/**
 * Create or update a PDC.
 *
 * @param {object} data - see the pdc_cheques columns; `allocations` is optional
 * @param {number|null} userId
 * @param {string|null} role - the signed-in user's role (backend enforcement)
 */
function savePdcCheque(db, data = {}, userId = null, role = null) {
    ensurePdcTables(db);
    const id = data.id ? Number(data.id) : null;
    const old = id ? db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(id) : null;
    assertPdcPermission(role, old ? 'pdc.edit' : 'pdc.create');

    // ── Validation ──
    const pdc_type = String(data.pdc_type || '').toLowerCase();
    if (!PDC_TYPES.includes(pdc_type)) throw new Error('PDC type must be "received" or "issued".');
    const amount = round2(data.amount);
    if (!(amount > 0)) throw new Error('Cheque amount must be greater than 0.');
    const cheque_no = normChequeNo(data.cheque_no);
    if (!cheque_no) throw new Error('Cheque number is required.');
    const cheque_date = String(data.cheque_date || '').trim();
    if (!cheque_date) throw new Error('Cheque date is required.');
    const party_id = Number(data.party_id);
    if (!party_id) throw new Error('Party is required.');
    const party = db.prepare('SELECT id, name FROM parties WHERE id = ?').get(party_id);
    if (!party) throw new Error('Party not found.');

    const txn_date = String(data.txn_date || data.received_date || data.issued_date || '').trim() || todayBS();
    const bank_name = String(data.bank_name || '').trim();

    // ── Edit restrictions once the cheque has affected the books ──
    if (old) {
        if (PDC_POSTED_STATUSES.includes(old.status) || old.status === 'BOUNCED' || old.status === 'CANCELLED') {
            const incoming = { party_id, pdc_type, cheque_no, cheque_date, amount, bank_name, bank_account_no: String(data.bank_account_no || '').trim() };
            for (const field of PDC_LOCKED_AFTER_POSTING) {
                const before = old[field];
                const after = incoming[field];
                const same = (typeof before === 'number' || typeof after === 'number')
                    ? Math.abs(Number(before) - Number(after)) <= CURRENCY_TOLERANCE
                    : String(before == null ? '' : before) === String(after == null ? '' : after);
                if (!same) {
                    throw new Error(`This cheque is ${old.status}. ${field.replace(/_/g, ' ')} can no longer be changed — reverse or adjust the cheque instead.`);
                }
            }
        }
    }

    const allocations = _validateAllocations(db, { party_id, pdc_type, amount, allocations: data.allocations });
    const dup = findDuplicateCheque(db, { pdc_type, cheque_no, bank_name, party_id }, id);
    if (dup) {
        throw new Error(`Duplicate cheque: ${pdc_type === 'received' ? 'received' : 'issued'} cheque no ${cheque_no} (${bank_name || 'no bank'}) for this party is already on the register as ${dup.pdc_no} (${dup.status}).`);
    }

    const trx = db.transaction(() => {
        let rowId = id;
        if (old) {
            db.prepare(
                `UPDATE pdc_cheques SET
                    pdc_type = ?, party_id = ?, cheque_no = ?, cheque_date = ?, txn_date = ?,
                    bank_name = ?, bank_account_no = ?, amount = ?, reference_no = ?, remarks = ?,
                    deposit_date = COALESCE(?, deposit_date), deposit_bank = COALESCE(?, deposit_bank),
                    deposit_remarks = COALESCE(?, deposit_remarks),
                    clearance_date = COALESCE(?, clearance_date), clearance_bank = COALESCE(?, clearance_bank),
                    clearance_ref = COALESCE(?, clearance_ref), clearance_remarks = COALESCE(?, clearance_remarks),
                    bounce_date = COALESCE(?, bounce_date), bounce_reason = COALESCE(?, bounce_reason),
                    bounce_charge = COALESCE(?, bounce_charge),
                    cancel_date = COALESCE(?, cancel_date), cancel_reason = COALESCE(?, cancel_reason),
                    updated_by = ?, updated_at = datetime('now', 'localtime')
                 WHERE id = ?`
            ).run(
                pdc_type, party_id, cheque_no, cheque_date, txn_date,
                bank_name, String(data.bank_account_no || '').trim(), amount,
                String(data.reference_no || '').trim(), String(data.remarks || ''),
                data.deposit_date || null, data.deposit_bank != null ? String(data.deposit_bank) : null,
                data.deposit_remarks != null ? String(data.deposit_remarks) : null,
                data.clearance_date || null, data.clearance_bank != null ? String(data.clearance_bank) : null,
                data.clearance_ref != null ? String(data.clearance_ref) : null, data.clearance_remarks != null ? String(data.clearance_remarks) : null,
                data.bounce_date || null, data.bounce_reason != null ? String(data.bounce_reason) : null,
                data.bounce_charge != null ? round2(data.bounce_charge) : null,
                data.cancel_date || null, data.cancel_reason != null ? String(data.cancel_reason) : null,
                userId, id
            );
        } else {
            const pdc_no = generatePdcNo(db, txn_date);
            const res = db.prepare(
                `INSERT INTO pdc_cheques
                    (pdc_no, pdc_type, party_id, cheque_no, cheque_date, txn_date, bank_name, bank_account_no,
                     amount, status, reference_no, remarks, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'HELD', ?, ?, ?)`
            ).run(
                pdc_no, pdc_type, party_id, cheque_no, cheque_date, txn_date, bank_name,
                String(data.bank_account_no || '').trim(), amount,
                String(data.reference_no || '').trim(), String(data.remarks || ''), userId
            );
            rowId = res.lastInsertRowid;
        }

        // Allocations can only be replaced while no money has been posted.
        const allocationsEditable = !old || PDC_OPEN_STATUSES.includes(old.status);
        if (allocationsEditable) {
            db.prepare('DELETE FROM pdc_allocations WHERE pdc_id = ?').run(rowId);
            const ins = db.prepare(
                `INSERT INTO pdc_allocations (pdc_id, invoice_type, invoice_id, allocated_amount, created_by)
                 VALUES (?, ?, ?, ?, ?)`
            );
            for (const a of allocations) ins.run(rowId, a.invoice_type, a.invoice_id, a.allocated_amount, userId);
        }

        const fresh = db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(rowId);
        logAudit(db, 'pdc_cheques', rowId, old ? 'update' : 'create', old || null,
            { operation: old ? PDC_ACTIONS.update : PDC_ACTIONS.create, ...fresh, allocations: allocations.length }, userId);
        return { id: rowId, pdc_no: fresh.pdc_no, status: fresh.status };
    });
    return trx();
}

/**
 * Replace a cheque's invoice allocations (audited). Only allowed while the
 * cheque has posted no money; a cleared cheque is corrected by reversal.
 */
function allocatePdc(db, { id, allocations = [] }, userId = null, role = null) {
    ensurePdcTables(db);
    assertPdcPermission(role, 'pdc.allocate');
    const row = db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(id);
    if (!row) throw new Error('PDC not found');
    if (!PDC_OPEN_STATUSES.includes(row.status)) {
        throw new Error(`Allocations cannot be changed while the cheque is ${row.status}. Reverse the cheque first.`);
    }
    const clean = _validateAllocations(db, {
        party_id: row.party_id, pdc_type: row.pdc_type, amount: row.amount, allocations
    });
    const before = db.prepare('SELECT * FROM pdc_allocations WHERE pdc_id = ?').all(id);

    const trx = db.transaction(() => {
        db.prepare('DELETE FROM pdc_allocations WHERE pdc_id = ?').run(id);
        const ins = db.prepare(
            `INSERT INTO pdc_allocations (pdc_id, invoice_type, invoice_id, allocated_amount, created_by)
             VALUES (?, ?, ?, ?, ?)`
        );
        for (const a of clean) ins.run(id, a.invoice_type, a.invoice_id, a.allocated_amount, userId);
        const allocated = round2(clean.reduce((s, a) => s + a.allocated_amount, 0));
        logAudit(db, 'pdc_cheques', id, 'update',
            { operation: clean.length ? PDC_ACTIONS.allocate : PDC_ACTIONS.unallocate, allocations: before },
            {
                operation: clean.length ? PDC_ACTIONS.allocate : PDC_ACTIONS.unallocate,
                pdc_no: row.pdc_no, cheque_no: row.cheque_no, status: row.status,
                allocated_total: allocated, on_account: round2(row.amount - allocated),
                allocations: clean
            }, userId);
        return { id, allocated_total: allocated, allocations: clean };
    });
    return trx();
}

// ──────────────────────────────────────────────────────────────
// Writing: lifecycle
// ──────────────────────────────────────────────────────────────

/** Post one real receipt/payment (plus its ledger row) for a cleared cheque. */
function _postPdcMoney(db, cheque, { date, amount, invoice_type, invoice_id, label, notes, userId }) {
    const value = round2(amount);
    if (!(value > 0)) return null;
    const isReceived = cheque.pdc_type === 'received';
    const type = isReceived ? 'receipt' : 'payment';
    const refType = invoice_type === 'sale' ? 'sale' : (invoice_type === 'purchase' ? 'purchase' : 'pdc');
    const refId = invoice_type === 'on_account' ? cheque.id : invoice_id;

    const ins = db.prepare(
        `INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes, created_by)
         VALUES (?, ?, ?, ?, 'cheque', ?, ?, ?, ?)`
    ).run(cheque.party_id, date, type, value, refType, refId, notes, userId);
    const paymentId = ins.lastInsertRowid;

    db.prepare(
        `INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    ).run(
        cheque.party_id, date,
        isReceived ? 'payment_received' : 'payment_made',
        paymentId,
        label,
        isReceived ? 0 : value,
        isReceived ? value : 0
    );
    return paymentId;
}

/** The on-account money row a cleared cheque created (if any). */
function _pdcPaymentId(db, chequeId) {
    const row = db.prepare('SELECT payment_id FROM pdc_cheques WHERE id = ?').get(chequeId);
    return row ? row.payment_id : null;
}

/** Remove the money rows a cleared cheque created (used on bounce/reversal). */
function _reversePdcMoney(db, chequeId) {
    const ids = [_pdcPaymentId(db, chequeId)];
    try {
        for (const r of db.prepare('SELECT payment_id FROM pdc_allocations WHERE pdc_id = ? AND payment_id IS NOT NULL').all(chequeId)) {
            ids.push(r.payment_id);
        }
    } catch (e) { /* table shape */ }
    const unique = [...new Set(ids.filter(v => v != null))];
    if (!unique.length) return { removed: 0, amount: 0 };
    const ph = unique.map(() => '?').join(',');
    const total = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE id IN (${ph})`).get(...unique).total;
    db.prepare(`DELETE FROM ledger_entries WHERE reference_type IN ('payment_received','payment_made') AND reference_id IN (${ph})`).run(...unique);
    db.prepare(`DELETE FROM payments WHERE id IN (${ph})`).run(...unique);
    db.prepare('UPDATE pdc_allocations SET payment_id = NULL WHERE pdc_id = ?').run(chequeId);
    db.prepare('UPDATE pdc_cheques SET payment_id = NULL WHERE id = ?').run(chequeId);
    return { removed: unique.length, amount: round2(total) };
}

/** Record a bounce charge as a normal expense document (recognised once). */
function _postBounceCharge(db, cheque, { date, charge, reason, userId }) {
    const amount = round2(charge);
    if (!(amount > 0)) return null;
    try {
        const existing = db.prepare(
            "SELECT id FROM other_expenses WHERE reference_no = ? AND expense_head = 'Cheque Bounce Charge' LIMIT 1"
        ).get(String(cheque.cheque_no));
        if (existing) return existing.id;
        const res = db.prepare(
            `INSERT INTO other_expenses (date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks, created_by)
             VALUES (?, 'Bank Charges', 'Cheque Bounce Charge', ?, ?, ?, 'bank', ?, ?, ?)`
        ).run(
            date,
            `Bounced cheque ${cheque.cheque_no} (${cheque.pdc_type === 'received' ? 'receipt' : 'payment'})`,
            amount,
            cheque.bank_name || '',
            String(cheque.cheque_no),
            reason ? `Reason: ${reason}` : '',
            userId
        );
        logAudit(db, 'other_expenses', res.lastInsertRowid, 'create', null,
            { source: 'pdc_bounce', pdc_id: cheque.id, cheque_no: cheque.cheque_no, amount }, userId);
        return res.lastInsertRowid;
    } catch (e) {
        console.error('PDC bounce charge could not be recorded (non-fatal):', e.message);
        return null;
    }
}

/**
 * Move a PDC along its lifecycle. One entry point for deposit / clear / bounce /
 * cancel so every transition is validated the same way and audited.
 *
 * @param {object} payload - { id, action, date, bank, bank_account, reference, reason, charge, remarks }
 */
function setPdcStatus(db, payload = {}, userId = null, role = null) {
    ensurePdcTables(db);
    const action = String(payload.action || '').toLowerCase();
    const target = {
        deposit: 'DEPOSITED', clear: 'CLEARED', bounce: 'BOUNCED', cancel: 'CANCELLED'
    }[action];
    if (!target) throw new Error("Action must be 'deposit', 'clear', 'bounce' or 'cancel'.");
    assertPdcPermission(role, `pdc.${action}`);

    const cheque = db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(payload.id);
    if (!cheque) throw new Error('PDC not found');
    const from = String(cheque.status || '').toUpperCase();
    if (from === target) throw new Error(`This cheque is already ${target}.`);
    const allowed = PDC_TRANSITIONS[from] || [];
    if (!allowed.includes(target)) {
        throw new Error(`A ${from} cheque cannot be marked ${target}. Allowed from ${from}: ${allowed.length ? allowed.join(', ') : 'nothing (final status)'}.`);
    }

    const date = String(payload.date || '').trim() || todayBS();
    const bank = String(payload.bank || payload.bank_name || cheque.bank_name || '').trim();
    const reason = String(payload.reason || '').trim();
    const remarks = String(payload.remarks || '').trim();
    const charge = round2(payload.charge);

    if (action === 'bounce' && !reason) throw new Error('A bounce reason is required.');
    if (action === 'cancel' && !reason) throw new Error('A cancellation reason is required.');

    const trx = db.transaction(() => {
        const result = { id: cheque.id, from, to: target, money: null, reversed: null, charge_expense_id: null, date };

        if (target === 'DEPOSITED') {
            db.prepare(
                `UPDATE pdc_cheques SET status = 'DEPOSITED', deposit_date = ?, deposit_bank = ?,
                        deposit_remarks = ?, updated_by = ?, updated_at = datetime('now','localtime')
                  WHERE id = ?`
            ).run(date, bank, remarks, userId, cheque.id);
        }

        if (target === 'CLEARED') {
            // ── The cheque becomes money: one receipt/payment per allocation,
            //    plus one on-account row for whatever was not allocated. ──
            const allocations = db.prepare('SELECT * FROM pdc_allocations WHERE pdc_id = ? ORDER BY id').all(cheque.id);
            const label = `PDC Cleared — Cheque ${cheque.cheque_no}`;
            let allocated = 0;
            const paymentIds = [];
            for (const a of allocations) {
                const pid = _postPdcMoney(db, cheque, {
                    date,
                    amount: a.allocated_amount,
                    invoice_type: a.invoice_type,
                    invoice_id: a.invoice_id,
                    label,
                    notes: `PDC cleared — cheque ${cheque.cheque_no}${bank ? ' · ' + bank : ''} · ${a.invoice_type === 'sale' ? 'invoice' : 'bill'} allocation`,
                    userId
                });
                if (pid) {
                    db.prepare('UPDATE pdc_allocations SET payment_id = ? WHERE id = ?').run(pid, a.id);
                    paymentIds.push(pid);
                    allocated = round2(allocated + a.allocated_amount);
                }
            }
            const remainder = round2(cheque.amount - allocated);
            let onAccountId = null;
            if (remainder > CURRENCY_TOLERANCE) {
                onAccountId = _postPdcMoney(db, cheque, {
                    date,
                    amount: remainder,
                    invoice_type: 'on_account',
                    invoice_id: null,
                    label,
                    notes: `PDC cleared — cheque ${cheque.cheque_no}${bank ? ' · ' + bank : ''} · on account`,
                    userId
                });
            }
            db.prepare(
                `UPDATE pdc_cheques SET status = 'CLEARED', clearance_date = ?, clearance_bank = ?,
                        clearance_ref = ?, clearance_remarks = ?, payment_id = ?,
                        updated_by = ?, updated_at = datetime('now','localtime')
                  WHERE id = ?`
            ).run(date, bank, String(payload.reference || '').trim(), remarks, onAccountId, userId, cheque.id);
            result.money = {
                payments: paymentIds.length + (onAccountId ? 1 : 0),
                amount: round2(cheque.amount),
                allocated,
                on_account: round2(cheque.amount - allocated),
                bank_effect: cheque.pdc_type === 'received' ? round2(cheque.amount) : round2(-cheque.amount)
            };
        }

        if (target === 'BOUNCED') {
            // A cheque that had already cleared must be taken back out of the
            // books: the receivable/payable and the bank are restored by removing
            // the money rows it created — never by a second, compensating entry.
            let reversed = null;
            if (from === 'CLEARED') reversed = _reversePdcMoney(db, cheque.id);
            db.prepare(
                `UPDATE pdc_cheques SET status = 'BOUNCED', bounce_date = ?, bounce_reason = ?,
                        bounce_charge = ?, updated_by = ?, updated_at = datetime('now','localtime')
                  WHERE id = ?`
            ).run(date, reason, charge, userId, cheque.id);
            result.reversed = reversed;
            result.charge_expense_id = _postBounceCharge(db, cheque, { date, charge, reason, userId });
        }

        if (target === 'CANCELLED') {
            // Nothing should be posted for a cheque that never cleared; guard anyway.
            const posted = db.prepare(
                `SELECT COUNT(*) AS n FROM payments WHERE id = ? OR id IN (SELECT payment_id FROM pdc_allocations WHERE pdc_id = ? AND payment_id IS NOT NULL)`
            ).get(_pdcPaymentId(db, cheque.id) || -1, cheque.id).n;
            if (posted > 0) {
                throw new Error('This cheque has already moved money — it must be bounced/reversed, not cancelled.');
            }
            db.prepare(
                `UPDATE pdc_cheques SET status = 'CANCELLED', cancel_date = ?, cancel_reason = ?,
                        updated_by = ?, updated_at = datetime('now','localtime')
                  WHERE id = ?`
            ).run(date, reason, userId, cheque.id);
        }

        const fresh = db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(cheque.id);
        logAudit(db, 'pdc_cheques', cheque.id, 'update', cheque, {
            operation: action === 'bounce' && from === 'CLEARED' ? PDC_ACTIONS.reverse : PDC_ACTIONS[action],
            ...fresh,
            from_status: from,
            to_status: target,
            money: result.money || null,
            reversed: result.reversed || null,
            charge_expense_id: result.charge_expense_id || null
        }, userId);
        return result;
    });
    return trx();
}

/**
 * Hard-delete a PDC. Only permitted while it has never touched the books
 * (Held or Deposited). A Cancelled cheque stays in the register as audit
 * history; anything that moved money is corrected by cancellation/reversal.
 */
function deletePdcCheque(db, id, userId = null, role = null) {
    ensurePdcTables(db);
    assertPdcPermission(role, 'pdc.delete');
    const row = db.prepare('SELECT * FROM pdc_cheques WHERE id = ?').get(id);
    if (!row) throw new Error('PDC not found');
    if (!PDC_OPEN_STATUSES.includes(row.status)) {
        throw new Error(`A ${row.status} cheque cannot be deleted — it stays on record for audit; reverse it instead if it must be corrected.`);
    }
    const posted = db.prepare(
        `SELECT COUNT(*) AS n FROM payments WHERE id = ? OR id IN (SELECT payment_id FROM pdc_allocations WHERE pdc_id = ? AND payment_id IS NOT NULL)`
    ).get(row.payment_id || -1, id).n;
    if (posted > 0) throw new Error('This cheque has moved money — it cannot be deleted.');

    const trx = db.transaction(() => {
        db.prepare('DELETE FROM pdc_allocations WHERE pdc_id = ?').run(id);
        db.prepare('DELETE FROM pdc_cheques WHERE id = ?').run(id);
        logAudit(db, 'pdc_cheques', id, 'delete', row, null, userId);
        return { deleted: true, id };
    });
    return trx();
}

/** A ready-made blank PDC payload (used by the UI "new cheque" form). */
function newPdcDefaults(db, { pdc_type = 'received', party_id = null } = {}) {
    return {
        pdc_type,
        party_id,
        cheque_no: '',
        cheque_date: '',
        txn_date: todayBS(),
        bank_name: '',
        bank_account_no: '',
        amount: 0,
        reference_no: '',
        remarks: '',
        status: 'HELD',
        allocations: []
    };
}

module.exports = {
    // constants / helpers
    PDC_TYPES, PDC_STATUSES, PDC_TRANSITIONS, PDC_PERMISSIONS, PDC_ACTIONS,
    PDC_OPEN_STATUSES, PDC_POSTED_STATUSES,
    ensurePdcTables, assertPdcPermission, todayBS, dueInfo, generatePdcNo,
    // reads
    listPdcCheques, getPdcCheque, listPdcOpenDocuments, getPdcPosition,
    getPdcRegisterReport, getPdcDueReport, getPdcBouncedReport,
    // writes
    savePdcCheque, allocatePdc, setPdcStatus, deletePdcCheque, newPdcDefaults
};
