/**
 * Advance Register
 * ================
 * One screen for every advance the company has given a supplier or party.
 *
 *   Outstanding = Advance paid − Applied to bills − Returned
 *
 * Two sources, never a second system:
 *   • payments (transaction_type = 'advance') — the money actually paid
 *   • advance_allocations — an advance applied to a purchase bill
 *
 * An adjustment moves NO cash and books NO expense: it reduces the advance
 * asset and the bill's payable by the same amount. The backend enforces this;
 * this screen only orchestrates the existing IPC/HTTP endpoints.
 *
 * The recovery register below the new tables comes from
 * getAdvanceRecoveryRegister() — the same tagged ledger rows the Advance
 * Receivable balance is built from.
 */

let _advState = { as_of: '', from: '', data: null, advances: [], allocations: [], parties: [] };

async function renderAdvances() {
    const container = document.getElementById('page-advances');
    if (!_advState.as_of) _advState.as_of = today();

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAdvanceForm()">➕ Add Advance</button>
        <button class="btn btn-info btn-sm" onclick="advancesPrint()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="advancesCSV()">⬇ CSV</button>
    `;

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                <span style="font-size:12px;color:var(--text-light);font-weight:600">Quick range:</span>
                ${datePresetBar('advFrom', 'advTo', 'advancesLoad', ['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year', 'all'])}
            </div>
            <div class="filter-bar" style="margin:0">
                <div class="form-group"><label>From</label>
                    <input type="date" class="form-control" id="advFrom" data-no-default="1" value="${_advState.from || ''}"></div>
                <div class="form-group"><label>To (as of)</label>
                    <input type="date" class="form-control" id="advTo" value="${_advState.as_of}"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="advancesLoad()">Apply</button></div>
                <div class="form-group" style="flex:1"><label>&nbsp;</label>
                    <div style="font-size:12px;color:var(--text-light);padding-top:6px">
                        Record money paid with <strong>➕ Add Advance</strong>, apply it to a purchase bill with
                        <strong>Adjust</strong>. Advances never appear in the P&amp;L; an adjustment moves no cash.
                        Leave <em>From</em> empty for all history; <em>To</em> is the as-of cutoff.
                    </div></div>
            </div>
            ${reportLangPicker('Language / भाषा')}
        </div>
        <div id="advBalances"></div>
        <div id="advHistory"></div>
        <div id="advBody"><div class="loading" style="text-align:center;padding:40px">Loading advance register…</div></div>
    `;

    await advancesLoad();
}

async function advancesLoad() {
    const body = document.getElementById('advBody');
    if (!body) return;
    _advState.as_of = document.getElementById('advTo')?.value || _advState.as_of;
    _advState.from = document.getElementById('advFrom')?.value || '';

    const opts = { as_of: _advState.as_of };
    if (_advState.from) opts.from_date = _advState.from;

    const [register, advRes, allocRes, partyRes] = await Promise.all([
        window.api.getAdvanceRecoveryRegister(opts),
        window.api.getPayments({ transaction_type: 'advance' }),
        window.api.getAdvanceAllocations({}),
        window.api.getParties({})
    ]);

    if (!register || !register.success) {
        body.innerHTML = `<div style="padding:20px;color:var(--danger)">Could not load the advance register: ${escapeHtml((register && register.error) || 'unknown error')}</div>`;
        return;
    }
    _advState.data = register.data;
    _advState.advances = advRes.success ? (advRes.data || []) : [];
    _advState.allocations = allocRes.success ? (allocRes.data || []) : [];
    _advState.parties = partyRes.success ? (partyRes.data || []) : [];

    _advRenderBalances();
    _advRenderHistory();
    _advRender(register.data);
}

/** Applied amount for one advance payment. */
function _advApplied(advanceId) {
    return (_advState.allocations || [])
        .filter(a => Number(a.advance_payment_id) === Number(advanceId))
        .reduce((s, a) => s + (Number(a.amount) || 0), 0);
}

/** Per-party advance balance: paid − applied. */
function _advPartyBalances() {
    const map = new Map();
    for (const a of _advState.advances) {
        const key = a.party_id || ('name:' + (a.party_name || ''));
        const row = map.get(key) || {
            party_id: a.party_id, party_name: a.party_name || 'Unknown',
            paid: 0, applied: 0
        };
        row.paid += Number(a.amount) || 0;
        row.applied += _advApplied(a.id);
        map.set(key, row);
    }
    return [...map.values()]
        .map(r => ({ ...r, balance: Math.round((r.paid - r.applied) * 100) / 100 }))
        .sort((a, b) => b.balance - a.balance);
}

