/**
 * Petty Cash Register Module
 * ==========================
 * Manages petty cash entries with add/edit/delete, print & PDF, and the
 * manual "party not assigned" review queue.
 *
 * Every voucher can carry a party. A voucher whose payee matched no party is
 * NEVER auto-linked: the operator picks the party (or records that the voucher
 * is not related to a party) from the review queue on this screen.
 */

// Active search/filter state for the petty cash register.
// When null, defaults to the current BS month (this_month preset).
let pettyCashFilter = null;

const PC_STATUS_LABEL = {
    unassigned: 'Party not assigned',
    assigned: 'Party assigned',
    not_related: 'Not related to a party'
};

async function renderPettyCash() {
    const container = document.getElementById('page-petty-cash');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddPettyCash()">+ New Entry</button>
    `;

    // Open range by default: the register's vouchers span several BS months and
    // defaulting to the current month made the whole tab look empty.
    const preset = getDatePreset('all');
    const filter = pettyCashFilter || { from_date: preset.from, to_date: preset.to };
    const [result, statsResult, partiesResult] = await Promise.all([
        window.api.getPettyCashList(filter),
        window.api.getPettyCashPartyReview(),
        window.api.getParties({})
    ]);
    const entries = result.success ? result.data : [];
    const stats = statsResult.success ? statsResult.data
        : { total: entries.length, assigned: 0, unassigned: 0, not_related: 0, remaining: 0 };
    const parties = partiesResult.success ? (partiesResult.data || []) : [];
    window._pcParties = parties;

    const summary = await window.api.getPettyCashSummary({ from_date: filter.from_date, to_date: filter.to_date });
    const s = summary.success ? summary.data : { count: 0, total: 0 };
    const filterHead = filter.expense_head || '';
    const statusFilter = filter.party_status || '';

    const decided = stats.assigned + stats.not_related;
    const reviewTotal = decided + stats.unassigned;
    const progress = reviewTotal > 0 ? Math.round((decided / reviewTotal) * 100) : 100;

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr">
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Total Entries</span>
                <span class="value" style="font-size:22px">${s.count}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Petty Cash</span>
                <span class="value" style="font-size:22px">${formatCurrency(s.total)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Party Review Progress</span>
                <span class="value" style="font-size:18px">${stats.unassigned} remaining</span>
                <span class="sub">${stats.assigned} assigned · ${stats.not_related} not related · ${stats.total} total</span>
                <div style="height:7px;background:#e5eaf0;border-radius:4px;margin-top:7px;overflow:hidden">
                    <div style="height:100%;width:${progress}%;background:var(--success, #16a34a)"></div>
                </div>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
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
                <input type="date" class="form-control" id="pcFrom" data-no-default="1" value="${filter.from_date || ''}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="pcTo" data-no-default="1" value="${filter.to_date || ''}">
            </div>
            <div class="form-group">
                <label>Expense Head</label>
                <input type="text" class="form-control" id="pcSearch" placeholder="Filter by head..." value="${escapeHtml(filterHead)}">
            </div>
            <div class="form-group">
                <label>Party Status</label>
                <select class="form-control" id="pcPartyStatus">
                    <option value=""${statusFilter === '' ? ' selected' : ''}>All vouchers</option>
                    <option value="unassigned"${statusFilter === 'unassigned' ? ' selected' : ''}>Party not assigned (${stats.unassigned})</option>
                    <option value="assigned"${statusFilter === 'assigned' ? ' selected' : ''}>Party assigned (${stats.assigned})</option>
                    <option value="not_related"${statusFilter === 'not_related' ? ' selected' : ''}>Not related to a party (${stats.not_related})</option>
                </select>
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshPettyCash()">Search</button>
            </div>
        </div>
        ${stats.unassigned > 0 ? `
        <div style="background:#fff8e1;border-left:4px solid #f0ad4e;border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px">
            <strong>${stats.unassigned} voucher(s) still need a party.</strong>
            No party was guessed for them. Open the voucher with the 👤 button, choose the correct party,
            or mark it “Not related to a party”. The original date, amount and voucher number are never changed.
        </div>` : ''}
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th><th>Voucher No</th><th>Expense Head</th>
                        <th>Description</th><th>Paid To</th><th>Party</th><th>Approved By</th>
                        <th class="text-right">Amount</th><th>Mode</th><th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(e => {
                        const partyCell = e.party_id
                            ? `<span style="color:var(--success,#16a34a);font-weight:600">${escapeHtml(e.party_name || ('#' + e.party_id))}</span>`
                            : (Number(e.party_review) === 2
                                ? '<span style="color:var(--text-light)" title="Deliberately marked as not related to a party">Not related</span>'
                                : '<span class="badge badge-warning">Not assigned</span>');
                        return `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.voucher_no)}</td>
                            <td>${escapeHtml(e.expense_head)}</td>
                            <td>${escapeHtml(e.description || '')}</td>
                            <td>${escapeHtml(e.paid_to || '')}</td>
                            <td>${partyCell}</td>
                            <td>${escapeHtml(e.approved_by || '')}</td>
                            <td class="text-right">${formatCurrency(e.amount)}</td>
                            <td>${statusBadge(e.payment_mode)}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editPettyCash(${e.id})" title="Edit voucher">✏️</button>
                                <button class="btn btn-secondary btn-sm" onclick="showPettyPartyAssign(${e.id})" title="Assign party">👤</button>
                                <button class="btn btn-danger btn-sm" onclick="deletePettyCashEntry(${e.id})">🗑</button>
                            </td>
                        </tr>`;
                    }).join('')}
                    ${entries.length === 0 ? `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No petty cash entries</td></tr>` : ''}
                </tbody>
                ${entries.length > 0 ? `<tfoot><tr><td colspan="7"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(entries.reduce((s,e) => s + e.amount, 0))}</strong></td><td colspan="2"></td></tr></tfoot>` : ''}
            </table>
        </div>
    `;

    window._lastPettyCash = entries;
}

