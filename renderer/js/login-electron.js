/**
 * Prarambha Account & Stock Management — Desktop Login / First-Run Setup
 * ===================================================
 * Works only inside the Electron app via window.api (IPC).
 *
 * - First run  → show the "Create Admin Account" setup screen.
 * - Subsequent → show the login screen (session lives in the main process).
 * - There are NO default credentials on the desktop app.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // ── If already logged in (e.g. window reopened), jump straight in ──
    try {
        const status = await window.api.getAuthStatus();
        if (status && status.success && status.data.authenticated) {
            window.location.href = 'index.html';
            return;
        }
        const needsSetup = !!(status && status.success && status.data.needsSetup);
        showView(needsSetup ? 'setup' : 'login');
    } catch (err) {
        showView('login');
    }

    // ── View switching ──
    function showView(view) {
        document.getElementById('setupView').style.display = view === 'setup' ? 'block' : 'none';
        document.getElementById('loginView').style.display = view === 'login' ? 'block' : 'none';

        const title = document.getElementById('formTitle');
        const subtitle = document.getElementById('formSubtitle');
        if (view === 'setup') {
            title.textContent = 'Welcome to Prarambha Accounts';
            subtitle.textContent = 'Set up your administrator account';
            document.getElementById('setupUsername').focus();
        } else {
            title.textContent = 'Prarambha Account & Stock Management';
            subtitle.textContent = 'Sign in to continue';
            document.getElementById('username').focus();
        }
    }

    // ── Helpers ──
    function setLoading(btn, btnTextEl, spinnerEl, loading) {
        btn.disabled = loading;
        btnTextEl.style.display = loading ? 'none' : 'inline';
        spinnerEl.style.display = loading ? 'inline-flex' : 'none';
    }

    function showError(el, msg, className) {
        el.className = className || 'login-error';
        el.textContent = msg;
        el.style.display = 'block';
    }

    function hideError(el) {
        el.style.display = 'none';
    }

    // ── Show / hide password toggle ──
    const toggleBtn = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', () => {
            const show = passwordInput.type === 'password';
            passwordInput.type = show ? 'text' : 'password';
            toggleBtn.textContent = show ? '🙈' : '👁';
            toggleBtn.title = show ? 'Hide password' : 'Show password';
            passwordInput.focus();
        });
    }

    // ── FIRST-RUN SETUP ──
    const setupForm = document.getElementById('setupForm');
    const setupBtn = document.getElementById('setupBtn');
    const setupBtnText = setupBtn.querySelector('.login-btn-text');
    const setupSpinner = setupBtn.querySelector('.login-btn-spinner');
    const setupErrorEl = document.getElementById('setupError');

    setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('setupUsername').value.trim();
        const password = document.getElementById('setupPassword').value;
        const confirm = document.getElementById('setupConfirm').value;

        if (username.length < 3) {
            showError(setupErrorEl, 'Username must be at least 3 characters.');
            return;
        }
        if (password.length < 4) {
            showError(setupErrorEl, 'Password must be at least 4 characters.');
            return;
        }
        if (password !== confirm) {
            showError(setupErrorEl, 'Passwords do not match. Please re-enter.');
            return;
        }

        setLoading(setupBtn, setupBtnText, setupSpinner, true);
        hideError(setupErrorEl);

        try {
            const result = await window.api.setupAdmin({ username, password });
            if (result && result.success) {
                showError(setupErrorEl, '✅ Admin account created! Opening the app...', 'login-success');
                setTimeout(() => { window.location.href = 'index.html'; }, 600);
            } else {
                showError(setupErrorEl, (result && result.error) || 'Setup failed. Please try again.');
                setLoading(setupBtn, setupBtnText, setupSpinner, false);
            }
        } catch (err) {
            showError(setupErrorEl, 'Setup error: ' + (err.message || String(err)));
            setLoading(setupBtn, setupBtnText, setupSpinner, false);
        }
    });

    // Enter key on confirm password submits the setup form
    document.getElementById('setupConfirm').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') setupForm.dispatchEvent(new Event('submit'));
    });

    // ── LOGIN ──
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const loginBtnText = loginBtn.querySelector('.login-btn-text');
    const loginSpinner = loginBtn.querySelector('.login-btn-spinner');
    const loginErrorEl = document.getElementById('loginError');

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showError(loginErrorEl, 'Please enter both username and password.');
            return;
        }

        setLoading(loginBtn, loginBtnText, loginSpinner, true);
        hideError(loginErrorEl);

        try {
            const result = await window.api.login({ username, password });
            if (result && result.success) {
                // Note: if the legacy default password (admin123) is in use,
                // the user is asked to change it right after logging in.
                setTimeout(() => { window.location.href = 'index.html'; }, 300);
            } else {
                const remaining = result ? result.remainingAttempts : undefined;
                const lockoutMin = result ? result.lockoutMinutes : undefined;
                let msg = (result && result.error) || 'Invalid username or password';

                if (lockoutMin) {
                    msg = `🔒 Account temporarily locked. Try again in ${lockoutMin} minute${lockoutMin > 1 ? 's' : ''}.`;
                    showError(loginErrorEl, msg, 'login-error login-error-lockout');
                } else if (remaining !== undefined && remaining <= 3) {
                    if (remaining <= 0) {
                        msg = '⚠ Too many failed attempts. Next attempt will lock your account temporarily.';
                    } else if (remaining === 1) {
                        msg = '⚠ Last attempt before temporary lockout!';
                    }
                    showError(loginErrorEl, msg, remaining <= 1 ? 'login-error login-error-last' : 'login-error login-error-warn');
                } else {
                    showError(loginErrorEl, msg);
                }
                setLoading(loginBtn, loginBtnText, loginSpinner, false);
            }
        } catch (err) {
            showError(loginErrorEl, 'Login error: ' + (err.message || String(err)));
            setLoading(loginBtn, loginBtnText, loginSpinner, false);
        }
    });

    // Enter key on password submits the login form
    passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginForm.dispatchEvent(new Event('submit'));
    });
});
