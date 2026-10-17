/**
 * Monthly Report page
 * ===================
 * One BS period (a single month, a custom range, month-to-date, previous month,
 * year-to-date or all history) → the period's profit & loss AND the closing
 * balance sheet of every month inside it, with income/expense heads and the
 * reconciliation checks that stand behind each figure.
 *
 * Every number comes from shared/operations/monthly_report.js — the backend
 * engine also used by the Excel sheet, so screen and workbook cannot disagree.
 * This page never recalculates anything.
 */

let _mrMonth = {
    mode: 'month',            // month | range | mtd | last_month | ytd | all
    month: '',                // BS 'YYYY-MM'
    from: '',
    to: '',
    tab: 'summary',           // summary | income | expense | monthly | reconcile
    data: null,
    prepaid: null
};

function _mrMoney(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v) || 0;
    const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '(' + s + ')' : s);
}

function _mrToday() { return (window.NepaliDate && NepaliDate.getToday()) || todayBS(); }

function _mrMonthRange(key) {
    return (window.NepaliDate && NepaliDate.getMonthRange) ? NepaliDate.getMonthRange(key) : null;
}

function _mrDefaults() {
    const t = _mrToday();
    const thisMonth = String(t).slice(0, 7);
    if (!_mrMonth.month) _mrMonth.month = thisMonth;
    if (!_mrMonth.from) _mrMonth.from = thisMonth + '-01';
    if (!_mrMonth.to) _mrMonth.to = t;
}

/** Resolve the selected mode into a BS from/to pair. */
function _mrResolveRange() {
    const t = _mrToday();
    const thisMonth = String(t).slice(0, 7);
    switch (_mrMonth.mode) {
        case 'mtd':
            return { from_date: thisMonth + '-01', to_date: t };
        case 'last_month': {
            const prev = (window.NepaliDate && NepaliDate.shiftMonth)
                ? NepaliDate.shiftMonth(thisMonth, -1)
                : thisMonth;
            const r = _mrMonthRange(prev) || { from_date: prev + '-01', to_date: prev + '-30' };
            return { from_date: r.from_date, to_date: r.to_date };
        }
        case 'ytd':
            return { from_date: t.slice(0, 4) + '-01-01', to_date: t };
        case 'all':
            return { from_date: `${(window.NepaliDate && NepaliDate.MIN_YEAR) || 2000}-01-01`, to_date: t };
        case 'range':
            return { from_date: _mrMonth.from, to_date: _mrMonth.to };
        case 'month':
        default: {
            const r = _mrMonthRange(_mrMonth.month);
            return r ? { from_date: r.from_date, to_date: r.to_date } : { from_date: _mrMonth.from, to_date: _mrMonth.to };
        }
    }
}

