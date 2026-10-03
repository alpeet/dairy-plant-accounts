/**
 * Company Ledger Page (spec Phase 7)
 * ==================================
 * Every major financial movement of the whole business — Income, Expense,
 * Balance Sheet and internal transfers — in one classified ledger with
 * daily / weekly / monthly / custom period subtotals.
 *
 * The numbers come from getCompanyLedger(), which is a READ MODEL over the
 * existing P&L / milk cost / expense summaries and returns its own
 * reconciliation checks. This screen never recalculates anything itself.
 */

let _clState = {
    from_date: '',
    to_date: '',
    granularity: 'monthly',
    data: null
};

function _clDefaultRange() {
    const t = today();
    return { from: `${String(t).slice(0, 7)}-01`, to: t };
}

async function renderCompanyLedger() {
    const container = document.getElementById('page-company-ledger');
    if (!_clState.from_date) {
        const d = _clDefaultRange();
        _clState.from_date = d.from;
        _clState.to_date = d.to;
    }

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-info btn-sm" onclick="companyLedgerPrint()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="companyLedgerCSV()">⬇ CSV</button>
    `;

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar" style="margin:0">
                <div class="form-group"><label>From</label>
                    <input type="date" class="form-control" id="clFrom" value="${_clState.from_date}"></div>
                <div class="form-group"><label>To</label>
                    <input type="date" class="form-control" id="clTo" value="${_clState.to_date}"></div>
                <div class="form-group"><label>Group By</label>
                    <select class="form-control" id="clGranularity">
                        <option value="daily" ${_clState.granularity === 'daily' ? 'selected' : ''}>Daily</option>
                        <option value="weekly" ${_clState.granularity === 'weekly' ? 'selected' : ''}>Weekly</option>
                        <option value="monthly" ${_clState.granularity === 'monthly' ? 'selected' : ''}>Monthly</option>
                        <option value="custom" ${_clState.granularity === 'custom' ? 'selected' : ''}>Custom range (one total)</option>
                    </select></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="companyLedgerLoad()">Apply</button></div>
                <div class="form-group"><label>Quick</label>
                    <span style="display:flex;gap:6px">
                        <button class="btn btn-secondary btn-sm" onclick="companyLedgerQuick('today')">Today</button>
                        <button class="btn btn-secondary btn-sm" onclick="companyLedgerQuick('month')">This Month</button>
                    </span></div>
            </div>
        </div>
        <div id="clBody"><div class="loading" style="text-align:center;padding:40px">Loading company ledger…</div></div>
    `;

    await companyLedgerLoad();
}

async function companyLedgerLoad() {
    const body = document.getElementById('clBody');
    if (!body) return;
    _clState.from_date = document.getElementById('clFrom')?.value || _clState.from_date;
    _clState.to_date = document.getElementById('clTo')?.value || _clState.to_date;
    _clState.granularity = document.getElementById('clGranularity')?.value || _clState.granularity;

    const result = await window.api.getCompanyLedger({
        from_date: _clState.from_date,
        to_date: _clState.to_date,
        granularity: _clState.granularity
    });
    if (!result || !result.success) {
        body.innerHTML = `<div style="padding:20px;color:var(--danger)">Could not load the company ledger: ${escapeHtml((result && result.error) || 'unknown error')}</div>`;
        return;
    }
    _clState.data = result.data;
    _clRender(result.data);
}

function companyLedgerQuick(which) {
    const t = today();
    if (which === 'today') { _clState.from_date = t; _clState.to_date = t; }
    if (which === 'month') { _clState.from_date = `${String(t).slice(0, 7)}-01`; _clState.to_date = t; }
    const f = document.getElementById('clFrom'); if (f) f.value = _clState.from_date;
    const to = document.getElementById('clTo'); if (to) to.value = _clState.to_date;
    companyLedgerLoad();
}

function _clBadge(category) {
    const map = {
        'Income': 'badge-success',
        'Expense': 'badge-danger',
        'Balance Sheet': 'badge-info',
        'Transfer': 'badge-secondary'
    };
    return `<span class="badge ${map[category] || 'badge-info'}">${escapeHtml(category)}</span>`;
}

