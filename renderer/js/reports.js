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
    const preset = getDatePreset('today');
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
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total Entries</span><span class="value" style="font-size:20px">${data.count || 0}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Debit</span><span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.totalDebit)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Credit</span><span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.totalCredit)}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Net Balance</span><span class="value" style="font-size:18px">${formatCurrency(data.net)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Account/Party</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th></tr></thead>
                <tbody>
                    ${(data.entries || []).map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.ref_no || '')}</td>
                            <td><span class="badge ${e.type === 'sale' || e.type === 'receipt' ? 'badge-success' : 'badge-danger'}">${e.transaction_type || e.type}</span></td>
                            <td>${escapeHtml(e.account || '')}</td>
                            <td>${escapeHtml(e.particulars || '')}</td>
                            <td class="text-right" style="color:${e.debit > 0 ? 'var(--accent)' : ''}">${e.debit > 0 ? formatCurrency(e.debit) : ''}</td>
                            <td class="text-right" style="color:${e.credit > 0 ? 'var(--danger)' : ''}">${e.credit > 0 ? formatCurrency(e.credit) : ''}</td>
                        </tr>
                    `).join('')}
                    ${(!data.entries || data.entries.length === 0) ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No transactions in this period</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="5"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.totalDebit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.totalCredit)}</strong></td>
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
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Invoices</span><span class="value" style="font-size:20px">${data.count}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Sales</span><span class="value" style="font-size:20px">${formatCurrency(data.total)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Due</span><span class="value" style="font-size:18px">${formatCurrency(data.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Products</th><th class="text-right">Gross</th><th class="text-right">Disc</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Mode</th><th>Status</th></tr></thead>
                <tbody>${data.sales.map(s => `<tr><td>${formatDate(s.date)}</td><td>${escapeHtml(s.invoice_no)}</td><td>${escapeHtml(s.party_name)}</td><td style="max-width:200px;font-size:11px">${escapeHtml((s.products_summary||'').substring(0,60))}${(s.products_summary||'').length > 60 ? '...' : ''}</td><td class="text-right">${formatCurrency(s.subtotal)}</td><td class="text-right">${formatCurrency(s.discount)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td><td class="text-right">${formatCurrency(s.paid_amount)}</td><td class="text-right" style="color:${(s.grand_total - s.paid_amount) > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(s.grand_total - s.paid_amount)}</td><td>${statusBadge(s.payment_mode)}</td><td>${statusBadge(s.status)}</td></tr>`).join('')}
                ${data.sales.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No sales found</td></tr>' : ''}</tbody>
                <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td colspan="2"></td></tr></tfoot>
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
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Bills</span><span class="value" style="font-size:20px">${data.count}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Purchases</span><span class="value" style="font-size:20px">${formatCurrency(data.total)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Due</span><span class="value" style="font-size:18px">${formatCurrency(data.totalDue)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Bill No</th><th>Supplier</th><th>Items</th><th class="text-right">Gross</th><th class="text-right">Charges</th><th class="text-right">Net</th><th class="text-right">Paid</th><th class="text-right">Due</th><th>Status</th></tr></thead>
                <tbody>${data.purchases.map(p => `<tr><td>${formatDate(p.date)}</td><td>${escapeHtml(p.bill_no)}</td><td>${escapeHtml(p.party_name)}</td><td style="max-width:200px;font-size:11px">${escapeHtml((p.products_summary||'').substring(0,60))}${(p.products_summary||'').length > 60 ? '...' : ''}</td><td class="text-right">${formatCurrency(p.subtotal)}</td><td class="text-right">${formatCurrency((p.transport_charges||0)+(p.extra_charges||0))}</td><td class="text-right">${formatCurrency(p.grand_total)}</td><td class="text-right">${formatCurrency(p.paid_amount)}</td><td class="text-right" style="color:${(p.grand_total - p.paid_amount) > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(p.grand_total - p.paid_amount)}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}
                ${data.purchases.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No purchases found</td></tr>' : ''}</tbody>
                <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalPaid)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDue)}</strong></td><td></td></tr></tfoot>
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
// Print / PDF Helpers
// ============================================================
async function printSalesReport(fromDate, toDate, partyId) {
    const result = await window.api.getSalesReport({ from_date: fromDate, to_date: toDate, party_id: partyId || undefined });
    if (!result.success) return;
    const report = result.data;
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Sales Report</h2><p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'} | Total Sales: ${report.sales.length} | Total: ${formatCurrency(report.total)}</p></div>
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
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
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
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
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
