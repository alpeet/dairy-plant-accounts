/**
 * Godhuli Dairy Plant — Milk Rate Chart Operations
 * ==================================================
 * Dated rate history management and date-effective rate lookup.
 */

const { logAudit } = require('./audit');

/**
 * List all rate chart entries ordered by effective_from descending.
 */
function listRateCharts(db) {
    return db.prepare("SELECT * FROM milk_rate_chart ORDER BY effective_from DESC").all();
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
        if (data.id) {
            const oldChart = db.prepare("SELECT * FROM milk_rate_chart WHERE id = ?").get(data.id);
            db.prepare(`
                UPDATE milk_rate_chart SET effective_from=?, rate_type=?, fat_multiplier=?,
                    snf_multiplier=?, extra_per_unit=?, fixed_rate=?, notes=?
                WHERE id=?
            `).run(
                data.effective_from, data.rate_type || 'formula',
                data.fat_multiplier || 7.15, data.snf_multiplier || 4.55,
                data.extra_per_unit || 0, data.fixed_rate || 0,
                data.notes || '', data.id
            );
            logAudit(db, 'milk_rate_chart', data.id, 'update', oldChart, data, data.created_by);
            return { id: data.id };
        } else {
            const result = db.prepare(`
                INSERT INTO milk_rate_chart (effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.effective_from, data.rate_type || 'formula',
                data.fat_multiplier || 7.15, data.snf_multiplier || 4.55,
                data.extra_per_unit || 0, data.fixed_rate || 0,
                data.notes || ''
            );
            logAudit(db, 'milk_rate_chart', result.lastInsertRowid, 'create', null, data, data.created_by);
            return { id: result.lastInsertRowid };
        }
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
 * Find the effective rate for a given date.
 * Returns the most recent rate chart entry effective on or before the date.
 * If no rate chart exists, returns defaults from settings.
 */
function getEffectiveRate(db, date) {
    const effectiveDate = date || new Date().toISOString().split('T')[0];

    const rate = db.prepare(`
        SELECT * FROM milk_rate_chart 
        WHERE effective_from <= ? 
        ORDER BY effective_from DESC LIMIT 1
    `).get(effectiveDate);

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

module.exports = { listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate };
