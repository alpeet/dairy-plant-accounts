/**
 * Salary / Payroll Register Module
 * =================================
 * Manages salary records with add/edit/delete, print & PDF.
 */

async function renderSalary() {
    const container = document.getElementById('page-salary');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddSalary()">+ New Salary Record</button>
    `;

    const today = new Date();
    const defaultMonth = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');

    const result = await window.api.getSalaryList({ month: defaultMonth });
    const records = result.success ? result.data : [];

    const summary = await window.api.getSalarySummary({ month: defaultMonth });
    const s = summary.success ? summary.data : { count: 0, total: 0, total_basic: 0, total_allowance: 0, total_advance: 0, total_deduction: 0 };

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Employees (${defaultMonth})</span>
                <span class="value" style="font-size:22px">${s.count}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Basic</span>
                <span class="value" style="font-size:18px">${formatCurrency(s.total_basic)}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Total Allowance</span>
                <span class="value" style="font-size:18px">${formatCurrency(s.total_allowance)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Net Salary</span>
                <span class="value" style="font-size:18px">${formatCurrency(s.total)}</span>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>Month</label>
                <input type="month" class="form-control" id="salMonth" value="${defaultMonth}">
            </div>
            <div class="form-group">
                <label>Employee</label>
                <input type="text" class="form-control" id="salSearch" placeholder="Search employee...">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshSalary()">Search</button>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-info btn-sm" onclick="printSalary()">🖨 Print</button>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="exportSalaryPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Employee</th><th>Position</th><th>Month</th>
                        <th class="text-right">Basic</th><th class="text-right">Allowance</th>
                        <th class="text-right">Advance</th><th class="text-right">Deduction</th>
                        <th class="text-right">Net Salary</th><th>Paid On</th><th>Mode</th>
                        <th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.employee_name)}</strong></td>
                            <td>${escapeHtml(r.position || '')}</td>
                            <td>${r.month}</td>
                            <td class="text-right">${formatCurrency(r.basic_salary)}</td>
                            <td class="text-right">${formatCurrency(r.allowance)}</td>
                            <td class="text-right" style="color:var(--danger)">${formatCurrency(r.advance)}</td>
                            <td class="text-right" style="color:var(--danger)">${formatCurrency(r.deduction)}</td>
                            <td class="text-right"><strong>${formatCurrency(r.net_salary)}</strong></td>
                            <td>${r.payment_date ? formatDate(r.payment_date) : '-'}</td>
                            <td>${statusBadge(r.payment_mode)}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editSalary(${r.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteSalaryEntry(${r.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${records.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No salary records for this month</td></tr>' : ''}
                </tbody>
                ${records.length > 0 ? `
                <tfoot>
                    <tr>
                        <td colspan="3"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(records.reduce((s,r) => s + r.basic_salary, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(records.reduce((s,r) => s + r.allowance, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(records.reduce((s,r) => s + r.advance, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(records.reduce((s,r) => s + r.deduction, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(records.reduce((s,r) => s + r.net_salary, 0))}</strong></td>
                        <td colspan="3"></td>
                    </tr>
                </tfoot>` : ''}
            </table>
        </div>
    `;

    window._lastSalary = records;
}

async function refreshSalary() {
    const month = document.getElementById('salMonth')?.value || '';
    const search = document.getElementById('salSearch')?.value || '';
    const result = await window.api.getSalaryList({ month, employee_name: search || undefined });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastSalary = result.data;
    renderSalary();
}

function showAddSalary(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const defaultMonth = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
    const d = existingData || { employee_name: '', position: '', month: defaultMonth, basic_salary: 0, allowance: 0, advance: 0, deduction: 0, payment_date: today, payment_mode: 'cash', remarks: '' };

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Salary Record</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group">
                    <label>Employee Name *</label>
                    <input type="text" class="form-control" id="salEmpName" value="${escapeHtml(d.employee_name)}">
                </div>
                <div class="form-group">
                    <label>Position</label>
                    <input type="text" class="form-control" id="salPosition" value="${escapeHtml(d.position || '')}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Month *</label>
                    <input type="month" class="form-control" id="salMonthVal" value="${d.month}">
                </div>
                <div class="form-group">
                    <label>Payment Date</label>
                    <input type="date" class="form-control" id="salPayDate" value="${d.payment_date || ''}">
                </div>
            </div>
            <div class="form-row-4">
                <div class="form-group">
                    <label>Basic Salary</label>
                    <input type="number" class="form-control" id="salBasic" value="${d.basic_salary}" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label>Allowance</label>
                    <input type="number" class="form-control" id="salAllowance" value="${d.allowance}" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label>Advance</label>
                    <input type="number" class="form-control" id="salAdvance" value="${d.advance}" step="0.01" min="0">
                </div>
                <div class="form-group">
                    <label>Deduction</label>
                    <input type="number" class="form-control" id="salDeduction" value="${d.deduction}" step="0.01" min="0">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Net Salary (auto-calculated)</label>
                    <input type="text" class="form-control" id="salNet" readonly style="font-weight:700;font-size:18px;color:var(--primary)">
                </div>
                <div class="form-group">
                    <label>Payment Mode</label>
                    <select class="form-control" id="salMode">
                        <option value="cash" ${d.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                        <option value="bank" ${d.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                        <option value="upi" ${d.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <textarea class="form-control" id="salRemarks" rows="2">${escapeHtml(d.remarks || '')}</textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveSalaryEntry(${existingData ? existingData.id : 'null'})">Save</button>
        </div>
    `);

    // Auto-calculate net
    document.querySelectorAll('#salBasic, #salAllowance, #salAdvance, #salDeduction').forEach(el => {
        el.addEventListener('input', updateSalaryNet);
    });
    updateSalaryNet();
}

function updateSalaryNet() {
    const basic = parseFloat(document.getElementById('salBasic')?.value || 0);
    const allowance = parseFloat(document.getElementById('salAllowance')?.value || 0);
    const advance = parseFloat(document.getElementById('salAdvance')?.value || 0);
    const deduction = parseFloat(document.getElementById('salDeduction')?.value || 0);
    const net = basic + allowance - advance - deduction;
    const el = document.getElementById('salNet');
    if (el) el.value = '₹ ' + net.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

async function saveSalaryEntry(id) {
    const basic = parseFloat(document.getElementById('salBasic')?.value || 0);
    const allowance = parseFloat(document.getElementById('salAllowance')?.value || 0);
    const advance = parseFloat(document.getElementById('salAdvance')?.value || 0);
    const deduction = parseFloat(document.getElementById('salDeduction')?.value || 0);

    const data = {
        id: id || undefined,
        employee_name: document.getElementById('salEmpName')?.value || '',
        position: document.getElementById('salPosition')?.value || '',
        month: document.getElementById('salMonthVal')?.value || '',
        basic_salary: basic,
        allowance,
        advance,
        deduction,
        payment_date: document.getElementById('salPayDate')?.value || null,
        payment_mode: document.getElementById('salMode')?.value || 'cash',
        remarks: document.getElementById('salRemarks')?.value || ''
    };

    if (!data.employee_name || !data.month) { showToast('Employee name and month are required', 'error'); return; }

    const result = await window.api.saveSalaryRecord(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Salary updated' : 'Salary record saved', 'success');
        renderSalary();
    } else {
        showToast(result.error, 'error');
    }
}

async function editSalary(id) {
    const result = await window.api.getSalaryRecord(id);
    if (result.success) showAddSalary(result.data);
}

async function deleteSalaryEntry(id) {
    const confirmed = await confirmAction('Delete this salary record?');
    if (!confirmed) return;
    const result = await window.api.deleteSalaryRecord(id);
    if (result.success) { showToast('Deleted', 'success'); renderSalary(); }
    else { showToast(result.error, 'error'); }
}

async function printSalary() {
    const data = window._lastSalary || [];
    if (data.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Salary / Payroll Register</h2><p>Month: ${document.getElementById('salMonth')?.value || ''}</p></div>
        <table class="compact"><thead><tr><th>Employee</th><th>Position</th><th class="text-right">Basic</th><th class="text-right">Allowance</th><th class="text-right">Advance</th><th class="text-right">Deduction</th><th class="text-right">Net</th><th>Paid On</th></tr></thead>
        <tbody>${data.map(r => `<tr><td>${escapeHtml(r.employee_name)}</td><td>${escapeHtml(r.position||'')}</td><td class="text-right">${formatCurrency(r.basic_salary)}</td><td class="text-right">${formatCurrency(r.allowance)}</td><td class="text-right">${formatCurrency(r.advance)}</td><td class="text-right">${formatCurrency(r.deduction)}</td><td class="text-right"><strong>${formatCurrency(r.net_salary)}</strong></td><td>${r.payment_date ? formatDate(r.payment_date) : '-'}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.basic_salary, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.allowance, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.advance, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.deduction, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.net_salary, 0))}</strong></td><td></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportSalaryPDF() { /* same HTML */ await printSalary(); }

// Globals
window.renderSalary = renderSalary;
window.refreshSalary = refreshSalary;
window.showAddSalary = showAddSalary;
window.updateSalaryNet = updateSalaryNet;
window.saveSalaryEntry = saveSalaryEntry;
window.editSalary = editSalary;
window.deleteSalaryEntry = deleteSalaryEntry;
window.printSalary = printSalary;
window.exportSalaryPDF = exportSalaryPDF;
