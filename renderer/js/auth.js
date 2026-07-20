/**
 * Godhuli Dairy Plant — Web Auth
 * ==============================
 * Handles client-side logout and stores current user info (id, username, role).
 * Authentication is managed via HttpOnly cookies (set by server).
 * The /api/auth/me endpoint returns the current user's details.
 */

(function () {
    // Don't run in Electron
    if (window.electronAPI || window.process?.versions?.electron) {
        return;
    }

    // ── Fetch current user info and store globally ──
    async function fetchCurrentUser() {
        try {
            const response = await fetch('/api/auth/me', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.success && result.data) {
                window._currentUser = {
                    id: result.data.id,
                    username: result.data.username,
                    role: result.data.role || 'admin'
                };
                console.log('Current user:', window._currentUser.username, 'role:', window._currentUser.role);
            }
        } catch (e) {
            // User is not authenticated or server error — will be redirected
            console.warn('Could not fetch user info:', e.message);
        }
    }

    // Fetch on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fetchCurrentUser);
    } else {
        fetchCurrentUser();
    }

    // Expose logout function globally
    window.logout = async function logout() {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            // Server might be down — redirect anyway
        }
        window.location.href = '/login';
    };
})();
