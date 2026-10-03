/**
 * Milk Rate Chart Management Module
 * ==================================
 * Manage dated milk rate history: formula-based (FAT/SNF multipliers) or fixed rates.
 * Includes rate history list, add/edit form, effective rate lookup.
 */

async function renderRateCharts() {
    const container = document.getElementById('page-rate-charts');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading rate charts...</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="showRateChartForm()">+ New Rate</button>
        <button class="btn btn-info btn-sm" onclick="showEffectiveRateLookup()">🔍 Effective Rate</button>
        <button class="btn btn-info btn-sm" onclick="printRateCharts()">🖨 Print</button>
        <button class="btn btn-primary btn-sm" onclick="exportRateChartsPDF()">📄 PDF</button>
    `;

    const result = await window.api.getRateCharts();
    const rates = result.success ? result.data : [];

    const settings = await getSettingsCached();
    const defaultFatMult = parseFloat(settings.default_fat_multiplier) || 7.15;
    const defaultSnfMult = parseFloat(settings.default_snf_multiplier) || 4.55;

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Rate Chart Entries</span>
                <span class="value" style="font-size:22px">${rates.length}</span>
                <span class="sub">${rates.filter(r => r.party_id).length} supplier-specific · ${rates.filter(r => !r.party_id).length} plant-wide</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Default FAT Multiplier</span>
                <span class="value" style="font-size:20px">${defaultFatMult}</span>
                <span class="sub">Used when no rate chart entry exists</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Default SNF Multiplier</span>
                <span class="value" style="font-size:20px">${defaultSnfMult}</span>
                <span class="sub">Used when no rate chart entry exists</span>
            </div>
        </div>

        <div class="card" style="margin-bottom:16px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px">
            <div style="font-size:13px;color:var(--text-light)">${getRateFormulaHelp()}</div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2>Milk Rate Chart History</h2>
                <span style="font-size:13px;color:var(--text-light)">Newest first — rates are applied by effective date</span>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Applies To</th>
                            <th>Milk</th>
                            <th>Effective</th>
                            <th>Rate Type</th>
                            <th class="text-right">FAT Mult</th>
                            <th class="text-right">SNF Mult</th>
                            <th class="text-right">Extra / Unit</th>
                            <th class="text-right">Fixed Rate</th>
                            <th>Notes</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rates.length === 0
                            ? '<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-light)">No rate chart entries yet. Add the first rate!</td></tr>'
                            : rates.map(r => `
                                <tr>
                                    <td>${r.party_id
                                        ? `<strong>🌾 ${escapeHtml(r.party_name || ('Supplier #' + r.party_id))}</strong>`
                                        : '<span class="badge badge-info">Plant-wide</span>'}</td>
                                    <td>${r.milk_type ? `<span style="text-transform:capitalize">${escapeHtml(r.milk_type)}</span>` : '<span style="color:var(--text-light)">All</span>'}</td>
                                    <td><strong>${formatDate(r.effective_from)}</strong>${r.effective_to ? `<br><span style="font-size:11px;color:var(--text-light)">to ${formatDate(r.effective_to)}</span>` : ''}${r.is_active === 0 ? '<br><span class="badge badge-danger">Inactive</span>' : ''}</td>
                                    <td><span class="badge ${r.rate_type === 'formula' ? 'badge-info' : 'badge-success'}">${r.rate_type}</span></td>
                                    <td class="text-right">${r.rate_type === 'formula' ? r.fat_multiplier : '-'}</td>
                                    <td class="text-right">${r.rate_type === 'formula' ? r.snf_multiplier : '-'}</td>
                                    <td class="text-right">${r.rate_type === 'formula' ? formatCurrency(r.extra_per_unit || 0) : '-'}</td>
                                    <td class="text-right">${r.rate_type === 'fixed' ? formatCurrency(r.fixed_rate) : '-'}</td>
                                    <td style="font-size:12px;color:var(--text-light)">${escapeHtml(r.notes || '')}</td>
                                    <td class="actions">
                                        <button class="btn btn-info btn-sm" onclick="editRateChart(${r.id})" title="Edit">✏️</button>
                                        <button class="btn btn-danger btn-sm" onclick="deleteRateChartEntry(${r.id})" title="Delete">🗑</button>
                                    </td>
                                </tr>
                            `).join('')
                        }
                    </tbody>
                </table>
            </div>
        </div>
    `;

    window._lastRateCharts = rates;
}

