/**
 * Bank Transactions Module
 * ========================
 * Manages bank transactions (Sushil QR / bank account) separate from cash & petty cash.
 * Features: list with running balance, add/edit/delete, auto-matching to party ledger,
 * and a "Needs Review" queue for near/unmatched transactions.
 */

async function renderBank() {
    const container = document.getElementById('page-bank');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddBank()">+ New Transaction</button>
        <button class="btn btn-warning btn-sm" onclick="showBankReviewQueue()">🔍 Needs Review <span id="bankReviewCount" style="margin-left:4px"></span></button>
    `;

    const preset = getDatePreset('this_month');
    const result = await window.api.getBankList({ from_date: preset.from, to_date: preset.to });
    const rows = result.success ? result.data : [];

    const review = await window.api.getBankReviewQueue();
    const reviewCount = review.success ? review.data.length : 0;
    const reviewBadge = document.getElementById('bankReviewCount');
    if (reviewBadge) reviewBadge.textContent = reviewCount > 0 ? `(${reviewCount})` : '';

    const totalIn = rows.reduce((s, r) => s + (r.credit || 0), 0);
    const totalOut = rows.reduce((s, r) => s + (r.debit || 0), 0);
    const closing = rows.length ? rows[rows.length - 1].running_balance : 0;

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr)">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total In (Credit)</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalIn)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Out (Debit)</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalOut)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Net / Closing Balance</span>
                <span class="value" style="font-size:20px">${formatCurrency(closing)}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Needs Review</span>
                <span class="value" style="font-size:20px">${reviewCount}</span>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="bkFrom" value="${preset.from}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="bkTo" value="${preset.to}">
            </div>
            <div class="form-group">
                <label>Search</label>
                <input type="text" class="form-control" id="bkSearch" placeholder="Name / description / ref...">
            </div>
            <div class="form-group">
                <label>Status</label>
                <select class="form-control" id="bkStatus">
                    <option value="">All</option>
                    <option value="auto">Auto-matched</option>
                    <option value="review">Needs review</option>
                    <option value="none">Unmatched</option>
                </select>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshBank()">Search</button>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th><th>Ref</th><th>Counterparty</th><th>Description</th><th>Type</th>
                        <th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th>
                        <th>Party</th><th>Status</th><th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${formatDate(r.date)}</td>
                            <td>${escapeHtml(r.reference_no || '')}</td>
                            <td>${escapeHtml(r.counterparty_name || '')}</td>
                            <td>${escapeHtml(r.description || '')}</td>
                            <td>${escapeHtml(r.txn_type || '')}</td>
                            <td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                            <td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td>
                            <td class="text-right">${formatCurrency(r.running_balance)}</td>
                            <td>${escapeHtml(r.party_name || '')}</td>
                            <td>${bankStatusBadge(r)}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editBank(${r.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteBankEntry(${r.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${rows.length === 0 ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No bank transactions in this range</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;

    window._lastBankRows = rows;
}

function bankStatusBadge(r) {
    if (r.match_status === 'auto') return '<span class="badge badge-success">✓ Posted</span>';
    if (r.match_status === 'review') return '<span class="badge badge-warning">Review</span>';
    if (r.match_status === 'unmatched') return '<span class="badge badge-danger">Unmatched</span>';
    return '<span class="badge badge-secondary">—</span>';
}

async function refreshBank() {
    const from = document.getElementById('bkFrom')?.value || '';
    const to = document.getElementById('bkTo')?.value || '';
    const search = document.getElementById('bkSearch')?.value || '';
    const status = document.getElementById('bkStatus')?.value || '';
    const result = await window.api.getBankList({ from_date: from, to_date: to, search: search || undefined, match_status: status || undefined });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastBankRows = result.data;
    renderBank();
}

async function getPartyOptions(selectedId) {
    const result = await window.api.getParties({});
    const parties = result.success ? result.data : [];
    return `<option value="">-- Select Party (auto-match) --</option>` +
        parties.map(p => `<option value="${p.id}" ${Number(selectedId) === Number(p.id) ? 'selected' : ''}>${escapeHtml(p.name)} (${p.type})</option>`).join('');
}

async function showAddBank() {
    const today = new Date().toISOString().slice(0, 10);
    showModal(`
        <div class="modal-header">
            <h2>🏦 New Bank Transaction</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bankForm">
                <div class="form-group"><label>Date</label><input type="date" class="form-control" id="bkDate" value="${today}"></div>
                <div class="form-row">
                    <div class="form-group"><label>Reference No</label><input type="text" class="form-control" id="bkRef" placeholder="QR-001 / CHQ-..."></div>
                    <div class="form-group"><label>Bank Account</label><input type="text" class="form-control" id="bkAccount" value="Sushil QR"></div>
                </div>
                <div class="form-group"><label>Counterparty Name</label><input type="text" class="form-control" id="bkCounterparty" placeholder="Party / supplier name"></div>
                <div class="form-group"><label>Description / Narration</label><input type="text" class="form-control" id="bkDescription"></div>
                <div class="form-row">
                    <div class="form-group"><label>Debit (Money Out)</label><input type="number" class="form-control" id="bkDebit" value="0" min="0"></div>
                    <div class="form-group"><label>Credit (Money In)</label><input type="number" class="form-control" id="bkCredit" value="0" min="0"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Payment Mode</label><input type="text" class="form-control" id="bkMode" value="QR/Bank"></div>
                    <div class="form-group"><label>Transaction Type</label>
                        <select class="form-control" id="bkType">
                            <option value="">-- Type --</option>
                            <option>Customer Collection</option>
                            <option>Supplier Payment</option>
                            <option>Bank Deposit (own)</option>
                            <option>Bank Charge</option>
                            <option>Advance</option>
                            <option>Other</option>
                        </select>
                    </div>
                </div>
                <div class="form-group"><label>Match to Party (optional)</label><select class="form-control" id="bkParty">${await getPartyOptions()}</select></div>
                <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="bkRemarks"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBank()">💾 Save &amp; Post to Ledger</button>
        </div>
    `);
}

async function editBank(id) {
    const result = await window.api.getBankTransaction(id);
    if (!result.success) { showToast(result.error, 'error'); return; }
    const r = result.data;
    showModal(`
        <div class="modal-header">
            <h2>✏️ Edit Bank Transaction</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bankForm">
                <div class="form-group"><label>Date</label><input type="date" class="form-control" id="bkDate" value="${r.date}"></div>
                <div class="form-row">
                    <div class="form-group"><label>Reference No</label><input type="text" class="form-control" id="bkRef" value="${escapeHtml(r.reference_no || '')}"></div>
                    <div class="form-group"><label>Bank Account</label><input type="text" class="form-control" id="bkAccount" value="${escapeHtml(r.bank_account || '')}"></div>
                </div>
                <div class="form-group"><label>Counterparty Name</label><input type="text" class="form-control" id="bkCounterparty" value="${escapeHtml(r.counterparty_name || '')}"></div>
                <div class="form-group"><label>Description / Narration</label><input type="text" class="form-control" id="bkDescription" value="${escapeHtml(r.description || '')}"></div>
                <div class="form-row">
                    <div class="form-group"><label>Debit (Money Out)</label><input type="number" class="form-control" id="bkDebit" value="${r.debit || 0}" min="0"></div>
                    <div class="form-group"><label>Credit (Money In)</label><input type="number" class="form-control" id="bkCredit" value="${r.credit || 0}" min="0"></div>
                </div>
                <div class="form-row">
                    <div class="form-group"><label>Payment Mode</label><input type="text" class="form-control" id="bkMode" value="${escapeHtml(r.payment_mode || 'QR/Bank')}"></div>
                    <div class="form-group"><label>Transaction Type</label><input type="text" class="form-control" id="bkType" value="${escapeHtml(r.txn_type || '')}"></div>
                </div>
                <div class="form-group"><label>Match to Party</label><select class="form-control" id="bkParty">${await getPartyOptions(r.party_id)}</select></div>
                <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="bkRemarks" value="${escapeHtml(r.remarks || '')}"></div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveBank(${r.id})">💾 Save</button>
        </div>
    `);
}

async function saveBank(id) {
    const data = {
        id: id || undefined,
        date: document.getElementById('bkDate')?.value,
        reference_no: document.getElementById('bkRef')?.value,
        bank_account: document.getElementById('bkAccount')?.value,
        counterparty_name: document.getElementById('bkCounterparty')?.value,
        description: document.getElementById('bkDescription')?.value,
        debit: parseFloat(document.getElementById('bkDebit')?.value || 0),
        credit: parseFloat(document.getElementById('bkCredit')?.value || 0),
        payment_mode: document.getElementById('bkMode')?.value,
        txn_type: document.getElementById('bkType')?.value,
        party_id: document.getElementById('bkParty')?.value ? parseInt(document.getElementById('bkParty').value) : null,
        remarks: document.getElementById('bkRemarks')?.value,
        match_status: document.getElementById('bkParty')?.value ? 'auto' : 'review'
    };
    if (!data.date) { showToast('Date is required', 'warning'); return; }
    if (data.debit <= 0 && data.credit <= 0) { showToast('Enter a debit or credit amount', 'warning'); return; }
    const result = await window.api.saveBankTransaction(data);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('✅ Bank transaction saved');
    closeModal();
    renderBank();
}

async function deleteBankEntry(id) {
    if (!confirm('Delete this bank transaction? Its ledger posting (if any) will also be removed.')) return;
    const result = await window.api.deleteBankTransaction(id);
    if (!result.success) { showToast(result.error, 'error'); return; }
    showToast('🗑 Deleted');
    renderBank();
}

// ============================================================
// Needs Review Queue
// ============================================================
async function showBankReviewQueue() {
    const result = await window.api.getBankReviewQueue();
    const rows = result.success ? result.data : [];
    const partiesResult = await window.api.getParties({});
    const parties = partiesResult.success ? partiesResult.data : [];

    if (rows.length === 0) {
        showToast('✅ Review queue is empty — all bank transactions matched or posted', 'success');
        return;
    }

    showModal(`
        <div class="modal-header">
            <h2>🔍 Bank — Needs Review (${rows.length})</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:60vh;overflow:auto">
            <p style="font-size:12px;color:var(--text-light);margin-bottom:10px">
                These bank transactions could not be matched to a party with confidence.
                Assign a party and post, or leave unmatched. Posting writes a ledger entry
                (skipped automatically if the ledger already has that transaction).
            </p>
            <table>
                <thead><tr><th>Date</th><th>Ref</th><th>Counterparty / Description</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th>Assign Party</th><th class="actions">Action</th></tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td>${formatDate(r.date)}</td>
                            <td>${escapeHtml(r.reference_no || '')}</td>
                            <td>${escapeHtml(r.counterparty_name || '')} ${escapeHtml(r.description ? '— ' + r.description : '')}</td>
                            <td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td>
                            <td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td>
                            <td>
                                <select class="form-control" id="reviewParty_${r.id}" style="min-width:180px">
                                    <option value="">-- Skip (unmatched) --</option>
                                    ${parties.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                                </select>
                            </td>
                            <td class="actions">
                                <button class="btn btn-primary btn-sm" onclick="resolveBankReview(${r.id})">Assign &amp; Post</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function resolveBankReview(id) {
    const partyId = document.getElementById(`reviewParty_${id}`)?.value;
    const result = await window.api.matchBankTransaction({ id, party_id: partyId ? parseInt(partyId) : null, match_status: partyId ? 'auto' : 'unmatched', post: true });
    if (!result.success) { showToast(result.error, 'error'); return; }
    const postInfo = result.post && !result.post.success ? ` (${result.post.error})` : '';
    showToast(`✅ Resolved — ${result.post && result.post.posted ? 'posted to ledger' : result.post && result.post.reason === 'already_in_ledger' ? 'already in ledger' : 'saved'}${postInfo}`);
    showBankReviewQueue();
}

// ============================================================
// Print & PDF
// ============================================================
function buildBankHtml(rows) {
    const settings = window._settingsCache || {};
    const totalIn = rows.reduce((s, r) => s + (r.credit || 0), 0);
    const totalOut = rows.reduce((s, r) => s + (r.debit || 0), 0);
    return `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1><h2>Bank Transactions Statement</h2></div>
        <table>
            <thead><tr><th>Date</th><th>Ref</th><th>Counterparty</th><th>Description</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                ${rows.map(r => `<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.reference_no || '')}</td><td>${escapeHtml(r.counterparty_name || '')}</td><td>${escapeHtml(r.description || '')}</td><td class="text-right">${r.debit > 0 ? formatCurrency(r.debit) : '-'}</td><td class="text-right">${r.credit > 0 ? formatCurrency(r.credit) : '-'}</td><td class="text-right">${formatCurrency(r.running_balance)}</td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(totalOut)}</strong></td><td class="text-right"><strong>${formatCurrency(totalIn)}</strong></td><td class="text-right"><strong>${formatCurrency(rows.length ? rows[rows.length - 1].running_balance : 0)}</strong></td></tr></tfoot>
        </table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
}

async function printBank() {
    const rows = window._lastBankRows || [];
    if (!rows.length) { showToast('No bank transactions to print', 'warning'); return; }
    printHTML(buildBankHtml(rows));
}

async function exportBankPDF() {
    const rows = window._lastBankRows || [];
    if (!rows.length) { showToast('No bank transactions to export', 'warning'); return; }
    await window.api.printToPDF({ html: buildBankHtml(rows) });
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