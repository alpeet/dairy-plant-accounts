/**
 * Post-Dated Cheque (PDC) Register
 * ===============================
 * Accounting → Cheque Register / PDC.
 *
 * A post-dated cheque is an INSTRUMENT, not money, and this screen shows it
 * that way:
 *   • Held / Deposited cheques appear as money EXPECTED (PDC Receivable) or
 *     money we will PAY (PDC Payable) — they are never added to the bank
 *     balance, which only moves when a cheque is actually cleared.
 *   • The lifecycle is Deposited → Cleared, with Bounced and Cancelled as the
 *     terminal states; every action is validated and audited on the backend.
 *   • Amounts, dates (BS) and currency formatting all use the app's existing
 *     helpers — no second implementation of any of them.
 */

// Role per named PDC permission — mirrors shared/operations/pdc.js. The UI only
// hides buttons; the API enforces the same rules server-side.
const PDC_ROLE_LEVEL = { agent: 0, staff: 1, operator: 2, accountant: 3, admin: 4 };
const PDC_PERM_ROLE = {
    view: 'staff', create: 'operator', edit: 'operator', allocate: 'operator',
    deposit: 'operator', clear: 'accountant', bounce: 'accountant', cancel: 'accountant', delete: 'admin'
};

const PDC_STATUS_META = {
    HELD: { label: 'Held', color: '#8a6d00', bg: '#fff4cc', border: '#f0d060' },
    DEPOSITED: { label: 'Deposited', color: '#0b5394', bg: '#dbeafe', border: '#93c5fd' },
    CLEARED: { label: 'Cleared', color: '#155724', bg: '#d4edda', border: '#9bd0a8' },
    BOUNCED: { label: 'Bounced', color: '#721c24', bg: '#f8d7da', border: '#f1aeb5' },
    CANCELLED: { label: 'Cancelled', color: '#4a4a4a', bg: '#e9ecef', border: '#c9cdd2' }
};

let _pdcState = {
    rows: [],
    position: null,
    report: 'register',
    dueReport: null,
    bouncedReport: null,
    parties: [],
    today: '',
    filters: {
        pdc_type: 'all', status: 'all', due: 'all', party_id: '',
        bank_name: '', search: '', from_date: '', to_date: '',
        cheque_from: '', cheque_to: '', amount_min: '', amount_max: ''
    }
};

/** True when the signed-in user's role carries the named PDC permission. */
function pdcCan(perm) {
    const role = String((window._currentUser && window._currentUser.role) || 'staff').toLowerCase();
    const need = PDC_ROLE_LEVEL[PDC_PERM_ROLE[perm] || 'admin'];
    const have = PDC_ROLE_LEVEL[role] === undefined ? 0 : PDC_ROLE_LEVEL[role];
    return have >= need;
}

function pdcStatusBadge(status) {
    const meta = PDC_STATUS_META[String(status || '').toUpperCase()] || { label: status || '', color: '#333', bg: '#eee', border: '#ccc' };
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${meta.color};background:${meta.bg};border:1px solid ${meta.border}">${escapeHtml(meta.label)}</span>`;
}

function pdcTypeBadge(type) {
    const received = type === 'received';
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:${received ? '#0b5394' : '#7a4b00'};background:${received ? '#e7f1fb' : '#fdf1dd'};border:1px solid ${received ? '#a9c8e8' : '#e8c48f'}">${received ? '⬇ Received' : '⬆ Issued'}</span>`;
}

/** Due-date cell: BS date, the day count and an overdue emphasis. */
function pdcDueCell(row) {
    if (!row.due_date) {
        return `<span style="color:var(--text-light)">${row.status === 'CLEARED' ? 'settled' : '—'}</span>`;
    }
    const d = row.days_until;
    let note = '';
    let color = 'var(--text-light)';
    if (d === null || d === undefined) note = '';
    else if (d < 0) { note = `${Math.abs(d)}d overdue`; color = '#c62828'; }
    else if (d === 0) { note = 'due today'; color = '#c62828'; }
    else if (d === 1) { note = 'due tomorrow'; color = '#e65100'; }
    else if (d <= 7) { note = `in ${d} days`; color = '#e65100'; }
    else { note = `in ${d} days`; color = 'var(--text-light)'; }
    return `${formatDate(row.due_date)}${note ? `<div style="font-size:11px;color:${color};font-weight:600">${note}</div>` : ''}`;
}

/**
 * Lifecycle buttons. WHICH moves are legal comes from the backend row
 * (`next_statuses`, from the one transition map in shared/operations/pdc.js), so
 * the screen can never offer a transition the API would refuse. The map below is
 * only a fallback for a row that arrives undecorated.
 */
const PDC_ACTION_FOR_TARGET = {
    DEPOSITED: { action: 'deposit', cls: 'btn-info', icon: '🏦', title: 'Deposit / Present' },
    CLEARED: { action: 'clear', cls: 'btn-success', icon: '✅', title: 'Mark as Cleared' },
    BOUNCED: { action: 'bounce', cls: 'btn-danger', icon: '↩', title: 'Mark as Bounced' },
    CANCELLED: { action: 'cancel', cls: 'btn-secondary', icon: '⛔', title: 'Cancel cheque' }
};
const PDC_NEXT_FALLBACK = {
    HELD: ['DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'],
    DEPOSITED: ['CLEARED', 'BOUNCED'],
    CLEARED: ['BOUNCED'],
    BOUNCED: [],
    CANCELLED: []
};

/** The action buttons a row may show, by legal transitions and permission. */
function pdcRowActions(row) {
    const btns = [];
    const s = String(row.status || '');
    const next = Array.isArray(row.next_statuses) ? row.next_statuses : (PDC_NEXT_FALLBACK[s] || []);
    next.forEach(target => {
        const spec = PDC_ACTION_FOR_TARGET[target];
        if (!spec || !pdcCan(spec.action)) return;
        btns.push(`<button class="btn ${spec.cls} btn-sm" title="${spec.title}" onclick="event.stopPropagation();pdcActionModal(${row.id},'${spec.action}')">${spec.icon}</button>`);
    });
    if (pdcCan('edit') && (s === 'HELD' || s === 'DEPOSITED')) {
        btns.push(`<button class="btn btn-warning btn-sm" title="Edit / allocation" onclick="event.stopPropagation();showPdcFormById(${row.id})">✏️</button>`);
    }
    if (pdcCan('view')) {
        btns.push(`<button class="btn btn-info btn-sm" title="Detail" onclick="event.stopPropagation();pdcViewDetail(${row.id})">🔍</button>`);
    }
    // Never-posted cheques only: a cancelled/bounced/cleared cheque is history.
    if (pdcCan('delete') && (s === 'HELD' || s === 'DEPOSITED')) {
        btns.push(`<button class="btn btn-danger btn-sm" title="Delete (never posted)" onclick="event.stopPropagation();pdcDelete(${row.id})">🗑</button>`);
    }
    return btns.join(' ');
}

