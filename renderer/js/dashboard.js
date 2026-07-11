/**
 * Dashboard Module
 * Shows summary cards, recent transactions, monthly charts, low stock alerts
 */

async function renderDashboard() {
    const container = document.getElementById('page-dashboard');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading dashboard...</div>';

    const [result, milkResult] = await Promise.all([
        window.api.getDashboard(),
        window.api.getMilkSummary({ date: today() })
    ]);

    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load dashboard: ${result.error}</div>`;
        return;
    }

    const d = result.data;
    const milk = milkResult.success ? milkResult.data : { todayTotal: { total_liters: 0, total_amount: 0, collection_count: 0 } };
    const settings = await getSettingsCached();

    container.innerHTML = `
        <!-- Summary Cards -->
        <div class="summary-cards">
            <div class="summary-card card-primary">
                <span class="label">Today's Sales</span>
                <span class="value">${formatCurrency(d.todaySales.total)}</span>
                <span class="sub">Received: ${formatCurrency(d.todaySales.paid)}</span>
            </div>
            <div class="summary-card card-success">
                <span class="label">Today's Purchases</span>
                <span class="value">${formatCurrency(d.todayPurchases.total)}</span>
                <span class="sub">Paid: ${formatCurrency(d.todayPurchases.paid)}</span>
            </div>
            <div class="summary-card card-info">
                <span class="label">🥛 Today's Milk Collection</span>
                <span class="value" style="font-size:22px">${formatNumber(milk.todayTotal.total_liters)} L</span>
                <span class="sub">${formatCurrency(milk.todayTotal.total_amount)} | ${milk.todayTotal.collection_count} collections</span>
            </div>
            <div class="summary-card card-warning">
                <span class="label">Outstanding Receivables</span>
                <span class="value">${formatCurrency(d.receivables.total)}</span>
                <span class="sub">Due from customers</span>
            </div>
            <div class="summary-card card-danger">
                <span class="label">Outstanding Payables</span>
                <span class="value">${formatCurrency(d.payables.total)}</span>
                <span class="sub">Due to suppliers</span>
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