function _advRenderBalances() {
    const box = document.getElementById('advBalances');
    if (!box) return;
    const rows = _advPartyBalances();
    const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
    const totalApplied = rows.reduce((s, r) => s + r.applied, 0);
    box.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <h2>Advance Balance by Party</h2>
                <span style="font-size:12px;color:var(--text-light)">Balance = paid − applied to bills</span>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr>
                        <th>Party</th>
                        <th class="text-right">Advance Paid</th>
                        <th class="text-right">Applied to Bills</th>
                        <th class="text-right">Advance Balance</th>
                    </tr></thead>
                    <tbody>
                        ${rows.length ? rows.map(r => `
                            <tr>
                                <td>${escapeHtml(r.party_name)}</td>
                                <td class="text-right">${formatCurrency(r.paid)}</td>
                                <td class="text-right">${formatCurrency(r.applied)}</td>
                                <td class="text-right"><strong style="color:${r.balance > 0 ? 'var(--accent)' : 'var(--success, #16a34a)'}">${formatCurrency(r.balance)}</strong></td>
                            </tr>`).join('')
                            : '<tr><td colspan="4" style="text-align:center;padding:18px;color:var(--text-light)">No advances recorded yet.</td></tr>'}
                    </tbody>
                    ${rows.length ? `<tfoot><tr><td><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(totalPaid)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(totalApplied)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(totalPaid - totalApplied)}</strong></td></tr></tfoot>` : ''}
                </table>
            </div>
        </div>`;
}

function _advRefNo(a) {
    return a.bank_reference || ('ADV-' + a.id);
}

function _advRenderHistory() {
    const box = document.getElementById('advHistory');
    if (!box) return;
    const rows = _advState.advances;
    box.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="card-header">
                <h2>Advance Payments</h2>
                <button class="btn btn-success btn-sm" onclick="showAdvanceForm()">➕ Add Advance</button>
            </div>
            <div class="table-container" style="max-height:42vh;overflow:auto">
                <table>
                    <thead><tr>
                        <th>Date</th>
                        <th>Accounting Date</th>
                        <th>Party</th>
                        <th>Reference</th>
                        <th>Mode</th>
                        <th class="text-right">Advance</th>
                        <th class="text-right">Applied</th>
                        <th class="text-right">Balance</th>
                        <th>Remarks</th>
                        <th class="actions">Actions</th>
                    </tr></thead>
                    <tbody>
                        ${rows.length ? rows.map(a => {
                            const applied = _advApplied(a.id);
                            const balance = Math.round(((Number(a.amount) || 0) - applied) * 100) / 100;
                            return `
                            <tr>
                                <td>${formatDate(a.date)}</td>
                                <td>${formatDate(a.accounting_date || a.date)}</td>
                                <td>${escapeHtml(a.party_name || '—')}</td>
                                <td>${escapeHtml(_advRefNo(a))}</td>
                                <td>${escapeHtml(a.mode || 'cash')}</td>
                                <td class="text-right">${formatCurrency(a.amount)}</td>
                                <td class="text-right">${applied ? formatCurrency(applied) : '—'}</td>
                                <td class="text-right"><strong>${formatCurrency(balance)}</strong></td>
                                <td style="font-size:12px;color:var(--text-light)">${escapeHtml(a.notes || '')}</td>
                                <td class="actions" style="white-space:nowrap">
                                    <button class="btn btn-info btn-sm" title="View" onclick="showAdvanceDetails(${a.id})">👁</button>
                                    <button class="btn btn-secondary btn-sm" title="Edit" onclick="showAdvanceForm(${a.id})">✏️</button>
                                    <button class="btn btn-primary btn-sm" title="Adjust against a purchase bill" onclick="showAdvanceAdjust(${a.id})" ${balance <= 0.005 ? 'disabled' : ''}>⚖</button>
                                    <button class="btn btn-danger btn-sm" title="Delete" onclick="deleteAdvance(${a.id})">🗑</button>
                                </td>
                            </tr>`;
                        }).join('') : '<tr><td colspan="10" style="text-align:center;padding:22px;color:var(--text-light)">No advances paid yet — use ➕ Add Advance.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>`;
}