// ============================================================
// Page
// ============================================================

async function renderPdcRegister() {
    const container = document.getElementById('page-pdc');
    document.getElementById('topActions').innerHTML = '';

    // A dashboard card can hand off a filter (e.g. "Due Today").
    if (window._pdcPendingFilter) {
        Object.assign(_pdcState.filters, window._pdcPendingFilter);
        window._pdcPendingFilter = null;
    }

    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-light)">Loading cheque register…</div>';

    if (!_pdcState.parties.length) {
        const pr = await window.api.getParties({});
        _pdcState.parties = pr.success ? pr.data : [];
    }
    const [posRes, listRes] = await Promise.all([
        window.api.getPdcPosition(),
        window.api.getPdcList(pdcFilterPayload())
    ]);
    _pdcState.position = posRes.success ? posRes.data : null;
    _pdcState.rows = listRes.success ? listRes.data.rows : [];
    _pdcState.today = listRes.success ? listRes.data.today : today();
    if (!listRes.success) showToast(listRes.error, 'error');

    // Detailed reports, loaded lazily for the chosen tab.
    if (_pdcState.report === 'due') {
        const r = await window.api.getPdcDueReport(pdcFilterPayload());
        _pdcState.dueReport = r.success ? r.data : null;
    } else if (_pdcState.report === 'bounced') {
        const r = await window.api.getPdcBouncedReport(pdcFilterPayload());
        _pdcState.bouncedReport = r.success ? r.data : null;
    }

    container.innerHTML = pdcPageHtml();
    window._lastPdcRows = _pdcState.rows;
    if (typeof refreshBSDateInputs === 'function') refreshBSDateInputs(container);
}

/** Current filters in the shape the API expects. */
function pdcFilterPayload() {
    const f = _pdcState.filters;
    const p = {
        pdc_type: f.pdc_type === 'all' ? '' : f.pdc_type,
        status: f.status,
        due: f.due,
        party_id: f.party_id || undefined,
        bank_name: f.bank_name || undefined,
        search: f.search || undefined,
        from_date: f.from_date || undefined,
        to_date: f.to_date || undefined,
        cheque_from: f.cheque_from || undefined,
        cheque_to: f.cheque_to || undefined,
        amount_min: f.amount_min !== '' ? f.amount_min : undefined,
        amount_max: f.amount_max !== '' ? f.amount_max : undefined
    };
    Object.keys(p).forEach(k => (p[k] === undefined || p[k] === '') && delete p[k]);
    return p;
}

