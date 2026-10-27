/**
 * Customer & Supplier Statement Module
 * Shows debit/credit statements with running balance, print & PDF
 */

async function renderStatements() {
    const container = document.getElementById('page-statements');
    document.getElementById('topActions').innerHTML = '';
    window._stSelection = null;   // fresh visit: default period, not the last one

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
async function showPartyStatement(type = '') {
    const container = document.getElementById('statementContent');

    // Filter parties by the requested type (customer / supplier / both / all)
    const partyType = type || document.getElementById('stType')?.value || '';
    const [partiesResult, preset] = await Promise.all([
        window.api.getParties(partyType ? { type: partyType } : {}),
        Promise.resolve(getDatePreset('this_month'))
    ]);
    const parties = partiesResult.success ? partiesResult.data : [];

    const typeSelected = (t) => partyType === t ? ' selected' : '';
    const st = window._stSelection || {};
    const keep = v => (v !== undefined && v !== null && v !== '') ? v : undefined;
    const partyVal = keep(st.partyId) || '';
    const fromVal = keep(st.from) || preset.from;
    const toVal = keep(st.to) || preset.to;
    const typeVal = keep(st.type) !== undefined ? st.type : partyType;

    container.innerHTML = `
        <div class="card-header">
            <h2>${rl('Party Statement', 'पार्टी विवरण')}</h2>
            <div class="btn-group">
                <button class="btn btn-info btn-sm" onclick="printStatement()">🖨 ${rlt('print')}</button>
                <button class="btn btn-primary btn-sm" onclick="exportStatementPDF()">📄 ${rlt('pdf')}</button>
            </div>
        </div>
        <div class="filter-bar">
            <div class="form-group">
                <label>${rl('Party Type', 'पार्टी प्रकार')}</label>
                <select class="form-control" id="stType" onchange="filterPartiesByType()">
                    <option value=""${typeVal === '' ? ' selected' : ''}>${rl('All', 'सबै')}</option>
                    <option value="customer"${typeVal === 'customer' ? ' selected' : ''}>${rlt('customer')}</option>
                    <option value="supplier"${typeVal === 'supplier' ? ' selected' : ''}>${rlt('supplier')}</option>
                    <option value="both"${typeVal === 'both' ? ' selected' : ''}>${rl('Both', 'दुवै')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${rlt('party')}</label>
                <select class="form-control" id="stParty">
                    <option value="">${rl('-- Select Party --', '-- पार्टी छान्नुहोस् --')}</option>
                    ${parties.map(p => `<option value="${p.id}"${String(partyVal) === String(p.id) ? ' selected' : ''}>${escapeHtml(p.name)} (${p.type})</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>${rlt('from')} (BS)</label>
                <input type="date" class="form-control" id="stFrom" value="${fromVal}">
            </div>
            <div class="form-group">
                <label>${rlt('to')} (BS)</label>
                <input type="date" class="form-control" id="stTo" value="${toVal}">
            </div>
            <div class="form-group">
                <label>&nbsp;</label>
                <button class="btn btn-primary btn-sm" onclick="generateStatement()">${rlt('generate')}</button>
            </div>
            ${reportLangPicker()}
        </div>
        <div id="statementResult">
            <div style="text-align:center;padding:40px;color:var(--text-light)">
                ${rl('Select a party and date range, then click Generate.', 'पार्टी र मिति छानेर Generate थिच्नुहोस्।')}
            </div>
        </div>
    `;
    // Re-render in the newly chosen language without losing the selection,
    // and re-draw the statement already on screen (no second API call).
    if (typeof onReportLangChange === 'function') {
        onReportLangChange(async () => {
            const keepSel = {
                partyId: document.getElementById('stParty')?.value,
                from: document.getElementById('stFrom')?.value,
                to: document.getElementById('stTo')?.value,
                type: document.getElementById('stType')?.value
            };
            window._stSelection = keepSel;
            // await — the rebuild is async; drawing the statement before it
            // finishes would be overwritten by the fresh placeholder.
            await showPartyStatement(keepSel.type || '');
            if (window._lastStatement) renderStatementResult(window._lastStatement);
        }, 'statements');
    }
    // Remember the last selection so a language switch restores it exactly.
    const remember = () => {
        window._stSelection = {
            partyId: document.getElementById('stParty')?.value,
            from: document.getElementById('stFrom')?.value,
            to: document.getElementById('stTo')?.value,
            type: document.getElementById('stType')?.value
        };
    };
    ['stParty', 'stFrom', 'stTo', 'stType'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', remember);
    });
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

    window._lastStatement = result.data;
    renderStatementResult(result.data);
}

/** Which screen a statement line can be opened on, by its ledger reference type. */
const STATEMENT_MODULE_PAGES = {
    sale: 'sales',
    purchase: 'purchases',
    milk_collection: 'milk',
    payment_received: 'payment-collection',
    payment_made: 'payment-collection',
    pdc: 'pdc',
    opening: ''
};

/** Human name of the module a statement line came from. */
function statementModuleName(type) {
    const map = {
        sale: ['Sales', 'बिक्री'],
        purchase: ['Purchases', 'खरिद'],
        milk_collection: ['Milk Collection', 'दूध सङ्कलन'],
        payment_received: ['Payment received', 'प्राप्त भुक्तानी'],
        payment_made: ['Payment made', 'गरिएको भुक्तानी'],
        pdc: ['Cheque (PDC)', 'चेक (पीडीसी)'],
        opening: ['Opening balance', 'सुरुको मौज्दात'],
        manual: ['Manual entry', 'हात्तले लेखिएको']
    };
    const m = map[String(type || '')] || [String(type || '—'), String(type || '—')];
    return rl(m[0], m[1]);
}

/**
 * The generated statement itself. Split out of generateStatement() so a
 * language change can redraw it from the data already in memory instead of
 * re-querying the database (and so the selection is never lost).
 */
function renderStatementResult(data) {
    const container = document.getElementById('statementResult');
    if (!container || !data) return;

    const rows = data.entries.map((e, i) => {
        const page = STATEMENT_MODULE_PAGES[String(e.reference_type || '').toLowerCase()] || '';
        const detailId = `stDetail${i}`;
        return `
        <tr style="${e.is_pdc ? 'background:#fbfcfe' : ''}" class="mr-line"
            onclick="statementToggleDetail(${i})"
            title="${escapeHtml(rl('Click to open this line\u2019s details', 'यो लाइनको विवरण हेर्न क्लिक गर्नुहोस्'))}">
            <td>${formatDate(e.date)}</td>
            <td>${escapeHtml(e.reference_no || '')}</td>
            <td>${statementModuleName(e.reference_type)}${e.is_pdc ? ' 🏛' : ''}</td>
            <td>${escapeHtml(e.description)}${statementPdcBadge(e)}</td>
            <td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : (e.is_memo ? '<span style="color:var(--text-light)">—</span>' : '')}</td>
            <td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : (e.is_memo ? '<span style="color:var(--text-light)">—</span>' : '')}</td>
            <td class="text-right"><strong>${formatCurrency(e.running_balance)}</strong></td>
        </tr>
        <tr id="${detailId}" style="display:none">
            <td colspan="7" style="background:#f8fafc;padding:10px 14px;font-size:12px;border-bottom:1px solid var(--border)">
                <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
                    <span><strong>${rl('Date', 'मिति')}:</strong> ${formatDate(e.date)}</span>
                    <span><strong>${rlt('reference')}:</strong> ${escapeHtml(e.reference_no || '—')}</span>
                    <span><strong>${rl('Source module', 'स्रोत मोड्युल')}:</strong> ${statementModuleName(e.reference_type)}</span>
                    <span><strong>${rl('Record ID', 'रेकर्ड आईडी')}:</strong> ${e.reference_id ?? '—'}</span>
                    <span><strong>${rlt('amount')}:</strong> ${e.debit > 0 ? formatCurrency(e.debit) : (e.credit > 0 ? formatCurrency(e.credit) : '—')}</span>
                    <span><strong>${rlt('balance')}:</strong> ${formatCurrency(e.running_balance)}</span>
                    ${e.milk_type ? `<span><strong>${rl('Milk', 'दूध')}:</strong> ${escapeHtml(e.milk_type)} · ${e.milk_quantity} L · ${e.milk_rate}/${rl('L', 'लि')}</span>` : ''}
                    ${page ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();navigateTo('${page}')">↗ ${rl('Open the record', 'रेकर्ड खोल्नुहोस्')}</button>` : ''}
                </div>
            </td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div class="summary-cards" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:16px">
            <div class="summary-card card-primary" style="margin:0;padding:12px">
                <span class="label">${rlt('opening_balance')}</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.opening_balance)}</span>
            </div>
            <div class="summary-card card-success" style="margin:0;padding:12px">
                <span class="label">${rl('Total Debit', 'कुल डेबिट')}</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.total_debit)}</span>
            </div>
            <div class="summary-card card-warning" style="margin:0;padding:12px">
                <span class="label">${rl('Total Credit', 'कुल क्रेडिट')}</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.total_credit)}</span>
            </div>
            <div class="summary-card card-info" style="margin:0;padding:12px">
                <span class="label">${rlt('closing_balance')}</span>
                <span class="value" style="font-size:18px">${formatCurrency(data.closing_balance)}</span>
            </div>
        </div>
        <div style="margin-bottom:12px;padding:10px 14px;background:var(--bg);border-radius:6px;font-size:13px">
            <strong>${escapeHtml(data.party.name)}</strong> — ${data.party.type} 
            ${data.party.phone ? '| ' + escapeHtml(data.party.phone) : ''}
            ${data.party.email ? '| ✉️ ' + escapeHtml(data.party.email) : ''}
            ${data.party.address ? '| ' + escapeHtml(data.party.address) : ''}
            <span style="float:right">${rlt('period')}: ${data.from_date} → ${data.to_date}</span>
            <div style="margin-top:8px">
                <button class="btn btn-primary btn-sm" onclick="showEmailDialog()">✉️ ${rl('Email Statement', 'विवरण इमेल')}</button>
                <span style="font-size:12px;color:var(--text-light);margin-left:8px">
                    ${rl('Click any line to see its source record.', 'स्रोत रेकर्ड हेर्न कुनै पनि लाइनमा क्लिक गर्नुहोस्।')}
                </span>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th>${rlt('date')}</th>
                        <th>${rlt('reference')}</th>
                        <th>${rlt('transaction_type')}</th>
                        <th>${rlt('particulars')}</th>
                        <th class="text-right">${rlt('debit')}</th>
                        <th class="text-right">${rlt('credit')}</th>
                        <th class="text-right">${rlt('balance')}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr style="background:#f0f4f8;font-weight:600">
                        <td colspan="6">${rlt('opening_balance')}</td>
                        <td class="text-right">${formatCurrency(data.opening_balance)}</td>
                    </tr>
                    ${rows}
                    ${data.entries.length === 0 ? `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-light)">${rl('No transactions in this period', 'यो अवधिमा कुनै लेनदेन छैन')}</td></tr>` : ''}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="4"><strong>${rlt('total')}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td>
                        <td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

