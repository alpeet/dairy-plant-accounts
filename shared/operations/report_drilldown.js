/**
 * Prarambha Account & Stock Management — Monthly Report drill-down
 * ================================================================
 * Every figure on the Monthly Report is traceable to the records that made it.
 *
 * The rule this module obeys: **the drill-down is not a second calculation.**
 *   · the figure shown at the top of a drill-down is the one the report engine
 *     returned (`getMonthlyReport` → `summary`), never re-derived here;
 *   · the rows below it come from the same tables with the same predicates the
 *     report engine uses, so the detail is the report's own evidence;
 *   · every drill-down ends with a check: do the rows add up to the figure?
 *     A difference that is not paisa-rounding is returned as `flagged` — the
 *     UI must show it as an audit defect, never round it away.
 *
 * When a figure has no single transaction behind it (a closing balance, a
 * subtotal, a recognised prepaid month) the row list is the *composition* of
 * the figure: opening + additions − reductions, each component labelled with
 * where it came from.
 */

const accounting = require('./accounting');
const prepaid = require('./prepaid_rent');
const mr = require('./monthly_report');
const bs = require('../bs-calendar');

const round2 = accounting.round2;
// Rows are displayed to 2 dp, so summing many of them can drift by a paisa or
// two against the report's own end-rounded total. Five paisa is the same
// tolerance the Monthly Report's reconciliation uses; anything larger is a real
// difference and is flagged, never rounded away.
const TOL = 0.05;

// ══════════════════════════════════════════════════════════════
// Line registry — labels (English / नेपाली) and the kind of figure
// ══════════════════════════════════════════════════════════════

/**
 * `basis`:
 *   'transaction' — the figure is the sum of the rows listed.
 *   'balance'     — a point-in-time balance: opening + additions − reductions.
 *   'formula'     — a subtotal of other report lines; rows are its components.
 */
const LINES = {
    opening_cash:            { en: 'Opening Cash Balance',        np: 'सुरुको नगद मौज्दात',              basis: 'balance' },
    opening_bank:            { en: 'Opening Bank Balance',        np: 'सुरुको बैंक मौज्दात',              basis: 'balance' },
    opening_inventory:       { en: 'Opening Inventory Value',     np: 'सुरुको मौज्दात मूल्य',             basis: 'balance' },
    sales_revenue:           { en: 'Sales Revenue',               np: 'बिक्री आमदानी',                    basis: 'transaction' },
    other_income:            { en: 'Other Income',                np: 'अन्य आमदानी',                      basis: 'transaction' },
    total_income:            { en: 'Total Income',                np: 'कुल आम्दानी',                      basis: 'formula' },
    milk_cost:               { en: 'Milk Procurement Cost',       np: 'दूध खरिद लागत',                    basis: 'transaction' },
    other_purchases:         { en: 'Other Purchases',             np: 'अन्य खरिद',                        basis: 'transaction' },
    cogs:                    { en: 'Cost of Goods Sold',          np: 'बिक्री भएका सामानको लागत',          basis: 'formula' },
    gross_profit:            { en: 'Gross Profit',                np: 'कुल नाफा',                         basis: 'formula' },
    total_operating_expenses:{ en: 'Total Operating Expenses',    np: 'कुल सञ्चालन खर्च',                 basis: 'formula' },
    net_profit:              { en: 'Net Profit / (Loss)',         np: 'खुद नाफा / (नोक्सान)',             basis: 'formula' },
    closing_cash:            { en: 'Closing Cash Balance',        np: 'अन्तिम नगद मौज्दात',               basis: 'balance' },
    closing_bank:            { en: 'Closing Bank Balance',        np: 'अन्तिम बैंक मौज्दात',              basis: 'balance' },
    closing_inventory:       { en: 'Closing Inventory Value',     np: 'अन्तिम मौज्दात मूल्य',             basis: 'balance' },
    receivables:             { en: 'Outstanding Receivables',     np: 'उठाउन बाँकी रकम',                  basis: 'balance' },
    payables:                { en: 'Outstanding Payables',        np: 'तिर्न बाँकी रकम',                  basis: 'balance' },
    advances:                { en: 'Outstanding Advances',        np: 'अग्रिम रकम (उठाउन बाँकी)',         basis: 'balance' },
    loan_receivable:         { en: 'Loan Receivable',             np: 'उठाउन बाँकी ऋण',                   basis: 'balance' },
    loan_payable:            { en: 'Loan Payable',                np: 'तिर्न बाँकी ऋण',                   basis: 'balance' },
    prepaid_rent:            { en: 'Prepaid Rent Balance',        np: 'अग्रिम भुक्तानी घरभाडा (सम्पत्ति)', basis: 'balance' }
};

/** Which workbook sheet a module's records originally came from. */
const SOURCE_SHEETS = {
    sales: 'Sales',
    sales_items: 'Sales',
    purchases: 'Purchase',
    purchase_items: 'Purchase',
    milk_collections: 'Milk_Collection',
    payments: 'Payment Register',
    other_expenses: 'Expenses',
    petty_cash: 'Petty_Cash',
    salary_records: 'Salary',
    vehicle_expenses: 'Vehicle Expenses',
    bank_transactions: 'Bank_Transactions',
    cash_deposits: 'Cash_Deposit',
    prepaid_expenses: 'Expenses',
    stock_movements: 'Stock',
    ledger_entries: 'Party Master',
    parties: 'Party Master',
    denomination_counts: 'Cash_Demonstration'
};

/** Where the user can open the underlying record. */
const EDIT_PAGES = {
    sales: 'sales',
    purchases: 'purchases',
    milk_collections: 'milk',
    payments: 'payment-collection',
    other_expenses: 'expenses',
    petty_cash: 'petty-cash',
    salary_records: 'salary',
    vehicle_expenses: 'vehicle',
    bank_transactions: 'bank',
    cash_deposits: 'cash-deposit',
    stock_movements: 'stock',
    prepaid_expenses: 'expenses',
    parties: 'parties'
};