/** Party options for the advance form (suppliers first, then everyone). */
function _advPartyOptions(selectedId) {
    const parties = (_advState.parties || []).slice().sort((a, b) => {
        const rank = t => t === 'supplier' ? 0 : t === 'both' ? 1 : 2;
        return rank(a.type) - rank(b.type) || String(a.name).localeCompare(String(b.name));
    });
    return `<option value="">— Select party / supplier —</option>
        ${parties.map(p => `<option value="${p.id}"${String(selectedId) === String(p.id) ? ' selected' : ''}>${escapeHtml(p.name)} (${escapeHtml(p.type || '')})</option>`).join('')}`;
}

/** Add a new advance, or edit the non-money fields of an existing one. */
async function showAdvanceForm(id) {
    const existing = id ? (_advState.advances || []).find(a => Number(a.id) === Number(id)) : null;
    if (id && !existing) {
        // Not in the current list (e.g. page just opened) — fetch it.
        const res = await window.api.getPayments({ transaction_type: 'advance' });
        if (res.success) _advState.advances = res.data || [];
    }
    const a = existing || (_advState.advances || []).find(x => Number(x.id) === Number(id)) || null;
    const isEdit = !!a;
    const applied = isEdit ? _advApplied(a.id) : 0;

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? '✏️ Edit Advance' : '📥 Add Advance'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Party / Supplier *</label>
                <select class="form-control" id="advParty" ${isEdit ? 'disabled' : ''}>
                    ${_advPartyOptions(a && a.party_id)}
                </select>
                ${isEdit ? '<small style="color:var(--text-light)">The party of an existing advance cannot be changed — delete and re-enter it instead.</small>' : ''}
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Transaction Date *</label>
                    <input type="date" class="form-control" id="advDate" value="${a ? a.date : today()}">
                </div>
                <div class="form-group">
                    <label>Accounting / Effective Date</label>
                    <input type="date" class="form-control" id="advAccountingDate" value="${a ? (a.accounting_date || a.date) : today()}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Amount (Rs) *</label>
                    <input type="number" class="form-control" id="advAmount" min="0.01" step="0.01" value="${a ? a.amount : ''}" ${isEdit ? 'disabled' : ''}>
                    ${isEdit ? `<small style="color:var(--text-light)">${applied > 0 ? `Already applied ${formatCurrency(applied)} — the amount is locked.` : 'Amount cannot be changed here.'}</small>` : ''}
                </div>
                <div class="form-group">
                    <label>Payment Method *</label>
                    <select class="form-control" id="advMode">
                        <option value="cash" ${a && a.mode === 'cash' ? 'selected' : ''}>💵 Cash</option>
                        <option value="bank" ${a && a.mode === 'bank' ? 'selected' : ''}>🏦 Bank</option>
                        <option value="upi" ${a && a.mode === 'upi' ? 'selected' : ''}>📱 UPI</option>
                        <option value="cheque" ${a && a.mode === 'cheque' ? 'selected' : ''}>📄 Cheque</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Reference Number</label>
                <input type="text" class="form-control" id="advRef" value="${a ? escapeHtml(a.bank_reference || '') : ''}" placeholder="voucher / cheque / UPI reference">
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <input type="text" class="form-control" id="advNotes" value="${a ? escapeHtml(a.notes || '') : ''}" placeholder="why this advance was paid">
            </div>
            <div style="background:var(--bg);border-radius:6px;padding:10px 14px;font-size:12px;color:var(--text-light)">
                ℹ️ An advance is a balance-sheet asset: it is <strong>not</strong> a purchase and <strong>not</strong> an expense.
                Money leaves Cash/Bank once, now. It is applied to a bill later with <strong>Adjust</strong> — that step moves no cash.
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveAdvance(${isEdit ? a.id : 'null'})">💾 ${isEdit ? 'Update' : 'Save Advance'}</button>
        </div>
    `);
}

async function saveAdvance(id) {
    const partyId = document.getElementById('advParty')?.value || '';
    const date = document.getElementById('advDate')?.value || '';
    const accountingDate = document.getElementById('advAccountingDate')?.value || date;
    const amount = parseFloat(document.getElementById('advAmount')?.value || 0);
    const mode = document.getElementById('advMode')?.value || 'cash';
    const ref = document.getElementById('advRef')?.value?.trim() || '';
    const notes = document.getElementById('advNotes')?.value?.trim() || '';

    if (!date) { showToast('Transaction date is required', 'error'); return; }
    if (!id && !partyId) { showToast('Select the party / supplier', 'error'); return; }
    if (!id && !(amount > 0)) { showToast('Amount must be greater than zero', 'error'); return; }
    if (!id) {
        const advances = _advState.advances || [];
        const party = (_advState.parties || []).find(p => String(p.id) === String(partyId));
        // Same money, same day, same reference: almost always a double click
        // or a duplicate entry. Ask before saving it twice.
        const twin = advances.find(a => String(a.party_id) === String(partyId)
            && a.date === date
            && Math.abs((Number(a.amount) || 0) - amount) < 0.005
            && String(a.bank_reference || '') === ref);
        if (twin) {
            const ok = await confirmAction(
                `An identical advance of ${formatCurrency(amount)} to ${party ? party.name : 'this party'} on ${date} already exists (${_advRefNo(twin)}).`,
                'Save another one anyway?'
            );
            if (!ok) return;
        }
    }

    let result;
    if (id) {
        result = await window.api.updatePayment({
            id,
            date,
            accounting_date: accountingDate,
            mode,
            notes,
            bank_reference: ref,
            transaction_type: 'advance'
        });
    } else {
        result = await window.api.savePayment({
            party_id: parseInt(partyId),
            date,
            accounting_date: accountingDate,
            type: 'payment',
            transaction_type: 'advance',
            amount,
            mode,
            notes,
            bank_reference: ref
        });
    }

    if (result.success) {
        closeModal();
        showToast(id ? 'Advance updated' : 'Advance recorded', 'success');
        await advancesLoad();
    } else {
        showToast(result.error || 'Could not save the advance', 'error');
    }
}

/** Read-only view of one advance and everything applied against it. */
function showAdvanceDetails(id) {
    const a = (_advState.advances || []).find(x => Number(x.id) === Number(id));
    if (!a) { showToast('Advance not found', 'warning'); return; }
    const applied = _advApplied(a.id);
    const allocations = (_advState.allocations || []).filter(x => Number(x.advance_payment_id) === Number(a.id));
    showModal(`
        <div class="modal-header">
            <h2>📥 Advance ${escapeHtml(_advRefNo(a))}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:13px;background:var(--bg);padding:12px;border-radius:6px;margin-bottom:14px">
                <div><strong>Party:</strong> ${escapeHtml(a.party_name || '—')}</div>
                <div><strong>Amount:</strong> ${formatCurrency(a.amount)}</div>
                <div><strong>Transaction date:</strong> ${formatDate(a.date)}</div>
                <div><strong>Accounting date:</strong> ${formatDate(a.accounting_date || a.date)}</div>
                <div><strong>Mode:</strong> ${escapeHtml(a.mode || 'cash')}</div>
                <div><strong>Applied:</strong> ${formatCurrency(applied)}</div>
                <div><strong>Balance:</strong> ${formatCurrency((Number(a.amount) || 0) - applied)}</div>
                <div><strong>Remarks:</strong> ${escapeHtml(a.notes || '—')}</div>
            </div>
            <h3 style="font-size:14px;margin:0 0 6px">Applied to bills</h3>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Purchase Bill</th><th class="text-right">Amount</th><th>Notes</th></tr></thead>
                    <tbody>
                        ${allocations.length ? allocations.map(x => {
                            const bill = (_advState.purchasesById || {})[x.purchase_id];
                            return `<tr><td>${formatDate(x.date)}</td>
                                <td>#${x.purchase_id}${bill ? ' — ' + escapeHtml(bill.bill_no || '') : ''}</td>
                                <td class="text-right">${formatCurrency(x.amount)}</td>
                                <td style="font-size:12px;color:var(--text-light)">${escapeHtml(x.notes || '')}</td></tr>`;
                        }).join('') : '<tr><td colspan="4" style="text-align:center;padding:16px;color:var(--text-light)">Not applied to any bill yet.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="closeModal();showAdvanceAdjust(${a.id})">⚖ Adjust against a bill</button>
        </div>
    `);
}

/** Apply an advance to one open purchase bill of the same party. */
async function showAdvanceAdjust(id) {
    const a = (_advState.advances || []).find(x => Number(x.id) === Number(id));
    if (!a) { showToast('Advance not found', 'warning'); return; }
    const available = Math.round(((Number(a.amount) || 0) - _advApplied(a.id)) * 100) / 100;
    if (available <= 0.005) { showToast('This advance is fully applied', 'warning'); return; }

    const res = await window.api.getPurchases({ party_id: a.party_id });
    const bills = (res.success ? (res.data || []) : [])
        .map(b => {
            const total = Number(b.grand_total) || 0;
            const paid = Number(b.paid_amount) || 0;
            return { ...b, outstanding: Math.round((total - paid) * 100) / 100 };
        })
        .filter(b => b.outstanding > 0.005);
    _advState.purchasesById = Object.fromEntries(bills.map(b => [b.id, b]));

    showModal(`
        <div class="modal-header">
            <h2>⚖ Adjust Advance — ${escapeHtml(a.party_name || '')}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="background:var(--bg);border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;display:flex;gap:22px;flex-wrap:wrap">
                <span><strong>Advance:</strong> ${formatCurrency(a.amount)}</span>
                <span><strong>Already applied:</strong> ${formatCurrency(_advApplied(a.id))}</span>
                <span><strong>Available:</strong> <strong style="color:var(--accent)">${formatCurrency(available)}</strong></span>
            </div>
            ${bills.length ? `
            <div class="form-group">
                <label>Open purchase bill *</label>
                <select class="form-control" id="advAdjBill" onchange="advanceAdjustBillChanged(${available})">
                    <option value="">— Select a bill with an outstanding balance —</option>
                    ${bills.map(b => `<option value="${b.id}" data-outstanding="${b.outstanding}">${escapeHtml(b.bill_no || ('#' + b.id))} · ${formatDate(b.date)} · outstanding ${formatCurrency(b.outstanding)}</option>`).join('')}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Adjustment Date *</label>
                    <input type="date" class="form-control" id="advAdjDate" value="${today()}">
                </div>
                <div class="form-group">
                    <label>Accounting / Effective Date</label>
                    <input type="date" class="form-control" id="advAdjAccountingDate" value="${today()}">
                </div>
            </div>
            <div class="form-group">
                <label>Amount to apply (Rs) *</label>
                <input type="number" class="form-control" id="advAdjAmount" min="0.01" step="0.01" value="">
                <small style="color:var(--text-light)">Cannot exceed the available advance or the bill’s outstanding amount.</small>
            </div>
            <div class="form-group">
                <label>Notes</label>
                <input type="text" class="form-control" id="advAdjNotes" placeholder="e.g. adjusted against bill 1042">
            </div>
            <div style="background:#eef7ff;border-left:4px solid #2b6cb0;border-radius:6px;padding:10px 14px;font-size:12px">
                <strong>No new payment is created.</strong> This reduces the advance by the same amount as the bill’s payable.
                Cash and bank do not move, and no expense is booked a second time.
            </div>` : `
            <div style="background:#fff8e1;border-left:4px solid #f0ad4e;border-radius:6px;padding:12px 14px">
                <strong>No open purchase bill for ${escapeHtml(a.party_name || 'this party')}.</strong><br>
                An advance can only be applied to a bill of the same party that still has an outstanding balance.
                Record the purchase bill first, then come back to Adjust.
            </div>`}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            ${bills.length ? `<button class="btn btn-primary" onclick="saveAdvanceAdjust(${a.id}, ${available})">💾 Apply Advance</button>` : ''}
        </div>
    `);
}

function advanceAdjustBillChanged(available) {
    const sel = document.getElementById('advAdjBill');
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    const outstanding = opt ? Number(opt.dataset.outstanding) || 0 : 0;
    const input = document.getElementById('advAdjAmount');
    if (!input) return;
    if (outstanding > 0) {
        input.value = Math.min(available, outstanding).toFixed(2);
        input.max = Math.min(available, outstanding).toFixed(2);
    }
}

async function saveAdvanceAdjust(advanceId, available) {
    const billId = document.getElementById('advAdjBill')?.value;
    const amount = parseFloat(document.getElementById('advAdjAmount')?.value || 0);
    const date = document.getElementById('advAdjDate')?.value || today();
    const accountingDate = document.getElementById('advAdjAccountingDate')?.value || date;
    const notes = document.getElementById('advAdjNotes')?.value || '';

    if (!billId) { showToast('Select the purchase bill to settle', 'error'); return; }
    if (!(amount > 0)) { showToast('Amount must be greater than zero', 'error'); return; }
    if (amount > available + 0.005) { showToast(`Only ${formatCurrency(available)} of this advance is available`, 'error'); return; }

    const result = await window.api.allocateAdvance({
        advance_payment_id: advanceId,
        purchase_id: parseInt(billId),
        amount,
        date,
        accounting_date: accountingDate,
        notes
    });
    if (result.success) {
        closeModal();
        showToast('Advance applied to the bill — no cash moved', 'success');
        await advancesLoad();
    } else {
        showToast(result.error || 'Could not apply the advance', 'error');
    }
}

async function deleteAdvance(id) {
    const a = (_advState.advances || []).find(x => Number(x.id) === Number(id));
    const applied = _advApplied(id);
    if (applied > 0.005) {
        showToast('This advance is already applied to a bill and cannot be deleted', 'error');
        return;
    }
    const ok = await confirmAction(
        `Delete this advance of ${formatCurrency(a ? a.amount : 0)}${a && a.party_name ? ' to ' + a.party_name : ''}?`,
        'The cash/bank payment and its party-ledger line are removed. This cannot be undone.'
    );
    if (!ok) return;
    const result = await window.api.deletePayment(id);
    if (result.success) {
        showToast('Advance deleted', 'success');
        await advancesLoad();
    } else {
        showToast(result.error || 'Could not delete the advance', 'error');
    }
}

function _advBucketBadge(bucket) {
    if (bucket === 'settled') return '<span class="badge badge-success">Settled</span>';
    if (bucket === 'current') return '<span class="badge badge-info">Current</span>';
    const cls = bucket === '90+' ? 'badge-danger' : bucket === '60+' ? 'badge-danger' : 'badge-warning';
    return `<span class="badge ${cls}">${bucket} days</span>`;
}

function _advRender(d) {
    const body = document.getElementById('advBody');
    if (!body) return;
    const s = d.summary;
    const checksOk = d.all_checks_ok;

    const lotRows = d.lots.map(l => `
        <tr>
            <td>${formatDate(l.date)}</td>
            <td>${escapeHtml(l.party_name)}</td>
            <td class="text-right">${formatCurrency(l.advance)}</td>
            <td class="text-right" style="color:var(--text-light)">${l.adjusted ? formatCurrency(l.adjusted) : '—'}</td>
            <td class="text-right" style="color:var(--text-light)">${l.returned ? formatCurrency(l.returned) : '—'}</td>
            <td class="text-right" style="font-weight:700;color:${l.outstanding > 0 ? 'var(--danger)' : 'var(--success, #16a34a)'}">${formatCurrency(l.outstanding)}</td>
            <td class="text-right">${l.age_days}</td>
            <td>${_advBucketBadge(l.due_status)}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Outstanding Advances</span>
                <span class="value" style="font-size:22px">${formatCurrency(s.total_outstanding)}</span>
                <span class="sub">${s.open_advances} open advance(s) as of ${formatDate(d.as_of)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Current (0–6 days)</span>
                <span class="value" style="font-size:22px">${formatCurrency(s.current)}</span>
                <span class="sub">Overdue 7+ days: <strong>${formatCurrency(s.overdue)}</strong></span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Aging 30+ / 60+</span>
                <span class="value" style="font-size:20px">${formatCurrency(s.bucket_30)} / ${formatCurrency(s.bucket_60)}</span>
                <span class="sub">90+ days: <strong>${formatCurrency(s.bucket_90)}</strong></span>
            </div>
            <div class="summary-card ${checksOk ? 'card-success' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">Given → Recovered</span>
                <span class="value" style="font-size:18px">${checksOk ? '✅ Reconciled' : '⚠️ Mismatch'}</span>
                <span class="sub">Given ${formatCurrency(s.advance_given)} = Returned ${formatCurrency(s.returned)} + Adjusted ${formatCurrency(s.adjusted)} + Outstanding ${formatCurrency(s.total_outstanding)}</span>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Advance Recovery Register</h2>
                <span style="font-size:12px;color:var(--text-light)">As of ${formatDate(d.as_of)} · advances are balance-sheet only, never P&amp;L</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th><th>Party / Person</th>
                            <th class="text-right">Advance</th>
                            <th class="text-right">Adjusted</th>
                            <th class="text-right">Returned</th>
                            <th class="text-right">Outstanding</th>
                            <th class="text-right">Age (days)</th>
                            <th>Due Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${d.lots.length ? lotRows
                            : '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No advances given — nothing is tied up.</td></tr>'}
                    </tbody>
                    ${d.lots.length ? `<tfoot>
                        <tr style="font-weight:700;background:var(--bg)">
                            <td colspan="2">Totals</td>
                            <td class="text-right">${formatCurrency(s.advance_given)}</td>
                            <td class="text-right">${formatCurrency(s.adjusted)}</td>
                            <td class="text-right">${formatCurrency(s.returned)}</td>
                            <td class="text-right">${formatCurrency(s.total_outstanding)}</td>
                            <td colspan="2"></td>
                        </tr></tfoot>` : ''}
                </table>
            </div>
        </div>

        <div class="card" style="margin-top:16px">
            <div class="card-header"><h2>Recovery movements</h2></div>
            <div class="table-container" style="max-height:30vh;overflow:auto">
                <table>
                    <thead><tr><th>Date</th><th>Party</th><th>Movement</th><th>Particular</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        ${d.movements.length ? d.movements.map(m => `
                            <tr>
                                <td>${formatDate(m.date)}</td>
                                <td>${escapeHtml(m.party_name)}</td>
                                <td>${m.kind === 'given' ? '📥 Advance given' : m.kind === 'returned' ? '↩ Returned' : '⚡ Adjusted'}</td>
                                <td style="font-size:12px;color:var(--text-light)">${escapeHtml(m.particular || '')}</td>
                                <td class="text-right">${formatCurrency(m.amount)}</td>
                            </tr>`).join('')
                            : '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-light)">No movements.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="card" style="margin-top:16px">
            <div class="card-header"><h2>Reconciliation</h2></div>
            <div style="padding:10px 14px">
                ${(d.checks || []).map(c => `
                    <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
                        <span>${c.ok ? '✅' : '❌'} ${escapeHtml(c.name)}</span>
                        <span style="font-family:monospace">${formatCurrency(c.expected)} ${c.ok ? '=' : '≠'} ${formatCurrency(c.actual)}</span>
                    </div>`).join('')}
            </div>
        </div>
    `;
}

async function advancesPrint() {
    const d = _advState.data;
    if (!d || !d.lots.length) { showToast('No advances to print', 'warning'); return; }
    const settings = await getSettingsCached();
    const esc = v => escapeHtml(v == null ? '' : String(v));
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1>
            <h2>Advance Recovery Register — as of ${formatDate(d.as_of)}</h2></div>
        <table><thead><tr><th>Date</th><th>Party</th><th style="text-align:right">Advance</th>
            <th style="text-align:right">Adjusted</th><th style="text-align:right">Returned</th>
            <th style="text-align:right">Outstanding</th><th>Due Status</th></tr></thead>
        <tbody>
            ${d.lots.map(l => `<tr><td>${esc(l.date)}</td><td>${esc(l.party_name)}</td>
                <td style="text-align:right">${formatCurrency(l.advance)}</td>
                <td style="text-align:right">${formatCurrency(l.adjusted)}</td>
                <td style="text-align:right">${formatCurrency(l.returned)}</td>
                <td style="text-align:right">${formatCurrency(l.outstanding)}</td>
                <td>${esc(l.due_status)}</td></tr>`).join('')}
        </tbody>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>`;
    printHTML(html);
}

function advancesCSV() {
    const d = _advState.data;
    if (!d || !d.lots.length) { showToast('No advances to export', 'warning'); return; }
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Date', 'Party', 'Advance', 'Adjusted', 'Returned', 'Outstanding', 'Age Days', 'Due Status'].map(esc).join(',')];
    for (const l of d.lots) {
        lines.push([l.date, l.party_name, l.advance, l.adjusted, l.returned, l.outstanding, l.age_days, l.due_status].map(esc).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Advance_Recovery_Register_${d.as_of}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Globals
window.renderAdvances = renderAdvances;
window.advancesLoad = advancesLoad;
window.advancesPrint = advancesPrint;
window.advancesCSV = advancesCSV;
window.showAdvanceForm = showAdvanceForm;
window.saveAdvance = saveAdvance;
window.showAdvanceDetails = showAdvanceDetails;
window.showAdvanceAdjust = showAdvanceAdjust;
window.advanceAdjustBillChanged = advanceAdjustBillChanged;
window.saveAdvanceAdjust = saveAdvanceAdjust;
window.deleteAdvance = deleteAdvance;
