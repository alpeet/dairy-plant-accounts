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
 */
function listProducts(db, { search } = {}) {
    let query = "SELECT * FROM products WHERE 1=1";
    const params = [];
    if (search) {
        query += " AND (name LIKE ? OR category LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY name";
    return db.prepare(query).all(...params);
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
 */
function saveProduct(db, product) {
    const trx = db.transaction(() => {
        if (product.id) {
            const oldProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(product.id);
            db.prepare(
                "UPDATE products SET name=?, unit=?, category=?, opening_stock=?, reorder_level=?, rate=?, gst_rate=?, hsn_code=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(
                product.name, product.unit || 'kg', product.category || '',
                product.opening_stock || 0, product.reorder_level || 0,
                product.rate || 0, product.gst_rate || 0, product.hsn_code || '',
                product.notes || '', product.id
            );
            logAudit(db, 'products', product.id, 'update', oldProduct, product, product.created_by);
            return { id: product.id };
        } else {
            const result = db.prepare(
                "INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, gst_rate, hsn_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(
                product.name, product.unit || 'kg', product.category || '',
                product.opening_stock || 0, product.reorder_level || 0,
                product.rate || 0, product.gst_rate || 0, product.hsn_code || '',
                product.notes || ''
            );
            const newId = result.lastInsertRowid;
            logAudit(db, 'products', newId, 'create', null, product, product.created_by);
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

/**
 * Delete a product if it has no transaction history.
 * Also cleans up opening stock movements.
 */
function deleteProduct(db, id, changedBy = null) {
    const oldProduct = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
    const hasMovements = db.prepare(
        "SELECT COUNT(*) as count FROM stock_movements WHERE product_id = ? AND type != 'opening'"
    ).get(id);
    if (hasMovements.count > 0) {
        throw new Error('Cannot delete product with transaction history.');
    }
    db.prepare("DELETE FROM products WHERE id = ?").run(id);
    db.prepare("DELETE FROM stock_movements WHERE product_id = ?").run(id);
    logAudit(db, 'products', id, 'delete', oldProduct, null, changedBy);
    return { deleted: true };
}

module.exports = { listProducts, getProduct, saveProduct, deleteProduct, ensurePlantHelperProducts, PLANT_HELPER_CATEGORY };
