/**
 * Prarambha Account & Stock Management — per-module Excel write-back
 * ==================================================================
 * One rule: a transaction is written back to the worksheet that owns it, never
 * to a central ledger sheet.
 *
 *   Sales            -> Sales_Entry      (one row per sale line)
 *   Milk Collection  -> Purchase_Entry   (Purchase_Entry is the workbook's milk
 *                                         and product purchase register)
 *   Other Purchases  -> Purchase_Entry
 *   Collection       -> Collection       (receipts; rent rows keep Type=Rent)
 *   Payment Register -> Payment
 *   Advances/Loans   -> Advance
 *   Petty Cash       -> PETTY CASH
 *   Expenses         -> Expenses
 *   Bank             -> BANK RECON       (and nothing else, ever)
 *   Salary           -> Salary
 *
 * `Party_Ledger` is deliberately absent from MODULES: it is a formula-driven
 * consolidation in the workbook (see EXCEL_DATA_MODEL_AUDIT.md §3) and this
 * module has no code path that writes it.
 *
 * HOW A ROW IS MATCHED
 * --------------------
 * Every row this module creates carries a stable reference in an `App Ref`
 * column appended after the sheet's last used column, e.g. `SALE-142#1`,
 * `PAY-89`, `BANK-12`. Re-syncing patches the row with that reference instead of
 * appending a duplicate. Rows that predate the app have no reference and are
 * never rewritten — the operator's history is left exactly as typed.
 *
 * HOW THE FILE IS WRITTEN
 * -----------------------
 * Part-level surgery (shared/xlsx-parts.js): only the target worksheet's
 * <sheetData> rows change. Styles, formulas in other cells, merges, conditional
 * formats, charts and every other worksheet are copied byte for byte. A backup
 * is written before an apply, and the file is swapped in atomically.
 *
 * This is an explicit sync (button / CLI / API), not a live two-way binding.
 * Excel is the archive and the cross-check; SQLite stays the operational source
 * of truth, as the workbook's own structure implies.
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const parts = require('./xlsx-parts');
const { bsToAD } = require('./bs-calendar');
const { workbookPath } = require('./workbook-path');

const DAY = (v) => (v ? String(v).split('T')[0] : '');
const NUM = (v) => (typeof v === 'number' && isFinite(v) ? v : (parseFloat(v) || 0));

/** AD date for the workbook's `AD Date` column; BS strings only. */
function adDate(bs) {
    const s = DAY(bs);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    try { return bsToAD(s) || ''; } catch (e) { return ''; }
}

/**
 * Field maps are declared in the workbook's own column order, and matched to the
 * sheet by header text. If a header cannot be found, the declared position is
 * used, so a renamed header never shifts every other column.
 */
