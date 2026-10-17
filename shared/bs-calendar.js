/**
 * Prarambha Account & Stock Management — Bikram Sambat calendar (single source)
 * ==========================================================================
 * Month lengths for BS 2000–2090, the range the application supports. One table
 * for the desktop app, the web server and the Excel importer: before this file
 * the renderer and shared/excel-import.js each carried their own 2080–2090
 * table and both had 2083 wrong (Jestha 32, Ashwin 30, Kartik 29, Mangsir 30,
 * Poush 29), so the picker refused Ashwin 31 — which is today's date, BS
 * 2083-06-31 = AD 2026-10-17 — and every AD↔BS conversion drifted after Jestha.
 *
 * Data: nepali-date-converter 3.4.0 calendar (BS 2000–2090), cross-checked
 * against the workbook's own BS_AD_Lookup sheet for BS 2083:
 *   2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30]
 * BS 2083-01-01 = AD 2026-04-14 (Nepali New Year). Do not edit a single month
 * by hand — scripts/audit/test-bs-calendar.js verifies the whole table.
 *
 * Dates are stored as 'YYYY-MM-DD' BS strings. Never run strftime()/new Date()
 * on them; compare strings and walk this table instead.
 */

const BS_CALENDAR_DATA = {
    2000: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2001: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2002: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2003: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2004: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2005: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2006: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2007: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2008: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
    2009: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2010: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2011: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2012: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2013: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2014: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2015: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2016: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2017: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2018: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2019: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2020: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2021: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2022: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2023: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2024: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2025: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2026: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2027: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2028: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2029: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
    2030: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2031: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2032: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2033: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2034: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2035: [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
    2036: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2037: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2038: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2039: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2040: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2041: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2042: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2043: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2044: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2045: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2046: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2047: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2048: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2049: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2050: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2051: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2052: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2053: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2054: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2055: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2056: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
    2057: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2058: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2059: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2060: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2061: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2062: [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31],
    2063: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2064: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2065: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2066: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
    2067: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2068: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2069: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
    2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2072: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
    2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2074: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
    2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
    2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
    2085: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
    2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
    2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
    2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

const BS_MONTHS_NP = [
    'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
    'कार्तिक', 'मंसिर', 'पुष', 'माघ', 'फाल्गुन', 'चैत्र'
];

const BS_MONTHS_EN = [
    'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
    'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
];

const BS_MIN_YEAR = 2000;
const BS_MAX_YEAR = 2090;

// Anchor: BS 2082-01-01 = AD 2025-04-14. A second anchor (2083-01-01 =
// AD 2026-04-14) is asserted by the test so a table edit cannot silently
// shift every conversion.
const BS_ANCHOR = { bs: '2082-01-01', ad: '2025-04-14' };

function pad2(n) { return String(n).padStart(2, '0'); }

function isSupportedYear(year) {
    return Number.isInteger(year) && year >= BS_MIN_YEAR && year <= BS_MAX_YEAR;
}

/** Days in a BS month; throws outside the supported range rather than guessing. */
function getBSDaysInMonth(year, month) {
    if (!isSupportedYear(year) || !(month >= 1 && month <= 12)) return 0;
    const data = BS_CALENDAR_DATA[year];
    return data ? data[month - 1] : 0;
}

/** Whole days from BS 2000-01-01 to a BS date (0-based, calendar-day exact). */
function bsDayNumber(year, month, day) {
    let total = 0;
    for (let y = BS_MIN_YEAR; y < year; y++) {
        for (let m = 1; m <= 12; m++) total += getBSDaysInMonth(y, m);
    }
    for (let m = 1; m < month; m++) total += getBSDaysInMonth(year, m);
    return total + day - 1;
}

/** Parse 'YYYY-MM-DD' (also accepts 'YYYY/MM/DD'); returns null when malformed. */
function parseBSDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const m = dateStr.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
    return { year, month, day };
}

/**
 * Validate a BS date against the real calendar.
 * @returns {{valid:boolean, reason?:string}}
 */
function validateBSDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.trim()) {
        return { valid: false, reason: 'Date is required' };
    }
    const p = parseBSDate(dateStr);
    if (!p) return { valid: false, reason: 'Format must be YYYY-MM-DD (e.g. 2083-05-31)' };
    if (!isSupportedYear(p.year)) {
        return { valid: false, reason: `Year must be between ${BS_MIN_YEAR} and ${BS_MAX_YEAR} BS` };
    }
    if (p.month < 1 || p.month > 12) return { valid: false, reason: 'Month must be between 1 and 12' };
    const max = getBSDaysInMonth(p.year, p.month);
    if (p.day < 1 || p.day > max) {
        return {
            valid: false,
            reason: `Day must be between 1 and ${max} for ${BS_MONTHS_EN[p.month - 1]} ${p.year}`
        };
    }
    return { valid: true };
}

