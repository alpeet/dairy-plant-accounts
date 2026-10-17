/**
 * Prarambha Account & Stock Management — Nepali Date (Bikram Sambat) Utility
 * =========================================================================
 * Replaces every <input type="date"> with a BS-compatible picker. Dates are
 * stored as 'YYYY-MM-DD' BS strings, exactly like Gregorian, but every month
 * length comes from the real BS calendar (window.BS_CALENDAR_DATA, generated
 * from shared/bs-calendar.js). Months have 29–32 days and every year differs.
 *
 * ROOT CAUSE of the "can't pick Ashwin 31 / wrong month end" bug: this file
 * used to carry its own private 2080–2090 table with 2083 as
 * [31,32,32,31,31,30,29,30,29,30,29,30]. The real 2083 is
 * [31,31,32,31,31,31,30,29,30,29,30,30], so Jestha offered a non-existent day
 * 32, Ashwin stopped at 30 (today is 2083-06-31), and Kartik/Mangsir/Poush were
 * off by a day. The table now comes from the single shared source and the
 * picker can navigate every month and year in it.
 *
 * Usage: include renderer/js/bs-calendar-data.js BEFORE this script.
 */

/* global BS_CALENDAR_DATA, BS_MONTHS_NP, BS_MONTHS_EN, BS_MIN_YEAR, BS_MAX_YEAR */

const BS_MONTHS_NP = window.BS_MONTHS_NP || ['बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
    'कार्तिक', 'मंसिर', 'पुष', 'माघ', 'फाल्गुन', 'चैत्र'];
const BS_MONTHS_EN = window.BS_MONTHS_EN || ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
    'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const BS_MIN_YEAR = window.BS_MIN_YEAR || 2000;
const BS_MAX_YEAR = window.BS_MAX_YEAR || 2090;
const _BS_DATA = window.BS_CALENDAR_DATA || {};

// ═══════════════════════════════════════════════════════════════
// BS Date Functions
// ═══════════════════════════════════════════════════════════════

function pad2(n) { return String(n).padStart(2, '0'); }

function isBSYear(year) {
    return Number.isInteger(year) && year >= BS_MIN_YEAR && year <= BS_MAX_YEAR;
}

/** Real number of days in a BS month (0 when the year/month is unsupported). */
function getBSDaysInMonth(year, month) {
    if (!isBSYear(year) || month < 1 || month > 12) return 0;
    const row = _BS_DATA[year];
    return row ? row[month - 1] : 0;
}

/** Last valid day of a BS month. */
function getBSMonthEnd(year, month) {
    return getBSDaysInMonth(year, month);
}

function parseBS(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const m = dateStr.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (!m) return null;
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

/** Normalize to zero-padded 'YYYY-MM-DD'. */
function normalizeBS(dateStr) {
    const p = parseBS(dateStr);
    return p ? `${p.year}-${pad2(p.month)}-${pad2(p.day)}` : null;
}

/**
 * Validate a BS date string (YYYY-MM-DD) against the real calendar.
 * @returns {{valid:boolean, reason?:string}}
 */
function validateBSDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || !dateStr.trim()) {
        return { valid: false, reason: 'Date is required' };
    }
    const p = parseBS(dateStr);
    if (!p) return { valid: false, reason: 'Format must be YYYY-MM-DD (e.g. 2083-05-31)' };
    if (!isBSYear(p.year)) {
        return { valid: false, reason: `Year must be between ${BS_MIN_YEAR} and ${BS_MAX_YEAR} BS` };
    }
    if (p.month < 1 || p.month > 12) {
        return { valid: false, reason: 'Month must be between 1 and 12' };
    }
    const max = getBSDaysInMonth(p.year, p.month);
    if (p.day < 1 || p.day > max) {
        return {
            valid: false,
            reason: `Day must be between 1 and ${max} for ${BS_MONTHS_EN[p.month - 1]} ${p.year}`
        };
    }
    return { valid: true };
}

/** Whole days from BS 2000-01-01 to a BS date. */
function bsDayNumber(year, month, day) {
    let total = 0;
    for (let y = BS_MIN_YEAR; y < year; y++) {
        for (let m = 1; m <= 12; m++) total += getBSDaysInMonth(y, m);
    }
    for (let m = 1; m < month; m++) total += getBSDaysInMonth(year, m);
    return total + day - 1;
}

