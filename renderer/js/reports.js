/**
 * Reports Module
 * Sales report, purchase report, stock report, day book, outstanding reports
 */

async function renderReports() {
    const container = document.getElementById('page-reports');
    document.getElementById('topActions').innerHTML = '';

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr)">
            <div class="summary-card card-primary" style="cursor:pointer" onclick="showSalesReport()">
                <span class="label">📊 Sales Report</span>
                <span class="value" style="font-size:16px">View Details →</span>
            </div>
            <div class="summary-card card-success" style="cursor:pointer" onclick="showPurchasesReport()">
                <span class="label">📦 Purchase Report</span>
                <span class="value" style="font-size:16px">View Details →</span>
            </div>
            <div class="summary-card card-info" style="cursor:pointer" onclick="showDayBook()">
                <span class="label">📅 Day Book</span>
                <span class="value" style="font-size:16px">View Details →</span>
            </div>
            <div class="summary-card card-warning" style="cursor:pointer" onclick="showOutstandingReport()">
                <span class="label">💰 Outstanding</span>
                <span class="value" style="font-size:16px">View Details →</span>
            </div>
        </div>

        <div style="margin-top:20px">
            <div class="card" id="reportContent">
                <div style="text-align:center;padding:60px 20px;color:var(--text-light)">
                    <div style="font-size:48px;margin-bottom:16px">📈</div>
                    <h3>Select a Report</h3>
                    <p>Click on any report card above to generate a report with date filters, print, and PDF export.</p>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Sales Report
