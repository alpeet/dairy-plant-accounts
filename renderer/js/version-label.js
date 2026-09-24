/**
 * App Version Label
 * Reads the real app version and fills every [data-app-version] placeholder.
 * Works in both runtimes:
 *   - Electron: preload.js exposes window.api.getAppVersion() → app.getVersion()
 *   - Web:      js/api.js exposes window.api.getAppVersion() → GET /api/version
 *               (or a direct GET /api/version on pages without api.js, e.g. login)
 */
(function () {
    function applyVersion(version) {
        if (!version) return;
        document.querySelectorAll('[data-app-version]').forEach(el => {
            el.textContent = version;
        });
    }

    function handleResult(result) {
        if (typeof result === 'string' && result) { applyVersion(result); return; } // Electron preload returns a plain string
        if (result && result.success) {
            if (typeof result.data === 'string') applyVersion(result.data);
            else if (result.data && result.data.version) applyVersion(result.data.version);
        } else {
            fetchDirect();
        }
    }

    // Fallback for pages that don't load api.js (web login pages).
    // In Electron (file://) this request fails and is ignored.
    function fetchDirect() {
        if (typeof fetch !== 'function') return;
        fetch('/api/version', { headers: { 'Accept': 'application/json' } })
            .then(r => (r.ok ? r.json() : null))
            .then(j => { if (j && j.success && j.data) applyVersion(j.data.version); })
            .catch(() => { /* offline / Electron — leave placeholder empty */ });
    }

    function init() {
        if (window.api && typeof window.api.getAppVersion === 'function') {
            Promise.resolve(window.api.getAppVersion())
                .then(handleResult)
                .catch(fetchDirect);
        } else {
            fetchDirect();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
