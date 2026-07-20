/**
 * Godhuli Dairy Plant — Vehicle Expenses Operations
 * ==================================================
 * CRUD for vehicle expenses register.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List vehicle expenses with optional filters.
 */
function listVehicleExpenses(db, { from_date, to_date, vehicle_name, expense_type } = {}) {
    let query = `SELECT ve.*, u.username as created_by_name 
                 FROM vehicle_expenses ve LEFT JOIN users u ON ve.created_by = u.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND ve.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND ve.date <= ?"; params.push(to_date); }
    if (vehicle_name) { query += " AND ve.vehicle_name LIKE ?"; params.push(`%${vehicle_name}%`); }
    if (expense_type) { query += " AND ve.expense_type = ?"; params.push(expense_type); }
    query += " ORDER BY ve.date DESC, ve.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single vehicle expense.
 */
function getVehicleExpense(db, id) {
    return db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(id);
}

/**
 * Save a vehicle expense (create or update).
 * Calculates total_amount from all amount fields.
 */
function saveVehicleExpense(db, data) {
    const trx = db.transaction(() => {
        const fuel = parseFloat(data.fuel_amount || 0);
        const repair = parseFloat(data.repair_amount || 0);
        const maintenance = parseFloat(data.maintenance_amount || 0);
        const toll = parseFloat(data.toll_parking_amount || 0);
        const other = parseFloat(data.other_amount || 0);
        const total = fuel + repair + maintenance + toll + other;

        // Determine expense_type based on which amount is largest
        let expenseType = data.expense_type || 'other';
        if (!data.expense_type || data.expense_type === '') {
            const amounts = { fuel, repair, maintenance, toll_parking: toll, other };
            expenseType = Object.keys(amounts).reduce((a, b) => amounts[a] > amounts[b] ? a : b);
        }

        if (data.id) {
            const oldEntry = db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE vehicle_expenses SET date=?, vehicle_name=?, driver_name=?, expense_type=?,
                    fuel_amount=?, repair_amount=?, maintenance_amount=?, toll_parking_amount=?,
                    other_amount=?, total_amount=?, remarks=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.date, data.vehicle_name, data.driver_name || '', expenseType,
                fuel, repair, maintenance, toll, other, total,
                data.remarks || '', data.id
            );
            logAudit(db, 'vehicle_expenses', data.id, 'update', oldEntry, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO vehicle_expenses (date, vehicle_name, driver_name, expense_type,
                    fuel_amount, repair_amount, maintenance_amount, toll_parking_amount,
                    other_amount, total_amount, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.date, data.vehicle_name, data.driver_name || '', expenseType,
                fuel, repair, maintenance, toll, other, total,
                data.remarks || '', data.created_by || null
            );
            logAudit(db, 'vehicle_expenses', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete a vehicle expense.
 */
function deleteVehicleExpense(db, id, changedBy = null) {
    const oldEntry = db.prepare("SELECT * FROM vehicle_expenses WHERE id = ?").get(id);
    db.prepare("DELETE FROM vehicle_expenses WHERE id = ?").run(id);
    logAudit(db, 'vehicle_expenses', id, 'delete', oldEntry, null, changedBy);
    return { deleted: true };
}

/**
 * Get vehicle expenses summary.
 */
function getVehicleExpensesSummary(db, { from_date, to_date } = {}) {
    let query = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(total_amount), 0) as total,
                        COALESCE(SUM(fuel_amount), 0) as total_fuel, COALESCE(SUM(repair_amount), 0) as total_repair,
                        COALESCE(SUM(maintenance_amount), 0) as total_maintenance, COALESCE(SUM(toll_parking_amount), 0) as total_toll,
                        COALESCE(SUM(other_amount), 0) as total_other
                 FROM vehicle_expenses WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND date <= ?"; params.push(to_date); }
    return db.prepare(query).get(...params);
}

module.exports = { listVehicleExpenses, getVehicleExpense, saveVehicleExpense, deleteVehicleExpense, getVehicleExpensesSummary };
