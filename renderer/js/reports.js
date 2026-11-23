/**
 * Reports Module
 * Enhanced: Sales report, purchase report, stock report, day book (date range),
 * outstanding reports, sales register, purchase register
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
            <div class="summary-card card-primary" style="cursor:pointer" onclick="showSalesRegister()">
                <span class="label">📋 Sales Register</span>
                <span class="value" style="font-size:16px">Detailed →</span>
            </div>
            <div class="summary-card card-danger" style="cursor:pointer" onclick="showPurchaseRegister()">
                <span class="label">📋 Purchase Register</span>
                <span class="value" style="font-size:16px">Detailed →</span>
            </div>
            <div class="summary-card card-success" style="cursor:pointer" onclick="showFarmerStatement()">
                <span class="label">🧑‍🌾 Farmer Statement</span>
                <span class="value" style="font-size:16px">With FAT/SNF →</span>
            </div>
            <div class="summary-card card-warning" style="cursor:pointer" onclick="showPurchaseVsSales()">
                <span class="label">⚖️ Purchase vs Sales</span>
                <span class="value" style="font-size:16px">Daily Comparison →</span>
            </div>
            <div class="summary-card card-info" style="cursor:pointer" onclick="exportDailyAccountExcel()">
                <span class="label">📁 Export to Excel</span>
                <span class="value" style="font-size:16px">Daily Account Pro →</span>
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
// Sales Report (Enhanced)
// ============================================================
async function showSalesReport(fromDate = '', toDate = '', partyId = '', paymentMode = '', status = '') {
    const container = document.getElementById('reportContent');

    if (!fromDate) {
        const preset = getDatePreset('this_month');
        fromDate = preset.from;
        toDate = preset.to;
    }

    const [reportResult, partiesResult] = await Promise.all([
        window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined, payment_mode: paymentMode || undefined, status: status || undefined }),
        window.api.getParties({ type: 'customer' })
    ]);

    const report = reportResult.success ? reportResult.data : { sales: [], total: 0, totalPaid: 0, totalDue: 0, cashSales: 0, creditSales: 0, count: 0 };
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
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="srFrom" value="${fromDate}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="srTo" value="${toDate}"></div>
            <div class="form-group"><label>Party</label>
                <select class="form-control" id="srParty">
                    <option value="">All Customers</option>
                    ${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Mode</label>
                <select class="form-control" id="srMode">
                    <option value="">All</option><option value="cash" ${paymentMode === 'cash' ? 'selected' : ''}>Cash</option>
                    <option value="credit" ${paymentMode === 'credit' ? 'selected' : ''}>Credit</option>
                    <option value="bank" ${paymentMode === 'bank' ? 'selected' : ''}>Bank</option>
                    <option value="upi" ${paymentMode === 'upi' ? 'selected' : ''}>UPI</option>
                </select>
            </div>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="srStatus">
                    <option value="">All</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
                    <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                    <option value="partial" ${status === 'partial' ? 'selected' : ''}>Partial</option>
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applySalesReport()">Generate</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total Sales</span><span class="value" style="font-size:20px">${report.count}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Revenue</span><span class="value" style="font-size:20px">${formatCurrency(report.total)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Cash Sales</span><span class="value" style="font-size:18px">${formatCurrency(report.cashSales)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Due Amount</span><span class="value" style="font-size:18px">${formatCurrency(report.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th><th>Mode</th></tr></thead>
                <tbody>
                    ${report.sales.map(s => {
                        const due = s.grand_total - s.paid_amount;
                        return `<tr>
                            <td>${formatDate(s.date)}</td>
                            <td>${escapeHtml(s.invoice_no)}</td>
                            <td>${escapeHtml(s.party_name)}</td>
                            <td class="text-right">${formatCurrency(s.grand_total)}</td>
                            <td class="text-right">${formatCurrency(s.paid_amount)}</td>
                            <td class="text-right" style="color:${due > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(due)}</td>
                            <td>${statusBadge(s.status)}</td>
                            <td>${statusBadge(s.payment_mode)}</td>
                        </tr>`;
                    }).join('')}
                    ${report.sales.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No sales found</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

function applySalesReport() {
    const from = document.getElementById('srFrom')?.value || '';
    const to = document.getElementById('srTo')?.value || '';
    const party = document.getElementById('srParty')?.value || '';
    const mode = document.getElementById('srMode')?.value || '';
    const status = document.getElementById('srStatus')?.value || '';
    showSalesReport(from, to, party, mode, status);
}

// ============================================================
// Purchases Report (Enhanced)
// ============================================================
async function showPurchasesReport(fromDate = '', toDate = '', partyId = '', paymentMode = '', status = '') {
    const container = document.getElementById('reportContent');

    if (!fromDate) {
        const preset = getDatePreset('this_month');
        fromDate = preset.from;
        toDate = preset.to;
    }

    const [reportResult, partiesResult] = await Promise.all([
        window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined, payment_mode: paymentMode || undefined, status: status || undefined }),
        window.api.getParties({ type: 'supplier' })
    ]);

    const report = reportResult.success ? reportResult.data : { purchases: [], total: 0, totalPaid: 0, totalDue: 0, count: 0 };
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
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="prFrom" value="${fromDate}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="prTo" value="${toDate}"></div>
            <div class="form-group"><label>Supplier</label>
                <select class="form-control" id="prParty">
                    <option value="">All Suppliers</option>
                    ${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Mode</label>
                <select class="form-control" id="prMode">
                    <option value="">All</option><option value="cash" ${paymentMode === 'cash' ? 'selected' : ''}>Cash</option>
                    <option value="credit" ${paymentMode === 'credit' ? 'selected' : ''}>Credit</option>
                    <option value="bank" ${paymentMode === 'bank' ? 'selected' : ''}>Bank</option>
                </select>
            </div>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="prStatus">
                    <option value="">All</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
                    <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                    <option value="partial" ${status === 'partial' ? 'selected' : ''}>Partial</option>
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyPurchasesReport()">Generate</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total Purchases</span><span class="value" style="font-size:20px">${report.count}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Cost</span><span class="value" style="font-size:20px">${formatCurrency(report.total)}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Paid</span><span class="value" style="font-size:18px">${formatCurrency(report.totalPaid)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Due</span><span class="value" style="font-size:18px">${formatCurrency(report.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Bill No</th><th>Supplier</th><th class="text-right">Subtotal</th><th class="text-right">Charges</th><th class="text-right">Total</th><th class="text-right">Paid</th><th>Status</th></tr></thead>
                <tbody>
                    ${report.purchases.map(p => `
                        <tr>
                            <td>${formatDate(p.date)}</td>
                            <td>${escapeHtml(p.bill_no)}</td>
                            <td>${escapeHtml(p.party_name)}</td>
                            <td class="text-right">${formatCurrency(p.subtotal)}</td>
                            <td class="text-right">${formatCurrency((p.transport_charges||0) + (p.extra_charges||0))}</td>
                            <td class="text-right">${formatCurrency(p.grand_total)}</td>
                            <td class="text-right">${formatCurrency(p.paid_amount)}</td>
                            <td>${statusBadge(p.status)}</td>
                        </tr>
                    `).join('')}
                    ${report.purchases.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No purchases found</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

function applyPurchasesReport() {
    const from = document.getElementById('prFrom')?.value || '';
    const to = document.getElementById('prTo')?.value || '';
    const party = document.getElementById('prParty')?.value || '';
    const mode = document.getElementById('prMode')?.value || '';
    const status = document.getElementById('prStatus')?.value || '';
    showPurchasesReport(from, to, party, mode, status);
}

// ============================================================
// Day Book (Date Range)
// ============================================================
async function showDayBook(fromDate = '', toDate = '') {
    const container = document.getElementById('reportContent');
    // Default to the current BS month — a "today" default shows nothing when the
    // latest transaction is older than today (common with Excel-synced data).
    const preset = getDatePreset('this_month');
    if (!fromDate) fromDate = preset.from;
    if (!toDate) toDate = preset.to;

    const result = await window.api.getDayBook({ from_date: fromDate, to_date: toDate });
    const data = result.success ? result.data : { entries: [], totalDebit: 0, totalCredit: 0, net: 0, count: 0 };

    container.innerHTML = `
        <div class="card-header">
            <h2>Day Book — ${fromDate} to ${toDate}</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printDayBook('${fromDate}', '${toDate}')">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportDayBookPDF('${fromDate}', '${toDate}')">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="dbFrom" value="${fromDate}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="dbTo" value="${toDate}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyDayBook()">View</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="document.getElementById('dbFrom').value='';document.getElementById('dbTo').value='${preset.to}';applyDayBook()">Today</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('this_month');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDayBook()">This Month</button>
            </div>
            ${reportLangPicker('Language / भाषा')}
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total Entries</span><span class="value" style="font-size:20px">${data.count || 0}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Debit</span><span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.totalDebit)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Credit</span><span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.totalCredit)}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Net Balance</span><span class="value" style="font-size:18px">${formatCurrency(data.net)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Account/Party</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="actions">Actions</th></tr></thead>
                <tbody>
                    ${(data.entries || []).map(e => {
                        const type = e.type || '';
                        const entryId = e.id;
                        return `<tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.ref_no || '')}</td>
                            <td><span class="badge ${e.type === 'sale' || e.type === 'receipt' ? 'badge-success' : 'badge-danger'}">${e.transaction_type || e.type}</span></td>
                            <td>${escapeHtml(e.account || '')}</td>
                            <td>${escapeHtml(e.particulars || '')}</td>
                            <td class="text-right" style="color:${e.debit > 0 ? 'var(--accent)' : ''}">${e.debit > 0 ? formatCurrency(e.debit) : ''}</td>
                            <td class="text-right" style="color:${e.credit > 0 ? 'var(--danger)' : ''}">${e.credit > 0 ? formatCurrency(e.credit) : ''}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="viewDaybookEntry('${type}', ${entryId})" title="View details">📋</button>
                            </td>
                        </tr>`;
                    }).join('')}
                    ${(!data.entries || data.entries.length === 0) ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No transactions in this period</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="5"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.totalDebit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.totalCredit)}</strong></td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function applyDayBook() {
    const from = document.getElementById('dbFrom')?.value || '';
    const to = document.getElementById('dbTo')?.value || '';
    showDayBook(from, to);
}

// ============================================================
// Sales Register
// ============================================================
async function showSalesRegister(fromDate = '', toDate = '', partyId = '', status = '') {
    const container = document.getElementById('reportContent');
    if (!fromDate) { const p = getDatePreset('this_month'); fromDate = p.from; toDate = p.to; }

    const [result, partiesResult] = await Promise.all([
        window.api.getSalesRegister({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined, status: status || undefined }),
        window.api.getParties({ type: 'customer' })
    ]);

    const data = result.success ? result.data : { sales: [], total: 0, totalPaid: 0, totalDue: 0, count: 0 };
    const parties = partiesResult.success ? partiesResult.data : [];

    container.innerHTML = `
        <div class="card-header"><h2>Sales Entry Register</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printSalesRegister()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportSalesRegisterPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="sregFrom" value="${fromDate}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="sregTo" value="${toDate}"></div>
            <div class="form-group"><label>Customer</label>
                <select class="form-control" id="sregParty"><option value="">All</option>${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="sregStatus">
                    <option value="">All</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
                    <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                    <option value="partial" ${status === 'partial' ? 'selected' : ''}>Partial</option>
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applySalesRegister()">Generate</button></div>
            ${reportLangPicker('Language / भाषा')}
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Invoices</span><span class="value" style="font-size:20px">${data.count}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Sales</span><span class="value" style="font-size:20px">${formatCurrency(data.total)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Due</span><span class="value" style="font-size:18px">${formatCurrency(data.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Products</th><th class="text-right">Gross</th><th class="text-right">Disc</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Mode</th><th>Status</th><th class="actions">Actions</th></tr></thead>
                <tbody>${data.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td style="max-width:200px;font-size:11px">${escapeHtml((s.products_summary||'').substring(0,60))}${(s.products_summary||'').length > 60 ? '...' : ''}</td><td class="text-right">${formatCurrency(s.subtotal)}</td><td class="text-right">${formatCurrency(s.discount)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td><td class="text-right">${formatCurrency(s.paid_amount)}</td><td class="text-right" style="color:${(s.grand_total - s.paid_amount) > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(s.grand_total - s.paid_amount)}</td><td>${statusBadge(s.payment_mode)}</td><td>${statusBadge(s.status)}</td>
    <td class="actions">
        <button class="btn btn-primary btn-sm" onclick="navigateTo('sales')" title="Edit in Sales">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSaleFromRegister(${s.id})" title="Delete">🗑</button>
    </td>
</tr>`).join('')}
                ${data.sales.length === 0 ? '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-light)">No sales found</td></tr>' : ''}</tbody>
                <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td colspan="3"></td></tr></tfoot>
            </table>
        </div>
    `;
    window._lastSalesRegister = data;
}

function applySalesRegister() {
    showSalesRegister(
        document.getElementById('sregFrom')?.value || '',
        document.getElementById('sregTo')?.value || '',
        document.getElementById('sregParty')?.value || '',
        document.getElementById('sregStatus')?.value || ''
    );
}

// ============================================================
// Purchase Register
// ============================================================
async function showPurchaseRegister(fromDate = '', toDate = '', partyId = '', status = '') {
    const container = document.getElementById('reportContent');
    if (!fromDate) { const p = getDatePreset('this_month'); fromDate = p.from; toDate = p.to; }

    const [result, partiesResult] = await Promise.all([
        window.api.getPurchaseRegister({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined, status: status || undefined }),
        window.api.getParties({ type: 'supplier' })
    ]);

    const data = result.success ? result.data : { purchases: [], total: 0, totalPaid: 0, totalDue: 0, count: 0 };
    const parties = partiesResult.success ? partiesResult.data : [];

    container.innerHTML = `
        <div class="card-header"><h2>Purchase Entry Register</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printPurchaseRegister()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportPurchaseRegisterPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="pregFrom" value="${fromDate}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="pregTo" value="${toDate}"></div>
            <div class="form-group"><label>Supplier</label>
                <select class="form-control" id="pregParty"><option value="">All</option>${parties.map(p => `<option value="${p.id}" ${partyId == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="pregStatus">
                    <option value="">All</option><option value="paid" ${status === 'paid' ? 'selected' : ''}>Paid</option>
                    <option value="unpaid" ${status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                    <option value="partial" ${status === 'partial' ? 'selected' : ''}>Partial</option>
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyPurchaseRegister()">Generate</button></div>
            ${reportLangPicker('Language / भाषा')}
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Bills</span><span class="value" style="font-size:20px">${data.count}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Purchases</span><span class="value" style="font-size:20px">${formatCurrency(data.total)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Due</span><span class="value" style="font-size:18px">${formatCurrency(data.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Bill No</th><th>Supplier</th><th>Items</th><th class="text-right">Gross</th><th class="text-right">Charges</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th><th class="actions">Actions</th></tr></thead>
                <tbody>${data.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td style="max-width:200px;font-size:11px">${escapeHtml((p.products_summary||'').substring(0,60))}${(p.products_summary||'').length > 60 ? '...' : ''}</td><td class="text-right">${formatCurrency(p.subtotal)}</td><td class="text-right">${formatCurrency((p.transport_charges||0)+(p.extra_charges||0))}</td><td class="text-right">${formatCurrency(p.grand_total)}</td><td class="text-right">${formatCurrency(p.paid_amount)}</td><td class="text-right" style="color:${(p.grand_total - p.paid_amount) > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(p.grand_total - p.paid_amount)}</td><td>${statusBadge(p.status)}</td>
    <td class="actions">
        <button class="btn btn-primary btn-sm" onclick="navigateTo('purchases')" title="Edit in Purchases">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deletePurchaseFromRegister(${p.id})" title="Delete">🗑</button>
    </td>
</tr>`).join('')}
                ${data.purchases.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No purchases found</td></tr>' : ''}</tbody>
                <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td colspan="2"></td></tr></tfoot>
            </table>
        </div>
    `;
    window._lastPurchaseRegister = data;
}

function applyPurchaseRegister() {
    showPurchaseRegister(
        document.getElementById('pregFrom')?.value || '',
        document.getElementById('pregTo')?.value || '',
        document.getElementById('pregParty')?.value || '',
        document.getElementById('pregStatus')?.value || ''
    );
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
// Purchase vs Sales — daily comparison report
// ============================================================
// Sources: the original purchase bills and sales invoices (see
// shared/operations/purchase_vs_sales.js). The difference shown is
// Sales − Purchase: a trading gap, never a profit figure.

const PVS_PAGE_SIZE = 100;

function pvsQty(qty, unit) {
    const n = Number(qty) || 0;
    if (!n) return '0.00';
    const label = unit === 'mixed' ? '' : (unit ? ' ' + unit : '');
    return formatNumber(n) + label + (unit === 'mixed' ? ' <span style="font-size:10px;color:var(--text-light)">(mixed)</span>' : '');
}

function pvsDifference(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) < 0.005) return '<span style="color:var(--text-light)">' + formatCurrency(0) + '</span>';
    const colour = n > 0 ? 'var(--accent)' : 'var(--danger)';
    const sign = n > 0 ? '+' : '−';
    return `<span style="color:${colour};font-weight:600">${sign}${formatCurrency(Math.abs(n))}</span>`;
}

function pvsMoney(value, zeroDash) {
    const n = Number(value) || 0;
    if (zeroDash && !n) return '<span style="color:var(--text-light)">—</span>';
    return formatCurrency(n);
}

function pvsOptionList(options, selected) {
    return options.map(option => {
        const value = typeof option === 'object' ? option.id : option;
        const label = typeof option === 'object' ? option.name : option;
        return `<option value="${escapeHtml(String(value))}" ${String(selected) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}

function pvsRowsFor(lines, page, side) {
    const start = (page - 1) * PVS_PAGE_SIZE;
    const slice = lines.slice(start, start + PVS_PAGE_SIZE);
    if (!slice.length) {
        return `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-light)">No ${side} records for this selection</td></tr>`;
    }
    let lastDate = null;
    return slice.map(line => {
        const rows = [];
        if (line.date !== lastDate) {
            lastDate = line.date;
            rows.push(`<tr style="background:var(--bg)"><td colspan="9" style="font-weight:600;font-size:12px">${formatDate(line.date)} <span style="color:var(--text-light);font-weight:400">(${line.date})</span></td></tr>`);
        }
        rows.push(`<tr>
            <td style="white-space:nowrap">${escapeHtml(line.date)}</td>
            <td>${escapeHtml(line.party_name)}</td>
            <td style="white-space:nowrap">${escapeHtml(line.reference)}</td>
            <td>${escapeHtml(line.product)}</td>
            <td class="text-right" style="white-space:nowrap">${line.quantity ? formatNumber(line.quantity) : '—'}</td>
            <td style="white-space:nowrap">${line.unit ? escapeHtml(line.unit) : '—'}</td>
            <td class="text-right" style="white-space:nowrap">${line.rate ? formatCurrency(line.rate) : '—'}</td>
            <td class="text-right" style="white-space:nowrap">${formatCurrency(line.amount)}</td>
            <td style="white-space:nowrap">${statusBadge(line.status)}</td>
        </tr>`);
        return rows.join('');
    }).join('');
}

function pvsPager(side, page, pages, total) {
    const label = side === 'purchase' ? 'purchase' : 'sales';
    const first = total ? (page - 1) * PVS_PAGE_SIZE + 1 : 0;
    const last = Math.min(page * PVS_PAGE_SIZE, total);
    return `<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 4px">
        <div style="font-size:12px;color:var(--text-light)">Showing ${first}–${last} of ${total} ${label} rows</div>
        <div class="btn-group" style="align-items:center">
            <button class="btn btn-secondary btn-sm" onclick="pvsPage('${side}', ${page - 1})" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
            <span style="font-size:12px;padding:0 6px">Page ${page} of ${pages}</span>
            <button class="btn btn-secondary btn-sm" onclick="pvsPage('${side}', ${page + 1})" ${page >= pages ? 'disabled' : ''}>Next ›</button>
        </div>
    </div>`;
}

function pvsScreenHTML(data, state) {
    const summary = data.summary || {};
    const purchasePages = Math.max(1, Math.ceil(data.purchase_lines.length / PVS_PAGE_SIZE));
    const salesPages = Math.max(1, Math.ceil(data.sales_lines.length / PVS_PAGE_SIZE));
    const purchasePage = Math.min(Math.max(1, Number(state.page_purchase) || 1), purchasePages);
    const salesPage = Math.min(Math.max(1, Number(state.page_sales) || 1), salesPages);

    const purchasePartyRows = data.purchase_parties.length
        ? data.purchase_parties.map(row => `<tr style="cursor:pointer" onclick="pvsShowParty('purchase', '${row.party_id == null ? 'none' : row.party_id}')" title="View this supplier's purchase records">
                <td><strong>${escapeHtml(row.party_name)}</strong></td>
                <td class="text-right">${row.transactions}</td>
                <td class="text-right">${pvsQty(row.quantity, row.quantity_unit)}</td>
                <td class="text-right">${formatCurrency(row.amount)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-light)">No purchases in this period</td></tr>';

    const salesPartyRows = data.sales_parties.length
        ? data.sales_parties.map(row => `<tr style="cursor:pointer" onclick="pvsShowParty('sales', '${row.party_id == null ? 'none' : row.party_id}')" title="View this customer's sales records">
                <td><strong>${escapeHtml(row.party_name)}</strong></td>
                <td class="text-right">${row.transactions}</td>
                <td class="text-right">${pvsQty(row.quantity, row.quantity_unit)}</td>
                <td class="text-right">${formatCurrency(row.amount)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text-light)">No sales in this period</td></tr>';

    const dailyRows = data.daily.length
        ? data.daily.map(day => `<tr style="cursor:pointer" onclick="pvsShowDay('${day.date}')" title="Click to view this day's purchase and sales records">
                <td><strong>${formatDate(day.date)}</strong> <span style="color:var(--text-light);font-size:11px">(${day.date})</span></td>
                <td class="text-right">${pvsMoney(day.purchase_amount, true)}</td>
                <td class="text-right">${pvsMoney(day.sales_amount, true)}</td>
                <td class="text-right">${pvsDifference(day.difference)}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-light)">No activity in this period</td></tr>';

    const rangeNote = data.zero_days_filled
        ? `All ${data.day_count} days of the period are listed, including days with no activity.`
        : `${data.day_count} days with activity in the period.`;

    return `
        <div class="card-header">
            <h2>⚖️ Purchase vs Sales — Daily Comparison</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="pvsPrint()">🖨 Print Report</button>
                <button class="btn btn-primary btn-sm" onclick="pvsExportPDF()">📄 Export PDF</button>
                <button class="btn btn-success btn-sm" onclick="pvsExportExcel()">📊 Excel</button>
            </div>
        </div>

        <div class="filter-bar">
            <div class="form-group"><label>From Date</label><input type="date" class="form-control" id="pvsFrom" value="${escapeHtml(state.from)}"></div>
            <div class="form-group"><label>To Date</label><input type="date" class="form-control" id="pvsTo" value="${escapeHtml(state.to)}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="pvsApply()">Apply Filter</button></div>
            <div class="form-group"><label>Quick Range</label>
                <div class="btn-group">
                    <button class="btn btn-secondary btn-sm" onclick="pvsPreset('today')">Today</button>
                    <button class="btn btn-secondary btn-sm" onclick="pvsPreset('yesterday')">Yesterday</button>
                    <button class="btn btn-secondary btn-sm" onclick="pvsPreset('this_week')">This Week</button>
                    <button class="btn btn-secondary btn-sm" onclick="pvsPreset('this_month')">This Month</button>
                    <button class="btn btn-secondary btn-sm" onclick="pvsPreset('last_month')">Previous Month</button>
                    <button class="btn btn-secondary btn-sm" onclick="pvsCustom()">Custom</button>
                    <button class="btn btn-danger btn-sm" onclick="pvsReset()">Reset Filter</button>
                </div>
            </div>
        </div>

        <div class="filter-bar">
            <div class="form-group"><label>Supplier / Purchase Party</label>
                <select class="form-control" id="pvsPurchaseParty">
                    <option value="">All Suppliers</option>
                    ${pvsOptionList(data.options.purchase_parties, state.purchase_party_id)}
                </select>
            </div>
            <div class="form-group"><label>Customer / Sales Party</label>
                <select class="form-control" id="pvsSalesParty">
                    <option value="">All Customers</option>
                    ${pvsOptionList(data.options.sales_parties, state.sales_party_id)}
                </select>
            </div>
            <div class="form-group"><label>Product / Item</label>
                <select class="form-control" id="pvsProduct">
                    <option value="">All Items</option>
                    ${pvsOptionList(data.options.products, state.product)}
                </select>
            </div>
            <div class="form-group"><label>Reference</label><input type="text" class="form-control" id="pvsReference" value="${escapeHtml(state.reference)}" placeholder="Bill / Invoice no"></div>
            <div class="form-group"><label>Cash / Credit</label>
                <select class="form-control" id="pvsMode">
                    <option value="">All Modes</option>
                    <option value="cash" ${state.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                    <option value="credit" ${state.payment_mode === 'credit' ? 'selected' : ''}>Credit</option>
                    <option value="bank" ${state.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                    <option value="upi" ${state.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label>
                <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:12px">
                    <input type="checkbox" id="pvsZeroDays" ${state.include_zero_days ? 'checked' : ''}> Include days with no activity
                </label>
            </div>
        </div>

        <div class="summary-cards" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:14px">
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Total Purchase Amount</span>
                <span class="value" style="font-size:19px">${formatCurrency(summary.purchase_amount)}</span>
                <span class="sub">${summary.purchase_transactions} purchase bills</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Total Sales Amount</span>
                <span class="value" style="font-size:19px">${formatCurrency(summary.sales_amount)}</span>
                <span class="sub">${summary.sales_transactions} sales invoices</span>
            </div>
            <div class="summary-card ${summary.difference >= 0 ? 'card-info' : 'card-warning'}" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Purchase vs Sales Difference</span>
                <span class="value" style="font-size:19px">${pvsDifference(summary.difference)}</span>
                <span class="sub">Sales − Purchase · trading gap, not profit</span>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Purchase Quantity</span>
                <span class="value" style="font-size:19px">${pvsQty(summary.purchase_quantity, summary.purchase_quantity_unit)}</span>
                <span class="sub">${summary.purchase_parties} suppliers</span>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Sales Quantity</span>
                <span class="value" style="font-size:19px">${pvsQty(summary.sales_quantity, summary.sales_quantity_unit)}</span>
                <span class="sub">${summary.sales_parties} customers</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Purchase Transactions</span>
                <span class="value" style="font-size:19px">${summary.purchase_transactions}</span>
                <span class="sub">${data.purchase_lines.length} detail rows</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label" style="min-height:30px">Sales Transactions</span>
                <span class="value" style="font-size:19px">${summary.sales_transactions}</span>
                <span class="sub">${data.sales_lines.length} detail rows</span>
            </div>
        </div>

        <div style="margin-bottom:16px;padding:10px 14px;background:var(--bg);border-left:3px solid var(--primary);border-radius:6px;font-size:12px;color:var(--text-light)">
            Purchases are the original purchase bills and sales are the original sales invoices dated inside the selected period.
            The difference is <strong>Sales − Purchase</strong>; it is a trading comparison, <strong>not profit</strong> (operating expenses, stock changes and
            other income are not included). Supplier payments and customer collections are money settlements — they never add to these totals.
        </div>

        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;flex-wrap:wrap;gap:8px">
                <h3 style="margin:0;font-size:15px">Daily Comparison</h3>
                <span style="font-size:12px;color:var(--text-light)">${rangeNote} Click a day to see its records.</span>
            </div>
            <div class="table-container" style="max-height:460px;overflow:auto">
                <table>
                    <thead><tr><th>Date</th><th class="text-right">Purchase Amount</th><th class="text-right">Sales Amount</th><th class="text-right">Difference</th></tr></thead>
                    <tbody>${dailyRows}</tbody>
                    <tfoot><tr>
                        <td><strong>Total — ${data.day_count} days</strong></td>
                        <td class="text-right"><strong>${formatCurrency(summary.purchase_amount)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(summary.sales_amount)}</strong></td>
                        <td class="text-right">${pvsDifference(summary.difference)}</td>
                    </tr></tfoot>
                </table>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(560px,1fr));gap:16px;margin-bottom:16px">
            <div class="card">
                <div style="padding:12px 16px"><h3 style="margin:0;font-size:15px">Purchase Parties (Suppliers)</h3></div>
                <div class="table-container" style="max-height:360px;overflow:auto">
                    <table>
                        <thead><tr><th>Supplier Name</th><th class="text-right">Bills</th><th class="text-right">Total Quantity</th><th class="text-right">Total Purchase</th></tr></thead>
                        <tbody>${purchasePartyRows}</tbody>
                        <tfoot><tr><td><strong>Total — ${data.purchase_parties.length} suppliers</strong></td><td class="text-right"><strong>${summary.purchase_transactions}</strong></td><td class="text-right"><strong>${pvsQty(summary.purchase_quantity, summary.purchase_quantity_unit)}</strong></td><td class="text-right"><strong>${formatCurrency(summary.purchase_amount)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
            <div class="card">
                <div style="padding:12px 16px"><h3 style="margin:0;font-size:15px">Sales Parties (Customers)</h3></div>
                <div class="table-container" style="max-height:360px;overflow:auto">
                    <table>
                        <thead><tr><th>Customer Name</th><th class="text-right">Invoices</th><th class="text-right">Total Quantity</th><th class="text-right">Total Sales</th></tr></thead>
                        <tbody>${salesPartyRows}</tbody>
                        <tfoot><tr><td><strong>Total — ${data.sales_parties.length} customers</strong></td><td class="text-right"><strong>${summary.sales_transactions}</strong></td><td class="text-right"><strong>${pvsQty(summary.sales_quantity, summary.sales_quantity_unit)}</strong></td><td class="text-right"><strong>${formatCurrency(summary.sales_amount)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;flex-wrap:wrap;gap:8px">
                <h3 style="margin:0;font-size:15px">Purchase Details</h3>
                <span style="font-size:12px;color:var(--text-light)">Grouped by purchase date — ${summary.purchase_transactions} bills</span>
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table style="min-width:1000px">
                    <thead><tr><th>Date</th><th>Supplier</th><th>Bill No</th><th>Item</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
                    <tbody>${pvsRowsFor(data.purchase_lines, purchasePage, 'purchase')}</tbody>
                </table>
            </div>
            ${pvsPager('purchase', purchasePage, purchasePages, data.purchase_lines.length)}
        </div>

        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;flex-wrap:wrap;gap:8px">
                <h3 style="margin:0;font-size:15px">Sales Details</h3>
                <span style="font-size:12px;color:var(--text-light)">Grouped by sales date — ${summary.sales_transactions} invoices</span>
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table style="min-width:1000px">
                    <thead><tr><th>Date</th><th>Customer</th><th>Invoice No</th><th>Item</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
                    <tbody>${pvsRowsFor(data.sales_lines, salesPage, 'sales')}</tbody>
                </table>
            </div>
            ${pvsPager('sales', salesPage, salesPages, data.sales_lines.length)}
        </div>

        <div style="font-size:11px;color:var(--text-light);padding:4px 4px 12px">
            Reconciled with the original records: purchases ${formatCurrency(data.reconciliation.purchase_document_total)}
            across ${data.reconciliation.purchase_documents} bills, sales ${formatCurrency(data.reconciliation.sales_document_total)}
            across ${data.reconciliation.sales_documents} invoices.
            ${data.reconciliation.purchase_reconciled && data.reconciliation.sales_reconciled ? '' : '<span style="color:var(--danger)"> Detail rows do not fully reconcile with the document totals.</span>'}
        </div>
    `;
}

async function showPurchaseVsSales(state = {}) {
    const container = document.getElementById('reportContent');
    if (!container) return;
    document.getElementById('topActions').innerHTML = '';

    const preset = getDatePreset('this_month');
    const current = Object.assign({
        from: preset.from,
        to: preset.to,
        purchase_party_id: '',
        sales_party_id: '',
        product: '',
        reference: '',
        payment_mode: '',
        include_zero_days: true,
        page_purchase: 1,
        page_sales: 1
    }, state);

    container.innerHTML = '<div class="card" style="padding:30px;text-align:center;color:var(--text-light)">Building the report…</div>';

    const result = await window.api.getPurchaseVsSales({
        from_date: current.from || undefined,
        to_date: current.to || undefined,
        purchase_party_id: current.purchase_party_id || undefined,
        sales_party_id: current.sales_party_id || undefined,
        product: current.product || undefined,
        reference: current.reference || undefined,
        payment_mode: current.payment_mode || undefined,
        include_zero_days: !!current.include_zero_days
    });

    if (!result || !result.success) {
        container.innerHTML = `<div class="card" style="padding:30px;color:var(--danger)">Could not build the Purchase vs Sales report: ${escapeHtml((result && result.error) || 'unknown error')}</div>`;
        return;
    }

    window._pvsState = current;
    window._pvsData = result.data;
    container.innerHTML = pvsScreenHTML(result.data, current);
}

/** Current filter values from the screen (falls back to the last applied state). */
function pvsCurrentFilters(overrides = {}) {
    const state = window._pvsState || {};
    const value = (id, fallback) => {
        const el = document.getElementById(id);
        return el ? el.value : fallback;
    };
    const zeroEl = document.getElementById('pvsZeroDays');
    return Object.assign({}, state, {
        from: value('pvsFrom', state.from || ''),
        to: value('pvsTo', state.to || ''),
        purchase_party_id: value('pvsPurchaseParty', state.purchase_party_id || ''),
        sales_party_id: value('pvsSalesParty', state.sales_party_id || ''),
        product: value('pvsProduct', state.product || ''),
        reference: value('pvsReference', state.reference || ''),
        payment_mode: value('pvsMode', state.payment_mode || ''),
        include_zero_days: zeroEl ? zeroEl.checked : !!state.include_zero_days
    }, overrides);
}

