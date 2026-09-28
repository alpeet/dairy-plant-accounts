/**
 * Audit Log Viewer Module
 * =======================
 * View audit trail: who changed what and when.
 * Filters by table, action, and date range (BS dates — converted to the AD
 * changed_at range on the backend).
 *
 * Change display renders a field-by-field old → new diff, e.g.
 *     Amount: Rs 10,000.00 → Rs 12,000.00
 *     Status: Unpaid → Partial
 * Unchanged fields are never shown.
 */

// ── Diff rendering helpers ───────────────────────────────────────────────────

const AUDIT_FIELD_LABELS = {
    grand_total: 'Amount', total_amount: 'Amount', amount: 'Amount',
    net_amount: 'Amount', paid_amount: 'Paid', status: 'Status', rate: 'Rate',
    quantity: 'Quantity', qty: 'Quantity', date: 'Date', invoice_no: 'Invoice No',
    bill_no: 'Bill No', name: 'Name', party_name: 'Party', payment_mode: 'Mode',
    mode: 'Mode', fat: 'FAT', snf: 'SNF', remarks: 'Remarks', notes: 'Notes',
    reference_no: 'Reference No', deposit_no: 'Deposit No', ref_no: 'Reference No',
    party_id: 'Party ID', product_id: 'Product ID', bank_account: 'Bank Account',
    match_status: 'Match Status', accounting_class: 'Row Class'
};

const AUDIT_STATUS_LABELS = { unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid' };

function auditLabel(key) {
    return AUDIT_FIELD_LABELS[key]
        || String(key).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function auditFormatValue(key, value) {
    if (value === null || value === undefined || value === '') return '—';
    const s = String(value);
    if (key === 'status' && AUDIT_STATUS_LABELS[s.toLowerCase()]) return AUDIT_STATUS_LABELS[s.toLowerCase()];
    // Money-ish fields get Rs formatting
    if (/(^amount$|_amount|_total$|^rate$|^paid)/.test(String(key)) && !isNaN(parseFloat(value)) && isFinite(value)) {
        const n = Number(value);
        return 'Rs ' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return s;
}

function auditParseValues(raw) {
    if (!raw) return null;
    try {
        const v = JSON.parse(raw);
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
    } catch (e) { return null; }
}

/**
 * Build the human-readable change summary for one audit row.
 * Returns HTML (already escaped) — '' when there is nothing meaningful to show.
 */
function renderAuditChanges(log) {
    const oldV = auditParseValues(log.old_values);
    const newV = auditParseValues(log.new_values);

    // Fallback: raw (non-JSON or legacy) payloads → show them truncated
    if (!oldV && !newV) {
        if (!log.old_values && !log.new_values) return '';
        return `<details>
            <summary style="cursor:pointer;color:var(--primary)">View raw data</summary>
            <div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-family:monospace;font-size:11px;white-space:pre-wrap">
                ${log.old_values ? `<div style="color:var(--danger)">− ${escapeHtml(String(log.old_values).substring(0, 300))}</div>` : ''}
                ${log.new_values ? `<div style="color:var(--accent)">+ ${escapeHtml(String(log.new_values).substring(0, 300))}</div>` : ''}
            </div>
        </details>`;
    }

    // CREATE: show the key fields of the new record
    if (log.action === 'create' && newV) {
        const fields = Object.entries(newV).slice(0, 6).map(([k, v]) =>
            `<div><span style="color:var(--text-light)">${escapeHtml(auditLabel(k))}:</span> ${escapeHtml(auditFormatValue(k, v))}</div>`
        ).join('');
        return `<span style="color:var(--accent)">Record created</span>${fields ? `<details><summary style="cursor:pointer;color:var(--primary)">Details</summary><div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-size:12px">${fields}</div></details>` : ''}`;
    }

    // DELETE: show the key fields of what was removed
    if (log.action === 'delete' && oldV) {
        const fields = Object.entries(oldV).slice(0, 6).map(([k, v]) =>
            `<div><span style="color:var(--text-light)">${escapeHtml(auditLabel(k))}:</span> <span style="color:var(--danger)">${escapeHtml(auditFormatValue(k, v))}</span></div>`
        ).join('');
        return `<span style="color:var(--danger)">Record deleted</span>${fields ? `<details><summary style="cursor:pointer;color:var(--primary)">Details</summary><div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-size:12px">${fields}</div></details>` : ''}`;
    }

    // UPDATE: field-by-field old → new (skip unchanged)
    if (oldV && newV) {
        const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])];
        const changed = keys.filter(k => String(oldV[k] ?? '') !== String(newV[k] ?? ''));
        if (changed.length === 0) return '<span style="color:var(--text-light)">No field changes</span>';
        const rows = changed.slice(0, 8).map(k => `
            <div>
                <span style="color:var(--text-light)">${escapeHtml(auditLabel(k))}:</span>
                <span style="color:var(--danger);text-decoration:line-through">${escapeHtml(auditFormatValue(k, oldV[k]))}</span>
                →
                <span style="color:var(--accent)">${escapeHtml(auditFormatValue(k, newV[k]))}</span>
            </div>`).join('');
        const more = changed.length > 8 ? `<div style="color:var(--text-light)">…and ${changed.length - 8} more</div>` : '';
        return `<details open><summary style="cursor:pointer;color:var(--primary)">${changed.length} field${changed.length > 1 ? 's' : ''} changed</summary><div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-size:12px">${rows}${more}</div></details>`;
    }

    // One-sided update (only new or only old known)
    const side = newV || oldV;
    const entries = Object.entries(side).slice(0, 6).map(([k, v]) =>
        `<div><span style="color:var(--text-light)">${escapeHtml(auditLabel(k))}:</span> ${escapeHtml(auditFormatValue(k, v))}</div>`
    ).join('');
    return `<details><summary style="cursor:pointer;color:var(--primary)">View data</summary><div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-size:12px">${entries}</div></details>`;
}

