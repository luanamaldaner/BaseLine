import { useState } from 'react';
import { formatMetric } from './ResultCards.jsx';
import { formatWhen } from '../lib/status.js';

// Small trend chart for one metric: every trial in time order, baseline
// trials gray, post-hit checks blue, and the athlete's usual range shaded.
export default function Trend({ trials, metric, def, band }) {
  const [hover, setHover] = useState(null);
  const pts = [...trials]
    .filter((t) => Number.isFinite(t.metrics[metric]))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (pts.length === 0) return <p className="muted small trend-empty">No results yet.</p>;

  const W = 300, H = 90, P = { l: 6, r: 6, t: 10, b: 10 };
  const values = pts.map((p) => p.metrics[metric]);
  const ext = band ? [...values, band.lo, band.hi] : values;
  let lo = Math.min(...ext), hi = Math.max(...ext);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const padV = (hi - lo) * 0.1;
  lo -= padV; hi += padV;
  const x = (i) => (pts.length === 1 ? W / 2 : P.l + (i / (pts.length - 1)) * (W - P.l - P.r));
  const y = (v) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);

  const h = hover !== null ? pts[hover] : null;

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`${def.label} over ${pts.length} results`}>
        {band && (
          <rect x={P.l} width={W - P.l - P.r} y={y(band.hi)} height={Math.max(1, y(band.lo) - y(band.hi))}
            className="trend-band" />
        )}
        {pts.length > 1 && (
          <polyline className="trend-line" points={pts.map((p, i) => `${x(i)},${y(p.metrics[metric])}`).join(' ')} />
        )}
        {pts.map((p, i) => (
          <g key={p.at}>
            <circle cx={x(i)} cy={y(p.metrics[metric])} r={hover === i ? 5.5 : 4}
              className={`trend-dot ${p.kind}`} />
            {/* bigger invisible hit target */}
            <circle cx={x(i)} cy={y(p.metrics[metric])} r={12} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              onTouchStart={() => setHover(i)} />
          </g>
        ))}
      </svg>
      <div className="trend-foot small">
        {h ? (
          <span>
            {formatWhen(h.at)} · {h.kind === 'baseline' ? 'Baseline' : 'Check'} ·{' '}
            <b>{formatMetric(h.metrics[metric], def)} {def.unit}</b>
          </span>
        ) : (
          <span className="muted">
            <i className="key baseline" />baseline<i className="key check" />check
            {band && <><i className="key band" />usual</>}
          </span>
        )}
      </div>
    </div>
  );
}
