import { motion, useReducedMotion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react';
import { money, pctDelta } from '../format';

export default function KpiCard({ kpi, index = 0 }) {
    const reduce = useReducedMotion();
    const Icon = kpi.icon;
    const hasPrevious = kpi.previous !== null && kpi.previous !== undefined;
    const delta = hasPrevious ? pctDelta(kpi.value, kpi.previous) : null;
    const direction = delta === null ? 'flat' : delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
    const goodWhenUp = kpi.goodWhenUp !== false;
    const tone = direction === 'flat' ? 'flat' : (direction === 'up') === goodWhenUp ? 'good' : 'bad';
    const TrendIcon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus;

    return (
        <motion.button
            type="button"
            className={`kpi-tile tone-${kpi.tone || 'indigo'}`}
            onClick={() => (typeof window.navigateTo === 'function' ? window.navigateTo(kpi.page) : null)}
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.32, delay: reduce ? 0 : index * 0.06, ease: 'easeOut' }}
            whileHover={reduce ? undefined : { y: -2 }}
            title={`${kpi.label} — ${kpi.note || ''}`}
        >
            <span className="kpi-top">
                <span className="kpi-title">{kpi.label}</span>
                <span className="kpi-icon"><Icon size={17} strokeWidth={1.9} /></span>
            </span>
            <span className="kpi-figure">{money(kpi.value)}</span>
            <span className="kpi-bottom">
                <span className={`kpi-badge ${tone}`}>
                    <TrendIcon size={12} strokeWidth={2.4} />
                    {delta === null
                        ? 'No prior period'
                        : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${Math.abs(delta).toFixed(1)}%`}
                </span>
                <span className="kpi-note">{kpi.sub}</span>
            </span>
            {delta !== null && (
                <span className="kpi-prev">vs {money(kpi.previous)} previous period</span>
            )}
            <span className="kpi-open"><ArrowUpRight size={14} /></span>
        </motion.button>
    );
}
