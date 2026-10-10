/**
 * Prarambha Account & Stock Management — Excel-style Stock Statement export
 * ========================================================================
 * Requirement 17: the Stock Statement must be exportable to Excel in the same
 * logical structure the operator reads on screen, and the Excel report must
 * reconcile EXACTLY with the application report.
 *
 * There is no second stock calculation here.  Every figure comes from
 * `getStockLedger()` (the authoritative lot/quantity engine in
 * `shared/operations/dairy_costing.js`), and the movement → column mapping is
 * the shared `flowDelta()` — the same function the live statement uses, so the
 * two can never drift apart.
 *
 * Sheets:
 *   Stock_Statement — one row per product per day, the operator's daily flow:
 *       Date | Reference | Party | Product | Opening | Sales/Issues |
 *       Remaining | Collection/Purchase | Production | Production Consumption |
 *       Other | Shortfall | Closing
 *     Opening on the first day is the stock immediately BEFORE the period;
 *     each following day carries the previous closing forward automatically
 *     (req 11). The closing NEVER goes below zero: a day deducts only what the
 *     stock actually has (sales take yesterday's closing first, the excess
 *     takes today's purchase) and whatever neither covers is the red Shortfall
 *     column — the same floor rule the live statement applies.
 *   Stock_Ledger — every movement with its source (req 1 / 14):
 *       Date | Reference No. | Party | Product | Transaction Type |
 *       Opening | IN | OUT | Closing | Unit Cost | Value
 *
 * Usage:
 *   const { exportStockStatementExcel } = require('./shared/export-stock-statement');
 *   exportStockStatementExcel(db, '/tmp/stock.xlsx', { from_date, to_date });
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const { getStockLedger, getDailyStockStatement, stockOpeningBefore, flowDelta, round2 } = require('./operations/dairy_costing');

/**
 * Flatten a product's movement rows into per-day flow rows, carrying the
 * balance forward day by day.  First day's opening = stock before the period,
 * replayed with the statement's own floor rule when `ctx = { db, from_date }`
 * is supplied (so the export opens exactly where the live statement does);
 * without ctx the ledger's raw opening is used.
 *
 * Per day: `remaining` is floored at 0 (sales deduct from yesterday's closing
 * first, the excess takes today's in-flows), the closing is floored at 0 and
 * whatever stock could not cover becomes that day's `shortfall` — so every row
 * satisfies `Opening − Sales + In − Out + Shortfall = Closing` exactly.
 */
function dailyFlowRows(product, ctx) {
    const byDate = new Map();
    for (const r of (product.rows || [])) {
        if (!byDate.has(r.date)) {
            byDate.set(r.date, {
                date: r.date,
                refs: new Set(), parties: new Set(),
                sales_issues: 0, collection_purchase: 0, production: 0,
                production_consumption: 0, wastage: 0, other_in: 0, other_out: 0
            });
        }
        const day = byDate.get(r.date);
        const fd = flowDelta(r);
        day[fd.column] = round2(day[fd.column] + fd.qty);
        if (r.reference_no) day.refs.add(String(r.reference_no));
        if (r.party) day.parties.add(String(r.party));
    }
    const days = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let balance = (ctx && ctx.db)
        ? stockOpeningBefore(ctx.db, product.product_id, ctx.from_date || '')
        : round2(product.opening_qty || 0);
    const out = [];
    for (const day of days) {
        const opening = balance;
        // What is physically on hand after yesterday's closing absorbs today's
        // sales — never negative; the excess comes out of today's in-flows.
        const remaining = Math.max(0, round2(opening - day.sales_issues));
        const net = round2(
            opening + day.collection_purchase + day.production
            - day.production_consumption - day.wastage + day.other_in - day.other_out
            - day.sales_issues
        );
        const shortfall = net < 0 ? round2(-net) : 0;
        const computed = net < 0 ? 0 : net;
        out.push({
            date: day.date,
            reference: summarise(day.refs),
            party: summarise(day.parties),
            product: product.product_name,
            unit: product.unit,
            opening,
            sales_issues: round2(day.sales_issues),
            remaining,
            collection_purchase: round2(day.collection_purchase),
            production: round2(day.production),
            production_consumption: round2(day.production_consumption),
            wastage: round2(day.wastage),
            other_in: round2(day.other_in),
            other_out: round2(day.other_out),
            shortfall,
            closing: computed
        });
        balance = computed;
    }
    return out;
}

/** Join a day's sources for the summary row without dumping hundreds of refs. */
function summarise(set) {
    const list = [...set];
    if (!list.length) return '';
    if (list.length <= 3) return list.join(', ');
    return `${list.slice(0, 3).join(', ')} +${list.length - 3} more`;
}

const STATEMENT_HEADERS = [
    'Date', 'Reference', 'Party', 'Product',
    'Opening', 'Sales/Issues', 'Remaining', 'Collection/Purchase',
    'Production', 'Production Consumption', 'Wastage', 'Other IN', 'Other OUT', 'Shortfall', 'Closing'
];

const LEDGER_HEADERS = [
    'Date', 'Reference No.', 'Party', 'Product', 'Transaction Type',
    'Opening', 'IN', 'OUT', 'Closing', 'Unit Cost', 'Value'
];

