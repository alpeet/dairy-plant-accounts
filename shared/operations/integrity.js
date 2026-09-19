/**
 * Prarambha Account & Stock Management — Data Integrity Doctor
 * ===========================================================
 * READ-ONLY diagnostics built for handover:
 *
 *   1. Re-derives every product's closing stock from its stock_movements
 *      ledger (and checks the running balance stored on each movement row).
 *   2. Re-derives every party's closing balance from their documents
 *      (sales / purchases / payments / milk collections / partner capital)
 *      and compares it with their ledger_entries.
 *   3. Cross-checks each document against the stock and ledger rows it
 *      should have produced, plus register-level checks (duplicate numbers,
 *      header arithmetic, payment status, audit coverage).
 *
 * This module NEVER writes. Every statement goes through `run()`, which
 * refuses anything that is not a SELECT / WITH / PRAGMA.
 *
 * Used by both Electron (main.js) and the web server (server.js), and by
 * the CLI: node scripts/audit/integrity-doctor.js [dbPath]
 */

const path = require('path');
const fs = require('fs');

const EPS = 0.01;              // money/quantity tolerance
const DEFAULT_MAX_ISSUES = 100; // per check

// ──────────────────────────────────────────────────────────────
// Read-only query helpers
// ──────────────────────────────────────────────────────────────

function assertReadOnly(sql) {
    const head = String(sql).trim().slice(0, 12).toUpperCase();
    if (!(head.startsWith('SELECT') || head.startsWith('WITH') || head.startsWith('PRAGMA'))) {
        throw new Error('Integrity doctor is read-only; refused statement: ' + String(sql).trim().slice(0, 60));
    }
}

/** Run a read-only SELECT and return all rows. */
function run(db, sql, params = []) {
    assertReadOnly(sql);
    return db.prepare(sql).all(...params);
}

/** Run a read-only SELECT and return the first row (may be undefined). */
function one(db, sql, params = []) {
    assertReadOnly(sql);
    return db.prepare(sql).get(...params);
}