/** Show/hide the detail strip under one statement line (the “dropdown”). */
function statementToggleDetail(i) {
    const row = document.getElementById('stDetail' + i);
    if (!row) return;
    row.style.display = row.style.display === 'none' ? '' : 'none';
}

/**
 * Status badge for a post-dated cheque line. A held cheque is explicitly
 * labelled so a promise is never mistaken for money already received.
 */
function statementPdcBadge(e) {
    if (!e || !e.is_pdc) return '';
    const map = {
        HELD: ['Held — not yet banked', '#8a6d00', '#fff4cc'],
        DEPOSITED: ['Deposited — awaiting clearance', '#0b5394', '#dbeafe'],
        CLEARED: ['Cleared', '#155724', '#d4edda'],
        BOUNCED: ['Bounced', '#721c24', '#f8d7da'],
        CANCELLED: ['Cancelled', '#4a4a4a', '#e9ecef']
    };
    const m = map[String(e.pdc_status || '').toUpperCase()];
    if (!m) return '';
    return ` <span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600;color:${m[1]};background:${m[2]};border:1px solid ${m[1]}33">${m[0]}</span>`;
}

function showCustomerStatements() {
    showPartyStatement('customer');
}

function showSupplierStatements() {
    showPartyStatement('supplier');
}

// ============================================================
// Print Statement
// ============================================================
function buildStatementHtml(data, settings) {
    return `
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>${escapeHtml(data.party.name)} — ${rl('Statement of Account', 'खाताको विवरण')}</h2>
            <p>${rl('Party Type', 'पार्टी प्रकार')}: ${data.party.type} | ${rlt('period')}: ${data.from_date} → ${data.to_date}</p>
            ${data.party.address ? `<div class="business-detail">${escapeHtml(data.party.address)}</div>` : ''}
        </div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">${rlt('opening_balance')}</div><div class="value-number">${formatCurrency(data.opening_balance)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Total Debit', 'कुल डेबिट')}</div><div class="value-number">${formatCurrency(data.total_debit)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Total Credit', 'कुल क्रेडिट')}</div><div class="value-number">${formatCurrency(data.total_credit)}</div></div>
            <div class="value-card"><div class="value-label">${rlt('closing_balance')}</div><div class="value-number">${formatCurrency(data.closing_balance)}</div></div>
        </div>
        ${data.pdc && (data.pdc.received_held || data.pdc.issued_held) ? `
        <div class="notes-section">
            Post-dated cheques not yet cleared (NOT included in the closing balance above):
            ${data.pdc.received_held ? ` Received ${formatCurrency(data.pdc.received_held)} (${data.pdc.received_held_count} cheque(s));` : ''}
            ${data.pdc.issued_held ? ` Issued ${formatCurrency(data.pdc.issued_held)} (${data.pdc.issued_held_count} cheque(s));` : ''}
        </div>` : ''}
        <table>
            <thead><tr><th>${rlt('date')}</th><th>${rlt('reference')}</th><th>${rlt('transaction_type')}</th><th>${rlt('particulars')}</th><th class="text-right">${rlt('debit')}</th><th class="text-right">${rlt('credit')}</th><th class="text-right">${rlt('balance')}</th></tr></thead>
            <tbody>
                <tr><td colspan="6">${rlt('opening_balance')}</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
                ${data.entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.reference_no || '')}</td><td>${statementModuleName(e.reference_type)}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="4"><strong>${rlt('total')}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot>
        </table>
        <div class="footer"><div>${rl('Printed', 'प्रिन्ट')}: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">${rl('Authorized Signature', 'अधिकृत हस्ताक्षर')}</div></div>
    `;
}

