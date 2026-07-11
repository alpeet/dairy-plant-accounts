/**
 * Sales Module
 * Create, edit, delete, print, export PDF for sales invoices
 */

let salesFilter = { search: '', from_date: '', to_date: '' };

async function renderSales() {
    const container = document.getElementById('page-sales');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading sales...</div>';

    // Set top actions
    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary" onclick="showSaleForm()">+ New Sale</button>
        <button class="btn btn-info" onclick="printSalesList()">🖨 Print</button>
        <button class="btn btn-primary" onclick="exportSalesListPDF()">📄 PDF</button>
    `;

    const result = await window.api.getSales(salesFilter);
    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load sales: ${result.error}</div>`;
        return;
    }

    const sales = result.data;

    container.innerHTML = `
        <!-- Filters -->
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Search</label>
                    <input type="text" class="form-control" id="saleSearch" placeholder="Invoice or Party..." value="${escapeHtml(salesFilter.search)}">
                </div>
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="saleFrom" value="${salesFilter.from_date}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="saleTo" value="${salesFilter.to_date}">
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary" onclick="applySaleFilter()">Filter</button>
                    <button class="btn btn-secondary" onclick="resetSaleFilter()">Reset</button>
                </div>
            </div>
        </div>

        <!-- Sales Table -->
        <div class="card">
            <div class="card-header">
                <h2>Sales Invoices</h2>
                <span style="font-size:13px;color:var(--text-light)">${sales.length} entries</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Invoice #</th>
                            <th>Date</th>
                            <th>Party</th>
                            <th>Items</th>
                            <th class="text-right">Total</th>
                            <th class="text-right">Paid</th>
                            <th>Status</th>
                            <th>Payment</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sales.length === 0
                            ? '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--text-light)">No sales found. Create your first sale!</td></tr>'
                            : sales.map(s => `
                                <tr>
                                    <td><strong>${escapeHtml(s.invoice_no)}</strong></td>
                                    <td>${formatDate(s.date)}</td>
                                    <td>${escapeHtml(s.party_name)}</td>
                                    <td class="text-center">${s.item_count || 0}</td>
                                    <td class="text-right">${formatCurrency(s.grand_total)}</td>
                                    <td class="text-right">${formatCurrency(s.paid_amount)}</td>
                                    <td>${statusBadge(s.status)}</td>
                                    <td>${statusBadge(s.payment_mode)}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewSaleDetail(${s.id})" title="View">👁</button>
                                        <button class="btn btn-primary btn-sm" onclick="editSale(${s.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteSale(${s.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
            ${sales.length > 0 ? `
                <div style="padding:12px;text-align:right;font-weight:600;font-size:14px">
                    Total: ${formatCurrency(sales.reduce((s, x) => s + x.grand_total, 0))}
                </div>
            ` : ''}
        </div>
    `;

    // Add event listeners
    document.getElementById('saleSearch')?.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') applySaleFilter();
    });
}

function applySaleFilter() {
    salesFilter.search = document.getElementById('saleSearch')?.value || '';
    salesFilter.from_date = document.getElementById('saleFrom')?.value || '';
    salesFilter.to_date = document.getElementById('saleTo')?.value || '';
    renderSales();
}

function resetSaleFilter() {
    salesFilter = { search: '', from_date: '', to_date: '' };
    renderSales();
}

// ============================================================
// Sale Form (Create / Edit)
// ============================================================
async function showSaleForm(saleId = null) {
    const [productsResult, partiesResult, settings] = await Promise.all([
        window.api.getProducts(),
        window.api.getParties({ type: 'customer' }),
        getSettingsCached()
    ]);

    const products = productsResult.success ? productsResult.data : [];
    const parties = partiesResult.success ? partiesResult.data : [];

    let sale = null;
    let items = [];

    if (saleId) {
        const result = await window.api.getSale(saleId);
        if (result.success && result.data) {
            sale = result.data;
            items = sale.items || [];
        }
    }

    const isEdit = !!sale;

    const businessName = settings.business_name || 'Godhuli Dairy Plant';

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Sale' : 'New Sale Invoice'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="saleForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Invoice No</label>
                        <input type="text" class="form-control" name="invoice_no" value="${escapeHtml(sale ? sale.invoice_no : generateInvoiceNo())}" required>
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" name="date" value="${sale ? sale.date : today()}" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Customer / Party</label>
                    <select class="form-control" name="party_id" required>
                        <option value="">-- Select Party --</option>
                        ${parties.map(p => `<option value="${p.id}" ${sale && sale.party_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                </div>

                <!-- Items Table -->
                <div class="items-table-section">
                    <div class="form-section-title">Invoice Items</div>
                    <table id="saleItemsTable">
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
                        <tbody id="saleItemsBody">
                            ${items.length === 0
                                ? `<tr>
                                    <td>
                                        <select class="form-control sale-product-select" style="font-size:13px">
                                            <option value="">-- Select Product --</option>
                                            ${products.map(p => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}">${escapeHtml(p.name)}</option>`).join('')}
                                        </select>
                                    </td>
                                    <td><input type="number" class="form-control sale-qty" value="1" min="0" step="0.01" style="font-size:13px"></td>
                                    <td><input type="text" class="form-control sale-unit" value="kg" style="font-size:13px"></td>
                                    <td><input type="number" class="form-control sale-rate" value="0" min="0" step="0.01" style="font-size:13px"></td>
                                    <td><input type="number" class="form-control sale-amount" value="0" readonly style="font-size:13px;background:#f5f5f5"></td>
                                    <td></td>
                                </tr>`
                                : items.map((item, idx) => renderSaleItemRow(item, idx, products)).join('')
                            }
                        </tbody>
                    </table>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="addSaleItemRow()" style="margin-top:8px">+ Add Item</button>
                </div>

                <!-- Totals -->
                <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div></div>
                    <div>
                        <div class="form-group">
                            <label>Subtotal</label>
                            <input type="number" class="form-control" name="subtotal" id="saleSubtotal" value="${sale ? sale.subtotal : 0}" readonly style="background:#f5f5f5;font-weight:600">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Discount (%)</label>
                                <input type="number" class="form-control" name="discount_percent" id="saleDiscountPct" value="${sale ? sale.discount_percent : 0}" min="0" max="100" step="0.01">
                            </div>
                            <div class="form-group">
                                <label>Discount Amount</label>
                                <input type="number" class="form-control" name="discount" id="saleDiscount" value="${sale ? sale.discount : 0}" min="0" step="0.01">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Grand Total</label>
                            <input type="number" class="form-control" name="grand_total" id="saleGrandTotal" value="${sale ? sale.grand_total : 0}" readonly style="background:#f5f5f5;font-weight:700;font-size:16px">
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Paid Amount</label>
                                <input type="number" class="form-control" name="paid_amount" id="salePaid" value="${sale ? sale.paid_amount : 0}" min="0" step="0.01">
                            </div>
                            <div class="form-group">
                                <label>Payment Mode</label>
                                <select class="form-control" name="payment_mode">
                                    <option value="cash" ${sale && sale.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
                                    <option value="credit" ${sale && sale.payment_mode === 'credit' ? 'selected' : ''}>Credit</option>
                                    <option value="bank" ${sale && sale.payment_mode === 'bank' ? 'selected' : ''}>Bank</option>
                                    <option value="upi" ${sale && sale.payment_mode === 'upi' ? 'selected' : ''}>UPI</option>
                                </select>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select class="form-control" name="status">
                                <option value="paid" ${sale && sale.status === 'paid' ? 'selected' : ''}>Paid</option>
                                <option value="unpaid" ${sale && sale.status === 'unpaid' ? 'selected' : ''}>Unpaid</option>
                                <option value="partial" ${sale && sale.status === 'partial' ? 'selected' : ''}>Partial</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Notes</label>
                            <textarea class="form-control" name="notes">${escapeHtml(sale ? sale.notes : '')}</textarea>
                        </div>
                    </div>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            ${isEdit ? `<button class="btn btn-info" onclick="printSale(${saleId})">🖨 Print</button>` : ''}
            <button class="btn btn-primary" onclick="saveSale(${saleId || ''})">💾 ${isEdit ? 'Update Sale' : 'Save Sale'}</button>
        </div>
    `);

    // Add auto-calculate listeners
    setupSaleAutoCalc();
}

