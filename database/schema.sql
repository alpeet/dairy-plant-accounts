-- Godhuli Dairy Plant - Database Schema
-- SQLite

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- PARTIES (Customers, Suppliers, Mixed)
-- ============================================================
CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    pan_vat TEXT DEFAULT '',
    type TEXT NOT NULL CHECK(type IN ('customer', 'supplier', 'both')) DEFAULT 'customer',
    opening_balance REAL DEFAULT 0.0,
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
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- STOCK MOVEMENTS (inventory ledger)
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
    type TEXT NOT NULL CHECK(type IN ('opening', 'purchase', 'sale', 'adjustment', 'return_in', 'return_out', 'milk_collection')),
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
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id)
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
-- PURCHASES
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
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id)
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
    reference_type TEXT NOT NULL CHECK(reference_type IN ('sale', 'purchase', 'payment_received', 'payment_made', 'opening', 'adjustment', 'milk_collection')),
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
    milk_type TEXT DEFAULT 'cow' CHECK(milk_type IN ('cow', 'buffalo', 'mixed')),
    quantity_liters REAL NOT NULL DEFAULT 0.0,
    fat_percent REAL DEFAULT 0.0,
    snf_percent REAL DEFAULT 0.0,
    rate REAL DEFAULT 0.0,
    amount REAL DEFAULT 0.0,
    shift TEXT DEFAULT 'morning' CHECK(shift IN ('morning', 'evening', 'combined')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processed', 'paid')),
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id)
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
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (party_id) REFERENCES parties(id)
);

-- ============================================================
-- USERS (authentication)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK(role IN ('admin', 'operator')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- ============================================================
-- SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
);

-- Default settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_name', 'Godhuli Dairy Plant');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_address', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_phone', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_email', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('business_pan', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('currency_symbol', 'रु');
INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_negative_stock', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_path', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('app_version', '1.0.0');

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
CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON sales_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
