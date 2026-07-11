/**
 * Milk Collection Module
 * Track daily milk intake from farmers with quality parameters
 */

let milkFilter = { search: '', from_date: '', to_date: '' };

async function renderMilkCollection() {
    const container = document.getElementById('page-milk');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading milk collection data...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary" onclick="showMilkCollectionForm()">+ New Collection</button>
        <button class="btn btn-info" onclick="showMilkDashboard()">📊 Summary</button>
        <button class="btn btn-info" onclick="printMilkCollectionsList()">🖨 Print</button>
        <button class="btn btn-primary" onclick="exportMilkCollectionsListPDF()">📄 PDF</button>
    `;

    const [listResult, summaryResult] = await Promise.all([
        window.api.getMilkCollections(milkFilter),
        window.api.getMilkSummary({ date: today() })
    ]);

    const records = listResult.success ? listResult.data : [];
    const summary = summaryResult.success ? summaryResult.data : { todayTotal: { total_liters: 0, total_amount: 0, collection_count: 0 } };

    container.innerHTML = `
        <!-- Summary Cards -->
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr)">
            <div class="summary-card card-info">
                <span class="label">Today's Collection</span>
                <span class="value" style="font-size:20px">${formatNumber(summary.todayTotal.total_liters)} L</span>
                <span class="sub">${summary.todayTotal.collection_count} collections</span>
            </div>
            <div class="summary-card card-success">
                <span class="label">Today's Amount</span>
                <span class="value" style="font-size:20px">${formatCurrency(summary.todayTotal.total_amount)}</span>
                <span class="sub">Due to farmers</span>
            </div>
            <div class="summary-card card-warning">
                <span class="label">This Week</span>
                <span class="value" style="font-size:20px">${formatNumber(summary.weeklyTotal ? summary.weeklyTotal.liters : 0)} L</span>
                <span class="sub">Total milk collected</span>
            </div>
            <div class="summary-card card-danger">
                <span class="label">Pending Payment</span>
                <span class="value" style="font-size:20px">${formatCurrency(summary.pendingDue || 0)}</span>
                <span class="sub">Due to farmers</span>
            </div>
        </div>

        <!-- Filter -->
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Search</label>
                    <input type="text" class="form-control" id="milkSearch" placeholder="Collection No or Farmer..." value="${escapeHtml(milkFilter.search)}">
                </div>
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="milkFrom" value="${milkFilter.from_date}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="milkTo" value="${milkFilter.to_date}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary" onclick="applyMilkFilter()">Filter</button>
                    <button class="btn btn-secondary" onclick="resetMilkFilter()">Reset</button>
                </div>
            </div>
        </div>

        <!-- Milk Collection Table -->
        <div class="card">
            <div class="card-header">
                <h2>Milk Collection Records</h2>
                <span style="font-size:13px;color:var(--text-light)">${records.length} entries</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Collection #</th>
                            <th>Date</th>
                            <th>Farmer</th>
                            <th>Type</th>
                            <th>Shift</th>
                            <th class="text-right">Liters</th>
                            <th class="text-right">Fat %</th>
                            <th class="text-right">Rate</th>
                            <th class="text-right">Amount</th>
                            <th>Status</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${records.length === 0
                            ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No milk collections found. Record your first collection!</td></tr>'
                            : records.map(r => `
                                <tr>
                                    <td><strong>${escapeHtml(r.collection_no)}</strong></td>
                                    <td>${formatDate(r.date)}</td>
                                    <td>${escapeHtml(r.farmer_name)}</td>
                                    <td><span class="badge ${r.milk_type === 'cow' ? 'badge-info' : r.milk_type === 'buffalo' ? 'badge-warning' : 'badge-success'}">${escapeHtml(r.milk_type)}</span></td>
                                    <td>${escapeHtml(r.shift)}</td>
                                    <td class="text-right"><strong>${formatNumber(r.quantity_liters)}</strong></td>
                                    <td class="text-right">${r.fat_percent ? r.fat_percent.toFixed(1) : '-'}</td>
                                    <td class="text-right">${formatCurrency(r.rate)}</td>
                                    <td class="text-right">${formatCurrency(r.amount)}</td>
                                    <td>${statusBadge(r.status)}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewMilkCollection(${r.id})" title="View">👁</button>
                                        <button class="btn btn-primary btn-sm" onclick="editMilkCollection(${r.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteMilkCollection(${r.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
            ${records.length > 0 ? `
                <div style="padding:12px;text-align:right;font-weight:600;font-size:14px">
                    Total Liters: ${formatNumber(records.reduce((s, r) => s + r.quantity_liters, 0))} |
                    Total Amount: ${formatCurrency(records.reduce((s, r) => s + r.amount, 0))}
                </div>
            ` : ''}
        </div>
    `;

    document.getElementById('milkSearch')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applyMilkFilter();
    });
}

