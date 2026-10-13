/**
 * Prarambha Account & Stock Management — Excel-style Stock Statement export
 * ========================================================================
 * Requirement 17: the Stock Statement must be exportable to Excel in the same
 * logical structure the operator reads on screen, and the Excel report must
 * reconcile EXACTLY with the application report.
 *
 * There is no second stock calculation here.  The statement sheet is built
 * from `getDailyStockStatement()` — the very chain the Day by Day report shows
 * — and the ledger sheet from `getStockLedger()`, the authoritative quantity
 * engine in `shared/operations/dairy_costing.js`, with the shared
 * `flowDelta()` movement → column mapping, so screen and workbook can never
 * drift apart.
 *
 * Sheets:
 *   Stock_Statement — THE OPERATOR'S REPORT, the five columns only:
 *       Date | Product | Yesterday's Closing Stock | Today's Total Sales |
 *       Today's Total Purchase | Today's Closing Stock
 *     with the period's totals under each product.
 *     Yesterday's Closing − Today's Total Sales + Today's Total Purchase =
 *     Today's Closing, and today's closing is tomorrow's opening. Milk
 *     (Buffalo + Cow + Mix) is ONE combined stock: the three types' sales and
 *     purchases are added together and only one combined closing is reported
 *     (never a per-type balance, never the same purchase or sale twice).
 *     Production, mixing and wastage are deliberately NOT part of this
 *     statement — they live in the ledger sheet below.
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

const { getStockLedger, getDailyStockStatement, round2 } = require('./operations/dairy_costing');

const STATEMENT_HEADERS = [
    'Date', 'Product',
    "Yesterday's Closing Stock", "Today's Total Sales",
    "Today's Total Purchase", "Today's Closing Stock"
];

const LEDGER_HEADERS = [
    'Date', 'Reference No.', 'Party', 'Product', 'Transaction Type',
    'Opening', 'IN', 'OUT', 'Closing', 'Unit Cost', 'Value'
];

/**
 * Build (but do not write) the workbook for a period.
 * @returns {{ workbook: object, products: number, statementRows: number, ledgerRows: number, mismatches: Array }}
 */
function buildStockStatementWorkbook(db, opts = {}) {
    const { from_date = '', to_date = '', category = '', search = '' } = opts;
    // category/search + the combined milk grouping happen INSIDE the engines
    // (filter first, then group) — the workbook then sees exactly the product
    // set the on-screen statement shows, so the two can never drift apart.
    const ledger = getStockLedger(db, {
        from_date, to_date,
        category: category || undefined, search: search || undefined,
        group_milk: true
    });
    const dailyStmt = getDailyStockStatement(db, { from_date, to_date, category, search });

    const statementAoa = [STATEMENT_HEADERS];
    const ledgerAoa = [LEDGER_HEADERS];
    const mismatches = [];

    // ── Stock_Statement — the report, exactly as the Day by Day view shows it ──
    let statementProducts = 0;
    for (const p of (dailyStmt.products || [])) {
        const report = p.report || {};
        const rows = report.rows || [];
        if (!rows.length) continue;
        const nz = (v) => Math.abs(Number(v) || 0) >= 0.005;
        // A product with nothing to say (no movement, zero opening and a zero
        // closing on every day) is left out — same presentation filter as the
        // screen and the ledger sheet.
        if (!rows.some(r => nz(r.sales) || nz(r.purchase) || nz(r.opening) || nz(r.closing))) continue;
        statementProducts++;

        for (const r of rows) {
            const opening = round2(r.opening), sales = round2(r.sales);
            const purchase = round2(r.purchase), closing = round2(r.closing);
            statementAoa.push([r.date, p.product_name, opening, sales, purchase, closing]);
            // The one identity this report asserts, checked on every row.
            if (Math.abs(round2(opening - sales + purchase) - closing) > 0.02) {
                mismatches.push({ product: p.product_name, date: r.date, opening, sales, purchase, closing });
            }
        }
        // The period's totals, mirroring the on-screen TOTAL row: the first
        // opening, the summed sales and purchases, and the final closing —
        // period opening − total sales + total purchase = final closing.
        const firstOpening = round2(rows[0].opening);
        const totalSales = round2(rows.reduce((s, r) => s + (Number(r.sales) || 0), 0));
        const totalPurchase = round2(rows.reduce((s, r) => s + (Number(r.purchase) || 0), 0));
        const lastClosing = round2(rows[rows.length - 1].closing);
        statementAoa.push(['', `TOTAL — ${p.product_name}`, firstOpening, totalSales, totalPurchase, lastClosing]);
        if (Math.abs(round2(firstOpening - totalSales + totalPurchase) - lastClosing) > 0.02
            || Math.abs(lastClosing - round2(report.closing)) > 0.02) {
            mismatches.push({ product: p.product_name, total: true, firstOpening, totalSales, totalPurchase, lastClosing, engine_closing: round2(report.closing) });
        }
    }

    // ── Stock_Ledger — the detailed transaction ledger (every movement) ──
    const ledgerProducts = (ledger.products || []).filter(p =>
        (p.rows || []).length > 0 || round2(p.opening_qty || 0) !== 0);
    for (const p of ledgerProducts) {
        let running = round2(p.opening_qty || 0);
        for (const r of (p.rows || [])) {
            const inQty = round2(r.inward_qty || 0), outQty = round2(r.outward_qty || 0);
            const openQty = running;
            running = round2(running + inQty - outQty);
            ledgerAoa.push([
                r.date, r.reference_no || '', r.party || '', r.product_name || p.product_name, r.label || r.type || '',
                openQty, inQty || '', outQty || '', running,
                round2(r.unit_cost || 0), round2(r.value || 0)
            ]);
        }
        // The last movement's running balance must equal the raw ledger engine.
        if ((p.rows || []).length && Math.abs(running - round2(p.closing_qty || 0)) > 0.02) {
            mismatches.push({ product: p.product_name, ledger_closing: running, engine_closing: round2(p.closing_qty || 0) });
        }
    }

    const wsStatement = XLSX.utils.aoa_to_sheet(statementAoa);
    wsStatement['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
    const wsLedger = XLSX.utils.aoa_to_sheet(ledgerAoa);
    wsLedger['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsStatement, 'Stock_Statement');
    XLSX.utils.book_append_sheet(wb, wsLedger, 'Stock_Ledger');

    return {
        workbook: wb,
        products: statementProducts,
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

module.exports = { exportStockStatementExcel, buildStockStatementWorkbook };
