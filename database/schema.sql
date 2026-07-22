-- Godhuli Dairy Plant - Database Schema
-- SQLite

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- PARTIES (Customers, Suppliers, Farmers, Partners, Mixed)
-- ============================================================
CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    pan_vat TEXT DEFAULT '',
    type TEXT NOT NULL CHECK(type IN ('customer', 'supplier', 'both', 'farmer', 'partner')) DEFAULT 'customer',
    opening_balance REAL DEFAULT 0.0,
    route_id INTEGER DEFAULT NULL,
    route_name TEXT DEFAULT '',
    profit_share_percent REAL DEFAULT 0.0,
    partner_type TEXT DEFAULT '' CHECK(partner_type IN ('', 'active', 'silent')),
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (route_id) REFERENCES routes(id)
);

-- ============================================================
-- ROUTES / COLLECTION CENTERS
-- ============================================================
CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT DEFAULT '',
    assigned_vehicle TEXT DEFAULT '',
    assigned_staff TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- PRODUCTS (Master list)
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'kg',
    category TEXT DEFAULT '',
    opening_stock REAL DEFAULT 0.0,
    reorder_level REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    gst_rate REAL DEFAULT 0.0,
    hsn_code TEXT DEFAULT '',
    expiry_days INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- MILK RATE CHART (dated rate history)
