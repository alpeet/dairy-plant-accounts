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
    lang: 'en',               // en | np | both — labels only, never the data
    data: null,
    prepaid: null,
    drill: null               // { line, data } while a drill-down is open
};

/** Report labels in English and नेपाली. Amounts stay in Latin digits. */
const MR_LABELS = {
    opening_cash:             ['Opening Cash Balance', 'सुरुको नगद मौज्दात'],
    opening_bank:             ['Opening Bank Balance', 'सुरुको बैंक मौज्दात'],
    opening_inventory:        ['Opening Inventory Value', 'सुरुको मौज्दात मूल्य'],
    sales_revenue:            ['Sales Revenue', 'बिक्री आमदानी'],
    other_income:             ['Other Income', 'अन्य आमदानी'],
    total_income:             ['Total Income', 'कुल आम्दानी'],
    milk_cost:                ['Milk Procurement Cost', 'दूध खरिद लागत'],
    other_purchases:          ['Other Purchases', 'अन्य खरिद'],
    cogs:                     ['Cost of Goods Sold', 'बिक्री भएका सामानको लागत'],
    gross_profit:             ['Gross Profit', 'कुल नाफा'],
    total_operating_expenses: ['Total Operating Expenses', 'कुल सञ्चालन खर्च'],
    net_profit:               ['Net Profit / (Loss)', 'खुद नाफा / (नोक्सान)'],
    closing_cash:             ['Closing Cash Balance', 'अन्तिम नगद मौज्दात'],
    closing_bank:             ['Closing Bank Balance', 'अन्तिम बैंक मौज्दात'],
    closing_inventory:        ['Closing Inventory Value', 'अन्तिम मौज्दात मूल्य'],
    receivables:              ['Outstanding Receivables', 'उठाउन बाँकी रकम'],
    payables:                 ['Outstanding Payables', 'तिर्न बाँकी रकम'],
    advances:                 ['Outstanding Advances', 'अग्रिम रकम (उठाउन बाँकी)'],
    loan_receivable:          ['Loan Receivable', 'उठाउन बाँकी ऋण'],
    loan_payable:             ['Loan Payable', 'तिर्न बाँकी ऋण'],
    prepaid_rent:             ['Prepaid Rent Balance', 'अग्रिम भुक्तानी घरभाडा (सम्पत्ति)']
};

const MR_SUMMARY_ORDER = [
    ['opening_cash', 0], ['opening_bank', 0], ['opening_inventory', 0],
    ['sales_revenue', 0], ['other_income', 0], ['total_income', 1],
    ['milk_cost', 0], ['other_purchases', 0], ['cogs', 1], ['gross_profit', 1],
    ['total_operating_expenses', 0], ['net_profit', 1],
    ['closing_cash', 0], ['closing_bank', 0], ['closing_inventory', 0],
    ['receivables', 0], ['payables', 0], ['advances', 0],
    ['loan_receivable', 0], ['loan_payable', 0], ['prepaid_rent', 1]
];

/** Label for a report line in the currently chosen language. */
function _mrLbl(key, fallback) {
    const pair = MR_LABELS[key];
    if (!pair) return fallback || key;
    if (_mrMonth.lang === 'np') return pair[1];
    if (_mrMonth.lang === 'both') return `${pair[0]} / ${pair[1]}`;
    return pair[0];
}

function _mrLangBtn(key, label) {
    return `<button class="btn btn-sm ${_mrMonth.lang === key ? 'btn-primary' : 'btn-secondary'}"
        onclick="mrSetLang('${key}')">${label}</button>`;
}

function mrSetLang(lang) {
    _mrMonth.lang = (lang === 'np' || lang === 'both') ? lang : 'en';
    try { localStorage.setItem('mr_lang', _mrMonth.lang); } catch (e) { /* storage unavailable */ }
    if (_mrMonth.drill) { mrRenderDrill(); } else { _mrRenderTabs(); mrRenderBody(); }
}

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

