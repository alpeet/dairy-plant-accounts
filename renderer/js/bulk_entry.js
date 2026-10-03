/**
 * Daily Bulk Entry (Mode B) — date-wise grid entry
 * =================================================
 * One screen, one date, many rows, ONE save. Every saved row reuses the
 * SAME backend functions as one-by-one entry and Excel import
 * (saveMilkCollection / savePurchase / saveSale) — no second data model.
 *
 * Keyboard: Enter moves down the current column, Tab moves right.
 * Paste multi-row TSV/CSV straight from a spreadsheet.
 */

let bulk = {
    module: 'milk',          // 'milk' | 'purchases' | 'sales'
    date: '',
    shift: 'morning',
    routeId: '',
    rows: []                 // in-memory row objects
};

function _bulkBlankRow(mod) {
    if (mod === 'milk') return { party_name: '', party_id: '', milk_type: 'cow', quantity: '', fat_percent: '', snf_percent: '', rate: '', rate_override_reason: '' };
    if (mod === 'purchases') return { party_name: '', party_id: '', product_name: '', product_id: '', quantity: '', rate: '', bill_no: '', payment_mode: 'credit' };
    return { party_name: '', party_id: '', product_name: '', product_id: '', quantity: '', rate: '', invoice_no: '', payment_mode: 'credit' };
}

function _bulkRowCells(mod, r) {
    if (mod === 'milk') {
        return `
            <td><input class="form-control be-input" data-f="party_name" value="${escapeHtml(r.party_name)}" placeholder="Farmer name" list="bePartyList" autocomplete="off"></td>
            <td><select class="form-control be-input" data-f="milk_type">
                <option value="cow" ${r.milk_type === 'cow' ? 'selected' : ''}>Cow</option>
                <option value="buffalo" ${r.milk_type === 'buffalo' ? 'selected' : ''}>Buffalo</option>
            </select></td>
            <td><input class="form-control be-input be-num" data-f="quantity" value="${escapeHtml(String(r.quantity))}" inputmode="decimal" placeholder="0"></td>
            <td><input class="form-control be-input be-num" data-f="fat_percent" value="${escapeHtml(String(r.fat_percent))}" inputmode="decimal" placeholder="0.0"></td>
            <td><input class="form-control be-input be-num" data-f="snf_percent" value="${escapeHtml(String(r.snf_percent))}" inputmode="decimal" placeholder="0.0"></td>
            <td><input class="form-control be-input be-num" data-f="rate" value="${escapeHtml(String(r.rate))}" inputmode="decimal" placeholder="auto" title="Leave blank — the supplier's own rate is applied automatically"></td>
            <td><input class="form-control be-input" data-f="rate_override_reason" value="${escapeHtml(String(r.rate_override_reason || ''))}" placeholder="required only if Rate ≠ calculated"></td>
            <td class="text-right be-amount">—</td>`;
    }
    const productCol = `
        <td><input class="form-control be-input" data-f="product_name" value="${escapeHtml(r.product_name)}" placeholder="Product" list="beProductList" autocomplete="off"></td>`;
    const docCol = mod === 'purchases'
        ? `<td><input class="form-control be-input" data-f="bill_no" value="${escapeHtml(r.bill_no)}" placeholder="auto"></td>`
        : `<td><input class="form-control be-input" data-f="invoice_no" value="${escapeHtml(r.invoice_no)}" placeholder="auto"></td>`;
    return `
            <td><input class="form-control be-input" data-f="party_name" value="${escapeHtml(r.party_name)}" placeholder="${mod === 'purchases' ? 'Supplier' : 'Customer'}" list="bePartyList" autocomplete="off"></td>
            ${productCol}
            <td><input class="form-control be-input be-num" data-f="quantity" value="${escapeHtml(String(r.quantity))}" inputmode="decimal" placeholder="0"></td>
            <td><input class="form-control be-input be-num" data-f="rate" value="${escapeHtml(String(r.rate))}" inputmode="decimal" placeholder="0"></td>
            ${docCol}
            <td><select class="form-control be-input" data-f="payment_mode">
                <option value="credit" ${r.payment_mode !== 'cash' ? 'selected' : ''}>Credit</option>
                <option value="cash" ${r.payment_mode === 'cash' ? 'selected' : ''}>Cash</option>
            </select></td>
            <td class="text-right be-amount">—</td>`;
}

