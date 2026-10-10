/**
 * Financial Reports Module
 * ========================
 * Dedicated pages: Profit/Loss, Receivable/Payable, Stock Statement,
 * Daybook, Cash Collection — each as its own sidebar-accessible page.
 */

let _finLastData = {};

// ============================================================
// Profit & Loss Statement
// ============================================================
async function showProfitLoss(preloadedData = null) {
    const container = document.getElementById('page-profit-loss');
    // Store preloaded data first so the filter bar reflects the range just applied
    if (preloadedData) _finLastData.profitLoss = preloadedData;
    const preset = _finLastData.profitLoss
        ? { from: _finLastData.profitLoss.from_date, to: _finLastData.profitLoss.to_date }
        : getDatePreset('this_month');
    let data = preloadedData;
    if (!data) {
        const result = await window.api.getProfitLoss({ from_date: preset.from, to_date: preset.to });
        data = result.success ? result.data : { 
            income: { total_sales: 0, total_receipts: 0, total_other_income: 0, total_income: 0 },
            expenses: { milk_collection: { total: 0 }, purchases: { total: 0 }, other_expenses: { total: 0 }, petty_cash: { total: 0 }, salary: { total: 0 }, vehicle_expenses: { total: 0 }, total_expenses: 0 },
            gross_profit: 0, net_profit: 0 
        };
        _finLastData.profitLoss = data;
    }

    const isEmpty = data.income.total_income === 0 && data.expenses.total_expenses === 0 && data.sales_count === 0 && data.milk_collection_count === 0;

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📊 Profit & Loss Statement</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printProfitLoss()">🖨 Print</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From (BS)</label><input type="text" class="form-control" id="plFrom" placeholder="2083-05-01" value="${preset.from}" data-bs-date></div>
            <div class="form-group"><label>To (BS)</label><input type="text" class="form-control" id="plTo" placeholder="2083-05-32" value="${preset.to}" data-bs-date></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyProfitLoss()">Generate</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('today');document.getElementById('plFrom').value=p.from;document.getElementById('plTo').value=p.to;applyProfitLoss()">Today</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('this_month');document.getElementById('plFrom').value=p.from;document.getElementById('plTo').value=p.to;applyProfitLoss()">This Month</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('last_month');document.getElementById('plFrom').value=p.from;document.getElementById('plTo').value=p.to;applyProfitLoss()">Last Month</button>
            </div>
        </div>
        ${isEmpty ? `
        <div style="text-align:center;padding:40px 20px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:16px">
            <div style="font-size:48px;margin-bottom:12px">📊</div>
            <h3 style="font-size:16px;margin-bottom:8px;color:var(--text-light)">No Transactions Found</h3>
            <p style="font-size:13px;color:var(--text-light);max-width:400px;margin:0 auto;line-height:1.6">
                There are no sales, purchases, expenses, or other transactions recorded for this period.
                <br><br>
                <strong>Period:</strong> ${data.from_date || preset.from} to ${data.to_date || preset.to}
                <br><br>
                <span style="font-size:12px">Try selecting a different date range or record some transactions first.</span>
            </p>
        </div>
        ` : `
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">💰 Total Income</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.income.total_income)}</span>
                <span class="sub">Sales ${formatCurrency(data.income.total_sales)}${data.income.total_other_income ? ' + Other Income ' + formatCurrency(data.income.total_other_income) : ''}</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">📉 Total Expenses</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.expenses.total_expenses)}</span>
                <span class="sub">COGS ${formatCurrency(data.cogs || 0)} + Operating ${formatCurrency(data.operating_expenses || 0)}</span>
            </div>
            <div class="summary-card ${data.net_profit >= 0 ? 'card-primary' : 'card-danger'}" style="margin:0;padding:12px">
                <span class="label">${data.net_profit >= 0 ? '📈 Net Profit' : '📉 Net Loss'}</span>
                <span class="value" style="font-size:22px;font-weight:700">${formatCurrency(data.net_profit)}</span>
                <span class="sub">Gross Profit: ${formatCurrency(data.gross_profit)}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card">
                <div class="card-header"><h3>💰 Income Breakdown</h3></div>
                <table>
                    <thead><tr><th>Source</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        <tr><td>Sales (${data.sales_count || 0} invoices)</td><td class="text-right" style="color:var(--accent);font-weight:600">${formatCurrency(data.income.total_sales)}</td></tr>
                        ${data.income.total_other_income ? `<tr><td>Other Income</td><td class="text-right" style="color:var(--accent)">${formatCurrency(data.income.total_other_income)}</td></tr>` : ''}
                        <tr style="background:var(--bg);font-weight:700"><td>Total Income</td><td class="text-right">${formatCurrency(data.income.total_income)}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="card">
                <div class="card-header"><h3>📉 Expense Breakdown</h3></div>
                <table>
                    <thead><tr><th>Category</th><th class="text-right">Amount</th></tr></thead>
                    <tbody>
                        <tr><td>🥛 Milk Purchase — Milk Collection (${data.milk_collection_count || 0})</td><td class="text-right">${formatCurrency(data.expenses.milk_collection.total)}</td></tr>
                        <tr><td>📦 Purchases (non-milk)${data.milk_cost_basis && data.milk_cost_basis.linked_milk_in_purchases ? `<br><span style="font-size:11px;color:var(--text-light)">${formatCurrency(data.milk_cost_basis.linked_milk_in_purchases)} of milk already on the bills above is excluded — counted once</span>` : ''}</td><td class="text-right">${formatCurrency(data.expenses.purchases.total)}</td></tr>
                        <tr style="background:var(--bg);font-weight:600"><td>Cost of Goods Sold</td><td class="text-right">${formatCurrency(data.cogs || 0)}</td></tr>
                        <tr><td>👷 Salary</td><td class="text-right">${formatCurrency(data.expenses.salary.total)}</td></tr>
                        <tr><td>📋 Other Expenses</td><td class="text-right">${formatCurrency(data.expenses.other_expenses.total)}</td></tr>
                        <tr><td>💰 Petty Cash</td><td class="text-right">${formatCurrency(data.expenses.petty_cash.total)}</td></tr>
                        <tr><td>🚛 Vehicle Expenses</td><td class="text-right">${formatCurrency(data.expenses.vehicle_expenses.total)}</td></tr>
                        ${data.expenses.bank_expenses && data.expenses.bank_expenses.total ? `<tr><td>🏦 Office Expenses (paid from bank)</td><td class="text-right">${formatCurrency(data.expenses.bank_expenses.total)}</td></tr>` : ''}
                        <tr style="background:var(--bg);font-weight:600"><td>Operating Expenses</td><td class="text-right">${formatCurrency(data.operating_expenses || 0)}</td></tr>
                        <tr style="background:var(--bg);font-weight:700"><td>Total Expenses</td><td class="text-right">${formatCurrency(data.expenses.total_expenses)}</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
        <div class="card" style="margin-top:12px;padding:16px;text-align:center;background:${data.net_profit >= 0 ? 'var(--success-bg, #d4edda)' : 'var(--danger-bg, #f8d7da)'};border-radius:8px">
            <span style="font-size:18px;font-weight:700;color:${data.net_profit >= 0 ? 'var(--accent, #155724)' : 'var(--danger, #721c24)'}">
                ${data.net_profit >= 0 ? '✅ NET PROFIT: ' : '❌ NET LOSS: '} ${formatCurrency(Math.abs(data.net_profit))}
            </span>
            <span style="display:block;font-size:13px;margin-top:4px;opacity:0.8">
                Sales ${formatCurrency(data.income.total_sales)} − COGS ${formatCurrency(data.cogs || 0)} = Gross ${formatCurrency(data.gross_profit)} − Operating ${formatCurrency(data.operating_expenses || 0)} = Net ${formatCurrency(data.net_profit)}
            </span>
            <span style="display:block;font-size:12px;margin-top:6px;opacity:0.7">
                Cash collected in period: ${formatCurrency(data.income.total_receipts)} (shown for cash-flow reference; collections are against the same sales, not extra income)
            </span>
            <span style="display:block;font-size:13px;margin-top:4px;opacity:0.8">
                Period: ${data.from_date || preset.from} to ${data.to_date || preset.to}
            </span>
        </div>
        <div id="pl-reconcile-section" style="margin-top:20px"></div>
        <div id="pl-monthly-section" style="margin-top:20px"></div>
        `}
    `;
    enhanceProfitLossDateInputs(container);
    loadProfitLossReconciliation();
    loadProfitLossMonthly();
}

// ============================================================
// Cross-module reconciliation panel
// ============================================================
async function loadProfitLossReconciliation() {
    const section = document.getElementById('pl-reconcile-section');
    if (!section) return;
    const preset = _finLastData.profitLoss
        ? { from: _finLastData.profitLoss.from_date, to: _finLastData.profitLoss.to_date }
        : getDatePreset('this_month');
    const result = await window.api.getAccountingReconciliation({ from_date: preset.from, to_date: preset.to });
    if (!result.success) { section.innerHTML = ''; return; }
    renderProfitLossReconciliation(result.data);
}

/**
 * One panel where Daybook · Cash · Bank · Sales · Receivable · P&L are compared
 * for the same period. Every figure is produced by the shared accounting core,
 * so a transaction that shows up in two modules can be seen to be counted once.
 */
function renderProfitLossReconciliation(rec) {
    const section = document.getElementById('pl-reconcile-section');
    if (!section || !rec) return;
    _finLastData.reconciliation = rec;
    const fmt = formatCurrency;
    const row = (label, value, sub) => `
        <tr>
            <td>${label}${sub ? `<br><span style="font-size:11px;color:var(--text-light)">${sub}</span>` : ''}</td>
            <td class="text-right" style="font-weight:600">${fmt(value)}</td>
        </tr>`;
    const checks = (rec.checks || []).map(c => `
        <tr>
            <td>${c.ok ? '✅' : '❌'} ${escapeHtml(c.label)}</td>
            <td class="text-right" style="font-size:12px;color:${c.ok ? 'var(--accent)' : 'var(--danger)'}">
                ${c.ok ? 'balanced' : `off by ${fmt(c.difference)}`}
            </td>
        </tr>`).join('');

    section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">🔗 Cross-module Reconciliation</h3>
            <span style="font-size:12px;color:var(--text-light)">${rec.from_date} → ${rec.to_date}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card">
                <div class="card-header"><h3>Money flow</h3></div>
                <table>
                    <tbody>
                        ${row(`Sales (${rec.sales.count} invoices)`, rec.sales.total, 'Sales revenue in the P&L is the same figure')}
                        ${row('Customer receipts', rec.receivable.customer_receipts, `${rec.receivable.receipt_count} receipt transactions`)}
                        ${row('Receivable (sales − receipts)', rec.receivable.from_sales_minus_receipts, `party-ledger view ${fmt(rec.receivable.ledger_receivable)} — difference ${fmt(rec.receivable.difference_vs_ledger)} (opening balances / Excel adjustments)`)}
                        ${row('Cash received', rec.cash.cash_receipts, 'collections in cash, plus cash taken at the counter')}
                        ${row('Cash deposited to bank', rec.cash.deposited_to_bank, `${rec.transfers.bank_rows + rec.transfers.duplicate_of_cash_deposits} transfer row(s) — never income`)}
                        ${row('Cash balance', rec.cash.balance, `in ${fmt(rec.cash.total_in)} − out ${fmt(rec.cash.total_out)}`)}
                        ${row('Bank balance', rec.bank.balance, `in ${fmt(rec.bank.total_in)} − out ${fmt(rec.bank.total_out)}`)}
                    </tbody>
                </table>
            </div>
            <div class="card">
                <div class="card-header"><h3>Cost &amp; result</h3></div>
                <table>
                    <tbody>
                        ${row('Milk purchase cost (once)', rec.cost.milk_cost, `collections ${fmt(rec.cost.milk_collections)}; ${fmt(rec.cost.linked_to_purchase)} of milk on purchase bills excluded`)}
                        ${row('Purchases (non-milk)', rec.cost.non_milk_purchases, `gross purchase register ${fmt(rec.cost.purchases_total)}`)}
                        ${row('COGS', rec.cost.cogs, 'milk + non-milk purchases')}
                        ${row('Operating expenses', rec.expenses.total_operating_expenses, `other ${fmt(rec.expenses.other_expenses)} · petty ${fmt(rec.expenses.petty_cash)} · salary ${fmt(rec.expenses.salary)} · vehicle ${fmt(rec.expenses.vehicle_expenses)} · bank-paid ${fmt(rec.expenses.bank_expenses)}`)}
                        ${row('Net profit / (loss)', rec.profit.net_profit, `income ${fmt(rec.profit.total_income)} − expenses ${fmt(rec.profit.total_expenses)}`)}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="card" style="margin-top:12px">
            <div class="card-header"><h3>Consistency checks</h3></div>
            <table><tbody>${checks}</tbody></table>
        </div>
    `;
}

/**
 * Convert the P&L filter inputs (plFrom/plTo and the monthly comparison's
 * plmFrom/plmTo) to the same BS date picker used on the Statements page.
 *
 * These must remain type="text" (not type="date") because BS month-end values
 * like 2083-04-32 are invalid AD dates that a native date input would silently
 * blank — so they are tagged data-bs-date and initialized explicitly.
 */
function enhanceProfitLossDateInputs(scope) {
    if (typeof initBSDateInput !== 'function') return; // nepali-date.js not loaded
    (scope || document).querySelectorAll('input[data-bs-date]:not([data-bs-initialized="true"])').forEach(initBSDateInput);
}

async function applyProfitLoss() {
    const from = (document.getElementById('plFrom')?.value || '').trim();
    const to = (document.getElementById('plTo')?.value || '').trim();
    const bsDateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!bsDateRe.test(from) || !bsDateRe.test(to)) { showToast('Enter both dates as BS dates (YYYY-MM-DD)', 'warning'); return; }
    if (from > to) { showToast('From date must be on or before To date', 'warning'); return; }
    const result = await window.api.getProfitLoss({ from_date: from, to_date: to });
    if (result.success) {
        await showProfitLoss(result.data);
    } else {
        showToast(result.error || 'Failed to load', 'error');
    }
}