/**
 * Exact AD → BS conversion, walking the real calendar.
 * Anchor: BS 2082-01-01 = AD 2025-04-14 (Nepali New Year).
 * @param {string|Date} adDate
 * @returns {string|null} 'YYYY-MM-DD' BS
 */
function adToBS(adDate) {
    let target;
    if (adDate instanceof Date) {
        target = new Date(adDate.getFullYear(), adDate.getMonth(), adDate.getDate());
    } else if (typeof adDate === 'string') {
        const m = adDate.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
        if (!m) return null;
        target = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    } else {
        return null;
    }
    if (isNaN(target.getTime())) return null;

    const refAD = new Date(2025, 3, 14);
    let remaining = Math.round((target - refAD) / 86400000);
    let bsYear = 2082, bsMonth = 1, bsDay = 1;

    while (remaining > 0) {
        const daysInMonth = getBSDaysInMonth(bsYear, bsMonth);
        const daysLeft = daysInMonth - bsDay + 1;
        if (remaining < daysLeft) {
            bsDay += remaining;
            remaining = 0;
        } else {
            remaining -= daysLeft;
            bsMonth++;
            if (bsMonth > 12) { bsYear++; bsMonth = 1; }
            bsDay = 1;
            if (bsYear > BS_MAX_YEAR) return null;
        }
    }
    while (remaining < 0) {
        if (bsDay + remaining >= 1) {
            bsDay += remaining;
            remaining = 0;
        } else {
            remaining += bsDay - 1;
            bsMonth--;
            if (bsMonth < 1) { bsYear--; bsMonth = 12; }
            if (bsYear < BS_MIN_YEAR) return null;
            bsDay = getBSDaysInMonth(bsYear, bsMonth);
        }
    }
    return `${bsYear}-${pad2(bsMonth)}-${pad2(bsDay)}`;
}

/** Exact BS → AD. */
function bsToAD(bsDateStr) {
    const v = validateBSDate(normalizeBS(bsDateStr) || '');
    if (!v.valid) return null;
    const p = parseBS(bsDateStr);
    const target = bsDayNumber(p.year, p.month, p.day);
    const anchor = bsDayNumber(2082, 1, 1);
    const d = new Date(2025, 3, 14);
    d.setDate(d.getDate() + (target - anchor));
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Today as BS 'YYYY-MM-DD' (local clock). */
function getTodayBS() {
    return adToBS(new Date()) || '2082-01-01';
}

/** First/last day of a BS month key 'YYYY-MM'. End date is the real month end. */
function getBSMonthRange(monthKey) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = parseInt(m[1], 10), month = parseInt(m[2], 10);
    const days = getBSDaysInMonth(year, month);
    if (!days) return null;
    return { from_date: `${year}-${pad2(month)}-01`, to_date: `${year}-${pad2(month)}-${pad2(days)}`, days };
}

/** Previous / next BS month key. */
function shiftBSMonth(monthKey, delta) {
    const m = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    let year = parseInt(m[1], 10), month = parseInt(m[2], 10) + Number(delta || 0);
    while (month > 12) { month -= 12; year++; }
    while (month < 1) { month += 12; year--; }
    return `${year}-${pad2(month)}`;
}

/**
 * Validate a report period. The end date is inclusive — a document dated on the
 * end date belongs to the period, so callers must use `date <= to_date`.
 * @returns {{valid:boolean, reason?:string, from_date?:string, to_date?:string}}
 */
function validateBSRange(fromDate, toDate) {
    const from = validateBSDate(fromDate);
    const to = validateBSDate(toDate);
    if (!from.valid) return { valid: false, reason: 'Start date: ' + from.reason };
    if (!to.valid) return { valid: false, reason: 'End date: ' + to.reason };
    if (normalizeBS(fromDate) > normalizeBS(toDate)) {
        return { valid: false, reason: 'Start date must be on or before the end date' };
    }
    return { valid: true, from_date: normalizeBS(fromDate), to_date: normalizeBS(toDate) };
}

/**
 * Keep a start/end pair ordered. When the new start is after the current end,
 * the end is moved to the same day (never silently dropped).
 * Returns {from, to, corrected}.
 */
