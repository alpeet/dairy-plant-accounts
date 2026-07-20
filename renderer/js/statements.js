/**
 * Customer & Supplier Statement Module
 * Shows debit/credit statements with running balance, print & PDF
 */

async function renderStatements() {
    const container = document.getElementById('page-statements');
    document.getElementById('topActions').innerHTML = '';

    const settings = await getSettingsCached();

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:repeat(3,1fr)">
            <div class="summary-card card-primary" style="cursor:pointer;margin:0" onclick="showCustomerStatements()">
                <span class="label">👤 Customer Statement</span>
                <span class="value" style="font-size:16px">View →</span>
                <span class="sub">Party-wise debit/credit with running balance</span>
            </div>
            <div class="summary-card card-info" style="cursor:pointer;margin:0" onclick="showSupplierStatements()">
                <span class="label">🏭 Supplier Statement</span>
                <span class="value" style="font-size:16px">View →</span>
                <span class="sub">Supplier-wise payable/paid with running balance</span>
            </div>
            <div class="summary-card card-success" style="cursor:pointer;margin:0" onclick="showPartyStatement()">
                <span class="label">📋 All Parties Statement</span>
                <span class="value" style="font-size:16px">View →</span>
                <span class="sub">All parties summary with balances</span>
            </div>
        </div>
        <div style="margin-top:20px">
            <div class="card" id="statementContent">
                <div style="text-align:center;padding:60px 20px;color:var(--text-light)">
                    <div style="font-size:48px;margin-bottom:16px">📄</div>
                    <h3>Select a Statement Type</h3>
                    <p>Choose Customer, Supplier, or view by selecting a party below.</p>
                </div>
            </div>
        </div>
    `;
}

// ============================================================
// Party Selection & Statement View
// ============================================================
async function showPartyStatement() {
    const container = document.getElementById('statementContent');

    const [partiesResult, preset] = await Promise.all([
        window.api.getParties({}),
        Promise.resolve(getDatePreset('this_month'))
    ]);
    const parties = partiesResult.success ? partiesResult.data : [];

    container.innerHTML = `
        <div class="card-header">
            <h2>Party Statement</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printStatement()">🖨 Print</button>
                <button class="btn btn-primary btn-sm" onclick="exportStatementPDF()">📄 PDF</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>Party Type</label>
                <select class="form-control" id="stType" onchange="filterPartiesByType()">
                    <option value="">All</option>
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                    <option value="both">Both</option>
                </select>
            </div>
            <div class="form-group">
                <label>Party</label>
                <select class="form-control" id="stParty">
                    <option value="">-- Select Party --</option>
                    ${parties.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.type})</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>From</label>
                <input type="date" class="form-control" id="stFrom" value="${preset.from}">
            </div>
            <div class="form-group">
                <label>To</label>
                <input type="date" class="form-control" id="stTo" value="${preset.to}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="generateStatement()">Generate</button>
            </div>
        </div>
        <div id="statementResult">
            <div style="text-align:center;padding:40px;color:var(--text-light)">
                Select a party and date range, then click Generate.
            </div>
        </div>
    `;
}

async function filterPartiesByType() {
    const type = document.getElementById('stType')?.value || '';
    const result = await window.api.getParties({ type });
    const parties = result.success ? result.data : [];
    const sel = document.getElementById('stParty');
    sel.innerHTML = `<option value="">-- Select Party --</option>
        ${parties.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.type})</option>`).join('')}`;
}