function pvsApply() {
    showPurchaseVsSales(pvsCurrentFilters({ page_purchase: 1, page_sales: 1 }));
}

function pvsPreset(name) {
    const preset = getDatePreset(name);
    const fromEl = document.getElementById('pvsFrom');
    const toEl = document.getElementById('pvsTo');
    if (fromEl) fromEl.value = preset.from;
    if (toEl) toEl.value = preset.to;
    pvsApply();
}

function pvsCustom() {
    const fromEl = document.getElementById('pvsFrom');
    if (fromEl) { fromEl.focus(); fromEl.select && fromEl.select(); }
    showToast('Pick your own From and To dates, then press Apply Filter', 'info', 3000);
}

function pvsReset() {
    const preset = getDatePreset('this_month');
    showPurchaseVsSales({ from: preset.from, to: preset.to });
}

function pvsPage(side, page) {
    const overrides = side === 'purchase' ? { page_purchase: page } : { page_sales: page };
    showPurchaseVsSales(pvsCurrentFilters(overrides));
}

/** Drill-down: one supplier's purchases (or one customer's sales) in the period. */
function pvsShowParty(side, partyId) {
    const data = window._pvsData;
    if (!data) return;
    const isPurchase = side === 'purchase';
    const key = String(partyId);
    const lines = (isPurchase ? data.purchase_lines : data.sales_lines)
        .filter(line => String(line.party_id == null ? 'none' : line.party_id) === key);
    const party = (isPurchase ? data.purchase_parties : data.sales_parties)
        .find(row => String(row.party_id == null ? 'none' : row.party_id) === key);

    if (!lines.length) {
        showToast('No ' + (isPurchase ? 'purchase' : 'sales') + ' records for this party in the selected period', 'warning');
        return;
    }

    const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const quantity = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    const rows = lines.map(line => `<tr>
        <td style="white-space:nowrap">${escapeHtml(line.date)}</td>
        <td style="white-space:nowrap">${escapeHtml(line.reference)}</td>
        <td>${escapeHtml(line.product)}</td>
        <td class="text-right" style="white-space:nowrap">${line.quantity ? formatNumber(line.quantity) : '—'}</td>
        <td>${line.unit ? escapeHtml(line.unit) : '—'}</td>
        <td class="text-right" style="white-space:nowrap">${line.rate ? formatCurrency(line.rate) : '—'}</td>
        <td class="text-right" style="white-space:nowrap">${formatCurrency(line.amount)}</td>
        <td style="white-space:nowrap">${statusBadge(line.status)}</td>
    </tr>`).join('');

    showModal(`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 10px">
            <h3 style="margin:0">${escapeHtml(party ? party.party_name : 'Party')} — ${isPurchase ? 'Purchase Details' : 'Sales Details'}</h3>
            <button class="btn btn-danger btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">
            ${escapeHtml(data.from_date || 'Start')} → ${escapeHtml(data.to_date || 'Today')} ·
            ${lines.length} detail rows · ${formatNumber(quantity)} quantity · <strong>${formatCurrency(total)}</strong>
        </div>
        <div class="table-container" style="max-height:60vh;overflow:auto">
            <table>
                <thead><tr><th>Date</th><th>Ref No</th><th>Item</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `);
}

