/**
 * Dashboard Module
 * Shows summary cards, recent transactions, monthly charts, low stock alerts
 */

async function renderDashboard() {
    const container = document.getElementById('page-dashboard');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading dashboard...</div>';

    const [result, milkResult, todayResult] = await Promise.all([
        window.api.getDashboard(),
        window.api.getMilkSummary({ date: today() }),
        window.api.getTodaySummary()
    ]);

    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load dashboard: ${result.error}</div>`;
        return;
    }

    const d = result.data;
    const milk = milkResult.success ? milkResult.data : { todayTotal: { total_liters: 0, total_amount: 0, collection_count: 0 } };
    const t = todayResult.success ? todayResult.data : { todaySales: { total: 0, paid: 0 }, todayPurchases: { total: 0, paid: 0 }, todayPettyCash: { total: 0 }, todayExpenses: { total: 0 }, todayVehicleExpenses: { total: 0 } };
    const settings = await getSettingsCached();

    const cp = d.cashPosition || { cash_in: 0, cash_out: 0, net_cash: 0 };
    const nr = d.netReceivable || 0;
    const ps = d.profitSnapshot || { total_income: 0, total_expenses: 0, net_profit: 0 };
    const totalReceivable = d.receivables?.total || 0;
    const totalPayable = d.payables?.total || 0;
    // Post-dated cheque position — deliberately NOT part of cash/bank above:
    // a cheque that is still held has moved no money. Shown only when the
    // register has something to say, so existing dashboards stay uncluttered.
    const pdc = d.pdc || null;
    const pdcAlert = pdc && (pdc.pdc_receivable > 0 || pdc.pdc_payable > 0 || (pdc.overdue && pdc.overdue.count > 0));
    // Outstanding advances + ageing (spec Phase 10) — same register as the
    // Advances page; the dashboard only displays it.
    const adv = d.advances || null;
    const advAlert = adv && adv.total_outstanding > 0;
    // KPI derivations — display-only maths over values already computed by
    // getProfitLoss / getMilkSummary above (no second source of truth).
    const revenue = ps.revenue != null ? ps.revenue : ps.total_income;
    const cogs = ps.cogs || 0;
    const milkCost = ps.milk_cost != null ? ps.milk_cost : 0;
    const milkLiters = (milk.todayTotal && milk.todayTotal.total_liters) || 0;
    const avgMilkCostPL = milkLiters > 0 ? milkCost / milkLiters : null;
    const gpMarginPct = (ps.gross_profit != null && revenue > 0)
        ? (ps.gross_profit / revenue) * 100 : null;

    container.innerHTML = `
        <!-- Global Search -->
        <div class="card" style="margin-bottom:16px">
            <div style="display:flex;gap:8px;align-items:center">
                <span style="font-size:20px">🔍</span>
                <input id="global-search-input" class="form-control" type="text"
                    placeholder="Search anything — invoice no, bill no, party, phone, product, milk collection, voucher, amount…"
                    style="flex:1;font-size:15px;padding:10px 14px" autocomplete="off">
                <button class="btn btn-primary" id="global-search-btn" onclick="runGlobalSearch()">Search</button>
                <button class="btn btn-sm" id="global-search-clear" style="display:none" onclick="clearGlobalSearch()">✕ Clear</button>
            </div>
            <div id="global-search-results" style="margin-top:12px"></div>
        </div>

        <!-- KPI Hero Row 1 — today's P&L (identical to the P&L page) -->
        <div class="kpi-grid">
            <div class="kpi-card kpi-primary kpi-click" onclick="navigateTo('profit-loss')" title="Open the P&L page">
                <span class="kpi-label">Today's Sales</span>
                <span class="kpi-value">${formatCurrency(revenue)}</span>
                <span class="kpi-sub">Received: ${formatCurrency(d.todaySales.paid)}</span>
            </div>
            <div class="kpi-card kpi-warning kpi-click" onclick="navigateTo('profit-loss')" title="Open the P&L page">
                <span class="kpi-label">Cost of Goods Sold</span>
                <span class="kpi-value">${formatCurrency(cogs)}</span>
                <span class="kpi-sub">Milk: ${formatCurrency(milkCost)} · Other purchases: ${formatCurrency(cogs - milkCost)}</span>
            </div>
            <div class="kpi-card ${ps.gross_profit != null && ps.gross_profit >= 0 ? 'kpi-success' : 'kpi-danger'} kpi-click" onclick="navigateTo('profit-loss')" title="Open the P&L page">
                <span class="kpi-label">Gross Profit</span>
                <span class="kpi-value ${ps.gross_profit != null && ps.gross_profit >= 0 ? 'kpi-positive' : 'kpi-negative'}">${ps.gross_profit != null ? formatCurrency(ps.gross_profit) : '—'}</span>
                <span class="kpi-sub">${gpMarginPct != null ? gpMarginPct.toFixed(1) + '% of sales' : 'Margin unavailable'}</span>
            </div>
            <div class="kpi-card ${ps.net_profit >= 0 ? 'kpi-success' : 'kpi-danger'} kpi-click" onclick="navigateTo('profit-loss')" title="Same numbers as the P&L page">
                <span class="kpi-label">Net Profit / Loss</span>
                <span class="kpi-value ${ps.net_profit >= 0 ? 'kpi-positive' : 'kpi-negative'}">${formatCurrency(ps.net_profit)}</span>
                <span class="kpi-sub">OpEx: ${formatCurrency(ps.operating_expenses != null ? ps.operating_expenses : ps.total_expenses)}</span>
            </div>
        </div>

        <!-- KPI Hero Row 2 — operations -->
        <div class="kpi-grid">
            <div class="kpi-card kpi-info kpi-click" onclick="navigateTo('milk')" title="Open Milk Collection">
                <span class="kpi-label">Milk Received Today</span>
                <span class="kpi-value">${formatNumber(milkLiters)} L</span>
                <span class="kpi-sub">${formatCurrency(milk.todayTotal.total_amount)} · ${milk.todayTotal.collection_count} collections</span>
            </div>
            <div class="kpi-card kpi-primary kpi-click" onclick="navigateTo('profit-loss')" title="Today's milk cost ÷ liters received">
                <span class="kpi-label">Avg Milk Cost / L</span>
                <span class="kpi-value">${avgMilkCostPL != null ? formatCurrency(avgMilkCostPL) : '—'}</span>
                <span class="kpi-sub">Today's milk cost: ${formatCurrency(milkCost)}</span>
            </div>
            ${adv ? `
            <div class="kpi-card ${adv.overdue > 0 ? 'kpi-warning' : 'kpi-info'} kpi-click" onclick="navigateTo('advances')" title="Open the Advance Recovery Register">
                <span class="kpi-label">Outstanding Advances</span>
                <span class="kpi-value">${formatCurrency(adv.total_outstanding)}</span>
                <span class="kpi-sub">Overdue 7+: ${formatCurrency(adv.overdue)} · ${adv.open_advances} open</span>
            </div>` : `
            <div class="kpi-card ${nr >= 0 ? 'kpi-success' : 'kpi-warning'} kpi-click" onclick="navigateTo('receivable-payable')" title="Click for details">
                <span class="kpi-label">Receivables vs Payables</span>
                <span class="kpi-value">${formatCurrency(nr)}</span>
                <span class="kpi-sub">Receivable: ${formatCurrency(totalReceivable)} · Payable: ${formatCurrency(totalPayable)}</span>
            </div>`}
            <div class="kpi-card ${cp.net_cash >= 0 ? 'kpi-success' : 'kpi-danger'} kpi-click" onclick="navigateTo('cash-collection')" title="Click for details">
                <span class="kpi-label">Today's Cash Position</span>
                <span class="kpi-value ${cp.net_cash >= 0 ? 'kpi-positive' : 'kpi-negative'}">${formatCurrency(cp.net_cash)}</span>
                <span class="kpi-sub">In: ${formatCurrency(cp.cash_in)} · Out: ${formatCurrency(cp.cash_out)}</span>
            </div>
        </div>

        ${advAlert ? `
        <!-- Advance ageing detail (the headline number is in the KPI row above) -->
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin:8px 0">
            <div class="summary-card ${adv.overdue > 0 ? 'card-warning' : 'card-info'}" style="margin:0;cursor:pointer" onclick="navigateTo('advances')" title="Open the Advance Recovery Register">
                <span class="label">Advance Ageing — Current (0–6 d)</span>
                <span class="value" style="font-size:22px">${formatCurrency(adv.current)}</span>
                <span class="sub">Overdue 7+: ${formatCurrency(adv.overdue)} · Given total: ${formatCurrency(adv.advance_given)}</span>
            </div>
            <div class="summary-card ${adv.bucket_30 > 0 ? 'card-warning' : 'card-info'}" style="margin:0;cursor:pointer" onclick="navigateTo('advances')">
                <span class="label">Aged 30+ / 60+ days</span>
                <span class="value" style="font-size:22px">${formatCurrency(adv.bucket_30)} / ${formatCurrency(adv.bucket_60)}</span>
                <span class="sub">Open advances: ${adv.open_advances}</span>
            </div>
            <div class="summary-card ${adv.bucket_90 > 0 ? 'card-danger' : 'card-info'}" style="margin:0;cursor:pointer" onclick="navigateTo('advances')">
                <span class="label">Aged 90+ days</span>
                <span class="value" style="font-size:22px">${formatCurrency(adv.bucket_90)}</span>
                <span class="sub">Adjusted to date: ${formatCurrency(adv.adjusted)}</span>
            </div>
        </div>` : ''}

        ${pdcAlert ? `
        <!-- Post-Dated Cheques (never mixed into cash/bank) -->
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin:8px 0">
            <div class="summary-card card-primary" style="margin:0;cursor:pointer" onclick="pdcOpenWithFilter({pdc_type:'received'})" title="Open the cheque register">
                <span class="label">🏛 PDC Receivable (expected)</span>
                <span class="value" style="font-size:22px">${formatCurrency(pdc.pdc_receivable)}</span>
                <span class="sub">${pdc.pdc_receivable_count} cheque(s) held — not yet in the bank</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;cursor:pointer" onclick="pdcOpenWithFilter({pdc_type:'issued'})" title="Open the cheque register">
                <span class="label">🏛 PDC Payable (to pay)</span>
                <span class="value" style="font-size:22px">${formatCurrency(pdc.pdc_payable)}</span>
                <span class="sub">${pdc.pdc_payable_count} cheque(s) issued</span>
            </div>
            <div class="summary-card ${pdc.overdue && pdc.overdue.count ? 'card-danger' : 'card-info'}" style="margin:0;cursor:pointer" onclick="pdcOpenWithFilter({due:'overdue'})" title="Open the cheque register">
                <span class="label">🏛 PDC Due / Overdue</span>
                <span class="value" style="font-size:22px">${formatCurrency((pdc.due_today ? pdc.due_today.amount : 0))}</span>
                <span class="sub">Due today: ${pdc.due_today ? pdc.due_today.count : 0} | Overdue: ${pdc.overdue ? pdc.overdue.count : 0}</span>
            </div>
        </div>` : ''}

        <!-- Secondary summary cards -->
        <div class="summary-cards">
            <div class="summary-card card-success" style="cursor:pointer" onclick="navigateTo('purchases')" title="Open Purchases">
                <span class="label">Today's Purchases</span>
                <span class="value" style="font-size:22px">${formatCurrency(d.todayPurchases.total)}</span>
                <span class="sub">Paid: ${formatCurrency(d.todayPurchases.paid)}</span>
            </div>
            ${adv ? `<div class="summary-card card-primary" style="cursor:pointer" onclick="navigateTo('receivable-payable')" title="Click for details">
                <span class="label">Receivables vs Payables</span>
                <span class="value" style="font-size:22px">${formatCurrency(nr)}</span>
                <span class="sub">Receivable: ${formatCurrency(totalReceivable)} · Payable: ${formatCurrency(totalPayable)}</span>
            </div>` : ''}
            <div class="summary-card card-warning" style="cursor:pointer" onclick="navigateTo('petty-cash')" title="Open Petty Cash">
                <span class="label">Today Petty Cash</span>
                <span class="value" style="font-size:22px">${formatCurrency(t.todayPettyCash.total)}</span>
                <span class="sub">Expenses today</span>
            </div>
            <div class="summary-card card-danger" style="cursor:pointer" onclick="navigateTo('expenses')" title="Open Expenses">
                <span class="label">Today Expenses</span>
                <span class="value" style="font-size:22px">${formatCurrency(t.todayExpenses.total)}</span>
                <span class="sub">+ Vehicle: ${formatCurrency(t.todayVehicleExpenses.total)}</span>
            </div>
        </div>

        <div class="dashboard-grid">
            <!-- Monthly Sales/Purchase Chart -->
            <div class="card">
                <div class="card-header">
                    <h2>Monthly Summary</h2>
                </div>
                <div id="monthlyChartContainer">
                    ${renderMonthlyChart(d.monthlySales, d.monthlyPurchases)}
                </div>
                <div id="monthlyMilkContainer" style="margin-top:8px">
                    ${renderMonthlyMilkChart(d.monthlyMilk)}
                </div>
            </div>

            <!-- Stock Value & Products -->
            <div class="card">
                <div class="card-header">
                    <h2>Stock Overview</h2>
                </div>
                <div class="summary-cards" style="grid-template-columns:1fr 1fr;margin-bottom:0">
                    <div class="summary-card card-info" style="margin:0">
                        <span class="label">Total Products</span>
                        <span class="value" style="font-size:22px">${d.stockSummary.product_count}</span>
                    </div>
                    <div class="summary-card card-success" style="margin:0">
                        <span class="label">Stock Value</span>
                        <span class="value" style="font-size:22px">${formatCurrency(d.stockSummary.stock_value)}</span>
                    </div>
                </div>
                ${d.lowStock && d.lowStock.length > 0 ? `
                    <div style="margin-top:16px;padding:12px;background:#fff3cd;border-radius:6px;border:1px solid #ffc107">
                        <strong>⚠️ Low Stock Alerts:</strong>
                        ${d.lowStock.map(p => `<div style="font-size:13px;margin-top:4px">${p.name}: ${formatNumber(p.current_stock)} ${p.unit} (Reorder: ${formatNumber(p.reorder_level)} ${p.unit})</div>`).join('')}
                    </div>
                ` : '<div style="margin-top:16px;padding:12px;background:#d4edda;border-radius:6px;color:#155724">✅ All stock levels are adequate.</div>'}
            </div>

            <!-- Top Customer & Supplier -->
            <div class="card">
                <div class="card-header">
                    <h2>Top Performers</h2>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                    <div>
                        <div style="font-size:12px;color:var(--text-light);margin-bottom:4px">🏆 Top Customer</div>
                        <div style="font-size:16px;font-weight:600">${escapeHtml(d.topCustomer.name)}</div>
                        <div style="font-size:14px;color:var(--accent)">${formatCurrency(d.topCustomer.total)}</div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:var(--text-light);margin-bottom:4px">🏆 Top Supplier</div>
                        <div style="font-size:16px;font-weight:600">${escapeHtml(d.topSupplier.name)}</div>
                        <div style="font-size:14px;color:var(--warning)">${formatCurrency(d.topSupplier.total)}</div>
                    </div>
                </div>
                <div style="margin-top:16px;padding:12px;background:var(--bg);border-radius:6px">
                    <div style="font-size:12px;color:var(--text-light);margin-bottom:8px">Quick Links</div>
                    <div class="btn-group">
                        <button class="btn btn-primary btn-sm" onclick="navigateTo('sales')">New Sale</button>
                        <button class="btn btn-success btn-sm" onclick="navigateTo('purchases')">New Purchase</button>
                        <button class="btn btn-info btn-sm" onclick="navigateTo('parties')">Manage Parties</button>
                    </div>
                </div>
            </div>

            <!-- Recent Transactions -->
            <div class="card">
                <div class="card-header">
                    <h2>Recent Transactions</h2>
                </div>
                <div class="recent-transactions">
                    ${d.recentTransactions && d.recentTransactions.length > 0
                        ? d.recentTransactions.map(t => `
                            <div class="txn-item" style="cursor:pointer" onclick="viewTransactionDetail('${t.type}', ${t.id})">
                                <div class="txn-info">
                                    <span class="txn-type ${t.type}">${t.type}</span>
                                    <span class="txn-ref">${escapeHtml(t.ref_no)}</span>
                                    <span class="txn-party">${escapeHtml(t.party_name)}</span>
                                </div>
                                <div>
                                    <span class="txn-amount">${formatCurrency(t.grand_total)}</span>
                                    <div>${statusBadge(t.status)}</div>
                                </div>
                            </div>
                        `).join('')
                        : '<div style="text-align:center;padding:20px;color:var(--text-light)">No recent transactions</div>'
                    }
                </div>
            </div>
        </div>
    `;

    attachGlobalSearch();
}

// ──────────────────────────────────────────────────────────────
// Global Search
// Searches every module at once and shows grouped results.
// ──────────────────────────────────────────────────────────────
let _globalSearchTimer = null;

function attachGlobalSearch() {
    const input = document.getElementById('global-search-input');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(_globalSearchTimer);
        const q = input.value.trim();
        if (q.length === 0) { clearGlobalSearch(false); return; }
        _globalSearchTimer = setTimeout(() => runGlobalSearch(q), 350);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { clearTimeout(_globalSearchTimer); runGlobalSearch(); }
        if (e.key === 'Escape') { clearGlobalSearch(); }
    });
}

async function runGlobalSearch(q) {
    const input = document.getElementById('global-search-input');
    const box = document.getElementById('global-search-results');
    const clearBtn = document.getElementById('global-search-clear');
    if (!box) return;
    const query = (q !== undefined ? q : (input ? input.value : '')).trim();
    if (query.length < 2) {
        box.innerHTML = '';
        if (clearBtn) clearBtn.style.display = 'none';
        return;
    }
    if (clearBtn) clearBtn.style.display = '';
    box.innerHTML = '<div class="loading" style="text-align:center;padding:16px">Searching…</div>';
    const result = await window.api.globalSearch({ query });
    if (!result.success) {
        box.innerHTML = `<div class="error" style="padding:12px">Search failed: ${escapeHtml(result.error || 'unknown error')}</div>`;
        return;
    }
    renderGlobalSearchResults(result.data);
}

function renderGlobalSearchResults(data) {
    const box = document.getElementById('global-search-results');
    if (!box) return;
    if (!data || !data.groups || data.groups.length === 0) {
        box.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-light)">
            No matches found for "<strong>${escapeHtml(data.query)}</strong>" in any module.</div>`;
        return;
    }
    const head = `<div style="margin-bottom:8px;font-size:13px;color:var(--text-light)">
        Found <strong>${data.total}</strong> match${data.total === 1 ? '' : 'es'} for "<strong>${escapeHtml(data.query)}</strong>" across ${data.groups.length} module${data.groups.length === 1 ? '' : 's'} — click a row to open it:</div>`;
    const sections = data.groups.map(g => {
        const rows = g.rows.map(r => `
            <tr style="cursor:pointer" onclick="openSearchResult('${g.type}', ${r.id}, this)" title="Click to open">
                <td style="font-weight:600">${escapeHtml(String(r.title || ''))}</td>
                <td style="color:var(--text-light);font-size:12px">${escapeHtml(String(r.subtitle || ''))}</td>
                <td style="text-align:right;white-space:nowrap">${r.amount !== null && r.amount !== undefined ? formatCurrency(r.amount) : ''}</td>
                <td>${r.status ? statusBadge(r.status) : ''}</td>
            </tr>`).join('');
        const more = g.total > g.rows.length
            ? `<tr style="cursor:pointer;background:var(--bg)" onclick="navigateTo('${g.page}')">
                   <td colspan="4" style="text-align:center;color:var(--primary);font-size:13px">
                       + ${g.total - g.rows.length} more — open ${escapeHtml(g.label)} →</td></tr>`
            : '';
        return `
            <div style="margin-bottom:12px">
                <div style="font-size:13px;font-weight:700;margin-bottom:4px">${escapeHtml(g.label)}
                    <span style="color:var(--text-light);font-weight:400">(${g.total})</span></div>
                <table style="font-size:13px">
                    <thead><tr><th style="width:22%">Reference / Name</th><th>Details</th>
                        <th style="text-align:right;width:15%">Amount</th><th style="width:10%">Status</th></tr></thead>
                    <tbody>${rows}${more}</tbody>
                </table>
            </div>`;
    }).join('');
    box.innerHTML = head + sections;
}

