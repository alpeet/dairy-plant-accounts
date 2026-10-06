/**
 * Prarambha Account & Stock Management — Product Operations
 * =========================================
 * Single source of truth for product CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * System "Plant Helper" products used to track internal plant operations
 * (mixing, cream separation, SMP/water standardization) in production batches.
 * They are created automatically when no matching product exists yet and
 * cannot be deleted while categorized as helpers.
 */
const PLANT_HELPER_CATEGORY = 'Plant Helpers';
const PLANT_HELPER_PRODUCTS = [
    { name: 'Mixed Milk', unit: 'liter', notes: 'Plant helper — mixed/standardized milk used in production batches', match: /mix(ed)?\s*milk/ },
    { name: 'Cream', unit: 'kg', notes: 'Plant helper — cream separated from milk (production output)', match: /cream/ },
    { name: 'SMP (Skimmed Milk Powder)', unit: 'kg', notes: 'Plant helper — powder added to standardize milk (production input)', match: /\bsmp\b|skimmed\s*milk\s*powder|milk\s*powder/ },
    { name: 'Water', unit: 'liter', notes: 'Plant helper — water added for standardization (production input)', match: /\bwater\b/ }
];

/**
 * Ensure plant helper products exist (idempotent).
 * If a product with a matching name already exists (e.g. the user's own
 * "Mix Milk" or "Cream"), that existing product is reused and nothing is
 * created — a helper product is only inserted when no match is found.
 * Called on every database initialization.
 */
function ensurePlantHelperProducts(db) {
    const all = db.prepare(
        `SELECT id, name FROM products
         ORDER BY (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = products.id) DESC`
    ).all();
    for (const helper of PLANT_HELPER_PRODUCTS) {
        const candidate = all.find(p => helper.match.test(String(p.name || '').toLowerCase()));
        if (candidate) continue; // existing product covers this helper
        db.prepare(
            "INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, notes) VALUES (?, ?, ?, 0, 0, 0, ?)"
        ).run(helper.name, helper.unit, PLANT_HELPER_CATEGORY, helper.notes);
    }
}

/**
 * List products with optional search.
 * `active_only` — entry screens (sale / purchase / bulk / production) pass this
 * so archived products leave every picker while history keeps them (D7).
 */
