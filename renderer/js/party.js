/**
 * Party / Ledger Module
 * Manage customers, suppliers, and financial ledger records
 */

let partyFilter = { search: '', type: '' };

async function renderParties() {
    const container = document.getElementById('page-parties');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading parties...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary" onclick="showPartyForm()">+ New Party</button>
        <button class="btn btn-info" onclick="printPartiesList()">🖨 Print</button>
        <button class="btn btn-primary" onclick="exportPartiesPDF()">📄 PDF</button>
    `;

    const result = await window.api.getParties(partyFilter);
    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load parties: ${result.error}</div>`;
        return;
    }

    const parties = result.data;

    // Calculate outstanding for each party
    const receivablesResult = await window.api.getReceivables();
    const payablesResult = await window.api.getPayables();
    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];

    const outstandingMap = {};
    receivables.forEach(r => {
        outstandingMap[r.id] = { receivable: r.outstanding, payable: 0 };
    });
    payables.forEach(p => {
        if (!outstandingMap[p.id]) outstandingMap[p.id] = { receivable: 0, payable: 0 };
        outstandingMap[p.id].payable = (outstandingMap[p.id].payable || 0) + p.outstanding;
    });

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Search</label>
                    <input type="text" class="form-control" id="partySearch" placeholder="Name or Phone..." value="${escapeHtml(partyFilter.search)}">
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select class="form-control" id="partyType">
                        <option value="">All Types</option>
                        <option value="customer" ${partyFilter.type === 'customer' ? 'selected' : ''}>Customer</option>
                        <option value="supplier" ${partyFilter.type === 'supplier' ? 'selected' : ''}>Supplier</option>
                        <option value="both" ${partyFilter.type === 'both' ? 'selected' : ''}>Both</option>
                        <option value="farmer" ${partyFilter.type === 'farmer' ? 'selected' : ''}>🧑‍🌾 Farmer</option>
                        <option value="partner" ${partyFilter.type === 'partner' ? 'selected' : ''}>🤝 Partner</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary" onclick="applyPartyFilter()">Filter</button>
                    <button class="btn btn-secondary" onclick="resetPartyFilter()">Reset</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Parties (${parties.length})</h2>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Phone</th>
                            <th>Type</th>
                            <th>Route/Details</th>
                            <th class="text-right">Opening Balance</th>
                            <th class="text-right">Outstanding</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${parties.length === 0
                            ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No parties found</td></tr>'
                            : parties.map(p => {
                                const out = outstandingMap[p.id];
                                let detailHtml = '-';
                                if (p.type === 'farmer') {
                                    detailHtml = escapeHtml(p.route_name || '') || '<span style="color:var(--text-light)">No route</span>';
                                } else if (p.type === 'partner') {
                                    const ptype = p.partner_type || 'active';
                                    const share = p.profit_share_percent ? p.profit_share_percent + '%' : '';
                                    detailHtml = `<span class="badge ${ptype === 'active' ? 'badge-success' : 'badge-info'}">${escapeHtml(ptype)}</span> ${share ? share : ''}`;
                                }
                                return `
                                    <tr>
                                        <td><strong>${escapeHtml(p.name)}</strong></td>
                                        <td>${escapeHtml(p.phone || '-')}</td>
                                        <td><span class="badge ${p.type === 'customer' ? 'badge-info' : p.type === 'supplier' ? 'badge-warning' : p.type === 'farmer' ? 'badge-success' : p.type === 'partner' ? 'badge-primary' : 'badge-secondary'}">${escapeHtml(p.type)}</span></td>
                                        <td style="font-size:12px">${detailHtml}</td>
                                        <td class="text-right ${p.opening_balance > 0 ? 'positive' : p.opening_balance < 0 ? 'negative' : ''}">${formatCurrency(p.opening_balance)}</td>
                                        <td class="text-right">
                                            ${out ? (out.receivable > 0 && out.payable > 0
                                                ? `<span style="color:var(--accent)">Dr ${formatCurrency(out.receivable)}</span> / <span style="color:var(--danger)">Cr ${formatCurrency(out.payable)}</span>`
                                                : out.receivable > 0
                                                    ? `<span style="color:var(--accent)">${formatCurrency(out.receivable)} (Dr)</span>`
                                                    : out.payable > 0
                                                        ? `<span style="color:var(--danger)">${formatCurrency(out.payable)} (Cr)</span>`
                                                        : '-'
                                            ) : '-'}
                                        </td>
                                        <td class="actions">
                                            <button class="btn btn-info btn-sm" onclick="viewLedger(${p.id})" title="Ledger">📒</button>
                                            <button class="btn btn-primary btn-sm" onclick="editParty(${p.id})" title="Edit">✏️</button>
                                            <button class="btn btn-danger btn-sm" onclick="deleteParty(${p.id})" title="Delete">🗑</button>
                                        </td>
                                    </tr>
                                `;
                            }).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>

        <style>
            .positive { color: var(--accent); }
            .negative { color: var(--danger); }
        </style>
    `;

    document.getElementById('partySearch')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applyPartyFilter();
    });
}

function applyPartyFilter() {
    partyFilter.search = document.getElementById('partySearch')?.value || '';
    partyFilter.type = document.getElementById('partyType')?.value || '';
    renderParties();
}

function resetPartyFilter() {
    partyFilter = { search: '', type: '' };
    renderParties();
}

// ============================================================
// Party Form (Extended: farmer/partner support)
// ============================================================
async function showPartyForm(partyId = null) {
    let party = null;
    if (partyId) {
        const result = await window.api.getParty(partyId);
        if (result.success) party = result.data;
    }

    const isEdit = !!party;

    // Load routes for farmer type
    const routesResult = await window.api.getRoutes({});
    const routes = routesResult.success ? routesResult.data : [];

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Party' : 'New Party'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <form id="partyForm">
                <div class="form-group">
                    <label>Party Name *</label>
                    <input type="text" class="form-control" name="name" value="${escapeHtml(party ? party.name : '')}" required autofocus>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Phone</label>
                        <input type="text" class="form-control" name="phone" value="${escapeHtml(party ? party.phone : '')}">
                    </div>
                    <div class="form-group">
                        <label>PAN / VAT</label>
                        <input type="text" class="form-control" name="pan_vat" value="${escapeHtml(party ? party.pan_vat : '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Address</label>
                    <textarea class="form-control" name="address">${escapeHtml(party ? party.address : '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Type</label>
                        <select class="form-control" name="type" id="partyTypeSelect" onchange="togglePartyExtraFields()">
                            <option value="customer" ${(!party || party.type === 'customer') ? 'selected' : ''}>Customer</option>
                            <option value="supplier" ${party && party.type === 'supplier' ? 'selected' : ''}>Supplier</option>
                            <option value="both" ${party && party.type === 'both' ? 'selected' : ''}>Both (Customer & Supplier)</option>
                            <option value="farmer" ${party && party.type === 'farmer' ? 'selected' : ''}>🧑‍🌾 Farmer / Milk Producer</option>
                            <option value="partner" ${party && party.type === 'partner' ? 'selected' : ''}>🤝 Partner / Investor</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Opening Balance</label>
                        <input type="number" class="form-control" name="opening_balance" value="${party ? party.opening_balance : 0}" step="0.01">
                        <small style="color:var(--text-light)">Positive = receivable (due from them)</small>
                    </div>
                </div>

                <!-- Farmer Fields -->
                <div id="partyFarmerFields" ${!party || party.type !== 'farmer' ? 'style="display:none"' : ''}>
                    <div class="form-section-title">🧑‍🌾 Farmer Details</div>
                    <div class="form-group">
                        <label>Route / Collection Center</label>
                        <select class="form-control" name="route_id">
                            <option value="">-- No Route --</option>
                            ${routes.map(r => `<option value="${r.id}" ${party && party.route_id === r.id ? 'selected' : ''}>${escapeHtml(r.name)} ${r.area ? '(' + escapeHtml(r.area) + ')' : ''}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Partner Fields -->
                <div id="partyPartnerFields" ${!party || party.type !== 'partner' ? 'style="display:none"' : ''}>
                    <div class="form-section-title">🤝 Partner Details</div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Partner Type</label>
                            <select class="form-control" name="partner_type">
                                <option value="active" ${!party || party.partner_type === 'active' ? 'selected' : ''}>Active Partner</option>
                                <option value="silent" ${party && party.partner_type === 'silent' ? 'selected' : ''}>Silent Partner</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Profit Share %</label>
                            <input type="number" class="form-control" name="profit_share_percent" value="${party ? party.profit_share_percent || 0 : 0}" min="0" max="100" step="0.1">
                        </div>
                    </div>
                </div>

                <div class="form-group" style="margin-top:12px">
                    <label>Notes</label>
                    <textarea class="form-control" name="notes">${escapeHtml(party ? party.notes : '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveParty(${partyId || ''})">💾 ${isEdit ? 'Update Party' : 'Save Party'}</button>
        </div>
    `);
}

function togglePartyExtraFields() {
    const type = document.getElementById('partyTypeSelect')?.value || 'customer';
    const farmerFields = document.getElementById('partyFarmerFields');
    const partnerFields = document.getElementById('partyPartnerFields');
    if (farmerFields) farmerFields.style.display = type === 'farmer' ? 'block' : 'none';
    if (partnerFields) partnerFields.style.display = type === 'partner' ? 'block' : 'none';
}

async function saveParty(partyId) {
    const form = document.getElementById('partyForm');
    const formData = new FormData(form);

    if (!formData.get('name')) {
        showToast('Party name is required', 'error');
        return;
    }

    const type = formData.get('type') || 'customer';
    const data = {
        id: partyId || null,
        name: formData.get('name'),
        phone: formData.get('phone'),
        address: formData.get('address'),
        pan_vat: formData.get('pan_vat'),
        type: type,
        opening_balance: parseFloat(formData.get('opening_balance') || 0),
        notes: formData.get('notes'),
        route_id: type === 'farmer' ? (formData.get('route_id') ? parseInt(formData.get('route_id')) : null) : null,
        partner_type: type === 'partner' ? (formData.get('partner_type') || 'active') : '',
        profit_share_percent: type === 'partner' ? parseFloat(formData.get('profit_share_percent') || 0) : 0
    };

    const result = await window.api.saveParty(data);
    if (result.success) {
        showToast(`Party ${partyId ? 'updated' : 'created'} successfully!`);
        closeModal();
        renderParties();
        clearSettingsCache();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

async function editParty(id) { showPartyForm(id); }

async function deleteParty(id) {
    const result = await window.api.getParty(id);
    if (!result.success) return;

    const confirmed = await confirmAction(
        `Delete "${result.data.name}"?`,
        'This party will be permanently removed.'
    );

    if (!confirmed) return;

    const delResult = await window.api.deleteParty(id);
    if (delResult.success) {
        showToast('Party deleted');
        renderParties();
    } else {
        showToast(`Error: ${delResult.error}`, 'error');
    }
}

// ============================================================
// Ledger View
// ============================================================
async function viewLedger(partyId, fromDate = '', toDate = '') {
    const result = await window.api.getLedger({ party_id: partyId, from_date: fromDate, to_date: toDate });
    if (!result.success) {
        showToast('Failed to load ledger', 'error');
        return;
    }

    const { entries, party } = result.data;
    if (!party) return;

    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';

    let totalDebit = 0, totalCredit = 0;
    entries.forEach(e => { totalDebit += e.debit; totalCredit += e.credit; });
    const balance = entries.length > 0 ? entries[entries.length - 1].balance : (party.opening_balance || 0);

    showModal(`
        <div class="modal-header">
            <h2>Ledger: ${escapeHtml(party.name)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="text-align:center;margin-bottom:16px">
                <h3 style="color:var(--primary)">${escapeHtml(businessName)}</h3>
                <p style="font-size:12px;color:var(--text-light)">${escapeHtml(party.address || '')} | ${escapeHtml(party.phone || '')}</p>
            </div>

            <div class="ledger-summary">
                <div class="ledger-stat">
                    <div class="stat-label">Total Debit</div>
                    <div class="stat-value positive">${formatCurrency(totalDebit)}</div>
                </div>
                <div class="ledger-stat">
                    <div class="stat-label">Total Credit</div>
                    <div class="stat-value negative">${formatCurrency(totalCredit)}</div>
                </div>
                <div class="ledger-stat">
                    <div class="stat-label">Running Balance</div>
                    <div class="stat-value ${balance >= 0 ? 'positive' : 'negative'}">${formatCurrency(Math.abs(balance))}</div>
                    <div style="font-size:11px;color:var(--text-light)">${balance >= 0 ? 'They owe you' : 'You owe them'}</div>
                </div>
            </div>

            <div class="filter-bar" style="margin-bottom:12px">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="ledgerFrom" value="${fromDate}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="ledgerTo" value="${toDate}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="filterLedger(${partyId})">Filter</button>
                </div>
            </div>

            <div class="table-container" style="max-height:400px;overflow-y:auto">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Description</th>
                            <th class="text-right">Debit (Dr)</th>
                            <th class="text-right">Credit (Cr)</th>
                            <th class="text-right">Balance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${entries.length === 0
                            ? '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-light)">No ledger entries found</td></tr>'
                            : entries.map(e => `
                                <tr>
                                    <td>${formatDate(e.date)}</td>
                                    <td>
                                        ${escapeHtml(e.description)}
                                        <span style="font-size:11px;color:var(--text-light)">(${escapeHtml(e.reference_type)})</span>
                                    </td>
                                    <td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                                    <td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                                    <td class="text-right"><strong>${formatCurrency(e.balance)}</strong></td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printLedger(${partyId}, '${fromDate}', '${toDate}')">🖨 Print</button>
            <button class="btn btn-primary" onclick="exportLedgerPDF(${partyId}, '${fromDate}', '${toDate}')">📄 Export PDF</button>
        </div>
    `);
}

function filterLedger(partyId) {
    const from = document.getElementById('ledgerFrom')?.value || '';
    const to = document.getElementById('ledgerTo')?.value || '';
    viewLedger(partyId, from, to);
}

// ============================================================
// Print / PDF Ledger
// ============================================================
async function printLedger(partyId, fromDate, toDate) {
    const result = await window.api.getLedger({ party_id: partyId, from_date: fromDate, to_date: toDate });
    if (!result.success) return;
    const { entries, party } = result.data;
    if (!party) return;

    const settings = await getSettingsCached();
    let totalDebit = 0, totalCredit = 0;
    entries.forEach(e => { totalDebit += e.debit; totalCredit += e.credit; });
    const balance = entries.length > 0 ? entries[entries.length - 1].balance : 0;

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2 style="font-size:14px">Ledger Statement: ${escapeHtml(party.name)}</h2>
            <p>${escapeHtml(party.address || '')} | ${escapeHtml(party.phone || '')}</p>
            <p>Period: ${fromDate || 'From start'} to ${toDate || 'Today'}</p>
        </div>
        <div style="display:flex;gap:20px;margin:10px 0">
            <span><strong>Total Debit:</strong> ${formatCurrency(totalDebit)}</span>
            <span><strong>Total Credit:</strong> ${formatCurrency(totalCredit)}</span>
            <span><strong>Balance:</strong> ${formatCurrency(Math.abs(balance))} ${balance >= 0 ? '(Dr)' : '(Cr)'}</span>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Description</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                ${entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.balance)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportLedgerPDF(partyId, fromDate, toDate) {
    const result = await window.api.getLedger({ party_id: partyId, from_date: fromDate, to_date: toDate });
    if (!result.success) return;
    const { entries, party } = result.data;
    if (!party) return;

    const settings = await getSettingsCached();
    let totalDebit = 0, totalCredit = 0;
    entries.forEach(e => { totalDebit += e.debit; totalCredit += e.credit; });
    const balance = entries.length > 0 ? entries[entries.length - 1].balance : 0;

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2 style="font-size:14px">Ledger Statement: ${escapeHtml(party.name)}</h2>
            <p>Period: ${fromDate || 'Start'} to ${toDate || 'Today'}</p>
        </div>
        <div style="display:flex;gap:20px;margin:10px 0">
            <span><strong>Total Debit:</strong> ${formatCurrency(totalDebit)}</span>
            <span><strong>Total Credit:</strong> ${formatCurrency(totalCredit)}</span>
            <span><strong>Balance:</strong> ${formatCurrency(Math.abs(balance))}</span>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Description</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                ${entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.balance)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;

    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved to: ${pdfResult.path}`);
}

// ============================================================
// Print / PDF Parties List
// ============================================================
async function printPartiesList() {
    const result = await window.api.getParties(partyFilter);
    if (!result.success) return;
    const parties = result.data;

    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);
    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];

    const outstandingMap = {};
    receivables.forEach(r => { outstandingMap[r.id] = { receivable: r.outstanding, payable: 0 }; });
    payables.forEach(p => {
        if (!outstandingMap[p.id]) outstandingMap[p.id] = { receivable: 0, payable: 0 };
        outstandingMap[p.id].payable = (outstandingMap[p.id].payable || 0) + p.outstanding;
    });

    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Parties List</h2>
            <p>Total: ${parties.length} parties</p>
        </div>
        <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Type</th><th class="text-right">Opening Balance</th><th class="text-right">Outstanding</th></tr></thead>
            <tbody>
                ${parties.map(p => {
                    const out = outstandingMap[p.id];
                    return `<tr>
                        <td><strong>${escapeHtml(p.name)}</strong></td>
                        <td>${escapeHtml(p.phone || '-')}</td>
                        <td>${escapeHtml(p.type)}</td>
                        <td class="text-right">${formatCurrency(p.opening_balance)}</td>
                        <td class="text-right">${out ? (out.receivable > 0 ? formatCurrency(out.receivable) + ' (Dr)' : out.payable > 0 ? formatCurrency(out.payable) + ' (Cr)' : '-') : '-'}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportPartiesPDF() {
    const result = await window.api.getParties(partyFilter);
    if (!result.success) return;
    const parties = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Parties List</h2>
            <p>Total: ${parties.length} parties</p>
        </div>
        <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Type</th><th class="text-right">Opening Balance</th></tr></thead>
            <tbody>
                ${parties.map(p => `<tr><td><strong>${escapeHtml(p.name)}</strong></td><td>${escapeHtml(p.phone || '-')}</td><td>${escapeHtml(p.type)}</td><td class="text-right">${formatCurrency(p.opening_balance)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

// Globals
window.applyPartyFilter = applyPartyFilter;
window.resetPartyFilter = resetPartyFilter;
window.showPartyForm = showPartyForm;
window.togglePartyExtraFields = togglePartyExtraFields;
window.saveParty = saveParty;
window.editParty = editParty;
window.deleteParty = deleteParty;
window.viewLedger = viewLedger;
window.filterLedger = filterLedger;
window.printLedger = printLedger;
window.exportLedgerPDF = exportLedgerPDF;
window.printPartiesList = printPartiesList;
window.exportPartiesPDF = exportPartiesPDF;
