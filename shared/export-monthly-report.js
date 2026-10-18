/**
 * Prarambha Account & Stock Management — Monthly Report Excel sheet
 * =================================================================
 * ONE builder produces the "Monthly Report " worksheet, used in two places so
 * they can never disagree:
 *
 *   1. the app's Export (a standalone workbook), and
 *   2. scripts/audit/add-monthly-report-sheet.js, which inserts the same sheet
 *      into the existing `Dairy_Accounts_Professional.xlsx` WITHOUT touching
 *      any other sheet.
 *
 * Every figure comes from shared/operations/monthly_report.js — the same
 * engine the on-screen report uses — so the workbook and the app reconcile by
 * construction. Nothing is typed by hand and nothing is recalculated here.
 *
 * Sheet layout (req 7):
 *   header  : company, title, BS period, AD period, generation date, data window
 *   Section A — Monthly Summary        (opening → income → COGS → opex → net → closing)
 *   Section B — Income Heads           (one row per income head + total)
 *   Section C — Expense Heads          (one row per expense head + total)
 *   Section D — Monthly Closing        (a row per month, opening → closing)
 *   Section E — Reconciliation         (expected / actual / difference / flag)
 *   notes   : data gaps the reader must know about
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const monthly = require('./operations/monthly_report');
const { appendOrReplaceSheet } = require('./xlsx-parts');

// Requested name is "Monthly Report " (the requirement's trailing space).
// Excel/SheetJS trim trailing whitespace in sheet names, so the stored name is
// 'Monthly Report' — the code keeps the requested string and accepts either
// when looking for an existing sheet, and the delivery note says so.
const SHEET_NAME = 'Monthly Report ';
const MONEY = '#,##0.00';

const isNum = (v) => typeof v === 'number' && isFinite(v);
const n = (v) => (isNum(v) ? v : 0);

/**
 * Build the worksheet rows for a BS range/month.
 * @returns {{ rows: Array<Array>, sheet: object, report: object, meta: object }}
 */
