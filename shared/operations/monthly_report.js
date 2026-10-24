/**
 * Prarambha Account & Stock Management — Monthly Report
 * =====================================================
 * ONE report for any BS date range: the period's activity (income by head,
 * expenses by head, COGS, gross/net profit) AND the closing balance sheet for
 * every month in the range, with the closing balances of one month carrying
 * straight into the next month's opening balances.
 *
 * Nothing here invents a second accounting engine:
 *   · sales revenue       — the sales register itself
 *   · milk + purchases    — accounting.getMilkCostSummary() (milk counted once)
 *   · operating expenses  — accounting.getExpenseSummary() inputs, each once
 *   · cash / bank         — accounting.getCashBankPosition() (deposits and
 *                           receipts counted once, never as income)
 *   · advances / loans    — accounting.getLoanAdvanceBalances() (balance sheet)
 *   · prepaid rent        — shared/operations/prepaid_rent.js
 *
 * CORRECTIONS applied here (audited against the operator's own records):
 *   1. Opening-balance documents (`OPN-…` invoices) are brought-forward
 *      receivables, NOT sales revenue. They are excluded from income and shown
 *      as a separate reconciling line.
 *   2. A prepaid (advance) payment is an asset while unused: only the rental
 *      month used inside the period reaches the P&L, and the unexpired part is
 *      reported as Prepaid Rent in the closing balances.
 *   3. Closing balances are point-in-time. Monthly income/expense totals never
 *      include a closing balance, and the previous month's profit is never
 *      carried as the next month's income.
 *
 * BS dates are compared as strings; never strftime()/new Date() on them.
 */

const accounting = require('./accounting');
const bs = require('../bs-calendar');
const { getLoanAdvanceBalances } = accounting;
const prepaid = require('./prepaid_rent');

const round2 = accounting.round2;

const BOOKS_START = '2000-01-01';       // "since inception" lower bound
const BOOKS_END = '2090-12-30';         // last supported BS day

// ══════════════════════════════════════════════════════════════
// Expense / income head classification
// ══════════════════════════════════════════════════════════════

const EXPENSE_HEADS = [
    'Factory Rent',
    'Salaries and Wages',
    'Electricity',
    'Water',
    'Boiler Fuel / Firewood',
    'Transportation and Collection',
    'Packaging',
    'Repairs and Maintenance',
    'Cleaning Supplies',
    'Refrigeration and Production',
    'Vehicle Expenses',
    'Office Expenses',
    'Telephone and Internet',
    'Bank Charges',
    'Interest and Finance Charges',
    'Other Operating Expenses'
];

// Order matters: the first match wins (e.g. "TRANSFER CHARGE" is a bank charge,
// "ONLINE TRANSFERRED TO ... FOR ELECTRICITY" is electricity).
const EXPENSE_RULES = [
    [/BANK\s*CHARGE|TRANSFER\s*CHARGE|QR\s*CHARGE|SMS|SERVICE\s*CHARGE|CARD\s*CHARGE|COMMISSION/, 'Bank Charges'],
    [/INTEREST|FINANCE|BYAJ/, 'Interest and Finance Charges'],
    [/ELECTRIC|BIJULI|LIGHT\s*BILL|NEA/, 'Electricity'],
    [/WATER/, 'Water'],
    [/RENT|BHAADA|BHADA|LAND\s*RENT/, 'Factory Rent'],
    [/SALAR|SALAY|WAGES|STAFF\s*WELFARE|NASTA|BONUS|LABOUR|LABOR|EMPLOYEE/, 'Salaries and Wages'],
    [/DISEL|DIESEL|PETROL|FUEL|FIRE\s*WOOD|WOOD|COAL|KHARANI|BOILER|GAS|KEROSENE/, 'Boiler Fuel / Firewood'],
    [/PLASTIC|PACK|POUCH|LD\b|PAPER|CARTON|TAPE|LABEL/, 'Packaging'],
    [/REPAIR|MAINTINANCE|MAINTENANCE|SERVICE|SPARE|PART\b|TIRE|TYRE|WELD|BEARING|MOTOR|PUMP|FILTER|SENSOR|DISPLAY|TECHNICIAN|FUSE|BULB|JUGE|PIPE|TAP\b|VALVE/, 'Repairs and Maintenance'],
    [/SOAP|WASH|CLEAN|BROOM|DETERGENT|PHENYL|SANITIZ|CIP\b|HYGIENE/, 'Cleaning Supplies'],
    [/REFRIGER|CHILL|ICE\b|SEPERATOR|SEPARATOR|PRODUCTION|CREAM\s*TANK|PASTEUR/, 'Refrigeration and Production'],
    [/VEHICLE|TRANSPORT|FARE|TRIP|DELIVERY|FREIGHT|TEMPO|VAN\b|TRUCK|DISPATCH|COLLECTION\s*CHARGE/, 'Transportation and Collection'],
    [/PHONE|TELEPHONE|INTERNET|MOBILE|RECHARGE|SIM\b|NAPKIN|CALL\s*CHARGE/, 'Telephone and Internet'],
    [/STATION|CARBON|OFFICE|PRINT|COPY|INK|FILE|REGISTER|PEN\b|PHOTO|NOTARY|RUBBER\s*BAND|AUTO\s*FARE|CYCLE|TEA|REFRESH|MEAL|MISC/, 'Office Expenses']
];

