/**
 * Farmer Payment Settlement Module
 * Bulk payment to farmers for milk collections
 */

async function renderFarmerPayments() {
    const container = document.getElementById('page-farmer-payments');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading farmer outstanding data...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-primary" onclick="showBulkPaymentForm()" id="bulkPayBtn" disabled>💵 Pay Selected (0)</button>
        <button class="btn btn-success" onclick="printPaymentReport()">🖨 Print Report</button>
        <button class="btn btn-primary" onclick="exportFarmerPaymentPDF()">📄 PDF</button>
        <button class="btn btn-info" onclick="refreshFarmerPayments()">🔄 Refresh</button>
    `;

    const result = await window.api.getFarmerOutstanding();
    if (!result.success) {
        container.innerHTML = `<div class="error">Failed to load data: ${result.error}</div>`;
        return;
    }

    const farmers = result.data || [];
    const totalOutstanding = farmers.reduce((s, f) => s + f.total_due, 0);

    container.innerHTML = `
        <!-- Summary -->
        <div class="summary-cards" style="grid-template-columns:repeat(4,1fr)">
            <div class="summary-card card-danger">
                <span class="label">Farmers Due</span>
                <span class="value" style="font-size:22px">${farmers.length}</span>
                <span class="sub">With pending collections</span>
            </div>
            <div class="summary-card card-warning">
                <span class="label">Total Outstanding</span>
                <span class="value" style="font-size:22px">${formatCurrency(totalOutstanding)}</span>
                <span class="sub">Due to farmers</span>
            </div>
            <div class="summary-card card-info">
                <span class="label">Pending Collections</span>
                <span class="value" style="font-size:22px">${farmers.reduce((s, f) => s + f.pending_collections, 0)}</span>
                <span class="sub">Unpaid milk collections</span>
            </div>
            <div class="summary-card card-success">
                <span class="label">Avg per Farmer</span>
                <span class="value" style="font-size:22px">${formatCurrency(farmers.length > 0 ? totalOutstanding / farmers.length : 0)}</span>
                <span class="sub">Average outstanding</span>
            </div>
        </div>

        <!-- Farmers Table -->
        <div class="card">
            <div class="card-header">
                <h2>Farmers with Pending Payments</h2>
                <span style="font-size:13px;color:var(--text-light)">Select farmers to pay, then click "Pay Selected"</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width:40px"><input type="checkbox" id="selectAllFarmers" onchange="toggleAllFarmers(this)"></th>
                            <th>Farmer</th>
                            <th>Phone</th>
                            <th class="text-right">Pending Collections</th>
                            <th class="text-right">Total Due</th>
                            <th>Last Collection</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${farmers.length === 0
                            ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-light)">🎉 All farmers have been paid! No pending dues.</td></tr>'
                            : farmers.map(f => `
                                <tr>
                                    <td><input type="checkbox" class="farmer-select" value="${f.id}" data-amount="${f.total_due}" data-name="${escapeHtml(f.name)}" data-collections='${JSON.stringify((f.collections || []).map(c => c.id))}' onchange="updateBulkPayButton();updateSelectAllFarmers()"></td>
                                    <td><strong>${escapeHtml(f.name)}</strong></td>
                                    <td>${escapeHtml(f.phone || '-')}</td>
                                    <td class="text-right">${f.pending_collections}</td>
                                    <td class="text-right" style="color:var(--danger);font-weight:700;font-family:var(--font-mono)">${formatCurrency(f.total_due)}</td>
                                    <td>${f.collections && f.collections.length > 0 ? formatDate(f.collections[0].date) : '-'}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewFarmerCollections(${f.id}, '${escapeHtml(f.name)}')">📋 View</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
            ${farmers.length > 0 ? `
                <div style="padding:12px;display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:13px;color:var(--text-light)">
                        <strong>${farmers.length}</strong> farmers due | 
                        <strong>${formatCurrency(totalOutstanding)}</strong> total outstanding
                    </span>
                    <button class="btn btn-primary" onclick="selectAllWithBalance()">Select All with Balance</button>
                </div>
            ` : ''}
        </div>

        <!-- Payment History -->
        <div class="card" style="margin-top:16px">
            <div class="card-header">
                <h2>Recent Farmer Payments</h2>
            </div>
            <div id="farmerPaymentHistory">Loading payment history...</div>
        </div>
    `;

    // Load payment history
    loadFarmerPaymentHistory();
}

async function loadFarmerPaymentHistory() {
    const container = document.getElementById('farmerPaymentHistory');
    if (!container) return;

    // Get recent payments of type 'payment' (money going out to farmers)
    const result = await window.api.getPayments({});
    if (!result.success) {
        container.innerHTML = '<div style="color:var(--text-light)">Failed to load</div>';
        return;
    }

    const payments = (result.data || [])
        .filter(p => p.type === 'payment')
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .slice(0, 20);

    container.innerHTML = payments.length === 0
        ? '<div style="text-align:center;padding:20px;color:var(--text-light)">No payments made yet</div>'
        : `
        <div class="table-container" style="max-height:300px;overflow-y:auto">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Farmer</th>
                        <th class="text-right">Amount</th>
                        <th>Mode</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map(p => `
                        <tr>
                            <td>${formatDate(p.date)}</td>
                            <td>${escapeHtml(p.party_name)}</td>
                            <td class="text-right" style="color:var(--danger)">-${formatCurrency(p.amount)}</td>
                            <td>${statusBadge(p.mode)}</td>
                            <td style="font-size:12px;color:var(--text-light)">${escapeHtml(p.notes || '')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function updateBulkPayButton() {
    const checked = document.querySelectorAll('.farmer-select:checked');
    const btn = document.getElementById('bulkPayBtn');
    if (btn) {
        const total = Array.from(checked).reduce((s, cb) => s + parseFloat(cb.dataset.amount || 0), 0);
        btn.disabled = checked.length === 0;
        btn.innerHTML = `💵 Pay Selected (${checked.length}) - ${formatCurrency(total)}`;
    }
}

function updateSelectAllFarmers() {
    const allCbs = document.querySelectorAll('.farmer-select');
    const checkedCbs = document.querySelectorAll('.farmer-select:checked');
    const selectAll = document.getElementById('selectAllFarmers');
    if (selectAll) {
        selectAll.checked = allCbs.length > 0 && allCbs.length === checkedCbs.length;
    }
}

function toggleAllFarmers(checkbox) {
    document.querySelectorAll('.farmer-select').forEach(cb => cb.checked = checkbox.checked);
    updateBulkPayButton();
}

function selectAllWithBalance() {
    document.querySelectorAll('.farmer-select').forEach(cb => {
        if (parseFloat(cb.dataset.amount) > 0) cb.checked = true;
    });
    updateBulkPayButton();
}

function refreshFarmerPayments() {
    renderFarmerPayments();
}

// ============================================================
// View Farmer Collections
// ============================================================
async function viewFarmerCollections(partyId, farmerName) {
    // Get farmer's pending collections
    const result = await window.api.getFarmerOutstanding();
    if (!result.success) return;

    const farmer = (result.data || []).find(f => f.id === partyId);
    if (!farmer) {
        showToast('No pending collections for this farmer', 'info');
        return;
    }

    const collections = farmer.collections || [];

    showModal(`
        <div class="modal-header">
            <h2>Pending Collections: ${escapeHtml(farmerName)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
                <div class="summary-card card-danger" style="margin:0;padding:12px">
                    <span class="label">Total Due</span>
                    <span class="value" style="font-size:18px">${formatCurrency(farmer.total_due)}</span>
                </div>
                <div class="summary-card card-info" style="margin:0;padding:12px">
                    <span class="label">Collections</span>
                    <span class="value" style="font-size:18px">${farmer.pending_collections}</span>
                </div>
                <div class="summary-card card-success" style="margin:0;padding:12px">
                    <span class="label">Phone</span>
                    <span class="value" style="font-size:18px">${escapeHtml(farmer.phone || '-')}</span>
                </div>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Collection #</th>
                            <th class="text-right">Liters</th>
                            <th class="text-right">Amount</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${collections.map(c => `
                            <tr>
                                <td>${formatDate(c.date)}</td>
                                <td>${escapeHtml(c.collection_no)}</td>
                                <td class="text-right">${formatNumber(c.quantity_liters)} L</td>
                                <td class="text-right">${formatCurrency(c.amount)}</td>
                                <td>${statusBadge(c.status)}</td>
                            </tr>
                        `).join('')}
                        ${collections.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-light)">No pending collections</td></tr>' : ''}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-primary" onclick="closeModal(); quickPayFarmer(${partyId})">💵 Pay Now</button>
        </div>
    `);
}

// ============================================================
// Bulk Payment Form
// ============================================================
async function showBulkPaymentForm() {
    const checked = document.querySelectorAll('.farmer-select:checked');
    if (checked.length === 0) {
        showToast('Please select at least one farmer to pay', 'warning');
        return;
    }

    const selectedFarmers = Array.from(checked).map(cb => ({
        id: parseInt(cb.value),
        name: cb.dataset.name,
        amount: parseFloat(cb.dataset.amount),
        collectionIds: JSON.parse(cb.dataset.collections || '[]')
    }));

    const totalAmount = selectedFarmers.reduce((s, f) => s + f.amount, 0);

    showModal(`
        <div class="modal-header">
            <h2>Bulk Payment - Settle Farmer Dues</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="bulkPaymentForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Payment Date</label>
                        <input type="date" class="form-control" name="date" value="${today()}" required>
                    </div>
                    <div class="form-group">
                        <label>Payment Mode</label>
                        <select class="form-control" name="mode" required>
                            <option value="cash">Cash</option>
                            <option value="bank">Bank Transfer</option>
                            <option value="upi">UPI</option>
                            <option value="cheque">Cheque</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes (optional)</label>
                    <input type="text" class="form-control" name="notes" placeholder="e.g. Weekly milk payment" value="Weekly milk payment settlement">
                </div>

                <div class="form-section-title">Farmers to Pay</div>
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Farmer</th>
                                <th class="text-right">Amount Due</th>
                                <th class="text-right" style="width:140px">Pay Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${selectedFarmers.map((f, i) => `
                                <tr>
                                    <td><strong>${escapeHtml(f.name)}</strong></td>
                                    <td class="text-right" style="color:var(--danger);font-weight:600">${formatCurrency(f.amount)}</td>
                                    <td class="text-right">
                                        <input type="number" class="form-control pay-amount" value="${f.amount}" min="0" step="0.01" 
                                            data-max="${f.amount}" data-index="${i}"
                                            style="width:130px;text-align:right;font-size:13px" 
                                            oninput="updatePayTotal()">
                                        <input type="hidden" class="farmer-id" value="${f.id}">
                                        <input type="hidden" class="farmer-name" value="${escapeHtml(f.name)}">
                                        <input type="hidden" class="farmer-collection-ids" value='${JSON.stringify(f.collectionIds)}'>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td><strong>Total</strong></td>
                                <td class="text-right" style="font-weight:700">${formatCurrency(totalAmount)}</td>
                                <td class="text-right" id="payTotalDisplay" style="font-weight:700;font-size:15px">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:6px;font-size:13px">
                    ⚠️ This will mark all selected collections as <strong>Paid</strong> and create a payment record in the ledger.
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-success" onclick="processBulkPayment()">💵 Confirm Payment of <span id="confirmTotal">${formatCurrency(totalAmount)}</span></button>
        </div>
    `);
}

function updatePayTotal() {
    const amounts = document.querySelectorAll('.pay-amount');
    let total = 0;
    amounts.forEach(inp => {
        total += parseFloat(inp.value || 0);
    });
    document.getElementById('payTotalDisplay').textContent = formatCurrency(total);
    document.getElementById('confirmTotal').textContent = formatCurrency(total);
}

// ============================================================
// Process Bulk Payment
// ============================================================
async function processBulkPayment() {
    const form = document.getElementById('bulkPaymentForm');
    const formData = new FormData(form);

    const date = formData.get('date') || today();
    const mode = formData.get('mode') || 'cash';
    const notes = formData.get('notes') || '';

    // Validate date
    if (!date) {
        showToast('Please select a payment date', 'error');
        return;
    }

    // Gather payments
    const paymentRows = document.querySelectorAll('#bulkPaymentForm table tbody tr');
    const payments = [];
    const collectionIdsToPay = [];

    for (const row of paymentRows) {
        const farmerIdInput = row.querySelector('.farmer-id');
        const amountInput = row.querySelector('.pay-amount');

        if (!farmerIdInput || !amountInput) continue;

        const party_id = parseInt(farmerIdInput.value);
        const amount = parseFloat(amountInput.value || 0);

        if (amount <= 0) continue;

            // Read collection IDs from hidden input (no second API call needed)
        const collectionIdsEl = row.querySelector('.farmer-collection-ids');
        const collectionIds = collectionIdsEl ? JSON.parse(collectionIdsEl.value || '[]') : [];

        payments.push({
            party_id,
            amount,
            collection_ids: collectionIds
        });
    }

    if (payments.length === 0) {
        showToast('No valid payments to process', 'error');
        return;
    }

    // Confirm
    const totalPay = payments.reduce((s, p) => s + p.amount, 0);
    const confirmed = await confirmAction(
        `Process ${payments.length} payment(s) totaling ${formatCurrency(totalPay)}?`,
        'This will mark all selected milk collections as Paid and update the farmer ledgers.',
        'Yes, Process Payment',
        'Cancel'
    );

    if (!confirmed) return;

    // Process the bulk payment (collection IDs are already embedded from the page data)
    const result = await window.api.bulkPayFarmers({
        payments,
        date,
        mode,
        notes
    });

    if (result.success) {
        const results = result.data || [];
        const totalPaid = results.reduce((s, r) => s + r.amount, 0);
        const totalCleared = results.reduce((s, r) => s + r.collections_cleared, 0);
        showToast(`✅ Payment processed! ${formatCurrency(totalPaid)} paid to ${results.length} farmer(s), ${totalCleared} collection(s) cleared.`);
        closeModal();
        renderFarmerPayments();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

// ============================================================
// Quick Pay Single Farmer
// ============================================================
async function quickPayFarmer(partyId) {
    // Check the checkbox and open payment form
    const cb = document.querySelector(`.farmer-select[value="${partyId}"]`);
    if (cb) {
        cb.checked = true;
        updateBulkPayButton();
    }
    showBulkPaymentForm();
}

// ============================================================
// Print Payment Report
// ============================================================
async function printPaymentReport() {
    const result = await window.api.getFarmerOutstanding();
    if (!result.success) return;
    const farmers = result.data || [];
    const settings = await getSettingsCached();
    const totalOutstanding = farmers.reduce((s, f) => s + f.total_due, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Farmer Outstanding Report</h2>
            <p>Date: ${formatDate(today())}</p>
        </div>
        <div style="display:flex;gap:20px;margin:10px 0">
            <span><strong>Farmers Due:</strong> ${farmers.length}</span>
            <span><strong>Total Outstanding:</strong> ${formatCurrency(totalOutstanding)}</span>
        </div>
        <table>
            <thead><tr><th>Farmer</th><th>Phone</th><th class="text-right">Collections</th><th class="text-right">Amount</th></tr></thead>
            <tbody>
                ${farmers.map(f => `<tr><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.phone || '-')}</td><td class="text-right">${f.pending_collections}</td><td class="text-right">${formatCurrency(f.total_due)}</td></tr>`).join('')}
                ${farmers.length === 0 ? '<tr><td colspan="4" style="text-align:center">No outstanding dues</td></tr>' : ''}
            </tbody>
        </table>
        <div class="footer">
            <div>Printed: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
            <div class="signature">Authorized Signature</div>
        </div>
    `;
    printHTML(html);
}

// ============================================================
// Export Farmer Payment Report as PDF
// ============================================================
async function exportFarmerPaymentPDF() {
    const result = await window.api.getFarmerOutstanding();
    if (!result.success) return;
    const farmers = result.data || [];
    const settings = await getSettingsCached();
    const totalOutstanding = farmers.reduce((s, f) => s + f.total_due, 0);

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>Farmer Outstanding Report</h2>
            <p>Date: ${formatDate(today())} | Farmers Due: ${farmers.length} | Total: ${formatCurrency(totalOutstanding)}</p>
        </div>
        <table>
            <thead><tr><th>Farmer</th><th>Phone</th><th class="text-right">Collections</th><th class="text-right">Amount Due</th></tr></thead>
            <tbody>
                ${farmers.map(f => `<tr><td><strong>${escapeHtml(f.name)}</strong></td><td>${escapeHtml(f.phone || '-')}</td><td class="text-right">${f.pending_collections}</td><td class="text-right">${formatCurrency(f.total_due)}</td></tr>`).join('')}
                ${farmers.length === 0 ? '<tr><td colspan="4" style="text-align:center">No outstanding dues</td></tr>' : ''}
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
window.renderFarmerPayments = renderFarmerPayments;
window.updateBulkPayButton = updateBulkPayButton;
window.updateSelectAllFarmers = updateSelectAllFarmers;
window.toggleAllFarmers = toggleAllFarmers;
window.selectAllWithBalance = selectAllWithBalance;
window.refreshFarmerPayments = refreshFarmerPayments;
window.viewFarmerCollections = viewFarmerCollections;
window.showBulkPaymentForm = showBulkPaymentForm;
window.updatePayTotal = updatePayTotal;
window.processBulkPayment = processBulkPayment;
window.quickPayFarmer = quickPayFarmer;
window.printPaymentReport = printPaymentReport;
window.exportFarmerPaymentPDF = exportFarmerPaymentPDF;
