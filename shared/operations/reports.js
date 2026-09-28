/**
 * Prarambha Account & Stock Management — Report Operations
 * ========================================
 * Single source of truth for all report queries.
 * Used by both Electron (main.js) and Web (server.js).
 */

const accounting = require('./accounting');

/**
 * Attach the actual-receipts settlement (received / outstanding / status) to
 * sales rows. Status is derived from the money really received against each
 * invoice — never from a stored flag or the mere existence of a payment row —
 * so a Rs 1,000 receipt against a Rs 10,000 invoice reads Partial.
 */
function attachSettlement(db, sales) {
    if (!sales || !sales.length) return sales || [];
    const partyIds = [...new Set(sales.map(s => s.party_id).filter(v => v != null))];
    const { by_id } = accounting.getSaleSettlements(db, { party_ids: partyIds });
    return sales.map(s => {
        const st = by_id.get(Number(s.id));
        if (!st) return s;
        return {
            ...s,
            received_amount: st.received,
            outstanding_amount: st.outstanding,
            status: st.status,
            status_source: 'receipts'
        };
    });
}

/**
 * Sales report with summary total and detailed breakdown.
 */
function getSalesReport(db, { from_date, to_date, party_id, payment_mode, status } = {}) {
    let query = `SELECT s.*, p.name as party_name,
                    (SELECT COUNT(*) FROM sales_items WHERE sale_id = s.id) as item_count
                 FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND s.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND s.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND s.party_id = ?"; params.push(party_id); }
    if (payment_mode) { query += " AND s.payment_mode = ?"; params.push(payment_mode); }
    if (status) { query += " AND s.status = ?"; params.push(status); }
    query += " ORDER BY s.date ASC, s.id ASC";
    const sales = attachSettlement(db, db.prepare(query).all(...params));

    const total = sales.reduce((sum, s) => sum + s.grand_total, 0);
    const totalPaid = sales.reduce((sum, s) => sum + (s.received_amount != null ? s.received_amount : s.paid_amount), 0);
    const totalDue = sales.reduce((sum, s) => sum + (s.outstanding_amount != null ? s.outstanding_amount : (s.grand_total - s.paid_amount)), 0);
    const cashSales = sales.filter(s => s.payment_mode === 'cash').reduce((sum, s) => sum + s.grand_total, 0);
    const creditSales = sales.filter(s => s.status !== 'paid').reduce((sum, s) => sum + (s.outstanding_amount != null ? s.outstanding_amount : (s.grand_total - s.paid_amount)), 0);

    return { sales, total, totalPaid, totalDue, cashSales, creditSales, count: sales.length };
}

/**
 * Purchase report with summary total and detailed breakdown.
 */
function getPurchasesReport(db, { from_date, to_date, party_id, payment_mode, status } = {}) {
    let query = `SELECT pr.*, p.name as party_name 
                 FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pr.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pr.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND pr.party_id = ?"; params.push(party_id); }
    if (payment_mode) { query += " AND pr.payment_mode = ?"; params.push(payment_mode); }
    if (status) { query += " AND pr.status = ?"; params.push(status); }
    query += " ORDER BY pr.date ASC, pr.id ASC";
    const purchases = db.prepare(query).all(...params);

    const total = purchases.reduce((sum, p) => sum + p.grand_total, 0);
    const totalPaid = purchases.reduce((sum, p) => sum + p.paid_amount, 0);
    const totalDue = total - totalPaid;
    const cashPurchases = purchases.filter(p => p.payment_mode === 'cash').reduce((sum, p) => sum + p.grand_total, 0);
    const creditPurchases = purchases.filter(p => p.status === 'unpaid' || p.status === 'partial').reduce((sum, p) => sum + (p.grand_total - p.paid_amount), 0);

    return { purchases, total, totalPaid, totalDue, cashPurchases, creditPurchases, count: purchases.length };
}

/**
 * Daybook — all transactions for a given date range with running balance.
 */
