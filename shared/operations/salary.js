/**
 * Prarambha Account & Stock Management — Salary / Payroll Operations
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
 *
 * D6 normalization: the employee is RESOLVED against the master first
 * (case/space/spelling-insensitive — see resolveEmployee), so the record
 * carries employee_id + the canonical master name and a re-typed variant
 * ("SARASWATI RAYMAJHI" vs "Sawaswati Rayamajhi") can never create a second
 * identity. Amount-shaped names ("10000") are rejected — they belong in the
 * salary fields, not the name field.
 */
function saveSalaryRecord(db, data) {
    const rawName = String(data.employee_name || '').trim();
    if (!isValidEmployeeName(rawName)) {
        throw new Error('Employee name is required and cannot be just a number');
    }
    const emp = resolveEmployee(db, rawName);
    const canonicalName = emp ? emp.name : rawName;
    const employeeId = emp ? emp.id : (data.employee_id || null);

    const trx = db.transaction(() => {
        const basic = parseFloat(data.basic_salary || 0);
        const allowance = parseFloat(data.allowance || 0);
        const advance = parseFloat(data.advance || 0);
        const deduction = parseFloat(data.deduction || 0);
        const netSalary = basic + allowance - advance - deduction;

        if (data.id) {
            const oldRecord = db.prepare("SELECT * FROM salary_records WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE salary_records SET employee_id=?, employee_name=?, position=?, month=?, 
                    basic_salary=?, allowance=?, advance=?, deduction=?, net_salary=?,
                    payment_date=?, payment_mode=?, remarks=?, updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(
                employeeId, canonicalName, data.position || '', data.month,
                basic, allowance, advance, deduction, netSalary,
                data.payment_date || null, data.payment_mode || 'cash',
                data.remarks || '', data.id
            );
            logAudit(db, 'salary_records', data.id, 'update', oldRecord, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO salary_records (employee_id, employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                employeeId, canonicalName, data.position || '', data.month,
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

// ============================================================
// Employees master (persistent — survives cleanup, imports seed it)
// ============================================================

function listEmployees(db, { search, active_only } = {}) {
    ensureEmployeesTable(db);
    let query = `SELECT e.*, (SELECT COUNT(*) FROM salary_records sr WHERE sr.employee_id = e.id) AS record_count
                 FROM employees e WHERE 1=1`;
    const params = [];
    if (search) { query += ' AND (e.name LIKE ? OR e.code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (active_only) query += ' AND e.active = 1';
    query += ' ORDER BY e.name COLLATE NOCASE';
    return db.prepare(query).all(...params);
}

function saveEmployee(db, data) {
    ensureEmployeesTable(db);
    const trx = db.transaction(() => {
        if (data.id) {
            db.prepare(`UPDATE employees SET code=?, name=?, position=?, phone=?, monthly_salary=?, active=?, notes=?,
                updated_at=datetime('now','localtime') WHERE id=?`).run(
                data.code || '', data.name, data.position || '', data.phone || '',
                parseFloat(data.monthly_salary || 0), data.active === 0 ? 0 : 1, data.notes || '', data.id);
            return { id: data.id };
        }
        const r = db.prepare(`INSERT INTO employees (code, name, position, phone, monthly_salary, notes) VALUES (?, ?, ?, ?, ?, ?)`).run(
            data.code || '', data.name, data.position || '', data.phone || '',
            parseFloat(data.monthly_salary || 0), data.notes || '');
        return { id: Number(r.lastInsertRowid) };
    });
    return trx();
}

function deleteEmployee(db, id) {
    ensureEmployeesTable(db);
    db.prepare('UPDATE employees SET active = 0 WHERE id = ?').run(id);
    return { id, deactivated: true };
}

function ensureEmployeesTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT DEFAULT '',
        name TEXT NOT NULL,
        position TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        monthly_salary REAL DEFAULT 0.0,
        active INTEGER DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`);
}

// ============================================================
// Employee name resolution (D6) — one master, no duplicate identities
// ============================================================

/**
 * A usable employee name: non-empty, contains at least one letter, and is not
 * an amount typed into the wrong field ("10000", "10,000.00", "2083-03").
 */
function isValidEmployeeName(name) {
    const n = String(name || '').trim();
    if (!n || n.length > 100) return false;
    if (!/[A-Za-z\u0900-\u097F]/.test(n)) return false;   // needs a letter (Latin or Devanagari)
    return true;
}

function _empKey(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/g, '');
}

function _levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[b.length];
}

/** Similarity 0..1 — 1 − normalised edit distance. */
function _similarity(a, b) {
    if (!a && !b) return 1;
    const max = Math.max(a.length, b.length);
    if (!max) return 1;
    return 1 - _levenshtein(a, b) / max;
}

/**
 * Resolve a free-text employee name against the master.
 * Match ladder: exact (case-insensitive) → key-normalised (spaces/punctuation)
 * → fuzzy (≥ 0.85 similarity — catches SARASWATI RAYMAJHI vs Sawaswati
 * Rayamajhi without ever matching Dipak Nepal to Nar Bahadur Rana).
 *
 * @returns {{id, name, position, active, fuzzy}|null} the canonical master row
 */
function resolveEmployee(db, name) {
    ensureEmployeesTable(db);
    const n = String(name || '').trim();
    if (!n) return null;
    const rows = db.prepare('SELECT id, name, position, active FROM employees').all();

    const exact = rows.find(e => String(e.name).trim().toLowerCase() === n.toLowerCase());
    if (exact) return { ...exact, fuzzy: false };

    const key = _empKey(n);
    if (key) {
        const keyed = rows.find(e => _empKey(e.name) === key);
        if (keyed) return { ...keyed, fuzzy: false };

        let best = null, bestScore = 0;
        for (const e of rows) {
            const score = _similarity(key, _empKey(e.name));
            if (score > bestScore) { bestScore = score; best = e; }
        }
        if (best && bestScore >= 0.85) return { ...best, fuzzy: true };
    }
    return null;
}

/**
 * Duplicate suspects for the Employees screen: master rows that fuzzy-match
 * each other, plus salary-record names that resolve to no master row at all
 * (orphans — they need a master entry or a manual merge).
 */
function findDuplicateEmployees(db) {
    ensureEmployeesTable(db);
    // Only ACTIVE rows can be suspects — a merged (deactivated) row is retired,
    // not a pending duplicate.
    const emps = listEmployees(db, {}).filter(e => e.active);
    const pairs = [];
    for (let i = 0; i < emps.length; i++) {
        for (let j = i + 1; j < emps.length; j++) {
            const score = _similarity(_empKey(emps[i].name), _empKey(emps[j].name));
            if (score >= 0.85) pairs.push({ a: emps[i], b: emps[j], score: Math.round(score * 100) / 100 });
        }
    }
    const orphanRows = db.prepare(
        'SELECT employee_name, COUNT(*) AS records FROM salary_records GROUP BY LOWER(employee_name)'
    ).all();
    const orphans = orphanRows
        .filter(r => !resolveEmployee(db, r.employee_name))
        .map(r => ({ name: r.employee_name, records: r.records }));
    return { pairs, orphans };
}

/**
 * Merge a duplicate employee into the canonical one: every salary record
 * (by employee_id or exact name) is re-pointed at the target with the
 * canonical name, the source row is deactivated (never deleted — history
 * and audit trail stay intact), and the merge is written to the audit log.
 */
function mergeEmployees(db, { from_id, to_id, changed_by = null } = {}) {
    ensureEmployeesTable(db);
    const fromId = Number(from_id), toId = Number(to_id);
    if (!fromId || !toId || fromId === toId) throw new Error('Merge needs two different employees');
    const from = db.prepare('SELECT * FROM employees WHERE id = ?').get(fromId);
    const to = db.prepare('SELECT * FROM employees WHERE id = ?').get(toId);
    if (!from || !to) throw new Error('Employee not found');

    const trx = db.transaction(() => {
        const moved = db.prepare(
            'UPDATE salary_records SET employee_id = ?, employee_name = ? WHERE employee_id = ? OR (employee_id IS NULL AND LOWER(employee_name) = LOWER(?))'
        ).run(toId, to.name, fromId, from.name).changes;

        db.prepare(`UPDATE employees SET
                position = CASE WHEN position = '' THEN ? ELSE position END,
                phone = CASE WHEN phone = '' THEN ? ELSE phone END,
                monthly_salary = CASE WHEN monthly_salary = 0 THEN ? ELSE monthly_salary END,
                active = 0, updated_at = datetime('now','localtime')
            WHERE id = ?`)
            .run(from.position || '', from.phone || '', from.monthly_salary || 0, fromId);

        logAudit(db, 'employees', toId, 'update', { merged_from: from.name, from_id: fromId },
            { name: to.name, moved_records: moved }, changed_by);
        logAudit(db, 'employees', fromId, 'update', from,
            { merged_into: to.name, to_id: toId, deactivated: true }, changed_by);
        return moved;
    });
    const moved = trx();
    return { merged: true, from: from.name, into: to.name, moved_records: moved };
}

module.exports = {
    listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary,
    listEmployees, saveEmployee, deleteEmployee,
    isValidEmployeeName, resolveEmployee, findDuplicateEmployees, mergeEmployees
};
