/**
 * Godhuli Dairy Plant — Sales Operations
 * =======================================
 * Single source of truth for sales CRUD with stock and ledger updates.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * All save/delete operations are transactional — they update stock movements
 * and ledger entries atomically.
 */

const { logAudit } = require('./audit');

/**
 * List sales with optional filters.
 */
function listSales(db, { search, from_date, to_date, party_id } = {}) {
    let query = `SELECT s.*, p.name as party_name,
                    (SELECT COUNT(*) FROM sales_items WHERE sale_id = s.id) as item_count
                 FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE 1=1`;
    const params = [];
    if (search) {
        query += " AND (s.invoice_no LIKE ? OR p.name LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (from_date) { query += " AND s.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND s.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND s.party_id = ?"; params.push(party_id); }
    query += " ORDER BY s.date DESC, s.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single sale with items.
 */
function getSale(db, id) {
    const sale = db.prepare(
        `SELECT s.*, p.name as party_name, p.address as party_address,
                p.phone as party_phone, p.pan_vat as party_pan
         FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE s.id = ?`
    ).get(id);
    if (!sale) return null;
    const items = db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);
    return { ...sale, items };
}

/**
 * Create or update a sale.
 * - New sale: inserts sale record, sale items, deducts stock, adds ledger entry
 * - Update: reverses old stock/ledger, re-inserts items with new stock/ledger
 * - Checks for negative stock (respects allow_negative_stock setting)
 */
function saveSale(db, saleData) {
    const trx = db.transaction(() => {
        const { id, invoice_no, date, party_id, items, subtotal, discount,
                discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes } = saleData;

        if (id) {
            // ── Revert old sale ──
            const oldSale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
            const oldItems = db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);

            // Reverse stock for old items
            for (const item of oldItems) {
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + item.quantity;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'Reversal of sale #' || ?, 'sale', ?)"
                ).run(item.product_id, oldSale.date, item.quantity, newBalance, item.rate, oldSale.invoice_no, id);
            }

            // Remove old ledger and items
            db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(id);
            db.prepare("DELETE FROM sales_items WHERE sale_id = ?").run(id);

            // Update sale record
            db.prepare(
                "UPDATE sales SET invoice_no=?, date=?, party_id=?, subtotal=?, discount=?, discount_percent=?, tax=?, grand_total=?, paid_amount=?, payment_mode=?, status=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes, id);

            // Re-insert items with stock deduction
            for (const item of items) {
                db.prepare(
                    "INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(id, item.product_id, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal - item.quantity;

                _checkNegativeStock(db, newBalance, item.product_name || item.name);

                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Sale ' || ?, 'sale', ?)"
                ).run(item.product_id, date, item.quantity, newBalance, item.rate, invoice_no, id);
            }

            // Add ledger entry
            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
            ).run(party_id, date, id, `Sale Invoice ${invoice_no}`, grand_total, outstanding);

            logAudit(db, 'sales', id, 'update', oldSale, saleData, saleData.created_by);
            return { id };
        } else {
            // ── New sale ──
            const result = db.prepare(
                "INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes);
            const saleId = result.lastInsertRowid;

            for (const item of items) {
                db.prepare(
                    "INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(saleId, item.product_id, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal - item.quantity;

                _checkNegativeStock(db, newBalance, item.product_name || item.name);

                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'sale', 0, ?, ?, ?, 'Sale ' || ?, 'sale', ?)"
                ).run(item.product_id, date, item.quantity, newBalance, item.rate, invoice_no, saleId);
            }

            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
            ).run(party_id, date, saleId, `Sale Invoice ${invoice_no}`, grand_total, outstanding);

            logAudit(db, 'sales', saleId, 'create', null, saleData, saleData.created_by);
            return { id: saleId };
        }
    });
    return trx();
}

/**
 * Delete a sale with stock reversal and ledger cleanup.
 */
function deleteSale(db, id, changedBy = null) {
    const trx = db.transaction(() => {
        const sale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
        const items = db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);

        // Reverse stock
        for (const item of items) {
            const lastBalance = db.prepare(
                "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
            ).get(item.product_id);
            const currentBal = lastBalance ? lastBalance.balance_after : 0;
            const newBalance = currentBal + item.quantity;
            db.prepare(
                "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'Deleted Sale ' || ?, 'sale', ?)"
            ).run(item.product_id, sale.date, item.quantity, newBalance, item.rate, sale.invoice_no, id);
        }

        // Remove ledger and sale
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(id);
        db.prepare("DELETE FROM sales WHERE id = ?").run(id);
        logAudit(db, 'sales', id, 'delete', sale, null, changedBy);
        return { deleted: true };
    });
    return trx();
}

/**
 * Check if a new stock balance would be negative.
 * Throws unless the allow_negative_stock setting is '1'.
 * @private
 */
function _checkNegativeStock(db, newBalance, productName) {
    if (newBalance < 0) {
        const allowNeg = db.prepare("SELECT value FROM settings WHERE key = 'allow_negative_stock'").get();
        if (!allowNeg || allowNeg.value !== '1') {
            throw new Error(`Negative stock not allowed for: ${productName}`);
        }
    }
}

module.exports = { listSales, getSale, saveSale, deleteSale };