async function renderMonthlyReport() {
    _mrDefaults();
    _mrMonth.data = null;
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="mrExportExcel()">📊 Export Excel</button>
        <button class="btn btn-info btn-sm" onclick="mrPrint()">🖨 Print</button>
    `;
    const container = document.getElementById('page-monthly-report');
    container.innerHTML = `
        <div id="mrFilters"></div>
        <div id="mrBody"><div class="loading" style="text-align:center;padding:40px">Loading…</div></div>
    `;
    _mrRenderFilters();
    await mrLoad();
}

function _mrRenderFilters() {
    const hosts = document.getElementById('mrFilters');
    if (!hosts) return;
    const t = _mrToday();
    const years = [];
    const y = parseInt(t.slice(0, 4), 10);
    for (let i = y + 1; i >= y - 3; i--) years.push(i);
    const sel = (v, cur) => (String(v) === String(cur) ? ' selected' : '');
    const monthOpts = (window.BS_MONTHS_EN || []).map((name, i) => {
        const val = String(i + 1).padStart(2, '0');
        return `<option value="${val}"${sel(val, _mrMonth.month.slice(5, 7))}>${name} / ${(window.BS_MONTHS_NP || [])[i] || ''}</option>`;
    }).join('');

    hosts.innerHTML = `
        <div class="card" style="margin-bottom:14px"><div class="filter-bar" style="margin:0;flex-wrap:wrap">
            <div class="form-group"><label>Period</label>
                <select class="form-control" id="mrMode" onchange="mrSetMode(this.value)">
                    <option value="month"${sel('month', _mrMonth.mode)}>One BS Month</option>
                    <option value="range"${sel('range', _mrMonth.mode)}>Custom BS Range</option>
                    <option value="mtd"${sel('mtd', _mrMonth.mode)}>Month to Date</option>
                    <option value="last_month"${sel('last_month', _mrMonth.mode)}>Previous Month</option>
                    <option value="ytd"${sel('ytd', _mrMonth.mode)}>Year to Date</option>
                    <option value="all"${sel('all', _mrMonth.mode)}>All History</option>
                </select></div>
            <div class="form-group" ${_mrMonth.mode === 'month' || _mrMonth.mode === 'last_month' ? '' : 'style="display:none"'}>
                <label>BS Month</label>
                <div style="display:flex;gap:6px">
                    <select class="form-control" id="mrYear" onchange="mrPickMonth()">${years.map(v => `<option value="${v}"${sel(v, _mrMonth.month.slice(0, 4))}>${v} BS</option>`).join('')}</select>
                    <select class="form-control" id="mrMonthSel" onchange="mrPickMonth()">${monthOpts}</select>
                </div>
            </div>
            <div class="form-group" ${_mrMonth.mode === 'range' ? '' : 'style="display:none"'}>
                <label>Start (BS)</label><input type="date" class="form-control" id="mrFrom" value="${_mrMonth.from}"></div>
            <div class="form-group" ${_mrMonth.mode === 'range' ? '' : 'style="display:none"'}>
                <label>End (BS)</label><input type="date" class="form-control" id="mrTo" value="${_mrMonth.to}"></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="mrApply()">📊 Generate Report</button></div>
            <div class="form-group" style="flex:1"><label>&nbsp;</label>
                <div id="mrRangeHint" style="font-size:12px;color:var(--text-light);padding-top:6px"></div></div>
        </div></div>
        <div id="mrTabs"></div>
    `;
    if (typeof refreshBSDateInputs === 'function') refreshBSDateInputs(document.getElementById('mrFilters'));
    _mrShowRangeHint();
}

function _mrShowRangeHint() {
    const hint = document.getElementById('mrRangeHint');
    if (!hint) return;
    const r = _mrResolveRange();
    const ad = (window.NepaliDate && NepaliDate.bsToAD) ? NepaliDate.bsToAD(r.to_date) : '';
    hint.textContent = `Period: ${r.from_date} → ${r.to_date} (BS)${ad ? ` · ends AD ${ad}` : ''}`;
}

function mrSetMode(mode) {
    _mrMonth.mode = mode;
    _mrRenderFilters();
}

function mrPickMonth() {
    const y = document.getElementById('mrYear').value;
    const m = document.getElementById('mrMonthSel').value;
    _mrMonth.month = `${y}-${m}`;
    _mrShowRangeHint();
}

function mrApply() {
    const fromEl = document.getElementById('mrFrom');
    const toEl = document.getElementById('mrTo');
    if (_mrMonth.mode === 'range') {
        const check = (window.NepaliDate && NepaliDate.validateRange)
            ? NepaliDate.validateRange(fromEl.value, toEl.value) : { valid: true };
        if (!check.valid) {
            showToast('⚠️ ' + check.reason, 'error');
            return;
        }
        _mrMonth.from = check.from_date;
        _mrMonth.to = check.to_date;
        if (fromEl.value !== _mrMonth.from) setBSDateValue(fromEl, _mrMonth.from);
        if (toEl.value !== _mrMonth.to) setBSDateValue(toEl, _mrMonth.to);
    }
    mrLoad();
}

function mrSetTab(tab) {
    _mrMonth.tab = tab;
    _mrRenderTabs();
    mrRenderBody();
}

function _mrRenderTabs() {
    const tabs = document.getElementById('mrTabs');
    if (!tabs) return;
    const btn = (key, label) => `<button class="btn btn-sm ${_mrMonth.tab === key ? 'btn-primary' : 'btn-secondary'}" onclick="mrSetTab('${key}')">${label}</button>`;
    tabs.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        ${btn('summary', '📋 Summary')}
        ${btn('income', '💵 Income Heads')}
        ${btn('expense', '🧾 Expense Heads')}
        ${btn('monthly', '🗓 Monthly Closing')}
        ${btn('reconcile', '✅ Reconciliation')}
    </div>`;
}

async function mrLoad() {
    const body = document.getElementById('mrBody');
    if (!body) return;
    const r = _mrResolveRange();
    body.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading…</div>';
    _mrShowRangeHint();
    const res = await window.api.getMonthlyReport(r);
    if (!res || !res.success) {
        body.innerHTML = `<div style="padding:20px;color:var(--danger)">Could not load the Monthly Report: ${escapeHtml((res && res.error) || 'unknown error')}</div>`;
        return;
    }
    _mrMonth.data = res.data;
    _mrRenderTabs();
    mrRenderBody();
}

