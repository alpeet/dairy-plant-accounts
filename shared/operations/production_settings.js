/**
 * Prarambha Account & Stock Management — Production Setup Operations
 * =================================================================
 * Configurable processing-overhead register (§13) and per-process yield
 * standards (§14) for the scientific dairy costing engine. Both are plain
 * master data: the batch engine reads them, so a change here flows straight
 * into the next posted batch. Every change is audited (old → new).
 */

const { logAudit } = require('./audit');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** How a configured overhead is applied to a batch. */
const OVERHEAD_BASES = {
    per_input_liter: 'Per input litre',
    per_batch: 'Per batch',
    percent_of_input_cost: '% of input cost'
};

/** The seven spec categories seeded by Migration 25. */
const DEFAULT_OVERHEADS = [
    ['Electricity', 'per_input_liter'],
    ['Boiler / Fuel', 'per_input_liter'],
    ['Labour', 'per_batch'],
    ['Packaging', 'per_input_liter'],
    ['Water', 'per_input_liter'],
    ['Cleaning / CIP', 'per_batch'],
    ['Refrigeration / Chilling', 'per_input_liter']
];

/** Make sure the register is never empty (idempotent, additive). */
function ensureProductionOverheads(db) {
    try {
        const n = db.prepare('SELECT COUNT(*) c FROM production_overheads').get().c;
        if (n === 0) {
            const ins = db.prepare('INSERT INTO production_overheads (name, basis, rate) VALUES (?, ?, 0)');
            for (const [name, basis] of DEFAULT_OVERHEADS) ins.run(name, basis);
        }
    } catch (e) { /* table not migrated yet */ }
}

// ──────────────────────────────────────────────────────────────
// Production overheads
// ──────────────────────────────────────────────────────────────

function listProductionOverheads(db, { active_only } = {}) {
    ensureProductionOverheads(db);
    let sql = 'SELECT * FROM production_overheads';
    if (active_only) sql += ' WHERE active = 1';
    sql += ' ORDER BY active DESC, id';
    const rows = db.prepare(sql).all();
    return rows.map(r => ({
        ...r,
        active: !!r.active,
        basis_label: OVERHEAD_BASES[r.basis] || r.basis,
        rate: round2(r.rate)
    }));
}

function normalizeOverhead(data) {
    const name = String(data.name || '').trim();
    if (!name) throw new Error('Overhead name is required.');
    const basis = String(data.basis || 'per_batch');
    if (!OVERHEAD_BASES[basis]) {
        throw new Error('Basis must be one of: ' + Object.keys(OVERHEAD_BASES).join(', '));
    }
    const rate = round2(data.rate);
    if (rate < 0) throw new Error('Rate cannot be negative.');
    return {
        name, basis, rate,
        active: data.active === false || data.active === 0 ? 0 : 1,
        notes: String(data.notes || '')
    };
}

function saveProductionOverhead(db, data, userId = null) {
    const v = normalizeOverhead(data);
    const trx = db.transaction(() => {
        if (data.id) {
            const old = db.prepare('SELECT * FROM production_overheads WHERE id = ?').get(data.id);
            if (!old) throw new Error('Overhead not found.');
            db.prepare('UPDATE production_overheads SET name=?, basis=?, rate=?, active=?, notes=? WHERE id=?')
                .run(v.name, v.basis, v.rate, v.active, v.notes, data.id);
            logAudit(db, 'production_overheads', data.id, 'update', old, v, userId);
            return { id: data.id, ...v };
        }
        const res = db.prepare('INSERT INTO production_overheads (name, basis, rate, active, notes) VALUES (?, ?, ?, ?, ?)')
            .run(v.name, v.basis, v.rate, v.active, v.notes);
        const id = Number(res.lastInsertRowid);
        logAudit(db, 'production_overheads', id, 'create', null, v, userId);
        return { id, ...v };
    });
    return trx();
}