function listProducts(db, { search, active_only } = {}) {
    let query = "SELECT * FROM products WHERE 1=1";
    const params = [];
    if (active_only) query += ' AND active = 1';
    if (search) {
        query += " AND (name LIKE ? OR category LIKE ? OR code LIKE ?)";
        params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    query += " ORDER BY name";
    return db.prepare(query).all(...params);
}

/**
 * D7: expenses are not products. Electricity, rent, salary, internet, bank
 * charges and office expenses belong to the Expenses register (P&L) — block
 * them here so the Product Master can never grow an expense line again.
 */
const EXPENSE_LIKE_NAME = /\b(electricity|electric bills?|power bills?|internet( bills?)?|telephone|phone bills?|mobile recharges?|bank charges?|office expenses?|salaries|salary|rent|leases?|transport charges?|fuel bills?)\b/i;

function assertProductNotExpense(name) {
    if (EXPENSE_LIKE_NAME.test(String(name || ''))) {
        throw new Error(`"${String(name).trim()}" is an expense category, not a product — record it under Operations → Expenses`);
    }
}

/**
 * Get a single product by ID.
 */
function getProduct(db, id) {
    return db.prepare("SELECT * FROM products WHERE id = ?").get(id);
}

/**
 * Create or update a product.
 * When creating with opening_stock > 0, also inserts an opening stock movement.
 *
 * D7/D9: validates the name against expense words, carries code / active /
 * type flags, and records every rate change (prev → new, effective date,
 * reason, user) in `product_rate_history` — historical sales keep their own
 * line rate, so a rate change never rewrites a single old invoice.
 */
function saveProduct(db, product) {
    const name = String(product.name || '').trim();
    if (!name) throw new Error('Product name is required');
    assertProductNotExpense(name);

    const trx = db.transaction(() => {
        if (product.id) {
            const oldProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(product.id);
            if (!oldProduct) throw new Error('Product not found');
            db.prepare(
                `UPDATE products SET name=?, unit=?, category=?, opening_stock=?, reorder_level=?, rate=?, gst_rate=?, hsn_code=?, notes=?,
                    code=?, active=?, is_stocked=?, is_saleable=?, is_purchaseable=?, is_produced=?,
                    updated_at=datetime('now','localtime') WHERE id=?`
            ).run(
                name, product.unit || 'kg', product.category || '',
                product.opening_stock || 0, product.reorder_level || 0,
                product.rate || 0, product.gst_rate || 0, product.hsn_code || '',
                product.notes || '',
                product.code || '', product.active === 0 ? 0 : 1,
                product.is_stocked === 0 ? 0 : 1, product.is_saleable === 0 ? 0 : 1,
                product.is_purchaseable === 0 ? 0 : 1, product.is_produced === 0 ? 0 : 1,
                product.id
            );
            // Rate history — only when the rate actually changed.
            const newRate = Math.round((Number(product.rate) || 0) * 100) / 100;
            const oldRate = Math.round((Number(oldProduct.rate) || 0) * 100) / 100;
            if (Math.abs(newRate - oldRate) >= 0.005) {
                db.prepare(
                    `INSERT INTO product_rate_history (product_id, old_rate, new_rate, effective_from, reason, changed_by)
                     VALUES (?, ?, ?, ?, ?, ?)`
                ).run(product.id, oldRate, newRate,
                    String(product.rate_effective_from || '').trim(),
                    String(product.rate_reason || '').trim(),
                    product.created_by || null);
            }
            logAudit(db, 'products', product.id, 'update', oldProduct, product, product.created_by);
            return { id: product.id };
        } else {
            const result = db.prepare(
                `INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, gst_rate, hsn_code, notes,
                    code, active, is_stocked, is_saleable, is_purchaseable, is_produced)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                name, product.unit || 'kg', product.category || '',
                product.opening_stock || 0, product.reorder_level || 0,
                product.rate || 0, product.gst_rate || 0, product.hsn_code || '',
                product.notes || '',
                product.code || '', product.active === 0 ? 0 : 1,
                product.is_stocked === 0 ? 0 : 1, product.is_saleable === 0 ? 0 : 1,
                product.is_purchaseable === 0 ? 0 : 1, product.is_produced === 0 ? 0 : 1
            );
            const newId = result.lastInsertRowid;
            logAudit(db, 'products', newId, 'create', null, product, product.created_by);
            // Opening rate change is the product's birth — history starts here.
            const rate = Math.round((Number(product.rate) || 0) * 100) / 100;
            if (rate !== 0) {
                db.prepare(
                    `INSERT INTO product_rate_history (product_id, old_rate, new_rate, effective_from, reason, changed_by)
                     VALUES (?, 0, ?, ?, 'Initial rate', ?)`
                ).run(newId, rate, String(product.rate_effective_from || '').trim(), product.created_by || null);
            }
            const opening = parseFloat(product.opening_stock || 0);
            if (opening > 0) {
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, date('now','localtime'), 'opening', ?, 0, ?, ?, 'Opening Stock')"
                ).run(newId, opening, opening, product.rate || 0);
            }
            return { id: newId };
        }
    });
    return trx();
}

/** Rate history for one product (newest first), with the user's name. */
function getProductRateHistory(db, { product_id } = {}) {
    if (!product_id) return [];
    return db.prepare(`
        SELECT h.*, u.username AS changed_by_name
          FROM product_rate_history h LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.product_id = ?
         ORDER BY h.created_at DESC, h.id DESC
    `).all(product_id);
}

/**
 * Delete a product if it has no transaction history — otherwise ARCHIVE it
 * (D7: history from sales/purchases/stock must survive; the product simply
 * leaves every entry picker and stays visible in the master with its past).
 */
function deleteProduct(db, id, changedBy = null) {
    const oldProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    if (!oldProduct) return { deleted: false, archived: false };
    const hasMovements = db.prepare(
        "SELECT COUNT(*) as count FROM stock_movements WHERE product_id = ? AND type != 'opening'"
    ).get(id);
    const hasHistory = db.prepare(
        `SELECT (SELECT COUNT(*) FROM sales_items WHERE product_id = ?)
              + (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?)
              + (SELECT COUNT(*) FROM production_outputs WHERE product_id = ?)
              + (SELECT COUNT(*) FROM production_inputs WHERE product_id = ?) AS c`
    ).get(id, id, id, id);
    if (hasMovements.count > 0 || hasHistory.c > 0) {
        if (oldProduct.active === 0) {
            return { deleted: false, archived: true, reason: 'already archived (has transaction history)' };
        }
        db.prepare("UPDATE products SET active = 0, updated_at=datetime('now','localtime') WHERE id = ?").run(id);
        logAudit(db, 'products', id, 'update', oldProduct, { ...oldProduct, active: 0 }, changedBy);
        return { deleted: false, archived: true, reason: 'has transaction history — archived instead of deleted' };
    }
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    db.prepare("DELETE FROM stock_movements WHERE product_id = ?").run(id);
    db.prepare("DELETE FROM product_rate_history WHERE product_id = ?").run(id);
    logAudit(db, 'products', id, 'delete', oldProduct, null, changedBy);
    return { deleted: true };
}

module.exports = {
    listProducts, getProduct, saveProduct, deleteProduct, getProductRateHistory,
    ensurePlantHelperProducts, PLANT_HELPER_CATEGORY, EXPENSE_LIKE_NAME, assertProductNotExpense
};
