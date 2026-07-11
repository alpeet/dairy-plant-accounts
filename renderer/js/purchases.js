/**
 * Purchases Module
 * Create, edit, delete, print, export PDF for purchase bills
 */

let purchasesFilter = { search: '', from_date: '', to_date: '' };

async function renderPurchases() {
    const container = document.getElementById('page-purchases');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading purchases...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success" onclick="showPurchaseForm()">+ New Purchase</button>
        <button class="btn btn-info" onclick="printPurchasesList()">🖨 Print</button>
        <button class="btn btn-primary" onclick="exportPurchasesListPDF()">📄 PDF</button>
    `;

    const result = await window.api.getPurchases(purchasesFilter);
    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load purchases: ${result.error}</div>`;
        return;
    }

    const purchases = result.data;

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Search</label>
                    <input type="text" class="form-control" id="purchaseSearch" placeholder="Bill No or Party..." value="${escapeHtml(purchasesFilter.search)}">
                </div>
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="purchaseFrom" value="${purchasesFilter.from_date}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="purchaseTo" value="${purchasesFilter.to_date}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary" onclick="applyPurchaseFilter()">Filter</button>
                    <button class="btn btn-secondary" onclick="resetPurchaseFilter()">Reset</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Purchase Bills</h2>
                <span style="font-size:13px;color:var(--text-light)">${purchases.length} entries</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Bill #</th>
                            <th>Date</th>
                            <th>Supplier</th>
                            <th class="text-right">Subtotal</th>
                            <th class="text-right">Charges</th>
                            <th class="text-right">Total</th>
                            <th class="text-right">Paid</th>
                            <th>Status</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${purchases.length === 0
                            ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-light)">No purchases found.</td></tr>'
                            : purchases.map(p => `
                                <tr>
                                    <td><strong>${escapeHtml(p.bill_no)}</strong></td>
                                    <td>${formatDate(p.date)}</td>
                                    <td>${escapeHtml(p.party_name)}</td>
                                    <td class="text-right">${formatCurrency(p.subtotal)}</td>
                                    <td class="text-right">${formatCurrency((p.transport_charges || 0) + (p.extra_charges || 0))}</td>
                                    <td class="text-right">${formatCurrency(p.grand_total)}</td>
                                    <td class="text-right">${formatCurrency(p.paid_amount)}</td>
                                    <td>${statusBadge(p.status)}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewPurchaseDetail(${p.id})" title="View">👁</button>
                                        <button class="btn btn-primary btn-sm" onclick="editPurchase(${p.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deletePurchase(${p.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
            ${purchases.length > 0 ? `
                <div style="padding:12px;text-align:right;font-weight:600;font-size:14px">
                    Total: ${formatCurrency(purchases.reduce((s, x) => s + x.grand_total, 0))}
                </div>
            ` : ''}
        </div>
    `;

    document.getElementById('purchaseSearch')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applyPurchaseFilter();
    });
}

function applyPurchaseFilter() {
    purchasesFilter.search = document.getElementById('purchaseSearch')?.value || '';
    purchasesFilter.from_date = document.getElementById('purchaseFrom')?.value || '';
    purchasesFilter.to_date = document.getElementById('purchaseTo')?.value || '';
    renderPurchases();
}

function resetPurchaseFilter() {
    purchasesFilter = { search: '', from_date: '', to_date: '' };
    renderPurchases();
}