function deleteProductionOverhead(db, id, userId = null) {
    const trx = db.transaction(() => {
        const old = db.prepare('SELECT * FROM production_overheads WHERE id = ?').get(id);
        if (!old) throw new Error('Overhead not found.');
        db.prepare('DELETE FROM production_overheads WHERE id = ?').run(id);
        logAudit(db, 'production_overheads', id, 'delete', old, null, userId);
        return { deleted: true };
    });
    return trx();
}

// ──────────────────────────────────────────────────────────────
// Yield standards
// ──────────────────────────────────────────────────────────────

function listYieldStandards(db, { process_type } = {}) {
    let sql = `SELECT ys.*, p.name AS output_product_name
               FROM yield_standards ys LEFT JOIN products p ON p.id = ys.output_product_id`;
    const params = [];
    if (process_type) { sql += ' WHERE ys.process_type = ?'; params.push(process_type); }
    sql += ' ORDER BY ys.process_type, ys.id';
    return db.prepare(sql).all(...params).map(r => ({
        ...r,
        expected_yield_percent: round2(r.expected_yield_percent),
        warn_low_percent: round2(r.warn_low_percent),
        warn_high_percent: round2(r.warn_high_percent)
    }));
}

function normalizeYield(data) {
    const process_type = String(data.process_type || '').trim();
    if (!process_type) throw new Error('Process type is required.');
    const expected_yield_percent = round2(data.expected_yield_percent);
    if (expected_yield_percent < 0 || expected_yield_percent > 100) throw new Error('Expected yield must be between 0 and 100.');
    const warn_low_percent = round2(data.warn_low_percent);
    const warn_high_percent = round2(data.warn_high_percent);
    if (warn_low_percent < 0 || warn_low_percent > 100) throw new Error('Warn-low must be between 0 and 100.');
    if (warn_high_percent < 0 || warn_high_percent > 100) throw new Error('Warn-high must be between 0 and 100.');
    if (warn_low_percent > 0 && warn_high_percent > 0 && warn_low_percent > warn_high_percent) {
        throw new Error('Warn-low cannot exceed warn-high.');
    }
    return {
        process_type, expected_yield_percent, warn_low_percent, warn_high_percent,
        output_product_id: data.output_product_id ? Number(data.output_product_id) : null,
        notes: String(data.notes || '')
    };
}

function saveYieldStandard(db, data, userId = null) {
    const v = normalizeYield(data);
    const trx = db.transaction(() => {
        if (data.id) {
            const old = db.prepare('SELECT * FROM yield_standards WHERE id = ?').get(data.id);
            if (!old) throw new Error('Yield standard not found.');
            db.prepare(`UPDATE yield_standards SET process_type=?, output_product_id=?, expected_yield_percent=?,
                        warn_low_percent=?, warn_high_percent=?, notes=? WHERE id=?`)
                .run(v.process_type, v.output_product_id, v.expected_yield_percent, v.warn_low_percent, v.warn_high_percent, v.notes, data.id);
            logAudit(db, 'yield_standards', data.id, 'update', old, v, userId);
            return { id: data.id, ...v };
        }
        const res = db.prepare(`INSERT INTO yield_standards (process_type, output_product_id, expected_yield_percent,
                        warn_low_percent, warn_high_percent, notes) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(v.process_type, v.output_product_id, v.expected_yield_percent, v.warn_low_percent, v.warn_high_percent, v.notes);
        const id = Number(res.lastInsertRowid);
        logAudit(db, 'yield_standards', id, 'create', null, v, userId);
        return { id, ...v };
    });
    return trx();
}

function deleteYieldStandard(db, id, userId = null) {
    const trx = db.transaction(() => {
        const old = db.prepare('SELECT * FROM yield_standards WHERE id = ?').get(id);
        if (!old) throw new Error('Yield standard not found.');
        db.prepare('DELETE FROM yield_standards WHERE id = ?').run(id);
        logAudit(db, 'yield_standards', id, 'delete', old, null, userId);
        return { deleted: true };
    });
    return trx();
}

module.exports = {
    ensureProductionOverheads,
    listProductionOverheads, saveProductionOverhead, deleteProductionOverhead,
    listYieldStandards, saveYieldStandard, deleteYieldStandard,
    OVERHEAD_BASES, DEFAULT_OVERHEADS
};
