/**
 * Prarambha Account & Stock Management — Authentication
 * ==============================
 * Works in BOTH modes:
 *   - Desktop (Electron): the session lives in the main process. This script
 *     loads the current user for role-based visibility and wires the logout
 *     button to the IPC `auth:logout` handler.
 *   - Web: HttpOnly cookies (set by the server) with a Bearer-token fallback
 *     stored in sessionStorage/localStorage.
 */

(function () {
    const isElectron = !!(window.electronAPI ||
        window.process?.versions?.electron ||
        (typeof location !== 'undefined' && location.protocol === 'file:'));

    // ════════════════════════════════════════════════════════════
    // DESKTOP MODE (Electron)
    // ════════════════════════════════════════════════════════════
    if (isElectron) {
        // Load the current user so role-based sidebar visibility works
        async function loadDesktopUser() {
            try {
                const result = await window.api.getCurrentUser();
                if (result && result.success && result.data) {
                    window._currentUser = {
                        id: result.data.id,
                        username: result.data.username,
                        role: result.data.role || 'admin'
                    };
                }
            } catch (e) {
                // ignore
            }
        }
        loadDesktopUser();

        // Logout → clear the main-process session, return to the login screen
        window.logout = async function logout() {
            try { await window.api.logout(); } catch (e) { /* ignore */ }
            window.location.href = 'login-electron.html';
        };

        window.getAuthHeaders = function () {
            return { 'Content-Type': 'application/json' };
        };
        return;
    }

    // ════════════════════════════════════════════════════════════
    // WEB MODE
    // ════════════════════════════════════════════════════════════

    // ── Helper: get auth token from storage ──
    // Checks localStorage first (Remember Me), then sessionStorage (session mode)
    function getAuthToken() {
        try {
            return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
        } catch (e) {
            return null;
        }
    }

    // ── Helper: make auth POST request with cookie + Bearer fallback ──
    async function authFetch(url, data = {}) {
        const headers = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });
    }

    // ── Fetch current user info and store globally ──
    async function fetchCurrentUser() {
        try {
            const response = await authFetch('/api/auth/me');
            const result = await response.json();
            if (result.success && result.data) {
                window._currentUser = {
                    id: result.data.id,
                    username: result.data.username,
                    role: result.data.role || 'admin'
                };
                if (result.data.mustChangePassword) {
                    window._currentUser.mustChangePassword = true;
                    // Block the app until the default password is changed
                    if (typeof window.forcePasswordChange === 'function') {
                        window.forcePasswordChange();
                    }
                }
            } else {
                // Auth failed — clear any stale token
                try { sessionStorage.removeItem('auth_token'); } catch (e) {}
            }
        } catch (e) {
            // Network error — might be temporary, don't clear token
            if (e.name !== 'TypeError' || !e.message.includes('Failed to fetch')) {
                try { sessionStorage.removeItem('auth_token'); } catch (_) {}
            }
        }
    }

    // Fetch on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fetchCurrentUser);
    } else {
        fetchCurrentUser();
    }

    // Expose logout function globally — clears both cookie AND storage
    window.logout = async function logout() {
        try {
            const headers = { 'Content-Type': 'application/json' };
            const token = getAuthToken();
            if (token) {
                headers['Authorization'] = 'Bearer ' + token;
            }
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: headers
            });
        } catch (e) {
            // Server might be down — redirect anyway
        }
        try {
            sessionStorage.removeItem('auth_token');
            localStorage.removeItem('auth_token');
        } catch (e) {}
        window.location.href = '/login';
    };

    // ── Global helper: get auth headers for use by other modules (e.g. api.js) ──
    window.getAuthHeaders = function () {
        const headers = { 'Content-Type': 'application/json' };
        const token = getAuthToken();
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        return headers;
    };
})();