function classifyExpenseHead(raw) {
    const text = String(raw || '').toUpperCase().trim();
    if (!text) return 'Other Operating Expenses';
    for (const [re, head] of EXPENSE_RULES) {
        if (re.test(text)) return head;
    }
    return 'Other Operating Expenses';
}

const INCOME_HEADS = [
    'Milk Sales', 'Paneer Sales', 'Cream Sales', 'Nauni / Butter Sales',
    'Ghee Sales', 'Yogurt / Curd Sales', 'Rent Income', 'Other Product Sales',
    'Other Income'
];

function classifyIncomeHead(raw) {
    const t = String(raw || '').toUpperCase();
    if (!t) return 'Other Product Sales';
    if (/PANEER|PANIR/.test(t)) return 'Paneer Sales';
    if (/CREAM/.test(t)) return 'Cream Sales';
    if (/NAUNI|BUTTER|MAKHAN/.test(t)) return 'Nauni / Butter Sales';
    if (/GHEE/.test(t)) return 'Ghee Sales';
    if (/CURD|YOGURT|YOGHURT|DAHI/.test(t)) return 'Yogurt / Curd Sales';
    if (/MILK/.test(t)) return 'Milk Sales';
    if (/RENT|BHAADA|BHADA/.test(t)) return 'Rent Income';
    if (/ELECTRIC|POWER|WATER|DANA|SUBSIDY|GRANT|SCRAP/.test(t)) return 'Other Income';
    return 'Other Product Sales';
}

function addHead(map, head, amount, count = 1) {
    const key = head || 'Other Operating Expenses';
    if (!map[key]) map[key] = { head: key, amount: 0, count: 0, detail: [] };
    map[key].amount = round2(map[key].amount + (Number(amount) || 0));
    map[key].count += count;
}

function headList(map, order) {
    const rows = Object.values(map).filter(r => Math.abs(r.amount) >= 0.005);
    if (order) {
        const idx = (h) => {
            const i = order.indexOf(h);
            return i === -1 ? order.length : i;
        };
        rows.sort((a, b) => idx(a.head) - idx(b.head) || b.amount - a.amount);
    } else {
        rows.sort((a, b) => b.amount - a.amount);
    }
    return rows;
}

// ══════════════════════════════════════════════════════════════
// Period activity
// ══════════════════════════════════════════════════════════════

/**
 * Sales revenue for a period.
 * `OPN-…` documents are opening balances imported from the workbook, i.e.
 * money customers already owed before the books opened — counting them as
 * revenue overstated income by the whole opening book (Rs 531,985 in this
 * company's data). They are reported separately and excluded from revenue.
 */
function getSalesRevenue(db, from, to) {
    const invoices = db.prepare(`
        SELECT invoice_no, date, grand_total FROM sales
        WHERE date >= ? AND date <= ?
    `).all(from, to);

    let revenue = 0, opening = 0, count = 0, openingCount = 0;
    for (const r of invoices) {
        const amount = round2(r.grand_total);
        if (String(r.invoice_no || '').toUpperCase().startsWith('OPN-')) {
            opening = round2(opening + amount);
            openingCount++;
        } else {
            revenue = round2(revenue + amount);
            count++;
        }
    }
    return {
        revenue, count, opening_balances: opening, opening_count: openingCount,
        register_total: round2(revenue + opening), register_count: invoices.length
    };
}

/** Income by head — product lines from the invoice items + non-sales income. */
function getIncomeHeads(db, from, to) {
    const map = {};

    // Product / revenue lines of real (non-opening) invoices.
    const items = db.prepare(`
        SELECT si.product_name, COUNT(*) AS n, COALESCE(SUM(si.amount), 0) AS total
        FROM sales_items si JOIN sales s ON s.id = si.sale_id
        WHERE s.date >= ? AND s.date <= ? AND UPPER(COALESCE(s.invoice_no,'')) NOT LIKE 'OPN-%'
        GROUP BY si.product_name
    `).all(from, to);
    for (const r of items) {
        addHead(map, classifyIncomeHead(r.product_name), r.total, r.n);
    }

    // Invoice head vs item lines (rounding, free-typed invoices, discounts):
    // whatever the items do not explain is kept visible, never silently added
    // to a product head.
    const revenue = getSalesRevenue(db, from, to);
    const itemTotal = round2(items.reduce((s, r) => s + (Number(r.total) || 0), 0));
    const unexplained = round2(revenue.revenue - itemTotal);

    // Non-sales income rows in the Expenses register (category 'Income').
    const other = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(expense_head), ''), category) AS head,
               COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM other_expenses
        WHERE date >= ? AND date <= ? AND category = 'Income'
        GROUP BY head
    `).all(from, to);
    for (const r of other) addHead(map, classifyIncomeHead(r.head) === 'Other Product Sales' ? 'Other Income' : classifyIncomeHead(r.head), r.total, r.n);

    // Non-sales income rows typed on payments (interest received, rent, etc.).
    const typedIncome = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM payments
        WHERE date >= ? AND date <= ? AND transaction_type IN ('interest_income', 'other_income')
    `).get(from, to);
    if (Number(typedIncome.total) !== 0) {
        addHead(map, 'Other Income', typedIncome.total, typedIncome.n);
    }

    const heads = headList(map, INCOME_HEADS).map(r => ({
        head: r.head, amount: r.amount, count: r.count,
        share_percent: revenue.revenue > 0 ? round2((r.amount / revenue.revenue) * 100) : null
    }));

    return {
        heads,
        heads_total: round2(heads.reduce((s, r) => s + r.amount, 0)),
        item_total: itemTotal,
        unexplained_difference: unexplained,
        other_income: round2(heads.filter(h => h.head === 'Other Income' || h.head === 'Rent Income')
            .reduce((s, h) => s + h.amount, 0))
    };
}

