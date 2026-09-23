/**
 * Milk Standardization Calculator — Default settings
 * ============================================================
 * Every number below is a *starting value* the user can change in Settings.
 * Nothing here is treated as a legal standard: minimum fat/SNF limits differ
 * from country to country and must be confirmed locally.
 *
 * Works in Node (require) and in the browser (window.MilkDefaults).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MilkDefaults = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    var MILK_TYPES = [
        { id: 'cow', label: 'Cow milk' },
        { id: 'buffalo', label: 'Buffalo milk' },
        { id: 'mixed', label: 'Mixed milk' }
    ];

    var UNITS = [
        { id: 'L', label: 'Litres (L)' },
        { id: 'kg', label: 'Kilograms (kg)' }
    ];

    var DEFAULT_SETTINGS = {
        // --- Plant / report identity -------------------------------------
        plantName: '',
        plantAddress: '',
        plantPhone: '',
        plantLicense: '',
        operator: '',
        reportNote: '',

        // --- Behaviour ---------------------------------------------------
        defaultUnit: 'L',
        defaultMilkType: 'cow',
        decimals: 2,
        historyLimit: 500,
        enforceMinimums: true,

        // --- Composition defaults (all editable per calculation too) -----
        creamFat: 40,
        creamSnf: 2,
        skimFat: 0.05,
        skimSnf: 9,
        smpSnf: 96,
        smpFat: 1,

        // --- Regulatory minimums (PLACEHOLDERS — verify locally) ---------
        minFat: { cow: 3.5, buffalo: 6.0, mixed: 4.0 },
        minSnf: { cow: 8.5, buffalo: 9.0, mixed: 8.5 }
    };

    function clone(value) {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }

    function isPlainObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    /** Deep-merge a patch onto a base object (base is not mutated). */
    function merge(base) {
        var out = clone(base) || {};
        for (var i = 1; i < arguments.length; i++) {
            var patch = arguments[i];
            if (!isPlainObject(patch)) continue;
            Object.keys(patch).forEach(function (key) {
                var next = patch[key];
                if (isPlainObject(next) && isPlainObject(out[key])) {
                    out[key] = merge(out[key], next);
                } else if (next !== undefined) {
                    out[key] = isPlainObject(next) || Array.isArray(next) ? clone(next) : next;
                }
            });
        }
        return out;
    }

    function defaults() {
        return clone(DEFAULT_SETTINGS);
    }

    /** Normalise anything that came off disk / localStorage into a valid settings object. */
    function normaliseSettings(raw) {
        var s = merge(DEFAULT_SETTINGS, isPlainObject(raw) ? raw : {});
        s.decimals = Math.min(4, Math.max(0, toNumber(s.decimals, 2)));
        s.historyLimit = Math.min(20000, Math.max(10, toNumber(s.historyLimit, 500)));
        s.defaultUnit = s.defaultUnit === 'kg' ? 'kg' : 'L';
        if (!MILK_TYPES.some(function (t) { return t.id === s.defaultMilkType; })) {
            s.defaultMilkType = 'cow';
        }
        return s;
    }

    function toNumber(value, fallback) {
        var n = typeof value === 'number' ? value : parseFloat(String(value == null ? '' : value).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : fallback;
    }

    return {
        MILK_TYPES: MILK_TYPES,
        UNITS: UNITS,
        DEFAULT_SETTINGS: DEFAULT_SETTINGS,
        defaults: defaults,
        clone: clone,
        merge: merge,
        normaliseSettings: normaliseSettings,
        toNumber: toNumber
    };
});
