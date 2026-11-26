import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { money } from '../format';

/**
 * Spending by category.
 *
 * Every slice is one entry of `analytics.expense_heads` — the same P&L head
 * breakdown the monthly/P&L screens use. This component performs no query and
 * derives no figure of its own: it only turns the amounts it is given into
 * angles and a legend. The panel (and every row) opens the P&L report, exactly
 * like the expense panel it replaces.
 */

const COLORS = [
    '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#14b8a6', '#f43f5e', '#64748b'
];

const SIZE = 200;
const CX = SIZE / 2;
const CY = SIZE / 2;
const RADIUS = 74;
const STROKE = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function go(page) {
    if (typeof window.navigateTo === 'function') window.navigateTo(page);
}

export default function ExpenseDonut({ heads, monthLabel }) {
    const reduce = useReducedMotion();
    const [hover, setHover] = useState(null);

    const rows = (heads || []).filter((h) => Number(h.amount) > 0);
    const total = rows.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);

    // Running start fraction gives each arc its offset; percentages come from
    // the same amounts, so the legend and the ring can never disagree.
    const slices = useMemo(() => {
        let acc = 0;
        return rows.map((h, i) => {
            const amount = Number(h.amount) || 0;
            const frac = total > 0 ? amount / total : 0;
            const slice = {
                key: h.key || h.label,
                label: h.label || h.key,
                amount,
                color: COLORS[i % COLORS.length],
                pct: frac * 100,
                start: acc,
                frac
            };
            acc += frac;
            return slice;
        });
    }, [rows, total]);

    const active = hover !== null ? slices[hover] : null;
    const gap = slices.length > 1 ? Math.min(CIRCUMFERENCE * 0.012, 6) : 0;

    return (
        <section className="panel donut-panel">
            <header className="panel-head">
                <div>
                    <h2 className="panel-title">Spending by category</h2>
                    <p className="panel-sub">{monthLabel || 'This month'} to date — P&amp;L heads</p>
                </div>
                <button type="button" className="panel-link" onClick={() => go('profit-loss')}>
                    P&amp;L <ArrowRight size={13} />
                </button>
            </header>

            {rows.length === 0 ? (
                <p className="panel-empty">No expenses recorded this month.</p>
            ) : (
                <>
                    <div className="donut-wrap">
                        <motion.svg
                            className="donut-svg"
                            viewBox={`0 0 ${SIZE} ${SIZE}`}
                            role="img"
                            aria-label={`Spending by category, total ${money(total)}`}
                            initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: reduce ? 0 : 0.35, ease: 'easeOut' }}
                            onMouseLeave={() => setHover(null)}
                        >
                            <g transform={`rotate(-90 ${CX} ${CY})`}>
                                {slices.map((slice, i) => {
                                    const dash = Math.max(0, slice.frac * CIRCUMFERENCE - gap);
                                    return (
                                        <motion.circle
                                            key={slice.key}
                                            cx={CX}
                                            cy={CY}
                                            r={RADIUS}
                                            fill="none"
                                            stroke={slice.color}
                                            strokeWidth={hover === i ? STROKE + 4 : STROKE}
                                            strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                                            strokeDashoffset={-slice.start * CIRCUMFERENCE}
                                            animate={{ opacity: hover === null || hover === i ? 1 : 0.4 }}
                                            transition={{ duration: reduce ? 0 : 0.2 }}
                                            style={{ cursor: 'pointer' }}
                                            onMouseEnter={() => setHover(i)}
                                            onClick={() => go('profit-loss')}
                                        />
                                    );
                                })}
                            </g>

                            <text x={CX} y={CY - 4} textAnchor="middle" className="donut-amount">
                                {money(active ? active.amount : total)}
                            </text>
                            <text x={CX} y={CY + 15} textAnchor="middle" className="donut-caption">
                                {active ? active.label : 'Total spend'}
                            </text>
                            {active && (
                                <text x={CX} y={CY + 32} textAnchor="middle" className="donut-share">
                                    {active.pct.toFixed(1)}% of spending
                                </text>
                            )}
                        </motion.svg>
                    </div>

                    <ul className="donut-legend">
                        {slices.map((slice, i) => (
                            <li key={slice.key}>
                                <button
                                    type="button"
                                    className={`donut-row ${hover === i ? 'is-on' : ''}`}
                                    onClick={() => go('profit-loss')}
                                    onMouseEnter={() => setHover(i)}
                                    onMouseLeave={() => setHover(null)}
                                    onFocus={() => setHover(i)}
                                    onBlur={() => setHover(null)}
                                    title={`Open the P&L report — ${slice.label}`}
                                >
                                    <span className="donut-dot" style={{ background: slice.color }} />
                                    <span className="donut-name">{slice.label}</span>
                                    <span className="donut-value">{money(slice.amount)}</span>
                                    <span className="donut-pct">{slice.pct.toFixed(1)}%</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