async function openSearchResult(type, id, el) {
    if (type === 'sale') return viewSaleDetail(id);
    if (type === 'purchase') return viewPurchaseDetail(id);
    if (type === 'party' || type === 'ledger') return viewLedger(id);
    // Everything else: jump to the module page that owns the record.
    const pageMap = {
        payment: 'cash-collection', milk: 'milk', product: 'stock',
        petty_cash: 'petty-cash', bank: 'bank', batch: 'production',
        salary: 'salary', vehicle: 'vehicle', expense: 'expenses', deposit: 'cash-deposit'
    };
    if (pageMap[type]) navigateTo(pageMap[type]);
}

function clearGlobalSearch(refocus = true) {
    const input = document.getElementById('global-search-input');
    const box = document.getElementById('global-search-results');
    const clearBtn = document.getElementById('global-search-clear');
    clearTimeout(_globalSearchTimer);
    if (input && refocus) input.value = '';
    if (box) box.innerHTML = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (input && refocus) input.focus();
}

function renderMonthlyChart(salesData, purchaseData) {
    if (!salesData || salesData.length === 0) {
        return '<div style="text-align:center;padding:20px;color:var(--text-light)">No monthly data yet</div>';
    }

    const months = salesData.map(s => s.month);
    const maxVal = Math.max(
        ...salesData.map(s => s.total),
        ...purchaseData.map(p => p.total),
        1
    );

    const bars = months.map((month, i) => {
        const sale = salesData[i] || { total: 0 };
        const purchase = purchaseData.find(p => p.month === month) || { total: 0 };
        const saleH = (sale.total / maxVal) * 120;
        const purchaseH = (purchase.total / maxVal) * 120;

        return `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
                <div class="chart-bar" style="height:${Math.max(saleH, 4)}px;width:24px" title="Sales: ${formatCurrency(sale.total)}">
                    <span class="bar-value" style="font-size:8px">${formatCurrency(sale.total)}</span>
                </div>
                <div class="chart-bar purchase-bar" style="height:${Math.max(purchaseH, 4)}px;width:24px" title="Purchases: ${formatCurrency(purchase.total)}">
                    <span class="bar-value" style="color:#856404;font-size:8px">${formatCurrency(purchase.total)}</span>
                </div>
                <span style="font-size:9px;color:var(--text-light);margin-top:4px">${getMonthName(month)}</span>
            </div>
        `;
    }).join('');

    return `
        <div style="margin-bottom:20px">
            <div style="display:flex;gap:16px;font-size:12px;color:var(--text-light)">
                <span><span style="display:inline-block;width:12px;height:12px;background:var(--primary-light);border-radius:2px;margin-right:4px"></span> Sales</span>
                <span><span style="display:inline-block;width:12px;height:12px;background:var(--warning);border-radius:2px;margin-right:4px"></span> Purchases</span>
            </div>
        </div>
        <div class="monthly-chart" style="height:160px">
            ${bars}
        </div>
    `;
}