// ============================================================
// Purchase Form
// ============================================================
async function showPurchaseForm(purchaseId = null) {
    const [productsResult, partiesResult, settings] = await Promise.all([
        window.api.getProducts(),
        window.api.getParties({ type: 'supplier' }),
        getSettingsCached()
    ]);

    const products = productsResult.success ? productsResult.data : [];
    const parties = partiesResult.success ? partiesResult.data : [];

    let purchase = null;
    let items = [];

    if (purchaseId) {
        const result = await window.api.getPurchase(purchaseId);
        if (result.success && result.data) {
            purchase = result.data;
            items = purchase.items || [];
        }
    }

    const isEdit = !!purchase;

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Purchase' : 'New Purchase Bill'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="purchaseForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Bill No</label>
                        <input type="text" class="form-control" name="bill_no" value="${escapeHtml(purchase ? purchase.bill_no : generateBillNo())}" required>
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" name="date" value="${purchase ? purchase.date : today()}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Supplier</label>
                    <select class="form-control" name="party_id" required>
                        <option value="">-- Select Supplier --</option>
                        ${parties.map(p => `<option value="${p.id}" ${purchase && purchase.party_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                </div>

                <div class="items-table-section">
                    <div class="form-section-title">Purchase Items</div>
                    <table id="purchaseItemsTable">
                        <thead>
                            <tr>
                                <th style="width:30%">Product</th>
                                <th style="width:12%">Qty</th>
                                <th style="width:12%">Unit</th>
                                <th style="width:15%">Rate</th>
                                <th style="width:15%">Amount</th>
                                <th style="width:6%"></th>
                            </tr>
                        </thead>
                        <tbody id="purchaseItemsBody">
                            ${items.length === 0
                                ? `<tr>
                                    <td>
                                        <select class="form-control purchase-product-select" style="font-size:13px">
                                            <option value="">-- Select Product --</option>
                                            ${products.map(p => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}">${escapeHtml(p.name)}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td><input type="number" class="form-control purchase-qty" value="1" min="0" step="0.01" style="font-size:13px"></td>
                                    <td><input type="text" class="form-control purchase-unit" value="kg" style="font-size:13px"></td>
                                    <td><input type="number" class="form-control purchase-rate" value="0" min="0" step="0.01" style="font-size:13px"></td>
                                    <td><input type="number" class="form-control purchase-amount" value="0" readonly style="font-size:13px;background:#f5f5f5"></td>
                                    <td></td>
                                </tr>`
                                : items.map((item, idx) => renderPurchaseItemRow(item, idx, products)).join('')
                            }
                        </tbody>
                    </table>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addPurchaseItemRow()" style="margin-top:8px">+ Add Item</button>
                </div>

                <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div></div>
                    <div>
                        <div class="form-group">
                            <label>Subtotal</label>
                            <input type="number" class="form-control" name="subtotal" id="purchaseSubtotal" value="${purchase ? purchase.subtotal : 0}" readonly style="background:#f5f5f5;font-weight:600">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Transport Charges</label>
                                <input type="number" class="form-control" name="transport_charges" id="purchaseTransport" value="${purchase ? purchase.transport_charges : 0}" min="0" step="0.01">
                            </div>
                            <div class="form-group">
                                <label>Extra Charges</label>
                                <input type="number" class="form-control" name="extra_charges" id="purchaseExtra" value="${purchase ? purchase.extra_charges : 0}" min="0" step="0.01">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Grand Total</label>
                            <input type="number" class="form-control" name="grand_total" id="purchaseGrandTotal" value="${purchase ? purchase.grand_total : 0}" readonly style="background:#f5f5f5;font-weight:700;font-size:16px">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Paid Amount</label>
                                <input type="number" class="form-control" name="paid_amount" id="purchasePaid" value="${purchase ? purchase.paid_amount : 0}" min="0" step="0.01">
                            </div>
                            <div class="form-group">
                                <label>Payment Mode</label>
                                <select class="form-control" name="payment_mode">
                                    <option value="cash" ${purchase && purchase.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                                    <option value="credit" ${purchase && purchase.payment_mode === 'credit' ? 'selected' : ''}>Credit</option>
                                    <option value="bank" ${purchase && purchase.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                                    <option value="upi" ${purchase && purchase.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select class="form-control" name="status">
                                <option value="paid" ${purchase && purchase.status === 'paid' ? 'selected' : ''}>Paid</option>
                                <option value="unpaid" ${purchase && purchase.status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                                <option value="partial" ${purchase && purchase.status === 'partial' ? 'selected' : ''}>Partial</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Notes</label>
                            <textarea class="form-control" name="notes">${escapeHtml(purchase ? purchase.notes : '')}</textarea>
                        </div>
                    </div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="savePurchase(${purchaseId || ''})">💾 ${isEdit ? 'Update Purchase' : 'Save Purchase'}</button>
        </div>
    `);

    setupPurchaseAutoCalc();
}

function renderPurchaseItemRow(item, idx, products) {
    return `
        <tr>
            <td>
                <select class="form-control purchase-product-select" style="font-size:13px">
                    <option value="">-- Select Product --</option>
                    ${products.map(p => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" class="form-control purchase-qty" value="${item.quantity}" min="0" step="0.01" style="font-size:13px"></td>
            <td><input type="text" class="form-control purchase-unit" value="${escapeHtml(item.unit)}" style="font-size:13px"></td>
            <td><input type="number" class="form-control purchase-rate" value="${item.rate}" min="0" step="0.01" style="font-size:13px"></td>
            <td><input type="number" class="form-control purchase-amount" value="${item.amount}" readonly style="font-size:13px;background:#f5f5f5"></td>
            <td><button type="button" class="item-remove-btn" onclick="this.closest('tr').remove(); calcPurchaseTotals();">×</button></td>
        </tr>
    `;
}

function addPurchaseItemRow() {
    const tbody = document.getElementById('purchaseItemsBody');
    const firstSelect = document.querySelector('.purchase-product-select');

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>
            <select class="form-control purchase-product-select" style="font-size:13px">
                ${firstSelect ? firstSelect.innerHTML : '<option value="">-- Select Product --</option>'}
            </select>
        </td>
        <td><input type="number" class="form-control purchase-qty" value="1" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="text" class="form-control purchase-unit" value="kg" style="font-size:13px"></td>
        <td><input type="number" class="form-control purchase-rate" value="0" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="number" class="form-control purchase-amount" value="0" readonly style="font-size:13px;background:#f5f5f5"></td>
        <td><button type="button" class="item-remove-btn" onclick="this.closest('tr').remove(); calcPurchaseTotals();">×</button></td>
    `;
    tbody.appendChild(row);
    setupPurchaseItemListeners(row);
}

function setupPurchaseAutoCalc() {
    document.querySelectorAll('#purchaseItemsBody tr').forEach(row => setupPurchaseItemListeners(row));
    document.getElementById('purchaseTransport')?.addEventListener('input', calcPurchaseTotals);
    document.getElementById('purchaseExtra')?.addEventListener('input', calcPurchaseTotals);
    calcPurchaseTotals();
}

function setupPurchaseItemListeners(row) {
    const qty = row.querySelector('.purchase-qty');
    const rate = row.querySelector('.purchase-rate');
    const select = row.querySelector('.purchase-product-select');

    const calc = () => {
        const amt = row.querySelector('.purchase-amount');
        amt.value = (parseFloat(qty?.value || 0) * parseFloat(rate?.value || 0)).toFixed(2);
        calcPurchaseTotals();
    };

    qty?.addEventListener('input', calc);
    rate?.addEventListener('input', calc);
    if (select) {
        select.addEventListener('change', function() {
            const option = this.options[this.selectedIndex];
            if (option.dataset.rate) rate.value = option.dataset.rate;
            if (option.dataset.unit) row.querySelector('.purchase-unit').value = option.dataset.unit;
            calc();
        });
    }
}

function calcPurchaseTotals() {
    let subtotal = 0;
    document.querySelectorAll('#purchaseItemsBody .purchase-amount').forEach(inp => {
        subtotal += parseFloat(inp.value || 0);
    });

    const transport = parseFloat(document.getElementById('purchaseTransport')?.value || 0);
    const extra = parseFloat(document.getElementById('purchaseExtra')?.value || 0);

    document.getElementById('purchaseSubtotal').value = subtotal.toFixed(2);
    document.getElementById('purchaseGrandTotal').value = (subtotal + transport + extra).toFixed(2);
}

// ============================================================
// Save Purchase
// ============================================================
async function savePurchase(purchaseId) {
    const form = document.getElementById('purchaseForm');
    const formData = new FormData(form);

    const items = [];
    document.querySelectorAll('#purchaseItemsBody tr').forEach(row => {
        const select = row.querySelector('.purchase-product-select');
        const productId = parseInt(select?.value);
        if (!productId) return;
        items.push({
            product_id: productId,
            product_name: select?.options[select.selectedIndex]?.text || '',
            name: select?.options[select.selectedIndex]?.text || '',
            quantity: parseFloat(row.querySelector('.purchase-qty')?.value || 0),
            unit: row.querySelector('.purchase-unit')?.value || 'kg',
            rate: parseFloat(row.querySelector('.purchase-rate')?.value || 0),
            amount: parseFloat(row.querySelector('.purchase-amount')?.value || 0)
        });
    });

    if (items.length === 0) {
        showToast('Please add at least one item', 'error');
        return;
    }

    const subtotal = parseFloat(document.getElementById('purchaseSubtotal').value || 0);
    const transport = parseFloat(formData.get('transport_charges') || 0);
    const extra = parseFloat(formData.get('extra_charges') || 0);

    const purchaseData = {
        id: purchaseId || null,
        bill_no: formData.get('bill_no'),
        date: formData.get('date'),
        party_id: parseInt(formData.get('party_id')),
        items,
        subtotal,
        discount: 0,
        tax: 0,
        transport_charges: transport,
        extra_charges: extra,
        grand_total: subtotal + transport + extra,
        paid_amount: parseFloat(formData.get('paid_amount') || 0),
        payment_mode: formData.get('payment_mode'),
        status: formData.get('status'),
        notes: formData.get('notes')
    };

    const result = await window.api.savePurchase(purchaseData);
    if (result.success) {
        showToast(`Purchase ${purchaseId ? 'updated' : 'created'} successfully!`);
        closeModal();
        renderPurchases();
        clearSettingsCache();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

// ============================================================
// View Purchase Detail
// ============================================================
async function viewPurchaseDetail(id) {
    const result = await window.api.getPurchase(id);
    if (!result.success || !result.data) {
        showToast('Purchase not found', 'error');
        return;
    }

    const p = result.data;
    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';

    showModal(`
        <div class="modal-header">
            <h2>Purchase Bill #${escapeHtml(p.bill_no)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid var(--primary);padding-bottom:12px">
                <h2 style="color:var(--primary)">${escapeHtml(businessName)}</h2>
            </div>
            <div class="form-row">
                <div>
                    <p><strong>Bill No:</strong> ${escapeHtml(p.bill_no)}</p>
                    <p><strong>Date:</strong> ${formatDate(p.date)}</p>
                    <p><strong>Status:</strong> ${statusBadge(p.status)}</p>
                </div>
                <div>
                    <p><strong>Supplier:</strong> ${escapeHtml(p.party_name)}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(p.party_address || '')}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(p.party_phone || '')}</p>
                </div>
            </div>
            <table style="margin-top:16px">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Product</th>
                        <th class="text-right">Qty</th>
                        <th>Unit</th>
                        <th class="text-right">Rate</th>
                        <th class="text-right">Amount</th>
                    </tr>
                </thead>
                <tbody>
                    ${p.items.map((item, i) => `
                        <tr>
                            <td>${i + 1}</td>
                            <td>${escapeHtml(item.product_name)}</td>
                            <td class="text-right">${formatNumber(item.quantity)}</td>
                            <td>${escapeHtml(item.unit)}</td>
                            <td class="text-right">${formatCurrency(item.rate)}</td>
                            <td class="text-right">${formatCurrency(item.amount)}</td>
                        </tr>
                    `).join('')}
                </tbody>
                <tfoot>
                    <tr><td colspan="5" class="text-right"><strong>Subtotal</strong></td><td class="text-right">${formatCurrency(p.subtotal)}</td></tr>
                    ${(p.transport_charges || 0) > 0 ? `<tr><td colspan="5" class="text-right"><strong>Transport</strong></td><td class="text-right">${formatCurrency(p.transport_charges)}</td></tr>` : ''}
                    ${(p.extra_charges || 0) > 0 ? `<tr><td colspan="5" class="text-right"><strong>Extra</strong></td><td class="text-right">${formatCurrency(p.extra_charges)}</td></tr>` : ''}
                    <tr><td colspan="5" class="text-right"><strong>Grand Total</strong></td><td class="text-right"><strong>${formatCurrency(p.grand_total)}</strong></td></tr>
                    <tr><td colspan="5" class="text-right"><strong>Paid</strong></td><td class="text-right">${formatCurrency(p.paid_amount)}</td></tr>
                    ${p.notes ? `<tr><td colspan="6"><strong>Notes:</strong> ${escapeHtml(p.notes)}</td></tr>` : ''}
                </tfoot>
            </table>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printPurchase(${p.id})">🖨 Print</button>
            <button class="btn btn-primary" onclick="exportPurchasePDF(${p.id})">📄 Export PDF</button>
        </div>
    `);
}

// ============================================================
// Edit / Delete
// ============================================================
async function editPurchase(id) { showPurchaseForm(id); }

async function deletePurchase(id) {
    const result = await window.api.getPurchase(id);
    if (!result.success || !result.data) return;

    const confirmed = await confirmAction(
        `Delete bill ${result.data.bill_no}?`,
        'This will reverse all stock and ledger entries.',
        'Yes, Delete'
    );

    if (!confirmed) return;

    const delResult = await window.api.deletePurchase(id);
    if (delResult.success) {
        showToast('Purchase deleted successfully');
        renderPurchases();
    } else {
        showToast(`Error: ${delResult.error}`, 'error');
    }
}

// ============================================================
// Print Purchase
// ============================================================
async function printPurchase(id) {
    const result = await window.api.getPurchase(id);
    if (!result.success || !result.data) return;
    const p = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <p>${escapeHtml(settings.business_address || '')} | ${escapeHtml(settings.business_phone || '')}</p>
            <h2 style="margin-top:10px;font-size:16px">PURCHASE BILL</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Bill No:</strong> ${escapeHtml(p.bill_no)}</p>
                <p><strong>Date:</strong> ${formatDate(p.date)}</p>
            </div>
            <div>
                <p><strong>Supplier:</strong> ${escapeHtml(p.party_name)}</p>
                <p>${escapeHtml(p.party_address || '')} | ${escapeHtml(p.party_phone || '')}</p>
            </div>
        </div>
        <table>
            <thead><tr><th>#</th><th>Product</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
                ${p.items.map((item, i) => `<tr><td>${i+1}</td><td>${escapeHtml(item.product_name)}</td><td class="text-right">${formatNumber(item.quantity)}</td><td>${escapeHtml(item.unit)}</td><td class="text-right">${formatCurrency(item.rate)}</td><td class="text-right">${formatCurrency(item.amount)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="summary">
            <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(p.subtotal)}</span></div>
            ${(p.transport_charges||0) > 0 ? `<div class="summary-row"><span>Transport:</span><span>${formatCurrency(p.transport_charges)}</span></div>` : ''}
            ${(p.extra_charges||0) > 0 ? `<div class="summary-row"><span>Extra:</span><span>${formatCurrency(p.extra_charges)}</span></div>` : ''}
            <div class="summary-row" style="font-weight:700;font-size:14px"><span>Grand Total:</span><span>${formatCurrency(p.grand_total)}</span></div>
        </div>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

// ============================================================
// Export Purchase PDF
// ============================================================
async function exportPurchasePDF(id) {
    const result = await window.api.getPurchase(id);
    if (!result.success || !result.data) return;
    const p = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <p>${escapeHtml(settings.business_address || '')} | ${escapeHtml(settings.business_phone || '')}</p>
            <h2 style="margin-top:10px;font-size:16px">PURCHASE BILL</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div><p><strong>Bill No:</strong> ${escapeHtml(p.bill_no)}</p><p><strong>Date:</strong> ${formatDate(p.date)}</p></div>
            <div><p><strong>Supplier:</strong> ${escapeHtml(p.party_name)}</p></div>
        </div>
        <table>
            <thead><tr><th>#</th><th>Product</th><th class="text-right">Qty</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
                ${p.items.map((item, i) => `<tr><td>${i+1}</td><td>${escapeHtml(item.product_name)}</td><td class="text-right">${formatNumber(item.quantity)}</td><td>${escapeHtml(item.unit)}</td><td class="text-right">${formatCurrency(item.rate)}</td><td class="text-right">${formatCurrency(item.amount)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="summary">
            <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(p.subtotal)}</span></div>
            ${(p.transport_charges||0) > 0 ? `<div class="summary-row"><span>Transport:</span><span>${formatCurrency(p.transport_charges)}</span></div>` : ''}
            ${(p.extra_charges||0) > 0 ? `<div class="summary-row"><span>Extra:</span><span>${formatCurrency(p.extra_charges)}</span></div>` : ''}
            <div class="summary-row" style="font-weight:700;font-size:14px"><span>Grand Total:</span><span>${formatCurrency(p.grand_total)}</span></div>
            <div class="summary-row"><span>Paid:</span><span>${formatCurrency(p.paid_amount)}</span></div>
        </div>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;

    const pdfResult = await window.api.printToPDF({ html });
    if (pdfResult.success) showToast(`PDF saved to: ${pdfResult.path}`);
}

// ============================================================
// Print / PDF Purchases List
// ============================================================
async function printPurchasesList() {
    const result = await window.api.getPurchases(purchasesFilter);
    if (!result.success) return;
    const purchases = result.data;
    const settings = await getSettingsCached();
    const total = purchases.reduce((s, x) => s + x.grand_total, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Purchase Bills List</h2>
            <p>${purchases.length} bills | Total: ${formatCurrency(total)}</p>
        </div>
        <table>
            <thead><tr><th>Bill #</th><th>Date</th><th>Supplier</th><th class="text-right">Total</th><th class="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>
                ${purchases.map(p => `<tr>
                    <td><strong>${escapeHtml(p.bill_no)}</strong></td>
                    <td>${formatDate(p.date)}</td>
                    <td>${escapeHtml(p.party_name)}</td>
                    <td class="text-right">${formatCurrency(p.grand_total)}</td>
                    <td class="text-right">${formatCurrency(p.paid_amount)}</td>
                    <td>${p.status.toUpperCase()}</td>
                </tr>`).join('')}
                ${purchases.length === 0 ? '<tr><td colspan="6" style="text-align:center">No purchases found</td></tr>' : ''}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportPurchasesListPDF() {
    const result = await window.api.getPurchases(purchasesFilter);
    if (!result.success) return;
    const purchases = result.data;
    const settings = await getSettingsCached();
    const total = purchases.reduce((s, x) => s + x.grand_total, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Purchase Bills List</h2>
            <p>Total: ${formatCurrency(total)} (${purchases.length} bills)</p>
        </div>
        <table>
            <thead><tr><th>Bill</th><th>Date</th><th>Supplier</th><th class="text-right">Total</th></tr></thead>
            <tbody>
                ${purchases.map(p => `<tr><td>${escapeHtml(p.bill_no)}</td><td>${formatDate(p.date)}</td><td>${escapeHtml(p.party_name)}</td><td class="text-right">${formatCurrency(p.grand_total)}</td></tr>`).join('')}
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
window.showPurchaseForm = showPurchaseForm;
window.applyPurchaseFilter = applyPurchaseFilter;
window.resetPurchaseFilter = resetPurchaseFilter;
window.viewPurchaseDetail = viewPurchaseDetail;
window.editPurchase = editPurchase;
window.deletePurchase = deletePurchase;
window.savePurchase = savePurchase;
window.addPurchaseItemRow = addPurchaseItemRow;
window.calcPurchaseTotals = calcPurchaseTotals;
window.printPurchase = printPurchase;
window.exportPurchasePDF = exportPurchasePDF;
window.printPurchasesList = printPurchasesList;
window.exportPurchasesListPDF = exportPurchasesListPDF;
