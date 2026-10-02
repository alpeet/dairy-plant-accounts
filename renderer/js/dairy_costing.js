/**
 * Dairy Costing Page
 * ==================
 * Read-only views over the scientific dairy costing engine (window.api dairy
 * endpoints). Tabs: Daily Dashboard, Daily Milk Cost, Milk Flow, Sales
 * Realization, Cost vs Sales, Product Cost, Stock Ledger, Daily Closing and
 * Traceability. All numbers come from the backend — the UI never calculates a
 * cost itself.
 */

let dairyState = {
    tab: 'overview',
    date: '',
    from: '',
    to: '',
    groupBy: 'daily'
};

const DAIRY_TABS = [
    ['overview', '📊 Daily Dashboard'],
    ['milk-cost', '🥛 Daily Milk Cost'],
    ['milk-flow', '🔁 Milk Flow'],
    ['sales', '💰 Sales Realization'],
    ['cost-vs-sales', '📈 Cost vs Sales'],
    ['product-cost', '🧮 Product Cost'],
    ['stock-ledger', '📋 Stock Ledger'],
    ['closing', '🧾 Daily Closing'],
    ['trace', '🔎 Traceability']
];

function dairyNum(n) { return formatNumber(Number(n) || 0); }
function dairyMoney(n) { return formatCurrency(Number(n) || 0); }
function dairyPct(n) { return `${(Number(n) || 0).toFixed(1)}%`; }

async function renderDairyCosting() {
    const container = document.getElementById('page-dairy-costing');
    if (!container) return;
    if (!dairyState.date) dairyState.date = today();
    if (!dairyState.from) dairyState.from = dairyState.date;
    if (!dairyState.to) dairyState.to = dairyState.date;

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-info btn-sm" onclick="dairyPrint()">🖨 Print</button>
        <button class="btn btn-secondary btn-sm" onclick="dairyRefresh()">⟳ Refresh</button>
    `;

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar" style="flex-wrap:wrap;gap:10px;align-items:flex-end">
                <div class="form-group" id="dairyDailyDate">
                    <label>Business Date</label>
                    <input type="date" class="form-control" id="dairyDate" value="${escapeHtml(dairyState.date)}">
                </div>
                <div class="form-group" id="dairyFromWrap">
                    <label>From</label>
                    <input type="date" class="form-control" id="dairyFrom" value="${escapeHtml(dairyState.from)}">
                </div>
                <div class="form-group" id="dairyToWrap">
                    <label>To</label>
                    <input type="date" class="form-control" id="dairyTo" value="${escapeHtml(dairyState.to)}">
                </div>
                <div class="form-group" id="dairyGroupWrap">
                    <label>Group By</label>
                    <select class="form-control" id="dairyGroupBy">
                        <option value="daily" ${dairyState.groupBy === 'daily' ? 'selected' : ''}>Daily</option>
                        <option value="weekly" ${dairyState.groupBy === 'weekly' ? 'selected' : ''}>Weekly</option>
                        <option value="monthly" ${dairyState.groupBy === 'monthly' ? 'selected' : ''}>Monthly</option>
                    </select>
                </div>
                <div class="form-group">
                    <button class="btn btn-primary btn-sm" onclick="dairyRefresh()">Apply</button>
                </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px" id="dairyTabs">
                ${DAIRY_TABS.map(([id, label]) => `<button class="btn btn-sm ${dairyState.tab === id ? 'btn-primary' : 'btn-secondary'}" onclick="dairySetTab('${id}')">${label}</button>`).join('')}
            </div>
        </div>
        <div id="dairyContent"><div class="loading" style="text-align:center;padding:40px">Loading…</div></div>
    `;
    dairyApplyFilterVisibility();
    await dairyLoadTab();
}

