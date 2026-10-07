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
 *       Other | Closing
 *     Opening on the first day is the stock immediately BEFORE the period; each
 *     following day carries the previous closing forward automatically (req 11).
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

const { getStockLedger, flowDelta, round2 } = require('./operations/dairy_costing');

/**
 * Flatten a product's movement rows into per-day flow rows, carrying the
 * balance forward day by day.  First day's opening = stock before the period.
 */
function dailyFlowRows(product) {
    const byDate = new Map();
    for (const r of (product.rows || [])) {
        if (!byDate.has(r.date)) {
            byDate.set(r.date, {
                date: r.date,
                refs: new Set(), parties: new Set(),
                sales_issues: 0, collection_purchase: 0, production: 0,
                production_consumption: 0, other: 0
            });
        }
        const day = byDate.get(r.date);
        const fd = flowDelta(r);
        day[fd.column] = round2(day[fd.column] + fd.qty);
        if (r.reference_no) day.refs.add(String(r.reference_no));
        if (r.party) day.parties.add(String(r.party));
    }
    const days = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let balance = round2(product.opening_qty || 0);
    const out = [];
    for (const day of days) {
        const opening = balance;
        const remaining = round2(opening - day.sales_issues);
        const computed = round2(
            remaining + day.collection_purchase + day.production - day.production_consumption + day.other
        );
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
            other: round2(day.other),
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
    'Production', 'Production Consumption', 'Other', 'Closing'
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

    for (const p of products) {
        const days = dailyFlowRows(p);
        for (const row of days) {
            statementAoa.push([
                row.date, row.reference, row.party, row.product,
                row.opening, row.sales_issues, row.remaining, row.collection_purchase,
                row.production, row.production_consumption, row.other, row.closing
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
        // The last movement's running balance must equal the engine's closing.
        if ((p.rows || []).length && Math.abs(running - round2(p.closing_qty || 0)) > 0.02) {
            mismatches.push({ product: p.product_name, ledger_closing: running, engine_closing: round2(p.closing_qty || 0) });
        }
        // The statement's last day closing must equal the engine's closing.
        if (days.length && Math.abs(days[days.length - 1].closing - round2(p.closing_qty || 0)) > 0.02) {
            mismatches.push({ product: p.product_name, statement_closing: days[days.length - 1].closing, engine_closing: round2(p.closing_qty || 0) });
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
