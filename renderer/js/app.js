/**
 * App Router & Navigation
 * Manages page switching and initializes modules
 */

const pageModules = {
    dashboard: renderDashboard,
    sales: renderSales,
    purchases: renderPurchases,
    milk: renderMilkCollection,
    stock: renderStock,
    parties: renderParties,
    'farmer-payments': renderFarmerPayments,
    routes: renderRoutes,
    reports: renderReports,
    production: renderProduction,
    statements: renderStatements,
    cash: renderCash,
    'petty-cash': renderPettyCash,
    salary: renderSalary,
    vehicle: renderVehicle,
    expenses: renderExpenses,
    'partner-capital': renderPartnerCapital,
    'rate-charts': renderRateCharts,
    'audit-log': renderAuditLog,
    'db-tables': renderDBTables,
    'profit-loss': renderFinancialReports,
    'receivable-payable': showReceivablePayable,
    'cash-collection': showCashCollectionPage,
    'cash-deposit': renderCashDeposit,
    bank: renderBank,
    daybook: showDaybookPage,
    'stock-statement': showStockStatement,
    'user-manual': renderUserManual,
    settings: renderSettings
};

const pageTitles = {
    dashboard: 'Dashboard',
    sales: 'Sales Management',
    purchases: 'Purchase Management',
    milk: 'Milk Collection',
    stock: 'Stock & Inventory',
    parties: 'Party Management',
    'farmer-payments': 'Farmer Payments',
    routes: 'Route / Collection Center Management',
    reports: 'Reports',
    production: 'Production / Batch Processing',
    statements: 'Customer / Supplier Statements',
    cash: 'Cash & Denomination',
    'petty-cash': 'Petty Cash',
    salary: 'Salary / Payroll',
    vehicle: 'Vehicle Expenses',
    expenses: 'Other Expenses',
    'partner-capital': 'Partner Capital Management',
    'rate-charts': 'Milk Rate Chart',
    'audit-log': 'Audit Log',
    'db-tables': 'Database Tables',
    'profit-loss': 'Profit & Loss',
    'receivable-payable': 'Receivable / Payable',
    'cash-collection': 'Payment Collection',
    'cash-deposit': 'Cash Deposit',
    bank: 'Bank Transactions',
    daybook: 'Daybook',
    'stock-statement': 'Stock Statement',
    'user-manual': 'User Manual',
    settings: 'Settings'
};

let currentPage = 'dashboard';

/**
 * Role hierarchy for access control.
 * Higher index = more privileged.
 */
const ROLE_HIERARCHY = {
    'agent': 0,
    'staff': 1,
    'operator': 2,
    'accountant': 3,
    'admin': 4
};

/**
 * Apply role-based visibility to sidebar nav items.
 * Items with data-min-role higher than the current user's role are hidden.
 */
function applyRoleBasedVisibility() {
    const user = window._currentUser;
    if (!user || !user.role) return;

    const userLevel = ROLE_HIERARCHY[user.role] !== undefined ? ROLE_HIERARCHY[user.role] : 0;

    document.querySelectorAll('.nav-item').forEach(item => {
        const minRole = item.dataset.minRole;
        if (minRole) {
            const minLevel = ROLE_HIERARCHY[minRole];
            if (minLevel !== undefined && userLevel < minLevel) {
                item.style.display = 'none';
            } else {
                item.style.display = '';
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Restore nav group collapse states from localStorage
    restoreNavGroupStates();

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            navigateTo(page);
        });
    });

    // Logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.logout === 'function') {
                window.logout();
            }
        });
    }

    // Load initial page
    navigateTo('dashboard');

    // Ensure the active page's group is expanded
    setTimeout(() => {
        expandActiveGroup();
        applyRoleBasedVisibility();
    }, 200);
});

function navigateTo(page) {
    // Re-apply role-based visibility on each navigation
    applyRoleBasedVisibility();
    if (!pageModules[page]) return;

    currentPage = page;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Update title
    document.getElementById('pageTitle').textContent = pageTitles[page] || page;

    // Clear top actions
    document.getElementById('topActions').innerHTML = '';

    // Show page section
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(`page-${page}`);
    if (section) {
        section.classList.add('active');
        // Render module
        pageModules[page]();
    }
}

// ============================================================
// Collapsible Nav Groups
// ============================================================

/**
 * Toggle a nav group between expanded and collapsed.
 * State is persisted in localStorage.
 */
function toggleNavGroup(groupName) {
    const group = document.querySelector(`.nav-group[data-group="${groupName}"]`);
    if (!group) return;

    const isCollapsed = group.classList.toggle('collapsed');
    
    // Persist state
    try {
        const states = JSON.parse(localStorage.getItem('navGroupStates') || '{}');
        states[groupName] = isCollapsed;
        localStorage.setItem('navGroupStates', JSON.stringify(states));
    } catch (e) { /* ignore quota errors */ }
}

