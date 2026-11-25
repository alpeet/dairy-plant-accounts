/**
 * Units of measure — the vocabulary every product and line refers to.
 *
 * Standard units are seeded once and can have their display name edited, but
 * their CODE is fixed because historical line rows and product settings store
 * it as text. Custom units are ordinary rows: add, rename, deactivate.
 *
 * Nothing here touches a transaction. A unit is only a label until a product
 * says how it converts to that product's stock unit (unit_conversion.js).
 */

const STANDARD_UNITS = [
    { code: 'L',      name: 'Litre',     kind: 'volume', to_base: 1,     base_code: 'L',   sort: 10 },
    { code: 'ml',     name: 'Millilitre', kind: 'volume', to_base: 0.001, base_code: 'L',   sort: 20 },
    { code: 'kg',     name: 'Kilogram',  kind: 'mass',   to_base: 1,     base_code: 'kg',  sort: 30 },
    { code: 'g',      name: 'Gram',      kind: 'mass',   to_base: 0.001, base_code: 'kg',  sort: 40 },
    { code: 'pcs',    name: 'Piece',     kind: 'count',  to_base: 1,     base_code: 'pcs', sort: 50 },
    { code: 'packet', name: 'Packet',    kind: 'count',  to_base: 1,     base_code: 'pcs', sort: 60 },
    { code: 'box',    name: 'Box',       kind: 'count',  to_base: 1,     base_code: 'pcs', sort: 70 }
];

function ensureUnits(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'other',
            to_base REAL NOT NULL DEFAULT 1,
            base_code TEXT NOT NULL DEFAULT '',
            is_system INTEGER NOT NULL DEFAULT 0,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_units_code ON units (code);
    `);
    const insert = db.prepare(`
        INSERT OR IGNORE INTO units (code, name, kind, to_base, base_code, is_system, active, sort_order)
        VALUES (?, ?, ?, ?, ?, 1, 1, ?)
    `);
    db.transaction(() => {
        for (const u of STANDARD_UNITS) insert.run(u.code, u.name, u.kind, u.to_base, u.base_code, u.sort);
    })();
}

function listUnits(db, { active_only } = {}) {
    let q = `SELECT u.*,
                (SELECT COUNT(*) FROM products p
                  WHERE p.purchase_unit = u.code COLLATE NOCASE
                     OR p.sales_unit = u.code COLLATE NOCASE
                     OR p.stock_unit = u.code COLLATE NOCASE
                     OR p.unit = u.code COLLATE NOCASE) AS products_used
               FROM units u WHERE 1=1`;
    if (active_only) q += ' AND u.active = 1';
    q += ' ORDER BY u.sort_order, u.code';
    return db.prepare(q).all();
}

function getUnit(db, code) {
    return db.prepare('SELECT * FROM units WHERE code = ? COLLATE NOCASE').get(String(code || '').trim()) || null;
}

/** How many product settings and line rows mention this unit code. */
function unitUsage(db, code) {
    const c = String(code || '').trim();
    const out = { products: 0, purchase_lines: 0, sale_lines: 0 };
    try {
        out.products = db.prepare(
            `SELECT COUNT(*) n FROM products
              WHERE purchase_unit = ? COLLATE NOCASE OR sales_unit = ? COLLATE NOCASE
                 OR stock_unit = ? COLLATE NOCASE OR unit = ? COLLATE NOCASE`
        ).get(c, c, c, c).n;
    } catch (e) { out.products = 0; }
    try { out.purchase_lines = db.prepare('SELECT COUNT(*) n FROM purchase_items WHERE unit = ? COLLATE NOCASE').get(c).n; } catch (e) { }
    try { out.sale_lines = db.prepare('SELECT COUNT(*) n FROM sales_items WHERE unit = ? COLLATE NOCASE').get(c).n; } catch (e) { }
    return out;
}

/**
 * Create or update a unit. The code is the stored identity:
 *  - a NEW custom code may be anything short and unique;
 *  - an existing unit keeps its code; only name / active change;
 *  - a system unit's name is editable, deactivation is refused.
 */
function saveUnit(db, unit) {
    ensureUnits(db);
    const code = String(unit.code || '').trim();
    const name = String(unit.name || '').trim() || code;
    if (!code) throw new Error('Unit code is required');
    if (code.length > 12) throw new Error('Unit code must be 12 characters or fewer');
    if (!/^[A-Za-z0-9._/-]+$/.test(code)) throw new Error('Unit code may contain letters, digits, dot, dash, slash and underscore only');

    const existing = getUnit(db, code);
    if (existing) {
        const active = existing.is_system ? 1 : (unit.active === 0 ? 0 : 1);
        db.prepare("UPDATE units SET name = ?, active = ?, updated_at = datetime('now','localtime') WHERE id = ?")
            .run(name, active, existing.id);
        return { id: existing.id, code: existing.code, updated: true };
    }

    const kind = ['volume', 'mass', 'count', 'other'].includes(String(unit.kind || '')) ? unit.kind : 'other';
    const result = db.prepare(`
        INSERT INTO units (code, name, kind, to_base, base_code, is_system, active, sort_order)
        VALUES (?, ?, ?, 1, ?, 0, 1, 500)
    `).run(code, name, kind, kind === 'volume' ? 'L' : kind === 'mass' ? 'kg' : kind === 'count' ? 'pcs' : '');
    return { id: result.lastInsertRowid, code, created: true };
}

/**
 * Deactivate (never delete) a unit. A unit used by a product or a transaction
 * line cannot be deactivated: historical rows would keep a code that no screen
 * can label. Re-activate it instead of creating a second code.
 */
function deactivateUnit(db, code) {
    ensureUnits(db);
    const unit = getUnit(db, code);
    if (!unit) throw new Error('Unit not found');
    if (unit.is_system) throw new Error(`${unit.name} is a standard unit and cannot be deactivated`);
    const used = unitUsage(db, unit.code);
    if (used.products > 0 || used.purchase_lines > 0 || used.sale_lines > 0) {
        const parts = [];
        if (used.products) parts.push(`${used.products} product setting(s)`);
        if (used.purchase_lines) parts.push(`${used.purchase_lines} purchase line(s)`);
        if (used.sale_lines) parts.push(`${used.sale_lines} sales line(s)`);
        throw new Error(`${unit.name} is used by ${parts.join(', ')} — it cannot be deactivated while history references it`);
    }
    db.prepare("UPDATE units SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?").run(unit.id);
    return { deactivated: true, code: unit.code };
}

/** Product unit settings table for the Settings → Units screen. */
function productUnitSettings(db, { active_only } = {}) {
    ensureUnits(db);
    let q = `SELECT id, name, code, active, category,
                    COALESCE(NULLIF(stock_unit,''), NULLIF(unit,''), 'kg') AS stock_unit,
                    COALESCE(NULLIF(purchase_unit,''), NULLIF(unit,''), 'kg') AS purchase_unit,
                    COALESCE(NULLIF(sales_unit,''), NULLIF(unit,''), 'kg') AS sales_unit,
                    COALESCE(purchase_factor, 1) AS purchase_factor,
                    COALESCE(sales_factor, 1) AS sales_factor,
                    COALESCE(decimal_precision, 2) AS decimal_precision
               FROM products WHERE 1=1`;
    if (active_only) q += ' AND active = 1';
    q += ' ORDER BY name';
    return db.prepare(q).all();
}

module.exports = {
    STANDARD_UNITS, ensureUnits, listUnits, getUnit, saveUnit, deactivateUnit,
    unitUsage, productUnitSettings
};