/** Drill-down: everything bought and sold on one date. */
function pvsShowDay(date) {
    const data = window._pvsData;
    if (!data) return;
    const purchaseLines = data.purchase_lines.filter(line => line.date === date);
    const salesLines = data.sales_lines.filter(line => line.date === date);
    const purchaseTotal = purchaseLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    const salesTotal = salesLines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

    const rowsOf = (lines) => lines.length
        ? lines.map(line => `<tr>
                <td>${escapeHtml(line.party_name)}</td>
                <td style="white-space:nowrap">${escapeHtml(line.reference)}</td>
                <td>${escapeHtml(line.product)}</td>
                <td class="text-right" style="white-space:nowrap">${line.quantity ? formatNumber(line.quantity) : '—'}</td>
                <td>${line.unit ? escapeHtml(line.unit) : '—'}</td>
                <td class="text-right" style="white-space:nowrap">${formatCurrency(line.amount)}</td>
                <td style="white-space:nowrap">${statusBadge(line.status)}</td>
            </tr>`).join('')
        : '<tr><td colspan="7" style="text-align:center;padding:16px;color:var(--text-light)">No records on this date</td></tr>';

    showModal(`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 0 10px">
            <h3 style="margin:0">${formatDate(date)} — Records</h3>
            <button class="btn btn-danger btn-sm" onclick="closeModal()">✕</button>
        </div>
        <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">
            Purchase <strong>${formatCurrency(purchaseTotal)}</strong> · Sales <strong>${formatCurrency(salesTotal)}</strong> ·
            Difference ${pvsDifference(salesTotal - purchaseTotal)}
        </div>
        <h4 style="margin:10px 0 6px;font-size:13px">Purchases (${purchaseLines.length} rows)</h4>
        <div class="table-container" style="max-height:32vh;overflow:auto">
            <table>
                <thead><tr><th>Supplier</th><th>Bill No</th><th>Item</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>${rowsOf(purchaseLines)}</tbody>
            </table>
        </div>
        <h4 style="margin:14px 0 6px;font-size:13px">Sales (${salesLines.length} rows)</h4>
        <div class="table-container" style="max-height:32vh;overflow:auto">
            <table>
                <thead><tr><th>Customer</th><th>Invoice No</th><th>Item</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>${rowsOf(salesLines)}</tbody>
            </table>
        </div>
    `);
}

