/**
 * Godhuli Dairy Plant — Audit Log Operations
 * ============================================
 * Simple audit trail helper that records who changed what and when.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * Injects audit entries into every create/update/delete operation.
 */

/**
 * Record an audit log entry.
 *
 * @param {object} db - better-sqlite3 database instance
 * @param {string} tableName - The table that was changed
 * @param {number} recordId - The ID of the record that was changed
 * @param {string} action - 'create', 'update', or 'delete'
 * @param {object|null} oldValues - Previous values (for update/delete)
 * @param {object|null} newValues - New values (for create/update)
 * @param {number|null} changedBy - User ID who made the change
 */
function logAudit(db, tableName, recordId, action, oldValues, newValues, changedBy) {
    try {
        db.prepare(`
            INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            tableName,
            recordId,
            action,
            oldValues ? JSON.stringify(oldValues) : '',
            newValues ? JSON.stringify(newValues) : '',
            changedBy || null
        );
    } catch (err) {
        // Audit logging should never break the main operation
        console.error('Audit log error (non-fatal):', err.message);
    }
}

/**
 * Query audit logs with filters.
 */
function getAuditLogs(db, { table_name, from_date, to_date, action } = {}) {
    let query = `SELECT al.*, u.username as changed_by_name 
                 FROM audit_log al LEFT JOIN users u ON al.changed_by = u.id WHERE 1=1`;
    const params = [];
    if (table_name) { query += " AND al.table_name = ?"; params.push(table_name); }
    if (action) { query += " AND al.action = ?"; params.push(action); }
    if (from_date) { query += " AND al.changed_at >= ?"; params.push(from_date); }
    if (to_date) { query += " AND al.changed_at <= ?"; params.push(to_date); }
    query += " ORDER BY al.changed_at DESC LIMIT 200";
    return db.prepare(query).all(...params);
}

module.exports = { logAudit, getAuditLogs };
