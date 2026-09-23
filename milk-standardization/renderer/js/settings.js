/**
 * Milk Standardization Calculator — Settings view
 * ============================================================
 * Plant identity, calculation defaults and the configurable regulatory
 * minimums. Nothing about fat / SNF limits is hard-coded in the engine.
 */
(function () {
    'use strict';

    var U = window.MilkUI;
    var Defaults = window.MilkDefaults;

    var current = Defaults.defaults();
    var dirty = false;

    function fill(settings) {
        current = settings;
        U.$('setPlantName').value = settings.plantName || '';
        U.$('setPlantAddress').value = settings.plantAddress || '';
        U.$('setPlantPhone').value = settings.plantPhone || '';
        U.$('setPlantLicense').value = settings.plantLicense || '';
        U.$('setOperator').value = settings.operator || '';
        U.$('setReportNote').value = settings.reportNote || '';

        U.$('setDefaultUnit').value = settings.defaultUnit;
        U.$('setDefaultMilkType').value = settings.defaultMilkType;
        U.$('setDecimals').value = String(settings.decimals);

        U.$('setCreamFat').value = settings.creamFat;
        U.$('setCreamSnf').value = settings.creamSnf;
        U.$('setSkimFat').value = settings.skimFat;
        U.$('setSkimSnf').value = settings.skimSnf;
        U.$('setSmpSnf').value = settings.smpSnf;
        U.$('setSmpFat').value = settings.smpFat;
        U.$('setHistoryLimit').value = settings.historyLimit;
        U.$('setEnforceMinimums').checked = settings.enforceMinimums !== false;

        U.$('minFatCow').value = settings.minFat.cow;
        U.$('minFatBuffalo').value = settings.minFat.buffalo;
        U.$('minFatMixed').value = settings.minFat.mixed;
        U.$('minSnfCow').value = settings.minSnf.cow;
        U.$('minSnfBuffalo').value = settings.minSnf.buffalo;
        U.$('minSnfMixed').value = settings.minSnf.mixed;

        setDirty(false);
    }

    function collect() {
        return {
            plantName: U.$('setPlantName').value.trim(),
            plantAddress: U.$('setPlantAddress').value.trim(),
            plantPhone: U.$('setPlantPhone').value.trim(),
            plantLicense: U.$('setPlantLicense').value.trim(),
            operator: U.$('setOperator').value.trim(),
            reportNote: U.$('setReportNote').value.trim(),
            defaultUnit: U.$('setDefaultUnit').value,
            defaultMilkType: U.$('setDefaultMilkType').value,
            decimals: U.num(U.$('setDecimals').value, 2),
            creamFat: U.num(U.$('setCreamFat').value, 40),
            creamSnf: U.num(U.$('setCreamSnf').value, 2),
            skimFat: U.num(U.$('setSkimFat').value, 0.05),
            skimSnf: U.num(U.$('setSkimSnf').value, 9),
            smpSnf: U.num(U.$('setSmpSnf').value, 96),
            smpFat: U.num(U.$('setSmpFat').value, 1),
            historyLimit: U.num(U.$('setHistoryLimit').value, 500),
            enforceMinimums: U.$('setEnforceMinimums').checked,
            minFat: {
                cow: U.num(U.$('minFatCow').value, 0),
                buffalo: U.num(U.$('minFatBuffalo').value, 0),
                mixed: U.num(U.$('minFatMixed').value, 0)
            },
            minSnf: {
                cow: U.num(U.$('minSnfCow').value, 0),
                buffalo: U.num(U.$('minSnfBuffalo').value, 0),
                mixed: U.num(U.$('minSnfMixed').value, 0)
            }
        };
    }

    function setDirty(value) {
        dirty = value;
        var el = U.$('settingsDirty');
        if (el) el.textContent = value ? 'Unsaved changes' : 'Saved';
        if (el) el.style.color = value ? 'var(--accent)' : 'var(--muted)';
    }

    function save() {
        var patch = collect();
        return Promise.resolve(window.MilkApi.saveSettings(patch)).then(function (saved) {
            current = saved;
            setDirty(false);
            U.toast('Settings saved.');
            if (window.MilkApp) window.MilkApp.pushSettings(saved);
            return saved;
        }).catch(function (err) {
            U.toast('Could not save settings: ' + (err && err.message ? err.message : err), 'error');
        });
    }

    function resetDefaults() {
        return U.confirm('Restore app defaults?',
            'Plant details, composition defaults and the configured fat / SNF minimums all go back to the ' +
            'placeholder values shipped with the app.', 'Restore defaults').then(function (ok) {
            if (!ok) return;
            return Promise.resolve(window.MilkApi.resetSettings()).then(function (saved) {
                fill(saved);
                U.toast('App defaults restored.');
                if (window.MilkApp) window.MilkApp.pushSettings(saved);
            });
        });
    }

    function openDataFolder() {
        window.MilkApi.openDataFolder().then(function (res) {
            if (res && res.ok) U.toast('Data folder opened.');
            else U.toast((res && res.error) || 'Could not open the data folder.', 'warn');
        });
    }

    function clearHistory() {
        U.confirm('Clear all history?', 'All saved batches are removed. The data file itself is kept.', 'Clear history')
            .then(function (ok) {
                if (!ok) return;
                return Promise.resolve(window.MilkApi.clearHistory()).then(function () {
                    U.toast('Batch history cleared.');
                    if (window.MilkHistory) window.MilkHistory.refresh();
                });
            });
    }

    function renderAbout() {
        var host = U.$('aboutList');
        host.innerHTML = '<li><span>Loading…</span><span></span></li>';
        return Promise.resolve(window.MilkApi.info()).then(function (info) {
            var rows = [
                ['Application', info.name || 'Milk Standardization Calculator'],
                ['Version', info.version || '1.0.0'],
                ['Storage mode', info.isDesktop ? 'Desktop (local JSON file)' : window.MilkApi.label],
                ['Data location', info.dataFile || info.dataDir || '—'],
                ['Platform', info.platform || '—'],
                ['Runtime', info.electron ? ('Electron ' + info.electron + ' · Chromium ' + info.chrome) : ('Node ' + (info.node || '—'))],
                ['Engine', 'Mass balance + Richmond\'s formula'],
                ['Network', 'None — fully offline']
            ];
            host.innerHTML = rows.map(function (row) {
                return '<li><span>' + U.esc(row[0]) + '</span><span>' + U.esc(row[1]) + '</span></li>';
            }).join('');
            var loc = U.$('dataLocation');
            if (loc) loc.textContent = 'Batches and settings are stored at: ' + (info.dataFile || info.dataDir || 'local storage');
            return info;
        });
    }

    function init(initialSettings) {
        fill(initialSettings);
        renderAbout();

        U.$('view-settings').addEventListener('input', function () { setDirty(true); });
        U.$('view-settings').addEventListener('change', function () { setDirty(true); });

        U.$('btnSaveSettings').addEventListener('click', save);
        U.$('btnResetSettings').addEventListener('click', resetDefaults);
        U.$('btnOpenFolder').addEventListener('click', openDataFolder);
        U.$('btnClearHistory2').addEventListener('click', clearHistory);
    }

    window.MilkSettings = {
        init: init,
        fill: fill,
        save: save,
        isDirty: function () { return dirty; }
    };
})();
