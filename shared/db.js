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
