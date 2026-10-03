// Plain-language results, shared by all tests.
//
// spec entries: { label, unit, digits, scale?, worse, explain, rate?(value) }
//   scale  multiply before display (e.g. 100 to show 0.92 as 92%)
//   rate   returns 'good' | 'ok' | 'poor' as a rough standalone guide
// comparison: output of lib/baseline.js compare(), or null.

const RATING = {
  good: { label: 'Good', cls: 'ok' },
  ok: { label: 'OK', cls: 'warn' },
  poor: { label: 'Poor', cls: 'bad' },
};

const STATUS = {
  normal: {
    cls: 'ok',
    title: 'Normal',
    text: 'Every result is within this athlete’s usual range.',
  },
  monitor: {
    cls: 'warn',
    title: 'Monitor',
    text: 'One result is worse than usual. Watch for symptoms and retest.',
  },
  refer: {
    cls: 'bad',
    title: 'Remove from play and refer',
    text: 'Several results are worse than usual. Have this athlete seen by a clinician.',
  },
};

export function formatMetric(value, def) {
  if (!Number.isFinite(value)) return 'n/a';
  return (value * (def.scale ?? 1)).toFixed(def.digits);
}

export default function ResultCards({ metrics, spec, comparison }) {
  const rows = Object.fromEntries((comparison?.rows ?? []).map((r) => [r.name, r]));
  const status = comparison && STATUS[comparison.status];

  return (
    <div className="result-cards">
      {status && (
        <div className={`status-banner ${status.cls}`}>
          <b>{status.title}</b>
          <span>{status.text}</span>
        </div>
      )}
      <div className="cards">
        {Object.entries(spec).map(([name, def]) => {
          const value = metrics[name];
          const rating = def.rate && Number.isFinite(value) ? RATING[def.rate(value)] : null;
          const row = rows[name];
          return (
            <div key={name} className={`card ${row?.flagged ? 'flagged' : ''}`}>
              <div className="card-head">
                <span>{def.label}</span>
                {rating && <span className={`chip ${rating.cls}`}>{rating.label}</span>}
              </div>
              <div className="card-value">
                {formatMetric(value, def)} <small>{def.unit}</small>
              </div>
              <p className="card-explain">{def.explain}</p>
              {row && (
                <p className={`card-compare ${row.flagged ? 'bad' : 'ok'}`}>
                  Usual: {formatMetric(row.mean, def)} {def.unit} ·{' '}
                  {row.flagged ? 'worse than usual' : 'within usual range'}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">
        Good / OK / Poor are rough guides, not medical cutoffs. The real check is comparing an
        athlete to their own baseline.
      </p>
    </div>
  );
}
