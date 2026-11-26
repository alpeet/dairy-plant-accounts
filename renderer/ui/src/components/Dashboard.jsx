import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
    ShoppingCart, Package, Users, TrendingUp, Wallet, Landmark, Scale,
    Boxes, AlertTriangle, ArrowRight, RefreshCw, Search, X, Milk,
    ReceiptText, Banknote, CircleDollarSign
} from 'lucide-react';
import KpiCard from './KpiCard';
import RevenueChart from './RevenueChart';
import ExpenseDonut from './ExpenseDonut';
import { money, num } from '../format';

async function call(fn, fallback) {
    try {
        const res = await fn();
        return res && res.success ? res.data : fallback;
    } catch (e) {
        return fallback;
    }
}

function dashboardToday() {
    try {
        if (typeof window.todayBS === 'function') return window.todayBS();
        if (typeof window.today === 'function') return window.today();
    } catch (e) { /* fall through */ }
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function useDashboardData() {
    const [state, setState] = useState({ loading: true, error: null, data: null });

    const load = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: !prev.data, error: null }));
        try {
            const [dash, milk, today] = await Promise.all([
                window.api.getDashboard(),
                call(() => window.api.getMilkSummary({ date: dashboardToday() }), null),
                call(() => window.api.getTodaySummary(), null)
            ]);
            if (!dash || !dash.success) {
                throw new Error((dash && dash.error) || 'Dashboard data could not be loaded');
            }
            setState({ loading: false, error: null, data: { d: dash.data, milk, today } });
        } catch (err) {
            setState({ loading: false, error: err.message || String(err), data: null });
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    return { ...state, reload: load };
}

function SectionLink({ onClick, children }) {
    return (
        <button type="button" className="panel-link" onClick={onClick}>
            {children} <ArrowRight size={13} />
        </button>
    );
}

function go(page) {
    if (typeof window.navigateTo === 'function') window.navigateTo(page);
}

