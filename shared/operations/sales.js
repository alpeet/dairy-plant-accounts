/**
 * Prarambha Account & Stock Management — Sales Operations
 * =======================================
 * Single source of truth for sales CRUD with stock and ledger updates.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * All save/delete operations are transactional — they update stock movements
 * and ledger entries atomically.
 */

const { logAudit } = require('./audit');
const { getSaleSettlements, paymentStatus, round2 } = require('./accounting');

/** Money modes a receipt can be recorded under. */
const RECEIPT_MODES = ['cash', 'bank', 'upi', 'cheque'];

/**
 * Post the money received with the invoice as a REAL receipt transaction
 * (Cash/Bank DR · Customer/Receivable CR) instead of leaving it only as a
 * denormalised paid_amount. Payment status is then derived from actual receipt
 * transactions everywhere, which is what keeps Sales, Receivable, Cash and the
 * Daybook in agreement on the same invoice.
 *
 * Invoice-time receipts are tagged reference_type='sale' with the sale id, so
 * they can be re-written or reversed with the invoice and never confused with
 * collections recorded from the Payment Collection screen.
 * @private
 */
function _clearSaleReceipts(db, saleId) {
    db.prepare(
        "DELETE FROM ledger_entries WHERE reference_type = 'payment_received' AND reference_id IN (SELECT id FROM payments WHERE reference_type = 'sale' AND reference_id = ?)"
    ).run(saleId);
    db.prepare("DELETE FROM payments WHERE reference_type = 'sale' AND reference_id = ?").run(saleId);
}

/** @private */
function _postSaleReceipt(db, saleId, { party_id, date, amount, mode, invoice_no }) {
    const received = round2(amount);
    if (!(received > 0)) return;
    const receiptMode = RECEIPT_MODES.includes(String(mode || '').toLowerCase()) ? String(mode).toLowerCase() : 'cash';
    const ins = db.prepare(
        "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, 'receipt', ?, ?, 'sale', ?, ?)"
    ).run(party_id, date, received, receiptMode, saleId, `Received on invoice ${invoice_no || ('#' + saleId)}`);
    db.prepare(
        "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_received', ?, ?, 0, ?, 0)"
    ).run(party_id, date, ins.lastInsertRowid, `Received on invoice ${invoice_no || ('#' + saleId)}`, received);
}

/**
 * List sales with optional filters.
 * `status` / `received_amount` / `outstanding_amount` are derived from the
 * actual receipts against each invoice (currency-precision aware), so a
 * Rs 1,000 receipt against a Rs 10,000 invoice reads Partial.
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
    const rows = db.prepare(query).all(...params);
    if (!rows.length) return rows;
    // Settle against the party's whole history so the oldest-invoice-first
    // allocation is right even when the list is filtered to a date range.
    const partyIds = [...new Set(rows.map(r => r.party_id).filter(v => v != null))];
    const { by_id } = getSaleSettlements(db, { party_ids: partyIds });
    return rows.map(r => {
        const st = by_id.get(Number(r.id));
        if (!st) return r;
        return { ...r, received_amount: st.received, outstanding_amount: st.outstanding, status: st.status, status_source: 'receipts' };
    });
}

/**
 * Get a single sale with items and its actual settlement.
 */
function getSale(db, id) {
    const sale = db.prepare(
        `SELECT s.*, p.name as party_name, p.address as party_address,
                p.phone as party_phone, p.pan_vat as party_pan
         FROM sales s LEFT JOIN parties p ON s.party_id = p.id WHERE s.id = ?`
    ).get(id);
    if (!sale) return null;
    const items = db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);
    const st = getSaleSettlements(db, { party_id: sale.party_id }).by_id.get(Number(id));
    return {
        ...sale,
        items,
        received_amount: st ? st.received : round2(sale.paid_amount || 0),
        outstanding_amount: st ? st.outstanding : Math.max(0, round2((sale.grand_total || 0) - (sale.paid_amount || 0))),
        status: st ? st.status : sale.status,
        status_source: st ? 'receipts' : 'document'
    };
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
                discount_percent, tax, grand_total, paid_amount, payment_mode, notes } = saleData;
        // The stored status is derived from the money received at invoice time
        // (currency-precision aware) — the dropdown value is not trusted, and
        // every read recomputes it from the actual receipts anyway.
        const status = paymentStatus(paid_amount, grand_total);

        if (id) {
            // ── Revert old sale ──
            const oldSale = db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
            const oldItems = db.prepare("SELECT * FROM sales_items WHERE sale_id = ?").all(id);

            // Reverse stock for old items (manual items without stock tracking are skipped)
            for (const item of oldItems) {
                if (!item.product_id) continue;
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(item.product_id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + item.quantity;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'Reversal of sale #' || ?, 'sale', ?)"
                ).run(item.product_id, oldSale.date, item.quantity, newBalance, item.rate, oldSale.invoice_no, id);
            }

            // Remove old ledger, invoice-time receipt and items
            db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(id);
            _clearSaleReceipts(db, id);
            db.prepare("DELETE FROM sales_items WHERE sale_id = ?").run(id);

            // Update sale record
            db.prepare(
                "UPDATE sales SET invoice_no=?, date=?, party_id=?, subtotal=?, discount=?, discount_percent=?, tax=?, grand_total=?, paid_amount=?, payment_mode=?, status=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes, id);

            // Re-insert items with stock deduction (manual items without product_id skip stock)
            for (const item of items) {
                db.prepare(
                    "INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)"
                ).run(id, item.product_id || null, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                if (!item.product_id) continue;

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

            // Add ledger entry (Customer/Receivable DR · Sales CR)
            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
            ).run(party_id, date, id, `Sale Invoice ${invoice_no}`, grand_total, outstanding);

            // Re-post the money received with the invoice as a real receipt
            _clearSaleReceipts(db, id);
            _postSaleReceipt(db, id, { party_id, date, amount: paid_amount, mode: payment_mode, invoice_no });

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
                ).run(saleId, item.product_id || null, item.product_name || item.name, item.quantity, item.unit || 'kg', item.rate, item.amount);

                // Manual (custom-typed) items without a product skip stock tracking
                if (!item.product_id) continue;

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

            // Customer/Receivable DR · Sales CR
            const outstanding = grand_total - paid_amount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'sale', ?, ?, ?, 0, ?)"
            ).run(party_id, date, saleId, `Sale Invoice ${invoice_no}`, grand_total, outstanding);

            // Money received with the invoice, recorded as a real receipt so the
            // payment status is derived from transactions, not from a flag.
            _postSaleReceipt(db, saleId, { party_id, date, amount: paid_amount, mode: payment_mode, invoice_no });

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

        // Reverse stock (manual items without stock tracking are skipped)
        for (const item of items) {
            if (!item.product_id) continue;
            const lastBalance = db.prepare(
                "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
            ).get(item.product_id);
            const currentBal = lastBalance ? lastBalance.balance_after : 0;
            const newBalance = currentBal + item.quantity;
            db.prepare(
                "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'adjustment', ?, 0, ?, ?, 'Deleted Sale ' || ?, 'sale', ?)"
            ).run(item.product_id, sale.date, item.quantity, newBalance, item.rate, sale.invoice_no, id);
        }

        // Remove ledger, invoice-time receipt and sale
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'sale' AND reference_id = ?").run(id);
        _clearSaleReceipts(db, id);
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

module.exports = { listSales, getSale, saveSale, deleteSale, RECEIPT_MODES };
