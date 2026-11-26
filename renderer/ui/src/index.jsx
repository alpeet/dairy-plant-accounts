import { createRoot } from 'react-dom/client';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';

/**
 * Mount points for the React layer.
 *   #appSidebar  — app shell navigation (all existing modules preserved)
 *   #page-dashboard — Dashboard screen, mounted by renderer/js/dashboard.js
 *
 * Every other screen stays exactly as it is: plain DOM rendered by its own
 * module. React is only the shell + dashboard, so no accounting workflow
 * changes hands.
 */

const roots = new WeakMap();
let dashboardRun = 0;

function mountSidebar() {
    const host = document.getElementById('appSidebar');
    if (!host || roots.has(host)) return;
    // Apply the saved width before the first paint so a collapsed sidebar does
    // not flash open for a frame.
    try {
        if (localStorage.getItem('ui.sidebarCollapsed') === '1') {
            host.classList.add('is-collapsed');
            document.body.classList.add('ui-sidebar-collapsed');
        }
    } catch (e) { /* storage unavailable — keep expanded */ }
    const root = createRoot(host);
    roots.set(host, root);
    root.render(<Sidebar />);
}

export function mountDashboard(container) {
    if (!container) return Promise.resolve();
    let root = roots.get(container);
    if (!root) {
        root = createRoot(container);
        roots.set(container, root);
    }
    dashboardRun += 1;
    root.render(<Dashboard key={dashboardRun} />);
    return Promise.resolve();
}

window.__mountDashboard = mountDashboard;

function boot() {
    mountSidebar();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