// ============================================================
async function showSalesReport(fromDate = '', toDate = '', partyId = '') {
    const container = document.getElementById('reportContent');

    if (!fromDate) {
        const preset = getDatePreset('this_month');
        fromDate = preset.from;
        toDate = preset.to;
    }

    const [reportResult, partiesResult] = await Promise.all([
        window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined }),
        window.api.getParties({ type: 'customer' })
    ]);

    const report = reportResult.success ? reportResult.data : { sales: [], total: 0 };
    const parties = partiesResult.success ? partiesResult.data : [];
    const settings = await getSettingsCached();

    container.innerHTML = `
        <div class="card-header">
            <h2>Sales Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printSalesReport('${fromDate}', '${toDate}', '${partyId}')">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportSalesReportPDF('${fromDate}', '${toDate}', '${partyId}')">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="srFrom" value="${fromDate}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="srTo" value="${toDate}">
            </div>
            <div class="form-group">
                <label>Party</label>
                <select class="form-control" id="srParty">
                    <option value="">All Customers</option>
                    ${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="applySalesReport()">Generate</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Total Sales</span>
                <span class="value" style="font-size:20px">${report.sales.length}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Revenue</span>
                <span class="value" style="font-size:20px">${formatCurrency(report.total)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Average Sale</span>
                <span class="value" style="font-size:20px">${formatCurrency(report.sales.length > 0 ? report.total / report.sales.length : 0)}</span>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th><th class="text-right">Paid</th><th>Status</th><th>Mode</th></tr>
                </thead>
                <tbody>
                    ${report.sales.map(s => `
                        <tr>
                            <td>${formatDate(s.date)}</td>
                            <td>${escapeHtml(s.invoice_no)}</td>
                            <td>${escapeHtml(s.party_name)}</td>
                            <td class="text-right">${formatCurrency(s.grand_total)}</td>
                            <td class="text-right">${formatCurrency(s.paid_amount)}</td>
                            <td>${statusBadge(s.status)}</td>
                            <td>${statusBadge(s.payment_mode)}</td>
                        </tr>
                    `).join('')}
                    ${report.sales.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No sales found for this period</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

function applySalesReport() {
    const from = document.getElementById('srFrom')?.value || '';
    const to = document.getElementById('srTo')?.value || '';
    const party = document.getElementById('srParty')?.value || '';
    showSalesReport(from, to, party);
}

// ============================================================
// Purchases Report
// ============================================================
async function showPurchasesReport(fromDate = '', toDate = '', partyId = '') {
    const container = document.getElementById('reportContent');

    if (!fromDate) {
        const preset = getDatePreset('this_month');
        fromDate = preset.from;
        toDate = preset.to;
    }

    const [reportResult, partiesResult] = await Promise.all([
        window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined }),
        window.api.getParties({ type: 'supplier' })
    ]);

    const report = reportResult.success ? reportResult.data : { purchases: [], total: 0 };
    const parties = partiesResult.success ? partiesResult.data : [];

    container.innerHTML = `
        <div class="card-header">
            <h2>Purchase Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printPurchasesReport('${fromDate}', '${toDate}', '${partyId}')">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportPurchasesReportPDF('${fromDate}', '${toDate}', '${partyId}')">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="prFrom" value="${fromDate}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="prTo" value="${toDate}">
            </div>
            <div class="form-group">
                <label>Supplier</label>
                <select class="form-control" id="prParty">
                    <option value="">All Suppliers</option>
                    ${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="applyPurchasesReport()">Generate</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Total Purchases</span>
                <span class="value" style="font-size:20px">${report.purchases.length}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Cost</span>
                <span class="value" style="font-size:20px">${formatCurrency(report.total)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Avg Cost</span>
                <span class="value" style="font-size:20px">${formatCurrency(report.purchases.length > 0 ? report.total / report.purchases.length : 0)}</span>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr><th>Date</th><th>Bill No</th><th>Supplier</th><th class="text-right">Subtotal</th><th class="text-right">Charges</th><th class="text-right">Total</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${report.purchases.map(p => `
                        <tr>
                            <td>${formatDate(p.date)}</td>
                            <td>${escapeHtml(p.bill_no)}</td>
                            <td>${escapeHtml(p.party_name)}</td>
                            <td class="text-right">${formatCurrency(p.subtotal)}</td>
                            <td class="text-right">${formatCurrency((p.transport_charges||0) + (p.extra_charges||0))}</td>
                            <td class="text-right">${formatCurrency(p.grand_total)}</td>
                            <td>${statusBadge(p.status)}</td>
                        </tr>
                    `).join('')}
                    ${report.purchases.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No purchases found</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

function applyPurchasesReport() {
    const from = document.getElementById('prFrom')?.value || '';
    const to = document.getElementById('prTo')?.value || '';
    const party = document.getElementById('prParty')?.value || '';
    showPurchasesReport(from, to, party);
}

// ============================================================
// Day Book
// ============================================================
async function showDayBook(date = '') {
    const container = document.getElementById('reportContent');
    if (!date) date = today();

    const result = await window.api.getDayBook(date);
    const data = result.success ? result.data : { sales: [], purchases: [], payments: [], totalSales: 0, totalPurchases: 0, totalPayments: 0 };

    container.innerHTML = `
        <div class="card-header">
            <h2>Day Book - ${formatDate(date)}</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printDayBook('${date}')">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportDayBookPDF('${date}')">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>Date</label>
                <input type="date" class="form-control" id="dbDate" value="${date}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="applyDayBook()">View</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Sales</span>
                <span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.totalSales)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Purchases</span>
                <span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.totalPurchases)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Net (Sales - Purchases)</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.totalSales - data.totalPurchases)}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">💰 Sales (${data.sales.length})</h3>
                <div class="table-container" style="max-height:300px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Invoice</th><th>Party</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${data.sales.map(s => `<tr><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td></tr>`).join('')}
                            ${data.sales.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No sales</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">📦 Purchases (${data.purchases.length})</h3>
                <div class="table-container" style="max-height:300px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Bill</th><th>Supplier</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${data.purchases.map(p => `<tr><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}
                            ${data.purchases.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No purchases</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function applyDayBook() {
    const date = document.getElementById('dbDate')?.value || today();
    showDayBook(date);
}

// ============================================================
// Outstanding Reports
// ============================================================
async function showOutstandingReport() {
    const container = document.getElementById('reportContent');

    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);

    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];
    const totalReceivable = receivables.reduce((s, r) => s + r.outstanding, 0);
    const totalPayable = payables.reduce((s, p) => s + p.outstanding, 0);

    container.innerHTML = `
        <div class="card-header">
            <h2>Outstanding Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printOutstandingReport()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportOutstandingPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Receivables (Due to You)</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalReceivable)}</span>
                <span class="sub">From ${receivables.length} customers</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Payables (You Owe)</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalPayable)}</span>
                <span class="sub">To ${payables.length} suppliers</span>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Net Position</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalReceivable - totalPayable)}</span>
                <span class="sub">${totalReceivable >= totalPayable ? 'Positive (Net Receivable)' : 'Negative (Net Payable)'}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">💰 Outstanding Receivables</h3>
                <div class="table-container" style="max-height:300px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Customer</th><th>Phone</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${receivables.map(r => `<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${escapeHtml(r.phone || '-')}</td><td class="text-right" style="color:var(--accent)">${formatCurrency(r.outstanding)}</td></tr>`).join('')}
                            ${receivables.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No outstanding receivables</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">⚠️ Outstanding Payables</h3>
                <div class="table-container" style="max-height:300px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Supplier</th><th>Phone</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${payables.map(p => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.phone || '-')}</td><td class="text-right" style="color:var(--danger)">${formatCurrency(p.outstanding)}</td></tr>`).join('')}
                            ${payables.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No outstanding payables</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Print / PDF Report Helpers
// ============================================================
async function printSalesReport(fromDate, toDate, partyId) {
    const result = await window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Sales Report</h2>
            <p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total Sales: ${report.sales.length} | Total: ${formatCurrency(report.total)}</p>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th><th class="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>
                ${report.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td><td class="text-right">${formatCurrency(s.paid_amount)}</td><td>${s.status}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportSalesReportPDF(fromDate, toDate, partyId) {
    const result = await window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Sales Report</h2>
            <p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total: ${formatCurrency(report.total)}</p>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th></tr></thead>
            <tbody>${report.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td></tr>`).join('')}</tbody>
        </table>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

async function printPurchasesReport(fromDate, toDate, partyId) {
    const result = await window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Purchase Report</h2><p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total: ${formatCurrency(report.total)}</p></div>
        <table><thead><tr><th>Date</th><th>Bill</th><th>Supplier</th><th class="text-right">Total</th></tr></thead><tbody>${report.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportPurchasesReportPDF(fromDate, toDate, partyId) {
    const result = await window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Purchase Report</h2><p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total: ${formatCurrency(report.total)}</p></div>
        <table><thead><tr><th>Date</th><th>Bill</th><th>Supplier</th><th class="text-right">Total</th></tr></thead><tbody>${report.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

async function printDayBook(date) {
    const result = await window.api.getDayBook(date);
    if (!result.success) return;
    const data = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Day Book</h2><p>Date: ${formatDate(date)}</p></div>
        <div style="display:flex;gap:20px;margin:10px 0"><span>Sales: ${formatCurrency(data.totalSales)}</span><span>Purchases: ${formatCurrency(data.totalPurchases)}</span></div>
        <table><thead><tr><th>Type</th><th>Ref #</th><th>Party</th><th class="text-right">Amount</th></tr></thead><tbody>
            ${data.sales.map(s => `<tr><td>Sale</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td></tr>`).join('')}
            ${data.purchases.map(p => `<tr><td>Purchase</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}
        </tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportDayBookPDF(date) {
    const result = await window.api.getDayBook(date);
    if (!result.success) return;
    const data = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Day Book</h2><p>Date: ${formatDate(date)}</p></div>
        <p>Sales: ${formatCurrency(data.totalSales)} | Purchases: ${formatCurrency(data.totalPurchases)}</p>
        <table><thead><tr><th>Type</th><th>Ref</th><th>Party</th><th class="text-right">Amount</th></tr></thead><tbody>
            ${data.sales.map(s => `<tr><td>Sale</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td></tr>`).join('')}
            ${data.purchases.map(p => `<tr><td>Purchase</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}
        </tbody></table>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

async function printOutstandingReport() {
    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);
    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Outstanding Report</h2><p>Date: ${formatDate(today())}</p></div>
        <table><thead><tr><th>Party</th><th>Type</th><th class="text-right">Amount</th></tr></thead><tbody>
            ${receivables.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>Receivable</td><td class="text-right">${formatCurrency(r.outstanding)}</td></tr>`).join('')}
            ${payables.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>Payable</td><td class="text-right">${formatCurrency(p.outstanding)}</td></tr>`).join('')}
        </tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportOutstandingPDF() {
    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);
    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Outstanding Report</h2><p>Date: ${formatDate(today())}</p></div>
        <table><thead><tr><th>Party</th><th>Type</th><th class="text-right">Amount</th></tr></thead><tbody>
            ${receivables.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>Receivable</td><td class="text-right">${formatCurrency(r.outstanding)}</td></tr>`).join('')}
            ${payables.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>Payable</td><td class="text-right">${formatCurrency(p.outstanding)}</td></tr>`).join('')}
        </tbody></table>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

// Globals
window.showSalesReport = showSalesReport;
window.showPurchasesReport = showPurchasesReport;
window.showDayBook = showDayBook;
window.showOutstandingReport = showOutstandingReport;
window.applySalesReport = applySalesReport;
window.applyPurchasesReport = applyPurchasesReport;
window.applyDayBook = applyDayBook;
window.printSalesReport = printSalesReport;
window.exportSalesReportPDF = exportSalesReportPDF;
window.printPurchasesReport = printPurchasesReport;
window.exportPurchasesReportPDF = exportPurchasesReportPDF;
window.printDayBook = printDayBook;
window.exportDayBookPDF = exportDayBookPDF;
window.printOutstandingReport = printOutstandingReport;
window.exportOutstandingPDF = exportOutstandingPDF;
