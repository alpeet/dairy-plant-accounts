/**
 * Cash Deposit Module
 * ===================
 * Track bank deposits made from cash on hand.
 * Create, view, delete cash deposit records.
 */

async function renderCashDeposit() {
    const container = document.getElementById('page-cash-deposit');
    document.getElementById('topActions').innerHTML = '';
    const filt = pageFilterInit('cash_deposit');

    const [listResult, summaryResult] = await Promise.all([
        window.api.getCashDeposits({ from_date: filt.from, to_date: filt.to }),
        window.api.getCashDepositSummary({ from_date: filt.from, to_date: filt.to })
    ]);

    const deposits = listResult.success ? listResult.data : [];
    const summary = summaryResult.success ? summaryResult.data
        : { total_deposited: 0, total_count: 0, by_bank: [], by_mode: [], bank_transfers: { rows: [], count: 0, total_in: 0, total_out: 0 }, reconciliation: null };
    const recon = summary.reconciliation || null;
    const bt = summary.bank_transfers || { rows: [], count: 0, total_in: 0, total_out: 0 };
    window._lastBankTransferRows = bt.rows;
    const depositPrelude = `
        <!-- Cash reconciliation — Expected vs Actual (authoritative accounting ledger) -->
        ${recon ? `
        <div class="table-container" style="margin-bottom:16px">
            <h3 style="margin:0 0 4px">💵 Cash Reconciliation</h3>
            <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">Expected = Opening + Cash Receipts − Cash Payments − Cash Deposited · Actual = latest denomination count${recon.actual_count_date ? ` (${formatDate(recon.actual_count_date)})` : ''}</div>
            <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:12px">
                <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Cash Sales Received</span><span class="value" style="font-size:18px">${formatCurrency(recon.cash_sales)}</span></div>
                <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Cash Receipts</span><span class="value" style="font-size:18px">${formatCurrency(recon.cash_receipts)}</span></div>
                <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Payments & Cash Expenses</span><span class="value" style="font-size:18px">${formatCurrency((recon.cash_payments || 0) + (recon.cash_expenses || 0) + (recon.petty_cash || 0))}</span></div>
                <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Cash Deposited to Bank</span><span class="value" style="font-size:18px">${formatCurrency(recon.cash_deposited)}</span></div>
            </div>
            <table>
                <tbody>
                    <tr><td>Opening Cash</td><td class="text-right">${formatCurrency(recon.opening_cash || 0)}</td></tr>
                    <tr><td><strong>Expected Closing Cash</strong></td><td class="text-right"><strong>${formatCurrency(recon.expected_closing)}</strong></td></tr>
                    <tr><td>Actual Cash Balance${recon.actual_count_date ? ` (counted ${formatDate(recon.actual_count_date)})` : ''}</td><td class="text-right">${recon.actual_cash === null || recon.actual_cash === undefined ? '<span style="color:var(--text-light)">No count recorded</span>' : formatCurrency(recon.actual_cash)}</td></tr>
                    <tr><td><strong>Difference</strong></td><td class="text-right"><strong>${recon.difference === null || recon.difference === undefined ? '—' : (Math.abs(recon.difference) < 0.01 ? '<span style="color:var(--success)">✅ Balanced</span>' : `<span style="color:var(--danger)">⚠ ${formatCurrency(recon.difference)}</span>`)}</strong></td></tr>
                </tbody>
            </table>
        </div>` : ''}

        <!-- Bank-statement deposits with no register record (counted once, never as income) -->
        ${bt.rows.length ? `
        <div class="table-container" style="margin-bottom:16px">
            <h3 style="margin:0 0 4px">🏦 Bank Statement Deposits — not in register (${bt.count})</h3>
            <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">Classified as cash→bank transfers from the bank statement and already counted exactly once as an internal transfer — never as new sales or income. Copy one to the register if you also track it there.</div>
            <table>
                <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Bank Account</th><th class="text-right">Amount</th><th class="actions">Actions</th></tr></thead>
                <tbody>
                    ${bt.rows.map((r, i) => `
                        <tr>
                            <td>${formatDate(r.date)}</td>
                            <td style="font-size:11px">${escapeHtml(r.reference_no || '-')}</td>
                            <td>${escapeHtml(r.description || r.counterparty_name || '-')}</td>
                            <td style="font-size:11px">${escapeHtml(r.bank_account || '-')}</td>
                            <td class="text-right" style="font-weight:600">${formatCurrency(Number(r.credit) || Number(r.debit) || 0)}</td>
                            <td class="actions"><button class="btn btn-primary btn-sm" onclick="copyBankDepositToRegister(${i})" title="Copy this statement deposit into the Cash Deposit register">➕ To Register</button></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>` : ''}
`;
    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">🏦 Cash Deposits</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printCashDeposit()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportCashDepositPDF()">📄 PDF</button>
            </div>
        </div>

        <!-- Prominent Action Card: New Deposit -->
        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;border:2px dashed #64b5f6;transition:all 0.2s"
             onclick="showAddCashDeposit()"
             onmouseover="this.style.background='linear-gradient(135deg,#bbdefb,#90caf9)';this.style.borderColor='#2196f3';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.background='linear-gradient(135deg,#e3f2fd,#bbdefb)';this.style.borderColor='#64b5f6';this.style.transform='none'">
            <div>
                <div style="display:flex;align-items:center;gap:12px">
                    <span style="font-size:28px">🏦</span>
                    <div>
                        <div style="font-size:16px;font-weight:700;color:#1565c0">➕ Record New Bank Deposit</div>
                        <div style="font-size:13px;color:#1976d2;margin-top:2px">Deposit cash on hand to the bank — track by bank, account, and deposit mode</div>
                    </div>
                </div>
            </div>
            <div style="text-align:right">
                <div style="font-size:14px;font-weight:600;color:#1565c0">
                    ${summary.total_count > 0 ? `This period: ${formatCurrency(summary.total_deposited)}` : 'No deposits yet'}
                </div>
                <div style="font-size:12px;color:#1976d2">Click to add →</div>
            </div>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            <span style="font-size:12px;color:var(--text-light);font-weight:600">Quick range:</span>
            ${datePresetBar('cdFrom', 'cdTo', 'refreshCashDeposits', ['today', 'yesterday', 'last_7', 'last_30', 'last_90', 'this_month', 'last_month', 'this_year', 'all'])}
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="cdFrom" value="${filt.from || ''}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="cdTo" value="${filt.to || ''}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshCashDeposits()">Refresh</button></div>
        </div>
        ${depositPrelude}
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
                            <td style="font-size:11px">${escapeHtml(d.reference_no || '-')}${d.bank_txn_id ? ` <span title="Linked to bank statement transaction #${d.bank_txn_id}">🔗</span>` : ''}</td>
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
    // Persist the filter, then re-render from it — the stored range survives
    // the re-render (old code re-queried this_month and lost the user's range).
    pageFilterSet('cash_deposit', {
        from: document.getElementById('cdFrom')?.value || '',
        to: document.getElementById('cdTo')?.value || ''
    });
    await renderCashDeposit();
}async function showAddCashDeposit(existingData) {
    const todayStr = today();
    const d = existingData || { 
        date: todayStr, bank_name: '', branch: '', account_no: '', 
        amount: 0, cash_source: 'mixed', deposit_mode: 'cash', 
        reference_no: '', remarks: '', deposited_by: '' 
    };
    // Persistent statement link: carried from the bank row ("➕ To Register")
    // or from the row being edited; null for a brand-new manual deposit.
    _depositBankTxnId = (existingData && existingData.bank_txn_id) || null;

    showModal(`
        <div class="modal-header">
            <h2>${existingData && existingData.id ? 'Edit' : 'New'} Cash Deposit</h2>
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
            <button class="btn btn-primary" onclick="saveCashDeposit(${existingData && existingData.id ? existingData.id : 'null'})">Save Deposit</button>
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

let _depositSaving = false;
let _depositBankTxnId = null;
/**
 * Prefill a new register record from a bank-statement deposit row.
 */
function copyBankDepositToRegister(idx) {
    const r = (window._lastBankTransferRows || [])[idx];
    if (!r) return;
    showAddCashDeposit({
        date: r.date || today(),
        bank_name: '', branch: '', account_no: r.bank_account || '',
        amount: Number(r.credit) || Number(r.debit) || 0,
        cash_source: 'mixed', deposit_mode: 'cash',
        reference_no: r.reference_no || '',
        remarks: `From bank statement: ${r.description || r.counterparty_name || ''}`.trim(),
        deposited_by: '',
        bank_txn_id: r.id || null
    });
}

async function saveCashDeposit(id) {
    if (_depositSaving) return; // double-submit guard: second click is a no-op
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
        deposited_by: document.getElementById('cdDepositedBy')?.value || '',
        bank_txn_id: _depositBankTxnId
    };

    if (!data.date) { showToast('Date is required', 'error'); return; }
    if (!data.bank_name) { showToast('Bank name is required', 'error'); return; }
    if (data.amount <= 0) { showToast('Amount must be greater than 0', 'error'); return; }

    _depositSaving = true;
    try {
        const result = await window.api.saveCashDeposit(data);
        if (result.success) {
            closeModal();
            showToast(id ? 'Deposit updated' : 'Deposit saved', 'success');
            renderCashDeposit();
        } else {
            showToast(result.error, 'error');
        }
    } finally {
        _depositSaving = false;
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
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
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
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
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