function mrRenderBody() {
    const data = _mrMonth.data;
    const body = document.getElementById('mrBody');
    if (!body || !data) return;
    if (_mrMonth.tab === 'income') { body.innerHTML = _mrIncomeView(data); return; }
    if (_mrMonth.tab === 'expense') { body.innerHTML = _mrExpenseView(data); return; }
    if (_mrMonth.tab === 'monthly') { body.innerHTML = _mrMonthlyView(data); return; }
    if (_mrMonth.tab === 'reconcile') { body.innerHTML = _mrReconcileView(data); return; }
    body.innerHTML = _mrSummaryView(data);
}

function _mrHead(html) {
    return `<div class="card" style="padding:10px 14px;margin-bottom:10px;background:var(--bg-light,#f8fafc)">
        <strong>${html}</strong></div>`;
}

function _mrSummaryView(d) {
    const s = d.summary;
    const row = (label, value, strong) => `<tr${strong ? ' style="font-weight:600;background:#f8fafc"' : ''}>
        <td>${label}</td><td style="text-align:right">${_mrMoney(value)}</td></tr>`;
    const gaps = d.notes.gaps.length
        ? `<div class="card" style="margin-top:14px;border-left:4px solid var(--warning,#f59e0b);padding:10px 14px">
             <strong>⚠️ Data gaps — read before relying on these numbers</strong>
             <ul style="margin:8px 0 0 18px">${d.notes.gaps.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul>
           </div>` : '';
    const notes = d.notes.notes.length
        ? `<div class="card" style="margin-top:14px;padding:10px 14px">
             <strong>Notes</strong>
             <ul style="margin:8px 0 0 18px">${d.notes.notes.map(g => `<li>${escapeHtml(g)}</li>`).join('')}</ul>
           </div>` : '';
    return `
        ${_mrHead(`${escapeHtml(d.business.name)} · Monthly Report · ${d.from_date} → ${d.to_date} (BS)`
            + `${d.from_ad ? ` · AD ${d.from_ad} → ${d.to_ad}` : ''}
            · ${d.month_count} month(s) · documents up to ${d.data_window.latest_document_date || '—'}`)}
        <div class="card" style="padding:0">
            <table class="data-table">
                <thead><tr><th>Monthly Summary</th><th style="text-align:right">Amount (Rs)</th></tr></thead>
                <tbody>
                    ${row('Opening Cash Balance', s.opening_cash)}
                    ${row('Opening Bank Balance', s.opening_bank)}
                    ${row('Opening Inventory Value', s.opening_inventory)}
                    ${row('Sales Revenue (excl. opening balances)', s.sales_revenue)}
                    ${row('Other Income', s.other_income)}
                    ${row('Total Income', s.total_income, true)}
                    ${row('Milk Procurement Cost', s.milk_cost)}
                    ${row('Other Purchases', s.other_purchases)}
                    ${row('Cost of Goods Sold', s.cogs, true)}
                    ${row('Gross Profit', s.gross_profit, true)}
                    ${row('Total Operating Expenses', s.total_operating_expenses)}
                    ${row('Net Profit / (Loss)', s.net_profit, true)}
                    ${row('Closing Cash Balance', s.closing_cash)}
                    ${row('Closing Bank Balance', s.closing_bank)}
                    ${row('Closing Inventory Value', s.closing_inventory)}
                    ${row('Outstanding Receivables', s.receivables)}
                    ${row('Outstanding Payables', s.payables)}
                    ${row('Outstanding Advances', s.advances)}
                    ${row('Loan Receivable', s.loan_receivable)}
                    ${row('Loan Payable', s.loan_payable)}
                    ${row('Prepaid Rent Balance (asset)', s.prepaid_rent, true)}
                </tbody>
            </table>
        </div>
        ${gaps}${notes}`;
}

