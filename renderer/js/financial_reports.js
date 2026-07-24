/**
 * Financial Reports Module
 * ========================
 * Dedicated pages: Profit/Loss, Receivable/Payable, Stock Statement,
 * Daybook, Cash Collection — each as its own sidebar-accessible page.
 */

let _finLastData = {};

// ============================================================
// Profit & Loss Statement
// ============================================================
async function showProfitLoss() {
    const container = document.getElementById('page-financial-reports');
    const preset = getDatePreset('this_month');
    const result = await window.api.getProfitLoss({ from_date: preset.from, to_date: preset.to });
    const data = result.success ? result.data : { 
        income: { total_sales: 0, total_receipts: 0, total_income: 0 },
        expenses: { milk_collection: { total: 0 }, purchases: { total: 0 }, other_expenses: { total: 0 }, petty_cash: { total: 0 }, salary: { total: 0 }, vehicle_expenses: { total: 0 }, total_expenses: 0 },
        gross_profit: 0, net_profit: 0 
    };
    _finLastData.profitLoss = data;

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📊 Profit & Loss Statement</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printProfitLoss()">🖨 Print</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="plFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="plTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyProfitLoss()">Generate</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">💰 Total Income</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.income.total_income)}</span>
                <span class="sub">Sales (${formatCurrency(data.income.total_sales)}) + Receipts (${formatCurrency(data.income.total_receipts)})</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">📉 Total Expenses</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.expenses.total_expenses)}</span>
                <span class="sub">All operational costs</span>
            </div>
            <div class="summary-card ${data.net_profit >= 0 ? 'card-primary' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">${data.net_profit >= 0 ? '📈 Net Profit' : '📉 Net Loss'}</span>
                <span class="value" style="font-size:22px;font-weight:700">${formatCurrency(data.net_profit)}</span>
                <span class="sub">Gross Profit: ${formatCurrency(data.gross_profit)}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card">
                <div class="card-header"><h3>💰 Income Breakdown</h3></div>
                <table>
                    <thead><tr><th>Source</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        <tr><td>Sales (${data.sales_count || 0} invoices)</td><td class="text-right" style="color:var(--accent);font-weight:600">${formatCurrency(data.income.total_sales)}</td></tr>
                        <tr><td>Cash Receipts</td><td class="text-right" style="color:var(--accent)">${formatCurrency(data.income.total_receipts)}</td></tr>
                        <tr style="background:var(--bg);font-weight:700"><td>Total Income</td><td class="text-right">${formatCurrency(data.income.total_income)}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="card">
                <div class="card-header"><h3>📉 Expense Breakdown</h3></div>
                <table>
                    <thead><tr><th>Category</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        <tr><td>🥛 Milk Collection (${data.milk_collection_count || 0})</td><td class="text-right">${formatCurrency(data.expenses.milk_collection.total)}</td></tr>
                        <tr><td>📦 Purchases</td><td class="text-right">${formatCurrency(data.expenses.purchases.total)}</td></tr>
                        <tr><td>📋 Other Expenses</td><td class="text-right">${formatCurrency(data.expenses.other_expenses.total)}</td></tr>
                        <tr><td>💰 Petty Cash</td><td class="text-right">${formatCurrency(data.expenses.petty_cash.total)}</td></tr>
                        <tr><td>👷 Salary</td><td class="text-right">${formatCurrency(data.expenses.salary.total)}</td></tr>
                        <tr><td>🚛 Vehicle Expenses</td><td class="text-right">${formatCurrency(data.expenses.vehicle_expenses.total)}</td></tr>
                        <tr style="background:var(--bg);font-weight:700"><td>Total Expenses</td><td class="text-right">${formatCurrency(data.expenses.total_expenses)}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="card" style="margin-top:12px;padding:16px;text-align:center;background:${data.net_profit >= 0 ? 'var(--success-bg, #d4edda)' : 'var(--danger-bg, #f8d7da)'};border-radius:8px">
            <span style="font-size:18px;font-weight:700;color:${data.net_profit >= 0 ? 'var(--accent, #155724)' : 'var(--danger, #721c24)'}">
                ${data.net_profit >= 0 ? '✅ NET PROFIT: ' : '❌ NET LOSS: '} ${formatCurrency(Math.abs(data.net_profit))}
            </span>
            <span style="display:block;font-size:13px;margin-top:4px;opacity:0.8">
                Period: ${data.from_date || preset.from} to ${data.to_date || preset.to}
            </span>
        </div>
    `;
}

async function applyProfitLoss() {
    const from = document.getElementById('plFrom')?.value || '';
    const to = document.getElementById('plTo')?.value || '';
    const result = await window.api.getProfitLoss({ from_date: from, to_date: to });
    if (result.success) _finLastData.profitLoss = result.data;
    else showToast(result.error || 'Failed to load', 'error');
    showProfitLoss();
}

async function printProfitLoss() {
    const data = _finLastData.profitLoss;
    if (!data) { showToast('Generate report first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Profit & Loss Statement</h2><p>Period: ${data.from_date} to ${data.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Income</div><div class="value-number">${formatCurrency(data.income.total_income)}</div></div>
            <div class="value-card" style="border-color:var(--danger)"><div class="value-label">Total Expenses</div><div class="value-number">${formatCurrency(data.expenses.total_expenses)}</div></div>
            <div class="value-card" style="border-color:${data.net_profit >= 0 ? 'var(--accent)' : 'var(--danger)'}"><div class="value-label">${data.net_profit >= 0 ? 'Net Profit' : 'Net Loss'}</div><div class="value-number">${formatCurrency(Math.abs(data.net_profit))}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Receivable / Payable
// ============================================================
async function showReceivablePayable() {
    const container = document.getElementById('page-receivable-payable');
    document.getElementById('topActions').innerHTML = '';

    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);

    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];
    const totalReceivable = receivables.reduce((s, r) => s + r.outstanding, 0);
    const totalPayable = payables.reduce((s, p) => s + p.outstanding, 0);
    const netPosition = totalReceivable - totalPayable;

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">💰 Receivables & Payables</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printReceivablePayable()">🖨 Print</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">💰 Total Receivables</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalReceivable)}</span>
                <span class="sub">From ${receivables.length} customers</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">⚠️ Total Payables</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalPayable)}</span>
                <span class="sub">To ${payables.length} suppliers</span>
            </div>
            <div class="summary-card ${netPosition >= 0 ? 'card-primary' : 'card-warning'}" style="margin:0;padding:12px">
                <span class="label">📊 Net Position</span>
                <span class="value" style="font-size:20px">${formatCurrency(netPosition)}</span>
                <span class="sub">${netPosition >= 0 ? 'Net Receivable' : 'Net Payable'}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">💰 Receivables (Customers owe you)</h3>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Customer</th><th>Phone</th><th class="text-right">Outstanding</th></tr></thead>
                        <tbody>
                            ${receivables.map(r => `<tr>
                                <td><strong>${escapeHtml(r.name)}</strong></td>
                                <td>${escapeHtml(r.phone || '-')}</td>
                                <td class="text-right" style="color:var(--accent);font-weight:600">${formatCurrency(r.outstanding)}</td>
                            </tr>`).join('')}
                            ${receivables.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-light)">No outstanding receivables</td></tr>' : ''}
                        </tbody>
                        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(totalReceivable)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">⚠️ Payables (You owe suppliers)</h3>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Supplier</th><th>Phone</th><th class="text-right">Outstanding</th></tr></thead>
                        <tbody>
                            ${payables.map(p => `<tr>
                                <td><strong>${escapeHtml(p.name)}</strong></td>
                                <td>${escapeHtml(p.phone || '-')}</td>
                                <td class="text-right" style="color:var(--danger);font-weight:600">${formatCurrency(p.outstanding)}</td>
                            </tr>`).join('')}
                            ${payables.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-light)">No outstanding payables</td></tr>' : ''}
                        </tbody>
                        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(totalPayable)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
        </div>
    `;
    _finLastData.receivablePayable = { receivables, payables, totalReceivable, totalPayable, netPosition };
}