/** Print and PDF both use the server-built document so they cannot drift. */
async function pvsDocument() {
    const filters = pvsCurrentFilters();
    const result = await window.api.getPurchaseVsSalesHTML({
        from_date: filters.from || undefined,
        to_date: filters.to || undefined,
        purchase_party_id: filters.purchase_party_id || undefined,
        sales_party_id: filters.sales_party_id || undefined,
        product: filters.product || undefined,
        reference: filters.reference || undefined,
        payment_mode: filters.payment_mode || undefined,
        include_zero_days: !!filters.include_zero_days
    });
    if (!result || !result.success) {
        showToast('Could not build the report document: ' + ((result && result.error) || 'unknown error'), 'error');
        return null;
    }
    return result.data;
}

async function pvsPrint() {
    const doc = await pvsDocument();
    if (!doc) return;
    printHTML(doc.html);
}

async function pvsExportPDF() {
    const doc = await pvsDocument();
    if (!doc) return;
    const result = await window.api.printToPDF({
        html: doc.html,
        filename: doc.filename,
        pageNumbers: true,
        footerLeft: doc.title
    });
    if (result && result.success) {
        showToast('PDF saved' + (result.path && result.path !== 'printed' ? ': ' + result.path : ''), 'success');
    } else if (result && result.canceled) {
        showToast('PDF export cancelled', 'info');
    } else {
        showToast('PDF export failed: ' + ((result && result.error) || 'unknown error'), 'error');
    }
}

