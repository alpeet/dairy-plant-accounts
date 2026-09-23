/**
 * Milk Standardization Calculator — test suite
 *   run with:  npm test        (node --test tests)
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Calc = require('../shared/calc');
const Defaults = require('../shared/defaults');
const StoreLib = require('../shared/store');

const settings = Defaults.defaults();

function close(actual, expected, tolerance = 1e-6, message) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        (message || 'value mismatch') + ': expected ' + expected + ' ± ' + tolerance + ', got ' + actual);
}

function baseInput(overrides) {
    return Object.assign({
        mode: 'cream_separation',
        milkType: 'cow',
        milkTypeLabel: 'Cow milk',
        unit: 'L',
        quantity: 480,
        fatInitial: 5.5,
        snfSource: 'direct',
        snfInitial: 8.6,
        fatTarget: 3.5,
        snfTarget: '',
        creamFat: 40,
        creamSnf: 2,
        skimFat: 0.05,
        skimSnf: 9,
        smpSnf: 96,
        smpFat: 1,
        minFat: 3.5,
        minSnf: 8.5
    }, overrides || {});
}

// ============================================================
// Spec example — the headline use case
// ============================================================
test('480 L at 5.5% fat → 3.5% by cream separation (spec example)', () => {
    const res = Calc.compute(baseInput(), settings);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    close(res.main.streamQty, 480 * (5.5 - 3.5) / (40 - 3.5), 1e-9, 'cream to remove');
    close(res.main.streamQty, 26.3013698630137, 1e-9, 'cream to remove (exact)');
    close(res.main.finalQty, 480 - 26.3013698630137, 1e-9, 'standardized milk');
    close(res.main.finalFat, 3.5, 1e-9, 'final fat');
    assert.equal(res.main.removal, true);
    assert.equal(res.mode.id, 'cream_separation');
});

test('mass balance closes on the target fat for every mode', () => {
    const cases = [
        { mode: 'cream_separation', fatInitial: 5.5, fatTarget: 3.5 },
        { mode: 'cream_addition', fatInitial: 3.5, fatTarget: 5.5 },
        { mode: 'skim_addition', fatInitial: 6.5, fatTarget: 4.5 },
        { mode: 'water_addition', fatInitial: 5.5, fatTarget: 4.0 }
    ];
    cases.forEach((entry) => {
        const res = Calc.compute(baseInput(entry), settings);
        assert.equal(res.ok, true, entry.mode + ': ' + JSON.stringify(res.errors));
        close(res.main.finalFat, entry.fatTarget, 1e-9, entry.mode + ' final fat');
        const expectedQty = res.main.removal
            ? 480 - res.main.streamQty
            : 480 + res.main.streamQty;
        close(res.main.finalQty, expectedQty, 1e-9, entry.mode + ' final quantity');
    });
});

test('cream addition uses W × (F2 − F1) ÷ (Fc − F2)', () => {
    const res = Calc.compute(baseInput({ mode: 'cream_addition', fatInitial: 3.5, fatTarget: 5.5 }), settings);
    close(res.main.streamQty, 480 * 2 / 34.5, 1e-9);
    close(res.main.streamQty, 27.8260869565217, 1e-9);
    close(res.main.finalQty, 480 + 27.8260869565217, 1e-9);
});

test('skim milk addition uses W × (F1 − F2) ÷ (F2 − Fs)', () => {
    const res = Calc.compute(baseInput({ mode: 'skim_addition' }), settings);
    close(res.main.streamQty, 480 * 2 / 3.45, 1e-9);
    close(res.main.finalQty, 480 + res.main.streamQty, 1e-9);
    close(res.main.finalFat, 3.5, 1e-9);
});

test('water addition uses W × (F1 − F2) ÷ F2', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition' }), settings);
    close(res.main.streamQty, 480 * 2 / 3.5, 1e-9);
    close(res.main.streamQty, 274.2857142857143, 1e-9);
});

// ============================================================
// SNF tracking
// ============================================================
test('SNF after separation follows mass balance with cream leaving solids', () => {
    const res = Calc.compute(baseInput(), settings);
    const expected = (480 * 8.6 - res.main.streamQty * 2) / res.main.finalQty;
    close(res.snf.afterMain, expected, 1e-9);
    assert.ok(res.snf.afterMain > 8.6, 'SNF concentrates when cream is removed');
});

test('SNF after water dilution follows mass balance', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition' }), settings);
    close(res.snf.afterMain, (480 * 8.6) / res.main.finalQty, 1e-9);
    assert.ok(res.snf.afterMain < 8.6);
});

test('SMP reconstitution reaches the target SNF exactly', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition', snfTarget: 9.0 }), settings);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    assert.equal(res.snf.needsReconstitution, true);
    const expectedSmp = res.main.finalQty * (9.0 - res.snf.afterMain) / (96 - 9.0);
    close(res.snf.smpMass, expectedSmp, 1e-9);
    close(res.snf.postSmpSnf, 9.0, 1e-9, 'post-SMP SNF');
    close(res.snf.postSmpQty, res.main.finalQty + res.snf.smpMass, 1e-9);
    const expectedFat = (res.main.finalQty * res.main.finalFat + res.snf.smpMass * 1) / res.snf.postSmpQty;
    close(res.snf.postSmpFat, expectedFat, 1e-9);
    assert.ok(res.snf.postSmpFat < res.main.finalFat, 'SMP slightly dilutes fat');
});

test('no reconstitution is planned when SNF already meets the target', () => {
    const res = Calc.compute(baseInput({ snfTarget: 8.0 }), settings);
    assert.equal(res.ok, true);
    assert.equal(res.snf.needsReconstitution, false);
    assert.equal(res.snf.smpMass, 0);
    assert.ok(res.snf.surplus > 0);
    assert.ok(res.warnings.some((w) => /above the target/i.test(w.title)));
});

test('CLR input path feeds Richmond\'s formula', () => {
    const res = Calc.compute(baseInput({ snfSource: 'clr', clr: 28, snfInitial: '' }), settings);
    assert.equal(res.ok, true, JSON.stringify(res.errors));
    close(res.snf.initial, Calc.snfFromClr(28, 5.5), 1e-9);
    close(res.snf.initial, 8.24, 1e-9);
});

test('Richmond\'s formula and its inverse agree', () => {
    close(Calc.snfFromClr(28, 5.5), 8.24, 1e-9);
    close(Calc.clrFromSnf(8.24, 5.5), 28, 1e-9);
    close(Calc.clrFromLactometer(1.028), 28, 1e-9);
    close(Calc.lactometerFromClr(28), 1.028, 1e-9);
});

// ============================================================
// Validation
// ============================================================
test('impossible separation inputs raise clear errors instead of crashing', () => {
    const cases = [
        [{ fatTarget: 6.0 }, /must be lower than the raw milk fat/i],
        [{ creamFat: 3.0 }, /must be higher than the target fat/i],
        [{ creamFat: 5.0, fatTarget: 3.5 }, /higher than the milk fat/i],
        [{ quantity: 0 }, /quantity must be greater than zero/i],
        [{ fatTarget: '' }, /Target fat % must be between 0 and 100/i],
        [{ smpSnf: 50, snfTarget: 60 }, /must be lower than the SMP SNF content/i]
    ];
    cases.forEach(([patch, pattern]) => {
        const res = Calc.compute(baseInput(patch), settings);
        assert.equal(res.ok, false, 'expected failure for ' + JSON.stringify(patch));
        assert.ok(res.errors.some((error) => pattern.test(error)),
            'expected an error matching ' + pattern + ' for ' + JSON.stringify(patch) + ', got ' + JSON.stringify(res.errors));
    });
});

test('cross-mode mistakes are caught with mode-specific guidance', () => {
    const up = Calc.compute(baseInput({ mode: 'cream_addition', fatInitial: 5.5, fatTarget: 3.5 }), settings);
    assert.equal(up.ok, false);
    assert.ok(up.errors.some((e) => /must be higher than the raw milk fat/i.test(e)));

    const skim = Calc.compute(baseInput({ mode: 'skim_addition', skimFat: 4.0, fatTarget: 3.5 }), settings);
    assert.equal(skim.ok, false);
    assert.ok(skim.errors.some((e) => /must be lower than the target fat/i.test(e)));

    const waterUp = Calc.compute(baseInput({ mode: 'water_addition', fatTarget: 6.5 }), settings);
    assert.equal(waterUp.ok, false);
    assert.ok(waterUp.errors.some((e) => /only dilutes fat/i.test(e)));
});

test('a valid separation can never remove more cream than milk exists', () => {
    // Because Fc must be richer than F1, Wc/W = (F1-F2)/(Fc-F2) is always < 1.
    const samples = [
        { fatInitial: 5.5, fatTarget: 0.5, creamFat: 6.5 },
        { fatInitial: 8.0, fatTarget: 0.2, creamFat: 8.5 },
        { fatInitial: 4.0, fatTarget: 0.1, creamFat: 60 }
    ];
    samples.forEach((patch) => {
        const res = Calc.compute(baseInput(patch), settings);
        assert.equal(res.ok, true, JSON.stringify(res.errors));
        assert.ok(res.main.streamQty > 0 && res.main.streamQty < 480, 'cream inside (0, W)');
        assert.ok(res.main.finalQty > 0);
    });
});

test('compute never throws on garbage input', () => {
    const junk = [
        {}, null, undefined,
        { quantity: 'abc', fatInitial: 'x', fatTarget: '' },
        { mode: 'nonsense', quantity: -5, creamFat: 'NaN' },
        { quantity: Infinity, fatInitial: 1e309, fatTarget: -1 },
        { snfSource: 'clr', clr: 'oops', fatInitial: 5.5 }
    ];
    junk.forEach((input) => {
        assert.doesNotThrow(() => {
            const res = Calc.compute(input, settings);
            assert.equal(typeof res.ok, 'boolean');
            assert.ok(Array.isArray(res.errors));
        }, 'threw for ' + JSON.stringify(input));
    });
});

// ============================================================
// Warnings and compliance
// ============================================================
test('mode-specific warnings only appear in their own mode', () => {
    const separation = Calc.compute(baseInput(), settings);
    assert.ok(separation.warnings.some((w) => /cream stream composition/i.test(w.title)));
    assert.equal(separation.warnings.some((w) => /cream addition adds solids/i.test(w.title)), false,
        'separation must not report an addition warning');

    const addition = Calc.compute(baseInput({ mode: 'cream_addition', fatInitial: 3.5, fatTarget: 5.5 }), settings);
    assert.ok(addition.warnings.some((w) => /cream addition adds solids/i.test(w.title)));
    assert.equal(addition.warnings.some((w) => /cream stream composition/i.test(w.title)), false);

    const skim = Calc.compute(baseInput({ mode: 'skim_addition' }), settings);
    assert.ok(skim.warnings.some((w) => /skim milk stream composition/i.test(w.title)));
    assert.equal(skim.warnings.some((w) => /cream/i.test(w.title)), false);
});

test('water addition always carries an explicit SNF dilution warning', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition' }), settings);
    const danger = res.warnings.filter((w) => w.level === 'danger');
    assert.ok(danger.length >= 1, 'expected a danger-level warning');
    assert.ok(danger.some((w) => /dilutes SNF/i.test(w.title)));
});

test('results below the configured minimum fail the compliance check', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition', minSnf: 8.5 }), settings);
    const snfCheck = res.compliance.checks.find((c) => c.name === 'SNF %');
    assert.equal(snfCheck.pass, false);
    assert.equal(res.compliance.pass, false);

    const good = Calc.compute(baseInput({ minFat: 3.5, minSnf: 2.0 }), settings);
    assert.equal(good.compliance.pass, true);
});

test('a target fat below the configured minimum is flagged up front', () => {
    const res = Calc.compute(baseInput({ fatTarget: 2.5, minFat: 3.5 }), settings);
    assert.ok(res.warnings.some((w) => /below the configured minimum/i.test(w.title)));
});

test('minimum checks can be switched off', () => {
    const res = Calc.compute(baseInput({ mode: 'water_addition' }),
        Object.assign({}, settings, { enforceMinimums: false }));
    assert.equal(res.compliance.enforced, false);
    assert.equal(res.compliance.checks.every((c) => c.pass), true);
});

// ============================================================
// Working steps
// ============================================================
test('every successful calculation exposes auditable working steps', () => {
    const res = Calc.compute(baseInput(), settings);
    assert.ok(res.steps.length >= 4);
    res.steps.forEach((step) => {
        assert.ok(step.label && step.expr && step.value);
    });
    assert.match(res.steps[0].expr, /Wc = W × \(F1 − F2\) ÷ \(Fc − F2\)/);
});

// ============================================================
// Store
// ============================================================
test('store keeps settings, enforces the history limit and survives reload', () => {
    const adapter = StoreLib.memoryAdapter();
    const store = StoreLib.createStore(adapter);

    assert.equal(store.getSettings().creamFat, 40);
    store.saveSettings({ creamFat: 42, minSnf: { cow: 8.8 } });
    assert.equal(store.getSettings().creamFat, 42);
    assert.equal(store.getSettings().minSnf.cow, 8.8);
    assert.equal(store.getSettings().minSnf.buffalo, 9.0, 'untouched nested keys survive a merge');

    store.saveSettings({ historyLimit: 10 });
    for (let i = 0; i < 15; i++) store.addHistory({ batchRef: 'b' + i });
    const history = store.listHistory();
    assert.equal(history.length, 10);
    assert.equal(history[0].batchRef, 'b14', 'newest first');
    assert.ok(history[0].id && history[0].createdAt);

    const reloaded = StoreLib.createStore(adapter);
    assert.equal(reloaded.listHistory().length, 10);
    assert.equal(reloaded.getSettings().creamFat, 42);

    assert.equal(reloaded.deleteHistory(history[0].id), true);
    assert.equal(reloaded.listHistory().length, 9);
    reloaded.clearHistory();
    assert.equal(reloaded.listHistory().length, 0);
});

test('store export / import round-trips a backup', () => {
    const store = StoreLib.createStore(StoreLib.memoryAdapter());
    store.saveSettings({ plantName: 'Test Dairy' });
    store.addHistory({ batchRef: 'A-1' });
    const backup = store.exportState();

    const target = StoreLib.createStore(StoreLib.memoryAdapter());
    target.importState(backup, {});
    assert.equal(target.getSettings().plantName, 'Test Dairy');
    assert.equal(target.listHistory().length, 1);
    assert.equal(target.listHistory()[0].batchRef, 'A-1');
});

// ============================================================
// Defaults hygiene
// ============================================================
test('defaults are usable and normalisation repairs junk', () => {
    const d = Defaults.defaults();
    assert.ok(d.minFat && d.minSnf && typeof d.minFat.cow === 'number');

    const repaired = Defaults.normaliseSettings({
        decimals: 99, historyLimit: -4, defaultUnit: 'gallons', defaultMilkType: 'unicorn', minFat: { cow: 4 }
    });
    assert.equal(repaired.decimals, 4);
    assert.equal(repaired.historyLimit, 10);
    assert.equal(repaired.defaultUnit, 'L');
    assert.equal(repaired.defaultMilkType, 'cow');
    assert.equal(repaired.minFat.cow, 4);
    assert.equal(repaired.minFat.buffalo, d.minFat.buffalo);
});