function pdcPageHtml() {
    const pos = _pdcState.position || {};
    const rows = _pdcState.rows;
    const totalAmount = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const canCreate = pdcCan('create');

    const card = (label, value, sub, color) => `
        <div style="background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:150px;flex:1">
            <div style="font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--text-light)">${label}</div>
            <div style="font-size:18px;font-weight:700;color:${color || 'var(--accent)'};margin-top:4px">${value}</div>
            ${sub ? `<div style="font-size:11px;color:var(--text-light);margin-top:2px">${sub}</div>` : ''}
        </div>`;

    return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap">
            <div>
                <h2 style="margin:0">🏛 Cheque Register (PDC)</h2>
                <div style="font-size:12px;color:var(--text-light);margin-top:2px">
                    Post-dated cheques received and issued — held cheques never touch the bank balance until they clear.
                </div>
            </div>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="pdcPrint()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="pdcExportPDF()">📄 PDF</button>
                <button class="btn btn-success btn-sm" onclick="pdcExportCSV()">⬇ Excel (CSV)</button>
            </div>
        </div>

        ${canCreate ? `
        <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:12px;padding:14px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;border:2px dashed #81c784"
             onclick="showPdcForm()">
            <div style="display:flex;align-items:center;gap:12px">
                <span style="font-size:26px">➕</span>
                <div>
                    <div style="font-size:15px;font-weight:700;color:#2e7d32">Record a Post-Dated Cheque</div>
                    <div style="font-size:12px;color:#388e3c">Received from a customer or issued to a supplier — with invoice allocation</div>
                </div>
            </div>
            <div style="font-size:12px;color:#2e7d32">Click to add →</div>
        </div>` : ''}

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            ${card('PDC Receivable (expected)', formatCurrency(pos.pdc_receivable || 0), `${pos.pdc_receivable_count || 0} cheque(s) held/deposited`, '#0b5394')}
            ${card('PDC Payable (to pay)', formatCurrency(pos.pdc_payable || 0), `${pos.pdc_payable_count || 0} cheque(s) issued`, '#7a4b00')}
            ${card('Due Today', `${pos.due_today ? pos.due_today.count : 0}`, formatCurrency(pos.due_today ? pos.due_today.amount : 0), '#c62828')}
            ${card('Due in 7 Days', `${pos.due_7_days_count || 0}`, formatCurrency(pos.due_7_days || 0), '#e65100')}
            ${card('Overdue', `${pos.overdue ? pos.overdue.count : 0}`, formatCurrency(pos.overdue ? pos.overdue.amount : 0), '#c62828')}
            ${card('Cleared not reconciled', `${pos.cleared_not_reconciled ? pos.cleared_not_reconciled.count : 0}`, formatCurrency(pos.cleared_not_reconciled ? pos.cleared_not_reconciled.amount : 0), '#155724')}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            ${pdcChip('all', 'All')}
            ${pdcChip('received', 'PDC Received')}
            ${pdcChip('issued', 'PDC Issued')}
            ${['HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED'].map(s => pdcChip('status:' + s, PDC_STATUS_META[s].label)).join('')}
            ${pdcChip('due:today', 'Due Today')}
            ${pdcChip('due:7', 'Due in 7 Days')}
            ${pdcChip('due:30', 'Due in 30 Days')}
            ${pdcChip('due:overdue', 'Overdue')}
        </div>

        ${pdcFilterBarHtml()}

        <div style="display:flex;gap:6px;margin-bottom:10px">
            ${['register', 'due', 'bounced'].map(r => `
                <button class="btn btn-sm ${_pdcState.report === r ? 'btn-primary' : 'btn-secondary'}" onclick="pdcSetReport('${r}')">
                    ${r === 'register' ? 'Register' : r === 'due' ? 'Due Report' : 'Bounced Report'}
                </button>`).join('')}
        </div>

        ${pdcReportHtml(rows, totalAmount)}
    `;
}

function pdcChip(key, label) {
    const f = _pdcState.filters;
    let active = false;
    if (key === 'all') active = f.pdc_type === 'all' && f.status === 'all' && f.due === 'all';
    else if (key.startsWith('status:')) active = f.status === key.slice(7);
    else if (key === 'received' || key === 'issued') active = f.pdc_type === key;
    else if (key.startsWith('due:')) active = f.due === key.slice(4);
    return `<button class="btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}" style="font-size:11px" onclick="pdcQuickFilter('${key}')">${label}</button>`;
}

function pdcFilterBarHtml() {
    const f = _pdcState.filters;
    const partyOptions = _pdcState.parties
        .map(p => `<option value="${p.id}" ${String(f.party_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
        .join('');
    return `
        <div class="filter-bar" style="flex-wrap:wrap;gap:8px">
            <div class="form-group"><label>Type</label>
                <select class="form-control" id="pdcFType" onchange="pdcApplyFilters()">
                    <option value="all" ${f.pdc_type === 'all' ? 'selected' : ''}>All</option>
                    <option value="received" ${f.pdc_type === 'received' ? 'selected' : ''}>Received</option>
                    <option value="issued" ${f.pdc_type === 'issued' ? 'selected' : ''}>Issued</option>
                </select>
            </div>
            <div class="form-group"><label>Status</label>
                <select class="form-control" id="pdcFStatus" onchange="pdcApplyFilters()">
                    <option value="all" ${f.status === 'all' ? 'selected' : ''}>All</option>
                    ${Object.keys(PDC_STATUS_META).map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${PDC_STATUS_META[s].label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group"><label>Due</label>
                <select class="form-control" id="pdcFDue" onchange="pdcApplyFilters()">
                    <option value="all" ${f.due === 'all' ? 'selected' : ''}>All</option>
                    <option value="today" ${f.due === 'today' ? 'selected' : ''}>Due today</option>
                    <option value="tomorrow" ${f.due === 'tomorrow' ? 'selected' : ''}>Due tomorrow</option>
                    <option value="7" ${f.due === '7' ? 'selected' : ''}>Due in 7 days</option>
                    <option value="30" ${f.due === '30' ? 'selected' : ''}>Due in 30 days</option>
                    <option value="overdue" ${f.due === 'overdue' ? 'selected' : ''}>Overdue</option>
                </select>
            </div>
            <div class="form-group"><label>Party</label>
                <select class="form-control" id="pdcFParty" onchange="pdcApplyFilters()">
                    <option value="">All parties</option>
                    ${partyOptions}
                </select>
            </div>
            <div class="form-group"><label>Bank</label><input type="text" class="form-control" id="pdcFBank" value="${escapeHtml(f.bank_name)}" placeholder="Bank name"></div>
            <div class="form-group"><label>Search</label><input type="text" class="form-control" id="pdcFSearch" value="${escapeHtml(f.search)}" placeholder="Cheque no / PDC no / ref"></div>
            <div class="form-group"><label>Received/Issued from</label><input type="date" class="form-control" id="pdcFFrom" value="${f.from_date}"></div>
            <div class="form-group"><label>to</label><input type="date" class="form-control" id="pdcFTo" value="${f.to_date}"></div>
            <div class="form-group"><label>Cheque date from</label><input type="date" class="form-control" id="pdcFChqFrom" value="${f.cheque_from}"></div>
            <div class="form-group"><label>to</label><input type="date" class="form-control" id="pdcFChqTo" value="${f.cheque_to}"></div>
            <div class="form-group"><label>Amount min</label><input type="number" class="form-control" id="pdcFAmtMin" value="${f.amount_min}" step="0.01"></div>
            <div class="form-group"><label>Amount max</label><input type="number" class="form-control" id="pdcFAmtMax" value="${f.amount_max}" step="0.01"></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="pdcApplyFilters()">Apply</button>
                <button class="btn btn-secondary btn-sm" onclick="pdcResetFilters()">Reset</button>
            </div>
        </div>
    `;
}

/** The table for the active report tab. */
function pdcReportHtml(rows, totalAmount) {
    if (_pdcState.report === 'due') return pdcDueReportHtml();
    if (_pdcState.report === 'bounced') return pdcBouncedReportHtml();

    return `
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Cheque No</th>
                        <th>Party</th>
                        <th>Bank</th>
                        <th class="text-right">Amount</th>
                        <th>Against</th>
                        <th>Cheque Date / Due</th>
                        <th>Status</th>
                        <th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr style="cursor:pointer" onclick="pdcViewDetail(${r.id})">
                            <td style="white-space:nowrap">${formatDate(r.txn_date)}</td>
                            <td>${pdcTypeBadge(r.pdc_type)}</td>
                            <td style="white-space:nowrap"><strong>${escapeHtml(r.cheque_no)}</strong>
                                ${r.pdc_no ? `<div style="font-size:10px;color:var(--text-light)">${escapeHtml(r.pdc_no)}</div>` : ''}</td>
                            <td>${escapeHtml(r.party_name || '-')}</td>
                            <td style="font-size:11px">${escapeHtml(r.bank_name || '-')}</td>
                            <td class="text-right" style="font-weight:600;color:${r.pdc_type === 'received' ? 'var(--accent)' : '#7a4b00'}">${formatCurrency(r.amount)}</td>
                            <td style="font-size:11px;max-width:190px">${escapeHtml(r.against || 'On account')}</td>
                            <td style="font-size:12px;white-space:nowrap">${pdcDueCell(r)}</td>
                            <td>${pdcStatusBadge(r.status)}</td>
                            <td class="actions" onclick="event.stopPropagation()">${pdcRowActions(r)}</td>
                        </tr>
                    `).join('')}
                    ${rows.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No cheques match these filters</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="5"><strong>Total (${rows.length} cheque${rows.length === 1 ? '' : 's'})</strong></td>
                        <td class="text-right"><strong>${formatCurrency(totalAmount)}</strong></td>
                        <td colspan="4"></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function pdcDueReportHtml() {
    const rep = _pdcState.dueReport;
    if (!rep) return '<div style="padding:24px;text-align:center;color:var(--text-light)">Loading…</div>';
    const group = (title, g, color) => `
        <div class="section-title" style="margin-top:14px">${title} — ${g.count} cheque(s), ${formatCurrency(g.amount)}</div>
        <div class="table-container">
            <table>
                <thead><tr><th>Cheque Date</th><th>Type</th><th>Cheque No</th><th>Party</th><th>Bank</th><th class="text-right">Amount</th><th>Against</th><th>Status</th><th>Days</th></tr></thead>
                <tbody>
                    ${g.rows.map(r => `
                        <tr style="cursor:pointer" onclick="pdcViewDetail(${r.id})">
                            <td>${formatDate(r.cheque_date)}</td>
                            <td>${pdcTypeBadge(r.pdc_type)}</td>
                            <td>${escapeHtml(r.cheque_no)}</td>
                            <td>${escapeHtml(r.party_name || '-')}</td>
                            <td>${escapeHtml(r.bank_name || '-')}</td>
                            <td class="text-right">${formatCurrency(r.amount)}</td>
                            <td style="font-size:11px">${escapeHtml(r.against || 'On account')}</td>
                            <td>${pdcStatusBadge(r.status)}</td>
                            <td style="color:${color}" class="text-right">${r.days_until === null ? '-' : r.days_until}</td>
                        </tr>`).join('')}
                    ${g.rows.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:16px;color:var(--text-light)">None</td></tr>' : ''}
                </tbody>
            </table>
        </div>`;
    const G = rep.groups;
    return `
        <div style="font-size:12px;color:var(--text-light);margin-bottom:6px">
            Open cheques only (Held / Deposited). Total outstanding: ${formatCurrency(rep.total_open)} across ${rep.total_open_count} cheque(s).
        </div>
        ${group('Due Today', G.due_today, '#c62828')}
        ${group('Due Tomorrow', G.due_tomorrow, '#e65100')}
        ${group('Due in 1–7 Days', G.due_1_7, '#e65100')}
        ${group('Due in 8–30 Days', G.due_8_30, '#8a6d00')}
        ${group('Due later', G.due_later, '#333')}
        ${group('⚠ Overdue', G.overdue, '#c62828')}
    `;
}

function pdcBouncedReportHtml() {
    const rep = _pdcState.bouncedReport;
    if (!rep) return '<div style="padding:24px;text-align:center;color:var(--text-light)">Loading…</div>';
    return `
        <div class="summary-cards" style="margin-bottom:12px">
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Bounced cheques</span><span class="value">${rep.totals.count}</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Total value</span><span class="value" style="font-size:18px">${formatCurrency(rep.totals.amount)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Bounce charges</span><span class="value" style="font-size:18px">${formatCurrency(rep.totals.charges)}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Bounce Date</th><th>Type</th><th>Cheque No</th><th>Party</th><th class="text-right">Amount</th><th>Reason</th><th class="text-right">Charge</th><th>Related invoice</th><th>Status</th></tr></thead>
                <tbody>
                    ${rep.rows.map(r => `
                        <tr style="cursor:pointer" onclick="pdcViewDetail(${r.id})">
                            <td>${formatDate(r.bounce_date || r.txn_date)}</td>
                            <td>${pdcTypeBadge(r.pdc_type)}</td>
                            <td>${escapeHtml(r.cheque_no)}</td>
                            <td>${escapeHtml(r.party_name || '-')}</td>
                            <td class="text-right">${formatCurrency(r.amount)}</td>
                            <td>${escapeHtml(r.bounce_reason || '-')}</td>
                            <td class="text-right">${formatCurrency(r.bounce_charge || 0)}</td>
                            <td style="font-size:11px">${escapeHtml(r.invoice_list || 'On account')}</td>
                            <td>${pdcStatusBadge(r.status)}</td>
                        </tr>`).join('')}
                    ${rep.rows.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-light)">No bounced cheques in this period</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================================
// Filters
// ============================================================

function pdcReadFilters() {
    const f = _pdcState.filters;
    const val = id => (document.getElementById(id) || {}).value;
    f.pdc_type = val('pdcFType') || 'all';
    f.status = val('pdcFStatus') || 'all';
    f.due = val('pdcFDue') || 'all';
    f.party_id = val('pdcFParty') || '';
    f.bank_name = val('pdcFBank') || '';
    f.search = val('pdcFSearch') || '';
    f.from_date = val('pdcFFrom') || '';
    f.to_date = val('pdcFTo') || '';
    f.cheque_from = val('pdcFChqFrom') || '';
    f.cheque_to = val('pdcFChqTo') || '';
    f.amount_min = val('pdcFAmtMin') || '';
    f.amount_max = val('pdcFAmtMax') || '';
}

function pdcApplyFilters() {
    pdcReadFilters();
    return renderPdcRegister();
}

function pdcResetFilters() {
    _pdcState.filters = {
        pdc_type: 'all', status: 'all', due: 'all', party_id: '', bank_name: '',
        search: '', from_date: '', to_date: '', cheque_from: '', cheque_to: '',
        amount_min: '', amount_max: ''
    };
    renderPdcRegister();
}

function pdcQuickFilter(key) {
    const f = _pdcState.filters;
    if (key === 'all') { f.pdc_type = 'all'; f.status = 'all'; f.due = 'all'; }
    else if (key === 'received' || key === 'issued') { f.pdc_type = key; f.status = 'all'; f.due = 'all'; }
    else if (key.startsWith('status:')) { f.status = key.slice(7); f.pdc_type = 'all'; f.due = 'all'; }
    else if (key.startsWith('due:')) { f.due = key.slice(4); f.status = 'all'; f.pdc_type = 'all'; }
    return renderPdcRegister();
}

function pdcSetReport(kind) {
    _pdcState.report = kind;
    return renderPdcRegister();
}

// ============================================================
// Create / edit a cheque (with invoice allocation)
// ============================================================

async function showPdcFormById(id) {
    const res = await window.api.getPdcCheque(id);
    if (!res.success) { showToast(res.error, 'error'); return; }
    showPdcForm(res.data);
}

async function showPdcForm(existing) {
    const d = existing || { pdc_type: 'received', party_id: '', cheque_no: '', cheque_date: today(), txn_date: today(), bank_name: '', bank_account_no: '', amount: '', reference_no: '', remarks: '', allocations: [] };
    const isExisting = !!(existing && existing.id);
    const locked = isExisting && !['HELD', 'DEPOSITED'].includes(String(existing.status));
    const typeLocked = isExisting && String(existing.status) !== 'HELD';
    const parties = _pdcState.parties.filter(p => {
        if (d.pdc_type === 'received') return ['customer', 'both', 'partner'].includes(p.type);
        return ['supplier', 'both', 'partner'].includes(p.type);
    });

    showModal(`
        <div class="modal-header">
            <h2>${isExisting ? 'Edit' : 'New'} Post-Dated Cheque ${isExisting ? `— ${escapeHtml(existing.pdc_no || '')}` : ''}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${locked ? `<div style="background:#fff4cc;border:1px solid #f0d060;border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px">This cheque is <strong>${escapeHtml(existing.status)}</strong>. The cheque details and amount can no longer be changed — cancel / reverse the cheque instead.</div>` : ''}
            <div class="form-row">
                <div class="form-group"><label>PDC Type *</label>
                    <select class="form-control" id="pdcType" ${typeLocked ? 'disabled' : ''} onchange="pdcFormTypeChanged()">
                        <option value="received" ${d.pdc_type === 'received' ? 'selected' : ''}>PDC Received (from customer)</option>
                        <option value="issued" ${d.pdc_type === 'issued' ? 'selected' : ''}>PDC Issued (to supplier)</option>
                    </select>
                </div>
                <div class="form-group"><label>Party *</label>
                    <select class="form-control" id="pdcParty" ${locked ? 'disabled' : ''} onchange="pdcLoadAllocationDocs()">
                        <option value="">Select party</option>
                        ${parties.map(p => `<option value="${p.id}" ${String(d.party_id) === String(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}${p.party_code ? ' (' + escapeHtml(p.party_code) + ')' : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>Cheque No *</label><input type="text" class="form-control" id="pdcChequeNo" value="${escapeHtml(d.cheque_no)}" ${locked ? 'disabled' : ''} placeholder="123456"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Cheque Date (BS) *</label><input type="date" class="form-control" id="pdcChequeDate" value="${d.cheque_date || today()}" ${locked ? 'disabled' : ''}></div>
                <div class="form-group"><label>${d.pdc_type === 'received' ? 'Received' : 'Issued'} Date (BS)</label><input type="date" class="form-control" id="pdcTxnDate" value="${d.txn_date || today()}"></div>
                <div class="form-group"><label>Amount *</label><input type="number" class="form-control" id="pdcAmount" value="${d.amount || ''}" step="0.01" min="0" ${locked ? 'disabled' : ''} onchange="pdcRecalcAllocation()" onkeyup="pdcRecalcAllocation()"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label>Bank</label><input type="text" class="form-control" id="pdcBank" value="${escapeHtml(d.bank_name)}" placeholder="Nabil Bank" ${locked ? 'disabled' : ''}></div>
                <div class="form-group"><label>Bank Account No</label><input type="text" class="form-control" id="pdcBankAc" value="${escapeHtml(d.bank_account_no)}" ${locked ? 'disabled' : ''}></div>
                <div class="form-group"><label>Invoice / Reference</label><input type="text" class="form-control" id="pdcRef" value="${escapeHtml(d.reference_no)}" placeholder="INV-000125"></div>
            </div>
            <div class="form-group"><label>Remarks</label><textarea class="form-control" id="pdcRemarks" rows="2">${escapeHtml(d.remarks)}</textarea></div>

            <div class="form-section-title">Invoice Allocation (optional — leave empty for On Account)</div>
            <div style="font-size:12px;color:var(--text-light);margin-bottom:6px">
                A received cheque settles <strong>sales invoices</strong>; an issued cheque settles <strong>purchase bills</strong>.
                Whatever is not allocated stays On Account and is settled by the normal payment allocation.
            </div>
            <table class="compact" id="pdcAllocTable">
                <thead><tr><th>Invoice / Bill</th><th class="text-right" style="width:150px">Outstanding</th><th class="text-right" style="width:150px">Allocated</th><th style="width:40px"></th></tr></thead>
                <tbody id="pdcAllocBody"></tbody>
            </table>
            <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px">
                <button class="btn btn-secondary btn-sm" onclick="pdcAddAllocRow()" ${locked ? 'disabled' : ''}>+ Add invoice row</button>
                <div id="pdcAllocSummary" style="font-weight:600"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="savePdcForm(${isExisting ? existing.id : 'null'})">${isExisting ? 'Save Changes' : 'Record Cheque'}</button>
        </div>
    `);

    _pdcFormDocs = [];
    if (d.allocations && d.allocations.length) {
        _pdcFormAllocations = d.allocations.map(a => ({
            invoice_type: a.invoice_type,
            invoice_id: a.invoice_id,
            amount: Number(a.allocated_amount) || 0,
            invoice_no: a.invoice_no
        }));
    } else {
        _pdcFormAllocations = [];
    }
    await pdcLoadAllocationDocs(true);
}

let _pdcFormDocs = [];
let _pdcFormAllocations = [];

/**
 * Switching received ⇄ issued changes who the cheque can belong to and what it
 * settles (sales invoices vs purchase bills), so the form is rebuilt with the
 * values typed so far and the allocation plan cleared.
 */
function pdcFormTypeChanged() {
    const v = id => (document.getElementById(id) || {}).value;
    const d = {
        pdc_type: v('pdcType'),
        party_id: v('pdcParty'),
        cheque_no: v('pdcChequeNo'),
        cheque_date: v('pdcChequeDate'),
        txn_date: v('pdcTxnDate'),
        amount: v('pdcAmount'),
        bank_name: v('pdcBank'),
        bank_account_no: v('pdcBankAc'),
        reference_no: v('pdcRef'),
        remarks: v('pdcRemarks'),
        allocations: []
    };
    showPdcForm(d);
}

/** Load the party's open documents for the allocation table. */
async function pdcLoadAllocationDocs(keepExisting) {
    const party_id = (document.getElementById('pdcParty') || {}).value;
    const pdc_type = (document.getElementById('pdcType') || {}).value || 'received';
    const tbody = document.getElementById('pdcAllocBody');
    if (!tbody) return;
    if (!party_id) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">Select a party to allocate against its invoices</td></tr>';
        _pdcFormDocs = [];
        pdcRecalcAllocation();
        return;
    }
    const res = await window.api.getPdcOpenDocuments({ party_id, pdc_type });
    _pdcFormDocs = res.success ? res.data : [];
    if (!keepExisting) _pdcFormAllocations = [];
    pdcRenderAllocRows();
}

function pdcRenderAllocRows() {
    const tbody = document.getElementById('pdcAllocBody');
    if (!tbody) return;
    tbody.innerHTML = _pdcFormAllocations.map((a, i) => `
        <tr>
            <td><select class="form-control" style="font-size:12px" onchange="pdcAllocChanged(${i},'invoice_id',this.value)">
                <option value="">Select ${a.invoice_type === 'purchase' ? 'bill' : 'invoice'}</option>
                ${_pdcFormDocs.map(doc => `<option value="${doc.id}" ${String(a.invoice_id) === String(doc.id) ? 'selected' : ''}>${escapeHtml(doc.invoice_no)} · ${formatDate(doc.date)} · ${formatCurrency(doc.grand_total)} (due ${formatCurrency(doc.outstanding)})</option>`).join('')}
            </select></td>
            <td class="text-right" style="font-size:11px">${(() => { const d = _pdcFormDocs.find(x => String(x.id) === String(a.invoice_id)); return d ? formatCurrency(d.outstanding) : '-'; })()}</td>
            <td><input type="number" class="form-control text-right" style="font-size:12px" step="0.01" value="${a.amount}" onchange="pdcAllocChanged(${i},'amount',this.value)" onkeyup="pdcAllocChanged(${i},'amount',this.value)"></td>
            <td><button class="btn btn-danger btn-sm" onclick="pdcRemoveAllocRow(${i})">✕</button></td>
        </tr>
    `).join('') + (_pdcFormAllocations.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">No allocation — this cheque will be recorded On Account</td></tr>' : '');
    pdcRecalcAllocation();
}

function pdcAddAllocRow() {
    const pdc_type = (document.getElementById('pdcType') || {}).value || 'received';
    _pdcFormAllocations.push({ invoice_type: pdc_type === 'issued' ? 'purchase' : 'sale', invoice_id: '', amount: 0 });
    pdcRenderAllocRows();
}

function pdcRemoveAllocRow(i) {
    _pdcFormAllocations.splice(i, 1);
    pdcRenderAllocRows();
}

function pdcAllocChanged(i, field, value) {
    if (!_pdcFormAllocations[i]) return;
    if (field === 'amount') _pdcFormAllocations[i].amount = parseFloat(value) || 0;
    else {
        _pdcFormAllocations[i].invoice_id = value;
        // Default the allocation to the invoice's outstanding amount.
        const doc = _pdcFormDocs.find(x => String(x.id) === String(value));
        if (doc && !(Number(_pdcFormAllocations[i].amount) > 0)) {
            _pdcFormAllocations[i].amount = Number(doc.outstanding) || 0;
        }
    }
    pdcRenderAllocRows();
}

function pdcRecalcAllocation() {
    const amount = parseFloat((document.getElementById('pdcAmount') || {}).value) || 0;
    const allocated = _pdcFormAllocations.reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const el = document.getElementById('pdcAllocSummary');
    if (!el) return;
    const remainder = Math.round((amount - allocated) * 100) / 100;
    const over = remainder < -0.005;
    el.innerHTML = `Allocated ${formatCurrency(allocated)} · On account ${formatCurrency(Math.max(0, remainder))}` +
        (over ? ` <span style="color:#c62828">— exceeds the cheque amount</span>` : '');
    el.style.color = over ? '#c62828' : 'var(--text)';
}

async function savePdcForm(id) {
    const data = {
        id: id || undefined,
        pdc_type: (document.getElementById('pdcType') || {}).value,
        party_id: (document.getElementById('pdcParty') || {}).value,
        cheque_no: (document.getElementById('pdcChequeNo') || {}).value,
        cheque_date: (document.getElementById('pdcChequeDate') || {}).value,
        txn_date: (document.getElementById('pdcTxnDate') || {}).value,
        bank_name: (document.getElementById('pdcBank') || {}).value,
        bank_account_no: (document.getElementById('pdcBankAc') || {}).value,
        amount: parseFloat((document.getElementById('pdcAmount') || {}).value) || 0,
        reference_no: (document.getElementById('pdcRef') || {}).value,
        remarks: (document.getElementById('pdcRemarks') || {}).value,
        allocations: _pdcFormAllocations
            .filter(a => a.invoice_id)
            .map(a => ({ invoice_type: a.invoice_type, invoice_id: a.invoice_id, amount: Number(a.amount) || 0 }))
    };

    if (!data.party_id) { showToast('Select the party for this cheque', 'error'); return; }
    if (!data.cheque_no) { showToast('Cheque number is required', 'error'); return; }
    if (!(data.amount > 0)) { showToast('Cheque amount must be greater than 0', 'error'); return; }
    const allocated = data.allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated > data.amount + 0.005) { showToast('Allocation exceeds the cheque amount', 'error'); return; }

    const res = await window.api.savePdcCheque(data);
    if (res.success) {
        closeModal();
        showToast(id ? 'Cheque updated' : `Cheque recorded (${res.data.pdc_no})`, 'success');
        renderPdcRegister();
    } else {
        showToast(res.error, 'error');
    }
}

// ============================================================
// Lifecycle actions
// ============================================================

async function pdcActionModal(id, action) {
    const res = await window.api.getPdcCheque(id);
    if (!res.success) { showToast(res.error, 'error'); return; }
    const c = res.data;
    const titles = { deposit: '🏦 Deposit / Present Cheque', clear: '✅ Mark Cheque as Cleared', bounce: '↩ Mark Cheque as Bounced', cancel: '⛔ Cancel Cheque' };
    const notes = {
        deposit: 'The cheque is presented at the bank. No bank balance changes until it actually clears.',
        clear: c.pdc_type === 'received'
            ? 'The bank credits the money now: the receivable settles and the bank balance increases once.'
            : 'The bank debits the money now: the supplier payable settles and the bank balance decreases once.',
        bounce: c.status === 'CLEARED'
            ? 'This cheque had already cleared — the money will be taken back (receivable/payable and bank restored) and the bounce charge recorded.'
            : 'The cheque was returned unpaid. Nothing was banked, so no money is reversed — only the bounce is recorded.',
        cancel: 'The cheque is cancelled and stays on the register for audit. Nothing has moved, so no money is reversed.'
    };

    showModal(`
        <div class="modal-header">
            <h2>${titles[action]}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="background:#f5f7fa;border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:10px;font-size:13px">
                <strong>${escapeHtml(c.pdc_no || '')}</strong> · ${c.pdc_type === 'received' ? 'Received' : 'Issued'} cheque <strong>${escapeHtml(c.cheque_no)}</strong>
                ${c.bank_name ? ' · ' + escapeHtml(c.bank_name) : ''}<br>
                Party: <strong>${escapeHtml(c.party_name || '')}</strong> · Amount: <strong>${formatCurrency(c.amount)}</strong> · Status: ${pdcStatusBadge(c.status)}
                ${c.allocated_total ? `<br>Allocated: ${escapeHtml(c.against || '')} (${formatCurrency(c.allocated_total)})` : '<br>On account (no invoice allocated)'}
            </div>
            <div style="font-size:12px;color:var(--text-light);margin-bottom:10px">${notes[action]}</div>
            <div class="form-row">
                <div class="form-group"><label>${action === 'clear' ? 'Clearance' : action === 'bounce' ? 'Bounce' : action === 'deposit' ? 'Deposit' : 'Cancellation'} Date (BS) *</label>
                    <input type="date" class="form-control" id="pdcActDate" value="${today()}"></div>
                <div class="form-group"><label>Bank</label><input type="text" class="form-control" id="pdcActBank" value="${escapeHtml(c.bank_name || '')}"></div>
            </div>
            ${action === 'deposit' || action === 'clear' ? `
            <div class="form-row">
                <div class="form-group"><label>Bank Reference</label><input type="text" class="form-control" id="pdcActRef" placeholder="Deposit slip / bank reference"></div>
            </div>` : ''}
            ${action === 'bounce' ? `
            <div class="form-row">
                <div class="form-group"><label>Bounce Reason *</label><input type="text" class="form-control" id="pdcActReason" placeholder="Insufficient funds, signature mismatch…"></div>
                <div class="form-group"><label>Bounce Charge</label><input type="number" class="form-control" id="pdcActCharge" value="0" step="0.01" min="0"></div>
            </div>` : ''}
            ${action === 'cancel' ? `
            <div class="form-group"><label>Cancellation Reason *</label><input type="text" class="form-control" id="pdcActReason" placeholder="Returned by customer, replaced by cash…"></div>` : ''}
            <div class="form-group" style="margin-top:8px"><label>Remarks</label><textarea class="form-control" id="pdcActRemarks" rows="2"></textarea></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="pdcSubmitAction(${id},'${action}')">Confirm</button>
        </div>
    `);
    if (typeof refreshBSDateInputs === 'function') refreshBSDateInputs(document.getElementById('modalContent'));
}

async function pdcSubmitAction(id, action) {
    const payload = {
        id,
        date: (document.getElementById('pdcActDate') || {}).value,
        bank: (document.getElementById('pdcActBank') || {}).value,
        reference: (document.getElementById('pdcActRef') || {}).value,
        reason: (document.getElementById('pdcActReason') || {}).value,
        charge: parseFloat((document.getElementById('pdcActCharge') || {}).value) || 0,
        remarks: (document.getElementById('pdcActRemarks') || {}).value
    };
    if ((action === 'bounce' || action === 'cancel') && !payload.reason) {
        showToast(`A ${action === 'bounce' ? 'bounce' : 'cancellation'} reason is required`, 'error');
        return;
    }
    const fn = { deposit: 'depositPdc', clear: 'clearPdc', bounce: 'bouncePdc', cancel: 'cancelPdc' }[action];
    const res = await window.api[fn](payload);
    if (res.success) {
        closeModal();
        const extra = res.data && res.data.money
            ? ` — bank ${res.data.money.bank_effect > 0 ? '+' : ''}${formatCurrency(res.data.money.bank_effect)}`
            : (res.data && res.data.reversed ? ' — clearance reversed' : '');
        showToast(`Cheque marked ${action === 'deposit' ? 'Deposited' : action === 'clear' ? 'Cleared' : action === 'bounce' ? 'Bounced' : 'Cancelled'}${extra}`, 'success');
        renderPdcRegister();
    } else {
        showToast(res.error, 'error');
    }
}

async function pdcDelete(id) {
    const okDel = await confirmAction('Delete this cheque from the register?', 'Only cheques that never moved money can be deleted.');
    if (!okDel) return;
    const res = await window.api.deletePdcCheque(id);
    if (res.success) { showToast('Cheque deleted', 'success'); renderPdcRegister(); }
    else showToast(res.error, 'error');
}

/** Detail modal: allocations, the money rows and the full audit history. */
async function pdcViewDetail(id) {
    const res = await window.api.getPdcCheque(id);
    if (!res.success) { showToast(res.error, 'error'); return; }
    const c = res.data;
    const money = c.payments || [];
    showModal(`
        <div class="modal-header">
            <h2>🏛 ${escapeHtml(c.pdc_no || 'Cheque')} ${pdcStatusBadge(c.status)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="detail-grid">
                <div class="detail-item"><span class="detail-label">Type</span><span class="detail-value">${c.pdc_type === 'received' ? 'Received' : 'Issued'}</span></div>
                <div class="detail-item"><span class="detail-label">Party</span><span class="detail-value">${escapeHtml(c.party_name || '')}</span></div>
                <div class="detail-item"><span class="detail-label">Cheque No</span><span class="detail-value">${escapeHtml(c.cheque_no)}</span></div>
                <div class="detail-item"><span class="detail-label">Cheque Date</span><span class="detail-value">${formatDate(c.cheque_date)}</span></div>
                <div class="detail-item"><span class="detail-label">Amount</span><span class="detail-value">${formatCurrency(c.amount)}</span></div>
                <div class="detail-item"><span class="detail-label">Bank</span><span class="detail-value">${escapeHtml(c.bank_name || '-')}${c.bank_account_no ? ' · ' + escapeHtml(c.bank_account_no) : ''}</span></div>
                <div class="detail-item"><span class="detail-label">${c.pdc_type === 'received' ? 'Received' : 'Issued'}</span><span class="detail-value">${formatDate(c.txn_date)}</span></div>
                <div class="detail-item"><span class="detail-label">Due</span><span class="detail-value">${c.due_date ? formatDate(c.due_date) + (c.days_until !== null ? ` (${c.days_until} days)` : '') : '—'}</span></div>
                ${c.deposit_date ? `<div class="detail-item"><span class="detail-label">Deposited</span><span class="detail-value">${formatDate(c.deposit_date)}</span></div>` : ''}
                ${c.clearance_date ? `<div class="detail-item"><span class="detail-label">Cleared</span><span class="detail-value">${formatDate(c.clearance_date)}${c.clearance_ref ? ' · ' + escapeHtml(c.clearance_ref) : ''}</span></div>` : ''}
                ${c.bounce_date ? `<div class="detail-item"><span class="detail-label">Bounced</span><span class="detail-value">${formatDate(c.bounce_date)}${c.bounce_reason ? ' · ' + escapeHtml(c.bounce_reason) : ''}</span></div>` : ''}
                ${Number(c.bounce_charge) > 0 ? `<div class="detail-item"><span class="detail-label">Bounce charge</span><span class="detail-value">${formatCurrency(c.bounce_charge)}</span></div>` : ''}
                ${c.cancel_date ? `<div class="detail-item"><span class="detail-label">Cancelled</span><span class="detail-value">${formatDate(c.cancel_date)}${c.cancel_reason ? ' · ' + escapeHtml(c.cancel_reason) : ''}</span></div>` : ''}
                ${c.reference_no ? `<div class="detail-item"><span class="detail-label">Reference</span><span class="detail-value">${escapeHtml(c.reference_no)}</span></div>` : ''}
            </div>
            ${c.remarks ? `<div class="notes-section">${escapeHtml(c.remarks)}</div>` : ''}

            <div class="section-title">Allocation</div>
            <table class="compact">
                <thead><tr><th>Invoice / Bill</th><th>Date</th><th class="text-right">Document total</th><th class="text-right">Allocated</th></tr></thead>
                <tbody>
                    ${(c.allocations || []).map(a => `
                        <tr>
                            <td>${escapeHtml(a.invoice_no || (a.invoice_type === 'on_account' ? 'On account' : '#' + a.invoice_id))}</td>
                            <td>${a.invoice_date ? formatDate(a.invoice_date) : '-'}</td>
                            <td class="text-right">${a.invoice_total != null ? formatCurrency(a.invoice_total) : '-'}</td>
                            <td class="text-right">${formatCurrency(a.allocated_amount)}</td>
                        </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">No allocation — On Account</td></tr>'}
                </tbody>
                <tfoot><tr><td colspan="3"><strong>Allocated / On account</strong></td><td class="text-right"><strong>${formatCurrency(c.allocated_total)} / ${formatCurrency(Math.max(0, Math.round((c.amount - c.allocated_total) * 100) / 100))}</strong></td></tr></tfoot>
            </table>

            <div class="section-title">Accounting effect</div>
            ${money.length ? `
                <div style="font-size:12px;color:var(--text-light);margin-bottom:6px">These are the real receipts/payments this cheque created — the only entries where money moved. A held cheque has none.</div>
                <table class="compact">
                    <thead><tr><th>Date</th><th>Type</th><th>Mode</th><th>Linked to</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>${money.map(m => `<tr><td>${formatDate(m.date)}</td><td>${escapeHtml(m.type)}</td><td>${escapeHtml(m.mode)}</td><td>${escapeHtml(m.reference_type)}${m.reference_id ? ' #' + m.reference_id : ''}</td><td class="text-right">${formatCurrency(m.amount)}</td></tr>`).join('')}</tbody>
                </table>` : `<div style="font-size:13px;color:var(--text-light)">No money has moved for this cheque — the bank balance and the receivable/payable are untouched.</div>`}

            <div class="section-title">Audit history</div>
            <table class="compact">
                <thead><tr><th>When</th><th>By</th><th>Action</th><th>Status</th></tr></thead>
                <tbody>
                    ${(c.history || []).map(h => {
                        let nv = {}; try { nv = JSON.parse(h.new_values || '{}'); } catch (e) { }
                        return `<tr><td>${escapeHtml(h.changed_at || '')}</td><td>${escapeHtml(h.changed_by_name || 'system')}</td><td>${escapeHtml(nv.operation || h.action)}</td><td>${nv.from_status ? escapeHtml(nv.from_status) + ' → ' + escapeHtml(nv.to_status || '') : escapeHtml(nv.status || '')}</td></tr>`;
                    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-light)">No history</td></tr>'}
                </tbody>
            </table>
        </div>
        <div class="modal-footer">
            ${pdcRowActions(c)}
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

// ============================================================
// Print / PDF / Excel
// ============================================================

function pdcReportRowsForExport() {
    if (_pdcState.report === 'due' && _pdcState.dueReport) return _pdcState.dueReport.rows;
    if (_pdcState.report === 'bounced' && _pdcState.bouncedReport) return _pdcState.bouncedReport.rows;
    return _pdcState.rows;
}

function pdcReportTitle() {
    return _pdcState.report === 'due' ? 'PDC Due Report'
        : _pdcState.report === 'bounced' ? 'PDC Bounced Report'
            : 'PDC Register';
}

/** The printable HTML for the active report (shared by Print and PDF). */
async function pdcBuildPrintHtml() {
    const rows = pdcReportRowsForExport();
    if (!rows.length) return null;
    const settings = await getSettingsCached();
    const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>${pdcReportTitle()}</h2>
            <p>Cheques: ${rows.length} | Total: ${formatCurrency(total)} | Cheque register is a memo — bank balance moves only on clearance</p>
        </div>
        <table>
            <thead><tr>
                <th>Date</th><th>Type</th><th>PDC No</th><th>Cheque No</th><th>Party</th><th>Bank</th>
                <th class="text-right">Amount</th><th>Against</th><th>Cheque Date</th><th>Status</th><th>Deposited</th><th>Cleared</th><th>Remarks</th>
            </tr></thead>
            <tbody>
                ${rows.map(r => `
                    <tr>
                        <td>${formatDate(r.txn_date)}</td>
                        <td>${r.pdc_type === 'received' ? 'Received' : 'Issued'}</td>
                        <td>${escapeHtml(r.pdc_no || '')}</td>
                        <td>${escapeHtml(r.cheque_no)}</td>
                        <td>${escapeHtml(r.party_name || '')}</td>
                        <td>${escapeHtml(r.bank_name || '')}</td>
                        <td class="text-right">${formatCurrency(r.amount)}</td>
                        <td>${escapeHtml(r.against || 'On account')}</td>
                        <td>${formatDate(r.cheque_date)}</td>
                        <td>${escapeHtml(PDC_STATUS_META[r.status] ? PDC_STATUS_META[r.status].label : r.status)}</td>
                        <td>${r.deposit_date ? formatDate(r.deposit_date) : '-'}</td>
                        <td>${r.clearance_date ? formatDate(r.clearance_date) : '-'}</td>
                        <td>${escapeHtml(r.bounce_reason || r.cancel_reason || r.remarks || '')}</td>
                    </tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(total)}</strong></td><td colspan="6"></td></tr></tfoot>
        </table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    return html;
}

async function pdcPrint() {
    const html = await pdcBuildPrintHtml();
    if (!html) { showToast('No data to print', 'warning'); return; }
    printHTML(html);
}

async function pdcExportPDF() {
    const html = await pdcBuildPrintHtml();
    if (!html) { showToast('No data to export', 'warning'); return; }
    try {
        const res = await window.api.printToPDF({ html });
        if (!res || res.success === false) showToast((res && res.error) || 'PDF export failed', 'error');
        else showToast('PDF saved' + (res.path ? `: ${res.path}` : ''), 'success');
    } catch (e) {
        showToast('PDF export failed: ' + e.message, 'error');
    }
}

function pdcExportCSV() {
    const rows = pdcReportRowsForExport();
    if (!rows.length) { showToast('No data to export', 'warning'); return; }
    const head = ['Date', 'Type', 'PDC No', 'Cheque No', 'Party', 'Bank', 'Amount', 'Against', 'Cheque Date', 'Due Date', 'Days Until Due', 'Status', 'Deposit Date', 'Clearance Date', 'Bounce Date', 'Bounce Reason', 'Bounce Charge', 'Remarks'];
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(',')];
    for (const r of rows) {
        lines.push([
            r.txn_date, r.pdc_type === 'received' ? 'Received' : 'Issued', r.pdc_no, r.cheque_no,
            r.party_name, r.bank_name, Number(r.amount) || 0, r.against || 'On account', r.cheque_date,
            r.due_date || '', r.days_until === null || r.days_until === undefined ? '' : r.days_until,
            r.status, r.deposit_date || '', r.clearance_date || '', r.bounce_date || '',
            r.bounce_reason || '', Number(r.bounce_charge) || 0, r.remarks || ''
        ].map(esc).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `PDC_${_pdcState.report}_${_pdcState.today || new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Globals
window.renderPdcRegister = renderPdcRegister;
window.pdcApplyFilters = pdcApplyFilters;
window.pdcResetFilters = pdcResetFilters;
window.pdcQuickFilter = pdcQuickFilter;
window.pdcSetReport = pdcSetReport;
window.showPdcForm = showPdcForm;
window.showPdcFormById = showPdcFormById;
window.savePdcForm = savePdcForm;
window.pdcFormTypeChanged = pdcFormTypeChanged;
window.pdcLoadAllocationDocs = pdcLoadAllocationDocs;
window.pdcAddAllocRow = pdcAddAllocRow;
window.pdcRemoveAllocRow = pdcRemoveAllocRow;
window.pdcAllocChanged = pdcAllocChanged;
window.pdcRecalcAllocation = pdcRecalcAllocation;
window.pdcActionModal = pdcActionModal;
window.pdcSubmitAction = pdcSubmitAction;
window.pdcDelete = pdcDelete;
window.pdcViewDetail = pdcViewDetail;
window.pdcPrint = pdcPrint;
window.pdcExportPDF = pdcExportPDF;
window.pdcExportCSV = pdcExportCSV;
window.pdcOpenWithFilter = function (filter) { window._pdcPendingFilter = filter; navigateTo('pdc'); };
