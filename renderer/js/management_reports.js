/**
 * Management Reports page (spec Phases 11–16)
 * ============================================
 * Three tabs over the SAME authoritative read models:
 *
 *   1. Expense Analysis  — where the money goes, by category/date/party,
 *                          with previous-period change and % of sales
 *   2. Board Report      — revenue → COGS → gross → op-ex → net, with
 *                          factual expense-control indicators
 *   3. Period Reports    — daily / weekly / monthly management report with
 *                          previous-period comparison and monthly trends
 *
 * This screen never recalculates: every number arrives with its own
 * reconciliation checks from the backend.
 */

let _mrTab = 'analysis';
let _mrState = {
    analysis: { from_date: '', to_date: '', group_by: 'category' },
    board: { from_date: '', to_date: '' },
    period: { period: 'weekly', as_of: '' }
};

function _mrDefaults() {
    const t = today();
    const monthStart = `${String(t).slice(0, 7)}-01`;
    if (!_mrState.analysis.from_date) {
        _mrState.analysis.from_date = monthStart;
        _mrState.analysis.to_date = t;
        _mrState.board.from_date = monthStart;
        _mrState.board.to_date = t;
        _mrState.period.as_of = t;
    }
}

async function renderManagementReports() {
    _mrDefaults();
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-info btn-sm" onclick="mrPrint()">🖨 Print</button>
    `;
    const container = document.getElementById('page-management-reports');
    container.innerHTML = `
        <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
            <button class="btn btn-sm ${_mrTab === 'analysis' ? 'btn-primary' : 'btn-secondary'}" onclick="mrSetTab('analysis')">📊 Expense Analysis</button>
            <button class="btn btn-sm ${_mrTab === 'board' ? 'btn-primary' : 'btn-secondary'}" onclick="mrSetTab('board')">🏛 Board Report</button>
            <button class="btn btn-sm ${_mrTab === 'period' ? 'btn-primary' : 'btn-secondary'}" onclick="mrSetTab('period')">🗓 Period Report</button>
        </div>
        <div id="mrFilters"></div>
        <div id="mrBody"><div class="loading" style="text-align:center;padding:40px">Loading…</div></div>
    `;
    await mrLoad();
}

function mrSetTab(tab) {
    _mrTab = tab;
    renderManagementReports();
}

async function mrLoad() {
    const body = document.getElementById('mrBody');
    const filters = document.getElementById('mrFilters');
    if (!body) return;

    if (_mrTab === 'analysis') {
        const s = _mrState.analysis;
        filters.innerHTML = `
            <div class="card" style="margin-bottom:14px"><div class="filter-bar" style="margin:0">
                <div class="form-group"><label>From</label><input type="date" class="form-control" id="mrAFrom" value="${s.from_date}"></div>
                <div class="form-group"><label>To</label><input type="date" class="form-control" id="mrATo" value="${s.to_date}"></div>
                <div class="form-group"><label>Group By</label>
                    <select class="form-control" id="mrAGroup">
                        <option value="category" ${s.group_by === 'category' ? 'selected' : ''}>Category</option>
                        <option value="date" ${s.group_by === 'date' ? 'selected' : ''}>Date</option>
                        <option value="party" ${s.group_by === 'party' ? 'selected' : ''}>Party / Employee / Vehicle</option>
                        <option value="source" ${s.group_by === 'source' ? 'selected' : ''}>Register</option>
                    </select></div>
                <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="mrApplyAnalysis()">Apply</button></div>
            </div></div>`;
        const r = await window.api.getExpenseAnalysis({ from_date: s.from_date, to_date: s.to_date, group_by: s.group_by });
        if (r && r.success) _mrRenderAnalysis(r.data);
        else body.innerHTML = _mrError(r);
        return;
    }

    if (_mrTab === 'board') {
        const s = _mrState.board;
        filters.innerHTML = `
            <div class="card" style="margin-bottom:14px"><div class="filter-bar" style="margin:0">
                <div class="form-group"><label>Period From</label><input type="date" class="form-control" id="mrBFrom" value="${s.from_date}"></div>
                <div class="form-group"><label>Period To</label><input type="date" class="form-control" id="mrBTo" value="${s.to_date}"></div>
                <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="mrApplyBoard()">Apply</button></div>
                <div class="form-group" style="flex:1"><label>&nbsp;</label>
                    <div style="font-size:12px;color:var(--text-light);padding-top:6px">The previous period of equal length is compared automatically.</div></div>
            </div></div>`;
        const r = await window.api.getBoardReport({ from_date: s.from_date, to_date: s.to_date });
        if (r && r.success) _mrRenderBoard(r.data);
        else body.innerHTML = _mrError(r);
        return;
    }

    // period tab
    const s = _mrState.period;
    filters.innerHTML = `
        <div class="card" style="margin-bottom:14px"><div class="filter-bar" style="margin:0">
            <div class="form-group"><label>Report</label>
                <select class="form-control" id="mrPPeriod">
                    <option value="daily" ${s.period === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${s.period === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${s.period === 'monthly' ? 'selected' : ''}>Monthly</option>
                </select></div>
            <div class="form-group"><label>As of</label><input type="date" class="form-control" id="mrPAsOf" value="${s.as_of}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="mrApplyPeriod()">Apply</button></div>
        </div></div>`;
    const r = await window.api.getManagementReport({ period: s.period, as_of: s.as_of });
    if (r && r.success) _mrRenderPeriod(r.data);
    else body.innerHTML = _mrError(r);
}

function _mrError(r) {
    return `<div style="padding:20px;color:var(--danger)">Could not load the report: ${escapeHtml((r && r.error) || 'unknown error')}</div>`;
}

async function mrApplyAnalysis() {
    _mrState.analysis = {
        from_date: document.getElementById('mrAFrom')?.value || _mrState.analysis.from_date,
        to_date: document.getElementById('mrATo')?.value || _mrState.analysis.to_date,
        group_by: document.getElementById('mrAGroup')?.value || 'category'
    };
    await mrLoad();
}

async function mrApplyBoard() {
    _mrState.board = {
        from_date: document.getElementById('mrBFrom')?.value || _mrState.board.from_date,
        to_date: document.getElementById('mrBTo')?.value || _mrState.board.to_date
    };
    await mrLoad();
}

async function mrApplyPeriod() {
    _mrState.period = {
        period: document.getElementById('mrPPeriod')?.value || 'weekly',
        as_of: document.getElementById('mrPAsOf')?.value || _mrState.period.as_of
    };
    await mrLoad();
}

function _mrChecks(chips) {
    return (chips || []).map(c =>
        `<span class="badge ${c.ok ? 'badge-success' : 'badge-danger'}" title="${escapeHtml(String(c.expected))} vs ${escapeHtml(String(c.actual))}">${c.ok ? '✓' : '✗'} ${escapeHtml(c.name)}</span>`
    ).join(' ');
}

// ── Tab 1: Expense Analysis ───────────────────────────────────
function _mrRenderAnalysis(d) {
    const body = document.getElementById('mrBody');
    const rows = d.rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.key)}</strong>${r.count > 1 ? ` <span style="color:var(--text-light);font-size:11px">(${r.count})</span>` : ''}</td>
            <td class="text-right">${formatCurrency(r.amount)}</td>
            <td class="text-right" style="color:var(--text-light)">${r.previous !== undefined ? formatCurrency(r.previous) : '—'}</td>
            <td class="text-right" style="color:${(r.change || 0) > 0 ? 'var(--danger)' : (r.change || 0) < 0 ? 'var(--success, #16a34a)' : 'inherit'}">${r.change !== undefined ? (r.change > 0 ? '+' : '') + formatCurrency(r.change) : '—'}</td>
            <td class="text-right">${r.percent_of_sales !== undefined ? r.percent_of_sales + '%' : '—'}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Total Spend</span>
                <span class="value" style="font-size:20px">${formatCurrency(d.total)}</span>
                <span class="sub">${formatDate(d.from_date)} → ${formatDate(d.to_date)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Milk Procurement</span>
                <span class="value" style="font-size:20px">${formatCurrency(d.split.milk_procurement)}</span>
                <span class="sub">${formatCurrency(d.split.purchases)} in purchases</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Operating Expenses</span>
                <span class="value" style="font-size:20px">${formatCurrency(d.split.operating)}</span>
                <span class="sub">${d.sales > 0 ? ((d.split.operating / d.sales) * 100).toFixed(1) : 0}% of sales</span></div>
            <div class="summary-card ${d.all_checks_ok ? 'card-success' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">Reconciliation</span>
                <span class="value" style="font-size:16px">${d.all_checks_ok ? '✅ Matches P&L' : '⚠️ Mismatch'}</span>
                <span class="sub">Sales base: ${formatCurrency(d.sales)}</span></div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Expense Analysis — by ${escapeHtml(d.group_by)}</h2>
                <span style="font-size:12px;color:var(--text-light)">Previous period: ${d.previous ? `${formatDate(d.previous.from_date)} → ${formatDate(d.previous.to_date)} (${formatCurrency(d.previous.total)})` : '—'}</span>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr>
                        <th>${d.group_by === 'category' ? 'Category' : d.group_by === 'party' ? 'Party / Employee' : d.group_by === 'date' ? 'Date' : 'Register'}</th>
                        <th class="text-right">Current</th>
                        <th class="text-right">Previous</th>
                        <th class="text-right">Change</th>
                        <th class="text-right">% of Sales</th>
                    </tr></thead>
                    <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:26px;color:var(--text-light)">No expenses in this range.</td></tr>'}</tbody>
                    <tfoot><tr style="font-weight:700;background:var(--bg)">
                        <td>Total</td>
                        <td class="text-right">${formatCurrency(d.total)}</td>
                        <td class="text-right">${d.previous ? formatCurrency(d.previous.total) : ''}</td>
                        <td class="text-right">${d.previous ? formatCurrency(d.total - d.previous.total) : ''}</td>
                        <td class="text-right">${d.sales > 0 ? ((d.total / d.sales) * 100).toFixed(1) + '%' : ''}</td>
                    </tr></tfoot>
                </table>
            </div>
            <div style="padding:8px 14px">${_mrChecks(d.checks)}</div>
        </div>`;
}

// ── Tab 2: Board Report ───────────────────────────────────────
function _mrRenderBoard(b) {
    const body = document.getElementById('mrBody');
    const money = formatCurrency;
    const rev = b.revenue;

    const opexRows = b.operating_expenses.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.category)}</strong></td>
            <td class="text-right">${money(r.current)}</td>
            <td class="text-right" style="color:var(--text-light)">${money(r.previous)}</td>
            <td class="text-right" style="color:${r.change > 0 ? 'var(--danger)' : r.change < 0 ? 'var(--success, #16a34a)' : 'inherit'}">${r.change > 0 ? '+' : ''}${money(r.change)}</td>
            <td class="text-right">${r.percent_of_sales}%</td>
        </tr>`).join('');

    const breakdownRows = Object.entries(rev.breakdown || {})
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `<tr><td style="padding-left:20px">${escapeHtml(k)}</td><td class="text-right">${money(v)}</td><td class="text-right" style="color:var(--text-light)">${money((rev.previous_breakdown || {})[k] || 0)}</td></tr>`).join('');

    body.innerHTML = `
        <div class="card" style="margin-bottom:14px">
            <div class="card-header">
                <h2>🏛 Board Management Report</h2>
                <span style="font-size:13px;color:var(--text-light)">
                    Period ${formatDate(b.period.from_date)} → ${formatDate(b.period.to_date)} ·
                    Previous ${formatDate(b.previous_period.from_date)} → ${formatDate(b.previous_period.to_date)}
                </span>
            </div>
            <div style="padding:0 14px 10px">${_mrChecks(b.checks)}</div>
        </div>

        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Revenue</span><span class="value" style="font-size:20px">${money(rev.total_income)}</span>
                <span class="sub">Sales ${money(rev.total_sales)} · Other ${money(rev.other_income)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Cost of Goods Sold</span><span class="value" style="font-size:20px">${money(b.cogs.total)}</span>
                <span class="sub">Raw milk ${money(b.cogs.raw_milk_cost)} · Production ${money(b.cogs.production_purchases)}</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Gross Profit</span><span class="value" style="font-size:20px">${money(b.gross_profit)}</span>
                <span class="sub">${rev.total_sales > 0 ? ((b.gross_profit / rev.total_sales) * 100).toFixed(1) : 0}% of sales${b.cogs.lot_basis_cogs != null ? ` · lot COGS ${money(b.cogs.lot_basis_cogs)}` : ''}</span></div>
            <div class="summary-card ${b.net.net_profit >= 0 ? 'card-success' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">Net Profit / Loss</span><span class="value" style="font-size:20px">${money(b.net.net_profit)}</span>
                <span class="sub">Op-ex ${money(b.operating_expenses_total)} · previous ${money(b.previous_operating_expenses_total)}</span></div>
        </div>

        <div class="dashboard-grid">
            <div class="card">
                <div class="card-header"><h2>1. Revenue</h2></div>
                <div class="table-container"><table>
                    <thead><tr><th>Source</th><th class="text-right">Current</th><th class="text-right">Previous</th></tr></thead>
                    <tbody>
                        <tr><td><strong>Total sales</strong></td><td class="text-right"><strong>${money(rev.total_sales)}</strong></td><td class="text-right" style="color:var(--text-light)">${money(rev.previous_total_sales)}</td></tr>
                        ${breakdownRows}
                        <tr><td>Other operating income</td><td class="text-right">${money(rev.other_income)}</td><td class="text-right" style="color:var(--text-light)">—</td></tr>
                        <tr style="font-weight:700"><td>Total income</td><td class="text-right">${money(rev.total_income)}</td><td class="text-right" style="color:var(--text-light)">${money((b.previous_pnl && b.previous_pnl.income && b.previous_pnl.income.total_income) || 0)}</td></tr>
                    </tbody>
                </table></div>
            </div>

            <div class="card">
                <div class="card-header"><h2>2. Cost of Goods Sold</h2></div>
                <div class="table-container"><table>
                    <tbody>
                        <tr><td>Raw milk cost</td><td class="text-right">${money(b.cogs.raw_milk_cost)}</td></tr>
                        <tr><td>Production / packaging purchases</td><td class="text-right">${money(b.cogs.production_purchases)}</td></tr>
                        <tr style="font-weight:700;border-top:2px solid var(--border)"><td>COGS</td><td class="text-right">${money(b.cogs.total)}</td></tr>
                        ${b.cogs.lot_basis_cogs != null ? `<tr><td style="color:var(--text-light)">Lot-basis COGS (FIFO, reference)</td><td class="text-right" style="color:var(--text-light)">${money(b.cogs.lot_basis_cogs)}</td></tr>` : ''}
                        <tr><td><strong>Gross profit (sales − COGS)</strong></td><td class="text-right"><strong>${money(b.gross_profit)}</strong></td></tr>
                    </tbody>
                </table></div>
            </div>
        </div>

        <div class="card" style="margin-top:14px">
            <div class="card-header"><h2>3. Operating Expenses</h2></div>
            <div class="table-container"><table>
                <thead><tr><th>Expense Category</th><th class="text-right">Current Period</th><th class="text-right">Previous Period</th><th class="text-right">Change</th><th class="text-right">% of Sales</th></tr></thead>
                <tbody>${opexRows || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-light)">No operating expenses</td></tr>'}</tbody>
                <tfoot><tr style="font-weight:700;background:var(--bg)">
                    <td>Total operating expenses</td>
                    <td class="text-right">${money(b.operating_expenses_total)}</td>
                    <td class="text-right">${money(b.previous_operating_expenses_total)}</td>
                    <td class="text-right">${b.operating_expenses_total - b.previous_operating_expenses_total > 0 ? '+' : ''}${money(b.operating_expenses_total - b.previous_operating_expenses_total)}</td>
                    <td class="text-right">${rev.total_sales > 0 ? ((b.operating_expenses_total / rev.total_sales) * 100).toFixed(1) + '%' : ''}</td>
                </tr></tfoot>
            </table></div>
        </div>

        <div class="card" style="margin-top:14px">
            <div class="card-header"><h2>4. Net Profit / Loss</h2></div>
            <div class="table-container"><table>
                <tbody>
                    <tr><td>Revenue</td><td class="text-right">${money(b.net.revenue)}</td></tr>
                    <tr><td>− Cost of Goods Sold</td><td class="text-right">− ${money(b.net.cogs)}</td></tr>
                    <tr style="font-weight:700"><td>= Gross Profit</td><td class="text-right"><strong>${money(b.net.gross_profit)}</strong></td></tr>
                    <tr><td>− Operating Expenses</td><td class="text-right">− ${money(b.net.operating_expenses)}</td></tr>
                    <tr style="font-weight:800;font-size:16px;border-top:2px solid var(--border)"><td>= Net Profit / Loss</td><td class="text-right" style="color:${b.net.net_profit >= 0 ? 'var(--success, #16a34a)' : 'var(--danger)'}">${money(b.net.net_profit)}</td></tr>
                </tbody>
            </table></div>
        </div>

        <div class="card" style="margin-top:14px">
            <div class="card-header"><h2>5. Expense-Control Indicators (factual)</h2></div>
            <div style="padding:10px 14px">
                ${b.indicators.map(i => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">📌 ${escapeHtml(i.text)}</div>`).join('') || '<div style="color:var(--text-light)">No comparable movements in this period.</div>'}
                <div style="font-size:11px;color:var(--text-light);margin-top:8px">Indicators state measured numbers only — no good/bad judgement is applied.</div>
            </div>
        </div>`;
}

// ── Tab 3: Daily / weekly / monthly ───────────────────────────
function _mrRenderPeriod(r) {
    const body = document.getElementById('mrBody');
    const c = r.current;
    if (!c) { body.innerHTML = '<div style="padding:20px;color:var(--text-light)">No data for this period.</div>'; return; }

    const label = (k) => ({
        milk_received_liters: 'Milk received (L)', milk_cost: 'Milk purchase cost', avg_milk_cost_per_liter: 'Avg milk cost / L',
        milk_processed_liters: 'Milk processed (L)', milk_sold_liters: 'Milk sold (L)', avg_sales_realization_per_liter: 'Sales realization / L',
        production_output_quantity: 'Production output (qty)', total_sales: 'Total sales', total_income: 'Total income',
        cogs: 'COGS', gross_profit: 'Gross profit', operating_expenses: 'Operating expenses', net_profit: 'Net profit / loss',
        receivables: 'Outstanding receivables', payables: 'Outstanding payables',
        advances_outstanding: 'Outstanding advances', stock_value: 'Stock value'
    })[k] || k;
    const fmt = (k, v) => (v === null || v === undefined) ? '—'
        : /liters|quantity/.test(k) ? formatNumber(v) : formatCurrency(v);

    const rows = Object.entries(r.compare).map(([k, v]) => `
        <tr>
            <td><strong>${escapeHtml(label(k))}</strong></td>
            <td class="text-right">${fmt(k, v.current)}</td>
            <td class="text-right" style="color:var(--text-light)">${fmt(k, v.previous)}</td>
            <td class="text-right" style="color:${(v.change || 0) > 0 ? 'var(--success, #16a34a)' : (v.change || 0) < 0 ? 'var(--danger)' : 'inherit'}">${v.change === null || v.change === undefined ? '—' : (v.change > 0 ? '+' : '') + fmt(k, v.change)}</td>
        </tr>`).join('');

    const trendRows = (r.trend && r.trend.months || []).map(m => `
        <tr><td>${escapeHtml(m.month || m.label || '')}</td>
            <td class="text-right">${formatCurrency(m.total_sales || m.sales || 0)}</td>
            <td class="text-right">${formatCurrency(m.total_expenses || m.expenses || 0)}</td>
            <td class="text-right" style="font-weight:700;color:${(m.net_profit ?? m.net ?? 0) >= 0 ? 'var(--success, #16a34a)' : 'var(--danger)'}">${formatCurrency(m.net_profit ?? m.net ?? 0)}</td></tr>`).join('');

    body.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Sales</span><span class="value" style="font-size:20px">${formatCurrency(c.total_sales)}</span>
                <span class="sub">Income ${formatCurrency(c.total_income)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">COGS</span><span class="value" style="font-size:20px">${formatCurrency(c.cogs)}</span>
                <span class="sub">Milk ${formatCurrency(c.milk_cost)} · Avg ${formatCurrency(c.avg_milk_cost_per_liter)}/L</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Gross Profit</span><span class="value" style="font-size:20px">${formatCurrency(c.gross_profit)}</span>
                <span class="sub">Op-ex ${formatCurrency(c.operating_expenses)}</span></div>
            <div class="summary-card ${c.net_profit >= 0 ? 'card-success' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">Net Profit / Loss</span><span class="value" style="font-size:20px">${formatCurrency(c.net_profit)}</span>
                <span class="sub">Receivables ${formatCurrency(c.receivables)} · Payables ${formatCurrency(c.payables)}</span></div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>${r.period === 'daily' ? 'Daily' : r.period === 'weekly' ? 'Weekly' : 'Monthly'} Management Report</h2>
                <span style="font-size:12px;color:var(--text-light)">
                    ${formatDate(c.from_date)} → ${formatDate(c.to_date)}${r.previous ? ` · compared with ${formatDate(r.previous.from_date)} → ${formatDate(r.previous.to_date)}` : ''}
                </span>
            </div>
            <div class="table-container"><table>
                <thead><tr><th>Metric</th><th class="text-right">Current</th><th class="text-right">Previous</th><th class="text-right">Change</th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
            <div style="padding:8px 14px">${_mrChecks(r.checks)}</div>
        </div>

        ${trendRows ? `
        <div class="card" style="margin-top:14px">
            <div class="card-header"><h2>Monthly trend</h2></div>
            <div class="table-container"><table>
                <thead><tr><th>Month</th><th class="text-right">Sales</th><th class="text-right">Expenses</th><th class="text-right">Net</th></tr></thead>
                <tbody>${trendRows}</tbody>
            </table></div>
        </div>` : ''}`;
}

async function mrPrint() {
    const el = document.getElementById('mrBody');
    if (!el) return;
    const settings = await getSettingsCached();
    printHTML(`
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Management Report — ${_mrTab === 'analysis' ? 'Expense Analysis' : _mrTab === 'board' ? 'Board Report' : 'Period Report'}</h2><p>${formatDate(today())}</p></div>
        ${el.innerHTML}
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>`);
}

// Globals
window.renderManagementReports = renderManagementReports;
window.mrSetTab = mrSetTab;
window.mrApplyAnalysis = mrApplyAnalysis;
window.mrApplyBoard = mrApplyBoard;
window.mrApplyPeriod = mrApplyPeriod;
window.mrPrint = mrPrint;
