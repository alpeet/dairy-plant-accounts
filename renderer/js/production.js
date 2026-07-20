/**
 * Production / Batch Processing Module
 * =====================================
 * Manage production batches: raw milk → finished goods with
 * yield tracking, wastage, and stock consumption/creation.
 */

let prodFilter = { search: '', from_date: '', to_date: '' };

async function renderProduction() {
    const container = document.getElementById('page-production');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading production batches...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showProductionForm()">+ New Batch</button>
        <button class="btn btn-info btn-sm" onclick="showProductionReport()">📊 Production Report</button>
        <button class="btn btn-info btn-sm" onclick="printProductionList()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportProductionPDF()">📄 PDF</button>
    `;

    const [batchesResult, typesResult] = await Promise.all([
        window.api.getProductionBatches(prodFilter),
        window.api.getProcessTypes()
    ]);

    const batches = batchesResult.success ? batchesResult.data : [];
    const processTypes = typesResult.success ? typesResult.data : [];

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>From</label>
                    <input type="date" class="form-control" id="prodFrom" value="${prodFilter.from_date}">
                </div>
                <div class="form-group">
                    <label>To</label>
                    <input type="date" class="form-control" id="prodTo" value="${prodFilter.to_date}">
                </div>
                <div class="form-group">
                    <label>Process</label>
                    <select class="form-control" id="prodType">
                        <option value="">All Types</option>
                        ${processTypes.map(t => `<option value="${escapeHtml(t.process_type)}">${escapeHtml(t.process_type)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="applyProdFilter()">Filter</button>
                    <button class="btn btn-secondary btn-sm" onclick="resetProdFilter()">Reset</button>
                </div>
            </div>
        </div>

        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Total Batches</span>
                <span class="value" style="font-size:20px">${batches.length}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Total Input</span>
                <span class="value" style="font-size:18px">${formatNumber(batches.reduce((s,b) => s + b.input_quantity, 0))} L</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Output</span>
                <span class="value" style="font-size:18px">${formatNumber(batches.reduce((s,b) => s + b.output_quantity, 0))}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Avg Yield</span>
                <span class="value" style="font-size:18px">${batches.length > 0 ? (batches.reduce((s,b) => s + b.actual_yield_percent, 0) / batches.length).toFixed(1) : 0}%</span>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Production Batches</h2>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Batch #</th>
                            <th>Date</th>
                            <th>Shift</th>
                            <th>Process Type</th>
                            <th class="text-right">Input</th>
                            <th class="text-right">Output</th>
                            <th class="text-right">Yield %</th>
                            <th class="text-right">Wastage</th>
                            <th>Operator</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${batches.length === 0
                            ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No production batches yet. Start processing!</td></tr>'
                            : batches.map(b => `
                                <tr>
                                    <td><strong>${escapeHtml(b.batch_no)}</strong></td>
                                    <td>${formatDate(b.date)}</td>
                                    <td>${b.shift}</td>
                                    <td><span class="badge badge-primary">${escapeHtml(b.process_type || '-')}</span></td>
                                    <td class="text-right">${formatNumber(b.input_quantity)} ${b.input_quantity > 0 ? 'L' : ''}</td>
                                    <td class="text-right">${formatNumber(b.output_quantity)}</td>
                                    <td class="text-right" style="color:${b.actual_yield_percent >= 80 ? 'var(--accent)' : 'var(--danger)'}">${b.actual_yield_percent ? b.actual_yield_percent.toFixed(1) + '%' : '-'}</td>
                                    <td class="text-right" style="color:${b.wastage_quantity > 0 ? 'var(--danger)' : 'var(--text-light)'}">${b.wastage_quantity > 0 ? formatNumber(b.wastage_quantity) : '-'}</td>
                                    <td>${escapeHtml(b.operator_name || '-')}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewProductionBatch(${b.id})" title="View">👁</button>
                                        <button class="btn btn-primary btn-sm" onclick="editProductionBatch(${b.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteProductionBatchEntry(${b.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    window._lastProductionBatches = batches;
}

function applyProdFilter() {
    prodFilter.from_date = document.getElementById('prodFrom')?.value || '';
    prodFilter.to_date = document.getElementById('prodTo')?.value || '';
    prodFilter.search = document.getElementById('prodType')?.value || '';
    renderProduction();
}

function resetProdFilter() {
    prodFilter = { search: '', from_date: '', to_date: '' };
    renderProduction();
}

// ============================================================
// Generate Batch No
// ============================================================
function generateBatchNo() {
    const d = new Date();
    return 'BATCH-' + d.getFullYear().toString().slice(-2) +
        String(d.getMonth() + 1).padStart(2, '0') +
        String(d.getDate()).padStart(2, '0') + '-' +
        String(Math.floor(Math.random() * 9999)).padStart(4, '0');
}

// ============================================================
// Production Batch Form
// ============================================================
async function showProductionForm(batchId = null) {
    const [productsResult, typesResult] = await Promise.all([
        window.api.getProducts({}),
        window.api.getProcessTypes()
    ]);

    const products = productsResult.success ? productsResult.data : [];
    const processTypes = typesResult.success ? typesResult.data : [];

    let batch = null;
    if (batchId) {
        const result = await window.api.getProductionBatch(batchId);
        if (result.success) batch = result.data;
    }

    const isEdit = !!batch;
    const today = new Date().toISOString().split('T')[0];

    // Default inputs/outputs
    const inputs = batch ? batch.inputs : [{ product_id: '', product_name: '', quantity: '', unit: 'liter', rate: '' }];
    const outputs = batch ? batch.outputs : [{ product_id: '', product_name: '', quantity: '', unit: 'kg', rate: '' }];

    showModal(`
        <div class="modal-header">
            <h2>${isEdit ? 'Edit Production Batch' : 'New Production Batch'}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            <form id="productionForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Batch No *</label>
                        <input type="text" class="form-control" id="pbNo" value="${escapeHtml(batch ? batch.batch_no : generateBatchNo())}">
                    </div>
                    <div class="form-group">
                        <label>Date</label>
                        <input type="date" class="form-control" id="pbDate" value="${batch ? batch.date : today}">
                    </div>
                    <div class="form-group">
                        <label>Shift</label>
                        <select class="form-control" id="pbShift">
                            <option value="morning" ${batch && batch.shift === 'morning' ? 'selected' : ''}>Morning</option>
                            <option value="evening" ${batch && batch.shift === 'evening' ? 'selected' : ''}>Evening</option>
                            <option value="combined" ${batch && batch.shift === 'combined' ? 'selected' : ''}>Combined</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Process Type</label>
                        <input type="text" class="form-control" id="pbProcess" value="${escapeHtml(batch ? batch.process_type : '')}" placeholder="e.g., Pasteurization, Dahi, Ghee, Paneer" list="processTypeList">
                        <datalist id="processTypeList">
                            ${processTypes.map(t => `<option value="${escapeHtml(t.process_type)}">`).join('')}
                            <option value="Pasteurization"><option value="Dahi / Curd Making">
                            <option value="Ghee Making"><option value="Paneer Making">
                            <option value="Cream Separation"><option value="Butter Making">
                            <option value="Milk Powder"><option value="Cheese Making">
                        </datalist>
                    </div>
                    <div class="form-group">
                        <label>Operator</label>
                        <input type="text" class="form-control" id="pbOperator" value="${escapeHtml(batch ? batch.operator_name : '')}">
                    </div>
                </div>

                <div class="form-section-title">Input Products (Raw Materials Consumed)</div>
                <div id="inputsContainer">
                    ${inputs.map((inp, i) => `
                        <div class="form-row-4" style="margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px">
                            <div class="form-group" style="flex:2">
                                <label>Product</label>
                                <select class="form-control input-product" onchange="updateInputName(this)">
                                    <option value="">-- Select --</option>
                                    ${products.map(p => `<option value="${p.id}" ${inp.product_id == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Qty</label>
                                <input type="number" class="form-control input-qty" value="${inp.quantity}" step="0.01" min="0" oninput="calcProdAmounts()">
                            </div>
                            <div class="form-group">
                                <label>Unit</label>
                                <input type="text" class="form-control input-unit" value="${inp.unit || 'liter'}" style="width:70px">
                            </div>
                            <div class="form-group">
                                <label>Rate</label>
                                <input type="number" class="form-control input-rate" value="${inp.rate || 0}" step="0.01" min="0" oninput="calcProdAmounts()">
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-danger btn-sm" onclick="removeProdInput(this)" ${i === 0 ? 'style="visibility:hidden"' : ''}>✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addProdInput()">+ Add Input</button>

                <div class="form-section-title" style="margin-top:16px">Output Products (Finished Goods Produced)</div>
                <div id="outputsContainer">
                    ${outputs.map((out, i) => `
                        <div class="form-row-4" style="margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px">
                            <div class="form-group" style="flex:2">
                                <label>Product</label>
                                <select class="form-control output-product" onchange="updateOutputName(this)">
                                    <option value="">-- Select --</option>
                                    ${products.map(p => `<option value="${p.id}" ${out.product_id == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Qty</label>
                                <input type="number" class="form-control output-qty" value="${out.quantity}" step="0.01" min="0" oninput="calcProdAmounts()">
                            </div>
                            <div class="form-group">
                                <label>Unit</label>
                                <input type="text" class="form-control output-unit" value="${out.unit || 'kg'}" style="width:70px">
                            </div>
                            <div class="form-group">
                                <label>Rate</label>
                                <input type="number" class="form-control output-rate" value="${out.rate || 0}" step="0.01" min="0" oninput="calcProdAmounts()">
                            </div>
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-danger btn-sm" onclick="removeProdOutput(this)" ${i === 0 ? 'style="visibility:hidden"' : ''}>✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addProdOutput()">+ Add Output</button>

                <div class="form-section-title" style="margin-top:16px">Yield & Wastage</div>
                <div class="form-row-3">
                    <div class="form-group">
                        <label>Wastage Quantity</label>
                        <input type="number" class="form-control" id="pbWastage" value="${batch ? batch.wastage_quantity : 0}" step="0.01" min="0" oninput="calcProdYield()">
                    </div>
                    <div class="form-group">
                        <label>Wastage Reason</label>
                        <input type="text" class="form-control" id="pbWastageReason" value="${escapeHtml(batch ? batch.wastage_reason : '')}" placeholder="e.g., spillage, testing, spoilage">
                    </div>
                    <div class="form-group">
                        <label>Yield % (auto)</label>
                        <input type="text" class="form-control" id="pbYieldDisplay" readonly style="font-weight:700;font-size:16px;color:var(--accent);background:var(--bg)">
                    </div>
                </div>
                <div class="form-group">
                    <label>Remarks</label>
                    <textarea class="form-control" id="pbRemarks" rows="2">${escapeHtml(batch ? batch.remarks : '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveProductionBatch(${batchId || ''})">💾 ${isEdit ? 'Update Batch' : 'Save Batch'}</button>
        </div>
    `);
}

function updateInputName(select) {
    const name = select.options[select.selectedIndex]?.text || '';
    select.closest('.form-row-4').querySelector('.input-product').dataset.name = name;
}

function updateOutputName(select) {
    const name = select.options[select.selectedIndex]?.text || '';
    select.closest('.form-row-4').querySelector('.output-product').dataset.name = name;
}

function addProdInput() {
    const container = document.getElementById('inputsContainer');
    const row = document.createElement('div');
    row.className = 'form-row-4';
    row.style.cssText = 'margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px';
    row.innerHTML = `
        <div class="form-group" style="flex:2">
            <label>Product</label>
            <select class="form-control input-product" onchange="updateInputName(this)">
                <option value="">-- Select --</option>
                ${document.querySelector('#inputsContainer .input-product')?.innerHTML || ''}
            </select>
        </div>
        <div class="form-group"><label>Qty</label><input type="number" class="form-control input-qty" step="0.01" min="0" oninput="calcProdAmounts()"></div>
        <div class="form-group"><label>Unit</label><input type="text" class="form-control input-unit" value="liter" style="width:70px"></div>
        <div class="form-group"><label>Rate</label><input type="number" class="form-control input-rate" step="0.01" min="0" oninput="calcProdAmounts()"></div>
        <div class="form-group"><label>&nbsp;</label><button class="btn btn-danger btn-sm" onclick="removeProdInput(this)">✕</button></div>
    `;
    container.appendChild(row);
}

function removeProdInput(btn) {
    btn.closest('.form-row-4').remove();
    calcProdAmounts();
}

function addProdOutput() {
    const container = document.getElementById('outputsContainer');
    const row = document.createElement('div');
    row.className = 'form-row-4';
    row.style.cssText = 'margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px';
    row.innerHTML = `
        <div class="form-group" style="flex:2">
            <label>Product</label>
            <select class="form-control output-product" onchange="updateOutputName(this)">
                <option value="">-- Select --</option>
                ${document.querySelector('#outputsContainer .output-product')?.innerHTML || ''}
            </select>
        </div>
        <div class="form-group"><label>Qty</label><input type="number" class="form-control output-qty" step="0.01" min="0" oninput="calcProdAmounts()"></div>
        <div class="form-group"><label>Unit</label><input type="text" class="form-control output-unit" value="kg" style="width:70px"></div>
        <div class="form-group"><label>Rate</label><input type="number" class="form-control output-rate" step="0.01" min="0" oninput="calcProdAmounts()"></div>
        <div class="form-group"><label>&nbsp;</label><button class="btn btn-danger btn-sm" onclick="removeProdOutput(this)">✕</button></div>
    `;
    container.appendChild(row);
}

function removeProdOutput(btn) {
    btn.closest('.form-row-4').remove();
    calcProdAmounts();
}

function calcProdAmounts() {
    let totalInput = 0, totalOutput = 0;
    document.querySelectorAll('#inputsContainer .input-qty').forEach(el => {
        totalInput += parseFloat(el.value || 0);
    });
    document.querySelectorAll('#outputsContainer .output-qty').forEach(el => {
        totalOutput += parseFloat(el.value || 0);
    });
    const yieldPct = totalInput > 0 ? (totalOutput / totalInput) * 100 : 0;
    const el = document.getElementById('pbYieldDisplay');
    if (el) {
        el.value = yieldPct.toFixed(1) + '%';
        el.style.color = yieldPct >= 80 ? 'var(--accent)' : 'var(--danger)';
    }
}

function calcProdYield() {
    calcProdAmounts();
}

// ============================================================
// Save Production Batch
// ============================================================
async function saveProductionBatch(batchId) {
    const batchNo = document.getElementById('pbNo')?.value;
    const date = document.getElementById('pbDate')?.value || '';
    const shift = document.getElementById('pbShift')?.value || 'morning';
    const processType = document.getElementById('pbProcess')?.value || '';
    const operatorName = document.getElementById('pbOperator')?.value || '';
    const wastageQty = parseFloat(document.getElementById('pbWastage')?.value || 0);
    const wastageReason = document.getElementById('pbWastageReason')?.value || '';
    const remarks = document.getElementById('pbRemarks')?.value || '';

    if (!batchNo) { showToast('Batch number is required', 'error'); return; }
    if (!date) { showToast('Date is required', 'error'); return; }
    if (!processType) { showToast('Process type is required', 'error'); return; }

    // Gather inputs
    const inputRows = document.querySelectorAll('#inputsContainer .form-row-4');
    const inputs = [];
    inputRows.forEach(row => {
        const sel = row.querySelector('.input-product');
        const qty = parseFloat(row.querySelector('.input-qty')?.value || 0);
        const unit = row.querySelector('.input-unit')?.value || 'liter';
        const rate = parseFloat(row.querySelector('.input-rate')?.value || 0);
        const pid = parseInt(sel?.value || 0);
        const pname = sel?.dataset?.name || sel?.options[sel?.selectedIndex]?.text || '';
        if (pid > 0 && qty > 0) {
            inputs.push({ product_id: pid, product_name: pname, quantity: qty, unit, rate });
        }
    });

    // Gather outputs
    const outputRows = document.querySelectorAll('#outputsContainer .form-row-4');
    const outputs = [];
    outputRows.forEach(row => {
        const sel = row.querySelector('.output-product');
        const qty = parseFloat(row.querySelector('.output-qty')?.value || 0);
        const unit = row.querySelector('.output-unit')?.value || 'kg';
        const rate = parseFloat(row.querySelector('.output-rate')?.value || 0);
        const pid = parseInt(sel?.value || 0);
        const pname = sel?.dataset?.name || sel?.options[sel?.selectedIndex]?.text || '';
        if (pid > 0 && qty > 0) {
            outputs.push({ product_id: pid, product_name: pname, quantity: qty, unit, rate });
        }
    });

    if (inputs.length === 0) { showToast('At least one input product is required', 'error'); return; }
    if (outputs.length === 0) { showToast('At least one output product is required', 'error'); return; }

    const data = {
        id: batchId || null,
        batch_no: batchNo,
        date,
        shift,
        process_type: processType,
        inputs,
        outputs,
        wastage_quantity: wastageQty,
        wastage_reason: wastageReason,
        operator_name: operatorName,
        remarks
    };

    const result = await window.api.saveProductionBatch(data);
    if (result.success) {
        closeModal();
        showToast(batchId ? 'Batch updated' : 'Batch saved', 'success');
        renderProduction();
    } else {
        showToast(result.error, 'error');
    }
}

async function editProductionBatch(id) {
    const result = await window.api.getProductionBatch(id);
    if (result.success) showProductionForm(id);
}

async function viewProductionBatch(id) {
    const result = await window.api.getProductionBatch(id);
    if (!result.success) return;
    const b = result.data;
    if (!b) return;

    const settings = await getSettingsCached();
    const yieldPct = b.input_quantity > 0 ? (b.output_quantity / b.input_quantity) * 100 : 0;

    showModal(`
        <div class="modal-header">
            <h2>Batch: ${escapeHtml(b.batch_no)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px">
                <strong>Date:</strong> ${formatDate(b.date)} | <strong>Shift:</strong> ${b.shift} | 
                <strong>Process:</strong> ${escapeHtml(b.process_type)} | 
                <strong>Operator:</strong> ${escapeHtml(b.operator_name || '-')}
            </div>
            <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
                <div class="summary-card card-info" style="margin:0;padding:12px">
                    <span class="label">Total Input</span>
                    <span class="value" style="font-size:20px">${formatNumber(b.input_quantity)} L</span>
                </div>
                <div class="summary-card card-success" style="margin:0;padding:12px">
                    <span class="label">Total Output</span>
                    <span class="value" style="font-size:20px">${formatNumber(b.output_quantity)}</span>
                </div>
                <div class="summary-card card-warning" style="margin:0;padding:12px">
                    <span class="label">Yield</span>
                    <span class="value" style="font-size:20px;color:${yieldPct >= 80 ? 'var(--accent)' : 'var(--danger)'}">${yieldPct.toFixed(1)}%</span>
                </div>
            </div>
            ${b.wastage_quantity > 0 ? `<div style="padding:10px 14px;background:#fff3cd;border-radius:6px;margin-bottom:12px;font-size:13px">⚠️ <strong>Wastage:</strong> ${formatNumber(b.wastage_quantity)} — ${escapeHtml(b.wastage_reason || 'No reason given')}</div>` : ''}

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                <div>
                    <h4 style="font-size:13px;color:var(--text-light);margin-bottom:8px">📥 Inputs Consumed</h4>
                    ${(b.inputs || []).map(inp => `<div style="padding:6px 10px;background:var(--bg);border-radius:4px;margin-bottom:4px;font-size:13px"><strong>${escapeHtml(inp.product_name)}</strong>: ${formatNumber(inp.quantity)} ${escapeHtml(inp.unit)} @ ${formatCurrency(inp.rate)}</div>`).join('')}
                </div>
                <div>
                    <h4 style="font-size:13px;color:var(--text-light);margin-bottom:8px">📦 Outputs Produced</h4>
                    ${(b.outputs || []).map(out => `<div style="padding:6px 10px;background:var(--bg);border-radius:4px;margin-bottom:4px;font-size:13px"><strong>${escapeHtml(out.product_name)}</strong>: ${formatNumber(out.quantity)} ${escapeHtml(out.unit)} @ ${formatCurrency(out.rate)}</div>`).join('')}
                </div>
            </div>
            ${b.remarks ? `<div style="margin-top:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px"><strong>Remarks:</strong> ${escapeHtml(b.remarks)}</div>` : ''}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-info" onclick="closeModal();editProductionBatch(${b.id})">✏️ Edit</button>
            <button class="btn btn-info" onclick="printProductionBatch(${b.id})">🖨 Print</button>
        </div>
    `);
}

async function deleteProductionBatchEntry(id) {
    const confirmed = await confirmAction('Delete this production batch?', 'This will reverse all stock movements (add raw materials back, remove finished goods).');
    if (!confirmed) return;
    const result = await window.api.deleteProductionBatch(id);
    if (result.success) {
        showToast('Batch deleted and stock reversed', 'success');
        renderProduction();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Production Report
// ============================================================
async function showProductionReport() {
    const preset = getDatePreset('this_month');
    const result = await window.api.getProductionBatches({ from_date: preset.from, to_date: preset.to });
    const batches = result.success ? result.data : [];

    showModal(`
        <div class="modal-header">
            <h2>Production Report</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="max-height:80vh;overflow-y:auto">
            <div class="filter-bar">
                <div class="form-group"><label>From</label><input type="date" class="form-control" id="prRptFrom" value="${preset.from}"></div>
                <div class="form-group"><label>To</label><input type="date" class="form-control" id="prRptTo" value="${preset.to}"></div>
                <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="refreshProductionReport()">Generate</button></div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-info btn-sm" onclick="printProductionReportData()">🖨 Print</button>
                </div>
            </div>
            ${batches.length === 0
                ? '<div style="text-align:center;padding:40px;color:var(--text-light)">No production batches in this period</div>'
                : `
                <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
                    <div class="summary-card card-primary" style="margin:0;padding:12px"><span class="label">Batches</span><span class="value" style="font-size:20px">${batches.length}</span></div>
                    <div class="summary-card card-info" style="margin:0;padding:12px"><span class="label">Input</span><span class="value" style="font-size:18px">${formatNumber(batches.reduce((s,b) => s + b.input_quantity, 0))} L</span></div>
                    <div class="summary-card card-success" style="margin:0;padding:12px"><span class="label">Output</span><span class="value" style="font-size:18px">${formatNumber(batches.reduce((s,b) => s + b.output_quantity, 0))}</span></div>
                    <div class="summary-card card-warning" style="margin:0;padding:12px"><span class="label">Avg Yield</span><span class="value" style="font-size:18px">${batches.length > 0 ? (batches.reduce((s,b) => s + b.actual_yield_percent, 0) / batches.length).toFixed(1) : 0}%</span></div>
                </div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Batch</th><th>Date</th><th>Shift</th><th>Process</th><th class="text-right">Input</th><th class="text-right">Output</th><th class="text-right">Yield%</th><th>Operator</th></tr></thead>
                        <tbody>${batches.map(b => `<tr><td>${escapeHtml(b.batch_no)}</td><td>${formatDate(b.date)}</td><td>${b.shift}</td><td>${escapeHtml(b.process_type)}</td><td class="text-right">${formatNumber(b.input_quantity)}</td><td class="text-right">${formatNumber(b.output_quantity)}</td><td class="text-right">${b.actual_yield_percent ? b.actual_yield_percent.toFixed(1) + '%' : '-'}</td><td>${escapeHtml(b.operator_name||'')}</td></tr>`).join('')}</tbody>
                    </table>
                </div>`
            }
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>
    `);
}

async function refreshProductionReport() {
    const from = document.getElementById('prRptFrom')?.value || '';
    const to = document.getElementById('prRptTo')?.value || '';
    const result = await window.api.getProductionBatches({ from_date: from, to_date: to });
    if (result.success) window._lastProdReport = result.data;
    showProductionReport();
}

async function printProductionReportData() {
    const batches = window._lastProdReport || window._lastProductionBatches || [];
    if (batches.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Production Report</h2></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Batches</div><div class="value-number">${batches.length}</div></div>
            <div class="value-card"><div class="value-label">Input</div><div class="value-number">${formatNumber(batches.reduce((s,b) => s + b.input_quantity, 0))}</div></div>
            <div class="value-card"><div class="value-label">Output</div><div class="value-number">${formatNumber(batches.reduce((s,b) => s + b.output_quantity, 0))}</div></div>
        </div>
        <table><thead><tr><th>Batch</th><th>Date</th><th>Process</th><th class="text-right">Input</th><th class="text-right">Output</th><th class="text-right">Yield%</th></tr></thead>
        <tbody>${batches.map(b => `<tr><td>${escapeHtml(b.batch_no)}</td><td>${formatDate(b.date)}</td><td>${escapeHtml(b.process_type)}</td><td class="text-right">${formatNumber(b.input_quantity)}</td><td class="text-right">${formatNumber(b.output_quantity)}</td><td class="text-right">${b.actual_yield_percent ? b.actual_yield_percent.toFixed(1) : '-'}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function printProductionBatch(batchId) {
    const result = await window.api.getProductionBatch(batchId);
    if (!result.success) return;
    const b = result.data;
    const settings = await getSettingsCached();
    const yieldPct = b.input_quantity > 0 ? (b.output_quantity / b.input_quantity) * 100 : 0;

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Production Batch: ${escapeHtml(b.batch_no)}</h2>
        <p>Date: ${formatDate(b.date)} | Shift: ${b.shift} | Process: ${escapeHtml(b.process_type)} | Operator: ${escapeHtml(b.operator_name||'')}</p></div>
        <table><thead><tr><th>Product</th><th class="text-right">Quantity</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
        <tbody>${(b.inputs||[]).map(inp => `<tr><td>📥 ${escapeHtml(inp.product_name)}</td><td class="text-right">${formatNumber(inp.quantity)} ${escapeHtml(inp.unit)}</td><td class="text-right">${formatCurrency(inp.rate)}</td><td class="text-right">${formatCurrency((inp.quantity||0)*(inp.rate||0))}</td></tr>`).join('')}
        ${(b.outputs||[]).map(out => `<tr><td>📦 ${escapeHtml(out.product_name)}</td><td class="text-right">${formatNumber(out.quantity)} ${escapeHtml(out.unit)}</td><td class="text-right">${formatCurrency(out.rate)}</td><td class="text-right">${formatCurrency((out.quantity||0)*(out.rate||0))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Yield</strong></td><td class="text-right"><strong>${yieldPct.toFixed(1)}%</strong></td><td colspan="2"></td></tr></tfoot></table>
        ${b.wastage_quantity > 0 ? `<p>⚠️ Wastage: ${formatNumber(b.wastage_quantity)} — ${escapeHtml(b.wastage_reason||'')}</p>` : ''}
        ${b.remarks ? `<p><strong>Remarks:</strong> ${escapeHtml(b.remarks)}</p>` : ''}
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Operator Signature</div></div>
    `;
    printHTML(html);
}

async function printProductionList() {
    const batches = window._lastProductionBatches || [];
    if (batches.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Production Batches</h2><p>Total: ${batches.length}</p></div>
        <table><thead><tr><th>Batch</th><th>Date</th><th>Process</th><th class="text-right">Input</th><th class="text-right">Output</th></tr></thead>
        <tbody>${batches.map(b => `<tr><td>${escapeHtml(b.batch_no)}</td><td>${formatDate(b.date)}</td><td>${escapeHtml(b.process_type)}</td><td class="text-right">${formatNumber(b.input_quantity)}</td><td class="text-right">${formatNumber(b.output_quantity)}</td></tr>`).join('')}</tbody></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportProductionPDF() { await printProductionList(); }

// Globals
window.renderProduction = renderProduction;
window.applyProdFilter = applyProdFilter;
window.resetProdFilter = resetProdFilter;
window.showProductionForm = showProductionForm;
window.saveProductionBatch = saveProductionBatch;
window.editProductionBatch = editProductionBatch;
window.viewProductionBatch = viewProductionBatch;
window.deleteProductionBatchEntry = deleteProductionBatchEntry;
window.addProdInput = addProdInput;
window.removeProdInput = removeProdInput;
window.addProdOutput = addProdOutput;
window.removeProdOutput = removeProdOutput;
window.updateInputName = updateInputName;
window.updateOutputName = updateOutputName;
window.calcProdAmounts = calcProdAmounts;
window.calcProdYield = calcProdYield;
window.showProductionReport = showProductionReport;
window.refreshProductionReport = refreshProductionReport;
window.printProductionReportData = printProductionReportData;
window.printProductionBatch = printProductionBatch;
window.printProductionList = printProductionList;
window.exportProductionPDF = exportProductionPDF;