function _mrIncomeView(d) {
    const rows = d.income_heads.map(h => `<tr><td>${escapeHtml(h.head)}</td>
        <td style="text-align:right">${_mrMoney(h.amount)}</td>
        <td style="text-align:right">${h.count || ''}</td>
        <td style="text-align:right">${h.share_percent == null ? '' : h.share_percent + '%'}</td></tr>`).join('');
    return `
        ${_mrHead(`Income heads · ${d.from_date} → ${d.to_date} (BS)`)}
        <div class="card" style="padding:0"><table class="data-table">
            <thead><tr><th>Income Head</th><th style="text-align:right">Amount (Rs)</th><th style="text-align:right">Lines</th><th style="text-align:right">% of Sales</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4">No income in this period.</td></tr>'}
            <tr style="font-weight:600;background:#f8fafc"><td>Total (heads)</td>
                <td style="text-align:right">${_mrMoney(d.activity.income_heads_total)}</td><td colspan="2"></td></tr>
            <tr><td>Sales revenue (invoices, excl. opening balances)</td>
                <td style="text-align:right">${_mrMoney(d.summary.sales_revenue)}</td><td colspan="2"></td></tr>
            ${Math.abs(d.activity.income_unexplained) >= 0.01 ? `<tr><td>Difference (rounding / free-typed invoice lines)</td>
                <td style="text-align:right">${_mrMoney(d.activity.income_unexplained)}</td><td colspan="2"></td></tr>` : ''}
            <tr><td>Opening-balance documents (brought-forward receivables, NOT income)</td>
                <td style="text-align:right">${_mrMoney(d.activity.opening_balance_documents)}</td><td colspan="2"></td></tr>
            </tbody></table></div>`;
}

function _mrExpenseView(d) {
    const rows = d.expense_heads.map(h => `<tr><td>${escapeHtml(h.head)}</td>
        <td style="text-align:right">${_mrMoney(h.amount)}</td>
        <td style="text-align:right">${h.count || ''}</td></tr>`).join('');
    const src = d.activity.expense_sources || {};
    const srcRows = Object.entries(src).map(([k, v]) =>
        `<tr><td>${escapeHtml(k.replace(/_/g, ' '))}</td><td style="text-align:right">${_mrMoney(v)}</td></tr>`).join('');
    return `
        ${_mrHead(`Expense heads · ${d.from_date} → ${d.to_date} (BS)`)}
        <div class="card" style="padding:0"><table class="data-table">
            <thead><tr><th>Expense Head</th><th style="text-align:right">Amount (Rs)</th><th style="text-align:right">Vouchers</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No operating expenses in this period.</td></tr>'}
            <tr style="font-weight:600;background:#f8fafc"><td>Total Operating Expenses</td>
                <td style="text-align:right">${_mrMoney(d.activity.operating_expenses)}</td><td></td></tr>
            <tr><td>Cost of Goods Sold (milk + purchases)</td>
                <td style="text-align:right">${_mrMoney(d.activity.cogs)}</td><td></td></tr>
            <tr style="font-weight:600;background:#f8fafc"><td>Total Expenses</td>
                <td style="text-align:right">${_mrMoney(d.activity.total_expenses)}</td><td></td></tr>
            </tbody></table></div>
        <div class="card" style="padding:0;margin-top:14px"><table class="data-table">
            <thead><tr><th>Expense source (each recognised once)</th><th style="text-align:right">Amount (Rs)</th></tr></thead>
            <tbody>${srcRows}</tbody></table></div>
        <div class="card" style="margin-top:14px;padding:10px 14px;font-size:12px">
            Loan principal repayments, cash transfers, supplier payable settlements and advances are NOT expenses,
            and a purchase already carried through Cost of Goods Sold is never expensed a second time.
        </div>`;
}

function _mrMonthlyView(d) {
    const rows = d.months.map(m => `<tr>
        <td>${escapeHtml(m.label)}</td><td>${m.from_date}</td><td>${m.to_date}</td>
        <td style="text-align:right">${_mrMoney(m.opening_cash)}</td>
        <td style="text-align:right">${_mrMoney(m.opening_bank)}</td>
        <td style="text-align:right">${_mrMoney(m.sales_revenue)}</td>
        <td style="text-align:right">${_mrMoney(m.other_income)}</td>
        <td style="text-align:right">${_mrMoney(m.cogs)}</td>
        <td style="text-align:right">${_mrMoney(m.gross_profit)}</td>
        <td style="text-align:right">${_mrMoney(m.total_expenses)}</td>
        <td style="text-align:right;font-weight:600">${_mrMoney(m.net_profit)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_cash)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_bank)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_inventory)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_receivables)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_payables)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_advances)}</td>
        <td style="text-align:right">${_mrMoney(m.closing_prepaid_rent)}</td>
    </tr>`).join('');
    return `
        ${_mrHead(`Monthly closing · ${d.from_date} → ${d.to_date} (BS) — each month's closing balance is the next month's opening balance`)}
        <div class="card" style="padding:0;overflow:auto"><table class="data-table" style="font-size:12px">
            <thead><tr>
                <th>Month</th><th>Start</th><th>End</th><th style="text-align:right">Open Cash</th><th style="text-align:right">Open Bank</th>
                <th style="text-align:right">Sales</th><th style="text-align:right">Other Income</th><th style="text-align:right">COGS</th>
                <th style="text-align:right">Gross</th><th style="text-align:right">Expenses</th><th style="text-align:right">Net</th>
                <th style="text-align:right">Close Cash</th><th style="text-align:right">Close Bank</th><th style="text-align:right">Close Inv.</th>
                <th style="text-align:right">Receivable</th><th style="text-align:right">Payable</th><th style="text-align:right">Advances</th>
                <th style="text-align:right">Prepaid Rent</th>
            </tr></thead>
            <tbody>${rows}</tbody></table></div>
        <div class="card" style="margin-top:14px;padding:10px 14px;font-size:12px">
            Income and expense columns cover only that month's own transactions — no closing balance is added to a
            month's income, and the previous month's profit is never carried forward as income.
        </div>`;
}

