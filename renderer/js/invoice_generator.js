/**
 * Invoice Generation Module
 * =========================
 * Dedicated TAX INVOICE generator (mirrors the Excel "Printable_Invoice" sheet):
 * - Build an invoice with customer, product lines, discount & payment details
 * - Live TAX INVOICE preview (business header, PAN, amount in words, terms)
 * - Saves through the normal sales pipeline (stock + ledger + statements)
 * - Print / PDF of the generated invoice
 *
 * Reuses helpers: generateInvoiceNo (sales.js), numberToWords (salary.js),
 * printHTML (utils.js). Item rows are self-contained via addInvoiceItemRow().
 */

let invoiceBuilderState = {
    lastSavedId: null,
    lastSavedInvoiceNo: null
};

// Shared signature block: image (if configured) above the "Authorized Signature" line,
// with signatory name/title beneath. Used by preview, print and email.
// opts.cid: when set, the image is referenced as <img src="cid:..."> (for emails —
// Gmail strips data: URIs, so the image travels as an inline attachment instead).
function buildSignatureBlockHtml(settings, opts = {}) {
    const imgSrc = opts.cid ? `cid:${opts.cid}` : (settings.signature_image || '');
    const img = settings.signature_image
        ? `<img src="${imgSrc}" alt="Authorized Signature" style="max-height:56px;max-width:180px;display:block;margin:0 auto 2px;object-fit:contain">`
        : '<div style="height:40px"></div>';
    const name = settings.signature_name
        ? `<div style="font-weight:600;font-size:12px">${escapeHtml(settings.signature_name)}</div>`
        : '';
    const title = settings.signature_title
        ? `<div style="font-size:11px;color:#444">${escapeHtml(settings.signature_title)}</div>`
        : '';
    return `
        <div style="min-width:160px;text-align:center;${opts.extra || ''}">
            ${img}
            <div style="border-top:1px solid #111;padding-top:2px">Authorized Signature</div>
            ${name}
            ${title}
        </div>
    `;
}

