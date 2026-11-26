import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { money, compact, shortBSDate } from '../format';

const PERIODS = [7, 30, 90];
const HEIGHT = 268;
const PAD = { top: 16, right: 16, bottom: 30, left: 52 };

function niceCeil(value) {
    const v = Math.max(1, value);
    const mag = Math.pow(10, Math.floor(Math.log10(v)));
    const step = mag / 2;
    return Math.ceil(v / step) * step;
}

/**
 * Revenue trend from the application's own sales/purchases tables.
 * Revenue is gross invoice value — it is never labelled or treated as profit;
 * the net-profit figure lives on its own KPI card (same P&L engine).
 */
export default function RevenueChart({ daily }) {
    const reduce = useReducedMotion();
    const [period, setPeriod] = useState(90);
    const [width, setWidth] = useState(720);
    const [hover, setHover] = useState(null);
    const wrapRef = useRef(null);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
            if (w > 0) setWidth(Math.round(w));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const points = useMemo(() => (daily || []).slice(-period), [daily, period]);
    const totals = useMemo(() => points.reduce(
        (acc, p) => ({ sales: acc.sales + (p.sales || 0), purchases: acc.purchases + (p.purchases || 0) }),
        { sales: 0, purchases: 0 }
    ), [points]);

    const maxValue = niceCeil(Math.max(1, ...points.map((p) => Math.max(p.sales || 0, p.purchases || 0))));
    const plotW = Math.max(40, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const step = points.length > 1 ? plotW / (points.length - 1) : 0;
    const x = (i) => PAD.left + i * step;
    const y = (v) => PAD.top + (1 - (Number(v) || 0) / maxValue) * plotH;

    const line = (key) => points
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`)
        .join(' ');
    const area = points.length
        ? `${line('sales')} L${x(points.length - 1).toFixed(1)},${PAD.top + plotH} L${x(0).toFixed(1)},${PAD.top + plotH} Z`
        : '';

    const gridValues = [0, 0.25, 0.5, 0.75, 1].map((f) => maxValue * f);
    const labelEvery = Math.max(1, Math.ceil(points.length / 7));

    const onMove = (event) => {
        if (!points.length) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const offset = event.clientX - rect.left;
        const index = Math.min(points.length - 1, Math.max(0, Math.round((offset - PAD.left) / (step || 1))));
        setHover(index);
    };

    const active = hover !== null ? points[hover] : null;

    return (
        <section className="panel chart-panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">Revenue analytics</h2>
                    <p className="panel-sub">Sales invoices vs purchase bills, by Bikram Sambat date</p>
                </div>
                <div className="seg" role="tablist" aria-label="Chart period">
                    {PERIODS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            role="tab"
                            aria-selected={period === p}
                            className={`seg-btn ${period === p ? 'is-on' : ''}`}
                            onClick={() => { setPeriod(p); setHover(null); }}
                        >
                            {period === p && (
                                <motion.span
                                    layoutId="chart-period-pill"
                                    className="seg-pill"
                                    transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                                />
                            )}
                            <span className="seg-label">{p}D</span>
                        </button>
                    ))}
                </div>
            </header>

            <div className="chart-legend">
                <span className="legend-item"><i className="dot dot-sales" /> Revenue <b>{money(totals.sales)}</b></span>
                <span className="legend-item"><i className="dot dot-purchases" /> Purchases <b>{money(totals.purchases)}</b></span>
                <span className="legend-note">Net profit is shown separately — revenue is not profit.</span>
            </div>

            <div className="chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
                <motion.svg
                    key={period}
                    width={width}
                    height={HEIGHT}
                    role="img"
                    aria-label={`Revenue for the last ${period} days`}
                    onMouseMove={onMove}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.35 }}
                >
                    <defs>
                        <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.22" />
                            <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.01" />
                        </linearGradient>
                    </defs>

                    {gridValues.map((v) => (
                        <g key={v}>
                            <line
                                x1={PAD.left} x2={width - PAD.right}
                                y1={y(v)} y2={y(v)}
                                className="chart-grid"
                            />
                            <text x={PAD.left - 10} y={y(v) + 4} className="chart-axis" textAnchor="end">
                                {compact(v)}
                            </text>
                        </g>
                    ))}

                    {area && <path d={area} fill="url(#sales-fill)" />}

                    <motion.path
                        d={line('sales')}
                        className="chart-line chart-line-sales"
                        fill="none"
                        initial={reduce ? false : { pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut' }}
                    />
                    <motion.path
                        d={line('purchases')}
                        className="chart-line chart-line-purchases"
                        fill="none"
                        initial={reduce ? false : { pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: reduce ? 0 : 0.8, ease: 'easeOut', delay: reduce ? 0 : 0.1 }}
                    />

                    {points.map((p, i) => (
                        i % labelEvery === 0 || i === points.length - 1 ? (
                            <text key={p.date} x={x(i)} y={HEIGHT - 8} className="chart-axis" textAnchor="middle">
                                {shortBSDate(p.date)}
                            </text>
                        ) : null
                    ))}

                    {active && hover !== null && (
                        <g pointerEvents="none">
                            <line
                                x1={x(hover)} x2={x(hover)}
                                y1={PAD.top} y2={PAD.top + plotH}
                                className="chart-guide"
                            />
                            <circle cx={x(hover)} cy={y(active.sales)} r="4" className="chart-dot" />
                        </g>
                    )}
                </motion.svg>

                {active && hover !== null && (
                    <div
                        className="chart-tip"
                        style={{ left: Math.min(Math.max(x(hover), 90), Math.max(90, width - 90)) }}
                    >
                        <div className="chart-tip-date">{active.date}</div>
                        <div className="chart-tip-row"><i className="dot dot-sales" /> Revenue <b>{money(active.sales)}</b></div>
                        <div className="chart-tip-row"><i className="dot dot-purchases" /> Purchases <b>{money(active.purchases)}</b></div>
                    </div>
                )}
            </div>
        </section>
    );
}
