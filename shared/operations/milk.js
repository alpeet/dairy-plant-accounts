/**
 * Godhuli Dairy Plant — Milk Collection Operations
 * =================================================
 * Single source of truth for milk collection CRUD, summary, and Raw Milk product.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * Find or auto-create the Raw Milk product used for stock tracking.
 */
function getOrCreateRawMilkProduct(db) {
    const existing = db.prepare(
        "SELECT id, rate FROM products WHERE LOWER(name) LIKE '%raw milk%' OR LOWER(name) = 'milk (raw)' LIMIT 1"
    ).get();
    if (existing) return existing;

    const result = db.prepare(
        "INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, notes) VALUES (?, 'liter', 'Milk', 0, 0, ?, 'Auto-created for milk collection tracking')"
    ).run('Raw Milk', 60);

    return { id: result.lastInsertRowid, rate: 60 };
}

/**
 * List milk collections with optional filters.
 */
function listMilkCollections(db, { search, from_date, to_date, party_id } = {}) {
    let query = `SELECT mc.*, p.name as farmer_name, p.phone as farmer_phone, rt.name as route_name
                 FROM milk_collections mc 
                 LEFT JOIN parties p ON mc.party_id = p.id 
                 LEFT JOIN routes rt ON mc.route_id = rt.id 
                 WHERE 1=1`;
    const params = [];
    if (search) {
        query += " AND (mc.collection_no LIKE ? OR p.name LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    if (from_date) { query += " AND mc.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND mc.date <= ?"; params.push(to_date); }
    if (party_id) { query += " AND mc.party_id = ?"; params.push(party_id); }
    query += " ORDER BY mc.date DESC, mc.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single milk collection record.
 */
function getMilkCollection(db, id) {
    return db.prepare(
        `SELECT mc.*, p.name as farmer_name, p.phone as farmer_phone, p.address as farmer_address, rt.name as route_name
         FROM milk_collections mc 
         LEFT JOIN parties p ON mc.party_id = p.id 
         LEFT JOIN routes rt ON mc.route_id = rt.id 
         WHERE mc.id = ?`
    ).get(id);
}

/**
 * Create or update a milk collection.
 * Updates stock movements (via Raw Milk product) and ledger entries atomically.
 */
function saveMilkCollection(db, data) {
    const trx = db.transaction(() => {
        const { id, collection_no, date, party_id, milk_type, quantity_liters,
                fat_percent, snf_percent, rate, amount, shift, status, notes,
                route_id, clr_percent, adulteration_test, rate_type,
                extra_per_unit, fixed_rate, fat_multiplier, snf_multiplier, calculated_rate } = data;

        const rawMilkProduct = getOrCreateRawMilkProduct(db);

        if (id) {
            // ── Revert old collection ──
            db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'milk_collection' AND reference_id = ?").run(id);

            // Capture old values for audit
            const oldCollection = db.prepare("SELECT * FROM milk_collections WHERE id = ?").get(id);

            // Reverse old stock movement
            if (oldCollection && oldCollection.quantity_liters > 0) {
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(rawMilkProduct.id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal - oldCollection.quantity_liters;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', 0, ?, ?, ?, 'Reversal of milk collection #' || ?, 'milk_collection', ?)"
                ).run(rawMilkProduct.id, date, oldCollection.quantity_liters, newBalance, rawMilkProduct.rate, collection_no, id);
            }

            // Update record with all fields
            db.prepare(
                `UPDATE milk_collections SET collection_no=?, date=?, party_id=?, milk_type=?, quantity_liters=?,
                 fat_percent=?, snf_percent=?, rate=?, amount=?, shift=?, status=?, notes=?,
                 route_id=?, clr_percent=?, adulteration_test=?, rate_type=?,
                 extra_per_unit=?, fixed_rate=?, fat_multiplier=?, snf_multiplier=?, calculated_rate=?,
                 updated_at=datetime('now','localtime') WHERE id=?`
            ).run(collection_no, date, party_id, milk_type, quantity_liters,
                  fat_percent || 0, snf_percent || 0, rate || 0, amount || 0,
                  shift || 'morning', status || 'pending', notes || '',
                  route_id || null, clr_percent || null, adulteration_test || 'not_tested', rate_type || 'formula',
                  extra_per_unit || 0, fixed_rate || 0, fat_multiplier || 7.15, snf_multiplier || 4.55, calculated_rate || 0,
                  id);

            // Add new ledger entry
            const ledgerBalance = status === 'paid' ? 0 : (amount || 0);
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'milk_collection', ?, ?, ?, 0, ?)"
            ).run(party_id, date, id, `Milk Collection ${collection_no}`, amount || 0, ledgerBalance);

            // Add new stock movement
            const newLiters = parseFloat(quantity_liters || 0);
            if (newLiters > 0) {
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(rawMilkProduct.id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + newLiters;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', ?, 0, ?, ?, 'Milk collection #' || ?, 'milk_collection', ?)"
                ).run(rawMilkProduct.id, date, newLiters, newBalance, rawMilkProduct.rate, collection_no, id);
            }

            logAudit(db, 'milk_collections', id, 'update', oldCollection, data, data.created_by);
            return { id };
        } else {
            // ── New collection with all enhanced fields ──
            const result = db.prepare(
                `INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters,
                 fat_percent, snf_percent, rate, amount, shift, status, notes,
                 route_id, clr_percent, adulteration_test, rate_type,
                 extra_per_unit, fixed_rate, fat_multiplier, snf_multiplier, calculated_rate)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(collection_no, date, party_id, milk_type, quantity_liters,
                  fat_percent || 0, snf_percent || 0, rate || 0, amount || 0,
                  shift || 'morning', status || 'pending', notes || '',
                  route_id || null, clr_percent || null, adulteration_test || 'not_tested', rate_type || 'formula',
                  extra_per_unit || 0, fixed_rate || 0, fat_multiplier || 7.15, snf_multiplier || 4.55, calculated_rate || 0);
            const newId = result.lastInsertRowid;

            // Add ledger entry (credit = plant owes farmer)
            const ledgerBalance = status === 'paid' ? 0 : (amount || 0);
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'milk_collection', ?, ?, ?, 0, ?)"
            ).run(party_id, date, newId, `Milk Collection ${collection_no}`, amount || 0, ledgerBalance);

            // Add stock movement (increase raw milk inventory)
            const newLiters = parseFloat(quantity_liters || 0);
            if (newLiters > 0) {
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(rawMilkProduct.id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal + newLiters;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', ?, 0, ?, ?, 'Milk collection #' || ?, 'milk_collection', ?)"
                ).run(rawMilkProduct.id, date, newLiters, newBalance, rawMilkProduct.rate, collection_no, newId);
            }

            logAudit(db, 'milk_collections', newId, 'create', null, data, data.created_by);
            return { id: newId };
        }
    });
    return trx();
}

/**
 * Delete a milk collection with ledger and stock reversal.
 */
function deleteMilkCollection(db, id, changedBy = null) {
    const trx = db.transaction(() => {
        const collection = db.prepare("SELECT * FROM milk_collections WHERE id = ?").get(id);

        // Remove ledger entry
        db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'milk_collection' AND reference_id = ?").run(id);

        // Reverse stock
        if (collection && collection.quantity_liters > 0) {
            const rawMilkProduct = getOrCreateRawMilkProduct(db);
            const lastBalance = db.prepare(
                "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
            ).get(rawMilkProduct.id);
            const currentBal = lastBalance ? lastBalance.balance_after : 0;
            const newBalance = currentBal - collection.quantity_liters;
            db.prepare(
                "INSERT INTO stock_movements (product_id, date, type, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', ?, ?, ?, 'Deleted milk collection #' || ?, 'milk_collection', ?)"
            ).run(rawMilkProduct.id, collection.date, collection.quantity_liters, newBalance, rawMilkProduct.rate, collection.collection_no, id);
        }

        logAudit(db, 'milk_collections', id, 'delete', collection, null, changedBy);
        db.prepare("DELETE FROM milk_collections WHERE id = ?").run(id);
        return { deleted: true };
    });
    return trx();
}

/**
 * Get milk collection summary/dashboard data for a given date (default today).
 */
function getMilkSummary(db, { date } = {}) {
    const today = date || new Date().toISOString().split('T')[0];

    const todayTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as total_liters, COALESCE(SUM(amount), 0) as total_amount, COUNT(*) as collection_count FROM milk_collections WHERE date = ?"
    ).get(today);

    const typeBreakdown = db.prepare(
        "SELECT milk_type, COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date = ? GROUP BY milk_type"
    ).all(today);

    const shiftBreakdown = db.prepare(
        "SELECT shift, COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date = ? GROUP BY shift"
    ).all(today);

    const weeklyTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date >= date('now', '-7 days')"
    ).get();

    const monthlyTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE strftime('%Y-%m', date) = strftime('%Y-%m', 'now')"
    ).get();

    const topFarmers = db.prepare(
        "SELECT p.name, COALESCE(SUM(mc.quantity_liters), 0) as liters, COALESCE(SUM(mc.amount), 0) as amount FROM milk_collections mc JOIN parties p ON mc.party_id = p.id WHERE strftime('%Y-%m', mc.date) = strftime('%Y-%m', 'now') GROUP BY mc.party_id, p.name ORDER BY liters DESC LIMIT 5"
    ).all();

    const pendingDue = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM milk_collections WHERE status IN ('pending', 'processed')"
    ).get();

    return {
        todayTotal,
        typeBreakdown,
        shiftBreakdown,
        weeklyTotal,
        monthlyTotal,
        topFarmers,
        pendingDue: pendingDue ? pendingDue.total : 0
    };
}

module.exports = {
    getOrCreateRawMilkProduct,
    listMilkCollections,
    getMilkCollection,
    saveMilkCollection,
    deleteMilkCollection,
    getMilkSummary
};
