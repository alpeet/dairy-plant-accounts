/**
 * Milk Standardization Calculator — Local data store
 * ============================================================
 * One implementation of the settings + batch-history semantics, with a
 * pluggable persistence adapter so the exact same behaviour is used by:
 *
 *   • Electron main process  → fileAdapter(filePath)   (JSON file on disk)
 *   • Dev web server         → fileAdapter(filePath)
 *   • Browser (file:// mode) → webAdapter(localStorageKey)
 *
 * No database server, no network, no native modules — fully offline.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(root, true);
    } else {
        root.MilkStore = factory(root, false);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, isNode) {
    'use strict';

    var DEFAULTS = isNode ? require('./defaults') : root.MilkDefaults;

    var STATE_VERSION = 1;

    function emptyState() {
        return { version: STATE_VERSION, settings: DEFAULTS.defaults(), history: [] };
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function uid() {
        var rand = Math.random().toString(36).slice(2, 8);
        return 'b' + Date.now().toString(36) + '-' + rand;
    }

    function normaliseState(raw) {
        var base = emptyState();
        if (!raw || typeof raw !== 'object') return base;
        return {
            version: STATE_VERSION,
            settings: DEFAULTS.normaliseSettings(raw.settings),
            history: Array.isArray(raw.history) ? raw.history.filter(function (h) {
                return h && typeof h === 'object';
            }) : []
        };
    }

    // ============================================================
    // Adapters
    // ============================================================
    function fileAdapter(filePath) {
        var fs = require('fs');
        var path = require('path');
        var dir = path.dirname(filePath);
        return {
            kind: 'file',
            location: filePath,
            read: function () {
                try {
                    return fs.readFileSync(filePath, 'utf8');
                } catch (err) {
                    if (err && err.code === 'ENOENT') return null;
                    throw err;
                }
            },
            write: function (text) {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                var tmp = filePath + '.tmp';
                fs.writeFileSync(tmp, text, 'utf8');
                fs.renameSync(tmp, filePath);
            },
            /** Keep a timestamped copy next to the data file before destructive writes. */
            backup: function (text) {
                if (!text) return null;
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                var stamp = new Date().toISOString().replace(/[:.]/g, '-');
                var target = path.join(dir, 'backup-' + stamp + '.json');
                fs.writeFileSync(target, text, 'utf8');
                return target;
            }
        };
    }

    function webAdapter(key, storage) {
        var store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
        return {
            kind: 'localStorage',
            location: key,
            read: function () {
                if (!store) return null;
                try {
                    return store.getItem(key);
                } catch (err) {
                    return null;
                }
            },
            write: function (text) {
                if (!store) return;
                try {
                    store.setItem(key, text);
                } catch (err) {
                    /* quota / private mode — keep working in memory */
                }
            },
            backup: function () {
                return null;
            }
        };
    }

    function memoryAdapter(seed) {
        var value = seed || null;
        return {
            kind: 'memory',
            location: 'memory',
            read: function () { return value; },
            write: function (text) { value = text; },
            backup: function () { return null; }
        };
    }

    // ============================================================
    // Store
    // ============================================================
    function createStore(adapter) {
        if (!adapter) throw new Error('createStore requires a persistence adapter');

        function parse(text) {
            if (!text) return emptyState();
            try {
                return normaliseState(JSON.parse(text));
            } catch (err) {
                return emptyState();
            }
        }

        var state = parse(adapter.read());

        function persist(backupFirst) {
            var text = JSON.stringify(state, null, 2);
            if (backupFirst) {
                try { adapter.backup(adapter.read()); } catch (err) { /* non-fatal */ }
            }
            adapter.write(text);
            return text;
        }

        function touch() {
            state.version = STATE_VERSION;
        }

        return {
            location: adapter.location,
            kind: adapter.kind,

            // ---- settings ------------------------------------------------
            getSettings: function () {
                return DEFAULTS.clone(state.settings);
            },
            saveSettings: function (patch) {
                state.settings = DEFAULTS.normaliseSettings(DEFAULTS.merge(state.settings, patch || {}));
                touch();
                persist(false);
                return DEFAULTS.clone(state.settings);
            },
            resetSettings: function () {
                state.settings = DEFAULTS.defaults();
                touch();
                persist(true);
                return DEFAULTS.clone(state.settings);
            },

            // ---- history -------------------------------------------------
            listHistory: function () {
                return DEFAULTS.clone(state.history);
            },
            getHistory: function (id) {
                var found = state.history.find(function (h) { return h.id === id; });
                return found ? DEFAULTS.clone(found) : null;
            },
            addHistory: function (entry) {
                var record = DEFAULTS.clone(entry) || {};
                record.id = record.id || uid();
                record.createdAt = record.createdAt || nowIso();
                record.updatedAt = record.createdAt;
                state.history.unshift(record);
                var limit = state.settings.historyLimit || 500;
                if (state.history.length > limit) state.history.length = limit;
                touch();
                persist(false);
                return DEFAULTS.clone(record);
            },
            updateHistory: function (id, patch) {
                for (var i = 0; i < state.history.length; i++) {
                    if (state.history[i].id === id) {
                        state.history[i] = DEFAULTS.merge(state.history[i], patch || {});
                        state.history[i].id = id;
                        state.history[i].updatedAt = nowIso();
                        touch();
                        persist(false);
                        return DEFAULTS.clone(state.history[i]);
                    }
                }
                return null;
            },
            deleteHistory: function (id) {
                var before = state.history.length;
                state.history = state.history.filter(function (h) { return h.id !== id; });
                var removed = state.history.length !== before;
                if (removed) {
                    touch();
                    persist(false);
                }
                return removed;
            },
            clearHistory: function () {
                var count = state.history.length;
                state.history = [];
                touch();
                persist(true);
                return count;
            },

            // ---- whole-state (backup / restore) --------------------------
            exportState: function () {
                return {
                    version: STATE_VERSION,
                    exportedAt: nowIso(),
                    settings: DEFAULTS.clone(state.settings),
                    history: DEFAULTS.clone(state.history)
                };
            },
            importState: function (raw, options) {
                var opts = options || {};
                var incoming = raw || {};
                state.settings = DEFAULTS.normaliseSettings(opts.settingsOnly ? state.settings : incoming.settings);
                if (!opts.settingsOnly) {
                    var list = Array.isArray(incoming.history) ? incoming.history : [];
                    list = list.filter(function (h) { return h && typeof h === 'object'; });
                    state.history = opts.replace === false ? list.concat(state.history) : list;
                }
                touch();
                persist(true);
                return { settings: DEFAULTS.clone(state.settings), history: DEFAULTS.clone(state.history) };
            },
            reload: function () {
                state = parse(adapter.read());
                return { settings: DEFAULTS.clone(state.settings), history: DEFAULTS.clone(state.history) };
            }
        };
    }

    return {
        createStore: createStore,
        fileAdapter: fileAdapter,
        webAdapter: webAdapter,
        memoryAdapter: memoryAdapter,
        emptyState: emptyState,
        uid: uid
    };
});