function renderSaleItemRow(item, idx, products) {
    return `
        <tr>
            <td>
                <select class="form-control sale-product-select" style="font-size:13px" data-index="${idx}">
                    <option value="">-- Select Product --</option>
                    ${products.map(p => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}" ${item.product_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" class="form-control sale-qty" value="${item.quantity}" min="0" step="0.01" style="font-size:13px"></td>
            <td><input type="text" class="form-control sale-unit" value="${escapeHtml(item.unit)}" style="font-size:13px"></td>
            <td><input type="number" class="form-control sale-rate" value="${item.rate}" min="0" step="0.01" style="font-size:13px"></td>
            <td><input type="number" class="form-control sale-amount" value="${item.amount}" readonly style="font-size:13px;background:#f5f5f5"></td>
            <td><button type="button" class="item-remove-btn" onclick="this.closest('tr').remove(); calcSaleTotals();">×</button></td>
        </tr>
    `;
}

function addSaleItemRow() {
    const tbody = document.getElementById('saleItemsBody');
    const products = document.querySelector('.sale-product-select')?.closest('table')?.querySelectorAll('select')?.[0];
    // Get products from the first select's options
    const firstSelect = document.querySelector('.sale-product-select');
    const productsHtml = firstSelect ? firstSelect.innerHTML : '';

    const row = document.createElement('tr');
    row.innerHTML = `
        <td>
            <select class="form-control sale-product-select" style="font-size:13px">
                ${firstSelect ? firstSelect.innerHTML : '<option value="">-- Select Product --</option>'}
            </select>
        </td>
        <td><input type="number" class="form-control sale-qty" value="1" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="text" class="form-control sale-unit" value="kg" style="font-size:13px"></td>
        <td><input type="number" class="form-control sale-rate" value="0" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="number" class="form-control sale-amount" value="0" readonly style="font-size:13px;background:#f5f5f5"></td>
        <td><button type="button" class="item-remove-btn" onclick="this.closest('tr').remove(); calcSaleTotals();">×</button></td>
    `;
    tbody.appendChild(row);
    setupItemListeners(row);
}

