/**
 * Unit conversion — one place that decides how an entered quantity becomes a
 * stock quantity.
 *
 * Rules, in order:
 *   1. The unit already IS the product's stock unit → quantity unchanged.
 *   2. Both units are metric siblings of the same dimension (L↔ml, kg↔g) →
 *      converted by definition (1000 ml = 1 L, 1000 g = 1 kg).
 *   3. The entered unit is the product's purchase/sales unit and that side has
 *      an explicit factor (1 box = 12 pcs) → quantity × factor.
 *   4. Anything else → REFUSED. Litres are never assumed to equal kilograms,
 *      packets are never assumed to hold a number of pieces, and a missing
 *      factor is an error the user must fix in Settings, not a guess.
 *
 * A conversion never rewrites the entered quantity, unit, rate or amount; the
 * stock quantity is stored beside them.
 */

const EPS = 1e-9;

/** Canonical identity for a unit code / label. */
function normalizeUnit(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const t = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
    const aliases = {
        l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L', ltr: 'L', lt: 'L',
        ml: 'ml', millilitre: 'ml', milliliter: 'ml', mls: 'ml',
        kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
        g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
        pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', nos: 'pcs', no: 'pcs', unit: 'pcs', units: 'pcs',
        packet: 'packet', packets: 'packet', pkt: 'packet', pkts: 'packet', pack: 'packet', packs: 'packet',
        box: 'box', boxes: 'box', carton: 'box', cartons: 'box', ctn: 'box'
    };
    return aliases[t] || raw;
}

function sameUnit(a, b) {
    const na = normalizeUnit(a);
    const nb = normalizeUnit(b);
    return !!na && na.toLowerCase() === nb.toLowerCase();
}

/** Metric definition of a unit, or null when it is not a metric sibling. */
function metricOf(unit) {
    const u = normalizeUnit(unit);
    const table = {
        L:  { dimension: 'volume', toBase: 1 },
        ml: { dimension: 'volume', toBase: 0.001 },
        kg: { dimension: 'mass', toBase: 1 },
        g:  { dimension: 'mass', toBase: 0.001 }
    };
    return table[u] || null;
}

function roundTo(value, dp) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    const f = Math.pow(10, Math.max(0, Math.min(6, Number(dp) || 0)));
    return Math.round(n * f) / f;
}

/**
 * How many stock units one `unit` is worth for this product.
 * Returns { factor, basis } or { error }.
 */
function factorToStock(product, unit) {
    const stockUnit = product
        ? (product.stock_unit || product.unit || 'kg')
        : 'kg';
    const u = String(unit || '').trim();
    if (!u) return { factor: 1, basis: 'stock' };
    if (sameUnit(u, stockUnit)) return { factor: 1, basis: 'stock' };

    const mFrom = metricOf(u);
    const mTo = metricOf(stockUnit);
    if (mFrom && mTo && mFrom.dimension === mTo.dimension) {
        return { factor: mFrom.toBase / mTo.toBase, basis: 'metric' };
    }

    if (product) {
        const purchaseUnit = product.purchase_unit || product.unit || '';
        const salesUnit = product.sales_unit || product.unit || '';
        if (sameUnit(u, purchaseUnit)) {
            const f = Number(product.purchase_factor);
            if (isFinite(f) && f > 0) return { factor: f, basis: 'purchase_factor' };
            return { error: `${u} is the purchase unit of ${product.name} but no conversion factor is set (Settings → Units)` };
        }
        if (sameUnit(u, salesUnit)) {
            const f = Number(product.sales_factor);
            if (isFinite(f) && f > 0) return { factor: f, basis: 'sales_factor' };
            return { error: `${u} is the sales unit of ${product.name} but no conversion factor is set (Settings → Units)` };
        }
    }

    return {
        error: `Cannot convert ${u} to the stock unit (${stockUnit}) — set a conversion factor for this product in Settings → Units`
    };
}

/**
 * Entered quantity → stock quantity for a product.
 * @returns {{ok: boolean, stock_qty?: number, stock_unit?: string, factor?: number, basis?: string, error?: string}}
 */
function toStock(product, quantity, unit) {
    const stockUnit = product ? (product.stock_unit || product.unit || 'kg') : String(unit || '').trim();
    const qty = Number(quantity);
    if (!isFinite(qty)) return { ok: false, error: 'Quantity is not a number' };
    const f = factorToStock(product, unit);
    if (f.error) return { ok: false, error: f.error };
    return {
        ok: true,
        stock_qty: roundTo(qty * f.factor, 4),
        stock_unit: stockUnit,
        factor: f.factor,
        basis: f.basis
    };
}

/** Convert a quantity between two units using the product's settings. */
function convert(product, quantity, fromUnit, toUnit) {
    const stockUnit = product ? (product.stock_unit || product.unit || 'kg') : 'kg';
    const step1 = toStock(product, quantity, fromUnit);
    if (!step1.ok) return step1;
    if (sameUnit(toUnit, stockUnit)) return step1;
    const mFrom = metricOf(stockUnit);
    const mTo = metricOf(toUnit);
    if (mFrom && mTo && mFrom.dimension === mTo.dimension) {
        return { ok: true, value: roundTo(step1.stock_qty * (mFrom.toBase / mTo.toBase), 4) };
    }
    const f = factorToStock(product, toUnit);
    if (f.error) return { ok: false, error: f.error };
    return { ok: true, value: roundTo(step1.stock_qty / f.factor, 4) };
}

/** True when a conversion needs no explicit factor (same unit or metric sibling). */
function isAutomatic(product, unit) {
    const stockUnit = product ? (product.stock_unit || product.unit || 'kg') : 'kg';
    if (sameUnit(unit, stockUnit)) return true;
    const a = metricOf(unit);
    const b = metricOf(stockUnit);
    return !!(a && b && a.dimension === b.dimension);
}

/**
 * Validate a product's unit configuration BEFORE saving.
 * @returns {string[]} errors (empty = valid)
 */
function validateProductUnits(product) {
    const errors = [];
    const stock = String(product.stock_unit || '').trim();
    const purchase = String(product.purchase_unit || '').trim();
    const sales = String(product.sales_unit || '').trim();
    if (!stock) errors.push('Stock unit is required');

    const dp = Number(product.decimal_precision);
    if (!Number.isInteger(dp) || dp < 0 || dp > 4) errors.push('Decimal precision must be a whole number between 0 and 4');

    for (const [label, unit, factorKey] of [
        ['Purchase', purchase, 'purchase_factor'],
        ['Sales', sales, 'sales_factor']
    ]) {
        if (!unit) { errors.push(`${label} unit is required`); continue; }
        if (sameUnit(unit, stock)) continue;
        if (isAutomatic(product, unit)) continue;
        const f = Number(product[factorKey]);
        if (!isFinite(f) || f <= 0) {
            errors.push(`${label} unit ${unit} differs from the stock unit ${stock} — enter how many ${stock} one ${unit} contains`);
        } else if (Math.abs(f - 1) < EPS) {
            errors.push(`${label} unit ${unit} differs from the stock unit ${stock} but the factor is 1 — enter the real conversion or use the same unit`);
        }
    }
    return errors;
}

module.exports = {
    normalizeUnit, sameUnit, metricOf, factorToStock, toStock, convert,
    isAutomatic, validateProductUnits, roundTo
};
