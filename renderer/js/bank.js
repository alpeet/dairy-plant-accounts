/**
 * Bank Transactions Module — multi-bank accounts
 * ==============================================
 * A standalone bank register. These records never post to cash, expenses,
 * payments, collections, party ledgers or stock, and no other module creates a
 * bank row.
 *
 * Every transaction belongs to ONE bank account. Selecting one account shows
 * that account's own opening balance and running balance; "All Bank Accounts"
 * shows every row with its bank, and reports each account's balance separately
 * (balances are never added into one misleading figure).
 */

const BANK_CATEGORY_LABELS = {
    deposit: 'Deposit', withdrawal: 'Withdrawal', bank_charge: 'Bank Charge',
    interest: 'Interest', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', other: 'Other'
};

function bankTxnBadge(r) {
    const key = r.txn_category || 'other';
    const cls = key === 'deposit' || key === 'transfer_in' || key === 'interest' ? 'badge-success'
        : key === 'bank_charge' ? 'badge-warning' : key === 'transfer_out' || key === 'withdrawal' ? 'badge-danger' : 'badge-secondary';
    return `<span class="badge ${cls}">${escapeHtml(BANK_CATEGORY_LABELS[key] || 'Other')}</span>`;
}

function bankReconBadge(r) {
    if (r.recon_status === 'reconciled') return '<span class="badge badge-success" title="Reconciled">✓ Reconciled</span>';
    if (r.recon_status === 'disputed') return '<span class="badge badge-danger" title="Disputed">! Disputed</span>';
    return '<span class="badge badge-secondary">Unreconciled</span>';
}

function bankAccountLabel(a) {
    return `${a.bank_name || 'Bank'}${a.account_number ? ' — ' + a.account_number : ''}${a.status === 'Inactive' ? ' (inactive)' : ''}`;
}

async function bankAccountsList(includeInactive) {
    const res = await window.api.getBankAccounts({ include_inactive: !!includeInactive });
    return res && res.success ? (res.data || []) : [];
}