function alignBSRange(fromDate, toDate) {
    const from = normalizeBS(fromDate);
    const to = normalizeBS(toDate);
    if (!from || !to) return { from, to, corrected: false };
    if (from > to) return { from, to: from, corrected: true };
    return { from, to, corrected: false };
}

/**
 * Format a BS date string for display in Nepali: "2083 भदौ 31".
 */
function formatBSDateNP(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return dateStr;
    const monthName = BS_MONTHS_NP[parseInt(match[2], 10) - 1] || '';
    return `${match[1]} ${monthName} ${parseInt(match[3], 10)}`;
}

/** Format a BS date string in English: "2083 Bhadra 31". */
function formatBSDateEN(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return dateStr;
    const monthName = BS_MONTHS_EN[parseInt(match[2], 10) - 1] || '';
    return `${match[1]} ${monthName} ${parseInt(match[3], 10)}`;
}

// ═══════════════════════════════════════════════════════════════
// BS Date Picker Widget
// ═══════════════════════════════════════════════════════════════

/**
 * Build the inline picker: ‹ year month day › plus year jump buttons.
 * Every control re-derives the day list from the calendar, so 29/30/31/32-day
 * months are all reachable and impossible days are never offered.
 */
function createBSPicker(input) {
    const currentVal = input.value || getTodayBS();
    const parsed = parseBS(currentVal) || parseBS(getTodayBS());
    let selYear = parsed.year;
    let selMonth = parsed.month;
    let selDay = parsed.day;

    const maxD = getBSDaysInMonth(selYear, selMonth);
    if (selDay > maxD) selDay = maxD;   // clamp to month end, not to day 1

    const container = document.createElement('div');
    container.className = 'bs-date-picker';
    container.style.cssText = 'display:inline-flex;align-items:center;gap:2px;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:1px 3px;font-size:13px';

    const mkBtn = (text, title, onClick) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.title = title;
        b.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:12px;padding:2px 3px;color:#4b5563;line-height:1';
        b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return b;
    };

    const yearSelect = document.createElement('select');
    yearSelect.className = 'bs-year-select';
    yearSelect.style.cssText = 'border:none;background:transparent;font-size:13px;padding:4px 1px;cursor:pointer;outline:none;font-weight:600';
    for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y;
        if (y === selYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }

    const monthSelect = document.createElement('select');
    monthSelect.className = 'bs-month-select';
    monthSelect.style.cssText = 'border:none;background:transparent;font-size:13px;padding:4px 1px;cursor:pointer;outline:none';
    for (let m = 1; m <= 12; m++) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${BS_MONTHS_EN[m - 1]} / ${BS_MONTHS_NP[m - 1]}`;
        if (m === selMonth) opt.selected = true;
        monthSelect.appendChild(opt);
    }

    const daySelect = document.createElement('select');
    daySelect.className = 'bs-day-select';
    daySelect.style.cssText = 'border:none;background:transparent;font-size:13px;padding:4px 1px;cursor:pointer;outline:none';

    function rebuildDays(keepDay) {
        const max = getBSDaysInMonth(parseInt(yearSelect.value, 10), parseInt(monthSelect.value, 10));
        const want = Math.min(Math.max(parseInt(keepDay, 10) || 1, 1), max);
        daySelect.innerHTML = '';
        for (let d = 1; d <= max; d++) {
            const opt = document.createElement('option');
            opt.value = d; opt.textContent = d;
            if (d === want) opt.selected = true;
            daySelect.appendChild(opt);
        }
    }
    rebuildDays(selDay);

    function commit() {
        const y = yearSelect.value;
        const m = pad2(monthSelect.value);
        const d = pad2(daySelect.value);
        input.value = `${y}-${m}-${d}`;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function stepMonth(delta) {
        let y = parseInt(yearSelect.value, 10);
        let m = parseInt(monthSelect.value, 10) + delta;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
        if (!isBSYear(y)) return;                     // stop at the supported range
        yearSelect.value = y;
        monthSelect.value = m;
        rebuildDays(selDay);                          // keep the day, clamp to month end
        commit();
    }

    function stepYear(delta) {
        const y = parseInt(yearSelect.value, 10) + delta;
        if (!isBSYear(y)) return;
        yearSelect.value = y;
        rebuildDays(selDay);                          // 29/30/31/32 re-derived
        commit();
    }

    yearSelect.addEventListener('change', () => { rebuildDays(daySelect.value); commit(); });
    monthSelect.addEventListener('change', () => { rebuildDays(daySelect.value); commit(); });
    daySelect.addEventListener('change', commit);

    container.appendChild(mkBtn('«', 'Previous year', () => stepYear(-1)));
    container.appendChild(mkBtn('‹', 'Previous month', () => stepMonth(-1)));
    container.appendChild(yearSelect);
    container.appendChild(monthSelect);
    container.appendChild(daySelect);
    container.appendChild(mkBtn('›', 'Next month', () => stepMonth(1)));
    container.appendChild(mkBtn('»', 'Next year', () => stepYear(1)));

    container._yearSelect = yearSelect;
    container._monthSelect = monthSelect;
    container._daySelect = daySelect;
    container._rebuildDays = rebuildDays;
    container._commit = commit;
    return container;
}

function updateDayOptions(daySelect, year, month, selectedDay) {
    const maxDays = getBSDaysInMonth(year, month);
    const keep = Math.min(Math.max(parseInt(selectedDay, 10) || 1, 1), maxDays || 1);
    daySelect.innerHTML = '';
    for (let d = 1; d <= maxDays; d++) {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        if (d === keep) opt.selected = true;
        daySelect.appendChild(opt);
    }
}

// ═══════════════════════════════════════════════════════════════
// Auto-Init
// ═══════════════════════════════════════════════════════════════

function initBSDateInput(input) {
    if (input.dataset.bsInitialized === 'true') return;
    input.dataset.bsInitialized = 'true';

    if (input.type === 'date') input.type = 'text';
    input.style.cssText = (input.style.cssText || '') + ';cursor:pointer;caret-color:transparent';
    input.readOnly = true;

    // Empty inputs get today unless they opt out (filter bars where empty = all).
    if (!input.value && input.dataset.noDefault !== '1') {
        input.value = getTodayBS();
    }

    const picker = createBSPicker(input);
    input.style.display = 'none';
    input.parentNode.insertBefore(picker, input.nextSibling);
    picker.dataset.forInput = input.id || input.name || '';
    input._bsPicker = picker;
}

function initAllBSDateInputs() {
    document.querySelectorAll('input[type="date"], input[data-bs-date]').forEach(input => {
        initBSDateInput(input);
    });
    enhanceBSMonthInputs(document);
}

/**
 * BS month picker for <input type="month"> (salary etc.). Value stays YYYY-MM.
 * Adds ‹ › buttons so any month, including a 32-day month's end, is reachable.
 */
function enhanceBSMonthInputs(scope) {
    (scope || document).querySelectorAll('input[type="month"]:not([data-bs-month-initialized="true"])').forEach(input => {
        const current = input.value && /^\d{4}-\d{2}$/.test(input.value) ? input.value : getTodayBS().substring(0, 7);
        input.type = 'text';
        input.readOnly = true;
        input.style.display = 'none';
        input.value = current;
        input.setAttribute('data-bs-month-initialized', 'true');

        const wrap = document.createElement('div');
        wrap.className = 'bs-date-picker';
        wrap.style.cssText = 'display:flex;gap:4px;align-items:center';

        const prev = document.createElement('button');
        prev.type = 'button'; prev.textContent = '‹'; prev.title = 'Previous month';
        prev.style.cssText = 'border:none;background:transparent;cursor:pointer;font-size:14px;padding:2px 4px';

        const ySel = document.createElement('select');
        ySel.className = 'form-control';
        const mSel = document.createElement('select');
        mSel.className = 'form-control';

        const cy = parseInt(current.substring(0, 4), 10);
        for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y + ' BS';
            ySel.appendChild(opt);
        }
        for (let m = 1; m <= 12; m++) {
            const opt = document.createElement('option');
            opt.value = pad2(m);
            opt.textContent = (BS_MONTHS_EN[m - 1] || '') + ' / ' + (BS_MONTHS_NP[m - 1] || '');
            mSel.appendChild(opt);
        }
        ySel.value = String(cy);
        mSel.value = current.substring(5, 7);

        const next = document.createElement('button');
        next.type = 'button'; next.textContent = '›'; next.title = 'Next month';
        next.style.cssText = prev.style.cssText;

        const sync = () => {
            input.value = ySel.value + '-' + mSel.value;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const step = (delta) => {
            const nextKey = shiftBSMonth(ySel.value + '-' + mSel.value, delta);
            if (!nextKey) return;
            ySel.value = nextKey.slice(0, 4);
            mSel.value = nextKey.slice(5, 7);
            sync();
        };
        ySel.addEventListener('change', sync);
        mSel.addEventListener('change', sync);
        prev.addEventListener('click', (e) => { e.preventDefault(); step(-1); });
        next.addEventListener('click', (e) => { e.preventDefault(); step(1); });

        wrap.appendChild(prev);
        wrap.appendChild(ySel);
        wrap.appendChild(mSel);
        wrap.appendChild(next);
        input.parentNode.insertBefore(wrap, input.nextSibling);
    });
}

/** Initialize BS pickers for freshly rendered HTML. */
function refreshBSDateInputs(container) {
    const scope = container || document;
    scope.querySelectorAll('input[type="date"]:not([data-bs-initialized="true"]), input[data-bs-date]:not([data-bs-initialized="true"])')
        .forEach(input => initBSDateInput(input));
    enhanceBSMonthInputs(scope);
}

function getBSDateValue(input) {
    return input ? (input.value || '') : '';
}

/**
 * Set a BS value and update the visible picker. When the input already carries
 * a picker, the selects are re-synced so the widget and value never disagree.
 */
function setBSDateValue(input, dateStr) {
    if (!input) return;
    const value = dateStr || getTodayBS();
    input.value = value;
    const picker = input._bsPicker || input.nextElementSibling;
    if (picker && picker.classList && picker.classList.contains('bs-date-picker')) {
        const p = parseBS(value);
        if (p && picker._yearSelect) {
            picker._yearSelect.value = p.year;
            picker._monthSelect.value = p.month;
            const max = getBSDaysInMonth(p.year, p.month);
            picker._rebuildDays(Math.min(p.day, max));
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Public helpers used by report modules
// ═══════════════════════════════════════════════════════════════

function formatDateNP(dateStr) { return formatBSDateNP(dateStr); }
function formatDateEN(dateStr) { return formatBSDateEN(dateStr); }

function validateDate(dateStr) {
    const result = validateBSDate(dateStr);
    return result.valid ? '' : (result.reason || 'Invalid BS date');
}

function setupBSDateSystem() {
    initAllBSDateInputs();

    if (typeof MutationObserver !== 'undefined' && document.body) {
        const observer = new MutationObserver(() => {
            const uninit = document.querySelectorAll('input[type="date"]:not([data-bs-initialized="true"]), input[data-bs-date]:not([data-bs-initialized="true"])');
            if (uninit.length > 0) uninit.forEach(input => initBSDateInput(input));
            const uninitMonth = document.querySelectorAll('input[type="month"]:not([data-bs-month-initialized="true"])');
            if (uninitMonth.length > 0) enhanceBSMonthInputs(document);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: false });
    }
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupBSDateSystem);
    } else {
        setupBSDateSystem();
    }
}

// ═══════════════════════════════════════════════════════════════
// Globals
// ═══════════════════════════════════════════════════════════════

window.NepaliDate = {
    validate: validateBSDate,
    validateRange: validateBSRange,
    alignRange: alignBSRange,
    getToday: getTodayBS,
    format: formatBSDateEN,
    formatNP: formatBSDateNP,
    formatEN: formatBSDateEN,
    getDaysInMonth: getBSDaysInMonth,
    getMonthEnd: getBSMonthEnd,
    getMonthRange: getBSMonthRange,
    shiftMonth: shiftBSMonth,
    adToBS: adToBS,
    bsToAD: bsToAD,
    refresh: refreshBSDateInputs,
    getValue: getBSDateValue,
    setValue: setBSDateValue,
    months: BS_MONTHS_EN,
    monthsNP: BS_MONTHS_NP,
    MIN_YEAR: BS_MIN_YEAR,
    MAX_YEAR: BS_MAX_YEAR,
};

window.validateDate = validateDate;
window.formatDateNP = formatDateNP;
window.formatDateEN = formatDateEN;
window.todayBS = getTodayBS;
window.refreshBSDateInputs = refreshBSDateInputs;
window.validateBSDate = validateBSDate;
window.validateBSRange = validateBSRange;
window.adToBS = adToBS;
window.bsToAD = bsToAD;
