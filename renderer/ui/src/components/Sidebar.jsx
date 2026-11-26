import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
    LayoutDashboard, Receipt, FileText, PackageSearch, Milk, Zap, HandCoins,
    CreditCard, Factory, Calculator, Settings2, Boxes, ClipboardList, Users,
    Route, LineChart, UserCog, ReceiptText, Wallet, Banknote, Truck, Coins,
    Landmark, Building2, ScrollText, BookOpen, CalendarDays, Scale, Sprout,
    Hourglass, Handshake, BarChart3, FileSpreadsheet, TrendingUp, Presentation,
    CalendarRange, Settings, Database, Stethoscope, History, LifeBuoy, LogOut,
    PanelLeftClose, PanelLeftOpen, ChevronRight, MilkOff
} from 'lucide-react';
import { NAV_GROUPS, ROLE_HIERARCHY } from '../nav';

const ICONS = {
    LayoutDashboard, Receipt, FileText, PackageSearch, Milk, Zap, HandCoins,
    CreditCard, Factory, Calculator, Settings2, Boxes, ClipboardList, Users,
    Route, LineChart, UserCog, ReceiptText, Wallet, Banknote, Truck, Coins,
    Landmark, Building2, ScrollText, BookOpen, CalendarDays, Scale, Sprout,
    Hourglass, Handshake, BarChart3, FileSpreadsheet, TrendingUp, Presentation,
    CalendarRange, Settings, Database, Stethoscope, History, LifeBuoy
};

const STORE_COLLAPSED = 'ui.sidebarCollapsed';
const STORE_GROUPS = 'ui.sidebarGroups';

/** True while the viewport is in the drawer layout (matches saas.css). */
function useIsMobile() {
    const query = '(max-width: 900px)';
    const [isMobile, setIsMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(query).matches
    );
    useEffect(() => {
        const mq = window.matchMedia(query);
        const onChange = (e) => setIsMobile(e.matches);
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else mq.addListener(onChange);
        return () => {
            if (mq.removeEventListener) mq.removeEventListener('change', onChange);
            else mq.removeListener(onChange);
        };
    }, []);
    return isMobile;
}

function readJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota — ignore */ }
}

/** Role gate — same rule as app.js applyRoleBasedVisibility(). */
function isAllowed(item) {
    const user = window._currentUser;
    if (!user || !user.role) return true; // unknown role: show everything
    const level = ROLE_HIERARCHY[user.role];
    const min = ROLE_HIERARCHY[item.role];
    if (level === undefined || min === undefined) return true;
    return level >= min;
}

