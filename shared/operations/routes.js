/**
 * Godhuli Dairy Plant — Route / Collection Center Operations
 * ===========================================================
 * CRUD for route and collection center management.
 */

const { logAudit } = require('./audit');

function listRoutes(db, { search } = {}) {
    let query = "SELECT * FROM routes WHERE 1=1";
    const params = [];
    if (search) { query += " AND (name LIKE ? OR area LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    query += " ORDER BY name";
    return db.prepare(query).all(...params);
}

function getRoute(db, id) {
    return db.prepare("SELECT * FROM routes WHERE id = ?").get(id);
}

function saveRoute(db, data) {
    const trx = db.transaction(() => {
        if (data.id) {
            const oldRoute = db.prepare("SELECT * FROM routes WHERE id = ?").get(data.id);
            db.prepare(
                "UPDATE routes SET name=?, area=?, assigned_vehicle=?, assigned_staff=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?"
            ).run(data.name, data.area || '', data.assigned_vehicle || '', data.assigned_staff || '', data.notes || '', data.id);
            logAudit(db, 'routes', data.id, 'update', oldRoute, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(
                "INSERT INTO routes (name, area, assigned_vehicle, assigned_staff, notes) VALUES (?, ?, ?, ?, ?)"
            ).run(data.name, data.area || '', data.assigned_vehicle || '', data.assigned_staff || '', data.notes || '');
            logAudit(db, 'routes', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

function deleteRoute(db, id, changedBy = null) {
    const oldRoute = db.prepare("SELECT * FROM routes WHERE id = ?").get(id);
    const farmers = db.prepare("SELECT COUNT(*) as c FROM parties WHERE route_id = ?").get(id);
    if (farmers.c > 0) throw new Error('Cannot delete route with linked farmers. Remove route links first.');
    db.prepare("DELETE FROM routes WHERE id = ?").run(id);
    logAudit(db, 'routes', id, 'delete', oldRoute, null, changedBy);
    return { deleted: true };
}

function getRouteSummary(db, { from_date, to_date } = {}) {
    const from = from_date || '2000-01-01';
    const to = to_date || new Date().toISOString().split('T')[0];

    const routes = db.prepare(`
        SELECT r.*,
            COALESCE(SUM(mc.quantity_liters), 0) as total_liters,
            COALESCE(SUM(mc.amount), 0) as total_amount,
            COUNT(mc.id) as collection_count,
            COUNT(DISTINCT mc.party_id) as farmer_count,
            COALESCE(AVG(mc.fat_percent), 0) as avg_fat,
            COALESCE(AVG(mc.snf_percent), 0) as avg_snf
        FROM routes r
        LEFT JOIN milk_collections mc ON r.id = mc.route_id AND mc.date >= ? AND mc.date <= ?
        GROUP BY r.id ORDER BY r.name
    `).all(from, to);

    return routes;
}

module.exports = { listRoutes, getRoute, saveRoute, deleteRoute, getRouteSummary };