function getRateFormulaHelp() {
    return '💡 <strong>Formula Rate:</strong> Rate = (FAT × FAT Multiplier) + (SNF × SNF Multiplier) + Extra/Unit &nbsp;|&nbsp; ' +
           '<strong>Fixed Rate:</strong> Rate = Fixed Rate per unit (ignores FAT/SNF) &nbsp;|&nbsp; ' +
           'Rates are date-effective and <strong>supplier-aware</strong>: a supplier-specific rule beats the plant-wide rule, ' +
           'and a milk-type rule beats a generic one. One pricing engine prices every collection.';
}

// ============================================================
// Rate Chart Form
// ============================================================
async function showRateChartForm(existingData) {
    const todayStr = today();
    const d = existingData || {
        effective_from: todayStr,
        rate_type: 'formula',
        fat_multiplier: 7.15,
        snf_multiplier: 4.55,
        extra_per_unit: 0,
        fixed_rate: 0,
        notes: '',
        party_id: null, effective_to: '', milk_type: '', is_active: 1
    };
    if (d.is_active === undefined || d.is_active === null) d.is_active = 1;
    if (d.effective_to === undefined || d.effective_to === null) d.effective_to = '';
    if (d.milk_type === undefined || d.milk_type === null) d.milk_type = '';
    if (d.party_id === undefined) d.party_id = null;

    // Suppliers/farmers that can carry their own pricing rule
    let suppliers = [];
    try {
        const [supRes, famRes] = await Promise.all([
            window.api.getParties({ type: 'supplier' }),
            window.api.getParties({ type: 'farmer' })
        ]);
        const seen = new Set();
        for (const p of [...(supRes.success ? supRes.data : []), ...(famRes.success ? famRes.data : [])]) {
            if (!seen.has(p.id)) { seen.add(p.id); suppliers.push(p); }
        }
        suppliers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } catch (e) { /* parties master unavailable — plant-wide only */ }

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Rate Chart Entry</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="rateChartForm">
                <div class="form-section-title">Applies To</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Supplier / Farmer</label>
                        <select class="form-control" id="rcParty" onchange="toggleRateType()">
                            <option value="">— Plant-wide (every supplier) —</option>
                            ${suppliers.map(p => `<option value="${p.id}" ${d.party_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                        </select>
                        <small style="color:var(--text-light)">Pick one supplier for supplier-specific pricing (Fixed Rs/L or their own FAT/SNF chart).</small>
                    </div>
                    <div class="form-group">
                        <label>Milk Type</label>
                        <select class="form-control" id="rcMilkType">
                            <option value="" ${!d.milk_type ? 'selected' : ''}>All types</option>
                            <option value="cow" ${d.milk_type === 'cow' ? 'selected' : ''}>Cow only</option>
                            <option value="buffalo" ${d.milk_type === 'buffalo' ? 'selected' : ''}>Buffalo only</option>
                            <option value="mixed" ${d.milk_type === 'mixed' ? 'selected' : ''}>Mixed only</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Effective From *</label>
                        <input type="date" class="form-control" id="rcDate" value="${d.effective_from}">
                    </div>
                    <div class="form-group">
                        <label>Effective To (blank = open-ended)</label>
                        <input type="date" class="form-control" id="rcEffectiveTo" value="${escapeHtml(d.effective_to || '')}">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Status</label>
                        <select class="form-control" id="rcActive">
                            <option value="1" ${d.is_active ? 'selected' : ''}>Active</option>
                            <option value="0" ${!d.is_active ? 'selected' : ''}>Inactive (kept for history)</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Rate Type</label>
                        <select class="form-control" id="rcType" onchange="toggleRateType()">
                            <option value="formula" ${d.rate_type === 'formula' ? 'selected' : ''}>Formula (FAT × Mult + SNF × Mult)</option>
                            <option value="fixed" ${d.rate_type === 'fixed' ? 'selected' : ''}>Fixed Rate</option>
                        </select>
                    </div>
                </div>

                <div id="rcFormulaFields" ${d.rate_type === 'fixed' ? 'style="display:none"' : ''}>
                    <div class="form-section-title">Formula Parameters</div>
                    <div class="form-row-3">
                        <div class="form-group">
                            <label>FAT Multiplier</label>
                            <input type="number" class="form-control" id="rcFatMult" value="${d.fat_multiplier}" step="0.01" min="0">
                        </div>
                        <div class="form-group">
                            <label>SNF Multiplier</label>
                            <input type="number" class="form-control" id="rcSnfMult" value="${d.snf_multiplier}" step="0.01" min="0">
                        </div>
                        <div class="form-group">
                            <label>Extra Per Unit</label>
                            <input type="number" class="form-control" id="rcExtra" value="${d.extra_per_unit || 0}" step="0.01" min="0">
                        </div>
                    </div>
                    <div style="padding:8px 12px;background:#e8f4f8;border-radius:4px;font-size:13px;margin-top:8px">
                        <strong>Example:</strong> FAT=3.5, SNF=8.5 → Rate = (3.5 × ${d.fat_multiplier}) + (8.5 × ${d.snf_multiplier}) + ${d.extra_per_unit || 0} = 
                        <strong>${formatCurrency((3.5 * (d.fat_multiplier || 7.15)) + (8.5 * (d.snf_multiplier || 4.55)) + (d.extra_per_unit || 0))}</strong>/L
                    </div>
                </div>

                <div id="rcFixedFields" ${d.rate_type === 'formula' ? 'style="display:none"' : ''}>
                    <div class="form-section-title">Fixed Rate</div>
                    <div class="form-group">
                        <label>Fixed Rate Per Unit</label>
                        <input type="number" class="form-control" id="rcFixed" value="${d.fixed_rate}" step="0.01" min="0">
                    </div>
                </div>

                <div class="form-group" style="margin-top:12px">
                    <label>Notes (reason for rate change)</label>
                    <textarea class="form-control" id="rcNotes" rows="2">${escapeHtml(d.notes || '')}</textarea>
                </div>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveRateChartEntry(${existingData ? existingData.id : 'null'})">💾 ${existingData ? 'Update' : 'Save Rate'}</button>
        </div>
    `);
}

function toggleRateType() {
    const type = document.getElementById('rcType')?.value || 'formula';
    document.getElementById('rcFormulaFields').style.display = type === 'formula' ? 'block' : 'none';
    document.getElementById('rcFixedFields').style.display = type === 'fixed' ? 'block' : 'none';
}

async function saveRateChartEntry(id) {
    const partySel = document.getElementById('rcParty');
    const data = {
        id: id || undefined,
        party_id: partySel && partySel.value ? parseInt(partySel.value) : null,
        milk_type: document.getElementById('rcMilkType')?.value || '',
        effective_from: document.getElementById('rcDate')?.value || '',
        effective_to: document.getElementById('rcEffectiveTo')?.value || null,
        is_active: (document.getElementById('rcActive')?.value || '1') === '1',
        rate_type: document.getElementById('rcType')?.value || 'formula',
        fat_multiplier: parseFloat(document.getElementById('rcFatMult')?.value || 7.15),
        snf_multiplier: parseFloat(document.getElementById('rcSnfMult')?.value || 4.55),
        extra_per_unit: parseFloat(document.getElementById('rcExtra')?.value || 0),
        fixed_rate: parseFloat(document.getElementById('rcFixed')?.value || 0),
        notes: document.getElementById('rcNotes')?.value || ''
    };

    if (!data.effective_from) { showToast('Effective date is required', 'error'); return; }
    if (data.rate_type === 'fixed' && !(data.fixed_rate > 0)) { showToast('Enter the fixed rate per litre', 'error'); return; }

    const result = await window.api.saveRateChart(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Rate chart updated' : 'Rate chart saved', 'success');
        renderRateCharts();
    } else {
        showToast(result.error, 'error');
    }
}

async function editRateChart(id) {
    const result = await window.api.getRateChart(id);
    if (result.success) showRateChartForm(result.data);
}

async function deleteRateChartEntry(id) {
    const confirmed = await confirmAction('Delete this rate chart entry?', 'Historical collections will still retain their original calculated rates.');
    if (!confirmed) return;
    const result = await window.api.deleteRateChart(id);
    if (result.success) {
        showToast('Rate chart deleted', 'success');
        renderRateCharts();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Effective Rate Lookup
// ============================================================
async function showEffectiveRateLookup() {
    const todayStr = today();

    let suppliers = [];
    try {
        const [supRes, famRes] = await Promise.all([
            window.api.getParties({ type: 'supplier' }),
            window.api.getParties({ type: 'farmer' })
        ]);
        const seen = new Set();
        for (const p of [...(supRes.success ? supRes.data : []), ...(famRes.success ? famRes.data : [])]) {
            if (!seen.has(p.id)) { seen.add(p.id); suppliers.push(p); }
        }
        suppliers.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    } catch (e) { /* plant-wide lookup still works */ }

    showModal(`
        <div class="modal-header">
            <h2>Effective Rate Lookup</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group">
                    <label>Select Date</label>
                    <input type="date" class="form-control" id="erDate" value="${todayStr}">
                </div>
                <div class="form-group">
                    <label>Supplier / Farmer</label>
                    <select class="form-control" id="erParty">
                        <option value="">— Plant-wide —</option>
                        ${suppliers.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Milk Type</label>
                    <select class="form-control" id="erMilkType">
                        <option value="">All types</option>
                        <option value="cow">Cow</option>
                        <option value="buffalo">Buffalo</option>
                        <option value="mixed">Mixed</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Test Calculation (Optional)</label>
                <div class="form-row-3">
                    <div class="form-group"><label>FAT %</label><input type="number" class="form-control" id="erFat" value="3.5" step="0.1"></div>
                    <div class="form-group"><label>SNF %</label><input type="number" class="form-control" id="erSnf" value="8.5" step="0.1"></div>
                    <div class="form-group"><label>&nbsp;</label><button class="btn btn-primary btn-sm" onclick="lookupEffectiveRate()">Lookup</button></div>
                </div>
            </div>
            <div id="erResult" style="padding:20px;text-align:center;color:var(--text-light)">
                Select a date (and supplier, if they have their own rule) and click Lookup.
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function lookupEffectiveRate() {
    const date = document.getElementById('erDate')?.value || '';
    const partyId = document.getElementById('erParty')?.value || '';
    const milkType = document.getElementById('erMilkType')?.value || '';
    const fat = parseFloat(document.getElementById('erFat')?.value || 0);
    const snf = parseFloat(document.getElementById('erSnf')?.value || 0);

    const opts = { party_id: partyId ? parseInt(partyId) : null, milk_type: milkType, fat, snf };
    let resolved = null;
    if (window.api.resolveMilkRate) {
        const rr = await window.api.resolveMilkRate(Object.assign({ date }, opts));
        if (rr.success) resolved = rr.data;
    }
    if (!resolved) {
        const rateResult = await window.api.getEffectiveRate(date, opts);
        if (!rateResult.success) {
            document.getElementById('erResult').innerHTML = `<div style="color:var(--danger)">Error: ${rateResult.error}</div>`;
            return;
        }
        const c = rateResult.data;
        resolved = { chart: c, calculated_rate: null, source: c && c.id ? 'plant' : 'default' };
    }

    const rate = resolved.chart || {};
    const calculatedRate = resolved.calculated_rate != null
        ? resolved.calculated_rate
        : (rate.rate_type === 'formula'
            ? (fat * (rate.fat_multiplier || 7.15)) + (snf * (rate.snf_multiplier || 4.55)) + (rate.extra_per_unit || 0)
            : (rate.fixed_rate || 0));
    const sourceLabel = resolved.source === 'supplier'
        ? '🌾 <strong>Supplier-specific rule</strong> (beats the plant chart)'
        : resolved.source === 'plant' ? '🏭 Plant-wide rule' : '⚠️ Settings defaults (no chart yet)';

    document.getElementById('erResult').innerHTML = `
        <div style="background:var(--bg);padding:16px;border-radius:8px;text-align:left">
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:var(--primary)">
                ✅ Effective Rate on ${formatDate(date)}
            </div>
            <table style="width:100%;font-size:13px">
                ${rate.id ? `<tr><td style="padding:4px 8px;color:var(--text-light)">Rate Chart:</td><td style="padding:4px 8px;font-weight:600">#${rate.id}${rate.party_name ? ' — ' + escapeHtml(rate.party_name) : ''}</td></tr>` : ''}
                <tr><td style="padding:4px 8px;color:var(--text-light)">Priced by:</td><td style="padding:4px 8px">${sourceLabel}</td></tr>
                <tr><td style="padding:4px 8px;color:var(--text-light)">Rate Type:</td><td style="padding:4px 8px;font-weight:600">${rate.rate_type || 'formula'}${rate.milk_type ? ' · ' + escapeHtml(rate.milk_type) : ''}</td></tr>
                ${rate.rate_type === 'formula' ? `
                    <tr><td style="padding:4px 8px;color:var(--text-light)">FAT Multiplier:</td><td style="padding:4px 8px;font-weight:600">${rate.fat_multiplier}</td></tr>
                    <tr><td style="padding:4px 8px;color:var(--text-light)">SNF Multiplier:</td><td style="padding:4px 8px;font-weight:600">${rate.snf_multiplier}</td></tr>
                    <tr><td style="padding:4px 8px;color:var(--text-light)">Extra/Unit:</td><td style="padding:4px 8px;font-weight:600">${formatCurrency(rate.extra_per_unit || 0)}</td></tr>
                ` : `
                    <tr><td style="padding:4px 8px;color:var(--text-light)">Fixed Rate:</td><td style="padding:4px 8px;font-weight:600">${formatCurrency(rate.fixed_rate)}/L</td></tr>
                `}
                <tr style="border-top:1px solid var(--border)"><td style="padding:8px;color:var(--text-light)">Test: FAT=${fat}, SNF=${snf}</td><td style="padding:8px;font-weight:700;font-size:16px;color:var(--accent)">${formatCurrency(calculatedRate)}/L</td></tr>
                ${rate.notes ? `<tr><td style="padding:4px 8px;color:var(--text-light)">Notes:</td><td style="padding:4px 8px">${escapeHtml(rate.notes)}</td></tr>` : ''}
                ${!rate.id ? `<tr><td colspan="2" style="padding:8px;color:var(--warning)">⚠️ No rate chart entry for this date — using defaults from settings.</td></tr>` : ''}
            </table>
        </div>
    `;
}

// ============================================================
// Print / PDF
// ============================================================
async function printRateCharts() {
    const result = await window.api.getRateCharts();
    if (!result.success) return;
    const rates = result.data || [];
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Milk Rate Chart History</h2>        <p>As of: ${formatDate(today())}</p></div>
        <table><thead><tr><th>Applies To</th><th>Milk</th><th>Effective From</th><th>Effective To</th><th>Type</th><th class="text-right">FAT Mult</th><th class="text-right">SNF Mult</th><th class="text-right">Extra</th><th class="text-right">Fixed Rate</th><th>Notes</th></tr></thead>
        <tbody>${rates.map(r => `<tr><td>${r.party_id ? escapeHtml(r.party_name || ('#' + r.party_id)) : 'Plant-wide'}</td><td>${r.milk_type ? escapeHtml(r.milk_type) : 'All'}</td><td>${formatDate(r.effective_from)}</td><td>${r.effective_to ? formatDate(r.effective_to) : '—'}</td><td>${r.rate_type}${r.is_active === 0 ? ' (inactive)' : ''}</td><td class="text-right">${r.rate_type === 'formula' ? r.fat_multiplier : '-'}</td><td class="text-right">${r.rate_type === 'formula' ? r.snf_multiplier : '-'}</td><td class="text-right">${r.rate_type === 'formula' ? formatCurrency(r.extra_per_unit||0) : '-'}</td><td class="text-right">${r.rate_type === 'fixed' ? formatCurrency(r.fixed_rate) : '-'}</td><td>${escapeHtml(r.notes||'')}</td></tr>`).join('')}</tbody>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportRateChartsPDF() {
    const rates = window._lastRateCharts || [];
    if (rates.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Rate Chart History</h2><p>Total: ${rates.length} entries</p></div>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

// Globals
window.renderRateCharts = renderRateCharts;
window.showRateChartForm = showRateChartForm;
window.toggleRateType = toggleRateType;
window.saveRateChartEntry = saveRateChartEntry;
window.editRateChart = editRateChart;
window.deleteRateChartEntry = deleteRateChartEntry;
window.showEffectiveRateLookup = showEffectiveRateLookup;
window.lookupEffectiveRate = lookupEffectiveRate;
window.printRateCharts = printRateCharts;
window.exportRateChartsPDF = exportRateChartsPDF;