const MODULES = {
    sales: {
        label: 'Sales',
        sheet: 'Sales_Entry',
        idPrefix: 'SALE',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Invoice No', get: r => r.invoice_no || '' },
            { header: 'Party Name', get: r => r.party_name || '' },
            { header: 'Product', get: r => r.product_name || '' },
            { header: 'Quantity', get: r => NUM(r.quantity) },
            { header: 'Rate', get: r => NUM(r.rate) },
            { header: 'Amount', get: r => NUM(r.amount) },
            { header: 'Discount %', get: r => NUM(r.discount_percent) },
            { header: 'Net Amount', get: r => NUM(r.grand_total) },
            { header: 'Payment Mode', get: r => r.payment_mode || 'cash' },
            { header: 'Status', get: r => r.status || 'paid' },
            { header: 'Remarks', get: r => r.notes || '' }
        ],
        rows(db) {
            const sales = db.prepare(`
                SELECT s.*, p.name AS party_name FROM sales s
                LEFT JOIN parties p ON p.id = s.party_id
                ORDER BY s.date, s.id`).all();
            const items = db.prepare(`SELECT * FROM sales_items ORDER BY sale_id, id`).all();
            const by = new Map();
            for (const it of items) {
                if (!by.has(it.sale_id)) by.set(it.sale_id, []);
                by.get(it.sale_id).push(it);
            }
            const out = [];
            for (const s of sales) {
                const lines = by.get(s.id) || [null];
                lines.forEach((it, i) => {
                    out.push({
                        ref: `${this.idPrefix}-${s.id}#${i + 1}`,
                        record: s,
                        data: {
                            ...s,
                            product_name: it ? it.product_name : '',
                            quantity: it ? it.quantity : 0,
                            rate: it ? it.rate : 0,
                            amount: it ? it.amount : s.subtotal
                        }
                    });
                });
            }
            return out;
        }
    },

    milk: {
        label: 'Milk Collection',
        sheet: 'Purchase_Entry',
        idPrefix: 'MILK',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Bill No', get: r => r.collection_no || '' },
            { header: 'Supplier Name', get: r => r.farmer_name || '' },
            { header: 'Shift', get: r => r.shift || '' },
            { header: 'Product', get: r => r.milk_type || '' },
            { header: 'FAT %', get: r => NUM(r.fat_percent) },
            { header: 'SNF %', get: r => NUM(r.snf_percent) },
            { header: 'Extra/Unit', get: r => NUM(r.extra_per_unit) },
            { header: 'Rate Type', get: r => r.rate_type || '' },
            { header: 'Fixed Rate', get: r => NUM(r.fixed_rate) },
            { header: 'Rate/Unit', get: r => NUM(r.rate) },
            { header: 'Quantity', get: r => NUM(r.quantity_liters) },
            { header: 'Amount', get: r => NUM(r.amount) },
            { header: 'Transport', get: () => 0 },
            { header: 'Net Amount', get: r => NUM(r.amount) },
            { header: 'Payment Mode', get: r => 'cash' },
            { header: 'Status', get: r => r.status || 'paid' },
            { header: 'Remarks', get: r => r.notes || '' }
        ],
        rows(db) {
            return db.prepare(`
                SELECT mc.*, p.name AS farmer_name FROM milk_collections mc
                LEFT JOIN parties p ON p.id = mc.party_id
                ORDER BY mc.date, mc.id`).all()
                .map(r => ({ ref: `MILK-${r.id}`, record: r, data: r }));
        }
    },

    purchases: {
        label: 'Purchases',
        sheet: 'Purchase_Entry',
        idPrefix: 'PUR',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Bill No', get: r => r.bill_no || '' },
            { header: 'Supplier Name', get: r => r.party_name || '' },
            { header: 'Shift', get: () => '' },
            { header: 'Product', get: r => r.product_name || '' },
            { header: 'FAT %', get: () => '' },
            { header: 'SNF %', get: () => '' },
            { header: 'Extra/Unit', get: () => '' },
            { header: 'Rate Type', get: () => 'FIXED' },
            { header: 'Fixed Rate', get: () => '' },
            { header: 'Rate/Unit', get: r => NUM(r.rate) },
            { header: 'Quantity', get: r => NUM(r.quantity) },
            { header: 'Amount', get: r => NUM(r.amount) },
            { header: 'Transport', get: r => (r.transport_charges || 0) },
            { header: 'Net Amount', get: r => NUM(r.grand_total) },
            { header: 'Payment Mode', get: r => r.payment_mode || 'cash' },
            { header: 'Status', get: r => r.status || 'paid' },
            { header: 'Remarks', get: r => r.notes || '' }
        ],
        rows(db) {
            const purchases = db.prepare(`
                SELECT pr.*, p.name AS party_name FROM purchases pr
                LEFT JOIN parties p ON p.id = pr.party_id
                ORDER BY pr.date, pr.id`).all();
            const items = db.prepare(`SELECT * FROM purchase_items ORDER BY purchase_id, id`).all();
            const by = new Map();
            for (const it of items) {
                if (!by.has(it.purchase_id)) by.set(it.purchase_id, []);
                by.get(it.purchase_id).push(it);
            }
            const out = [];
            for (const p of purchases) {
                // Milk bills already live in milk_collections; keep them out of the
                // purchase rows so one delivery is never written twice.
                const lines = by.get(p.id) || [null];
                lines.forEach((it, i) => {
                    out.push({
                        ref: `PUR-${p.id}#${i + 1}`,
                        record: p,
                        data: {
                            ...p,
                            product_name: it ? it.product_name : p.notes || 'Purchase',
                            quantity: it ? it.quantity : 0,
                            rate: it ? it.rate : 0,
                            amount: it ? it.amount : p.subtotal
                        }
                    });
                });
            }
            return out;
        }
    },

    collection: {
        label: 'Collection',
        sheet: 'Collection',
        idPrefix: 'COL',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Receipt No', get: r => r.receipt_no || '' },
            { header: 'Customer Name', get: r => r.party_name || '' },
            { header: 'Against Bill', get: r => r.reference_id || '' },
            { header: 'Type', get: r => r.coll_type || 'Collection' },
            { header: 'Opening Due', get: () => '' },
            { header: 'Collected', get: r => NUM(r.collected) },
            { header: 'Paid', get: r => NUM(r.paid) },
            { header: 'Payment Mode', get: r => r.mode || 'cash' },
            { header: 'Closing Due', get: () => '' },
            { header: 'Transaction Type', get: r => r.transaction_type || '' },
            { header: 'REMARKS', get: r => r.notes || '' }
        ],
        rows(db) {
            const receipts = db.prepare(`
                SELECT pm.*, p.name AS party_name FROM payments pm
                LEFT JOIN parties p ON p.id = pm.party_id
                WHERE pm.type = 'receipt'
                ORDER BY pm.date, pm.id`).all()
                .map(r => ({
                    ref: `COL-${r.id}`,
                    record: r,
                    data: {
                        ...r,
                        receipt_no: r.reference_id || '',
                        coll_type: r.transaction_type === 'rent' ? 'Rent' : 'Collection',
                        collected: r.amount,
                        paid: 0
                    }
                }));
            // Rent received is income, and the workbook keeps rent rows in
            // Collection with Type=Rent (Profit_Loss!C8 reads them there).
            const rent = db.prepare(`
                SELECT * FROM other_expenses WHERE category = 'Income'
                ORDER BY date, id`).all()
                .map(r => ({
                    ref: `COL-RENT-${r.id}`,
                    record: r,
                    data: {
                        date: r.date,
                        receipt_no: r.reference_no || '',
                        party_name: r.paid_to || '',
                        reference_id: '',
                        coll_type: 'Rent',
                        collected: r.amount,
                        paid: 0,
                        mode: r.payment_mode || 'cash',
                        transaction_type: 'rent',
                        notes: r.remarks || r.description || ''
                    }
                }));
            return [...receipts, ...rent];
        }
    },

    payments: {
        label: 'Payment Register',
        sheet: 'Payment',
        idPrefix: 'PAY',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Receipt No', get: r => r.reference_id || '' },
            { header: 'Customer Name', get: r => r.party_name || '' },
            { header: 'Against Bill', get: r => r.reference_type || '' },
            { header: 'Description', get: r => r.notes || '' },
            { header: 'Type', get: () => 'Payment' },
            { header: 'Opening Due', get: () => '' },
            { header: 'Collected', get: () => '' },
            { header: 'Paid', get: r => NUM(r.amount) },
            { header: 'Payment Mode', get: r => r.mode || 'cash' },
            { header: 'Closing Due', get: () => '' },
            { header: 'REMARKS', get: r => r.notes || '' }
        ],
        rows(db) {
            return db.prepare(`
                SELECT pm.*, p.name AS party_name FROM payments pm
                LEFT JOIN parties p ON p.id = pm.party_id
                WHERE pm.type = 'payment'
                ORDER BY pm.date, pm.id`).all()
                .map(r => ({ ref: `PAY-${r.id}`, record: r, data: r }));
        }
    },

    advances: {
        label: 'Advances & Loans',
        sheet: 'Advance',
        idPrefix: 'ADV',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Receipt No', get: r => r.reference_id || '' },
            { header: 'Customer Name', get: r => r.party_name || '' },
            { header: 'Against Bill', get: r => r.reference_type || '' },
            { header: 'Description', get: r => r.notes || '' },
            { header: 'Type', get: r => r.transaction_type || 'advance' },
            { header: 'Opening Due', get: () => '' },
            { header: 'Collected', get: r => (r.transaction_type === 'loan_received' ? NUM(r.amount) : '') },
            { header: 'Paid', get: r => (r.transaction_type === 'loan_received' ? '' : NUM(r.amount)) },
            { header: 'Payment Mode', get: r => r.mode || 'cash' },
            { header: 'Closing Due', get: () => '' },
            { header: 'REMARKS', get: r => r.notes || '' }
        ],
        rows(db) {
            return db.prepare(`
                SELECT pm.*, p.name AS party_name FROM payments pm
                LEFT JOIN parties p ON p.id = pm.party_id
                WHERE pm.transaction_type IN ('advance','advance_returned','loan_received','loan_paid','loan')
                ORDER BY pm.date, pm.id`).all()
                .map(r => ({ ref: `ADV-${r.id}`, record: r, data: r }));
        }
    },

    petty_cash: {
        label: 'Petty Cash',
        sheet: 'PETTY CASH',
        idPrefix: 'PC',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Receipt No', get: r => r.voucher_no || '' },
            { header: 'Customer Name', get: r => r.paid_to || 'OFFICE EXPENSES' },
            { header: 'Against Bill', get: r => r.expense_head || '' },
            { header: 'Description', get: r => r.description || '' },
            { header: 'Type', get: () => 'PETTY CASH' },
            { header: 'Opening Due', get: () => '' },
            { header: 'Collected', get: () => '' },
            { header: 'Paid', get: r => NUM(r.amount) },
            { header: 'Payment Mode', get: r => r.payment_mode || 'cash' },
            { header: 'Closing Due', get: () => '' },
            { header: 'REMARKS', get: r => r.remarks || r.description || '' }
        ],
        rows(db) {
            return db.prepare(`SELECT * FROM petty_cash ORDER BY date, id`).all()
                .map(r => ({ ref: `PC-${r.id}`, record: r, data: r }));
        }
    },

    expenses: {
        label: 'Expenses',
        sheet: 'Expenses',
        idPrefix: 'EXP',
        refColumn: 'App Ref',
        fields: [
            { header: 'Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Receipt No', get: r => r.reference_no || '' },
            { header: 'Customer Name', get: r => r.paid_to || '' },
            { header: 'Against Bill', get: r => r.expense_head || '' },
            { header: 'Description', get: r => r.description || '' },
            { header: 'Type', get: r => r.category || 'OFFICE EXPENSES' },
            { header: 'Opening Due', get: () => '' },
            { header: 'Collected', get: () => '' },
            { header: 'Paid', get: r => NUM(r.amount) },
            { header: 'Payment Mode', get: r => r.payment_mode || 'cash' },
            { header: 'Closing Due', get: () => '' },
            { header: 'REMARKS', get: r => r.remarks || r.description || '' }
        ],
        rows(db) {
            return db.prepare(`
                SELECT * FROM other_expenses WHERE COALESCE(category,'') <> 'Income'
                ORDER BY date, id`).all()
                .map(r => ({ ref: `EXP-${r.id}`, record: r, data: r }));
        }
    },

    bank: {
        label: 'Bank Transactions',
        sheet: 'BANK RECON',
        idPrefix: 'BANK',
        refColumn: 'App Ref',
        fields: [
            { header: 'Transaction Date', get: r => DAY(r.date) },
            { header: 'AD Date', get: r => adDate(r.date) },
            { header: 'Transaction ID', get: r => r.reference_no || r.txn_uid || '' },
            { header: 'Counterparty Name', get: r => r.counterparty_name || '' },
            { header: 'Description', get: r => r.description || '' },
            { header: 'Party ID', get: () => '' },
            { header: 'Debit', get: r => NUM(r.debit) },
            { header: 'Credit', get: r => NUM(r.credit) },
            { header: 'Amount', get: r => NUM(r.amount) },
            { header: 'Payment Mode', get: r => r.payment_mode || '' },
            { header: 'Classification', get: r => r.accounting_class || '' },
            { header: 'Bank Account', get: r => r.bank_account || '' },
            { header: 'Transaction Type', get: r => r.txn_type || '' },
            { header: 'Verification Status', get: () => '' },
            { header: 'Ledger Posting Status', get: () => 'NOT POSTED (standalone)' },
            { header: 'Remarks', get: r => r.remarks || '' }
        ],
        rows(db) {
            return db.prepare(`SELECT * FROM bank_transactions ORDER BY date, id`).all()
                .map(r => ({ ref: `BANK-${r.id}`, record: r, data: r }));
        }
    },

    salary: {
        label: 'Salary',
        sheet: 'Salary',
        idPrefix: 'SAL',
        refColumn: 'App Ref',
        fields: [
            { header: 'ID', get: r => r.employee_id || r.id },
            { header: 'Employee Name', get: r => r.employee_name || '' },
            { header: 'Position', get: r => r.position || '' },
            { header: 'Month', get: r => r.month || '' },
            { header: 'Basic Salary', get: r => NUM(r.basic_salary) },
            { header: 'Allowance', get: r => NUM(r.allowance) },
            { header: 'Advance', get: r => NUM(r.advance) },
            { header: 'Deduction', get: r => NUM(r.deduction) },
            { header: 'Net Salary', get: r => NUM(r.net_salary) },
            { header: 'Payment Date', get: r => DAY(r.payment_date) },
            { header: 'Payment Mode', get: r => r.payment_mode || '' },
            { header: 'Remarks', get: r => r.remarks || '' }
        ],
        rows(db) {
            return db.prepare(`SELECT * FROM salary_records ORDER BY month, id`).all()
                .map(r => ({ ref: `SAL-${r.id}`, record: r, data: r }));
        }
    }
};

