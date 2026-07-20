/**
 * Partner Capital Management Module
 * ===================================
 * Track partner contributions and withdrawals with running balance.
 * Supports active and silent partners with capital statements.
 */

async function renderPartnerCapital() {
    const container = document.getElementById('page-partner-capital');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading partner capital data...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showPartnerCapitalForm()">+ New Transaction</button>
        <button class="btn btn-info btn-sm" onclick="showPartnerStatement()">📊 Partner Statement</button>
        <button class="btn btn-info btn-sm" onclick="printPartnerSummary()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportPartnerCapitalPDF()">📄 PDF</button>
    `;

    // Get partners with balance and all partner capital transactions
    const [partnersResult, transactionsResult] = await Promise.all([
        window.api.getPartnersWithBalance(),
        window.api.getPartnerCapitalList({})
    ]);

    const partners = partnersResult.success ? partnersResult.data : [];
    const transactions = transactionsResult.success ? transactionsResult.data : [];

    const totalCapital = partners.reduce((s, p) => s + (p.capital_balance || 0), 0);
    const totalContributions = partners.reduce((s, p) => s + (p.total_contributions || 0), 0);
    const totalWithdrawals = partners.reduce((s, p) => s + (p.total_withdrawals || 0), 0);

    container.innerHTML = `
        <!-- Partner Summary Cards -->
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Partners</span>
                <span class="value" style="font-size:22px">${partners.length}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Capital</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalCapital)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Total Contributions</span>
                <span class="value" style="font-size:18px">${formatCurrency(totalContributions)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Withdrawals</span>
                <span class="value" style="font-size:18px">${formatCurrency(totalWithdrawals)}</span>
            </div>
        </div>

        <!-- Partner Capital Table -->
        <div class="card">
            <div class="card-header">
                <h2>Partner Capital Summary</h2>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Partner</th>
                            <th>Type</th>
                            <th class="text-right">Share %</th>
                            <th class="text-right">Contributions</th>
                            <th class="text-right">Withdrawals</th>
                            <th class="text-right">Current Capital</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${partners.length === 0
                            ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No partners yet. Add partners in Party Management first.</td></tr>'
                            : partners.map(p => `
                                <tr>
                                    <td><strong>${escapeHtml(p.name)}</strong></td>
                                    <td><span class="badge ${p.partner_type === 'active' ? 'badge-success' : 'badge-info'}">${escapeHtml(p.partner_type || 'active')}</span></td>
                                    <td class="text-right">${p.profit_share_percent ? p.profit_share_percent + '%' : '-'}</td>
                                    <td class="text-right" style="color:var(--accent)">${formatCurrency(p.total_contributions)}</td>
                                    <td class="text-right" style="color:var(--danger)">${formatCurrency(p.total_withdrawals)}</td>
                                    <td class="text-right" style="font-weight:700;font-size:15px">${formatCurrency(p.capital_balance)}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="showPartnerCapitalForm(null, ${p.id})" title="Add Transaction">+💰</button>
                                        <button class="btn btn-primary btn-sm" onclick="viewPartnerStatement(${p.id})" title="Statement">📄</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Recent Transactions -->
        <div class="card" style="margin-top:16px">
            <div class="card-header">
                <h2>Recent Capital Transactions</h2>
            </div>
            <div class="table-container" style="max-height:300px;overflow-y:auto">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Partner</th>
                            <th>Type</th>
                            <th class="text-right">Amount</th>
                            <th>Mode</th>
                            <th>Reference</th>
                            <th>Notes</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${transactions.length === 0
                            ? '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text-light)">No transactions yet</td></tr>'
                            : transactions.slice(0, 50).map(t => {
                                const partner = partners.find(p => p.id === t.party_id);
                                return `<tr>
                                    <td>${formatDate(t.date)}</td>
                                    <td>${escapeHtml(partner ? partner.name : '#' + t.party_id)}</td>
                                    <td><span class="badge ${t.type === 'contribution' ? 'badge-success' : 'badge-danger'}">${t.type}</span></td>
                                    <td class="text-right" style="font-weight:600;color:${t.type === 'contribution' ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(t.amount)}</td>
                                    <td>${statusBadge(t.mode)}</td>
                                    <td style="font-size:12px">${escapeHtml(t.reference_no || '-')}</td>
                                    <td style="font-size:12px;color:var(--text-light)">${escapeHtml(t.notes || '')}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="editPartnerCapital(${t.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deletePartnerCapitalEntry(${t.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>`;
                            }).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    window._lastPartners = partners;
    window._lastPartnerTransactions = transactions;
}

// ============================================================
// Partner Capital Transaction Form
// ============================================================
async function showPartnerCapitalForm(txnId = null, preSelectedPartnerId = null) {
    const partnersResult = await window.api.getPartnersWithBalance();
    const partners = partnersResult.success ? partnersResult.data : [];
    // Also get partners from parties of type 'partner'
    const allPartnersResult = await window.api.getParties({ type: 'partner' });
    const allPartners = allPartnersResult.success ? allPartnersResult.data : [];

    const allPartnerOptions = partners.length > 0 ? partners : allPartners;

    let txn = null;
    if (txnId) {
        const result = await window.api.getPartnerCapital(txnId);
        if (result.success) txn = result.data;
    }

    const today = new Date().toISOString().split('T')[0];

    showModal(`
        <div class="modal-header">
            <h2>${txn ? 'Edit' : 'New'} Partner Capital Transaction</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="partnerCapForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Partner *</label>
                        <select class="form-control" id="pcPartner" required>
                            <option value="">-- Select Partner --</option>
                            ${allPartnerOptions.map(p => `<option value="${p.id}" ${(txn && txn.party_id === p.id) || preSelectedPartnerId == p.id ? 'selected' : ''}>${escapeHtml(p.name)} ${p.partner_type ? '(' + p.partner_type + ')' : ''}</option>`).join('')}
                        </select>
                        <small style="color:var(--text-light)">Add partners in Party Management with type "partner"</small>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" id="pcDate" value="${txn ? txn.date : today}">
                    </div>
                    <div class="form-group">
                        <label>Transaction Type *</label>
                        <select class="form-control" id="pcType">
                            <option value="contribution" ${txn && txn.type === 'contribution' ? 'selected' : ''}>💰 Contribution (Capital Added)</option>
                            <option value="withdrawal" ${txn && txn.type === 'withdrawal' ? 'selected' : ''}>🏧 Withdrawal / Drawings</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Amount *</label>
                        <input type="number" class="form-control" id="pcAmount" value="${txn ? txn.amount : ''}" step="0.01" min="0.01" required>
                    </div>
                    <div class="form-group">
                        <label>Mode</label>
                        <select class="form-control" id="pcMode">
                            <option value="bank" ${txn && txn.mode === 'bank' ? 'selected' : ''}>Bank Transfer</option>
                            <option value="cash" ${txn && txn.mode === 'cash' ? 'selected' : ''}>Cash</option>
                            <option value="upi" ${txn && txn.mode === 'upi' ? 'selected' : ''}>UPI</option>
                            <option value="cheque" ${txn && txn.mode === 'cheque' ? 'selected' : ''}>Cheque</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Reference No (cheque/transaction no)</label>
                    <input type="text" class="form-control" id="pcRef" value="${escapeHtml(txn ? txn.reference_no : '')}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" id="pcNotes" rows="2">${escapeHtml(txn ? txn.notes : '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="savePartnerCapitalEntry(${txn ? txn.id : 'null'})">💾 ${txn ? 'Update' : 'Save Transaction'}</button>
        </div>
    `);
}