function _mrMonthDefaults() {
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

// NOTE: this module shares the page with management_reports.js, which uses the
// same mrFilters/mrBody/mrTabs ids and mrLoad/mrPrint/mrSetTab globals. Both
// were loaded together, so the later script silently overwrote the earlier
// ones and this page could never render. Everything here is namespaced
// (_mrMonthDefaults/mrMonthlyLoad/mrMonthlyPrint/mrMonthlySetTab) and every
// element lookup is scoped to #page-monthly-report.
function _mrEl(id) {
    return document.querySelector('#page-monthly-report #' + id);
}

async function renderMonthlyReport() {
    _mrMonthDefaults();
    _mrMonth.data = null;
    _mrMonth.drill = null;
    try {
        const saved = localStorage.getItem('mr_lang');
        if (saved) _mrMonth.lang = saved;
    } catch (e) { /* storage unavailable */ }
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-secondary btn-sm" onclick="mrExportExcel()">📊 Export Excel</button>
        <button class="btn btn-secondary btn-sm" onclick="mrMonthlyPdf()">📄 PDF</button>
        <button class="btn btn-info btn-sm" onclick="mrMonthlyPrint()">🖨 Print</button>
    `;
    const container = document.getElementById('page-monthly-report');
    container.innerHTML = `
        <div id="mrFilters"></div>
        <div id="mrBody"><div class="loading" style="text-align:center;padding:40px">Loading…</div></div>
    `;
    _mrRenderFilters();
    await mrMonthlyLoad();
}

function _mrRenderFilters() {
    const hosts = _mrEl('mrFilters');
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
            <div class="form-group"><label>Language / भाषा</label>
                <div style="display:flex;gap:4px">
                    ${_mrLangBtn('en', 'English')}
                    ${_mrLangBtn('np', 'नेपाली')}
                    ${_mrLangBtn('both', 'Both')}
                </div></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="mrApply()">📊 Generate Report</button></div>
            <div class="form-group" style="flex:1"><label>&nbsp;</label>
                <div id="mrRangeHint" style="font-size:12px;color:var(--text-light);padding-top:6px"></div></div>
        </div></div>
        <div id="mrTabs"></div>
    `;
    if (typeof refreshBSDateInputs === 'function') refreshBSDateInputs(_mrEl('mrFilters'));
    _mrShowRangeHint();
}

function _mrShowRangeHint() {
    const hint = _mrEl('mrRangeHint');
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
    const y = _mrEl('mrYear').value;
    const m = _mrEl('mrMonthSel').value;
    _mrMonth.month = `${y}-${m}`;
    _mrShowRangeHint();
}

function mrApply() {
    const fromEl = _mrEl('mrFrom');
    const toEl = _mrEl('mrTo');
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
    mrMonthlyLoad();
}

function mrMonthlySetTab(tab) {
    _mrMonth.tab = tab;
    _mrRenderTabs();
    mrRenderBody();
}

function _mrRenderTabs() {
    const tabs = _mrEl('mrTabs');
    if (!tabs) return;
    const btn = (key, label) => `<button class="btn btn-sm ${_mrMonth.tab === key ? 'btn-primary' : 'btn-secondary'}" onclick="mrMonthlySetTab('${key}')">${label}</button>`;
    tabs.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        ${btn('summary', '📋 Summary')}
        ${btn('income', '💵 Income Heads')}
        ${btn('expense', '🧾 Expense Heads')}
        ${btn('monthly', '🗓 Monthly Closing')}
        ${btn('reconcile', '✅ Reconciliation')}
    </div>`;
}

async function mrMonthlyLoad() {
    const body = _mrEl('mrBody');
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
    const body = _mrEl('mrBody');
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
    // Every line is clickable: it opens the records behind that figure.
    const row = (key, strong) => `<tr class="mr-line${strong ? ' mr-strong' : ''}" onclick="mrOpenDrill('${key}')"
            title="Click to see the records and calculation behind this figure">
        <td><span class="mr-line-open">🔍</span> ${escapeHtml(_mrLbl(key))}</td>
        <td class="mr-amount">${_mrMoney(s[key])}</td></tr>`;
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
                    ${MR_SUMMARY_ORDER.map(([key, strong]) => row(key, strong)).join('')}
                </tbody>
            </table>
        </div>
        ${gaps}${notes}`;
}

function _mrIncomeView(d) {
    const rows = d.income_heads.map(h => `<tr class="mr-line" onclick="mrOpenDrill('total_income', {category: '${escapeHtml(h.head)}'})"
            title="Click to see the invoices behind this income head">
        <td><span class="mr-line-open">🔍</span> ${escapeHtml(h.head)}</td>
        <td class="mr-amount">${_mrMoney(h.amount)}</td>
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
    const rows = d.expense_heads.map(h => `<tr class="mr-line" onclick="mrOpenDrill('total_operating_expenses', {category: '${escapeHtml(h.head)}'})"
            title="Click to see the vouchers behind this expense head">
        <td><span class="mr-line-open">🔍</span> ${escapeHtml(h.head)}</td>
        <td class="mr-amount">${_mrMoney(h.amount)}</td>
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

// ══════════════════════════════════════════════════════════════
// Shared A4 print stylesheet (Nepali-ready font stack)
// ══════════════════════════════════════════════════════════════

const MR_FONT_STACK = "'Noto Sans Devanagari','Kalimati','Mukta','Nirmala UI','Mangal',"
    + "-apple-system,'Segoe UI',Roboto,sans-serif";

function _mrPrintCss(extra) {
    return `
        @page { size: A4 portrait; margin: 12mm 10mm 14mm 10mm; }
        * { box-sizing: border-box; }
        body { font-family: ${MR_FONT_STACK}; font-size: 10.5px; color: #111; margin: 0; }
        h1 { font-size: 15px; margin: 0 0 2px; }
        h2 { font-size: 12px; margin: 14px 0 6px; }
        .head { border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; }
        .muted { color: #555; font-size: 9.5px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 10px; }
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
        th, td { border: 1px solid #b8c0cc; padding: 3px 5px; text-align: left; vertical-align: top; }
        th { background: #eef2f7; font-weight: 600; }
        td.num, th.num { text-align: right; white-space: nowrap; }
        .total-row td { font-weight: 700; background: #f6f8fb; }
        .sign { margin-top: 18px; display: flex; justify-content: space-between; font-size: 9.5px; }
        .sign div { border-top: 1px solid #666; padding-top: 3px; width: 30%; text-align: center; }
        ${extra || ''}`;
}

/** Nepali labels for report sections when the language is not English. */
function _mrBilingual(en, np) {
    if (_mrMonth.lang === 'np') return np;
    if (_mrMonth.lang === 'both') return `${en} / ${np}`;
    return en;
}

/** The whole report as one printable document (also used for the PDF). */
function _mrReportHtml(d) {
    if (!d) return '';
    const s = d.summary;
    const money = v => _mrMoney(v);
    const summaryRows = MR_SUMMARY_ORDER.map(([key, strong]) =>
        `<tr${strong ? ' class="total-row"' : ''}><td>${escapeHtml(_mrLbl(key))}</td>
         <td class="num">${money(s[key])}</td></tr>`).join('');
    const incomeRows = d.income_heads.map(h =>
        `<tr><td>${escapeHtml(h.head)}</td><td class="num">${money(h.amount)}</td>
         <td class="num">${h.count || ''}</td></tr>`).join('');
    const expenseRows = d.expense_heads.map(h =>
        `<tr><td>${escapeHtml(h.head)}</td><td class="num">${money(h.amount)}</td>
         <td class="num">${h.count || ''}</td></tr>`).join('');
    const monthRows = d.months.map(m => `<tr>
        <td>${escapeHtml(m.label)}</td><td>${m.from_date}</td><td>${m.to_date}</td>
        <td class="num">${money(m.sales_revenue)}</td><td class="num">${money(m.cogs)}</td>
        <td class="num">${money(m.gross_profit)}</td><td class="num">${money(m.total_expenses)}</td>
        <td class="num">${money(m.net_profit)}</td><td class="num">${money(m.closing_cash)}</td>
        <td class="num">${money(m.closing_bank)}</td><td class="num">${money(m.closing_inventory)}</td>
    </tr>`).join('');
    const checkRows = d.reconciliation.checks.map(c => `<tr>
        <td>${c.ok ? 'OK' : 'FLAG'} — ${escapeHtml(c.check)}</td>
        <td class="num">${money(c.expected)}</td><td class="num">${money(c.actual)}</td>
        <td class="num">${money(c.difference)}</td></tr>`).join('');

    return `<!DOCTYPE html><html lang="${_mrMonth.lang === 'np' ? 'ne' : 'en'}"><head>
<meta charset="utf-8"><title>${escapeHtml(d.business.name)} — Monthly Report</title>
<style>${_mrPrintCss()}</style></head><body>
    <div class="head">
        <h1>${escapeHtml(d.business.name || 'Prarambha Dairy Suppliers')}</h1>
        <div class="muted">
            ${d.business.address ? escapeHtml(d.business.address) + ' · ' : ''}
            ${d.business.phone ? 'Tel ' + escapeHtml(d.business.phone) + ' · ' : ''}
            ${d.business.pan ? 'PAN ' + escapeHtml(d.business.pan) : ''}
        </div>
        <h2>${_mrBilingual('Monthly Report', 'मासिक प्रतिवेदन')} — ${d.from_date} → ${d.to_date} (BS)</h2>
        <div class="muted">
            ${_mrBilingual('Period', 'अवधि')}: ${d.from_date} → ${d.to_date} BS
            ${d.from_ad ? ` (AD ${d.from_ad} → ${d.to_ad})` : ''}
            · ${_mrBilingual('Printed', 'प्रिन्ट मिति')}: ${new Date().toLocaleString()}
            · ${_mrBilingual('Documents up to', 'कागजात मितिसम्म')}: ${d.data_window.latest_document_date || '—'}
        </div>
    </div>

    <h2>${_mrBilingual('Summary', 'सारांश')}</h2>
    <table><thead><tr>
        <th>${_mrBilingual('Item', 'विवरण')}</th>
        <th class="num">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th>
    </tr></thead><tbody>${summaryRows}</tbody></table>

    <h2>${_mrBilingual('Income by head', 'आम्दानीको शीर्षक')}</h2>
    <table><thead><tr><th>${_mrBilingual('Income head', 'आम्दानी शीर्षक')}</th>
        <th class="num">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th>
        <th class="num">${_mrBilingual('Lines', 'संख्या')}</th></tr></thead>
        <tbody>${incomeRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>

    <h2>${_mrBilingual('Expenses by head', 'खर्चको शीर्षक')}</h2>
    <table><thead><tr><th>${_mrBilingual('Expense head', 'खर्च शीर्षक')}</th>
        <th class="num">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th>
        <th class="num">${_mrBilingual('Vouchers', 'भौचर')}</th></tr></thead>
        <tbody>${expenseRows || '<tr><td colspan="3">—</td></tr>'}</tbody></table>

    <h2>${_mrBilingual('Month by month', 'महिनागत विवरण')}</h2>
    <table><thead><tr>
        <th>${_mrBilingual('Month', 'महिना')}</th><th>${_mrBilingual('From', 'देखि')}</th><th>${_mrBilingual('To', 'सम्म')}</th>
        <th class="num">${_mrBilingual('Sales', 'बिक्री')}</th>
        <th class="num">${_mrBilingual('COGS', 'लागत')}</th>
        <th class="num">${_mrBilingual('Gross', 'कुल नाफा')}</th>
        <th class="num">${_mrBilingual('Expenses', 'खर्च')}</th>
        <th class="num">${_mrBilingual('Net', 'खुद नाफा')}</th>
        <th class="num">${_mrBilingual('Cash', 'नगद')}</th>
        <th class="num">${_mrBilingual('Bank', 'बैंक')}</th>
        <th class="num">${_mrBilingual('Stock', 'मौज्दात')}</th>
    </tr></thead><tbody>${monthRows}</tbody></table>

    <h2>${_mrBilingual('Reconciliation', 'हिसाब मिलान')}</h2>
    <table><thead><tr><th>${_mrBilingual('Check', 'जाँच')}</th>
        <th class="num">${_mrBilingual('Expected', 'अपेक्षित')}</th>
        <th class="num">${_mrBilingual('Actual', 'वास्तविक')}</th>
        <th class="num">${_mrBilingual('Difference', 'फरक')}</th></tr></thead>
        <tbody>${checkRows}</tbody></table>

    <div class="sign">
        <div>${_mrBilingual('Prepared by', 'तयार गर्ने')}</div>
        <div>${_mrBilingual('Checked by', 'जाँच गर्ने')}</div>
        <div>${_mrBilingual('Approved by', 'स्वीकृत गर्ने')}</div>
    </div>
</body></html>`;
}

async function mrMonthlyPrint() {
    const d = _mrMonth.data;
    if (!d) { showToast('⚠️ Load the report first', 'error'); return; }
    const html = _mrReportHtml(d);
    const w = window.open('', '_blank');
    if (!w) { showToast('⚠️ Allow pop-ups to print', 'error'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
}

async function mrMonthlyPdf() {
    const d = _mrMonth.data;
    if (!d) { showToast('⚠️ Load the report first', 'error'); return; }
    if (!window.api || typeof window.api.printToPDF !== 'function') {
        showToast('⚠️ PDF export needs the desktop app — use Print instead', 'error');
        return;
    }
    showToast('⏳ Building the PDF…', 'info');
    const res = await window.api.printToPDF({ html: _mrReportHtml(d) });
    if (res && res.success) showToast(`✅ PDF saved: ${res.path}`, 'success');
    else if (res && !res.canceled) showToast('⚠️ PDF failed: ' + (res.error || 'unknown error'), 'error');
}

// ══════════════════════════════════════════════════════════════
// Drill-down
// ══════════════════════════════════════════════════════════════

/**
 * Open the records behind one report line.
 * The month/period, the tab and the report data stay where they are, so Back
 * returns to exactly the report the user was reading.
 */
async function mrOpenDrill(line, presetFilters) {
    if (!_mrMonth.data) return;
    _mrMonth.drill = { line, filters: presetFilters || {}, data: null };
    _mrRenderTabs();
    await mrDrillLoad();
}

function _mrDrillFilterValues() {
    const get = id => { const el = _mrEl(id); return el ? el.value.trim() : ''; };
    const f = {};
    if (get('mrDrParty')) f.party = get('mrDrParty');
    if (get('mrDrCategory')) f.category = get('mrDrCategory');
    if (get('mrDrType')) f.type = get('mrDrType');
    if (get('mrDrFrom')) f.from = get('mrDrFrom');
    if (get('mrDrTo')) f.to = get('mrDrTo');
    return f;
}

async function mrDrillLoad() {
    const body = _mrEl('mrBody');
    const st = _mrMonth.drill;
    if (!body || !st) return;
    body.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading the records behind this figure…</div>';

    const range = _mrResolveRange();
    const res = await window.api.getMonthlyReportLine({
        line: st.line,
        from_date: range.from_date,
        to_date: range.to_date,
        filters: st.filters || {}
    });
    if (!res || !res.success) {
        body.innerHTML = `<div style="padding:20px;color:var(--danger)">Could not load the detail: ${
            escapeHtml((res && res.error) || 'unknown error')}</div>
            <button class="btn btn-secondary" onclick="mrDrillBack()">← Back to Monthly Report</button>`;
        return;
    }
    st.data = res.data;
    mrRenderDrill();
}

function mrDrillApplyFilter() {
    if (!_mrMonth.drill) return;
    _mrMonth.drill.filters = _mrDrillFilterValues();
    mrDrillLoad();
}

function mrDrillClearFilter() {
    if (!_mrMonth.drill) return;
    _mrMonth.drill.filters = {};
    mrDrillLoad();
}

/** Back to the same month, the same tab, the same report. */
function mrDrillBack() {
    _mrMonth.drill = null;
    _mrRenderTabs();
    mrRenderBody();
}

function _mrDrillRow(r) {
    const qty = r.quantity == null ? '' : Number(r.quantity).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    const rate = r.rate == null ? '' : Number(r.rate).toLocaleString('en-IN', { maximumFractionDigits: 4 });
    const source = [r.source_module, r.source_sheet].filter(Boolean).join(' · ');
    const open = r.edit_page
        ? `<button class="btn btn-sm btn-secondary" title="Open this record" onclick="event.stopPropagation(); navigateTo('${r.edit_page}')">↗</button>`
        : '';
    return `<tr>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.voucher)}</td>
        <td>${escapeHtml(r.party)}</td>
        <td>${escapeHtml(r.description)}</td>
        <td class="muted">${escapeHtml(source)}</td>
        <td style="text-align:right">${qty}</td>
        <td style="text-align:right">${rate}</td>
        <td style="text-align:right">${_mrMoney(r.amount)}</td>
        <td>${escapeHtml(r.category)}</td>
        <td>${escapeHtml(r.status)}</td>
        <td class="muted">${r.record_table ? escapeHtml(`${r.record_table}#${r.record_id}`) : ''}</td>
        <td>${open}</td>
    </tr>`;
}

function mrRenderDrill() {
    const body = _mrEl('mrBody');
    const st = _mrMonth.drill;
    if (!body || !st || !st.data) return;
    const d = st.data;
    const f = st.filters || {};

    const verdict = d.matches
        ? `<div class="card" style="border-left:4px solid #16a34a;padding:10px 14px;margin-bottom:12px;background:#f0fdf4">
             ✅ <strong>${_mrBilingual('Reconciled', 'मिलान भयो')}</strong> —
             ${d.rows.length} record(s) add up to <strong>${_mrMoney(d.detail_total)}</strong>,
             exactly the figure on the report (${_mrMoney(d.reported)}).
           </div>`
        : `<div class="card" style="border-left:4px solid #b91c1c;padding:10px 14px;margin-bottom:12px;background:#fef2f2">
             ⛔ <strong>Audit defect — do not rely on this line.</strong><br>
             ${escapeHtml(d.flag_reason)}
           </div>`;

    const formula = (d.formula && d.formula.length)
        ? `<div class="card" style="padding:0;margin-bottom:12px">
             <table class="data-table">
               <thead><tr><th>${_mrBilingual('How this figure is built', 'यो रकम कसरी बन्यो')}</th>
                 <th style="text-align:right">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th></tr></thead>
               <tbody>${d.formula.map(c => `<tr><td>${escapeHtml(c.label)}</td>
                 <td style="text-align:right">${_mrMoney(c.amount)}</td></tr>`).join('')}
                 <tr style="font-weight:700;background:#f6f8fb"><td>${_mrBilingual('Report figure', 'प्रतिवेदनको रकम')}</td>
                 <td style="text-align:right">${_mrMoney(d.reported)}</td></tr></tbody>
             </table></div>`
        : '';

    const rows = d.rows.length
        ? d.rows.map(_mrDrillRow).join('')
        : `<tr><td colspan="12" style="padding:16px;text-align:center;color:var(--text-light)">
             ${_mrBilingual('No records for this line in the selected period.', 'यो अवधिमा यो शीर्षकमा कुनै अभिलेख छैन।')}
           </td></tr>`;

    body.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
            <button class="btn btn-secondary btn-sm" onclick="mrDrillBack()">← ${_mrBilingual('Back to Monthly Report', 'मासिक प्रतिवेदनमा फर्कनुहोस्')}</button>
            <button class="btn btn-secondary btn-sm" onclick="mrDrillPrint()">🖨 ${_mrBilingual('Print', 'प्रिन्ट')}</button>
            <button class="btn btn-secondary btn-sm" onclick="mrDrillPdf()">📄 PDF</button>
            <button class="btn btn-secondary btn-sm" onclick="mrDrillCsv()">⬇ ${_mrBilingual('CSV', 'सीएसभी')}</button>
            <span style="margin-left:auto;font-size:12px;color:var(--text-light)">
                ${escapeHtml(d.from_date)} → ${escapeHtml(d.to_date)} (BS)
            </span>
        </div>

        <div class="card" style="padding:12px 14px;margin-bottom:12px">
            <div style="font-size:12px;color:var(--text-light);text-transform:uppercase;letter-spacing:.04em">
                ${_mrBilingual('Drill-down', 'विस्तृत विवरण')}
            </div>
            <h2 style="margin:2px 0 4px">${escapeHtml(_mrLbl(d.line, d.label))}</h2>
            <div style="font-size:22px;font-weight:700">${_mrMoney(d.reported)}</div>
            ${d.scope_note ? `<div style="font-size:12px;color:var(--text-light);margin-top:6px">${escapeHtml(d.scope_note)}</div>` : ''}
        </div>

        ${verdict}
        ${formula}

        <div class="card" style="padding:10px 14px;margin-bottom:12px">
            <div class="filter-bar" style="margin:0;flex-wrap:wrap">
                <div class="form-group"><label>${_mrBilingual('Party', 'पार्टी')}</label>
                    <input class="form-control" id="mrDrParty" value="${escapeHtml(f.party || '')}" placeholder="${_mrBilingual('any', 'सबै')}"></div>
                <div class="form-group"><label>${_mrBilingual('Category', 'श्रेणी')}</label>
                    <input class="form-control" id="mrDrCategory" value="${escapeHtml(f.category || '')}" placeholder="${_mrBilingual('any', 'सबै')}"></div>
                <div class="form-group"><label>${_mrBilingual('Source module', 'स्रोत मोड्युल')}</label>
                    <input class="form-control" id="mrDrType" value="${escapeHtml(f.type || '')}" placeholder="sales, payments…"></div>
                <div class="form-group"><label>${_mrBilingual('From (BS)', 'देखि')}</label>
                    <input class="form-control" id="mrDrFrom" value="${escapeHtml(f.from || '')}" placeholder="2083-04-01"></div>
                <div class="form-group"><label>${_mrBilingual('To (BS)', 'सम्म')}</label>
                    <input class="form-control" id="mrDrTo" value="${escapeHtml(f.to || '')}" placeholder="2083-04-30"></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="mrDrillApplyFilter()">🔎 ${_mrBilingual('Filter', 'खोज')}</button></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-secondary btn-sm" onclick="mrDrillClearFilter()">${_mrBilingual('Clear', 'हटाउ')}</button></div>
            </div>
            ${Object.keys(f).length ? `<div style="font-size:12px;color:var(--text-light);margin-top:6px">
                ${_mrBilingual('Filtered subtotal', 'छानिएको जोड')}: <strong>${_mrMoney(d.detail_total)}</strong>
                · ${d.row_count} / ${d.total_rows_before_filters} ${_mrBilingual('records', 'अभिलेख')}
                · ${_mrBilingual('the report figure stays', 'प्रतिवेदनको रकम')} ${_mrMoney(d.reported)}</div>` : ''}
        </div>

        <div class="card" style="padding:0;overflow:auto">
            <table class="data-table" style="font-size:12px">
                <thead><tr>
                    <th>${_mrBilingual('Date (BS)', 'मिति')}</th>
                    <th>${_mrBilingual('Voucher / Ref.', 'भौचर / सन्दर्भ')}</th>
                    <th>${_mrBilingual('Party', 'पार्टी')}</th>
                    <th>${_mrBilingual('Description', 'विवरण')}</th>
                    <th>${_mrBilingual('Source', 'स्रोत')}</th>
                    <th style="text-align:right">${_mrBilingual('Qty', 'परिमाण')}</th>
                    <th style="text-align:right">${_mrBilingual('Rate', 'दर')}</th>
                    <th style="text-align:right">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th>
                    <th>${_mrBilingual('Category', 'श्रेणी')}</th>
                    <th>${_mrBilingual('Status', 'स्थिति')}</th>
                    <th>${_mrBilingual('Record', 'अभिलेख')}</th>
                    <th></th>
                </tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr style="font-weight:700;background:#f6f8fb">
                    <td colspan="7">${_mrBilingual('Total of the rows above', 'माथिका अभिलेखको जोड')}</td>
                    <td style="text-align:right">${_mrMoney(d.detail_total)}</td>
                    <td colspan="4"></td>
                </tr></tfoot>
            </table>
        </div>`;
}

function _mrDrillHtml(d) {
    const st = _mrMonth.drill || {};
    const rows = (d.rows || []).map(r => `<tr>
        <td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.voucher)}</td><td>${escapeHtml(r.party)}</td>
        <td>${escapeHtml(r.description)}</td><td>${escapeHtml([r.source_module, r.source_sheet].filter(Boolean).join(' · '))}</td>
        <td class="num">${r.quantity == null ? '' : r.quantity}</td><td class="num">${r.rate == null ? '' : r.rate}</td>
        <td class="num">${_mrMoney(r.amount)}</td><td>${escapeHtml(r.category)}</td>
        <td>${escapeHtml(r.status)}</td><td>${r.record_table ? escapeHtml(`${r.record_table}#${r.record_id}`) : ''}</td>
    </tr>`).join('');
    const formula = (d.formula || []).map(c =>
        `<tr><td>${escapeHtml(c.label)}</td><td class="num">${_mrMoney(c.amount)}</td></tr>`).join('');
    return `<!DOCTYPE html><html lang="${_mrMonth.lang === 'np' ? 'ne' : 'en'}"><head><meta charset="utf-8">
<title>${escapeHtml(d.label)}</title><style>${_mrPrintCss()}</style></head><body>
        <div class="head">
            <h1>${escapeHtml((_mrMonth.data && _mrMonth.data.business.name) || '')}</h1>
            <h2>${escapeHtml(_mrLbl(d.line, d.label))} — ${d.from_date} → ${d.to_date} (BS)</h2>
            <div class="muted">
                ${_mrBilingual('Report figure', 'प्रतिवेदनको रकम')}: ${_mrMoney(d.reported)} ·
                ${_mrBilingual('Rows', 'अभिलेख')}: ${d.rows.length} ·
                ${_mrBilingual('Rows total', 'जोड')}: ${_mrMoney(d.detail_total)}
                ${d.matches ? '· RECONCILED' : '· ⛔ AUDIT DEFECT — ' + escapeHtml(d.flag_reason)}
            </div>
        </div>
        ${formula ? `<table><thead><tr><th>${_mrBilingual('How this figure is built', 'यो रकम कसरी बन्यो')}</th>
            <th class="num">${_mrBilingual('Amount (Rs)', 'रकम (रु)')}</th></tr></thead><tbody>${formula}</tbody></table>` : ''}
        <table><thead><tr>
            <th>${_mrBilingual('Date', 'मिति')}</th><th>${_mrBilingual('Voucher', 'भौचर')}</th>
            <th>${_mrBilingual('Party', 'पार्टी')}</th><th>${_mrBilingual('Description', 'विवरण')}</th>
            <th>${_mrBilingual('Source', 'स्रोत')}</th><th class="num">${_mrBilingual('Qty', 'परिमाण')}</th>
            <th class="num">${_mrBilingual('Rate', 'दर')}</th><th class="num">${_mrBilingual('Amount', 'रकम')}</th>
            <th>${_mrBilingual('Category', 'श्रेणी')}</th><th>${_mrBilingual('Status', 'स्थिति')}</th>
            <th>${_mrBilingual('Record', 'अभिलेख')}</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr class="total-row"><td colspan="7">${_mrBilingual('Total', 'जोड')}</td>
                <td class="num">${_mrMoney(d.detail_total)}</td><td colspan="3"></td></tr></tfoot>
        </table>
        <div class="sign"><div>${_mrBilingual('Prepared by', 'तयार गर्ने')}</div>
            <div>${_mrBilingual('Checked by', 'जाँच गर्ने')}</div></div>
    </body></html>`;
}

function mrDrillPrint() {
    const d = _mrMonth.drill && _mrMonth.drill.data;
    if (!d) return;
    const w = window.open('', '_blank');
    if (!w) { showToast('⚠️ Allow pop-ups to print', 'error'); return; }
    w.document.write(_mrDrillHtml(d));
    w.document.close();
    w.focus();
    w.print();
}

async function mrDrillPdf() {
    const d = _mrMonth.drill && _mrMonth.drill.data;
    if (!d) return;
    if (!window.api || typeof window.api.printToPDF !== 'function') {
        showToast('⚠️ PDF export needs the desktop app — use Print instead', 'error');
        return;
    }
    showToast('⏳ Building the PDF…', 'info');
    const res = await window.api.printToPDF({ html: _mrDrillHtml(d), landscape: true });
    if (res && res.success) showToast(`✅ PDF saved: ${res.path}`, 'success');
    else if (res && !res.canceled) showToast('⚠️ PDF failed: ' + (res.error || 'unknown error'), 'error');
}

function mrDrillCsv() {
    const d = _mrMonth.drill && _mrMonth.drill.data;
    if (!d) return;
    const head = ['date', 'voucher', 'party', 'description', 'source_module', 'source_sheet',
        'quantity', 'rate', 'amount', 'category', 'status', 'record_table', 'record_id'];
    const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [head.join(',')].concat((d.rows || []).map(r => head.map(k => esc(r[k])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `monthly-report-${d.line}-${d.from_date}_${d.to_date}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(a.href);
}