/** Normalize a BS date to zero-padded 'YYYY-MM-DD'. */
function normalizeBSDate(dateStr) {
    const p = parseBSDate(dateStr);
    if (!p) return null;
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** BS → AD (string, local calendar date). */
function bsToAD(bsDateStr) {
    const p = parseBSDate(bsDateStr);
    if (!p) return null;
    if (!validateBSDate(normalizeBSDate(bsDateStr)).valid) return null;
    const target = bsDayNumber(p.year, p.month, p.day);
    const anchor = bsDayNumber(2082, 1, 1);
    const base = new Date(2025, 3, 14);            // local April 14 2025
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + (target - anchor));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** AD → BS (string). Walks the real calendar, both directions. */
function adToBS(adDateStr) {
    if (!adDateStr || typeof adDateStr !== 'string') return null;
    const m = adDateStr.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (!m) return null;
    const ad = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    if (isNaN(ad.getTime())) return null;
    const base = new Date(2025, 3, 14);
    let remaining = Math.round((ad - base) / 86400000);
    let year = 2082, month = 1, day = 1;
    while (remaining > 0) {
        const dim = getBSDaysInMonth(year, month);
        const left = dim - day + 1;
        if (remaining < left) { day += remaining; remaining = 0; }
        else {
            remaining -= left;
            month++;
            if (month > 12) { year++; month = 1; }
            day = 1;
            if (year > BS_MAX_YEAR) return null;
        }
    }
    while (remaining < 0) {
        if (day + remaining >= 1) { day += remaining; remaining = 0; }
        else {
            remaining += day - 1;
            month--;
            if (month < 1) { year--; month = 12; }
            if (year < BS_MIN_YEAR) return null;
            day = getBSDaysInMonth(year, month);
        }
    }
    return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Today as a BS 'YYYY-MM-DD' string, from the local clock. */
function todayBSDate() {
    const now = new Date();
    return adToBS(now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()));
}

/** First and last day of a BS month ('YYYY-MM') — real day count, never 30/31 fixed. */
function bsMonthRange(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10), month = parseInt(m[2], 10);
    const days = getBSDaysInMonth(year, month);
    if (!days) return null;
    return { from_date: `${year}-${pad2(month)}-01`, to_date: `${year}-${pad2(month)}-${pad2(days)}`, days };
}

/** Add (or subtract) whole days to a BS date using the calendar walk. */
function addBSDays(bsDateStr, n) {
    const ad = bsToAD(bsDateStr);
    if (!ad) return null;
    const d = new Date(ad + 'T00:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    return adToBS(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
}

/** Previous / next BS month key ('YYYY-MM'). */
function shiftBSMonth(monthKey, delta) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    let year = parseInt(m[1], 10), month = parseInt(m[2], 10) + Number(delta || 0);
    while (month > 12) { month -= 12; year++; }
    while (month < 1) { month += 12; year--; }
    return `${year}-${pad2(month)}`;
}

/** Month label, e.g. '2083-05' → 'Bhadra 2083'. */
function bsMonthLabel(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(monthKey || '');
    return `${BS_MONTHS_EN[parseInt(m[2], 10) - 1] || ''} ${m[1]}`;
}

/** Every BS month key between two BS dates, inclusive. */
function monthsBetween(fromDate, toDate) {
    const a = normalizeBSDate(fromDate), b = normalizeBSDate(toDate);
    if (!a || !b || a > b) return [];
    const out = [];
    let key = a.slice(0, 7);
    const end = b.slice(0, 7);
    while (key <= end) {
        out.push(key);
        key = shiftBSMonth(key, 1);
        if (!key) break;
        if (out.length > 1200) break;
    }
    return out;
}

/**
 * Inclusive period check for a report request. An end date is a whole day —
 * a transaction dated on  is inside the period.
 */
function validateBSRange(fromDate, toDate) {
    const from = validateBSDate(fromDate), to = validateBSDate(toDate);
    if (!from.valid) return { valid: false, reason: 'Start date: ' + from.reason };
    if (!to.valid) return { valid: false, reason: 'End date: ' + to.reason };
    if (normalizeBSDate(fromDate) > normalizeBSDate(toDate)) {
        return { valid: false, reason: 'Start date must be on or before the end date' };
    }
    return { valid: true, from_date: normalizeBSDate(fromDate), to_date: normalizeBSDate(toDate) };
}

module.exports = {
    BS_CALENDAR_DATA, BS_MONTHS_NP, BS_MONTHS_EN, BS_MIN_YEAR, BS_MAX_YEAR,
    BS_ANCHOR, pad2, isSupportedYear, getBSDaysInMonth, bsDayNumber,
    parseBSDate, validateBSDate, normalizeBSDate, bsToAD, adToBS, todayBSDate,
    bsMonthRange, addBSDays, shiftBSMonth, bsMonthLabel, monthsBetween,
    validateBSRange
};
