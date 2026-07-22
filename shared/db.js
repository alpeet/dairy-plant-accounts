/**
 * Godhuli Dairy Plant — Shared Database Module
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
