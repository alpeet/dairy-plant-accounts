/**
 * Prarambha Account & Stock Management — Shared Database Module
 * ==============================================
 * Single source of truth for database initialization, schema loading,
 * and migration logic. Used by both the Electron main process (main.js)
 * and the web server (server.js).
 *
 * Usage:
 *   const { initDatabase, getDb } = require('./shared/db');
 *   const db = initDatabase('/path/to/database.sqlite');
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { ensurePlantHelperProducts } = require('./operations/products');

// ──────────────────────────────────────────────────────────────
// Database Initialization
// ──────────────────────────────────────────────────────────────

/**
 * Initialize a SQLite database at the given path.
 * - Creates the directory if it doesn't exist
 - Runs the schema SQL
 * - Applies any required migrations
 * - Returns the database instance
 *
 * @param {string} dbDir  - Directory to store the database file
 * @param {string} dbName - Database filename (default: 'dairy-plant.db')
 * @returns {object} Database instance
 */
function initDatabase(dbDir, dbName = 'dairy-plant.db') {
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, dbName);
    const db = new Database(dbPath);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // ── Load schema ──
    const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.exec(schema);
    } else {
        console.warn('Schema file not found at:', schemaPath);
    }

    // ── Migrations ──
    runMigrations(db);

    // ── Plant helper products (Mixed Milk, Cream, SMP, Water) ──
    try {
        ensurePlantHelperProducts(db);
    } catch (e) {
        console.warn('Plant helper product setup skipped:', e.message);
    }

    console.log('Database initialized at:', dbPath);
    return db;
}

/**
 * Open an existing database without running schema or migrations.
 * Useful for tools and scripts that connect to an already-initialized DB.
 */
function openDatabase(dbPath) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
}

// ──────────────────────────────────────────────────────────────
// Migrations
// ──────────────────────────────────────────────────────────────

/**
 * Run all required migrations on the database.
 * Each migration is idempotent — safe to run multiple times.
 */