function _mrReconcileView(d) {
    const rows = d.reconciliation.checks.map(c => `<tr>
        <td>${c.ok ? '✅' : '⚠️'} ${escapeHtml(c.check)}</td>
        <td style="text-align:right">${_mrMoney(c.expected)}</td>
        <td style="text-align:right">${_mrMoney(c.actual)}</td>
        <td style="text-align:right;${c.ok ? '' : 'color:var(--danger);font-weight:600'}">${_mrMoney(c.difference)}</td>
        <td style="font-size:12px">${escapeHtml(c.note || '')}</td>
    </tr>`).join('');
    return `
        ${_mrHead(d.reconciliation.all_ok
            ? `Reconciliation · all ${d.reconciliation.checks.length} checks agree`
            : `Reconciliation · ${d.reconciliation.differences.length} of ${d.reconciliation.checks.length} checks FLAGGED`)}
        <div class="card" style="padding:0"><table class="data-table" style="font-size:12px">
            <thead><tr><th>Check</th><th style="text-align:right">Expected</th><th style="text-align:right">Actual</th>
                <th style="text-align:right">Difference</th><th>Note</th></tr></thead>
            <tbody>${rows}</tbody></table></div>`;
}

/** Excel export — same engine as the screen (Electron IPC or a browser download). */
async function mrExportExcel() {
    const r = _mrResolveRange();
    try {
        if (window.api && typeof window.api.exportMonthlyReport === 'function') {
            const result = await window.api.exportMonthlyReport(r);
            if (result && result.success) {
                showToast(`✅ Monthly Report exported${result.reconciled ? '' : ` — ${result.checks_flagged} check(s) flagged`}: ${result.filePath || ''}`, result.reconciled ? 'success' : 'warning');
            } else if (result && !result.cancelled) {
                showToast('⚠️ Export failed: ' + ((result && result.error) || 'unknown error'), 'error');
            }
            return;
        }
        const headers = { 'Content-Type': 'application/json' };
        try {
            const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
            if (token) headers['Authorization'] = 'Bearer ' + token;
        } catch (e) { /* storage unavailable */ }
        const res = await fetch('/api/export/monthly-report', {
            method: 'POST', headers, body: JSON.stringify(r), credentials: 'include'
        });
        if (!res.ok) { showToast('⚠️ Export failed (HTTP ' + res.status + ')', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'Monthly_Report_Export.xlsx';
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showToast('✅ Monthly Report exported', 'success');
    } catch (err) {
        console.error('Monthly report export failed:', err);
        showToast('⚠️ Export failed: ' + err.message, 'error');
    }
}

async function mrPrint() {
    const body = document.getElementById('mrBody');
    if (!body) return;
    const d = _mrMonth.data;
    const title = d ? `Monthly Report ${d.from_date} → ${d.to_date} (BS)` : 'Monthly Report';
    const w = window.open('', '_blank');
    if (!w) { showToast('⚠️ Allow pop-ups to print', 'error'); return; }
    w.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
        <style>
            body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;margin:16px}
            h2{margin:0 0 4px}
            table{border-collapse:collapse;width:100%;margin-bottom:12px}
            th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}
            th{background:#f1f5f9}
            .muted{color:#64748b;font-size:10px}
        </style></head><body>
        <h2>${escapeHtml(d ? d.business.name : 'Prarambha Dairy Suppliers')} — ${title}</h2>
        <div class="muted">Generated ${new Date().toLocaleString()}${d ? ` · documents up to ${d.data_window.latest_document_date || '—'}` : ''}</div>
        ${body.innerHTML}
        <div class="muted">Prepared by ____________________   Checked by ____________________</div>
        </body></html>`);
    w.document.close();
    w.focus();
    w.print();
}
