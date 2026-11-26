/**
 * Dashboard Module — React mount bridge
 * =====================================
 * The Dashboard UI (KPI cards, revenue chart, balances, recent documents) is
 * rendered by renderer/js/ui.bundle.js — React + Motion + lucide icons, built
 * from renderer/ui/src by `npm run build:ui`.
 *
 * This file keeps the parts other modules already depend on:
 *   · getSettingsCached() / clearSettingsCache()  — used by sales, purchases,
 *     stock, party, invoice and settings screens
 *   · viewTransactionDetail()                     — sale/purchase drill-down
 *
 * No accounting logic lives here, before or after the redesign.
 */

async function renderDashboard() {
    const container = document.getElementById('page-dashboard');
    if (!container) return;

    if (typeof window.__mountDashboard === 'function') {
        try {
            await window.__mountDashboard(container);
            return;
        } catch (err) {
            console.error('Dashboard UI failed to mount:', err);
        }
    }

    // The bundle is committed alongside the app; this only shows if a build
    // was skipped. Every other screen keeps working either way.
    container.innerHTML = `
        <div class="card">
            <h2 class="card-header" style="border:0;margin:0;padding:0">Dashboard UI unavailable</h2>
            <p style="color:var(--text-light);font-size:13px;margin-top:8px">
                renderer/js/ui.bundle.js could not be loaded. Run <code>npm run build:ui</code>
                to rebuild it. All accounting modules are unaffected.
            </p>
        </div>`;
}

/** Open a sale or purchase from a dashboard/search row. */
async function viewTransactionDetail(type, id) {
    if (type === 'sale' && typeof window.viewSaleDetail === 'function') {
        await window.viewSaleDetail(id);
    } else if (typeof window.viewPurchaseDetail === 'function') {
        await window.viewPurchaseDetail(id);
    }
}

window.viewTransactionDetail = viewTransactionDetail;
window.renderDashboard = renderDashboard;

// Cache for settings — shared by the module screens listed above.
let _settingsCache = null;

async function getSettingsCached() {
    if (_settingsCache) return _settingsCache;
    const result = await window.api.getSettings();
    if (result.success) {
        _settingsCache = result.data;
        return result.data;
    }
    return {};
}

function clearSettingsCache() {
    _settingsCache = null;
}