function runMigrations(db) {
    // Migration 1: Add 'milk_collection' to ledger_entries CHECK constraint
    db.pragma('foreign_keys = OFF');
    try {
        db.prepare(
            "INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (1, '2000-01-01', 'milk_collection', 'migration test', 0, 0, 0)"
        ).run();
        db.prepare(
            "DELETE FROM ledger_entries WHERE date = '2000-01-01' AND description = 'migration test' AND reference_type = 'milk_collection'"
        ).run();
    } catch (e) {
        db.prepare(
            "DELETE FROM ledger_entries WHERE date = '2000-01-01' AND description = 'migration test'"
        ).run();
        db.exec(`
            CREATE TABLE IF NOT EXISTS ledger_entries_new (
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
            INSERT INTO ledger_entries_new SELECT * FROM ledger_entries;
            DROP TABLE ledger_entries;
            ALTER TABLE ledger_entries_new RENAME TO ledger_entries;
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_party ON ledger_entries(party_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(date);
        `);
        console.log('Migrated ledger_entries table to include milk_collection constraint');
    }
    db.pragma('foreign_keys = ON');

    // Migration 2: Add 'milk_collection' to stock_movements CHECK constraint
    db.pragma('foreign_keys = OFF');
    try {
        db.prepare(
            "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, notes) VALUES (1, '2000-01-01', 'milk_collection', 0, 0, 0, 'migration test')"
        ).run();
        db.prepare(
            "DELETE FROM stock_movements WHERE date = '2000-01-01' AND notes = 'migration test' AND type = 'milk_collection'"
        ).run();
    } catch (e) {
        db.prepare(
            "DELETE FROM stock_movements WHERE date = '2000-01-01' AND notes = 'migration test'"
        ).run();
        db.exec(`
            CREATE TABLE IF NOT EXISTS stock_movements_new (
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
            INSERT INTO stock_movements_new SELECT * FROM stock_movements;
            DROP TABLE stock_movements;
            ALTER TABLE stock_movements_new RENAME TO stock_movements;
            CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
            CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(date);
        `);
        console.log('Migrated stock_movements table to include milk_collection constraint');
    }
    db.pragma('foreign_keys = ON');

    // Migration 3: Add created_by column to sales, purchases, payments, milk_collections
    try {
        db.prepare("SELECT created_by FROM sales LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`
                ALTER TABLE sales ADD COLUMN created_by INTEGER DEFAULT NULL REFERENCES users(id);
                ALTER TABLE purchases ADD COLUMN created_by INTEGER DEFAULT NULL REFERENCES users(id);
                ALTER TABLE payments ADD COLUMN created_by INTEGER DEFAULT NULL REFERENCES users(id);
                ALTER TABLE milk_collections ADD COLUMN created_by INTEGER DEFAULT NULL REFERENCES users(id);
            `);
            console.log('Added created_by columns to sales, purchases, payments, milk_collections');
        } catch (e2) {
            console.log('Migration 3 (created_by columns) skipped:', e2.message);
        }
    }

    // Migration 4: Add new columns to parties table (route_id, route_name, profit_share_percent, partner_type)
    try {
        db.prepare("SELECT route_id FROM parties LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE parties ADD COLUMN route_id INTEGER DEFAULT NULL;`);
            db.exec(`ALTER TABLE parties ADD COLUMN route_name TEXT DEFAULT '';`);
            db.exec(`ALTER TABLE parties ADD COLUMN profit_share_percent REAL DEFAULT 0.0;`);
            db.exec(`ALTER TABLE parties ADD COLUMN partner_type TEXT DEFAULT '';`);
            db.exec(`ALTER TABLE parties ADD COLUMN notes TEXT DEFAULT '';`);
            console.log('Added columns to parties table');
        } catch (e2) {
            console.log('Migration 4 (parties columns) skipped:', e2.message);
        }
    }

    // Migration 5: Add new columns to milk_collections table
    try {
        db.prepare("SELECT route_id FROM milk_collections LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE milk_collections ADD COLUMN route_id INTEGER DEFAULT NULL;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN clr_percent REAL DEFAULT 0.0;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN adulteration_test TEXT DEFAULT 'not_tested';`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN rate_type TEXT DEFAULT 'formula';`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN extra_per_unit REAL DEFAULT 0.0;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN fixed_rate REAL DEFAULT 0.0;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN fat_multiplier REAL DEFAULT 7.15;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN snf_multiplier REAL DEFAULT 4.55;`);
            db.exec(`ALTER TABLE milk_collections ADD COLUMN calculated_rate REAL DEFAULT 0.0;`);
            console.log('Added columns to milk_collections table');
        } catch (e2) {
            console.log('Migration 5 (milk_collections columns) skipped:', e2.message);
        }
    }

    // Migration 6: Add expiry_days to products table
    try {
        db.prepare("SELECT expiry_days FROM products LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE products ADD COLUMN expiry_days INTEGER DEFAULT 0;`);
            console.log('Added expiry_days to products table');
        } catch (e2) {
            console.log('Migration 6 (products expiry_days) skipped:', e2.message);
        }
    }

    // Migration 7: Add assigned_route_id to users table and update role CHECK
    try {
        db.prepare("SELECT assigned_route_id FROM users LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE users ADD COLUMN assigned_route_id INTEGER DEFAULT NULL REFERENCES routes(id);`);
            console.log('Added assigned_route_id to users table');
        } catch (e2) {
            console.log('Migration 7 (users assigned_route_id) skipped:', e2.message);
        }
    }

    // Migration 8: Update users role CHECK to include accountant, staff, agent
    db.pragma('foreign_keys = OFF');
    try {
        db.prepare(
            "INSERT INTO users (username, password_hash, role) VALUES ('_migration_test_', '_test_', 'accountant')"
        ).run();
        db.prepare("DELETE FROM users WHERE username = '_migration_test_'").run();
    } catch (e) {
        try {
            db.prepare("DELETE FROM users WHERE username = '_migration_test_'").run();
        } catch (e2) { /* ignore */ }
        try {
            db.exec(`
                CREATE TABLE IF NOT EXISTS users_new (
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
                INSERT INTO users_new SELECT id, username, password_hash, 
                    CASE WHEN role IN ('admin','operator','accountant','staff','agent') THEN role ELSE 'operator' END,
                    assigned_route_id, is_active, created_at, updated_at 
                FROM users;
                DROP TABLE users;
                ALTER TABLE users_new RENAME TO users;
            `);
            console.log('Updated users table to include new roles');
        } catch (e2) {
            console.log('Migration 8 (users role CHECK) skipped:', e2.message);
        }
    }
    db.pragma('foreign_keys = ON');

    // Migration 9: Normalize date delimiters — replace / with - in all date columns
    const dateTables = [
        { table: 'sales', col: 'date' },
        { table: 'purchases', col: 'date' },
        { table: 'milk_collections', col: 'date' },
        { table: 'payments', col: 'date' },
        { table: 'ledger_entries', col: 'date' },
        { table: 'stock_movements', col: 'date' },
        { table: 'production_batches', col: 'date' },
        { table: 'partner_capital', col: 'date' },
        { table: 'petty_cash', col: 'date' },
        { table: 'salary_records', col: 'payment_date' },
        { table: 'other_expenses', col: 'date' },
        { table: 'vehicle_expenses', col: 'date' },
        { table: 'denomination_counts', col: 'date' },
        { table: 'milk_rate_chart', col: 'effective_from' },
    ];
    let totalFixed = 0;
    db.pragma('foreign_keys = OFF');
    for (const { table, col } of dateTables) {
        try {
            // Check if column exists by trying to query it
            db.prepare(`SELECT "${col}" FROM "${table}" LIMIT 1`).get();
            // Use REPLACE() to normalize all / to - in one SQL statement
            const stmt = db.prepare(`UPDATE "${table}" SET "${col}" = REPLACE("${col}", '/', '-') WHERE "${col}" LIKE '%/%'`);
            const info = stmt.run();
            if (info.changes > 0) {
                totalFixed += info.changes;
                console.log(`  → ${table}.${col}: ${info.changes} dates normalized (/ → -)`);
            }
        } catch (e) {
            // Table or column doesn't exist — skip
        }
    }
    db.pragma('foreign_keys = ON');
    if (totalFixed > 0) {
        console.log(`  ✅ Date normalization complete: ${totalFixed} dates fixed (replaced / with -)`);
    }

    // Migration 10: Add note_5, note_other columns to denomination_counts
    try {
        db.prepare("SELECT note_5 FROM denomination_counts LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE denomination_counts ADD COLUMN note_5 INTEGER DEFAULT 0;`);
            db.exec(`ALTER TABLE denomination_counts ADD COLUMN note_other INTEGER DEFAULT 0;`);
            db.exec(`ALTER TABLE denomination_counts ADD COLUMN note_other_value REAL DEFAULT 0.0;`);
            console.log('Added note_5, note_other columns to denomination_counts');
        } catch (e2) {
            console.log('Migration 10 (denomination columns) skipped:', e2.message);
        }
    }

    // Migration 11: Add party_code column (only runs if column doesn't exist yet)
    try {
        db.prepare("SELECT party_code FROM parties LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE parties ADD COLUMN party_code TEXT DEFAULT '';`);
            console.log('Added party_code column to parties table');
        } catch (e2) {
            console.log('Migration 11 (party_code column) skipped:', e2.message);
        }
    }

    // Migration 12: Add email column to parties table
    try {
        db.prepare("SELECT email FROM parties LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE parties ADD COLUMN email TEXT DEFAULT '';`);
            console.log('Added email column to parties table');
        } catch (e2) {
            console.log('Migration 12 (parties email column) skipped:', e2.message);
        }
    }

    // Migration 14: Add archived column to parties (soft-delete / duplicate archive)
    try {
        db.prepare("SELECT archived FROM parties LIMIT 1").get();
    } catch (e) {
        try {
            db.exec(`ALTER TABLE parties ADD COLUMN archived INTEGER DEFAULT 0;`);
            console.log('Added archived column to parties table');
        } catch (e2) {
            console.log('Migration 14 (parties archived column) skipped:', e2.message);
        }
    }

    // Migration 15: Add 'advance' to payments type CHECK constraint
    db.pragma('foreign_keys = OFF');
    try {
        db.prepare("INSERT INTO payments (party_id, date, type, amount) VALUES (1, '2000-01-01', 'advance', 0)").run();
        db.prepare("DELETE FROM payments WHERE date = '2000-01-01' AND type = 'advance' AND amount = 0").run();
    } catch (e) {
        db.prepare("DELETE FROM payments WHERE date = '2000-01-01' AND amount = 0 AND type = 'advance'").run();
        db.exec(`
            CREATE TABLE IF NOT EXISTS payments_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                party_id INTEGER NOT NULL,
                date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
                type TEXT NOT NULL CHECK(type IN ('receipt', 'payment', 'advance')),
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
            INSERT INTO payments_new SELECT * FROM payments;
            DROP TABLE payments;
            ALTER TABLE payments_new RENAME TO payments;
        `);
        console.log('Migrated payments table to include advance type');
    }
    db.pragma('foreign_keys = ON');

    // Migration 16: Add 'advance' to ledger_entries reference_type CHECK constraint
    db.pragma('foreign_keys = OFF');
    try {
        db.prepare("INSERT INTO ledger_entries (party_id, date, reference_type, description, debit, credit, balance) VALUES (1, '2000-01-01', 'advance', 'migration test', 0, 0, 0)").run();
        db.prepare("DELETE FROM ledger_entries WHERE date = '2000-01-01' AND description = 'migration test' AND reference_type = 'advance'").run();
    } catch (e) {
        db.prepare("DELETE FROM ledger_entries WHERE date = '2000-01-01' AND description = 'migration test'").run();
        db.exec(`
            CREATE TABLE IF NOT EXISTS ledger_entries_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                party_id INTEGER NOT NULL,
                date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
                reference_type TEXT NOT NULL CHECK(reference_type IN ('sale', 'purchase', 'payment_received', 'payment_made', 'opening', 'adjustment', 'milk_collection', 'production', 'partner_contribution', 'partner_withdrawal', 'advance')),
                reference_id INTEGER DEFAULT NULL,
                description TEXT DEFAULT '',
                debit REAL DEFAULT 0.0,
                credit REAL DEFAULT 0.0,
                balance REAL DEFAULT 0.0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE
            );
            INSERT INTO ledger_entries_new SELECT * FROM ledger_entries;
            DROP TABLE ledger_entries;
            ALTER TABLE ledger_entries_new RENAME TO ledger_entries;
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_party ON ledger_entries(party_id);
            CREATE INDEX IF NOT EXISTS idx_ledger_entries_date ON ledger_entries(date);
        `);
        console.log('Migrated ledger_entries table to include advance reference type');
    }
    db.pragma('foreign_keys = ON');

    // Migration 17: Ensure bank_transactions table exists (for existing DBs)
    db.exec(`
        CREATE TABLE IF NOT EXISTS bank_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL DEFAULT (date('now', 'localtime')),
            reference_no TEXT DEFAULT '',
            counterparty_name TEXT DEFAULT '',
            description TEXT DEFAULT '',
            debit REAL DEFAULT 0.0,
            credit REAL DEFAULT 0.0,
            amount REAL DEFAULT 0.0,
            payment_mode TEXT DEFAULT 'QR/Bank',
            bank_account TEXT DEFAULT '',
            txn_type TEXT DEFAULT '',
            party_id INTEGER DEFAULT NULL,
            match_status TEXT DEFAULT 'none' CHECK(match_status IN ('auto', 'review', 'unmatched', 'none')),
            ledger_posted INTEGER DEFAULT 0,
            ledger_entry_id INTEGER DEFAULT NULL,
            remarks TEXT DEFAULT '',
            created_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (party_id) REFERENCES parties(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
        CREATE INDEX IF NOT EXISTS idx_bank_transactions_party ON bank_transactions(party_id);
    `);

    // Migration 18: Allow NULL product_id in sales_items (manual / free-typed invoice items)
    try {
        const cols = db.prepare("PRAGMA table_info(sales_items)").all();
        const pidCol = cols.find(c => c.name === 'product_id');
        if (pidCol && pidCol.notnull === 1) {
            db.pragma('foreign_keys = OFF');
            db.exec(`
                CREATE TABLE sales_items_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sale_id INTEGER NOT NULL,
                    product_id INTEGER,
                    product_name TEXT NOT NULL,
                    quantity REAL NOT NULL DEFAULT 1.0,
                    unit TEXT DEFAULT 'kg',
                    rate REAL NOT NULL DEFAULT 0.0,
                    amount REAL NOT NULL DEFAULT 0.0,
                    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES products(id)
                );
                INSERT INTO sales_items_new (id, sale_id, product_id, product_name, quantity, unit, rate, amount)
                    SELECT id, sale_id, product_id, product_name, quantity, unit, rate, amount FROM sales_items;
                DROP TABLE sales_items;
                ALTER TABLE sales_items_new RENAME TO sales_items;
                CREATE INDEX IF NOT EXISTS idx_sales_items_sale ON sales_items(sale_id);
            `);
            db.pragma('foreign_keys = ON');
            console.log('Migrated sales_items to allow manual (product-less) invoice items');
        }
    } catch (e) {
        db.pragma('foreign_keys = ON');
        console.log('Migration 18 (sales_items manual items) skipped:', e.message);
    }

    // Migration 13: Ensure SMTP settings exist (for in-app email sending)
    const smtpDefaults = [
        ['smtp_host', ''], ['smtp_port', '587'], ['smtp_secure', '0'],
        ['smtp_user', ''], ['smtp_pass', ''], ['smtp_from', ''], ['smtp_from_name', '']
    ];
    for (const [key, value] of smtpDefaults) {
        db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
    }

    // Migration 19: milk_collections.purchase_ref_id — link imported milk
    // collections back to their purchase bill (money stays on the purchase).
    try {
        const mcCols = db.prepare('PRAGMA table_info(milk_collections)').all().map(c => c.name);
        if (!mcCols.includes('purchase_ref_id')) {
            db.exec("ALTER TABLE milk_collections ADD COLUMN purchase_ref_id INTEGER DEFAULT NULL");
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_milk_collections_purchase_ref ON milk_collections(purchase_ref_id)");
    } catch (e19) {
        console.log('Migration 19 (milk purchase_ref_id) skipped:', e19.message);
    }

    // Migration 20: employees master + salary_records.employee_id / voucher_no.
    // Employee master persists across handover cleanup; salary records link to it.
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT DEFAULT '',
            name TEXT NOT NULL,
            position TEXT DEFAULT '',
            phone TEXT DEFAULT '',
            monthly_salary REAL DEFAULT 0.0,
            active INTEGER DEFAULT 1,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )`);
        const srCols = db.prepare('PRAGMA table_info(salary_records)').all().map(c => c.name);
        if (!srCols.includes('employee_id')) {
            db.exec("ALTER TABLE salary_records ADD COLUMN employee_id INTEGER DEFAULT NULL");
        }
        if (!srCols.includes('voucher_no')) {
            db.exec("ALTER TABLE salary_records ADD COLUMN voucher_no TEXT DEFAULT ''");
        }
        db.exec("CREATE INDEX IF NOT EXISTS idx_salary_records_employee ON salary_records(employee_id)");
    } catch (e20) {
        console.log('Migration 20 (employees master) skipped:', e20.message);
    }

    // Migration 21 (data backfill): turn milk lines inside purchase_items into
    // milk_collections rows, derive mixing/production batches, and seed the
    // required employees. Idempotent and transactional.
    //
    // IMPORTANT (§Fresh Start): this backfill must NEVER resurrect business
    // data on a cleared/reset book. After a Fresh Start / Handover Reset the
    // database is intentionally empty — nothing to derive, and the old staff
    // master (Dipak Nepal, …) must NOT be re-seeded for the next client. So:
    //   • no business data at all  → skip the whole backfill (empty book)
    //   • fresh-start marker set   → derive from imported data, but never
    //                                re-seed the previous business's employees
    // (`fresh_start_completed_at` is written by the reset and kept as a
    //  system setting so it survives future resets.)
    try {
        let hasBusinessData = false;
        try {
            hasBusinessData = db.prepare(`SELECT
                (SELECT COUNT(*) FROM parties) +
                (SELECT COUNT(*) FROM purchases) +
                (SELECT COUNT(*) FROM sales) +
                (SELECT COUNT(*) FROM milk_collections) AS n`).get().n > 0;
        } catch (e) {
            hasBusinessData = false;
        }
        if (!hasBusinessData) {
            console.log('Migration 21 (milk/production/employee backfill) skipped — empty book (fresh start).');
        } else {
            const excelImport = require('./excel-import');
            const backfillLog = (m) => console.log('  ' + m);
            db.transaction(() => {
                const milk = excelImport.backfillMilkCollectionsFromPurchases(db, backfillLog);
                const prod = excelImport.deriveProductionBatches(db, backfillLog);
                if (milk.created > 0 || prod.mixBatches > 0 || prod.gapBatches > 0) {
                    excelImport.rebuildStockLedger(db, backfillLog);
                }
            })();
        }
    } catch (e21) {
        console.log('Migration 21 (milk/production backfill) skipped:', e21.message);
    }

    // Migration 22: post-dated cheque (PDC) register. A PDC is an instrument,
    // not money: while HELD/DEPOSITED it posts nothing, so the bank balance and
    // the receivable/payable stay untouched. Clearing it writes a normal
    // receipt/payment row (mode 'cheque') exactly once; bouncing a cleared
    // cheque removes it again. Idempotent — safe on every existing database.
    // (Same DDL as database/schema.sql, kept here so an existing production DB
    // picks the tables up without a schema rewrite.)
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS pdc_cheques (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pdc_no TEXT DEFAULT '',
                pdc_type TEXT NOT NULL CHECK(pdc_type IN ('received', 'issued')),
                party_id INTEGER NOT NULL,
                cheque_no TEXT NOT NULL,
                cheque_date TEXT NOT NULL,
                txn_date TEXT NOT NULL,
                bank_name TEXT DEFAULT '',
                bank_account_no TEXT DEFAULT '',
                amount REAL NOT NULL DEFAULT 0.0,
                status TEXT NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'CANCELLED')),
                reference_no TEXT DEFAULT '',
                remarks TEXT DEFAULT '',
                deposit_date TEXT DEFAULT NULL,
                deposit_bank TEXT DEFAULT '',
                deposit_remarks TEXT DEFAULT '',
                clearance_date TEXT DEFAULT NULL,
                clearance_bank TEXT DEFAULT '',
                clearance_ref TEXT DEFAULT '',
                clearance_remarks TEXT DEFAULT '',
                bounce_date TEXT DEFAULT NULL,
                bounce_reason TEXT DEFAULT '',
                bounce_charge REAL DEFAULT 0.0,
                cancel_date TEXT DEFAULT NULL,
                cancel_reason TEXT DEFAULT '',
                payment_id INTEGER DEFAULT NULL,
                created_by INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                updated_by INTEGER DEFAULT NULL,
                updated_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (party_id) REFERENCES parties(id),
                FOREIGN KEY (created_by) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS pdc_allocations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pdc_id INTEGER NOT NULL,
                invoice_type TEXT DEFAULT 'on_account' CHECK(invoice_type IN ('sale', 'purchase', 'on_account')),
                invoice_id INTEGER DEFAULT NULL,
                allocated_amount REAL NOT NULL DEFAULT 0.0,
                payment_id INTEGER DEFAULT NULL,
                created_by INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (pdc_id) REFERENCES pdc_cheques(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_pdc_cheques_party ON pdc_cheques(party_id);
            CREATE INDEX IF NOT EXISTS idx_pdc_cheques_status ON pdc_cheques(status);
            CREATE INDEX IF NOT EXISTS idx_pdc_cheques_cheque_date ON pdc_cheques(cheque_date);
            CREATE INDEX IF NOT EXISTS idx_pdc_cheques_txn_date ON pdc_cheques(txn_date);
            CREATE INDEX IF NOT EXISTS idx_pdc_allocations_pdc ON pdc_allocations(pdc_id);
            CREATE INDEX IF NOT EXISTS idx_pdc_allocations_invoice ON pdc_allocations(invoice_type, invoice_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_pdc_active_cheque
                ON pdc_cheques(pdc_type, cheque_no, bank_name, party_id)
                WHERE status IN ('HELD', 'DEPOSITED', 'CLEARED');
        `);
    } catch (e22) {
        console.log('Migration 22 (PDC register) skipped:', e22.message);
    }

    // Migration 23: production lot costing. Adds the cost/traceability layer
    // over the existing stock_movements quantity ledger: milk lots (per
    // collection, cow/buffalo kept separate), finished-goods stock lots, FIFO
    // consumption trail, wastage records, and cost columns on production
    // batches. Purely additive and idempotent — safe on every existing DB.
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS milk_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                collection_id INTEGER NOT NULL,
                milk_type TEXT NOT NULL DEFAULT 'cow' CHECK(milk_type IN ('cow', 'buffalo', 'mixed')),
                party_id INTEGER DEFAULT NULL,
                date TEXT NOT NULL,
                shift TEXT DEFAULT 'morning',
                quantity REAL NOT NULL DEFAULT 0.0,
                fat_percent REAL DEFAULT 0.0,
                snf_percent REAL DEFAULT 0.0,
                unit_cost REAL NOT NULL DEFAULT 0.0,
                total_cost REAL NOT NULL DEFAULT 0.0,
                qty_remaining REAL NOT NULL DEFAULT 0.0,
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (collection_id) REFERENCES milk_collections(id)
            );
            CREATE INDEX IF NOT EXISTS idx_milk_lots_remaining ON milk_lots(milk_type, qty_remaining);
            CREATE INDEX IF NOT EXISTS idx_milk_lots_date ON milk_lots(date);
            CREATE TABLE IF NOT EXISTS stock_lots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER DEFAULT NULL,
                product_id INTEGER NOT NULL,
                produced_date TEXT NOT NULL,
                expires_date TEXT DEFAULT NULL,
                quantity REAL NOT NULL DEFAULT 0.0,
                qty_remaining REAL NOT NULL DEFAULT 0.0,
                unit_cost REAL NOT NULL DEFAULT 0.0,
                estimated_opening_cost INTEGER NOT NULL DEFAULT 0,
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY (batch_id) REFERENCES production_batches(id),
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE INDEX IF NOT EXISTS idx_stock_lots_remaining ON stock_lots(product_id, qty_remaining);
            CREATE INDEX IF NOT EXISTS idx_stock_lots_batch ON stock_lots(batch_id);
            CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry ON stock_lots(expires_date);
            CREATE TABLE IF NOT EXISTS lot_consumptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lot_type TEXT NOT NULL CHECK(lot_type IN ('milk', 'stock')),
                lot_id INTEGER NOT NULL,
                reference_type TEXT NOT NULL,
                reference_id INTEGER DEFAULT NULL,
                date TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 0.0,
                unit_cost REAL NOT NULL DEFAULT 0.0,
                total_cost REAL NOT NULL DEFAULT 0.0,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_lot_consumptions_lot ON lot_consumptions(lot_type, lot_id);
            CREATE INDEX IF NOT EXISTS idx_lot_consumptions_ref ON lot_consumptions(reference_type, reference_id);
            CREATE TABLE IF NOT EXISTS wastage_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lot_type TEXT NOT NULL CHECK(lot_type IN ('milk', 'stock')),
                lot_id INTEGER DEFAULT NULL,
                product_id INTEGER DEFAULT NULL,
                date TEXT NOT NULL,
                quantity REAL NOT NULL DEFAULT 0.0,
                unit_cost REAL NOT NULL DEFAULT 0.0,
                total_cost REAL NOT NULL DEFAULT 0.0,
                reason TEXT DEFAULT '',
                reference_type TEXT DEFAULT 'wastage',
                reference_id INTEGER DEFAULT NULL,
                created_by INTEGER DEFAULT NULL,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_wastage_date ON wastage_records(date);
            CREATE INDEX IF NOT EXISTS idx_wastage_lot ON wastage_records(lot_type, lot_id);
        `);
        // Cost columns on production_batches (ALTER ... ADD is idempotent-guarded
        // by the column probe below; SQLite has no IF NOT EXISTS for columns).
        const pbCols = db.prepare('PRAGMA table_info(production_batches)').all().map(c => c.name);
        const pbAdd = [
            ['input_cost', 'REAL DEFAULT 0.0'],
            ['processing_cost', 'REAL DEFAULT 0.0'],
            ['total_cost', 'REAL DEFAULT 0.0'],
            ['cost_allocation', "TEXT DEFAULT 'single'"],
            ['cost_approximate', 'INTEGER NOT NULL DEFAULT 0'],
            ['status', "TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','reversed'))"],
            ['yield_note', "TEXT DEFAULT ''"],
            ['lot_cogs', 'REAL DEFAULT 0.0']
        ];
        for (const [col, def] of pbAdd) {
            if (!pbCols.includes(col)) {
                try { db.exec(`ALTER TABLE production_batches ADD COLUMN ${col} ${def};`); } catch (e) { /* concurrent */ }
            }
        }
        // Sales carry their actual FIFO COGS once lots exist.
        const sCols = db.prepare('PRAGMA table_info(sales)').all().map(c => c.name);
        if (!sCols.includes('lot_cogs')) {
            try { db.exec('ALTER TABLE sales ADD COLUMN lot_cogs REAL DEFAULT 0.0;'); } catch (e) { /* concurrent */ }
        }
    } catch (e23) {
        console.log('Migration 23 (production lot costing) skipped:', e23.message);
    }

    // Migration 24: payment transaction types. Records WHY a payment moved —
    // actual_expense / advance / loan_given / loan_received / loan_repayment /
    // advance_adjustment / settlement / other — so advances and loans post to
    // Receivable/Payable (balance sheet) instead of P&L. Nullable: legacy rows
    // keep their historical settlement behaviour.
    try {
        const pCols = db.prepare("PRAGMA table_info(payments)").all().map(c => c.name);
        if (!pCols.includes('transaction_type')) {
            db.exec("ALTER TABLE payments ADD COLUMN transaction_type TEXT DEFAULT NULL;");
        }
    } catch (e24) {
        console.log('Migration 24 (payment transaction types) skipped:', e24.message);
    }

    // Migration 25: scientific milk-to-finished-product costing. Adds the
    // processing-cost breakdown + yield-control columns on production batches,
    // a configurable production-overhead register, and expected-yield
    // standards per process. Purely additive/idempotent — existing books keep
    // working; the lot engine (v1.4.16) supplies the actual cost chain.
    try {
        db.exec(`
            CREATE TABLE IF NOT EXISTS production_overheads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                basis TEXT NOT NULL DEFAULT 'per_batch'
                    CHECK(basis IN ('per_input_liter','per_batch','percent_of_input_cost')),
                rate REAL NOT NULL DEFAULT 0.0,
                active INTEGER NOT NULL DEFAULT 1,
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE TABLE IF NOT EXISTS yield_standards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                process_type TEXT NOT NULL DEFAULT '',
                output_product_id INTEGER DEFAULT NULL,
                expected_yield_percent REAL NOT NULL DEFAULT 0.0,
                warn_low_percent REAL NOT NULL DEFAULT 0.0,
                warn_high_percent REAL NOT NULL DEFAULT 0.0,
                notes TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            );
            CREATE INDEX IF NOT EXISTS idx_yield_standards_process ON yield_standards(process_type);
        `);
        // Seed the seven spec overhead categories once (rate 0 — the owner fills
        // the actual rates in; they are never invented).
        const overheadCount = db.prepare('SELECT COUNT(*) c FROM production_overheads').get().c;
        if (overheadCount === 0) {
            const seed = db.prepare('INSERT INTO production_overheads (name, basis, rate) VALUES (?, ?, 0)');
            for (const [name, basis] of [
                ['Electricity', 'per_input_liter'],
                ['Boiler / Fuel', 'per_input_liter'],
                ['Labour', 'per_batch'],
                ['Packaging', 'per_input_liter'],
                ['Water', 'per_input_liter'],
                ['Cleaning / CIP', 'per_batch'],
                ['Refrigeration / Chilling', 'per_input_liter']
            ]) seed.run(name, basis);
        }
        // Processing-cost breakdown + yield-control columns.
        const pbCols25 = db.prepare('PRAGMA table_info(production_batches)').all().map(c => c.name);
        const pbAdd25 = [
            ['labour_cost', 'REAL DEFAULT 0.0'],
            ['fuel_cost', 'REAL DEFAULT 0.0'],
            ['electricity_cost', 'REAL DEFAULT 0.0'],
            ['packaging_cost', 'REAL DEFAULT 0.0'],
            ['water_cost', 'REAL DEFAULT 0.0'],
            ['cip_cost', 'REAL DEFAULT 0.0'],
            ['refrigeration_cost', 'REAL DEFAULT 0.0'],
            ['other_processing_cost', 'REAL DEFAULT 0.0'],
            ['overhead_cost', 'REAL DEFAULT 0.0'],
            ['expected_output_quantity', 'REAL DEFAULT 0.0'],
            ['yield_variance_percent', 'REAL DEFAULT 0.0'],
            ['yield_flag', "TEXT DEFAULT 'ok'"],
            ['input_fat_percent', 'REAL DEFAULT 0.0'],
            ['output_fat_percent', 'REAL DEFAULT 0.0']
        ];
        for (const [col, def] of pbAdd25) {
            if (!pbCols25.includes(col)) {
                try { db.exec(`ALTER TABLE production_batches ADD COLUMN ${col} ${def};`); } catch (e) { /* concurrent */ }
            }
        }
    } catch (e25) {
        console.log('Migration 25 (scientific dairy costing) skipped:', e25.message);
    }

    // Migration 26: supplier-specific milk pricing. The rate chart stays ONE
    // authoritative engine — it simply gains a supplier dimension (party_id),
    // an effective-to date, an optional milk-type scope and an active flag, so
    // a farmer can be priced Fixed while others follow the fat/SNF formula.
    // Collections gain the override reason the spec requires when the operator
    // departs from the calculated rate. Purely additive/idempotent.
    try {
        const rcCols26 = db.prepare('PRAGMA table_info(milk_rate_chart)').all().map(c => c.name);
        const rcAdd26 = [
            ['party_id', 'INTEGER DEFAULT NULL'],
            ['effective_to', 'TEXT DEFAULT NULL'],
            ['milk_type', "TEXT DEFAULT ''"],
            ['is_active', 'INTEGER DEFAULT 1']
        ];
        for (const [col, def] of rcAdd26) {
            if (!rcCols26.includes(col)) {
                try { db.exec(`ALTER TABLE milk_rate_chart ADD COLUMN ${col} ${def};`); } catch (e) { /* concurrent */ }
            }
        }
        const mcCols26 = db.prepare('PRAGMA table_info(milk_collections)').all().map(c => c.name);
        if (!mcCols26.includes('rate_override_reason')) {
            try { db.exec("ALTER TABLE milk_collections ADD COLUMN rate_override_reason TEXT DEFAULT '';"); } catch (e) { /* concurrent */ }
        }
        try {
            db.exec('CREATE INDEX IF NOT EXISTS idx_rate_chart_party ON milk_rate_chart(party_id);');
        } catch (e) { /* index already there */ }
    } catch (e26) {
        console.log('Migration 26 (supplier milk pricing) skipped:', e26.message);
    }

    // Migration 27: persistent link cash_deposits ↔ bank_transactions.
    // Lets a register deposit be traced to the exact bank-statement row it
    // deposited (and back), with the audit trail already written on every
    // cash_deposits change. Purely additive/idempotent.
    try {
        const cdCols27 = db.prepare('PRAGMA table_info(cash_deposits)').all().map(c => c.name);
        if (!cdCols27.includes('bank_txn_id')) {
            db.exec('ALTER TABLE cash_deposits ADD COLUMN bank_txn_id INTEGER DEFAULT NULL;');
        }
    } catch (e27) {
        console.log('Migration 27 (cash deposit ↔ bank link) skipped:', e27.message);
    }

    // Migration 28: advance normalization (idempotent, runs every startup).
    // Backfills transaction_type on advance payments, links each advance
    // payment to its ledger debit row, tags leftover advance receipts and
    // reclassifies "advance returned" receipts — so the Advance Recovery
    // Register, P&L and cash/bank reports all agree with the Excel history.
    // Lazy require avoids a db↔accounting circular import at load time.
    try {
        const { normalizeAdvances } = require('./operations/accounting');
        const advReport = normalizeAdvances(db);
        if (Object.values(advReport).some(v => v > 0)) {
            console.log('Migration 28 (advance normalization):', JSON.stringify(advReport));
        }
    } catch (e28) {
        console.log('Migration 28 (advance normalization) skipped:', e28.message);
    }

    // Migration 29: D13 (late finding — docs/AUDIT-NORMALIZATION-2026-10.md)
    // Void the Collection-sheet "PETTY CASH" mirror payments.
    // The Collection sheet logs cash handed from the collection counter to the
    // petty box; the same money is already counted through the PETTY CASH
    // register (petty_cash expense rows + payments type='advance'). Keeping
    // both legs double-counted cash out by Rs 301,420 (69 payments). The
    // pseudo-party's 71 ledger rows are all zero-value placeholders, so removing
    // them changes no balance — verified before/after on a database copy.
    // The importer now skips those rows (importCollections), so this runs once.
    try {
        const pettyIds = db.prepare(
            "SELECT id FROM parties WHERE UPPER(TRIM(name)) = 'PETTY CASH'"
        ).all().map(r => r.id);
        if (pettyIds.length) {
            const ph = pettyIds.map(() => '?').join(',');
            const payRows = db.prepare(
                `SELECT id, amount FROM payments WHERE type = 'payment' AND party_id IN (${ph})`
            ).all(...pettyIds);
            // Only zero-value placeholder rows are removed: a real ledger row
            // (debit/credit != 0) would change a party balance and must be
            // reviewed by hand, never silently dropped.
            const ledRows = db.prepare(
                `SELECT id FROM ledger_entries
                  WHERE reference_type = 'payment_received' AND party_id IN (${ph})
                    AND debit = 0 AND credit = 0`
            ).all(...pettyIds);
            if (payRows.length || ledRows.length) {
                const paySum = payRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
                db.transaction(() => {
                    const delPay = db.prepare('DELETE FROM payments WHERE id = ?');
                    const delLed = db.prepare('DELETE FROM ledger_entries WHERE id = ?');
                    for (const r of payRows) delPay.run(r.id);
                    for (const r of ledRows) delLed.run(r.id);
                })();
                console.log(`Migration 29 (petty mirror void): removed ${payRows.length} payments (Rs ${paySum.toFixed(2)}) + ${ledRows.length} zero-value ledger rows for party 'PETTY CASH'`);
            }
        }
    } catch (e29) {
        console.log('Migration 29 (petty mirror void) skipped:', e29.message);
    }

    // Migration 30: D8 — petty expense head mis-mapped.
    // Imported expense vouchers carried the meaningless head 'Payment' with the
    // real detail in description. Re-head those rows to their description so
    // grouping/search works, and so future imports (which write head =
    // description, fallback 'Payment') dedupe against them exactly.
    // Rows with a blank description keep 'Payment' (the import fallback).
    try {
        const rehead = db.prepare(`
            UPDATE petty_cash SET expense_head = TRIM(description)
             WHERE expense_head = 'Payment'
               AND COALESCE(TRIM(description), '') <> ''
        `).run();
        if (rehead.changes > 0) {
            console.log(`Migration 30 (petty expense heads): ${rehead.changes} voucher(s) re-headed to their description`);
        }
    } catch (e30) {
        console.log('Migration 30 (petty expense heads) skipped:', e30.message);
    }

    // Migration 31: employees.updated_at — saveEmployee's UPDATE and the merge
    // path write it, but schema.sql/Migration 20 created the table without the
    // column, so editing an employee threw "no such column: updated_at" (D6).
    // ALTER cannot use a non-constant default, so new rows fall back to the
    // column default in the CREATE and to datetime('now') in code.
    try {
        const empCols = db.prepare('PRAGMA table_info(employees)').all().map(c => c.name);
        if (empCols.length && !empCols.includes('updated_at')) {
            db.exec('ALTER TABLE employees ADD COLUMN updated_at TEXT DEFAULT NULL');
            console.log('Migration 31 (employees.updated_at): column added');
        }
    } catch (e31) {
        console.log('Migration 31 (employees.updated_at) skipped:', e31.message);
    }

    // Migration 32: product master normalization (D7/D9, req 10/11/12/33/34/45).
    // Additive only: code, archive flag, four type flags, and the rate-history
    // table. Existing products keep full behaviour (active=1, all flags on).
    try {
        const pCols = db.prepare('PRAGMA table_info(products)').all().map(c => c.name);
        const added = [];
        if (pCols.length) {
            const add = (col, ddl) => { if (!pCols.includes(col)) { db.exec(`ALTER TABLE products ADD COLUMN ${ddl}`); added.push(col); } };
            add('code', "code TEXT DEFAULT ''");
            add('active', 'active INTEGER DEFAULT 1');
            add('is_stocked', 'is_stocked INTEGER DEFAULT 1');
            add('is_saleable', 'is_saleable INTEGER DEFAULT 1');
            add('is_purchaseable', 'is_purchaseable INTEGER DEFAULT 1');
            add('is_produced', 'is_produced INTEGER DEFAULT 1');
        }
        db.exec(`CREATE TABLE IF NOT EXISTS product_rate_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            old_rate REAL DEFAULT 0,
            new_rate REAL DEFAULT 0,
            effective_from TEXT DEFAULT '',
            reason TEXT DEFAULT '',
            changed_by INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )`);
        if (added.length) console.log(`Migration 32 (product master): added ${added.join(', ')} + product_rate_history`);
    } catch (e32) {
        console.log('Migration 32 (product master) skipped:', e32.message);
    }

    // Migration 33: payment ↔ bank link (D10, req 6/7/30/31).
    // One transaction ID across payment row ↔ bank statement row ↔ ledger entry.
    // Additive only; existing payments keep working with NULL links.
    try {
        const payCols = db.prepare('PRAGMA table_info(payments)').all().map(c => c.name);
        const added = [];
        const addPay = (col, ddl) => { if (!payCols.includes(col)) { db.exec(`ALTER TABLE payments ADD COLUMN ${ddl}`); added.push(col); } };
        addPay('bank_txn_id', 'bank_txn_id INTEGER DEFAULT NULL');
        addPay('bank_account', "bank_account TEXT DEFAULT ''");
        addPay('bank_reference', "bank_reference TEXT DEFAULT ''");

        // Backfill: stamp non-cash payments whose money already sits on the bank
        // statement (same party, direction-aware amount, ±5 days, unique match).
        // The statement row is counted by the cash/bank position, so the payment
        // must be linkable to it — without the link both sides counted the money.
        let stamped = 0;
        try {
            const NONCASH = "('bank','upi','cheque','qr/bank','qr','online','bank transfer')";
            const pending = db.prepare(`
                SELECT id, party_id, date, type, amount FROM payments
                 WHERE bank_txn_id IS NULL
                   AND LOWER(COALESCE(mode,'cash')) IN ${NONCASH}
            `).all();
            for (const p of pending) {
                const amtCol = p.type === 'receipt' ? 'credit' : 'debit';
                const rows = db.prepare(`
                    SELECT id FROM bank_transactions
                     WHERE party_id = ? AND ABS(${amtCol} - ?) < 0.005
                       AND date BETWEEN date(?, '-5 days') AND date(?, '+5 days')
                `).all(p.party_id, p.amount, p.date, p.date);
                if (rows.length === 1) {
                    db.prepare('UPDATE payments SET bank_txn_id = ? WHERE id = ? AND bank_txn_id IS NULL')
                        .run(rows[0].id, p.id);
                    stamped++;
                }
            }
        } catch (eBackfill) { console.log('Migration 33 backfill note:', eBackfill.message); }
        if (added.length || stamped) {
            console.log(`Migration 33 (payment↔bank link): added ${added.join(', ') || 'nothing'}; backfilled ${stamped} payment↔bank links`);
        }
    } catch (e33) {
        console.log('Migration 33 (payment↔bank link) skipped:', e33.message);
    }

    // Backfill any parties that are still missing party_code (runs every startup)
    // This catches parties created by seed scripts, imports, or initial bulk inserts
    try {
        const typePrefixes = {
            'customer': 'CUS',
            'supplier': 'SUP',
            'both': 'PTY',
            'farmer': 'FRM',
            'partner': 'PTR'
        };
        const noCodeParties = db.prepare(
            "SELECT id, type FROM parties WHERE party_code IS NULL OR party_code = ''"
        ).all();
        if (noCodeParties.length > 0) {
            const updateStmt = db.prepare("UPDATE parties SET party_code = ? WHERE id = ?");
            for (const p of noCodeParties) {
                const prefix = typePrefixes[p.type] || 'PTY';
                const code = prefix + '-' + String(p.id).padStart(4, '0');
                updateStmt.run(code, p.id);
            }
            console.log(`  → ${noCodeParties.length} parties backfilled with auto-generated codes`);
        }
    } catch (e3) {
        console.log('Party code backfill skipped:', e3.message);
    }

    console.log('Migrations complete');
}

// ──────────────────────────────────────────────────────────────
// Safe query helper
// ──────────────────────────────────────────────────────────────

/**
 * Wrap a database operation in a try/catch and return a standard
 * { success, data } or { success, error } response.
 */
function safeRun(fn) {
    try {
        const result = fn();
        return { success: true, data: result };
    } catch (error) {
        console.error('DB Error:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    initDatabase,
    openDatabase,
    safeRun,
    runMigrations,
};
