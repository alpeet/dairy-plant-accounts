/**
 * Production / Batch Processing Module
 * =====================================
 * Manage production batches: raw milk → finished goods with
 * yield tracking, wastage, and stock consumption/creation.
 */

let prodFilter = { search: '', from_date: '', to_date: '' };

// ── Lot-costing mode: after the cutover date, batches post through the
//    FIFO/NRV costing engine instead of the legacy rate-based engine. ──
let prodLotMode = null;
async function ensureProdLotMode() {
    if (prodLotMode !== null) return prodLotMode;
    try {
        if (!window.api.getLotCutover) { prodLotMode = false; return prodLotMode; }
        const r = await window.api.getLotCutover();
        prodLotMode = !!(r && r.success !== false && r.data);
    } catch (e) { prodLotMode = false; }
    return prodLotMode;
}

async function renderProduction() {
    await ensureProdLotMode();
    const container = document.getElementById('page-production');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading production batches...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showProductionForm()">+ New Batch</button>
        ${prodLotMode ? `
        <button class="btn btn-info btn-sm" onclick="showMilkLotsPanel()">🥛 Milk Lots</button>
        <button class="btn btn-info btn-sm" onclick="showStockLotsPanel()">📦 Stock Lots</button>
        <button class="btn btn-info btn-sm" onclick="showWastagePanel()">♻️ Wastage</button>
        <button class="btn btn-info btn-sm" onclick="showBatchMarginPanel()">📈 Batch Margin</button>
        <button class="btn btn-info btn-sm" onclick="showDailyReconciliationPanel()">🧾 Reconciliation</button>
        ` : ''}
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

        ${!prodLotMode ? `
        <div class="card" style="margin-bottom:16px;border-left:4px solid var(--warning, #f59e0b)">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:280px">
                    <strong>⚠ FIFO lot costing is not active</strong>
                    <div style="font-size:12px;color:var(--text-light);margin-top:4px">
                        Batches post through the legacy path, so lot COGS, Gross Margin and lot valuation are unavailable.
                        Activating records <em>Opening Stock lots</em> at master/standard rates dated <strong>${formatDate(today())}</strong>
                        and sets the <em>lot-tracking cutover</em>. Historical batches are never rebuilt — no invented production.
                    </div>
                </div>
                <button class="btn btn-warning btn-sm" onclick="activateLotCosting()">🔓 Activate lot costing from ${formatDate(today())}</button>
            </div>
        </div>` : ''}

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
                            <th class="text-right">Cost</th>
                            <th class="text-right">Yield %</th>
                            <th class="text-right">Wastage</th>
                            <th>Operator</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${batches.length === 0
                            ? '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-light)">No production batches yet. Start processing!</td></tr>'
                            : batches.map(b => `
                                <tr>
                                    <td><strong>${escapeHtml(b.batch_no)}</strong></td>
                                    <td>${formatDate(b.date)}</td>
                                    <td>${b.shift}</td>
                                    <td><span class="badge badge-primary">${escapeHtml(b.process_type || '-')}</span></td>
                                    <td class="text-right">${formatNumber(b.input_quantity)} ${b.input_quantity > 0 ? 'L' : ''}</td>
                                    <td class="text-right">${formatNumber(b.output_quantity)}</td>
                                    <td class="text-right">${b.total_cost ? formatCurrency(b.total_cost) : '-'}</td>
                                    <td class="text-right" style="color:${b.actual_yield_percent >= 80 ? 'var(--accent)' : 'var(--danger)'}">${b.actual_yield_percent ? b.actual_yield_percent.toFixed(1) + '%' : '-'}</td>
                                    <td class="text-right" style="color:${b.wastage_quantity > 0 ? 'var(--danger)' : 'var(--text-light)'}">${b.wastage_quantity > 0 ? formatNumber(b.wastage_quantity) : '-'}</td>
                                    <td>${escapeHtml(b.operator_name || '-')}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="viewProductionBatch(${b.id})" title="View">👁</button>
                                        ${b.status === 'reversed'
                                            ? `<button class="btn btn-primary btn-sm" onclick="editProductionBatch(${b.id})" title="Edit">✏️</button>`
                                            : `<button class="btn btn-primary btn-sm" onclick="editProductionBatch(${b.id})" title="Edit">✏️</button>
                                               <button class="btn btn-danger btn-sm" onclick="${prodLotMode && b.status === 'posted' ? `reverseProductionBatchEntry(${b.id})" title="Reverse (restore milk lots)` : `deleteProductionBatchEntry(${b.id})" title="Delete`}">🗑</button>`}
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

// ── Activation of the EXISTING lot engine (cutover + opening lots) ──
// Requirement: use the existing opening-stock/cutover mechanism; never invent
// historical production. This only creates opening lots for stock that exists
// NOW and flips the cutover so future batches consume real FIFO lots.
async function activateLotCosting() {
    try {
        const d = today();
        const stmt = await window.api.getStockStatement({});
        const items = (stmt && stmt.success && stmt.data && stmt.data.items) || [];
        const unit_costs = items
            .filter(i => (Number(i.current_stock) || 0) > 0)
            .map(i => ({ product_id: i.id, unit_cost: Number(i.rate) || 0 }));
        const res = await window.api.createOpeningStockLots({ date: d, unit_costs });
        if (res && res.success === false) {
            showToast(res.error || 'Activation failed', 'error');
            return;
        }
        prodLotMode = null; // re-read cutover on next render
        showToast(`Lot costing activated — opening lots for ${unit_costs.length} product(s), cutover ${formatDate(d)}.`, 'success');
        renderProduction();
    } catch (e) {
        showToast(String((e && e.message) || e), 'error');
    }
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
    const [productsResult, typesResult, lotMode] = await Promise.all([
        window.api.getProducts({ active_only: true }),
        window.api.getProcessTypes(),
        ensureProdLotMode()
    ]);

    const products = productsResult.success ? productsResult.data : [];
    const processTypes = typesResult.success ? typesResult.data : [];
    const rawMilkProducts = products.filter(p => String(p.category || '').toLowerCase() === 'milk'
        || /raw milk/i.test(String(p.name || '')));
    const finishedProducts = products.filter(p => !rawMilkProducts.includes(p));
    window._prodFinishedOptions = finishedProducts.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

    let batch = null;
    if (batchId) {
        const result = await window.api.getProductionBatch(batchId);
        if (result.success) batch = result.data;
    }

    const isEdit = !!batch;
    const todayStr = today();
    // Lot mode only applies to NEW batches — posted batches stay as recorded.
    const useLots = lotMode && !isEdit;

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
                        <input type="date" class="form-control" id="pbDate" value="${batch ? batch.date : todayStr}">
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
                    ${useLots ? `
                    <div class="form-group">
                        <label>Processing Cost (Rs)</label>
                        <input type="number" class="form-control" id="pbProcessingCost" value="0" step="0.01" min="0" placeholder="fuel, labour, packaging for this batch">
                    </div>
                    ` : ''}
                </div>

                <div class="form-section-title">Input Products (Raw Materials Consumed)${useLots ? ' — <span style="font-weight:400;font-size:12px;color:var(--text-light)">FIFO from milk lots</span>' : ''}</div>
                <div id="inputsContainer">
                    ${inputs.map((inp, i) => `
                        <div class="form-row-4" style="margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px">
                            ${useLots ? `
                            <div class="form-group" style="flex:2">
                                <label>Milk Type</label>
                                <select class="form-control input-product input-milktype" onchange="updateInputName(this)">
                                    <option value="cow" ${inp.milk_type === 'cow' ? 'selected' : ''}>Cow</option>
                                    <option value="buffalo" ${inp.milk_type === 'buffalo' ? 'selected' : ''}>Buffalo</option>
                                    <option value="mixed" ${inp.milk_type === 'mixed' ? 'selected' : ''}>Mixed</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Qty (L)</label>
                                <input type="number" class="form-control input-qty" value="${inp.quantity || ''}" step="0.01" min="0" oninput="calcProdAmounts();refreshProdCostingPreview()">
                            </div>
                            <div class="form-group">
                                <label>Lot Cost</label>
                                <input type="text" class="form-control" value="FIFO" readonly style="width:70px;color:var(--text-light)">
                            </div>
                            ` : `
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
                            `}
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-danger btn-sm" onclick="removeProdInput(this)" ${i === 0 ? 'style="visibility:hidden"' : ''}>✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addProdInput()">+ Add Input</button>
                ${useLots ? `
                <button type="button" class="btn btn-info btn-sm" onclick="refreshProdCostingPreview()" style="margin-left:8px">⚡ Preview Cost</button>
                ` : ''}

                <div class="form-section-title" style="margin-top:16px">Output Products (Finished Goods Produced)</div>
                <div id="outputsContainer">
                    ${outputs.map((out, i) => `
                        <div class="form-row-4" style="margin-bottom:8px;padding:8px;background:var(--bg);border-radius:4px">
                            ${useLots ? `
                            <div class="form-group" style="flex:2">
                                <label>Product</label>
                                <select class="form-control output-product" onchange="updateOutputName(this)">
                                    <option value="">-- Select --</option>
                                    ${(products.filter(p => p.id !== 0 && String(p.category || '').toLowerCase() !== 'milk')).map(p => `<option value="${p.id}" ${out.product_id == p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Qty</label>
                                <input type="number" class="form-control output-qty" value="${out.quantity || ''}" step="0.01" min="0" oninput="calcProdAmounts();refreshProdCostingPreview()">
                            </div>
                            <div class="form-group">
                                <label>Std Price</label>
                                <input type="text" class="form-control" value="NRV" readonly style="width:70px;color:var(--text-light)">
                            </div>
                            ` : `
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
                            `}
                            <div class="form-group">
                                <label>&nbsp;</label>
                                <button class="btn btn-danger btn-sm" onclick="removeProdOutput(this)" ${i === 0 ? 'style="visibility:hidden"' : ''}>✕</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" onclick="addProdOutput()">+ Add Output</button>

                ${useLots ? `
                <div class="form-section-title" style="margin-top:16px">Live Costing Preview</div>
                <div id="pbCostingPreview" style="padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px;color:var(--text-light)">Enter inputs to preview FIFO lot costs…</div>
                ` : ''}

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
    const lotModeRow = document.getElementById('pbCostingPreview') !== null;
    row.innerHTML = lotModeRow ? `
        <div class="form-group" style="flex:2">
            <label>Milk Type</label>
            <select class="form-control input-product input-milktype" onchange="updateInputName(this)">
                <option value="cow">Cow</option>
                <option value="buffalo">Buffalo</option>
                <option value="mixed">Mixed</option>
            </select>
        </div>
        <div class="form-group"><label>Qty (L)</label><input type="number" class="form-control input-qty" step="0.01" min="0" oninput="calcProdAmounts();refreshProdCostingPreview()"></div>
        <div class="form-group"><label>Lot Cost</label><input type="text" class="form-control" value="FIFO" readonly style="width:70px;color:var(--text-light)"></div>
        <div class="form-group"><label>&nbsp;</label><button class="btn btn-danger btn-sm" onclick="removeProdInput(this)">✕</button></div>
    ` : `
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
    const lotModeRow2 = document.getElementById('pbCostingPreview') !== null;
    row.innerHTML = lotModeRow2 ? `
        <div class="form-group" style="flex:2">
            <label>Product</label>
            <select class="form-control output-product" onchange="updateOutputName(this)">
                <option value="">-- Select --</option>
                ${(window._prodFinishedOptions || '').replace(/selected/g, '')}
            </select>
        </div>
        <div class="form-group"><label>Qty</label><input type="number" class="form-control output-qty" step="0.01" min="0" oninput="calcProdAmounts();refreshProdCostingPreview()"></div>
        <div class="form-group"><label>Std Price</label><input type="text" class="form-control" value="NRV" readonly style="width:70px;color:var(--text-light)"></div>
        <div class="form-group"><label>&nbsp;</label><button class="btn btn-danger btn-sm" onclick="removeProdOutput(this)">✕</button></div>
    ` : `
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
    // Lot mode is active only for NEW batches (existing ones keep their engine).
    const useLots = !!document.getElementById('pbCostingPreview');

    if (!batchNo) { showToast('Batch number is required', 'error'); return; }
    if (!date) { showToast('Date is required', 'error'); return; }
    if (!processType) { showToast('Process type is required', 'error'); return; }

    // Gather inputs
    const inputRows = document.querySelectorAll('#inputsContainer .form-row-4');
    const inputs = [];
    inputRows.forEach(row => {
        const qty = parseFloat(row.querySelector('.input-qty')?.value || 0);
        const sel = row.querySelector('.input-product');
        if (useLots) {
            const milkType = (row.querySelector('.input-milktype')?.value || sel?.value || 'cow').toLowerCase();
            if (qty > 0 && milkType) {
                inputs.push({ milk_type: milkType === 'mixed' ? 'cow' : milkType, quantity: qty });
            }
        } else {
            const unit = row.querySelector('.input-unit')?.value || 'liter';
            const rate = parseFloat(row.querySelector('.input-rate')?.value || 0);
            const pid = parseInt(sel?.value || 0);
            const pname = sel?.dataset?.name || sel?.options[sel?.selectedIndex]?.text || '';
            if (pid > 0 && qty > 0) {
                inputs.push({ product_id: pid, product_name: pname, quantity: qty, unit, rate });
            }
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

    let result;
    if (useLots && !batchId) {
        // NEW in lot mode → FIFO/NRV costing engine (creates stock lots + real COGS)
        const processingCost = parseFloat(document.getElementById('pbProcessingCost')?.value || 0);
        result = await window.api.postProductionBatchCosted({
            batch_no: batchNo,
            date,
            shift,
            process_type: processType,
            processing_cost: processingCost,
            inputs,
            outputs: outputs.map(o => ({ product_id: o.product_id, product_name: o.product_name, quantity: o.quantity, unit: o.unit })),
            operator_name: operatorName,
            remarks,
            yield_note: wastageQty > 0 ? `wastage ${wastageQty}: ${wastageReason}` : (remarks || '')
        });
    } else {
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
        result = await window.api.saveProductionBatch(data);
    }

    if (result.success !== false && (result.id || result.success || result.data)) {
        closeModal();
        const extra = useLots && !batchId && result.total_cost ? ` — cost ${formatCurrency(result.total_cost)} (${result.allocation_method || 'nrv'}${result.approximate ? ', approximate' : ''})` : '';
        showToast((batchId ? 'Batch updated' : 'Batch posted') + extra, 'success');
        renderProduction();
    } else {
        showToast(result.error || result.message || 'Failed to save batch', 'error');
    }
}

// ============================================================
// Live costing preview (lot mode)
// ============================================================
let _prodPreviewTimer = null;
async function refreshProdCostingPreview() {
    clearTimeout(_prodPreviewTimer);
    _prodPreviewTimer = setTimeout(async () => {
        const box = document.getElementById('pbCostingPreview');
        if (!box) return;
        const date = document.getElementById('pbDate')?.value || today();
        const processingCost = parseFloat(document.getElementById('pbProcessingCost')?.value || 0);
        const inputs = [];
        document.querySelectorAll('#inputsContainer .form-row-4').forEach(row => {
            const qty = parseFloat(row.querySelector('.input-qty')?.value || 0);
            const sel = row.querySelector('.input-milktype') || row.querySelector('.input-product');
            const milkType = (sel?.value || 'cow').toLowerCase();
            if (qty > 0) inputs.push({ milk_type: milkType === 'mixed' ? 'cow' : milkType, quantity: qty });
        });
        const outputs = [];
        document.querySelectorAll('#outputsContainer .form-row-4').forEach(row => {
            const pid = parseInt(row.querySelector('.output-product')?.value || 0);
            const qty = parseFloat(row.querySelector('.output-qty')?.value || 0);
            if (pid > 0 && qty > 0) outputs.push({ product_id: pid, quantity: qty });
        });
        if (!inputs.length) { box.innerHTML = 'Enter inputs to preview FIFO lot costs…'; return; }
        try {
            const r = await window.api.previewBatchCosting({ date, processing_cost: processingCost, inputs, outputs });
            const d = r && r.success !== false ? (r.data || r) : null;
            if (!d) { box.innerHTML = '<span style="color:var(--danger)">Preview unavailable</span>'; return; }
            const warn = (d.warnings || []).map(w => `⚠️ ${escapeHtml(w)}`).join('<br>');
            box.innerHTML = `
                <div><strong>Input cost:</strong> ${formatCurrency(d.input_cost || 0)}
                · <strong>Processing:</strong> ${formatCurrency(d.processing_cost || 0)}
                · <strong>Total:</strong> <span style="color:var(--accent);font-weight:700">${formatCurrency(d.total_cost || 0)}</span>
                · Allocation: ${escapeHtml(String(d.allocation_method || '-'))}${d.approximate ? ' <span style="color:var(--warning)">(approximate)</span>' : ''}</div>
                ${(d.inputs || []).map(i => `<div style="margin-top:4px">🥛 ${escapeHtml(i.milk_type)} ${formatNumber(i.quantity)} L → ${formatCurrency(i.suggested_input_cost || 0)}${i.shortfall > 0 ? ` <span style="color:var(--danger)">short ${formatNumber(i.shortfall)} L</span>` : ''}</div>`).join('')}
                ${(d.allocations || []).map(a => `<div>📦 ${escapeHtml(a.product_name || ('Product #' + a.product_id))}: ${formatNumber(a.quantity)} @ ${formatCurrency(a.unit_cost || 0)}</div>`).join('')}
                ${warn ? `<div style="margin-top:6px;color:var(--warning)">${warn}</div>` : ''}
            `;
        } catch (e) {
            box.innerHTML = `<span style="color:var(--danger)">Preview failed: ${escapeHtml(e.message || String(e))}</span>`;
        }
    }, 350);
}

// ============================================================
// Lot panels — milk lots, stock lots, wastage, margin, reconciliation
// ============================================================
async function showMilkLotsPanel() {
    const r = await window.api.getMilkLots({});
    const lots = (r && r.success !== false) ? (r.data || r) : (Array.isArray(r) ? r : []);
    const rows = Array.isArray(lots) ? lots : (lots.lots || []);
    const totalRemaining = rows.reduce((s, l) => s + (Number(l.qty_remaining) || 0), 0);
    const totalValue = rows.reduce((s, l) => s + (Number(l.qty_remaining) || 0) * (Number(l.unit_cost) || 0), 0);
    showModal(`
        <div class="modal-header"><h2>🥛 Raw Milk Lots (open)</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <div class="summary-cards" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
                <div class="summary-card card-info" style="margin:0;padding:10px"><span class="label">Open Quantity</span><span class="value" style="font-size:18px">${formatNumber(totalRemaining)} L</span></div>
                <div class="summary-card card-success" style="margin:0;padding:10px"><span class="label">Open Value (at lot cost)</span><span class="value" style="font-size:18px">${formatCurrency(totalValue)}</span></div>
            </div>
            ${rows.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-light)">No open milk lots</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Lot</th><th>Date</th><th>Type</th><th class="text-right">Qty</th><th class="text-right">Remaining</th><th class="text-right">Unit Cost</th><th class="text-right">Value</th></tr></thead>
                <tbody>${rows.map(l => `<tr>
                    <td>#${l.id}${l.collection_id ? ` <span style="color:var(--text-light)">(MC ${escapeHtml(String(l.collection_id))})</span>` : ''}</td>
                    <td>${formatDate(l.date)}</td><td>${escapeHtml(String(l.milk_type || ''))}</td>
                    <td class="text-right">${formatNumber(l.quantity)}</td>
                    <td class="text-right"><strong>${formatNumber(l.qty_remaining)}</strong></td>
                    <td class="text-right">${formatCurrency(l.unit_cost)}</td>
                    <td class="text-right">${formatCurrency((Number(l.qty_remaining) || 0) * (Number(l.unit_cost) || 0))}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>
    `);
}

async function showStockLotsPanel() {
    const r = await window.api.getStockLots({ open_only: true });
    const rows = Array.isArray(r) ? r : ((r && (r.data || r.lots)) || []);
    const totalValue = rows.reduce((s, l) => s + (Number(l.qty_remaining) || 0) * (Number(l.unit_cost) || 0), 0);
    showModal(`
        <div class="modal-header"><h2>📦 Finished-Goods Stock Lots (open)</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px">
                Open lot value: <strong>${formatCurrency(totalValue)}</strong> — sales consume these oldest-first (FIFO) and COGS follows actual lot cost.
            </div>
            ${rows.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-light)">No open stock lots</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Lot</th><th>Product</th><th>Produced</th><th>Expires</th><th class="text-right">Remaining</th><th class="text-right">Unit Cost</th><th class="text-right">Value</th></tr></thead>
                <tbody>${rows.map(l => `<tr>
                    <td>#${l.id} <span style="color:var(--text-light)">B${escapeHtml(String(l.batch_id || ''))}</span></td>
                    <td>${escapeHtml(l.product_name || ('#' + l.product_id))}</td>
                    <td>${formatDate(l.produced_date)}</td>
                    <td>${l.expires_date ? formatDate(l.expires_date) : '—'}</td>
                    <td class="text-right"><strong>${formatNumber(l.qty_remaining)}</strong></td>
                    <td class="text-right">${formatCurrency(l.unit_cost)}</td>
                    <td class="text-right">${formatCurrency((Number(l.qty_remaining) || 0) * (Number(l.unit_cost) || 0))}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-warning" onclick="closeModal();showExpiredPanel()">⏰ Expired / Write-off</button>
        </div>
    `);
}

async function showExpiredPanel() {
    const r = await window.api.getExpiredLots({});
    const rows = Array.isArray(r) ? r : ((r && (r.data || r.lots)) || []);
    showModal(`
        <div class="modal-header"><h2>⏰ Expired Stock Lots</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            ${rows.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--accent)">✓ No expired lots</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Product</th><th>Produced</th><th>Expired</th><th class="text-right">Remaining</th><th class="text-right">Write-off Value</th></tr></thead>
                <tbody>${rows.map(l => `<tr>
                    <td>${escapeHtml(l.product_name || ('#' + l.product_id))}</td>
                    <td>${formatDate(l.produced_date)}</td><td>${formatDate(l.expires_date)}</td>
                    <td class="text-right">${formatNumber(l.qty_remaining)}</td>
                    <td class="text-right" style="color:var(--danger)">${formatCurrency((Number(l.qty_remaining) || 0) * (Number(l.unit_cost) || 0))}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            ${rows.length > 0 ? '<button class="btn btn-danger" onclick="writeOffExpiredConfirm()">♻️ Write Off Expired Stock</button>' : ''}
        </div>
    `);
}

async function writeOffExpiredConfirm() {
    const ok = await confirmAction('Write off ALL expired lots?', 'This zeroes expired lots at their actual cost and records wastage. Stock ledger gets adjustment entries. This cannot be undone.');
    if (!ok) return;
    const r = await window.api.writeOffExpiredStock({ reason: 'Expired stock write-off' });
    if (r && r.success !== false) {
        const d = r.data || r;
        showToast(`Written off ${d.lots ?? d.count ?? 0} lots worth ${formatCurrency(d.total_cost ?? d.totalCost ?? 0)}`, 'success');
        closeModal();
        renderProduction();
    } else {
        showToast((r && r.error) || 'Write-off failed', 'error');
    }
}

async function showWastagePanel() {
    const preset = getDatePreset('this_month');
    const from = preset.from, to = preset.to;
    const r = await window.api.getWastageReport({ from_date: from, to_date: to });
    const d = (r && r.success !== false) ? (r.data || r) : { rows: [], total_cost: 0, total_quantity: 0 };
    const rows = d.rows || [];
    showModal(`
        <div class="modal-header"><h2>♻️ Wastage & Expiry (${formatDate(from)} – ${formatDate(to)})</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <div class="summary-cards" style="grid-template-columns:1fr 1fr;margin-bottom:12px">
                <div class="summary-card card-warning" style="margin:0;padding:10px"><span class="label">Total Quantity</span><span class="value" style="font-size:18px">${formatNumber(d.total_quantity || 0)}</span></div>
                <div class="summary-card card-danger" style="margin:0;padding:10px"><span class="label">Total Cost</span><span class="value" style="font-size:18px">${formatCurrency(d.total_cost || 0)}</span></div>
            </div>
            ${rows.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-light)">No wastage recorded in this period</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Date</th><th>Product</th><th>Reason</th><th class="text-right">Qty</th><th class="text-right">Cost</th></tr></thead>
                <tbody>${rows.map(w => `<tr>
                    <td>${formatDate(w.date)}</td>
                    <td>${escapeHtml(w.product_name || (w.lot_type === 'milk' ? `Raw milk (${w.milk_type || '-'})` : '#'+w.product_id))}</td>
                    <td>${escapeHtml(w.reason || '')}</td>
                    <td class="text-right">${formatNumber(w.quantity)}</td>
                    <td class="text-right" style="color:var(--danger)">${formatCurrency(w.total_cost)}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            <button class="btn btn-warning" onclick="closeModal();showRecordWastageForm()">+ Record Wastage</button>
        </div>
    `);
}

async function showRecordWastageForm() {
    const [productsR] = await Promise.all([window.api.getProducts({ active_only: true })]);
    const products = productsR.success ? productsR.data : [];
    showModal(`
        <div class="modal-header"><h2>Record Wastage / Loss</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <div class="form-group">
                <label>Lot Type</label>
                <select class="form-control" id="wastLotType" onchange="document.getElementById('wastMilkRow').style.display=this.value==='milk'?'block':'none';document.getElementById('wastProductRow').style.display=this.value==='milk'?'none':'block'">
                    <option value="stock">Finished goods</option>
                    <option value="milk">Raw milk</option>
                </select>
            </div>
            <div class="form-group" id="wastProductRow">
                <label>Product</label>
                <select class="form-control" id="wastProductId">
                    ${products.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" id="wastMilkRow" style="display:none">
                <label>Milk Type</label>
                <select class="form-control" id="wastMilkType">
                    <option value="cow">Cow</option><option value="buffalo">Buffalo</option>
                </select>
            </div>
            <div class="form-group"><label>Quantity</label><input type="number" class="form-control" id="wastQty" step="0.01" min="0.01"></div>
            <div class="form-group"><label>Reason</label><input type="text" class="form-control" id="wastReason" placeholder="spillage, spoilage, testing…"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="submitWastage()">Record</button>
        </div>
    `);
}

async function submitWastage() {
    const lotType = document.getElementById('wastLotType')?.value || 'stock';
    const qty = parseFloat(document.getElementById('wastQty')?.value || 0);
    if (!(qty > 0)) { showToast('Quantity must be positive', 'error'); return; }
    const payload = lotType === 'milk'
        ? { lot_type: 'milk', milk_type: document.getElementById('wastMilkType')?.value || 'cow', quantity: qty, reason: document.getElementById('wastReason')?.value || 'wastage' }
        : { lot_type: 'stock', product_id: parseInt(document.getElementById('wastProductId')?.value || 0), quantity: qty, reason: document.getElementById('wastReason')?.value || 'wastage' };
    const r = await window.api.recordWastage(payload);
    if (r && r.success !== false) {
        showToast('Wastage recorded at lot cost', 'success');
        closeModal();
        renderProduction();
    } else {
        showToast((r && r.error) || 'Failed to record wastage', 'error');
    }
}

async function showBatchMarginPanel() {
    const preset = getDatePreset('this_month');
    const r = await window.api.getBatchMargin({ from_date: preset.from, to_date: preset.to });
    const rows = Array.isArray(r) ? r : ((r && (r.data || r.batches)) || []);
    showModal(`
        <div class="modal-header"><h2>📈 Batch Margin / Profitability</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            ${rows.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--text-light)">No costed batches in this period</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Batch</th><th>Date</th><th class="text-right">Total Cost</th><th class="text-right">Revenue</th><th class="text-right">COGS (sold)</th><th class="text-right">Gross Margin</th><th class="text-right">Stock Left</th></tr></thead>
                <tbody>${rows.map(b => `
                    <tr><td rowspan="${b.outputs.length}"><strong>${escapeHtml(b.batch_no)}</strong><br><span style="font-size:11px;color:var(--text-light)">${formatDate(b.date)} · ${escapeHtml(b.process_type || '')}${b.approximate ? ' · <span style="color:var(--warning)">approx</span>' : ''}</span></td>
                    <td rowspan="${b.outputs.length}">${formatCurrency(b.total_cost)}<br><span style="font-size:11px;color:var(--text-light)">${escapeHtml(b.allocation_method || '')}</span></td>
                    ${b.outputs.map((o, i) => `${i > 0 ? '<tr>' : ''}
                        <td class="text-right">${formatCurrency(o.revenue)}</td>
                        <td class="text-right">${formatCurrency(o.actual_cogs)}</td>
                        <td class="text-right" style="color:${o.gross_margin >= 0 ? 'var(--accent)' : 'var(--danger)'}"><strong>${formatCurrency(o.gross_margin)}</strong></td>
                        <td class="text-right">${formatNumber(o.remaining_stock)} ${escapeHtml(o.product_name || '')}</td>
                    ${i > 0 ? '</tr>' : ''}`).join('')}
                </tr>`).join('')}
                </tbody>
            </table></div>`}
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>
    `);
}

let _drRecState = { from: '', to: '', preset: 'this_month' };
function drRecPreset(p) {
    const r = getDatePreset(p);
    _drRecState.preset = p;
    _drRecState.from = r.from;
    _drRecState.to = r.to;
    showDailyReconciliationPanel();
}
function drRecApply() {
    _drRecState.preset = 'custom';
    _drRecState.from = document.getElementById('drRecFrom')?.value || '';
    _drRecState.to = document.getElementById('drRecTo')?.value || '';
    showDailyReconciliationPanel();
}

async function showDailyReconciliationPanel() {
    if (!_drRecState.from && !_drRecState.to) {
        const p = getDatePreset(_drRecState.preset === 'custom' ? 'this_month' : _drRecState.preset);
        _drRecState.from = p.from;
        _drRecState.to = p.to;
    }
    const r = await window.api.getDailyReconciliation({ from_date: _drRecState.from, to_date: _drRecState.to });
    const d = (r && r.success !== false) ? (r.data || r) : { finished_goods: [], raw_milk: [] };
    const fg = d.finished_goods || [], rm = d.raw_milk || [];
    const mc = d.milk_collections || { morning: 0, evening: 0, total_liters: 0, total_amount: 0 };
    const pu = d.purchases || { count: 0, total: 0 };
    showModal(`
        <div class="modal-header"><h2>🧾 Daily Stock Reconciliation</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body" style="max-height:75vh;overflow-y:auto">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">
                <span style="font-size:12px;color:var(--text-light);font-weight:600">Period:</span>
                ${['today', 'yesterday', 'this_week', 'this_month', 'last_month', 'this_year', 'all']
                    .map(p => `<button type="button" class="btn btn-sm ${_drRecState.preset === p ? 'btn-primary' : 'btn-secondary'}" onclick="drRecPreset('${p}')">${DATE_PRESET_LABELS[p] || p}</button>`).join('')}
                <input type="date" class="form-control" id="drRecFrom" value="${_drRecState.from || ''}" style="width:auto">
                <input type="date" class="form-control" id="drRecTo" value="${_drRecState.to || ''}" style="width:auto">
                <button type="button" class="btn btn-primary btn-sm" onclick="drRecApply()">Apply</button>
            </div>
            <div style="display:flex;gap:18px;flex-wrap:wrap;padding:8px 12px;background:var(--bg);border-radius:6px;font-size:13px;margin-bottom:12px">
                <span>🌅 <strong>Morning collection:</strong> ${formatNumber(mc.morning)} L</span>
                <span>🌙 <strong>Evening collection:</strong> ${formatNumber(mc.evening)} L</span>
                <span>🥛 <strong>Total:</strong> ${formatNumber(mc.total_liters)} L (${formatCurrency(mc.total_amount)})</span>
                <span>🧾 <strong>Purchases:</strong> ${pu.count} bill(s) — ${formatCurrency(pu.total)}</span>
            </div>
            <h4 style="font-size:13px;color:var(--text-light)">Finished Goods</h4>
            ${fg.length === 0 ? '<div style="color:var(--text-light);font-size:13px">No finished-goods movement in this period</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Product</th><th class="text-right">Opening</th><th class="text-right">Produced</th><th class="text-right">Sold</th><th class="text-right">Wastage</th><th class="text-right">Closing</th><th>✓</th></tr></thead>
                <tbody>${fg.map(x => `<tr>
                    <td>${escapeHtml(x.product_name)}</td>
                    <td class="text-right">${formatNumber(x.opening)}</td>
                    <td class="text-right">${formatNumber(x.production)}</td>
                    <td class="text-right">${formatNumber(x.sold)}</td>
                    <td class="text-right">${formatNumber(x.wastage)}</td>
                    <td class="text-right"><strong>${formatNumber(x.closing)}</strong></td>
                    <td>${x.identity_ok ? '<span style="color:var(--accent)">✓</span>' : '<span style="color:var(--danger)">✗</span>'}</td>
                </tr>`).join('')}</tbody>
            </table></div>`}
            <h4 style="font-size:13px;color:var(--text-light);margin-top:14px">Raw Milk</h4>
            ${rm.length === 0 ? '<div style="color:var(--text-light);font-size:13px">No raw-milk movement in this period</div>' : `
            <div class="table-container"><table>
                <thead><tr><th>Product</th><th class="text-right">Opening</th><th class="text-right">Collected</th><th class="text-right">Consumed</th><th class="text-right">Closing</th></tr></thead>
                <tbody>${rm.map(x => `<tr>
                    <td>${escapeHtml(x.product_name)}</td>
                    <td class="text-right">${formatNumber(x.opening)}</td>
                    <td class="text-right">${formatNumber(x.deliveries)}</td>
                    <td class="text-right">${formatNumber(x.consumed)}</td>
                    <td class="text-right"><strong>${formatNumber(x.closing !== undefined ? x.closing : (x.opening + x.deliveries - x.consumed))}</strong></td>
                </tr>`).join('')}</tbody>
            </table></div>`}
        </div>
        <div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>
    `);
}

async function reverseProductionBatchEntry(id) {
    const reason = prompt('Reason for reversing this batch? (milk lots will be restored)');
    if (reason === null) return;
    const r = await window.api.reverseProductionBatch(id, reason || 'Reversed from production screen');
    if (r && r.success !== false) {
        showToast('Batch reversed — milk lots restored', 'success');
        renderProduction();
    } else {
        showToast((r && r.error) || 'Reversal failed', 'error');
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

// Lot-costing panels
window.refreshProdCostingPreview = refreshProdCostingPreview;
window.showMilkLotsPanel = showMilkLotsPanel;
window.showStockLotsPanel = showStockLotsPanel;
window.showExpiredPanel = showExpiredPanel;
window.writeOffExpiredConfirm = writeOffExpiredConfirm;
window.showWastagePanel = showWastagePanel;
window.showRecordWastageForm = showRecordWastageForm;
window.submitWastage = submitWastage;
window.showBatchMarginPanel = showBatchMarginPanel;
window.showDailyReconciliationPanel = showDailyReconciliationPanel;
window.reverseProductionBatchEntry = reverseProductionBatchEntry;