function _bulkHeaders(mod) {
    if (mod === 'milk') {
        return '<th style="min-width:170px">Farmer</th><th>Type</th><th>Qty (L)</th><th>FAT</th><th>SNF</th><th>Rate</th><th style="min-width:160px">Override Reason</th><th class="text-right">Amount</th>';
    }
    if (mod === 'purchases') return '<th style="min-width:170px">Supplier</th><th>Product</th><th>Qty</th><th>Rate</th><th>Bill No</th><th>Mode</th><th class="text-right">Amount</th>';
    return '<th style="min-width:170px">Customer</th><th>Product</th><th>Qty</th><th>Rate</th><th>Invoice No</th><th>Mode</th><th class="text-right">Amount</th>';
}

function _bulkEstimate(mod, r) {
    const qty = parseFloat(r.quantity) || 0;
    let rate = parseFloat(r.rate) || 0;
    if (mod === 'milk' && !(rate > 0)) rate = window._bulkCalcRate ? window._bulkCalcRate(r.fat_percent, r.snf_percent, r.party_id, r.milk_type) : 0;
    return qty > 0 ? qty * rate : 0;
}

function _refreshBulkTotals() {
    const mod = bulk.module;
    document.querySelectorAll('#beGridBody tr').forEach((tr, i) => {
        const r = bulk.rows[i];
        if (!r) return;
        const amt = _bulkEstimate(mod, r);
        const cell = tr.querySelector('.be-amount');
        if (cell) cell.textContent = amt > 0 ? formatCurrency(amt) : '—';
    });
    const rows = bulk.rows;
    const totalQty = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0);
    const totalAmt = rows.reduce((s, r) => s + _bulkEstimate(mod, r), 0);
    const fatRows = mod === 'milk' ? rows.filter(r => (parseFloat(r.quantity) || 0) > 0 && (parseFloat(r.fat_percent) || 0) > 0) : [];
    const avgFat = mod === 'milk' && fatRows.length
        ? fatRows.reduce((s, r) => s + (parseFloat(r.fat_percent) || 0) * (parseFloat(r.quantity) || 0), 0) / fatRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0)
        : 0;
    const snfRows = mod === 'milk' ? rows.filter(r => (parseFloat(r.quantity) || 0) > 0 && (parseFloat(r.snf_percent) || 0) > 0) : [];
    const avgSnf = mod === 'milk' && snfRows.length
        ? snfRows.reduce((s, r) => s + (parseFloat(r.snf_percent) || 0) * (parseFloat(r.quantity) || 0), 0) / snfRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0), 0)
        : 0;
    const t = document.getElementById('beTotals');
    if (t) {
        t.innerHTML = mod === 'milk'
            ? `<strong>${rows.length}</strong> rows · Total <strong>${formatNumber(totalQty)} L</strong> · Avg FAT <strong>${avgFat ? avgFat.toFixed(2) : '—'}</strong> · Avg SNF <strong>${avgSnf ? avgSnf.toFixed(2) : '—'}</strong> · Total <strong>${formatCurrency(totalAmt)}</strong>`
            : `<strong>${rows.length}</strong> rows · Total <strong>${formatCurrency(totalAmt)}</strong>`;
    }
}