function dairyApplyFilterVisibility() {
    const tab = dairyState.tab;
    const rangeTabs = ['cost-vs-sales', 'product-cost', 'stock-ledger'];
    const showDaily = !rangeTabs.includes(tab);
    document.getElementById('dairyDailyDate').style.display = showDaily ? '' : 'none';
    document.getElementById('dairyFromWrap').style.display = rangeTabs.includes(tab) ? '' : 'none';
    document.getElementById('dairyToWrap').style.display = rangeTabs.includes(tab) ? '' : 'none';
    document.getElementById('dairyGroupWrap').style.display = tab === 'cost-vs-sales' ? '' : 'none';
}

function dairyReadFilter() {
    const g = (id) => document.getElementById(id)?.value || '';
    if (g('dairyDate')) dairyState.date = g('dairyDate');
    if (g('dairyFrom')) dairyState.from = g('dairyFrom');
    if (g('dairyTo')) dairyState.to = g('dairyTo');
    if (g('dairyGroupBy')) dairyState.groupBy = g('dairyGroupBy');
}

async function dairySetTab(tab) {
    dairyReadFilter();
    dairyState.tab = tab;
    document.getElementById('dairyTabs').innerHTML = DAIRY_TABS.map(([id, label]) =>
        `<button class="btn btn-sm ${tab === id ? 'btn-primary' : 'btn-secondary'}" onclick="dairySetTab('${id}')">${label}</button>`).join('');
    dairyApplyFilterVisibility();
    await dairyLoadTab();
}

async function dairyRefresh() {
    dairyReadFilter();
    await dairyLoadTab();
}

async function dairyLoadTab() {
    const el = document.getElementById('dairyContent');
    if (!el) return;
    el.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading…</div>';
    try {
        const loaders = {
            overview: dairyTabOverview,
            'milk-cost': dairyTabMilkCost,
            'milk-flow': dairyTabMilkFlow,
            sales: dairyTabSales,
            'cost-vs-sales': dairyTabCostVsSales,
            'product-cost': dairyTabProductCost,
            'stock-ledger': dairyTabStockLedger,
            closing: dairyTabClosing,
            trace: dairyTabTrace
        };
        el.innerHTML = await loaders[dairyState.tab]();
    } catch (e) {
        el.innerHTML = `<div class="card"><p style="color:var(--danger)">Could not load: ${escapeHtml(e.message || String(e))}</p></div>`;
    }
}

function dairyCard(title, body) {
    return `<div class="card" style="margin-bottom:16px"><h3 style="margin-top:0">${title}</h3>${body}</div>`;
}
function dairyKpi(label, value, sub) {
    return `<div style="border:1px solid var(--border);border-radius:8px;padding:12px;min-width:150px;flex:1">
        <div style="font-size:12px;color:var(--text-light)">${label}</div>
        <div style="font-size:20px;font-weight:600">${value}</div>
        ${sub ? `<div style="font-size:12px;color:var(--text-light)">${sub}</div>` : ''}
    </div>`;
}
function dairyKpiRow(cards) {
    return `<div style="display:flex;gap:12px;flex-wrap:wrap">${cards.join('')}</div>`;
}

