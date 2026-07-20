/**
 * Audit Log Viewer Module
 * =======================
 * View audit trail: who changed what and when.
 * Filters by table, action, and date range.
 */

async function renderAuditLog(filters = null) {
    const container = document.getElementById('page-audit-log');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading audit log...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-info btn-sm" onclick="printAuditLog()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportAuditLogPDF()">📄 PDF</button>
    `;

    // Use provided filters or defaults
    const preset = getDatePreset('this_month');
    const queryFilters = filters || { from_date: preset.from, to_date: preset.to };
    
    const result = await window.api.getAuditLogs(queryFilters);
    const logs = result.success ? result.data : [];

    const fromVal = queryFilters.from_date || preset.from;
    const toVal = queryFilters.to_date || preset.to;

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Table</label>
                    <select class="form-control" id="alTable">
                        <option value="">All Tables</option>
                        <option value="sales">Sales</option>
                        <option value="purchases">Purchases</option>
                        <option value="milk_collections">Milk Collections</option>
                        <option value="parties">Parties</option>
                        <option value="products">Products</option>
                        <option value="payments">Payments</option>
                        <option value="production_batches">Production</option>
                        <option value="partner_capital">Partner Capital</option>
                        <option value="petty_cash">Petty Cash</option>
                        <option value="salary_records">Salary</option>
                        <option value="vehicle_expenses">Vehicle</option>
                        <option value="other_expenses">Expenses</option>
                        <option value="users">Users</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Action</label>
                    <select class="form-control" id="alAction">
                        <option value="">All Actions</option>
                        <option value="create">Create</option>
                        <option value="update">Update</option>
                        <option value="delete">Delete</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="alFrom" value="${fromVal}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="alTo" value="${toVal}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="applyAuditFilter()">View</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Audit Trail</h2>
                <span style="font-size:13px;color:var(--text-light)">${logs.length} entries</span>
            </div>
            <div class="table-container" style="max-height:500px;overflow-y:auto">
                <table>
                    <thead>
                        <tr>
                            <th>Date/Time</th>
                            <th>User</th>
                            <th>Table</th>
                            <th>Action</th>
                            <th>Record</th>
                            <th>Changes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.length === 0
                            ? '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-light)">No audit log entries found</td></tr>'
                            : logs.map(log => `
                                <tr>
                                    <td style="font-size:12px">${formatDate(log.changed_at)}</td>
                                    <td>${escapeHtml(log.username || 'system')}</td>
                                    <td><span class="badge badge-info">${escapeHtml(log.table_name)}</span></td>
                                    <td><span class="badge ${log.action === 'create' ? 'badge-success' : log.action === 'update' ? 'badge-warning' : 'badge-danger'}">${log.action}</span></td>
                                    <td>#${log.record_id}</td>
                                    <td style="max-width:300px;font-size:12px;word-break:break-all">
                                        ${log.action === 'create' 
                                            ? '<span style="color:var(--accent)">Record created</span>'
                                            : log.action === 'delete'
                                                ? '<span style="color:var(--danger)">Record deleted</span>'
                                                : log.old_values || log.new_values
                                                    ? `<details>
                                                        <summary style="cursor:pointer;color:var(--primary)">View changes</summary>
                                                        <div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-family:monospace;font-size:11px;white-space:pre-wrap">
                                                            ${log.old_values ? `<div style="color:var(--danger)">− ${escapeHtml(log.old_values.substring(0, 200))}</div>` : ''}
                                                            ${log.new_values ? `<div style="color:var(--accent)">+ ${escapeHtml(log.new_values.substring(0, 200))}</div>` : ''}
                                                        </div>
                                                    </details>`
                                                    : '-'
                                        }
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    window._lastAuditLogs = logs;
}

function applyAuditFilter() {
    const table = document.getElementById('alTable')?.value || '';
    const action = document.getElementById('alAction')?.value || '';
    const from = document.getElementById('alFrom')?.value || '';
    const to = document.getElementById('alTo')?.value || '';

    // Re-fetch with filters, passing them to renderAuditLog to avoid re-fetch with defaults
    const filters = {
        table_name: table || undefined,
        action: action || undefined,
        from_date: from || undefined,
        to_date: to || undefined
    };
    renderAuditLog(filters);
}

async function printAuditLog() {
    const logs = window._lastAuditLogs || [];
    if (logs.length === 0) { showToast('No data to print', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Audit Log</h2><p>Total: ${logs.length} entries</p></div>
        <table><thead><tr><th>Date/Time</th><th>User</th><th>Table</th><th>Action</th><th>Record</th></tr></thead>
        <tbody>${logs.map(log => `<tr><td>${log.changed_at}</td><td>${escapeHtml(log.username||'system')}</td><td>${escapeHtml(log.table_name)}</td><td>${log.action}</td><td>#${log.record_id}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportAuditLogPDF() {
    const logs = window._lastAuditLogs || [];
    if (logs.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Audit Log</h2><p>Total: ${logs.length} entries</p></div>`;
    await window.api.printToPDF({ html });
}

// Globals
window.renderAuditLog = renderAuditLog;
window.applyAuditFilter = applyAuditFilter;
window.printAuditLog = printAuditLog;
window.exportAuditLogPDF = exportAuditLogPDF;
