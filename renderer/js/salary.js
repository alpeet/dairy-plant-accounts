/**
 * Salary / Payroll Register Module
 * =================================
 * Manages salary records with add/edit/delete, print & PDF.
 */

async function renderSalary(monthParam) {
    const container = document.getElementById('page-salary');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddSalary()">+ New Salary Record</button>
    `;

    const bsToday = today();
    const defaultMonth = monthParam !== undefined ? monthParam : bsToday.substring(0, 7);

    const result = await window.api.getSalaryList({ month: defaultMonth });
    const records = result.success ? result.data : [];

    const summary = await window.api.getSalarySummary({ month: defaultMonth });
    const s = summary.success ? summary.data : { count: 0, total: 0, total_basic: 0, total_allowance: 0, total_advance: 0, total_deduction: 0 };

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Employees ${defaultMonth ? '(' + defaultMonth + ')' : '(All Months)'}</span>
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
                <input type="month" class="form-control" id="salMonth" value="${defaultMonth}" placeholder="All Months">
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
                                <button class="btn btn-info btn-sm" onclick="editSalary(${r.id})" title="Edit">✏️</button>
                                <button class="btn btn-primary btn-sm" onclick="printSalarySlip(${r.id})" title="Print Salary Slip">📄</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteSalaryEntry(${r.id})" title="Delete">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${records.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No salary records for <strong>' + escapeHtml(defaultMonth) + '</strong>. <button class="btn btn-link btn-sm" onclick="renderSalary(\'\')" style="text-decoration:underline;cursor:pointer;color:var(--primary)">Show all records</button></td></tr>' : ''}
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
    renderSalary(month);
}

function showAddSalary(existingData) {
    const todayStr = today();
    const defaultMonth = todayStr.substring(0, 7);
    const d = existingData || { employee_name: '', position: '', month: defaultMonth, basic_salary: 0, allowance: 0, advance: 0, deduction: 0, payment_date: todayStr, payment_mode: 'cash', remarks: '' };

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
        renderSalary(data.month);
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
    if (result.success) {
        showToast('Deleted', 'success');
        const month = document.getElementById('salMonth')?.value || '';
        renderSalary(month);
    } else { showToast(result.error, 'error'); }
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

/**
 * Print an individual employee's salary slip.
 * Fetches the record and business settings, then generates a professional payslip.
 */
async function printSalarySlip(id) {
    if (!id) { showToast('Invalid salary record', 'error'); return; }

    const result = await window.api.getSalaryRecord(id);
    if (!result.success || !result.data) {
        showToast('Could not load salary record', 'error');
        return;
    }

    const r = result.data;
    const settings = await getSettingsCached();

    // Compute totals for clarity
    const earnings = (r.basic_salary || 0) + (r.allowance || 0);
    const deductions = (r.advance || 0) + (r.deduction || 0);
    const netSalary = r.net_salary || (earnings - deductions);

    // Get month name in Nepali style
    const monthDisplay = r.month ? formatDate(r.month + '-01') : r.month;

    // Generate a salary slip number
    const slipNo = 'SLIP-' + String(r.id).padStart(4, '0') + '-' + (r.month || '').replace('-', '');

    const html = `
        <div class="salary-slip-wrapper" style="max-width:700px;margin:0 auto;padding:20px 30px;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;">
            <!-- Business Header -->
            <div style="text-align:center;border-bottom:3px double #1a5276;padding-bottom:12px;margin-bottom:16px;">
                <h1 style="font-size:20pt;color:#1a5276;margin:0;letter-spacing:0.5px;">${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
                ${settings.business_address ? `<p style="font-size:9pt;color:#555;margin:4px 0 2px;">${escapeHtml(settings.business_address)}</p>` : ''}
                <div style="font-size:8pt;color:#888;">
                    ${settings.business_phone ? `📞 ${escapeHtml(settings.business_phone)}` : ''}
                    ${settings.business_phone && settings.business_email ? ' &nbsp;|&nbsp; ' : ''}
                    ${settings.business_email ? `✉️ ${escapeHtml(settings.business_email)}` : ''}
                    ${settings.business_pan ? ` &nbsp;|&nbsp; PAN: ${escapeHtml(settings.business_pan)}` : ''}
                </div>
            </div>

            <!-- Slip Title -->
            <div style="text-align:center;margin-bottom:14px;">
                <h2 style="font-size:14pt;color:#2c3e50;margin:0;text-transform:uppercase;letter-spacing:2px;">Salary Slip</h2>
                <p style="font-size:8pt;color:#999;margin:2px 0 0;">${escapeHtml(slipNo)}</p>
            </div>

            <!-- Employee Details -->
            <div style="background:#f0f4f8;border:1px solid #d0d8e0;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
                <table style="width:100%;border-collapse:collapse;font-size:9.5pt;">
                    <tr>
                        <td style="padding:4px 8px;color:#555;width:120px;">Employee Name</td>
                        <td style="padding:4px 8px;font-weight:700;color:#1a5276;">${escapeHtml(r.employee_name)}</td>
                        <td style="padding:4px 8px;color:#555;width:80px;">Month</td>
                        <td style="padding:4px 8px;font-weight:600;">${escapeHtml(monthDisplay)}</td>
                    </tr>
                    <tr>
                        <td style="padding:4px 8px;color:#555;">Position</td>
                        <td style="padding:4px 8px;">${escapeHtml(r.position || '-')}</td>
                        <td style="padding:4px 8px;color:#555;">Paid On</td>
                        <td style="padding:4px 8px;font-weight:600;">${r.payment_date ? formatDate(r.payment_date) : '-'}</td>
                    </tr>
                </table>
            </div>

            <!-- Earnings & Deductions Table -->
            <table style="width:100%;border-collapse:collapse;font-size:10pt;margin-bottom:14px;">
                <thead>
                    <tr>
                        <th style="background:#1a5276;color:white;padding:7px 12px;text-align:left;font-size:9pt;text-transform:uppercase;width:50%;">Earnings</th>
                        <th style="background:#1a5276;color:white;padding:7px 12px;text-align:right;font-size:9pt;text-transform:uppercase;width:25%;">Amount (रु)</th>
                        <th style="background:#1a5276;color:white;padding:7px 12px;text-align:left;font-size:9pt;text-transform:uppercase;width:25%;">Deductions</th>
                        <th style="background:#1a5276;color:white;padding:7px 12px;text-align:right;font-size:9pt;text-transform:uppercase;">Amount (रु)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;">Basic Salary</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;">${formatNumber(r.basic_salary || 0)}</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;">Advance</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;color:#c0392b;">${formatNumber(r.advance || 0)}</td>
                    </tr>
                    <tr>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;">Allowance</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;">${formatNumber(r.allowance || 0)}</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;">Deduction</td>
                        <td style="padding:6px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;color:#c0392b;">${formatNumber(r.deduction || 0)}</td>
                    </tr>
                    <tr style="background:#f0f4f8;font-weight:700;">
                        <td style="padding:7px 12px;border:1px solid #d0d8e0;color:#1a5276;">Total Earnings</td>
                        <td style="padding:7px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;color:#1a5276;">${formatNumber(earnings)}</td>
                        <td style="padding:7px 12px;border:1px solid #d0d8e0;color:#c0392b;">Total Deductions</td>
                        <td style="padding:7px 12px;border:1px solid #d0d8e0;text-align:right;font-family:'Consolas','Courier New',monospace;color:#c0392b;">${formatNumber(deductions)}</td>
                    </tr>
                </tbody>
            </table>

            <!-- Net Salary Highlight Box -->
            <div style="background:linear-gradient(135deg,#1a5276,#2c7fb8);color:white;border-radius:8px;padding:14px 20px;text-align:center;margin-bottom:16px;">
                <div style="font-size:9pt;text-transform:uppercase;letter-spacing:1px;opacity:0.9;">Net Salary Payable</div>
                <div style="font-size:24pt;font-weight:700;letter-spacing:1px;margin:4px 0;">रु ${netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                <div style="font-size:8pt;opacity:0.7;">${settings.currency_symbol || 'रु'} ${numberToWords(netSalary)}</div>
            </div>

            <!-- Payment Details -->
            <div style="display:flex;gap:20px;margin-bottom:16px;">
                <div style="flex:1;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;padding:10px 14px;">
                    <div style="font-size:8pt;text-transform:uppercase;color:#888;letter-spacing:0.5px;margin-bottom:4px;">Payment Mode</div>
                    <div style="font-size:11pt;font-weight:600;color:#333;">${r.payment_mode ? (r.payment_mode.charAt(0).toUpperCase() + r.payment_mode.slice(1)) : 'Cash'}</div>
                </div>
                <div style="flex:1;background:#fafafa;border:1px solid #e0e0e0;border-radius:6px;padding:10px 14px;">
                    <div style="font-size:8pt;text-transform:uppercase;color:#888;letter-spacing:0.5px;margin-bottom:4px;">Payment Date</div>
                    <div style="font-size:11pt;font-weight:600;color:#333;">${r.payment_date ? formatDate(r.payment_date) : '-'}</div>
                </div>
            </div>

            <!-- Remarks -->
            ${r.remarks ? `
            <div style="background:#fef9e7;border:1px solid #f9e79f;border-radius:6px;padding:10px 14px;margin-bottom:20px;">
                <div style="font-size:8pt;text-transform:uppercase;color:#b7950b;letter-spacing:0.5px;margin-bottom:2px;">Remarks</div>
                <div style="font-size:9.5pt;color:#7d6608;">${escapeHtml(r.remarks)}</div>
            </div>
            ` : ''}

            <!-- Signature -->
            <div style="display:flex;justify-content:space-between;margin-top:30px;padding-top:14px;border-top:1px solid #ccc;">
                <div style="text-align:center;min-width:160px;">
                    <div style="border-top:1px solid #333;padding-top:4px;font-size:9pt;color:#555;">Employee Signature</div>
                </div>
                <div style="text-align:center;min-width:160px;">
                    <div style="border-top:1px solid #333;padding-top:4px;font-size:9pt;color:#555;">Authorized Signature</div>
                </div>
            </div>

            <!-- Footer -->
            <div style="text-align:center;margin-top:24px;padding-top:8px;border-top:1px solid #eee;font-size:7.5pt;color:#999;">
                This is a computer-generated salary slip. Generated on: ${formatDate(today())}
            </div>
        </div>
    `;

    // Add extra print-specific CSS for the slip
    const slipCSS = `
        @page { margin: 12mm 10mm 15mm 10mm; size: A4; }
        body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #222; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
            .salary-slip-wrapper { max-width: none !important; padding: 0 !important; }
        }
    `;

    printHTML(`<style>${slipCSS}</style>${html}`);
}

/**
 * Convert a number to words (Indian numbering system - lakh/crore).
 * Simplified for salary slip display.
 */
function numberToWords(num) {
    if (!num || num === 0) return 'Zero';
    const amount = Math.abs(Math.round(num * 100) / 100);
    const whole = Math.floor(amount);
    
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
                  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertBelowThousand(n) {
        if (n === 0) return '';
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertBelowThousand(n % 100) : '');
    }
    
    function convertIndian(n) {
        if (n === 0) return '';
        if (n < 1000) return convertBelowThousand(n);
        const thousands = n % 100000;
        const lakhs = Math.floor(n / 100000);
        const thousandsOnly = thousands >= 1000 ? Math.floor((n % 100000) / 1000) : 0;
        const hundreds = n % 1000;
        
        let result = '';
        if (lakhs > 0) {
            result += convertBelowThousand(lakhs) + ' Lakh';
        }
        if (thousandsOnly > 0) {
            result += (result ? ' ' : '') + convertBelowThousand(thousandsOnly) + ' Thousand';
        }
        if (hundreds > 0) {
            result += (result ? ' ' : '') + convertBelowThousand(hundreds);
        }
        return result;
    }
    
    let words = convertIndian(whole) + ' Rupee';
    const paise = Math.round((amount - whole) * 100);
    if (paise > 0) {
        words += ' and ' + convertIndian(paise) + ' Paise';
    }
    words += ' Only';
    return words;
}

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
window.printSalarySlip = printSalarySlip;