async function refreshPettyCash() {
    const from = document.getElementById('pcFrom')?.value || '';
    const to = document.getElementById('pcTo')?.value || '';
    const head = document.getElementById('pcSearch')?.value || '';
    const status = document.getElementById('pcPartyStatus')?.value || '';
    // Store the active filter so renderPettyCash uses it instead of resetting to the default month.
    pettyCashFilter = {
        from_date: from || undefined,
        to_date: to || undefined,
        expense_head: head || undefined,
        party_status: status || undefined
    };
    renderPettyCash();
}

/** Party options: an explicit "not related" choice plus every party. */
function pettyPartyOptions(selectedId, notRelated) {
    const parties = window._pcParties || [];
    return `<option value="">— Not linked to a party —</option>
        <option value="__none__"${notRelated ? ' selected' : ''}>— Not related to a party (ignore) —</option>
        ${parties.map(p => `<option value="${p.id}"${String(selectedId) === String(p.id) ? ' selected' : ''}>${escapeHtml(p.name)} (${p.type || ''})</option>`).join('')}`;
}

function showAddPettyCash(existingData) {
    const todayStr = today();
    const d = existingData || { date: todayStr, voucher_no: 'PC-' + Date.now().toString().slice(-6), expense_head: '', description: '', amount: '', paid_to: '', approved_by: '', payment_mode: 'cash', remarks: '' };

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
            <div class="form-group">
                <label>Accounting / Effective Date</label>
                <input type="date" class="form-control" id="pcAccountingDate" value="${d.accounting_date || d.date}">
                <small style="color:var(--text-light)">Period this voucher belongs to. Defaults to the voucher date.</small>
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
                    <label>Paid To (free text)</label>
                    <input type="text" class="form-control" id="pcPaidTo" value="${escapeHtml(d.paid_to || '')}">
                </div>
                <div class="form-group">
                    <label>Party (supplier / customer)</label>
                    <select class="form-control" id="pcParty">
                        ${pettyPartyOptions(d.party_id, Number(d.party_review) === 2)}
                    </select>
                    <small style="color:var(--text-light)">Choosing a party puts this payment on that party’s statement.</small>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Approved By</label>
                    <input type="text" class="form-control" id="pcApprovedBy" value="${escapeHtml(d.approved_by || '')}">
                </div>
                <div class="form-group">
                    <label>Payment Mode</label>
                    <select class="form-control" id="pcMode">
                        <option value="cash" ${d.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                        <option value="bank" ${d.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                        <option value="upi" ${d.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <input type="text" class="form-control" id="pcRemarks" value="${escapeHtml(d.remarks || '')}">
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="savePettyCashEntry(${existingData ? existingData.id : 'null'})">Save</button>
        </div>
    `);
}

async function savePettyCashEntry(id) {
    const partyRaw = document.getElementById('pcParty')?.value || '';
    const data = {
        id: id || undefined,
        date: document.getElementById('pcDate')?.value || '',
        accounting_date: document.getElementById('pcAccountingDate')?.value || undefined,
        voucher_no: document.getElementById('pcVoucher')?.value || '',
        expense_head: document.getElementById('pcHead')?.value || '',
        description: document.getElementById('pcDesc')?.value || '',
        amount: parseFloat(document.getElementById('pcAmount')?.value || 0),
        paid_to: document.getElementById('pcPaidTo')?.value || '',
        party_id: partyRaw && partyRaw !== '__none__' ? parseInt(partyRaw) : null,
        party_not_related: partyRaw === '__none__',
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

/**
 * Manual party review for one historical voucher.
 * Shows the voucher exactly as stored (read-only) and records the operator's
 * decision. Date, amount and voucher number are never editable here.
 */
async function showPettyPartyAssign(id) {
    const [res, partiesRes] = await Promise.all([
        window.api.getPettyCash(id),
        window.api.getParties({})
    ]);
    if (!res.success || !res.data) { showToast(res.error || 'Voucher not found', 'error'); return; }
    const v = res.data;
    const parties = partiesRes.success ? (partiesRes.data || []) : [];
    window._pcParties = parties;

    showModal(`
        <div class="modal-header">
            <h2>👤 Assign Party — Voucher ${escapeHtml(v.voucher_no)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="background:var(--bg);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px">
                <div><strong>Date:</strong> ${formatDate(v.date)}</div>
                <div><strong>Amount:</strong> ${formatCurrency(v.amount)}</div>
                <div><strong>Expense head:</strong> ${escapeHtml(v.expense_head || '')}</div>
                <div><strong>Paid to:</strong> ${escapeHtml(v.paid_to || '—')}</div>
                <div style="grid-column:1/-1"><strong>Particulars:</strong> ${escapeHtml(v.description || '')}</div>
                <div style="grid-column:1/-1"><strong>Existing remarks:</strong> ${escapeHtml(v.remarks || '—')}</div>
            </div>
            <div class="form-group">
                <label>Party from Party Master *</label>
                <select class="form-control" id="pcAssignParty">
                    <option value="">— Select the correct party —</option>
                    ${parties.map(p => `<option value="${p.id}"${String(v.party_id) === String(p.id) ? ' selected' : ''}>${escapeHtml(p.name)} (${p.type || ''})</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Note for the audit trail (optional)</label>
                <input type="text" class="form-control" id="pcAssignNote" placeholder="e.g. verified against voucher book">
            </div>
            <div style="font-size:12px;color:var(--text-light);background:#fff8e1;border-left:4px solid #f0ad4e;padding:9px 12px;border-radius:5px">
                Only the party link changes. The voucher date, amount, voucher number and accounting values stay exactly as recorded.
                ${v.party_id ? 'This voucher is currently linked to a party — saving again corrects the assignment.' : ''}
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-warning" onclick="assignPettyParty(${v.id}, true)">Not related to a party</button>
            <button class="btn btn-primary" onclick="assignPettyParty(${v.id}, false)">💾 Save party</button>
        </div>
    `);
}

async function assignPettyParty(id, notRelated) {
    const partyId = document.getElementById('pcAssignParty')?.value || '';
    const note = document.getElementById('pcAssignNote')?.value || '';
    if (!notRelated && !partyId) { showToast('Select the correct party first', 'error'); return; }

    const result = await window.api.assignPettyCashParty({
        id,
        party_id: notRelated ? null : parseInt(partyId),
        not_related: !!notRelated,
        note
    });
    if (result.success) {
        closeModal();
        showToast(notRelated ? 'Voucher marked as not related to a party' : 'Party assigned to the voucher', 'success');
        renderPettyCash();
    } else {
        showToast(result.error || 'Could not save the assignment', 'error');
    }
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
        <table><thead><tr><th>Date</th><th>Voucher</th><th>Head</th><th>Description</th><th>Paid To</th><th>Party</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${data.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.voucher_no)}</td><td>${escapeHtml(e.expense_head)}</td><td>${escapeHtml(e.description||'')}</td><td>${escapeHtml(e.paid_to||'')}</td><td>${escapeHtml(e.party_name || (Number(e.party_review) === 2 ? 'Not related' : '—'))}</td><td class="text-right">${formatCurrency(e.amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.amount, 0))}</strong></td></tr></tfoot></table>
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
window.showPettyPartyAssign = showPettyPartyAssign;
window.assignPettyParty = assignPettyParty;
window.deletePettyCashEntry = deletePettyCashEntry;
window.printPettyCash = printPettyCash;
window.exportPettyCashPDF = exportPettyCashPDF;