// ── Overview: daily management dashboard ──
async function dairyTabOverview() {
    const r = await window.api.getManagementDashboard({ date: dairyState.date });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const m = d.milk_economics, s = d.sales, p = d.production, e = d.efficiency;
    const produced = (p.produced_products || []).map(x =>
        `<tr><td>${escapeHtml(x.product_name)}</td><td class="text-right">${dairyNum(x.qty)} ${escapeHtml(x.unit || '')}</td><td class="text-right">${dairyMoney(x.value)}</td></tr>`).join('')
        || '<tr><td colspan="3" style="text-align:center;color:var(--text-light)">No production today</td></tr>';
    return `
        ${dairyCard('Milk Economics — ' + formatDate(d.date), dairyKpiRow([
            dairyKpi('Milk Received', dairyNum(m.total_received_liters) + ' L'),
            dairyKpi('Purchase Cost', dairyMoney(m.total_purchase_cost)),
            dairyKpi('Avg Purchase/L', dairyMoney(m.avg_purchase_cost_per_liter)),
            dairyKpi('Processed', dairyNum(m.processed_liters) + ' L'),
            dairyKpi('Direct Sold', dairyNum(m.direct_sold_liters) + ' L'),
            dairyKpi('Remaining', dairyNum(m.remaining_liters) + ' L'),
            dairyKpi('Wastage', dairyNum(m.wastage_liters) + ' L', dairyPct(m.wastage_percent))
        ]))}
        ${dairyCard('Sales & Cost', dairyKpiRow([
            dairyKpi('Total Sales', dairyMoney(s.total_sales_value), s.invoice_count + ' invoices'),
            dairyKpi('Milk Sold', dairyNum(s.milk_liters_sold) + ' L'),
            dairyKpi('Sales Realization/L', dairyMoney(s.avg_sales_realization_per_liter)),
            dairyKpi('Raw Material Cost', dairyMoney(p.raw_material_cost)),
            dairyKpi('Processing Cost', dairyMoney(p.processing_cost)),
            dairyKpi('Avg Production Cost/L', dairyMoney(e.avg_production_cost_per_liter))
        ]))}
        ${dairyCard('Production Today', `
            <table class="data-table"><thead><tr><th>Product</th><th class="text-right">Quantity</th><th class="text-right">Value</th></tr></thead>
            <tbody>${produced}</tbody></table>
            ${p.yield_flags ? `<p style="color:var(--warning);margin-top:8px">⚠ ${p.yield_flags} batch(es) flagged for low/high yield.</p>` : ''}
        `)}
    `;
}

// ── Daily milk cost (weighted average per category) ──
async function dairyTabMilkCost() {
    const r = await window.api.getDailyMilkCost({ date: dairyState.date });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const rows = (d.categories || []).map(c =>
        `<tr><td>${escapeHtml(c.milk_type)}</td><td class="text-right">${dairyNum(c.liters)}</td>
         <td class="text-right">${dairyMoney(c.amount)}</td><td class="text-right"><strong>${dairyMoney(c.avg_rate)}</strong></td>
         <td class="text-right">${dairyPct(c.fat_percent)}</td><td class="text-right">${dairyPct(c.snf_percent)}</td></tr>`).join('')
        || '<tr><td colspan="6" style="text-align:center;color:var(--text-light)">No milk this date</td></tr>';
    return dairyCard('Weighted-Average Milk Purchase Cost — ' + formatDate(d.date), `
        <table class="data-table"><thead><tr>
            <th>Milk Type</th><th class="text-right">Litres</th><th class="text-right">Amount</th>
            <th class="text-right">Weighted Avg/L</th><th class="text-right">FAT %</th><th class="text-right">SNF %</th></tr></thead>
        <tbody>${rows}
            <tr style="font-weight:700"><td>TOTAL</td><td class="text-right">${dairyNum(d.total_liters)}</td>
            <td class="text-right">${dairyMoney(d.total_amount)}</td><td class="text-right">${dairyMoney(d.avg_rate)}</td>
            <td class="text-right">${dairyPct(d.fat_percent)}</td><td class="text-right">${dairyPct(d.snf_percent)}</td></tr>
        </tbody></table>
        <p style="color:var(--text-light);font-size:12px;margin-top:8px">Weighted average = total cost ÷ total litres (never an arithmetic mean of rates). Collections: ${dairyNum(d.collections_liters)} L · Purchase bills: ${dairyNum(d.purchase_liters)} L.</p>
    `);
}

