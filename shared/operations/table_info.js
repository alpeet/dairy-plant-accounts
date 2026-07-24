/**
 * Godhuli Dairy Plant — Database Table Info
 * ===========================================
 * Returns all tables with row counts, grouped by functional category.
 * Used in the Settings → Database Tables viewer for easy management.
 */

const TABLE_CLASSIFICATION = [
    {
        category: '👥 Master Data',
        icon: 'users',
        description: 'Core entities that everything else references',
        tables: ['parties', 'products', 'routes', 'users', 'settings']
    },
    {
        category: '🥛 Milk Operations',
        icon: 'milk',
        description: 'Daily milk intake from farmers and pricing rules',
        tables: ['milk_collections', 'milk_rate_chart']
    },
    {
        category: '💰 Transactions',
        icon: 'cash',
        description: 'Buy/sell invoices, payments, and receipts',
        tables: ['sales', 'sales_items', 'purchases', 'purchase_items', 'payments']
    },
    {
        category: '📊 Financial Ledger',
        icon: 'ledger',
        description: 'Double-entry bookkeeping for all party transactions',
        tables: ['ledger_entries']
    },
    {
        category: '🏭 Production',
        icon: 'factory',
        description: 'Raw milk processing into finished products',
        tables: ['production_batches', 'production_inputs', 'production_outputs']
    },
    {
        category: '📦 Inventory',
        icon: 'box',
        description: 'Inventory movement tracking (inward/outward/balance)',
        tables: ['stock_movements']
    },
    {
        category: '💵 Cash & Banking',
        icon: 'bank',
        description: 'Cash counting, small expenses, and bank deposits',
        tables: ['denomination_counts', 'petty_cash', 'cash_deposits']
    },
    {
        category: '💸 Financial',
        icon: 'finance',
        description: 'Payroll, operational costs, and partner investments',
        tables: ['salary_records', 'vehicle_expenses', 'other_expenses', 'partner_capital']
    },
    {
        category: '📋 Audit & System',
        icon: 'audit',
        description: 'Change tracking and system monitoring',
        tables: ['audit_log']
    }
];

/**
 * Get all database tables with row counts, grouped by functional category.
 * @param {object} db - better-sqlite3 database instance
 * @returns {object[]} Array of category groups with table details
 */
function getTableInfo(db) {
    // Get all tables from SQLite master
    const allTables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map(r => r.name);

    const result = TABLE_CLASSIFICATION.map(group => {
        const tables = group.tables
            .filter(t => allTables.includes(t))
            .map(tableName => {
                try {
                    const row = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get();
                    return {
                        name: tableName,
                        row_count: row ? row.count : 0,
                        exists: true
                    };
                } catch (e) {
                    return {
                        name: tableName,
                        row_count: 0,
                        exists: false,
                        error: e.message
                    };
                }
            });

        const totalRows = tables.reduce((s, t) => s + t.row_count, 0);

        return {
            category: group.category,
            icon: group.icon,
            description: group.description,
            table_count: tables.length,
            total_rows: totalRows,
            tables
        };
    });

    // Get total database stats
    const totalTables = allTables.length;
    const totalRows = result.reduce((s, g) => s + g.total_rows, 0);

    // Get database file size
    let dbSize = 0;
    try {
        const pageCount = db.prepare("PRAGMA page_count").get();
        const pageSize = db.prepare("PRAGMA page_size").get();
        dbSize = (pageCount?.page_count || 0) * (pageSize?.page_size || 0);
    } catch (e) { /* ignore */ }

    return {
        groups: result,
        summary: {
            total_tables: totalTables,
            total_rows: totalRows,
            db_size: dbSize
        }
    };
}

module.exports = { getTableInfo, TABLE_CLASSIFICATION };
