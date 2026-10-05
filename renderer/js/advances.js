/**
 * Advance Recovery Register (spec Phases 9–10)
 * ============================================
 * Every advance the company has given, what came back as cash, what was
 * adjusted against an approved expense, what is still outstanding, and how
 * old it is (7 / 30 / 60 / 90+ days).
 *
 *   Outstanding = Advance Given − Returned − Properly Adjusted
 *
 * All numbers come from getAdvanceRecoveryRegister() — the same tagged
 * ledger rows the Advance Receivable balance is built from — so the register
 * can never drift from the balance sheet. This screen never recalculates.
 */

let _advState = { as_of: '', from: '', data: null };

async function renderAdvances() {
    const container = document.getElementById('page-advances');
    if (!_advState.as_of) _advState.as_of = today();

    document.getElementById('topActions').innerHTML = `
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
                    <input type="date" class="form-control" id="advFrom" value="${_advState.from || ''}"></div>
                <div class="form-group"><label>To (as of)</label>
                    <input type="date" class="form-control" id="advTo" value="${_advState.as_of}"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="advancesLoad()">Apply</button></div>
                <div class="form-group" style="flex:1"><label>&nbsp;</label>
                    <div style="font-size:12px;color:var(--text-light);padding-top:6px">
                        Record an advance with <strong>Payment → Advance</strong>, a cash return with <strong>Advance Returned</strong>,
                        and consumption with <strong>Advance Adjustment</strong>. Advances never appear in the P&amp;L.
                        Leave <em>From</em> empty for all history; <em>To</em> is the as-of cutoff.
                    </div></div>
            </div>
        </div>
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
    const result = await window.api.getAdvanceRecoveryRegister(opts);
    if (!result || !result.success) {
        body.innerHTML = `<div style="padding:20px;color:var(--danger)">Could not load the advance register: ${escapeHtml((result && result.error) || 'unknown error')}</div>`;
        return;
    }
    _advState.data = result.data;
    _advRender(result.data);
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