async function renderBank() {
    const container = document.getElementById('page-bank');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddBank()">+ New Transaction</button>
        <button class="btn btn-info btn-sm" onclick="showBankTransfer()">⇄ Transfer</button>
        <button class="btn btn-secondary btn-sm" onclick="showBankAccounts()">🏦 Bank Accounts</button>
        <button class="btn btn-secondary btn-sm" onclick="exportBankExcel()">⬇ Excel</button>
        <button class="btn btn-secondary btn-sm" onclick="exportBankPDF()">📄 PDF</button>
    `;

    const filt = pageFilterInit('bank', { preset: 'all' });
    const accountId = filt.account_id || '';
    const accounts = await bankAccountsList(true);
    const result = await window.api.getBankStatement({
        account_id: accountId || undefined,
        from_date: filt.from || undefined,
        to_date: filt.to || undefined,
        txn_category: filt.category || undefined,
        search: filt.search || undefined
    });
    const st = (result && result.success !== false && result.entries) ? result : {
        mode: accountId ? 'account' : 'all', entries: [], total_debit: 0, total_credit: 0,
        accounts: [], opening_balance: 0, closing_balance: 0, closing_by_account: []
    };
    window._bankState = { filters: { ...filt, account_id: accountId }, accounts, statement: st };

    const reviewCount = Number(filt.status === 'review' ? 0 : 0);
    const perAccountCards = (st.closing_by_account || []).map(a => `
        <div class="summary-card card-info" style="margin:0;padding:10px">
            <span class="label" style="font-size:11px">${escapeHtml(a.label)}</span>
            <span class="value" style="font-size:17px">${formatCurrency(a.closing_balance)}</span>
        </div>`).join('');

    const identity = st.mode === 'account' && st.account ? `
        <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;margin:0 0 10px 2px">
            <strong style="font-size:15px">🏦 ${escapeHtml(st.account.bank_name)}</strong>
            <span style="font-size:12px;color:var(--text-light)">A/c ${escapeHtml(st.account.account_number || '—')}</span>
            <span style="font-size:12px;color:var(--text-light)">${escapeHtml(st.account.branch_name || '')}</span>
            <span style="font-size:12px;color:var(--text-light)">${escapeHtml(st.account.account_type || '')}</span>
            <span class="badge ${st.account.status === 'Active' ? 'badge-success' : 'badge-secondary'}">${escapeHtml(st.account.status || '')}</span>
        </div>` : '';

    container.innerHTML = `
        ${identity}
        <div class="filter-bar" style="align-items:flex-end">
            <div class="form-group" style="min-width:260px">
                <label>Bank Account</label>
                <select class="form-control" id="bkAccountSel" onchange="refreshBank()">
                    <option value="">All Bank Accounts</option>
                    ${accounts.map(a => `<option value="${a.id}"${String(accountId) === String(a.id) ? ' selected' : ''}>${escapeHtml(bankAccountLabel(a))}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="bkFrom" value="${filt.from || ''}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="bkTo" value="${filt.to || ''}"></div>
            <div class="form-group"><label>Transaction Type</label>
                <select class="form-control" id="bkCategory">
                    <option value="">All types</option>
                    ${Object.entries(BANK_CATEGORY_LABELS).map(([v, l]) => `<option value="${v}"${filt.category === v ? ' selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Search</label>
                <input type="text" class="form-control" id="bkSearch" placeholder="Reference / particulars..." value="${escapeHtml(filt.search || '')}">
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshBank()">Search</button></div>
            ${reportLangPicker('Language / भाषा')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
            <span style="font-size:12px;color:var(--text-light);font-weight:600">Quick range:</span>
            ${datePresetBar('bkFrom', 'bkTo', 'refreshBank', ['today', 'last_7', 'last_30', 'this_month', 'last_month', 'this_year', 'all'])}
        </div>

        ${st.mode === 'account' ? `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr)">
            <div class="summary-card" style="margin:0;padding:12px">
                <span class="label">Opening Balance</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.opening_balance || 0)}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Deposits / Credits</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.total_credit || 0)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Withdrawals / Debits</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.total_debit || 0)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Closing Balance</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.closing_balance || 0)}</span>
            </div>
        </div>` : `
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr)">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Deposits / Credits (all banks)</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.total_credit || 0)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Withdrawals / Debits (all banks)</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.total_debit || 0)}</span>
            </div>
            <div class="summary-card" style="margin:0;padding:12px">
                <span class="label">Net Movement (not a bank balance)</span>
                <span class="value" style="font-size:20px">${formatCurrency(st.net || 0)}</span>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));margin-top:8px">
            ${perAccountCards || '<div style="font-size:12px;color:var(--text-light)">No bank accounts yet — add one with 🏦 Bank Accounts.</div>'}
        </div>`}

        <div class="table-container" style="margin-top:10px">
            <table>
                <thead>
                    <tr>
                        <th>Bank / Account</th><th>Date</th><th>Ref</th><th>Particulars</th>
                        <th>Type</th><th class="text-right">Debit</th><th class="text-right">Credit</th>
                        <th class="text-right">Running Balance</th><th>Reconciliation</th><th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${(st.entries || []).map(r => `
                        <tr${r.account_review ? ' style="background:var(--warning-bg,#fff3cd)" title="Bank account not recorded — assign the correct account"' : ''}>
                            <td>${escapeHtml(r.account_name || 'Unassigned')}${r.account_number ? `<br><span style="font-size:11px;color:var(--text-light)">${escapeHtml(r.account_number)}</span>` : ''}</td>
                            <td>${formatDate(r.date)}</td>
                            <td>${escapeHtml(r.reference_no || '')}</td>
                            <td>${escapeHtml(r.description || r.counterparty_name || '')}</td>
                            <td>${bankTxnBadge(r)}</td>
                            <td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                            <td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td>
                            <td class="text-right">${formatCurrency(r.running_balance || 0)}</td>
                            <td>${bankReconBadge(r)}</td>
                            <td class="actions">
                                <button class="btn btn-secondary btn-sm" onclick="showReconcileBank(${r.id})" title="Reconciliation status">✓</button>
                                <button class="btn btn-secondary btn-sm" onclick="showClassifyBank(${r.id})" title="Classification label">🏷</button>
                                <button class="btn btn-info btn-sm" onclick="editBank(${r.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteBankEntry(${r.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${(st.entries || []).length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">
                        No bank transactions ${st.mode === 'account' ? 'for this account' : ''} in this range</td></tr>` : ''}
                </tbody>
                <tfoot>
                    <tr style="font-weight:700;background:var(--bg)">
                        <td colspan="5">Totals</td>
                        <td class="text-right">${formatCurrency(st.total_debit || 0)}</td>
                        <td class="text-right">${formatCurrency(st.total_credit || 0)}</td>
                        <td class="text-right">${st.mode === 'account' ? formatCurrency(st.closing_balance || 0) : 'per account ↑'}</td>
                        <td colspan="2"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

async function refreshBank() {
    pageFilterSet('bank', {
        account_id: document.getElementById('bkAccountSel')?.value || '',
        from: document.getElementById('bkFrom')?.value || '',
        to: document.getElementById('bkTo')?.value || '',
        category: document.getElementById('bkCategory')?.value || '',
        search: document.getElementById('bkSearch')?.value || ''
    });
    await renderBank();
}

// ── Bank account management ────────────────────────────────────────────────
async function showBankAccounts() {
    const accounts = await bankAccountsList(true);
    showModal(`
        <div class="modal-header">
            <h2>🏦 Bank Accounts</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:65vh;overflow:auto">
            <div class="table-container">
                <table>
                    <thead><tr><th>Bank</th><th>Account No</th><th>Branch</th><th>Type</th>
                        <th class="text-right">Opening</th><th class="text-right">Current Balance</th><th>Status</th><th class="actions">Actions</th></tr></thead>
                    <tbody>
                        ${accounts.map(a => `
                            <tr>
                                <td>${escapeHtml(a.bank_name)}${a.is_system ? ' <span class="badge badge-warning">review</span>' : ''}</td>
                                <td>${escapeHtml(a.account_number || '—')}</td>
                                <td>${escapeHtml(a.branch_name || '')}</td>
                                <td>${escapeHtml(a.account_type || '')}</td>
                                <td class="text-right">${formatCurrency(a.opening_balance || 0)}</td>
                                <td class="text-right">${formatCurrency(a.current_balance || 0)}</td>
                                <td><span class="badge ${a.status === 'Active' ? 'badge-success' : 'badge-secondary'}">${escapeHtml(a.status)}</span></td>
                                <td class="actions">
                                    <button class="btn btn-info btn-sm" onclick="showBankAccountForm(${a.id})">✏️</button>
                                    <button class="btn btn-secondary btn-sm" onclick="toggleBankAccount(${a.id}, '${a.status === 'Active' ? 'Inactive' : 'Active'}')">
                                        ${a.status === 'Active' ? '⏸' : '▶'}
                                    </button>
                                    ${a.tx_count > 0 || a.is_system ? '' : `<button class="btn btn-danger btn-sm" onclick="removeBankAccount(${a.id})">🗑</button>`}
                                </td>
                            </tr>
                        `).join('')}
                        ${accounts.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-light)">No bank accounts yet</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
            <p style="font-size:12px;color:var(--text-light);margin-top:10px">
                An account with transactions can never be deleted — deactivate it instead, so its history stays readable.
            </p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="showBankAccountForm()">+ Add Bank Account</button>
        </div>
    `);
}

async function showBankAccountForm(id) {
    let a = { bank_name: '', branch_name: '', account_holder: '', account_number: '', account_type: 'Current', opening_balance: 0, opening_balance_date: '', status: 'Active', remarks: '' };
    if (id) {
        const res = await window.api.getBankAccount(id);
        if (!res || !res.success || !res.data) { showToast('Bank account not found', 'error'); return; }
        a = res.data;
    }
    showModal(`
        <div class="modal-header">
            <h2>${id ? '✏️ Edit Bank Account' : '🏦 New Bank Account'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bankAccountForm">
                <div class="form-row">
                    <div class="form-group"><label>Bank Name *</label><input type="text" class="form-control" id="baName" value="${escapeHtml(a.bank_name || '')}" placeholder="e.g. Nabil Bank"></div>
                    <div class="form-group"><label>Branch Name</label><input type="text" class="form-control" id="baBranch" value="${escapeHtml(a.branch_name || '')}"></div>
                </div>
                <div class="form-group"><label>Account Holder Name</label><input type="text" class="form-control" id="baHolder" value="${escapeHtml(a.account_holder || '')}"></div>
                <div class="form-row">
                    <div class="form-group"><label>Account Number</label><input type="text" class="form-control" id="baNumber" value="${escapeHtml(a.account_number || '')}"></div>
                    <div class="form-group"><label>Account Type</label>
                        <select class="form-control" id="baType">
                            ${['Current', 'Savings', 'Other'].map(t => `<option${a.account_type === t ? ' selected' : ''}>${t}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Opening Balance</label><input type="number" step="0.01" class="form-control" id="baOpening" value="${Number(a.opening_balance) || 0}"></div>
                    <div class="form-group"><label>Opening Balance Date</label><input type="date" class="form-control" id="baOpeningDate" value="${escapeHtml(a.opening_balance_date || '')}"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Status</label>
                        <select class="form-control" id="baStatus">
                            <option${a.status === 'Active' ? ' selected' : ''}>Active</option>
                            <option${a.status === 'Inactive' ? ' selected' : ''}>Inactive</option>
                        </select>
                    </div>
                    <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="baRemarks" value="${escapeHtml(a.remarks || '')}"></div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="showBankAccounts()">Back</button>
            <button class="btn btn-primary" onclick="saveBankAccountForm(${id || 'null'})">💾 Save Account</button>
        </div>
    `);
}

async function saveBankAccountForm(id) {
    const data = {
        id: id || undefined,
        bank_name: document.getElementById('baName')?.value,
        branch_name: document.getElementById('baBranch')?.value,
        account_holder: document.getElementById('baHolder')?.value,
        account_number: document.getElementById('baNumber')?.value,
        account_type: document.getElementById('baType')?.value,
        opening_balance: parseFloat(document.getElementById('baOpening')?.value || 0),
        opening_balance_date: document.getElementById('baOpeningDate')?.value || '',
        status: document.getElementById('baStatus')?.value,
        remarks: document.getElementById('baRemarks')?.value
    };
    if (!String(data.bank_name || '').trim()) { showToast('Bank name is required', 'warning'); return; }
    const res = await window.api.saveBankAccount(data);
    if (!res || !res.success) { showToast((res && res.error) || 'Could not save the account', 'error'); return; }
    showToast('✅ Bank account saved');
    await showBankAccounts();
    await renderBank();
}

async function toggleBankAccount(id, status) {
    const res = await window.api.setBankAccountStatus({ id, status });
    if (!res || !res.success) { showToast((res && res.error) || 'Could not change the status', 'error'); return; }
    showToast(`✅ Account ${status === 'Active' ? 'activated' : 'deactivated'}`);
    await showBankAccounts();
    await renderBank();
}

async function removeBankAccount(id) {
    if (!confirm('Delete this bank account? Only accounts with no transactions can be deleted.')) return;
    const res = await window.api.deleteBankAccount(id);
    if (!res || !res.success) { showToast((res && res.error) || 'Could not delete the account', 'error'); return; }
    showToast('🗑 Bank account deleted');
    await showBankAccounts();
    await renderBank();
}

// ── Transaction entry ──────────────────────────────────────────────────────
async function bankAccountOptions(selectedId) {
    const accounts = await bankAccountsList(false);
    return `<option value="">-- Select bank account * --</option>` + accounts.map(a =>
        `<option value="${a.id}"${String(selectedId) === String(a.id) ? ' selected' : ''}>${escapeHtml(bankAccountLabel(a))}</option>`).join('');
}

async function showAddBank() {
    const acctId = window._bankState?.filters?.account_id || '';
    const options = await bankAccountOptions(acctId);
    showModal(`
        <div class="modal-header">
            <h2>🏦 New Bank Transaction</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bankForm">
                <div class="form-group"><label>Bank Account *</label>
                    <select class="form-control" id="bkAccountId" required>${options}</select>
                    <small style="color:var(--text-light);font-size:11px">Every transaction belongs to one account. Add an account first if the list is empty.</small>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Transaction Date *</label><input type="date" class="form-control" id="bkDate" value="${today()}"></div>
                    <div class="form-group"><label>Transaction Type</label>
                        <select class="form-control" id="bkCategory">
                            ${Object.entries(BANK_CATEGORY_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Reference / Cheque No</label><input type="text" class="form-control" id="bkRef" placeholder="CHQ-001 / QR-089"></div>
                    <div class="form-group"><label>Particulars / Description</label><input type="text" class="form-control" id="bkDescription"></div>
                </div>
                <div class="form-group"><label>Counterparty (optional)</label><input type="text" class="form-control" id="bkCounterparty" placeholder="Party / supplier name"></div>
                <div class="form-row">
                    <div class="form-group"><label>Debit Amount (money out)</label><input type="number" step="0.01" class="form-control" id="bkDebit" value="0" min="0"></div>
                    <div class="form-group"><label>Credit Amount (money in)</label><input type="number" step="0.01" class="form-control" id="bkCredit" value="0" min="0"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Payment Mode</label><input type="text" class="form-control" id="bkMode" value="Bank"></div>
                    <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="bkRemarks"></div>
                </div>
                <p style="font-size:11px;color:var(--text-light)">Bank records never create entries in Petty Cash, Expenses, Payments, Collections or Party Ledger.</p>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBank()">💾 Save Bank Record</button>
        </div>
    `);
}

async function editBank(id) {
    const result = await window.api.getBankTransaction(id);
    if (!result || !result.success) { showToast((result && result.error) || 'Not found', 'error'); return; }
    const r = result.data;
    const options = await bankAccountOptions(r.account_id);
    showModal(`
        <div class="modal-header">
            <h2>✏️ Edit Bank Transaction</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bankForm">
                <div class="form-group"><label>Bank Account *</label>
                    <select class="form-control" id="bkAccountId" ${r.transfer_group ? 'disabled' : ''}>${options}</select>
                    ${r.transfer_group ? '<small style="color:var(--text-light);font-size:11px">This row is one side of an inter-bank transfer; delete the transfer and re-record it to change the account.</small>' : ''}
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Transaction Date</label><input type="date" class="form-control" id="bkDate" value="${r.date}"></div>
                    <div class="form-group"><label>Transaction Type</label>
                        <select class="form-control" id="bkCategory">
                            ${Object.entries(BANK_CATEGORY_LABELS).map(([v, l]) => `<option value="${v}"${(r.txn_category || '') === v ? ' selected' : ''}>${l}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Reference / Cheque No</label><input type="text" class="form-control" id="bkRef" value="${escapeHtml(r.reference_no || '')}"></div>
                    <div class="form-group"><label>Particulars / Description</label><input type="text" class="form-control" id="bkDescription" value="${escapeHtml(r.description || '')}"></div>
                </div>
                <div class="form-group"><label>Counterparty</label><input type="text" class="form-control" id="bkCounterparty" value="${escapeHtml(r.counterparty_name || '')}"></div>
                <div class="form-row">
                    <div class="form-group"><label>Debit (money out)</label><input type="number" step="0.01" class="form-control" id="bkDebit" value="${r.debit || 0}" min="0"></div>
                    <div class="form-group"><label>Credit (money in)</label><input type="number" step="0.01" class="form-control" id="bkCredit" value="${r.credit || 0}" min="0"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Payment Mode</label><input type="text" class="form-control" id="bkMode" value="${escapeHtml(r.payment_mode || 'Bank')}"></div>
                    <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="bkRemarks" value="${escapeHtml(r.remarks || '')}"></div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBank(${r.id})">💾 Save</button>
        </div>
    `);
}

let _bankSaving = false;
async function saveBank(id) {
    if (_bankSaving) return;
    const data = {
        id: id || undefined,
        account_id: document.getElementById('bkAccountId')?.value || undefined,
        date: document.getElementById('bkDate')?.value,
        txn_category: document.getElementById('bkCategory')?.value,
        reference_no: document.getElementById('bkRef')?.value,
        description: document.getElementById('bkDescription')?.value,
        counterparty_name: document.getElementById('bkCounterparty')?.value,
        debit: parseFloat(document.getElementById('bkDebit')?.value || 0),
        credit: parseFloat(document.getElementById('bkCredit')?.value || 0),
        payment_mode: document.getElementById('bkMode')?.value,
        remarks: document.getElementById('bkRemarks')?.value
    };
    if (!data.account_id) { showToast('Select a bank account — a transaction cannot be saved without one', 'warning'); return; }
    if (!data.date) { showToast('Date is required', 'warning'); return; }
    if (data.debit <= 0 && data.credit <= 0) { showToast('Enter a debit or credit amount', 'warning'); return; }
    _bankSaving = true;
    try {
        const result = await window.api.saveBankTransaction(data);
        if (!result || !result.success) { showToast((result && result.error) || 'Could not save', 'error'); return; }
        showToast('✅ Bank transaction saved');
        closeModal();
        await renderBank();
    } finally {
        _bankSaving = false;
    }
}

async function deleteBankEntry(id) {
    const row = (window._bankState?.statement?.entries || []).find(r => r.id === id);
    const isTransfer = row && row.transfer_group;
    if (!confirm(isTransfer
        ? 'This is one side of an inter-bank transfer. Deleting it removes BOTH sides. Continue?'
        : 'Delete this standalone bank transaction? No other register or ledger will be changed.')) return;
    const result = await window.api.deleteBankTransaction(id);
    if (!result || !result.success) { showToast((result && result.error) || 'Could not delete', 'error'); return; }
    showToast('🗑 Deleted');
    await renderBank();
}

// ── Inter-bank transfer ────────────────────────────────────────────────────
async function showBankTransfer() {
    const accounts = await bankAccountsList(false);
    if (accounts.length < 2) { showToast('Add at least two bank accounts to record a transfer', 'warning'); return; }
    showModal(`
        <div class="modal-header">
            <h2>⇄ Transfer Between Own Accounts</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <p style="font-size:12px;color:var(--text-light)">Recorded as two linked rows: a debit from the source account and a credit to the destination. It is never income or expense.</p>
            <div class="form-row">
                <div class="form-group"><label>From Account *</label>
                    <select class="form-control" id="trFrom">${accounts.map(a => `<option value="${a.id}">${escapeHtml(bankAccountLabel(a))}</option>`).join('')}</select>
                </div>
                <div class="form-group"><label>To Account *</label>
                    <select class="form-control" id="trTo">${accounts.map((a, i) => `<option value="${a.id}"${i === 1 ? ' selected' : ''}>${escapeHtml(bankAccountLabel(a))}</option>`).join('')}</select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Date *</label><input type="date" class="form-control" id="trDate" value="${today()}"></div>
                <div class="form-group"><label>Amount *</label><input type="number" step="0.01" class="form-control" id="trAmount" value="0" min="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Reference / Cheque No</label><input type="text" class="form-control" id="trRef"></div>
                <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="trRemarks"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBankTransferForm()">💾 Record Transfer</button>
        </div>
    `);
}

async function saveBankTransferForm() {
    const data = {
        from_account_id: document.getElementById('trFrom')?.value,
        to_account_id: document.getElementById('trTo')?.value,
        date: document.getElementById('trDate')?.value,
        amount: parseFloat(document.getElementById('trAmount')?.value || 0),
        reference_no: document.getElementById('trRef')?.value,
        remarks: document.getElementById('trRemarks')?.value
    };
    if (data.from_account_id === data.to_account_id) { showToast('Source and destination must be different accounts', 'warning'); return; }
    if (!(data.amount > 0)) { showToast('Amount must be greater than zero', 'warning'); return; }
    const res = await window.api.saveBankTransfer(data);
    if (!res || !res.success) { showToast((res && res.error) || 'Could not record the transfer', 'error'); return; }
    showToast('✅ Transfer recorded as two linked entries');
    closeModal();
    await renderBank();
}

// ── Reconciliation ─────────────────────────────────────────────────────────
async function showReconcileBank(id) {
    const row = (window._bankState?.statement?.entries || []).find(r => r.id === id);
    const st = window._bankState?.statement || {};
    const status = (row && row.recon_status) || 'unreconciled';
    showModal(`
        <div class="modal-header">
            <h2>✓ Bank Reconciliation</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <p style="font-size:12px;color:var(--text-light)">
                Marks the record against your bank statement. Amounts, dates and accounts are never changed.
            </p>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="rcStatus">
                    <option value="reconciled"${status === 'reconciled' ? ' selected' : ''}>Reconciled — matches the bank statement</option>
                    <option value="disputed"${status === 'disputed' ? ' selected' : ''}>Disputed — needs investigation</option>
                    <option value="unreconciled"${status === 'unreconciled' ? ' selected' : ''}>Unreconciled</option>
                </select>
            </div>
            <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="rcRemarks" value="${escapeHtml((row && row.recon_remarks) || '')}"></div>
            <div class="form-group"><label>Reconciliation Date</label><input type="date" class="form-control" id="rcDate" value="${(row && row.recon_date) || today()}"></div>
            <hr style="margin:12px 0">
            <p style="font-size:12px;color:var(--text-light);margin-bottom:6px">
                Or mark every transaction in the current filter${st.mode === 'account' && st.account ? ' for <strong>' + escapeHtml(st.account.bank_name) + '</strong>' : ''}:
            </p>
            <button class="btn btn-secondary btn-sm" onclick="reconcilePeriod('${status === 'reconciled' ? 'unreconciled' : 'reconciled'}')">
                Mark all ${(status === 'reconciled' ? 'unreconciled' : 'reconciled')} for this ${st.mode === 'account' ? 'account' : 'filter'}
            </button>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBankReconciliation(${id})">💾 Save</button>
        </div>
    `);
}

async function saveBankReconciliation(id) {
    const res = await window.api.reconcileBank({
        ids: [id],
        status: document.getElementById('rcStatus')?.value,
        remarks: document.getElementById('rcRemarks')?.value,
        recon_date: document.getElementById('rcDate')?.value
    });
    if (!res || !res.success) { showToast((res && res.error) || 'Could not save reconciliation', 'error'); return; }
    showToast('✅ Reconciliation saved');
    closeModal();
    await renderBank();
}

async function reconcilePeriod(status) {
    const f = window._bankState?.filters || {};
    if (!f.account_id && !f.from && !f.to) { showToast('Choose an account or a date range first', 'warning'); return; }
    const res = await window.api.reconcileBank({
        account_id: f.account_id || undefined,
        from_date: f.from || undefined,
        to_date: f.to || undefined,
        status,
        remarks: document.getElementById('rcRemarks')?.value || '',
        recon_date: document.getElementById('rcDate')?.value || today()
    });
    if (!res || !res.success) { showToast((res && res.error) || 'Could not save reconciliation', 'error'); return; }
    showToast(`✅ ${res.updated} transaction(s) marked ${status}`);
    closeModal();
    await renderBank();
}

// ── Classification (display label only) ────────────────────────────────────
function showClassifyBank(id) {
    const r = (window._bankState?.statement?.entries || []).find(x => x.id === id);
    const current = (r && r.accounting_class) || 'unclassified';
    const options = [
        ['cash_to_bank_transfer', 'Cash → Bank Transfer (internal — not income)'],
        ['expense', 'Bank Expense (operating expense)'],
        ['customer_receipt', 'Customer Receipt'],
        ['supplier_payment', 'Supplier Payment'],
        ['unclassified', 'Unclassified (derive from wording)']
    ];
    showModal(`
        <div class="modal-header">
            <h2>🏷 Classification</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <p style="font-size:13px;color:var(--text-light)">A display label only. It never creates a posting in another module.</p>
            <div class="form-group"><label>Bank Record Label</label>
                <select class="form-control" id="bkClass">
                    ${options.map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`).join('')}
                </select>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBankClass(${id})">Save Classification</button>
        </div>
    `);
}

async function saveBankClass(id) {
    const v = document.getElementById('bkClass')?.value;
    if (!v) { closeModal(); return; }
    const res = await window.api.setBankAccountingClass({ id, accounting_class: v });
    if (!res || !res.success) { showToast((res && res.error) || 'Could not save', 'error'); return; }
    closeModal();
    showToast('✅ Classification updated (audited)');
    await renderBank();
}

// ── Export / print ─────────────────────────────────────────────────────────
function bankStatementTitle() {
    const st = window._bankState?.statement || {};
    const f = window._bankState?.filters || {};
    if (st.mode === 'account' && st.account) {
        return `${st.account.bank_name}${st.account.account_number ? ' — A/c ' + st.account.account_number : ''}`;
    }
    return 'All Bank Accounts';
}

function buildBankHtml() {
    const st = window._bankState?.statement || {};
    const f = window._bankState?.filters || {};
    const settings = window._settingsCache || {};
    const rows = st.entries || [];
    const head = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>Bank Statement — ${escapeHtml(bankStatementTitle())}</h2>
            <div style="font-size:12px">Period: ${escapeHtml(f.from || 'beginning')} → ${escapeHtml(f.to || 'today')}</div>
        </div>`;
    const table = (entries, showAccount) => `
        <table>
            <thead><tr>
                ${showAccount ? '<th>Bank / Account</th>' : ''}
                <th>Date</th><th>Reference</th><th>Particulars</th><th>Type</th>
                <th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th>
            </tr></thead>
            <tbody>
                ${entries.map(r => `<tr>
                    ${showAccount ? `<td>${escapeHtml((r.account_name || '') + (r.account_number ? ' — ' + r.account_number : ''))}</td>` : ''}
                    <td>${formatDate(r.date)}</td><td>${escapeHtml(r.reference_no || '')}</td>
                    <td>${escapeHtml(r.description || r.counterparty_name || '')}</td>
                    <td>${escapeHtml(BANK_CATEGORY_LABELS[r.txn_category] || '')}</td>
                    <td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                    <td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td>
                    <td class="text-right">${formatCurrency(r.running_balance || 0)}</td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    const summary = st.mode === 'account'
        ? `<table style="margin-top:10px;width:auto">
             <tr><td>Opening Balance</td><td class="text-right">${formatCurrency(st.opening_balance || 0)}</td></tr>
             <tr><td>Total Deposits / Credits</td><td class="text-right">${formatCurrency(st.total_credit || 0)}</td></tr>
             <tr><td>Total Withdrawals / Debits</td><td class="text-right">${formatCurrency(st.total_debit || 0)}</td></tr>
             <tr><td><strong>Closing Balance</strong></td><td class="text-right"><strong>${formatCurrency(st.closing_balance || 0)}</strong></td></tr>
           </table>`
        : `<table style="margin-top:10px">
             <thead><tr><th>Account</th><th class="text-right">Opening</th><th class="text-right">Debits</th><th class="text-right">Credits</th><th class="text-right">Closing</th></tr></thead>
             <tbody>${(st.accounts || []).map(a => `<tr>
                 <td>${escapeHtml(a.bank_name + (a.account_number ? ' — ' + a.account_number : ''))}</td>
                 <td class="text-right">${formatCurrency(a.opening_balance || 0)}</td>
                 <td class="text-right">${formatCurrency(a.total_debit || 0)}</td>
                 <td class="text-right">${formatCurrency(a.total_credit || 0)}</td>
                 <td class="text-right">${formatCurrency(a.closing_balance || 0)}</td></tr>`).join('')}</tbody>
             <tfoot><tr><td><strong>All accounts (deposits / withdrawals)</strong></td><td></td>
                 <td class="text-right"><strong>${formatCurrency(st.total_debit || 0)}</strong></td>
                 <td class="text-right"><strong>${formatCurrency(st.total_credit || 0)}</strong></td>
                 <td class="text-right">per account</td></tr></tfoot>
           </table>`;
    return `${head}${table(rows, st.mode !== 'account')}${summary}
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>`;
}

async function printBank() {
    const st = window._bankState?.statement || {};
    if (!(st.entries || []).length) { showToast('No bank transactions to print', 'warning'); return; }
    printHTML(buildBankHtml());
}

async function exportBankPDF() {
    const st = window._bankState?.statement || {};
    if (!(st.entries || []).length) { showToast('No bank transactions to export', 'warning'); return; }
    await window.api.printToPDF({ html: buildBankHtml() });
}

async function exportBankExcel() {
    const f = window._bankState?.filters || {};
    const opts = {
        account_id: f.account_id || undefined,
        from_date: f.from || undefined,
        to_date: f.to || undefined,
        txn_category: f.category || undefined,
        search: f.search || undefined
    };
    try {
        if (window.api && typeof window.api.exportBankStatement === 'function') {
            const res = await window.api.exportBankStatement(opts);
            if (res && res.success) { showToast('✅ Statement saved: ' + (res.filePath || '')); return; }
            if (res && res.error) { showToast(res.error, 'error'); return; }
        }
        const headers = { 'Content-Type': 'application/json' };
        try {
            const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
            if (token) headers['Authorization'] = 'Bearer ' + token;
        } catch (e) { /* storage unavailable */ }
        const res = await fetch('/api/bank/export', { method: 'POST', headers, body: JSON.stringify(opts), credentials: 'include' });
        if (!res.ok) { showToast('Export failed (HTTP ' + res.status + ')', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Bank_Statement_Export.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    }
}

// ── Review queue (kept for compatibility) ──────────────────────────────────
async function showBankReviewQueue() {
    const accounts = await bankAccountsList(true);
    const st = window._bankState?.statement || {};
    const flagged = (st.entries || []).filter(r => r.account_review);
    const systemAcc = accounts.find(a => a.is_system);
    if (flagged.length === 0) {
        showToast('✅ No bank transactions need an account review', 'success');
        return;
    }
    showModal(`
        <div class="modal-header">
            <h2>🔍 Bank — Account Review (${flagged.length})</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:60vh;overflow:auto">
            <p style="font-size:12px;color:var(--text-light)">These rows carry no bank name from the source data. They sit in
                “${escapeHtml(systemAcc ? systemAcc.bank_name : 'Unassigned / Existing Bank')}” until you assign the real account — nothing is guessed.</p>
            <table>
                <thead><tr><th>Date</th><th>Ref</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="actions">Assign</th></tr></thead>
                <tbody>${flagged.map(r => `<tr>
                    <td>${formatDate(r.date)}</td><td>${escapeHtml(r.reference_no || '')}</td>
                    <td>${escapeHtml(r.description || r.counterparty_name || '')}</td>
                    <td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                    <td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td>
                    <td class="actions"><button class="btn btn-primary btn-sm" onclick="editBank(${r.id})">Assign account</button></td>
                </tr>`).join('')}</tbody>
            </table>
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>
    `);
}

async function resolveBankReview(id) {
    await editBank(id);
}

// Globals
window.renderBank = renderBank;
window.showAddBank = showAddBank;
window.editBank = editBank;
window.saveBank = saveBank;
window.deleteBankEntry = deleteBankEntry;
window.refreshBank = refreshBank;
window.showBankReviewQueue = showBankReviewQueue;
window.resolveBankReview = resolveBankReview;
window.printBank = printBank;
window.exportBankPDF = exportBankPDF;
window.exportBankExcel = exportBankExcel;
window.showClassifyBank = showClassifyBank;
window.saveBankClass = saveBankClass;
window.showBankAccounts = showBankAccounts;
window.showBankAccountForm = showBankAccountForm;
window.saveBankAccountForm = saveBankAccountForm;
window.toggleBankAccount = toggleBankAccount;
window.removeBankAccount = removeBankAccount;
window.showBankTransfer = showBankTransfer;
window.saveBankTransferForm = saveBankTransferForm;
window.showReconcileBank = showReconcileBank;
window.saveBankReconciliation = saveBankReconciliation;
window.reconcilePeriod = reconcilePeriod;