function _clRender(d) {
    const body = document.getElementById('clBody');
    if (!body) return;
    const t = d.totals;
    const checksOk = d.all_checks_ok;
    const failing = (d.checks || []).filter(c => !c.ok);

    const periodRows = (d.periods || []).map(p => `
        <tr>
            <td><strong>${escapeHtml(p.label)}</strong></td>
            <td class="text-right">${p.rows}</td>
            <td class="text-right">${formatCurrency(p.income)}</td>
            <td class="text-right">${formatCurrency(p.expenses)}</td>
            <td class="text-right" style="color:${p.net >= 0 ? 'var(--success, #16a34a)' : 'var(--danger)'};font-weight:700">${formatCurrency(p.net)}</td>
        </tr>`).join('');

    const rowHtml = (r, i) => `
        <tr>
            <td style="white-space:nowrap">${formatDate(r.date)}</td>
            <td style="font-size:12px">${escapeHtml(r.reference || '')}</td>
            <td style="white-space:nowrap">${escapeHtml(r.type)}</td>
            <td>${escapeHtml(r.particular || '')}</td>
            <td class="text-right" style="font-variant-numeric:tabular-nums">${r.debit ? formatCurrency(r.debit) : ''}</td>
            <td class="text-right" style="font-variant-numeric:tabular-nums">${r.credit ? formatCurrency(r.credit) : ''}</td>
            <td class="text-right" style="font-variant-numeric:tabular-nums;font-weight:600">${formatCurrency(r.balance)}</td>
            <td>${_clBadge(r.category)}</td>
        </tr>`;

    body.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Income</span>
                <span class="value" style="font-size:20px">${formatCurrency(t.income)}</span>
                <span class="sub">Sales ${formatCurrency(t.sales)} · Other ${formatCurrency(t.other_income)}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Expenses</span>
                <span class="value" style="font-size:20px">${formatCurrency(t.expenses)}</span>
                <span class="sub">Milk ${formatCurrency(t.milk_procurement)} · Purchases ${formatCurrency(t.purchases)} · Operating ${formatCurrency(t.operating_expenses)}</span>
            </div>
            <div class="summary-card ${t.net >= 0 ? 'card-success' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">Net (Income − Expenses)</span>
                <span class="value" style="font-size:20px">${formatCurrency(t.net)}</span>
                <span class="sub">Equals the P&amp;L net profit for the period</span>
            </div>
            <div class="summary-card ${checksOk ? 'card-success' : 'card-warning'}" style="margin:0;padding:12px">
                <span class="label">Reconciliation</span>
                <span class="value" style="font-size:18px">${checksOk ? '✅ All checks pass' : `⚠️ ${failing.length} mismatch`}</span>
                <span class="sub">Ledger vs P&amp;L · milk cost · expense summary</span>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px;padding:10px 14px">
            <span style="font-size:13px;color:var(--text-light)">
                Balance-sheet movements (never P&amp;L): Advance paid <strong>${formatCurrency(t.balance_sheet_debit)}</strong> debit side ·
                Loans received <strong>${formatCurrency(t.balance_sheet_credit)}</strong> credit side ·
                Internal transfers <strong>${formatCurrency(t.transfers)}</strong> (net zero) ·
                ${t.row_count} rows · Debit total ${formatCurrency(t.debit_total)} · Credit total ${formatCurrency(t.credit_total)}
            </span>
        </div>

        <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h2>Period Summary — ${_clState.granularity}</h2></div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Period</th><th class="text-right">Rows</th><th class="text-right">Income</th><th class="text-right">Expenses</th><th class="text-right">Net</th></tr></thead>
                    <tbody>${periodRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-light)">No movements in this range</td></tr>'}</tbody>
                </table>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Company Ledger — ${formatDate(d.from_date)} → ${formatDate(d.to_date)}</h2>
                <span style="font-size:12px;color:var(--text-light)">Balance column = running (credit − debit) across all rows</span>
            </div>
            <div class="table-container" style="max-height:60vh;overflow:auto">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th><th>Reference</th><th>Type</th><th>Particular</th>
                            <th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th><th>Category</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${d.rows.length ? d.rows.map(rowHtml).join('')
                            : '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No financial movements in this date range.</td></tr>'}
                    </tbody>
                    <tfoot>
                        <tr style="font-weight:700;background:var(--bg)">
                            <td colspan="4">Totals</td>
                            <td class="text-right">${formatCurrency(t.debit_total)}</td>
                            <td class="text-right">${formatCurrency(t.credit_total)}</td>
                            <td class="text-right">${formatCurrency(t.net)}</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        <div class="card" style="margin-top:16px">
            <div class="card-header"><h2>Reconciliation — ledger vs authoritative summaries</h2></div>
            <div style="padding:10px 14px">
                ${(d.checks || []).map(c => `
                    <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
                        <span>${c.ok ? '✅' : '❌'} ${escapeHtml(c.name)}</span>
                        <span style="font-family:monospace">${escapeHtml(String(c.expected))} ${c.ok ? '=' : '≠'} ${escapeHtml(String(c.actual))}</span>
                    </div>`).join('')}
            </div>
        </div>
    `;
}

// ── Print / CSV ──────────────────────────────────────────────
async function companyLedgerPrint() {
    const d = _clState.data;
    if (!d || !d.rows.length) { showToast('No data to print', 'warning'); return; }
    const settings = await getSettingsCached();
    const esc = v => escapeHtml(v == null ? '' : String(v));
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1>
            <h2>Company Ledger — ${formatDate(d.from_date)} to ${formatDate(d.to_date)} (${d.granularity})</h2></div>
        <table><thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Particular</th>
            <th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th><th>Category</th></tr></thead>
        <tbody>
            ${d.rows.map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.reference)}</td><td>${esc(r.type)}</td><td>${esc(r.particular)}</td>
                <td style="text-align:right">${r.debit ? formatCurrency(r.debit) : ''}</td>
                <td style="text-align:right">${r.credit ? formatCurrency(r.credit) : ''}</td>
                <td style="text-align:right">${formatCurrency(r.balance)}</td><td>${esc(r.category)}</td></tr>`).join('')}
            <tr><td colspan="4"><strong>Totals</strong></td>
                <td style="text-align:right"><strong>${formatCurrency(d.totals.debit_total)}</strong></td>
                <td style="text-align:right"><strong>${formatCurrency(d.totals.credit_total)}</strong></td>
                <td style="text-align:right"><strong>${formatCurrency(d.totals.net)}</strong></td><td></td></tr>
        </tbody>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>`;
    printHTML(html);
}

function companyLedgerCSV() {
    const d = _clState.data;
    if (!d || !d.rows.length) { showToast('No data to export', 'warning'); return; }
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [['Date', 'Reference', 'Type', 'Particular', 'Debit', 'Credit', 'Balance', 'Category'].map(esc).join(',')];
    for (const r of d.rows) {
        lines.push([r.date, r.reference, r.type, r.particular, r.debit || 0, r.credit || 0, r.balance, r.category].map(esc).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Company_Ledger_${d.from_date}_${d.to_date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// Globals
window.renderCompanyLedger = renderCompanyLedger;
window.companyLedgerLoad = companyLedgerLoad;
window.companyLedgerQuick = companyLedgerQuick;
window.companyLedgerPrint = companyLedgerPrint;
window.companyLedgerCSV = companyLedgerCSV;
