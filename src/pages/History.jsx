import { testById } from '../tests/registry.js';
import { allTrials, compare, exportCsv } from '../lib/baseline.js';
import { deleteTrial } from '../lib/session.js';
import { STATUS, formatWhen } from '../lib/status.js';
import { formatMetric } from '../components/ResultCards.jsx';

export function download(name, text) {
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

// Every result for one athlete. names: uid -> display name (for "run by").
export default function History({ subjectUid, subjectName, isSelf, names }) {
  const trials = allTrials(subjectUid).filter((t) => testById[t.test]);

  const byDay = [];
  for (const t of trials) {
    const day = dayLabel(t.at);
    if (byDay[byDay.length - 1]?.day !== day) byDay.push({ day, trials: [] });
    byDay[byDay.length - 1].trials.push(t);
  }

  function remove(t) {
    const test = testById[t.test];
    if (!confirm(`Delete this ${test.label} ${t.kind === 'baseline' ? 'baseline trial' : 'check'} from ${formatWhen(t.at)}?`)) return;
    deleteTrial(t.id).catch((e) => alert(`Couldn't delete: ${e.message}`));
  }

  const safeName = subjectName.replace(/[^\w-]+/g, '_');

  return (
    <section className="history">
      <header className="test-head history-head">
        <div>
          <h2>{isSelf ? 'Your results' : `${subjectName}'s results`}</h2>
          <p className="muted">{trials.length} saved result{trials.length === 1 ? '' : 's'}, newest first.</p>
        </div>
        <div className="row">
          <button
            onClick={() => download(`${safeName}-results.csv`, exportCsv([subjectUid], names))}
            disabled={!trials.length}
          >
            Download CSV
          </button>
        </div>
      </header>

      {byDay.length === 0 && <div className="callout">No results yet.</div>}

      {byDay.map(({ day, trials: list }) => (
        <div className="day" key={day}>
          <h3>{day}</h3>
          <div className="trial-list">
            {list.map((t) => {
              const test = testById[t.test];
              const status =
                t.kind === 'check' ? STATUS[compare(subjectUid, t.test, t.metrics, t.at).status] : null;
              const by = t.testerUid && t.testerUid !== subjectUid ? names.get(t.testerUid) : null;
              return (
                <div className="trial" key={t.id}>
                  <div className="trial-when">{timeLabel(t.at)}</div>
                  <div className="trial-main">
                    <div className="trial-title">
                      <b>{test.label}</b>
                      <span className={`chip ${t.kind === 'baseline' ? 'muted' : 'accent'}`}>
                        {t.kind === 'baseline' ? 'Baseline' : 'Post-hit check'}
                      </span>
                      {status && <span className={`chip ${status.cls}`}>{status.short}</span>}
                      <ConditionTags c={t.conditions} />
                      {by && <span className="muted small">run by {by}</span>}
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
    </section>
  );
}

// Only the conditions worth flagging, so a normal result stays uncluttered.
function ConditionTags({ c }) {
  if (!c) return null;
  const tags = [
    c.rested === false && 'Not rested',
    c.place === 'sideline' && 'Loud sideline',
    c.light === 'sun' && 'Direct sun',
    c.heat === true && 'Overheated',
    c.pain === true && 'Injury or pain',
  ].filter(Boolean);
  if (!tags.length && !c.device) return null;
  return (
    <span className="cond-tags">
      {tags.map((t) => <span key={t} className="chip warn" title="Testing condition that can skew results">{t}</span>)}
      {c.device && <span className="chip muted">{c.device === 'phone' ? 'Phone' : 'Laptop'}</span>}
    </span>
  );
}