function _rebindGrid() {
    const body = document.getElementById('beGridBody');
    if (!body) return;
    body.oninput = (e) => {
        const el = e.target;
        if (!el.dataset || !el.dataset.f) return;
        const tr = el.closest('tr');
        const idx = Array.prototype.indexOf.call(body.children, tr);
        if (!bulk.rows[idx]) return;
        bulk.rows[idx][el.dataset.f] = el.value;
        if (el.dataset.f === 'party_name' && window._bulkPartyCache) {
            const hit = window._bulkPartyCache.find(p => p.name.toLowerCase() === el.value.trim().toLowerCase());
            if (hit) {
                bulk.rows[idx].party_id = hit.id;
                if (window._bulkPrefetchRate) window._bulkPrefetchRate(hit.id, bulk.rows[idx].milk_type);
            }
        }
        if (el.dataset.f === 'milk_type' && bulk.rows[idx].party_id && window._bulkPrefetchRate) {
            window._bulkPrefetchRate(bulk.rows[idx].party_id, el.value);
        }
        if (el.dataset.f === 'product_name' && window._bulkProductCache) {
            const hit = window._bulkProductCache.find(p => p.name.toLowerCase() === el.value.trim().toLowerCase());
            if (hit) bulk.rows[idx].product_id = hit.id;
        }
        _refreshBulkTotals();
    };
    // Enter → move down within the same column; Tab default; arrows up/down
    body.onkeydown = (e) => {
        const el = e.target;
        if (!el.classList || !el.classList.contains('be-input')) return;
        const tr = el.closest('tr');
        const idx = Array.prototype.indexOf.call(body.children, tr);
        const moveFocus = (nextIdx) => {
            const nextTr = body.children[nextIdx];
            if (!nextTr) return;
            const next = nextTr.querySelector(`[data-f="${el.dataset.f}"]`);
            if (next) { next.focus(); if (next.select && el.classList.contains('be-num')) next.select(); }
        };
        if (e.key === 'Enter') { e.preventDefault(); moveFocus(idx + 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(idx + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(Math.max(0, idx - 1)); }
    };
    // Multi-row paste (TSV or CSV), starting at the pasted cell
    body.onpaste = (e) => {
        const el = e.target;
        if (!el.classList || !el.classList.contains('be-input')) return;
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text || !/\n|\t|,/.test(text.trim())) return;
        e.preventDefault();
        const tr = el.closest('tr');
        const startRow = Array.prototype.indexOf.call(body.children, tr);
        const fields = _bulkFieldOrder(bulk.module);
        const startCol = fields.indexOf(el.dataset.f);
        const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '');
        const parsed = lines.map(line => line.includes('\t') ? line.split('\t') : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
        parsed.forEach((cells, rOff) => {
            const idx = startRow + rOff;
            while (bulk.rows.length <= idx) bulk.rows.push(_bulkBlankRow(bulk.module));
            cells.forEach((c, cOff) => {
                const f = fields[startCol + cOff];
                if (f) bulk.rows[idx][f] = c.replace(/^"|"$/g, '').trim();
            });
        });
        renderBulkGrid();
    };
}

function _bulkFieldOrder(mod) {
    if (mod === 'milk') return ['party_name', 'milk_type', 'quantity', 'fat_percent', 'snf_percent', 'rate', 'rate_override_reason'];
    if (mod === 'purchases') return ['party_name', 'product_name', 'quantity', 'rate', 'bill_no', 'payment_mode'];
    return ['party_name', 'product_name', 'quantity', 'rate', 'invoice_no', 'payment_mode'];
}

function renderBulkGrid() {
    const body = document.getElementById('beGridBody');
    if (!body) return;
    body.innerHTML = bulk.rows.map(r => `
        <tr>
            ${_bulkRowCells(bulk.module, r)}
            <td class="actions" style="white-space:nowrap">
                <button class="btn btn-secondary btn-sm" onclick="bulkDuplicateRow(this)" title="Duplicate">⧉</button>
                <button class="btn btn-danger btn-sm" onclick="bulkDeleteRow(this)" title="Delete">✕</button>
            </td>
        </tr>`).join('');
    _rebindGrid();
    _refreshBulkTotals();
}

async function renderBulkEntry() {
    const container = document.getElementById('page-bulk-entry');
    container.innerHTML = '<div class="loading" style="text-align:center;padding:40px">Loading bulk entry…</div>';

    document.getElementById('topActions').innerHTML = `
        <button class="btn btn-success btn-sm" onclick="bulkAddRows(5)">+ Add 5 Rows</button>
        <button class="btn btn-info btn-sm" onclick="bulkLoadExisting()">📂 Load Date</button>
        <button class="btn btn-primary btn-sm" onclick="bulkSaveAll()">💾 SAVE ALL</button>
    `;

    const [partiesR, productsR, routesR, ratesR] = await Promise.all([
        window.api.getParties({}),
        window.api.getProducts({}),
        window.api.getRoutes ? window.api.getRoutes({}) : Promise.resolve({ success: true, data: [] }),
        window.api.getEffectiveRate ? window.api.getEffectiveRate(bulk.date || today()) : Promise.resolve(null)
    ]);
    const parties = partiesR.success ? partiesR.data : [];
    const products = productsR.success ? productsR.data : [];
    const routes = routesR && routesR.success ? (routesR.data || []) : [];
    window._bulkPartyCache = parties;
    window._bulkProductCache = products;
    const chart = ratesR && ratesR.success !== false ? (ratesR.data || ratesR) : null;
    window._bulkPlantChart = chart;
    window._bulkRateCharts = new Map();   // `${partyId}|${milkType}` → that supplier's chart
    // Preview rate: supplier chart when we have it, plant chart otherwise. The
    // SAVE always re-resolves server-side, so this can only mirror, never decide.
    window._bulkCalcRate = (fat, snf, partyId, milkType) => {
        const key = `${partyId || ''}|${milkType || ''}`;
        const c = (partyId && window._bulkRateCharts.get(key)) || window._bulkPlantChart;
        if (!c) return 0;
        const f = parseFloat(fat) || 0, s = parseFloat(snf) || 0;
        if (c.rate_type === 'fixed') return parseFloat(c.fixed_rate) || 0;
        return (f * (parseFloat(c.fat_multiplier) || 7.15)) + (s * (parseFloat(c.snf_multiplier) || 4.55)) + (parseFloat(c.extra_per_unit) || 0);
    };
    window._bulkPrefetchRate = (partyId, milkType) => {
        if (!partyId || !window.api.resolveMilkRate) return;
        const key = `${partyId}|${milkType || ''}`;
        if (window._bulkRateCharts.has(key)) return;
        window.api.resolveMilkRate({ date: bulk.date || today(), party_id: Number(partyId), milk_type: milkType || '', fat: 4, snf: 8.5 })
            .then(rr => {
                if (rr && rr.success && rr.data && rr.data.chart) {
                    window._bulkRateCharts.set(key, rr.data.chart);
                    _refreshBulkTotals();
                }
            }).catch(() => { /* preview stays on the plant chart */ });
    };

    if (!bulk.date) bulk.date = today();

    container.innerHTML = `
        <div class="card" style="margin-bottom:16px">
            <div class="filter-bar">
                <div class="form-group">
                    <label>Module</label>
                    <select class="form-control" id="beModule">
                        <option value="milk" ${bulk.module === 'milk' ? 'selected' : ''}>🥛 Milk Collection</option>
                        <option value="purchases" ${bulk.module === 'purchases' ? 'selected' : ''}>🛒 Purchases</option>
                        <option value="sales" ${bulk.module === 'sales' ? 'selected' : ''}>💰 Sales</option>
                    </select>
                </div>
                <div class="form-group"><label>Date *</label><input type="date" class="form-control" id="beDate" value="${bulk.date}"></div>
                <div class="form-group" id="beShiftWrap" style="display:${bulk.module === 'milk' ? 'block' : 'none'}">
                    <label>Shift</label>
                    <select class="form-control" id="beShift">
                        <option value="morning" ${bulk.shift !== 'evening' ? 'selected' : ''}>Morning</option>
                        <option value="evening" ${bulk.shift === 'evening' ? 'selected' : ''}>Evening</option>
                    </select>
                </div>
                <div class="form-group" id="beRouteWrap" style="display:${bulk.module === 'milk' ? 'block' : 'none'}">
                    <label>Route / Centre</label>
                    <select class="form-control" id="beRoute"><option value="">—</option>
                        ${routes.map(rt => `<option value="${rt.id}" ${String(bulk.routeId) === String(rt.id) ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label>&nbsp;</label>
                    <button class="btn btn-primary btn-sm" onclick="bulkApplySettings()">Apply</button>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header"><h2 id="beGridTitle">Date-wise Bulk Entry</h2></div>
            <div class="table-container" style="overflow-x:auto">
                <table>
                    <thead><tr id="beGridHead"></tr></thead>
                    <tbody id="beGridBody"></tbody>
                </table>
            </div>
            <div style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
                <div>
                    <button class="btn btn-secondary btn-sm" onclick="bulkAddRows(1)">+ Row</button>
                    <button class="btn btn-secondary btn-sm" onclick="bulkAddRows(5)">+ 5 Rows</button>
                    <span style="font-size:12px;color:var(--text-light);margin-left:10px">Tip: paste spreadsheet rows directly into a cell · Enter = next row</span>
                </div>
                <div id="beTotals" style="font-size:14px"></div>
            </div>
            <div id="beErrors" style="padding:0 14px 10px"></div>
        </div>
        <datalist id="bePartyList">${parties.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>
        <datalist id="beProductList">${products.map(p => `<option value="${escapeHtml(p.name)}">`).join('')}</datalist>
    `;

    bulkApplySettings(true);
}

function bulkApplySettings(keepRows = false) {
    bulk.module = document.getElementById('beModule')?.value || 'milk';
    bulk.date = document.getElementById('beDate')?.value || bulk.date;
    bulk.shift = document.getElementById('beShift')?.value || 'morning';
    bulk.routeId = document.getElementById('beRoute')?.value || '';
    const shiftWrap = document.getElementById('beShiftWrap');
    const routeWrap = document.getElementById('beRouteWrap');
    if (shiftWrap) shiftWrap.style.display = bulk.module === 'milk' ? 'block' : 'none';
    if (routeWrap) routeWrap.style.display = bulk.module === 'milk' ? 'block' : 'none';
    const title = document.getElementById('beGridTitle');
    if (title) title.textContent = `Bulk ${bulk.module === 'milk' ? 'Milk Collection' : bulk.module === 'purchases' ? 'Purchases' : 'Sales'} — ${formatDate(bulk.date || today())}`;
    const head = document.getElementById('beGridHead');
    if (head) head.innerHTML = _bulkHeaders(bulk.module) + '<th class="actions">Actions</th>';
    if (!keepRows || !bulk.rows.length) {
        bulk.rows = Array.from({ length: 5 }, () => _bulkBlankRow(bulk.module));
    }
    renderBulkGrid();
}

function bulkAddRows(n) {
    for (let i = 0; i < n; i++) bulk.rows.push(_bulkBlankRow(bulk.module));
    renderBulkGrid();
    // Focus first cell of the first new row
    const body = document.getElementById('beGridBody');
    if (body && body.children[bulk.rows.length - n]) {
        const first = body.children[bulk.rows.length - n].querySelector('.be-input');
        if (first) first.focus();
    }
}

function bulkDeleteRow(btn) {
    const tr = btn.closest('tr');
    const idx = Array.prototype.indexOf.call(document.getElementById('beGridBody').children, tr);
    bulk.rows.splice(idx, 1);
    if (!bulk.rows.length) bulk.rows = [_bulkBlankRow(bulk.module)];
    renderBulkGrid();
}

function bulkDuplicateRow(btn) {
    const tr = btn.closest('tr');
    const idx = Array.prototype.indexOf.call(document.getElementById('beGridBody').children, tr);
    const copy = { ...bulk.rows[idx] };
    if (bulk.module === 'milk') { copy.shift = bulk.shift; }
    copy.bill_no = ''; copy.invoice_no = '';
    bulk.rows.splice(idx + 1, 0, copy);
    renderBulkGrid();
}

async function bulkLoadExisting() {
    const date = document.getElementById('beDate')?.value || bulk.date;
    if (!date) { showToast('Pick a date first', 'warning'); return; }
    const shift = document.getElementById('beShift')?.value || '';
    let rows = [];
    if (bulk.module === 'milk') {
        const r = await window.api.loadBulkCollections({ date, shift: shift || undefined });
        if (r && r.success !== false) rows = (r.data || r) || [];
        bulk.rows = rows.map(c => ({ party_name: c.party_name || '', party_id: c.party_id, milk_type: c.milk_type || 'cow', quantity: c.quantity_liters, fat_percent: c.fat_percent, snf_percent: c.snf_percent, rate: c.rate, rate_override_reason: c.rate_override_reason || '', _id: c.id, _no: c.collection_no }));
    } else if (bulk.module === 'purchases') {
        const r = await window.api.loadBulkPurchases({ date });
        if (r && r.success !== false) rows = (r.data || r) || [];
        bulk.rows = rows.map(b => ({ party_name: b.party_name || '', party_id: b.party_id, product_name: b.product_name || '', product_id: b.product_id, quantity: b.quantity, rate: b.rate, bill_no: b.bill_no, payment_mode: b.payment_mode || 'credit', _id: b.id }));
    } else {
        const r = await window.api.loadBulkSales({ date });
        if (r && r.success !== false) rows = (r.data || r) || [];
        bulk.rows = rows.map(s => ({ party_name: s.party_name || '', party_id: s.party_id, product_name: s.product_name || '', product_id: s.product_id, quantity: s.quantity, rate: s.rate, invoice_no: s.invoice_no, payment_mode: s.payment_mode || 'credit', _id: s.id }));
    }
    if (!bulk.rows.length) { showToast('No existing records for that date', 'info'); return; }
    renderBulkGrid();
    showToast(`Loaded ${bulk.rows.length} existing record(s) — editing updates them, not duplicates`, 'info');
}

/** Client-side row validation mirroring the backend rules (spec §10). */
function bulkValidateRows() {
    const errors = [];
    const rows = bulk.rows.map((r, i) => ({ r, rowNo: i + 1 })).filter(x => {
        const r = x.r;
        return (r.party_name || '').trim() !== '' || (r.quantity || '') !== '' || (r.product_name || '').trim() !== '';
    });
    const problems = [];
    const seenMilk = new Set();
    rows.forEach(({ r, rowNo }) => {
        const name = (r.party_name || '').trim();
        if (!name) { problems.push({ row: rowNo, name: '', error: 'Name is required' }); return; }
        const party = (window._bulkPartyCache || []).find(p => p.name.toLowerCase() === name.toLowerCase());
        if (!party) { problems.push({ row: rowNo, name, error: 'Unknown party — pick from the list' }); return; }
        const qty = parseFloat(r.quantity);
        if (!(qty > 0)) { problems.push({ row: rowNo, name, error: 'Quantity must be greater than zero' }); return; }
        if (bulk.module === 'milk') {
            const key = `${name}|${bulk.shift}|${r.milk_type}`.toLowerCase();
            if (seenMilk.has(key)) { problems.push({ row: rowNo, name, error: `Duplicate: ${name} already has a ${bulk.shift} ${r.milk_type} row` }); return; }
            seenMilk.add(key);
        } else {
            const product = (window._bulkProductCache || []).find(p => p.name.toLowerCase() === (r.product_name || '').trim().toLowerCase());
            if (!product) { problems.push({ row: rowNo, name, error: 'Unknown product — pick from the list' }); return; }
            const rate = parseFloat(r.rate);
            if (!(rate > 0)) { problems.push({ row: rowNo, name, error: 'Rate must be greater than zero' }); return; }
        }
    });
    return { valid: rows.length - problems.length, invalid: problems.length, problems, rowCount: rows.length };
}

async function bulkSaveAll() {
    const date = document.getElementById('beDate')?.value || bulk.date;
    if (!date) { showToast('Date is required', 'error'); return; }
    bulk.date = date;

    // Drop fully-empty rows before validation
    bulk.rows = bulk.rows.filter(r => (r.party_name || '').trim() !== '' || (r.product_name || '').trim() !== '');

    const check = bulkValidateRows();
    const errBox = document.getElementById('beErrors');
    if (check.invalid > 0) {
        errBox.innerHTML = `
            <div style="margin:10px 0;padding:10px 14px;background:#fff3cd;border-radius:6px;font-size:13px">
                <strong>VALID ROWS: ${check.valid} · INVALID ROWS: ${check.invalid}</strong>
                <div style="margin-top:6px">${check.problems.map(p => `<div>⚠️ Row ${p.row}${p.name ? ` (${escapeHtml(p.name)})` : ''}: ${escapeHtml(p.error)}</div>`).join('')}</div>
            </div>`;
        showToast('Fix the highlighted rows before saving', 'error');
        return;
    }
    errBox.innerHTML = '';

    const payloadRows = bulk.rows.map(r => bulk.module === 'milk'
        ? { party_id: r.party_id || undefined, party_name: r.party_name, milk_type: r.milk_type, quantity_liters: parseFloat(r.quantity), fat_percent: parseFloat(r.fat_percent) || 0, snf_percent: parseFloat(r.snf_percent) || 0, rate: parseFloat(r.rate) || 0, rate_override_reason: String(r.rate_override_reason || '').trim() || undefined }
        : { party_id: r.party_id || undefined, party_name: r.party_name, product_id: r.product_id || undefined, product_name: r.product_name, quantity: parseFloat(r.quantity), rate: parseFloat(r.rate), bill_no: (r.bill_no || '').trim() || undefined, invoice_no: (r.invoice_no || '').trim() || undefined, payment_mode: r.payment_mode }
    );

    const btnBusy = 'Saving…';
    const saveBtn = document.querySelector('#topActions .btn-primary');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = btnBusy; }

    try {
        const result = bulk.module === 'milk'
            ? await window.api.saveBulkCollections({ date, shift: bulk.shift, route_id: bulk.routeId || undefined, rows: payloadRows })
            : bulk.module === 'purchases'
                ? await window.api.saveBulkPurchases({ date, rows: payloadRows })
                : await window.api.saveBulkSales({ date, rows: payloadRows });

        const d = result && result.success !== false ? (result.data || result) : null;
        if (!d) { showToast((result && result.error) || 'Bulk save failed', 'error'); return; }

        if (d.failed > 0) {
            errBox.innerHTML = `
                <div style="margin:10px 0;padding:10px 14px;background:#f8d7da;border-radius:6px;font-size:13px">
                    <strong>Added ${d.added || 0} · Updated ${d.updated || 0} · Failed ${d.failed}</strong>
                    <div style="margin-top:6px">${(d.errors || []).map(e => `<div>⚠️ Row ${e.row}${e.name ? ` (${escapeHtml(e.name)})` : ''}: ${escapeHtml(e.error)}</div>`).join('')}</div>
                </div>`;
            showToast(`${d.added + (d.updated || 0)} saved, ${d.failed} failed`, 'warning');
        } else {
            showToast(`✓ Saved ${d.added + (d.updated || 0)} records (${d.added} added, ${d.updated || 0} updated)`, 'success');
            bulk.rows = Array.from({ length: 5 }, () => _bulkBlankRow(bulk.module));
            renderBulkGrid();
        }
    } catch (e) {
        showToast(e.message || 'Bulk save failed', 'error');
        if (errBox) errBox.innerHTML = `<div style="margin:10px 0;padding:10px 14px;background:#f8d7da;border-radius:6px;font-size:13px"><strong>Rolled back:</strong> ${escapeHtml(e.message || String(e))}</div>`;
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 SAVE ALL'; }
    }
}

// Globals
window.renderBulkEntry = renderBulkEntry;
window.bulkApplySettings = bulkApplySettings;
window.bulkAddRows = bulkAddRows;
window.bulkDeleteRow = bulkDeleteRow;
window.bulkDuplicateRow = bulkDuplicateRow;
window.bulkLoadExisting = bulkLoadExisting;
window.bulkSaveAll = bulkSaveAll;