/** Run a read-only PRAGMA that returns rows (integrity_check, foreign_key_check…). */
function pragmaRows(db, name) {
    const out = db.pragma(name);
    return Array.isArray(out) ? out : [out];
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const r2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100;
const money = (v) => r2(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Standard issue row rendered by the doctor screen. */
function issue(label, problem, expected, actual, difference, detail) {
    return {
        label: String(label),
        problem: String(problem),
        expected: expected === undefined ? '' : expected,
        actual: actual === undefined ? '' : actual,
        difference: difference === undefined ? '' : difference,
        detail: detail || ''
    };
}

// ──────────────────────────────────────────────────────────────
// Document sources: how each document should hit stock + ledger
// ──────────────────────────────────────────────────────────────
//
// sideExpr produces 'debit' or 'credit' — the ledger column the document
// must post to under this app's convention:
//   closing = opening_balance + Σdebit − Σcredit
//   sale → debit · purchase → credit · receipt → credit · payment → debit
//   milk collection → credit (plant owes the farmer)
//   partner contribution → credit · withdrawal → debit

const DOC_SOURCES = [
    {
        key: 'sale',
        title: 'Sales invoices',
        table: 'sales',            docNo: "d.invoice_no",
        amount: "d.grand_total",
        typeCol: null,
        // Ledger rows written by the app store the document *row id*; rows
        // written by the Excel importer store the document *number*. Both are
        // accepted when linking a ledger row back to its document.
        altCols: ['invoice_no'],
        ledgerTypes: ['sale'],
        sideExpr: "'debit'",
        label: (r) => `Sale ${r.doc_no || ('#' + r.id)} · ${r.doc_date} · ${r.party_name}`
    },
    {
        key: 'purchase',
        title: 'Purchase bills',
        table: 'purchases',
        docNo: "d.bill_no",
        amount: "d.grand_total",
        typeCol: null,
        altCols: ['bill_no'],
        ledgerTypes: ['purchase'],
        sideExpr: "'credit'",
        label: (r) => `Purchase ${r.doc_no || ('#' + r.id)} · ${r.doc_date} · ${r.party_name}`
    },
    {
        key: 'payment',
        title: 'Payments / receipts',
        table: 'payments',
        docNo: "TRIM(COALESCE(d.reference_type, '')) || CASE WHEN COALESCE(d.reference_id, 0) <> 0 THEN '/' || d.reference_id ELSE '' END",
        amount: "d.amount",
        typeCol: "d.type",
        altCols: ['reference_type', 'reference_id'],
        ledgerTypes: ['payment_received', 'payment_made'],
        sideExpr: "CASE WHEN d.type = 'receipt' THEN 'credit' ELSE 'debit' END",
        label: (r) => `${r.doc_date} · ${r.type === 'receipt' ? 'Received from' : 'Paid to'} ${r.party_name}${r.doc_no ? ' · ref ' + r.doc_no : ' · no reference'}`
    },
    {
        key: 'milk',
        title: 'Milk collections',
        table: 'milk_collections',
        docNo: "d.collection_no",
        amount: "d.amount",
        typeCol: null,
        altCols: ['collection_no'],
        ledgerTypes: ['milk_collection'],
        sideExpr: "'credit'",
        label: (r) => `Milk ${r.doc_no || ('#' + r.id)} · ${r.doc_date} · ${r.party_name}`
    },
    {
        key: 'partner',
        title: 'Partner capital',
        table: 'partner_capital',
        docNo: "COALESCE(d.reference_no, '')",
        amount: "d.amount",
        typeCol: "d.type",
        altCols: ['reference_no'],
        ledgerTypes: ['partner_contribution', 'partner_withdrawal'],
        sideExpr: "CASE WHEN d.type = 'contribution' THEN 'credit' ELSE 'debit' END",
        label: (r) => `Capital ${r.type} · ${r.doc_date} · ${r.party_name}`
    }
];

function ledgerTypesSql(source) {
    return source.ledgerTypes.map((t) => `'${t}'`).join(', ');
}

/**
 * SQL predicate linking a ledger row to a document: by row id (app writes)
 * or by document number (rows written by the Excel importer).
 */
function linkSql(source, docAlias = 'd', ledAlias = 'le') {
    const parts = [`${ledAlias}.reference_id = ${docAlias}.id`];
    for (const col of (source.altCols || [])) {
        parts.push(`${ledAlias}.reference_id = ${docAlias}.${col}`);
    }
    return `(${parts.join(' OR ')})`;
}

function docSelect(source, extraCols = '') {
    return `
        SELECT d.id, ${source.docNo} AS doc_no, d.date AS doc_date, d.party_id,
               ${source.amount} AS amount, ${source.sideExpr} AS side,
               ${source.typeCol || 'NULL'} AS type,
               COALESCE(p.name, '(party #' || d.party_id || ' — missing)') AS party_name
               ${extraCols}
        FROM ${source.table} d
        LEFT JOIN parties p ON p.id = d.party_id`;
}

// ──────────────────────────────────────────────────────────────
// Checks
// ──────────────────────────────────────────────────────────────

const CHECK_DEFS = [
    // ───────────────────────── Database ─────────────────────────
    {
        id: 'sqlite_integrity',
        category: 'Database',
        title: 'SQLite file integrity (PRAGMA integrity_check)',
        what: 'Full structural scan of the database file. Anything other than "ok" means the file itself is damaged.',
        severity: 'critical',
        run: ({ db }) => {
            const rows = pragmaRows(db, 'integrity_check');
            const bad = rows.filter((r) => String(r.integrity_check || '').trim().toLowerCase() !== 'ok');
            return {
                scanned: rows.length,
                scannedLabel: 'result rows',
                issues: bad.map((r, i) => issue(`integrity_check row ${i + 1}`, 'SQLite reported a structural problem', 'ok', r.integrity_check))
            };
        }
    },
    {
        id: 'foreign_key_integrity',
        category: 'Database',
        title: 'Foreign key integrity (PRAGMA foreign_key_check)',
        what: 'Every child row must point at an existing parent (e.g. a sale item must belong to a real sale).',
        severity: 'high',
        run: ({ db }) => {
            const rows = pragmaRows(db, 'foreign_key_check');
            return {
                scanned: rows.length,
                scannedLabel: 'orphan rows',
                issues: rows.map((r) => issue(
                    `${r.table} rowid ${r.rowid}`,
                    `Points at a missing parent row in "${r.parent}" (constraint #${r.fkid})`,
                    'parent row exists',
                    'missing'
                ))
            };
        }
    },
    {
        id: 'schema_drift',
        category: 'Database',
        title: 'Schema drift vs database/schema.sql',
        what: 'Tables that exist in the live file but were never added to schema.sql (or vice versa) make rebuilds and restores lose data.',
        severity: 'medium',
        run: ({ db }) => {
            let defined = null;
            try {
                const file = path.join(__dirname, '..', '..', 'database', 'schema.sql');
                const sql = fs.readFileSync(file, 'utf8');
                defined = new Set([...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_][\w]*)["'`]?/gi)].map((m) => m[1]));
            } catch (e) { /* schema.sql not shipped (packaged build) — skip */ }

            const live = run(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
                .map((r) => r.name);

            if (!defined) {
                return { scanned: live.length, scannedLabel: 'tables', issues: [], note: 'database/schema.sql not found — drift check skipped.' };
            }

            const issues = [];
            for (const t of live) {
                if (!defined.has(t)) issues.push(issue(`table ${t}`, 'Exists in the live database but is not defined in schema.sql (created at runtime?)', 'defined in schema.sql', 'missing from schema.sql'));
            }
            for (const t of defined) {
                if (!live.includes(t)) issues.push(issue(`table ${t}`, 'Declared in schema.sql but missing from the live database', 'table exists', 'missing'));
            }
            return { scanned: live.length, scannedLabel: 'tables', issues };
        }
    },

    // ───────────────────────── Stock ─────────────────────────
    {
        id: 'stock_closing_drift',
        category: 'Stock',
        title: 'Closing stock re-derived from stock movements',
        what: 'Closing = opening stock + Σ inward − Σ outward. (When opening stock was posted as an "opening" movement it is already inside Σ inward and is not counted twice.)',
        severity: 'critical',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.unit, COALESCE(p.opening_stock, 0) AS opening_stock,
                       COUNT(sm.id) AS movements,
                       COALESCE(SUM(sm.inward_qty), 0) AS total_in,
                       COALESCE(SUM(sm.outward_qty), 0) AS total_out,
                       COALESCE(SUM(CASE WHEN sm.type = 'opening' THEN sm.inward_qty ELSE 0 END), 0) AS opening_moved,
                       (SELECT m.balance_after FROM stock_movements m
                         WHERE m.product_id = p.id ORDER BY m.id DESC LIMIT 1) AS stored_balance
                FROM products p
                LEFT JOIN stock_movements sm ON sm.product_id = p.id
                GROUP BY p.id
                ORDER BY p.name`);
            const issues = [];
            for (const r of rows) {
                const seed = num(r.opening_moved) > EPS ? 0 : num(r.opening_stock);
                const derived = seed + num(r.total_in) - num(r.total_out);
                const stored = num(r.movements) > 0 ? num(r.stored_balance) : seed;
                const diff = derived - stored;
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `${r.name} (#${r.id})`,
                        'Closing stock does not match its movement ledger (last stored balance)',
                        `${money(derived)} ${r.unit}`,
                        `${money(stored)} ${r.unit}`,
                        `${money(diff)} ${r.unit}`,
                        `${r.movements} movements · in ${money(r.total_in)} · out ${money(r.total_out)} · opening ${money(r.opening_stock)}` +
                        (num(r.opening_moved) > EPS ? ' (posted as an opening movement)' : ' (no opening movement)')
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'products', issues };
        }
    },
    {
        id: 'stock_running_balance',
        category: 'Stock',
        title: 'Running balance on each stock movement row',
        what: 'Every movement stores a balance_after. Walking each product in insertion order, balance_after must equal the previous balance ± the movement quantity.',
        severity: 'high',
        run: ({ db }) => {
            const moves = run(db, `
                SELECT sm.id, sm.product_id, sm.date, sm.type, sm.inward_qty, sm.outward_qty, sm.balance_after,
                       COALESCE(p.name, '(missing product #' || sm.product_id || ')') AS product_name, p.unit
                FROM stock_movements sm
                LEFT JOIN products p ON p.id = sm.product_id
                ORDER BY sm.product_id, sm.id`);
            const byProduct = new Map();
            for (const m of moves) {
                if (!byProduct.has(m.product_id)) byProduct.set(m.product_id, []);
                byProduct.get(m.product_id).push(m);
            }
            const issues = [];
            let driftingRows = 0;
            for (const [productId, list] of byProduct) {
                let expected = 0;
                let drifted = 0;
                let maxDev = 0;
                let first = null;
                for (const m of list) {
                    expected += num(m.inward_qty) - num(m.outward_qty);
                    const dev = num(m.balance_after) - expected;
                    if (Math.abs(dev) > EPS) {
                        drifted++;
                        if (Math.abs(dev) > Math.abs(maxDev)) maxDev = dev;
                        if (!first) first = { m, expected };
                    }
                }
                driftingRows += drifted;
                if (drifted > 0) {
                    issues.push(issue(
                        `${list[0].product_name} (#${productId})`,
                        `${drifted} of ${list.length} movement row(s) carry a wrong running balance`,
                        `${money(first.expected)} ${list[0].unit || ''}`,
                        `${money(first.m.balance_after)} ${list[0].unit || ''}`,
                        `${money(maxDev)} ${list[0].unit || ''}`,
                        `First wrong row: movement #${first.m.id} on ${first.m.date} (${first.m.type}); largest deviation ${money(maxDev)}`
                    ));
                }
            }
            return { scanned: moves.length, scannedLabel: 'movements', issues };
        }
    },
    {
        id: 'stock_negative_closing',
        category: 'Stock',
        title: 'Negative closing stock',
        what: 'A product that closes below zero means more was issued than ever received — either a missing purchase/opening entry or a posting bug.',
        severity: 'critical',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.unit, COALESCE(p.opening_stock, 0) AS opening_stock,
                       COUNT(sm.id) AS movements,
                       COALESCE(SUM(sm.inward_qty), 0) AS total_in,
                       COALESCE(SUM(sm.outward_qty), 0) AS total_out,
                       COALESCE(SUM(CASE WHEN sm.type = 'opening' THEN sm.inward_qty ELSE 0 END), 0) AS opening_moved,
                       (SELECT m.balance_after FROM stock_movements m
                         WHERE m.product_id = p.id ORDER BY m.id DESC LIMIT 1) AS stored_balance
                FROM products p
                LEFT JOIN stock_movements sm ON sm.product_id = p.id
                GROUP BY p.id
                ORDER BY p.name`);
            const issues = [];
            for (const r of rows) {
                const seed = num(r.opening_moved) > EPS ? 0 : num(r.opening_stock);
                const derived = seed + num(r.total_in) - num(r.total_out);
                const stored = num(r.movements) > 0 ? num(r.stored_balance) : seed;
                if (derived < -EPS || stored < -EPS) {
                    issues.push(issue(
                        `${r.name} (#${r.id})`,
                        'Negative closing stock',
                        `>= 0 ${r.unit}`,
                        `${money(derived)} ${r.unit} (stored ${money(stored)})`,
                        `${money(derived)} ${r.unit}`,
                        `${r.movements} movements · in ${money(r.total_in)} · out ${money(r.total_out)}`
                    ));
                }
            }
            issues.sort((a, b) => num(a.difference) - num(b.difference));
            return { scanned: rows.length, scannedLabel: 'products', issues };
        }
    },
    {
        id: 'opening_stock_seed_drift',
        category: 'Stock',
        title: 'Opening stock vs posted opening movement',
        what: 'When a product is created with opening stock the app also posts an "opening" movement. If the product record was later edited, the two disagree and the opening is double- or under-counted.',
        severity: 'medium',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.unit, COALESCE(p.opening_stock, 0) AS opening_stock,
                       COUNT(sm.id) AS opening_rows,
                       COALESCE(SUM(sm.inward_qty), 0) AS opening_moved
                FROM products p
                JOIN stock_movements sm ON sm.product_id = p.id AND sm.type = 'opening'
                GROUP BY p.id ORDER BY p.name`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.opening_stock) - num(r.opening_moved);
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `${r.name} (#${r.id})`,
                        'Product opening stock differs from its posted opening movement',
                        `${money(r.opening_stock)} ${r.unit}`,
                        `${money(r.opening_moved)} ${r.unit} (${r.opening_rows} opening row(s))`,
                        `${money(diff)} ${r.unit}`
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'products with an opening movement', issues };
        }
    },
    {
        id: 'stock_missing_product',
        category: 'Stock',
        title: 'Stock movements without a product',
        what: 'Every movement must belong to a product row; otherwise the quantity is invisible to every stock report.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT sm.product_id, COUNT(*) AS n,
                       MIN(sm.date) AS first_date, MAX(sm.date) AS last_date,
                       COALESCE(SUM(sm.inward_qty), 0) AS inward, COALESCE(SUM(sm.outward_qty), 0) AS outward
                FROM stock_movements sm
                LEFT JOIN products p ON p.id = sm.product_id
                WHERE p.id IS NULL
                GROUP BY sm.product_id`);
            const total = one(db, 'SELECT COUNT(*) AS n FROM stock_movements') || { n: 0 };
            return {
                scanned: total.n,
                scannedLabel: 'movements',
                issues: rows.map((r) => issue(
                    `product_id ${r.product_id}`,
                    `${r.n} movement(s) reference a product that no longer exists`,
                    'product row exists',
                    'missing',
                    '',
                    `${r.first_date} → ${r.last_date} · in ${money(r.inward)} · out ${money(r.outward)}`
                ))
            };
        }
    },
    {
        id: 'stock_dangling_document',
        category: 'Stock',
        title: 'Stock moved against a document that no longer exists',
        what: 'When a document is deleted its movements are reversed, so the net of the group is zero. A non-zero net against a missing document means stock moved with nothing to explain it.',
        severity: 'critical',
        run: ({ db }) => {
            const tables = { sale: 'sales', purchase: 'purchases', milk_collection: 'milk_collections', production: 'production_batches' };
            const issues = [];
            let scanned = 0;
            for (const [refType, table] of Object.entries(tables)) {
                const total = one(db, `SELECT COUNT(*) AS n FROM stock_movements WHERE reference_type = ? AND reference_id IS NOT NULL`, [refType]) || { n: 0 };
                scanned += total.n;
                const rows = run(db, `
                    SELECT sm.reference_id, COUNT(*) AS n,
                           COALESCE(SUM(sm.inward_qty - sm.outward_qty), 0) AS net,
                           MIN(sm.date) AS first_date, MAX(sm.date) AS last_date,
                           GROUP_CONCAT(DISTINCT sm.type) AS types,
                           SUBSTR(GROUP_CONCAT(DISTINCT sm.notes), 1, 200) AS notes
                    FROM stock_movements sm
                    WHERE sm.reference_type = ? AND sm.reference_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM ${table} d WHERE d.id = sm.reference_id)
                    GROUP BY sm.reference_id
                    HAVING ABS(COALESCE(SUM(sm.inward_qty - sm.outward_qty), 0)) > ${EPS}`, [refType]);
                for (const r of rows) {
                    issues.push(issue(
                        `${refType} #${r.reference_id} · movements ${r.first_date} → ${r.last_date}`,
                        `${r.n} stock movement(s) belong to a deleted ${refType} and were never reversed`, 'net 0 (or document exists)', `net ${money(r.net)}`, money(r.net),
                        `${r.types} · "${r.notes || ''}"`
                    ));
                }
            }
            return { scanned, scannedLabel: 'movements tied to a document', issues };
        }
    },
    {
        id: 'stock_date_order',
        category: 'Stock',
        title: 'Backdated movements (date order ≠ posting order)',
        what: 'Balances are computed in posting order but reports are sorted by date, so a backdated movement makes reports disagree with the running balance.',
        severity: 'medium',
        run: ({ db }) => {
            const moves = run(db, `
                SELECT sm.product_id, sm.id, sm.date,
                       COALESCE(p.name, '(missing product #' || sm.product_id || ')') AS product_name
                FROM stock_movements sm
                LEFT JOIN products p ON p.id = sm.product_id
                ORDER BY sm.product_id, sm.id`);
            const byProduct = new Map();
            for (const m of moves) {
                if (!byProduct.has(m.product_id)) byProduct.set(m.product_id, []);
                byProduct.get(m.product_id).push(m);
            }
            const issues = [];
            for (const [productId, list] of byProduct) {
                const backdated = [];
                let prev = null;
                for (const m of list) {
                    if (prev && String(m.date) < String(prev)) backdated.push(m);
                    prev = m.date;
                }
                if (backdated.length) {
                    issues.push(issue(
                        `${list[0].product_name} (#${productId})`,
                        `${backdated.length} movement(s) were posted later than rows with a newer date`,
                        'posting order = date order',
                        `${backdated.length} backdated row(s)`,
                        '',
                        'First: movement #' + backdated[0].id + ' dated ' + backdated[0].date
                    ));
                }
            }
            return { scanned: moves.length, scannedLabel: 'movements', issues };
        }
    },
    {
        id: 'sale_stock_vs_items',
        category: 'Stock',
        title: 'Sales: item quantity vs stock issued',
        what: 'For every invoice, the net quantity written to stock movements must equal the sum of its product line quantities (manual/free-text lines carry no stock).',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT s.id, s.invoice_no, s.date,
                       COALESCE(p.name, '(party #' || s.party_id || ')') AS party_name,
                       COALESCE((SELECT SUM(si.quantity) FROM sales_items si
                                  WHERE si.sale_id = s.id AND si.product_id IS NOT NULL), 0) AS item_qty,
                       COALESCE((SELECT SUM(sm.outward_qty - sm.inward_qty) FROM stock_movements sm
                                  WHERE sm.reference_type = 'sale' AND sm.reference_id = s.id), 0) AS moved_qty
                FROM sales s LEFT JOIN parties p ON p.id = s.party_id`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.moved_qty) - num(r.item_qty);
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `Sale ${r.invoice_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        'Stock issued does not equal the invoiced quantity',
                        money(r.item_qty),
                        money(r.moved_qty),
                        money(diff)
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'invoices', issues };
        }
    },
    {
        id: 'purchase_stock_vs_items',
        category: 'Stock',
        title: 'Purchases: item quantity vs stock received',
        what: 'For every purchase bill, the net quantity added to stock must equal the sum of its line quantities.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT pu.id, pu.bill_no, pu.date,
                       COALESCE(p.name, '(party #' || pu.party_id || ')') AS party_name,
                       COALESCE((SELECT SUM(pi.quantity) FROM purchase_items pi WHERE pi.purchase_id = pu.id), 0) AS item_qty,
                       COALESCE((SELECT SUM(sm.inward_qty - sm.outward_qty) FROM stock_movements sm
                                  WHERE sm.reference_type = 'purchase' AND sm.reference_id = pu.id), 0) AS moved_qty
                FROM purchases pu LEFT JOIN parties p ON p.id = pu.party_id`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.moved_qty) - num(r.item_qty);
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `Purchase ${r.bill_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        'Stock received does not equal the billed quantity',
                        money(r.item_qty),
                        money(r.moved_qty),
                        money(diff)
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'purchase bills', issues };
        }
    },
    {
        id: 'milk_collection_stock_vs_liters',
        category: 'Stock',
        title: 'Milk collections vs raw milk stock',
        what: 'Every collection must add exactly its litre quantity to raw milk stock (and remove it again when edited or deleted).',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT mc.id, mc.collection_no, mc.date, mc.milk_type, mc.quantity_liters,
                       COALESCE(p.name, '(party #' || mc.party_id || ')') AS party_name,
                       COALESCE((SELECT SUM(sm.inward_qty - sm.outward_qty) FROM stock_movements sm
                                  WHERE sm.reference_type = 'milk_collection' AND sm.reference_id = mc.id), 0) AS moved_qty
                FROM milk_collections mc LEFT JOIN parties p ON p.id = mc.party_id`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.moved_qty) - num(r.quantity_liters);
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `Collection ${r.collection_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        `Raw milk (${r.milk_type}) stock change does not match the collected litres`,
                        money(r.quantity_liters) + ' L',
                        money(r.moved_qty) + ' L',
                        money(diff) + ' L'
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'collections', issues };
        }
    },
    {
        id: 'production_stock_vs_batch',
        category: 'Stock',
        title: 'Production batches vs stock consumed / produced',
        what: 'Batch inputs must be issued out of stock and batch outputs received into stock, line for line.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT b.id, b.batch_no, b.date, b.process_type,
                       COALESCE((SELECT SUM(pi.quantity) FROM production_inputs pi WHERE pi.batch_id = b.id), 0) AS input_qty,
                       COALESCE((SELECT SUM(po.quantity) FROM production_outputs po WHERE po.batch_id = b.id), 0) AS output_qty,
                       COALESCE((SELECT SUM(sm.outward_qty - sm.inward_qty) FROM stock_movements sm
                                  WHERE sm.reference_type = 'production' AND sm.reference_id = b.id
                                    AND sm.type = 'production_input'), 0) AS input_moved,
                       COALESCE((SELECT SUM(sm.inward_qty - sm.outward_qty) FROM stock_movements sm
                                  WHERE sm.reference_type = 'production' AND sm.reference_id = b.id
                                    AND sm.type = 'production_output'), 0) AS output_moved
                FROM production_batches b`);
            const issues = [];
            for (const r of rows) {
                const label = `Batch ${r.batch_no} (#${r.id}) · ${r.date} · ${r.process_type || 'process'}`;
                const inDiff = num(r.input_moved) - num(r.input_qty);
                const outDiff = num(r.output_moved) - num(r.output_qty);
                if (Math.abs(inDiff) > EPS) {
                    issues.push(issue(label, 'Stock issued for batch inputs ≠ the batch input lines', money(r.input_qty), money(r.input_moved), money(inDiff)));
                }
                if (Math.abs(outDiff) > EPS) {
                    issues.push(issue(label, 'Stock received from batch outputs ≠ the batch output lines', money(r.output_qty), money(r.output_moved), money(outDiff)));
                }
            }
            return { scanned: rows.length, scannedLabel: 'batches', issues };
        }
    },

    // ───────────────────────── Party ledgers ─────────────────────────
    {
        id: 'party_ledger_vs_documents',
        category: 'Party Ledgers',
        title: 'Party balance re-derived from documents',
        what: 'Opening balance + document postings must equal opening balance + the non-opening ledger rows. (Opening ledger rows are compared separately, since posting the opening twice is a different defect.)',
        severity: 'critical',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.type,
                       COALESCE(p.opening_balance, 0) AS opening,
                       COALESCE((SELECT SUM(le.debit - le.credit) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type <> 'opening'), 0) AS ledger_net,
                       COALESCE((SELECT SUM(le.debit - le.credit) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type = 'opening'), 0) AS opening_posted,
                       COALESCE((SELECT SUM(s.grand_total) FROM sales s WHERE s.party_id = p.id), 0) AS sales_total,
                       COALESCE((SELECT SUM(pu.grand_total) FROM purchases pu WHERE pu.party_id = p.id), 0) AS purchase_total,
                       COALESCE((SELECT SUM(CASE WHEN pm.type = 'receipt' THEN -pm.amount ELSE pm.amount END)
                                   FROM payments pm WHERE pm.party_id = p.id), 0) AS payments_net,
                       COALESCE((SELECT SUM(mc.amount) FROM milk_collections mc WHERE mc.party_id = p.id), 0) AS milk_total,
                       COALESCE((SELECT SUM(CASE WHEN pc.type = 'contribution' THEN -pc.amount ELSE pc.amount END)
                                   FROM partner_capital pc WHERE pc.party_id = p.id), 0) AS capital_net,
                       (SELECT COUNT(*) FROM ledger_entries le WHERE le.party_id = p.id) AS ledger_rows
                FROM parties p
                ORDER BY p.name`);
            const issues = [];
            for (const r of rows) {
                const ledgerClosing = num(r.opening) + num(r.ledger_net);
                const docClosing = num(r.opening) + num(r.sales_total) - num(r.purchase_total)
                    + num(r.payments_net) - num(r.milk_total) + num(r.capital_net);
                const diff = ledgerClosing - docClosing;
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `${r.name} (#${r.id}) · ${r.type}`,
                        'Ledger balance does not match the documents posted for this party',
                        `${money(docClosing)} (from documents)`,
                        `${money(ledgerClosing)} (from ledger)`,
                        money(diff),
                        `opening ${money(r.opening)} · sales ${money(r.sales_total)} · purchases ${money(r.purchase_total)} · ` +
                        `receipts/payments ${money(r.payments_net)} · milk ${money(r.milk_total)} · capital ${money(r.capital_net)} · ` +
                        `${r.ledger_rows} ledger rows (opening entry ${money(r.opening_posted)} excluded from this comparison)`
                    ));
                }
            }
            issues.sort((a, b) => Math.abs(num(b.difference)) - Math.abs(num(a.difference)));
            return { scanned: rows.length, scannedLabel: 'parties', issues };
        }
    },
    {
        id: 'missing_ledger_entry',
        category: 'Party Ledgers',
        title: 'Documents with no ledger entry',
        what: 'Every sale, purchase, payment, milk collection and capital transaction must post one ledger row, otherwise the party balance and ageing report are wrong.',
        severity: 'high',
        run: ({ db }) => {
            const issues = [];
            let scanned = 0;
            for (const src of DOC_SOURCES) {
                const total = one(db, `SELECT COUNT(*) AS n FROM ${src.table} d WHERE ${src.amount} > 0`) || { n: 0 };
                scanned += total.n;
                const rows = run(db, `${docSelect(src)}
                    WHERE ${src.amount} > 0
                      AND NOT EXISTS (
                        SELECT 1 FROM ledger_entries le
                        WHERE le.reference_type IN (${ledgerTypesSql(src)})
                          AND ${linkSql(src)}
                      )`);
                for (const r of rows) {
                    issues.push(issue(
                        src.label(r),
                        'No ledger entry was posted for this document',
                        money(r.amount),
                        '0.00',
                        money(-num(r.amount))
                    ));
                }
            }
            return { scanned, scannedLabel: 'documents', issues };
        }
    },
    {
        id: 'ledger_amount_mismatch',
        category: 'Party Ledgers',
        title: 'Ledger entry amount / party vs its document',
        what: 'A posted ledger row must carry the document amount on the correct side (debit/credit) and belong to the same party.',
        severity: 'high',
        run: ({ db }) => {
            const issues = [];
            let scanned = 0;
            let uncorroborated = 0;
            for (const src of DOC_SOURCES) {
                scanned += (one(db, `SELECT COUNT(*) AS n FROM ${src.table} d WHERE ${src.amount} > 0`) || { n: 0 }).n;
                const rows = run(db, `${docSelect(src, ', le.id AS ledger_id, le.party_id AS ledger_party_id, le.debit AS ledger_debit, le.credit AS ledger_credit, le.date AS ledger_date')}
                    JOIN ledger_entries le
                      ON le.reference_type IN (${ledgerTypesSql(src)}) AND le.reference_id = d.id`);
                for (const r of rows) {
                    const posted = r.side === 'debit' ? num(r.ledger_debit) : num(r.ledger_credit);
                    const amountDiff = posted - num(r.amount);
                    // reference_id holds a document row id (rows written by the app) or the
                    // document's own number (rows written by the Excel importer), so the two
                    // namespaces can collide — e.g. an Excel receipt number equal to a
                    // different payment's row id. Judge only a pairing corroborated as this
                    // document's own posting; an uncorroborated one is left to the
                    // "documents with no ledger entry" check instead of being called wrong.
                    const corroborated = String(r.ledger_date || '') === String(r.doc_date || '')
                        || (num(r.ledger_party_id) === num(r.party_id) && Math.abs(amountDiff) <= EPS);
                    if (!corroborated) { uncorroborated++; continue; }
                    if (Math.abs(amountDiff) > EPS) {
                        issues.push(issue(
                            `${src.label(r)} · ledger row #${r.ledger_id}`,
                            `Ledger ${r.side} is not the document amount`,
                            `${money(r.amount)} ${r.side}`,
                            `${money(posted)} ${r.side}`,
                            money(amountDiff)
                        ));
                    }
                    if (num(r.ledger_party_id) !== num(r.party_id)) {
                        issues.push(issue(
                            `${src.label(r)} · ledger row #${r.ledger_id}`,
                            'Ledger entry is posted against a different party than the document',
                            `party #${r.party_id} (${r.party_name})`,
                            `party #${r.ledger_party_id}`,
                            ''
                        ));
                    }
                }
            }
            return {
                scanned,
                scannedLabel: 'documents',
                issues,
                note: uncorroborated === 0
                    ? 'Every document link resolved to its own posting.'
                    : `${uncorroborated} link(s) skipped as ambiguous: the reference number equals another document's row id, so the pairing cannot be judged here.`
            };
        }
    },
    {
        id: 'duplicate_ledger_posting',
        category: 'Party Ledgers',
        title: 'The same posting written to the ledger twice',
        what: 'Identical rows (same document reference, party and amount) double the party balance and the receivables report.',
        severity: 'high',
        run: ({ db }) => {
            const configured = DOC_SOURCES.flatMap((s) => s.ledgerTypes).map((t) => `'${t}'`).join(', ');
            const rows = run(db, `
                SELECT reference_type, reference_id, party_id, COUNT(*) AS n,
                       COUNT(DISTINCT party_id) AS parties,
                       GROUP_CONCAT(id) AS ledger_ids, GROUP_CONCAT(DISTINCT party_id) AS party_ids,
                       SUM(debit) AS debit, SUM(credit) AS credit,
                       MIN(date) AS first_date, MAX(date) AS last_date
                FROM ledger_entries
                WHERE reference_id IS NOT NULL AND reference_id > 0
                  AND reference_type IN (${configured})
                GROUP BY reference_type, reference_id, party_id, debit, credit
                HAVING COUNT(*) > 1`);
            const total = one(db, 'SELECT COUNT(*) AS n FROM ledger_entries') || { n: 0 };
            const short = (s, n = 6) => {
                const parts = String(s || '').split(',');
                return parts.length > n ? parts.slice(0, n).join(', ') + ` … (+${parts.length - n})` : parts.join(', ');
            };
            return {
                scanned: total.n,
                scannedLabel: 'ledger rows',
                issues: rows.map((r) => issue(
                    `${r.reference_type} #${r.reference_id} · ledger rows ${short(r.ledger_ids)}`,
                    `Posted ${r.n} times in the ledger${num(r.parties) > 1 ? ` against ${r.parties} different parties` : ''}`,
                    'exactly 1 ledger row',
                    `${r.n} rows`,
                    money(num(r.debit) - num(r.credit)),
                    `debit ${money(r.debit)} · credit ${money(r.credit)} · parties ${short(r.party_ids)} · ${r.first_date} → ${r.last_date}`
                ))
            };
        }
    },
    {
        id: 'ledger_reference_collision',
        category: 'Party Ledgers',
        title: 'One reference number used by several different postings',
        what: 'Reference numbers are not unique, so a posting cannot be identified from its reference alone. Common for rows written by the Excel importer, which numbered receipts and payments independently.',
        severity: 'info',
        run: ({ db }) => {
            const configured = DOC_SOURCES.flatMap((s) => s.ledgerTypes).map((t) => `'${t}'`).join(', ');
            const rows = run(db, `
                SELECT reference_type, reference_id, COUNT(*) AS n,
                       COUNT(DISTINCT party_id) AS parties,
                       COUNT(DISTINCT debit) AS debits, COUNT(DISTINCT credit) AS credits,
                       GROUP_CONCAT(DISTINCT party_id) AS party_ids,
                       SUM(debit) AS debit, SUM(credit) AS credit
                FROM ledger_entries
                WHERE reference_id IS NOT NULL AND reference_id > 0
                  AND reference_type IN (${configured})
                GROUP BY reference_type, reference_id
                HAVING COUNT(DISTINCT party_id) > 1 OR COUNT(DISTINCT debit) > 1 OR COUNT(DISTINCT credit) > 1`);
            const short = (s, n = 6) => {
                const parts = String(s || '').split(',');
                return parts.length > n ? parts.slice(0, n).join(', ') + ` … (+${parts.length - n})` : parts.join(', ');
            };
            return {
                scanned: rows.length,
                scannedLabel: 'references',
                issues: rows.map((r) => issue(
                    `${r.reference_type} #${r.reference_id} · ledger rows and parties ${short(r.party_ids)}`,
                    `${r.n} different postings share this reference (${r.parties} parties, ${r.debits} debit amount(s), ${r.credits} credit amount(s))`,
                    'reference identifies one posting',
                    `${r.n} postings`,
                    money(num(r.debit) - num(r.credit)),
                    `totals debit ${money(r.debit)} · credit ${money(r.credit)}`
                )),
                note: `${rows.length} reference(s) are reused. These are not counted as double postings — check them against the source vouchers before treating them as errors.`
            };
        }
    },
    {
        id: 'ledger_dangling_reference',
        category: 'Party Ledgers',
        title: 'Ledger entries that match no document at all',
        what: 'A ledger row must be traceable to a document — by row id (rows the app writes) or by document number (rows the importer writes). Untraceable rows cannot be audited or reversed safely.',
        severity: 'medium',
        run: ({ db }) => {
            const conditions = DOC_SOURCES.map((src) =>
                `(le.reference_type IN (${ledgerTypesSql(src)}) AND NOT EXISTS (SELECT 1 FROM ${src.table} d WHERE ${linkSql(src)}))`
            ).join('\n OR ');
            const rows = run(db, `
                SELECT le.id, le.date, le.reference_type, le.reference_id, le.party_id,
                       le.debit, le.credit, le.description,
                       COALESCE(p.name, '(party #' || le.party_id || ')') AS party_name
                FROM ledger_entries le
                LEFT JOIN parties p ON p.id = le.party_id
                WHERE le.reference_id IS NOT NULL AND le.reference_id <> 0 AND le.reference_id <> ''
                  AND (${conditions})`);
            const total = one(db, 'SELECT COUNT(*) AS n FROM ledger_entries') || { n: 0 };
            const unlinked = one(db, `
                SELECT COUNT(*) AS n FROM ledger_entries
                WHERE reference_id IS NULL OR reference_id = 0 OR reference_id = ''`) || { n: 0 };
            return {
                scanned: total.n,
                scannedLabel: 'ledger rows',
                issues: rows.map((r) => issue(
                    `Ledger #${r.id} · ${r.date} · ${r.party_name}`,
                    `References ${r.reference_type} "${r.reference_id}" — no document with that row id or number`,
                    `${r.reference_type} document exists`,
                    'matching document not found',
                    money(num(r.debit) - num(r.credit)),
                    `${r.description || ''} · debit ${money(r.debit)} · credit ${money(r.credit)}`
                )),
                note: `Ledger rows carry the document row id (written by the app) or the document number (written by the importer); both are accepted here. ${unlinked.n} row(s) were skipped because they carry no reference at all (0/blank).`
            };
        }
    },
    {
        id: 'ledger_missing_party',
        category: 'Party Ledgers',
        title: 'Ledger entries without a party',
        what: 'Every ledger row must belong to a party; orphans silently disappear from every statement.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT le.party_id, COUNT(*) AS n,
                       COALESCE(SUM(le.debit - le.credit), 0) AS net,
                       MIN(le.date) AS first_date, MAX(le.date) AS last_date
                FROM ledger_entries le
                LEFT JOIN parties p ON p.id = le.party_id
                WHERE p.id IS NULL
                GROUP BY le.party_id`);
            const total = one(db, 'SELECT COUNT(*) AS n FROM ledger_entries') || { n: 0 };
            return {
                scanned: total.n,
                scannedLabel: 'ledger rows',
                issues: rows.map((r) => issue(
                    `party_id ${r.party_id}`,
                    `${r.n} ledger row(s) belong to a party that no longer exists`,
                    'party row exists',
                    'missing',
                    money(r.net),
                    `${r.first_date} → ${r.last_date}`
                ))
            };
        }
    },
    {
        id: 'party_opening_double_count',
        category: 'Party Ledgers',
        title: 'Opening balance counted twice',
        what: 'Every statement sums party.opening_balance + the ledger rows, but the app also posts the opening balance as an "opening" ledger row — so that party shows double their real opening balance in statements and receivables.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.type, COALESCE(p.opening_balance, 0) AS opening_balance,
                       COALESCE((SELECT SUM(le.debit - le.credit) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type = 'opening'), 0) AS opening_posted,
                       COALESCE((SELECT COUNT(*) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type = 'opening'), 0) AS opening_rows
                FROM parties p
                WHERE COALESCE(p.opening_balance, 0) <> 0
                  AND EXISTS (SELECT 1 FROM ledger_entries le WHERE le.party_id = p.id AND le.reference_type = 'opening')
                ORDER BY ABS(p.opening_balance) DESC`);
            const issues = rows.map((r) => issue(
                `${r.name} (#${r.id}) · ${r.type}`,
                'Opening balance is added once from the party record and again from the posted opening ledger row',
                `opening counted once: ${money(r.opening_balance)}`,
                `opening counted twice: ${money(num(r.opening_balance) + num(r.opening_posted))}`,
                money(num(r.opening_posted)),
                `${r.opening_rows} opening ledger row(s) worth ${money(r.opening_posted)} — statements/receivables for this party are inflated by that amount`
            ));
            issues.sort((a, b) => Math.abs(num(b.difference)) - Math.abs(num(a.difference)));
            return { scanned: issues.length, scannedLabel: 'parties with an opening balance', issues };
        }
    },
    {
        id: 'party_opening_vs_ledger',
        category: 'Party Ledgers',
        title: 'Opening balance vs posted opening entry',
        what: 'A party with an opening balance must have exactly one "opening" ledger row carrying that amount on the debit side.',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT p.id, p.name, p.type, COALESCE(p.opening_balance, 0) AS opening_balance,
                       COALESCE((SELECT SUM(le.debit - le.credit) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type = 'opening'), 0) AS posted,
                       COALESCE((SELECT COUNT(*) FROM ledger_entries le
                                  WHERE le.party_id = p.id AND le.reference_type = 'opening'), 0) AS opening_rows
                FROM parties p
                WHERE COALESCE(p.opening_balance, 0) <> 0
                   OR EXISTS (SELECT 1 FROM ledger_entries le WHERE le.party_id = p.id AND le.reference_type = 'opening')
                ORDER BY p.name`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.opening_balance) - num(r.posted);
                if (Math.abs(diff) > EPS) {
                    issues.push(issue(
                        `${r.name} (#${r.id}) · ${r.type}`,
                        num(r.opening_rows) === 0
                            ? 'Party has an opening balance but no opening ledger entry'
                            : (num(r.opening_rows) > 1
                                ? `Opening balance spread over ${r.opening_rows} opening ledger rows`
                                : 'Posted opening entry does not match the party opening balance (a credit opening balance loses its sign)'),
                        money(r.opening_balance),
                        money(r.posted),
                        money(diff)
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'parties with an opening balance', issues };
        }
    },
    {
        id: 'ledger_row_shape',
        category: 'Party Ledgers',
        title: 'Malformed ledger rows (both sides empty or both sides filled)',
        what: 'Each ledger row must move exactly one side — one amount on debit or credit, never both and never neither.',
        severity: 'medium',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT le.id, le.date, le.reference_type, le.reference_id, le.party_id,
                       le.debit, le.credit, le.description,
                       COALESCE(p.name, '(party #' || le.party_id || ')') AS party_name
                FROM ledger_entries le
                LEFT JOIN parties p ON p.id = le.party_id
                WHERE le.reference_type <> 'opening'
                  AND ((COALESCE(le.debit, 0) > 0 AND COALESCE(le.credit, 0) > 0)
                    OR (COALESCE(le.debit, 0) <= 0 AND COALESCE(le.credit, 0) <= 0))`);
            const total = one(db, 'SELECT COUNT(*) AS n FROM ledger_entries') || { n: 0 };
            return {
                scanned: total.n,
                scannedLabel: 'ledger rows',
                issues: rows.map((r) => issue(
                    `Ledger #${r.id} · ${r.date} · ${r.party_name}`,
                    num(r.debit) > 0 && num(r.credit) > 0
                        ? 'Row carries both a debit and a credit amount'
                        : 'Row carries no amount at all',
                    'exactly one side filled',
                    `debit ${money(r.debit)} / credit ${money(r.credit)}`,
                    '',
                    `${r.reference_type} ${r.reference_id !== null ? '#' + r.reference_id : ''} · ${r.description || ''}`
                ))
            };
        }
    },

    // ───────────────────────── Documents ─────────────────────────
    {
        id: 'document_number_duplicates',
        category: 'Documents',
        title: 'Duplicate document numbers',
        what: 'Invoice, bill and collection numbers must be unique — duplicates break IRD numbering and make references ambiguous.',
        severity: 'medium',
        run: ({ db }) => {
            const groups = [
                { table: 'sales', col: 'invoice_no', name: 'Sale invoice' },
                { table: 'purchases', col: 'bill_no', name: 'Purchase bill' },
                { table: 'milk_collections', col: 'collection_no', name: 'Milk collection' },
                { table: 'production_batches', col: 'batch_no', name: 'Production batch' }
            ];
            const issues = [];
            let scanned = 0;
            for (const g of groups) {
                scanned += (one(db, `SELECT COUNT(*) AS n FROM ${g.table}`) || { n: 0 }).n;
                const rows = run(db, `
                    SELECT ${g.col} AS doc_no, COUNT(*) AS n, MIN(date) AS first_date, MAX(date) AS last_date,
                           GROUP_CONCAT(id) AS ids
                    FROM ${g.table}
                    GROUP BY ${g.col}
                    HAVING COUNT(*) > 1`);
                for (const r of rows) {
                    issues.push(issue(
                        `${g.name} "${r.doc_no}"`,
                        `Used ${r.n} times — document numbers must be unique`,
                        'unique',
                        `${r.n} documents`,
                        '',
                        `ids ${r.ids} · ${r.first_date} → ${r.last_date}`
                    ));
                }
            }
            return { scanned, scannedLabel: 'documents', issues };
        }
    },
    {
        id: 'sale_items_vs_subtotal',
        category: 'Documents',
        title: 'Sales: line amounts vs invoice subtotal',
        what: 'The invoice subtotal must equal the sum of its line amounts (including free-text/manual lines).',
        severity: 'high',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT s.id, s.invoice_no, s.date, s.subtotal,
                       COALESCE(p.name, '(party #' || s.party_id || ')') AS party_name,
                       COALESCE((SELECT SUM(si.amount) FROM sales_items si WHERE si.sale_id = s.id), 0) AS items_total,
                       (SELECT COUNT(*) FROM sales_items si WHERE si.sale_id = s.id) AS line_count
                FROM sales s LEFT JOIN parties p ON p.id = s.party_id`);
            const issues = [];
            for (const r of rows) {
                const diff = num(r.items_total) - num(r.subtotal);
                if (Math.abs(diff) > 0.05) {
                    issues.push(issue(
                        `Sale ${r.invoice_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        'Invoice subtotal does not equal the sum of its line amounts',
                        money(r.subtotal),
                        money(r.items_total),
                        money(diff),
                        `${r.line_count} line(s)`
                    ));
                }
                if (num(r.line_count) === 0 && num(r.subtotal) > EPS) {
                    issues.push(issue(
                        `Sale ${r.invoice_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        'Invoice has a subtotal but no line items at all',
                        'at least 1 line',
                        '0 lines',
                        money(r.subtotal)
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'invoices', issues };
        }
    },
    {
        id: 'sale_header_arithmetic',
        category: 'Documents',
        title: 'Sales: subtotal → grand total arithmetic',
        what: 'Grand total must equal subtotal − discount + tax. A mismatch means the invoice header was edited by hand or imported inconsistently.',
        severity: 'medium',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT s.id, s.invoice_no, s.date, s.subtotal, s.discount, s.tax, s.grand_total, s.discount_percent,
                       COALESCE(p.name, '(party #' || s.party_id || ')') AS party_name
                FROM sales s LEFT JOIN parties p ON p.id = s.party_id`);
            const issues = [];
            for (const r of rows) {
                const expected = num(r.subtotal) - num(r.discount) + num(r.tax);
                const diff = num(r.grand_total) - expected;
                if (Math.abs(diff) > 0.05) {
                    issues.push(issue(
                        `Sale ${r.invoice_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        'Grand total ≠ subtotal − discount + tax',
                        money(expected),
                        money(r.grand_total),
                        money(diff),
                        `subtotal ${money(r.subtotal)} · discount ${money(r.discount)} (${num(r.discount_percent)}%) · tax ${money(r.tax)}`
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'invoices', issues };
        }
    },
    {
        id: 'purchase_total_coherence',
        category: 'Documents',
        title: 'Purchases: line amounts and header total',
        what: 'Bill subtotal must equal the sum of its lines, and grand total must equal subtotal − discount + tax + transport + other charges.',
        severity: 'medium',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT pu.id, pu.bill_no, pu.date, pu.subtotal, pu.discount, pu.tax,
                       pu.transport_charges, pu.extra_charges, pu.grand_total,
                       COALESCE(p.name, '(party #' || pu.party_id || ')') AS party_name,
                       COALESCE((SELECT SUM(pi.amount) FROM purchase_items pi WHERE pi.purchase_id = pu.id), 0) AS items_total
                FROM purchases pu LEFT JOIN parties p ON p.id = pu.party_id`);
            const issues = [];
            for (const r of rows) {
                const label = `Purchase ${r.bill_no} (#${r.id}) · ${r.date} · ${r.party_name}`;
                const itemsDiff = num(r.items_total) - num(r.subtotal);
                if (Math.abs(itemsDiff) > 0.05) {
                    issues.push(issue(label, 'Bill subtotal does not equal the sum of its line amounts', money(r.subtotal), money(r.items_total), money(itemsDiff)));
                }
                const expected = num(r.subtotal) - num(r.discount) + num(r.tax) + num(r.transport_charges) + num(r.extra_charges);
                const headerDiff = num(r.grand_total) - expected;
                if (Math.abs(headerDiff) > 0.05) {
                    issues.push(issue(
                        label,
                        'Grand total ≠ subtotal − discount + tax + transport + other charges',
                        money(expected),
                        money(r.grand_total),
                        money(headerDiff),
                        `subtotal ${money(r.subtotal)} · discount ${money(r.discount)} · tax ${money(r.tax)} · transport ${money(r.transport_charges)} · other ${money(r.extra_charges)}`
                    ));
                }
            }
            return { scanned: rows.length, scannedLabel: 'purchase bills', issues };
        }
    },
    {
        id: 'milk_amount_formula',
        category: 'Documents',
        title: 'Milk collections: amount and rate against the rate chart',
        what: 'Amount must equal quantity × rate, and a formula-priced collection must use the rate that the rate chart was live on its own date.',
        severity: 'medium',
        run: ({ db }) => {
            const rows = run(db, `
                SELECT mc.id, mc.collection_no, mc.date, mc.quantity_liters, mc.rate, mc.amount,
                       mc.calculated_rate, mc.rate_type, mc.extra_per_unit, mc.fixed_rate, mc.fat_percent, mc.snf_percent,
                       COALESCE(p.name, '(party #' || mc.party_id || ')') AS party_name
                FROM milk_collections mc LEFT JOIN parties p ON p.id = mc.party_id`);
            const issues = [];
            for (const r of rows) {
                const label = `Collection ${r.collection_no} (#${r.id}) · ${r.date} · ${r.party_name}`;
                const expectedAmount = num(r.quantity_liters) * num(r.rate);
                if (Math.abs(num(r.amount) - expectedAmount) > 0.05) {
                    issues.push(issue(label, 'Amount ≠ quantity × rate', money(expectedAmount), money(r.amount), money(num(r.amount) - expectedAmount)));
                }
                if (r.rate_type === 'formula' && num(r.fixed_rate) <= EPS) {
                    const expectedRate = num(r.calculated_rate) + num(r.extra_per_unit);
                    if (Math.abs(num(r.rate) - expectedRate) > EPS) {
                        issues.push(issue(
                            label,
                            'Rate is neither the rate-chart rate nor a recorded override',
                            money(expectedRate),
                            money(r.rate),
                            money(num(r.rate) - expectedRate),
                            `fat ${num(r.fat_percent)} · snf ${num(r.snf_percent)} · calculated ${money(r.calculated_rate)} · extra ${money(r.extra_per_unit)}`
                        ));
                    }
                }
            }
            return { scanned: rows.length, scannedLabel: 'collections', issues };
        }
    },
    {
        id: 'payment_status_coherence',
        category: 'Documents',
        title: 'Paid amount vs status and grand total',
        what: 'paid_amount must not exceed the document total, and the paid/partial/unpaid flag must agree with the amount received.',
        severity: 'medium',
        run: ({ db }) => {
            const parts = [
                { table: 'sales', no: 'invoice_no', amount: 'grand_total', name: 'Sale' },
                { table: 'purchases', no: 'bill_no', amount: 'grand_total', name: 'Purchase' }
            ];
            const issues = [];
            let scanned = 0;
            for (const p of parts) {
                scanned += (one(db, `SELECT COUNT(*) AS n FROM ${p.table}`) || { n: 0 }).n;
                const rows = run(db, `
                    SELECT d.id, d.${p.no} AS doc_no, d.date, d.${p.amount} AS total, d.paid_amount, d.status,
                           COALESCE(pt.name, '(party #' || d.party_id || ')') AS party_name
                    FROM ${p.table} d LEFT JOIN parties pt ON pt.id = d.party_id
                    WHERE d.paid_amount > d.${p.amount} + 0.01
                       OR (d.status = 'paid' AND d.paid_amount < d.${p.amount} - 0.01)
                       OR (d.status = 'unpaid' AND d.paid_amount > 0.01)
                       OR (d.status = 'partial' AND (d.paid_amount <= 0.01 OR d.paid_amount >= d.${p.amount} - 0.01))`);
                for (const r of rows) {
                    const problem = num(r.paid_amount) > num(r.total) + EPS
                        ? 'Paid amount is more than the document total'
                        : `Status "${r.status}" disagrees with the paid amount`;
                    issues.push(issue(
                        `${p.name} ${r.doc_no} (#${r.id}) · ${r.date} · ${r.party_name}`,
                        problem,
                        `paid ≤ ${money(r.total)} and status consistent`,
                        `paid ${money(r.paid_amount)} · status ${r.status}`,
                        money(num(r.paid_amount) - num(r.total))
                    ));
                }
            }
            return { scanned, scannedLabel: 'documents', issues };
        }
    },
    {
        id: 'documents_missing_party',
        category: 'Documents',
        title: 'Documents without a party',
        what: 'Each document must belong to a real party; otherwise its balance never lands anywhere.',
        severity: 'high',
        run: ({ db }) => {
            const tables = [
                { table: 'sales', name: 'Sale' },
                { table: 'purchases', name: 'Purchase' },
                { table: 'payments', name: 'Payment' },
                { table: 'milk_collections', name: 'Milk collection' },
                { table: 'partner_capital', name: 'Capital transaction' }
            ];
            const issues = [];
            let scanned = 0;
            for (const t of tables) {
                scanned += (one(db, `SELECT COUNT(*) AS n FROM ${t.table}`) || { n: 0 }).n;
                const rows = run(db, `
                    SELECT d.id, d.date, d.party_id
                    FROM ${t.table} d
                    LEFT JOIN parties p ON p.id = d.party_id
                    WHERE p.id IS NULL`);
                for (const r of rows) {
                    issues.push(issue(
                        `${t.name} #${r.id} · ${r.date}`,
                        'Belongs to a party that does not exist',
                        'party row exists',
                        `party #${r.party_id} missing`,
                        ''
                    ));
                }
            }
            return { scanned, scannedLabel: 'documents', issues };
        }
    },
    {
        id: 'orphan_child_rows',
        category: 'Documents',
        title: 'Line items without their parent document',
        what: 'Sales items, purchase items and production lines must all belong to an existing document.',
        severity: 'medium',
        run: ({ db }) => {
            const parts = [
                { table: 'sales_items', parent: 'sales', group: 'sale_id' },
                { table: 'purchase_items', parent: 'purchases', group: 'purchase_id' },
                { table: 'production_inputs', parent: 'production_batches', group: 'batch_id' },
                { table: 'production_outputs', parent: 'production_batches', group: 'batch_id' }
            ];
            const issues = [];
            let scanned = 0;
            for (const p of parts) {
                scanned += (one(db, `SELECT COUNT(*) AS n FROM ${p.table}`) || { n: 0 }).n;
                const rows = run(db, `
                    SELECT c.${p.group} AS parent_id, COUNT(*) AS n, COALESCE(SUM(c.quantity), 0) AS qty,
                           COALESCE(SUM(c.amount), 0) AS amount
                    FROM ${p.table} c
                    LEFT JOIN ${p.parent} d ON d.id = c.${p.group}
                    WHERE d.id IS NULL
                    GROUP BY c.${p.group}`);
                for (const r of rows) {
                    issues.push(issue(
                        `${p.table} → ${p.parent} #${r.parent_id}`,
                        `${r.n} line(s) belong to a document that no longer exists`,
                        `${p.parent} row exists`,
                        'missing',
                        money(r.amount),
                        `quantity ${money(r.qty)}`
                    ));
                }
            }
            return { scanned, scannedLabel: 'line rows', issues };
        }
    },
    {
        id: 'manual_invoice_items',
        category: 'Documents',
        title: 'Free-text (non-stock) invoice lines — informational',
        what: 'Manual lines typed straight onto an invoice carry no product and no stock movement by design. Counted here so they are never mistaken for missing stock.',
        severity: 'info',
        run: ({ db }) => {
            const total = one(db, 'SELECT COUNT(*) AS n FROM sales_items') || { n: 0 };
            const r = one(db, `
                SELECT COUNT(*) AS lines, COUNT(DISTINCT sale_id) AS sales,
                       COALESCE(SUM(amount), 0) AS amount
                FROM sales_items WHERE product_id IS NULL`) || { lines: 0, sales: 0, amount: 0 };
            return {
                scanned: total.n,
                scannedLabel: 'invoice lines',
                issues: [],
                note: num(r.lines) === 0
                    ? 'No free-text invoice lines found — every line is a real product.'
                    : `${r.lines} free-text line(s) across ${r.sales} invoice(s), worth ${money(r.amount)}. These are not expected to move stock.`
            };
        }
    },
    {
        id: 'audit_trail_coverage',
        category: 'Documents',
        title: 'Audit trail coverage — informational',
        what: 'The audit_log should hold a create/update/delete row for every document change; an empty log means IRD-style traceability is not yet captured.',
        severity: 'info',
        run: ({ db }) => {
            const logged = (one(db, 'SELECT COUNT(*) AS n FROM audit_log') || { n: 0 }).n;
            const docs = (one(db, `SELECT
                    (SELECT COUNT(*) FROM sales)
                  + (SELECT COUNT(*) FROM purchases)
                  + (SELECT COUNT(*) FROM payments)
                  + (SELECT COUNT(*) FROM milk_collections)
                  + (SELECT COUNT(*) FROM production_batches) AS n`) || { n: 0 }).n;
            const editDocs = (one(db, `SELECT
                    (SELECT COUNT(*) FROM sales WHERE updated_at <> created_at)
                  + (SELECT COUNT(*) FROM purchases WHERE updated_at <> created_at)
                  + (SELECT COUNT(*) FROM milk_collections WHERE updated_at <> created_at) AS n`) || { n: 0 }).n;
            const issues = [];
            if (logged === 0 && num(docs) > 0) {
                issues.push(issue(
                    'audit_log',
                    `No audit rows at all while ${docs} document(s) exist — no who/what/when history is being captured`,
                    '>= 1 audit row per change',
                    '0 rows',
                    '',
                    `${editDocs} document(s) show an updated_at different from created_at (edits that left no trail)`
                ));
            }
            return {
                scanned: num(docs),
                scannedLabel: 'documents',
                issues,
                note: `audit_log holds ${logged} row(s); ${docs} document(s) exist, ${editDocs} of them were edited after creation.`
            };
        }
    }
];

// ──────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────

/**
 * Run the integrity doctor.
 *
 * @param {object} db - better-sqlite3 instance (opened read-only or read-write; never written to)
 * @param {object} [opts]
 * @param {number} [opts.limit=100]  max issues returned per check
 * @param {string} [opts.only]       comma-separated check ids or categories
 * @returns {object} the report (the API layer wraps it in {success, data})
 */
function runIntegrityChecks(db, opts = {}) {
    const started = Date.now();
    const limit = Math.min(Math.max(parseInt(opts.limit, 10) || DEFAULT_MAX_ISSUES, 1), 1000);
    const filter = String(opts.only || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

    const defs = filter.length
        ? CHECK_DEFS.filter((c) => filter.includes(c.id.toLowerCase()) || filter.includes(c.category.toLowerCase()))
        : CHECK_DEFS;

    const checks = [];
    let totalIssues = 0;
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

    for (const def of defs) {
        let result;
        try {
            result = def.run({ db, limit }) || {};
        } catch (err) {
            result = { scanned: 0, scannedLabel: '', issues: [], error: err.message };
        }
        const all = Array.isArray(result.issues) ? result.issues : [];
        const shown = all.slice(0, limit);
        const failed = all.length > 0;

        if (failed) {
            totalIssues += all.length;
            bySeverity[def.severity] = (bySeverity[def.severity] || 0) + all.length;
        }

        checks.push({
            id: def.id,
            category: def.category,
            title: def.title,
            what: def.what,
            severity: def.severity,
            status: result.error ? 'error' : (failed ? 'fail' : 'pass'),
            scanned: result.scanned || 0,
            scanned_label: result.scannedLabel || 'rows',
            issue_count: all.length,
            truncated: all.length > shown.length,
            issues: shown,
            note: result.note || '',
            error: result.error || ''
        });
    }

    const failedChecks = checks.filter((c) => c.status === 'fail').length;
    const erroredChecks = checks.filter((c) => c.status === 'error').length;
    const categories = [];
    for (const c of checks) if (!categories.includes(c.category)) categories.push(c.category);

    return {
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
        read_only: true,
        database: (() => { try { return db.name || ''; } catch (e) { return ''; } })(),
        summary: {
            checks_run: checks.length,
            passed: checks.length - failedChecks - erroredChecks,
            failed: failedChecks,
            errored: erroredChecks,
            total_issues: totalIssues,
            by_severity: bySeverity,
            headline: erroredChecks
                ? `${erroredChecks} check(s) could not run — see the errors below`
                : (failedChecks === 0
                    ? `All ${checks.length} checks passed — stock and ledgers reconcile`
                    : `${failedChecks} of ${checks.length} checks found ${totalIssues} problem(s)`)
        },
        categories,
        checks
    };
}

module.exports = {
    runIntegrityChecks,
    CHECK_DEFS,
    DOC_SOURCES,
    // Exposed so the read-only guarantee itself can be verified in tests.
    _internal: { run, one, pragmaRows, assertReadOnly }
};