async function printStatement() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();
    printHTML(buildStatementHtml(data, settings));
}

// ============================================================
// Email Statement (recipient pre-filled from party email)
// ============================================================
async function showEmailDialog() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }

    const partyEmail = (data.party && data.party.email || '').trim();
    if (!partyEmail) {
        showToast(`No email address on file for ${data.party.name}. Add one in Parties → Edit.`, 'warning');
        return;
    }

    const settings = await getSettingsCached();
    const closingLabel = data.closing_balance >= 0 ? 'Dr' : 'Cr';

    showModal(`
        <div class="modal-header">
            <h2>✉️ Email Statement — ${escapeHtml(data.party.name)}</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body">
            <form id="emailForm">
                <div class="form-group">
                    <label>To (recipient)</label>
                    <input type="email" class="form-control" name="to" value="${escapeHtml(partyEmail)}">
                </div>
                <div class="form-group">
                    <label>Subject</label>
                    <input type="text" class="form-control" name="subject" value="Statement of Account — ${escapeHtml(data.party.name)} (${data.from_date} to ${data.to_date})">
                </div>
                <div class="form-group">
                    <label>Message</label>
                    <textarea class="form-control" name="message" rows="5">Dear ${escapeHtml(data.party.name)},\n\nPlease find attached your statement of account for the period ${data.from_date} to ${data.to_date}.\n\nOpening Balance: ${formatCurrency(data.opening_balance)}\nTotal Debit: ${formatCurrency(data.total_debit)}\nTotal Credit: ${formatCurrency(data.total_credit)}\nClosing Balance: ${formatCurrency(data.closing_balance)} (${closingLabel})\n\nRegards,\n${escapeHtml(settings.business_name || '')}</textarea>
                </div>
                <p style="font-size:12px;color:var(--text-light)">The statement table will be included in the email body automatically.</p>
            </form>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="sendStatementEmail()">📤 Send Email</button>
        </div>
    `);
}

