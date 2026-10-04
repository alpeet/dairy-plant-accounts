/**
 * Prarambha Account & Stock Management — Milk Collection Operations
 * =================================================
 * Single source of truth for milk collection CRUD, summary, and Raw Milk product.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * Find or auto-create the raw milk product used for stock tracking
 * for a given milk type (cow / buffalo / mixed).
 * Each type gets its own product so purchased milk stock is tracked separately.
 * Existing products are reused first — e.g. a user-created "Cow Milk" product
 * with stock history is used for cow collections instead of creating a duplicate.
 */
function getOrCreateRawMilkProduct(db, milkType) {
    const type = String(milkType || '').toLowerCase();
    const isTyped = type === 'cow' || type === 'buffalo';
    const productName = isTyped ? `Raw Milk (${type === 'cow' ? 'Cow' : 'Buffalo'})` : 'Raw Milk';

    // 1. Exact name match (case-insensitive), most stock history first
    const exact = db.prepare(
        `SELECT id, name, rate FROM products
         WHERE LOWER(name) = LOWER(?)
         ORDER BY (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = products.id) DESC
         LIMIT 1`
    ).get(productName);
    if (exact) return exact;

    // 2. Reuse an existing product that clearly represents this milk type
    //    (picks the one with the most stock movements — history wins over dups)
    const typePattern = isTyped
        ? (type === 'cow' ? /\bcow\b/ : /\bbuffal(o)?\b/)
        : /\bmilk\b(?!\s*powder)/; // mixed: any milk product except powder
    const all = db.prepare(
        `SELECT id, name, rate FROM products
         ORDER BY (SELECT COUNT(*) FROM stock_movements sm WHERE sm.product_id = products.id) DESC`
    ).all();
    const candidate = all.find(p => typePattern.test(String(p.name || '').toLowerCase()));
    if (candidate) return { id: candidate.id, name: candidate.name, rate: candidate.rate };

    // 3. Legacy fuzzy match for old generic raw-milk rows (untyped only)
    if (!isTyped) {
        const legacy = all.find(p => /raw\s*milk|milk\s*\(raw\)/.test(String(p.name || '').toLowerCase()));
        if (legacy) return { id: legacy.id, name: legacy.name, rate: legacy.rate };
    }

    // 4. Create the typed product
    const notes = isTyped
        ? `Auto-created for ${type} milk collection tracking`
        : 'Auto-created for milk collection tracking (mixed/untyped)';
    const result = db.prepare(
        "INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, notes) VALUES (?, 'liter', 'Milk', 0, 0, 60, ?)"
    ).run(productName, notes);

    return { id: result.lastInsertRowid, name: productName, rate: 60 };
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
                extra_per_unit, fixed_rate, fat_multiplier, snf_multiplier, rate_override_reason } = data;

        const rawMilkProduct = getOrCreateRawMilkProduct(db, milk_type);

        // ── One authoritative price ──────────────────────────────────────
        // The engine resolves the supplier-specific chart (falls back to the
        // plant-wide chart) and answers what this litre must cost. The stored
        // rate is the caller's rate when one was given (single entry, bulk,
        // import all pass the rate they display), otherwise the resolved rate
        // — so the server, not the screen, decides what milk costs.
        const { resolveMilkRate } = require('./rates');
        const resolved = resolveMilkRate(db, {
            date, party_id, milk_type, fat: fat_percent, snf: snf_percent,
            rate, rate_type, fixed_rate
        });
        const chart = resolved.chart || {};
        const effRate = (rate === undefined || rate === null || rate === '')
            ? resolved.calculated_rate : Number(rate) || 0;
        const effCalculated = resolved.calculated_rate;
        const effRateType = rate_type || resolved.rate_type || 'formula';
        const effFatMult = chart.fat_multiplier != null ? chart.fat_multiplier : (Number(fat_multiplier) || 7.15);
        const effSnfMult = chart.snf_multiplier != null ? chart.snf_multiplier : (Number(snf_multiplier) || 4.55);
        const effExtra = chart.extra_per_unit != null ? chart.extra_per_unit : (Number(extra_per_unit) || 0);
        const effFixed = effRateType === 'fixed'
            ? (Number(fixed_rate) || Number(chart.fixed_rate) || 0)
            : (chart.fixed_rate != null ? chart.fixed_rate : (Number(fixed_rate) || 0));
        const effOverrideReason = String(rate_override_reason || '').trim();
        // Amount is derived when the caller did not send one — the user never
        // has to compute the payable by hand (spec Phase 4).
        const qty = Number(quantity_liters) || 0;
        const effAmount = (amount === undefined || amount === null || amount === '')
            ? Math.round(effRate * qty * 100) / 100 : (Number(amount) || 0);

        if (id) {
            // ── Revert old collection ──
            db.prepare("DELETE FROM ledger_entries WHERE reference_type = 'milk_collection' AND reference_id = ?").run(id);

            // Capture old values for audit
            const oldCollection = db.prepare("SELECT * FROM milk_collections WHERE id = ?").get(id);

            // Reverse old stock movement — use the OLD collection's product so
            // stock is taken back from the correct raw milk type even if milk_type changed
            if (oldCollection && oldCollection.quantity_liters > 0) {
                const oldRawMilkProduct = getOrCreateRawMilkProduct(db, oldCollection.milk_type);
                const lastBalance = db.prepare(
                    "SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1"
                ).get(oldRawMilkProduct.id);
                const currentBal = lastBalance ? lastBalance.balance_after : 0;
                const newBalance = currentBal - oldCollection.quantity_liters;
                db.prepare(
                    "INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'milk_collection', 0, ?, ?, ?, 'Reversal of milk collection #' || ?, 'milk_collection', ?)"
                ).run(oldRawMilkProduct.id, date, oldCollection.quantity_liters, newBalance, oldRawMilkProduct.rate, collection_no, id);
            }

            // Update record with all fields
            db.prepare(
                `UPDATE milk_collections SET collection_no=?, date=?, party_id=?, milk_type=?, quantity_liters=?,
                 fat_percent=?, snf_percent=?, rate=?, amount=?, shift=?, status=?, notes=?,
                 route_id=?, clr_percent=?, adulteration_test=?, rate_type=?,
                 extra_per_unit=?, fixed_rate=?, fat_multiplier=?, snf_multiplier=?, calculated_rate=?,
                 rate_override_reason=?,
                 updated_at=datetime('now','localtime') WHERE id=?`
            ).run(collection_no, date, party_id, milk_type, quantity_liters,
                  fat_percent || 0, snf_percent || 0, effRate, effAmount,
                  shift || 'morning', status || 'pending', notes || '',
                  route_id || null, clr_percent || null, adulteration_test || 'not_tested', effRateType,
                  effExtra, effFixed, effFatMult, effSnfMult, effCalculated,
                  effOverrideReason, id);

            // Add new ledger entry (the payable is the resolved amount)
            const ledgerBalance = status === 'paid' ? 0 : effAmount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'milk_collection', ?, ?, ?, 0, ?)"
            ).run(party_id, date, id, `Milk Collection ${collection_no}`, effAmount, ledgerBalance);

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

            // Keep the raw-milk lot in step (lot layer ignores pre-cutover dates).
            try {
                const costing = require('./production_costing');
                if (oldCollection) costing.deleteMilkLotByCollection(db, oldCollection.id);
                costing.createMilkLot(db, db.prepare('SELECT * FROM milk_collections WHERE id = ?').get(id));
            } catch (e) { /* lot tables not migrated yet or already consumed */ }

            logAudit(db, 'milk_collections', id, 'update', oldCollection, data, data.created_by);
            return { id };
        } else {
            // ── New collection with all enhanced fields ──
            const result = db.prepare(
                `INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters,
                 fat_percent, snf_percent, rate, amount, shift, status, notes,
                 route_id, clr_percent, adulteration_test, rate_type,
                 extra_per_unit, fixed_rate, fat_multiplier, snf_multiplier, calculated_rate,
                 rate_override_reason)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(collection_no, date, party_id, milk_type, quantity_liters,
                  fat_percent || 0, snf_percent || 0, effRate, effAmount,
                  shift || 'morning', status || 'pending', notes || '',
                  route_id || null, clr_percent || null, adulteration_test || 'not_tested', effRateType,
                  effExtra, effFixed, effFatMult, effSnfMult, effCalculated,
                  effOverrideReason);
            const newId = result.lastInsertRowid;

            // Add ledger entry (credit = plant owes farmer, at the resolved amount)
            const ledgerBalance = status === 'paid' ? 0 : effAmount;
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, credit, debit, balance) VALUES (?, ?, 'milk_collection', ?, ?, ?, 0, ?)"
            ).run(party_id, date, newId, `Milk Collection ${collection_no}`, effAmount, ledgerBalance);

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

            // Raw-milk lot for FIFO costing (no-op before the lot cutover date).
            try {
                require('./production_costing').createMilkLot(db, db.prepare('SELECT * FROM milk_collections WHERE id = ?').get(newId));
            } catch (e) { /* lot tables not migrated yet */ }

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

        // Remove the lot (refuses if a batch already consumed it).
        try { require('./production_costing').deleteMilkLotByCollection(db, id); } catch (e) {
            throw new Error('Cannot delete this collection: ' + e.message);
        }

        // Reverse stock
        if (collection && collection.quantity_liters > 0) {
            const rawMilkProduct = getOrCreateRawMilkProduct(db, collection.milk_type);
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

// Exact AD → BS conversion (stored dates are BS dates)
const { adToBS, todayBSDate } = require('../excel-import');

function getMilkSummary(db, { date } = {}) {
    const today = date || todayBSDate();
    const bsMonthPrefix = today.slice(0, 7);
    // "Last 7 days" boundary: convert the AD date 7 days ago to BS (exact)
    const weekAgoAD = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
    const weekAgoBS = adToBS(weekAgoAD) || weekAgoAD;

    const todayTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as total_liters, COALESCE(SUM(amount), 0) as total_amount, COUNT(*) as collection_count FROM milk_collections WHERE date = ?"
    ).get(today);

    const typeBreakdown = db.prepare(
        "SELECT milk_type, COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date = ? GROUP BY milk_type"
    ).all(today);

    const shiftBreakdown = db.prepare(
        "SELECT shift, COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date = ? GROUP BY shift"
    ).all(today);

    // BS-month prefix comparison (strftime() returns NULL for valid BS dates
    // like 2083-03-32, so string slicing is used instead)
    const weeklyTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE date >= ?"
    ).get(weekAgoBS);

    const monthlyTotal = db.prepare(
        "SELECT COALESCE(SUM(quantity_liters), 0) as liters, COALESCE(SUM(amount), 0) as amount FROM milk_collections WHERE substr(date, 1, 7) = ?"
    ).get(bsMonthPrefix);

    const topFarmers = db.prepare(
        "SELECT p.name, COALESCE(SUM(mc.quantity_liters), 0) as liters, COALESCE(SUM(mc.amount), 0) as amount FROM milk_collections mc JOIN parties p ON mc.party_id = p.id WHERE substr(mc.date, 1, 7) = ? GROUP BY mc.party_id, p.name ORDER BY liters DESC LIMIT 5"
    ).all(bsMonthPrefix);

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