function applyMilkFilter() {
    milkFilter.search = document.getElementById('milkSearch')?.value || '';
    milkFilter.from_date = document.getElementById('milkFrom')?.value || '';
    milkFilter.to_date = document.getElementById('milkTo')?.value || '';
    renderMilkCollection();
}

function resetMilkFilter() {
    milkFilter = { search: '', from_date: '', to_date: '' };
    renderMilkCollection();
}

// Generate collection number
function generateCollectionNo() {
    const date = new Date();
    const y = date.getFullYear().toString().slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
    return `MILK-${y}${m}${d}-${rand}`;
}

// ============================================================
// Milk Collection Form
// ============================================================
async function showMilkCollectionForm(recordId = null) {
    const partiesResult = await window.api.getParties({ type: 'supplier' });
    const parties = partiesResult.success ? partiesResult.data : [];

    let record = null;
    if (recordId) {
        const result = await window.api.getMilkCollection(recordId);
        if (result.success) record = result.data;
    }

    const isEdit = !!record;

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Milk Collection' : 'New Milk Collection'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="milkCollectionForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Collection No</label>
                        <input type="text" class="form-control" name="collection_no" value="${escapeHtml(record ? record.collection_no : generateCollectionNo())}" required>
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" name="date" value="${record ? record.date : today()}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Farmer / Supplier</label>
                    <select class="form-control" name="party_id" required>
                        <option value="">-- Select Farmer --</option>
                        ${parties.map(p => `<option value="${p.id}" ${record && record.party_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)} ${p.phone ? '- ' + escapeHtml(p.phone) : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-row-3">
                    <div class="form-group">
                        <label>Milk Type</label>
                        <select class="form-control" name="milk_type">
                            <option value="cow" ${record && record.milk_type === 'cow' ? 'selected' : ''}>Cow Milk</option>
                            <option value="buffalo" ${record && record.milk_type === 'buffalo' ? 'selected' : ''}>Buffalo Milk</option>
                            <option value="mixed" ${record && record.milk_type === 'mixed' ? 'selected' : ''}>Mixed</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Shift</label>
                        <select class="form-control" name="shift">
                            <option value="morning" ${record && record.shift === 'morning' ? 'selected' : ''}>Morning</option>
                            <option value="evening" ${record && record.shift === 'evening' ? 'selected' : ''}>Evening</option>
                            <option value="combined" ${record && record.shift === 'combined' ? 'selected' : ''}>Combined</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Status</label>
                        <select class="form-control" name="status">
                            <option value="pending" ${record && record.status === 'pending' ? 'selected' : ''}>Pending</option>
                            <option value="processed" ${record && record.status === 'processed' ? 'selected' : ''}>Processed</option>
                            <option value="paid" ${record && record.status === 'paid' ? 'selected' : ''}>Paid</option>
                        </select>
                    </div>
                </div>
                <div class="form-section-title">Quality & Quantity</div>
                <div class="form-row-4">
                    <div class="form-group">
                        <label>Quantity (Liters)</label>
                        <input type="number" class="form-control" name="quantity_liters" id="milkLiters" value="${record ? record.quantity_liters : 0}" min="0" step="0.01" required>
                    </div>
                    <div class="form-group">
                        <label>Fat %</label>
                        <input type="number" class="form-control" name="fat_percent" id="milkFat" value="${record ? record.fat_percent : 3.5}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>SNF %</label>
                        <input type="number" class="form-control" name="snf_percent" id="milkSnf" value="${record ? record.snf_percent : 8.5}" min="0" step="0.1">
                    </div>
                    <div class="form-group">
                        <label>Rate (per liter)</label>
                        <input type="number" class="form-control" name="rate" id="milkRate" value="${record ? record.rate : 60}" min="0" step="0.01" oninput="calcMilkAmount()">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Amount</label>
                        <input type="number" class="form-control" name="amount" id="milkAmount" value="${record ? record.amount : 0}" readonly style="background:#f5f5f5;font-weight:700;font-size:16px">
                    </div>
                    <div class="form-group">
                        <label>&nbsp;</label>
                        <div style="padding-top:8px">
                            <span style="font-size:12px;color:var(--text-light)">Price adjusts with fat %: Rate × (Fat / 3.5)</span>
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" name="notes">${escapeHtml(record ? record.notes : '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveMilkCollection(${recordId || ''})">💾 ${isEdit ? 'Update' : 'Save Collection'}</button>
        </div>
    `);

    // Auto-calculate amount
    document.getElementById('milkLiters')?.addEventListener('input', calcMilkAmount);
    document.getElementById('milkFat')?.addEventListener('input', calcMilkAmount);
    calcMilkAmount();
}

function calcMilkAmount() {
    const liters = parseFloat(document.getElementById('milkLiters')?.value || 0);
    const fat = parseFloat(document.getElementById('milkFat')?.value || 3.5);
    const ratePerLiter = parseFloat(document.getElementById('milkRate')?.value || 60);

    // Simple fat-adjusted pricing: rate per liter adjusted by fat %
    const adjustedRate = ratePerLiter * (fat / 3.5);
    const amount = liters * adjustedRate;

    document.getElementById('milkAmount').value = amount.toFixed(2);
}

// ============================================================
// Save Milk Collection
// ============================================================
async function saveMilkCollection(recordId) {
    const form = document.getElementById('milkCollectionForm');
    const formData = new FormData(form);

    const liters = parseFloat(formData.get('quantity_liters') || 0);
    if (liters <= 0) {
        showToast('Quantity must be greater than 0', 'error');
        return;
    }

    const ratePerLiter = parseFloat(formData.get('rate') || 60);
    const fat = parseFloat(formData.get('fat_percent') || 3.5);
    const adjustedRate = ratePerLiter * (fat / 3.5);
    const amount = liters * adjustedRate;

    const data = {
        id: recordId || null,
        collection_no: formData.get('collection_no'),
        date: formData.get('date') || today(),
        party_id: parseInt(formData.get('party_id')),
        milk_type: formData.get('milk_type'),
        quantity_liters: liters,
        fat_percent: fat,
        snf_percent: parseFloat(formData.get('snf_percent') || 8.5),
        rate: parseFloat(ratePerLiter),
        amount: amount,
        shift: formData.get('shift'),
        status: formData.get('status'),
        notes: formData.get('notes')
    };

    if (!data.party_id) {
        showToast('Please select a farmer', 'error');
        return;
    }

    const result = await window.api.saveMilkCollection(data);
    if (result.success) {
        showToast(`Collection ${recordId ? 'updated' : 'saved'} successfully!`);
        closeModal();
        renderMilkCollection();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

// ============================================================
// View Collection Detail
// ============================================================
async function viewMilkCollection(id) {
    const result = await window.api.getMilkCollection(id);
    if (!result.success || !result.data) {
        showToast('Record not found', 'error');
        return;
    }

    const r = result.data;
    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';

    showModal(`
        <div class="modal-header">
            <h2>Milk Collection #${escapeHtml(r.collection_no)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid var(--primary);padding-bottom:12px">
                <h2 style="color:var(--primary)">${escapeHtml(businessName)}</h2>
                <p style="color:var(--text-light);font-size:12px">Milk Collection Record</p>
            </div>
            <div class="form-row">
                <div>
                    <p><strong>Collection No:</strong> ${escapeHtml(r.collection_no)}</p>
                    <p><strong>Date:</strong> ${formatDate(r.date)}</p>
                    <p><strong>Shift:</strong> ${escapeHtml(r.shift)}</p>
                    <p><strong>Status:</strong> ${statusBadge(r.status)}</p>
                </div>
                <div>
                    <p><strong>Farmer:</strong> ${escapeHtml(r.farmer_name)}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(r.farmer_phone || '')}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(r.farmer_address || '')}</p>
                </div>
            </div>
            <div style="margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
                <div style="background:var(--bg);padding:12px;border-radius:6px;text-align:center">
                    <div style="font-size:11px;color:var(--text-light)">Milk Type</div>
                    <div style="font-size:18px;font-weight:700;margin-top:4px;text-transform:capitalize">${escapeHtml(r.milk_type)}</div>
                </div>
                <div style="background:var(--bg);padding:12px;border-radius:6px;text-align:center">
                    <div style="font-size:11px;color:var(--text-light)">Quantity</div>
                    <div style="font-size:18px;font-weight:700;margin-top:4px">${formatNumber(r.quantity_liters)} L</div>
                </div>
                <div style="background:var(--bg);padding:12px;border-radius:6px;text-align:center">
                    <div style="font-size:11px;color:var(--text-light)">Fat</div>
                    <div style="font-size:18px;font-weight:700;margin-top:4px">${r.fat_percent ? r.fat_percent.toFixed(1) : '-'}%</div>
                </div>
                <div style="background:var(--bg);padding:12px;border-radius:6px;text-align:center">
                    <div style="font-size:11px;color:var(--text-light)">Amount</div>
                    <div style="font-size:18px;font-weight:700;margin-top:4px;color:var(--accent)">${formatCurrency(r.amount)}</div>
                </div>
            </div>
            ${r.notes ? `<p style="margin-top:16px"><strong>Notes:</strong> ${escapeHtml(r.notes)}</p>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printMilkRecord(${r.id})">🖨 Print</button>
            <button class="btn btn-primary" onclick="exportMilkPDF(${r.id})">📄 Export PDF</button>
        </div>
    `);
}

// ============================================================
// Edit / Delete
// ============================================================
async function editMilkCollection(id) { showMilkCollectionForm(id); }

async function deleteMilkCollection(id) {
    const result = await window.api.getMilkCollection(id);
    if (!result.success || !result.data) return;

    const confirmed = await confirmAction(
        `Delete collection ${result.data.collection_no}?`,
        'This will permanently remove this milk collection record.',
        'Yes, Delete'
    );

    if (!confirmed) return;

    const delResult = await window.api.deleteMilkCollection(id);
    if (delResult.success) {
        showToast('Collection deleted');
        renderMilkCollection();
    } else {
        showToast(`Error: ${delResult.error}`, 'error');
    }
}

// ============================================================
// Print / PDF
// ============================================================
async function printMilkRecord(id) {
    const result = await window.api.getMilkCollection(id);
    if (!result.success || !result.data) return;
    const r = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <p>${escapeHtml(settings.business_address || '')} | ${escapeHtml(settings.business_phone || '')}</p>
            <h2 style="margin-top:10px;font-size:16px">MILK COLLECTION RECEIPT</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Collection No:</strong> ${escapeHtml(r.collection_no)}</p>
                <p><strong>Date:</strong> ${formatDate(r.date)}</p>
                <p><strong>Shift:</strong> ${escapeHtml(r.shift)}</p>
            </div>
            <div>
                <p><strong>Farmer:</strong> ${escapeHtml(r.farmer_name)}</p>
                <p>${escapeHtml(r.farmer_phone || '')}</p>
                <p>${escapeHtml(r.farmer_address || '')}</p>
            </div>
        </div>
        <table>
            <thead><tr><th>Parameter</th><th class="text-right">Value</th></tr></thead>
            <tbody>
                <tr><td>Milk Type</td><td class="text-right" style="text-transform:capitalize">${escapeHtml(r.milk_type)}</td></tr>
                <tr><td>Quantity</td><td class="text-right">${formatNumber(r.quantity_liters)} Liters</td></tr>
                <tr><td>Fat %</td><td class="text-right">${r.fat_percent ? r.fat_percent.toFixed(1) : '-'}%</td></tr>
                <tr><td>SNF %</td><td class="text-right">${r.snf_percent ? r.snf_percent.toFixed(1) : '-'}%</td></tr>
                <tr><td>Rate / Liter</td><td class="text-right">${formatCurrency(r.rate)}</td></tr>
                <tr><td><strong>Total Amount</strong></td><td class="text-right"><strong>${formatCurrency(r.amount)}</strong></td></tr>
                <tr><td>Status</td><td class="text-right" style="text-transform:uppercase">${escapeHtml(r.status)}</td></tr>
            </tbody>
        </table>
        ${r.notes ? `<p style="margin-top:10px"><strong>Notes:</strong> ${escapeHtml(r.notes)}</p>` : ''}
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportMilkPDF(id) {
    const result = await window.api.getMilkCollection(id);
    if (!result.success || !result.data) return;
    const r = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <p>MILK COLLECTION RECEIPT</p>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Collection No:</strong> ${escapeHtml(r.collection_no)}</p>
                <p><strong>Date:</strong> ${formatDate(r.date)}</p>
            </div>
            <div>
                <p><strong>Farmer:</strong> ${escapeHtml(r.farmer_name)}</p>
            </div>
        </div>
        <table>
            <thead><tr><th>Parameter</th><th class="text-right">Value</th></tr></thead>
            <tbody>
                <tr><td>Type</td><td class="text-right" style="text-transform:capitalize">${escapeHtml(r.milk_type)}</td></tr>
                <tr><td>Quantity</td><td class="text-right">${formatNumber(r.quantity_liters)} L</td></tr>
                <tr><td>Fat</td><td class="text-right">${r.fat_percent ? r.fat_percent.toFixed(1) : '-'}%</td></tr>
                <tr><td><strong>Amount</strong></td><td class="text-right"><strong>${formatCurrency(r.amount)}</strong></td></tr>
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

// ============================================================
// Milk Collection Dashboard / Summary View
// ============================================================
async function showMilkDashboard() {
    const date = today();
    const result = await window.api.getMilkSummary({ date });
    if (!result.success) {
        showToast('Failed to load summary', 'error');
        return;
    }

    const s = result.data;

    showModal(`
        <div class="modal-header">
            <h2>Milk Collection Summary</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
                <div class="summary-card card-info" style="margin:0;padding:12px">
                    <span class="label">Today</span>
                    <span class="value" style="font-size:20px">${formatNumber(s.todayTotal.total_liters)} L</span>
                    <span class="sub">${formatCurrency(s.todayTotal.total_amount)}</span>
                </div>
                <div class="summary-card card-success" style="margin:0;padding:12px">
                    <span class="label">This Week</span>
                    <span class="value" style="font-size:20px">${formatNumber(s.weeklyTotal ? s.weeklyTotal.liters : 0)} L</span>
                    <span class="sub">${formatCurrency(s.weeklyTotal ? s.weeklyTotal.amount : 0)}</span>
                </div>
                <div class="summary-card card-warning" style="margin:0;padding:12px">
                    <span class="label">This Month</span>
                    <span class="value" style="font-size:20px">${formatNumber(s.monthlyTotal ? s.monthlyTotal.liters : 0)} L</span>
                    <span class="sub">${formatCurrency(s.monthlyTotal ? s.monthlyTotal.amount : 0)}</span>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
                <div>
                    <h3 style="font-size:14px;margin-bottom:8px">By Milk Type (Today)</h3>
                    <table>
                        <thead><tr><th>Type</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${s.typeBreakdown && s.typeBreakdown.length > 0
                                ? s.typeBreakdown.map(t => `
                                    <tr>
                                        <td style="text-transform:capitalize">${escapeHtml(t.milk_type)}</td>
                                        <td class="text-right">${formatNumber(t.liters)} L</td>
                                        <td class="text-right">${formatCurrency(t.amount)}</td>
                                    </tr>
                                `).join('')
                                : '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No data</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
                <div>
                    <h3 style="font-size:14px;margin-bottom:8px">By Shift (Today)</h3>
                    <table>
                        <thead><tr><th>Shift</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>
                            ${s.shiftBreakdown && s.shiftBreakdown.length > 0
                                ? s.shiftBreakdown.map(t => `
                                    <tr>
                                        <td style="text-transform:capitalize">${escapeHtml(t.shift)}</td>
                                        <td class="text-right">${formatNumber(t.liters)} L</td>
                                        <td class="text-right">${formatCurrency(t.amount)}</td>
                                    </tr>
                                `).join('')
                                : '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No data</td></tr>'
                            }
                        </tbody>
                    </table>
                </div>
            </div>

            <div>
                <h3 style="font-size:14px;margin-bottom:8px">Top Farmers (This Month)</h3>
                <table>
                    <thead><tr><th>Farmer</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        ${s.topFarmers && s.topFarmers.length > 0
                            ? s.topFarmers.map(f => `
                                <tr>
                                    <td>${escapeHtml(f.name)}</td>
                                    <td class="text-right">${formatNumber(f.liters)} L</td>
                                    <td class="text-right">${formatCurrency(f.amount)}</td>
                                </tr>
                            `).join('')
                            : '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No data</td></tr>'
                        }
                    </tbody>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printMilkSummary()">🖨 Print</button>
        </div>
    `);
}

async function printMilkSummary() {
    const date = today();
    const result = await window.api.getMilkSummary({ date });
    if (!result.success) return;
    const s = result.data;
    const settings = await getSettingsCached();

    let typeRows = '';
    if (s.typeBreakdown) {
        typeRows = s.typeBreakdown.map(t =>
            `<tr><td style="text-transform:capitalize">${escapeHtml(t.milk_type)}</td><td class="text-right">${formatNumber(t.liters)} L</td><td class="text-right">${formatCurrency(t.amount)}</td></tr>`
        ).join('');
    }

    let farmerRows = '';
    if (s.topFarmers) {
        farmerRows = s.topFarmers.map(f =>
            `<tr><td>${escapeHtml(f.name)}</td><td class="text-right">${formatNumber(f.liters)} L</td><td class="text-right">${formatCurrency(f.amount)}</td></tr>`
        ).join('');
    }

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Milk Collection Summary</h2>
            <p>Date: ${formatDate(date)}</p>
        </div>
        <div style="display:flex;gap:20px;margin:10px 0">
            <span><strong>Today:</strong> ${formatNumber(s.todayTotal.total_liters)} L</span>
            <span><strong>Week:</strong> ${formatNumber(s.weeklyTotal ? s.weeklyTotal.liters : 0)} L</span>
            <span><strong>Month:</strong> ${formatNumber(s.monthlyTotal ? s.monthlyTotal.liters : 0)} L</span>
        </div>
        <h3 style="font-size:13px;margin:10px 0 5px">By Milk Type</h3>
        <table><thead><tr><th>Type</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead><tbody>${typeRows || '<tr><td colspan="3" style="text-align:center">No data</td></tr>'}</tbody></table>
        <h3 style="font-size:13px;margin:10px 0 5px">Top Farmers (This Month)</h3>
        <table><thead><tr><th>Farmer</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead><tbody>${farmerRows || '<tr><td colspan="3" style="text-align:center">No data</td></tr>'}</tbody></table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

// ============================================================
// Print / PDF Milk Collections List
// ============================================================
async function printMilkCollectionsList() {
    const listResult = await window.api.getMilkCollections(milkFilter);
    if (!listResult.success) return;
    const records = listResult.data || [];
    const settings = await getSettingsCached();
    const totalLiters = records.reduce((s, r) => s + r.quantity_liters, 0);
    const totalAmount = records.reduce((s, r) => s + r.amount, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Milk Collection Records</h2>
            <p>${records.length} collections | Total: ${formatNumber(totalLiters)} L | Amount: ${formatCurrency(totalAmount)}</p>
        </div>
        <table>
            <thead><tr><th>Collection #</th><th>Date</th><th>Farmer</th><th>Type</th><th>Shift</th><th class="text-right">Liters</th><th class="text-right">Fat %</th><th class="text-right">Amount</th><th>Status</th></tr></thead>
            <tbody>
                ${records.map(r => `<tr>
                    <td><strong>${escapeHtml(r.collection_no)}</strong></td>
                    <td>${formatDate(r.date)}</td>
                    <td>${escapeHtml(r.farmer_name)}</td>
                    <td>${escapeHtml(r.milk_type)}</td>
                    <td>${escapeHtml(r.shift)}</td>
                    <td class="text-right">${formatNumber(r.quantity_liters)}</td>
                    <td class="text-right">${r.fat_percent ? r.fat_percent.toFixed(1) : '-'}</td>
                    <td class="text-right">${formatCurrency(r.amount)}</td>
                    <td>${r.status.toUpperCase()}</td>
                </tr>`).join('')}
                ${records.length === 0 ? '<tr><td colspan="9" style="text-align:center">No collections found</td></tr>' : ''}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportMilkCollectionsListPDF() {
    const listResult = await window.api.getMilkCollections(milkFilter);
    if (!listResult.success) return;
    const records = listResult.data || [];
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Milk Collection Records</h2>
            <p>${records.length} collections | Total: ${formatNumber(records.reduce((s, r) => s + r.quantity_liters, 0))} L</p>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Farmer</th><th>Type</th><th class="text-right">Liters</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
                ${records.map(r => `<tr><td>${formatDate(r.date)}</td><td>${escapeHtml(r.farmer_name)}</td><td>${escapeHtml(r.milk_type)}</td><td class="text-right">${formatNumber(r.quantity_liters)}</td><td class="text-right">${formatCurrency(r.amount)}</td></tr>`).join('')}
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
window.renderMilkCollection = renderMilkCollection;
window.applyMilkFilter = applyMilkFilter;
window.resetMilkFilter = resetMilkFilter;
window.showMilkCollectionForm = showMilkCollectionForm;
window.saveMilkCollection = saveMilkCollection;
window.viewMilkCollection = viewMilkCollection;
window.editMilkCollection = editMilkCollection;
window.deleteMilkCollection = deleteMilkCollection;
window.printMilkRecord = printMilkRecord;
window.exportMilkPDF = exportMilkPDF;
window.showMilkDashboard = showMilkDashboard;
window.calcMilkAmount = calcMilkAmount;
window.printMilkCollectionsList = printMilkCollectionsList;
window.exportMilkCollectionsListPDF = exportMilkCollectionsListPDF;
