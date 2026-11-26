/**
 * Display formatting for the React UI layer.
 * Presentation only — every number it receives comes from the existing
 * operations modules (shared/operations/*), never from a second source.
 */

const npr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const npr2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(value) {
    const n = Number(value) || 0;
    const rounded = Math.round(n * 100) / 100;
    const abs = Math.abs(rounded);
    const body = Number.isInteger(abs) ? npr.format(abs) : npr2.format(abs);
    return `${rounded < 0 ? '−' : ''}Rs. ${body}`;
}

export function num(value, digits = 0) {
    return (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: digits });
}

/** Compact axis labels using the Nepali lakh / crore scale. */
export function compact(value) {
    const n = Math.abs(Number(value) || 0);
    if (n >= 10000000) return `${(n / 10000000).toFixed(n >= 100000000 ? 0 : 1)}Cr`;
    if (n >= 100000) return `${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
    if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
    return String(Math.round(n));
}

/**
 * Percentage change between the current and the previous equivalent period.
 * Returns null when no reliable denominator exists (previous period had no
 * value) so the UI can show a neutral indicator instead of inventing a trend.
 */
export function pctDelta(current, previous) {
    const cur = Number(current);
    const prev = Number(previous);
    if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
}

export function shortBSDate(date) {
    const s = String(date || '');
    return s.length >= 10 ? s.slice(5).replace('-', '/') : s;
}
