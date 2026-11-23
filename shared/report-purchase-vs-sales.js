/**
 * Prarambha Account & Stock Management — Purchase vs Sales printable report
 * ========================================================================
 * Builds the print / PDF document for the Purchase vs Sales report from the
 * SAME engine the screen uses (`operations/purchase_vs_sales`), so the paper
 * and the screen can never disagree.
 *
 * The returned HTML is used by:
 *   · renderer `printHTML()` (in-app print via a hidden iframe)
 *   · Electron `print:pdf` (a real PDF through webContents.printToPDF)
 *
 * Layout rules that matter for paper:
 *   · one table header per section, `thead` repeats on every printed page
 *   · fixed column widths + word wrapping so no column is cut off
 *   · dates are printed in the app's own BS calendar
 */

const bsCalendar = require('./bs-calendar');
const { getPurchaseVsSales } = require('./operations/purchase_vs_sales');

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** "Rs. 1,234.50" — ASCII currency so no font is missing a glyph in a PDF. */
function money(value) {
    const n = Number(value) || 0;
    const formatted = Math.abs(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return (n < 0 ? '-Rs. ' : 'Rs. ') + formatted;
}

function numbers(value) {
    const n = Number(value) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signedMoney(value) {
    const n = Number(value) || 0;
    const sign = n > 0.004 ? '+' : n < -0.004 ? '-' : '';
    return sign + money(Math.abs(n)).replace('-Rs. ', 'Rs. ');
}

/** 2083-08-02 → "2083 Bhadra 2" (the BS calendar the app uses). */
function bsLabel(dateStr) {
    const part = bsCalendar.parseBSDate(dateStr);
    if (!part) return escapeHtml(dateStr || '');
    const month = bsCalendar.BS_MONTHS_EN[part.month - 1] || '';
    return `${part.year} ${month} ${part.day}`;
}

function statusCell(status) {
    const value = String(status || '').toLowerCase();
    if (!value) return '—';
    const css = value === 'paid' ? 'status-paid' : value === 'partial' ? 'status-partial' : 'status-unpaid';
    return `<span class="${css}">${escapeHtml(value.charAt(0).toUpperCase() + value.slice(1))}</span>`;
}

function qtyCell(quantity, unit) {
    if (!Number(quantity)) return '—';
    const label = unit === 'mixed' ? '' : (unit || '');
    return `${numbers(quantity)}${label ? ' ' + escapeHtml(label) : ''}`;
}

function differenceClass(value) {
    if (Number(value) > 0.004) return 'pvs-pos';
    if (Number(value) < -0.004) return 'pvs-neg';
    return 'pvs-zero';
}

function filterLine(filters, report) {
    const bits = [];
    if (filters.product) bits.push('Item contains "' + filters.product + '"');
    if (filters.reference) bits.push('Reference contains "' + filters.reference + '"');
    if (filters.payment_mode) bits.push('Mode: ' + filters.payment_mode);
    if (filters.purchase_party_id) {
        const found = report.options.purchase_parties.find(p => p.id === Number(filters.purchase_party_id));
        bits.push('Supplier: ' + (found ? found.name : '#' + filters.purchase_party_id));
    }
    if (filters.sales_party_id) {
        const found = report.options.sales_parties.find(p => p.id === Number(filters.sales_party_id));
        bits.push('Customer: ' + (found ? found.name : '#' + filters.sales_party_id));
    }
    return bits.length ? `<p class="business-detail">Filters — ${escapeHtml(bits.join(' · '))}</p>` : '';
}

const REPORT_CSS = `
    /* Summary strip: five equal cards that never wrap a money figure. */
    .pvs-cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 8px 0 6px; }
    .pvs-card { border: 1px solid #d0d8e0; border-radius: 4px; padding: 6px 4px; text-align: center; background: #f5f7fa; }
    .pvs-card .lbl { font-size: 6.2pt; text-transform: uppercase; color: #667; letter-spacing: 0.2px; line-height: 1.25; }
    .pvs-card .val { font-size: 9.5pt; font-weight: 700; color: #1a5276; white-space: nowrap; margin-top: 3px; }
    .pvs-card .sub { font-size: 6.2pt; color: #888; margin-top: 2px; }
    .pvs-card.neg { border-left: 3px solid #c0392b; }
    .pvs-card.pos { border-left: 3px solid #1e8449; }
    .pvs-table { table-layout: fixed; width: 100%; }
    .pvs-table th, .pvs-table td { overflow-wrap: break-word; word-break: break-word; }
    .pvs-table.compact th, .pvs-table.compact td { padding: 3px 5px; font-size: 7pt; }
    .pvs-num { text-align: right; }
    .pvs-pos { color: #1e8449; }
    .pvs-neg { color: #c0392b; }
    .pvs-zero { color: #999; }
    .pvs-note { margin: 10px 0 4px; padding: 7px 10px; border-left: 3px solid #1a5276; background: #f7f9fb; font-size: 8pt; color: #444; }
    .pvs-meta { font-size: 8pt; color: #555; margin: 2px 0 8px; }
    .pvs-section { page-break-inside: auto; }
    .pvs-empty { text-align: center; color: #888; padding: 10px; font-size: 8.5pt; }
    .pvs-sub { font-size: 7.5pt; color: #666; }
`;

/**
 * @param {object} db
 * @param {object} opts same filters as getPurchaseVsSales()
 * @returns {{ html:string, filename:string, title:string, report:object }}
 */
function buildPurchaseVsSalesHTML(db, opts = {}) {
    const report = getPurchaseVsSales(db, opts);

    let settings = {};
    try {
        settings = require('./operations/settings').getSettings(db) || {};
    } catch (e) {
        settings = {};
    }

    const businessName = settings.business_name || 'Prarambha Account & Stock Management';
    const businessDetail = [settings.address, settings.phone, settings.pan_vat].filter(Boolean).join(' · ');
    const period = report.from_date || report.to_date
        ? `${report.from_date ? bsLabel(report.from_date) : 'Beginning'} to ${report.to_date ? bsLabel(report.to_date) : 'Today'}`
        : 'All dates';
    const summary = report.summary;
    const printedAt = new Date().toLocaleString('en-GB');

    // ── Daily comparison ──
    const dailyRows = report.daily.length
        ? report.daily.map(day => `
            <tr>
                <td>${bsLabel(day.date)}<div class="pvs-sub">${escapeHtml(day.date)}</div></td>
                <td class="pvs-num">${day.purchase_amount ? money(day.purchase_amount) : '<span class="pvs-zero">—</span>'}</td>
                <td class="pvs-num">${day.sales_amount ? money(day.sales_amount) : '<span class="pvs-zero">—</span>'}</td>
                <td class="pvs-num ${differenceClass(day.difference)}">${day.difference ? signedMoney(day.difference) : '<span class="pvs-zero">—</span>'}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="pvs-empty">No activity in this period</td></tr>';

    // ── Party summaries ──
    const purchasePartyRows = report.purchase_parties.length
        ? report.purchase_parties.map(row => `
            <tr>
                <td>${escapeHtml(row.party_name)}</td>
                <td class="pvs-num">${row.transactions}</td>
                <td class="pvs-num">${qtyCell(row.quantity, row.quantity_unit)}</td>
                <td class="pvs-num">${money(row.amount)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="pvs-empty">No purchases in this period</td></tr>';

    const salesPartyRows = report.sales_parties.length
        ? report.sales_parties.map(row => `
            <tr>
                <td>${escapeHtml(row.party_name)}</td>
                <td class="pvs-num">${row.transactions}</td>
                <td class="pvs-num">${qtyCell(row.quantity, row.quantity_unit)}</td>
                <td class="pvs-num">${money(row.amount)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="pvs-empty">No sales in this period</td></tr>';

    // ── Detailed records ──
    const purchaseDetailRows = report.purchase_lines.length
        ? report.purchase_lines.map(line => `
            <tr>
                <td>${escapeHtml(line.date)}</td>
                <td>${escapeHtml(line.party_name)}</td>
                <td>${escapeHtml(line.reference)}</td>
                <td>${escapeHtml(line.product)}</td>
                <td class="pvs-num">${line.quantity ? numbers(line.quantity) : '—'}</td>
                <td>${line.unit ? escapeHtml(line.unit) : '—'}</td>
                <td class="pvs-num">${line.rate ? money(line.rate) : '—'}</td>
                <td class="pvs-num">${money(line.amount)}</td>
                <td>${statusCell(line.status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="9" class="pvs-empty">No purchase records in this period</td></tr>';

    const salesDetailRows = report.sales_lines.length
        ? report.sales_lines.map(line => `
            <tr>
                <td>${escapeHtml(line.date)}</td>
                <td>${escapeHtml(line.party_name)}</td>
                <td>${escapeHtml(line.reference)}</td>
                <td>${escapeHtml(line.product)}</td>
                <td class="pvs-num">${line.quantity ? numbers(line.quantity) : '—'}</td>
                <td>${line.unit ? escapeHtml(line.unit) : '—'}</td>
                <td class="pvs-num">${line.rate ? money(line.rate) : '—'}</td>
                <td class="pvs-num">${money(line.amount)}</td>
                <td>${statusCell(line.status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="9" class="pvs-empty">No sales records in this period</td></tr>';

    const html = `
    <style>${REPORT_CSS}</style>
    <div class="header">
        <h1>${escapeHtml(businessName)}</h1>
        <h2>Daily Purchase vs Sales Report</h2>
        <p>Period: ${escapeHtml(period)}</p>
        ${businessDetail ? `<p class="business-detail">${escapeHtml(businessDetail)}</p>` : ''}
        ${filterLine(report.filters, report)}
    </div>

    <div class="pvs-cards">
        <div class="pvs-card neg">
            <div class="lbl">Total Purchase</div>
            <div class="val">${money(summary.purchase_amount)}</div>
            <div class="sub">${summary.purchase_transactions} bills</div>
        </div>
        <div class="pvs-card pos">
            <div class="lbl">Total Sales</div>
            <div class="val">${money(summary.sales_amount)}</div>
            <div class="sub">${summary.sales_transactions} invoices</div>
        </div>
        <div class="pvs-card ${summary.difference >= 0 ? 'pos' : 'neg'}">
            <div class="lbl">Difference (Sales−Purchase)</div>
            <div class="val">${signedMoney(summary.difference)}</div>
            <div class="sub">trading gap, not profit</div>
        </div>
        <div class="pvs-card">
            <div class="lbl">Purchase Qty</div>
            <div class="val">${summary.purchase_quantity ? numbers(summary.purchase_quantity) : '0.00'}</div>
            <div class="sub">${summary.purchase_quantity_unit === 'mixed' ? 'mixed units' : escapeHtml(summary.purchase_quantity_unit || '')}</div>
        </div>
        <div class="pvs-card">
            <div class="lbl">Sales Qty</div>
            <div class="val">${summary.sales_quantity ? numbers(summary.sales_quantity) : '0.00'}</div>
            <div class="sub">${summary.sales_quantity_unit === 'mixed' ? 'mixed units' : escapeHtml(summary.sales_quantity_unit || '')}</div>
        </div>
    </div>

    <div class="pvs-note">
        <strong>How to read this report:</strong> purchases and sales are the original purchase bills and sales
        invoices dated inside the selected period. The difference is <strong>Sales − Purchase</strong>, a
        trading gap only — operating expenses, stock changes, other income and accounting adjustments are not
        included, so it is <strong>not a profit figure</strong>. Payments to suppliers and collections from
        customers are money settlements and are never counted as another purchase or sale.
    </div>

    <div class="section-title">Daily Comparison</div>
    <table class="pvs-table">
        <colgroup><col style="width:28%"><col style="width:24%"><col style="width:24%"><col style="width:24%"></colgroup>
        <thead><tr><th>Date</th><th class="pvs-num">Purchase Amount</th><th class="pvs-num">Sales Amount</th><th class="pvs-num">Difference</th></tr></thead>
        <tbody>${dailyRows}</tbody>
        <tfoot>
            <tr>
                <td>Total (${report.daily.length} days)</td>
                <td class="pvs-num">${money(summary.purchase_amount)}</td>
                <td class="pvs-num">${money(summary.sales_amount)}</td>
                <td class="pvs-num ${differenceClass(summary.difference)}">${signedMoney(summary.difference)}</td>
            </tr>
        </tfoot>
    </table>

    <div class="section-title">Supplier-wise Purchases</div>
    <table class="pvs-table">
        <colgroup><col style="width:46%"><col style="width:14%"><col style="width:18%"><col style="width:22%"></colgroup>
        <thead><tr><th>Supplier</th><th class="pvs-num">Bills</th><th class="pvs-num">Quantity</th><th class="pvs-num">Purchase Amount</th></tr></thead>
        <tbody>${purchasePartyRows}</tbody>
        <tfoot><tr><td>Total (${report.purchase_parties.length} suppliers)</td><td class="pvs-num">${summary.purchase_transactions}</td><td class="pvs-num">${qtyCell(summary.purchase_quantity, summary.purchase_quantity_unit)}</td><td class="pvs-num">${money(summary.purchase_amount)}</td></tr></tfoot>
    </table>

    <div class="section-title">Customer-wise Sales</div>
    <table class="pvs-table">
        <colgroup><col style="width:46%"><col style="width:14%"><col style="width:18%"><col style="width:22%"></colgroup>
        <thead><tr><th>Customer</th><th class="pvs-num">Invoices</th><th class="pvs-num">Quantity</th><th class="pvs-num">Sales Amount</th></tr></thead>
        <tbody>${salesPartyRows}</tbody>
        <tfoot><tr><td>Total (${report.sales_parties.length} customers)</td><td class="pvs-num">${summary.sales_transactions}</td><td class="pvs-num">${qtyCell(summary.sales_quantity, summary.sales_quantity_unit)}</td><td class="pvs-num">${money(summary.sales_amount)}</td></tr></tfoot>
    </table>

    <div class="section-title page-break">Purchase Records (${report.purchase_lines.length} rows)</div>
    <table class="pvs-table compact">
        <colgroup>
            <col style="width:10%"><col style="width:19%"><col style="width:10%"><col style="width:17%">
            <col style="width:8%"><col style="width:6%"><col style="width:8%"><col style="width:14%"><col style="width:8%">
        </colgroup>
        <thead><tr>
            <th>Date</th><th>Supplier</th><th>Bill No</th><th>Item</th>
            <th class="pvs-num">Qty</th><th>Unit</th><th class="pvs-num">Rate</th><th class="pvs-num">Amount</th><th>Status</th>
        </tr></thead>
        <tbody>${purchaseDetailRows}</tbody>
        <tfoot><tr><td colspan="7">Total Purchases — ${summary.purchase_transactions} bills</td><td class="pvs-num">${money(summary.purchase_amount)}</td><td></td></tr></tfoot>
    </table>

    <div class="section-title page-break">Sales Records (${report.sales_lines.length} rows)</div>
    <table class="pvs-table compact">
        <colgroup>
            <col style="width:10%"><col style="width:19%"><col style="width:10%"><col style="width:17%">
            <col style="width:8%"><col style="width:6%"><col style="width:8%"><col style="width:14%"><col style="width:8%">
        </colgroup>
        <thead><tr>
            <th>Date</th><th>Customer</th><th>Invoice No</th><th>Item</th>
            <th class="pvs-num">Qty</th><th>Unit</th><th class="pvs-num">Rate</th><th class="pvs-num">Amount</th><th>Status</th>
        </tr></thead>
        <tbody>${salesDetailRows}</tbody>
        <tfoot><tr><td colspan="7">Total Sales — ${summary.sales_transactions} invoices</td><td class="pvs-num">${money(summary.sales_amount)}</td><td></td></tr></tfoot>
    </table>

    <div class="pvs-meta">
        Reconciled with the original records: purchase ${money(report.reconciliation.purchase_document_total)} across
        ${report.reconciliation.purchase_documents} bills, sales ${money(report.reconciliation.sales_document_total)} across
        ${report.reconciliation.sales_documents} invoices.
    </div>

    <div class="footer">
        <div>Printed: ${escapeHtml(printedAt)}</div>
        <div class="signature">Authorized Signature</div>
    </div>`;

    const fromPart = report.from_date || 'start';
    const toPart = report.to_date || 'end';
    const filename = `Purchase_vs_Sales_${fromPart}_to_${toPart}.pdf`;

    return {
        html,
        filename,
        title: `Daily Purchase vs Sales Report — ${period}`,
        period,
        report
    };
}

module.exports = { buildPurchaseVsSalesHTML };