async function renderInvoiceGenerator() {
    const container = document.getElementById('page-invoice-generator');
    document.getElementById('topActions').innerHTML = '';

    // Prefill from a just-saved invoice (keeps the form after "Save & New")
    const st = invoiceBuilderState;
    const [productsResult, partiesResult, settings] = await Promise.all([
        window.api.getProducts(),
        window.api.getParties({ type: 'customer' }),
        getSettingsCached()
    ]);

    const products = productsResult.success ? productsResult.data : [];
    const parties = partiesResult.success ? partiesResult.data : [];
    const invoiceNo = generateInvoiceNo();

    container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
            <!-- LEFT: builder form -->
            <div class="card" style="padding:16px">
                <div class="card-header" style="margin-bottom:8px">
                    <h2>🧾 Generate Tax Invoice</h2>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Invoice No</label>
                        <input type="text" class="form-control" id="invNo" value="${escapeHtml(st.lastSavedInvoiceNo ? generateInvoiceNo() : invoiceNo)}">
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" id="invDate" value="${today()}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Customer</label>
                    <select class="form-control" id="invParty">
                        <option value="">-- Select Customer --</option>
                        ${parties.map(p => `<option value="${p.id}" data-addr="${escapeHtml(p.address || '')}" data-phone="${escapeHtml(p.phone || '')}" data-pan="${escapeHtml(p.pan_vat || '')}">${escapeHtml(p.name)}${p.pan_vat ? ' (PAN ' + escapeHtml(p.pan_vat) + ')' : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Customer Address / Phone (optional override)</label>
                    <input type="text" class="form-control" id="invAddr" placeholder="Address / Phone printed on the invoice">
                </div>

                <div class="form-section-title">Items</div>
                <table id="saleItemsTable">
                    <thead><tr><th style="width:34%">Product</th><th style="width:12%">Qty</th><th style="width:12%">Unit</th><th style="width:14%">Rate</th><th style="width:15%">Amount</th><th style="width:6%"></th></tr></thead>
                    <tbody id="saleItemsBody"></tbody>
                </table>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addInvoiceItemRow()" style="margin-top:8px">+ Add Item</button>

                <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div>
                        <div class="form-group">
                            <label>Discount (%)</label>
                            <input type="number" class="form-control" id="invDiscountPct" value="0" min="0" max="100" step="0.01" oninput="calcInvoiceTotals()">
                        </div>
                        <div class="form-group">
                            <label>Discount Amount</label>
                            <input type="number" class="form-control" id="invDiscount" value="0" min="0" step="0.01" oninput="calcInvoiceTotals()">
                        </div>
                    </div>
                    <div>
                        <div class="form-group">
                            <label>Subtotal</label>
                            <input type="number" class="form-control" id="invSubtotal" value="0" readonly style="background:#f5f5f5;font-weight:600">
                        </div>
                        <div class="form-group">
                            <label>Grand Total</label>
                            <input type="number" class="form-control" id="invGrandTotal" value="0" readonly style="background:#f5f5f5;font-weight:700;font-size:16px">
                        </div>
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label>Paid Amount</label>
                        <input type="number" class="form-control" id="invPaid" value="0" min="0" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Payment Mode</label>
                        <select class="form-control" id="invMode">
                            <option value="cash">Cash</option>
                            <option value="credit">Credit</option>
                            <option value="bank">Bank</option>
                            <option value="upi">UPI</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Status</label>
                        <select class="form-control" id="invStatus">
                            <option value="paid">Paid</option>
                            <option value="unpaid">Unpaid</option>
                            <option value="partial">Partial</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Notes / Terms override</label>
                        <input type="text" class="form-control" id="invNotes" placeholder="Optional notes">
                    </div>
                </div>

                <div class="btn-group" style="margin-top:12px">
                    <button class="btn btn-primary" onclick="saveGeneratedInvoice(false)">💾 Save Invoice</button>
                    <button class="btn btn-success" onclick="saveGeneratedInvoice(true)">💾 Save & Print</button>
                    <button class="btn btn-info" onclick="showEmailInvoiceDialog()">✉️ Email Invoice</button>
                    <button class="btn btn-secondary" onclick="resetInvoiceBuilder()">Clear</button>
                </div>
                <p style="font-size:11px;color:var(--text-light);margin-top:6px">✉️ Email Invoice sends the current invoice (with the authorized signature) as a formatted email. The invoice is not saved automatically — save it first for your records.</p>
            </div>

            <!-- RIGHT: live preview -->
            <div class="card" style="padding:16px">
                <div class="card-header" style="margin-bottom:8px">
                    <h2>👁 Preview</h2>
                </div>
                <div id="invoicePreview"></div>
            </div>
        </div>
    `;

    // Seed one empty item row and stash products/settings for row builders
    window._invProducts = products;
    window._invSettings = settings;
    addInvoiceItemRow();

    // Live preview + totals on any change inside the builder
    container.addEventListener('input', onInvoiceBuilderInput);
    container.addEventListener('change', onInvoiceBuilderInput);
    updateInvoicePreview();

    // Re-init BS date pickers inside this fresh section
    if (typeof refreshBSDateInputs === 'function') refreshBSDateInputs(container);
}

function onInvoiceBuilderInput() {
    calcInvoiceTotals();
    updateInvoicePreview();
}

// Shared listeners for item rows in the invoice builder:
// mirrors sales.js setupItemListeners but calls the invoice preview instead of calcSaleTotals.
function setupInvoiceItemListeners(row) {
    const qty = row.querySelector('.sale-qty');
    const rate = row.querySelector('.sale-rate');
    const select = row.querySelector('.sale-product-select');

    const calc = () => {
        const amt = row.querySelector('.sale-amount');
        amt.value = (parseFloat(qty?.value || 0) * parseFloat(rate?.value || 0)).toFixed(2);
        calcInvoiceTotals();
        updateInvoicePreview();
    };

    qty?.addEventListener('input', calc);
    rate?.addEventListener('input', calc);
    if (select) {
        select.addEventListener('change', function () {
            const option = this.options[this.selectedIndex];
            if (option.dataset.rate) rate.value = option.dataset.rate;
            if (option.dataset.unit) row.querySelector('.sale-unit').value = option.dataset.unit;
            calc();
        });
    }
}

// Local row-adder for the invoice builder (works without the sales modal present).
function addInvoiceItemRow() {
    const tbody = document.getElementById('saleItemsBody');
    if (!tbody) return;
    const firstSelect = document.querySelector('.sale-product-select');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>
            <select class="form-control sale-product-select" style="font-size:13px">
                ${firstSelect ? firstSelect.innerHTML : (window._invProducts || []).map(p => `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
        </td>
        <td><input type="number" class="form-control sale-qty" value="1" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="text" class="form-control sale-unit" value="kg" style="font-size:13px"></td>
        <td><input type="number" class="form-control sale-rate" value="0" min="0" step="0.01" style="font-size:13px"></td>
        <td><input type="number" class="form-control sale-amount" value="0" readonly style="font-size:13px;background:#f5f5f5"></td>
        <td><button type="button" class="item-remove-btn" onclick="this.closest('tr').remove(); calcInvoiceTotals(); updateInvoicePreview();">×</button></td>
    `;
    tbody.appendChild(row);
    setupInvoiceItemListeners(row);
}
window.addInvoiceItemRow = addInvoiceItemRow;

function _invProductOptionsHtml(selectedId) {
    // Rebuild the product options exactly like sales.js rows
    return window._invProducts ? window._invProducts.map(p =>
        `<option value="${p.id}" data-name="${escapeHtml(p.name)}" data-unit="${escapeHtml(p.unit)}" data-rate="${p.rate}" ${selectedId === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('') : '';
}

function calcInvoiceTotals() {
    let subtotal = 0;
    document.querySelectorAll('#saleItemsBody tr').forEach(row => {
        const qty = parseFloat(row.querySelector('.sale-qty')?.value || 0);
        const rate = parseFloat(row.querySelector('.sale-rate')?.value || 0);
        const amount = qty * rate;
        const amtEl = row.querySelector('.sale-amount');
        if (amtEl) amtEl.value = amount.toFixed(2);
        subtotal += amount;
    });
    const discPct = parseFloat(document.getElementById('invDiscountPct')?.value || 0);
    const discAmt = parseFloat(document.getElementById('invDiscount')?.value || 0);
    let grand = subtotal;
    if (discPct > 0 && discAmt === 0) grand = subtotal * (1 - discPct / 100);
    else grand = subtotal - discAmt;
    const st = document.getElementById('invSubtotal'); if (st) st.value = subtotal.toFixed(2);
    const gt = document.getElementById('invGrandTotal'); if (gt) gt.value = grand.toFixed(2);
    return { subtotal, grand };
}

function updateInvoicePreview() {
    const preview = document.getElementById('invoicePreview');
    if (!preview) return;

    const settings = window._invSettings || {};
    const partySel = document.getElementById('invParty');
    const partyName = partySel && partySel.value
        ? partySel.options[partySel.selectedIndex]?.text.replace(/\s*\(PAN.*\)$/, '')
        : '[Customer Name]';
    const opt = partySel && partySel.value ? partySel.options[partySel.selectedIndex] : null;
    const addr = (document.getElementById('invAddr')?.value || '').trim() ||
        (opt ? (opt.dataset.addr || '') + (opt.dataset.phone ? ' | ' + opt.dataset.phone : '') : '') || '[Address] | [Phone]';
    const invNo = document.getElementById('invNo')?.value || '';
    const date = document.getElementById('invDate')?.value || '';

    const items = [];
    document.querySelectorAll('#saleItemsBody tr').forEach(row => {
        const sel = row.querySelector('.sale-product-select');
        const name = sel && sel.value ? sel.options[sel.selectedIndex]?.text : '';
        const qty = parseFloat(row.querySelector('.sale-qty')?.value || 0);
        const unit = row.querySelector('.sale-unit')?.value || 'kg';
        const rate = parseFloat(row.querySelector('.sale-rate')?.value || 0);
        if (name) items.push({ name, qty, unit, rate, amount: qty * rate });
    });

    const { subtotal, grand } = calcInvoiceTotals();

    preview.innerHTML = `
        <div style="border:1px solid var(--border);border-radius:8px;padding:18px;background:#fff;color:#111">
            <div style="text-align:center;border-bottom:2px solid #111;padding-bottom:10px">
                <h1 style="margin:0;font-size:20px">${escapeHtml(settings.business_name || 'PRARAMBHA DAIRY SUPPLIERS')}</h1>
                <div style="font-size:12px">${escapeHtml(settings.business_address || '')}</div>
                <div style="font-size:12px">Phone: ${escapeHtml(settings.business_phone || '')} &nbsp;|&nbsp; PAN/VAT: ${escapeHtml(settings.business_pan_vat || settings.pan_vat || '152747352')}</div>
            </div>
            <div style="text-align:center;margin:10px 0;font-weight:700;letter-spacing:2px">TAX INVOICE</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
                <div>
                    <div><strong>Invoice No:</strong> ${escapeHtml(invNo)}</div>
                    <div><strong>Date:</strong> ${date ? (typeof formatDateNP === 'function' ? formatDateNP(date) : date) : ''}</div>
                </div>
                <div style="text-align:right">
                    <div><strong>Customer:</strong> ${escapeHtml(partyName)}</div>
                    <div>${escapeHtml(addr)}</div>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#f0f0f0">
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">#</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">Product Name</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Quantity</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">Unit</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Rate</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Amount</th>
                </tr></thead>
                <tbody>
                    ${items.length === 0 ? '<tr><td colspan="6" style="border:1px solid #ccc;padding:8px;text-align:center;color:#888">Add items to see them here</td></tr>' :
                    items.map((it, i) => `<tr>
                        <td style="border:1px solid #ccc;padding:6px">${i + 1}</td>
                        <td style="border:1px solid #ccc;padding:6px">${escapeHtml(it.name)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${it.qty}</td>
                        <td style="border:1px solid #ccc;padding:6px">${escapeHtml(it.unit)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(it.rate)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(it.amount)}</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot>
                    <tr><td colspan="5" style="border:1px solid #ccc;padding:6px;text-align:right"><strong>Subtotal</strong></td><td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(subtotal)}</td></tr>
                    <tr><td colspan="5" style="border:1px solid #ccc;padding:6px;text-align:right"><strong>Grand Total</strong></td><td style="border:1px solid #ccc;padding:6px;text-align:right"><strong>${formatCurrency(grand)}</strong></td></tr>
                </tfoot>
            </table>
            <div style="font-size:12px;margin-top:10px">
                <strong>Amount in Words:</strong> ${typeof numberToWords === 'function' ? escapeHtml(numberToWords(Math.round(grand))) : ''} rupees only
            </div>
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;font-size:12px">
                <div>Terms: Goods once sold not returnable. Payment due within 15 days.</div>
                ${buildSignatureBlockHtml(settings)}
            </div>
        </div>
    `;
}

function buildInvoicePrintHtml() {
    const settings = window._invSettings || {};
    const partySel = document.getElementById('invParty');
    const partyName = partySel && partySel.value ? partySel.options[partySel.selectedIndex]?.text.replace(/\s*\(PAN.*\)$/, '') : '';
    const opt = partySel && partySel.value ? partySel.options[partySel.selectedIndex] : null;
    const addr = (document.getElementById('invAddr')?.value || '').trim() ||
        (opt ? (opt.dataset.addr || '') + (opt.dataset.phone ? ' | ' + opt.dataset.phone : '') : '');
    const invNo = document.getElementById('invNo')?.value || '';
    const date = document.getElementById('invDate')?.value || '';
    const items = [];
    document.querySelectorAll('#saleItemsBody tr').forEach(row => {
        const sel = row.querySelector('.sale-product-select');
        const name = sel && sel.value ? sel.options[sel.selectedIndex]?.text : '';
        const qty = parseFloat(row.querySelector('.sale-qty')?.value || 0);
        const unit = row.querySelector('.sale-unit')?.value || 'kg';
        const rate = parseFloat(row.querySelector('.sale-rate')?.value || 0);
        if (name) items.push({ name, qty, unit, rate, amount: qty * rate });
    });
    const { subtotal, grand } = calcInvoiceTotals();
    const paid = parseFloat(document.getElementById('invPaid')?.value || 0);

    return `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'PRARAMBHA DAIRY SUPPLIERS')}</h1>
            <p>${escapeHtml(settings.business_address || '')}</p>
            <p>Phone: ${escapeHtml(settings.business_phone || '')} | PAN/VAT: ${escapeHtml(settings.business_pan_vat || settings.pan_vat || '152747352')}</p>
            <h2 style="margin-top:10px;font-size:16px;letter-spacing:2px">TAX INVOICE</h2>
        </div>
        <div style="display:flex;justify-content:space-between;margin:10px 0">
            <div>
                <p><strong>Invoice No:</strong> ${escapeHtml(invNo)}</p>
                <p><strong>Date:</strong> ${date ? (typeof formatDateNP === 'function' ? formatDateNP(date) : date) : ''}</p>
            </div>
            <div style="text-align:right">
                <p><strong>Customer:</strong> ${escapeHtml(partyName)}</p>
                <p>${escapeHtml(addr)}</p>
            </div>
        </div>
        <table>
            <thead><tr><th>#</th><th>Product Name</th><th class="text-right">Quantity</th><th>Unit</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
                ${items.map((it, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(it.name)}</td><td class="text-right">${it.qty}</td><td>${escapeHtml(it.unit)}</td><td class="text-right">${formatCurrency(it.rate)}</td><td class="text-right">${formatCurrency(it.amount)}</td></tr>`).join('')}
            </tbody>
        </table>
        <div class="summary">
            <div class="summary-row"><span>Subtotal:</span><span>${formatCurrency(subtotal)}</span></div>
            <div class="summary-row" style="font-weight:700;font-size:14px"><span>Grand Total:</span><span>${formatCurrency(grand)}</span></div>
            <div class="summary-row"><span>Paid:</span><span>${formatCurrency(paid)}</span></div>
        </div>
        <p><strong>Amount in Words:</strong> ${typeof numberToWords === 'function' ? escapeHtml(numberToWords(Math.round(grand))) : ''} rupees only</p>
        <div class="footer">
            <div>Terms: Goods once sold not returnable. Payment due within 15 days.</div>
            ${buildSignatureBlockHtml(settings)}
        </div>
    `;
}

async function saveGeneratedInvoice(printAfter) {
    const partyId = parseInt(document.getElementById('invParty')?.value || 0);
    if (!partyId) { showToast('Please select a customer', 'warning'); return; }

    const items = [];
    document.querySelectorAll('#saleItemsBody tr').forEach(row => {
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
    if (items.length === 0) { showToast('Please add at least one item', 'error'); return; }

    const subtotal = parseFloat(document.getElementById('invSubtotal')?.value || 0);
    const grand = parseFloat(document.getElementById('invGrandTotal')?.value || 0);
    const paid = parseFloat(document.getElementById('invPaid')?.value || 0);
    const status = document.getElementById('invStatus')?.value || (paid >= grand ? 'paid' : paid > 0 ? 'partial' : 'unpaid');

    const saleData = {
        invoice_no: document.getElementById('invNo')?.value || generateInvoiceNo(),
        date: document.getElementById('invDate')?.value || today(),
        party_id: partyId,
        items,
        subtotal,
        discount: parseFloat(document.getElementById('invDiscount')?.value || 0),
        discount_percent: parseFloat(document.getElementById('invDiscountPct')?.value || 0),
        tax: 0,
        grand_total: grand,
        paid_amount: paid,
        payment_mode: document.getElementById('invMode')?.value || 'cash',
        status,
        notes: document.getElementById('invNotes')?.value || ''
    };

    const result = await window.api.saveSale(saleData);
    if (!result.success) { showToast(result.error || 'Failed to save invoice', 'error'); return; }

    invoiceBuilderState.lastSavedId = result.data && result.data.id ? result.data.id : null;
    invoiceBuilderState.lastSavedInvoiceNo = saleData.invoice_no;
    showToast('Invoice ' + saleData.invoice_no + ' saved — stock & ledger updated', 'success');
    clearSettingsCache();

    if (printAfter) {
        printHTML(buildInvoicePrintHtml());
    } else {
        // Reset the form for the next invoice but keep the preview fresh
        renderInvoiceGenerator();
    }
}

function resetInvoiceBuilder() {
    invoiceBuilderState = { lastSavedId: null, lastSavedInvoiceNo: null };
    renderInvoiceGenerator();
}

function printInvoiceBuilder() { printHTML(buildInvoicePrintHtml()); }

// ============================================================
// Email Invoice — sends the current invoice (with signature) via /api/email/send
// ============================================================
async function showEmailInvoiceDialog() {
    const partySel = document.getElementById('invParty');
    const partyId = parseInt(partySel?.value || 0);
    if (!partyId) { showToast('Select a customer first', 'warning'); return; }

    // Pull the party record so we can prefill the recipient email
    const res = await window.api.getParties({});
    const parties = res.success ? res.data : [];
    const party = parties.find(p => p.id === partyId);
    if (!party) { showToast('Customer not found', 'error'); return; }

    const invNo = document.getElementById('invNo')?.value || '';
    const settings = await getSettingsCached();
    const to = (party.email || '').trim();
    if (!to) {
        showToast(`No email address on file for ${party.name}. Add one in Parties → Edit.`, 'warning');
        return;
    }

    showModal(`
        <div class="modal-header">
            <h2>✉️ Email Invoice ${escapeHtml(invNo)} — ${escapeHtml(party.name)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="emailInvoiceForm">
                <div class="form-group">
                    <label>To (recipient)</label>
                    <input type="email" class="form-control" name="to" value="${escapeHtml(to)}">
                </div>
                <div class="form-group">
                    <label>Subject</label>
                    <input type="text" class="form-control" name="subject" value="Tax Invoice ${escapeHtml(invNo)} — ${escapeHtml(settings.business_name || '')}">
                </div>
                <div class="form-group">
                    <label>Message</label>
                    <textarea class="form-control" name="message" rows="5">Dear ${escapeHtml(party.name)},\n\nPlease find below Tax Invoice ${escapeHtml(invNo)} dated ${document.getElementById('invDate')?.value || ''}.\n\nGrand Total: ${formatCurrency(parseFloat(document.getElementById('invGrandTotal')?.value || 0))}\n\nPlease arrange the payment at your earliest convenience.\n\nRegards,\n${escapeHtml(settings.business_name || '')}</textarea>
                </div>
                <p style="font-size:12px;color:var(--text-light)">The full invoice (including the authorized signature) will be included in the email body automatically. Requires SMTP settings under Settings → Email (SMTP).</p>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="sendInvoiceEmail()">📤 Send Email</button>
        </div>
    `);
}

async function sendInvoiceEmail() {
    const form = document.getElementById('emailInvoiceForm');
    if (!form) return;
    const formData = new FormData(form);
    const to = (formData.get('to') || '').trim();
    const subject = (formData.get('subject') || '').trim();
    const message = (formData.get('message') || '').trim();

    if (!to) { showToast('Recipient email is required', 'error'); return; }
    if (!subject) { showToast('Subject is required', 'error'); return; }

    const settings = await getSettingsCached();
    const bodyHtml = `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><hr>${buildInvoiceEmailHtml(settings, { signatureCid: 'invoice-signature' })}`;

    // Inline signature attachment (cid) so the image renders in Gmail/Outlook
    const attachments = [];
    if (settings.signature_image && settings.signature_image.startsWith('data:image/')) {
        const m = settings.signature_image.match(/^data:image\/(\w+);base64,(.+)$/);
        if (m) {
            attachments.push({
                filename: `signature.${m[1] === 'jpeg' ? 'jpg' : m[1]}`,
                content: m[2],
                encoding: 'base64',
                cid: 'invoice-signature',
                contentDisposition: 'inline'
            });
        }
    }

    const sendBtn = document.querySelector('#modalContent button.btn-primary');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Sending...'; }

    const result = await window.api.sendEmail({ to, subject, html: bodyHtml, attachments });
    if (result && result.success) {
        showToast(`✅ Invoice emailed to ${to}`, 'success');
        closeModal();
    } else {
        showToast(`Email failed: ${result?.error || 'Unknown error'}`, 'error');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Send Email'; }
    }
}

// Self-contained invoice HTML for email (inline styles only — no print CSS dependency)
function buildInvoiceEmailHtml(settings, opts = {}) {
    const sigOpts = opts.signatureCid ? { cid: opts.signatureCid } : {};
    const partySel = document.getElementById('invParty');
    const partyName = partySel && partySel.value ? partySel.options[partySel.selectedIndex]?.text.replace(/\s*\(PAN.*\)$/, '') : '';
    const opt = partySel && partySel.value ? partySel.options[partySel.selectedIndex] : null;
    const addr = (document.getElementById('invAddr')?.value || '').trim() ||
        (opt ? (opt.dataset.addr || '') + (opt.dataset.phone ? ' | ' + opt.dataset.phone : '') : '');
    const invNo = document.getElementById('invNo')?.value || '';
    const date = document.getElementById('invDate')?.value || '';
    const items = [];
    document.querySelectorAll('#saleItemsBody tr').forEach(row => {
        const sel = row.querySelector('.sale-product-select');
        const name = sel && sel.value ? sel.options[sel.selectedIndex]?.text : '';
        const qty = parseFloat(row.querySelector('.sale-qty')?.value || 0);
        const unit = row.querySelector('.sale-unit')?.value || 'kg';
        const rate = parseFloat(row.querySelector('.sale-rate')?.value || 0);
        if (name) items.push({ name, qty, unit, rate, amount: qty * rate });
    });
    const { subtotal, grand } = calcInvoiceTotals();
    const paid = parseFloat(document.getElementById('invPaid')?.value || 0);

    return `
        <div style="border:1px solid #ccc;border-radius:6px;padding:18px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#111;max-width:640px">
            <div style="text-align:center;border-bottom:2px solid #111;padding-bottom:10px">
                <h1 style="margin:0;font-size:20px">${escapeHtml(settings.business_name || 'PRARAMBHA DAIRY SUPPLIERS')}</h1>
                <div style="font-size:12px">${escapeHtml(settings.business_address || '')}</div>
                <div style="font-size:12px">Phone: ${escapeHtml(settings.business_phone || '')} | PAN/VAT: ${escapeHtml(settings.business_pan_vat || settings.pan_vat || '152747352')}</div>
            </div>
            <div style="text-align:center;margin:10px 0;font-weight:700;letter-spacing:2px">TAX INVOICE</div>
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px">
                <div>
                    <div><strong>Invoice No:</strong> ${escapeHtml(invNo)}</div>
                    <div><strong>Date:</strong> ${date ? (typeof formatDateNP === 'function' ? formatDateNP(date) : date) : ''}</div>
                </div>
                <div style="text-align:right">
                    <div><strong>Customer:</strong> ${escapeHtml(partyName)}</div>
                    <div>${escapeHtml(addr)}</div>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#f0f0f0">
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">#</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">Product Name</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Quantity</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:left">Unit</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Rate</th>
                    <th style="border:1px solid #ccc;padding:6px;text-align:right">Amount</th>
                </tr></thead>
                <tbody>
                    ${items.map((it, i) => `<tr>
                        <td style="border:1px solid #ccc;padding:6px">${i + 1}</td>
                        <td style="border:1px solid #ccc;padding:6px">${escapeHtml(it.name)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${it.qty}</td>
                        <td style="border:1px solid #ccc;padding:6px">${escapeHtml(it.unit)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(it.rate)}</td>
                        <td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(it.amount)}</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot>
                    <tr><td colspan="5" style="border:1px solid #ccc;padding:6px;text-align:right"><strong>Subtotal</strong></td><td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(subtotal)}</td></tr>
                    <tr><td colspan="5" style="border:1px solid #ccc;padding:6px;text-align:right"><strong>Grand Total</strong></td><td style="border:1px solid #ccc;padding:6px;text-align:right"><strong>${formatCurrency(grand)}</strong></td></tr>
                    ${paid > 0 ? `<tr><td colspan="5" style="border:1px solid #ccc;padding:6px;text-align:right">Paid</td><td style="border:1px solid #ccc;padding:6px;text-align:right">${formatCurrency(paid)}</td></tr>` : ''}
                </tfoot>
            </table>
            <div style="font-size:12px;margin-top:10px">
                <strong>Amount in Words:</strong> ${typeof numberToWords === 'function' ? escapeHtml(numberToWords(Math.round(grand))) : ''} rupees only
            </div>
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:26px;font-size:12px">
                <div>Terms: Goods once sold not returnable. Payment due within 15 days.</div>
                ${buildSignatureBlockHtml(settings, sigOpts)}
            </div>
        </div>
    `;
}

// Globals
window.renderInvoiceGenerator = renderInvoiceGenerator;
window.saveGeneratedInvoice = saveGeneratedInvoice;
window.resetInvoiceBuilder = resetInvoiceBuilder;
window.printInvoiceBuilder = printInvoiceBuilder;
window.calcInvoiceTotals = calcInvoiceTotals;
window.updateInvoicePreview = updateInvoicePreview;
window.showEmailInvoiceDialog = showEmailInvoiceDialog;
window.sendInvoiceEmail = sendInvoiceEmail;
