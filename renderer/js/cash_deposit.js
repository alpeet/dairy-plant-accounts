/**
 * Cash Deposit Module
 * ===================
 * Track bank deposits made from cash on hand.
 * Create, view, delete cash deposit records.
 */

async function renderCashDeposit() {
    const container = document.getElementById('page-cash-deposit');
    document.getElementById('topActions').innerHTML = '';
    const preset = getDatePreset('this_month');

    const [listResult, summaryResult] = await Promise.all([
        window.api.getCashDeposits({ from_date: preset.from, to_date: preset.to }),
        window.api.getCashDepositSummary({ from_date: preset.from, to_date: preset.to })
    ]);

    const deposits = listResult.success ? listResult.data : [];
    const summary = summaryResult.success ? summaryResult.data : { total_deposited: 0, total_count: 0, by_bank: [], by_mode: [] };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">🏦 Cash Deposits</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printCashDeposit()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportCashDepositPDF()">📄 PDF</button>
                <button class="btn btn-success btn-sm" onclick="showAddCashDeposit()">+ New Deposit</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="cdFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="cdTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshCashDeposits()">Refresh</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('today');document.getElementById('cdFrom').value=p.from;document.getElementById('cdTo').value=p.to;refreshCashDeposits()">Today</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('this_month');document.getElementById('cdFrom').value=p.from;document.getElementById('cdTo').value=p.to;refreshCashDeposits()">This Month</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total Deposits</span><span class="value" style="font-size:20px">${summary.total_count}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Amount</span><span class="value" style="font-size:20px">${formatCurrency(summary.total_deposited)}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">By Bank</span>
                <span class="value" style="font-size:14px;line-height:1.6">
                    ${summary.by_bank.map(b => `${escapeHtml(b.bank_name)}: ${formatCurrency(b.total)}`).join('<br>') || 'N/A'}
                </span>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Deposit No</th>
                        <th>Bank</th>
                        <th>Account</th>
                        <th class="text-right">Amount</th>
                        <th>Source</th>
                        <th>Mode</th>
                        <th>Ref No</th>
                        <th>Deposited By</th>
                        <th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${deposits.map(d => `
                        <tr>
                            <td>${formatDate(d.date)}</td>
                            <td><strong>${escapeHtml(d.deposit_no)}</strong></td>
                            <td>${escapeHtml(d.bank_name || '-')}</td>
                            <td style="font-size:11px">${escapeHtml(d.account_no || '-')}</td>
                            <td class="text-right" style="font-weight:600;color:var(--accent)">${formatCurrency(d.amount)}</td>
                            <td><span class="badge badge-info">${escapeHtml(d.cash_source || '-')}</span></td>
                            <td>${escapeHtml(d.deposit_mode || '-')}</td>
                            <td style="font-size:11px">${escapeHtml(d.reference_no || '-')}</td>
                            <td>${escapeHtml(d.deposited_by || '-')}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editCashDeposit(${d.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteCashDeposit(${d.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${deposits.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No cash deposits found</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(deposits.reduce((s,d) => s + d.amount, 0))}</strong></td>
                        <td colspan="5"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
    window._lastCashDeposits = deposits;
}

async function refreshCashDeposits() {
    const from = document.getElementById('cdFrom')?.value || '';
    const to = document.getElementById('cdTo')?.value || '';
    const [listResult, summaryResult] = await Promise.all([
        window.api.getCashDeposits({ from_date: from, to_date: to }),
        window.api.getCashDepositSummary({ from_date: from, to_date: to })
    ]);
    if (listResult.success) {
        window._lastCashDeposits = listResult.data;
        renderCashDeposit();
    } else {
        showToast(listResult.error, 'error');
    }
}

async function showAddCashDeposit(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || { 
        date: today, bank_name: '', branch: '', account_no: '', 
        amount: 0, cash_source: 'mixed', deposit_mode: 'cash', 
        reference_no: '', remarks: '', deposited_by: '' 
    };

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Cash Deposit</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group"><label>Date</label><input type="date" class="form-control" id="cdDate" value="${d.date}"></div>
                <div class="form-group"><label>Deposited By</label><input type="text" class="form-control" id="cdDepositedBy" value="${escapeHtml(d.deposited_by)}" placeholder="Person name"></div>
            </div>
            <div class="form-section-title">Bank Details</div>
            <div class="form-row">
                <div class="form-group"><label>Bank Name *</label>
                    <select class="form-control" id="cdBankName">
                        <option value="">Select Bank</option>
                        ${['Nepal Bank Ltd', 'NMB Bank', 'Global IME Bank', 'Prabhu Bank', 'Siddhartha Bank', 'NIC Asia Bank', 'Kumari Bank', 'Everest Bank', 'Citizens Bank', 'Sanima Bank', 'Machhapuchhre Bank', 'Agriculture Dev Bank', 'Other'].map(b => 
                            `<option value="${b}" ${d.bank_name === b ? 'selected' : ''}>${b}</option>`
                        ).join('')}
                    </select>
                    <input type="text" class="form-control" id="cdBankNameOther" style="margin-top:4px;${d.bank_name && !['Nepal Bank Ltd','NMB Bank','Global IME Bank','Prabhu Bank','Siddhartha Bank','NIC Asia Bank','Kumari Bank','Everest Bank','Citizens Bank','Sanima Bank','Machhapuchhre Bank','Agriculture Dev Bank','Other'].includes(d.bank_name) ? '' : 'display:none'}" placeholder="Enter bank name" value="${escapeHtml(d.bank_name)}">
                </div>
                <div class="form-group"><label>Branch</label><input type="text" class="form-control" id="cdBranch" value="${escapeHtml(d.branch)}"></div>
                <div class="form-group"><label>Account No</label><input type="text" class="form-control" id="cdAccount" value="${escapeHtml(d.account_no)}"></div>
            </div>
            <div class="form-section-title">Deposit Details</div>
            <div class="form-row">
                <div class="form-group"><label>Amount *</label><input type="number" class="form-control" id="cdAmount" value="${d.amount || ''}" step="0.01" min="0" placeholder="0.00"></div>
                <div class="form-group"><label>Cash Source</label>
                    <select class="form-control" id="cdSource">
                        <option value="mixed" ${d.cash_source === 'mixed' ? 'selected' : ''}>Mixed</option>
                        <option value="sales" ${d.cash_source === 'sales' ? 'selected' : ''}>Sales Collection</option>
                        <option value="receipts" ${d.cash_source === 'receipts' ? 'selected' : ''}>Receipts</option>
                        <option value="other" ${d.cash_source === 'other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group"><label>Deposit Mode</label>
                    <select class="form-control" id="cdMode">
                        <option value="cash" ${d.deposit_mode === 'cash' ? 'selected' : ''}>Cash Deposit</option>
                        <option value="cheque" ${d.deposit_mode === 'cheque' ? 'selected' : ''}>Cheque</option>
                        <option value="transfer" ${d.deposit_mode === 'transfer' ? 'selected' : ''}>Transfer</option>
                        <option value="online" ${d.deposit_mode === 'online' ? 'selected' : ''}>Online</option>
                    </select>
                </div>
                <div class="form-group"><label>Reference No</label><input type="text" class="form-control" id="cdRefNo" value="${escapeHtml(d.reference_no)}" placeholder="Chq/Ref number"></div>
            </div>
            <div class="form-group"><label>Remarks</label><textarea class="form-control" id="cdRemarks" rows="2">${escapeHtml(d.remarks)}</textarea></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveCashDeposit(${existingData ? existingData.id : 'null'})">Save Deposit</button>
        </div>
    `);

    // Handle bank name dropdown toggle
    const bankSelect = document.getElementById('cdBankName');
    const bankOther = document.getElementById('cdBankNameOther');
    if (bankSelect && bankOther) {
        bankSelect.addEventListener('change', () => {
            bankOther.style.display = bankSelect.value === 'Other' ? '' : 'none';
        });
    }
}

async function saveCashDeposit(id) {
    const bankSelect = document.getElementById('cdBankName');
    let bankName = bankSelect?.value || '';
    if (bankName === 'Other') {
        bankName = document.getElementById('cdBankNameOther')?.value || '';
    }

    const data = {
        id: id || undefined,
        date: document.getElementById('cdDate')?.value || '',
        bank_name: bankName,
        branch: document.getElementById('cdBranch')?.value || '',
        account_no: document.getElementById('cdAccount')?.value || '',
        amount: parseFloat(document.getElementById('cdAmount')?.value || 0),
        cash_source: document.getElementById('cdSource')?.value || 'mixed',
        deposit_mode: document.getElementById('cdMode')?.value || 'cash',
        reference_no: document.getElementById('cdRefNo')?.value || '',
        remarks: document.getElementById('cdRemarks')?.value || '',
        deposited_by: document.getElementById('cdDepositedBy')?.value || ''
    };

    if (!data.date) { showToast('Date is required', 'error'); return; }
    if (!data.bank_name) { showToast('Bank name is required', 'error'); return; }
    if (data.amount <= 0) { showToast('Amount must be greater than 0', 'error'); return; }

    const result = await window.api.saveCashDeposit(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Deposit updated' : 'Deposit saved', 'success');
        renderCashDeposit();
    } else {
        showToast(result.error, 'error');
    }
}

async function editCashDeposit(id) {
    const result = await window.api.getCashDeposit(id);
    if (result.success) {
        showAddCashDeposit(result.data);
    } else {
        showToast(result.error, 'error');
    }
}

async function deleteCashDeposit(id) {
    const confirmed = await confirmAction('Delete this cash deposit record?');
    if (!confirmed) return;
    const result = await window.api.deleteCashDeposit(id);
    if (result.success) {
        showToast('Deposit deleted', 'success');
        renderCashDeposit();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Print / PDF
// ============================================================
async function printCashDeposit() {
    const deposits = window._lastCashDeposits;
    if (!deposits || deposits.length === 0) { showToast('No data to print', 'warning'); return; }
    const settings = await getSettingsCached();
    const from = document.getElementById('cdFrom')?.value || '';
    const to = document.getElementById('cdTo')?.value || '';

    const totalAmount = deposits.reduce((s, d) => s + d.amount, 0);
    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Cash Deposit Report</h2>
            <p>Period: ${from || 'Start'} to ${to || 'Today'} | Total Deposits: ${deposits.length} | Total Amount: ${formatCurrency(totalAmount)}</p>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Deposit No</th>
                    <th>Bank</th>
                    <th>Account</th>
                    <th class="text-right">Amount</th>
                    <th>Source</th>
                    <th>Mode</th>
                    <th>Deposited By</th>
                </tr>
            </thead>
            <tbody>
                ${deposits.map(d => `
                    <tr>
                        <td>${formatDate(d.date)}</td>
                        <td>${escapeHtml(d.deposit_no)}</td>
                        <td>${escapeHtml(d.bank_name || '-')}</td>
                        <td style="font-size:11px">${escapeHtml(d.account_no || '-')}</td>
                        <td class="text-right">${formatCurrency(d.amount)}</td>
                        <td>${escapeHtml(d.cash_source || '-')}</td>
                        <td>${escapeHtml(d.deposit_mode || '-')}</td>
                        <td>${escapeHtml(d.deposited_by || '-')}</td>
                    </tr>
                `).join('')}
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="4"><strong>Total</strong></td>
                    <td class="text-right"><strong>${formatCurrency(totalAmount)}</strong></td>
                    <td colspan="3"></td>
                </tr>
            </tfoot>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportCashDepositPDF() {
    const deposits = window._lastCashDeposits;
    if (!deposits || deposits.length === 0) { showToast('No data to export', 'warning'); return; }
    const settings = await getSettingsCached();
    const totalAmount = deposits.reduce((s, d) => s + d.amount, 0);
    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Cash Deposit Report</h2>
            <p>Total Deposits: ${deposits.length} | Total Amount: ${formatCurrency(totalAmount)}</p>
        </div>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    await window.api.printToPDF({ html });
}

// Globals
window.renderCashDeposit = renderCashDeposit;
window.refreshCashDeposits = refreshCashDeposits;
window.showAddCashDeposit = showAddCashDeposit;
window.saveCashDeposit = saveCashDeposit;
window.editCashDeposit = editCashDeposit;
window.deleteCashDeposit = deleteCashDeposit;
window.printCashDeposit = printCashDeposit;
window.exportCashDepositPDF = exportCashDepositPDF;