function setupSaleAutoCalc() {
    document.querySelectorAll('#saleItemsBody tr').forEach(row => setupItemListeners(row));
    document.getElementById('saleDiscountPct')?.addEventListener('input', calcSaleTotals);
    document.getElementById('saleDiscount')?.addEventListener('input', calcSaleTotals);
    document.getElementById('salePaid')?.addEventListener('input', calcSaleTotals);
    document.querySelectorAll('#saleItemsBody select').forEach(sel => {
        sel.addEventListener('change', function() {
            const option = this.options[this.selectedIndex];
            const row = this.closest('tr');
            if (option.dataset.rate) {
                row.querySelector('.sale-rate').value = option.dataset.rate;
            }
            if (option.dataset.unit) {
                row.querySelector('.sale-unit').value = option.dataset.unit;
            }
            calcSaleTotals();
        });
    });
    calcSaleTotals();
}

function setupItemListeners(row) {
    const qty = row.querySelector('.sale-qty');
    const rate = row.querySelector('.sale-rate');
    const select = row.querySelector('.sale-product-select');

    const calc = () => {
        const amt = row.querySelector('.sale-amount');
        amt.value = (parseFloat(qty?.value || 0) * parseFloat(rate?.value || 0)).toFixed(2);
        calcSaleTotals();
    };

    qty?.addEventListener('input', calc);
    rate?.addEventListener('input', calc);
    if (select) {
        select.addEventListener('change', function() {
            const option = this.options[this.selectedIndex];
            if (option.dataset.rate) rate.value = option.dataset.rate;
            if (option.dataset.unit) row.querySelector('.sale-unit').value = option.dataset.unit;
            calc();
        });
    }
}

