/**
 * Prarambha Account & Stock Management — Milk Rate Chart Operations
 * ==================================================
 * Dated rate history management and date-effective rate lookup.
 */

const { logAudit } = require('./audit');
const { todayBSDate } = require('../excel-import');

/** Currency precision — every reported figure adds up at 2 decimals. */
function round2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * List all rate chart entries ordered by effective_from descending.
 * Supplier rows carry the party name so one list shows the whole pricing setup.
 */
function listRateCharts(db, { party_id } = {}) {
    // Probe first: a database opened READ-ONLY (verify scripts, exporters)
    // may predate Migration 26 and have no supplier columns yet.
    let hasPartyCol = false;
    try { hasPartyCol = db.prepare('PRAGMA table_info(milk_rate_chart)').all().some(c => c.name === 'party_id'); } catch (e) { hasPartyCol = false; }

    let sql = hasPartyCol
        ? `SELECT rc.*, p.name as party_name
               FROM milk_rate_chart rc
               LEFT JOIN parties p ON p.id = rc.party_id`
        : `SELECT rc.* FROM milk_rate_chart rc`;
    const params = [];
    if (hasPartyCol && party_id !== undefined && party_id !== null && party_id !== '') {
        sql += ' WHERE rc.party_id = ?';
        params.push(party_id);
    }
    sql += ' ORDER BY rc.effective_from DESC, rc.id DESC';
    return db.prepare(sql).all(...params);
}

/**
 * Get a single rate chart entry.
 */
function getRateChart(db, id) {
    return db.prepare("SELECT * FROM milk_rate_chart WHERE id = ?").get(id);
}

/**
 * Save a rate chart entry (create or update).
 */
function saveRateChart(db, data) {
    const trx = db.transaction(() => {
        const cols = db.prepare('PRAGMA table_info(milk_rate_chart)').all().map(c => c.name);
        const hasSupplierCols = cols.includes('party_id'); // Migration 26 applied?
        const supplier = hasSupplierCols ? {
            party_id: data.party_id === undefined ? null : (data.party_id || null),
            effective_to: data.effective_to ? data.effective_to : null,
            milk_type: data.milk_type || '',
            is_active: data.is_active === undefined || data.is_active === null ? 1 : (data.is_active ? 1 : 0)
        } : { party_id: null, effective_to: null, milk_type: '', is_active: 1 };
        const setClause = hasSupplierCols
            ? 'effective_from=?, rate_type=?, fat_multiplier=?, snf_multiplier=?, extra_per_unit=?, fixed_rate=?, notes=?, party_id=?, effective_to=?, milk_type=?, is_active=?'
            : 'effective_from=?, rate_type=?, fat_multiplier=?, snf_multiplier=?, extra_per_unit=?, fixed_rate=?, notes=?';
        const insClause = hasSupplierCols
            ? 'INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes, party_id, effective_to, milk_type, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            : 'INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const base = [
            data.effective_from, data.rate_type || 'formula',
            data.fat_multiplier || 7.15, data.snf_multiplier || 4.55,
            data.extra_per_unit || 0, data.fixed_rate || 0,
            data.notes || ''
        ];
        const supplierVals = [supplier.party_id, supplier.effective_to, supplier.milk_type, supplier.is_active];

        if (data.id) {
            const oldChart = db.prepare("SELECT * FROM milk_rate_chart WHERE id = ?").get(data.id);
            db.prepare(`UPDATE milk_rate_chart SET ${setClause} WHERE id=?`)
                .run(...base, ...(hasSupplierCols ? supplierVals : []), data.id);
            logAudit(db, 'milk_rate_chart', data.id, 'update', oldChart, data, data.created_by);
            return { id: data.id };
        }
        const result = db.prepare(insClause)
            .run(...base, ...(hasSupplierCols ? supplierVals : []));
        logAudit(db, 'milk_rate_chart', result.lastInsertRowid, 'create', null, data, data.created_by);
        return { id: result.lastInsertRowid };
    });
    return trx();
}

/**
 * Delete a rate chart entry.
 */
function deleteRateChart(db, id, changedBy = null) {
    const oldChart = db.prepare("SELECT * FROM milk_rate_chart WHERE id = ?").get(id);
    db.prepare("DELETE FROM milk_rate_chart WHERE id = ?").run(id);
    logAudit(db, 'milk_rate_chart', id, 'delete', oldChart, null, changedBy);
    return { deleted: true };
}

/**
 * Find the effective rate for a given date — optionally for ONE supplier and
 * ONE milk type. This is the single authoritative pricing lookup: there is no
 * second "supplier rate" or "collection rate" system.
 *\ * Specificity order (most specific wins, then most recent effective_from):
 *   1. supplier row for this milk type      2. supplier row for all types
 *   3. plant-wide row for this milk type    4. plant-wide row for all types
 *
 * @param {object} db
 * @param {string} date      BS date of the collection
 * @param {object} opts      { party_id, milk_type }
 */