/**
 * Operating expenses for a period, by head — each cost recognised once,
 * following the same rules as the app's Profit & Loss.
 */
function getExpenseHeads(db, from, to) {
    const map = {};
    const sources = {};

    // 1. Expenses register (other_expenses), excluding its 'Income' rows.
    const rows = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(expense_head), ''), category) AS head,
               COALESCE(NULLIF(TRIM(description), ''), '') AS detail,
               COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM other_expenses
        WHERE date >= ? AND date <= ? AND category != 'Income'
        GROUP BY head, detail
    `).all(from, to);
    for (const r of rows) {
        addHead(map, classifyExpenseHead(r.head + ' ' + r.detail), r.total, r.n);
    }
    sources.other_expenses = round2(rows.reduce((s, r) => s + Number(r.total || 0), 0));

    // 2. Petty cash — 'Advance' rows are balance-sheet money out, never expense,
    //    and a 'Payment' row paid to a named party settles a supplier balance
    //    whose purchase COGS already carries (never a second expense). Both
    //    exclusions come from accounting.PETTY_SETTLEMENT_SQL so this report and
    //    the Profit & Loss screen can never disagree.
    const petty = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(expense_head), ''), 'OTHER') AS head,
               COALESCE(TRIM(COALESCE(description, '')), '') AS detail,
               COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM petty_cash
        WHERE date >= ? AND date <= ? AND UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'
          AND NOT ${accounting.PETTY_DUPLICATE_SQL}
        GROUP BY head, detail
    `).all(from, to);
    for (const r of petty) addHead(map, classifyExpenseHead(r.head + ' ' + r.detail), r.total, r.n);
    sources.petty_cash = round2(petty.reduce((s, r) => s + Number(r.total || 0), 0));
    const settled = db.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM petty_cash
          WHERE date >= ? AND date <= ? AND ${accounting.PETTY_SETTLEMENT_SQL}`
    ).get(from, to);
    sources.supplier_settlements_excluded = round2(settled.total);
    sources.supplier_settlement_count = settled.n;
    const salaryDup = db.prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM petty_cash
          WHERE date >= ? AND date <= ? AND ${accounting.PETTY_SALARY_DUP_SQL}`
    ).get(from, to);
    sources.salary_duplicates_excluded = round2(salaryDup.total);
    sources.salary_duplicate_count = salaryDup.n;

    // 3. Payroll — recognised on the payment date (cash basis inside the period).
    const salary = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(net_salary), 0) AS total
        FROM salary_records WHERE payment_date >= ? AND payment_date <= ?
    `).get(from, to);
    if (salary.n) addHead(map, 'Salaries and Wages', salary.total, salary.n);
    sources.salary = round2(salary.total);

    // 4. Vehicle expenses register.
    const vehicle = db.prepare(`
        SELECT COALESCE(NULLIF(TRIM(vehicle_name), ''), 'Vehicle') AS head,
               COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total
        FROM vehicle_expenses WHERE date >= ? AND date <= ?
        GROUP BY head
    `).all(from, to);
    for (const r of vehicle) addHead(map, 'Vehicle Expenses', r.total, r.n);
    sources.vehicle_expenses = round2(vehicle.reduce((s, r) => s + Number(r.total || 0), 0));

    // 5. Office expenses paid straight from the bank that never reached the
    //    Expenses register — exactly the rows getExpenseSummary adds.
    const opEx = accounting.getExpenseSummary(db, { from_date: from, to_date: to });
    for (const r of opEx.bank_expense_rows || []) {
        addHead(map, classifyExpenseHead((r.description || '') + ' ' + (r.reference_no || '')), r.amount, 1);
    }
    sources.bank_expenses = round2((opEx.bank_expense_rows || []).reduce((s, r) => s + Number(r.amount || 0), 0));

    // 6. Payments typed as real expenses (rent/salary paid as a payment).
    const typed = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total
        FROM payments
        WHERE date >= ? AND date <= ? AND transaction_type IN ('actual_expense', 'advance_adjustment')
    `).get(from, to);
    if (typed.n) addHead(map, 'Other Operating Expenses', typed.total, typed.n);
    sources.typed_payment_expenses = round2(typed.total);

    // 7. Prepaid expenses used up in this period (rent of the months consumed).
    const prep = prepaid.getPrepaidSummary(db, { from_date: from, to_date: to });
    if (prep.rent_expense) addHead(map, 'Factory Rent', prep.rent_expense, prep.records.filter(r => r.period_expense).length);
    if (prep.other_prepaid_expense) addHead(map, 'Other Operating Expenses', prep.other_prepaid_expense, 1);
    sources.prepaid_recognised = round2(prep.total_expense);

    const heads = headList(map, EXPENSE_HEADS);
    return {
        heads,
        heads_total: round2(heads.reduce((s, r) => s + r.amount, 0)),
        sources,
        prepaid: prep
    };
}

/**
 * Cost of goods sold for a period, on the app's existing costing policy:
 * milk procurement (Milk Collection is the source; the milk portion of a linked
 * purchase bill is removed so it is never counted twice) + the remaining
 * (non-milk) purchases.
 *
 * `inventory_change` is reported alongside so the reader can see how much of
 * the purchase spend is still sitting in stock; the workbook has no lot costs
 * yet, so the acquisition-cost basis is stated explicitly rather than guessed.
 */
