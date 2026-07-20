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
                <span class="sub">Historical rate records</span>
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
                            <th>Effective From</th>
                            <th>Rate Type</th>
                            <th class="text-right">FAT Multiplier</th>
                            <th class="text-right">SNF Multiplier</th>
                            <th class="text-right">Extra / Unit</th>
                            <th class="text-right">Fixed Rate</th>
                            <th>Notes</th>
                            <th class="actions">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rates.length === 0
                            ? '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">No rate chart entries yet. Add the first rate!</td></tr>'
                            : rates.map(r => `
                                <tr>
                                    <td><strong>${formatDate(r.effective_from)}</strong></td>
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
           'Rates are date-effective: the system uses the rate active on the collection date.';
}

// ============================================================
// Rate Chart Form
// ============================================================
function showRateChartForm(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || {
        effective_from: today,
        rate_type: 'formula',
        fat_multiplier: 7.15,
        snf_multiplier: 4.55,
        extra_per_unit: 0,
        fixed_rate: 0,
        notes: ''
    };

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Rate Chart Entry</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="rateChartForm">
                <div class="form-row">
                    <div class="form-group">
                        <label>Effective From *</label>
                        <input type="date" class="form-control" id="rcDate" value="${d.effective_from}">
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
    const data = {
        id: id || undefined,
        effective_from: document.getElementById('rcDate')?.value || '',
        rate_type: document.getElementById('rcType')?.value || 'formula',
        fat_multiplier: parseFloat(document.getElementById('rcFatMult')?.value || 7.15),
        snf_multiplier: parseFloat(document.getElementById('rcSnfMult')?.value || 4.55),
        extra_per_unit: parseFloat(document.getElementById('rcExtra')?.value || 0),
        fixed_rate: parseFloat(document.getElementById('rcFixed')?.value || 0),
        notes: document.getElementById('rcNotes')?.value || ''
    };

    if (!data.effective_from) { showToast('Effective date is required', 'error'); return; }

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
    const today = new Date().toISOString().split('T')[0];

    showModal(`
        <div class="modal-header">
            <h2>Effective Rate Lookup</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-group">
                <label>Select Date</label>
                <input type="date" class="form-control" id="erDate" value="${today}">
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
                Select a date and click Lookup to see the effective rate.
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        </div>
    `);
}

async function lookupEffectiveRate() {
    const date = document.getElementById('erDate')?.value || '';
    const fat = parseFloat(document.getElementById('erFat')?.value || 0);
    const snf = parseFloat(document.getElementById('erSnf')?.value || 0);

    const rateResult = await window.api.getEffectiveRate(date);
    if (!rateResult.success) {
        document.getElementById('erResult').innerHTML = `<div style="color:var(--danger)">Error: ${rateResult.error}</div>`;
        return;
    }

    const rate = rateResult.data;
    let calculatedRate = 0;
    if (rate.rate_type === 'formula') {
        calculatedRate = (fat * rate.fat_multiplier) + (snf * rate.snf_multiplier) + (rate.extra_per_unit || 0);
    } else {
        calculatedRate = rate.fixed_rate || 0;
    }

    document.getElementById('erResult').innerHTML = `
        <div style="background:var(--bg);padding:16px;border-radius:8px;text-align:left">
            <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:var(--primary)">
                ✅ Effective Rate on ${formatDate(date)}
            </div>
            <table style="width:100%;font-size:13px">
                ${rate.id ? `<tr><td style="padding:4px 8px;color:var(--text-light)">Rate Chart ID:</td><td style="padding:4px 8px;font-weight:600">#${rate.id}</td></tr>` : ''}
                <tr><td style="padding:4px 8px;color:var(--text-light)">Rate Type:</td><td style="padding:4px 8px;font-weight:600">${rate.rate_type}</td></tr>
                ${rate.rate_type === 'formula' ? `
                    <tr><td style="padding:4px 8px;color:var(--text-light)">FAT Multiplier:</td><td style="padding:4px 8px;font-weight:600">${rate.fat_multiplier}</td></tr>
                    <tr><td style="padding:4px 8px;color:var(--text-light)">SNF Multiplier:</td><td style="padding:4px 8px;font-weight:600">${rate.snf_multiplier}</td></tr>
                    <tr><td style="padding:4px 8px;color:var(--text-light)">Extra/Unit:</td><td style="padding:4px 8px;font-weight:600">${formatCurrency(rate.extra_per_unit || 0)}</td></tr>
                    <tr style="border-top:1px solid var(--border)"><td style="padding:8px;color:var(--text-light)">Test: FAT=${fat}, SNF=${snf}</td><td style="padding:8px;font-weight:700;font-size:16px;color:var(--accent)">${formatCurrency(calculatedRate)}/L</td></tr>
                ` : `
                    <tr><td style="padding:4px 8px;color:var(--text-light)">Fixed Rate:</td><td style="padding:4px 8px;font-weight:600">${formatCurrency(rate.fixed_rate)}/L</td></tr>
                `}
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
        <div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Milk Rate Chart History</h2><p>As of: ${formatDate(new Date().toISOString().split('T')[0])}</p></div>
        <table><thead><tr><th>Effective</th><th>Type</th><th class="text-right">FAT Mult</th><th class="text-right">SNF Mult</th><th class="text-right">Extra</th><th class="text-right">Fixed Rate</th><th>Notes</th></tr></thead>
        <tbody>${rates.map(r => `<tr><td>${formatDate(r.effective_from)}</td><td>${r.rate_type}</td><td class="text-right">${r.rate_type === 'formula' ? r.fat_multiplier : '-'}</td><td class="text-right">${r.rate_type === 'formula' ? r.snf_multiplier : '-'}</td><td class="text-right">${r.rate_type === 'formula' ? formatCurrency(r.extra_per_unit||0) : '-'}</td><td class="text-right">${r.rate_type === 'fixed' ? formatCurrency(r.fixed_rate) : '-'}</td><td>${escapeHtml(r.notes||'')}</td></tr>`).join('')}</tbody>
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