function getEffectiveRate(db, date, opts = {}) {
    const effectiveDate = date || todayBSDate();
    const partyId = opts.party_id || null;
    const milkType = opts.milk_type ? String(opts.milk_type).trim().toLowerCase() : '';

    let cols = [];
    try { cols = db.prepare('PRAGMA table_info(milk_rate_chart)').all().map(c => c.name); } catch (e) { cols = []; }
    const hasSupplierCols = cols.includes('party_id');

    let rate = null;
    if (hasSupplierCols) {
        // party_id IS NULL OR party_id = ? — with partyId null the second branch
        // is never true, so a plain lookup stays plant-wide.
        rate = db.prepare(`
            SELECT * FROM milk_rate_chart
             WHERE effective_from <= ?
               AND (effective_to IS NULL OR effective_to = '' OR effective_to >= ?)
               AND (is_active IS NULL OR is_active = 1)
               AND (milk_type IS NULL OR milk_type = '' OR milk_type = ?)
               AND (party_id IS NULL OR party_id = ?)
             ORDER BY (party_id IS NOT NULL) DESC,
                      (COALESCE(milk_type, '') <> '') DESC,
                      effective_from DESC, id DESC
             LIMIT 1
        `).get(effectiveDate, effectiveDate, milkType, partyId);
    }
    if (!rate) {
        rate = db.prepare(`
            SELECT * FROM milk_rate_chart
             WHERE effective_from <= ?
             ORDER BY effective_from DESC LIMIT 1
        `).get(effectiveDate);
    }

    if (rate) return rate;

    // Return default rates from settings
    const fatMult = db.prepare("SELECT value FROM settings WHERE key = 'default_fat_multiplier'").get();
    const snfMult = db.prepare("SELECT value FROM settings WHERE key = 'default_snf_multiplier'").get();

    return {
        id: null,
        rate_type: 'formula',
        fat_multiplier: fatMult ? parseFloat(fatMult.value) : 7.15,
        snf_multiplier: snfMult ? parseFloat(snfMult.value) : 4.55,
        extra_per_unit: 0,
        fixed_rate: 0,
        notes: 'Default rate (no chart entry for this date)'
    };
}

/**
 * Calculate milk rate using formula: Rate = (FAT × fat_mult) + (SNF × snf_mult) + extra_per_unit
 * Or return fixed rate if rate_type is 'fixed'.
 */
function calculateMilkRate(fatVal, snfVal, rateChart) {
    if (!rateChart) rateChart = { rate_type: 'formula', fat_multiplier: 7.15, snf_multiplier: 4.55, extra_per_unit: 0, fixed_rate: 0 };
    
    if (rateChart.rate_type === 'fixed') {
        return rateChart.fixed_rate || 0;
    }

    const fat = parseFloat(fatVal || 0);
    const snf = parseFloat(snfVal || 0);
    const fatMult = parseFloat(rateChart.fat_multiplier || 7.15);
    const snfMult = parseFloat(rateChart.snf_multiplier || 4.55);
    const extra = parseFloat(rateChart.extra_per_unit || 0);

    return (fat * fatMult) + (snf * snfMult) + extra;
}

/**
 * ONE entry point for "what should this litre cost?" — used by single entry,
 * bulk entry, the API and the importers so no path can price milk differently.
 *
 * Returns:
 *   chart           the winning rate-chart row (auditable: id, effective_from…)
 *   source          'supplier' | 'plant' | 'default'
 *   calculated_rate what the applicable chart says this litre must cost
 *   final_rate      the rate to store (the given rate when it is an override)
 *   overridden      true when final_rate departs from calculated_rate
 *
 * It never throws on an override — the reason check lives at the entry points
 * (API/IPC/UI) so internal callers (importer, tests) are not broken by it.
 */
function resolveMilkRate(db, opts = {}) {
    const { date, party_id, milk_type, fat, snf } = opts;
    const chart = getEffectiveRate(db, date, { party_id, milk_type });
    const calculated = round2(calculateMilkRate(fat, snf, chart));

    const hasGiven = opts.rate !== undefined && opts.rate !== null && opts.rate !== '' && !Number.isNaN(Number(opts.rate));
    const given = hasGiven ? round2(Number(opts.rate)) : null;
    const finalRate = hasGiven ? given : calculated;
    const overridden = hasGiven && Math.abs(finalRate - calculated) > 0.005;

    const hasSupplierConfig = !!(chart && chart.party_id != null);
    const source = hasSupplierConfig ? 'supplier' : (chart && chart.id != null ? 'plant' : 'default');

    return {
        chart: chart || null,
        source,
        rate_type: (opts.rate_type || (chart && chart.rate_type) || 'formula'),
        calculated_rate: calculated,
        final_rate: finalRate,
        overridden,
        has_supplier_config: hasSupplierConfig
    };
}

/**
 * Entry-point guard: a rate that departs from the calculated rate needs a
 * reason (spec Phase 4). Declaring a fixed-rate entry that equals the stored
 * fixed rate is a pricing METHOD, not a deviation, so it is not an override.
 *
 * @returns {string|null} an error message, or null when the entry is clean.
 */
function rateOverrideError(db, data = {}) {
    if (data.rate === undefined || data.rate === null || data.rate === '') return null;
    const declaredFixed = String(data.rate_type || '') === 'fixed'
        && data.fixed_rate !== undefined && data.fixed_rate !== null && data.fixed_rate !== ''
        && Math.abs(round2(Number(data.fixed_rate)) - round2(Number(data.rate))) <= 0.005;
    if (declaredFixed) return null; // method declaration, recorded as rate_type='fixed'

    const res = resolveMilkRate(db, data);
    if (!res.overridden) return null;
    if (String(data.rate_override_reason || '').trim()) return null;
    return `Rate ${res.final_rate}/L differs from the calculated ${res.calculated_rate}/L for this supplier — a reason is required.`;
}

module.exports = { listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate, resolveMilkRate, rateOverrideError };