function getDaybook(db, { from_date, to_date } = {}) {
    const from = from_date || new Date().toISOString().split('T')[0];
    const to = to_date || from;

    // Get all sales in range
    const sales = db.prepare(`
        SELECT s.*, p.name as party_name, 'sale' as type, s.invoice_no as ref_no
        FROM sales s LEFT JOIN parties p ON s.party_id = p.id 
        WHERE s.date >= ? AND s.date <= ? ORDER BY s.date, s.id
    `).all(from, to);

    // Get all purchases in range
    const purchases = db.prepare(`
        SELECT pr.*, p.name as party_name, 'purchase' as type, pr.bill_no as ref_no
        FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id 
        WHERE pr.date >= ? AND pr.date <= ? ORDER BY pr.date, pr.id
    `).all(from, to);

    // Get all payments in range
    const payments = db.prepare(`
        SELECT pm.*, p.name as party_name, 'payment' as type,
            CASE WHEN pm.type = 'receipt' THEN 'RECEIPT' ELSE 'PAYMENT' END as ref_no
        FROM payments pm LEFT JOIN parties p ON pm.party_id = p.id 
        WHERE pm.date >= ? AND pm.date <= ? ORDER BY pm.date, pm.id
    `).all(from, to);

    // Build unified daybook entries with debit/credit.
    //
    // The money side of each document comes from accounting.classifyTransaction()
    // so the direction follows the transaction type and account mapping — never
    // the label a screen happens to show. A receipt reduces the receivable
    // (credit), an advance received is money in and also reduces the receivable
    // (credit); only a payment MADE is a debit on the party's account.
    const entries = [];

    /** Attach the double-entry accounts to an entry. */
    const withAccounts = (entry, txn) => {
        const m = accounting.classifyTransaction(txn);
        entry.kind = m.kind;
        entry.debit_account = m.debit_account;
        entry.credit_account = m.credit_account;
        return entry;
    };

    // Sales: grand_total is debit (customer owes) — Receivable DR / Sales CR
    sales.forEach(s => {
        entries.push(withAccounts({
            date: s.date,
            ref_no: s.invoice_no,
            transaction_type: 'Sale',
            account: s.party_name || '',
            particulars: `Sale Invoice ${s.invoice_no}`,
            debit: s.grand_total,
            credit: 0,
            type: 'sale',
            id: s.id,
            status: s.status
        }, { type: 'sale' }));
    });

    // Purchases: grand_total is credit (we owe supplier)
    // — Purchase (non-milk) DR / Supplier Payable CR
    purchases.forEach(p => {
        entries.push(withAccounts({
            date: p.date,
            ref_no: p.bill_no,
            transaction_type: 'Purchase',
            account: p.party_name || '',
            particulars: `Purchase Bill ${p.bill_no}`,
            debit: 0,
            credit: p.grand_total,
            type: 'purchase',
            id: p.id,
            status: p.status
        }, { type: 'purchase' }));
    });

    // Customers' receipts and advances are CREDIT on the customer account
    // (Cash/Bank DR, Customer/Receivable CR); only money we paid out is a debit.
    payments.forEach(pm => {
        const isReceipt = accounting.isCustomerReceipt(pm.type);
        if (isReceipt) {
            entries.push(withAccounts({
                date: pm.date,
                ref_no: `RCPT-${pm.id}`,
                transaction_type: pm.type === 'advance' ? 'Advance Received' : 'Receipt',
                account: pm.party_name || '',
                particulars: `Payment Received (${pm.mode})`,
                debit: 0,
                credit: pm.amount,
                type: 'receipt',
                id: pm.id,
                status: 'paid'
            }, { type: pm.type, mode: pm.mode }));
        } else {
            entries.push(withAccounts({
                date: pm.date,
                ref_no: `PMT-${pm.id}`,
                transaction_type: 'Payment',
                account: pm.party_name || '',
                particulars: `Payment Made (${pm.mode})`,
                debit: pm.amount,
                credit: 0,
                type: 'payment',
                id: pm.id,
                status: 'paid'
            }, { type: 'payment', mode: pm.mode }));
        }
    });

    // Milk collections are the milk purchase itself (Farmer Payable CR).
    // When the collection was imported from a Purchase bill the bill already
    // carries the money (its grand_total), so the collection is shown as an
    // informational row with no amount — the same money is never counted twice.
    const milkCollections = db.prepare(`
        SELECT mc.*, p.name as farmer_name, pr.bill_no as purchase_bill_no
          FROM milk_collections mc
          LEFT JOIN parties p ON mc.party_id = p.id
          LEFT JOIN purchases pr ON pr.id = mc.purchase_ref_id
         WHERE mc.date >= ? AND mc.date <= ?
         ORDER BY mc.date, mc.id
    `).all(from, to);

    milkCollections.forEach(mc => {
        const linked = mc.purchase_ref_id != null;
        const amount = linked ? 0 : (mc.amount || 0);
        entries.push(withAccounts({
            date: mc.date,
            ref_no: mc.collection_no,
            transaction_type: 'Milk Collection',
            account: mc.farmer_name || '',
            particulars: linked
                ? `Milk ${mc.quantity_liters || 0} L — included in Purchase ${mc.purchase_bill_no || ('#' + mc.purchase_ref_id)}`
                : `Milk Collection ${mc.quantity_liters || 0} L (${mc.shift || ''})`,
            debit: 0,
            credit: amount,
            type: 'milk_collection',
            id: mc.id,
            status: mc.status,
            represented_by_purchase: linked,
            amount: mc.amount || 0
        }, { type: 'milk_collection' }));
    });

    // Get all petty cash in range
    const pettyCash = db.prepare(`
        SELECT pc.*, 'petty_cash' as type, pc.voucher_no as ref_no
        FROM petty_cash pc
        WHERE pc.date >= ? AND pc.date <= ? ORDER BY pc.date, pc.id
    `).all(from, to);

    // Get all other expenses in range
    const otherExpenses = db.prepare(`
        SELECT oe.*, 'expense' as type, oe.reference_no as ref_no
        FROM other_expenses oe
        WHERE oe.date >= ? AND oe.date <= ? ORDER BY oe.date, oe.id
    `).all(from, to);

    // Get all vehicle expenses in range
    const vehicleExpenses = db.prepare(`
        SELECT ve.*, 'vehicle_expense' as type
        FROM vehicle_expenses ve
        WHERE ve.date >= ? AND ve.date <= ? ORDER BY ve.date, ve.id
    `).all(from, to);

    // Petty cash entries: Expense DR / Cash-Bank CR (shown on the debit side)
    pettyCash.forEach(pc => {
        entries.push(withAccounts({
            date: pc.date,
            ref_no: pc.voucher_no,
            transaction_type: 'Petty Cash',
            account: pc.paid_to || pc.expense_head,
            particulars: `Petty: ${pc.expense_head}${pc.description ? ' - ' + pc.description : ''}`,
            debit: pc.amount,
            credit: 0,
            type: 'petty_cash',
            id: pc.id,
            status: 'paid'
        }, { type: 'petty_cash', mode: pc.payment_mode }));
    });

    // Other expenses: Expense DR / Cash-Bank-Payable CR (debit side)
    otherExpenses.forEach(oe => {
        entries.push(withAccounts({
            date: oe.date,
            ref_no: oe.reference_no || `EXP-${oe.id}`,
            transaction_type: 'Expense',
            account: oe.category,
            particulars: `${oe.expense_head}${oe.description ? ' - ' + oe.description : ''}`,
            debit: oe.amount,
            credit: 0,
            type: 'expense',
            id: oe.id,
            status: 'paid'
        }, { type: 'expense', mode: oe.payment_mode }));
    });

    // Vehicle expenses: Expense DR / Cash-Bank CR (debit side)
    vehicleExpenses.forEach(ve => {
        entries.push(withAccounts({
            date: ve.date,
            ref_no: `VEH-${ve.id}`,
            transaction_type: 'Vehicle Exp',
            account: ve.vehicle_name,
            particulars: `${ve.expense_type || 'Expense'} - ${ve.driver_name ? ve.driver_name : ''}`,
            debit: ve.total_amount,
            credit: 0,
            type: 'vehicle',
            id: ve.id,
            status: 'paid'
        }, { type: 'vehicle' }));
    });

    // Sort by date, then type
    entries.sort((a, b) => a.date.localeCompare(b.date) || String(a.type).localeCompare(String(b.type)));

    const totalDebit = entries.reduce((s, e) => s + e.debit, 0);
    const totalCredit = entries.reduce((s, e) => s + e.credit, 0);

    // Milk collections already carried by a purchase bill are informational rows:
    // they are part of the milk records but their money sits on the bill.
    const milkOnBills = milkCollections.filter(mc => mc.purchase_ref_id != null);
    const milkStandalone = milkCollections.filter(mc => mc.purchase_ref_id == null);

    return {
        entries,
        totalDebit,
        totalCredit,
        net: totalDebit - totalCredit,
        from_date: from,
        to_date: to,
        sales,
        purchases,
        payments,
        totalSales: sales.reduce((s, x) => s + x.grand_total, 0),
        totalPurchases: purchases.reduce((s, x) => s + x.grand_total, 0),
        totalPayments: payments.reduce((s, x) => s + x.amount, 0),
        // Account mapping legend, so every row can be read as DR → CR.
        account_map: {
            sale: 'Customer / Receivable DR → Sales CR',
            receipt: 'Cash / Bank DR → Customer / Receivable CR',
            advance: 'Cash / Bank DR → Customer / Receivable CR',
            payment: 'Supplier / Payable DR → Cash / Bank CR',
            purchase: 'Purchase (non-milk) DR → Supplier / Payable CR',
            milk_collection: 'Milk Purchase (COGS) DR → Farmer / Payable CR',
            cash_deposit: 'Bank DR → Cash CR (transfer — not income)',
            expense: 'Office / Operating Expense DR → Cash / Bank / Payable CR'
        },
        milk: {
            collections: milkCollections.length,
            standalone_total: milkStandalone.reduce((s, m) => s + (m.amount || 0), 0),
            on_purchase_bills: milkOnBills.length,
            on_purchase_bills_total: milkOnBills.reduce((s, m) => s + (m.amount || 0), 0)
        },
        count: entries.length
    };
}