/**
 * Build (but do not write) the workbook for a period.
 * @returns {{ sheets: object, statementRows: number, ledgerRows: number, mismatches: Array }}
 */
function buildStockStatementWorkbook(db, opts = {}) {
    const { from_date = '', to_date = '', category = '', search = '' } = opts;
    const ledger = getStockLedger(db, { from_date, to_date });
    const q = String(search || '').toLowerCase();
    const products = (ledger.products || []).filter(p => {
        if (category && p.category !== category) return false;
        if (q && !String(p.product_name || '').toLowerCase().includes(q)
            && !String(p.category || '').toLowerCase().includes(q)) return false;
        // Only products with movement in the period or a non-zero opening.
        return (p.rows || []).length > 0 || round2(p.opening_qty || 0) !== 0;
    });

    const statementAoa = [STATEMENT_HEADERS];
    const ledgerAoa = [LEDGER_HEADERS];
    const mismatches = [];

    // The live statement's capped chain — the export must reproduce it exactly.
    const dailyStmt = getDailyStockStatement(db, { from_date, to_date, category, search });
    const dailyByPid = new Map((dailyStmt.products || []).map(d => [String(d.product_id), d]));

    for (const p of products) {
        const days = dailyFlowRows(p, { db, from_date });
        for (const row of days) {
            statementAoa.push([
                row.date, row.reference, row.party, row.product,
                row.opening, row.sales_issues, row.remaining, row.collection_purchase,
                row.production, row.production_consumption, row.wastage, row.other_in,
                row.other_out, row.shortfall, row.closing
            ]);
        }
        // Movement-level ledger with the running balance and open reference.
        let running = round2(p.opening_qty || 0);
        for (const r of (p.rows || [])) {
            const inQty = round2(r.inward_qty || 0), outQty = round2(r.outward_qty || 0);
            const openQty = running;
            running = round2(running + inQty - outQty);
            ledgerAoa.push([
                r.date, r.reference_no || '', r.party || '', p.product_name, r.label || r.type || '',
                openQty, inQty || '', outQty || '', running,
                round2(r.unit_cost || 0), round2(r.value || 0)
            ]);
        }
        // The last movement's running balance must equal the raw ledger engine.
        if ((p.rows || []).length && Math.abs(running - round2(p.closing_qty || 0)) > 0.02) {
            mismatches.push({ product: p.product_name, ledger_closing: running, engine_closing: round2(p.closing_qty || 0) });
        }
        // The statement sheet must equal the DAILY ENGINE (capped chain): two
        // independent implementations of the same floor rule must agree, no row
        // may ever close negative, and every row's identity must hold.
        if (days.length) {
            const dp = dailyByPid.get(String(p.product_id));
            const engineClose = dp ? round2(dp.last_closing) : null;
            const last = days[days.length - 1];
            if (engineClose === null || Math.abs(last.closing - engineClose) > 0.02) {
                mismatches.push({ product: p.product_name, statement_closing: last.closing, engine_closing: engineClose });
            }
            for (const row of days) {
                const net = round2(row.opening + row.collection_purchase + row.production + row.other_in
                    - row.production_consumption - row.wastage - row.other_out - row.sales_issues);
                const wantClose = net < 0 ? 0 : net;
                const wantShort = net < 0 ? round2(-net) : 0;
                if (row.closing < -0.001
                    || Math.abs(row.closing - wantClose) > 0.02
                    || Math.abs(row.shortfall - wantShort) > 0.02) {
                    mismatches.push({ product: p.product_name, date: row.date, statement_closing: row.closing, shortfall: row.shortfall, engine_closing: wantClose });
                    break;
                }
            }
        }
    }

    const wsStatement = XLSX.utils.aoa_to_sheet(statementAoa);
    wsStatement['!cols'] = STATEMENT_HEADERS.map((h, i) => ({ wch: i === 2 ? 24 : (i === 3 ? 20 : 14) }));
    const wsLedger = XLSX.utils.aoa_to_sheet(ledgerAoa);
    wsLedger['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsStatement, 'Stock_Statement');
    XLSX.utils.book_append_sheet(wb, wsLedger, 'Stock_Ledger');

    return {
        workbook: wb,
        products: products.length,
        statementRows: statementAoa.length - 1,
        ledgerRows: ledgerAoa.length - 1,
        mismatches
    };
}

/**
 * Write the Excel-style stock statement to `outputPath`.
 * @returns {{ success:boolean, filePath?:string, statementRows?:number, ledgerRows?:number, mismatches?:Array, error?:string }}
 */
function exportStockStatementExcel(db, outputPath, opts = {}) {
    try {
        const built = buildStockStatementWorkbook(db, opts);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        XLSX.writeFile(built.workbook, outputPath, { bookType: 'xlsx', type: 'file' });
        return {
            success: true,
            filePath: outputPath,
            products: built.products,
            statementRows: built.statementRows,
            ledgerRows: built.ledgerRows,
            mismatches: built.mismatches,
            reconciled: built.mismatches.length === 0
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { exportStockStatementExcel, buildStockStatementWorkbook, dailyFlowRows };
