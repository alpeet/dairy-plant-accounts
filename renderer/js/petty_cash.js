/**
 * Petty Cash Register Module
 * ==========================
 * Manages petty cash entries with add/edit/delete, print & PDF.
 */

async function renderPettyCash() {
    const container = document.getElementById('page-petty-cash');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddPettyCash()">+ New Entry</button>
    `;

    const preset = getDatePreset('this_month');
    const result = await window.api.getPettyCashList({ from_date: preset.from, to_date: preset.to });
    const entries = result.success ? result.data : [];

    const summary = await window.api.getPettyCashSummary({ from_date: preset.from, to_date: preset.to });
    const s = summary.success ? summary.data : { count: 0, total: 0 };

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr">
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Total Entries (This Month)</span>
                <span class="value" style="font-size:22px">${s.count}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Petty Cash</span>
                <span class="value" style="font-size:22px">${formatCurrency(s.total)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Actions</span>
                <div style="margin-top:8px">
                    <button class="btn btn-info btn-sm" onclick="printPettyCash()">🖨 Print</button>
                    <button class="btn btn-primary btn-sm" onclick="exportPettyCashPDF()">📄 PDF</button>
                </div>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="pcFrom" value="${preset.from}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="pcTo" value="${preset.to}">
            </div>
            <div class="form-group">
                <label>Expense Head</label>
                <input type="text" class="form-control" id="pcSearch" placeholder="Filter by head...">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshPettyCash()">Search</button>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th><th>Voucher No</th><th>Expense Head</th>
                        <th>Description</th><th>Paid To</th><th>Approved By</th>
                        <th class="text-right">Amount</th><th>Mode</th><th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.voucher_no)}</td>
                            <td>${escapeHtml(e.expense_head)}</td>
                            <td>${escapeHtml(e.description || '')}</td>
                            <td>${escapeHtml(e.paid_to || '')}</td>
                            <td>${escapeHtml(e.approved_by || '')}</td>
                            <td class="text-right">${formatCurrency(e.amount)}</td>
                            <td>${statusBadge(e.payment_mode)}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editPettyCash(${e.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deletePettyCashEntry(${e.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${entries.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-light)">No petty cash entries</td></tr>' : ''}
                </tbody>
                ${entries.length > 0 ? `<tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(entries.reduce((s,e) => s + e.amount, 0))}</strong></td><td colspan="2"></td></tr></tfoot>` : ''}
            </table>
        </div>
    `;

    window._lastPettyCash = entries;
}

async function refreshPettyCash() {
    const from = document.getElementById('pcFrom')?.value || '';
    const to = document.getElementById('pcTo')?.value || '';
    const head = document.getElementById('pcSearch')?.value || '';
    const result = await window.api.getPettyCashList({ from_date: from, to_date: to, expense_head: head || undefined });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastPettyCash = result.data;
    renderPettyCash();
}

function showAddPettyCash(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || { date: today, voucher_no: 'PC-' + Date.now().toString().slice(-6), expense_head: '', description: '', amount: '', paid_to: '', approved_by: '', payment_mode: 'cash', remarks: '' };

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Petty Cash Entry</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" class="form-control" id="pcDate" value="${d.date}">
                </div>
                <div class="form-group">
                    <label>Voucher No</label>
                    <input type="text" class="form-control" id="pcVoucher" value="${escapeHtml(d.voucher_no)}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Expense Head *</label>
                    <input type="text" class="form-control" id="pcHead" value="${escapeHtml(d.expense_head)}" placeholder="e.g., Stationery, Tea, Travel">
                </div>
                <div class="form-group">
                    <label>Amount *</label>
                    <input type="number" class="form-control" id="pcAmount" value="${d.amount}" step="0.01" min="0.01">
                </div>
            </div>
            <div class="form-group">
                <label>Description</label>
                <input type="text" class="form-control" id="pcDesc" value="${escapeHtml(d.description || '')}" placeholder="What this expense is for">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Paid To</label>
                    <input type="text" class="form-control" id="pcPaidTo" value="${escapeHtml(d.paid_to || '')}">
                </div>
                <div class="form-group">
                    <label>Approved By</label>
                    <input type="text" class="form-control" id="pcApprovedBy" value="${escapeHtml(d.approved_by || '')}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Payment Mode</label>
                    <select class="form-control" id="pcMode">
                        <option value="cash" ${d.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                        <option value="bank" ${d.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                        <option value="upi" ${d.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Remarks</label>
                    <input type="text" class="form-control" id="pcRemarks" value="${escapeHtml(d.remarks || '')}">
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="savePettyCashEntry(${existingData ? existingData.id : 'null'})">Save</button>
        </div>
    `);
}

async function savePettyCashEntry(id) {
    const data = {
        id: id || undefined,
        date: document.getElementById('pcDate')?.value || '',
        voucher_no: document.getElementById('pcVoucher')?.value || '',
        expense_head: document.getElementById('pcHead')?.value || '',
        description: document.getElementById('pcDesc')?.value || '',
        amount: parseFloat(document.getElementById('pcAmount')?.value || 0),
        paid_to: document.getElementById('pcPaidTo')?.value || '',
        approved_by: document.getElementById('pcApprovedBy')?.value || '',
        payment_mode: document.getElementById('pcMode')?.value || 'cash',
        remarks: document.getElementById('pcRemarks')?.value || ''
    };

    if (!data.expense_head || !data.amount) { showToast('Expense head and amount are required', 'error'); return; }

    const result = await window.api.savePettyCash(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Petty cash updated' : 'Petty cash entry saved', 'success');
        renderPettyCash();
    } else {
        showToast(result.error, 'error');
    }
}

async function editPettyCash(id) {
    const result = await window.api.getPettyCash(id);
    if (result.success) showAddPettyCash(result.data);
}

async function deletePettyCashEntry(id) {
    const confirmed = await confirmAction('Delete this petty cash entry?');
    if (!confirmed) return;
    const result = await window.api.deletePettyCash(id);
    if (result.success) { showToast('Deleted', 'success'); renderPettyCash(); }
    else { showToast(result.error, 'error'); }
}

async function printPettyCash() {
    const data = window._lastPettyCash || [];
    const settings = await getSettingsCached();
    if (data.length === 0) { showToast('No data', 'warning'); return; }

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Petty Cash Register</h2><p>Period: ${document.getElementById('pcFrom')?.value || ''} to ${document.getElementById('pcTo')?.value || ''}</p></div>
        <table><thead><tr><th>Date</th><th>Voucher</th><th>Head</th><th>Description</th><th>Paid To</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${data.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.voucher_no)}</td><td>${escapeHtml(e.expense_head)}</td><td>${escapeHtml(e.description||'')}</td><td>${escapeHtml(e.paid_to||'')}</td><td class="text-right">${formatCurrency(e.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="5"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.amount, 0))}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportPettyCashPDF() { await printPettyCash(); }

// Globals
window.renderPettyCash = renderPettyCash;
window.refreshPettyCash = refreshPettyCash;
window.showAddPettyCash = showAddPettyCash;
window.savePettyCashEntry = savePettyCashEntry;
window.editPettyCash = editPettyCash;
window.deletePettyCashEntry = deletePettyCashEntry;
window.printPettyCash = printPettyCash;
window.exportPettyCashPDF = exportPettyCashPDF;
