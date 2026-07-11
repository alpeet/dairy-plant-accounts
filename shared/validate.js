/**
 * Godhuli Dairy Plant — Server-Side Input Validation
 * ===================================================
 * Reusable validation functions for all save endpoints.
 * Each function returns an error string or null (valid).
 *
 * Usage:
 *   const { validateParty, ValidationError } = require('./shared/validate');
 *   const error = validateParty(data);
 *   if (error) return res.json({ success: false, error });
 */

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Check if a value is a non-empty string */
function isString(val, maxLen = 200) {
    return typeof val === 'string' && val.trim().length > 0 && val.length <= maxLen;
}

/** Check if a value is a finite number (or can be parsed as one) */
function isNumber(val) {
    if (typeof val === 'number') return Number.isFinite(val);
    if (typeof val === 'string' && val.trim()) {
        const n = parseFloat(val);
        return Number.isFinite(n);
    }
    return false;
}

/** Check if a value is a positive number (> 0) */
function isPositiveNumber(val) {
    return isNumber(val) && parseFloat(val) > 0;
}

/** Check if a value is a non-negative number (>= 0) */
function isNonNegativeNumber(val) {
    return isNumber(val) && parseFloat(val) >= 0;
}

/** Check if a value is an integer ID (> 0) */
function isValidId(val) {
    if (typeof val === 'number') return Number.isInteger(val) && val > 0;
    if (typeof val === 'string') {
        const n = parseInt(val, 10);
        return !isNaN(n) && n > 0 && String(n) === val.trim();
    }
    return false;
}

/** Check if a value is a valid YYYY-MM-DD date string */
function isValidDate(val) {
    if (typeof val !== 'string') return false;
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const [, y, m, d] = match;
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    return date.getFullYear() === parseInt(y) &&
           date.getMonth() === parseInt(m) - 1 &&
           date.getDate() === parseInt(d);
}

/** Check if a value is one of the allowed enum values */
function isEnum(val, allowed) {
    return allowed.includes(val);
}

/** Validate an array of item objects */
function isValidItemArray(items, itemValidator) {
    if (!Array.isArray(items) || items.length === 0) return false;
    return items.every(item => itemValidator(item));
}

// ──────────────────────────────────────────────────────────────
// Validation Functions
// ──────────────────────────────────────────────────────────────

/**
 * Validate party save/update data.
 * @returns {string|null} Error message or null if valid.
 */
function validateParty(data) {
    if (!data || typeof data !== 'object') return 'Party data is required';

    // Name is required
    if (!isString(data.name, 100)) return 'Party name is required (max 100 characters)';

    // Type must be valid enum
    if (data.type && !isEnum(data.type, ['customer', 'supplier', 'both'])) {
        return 'Party type must be customer, supplier, or both';
    }

    // Opening balance must be a valid number
    if (data.opening_balance !== undefined && data.opening_balance !== null && data.opening_balance !== '') {
        // Allow "0" and 0 as valid
        const bal = parseFloat(data.opening_balance);
        if (!Number.isFinite(bal)) return 'Opening balance must be a valid number';
    }

    // String field lengths
    if (data.phone && data.phone.length > 30) return 'Phone number is too long (max 30 characters)';
    if (data.address && data.address.length > 500) return 'Address is too long (max 500 characters)';
    if (data.pan_vat && data.pan_vat.length > 50) return 'PAN/VAT is too long (max 50 characters)';
    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null; // valid
}

/**
 * Validate product save/update data.
 */
function validateProduct(data) {
    if (!data || typeof data !== 'object') return 'Product data is required';

    if (!isString(data.name, 100)) return 'Product name is required (max 100 characters)';

    if (data.unit && data.unit.length > 20) return 'Unit is too long (max 20 characters)';
    if (data.category && data.category.length > 50) return 'Category is too long (max 50 characters)';
    if (data.hsn_code && data.hsn_code.length > 20) return 'HSN code is too long (max 20 characters)';
    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    // Numeric fields must be valid numbers
    if (data.opening_stock !== undefined && data.opening_stock !== null && data.opening_stock !== '') {
        if (!isNonNegativeNumber(data.opening_stock)) return 'Opening stock must be a non-negative number';
    }
    if (data.reorder_level !== undefined && data.reorder_level !== null && data.reorder_level !== '') {
        if (!isNonNegativeNumber(data.reorder_level)) return 'Reorder level must be a non-negative number';
    }
    if (data.rate !== undefined && data.rate !== null && data.rate !== '') {
        if (!isNonNegativeNumber(data.rate)) return 'Rate must be a non-negative number';
    }
    if (data.gst_rate !== undefined && data.gst_rate !== null && data.gst_rate !== '') {
        if (!isNonNegativeNumber(data.gst_rate)) return 'GST rate must be a non-negative number';
    }

    return null;
}