/**
 * Restore all nav group collapse states from localStorage.
 * Skips the group containing the active page item to avoid flash.
 */
function restoreNavGroupStates() {
    try {
        // Find the active page's group so we don't collapse it
        const activeItem = document.querySelector('.nav-item.active');
        const activeGroup = activeItem ? activeItem.closest('.nav-group') : null;
        const activeGroupName = activeGroup ? activeGroup.dataset.group : null;

        const states = JSON.parse(localStorage.getItem('navGroupStates') || '{}');
        Object.keys(states).forEach(groupName => {
            if (states[groupName] === true && groupName !== activeGroupName) {
                const group = document.querySelector(`.nav-group[data-group="${groupName}"]`);
                if (group) group.classList.add('collapsed');
            }
        });
    } catch (e) { /* ignore */ }
}

/**
 * Ensure the nav group containing the active page item is expanded.
 */
function expandActiveGroup() {
    const activeItem = document.querySelector('.nav-item.active');
    if (!activeItem) return;
    
    const group = activeItem.closest('.nav-group');
    if (!group) return;
    
    const groupName = group.dataset.group;
    if (!groupName) return;
    
    // Remove collapsed state
    group.classList.remove('collapsed');
    
    // Update localStorage
    try {
        const states = JSON.parse(localStorage.getItem('navGroupStates') || '{}');
        states[groupName] = false;
        localStorage.setItem('navGroupStates', JSON.stringify(states));
    } catch (e) { /* ignore */ }
}

// Make toggleNavGroup globally accessible
window.toggleNavGroup = toggleNavGroup;

// Make navigateTo globally accessible
window.navigateTo = navigateTo;

// ============================================================
// Forced password change (default credential still in use)
// ============================================================

/**
 * Show a blocking, non-dismissable screen that forces the user to change
 * their password before they can use the app. Called when the server reports
 * mustChangePassword (or returns 403 PASSWORD_CHANGE_REQUIRED).
 */
function forcePasswordChange() {
    if (document.getElementById('forcePasswordChangeOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'forcePasswordChangeOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(10,15,30,0.94);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
        <div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.5)">
            <div style="font-size:34px;text-align:center">🔒</div>
            <h2 style="text-align:center;margin:8px 0 6px">Change Your Password</h2>
            <p style="text-align:center;color:#64748b;font-size:13px;margin:0 0 18px">You are using the default password (<strong>admin123</strong>). For security, you must set your own password before using the app.</p>
            <form id="forcePasswordForm">
                <div class="form-group">
                    <label>Current Password</label>
                    <input type="password" class="form-control" name="currentPassword" required autocomplete="current-password" placeholder="Enter current password">
                </div>
                <div class="form-group">
                    <label>New Password</label>
                    <input type="password" class="form-control" name="newPassword" required minlength="4" autocomplete="new-password" placeholder="At least 4 characters">
                </div>
                <div class="form-group">
                    <label>Confirm New Password</label>
                    <input type="password" class="form-control" name="confirmPassword" required minlength="4" autocomplete="new-password" placeholder="Re-enter new password">
                </div>
                <div id="forcePasswordError" style="display:none;margin-top:8px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:13px"></div>
                <button type="submit" id="forcePasswordBtn" class="btn btn-primary" style="width:100%;margin-top:16px">Change Password &amp; Continue</button>
                <button type="button" id="forceLogoutBtn" class="btn btn-secondary" style="width:100%;margin-top:8px">Log out</button>
            </form>
        </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#forceLogoutBtn').addEventListener('click', () => {
        if (typeof window.logout === 'function') window.logout();
    });

    overlay.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const currentPassword = (fd.get('currentPassword') || '').trim();
        const newPassword = (fd.get('newPassword') || '').trim();
        const confirmPassword = (fd.get('confirmPassword') || '').trim();
        const errEl = document.getElementById('forcePasswordError');
        const btn = document.getElementById('forcePasswordBtn');

        if (newPassword !== confirmPassword) {
            errEl.textContent = 'New passwords do not match';
            errEl.style.display = 'block';
            return;
        }
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Changing...';

        try {
            const result = await window.api.changePassword({ currentPassword, newPassword });
            if (result && result.success) {
                // Reload — /api/auth/me now reports mustChangePassword=false
                window.location.reload();
            } else {
                errEl.textContent = (result && result.error) || 'Failed to change password';
                errEl.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Change Password & Continue';
            }
        } catch (err) {
            errEl.textContent = 'Connection error: ' + (err && err.message ? err.message : err);
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Change Password & Continue';
        }
    });
}

window.forcePasswordChange = forcePasswordChange;

// ============================================================
// Error handling wrapper for async operations
// ============================================================
async function safeAsync(fn, errorMsg = 'Operation failed') {
    try {
        return await fn();
    } catch (err) {
        console.error(errorMsg, err);
        showToast(`${errorMsg}: ${err.message}`, 'error');
        return null;
    }
}
