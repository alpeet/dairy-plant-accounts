/**
 * Production Setup
 * ================
 * Configures the two registers that drive the dairy costing engine:
 *   1. Production Overheads — electricity, boiler/fuel, labour, packaging,
 *      water, CIP, refrigeration, other. Each line applies to a batch on its
 *      chosen basis (per input litre / per batch / % of input cost).
 *   2. Yield Standards — expected yield % per process with low/high warning
 *      bands, used to flag batches for review.
 *
 * All persistence goes through the backend (window.api) — the page never
 * writes a cost itself.
 */

const PROD_SETUP_BASES = {
    per_input_liter: 'Per input litre',
    per_batch: 'Per batch',
    percent_of_input_cost: '% of input cost'
};

let prodSetupCache = { overheads: [], yields: [], processes: [], products: [] };

async function renderProductionSetup() {
    const container = document.getElementById('page-production-setup');
    if (!container) return;

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="prodSetupAddOverhead()">+ Add Overhead</button>
        <button class="btn btn-info btn-sm" onclick="prodSetupAddYield(null)">+ Add Yield Standard</button>
    `;

    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading production setup…</div>';

    const [ohR, ylR, ptR, prR] = await Promise.all([
        window.api.getProductionOverheads({}),
        window.api.getYieldStandards({}),
        window.api.getProcessTypes ? window.api.getProcessTypes() : Promise.resolve({ data: [] }),
        window.api.getProducts ? window.api.getProducts({}) : Promise.resolve({ data: [] })
    ]);
    prodSetupCache.overheads = unwrap(ohR, []);
    prodSetupCache.yields = unwrap(ylR, []);
    prodSetupCache.processes = unwrap(ptR, []).map(p => p.process_type || p).filter(Boolean);
    prodSetupCache.products = unwrap(prR, []);

    prodSetupRender();
}

function unwrap(r, fallback) {
    if (!r) return fallback;
    if (r.success === false) return fallback;
    return r.data != null ? r.data : (Array.isArray(r) ? r : fallback);
}

function prodSetupRender() {
    const container = document.getElementById('page-production-setup');
    const oh = prodSetupCache.overheads;
    const ys = prodSetupCache.yields;

    const ohRows = oh.map(o => `
        <tr data-id="${o.id}">
            <td><input class="form-control" data-f="name" value="${escapeHtml(o.name)}"></td>
            <td>
                <select class="form-control" data-f="basis">
                    ${Object.entries(PROD_SETUP_BASES).map(([k, v]) => `<option value="${k}" ${o.basis === k ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" step="0.01" min="0" class="form-control" data-f="rate" value="${Number(o.rate) || 0}"></td>
            <td style="text-align:center"><input type="checkbox" data-f="active" ${o.active ? 'checked' : ''}></td>
            <td class="text-right" style="white-space:nowrap">
                <button class="btn btn-primary btn-sm" onclick="prodSetupSaveOverhead(${o.id})">Save</button>
                <button class="btn btn-danger btn-sm" onclick="prodSetupDeleteOverhead(${o.id})">✕</button>
            </td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-light)">No overheads configured</td></tr>';

    const yRows = ys.map(y => `
        <tr data-id="${y.id}">
            <td><input class="form-control" data-f="process_type" list="prodSetupProcesses" value="${escapeHtml(y.process_type)}"></td>
            <td>
                <select class="form-control" data-f="output_product_id">
                    <option value="">All products</option>
                    ${prodSetupCache.products.map(p => `<option value="${p.id}" ${Number(y.output_product_id) === Number(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                </select>
            </td>
            <td><input type="number" step="0.01" min="0" max="100" class="form-control" data-f="expected_yield_percent" value="${Number(y.expected_yield_percent) || 0}"></td>
            <td><input type="number" step="0.01" min="0" max="100" class="form-control" data-f="warn_low_percent" value="${Number(y.warn_low_percent) || 0}"></td>
            <td><input type="number" step="0.01" min="0" max="100" class="form-control" data-f="warn_high_percent" value="${Number(y.warn_high_percent) || 0}"></td>
            <td class="text-right" style="white-space:nowrap">
                <button class="btn btn-primary btn-sm" onclick="prodSetupSaveYield(${y.id})">Save</button>
                <button class="btn btn-danger btn-sm" onclick="prodSetupDeleteYield(${y.id})">✕</button>
            </td>
        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-light)">No yield standards configured</td></tr>';

    container.innerHTML = `
        <datalist id="prodSetupProcesses">${prodSetupCache.processes.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
        <div class="card" style="margin-bottom:16px">
            <h3 style="margin-top:0">⚙️ Production Overheads</h3>
            <p style="color:var(--text-light);font-size:13px;margin-top:-6px">
                Applied to a batch's processing cost when the operator does not itemise a breakdown.
                A zero rate is never charged. Rate 0 lines are simply ignored.
            </p>
            <table class="data-table">
                <thead><tr><th style="min-width:170px">Name</th><th>Basis</th><th style="width:130px">Rate</th><th style="width:70px;text-align:center">Active</th><th></th></tr></thead>
                <tbody id="prodSetupOhBody">${ohRows}</tbody>
            </table>
            <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="prodSetupAddOverhead()">+ Add Overhead</button>
        </div>
        <div class="card">
            <h3 style="margin-top:0">📐 Yield Standards</h3>
            <p style="color:var(--text-light);font-size:13px;margin-top:-6px">
                Expected yield % per process. A posted batch below Warn&nbsp;Low or above Warn&nbsp;High is flagged for review
                (leave a band at 0 to default to ±10% of expected).
            </p>
            <table class="data-table">
                <thead><tr><th style="min-width:160px">Process Type</th><th>Output Product</th>
                    <th style="width:120px">Expected %</th><th style="width:120px">Warn Low %</th><th style="width:120px">Warn High %</th><th></th></tr></thead>
                <tbody id="prodSetupYieldBody">${yRows}</tbody>
            </table>
            <button class="btn btn-secondary btn-sm" style="margin-top:10px" onclick="prodSetupAddYield(null)">+ Add Yield Standard</button>
        </div>
    `;
}

function prodSetupRowValues(tr) {
    const val = (f) => tr.querySelector(`[data-f="${f}"]`)?.value;
    const checked = (f) => tr.querySelector(`[data-f="${f}"]`)?.checked;
    return {
        name: val('name'),
        basis: val('basis'),
        rate: parseFloat(val('rate')) || 0,
        active: checked('active'),
        process_type: val('process_type'),
        output_product_id: val('output_product_id') || null,
        expected_yield_percent: parseFloat(val('expected_yield_percent')) || 0,
        warn_low_percent: parseFloat(val('warn_low_percent')) || 0,
        warn_high_percent: parseFloat(val('warn_high_percent')) || 0
    };
}

async function prodSetupSaveOverhead(id) {
    const tr = document.querySelector(`#prodSetupOhBody tr[data-id="${id}"]`);
    if (!tr) return;
    const v = prodSetupRowValues(tr);
    const r = await window.api.saveProductionOverhead({ id, name: v.name, basis: v.basis, rate: v.rate, active: v.active });
    if (r && r.success !== false) { showToast('Overhead saved', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not save overhead', 'error');
}

async function prodSetupAddOverhead() {
    const name = prompt('Overhead name (e.g. Electricity):');
    if (!name) return;
    const r = await window.api.saveProductionOverhead({ name: name.trim(), basis: 'per_input_liter', rate: 0, active: true });
    if (r && r.success !== false) { showToast('Overhead added', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not add overhead', 'error');
}

async function prodSetupDeleteOverhead(id) {
    if (!(await confirmAction('Delete this overhead line?', 'Batches are never recalculated — this only affects future batches.'))) return;
    const r = await window.api.deleteProductionOverhead(id);
    if (r && r.success !== false) { showToast('Overhead deleted', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not delete', 'error');
}

async function prodSetupSaveYield(id) {
    const tr = document.querySelector(`#prodSetupYieldBody tr[data-id="${id}"]`);
    if (!tr) return;
    const v = prodSetupRowValues(tr);
    const r = await window.api.saveYieldStandard({
        id, process_type: v.process_type, output_product_id: v.output_product_id,
        expected_yield_percent: v.expected_yield_percent,
        warn_low_percent: v.warn_low_percent, warn_high_percent: v.warn_high_percent
    });
    if (r && r.success !== false) { showToast('Yield standard saved', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not save yield standard', 'error');
}

async function prodSetupAddYield() {
    showModal(`
        <div class="modal-header"><h2>New Yield Standard</h2><button class="close-btn" onclick="closeModal()">&times;</button></div>
        <div class="modal-body">
            <div class="form-group"><label>Process Type</label>
                <input class="form-control" id="psProcess" list="prodSetupProcesses" placeholder="e.g. GHEE_MAKING"></div>
            <div class="form-row">
                <div class="form-group"><label>Expected Yield %</label><input type="number" step="0.01" class="form-control" id="psExpected" value="0"></div>
                <div class="form-group"><label>Warn Low %</label><input type="number" step="0.01" class="form-control" id="psLow" value="0"></div>
                <div class="form-group"><label>Warn High %</label><input type="number" step="0.01" class="form-control" id="psHigh" value="0"></div>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="prodSetupCreateYield()">Save</button>
        </div>
    `);
}

async function prodSetupCreateYield() {
    const v = {
        process_type: document.getElementById('psProcess').value.trim(),
        expected_yield_percent: parseFloat(document.getElementById('psExpected').value) || 0,
        warn_low_percent: parseFloat(document.getElementById('psLow').value) || 0,
        warn_high_percent: parseFloat(document.getElementById('psHigh').value) || 0
    };
    if (!v.process_type) { showToast('Process type is required', 'warning'); return; }
    const r = await window.api.saveYieldStandard(v);
    if (r && r.success !== false) { closeModal(); showToast('Yield standard added', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not add yield standard', 'error');
}

async function prodSetupDeleteYield(id) {
    if (!(await confirmAction('Delete this yield standard?', 'Existing batches are not recalculated.'))) return;
    const r = await window.api.deleteYieldStandard(id);
    if (r && r.success !== false) { showToast('Yield standard deleted', 'success'); renderProductionSetup(); }
    else showToast((r && r.error) || 'Could not delete', 'error');
}