/**
 * Validate a single sales/purchase item row.
 */
function isValidSaleItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (!isValidId(item.product_id)) return false;
    if (!isPositiveNumber(item.quantity)) return false;
    if (!isNonNegativeNumber(item.rate)) return false;
    return true;
}

function isValidPurchaseItem(item) {
    if (!item || typeof item !== 'object') return false;
    if (!isValidId(item.product_id)) return false;
    if (!isPositiveNumber(item.quantity)) return false;
    if (!isNonNegativeNumber(item.rate)) return false;
    return true;
}

/**
 * Validate sale save/update data.
 */
function validateSale(data) {
    if (!data || typeof data !== 'object') return 'Sale data is required';

    if (!isString(data.invoice_no, 50)) return 'Invoice number is required (max 50 characters)';
    if (!isValidId(data.party_id)) return 'Valid party is required';

    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';

    // Items validation
    if (!Array.isArray(data.items) || data.items.length === 0) return 'At least one sale item is required';
    if (!isValidItemArray(data.items, isValidSaleItem)) {
        return 'Each sale item must have a valid product, quantity (> 0), and rate (>= 0)';
    }

    // Numeric fields
    if (!isNonNegativeNumber(data.subtotal)) return 'Subtotal must be a non-negative number';
    if (!isNonNegativeNumber(data.grand_total)) return 'Grand total must be a non-negative number';

    if (data.discount !== undefined && data.discount !== null && data.discount !== '') {
        if (!isNonNegativeNumber(data.discount)) return 'Discount must be a non-negative number';
    }
    if (data.discount_percent !== undefined && data.discount_percent !== null && data.discount_percent !== '') {
        if (!isNonNegativeNumber(data.discount_percent)) return 'Discount percent must be 0-100';
        if (parseFloat(data.discount_percent) > 100) return 'Discount percent cannot exceed 100';
    }
    if (data.paid_amount !== undefined && data.paid_amount !== null && data.paid_amount !== '') {
        if (!isNonNegativeNumber(data.paid_amount)) return 'Paid amount must be a non-negative number';
    }

    // Enums
    if (data.payment_mode && !isEnum(data.payment_mode, ['cash', 'credit', 'bank', 'upi'])) {
        return 'Payment mode must be cash, credit, bank, or upi';
    }
    if (data.status && !isEnum(data.status, ['paid', 'unpaid', 'partial'])) {
        return 'Status must be paid, unpaid, or partial';
    }

    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null;
}

/**
 * Validate purchase save/update data.
 */
function validatePurchase(data) {
    if (!data || typeof data !== 'object') return 'Purchase data is required';

    if (!isString(data.bill_no, 50)) return 'Bill number is required (max 50 characters)';
    if (!isValidId(data.party_id)) return 'Valid supplier is required';

    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';

    if (!Array.isArray(data.items) || data.items.length === 0) return 'At least one purchase item is required';
    if (!isValidItemArray(data.items, isValidPurchaseItem)) {
        return 'Each purchase item must have a valid product, quantity (> 0), and rate (>= 0)';
    }

    if (!isNonNegativeNumber(data.subtotal)) return 'Subtotal must be a non-negative number';
    if (!isNonNegativeNumber(data.grand_total)) return 'Grand total must be a non-negative number';

    if (data.transport_charges !== undefined && data.transport_charges !== null && data.transport_charges !== '') {
        if (!isNonNegativeNumber(data.transport_charges)) return 'Transport charges must be a non-negative number';
    }
    if (data.extra_charges !== undefined && data.extra_charges !== null && data.extra_charges !== '') {
        if (!isNonNegativeNumber(data.extra_charges)) return 'Extra charges must be a non-negative number';
    }
    if (data.paid_amount !== undefined && data.paid_amount !== null && data.paid_amount !== '') {
        if (!isNonNegativeNumber(data.paid_amount)) return 'Paid amount must be a non-negative number';
    }

    if (data.payment_mode && !isEnum(data.payment_mode, ['cash', 'credit', 'bank', 'upi'])) {
        return 'Payment mode must be cash, credit, bank, or upi';
    }
    if (data.status && !isEnum(data.status, ['paid', 'unpaid', 'partial'])) {
        return 'Status must be paid, unpaid, or partial';
    }

    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null;
}

/**
 * Validate milk collection save/update data.
 */