async function pvsExportExcel() {
    const filters = pvsCurrentFilters();
    const result = await window.api.exportPurchaseVsSales({
        from_date: filters.from || undefined,
        to_date: filters.to || undefined,
        purchase_party_id: filters.purchase_party_id || undefined,
        sales_party_id: filters.sales_party_id || undefined,
        product: filters.product || undefined,
        reference: filters.reference || undefined,
        payment_mode: filters.payment_mode || undefined,
        include_zero_days: !!filters.include_zero_days
    });
    if (result && result.success) {
        showToast('Excel export saved' + (result.filePath ? ': ' + result.filePath : ''), 'success');
    } else {
        showToast('Excel export failed: ' + ((result && result.error) || 'unknown error'), 'error');
    }
}

// ============================================================
// Print / PDF Helpers
// ============================================================
async function printSalesReport(fromDate, toDate, partyId) {
    const result = await window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1><h2>Sales Report</h2><p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total Sales: ${report.sales.length} | Total: ${formatCurrency(report.total)}</p></div>
        <table><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Amount</th><th class="text-right">Paid</th><th>Status</th></tr></thead>
        <tbody>${report.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td><td class="text-right">${formatCurrency(s.paid_amount)}</td><td>${s.status}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportSalesReportPDF(fromDate, toDate, partyId) {
    const result = await window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Sales Report</h2><p>Period: ${fromDate} to ${toDate} | Total: ${formatCurrency(report.total)}</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>`;
    await window.api.printToPDF({ html });
}

async function printPurchasesReport(fromDate, toDate, partyId) {
    const result = await window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Purchase Report</h2><p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total: ${formatCurrency(report.total)}</p></div>
        <table><thead><tr><th>Date</th><th>Bill</th><th>Supplier</th><th class="text-right">Total</th></tr></thead>
        <tbody>${report.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportPurchasesReportPDF(fromDate, toDate, partyId) {
    const result = await window.api.getPurchasesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Purchase Report</h2><p>Period: ${fromDate} to ${toDate}</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

async function printDayBook(fromDate, toDate) {
    const result = await window.api.getDayBook({ from_date: fromDate, to_date: toDate });
    if (!result.success) return;
    const data = result.data;
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Day Book</h2><p>Period: ${fromDate} to ${toDate}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Debit</div><div class="value-number">${formatCurrency(data.totalDebit)}</div></div>
            <div class="value-card"><div class="value-label">Total Credit</div><div class="value-number">${formatCurrency(data.totalCredit)}</div></div>
            <div class="value-card"><div class="value-label">Net</div><div class="value-number">${formatCurrency(data.net)}</div></div>
        </div>
        <table><thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Account</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th></tr></thead>
        <tbody>${(data.entries || []).map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.ref_no||'')}</td><td>${e.transaction_type||e.type}</td><td>${escapeHtml(e.account||'')}</td><td>${escapeHtml(e.particulars||'')}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDebit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalCredit)}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportDayBookPDF(fromDate, toDate) {
    await printDayBook(fromDate, toDate);
}

async function printOutstandingReport() {
    const [rR, pR] = await Promise.all([window.api.getReceivables(), window.api.getPayables()]);
    const receivables = rR.success ? rR.data : [];
    const payables = pR.success ? pR.data : [];
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Outstanding Report</h2><p>Date: ${formatDate(today())}</p></div>
        <table><thead><tr><th>Party</th><th>Type</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${receivables.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>Receivable</td><td class="text-right">${formatCurrency(r.outstanding)}</td></tr>`).join('')}
        ${payables.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>Payable</td><td class="text-right">${formatCurrency(p.outstanding)}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportOutstandingPDF() {
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Outstanding Report</h2></div>`;
    await window.api.printToPDF({ html });
}

async function printSalesRegister() {
    const data = window._lastSalesRegister;
    if (!data) { showToast('Generate a sales register first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Sales Entry Register</h2></div>
        <table class="compact"><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th></tr></thead>
        <tbody>${data.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td><td class="text-right">${formatCurrency(s.paid_amount)}</td><td class="text-right">${formatCurrency(s.grand_total - s.paid_amount)}</td><td>${s.status}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>
    `;
    printHTML(html);
}

async function exportSalesRegisterPDF() { await printSalesRegister(); }

async function printPurchaseRegister() {
    const data = window._lastPurchaseRegister;
    if (!data) { showToast('Generate a purchase register first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Purchase Entry Register</h2></div>
        <table class="compact"><thead><tr><th>Date</th><th>Bill</th><th>Supplier</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th></tr></thead>
        <tbody>${data.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td><td class="text-right">${formatCurrency(p.paid_amount)}</td><td class="text-right">${formatCurrency(p.grand_total - p.paid_amount)}</td><td>${p.status}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>
    `;
    printHTML(html);
}

async function exportPurchaseRegisterPDF() { await printPurchaseRegister(); }

// ============================================================
// Farmer Statement (with FAT/SNF averages)
// ============================================================
async function showFarmerStatement(fromDate = '', toDate = '', partyId = '') {
    const container = document.getElementById('reportContent');

    if (!fromDate) {
        const preset = getDatePreset('this_month');
        fromDate = preset.from;
        toDate = preset.to;
    }

    // Get farmers and data in parallel
    const [farmersResult, dataResult] = await Promise.all([
        window.api.getParties({ type: 'farmer' }),
        partyId ? window.api.getFarmerStatement({ party_id: parseInt(partyId), from_date: fromDate, to_date: toDate }) : Promise.resolve({ success: false })
    ]);

    const farmers = farmersResult.success ? farmersResult.data : [];
    const data = dataResult && dataResult.success ? dataResult.data : null;

    if (data) {
        window._lastFarmerStatement = data;
    }

    container.innerHTML = `
        <div class="card-header">
            <h2>🧑‍🌾 Farmer Statement</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printFarmerStatement()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportFarmerStatementPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>Farmer</label>
                <select class="form-control" id="fsFarmer">
                    <option value="">-- Select Farmer --</option>
                    ${farmers.map(f => `<option value="${f.id}" ${partyId == f.id ? 'selected' : ''}>${escapeHtml(f.name)}${f.route_name ? ' (' + escapeHtml(f.route_name) + ')' : ''}${f.phone ? ' - ' + escapeHtml(f.phone) : ''}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="fsFrom" value="${fromDate}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="fsTo" value="${toDate}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="applyFarmerStatement()">Generate</button>
            </div>
        </div>
        ${data ? `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Opening Balance</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.opening_balance)}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Milk Supplied</span>
                <span class="value" style="font-size:18px">${formatNumber(data.total_quantity)} L</span>
                <span class="sub">${data.collection_count} collections</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Avg FAT / SNF</span>
                <span class="value" style="font-size:18px">${data.avg_fat.toFixed(2)}% / ${data.avg_snf.toFixed(2)}%</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Closing Balance</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.closing_balance)}</span>
                <span class="sub">${data.payment_count} payments</span>
            </div>
        </div>
        <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px">
            <strong>${escapeHtml(data.farmer.name)}</strong>
            ${data.farmer.route_name ? ' | Route: ' + escapeHtml(data.farmer.route_name) : ''}
            ${data.farmer.phone ? ' | ' + escapeHtml(data.farmer.phone) : ''}
            ${data.farmer.address ? ' | ' + escapeHtml(data.farmer.address) : ''}
            <span style="float:right">Period: ${data.from_date} to ${data.to_date}</span>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Ref No</th>
                        <th>Shift</th>
                        <th>Description</th>
                        <th class="text-right">Qty (L)</th>
                        <th class="text-right">FAT%</th>
                        <th class="text-right">SNF%</th>
                        <th class="text-right">Rate</th>
                        <th class="text-right">Credit</th>
                        <th class="text-right">Debit</th>
                        <th class="text-right">Balance</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.entries.map(e => {
                        if (e.transaction_type === 'opening') {
                            return `<tr style="background:#f0f4f8;font-weight:600">
                                <td colspan="10">Opening Balance</td>
                                <td class="text-right">${formatCurrency(e.running_balance)}</td>
                            </tr>`;
                        }
                        if (e.transaction_type === 'milk_collection') {
                            return `<tr>
                                <td>${formatDate(e.date)}</td>
                                <td>${escapeHtml(e.collection_no || '')}</td>
                                <td><span class="badge ${e.shift === 'morning' ? 'badge-warning' : 'badge-info'}">${escapeHtml(e.shift)}</span></td>
                                <td>Milk Collection${e.route_name ? ' (' + escapeHtml(e.route_name) + ')' : ''}</td>
                                <td class="text-right">${formatNumber(e.quantity)}</td>
                                <td class="text-right">${e.fat ? e.fat.toFixed(2) : '-'}</td>
                                <td class="text-right">${e.snf ? e.snf.toFixed(2) : '-'}</td>
                                <td class="text-right">${formatCurrency(e.rate)}</td>
                                <td class="text-right" style="color:var(--accent)">${formatCurrency(e.credit)}</td>
                                <td class="text-right">-</td>
                                <td class="text-right"><strong>${formatCurrency(e.running_balance)}</strong></td>
                            </tr>`;
                        }
                        if (e.transaction_type === 'payment') {
                            return `<tr style="background:#fff5f5">
                                <td>${formatDate(e.date)}</td>
                                <td>${escapeHtml(e.ref_no)}</td>
                                <td>-</td>
                                <td>${escapeHtml(e.description)}</td>
                                <td class="text-right">-</td>
                                <td class="text-right">-</td>
                                <td class="text-right">-</td>
                                <td class="text-right">-</td>
                                <td class="text-right">-</td>
                                <td class="text-right" style="color:var(--danger)">${formatCurrency(e.debit)}</td>
                                <td class="text-right"><strong>${formatCurrency(e.running_balance)}</strong></td>
                            </tr>`;
                        }
                        return '';
                    }).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatNumber(data.total_quantity)} L</strong></td>
                        <td class="text-right">${data.avg_fat.toFixed(2)}%</td>
                        <td class="text-right">${data.avg_snf.toFixed(2)}%</td>
                        <td class="text-right"></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
        ` : `
        <div style="text-align:center;padding:40px;color:var(--text-light)">
            Select a farmer and date range, then click Generate.
        </div>
        `}
    `;
}

function applyFarmerStatement() {
    const partyId = document.getElementById('fsFarmer')?.value || '';
    const from = document.getElementById('fsFrom')?.value || '';
    const to = document.getElementById('fsTo')?.value || '';
    if (!partyId) { showToast('Please select a farmer', 'warning'); return; }
    showFarmerStatement(from, to, partyId);
}

async function printFarmerStatement() {
    const data = window._lastFarmerStatement;
    if (!data) { showToast('Generate a farmer statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>${escapeHtml(data.farmer.name)} — Farmer Statement</h2>
            <p>Period: ${data.from_date} to ${data.to_date}${data.farmer.route_name ? ' | Route: ' + escapeHtml(data.farmer.route_name) : ''}</p>
        </div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Opening Balance</div><div class="value-number">${formatCurrency(data.opening_balance)}</div></div>
            <div class="value-card"><div class="value-label">Total Qty</div><div class="value-number">${formatNumber(data.total_quantity)} L</div></div>
            <div class="value-card"><div class="value-label">Avg FAT</div><div class="value-number">${data.avg_fat.toFixed(2)}%</div></div>
            <div class="value-card"><div class="value-label">Avg SNF</div><div class="value-number">${data.avg_snf.toFixed(2)}%</div></div>
            <div class="value-card"><div class="value-label">Total Credit</div><div class="value-number">${formatCurrency(data.total_credit)}</div></div>
            <div class="value-card"><div class="value-label">Total Paid</div><div class="value-number">${formatCurrency(data.total_debit)}</div></div>
            <div class="value-card"><div class="value-label">Closing Balance</div><div class="value-number">${formatCurrency(data.closing_balance)}</div></div>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Ref</th><th>Shift</th><th>Description</th><th class="text-right">Qty</th><th class="text-right">FAT%</th><th class="text-right">SNF%</th><th class="text-right">Rate</th><th class="text-right">Credit</th><th class="text-right">Debit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                <tr><td colspan="10">Opening Balance</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
                ${data.entries.filter(e => e.transaction_type !== 'opening').map(e => {
                    if (e.transaction_type === 'milk_collection') {
                        return `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.collection_no||'')}</td><td>${e.shift}</td><td>Milk Collection${e.route_name ? ' ('+escapeHtml(e.route_name)+')':''}</td><td class="text-right">${formatNumber(e.quantity)}</td><td class="text-right">${e.fat ? e.fat.toFixed(2) : '-'}</td><td class="text-right">${e.snf ? e.snf.toFixed(2) : '-'}</td><td class="text-right">${formatCurrency(e.rate)}</td><td class="text-right">${formatCurrency(e.credit)}</td><td class="text-right">-</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`;
                    }
                    return `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.ref_no||'')}</td><td>-</td><td>${escapeHtml(e.description)}</td><td class="text-right">-</td><td class="text-right">-</td><td class="text-right">-</td><td class="text-right">-</td><td class="text-right">-</td><td class="text-right">${formatCurrency(e.debit)}</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`;
                }).join('')}
            </tbody>
            <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${formatNumber(data.total_quantity)} L</strong></td><td class="text-right">${data.avg_fat.toFixed(2)}%</td><td class="text-right">${data.avg_snf.toFixed(2)}%</td><td></td><td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportFarmerStatementPDF() {
    const data = window._lastFarmerStatement;
    if (!data) { showToast('Generate a farmer statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>${escapeHtml(data.farmer.name)} — Farmer Statement</h2>
            <p>Period: ${data.from_date} to ${data.to_date}</p>
        </div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Avg FAT</div><div class="value-number">${data.avg_fat.toFixed(2)}%</div></div>
            <div class="value-card"><div class="value-label">Avg SNF</div><div class="value-number">${data.avg_snf.toFixed(2)}%</div></div>
            <div class="value-card"><div class="value-label">Total Qty</div><div class="value-number">${formatNumber(data.total_quantity)} L</div></div>
            <div class="value-card"><div class="value-label">Closing Balance</div><div class="value-number">${formatCurrency(data.closing_balance)}</div></div>
        </div>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    await window.api.printToPDF({ html });
}

// ============================================================
// Helper: View Daybook Entry — shows transaction details in a modal
// ============================================================
function viewDaybookEntry(type, id) {
    // Fetch the transaction details based on type
    let fetchPromise;
    if (type === 'sale') {
        fetchPromise = window.api.getSale(id);
    } else if (type === 'purchase') {
        fetchPromise = window.api.getPurchase(id);
    } else if (type === 'petty_cash') {
        fetchPromise = window.api.getPettyCash(id);
    } else if (type === 'expense') {
        fetchPromise = window.api.getOtherExpense(id);
    } else if (type === 'vehicle') {
        fetchPromise = window.api.getVehicleExpense(id);
    } else if (type === 'receipt' || type === 'payment') {
        // Payment/receipt - fetch from payments API
        fetchPromise = window.api.getPayments({}).then(r => {
            if (r.success) {
                const pm = (r.data || []).find(p => p.id === id);
                return { success: !!pm, data: pm };
            }
            return r;
        });
    } else {
        // Fallback: navigate to the page
        const pageMap = {
            'salary': 'salary'
        };
        const page = pageMap[type];
        if (page) {
            showToast('Opening ' + page + '...', 'info');
            navigateTo(page);
        }
        return;
    }
    
    Promise.resolve(fetchPromise).then(async (result) => {
        if (!result.success || !result.data) {
            showToast('Could not load transaction details', 'error');
            return;
        }
        const d = result.data;
        const typeLabels = {
            'sale': 'Sale Invoice',
            'purchase': 'Purchase Bill',
            'receipt': 'Payment Receipt',
            'payment': 'Payment Made',
            'petty_cash': 'Petty Cash',
            'expense': 'Expense',
            'vehicle': 'Vehicle Expense'
        };
        
        // Build details HTML based on type
        let detailsHtml = '';
        if (type === 'sale') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Invoice No</label><div><strong>${escapeHtml(d.invoice_no)}</strong></div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Customer</label><div>${escapeHtml(d.party_name || 'N/A')}</div></div>
                <div class="form-group"><label>Amount</label><div style="font-weight:700;font-size:16px;color:var(--accent)">${formatCurrency(d.grand_total)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Paid</label><div>${formatCurrency(d.paid_amount)}</div></div>
                <div class="form-group"><label>Status</label><div>${statusBadge(d.status)}</div></div></div>`;
        } else if (type === 'purchase') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Bill No</label><div><strong>${escapeHtml(d.bill_no)}</strong></div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Supplier</label><div>${escapeHtml(d.party_name || 'N/A')}</div></div>
                <div class="form-group"><label>Amount</label><div style="font-weight:700;font-size:16px;color:var(--danger)">${formatCurrency(d.grand_total)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Paid</label><div>${formatCurrency(d.paid_amount)}</div></div>
                <div class="form-group"><label>Status</label><div>${statusBadge(d.status)}</div></div></div>`;
        } else if (type === 'petty_cash') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Voucher No</label><div><strong>${escapeHtml(d.voucher_no)}</strong></div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Head</label><div>${escapeHtml(d.expense_head)}</div></div>
                <div class="form-group"><label>Amount</label><div style="font-weight:700;color:var(--danger)">${formatCurrency(d.amount)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Paid To</label><div>${escapeHtml(d.paid_to || '-')}</div></div>
                <div class="form-group"><label>Mode</label><div>${statusBadge(d.payment_mode)}</div></div></div>`;
        } else if (type === 'expense') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Category</label><div><strong>${escapeHtml(d.category)}</strong> / ${escapeHtml(d.expense_head)}</div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Amount</label><div style="font-weight:700;color:var(--danger)">${formatCurrency(d.amount)}</div></div>
                <div class="form-group"><label>Paid To</label><div>${escapeHtml(d.paid_to || '-')}</div></div></div>`;
        } else if (type === 'vehicle') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Vehicle</label><div><strong>${escapeHtml(d.vehicle_name)}</strong></div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Total</label><div style="font-weight:700;color:var(--danger)">${formatCurrency(d.total_amount)}</div></div>
                <div class="form-group"><label>Driver</label><div>${escapeHtml(d.driver_name || '-')}</div></div></div>`;
        } else if (type === 'receipt' || type === 'payment') {
            detailsHtml = `
                <div class="form-row"><div class="form-group"><label>Party</label><div><strong>${escapeHtml(d.party_name || 'N/A')}</strong></div></div>
                <div class="form-group"><label>Date</label><div>${formatDate(d.date)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Type</label><div>${type === 'receipt' ? '💰 Receipt' : '💸 Payment'}</div></div>
                <div class="form-group"><label>Amount</label><div style="font-weight:700;font-size:16px;color:${type === 'receipt' ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(d.amount)}</div></div></div>
                <div class="form-row"><div class="form-group"><label>Mode</label><div>${statusBadge(d.mode)}</div></div>
                <div class="form-group"><label>Notes</label><div>${escapeHtml(d.notes || '-')}</div></div></div>`;
        }
        
        showModal(`
            <div class="modal-header">
                <h2>${typeLabels[type] || 'Transaction'} #${id}</h2>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                ${detailsHtml}
                <div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--text-light)">
                    💡 To edit this ${type}, go to the ${typeLabels[type] || 'transaction'} page via the sidebar.
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        `);
    });
}

// ============================================================
// Helper: Delete sale directly from Sales Register
// ============================================================
async function deleteSaleFromRegister(id) {
    const confirmed = await confirmAction(
        'Delete this sale?',
        'This will permanently remove the sale invoice and all its items. This action cannot be undone.',
        'Yes, Delete Sale'
    );
    if (!confirmed) return;
    const result = await window.api.deleteSale(id);
    if (result.success) {
        showToast('Sale deleted successfully!', 'success');
        applySalesRegister();
    } else {
        showToast('Error: ' + (result.error || 'Failed to delete'), 'error');
    }
}

// ============================================================
// Helper: Delete purchase directly from Purchase Register
// ============================================================
async function deletePurchaseFromRegister(id) {
    const confirmed = await confirmAction(
        'Delete this purchase?',
        'This will permanently remove the purchase bill and all its items. This action cannot be undone.',
        'Yes, Delete Purchase'
    );
    if (!confirmed) return;
    const result = await window.api.deletePurchase(id);
    if (result.success) {
        showToast('Purchase deleted successfully!', 'success');
        applyPurchaseRegister();
    } else {
        showToast('Error: ' + (result.error || 'Failed to delete'), 'error');
    }
}

// Globals
window.renderReports = renderReports;
window.showSalesReport = showSalesReport;
window.showPurchasesReport = showPurchasesReport;
window.showDayBook = showDayBook;
window.showOutstandingReport = showOutstandingReport;
window.showSalesRegister = showSalesRegister;
window.showPurchaseRegister = showPurchaseRegister;
window.applySalesReport = applySalesReport;
window.applyPurchasesReport = applyPurchasesReport;
window.applyDayBook = applyDayBook;
window.applySalesRegister = applySalesRegister;
window.applyPurchaseRegister = applyPurchaseRegister;
window.showPurchaseVsSales = showPurchaseVsSales;
window.pvsApply = pvsApply;
window.pvsPreset = pvsPreset;
window.pvsCustom = pvsCustom;
window.pvsReset = pvsReset;
window.pvsPage = pvsPage;
window.pvsShowParty = pvsShowParty;
window.pvsShowDay = pvsShowDay;
window.pvsPrint = pvsPrint;
window.pvsExportPDF = pvsExportPDF;
window.pvsExportExcel = pvsExportExcel;
window.printSalesReport = printSalesReport;
window.exportSalesReportPDF = exportSalesReportPDF;
window.printPurchasesReport = printPurchasesReport;
window.exportPurchasesReportPDF = exportPurchasesReportPDF;
window.printDayBook = printDayBook;
window.exportDayBookPDF = exportDayBookPDF;
window.printOutstandingReport = printOutstandingReport;
window.exportOutstandingPDF = exportOutstandingPDF;
window.printSalesRegister = printSalesRegister;
window.exportSalesRegisterPDF = exportSalesRegisterPDF;
window.printPurchaseRegister = printPurchaseRegister;
window.exportPurchaseRegisterPDF = exportPurchaseRegisterPDF;
window.viewDaybookEntry = viewDaybookEntry;
window.deleteSaleFromRegister = deleteSaleFromRegister;
window.deletePurchaseFromRegister = deletePurchaseFromRegister;

/**
 * Export the database to a Daily Account Pro Excel workbook.
 * Electron: main process saves via dialog. Web: downloads the generated file.
 */
async function exportDailyAccountExcel() {
    try {
        if (window.api && typeof window.api.exportDailyAccount === 'function') {
            // Electron desktop mode — main process shows the save dialog
            const result = await window.api.exportDailyAccount();
            if (result && result.success) {
                alert('✅ Daily Account Pro export saved:\n' + (result.filePath || ''));
            } else if (result && !result.cancelled) {
                alert('⚠️ Export failed: ' + ((result && result.error) || 'unknown error'));
            }
            return;
        }
        // Web mode — POST and download the response as a file
        const headers = { 'Content-Type': 'application/json' };
        try {
            const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
            if (token) headers['Authorization'] = 'Bearer ' + token;
        } catch (e) { /* storage unavailable */ }
        const res = await fetch('/api/export/daily-account', { method: 'POST', headers, body: '{}', credentials: 'include' });
        if (!res.ok) {
            alert('⚠️ Export failed (HTTP ' + res.status + ')');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Daily_Account_Professional_Export.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error('Daily Account export failed:', err);
        alert('⚠️ Export failed: ' + err.message);
    }
}
window.exportDailyAccountExcel = exportDailyAccountExcel;
