/**
 * Management Reports — Expense Analysis, Board Report, Weekly/Monthly
 * ===================================================================
 * Spec Phases 11–16. Every figure comes from the existing authoritative
 * calculations (getProfitLoss, getMilkCostSummary, getExpenseSummary,
 * getAdvanceRecoveryRegister, getInventoryValuation) — this module classifies
 * and presents them for management, it never re-derives a different answer.
 *
 *   normalizeExpenseCategory()  ONE vocabulary across the five expense
 *                               registers (Phase 3 / audit row 3)
 *   getExpenseAnalysis()        where is the money going? (Phase 11)
 *   getBoardReport()            Board of Directors report with previous-period
 *                               comparison and factual indicators (12–13)
 *   getManagementReport()       daily / weekly / monthly management report
 *                               with balances and trends (14–16)
 *
 * Indicators are FACTUAL ONLY ("expense increased 18%", "salary = X% of
 * sales") — never "good"/"bad" judgements (Phase 13).
 *
 * READ-ONLY. Used by both Electron (main.js) and Web (server.js).
 */

const accounting = require('./accounting');
const { getProfitLoss, getProfitLossByMonth } = require('./financial_reports');
const { classifySaleName } = require('./company_ledger');
const { adToBS, bsToAD } = require('../excel-import');

const round2 = accounting.round2;

// ──────────────────────────────────────────────────────────────
// Phase 3 — one expense vocabulary
// ──────────────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = [
    'Milk procurement', 'Salary', 'Electricity', 'Fuel', 'Rent', 'Packaging',
    'Transport', 'Maintenance', 'Repairs', 'Office', 'Marketing',
    'Bank / finance', 'Production', 'Other'
];

/**
 * Map ANY expense description from ANY register onto the one management
 * vocabulary. Purely presentational — it changes no accounting total.
 *
 * @param {object|string} input - a row (category/expense_head/description/
 *        notes/payment_mode) or a bare string
 * @returns {string} one of EXPENSE_CATEGORIES
 */
function normalizeExpenseCategory(input) {
    const row = typeof input === 'string' ? { description: input } : (input || {});
    const explicit = String(row.category || '').trim();
    const text = [row.category, row.expense_head, row.description, row.notes,
                  row.particular, row.type, row.item_names]
        .filter(Boolean).join(' ').toLowerCase();
    if (!text.trim()) return 'Other';

    // Direct hits on the management vocabulary win first.
    const DIRECT = {
        'milk': 'Milk procurement', 'milk procurement': 'Milk procurement',
        'salary': 'Salary', 'salaries': 'Salary', 'wages': 'Salary',
        'electricity': 'Electricity', 'power': 'Electricity',
        'fuel': 'Fuel', 'diesel': 'Fuel', 'petrol': 'Fuel',
        'rent': 'Rent',
        'packaging': 'Packaging',
        'transport': 'Transport', 'freight': 'Transport',
        'maintenance': 'Maintenance',
        'repairs': 'Repairs', 'repair': 'Repairs',
        'office': 'Office',
        'marketing': 'Marketing',
        'bank': 'Bank / finance', 'bank charges': 'Bank / finance',
        'production': 'Production',
        'other': 'Other'
    };
    const lowerExplicit = explicit.toLowerCase();
    if (DIRECT[lowerExplicit]) return DIRECT[lowerExplicit];

    const rules = [
        [/milk|dairy|ghee|cream.*procure/, 'Milk procurement'],
        [/salary|salaries|wage|payroll|staff pay|\bstaff\b.*paid/, 'Salary'],
        [/electric|power bill|\benergy\b/, 'Electricity'],
        [/boiler|\bfuel\b|diesel|petrol|\blpg\b|\bgas\b/, 'Fuel'],
        [/rent|\blease\b/, 'Rent'],
        [/packag|packet|polyth|polybag|\bbag\b|bottle|carton|\bbox\b|\blabel\b|\bcrate\b/, 'Packaging'],
        [/transport|freight|deliver|logistic|toll|parking/, 'Transport'],
        [/repair/, 'Repairs'],
        [/maintenance|servicing|\bservice\b/, 'Maintenance'],
        [/office|stationery|stationery|station|telephone|internet|\bmobile\b|printing|\bpaper\b|refreshment|\btea\b/, 'Office'],
        [/market|advert|promotion|\bpromo\b/, 'Marketing'],
        [/bank charge|interest|commission|\bfee\b|\bfees\b|\btax\b|licence|license|insurance|audit/, 'Bank / finance'],
        [/production|processing|\bbatch\b/, 'Production'],
        [/\bvehicle\b|truck|tempo|route run/, 'Transport']
    ];
    for (const [re, cat] of rules) if (re.test(text)) return cat;
    return 'Other';
}