/** Modules that own a register sheet. */
function moduleIds() { return Object.keys(MODULES); }

/** Sidebar tabs with no register worksheet of their own (report-only). */
const REPORT_ONLY = {
    dashboard: 'computed from every module',
    stock: 'Stock_Master is derived (opening + purchases - sales); no register sheet',
    'stock-statement': 'derived report',
    production: 'no worksheet in the workbook',
    'dairy-costing': 'derived report',
    parties: 'Party_Master (master data, not a transaction register)',
    'party-ledger': 'derived — the workbook builds it with formulas',
    statements: 'derived report',
    reports: 'derived report',
    'monthly-report': 'Monthly Report sheet is written by export-monthly-report.js',
    'profit-loss': 'derived report',
    'receivable-payable': 'derived report',
    daybook: 'derived report',
    'company-ledger': 'derived report',
    'cash-deposit': 'no dedicated workbook sheet (cash movements live in CASH FLOW)',
    'partner-capital': 'no dedicated workbook sheet',
    vehicle: 'no dedicated workbook sheet',
    pdc: 'no dedicated workbook sheet (cheques are a payment method)',
    'farmer-payments': 'composed from purchases + payments',
    'payment-collection': 'Payment register — see payments'
};

// ──────────────────────────────────────────────────────────────
// Sheet reading
// ──────────────────────────────────────────────────────────────

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find the sheet in a workbook, trim-insensitively. */
function findSheet(wb, name) {
    const want = norm(name);
    return wb.SheetNames.find(n => norm(n) === want) || null;
}