async function sendStatementEmail() {
    const data = window._lastStatement;
    if (!data) return;

    const form = document.getElementById('emailForm');
    if (!form) return;
    const formData = new FormData(form);
    const to = (formData.get('to') || '').trim();
    const subject = (formData.get('subject') || '').trim();
    const message = (formData.get('message') || '').trim();

    if (!to) { showToast('Recipient email is required', 'error'); return; }
    if (!subject) { showToast('Subject is required', 'error'); return; }

    const settings = await getSettingsCached();
    const bodyHtml = `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p><hr>${buildStatementHtml(data, settings)}`;

    // Show sending state
    const sendBtn = document.querySelector('#modalContainer button.btn-primary');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ Sending...'; }

    const result = await window.api.sendEmail({ to, subject, html: bodyHtml });
    if (result && result.success) {
        showToast(`✅ Email sent to ${to}`);
        closeModal();
    } else {
        showToast(`Email failed: ${result?.error || 'Unknown error'}`, 'error');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 Send Email'; }
    }
}

async function exportStatementPDF() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    // The PDF gets its own style block so the Devanagari stack travels with it.
    const html = `
        <style>
            @page { size: A4; margin: 15mm 12mm 20mm 12mm; }
            body { font-family: 'Noto Sans Devanagari','Kalimati','Mukta','Nirmala UI','Mangal','Segoe UI','Helvetica Neue',Arial,sans-serif; font-size: 10pt; color: #222; }
            table { width: 100%; border-collapse: collapse; font-size: 9pt; }
            thead { display: table-header-group; }
            th, td { padding: 5px 8px; border: 1px solid #bbb; text-align: left; }
            th { background: #1a5276; color: #fff; }
            .text-right { text-align: right; }
            .header { text-align: center; margin-bottom: 14px; border-bottom: 3px double #1a5276; padding-bottom: 10px; }
            .header h1 { font-size: 20pt; margin: 0; color: #1a5276; }
            .header h2 { font-size: 13pt; margin: 6px 0 2px; }
            .footer { display: flex; justify-content: space-between; margin-top: 18px; font-size: 9pt; }
            tfoot tr td { background: #eef2f7; font-weight: 700; }
        </style>
        <div class="header"><h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1><h2>${escapeHtml(data.party.name)} — ${rl('Statement of Account', 'खाताको विवरण')}</h2><p>${rlt('period')}: ${data.from_date} → ${data.to_date}</p></div>
        <table><thead><tr><th>${rlt('date')}</th><th>${rlt('reference')}</th><th>${rlt('transaction_type')}</th><th>${rlt('particulars')}</th><th class="text-right">${rlt('debit')}</th><th class="text-right">${rlt('credit')}</th><th class="text-right">${rlt('balance')}</th></tr></thead>
        <tbody>
            <tr><td colspan="6">${rlt('opening_balance')}</td><td class="text-right"><strong>${formatCurrency(data.opening_balance)}</strong></td></tr>
            ${data.entries.map(e => `<tr><td>${formatDate(e.date)}</td><td>${escapeHtml(e.reference_no || '')}</td><td>${statementModuleName(e.reference_type)}</td><td>${escapeHtml(e.description)}</td><td class="text-right">${e.debit > 0 ? formatCurrency(e.debit) : '-'}</td><td class="text-right">${e.credit > 0 ? formatCurrency(e.credit) : '-'}</td><td class="text-right">${formatCurrency(e.running_balance)}</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="4"><strong>${rlt('total')}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_debit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.total_credit)}</strong></td><td class="text-right"><strong>${formatCurrency(data.closing_balance)}</strong></td></tr></tfoot></table>
        <div class="footer"><div>${rl('Generated', 'बनाइएको मिति')}: ${new Date().toLocaleDateString('en-IN')}</div><div class="signature">${rl('Authorized Signature', 'अधिकृत हस्ताक्षर')}</div></div>
    `;
    await window.api.printToPDF({ html });
}

// Globals
window.renderStatements = renderStatements;
window.renderStatementResult = renderStatementResult;
window.statementToggleDetail = statementToggleDetail;
window.showPartyStatement = showPartyStatement;
window.showCustomerStatements = showCustomerStatements;
window.showSupplierStatements = showSupplierStatements;
window.generateStatement = generateStatement;
window.filterPartiesByType = filterPartiesByType;
window.printStatement = printStatement;
window.exportStatementPDF = exportStatementPDF;