function validateMilkCollection(data) {
    if (!data || typeof data !== 'object') return 'Milk collection data is required';

    if (!isString(data.collection_no, 50)) return 'Collection number is required (max 50 characters)';
    if (!isValidId(data.party_id)) return 'Valid farmer/party is required';

    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';

    if (!isPositiveNumber(data.quantity_liters)) return 'Quantity must be greater than 0';

    if (data.milk_type && !isEnum(data.milk_type, ['cow', 'buffalo', 'mixed'])) {
        return 'Milk type must be cow, buffalo, or mixed';
    }
    if (data.shift && !isEnum(data.shift, ['morning', 'evening', 'combined'])) {
        return 'Shift must be morning, evening, or combined';
    }
    if (data.status && !isEnum(data.status, ['pending', 'processed', 'paid'])) {
        return 'Status must be pending, processed, or paid';
    }

    if (data.fat_percent !== undefined && data.fat_percent !== null && data.fat_percent !== '') {
        if (!isNonNegativeNumber(data.fat_percent)) return 'Fat % must be a non-negative number';
        if (parseFloat(data.fat_percent) > 100) return 'Fat % cannot exceed 100';
    }
    if (data.snf_percent !== undefined && data.snf_percent !== null && data.snf_percent !== '') {
        if (!isNonNegativeNumber(data.snf_percent)) return 'SNF % must be a non-negative number';
        if (parseFloat(data.snf_percent) > 100) return 'SNF % cannot exceed 100';
    }
    if (data.rate !== undefined && data.rate !== null && data.rate !== '') {
        if (!isNonNegativeNumber(data.rate)) return 'Rate must be a non-negative number';
    }

    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null;
}

/**
 * Validate payment save/update data.
 */
function validatePayment(data) {
    if (!data || typeof data !== 'object') return 'Payment data is required';

    if (!isValidId(data.party_id)) return 'Valid party is required';
    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';
    if (!isPositiveNumber(data.amount)) return 'Payment amount must be greater than 0';

    if (data.type && !isEnum(data.type, ['receipt', 'payment'])) {
        return 'Payment type must be receipt or payment';
    }
    if (data.mode && !isEnum(data.mode, ['cash', 'bank', 'upi', 'cheque'])) {
        return 'Payment mode must be cash, bank, upi, or cheque';
    }

    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null;
}

/**
 * Validate stock adjustment data.
 */
function validateStockAdjust(data) {
    if (!data || typeof data !== 'object') return 'Stock adjustment data is required';

    if (!isValidId(data.product_id)) return 'Valid product is required';
    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';

    if (!isNumber(data.quantity) || parseFloat(data.quantity) === 0) {
        return 'Quantity must be a non-zero number';
    }

    if (data.rate !== undefined && data.rate !== null && data.rate !== '') {
        if (!isNonNegativeNumber(data.rate)) return 'Rate must be a non-negative number';
    }
    if (data.notes && data.notes.length > 500) return 'Notes is too long (max 500 characters)';

    return null;
}

/**
 * Validate bulk payment data.
 */
function validateBulkPayment(data) {
    if (!data || typeof data !== 'object') return 'Bulk payment data is required';

    if (!Array.isArray(data.payments) || data.payments.length === 0) {
        return 'At least one payment is required';
    }

    if (data.date && !isValidDate(data.date)) return 'Invalid date format (YYYY-MM-DD required)';

    if (data.mode && !isEnum(data.mode, ['cash', 'bank', 'upi', 'cheque'])) {
        return 'Payment mode must be cash, bank, upi, or cheque';
    }

    for (let i = 0; i < data.payments.length; i++) {
        const p = data.payments[i];
        if (!isValidId(p.party_id)) return `Payment #${i + 1}: Valid party is required`;
        if (!isPositiveNumber(p.amount)) return `Payment #${i + 1}: Amount must be greater than 0`;
        if (p.collection_ids && (!Array.isArray(p.collection_ids) || p.collection_ids.some(id => !isValidId(id)))) {
            return `Payment #${i + 1}: Invalid collection IDs`;
        }
    }

    return null;
}

/**
 * Validate settings data (accepts key-value pairs).
 */
function validateSettings(data) {
    if (!data || typeof data !== 'object') return 'Settings data is required';
    // Settings are key-value pairs — we just validate that values are strings or numbers
    for (const [key, value] of Object.entries(data)) {
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            return `Setting '${key}' has an invalid value type`;
        }
        if (typeof value === 'string' && value.length > 1000) {
            return `Setting '${key}' value is too long (max 1000 characters)`;
        }
    }
    return null;
}

module.exports = {
    validateParty,
    validateProduct,
    validateSale,
    validatePurchase,
    validateMilkCollection,
    validatePayment,
    validateStockAdjust,
    validateBulkPayment,
    validateSettings,
};