// ── Milk flow reconciliation ──
async function dairyTabMilkFlow() {
    const r = await window.api.getMilkFlow({ date: dairyState.date });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const line = (label, q, v, rate) =>
        `<tr><td>${label}</td><td class="text-right">${dairyNum(q)} L</td><td class="text-right">${dairyMoney(v)}</td><td class="text-right">${rate != null ? dairyMoney(rate) : ''}</td></tr>`;
    const ok = d.identity && d.identity.balanced;
    return dairyCard('Milk Flow & Reconciliation — ' + formatDate(d.date), `
        <table class="data-table"><thead><tr><th>Movement</th><th class="text-right">Quantity</th><th class="text-right">Value</th><th class="text-right">Rate/L</th></tr></thead>
        <tbody>
            ${line('Opening Milk Stock', d.opening.qty, d.opening.value, d.opening.rate)}
            ${line('Milk Collected / Purchased', d.collected.qty, d.collected.value, null)}
            ${line('Milk Used in Production', d.processed.qty, d.processed.value, null)}
            ${line('Direct Milk Sales', d.direct_sold.qty, d.direct_sold.value, null)}
            ${line('Milk Wastage', d.wastage.qty, d.wastage.value, null)}
            ${line('Closing Milk Stock', d.closing.qty, d.closing.value, d.closing.rate)}
        </tbody></table>
        <p style="margin-top:8px;color:${ok ? 'var(--success)' : 'var(--danger)'}">
            ${ok ? '✔ Inflow reconciles with outflow.' : `✖ Reconciliation error: ${dairyNum(d.identity.error)} L (inflow ${dairyNum(d.identity.inflow)} vs outflow ${dairyNum(d.identity.outflow)})`}
        </p>
        <p style="color:var(--text-light);font-size:12px">Values are carried at actual lot cost; opening is the raw-milk lot pool at the start of the day.</p>
    `);
}

// ── Sales realization per litre ──
async function dairyTabSales() {
    const r = await window.api.getDailySalesRealization({ date: dairyState.date });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    return dairyCard('Sales Realization — ' + formatDate(d.date), dairyKpiRow([
        dairyKpi('Litres Sold', dairyNum(d.net_liters) + ' L'),
        dairyKpi('Gross Sales', dairyMoney(d.gross_sales)),
        dairyKpi('Discounts', dairyMoney(d.discounts)),
        dairyKpi('Returns', dairyMoney(d.returns_value)),
        dairyKpi('Net Sales', dairyMoney(d.net_sales)),
        dairyKpi('Realization/L', dairyMoney(d.realization_per_liter)),
        dairyKpi('Cost/L (actual)', dairyMoney(d.cost_per_liter)),
        dairyKpi('Gross Margin/L', dairyMoney(d.gross_margin_per_liter))
    ]) + `<p style="color:var(--text-light);font-size:12px;margin-top:10px">Cost/L is the actual FIFO lot cost of the milk sold — never today's purchase price. Margin = realization − actual COGS.</p>`);
}

// ── Milk cost vs sales over a range ──
async function dairyTabCostVsSales() {
    const r = await window.api.getDailyMilkCostVsSales({ from_date: dairyState.from, to_date: dairyState.to, groupBy: dairyState.groupBy });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const rows = (d.rows || []).map(x =>
        `<tr><td>${escapeHtml(x.period)}</td><td class="text-right">${dairyNum(x.received_liters)}</td>
         <td class="text-right">${dairyMoney(x.avg_purchase_cost)}</td><td class="text-right">${dairyNum(x.sold_liters)}</td>
         <td class="text-right">${dairyMoney(x.avg_sales_realization)}</td><td class="text-right">${dairyMoney(x.production_cost_per_liter)}</td>
         <td class="text-right" style="color:${x.gross_margin_per_liter >= 0 ? 'var(--success)' : 'var(--danger)'}">${dairyMoney(x.gross_margin_per_liter)}</td></tr>`).join('')
        || '<tr><td colspan="7" style="text-align:center;color:var(--text-light)">No data in range</td></tr>';
    return dairyCard(`Milk Cost vs Sales (${d.group_by})`, `
        <table class="data-table"><thead><tr>
            <th>Period</th><th class="text-right">Milk Received (L)</th><th class="text-right">Avg Purchase/L</th>
            <th class="text-right">Milk Sold (L)</th><th class="text-right">Avg Sales/L</th>
            <th class="text-right">Production Cost/L</th><th class="text-right">Gross Margin/L</th></tr></thead>
        <tbody>${rows}</tbody></table>
    `);
}