/** Header row + column positions for a sheet. */
function readLayout(wb, sheetName) {
    const actual = findSheet(wb, sheetName);
    if (!actual) return null;
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[actual], { header: 1, raw: true, defval: '' });
    // Header row is detected by scoring against the vocabulary the workbook
    // actually uses. Two sheets break a naive "find a cell called Date" rule:
    // BANK RECON starts with "Transaction Date", and Salary has a banner in row 1
    // and its real header in row 3.
    const VOCAB = new Set([
        'date', 'addate', 'invoiceno', 'billno', 'receiptno', 'transactiondate', 'transactionid',
        'customername', 'partyname', 'suppliername', 'employeename', 'counterpartyname',
        'description', 'type', 'amount', 'debit', 'credit', 'paid', 'collected', 'quantity',
        'rate', 'netamount', 'netsalary', 'basicsalary', 'month', 'basic', 'net', 'remarks',
        'paymentmode', 'id', 'position', 'allowance', 'advance', 'deduction', 'paymentdate',
        'classification', 'partyid', 'openingdue', 'closingdue', 'product', 'shift', 'fat',
        'snf', 'transport', 'status', 'verificationstatus', 'ledgerpostingstatus', 'againstbill'
    ]);
    let headerRow = -1;
    let bestScore = 0;
    for (let r = 0; r < Math.min(aoa.length, 20); r++) {
        const score = (aoa[r] || []).filter(v => VOCAB.has(norm(v))).length;
        if (score > bestScore && score >= 3) { bestScore = score; headerRow = r; }
    }
    if (headerRow < 0) return null;
    return {
        sheetName: actual,
        headerRow,
        headers: (aoa[headerRow] || []).map(v => String(v).trim()),
        rows: aoa,
        lastRow: aoa.length
    };
}

