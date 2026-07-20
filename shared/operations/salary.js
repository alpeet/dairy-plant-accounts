/**
 * Godhuli Dairy Plant — Salary / Payroll Operations
 * ==================================================
 * CRUD for salary records and payroll register.
 *
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * List salary records with optional filters.
 */
function listSalaryRecords(db, { month, employee_name, from_date, to_date } = {}) {
    let query = `SELECT sr.*, u.username as created_by_name 
                 FROM salary_records sr LEFT JOIN users u ON sr.created_by = u.id WHERE 1=1`;
    const params = [];
    if (month) { query += " AND sr.month = ?"; params.push(month); }
    if (employee_name) { query += " AND sr.employee_name LIKE ?"; params.push(`%${employee_name}%`); }
    if (from_date) { query += " AND sr.payment_date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND sr.payment_date <= ?"; params.push(to_date); }
    query += " ORDER BY sr.month DESC, sr.employee_name ASC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single salary record.
 */
function getSalaryRecord(db, id) {
    return db.prepare("SELECT * FROM salary_records WHERE id = ?").get(id);
}

/**
 * Save a salary record (create or update).
 * Calculates net_salary = basic_salary + allowance - advance - deduction.
 */
function saveSalaryRecord(db, data) {
    const trx = db.transaction(() => {
        const basic = parseFloat(data.basic_salary || 0);
        const allowance = parseFloat(data.allowance || 0);
        const advance = parseFloat(data.advance || 0);
        const deduction = parseFloat(data.deduction || 0);
        const netSalary = basic + allowance - advance - deduction;

        if (data.id) {
            const oldRecord = db.prepare("SELECT * FROM salary_records WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE salary_records SET employee_name=?, position=?, month=?, 
                    basic_salary=?, allowance=?, advance=?, deduction=?, net_salary=?,
                    payment_date=?, payment_mode=?, remarks=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                data.employee_name, data.position || '', data.month,
                basic, allowance, advance, deduction, netSalary,
                data.payment_date || null, data.payment_mode || 'cash',
                data.remarks || '', data.id
            );
            logAudit(db, 'salary_records', data.id, 'update', oldRecord, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO salary_records (employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.employee_name, data.position || '', data.month,
                basic, allowance, advance, deduction, netSalary,
                data.payment_date || null, data.payment_mode || 'cash',
                data.remarks || '', data.created_by || null
            );
            logAudit(db, 'salary_records', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
    });
    return trx();
}

/**
 * Delete a salary record.
 */
function deleteSalaryRecord(db, id, changedBy = null) {
    const oldRecord = db.prepare("SELECT * FROM salary_records WHERE id = ?").get(id);
    db.prepare("DELETE FROM salary_records WHERE id = ?").run(id);
    logAudit(db, 'salary_records', id, 'delete', oldRecord, null, changedBy);
    return { deleted: true };
}

/**
 * Get salary summary for a period.
 */
function getSalarySummary(db, { month } = {}) {
    let query = `SELECT COALESCE(COUNT(*), 0) as count, COALESCE(SUM(net_salary), 0) as total, 
                        COALESCE(SUM(basic_salary), 0) as total_basic, COALESCE(SUM(allowance), 0) as total_allowance,
                        COALESCE(SUM(advance), 0) as total_advance, COALESCE(SUM(deduction), 0) as total_deduction
                 FROM salary_records WHERE 1=1`;
    const params = [];
    if (month) { query += " AND month = ?"; params.push(month); }
    return db.prepare(query).get(...params);
}

module.exports = { listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary };
