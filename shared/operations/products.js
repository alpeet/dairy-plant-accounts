/**
 * Godhuli Dairy Plant — Product Operations
 * =========================================
 * Single source of truth for product CRUD.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

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

module.exports = { listProducts, getProduct, saveProduct, deleteProduct };
