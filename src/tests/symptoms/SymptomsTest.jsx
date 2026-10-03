import { useState } from 'react';
import { SYMPTOMS, SCALE, METRICS, scoreSymptoms } from './symptoms.js';
import { compare, summarizeBaseline } from '../../lib/baseline.js';
import ResultCards from '../../components/ResultCards.jsx';
import SaveTrial, { BaselineProgress, NoBaselineNote } from '../../components/SaveTrial.jsx';

const TEST = 'symptoms';

export default function SymptomsTest({ athlete }) {
  const [ratings, setRatings] = useState({});
  const [result, setResult] = useState(null);
  const [runId, setRunId] = useState(0);

  const set = (symptom, value) => setRatings((r) => ({ ...r, [symptom]: value }));

  function submit() {
    const metrics = scoreSymptoms(ratings);
    const comparison = summarizeBaseline(athlete, TEST)
      ? compare(athlete, TEST, metrics, METRICS)
      : null;
    const reported = SYMPTOMS.filter((s) => ratings[s] > 0).map((s) => [s, ratings[s]]);
    setResult({ metrics, comparison, reported });
    setRunId((n) => n + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function reset() {
    setRatings({});
    setResult(null);
  }

  if (result) {
    return (
      <section className="test">
        <header className="test-head">
          <h2>Symptoms</h2>
        </header>
        <div className="results">
          {!result.comparison && <NoBaselineNote athlete={athlete} />}
          <ResultCards metrics={result.metrics} spec={METRICS} comparison={result.comparison} />
          <div className="panel">
            <h3>Reported</h3>
            {result.reported.length === 0 ? (
              <p className="muted">No symptoms reported.</p>
            ) : (
              <ul className="symptom-list">
                {result.reported.map(([s, v]) => (
                  <li key={s}>
                    {s} <b>{v}</b> <span className="muted">({SCALE[v].label.toLowerCase()})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <SaveTrial
            key={runId}
            athlete={athlete}
            test={TEST}
            metrics={result.metrics}
            onDiscard={reset}
          />
          <div className="row">
            <button className="ghost" onClick={reset}>Start a new checklist</button>
          </div>
        </div>
      </section>
    );
  }

  const answered = Object.keys(ratings).length;

  return (
    <section className="test">
      <header className="test-head">
        <h2>Symptoms</h2>
        <p className="muted">
          The athlete rates how they feel <b>right now</b>. 0 = not at all, 6 = severe.
          Anything left blank counts as 0.
        </p>
      </header>

      <div className="symptoms">
        {SYMPTOMS.map((s) => (
          <div className="symptom" key={s}>
            <span className="symptom-name">{s}</span>
            <div className="scale" role="radiogroup" aria-label={s}>
              {SCALE.map(({ value }) => (
                <button
                  key={value}
                  role="radio"
                  aria-checked={ratings[s] === value}
                  className={ratings[s] === value ? `on v${value}` : ''}
                  onClick={() => set(s, value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="row symptoms-foot">
        <button className="primary" onClick={submit}>See results</button>
        <span className="muted small">{answered} of {SYMPTOMS.length} rated</span>
      </div>
      <BaselineProgress athlete={athlete} test={TEST} />
    </section>
  );
}