// ── Product cost report ──
async function dairyTabProductCost() {
    const r = await window.api.getProductCostReport({ from_date: dairyState.from, to_date: dairyState.to });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const rows = (d.rows || []).map(p =>
        `<tr><td>${escapeHtml(p.product_name)}</td><td class="text-right">${dairyMoney(p.input_cost)}</td>
         <td class="text-right">${dairyMoney(p.processing_cost)}</td><td class="text-right">${dairyMoney(p.total_cost)}</td>
         <td class="text-right">${dairyNum(p.output_quantity)} ${escapeHtml(p.unit || '')}</td>
         <td class="text-right"><strong>${dairyMoney(p.unit_cost)}</strong></td>
         <td class="text-right">${dairyMoney(p.selling_price)}</td>
         <td class="text-right" style="color:${p.margin_per_unit >= 0 ? 'var(--success)' : 'var(--danger)'}">${dairyMoney(p.margin_per_unit)}</td></tr>`).join('')
        || '<tr><td colspan="8" style="text-align:center;color:var(--text-light)">No batches in range</td></tr>';
    const drills = (d.batches || []).map(b =>
        `<tr><td>${escapeHtml(b.date)}</td><td>${escapeHtml(b.batch_no)}</td><td>${escapeHtml(b.product_name)}</td>
         <td>${escapeHtml(b.process_type)}</td><td class="text-right">${dairyNum(b.quantity)}</td>
         <td class="text-right">${dairyMoney(b.unit_cost)}</td><td class="text-right">${dairyMoney(b.selling_price)}</td>
         <td>${b.yield_flag && b.yield_flag !== 'ok' ? `<span style="color:var(--warning)">${escapeHtml(b.yield_flag)} yield</span>` : 'ok'}</td></tr>`).join('');
    return dairyCard('Product Cost', `
        <table class="data-table"><thead><tr>
            <th>Product</th><th class="text-right">Input Cost</th><th class="text-right">Processing</th>
            <th class="text-right">Total Cost</th><th class="text-right">Output Qty</th><th class="text-right">Cost/Unit</th>
            <th class="text-right">Selling Price</th><th class="text-right">Margin/Unit</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${drills ? `<h4 style="margin-top:16px">Batch drill-down</h4>
        <table class="data-table"><thead><tr><th>Date</th><th>Batch</th><th>Product</th><th>Process</th>
        <th class="text-right">Qty</th><th class="text-right">Unit Cost</th><th class="text-right">Selling</th><th>Yield</th></tr></thead>
        <tbody>${drills}</tbody></table>` : ''}
    `);
}

// ── Stock ledger + valuation ──
async function dairyTabStockLedger() {
    const [lr, vr] = await Promise.all([
        window.api.getStockLedger({ from_date: dairyState.from, to_date: dairyState.to }),
        window.api.getInventoryValuation({})
    ]);
    const d = (lr && lr.success !== false) ? (lr.data || lr) : null;
    const v = (vr && vr.success !== false) ? (vr.data || vr) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const groups = v ? dairyKpiRow(Object.entries(v.groups || {}).map(([k, val]) => dairyKpi(k, dairyMoney(val)))) : '';
    const prodBlocks = (d.products || []).filter(p => (p.rows || []).length).map(p => `
        <h4 style="margin-top:16px">${escapeHtml(p.product_name)} <span style="font-weight:400;color:var(--text-light)">— ${escapeHtml(p.inventory_category)} · ${dairyMoney(p.lot_value)} on hand</span></h4>
        <table class="data-table"><thead><tr><th>Date</th><th>Reference</th><th class="text-right">IN</th>
            <th class="text-right">OUT</th><th class="text-right">Balance</th><th class="text-right">Unit Cost</th><th class="text-right">Value</th></tr></thead>
        <tbody>${(p.rows || []).map(r0 => `<tr><td>${escapeHtml(r0.date)}</td><td>${escapeHtml(r0.type)}${r0.notes ? ' · ' + escapeHtml(r0.notes) : ''}</td>
            <td class="text-right">${r0.inward_qty ? dairyNum(r0.inward_qty) : ''}</td>
            <td class="text-right">${r0.outward_qty ? dairyNum(r0.outward_qty) : ''}</td>
            <td class="text-right">${dairyNum(r0.balance)}</td><td class="text-right">${dairyMoney(r0.unit_cost)}</td>
            <td class="text-right">${dairyMoney(r0.value)}</td></tr>`).join('')}</tbody></table>`).join('')
        || '<p style="color:var(--text-light)">No movements in range.</p>';
    return dairyCard('Inventory Valuation (Raw Materials / WIP / Finished Goods)', groups)
        + dairyCard('Stock Ledger', prodBlocks);
}