function calcSaleTotals() {
    let subtotal = 0;
    document.querySelectorAll('#saleItemsBody .sale-amount').forEach(inp => {
        subtotal += parseFloat(inp.value || 0);
    });

    const discountPct = parseFloat(document.getElementById('saleDiscountPct')?.value || 0);
    let discountAmt = parseFloat(document.getElementById('saleDiscount')?.value || 0);

    // If discount percent is set, calculate from that
    if (discountPct > 0) {
        discountAmt = (subtotal * discountPct) / 100;
        document.getElementById('saleDiscount').value = discountAmt.toFixed(2);
    }

    const grandTotal = subtotal - discountAmt;
    document.getElementById('saleSubtotal').value = subtotal.toFixed(2);
    document.getElementById('saleGrandTotal').value = grandTotal.toFixed(2);
}

// ============================================================
// Save Sale
// ============================================================
async function saveSale(saleId) {
    const form = document.getElementById('saleForm');
    const formData = new FormData(form);

    const items = [];
    const rows = document.querySelectorAll('#saleItemsBody tr');
    rows.forEach(row => {
        const select = row.querySelector('.sale-product-select');
        const productId = parseInt(select?.value);
        if (!productId) return;
        items.push({
            product_id: productId,
            product_name: select?.options[select.selectedIndex]?.text || '',
            name: select?.options[select.selectedIndex]?.text || '',
            quantity: parseFloat(row.querySelector('.sale-qty')?.value || 0),
            unit: row.querySelector('.sale-unit')?.value || 'kg',
            rate: parseFloat(row.querySelector('.sale-rate')?.value || 0),
            amount: parseFloat(row.querySelector('.sale-amount')?.value || 0)
        });
    });

    if (items.length === 0) {
        showToast('Please add at least one item', 'error');
        return;
    }

    const subtotal = parseFloat(document.getElementById('saleSubtotal').value || 0);
    const grandTotal = parseFloat(document.getElementById('saleGrandTotal').value || 0);

    const saleData = {
        id: saleId || null,
        invoice_no: formData.get('invoice_no'),
        date: formData.get('date'),
        party_id: parseInt(formData.get('party_id')),
        items,
        subtotal,
        discount: parseFloat(formData.get('discount') || 0),
        discount_percent: parseFloat(formData.get('discount_percent') || 0),
        tax: 0,
        grand_total: grandTotal,
        paid_amount: parseFloat(formData.get('paid_amount') || 0),
        payment_mode: formData.get('payment_mode'),
        status: formData.get('status'),
        notes: formData.get('notes')
    };

    const result = await window.api.saveSale(saleData);
    if (result.success) {
        showToast(`Sale ${saleId ? 'updated' : 'created'} successfully!`);
        closeModal();
        renderSales();
        clearSettingsCache();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

// ============================================================
// View Sale Detail
// ============================================================
async function viewSaleDetail(id) {
    const result = await window.api.getSale(id);
    if (!result.success || !result.data) {
        showToast('Sale not found', 'error');
        return;
    }

    const s = result.data;
    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';

    showModal(`
        <div class="modal-header">
            <h2>Sale Invoice #${escapeHtml(s.invoice_no)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="text-align:center;margin-bottom:20px;border-bottom:2px solid var(--primary);padding-bottom:12px">
                <h2 style="color:var(--primary)">${escapeHtml(businessName)}</h2>
                <p style="color:var(--text-light);font-size:12px">${escapeHtml(settings.business_address || '')}</p>
            </div>
            <div class="form-row">
                <div>
                    <p><strong>Invoice:</strong> ${escapeHtml(s.invoice_no)}</p>
                    <p><strong>Date:</strong> ${formatDate(s.date)}</p>
                    <p><strong>Status:</strong> ${statusBadge(s.status)}</p>
                </div>
                <div>
                    <p><strong>Party:</strong> ${escapeHtml(s.party_name)}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(s.party_address || '')}</p>
                    <p style="font-size:12px;color:var(--text-light)">${escapeHtml(s.party_phone || '')}</p>
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
                    ${s.items.map((item, i) => `
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
                    <tr><td colspan="5" class="text-right"><strong>Subtotal</strong></td><td class="text-right">${formatCurrency(s.subtotal)}</td></tr>
                    ${s.discount > 0 ? `<tr><td colspan="5" class="text-right"><strong>Discount</strong></td><td class="text-right">-${formatCurrency(s.discount)}</td></tr>` : ''}
                    <tr><td colspan="5" class="text-right"><strong>Grand Total</strong></td><td class="text-right"><strong>${formatCurrency(s.grand_total)}</strong></td></tr>
                    <tr><td colspan="5" class="text-right"><strong>Paid</strong></td><td class="text-right">${formatCurrency(s.paid_amount)}</td></tr>
                    <tr><td colspan="5" class="text-right"><strong>Mode</strong></td><td class="text-right">${statusBadge(s.payment_mode)}</td></tr>
                    ${s.notes ? `<tr><td colspan="6"><strong>Notes:</strong> ${escapeHtml(s.notes)}</td></tr>` : ''}
                </tfoot>
            </table>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="printSale(${s.id})">🖨 Print</button>
            <button class="btn btn-primary" onclick="exportSalePDF(${s.id})">📄 Export PDF</button>
        </div>
    `);
}

// ============================================================
// Edit Sale
// ============================================================
async function editSale(id) {
    showSaleForm(id);
}

// ============================================================
// Delete Sale
// ============================================================
async function deleteSale(id) {
    const result = await window.api.getSale(id);
    if (!result.success || !result.data) return;

    const confirmed = await confirmAction(
        `Delete invoice ${result.data.invoice_no}?`,
        `This will reverse all stock and ledger entries for this sale.`,
        'Yes, Delete',
        'Cancel'
    );

    if (!confirmed) return;

    const delResult = await window.api.deleteSale(id);
    if (delResult.success) {
        showToast('Sale deleted successfully');
        renderSales();
    } else {
        showToast(`Error: ${delResult.error}`, 'error');
    }
}

// ============================================================
// Print Sale
// ============================================================
async function printSale(id) {
    const result = await window.api.getSale(id);
    if (!result.success || !result.data) return;

    const s = result.data;
    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';
    const businessAddress = settings.business_address || '';
    const businessPhone = settings.business_phone || '';

    const html = `
        <div class="header">
            <h1>${escapeHtml(businessName)}</h1>
            <p>${escapeHtml(businessAddress)}</p>
            <p>${escapeHtml(businessPhone)}</p>
            <h2 style="margin-top:10px;font-size:16px">SALE INVOICE</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Invoice No:</strong> ${escapeHtml(s.invoice_no)}</p>
                <p><strong>Date:</strong> ${formatDate(s.date)}</p>
            </div>
            <div>
                <p><strong>Party:</strong> ${escapeHtml(s.party_name)}</p>
                <p>${escapeHtml(s.party_address || '')}</p>
                <p>${escapeHtml(s.party_phone || '')}</p>
            </div>
        </div>
        <table>
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
                ${s.items.map((item, i) => `
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
        </table>
        <div class="summary">
            <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(s.subtotal)}</span></div>
            ${s.discount > 0 ? `<div class="summary-row"><span>Discount:</span><span>-${formatCurrency(s.discount)}</span></div>` : ''}
            <div class="summary-row" style="font-weight:700;font-size:14px"><span>Grand Total:</span><span>${formatCurrency(s.grand_total)}</span></div>
            <div class="summary-row"><span>Paid:</span><span>${formatCurrency(s.paid_amount)}</span></div>
            <div class="summary-row"><span>Status:</span><span>${s.status.toUpperCase()}</span></div>
        </div>
        ${s.notes ? `<p><strong>Notes:</strong> ${escapeHtml(s.notes)}</p>` : ''}
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;

    printHTML(html);
}

// ============================================================
// Export Sale PDF
// ============================================================
async function exportSalePDF(id) {
    const result = await window.api.getSale(id);
    if (!result.success || !result.data) return;

    const s = result.data;
    const settings = await getSettingsCached();
    const businessName = settings.business_name || 'Godhuli Dairy Plant';
    const businessAddress = settings.business_address || '';
    const businessPhone = settings.business_phone || '';

    const html = `
        <div class="header">
            <h1>${escapeHtml(businessName)}</h1>
            <p>${escapeHtml(businessAddress)} | ${escapeHtml(businessPhone)}</p>
            <h2 style="margin-top:10px;font-size:16px">SALE INVOICE</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Invoice No:</strong> ${escapeHtml(s.invoice_no)}</p>
                <p><strong>Date:</strong> ${formatDate(s.date)}</p>
                <p><strong>Status:</strong> ${s.status.toUpperCase()}</p>
            </div>
            <div>
                <p><strong>Party:</strong> ${escapeHtml(s.party_name)}</p>
                <p>${escapeHtml(s.party_address || '')}</p>
                <p>${escapeHtml(s.party_phone || '')}</p>
            </div>
        </div>
        <table>
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
                ${s.items.map((item, i) => `
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
        </table>
        <div class="summary">
            <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(s.subtotal)}</span></div>
            ${s.discount > 0 ? `<div class="summary-row"><span>Discount:</span><span>-${formatCurrency(s.discount)}</span></div>` : ''}
            <div class="summary-row" style="font-weight:700;font-size:14px"><span>Grand Total:</span><span>${formatCurrency(s.grand_total)}</span></div>
            <div class="summary-row"><span>Paid:</span><span>${formatCurrency(s.paid_amount)}</span></div>
        </div>
        <div class="footer">
            <div>Generated: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;

    const pdfResult = await window.api.printToPDF({ html, landscape: false });
    if (pdfResult.success) {
        showToast(`PDF saved to: ${pdfResult.path}`);
    }
}

// ============================================================
// Print / PDF Sales List
// ============================================================
async function printSalesList() {
    const result = await window.api.getSales(salesFilter);
    if (!result.success) return;
    const sales = result.data;
    const settings = await getSettingsCached();
    const total = sales.reduce((s, x) => s + x.grand_total, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Sales Invoice List</h2>
            <p>${sales.length} invoices | Total: ${formatCurrency(total)}</p>
        </div>
        <table>
            <thead><tr><th>Invoice #</th><th>Date</th><th>Party</th><th class="text-right">Total</th><th class="text-right">Paid</th><th>Status</th></tr></thead>
            <tbody>
                ${sales.map(s => `<tr>
                    <td><strong>${escapeHtml(s.invoice_no)}</strong></td>
                    <td>${formatDate(s.date)}</td>
                    <td>${escapeHtml(s.party_name)}</td>
                    <td class="text-right">${formatCurrency(s.grand_total)}</td>
                    <td class="text-right">${formatCurrency(s.paid_amount)}</td>
                    <td>${s.status.toUpperCase()}</td>
                </tr>`).join('')}
                ${sales.length === 0 ? '<tr><td colspan="6" style="text-align:center">No sales found</td></tr>' : ''}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

async function exportSalesListPDF() {
    const result = await window.api.getSales(salesFilter);
    if (!result.success) return;
    const sales = result.data;
    const settings = await getSettingsCached();
    const total = sales.reduce((s, x) => s + x.grand_total, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Sales Invoice List</h2>
            <p>Total: ${formatCurrency(total)} (${sales.length} invoices)</p>
        </div>
        <table>
            <thead><tr><th>Invoice</th><th>Date</th><th>Party</th><th class="text-right">Total</th></tr></thead>
            <tbody>
                ${sales.map(s => `<tr><td>${escapeHtml(s.invoice_no)}</td><td>${formatDate(s.date)}</td><td>${escapeHtml(s.party_name)}</td><td class="text-right">${formatCurrency(s.grand_total)}</td></tr>`).join('')}
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

// Make functions globally accessible
window.showSaleForm = showSaleForm;
window.applySaleFilter = applySaleFilter;
window.resetSaleFilter = resetSaleFilter;
window.viewSaleDetail = viewSaleDetail;
window.editSale = editSale;
window.deleteSale = deleteSale;
window.printSale = printSale;
window.exportSalePDF = exportSalePDF;
window.saveSale = saveSale;
window.addSaleItemRow = addSaleItemRow;
window.calcSaleTotals = calcSaleTotals;
window.printSalesList = printSalesList;
window.exportSalesListPDF = exportSalesListPDF;