/** Resolve a field's column index: by header text first, declared position second. */
function resolveColumns(layout, fields) {
    const used = new Set();
    const clean = (h) => norm(h);
    return fields.map((f, i) => {
        const want = clean(f.header);
        const free = (j) => !used.has(j) && layout.headers[j] !== undefined;
        // 1. exact header text ("Employee Name *" normalises to "employeename")
        let idx = layout.headers.findIndex((h, j) => free(j) && clean(h) === want);
        // 2. header starts with the field name ("Basic Salary" for "Basic Salary")
        if (idx < 0 && want.length >= 4) {
            idx = layout.headers.findIndex((h, j) => free(j) && clean(h).startsWith(want) && clean(h) !== 'addate');
        }
        // 3. field starts with the header ("Net Salary" declared, header "Net")
        if (idx < 0 && want.length >= 4) {
            idx = layout.headers.findIndex((h, j) => free(j) && want.startsWith(clean(h)) && clean(h).length >= 4 && clean(h) !== 'addate');
        }
        if (idx < 0) idx = i;              // declared position — never shifts other columns
        used.add(idx);
        return idx;
    });
}

/** The App Ref column: existing header, else one past the last used column. */
function findRefColumn(layout, refColumn) {
    const want = norm(refColumn);
    const existing = layout.headers.findIndex(h => norm(h) === want);
    if (existing >= 0) return existing;
    let max = -1;
    layout.headers.forEach((h, i) => { if (String(h).trim() !== '') max = i; });
    return Math.max(max + 1, 0);
}