-- ============================================================
CREATE TABLE IF NOT EXISTS milk_rate_chart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    effective_from TEXT NOT NULL,
    rate_type TEXT NOT NULL DEFAULT 'formula' CHECK(rate_type IN ('formula', 'fixed')),
    fat_multiplier REAL DEFAULT 7.15,
    snf_multiplier REAL DEFAULT 4.55,
    extra_per_unit REAL DEFAULT 0.0,
    fixed_rate REAL DEFAULT 0.0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- STOCK MOVEMENTS (inventory ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    type TEXT NOT NULL CHECK(type IN ('opening', 'purchase', 'sale', 'adjustment', 'return_in', 'return_out', 'milk_collection', 'production_input', 'production_output')),
    reference_type TEXT DEFAULT '',
    reference_id INTEGER DEFAULT NULL,
    inward_qty REAL DEFAULT 0.0,
    outward_qty REAL DEFAULT 0.0,
    balance_after REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    party_id INTEGER NOT NULL,
    subtotal REAL DEFAULT 0.0,
    discount REAL DEFAULT 0.0,
    discount_percent REAL DEFAULT 0.0,
    tax REAL DEFAULT 0.0,
    grand_total REAL DEFAULT 0.0,
    paid_amount REAL DEFAULT 0.0,
    payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash', 'credit', 'bank', 'upi')),
    status TEXT DEFAULT 'paid' CHECK(status IN ('paid', 'unpaid', 'partial')),
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- SALES ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS sales_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1.0,
    unit TEXT DEFAULT 'kg',
    rate REAL NOT NULL DEFAULT 0.0,
    amount REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================
-- PURCHASES (non-milk purchases: packaging, consumables, services)
-- ============================================================
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_no TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    party_id INTEGER NOT NULL,
    subtotal REAL DEFAULT 0.0,
    discount REAL DEFAULT 0.0,
    tax REAL DEFAULT 0.0,
    transport_charges REAL DEFAULT 0.0,
    extra_charges REAL DEFAULT 0.0,
    grand_total REAL DEFAULT 0.0,
    paid_amount REAL DEFAULT 0.0,
    payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash', 'credit', 'bank', 'upi')),
    status TEXT DEFAULT 'paid' CHECK(status IN ('paid', 'unpaid', 'partial')),
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- PURCHASE ITEMS
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1.0,
    unit TEXT DEFAULT 'kg',
    rate REAL NOT NULL DEFAULT 0.0,
    amount REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================
-- LEDGER ENTRIES (party-wise financial ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    reference_type TEXT NOT NULL CHECK(reference_type IN ('sale', 'purchase', 'payment_received', 'payment_made', 'opening', 'adjustment', 'milk_collection', 'production', 'partner_contribution', 'partner_withdrawal')),
    reference_id INTEGER DEFAULT NULL,
    description TEXT DEFAULT '',
    debit REAL DEFAULT 0.0,
    credit REAL DEFAULT 0.0,
    balance REAL DEFAULT 0.0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
);

-- ============================================================
-- MILK COLLECTIONS (daily milk intake from farmers)
-- ============================================================
CREATE TABLE IF NOT EXISTS milk_collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection_no TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    party_id INTEGER NOT NULL,
    route_id INTEGER DEFAULT NULL,
    milk_type TEXT DEFAULT 'cow' CHECK(milk_type IN ('cow', 'buffalo', 'mixed')),
    quantity_liters REAL NOT NULL DEFAULT 0.0,
    fat_percent REAL DEFAULT 0.0,
    snf_percent REAL DEFAULT 0.0,
    clr_percent REAL DEFAULT 0.0,
    adulteration_test TEXT DEFAULT 'not_tested' CHECK(adulteration_test IN ('pass', 'fail', 'not_tested')),
    rate_type TEXT DEFAULT 'formula' CHECK(rate_type IN ('formula', 'fixed')),
    extra_per_unit REAL DEFAULT 0.0,
    fixed_rate REAL DEFAULT 0.0,
    fat_multiplier REAL DEFAULT 7.15,
    snf_multiplier REAL DEFAULT 4.55,
    calculated_rate REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    amount REAL DEFAULT 0.0,
    shift TEXT DEFAULT 'morning' CHECK(shift IN ('morning', 'evening', 'combined')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'paid')),
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (route_id) REFERENCES routes(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- PAYMENTS (separate payment tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    type TEXT NOT NULL CHECK(type IN ('receipt', 'payment')),
    amount REAL NOT NULL DEFAULT 0.0,
    mode TEXT DEFAULT 'cash' CHECK(mode IN ('cash', 'bank', 'upi', 'cheque')),
    reference_type TEXT DEFAULT '',
    reference_id INTEGER DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- PRODUCTION BATCHES (processing: raw milk → products)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_no TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    shift TEXT DEFAULT 'morning' CHECK(shift IN ('morning', 'evening', 'combined')),
    process_type TEXT NOT NULL DEFAULT '',
    input_quantity REAL DEFAULT 0.0,
    input_unit TEXT DEFAULT 'liter',
    output_quantity REAL DEFAULT 0.0,
    output_unit TEXT DEFAULT 'kg',
    standard_yield_percent REAL DEFAULT 0.0,
    actual_yield_percent REAL DEFAULT 0.0,
    wastage_quantity REAL DEFAULT 0.0,
    wastage_reason TEXT DEFAULT '',
    operator_name TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- PRODUCTION INPUTS (what raw materials were consumed)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0.0,
    unit TEXT DEFAULT 'liter',
    rate REAL DEFAULT 0.0,
    amount REAL DEFAULT 0.0,
    FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================
-- PRODUCTION OUTPUTS (what products were produced)
-- ============================================================
CREATE TABLE IF NOT EXISTS production_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0.0,
    unit TEXT DEFAULT 'kg',
    rate REAL DEFAULT 0.0,
    amount REAL DEFAULT 0.0,
    FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
);

-- ============================================================
-- PARTNER CAPITAL TRANSACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS partner_capital (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    party_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    type TEXT NOT NULL CHECK(type IN ('contribution', 'withdrawal')),
    amount REAL NOT NULL DEFAULT 0.0,
    mode TEXT DEFAULT 'bank' CHECK(mode IN ('cash', 'bank', 'upi', 'cheque')),
    reference_no TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- USERS (authentication + roles)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator', 'accountant', 'staff', 'agent')),
    assigned_route_id INTEGER DEFAULT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (assigned_route_id) REFERENCES routes(id)
);

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_name', 'Godhuli Dairy Plant and Agro Foods Pvt. Ltd.');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_address', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_phone', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_email', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_pan', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('currency_symbol', 'रु');
INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_negative_stock', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_path', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('app_version', '1.0.0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_fat_multiplier', '7.15');
INSERT OR IGNORE INTO settings (key, value) VALUES ('default_snf_multiplier', '4.55');

-- ============================================================
-- DENOMINATION COUNTS (daily cash counting)
-- ============================================================
CREATE TABLE IF NOT EXISTS denomination_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    note_1000 INTEGER DEFAULT 0,
    note_500 INTEGER DEFAULT 0,
    note_100 INTEGER DEFAULT 0,
    note_50 INTEGER DEFAULT 0,
    note_20 INTEGER DEFAULT 0,
    note_10 INTEGER DEFAULT 0,
    note_5 INTEGER DEFAULT 0,
    note_other INTEGER DEFAULT 0,
    note_other_value REAL DEFAULT 0.0,
    coin_5 INTEGER DEFAULT 0,
    coin_2 INTEGER DEFAULT 0,
    coin_1 INTEGER DEFAULT 0,
    total_cash REAL DEFAULT 0.0,
    expected_cash REAL DEFAULT 0.0,
    difference REAL DEFAULT 0.0,
    remarks TEXT DEFAULT '',
    counted_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- PETTY CASH ENTRIES
-- ============================================================
CREATE TABLE IF NOT EXISTS petty_cash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_no TEXT NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    expense_head TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0.0,
    paid_to TEXT DEFAULT '',
    approved_by TEXT DEFAULT '',
    payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash', 'bank', 'upi')),
    remarks TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- SALARY / PAYROLL RECORDS
-- ============================================================
CREATE TABLE IF NOT EXISTS salary_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_name TEXT NOT NULL,
    position TEXT DEFAULT '',
    month TEXT NOT NULL,
    basic_salary REAL DEFAULT 0.0,
    allowance REAL DEFAULT 0.0,
    advance REAL DEFAULT 0.0,
    deduction REAL DEFAULT 0.0,
    net_salary REAL DEFAULT 0.0,
    payment_date TEXT,
    payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash', 'bank', 'upi')),
    remarks TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- VEHICLE EXPENSES
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    vehicle_name TEXT NOT NULL DEFAULT '',
    driver_name TEXT DEFAULT '',
    route_id INTEGER DEFAULT NULL,
    expense_type TEXT DEFAULT '' CHECK(expense_type IN ('fuel', 'repair', 'maintenance', 'toll_parking', 'other')),
    fuel_amount REAL DEFAULT 0.0,
    repair_amount REAL DEFAULT 0.0,
    maintenance_amount REAL DEFAULT 0.0,
    toll_parking_amount REAL DEFAULT 0.0,
    other_amount REAL DEFAULT 0.0,
    total_amount REAL DEFAULT 0.0,
    remarks TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (route_id) REFERENCES routes(id)
);

