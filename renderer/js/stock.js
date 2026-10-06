/**
 * Stock / Inventory Module
 * Product master list, current stock, stock movements, low stock alerts
 */

async function renderStock() {
    const container = document.getElementById('page-stock');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading stock data...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary" onclick="showProductForm()">+ New Product</button>
        <button class="btn btn-info" onclick="showStockAdjustForm()">📝 Adjust Stock</button>
        <button class="btn btn-info" onclick="printStockList()">🖨 Print</button>
        <button class="btn btn-primary" onclick="exportStockPDF()">📄 PDF</button>
    `;

    const [stockResult, movementsResult] = await Promise.all([
        window.api.getStockCurrent(),
        window.api.getStockMovements({})
    ]);

    const stock = stockResult.success ? stockResult.data : [];
    const movements = movementsResult.success ? movementsResult.data : [];

    const lowStock = stock.filter(p => p.current_balance <= p.reorder_level && p.reorder_level > 0);
    const stockValue = stock.reduce((s, p) => s + (p.current_balance * p.rate), 0);
    // Today's Stock panel keeps ONE stored filter (D5 page-filter store).
    const tsFilter = pageFilterInit('stock_todays', { preset: 'today' });

    container.innerHTML = `
        <!-- Summary Cards -->
        <div class="summary-cards">
            <div class="summary-card card-info">
                <span class="label">Total Products</span>
                <span class="value">${stock.length}</span>
                <span class="sub">Active products in inventory</span>
            </div>
            <div class="summary-card card-success">
                <span class="label">Stock Value</span>
                <span class="value">${formatCurrency(stockValue)}</span>
                <span class="sub">At current rates</span>
            </div>
            <div class="summary-card card-danger">
                <span class="label">Low Stock Items</span>
                <span class="value">${lowStock.length}</span>
                <span class="sub">${lowStock.length > 0 ? '⚠️ Needs attention' : '✅ All good'}</span>
            </div>
            <div class="summary-card card-warning">
                <span class="label">Total Movements</span>
                <span class="value">${movements.length}</span>
                <span class="sub">All time transactions</span>
            </div>
        </div>

        <!-- ══ Today's Stock (N16/N44) — presentation over getStockLedger, no second engine ══ -->
        <div class="card" style="margin-bottom:16px">
            <div class="card-header" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
                <h2 style="margin:0">📦 Today's Stock</h2>
                <button class="btn btn-info btn-sm" onclick="tsOpenStatement(null)">📋 Stock Statement detail →</button>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                ${datePresetBar('tsFrom', 'tsTo', 'refreshTodaysStock', ['today', 'yesterday', 'last_7', 'this_month', 'all'])}
            </div>
            <div class="filter-bar">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="tsFrom" value="${tsFilter.from || ''}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="tsTo" value="${tsFilter.to || ''}">
                </div>
                <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshTodaysStock()">Apply Range</button></div>
                <div class="form-group" style="flex:1"><label>&nbsp;</label><div id="tsPeriodLabel" style="font-size:12px;color:var(--text-light);padding-top:6px"></div></div>
            </div>
            <div style="font-size:12.5px;color:var(--text-light);margin-bottom:8px">
                <strong style="color:var(--text)">Opening + Collection/Purchase + Production − Sales − Consumption − Wastage ± Other = Closing</strong>
                <span style="font-size:11px"> — click a product to open its Stock Statement detail</span>
            </div>
            <div id="todaysStockBody"><div class="loading" style="text-align:center;padding:20px">Loading today's stock...</div></div>
        </div>

        <!-- Quick Action Card: New Stock Movement -->
        <div style="background:linear-gradient(135deg,#fff8e1,#ffecb3);border-radius:12px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;border:2px dashed #ffd54f;transition:all 0.2s"
             onclick="showQuickStockMovement()"
             onmouseover="this.style.background='linear-gradient(135deg,#ffecb3,#ffe082)';this.style.borderColor='#ffc107';this.style.transform='translateY(-2px)'"
             onmouseout="this.style.background='linear-gradient(135deg,#fff8e1,#ffecb3)';this.style.borderColor='#ffd54f';this.style.transform='none'">
            <div>
                <div style="display:flex;align-items:center;gap:12px">
                    <span style="font-size:28px">📦</span>
                    <div>
                        <div style="font-size:16px;font-weight:700;color:#e65100">➕ Record Stock Movement</div>
                        <div style="font-size:13px;color:#ef6c00;margin-top:2px">Quickly add stock in/out — select product, enter quantity (+/-), and save</div>
                    </div>
                </div>
            </div>
            <div style="text-align:right">
                <div style="font-size:14px;font-weight:600;color:#e65100">Click to open form</div>
                <div style="font-size:12px;color:#ef6c00">Quick adjustment →</div>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
            <!-- Left: Product List -->
            <div class="card">
                <div class="card-header"><h2>Product List</h2></div>
                <div class="form-group">
                    <input type="text" class="form-control" id="stockSearch" placeholder="Search products..." onkeyup="filterStockTable()" autocomplete="off">
                </div>
                <div class="form-group" style="margin-top:8px">
                    <span id="stockSearchCount" style="font-size:12px;color:var(--text-light)"></span>
                </div>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Category</th>
                                <th class="text-right">Stock</th>
                                <th>Unit</th>
                                <th class="text-right">Rate</th>
                                <th class="text-right">Value</th>
                                <th class="actions">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="stockTableBody">
                            ${stock.map(p => `
                                <tr class="${p.current_balance <= p.reorder_level && p.reorder_level > 0 ? 'low-stock-row' : ''}">
                                    <td><strong>${escapeHtml(p.name)}</strong>${p.active === 0 ? ' <span class="badge badge-warning" title="Archived — hidden from entry screens, history kept">archived</span>' : ''}${p.code ? `<br><small style="color:var(--text-light)">${escapeHtml(p.code)}</small>` : ''}</td>
                                    <td>${escapeHtml(p.category || '-')}</td>
                                    <td class="text-right ${p.current_balance <= p.reorder_level && p.reorder_level > 0 ? 'low-stock' : ''}">
                                        <strong>${formatNumber(p.current_balance)}</strong>
                                        ${p.current_balance <= p.reorder_level && p.reorder_level > 0 ? ' ⚠️' : ''}
                                    </td>
                                    <td>${escapeHtml(p.unit)}</td>
                                    <td class="text-right">${formatCurrency(p.rate)}</td>
                                    <td class="text-right">${formatCurrency(p.current_balance * p.rate)}</td>
                                    <td class="actions">
                                        <button class="btn btn-primary btn-sm" onclick="editProduct(${p.id})">✏️</button>
                                        <button class="btn btn-info btn-sm" onclick="viewProductMovement(${p.id})">📋</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteProductEntry(${p.id})">🗑</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Right: Recent Movements -->
            <div class="card">
                <div class="card-header">
                    <h2>Recent Stock Movements</h2>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>From</label>
                        <input type="date" class="form-control" id="movementFrom">
                    </div>
                    <div class="form-group">
                        <label>To</label>
                        <input type="date" class="form-control" id="movementTo">
                    </div>
                </div>
                <div class="table-container" style="max-height:400px;overflow-y:auto">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Product</th>
                                <th>Type</th>
                                <th class="text-right">In</th>
                                <th class="text-right">Out</th>
                                <th class="text-right">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${movements.slice(0, 50).map(m => `
                                <tr>
                                    <td>${formatDate(m.date)}</td>
                                    <td>${escapeHtml(m.product_name)}</td>
                                    <td><span class="badge ${m.type === 'purchase' ? 'badge-success' : m.type === 'sale' ? 'badge-danger' : 'badge-info'}">${escapeHtml(m.type)}</span></td>
                                    <td class="text-right">${m.inward_qty > 0 ? formatNumber(m.inward_qty) : '-'}</td>
                                    <td class="text-right">${m.outward_qty > 0 ? formatNumber(m.outward_qty) : '-'}</td>
                                    <td class="text-right"><strong>${formatNumber(m.balance_after)}</strong></td>
                                </tr>
                            `).join('')}
                            ${movements.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-light)">No movements recorded</td></tr>' : ''}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <style>
            .low-stock { color: var(--danger); font-weight: 700; }
            .low-stock-row { background: #fff5f5; }
        </style>
    `;
    // Panel loads its own single getStockLedger call — never blocks the page.
    renderTodaysStock();
}

// ============================================================
// "Today's Stock" daily panel (N16/N44 — presentation only)
// ============================================================
// One call to getStockLedger feeds the day's identity:
//   Opening + Collection/Purchase + Production − Sales − Consumption
//   − Wastage ± Other = Closing
// "Other" is the honest residual (returns, adjustments, reversals,
// opening entries inside the period) derived from the SAME summary, so
// every row balances exactly. Click-through hands the SAME period to the
// Stock Statement screen — same engine, no second stock calculation.

async function renderTodaysStock() {
    const body = document.getElementById('todaysStockBody');
    if (!body) return; // panel not on this page
    const filt = pageFilterInit('stock_todays', { preset: 'today' });
    const fromEl = document.getElementById('tsFrom');
    const toEl = document.getElementById('tsTo');
    if (fromEl) fromEl.value = filt.from || '';
    if (toEl) toEl.value = filt.to || '';
    const label = document.getElementById('tsPeriodLabel');
    if (label) label.textContent = `${filt.from ? formatDate(filt.from) : 'Start'} → ${filt.to ? formatDate(filt.to) : 'Today'}`;

    let res;
    try {
        res = await window.api.getStockLedger({ from_date: filt.from || '', to_date: filt.to || '' });
    } catch (e) {
        res = { success: false, error: e.message };
    }
    if (!res || !res.success) {
        body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--danger)">${escapeHtml((res && res.error) || 'Failed to load stock ledger')}</div>`;
        return;
    }

    const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
    const products = (res.data && res.data.products) || [];
    const rows = [];
    let hidden = 0;
    for (const p of products) {
        const b = p.summary || {};
        const opening = r2(b.opening || 0);
        const collection = r2((b.collection_in || 0) + (b.purchase_in || 0));
        const production = r2(b.production_in || 0);
        const sales = r2(b.sales_out || 0);
        const consumption = r2(b.production_out || 0);
        const wastage = r2(b.wastage_out || 0);
        const closing = r2(b.closing !== undefined && b.closing !== null ? b.closing : p.closing_qty);
        const other = r2((closing - opening) - (collection + production - sales - consumption - wastage));
        const vals = [opening, collection, production, sales, consumption, wastage, other, closing];
        if (vals.every(v => Math.abs(v) < 0.005)) { hidden++; continue; }
        const lhs = r2(r2(r2(opening + collection + production) - r2(sales + consumption + wastage)) + other);
        rows.push({ p, opening, collection, production, sales, consumption, wastage, other, closing, ok: Math.abs(lhs - closing) < 0.01 });
    }

    if (!rows.length) {
        body.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-light)">No stock activity or balances in this period.${hidden ? ` (${hidden} product(s) at zero.)` : ''}</div>`;
        return;
    }

    // Unit subtotals — mixed units are never summed together.
    const units = new Map();
    for (const r of rows) {
        const u = r.p.unit || 'qty';
        let t = units.get(u);
        if (!t) { t = { opening: 0, collection: 0, production: 0, sales: 0, consumption: 0, wastage: 0, other: 0, closing: 0 }; units.set(u, t); }
        for (const k of ['opening', 'collection', 'production', 'sales', 'consumption', 'wastage', 'other', 'closing']) t[k] = r2(t[k] + r[k]);
    }

    const cell = (v) => `<td class="text-right">${Math.abs(v) >= 0.005 ? formatNumber(v) : '<span style="color:var(--text-light)">—</span>'}</td>`;
    const bad = rows.filter(r => !r.ok).length;
    body.innerHTML = `
        <div style="font-size:12px;margin-bottom:6px;${bad ? 'color:var(--danger);font-weight:600' : 'color:#2e7d32'}">
            ${bad ? `⚠ ${bad} row(s) do not balance — run the Data Integrity Doctor` : '✓ Identity holds for every row'}
        </div>
        <div class="table-container" style="max-height:340px;overflow-y:auto">
            <table>
                <thead><tr>
                    <th>Product</th><th>Unit</th>
                    <th class="text-right">Opening</th>
                    <th class="text-right">Collection/Purchase</th>
                    <th class="text-right">Production</th>
                    <th class="text-right">Sales</th>
                    <th class="text-right">Consumption</th>
                    <th class="text-right">Wastage</th>
                    <th class="text-right" title="Returns, adjustments, reversals and opening entries inside the period">Other ±</th>
                    <th class="text-right">Closing</th>
                </tr></thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td><a href="#" onclick="event.preventDefault();tsOpenStatement(${r.p.product_id})" title="Open this product in Stock Statement (detailed ledger)"><strong>${escapeHtml(r.p.product_name)}</strong></a>${r.p.active === 0 ? ' <span class="badge badge-warning">archived</span>' : ''}</td>
                            <td>${escapeHtml(r.p.unit || '')}</td>
                            ${cell(r.opening)}${cell(r.collection)}${cell(r.production)}${cell(r.sales)}${cell(r.consumption)}${cell(r.wastage)}${cell(r.other)}
                            <td class="text-right" style="font-weight:700">${formatNumber(r.closing)}</td>
                        </tr>`).join('')}
                    ${[...units.entries()].map(([u, t]) => `
                        <tr style="background:rgba(0,0,0,0.04);font-weight:700">
                            <td colspan="2">TOTAL (${escapeHtml(u)})</td>
                            ${cell(t.opening)}${cell(t.collection)}${cell(t.production)}${cell(t.sales)}${cell(t.consumption)}${cell(t.wastage)}${cell(t.other)}
                            <td class="text-right">${formatNumber(t.closing)}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>
        <div style="font-size:11px;color:var(--text-light);margin-top:6px">
            ${rows.length} product(s) shown${hidden ? ` · ${hidden} with zero balance and no activity hidden` : ''} · period ${filt.from ? formatDate(filt.from) : 'start'} → ${filt.to ? formatDate(filt.to) : 'today'}
        </div>`;
}

/** Preset/Apply handler — persist the range FIRST, then re-render the panel. */
function refreshTodaysStock() {
    pageFilterSet('stock_todays', {
        from: document.getElementById('tsFrom')?.value || '',
        to: document.getElementById('tsTo')?.value || ''
    });
    renderTodaysStock();
}

/**
 * Click-through: open the Stock Statement with the SAME period (and product
 * when a row was clicked) — the detailed ledger behind this panel.
 */
function tsOpenStatement(productId) {
    const filt = pageFilterInit('stock_todays', { preset: 'today' });
    _ssState.preset = 'custom';
    _ssState.from = filt.from || '';
    _ssState.to = filt.to || '';
    _ssState.view = productId ? 'detail' : 'summary';
    _ssState.product_id = productId ? String(productId) : '';
    _ssState.category = '';
    _ssState.search = '';
    navigateTo('stock-statement');
}

// ============================================================
// Quick Stock Movement (inline form via modal)
// ============================================================
async function showQuickStockMovement() {
    const productsResult = await window.api.getStockCurrent({ active_only: true });
    const products = productsResult.success ? productsResult.data : [];
    const todayStr = today();

    showModal(`
        <div class="modal-header">
            <h2>📦 Record Stock Movement</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="background:linear-gradient(135deg,#fff8e1,#ffecb3);padding:12px 16px;border-radius:8px;margin-bottom:16px;border-left:4px solid #ffc107">
                <div style="font-size:13px;font-weight:600;color:#e65100">💡 Tip</div>
                <div style="font-size:12px;color:#ef6c00;margin-top:2px">Use positive quantity (+) for stock addition (inward) and negative quantity (-) for stock removal (outward).</div>
            </div>
            <form id="quickStockForm">
                <div class="form-group">
                    <label>Product *</label>
                    <select class="form-control" name="product_id" required>
                        <option value="">-- Select Product --</option>
                        ${products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (Current: ${formatNumber(p.current_balance)} ${escapeHtml(p.unit)})</option>`).join('')}
                    </select>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Date *</label>
                        <input type="date" class="form-control" name="date" value="${today}">
                    </div>
                    <div class="form-group">
                        <label>Quantity * (+/-)</label>
                        <input type="number" class="form-control" name="quantity" value="0" step="0.01" placeholder="e.g. 10 or -5" required>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rate (per unit, optional)</label>
                        <input type="number" class="form-control" name="rate" value="0" min="0" step="0.01" placeholder="Leave 0 to keep current rate">
                    </div>
                    <div class="form-group">
                        <label>Movement Type</label>
                        <select class="form-control" name="type">
                            <option value="adjustment">Adjustment</option>
                            <option value="return_in">Return In</option>
                            <option value="return_out">Return Out</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Reason / Notes</label>
                    <input type="text" class="form-control" name="notes" placeholder="e.g. Damaged goods, inventory correction, restock">
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-warning" onclick="saveQuickStockMovement()">📝 Record Movement</button>
        </div>
    `);

    // Live preview of selected product
    const sel = document.querySelector('#quickStockForm select[name="product_id"]');
    if (sel) {
        sel.addEventListener('change', function() {
            const opt = this.options[this.selectedIndex];
            if (opt && opt.value) {
                // Highlight the current stock info
            }
        });
    }
}

async function saveQuickStockMovement() {
    const form = document.getElementById('quickStockForm');
    if (!form) return;
    const formData = new FormData(form);

    const productId = parseInt(formData.get('product_id'));
    const quantity = parseFloat(formData.get('quantity') || 0);
    const rate = parseFloat(formData.get('rate') || 0);
    const notes = formData.get('notes') || 'Quick stock movement';
    const date = formData.get('date') || today();

    if (!productId) {
        showToast('Please select a product', 'error');
        return;
    }
    if (quantity === 0) {
        showToast('Quantity cannot be zero', 'error');
        return;
    }

    const result = await window.api.adjustStock({
        product_id: productId,
        date: date,
        quantity: quantity,
        rate: rate,
        notes: notes
    });

    if (result.success) {
        closeModal();
        showToast('Stock movement recorded successfully!', 'success');
        renderStock();
    } else {
        showToast('Error: ' + (result.error || 'Unknown error'), 'error');
    }
}

function filterStockTable() {
    const search = (document.getElementById('stockSearch')?.value || '').toLowerCase();
    const rows = document.querySelectorAll('#stockTableBody tr');
    let visibleCount = 0;
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const show = text.includes(search);
        row.style.display = show ? '' : 'none';
        if (show) visibleCount++;
    });
    const countEl = document.getElementById('stockSearchCount');
    if (countEl) {
        countEl.textContent = visibleCount < rows.length ? `Showing ${visibleCount} of ${rows.length} products` : '';
    }
}

// ============================================================
// Product Form
// ============================================================
async function showProductForm(productId = null) {
    let product = null;
    if (productId) {
        const result = await window.api.getProduct(productId);
        if (result.success) product = result.data;
    }

    const isEdit = !!product;
    const flag = (key, label) => `
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
            <input type="checkbox" name="${key}" ${!product || product[key] ? 'checked' : ''}> ${label}
        </label>`;

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Product' : 'New Product'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="productForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Product Name</label>
                        <input type="text" class="form-control" name="name" value="${escapeHtml(product ? product.name : '')}" required autofocus>
                    </div>
                    <div class="form-group">
                        <label>Code (SKU)</label>
                        <input type="text" class="form-control" name="code" value="${escapeHtml(product && product.code ? product.code : '')}" placeholder="e.g. MLK-1L" maxlength="30">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Unit</label>
                        <select class="form-control" name="unit">
                            <option value="kg" ${product && product.unit === 'kg' ? 'selected' : ''}>Kg</option>
                            <option value="liter" ${product && product.unit === 'liter' ? 'selected' : ''}>Liter</option>
                            <option value="packet" ${product && product.unit === 'packet' ? 'selected' : ''}>Packet</option>
                            <option value="piece" ${product && product.unit === 'piece' ? 'selected' : ''}>Piece</option>
                            <option value="dozen" ${product && product.unit === 'dozen' ? 'selected' : ''}>Dozen</option>
                            <option value="gram" ${product && product.unit === 'gram' ? 'selected' : ''}>Gram</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <input type="text" class="form-control" name="category" value="${escapeHtml(product ? product.category : '')}" placeholder="e.g. Milk, Curd, Ghee">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Rate (per unit)</label>
                        <input type="number" class="form-control" name="rate" value="${product ? product.rate : 0}" min="0" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Rate Effective From</label>
                        <input type="text" class="form-control" name="rate_effective_from" placeholder="BS date e.g. 2083-07-01" value="${escapeHtml(product && product.rate_effective_from ? product.rate_effective_from : '')}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Reason for rate change</label>
                    <input type="text" class="form-control" name="rate_reason" placeholder="e.g. New rate chart from 1st vs old">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Opening Stock</label>
                        <input type="number" class="form-control" name="opening_stock" value="${product ? product.opening_stock : 0}" min="0" step="0.01" ${isEdit ? 'readonly' : ''}>
                        ${isEdit ? '<small style="color:var(--text-light)">Cannot change opening stock after creation</small>' : ''}
                    </div>
                    <div class="form-group">
                        <label>Reorder Level</label>
                        <input type="number" class="form-control" name="reorder_level" value="${product ? product.reorder_level : 0}" min="0" step="0.01">
                    </div>
                </div>
                <div class="form-group" style="background:var(--bg,#f7f9fc);border-radius:8px;padding:10px 12px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">Where this product may be used</label>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">
                        ${flag('is_stocked', 'Stock tracked (inventory)')}
                        ${flag('is_saleable', 'Sold (sales/invoice)')}
                        ${flag('is_purchaseable', 'Purchased from suppliers')}
                        ${flag('is_produced', 'Produced in plant')}
                    </div>
                    ${isEdit ? `
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-top:8px">
                        <input type="checkbox" name="active" ${product.active !== 0 ? 'checked' : ''}> Active (appears in entry screens)
                    </label>` : ''}
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" name="notes">${escapeHtml(product ? product.notes : '')}</textarea>
                </div>
                ${isEdit ? `
                <div style="text-align:right">
                    <button type="button" class="btn btn-info btn-sm" onclick="viewProductRateHistory(${product.id})">📈 Rate History</button>
                </div>` : ''}
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveProduct(${productId || ''})">💾 ${isEdit ? 'Update' : 'Save Product'}</button>
        </div>
    `);
}

