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
    const stMilkType = keep(st.milkType) || '';
    const stShift = keep(st.shift) || '';

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
                <label>${rl('Transaction Type', 'कारोबारको प्रकार')}</label>
                <select class="form-control" id="stTxnType">
                    <option value="">${rl('All', 'सबै')}</option>
                    <option value="purchase">${rl('Purchase', 'खरिद')}</option>
                    <option value="sale">${rl('Sale', 'बिक्री')}</option>
                    <option value="milk_collection">${rl('Milk collection', 'दूध सङ्कलन')}</option>
                    <option value="receipt">${rl('Receipt', 'प्राप्ति')}</option>
                    <option value="payment">${rl('Payment', 'भुक्तानी')}</option>
                    <option value="advance">${rl('Advance', 'अग्रिम')}</option>
                    <option value="advance_adjustment">${rl('Advance adjustment', 'अग्रिम मिलान')}</option>
                    <option value="expense">${rl('Expense', 'खर्च')}</option>
                    <option value="expense_payment">${rl('Expense paid', 'खर्च भुक्तानी')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${rl('Milk Type', 'दूधको प्रकार')}</label>
                <select class="form-control" id="stMilkType" onchange="statementRefilter()">
                    <option value=""${stMilkType === '' ? ' selected' : ''}>${rl('All', 'सबै')}</option>
                    <option value="cow"${stMilkType === 'cow' ? ' selected' : ''}>${rl('Cow', 'गाई')}</option>
                    <option value="buffalo"${stMilkType === 'buffalo' ? ' selected' : ''}>${rl('Buffalo', 'भैंसी')}</option>
                    <option value="mixed"${stMilkType === 'mixed' ? ' selected' : ''}>${rl('Mixed', 'मिश्रित')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${rl('Shift', 'सिफ्ट')}</label>
                <select class="form-control" id="stShift" onchange="statementRefilter()">
                    <option value=""${stShift === '' ? ' selected' : ''}>${rl('All', 'सबै')}</option>
                    <option value="morning"${stShift === 'morning' ? ' selected' : ''}>${rl('Morning', 'बिहान')}</option>
                    <option value="evening"${stShift === 'evening' ? ' selected' : ''}>${rl('Evening', 'साँझ')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${rl('Source Module', 'स्रोत मोड्युल')}</label>
                <select class="form-control" id="stSource">
                    <option value="">${rl('All', 'सबै')}</option>
                    <option value="Sales">${rl('Sales', 'बिक्री')}</option>
                    <option value="Purchases">${rl('Purchases', 'खरिद')}</option>
                    <option value="Milk Collection">${rl('Milk Collection', 'दूध सङ्कलन')}</option>
                    <option value="Payment">${rl('Payment', 'भुक्तानी')}</option>
                    <option value="Advance">${rl('Advance', 'अग्रिम')}</option>
                    <option value="Petty Cash">${rl('Petty Cash', 'सानो नगद')}</option>
                    <option value="Expenses">${rl('Expenses', 'खर्च')}</option>
                </select>
            </div>
            <div class="form-group">
                <label>${rl('Reference No', 'रसिद नं.')}</label>
                <input type="text" class="form-control" id="stRef" placeholder="${rl('Search reference', 'रसिद खोज्नुहोस्')}">
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
                type: document.getElementById('stType')?.value,
                milkType: document.getElementById('stMilkType')?.value,
                shift: document.getElementById('stShift')?.value
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
            type: document.getElementById('stType')?.value,
            milkType: document.getElementById('stMilkType')?.value,
            shift: document.getElementById('stShift')?.value
        };
    };
    ['stParty', 'stFrom', 'stTo', 'stType', 'stMilkType', 'stShift'].forEach(id => {
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

    pendingStatementRequest = true;
    const result = await window.api.getPartyStatement({
        party_id: parseInt(partyId), from_date: from, to_date: to,
        transaction_type: document.getElementById('stTxnType')?.value || undefined,
        source: document.getElementById('stSource')?.value || undefined,
        reference: document.getElementById('stRef')?.value || undefined,
        milk_type: document.getElementById('stMilkType')?.value || undefined,
        shift: document.getElementById('stShift')?.value || undefined
    });
    pendingStatementRequest = false;
    if (!result.success) { showToast(result.error, 'error'); return; }

    window._lastStatement = result.data;
    renderStatementResult(result.data);
}

/**
 * Re-run the statement when the milk-type / shift filter changes, but only when
 * a statement is already on screen (never a stray query from a fresh visit).
 */
let pendingStatementRequest = false;
function statementRefilter() {
    if (!window._lastStatement) return;
    if (pendingStatementRequest) return;
    generateStatement();
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
        receipt: ['Receipt', 'प्राप्ति'],
        payment: ['Payment made', 'गरिएको भुक्तानी'],
        advance: ['Advance', 'अग्रिम'],
        advance_adjustment: ['Advance adjusted', 'अग्रिम मिलान'],
        expense: ['Expense bill', 'खर्च बिल'],
        expense_payment: ['Expense paid', 'खर्च भुक्तानी'],
        opening: ['Opening balance', 'सुरुको मौज्दात'],
        manual: ['Manual entry', 'हात्तले लेखिएको']
    };
    const m = map[String(type || '')] || [String(type || '—'), String(type || '—')];
    return rl(m[0], m[1]);
}

/** One dash for a field that does not apply — never a fake zero. */
const ST_DASH = '<span style="color:var(--text-light)">—</span>';

/** Quantity display: real numbers, no forced decimals, dash when absent. */
function stQty(v) {
    if (v == null || v === '') return ST_DASH;
    const n = Number(v);
    if (!isFinite(n)) return escapeHtml(String(v));
    return String(Math.round(n * 1000) / 1000);
}

/**
 * Item / Quantity / Unit / Rate cells for one statement row, built from the
 * real sales_items / purchase_items / milk_collections records attached by
 * the backend. A row with no recorded item detail shows dashes — never 0.
 */
function statementItemCells(e) {
    const items = Array.isArray(e.items) ? e.items.filter(i => i && (i.product_name || i.quantity != null)) : [];
    if (!items.length) return { item: ST_DASH, qty: ST_DASH, unit: ST_DASH, rate: ST_DASH };
    const first = items[0];
    const units = [...new Set(items.map(i => i.unit).filter(Boolean))];
    const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const sameRate = items.length === 1 || items.every(i => Number(i.rate) === Number(first.rate));
    return {
        item: escapeHtml(first.product_name || '—') + (items.length > 1 ? ` <span style="color:var(--text-light)">(+${items.length - 1})</span>` : ''),
        qty: items.length === 1 ? stQty(first.quantity) : (units.length === 1 ? stQty(totalQty) : ST_DASH),
        unit: units.length === 1 ? escapeHtml(units[0]) : ST_DASH,
        rate: sameRate && first.rate != null ? formatCurrency(first.rate) : ST_DASH
    };
}

/**
 * Quantity / rate for one statement row, taken from the row's OWN
 * qty_lines (milk collections for milk bills, goods lines for invoices).
 * A row with no recorded quantity shows a dash — never a made-up zero.
 */
function statementQtyCells(e) {
    const lines = Array.isArray(e.qty_lines) ? e.qty_lines.filter(l => Number(l.quantity) > 0) : [];
    if (!lines.length) return { qty: ST_DASH, rate: ST_DASH, rateValue: null, unit: '', lines };
    const units = [...new Set(lines.map(l => l.unit).filter(Boolean))];
    const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    const firstRate = lines[0].rate;
    const sameRate = lines.every(l => Number(l.rate) === Number(firstRate));
    return {
        // Two different units on one row (e.g. a bill of litres and kilograms)
        // cannot be summed into one figure — the row shows its lines instead.
        qty: units.length === 1 ? stQty(total) : ST_DASH,
        rate: sameRate && firstRate != null && isFinite(Number(firstRate)) ? formatCurrency(firstRate) : ST_DASH,
        rateValue: sameRate && firstRate != null && isFinite(Number(firstRate)) ? Number(firstRate) : null,
        unit: units.length === 1 ? units[0] : '',
        lines
    };
}

/** Milk-type / shift cells: the row's own recorded values, or "Not applicable". */
const ST_NA = '<span style="color:var(--text-light)">' + 'N/A' + '</span>';
const ST_NOTE = '#8a5a00';

/** Footnote marker for a purchase row the records could not reconcile. */
function statementUnreconciledMark() {
    return `<sup style="color:${ST_NOTE};font-weight:700" title="${escapeHtml(rl('No matching milk collection line', 'दूध सङ्कलन लाइन मिलेन'))}">†</sup>`;
}

function statementMilkTypeCell(e) {
    if (e && e.qty_unreconciled) return `<span style="color:${ST_NOTE}">— ${statementUnreconciledMark()}</span>`;
    return e && e.milk_type_label ? escapeHtml(e.milk_type_label) : ST_NA;
}
function statementShiftCell(e) {
    if (e && e.qty_unreconciled) return `<span style="color:${ST_NOTE}">— ${statementUnreconciledMark()}</span>`;
    return e && e.shift_label ? escapeHtml(e.shift_label) : ST_NA;
}

/**
 * Footnote for a statement whose purchase rows could not be matched to a milk
 * collection. It names the gap and says plainly that nothing was guessed and
 * no amount changed. Shared by the screen, print, PDF and email views.
 */
function statementUnreconciledNote(data) {
    const n = Number(data && data.qty_unreconciled_count) || 0;
    if (!n) return '';
    const text = rl(
        `† ${n} purchase line${n === 1 ? '' : 's'} in this statement could not be matched to a milk collection line, so Milk Type and Quantity are left blank rather than guessed. The Debit / Credit amounts and all totals are exactly as recorded.`,
        `† यो विवरणका ${n} खरिद लाइन दूध सङ्कलन लाइनसँग मिल्न सकेनन्, त्यसैले दूधको प्रकार र परिमाण अनुमान नगरी खाली छाडिएको छ। डेबिट / क्रेडिट र सबै जम्मा रकम यथावत् छन्।`
    );
    return `<div class="stmt-note">${escapeHtml(text)}</div>`;
}

/**
 * ============================================================
 * Column settings
 * ============================================================
 * Every column a statement can show. `width` is the percentage used by the
 * printed/PDF table; the screen table sizes itself from the same plan so the
 * two views always show the same columns in the same order.
 */
const STATEMENT_COLUMN_DEFS = () => ([
    { key: 'acct_date', label: () => rl('Date', 'मिति'), width: '6%' },
    { key: 'txn_date', label: () => rl('Transaction Date', 'कारोबार मिति'), width: '6%' },
    { key: 'reference', label: () => rlt('reference'), width: '5%' },
    { key: 'type', label: () => rlt('transaction_type'), width: '7%' },
    { key: 'particulars', label: () => rl('Particulars / Item', 'विवरण / वस्तु'), width: '14%', particulars: true },
    { key: 'milk_type', label: () => rl('Milk Type', 'दूधको प्रकार'), width: '6%' },
    { key: 'shift', label: () => rl('Shift', 'सिफ्ट'), width: '4%' },
    { key: 'qty', label: () => rlt('quantity'), width: '5%', right: true },
    { key: 'unit', label: () => rl('Unit', 'इकाई'), width: '4%' },
    { key: 'rate', label: () => rlt('rate'), width: '6%', right: true, money: true },
    { key: 'debit', label: () => rlt('debit'), width: '7%', right: true, money: true },
    { key: 'credit', label: () => rlt('credit'), width: '7%', right: true, money: true },
    { key: 'balance', label: () => rlt('balance'), width: '8%', right: true, money: true },
    { key: 'source', label: () => rl('Source Module', 'स्रोत मोड्युल'), width: '6%' },
    { key: 'remarks', label: () => rl('Remarks', 'कैफियत'), width: '6%' },
    { key: 'status', label: () => rlt('status'), width: '3%' }
]);

/**
 * Default columns differ by party type. A supplier statement tracks milk
 * collection, so Shift (and Milk Type) are shown; a customer statement has no
 * shift to track, so it is hidden until the user enables it.
 */
const STATEMENT_DEFAULT_COLUMNS = {
    supplier: ['acct_date', 'reference', 'type', 'particulars', 'milk_type', 'shift', 'qty', 'unit', 'rate', 'debit', 'credit', 'balance'],
    both: ['acct_date', 'reference', 'type', 'particulars', 'milk_type', 'shift', 'qty', 'unit', 'rate', 'debit', 'credit', 'balance'],
    customer: ['acct_date', 'reference', 'type', 'particulars', 'qty', 'unit', 'rate', 'debit', 'credit', 'balance'],
    other: ['acct_date', 'reference', 'type', 'particulars', 'qty', 'unit', 'rate', 'debit', 'credit', 'balance']
};

const STATEMENT_COLUMN_STORAGE = 'statementColumnSettings';

function statementPartyKind(data) {
    const t = String((data && data.party && data.party.type) || '').trim().toLowerCase();
    if (t === 'supplier') return 'supplier';
    if (t === 'customer') return 'customer';
    if (t === 'both') return 'both';
    return 'other';
}

function statementColumnPrefs() {
    try { return JSON.parse(localStorage.getItem(STATEMENT_COLUMN_STORAGE) || '{}') || {}; } catch (e) { return {}; }
}

function statementSaveColumnPrefs(prefs) {
    try { localStorage.setItem(STATEMENT_COLUMN_STORAGE, JSON.stringify(prefs)); } catch (e) { /* storage unavailable */ }
}

function statementDefaultColumns(kind) {
    const all = STATEMENT_COLUMN_DEFS().map(c => c.key);
    const list = STATEMENT_DEFAULT_COLUMNS[kind] || STATEMENT_DEFAULT_COLUMNS.other;
    return list.filter(k => all.includes(k));
}

/** The column settings in force for THIS statement (saved preferences win). */
function statementColumnState(data) {
    const kind = statementPartyKind(data);
    const saved = statementColumnPrefs()[kind] || {};
    const all = STATEMENT_COLUMN_DEFS().map(c => c.key);
    const visible = Array.isArray(saved.visible)
        ? saved.visible.filter(k => all.includes(k)).sort((a, b) => all.indexOf(a) - all.indexOf(b))
        : statementDefaultColumns(kind);
    return { kind, visible, compact: !!saved.compact, all };
}

/**
 * Columns actually drawn, in plan order, for the party's type. Hiding a column
 * only filters what is displayed: no amount, total or balance is recalculated.
 */
function statementVisibleColumns(data) {
    const state = statementColumnState(data);
    return STATEMENT_COLUMN_DEFS().filter(c => state.visible.includes(c.key));
}

function statementSetColumns(data, visible, compact) {
    const prefs = statementColumnPrefs();
    const kind = statementPartyKind(data);
    const all = STATEMENT_COLUMN_DEFS().map(c => c.key);
    const clean = (visible || []).filter(k => all.includes(k)).sort((a, b) => all.indexOf(a) - all.indexOf(b));
    prefs[kind] = { visible: clean.length ? clean : statementDefaultColumns(kind), compact: !!compact };
    statementSaveColumnPrefs(prefs);
}

/** The Column Settings panel (checkboxes + Show All / Reset / compact). */
function statementColumnsPanelHtml(data) {
    const state = statementColumnState(data);
    const boxes = STATEMENT_COLUMN_DEFS().map(c => {
        const on = state.visible.includes(c.key);
        return `<label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:12px;padding:3px 8px;border:1px solid var(--border);border-radius:5px;cursor:pointer;background:#fff">
            <input type="checkbox" value="${c.key}"${on ? ' checked' : ''} onchange="statementToggleColumn(this.value, this.checked)">
            ${c.label()}
        </label>`;
    }).join('');
    return `<div id="stColumnPanel" style="display:${window._stPanelOpen ? 'block' : 'none'};border:1px solid var(--border);border-radius:6px;padding:10px 12px;margin-bottom:12px;background:var(--bg)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <strong style="font-size:13px">${rl('Column Settings', 'स्तम्भ सेटिङ')}</strong>
            <div class="btn-group">
                <button class="btn btn-secondary btn-sm" onclick="statementShowAllColumns()">${rl('Show All', 'सबै देखाउनुहोस्')}</button>
                <button class="btn btn-secondary btn-sm" onclick="statementResetColumns()">${rl('Reset Default', 'पूर्वनिर्धारित')}</button>
            </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${boxes}</div>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;font-size:12px;margin-top:10px">
            <input type="checkbox"${state.compact ? ' checked' : ''} onchange="statementToggleCompactPrint(this.checked)">
            ${rl('Compact print layout (smaller type, fits many columns)', 'संकुचित प्रिन्ट लेआउट (सानो अक्षर, धेरै स्तम्भ मिल्ने)')}
        </label>
        <div style="font-size:11px;color:var(--text-light);margin-top:6px">
            ${rl('Date, Particulars, Debit / Credit and Running Balance are shown by default. Hiding a column never changes any amount or total.',
                 'मिति, विवरण, डेबिट / क्रेडिट र चलिरहेको मौज्दात पूर्वनिर्धारित रूपमा देखिन्छ। स्तम्भ लुकाउँदा कुनै रकम वा जम्मा फेरिँदैन।')}
            ${state.kind === 'supplier' || state.kind === 'both'
                ? ' ' + rl('Supplier layout: Shift is shown by default.', 'आपूर्तिकर्ता लेआउट: सिफ्ट पूर्वनिर्धारित रूपमा देखिन्छ।')
                : ' ' + rl('Customer layout: Shift is hidden by default — enable it above when needed.', 'ग्राहक लेआउट: सिफ्ट पूर्वनिर्धारित रूपमा लुकेको छ — आवश्यक परे माथिबाट खोल्नुहोस्।')}
        </div>
    </div>`;
}

function statementColumnsPanelToggle() {
    window._stPanelOpen = !window._stPanelOpen;
    const panel = document.getElementById('stColumnPanel');
    if (panel) panel.style.display = window._stPanelOpen ? 'block' : 'none';
}

function statementToggleColumn(key, checked) {
    const data = window._lastStatement;
    if (!data) return;
    const state = statementColumnState(data);
    let visible = state.visible.slice();
    if (checked) { if (!visible.includes(key)) visible.push(key); }
    else visible = visible.filter(k => k !== key);
    if (!visible.length) {
        showToast(rl('At least one column must stay visible', 'कम्तीमा एउटा स्तम्भ देखिनै पर्छ'), 'warning');
        renderStatementResult(data);
        return;
    }
    statementSetColumns(data, visible, state.compact);
    window._stPanelOpen = true;
    renderStatementResult(data);
}

function statementShowAllColumns() {
    const data = window._lastStatement;
    if (!data) return;
    const state = statementColumnState(data);
    statementSetColumns(data, state.all, state.compact);
    window._stPanelOpen = true;
    renderStatementResult(data);
}

function statementResetColumns() {
    const data = window._lastStatement;
    if (!data) return;
    statementSetColumns(data, statementDefaultColumns(statementPartyKind(data)), false);
    window._stPanelOpen = true;
    renderStatementResult(data);
}

function statementToggleCompactPrint(checked) {
    const data = window._lastStatement;
    if (!data) return;
    const state = statementColumnState(data);
    statementSetColumns(data, state.visible, checked);
    window._stPanelOpen = true;
    renderStatementResult(data);
}

/**
 * The item lines of one statement row — the product/quantity/rate records the
 * backend attached. Empty means the row has no recorded item detail.
 */
function statementDisplayLines(e) {
    const lines = Array.isArray(e && e.display_lines) ? e.display_lines : [];
    return lines.filter(l => l && (l.product_name || Number(l.quantity) > 0));
}

/**
 * One table cell, by column key. `line` is the item line being drawn (null for
 * a row with no item detail) and `first` marks the first line of a row: the
 * row's debit, credit, running balance and status appear there ONCE, so a bill
 * total is never repeated against each of its items.
 */
function statementCellHtml(key, e, line, first, qtyCells, opts) {
    const print = !!(opts && opts.print);
    const num = print ? 'num' : 'text-right';
    const money = print ? stmtMoney : formatCurrency;
    switch (key) {
        case 'acct_date': return `<td>${formatDate(e.accounting_date || e.date)}</td>`;
        case 'txn_date': return `<td>${formatDate(e.date)}</td>`;
        case 'reference': return `<td>${escapeHtml(e.reference_no || '')}</td>`;
        case 'type': return `<td>${statementModuleName(e.statement_type || e.reference_type)}${first && e.is_pdc ? ' 🏛' : ''}</td>`;
        case 'particulars': {
            const text = (line && line.product_name) ? line.product_name : (e.description || '');
            return `<td class="particulars"${print ? '' : ' style="white-space:normal"'}>${escapeHtml(text)}${first && !print ? statementPdcBadge(e) : ''}</td>`;
        }
        case 'milk_type': {
            if (first && e.qty_unreconciled && !line) return `<td><span style="color:${ST_NOTE}">— ${statementUnreconciledMark()}</span></td>`;
            const v = line ? line.milk_type_label : (e.milk_type_label || '');
            if (v) return `<td>${escapeHtml(v)}</td>`;
            return `<td>${line ? ST_DASH : ST_NA}</td>`;
        }
        case 'shift': {
            if (first && e.qty_unreconciled && !line) return `<td><span style="color:${ST_NOTE}">— ${statementUnreconciledMark()}</span></td>`;
            const v = line ? line.shift_label : (e.shift_label || '');
            if (v) return `<td>${escapeHtml(v)}</td>`;
            return `<td>${line ? ST_DASH : ST_NA}</td>`;
        }
        case 'qty': {
            if (line) return `<td class="${num}">${stQty(line.quantity)}</td>`;
            if (first && e.qty_unreconciled) return `<td class="${num}">${statementUnreconciledMark()}</td>`;
            return `<td class="${num}">${qtyCells.qty === ST_DASH ? '' : qtyCells.qty}</td>`;
        }
        case 'unit': {
            const u = line ? line.unit : qtyCells.unit;
            return `<td>${u ? escapeHtml(u) : ST_DASH}</td>`;
        }
        case 'rate': {
            const r = line ? line.rate : qtyCells.rateValue;
            return `<td class="${num}">${r == null || r === '' ? '' : money(r)}</td>`;
        }
        case 'debit':
            if (!first) return '<td></td>';
            return `<td class="${num}">${e.debit > 0 ? money(e.debit) : (e.is_memo ? ST_DASH : '')}</td>`;
        case 'credit':
            if (!first) return '<td></td>';
            return `<td class="${num}">${e.credit > 0 ? money(e.credit) : (e.is_memo ? ST_DASH : '')}</td>`;
        case 'balance':
            if (!first) return '<td></td>';
            return `<td class="${num}">${print ? money(e.running_balance) : `<strong>${money(e.running_balance)}</strong>`}</td>`;
        case 'source': return `<td>${escapeHtml(e.source_module || '')}</td>`;
        case 'remarks': {
            const notes = String(e.payment_notes || e.payment_notes_made || '').trim();
            return `<td class="${print ? 'wrap' : ''}">${notes ? escapeHtml(notes) : ''}</td>`;
        }
        case 'status': return `<td>${first ? statementStatusCell(e) : ''}</td>`;
    }
    return '<td></td>';
}

/** Opening-balance row, laid out for whichever columns are visible. */
function statementOpeningRowHtml(cols, data, opts) {
    const print = !!(opts && opts.print);
    const keys = cols.map(c => c.key);
    const bal = keys.indexOf('balance');
    const money = print ? stmtMoney : formatCurrency;
    const span = bal > 0 ? bal : keys.length;
    let html = `<td colspan="${span}" style="background:#f0f4f8;font-weight:600">${rlt('opening_balance')}</td>`;
    for (let i = span; i < keys.length; i++) {
        html += keys[i] === 'balance'
            ? `<td class="${print ? 'num' : 'text-right'}" style="background:#f0f4f8;font-weight:600">${money(data.opening_balance)}</td>`
            : '<td></td>';
    }
    return `<tr>${html}</tr>`;
}

/** Grand-total row, laid out for whichever columns are visible. */
function statementTotalRowHtml(cols, data, opts) {
    const print = !!(opts && opts.print);
    const keys = cols.map(c => c.key);
    const money = print ? stmtMoney : formatCurrency;
    const idx = ['debit', 'credit', 'balance'].map(k => keys.indexOf(k)).filter(i => i >= 0);
    if (!idx.length) return `<tr><td colspan="${keys.length}"><strong>${rlt('total')}</strong></td></tr>`;
    const first = Math.min(...idx);
    let html = first > 0 ? `<td colspan="${first}"><strong>${rlt('total')}</strong></td>` : '';
    for (let i = first; i < keys.length; i++) {
        const k = keys[i];
        const cls = print ? 'num' : 'text-right';
        if (k === 'debit') html += `<td class="${cls}"><strong>${money(data.total_debit)}</strong></td>`;
        else if (k === 'credit') html += `<td class="${cls}"><strong>${money(data.total_credit)}</strong></td>`;
        else if (k === 'balance') html += `<td class="${cls}"><strong>${money(data.closing_balance)}</strong></td>`;
        else html += '<td></td>';
    }
    return `<tr class="total-row">${html}</tr>`;
}

/** Quantity text from a per-unit map: "1,200 L + 15 kg", or a dash. */
function stQtyMapText(map) {
    const parts = Object.entries(map || {})
        .filter(([, v]) => Math.abs(Number(v) || 0) > 0.0005)
        .map(([u, v]) => `${stQty(v)}${u ? ' ' + escapeHtml(u) : ''}`);
    return parts.length ? parts.join(' + ') : ST_DASH;
}

/**
 * Quantity summary rows for the statement. Purchase and sales quantities are
 * separate columns so the two are never added together.
 */
function statementQtySummaryRows(data) {
    const q = data && data.qty_summary;
    if (!q || !q.has_quantity) return [];
    const p = q.purchase || {};
    const s = q.sales || {};
    const rows = [
        [rl('Cow Milk', 'गाईको दूध'), stQtyMapText(p.cow_by_unit), stQtyMapText(s.cow_by_unit)],
        [rl('Buffalo Milk', 'भैंसीको दूध'), stQtyMapText(p.buffalo_by_unit), stQtyMapText(s.buffalo_by_unit)],
        [rl('Mixed Milk', 'मिश्रित दूध'), stQtyMapText(p.mixed_by_unit), stQtyMapText(s.mixed_by_unit)],
        [rl('Other items', 'अन्य वस्तु'), stQtyMapText(p.other_by_unit), stQtyMapText(s.other_by_unit)],
        [rl('Morning shift', 'बिहान सिफ्ट'), stQtyMapText(p.morning_by_unit), stQtyMapText(s.morning_by_unit)],
        [rl('Evening shift', 'साँझ सिफ्ट'), stQtyMapText(p.evening_by_unit), stQtyMapText(s.evening_by_unit)],
        [rl('Shift not recorded', 'सिफ्ट नखुलेको'), stQtyMapText(p.shift_unknown_by_unit), stQtyMapText(s.shift_unknown_by_unit)]
    ];
    if (q.net && q.net.meaningful) {
        rows.push([rl('Net (Sales − Purchase)', 'खुद (बिक्री − खरिद)'), '', stQtyMapText(q.net.by_unit)]);
    }
    // Only categories this statement actually has — a party with no cow milk
    // does not need a row of dashes for it.
    return rows.filter(r => !(r[1] === ST_DASH && r[2] === ST_DASH));
}

/** The summary table itself (shared by screen, print and PDF). */
function statementQtySummaryHtml(data, opts = {}) {
    const rows = statementQtySummaryRows(data);
    if (!rows.length) return '';
    const q = data.qty_summary;
    const head = `<thead><tr>` +
        `<th>${rl('Category', 'श्रेणी')}</th>` +
        `<th class="text-right">${rl('Purchase Qty', 'खरिद परिमाण')}</th>` +
        `<th class="text-right">${rl('Sales Qty', 'बिक्री परिमाण')}</th></tr></thead>`;
    const body = rows.map(r =>
        `<tr><td>${r[0]}</td><td class="text-right">${r[1]}</td><td class="text-right">${r[2]}</td></tr>`).join('') +
        `<tr class="total-row"><td><strong>${rl('Grand Total Quantity', 'कुल परिमाण')}</strong></td>` +
        `<td class="text-right"><strong>${stQtyMapText(q.purchase.by_unit)}</strong></td>` +
        `<td class="text-right"><strong>${stQtyMapText(q.sales.by_unit)}</strong></td></tr>`;
    return `<div class="section-title" style="margin-top:16px">${rl('Quantity Summary', 'परिमाण सारांश')}</div>` +
        `<table class="compact stmt-qty-summary" ${opts.tableStyle || ''}>${head}<tbody>${body}</tbody></table>`;
}

/**
 * Item-wise quantity totals: one row per product AND unit. Litres and
 * kilograms never share a row, two milk types are never merged, and a bill is
 * counted once because the totals come from the same lines the table shows.
 */
function statementItemQtySummaryHtml(data, opts = {}) {
    const q = data && data.qty_summary;
    const items = (q && Array.isArray(q.items)) ? q.items : [];
    if (!items.length) return '';
    const head = `<thead><tr>` +
        `<th>${rl('Item', 'वस्तु')}</th>` +
        `<th>${rl('Unit', 'इकाई')}</th>` +
        `<th class="text-right">${rl('Purchase Qty', 'खरिद परिमाण')}</th>` +
        `<th class="text-right">${rl('Sales Qty', 'बिक्री परिमाण')}</th></tr></thead>`;
    const body = items.map(r => `<tr>` +
        `<td>${escapeHtml(r.name)}</td>` +
        `<td>${r.unit ? escapeHtml(r.unit) : ST_DASH}</td>` +
        `<td class="text-right">${r.purchase_qty > 0 ? stQty(r.purchase_qty) : ST_DASH}</td>` +
        `<td class="text-right">${r.sale_qty > 0 ? stQty(r.sale_qty) : ST_DASH}</td>` +
        `</tr>`).join('');
    return `<div class="section-title" style="margin-top:16px">${rl('Item-wise Quantity Summary', 'वस्तुगत परिमाण सारांश')}</div>` +
        `<table class="compact stmt-item-summary" ${opts.tableStyle || ''}>${head}<tbody>${body}</tbody></table>`;
}

/** Human label for the filters currently applied (print / PDF header). */
function statementFilterText(data) {
    const f = (data && data.filters) || {};
    const parts = [];
    if (f.transaction_type) parts.push(`${rlt('transaction_type')}: ${statementModuleName(f.transaction_type)}`);
    if (f.source) parts.push(`${rl('Source Module', 'स्रोत मोड्युल')}: ${f.source}`);
    if (f.milk_type) parts.push(`${rl('Milk Type', 'दूधको प्रकार')}: ${f.milk_type.charAt(0).toUpperCase() + f.milk_type.slice(1)}`);
    if (f.shift) parts.push(`${rl('Shift', 'सिफ्ट')}: ${f.shift.charAt(0).toUpperCase() + f.shift.slice(1)}`);
    if (f.reference) parts.push(`${rlt('reference')}: ${f.reference}`);
    return parts.join(' · ');
}

/** Payment-status badge: paid / unpaid / partial / settled / cheque state. */
function statementStatusCell(e) {
    if (e.is_pdc) return statementPdcBadge(e) || ST_DASH;
    const s = String(e.payment_status || '').toLowerCase();
    const map = {
        paid: ['Paid', 'तिरिएको', '#155724', '#d4edda'],
        unpaid: ['Unpaid', 'तिर्नुबाँकी', '#721c24', '#f8d7da'],
        partial: ['Partly paid', 'अंशतः तिरिएको', '#856404', '#fff3cd'],
        settled: ['Settled', 'मिलान भयो', '#155724', '#d4edda']
    };
    const m = map[s];
    if (!m) return ST_DASH;
    return `<span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:10px;font-weight:600;color:${m[2]};background:${m[3]};border:1px solid ${m[2]}33">${rl(m[0], m[1])}</span>`;
}

/** Item-wise detail list for the expandable strip under a row. */
function statementItemsList(e) {
    const items = Array.isArray(e.items) ? e.items : [];
    if (!items.length) {
        // Part of an invoice posted as several ledger rows: the goods were
        // shown on the invoice's main row — explain instead of showing none.
        if (e.items_split_part && e.items_invoice_total != null) {
            return `<div style="margin-top:6px;color:var(--text-light)">` +
                rl(`Goods for this invoice are listed on its main row (invoice total ${formatCurrency(e.items_invoice_total)}).`,
                   `यो बिलका वस्तुहरू मुख्य लाइनमा देखिएका छन् (बिल जम्मा ${formatCurrency(e.items_invoice_total)})।`) +
                `</div>`;
        }
        return '';
    }
    const lines = items.map(it =>
        `<div>• ${escapeHtml(it.product_name || '—')} — ${stQty(it.quantity)} ${escapeHtml(it.unit || '')}` +
        (it.rate != null ? ` @ ${formatCurrency(it.rate)}` : '') +
        (it.amount != null ? ` = ${formatCurrency(it.amount)}` : '') + `</div>`).join('');
    let note = '';
    if (e.items_split_count > 1) {
        note = `<div style="margin-top:3px;color:#856404">` +
            rl(`Full invoice ${formatCurrency(e.items_invoice_total)} — posted as ${e.items_split_count} ledger rows.`,
               `पूरा बिल ${formatCurrency(e.items_invoice_total)} — ${e.items_split_count} खाता लाइनमा विभाजित।`) +
            (e.items_rows_total != null
                ? ' ' + rl(`(those rows total ${formatCurrency(e.items_rows_total)})`, `(ती लाइनहरू जम्मा ${formatCurrency(e.items_rows_total)})`)
                : '') + `</div>`;
    }
    return `<div style="margin-top:6px"><strong>${rl('Items', 'वस्तुहरू')}:</strong>${lines}${note}</div>`;
}

/**
 * The generated statement itself. Split out of generateStatement() so a
 * language change can redraw it from the data already in memory instead of
 * re-querying the database (and so the selection is never lost).
 */
function renderStatementResult(data) {
    const container = document.getElementById('statementResult');
    if (!container || !data) return;

    const cols = statementVisibleColumns(data);
    const colCount = cols.length;
    const rows = data.entries.map((e, i) => {
        const page = STATEMENT_MODULE_PAGES[String(e.reference_type || '').toLowerCase()] || '';
        const detailId = `stDetail${i}`;
        const cells = statementQtyCells(e);
        // A bill with several products is shown as one line per product under
        // the same reference. Its debit/credit/running balance appear on the
        // first line only — the bill total is never duplicated.
        const lines = statementDisplayLines(e);
        const group = lines.length ? lines : [null];
        return group.map((line, idx) => {
            const first = idx === 0;
            const body = cols.map(c => statementCellHtml(c.key, e, line, first, cells, {})).join('');
            const detail = idx === group.length - 1 ? `
        <tr id="${detailId}" style="display:none">
            <td colspan="${colCount}" style="background:#f8fafc;padding:10px 14px;font-size:12px;border-bottom:1px solid var(--border)">
                <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:center">
                    <span><strong>${rl('Accounting date', 'हिसाब मिति')}:</strong> ${formatDate(e.accounting_date || e.date)}</span>
                    <span><strong>${rl('Transaction date', 'कारोबार मिति')}:</strong> ${formatDate(e.date)}</span>
                    <span><strong>${rlt('reference')}:</strong> ${escapeHtml(e.reference_no || '—')}</span>
                    <span><strong>${rl('Source module', 'स्रोत मोड्युल')}:</strong> ${escapeHtml(e.source_module || statementModuleName(e.reference_type))}</span>
                    <span><strong>${rl('Record ID', 'रेकर्ड आईडी')}:</strong> ${e.source_id ?? e.reference_id ?? '—'}</span>
                    <span><strong>${rlt('amount')}:</strong> ${e.debit > 0 ? formatCurrency(e.debit) : (e.credit > 0 ? formatCurrency(e.credit) : '—')}</span>
                    <span><strong>${rlt('balance')}:</strong> ${formatCurrency(e.running_balance)}</span>
                    ${e.milk_type ? `<span><strong>${rl('Milk', 'दूध')}:</strong> ${escapeHtml(e.milk_type)} · ${e.milk_quantity} L · ${e.milk_rate}/${rl('L', 'लि')}</span>` : ''}
                    ${page ? `<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();navigateTo('${page}')">↗ ${rl('Open the record', 'रेकर्ड खोल्नुहोस्')}</button>` : ''}
                </div>
                ${statementItemsList(e)}
                ${e.qty_unreconciled ? `<div style="margin-top:6px;color:${ST_NOTE}">${escapeHtml(rl('No milk collection line is linked to this purchase row, so Milk Type and Quantity are not shown. The amount above is as recorded and is included in the totals.', 'यो खरिद लाइनसँग कुनै दूध सङ्कलन लाइन जोडिएको छैन, त्यसैले दूधको प्रकार र परिमाण देखाइएको छैन। माथिको रकम यथावत् छ र जम्मामा समावेश छ।'))}</div>` : ''}
            </td>
        </tr>` : '';
            return `
        <tr style="${e.is_pdc ? 'background:#fbfcfe' : ''}" class="mr-line"
            onclick="statementToggleDetail(${i})"
            title="${escapeHtml(rl('Click to open this line\u2019s details', 'यो लाइनको विवरण हेर्न क्लिक गर्नुहोस्'))}">
            ${body}
        </tr>${detail}`;
        }).join('');
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
                <button class="btn btn-secondary btn-sm" onclick="statementColumnsPanelToggle()">⚙ ${rl('Column Settings', 'स्तम्भ सेटिङ')}</button>
                <span style="font-size:12px;color:var(--text-light);margin-left:8px">
                    ${rl('Click any line to see its source record.', 'स्रोत रेकर्ड हेर्न कुनै पनि लाइनमा क्लिक गर्नुहोस्।')}
                </span>
            </div>
        </div>
        ${statementColumnsPanelHtml(data)}
        <style>
            /* Keep every figure on one line so a narrow screen scrolls rather
               than breaking a currency symbol away from its amount. */
            #statementResult .stmt-table-screen { font-size: 12px; }
            #statementResult .stmt-table-screen th,
            #statementResult .stmt-table-screen td { white-space: nowrap; }
            #statementResult .stmt-table-screen td.particulars { white-space: normal; min-width: 180px; }
            #statementResult .stmt-note { margin: 8px 2px 0; font-size: 11.5px; line-height: 1.45; color: #8a5a00; }
        </style>
        <div class="table-container">
            <table class="stmt-table-screen">
                <thead>
                    <tr>${cols.map(c => {
                        const cls = [c.right ? 'text-right' : '', c.particulars ? 'particulars' : ''].filter(Boolean).join(' ');
                        return `<th${cls ? ` class="${cls}"` : ''}>${c.label()}</th>`;
                    }).join('')}</tr>
                </thead>
                <tbody>
                    ${statementOpeningRowHtml(cols, data)}
                    ${rows}
                    ${data.entries.length === 0 ? `<tr><td colspan="${colCount}" style="text-align:center;padding:30px;color:var(--text-light)">${rl('No transactions match this period and filter', 'यो अवधि र फिल्टरमा कुनै लेनदेन छैन')}</td></tr>` : ''}
                </tbody>
                <tfoot>
                    ${statementTotalRowHtml(cols, data)}
                </tfoot>
            </table>
        </div>
        ${statementUnreconciledNote(data)}
        ${statementItemQtySummaryHtml(data)}
        ${statementQtySummaryHtml(data)}
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
/**
 * Print / PDF layout for the CURRENT column settings. The same visible columns
 * are used on screen, in the printed page and in the PDF; a compact layout can
 * be chosen by the user or is applied automatically when many columns are on.
 */
function statementPrintLayout(data) {
    const cols = statementVisibleColumns(data);
    const state = statementColumnState(data);
    return {
        cols,
        compact: state.compact || cols.length > 11,
        landscape: cols.length > 8
    };
}

function statementColgroup(cols) {
    return `<colgroup>${cols.map(c => `<col style="width:${c.width}">`).join('')}</colgroup>`;
}

function statementTableHead(cols) {
    return `<thead><tr>${cols.map(c => {
        const cls = [c.right ? 'num' : '', c.particulars ? 'particulars' : ''].filter(Boolean).join(' ');
        const label = c.money ? `${c.label()} (Rs)` : c.label();
        return `<th${cls ? ` class="${cls}"` : ''}>${label}</th>`;
    }).join('')}</tr></thead>`;
}

/** Every item of every row on its own printed line (amounts stay on row start). */
function statementPrintRows(data, cols) {
    let html = '';
    for (const e of data.entries) {
        const cells = statementQtyCells(e);
        const lines = statementDisplayLines(e);
        const group = lines.length ? lines : [null];
        group.forEach((line, idx) => {
            html += '<tr>' + cols.map(c => statementCellHtml(c.key, e, line, idx === 0, cells, { print: true })).join('') + '</tr>';
        });
    }
    return html;
}

/**
 * Amount for the printed table. The currency is named once in the column
 * header ("Debit (Rs)") rather than repeated in every cell, so a seven-figure
 * amount still fits its column and never spills into the next one.
 */
function stmtMoney(v) {
    const n = Number(v) || 0;
    const s = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? '-' + s : s;
}

/**
 * The printable / PDF statement body. ONE builder feeds Print, Export PDF and
 * the emailed statement, so the three can never disagree.
 */
function buildStatementHtml(data, settings, layout) {
    const closingLabel = data.closing_balance >= 0 ? 'Dr' : 'Cr';
    const filterText = statementFilterText(data);
    const lay = layout || statementPrintLayout(data);
    const cols = lay.cols;
    const rows = statementPrintRows(data, cols);
    const compactClass = lay.compact ? ' stmt-compact' : '';

    return `
        <style>
            @page { size: A4 ${lay.landscape ? 'landscape' : 'portrait'}; margin: 10mm 8mm 14mm 8mm; }
            body { font-size: 8.5pt; }
            table.stmt-table { table-layout: fixed; width: 100%; font-size: 7pt; }
            table.stmt-table th { font-size: 6.4pt; line-height: 1.25; letter-spacing: 0; padding: 3px 3px; white-space: normal; overflow-wrap: normal; word-break: normal; }
            table.stmt-table td { padding: 2.5px 3px; white-space: nowrap; }
            table.stmt-table td.particulars, table.stmt-table td.wrap { white-space: normal; overflow-wrap: anywhere; }
            table.stmt-table th.num, table.stmt-table td.num { text-align: right; font-family: 'Consolas','Courier New',monospace; }
            table.stmt-table tr { page-break-inside: avoid; }
            table.stmt-table thead { display: table-header-group; }
            table.stmt-table.stmt-compact { font-size: 6pt; }
            table.stmt-table.stmt-compact th { font-size: 5.6pt; }
            table.stmt-table.stmt-compact td { padding: 1.8px 2px; }
            table.stmt-qty-summary, table.stmt-item-summary { width: 62%; margin-left: auto; margin-right: 0; table-layout: fixed; }
            table.stmt-qty-summary th, table.stmt-qty-summary td,
            table.stmt-item-summary th, table.stmt-item-summary td { padding: 3px 6px; }
            .filters-line { margin: 2px 0 10px; font-size: 8pt; color: #444; text-align: center; }
            .stmt-note { margin: 5px 1px 0; font-size: 6.8pt; line-height: 1.35; color: #8a5a00; }
            .value-cards { grid-template-columns: repeat(5, 1fr); }
            .value-card .value-number { font-size: 11.5pt; }
        </style>
        <div class="header">
            <h1>${escapeHtml(settings.business_name || 'Prarambha Account & Stock Management')}</h1>
            <h2>${escapeHtml(data.party.name)} — ${rl('Statement of Account', 'खाताको विवरण')}</h2>
            <p>
                ${rl('Party Type', 'पार्टी प्रकार')}: ${escapeHtml(data.party.type || '')}
                ${data.party.phone ? ' | ☎ ' + escapeHtml(data.party.phone) : ''}
                ${data.party.address ? ' | ' + escapeHtml(data.party.address) : ''}
            </p>
            <p><strong>${rlt('period')}: ${data.from_date} → ${data.to_date}</strong></p>
            ${filterText ? `<p class="filters-line">${rl('Filters', 'फिल्टर')}: ${escapeHtml(filterText)}</p>` : ''}
        </div>
        <div class="value-cards">
            <div class="value-card"><div class="value-label">${rlt('opening_balance')}</div><div class="value-number">${formatCurrency(data.opening_balance)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Total Debit', 'कुल डेबिट')}</div><div class="value-number">${formatCurrency(data.total_debit)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Total Credit', 'कुल क्रेडिट')}</div><div class="value-number">${formatCurrency(data.total_credit)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Purchase Qty', 'खरिद परिमाण')}</div><div class="value-number">${stQtyMapText(data.qty_summary && data.qty_summary.purchase.by_unit)}</div></div>
            <div class="value-card"><div class="value-label">${rl('Sales Qty', 'बिक्री परिमाण')}</div><div class="value-number">${stQtyMapText(data.qty_summary && data.qty_summary.sales.by_unit)}</div></div>
        </div>
        ${data.pdc && (data.pdc.received_held || data.pdc.issued_held) ? `
        <div class="notes-section">
            ${rl('Post-dated cheques not yet cleared (NOT included in the closing balance)', 'अझै नसोधिएका ताकेता चेक (अन्तिम मौज्दातमा समावेश छैन)')}:
            ${data.pdc.received_held ? ` ${rl('Received', 'प्राप्त')} ${formatCurrency(data.pdc.received_held)} (${data.pdc.received_held_count});` : ''}
            ${data.pdc.issued_held ? ` ${rl('Issued', 'जारी')} ${formatCurrency(data.pdc.issued_held)} (${data.pdc.issued_held_count});` : ''}
        </div>` : ''}
        <table class="stmt-table${compactClass}">
            ${statementColgroup(cols)}
            ${statementTableHead(cols)}
            <tbody>
                ${statementOpeningRowHtml(cols, data, { print: true })}
                ${rows || `<tr><td colspan="${cols.length}" style="text-align:center;padding:14px;color:#777">${rl('No transactions match this period and filter', 'यो अवधि र फिल्टरमा कुनै लेनदेन छैन')}</td></tr>`}
                ${statementTotalRowHtml(cols, data, { print: true })}
            </tbody>
        </table>
        ${statementUnreconciledNote(data)}
        <div class="summary no-break">
            <div class="summary-row total"><span>${rlt('closing_balance')}</span><span>${formatCurrency(data.closing_balance)} ${closingLabel}</span></div>
        </div>
        ${statementItemQtySummaryHtml(data)}
        ${statementQtySummaryHtml(data)}
        <div class="footer">
            <div>${rl('Generated', 'बनाइएको मिति')}: ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN')}</div>
            <div class="signature">${rl('Authorized Signature', 'अधिकृत हस्ताक्षर')}</div>
        </div>
    `;
}

async function printStatement() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();
    const layout = statementPrintLayout(data);
    printHTML(buildStatementHtml(data, settings, layout), {
        orientation: layout.landscape ? 'landscape' : 'portrait'
    });
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

/**
 * Export the CURRENT FILTERED statement as a real PDF, through Electron's
 * printToPDF — page numbers, repeated headers and the same totals as on screen.
 */
async function exportStatementPDF() {
    const data = window._lastStatement;
    if (!data) { showToast('Generate a statement first', 'warning'); return; }
    const settings = await getSettingsCached();

    const safe = (s) => String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 60);
    const filename = `Party_Statement_${safe(data.party.name)}_${data.from_date}_to_${data.to_date}.pdf`;
    const footerLeft = `${data.party.name} — ${rl('Statement of Account', 'खाताको विवरण')} (${data.from_date} → ${data.to_date})`;

    const result = await window.api.printToPDF({
        html: buildStatementHtml(data, settings, statementPrintLayout(data)),
        landscape: statementPrintLayout(data).landscape,
        pageSize: 'A4',
        filename,
        pageNumbers: true,
        footerLeft
    });
    if (result && result.success) {
        showToast('PDF saved' + (result.path && result.path !== 'printed' ? ': ' + result.path : ''), 'success');
    } else if (result && result.canceled) {
        showToast('PDF export cancelled', 'info');
    } else {
        showToast('PDF export failed: ' + ((result && result.error) || 'unknown error'), 'error');
    }
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
window.statementRefilter = statementRefilter;
window.printStatement = printStatement;
window.exportStatementPDF = exportStatementPDF;
window.statementColumnsPanelToggle = statementColumnsPanelToggle;
window.statementToggleColumn = statementToggleColumn;
window.statementShowAllColumns = statementShowAllColumns;
window.statementResetColumns = statementResetColumns;
window.statementToggleCompactPrint = statementToggleCompactPrint;
window.buildStatementHtml = buildStatementHtml;
window.statementPrintLayout = statementPrintLayout;
window.statementVisibleColumns = statementVisibleColumns;
window.STATEMENT_COLUMN_DEFS = STATEMENT_COLUMN_DEFS;
window.STATEMENT_DEFAULT_COLUMNS = STATEMENT_DEFAULT_COLUMNS;