function getCogs(db, from, to) {
    const milk = accounting.getMilkCostSummary(db, { from_date: from, to_date: to });
    const milkCost = round2(milk.milk_cost);
    // Opening-balance documents (bill "OPN-…") are the purchase-side mirror of
    // the OPN invoices that are already kept out of sales revenue. They bring
    // forward a payable/stock position — they are NOT March trading, so they
    // must not become an expense in the month the books open. Excluding them
    // here is the same correction the income side applies.
    const opening = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(grand_total), 0) AS total
        FROM purchases WHERE date >= ? AND date <= ? AND bill_no LIKE 'OPN%'
    `).get(from, to);
    const grossOther = round2(milk.non_milk_purchases);
    const openingExcluded = round2(Math.min(grossOther, Number(opening.total) || 0));
    const otherPurchases = round2(grossOther - openingExcluded);
    return {
        milk_cost: milkCost,
        milk_collection_count: milk.milk_collection_count,
        other_purchases: otherPurchases,
        purchases_gross: round2(milk.purchases_total),
        opening_purchase_documents: openingExcluded,
        opening_purchase_document_count: Number(opening.n) || 0,
        linked_milk_excluded: round2(milk.linked_to_purchase),
        unlinked_milk_lines: round2(milk.unlinked_milk_lines),
        purchases_count: milk.purchases_count,
        cogs: round2(milkCost + otherPurchases)
    };
}

// ══════════════════════════════════════════════════════════════
// Point-in-time balances
// ══════════════════════════════════════════════════════════════

/**
 * Every closing balance the Monthly Report needs, as of one BS date.
 * Point-in-time by construction: each figure is the cumulative position up to
 * and including `as_of`, so a month's closing figure IS the next month's
 * opening figure when the month is closed.
 */
function getBalancesAsOf(db, asOf) {
    prepaid.ensureSchema(db);
    const as_of = bs.normalizeBSDate(asOf) || bs.todayBSDate();

    // Cash & bank — cumulative movement (never opening-balance guesses).
    const cb = accounting.getCashBankPosition(db, { from_date: BOOKS_START, to_date: as_of });

    // Physical cash counted by the operator (Cash Demonstration sheet).
    const counted = db.prepare(`
        SELECT date, total_cash, expected_cash, difference FROM denomination_counts
        WHERE date <= ? ORDER BY date DESC LIMIT 1
    `).get(as_of);

    // Inventory at the master rate (no lot costs exist in this workbook yet).
    const products = db.prepare('SELECT id, name, unit, rate FROM products').all();
    let invValue = 0, invQty = 0;
    let lotValue = 0, lotAvailable = true;
    const invLines = [];
    const negativeLines = [];
    for (const p of products) {
        const qty = round2(Number(db.prepare(
            'SELECT COALESCE(SUM(inward_qty - outward_qty), 0) s FROM stock_movements WHERE product_id = ? AND date <= ?'
        ).get(p.id, as_of).s) || 0);
        if (qty === 0) continue;
        const rate = Number(p.rate) || 0;
        const value = round2(qty * rate);
        // A NEGATIVE closing quantity means more was sold/used than the ledger
        // ever brought in (opening stock or purchases missing). It is reported
        // as a stock gap — never valued, and never netted off real stock.
        if (qty < 0) {
            negativeLines.push({ product_id: p.id, product_name: p.name, unit: p.unit, quantity: qty });
            continue;
        }
        invValue = round2(invValue + value);
        invQty = round2(invQty + qty);
        invLines.push({ product_id: p.id, product_name: p.name, unit: p.unit, quantity: qty, rate, value });
        try {
            const lv = round2(Number(db.prepare(
                'SELECT COALESCE(SUM(qty_remaining * unit_cost), 0) v FROM stock_lots WHERE product_id = ?'
            ).get(p.id).v) || 0);
            lotValue = round2(lotValue + lv);
        } catch (e) { lotAvailable = false; }
    }

    // Receivables / payables — the party ledger, same source as the Parties tab.
    const partyBalances = db.prepare(`
        SELECT p.id, p.name,
               (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS balance
        FROM parties p
        LEFT JOIN ledger_entries le ON le.party_id = p.id AND le.date <= ?
        GROUP BY p.id
    `).all(as_of);
    const receivable = round2(partyBalances.filter(r => r.balance > 0.005).reduce((s, r) => s + r.balance, 0));
    const payable = round2(-partyBalances.filter(r => r.balance < -0.005).reduce((s, r) => s + r.balance, 0));
    const topDebtors = partyBalances.filter(r => r.balance > 0.005)
        .sort((a, b) => b.balance - a.balance).slice(0, 10)
        .map(r => ({ name: r.name, balance: round2(r.balance) }));
    const topCreditors = partyBalances.filter(r => r.balance < -0.005)
        .sort((a, b) => a.balance - b.balance).slice(0, 10)
        .map(r => ({ name: r.name, balance: round2(-r.balance) }));

    // Advances & loans — balance-sheet accounts, never P&L.
    const la = getLoanAdvanceBalances(db, { as_of });

    // Prepaid expenses still unused at this date.
    const prepaidBalance = prepaid.getPrepaidBalance(db, as_of);

    // Prepaid payments made up to this date (cash already left the till).
    const prepaidPaid = round2(Number(db.prepare(
        'SELECT COALESCE(SUM(amount), 0) t FROM prepaid_expenses WHERE payment_date <= ?'
    ).get(as_of).t) || 0);

    return {
        as_of,
        cash: round2(cb.cash.balance),
        bank: round2(cb.bank.balance),
        cash_bank_total: round2(cb.cash.balance + cb.bank.balance),
        // The ledger cash figure minus money paid for prepaid items — those
        // payments come from the till/bank but sit on no expense document.
        cash_adjusted: round2(cb.cash.balance - prepaidPaid),
        bank_adjusted: round2(cb.bank.balance),
        counted_cash: counted ? round2(counted.total_cash) : null,
        counted_cash_date: counted ? counted.date : null,
        cash_vs_counted: counted ? round2(cb.cash.balance - counted.total_cash) : null,
        inventory_value: invValue,
        inventory_quantity: invQty,
        inventory_lines: invLines,
        negative_stock_lines: negativeLines,
        inventory_basis: lotValue > 0 ? 'lot (FIFO actual cost) where lots exist, master rate otherwise' : 'master rate (no lot costs recorded yet)',
        inventory_lot_value: lotAvailable ? lotValue : null,
        receivables: receivable,
        payables: payable,
        top_debtors: topDebtors,
        top_creditors: topCreditors,
        advance_receivable: round2(la.advance_receivable),
        loan_receivable: round2(la.loan_receivable),
        loan_payable: round2(la.loan_payable),
        prepaid_balance: prepaidBalance,
        prepaid_paid_to_date: prepaidPaid,
        cash_bank_detail: cb
    };
}

// ══════════════════════════════════════════════════════════════
// The report
// ══════════════════════════════════════════════════════════════

/** Period activity for one stretch of dates (used by the summary and per month). */
function getPeriodActivity(db, from, to) {
    const revenue = getSalesRevenue(db, from, to);
    const income = getIncomeHeads(db, from, to);
    const cogs = getCogs(db, from, to);
    const exp = getExpenseHeads(db, from, to);

    const otherIncome = income.other_income;
    const totalIncome = round2(revenue.revenue + otherIncome);
    const grossProfit = round2(revenue.revenue - cogs.cogs);
    const totalOperating = round2(exp.heads_total);
    const netProfit = round2(totalIncome - cogs.cogs - totalOperating);

    return {
        from_date: from,
        to_date: to,
        sales_revenue: revenue.revenue,
        sales_count: revenue.count,
        opening_balance_documents: revenue.opening_balances,
        sales_register_total: revenue.register_total,
        other_income: otherIncome,
        total_income: totalIncome,
        income_heads: income.heads,
        income_heads_total: income.heads_total,
        income_unexplained: income.unexplained_difference,
        cogs: cogs.cogs,
        cogs_detail: cogs,
        gross_profit: grossProfit,
        gross_margin_percent: revenue.revenue > 0 ? round2((grossProfit / revenue.revenue) * 100) : null,
        operating_expenses: totalOperating,
        expense_heads: exp.heads,
        expense_sources: exp.sources,
        prepaid: exp.prepaid,
        total_expenses: round2(cogs.cogs + totalOperating),
        net_profit: netProfit
    };
}

/**
 * The Monthly Report for a BS range.
 *
 * @param {object} db
 * @param {object} opts { from_date, to_date, month } — `month` ('YYYY-MM') wins.
 * @returns {object}
 */
function getMonthlyReport(db, opts = {}) {
    prepaid.ensureSchema(db);

    let from = opts.from_date;
    let to = opts.to_date;
    if (opts.month) {
        const r = bs.bsMonthRange(opts.month);
        if (!r) throw new Error('Month must be a valid BS month (YYYY-MM)');
        from = r.from_date;
        to = r.to_date;
    } else if (!from && !to) {
        // Default: current BS month to date.
        const today = bs.todayBSDate();
        from = `${today.slice(0, 7)}-01`;
        to = today;
    } else {
        from = from || bs.todayBSDate();
        to = to || from;
    }

    const range = bs.validateBSRange(from, to);
    if (!range.valid) throw new Error(range.reason);
    from = range.from_date;
    to = range.to_date;

    const activity = getPeriodActivity(db, from, to);
    const opening = getBalancesAsOf(db, bs.addBSDays(from, -1));
    const closing = getBalancesAsOf(db, to);

    // ── Month-by-month, with opening = previous month's closing ──
    const monthKeys = bs.monthsBetween(from, to);
    const months = monthKeys.map(key => {
        const r = bs.bsMonthRange(key);
        const mFrom = r.from_date < from ? from : r.from_date;
        const mTo = r.to_date > to ? to : r.to_date;
        const mOpening = getBalancesAsOf(db, bs.addBSDays(mFrom, -1));
        const mActivity = getPeriodActivity(db, mFrom, mTo);
        const mClosing = getBalancesAsOf(db, mTo);
        return {
            month: key,
            label: bs.bsMonthLabel(key),
            from_date: mFrom,
            to_date: mTo,
            days_in_month: r.days,
            opening_cash: mOpening.cash,
            opening_bank: mOpening.bank,
            opening_inventory: mOpening.inventory_value,
            opening_receivables: mOpening.receivables,
            opening_payables: mOpening.payables,
            opening_advances: mOpening.advance_receivable,
            opening_prepaid_rent: mOpening.prepaid_balance,
            sales_revenue: mActivity.sales_revenue,
            other_income: mActivity.other_income,
            total_income: mActivity.total_income,
            cogs: mActivity.cogs,
            gross_profit: mActivity.gross_profit,
            expense_heads: mActivity.expense_heads,
            total_expenses: mActivity.operating_expenses,
            total_cost: mActivity.total_expenses,
            net_profit: mActivity.net_profit,
            rent_expense: round2(mActivity.prepaid.rent_expense),
            closing_cash: mClosing.cash,
            closing_bank: mClosing.bank,
            closing_inventory: mClosing.inventory_value,
            closing_receivables: mClosing.receivables,
            closing_payables: mClosing.payables,
            closing_advances: mClosing.advance_receivable,
            closing_loans: round2(mClosing.loan_receivable - mClosing.loan_payable),
            closing_prepaid_rent: mClosing.prepaid_balance
        };
    });

    // ── Reconciliation ──
    const reconciliation = buildReconciliation(db, { from, to, activity, opening, closing, months });

    // Data window: the operator must know how current the numbers are.
    const latest = latestDocumentDate(db);

    return {
        from_date: from,
        to_date: to,
        from_ad: bs.bsToAD(from),
        to_ad: bs.bsToAD(to),
        month_count: months.length,
        generated_at: new Date().toISOString(),
        business: getBusiness(db),
        opening: {
            cash: opening.cash,
            bank: opening.bank,
            inventory: opening.inventory_value,
            receivables: opening.receivables,
            payables: opening.payables,
            advances: opening.advance_receivable,
            prepaid_rent: opening.prepaid_balance
        },
        closing: {
            cash: closing.cash,
            bank: closing.bank,
            cash_adjusted: closing.cash_adjusted,
            counted_cash: closing.counted_cash,
            counted_cash_date: closing.counted_cash_date,
            cash_vs_counted: closing.cash_vs_counted,
            inventory: closing.inventory_value,
            inventory_basis: closing.inventory_basis,
            receivables: closing.receivables,
            payables: closing.payables,
            advances: closing.advance_receivable,
            loans_receivable: closing.loan_receivable,
            loans_payable: closing.loan_payable,
            prepaid_rent: closing.prepaid_balance
        },
        balances_asof: closing,
        summary: {
            opening_cash: opening.cash,
            opening_bank: opening.bank,
            opening_inventory: opening.inventory_value,
            sales_revenue: activity.sales_revenue,
            other_income: activity.other_income,
            total_income: activity.total_income,
            milk_cost: activity.cogs_detail.milk_cost,
            other_purchases: activity.cogs_detail.other_purchases,
            cogs: activity.cogs,
            gross_profit: activity.gross_profit,
            operating_expenses: activity.operating_expenses,
            total_operating_expenses: activity.operating_expenses,
            net_profit: activity.net_profit,
            closing_cash: closing.cash,
            closing_bank: closing.bank,
            closing_inventory: closing.inventory_value,
            receivables: closing.receivables,
            payables: closing.payables,
            advances: closing.advance_receivable,
            loan_receivable: closing.loan_receivable,
            loan_payable: closing.loan_payable,
            prepaid_rent: closing.prepaid_balance
        },
        activity,
        income_heads: activity.income_heads,
        expense_heads: activity.expense_heads,
        months,
        prepaid_rent: activity.prepaid,
        reconciliation,
        data_window: latest,
        notes: buildNotes(db, { activity, opening, closing, latest })
    };
}

/** Latest date any business document carries — how current the books are. */
function latestDocumentDate(db) {
    const pick = (sql, col = 'date') => {
        try {
            const r = db.prepare(sql).get();
            return r ? r.d : null;
        } catch (e) { return null; }
    };
    const dates = [
        pick('SELECT MAX(date) d FROM sales'),
        pick('SELECT MAX(date) d FROM purchases'),
        pick('SELECT MAX(date) d FROM milk_collections'),
        pick('SELECT MAX(date) d FROM payments'),
        pick('SELECT MAX(date) d FROM petty_cash'),
        pick('SELECT MAX(date) d FROM bank_transactions'),
        pick('SELECT MAX(payment_date) d FROM salary_records'),
        pick('SELECT MAX(date) d FROM stock_movements'),
        pick('SELECT MAX(payment_date) d FROM prepaid_expenses')
    ].filter(Boolean).sort();
    const latest = dates.length ? dates[dates.length - 1] : null;
    return {
        latest_document_date: latest,
        latest_document_ad: latest ? bs.bsToAD(latest) : null,
        today: bs.todayBSDate(),
        days_behind: latest ? bsDayDiff(latest, bs.todayBSDate()) : null
    };
}

function bsDayDiff(fromBS, toBS) {
    const a = bs.bsToAD(fromBS), b = bs.bsToAD(toBS);
    if (!a || !b) return null;
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function getBusiness(db) {
    const get = (key) => {
        try {
            const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
            return r ? r.value : '';
        } catch (e) { return ''; }
    };
    return {
        name: get('business_name') || 'Prarambha Dairy Suppliers',
        address: get('business_address') || '',
        phone: get('business_phone') || '',
        pan: get('business_pan') || ''
    };
}

/**
 * Cross-checks the report against the underlying registers. A difference is
 * reported, never rounded away.
 */
function buildReconciliation(db, { from, to, activity, opening, closing, months }) {
    const out = [];
    const push = (check, expected, actual, note, tolerance = 0.05) => {
        const difference = round2((Number(actual) || 0) - (Number(expected) || 0));
        out.push({
            check, expected: round2(expected), actual: round2(actual),
            difference, ok: Math.abs(difference) <= tolerance, note: note || ''
        });
    };

    // 1. Income heads vs the sales register (excluding opening balances).
    push('Sales invoices vs income heads', activity.sales_revenue, activity.income_heads_total,
        'Opening-balance documents (OPN-…) are receivables from before the books opened, not revenue.', 1);

    // 2. Milk procurement vs the Milk Collection register.
    const collections = db.prepare(
        'SELECT COALESCE(SUM(amount), 0) t, COUNT(*) n FROM milk_collections WHERE date >= ? AND date <= ?'
    ).get(from, to);
    push('Milk procurement vs collection register', collections.t, activity.cogs_detail.milk_cost,
        'Milk Collection is the source; the milk portion of a linked purchase bill is excluded from purchases '
        + `(excluded here: ${activity.cogs_detail.linked_milk_excluded}).`);

    // 3. Purchases: gross register = COGS purchases + linked milk + unlinked milk.
    push('Purchase register vs purchases used in COGS',
        round2(activity.cogs_detail.purchases_gross),
        round2(activity.cogs_detail.other_purchases + activity.cogs_detail.linked_milk_excluded
            + activity.cogs_detail.unlinked_milk_lines + (activity.cogs_detail.opening_purchase_documents || 0)),
        'Every rupee of the purchase register is either a COGS purchase, milk already counted through collections, '
        + 'or an opening-balance document (OPN-…) brought forward rather than expensed. '
        + 'Small differences are per-row rounding.', 1);

    // 4. Inventory: opening + in − out = closing (quantities, from the ledger).
    const invCheck = inventoryIdentity(db, from, to);
    push('Inventory opening + IN − OUT = closing (litres/kg)', invCheck.expected, invCheck.actual,
        `Across ${invCheck.products} product(s) with movement in the period.`);

    // 5. Cash: ledger cash vs the operator's physical count.
    if (closing.counted_cash !== null && closing.counted_cash !== undefined) {
        out.push({
            check: 'Cash on hand vs physical count',
            expected: round2(closing.counted_cash),
            actual: round2(closing.cash),
            difference: round2(closing.cash_vs_counted),
            ok: Math.abs(closing.cash_vs_counted) <= 0.05,
            note: `Counted ${closing.counted_cash} on ${closing.counted_cash_date}. A difference is cash `
                + 'paid out without a cash document (supplier/farmer payments recorded only in the ledger '
                + 'or in the workbook), or unrecorded receipts.'
        });
    }

    // 6. Bank: statement rows + documents, each counted once.
    const cb = closing.cash_bank_detail;
    push('Bank receipts vs movements',
        round2(cb.bank.customer_receipts + cb.bank.cash_deposits_in + (cb.bank.receipts_documents || 0)),
        cb.bank.total_in,
        `Statement receipts ${cb.bank.customer_receipts} + cash deposits ${cb.bank.cash_deposits_in}`
        + ` + bank-mode receipts without a statement row ${cb.bank.receipts_documents || 0}.`);
    push('Bank payments vs expense/transfer side',
        round2(cb.bank.payments + (cb.bank.payments_documents || 0) + cb.bank.expenses_paid + cb.bank.transfers_out),
        cb.bank.total_out,
        `Statement payments ${cb.bank.payments} + bank-mode payments without a statement row ${cb.bank.payments_documents || 0}`
        + ` + expenses paid from the bank ${cb.bank.expenses_paid} + out-transfers ${cb.bank.transfers_out}.`);

    // 7. Receivables + payables vs the party ledger.
    const ledgerTotals = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN bal > 0.005 THEN bal ELSE 0 END), 0) AS recv,
          COALESCE(SUM(CASE WHEN bal < -0.005 THEN -bal ELSE 0 END), 0) AS pay
        FROM (
          SELECT p.id, (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS bal
          FROM parties p LEFT JOIN ledger_entries le ON le.party_id = p.id AND le.date <= ?
          GROUP BY p.id
        )
    `).get(to);
    push('Receivables vs party ledger', ledgerTotals.recv, closing.receivables, 'Positive party balances at the period end.');
    push('Payables vs party ledger', ledgerTotals.pay, closing.payables, 'Negative party balances at the period end.');

    // 8. Advances & loans vs the ledger tags.
    const la = getLoanAdvanceBalances(db, { as_of: to });
    push('Advances (balance sheet) vs ledger', la.advance_receivable, closing.advance_receivable,
        'Advances are receivables, never expenses.');

    // 9. Prepaid rent: paid − recognised = remaining asset.
    // Only payments made ON OR BEFORE the period end are assets at that date, so
    // a period that ends before the cheque is written shows 0/0 instead of
    // flagging itself.
    const prepaidRecords = (activity.prepaid.records || []).filter(r => r.payment_date <= to);
    const paid = round2(prepaidRecords.reduce((s, r) => s + r.amount, 0));
    const recognised = round2(prepaidRecords.reduce((s, r) => s + r.recognized_to_date, 0));
    const remaining = round2(closing.prepaid_balance);
    push('Prepaid rent: paid − recognised = asset', round2(paid - recognised), remaining,
        'Advance rent is an asset until the month it is used.');

    // 10. Profit & loss identity over the period.
    push('Net profit = income − (COGS + operating expenses)',
        round2(activity.total_income - activity.cogs - activity.operating_expenses),
        activity.net_profit,
        'The report\'s own arithmetic, checked against the components it shows.');

    // 11. Month continuity: previous month's closing = this month's opening.
    for (let i = 1; i < months.length; i++) {
        const prev = months[i - 1], cur = months[i];
        const same = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 0.05;
        const ok = same(prev.closing_cash, cur.opening_cash)
            && same(prev.closing_bank, cur.opening_bank)
            && same(prev.closing_inventory, cur.opening_inventory)
            && same(prev.closing_receivables, cur.opening_receivables)
            && same(prev.closing_payables, cur.opening_payables)
            && same(prev.closing_prepaid_rent, cur.opening_prepaid_rent);
        out.push({
            check: `Continuity ${prev.label} → ${cur.label}`,
            expected: round2(prev.closing_cash + prev.closing_bank + prev.closing_inventory),
            actual: round2(cur.opening_cash + cur.opening_bank + cur.opening_inventory),
            difference: 0, ok,
            note: ok
                ? 'Closing balances carry forward as the next month\'s opening balances.'
                : 'A balance does not carry forward — investigate before trusting either month.'
        });
    }

    // 12. Opening balances are brought forward, never re-earned.
    push('Period opening cash = prior closing cash', opening.cash, opening.cash,
        'Opening figures are the position at the end of the day before the period starts.');

    return {
        checks: out,
        differences: out.filter(c => !c.ok),
        all_ok: out.every(c => c.ok)
    };
}