async function saveProduct(productId) {
    const form = document.getElementById('productForm');
    const formData = new FormData(form);
    const num = (k) => {
        const v = formData.get(k);
        return v === null || v === '' ? 0 : parseFloat(v);
    };

    const data = {
        id: productId || null,
        name: formData.get('name'),
        code: formData.get('code') || '',
        unit: formData.get('unit'),
        category: formData.get('category'),
        rate: num('rate'),
        rate_effective_from: formData.get('rate_effective_from') || '',
        rate_reason: formData.get('rate_reason') || '',
        opening_stock: num('opening_stock'),
        reorder_level: num('reorder_level'),
        is_stocked: formData.get('is_stocked') ? 1 : 0,
        is_saleable: formData.get('is_saleable') ? 1 : 0,
        is_purchaseable: formData.get('is_purchaseable') ? 1 : 0,
        is_produced: formData.get('is_produced') ? 1 : 0,
        active: productId ? (formData.get('active') ? 1 : 0) : 1,
        notes: formData.get('notes')
    };

    if (!data.name) {
        showToast('Product name is required', 'error');
        return;
    }
    if (!isFinite(data.rate) || data.rate < 0) {
        showToast('Rate must be a non-negative number', 'error');
        return;
    }

    const result = await window.api.saveProduct(data);
    if (result.success) {
        showToast(`Product ${productId ? 'updated' : 'created'} successfully!`);
        closeModal();
        renderStock();
        clearSettingsCache();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

async function editProduct(id) { showProductForm(id); }

// ============================================================
// Rate History (D9 — rate changes are dated + reasoned, old invoices keep their rate)
// ============================================================
async function viewProductRateHistory(productId) {
    const [productResult, histResult] = await Promise.all([
        window.api.getProduct(productId),
        window.api.getProductRateHistory({ product_id: productId })
    ]);
    const product = productResult.success ? productResult.data : null;
    const rows = histResult.success ? (histResult.data || []) : [];

    showModal(`
        <div class="modal-header">
            <h2>Rate History — ${escapeHtml(product ? product.name : 'Product')}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            ${rows.length === 0 ? '<p style="color:var(--text-light);text-align:center;padding:20px">No rate changes recorded yet.</p>' : `
            <table class="compact">
                <thead><tr><th>Date</th><th class="text-right">Old</th><th class="text-right">New</th><th>Effective From</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>
                    ${rows.map(h => `
                        <tr>
                            <td>${escapeHtml(String(h.created_at || '').slice(0, 10))}</td>
                            <td class="text-right">${formatCurrency(h.old_rate)}</td>
                            <td class="text-right"><strong>${formatCurrency(h.new_rate)}</strong></td>
                            <td>${escapeHtml(h.effective_from || '-')}</td>
                            <td>${escapeHtml(h.reason || '-')}</td>
                            <td>${escapeHtml(h.changed_by_name || '-')}</td>
                        </tr>`).join('')}
                </tbody>
            </table>`}
            <p style="font-size:12px;color:var(--text-light);margin-top:10px">Past sales and purchases keep the rate printed at their own date — a rate change never rewrites an old invoice.</p>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

// ============================================================
// Delete Product (archive when history exists — D7)
// ============================================================
async function deleteProductEntry(id) {
    // Fetch product name for confirmation
    const productResult = await window.api.getProduct(id);
    const productName = productResult.success ? productResult.data.name : 'this product';

    const confirmed = await confirmAction(
        `Delete "${escapeHtml(productName)}"?`,
        'Products with any sales/purchase/stock history are ARCHIVED instead of deleted — they leave every entry screen but their history stays. Products with no history are permanently removed.',
        'Yes, Delete'
    );
    if (!confirmed) return;

    const result = await window.api.deleteProduct(id);
    if (result.success && result.data && result.data.archived) {
        showToast(`"${productName}" archived — history preserved.`, 'success');
        renderStock();
    } else if (result.success) {
        showToast('Product deleted successfully!', 'success');
        renderStock();
    } else {
        showToast('Error: ' + (result.error || 'Cannot delete this product.'), 'error');
    }
}

// ============================================================
// Stock Adjustment
// ============================================================
async function showStockAdjustForm() {
    const productsResult = await window.api.getStockCurrent({ active_only: true });
    const products = productsResult.success ? productsResult.data : [];

    showModal(`
        <div class="modal-header">
            <h2>Stock Adjustment</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="stockAdjustForm">
                <div class="form-group">
                    <label>Product</label>
                    <select class="form-control" name="product_id" required>
                        <option value="">-- Select Product --</option>
                        ${products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (Current: ${formatNumber(p.current_balance)} ${escapeHtml(p.unit)})</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" class="form-control" name="date" value="${today()}">
                </div>
                <div class="form-group">
                    <label>Quantity (+ for addition, - for reduction)</label>
                    <input type="number" class="form-control" name="quantity" value="0" step="0.01" required>
                </div>
                <div class="form-group">
                    <label>Rate (optional)</label>
                    <input type="number" class="form-control" name="rate" value="0" min="0" step="0.01">
                </div>
                <div class="form-group">
                    <label>Reason / Notes</label>
                    <input type="text" class="form-control" name="notes" placeholder="e.g. Damaged goods, inventory correction">
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-warning" onclick="saveStockAdjust()">📝 Apply Adjustment</button>
        </div>
    `);
}

async function saveStockAdjust() {
    const form = document.getElementById('stockAdjustForm');
    const formData = new FormData(form);

    const data = {
        product_id: parseInt(formData.get('product_id')),
        date: formData.get('date') || today(),
        quantity: parseFloat(formData.get('quantity') || 0),
        rate: parseFloat(formData.get('rate') || 0),
        notes: formData.get('notes') || 'Manual adjustment'
    };

    if (!data.product_id) {
        showToast('Please select a product', 'error');
        return;
    }
    if (data.quantity === 0) {
        showToast('Quantity cannot be zero', 'error');
        return;
    }

    const result = await window.api.adjustStock(data);
    if (result.success) {
        showToast('Stock adjusted successfully!');
        closeModal();
        renderStock();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

// ============================================================
// View Product Movement
// ============================================================
async function viewProductMovement(productId) {
    const productResult = await window.api.getProduct(productId);
    const movementsResult = await window.api.getStockMovements({ product_id: productId });

    if (!productResult.success) return;
    const product = productResult.data;
    const movements = movementsResult.success ? movementsResult.data : [];

    showModal(`
        <div class="modal-header">
            <h2>Stock Ledger: ${escapeHtml(product.name)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
                <div class="summary-card card-info" style="margin:0;padding:12px">
                    <span class="label">Unit</span>
                    <span class="value" style="font-size:18px">${escapeHtml(product.unit)}</span>
                </div>
                <div class="summary-card card-success" style="margin:0;padding:12px">
                    <span class="label">Current Stock</span>
                    <span class="value" style="font-size:18px">${formatNumber(movements.length > 0 ? movements[0].balance_after : product.opening_stock)}</span>
                </div>
                <div class="summary-card card-warning" style="margin:0;padding:12px">
                    <span class="label">Rate</span>
                    <span class="value" style="font-size:18px">${formatCurrency(product.rate)}</span>
                </div>
            </div>
            <div class="table-container" style="max-height:400px;overflow-y:auto">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th class="text-right">Inward</th>
                            <th class="text-right">Outward</th>
                            <th class="text-right">Balance</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${movements.map(m => `
                            <tr>
                                <td>${formatDate(m.date)}</td>
                                <td><span class="badge ${m.type === 'purchase' ? 'badge-success' : m.type === 'sale' ? 'badge-danger' : 'badge-info'}">${escapeHtml(m.type)}</span></td>
                                <td class="text-right">${m.inward_qty > 0 ? formatNumber(m.inward_qty) : '-'}</td>
                                <td class="text-right">${m.outward_qty > 0 ? formatNumber(m.outward_qty) : '-'}</td>
                                <td class="text-right"><strong>${formatNumber(m.balance_after)}</strong></td>
                                <td style="font-size:12px;color:var(--text-light)">${escapeHtml(m.notes || '')}</td>
                            </tr>
                        `).join('')}
                        ${movements.length === 0 ? '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-light)">No movements yet</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

// ============================================================
// Print / PDF Stock
// ============================================================
async function printStockList() {
    const [stockResult, movementsResult] = await Promise.all([
        window.api.getStockCurrent(),
        window.api.getStockMovements({})
    ]);

    const stock = stockResult.success ? stockResult.data : [];
    const movements = movementsResult.success ? movementsResult.data : [];
    const stockValue = stock.reduce((s, p) => s + (p.current_balance * p.rate), 0);
    const lowStock = stock.filter(p => p.current_balance <= p.reorder_level && p.reorder_level > 0);
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>Stock &amp; Inventory Report</h2>
            <p>Products: ${stock.length} | Stock Value: ${formatCurrency(stockValue)} | Low Stock Items: ${lowStock.length}</p>
        </div>
        <h3 style="font-size:13px;margin:10px 0 5px">Product List</h3>
        <table>
            <thead><tr><th>Product</th><th>Category</th><th class="text-right">Stock</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Value</th></tr></thead>
            <tbody>
                ${stock.map(p => `<tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td>${escapeHtml(p.category || '-')}</td>
                    <td class="text-right">${formatNumber(p.current_balance)}</td>
                    <td>${escapeHtml(p.unit)}</td>
                    <td class="text-right">${formatCurrency(p.rate)}</td>
                    <td class="text-right">${formatCurrency(p.current_balance * p.rate)}</td>
                </tr>`).join('')}
            </tbody>
        </table>
        <h3 style="font-size:13px;margin:15px 0 5px">Recent Stock Movements (Last 50)</h3>
        <table>
            <thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="text-right">In</th><th class="text-right">Out</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                ${movements.slice(0, 50).map(m => `<tr>
                    <td>${formatDate(m.date)}</td>
                    <td>${escapeHtml(m.product_name)}</td>
                    <td>${escapeHtml(m.type)}</td>
                    <td class="text-right">${m.inward_qty > 0 ? formatNumber(m.inward_qty) : '-'}</td>
                    <td class="text-right">${m.outward_qty > 0 ? formatNumber(m.outward_qty) : '-'}</td>
                    <td class="text-right"><strong>${formatNumber(m.balance_after)}</strong></td>
                </tr>`).join('')}
                ${movements.length === 0 ? '<tr><td colspan="6" style="text-align:center">No movements</td></tr>' : ''}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportStockPDF() {
    const [stockResult, movementsResult] = await Promise.all([
        window.api.getStockCurrent(),
        window.api.getStockMovements({})
    ]);

    const stock = stockResult.success ? stockResult.data : [];
    const movements = movementsResult.success ? movementsResult.data : [];
    const stockValue = stock.reduce((s, p) => s + (p.current_balance * p.rate), 0);
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>Stock &amp; Inventory Report</h2>
            <p>Products: ${stock.length} | Stock Value: ${formatCurrency(stockValue)}</p>
        </div>
        <table>
            <thead><tr><th>Product</th><th>Category</th><th class="text-right">Stock</th><th>Unit</th><th class="text-right">Rate</th></tr></thead>
            <tbody>
                ${stock.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.category || '-')}</td><td class="text-right">${formatNumber(p.current_balance)}</td><td>${escapeHtml(p.unit)}</td><td class="text-right">${formatCurrency(p.rate)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved: ${pdfResult.path}`);
}

// Globals
window.showProductForm = showProductForm;
window.editProduct = editProduct;
window.deleteProductEntry = deleteProductEntry;
window.saveProduct = saveProduct;
window.showStockAdjustForm = showStockAdjustForm;
window.saveStockAdjust = saveStockAdjust;
window.viewProductMovement = viewProductMovement;
window.filterStockTable = filterStockTable;
window.printStockList = printStockList;
window.exportStockPDF = exportStockPDF;
window.showQuickStockMovement = showQuickStockMovement;
window.saveQuickStockMovement = saveQuickStockMovement;
