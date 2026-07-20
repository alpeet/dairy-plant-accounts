/**
 * Routes / Collection Center Management Module
 * ============================================
 * Manage collection routes/centers, link farmers, view route summaries.
 */

let routesFilter = { search: '' };

async function renderRoutes() {
    const container = document.getElementById('page-routes');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading routes...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showRouteForm()">+ New Route</button>
        <button class="btn btn-info btn-sm" onclick="showRouteSummary()">📊 Route Summary</button>
        <button class="btn btn-info btn-sm" onclick="printRoutesList()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportRoutesListPDF()">📄 PDF</button>
    `;

    const [routesResult, farmersResult] = await Promise.all([
        window.api.getRoutes(routesFilter),
        window.api.getParties({ type: 'farmer' })
    ]);

    const routes = routesResult.success ? routesResult.data : [];
    const farmers = farmersResult.success ? farmersResult.data : [];

    // Count farmers per route
    const farmerCountMap = {};
    farmers.forEach(f => {
        const rid = f.route_id;
        if (rid) farmerCountMap[rid] = (farmerCountMap[rid] || 0) + 1;
    });

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Search</label>
                    <input type="text" class="form-control" id="routeSearch" placeholder="Route name or area..." value="${escapeHtml(routesFilter.search)}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="applyRoutesFilter()">Filter</button>
                    <button class="btn btn-secondary btn-sm" onclick="resetRoutesFilter()">Reset</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Routes / Collection Centers (${routes.length})</h2>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Route Name</th>
                            <th>Area</th>
                            <th>Assigned Vehicle</th>
                            <th>Assigned Staff</th>
                            <th class="text-right">Farmers</th>
                            <th>Notes</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${routes.length === 0
                            ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No routes defined yet. Create your first route!</td></tr>'
                            : routes.map(r => `
                                <tr>
                                    <td><strong>${escapeHtml(r.name)}</strong></td>
                                    <td>${escapeHtml(r.area || '-')}</td>
                                    <td>${escapeHtml(r.assigned_vehicle || '-')}</td>
                                    <td>${escapeHtml(r.assigned_staff || '-')}</td>
                                    <td class="text-right">${farmerCountMap[r.id] || 0}</td>
                                    <td style="font-size:12px;color:var(--text-light)">${escapeHtml(r.notes || '')}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="editRoute(${r.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteRouteEntry(${r.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    window._lastRoutes = routes;

    document.getElementById('routeSearch')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applyRoutesFilter();
    });
}

function applyRoutesFilter() {
    routesFilter.search = document.getElementById('routeSearch')?.value || '';
    renderRoutes();
}

function resetRoutesFilter() {
    routesFilter = { search: '' };
    renderRoutes();
}

// ============================================================
// Route Form
// ============================================================
function showRouteForm(routeData) {
    const d = routeData || { name: '', area: '', assigned_vehicle: '', assigned_staff: '', notes: '' };

    showModal(`
        <div class="modal-header">
            <h2>${routeData ? 'Edit Route' : 'New Route / Collection Center'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="routeForm">
                <div class="form-group">
                    <label>Route Name *</label>
                    <input type="text" class="form-control" id="rtName" value="${escapeHtml(d.name)}" placeholder="e.g., North Route, Village A Center" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Area / Village</label>
                        <input type="text" class="form-control" id="rtArea" value="${escapeHtml(d.area || '')}" placeholder="e.g., North District">
                    </div>
                    <div class="form-group">
                        <label>Assigned Vehicle</label>
                        <input type="text" class="form-control" id="rtVehicle" value="${escapeHtml(d.assigned_vehicle || '')}" placeholder="Vehicle number/name">
                    </div>
                </div>
                <div class="form-group">
                    <label>Assigned Collection Staff</label>
                    <input type="text" class="form-control" id="rtStaff" value="${escapeHtml(d.assigned_staff || '')}" placeholder="Staff name(s)">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" id="rtNotes" rows="2">${escapeHtml(d.notes || '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveRouteEntry(${routeData ? routeData.id : 'null'})">💾 ${routeData ? 'Update' : 'Save Route'}</button>
        </div>
    `);
}

async function saveRouteEntry(id) {
    const data = {
        id: id || undefined,
        name: document.getElementById('rtName')?.value || '',
        area: document.getElementById('rtArea')?.value || '',
        assigned_vehicle: document.getElementById('rtVehicle')?.value || '',
        assigned_staff: document.getElementById('rtStaff')?.value || '',
        notes: document.getElementById('rtNotes')?.value || ''
    };

    if (!data.name) { showToast('Route name is required', 'error'); return; }

    const result = await window.api.saveRoute(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Route updated' : 'Route created', 'success');
        renderRoutes();
    } else {
        showToast(result.error, 'error');
    }
}

async function editRoute(id) {
    const result = await window.api.getRoute(id);
    if (result.success) showRouteForm(result.data);
}

