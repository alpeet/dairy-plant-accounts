/**
 * Milk Standardization Calculator — application bootstrap
 * ============================================================ */
(function () {
    'use strict';

    var U = window.MilkUI;
    var Defaults = window.MilkDefaults;

    var settings = Defaults.defaults();
    var currentView = 'standardize';

    // ============================================================
    // Views
    // ============================================================
    function showView(name) {
        currentView = name;
        document.querySelectorAll('.view').forEach(function (view) {
            view.classList.toggle('is-active', view.id === 'view-' + name);
        });
        document.querySelectorAll('.tab').forEach(function (tab) {
            tab.classList.toggle('is-active', tab.dataset.view === name);
        });
        if (name === 'history' && window.MilkHistory) window.MilkHistory.refresh();
    }

    function initTabs() {
        U.$('tabs').addEventListener('click', function (event) {
            var tab = event.target.closest('.tab');
            if (tab) showView(tab.dataset.view);
        });
    }

    // ============================================================
    // Settings propagation
    // ============================================================
    function pushSettings(next) {
        settings = next;
        window.MilkCalculator.applySettings(next, { keepValues: true });
        window.MilkHistory.setSettings(next);
        window.MilkSettings.fill(next);
    }

    function reloadAll() {
        return Promise.resolve(window.MilkApi.getSettings()).then(function (loaded) {
            settings = loaded;
            window.MilkCalculator.applySettings(loaded);
            window.MilkHistory.setSettings(loaded);
            window.MilkSettings.fill(loaded);
            return window.MilkHistory.refresh();
        });
    }

    // ============================================================
    // Application menu (desktop only)
    // ============================================================
    function initMenu() {
        if (!window.MilkApi.onMenu) return;
        window.MilkApi.onMenu(function (command) {
            if (command === 'go:standardize') showView('standardize');
            else if (command === 'go:history') showView('history');
            else if (command === 'go:tools') showView('tools');
            else if (command === 'go:settings') showView('settings');
            else if (command === 'new') { showView('standardize'); window.MilkCalculator.clear(); }
            else if (command === 'save') window.MilkCalculator.save();
            else if (command === 'print') window.MilkCalculator.print();
            else if (command === 'pdf') window.MilkCalculator.exportPdf();
            else if (command === 'csv') { showView('history'); U.$('btnExportCsv').click(); }
            else if (command === 'backup') U.$('btnBackup').click();
        });
    }

    // ============================================================
    // Boot
    // ============================================================
    function boot() {
        U.initModal();
        initTabs();
        initMenu();

        var chip = U.$('modeChip');
        chip.textContent = window.MilkApi.label;

        return Promise.resolve(window.MilkApi.fallbackIfOffline()).then(function (switched) {
            if (switched) {
                U.toast('Host server not reachable — switched to local browser storage.', 'warn');
                chip.textContent = window.MilkApi.label;
            }
            return window.MilkApi.getSettings();
        }).then(function (loaded) {
            settings = loaded;
            window.MilkCalculator.init(loaded);
            window.MilkSettings.init(loaded);
            window.MilkTools.init();
            // attaches the table / filter listeners and loads the saved batches
            window.MilkHistory.init(loaded);

            return window.MilkApi.info();
        }).then(function (info) {
            U.$('dataChip').textContent = info.isDesktop ? 'Offline · local data file' : 'Offline · browser host';
            U.$('dataChip').title = 'Data file: ' + (info.dataFile || info.dataDir || '—');
            U.$('brandSub').textContent = 'Fat / SNF mass-balance standardization — offline · v' + (info.version || '1.0.0');
            return null;
        }).catch(function (err) {
            U.toast('Startup problem: ' + (err && err.message ? err.message : err), 'error');
        });
    }

    window.MilkApp = {
        showView: showView,
        pushSettings: pushSettings,
        reloadAll: reloadAll,
        settings: function () { return settings; }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