// ── Daily closing ──
async function dairyTabClosing() {
    const r = await window.api.getDailyClosing({ date: dairyState.date });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) return '<div class="card"><p>No data.</p></div>';
    const fgRows = (d.finished_goods || []).map(f =>
        `<tr><td>${escapeHtml(f.product_name)}</td><td class="text-right">${dairyNum(f.opening)}</td>
         <td class="text-right">${dairyNum(f.produced)}</td><td class="text-right">${dairyNum(f.sold)}</td>
         <td class="text-right">${dairyNum(f.wasted)}</td><td class="text-right">${dairyNum(f.closing)}</td>
         <td class="text-right" style="color:${f.balanced ? 'var(--success)' : 'var(--danger)'}">${f.balanced ? '✔' : '✖ ' + dairyNum(f.error)}</td></tr>`).join('');
    const errs = (d.errors || []).length
        ? `<div style="margin-top:12px;padding:10px;border:1px solid var(--danger);border-radius:8px;color:var(--danger)">
             <strong>Reconciliation errors</strong><ul>${d.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
        : '<p style="margin-top:10px;color:var(--success)">✔ Milk, cream and finished goods all reconcile.</p>';
    return dairyCard('Daily Production & Stock Closing — ' + formatDate(d.date), `
        ${dairyKpiRow([
            dairyKpi('Milk Opening', dairyNum(d.milk.opening.qty) + ' L'),
            dairyKpi('Milk Closing', dairyNum(d.milk.closing.qty) + ' L'),
            dairyKpi('Cream Produced', dairyNum(d.cream.produced)),
            dairyKpi('Cream Closing', dairyNum(d.cream.closing)),
            dairyKpi('Inventory Value', dairyMoney(d.valuation.total_value))
        ])}
        <h4 style="margin-top:16px">Finished Goods</h4>
        <table class="data-table"><thead><tr><th>Product</th><th class="text-right">Opening</th><th class="text-right">Produced</th>
            <th class="text-right">Sold</th><th class="text-right">Wasted</th><th class="text-right">Closing</th><th class="text-right">Check</th></tr></thead>
        <tbody>${fgRows || '<tr><td colspan="7" style="text-align:center;color:var(--text-light)">No finished goods movement</td></tr>'}</tbody></table>
        ${errs}
    `);
}

// ── Traceability ──
async function dairyTabTrace() {
    return `
        ${dairyCard('Trace a Sale → Batch → Milk → Farmer', `
            <div class="filter-bar">
                <div class="form-group"><label>Sale ID</label><input type="number" class="form-control" id="dairySaleId" placeholder="e.g. 12"></div>
                <div class="form-group"><button class="btn btn-primary btn-sm" onclick="dairyTraceSale()">Trace Sale</button></div>
            </div>
            <div id="dairyTraceSaleResult" style="margin-top:8px"></div>
        `)}
        ${dairyCard('Trace a Production Batch → Raw Milk', `
            <div class="filter-bar">
                <div class="form-group"><label>Batch ID</label><input type="number" class="form-control" id="dairyBatchId" placeholder="e.g. 5"></div>
                <div class="form-group"><button class="btn btn-primary btn-sm" onclick="dairyTraceBatch()">Trace Batch</button></div>
            </div>
            <div id="dairyTraceBatchResult" style="margin-top:8px"></div>
        `)}
    `;
}

function dairyTraceNode(chain) {
    if (!chain) return '';
    const b = chain.batch;
    const milk = (chain.inputs || []).flatMap(i => i.raw_milk_lots || []);
    const upstream = (chain.inputs || []).flatMap(i => (i.upstream || []).map(dairyTraceNode));
    const parts = [];
    if (b) parts.push(`<div style="margin:4px 0"><strong>Batch ${escapeHtml(b.batch_no)}</strong> · ${escapeHtml(b.date)} · ${escapeHtml(b.process_type)} · cost ${dairyMoney(b.total_cost)}</div>`);
    for (const m of milk) {
        parts.push(`<div style="margin:4px 0 4px 18px">↳ 🥛 ${escapeHtml(m.milk_type)} lot · ${escapeHtml(m.date)} · ${dairyNum(m.quantity)} L @ ${dairyMoney(m.unit_cost)} · ${escapeHtml(m.farmer || m.collection_no || '')}</div>`);
    }
    for (const u of upstream) parts.push(`<div style="margin-left:18px">${u}</div>`);
    return parts.join('');
}

async function dairyTraceSale() {
    const id = Number(document.getElementById('dairySaleId').value);
    const out = document.getElementById('dairyTraceSaleResult');
    if (!id) { out.innerHTML = '<p style="color:var(--danger)">Enter a sale ID</p>'; return; }
    const r = await window.api.getSaleTraceability({ saleId: id });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) { out.innerHTML = '<p style="color:var(--danger)">Sale not found</p>'; return; }
    out.innerHTML = `<div style="font-size:13px"><strong>Invoice ${escapeHtml(d.sale.invoice_no)}</strong> · ${escapeHtml(d.sale.date)} · ${escapeHtml(d.sale.party_name || '')}</div>`
        + (d.items || []).map(it => `<div style="margin-top:10px"><strong>${escapeHtml(it.product_name)}</strong> × ${dairyNum(it.quantity)}</div>`
            + (it.lots || []).map(l => `<div style="margin-left:12px">${l.lot ? `FG lot #${l.lot.lot_id} · ${dairyNum(l.lot.quantity)} @ ${dairyMoney(l.lot.unit_cost)}` : 'pre-cutover stock (no lot)'}${dairyTraceNode(l)}</div>`).join('')).join('')
        || '<p style="color:var(--text-light)">No lot-backed items (pre-cutover sale).</p>';
}

async function dairyTraceBatch() {
    const id = Number(document.getElementById('dairyBatchId').value);
    const out = document.getElementById('dairyTraceBatchResult');
    if (!id) { out.innerHTML = '<p style="color:var(--danger)">Enter a batch ID</p>'; return; }
    const r = await window.api.getBatchTraceability({ batchId: id });
    const d = (r && r.success !== false) ? (r.data || r) : null;
    if (!d) { out.innerHTML = '<p style="color:var(--danger)">Batch not found</p>'; return; }
    out.innerHTML = `<div style="font-size:13px">${dairyTraceNode(d.chain) || '<p style="color:var(--text-light)">No costed inputs.</p>'}</div>`;
}

function dairyPrint() {
    const content = document.getElementById('dairyContent')?.innerHTML || '';
    const title = (DAIRY_TABS.find(t => t[0] === dairyState.tab) || ['', 'Dairy Costing'])[1];
    printHTML(`<h2>${title}</h2><p>${formatDate(dairyState.date)}</p>${content}`);
}