// ══════════════════════════════════════════════════════════════
// Row helpers
// ══════════════════════════════════════════════════════════════

/**
 * One traceable record.
 * `direction` is 'in' | 'out' | 'neutral'; `signed` lets a movement total be
 * rebuilt from the rows themselves (money in − money out).
 */
/** Human name of the screen/module a record belongs to. */
const MODULES = {
    sales: 'Sales',
    sales_items: 'Sales',
    purchases: 'Purchases',
    purchase_items: 'Purchases',
    milk_collections: 'Milk Collection',
    payments: 'Payments',
    other_expenses: 'Expenses',
    petty_cash: 'Petty Cash',
    salary_records: 'Salary',
    vehicle_expenses: 'Vehicle Expenses',
    bank_transactions: 'Bank Transactions',
    cash_deposits: 'Cash Deposit',
    prepaid_expenses: 'Prepaid',
    stock_movements: 'Stock',
    ledger_entries: 'Party Ledger',
    parties: 'Parties'
};

function makeRow(o = {}) {
    const amount = round2(o.amount);
    const direction = o.direction || 'neutral';
    return {
        date: o.date || '',
        voucher: o.voucher || '',
        party: o.party || '',
        description: o.description || '',
        source_module: o.module !== undefined ? o.module : (MODULES[o.table] || ''),
        source_sheet: o.sheet !== undefined ? o.sheet : (SOURCE_SHEETS[o.table] || ''),
        source_row: o.sheet_row == null ? null : o.sheet_row,
        quantity: o.quantity == null ? null : Number(o.quantity),
        rate: o.rate == null ? null : Number(o.rate),
        amount,
        direction,
        signed: direction === 'out' ? round2(-amount) : (direction === 'in' ? amount : 0),
        category: o.category || '',
        status: o.status || '',
        record_table: o.table || '',
        record_id: o.id == null ? null : o.id,
        edit_page: o.page !== undefined ? o.page : (EDIT_PAGES[o.table] || '')
    };
}

function sumRows(rows, mode) {
    return round2(rows.reduce((s, r) => s + (mode === 'signed' ? r.signed : r.amount), 0));
}

// ══════════════════════════════════════════════════════════════
// Cash and bank movement rows (the report's own cash/bank composition)
// ══════════════════════════════════════════════════════════════

/** Cash movement rows between two BS dates, matching getCashBankPosition(). */
function cashRows(db, from, to) {
    const rows = [];

    for (const r of db.prepare(`
        SELECT s.id, s.date, s.invoice_no, p.name AS party, s.grand_total, s.paid_amount, s.status
          FROM sales s LEFT JOIN parties p ON p.id = s.party_id
         WHERE s.date >= ? AND s.date <= ? AND LOWER(s.payment_mode) = 'cash'
           AND NOT EXISTS (SELECT 1 FROM payments pp WHERE pp.reference_type = 'sale' AND pp.reference_id = s.id)
         ORDER BY s.date, s.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.invoice_no, party: r.party,
            description: 'Cash sale — money received at the counter',
            amount: r.paid_amount, direction: 'in', category: 'Cash in · counter sales',
            status: r.status, table: 'sales', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.mode, pm.reference_type, pm.reference_id,
               pm.notes, pm.transaction_type, p.name AS party
          FROM payments pm LEFT JOIN parties p ON p.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ? AND pm.type = 'receipt'
           AND LOWER(COALESCE(pm.mode, 'cash')) = 'cash'
         ORDER BY pm.date, pm.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: `RC-${r.id}`, party: r.party,
            description: r.notes || 'Cash received',
            amount: r.amount, direction: 'in', category: 'Cash in · receipts',
            status: r.transaction_type || '', table: 'payments', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.type, pm.mode, pm.notes,
               pm.transaction_type, p.name AS party
          FROM payments pm LEFT JOIN parties p ON p.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ? AND pm.type IN ('payment', 'advance')
           AND LOWER(COALESCE(pm.mode, 'cash')) = 'cash'
         ORDER BY pm.date, pm.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: `${r.type === 'advance' ? 'ADV' : 'PV'}-${r.id}`, party: r.party,
            description: r.notes || (r.type === 'advance' ? 'Advance paid' : 'Payment made'),
            amount: r.amount, direction: 'out', category: 'Cash out · payments & advances',
            status: r.transaction_type || '', table: 'payments', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT oe.id, oe.date, oe.amount, oe.category, oe.expense_head, oe.description,
               oe.paid_to, oe.reference_no
          FROM other_expenses oe
         WHERE oe.date >= ? AND oe.date <= ? AND LOWER(COALESCE(oe.payment_mode, 'cash')) = 'cash'
         ORDER BY oe.date, oe.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.reference_no || `EX-${r.id}`, party: r.paid_to,
            description: r.description || r.expense_head || r.category,
            amount: r.amount, direction: 'out', category: 'Cash out · expenses',
            status: r.category, table: 'other_expenses', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT pc.id, pc.date, pc.amount, pc.expense_head, pc.description, pc.paid_to, pc.voucher_no
          FROM petty_cash pc
         WHERE pc.date >= ? AND pc.date <= ?
           AND UPPER(TRIM(COALESCE(pc.expense_head, ''))) != 'ADVANCE'
         ORDER BY pc.date, pc.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.voucher_no || `PC-${r.id}`, party: r.paid_to,
            description: r.description || r.expense_head,
            amount: r.amount, direction: 'out', category: 'Cash out · petty cash',
            status: r.expense_head, table: 'petty_cash', id: r.id
        }));
    }

    // Cash banked: the deposit register and statement transfers that are not a
    // duplicate of one (same rule as getCashBankPosition).
    const depositRefs = new Set(
        db.prepare('SELECT deposit_no, reference_no FROM cash_deposits WHERE date >= ? AND date <= ?')
            .all(from, to)
            .flatMap(r => [String(r.deposit_no || '').trim(), String(r.reference_no || '').trim()])
            .filter(Boolean)
    );
    for (const r of db.prepare(`
        SELECT cd.id, cd.date, cd.deposit_no, cd.amount, cd.bank_name, cd.reference_no
          FROM cash_deposits cd WHERE cd.date >= ? AND cd.date <= ? ORDER BY cd.date, cd.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.deposit_no || `CD-${r.id}`, party: r.bank_name,
            description: 'Cash deposited into the bank (not an expense)',
            amount: r.amount, direction: 'out', category: 'Cash out · deposited to bank',
            table: 'cash_deposits', id: r.id
        }));
    }
    for (const r of bankClassified(db, from, to).filter(b => b.is_transfer)) {
        const ref = String(r.reference_no || '').trim();
        const credit = round2(Number(r.credit) || 0);
        if (!credit || (ref && depositRefs.has(ref))) continue; // deposit already listed above
        rows.push(makeRow({
            date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
            description: r.description || 'Bank statement cash deposit',
            amount: credit, direction: 'out', category: 'Cash out · deposited to bank (statement)',
            table: 'bank_transactions', id: r.id
        }));
    }

    return rows;
}

