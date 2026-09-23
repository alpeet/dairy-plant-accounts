/**
 * Milk Standardization Calculator — Standardize view
 * ============================================================
 * Reads the form, runs the shared engine on every change, renders the result
 * panel and saves batches to history.
 */
(function () {
    'use strict';

    var U = window.MilkUI;
    var Calc = window.MilkCalc;
    var Report = window.MilkReport;
    var Defaults = window.MilkDefaults;

    var settings = Defaults.defaults();
    var result = null;
    var lastSavedId = null;

    var FIELDS = ['milkType', 'quantity', 'unit', 'fatInitial', 'snfSource', 'snfInitial', 'clr', 'lactometer',
        'fatTarget', 'snfTarget', 'creamFat', 'creamSnf', 'skimFat', 'skimSnf', 'smpSnf', 'smpFat',
        'batchRef', 'supplier', 'operator', 'notes'];

    var MODE_HINTS = {
        cream_separation: 'Separate and draw off cream to bring fat down.',
        cream_addition: 'Blend richer cream in to bring fat up.',
        skim_addition: 'Blend skim milk in — fat falls, volume and SNF rise.',
        water_addition: 'Dilute with water — fat falls, SNF falls too.'
    };

    var QUICK_TARGETS = [3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 6.5];

    // ============================================================
    // Build static parts
    // ============================================================
    function buildMilkTypes() {
        var select = U.$('milkType');
        select.innerHTML = Defaults.MILK_TYPES.map(function (type) {
            return '<option value="' + type.id + '">' + U.esc(type.label) + '</option>';
        }).join('');

        var filter = U.$('histMilkType');
        if (filter) {
            filter.innerHTML = '<option value="">All milk types</option>' + Defaults.MILK_TYPES.map(function (type) {
                return '<option value="' + type.id + '">' + U.esc(type.label) + '</option>';
            }).join('');
        }

        var settingsSelect = U.$('setDefaultMilkType');
        if (settingsSelect) {
            settingsSelect.innerHTML = Defaults.MILK_TYPES.map(function (type) {
                return '<option value="' + type.id + '">' + U.esc(type.label) + '</option>';
            }).join('');
        }
    }

    function buildModes() {
        U.$('modeGrid').innerHTML = Calc.MODE_LIST.map(function (mode) {
            return '<label class="mode-card" data-mode="' + mode.id + '">' +
                '<input type="radio" name="mode" value="' + mode.id + '">' +
                '<span><strong>' + U.esc(mode.label) + '</strong>' +
                '<small>' + U.esc(MODE_HINTS[mode.id] || '') + '</small></span>' +
                '</label>';
        }).join('');

        U.$('modeGrid').addEventListener('change', function (event) {
            if (event.target.name === 'mode') recalc();
        });

        var modeFilter = U.$('histMode');
        if (modeFilter) {
            modeFilter.innerHTML = '<option value="">All modes</option>' + Calc.MODE_LIST.map(function (mode) {
                return '<option value="' + mode.id + '">' + U.esc(mode.short) + '</option>';
            }).join('');
        }
    }

    function buildQuickTargets() {
        var host = U.$('quickFatTargets');
        host.innerHTML = QUICK_TARGETS.map(function (value) {
            return '<button type="button" data-target="' + value + '">' + value.toFixed(1) + '%</button>';
        }).join('') + '<button type="button" data-target="minimum">Milk-type minimum</button>';

        host.addEventListener('click', function (event) {
            var button = event.target.closest('button[data-target]');
            if (!button) return;
            var value = button.dataset.target;
            if (value === 'minimum') {
                var minFat = minimums().minFat;
                if (!Number.isFinite(minFat) || minFat <= 0) {
                    U.toast('Set a minimum fat % for this milk type in Settings first.', 'warn');
                    return;
                }
                U.$('fatTarget').value = minFat;
            } else {
                U.$('fatTarget').value = value;
            }
            recalc();
        });
    }

    // ============================================================
    // Settings-derived helpers
    // ============================================================
    function currentMilkType() {
        return U.$('milkType').value || settings.defaultMilkType;
    }

    function minimums() {
        var type = currentMilkType();
        return {
            minFat: U.num(settings.minFat && settings.minFat[type], 0),
            minSnf: U.num(settings.minSnf && settings.minSnf[type], 0),
            label: (Defaults.MILK_TYPES.find(function (t) { return t.id === type; }) || {}).label || type
        };
    }

    function activeMode() {
        var checked = document.querySelector('input[name="mode"]:checked');
        return checked ? checked.value : 'cream_separation';
    }

    // ============================================================
    // Read the form
    // ============================================================
    function readInput() {
        var mins = minimums();
        var snfSource = U.$('snfSource').value;
        var clr = U.$('clr').value;
        var lactometer = U.$('lactometer').value;

        if (snfSource === 'clr' && (clr === '' || clr === null) && lactometer !== '') {
            clr = Calc.clrFromLactometer(U.num(lactometer, NaN));
        }

        return {
            mode: activeMode(),
            milkType: currentMilkType(),
            milkTypeLabel: mins.label,
            unit: U.$('unit').value,
            quantity: U.$('quantity').value,
            fatInitial: U.$('fatInitial').value,
            snfSource: snfSource,
            snfInitial: U.$('snfInitial').value,
            clr: clr,
            fatTarget: U.$('fatTarget').value,
            snfTarget: U.$('snfTarget').value,
            creamFat: U.$('creamFat').value,
            creamSnf: U.$('creamSnf').value,
            skimFat: U.$('skimFat').value,
            skimSnf: U.$('skimSnf').value,
            smpSnf: U.$('smpSnf').value,
            smpFat: U.$('smpFat').value,
            minFat: mins.minFat,
            minSnf: mins.minSnf
        };
    }

    // ============================================================
    // Conditional blocks
    // ============================================================
    function syncVisibility() {
        var mode = activeMode();
        var source = U.$('snfSource').value;
        var modeMeta = Calc.MODES[mode] || Calc.MODES.cream_separation;

        U.$('directSnfBlock').classList.toggle('hidden', source !== 'direct');
        U.$('clrBlock').classList.toggle('hidden', source !== 'clr');

        U.$('creamParams').classList.toggle('hidden', !modeMeta.needsCream);
        U.$('skimParams').classList.toggle('hidden', !modeMeta.needsSkim);
        U.$('waterParamHint').style.display = modeMeta.dilutionOnly ? '' : 'none';

        document.querySelectorAll('.mode-card').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.mode === mode);
        });

        U.$('qtyUnitHint').textContent = '(' + U.$('unit').value + ')';

        // CLR live preview
        if (source === 'clr') {
            var fat = U.num(U.$('fatInitial').value, NaN);
            var clrInput = U.$('clr').value;
            if (clrInput === '' && U.$('lactometer').value !== '') {
                clrInput = Calc.clrFromLactometer(U.num(U.$('lactometer').value, NaN));
            }
            var clr = U.num(clrInput, NaN);
            U.$('clrSnfOut').textContent = (Number.isFinite(clr) && Number.isFinite(fat))
                ? U.fmt(Calc.snfFromClr(clr, fat), settings.decimals) + ' %'
                : '—';
        }
    }

    function markInvalidFields() {
        var input = readInput();
        var checks = {
            quantity: U.num(input.quantity, NaN) > 0,
            fatInitial: U.num(input.fatInitial, NaN) > 0,
            fatTarget: U.num(input.fatTarget, NaN) > 0
        };
        if (input.snfSource === 'direct') checks.snfInitial = U.num(input.snfInitial, NaN) > 0;
        else checks.clr = U.num(input.clr, NaN) > 0;

        Object.keys(checks).forEach(function (id) {
            var el = U.$(id);
            if (!el) return;
            var empty = String(el.value).trim() === '';
            el.classList.toggle('invalid', !empty && !checks[id]);
        });
    }

    // ============================================================
    // Render result
    // ============================================================
    function render(res) {
        result = res;
        var d = settings.decimals;
        var unit = res.unit || 'L';

        var modeText = res.mode ? res.mode.label : '—';
        U.$('resultMode').textContent = modeText;

        var badges = [];
        if (res.ok) {
            var danger = res.warnings.filter(function (w) { return w.level === 'danger'; });
            if (danger.length) badges.push('<span class="badge badge-warn">Action required</span>');
            badges.push(res.compliance.enforced === false
                ? '<span class="badge badge-neutral">Minimums not checked</span>'
                : (res.compliance.pass
                    ? '<span class="badge badge-pass">Compliant</span>'
                    : '<span class="badge badge-fail">Below minimum</span>'));
            if (res.snf.needsReconstitution) badges.push('<span class="badge badge-info">SMP reconstitution</span>');
            if (res.mode.dilutionOnly) badges.push('<span class="badge badge-fail">Dilution mode</span>');
        }
        U.$('resultBadges').innerHTML = badges.join('');

        if (!res.ok) {
            if (isPristine()) {
                U.$('resultTitle').textContent = 'Enter milk details to calculate';
                U.$('resultBody').innerHTML =
                    '<div class="empty-state">' +
                    '<p><b>Fill in the raw milk quantity, its fat % and the fat % you want to reach.</b></p>' +
                    '<p>Every input recalculates instantly: you get the exact cream / skim milk / water quantity to ' +
                    'add or remove, the final volume, and the resulting fat &amp; SNF against your configured minimums.</p>' +
                    '<p>New here? Press <b>Load example</b> below to see the classic case — ' +
                    '480 L of 5.5% fat milk brought down to 3.5% by cream separation.</p>' +
                    '</div>';
                setActionButtons(false);
                return;
            }
            U.$('resultTitle').textContent = 'Cannot calculate yet';
            U.$('resultBody').innerHTML =
                '<div class="error-box"><strong>Fix these inputs:</strong><ul>' +
                res.errors.map(function (error) { return '<li>' + U.esc(error) + '</li>'; }).join('') +
                '</ul></div>';
            setActionButtons(false);
            return;
        }

        var main = res.main;
        var snf = res.snf;
        var hasDanger = res.warnings.some(function (w) { return w.level === 'danger'; });

        U.$('resultTitle').textContent = main.actionText;

        var html = [];

        // ---- primary action card
        html.push('<div class="primary-card' + (hasDanger ? ' warn' : '') + '">');
        html.push('<div class="label">' + U.esc(main.streamLabel) + '</div>');
        html.push('<div class="value">' + U.esc(U.fmtGrouped(main.streamQty, d)) + '<small>' + U.esc(unit) + '</small></div>');
        var note = res.mode.dilutionOnly
            ? 'Water carries 0% fat and 0% SNF — total solids are diluted, not standardised.'
            : 'At ' + U.fmt(main.streamFat, d) + '% fat · ' + U.fmt(main.streamSnf, d) + '% SNF — carries ' +
              U.fmt(main.streamQty * main.streamFat / 100, d) + ' ' + unit + ' of fat and ' +
              U.fmt(main.streamQty * main.streamSnf / 100, d) + ' ' + unit + ' of SNF.';
        html.push('<div class="note">' + U.esc(note) + '</div>');
        html.push('</div>');

        // ---- KPI grid
        var checks = res.compliance.checks;
        var fatCheck = checks.find(function (c) { return c.name === 'Fat %'; }) || {};
        var snfCheck = checks.find(function (c) { return c.name === 'SNF %'; }) || {};

        html.push('<div class="kpis">');
        html.push(kpi('Raw milk', U.fmtGrouped(res.inputs.quantity, d) + ' ' + unit, ''));
        html.push(kpi(main.removal ? 'Standardized milk' : 'After addition',
            U.fmtGrouped(main.finalQty, d) + ' ' + unit, classFor(fatCheck)));
        html.push(kpi('Fat now', U.fmt(main.finalFat, d) + ' %', classFor(fatCheck)));
        html.push(kpi('SNF now', U.fmt(main.finalSnf, d) + ' %', classFor(snfCheck)));
        html.push(kpi('Yield', U.fmt(main.yieldPct, 1) + ' %', ''));
        html.push(kpi('Adjusting stream', U.fmtGrouped(main.streamQty, d) + ' ' + unit, ''));
        html.push('</div>');

        // ---- SNF / reconstitution
        html.push('<div class="section"><h3>SNF &amp; reconstitution</h3>');
        html.push('<div class="eq-row"><span class="l">SNF after fat adjustment</span><span class="r">' +
            U.fmt(snf.afterMain, d) + ' %</span></div>');
        if (snf.target !== null && snf.target !== undefined) {
            html.push('<div class="eq-row"><span class="l">Target SNF</span><span class="r">' + U.fmt(snf.target, d) + ' %</span></div>');
        }
        if (snf.needsReconstitution) {
            html.push('<div class="eq-row"><span class="l">SNF shortfall</span><span class="r">' + U.fmt(snf.shortfall, d) + ' points</span></div>');
            html.push('<div class="primary-card" style="margin-top:10px">');
            html.push('<div class="label">SMP to add (reconstitution step)</div>');
            html.push('<div class="value">' + U.esc(U.fmtGrouped(snf.smpMass, d)) + '<small>' + U.esc(unit) + '</small></div>');
            html.push('<div class="note">Final quantity ' + U.fmtGrouped(snf.postSmpQty, d) + ' ' + unit +
                ' · ' + U.fmt(snf.postSmpSnf, d) + '% SNF · ' + U.fmt(snf.postSmpFat, d) + '% fat</div>');
            html.push('</div>');
        } else if (snf.surplus > 0) {
            html.push('<div class="eq-row"><span class="l">SNF surplus over target</span><span class="r">' +
                U.fmt(snf.surplus, d) + ' points</span></div>');
            html.push('<p class="hint" style="margin-top:6px">No SMP needed — the batch already meets or exceeds the SNF target.</p>');
        } else {
            html.push('<p class="hint" style="margin-top:6px">Set a target SNF % to plan the SMP reconstitution step.</p>');
        }
        html.push('</div>');

        // ---- Compliance
        html.push('<div class="section"><h3>Compliance</h3>');
        if (res.compliance.enforced === false) {
            html.push('<p class="hint">Minimum checks are switched off in Settings.</p>');
        } else {
            html.push('<div class="eq-row"><span class="l">Minimum fat (' + U.esc(res.milkTypeLabel || '') + ')</span><span class="r">' +
                (Number.isFinite(res.compliance.minFat) && res.compliance.minFat > 0 ? U.fmt(res.compliance.minFat, d) + ' %' : 'not set') +
                '</span></div>');
            html.push('<div class="eq-row"><span class="l">Minimum SNF</span><span class="r">' +
                (Number.isFinite(res.compliance.minSnf) && res.compliance.minSnf > 0 ? U.fmt(res.compliance.minSnf, d) + ' %' : 'not set') +
                '</span></div>');
            checks.forEach(function (check) {
                html.push('<div class="eq-row"><span class="l">' + U.esc(check.name) + ' — ' + U.esc(check.note || '') + '</span>' +
                    '<span class="r">' + U.fmt(check.value, d) + ' % ' +
                    (check.pass ? '✔ pass' : '✘ fail') + '</span></div>');
            });
        }
        html.push('</div>');

        // ---- Warnings
        if (res.warnings.length) {
            html.push('<div class="section"><h3>Warnings &amp; notes</h3><div class="warnings">');
            res.warnings.forEach(function (warn) {
                html.push('<div class="warn-item warn-' + U.esc(warn.level) + '"><strong>' + U.esc(warn.title) + '</strong>' +
                    U.esc(warn.text) + '</div>');
            });
            html.push('</div></div>');
        }

        // ---- Working
        html.push('<details class="collapse"><summary>Mass-balance working</summary><div class="steps">');
        res.steps.forEach(function (step) {
            html.push('<div class="step"><div class="t">' + U.esc(step.label) + '</div>' +
                '<div class="f">' + U.esc(step.expr) + ' = ' + U.esc(step.subs) + '</div>' +
                '<div class="v">' + U.esc(step.value) + '</div></div>');
        });
        html.push('</div></details>');

        U.$('resultBody').innerHTML = html.join('');
        setActionButtons(true);
    }

    /** Nothing typed yet — show guidance instead of a wall of errors. */
    function isPristine() {
        return ['quantity', 'fatInitial', 'fatTarget'].every(function (id) {
            return String(U.$(id).value).trim() === '';
        });
    }

    function classFor(check) {
        if (!check || check.min === null || check.min === undefined) return '';
        return check.pass ? 'good' : 'bad';
    }

    function kpi(label, value, extraClass) {
        return '<div class="kpi ' + (extraClass || '') + '"><div class="k">' + U.esc(label) + '</div>' +
            '<div class="v">' + U.esc(value) + '</div></div>';
    }

    function setActionButtons(enabled) {
        ['btnSave', 'btnPrint', 'btnPdf'].forEach(function (id) {
            U.$(id).disabled = !enabled;
        });
    }

    // ============================================================
    // Recalculate
    // ============================================================
    function recalc() {
        syncVisibility();
        markInvalidFields();
        var res = Calc.compute(readInput(), settings);
        render(res);
        return res;
    }

    // ============================================================
    // Records, save, print
    // ============================================================
    function buildRecord() {
        if (!result || !result.ok) return null;
        return {
            batchRef: U.$('batchRef').value.trim(),
            supplier: U.$('supplier').value.trim(),
            operator: U.$('operator').value.trim() || settings.operator || '',
            notes: U.$('notes').value.trim(),
            milkType: currentMilkType(),
            milkTypeLabel: result.milkTypeLabel,
            unit: result.unit,
            modeId: result.mode.id,
            modeLabel: result.mode.label,
            summary: result.summary,
            calc: result
        };
    }

    function saveToHistory() {
        var record = buildRecord();
        if (!record) {
            U.toast('Nothing to save — fix the input errors first.', 'error');
            return Promise.resolve(null);
        }
        return Promise.resolve(window.MilkApi.addHistory(record)).then(function (saved) {
            lastSavedId = saved && saved.id;
            U.toast('Batch saved to history' + (record.batchRef ? ' (' + record.batchRef + ')' : '') + '.');
            if (window.MilkHistory) window.MilkHistory.refresh();
            return saved;
        }).catch(function (err) {
            U.toast('Could not save: ' + (err && err.message ? err.message : err), 'error');
            return null;
        });
    }

    function withCurrentResult(action) {
        var record = buildRecord();
        if (!record) {
            U.toast('Nothing to ' + action + ' — fix the input errors first.', 'error');
            return Promise.resolve(null);
        }
        record.createdAt = new Date().toISOString();
        return Promise.resolve(record);
    }

    function printReport() {
        return withCurrentResult('print').then(function (record) {
            if (!record) return null;
            if (window.MilkApi.canWritePdf) {
                return window.MilkApi.printHtml({ html: Report.standaloneHtml(record, settings) });
            }
            return window.MilkApi.printHtml({ fragment: Report.buildFragment(record, settings), css: Report.CSS });
        }).then(function (res) {
            if (res && res.ok && res.printed) U.toast('Print dialog opened.');
            else if (res && res.error) U.toast('Printing failed: ' + res.error, 'error');
            return res;
        });
    }

    function exportPdf() {
        return withCurrentResult('export').then(function (record) {
            if (!record) return null;
            var payload = {
                html: Report.standaloneHtml(record, settings),
                fragment: Report.buildFragment(record, settings),
                css: Report.CSS,
                defaultName: Report.filename(record, 'pdf')
            };
            return window.MilkApi.savePdf(payload);
        }).then(function (res) {
            if (!res) return null;
            if (res.ok && res.path && !res.printed) U.toast('PDF saved: ' + res.path);
            else if (res.ok && res.hint) U.toast(res.hint);
            else if (res.ok && res.downloaded) U.toast('Report sent to the browser download folder.');
            else if (res.error) U.toast('Export failed: ' + res.error, 'error');
            return res;
        });
    }

    function clearForm() {
        ['quantity', 'fatInitial', 'snfInitial', 'clr', 'lactometer', 'fatTarget', 'snfTarget',
            'batchRef', 'supplier', 'notes'].forEach(function (id) { U.$(id).value = ''; });
        lastSavedId = null;
        recalc();
    }

    function loadExample() {
        U.$('milkType').value = settings.defaultMilkType;
        U.$('unit').value = settings.defaultUnit;
        U.$('quantity').value = '480';
        U.$('fatInitial').value = '5.5';
        U.$('snfSource').value = 'direct';
        U.$('snfInitial').value = '8.6';
        U.$('fatTarget').value = '3.5';
        U.$('snfTarget').value = '8.6';
        U.$('creamFat').value = String(settings.creamFat);
        U.$('creamSnf').value = String(settings.creamSnf);
        U.$('skimFat').value = String(settings.skimFat);
        U.$('skimSnf').value = String(settings.skimSnf);
        U.$('smpSnf').value = String(settings.smpSnf);
        U.$('smpFat').value = String(settings.smpFat);
        U.$('batchRef').value = 'Sample batch';
        var radio = document.querySelector('input[name="mode"][value="cream_separation"]');
        if (radio) radio.checked = true;
        recalc();
    }

    // ============================================================
    // Init
    // ============================================================
    function applySettings(next, options) {
        settings = next;
        var keep = options && options.keepValues;
        if (!keep) {
            U.$('unit').value = settings.defaultUnit;
            U.$('milkType').value = settings.defaultMilkType;
            U.$('creamFat').value = settings.creamFat;
            U.$('creamSnf').value = settings.creamSnf;
            U.$('skimFat').value = settings.skimFat;
            U.$('skimSnf').value = settings.skimSnf;
            U.$('smpSnf').value = settings.smpSnf;
            U.$('smpFat').value = settings.smpFat;
            if (!U.$('operator').value) U.$('operator').value = settings.operator || '';
        }
        if (!document.querySelector('input[name="mode"]:checked')) {
            var radio = document.querySelector('input[name="mode"][value="cream_separation"]');
            if (radio) radio.checked = true;
        }
        buildQuickTargets();
        recalc();
    }

    function init(initialSettings) {
        buildMilkTypes();
        buildModes();
        applySettings(initialSettings);

        var recalculation = U.debounce(recalc, 90);
        FIELDS.forEach(function (id) {
            var el = U.$(id);
            if (!el) return;
            el.addEventListener('input', recalculation);
            el.addEventListener('change', recalc);
        });

        U.$('btnSave').addEventListener('click', saveToHistory);
        U.$('btnPrint').addEventListener('click', printReport);
        U.$('btnPdf').addEventListener('click', exportPdf);
        U.$('btnExample').addEventListener('click', loadExample);
        U.$('btnClear').addEventListener('click', clearForm);

        U.$('calcForm').addEventListener('submit', function (event) { event.preventDefault(); });
        U.$('calcForm').addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
                saveToHistory();
            }
        });

        setActionButtons(false);
    }

    window.MilkCalculator = {
        init: init,
        applySettings: applySettings,
        recalc: recalc,
        getResult: function () { return result; },
        getRecord: buildRecord,
        save: saveToHistory,
        print: printReport,
        exportPdf: exportPdf,
        loadExample: loadExample,
        clear: clearForm,
        lastSavedId: function () { return lastSavedId; }
    };
})();