// ──────────────────────────────────────────────────────────────
// Date helpers (BS calendar — no AD assumptions in stored data)
// ──────────────────────────────────────────────────────────────

function _todayBS() {
    const ad = new Date().toISOString().split('T')[0];
    try { return adToBS(ad) || ad; } catch (e) { return ad; }
}

/** Shift a BS date by `n` days (negative allowed) via real AD arithmetic. */
function _bsShift(dateBS, n) {
    try {
        const ad = bsToAD(dateBS);
        if (!ad) return dateBS;
        const d = new Date(Date.parse(ad) + n * 86400000);
        return adToBS(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    } catch (e) { return dateBS; }
}

/** First day of the next BS month ('2083-07' → '2083-08', '2083-12' → '2084-01'). */
function _nextMonthStart(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    return m >= 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Last day of a BS month = (day before the next month's start). */
function _monthEnd(ym) { return _bsShift(_nextMonthStart(ym), -1); }

function _prevMonthRange(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const prevYm = m <= 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    return { from: `${prevYm}-01`, to: _monthEnd(prevYm) };
}

// ──────────────────────────────────────────────────────────────
// Phase 11 — Expense analysis rows (one classification, many groupings)
// ──────────────────────────────────────────────────────────────

/**
 * Normalised expense rows for a period, in BOTH directions:
 *   kind 'cogs'       milk procurement + non-milk purchases (P&L expenses)
 *   kind 'operating'  everything getExpenseSummary counts
 * The row sum always equals getProfitLoss().expenses.total_expenses.
 */
function _expenseRows(db, from, to) {
    const rows = [];
    const push = (r) => rows.push(Object.assign({
        date: '', amount: 0, kind: 'operating', category: 'Other',
        party: '', method: '', source: '', particular: ''
    }, r));

    // Milk procurement — the authoritative milk cost (counted once).
    const milk = accounting.getMilkCostSummary(db, { from_date: from, to_date: to });
    for (const c of db.prepare(`
        SELECT mc.date, mc.amount, pn.name AS party_name
          FROM milk_collections mc LEFT JOIN parties pn ON pn.id = mc.party_id
         WHERE mc.date >= ? AND mc.date <= ?`).all(from, to)) {
        push({
            date: c.date, amount: round2(c.amount), kind: 'cogs',
            category: 'Milk procurement', party: c.party_name || '',
            method: 'credit', source: 'milk_collections', particular: `Milk ${c.party_name || ''}`.trim()
        });
    }
    // Unlinked milk lines on purchase bills (the same once-only rule as the
    // P&L: a bill whose milk is already represented by a collection contributes
    // nothing here, whatever date that collection sits on).
    const milkItems = db.prepare(`
        SELECT p.id AS pid, p.date, p.bill_no, pn.name AS party_name, pi.product_name, pi.amount
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
          LEFT JOIN parties pn ON pn.id = p.party_id
         WHERE p.date >= ? AND p.date <= ?
           AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)`).all(from, to)
        .filter(r => accounting.detectMilkLine(r.product_name));
    for (const r of milkItems) {
        push({
            date: r.date, amount: round2(r.amount), kind: 'cogs',
            category: 'Milk procurement', party: r.party_name || '',
            method: 'credit', source: 'purchase_items', particular: `${r.product_name} (${r.bill_no})`
        });
    }
    void milk; // totals verified against it in the checks

    // Non-milk purchases → classified by their item names.
    const linkedByBill = accounting.getLinkedMilkByBill(db, { from_date: from, to_date: to });
    const unlinkedByBill = new Map();
    for (const r of milkItems) unlinkedByBill.set(r.pid, round2((unlinkedByBill.get(r.pid) || 0) + r.amount));
    const billItems = new Map();
    for (const r of db.prepare(`
        SELECT p.id AS pid, p.date, p.bill_no, pn.name AS party_name, pi.product_name, pi.amount
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
          LEFT JOIN parties pn ON pn.id = p.party_id
         WHERE p.date >= ? AND p.date <= ?`).all(from, to)) {
        const arr = billItems.get(r.pid) || { names: [], party: r.party_name || '', date: r.date, bill: r.bill_no };
        arr.names.push(r.product_name);
        billItems.set(r.pid, arr);
    }
    const bills = db.prepare(`
        SELECT p.id, p.date, p.bill_no, p.grand_total, pn.name AS party_name
          FROM purchases p LEFT JOIN parties pn ON pn.id = p.party_id
         WHERE p.date >= ? AND p.date <= ?`).all(from, to);
    for (const b of bills) {
        const value = round2((Number(b.grand_total) || 0) - (linkedByBill.get(b.id) || 0) - (unlinkedByBill.get(b.id) || 0));
        if (!(value > 0.005)) continue;
        const info = billItems.get(b.id) || { names: [], party: b.party_name || '' };
        push({
            date: b.date, amount: value, kind: 'cogs',
            category: normalizeExpenseCategory({ item_names: info.names.join(' ') }),
            party: b.party_name || '', method: 'credit', source: 'purchases',
            particular: `${b.bill_no} — ${info.names.join(', ')}`
        });
    }

    // Operating registers — same tables & filters as getExpenseSummary.
    for (const r of db.prepare(`
        SELECT id, date, category, expense_head, description, amount, paid_to, payment_mode, reference_no
          FROM other_expenses WHERE date >= ? AND date <= ? AND category != 'Income'`).all(from, to)) {
        push({
            date: r.date, amount: round2(r.amount), kind: 'operating',
            category: normalizeExpenseCategory(r), party: r.paid_to || '',
            method: r.payment_mode || '', source: 'other_expenses',
            particular: r.description || r.expense_head || ''
        });
    }
    for (const r of db.prepare(`
        SELECT id, voucher_no, date, expense_head, description, amount, paid_to, payment_mode
          FROM petty_cash WHERE date >= ? AND date <= ?`).all(from, to)) {
        push({
            date: r.date, amount: round2(r.amount), kind: 'operating',
            category: normalizeExpenseCategory(r), party: r.paid_to || '',
            method: r.payment_mode || '', source: 'petty_cash',
            particular: r.description || r.expense_head || r.voucher_no
        });
    }
    for (const r of db.prepare(`
        SELECT id, employee_name, month, net_salary, payment_date, payment_mode, remarks
          FROM salary_records WHERE payment_date >= ? AND payment_date <= ?`).all(from, to)) {
        push({
            date: r.payment_date, amount: round2(r.net_salary), kind: 'operating',
            category: 'Salary', party: r.employee_name || '',
            method: r.payment_mode || '', source: 'salary_records',
            particular: `Salary ${r.month}${r.remarks ? ' — ' + r.remarks : ''}`
        });
    }
    const VEHICLE_MAP = { fuel: 'Fuel', repair: 'Repairs', maintenance: 'Maintenance', toll_parking: 'Transport', other: 'Other' };
    for (const r of db.prepare(`
        SELECT id, date, vehicle_name, expense_type, total_amount, remarks
          FROM vehicle_expenses WHERE date >= ? AND date <= ?`).all(from, to)) {
        const cat = VEHICLE_MAP[String(r.expense_type || '').toLowerCase()] || normalizeExpenseCategory(r);
        push({
            date: r.date, amount: round2(r.total_amount), kind: 'operating',
            category: cat, party: r.vehicle_name || '',
            method: '', source: 'vehicle_expenses',
            particular: `${r.vehicle_name} — ${r.expense_type}${r.remarks ? ' — ' + r.remarks : ''}`
        });
    }
    const opEx = accounting.getExpenseSummary(db, { from_date: from, to_date: to });
    for (const r of (opEx.bank_expense_rows || [])) {
        push({
            date: r.date, amount: round2(r.amount), kind: 'operating',
            category: normalizeExpenseCategory(r), party: '',
            method: 'bank', source: 'bank_transactions', particular: r.description || 'Bank expense'
        });
    }
    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.notes, pm.mode, pm.transaction_type, pn.name AS party_name
          FROM payments pm LEFT JOIN parties pn ON pn.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND pm.transaction_type IN ('actual_expense', 'advance_adjustment')`).all(from, to)) {
        push({
            date: r.date, amount: round2(r.amount), kind: 'operating',
            category: normalizeExpenseCategory(r), party: r.party_name || '',
            method: r.mode || '', source: 'payments',
            particular: r.notes || r.transaction_type
        });
    }
    return rows;
}

/**
 * Expense Analysis (Phase 11): expenses grouped for management.
 *
 * @param {object} db
 * @param {object} opts - { from_date, to_date, group_by, compare_to? }
 *   group_by: 'category' (default) | 'date' | 'month' | 'party' | 'source'
 * @returns {object} { from_date, to_date, group_by, rows, total, sales,
 *                     split, previous, checks, all_checks_ok }
 */
function getExpenseAnalysis(db, opts = {}) {
    const from = opts.from_date || opts.from || _todayBS();
    const to = opts.to_date || opts.to || from;
    const groupBy = ['category', 'date', 'month', 'party', 'source'].includes(opts.group_by)
        ? opts.group_by : 'category';

    const rows = _expenseRows(db, from, to);
    const pnl = getProfitLoss(db, { from_date: from, to_date: to });
    const sales = round2(pnl.income.total_sales);

    const keyOf = (r) => {
        if (groupBy === 'date') return r.date;
        if (groupBy === 'month') return String(r.date || '').slice(0, 7);
        if (groupBy === 'party') return r.party || '(unallocated)';
        if (groupBy === 'source') return r.source;
        return r.category;
    };
    const groups = new Map();
    for (const r of rows) {
        const k = keyOf(r);
        if (!groups.has(k)) groups.set(k, { key: k, amount: 0, count: 0, operating: 0, cogs: 0 });
        const g = groups.get(k);
        g.amount = round2(g.amount + r.amount);
        g.count++;
        if (r.kind === 'operating') g.operating = round2(g.operating + r.amount);
        else g.cogs = round2(g.cogs + r.amount);
    }
    let outRows = [...groups.values()].map(g => ({
        ...g,
        percent_of_sales: sales > 0 ? round2((g.amount / sales) * 100) : 0
    })).sort((a, b) => b.amount - a.amount);

    // Previous period of equal length (for the "vs previous" column).
    let previous = null;
    if (opts.compare !== false) {
        const prevTo = _bsShift(from, -1);
        const prevFrom = _bsShift(prevTo, -Math.max(0, Math.round(_dayDiff(from, to))));
        const prevRows = _expenseRows(db, prevFrom, prevTo);
        const prevTotal = round2(prevRows.reduce((s, r) => s + r.amount, 0));
        const prevGroups = new Map();
        for (const r of prevRows) {
            const k = keyOf(r);
            prevGroups.set(k, round2((prevGroups.get(k) || 0) + r.amount));
        }
        outRows = outRows.map(r => {
            const prev = prevGroups.get(r.key);
            prevGroups.delete(r.key);
            return { ...r, previous: prev || 0, change: round2(r.amount - (prev || 0)) };
        });
        // Categories that existed only in the previous period.
        for (const [k, v] of prevGroups) {
            outRows.push({ key: k, amount: 0, count: 0, operating: 0, cogs: 0, previous: v, change: round2(-v), percent_of_sales: 0 });
        }
        previous = { from_date: prevFrom, to_date: prevTo, total: prevTotal };
    }

    const total = round2(rows.reduce((s, r) => s + r.amount, 0));
    const split = {
        milk_procurement: round2(rows.filter(r => r.category === 'Milk procurement').reduce((s, r) => s + r.amount, 0)),
        purchases: round2(rows.filter(r => r.kind === 'cogs' && r.category !== 'Milk procurement').reduce((s, r) => s + r.amount, 0)),
        operating: round2(rows.filter(r => r.kind === 'operating').reduce((s, r) => s + r.amount, 0))
    };

    const near = (a, b) => Math.abs(round2(a) - round2(b)) <= 0.01;
    const checks = [
        { name: 'Analysis total = P&L total expenses', expected: round2(pnl.expenses.total_expenses), actual: total, ok: near(total, pnl.expenses.total_expenses) },
        { name: 'Milk procurement = milk cost (counted once)', expected: round2(pnl.expenses.milk_collection.total), actual: split.milk_procurement, ok: near(split.milk_procurement, pnl.expenses.milk_collection.total) },
        { name: 'Purchases = non-milk purchases', expected: round2(pnl.expenses.purchases.total), actual: split.purchases, ok: near(split.purchases, pnl.expenses.purchases.total) },
        { name: 'Operating = expense summary', expected: round2(accounting.getExpenseSummary(db, { from_date: from, to_date: to }).total_operating_expenses), actual: split.operating, ok: near(split.operating, accounting.getExpenseSummary(db, { from_date: from, to_date: to }).total_operating_expenses) }
    ];

    return {
        from_date: from, to_date: to, group_by: groupBy,
        rows: outRows, total, sales, split, previous,
        checks, all_checks_ok: checks.every(c => c.ok)
    };
}

/** Signed day difference between two BS dates (b − a). */
function _dayDiff(a, b) {
    try {
        const x = bsToAD(a), y = bsToAD(b);
        if (!x || !y) return 0;
        return Math.round((Date.parse(y) - Date.parse(x)) / 86400000);
    } catch (e) { return 0; }
}

// ──────────────────────────────────────────────────────────────
// Phases 12–13 — Board Management Report
// ──────────────────────────────────────────────────────────────

/** Revenue split by product line — LINE level, so milk/cream/ghee/paneer sales
 *  are exact item amounts (the Company Ledger classifies whole invoices; a
 *  board revenue table must not put a mixed invoice into one bucket). */
function _revenueSplit(db, from, to) {
    const split = { 'Milk sales': 0, 'Cream sales': 0, 'Paneer sales': 0, 'Ghee sales': 0, 'Nauni sales': 0, 'Product sales': 0, 'Other sales': 0 };
    let total = 0;
    const items = db.prepare(`
        SELECT si.product_name, si.amount
          FROM sales_items si JOIN sales s ON s.id = si.sale_id
         WHERE s.date >= ? AND s.date <= ?`).all(from, to);
    for (const it of items) {
        const sub = classifySaleName(it.product_name);
        const amt = round2(Number(it.amount) || 0);
        split[sub] = round2((split[sub] || 0) + amt);
        total = round2(total + amt);
    }
    return { split, total };
}

/**
 * Board Management Report (Phase 12) with factual indicators (Phase 13).
 *
 * @param {object} db
 * @param {object} opts - { from_date, to_date, prev_from_date, prev_to_date }
 * @returns {object} { period, previous_period, revenue, cogs, gross_profit,
 *   operating_expenses:[{category, current, previous, change, percent_of_sales}],
 *   net, indicators:[{text, current, previous}], pnl, checks, all_checks_ok }
 */
function getBoardReport(db, opts = {}) {
    const from = opts.from_date || opts.from || _todayBS();
    const to = opts.to_date || opts.to || from;
    // Previous period: same length, immediately before `from` (unless given).
    const lengthDays = Math.max(0, _dayDiff(from, to));
    const prevTo = opts.prev_to_date || opts.prev_to || _bsShift(from, -1);
    const prevFrom = opts.prev_from_date || opts.prev_from || _bsShift(prevTo, -lengthDays);

    const cur = getProfitLoss(db, { from_date: from, to_date: to });
    const prev = getProfitLoss(db, { from_date: prevFrom, to_date: prevTo });

    const revSplit = _revenueSplit(db, from, to);
    const prevRevSplit = _revenueSplit(db, prevFrom, prevTo);

    // Operating expense table — current vs previous, % of sales.
    const curA = getExpenseAnalysis(db, { from_date: from, to_date: to, group_by: 'category', compare: false });
    const prevA = getExpenseAnalysis(db, { from_date: prevFrom, to_date: prevTo, group_by: 'category', compare: false });
    const prevMap = new Map(prevA.rows.filter(r => r.operating > 0).map(r => [r.key, r.operating]));
    const opex = curA.rows.filter(r => r.operating > 0)
        .map(r => ({
            category: r.key,
            current: r.operating,
            previous: prevMap.get(r.key) || 0,
            change: round2(r.operating - (prevMap.get(r.key) || 0)),
            percent_of_sales: r.percent_of_sales
        }))
        .sort((a, b) => b.current - a.current);
    // Previous-only categories.
    const curKeys = new Set(opex.map(r => r.category));
    for (const [k, v] of prevMap) {
        if (!curKeys.has(k)) opex.push({ category: k, current: 0, previous: v, change: round2(-v), percent_of_sales: 0 });
    }

    const opexTotal = round2(opex.reduce((s, r) => s + r.current, 0));
    const prevOpexTotal = round2(opex.reduce((s, r) => s + r.previous, 0));

    // ── Factual indicators (numbers only, never judgements) ──
    const indicators = [];
    const pctChange = (c, p) => (p > 0 ? round2(((c - p) / p) * 100) : null);
    for (const r of opex) {
        if (Math.abs(r.change) < 0.01 || (r.current < 100 && r.previous < 100)) continue;
        const pc = pctChange(r.current, r.previous);
        const dir = r.change > 0 ? 'increased' : 'decreased';
        indicators.push({
            metric: `expense:${r.category}`,
            text: pc !== null
                ? `${r.category} expense ${dir} by ${Math.abs(pc)}% (Rs ${r.previous.toLocaleString('en-IN')} → Rs ${r.current.toLocaleString('en-IN')})`
                : `${r.category} expense ${dir} by Rs ${Math.abs(r.change).toLocaleString('en-IN')} (previous period: Rs ${r.previous.toLocaleString('en-IN')})`,
            current: r.current, previous: r.previous
        });
    }
    const totalExpChange = round2(opexTotal - prevOpexTotal);
    if (Math.abs(totalExpChange) >= 0.01) {
        const pc = pctChange(opexTotal, prevOpexTotal);
        indicators.push({
            metric: 'expense:total',
            text: pc !== null
                ? `Total expenses ${totalExpChange > 0 ? 'increased' : 'decreased'} by ${Math.abs(pc)}% (Rs ${prevOpexTotal.toLocaleString('en-IN')} → Rs ${opexTotal.toLocaleString('en-IN')})`
                : `Total expenses ${totalExpChange > 0 ? 'increased' : 'decreased'} by Rs ${Math.abs(totalExpChange).toLocaleString('en-IN')}`,
            current: opexTotal, previous: prevOpexTotal
        });
    }
    // Per-litre metrics (milk bought in the period).
    const milkLiters = db.prepare(
        'SELECT COALESCE(SUM(quantity_liters),0) q FROM milk_collections WHERE date >= ? AND date <= ?'
    ).get(from, to).q;
    const prevMilkLiters = db.prepare(
        'SELECT COALESCE(SUM(quantity_liters),0) q FROM milk_collections WHERE date >= ? AND date <= ?'
    ).get(prevFrom, prevTo).q;
    const perLitre = (total, liters) => (liters > 0 ? round2(total / liters) : null);
    const curMilkPL = perLitre(round2(cur.expenses.milk_collection.total), milkLiters);
    const prevMilkPL = perLitre(round2(prev.expenses.milk_collection.total), prevMilkLiters);
    if (curMilkPL !== null) {
        indicators.push({
            metric: 'milk:cost_per_liter',
            text: `Milk procurement cost: Rs ${curMilkPL}/L${prevMilkPL !== null ? ` (previous period: Rs ${prevMilkPL}/L)` : ''}`,
            current: curMilkPL, previous: prevMilkPL
        });
    }
    const curOpExPL = perLitre(opexTotal, milkLiters);
    const prevOpExPL = perLitre(prevOpexTotal, prevMilkLiters);
    if (curOpExPL !== null && prevOpExPL !== null) {
        indicators.push({
            metric: 'operating:per_liter',
            text: `Operating expense per litre: Rs ${curOpExPL}/L${curOpExPL > prevOpExPL ? ' (up)' : curOpExPL < prevOpExPL ? ' (down)' : ''} from Rs ${prevOpExPL}/L`,
            current: curOpExPL, previous: prevOpExPL
        });
    }
    if (cur.income.total_sales > 0) {
        const salary = opex.find(r => r.category === 'Salary');
        if (salary) indicators.push({
            metric: 'salary:percent_of_sales',
            text: `Salary cost represents ${round2((salary.current / cur.income.total_sales) * 100)}% of sales`,
            current: salary.current, previous: salary.previous
        });
        indicators.push({
            metric: 'milk:percent_of_revenue',
            text: `Milk procurement cost represents ${round2((cur.expenses.milk_collection.total / cur.income.total_income) * 100)}% of revenue`,
            current: cur.expenses.milk_collection.total, previous: prev.expenses.milk_collection.total
        });
    }
    const salesPc = pctChange(cur.income.total_sales, prev.income.total_sales);
    indicators.push({
        metric: 'revenue:change',
        text: `Sales ${cur.income.total_sales >= prev.income.total_sales ? 'increased' : 'decreased'}${salesPc !== null ? ` by ${Math.abs(salesPc)}%` : ''} (Rs ${prev.income.total_sales.toLocaleString('en-IN')} → Rs ${cur.income.total_sales.toLocaleString('en-IN')})`,
        current: cur.income.total_sales, previous: prev.income.total_sales
    });
    // Outstanding advances at each period end.
    try {
        const advCur = accounting.getAdvanceRecoveryRegister(db, { as_of: to }).summary.total_outstanding;
        const advPrev = accounting.getAdvanceRecoveryRegister(db, { as_of: prevTo }).summary.total_outstanding;
        const dAdv = round2(advCur - advPrev);
        if (Math.abs(dAdv) >= 0.01) {
            indicators.push({
                metric: 'advances:change',
                text: `Outstanding advances ${dAdv > 0 ? 'increased' : 'decreased'} by Rs ${Math.abs(dAdv).toLocaleString('en-IN')} (Rs ${advPrev.toLocaleString('en-IN')} → Rs ${advCur.toLocaleString('en-IN')})`,
                current: advCur, previous: advPrev
            });
        }
    } catch (e) { /* register unavailable */ }

    const near = (a, b) => Math.abs(round2(a) - round2(b)) <= 0.01;
    const waterfall = {
        revenue: round2(cur.income.total_income),
        cogs: round2(cur.cogs),
        gross_profit: round2(cur.gross_profit),
        operating_expenses: opexTotal,
        net_profit: round2(cur.income.total_income - cur.cogs - opexTotal)
    };
    const checks = [
        { name: 'Board gross profit = P&L gross profit', expected: round2(cur.gross_profit), actual: waterfall.gross_profit, ok: near(waterfall.gross_profit, cur.gross_profit) },
        { name: 'Board expense table = P&L operating expenses', expected: round2(cur.operating_expenses), actual: opexTotal, ok: near(opexTotal, cur.operating_expenses) },
        { name: 'Board net = P&L net profit', expected: round2(cur.net_profit), actual: waterfall.net_profit, ok: near(waterfall.net_profit, cur.net_profit) }
    ];

    return {
        period: { from_date: from, to_date: to },
        previous_period: { from_date: prevFrom, to_date: prevTo },
        revenue: {
            total_sales: round2(cur.income.total_sales),
            milk_sales: revSplit.split['Milk sales'],
            product_sales: round2((revSplit.split['Cream sales'] || 0) + (revSplit.split['Paneer sales'] || 0)
                + (revSplit.split['Ghee sales'] || 0) + (revSplit.split['Nauni sales'] || 0) + (revSplit.split['Product sales'] || 0)),
            breakdown: revSplit.split,
            other_income: round2(cur.income.total_other_income),
            total_income: round2(cur.income.total_income),
            previous_total_sales: round2(prev.income.total_sales),
            previous_breakdown: prevRevSplit.split
        },
        cogs: {
            raw_milk_cost: round2(cur.expenses.milk_collection.total),
            production_purchases: round2(cur.expenses.purchases.total),
            total: round2(cur.cogs),
            lot_basis_cogs: cur.lot_cogs_available ? round2(cur.lot_cogs) : null
        },
        gross_profit: round2(cur.gross_profit),
        operating_expenses: opex,
        operating_expenses_total: opexTotal,
        previous_operating_expenses_total: prevOpexTotal,
        net: waterfall,
        indicators,
        pnl: cur,
        previous_pnl: prev,
        checks, all_checks_ok: checks.every(c => c.ok)
    };
}

// ──────────────────────────────────────────────────────────────
// Phases 14–16 — Daily / weekly / monthly management report
// ──────────────────────────────────────────────────────────────

/** Resolve the period + the comparable previous period. */
function _resolvePeriod(period, opts) {
    const as_of = opts.as_of || opts.date || _todayBS();
    if (period === 'daily') {
        return { from: as_of, to: as_of, prev_from: _bsShift(as_of, -1), prev_to: _bsShift(as_of, -1) };
    }
    if (period === 'weekly') {
        const from = _bsShift(as_of, -6);
        return { from, to: as_of, prev_from: _bsShift(from, -7), prev_to: _bsShift(from, -1) };
    }
    if (period === 'monthly') {
        const ym = String(as_of).slice(0, 7);
        const prev = _prevMonthRange(ym);
        return { from: `${ym}-01`, to: _monthEnd(ym), prev_from: prev.from, prev_to: prev.to };
    }
    // custom
    return {
        from: opts.from_date || opts.from || as_of,
        to: opts.to_date || opts.to || as_of,
        prev_from: opts.prev_from_date, prev_to: opts.prev_to_date
    };
}

function _periodMetrics(db, from, to) {
    if (!from || !to) return null;
    const pnl = getProfitLoss(db, { from_date: from, to_date: to });

    const milkLiters = db.prepare(
        'SELECT COALESCE(SUM(quantity_liters),0) q, COALESCE(SUM(amount),0) a FROM milk_collections WHERE date >= ? AND date <= ?'
    ).get(from, to);
    const processed = db.prepare(`
        SELECT COALESCE(SUM(pi.quantity), 0) q
          FROM production_inputs pi JOIN production_batches pb ON pb.id = pi.batch_id
         WHERE pb.date >= ? AND pb.date <= ?`).get(from, to).q;
    const produced = db.prepare(`
        SELECT COALESCE(SUM(po.quantity), 0) q
          FROM production_outputs po JOIN production_batches pb ON pb.id = po.batch_id
         WHERE pb.date >= ? AND pb.date <= ?`).get(from, to).q;

    let milkSold = { q: 0, a: 0 };
    try {
        // Row level, then filter: an aggregate in SQL would mix raw milk with
        // every other product before the classifier ever sees a name.
        milkSold = db.prepare(`
            SELECT si.product_name, si.quantity, si.amount
              FROM sales_items si JOIN sales s ON s.id = si.sale_id
             WHERE s.date >= ? AND s.date <= ?`).all(from, to)
            .reduce((acc, r) => {
                if (accounting.detectMilkLine(r.product_name)) {
                    acc.q = round2(acc.q + (Number(r.quantity) || 0));
                    acc.a = round2(acc.a + (Number(r.amount) || 0));
                }
                return acc;
            }, { q: 0, a: 0 });
    } catch (e) { /* sales_items missing */ }

    const receivables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) t FROM sales WHERE status IN ('unpaid', 'partial')"
    ).get().t;
    const payables = db.prepare(
        "SELECT COALESCE(SUM(grand_total - paid_amount), 0) t FROM purchases WHERE status IN ('unpaid', 'partial')"
    ).get().t;

    let stockValue = 0;
    try { stockValue = round2(require('./dairy_costing').getInventoryValuation(db).total_value); } catch (e) { stockValue = 0; }

    let advances = null;
    try {
        advances = accounting.getAdvanceRecoveryRegister(db, { as_of: to }).summary;
    } catch (e) { advances = null; }

    return {
        from_date: from, to_date: to,
        milk_received_liters: round2(milkLiters.q),
        milk_cost: round2(pnl.expenses.milk_collection.total),
        avg_milk_cost_per_liter: milkLiters.q > 0 ? round2(pnl.expenses.milk_collection.total / milkLiters.q) : 0,
        milk_processed_liters: round2(processed),
        milk_sold_liters: milkSold.q,
        milk_sales_amount: milkSold.a,
        avg_sales_realization_per_liter: milkSold.q > 0 ? round2(milkSold.a / milkSold.q) : 0,
        production_output_quantity: round2(produced),
        total_sales: round2(pnl.income.total_sales),
        other_income: round2(pnl.income.total_other_income),
        total_income: round2(pnl.income.total_income),
        cogs: round2(pnl.cogs),
        gross_profit: round2(pnl.gross_profit),
        operating_expenses: round2(pnl.operating_expenses),
        total_expenses: round2(pnl.expenses.total_expenses),
        net_profit: round2(pnl.net_profit),
        receivables: round2(receivables),
        payables: round2(payables),
        advances_outstanding: advances ? advances.total_outstanding : null,
        advances_overdue: advances ? advances.overdue : null,
        stock_value: stockValue,
        pnl
    };
}

/**
 * Daily / weekly / monthly management report (Phases 14–16) with a
 * period-over-period comparison and (for monthly) the P&L trend series.
 *
 * @param {object} db
 * @param {object} opts - { period: 'daily'|'weekly'|'monthly'|'custom',
 *                          as_of, from_date, to_date }
 */
function getManagementReport(db, opts = {}) {
    const period = ['daily', 'weekly', 'monthly', 'custom'].includes(opts.period) ? opts.period : 'weekly';
    const p = _resolvePeriod(period, opts);
    const current = _periodMetrics(db, p.from, p.to);
    const previous = p.prev_from ? _periodMetrics(db, p.prev_from, p.prev_to) : null;

    const keys = ['total_income', 'total_sales', 'milk_received_liters', 'milk_cost', 'avg_milk_cost_per_liter',
        'milk_processed_liters', 'milk_sold_liters', 'avg_sales_realization_per_liter',
        'production_output_quantity', 'cogs', 'gross_profit', 'operating_expenses', 'net_profit',
        'receivables', 'payables', 'advances_outstanding', 'stock_value'];
    const compare = {};
    for (const k of keys) {
        const c = current ? current[k] : null;
        const q = previous ? previous[k] : null;
        compare[k] = (c !== null && q !== null)
            ? { current: c, previous: q, change: round2(c - q) }
            : { current: c, previous: q, change: null };
    }

    let trend = null;
    if (period === 'monthly') {
        try {
            trend = getProfitLossByMonth(db, { from_date: opts.trend_from, to_date: opts.trend_to });
        } catch (e) { trend = null; }
    }

    const near = (a, b) => Math.abs(round2(a || 0) - round2(b || 0)) <= 0.01;
    const checks = current ? [
        { name: 'Report net = P&L net profit', expected: round2(current.pnl.net_profit), actual: current.net_profit, ok: near(current.net_profit, current.pnl.net_profit) },
        { name: 'Report COGS = P&L COGS', expected: round2(current.pnl.cogs), actual: current.cogs, ok: near(current.cogs, current.pnl.cogs) }
    ] : [];

    return {
        period,
        current, previous, compare, trend,
        checks, all_checks_ok: checks.every(c => c.ok)
    };
}

module.exports = {
    EXPENSE_CATEGORIES, normalizeExpenseCategory,
    getExpenseAnalysis, getBoardReport, getManagementReport
};