/** Bank movement rows between two BS dates, matching getCashBankPosition(). */
function bankRows(db, from, to) {
    const rows = [];
    const classified = bankClassified(db, from, to);
    const depositRefs = new Set(
        db.prepare('SELECT deposit_no, reference_no FROM cash_deposits WHERE date >= ? AND date <= ?')
            .all(from, to)
            .flatMap(r => [String(r.deposit_no || '').trim(), String(r.reference_no || '').trim()])
            .filter(Boolean)
    );

    for (const r of classified) {
        const debit = round2(Number(r.debit) || 0);
        const credit = round2(Number(r.credit) || 0);
        if (r.is_transfer) {
            const ref = String(r.reference_no || '').trim();
            if (credit && !(ref && depositRefs.has(ref))) {
                rows.push(makeRow({
                    date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
                    description: r.description || 'Cash deposited into the bank',
                    amount: credit, direction: 'in', category: 'Bank in · cash deposit',
                    table: 'bank_transactions', id: r.id
                }));
            }
            if (debit) {
                rows.push(makeRow({
                    date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
                    description: r.description || 'Bank transfer out',
                    amount: debit, direction: 'out', category: 'Bank out · transfer',
                    table: 'bank_transactions', id: r.id
                }));
            }
            continue;
        }
        if (r.is_expense && debit) {
            rows.push(makeRow({
                date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
                description: r.description || 'Expense paid from the bank',
                amount: debit, direction: 'out', category: 'Bank out · expense',
                table: 'bank_transactions', id: r.id
            }));
            continue;
        }
        if (credit) {
            rows.push(makeRow({
                date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
                description: r.description || 'Money received into the bank',
                amount: credit, direction: 'in',
                category: r.accounting_class === 'customer_receipt' ? 'Bank in · customer receipt' : 'Bank in',
                table: 'bank_transactions', id: r.id
            }));
        }
        if (debit) {
            rows.push(makeRow({
                date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
                description: r.description || 'Payment from the bank',
                amount: debit, direction: 'out',
                category: r.accounting_class === 'supplier_payment' ? 'Bank out · supplier payment' : 'Bank out',
                table: 'bank_transactions', id: r.id
            }));
        }
    }

    // Statement duplicates must not be counted twice (D10): a payment carrying
    // bank_txn_id IS that statement row.
    const bankRowIds = new Set(classified.map(r => r.id));
    const bankRefs = new Set(classified.map(r => String(r.reference_no || '').trim()).filter(Boolean));

    for (const r of db.prepare(`
        SELECT cd.id, cd.date, cd.deposit_no, cd.amount, cd.bank_name
          FROM cash_deposits cd WHERE cd.date >= ? AND cd.date <= ? ORDER BY cd.date, cd.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.deposit_no || `CD-${r.id}`, party: r.bank_name,
            description: 'Cash deposited into the bank',
            amount: r.amount, direction: 'in', category: 'Bank in · cash deposit',
            table: 'cash_deposits', id: r.id
        }));
    }

    const docs = db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.type, pm.mode, pm.reference_type, pm.notes,
               pm.bank_txn_id, pm.transaction_type, p.name AS party
          FROM payments pm LEFT JOIN parties p ON p.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND LOWER(COALESCE(pm.mode, 'cash')) IN ('bank', 'upi', 'cheque')
         ORDER BY pm.date, pm.id`).all(from, to);
    for (const r of docs) {
        const duplicate = (r.bank_txn_id && bankRowIds.has(r.bank_txn_id))
            || bankRefs.has(String(r.reference_type || '').trim());
        if (duplicate) continue; // already on the statement
        const isIn = r.type === 'receipt';
        rows.push(makeRow({
            date: r.date, voucher: `${isIn ? 'RC' : 'PV'}-${r.id}`, party: r.party,
            description: r.notes || (isIn ? 'Receipt into the bank (no statement row yet)' : 'Payment from the bank (no statement row yet)'),
            amount: r.amount, direction: isIn ? 'in' : 'out',
            category: isIn ? 'Bank in · receipt document' : 'Bank out · payment document',
            status: r.transaction_type || '', table: 'payments', id: r.id
        }));
    }

    return rows;
}

function bankClassified(db, from, to) {
    return accounting.listClassifiedBankRows(db, { from_date: from, to_date: to }) || [];
}

// ══════════════════════════════════════════════════════════════
// Income, purchases, expenses
// ══════════════════════════════════════════════════════════════

function salesRows(db, from, to) {
    return db.prepare(`
        SELECT s.id, s.invoice_no, s.date, s.grand_total, s.status, s.payment_mode,
               p.name AS party
          FROM sales s LEFT JOIN parties p ON p.id = s.party_id
         WHERE s.date >= ? AND s.date <= ?
           AND UPPER(COALESCE(s.invoice_no, '')) NOT LIKE 'OPN-%'
         ORDER BY s.date, s.id`).all(from, to).map(r => makeRow({
        date: r.date, voucher: r.invoice_no, party: r.party,
        description: 'Sales invoice', amount: r.grand_total, direction: 'in',
        category: `Sales · ${r.payment_mode || 'cash'}`, status: r.status,
        table: 'sales', id: r.id
    }));
}

function milkRows(db, from, to) {
    return db.prepare(`
        SELECT mc.id, mc.collection_no, mc.date, mc.quantity_liters, mc.rate, mc.amount,
               mc.status, mc.shift, mc.milk_type, p.name AS party
          FROM milk_collections mc LEFT JOIN parties p ON p.id = mc.party_id
         WHERE mc.date >= ? AND mc.date <= ?
         ORDER BY mc.date, mc.id`).all(from, to).map(r => makeRow({
        date: r.date, voucher: r.collection_no, party: r.party,
        description: `Milk collection · ${r.shift || ''} ${r.milk_type || ''}`.trim(),
        quantity: r.quantity_liters, rate: r.rate, amount: r.amount,
        direction: 'out', category: 'Milk procurement', status: r.status,
        table: 'milk_collections', id: r.id
    }));
}

/**
 * Non-milk purchases: per bill, grand total minus the milk it carries (linked
 * collections + milk lines with no link), exactly as getMilkCostSummary().
 * Opening-balance bills (`OPN…`) are brought forward, not period purchases.
 */
function purchaseRows(db, from, to) {
    const linkedByBill = accounting.getLinkedMilkByBill(db, { from_date: from, to_date: to });
    const unlinkedByBill = new Map();
    for (const it of db.prepare(`
        SELECT pi.purchase_id, pi.product_name, pi.amount
          FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
         WHERE p.date >= ? AND p.date <= ?
           AND NOT EXISTS (SELECT 1 FROM milk_collections mc WHERE mc.purchase_ref_id = p.id)`)
        .all(from, to)) {
        if (!accounting.detectMilkLine(it.product_name)) continue;
        unlinkedByBill.set(it.purchase_id,
            round2((unlinkedByBill.get(it.purchase_id) || 0) + round2(it.amount)));
    }

    const bills = db.prepare(`
        SELECT p.id, p.bill_no, p.date, p.grand_total, p.status, p.payment_mode, pt.name AS party
          FROM purchases p LEFT JOIN parties pt ON pt.id = p.party_id
         WHERE p.date >= ? AND p.date <= ? ORDER BY p.date, p.id`).all(from, to);

    const openingTotal = round2(bills
        .filter(b => String(b.bill_no || '').toUpperCase().startsWith('OPN'))
        .reduce((s, b) => s + (Number(b.grand_total) || 0), 0));
    let openingAllowance = openingTotal; // capped to the non-milk value below

    const rows = [];
    for (const b of bills) {
        const value = round2((Number(b.grand_total) || 0)
            - (linkedByBill.get(b.id) || 0) - (unlinkedByBill.get(b.id) || 0));
        if (value <= 0.005) continue;
        const isOpening = String(b.bill_no || '').toUpperCase().startsWith('OPN');
        let amount = value;
        let excluded = 0;
        if (openingAllowance > 0.005 && isOpening) {
            excluded = round2(Math.min(value, openingAllowance));
            openingAllowance = round2(openingAllowance - excluded);
            amount = round2(value - excluded);
        }
        rows.push(makeRow({
            date: b.date, voucher: b.bill_no, party: b.party,
            description: excluded
                ? 'Purchase bill — opening-balance document (brought forward, not expensed)'
                : 'Purchase bill (non-milk value)',
            amount, direction: 'out',
            category: excluded ? 'Excluded · opening balance' : 'Other purchases',
            status: b.status, table: 'purchases', id: b.id
        }));
    }
    return rows.filter(r => r.amount > 0.005 || r.category.startsWith('Excluded'));
}

function otherIncomeRows(db, from, to) {
    const rows = [];
    for (const r of db.prepare(`
        SELECT oe.id, oe.date, oe.amount, oe.expense_head, oe.category, oe.description, oe.reference_no
          FROM other_expenses oe
         WHERE oe.date >= ? AND oe.date <= ? AND oe.category = 'Income'
         ORDER BY oe.date, oe.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.reference_no || `IN-${r.id}`, party: '',
            description: r.description || r.expense_head || 'Non-sales income',
            amount: r.amount, direction: 'in', category: 'Other income · income register',
            table: 'other_expenses', id: r.id
        }));
    }
    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.transaction_type, pm.notes, p.name AS party
          FROM payments pm LEFT JOIN parties p ON p.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND pm.transaction_type IN ('interest_income', 'other_income')
         ORDER BY pm.date, pm.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: `RC-${r.id}`, party: r.party,
            description: r.notes || 'Income received',
            amount: r.amount, direction: 'in', category: `Other income · ${r.transaction_type}`,
            status: r.transaction_type, table: 'payments', id: r.id
        }));
    }
    return rows;
}

function expenseRows(db, from, to) {
    const rows = [];

    for (const r of db.prepare(`
        SELECT oe.id, oe.date, oe.amount, oe.category, oe.expense_head, oe.description,
               oe.paid_to, oe.reference_no, oe.payment_mode
          FROM other_expenses oe
         WHERE oe.date >= ? AND oe.date <= ? AND oe.category != 'Income'
         ORDER BY oe.date, oe.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.reference_no || `EX-${r.id}`, party: r.paid_to,
            description: r.description || r.expense_head || r.category,
            amount: r.amount, direction: 'out',
            category: mr.classifyExpenseHead(`${r.expense_head || ''} ${r.description || ''}`),
            status: r.payment_mode, table: 'other_expenses', id: r.id
        }));
    }

    // NOTE: not aliased — accounting.PETTY_DUPLICATE_SQL refers to the table by
    // its full name (petty_cash.expense_head …), exactly like the report does.
    for (const r of db.prepare(`
        SELECT petty_cash.id, petty_cash.date, petty_cash.amount, petty_cash.expense_head,
               petty_cash.description, petty_cash.paid_to, petty_cash.voucher_no
          FROM petty_cash
         WHERE petty_cash.date >= ? AND petty_cash.date <= ?
           AND UPPER(TRIM(COALESCE(petty_cash.expense_head, ''))) != 'ADVANCE'
           AND NOT ${accounting.PETTY_DUPLICATE_SQL}
         ORDER BY petty_cash.date, petty_cash.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: r.voucher_no || `PC-${r.id}`, party: r.paid_to,
            description: r.description || r.expense_head,
            amount: r.amount, direction: 'out',
            category: mr.classifyExpenseHead(`${r.expense_head || ''} ${r.description || ''}`),
            status: 'petty cash', table: 'petty_cash', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT sr.id, sr.payment_date, sr.net_salary, sr.employee_name, sr.month, sr.voucher_no, sr.payment_mode
          FROM salary_records sr WHERE sr.payment_date >= ? AND sr.payment_date <= ?
         ORDER BY sr.payment_date, sr.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.payment_date, voucher: r.voucher_no || `SAL-${r.id}`, party: r.employee_name,
            description: `Salary for ${r.month}`,
            amount: r.net_salary, direction: 'out', category: 'Salaries and Wages',
            status: r.payment_mode, table: 'salary_records', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT ve.id, ve.date, ve.total_amount, ve.vehicle_name, ve.driver_name, ve.expense_type
          FROM vehicle_expenses ve WHERE ve.date >= ? AND ve.date <= ?
         ORDER BY ve.date, ve.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: `VE-${r.id}`, party: r.vehicle_name,
            description: `Vehicle expense · ${r.expense_type || 'other'}${r.driver_name ? ' · ' + r.driver_name : ''}`,
            amount: r.total_amount, direction: 'out', category: 'Vehicle Expenses',
            status: r.expense_type, table: 'vehicle_expenses', id: r.id
        }));
    }

    const opEx = accounting.getExpenseSummary(db, { from_date: from, to_date: to });
    for (const r of opEx.bank_expense_rows || []) {
        rows.push(makeRow({
            date: r.date, voucher: r.reference_no || `BT-${r.id}`, party: r.counterparty_name,
            description: r.description || 'Expense paid from the bank',
            amount: r.amount, direction: 'out',
            category: mr.classifyExpenseHead(`${r.description || ''} ${r.reference_no || ''}`),
            status: 'bank', table: 'bank_transactions', id: r.id
        }));
    }

    for (const r of db.prepare(`
        SELECT pm.id, pm.date, pm.amount, pm.transaction_type, pm.notes, p.name AS party
          FROM payments pm LEFT JOIN parties p ON p.id = pm.party_id
         WHERE pm.date >= ? AND pm.date <= ?
           AND pm.transaction_type IN ('actual_expense', 'advance_adjustment')
         ORDER BY pm.date, pm.id`).all(from, to)) {
        rows.push(makeRow({
            date: r.date, voucher: `PV-${r.id}`, party: r.party,
            description: r.notes || 'Expense typed on a payment',
            amount: r.amount, direction: 'out', category: 'Other Operating Expenses',
            status: r.transaction_type, table: 'payments', id: r.id
        }));
    }

    // Prepaid rent used up in the period — an accounting recognition, not a
    // payment; the payment itself sits in the Prepaid rent line (an asset).
    const prep = prepaid.getPrepaidSummary(db, { from_date: from, to_date: to });
    for (const rec of (prep.records || [])) {
        if (!rec.period_expense) continue;
        rows.push(makeRow({
            date: to, voucher: `PP-${rec.id}`, party: rec.party_name || rec.name,
            description: `${rec.name || 'Prepaid item'} — the part of this prepayment used up in the period `
                + `(${rec.start_month_label} onwards); recognised month by month, not on the payment date`,
            amount: rec.period_expense, direction: 'out', category: 'Factory Rent',
            status: 'prepaid recognition', table: 'prepaid_expenses', id: rec.id
        }));
    }
    if (prep.other_prepaid_expense) {
        rows.push(makeRow({
            date: to, voucher: '', party: '',
            description: 'Other prepaid expense used up in this period',
            amount: prep.other_prepaid_expense, direction: 'out',
            category: 'Other Operating Expenses', status: 'prepaid recognition',
            table: 'prepaid_expenses', id: null
        }));
    }

    return rows;
}

// ══════════════════════════════════════════════════════════════
// Balances
// ══════════════════════════════════════════════════════════════

function inventoryRows(balances) {
    const rows = (balances.inventory_lines || []).map(l => makeRow({
        date: balances.as_of, voucher: '', party: l.product_name,
        description: 'Closing quantity × master rate',
        quantity: l.quantity, rate: l.rate, amount: l.value,
        direction: 'neutral', category: 'Stock valuation', status: l.unit,
        table: 'stock_movements', id: l.product_id, page: 'stock', sheet: 'Stock'
    }));
    for (const l of (balances.negative_stock_lines || [])) {
        rows.push(makeRow({
            date: balances.as_of, voucher: '', party: l.product_name,
            description: 'NEGATIVE closing stock — more sold/used than the ledger ever brought in. Not valued.',
            quantity: l.quantity, rate: 0, amount: 0,
            direction: 'neutral', category: 'Stock gap (audit defect)', status: l.unit,
            table: 'stock_movements', id: l.product_id, page: 'stock', sheet: 'Stock'
        }));
    }
    return rows;
}

function partyBalanceRows(db, asOf) {
    return db.prepare(`
        SELECT p.id, p.name, p.type,
               (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS balance
          FROM parties p
          LEFT JOIN ledger_entries le ON le.party_id = p.id AND le.date <= ?
         GROUP BY p.id
         ORDER BY p.name`).all(asOf).map(r => makeRow({
        date: asOf, voucher: `P-${r.id}`, party: r.name,
        description: 'Party ledger balance at this date',
        amount: Math.abs(round2(r.balance)), direction: 'neutral',
        category: r.type || '', status: round2(r.balance) > 0 ? 'owes us' : 'we owe',
        table: 'parties', id: r.id, sheet: 'Party Master'
    }));
}

function loanAdvanceRows(db, asOf) {
    const tagMap = {
        [accounting.ACCOUNT.ADVANCE_RECEIVABLE]: 'advances',
        [accounting.ACCOUNT.LOAN_RECEIVABLE]: 'loan_receivable',
        [accounting.ACCOUNT.LOAN_PAYABLE]: 'loan_payable'
    };
    const out = { advances: [], loan_receivable: [], loan_payable: [] };
    for (const [tag, key] of Object.entries(tagMap)) {
        const rows = db.prepare(`
            SELECT le.id, le.date, le.description, le.debit, le.credit, p.name AS party
              FROM ledger_entries le LEFT JOIN parties p ON p.id = le.party_id
             WHERE le.description LIKE ? AND le.date <= ?
             ORDER BY le.date, le.id`).all(`%[${tag}]%`, asOf);
        for (const r of rows) {
            // getLoanAdvanceBalances() sums debit − credit for the advance and
            // loan-receivable tags, and negates it for loan payable.
            const signed = key === 'loan_payable'
                ? round2((Number(r.credit) || 0) - (Number(r.debit) || 0))
                : round2((Number(r.debit) || 0) - (Number(r.credit) || 0));
            out[key].push(makeRow({
                date: r.date, voucher: `LE-${r.id}`, party: r.party,
                description: r.description || 'Ledger entry',
                amount: Math.abs(signed),
                direction: signed < 0 ? 'out' : 'in',
                category: key, status: key, table: 'ledger_entries', id: r.id,
                page: 'advances', sheet: 'Party Master'
            }));
        }
    }
    return out;
}

function prepaidRows(db, asOf) {
    // One recognition pass up to `asOf`: prepaid_balance is the unused part.
    const summary = prepaid.getPrepaidSummary(db, { from_date: '2000-01-01', to_date: asOf });
    return (summary.records || [])
        .filter(rec => String(rec.payment_date) <= String(asOf))
        .map(rec => makeRow({
            date: rec.payment_date, voucher: `PP-${rec.id}`, party: rec.party_name || rec.name,
            description: `${rec.name || 'Prepaid payment'} — ${rec.amount} paid for ${rec.months} month(s) `
                + `from ${rec.start_month_label}; ${rec.recognized_to_date} used up, `
                + `${rec.prepaid_balance} still an asset`,
            amount: rec.prepaid_balance, direction: 'neutral', category: rec.name || 'Prepaid',
            status: rec.prepaid_balance > 0.005 ? 'unused (asset)' : 'fully used',
            table: 'prepaid_expenses', id: rec.id
        }));
}

// ══════════════════════════════════════════════════════════════
// The resolver
// ══════════════════════════════════════════════════════════════

/**
 * Detail for one Monthly Report line.
 *
 * @param {object} db
 * @param {object} opts
 *   line        one of LINES keys (required)
 *   month       BS 'YYYY-MM' (wins over from/to)
 *   from_date   BS start (used when the report is a custom range)
 *   to_date     BS end
 *   filters     { party, category, type, from, to } — applied to the row list only
 * @returns {object}
 */
function getMonthlyReportLine(db, opts = {}) {
    const key = String(opts.line || '').trim();
    const meta = LINES[key];
    if (!meta) {
        throw new Error(`Unknown Monthly Report line: "${key}"`);
    }

    // ── Resolve the SAME period the report used ──
    let from, to;
    if (opts.month) {
        const r = bs.bsMonthRange(opts.month);
        if (!r) throw new Error('Month must be a valid BS month (YYYY-MM)');
        from = r.from_date; to = r.to_date;
    } else {
        from = opts.from_date || bs.todayBSDate();
        to = opts.to_date || from;
        const check = bs.validateBSRange(from, to);
        if (!check.valid) throw new Error(check.reason);
        from = check.from_date; to = check.to_date;
    }

    const report = mr.getMonthlyReport(db, { from_date: from, to_date: to });
    const activity = report.activity;
    const opening = mr.getBalancesAsOf(db, bs.addBSDays(from, -1));
    const closing = report.balances_asof;

    // The figure exactly as the report shows it — never recalculated here.
    const reported = Number(report.summary[key]) || 0;
    const s = report.summary;

    let rows = [];
    let formula = [];
    let sumMode = 'absolute';
    let scopeNote = '';
    let window = { from_date: from, to_date: to };

    switch (key) {
        // ── Cash ──
        case 'opening_cash': {
            window = { from_date: '2000-01-01', to_date: bs.addBSDays(from, -1) };
            rows = cashRows(db, window.from_date, window.to_date);
            sumMode = 'signed';
            const cb = opening.cash_bank_detail.cash;
            formula = [
                { label: 'Money into the till (counter cash sales + receipts)', amount: cb.total_in },
                { label: 'Money out of the till (payments, expenses, petty cash, bank deposits)', amount: round2(-cb.total_out) }
            ];
            scopeNote = 'A balance, so the rows cover everything from the start of the books to the day before the period — '
                + 'not just this period. Each row is a cash document.';
            break;
        }
        case 'closing_cash': {
            window = { from_date: '2000-01-01', to_date: to };
            rows = cashRows(db, window.from_date, window.to_date);
            sumMode = 'signed';
            const cb = closing.cash_bank_detail.cash;
            formula = [
                { label: 'Money into the till (counter cash sales + receipts)', amount: cb.total_in },
                { label: 'Money out of the till (payments, expenses, petty cash, bank deposits)', amount: round2(-cb.total_out) }
            ];
            scopeNote = 'Closing cash is a cumulative balance from the start of the books to the period end. '
                + 'A missing cash document shows up here as a difference against the physical count.';
            break;
        }

        // ── Bank ──
        case 'opening_bank':
        case 'closing_bank': {
            const asOf = key === 'opening_bank' ? bs.addBSDays(from, -1) : to;
            window = { from_date: '2000-01-01', to_date: asOf };
            rows = bankRows(db, window.from_date, window.to_date);
            sumMode = 'signed';
            const cb = (key === 'opening_bank' ? opening : closing).cash_bank_detail.bank;
            formula = [
                { label: 'Money into the bank (customer receipts, cash deposits, receipt documents)', amount: cb.total_in },
                { label: 'Money out of the bank (supplier payments, expenses, transfers, payment documents)', amount: round2(-cb.total_out) }
            ];
            scopeNote = 'A balance, so the rows cover everything from the start of the books to that date. '
                + 'A cash deposit appears as money out of the till and money into the bank — it is a transfer, never income.';
            break;
        }

        // ── Inventory ──
        case 'opening_inventory':
        case 'closing_inventory': {
            const bals = key === 'opening_inventory' ? opening : closing;
            rows = inventoryRows(bals);
            formula = [{
                label: `${bals.inventory_basis}`,
                amount: bals.inventory_value
            }];
            scopeNote = 'Stock is valued quantity × master rate (the workbook has no lot costs). '
                + 'A negative quantity is listed as a stock gap and is never valued.';
            break;
        }

        // ── Income ──
        case 'sales_revenue':
            rows = salesRows(db, from, to);
            formula = [
                { label: 'Sales invoices in the period (OPN-… opening documents excluded)', amount: s.sales_revenue },
                { label: 'Opening-balance documents, reported as receivables instead', amount: activity.opening_balance_documents }
            ];
            scopeNote = 'An OPN-… invoice is money a customer already owed when the books opened. It is a receivable, not revenue.';
            break;

        case 'other_income':
            rows = otherIncomeRows(db, from, to);
            formula = [{ label: 'Income in the income register + payments typed as income', amount: s.other_income }];
            scopeNote = 'Money received from a customer settling an invoice is NOT income here — the sale was already counted.';
            break;

        case 'total_income':
            rows = [...salesRows(db, from, to), ...otherIncomeRows(db, from, to)];
            formula = [
                { label: 'Sales Revenue', amount: s.sales_revenue },
                { label: '+ Other Income', amount: s.other_income }
            ];
            scopeNote = 'Total income is the two lines above added together. Nothing else is income.';
            break;

        // ── Cost of goods sold ──
        case 'milk_cost':
            rows = milkRows(db, from, to);
            formula = [
                {
                    label: 'Milk collections in the period',
                    amount: round2(activity.cogs_detail.milk_cost - activity.cogs_detail.unlinked_milk_lines)
                },
                { label: 'Milk lines on purchase bills with no collection link', amount: activity.cogs_detail.unlinked_milk_lines }
            ];
            scopeNote = 'Milk Collection is the source. The milk part of a linked purchase bill is removed from purchases, '
                + 'so the same milk is never bought twice.';
            break;

        case 'other_purchases':
            rows = purchaseRows(db, from, to);
            formula = [
                { label: 'Non-milk value of purchase bills in the period', amount: activity.cogs_detail.other_purchases },
                { label: 'Opening-balance purchase documents (brought forward, not expensed)', amount: activity.cogs_detail.opening_purchase_documents }
            ];
            scopeNote = 'Each bill contributes its grand total minus the milk it carries. `OPN…` bills are opening balances.';
            break;

        case 'cogs':
            rows = [...milkRows(db, from, to), ...purchaseRows(db, from, to).filter(r => !r.category.startsWith('Excluded'))];
            formula = [
                { label: 'Milk Procurement Cost', amount: s.milk_cost },
                { label: '+ Other Purchases', amount: s.other_purchases }
            ];
            scopeNote = 'Cost of goods sold is milk plus the non-milk part of purchases. Stock on hand is NOT an expense.';
            break;

        case 'gross_profit':
            rows = [...salesRows(db, from, to), ...milkRows(db, from, to),
                ...purchaseRows(db, from, to).filter(r => !r.category.startsWith('Excluded'))];
            formula = [
                { label: 'Sales Revenue', amount: s.sales_revenue },
                { label: '− Cost of Goods Sold', amount: round2(-s.cogs) }
            ];
            scopeNote = 'Gross profit is sales minus the cost of what was sold — before rent, salary, electricity and other running costs.';
            break;

        // ── Operating expenses ──
        case 'total_operating_expenses':
            rows = expenseRows(db, from, to);
            formula = Object.entries(activity.expense_sources || {})
                .filter(([k, v]) => Number(v) && !/excluded|count/.test(k))
                .map(([k, v]) => ({ label: k.replace(/_/g, ' '), amount: v }));
            scopeNote = 'Each cost is recognised once. A supplier payment that settles a purchase already in COGS is not an '
                + 'expense again, and an advance or a loan repayment is a balance-sheet movement, not an expense.';
            break;

        // ── Net profit ──
        case 'net_profit':
            rows = [...salesRows(db, from, to), ...otherIncomeRows(db, from, to),
                ...milkRows(db, from, to),
                ...purchaseRows(db, from, to).filter(r => !r.category.startsWith('Excluded')),
                ...expenseRows(db, from, to)];
            formula = [
                { label: 'Total Income', amount: s.total_income },
                { label: '− Cost of Goods Sold', amount: round2(-s.cogs) },
                { label: '− Total Operating Expenses', amount: round2(-s.total_operating_expenses) }
            ];
            scopeNote = 'Net profit is income minus the cost of goods sold minus operating expenses. '
                + 'Closing balances, loan principal repayments and advances never appear in it.';
            break;

        // ── Receivables / payables ──
        case 'receivables': {
            rows = partyBalanceRows(db, to).filter(r => r.status === 'owes us');
            formula = [{
                label: `${rows.length} customer ledger balance(s) still owed at ${to}`,
                amount: round2(rows.reduce((t, r) => t + r.amount, 0))
            }];
            scopeNote = 'Every customer whose ledger balance is a debit at the period end. Opening balances are included. '
                + 'Each row is one party\u2019s closing ledger balance, not a single invoice.';
            break;
        }
        case 'payables': {
            rows = partyBalanceRows(db, to).filter(r => r.status === 'we owe');
            formula = [{
                label: `${rows.length} supplier/farmer ledger balance(s) still to pay at ${to}`,
                amount: round2(rows.reduce((t, r) => t + r.amount, 0))
            }];
            scopeNote = 'Every supplier/farmer whose ledger balance is a credit at the period end. '
                + 'Each row is one party\u2019s closing ledger balance, not a single bill.';
            break;
        }

        // ── Advances / loans ──
        case 'advances': {
            const la = loanAdvanceRows(db, to);
            rows = la.advances;
            formula = [{ label: `${rows.length} open advance(s) at ${to}`, amount: round2(rows.reduce((t, r) => t + r.amount, 0)) }];
            scopeNote = 'Money given as an advance is an asset (they owe it back or it will be adjusted), not an expense.';
            break;
        }
        case 'loan_receivable': {
            const la = loanAdvanceRows(db, to);
            rows = la.loan_receivable;
            formula = [{ label: `${rows.length} loan(s) given out, still to collect`, amount: round2(rows.reduce((t, r) => t + r.amount, 0)) }];
            scopeNote = 'Loans this business gave out: money to be collected back, never income.';
            break;
        }
        case 'loan_payable': {
            const la = loanAdvanceRows(db, to);
            rows = la.loan_payable;
            formula = [{ label: `${rows.length} loan(s) taken, still to repay`, amount: round2(rows.reduce((t, r) => t + r.amount, 0)) }];
            scopeNote = 'Loans this business took: a liability. Repaying the principal is not an expense.';
            break;
        }

        // ── Prepaid rent ──
        case 'prepaid_rent':
            rows = prepaidRows(db, to);
            formula = [{
                label: 'Advance rent paid − rent already used up',
                amount: closing.prepaid_balance
            }];
            scopeNote = 'Advance rent is an asset until the month it is used. Only the used months reach the P&L.';
            break;

        default:
            throw new Error(`No drill-down is implemented for "${key}".`);
    }

    // ── Filters (row list only — the reported figure stays the report's) ──
    const f = opts.filters || {};
    const before = rows.length;
    let filtered = rows;
    if (f.party) {
        const needle = String(f.party).toLowerCase();
        filtered = filtered.filter(r => String(r.party || '').toLowerCase().includes(needle));
    }
    if (f.category) {
        const needle = String(f.category).toLowerCase();
        filtered = filtered.filter(r => String(r.category || '').toLowerCase().includes(needle));
    }
    if (f.type) {
        const needle = String(f.type).toLowerCase();
        filtered = filtered.filter(r =>
            String(r.source_module || '').toLowerCase().includes(needle)
            || String(r.record_table || '').toLowerCase().includes(needle));
    }
    if (f.from) filtered = filtered.filter(r => !r.date || r.date >= f.from);
    if (f.to) filtered = filtered.filter(r => !r.date || r.date <= f.to);

    // ── The check the whole drill-down exists for ──
    let detailTotal;
    if (key === 'total_income' || key === 'gross_profit' || key === 'net_profit' || key === 'cogs'
        || key === 'total_operating_expenses') {
        // Formula lines: the components ARE the evidence; the rows are the
        // transactions inside them. Compare against the components instead.
        detailTotal = round2(formula.reduce((t, c) => t + c.amount, 0));
    } else    if (sumMode === 'signed' || key === 'advances' || key === 'loan_receivable' || key === 'loan_payable') {
        detailTotal = sumRows(rows, 'signed');
    } else {
        detailTotal = sumRows(rows, 'absolute');
    }

    const difference = round2(detailTotal - reported);
    const matches = Math.abs(difference) <= TOL;

    return {
        line: key,
        label: meta.en,
        label_np: meta.np,
        basis: meta.basis,
        from_date: from,
        to_date: to,
        window,
        reported: round2(reported),
        detail_total: detailTotal,
        difference,
        matches,
        flagged: !matches,
        flag_reason: matches ? '' : (
            `The source records add up to ${detailTotal} but the report shows ${reported} `
            + `(difference ${difference}). Treat this line as an audit defect until the `
            + 'difference is explained — do not rely on either number.'
        ),
        sum_mode: sumMode,
        formula,
        rows: filtered,
        row_count: filtered.length,
        total_rows_before_filters: before,
        filters_applied: f,
        scope_note: scopeNote,
        source_sheets: [...new Set(filtered.map(r => r.source_sheet).filter(Boolean))],
        data_window: report.data_window
    };
}

/** Every line the UI may offer, in report order. */
function listLines() {
    return Object.keys(LINES).map(key => ({
        key, label: LINES[key].en, label_np: LINES[key].np, basis: LINES[key].basis
    }));
}

module.exports = { getMonthlyReportLine, listLines, LINES, SOURCE_SHEETS };
