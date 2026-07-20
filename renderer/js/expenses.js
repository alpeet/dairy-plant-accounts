/**
 * Other Expenses Register Module
 * ===============================
 * Manages all other business expenses with add/edit/delete, print & PDF.
 */

async function renderExpenses() {
    const container = document.getElementById('page-expenses');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddExpense()">+ New Expense</button>
    `;

    const preset = getDatePreset('this_month');
    const [listResult, catResult, summaryResult] = await Promise.all([
        window.api.getOtherExpenses({ from_date: preset.from, to_date: preset.to }),
        window.api.getExpenseCategories(),
        window.api.getExpensesSummary({ from_date: preset.from, to_date: preset.to })
    ]);

    const expenses = listResult.success ? listResult.data : [];
    const categories = catResult.success ? catResult.data : [];
    const summary = summaryResult.success ? summaryResult.data : { count: 0, total: 0, by_category: [] };

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Expenses</span>
                <span class="value" style="font-size:22px">${formatCurrency(summary.total)}</span>
                <span class="sub">${summary.count} entries</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Categories</span>
                <span class="value" style="font-size:22px">${categories.length}</span>
                <span class="sub">${categories.map(c => c.category).join(', ')}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Top Category</span>
                <span class="value" style="font-size:18px">${summary.by_category.length > 0 ? escapeHtml(summary.by_category[0].category) : 'N/A'}</span>
                <span class="sub">${summary.by_category.length > 0 ? formatCurrency(summary.by_category[0].total) : ''}</span>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Actions</span>
                <div style="margin-top:6px">
                    <button class="btn btn-info btn-sm" onclick="printExpenses()">🖨 Print</button>
                    <button class="btn btn-primary btn-sm" onclick="exportExpensesPDF()">📄 PDF</button>
                </div>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="exFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="exTo" value="${preset.to}"></div>
            <div class="form-group"><label>Category</label>
                <select class="form-control" id="exCategory">
                    <option value="">All</option>
                    ${categories.map(c => `<option value="${escapeHtml(c.category)}">${escapeHtml(c.category)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshExpenses()">Search</button></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Category</th><th>Expense Head</th><th>Description</th><th>Paid To</th><th class="text-right">Amount</th><th>Mode</th><th>Ref No</th><th class="actions">Actions</th></tr></thead>
                <tbody>
                    ${expenses.map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td><span class="badge badge-info">${escapeHtml(e.category)}</span></td>
                            <td><strong>${escapeHtml(e.expense_head)}</strong></td>
                            <td>${escapeHtml(e.description || '')}</td>
                            <td>${escapeHtml(e.paid_to || '')}</td>
                            <td class="text-right">${formatCurrency(e.amount)}</td>
                            <td>${statusBadge(e.payment_mode)}</td>
                            <td>${escapeHtml(e.reference_no || '')}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editExpense(${e.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteExpense(${e.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${expenses.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-light)">No expenses found</td></tr>' : ''}
                </tbody>
                ${expenses.length > 0 ? `<tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.amount, 0))}</strong></td><td colspan="3"></td></tr></tfoot>` : ''}
            </table>
        </div>
        ${summary.by_category.length > 0 ? `
        <div style="margin-top:16px">
            <h3 style="font-size:14px;margin:12px 0">📊 Expenses by Category</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:8px">
                ${summary.by_category.map(c => `
                    <div style="padding:10px 14px;background:var(--bg-white);border-radius:6px;border:1px solid var(--border);display:flex;justify-content:space-between">
                        <span><strong>${escapeHtml(c.category)}</strong> (${c.count})</span>
                        <span style="font-weight:600">${formatCurrency(c.total)}</span>
                    </div>
                `).join('')}
            </div>
        </div>` : ''}
    `;

    window._lastExpenses = expenses;
}

async function refreshExpenses() {
    const from = document.getElementById('exFrom')?.value || '';
    const to = document.getElementById('exTo')?.value || '';
    const category = document.getElementById('exCategory')?.value || '';
    const result = await window.api.getOtherExpenses({ from_date: from, to_date: to, category: category || undefined });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastExpenses = result.data;
    renderExpenses();
}

function showAddExpense(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || { date: today, category: '', expense_head: '', description: '', amount: '', paid_to: '', payment_mode: 'cash', reference_no: '', remarks: '' };

    showModal(`
        <div class="modal-header"><h2>${existingData ? 'Edit' : 'New'} Expense Entry</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group"><label>Date</label><input type="date" class="form-control" id="exDate" value="${d.date}"></div>
                <div class="form-group"><label>Category *</label><input type="text" class="form-control" id="exCategoryVal" value="${escapeHtml(d.category)}" placeholder="e.g., Office, Utility, Travel"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Expense Head *</label><input type="text" class="form-control" id="exHead" value="${escapeHtml(d.expense_head)}" placeholder="e.g., Electricity, Rent, Insurance"></div>
                <div class="form-group"><label>Amount *</label><input type="number" class="form-control" id="exAmount" value="${d.amount}" step="0.01" min="0.01"></div>
            </div>
            <div class="form-group"><label>Description</label><input type="text" class="form-control" id="exDesc" value="${escapeHtml(d.description || '')}"></div>
            <div class="form-row">
                <div class="form-group"><label>Paid To</label><input type="text" class="form-control" id="exPaidTo" value="${escapeHtml(d.paid_to || '')}"></div>
                <div class="form-group"><label>Payment Mode</label>
                    <select class="form-control" id="exMode">
                        <option value="cash" ${d.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                        <option value="bank" ${d.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                        <option value="upi" ${d.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                        <option value="cheque" ${d.payment_mode === 'cheque' ? 'selected' : ''}>Cheque</option>
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Reference No</label><input type="text" class="form-control" id="exRef" value="${escapeHtml(d.reference_no || '')}"></div>
                <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="exRemarks" value="${escapeHtml(d.remarks || '')}"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveExpenseEntry(${existingData ? existingData.id : 'null'})">Save</button>
        </div>
    `);
}

async function saveExpenseEntry(id) {
    const data = {
        id: id || undefined,
        date: document.getElementById('exDate')?.value || '',
        category: document.getElementById('exCategoryVal')?.value || '',
        expense_head: document.getElementById('exHead')?.value || '',
        description: document.getElementById('exDesc')?.value || '',
        amount: parseFloat(document.getElementById('exAmount')?.value || 0),
        paid_to: document.getElementById('exPaidTo')?.value || '',
        payment_mode: document.getElementById('exMode')?.value || 'cash',
        reference_no: document.getElementById('exRef')?.value || '',
        remarks: document.getElementById('exRemarks')?.value || ''
    };

    if (!data.category || !data.expense_head || !data.amount) { showToast('Category, head, and amount are required', 'error'); return; }

    const result = await window.api.saveOtherExpense(data);
    if (result.success) { closeModal(); showToast(id ? 'Updated' : 'Saved', 'success'); renderExpenses(); }
    else { showToast(result.error, 'error'); }
}

async function editExpense(id) {
    const result = await window.api.getOtherExpense(id);
    if (result.success) showAddExpense(result.data);
}

async function deleteExpenseEntry(id) {
    if (!await confirmAction('Delete this expense?')) return;
    const result = await window.api.deleteOtherExpense(id);
    if (result.success) { showToast('Deleted', 'success'); renderExpenses(); }
    else { showToast(result.error, 'error'); }
}

async function printExpenses() {
    const data = window._lastExpenses || [];
    if (data.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Expenses Register</h2></div>
        <table class="compact"><thead><tr><th>Date</th><th>Category</th><th>Head</th><th>Description</th><th>Paid To</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${data.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.expense_head)}</td><td>${escapeHtml(e.description||'')}</td><td>${escapeHtml(e.paid_to||'')}</td><td class="text-right">${formatCurrency(e.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.amount, 0))}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportExpensesPDF() { await printExpenses(); }

// Globals
window.renderExpenses = renderExpenses;
window.refreshExpenses = refreshExpenses;
window.showAddExpense = showAddExpense;
window.saveExpenseEntry = saveExpenseEntry;
window.editExpense = editExpense;
window.deleteExpenseEntry = deleteExpenseEntry;
window.printExpenses = printExpenses;
window.exportExpensesPDF = exportExpensesPDF;