/**
 * Sales entry register — detailed sales with items summary.
 */
function getSalesRegister(db, { from_date, to_date, party_id, status } = {}) {
    let query = `SELECT s.*, p.name as party_name,
                    (SELECT group_concat(si.product_name || ' (' || si.quantity || ' ' || si.unit || ')', ', ') 
                     FROM sales_items si WHERE si.sale_id = s.id) as products_summary,
                    (SELECT COUNT(*) FROM sales_items WHERE sale_id = s.id) as item_count
                 FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND s.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND s.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND s.party_id = ?"; params.push(party_id); }
    if (status) { query += " AND s.status = ?"; params.push(status); }
    query += " ORDER BY s.date ASC, s.id ASC";
    const sales = attachSettlement(db, db.prepare(query).all(...params));

    const total = sales.reduce((sum, s) => sum + s.grand_total, 0);
    const totalPaid = sales.reduce((sum, s) => sum + (s.received_amount != null ? s.received_amount : s.paid_amount), 0);
    const totalDue = sales.reduce((sum, s) => sum + (s.outstanding_amount != null ? s.outstanding_amount : (s.grand_total - s.paid_amount)), 0);

    return { sales, total, totalPaid, totalDue, count: sales.length };
}

/**
 * Purchase entry register — detailed purchases with items summary.
 */
function getPurchaseRegister(db, { from_date, to_date, party_id, status } = {}) {
    let query = `SELECT pr.*, p.name as party_name,
                    (SELECT group_concat(pi.product_name || ' (' || pi.quantity || ' ' || pi.unit || ')', ', ') 
                     FROM purchase_items pi WHERE pi.purchase_id = pr.id) as products_summary,
                    (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = pr.id) as item_count
                 FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pr.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pr.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND pr.party_id = ?"; params.push(party_id); }
    if (status) { query += " AND pr.status = ?"; params.push(status); }
    query += " ORDER BY pr.date ASC, pr.id ASC";
    const purchases = db.prepare(query).all(...params);

    const total = purchases.reduce((sum, p) => sum + p.grand_total, 0);
    const totalPaid = purchases.reduce((sum, p) => sum + p.paid_amount, 0);
    const totalDue = total - totalPaid;

    return { purchases, total, totalPaid, totalDue, count: purchases.length };
}

