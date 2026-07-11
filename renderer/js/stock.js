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

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
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
                                    <td><strong>${escapeHtml(p.name)}</strong></td>
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
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

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
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Category</label>
                        <input type="text" class="form-control" name="category" value="${escapeHtml(product ? product.category : '')}" placeholder="e.g. Milk, Curd, Ghee">
                    </div>
                    <div class="form-group">
                        <label>Rate (per unit)</label>
                        <input type="number" class="form-control" name="rate" value="${product ? product.rate : 0}" min="0" step="0.01">
                    </div>
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
                <div class="form-group">
                    <label>Notes</label>
                    <textarea class="form-control" name="notes">${escapeHtml(product ? product.notes : '')}</textarea>
                </div>
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

    const data = {
        id: productId || null,
        name: formData.get('name'),
        unit: formData.get('unit'),
        category: formData.get('category'),
        rate: parseFloat(formData.get('rate') || 0),
        opening_stock: parseFloat(formData.get('opening_stock') || 0),
        reorder_level: parseFloat(formData.get('reorder_level') || 0),
        notes: formData.get('notes')
    };

    if (!data.name) {
        showToast('Product name is required', 'error');
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
// Stock Adjustment
// ============================================================
async function showStockAdjustForm() {
    const productsResult = await window.api.getStockCurrent();
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
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
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
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
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
window.saveProduct = saveProduct;
window.showStockAdjustForm = showStockAdjustForm;
window.saveStockAdjust = saveStockAdjust;
window.viewProductMovement = viewProductMovement;
window.filterStockTable = filterStockTable;
window.printStockList = printStockList;
window.exportStockPDF = exportStockPDF;
