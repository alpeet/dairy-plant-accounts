/**
 * Vehicle Expenses Register Module
 * ================================
 * Manages vehicle expenses with add/edit/delete, print & PDF.
 */

async function renderVehicle() {
    const container = document.getElementById('page-vehicle');
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showAddVehicle()">+ New Expense</button>
    `;

    const preset = getDatePreset('this_month');
    const result = await window.api.getVehicleExpenses({ from_date: preset.from, to_date: preset.to });
    const expenses = result.success ? result.data : [];

    const summary = await window.api.getVehicleExpensesSummary({ from_date: preset.from, to_date: preset.to });
    const s = summary.success ? summary.data : { count: 0, total: 0, total_fuel: 0, total_repair: 0, total_maintenance: 0, total_toll: 0, total_other: 0 };

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(6,1fr)">
            <div class="summary-card card-primary" style="margin:0;padding:8px"><span class="label">Entries</span><span class="value" style="font-size:16px">${s.count}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:8px"><span class="label">Fuel</span><span class="value" style="font-size:14px">${formatCurrency(s.total_fuel)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:8px"><span class="label">Repair</span><span class="value" style="font-size:14px">${formatCurrency(s.total_repair)}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:8px"><span class="label">Maint.</span><span class="value" style="font-size:14px">${formatCurrency(s.total_maintenance)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:8px"><span class="label">Toll/Parking</span><span class="value" style="font-size:14px">${formatCurrency(s.total_toll)}</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:8px"><span class="label">Total</span><span class="value" style="font-size:16px">${formatCurrency(s.total)}</span></div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="veFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="veTo" value="${preset.to}"></div>
            <div class="form-group"><label>Vehicle</label><input type="text" class="form-control" id="veSearch" placeholder="Vehicle name..."></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshVehicle()">Search</button></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-info btn-sm" onclick="printVehicle()">🖨 Print</button></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th>Type</th><th class="text-right">Fuel</th><th class="text-right">Repair</th><th class="text-right">Maint.</th><th class="text-right">Toll</th><th class="text-right">Other</th><th class="text-right">Total</th><th>Remarks</th><th class="actions">Actions</th></tr></thead>
                <tbody>
                    ${expenses.map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td><strong>${escapeHtml(e.vehicle_name)}</strong></td>
                            <td>${escapeHtml(e.driver_name || '')}</td>
                            <td>${escapeHtml(e.expense_type || '')}</td>
                            <td class="text-right">${e.fuel_amount > 0 ? formatCurrency(e.fuel_amount) : '-'}</td>
                            <td class="text-right">${e.repair_amount > 0 ? formatCurrency(e.repair_amount) : '-'}</td>
                            <td class="text-right">${e.maintenance_amount > 0 ? formatCurrency(e.maintenance_amount) : '-'}</td>
                            <td class="text-right">${e.toll_parking_amount > 0 ? formatCurrency(e.toll_parking_amount) : '-'}</td>
                            <td class="text-right">${e.other_amount > 0 ? formatCurrency(e.other_amount) : '-'}</td>
                            <td class="text-right"><strong>${formatCurrency(e.total_amount)}</strong></td>
                            <td>${escapeHtml(e.remarks || '')}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editVehicle(${e.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteVehicleEntry(${e.id})">🗑</button>
                            </td>
                        </tr>
                    `).join('')}
                    ${expenses.length === 0 ? '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-light)">No vehicle expenses</td></tr>' : ''}
                </tbody>
                ${expenses.length > 0 ? `<tfoot><tr><td colspan="4"><strong>Total</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.fuel_amount, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.repair_amount, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.maintenance_amount, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.toll_parking_amount, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.other_amount, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(expenses.reduce((s,e) => s + e.total_amount, 0))}</strong></td>
                    <td colspan="2"></td>
                </tr></tfoot>` : ''}
            </table>
        </div>
    `;

    window._lastVehicle = expenses;
}

async function refreshVehicle() {
    const from = document.getElementById('veFrom')?.value || '';
    const to = document.getElementById('veTo')?.value || '';
    const vehicle = document.getElementById('veSearch')?.value || '';
    const result = await window.api.getVehicleExpenses({ from_date: from, to_date: to, vehicle_name: vehicle || undefined });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastVehicle = result.data;
    renderVehicle();
}

function showAddVehicle(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || { date: today, vehicle_name: '', driver_name: '', expense_type: 'fuel', fuel_amount: 0, repair_amount: 0, maintenance_amount: 0, toll_parking_amount: 0, other_amount: 0, remarks: '' };

    showModal(`
        <div class="modal-header"><h2>${existingData ? 'Edit' : 'New'} Vehicle Expense</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group"><label>Date</label><input type="date" class="form-control" id="veDate" value="${d.date}"></div>
                <div class="form-group"><label>Vehicle Name/No *</label><input type="text" class="form-control" id="veName" value="${escapeHtml(d.vehicle_name)}"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Driver Name</label><input type="text" class="form-control" id="veDriver" value="${escapeHtml(d.driver_name || '')}"></div>
                <div class="form-group"><label>Expense Type</label>
                    <select class="form-control" id="veType">
                        <option value="fuel" ${d.expense_type === 'fuel' ? 'selected' : ''}>Fuel</option>
                        <option value="repair" ${d.expense_type === 'repair' ? 'selected' : ''}>Repair</option>
                        <option value="maintenance" ${d.expense_type === 'maintenance' ? 'selected' : ''}>Maintenance</option>
                        <option value="toll_parking" ${d.expense_type === 'toll_parking' ? 'selected' : ''}>Toll/Parking</option>
                        <option value="other" ${d.expense_type === 'other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
            </div>
            <div class="form-section-title">Amount Breakdown</div>
            <div class="form-row-4">
                <div class="form-group"><label>Fuel (₹)</label><input type="number" class="form-control" id="veFuel" value="${d.fuel_amount}" step="0.01" min="0"></div>
                <div class="form-group"><label>Repair (₹)</label><input type="number" class="form-control" id="veRepair" value="${d.repair_amount}" step="0.01" min="0"></div>
                <div class="form-group"><label>Maintenance (₹)</label><input type="number" class="form-control" id="veMaint" value="${d.maintenance_amount}" step="0.01" min="0"></div>
                <div class="form-group"><label>Toll/Parking (₹)</label><input type="number" class="form-control" id="veToll" value="${d.toll_parking_amount}" step="0.01" min="0"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Other (₹)</label><input type="number" class="form-control" id="veOther" value="${d.other_amount}" step="0.01" min="0"></div>
                <div class="form-group"><label>Total (auto-calculated)</label><input type="text" class="form-control" id="veTotal" readonly style="font-weight:700;color:var(--primary);font-size:16px"></div>
            </div>
            <div class="form-group"><label>Remarks</label><input type="text" class="form-control" id="veRemarks" value="${escapeHtml(d.remarks || '')}"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveVehicleEntry(${existingData ? existingData.id : 'null'})">Save</button>
        </div>
    `);

    document.querySelectorAll('#veFuel, #veRepair, #veMaint, #veToll, #veOther').forEach(el => {
        el.addEventListener('input', updateVehicleTotal);
    });
    updateVehicleTotal();
}

function updateVehicleTotal() {
    const v = (id) => parseFloat(document.getElementById(id)?.value || 0);
    const total = v('veFuel') + v('veRepair') + v('veMaint') + v('veToll') + v('veOther');
    document.getElementById('veTotal').value = '₹ ' + total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

async function saveVehicleEntry(id) {
    const data = {
        id: id || undefined,
        date: document.getElementById('veDate')?.value || '',
        vehicle_name: document.getElementById('veName')?.value || '',
        driver_name: document.getElementById('veDriver')?.value || '',
        expense_type: document.getElementById('veType')?.value || 'fuel',
        fuel_amount: parseFloat(document.getElementById('veFuel')?.value || 0),
        repair_amount: parseFloat(document.getElementById('veRepair')?.value || 0),
        maintenance_amount: parseFloat(document.getElementById('veMaint')?.value || 0),
        toll_parking_amount: parseFloat(document.getElementById('veToll')?.value || 0),
        other_amount: parseFloat(document.getElementById('veOther')?.value || 0),
        remarks: document.getElementById('veRemarks')?.value || ''
    };

    if (!data.vehicle_name) { showToast('Vehicle name is required', 'error'); return; }

    const result = await window.api.saveVehicleExpense(data);
    if (result.success) { closeModal(); showToast(id ? 'Updated' : 'Saved', 'success'); renderVehicle(); }
    else { showToast(result.error, 'error'); }
}

async function editVehicle(id) {
    const result = await window.api.getVehicleExpense(id);
    if (result.success) showAddVehicle(result.data);
}

async function deleteVehicleEntry(id) {
    if (!await confirmAction('Delete this vehicle expense?')) return;
    const result = await window.api.deleteVehicleExpense(id);
    if (result.success) { showToast('Deleted', 'success'); renderVehicle(); }
    else { showToast(result.error, 'error'); }
}

async function printVehicle() {
    const data = window._lastVehicle || [];
    if (data.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Vehicle Expenses Register</h2></div>
        <table class="compact"><thead><tr><th>Date</th><th>Vehicle</th><th>Driver</th><th class="text-right">Fuel</th><th class="text-right">Repair</th><th class="text-right">Maint.</th><th class="text-right">Toll</th><th class="text-right">Other</th><th class="text-right">Total</th></tr></thead>
        <tbody>${data.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.vehicle_name)}</td><td>${escapeHtml(e.driver_name||'')}</td><td class="text-right">${e.fuel_amount > 0 ? formatCurrency(e.fuel_amount) : '-'}</td><td class="text-right">${e.repair_amount > 0 ? formatCurrency(e.repair_amount) : '-'}</td><td class="text-right">${e.maintenance_amount > 0 ? formatCurrency(e.maintenance_amount) : '-'}</td><td class="text-right">${e.toll_parking_amount > 0 ? formatCurrency(e.toll_parking_amount) : '-'}</td><td class="text-right">${e.other_amount > 0 ? formatCurrency(e.other_amount) : '-'}</td><td class="text-right"><strong>${formatCurrency(e.total_amount)}</strong></td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.fuel_amount, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.repair_amount, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.maintenance_amount, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.toll_parking_amount, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.other_amount, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,e) => s + e.total_amount, 0))}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportVehiclePDF() { await printVehicle(); }

// Globals
window.renderVehicle = renderVehicle;
window.refreshVehicle = refreshVehicle;
window.showAddVehicle = showAddVehicle;
window.updateVehicleTotal = updateVehicleTotal;
window.saveVehicleEntry = saveVehicleEntry;
window.editVehicle = editVehicle;
window.deleteVehicleEntry = deleteVehicleEntry;
window.printVehicle = printVehicle;
window.exportVehiclePDF = exportVehiclePDF;
