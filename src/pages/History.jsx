import { useState } from 'react';
import { testById } from '../tests/registry.js';
import { allTrials, compare, deleteTrial, deleteAthlete, exportCsv } from '../lib/baseline.js';
import { STATUS, formatWhen } from '../lib/status.js';
import { formatMetric } from '../components/ResultCards.jsx';

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const dayLabel = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export default function History({ athlete, onAthleteDeleted }) {
  const [, refresh] = useState(0);
  const trials = allTrials(athlete).filter((t) => testById[t.test]);

  const byDay = [];
  for (const t of trials) {
    const day = dayLabel(t.at);
    if (byDay[byDay.length - 1]?.day !== day) byDay.push({ day, trials: [] });
    byDay[byDay.length - 1].trials.push(t);
  }

  function remove(t) {
    const test = testById[t.test];
    if (!confirm(`Delete this ${test.label} ${t.kind === 'baseline' ? 'baseline trial' : 'check'} from ${formatWhen(t.at)}?`)) return;
    deleteTrial(athlete, t.test, t.at);
    refresh((n) => n + 1);
  }

  function removeAthlete() {
    if (!confirm(`Delete ${athlete} and all ${trials.length} saved results? This can't be undone.`)) return;
    deleteAthlete(athlete);
    onAthleteDeleted();
  }

  const safeName = athlete.replace(/[^\w-]+/g, '_');

  return (
    <section className="history">
      <header className="test-head history-head">
        <div>
          <h2>{athlete}'s results</h2>
          <p className="muted">{trials.length} saved result{trials.length === 1 ? '' : 's'}, newest first.</p>
        </div>
        <div className="row">
          <button onClick={() => download(`${safeName}-results.csv`, exportCsv([athlete]))} disabled={!trials.length}>
            Download CSV
          </button>
          <button onClick={() => download('all-athletes-results.csv', exportCsv())}>
            CSV of all athletes
          </button>
        </div>
      </header>

      {byDay.length === 0 && <div className="callout">Nothing saved yet. Run a test and save it.</div>}

      {byDay.map(({ day, trials: list }) => (
        <div className="day" key={day}>
          <h3>{day}</h3>
          <div className="trial-list">
            {list.map((t) => {
              const test = testById[t.test];
              const status =
                t.kind === 'check'
                  ? STATUS[compare(athlete, t.test, t.metrics, test.metrics, t.at).status]
                  : null;
              return (
                <div className="trial" key={`${t.test}-${t.at}`}>
                  <div className="trial-when">{timeLabel(t.at)}</div>
                  <div className="trial-main">
                    <div className="trial-title">
                      <b>{test.label}</b>
                      <span className={`chip ${t.kind === 'baseline' ? 'muted' : 'accent'}`}>
                        {t.kind === 'baseline' ? 'Baseline' : 'Post-hit check'}
                      </span>
                      {status && <span className={`chip ${status.cls}`}>{status.short}</span>}
                    </div>
                    <div className="trial-metrics muted small">
                      {Object.entries(test.metrics).map(([name, def]) => (
                        <span key={name}>
                          {def.label} <b>{formatMetric(t.metrics[name], def)}</b> {def.unit}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button className="ghost icon-btn" onClick={() => remove(t)} aria-label="Delete result" title="Delete">
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="callout storage-note">
        <b>Where this is stored:</b> only in this browser, on this device. Nothing is uploaded.
        A different phone or laptop has its own separate records, and clearing this browser's
        data erases them, so download a CSV to back up.
      </div>

      <div className="danger-zone">
        <button className="danger-btn" onClick={removeAthlete}>Delete {athlete} and all results</button>
      </div>
    </section>
  );
}
