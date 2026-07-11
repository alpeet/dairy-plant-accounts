/**
 * Godhuli Dairy Plant — Web Auth
 * ==============================
 * Handles client-side logout. Authentication is managed via HttpOnly cookies
 * (set by server, not accessible to JS). The server's webAuthRedirect middleware
 * handles redirecting unauthenticated users to the login page.
 * Since cookies are sent automatically with every same-origin request,
 * no fetch patching or manual token management is needed.
 */

(function () {
    // Don't run in Electron
    if (window.electronAPI || window.process?.versions?.electron) {
        return;
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