export default function Sidebar() {
    const reduce = useReducedMotion();
    const isMobile = useIsMobile();
    const host = typeof document !== 'undefined' ? document.getElementById('appSidebar') : null;
    const [collapsed, setCollapsed] = useState(() => {
        try { return localStorage.getItem(STORE_COLLAPSED) === '1'; } catch (e) { return false; }
    });
    const [mobileOpen, setMobileOpen] = useState(false);
    const [active, setActive] = useState(
        () => (document.querySelector('.nav-item.active') || {}).dataset?.page || 'dashboard'
    );
    const [closedGroups, setClosedGroups] = useState(() => readJSON(STORE_GROUPS, {}));
    const [version, setVersion] = useState('');

    // Keep the host <nav> classes in sync so layout CSS can react to the state.
    useEffect(() => {
        if (!host) return;
        host.classList.toggle('is-collapsed', collapsed);
        document.body.classList.toggle('ui-sidebar-collapsed', collapsed);
    }, [host, collapsed]);

    useEffect(() => {
        if (!host) return;
        host.classList.toggle('is-mobile-open', mobileOpen);
        document.body.classList.toggle('ui-mobile-nav', mobileOpen);
        return () => document.body.classList.remove('ui-mobile-nav');
    }, [host, mobileOpen]);

    // app.js dispatches ui:page on every navigation, including dashboard
    // deep links that call navigateTo() from another module.
    useEffect(() => {
        const onPage = (e) => {
            if (!e || !e.detail) return;
            setActive(e.detail);
            setMobileOpen(false);
            setClosedGroups((prev) => {
                const group = NAV_GROUPS.find((g) => g.items.some((i) => i.page === e.detail));
                if (!group || !prev[group.id]) return prev;
                const next = { ...prev, [group.id]: false };
                writeJSON(STORE_GROUPS, next);
                return next;
            });
            // A collapsed group hiding the active page would look like a dead link.
            const list = host && host.querySelector('.nav-scroll');
            if (list) list.scrollTop = Math.max(0, list.scrollTop);
        };
        window.addEventListener('ui:page', onPage);
        return () => window.removeEventListener('ui:page', onPage);
    }, [host]);

    useEffect(() => {
        window.__uiToggleSidebar = () => {
            // Below 900px the same control opens the drawer instead.
            if (window.matchMedia('(max-width: 900px)').matches) setMobileOpen((v) => !v);
            else setCollapsed((v) => !v);
        };
        window.__uiCloseMobileNav = () => setMobileOpen(false);
        return () => {
            delete window.__uiToggleSidebar;
            delete window.__uiCloseMobileNav;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await window.api.getAppVersion();
                let v = '';
                if (typeof res === 'string') v = res;
                else if (res && res.success) v = typeof res.data === 'string' ? res.data : (res.data && res.data.version) || '';
                else if (res && res.data) v = typeof res.data === 'string' ? res.data : res.data.version || '';
                if (!cancelled) setVersion(v || '');
            } catch (e) { /* version label is optional */ }
        })();
        return () => { cancelled = true; };
    }, []);

    const toggleCollapsed = () => setCollapsed((v) => {
        const next = !v;
        try { localStorage.setItem(STORE_COLLAPSED, next ? '1' : '0'); } catch (e) { /* ignore */ }
        return next;
    });

    const toggleGroup = (id) => setClosedGroups((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        writeJSON(STORE_GROUPS, next);
        return next;
    });

    // On the drawer layout the sidebar always shows its labels, whatever the
    // stored desktop preference is.
    const compact = collapsed && !isMobile;

    const groups = useMemo(
        () => NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(isAllowed) })).filter((g) => g.items.length > 0),
        []
    );

    const spring = reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 };
    const go = (page) => {
        if (typeof window.navigateTo === 'function') window.navigateTo(page);
        else window.location.hash = page;
    };

    return (
        <>
            <div className="sb-head">
                <div className="sb-brand">
                    <img className="sb-logo" src="favicon.png" alt="" width="30" height="30" />
                    {!compact && (
                    <div className="sb-brand-text">
                        <span className="sb-name">Prarambha</span>
                        <span className="sb-sub">Accounts &amp; Stock</span>
                    </div>
                )}
                </div>
                <button
                    type="button"
                    className="sb-collapse"
                    onClick={toggleCollapsed}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-expanded={!collapsed}
                >
                    {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                </button>
            </div>

            <div className="nav-scroll">
                {groups.map((group) => {
                    const closed = !!closedGroups[group.id];
                    return (
                        <div className={`sb-group ${closed && !compact ? 'is-closed' : ''}`} key={group.id}>
                            {!compact && (
                                <button
                                    type="button"
                                    className="sb-group-head"
                                    onClick={() => toggleGroup(group.id)}
                                    aria-expanded={!closed}
                                >
                                    <span>{group.label}</span>
                                    <ChevronRight size={13} className={`sb-chevron ${closed ? 'is-closed' : ''}`} />
                                </button>
                            )}
                            {compact && <div className="sb-divider" aria-hidden="true" />}
                            <AnimatePresence initial={false}>
                                {(compact || !closed) && (
                                    <motion.ul
                                        className="sb-items"
                                        initial={reduce ? false : { height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={reduce ? { opacity: 1 } : { height: 0, opacity: 0 }}
                                        transition={{ duration: reduce ? 0 : 0.18, ease: 'easeOut' }}
                                    >
                                        {group.items.map((item) => {
                                            const Icon = ICONS[item.icon] || LayoutDashboard;
                                            const isActive = active === item.page;
                                            return (
                                                <li key={item.page}>
                                                    <button
                                                        type="button"
                                                        className={`nav-item ${isActive ? 'active' : ''}`}
                                                        data-page={item.page}
                                                        data-min-role={item.role}
                                                        title={compact ? item.label : undefined}
                                                        aria-current={isActive ? 'page' : undefined}
                                                        onClick={() => go(item.page)}
                                                    >
                                                        {isActive && !reduce && (
                                                            <motion.span
                                                                layoutId="sidebar-active-pill"
                                                                className="sb-active-pill"
                                                                transition={spring}
                                                            />
                                                        )}
                                                        <span className="nav-icon"><Icon size={17} strokeWidth={1.9} /></span>
                                                        {!compact && <span className="nav-text">{item.label}</span>}
                                                        {compact && <span className="sb-tip">{item.label}</span>}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </motion.ul>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>

            <div className="sb-foot">
                {!compact && (
                    <div className="sb-version">
                        Prarambha Accounts{version ? ` v${version}` : ''}
                    </div>
                )}
                <button
                    type="button"
                    className="sb-logout"
                    onClick={() => (typeof window.logout === 'function' ? window.logout() : null)}
                    title="Logout"
                >
                    <span className="nav-icon"><LogOut size={17} strokeWidth={1.9} /></span>
                    {!compact && <span className="nav-text">Logout</span>}
                    {compact && <span className="sb-tip">Logout</span>}
                </button>
            </div>
        </>
    );
}