-- ============================================================
-- OTHER EXPENSES REGISTER
-- ============================================================
CREATE TABLE IF NOT EXISTS other_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    category TEXT NOT NULL DEFAULT '',
    expense_head TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    amount REAL NOT NULL DEFAULT 0.0,
    paid_to TEXT DEFAULT '',
    payment_mode TEXT DEFAULT 'cash' CHECK(payment_mode IN ('cash', 'bank', 'upi', 'cheque')),
    reference_no TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    created_by INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id INTEGER,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    old_values TEXT DEFAULT '',
    new_values TEXT DEFAULT '',
    changed_by INTEGER DEFAULT NULL,
    changed_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (changed_by) REFERENCES users(id)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sales_party ON sales(party_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_purchases_party ON purchases(party_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(date);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_party ON ledger_entries(party_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(date);
CREATE INDEX IF NOT EXISTS idx_milk_date ON milk_collections(date);
CREATE INDEX IF NOT EXISTS idx_milk_party ON milk_collections(party_id);
CREATE INDEX IF NOT EXISTS idx_milk_route ON milk_collections(route_id);
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON sales_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_denomination_date ON denomination_counts(date);
CREATE INDEX IF NOT EXISTS idx_petty_cash_date ON petty_cash(date);
CREATE INDEX IF NOT EXISTS idx_salary_month ON salary_records(month);
CREATE INDEX IF NOT EXISTS idx_vehicle_date ON vehicle_expenses(date);
CREATE INDEX IF NOT EXISTS idx_other_expenses_date ON other_expenses(date);
CREATE INDEX IF NOT EXISTS idx_audit_log_table ON audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed ON audit_log(changed_at);
CREATE INDEX IF NOT EXISTS idx_rate_chart_date ON milk_rate_chart(effective_from);
CREATE INDEX IF NOT EXISTS idx_production_date ON production_batches(date);
CREATE INDEX IF NOT EXISTS idx_partner_capital_party ON partner_capital(party_id);
CREATE INDEX IF NOT EXISTS idx_parties_route ON parties(route_id);