async function deleteRouteEntry(id) {
    const confirmed = await confirmAction('Delete this route?', 'Farmers linked to this route must be reassigned first.');
    if (!confirmed) return;
    const result = await window.api.deleteRoute(id);
    if (result.success) {
        showToast('Route deleted', 'success');
        renderRoutes();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Route Summary Report
// ============================================================
async function showRouteSummary() {
    const preset = getDatePreset('this_month');
    const result = await window.api.getRouteSummary({ from_date: preset.from, to_date: preset.to });
    const data = result.success ? result.data : [];
    
    showModal(`
        <div class="modal-header">
            <h2>Route Collection Summary</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:80vh;overflow-y:auto">
            <div class="filter-bar">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="rsFrom" value="${preset.from}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="rsTo" value="${preset.to}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="refreshRouteSummary()">Generate</button>
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-info btn-sm" onclick="printRouteSummary()">🖨 Print</button>
                </div>
            </div>
            ${data.length === 0 
                ? '<div style="text-align:center;padding:40px;color:var(--text-light)">No data for this period</div>'
                : `
                <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
                    <div class="summary-card card-primary" style="margin:0;padding:12px">
                        <span class="label">Total Routes</span>
                        <span class="value" style="font-size:20px">${data.length}</span>
                    </div>
                    <div class="summary-card card-info" style="margin:0;padding:12px">
                        <span class="label">Total Collection</span>
                        <span class="value" style="font-size:20px">${formatNumber(data.reduce((s,r) => s + r.total_liters, 0))} L</span>
                    </div>
                    <div class="summary-card card-success" style="margin:0;padding:12px">
                        <span class="label">Total Amount</span>
                        <span class="value" style="font-size:20px">${formatCurrency(data.reduce((s,r) => s + r.total_amount, 0))}</span>
                    </div>
                </div>
                <div class="table-container">
                    <table>
                        <thead><tr>
                            <th>Route</th><th>Area</th><th class="text-right">Farmers</th>
                            <th class="text-right">Collections</th><th class="text-right">Total L</th>
                            <th class="text-right">Avg Fat%</th><th class="text-right">Avg SNF%</th>
                            <th class="text-right">Total Amount</th>
                        </tr></thead>
                        <tbody>
                            ${data.map(r => `<tr>
                                <td><strong>${escapeHtml(r.name)}</strong></td>
                                <td>${escapeHtml(r.area || '-')}</td>
                                <td class="text-right">${r.farmer_count}</td>
                                <td class="text-right">${r.collection_count}</td>
                                <td class="text-right">${formatNumber(r.total_liters)}</td>
                                <td class="text-right">${r.avg_fat ? r.avg_fat.toFixed(2) : '-'}</td>
                                <td class="text-right">${r.avg_snf ? r.avg_snf.toFixed(2) : '-'}</td>
                                <td class="text-right">${formatCurrency(r.total_amount)}</td>
                            </tr>`).join('')}
                        </tbody>
                        <tfoot><tr>
                            <td colspan="4"><strong>Total</strong></td>
                            <td class="text-right"><strong>${formatNumber(data.reduce((s,r) => s + r.total_liters, 0))}</strong></td>
                            <td colspan="2"></td>
                            <td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.total_amount, 0))}</strong></td>
                        </tr></tfoot>
                    </table>
                </div>`
            }
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function refreshRouteSummary() {
    const from = document.getElementById('rsFrom')?.value || '';
    const to = document.getElementById('rsTo')?.value || '';
    const result = await window.api.getRouteSummary({ from_date: from, to_date: to });
    if (result.success) window._lastRouteSummary = result.data;
    showRouteSummary();
}

async function printRouteSummary() {
    const result = await window.api.getRouteSummary({
        from_date: document.getElementById('rsFrom')?.value || '',
        to_date: document.getElementById('rsTo')?.value || ''
    });
    if (!result.success) return;
    const data = result.data || [];
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Route Collection Summary</h2>
        <p>Period: ${document.getElementById('rsFrom')?.value || ''} to ${document.getElementById('rsTo')?.value || ''}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Routes</div><div class="value-number">${data.length}</div></div>
            <div class="value-card"><div class="value-label">Total Liters</div><div class="value-number">${formatNumber(data.reduce((s,r) => s + r.total_liters, 0))}</div></div>
            <div class="value-card"><div class="value-label">Total Amount</div><div class="value-number">${formatCurrency(data.reduce((s,r) => s + r.total_amount, 0))}</div></div>
        </div>
        <table><thead><tr><th>Route</th><th class="text-right">Liters</th><th class="text-right">Avg Fat%</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${data.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="text-right">${formatNumber(r.total_liters)}</td><td class="text-right">${r.avg_fat ? r.avg_fat.toFixed(2) : '-'}</td><td class="text-right">${formatCurrency(r.total_amount)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td class="text-right"><strong>${formatNumber(data.reduce((s,r) => s + r.total_liters, 0))}</strong></td><td></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,r) => s + r.total_amount, 0))}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Print / PDF
// ============================================================
async function printRoutesList() {
    const result = await window.api.getRoutes({});
    if (!result.success) return;
    const routes = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Routes & Collection Centers</h2></div>
        <table><thead><tr><th>Route</th><th>Area</th><th>Vehicle</th><th>Staff</th></tr></thead>
        <tbody>${routes.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.area||'')}</td><td>${escapeHtml(r.assigned_vehicle||'')}</td><td>${escapeHtml(r.assigned_staff||'')}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportRoutesListPDF() {
    const routes = window._lastRoutes || [];
    if (routes.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Routes List</h2><p>Total: ${routes.length}</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

// Globals
window.renderRoutes = renderRoutes;
window.applyRoutesFilter = applyRoutesFilter;
window.resetRoutesFilter = resetRoutesFilter;
window.showRouteForm = showRouteForm;
window.saveRouteEntry = saveRouteEntry;
window.editRoute = editRoute;
window.deleteRouteEntry = deleteRouteEntry;
window.showRouteSummary = showRouteSummary;
window.refreshRouteSummary = refreshRouteSummary;
window.printRouteSummary = printRouteSummary;
window.printRoutesList = printRoutesList;
window.exportRoutesListPDF = exportRoutesListPDF;
