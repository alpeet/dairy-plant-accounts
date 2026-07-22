/**
 * Godhuli Dairy Plant — Nepali Date (Bikram Sambat) Utility
 * ===========================================================
 * Replaces all HTML <input type="date"> with BS-compatible date inputs.
 * BS dates are stored as YYYY-MM-DD strings, same format as Gregorian,
 * but validated against the BS calendar where months can have 29-32 days.
 *
 * BS Year 2083 ≈ AD 2026
 *
 * Usage:
 *   Include this script AFTER the main app scripts but BEFORE any module that uses dates.
 *   It auto-initializes on DOMContentLoaded.
 */

// ═══════════════════════════════════════════════════════════════
// BS Calendar Data
// ═══════════════════════════════════════════════════════════════
// Days per month for BS years 2080-2090
// Key: BS year → [days_in_baisakh, jestha, ashadh, shrawan, bhadra, ashwin, kartik, mangsir, poush, magh, falgun, chaitra]
const BS_CALENDAR_DATA = {
    2080: [30, 32, 31, 31, 30, 29, 30, 29, 30, 30, 30, 30],
    2081: [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2082: [31, 32, 32, 31, 31, 30, 29, 29, 30, 30, 29, 30],
    2083: [31, 32, 32, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2084: [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30, 29],
    2085: [31, 32, 31, 32, 31, 30, 29, 29, 30, 29, 30, 30],
    2086: [31, 32, 31, 32, 31, 30, 29, 30, 29, 30, 29, 30],
    2087: [31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2088: [31, 32, 31, 32, 31, 30, 29, 29, 30, 30, 29, 30],
    2089: [31, 32, 31, 32, 31, 30, 29, 30, 29, 30, 29, 30],
    2090: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 29],
};

// Default days per month (used as fallback for years not in data)
const BS_MONTH_DEFAULT_DAYS = [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 29, 30];

// Nepali month names (in Nepali and English)
const BS_MONTHS_NP = [
    'बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज',
    'कार्तिक', 'मंसिर', 'पुष', 'माघ', 'फाल्गुन', 'चैत्र'
];

const BS_MONTHS_EN = [
    'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
    'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'
];

// BS year range
const BS_MIN_YEAR = 2050;
const BS_MAX_YEAR = 2100;

// ═══════════════════════════════════════════════════════════════
// BS Date Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get the number of days in a BS month for a given year.
 */
function getBSDaysInMonth(year, month) {
    if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) return 30;
    if (month < 1 || month > 12) return 30;
    const yearData = BS_CALENDAR_DATA[year];
    if (yearData) {
        return yearData[month - 1] || 30;
    }
    return BS_MONTH_DEFAULT_DAYS[month - 1] || 30;
}

/**
 * Validate a BS date string (YYYY-MM-DD format).
 * Returns { valid: boolean, reason?: string }
 */
function validateBSDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return { valid: false, reason: 'Date is required' };
    }
    
    // Trim whitespace
    dateStr = dateStr.trim();
    
    // Allow empty (for optional dates)
    if (dateStr === '') {
        return { valid: true };
    }
    
    // Match YYYY-MM-DD format
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) {
        return { valid: false, reason: 'Format must be YYYY-MM-DD (e.g., 2083-03-15)' };
    }
    
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    
    // Validate year range
    if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) {
        return { valid: false, reason: `Year must be between ${BS_MIN_YEAR}-${BS_MAX_YEAR} BS` };
    }
    
    // Validate month
    if (month < 1 || month > 12) {
        return { valid: false, reason: 'Month must be between 1-12' };
    }
    
    // Validate day against BS calendar
    const maxDays = getBSDaysInMonth(year, month);
    if (day < 1 || day > maxDays) {
        return { valid: false, reason: `Day must be between 1-${maxDays} for ${BS_MONTHS_EN[month-1]} (month ${month} in BS ${year})` };
    }
    
    return { valid: true };
}

/**
 * Get today's date as BS date string.
 * Uses a simple AD→BS conversion approximation.
 * For exact conversion, this maps known BS dates.
 */