/**
 * Outstanding receivables from sales.
 */
function getReceivables(db) {
    // Ledger-driven: same source as the party statement / Parties tab
    // (party_account.getPartyAccountSummary), so every view agrees.
    // balance > 0 = the party owes us (receivable).
    return db.prepare(`
        SELECT p.id, p.name, p.phone, p.opening_balance,
            (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS balance,
            CASE WHEN (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) > 0
                 THEN (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) ELSE 0 END AS outstanding
        FROM parties p
        LEFT JOIN ledger_entries le ON le.party_id = p.id
        GROUP BY p.id
        HAVING balance > 0.005
        ORDER BY balance DESC
    `).all();
}

/**
 * Outstanding payables from purchases.
 */
function getPayables(db) {
    // Ledger-driven: balance < 0 = we owe the party (payable).
    return db.prepare(`
        SELECT p.id, p.name, p.phone, p.opening_balance,
            (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) AS balance,
            CASE WHEN (p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) < 0
                 THEN -(p.opening_balance + COALESCE(SUM(le.debit), 0) - COALESCE(SUM(le.credit), 0)) ELSE 0 END AS outstanding
        FROM parties p
        LEFT JOIN ledger_entries le ON le.party_id = p.id
        GROUP BY p.id
        HAVING balance < -0.005
        ORDER BY balance ASC
    `).all();
}

