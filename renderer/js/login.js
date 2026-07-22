/**
 * Godhuli Dairy Plant — Login Page Script
 * Handles authentication, registration, and forgot password for the web version.
 * Uses HttpOnly cookies — server sets the cookie, client just redirects.
 */

const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', () => {
    // If already authenticated (server set cookie), server will redirect us to '/'
    // when we try to visit '/login'. But we can also just check here.
    // Making a simple fetch to /api/auth/verify will include the cookie automatically.
    fetch(`${API_BASE}/auth/verify`, { method: 'POST' })
        .then(r => r.json())
        .then(result => {
            if (result.success) {
                window.location.href = '/';
            }
        })
        .catch(() => {});

    // ===================================================================
    // Database Status Check — warn if data appears lost
    // ===================================================================
    checkDbStatus();

    async function checkDbStatus() {
        try {
            const resp = await fetch(`${API_BASE}/auth/db-status`, { method: 'POST' });
            const result = await resp.json();
            if (!result.success || !result.data) return;

            const { state, message, severity, stats, backupsAvailable } = result.data;

            // Only show warning for fresh/empty databases with no business data
            if (state === 'empty' || state === 'fresh') {
                let bannerHtml = '';

                if (state === 'fresh') {
                    bannerHtml = `
                        <div class="db-warning db-warning-danger">
                            <div class="db-warning-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                            </div>
                            <div class="db-warning-content">
                                <strong>🔴 Data May Have Been Lost</strong>
                                <p>Only the default admin account exists with no business data. If you had data before, it was lost during a server restart — the persistent disk may not be configured.</p>
                                ${backupsAvailable > 0 ? `
                                    <div class="db-warning-action">
                                        <a href="/login" class="db-warning-btn">
                                            💾 ${backupsAvailable} backup(s) available — Login to access them
                                        </a>
                                    </div>
                                ` : `
                                    <div class="db-warning-action">
                                        <span class="db-warning-hint">No backups found. Set up a persistent disk in Render Dashboard to prevent future data loss.</span>
                                    </div>
                                `}
                            </div>
                        </div>
                    `;
                } else if (state === 'empty') {
                    bannerHtml = `
                        <div class="db-warning db-warning-warning">
                            <div class="db-warning-icon">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="12" y1="8" x2="12" y2="12"/>
                                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                            </div>
                            <div class="db-warning-content">
                                <strong>⚠️ Fresh Installation</strong>
                                <p>This is a new database. Create your first account below or login with the default admin credentials.</p>
                            </div>
                        </div>
                    `;
                }

                if (bannerHtml) {
                    // Insert banner at the top of the login card, before the logo
                    const loginCard = document.querySelector('.login-card');
                    const logo = document.querySelector('.login-logo');
                    if (loginCard && logo) {
                        const bannerDiv = document.createElement('div');
                        bannerDiv.innerHTML = bannerHtml;
                        loginCard.insertBefore(bannerDiv.firstElementChild, logo);
                    }
                }
            }
        } catch (err) {
            // Silently ignore — non-critical
            console.warn('Could not check DB status:', err.message);
        }
    }

    // ===================================================================
    // View Switching
    // ===================================================================
    function showView(view) {
        document.getElementById('loginView').style.display = view === 'login' ? 'block' : 'none';
        document.getElementById('registerView').style.display = view === 'register' ? 'block' : 'none';
        document.getElementById('forgotPasswordView').style.display = view === 'forgot' ? 'block' : 'none';

        const title = document.getElementById('formTitle');
        const subtitle = document.getElementById('formSubtitle');

        if (view === 'register') {
            title.textContent = 'Create Account';
            subtitle.textContent = 'Register a new user account';
            document.getElementById('regUsername').focus();
        } else if (view === 'forgot') {
            title.textContent = 'Reset Password';
            subtitle.textContent = 'Reset your account password';
            document.getElementById('resetUsername').focus();
        } else {
            title.textContent = 'Godhuli Dairy Plant';
            subtitle.textContent = 'Accounts & Stock Management System';
            document.getElementById('username').focus();
        }
    }

    // Register/forgot-password links (may be disabled/modified in UI)
    const registerLink = document.getElementById('registerLink');
    if (registerLink) {
        registerLink.addEventListener('click', (e) => {
            e.preventDefault();
            showView('register');
        });
    }

    const forgotPasswordLink = document.getElementById('forgotPasswordLink');
    if (forgotPasswordLink) {
        forgotPasswordLink.addEventListener('click', (e) => {
            e.preventDefault();
            showView('forgot');
        });
    }

    const backFromRegister = document.getElementById('backToLoginFromRegister');
    if (backFromRegister) {
        backFromRegister.addEventListener('click', (e) => {
            e.preventDefault();
            showView('login');
        });
    }

    const backFromReset = document.getElementById('backToLoginFromReset');
    if (backFromReset) {
        backFromReset.addEventListener('click', (e) => {
            e.preventDefault();
            showView('login');
        });
    }

    // ===================================================================
    // LOGIN FORM
    // ===================================================================
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const btnText = loginBtn.querySelector('.login-btn-text');
    const spinner = loginBtn.querySelector('.login-btn-spinner');
    const errorEl = document.getElementById('loginError');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();

        if (!username || !password) {
            showError(errorEl, 'Please enter both username and password');
            return;
        }

        // Show loading state
        setLoading(loginBtn, btnText, spinner, true);
        errorEl.style.display = 'none';

        try {
            const response = await fetch(`${API_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();

            if (result.success) {
                // Server set the HttpOnly cookie. Just redirect.
                if (result.data && result.data.mustChangePassword) {
                    showError(errorEl, '⚠ Default password in use. Please change it in Settings → Users after login.');
                    errorEl.className = 'login-success';
                }
                window.location.href = '/';
            } else {
                showError(errorEl, result.error || 'Invalid username or password');
            }
        } catch (err) {
            const errorMsg = err.message || String(err);
            showError(errorEl, 'Connection error: ' + errorMsg);
            console.error('Login error:', err);
        } finally {
            setLoading(loginBtn, btnText, spinner, false);
        }
    });

    // Allow pressing Enter to submit login
    document.getElementById('password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });

    // ===================================================================
    // REGISTER FORM
    // ===================================================================
    const registerForm = document.getElementById('registerForm');
    const registerBtn = document.getElementById('registerBtn');
    const regBtnText = registerBtn.querySelector('.login-btn-text');
    const regSpinner = registerBtn.querySelector('.login-btn-spinner');
    const regErrorEl = document.getElementById('registerError');

    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value.trim();

        if (!username || !password) {
            showError(regErrorEl, 'Please enter both username and password');
            return;
        }
        if (username.length < 3) {
            showError(regErrorEl, 'Username must be at least 3 characters');
            return;
        }
        if (password.length < 4) {
            showError(regErrorEl, 'Password must be at least 4 characters');
            return;
        }

        setLoading(registerBtn, regBtnText, regSpinner, true);
        regErrorEl.style.display = 'none';

        try {
            const response = await fetch(`${API_BASE}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const result = await response.json();

            if (result.success) {
                // Registration successful and auto-logged in
                window.location.href = '/';
            } else {
                showError(regErrorEl, result.error || 'Registration failed');
            }
        } catch (err) {
            showError(regErrorEl, 'Connection error: ' + (err.message || String(err)));
        } finally {
            setLoading(registerBtn, regBtnText, regSpinner, false);
        }
    });

    // Allow pressing Enter to submit registration
    document.getElementById('regPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') registerForm.dispatchEvent(new Event('submit'));
    });

    // ===================================================================
    // FORGOT PASSWORD FORM
    // ===================================================================
    const resetForm = document.getElementById('forgotPasswordForm');
    const resetBtn = document.getElementById('resetBtn');
    const resetBtnText = resetBtn.querySelector('.login-btn-text');
    const resetSpinner = resetBtn.querySelector('.login-btn-spinner');
    const resetErrorEl = document.getElementById('resetError');

    resetForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('resetUsername').value.trim();
        const newPassword = document.getElementById('resetPassword').value.trim();

        if (!username || !newPassword) {
            showError(resetErrorEl, 'Please enter both username and new password');
            return;
        }
        if (newPassword.length < 4) {
            showError(resetErrorEl, 'New password must be at least 4 characters');
            return;
        }

        setLoading(resetBtn, resetBtnText, resetSpinner, true);
        resetErrorEl.style.display = 'none';

        try {
            const response = await fetch(`${API_BASE}/auth/reset-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, newPassword })
            });

            const result = await response.json();

            if (result.success) {
                // Show success, then redirect to login view
                resetErrorEl.className = 'login-success';
                resetErrorEl.textContent = result.data?.message || 'Password reset successfully! Redirecting to login...';
                resetErrorEl.style.display = 'block';

                setTimeout(() => {
                    // Clear form
                    document.getElementById('resetUsername').value = '';
                    document.getElementById('resetPassword').value = '';
                    showView('login');
                    // Show a success message on the login form
                    const loginError = document.getElementById('loginError');
                    loginError.className = 'login-success';
                    loginError.textContent = 'Password reset successfully! Please login with your new password.';
                    loginError.style.display = 'block';
                }, 2000);
            } else {
                showError(resetErrorEl, result.error || 'Password reset failed');
            }
        } catch (err) {
            showError(resetErrorEl, 'Connection error: ' + (err.message || String(err)));
        } finally {
            setLoading(resetBtn, resetBtnText, resetSpinner, false);
        }
    });

    // Allow pressing Enter to submit reset
    document.getElementById('resetPassword').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') resetForm.dispatchEvent(new Event('submit'));
    });

    // ===================================================================
    // Utility Functions
    // ===================================================================

    function setLoading(btn, btnTextEl, spinnerEl, loading) {
        btn.disabled = loading;
        btnTextEl.style.display = loading ? 'none' : 'inline';
        spinnerEl.style.display = loading ? 'inline-flex' : 'none';
    }

    function showError(el, msg) {
        el.className = 'login-error';
        el.textContent = msg;
        el.style.display = 'block';
    }
});
