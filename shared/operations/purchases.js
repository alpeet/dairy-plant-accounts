/**
 * Godhuli Dairy Plant — Purchase Operations
 * ==========================================
 * Single source of truth for purchase CRUD with stock and ledger updates.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * All save/delete operations are transactional — they update stock movements
 * and ledger entries atomically.
 */

const { logAudit } = require('./audit');

/**
 * List purchases with optional filters.
 */
function listPurchases(db, { search, from_date, to_date, party_id } = {}) {
    let query = "SELECT pr.*, p.name as party_name FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE 1=1";
    const params = [];
    if (search) {
        query += " AND (pr.bill_no LIKE ? OR p.name LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (from_date) { query += " AND pr.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pr.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND pr.party_id = ?"; params.push(party_id); }
    query += " ORDER BY pr.date DESC, pr.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single purchase with items.
 */
function getPurchase(db, id) {
    const purchase = db.prepare(
        `SELECT pr.*, p.name as party_name, p.address as party_address,
                p.phone as party_phone, p.pan_vat as party_pan
         FROM purchases pr LEFT JOIN parties p ON pr.party_id = p.id WHERE pr.id = ?`
    ).get(id);
    if (!purchase) return null;
    const items = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(id);
    return { ...purchase, items };
}

/**
 * Create or update a purchase.
 * - New purchase: inserts purchase record, items, increases stock, adds ledger entry
 * - Update: reverses old stock/ledger, re-inserts items with new stock/ledger
 */
function savePurchase(db, purchaseData) {
    const trx = db.transaction(() => {
        const { id, bill_no, date, party_id, items, subtotal, discount, tax,
                transport_charges, extra_charges, grand_total, paid_amount,
                payment_mode, status, notes } = purchaseData;

        if (id) {
            // ── Revert old purchase ──
            const oldPurchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
            const oldItems = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(id);

            // Reverse stock for old items (subtract what was added)
            for (const item of oldItems) {
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal - item.quantity;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', 0, ?, ?, ?, 'Reversal of purchase #' || ?, 'purchase', ?)"
                ).run(item.product_id, oldPurchase.date, item.quantity, newBalance, item.rate, oldPurchase.bill_no, id);
            }

            // Remove old ledger and items
            db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'purchase' AND reference_id = ?").run(id);
            db.prepare("DELETE FROM purchase_items WHERE purchase_id = ?").run(id);

            // Update purchase record
            db.prepare(
                "UPDATE purchases SET bill_no=?, date=?, party_id=?, subtotal=?, discount=?, tax=?, transport_charges=?, extra_charges=?, grand_total=?, paid_amount=?, payment_mode=?, status=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(bill_no, date, party_id, subtotal, discount, tax,
                  transport_charges || 0, extra_charges || 0,
                  grand_total, paid_amount, payment_mode, status, notes, id);

            // Re-insert items with stock addition
            for (const item of items) {
                db.prepare(
                    "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(id, item.product_id, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + item.quantity;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, 0, ?, ?, 'Purchase ' || ?, 'purchase', ?)"
                ).run(item.product_id, date, item.quantity, newBalance, item.rate, bill_no, id);
            }

            // Add ledger entry
            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'purchase', ?, ?, ?, 0, ?)"
            ).run(party_id, date, id, `Purchase Bill ${bill_no}`, grand_total, outstanding);

            logAudit(db, 'purchases', id, 'update', oldPurchase, purchaseData, purchaseData.created_by);
            return { id };
        } else {
            // ── New purchase ──
            const result = db.prepare(
                "INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax, transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(bill_no, date, party_id, subtotal, discount, tax,
                  transport_charges || 0, extra_charges || 0,
                  grand_total, paid_amount, payment_mode, status, notes);
            const purchaseId = result.lastInsertRowid;

            for (const item of items) {
                db.prepare(
                    "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(purchaseId, item.product_id, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + item.quantity;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, 0, ?, ?, 'Purchase ' || ?, 'purchase', ?)"
                ).run(item.product_id, date, item.quantity, newBalance, item.rate, bill_no, purchaseId);
            }

            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'purchase', ?, ?, ?, 0, ?)"
            ).run(party_id, date, purchaseId, `Purchase Bill ${bill_no}`, grand_total, outstanding);

            logAudit(db, 'purchases', purchaseId, 'create', null, purchaseData, purchaseData.created_by);
            return { id: purchaseId };
        }
    });
    return trx();
}

/**
 * Delete a purchase with stock reversal and ledger cleanup.
 */
function deletePurchase(db, id, changedBy = null) {
    const trx = db.transaction(() => {
        const purchase = db.prepare("SELECT * FROM purchases WHERE id = ?").get(id);
        const items = db.prepare("SELECT * FROM purchase_items WHERE purchase_id = ?").all(id);

        // Reverse stock (subtract what was added)
        for (const item of items) {
            const lastBalance = db.prepare(
                "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
            ).get(item.product_id);
            const currentBal = lastBalance ? lastBalance.balance_after : 0;
            const newBalance = currentBal - item.quantity;
            db.prepare(
                "INSERT INTO stock_movements (product_id, date, type, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'purchase', ?, ?, ?, 'Deleted Purchase ' || ?, 'purchase', ?)"
            ).run(item.product_id, purchase.date, item.quantity, newBalance, item.rate, purchase.bill_no, id);
        }

        // Remove ledger and purchase
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'purchase' AND reference_id = ?").run(id);
        db.prepare("DELETE FROM purchases WHERE id = ?").run(id);
        logAudit(db, 'purchases', id, 'delete', purchase, null, changedBy);
        return { deleted: true };
    });
    return trx();
}

module.exports = { listPurchases, getPurchase, savePurchase, deletePurchase };
