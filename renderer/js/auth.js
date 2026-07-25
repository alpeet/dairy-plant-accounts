/**
 * Godhuli Dairy Plant — Web Auth
 * ==============================
 * Handles client-side authentication with Bearer token fallback.
 * Primary: HttpOnly cookies (set by server).
 * Fallback: Bearer token in sessionStorage (prevents redirect race conditions).
 * The /api/auth/me endpoint returns the current user's details.
 */

(function () {
    // Don't run in Electron
    if (window.electronAPI || window.process?.versions?.electron) {
        return;
    }

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

    // Expose logout function globally — clears both cookie AND sessionStorage
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
