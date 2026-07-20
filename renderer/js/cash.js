/**
 * Daily Cash Collection & Denomination Count Module
 * =================================================
 * Shows daily cash collection report and denomination counting.
 */

async function renderCash() {
    const container = document.getElementById('page-cash');
    document.getElementById('topActions').innerHTML = '';

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(2,1fr)">
            <div class="summary-card card-primary" style="cursor:pointer;margin:0" onclick="showCashCollection()">
                <span class="label">💰 Daily Cash Collection</span>
                <span class="value" style="font-size:16px">View Report →</span>
                <span class="sub">Cash sales, receipts, payments summary</span>
            </div>
            <div class="summary-card card-success" style="cursor:pointer;margin:0" onclick="showDenominationCount()">
                <span class="label">🔢 Denomination Count</span>
                <span class="value" style="font-size:16px">Manage →</span>
                <span class="sub">Daily cash counting with denomination breakdown</span>
            </div>
        </div>
        <div style="margin-top:20px">
            <div class="card" id="cashContent">
                <div style="text-align:center;padding:60px 20px;color:var(--text-light)">
                    <div style="font-size:48px;margin-bottom:16px">💵</div>
                    <h3>Cash Management</h3>
                    <p>Daily cash collection report and denomination counting.</p>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Daily Cash Collection Report
// ============================================================
async function showCashCollection() {
    const container = document.getElementById('cashContent');
    const preset = getDatePreset('this_month');

    const todayResult = await window.api.getDailyCashCollection({ from_date: preset.from, to_date: preset.to });
    const data = todayResult.success ? todayResult.data : { days: [], total_cash_in: 0, total_cash_out: 0, net_cash: 0 };

    container.innerHTML = `
        <div class="card-header">
            <h2>Daily Cash Collection Report</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printCashCollection()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportCashCollectionPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="ccFrom" value="${preset.from}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="ccTo" value="${preset.to}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshCashCollection()">Generate</button>
            </div>
        </div>
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Cash In</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.total_cash_in)}</span>
                <span class="sub">Sales + Receipts</span>
            </div>
            <div class="summary-card card-danger" style="margin:0;padding:12px">
                <span class="label">Total Cash Out</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.total_cash_out)}</span>
                <span class="sub">Payments made</span>
            </div>
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Net Cash Position</span>
                <span class="value" style="font-size:20px">${formatCurrency(data.net_cash)}</span>
                <span class="sub">${data.net_cash >= 0 ? 'Surplus' : 'Deficit'}</span>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th class="text-right">Cash Sales</th>
                        <th class="text-right">Cash Receipts</th>
                        <th class="text-right">Total Cash In</th>
                        <th class="text-right">Cash Payments</th>
                        <th class="text-right">Other Receipts</th>
                        <th class="text-right">Net Cash</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.days.map(d => `
                        <tr>
                            <td>${formatDate(d.date)}</td>
                            <td class="text-right">${formatCurrency(d.cash_sales_total)}</td>
                            <td class="text-right">${formatCurrency(d.cash_receipts_total)}</td>
                            <td class="text-right"><strong>${formatCurrency(d.total_cash_in)}</strong></td>
                            <td class="text-right" style="color:var(--danger)">${formatCurrency(d.total_cash_out)}</td>
                            <td class="text-right">${formatCurrency(d.other_receipts_total)}</td>
                            <td class="text-right" style="font-weight:600;color:${d.net_cash >= 0 ? 'var(--accent)' : 'var(--danger)'}">${formatCurrency(d.net_cash)}</td>
                        </tr>
                    `).join('')}
                    ${data.days.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No data for this period</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_sales_total, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_receipts_total, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_cash_in)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_cash_out)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.other_receipts_total, 0))}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.net_cash)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

async function refreshCashCollection() {
    const from = document.getElementById('ccFrom')?.value || '';
    const to = document.getElementById('ccTo')?.value || '';
    const result = await window.api.getDailyCashCollection({ from_date: from, to_date: to });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastCashData = result.data;
    showCashCollection();
}

// ============================================================
// Denomination Count
// ============================================================
async function showDenominationCount() {
    const container = document.getElementById('cashContent');
    const today = new Date().toISOString().split('T')[0];
    const preset = getDatePreset('this_month');

    const listResult = await window.api.getDenominations({ from_date: preset.from, to_date: preset.to });
    const counts = listResult.success ? listResult.data : [];

    // Check if today already has a count
    const todayCount = counts.find(c => c.date === today);

    container.innerHTML = `
        <div class="card-header">
            <h2>Denomination Count</h2>
            <div class="btn-group">
                <button class="btn btn-success btn-sm" onclick="showAddDenomination()">+ New Count</button>
                <button class="btn btn-info btn-sm" onclick="printDenomination()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportDenominationPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="dnFrom" value="${preset.from}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="dnTo" value="${preset.to}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="refreshDenomination()">Generate</button>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th class="text-right">₹1000</th>
                        <th class="text-right">₹500</th>
                        <th class="text-right">₹100</th>
                        <th class="text-right">₹50</th>
                        <th class="text-right">₹20</th>
                        <th class="text-right">₹10</th>
                        <th class="text-right">Coins</th>
                        <th class="text-right">Total Counted</th>
                        <th class="text-right">Expected</th>
                        <th class="text-right">Diff</th>
                        <th>Counted By</th>
                        <th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${counts.map(c => {
                        const diff = c.difference || 0;
                        return `<tr>
                            <td>${formatDate(c.date)}</td>
                            <td class="text-right">${c.note_1000 || 0}</td>
                            <td class="text-right">${c.note_500 || 0}</td>
                            <td class="text-right">${c.note_100 || 0}</td>
                            <td class="text-right">${c.note_50 || 0}</td>
                            <td class="text-right">${c.note_20 || 0}</td>
                            <td class="text-right">${c.note_10 || 0}</td>
                            <td class="text-right">${(c.coin_5||0)+(c.coin_2||0)+(c.coin_1||0)}</td>
                            <td class="text-right"><strong>${formatCurrency(c.total_cash)}</strong></td>
                            <td class="text-right">${formatCurrency(c.expected_cash)}</td>
                            <td class="text-right" style="color:${diff === 0 ? 'var(--accent)' : diff > 0 ? 'var(--warning)' : 'var(--danger)'};font-weight:600">
                                ${diff > 0 ? '+' : ''}${formatCurrency(diff)}
                            </td>
                            <td>${escapeHtml(c.counted_by || '-')}</td>
                            <td class="actions">
                                <button class="btn btn-info btn-sm" onclick="editDenomination(${c.id})">✏️</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteDenominationEntry(${c.id})">🗑</button>
                            </td>
                        </tr>`;
                    }).join('')}
                    ${counts.length === 0 ? '<tr><td colspan="13" style="text-align:center;padding:30px;color:var(--text-light)">No denomination counts yet</td></tr>' : ''}
                </tbody>
            </table>
        </div>
    `;

    // Store for print
    window._lastDenominations = counts;
}

async function refreshDenomination() {
    const from = document.getElementById('dnFrom')?.value || '';
    const to = document.getElementById('dnTo')?.value || '';
    const result = await window.api.getDenominations({ from_date: from, to_date: to });
    if (!result.success) { showToast(result.error, 'error'); return; }
    window._lastDenominations = result.data;
    showDenominationCount();
}

async function showAddDenomination(existingData) {
    const today = new Date().toISOString().split('T')[0];
    const d = existingData || { date: today, note_1000: 0, note_500: 0, note_100: 0, note_50: 0, note_20: 0, note_10: 0, coin_5: 0, coin_2: 0, coin_1: 0, expected_cash: 0, counted_by: '', remarks: '' };

    // Try to get today's expected cash from cash collection
    if (!existingData) {
        const cashResult = await window.api.getDailyCashCollection({ from_date: today, to_date: today });
        if (cashResult.success && cashResult.data.days.length > 0) {
            d.expected_cash = cashResult.data.days[0].total_cash_in;
        }
    }

    showModal(`
        <div class="modal-header">
            <h2>${existingData ? 'Edit' : 'New'} Denomination Count</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <div class="form-row">
                <div class="form-group">
                    <label>Date</label>
                    <input type="date" class="form-control" id="dnDate" value="${d.date}">
                </div>
                <div class="form-group">
                    <label>Counted By</label>
                    <input type="text" class="form-control" id="dnCountedBy" value="${escapeHtml(d.counted_by)}" placeholder="Person name">
                </div>
            </div>
            <div class="form-section-title">Note Count</div>
            <div class="form-row-3">
                <div class="form-group"><label>₹1000 Notes</label><input type="number" class="form-control" id="dn1000" value="${d.note_1000}" min="0"></div>
                <div class="form-group"><label>₹500 Notes</label><input type="number" class="form-control" id="dn500" value="${d.note_500}" min="0"></div>
                <div class="form-group"><label>₹100 Notes</label><input type="number" class="form-control" id="dn100" value="${d.note_100}" min="0"></div>
                <div class="form-group"><label>₹50 Notes</label><input type="number" class="form-control" id="dn50" value="${d.note_50}" min="0"></div>
                <div class="form-group"><label>₹20 Notes</label><input type="number" class="form-control" id="dn20" value="${d.note_20}" min="0"></div>
                <div class="form-group"><label>₹10 Notes</label><input type="number" class="form-control" id="dn10" value="${d.note_10}" min="0"></div>
            </div>
            <div class="form-section-title">Coin Count</div>
            <div class="form-row-3">
                <div class="form-group"><label>₹5 Coins</label><input type="number" class="form-control" id="dnCoin5" value="${d.coin_5}" min="0"></div>
                <div class="form-group"><label>₹2 Coins</label><input type="number" class="form-control" id="dnCoin2" value="${d.coin_2}" min="0"></div>
                <div class="form-group"><label>₹1 Coins</label><input type="number" class="form-control" id="dnCoin1" value="${d.coin_1}" min="0"></div>
            </div>
            <div class="form-section-title">Expected & Remarks</div>
            <div class="form-row">
                <div class="form-group">
                    <label>Expected Cash (from system)</label>
                    <input type="number" class="form-control" id="dnExpected" value="${d.expected_cash}" step="0.01">
                </div>
                <div class="form-group">
                    <label>Total Counted (auto-calculated)</label>
                    <input type="text" class="form-control" id="dnTotalPreview" readonly style="font-weight:700;font-size:16px;color:var(--primary)">
                </div>
            </div>
            <div class="form-group">
                <label>Remarks</label>
                <textarea class="form-control" id="dnRemarks" rows="2">${escapeHtml(d.remarks)}</textarea>
            </div>
            <div class="form-group" id="dnDiffDisplay" style="display:none;padding:10px;border-radius:6px"></div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveDenominationEntry(${existingData ? existingData.id : 'null'})">Save Count</button>
        </div>
    `);

    // Auto-calculate total
    document.querySelectorAll('#dn1000, #dn500, #dn100, #dn50, #dn20, #dn10, #dnCoin5, #dnCoin2, #dnCoin1, #dnExpected').forEach(el => {
        el.addEventListener('input', updateDenominationPreview);
    });
    updateDenominationPreview();
}

function updateDenominationPreview() {
    const v = (id) => parseFloat(document.getElementById(id)?.value || 0);
    const total = v('dn1000')*1000 + v('dn500')*500 + v('dn100')*100 + v('dn50')*50 + v('dn20')*20 + v('dn10')*10 + v('dnCoin5')*5 + v('dnCoin2')*2 + v('dnCoin1')*1;
    const expected = v('dnExpected');
    const diff = total - expected;

    const el = document.getElementById('dnTotalPreview');
    if (el) el.value = '₹ ' + total.toLocaleString('en-IN', { minimumFractionDigits: 2 });

    const diffEl = document.getElementById('dnDiffDisplay');
    if (diffEl) {
        diffEl.style.display = 'block';
        if (diff === 0) {
            diffEl.style.background = '#d4edda';
            diffEl.style.color = '#155724';
            diffEl.textContent = '✅ Cash matches expected. Difference: ₹ 0.00';
        } else if (diff > 0) {
            diffEl.style.background = '#fff3cd';
            diffEl.style.color = '#856404';
            diffEl.textContent = `⚠️ Excess: ₹ ${diff.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (counted more than expected)`;
        } else {
            diffEl.style.background = '#f8d7da';
            diffEl.style.color = '#721c24';
            diffEl.textContent = `❌ Shortage: ₹ ${Math.abs(diff).toLocaleString('en-IN', { minimumFractionDigits: 2 })} (counted less than expected)`;
        }
    }
}

async function saveDenominationEntry(id) {
    const data = {
        id: id || undefined,
        date: document.getElementById('dnDate')?.value || '',
        note_1000: parseInt(document.getElementById('dn1000')?.value || 0),
        note_500: parseInt(document.getElementById('dn500')?.value || 0),
        note_100: parseInt(document.getElementById('dn100')?.value || 0),
        note_50: parseInt(document.getElementById('dn50')?.value || 0),
        note_20: parseInt(document.getElementById('dn20')?.value || 0),
        note_10: parseInt(document.getElementById('dn10')?.value || 0),
        coin_5: parseInt(document.getElementById('dnCoin5')?.value || 0),
        coin_2: parseInt(document.getElementById('dnCoin2')?.value || 0),
        coin_1: parseInt(document.getElementById('dnCoin1')?.value || 0),
        expected_cash: parseFloat(document.getElementById('dnExpected')?.value || 0),
        counted_by: document.getElementById('dnCountedBy')?.value || '',
        remarks: document.getElementById('dnRemarks')?.value || ''
    };

    if (!data.date) { showToast('Date is required', 'error'); return; }

    const result = await window.api.saveDenomination(data);
    if (result.success) {
        closeModal();
        showToast(id ? 'Denomination updated' : 'Denomination saved', 'success');
        showDenominationCount();
    } else {
        showToast(result.error, 'error');
    }
}

async function editDenomination(id) {
    const result = await window.api.getDenomination(id);
    if (result.success) {
        showAddDenomination(result.data);
    }
}

async function deleteDenominationEntry(id) {
    const confirmed = await confirmAction('Delete this denomination count?');
    if (!confirmed) return;
    const result = await window.api.deleteDenomination(id);
    if (result.success) {
        showToast('Denomination deleted', 'success');
        showDenominationCount();
    } else {
        showToast(result.error, 'error');
    }
}

// ============================================================
// Print / PDF
// ============================================================
async function printCashCollection() {
    const from = document.getElementById('ccFrom')?.value || '';
    const to = document.getElementById('ccTo')?.value || '';
    const result = await window.api.getDailyCashCollection({ from_date: from, to_date: to });
    if (!result.success) return;
    const data = result.data;
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Daily Cash Collection Report</h2><p>Period: ${from || 'Start'} to ${to || 'Today'}</p></div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Total Cash In</div><div class="value-number">${formatCurrency(data.total_cash_in)}</div></div>
            <div class="value-card"><div class="value-label">Total Cash Out</div><div class="value-number">${formatCurrency(data.total_cash_out)}</div></div>
            <div class="value-card"><div class="value-label">Net Cash</div><div class="value-number">${formatCurrency(data.net_cash)}</div></div>
        </div>
        <table><thead><tr><th>Date</th><th class="text-right">Cash Sales</th><th class="text-right">Receipts</th><th class="text-right">Total In</th><th class="text-right">Payments</th><th class="text-right">Other</th><th class="text-right">Net</th></tr></thead>
        <tbody>${data.days.map(d => `<tr><td>${formatDate(d.date)}</td><td class="text-right">${formatCurrency(d.cash_sales_total)}</td><td class="text-right">${formatCurrency(d.cash_receipts_total)}</td><td class="text-right">${formatCurrency(d.total_cash_in)}</td><td class="text-right">${formatCurrency(d.total_cash_out)}</td><td class="text-right">${formatCurrency(d.other_receipts_total)}</td><td class="text-right">${formatCurrency(d.net_cash)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_sales_total, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.cash_receipts_total, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_cash_in)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_cash_out)}</strong></td><td class="text-right"><strong>${formatCurrency(data.days.reduce((s,d) => s + d.other_receipts_total, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.net_cash)}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportCashCollectionPDF() {
    const from = document.getElementById('ccFrom')?.value || '';
    const to = document.getElementById('ccTo')?.value || '';
    const result = await window.api.getDailyCashCollection({ from_date: from, to_date: to });
    if (!result.success) return;
    const data = result.data;
    const settings = await getSettingsCached();

    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Cash Collection Report</h2><p>${from} to ${to}</p></div>
        <p>Cash In: ${formatCurrency(data.total_cash_in)} | Cash Out: ${formatCurrency(data.total_cash_out)} | Net: ${formatCurrency(data.net_cash)}</p>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

async function printDenomination() {
    const data = window._lastDenominations || [];
    if (data.length === 0) { showToast('No data to print', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>Denomination Count Sheet</h2><p>Date: ${formatDate(new Date().toISOString().split('T')[0])}</p></div>
        <table class="compact"><thead><tr><th>Date</th><th class="text-right">₹1000</th><th class="text-right">₹500</th><th class="text-right">₹100</th><th class="text-right">₹50</th><th class="text-right">₹20</th><th class="text-right">₹10</th><th class="text-right">Total</th><th class="text-right">Expected</th><th class="text-right">Diff</th><th>By</th></tr></thead>
        <tbody>${data.map(c => `<tr><td>${formatDate(c.date)}</td><td class="text-right">${c.note_1000||0}</td><td class="text-right">${c.note_500||0}</td><td class="text-right">${c.note_100||0}</td><td class="text-right">${c.note_50||0}</td><td class="text-right">${c.note_20||0}</td><td class="text-right">${c.note_10||0}</td><td class="text-right">${formatCurrency(c.total_cash)}</td><td class="text-right">${formatCurrency(c.expected_cash)}</td><td class="text-right">${formatCurrency(c.difference)}</td><td>${escapeHtml(c.counted_by||'')}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td><strong>Total</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_1000||0), 0)}</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_500||0), 0)}</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_100||0), 0)}</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_50||0), 0)}</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_20||0), 0)}</strong></td><td class="text-right"><strong>${data.reduce((s,c) => s + (c.note_10||0), 0)}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,c) => s + c.total_cash, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,c) => s + c.expected_cash, 0))}</strong></td><td class="text-right"><strong>${formatCurrency(data.reduce((s,c) => s + c.difference, 0))}</strong></td><td></td></tr></tfoot></table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Counted by (Signature)</div></div>
    `;
    printHTML(html);
}

async function exportDenominationPDF() {
    const data = window._lastDenominations || [];
    if (data.length === 0) { showToast('No data', 'warning'); return; }
    const settings = await getSettingsCached();
    const html = `<div class="header"><h1>${escapeHtml(settings.business_name)}</h1><h2>Denomination Count</h2></div>
        <p>Total Counted: ${formatCurrency(data.reduce((s,c) => s + c.total_cash, 0))}</p>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div></div>`;
    await window.api.printToPDF({ html });
}

// Globals
window.renderCash = renderCash;
window.showCashCollection = showCashCollection;
window.showDenominationCount = showDenominationCount;
window.refreshCashCollection = refreshCashCollection;
window.refreshDenomination = refreshDenomination;
window.showAddDenomination = showAddDenomination;
window.saveDenominationEntry = saveDenominationEntry;
window.editDenomination = editDenomination;
window.deleteDenominationEntry = deleteDenominationEntry;
window.updateDenominationPreview = updateDenominationPreview;
window.printCashCollection = printCashCollection;
window.exportCashCollectionPDF = exportCashCollectionPDF;
window.printDenomination = printDenomination;
window.exportDenominationPDF = exportDenominationPDF;
