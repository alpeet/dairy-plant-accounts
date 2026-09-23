/**
 * Milk Standardization Calculator — Calculation engine
 * ============================================================
 * Pure, dependency-free, deterministic mass-balance engine. Usable from the
 * Electron main process, the renderer and Node tests.
 *
 * Every routine works on *percentages by mass* and on *consistent quantity
 * units* (all inputs and outputs use the same unit — L or kg — as selected by
 * the user, because all formulas are ratios).
 *
 * Industry references used:
 *   - Pearson square / mass-balance standardization of fat
 *   - SNF by mass balance across the process
 *   - Richmond's formula for SNF from (corrected) lactometer reading + fat
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.MilkCalc = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ============================================================
    // Calculation modes
    // ============================================================
    var MODES = {
        cream_separation: {
            id: 'cream_separation',
            label: 'Fat Reduction — Cream Separation',
            short: 'Cream Separation',
            group: 'reduction',
            direction: 'remove',
            streamLabel: 'Cream to separate (remove)',
            streamNoun: 'cream',
            streamFatKey: 'creamFat',
            streamSnfKey: 'creamSnf',
            needsCream: true,
            formulaText: 'Wc = W × (F1 − F2) ÷ (Fc − F2)'
        },
        cream_addition: {
            id: 'cream_addition',
            label: 'Fat Increase — Cream Addition',
            short: 'Cream Addition',
            group: 'increase',
            direction: 'add',
            streamLabel: 'Cream to add',
            streamNoun: 'cream',
            streamFatKey: 'creamFat',
            streamSnfKey: 'creamSnf',
            needsCream: true,
            formulaText: 'Wc = W × (F2 − F1) ÷ (Fc − F2)'
        },
        skim_addition: {
            id: 'skim_addition',
            label: 'Fat Reduction — Skim Milk Addition',
            short: 'Skim Milk Addition',
            group: 'reduction',
            direction: 'add',
            streamLabel: 'Skim milk to add',
            streamNoun: 'skim milk',
            streamFatKey: 'skimFat',
            streamSnfKey: 'skimSnf',
            needsSkim: true,
            formulaText: 'Ws = W × (F1 − F2) ÷ (F2 − Fs)'
        },
        water_addition: {
            id: 'water_addition',
            label: 'Fat Reduction — Water Addition',
            short: 'Water Addition',
            group: 'reduction',
            direction: 'add',
            streamLabel: 'Water to add',
            streamNoun: 'water',
            streamFatKey: null,
            streamSnfKey: null,
            dilutionOnly: true,
            formulaText: 'Ww = W × (F1 − F2) ÷ F2'
        }
    };

    var MODE_LIST = Object.keys(MODES).map(function (key) { return MODES[key]; });

    // ============================================================
    // Small numeric helpers
    // ============================================================
    function num(value, fallback) {
        if (value === '' || value === null || value === undefined) return fallback;
        var n = typeof value === 'number' ? value : parseFloat(String(value).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : fallback;
    }

    function round(value, decimals) {
        var d = Number.isFinite(decimals) ? decimals : 2;
        var f = Math.pow(10, d);
        return Math.round((value + Number.EPSILON) * f) / f;
    }

    function fmt(value, decimals) {
        if (!Number.isFinite(value)) return '—';
        return round(value, decimals === undefined ? 2 : decimals).toFixed(decimals === undefined ? 2 : decimals);
    }

    function nearly(a, b) {
        return Math.abs(a - b) < 1e-9;
    }

    // ============================================================
    // Richmond's formula / lactometer helpers
    // ============================================================
    /** SNF% = (CLR / 4) + (0.2 × Fat%) + 0.14  — CLR corrected at 27°C. */
    function snfFromClr(clr, fat) {
        return (clr / 4) + (0.2 * fat) + 0.14;
    }

    /** Inverse of Richmond's formula: CLR = 4 × (SNF − 0.2×Fat − 0.14). */
    function clrFromSnf(snf, fat) {
        return 4 * (snf - (0.2 * fat) - 0.14);
    }

    /** Corrected lactometer reading (e.g. 1.028) → CLR (e.g. 28). */
    function clrFromLactometer(reading) {
        return (reading - 1) * 1000;
    }

    /** CLR → corrected lactometer reading. */
    function lactometerFromClr(clr) {
        return 1 + (clr / 1000);
    }

    // ============================================================
    // Validation
    // ============================================================
    function validate(v, mode, errors) {
        if (!(v.W > 0)) errors.push('Raw milk quantity must be greater than zero.');
        if (!(v.F1 > 0) || v.F1 > 100) errors.push('Initial fat % must be between 0 and 100.');
        if (!(v.F2 > 0) || v.F2 > 100) errors.push('Target fat % must be between 0 and 100.');
        if (!(v.S1 > 0) || v.S1 > 100) {
            errors.push('Initial SNF % must be between 0 and 100. Enter a reading, or switch the SNF input to CLR.');
        }

        if (mode.id === 'cream_separation') {
            if (!(v.F1 > v.F2)) {
                errors.push('Target fat (' + fmt(v.F2) + '%) must be lower than the raw milk fat (' + fmt(v.F1) +
                    '%). To raise fat, use "Cream Addition" instead.');
            }
            if (!(v.Fc > v.F2)) {
                errors.push('Cream fat % (' + fmt(v.Fc) + '%) must be higher than the target fat % (' + fmt(v.F2) +
                    '%). With cream at or below the target, separation cannot reach the target (division by zero / negative).');
            }
            if (v.Fc <= v.F1) {
                errors.push('Cream fat % (' + fmt(v.Fc) + '%) must be higher than the milk fat % (' + fmt(v.F1) +
                    '%). Cream cannot be leaner than the milk it is separated from.');
            }
        }

        if (mode.id === 'cream_addition') {
            if (!(v.F2 > v.F1)) {
                errors.push('Target fat (' + fmt(v.F2) + '%) must be higher than the raw milk fat (' + fmt(v.F1) +
                    '%). For a reduction, use cream separation or skim milk addition.');
            }
            if (!(v.Fc > v.F2)) {
                errors.push('Cream fat % (' + fmt(v.Fc) + '%) must be higher than the target fat % (' + fmt(v.F2) +
                    '%), otherwise no finite amount of cream can raise the fat to the target.');
            }
        }

        if (mode.id === 'skim_addition') {
            if (!(v.F1 > v.F2)) {
                errors.push('Target fat (' + fmt(v.F2) + '%) must be lower than the raw milk fat (' + fmt(v.F1) +
                    '%). Skim milk addition only dilutes fat.');
            }
            if (!(v.F2 > v.Fs)) {
                errors.push('Skim milk fat (' + fmt(v.Fs) + '%) must be lower than the target fat (' + fmt(v.F2) +
                    '%). Otherwise skim milk would raise the fat instead of lowering it.');
            }
        }

        if (mode.id === 'water_addition') {
            if (!(v.F1 > v.F2)) {
                errors.push('Target fat (' + fmt(v.F2) + '%) must be lower than the raw milk fat (' + fmt(v.F1) +
                    '%). Water addition only dilutes fat.');
            }
        }

        if (v.SMP_SNF > 100 || v.SMP_SNF <= 0) {
            errors.push('SMP SNF content must be between 0 and 100.');
        }
        if (v.SMP_FAT < 0 || v.SMP_FAT > 100) {
            errors.push('SMP fat content must be between 0 and 100.');
        }
        if (v.targetSnf !== null && (!(v.targetSnf > 0) || v.targetSnf > 100)) {
            errors.push('Target SNF % must be between 0 and 100 (or leave it blank).');
        }
        if (v.Fc !== undefined && mode.needsCream && (v.creamSnf < 0 || v.creamSnf > 100)) {
            errors.push('Cream SNF % must be between 0 and 100.');
        }
        if (mode.needsSkim && (v.skimSnf < 0 || v.skimSnf > 100)) {
            errors.push('Skim milk SNF % must be between 0 and 100.');
        }
        if (v.targetSnf !== null && v.targetSnf >= v.SMP_SNF) {
            errors.push('Target SNF (' + fmt(v.targetSnf) + '%) must be lower than the SMP SNF content (' +
                fmt(v.SMP_SNF) + '%). Powder richer than the target can never reach it.');
        }
    }

    // ============================================================
    // Main calculation
    // ============================================================
    /**
     * @param {object} input   user inputs (strings or numbers)
     * @param {object} settings app settings (defaults + user overrides)
     * @returns {object} full result object — never throws
     */
    function compute(input, settings) {
        input = input || {};
        settings = settings || {};
        var decimals = Number.isFinite(settings.decimals) ? settings.decimals : 2;
        var errors = [];
        var warnings = [];
        var steps = [];

        var mode = MODES[input.mode] || MODES.cream_separation;
        var unit = input.unit === 'kg' ? 'kg' : 'L';

        // ---- Normalise inputs --------------------------------------
        var W = num(input.quantity, NaN);
        var F1 = num(input.fatInitial, NaN);
        var F2 = num(input.fatTarget, NaN);
        var Fc = num(input.creamFat, NaN);
        var creamSnf = num(input.creamSnf, 2);
        var Fs = num(input.skimFat, NaN);
        var skimSnf = num(input.skimSnf, 9);
        var SMP_SNF = num(input.smpSnf, 96);
        var SMP_FAT = num(input.smpFat, 1);
        var targetSnf = input.snfTarget === '' || input.snfTarget === null || input.snfTarget === undefined
            ? null
            : num(input.snfTarget, null);
        var minFat = num(input.minFat, null);
        var minSnf = num(input.minSnf, null);
        var enforceMinimums = settings.enforceMinimums !== false;

        var snfSource = input.snfSource === 'clr' ? 'clr' : 'direct';
        var clr = num(input.clr, null);
        var S1 = snfSource === 'clr'
            ? (clr === null || !(F1 > 0) ? NaN : snfFromClr(clr, F1))
            : num(input.snfInitial, NaN);

        var v = {
            W: W, F1: F1, F2: F2, S1: S1, Fc: Fc, creamSnf: creamSnf, Fs: Fs, skimSnf: skimSnf,
            SMP_SNF: SMP_SNF, SMP_FAT: SMP_FAT, targetSnf: targetSnf
        };

        // Required composition defaults that may legitimately be 0
        if (mode.needsCream && !Number.isFinite(Fc)) {
            errors.push('Cream fat % is required for ' + mode.short + '.');
        }
        if (mode.needsSkim && !Number.isFinite(Fs)) {
            errors.push('Skim milk fat % is required for ' + mode.short + '.');
        }

        validate(v, mode, errors);
        if (errors.length) {
            return {
                ok: false,
                errors: errors,
                warnings: [],
                steps: [],
                mode: publicMode(mode),
                unit: unit,
                inputs: publicInputs(v, input, snfSource, clr, unit)
            };
        }

        // ---- Step 1: quantity of the adjusting stream ---------------
        var streamQty;
        var streamFat = 0;
        var streamSnf = 0;

        if (mode.id === 'cream_separation') {
            streamQty = W * (F1 - F2) / (Fc - F2);
            if (!(streamQty > 0) || !Number.isFinite(streamQty)) {
                errors.push('The calculated cream quantity is not a usable number — check the fat values.');
            } else if (streamQty >= W) {
                errors.push('The calculation asks for ' + fmt(streamQty, decimals) + ' ' + unit +
                    ' of cream from ' + fmt(W, decimals) + ' ' + unit + ' of milk, which would leave nothing behind. ' +
                    'Check the cream fat % and target fat %.');
            }
            streamFat = Fc;
            streamSnf = creamSnf;
            steps.push({
                label: 'Cream to separate & remove',
                expr: 'Wc = W × (F1 − F2) ÷ (Fc − F2)',
                subs: fmt(W, decimals) + ' × (' + fmt(F1, decimals) + ' − ' + fmt(F2, decimals) + ') ÷ (' +
                    fmt(Fc, decimals) + ' − ' + fmt(F2, decimals) + ')',
                value: fmt(streamQty, decimals) + ' ' + unit
            });
        } else if (mode.id === 'cream_addition') {
            streamQty = W * (F2 - F1) / (Fc - F2);
            streamFat = Fc;
            streamSnf = creamSnf;
            steps.push({
                label: 'Cream to add',
                expr: 'Wc = W × (F2 − F1) ÷ (Fc − F2)',
                subs: fmt(W, decimals) + ' × (' + fmt(F2, decimals) + ' − ' + fmt(F1, decimals) + ') ÷ (' +
                    fmt(Fc, decimals) + ' − ' + fmt(F2, decimals) + ')',
                value: fmt(streamQty, decimals) + ' ' + unit
            });
        } else if (mode.id === 'skim_addition') {
            streamQty = W * (F1 - F2) / (F2 - Fs);
            streamFat = Fs;
            streamSnf = skimSnf;
            steps.push({
                label: 'Skim milk to add',
                expr: 'Ws = W × (F1 − F2) ÷ (F2 − Fs)',
                subs: fmt(W, decimals) + ' × (' + fmt(F1, decimals) + ' − ' + fmt(F2, decimals) + ') ÷ (' +
                    fmt(F2, decimals) + ' − ' + fmt(Fs, decimals) + ')',
                value: fmt(streamQty, decimals) + ' ' + unit
            });
        } else {
            streamQty = W * (F1 - F2) / F2;
            streamFat = 0;
            streamSnf = 0;
            steps.push({
                label: 'Water to add',
                expr: 'Ww = W × (F1 − F2) ÷ F2',
                subs: fmt(W, decimals) + ' × (' + fmt(F1, decimals) + ' − ' + fmt(F2, decimals) + ') ÷ ' +
                    fmt(F2, decimals),
                value: fmt(streamQty, decimals) + ' ' + unit
            });
        }

        if (errors.length) {
            return {
                ok: false,
                errors: errors,
                warnings: [],
                steps: [],
                mode: publicMode(mode),
                unit: unit,
                inputs: publicInputs(v, input, snfSource, clr, unit)
            };
        }

        var removal = mode.direction === 'remove';

        // ---- Step 2: quantities and composition after the main change ----
        var finalQty = removal ? W - streamQty : W + streamQty;
        var fatMassIn = W * F1;
        var fatMassFinal = removal ? fatMassIn - (streamQty * streamFat) : fatMassIn + (streamQty * streamFat);
        var snfMassIn = W * S1;
        var snfMassFinal = removal ? snfMassIn - (streamQty * streamSnf) : snfMassIn + (streamQty * streamSnf);

        var finalFat = fatMassFinal / finalQty;
        var finalSnfAfterMain = snfMassFinal / finalQty;

        steps.push({
            label: removal ? 'Standardized milk remaining' : 'Quantity after addition',
            expr: removal ? 'W_final = W − Wc' : 'W_final = W + Wx',
            subs: removal
                ? fmt(W, decimals) + ' − ' + fmt(streamQty, decimals)
                : fmt(W, decimals) + ' + ' + fmt(streamQty, decimals),
            value: fmt(finalQty, decimals) + ' ' + unit
        });
        steps.push({
            label: 'Fat balance check (must equal the target)',
            expr: 'F_final = (W × F1 ' + (removal ? '−' : '+') + ' Wx × Fx) ÷ W_final',
            subs: '(' + fmt(W, decimals) + ' × ' + fmt(F1, decimals) + ' ' + (removal ? '−' : '+') + ' ' +
                fmt(streamQty, decimals) + ' × ' + fmt(streamFat, decimals) + ') ÷ ' + fmt(finalQty, decimals),
            value: fmt(finalFat, decimals) + ' %'
        });
        steps.push({
            label: 'SNF after ' + (mode.dilutionOnly ? 'dilution' : 'fat adjustment'),
            expr: 'SNF_final = (W × SNF1 ' + (removal ? '−' : '+') + ' Wx × SNFx) ÷ W_final',
            subs: '(' + fmt(W, decimals) + ' × ' + fmt(S1, decimals) + ' ' + (removal ? '−' : '+') + ' ' +
                fmt(streamQty, decimals) + ' × ' + fmt(streamSnf, decimals) + ') ÷ ' + fmt(finalQty, decimals),
            value: fmt(finalSnfAfterMain, decimals) + ' %'
        });

        // ---- Step 3: SNF target & SMP reconstitution --------------------
        var shortfall = targetSnf === null ? 0 : targetSnf - finalSnfAfterMain;
        var needsReconstitution = targetSnf !== null && shortfall > 1e-9;
        var aboveTarget = targetSnf !== null && shortfall < -1e-9;
        var smpMass = 0;
        var postSmpQty = finalQty;
        var postSmpSnf = finalSnfAfterMain;
        var postSmpFat = finalFat;

        if (needsReconstitution) {
            smpMass = finalQty * (targetSnf - finalSnfAfterMain) / (SMP_SNF - targetSnf);
            if (!(smpMass > 0) || !Number.isFinite(smpMass)) {
                errors.push('SMP quantity could not be calculated — check the SMP SNF content and target SNF.');
            } else {
                postSmpQty = finalQty + smpMass;
                postSmpSnf = (finalQty * finalSnfAfterMain + smpMass * SMP_SNF) / postSmpQty;
                postSmpFat = (finalQty * finalFat + smpMass * SMP_FAT) / postSmpQty;
                steps.push({
                    label: 'SMP required to reach target SNF',
                    expr: 'SMP = W_final × (SNF_target − SNF_current) ÷ (SMP_SNF − SNF_target)',
                    subs: fmt(finalQty, decimals) + ' × (' + fmt(targetSnf, decimals) + ' − ' + fmt(finalSnfAfterMain, decimals) +
                        ') ÷ (' + fmt(SMP_SNF, decimals) + ' − ' + fmt(targetSnf, decimals) + ')',
                    value: fmt(smpMass, decimals) + ' ' + unit
                });
                steps.push({
                    label: 'Final quantity after reconstitution',
                    expr: 'W_post = W_final + SMP',
                    subs: fmt(finalQty, decimals) + ' + ' + fmt(smpMass, decimals),
                    value: fmt(postSmpQty, decimals) + ' ' + unit
                });
            }
        }

        if (errors.length) {
            return {
                ok: false,
                errors: errors,
                warnings: [],
                steps: steps,
                mode: publicMode(mode),
                unit: unit,
                inputs: publicInputs(v, input, snfSource, clr, unit)
            };
        }

        // ---- Warnings ---------------------------------------------------
        var checkSnf = needsReconstitution ? postSmpSnf : finalSnfAfterMain;

        if (mode.dilutionOnly) {
            warnings.push({
                level: 'danger',
                title: 'Water addition dilutes SNF',
                text: 'Adding water lowers solids-not-fat in the same proportion as fat. SNF after dilution is ' +
                    fmt(finalSnfAfterMain, decimals) + '%' +
                    (Number.isFinite(minSnf) && minSnf > 0
                        ? ', i.e. ' + fmt(minSnf - finalSnfAfterMain, decimals) + ' points against your configured minimum of ' +
                          fmt(minSnf, decimals) + '%'
                        : '') +
                    '. Adding water to milk for fat adjustment is normally not permitted — confirm your local standard before using this mode.'
            });
            if (needsReconstitution) {
                warnings.push({
                    level: 'warning',
                    title: 'Reconstitution does not make dilution legal',
                    text: 'Adding ' + fmt(smpMass, decimals) + ' ' + unit + ' of SMP restores SNF to the ' +
                        fmt(targetSnf, decimals) + '% target, but the powder was not part of the original milk. ' +
                        'Use this mode for internal process work only unless your regulation allows reconstitution.'
                });
            }
        }

        if (mode.id === 'cream_separation') {
            warnings.push({
                level: 'info',
                title: 'Cream stream composition',
                text: 'The ' + fmt(streamQty, decimals) + ' ' + unit + ' of cream leaving the separator carries ' +
                    fmt(streamQty * streamFat / 100, decimals) + ' ' + unit + ' of fat and ' +
                    fmt(streamQty * streamSnf / 100, decimals) + ' ' + unit + ' of SNF. Standardize your separator to hold cream at ' +
                    fmt(streamFat, decimals) + '% fat, otherwise the remaining milk will not land on target.'
            });
        }

        if (mode.needsSkim) {
            warnings.push({
                level: 'info',
                title: 'Skim milk stream composition',
                text: 'The added skim milk brings ' + fmt(streamQty * skimSnf / 100, decimals) + ' ' + unit +
                    ' of extra SNF, which lifts total solids as well as volume.'
            });
        }

        if (mode.id === 'cream_addition') {
            warnings.push({
                level: 'info',
                title: 'Cream addition adds solids',
                text: 'Added cream brings ' + fmt(streamQty * streamSnf / 100, decimals) + ' ' + unit +
                    ' of SNF and ' + fmt(streamQty * streamFat / 100, decimals) + ' ' + unit + ' of fat with it.'
            });
        }

        if (enforceMinimums && Number.isFinite(minFat) && minFat > 0 && F2 < minFat - 1e-9) {
            warnings.push({
                level: 'danger',
                title: 'Target fat is below the configured minimum',
                text: 'The target fat of ' + fmt(F2, decimals) + '% is already below the ' + fmt(minFat, decimals) +
                    '% minimum configured for ' + (input.milkTypeLabel || 'this milk type') +
                    '. This batch cannot be compliant even if the calculation succeeds.'
            });
        }

        if (enforceMinimums && Number.isFinite(minSnf) && minSnf > 0 && S1 < minSnf - 1e-9) {
            warnings.push({
                level: 'warning',
                title: 'Incoming milk SNF is below the configured minimum',
                text: 'Raw milk SNF of ' + fmt(S1, decimals) + '% is below the ' + fmt(minSnf, decimals) +
                    '% minimum. The shortfall must be made up with SMP or by blending with richer milk.'
            });
        }

        if (enforceMinimums && Number.isFinite(minSnf) && minSnf > 0 && finalSnfAfterMain < minSnf - 1e-9) {
            if (needsReconstitution && postSmpSnf >= minSnf - 1e-9) {
                warnings.push({
                    level: 'info',
                    title: 'SNF shortfall already covered',
                    text: 'SNF drops to ' + fmt(finalSnfAfterMain, decimals) + '% after the fat adjustment and is brought back to ' +
                        fmt(postSmpSnf, decimals) + '% with SMP, clearing the ' + fmt(minSnf, decimals) + '% minimum.'
                });
            } else {
                warnings.push({
                    level: 'danger',
                    title: 'SNF will be below the configured minimum',
                    text: 'Resulting SNF is ' + fmt(finalSnfAfterMain, decimals) + '%, which is ' +
                        fmt(minSnf - finalSnfAfterMain, decimals) + ' points below the ' + fmt(minSnf, decimals) +
                        '% minimum. Add SMP (set a target SNF) or blend with richer milk before releasing this batch.'
                });
            }
        }

        if (aboveTarget) {
            warnings.push({
                level: 'warning',
                title: 'SNF is above the target — no reconstitution needed',
                text: 'SNF after the fat adjustment is ' + fmt(finalSnfAfterMain, decimals) + '%, which is ' +
                    fmt(-shortfall, decimals) + ' points above the ' + fmt(targetSnf, decimals) +
                    '% target. No SMP is required; blend in skim milk or water only if the specification demands the exact target.'
            });
        }

        if (needsReconstitution && Math.abs(postSmpFat - finalFat) >= 0.005) {
            warnings.push({
                level: 'warning',
                title: 'SMP shifts the fat slightly',
                text: 'SMP carries about ' + fmt(SMP_FAT, decimals) + '% fat, so adding ' + fmt(smpMass, decimals) + ' ' + unit +
                    ' moves the fat from ' + fmt(finalFat, decimals) + '% to ' + fmt(postSmpFat, decimals) +
                    '%. Re-run the fat check after reconstitution, or add the SMP first and standardize the fat afterwards.'
            });
        }

        if (mode.id === 'cream_separation' && Math.abs(finalFat - F2) > 0.005) {
            warnings.push({
                level: 'warning',
                title: 'Fat balance check',
                text: 'The mass balance closes at ' + fmt(finalFat, decimals) + '% fat instead of the ' + fmt(F2, decimals) +
                    '% target. Differences this small come from rounding of the entered values.'
            });
        }

        // ---- Compliance --------------------------------------------------
        var checks = [];
        var fatPass = !(enforceMinimums && Number.isFinite(minFat) && minFat > 0) || finalFat >= minFat - 1e-9;
        var snfPass = !(enforceMinimums && Number.isFinite(minSnf) && minSnf > 0) || checkSnf >= minSnf - 1e-9;
        checks.push({
            name: 'Fat %',
            value: finalFat,
            min: Number.isFinite(minFat) ? minFat : null,
            pass: fatPass,
            note: 'standardized milk'
        });
        checks.push({
            name: 'SNF %',
            value: checkSnf,
            min: Number.isFinite(minSnf) ? minSnf : null,
            pass: snfPass,
            note: needsReconstitution ? 'after SMP reconstitution' : 'after fat adjustment'
        });

        var allPass = checks.every(function (c) { return c.pass; });

        return {
            ok: true,
            errors: [],
            warnings: warnings,
            steps: steps,
            mode: publicMode(mode),
            unit: unit,
            milkType: input.milkType || null,
            milkTypeLabel: input.milkTypeLabel || null,
            inputs: publicInputs(v, input, snfSource, clr, unit),
            main: {
                streamLabel: mode.streamLabel,
                streamNoun: mode.streamNoun,
                streamQty: streamQty,
                streamFat: streamFat,
                streamSnf: streamSnf,
                removal: removal,
                actionText: (removal ? 'Remove ' : 'Add ') + fmt(streamQty, decimals) + ' ' + unit + ' of ' +
                    mode.streamNoun + (streamFat ? ' at ' + fmt(streamFat, decimals) + '% fat' : ''),
                finalQty: finalQty,
                finalFat: finalFat,
                finalSnf: finalSnfAfterMain,
                yieldPct: finalQty / W * 100,
                fatMassIn: fatMassIn,
                fatMassFinal: fatMassFinal,
                snfMassIn: snfMassIn,
                snfMassFinal: snfMassFinal,
                fatBalanceResidual: finalFat - F2
            },
            snf: {
                initial: S1,
                afterMain: finalSnfAfterMain,
                target: targetSnf,
                shortfall: targetSnf === null ? 0 : Math.max(0, shortfall),
                surplus: targetSnf === null ? 0 : Math.max(0, -shortfall),
                needsReconstitution: needsReconstitution,
                aboveTarget: aboveTarget,
                smpMass: smpMass,
                smpSnfContent: SMP_SNF,
                smpFatContent: SMP_FAT,
                postSmpQty: postSmpQty,
                postSmpSnf: postSmpSnf,
                postSmpFat: postSmpFat
            },
            compliance: {
                enforced: enforceMinimums,
                minFat: Number.isFinite(minFat) ? minFat : null,
                minSnf: Number.isFinite(minSnf) ? minSnf : null,
                checks: checks,
                pass: allPass
            },
            summary: buildSummary({
                mode: mode, unit: unit, W: W, F1: F1, F2: F2, S1: S1, streamQty: streamQty,
                finalQty: finalQty, finalFat: finalFat, finalSnf: finalSnfAfterMain,
                needsReconstitution: needsReconstitution, smpMass: smpMass, postSmpQty: postSmpQty,
                postSmpSnf: postSmpSnf, decimals: decimals
            })
        };
    }

    function publicMode(mode) {
        return {
            id: mode.id,
            label: mode.label,
            short: mode.short,
            group: mode.group,
            direction: mode.direction,
            streamLabel: mode.streamLabel,
            removal: mode.direction === 'remove',
            dilutionOnly: !!mode.dilutionOnly,
            formulaText: mode.formulaText
        };
    }

    function publicInputs(v, input, snfSource, clr, unit) {
        return {
            quantity: v.W,
            unit: unit,
            fatInitial: v.F1,
            fatTarget: v.F2,
            snfInitial: v.S1,
            snfSource: snfSource,
            clr: clr,
            snfTarget: v.targetSnf,
            creamFat: v.Fc,
            creamSnf: v.creamSnf,
            skimFat: v.Fs,
            skimSnf: v.skimSnf,
            smpSnf: v.SMP_SNF,
            smpFat: v.SMP_FAT
        };
    }

    /** One-line human summary used by history rows and report headers. */
    function buildSummary(d) {
        var parts = [];
        parts.push(fmt(d.W, d.decimals) + ' ' + d.unit + ' @ ' + fmt(d.F1, d.decimals) + '% fat / ' +
            fmt(d.S1, d.decimals) + '% SNF');
        if (d.mode.direction === 'remove') {
            parts.push('remove ' + fmt(d.streamQty, d.decimals) + ' ' + d.unit + ' ' + d.mode.streamLabel.toLowerCase());
        } else {
            parts.push('add ' + fmt(d.streamQty, d.decimals) + ' ' + d.unit + ' ' + d.mode.streamLabel.toLowerCase());
        }
        parts.push('→ ' + fmt(d.finalQty, d.decimals) + ' ' + d.unit + ' @ ' + fmt(d.finalFat, d.decimals) +
            '% fat / ' + fmt(d.finalSnf, d.decimals) + '% SNF');
        if (d.needsReconstitution) {
            parts.push('+ ' + fmt(d.smpMass, d.decimals) + ' ' + d.unit + ' SMP → ' + fmt(d.postSmpQty, d.decimals) +
                ' ' + d.unit + ' @ ' + fmt(d.postSmpSnf, d.decimals) + '% SNF');
        }
        return parts.join(' ');
    }

    return {
        MODES: MODES,
        MODE_LIST: MODE_LIST,
        compute: compute,
        snfFromClr: snfFromClr,
        clrFromSnf: clrFromSnf,
        clrFromLactometer: clrFromLactometer,
        lactometerFromClr: lactometerFromClr,
        round: round,
        fmt: fmt,
        num: num,
        nearly: nearly
    };
});