async function printReceivablePayable() {
    const d = _finLastData.receivablePayable;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Receivables & Payables</h2><p>As of: ${formatDate(today())}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Receivables</div><div class="value-number">${formatCurrency(d.totalReceivable)}</div></div>
            <div class="value-card" style="border-color:var(--danger)"><div class="value-label">Total Payables</div><div class="value-number">${formatCurrency(d.totalPayable)}</div></div>
            <div class="value-card"><div class="value-label">Net Position</div><div class="value-number">${formatCurrency(d.netPosition)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Stock Statement
// ============================================================
async function showStockStatement() {
    const container = document.getElementById('page-stock-statement');
    document.getElementById('topActions').innerHTML = '';

    const result = await window.api.getStockStatement({});
    const data = result.success ? result.data : { items: [], total_value: 0, total_products: 0, total_quantity: 0, categories: [] };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📋 Stock Statement</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printStockStatementReport()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportStockStatementPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>Category</label>
                <select class="form-control" id="ssCategory" onchange="applyStockStatement()">
                    <option value="">All Categories</option>
                    ${data.categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Search</label>
                <input type="text" class="form-control" id="ssSearch" placeholder="Search product..." onkeyup="if(event.key==='Enter')applyStockStatement()">
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyStockStatement()">Filter</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">📦 Products</span><span class="value" style="font-size:20px">${data.total_products}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">📏 Total Quantity</span><span class="value" style="font-size:20px">${formatNumber(data.total_quantity)}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">💰 Total Value</span><span class="value" style="font-size:20px">${formatCurrency(data.total_value)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Product</th><th>Category</th><th>Unit</th><th class="text-right">Stock Qty</th><th class="text-right">Rate</th><th class="text-right">Stock Value</th><th>Status</th></tr></thead>
                <tbody>
                    ${data.items.map(i => {
                        const stock = i.current_stock || 0;
                        const reorder = i.reorder_level || 0;
                        const status = stock <= 0 ? 'danger' : stock <= reorder ? 'warning' : 'success';
                        const statusLabel = stock <= 0 ? 'Out of Stock' : stock <= reorder ? 'Low Stock' : 'In Stock';
                        return `<tr>
                            <td><strong>${escapeHtml(i.name)}</strong></td>
                            <td>${escapeHtml(i.category || '-')}</td>
                            <td>${escapeHtml(i.unit)}</td>
                            <td class="text-right">${formatNumber(stock)}</td>
                            <td class="text-right">${formatCurrency(i.rate || 0)}</td>
                            <td class="text-right" style="font-weight:600">${formatCurrency(i.stock_value || 0)}</td>
                            <td><span class="badge badge-${status}">${statusLabel}</span></td>
                        </tr>`;
                    }).join('')}
                    ${data.items.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No products found</td></tr>' : ''}
                </tbody>
                <tfoot><tr>
                    <td colspan="3"><strong>Total</strong></td>
                    <td class="text-right"><strong>${formatNumber(data.total_quantity)}</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_value)}</strong></td>
                    <td></td>
                </tr></tfoot>
            </table>
        </div>
    `;
    _finLastData.stockStatement = data;
}

async function applyStockStatement() {
    const category = document.getElementById('ssCategory')?.value || '';
    const search = document.getElementById('ssSearch')?.value || '';
    const result = await window.api.getStockStatement({ category: category || undefined, search: search || undefined });
    if (result.success) {
        _finLastData.stockStatement = result.data;
        showStockStatement();
    } else {
        showToast(result.error, 'error');
    }
}

async function printStockStatementReport() {
    const data = _finLastData.stockStatement;
    if (!data) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Stock Statement</h2><p>As of: ${formatDate(today())}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Products</div><div class="value-number">${data.total_products}</div></div>
            <div class="value-card"><div class="value-label">Total Qty</div><div class="value-number">${formatNumber(data.total_quantity)}</div></div>
            <div class="value-card"><div class="value-label">Total Value</div><div class="value-number">${formatCurrency(data.total_value)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportStockStatementPDF() {
    const data = _finLastData.stockStatement;
    if (!data) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Stock Statement</h2><p>Total Value: ${formatCurrency(data.total_value)}</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

// ============================================================
// Daybook
// ============================================================
async function showDaybookPage() {
    const container = document.getElementById('page-daybook');
    document.getElementById('topActions').innerHTML = '';
    const preset = getDatePreset('today');

    const result = await window.api.getDayBook({ from_date: preset.from, to_date: preset.to });
    const data = result.success ? result.data : { entries: [], totalDebit: 0, totalCredit: 0, net: 0, count: 0 };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📅 Daybook</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printDaybookPage()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportDaybookPagePDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="dbFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="dbTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyDaybookPage()">View</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('today');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">Today</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('this_month');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">This Month</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('last_month');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">Last Month</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Entries</span><span class="value" style="font-size:20px">${data.count || 0}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Debit</span><span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.totalDebit)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Credit</span><span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.totalCredit)}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Net Balance</span><span class="value" style="font-size:18px">${formatCurrency(data.net)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Account</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th></tr></thead>
                <tbody>
                    ${(data.entries || []).map(e => {
                        const badgeClass = e.type === 'sale' || e.transaction_type === 'Sale' ? 'badge-primary' : 
                            e.type === 'receipt' || e.transaction_type === 'Receipt' ? 'badge-success' : 'badge-danger';
                        return `<tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.ref_no || '')}</td>
                            <td><span class="badge ${badgeClass}">${e.transaction_type || e.type}</span></td>
                            <td>${escapeHtml(e.account || '')}</td>
                            <td style="max-width:200px;font-size:12px">${escapeHtml(e.particulars || '')}</td>
                            <td class="text-right" style="color:${e.debit > 0 ? 'var(--accent)' : ''}">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                            <td class="text-right" style="color:${e.credit > 0 ? 'var(--danger)' : ''}">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                        </tr>`;
                    }).join('')}
                    ${(!data.entries || data.entries.length === 0) ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No transactions found</td></tr>' : ''}
                </tbody>
                <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDebit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalCredit)}</strong></td></tr></tfoot>
            </table>
        </div>
    `;
    _finLastData.daybook = data;
}

function applyDaybookPage() {
    const from = document.getElementById('dbFrom')?.value || '';
    const to = document.getElementById('dbTo')?.value || '';
    window.api.getDayBook({ from_date: from, to_date: to }).then(r => {
        if (r.success) { _finLastData.daybook = r.data; showDaybookPage(); }
        else showToast(r.error, 'error');
    });
}

async function printDaybookPage() {
    const d = _finLastData.daybook;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Daybook</h2><p>Period: ${d.from_date} to ${d.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Entries</div><div class="value-number">${d.count}</div></div>
            <div class="value-card"><div class="value-label">Debit</div><div class="value-number">${formatCurrency(d.totalDebit)}</div></div>
            <div class="value-card"><div class="value-label">Credit</div><div class="value-number">${formatCurrency(d.totalCredit)}</div></div>
            <div class="value-card"><div class="value-label">Net</div><div class="value-number">${formatCurrency(d.net)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    printHTML(html);
}

async function exportDaybookPagePDF() { await printDaybookPage(); }

// ============================================================
// Payment Collection (dedicated page) — with Record Collection
// ============================================================

const PAYMENT_MODES = [
    { value: 'cash', label: 'Cash', icon: '💵' },
    { value: 'cheque', label: 'Cheque', icon: '📄' },
    { value: 'online', label: 'Online / UPI', icon: '📱' },
    { value: 'bank', label: 'Bank Transfer', icon: '🏦' },
    { value: 'mixed', label: 'Mixed', icon: '🔀' }
];

async function showCashCollectionPage() {
    const container = document.getElementById('page-cash-collection');
    document.getElementById('topActions').innerHTML = '';
    const preset = getDatePreset('this_month');

    const result = await window.api.getDailyCashCollection({ from_date: preset.from, to_date: preset.to });
    const data = result.success ? result.data : { days: [], total_cash_in: 0, total_cash_out: 0, net_cash: 0 };

    const modeIcon = (mode) => {
        const m = PAYMENT_MODES.find(p => p.value === mode);
        return m ? m.icon + ' ' + m.label : (mode || '—');
    };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">💰 Payment Collection Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printCashCollectionPage()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportCashCollectionPagePDF()">📄 PDF</button>
            </div>
        </div>

        <!-- Quick Action Card: Record Payment Collection -->
        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;border:2px dashed #64b5f6;transition:all 0.2s" 
             onclick="showAddCashCollectionRecord()"
             onmouseover="this.style.background='linear-gradient(135deg,#bbdefb,#90caf9)';this.style.borderColor='#2196f3';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.background='linear-gradient(135deg,#e3f2fd,#bbdefb)';this.style.borderColor='#64b5f6';this.style.transform='none'">
            <div>
                <div style="font-size:16px;font-weight:700;color:#1565c0">➕ Record Payment Collection</div>
                <div style="font-size:13px;color:#1976d2;margin-top:2px">Record incoming/outgoing payments with cash, cheque, online/UPI, or bank transfer</div>
            </div>
            <div style="font-size:32px;color:#1976d2">📝</div>
        </div>

        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="ccFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="ccTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyCashCollectionPage()">Generate</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total In</span><span class="value" style="font-size:20px">${formatCurrency(data.total_cash_in)}</span><span class="sub">Sales + Receipts + Other</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Out</span><span class="value" style="font-size:20px">${formatCurrency(data.total_cash_out)}</span><span class="sub">Payments made</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Net Position</span><span class="value" style="font-size:20px">${formatCurrency(data.net_cash)}</span><span class="sub">${data.net_cash >= 0 ? 'Surplus' : 'Deficit'}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Party</th><th class="text-right">Sales</th><th class="text-right">Receipts</th><th class="text-right">Total In</th><th class="text-right">Payments</th><th class="text-right">Other</th><th class="text-right">Net</th><th>Mode</th><th class="actions">Source</th></tr></thead>
                <tbody>
                    ${data.days.map(d => {
                        const partyLabel = d.party_names && d.party_names.length > 0 
                            ? d.party_names.join(', ') 
                            : (d.manual_entry ? '—' : '—');
                        return `<tr>
                        <td>${formatDate(d.date)}</td>
                        <td style="font-size:12px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.party_names && d.party_names.length > 0 ? escapeHtml(partyLabel) : '<span style="color:var(--text-light)">' + partyLabel + '</span>'}</td>
                        <td class="text-right">${formatCurrency(d.cash_sales_total)}</td>
                        <td class="text-right">${formatCurrency(d.cash_receipts_total)}</td>
                        <td class="text-right"><strong>${formatCurrency(d.total_cash_in)}</strong></td>
                        <td class="text-right" style="color:var(--danger)">${formatCurrency(d.total_cash_out)}</td>
                        <td class="text-right">${formatCurrency(d.other_receipts_total)}</td>
                        <td class="text-right" style="font-weight:600;color:${d.net_cash >= 0 ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(d.net_cash)}</td>
                        <td style="font-size:12px">${d.manual_entry ? modeIcon(d.payment_mode) : '<span style="color:var(--text-light)">—</span>'}</td>
                        <td class="actions" style="font-size:11px">${d.manual_entry ? '<span style="color:var(--accent);font-weight:600">📝 Manual</span>' : '<span style="color:var(--text-light)">Auto</span>'}</td>
                    </tr>`;
                    }).join('')}
                    ${data.days.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No data for this period. Click "Record Payment Collection" to add a manual entry.</td></tr>' : ''}
                </tbody>
                <tfoot><tr><td><strong>Total</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_sales_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_receipts_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_cash_in)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_cash_out)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.other_receipts_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.net_cash)}</strong></td>
                    <td></td>
                    <td></td>
                </tr></tfoot>
            </table>
        </div>

        <!-- Manual Entries Section with Edit/Delete -->
        ${data.manual_entries && data.manual_entries.length > 0 ? `
        <div style="margin-top:24px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <span style="font-size:16px">📝</span>
                <h3 style="font-size:15px;font-weight:700;margin:0">Manual Entries</h3>
                <span style="font-size:11px;background:var(--bg);color:var(--text-light);padding:2px 8px;border-radius:4px">${data.manual_entries.length} record(s)</span>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Ref No</th><th class="text-right">Sales</th><th class="text-right">Receipts</th><th class="text-right">Payments</th><th class="text-right">Other</th><th>Mode</th><th>Party</th><th>Notes</th><th class="actions" style="min-width:80px">Actions</th></tr></thead>
                    <tbody>
                        ${data.manual_entries.map(e => {
                            const partyName = e.party_id ? (e.party_name || 'Party #' + e.party_id) : '-';
                            return `<tr>
                                <td>${formatDate(e.date)}</td>
                                <td style="font-size:12px;font-family:monospace;color:var(--primary)">${escapeHtml(e.ref_no || '')}</td>
                                <td class="text-right">${formatCurrency(e.cash_sales || 0)}</td>
                                <td class="text-right">${formatCurrency(e.cash_receipts || 0)}</td>
                                <td class="text-right" style="color:var(--danger)">${formatCurrency(e.cash_payments || 0)}</td>
                                <td class="text-right">${formatCurrency(e.other_receipts || 0)}</td>
                                <td style="font-size:12px">${modeIcon(e.payment_mode)}</td>
                                <td style="font-size:12px">${escapeHtml(partyName)}</td>
                                <td style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.notes || '')}</td>
                                <td class="actions" style="white-space:nowrap">
                                    <button class="btn btn-sm btn-secondary" onclick="editCashCollectionRecord(${e.id})" title="Edit" style="padding:2px 8px;font-size:12px">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteCashCollectionRecord(${e.id})" title="Delete" style="padding:2px 8px;font-size:12px">🗑️</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}
    `;
    _finLastData.cashCollection = data;
}

function applyCashCollectionPage() {
    const from = document.getElementById('ccFrom')?.value || '';
    const to = document.getElementById('ccTo')?.value || '';
    window.api.getDailyCashCollection({ from_date: from, to_date: to }).then(r => {
        if (r.success) { _finLastData.cashCollection = r.data; showCashCollectionPage(); }
        else showToast(r.error, 'error');
    });
}

// ============================================================
// Add Manual Payment Collection Record
// ============================================================
async function showAddCashCollectionRecord(record) {
    const today = new Date().toISOString().split('T')[0];
    const isEdit = !!record;

    const modeOptions = PAYMENT_MODES.map(m => 
        `<option value="${m.value}"${record && record.payment_mode === m.value ? ' selected' : ''}>${m.icon} ${m.label}</option>`
    ).join('');

    // Fetch parties for the dropdown
    const partiesResult = await window.api.getParties({});
    const parties = partiesResult.success ? partiesResult.data : [];
    const partyOptions = parties.map(p => 
        `<option value="${p.id}"${record && record.party_id == p.id ? ' selected' : ''}>${escapeHtml(p.name)}${p.phone ? ' (' + escapeHtml(p.phone) + ')' : ''}</option>`
    ).join('');

    const title = isEdit ? '✏️ Edit Payment Collection' : '📝 Record Payment Collection';
    const btnText = isEdit ? '💾 Update & Integrate' : '💾 Save & Integrate';
    const recordIdHtml = isEdit ? `<input type="hidden" id="ccRecordId" value="${record.id}">` : '';

    const defaultDate = record ? record.date : today;
    const defaultRefNo = record ? (escapeHtml(record.ref_no || '')) : '';
    const defaultSales = record ? (record.cash_sales || 0) : 0;
    const defaultReceipts = record ? (record.cash_receipts || 0) : 0;
    const defaultPayments = record ? (record.cash_payments || 0) : 0;
    const defaultOther = record ? (record.other_receipts || 0) : 0;
    const defaultNotes = record ? (escapeHtml(record.notes || '')) : '';

    showModal(`
        <div class="modal-header">
            <h2>${title}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${recordIdHtml}
            <div class="form-row">
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" class="form-control" id="ccRecordDate" value="${defaultDate}">
                </div>
                <div class="form-group">
                    <label>Payment Mode *</label>
                    <select class="form-control" id="ccPaymentMode" onchange="updateCashCollectionPreview()">
                        ${modeOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1">
                    <label>🔖 Ref / Transaction No.</label>
                    <input type="text" class="form-control" id="ccRefNo" value="${defaultRefNo}" placeholder="e.g. RC-2026-001 / CHQ-004256">
                </div>
                <div class="form-group" style="flex:0.5">
                    <label>&nbsp;</label>
                    <div style="font-size:11px;color:var(--text-light);padding-top:6px">Optional reference number for tracking</div>
                </div>
            </div>
            <div class="form-section-title">Party & Integration</div>
            <div class="form-row">
                <div class="form-group">
                    <label>👤 Party (Customer/Supplier)</label>
                    <select class="form-control" id="ccPartyId">
                        <option value="">-- Select Party (optional) --</option>
                        ${partyOptions}
                    </select>
                    <small style="color:var(--text-light);font-size:11px">When selected, the amounts will automatically appear in the party's statement and the daybook.</small>
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);padding:12px;border-radius:8px;font-size:12px;color:#1565c0">
                        <strong>💡 Auto-Integration</strong>
                        <div style="margin-top:4px">The amounts will be automatically posted to party statement, ledger, daybook, and reports.</div>
                    </div>
                </div>
            </div>
            <div class="form-section-title">Amount Breakdown</div>
            <div class="form-row">
                <div class="form-group">
                    <label>💰 Sales Amount</label>
                    <input type="number" class="form-control" id="ccCashSales" value="${defaultSales}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>📩 Receipts Amount</label>
                    <input type="number" class="form-control" id="ccCashReceipts" value="${defaultReceipts}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>💸 Payments (Out)</label>
                    <input type="number" class="form-control" id="ccCashPayments" value="${defaultPayments}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>📊 Other Receipts</label>
                    <input type="number" class="form-control" id="ccOtherReceipts" value="${defaultOther}" min="0" step="0.01" placeholder="0.00">
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0;padding:16px;background:var(--bg);border-radius:8px">
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Total In</div>
                    <div id="ccPreviewIn" style="font-size:18px;font-weight:700;color:var(--accent)">रु 0.00</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Total Out</div>
                    <div id="ccPreviewOut" style="font-size:18px;font-weight:700;color:var(--danger)">रु 0.00</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Net Position</div>
                    <div id="ccPreviewNet" style="font-size:18px;font-weight:700;color:var(--primary)">रु 0.00</div>
                </div>
            </div>
            <div class="form-group">
                <label>Notes</label>
                <textarea class="form-control" id="ccNotes" rows="2" placeholder="e.g. Daily payment collection summary">${defaultNotes}</textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="saveCashCollectionRecord()">${btnText}</button>
        </div>
    `);

    // Live preview on input
    ['ccCashSales', 'ccCashReceipts', 'ccCashPayments', 'ccOtherReceipts'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateCashCollectionPreview);
    });
    updateCashCollectionPreview();
}

function updateCashCollectionPreview() {
    const v = (id) => parseFloat(document.getElementById(id)?.value || 0);
    const cashIn = v('ccCashSales') + v('ccCashReceipts') + v('ccOtherReceipts');
    const cashOut = v('ccCashPayments');
    const net = cashIn - cashOut;

    const fmt = (val) => 'रु ' + val.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const elIn = document.getElementById('ccPreviewIn');
    const elOut = document.getElementById('ccPreviewOut');
    const elNet = document.getElementById('ccPreviewNet');
    if (elIn) { elIn.textContent = fmt(cashIn); elIn.style.color = 'var(--accent)'; }
    if (elOut) { elOut.textContent = fmt(cashOut); elOut.style.color = cashOut > 0 ? 'var(--danger)' : 'var(--text-light)'; }
    if (elNet) { 
        elNet.textContent = fmt(net); 
        elNet.style.color = net >= 0 ? 'var(--accent)' : 'var(--danger)'; 
    }
}

async function saveCashCollectionRecord() {
    const partyId = document.getElementById('ccPartyId')?.value;
    const recordId = document.getElementById('ccRecordId')?.value;
    const isEdit = !!recordId;

    const data = {
        date: document.getElementById('ccRecordDate')?.value || '',
        ref_no: document.getElementById('ccRefNo')?.value || '',
        payment_mode: document.getElementById('ccPaymentMode')?.value || 'cash',
        party_id: partyId ? parseInt(partyId) : null,
        cash_sales: parseFloat(document.getElementById('ccCashSales')?.value || 0),
        cash_receipts: parseFloat(document.getElementById('ccCashReceipts')?.value || 0),
        cash_payments: parseFloat(document.getElementById('ccCashPayments')?.value || 0),
        other_receipts: parseFloat(document.getElementById('ccOtherReceipts')?.value || 0),
        notes: document.getElementById('ccNotes')?.value || ''
    };

    // Include record ID for edits
    if (isEdit) data.id = parseInt(recordId);

    if (!data.date) { showToast('Date is required', 'error'); return; }
    const totalIn = data.cash_sales + data.cash_receipts + data.other_receipts;
    if (totalIn === 0 && data.cash_payments === 0) {
        showToast('Enter at least one amount', 'warning');
        return;
    }

    const result = await window.api.saveCashCollection(data);
    if (result.success) {
        closeModal();
        const integrated = partyId ? ' and integrated into party statement/ledger/daybook' : '';
        const action = isEdit ? 'updated' : 'saved';
        showToast('Payment collection record ' + action + integrated + '!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to save', 'error');
    }
}

async function printCashCollectionPage() {
    const d = _finLastData.cashCollection;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Payment Collection Report</h2><p>Period: ${d.from_date} to ${d.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total In</div><div class="value-number">${formatCurrency(d.total_cash_in)}</div></div>
            <div class="value-card"><div class="value-label">Total Out</div><div class="value-number">${formatCurrency(d.total_cash_out)}</div></div>
            <div class="value-card"><div class="value-label">Net</div><div class="value-number">${formatCurrency(d.net_cash)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    printHTML(html);
}

async function exportCashCollectionPagePDF() { await printCashCollectionPage(); }

// ============================================================
// Edit Manual Payment Collection Record
// ============================================================

/**
 * Open the record modal pre-filled with an existing manual entry's data.
 */
function editCashCollectionRecord(id) {
    const record = _finLastData.cashCollection?.manual_entries?.find(e => e.id === id);
    if (!record) {
        showToast('Could not find record to edit', 'error');
        return;
    }
    showAddCashCollectionRecord(record);
}

// ============================================================
// Delete Manual Payment Collection Record
// ============================================================

async function deleteCashCollectionRecord(id) {
    const confirmed = await confirmAction('Delete this manual payment collection record? This will also remove related ledger entries and party statement data.');
    if (!confirmed) return;

    const result = await window.api.deleteCashCollection(id);
    if (result.success) {
        showToast('Record deleted successfully!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to delete', 'error');
    }
}

// ============================================================
// Render function for Profit/Loss (used by app.js navigation)
// ============================================================
async function renderFinancialReports() {
    const container = document.getElementById('page-financial-reports');
    document.getElementById('topActions').innerHTML = '';
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-light)"><span style="font-size:24px">⏳</span><p>Loading...</p></div>`;
    await showProfitLoss();
}

