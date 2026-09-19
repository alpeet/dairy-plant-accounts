/**
 * Data Integrity Doctor — read-only diagnostics screen
 * ===================================================
 * Shows the result of shared/operations/integrity.js:
 *   · stock re-derived from the movement ledger
 *   · party balances re-derived from their documents
 *   · document / register cross-checks
 *
 * Nothing on this screen writes to the database — every statement the
 * backend runs is a SELECT or PRAGMA, and the module itself refuses
 * anything else.
 */

// ── Module state ──
window._integrityState = window._integrityState || {
    report: null,
    problemsOnly: true,
    severity: 'all',
    only: '',
    limit: 100
};

async function renderIntegrityDoctor() {
    const container = document.getElementById('page-integrity');
    if (!container) return;

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="runIntegrityDoctor()">🔄 Run checks</button>
        <button class="btn btn-info btn-sm" onclick="printIntegrityReport()">🖨 Print</button>
        <button class="btn btn-secondary btn-sm" onclick="exportIntegrityCSV()">⬇ CSV</button>
    `;

    const s = window._integrityState;
    if (!s.report) {
        await runIntegrityDoctor();
        return;
    }
    renderIntegrityReport();
}

async function runIntegrityDoctor() {
    const container = document.getElementById('page-integrity');
    const s = window._integrityState;

    s.limit = parseInt(document.getElementById('integrityLimit')?.value, 10) || s.limit;
    s.only = document.getElementById('integrityScope')?.value || s.only;
    s.problemsOnly = document.getElementById('integrityProblemsOnly') ? document.getElementById('integrityProblemsOnly').checked : s.problemsOnly;
    s.severity = document.getElementById('integritySeverity')?.value || s.severity;

    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Running integrity checks… (read-only)</div>';

    const result = await window.api.runIntegrityCheck({ limit: s.limit, only: s.only });

    if (!result || !result.success) {
        container.innerHTML = `<div class="card"><div class="card-header"><h2>Integrity Doctor</h2></div>
            <div style="padding:20px;color:var(--danger)">
                Could not run the checks: ${escapeHtml((result && result.error) || 'unknown error')}
            </div></div>`;
        return;
    }

    s.report = result.data;
    renderIntegrityReport();
}

function _integritySeverityLabel(sev) {
    return { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }[sev] || sev;
}

function _integrityStatusBadge(check) {
    if (check.status === 'pass') return '<span class="badge badge-success">PASS</span>';
    if (check.status === 'error') return '<span class="badge badge-warning">COULD NOT RUN</span>';
    return '<span class="badge badge-danger">FAIL</span>';
}

function _integritySeverityBadge(sev) {
    const cls = { critical: 'badge-danger', high: 'badge-danger', medium: 'badge-warning', low: 'badge-info', info: 'badge-info' }[sev] || 'badge-info';
    return `<span class="badge ${cls}">${_integritySeverityLabel(sev)}</span>`;
}

function renderIntegrityReport() {
    const container = document.getElementById('page-integrity');
    const s = window._integrityState;
    const report = s.report;
    if (!report) return;

    const sum = report.summary;
    const bySev = sum.by_severity || {};
    const sevFilter = s.severity;

    const checks = report.checks.filter((c) => {
        if (s.problemsOnly && c.status === 'pass') return false;
        if (sevFilter !== 'all' && c.severity !== sevFilter) return false;
        return true;
    });

    const healthClass = sum.failed === 0 && sum.errored === 0 ? 'card-success' : (sum.errored ? 'card-warning' : 'card-danger');
    const when = new Date(report.generated_at);

    const issueTotal = report.checks.reduce((n, c) => n + c.issue_count, 0);

    container.innerHTML = `
        <div class="summary-cards" style="margin-bottom:14px">
            <div class="summary-card ${healthClass}">
                <span class="label">Overall</span>
                <span class="value" style="font-size:20px">${sum.failed === 0 && sum.errored === 0 ? 'Reconciled' : `${sum.failed} check(s) failing`}</span>
                <span class="sub">${escapeHtml(sum.headline)}</span>
            </div>
            <div class="summary-card card-primary">
                <span class="label">Checks run</span>
                <span class="value">${sum.checks_run}</span>
                <span class="sub">${sum.passed} passed${sum.errored ? ` · ${sum.errored} could not run` : ''}</span>
            </div>
            <div class="summary-card ${issueTotal ? 'card-warning' : 'card-success'}">
                <span class="label">Findings</span>
                <span class="value">${issueTotal}</span>
                <span class="sub">${escapeHtml([
                    bySev.critical ? `${bySev.critical} critical` : '',
                    bySev.high ? `${bySev.high} high` : '',
                    bySev.medium ? `${bySev.medium} medium` : '',
                    bySev.info ? `${bySev.info} info` : ''
                ].filter(Boolean).join(' · ') || 'nothing to report')}</span>
            </div>
            <div class="summary-card card-info">
                <span class="label">Run</span>
                <span class="value" style="font-size:18px">${report.duration_ms} ms</span>
                <span class="sub">${when.toLocaleString()}</span>
            </div>
        </div>

        <div class="card" style="margin-bottom:14px;border-left:4px solid var(--accent,#1e8e4e)">
            <div style="padding:12px 16px;font-size:13px;color:var(--text-light)">
                🔒 <strong>Read-only.</strong> This screen only reads the database: it re-derives stock from
                the movement ledger and each party's balance from their documents, then lists whatever does
                not reconcile. Nothing here changes data — fixes are made on the normal screens.
                ${report.database ? `<br>Database file: <code>${escapeHtml(report.database)}</code>` : ''}
            </div>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Scope</label>
                    <select class="form-control" id="integrityScope" onchange="runIntegrityDoctor()">
                        <option value="">All checks</option>
                        ${(report.categories || []).map((c) => `<option value="${escapeHtml(c)}" ${s.only === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Severity</label>
                    <select class="form-control" id="integritySeverity" onchange="applyIntegrityFilters()">
                        <option value="all">All</option>
                        ${['critical', 'high', 'medium', 'info'].map((v) => `<option value="${v}" ${s.severity === v ? 'selected' : ''}>${_integritySeverityLabel(v)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Findings per check</label>
                    <input type="number" class="form-control" id="integrityLimit" min="1" max="1000" value="${s.limit}"
                           onchange="runIntegrityDoctor()" title="How many findings to load per check">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
                        <input type="checkbox" id="integrityProblemsOnly" ${s.problemsOnly ? 'checked' : ''} onchange="applyIntegrityFilters()">
                        Problems only
                    </label>
                </div>
            </div>
        </div>

        ${checks.length === 0
            ? `<div class="card"><div style="padding:40px;text-align:center;color:var(--text-light)">
                    Nothing to show with the current filters — every check in scope passed. 🎉
               </div></div>`
            : checks.map(renderIntegrityCheckCard).join('')}
    `;
}

function applyIntegrityFilters() {
    const s = window._integrityState;
    s.severity = document.getElementById('integritySeverity')?.value || 'all';
    const po = document.getElementById('integrityProblemsOnly');
    if (po) s.problemsOnly = po.checked;
    renderIntegrityReport();
}

function renderIntegrityCheckCard(check) {
    const border = check.status === 'pass' ? '#d4edda' : (check.status === 'error' ? '#fff3cd' : '#f8d7da');

    return `
        <div class="card" style="margin-bottom:14px;border-left:4px solid ${border}">
            <div class="card-header" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                <h2 style="margin:0;font-size:15px">${escapeHtml(check.title)}</h2>
                ${_integrityStatusBadge(check)}
                ${check.status !== 'pass' ? _integritySeverityBadge(check.severity) : ''}
                <span style="margin-left:auto;font-size:12px;color:var(--text-light)">
                    ${check.issue_count > 0 ? `<strong>${check.issue_count}</strong> finding(s) · ` : ''}${formatNumber(check.scanned)} ${escapeHtml(check.scanned_label)} checked
                </span>
            </div>
            <div style="padding:0 16px 12px">
                <div style="font-size:12px;color:var(--text-light);margin-bottom:8px">${escapeHtml(check.what)}</div>
                ${check.error ? `<div style="padding:10px;background:#fff3cd;border-radius:6px;font-size:13px">⚠️ Could not run: ${escapeHtml(check.error)}</div>` : ''}
                ${check.note ? `<div style="padding:10px;background:#f6f8fa;border-radius:6px;font-size:12px;color:var(--text-light)">${escapeHtml(check.note)}</div>` : ''}
                ${check.issues.length ? `
                    <div class="table-container" style="max-height:420px;overflow-y:auto;margin-top:8px">
                        <table>
                            <thead>
                                <tr>
                                    <th>Reference</th>
                                    <th>Problem</th>
                                    <th class="text-right">Expected</th>
                                    <th class="text-right">Found</th>
                                    <th class="text-right">Difference</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${check.issues.map((i) => `
                                    <tr>
                                        <td style="font-size:12px;max-width:260px">${escapeHtml(i.label)}</td>
                                        <td style="font-size:12px">
                                            ${escapeHtml(i.problem)}
                                            ${i.detail ? `<div style="color:var(--text-light);font-size:11px;margin-top:2px">${escapeHtml(i.detail)}</div>` : ''}
                                        </td>
                                        <td class="text-right" style="font-size:12px;white-space:nowrap">${escapeHtml(String(i.expected))}</td>
                                        <td class="text-right" style="font-size:12px;white-space:nowrap">${escapeHtml(String(i.actual))}</td>
                                        <td class="text-right" style="font-size:12px;white-space:nowrap;font-weight:600">${escapeHtml(String(i.difference))}</td>
                                    </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    ${check.truncated ? `<div style="font-size:12px;color:var(--warning,#856404);margin-top:6px">
                        Showing the first ${check.issues.length} of ${check.issue_count} findings — raise “Findings per check” to see more.
                    </div>` : ''}
                ` : ''}
            </div>
        </div>
    `;
}

/** Every finding in the current report, flattened (used by print + CSV). */
function _integrityFlatten() {
    const report = window._integrityState.report;
    if (!report) return [];
    const rows = [];
    for (const c of report.checks) {
        for (const i of c.issues) {
            rows.push({
                category: c.category,
                check: c.title,
                severity: c.severity,
                label: i.label,
                problem: i.problem,
                expected: i.expected,
                actual: i.actual,
                difference: i.difference,
                detail: i.detail
            });
        }
    }
    return rows;
}

async function printIntegrityReport() {
    const report = window._integrityState.report;
    if (!report) { showToast('Run the checks first', 'warning'); return; }

    const settings = await getSettingsCached();
    const failing = report.checks.filter((c) => c.status !== 'pass');
    const rows = _integrityFlatten();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Data Integrity Report')}</h1>
            <h2>Data Integrity Check — read-only</h2>
            <p>Run at ${new Date(report.generated_at).toLocaleString()} · ${report.summary.headline}</p>
        </div>
        <table>
            <thead><tr><th>Check</th><th>Scope</th><th>Status</th><th class="text-right">Findings</th></tr></thead>
            <tbody>
                ${report.checks.map((c) => `<tr>
                    <td>${escapeHtml(c.title)}</td>
                    <td>${escapeHtml(c.category)}</td>
                    <td>${c.status === 'pass' ? 'Pass' : (c.status === 'error' ? 'Could not run' : 'Fail')}</td>
                    <td class="text-right">${c.issue_count}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        ${rows.length ? `
            <h3>Findings (${rows.length})</h3>
            <table>
                <thead><tr><th>Check</th><th>Reference</th><th>Problem</th><th class="text-right">Expected</th><th class="text-right">Found</th><th class="text-right">Difference</th></tr></thead>
                <tbody>
                    ${rows.map((r) => `<tr>
                        <td>${escapeHtml(r.check)}</td>
                        <td>${escapeHtml(r.label)}</td>
                        <td>${escapeHtml(r.problem)}${r.detail ? `<br><span style="font-size:9px">${escapeHtml(r.detail)}</span>` : ''}</td>
                        <td class="text-right">${escapeHtml(String(r.expected))}</td>
                        <td class="text-right">${escapeHtml(String(r.actual))}</td>
                        <td class="text-right">${escapeHtml(String(r.difference))}</td>
                    </tr>`).join('')}
                </tbody>
            </table>` : '<p>No findings — every check passed.</p>'}
        <div class="footer">
            <div>${failing.length} of ${report.checks.length} checks reported problems · ${rows.length} finding(s)</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

function exportIntegrityCSV() {
    const report = window._integrityState.report;
    if (!report) { showToast('Run the checks first', 'warning'); return; }
    const rows = _integrityFlatten();
    if (!rows.length) { showToast('No findings to export', 'warning'); return; }

    const headers = ['Category', 'Check', 'Severity', 'Reference', 'Problem', 'Expected', 'Found', 'Difference', 'Detail'];
    const esc = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [headers.join(',')]
        .concat(rows.map((r) => [r.category, r.check, r.severity, r.label, r.problem, r.expected, r.actual, r.difference, r.detail].map(esc).join(',')))
        .join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `integrity-report-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`${rows.length} finding(s) exported`);
}

// Globals
window.renderIntegrityDoctor = renderIntegrityDoctor;
window.runIntegrityDoctor = runIntegrityDoctor;
window.applyIntegrityFilters = applyIntegrityFilters;
window.printIntegrityReport = printIntegrityReport;
window.exportIntegrityCSV = exportIntegrityCSV;
