/**
 * Milk Standardization Calculator — API client
 * ============================================================
 * One interface, three transports, chosen at load time:
 *
 *   desktop → window.api from preload.js (Electron IPC, real SQLite-free JSON file)
 *   web     → fetch() against dev-server.js REST endpoints
 *   local   → localStorage, so simply opening index.html also works
 *
 * Every method returns a Promise.
 */
(function () {
    'use strict';

    var hasDesktopBridge = !!(window.api && window.api.__milkDesktop);
    var isHttp = location.protocol === 'http:' || location.protocol === 'https:';

    // ------------------------------------------------------------
    // Shared browser helpers
    // ------------------------------------------------------------
    function download(content, filename, mime) {
        try {
            var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
            var url = URL.createObjectURL(blob);
            var link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            setTimeout(function () {
                URL.revokeObjectURL(url);
                link.remove();
            }, 500);
            return Promise.resolve({ ok: true, path: filename, downloaded: true });
        } catch (err) {
            return Promise.resolve({ ok: false, error: String(err && err.message ? err.message : err) });
        }
    }

    function printFragment(payload) {
        var area = document.getElementById('printArea');
        if (!area) return Promise.resolve({ ok: false, error: 'Print area missing.' });
        area.innerHTML =
            '<style>' + (payload.css || '') + '</style>' + (payload.fragment || '');
        return new Promise(function (resolve) {
            setTimeout(function () {
                try {
                    window.print();
                    resolve({ ok: true, printed: true });
                } catch (err) {
                    resolve({ ok: false, error: String(err && err.message ? err.message : err) });
                }
            }, 80);
        });
    }

    function localStore() {
        return window.MilkStore.createStore(window.MilkStore.webAdapter('milk-standardization-v1'));
    }

    // ------------------------------------------------------------
    // Backends
    // ------------------------------------------------------------
    var desktopBackend = {
        id: 'desktop',
        label: 'Desktop app',
        canWritePdf: true,
        info: function () { return window.api.info(); },
        getSettings: function () { return window.api.getSettings(); },
        saveSettings: function (patch) { return window.api.saveSettings(patch); },
        resetSettings: function () { return window.api.resetSettings(); },
        listHistory: function () { return window.api.listHistory(); },
        addHistory: function (entry) { return window.api.addHistory(entry); },
        updateHistory: function (id, patch) { return window.api.updateHistory(id, patch); },
        deleteHistory: function (id) { return window.api.deleteHistory(id); },
        clearHistory: function () { return window.api.clearHistory(); },
        saveTextFile: function (payload) { return window.api.saveTextFile(payload); },
        savePdf: function (payload) { return window.api.savePdf(payload); },
        printHtml: function (payload) { return window.api.printHtml(payload); },
        backup: function () { return window.api.backup(); },
        restore: function (options) { return window.api.restore(options); },
        openDataFolder: function () { return window.api.openDataFolder(); },
        onMenu: function (handler) { return window.api.onMenu(handler); }
    };

    function httpBackend() {
        function request(path, options) {
            var opts = options || {};
            return fetch(path, {
                method: opts.method || 'GET',
                headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
                body: opts.body ? JSON.stringify(opts.body) : undefined
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data = null;
                    try { data = text ? JSON.parse(text) : null; } catch (err) { data = text; }
                    if (!res.ok) throw new Error((data && data.error) || ('Request failed: ' + res.status));
                    return data;
                });
            });
        }

        return {
            id: 'web',
            label: 'Browser host',
            canWritePdf: false,
            info: function () { return request('/api/info'); },
            getSettings: function () { return request('/api/settings'); },
            saveSettings: function (patch) { return request('/api/settings', { method: 'POST', body: patch }); },
            resetSettings: function () { return request('/api/settings/reset', { method: 'POST' }); },
            listHistory: function () { return request('/api/history'); },
            addHistory: function (entry) { return request('/api/history', { method: 'POST', body: entry }); },
            updateHistory: function (id, patch) { return request('/api/history/' + encodeURIComponent(id), { method: 'PATCH', body: patch }); },
            deleteHistory: function (id) { return request('/api/history/' + encodeURIComponent(id), { method: 'DELETE' }); },
            clearHistory: function () { return request('/api/history', { method: 'DELETE' }); },
            saveTextFile: function (payload) {
                return download(payload.content, payload.defaultName || 'export.txt', payload.mime);
            },
            savePdf: function (payload) {
                return printFragment(payload).then(function (res) {
                    if (res.ok) res.hint = 'Choose "Save as PDF" in the print dialog.';
                    return res;
                });
            },
            printHtml: function (payload) {
                return printFragment(payload);
            },
            backup: function () {
                return fetch('/api/state').then(function (res) { return res.json(); }).then(function (state) {
                    var stamp = new Date().toISOString().slice(0, 10);
                    return download(JSON.stringify(state, null, 2), 'milk-standardization-backup-' + stamp + '.json', 'application/json');
                });
            },
            restore: function (options) {
                return pickJsonFile().then(function (raw) {
                    if (!raw) return { ok: false, canceled: true };
                    return request('/api/state', { method: 'POST', body: { state: raw, options: options || {} } })
                        .then(function (state) { return { ok: true, state: state }; });
                });
            },
            openDataFolder: function () {
                return Promise.resolve({ ok: false, error: 'Only available in the desktop app.' });
            },
            onMenu: function () { return function () {}; }
        };
    }

    function pickJsonFile() {
        return new Promise(function (resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json,.json';
            input.addEventListener('change', function () {
                var file = input.files && input.files[0];
                if (!file) return resolve(null);
                var reader = new FileReader();
                reader.onload = function () {
                    try { resolve(JSON.parse(String(reader.result))); }
                    catch (err) { resolve(null); }
                };
                reader.onerror = function () { resolve(null); };
                reader.readAsText(file);
            });
            input.click();
        });
    }

    function localBackend() {
        var store = localStore();
        return {
            id: 'local',
            label: 'Local browser storage',
            canWritePdf: false,
            info: function () {
                return Promise.resolve({
                    isDesktop: false, name: 'Milk Standardization Calculator', version: '1.0.0 (local mode)',
                    platform: (navigator.platform || 'browser'), dataDir: 'browser localStorage',
                    dataFile: 'milk-standardization-v1'
                });
            },
            getSettings: function () { return Promise.resolve(store.getSettings()); },
            saveSettings: function (patch) { return Promise.resolve(store.saveSettings(patch)); },
            resetSettings: function () { return Promise.resolve(store.resetSettings()); },
            listHistory: function () { return Promise.resolve(store.listHistory()); },
            addHistory: function (entry) { return Promise.resolve(store.addHistory(entry)); },
            updateHistory: function (id, patch) { return Promise.resolve(store.updateHistory(id, patch)); },
            deleteHistory: function (id) { return Promise.resolve(store.deleteHistory(id)); },
            clearHistory: function () { return Promise.resolve(store.clearHistory()); },
            saveTextFile: function (payload) {
                return download(payload.content, payload.defaultName || 'export.txt', payload.mime);
            },
            savePdf: function (payload) {
                return printFragment(payload).then(function (res) {
                    if (res.ok) res.hint = 'Choose "Save as PDF" in the print dialog.';
                    return res;
                });
            },
            printHtml: function (payload) { return printFragment(payload); },
            backup: function () {
                var stamp = new Date().toISOString().slice(0, 10);
                return download(JSON.stringify(store.exportState(), null, 2),
                    'milk-standardization-backup-' + stamp + '.json', 'application/json');
            },
            restore: function (options) {
                return pickJsonFile().then(function (raw) {
                    if (!raw) return { ok: false, canceled: true };
                    var state = store.importState(raw, options || {});
                    return { ok: true, state: state };
                });
            },
            openDataFolder: function () {
                return Promise.resolve({ ok: false, error: 'Only available in the desktop app.' });
            },
            onMenu: function () { return function () {}; }
        };
    }

    // ------------------------------------------------------------
    // Choose a backend (with a safe fallback if the host is gone)
    // ------------------------------------------------------------
    var backend = hasDesktopBridge ? desktopBackend : (isHttp ? httpBackend() : localBackend());

    var Api = {
        mode: backend.id,
        label: backend.label,
        canWritePdf: backend.canWritePdf,
        /** Swap the HTTP backend for local storage if the server disappears. */
        fallbackIfOffline: function () {
            if (Api.mode !== 'web') return Promise.resolve(false);
            return fetch('/api/info').then(function (res) {
                return res.ok;
            }).catch(function () {
                backend = localBackend();
                Api.mode = backend.id;
                Api.label = backend.label;
                Api.canWritePdf = backend.canWritePdf;
                return true;
            });
        }
    };

    ['info', 'getSettings', 'saveSettings', 'resetSettings', 'listHistory', 'addHistory',
        'updateHistory', 'deleteHistory', 'clearHistory', 'saveTextFile', 'savePdf',
        'printHtml', 'backup', 'restore', 'openDataFolder', 'onMenu'
    ].forEach(function (method) {
        Api[method] = function () {
            return backend[method].apply(backend, arguments);
        };
    });

    window.MilkApi = Api;
})();