// ── Screen ───────────────────────────────────────────────────────────────────

async function renderAuditLog(filters = null) {
    const container = document.getElementById('page-audit-log');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading audit log...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-info btn-sm" onclick="printAuditLog()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportAuditLogPDF()">📄 PDF</button>
    `;

    // Use provided filters or defaults (BS dates; backend converts to AD range)
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
                        <option value="bank_transactions">Bank Transactions</option>
                        <option value="cash_deposits">Cash Deposits</option>
                        <option value="cash_collections">Cash Collection</option>
                        <option value="ledger_entries">Ledger Entries</option>
                        <option value="production_batches">Production</option>
                        <option value="partner_capital">Partner Capital</option>
                        <option value="petty_cash">Petty Cash</option>
                        <option value="salary_records">Salary</option>
                        <option value="vehicle_expenses">Vehicle</option>
                        <option value="other_expenses">Expenses</option>
                        <option value="settings">Settings</option>
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
                                    <td style="font-size:12px">${formatDate(log.changed_at)}<br><span style="color:var(--text-light);font-size:11px">${escapeHtml(String(log.changed_at || '').slice(11, 16))}</span></td>
                                    <td>${escapeHtml(log.username || log.changed_by_name || 'system')}</td>
                                    <td><span class="badge badge-info">${escapeHtml(log.table_name)}</span></td>
                                    <td><span class="badge ${log.action === 'create' ? 'badge-success' : log.action === 'update' ? 'badge-warning' : 'badge-danger'}">${log.action}</span></td>
                                    <td>#${log.record_id}</td>
                                    <td style="max-width:340px;font-size:12px;word-break:break-word">
                                        ${renderAuditChanges(log) || '<span style="color:var(--text-light)">—</span>'}
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Restore filter selections after re-render
    if (filters) {
        const t = document.getElementById('alTable');
        const a = document.getElementById('alAction');
        if (t && filters.table_name) t.value = filters.table_name;
        if (a && filters.action) a.value = filters.action;
    }

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
        <tbody>${logs.map(log => `<tr><td>${log.changed_at}</td><td>${escapeHtml(log.username || log.changed_by_name || 'system')}</td><td>${escapeHtml(log.table_name)}</td><td>${log.action}</td><td>#${log.record_id}</td></tr>`).join('')}</tbody></table>
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