async function generateStatement() {
    const partyId = document.getElementById('stParty')?.value;
    const from = document.getElementById('stFrom')?.value || '';
    const to = document.getElementById('stTo')?.value || '';

    if (!partyId) { showToast('Please select a party', 'warning'); return; }

    const result = await window.api.getPartyStatement({ party_id: parseInt(partyId), from_date: from, to_date: to });
    if (!result.success) { showToast(result.error, 'error'); return; }

    const data = result.data;
    const container = document.getElementById('statementResult');
    const settings = await getSettingsCached();

    window._lastStatement = data;

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">Opening Balance</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.opening_balance)}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">Total Debit</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.total_debit)}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">Total Credit</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.total_credit)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">Closing Balance</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.closing_balance)}</span>
            </div>
        </div>
        <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px">
            <strong>${escapeHtml(data.party.name)}</strong> — ${data.party.type} 
            ${data.party.phone ? '| ' + escapeHtml(data.party.phone) : ''}
            ${data.party.address ? '| ' + escapeHtml(data.party.address) : ''}
            <span style="float:right">Period: ${data.from_date} to ${data.to_date}</span>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Ref No</th>
                        <th>Transaction Type</th>
                        <th>Particulars</th>
                        <th class="text-right">Debit</th>
                        <th class="text-right">Credit</th>
                        <th class="text-right">Balance</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="background:#f0f4f8;font-weight:600">
                        <td colspan="6">Opening Balance</td>
                        <td class="text-right">${formatCurrency(data.opening_balance)}</td>
                    </tr>
                    ${data.entries.map(e => `
                        <tr>
                            <td>${formatDate(e.date)}</td>
                            <td>${escapeHtml(e.reference_no || '')}</td>
                            <td>${e.reference_type}</td>
                            <td>${escapeHtml(e.description)}</td>
                            <td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : ''}</td>
                            <td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : ''}</td>
                            <td class="text-right"><strong>${formatCurrency(e.running_balance)}</strong></td>
                        </tr>
                    `).join('')}
                    ${data.entries.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">No transactions in this period</td></tr>' : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4"><strong>Total</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function showCustomerStatements() {
    document.getElementById('stType').value = 'customer';
    filterPartiesByType();
    showPartyStatement();
}

function showSupplierStatements() {
    document.getElementById('stType').value = 'supplier';
    filterPartiesByType();
    showPartyStatement();
}

// ============================================================
// Print Statement
// ============================================================
async function printStatement() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1>
            <h2>${escapeHtml(data.party.name)} — Statement of Account</h2>
            <p>Party Type: ${data.party.type} | Period: ${data.from_date} to ${data.to_date}</p>
            ${data.party.address ? `<div class="business-detail">${escapeHtml(data.party.address)}</div>` : ''}
        </div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">Opening Balance</div><div class="value-number">${formatCurrency(data.opening_balance)}</div></div>
            <div class="value-card"><div class="value-label">Total Debit</div><div class="value-number">${formatCurrency(data.total_debit)}</div></div>
            <div class="value-card"><div class="value-label">Total Credit</div><div class="value-number">${formatCurrency(data.total_credit)}</div></div>
            <div class="value-card"><div class="value-label">Closing Balance</div><div class="value-number">${formatCurrency(data.closing_balance)}</div></div>
        </div>
        <table>
            <thead><tr><th>Date</th><th>Ref No</th><th>Type</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
            <tbody>
                <tr><td colspan="6">Opening Balance</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
                ${data.entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.reference_no || '')}</td><td>${e.reference_type}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot>
        </table>
        <div class="footer"><div>Printed: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    printHTML(html);
}

async function exportStatementPDF() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const html = `
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}</h1><h2>${escapeHtml(data.party.name)} — Statement of Account</h2><p>Period: ${data.from_date} to ${data.to_date}</p></div>
        <table><thead><tr><th>Date</th><th>Ref</th><th>Type</th><th>Particulars</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
        <tbody>
            <tr><td colspan="6">Opening Balance</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
            ${data.entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.reference_no || '')}</td><td>${e.reference_type}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4"><strong>Total</strong></td><td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot></table>
        <div class="footer"><div>Generated: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">Authorized Signature</div></div>
    `;
    await window.api.printToPDF({ html });
}

// Globals
window.renderStatements = renderStatements;
window.showPartyStatement = showPartyStatement;
window.showCustomerStatements = showCustomerStatements;
window.showSupplierStatements = showSupplierStatements;
window.generateStatement = generateStatement;
window.filterPartiesByType = filterPartiesByType;
window.printStatement = printStatement;
window.exportStatementPDF = exportStatementPDF;