function getTodayBS() {
    const now = new Date();
    
    // Approximate conversion: BS year ≈ AD year + 57
    // More precisely: 
    //   Mid-April (4月) is BS New Year (Baisakh 1)
    //   Before mid-April: BS year = AD year + 56
    //   After mid-April: BS year = AD year + 57
    
    const adYear = now.getFullYear();
    const adMonth = now.getMonth() + 1; // 1-12
    const adDay = now.getDate();
    
    // BS New Year starts around April 13-14
    let bsYear = adYear + 56;
    let bsMonth = 9; // Start from Poush (month 9) roughly
    let bsDay = adDay;
    
    // Rough mapping: 
    // Jan (1) → Poush/Magh (9/10)
    // Feb (2) → Magh/Falgun (10/11)
    // Mar (3) → Falgun/Chaitra (11/12)
    // Apr (4) → Chaitra/Baisakh (12/1)
    // May (5) → Baisakh/Jestha (1/2)
    // Jun (6) → Jestha/Ashadh (2/3)
    // Jul (7) → Ashadh/Shrawan (3/4)
    // Aug (8) → Shrawan/Bhadra (4/5)
    // Sep (9) → Bhadra/Ashwin (5/6)
    // Oct (10) → Ashwin/Kartik (6/7)
    // Nov (11) → Kartik/Mangsir (7/8)
    // Dec (12) → Mangsir/Poush (8/9)
    
    // Simplified: BS month roughly = ((AD month + 8) % 12) + 1
    bsMonth = ((adMonth + 8) % 12) + 1;
    bsDay = adDay;
    
    if (adMonth >= 4) {
        bsYear = adYear + 57;
    }
    
    // Clamp day to valid range
    const maxDay = getBSDaysInMonth(bsYear, bsMonth);
    if (bsDay > maxDay) bsDay = maxDay;
    
    return `${bsYear}-${String(bsMonth).padStart(2, '0')}-${String(bsDay).padStart(2, '0')}`;
}

/**
 * Format a BS date string for display in Nepali.
 */
function formatBSDateNP(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return dateStr;
    
    const year = match[1];
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const monthName = BS_MONTHS_NP[month - 1] || '';
    
    return `${year} ${monthName} ${day}`;
}

/**
 * Format a BS date string for display in English.
 */
function formatBSDateEN(dateStr) {
    if (!dateStr) return '';
    const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!match) return dateStr;
    
    const year = match[1];
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const monthName = BS_MONTHS_EN[month - 1] || '';
    
    return `${year} ${monthName} ${day}`;
}

// ═══════════════════════════════════════════════════════════════
// BS Date Picker Widget
// ═══════════════════════════════════════════════════════════════

let datePickerOpen = false;
let currentPickerInput = null;
let currentPickerContainer = null;

/**
 * Create a BS date picker widget for a given input element.
 * Returns a container div with year/month/day dropdowns + calendar.
 */