/**
 * Get today's summary for dashboard.
 */
function getTodaySummary(db) {
    const today = new Date().toISOString().split('T')[0];

    const todaySales = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM sales WHERE date = ?"
    ).get(today);

    const todayPurchases = db.prepare(
        "SELECT COALESCE(SUM(grand_total), 0) as total, COALESCE(SUM(paid_amount), 0) as paid FROM purchases WHERE date = ?"
    ).get(today);

    const todayPettyCash = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM petty_cash WHERE date = ?"
    ).get(today);

    const todayExpenses = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM other_expenses WHERE date = ?"
    ).get(today);

    const todayVehicle = db.prepare(
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM vehicle_expenses WHERE date = ?"
    ).get(today);

    return {
        todaySales,
        todayPurchases,
        todayPettyCash,
        todayExpenses,
        todayVehicle,
        todayVehicleExpenses: todayVehicle
    };
}

/**
 * Farmer Statement — specialized statement with milk quality details.
 * Returns entries from milk_collections and ledger, with FAT/SNF averages.
 */
function getFarmerStatement(db, { party_id, from_date, to_date } = {}) {
    if (!party_id) throw new Error('Farmer ID is required');

    const farmer = db.prepare("SELECT * FROM parties WHERE id = ?").get(party_id);
    if (!farmer) throw new Error('Farmer not found');

    const from = from_date || '2000-01-01';
    const to = to_date || new Date().toISOString().split('T')[0];

    // Get opening balance (balance from before from_date)
    const openingEntry = db.prepare(`
        SELECT COALESCE(SUM(debit), 0) as total_debit, COALESCE(SUM(credit), 0) as total_credit
        FROM ledger_entries
        WHERE party_id = ? AND date < ?
    `).get(party_id, from);

    const openingBalance = (openingEntry.total_credit || 0) - (openingEntry.total_debit || 0) + (farmer.opening_balance || 0);

    // Get milk collections in period (these are income for the farmer = credit in ledger)
    const collections = db.prepare(`
        SELECT mc.*, r.name as route_name,
            CASE 
                WHEN mc.rate_type = 'fixed' THEN 'Fixed Rate'
                ELSE 'Formula (FAT×' || COALESCE(mc.fat_multiplier, 7.15) || ' + SNF×' || COALESCE(mc.snf_multiplier, 4.55) || ')'
            END as rate_description
        FROM milk_collections mc
        LEFT JOIN routes r ON mc.route_id = r.id
        WHERE mc.party_id = ? AND mc.date >= ? AND mc.date <= ?
        ORDER BY mc.date ASC, mc.id ASC
    `).all(party_id, from, to);

    // Get payments made to farmer in period (these reduce the balance)
    const payments = db.prepare(`
        SELECT pm.* FROM payments pm
        WHERE pm.party_id = ? AND pm.date >= ? AND pm.date <= ? AND pm.type = 'payment'
        ORDER BY pm.date ASC, pm.id ASC
    `).all(party_id, from, to);

    // Build unified entries with running balance
    const entries = [];
    let runningBalance = openingBalance;

    // Opening balance row
    entries.push({
        date: from,
        ref_no: '',
        transaction_type: 'opening',
        description: 'Opening Balance',
        quantity: 0,
        fat: 0,
        snf: 0,
        rate: 0,
        debit: 0,
        credit: 0,
        running_balance: openingBalance,
        shift: '',
        collection_no: '',
        clr: null,
        adulteration: null
    });

    // Milk collection entries: credit = amount the plant owes the farmer
    let totalQty = 0, totalFatSum = 0, totalSnfSum = 0, fatCount = 0, snfCount = 0;
    for (const mc of collections) {
        totalQty += mc.quantity_liters || 0;
        if (mc.fat_percent) { totalFatSum += mc.fat_percent; fatCount++; }
        if (mc.snf_percent) { totalSnfSum += mc.snf_percent; snfCount++; }

        runningBalance += (mc.amount || 0);
        entries.push({
            date: mc.date,
            ref_no: mc.collection_no,
            transaction_type: 'milk_collection',
            description: `Milk Collection ${mc.collection_no} (${mc.shift || ''})`,
            quantity: mc.quantity_liters || 0,
            fat: mc.fat_percent || 0,
            snf: mc.snf_percent || 0,
            rate: mc.calculated_rate || mc.rate || 0,
            rate_desc: mc.rate_description || '',
            debit: 0,
            credit: mc.amount || 0,
            running_balance: runningBalance,
            shift: mc.shift || '',
            collection_no: mc.collection_no,
            clr: mc.clr_percent || null,
            adulteration: mc.adulteration_test || null,
            route_name: mc.route_name || ''
        });
    }

    // Payment entries: debit = payment made to farmer (reduces what we owe)
    for (const pm of payments) {
        runningBalance -= (pm.amount || 0);
        entries.push({
            date: pm.date,
            ref_no: `PMT-${pm.id}`,
            transaction_type: 'payment',
            description: `Payment (${pm.mode || 'cash'})${pm.notes ? ': ' + pm.notes : ''}`,
            quantity: 0,
            fat: 0,
            snf: 0,
            rate: 0,
            debit: pm.amount || 0,
            credit: 0,
            running_balance: runningBalance,
            shift: '',
            collection_no: '',
            clr: null,
            adulteration: null
        });
    }

    // Sort by date (opening stays first)
    const sortedEntries = [entries[0], ...entries.slice(1).sort((a, b) => a.date.localeCompare(b.date) || 0)];

    const avgFat = fatCount > 0 ? totalFatSum / fatCount : 0;
    const avgSnf = snfCount > 0 ? totalSnfSum / snfCount : 0;
    const totalCredit = collections.reduce((s, c) => s + (c.amount || 0), 0);
    const totalDebit = payments.reduce((s, p) => s + (p.amount || 0), 0);
    const closingBalance = openingBalance + totalCredit - totalDebit;

    return {
        farmer,
        from_date: from,
        to_date: to,
        opening_balance: openingBalance,
        entries: sortedEntries,
        total_quantity: totalQty,
        avg_fat: avgFat,
        avg_snf: avgSnf,
        total_credit: totalCredit,
        total_debit: totalDebit,
        collection_count: collections.length,
        payment_count: payments.length,
        closing_balance: closingBalance
    };
}

module.exports = { 
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables, 
    getSalesRegister, getPurchaseRegister, getTodaySummary,
    getFarmerStatement, attachSettlement
};