function buildMonthlyReportSheet(db, opts = {}) {
    const report = monthly.getMonthlyReport(db, opts);
    const rows = [];
    const bold = new Set();      // row indexes (0-based) that should read as headings
    const push = (row, isBold) => { rows.push(row); if (isBold) bold.add(rows.length - 1); };

    // ── Header ──
    push([report.business.name], true);
    push(['Monthly Report '], true);
    push(['Business Address', report.business.address || '']);
    push(['PAN / VAT', report.business.pan || '']);
    push(['Reporting Period (BS)', `${report.from_date} → ${report.to_date}`]);
    push(['Reporting Period (AD)', `${report.from_ad || ''} → ${report.to_ad || ''}`]);
    push(['Months Covered', report.month_count]);
    push(['Report Generated', new Date(report.generated_at).toLocaleString()]);
    push(['Latest Document in Books', `${report.data_window.latest_document_date || '—'}`
        + (report.data_window.latest_document_ad ? ` (AD ${report.data_window.latest_document_ad})` : '')]);
    push(['Today (BS)', report.data_window.today || '']);
    push([]);

    // ── Section A — Monthly Summary ──
    const s = report.summary;
    push(['SECTION A — MONTHLY SUMMARY', 'Amount (Rs)'], true);
    const summaryRows = [
        ["Opening Cash Balance", s.opening_cash],
        ["Opening Bank Balance", s.opening_bank],
        ["Opening Inventory Value", s.opening_inventory],
        ["Sales Revenue (excl. opening balances)", s.sales_revenue],
        ["Other Income", s.other_income],
        ["Total Income", s.total_income],
        ["Milk Procurement Cost", s.milk_cost],
        ["Other Purchases (COGS)", s.other_purchases],
        ["Cost of Goods Sold", s.cogs],
        ["Gross Profit", s.gross_profit],
        ["Total Operating Expenses", s.total_operating_expenses],
        ["Total Expenses (COGS + Operating)", n(s.cogs) + n(s.operating_expenses)],
        ["Net Profit / (Loss)", s.net_profit],
        ["Closing Cash Balance", s.closing_cash],
        ["Closing Bank Balance", s.closing_bank],
        ["Closing Inventory Value", s.closing_inventory],
        ["Outstanding Receivables", s.receivables],
        ["Outstanding Payables", s.payables],
        ["Outstanding Advances", s.advances],
        ["Loan Receivable", s.loan_receivable],
        ["Loan Payable", s.loan_payable],
        ["Prepaid Rent Balance (asset)", s.prepaid_rent]
    ];
    for (const [label, value] of summaryRows) push([label, n(value)]);
    push([]);

    // ── Section B — Income Heads ──
    push(['SECTION B — INCOME HEADS', 'Amount (Rs)', 'Document Lines', '% of Sales'], true);
    for (const h of report.income_heads) push([h.head, n(h.amount), h.count, h.share_percent == null ? '' : n(h.share_percent)]);
    push(['TOTAL INCOME HEADS', n(report.activity.income_heads_total), '', ''], true);
    if (Math.abs(n(report.activity.income_unexplained)) >= 0.01) {
        push(['Difference vs invoice total (rounding / free-typed invoice lines)', n(report.activity.income_unexplained), '', '']);
    }
    push([]);

    // ── Section C — Expense Heads ──
    push(['SECTION C — EXPENSE HEADS', 'Amount (Rs)', 'Vouchers', ''], true);
    for (const h of report.expense_heads) push([h.head, n(h.amount), h.count, '']);
    push(['TOTAL OPERATING EXPENSES', n(report.activity.operating_expenses), '', ''], true);
    push(['Cost of Goods Sold (milk + purchases)', n(report.activity.cogs), '', '']);
    push(['TOTAL EXPENSES', n(n(report.activity.operating_expenses) + n(report.activity.cogs)), '', ''], true);
    push([]);

    // ── Section D — Monthly Closing ──
    push([
        'SECTION D — MONTHLY CLOSING', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''
    ], true);
    push([
        'Month', 'Start (BS)', 'End (BS)', 'Opening Cash', 'Opening Bank', 'Opening Inventory',
        'Sales', 'Other Income', 'Cost of Goods Sold', 'Gross Profit', 'Total Expenses',
        'Net Profit / (Loss)', 'Rent Expense', 'Closing Cash', 'Closing Bank', 'Closing Inventory',
        'Closing Receivables', 'Closing Payables', 'Closing Advances', 'Closing Prepaid Rent'
    ], true);
    for (const m of report.months) {
        push([
            `${m.label} (${m.month})`, m.from_date, m.to_date,
            n(m.opening_cash), n(m.opening_bank), n(m.opening_inventory),
            n(m.sales_revenue), n(m.other_income), n(m.cogs), n(m.gross_profit), n(m.total_expenses),
            n(m.net_profit), n(m.rent_expense),
            n(m.closing_cash), n(m.closing_bank), n(m.closing_inventory),
            n(m.closing_receivables), n(m.closing_payables), n(m.closing_advances), n(m.closing_prepaid_rent)
        ]);
    }
    const sumCol = (key) => report.months.reduce((acc, m) => acc + n(m[key]), 0);
    push([
        'PERIOD TOTAL', report.from_date, report.to_date,
        n(report.opening.cash), n(report.opening.bank), n(report.opening.inventory),
        sumCol('sales_revenue'), sumCol('other_income'), sumCol('cogs'), sumCol('gross_profit'), sumCol('total_expenses'),
        sumCol('net_profit'), sumCol('rent_expense'),
        n(report.closing.cash), n(report.closing.bank), n(report.closing.inventory),
        n(report.closing.receivables), n(report.closing.payables), n(report.closing.advances), n(report.closing.prepaid_rent)
    ], true);
    push([]);

    // ── Section E — Reconciliation ──
    push(['SECTION E — RECONCILIATION', 'Expected', 'Actual', 'Difference', 'Status', 'Note'], true);
    for (const c of report.reconciliation.checks) {
        push([c.check, n(c.expected), n(c.actual), n(c.difference), c.ok ? 'OK' : 'FLAG', c.note || '']);
    }
    push([report.reconciliation.all_ok
        ? 'All reconciliation checks agree.'
        : `${report.reconciliation.differences.length} check(s) FLAGGED — investigate before closing the period.`, '', '', '', ''], true);
    push([]);

    // ── Notes & gaps ──
    push(['NOTES', ''], true);
    for (const note of report.notes.notes) push([note, '']);
    if (report.notes.gaps.length) {
        push(['DATA GAPS — figures that cannot be relied on yet', ''], true);
        for (const gap of report.notes.gaps) push([gap, '']);
    }
    push([]);
    push(['Prepared By:', '', '', 'Checked By:', ''], true);

    // ── Worksheet ──
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    // Currency formatting on money cells. Column D carries '% of Sales' in
    // Section B and money in Section D, so the format is decided per row.
    const range = XLSX.utils.decode_range(sheet['!ref']);
    let section = '';
    for (let r = 0; r <= range.e.r; r++) {
        const first = String(rows[r] && rows[r][0] || '');
        if (/^SECTION [A-E]/.test(first)) section = first.slice(8, 9);
        for (let c = 0; c <= range.e.c; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            if (!cell || cell.t !== 'n') continue;
            if (section === 'B' && c === 3) { cell.z = '0.00'; continue; }
            cell.z = c === 2 && section === 'B' ? '0' : MONEY;
        }
    }
    sheet['!cols'] = [
        { wch: 56 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 70 },
        { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
        { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
        { wch: 16 }, { wch: 18 }
    ];
    sheet['!autofilter'] = { ref: 'A1:F1' };
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 };

    return { rows, sheet, report, meta: { bold, sheetName: SHEET_NAME } };
}

/** Standalone workbook with just the Monthly Report sheet. */
function exportMonthlyReportExcel(db, outputPath, opts = {}) {
    try {
        const built = buildMonthlyReportSheet(db, opts);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, built.sheet, SHEET_NAME);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        XLSX.writeFile(wb, outputPath, { bookType: 'xlsx', type: 'file' });
        return {
            success: true,
            filePath: outputPath,
            period: { from_date: built.report.from_date, to_date: built.report.to_date },
            net_profit: built.report.summary.net_profit,
            reconciled: built.report.reconciliation.all_ok,
            checks_flagged: built.report.reconciliation.differences.length
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/** Which SECTION letter each row belongs to (for number formats). */
function sectionOfRows(rows) {
    const out = [];
    let section = '';
    for (const row of rows) {
        const first = String((row && row[0]) || '');
        if (/^SECTION [A-E]/.test(first)) section = first.slice(8, 9);
        out.push(section);
    }
    return out;
}

/**
 * Insert (or refresh) the "Monthly Report " sheet inside an EXISTING workbook,
 * leaving every other sheet untouched. Writes a `.bak-<timestamp>` copy of the
 * original first.
 *
 * The sheet is spliced in at the OOXML **part** level (shared/xlsx-parts.js)
 * rather than read-and-rewritten with SheetJS: a SheetJS rewrite silently
 * discards the workbook's fonts/fills/formats, its chart, its table and its
 * printer settings (72 fonts, 32 fills, 296 formats lost — caught 2026-10-17).
 * Part-level surgery copies every other zip entry byte for byte, so styles,
 * formulas and history survive.
 *
 * @param {string} workbookPath  the workbook to modify (in place)
 * @param {object} db
 * @param {object} opts          pass-through to getMonthlyReport
 * @returns {{success:boolean, filePath?:string, backupPath?:string, sheets?:string[], error?:string}}
 */
function insertMonthlyReportSheet(workbookPath, db, opts = {}) {
    try {
        if (!fs.existsSync(workbookPath)) {
            return { success: false, error: `Workbook not found: ${workbookPath}` };
        }
        const built = buildMonthlyReportSheet(db, opts);

        // Backup the original before writing anything.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${workbookPath}.bak-monthly-report-${stamp}`;
        fs.copyFileSync(workbookPath, backupPath);

        const section = sectionOfRows(built.rows);
        const widths = (built.sheet['!cols'] || []).map(c => (c && c.wch) || 12);
        const res = appendOrReplaceSheet(workbookPath, SHEET_NAME, {
            aoa: built.rows,
            columnWidths: widths,
            freezeRow: 1,
            autoFilter: 'A1:F1',
            // Section B col 1 = money, col 2 = document-line counts, col 3 = %;
            // everywhere else every number is money (same rules as the
            // standalone export above, so both files format alike).
            isMoney: (r, c) => !(section[r] === 'B' && c !== 1),
            isDecimal: (r, c) => section[r] === 'B' && c === 3,
            isInteger: (r, c) => section[r] === 'B' && c === 2
        });

        return {
            success: true,
            filePath: workbookPath,
            backupPath,
            sheetName: res.sheetName ?? SHEET_NAME,
            created: res.created,
            sheets: res.sheets,
            period: { from_date: built.report.from_date, to_date: built.report.to_date },
            rows: built.rows.length,
            reconciled: built.report.reconciliation.all_ok,
            checks_flagged: built.report.reconciliation.differences.length
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    SHEET_NAME,
    buildMonthlyReportSheet,
    exportMonthlyReportExcel,
    insertMonthlyReportSheet
};