// Globals
window.renderFinancialReports = renderFinancialReports;
window.showProfitLoss = showProfitLoss;
window.applyProfitLoss = applyProfitLoss;
window.printProfitLoss = printProfitLoss;
window.showReceivablePayable = showReceivablePayable;
window.printReceivablePayable = printReceivablePayable;
window.showStockStatement = showStockStatement;
window.applyStockStatement = applyStockStatement;
window.printStockStatementReport = printStockStatementReport;
window.exportStockStatementPDF = exportStockStatementPDF;
window.showDaybookPage = showDaybookPage;
window.applyDaybookPage = applyDaybookPage;
window.printDaybookPage = printDaybookPage;
window.exportDaybookPagePDF = exportDaybookPagePDF;
window.showCashCollectionPage = showCashCollectionPage;
window.applyCashCollectionPage = applyCashCollectionPage;
window.printCashCollectionPage = printCashCollectionPage;
window.exportCashCollectionPagePDF = exportCashCollectionPagePDF;
window.showAddCashCollectionRecord = showAddCashCollectionRecord;
window.saveCashCollectionRecord = saveCashCollectionRecord;
window.updateCashCollectionPreview = updateCashCollectionPreview;
window.editCashCollectionRecord = editCashCollectionRecord;
window.deleteCashCollectionRecord = deleteCashCollectionRecord;
