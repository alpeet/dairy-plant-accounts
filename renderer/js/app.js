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
    'profit-loss': renderFinancialReports,
    'receivable-payable': showReceivablePayable,
    'cash-collection': showCashCollectionPage,
    'cash-deposit': renderCashDeposit,
    daybook: showDaybookPage,
    'stock-statement': showStockStatement,
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
    'profit-loss': 'Profit & Loss',
    'receivable-payable': 'Receivable / Payable',
    'cash-collection': 'Cash Collection',
    'cash-deposit': 'Cash Deposit',
    daybook: 'Daybook',
    'stock-statement': 'Stock Statement',
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

    // Apply role-based visibility after a short delay to ensure auth info is loaded
    setTimeout(applyRoleBasedVisibility, 200);
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

// Make navigateTo globally accessible
window.navigateTo = navigateTo;

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