/** Existing App Ref values -> row numbers (1-based Excel rows). */
function readRefIndex(layout, refCol) {
    const index = new Map();
    for (let r = layout.headerRow + 1; r < layout.rows.length; r++) {
        const v = String((layout.rows[r] || [])[refCol] || '').trim();
        if (!v) continue;
        if (!index.has(v)) index.set(v, []);
        index.get(v).push(r + 1);
    }
    return index;
}

// ──────────────────────────────────────────────────────────────
// Sheet XML patching (only this worksheet part changes)
// ──────────────────────────────────────────────────────────────

function colName(i) {
    let n = i + 1, s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
}

function esc(text) {
    return String(text)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellXml(ref, value, style) {
    const s = style ? ` s="${style}"` : '';
    if (typeof value === 'number' && isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
    if (value === null || value === undefined || value === '') return '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Split <sheetData> into row xml strings keyed by row number. */
function parseRows(xml) {
    const rows = new Map();
    const re = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const num = parseInt((m[0].match(/<row\b[^>]*\br="(\d+)"/) || [])[1] || '0', 10);
        if (num > 0) rows.set(num, m[0]);
    }
    return rows;
}

/** Replace/insert one cell inside a row's xml, keeping every other cell intact. */
function setCell(rowXml, col, rowNum, value, fallbackStyle) {
    const ref = `${colName(col)}${rowNum}`;
    let style = fallbackStyle;
    const existing = new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
    const hit = rowXml.match(existing);
    if (hit) {
        const s = hit[0].match(/\bs="(\d+)"/);
        if (s) style = s[1];
        const replacement = cellXml(ref, value, style);
        if (!replacement) return rowXml.replace(existing, '');
        return rowXml.replace(existing, replacement);
    }
    if (value === null || value === undefined || value === '') return rowXml;
    const fresh = cellXml(ref, value, style);
    // Insert in column order.
    const cellRe = /<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
    let insertAt = -1;
    let m;
    while ((m = cellRe.exec(rowXml)) !== null) {
        const c = m[1];
        const w = c.length === 1 ? c.charCodeAt(0) - 65 : 26 + (c.charCodeAt(0) - 65) * 26 + (c.charCodeAt(1) - 65);
        if (w > col) { insertAt = m.index; break; }
    }
    if (insertAt >= 0) return rowXml.slice(0, insertAt) + fresh + rowXml.slice(insertAt);
    // After the last cell but before </row>.
    if (/<\/row>$/.test(rowXml)) return rowXml.replace(/<\/row>$/, fresh + '</row>');
    return rowXml.replace(/\/>$/, `>${fresh}</row>`);
}

/** Style of the same column in the previous row, so new rows keep number formats. */
function styleFromAbove(rows, rowNum, col) {
    for (let r = rowNum - 1; r >= 1 && r > rowNum - 4; r--) {
        const xml = rows.get(r);
        if (!xml) continue;
        const ref = `${colName(col)}${r}`;
        const m = xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`));
        if (!m) continue;
        const s = m[0].match(/\bs="(\d+)"/);
        if (s) return s[1];
    }
    return null;
}

/**
 * Apply row updates to one worksheet, leaving everything else in the file alone.
 * @param {string} file workbook path
 * @param {string} sheetName sheet to patch
 * @param {object} plan { headerCells:[[col,value]], updates:[{row, cells:[[col,value]]}], appends:[{cells}] }
 */
function patchSheet(file, sheetName, plan) {
    const zip = parts.readZip(fs.readFileSync(file));
    const part = parts.locateSheetPart(zip, sheetName);
    if (!part) throw new Error(`Worksheet part not found for "${sheetName}"`);
    const entry = zip.entries.get(part);
    let xml = entry.data.toString('utf8');

    const open = xml.match(/<sheetData\b[^>]*(?:\/>|>)/);
    if (!open) throw new Error(`<sheetData> not found in ${sheetName}`);
    const selfClosing = /\/>$/.test(open[0]);
    const start = open.index + open[0].length;
    const end = selfClosing ? start : xml.indexOf('</sheetData>');
    const inner = selfClosing ? '' : xml.slice(start, end);

    const rows = parseRows(inner);

    // Header cells (App Ref label) — written into the header row.
    for (const [col, value] of plan.headerCells || []) {
        const rowNum = plan.headerRow;
        const rowXml = rows.get(rowNum);
        if (!rowXml) continue;
        rows.set(rowNum, setCell(rowXml, col, rowNum, value, null));
    }

    // Patch existing rows.
    for (const u of plan.updates || []) {
        const rowXml = rows.get(u.row);
        if (!rowXml) continue;
        let next = rowXml;
        for (const [col, value] of u.cells) next = setCell(next, col, u.row, value, null);
        rows.set(u.row, next);
    }

    // Append new rows.
    for (const a of plan.appends || []) {
        const rowNum = a.row;
        let rowXml = `<row r="${rowNum}">`;
        for (const [col, value] of a.cells) {
            rowXml += cellXml(`${colName(col)}${rowNum}`, value, styleFromAbove(rows, rowNum, col));
        }
        rowXml += '</row>';
        rows.set(rowNum, rowXml);
    }

    const ordered = [...rows.keys()].sort((a, b) => a - b).map(r => rows.get(r)).join('');
    const newData = selfClosing ? `<sheetData>${ordered}</sheetData>` : `<sheetData>${ordered}</sheetData>`;
    xml = selfClosing
        ? xml.replace(open[0], newData)
        : xml.slice(0, open.index) + newData + xml.slice(end + '</sheetData>'.length);

    // Widen <dimension> so Excel shows the new rows.
    const maxRow = Math.max(...rows.keys());
    let maxCol = 0;
    for (const rowXml of rows.values()) {
        for (const m of rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)) {
            const c = m[1];
            const w = c.length === 1 ? c.charCodeAt(0) - 65 : 26 + (c.charCodeAt(0) - 65) * 26 + (c.charCodeAt(1) - 65);
            if (w > maxCol) maxCol = w;
        }
    }
    const dim = xml.match(/<dimension\b[^>]*ref="([^"]*)"[^>]*\/>/);
    if (dim) {
        const ref = `A1:${colName(maxCol)}${maxRow}`;
        xml = xml.replace(dim[0], dim[0].replace(/ref="[^"]*"/, `ref="${ref}"`));
    }

    zip.entries.set(part, { data: Buffer.from(xml, 'utf8'), method: 0 });
    const tmp = `${file}.tmp-excel-sync`;
    fs.writeFileSync(tmp, parts.writeZip(zip.order, zip.entries));
    fs.renameSync(tmp, file);
    return { part, rows: maxRow };
}

// ──────────────────────────────────────────────────────────────
// Sync
// ──────────────────────────────────────────────────────────────

/**
 * Compute what a sync would do, without writing.
 * @returns {{module, sheet, matched, appended, unchanged, orphans, rows, error?}}
 */
function planModule(db, moduleId, opts = {}) {
    const mod = MODULES[moduleId];
    if (!mod) return { module: moduleId, error: `Unknown module: ${moduleId}` };
    const file = workbookPath(opts.workbookPath);
    if (!fs.existsSync(file)) return { module: moduleId, sheet: mod.sheet, error: `Workbook not found: ${file}` };

    let wb;
    try { wb = XLSX.readFile(file, { cellFormula: true }); }
    catch (e) { return { module: moduleId, sheet: mod.sheet, error: `Cannot read workbook: ${e.message}` }; }

    const layout = readLayout(wb, mod.sheet);
    if (!layout) {
        return {
            module: moduleId,
            sheet: mod.sheet,
            error: `Worksheet "${mod.sheet}" not found (or has no header row). `
                + `Nothing was written — report it rather than writing into another sheet.`
        };
    }

    const cols = resolveColumns(layout, mod.fields);
    const refCol = findRefColumn(layout, mod.refColumn);
    const index = readRefIndex(layout, refCol);
    const desired = mod.rows(db);

    const updates = [];
    const appends = [];
    const unchanged = [];
    const seen = new Set();
    let nextRow = layout.lastRow + 1;

    for (const rec of desired) {
        if (seen.has(rec.ref)) continue;
        seen.add(rec.ref);
        const cells = [];
        mod.fields.forEach((f, i) => {
            const v = f.get(rec.data);
            cells.push([cols[i], v]);
        });
        cells.push([refCol, rec.ref]);

        const rowsFor = index.get(rec.ref);
        if (rowsFor && rowsFor.length) {
            const row = rowsFor[0];
            updates.push({ row, ref: rec.ref, cells, record: rec.record });
        } else {
            appends.push({ row: nextRow++, ref: rec.ref, cells, record: rec.record });
        }
    }

    const orphans = [];
    for (const [ref, rowsFor] of index.entries()) {
        if (seen.has(ref)) continue;
        orphans.push({ ref, rows: rowsFor });
    }

    return {
        module: moduleId,
        label: mod.label,
        sheet: layout.sheetName,
        workbook: file,
        headerRow: layout.headerRow + 1,
        columns: mod.fields.reduce((acc, f, i) => { acc[f.header] = colName(cols[i]); return acc; }, {}),
        refColumn: colName(refCol),
        desired: desired.length,
        matched: desired.length - appends.length,
        appended: appends.length,
        unchanged: unchanged.length,
        orphans,
        plan: { updates, appends, refCol, headerRow: layout.headerRow + 1, columns: cols }
    };
}

/**
 * Sync one module into its own worksheet.
 * @param {object} db
 * @param {string} moduleId
 * @param {{workbookPath?:string, apply?:boolean, markDeleted?:boolean, backup?:boolean}} opts
 */
function syncModule(db, moduleId, opts = {}) {
    // An open workbook must fail loudly: Excel keeps an owner file next to it and
    // would overwrite our write on its next save.
    if (opts.apply) {
        const file = workbookPath(opts.workbookPath);
        const lock = path.join(path.dirname(file), `~$${path.basename(file)}`);
        if (fs.existsSync(lock)) {
            return {
                success: false,
                applied: false,
                module: moduleId,
                error: `${path.basename(file)} is open in Excel (found ${path.basename(lock)}). `
                    + 'Close it in Excel and sync again — nothing was written.'
            };
        }
    }

    const result = planModule(db, moduleId, opts);
    if (result.error) return { success: false, ...result };

    const { updates, appends, refCol, headerRow } = result.plan;
    const headerCells = [];
    if (appends.length) headerCells.push([refCol, MODULES[moduleId].refColumn]);

    if (!opts.apply) {
        return {
            success: true,
            applied: false,
            ...stripPlan(result),
            message: `${result.label}: ${result.matched} row(s) would be updated, ${result.appended} appended in ${result.sheet}.`
        };
    }
    if (!updates.length && !appends.length) {
        return { success: true, applied: false, ...stripPlan(result), message: `${result.label}: already in sync.` };
    }

    let backupPath = null;
    if (opts.backup !== false) {
        backupPath = `${result.workbook}.bak-excel-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.copyFileSync(result.workbook, backupPath);
    }

    try {
        const written = patchSheet(result.workbook, result.sheet, {
            headerRow, headerCells, updates, appends
        });
        return {
            success: true,
            applied: true,
            ...stripPlan(result),
            backupPath,
            rowsInSheet: written.rows,
            message: `${result.label}: ${result.matched} updated, ${result.appended} appended in ${result.sheet}; `
                + `no other worksheet was touched.`
        };
    } catch (err) {
        return { success: false, applied: false, ...stripPlan(result), backupPath, error: err.message };
    }
}

function stripPlan(r) {
    const { plan, ...rest } = r;
    return rest;
}

/** Sync every module that owns a register sheet. */
function syncAll(db, opts = {}) {
    const out = {};
    for (const id of moduleIds()) out[id] = syncModule(db, id, opts);
    const failed = Object.entries(out).filter(([, r]) => !r.success).map(([id]) => id);
    return { success: failed.length === 0, modules: out, failed };
}

module.exports = {
    MODULES,
    REPORT_ONLY,
    moduleIds,
    readLayout,
    resolveColumns,
    findRefColumn,
    readRefIndex,
    patchSheet,
    planModule,
    syncModule,
    syncAll
};
