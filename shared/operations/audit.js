/**
 * Prarambha Account & Stock Management — Audit Log Operations
 * ============================================
 * Simple audit trail helper that records who changed what and when.
 * Used by both Electron (main.js) and Web (server.js).
 *
 * Injects audit entries into every create/update/delete operation.
 */

const { bsToAD } = require('../excel-import');

// Fields that must never be written into the audit trail (secrets).
const REDACTED_KEYS = /pass|secret|token|hash|code|pin/i;

/**
 * Strip sensitive keys from a values object before persisting it.
 * Values are replaced with '[redacted]' so structure stays visible.
 */
function sanitizeValues(values) {
    if (!values || typeof values !== 'object') return values;
    const out = {};
    for (const [k, v] of Object.entries(values)) {
        out[k] = REDACTED_KEYS.test(k) ? '[redacted]' : v;
    }
    return out;
}

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
            oldValues ? JSON.stringify(sanitizeValues(oldValues)) : '',
            newValues ? JSON.stringify(sanitizeValues(newValues)) : '',
            changedBy || null
        );
    } catch (err) {
        // Audit logging should never break the main operation
        console.error('Audit log error (non-fatal):', err.message);
    }
}

/**
 * Query audit logs with filters.
 *
 * Date filters arrive as BS (Bikram Sambat) 'YYYY-MM-DD' strings from the UI,
 * but `audit_log.changed_at` stores an AD datetime — so BS filters are converted
 * to an AD range BEFORE querying (never the other way round; the stored data is
 * authoritative). to_date is inclusive to the end of that BS day.
 *
 * The result also always carries `username` (same value as `changed_by_name`)
 * because the renderer historically reads `log.username`.
 */
function getAuditLogs(db, { table_name, from_date, to_date, action } = {}) {
    let query = `SELECT al.*, u.username as changed_by_name 
                 FROM audit_log al LEFT JOIN users u ON al.changed_by = u.id WHERE 1=1`;
    const params = [];

    // BS → AD range conversion for the changed_at filter (changed_at is AD).
    const fromAD = from_date ? bsToAD(String(from_date).slice(0, 10)) : null;
    let toAD = null;
    if (to_date) {
        const bsDayStart = bsToAD(String(to_date).slice(0, 10));
        if (bsDayStart) {
            // Next day, computed in UTC so local timezone offsets (Nepal is
            // UTC+5:45) cannot shift the boundary back a day.
            const [y, m, dd] = bsDayStart.split('-').map(Number);
            const next = new Date(Date.UTC(y, m - 1, dd + 1));
            toAD = next.toISOString().slice(0, 10);
        }
    }

    if (table_name) { query += " AND al.table_name = ?"; params.push(table_name); }
    if (action) { query += " AND al.action = ?"; params.push(action); }
    if (fromAD) { query += " AND al.changed_at >= ?"; params.push(fromAD); }
    if (toAD) { query += " AND al.changed_at < ?"; params.push(toAD); }
    query += " ORDER BY al.changed_at DESC LIMIT 200";
    const rows = db.prepare(query).all(...params);
    return rows.map(r => ({ ...r, username: r.changed_by_name || null }));
}

module.exports = { logAudit, getAuditLogs };
