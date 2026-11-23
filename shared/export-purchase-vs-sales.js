/**
 * Purchase vs Sales — Excel export
 * ================================
 * Same engine and same filtered data as the on-screen report and the PDF
 * (`operations/purchase_vs_sales`), so an export can never disagree with them.
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const { getPurchaseVsSales } = require('./operations/purchase_vs_sales');

function widths(sheet, columns) {
    sheet['!cols'] = columns.map(wch => ({ wch }));
    return sheet;
}

/**
 * Build the workbook in memory (also handy for tests).
 * @returns {object} xlsx workbook
 */
function buildPurchaseVsSalesWorkbook(db, opts = {}) {
    const report = getPurchaseVsSales(db, opts);
    const summary = report.summary;
    const period = `${report.from_date || 'Start'} to ${report.to_date || 'End'}`;
    const wb = XLSX.utils.book_new();

    const summaryRows = [
        ['Purchase vs Sales Report'],
        ['Period', period],
        ['Days compared', report.daily.length],
        [],
        ['Metric', 'Value'],
        ['Total Purchase Amount', summary.purchase_amount],
        ['Total Sales Amount', summary.sales_amount],
        ['Difference (Sales - Purchase)', summary.difference],
        ['Purchase Quantity', summary.purchase_quantity],
        ['Sales Quantity', summary.sales_quantity],
        ['Purchase Transactions', summary.purchase_transactions],
        ['Sales Transactions', summary.sales_transactions],
        ['Purchase Parties', summary.purchase_parties],
        ['Sales Parties', summary.sales_parties],
        [],
        ['Note', 'The difference is Sales - Purchase (a trading gap), not profit.'],
        ['Reconciled purchase total', report.reconciliation.purchase_document_total],
        ['Reconciled sales total', report.reconciliation.sales_document_total]
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(summaryRows), [38, 28]), 'Summary');

    const dailyRows = [
        ['Date', 'Purchase Amount', 'Sales Amount', 'Difference', 'Purchase Qty', 'Sales Qty', 'Purchase Bills', 'Sales Invoices'],
        ...report.daily.map(day => [
            day.date, day.purchase_amount, day.sales_amount, day.difference,
            day.purchase_quantity, day.sales_quantity, day.purchase_count, day.sales_count
        ]),
        ['Total', summary.purchase_amount, summary.sales_amount, summary.difference,
            summary.purchase_quantity, summary.sales_quantity, summary.purchase_transactions, summary.sales_transactions]
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(dailyRows), [14, 16, 16, 14, 14, 14, 14, 14]), 'Daily_Comparison');

    const purchasePartyRows = [
        ['Supplier', 'Transactions', 'Quantity', 'Purchase Amount'],
        ...report.purchase_parties.map(row => [row.party_name, row.transactions, row.quantity, row.amount]),
        ['Total', summary.purchase_transactions, summary.purchase_quantity, summary.purchase_amount]
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(purchasePartyRows), [34, 14, 16, 18]), 'Purchase_Parties');

    const salesPartyRows = [
        ['Customer', 'Transactions', 'Quantity', 'Sales Amount'],
        ...report.sales_parties.map(row => [row.party_name, row.transactions, row.quantity, row.amount]),
        ['Total', summary.sales_transactions, summary.sales_quantity, summary.sales_amount]
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(salesPartyRows), [34, 14, 16, 18]), 'Sales_Parties');

    const purchaseRows = [
        ['Date', 'Supplier', 'Bill No', 'Item', 'Quantity', 'Unit', 'Rate', 'Amount', 'Status', 'Mode'],
        ...report.purchase_lines.map(line => [
            line.date, line.party_name, line.reference, line.product, line.quantity,
            line.unit, line.rate, line.amount, line.status, line.payment_mode
        ]),
        ['Total', '', '', '', '', '', '', summary.purchase_amount, '', '']
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(purchaseRows), [12, 30, 14, 22, 10, 8, 10, 14, 10, 10]), 'Purchase_Details');

    const salesRows = [
        ['Date', 'Customer', 'Invoice No', 'Item', 'Quantity', 'Unit', 'Rate', 'Amount', 'Status', 'Mode'],
        ...report.sales_lines.map(line => [
            line.date, line.party_name, line.reference, line.product, line.quantity,
            line.unit, line.rate, line.amount, line.status, line.payment_mode
        ]),
        ['Total', '', '', '', '', '', '', summary.sales_amount, '', '']
    ];
    XLSX.utils.book_append_sheet(wb, widths(XLSX.utils.aoa_to_sheet(salesRows), [12, 30, 14, 22, 10, 8, 10, 14, 10, 10]), 'Sales_Details');

    return { workbook: wb, report };
}

/**
 * Write the report to `outputPath`.
 * @returns {{ success:boolean, filePath?:string, rows?:object, error?:string }}
 */
function exportPurchaseVsSalesExcel(db, outputPath, opts = {}) {
    try {
        const built = buildPurchaseVsSalesWorkbook(db, opts);
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        XLSX.writeFile(built.workbook, outputPath, { bookType: 'xlsx', type: 'file' });
        const report = built.report;
        return {
            success: true,
            filePath: outputPath,
            rows: {
                daily: report.daily.length,
                purchase_lines: report.purchase_lines.length,
                sales_lines: report.sales_lines.length,
                purchase_parties: report.purchase_parties.length,
                sales_parties: report.sales_parties.length
            },
            totals: {
                purchase: report.summary.purchase_amount,
                sales: report.summary.sales_amount,
                difference: report.summary.difference
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { buildPurchaseVsSalesWorkbook, exportPurchaseVsSalesExcel };