function createBSPicker(input) {
    // Get current value or today
    const currentVal = input.value || getTodayBS();
    const match = currentVal.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    
    let selYear = BS_MIN_YEAR;
    let selMonth = 1;
    let selDay = 1;
    
    if (match) {
        selYear = parseInt(match[1], 10);
        selMonth = parseInt(match[2], 10);
        selDay = parseInt(match[3], 10);
        // Clamp
        const maxD = getBSDaysInMonth(selYear, selMonth);
        if (selDay > maxD) selDay = maxD;
    } else {
        const today = getTodayBS();
        const tMatch = today.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (tMatch) {
            selYear = parseInt(tMatch[1], 10);
            selMonth = parseInt(tMatch[2], 10);
            selDay = parseInt(tMatch[3], 10);
        }
    }
    
    // Create picker container
    const container = document.createElement('div');
    container.className = 'bs-date-picker';
    container.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: white;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 2px 4px;
        font-size: 13px;
    `;
    
    // Year selector
    const yearSelect = document.createElement('select');
    yearSelect.className = 'bs-year-select';
    yearSelect.style.cssText = `
        border: none;
        background: transparent;
        font-size: 13px;
        padding: 4px 2px;
        cursor: pointer;
        outline: none;
        font-weight: 600;
        min-width: 60px;
    `;
    for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y;
        if (y === selYear) opt.selected = true;
        yearSelect.appendChild(opt);
    }
    
    // Month selector
    const monthSelect = document.createElement('select');
    monthSelect.className = 'bs-month-select';
    monthSelect.style.cssText = `
        border: none;
        background: transparent;
        font-size: 13px;
        padding: 4px 2px;
        cursor: pointer;
        outline: none;
        min-width: 70px;
    `;
    for (let m = 0; m < 12; m++) {
        const opt = document.createElement('option');
        opt.value = m + 1;
        opt.textContent = BS_MONTHS_NP[m];
        if ((m + 1) === selMonth) opt.selected = true;
        monthSelect.appendChild(opt);
    }
    
    // Day selector
    const daySelect = document.createElement('select');
    daySelect.className = 'bs-day-select';
    daySelect.style.cssText = `
        border: none;
        background: transparent;
        font-size: 13px;
        padding: 4px 2px;
        cursor: pointer;
        outline: none;
        min-width: 50px;
    `;
    updateDayOptions(daySelect, selYear, selMonth, selDay);
    
    // Update days when year/month changes
    function onYearMonthChange() {
        const y = parseInt(yearSelect.value, 10);
        const m = parseInt(monthSelect.value, 10);
        const currentD = parseInt(daySelect.value, 10);
        updateDayOptions(daySelect, y, m, currentD);
        updateInputValue();
    }
    
    yearSelect.addEventListener('change', onYearMonthChange);
    monthSelect.addEventListener('change', onYearMonthChange);
    daySelect.addEventListener('change', updateInputValue);
    
    function updateInputValue() {
        const y = yearSelect.value;
        const m = String(monthSelect.value).padStart(2, '0');
        const d = String(daySelect.value).padStart(2, '0');
        input.value = `${y}-${m}-${d}`;
        // Trigger change event for other handlers
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    container.appendChild(yearSelect);
    container.appendChild(monthSelect);
    container.appendChild(daySelect);
    
    // Store reference
    container._yearSelect = yearSelect;
    container._monthSelect = monthSelect;
    container._daySelect = daySelect;
    
    return container;
}

function updateDayOptions(daySelect, year, month, selectedDay) {
    const maxDays = getBSDaysInMonth(year, month);
    daySelect.innerHTML = '';
    for (let d = 1; d <= maxDays; d++) {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (d === selectedDay || (d === 1 && selectedDay > maxDays)) {
            opt.selected = true;
        }
        daySelect.appendChild(opt);
    }
}

// ═══════════════════════════════════════════════════════════════
// Auto-Init: Replace all date inputs with BS pickers
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize a single date input field with BS date picker.
 */
function initBSDateInput(input) {
    // Skip if already initialized
    if (input.dataset.bsInitialized === 'true') return;
    input.dataset.bsInitialized = 'true';
    
    // Change type from date to text to avoid native date picker
    if (input.type === 'date') {
        input.type = 'text';
    }
    
    // Style the input
    input.style.cssText = (input.style.cssText || '') + `
        cursor: pointer;
        caret-color: transparent;
    `;
    input.readOnly = true; // Make read-only since we use the picker
    
    // Override Gregorian today() defaults with BS today
    const yrMatch = (input.value || '').match(/^(\d{4})/);
    if (yrMatch) {
        const yr = parseInt(yrMatch[1], 10);
        // If year < 2050 it's clearly Gregorian (e.g., 2026), use BS today instead
        if (yr < 2050) {
            input.value = getTodayBS();
        }
    } else if (!input.value) {
        input.value = getTodayBS();
    }
    
    // Create picker
    const picker = createBSPicker(input);
    
    // Insert picker after the input, hide the input
    input.style.display = 'none';
    input.parentNode.insertBefore(picker, input.nextSibling);
    
    // Tag the picker for later reference
    picker.dataset.forInput = input.id || input.name || Math.random();
}

/**
 * Find and initialize all date inputs in the document.
 */
function initAllBSDateInputs() {
    document.querySelectorAll('input[type="date"], input[data-bs-date]').forEach(input => {
        initBSDateInput(input);
    });
}

/**
 * Initialize BS dates for dynamically added content.
 * Call this after rendering new HTML that contains date inputs.
 */
function refreshBSDateInputs(container) {
    const scope = container || document;
    scope.querySelectorAll('input[type="date"]:not([data-bs-initialized="true"])').forEach(input => {
        initBSDateInput(input);
    });
}

/**
 * Get a BS date value from an input, handling the picker-wrapper.
 * Works with both initialized and un-initialized inputs.
 */
function getBSDateValue(input) {
    if (!input) return '';
    return input.value || '';
}

/**
 * Set a BS date value on an input, updating the picker if present.
 */
function setBSDateValue(input, dateStr) {
    if (!input) return;
    input.value = dateStr || getTodayBS();
    
    // Update picker selects if present
    const picker = input.nextElementSibling;
    if (picker && picker.classList.contains('bs-date-picker')) {
        const match = (dateStr || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        if (match) {
            const y = match[1];
            const m = parseInt(match[2], 10);
            const d = parseInt(match[3], 10);
            
            if (picker._yearSelect) picker._yearSelect.value = y;
            if (picker._monthSelect) picker._monthSelect.value = m;
            if (picker._daySelect) {
                updateDayOptions(picker._daySelect, parseInt(y), m, d);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Helpers for other scripts
// ═══════════════════════════════════════════════════════════════

/**
 * Format a BS date for display in forms.
 * Returns Nepali format: "2083 असार 15"
 */
function formatDateNP(dateStr) {
    return formatBSDateNP(dateStr);
}

/**
 * Format a BS date for display in English.
 * Returns: "2083 Ashadh 15"
 */
function formatDateEN(dateStr) {
    return formatBSDateEN(dateStr);
}

/**
 * Validate a date string against BS calendar rules.
 * Returns error string or empty string (valid).
 */
function validateDate(dateStr) {
    const result = validateBSDate(dateStr);
    return result.valid ? '' : (result.reason || 'Invalid BS date');
}

// ═══════════════════════════════════════════════════════════════
// Auto-Initialize
// ═══════════════════════════════════════════════════════════════

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllBSDateInputs);
} else {
    initAllBSDateInputs();
}

// Also observe for dynamically added content
if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
        // Only check for uninitialized date inputs
        const uninit = document.querySelectorAll('input[type="date"]:not([data-bs-initialized="true"])');
        if (uninit.length > 0) {
            uninit.forEach(input => initBSDateInput(input));
        }
    });
    observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true,
        attributes: false
    });
}

// ═══════════════════════════════════════════════════════════════
// Globals (exposed for inline script usage)
// ═══════════════════════════════════════════════════════════════

window.NepaliDate = {
    validate: validateBSDate,
    getToday: getTodayBS,
    format: formatBSDateEN,
    formatNP: formatBSDateNP,
    formatEN: formatBSDateEN,
    getDaysInMonth: getBSDaysInMonth,
    refresh: refreshBSDateInputs,
    getValue: getBSDateValue,
    setValue: setBSDateValue,
    months: BS_MONTHS_EN,
    monthsNP: BS_MONTHS_NP,
    MIN_YEAR: BS_MIN_YEAR,
    MAX_YEAR: BS_MAX_YEAR,
};

// Also expose the standalone helpers for backward compatibility
window.validateDate = validateDate;
window.formatDateNP = formatDateNP;
window.formatDateEN = formatDateEN;
window.todayBS = getTodayBS;
window.refreshBSDateInputs = refreshBSDateInputs;

// Override the common today() function used throughout the app
// Many JS files define: const today = () => new Date().toISOString().split('T')[0]
// which returns Gregorian dates. We want BS dates instead.
if (typeof window.today === 'undefined') {
    window.today = window.todayBS || getTodayBS;
}
