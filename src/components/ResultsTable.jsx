// Metric table shared by all tests. Pass `comparison` (from lib/baseline.js
// compare()) to show the baseline columns and the overall status.

const STATUS = {
  normal: { label: 'Normal', cls: 'ok' },
  monitor: { label: 'Monitor', cls: 'warn' },
  refer: { label: 'Remove from play + refer', cls: 'bad' },
  'no-baseline': { label: 'No baseline to compare', cls: 'muted' },
};

function fmt(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

export default function ResultsTable({ metrics, spec, comparison }) {
  const rows = comparison?.rows ?? [];
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const status = comparison && STATUS[comparison.status];

  return (
    <div className="results-table">
      {status && <div className={`status ${status.cls}`}>{status.label}</div>}
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>This test</th>
            {comparison && <th>Baseline (mean ± SD)</th>}
            {comparison && <th>z</th>}
          </tr>
        </thead>
        <tbody>
          {Object.entries(spec).map(([name, def]) => {
            const row = byName[name];
            return (
              <tr key={name} className={row?.flagged ? 'flagged' : ''}>
                <td>{def.label}</td>
                <td>
                  {fmt(metrics[name], def.digits)} <span className="muted">{def.unit}</span>
                </td>
                {comparison && (
                  <td>{row ? `${fmt(row.mean, def.digits)} ± ${fmt(row.sd, def.digits)}` : '—'}</td>
                )}
                {comparison && <td>{row ? fmt(row.z, 1) : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