async function printProfitLoss() {
    const data = _finLastData.profitLoss;
    if (!data) { showToast('Generate report first', 'warning'); return; }
    const settings = await getSettingsCached();
    const exp = data.expenses;
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Profit & Loss Statement</h2><p>Period: ${data.from_date} to ${data.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Income</div><div class="value-number">${formatCurrency(data.income.total_income)}</div></div>
            <div class="value-card" style="border-color:var(--danger)"><div class="value-label">Total Expenses</div><div class="value-number">${formatCurrency(data.expenses.total_expenses)}</div></div>
            <div class="value-card" style="border-color:var(--accent)"><div class="value-label">Gross Profit</div><div class="value-number">${formatCurrency(data.gross_profit)}</div></div>
            <div class="value-card" style="border-color:${data.net_profit >= 0 ? 'var(--accent)' : 'var(--danger)'}"><div class="value-label">${data.net_profit >= 0 ? 'Net Profit' : 'Net Loss'}</div><div class="value-number">${formatCurrency(Math.abs(data.net_profit))}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px">
            <table>
                <thead><tr><th>Income</th><th class="text-right">Amount</th></tr></thead>
                <tbody>
                    <tr><td>Sales (${data.sales_count || 0} invoices)</td><td class="text-right">${formatCurrency(data.income.total_sales)}</td></tr>
                    ${data.income.total_other_income ? `<tr><td>Other Income</td><td class="text-right">${formatCurrency(data.income.total_other_income)}</td></tr>` : ''}
                    <tr style="font-weight:700"><td>Total Income</td><td class="text-right">${formatCurrency(data.income.total_income)}</td></tr>
                </tbody>
            </table>
            <table>
                <thead><tr><th>Expenses</th><th class="text-right">Amount</th></tr></thead>
                <tbody>
                    <tr><td>Milk Collection (${data.milk_collection_count || 0})</td><td class="text-right">${formatCurrency(exp.milk_collection.total)}</td></tr>
                    <tr><td>Purchases</td><td class="text-right">${formatCurrency(exp.purchases.total)}</td></tr>
                    <tr><td>Salary</td><td class="text-right">${formatCurrency(exp.salary.total)}</td></tr>
                    <tr><td>Other Expenses</td><td class="text-right">${formatCurrency(exp.other_expenses.total)}</td></tr>
                    <tr><td>Petty Cash</td><td class="text-right">${formatCurrency(exp.petty_cash.total)}</td></tr>
                    <tr><td>Vehicle Expenses</td><td class="text-right">${formatCurrency(exp.vehicle_expenses.total)}</td></tr>
                    <tr style="font-weight:700"><td>Total Expenses</td><td class="text-right">${formatCurrency(exp.total_expenses)}</td></tr>
                </tbody>
            </table>
        </div>
        <p style="margin-top:12px;font-size:11px;color:#666">Note: Cash collected in period ${formatCurrency(data.income.total_receipts)} — collections are against the same sales invoices, so they are not added to income (accrual basis).</p>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Profit & Loss — Month-by-Month Comparison
// ============================================================
async function loadProfitLossMonthly() {
    const section = document.getElementById('pl-monthly-section');
    if (!section) return;
    const saved = _finLastData.plMonthly;
    const preset = saved
        ? { from: saved.from_date, to: saved.to_date }
        : (() => {
            const t = getDatePreset('today');
            return { from: `${String(t.from).slice(0, 4)}-01-01`, to: t.to };
        })();
    const result = await window.api.getProfitLossByMonth({ from_date: preset.from, to_date: preset.to });
    if (!result.success) { showToast(result.error || 'Failed to load monthly comparison', 'error'); return; }
    renderProfitLossMonthly(result.data);
}

function renderProfitLossMonthly(data) {
    const section = document.getElementById('pl-monthly-section');
    if (!section) return;
    _finLastData.plMonthly = data;
    const fmt = formatCurrency;

    const headCells = ['BS Month', 'Sales', 'COGS', 'Gross Profit', 'Operating', 'Net Profit', 'Cash Collected']
        .map((h, i) => `<th${i > 0 ? ' class="text-right"' : ''}>${h}</th>`).join('');

    const rows = data.months.map(m => `
        <tr>
            <td><strong>${m.label}</strong><br><span style="font-size:11px;color:var(--text-light)">${m.sales_count} invoices</span></td>
            <td class="text-right">${fmt(m.sales)}</td>
            <td class="text-right">${fmt(m.cogs)}</td>
            <td class="text-right" style="color:${m.gross_profit >= 0 ? 'var(--accent)' : 'var(--danger)'};font-weight:600">${fmt(m.gross_profit)}</td>
            <td class="text-right">${fmt(m.operating_expenses)}</td>
            <td class="text-right" style="color:${m.net_profit >= 0 ? 'var(--accent)' : 'var(--danger)'};font-weight:700">${m.net_profit >= 0 ? '' : '-'}${fmt(Math.abs(m.net_profit))}${m.net_profit >= 0 ? '' : ' (loss)'}</td>
            <td class="text-right" style="color:var(--text-light)">${fmt(m.receipts)}</td>
        </tr>
    `).join('');

    const t = data.totals;
    const totalRow = `
        <tr style="background:var(--bg);font-weight:700">
            <td>TOTAL (${data.months.length} month${data.months.length === 1 ? '' : 's'})</td>
            <td class="text-right">${fmt(t.sales)}</td>
            <td class="text-right">${fmt(t.cogs)}</td>
            <td class="text-right" style="color:${t.gross_profit >= 0 ? 'var(--accent)' : 'var(--danger)'}">${fmt(t.gross_profit)}</td>
            <td class="text-right">${fmt(t.operating_expenses)}</td>
            <td class="text-right" style="color:${t.net_profit >= 0 ? 'var(--accent)' : 'var(--danger)'}">${t.net_profit >= 0 ? '' : '-'}${fmt(Math.abs(t.net_profit))}${t.net_profit >= 0 ? '' : ' (loss)'}</td>
            <td class="text-right">${fmt(t.receipts)}</td>
        </tr>
    `;

    const best = data.months.reduce((b, m) => (m.net_profit > (b ? b.net_profit : -Infinity) ? m : b), null);
    const worst = data.months.reduce((w, m) => (m.net_profit < (w ? w.net_profit : Infinity) ? m : w), null);

    section.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0">📅 Month-by-Month Comparison</h3>
            <button class="btn btn-info btn-sm" onclick="printProfitLossMonthly()">🖨 Print Comparison</button>
        </div>
        <div class="filter-bar" style="margin-bottom:10px">
            <div class="form-group"><label>From (BS)</label><input type="text" class="form-control" id="plmFrom" placeholder="2083-01-01" value="${data.from_date}" data-bs-date></div>
            <div class="form-group"><label>To (BS)</label><input type="text" class="form-control" id="plmTo" placeholder="2083-12-32" value="${data.to_date}" data-bs-date></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyProfitLossMonthly()">Show</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="setProfitLossMonthlyRange('this_year')">This BS Year</button>
                <button class="btn btn-secondary btn-sm" onclick="setProfitLossMonthlyRange('last_6')">Last 6 Months</button>
                <button class="btn btn-secondary btn-sm" onclick="setProfitLossMonthlyRange('all')">All Time</button>
            </div>
        </div>
        ${data.months.length === 0 ? `
            <div style="text-align:center;padding:24px;color:var(--text-light);background:var(--bg);border-radius:var(--radius-sm)">
                No transactions found between ${data.from_date} and ${data.to_date}.
            </div>
        ` : `
        <div class="card" style="overflow-x:auto">
            <table>
                <thead><tr>${headCells}</tr></thead>
                <tbody>${rows}${totalRow}</tbody>
            </table>
        </div>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--text-light);flex-wrap:wrap">
            ${best && best !== worst ? `<span>📈 Best month: <strong>${best.label}</strong> (net ${fmt(best.net_profit)})</span>
            <span>📉 Weakest month: <strong>${worst.label}</strong> (net ${fmt(worst.net_profit)})</span>` : ''}
            <span>ℹ️ Cash Collected is cash-flow reference only — collections are against the same sales, not extra income.</span>
        </div>
        `}
    `;
    enhanceProfitLossDateInputs(section);
}

function profitLossMonthlyPreset(kind) {
    const today = getDatePreset('today');
    if (kind === 'this_year') return { from: `${String(today.from).slice(0, 4)}-01-01`, to: today.to };
    if (kind === 'last_6') {
        // Go back 5 months from the current BS month, clamped to day 01
        const [y, m] = String(today.from).slice(0, 7).split('-').map(Number);
        let yy = y, mm = m - 5;
        while (mm < 1) { mm += 12; yy -= 1; }
        return { from: `${yy}-${String(mm).padStart(2, '0')}-01`, to: today.to };
    }
    return { from: '0001-01-01', to: '9999-12-32' };
}

function setProfitLossMonthlyRange(kind) {
    const p = profitLossMonthlyPreset(kind);
    const fromEl = document.getElementById('plmFrom');
    const toEl = document.getElementById('plmTo');
    // setBSDateValue keeps the picker dropdowns in sync with the new value
    if (fromEl) (typeof setBSDateValue === 'function') ? setBSDateValue(fromEl, p.from) : (fromEl.value = p.from);
    if (toEl) (typeof setBSDateValue === 'function') ? setBSDateValue(toEl, p.to) : (toEl.value = p.to);
    applyProfitLossMonthly();
}

async function applyProfitLossMonthly() {
    const from = (document.getElementById('plmFrom')?.value || '').trim();
    const to = (document.getElementById('plmTo')?.value || '').trim();
    const bsDateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!bsDateRe.test(from) || !bsDateRe.test(to)) { showToast('Enter both dates as BS dates (YYYY-MM-DD)', 'warning'); return; }
    if (from > to) { showToast('From date must be on or before To date', 'warning'); return; }
    const result = await window.api.getProfitLossByMonth({ from_date: from, to_date: to });
    if (result.success) renderProfitLossMonthly(result.data);
    else showToast(result.error || 'Failed to load', 'error');
}

async function printProfitLossMonthly() {
    const data = _finLastData.plMonthly;
    if (!data || !data.months.length) { showToast('Show the monthly comparison first', 'warning'); return; }
    const settings = await getSettingsCached();
    const fmt = formatCurrency;
    const head = ['BS Month', 'Sales', 'Other Income', 'COGS', 'Gross Profit', 'Operating', 'Net Profit', 'Cash Collected']
        .map((h, i) => `<th${i > 0 ? ' class="text-right"' : ''}>${h}</th>`).join('');
    const rowHtml = (cells, style = '') => `<tr style="${style}">` +
        cells.map((c, i) => (i === 0 ? `<td>${c}</td>` : `<td class="text-right">${c}</td>`)).join('') + '</tr>';
    const body = data.months.map(m => rowHtml([
        m.label, fmt(m.sales), fmt(m.other_income), fmt(m.cogs),
        fmt(m.gross_profit), fmt(m.operating_expenses),
        fmt(m.net_profit), fmt(m.receipts)
    ])).join('');
    const t = data.totals;
    const total = rowHtml([
        'TOTAL', fmt(t.sales), fmt(t.other_income), fmt(t.cogs),
        fmt(t.gross_profit), fmt(t.operating_expenses),
        fmt(t.net_profit), fmt(t.receipts)
    ], 'font-weight:700;background:#f5f5f5');
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Profit & Loss — Month-by-Month Comparison</h2><p>Period: ${data.from_date} to ${data.to_date} (Bikram Sambat)</p></div>
        <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${body}${total}</tbody>
        </table>
        <p style="margin-top:12px;font-size:11px;color:#666">Accrual basis: income = sales (+ other income); COGS = purchases + milk collections; operating = salary + other expenses + petty cash + vehicle. Cash Collected shown for cash-flow reference only.</p>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Receivable / Payable
// ============================================================
async function showReceivablePayable() {
    const container = document.getElementById('page-receivable-payable');
    document.getElementById('topActions').innerHTML = '';

    const [receivablesResult, payablesResult] = await Promise.all([
        window.api.getReceivables(),
        window.api.getPayables()
    ]);

    const receivables = receivablesResult.success ? receivablesResult.data : [];
    const payables = payablesResult.success ? payablesResult.data : [];
    const totalReceivable = receivables.reduce((s, r) => s + r.outstanding, 0);
    const totalPayable = payables.reduce((s, p) => s + p.outstanding, 0);
    const netPosition = totalReceivable - totalPayable;

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">💰 Receivables & Payables</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printReceivablePayable()">🖨 Print</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">💰 Total Receivables</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalReceivable)}</span>
                <span class="sub">From ${receivables.length} customers</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">⚠️ Total Payables</span>
                <span class="value" style="font-size:20px">${formatCurrency(totalPayable)}</span>
                <span class="sub">To ${payables.length} suppliers</span>
            </div>
            <div class="summary-card ${netPosition >= 0 ? 'card-primary' : 'card-warning'}" style="margin:0;padding:12px">
                <span class="label">📊 Net Position</span>
                <span class="value" style="font-size:20px">${formatCurrency(netPosition)}</span>
                <span class="sub">${netPosition >= 0 ? 'Net Receivable' : 'Net Payable'}</span>
            </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">💰 Receivables (Customers owe you)</h3>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Customer</th><th>Phone</th><th class="text-right">Outstanding</th></tr></thead>
                        <tbody>
                            ${receivables.map(r => `<tr>
                                <td><strong>${escapeHtml(r.name)}</strong></td>
                                <td>${escapeHtml(r.phone || '-')}</td>
                                <td class="text-right" style="color:var(--accent);font-weight:600">${formatCurrency(r.outstanding)}</td>
                            </tr>`).join('')}
                            ${receivables.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-light)">No outstanding receivables</td></tr>' : ''}
                        </tbody>
                        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(totalReceivable)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
            <div>
                <h3 style="font-size:14px;margin-bottom:8px">⚠️ Payables (You owe suppliers)</h3>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead><tr><th>Supplier</th><th>Phone</th><th class="text-right">Outstanding</th></tr></thead>
                        <tbody>
                            ${payables.map(p => `<tr>
                                <td><strong>${escapeHtml(p.name)}</strong></td>
                                <td>${escapeHtml(p.phone || '-')}</td>
                                <td class="text-right" style="color:var(--danger);font-weight:600">${formatCurrency(p.outstanding)}</td>
                            </tr>`).join('')}
                            ${payables.length === 0 ? '<tr><td colspan="3" style="text-align:center;padding:20px;color:var(--text-light)">No outstanding payables</td></tr>' : ''}
                        </tbody>
                        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(totalPayable)}</strong></td></tr></tfoot>
                    </table>
                </div>
            </div>
        </div>
    `;
    _finLastData.receivablePayable = { receivables, payables, totalReceivable, totalPayable, netPosition };
}

async function printReceivablePayable() {
    const d = _finLastData.receivablePayable;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Receivables & Payables</h2><p>As of: ${formatDate(today())}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Receivables</div><div class="value-number">${formatCurrency(d.totalReceivable)}</div></div>
            <div class="value-card" style="border-color:var(--danger)"><div class="value-label">Total Payables</div><div class="value-number">${formatCurrency(d.totalPayable)}</div></div>
            <div class="value-card"><div class="value-label">Net Position</div><div class="value-number">${formatCurrency(d.netPosition)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

// ============================================================
// Stock Statement
// ============================================================
// Period + views state. The period comes from the SHARED date layer
// (getDatePreset) — never hardcoded; 'custom' is the From/To pair.
let _ssState = { preset: 'today', from: '', to: '', view: 'movement', category: '', search: '', product_id: '' };

/** Local 2-dp rounding for summary figures (currency precision). */
function round2ui(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Every period the spec asks for (req 15) — the shared date layer owns the maths.
const SS_PRESETS = ['today', 'yesterday', 'last_7', 'last_30', 'last_90', 'this_month', 'last_month', 'this_year', 'all'];

function _ssPresetBtns() {
    return SS_PRESETS
        .map(p => `<button type="button" class="btn btn-sm ${_ssState.preset === p ? 'btn-primary' : 'btn-secondary'}" onclick="ssApplyPreset('${p}')">${DATE_PRESET_LABELS[p] || p}</button>`)
        .join('');
}

function ssApplyPreset(p) {
    const r = getDatePreset(p);
    _ssState.preset = p;
    _ssState.from = r.from;
    _ssState.to = r.to;
    showStockStatement();
}

function ssApplyCustom() {
    _ssState.preset = 'custom';
    _ssState.from = document.getElementById('ssFrom')?.value || '';
    _ssState.to = document.getElementById('ssTo')?.value || '';
    showStockStatement();
}

function ssSetView(v) { _ssState.view = v; showStockStatement(); }

function _ssFilterBar(data) {
    return `
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
            <span style="font-size:12px;color:var(--text-light);font-weight:600">Period:</span>
            ${_ssPresetBtns()}
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="ssFrom" value="${_ssState.from || ''}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="ssTo" value="${_ssState.to || ''}">
            </div>
            <div class="form-group">
                <label>Category</label>
                <select class="form-control" id="ssCategory" onchange="applyStockStatement()">
                    <option value="">All Categories</option>
                    ${(data.categories || []).map(c => `<option value="${escapeHtml(c)}" ${_ssState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>Search</label>
                <input type="text" class="form-control" id="ssSearch" value="${escapeHtml(_ssState.search)}" placeholder="Search product..." onkeyup="if(event.key==='Enter')applyStockStatement()">
            </div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="ssApplyCustom()">Apply Range</button></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
            <span style="font-size:12px;color:var(--text-light);font-weight:600">View:</span>
            <button type="button" class="btn btn-sm ${_ssState.view === 'movement' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('movement')">📈 Stock Movement</button>
            <button type="button" class="btn btn-sm ${_ssState.view === 'daily' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('daily')">📅 Day by Day</button>
            <button type="button" class="btn btn-sm ${_ssState.view === 'flow' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('flow')">📋 Period Flow</button>
            <button type="button" class="btn btn-sm ${_ssState.view === 'summary' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('summary')">📊 Stock Summary</button>
            <button type="button" class="btn btn-sm ${_ssState.view === 'detail' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('detail')">🧾 Detailed Ledger</button>
            <button type="button" class="btn btn-sm ${_ssState.view === 'valuation' ? 'btn-primary' : 'btn-secondary'}" onclick="ssSetView('valuation')">💰 Current Valuation</button>
        </div>`;
}

// ── Daily Stock Statement (Excel-style, reqs 2–12) ──
// Labels follow the operator's language: yesterday's closing, today's sales,
// what remained, what came in, what was consumed, today's closing.  For a
// multi-day period the same columns read as period movements with the period's
// own opening/closing (req 15).
function ssFlowLabels(singleDay) {
    return singleDay ? {
        opening: 'Yesterday Closing', sales: "Today's Sales/Issues",
        remaining: "Remaining After Today's Sales", collection: "Today's Collection/Purchase",
        production: "Today's Production", closing: "Today's Closing"
    } : {
        opening: 'Opening (before period)', sales: 'Sales / Issues',
        remaining: 'Remaining', collection: 'Collection / Purchase',
        production: 'Production', closing: 'Closing'
    };
}

/** Quantity cell: OUT red, IN green, plain for balances; zero as an em dash. */
function ssQtyCell(v, dir) {
    const n = round2ui(v || 0);
    if (n === 0) return `<td class="text-right" style="color:var(--text-light)">—</td>`;
    const color = dir === 'out' ? 'var(--danger)' : dir === 'in' ? 'var(--success)' : 'inherit';
    const sign = dir === 'out' ? '- ' : dir === 'in' ? '+ ' : (n > 0 ? '' : '');
    return `<td class="text-right" style="color:${color}">${sign}${formatNumber(Math.abs(n))}</td>`;
}

/** Click a product in the daily statement → its movement ledger. */
function ssDrillProduct(productId) {
    _ssState.product_id = String(productId);
    _ssState.view = 'detail';
    showStockStatement();
}

/**
 * Open the document a stock movement came from (req 1: clicking the reference
 * opens the original transaction).  Internal movements have no document.
 */
function ssOpenSource(referenceType, referenceId) {
    if (referenceId == null) return;
    if (referenceType === 'sale' && typeof viewSaleDetail === 'function') return viewSaleDetail(referenceId);
    if (referenceType === 'purchase' && typeof viewPurchaseDetail === 'function') return viewPurchaseDetail(referenceId);
    if (referenceType === 'milk_collection' && typeof viewMilkCollection === 'function') return viewMilkCollection(referenceId);
    if (referenceType === 'production' && typeof viewProductionBatch === 'function') return viewProductionBatch(referenceId);
    if (typeof showToast === 'function') showToast('No linked document for this movement', 'info');
}

/**
 * Collapse the chained daily statement into the Excel-style period flow row —
 * the SAME engine, never a second calculation. `Remaining` is floored at zero:
 * sales deduct from yesterday's closing first, and anything beyond that comes
 * out of the period's in-flows — whatever neither covers is the row's
 * `shortfall`. The row then satisfies, exactly:
 *
 *   Opening − Sales + In − Out + Shortfall = Closing
 */
function _ssFlowRow(p) {
    const rs = p.rows || [];
    const sum = k => round2ui(rs.reduce((s, r) => s + (Number(r[k]) || 0), 0));
    const opening = rs.length ? round2ui(rs[0].opening) : 0;
    const sales = sum('sales');
    const f = {
        opening,
        sales_issues: sales,
        remaining: Math.max(0, round2ui(opening - sales)),
        collection_purchase: round2ui(sum('collection') + sum('purchase')),
        production: sum('production'),
        production_consumption: sum('production_consumption'),
        wastage: sum('wastage'),
        other_in: sum('other_in'),
        other_out: sum('other_out'),
        shortfall: sum('shortfall'),
        closing: rs.length ? round2ui(rs[rs.length - 1].closing) : 0
    };
    f.identity_ok = Math.abs(round2ui(
        f.opening - f.sales_issues + f.collection_purchase + f.production
        - f.production_consumption - f.wastage + f.other_in - f.other_out + f.shortfall
    ) - f.closing) < 0.02;
    return f;
}

function _ssFlowView(products, periodLabel, singleDay) {
    const L = ssFlowLabels(singleDay);
    const shown = products.filter(p => {
        if ((p.rows || []).length) return true;
        const f = _ssFlowRow(p);
        return round2ui(f.opening) !== 0 || round2ui(f.closing) !== 0;
    });
    const rowsData = shown.map(p => ({ p, f: _ssFlowRow(p) }));
    const showShortfall = rowsData.some(({ f }) => Math.abs(f.shortfall || 0) >= 0.005);
    const allOk = rowsData.every(({ f }) => f.identity_ok !== false);
    const colCount = (showShortfall ? 12 : 11);

    // Unit subtotals — never mix litres with kilograms in one figure.
    const byUnit = new Map();
    for (const { p, f } of rowsData) {
        const u = p.unit || '—';
        if (!byUnit.has(u)) byUnit.set(u, { opening: 0, sales: 0, remaining: 0, collection: 0, production: 0, consumption: 0, wastage: 0, otherIn: 0, otherOut: 0, shortfall: 0, closing: 0 });
        const t = byUnit.get(u);
        t.opening += f.opening || 0; t.sales += f.sales_issues || 0; t.remaining += f.remaining || 0;
        t.collection += f.collection_purchase || 0; t.production += f.production || 0;
        t.consumption += f.production_consumption || 0; t.wastage += f.wastage || 0;
        t.otherIn += f.other_in || 0; t.otherOut += f.other_out || 0; t.shortfall += f.shortfall || 0; t.closing += f.closing || 0;
    }

    const rowsHtml = rowsData.map(({ p, f }) => {
        return `<tr>
            <td><a href="#" onclick="event.preventDefault();ssDrillProduct(${p.product_id})" title="Show this product's movement ledger"><strong>${escapeHtml(p.product_name)}</strong></a>
                <div style="font-size:11px;color:var(--text-light)">${escapeHtml(p.category || p.inventory_category || '')} · ${escapeHtml(p.unit || '')}</div></td>
            <td class="text-right">${formatNumber(round2ui(f.opening || 0))}</td>
            ${ssQtyCell(f.sales_issues, 'out')}
            <td class="text-right" style="font-weight:600">${formatNumber(round2ui(f.remaining || 0))}</td>
            ${ssQtyCell(f.collection_purchase, 'in')}
            ${ssQtyCell(f.production, 'in')}
            ${ssQtyCell(f.production_consumption, 'out')}
            ${ssQtyCell(f.wastage, 'out')}
            ${ssQtyCell(f.other_in, 'in')}
            ${ssQtyCell(f.other_out, 'out')}
            ${showShortfall ? ssQtyCell(-(f.shortfall || 0), 'out') : ''}
            <td class="text-right" style="font-weight:700">${formatNumber(round2ui(f.closing || 0))}</td>
        </tr>`;
    }).join('') || `<tr><td colspan="${colCount}" style="text-align:center;padding:30px;color:var(--text-light)">No stock movement in this period</td></tr>`;

    const unitFoot = [...byUnit.entries()].map(([u, t]) => `<tr style="background:var(--bg-light,#f7f7f7);font-weight:600">
        <td>Subtotal · ${escapeHtml(u)}</td>
        <td class="text-right">${formatNumber(round2ui(t.opening))}</td>
        <td class="text-right" style="color:var(--danger)">${t.sales ? '- ' + formatNumber(round2ui(t.sales)) : '—'}</td>
        <td class="text-right">${formatNumber(round2ui(t.remaining))}</td>
        <td class="text-right" style="color:var(--success)">${t.collection ? '+ ' + formatNumber(round2ui(t.collection)) : '—'}</td>
        <td class="text-right" style="color:var(--success)">${t.production ? '+ ' + formatNumber(round2ui(t.production)) : '—'}</td>
        <td class="text-right" style="color:var(--danger)">${t.consumption ? '- ' + formatNumber(round2ui(t.consumption)) : '—'}</td>
        <td class="text-right" style="color:var(--danger)">${t.wastage ? '- ' + formatNumber(round2ui(t.wastage)) : '—'}</td>
        <td class="text-right" style="color:var(--success)">${t.otherIn ? '+ ' + formatNumber(round2ui(t.otherIn)) : '—'}</td>
        <td class="text-right" style="color:var(--danger)">${t.otherOut ? '- ' + formatNumber(round2ui(t.otherOut)) : '—'}</td>
        ${showShortfall ? `<td class="text-right" style="color:var(--danger)">${t.shortfall ? '- ' + formatNumber(round2ui(t.shortfall)) : '—'}</td>` : ''}
        <td class="text-right">${formatNumber(round2ui(t.closing))}</td>
    </tr>`).join('');

    return `
    <div style="font-size:13px;color:var(--text-light);margin-bottom:8px">
        ${escapeHtml(periodLabel)} — read down each row: <strong>${escapeHtml(L.opening)}</strong> → <strong>${escapeHtml(L.sales)}</strong> → <strong>${escapeHtml(L.remaining)}</strong> → <strong>${escapeHtml(L.collection)}</strong> → <strong>${escapeHtml(L.production)}</strong> → <strong>Production Consumption</strong> → <strong>Wastage</strong> → <strong>Other IN</strong> → <strong>Other OUT</strong>${showShortfall ? ' → <strong>Shortfall</strong>' : ''} → <strong>${escapeHtml(L.closing)}</strong>. Each closing carries into the next day automatically. Sales beyond yesterday's closing come out of today's in-flows; anything stock cannot cover shows in red as <strong>Shortfall</strong> and the closing never goes below zero. <em>Remaining</em> is what is physically on hand after yesterday's closing absorbs today's sales (it never shows a negative).
    </div>
    <div class="table-container">
        <table>
            <thead><tr>
                <th>Product</th>
                <th class="text-right">${escapeHtml(L.opening)}</th>
                <th class="text-right">${escapeHtml(L.sales)}</th>
                <th class="text-right">${escapeHtml(L.remaining)}</th>
                <th class="text-right">${escapeHtml(L.collection)}</th>
                <th class="text-right">${escapeHtml(L.production)}</th>
                <th class="text-right">Production Consumption</th>
                <th class="text-right">Wastage</th>
                <th class="text-right">Other IN</th>
                <th class="text-right">Other OUT</th>
                ${showShortfall ? '<th class="text-right" style="color:var(--danger)">Shortfall</th>' : ''}
                <th class="text-right">${escapeHtml(L.closing)}</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
            ${unitFoot ? `<tfoot>${unitFoot}</tfoot>` : ''}
        </table>
    </div>
    <div style="margin-top:10px;font-size:13px;padding:8px 12px;border-radius:6px;background:${allOk ? 'var(--success-light,#e8f6ee)' : 'var(--warning-light,#fff6e5)'};color:${allOk ? 'var(--success)' : 'var(--warning)'}">
        ${allOk ? `✓ Every product reconciles: Opening − Sales + Collection/Purchase + Production − Production Consumption − Wastage + Other IN − Other OUT${showShortfall ? ' + Shortfall' : ''} = Closing.` : '⚠ At least one product does not reconcile — check the Detailed Ledger for that product.'}
    </div>`;
}

function _ssMatches(p) {
    if (_ssState.category && p.category !== _ssState.category) return false;
    if (_ssState.search) {
        const q = _ssState.search.toLowerCase();
        if (!String(p.product_name || '').toLowerCase().includes(q) && !String(p.category || '').toLowerCase().includes(q)) return false;
    }
    return true;
}

// ──────────────────────────────────────────────────────────────
// Stock Movement & Valuation view — the printed report layout
// ──────────────────────────────────────────────────────────────

/**
 * Collapse the chained daily statement into one row per product, in the
 * printed report's layout: Opening | Purchases In | … | Sales Out | Closing |
 * Rate | Closing Value. Opening is the first day's carried-forward opening and
 * Closing the last day's chained closing, so each row satisfies the movement
 * identity by construction — the per-day chain (and backdated recompute) is
 * done by getDailyStockStatement, never re-derived here.
 */
function _ssMovementTableModel(daily, valuation) {
    const meta = {};
    for (const i of ((valuation && valuation.items) || [])) meta[String(i.id)] = i;
    const nz = v => Math.abs(v || 0) >= 0.005;

    const rows = ((daily && daily.products) || []).map(p => {
        const rs = p.rows || [];
        const sum = k => rs.reduce((s, r) => s + (Number(r[k]) || 0), 0);
        const m = meta[String(p.product_id)] || {};
        return {
            product_id: p.product_id,
            name: p.product_name,
            unit: p.unit || '',
            opening: rs.length ? rs[0].opening : 0,
            purchase: round2ui(sum('collection') + sum('purchase')),
            production: round2ui(sum('production')),
            used: round2ui(sum('production_consumption')),
            sales: round2ui(sum('sales')),
            otherOut: round2ui(sum('wastage') + sum('other_out')),
            otherIn: round2ui(sum('other_in')),
            closing: rs.length ? rs[rs.length - 1].closing : 0,
            rate: Number(m.rate) || 0,
            reorder: Number(m.reorder_level) || 0,
            shortfall: round2ui(sum('shortfall')),
            shortfallDays: p.shortfall_days || 0
        };
    });

    const tot = rows.reduce((s, r) => {
        for (const k of ['opening', 'purchase', 'production', 'used', 'sales', 'otherOut', 'otherIn', 'shortfall', 'closing']) s[k] += r[k];
        s.value += r.closing * r.rate;
        return s;
    }, { opening: 0, purchase: 0, production: 0, used: 0, sales: 0, otherOut: 0, otherIn: 0, shortfall: 0, closing: 0, value: 0 });

    return {
        rows, tot,
        showProduction: rows.some(r => nz(r.production) || nz(r.used)),
        showOther: rows.some(r => nz(r.otherOut) || nz(r.otherIn)),
        showShortfall: rows.some(r => nz(r.shortfall)),
        lowCount: rows.filter(r => r.closing <= r.reorder).length,
        shortfallDays: (daily && daily.shortfall_days) || 0
    };
}

function _ssMovementView(daily, valuation, periodLabel) {
    const m = _ssMovementTableModel(daily, valuation);
    if (!m.rows.length) {
        return '<div style="text-align:center;padding:40px;color:var(--text-light)">No stock products in this period.</div>';
    }
    const nz = v => Math.abs(v || 0) >= 0.005;
    const q = v => nz(v) ? formatNumber(round2ui(v)) : '0';
    const cell = v => `<td class="text-right">${q(v)}</td>`;

    return `
    <div class="summary-cards" style="grid-template-columns:repeat(2,minmax(0,260px));margin-bottom:14px">
        <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">💰 Total Closing Value</span><span class="value" style="font-size:22px">${formatCurrency(round2ui(m.tot.value))}</span></div>
        <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">⚠️ Low Stock Items</span><span class="value" style="font-size:22px">${m.lowCount}</span></div>
    </div>
    ${m.shortfallDays > 0 ? `<div style="background:#fdecea;border-left:4px solid #c0392b;padding:10px 14px;border-radius:6px;font-size:12px;margin-bottom:10px;color:#c0392b">
        ⚠ <strong>${m.shortfallDays}</strong> product-day(s) closed short in this period — stock was sold beyond what the books recorded as received. Sales are never blocked: the closing stays at zero and the uncovered amount shows in red as <em>Shortfall</em>. Open <em>Day by Day</em> to see which days, then add the missing purchase/collection or opening balance.
    </div>` : ''}
    <div class="table-container">
        <table>
            <thead><tr>
                <th>Product</th>
                <th>Unit</th>
                <th class="text-right">Opening Stock</th>
                <th class="text-right">Purchases In</th>
                ${m.showProduction ? '<th class="text-right">Production In</th><th class="text-right">Used in Mixing</th>' : ''}
                <th class="text-right">Sales Out</th>
                ${m.showOther ? '<th class="text-right">Other IN</th><th class="text-right">Other OUT</th>' : ''}
                ${m.showShortfall ? '<th class="text-right" style="color:var(--danger)">Shortfall</th>' : ''}
                <th class="text-right">Closing Stock</th>
                <th class="text-right">Rate (Rs)</th>
                <th class="text-right">Closing Value</th>
            </tr></thead>
            <tbody>
            ${m.rows.map(r => `
                <tr>
                    <td><a href="#" onclick="event.preventDefault();ssDrillProduct(${r.product_id})" title="Open this product's movement ledger">${escapeHtml(r.name)}</a>${r.shortfallDays ? ` <span class="badge badge-danger" title="${r.shortfallDays} day(s) closed short — see the Shortfall column">${r.shortfallDays}⚠</span>` : ''}</td>
                    <td>${escapeHtml(r.unit)}</td>
                    ${cell(r.opening)}
                    ${cell(r.purchase)}
                    ${m.showProduction ? cell(r.production) + cell(r.used) : ''}
                    ${cell(r.sales)}
                    ${m.showOther ? cell(r.otherIn) + cell(r.otherOut) : ''}
                    ${m.showShortfall ? `<td class="text-right" style="${nz(r.shortfall) ? 'color:var(--danger);font-weight:600' : 'color:var(--text-light)'}">${nz(r.shortfall) ? '- ' + q(r.shortfall) : '—'}</td>` : ''}
                    <td class="text-right" style="font-weight:700">${q(r.closing)}</td>
                    <td class="text-right">${formatCurrency(r.rate)}</td>
                    <td class="text-right" style="font-weight:600">${formatCurrency(round2ui(r.closing * r.rate))}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr style="font-weight:700">
                <td colspan="2">TOTALS</td>
                <td class="text-right">${q(m.tot.opening)}</td>
                <td class="text-right">${q(m.tot.purchase)}</td>
                ${m.showProduction ? `<td class="text-right">${q(m.tot.production)}</td><td class="text-right">${q(m.tot.used)}</td>` : ''}
                <td class="text-right">${q(m.tot.sales)}</td>
                ${m.showOther ? `<td class="text-right">${q(m.tot.otherIn)}</td><td class="text-right">${q(m.tot.otherOut)}</td>` : ''}
                ${m.showShortfall ? `<td class="text-right" style="${nz(m.tot.shortfall) ? 'color:var(--danger)' : ''}">${nz(m.tot.shortfall) ? '- ' + q(m.tot.shortfall) : '—'}</td>` : ''}
                <td class="text-right">${q(m.tot.closing)}</td>
                <td></td>
                <td class="text-right">${formatCurrency(round2ui(m.tot.value))}</td>
            </tr></tfoot>
        </table>
    </div>
    <div style="margin-top:10px;font-size:12px;color:var(--text-light);line-height:1.6">
        📅 Period: <strong>${escapeHtml(periodLabel)}</strong> — change the From/To dates above; the opening carries forward automatically.<br>
        Opening Stock = the balance carried in from before the From Date (never below zero). Closing = Opening + Purchases In [+ Production In − Used in Mixing] − Sales Out [+ Other IN − Other OUT] + Shortfall, chained day by day — a day deducts only what the stock actually has (sales take yesterday's closing first, the excess takes today's purchase) and whatever neither covers is the red Shortfall. Open <em>Day by Day</em> for the per-date table.
    </div>`;
}

// ──────────────────────────────────────────────────────────────
// Day-by-day chained view — one row per date, exact spec layout
// ──────────────────────────────────────────────────────────────

function _ssDailyView(daily, periodLabel) {
    const products = (daily && daily.products) || [];
    if (!products.length) {
        return '<div style="text-align:center;padding:40px;color:var(--text-light)">No stock products in this period.</div>';
    }
    const sel = _ssState.product_id ? String(_ssState.product_id) : '';
    const shown = sel ? products.filter(p => String(p.product_id) === sel) : products;
    const nz = v => Math.abs(v || 0) >= 0.005;
    const q = v => nz(v) ? formatNumber(round2ui(v)) : '0';
    const MAX_ROWS = 400;

    const sections = shown.map(p => {
        const rs = p.rows || [];
        const anyCol = rs.some(r => nz(r.collection));
        const anyPur = rs.some(r => nz(r.purchase));
        const anyProd = rs.some(r => nz(r.production) || nz(r.production_consumption));
        const anyOther = rs.some(r => nz(r.wastage) || nz(r.other_in) || nz(r.other_out));
        const anyShort = rs.some(r => nz(r.shortfall));
        const capped = rs.slice(0, MAX_ROWS);
        return `
        <h3 style="margin:18px 0 8px;font-size:15px">${escapeHtml(p.product_name)}
            <span style="color:var(--text-light);font-weight:400;font-size:12px">
                (${escapeHtml(p.unit || '')}) — ${rs.length} day(s), opening ${q(rs.length ? rs[0].opening : 0)} → closing ${q(p.last_closing)}${p.shortfall_days ? ` · <span style="color:var(--danger)">${p.shortfall_days} shortfall day(s)</span>` : ''}
            </span>
        </h3>
        <div class="table-container">
            <table>
                <thead><tr>
                    <th>Date</th>
                    <th class="text-right">Opening</th>
                    ${anyCol ? '<th class="text-right">Collection</th>' : ''}
                    ${anyPur ? '<th class="text-right">Purchase</th>' : ''}
                    ${anyProd ? '<th class="text-right">Production</th><th class="text-right">Used in Mixing</th>' : ''}
                    <th class="text-right">Sales</th>
                    ${anyOther ? '<th class="text-right">Wastage</th><th class="text-right">Other IN</th><th class="text-right">Other OUT</th>' : ''}
                    ${anyShort ? '<th class="text-right" style="color:var(--danger)">Shortfall</th>' : ''}
                    <th class="text-right">Closing</th>
                </tr></thead>
                <tbody>
                ${capped.map(r => {
                    const dash = '<span style="color:var(--text-light)">—</span>';
                    const cell = v => `<td class="text-right">${r.has_data ? q(v) : dash}</td>`;
                    const shortCell = `<td class="text-right" style="${nz(r.shortfall) ? 'color:var(--danger);font-weight:600' : 'color:var(--text-light)'}">${r.has_data ? (nz(r.shortfall) ? '- ' + q(r.shortfall) : '—') : dash}</td>`;
                    return `<tr${r.has_data ? '' : ' style="opacity:.55;font-style:italic"'}>
                        <td>${formatDate(r.date)}</td>
                        <td class="text-right">${q(r.opening)}</td>
                        ${anyCol ? cell(r.collection) : ''}
                        ${anyPur ? cell(r.purchase) : ''}
                        ${anyProd ? cell(r.production) + cell(r.production_consumption) : ''}
                        ${cell(r.sales)}
                        ${anyOther ? cell(r.wastage) + cell(r.other_in) + cell(r.other_out) : ''}
                        ${anyShort ? shortCell : ''}
                        <td class="text-right" style="font-weight:700">${q(r.closing)}</td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
        ${rs.length > capped.length ? `<div style="font-size:12px;color:var(--text-light);margin:6px 0 0">Showing first ${capped.length} of ${rs.length} days — narrow the period.</div>` : ''}`;
    }).join('');

    return `
    <div class="filter-bar">
        <div class="form-group">
            <label>Product</label>
            <select class="form-control" id="ssDailyProduct" onchange="_ssState.product_id=this.value;showStockStatement()">
                <option value="">All products</option>
                ${products.map(p => `<option value="${p.product_id}" ${sel === String(p.product_id) ? 'selected' : ''}>${escapeHtml(p.product_name)}</option>`).join('')}
            </select>
        </div>
        <div class="form-group" style="flex:1"><label>&nbsp;</label>
            <div style="font-size:12px;color:var(--text-light);padding-top:6px">
                ${escapeHtml(periodLabel)} — every day in the range gets a row. Closing(N) = Opening(N) + Collection + Purchase − Sales (+ Production − Used in Mixing ± other flows), never below zero: sales deduct from yesterday's closing first and the excess from today's purchase, so whatever neither covers shows in red as <strong>Shortfall</strong>. Opening(N+1) = Closing(N). Faded rows are days with no records: the closing simply carries forward.
            </div>
        </div>
    </div>
    ${sections}`;
}

async function showStockStatement() {
    const container = document.getElementById('page-stock-statement');
    document.getElementById('topActions').innerHTML = '';

    // 'all' legitimately has blank bounds (no restriction); every other preset
    // resolves through the shared date layer on first render.
    if (_ssState.preset !== 'all' && !_ssState.from && !_ssState.to) {
        const r = getDatePreset(_ssState.preset || 'today');
        _ssState.from = r.from;
        _ssState.to = r.to;
    }

    const [ledgerRes, valRes, dailyRes] = await Promise.all([
        window.api.getStockLedger({ from_date: _ssState.from, to_date: _ssState.to }),
        window.api.getStockStatement({ category: _ssState.category || undefined, search: _ssState.search || undefined }),
        window.api.getDailyStockStatement({
            from_date: _ssState.from, to_date: _ssState.to,
            category: _ssState.category || undefined, search: _ssState.search || undefined,
            product_id: _ssState.view === 'daily' && _ssState.product_id ? _ssState.product_id : undefined
        })
    ]);
    const data = valRes.success ? valRes.data : { items: [], total_value: 0, total_products: 0, total_quantity: 0, categories: [] };
    const ledger = (ledgerRes.success && ledgerRes.data) ? ledgerRes.data : { products: [] };
    const daily = (dailyRes && dailyRes.success && dailyRes.data) ? dailyRes.data : { products: [], shortfall_days: 0, shortfall_total: 0 };
    _finLastData.stockStatement = data;
    _finLastData.stockLedger = ledger;
    _finLastData.stockDaily = daily;

    const products = (ledger.products || []).filter(_ssMatches);
    const periodLabel = `${_ssState.from ? formatDate(_ssState.from) : 'Start'} → ${_ssState.to ? formatDate(_ssState.to) : 'Today'}`;

    // Period totals (mixed units — informational, same basis as the old total).
    // The daily chain is the authority for Opening/Closing/Shortfall (it never
    // presents a negative); the raw ledger supplies the movement buckets. A
    // product the daily statement skips (idle — nothing to say) falls back to a
    // floored raw figure, so no view can present a negative closing.
    const dailyByPid = new Map(((daily && daily.products) || []).map(d => [String(d.product_id), d]));
    const summaryFigures = (p, b) => {
        const d = dailyByPid.get(String(p.product_id));
        return {
            opening: d ? d.first_opening : Math.max(0, round2ui(b.opening || 0)),
            closing: d ? d.last_closing : Math.max(0, round2ui(p.closing_qty || 0)),
            shortfall: d ? (d.shortfall || 0) : 0
        };
    };
    const tot = products.reduce((s, p) => {
        const b = p.summary || {};
        const f = summaryFigures(p, b);
        s.opening += f.opening; s.in += b.total_in || 0; s.out += b.total_out || 0; s.closing += f.closing;
        return s;
    }, { opening: 0, in: 0, out: 0, closing: 0 });

    const singleDay = !!(_ssState.from && _ssState.to && String(_ssState.from) === String(_ssState.to));

    let viewHtml = '';
    if (_ssState.view === 'movement') {
        viewHtml = _ssMovementView(daily, data, periodLabel);
    } else if (_ssState.view === 'daily') {
        viewHtml = _ssDailyView(daily, periodLabel);
    } else if (_ssState.view === 'flow') {
        viewHtml = _ssFlowView((daily.products || []).filter(_ssMatches), periodLabel, singleDay);
    } else if (_ssState.view === 'summary') {
        viewHtml = `
        <div class="summary-cards" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">🌤 Opening (${escapeHtml(periodLabel)})</span><span class="value" style="font-size:20px">${formatNumber(round2ui(tot.opening))}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">⬇ Total IN</span><span class="value" style="font-size:20px">${formatNumber(round2ui(tot.in))}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">⬆ Total OUT</span><span class="value" style="font-size:20px">${formatNumber(round2ui(tot.out))}</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">📦 Closing</span><span class="value" style="font-size:20px">${formatNumber(round2ui(tot.closing))}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">💰 Stock Value (lot FIFO)</span><span class="value" style="font-size:20px">${data.lot_valuation_available ? formatCurrency(data.total_lot_value) : '—'}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr>
                    <th>Product</th><th>Unit</th>
                    <th class="text-right">Opening</th>
                    <th class="text-right">Collection/Purchase</th>
                    <th class="text-right">Production IN</th>
                    <th class="text-right">Production Consumption</th>
                    <th class="text-right">Sales/Issues</th>
                    <th class="text-right">Returns</th>
                    <th class="text-right">Wastage</th>
                    <th class="text-right">Adjustment/Other</th>
                    <th class="text-right" style="color:var(--danger)">Shortfall</th>
                    <th class="text-right">Closing</th>
                </tr></thead>
                <tbody>
                ${products.map(p => {
                    const b = p.summary || {};
                    const f = summaryFigures(p, b);
                    const cell = (v) => `<td class="text-right">${v ? formatNumber(v) : '0'}</td>`;
                    return `<tr>
                        <td><strong>${escapeHtml(p.product_name)}</strong> <span style="color:var(--text-light);font-size:11px">${escapeHtml(p.category || '')}</span></td>
                        <td>${escapeHtml(p.unit || '')}</td>
                        ${cell(f.opening)}
                        ${cell(round2ui((b.collection_in || 0) + (b.purchase_in || 0)))}
                        ${cell(b.production_in)}
                        ${cell(b.production_out)}
                        ${cell(b.sales_out)}
                        ${cell(round2ui((b.returns_in || 0) + (b.returns_out || 0)))}
                        ${cell(b.wastage_out)}
                        ${cell(round2ui((b.adjustment_in || 0) + (b.adjustment_out || 0) + (b.other_in || 0) + (b.other_out || 0)))}
                        <td class="text-right" style="${f.shortfall ? 'color:var(--danger);font-weight:600' : 'color:var(--text-light)'}">${f.shortfall ? '- ' + formatNumber(round2ui(f.shortfall)) : '—'}</td>
                        <td class="text-right" style="font-weight:700">${formatNumber(round2ui(f.closing))}</td>
                    </tr>`;
                }).join('') || '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-light)">No products</td></tr>'}
                </tbody>
            </table>
        </div>`;
    } else if (_ssState.view === 'detail') {
        const allRows = [];
        for (const p of products) {
            if (_ssState.product_id && Number(_ssState.product_id) !== p.product_id) continue;
            for (const r of (p.rows || [])) allRows.push({ p, r });
        }
        allRows.sort((a, b) => String(`${a.r.date} ${a.r.time || ''}`).localeCompare(`${b.r.date} ${b.r.time || ''}`));
        const capped = allRows.slice(0, 1500);
        viewHtml = `
        <div class="filter-bar">
            <div class="form-group">
                <label>Product</label>
                <select class="form-control" id="ssProduct" onchange="_ssState.product_id=this.value;showStockStatement()">
                    <option value="">All products</option>
                    ${products.map(p => `<option value="${p.product_id}" ${String(_ssState.product_id) === String(p.product_id) ? 'selected' : ''}>${escapeHtml(p.product_name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" style="flex:1"><label>&nbsp;</label><div style="font-size:12px;color:var(--text-light);padding-top:6px">Ordered by Date + Time + entry sequence. ${allRows.length > capped.length ? `Showing first ${capped.length} of ${allRows.length} rows — narrow the product or period.` : `${allRows.length} row(s).`}</div></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr>
                    <th>Date</th><th>Time</th><th>Reference No.</th><th>Party</th><th>Product</th><th>Transaction Type</th>
                    <th class="text-right">Opening</th><th class="text-right">IN</th><th class="text-right">OUT</th><th class="text-right">Closing</th>
                    <th class="text-right">Unit Cost</th><th class="text-right">Value</th>
                </tr></thead>
                <tbody>
                ${capped.map(({ p, r }) => {
                    const openQty = round2ui((r.balance || 0) - (r.inward_qty || 0) + (r.outward_qty || 0));
                    const refText = String(r.reference_no || r.reference || '').trim();
                    const linked = r.reference_id != null && ['sale', 'purchase', 'milk_collection', 'production'].includes(r.reference_type);
                    const refCell = refText
                        ? (linked
                            ? `<a href="#" onclick="event.preventDefault();ssOpenSource('${escapeHtml(r.reference_type)}',${r.reference_id})" title="Open the original transaction">${escapeHtml(refText)} 🔗</a>`
                            : escapeHtml(refText))
                        : '—';
                    return `<tr>
                    <td>${formatDate(r.date)}</td>
                    <td style="font-size:11px;color:var(--text-light)">${escapeHtml(r.time || '—')}</td>
                    <td style="font-size:11px" title="${escapeHtml(r.notes || '')}">${refCell}</td>
                    <td style="font-size:12px">${escapeHtml(r.party || '—')}</td>
                    <td>${escapeHtml(p.product_name)}</td>
                    <td><span class="badge ${r.inward_qty > 0 ? 'badge-success' : r.outward_qty > 0 ? 'badge-danger' : 'badge-secondary'}">${escapeHtml(r.label || r.type)}</span></td>
                    <td class="text-right">${formatNumber(openQty)}</td>
                    <td class="text-right">${r.inward_qty ? formatNumber(r.inward_qty) : '—'}</td>
                    <td class="text-right">${r.outward_qty ? formatNumber(r.outward_qty) : '—'}</td>
                    <td class="text-right" style="font-weight:600">${formatNumber(r.balance)}</td>
                    <td class="text-right">${formatCurrency(r.unit_cost || 0)}</td>
                    <td class="text-right">${r.value ? formatCurrency(r.value) : '—'}</td>
                </tr>`; }).join('') || '<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--text-light)">No movements in this period</td></tr>'}
                </tbody>
            </table>
        </div>`;
    } else {
        // Valuation view — the original current-stock table (unchanged engine).
        viewHtml = `
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">📦 Products</span><span class="value" style="font-size:20px">${data.total_products}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">📏 Total Quantity</span><span class="value" style="font-size:20px">${formatNumber(data.total_quantity)}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">💰 Stock Value (master rate)</span><span class="value" style="font-size:20px">${formatCurrency(data.total_value)}</span></div>
            <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">📦 Stock Value (lot cost / FIFO)</span><span class="value" style="font-size:20px">${data.lot_valuation_available ? formatCurrency(data.total_lot_value) : '—'}</span><span class="sub">${data.lot_valuation_available ? `Variance vs master rate: ${formatCurrency(data.lot_vs_master_diff)}` : 'Lot costing unavailable'}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Product</th><th>Category</th><th>Unit</th><th class="text-right">Stock Qty</th><th class="text-right">Rate</th><th class="text-right">Stock Value</th><th class="text-right">Lot Qty</th><th class="text-right">Lot Cost</th><th class="text-right">Lot Value</th><th>Status</th></tr></thead>
                <tbody>
                    ${data.items.map(i => {
                        const stock = i.current_stock || 0;
                        const reorder = i.reorder_level || 0;
                        const status = stock <= 0 ? 'danger' : stock <= reorder ? 'warning' : 'success';
                        const statusLabel = stock <= 0 ? 'Out of Stock' : stock <= reorder ? 'Low Stock' : 'In Stock';
                        return `<tr>
                            <td><strong>${escapeHtml(i.name)}</strong></td>
                            <td>${escapeHtml(i.category || '-')}</td>
                            <td>${escapeHtml(i.unit)}</td>
                            <td class="text-right">${formatNumber(stock)}</td>
                            <td class="text-right">${formatCurrency(i.rate || 0)}</td>
                            <td class="text-right" style="font-weight:600">${formatCurrency(i.stock_value || 0)}</td>
                            <td class="text-right">${i.lot_quantity === null || i.lot_quantity === undefined ? '—' : formatNumber(i.lot_quantity)}</td>
                            <td class="text-right">${i.lot_unit_cost === null || i.lot_unit_cost === undefined ? '—' : formatCurrency(i.lot_unit_cost)}</td>
                            <td class="text-right" style="font-weight:600" title="${escapeHtml(i.valuation_basis || '')}">${i.lot_value === null || i.lot_value === undefined ? '—' : formatCurrency(i.lot_value)}</td>
                            <td><span class="badge badge-${status}">${statusLabel}</span></td>
                        </tr>`;
                    }).join('')}
                    ${data.items.length === 0 ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No products found</td></tr>' : ''}
                </tbody>
                <tfoot><tr>
                    <td colspan="3"><strong>Total</strong></td>
                    <td class="text-right"><strong>${formatNumber(data.total_quantity)}</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_value)}</strong></td>
                    <td colspan="2"></td>
                    <td class="text-right"><strong>${data.lot_valuation_available ? formatCurrency(data.total_lot_value) : '—'}</strong></td>
                    <td></td>
                </tr></tfoot>
            </table>
        </div>`;
    }

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📋 Stock Statement</h2>
            <div class="btn-group">
                <button class="btn btn-success btn-sm" onclick="ssExportExcel()">📥 Excel</button>
                <button class="btn btn-info btn-sm" onclick="printStockStatementReport()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportStockStatementPDF()">📄 PDF</button>
            </div>
        </div>
        ${_ssFilterBar(data)}
        ${viewHtml}
    `;
}

async function applyStockStatement() {
    _ssState.category = document.getElementById('ssCategory')?.value || '';
    _ssState.search = document.getElementById('ssSearch')?.value || '';
    const valRes = await window.api.getStockStatement({ category: _ssState.category || undefined, search: _ssState.search || undefined });
    if (valRes.success) _finLastData.stockStatement = valRes.data;
    showStockStatement();
}

/**
 * Print the Stock Movement & Valuation report — the same table the screen
 * shows, laid out for paper: business header with phone/PAN, period strip with
 * Total Closing Value and Low Stock count, the movement table, and the
 * carry-forward footnote.
 */
async function printStockStatementReport() {
    const daily = _finLastData.stockDaily;
    if (!daily || !Array.isArray(daily.products) || !daily.products.length) { showToast('Load the Stock Movement view first', 'warning'); return; }
    const settings = await getSettingsCached();
    const m = _ssMovementTableModel(daily, _finLastData.stockStatement);
    const nz = v => Math.abs(v || 0) >= 0.005;
    const q = v => nz(v) ? formatNumber(round2ui(v)) : '0.00';
    const periodLabel = `${_ssState.from ? formatDate(_ssState.from) : 'Start'} → ${_ssState.to ? formatDate(_ssState.to) : 'Today'}`;
    const th = 'background:#1a5276;color:#fff;padding:6px 8px;font-size:8.5pt;text-align:right;text-transform:uppercase;';
    const td = 'border:1px solid #cfd8e3;padding:5px 8px;font-size:9.5pt;text-align:right;';
    const tf = `${td}background:#eef2f7;font-weight:700;`;

    const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;">
        <div style="text-align:center;border-bottom:3px double #1a5276;padding-bottom:10px;margin-bottom:12px;">
            <h1 style="font-size:18pt;color:#1a5276;margin:0;">${escapeHtml(settings.business_name || 'Prarambha Dairy Suppliers')}</h1>
            <div style="font-size:8.5pt;color:#666;">
                ${settings.business_phone ? 'Phone: ' + escapeHtml(settings.business_phone) : ''}
                ${settings.business_phone && settings.business_pan ? ' &nbsp;|&nbsp; ' : ''}
                ${settings.business_pan ? 'PAN/VAT: ' + escapeHtml(settings.business_pan) : ''}
            </div>
            <h2 style="font-size:12pt;color:#2c3e50;margin:8px 0 0;text-transform:uppercase;letter-spacing:1.5px;">Stock Movement &amp; Valuation Report</h2>
        </div>
        <div style="display:flex;justify-content:space-between;gap:20px;font-size:9.5pt;margin-bottom:10px;">
            <div><strong>Period:</strong> ${escapeHtml(periodLabel)}</div>
            <div style="text-align:right">
                <strong>Total Closing Value: Rs. ${formatNumber(round2ui(m.tot.value))}</strong><br>
                <strong>Low Stock Items:</strong> <span style="color:${m.lowCount ? '#c0392b' : '#1e8449'}">${m.lowCount}</span>
            </div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
            <thead><tr>
                <th style="${th}text-align:left">Product</th>
                <th style="${th}">Unit</th>
                <th style="${th}">Opening Stock</th>
                <th style="${th}">Purchases In</th>
                ${m.showProduction ? `<th style="${th}">Production In</th><th style="${th}">Used in Mixing</th>` : ''}
                <th style="${th}">Sales Out</th>
                ${m.showOther ? `<th style="${th}">Other IN</th><th style="${th}">Other OUT</th>` : ''}
                ${m.showShortfall ? `<th style="${th}">Shortfall</th>` : ''}
                <th style="${th}">Closing Stock</th>
                <th style="${th}">Rate (Rs)</th>
                <th style="${th}">Closing Value</th>
            </tr></thead>
            <tbody>
            ${m.rows.map(r => `
                <tr>
                    <td style="${td}text-align:left"><strong>${escapeHtml(r.name)}</strong></td>
                    <td style="${td}text-align:left">${escapeHtml(r.unit)}</td>
                    <td style="${td}">${q(r.opening)}</td>
                    <td style="${td}">${q(r.purchase)}</td>
                    ${m.showProduction ? `<td style="${td}">${q(r.production)}</td><td style="${td}">${q(r.used)}</td>` : ''}
                    <td style="${td}">${q(r.sales)}</td>
                    ${m.showOther ? `<td style="${td}">${q(r.otherIn)}</td><td style="${td}">${q(r.otherOut)}</td>` : ''}
                    ${m.showShortfall ? `<td style="${td};${nz(r.shortfall) ? 'color:#c0392b;font-weight:600' : ''}">${nz(r.shortfall) ? '-' + q(r.shortfall) : '—'}</td>` : ''}
                    <td style="${td};font-weight:700">${q(r.closing)}</td>
                    <td style="${td}">${formatNumber(r.rate)}</td>
                    <td style="${td};font-weight:600">${formatNumber(round2ui(r.closing * r.rate))}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot><tr>
                <td style="${tf}text-align:left" colspan="2">TOTALS</td>
                <td style="${tf}">${q(m.tot.opening)}</td>
                <td style="${tf}">${q(m.tot.purchase)}</td>
                ${m.showProduction ? `<td style="${tf}">${q(m.tot.production)}</td><td style="${tf}">${q(m.tot.used)}</td>` : ''}
                <td style="${tf}">${q(m.tot.sales)}</td>
                ${m.showOther ? `<td style="${tf}">${q(m.tot.otherIn)}</td><td style="${tf}">${q(m.tot.otherOut)}</td>` : ''}
                ${m.showShortfall ? `<td style="${tf};${nz(m.tot.shortfall) ? 'color:#c0392b' : ''}">${nz(m.tot.shortfall) ? '-' + q(m.tot.shortfall) : '—'}</td>` : ''}
                <td style="${tf}">${q(m.tot.closing)}</td>
                <td style="${tf}"></td>
                <td style="${tf}">${formatNumber(round2ui(m.tot.value))}</td>
            </tr></tfoot>
        </table>
        <div style="font-size:8pt;color:#666;margin-top:10px;line-height:1.6">
            ${m.shortfallDays > 0 ? `<span style="color:#c0392b">⚠ ${m.shortfallDays} product-day(s) closed short — stock sold beyond what the books recorded as received; the uncovered amount is the red Shortfall column.</span><br>` : ''}
            Opening Stock = master opening + all in − all out BEFORE the From Date (never below zero). Closing = Opening + Purchases In [+ Production In − Used in Mixing] − Sales Out${m.showShortfall ? ' + Shortfall' : ''}, chained day by day (each day's Opening = the previous day's Closing): sales deduct from yesterday's closing first, the excess from today's purchase.
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:30px;font-size:9pt;color:#444;">
            <div>Printed: ${new Date().toLocaleString('en-IN')}</div>
            <div style="border-top:1px solid #999;padding-top:4px;min-width:180px;text-align:center;">Authorized Signature</div>
        </div>
    </div>`;
    printHTML(html);
}

async function exportStockStatementPDF() {
    const data = _finLastData.stockStatement;
    if (!data) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Stock Statement</h2><p>Total Value: ${formatCurrency(data.total_value)}</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

/**
 * Excel export of the Excel-style stock statement (req 17).
 * Electron: the main process writes the workbook to the app data folder.
 * Web: POST the same period and download the generated file.
 * The workbook is built by the SAME costing engine, so it reconciles with what
 * the operator sees on screen (the result reports `reconciled`).
 */
async function ssExportExcel() {
    const payload = {
        from_date: _ssState.from, to_date: _ssState.to,
        category: _ssState.category || '', search: _ssState.search || ''
    };
    try {
        if (window.api && typeof window.api.exportStockStatement === 'function') {
            const result = await window.api.exportStockStatement(payload);
            if (result && result.success) {
                showToast(`✅ Stock statement exported${result.reconciled ? ' (reconciled)' : ' — check mismatches'}: ${result.filePath || ''}`, result.reconciled ? 'success' : 'warning');
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
        const res = await fetch('/api/export/stock-statement', { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' });
        if (!res.ok) { showToast('⚠️ Export failed (HTTP ' + res.status + ')', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Stock_Statement_Export.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        showToast('✅ Stock statement exported', 'success');
    } catch (err) {
        console.error('Stock statement export failed:', err);
        showToast('⚠️ Export failed: ' + err.message, 'error');
    }
}

// ============================================================
// Daybook
// ============================================================
async function showDaybookPage() {
    const container = document.getElementById('page-daybook');
    document.getElementById('topActions').innerHTML = '';
    // Default to the current BS month — a "today" default shows nothing when the
    // latest transaction is older than today (which is common with Excel-synced data).
    const preset = getDatePreset('this_month');

    // Enhanced daybook: also carries the money movements that touch no party
    // account (cash deposits → Bank DR · Cash CR, office expenses paid from the
    // bank → Expense DR · Bank CR). Customer receipts / supplier payments from
    // bank rows are already in the daybook through their documents.
    const result = await window.api.getEnhancedDaybook({ from_date: preset.from, to_date: preset.to });
    const data = result.success ? result.data : { entries: [], totalDebit: 0, totalCredit: 0, net: 0, count: 0 };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">📅 Daybook</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printDaybookPage()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportDaybookPagePDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="dbFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="dbTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyDaybookPage()">View</button></div>
            <div class="form-group"><label>&nbsp;</label>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('today');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">Today</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('this_month');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">This Month</button>
                <button class="btn btn-secondary btn-sm" onclick="const p=getDatePreset('last_month');document.getElementById('dbFrom').value=p.from;document.getElementById('dbTo').value=p.to;applyDaybookPage()">Last Month</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Entries</span><span class="value" style="font-size:20px">${data.count || 0}</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total Debit</span><span class="value" style="font-size:18px;color:var(--accent)">${formatCurrency(data.totalDebit)}</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Credit</span><span class="value" style="font-size:18px;color:var(--danger)">${formatCurrency(data.totalCredit)}</span></div>
            <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Net Balance</span><span class="value" style="font-size:18px">${formatCurrency(data.net)}</span></div>
        </div>
        ${data.milk && data.milk.on_purchase_bills > 0 ? `<div style="background:#e8f5e9;border-left:4px solid #4caf50;padding:10px 14px;border-radius:6px;font-size:12px;margin-bottom:10px">
            🥛 <strong>${data.milk.on_purchase_bills}</strong> milk collections worth ${formatCurrency(data.milk.on_purchase_bills_total)} are recorded on their purchase bills (shown as informational rows, ₹0 here) — the money is already in the Purchase rows above, so it is never counted twice.
        </div>` : ''}
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Account</th><th>Particulars</th><th>Accounts (DR → CR)</th><th class="text-right">Debit</th><th class="text-right">Credit</th></tr></thead>
                <tbody>
                    ${(data.entries || []).map(e => {
                        const badgeClass = e.type === 'sale' || e.transaction_type === 'Sale' ? 'badge-primary' : 
                            e.type === 'receipt' || e.transaction_type === 'Receipt' ? 'badge-success' : 'badge-danger';
                        // Every row carries the double-entry pair its type maps to,
                        // so the direction can be read from the accounts rather than
                        // trusted from a label.
                        const accounts = e.debit_account && e.credit_account
                            ? `${e.debit_account} → ${e.credit_account}` : '';
                        const isTransfer = !!e.is_transfer;
                        return `<tr${isTransfer ? ' style="background:#f1f8ff"' : ''}>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.ref_no || '')}</td>
                            <td><span class="badge ${badgeClass}">${e.transaction_type || e.type}</span>${isTransfer ? ' <span class="badge badge-info">transfer</span>' : ''}</td>
                            <td>${escapeHtml(e.account || '')}</td>
                            <td style="max-width:200px;font-size:12px">${escapeHtml(e.particulars || '')}</td>
                            <td style="font-size:11px;color:var(--text-light);max-width:190px">${escapeHtml(accounts)}</td>
                            <td class="text-right" style="color:${e.debit > 0 ? 'var(--accent)' : ''}">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td>
                            <td class="text-right" style="color:${e.credit > 0 ? 'var(--danger)' : ''}">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td>
                        </tr>`;
                    }).join('')}
                    ${(!data.entries || data.entries.length === 0) ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No transactions found</td></tr>' : ''}
                </tbody>
                <tfoot><tr><td colspan="6"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.totalDebit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.totalCredit)}</strong></td></tr></tfoot>
            </table>
        </div>
    `;
    _finLastData.daybook = data;
}

function applyDaybookPage() {
    const from = document.getElementById('dbFrom')?.value || '';
    const to = document.getElementById('dbTo')?.value || '';
    window.api.getEnhancedDaybook({ from_date: from, to_date: to }).then(r => {
        if (r.success) { _finLastData.daybook = r.data; showDaybookPage(); }
        else showToast(r.error, 'error');
    });
}

async function printDaybookPage() {
    const d = _finLastData.daybook;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Daybook</h2><p>Period: ${d.from_date} to ${d.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Entries</div><div class="value-number">${d.count}</div></div>
            <div class="value-card"><div class="value-label">Debit</div><div class="value-number">${formatCurrency(d.totalDebit)}</div></div>
            <div class="value-card"><div class="value-label">Credit</div><div class="value-number">${formatCurrency(d.totalCredit)}</div></div>
            <div class="value-card"><div class="value-label">Net</div><div class="value-number">${formatCurrency(d.net)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    printHTML(html);
}

async function exportDaybookPagePDF() { await printDaybookPage(); }

// ============================================================
// Payment Collection (dedicated page) — with Record Collection
// ============================================================

const PAYMENT_MODES = [
    { value: 'cash', label: 'Cash', icon: '💵' },
    { value: 'cheque', label: 'Cheque', icon: '📄' },
    { value: 'online', label: 'Online / UPI', icon: '📱' },
    { value: 'bank', label: 'Bank Transfer', icon: '🏦' },
    { value: 'mixed', label: 'Mixed', icon: '🔀' }
];

async function showCashCollectionPage() {
    const container = document.getElementById('page-cash-collection');
    document.getElementById('topActions').innerHTML = '';
    const preset = getDatePreset('this_month');

    const [collResult, payResult] = await Promise.all([
        window.api.getDailyCashCollection({ from_date: preset.from, to_date: preset.to }),
        window.api.getPayments({ from_date: preset.from, to_date: preset.to })
    ]);
    const data = collResult.success ? collResult.data : { days: [], total_cash_in: 0, total_cash_out: 0, net_cash: 0 };
    data.payment_records = payResult.success ? payResult.data || [] : [];

    const modeIcon = (mode) => {
        const m = PAYMENT_MODES.find(p => p.value === mode);
        return m ? m.icon + ' ' + m.label : (mode || '—');
    };

    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">💰 Payment Collection Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printCashCollectionPage()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportCashCollectionPagePDF()">📄 PDF</button>
            </div>
        </div>

        <!-- Quick Action Card: Record Payment Collection -->
        <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;border:2px dashed #64b5f6;transition:all 0.2s" 
             onclick="showAddCashCollectionRecord()"
             onmouseover="this.style.background='linear-gradient(135deg,#bbdefb,#90caf9)';this.style.borderColor='#2196f3';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.background='linear-gradient(135deg,#e3f2fd,#bbdefb)';this.style.borderColor='#64b5f6';this.style.transform='none'">
            <div>
                <div style="font-size:16px;font-weight:700;color:#1565c0">➕ Record Payment Collection</div>
                <div style="font-size:13px;color:#1976d2;margin-top:2px">Record incoming/outgoing payments with cash, cheque, online/UPI, or bank transfer</div>
            </div>
            <div style="font-size:32px;color:#1976d2">📝</div>
        </div>

        <div style="background:linear-gradient(135deg,#e8f5e9,#c8e6c9);border-radius:8px;padding:12px 16px;margin-bottom:12px;border-left:4px solid #4caf50;font-size:13px">
            <strong>ℹ️ Daily Totals</strong> (above) are auto-generated from Sales, Receipts, and Payments across all modules.
            To edit these, go to the respective source module (Sales, Purchases, Cash Deposit, etc.).
            <br><strong>Manual Entries</strong> (below) can be edited or deleted directly with ✏️ and 🗑 buttons.
        </div>
        <div class="filter-bar">
            <div class="form-group"><label>From</label><input type="date" class="form-control" id="ccFrom" value="${preset.from}"></div>
            <div class="form-group"><label>To</label><input type="date" class="form-control" id="ccTo" value="${preset.to}"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="applyCashCollectionPage()">Generate</button></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Expected (Total Sales)</span><span class="value" style="font-size:20px">${formatCurrency(data.expected_amount != null ? data.expected_amount : data.total_sales)}</span><span class="sub">From the sales records</span></div>
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Cash Received</span><span class="value" style="font-size:20px">${formatCurrency(data.cash_received)}</span><span class="sub">Collected against those sales</span></div>
            <div class="summary-card ${(data.difference || 0) > 0 ? 'card-danger' : 'card-success'}" style="margin:0;padding:12px"><span class="label">Difference</span><span class="value" style="font-size:20px">${formatCurrency(data.difference)}</span><span class="sub">Expected − received</span></div>
        </div>
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Total In</span><span class="value" style="font-size:20px">${formatCurrency(data.total_cash_in)}</span><span class="sub">Sales + Receipts + Other</span></div>
            <div class="summary-card card-danger" style="margin:0;padding:12px"><span class="label">Total Out</span><span class="value" style="font-size:20px">${formatCurrency(data.total_cash_out)}</span><span class="sub">Payments made</span></div>
            <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Net Position</span><span class="value" style="font-size:20px">${formatCurrency(data.net_cash)}</span><span class="sub">${data.net_cash >= 0 ? 'Surplus' : 'Deficit'}</span></div>
        </div>
        <div class="table-container">
            <table>
                <thead><tr><th>Date</th><th>Party</th><th class="text-right">Expected (Sales)</th><th class="text-right">Cash Received</th><th class="text-right">Difference</th><th class="text-right">Sales (cash mode)</th><th class="text-right">Receipts</th><th class="text-right">Total In</th><th class="text-right">Payments</th><th class="text-right">Other</th><th class="text-right">Net</th><th>Mode</th><th class="actions">Source</th></tr></thead>
                <tbody>
                    ${data.days.map(d => {
                        const partyLabel = d.party_names && d.party_names.length > 0 
                            ? d.party_names.join(', ') 
                            : (d.manual_entry ? '—' : '—');
                        return `<tr>
                        <td>${formatDate(d.date)}</td>
                        <td style="font-size:12px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.party_names && d.party_names.length > 0 ? escapeHtml(partyLabel) : '<span style="color:var(--text-light)">' + partyLabel + '</span>'}</td>
                        <td class="text-right"><strong>${formatCurrency(d.expected_amount || 0)}</strong></td>
                        <td class="text-right" style="color:var(--accent)">${formatCurrency(d.cash_received || 0)}</td>
                        <td class="text-right" style="color:${(d.difference || 0) > 0 ? 'var(--danger)' : 'var(--accent)'}">${formatCurrency(d.difference || 0)}</td>
                        <td class="text-right">${formatCurrency(d.cash_sales_total)}</td>
                        <td class="text-right">${formatCurrency(d.cash_receipts_total)}</td>
                        <td class="text-right"><strong>${formatCurrency(d.total_cash_in)}</strong></td>
                        <td class="text-right" style="color:var(--danger)">${formatCurrency(d.total_cash_out)}</td>
                        <td class="text-right">${formatCurrency(d.other_receipts_total)}</td>
                        <td class="text-right" style="font-weight:600;color:${d.net_cash >= 0 ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(d.net_cash)}</td>
                        <td style="font-size:12px">${d.manual_entry ? modeIcon(d.payment_mode) : '<span style="color:var(--text-light)">—</span>'}</td>
                        <td class="actions" style="font-size:11px">${d.manual_entry ? '<span style="color:var(--accent);font-weight:600">📝 Manual</span>' : '<span style="color:var(--text-light)">Auto</span>'}</td>
                    </tr>`;
                    }).join('')}
                    ${data.days.length === 0 ? '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-light)">No data for this period. Click "Record Payment Collection" to add a manual entry.</td></tr>' : ''}
                </tbody>
                <tfoot><tr><td><strong>Total</strong></td>
                    <td></td>
                    <td class="text-right"><strong>${formatCurrency(data.expected_amount || 0)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.cash_received || 0)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.difference || 0)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_sales_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_receipts_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_cash_in)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.total_cash_out)}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.other_receipts_total, 0))}</strong></td>
                    <td class="text-right"><strong>${formatCurrency(data.net_cash)}</strong></td>
                    <td></td>
                    <td></td>
                </tr></tfoot>
            </table>
        </div>

        <!-- Payment Records Section (from payments table) with View/Edit/Delete -->
        ${data.payment_records && data.payment_records.length > 0 ? `
        <div style="margin-top:24px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <span style="font-size:16px">💳</span>
                <h3 style="font-size:15px;font-weight:700;margin:0">Payment Records</h3>
                <span style="font-size:11px;background:var(--bg);color:var(--text-light);padding:2px 8px;border-radius:4px">${data.payment_records.length} payment(s)</span>
                <button class="btn btn-success btn-sm" style="margin-left:auto" onclick="showPaymentEntryForm()">+ New Payment / Receipt</button>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Party</th><th>Type</th><th>Transaction</th><th class="text-right">Amount</th><th>Mode</th><th>Reference</th><th>Notes</th><th class="actions" style="min-width:130px">Actions</th></tr></thead>
                    <tbody>
                        ${data.payment_records.map(p => {
                            const typeIcon = p.type === 'receipt' ? '📩' : '💸';
                            const typeLabel = p.type === 'receipt' ? 'Receipt' : 'Payment';
                            const ttLabels = {
                                actual_expense: '💰 Actual Expense', advance: '📥 Advance', loan_given: '🤝 Loan Given',
                                loan_received: '🏦 Loan Received', loan_repayment: '🔁 Loan Repayment',
                                advance_adjustment: '⚡ Advance Adjustment', settlement: '✓ Settlement', other: '… Other'
                            };
                            return `<tr>
                                <td>${formatDate(p.date)}</td>
                                <td style="font-size:12px"><strong>${escapeHtml(p.party_name || 'Unknown')}</strong></td>
                                <td><span class="badge ${p.type === 'receipt' ? 'badge-success' : 'badge-danger'}">${typeIcon} ${typeLabel}</span></td>
                                <td style="font-size:11px">${p.transaction_type ? (ttLabels[p.transaction_type] || escapeHtml(p.transaction_type)) : '<span style="color:var(--text-light)">—</span>'}</td>
                                <td class="text-right" style="font-weight:600;color:${p.type === 'receipt' ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(p.amount)}</td>
                                <td style="font-size:12px">${statusBadge(p.mode)}</td>
                                <td style="font-size:11px;color:var(--text-light)">${p.reference_type ? escapeHtml(p.reference_type) + (p.reference_id ? ' #' + p.reference_id : '') : '-'}</td>
                                <td style="font-size:12px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.notes || '')}</td>
                                <td class="actions" style="white-space:nowrap">
                                    <button class="btn btn-sm btn-info" onclick="viewPaymentRecord(${p.id})" title="View" style="padding:2px 6px;font-size:11px">👁️</button>
                                    <button class="btn btn-sm btn-secondary" onclick="editPaymentRecord(${p.id})" title="Edit" style="padding:2px 6px;font-size:11px">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deletePaymentRecord(${p.id})" title="Delete" style="padding:2px 6px;font-size:11px">🗑️</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}

        <!-- Manual Entries Section with Edit/Delete -->
        ${data.manual_entries && data.manual_entries.length > 0 ? `
        <div style="margin-top:24px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
                <span style="font-size:16px">📝</span>
                <h3 style="font-size:15px;font-weight:700;margin:0">Manual Entries</h3>
                <span style="font-size:11px;background:var(--bg);color:var(--text-light);padding:2px 8px;border-radius:4px">${data.manual_entries.length} record(s)</span>
            </div>
            <div class="table-container">
                <table>
                    <thead><tr><th>Date</th><th>Ref No</th><th class="text-right">Sales</th><th class="text-right">Receipts</th><th class="text-right">Payments</th><th class="text-right">Other</th><th>Mode</th><th>Party</th><th>Notes</th><th class="actions" style="min-width:80px">Actions</th></tr></thead>
                    <tbody>
                        ${data.manual_entries.map(e => {
                            const partyName = e.party_id ? (e.party_name || 'Party #' + e.party_id) : '-';
                            return `<tr>
                                <td>${formatDate(e.date)}</td>
                                <td style="font-size:12px;font-family:monospace;color:var(--primary)">${escapeHtml(e.ref_no || '')}</td>
                                <td class="text-right">${formatCurrency(e.cash_sales || 0)}</td>
                                <td class="text-right">${formatCurrency(e.cash_receipts || 0)}</td>
                                <td class="text-right" style="color:var(--danger)">${formatCurrency(e.cash_payments || 0)}</td>
                                <td class="text-right">${formatCurrency(e.other_receipts || 0)}</td>
                                <td style="font-size:12px">${modeIcon(e.payment_mode)}</td>
                                <td style="font-size:12px">${escapeHtml(partyName)}</td>
                                <td style="font-size:12px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.notes || '')}</td>
                                <td class="actions" style="white-space:nowrap">
                                    <button class="btn btn-sm btn-secondary" onclick="editCashCollectionRecord(${e.id})" title="Edit" style="padding:2px 8px;font-size:12px">✏️</button>
                                    <button class="btn btn-sm btn-danger" onclick="deleteCashCollectionRecord(${e.id})" title="Delete" style="padding:2px 8px;font-size:12px">🗑️</button>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}
    `;
    _finLastData.cashCollection = data;
}

function applyCashCollectionPage() {
    const from = document.getElementById('ccFrom')?.value || '';
    const to = document.getElementById('ccTo')?.value || '';
    Promise.all([
        window.api.getDailyCashCollection({ from_date: from, to_date: to }),
        window.api.getPayments({ from_date: from, to_date: to })
    ]).then(([collResult, payResult]) => {
        if (collResult.success) {
            const data = collResult.data;
            data.payment_records = payResult.success ? payResult.data || [] : [];
            _finLastData.cashCollection = data;
            showCashCollectionPage();
        } else {
            showToast(collResult.error, 'error');
        }
    });
}

// ============================================================
// Add Manual Payment Collection Record
// ============================================================
async function showAddCashCollectionRecord(record) {
    const todayStr = today();
    const isEdit = !!record;

    const modeOptions = PAYMENT_MODES.map(m => 
        `<option value="${m.value}"${record && record.payment_mode === m.value ? ' selected' : ''}>${m.icon} ${m.label}</option>`
    ).join('');

    // Fetch parties for the dropdown
    const partiesResult = await window.api.getParties({});
    const parties = partiesResult.success ? partiesResult.data : [];
    const partyOptions = parties.map(p => 
        `<option value="${p.id}"${record && record.party_id == p.id ? ' selected' : ''}>${escapeHtml(p.name)}${p.phone ? ' (' + escapeHtml(p.phone) + ')' : ''}</option>`
    ).join('');

    const title = isEdit ? '✏️ Edit Payment Collection' : '📝 Record Payment Collection';
    const btnText = isEdit ? '💾 Update & Integrate' : '💾 Save & Integrate';
    const recordIdHtml = isEdit ? `<input type="hidden" id="ccRecordId" value="${record.id}">` : '';

    const defaultDate = record ? record.date : today();
    const defaultRefNo = record ? (escapeHtml(record.ref_no || '')) : '';
    const defaultSales = record ? (record.cash_sales || 0) : 0;
    const defaultReceipts = record ? (record.cash_receipts || 0) : 0;
    const defaultPayments = record ? (record.cash_payments || 0) : 0;
    const defaultOther = record ? (record.other_receipts || 0) : 0;
    const defaultNotes = record ? (escapeHtml(record.notes || '')) : '';

    showModal(`
        <div class="modal-header">
            <h2>${title}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${recordIdHtml}
            <div class="form-row">
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" class="form-control" id="ccRecordDate" value="${defaultDate}">
                </div>
                <div class="form-group">
                    <label>Payment Mode *</label>
                    <select class="form-control" id="ccPaymentMode" onchange="updateCashCollectionPreview()">
                        ${modeOptions}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group" style="flex:1">
                    <label>🔖 Ref / Transaction No.</label>
                    <input type="text" class="form-control" id="ccRefNo" value="${defaultRefNo}" placeholder="e.g. RC-2026-001 / CHQ-004256">
                </div>
                <div class="form-group" style="flex:0.5">
                    <label>&nbsp;</label>
                    <div style="font-size:11px;color:var(--text-light);padding-top:6px">Optional reference number for tracking</div>
                </div>
            </div>
            <div class="form-section-title">Party & Integration</div>
            <div class="form-row">
                <div class="form-group">
                    <label>👤 Party (Customer/Supplier)</label>
                    <select class="form-control" id="ccPartyId">
                        <option value="">-- Select Party (optional) --</option>
                        ${partyOptions}
                    </select>
                    <small style="color:var(--text-light);font-size:11px">When selected, the amounts will automatically appear in the party's statement and the daybook.</small>
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <div style="background:linear-gradient(135deg,#e3f2fd,#bbdefb);padding:12px;border-radius:8px;font-size:12px;color:#1565c0">
                        <strong>💡 Auto-Integration</strong>
                        <div style="margin-top:4px">The amounts will be automatically posted to party statement, ledger, daybook, and reports.</div>
                    </div>
                </div>
            </div>
            <div class="form-section-title">Amount Breakdown</div>
            <div class="form-row">
                <div class="form-group">
                    <label>💰 Sales Amount</label>
                    <input type="number" class="form-control" id="ccCashSales" value="${defaultSales}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>📩 Receipts Amount</label>
                    <input type="number" class="form-control" id="ccCashReceipts" value="${defaultReceipts}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>💸 Payments (Out)</label>
                    <input type="number" class="form-control" id="ccCashPayments" value="${defaultPayments}" min="0" step="0.01" placeholder="0.00">
                </div>
                <div class="form-group">
                    <label>📊 Other Receipts</label>
                    <input type="number" class="form-control" id="ccOtherReceipts" value="${defaultOther}" min="0" step="0.01" placeholder="0.00">
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:16px 0;padding:16px;background:var(--bg);border-radius:8px">
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Total In</div>
                    <div id="ccPreviewIn" style="font-size:18px;font-weight:700;color:var(--accent)">रु 0.00</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Total Out</div>
                    <div id="ccPreviewOut" style="font-size:18px;font-weight:700;color:var(--danger)">रु 0.00</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:12px;color:var(--text-light)">Net Position</div>
                    <div id="ccPreviewNet" style="font-size:18px;font-weight:700;color:var(--primary)">रु 0.00</div>
                </div>
            </div>
            <div class="form-group">
                <label>Notes</label>
                <textarea class="form-control" id="ccNotes" rows="2" placeholder="e.g. Daily payment collection summary">${defaultNotes}</textarea>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="saveCashCollectionRecord()">${btnText}</button>
        </div>
    `);

    // Live preview on input
    ['ccCashSales', 'ccCashReceipts', 'ccCashPayments', 'ccOtherReceipts'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateCashCollectionPreview);
    });
    updateCashCollectionPreview();
}

function updateCashCollectionPreview() {
    const v = (id) => parseFloat(document.getElementById(id)?.value || 0);
    const cashIn = v('ccCashSales') + v('ccCashReceipts') + v('ccOtherReceipts');
    const cashOut = v('ccCashPayments');
    const net = cashIn - cashOut;

    const fmt = (val) => 'रु ' + val.toLocaleString('en-IN', { minimumFractionDigits: 2 });
    const elIn = document.getElementById('ccPreviewIn');
    const elOut = document.getElementById('ccPreviewOut');
    const elNet = document.getElementById('ccPreviewNet');
    if (elIn) { elIn.textContent = fmt(cashIn); elIn.style.color = 'var(--accent)'; }
    if (elOut) { elOut.textContent = fmt(cashOut); elOut.style.color = cashOut > 0 ? 'var(--danger)' : 'var(--text-light)'; }
    if (elNet) { 
        elNet.textContent = fmt(net); 
        elNet.style.color = net >= 0 ? 'var(--accent)' : 'var(--danger)'; 
    }
}

async function saveCashCollectionRecord() {
    const partyId = document.getElementById('ccPartyId')?.value;
    const recordId = document.getElementById('ccRecordId')?.value;
    const isEdit = !!recordId;

    const data = {
        date: document.getElementById('ccRecordDate')?.value || '',
        ref_no: document.getElementById('ccRefNo')?.value || '',
        payment_mode: document.getElementById('ccPaymentMode')?.value || 'cash',
        party_id: partyId ? parseInt(partyId) : null,
        cash_sales: parseFloat(document.getElementById('ccCashSales')?.value || 0),
        cash_receipts: parseFloat(document.getElementById('ccCashReceipts')?.value || 0),
        cash_payments: parseFloat(document.getElementById('ccCashPayments')?.value || 0),
        other_receipts: parseFloat(document.getElementById('ccOtherReceipts')?.value || 0),
        notes: document.getElementById('ccNotes')?.value || ''
    };

    // Include record ID for edits
    if (isEdit) data.id = parseInt(recordId);

    if (!data.date) { showToast('Date is required', 'error'); return; }
    const totalIn = data.cash_sales + data.cash_receipts + data.other_receipts;
    if (totalIn === 0 && data.cash_payments === 0) {
        showToast('Enter at least one amount', 'warning');
        return;
    }

    const result = await window.api.saveCashCollection(data);
    if (result.success) {
        closeModal();
        const integrated = partyId ? ' and integrated into party statement/ledger/daybook' : '';
        const action = isEdit ? 'updated' : 'saved';
        showToast('Payment collection record ' + action + integrated + '!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to save', 'error');
    }
}

async function printCashCollectionPage() {
    const d = _finLastData.cashCollection;
    if (!d) { showToast('Load data first', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Payment Collection Report</h2><p>Period: ${d.from_date} to ${d.to_date}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total In</div><div class="value-number">${formatCurrency(d.total_cash_in)}</div></div>
            <div class="value-card"><div class="value-label">Total Out</div><div class="value-number">${formatCurrency(d.total_cash_out)}</div></div>
            <div class="value-card"><div class="value-label">Net</div><div class="value-number">${formatCurrency(d.net_cash)}</div></div>
        </div>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    printHTML(html);
}

async function exportCashCollectionPagePDF() { await printCashCollectionPage(); }

// ============================================================
// Edit Manual Payment Collection Record
// ============================================================

/**
 * Open the record modal pre-filled with an existing manual entry's data.
 */
function editCashCollectionRecord(id) {
    const record = _finLastData.cashCollection?.manual_entries?.find(e => e.id === id);
    if (!record) {
        showToast('Could not find record to edit', 'error');
        return;
    }
    showAddCashCollectionRecord(record);
}

// ============================================================
// Delete Manual Payment Collection Record
// ============================================================

async function deleteCashCollectionRecord(id) {
    const confirmed = await confirmAction('Delete this manual payment collection record? This will also remove related ledger entries and party statement data.');
    if (!confirmed) return;

    const result = await window.api.deleteCashCollection(id);
    if (result.success) {
        showToast('Record deleted successfully!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to delete', 'error');
    }
}

// ============================================================
// Payment Records (from payments table) — View / Edit / Delete
// ============================================================

/**
 * View full payment record details in a modal.
 */
function viewPaymentRecord(id) {
    const records = _finLastData.cashCollection?.payment_records || [];
    const p = records.find(r => r.id === id);
    if (!p) { showToast('Record not found', 'error'); return; }

    showModal(`
        <div class="modal-header">
            <h2>💳 Payment Details</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
                <div><strong style="color:var(--text-light)">Record ID</strong><br>#${p.id}</div>
                <div><strong style="color:var(--text-light)">Date</strong><br>${formatDate(p.date)}</div>
                <div><strong style="color:var(--text-light)">Party</strong><br>${escapeHtml(p.party_name || 'Unknown')}</div>
                <div><strong style="color:var(--text-light)">Type</strong><br><span class="badge ${p.type === 'receipt' ? 'badge-success' : 'badge-danger'}">${p.type === 'receipt' ? '📩 Receipt' : '💸 Payment'}</span></div>
                <div><strong style="color:var(--text-light)">Amount</strong><br><span style="font-size:16px;font-weight:700;color:${p.type === 'receipt' ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(p.amount)}</span></div>
                <div><strong style="color:var(--text-light)">Mode</strong><br>${statusBadge(p.mode)}</div>
            </div>
            ${p.reference_type ? `<div style="margin-bottom:8px"><strong style="color:var(--text-light)">Reference</strong><br>${escapeHtml(p.reference_type)}${p.reference_id ? ' #' + p.reference_id : ''}</div>` : ''}
            ${p.notes ? `<div style="margin-bottom:8px"><strong style="color:var(--text-light)">Notes</strong><br>${escapeHtml(p.notes)}</div>` : ''}
            <div style="font-size:11px;color:var(--text-light);margin-top:12px;padding-top:8px;border-top:1px solid var(--border)">
                Created: ${p.created_at || 'N/A'}
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

/**
 * Edit a payment record — change mode, notes, or date.
 */
async function editPaymentRecord(id) {
    const records = _finLastData.cashCollection?.payment_records || [];
    const p = records.find(r => r.id === id);
    if (!p) { showToast('Record not found', 'error'); return; }

    showModal(`
        <div class="modal-header">
            <h2>✏️ Edit Payment</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <input type="hidden" id="editPayId" value="${p.id}">
            <div class="form-row">
                <div class="form-group">
                    <label>Party</label>
                    <input type="text" class="form-control" value="${escapeHtml(p.party_name || 'Unknown')}" disabled style="background:var(--bg)">
                </div>
                <div class="form-group">
                    <label>Amount</label>
                    <input type="text" class="form-control" value="${formatCurrency(p.amount)}" disabled style="background:var(--bg);font-weight:700;color:${p.type === 'receipt' ? 'var(--accent)' : 'var(--danger)'}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" class="form-control" id="editPayDate" value="${p.date}">
                </div>
                <div class="form-group">
                    <label>Mode *</label>
                    <select class="form-control" id="editPayMode">
                        <option value="cash" ${p.mode === 'cash' ? 'selected' : ''}>💵 Cash</option>
                        <option value="bank" ${p.mode === 'bank' ? 'selected' : ''}>🏦 Bank</option>
                        <option value="upi" ${p.mode === 'upi' ? 'selected' : ''}>📱 UPI</option>
                        <option value="cheque" ${p.mode === 'cheque' ? 'selected' : ''}>📄 Cheque</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Transaction Type (re-posts the accounting)</label>
                <select class="form-control" id="editPayType">
                    <option value="" ${!p.transaction_type ? 'selected' : ''}>— Settlement (legacy)</option>
                    <option value="actual_expense" ${p.transaction_type === 'actual_expense' ? 'selected' : ''}>💰 Actual Expense</option>
                    <option value="advance" ${p.transaction_type === 'advance' ? 'selected' : ''}>📥 Advance Payment</option>
                    <option value="loan_given" ${p.transaction_type === 'loan_given' ? 'selected' : ''}>🤝 Loan / Sapati Given</option>
                    <option value="loan_received" ${p.transaction_type === 'loan_received' ? 'selected' : ''}>🏦 Loan / Sapati Received</option>
                    <option value="loan_repayment" ${p.transaction_type === 'loan_repayment' ? 'selected' : ''}>🔁 Loan / Sapati Repayment</option>
                    <option value="advance_adjustment" ${p.transaction_type === 'advance_adjustment' ? 'selected' : ''}>⚡ Advance Adjustment</option>
                    <option value="advance_returned" ${p.transaction_type === 'advance_returned' ? 'selected' : ''}>↩ Advance Returned (money came back)</option>
                    <option value="settlement" ${p.transaction_type === 'settlement' ? 'selected' : ''}>✓ Settlement</option>
                    <option value="other" ${p.transaction_type === 'other' ? 'selected' : ''}>… Other</option>
                </select>
            </div>
            <div class="form-group">
                <label>Notes</label>
                <textarea class="form-control" id="editPayNotes" rows="2">${escapeHtml(p.notes || '')}</textarea>
            </div>
            <div style="background:var(--bg);padding:10px;border-radius:6px;font-size:12px;color:var(--text-light)">
                ℹ️ Amount cannot be changed. Changing the transaction type re-posts the ledger entry automatically.
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="savePaymentRecordEdit()">💾 Update</button>
        </div>
    `);
}

/**
 * Save the payment record edits.
 */
async function savePaymentRecordEdit() {
    const id = document.getElementById('editPayId')?.value;
    if (!id) { showToast('Invalid record', 'error'); return; }

    const data = {
        id: parseInt(id),
        date: document.getElementById('editPayDate')?.value || '',
        mode: document.getElementById('editPayMode')?.value || 'cash',
        transaction_type: document.getElementById('editPayType')?.value || '',
        notes: document.getElementById('editPayNotes')?.value || ''
    };
    if (data.transaction_type === '') data.transaction_type = null;

    if (!data.date) { showToast('Date is required', 'error'); return; }

    const result = await window.api.updatePayment(data);
    if (result.success) {
        closeModal();
        showToast('Payment updated successfully!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to update', 'error');
    }
}

/**
 * Delete a payment record with confirmation.
 */
async function deletePaymentRecord(id) {
    const records = _finLastData.cashCollection?.payment_records || [];
    const p = records.find(r => r.id === id);
    if (!p) { showToast('Record not found', 'error'); return; }

    const confirmed = await confirmAction(
        `Delete this ${p.type === 'receipt' ? 'receipt' : 'payment'} record of ${formatCurrency(p.amount)} from ${escapeHtml(p.party_name || 'Unknown')}?`,
        'This will also remove related ledger entries. This action cannot be undone.'
    );
    if (!confirmed) return;

    const result = await window.api.deletePayment(id);
    if (result.success) {
        showToast('Payment deleted successfully!', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to delete', 'error');
    }
}

// ============================================================
// Render function for Profit/Loss (used by app.js navigation)
// ============================================================
async function renderFinancialReports() {
    const container = document.getElementById('page-profit-loss');
    document.getElementById('topActions').innerHTML = '';
    container.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-light)"><span style="font-size:24px">⏳</span><p>Loading...</p></div>`;
    await showProfitLoss();
}

// ============================================================
// Payment / Receipt Entry with transaction-type accounting (§7)
// Payment does not automatically mean expense — the selected type
// decides whether this is a P&L event or a balance-sheet movement.
// ============================================================
const PAYMENT_TYPE_TREATMENTS = {
    actual_expense:    { dir: 'out', label: '💰 Actual Expense',      treat: 'P&L expense — reduces profit',          pnl: true },
    advance:           { dir: 'out', label: '📥 Advance Payment',    treat: 'Balance sheet — Advance Receivable ↑, no P&L effect', pnl: false },
    loan_given:        { dir: 'out', label: '🤝 Loan / Sapati Given', treat: 'Balance sheet — Loan Receivable ↑, no P&L effect', pnl: false },
    loan_received:     { dir: 'in',  label: '🏦 Loan / Sapati Received', treat: 'Balance sheet — Loan Payable ↑, NOT income', pnl: false },
    loan_repayment:    { dir: 'out', label: '🔁 Loan Repayment (we repay)', treat: 'Balance sheet — Loan Payable ↓, no P&L effect (interest only if typed as expense)', pnl: false },
    advance_adjustment:{ dir: 'out', label: '⚡ Advance Adjustment', treat: 'P&L expense now — Advance Receivable ↓ (actual usage recognised)', pnl: true },
    advance_returned:   { dir: 'in',  label: '↩ Advance Returned',   treat: 'Balance sheet — Advance Receivable ↓ (cash came back), no P&L effect', pnl: false }
};

function showPaymentEntryForm() {
    const parties = window._finLastData && window._finLastData.payment_records
        ? [] : []; // parties loaded fresh below
    showModal(`
        <div class="modal-header">
            <h2>💳 New Payment / Receipt</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group">
                    <label>Transaction Type *</label>
                    <select class="form-control" id="payEntryType" onchange="updatePaymentTypeTreatment()">
                        <option value="actual_expense">💰 Actual Expense (rent, salary, electricity…)</option>
                        <option value="advance">📥 Advance Payment (to supplier/party)</option>
                        <option value="loan_given">🤝 Loan / Sapati Given</option>
                        <option value="loan_received">🏦 Loan / Sapati Received</option>
                        <option value="loan_repayment">🔁 Loan / Sapati Repayment (we repay)</option>
                        <option value="advance_adjustment">⚡ Advance Adjustment (advance used for expense)</option>
                        <option value="advance_returned">↩ Advance Returned (money came back)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date *</label>
                    <input type="date" class="form-control" id="payEntryDate" value="${today()}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Party *</label>
                    <input type="text" class="form-control" id="payEntryParty" placeholder="Start typing a name…" list="payEntryPartyList" autocomplete="off">
                    <datalist id="payEntryPartyList"></datalist>
                </div>
                <div class="form-group">
                    <label>Amount (Rs) *</label>
                    <input type="number" class="form-control" id="payEntryAmount" min="0.01" step="0.01" oninput="updatePaymentTypeTreatment()">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Mode *</label>
                    <select class="form-control" id="payEntryMode">
                        <option value="cash">💵 Cash</option>
                        <option value="bank">🏦 Bank</option>
                        <option value="upi">📱 UPI</option>
                        <option value="cheque">📄 Cheque</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <input type="text" class="form-control" id="payEntryNotes" placeholder="reference, description…">
                </div>
            </div>
            <div class="form-row" id="payEntryBankRow">
                <div class="form-group">
                    <label>Bank Account</label>
                    <input type="text" class="form-control" id="payEntryBankAccount" placeholder="e.g. Nabil Bank A/C 1234">
                </div>
                <div class="form-group">
                    <label>Bank Reference / Voucher No</label>
                    <input type="text" class="form-control" id="payEntryBankRef" placeholder="e.g. QR-0912 — creates one linked bank transaction">
                </div>
            </div>
            <div id="payEntryTreatment" style="margin-top:8px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="submitPaymentEntry()">💾 Save</button>
        </div>
    `);

    // Load parties for the autocomplete
    window.api.getParties({}).then(r => {
        const parties = r.success ? (r.data || []) : [];
        const dl = document.getElementById('payEntryPartyList');
        if (dl) dl.innerHTML = parties.map(p => `<option value="${escapeHtml(p.name)}">`).join('');
        window._payEntryParties = parties;
    });
    updatePaymentTypeTreatment();
}

function updatePaymentTypeTreatment() {
    const t = document.getElementById('payEntryType')?.value || 'actual_expense';
    const info = PAYMENT_TYPE_TREATMENTS[t] || {};
    const box = document.getElementById('payEntryTreatment');
    if (!box || !info.label) return;
    const amount = parseFloat(document.getElementById('payEntryAmount')?.value || 0);
    const dir = info.dir === 'in' ? 'Cash/Bank +' : 'Cash/Bank −';
    box.innerHTML = `
        <strong>${info.label}</strong> — ${escapeHtml(info.treat)}<br>
        <span style="color:var(--text-light)">${dir} ${formatCurrency(amount)} · ${info.pnl ? 'P&L: recognised' : 'P&L: Rs 0 (balance-sheet movement)'}</span>`;
}

async function submitPaymentEntry() {
    const typeName = document.getElementById('payEntryType')?.value || 'actual_expense';
    const date = document.getElementById('payEntryDate')?.value || '';
    const partyName = (document.getElementById('payEntryParty')?.value || '').trim();
    const amount = parseFloat(document.getElementById('payEntryAmount')?.value || 0);
    if (!date) { showToast('Date is required', 'error'); return; }
    if (!partyName) { showToast('Party is required', 'error'); return; }
    if (!(amount > 0)) { showToast('Amount must be greater than zero', 'error'); return; }

    const parties = window._payEntryParties || [];
    const party = parties.find(p => p.name.toLowerCase() === partyName.toLowerCase());
    if (!party) { showToast('Unknown party — pick from the list', 'error'); return; }

    // Direction: loan_received brings money IN; everything else in the
    // selector pays money OUT.
    const dir = (PAYMENT_TYPE_TREATMENTS[typeName] || {}).dir === 'in' ? 'in' : 'out';
    const type = dir === 'in' ? 'receipt' : 'payment';

    const result = await window.api.savePayment({
        party_id: party.id, date, type,
        transaction_type: typeName,
        amount, mode: document.getElementById('payEntryMode')?.value || 'cash',
        bank_account: document.getElementById('payEntryBankAccount')?.value?.trim() || '',
        bank_reference: document.getElementById('payEntryBankRef')?.value?.trim() || '',
        notes: document.getElementById('payEntryNotes')?.value || ''
    });
    if (result.success) {
        closeModal();
        const info = PAYMENT_TYPE_TREATMENTS[typeName];
        showToast(info && !info.pnl ? 'Saved — balance-sheet movement (no P&L effect)' : 'Saved', 'success');
        applyCashCollectionPage();
    } else {
        showToast(result.error || 'Failed to save payment', 'error');
    }
}

// Globals
window.renderFinancialReports = renderFinancialReports;
window.showProfitLoss = showProfitLoss;
window.applyProfitLoss = applyProfitLoss;
window.printProfitLoss = printProfitLoss;
window.loadProfitLossMonthly = loadProfitLossMonthly;
window.applyProfitLossMonthly = applyProfitLossMonthly;
window.setProfitLossMonthlyRange = setProfitLossMonthlyRange;
window.printProfitLossMonthly = printProfitLossMonthly;
window.showReceivablePayable = showReceivablePayable;
window.printReceivablePayable = printReceivablePayable;
window.showStockStatement = showStockStatement;
window.applyStockStatement = applyStockStatement;
window.printStockStatementReport = printStockStatementReport;
window.ssExportExcel = ssExportExcel;
window.ssDrillProduct = ssDrillProduct;
window.ssOpenSource = ssOpenSource;
window.exportStockStatementPDF = exportStockStatementPDF;
window.showDaybookPage = showDaybookPage;
window.applyDaybookPage = applyDaybookPage;
window.printDaybookPage = printDaybookPage;
window.exportDaybookPagePDF = exportDaybookPagePDF;
window.showCashCollectionPage = showCashCollectionPage;
window.applyCashCollectionPage = applyCashCollectionPage;
window.printCashCollectionPage = printCashCollectionPage;
window.exportCashCollectionPagePDF = exportCashCollectionPagePDF;
window.showAddCashCollectionRecord = showAddCashCollectionRecord;
window.saveCashCollectionRecord = saveCashCollectionRecord;
window.updateCashCollectionPreview = updateCashCollectionPreview;
window.editCashCollectionRecord = editCashCollectionRecord;
window.deleteCashCollectionRecord = deleteCashCollectionRecord;
window.viewPaymentRecord = viewPaymentRecord;
window.editPaymentRecord = editPaymentRecord;
window.savePaymentRecordEdit = savePaymentRecordEdit;
window.deletePaymentRecord = deletePaymentRecord;
window.showPaymentEntryForm = showPaymentEntryForm;
window.updatePaymentTypeTreatment = updatePaymentTypeTreatment;
window.submitPaymentEntry = submitPaymentEntry;
