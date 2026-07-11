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
    reports: renderReports,
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
    reports: 'Reports',
    settings: 'Settings'
};

let currentPage = 'dashboard';

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
});

function navigateTo(page) {
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