function Balances({ d, analytics }) {
    const cashBank = analytics.cash_bank || null;
    const rows = [
        { label: 'Cash in hand', value: cashBank ? cashBank.cash : null, icon: Wallet, page: 'cash' },
        { label: 'Bank balance', value: cashBank ? cashBank.bank : null, icon: Landmark, page: 'bank' },
        { label: 'Receivable', value: d.receivables ? d.receivables.total : 0, icon: Users, page: 'receivable-payable' },
        { label: 'Payable', value: d.payables ? d.payables.total : 0, icon: Scale, page: 'receivable-payable' }
    ];
    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">Balances</h2>
                    <p className="panel-sub">Live position from the ledger</p>
                </div>
                <SectionLink onClick={() => go('receivable-payable')}>Details</SectionLink>
            </header>
            <ul className="bal-list">
                {rows.map((row) => {
                    const Icon = row.icon;
                    return (
                        <li key={row.label}>
                            <button type="button" className="bal-row" onClick={() => go(row.page)}>
                                <span className="bal-icon"><Icon size={16} strokeWidth={1.9} /></span>
                                <span className="bal-label">{row.label}</span>
                                <span className={`bal-value ${Number(row.value) < 0 ? 'is-neg' : ''}`}>
                                    {row.value === null ? '—' : money(row.value)}
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
            {analytics.cash_bank && (
                <div className="bal-foot">
                    Total liquid position <b>{money((analytics.cash_bank.cash || 0) + (analytics.cash_bank.bank || 0))}</b>
                </div>
            )}
        </section>
    );
}

function StockOverview({ stock, lowStock }) {
    const items = lowStock || [];
    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">Stock overview</h2>
                    <p className="panel-sub">Closing balance replayed from movements</p>
                </div>
                <SectionLink onClick={() => go('stock')}>Stock</SectionLink>
            </header>
            <div className="stock-stats">
                <div className="stock-stat">
                    <span className="stock-ico"><Boxes size={16} /></span>
                    <div>
                        <span className="stock-label">Products</span>
                        <span className="stock-value">{num(stock.product_count)}</span>
                    </div>
                </div>
                <div className="stock-stat">
                    <span className="stock-ico"><CircleDollarSign size={16} /></span>
                    <div>
                        <span className="stock-label">Stock value</span>
                        <span className="stock-value">{money(stock.stock_value)}</span>
                    </div>
                </div>
            </div>
            {items.length > 0 ? (
                <div className="stock-alert">
                    <div className="stock-alert-head"><AlertTriangle size={14} /> {items.length} item(s) at or below reorder level</div>
                    <ul>
                        {items.slice(0, 4).map((item) => (
                            <li key={item.name}>
                                <span>{item.name}</span>
                                <span>{num(item.current_stock, 2)} {item.unit} <i>/ {num(item.reorder_level, 2)}</i></span>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : (
                <p className="stock-ok">All stock levels are above their reorder points.</p>
            )}
        </section>
    );
}

function RecentList({ title, rows, kind }) {
    const open = (row) => {
        if (kind === 'sale' && typeof window.viewSaleDetail === 'function') return window.viewSaleDetail(row.id);
        if (kind === 'purchase' && typeof window.viewPurchaseDetail === 'function') return window.viewPurchaseDetail(row.id);
    };
    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">{title}</h2>
                    <p className="panel-sub">Latest recorded documents</p>
                </div>
                <SectionLink onClick={() => go(kind === 'sale' ? 'sales' : 'purchases')}>Open module</SectionLink>
            </header>
            {(!rows || rows.length === 0) ? (
                <p className="panel-empty">Nothing recorded yet.</p>
            ) : (
                <ul className="recent-list">
                    {rows.map((row) => (
                        <li key={`${kind}-${row.id}`}>
                            <button type="button" className="recent-row" onClick={() => open(row)}>
                                <span className="recent-main">
                                    <span className="recent-ref">{row.ref_no || `#${row.id}`}</span>
                                    <span className="recent-party">{row.party_name || '—'}</span>
                                </span>
                                <span className="recent-meta">
                                    <span className="recent-date">{row.date}</span>
                                    <span className={`chip chip-${row.status || 'unpaid'}`}>{row.status || '—'}</span>
                                </span>
                                <span className="recent-amount">{money(row.grand_total)}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function QuickSearch() {
    const [query, setQuery] = useState('');
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) { setResult(null); setBusy(false); return; }
        setBusy(true);
        const timer = setTimeout(async () => {
            try {
                const res = await window.api.globalSearch({ query: q });
                setResult(res && res.success ? res.data : null);
            } catch (e) {
                setResult(null);
            } finally {
                setBusy(false);
            }
        }, 320);
        return () => clearTimeout(timer);
    }, [query]);

    const rows = [];
    if (result && result.groups) {
        for (const group of result.groups) {
            for (const row of group.rows || []) {
                rows.push({ ...row, group: group.label, page: group.page, type: group.type });
                if (rows.length >= 7) break;
            }
            if (rows.length >= 7) break;
        }
    }

    const pick = (row) => {
        setOpen(false);
        if (row.type === 'sale' && typeof window.viewSaleDetail === 'function') return window.viewSaleDetail(row.id);
        if (row.type === 'purchase' && typeof window.viewPurchaseDetail === 'function') return window.viewPurchaseDetail(row.id);
        if ((row.type === 'party' || row.type === 'ledger') && typeof window.viewLedger === 'function') return window.viewLedger(row.id);
        if (row.page) go(row.page);
    };

    return (
        <div className={`quick-search ${open ? 'is-open' : ''}`}>
            <span className="qs-icon">{busy ? <RefreshCw size={15} className="spin" /> : <Search size={15} />}</span>
            <input
                type="text"
                value={query}
                placeholder="Search invoice, party, product…"
                aria-label="Global search"
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setOpen(false); } }}
            />
            {query && (
                <button type="button" className="qs-clear" aria-label="Clear search" onClick={() => { setQuery(''); setOpen(false); }}>
                    <X size={14} />
                </button>
            )}
            {open && query.trim().length >= 2 && (
                <div className="qs-results">
                    {rows.length === 0 && !busy && <div className="qs-empty">No matches for “{query.trim()}”.</div>}
                    {rows.map((row) => (
                        <button type="button" key={`${row.type}-${row.id}`} className="qs-row" onClick={() => pick(row)}>
                            <span className="qs-row-main">
                                <b>{row.title || row.ref_no || `#${row.id}`}</b>
                                <small>{row.subtitle || row.group || ''}</small>
                            </span>
                            <span className="qs-row-amount">{row.amount != null ? money(row.amount) : ''}</span>
                        </button>
                    ))}
                    {result && result.total > rows.length && (
                        <div className="qs-more">+{result.total - rows.length} more — open the owning module</div>
                    )}
                </div>
            )}
        </div>
    );
}

function TodayStrip({ d, milk, today }) {
    const milkLiters = milk && milk.todayTotal ? milk.todayTotal.total_liters : 0;
    const stats = [
        { label: 'Milk today', value: `${num(milkLiters, 1)} L`, icon: Milk, page: 'milk' },
        { label: 'Cash received', value: money(d.todaySales ? d.todaySales.paid : 0), icon: Banknote, page: 'cash-collection' },
        { label: 'Purchases today', value: money(d.todayPurchases ? d.todayPurchases.total : 0), icon: Package, page: 'purchases' },
        { label: 'Expenses today', value: money(today && today.todayExpenses ? today.todayExpenses.total : (d.cashPosition ? d.cashPosition.expenses : 0)), icon: ReceiptText, page: 'expenses' }
    ];
    return (
        <div className="today-strip">
            {stats.map((s) => {
                const Icon = s.icon;
                return (
                    <button type="button" key={s.label} className="today-item" onClick={() => go(s.page)}>
                        <span className="today-ico"><Icon size={15} strokeWidth={1.9} /></span>
                        <span className="today-text">
                            <span className="today-label">{s.label}</span>
                            <span className="today-value">{s.value}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

export default function Dashboard() {
    const { loading, error, data, reload } = useDashboardData();
    const reduce = useReducedMotion();

    if (loading && !data) {
        return (
            <div className="dash-shell">
                <div className="dash-skeleton">
                    <div className="sk-row">{Array.from({ length: 4 }).map((_, i) => <div className="sk sk-kpi" key={i} />)}</div>
                    <div className="sk sk-chart" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="dash-shell">
                <div className="panel dash-error">
                    <h2 className="panel-title">Dashboard could not load</h2>
                    <p className="panel-sub">{error}</p>
                    <button type="button" className="btn btn-primary btn-sm" onClick={reload}>
                        <RefreshCw size={14} /> Retry
                    </button>
                </div>
            </div>
        );
    }

    const { d, milk, today } = data;
    const a = d.analytics || {};
    const totals = a.totals || {};
    const previous = (a.kpi && a.kpi.previous) || {};
    const rolling = (a.kpi && a.kpi.current) || {};
    const ps = d.profitSnapshot || {};
    const monthLabel = (a.month && a.month.label) || 'This month';
    const kpiLabel = 'Last 90 days';

    const kpis = [
        {
            key: 'sales',
            label: 'Total Sales',
            value: rolling.sales != null ? rolling.sales : (ps.revenue || 0),
            previous: previous.sales != null ? previous.sales : null,
            icon: ShoppingCart,
            tone: 'indigo',
            page: 'sales',
            note: kpiLabel,
            sub: `Today ${money(d.todaySales ? d.todaySales.total : 0)}`
        },
        {
            key: 'purchases',
            label: 'Total Purchases',
            value: rolling.purchases_bills != null ? rolling.purchases_bills : (d.todayPurchases ? d.todayPurchases.total : 0),
            previous: previous.purchases_bills != null ? previous.purchases_bills : null,
            icon: Package,
            tone: 'sky',
            page: 'purchases',
            note: kpiLabel,
            sub: `Today ${money(d.todayPurchases ? d.todayPurchases.total : 0)}`,
            goodWhenUp: false
        },
        {
            key: 'receivables',
            label: 'Total Receivables',
            value: d.receivables ? d.receivables.total : 0,
            previous: null,
            icon: Users,
            tone: 'amber',
            page: 'receivable-payable',
            note: 'Outstanding',
            sub: `Payable ${money(d.payables ? d.payables.total : 0)}`
        },
        {
            key: 'profit',
            label: 'Net Profit / Loss',
            value: rolling.net_profit != null ? rolling.net_profit : (ps.net_profit || 0),
            previous: previous.net_profit != null ? previous.net_profit : null,
            icon: TrendingUp,
            tone: (rolling.net_profit != null ? rolling.net_profit : ps.net_profit) >= 0 ? 'emerald' : 'rose',
            page: 'profit-loss',
            note: `${kpiLabel} · P&L`,
            sub: `OpEx ${money(ps.operating_expenses != null ? ps.operating_expenses : ps.total_expenses || 0)}`
        }
    ];

    const fade = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

    return (
        <div className="dash-shell">
            <div className="dash-toolbar">
                <div className="dash-toolbar-text">
                    <span className="dash-eyebrow">Financial overview</span>
                    <span className="dash-period">{kpiLabel} vs the previous 90 days · {monthLabel} expenses</span>
                </div>
                <div className="dash-toolbar-actions">
                    <QuickSearch />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={reload} disabled={loading}>
                        <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            <div className="kpi-row">
                {kpis.map((kpi, i) => <KpiCard key={kpi.key} kpi={kpi} index={i} />)}
            </div>

            <TodayStrip d={d} milk={milk} today={today} />

            <div className="dash-grid dash-grid-main">
                <RevenueChart daily={a.daily} />
                <Balances d={d} analytics={a} />
            </div>

            <div className="dash-grid dash-grid-3">
                <ExpenseDonut heads={a.expense_heads} monthLabel={monthLabel} />
                <StockOverview stock={d.stockSummary || { product_count: 0, stock_value: 0 }} lowStock={d.lowStock} />
                <TopParties d={d} />
            </div>

            <div className="dash-grid dash-grid-2">
                <RecentList title="Recent sales" rows={a.recent_sales} kind="sale" />
                <RecentList title="Recent purchases" rows={a.recent_purchases} kind="purchase" />
            </div>

            <motion.p className="dash-footnote" {...fade} transition={{ duration: reduce ? 0 : 0.4 }}>
                Figures come from the same operations modules that back Sales, Purchases, Cash &amp; Bank and the
                Profit &amp; Loss report — this screen only presents them.
            </motion.p>
        </div>
    );
}

function TopParties({ d }) {
    const topCustomer = d.topCustomer || { name: '—', total: 0 };
    const topSupplier = d.topSupplier || { name: '—', total: 0 };
    return (
        <section className="panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">Top performers</h2>
                    <p className="panel-sub">By lifetime invoice value</p>
                </div>
                <SectionLink onClick={() => go('parties')}>Parties</SectionLink>
            </header>
            <ul className="top-list">
                <li>
                    <span className="top-tag">Customer</span>
                    <span className="top-name">{topCustomer.name}</span>
                    <span className="top-value">{money(topCustomer.total)}</span>
                </li>
                <li>
                    <span className="top-tag alt">Supplier</span>
                    <span className="top-name">{topSupplier.name}</span>
                    <span className="top-value">{money(topSupplier.total)}</span>
                </li>
            </ul>
        </section>
    );
}