// Monthly milk received (litres) — same bar-chart language as the
// sales/purchase chart, single series, values shown only on hover.
function renderMonthlyMilkChart(milkData) {
    if (!milkData || milkData.length === 0) {
        return '<div style="text-align:center;padding:8px;color:var(--text-light);font-size:12px">No milk collection data yet</div>';
    }
    const maxVal = Math.max(...milkData.map(m => m.total), 1);
    const bars = milkData.map(m => {
        const h = (m.total / maxVal) * 100;
        return `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
                <div class="chart-bar" style="height:${Math.max(h, 4)}px;width:24px;background:var(--info)" title="${getMonthName(m.month)}: ${formatNumber(m.total)} L">
                    <span class="bar-value" style="font-size:8px">${formatNumber(m.total)}</span>
                </div>
                <span style="font-size:9px;color:var(--text-light);margin-top:4px">${getMonthName(m.month)}</span>
            </div>`;
    }).join('');
    return `
        <div style="margin-bottom:16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-light)">Milk Received (L)</div>
        <div class="monthly-chart" style="height:120px">${bars}</div>`;
}

async function viewTransactionDetail(type, id) {
    if (type === 'sale') {
        await viewSaleDetail(id);
    } else {
        await viewPurchaseDetail(id);
    }
}

// Cache for settings
let _settingsCache = null;

async function getSettingsCached() {
    if (_settingsCache) return _settingsCache;
    const result = await window.api.getSettings();
    if (result.success) {
        _settingsCache = result.data;
        return result.data;
    }
    return {};
}

function clearSettingsCache() {
    _settingsCache = null;
}