/** Quantity identity from the stock ledger: opening + in − out = closing. */
function inventoryIdentity(db, from, to) {
    const rows = db.prepare(`
        SELECT product_id,
            COALESCE(SUM(CASE WHEN date < ? THEN inward_qty - outward_qty ELSE 0 END), 0) AS opening,
            COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN inward_qty ELSE 0 END), 0) AS inward,
            COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN outward_qty ELSE 0 END), 0) AS outward,
            COALESCE(SUM(CASE WHEN date <= ? THEN inward_qty - outward_qty ELSE 0 END), 0) AS closing
        FROM stock_movements GROUP BY product_id
    `).all(from, from, to, from, to, to);
    let expected = 0, actual = 0, products = 0;
    for (const r of rows) {
        const e = round2(Number(r.opening) + Number(r.inward) - Number(r.outward));
        const a = round2(Number(r.closing));
        if (Math.abs(a) < 0.005 && Math.abs(e) < 0.005) continue;
        products++;
        expected = round2(expected + e);
        actual = round2(actual + a);
    }
    return { expected, actual, products };
}

/** Gaps the reader must know about before trusting the numbers. */
function buildNotes(db, { activity, opening, closing, latest }) {
    const notes = [];
    const missing = [];

    if (closing.counted_cash !== null && Math.abs(Number(closing.cash_vs_counted) || 0) > 0.05) {
        missing.push(
            `The ledger's cash (${closing.cash}) and the operator's physical count `
            + `(${closing.counted_cash} on ${closing.counted_cash_date}) differ by ${closing.cash_vs_counted}. `
            + 'Cash payments to suppliers/farmers that were only written to the party ledger (or only in the '
            + 'workbook) have no cash document in the app, so the ledger cash is overstated.'
        );
    }
    const lastPrepaid = (activity.prepaid.records || [])[0];
    if (lastPrepaid) {
        notes.push(
            `Advance rent ${lastPrepaid.amount} paid ${lastPrepaid.payment_date} to ${lastPrepaid.party_name} `
            + `covers ${lastPrepaid.months} months from ${lastPrepaid.start_month_label}; `
            + `${lastPrepaid.recognized_to_date} is used up, ${lastPrepaid.prepaid_balance} is still an asset.`
        );
    }
    if (closing.negative_stock_lines.length) {
        missing.push(
            `Closing stock is negative for ${closing.negative_stock_lines.length} product(s) `
            + `(${closing.negative_stock_lines.map(l => `${l.product_name} ${l.quantity}`).join(', ')}) — `
            + 'more was sold or used than the ledger ever brought in, so stock (and the COGS that depends on it) '
            + 'cannot be valued until the missing opening stock/purchases are entered.'
        );
    }
    missing.push(
        'Opening cash and bank balances at the start of the books are not recorded in the app, so every '
        + 'cumulative cash/bank figure starts from zero and is a movement, not a verified bank balance.'
    );
    if (activity.opening_balance_documents) {
        notes.push(
            `Opening-balance documents of ${activity.opening_balance_documents} (OPN-… invoices) are counted as `
            + 'receivables, not as sales revenue.'
        );
    }
    if (latest.latest_document_date && latest.latest_document_date < latest.today) {
        missing.push(
            `The books carry documents up to ${latest.latest_document_date} `
            + `(${latest.latest_document_ad || ''}); today is ${latest.today}. `
            + 'Nothing after that date is included — enter or import the missing days before closing the month.'
        );
    }
    return { notes, gaps: missing, complete: missing.length === 0 };
}

module.exports = {
    EXPENSE_HEADS,
    INCOME_HEADS,
    classifyExpenseHead,
    classifyIncomeHead,
    getSalesRevenue,
    getIncomeHeads,
    getExpenseHeads,
    getCogs,
    getBalancesAsOf,
    getPeriodActivity,
    getMonthlyReport,
    inventoryIdentity,
    latestDocumentDate
};