async function savePartnerCapitalEntry(id) {
    const partyId = parseInt(document.getElementById('pcPartner')?.value || 0);
    const date = document.getElementById('pcDate')?.value || '';
    const type = document.getElementById('pcType')?.value || '';
    const amount = parseFloat(document.getElementById('pcAmount')?.value || 0);
    const mode = document.getElementById('pcMode')?.value || 'bank';
    const ref = document.getElementById('pcRef')?.value || '';
    const notes = document.getElementById('pcNotes')?.value || '';

    if (!partyId) { showToast('Please select a partner', 'error'); return; }
    if (!date) { showToast('Date is required', 'error'); return; }
    if (amount <= 0) { showToast('Amount must be greater than 0', 'error'); return; }

    const data = {
        id: id || null,
        party_id: partyId,
        date,
        type,
        amount,
        mode,
        reference_no: ref,
        notes
    };

    const result = await window.api.savePartnerCapital(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Transaction updated' : 'Transaction saved', 'success');
        renderPartnerCapital();
    } else {
        showToast(result.error, 'error');
    }
}

async function editPartnerCapital(id) {
    showPartnerCapitalForm(id);
}

async function deletePartnerCapitalEntry(id) {
    const confirmed = await confirmAction('Delete this capital transaction?', 'This will also remove the associated ledger entry.');
    if (!confirmed) return;
    const result = await window.api.deletePartnerCapital(id);
    if (result.success) {
        showToast('Transaction deleted', 'success');
        renderPartnerCapital();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Partner Statement
// ============================================================
async function viewPartnerStatement(partyId) {
    if (!partyId) {
        showPartnerStatement();
        return;
    }

    const preset = getDatePreset('this_month');
    const result = await window.api.getPartnerStatement({ party_id: partyId, from_date: preset.from, to_date: preset.to });
    if (!result.success) { showToast(result.error, 'error'); return; }

    const data = result.data;
    const settings = await getSettingsCached();

    showModal(`
        <div class="modal-header">
            <h2>Partner Capital Statement: ${escapeHtml(data.party.name)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:80vh;overflow-y:auto">
            <div style="margin-bottom:12px;padding:10px;background:var(--bg);border-radius:6px;font-size:13px">
                <strong>Type:</strong> ${escapeHtml(data.party.partner_type || 'Partner')} | 
                <strong>Share:</strong> ${data.party.profit_share_percent ? data.party.profit_share_percent + '%' : 'N/A'}
            </div>
            <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
                <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Opening</span><span class="value" style="font-size:18px">${formatCurrency(data.opening_balance)}</span></div>
                <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Contributions</span><span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.total_contributions)}</span></div>
                <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Withdrawals</span><span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.total_withdrawals)}</span></div>
                <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Closing</span><span class="value" style="font-size:18px;font-weight:700">${formatCurrency(data.closing_balance)}</span></div>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Type</th><th class="text-right">Amount</th><th>Mode</th><th>Ref</th><th>Notes</th><th class="text-right">Balance</th></tr></thead>
                    <tbody>
                        <tr style="background:#f0f4f8"><td colspan="6"><strong>Opening Balance</strong></td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
                        ${data.transactions.map(t => `<tr>
                            <td>${formatDate(t.date)}</td>
                            <td><span class="badge ${t.type === 'contribution' ? 'badge-success' : 'badge-danger'}">${t.type}</span></td>
                            <td class="text-right" style="font-weight:600;color:${t.type === 'contribution' ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(t.amount)}</td>
                            <td>${statusBadge(t.mode)}</td>
                            <td style="font-size:12px">${escapeHtml(t.reference_no || '-')}</td>
                            <td style="font-size:12px;color:var(--text-light)">${escapeHtml(t.notes || '')}</td>
                            <td class="text-right"><strong>${formatCurrency(t.running_balance)}</strong></td>
                        </tr>`).join('')}
                    </tbody>
                    <tfoot><tr>
                        <td colspan="6"><strong>Closing Balance</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td>
                    </tr></tfoot>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printPartnerStatementData()">🖨 Print</button>
        </div>
    `);

    window._lastPartnerStatement = data;
}

async function showPartnerStatement() {
    const partnersResult = await window.api.getPartnersWithBalance();
    const partners = partnersResult.success ? partnersResult.data : [];

    const preset = getDatePreset('this_month');

    showModal(`
        <div class="modal-header">
            <h2>Partner Capital Statement</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Partner</label>
                    <select class="form-control" id="psPartner">
                        <option value="">-- Select --</option>
                        ${partners.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${formatCurrency(p.capital_balance)})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="psFrom" value="${preset.from}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="psTo" value="${preset.to}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="generatePartnerStatement()">View Statement</button>
                </div>
            </div>
            <div style="text-align:center;padding:30px;color:var(--text-light)">Select a partner and date range.</div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function generatePartnerStatement() {
    const partyId = parseInt(document.getElementById('psPartner')?.value || 0);
    const from = document.getElementById('psFrom')?.value || '';
    const to = document.getElementById('psTo')?.value || '';
    if (!partyId) { showToast('Select a partner', 'warning'); return; }
    closeModal();
    viewPartnerStatement(partyId);
}

// ============================================================
// Print / PDF
// ============================================================
async function printPartnerStatementData() {
    const data = window._lastPartnerStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Partner Capital Statement: ${escapeHtml(data.party.name)}</h2>
        <p>Period: ${data.from_date} to ${data.to_date} | Type: ${escapeHtml(data.party.partner_type||'')}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Opening</div><div class="value-number">${formatCurrency(data.opening_balance)}</div></div>
            <div class="value-card"><div class="value-label">Contributions</div><div class="value-number">${formatCurrency(data.total_contributions)}</div></div>
            <div class="value-card"><div class="value-label">Withdrawals</div><div class="value-number">${formatCurrency(data.total_withdrawals)}</div></div>
            <div class="value-card"><div class="value-label">Closing</div><div class="value-number">${formatCurrency(data.closing_balance)}</div></div>
        </div>
        <table><thead><tr><th>Date</th><th>Type</th><th class="text-right">Amount</th><th>Mode</th><th class="text-right">Balance</th></tr></thead>
        <tbody><tr><td colspan="4">Opening Balance</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
        ${data.transactions.map(t => `<tr><td>${formatDate(t.date)}</td><td>${t.type}</td><td class="text-right">${formatCurrency(t.amount)}</td><td>${t.mode}</td><td class="text-right">${formatCurrency(t.running_balance)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4"><strong>Closing Balance</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function printPartnerSummary() {
    const partners = window._lastPartners || [];
    if (partners.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Partner Capital Summary</h2><p>As of: ${formatDate(new Date().toISOString().split('T')[0])}</p></div>
        <table><thead><tr><th>Partner</th><th>Type</th><th class="text-right">Contributions</th><th class="text-right">Withdrawals</th><th class="text-right">Capital</th></tr></thead>
        <tbody>${partners.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.partner_type||'')}</td><td class="text-right">${formatCurrency(p.total_contributions)}</td><td class="text-right">${formatCurrency(p.total_withdrawals)}</td><td class="text-right"><strong>${formatCurrency(p.capital_balance)}</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(partners.reduce((s,p) => s + (p.capital_balance||0), 0))}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportPartnerCapitalPDF() {
    const partners = window._lastPartners || [];
    if (partners.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Partner Capital Summary</h2><p>Total Capital: ${formatCurrency(partners.reduce((s,p) => s + (p.capital_balance||0), 0))}</p></div>`;
    await window.api.printToPDF({ html });
}

// Globals
window.renderPartnerCapital = renderPartnerCapital;
window.showPartnerCapitalForm = showPartnerCapitalForm;
window.savePartnerCapitalEntry = savePartnerCapitalEntry;
window.editPartnerCapital = editPartnerCapital;
window.deletePartnerCapitalEntry = deletePartnerCapitalEntry;
window.viewPartnerStatement = viewPartnerStatement;
window.showPartnerStatement = showPartnerStatement;
window.generatePartnerStatement = generatePartnerStatement;
window.printPartnerStatementData = printPartnerStatementData;
window.printPartnerSummary = printPartnerSummary;
window.exportPartnerCapitalPDF = exportPartnerCapitalPDF;
