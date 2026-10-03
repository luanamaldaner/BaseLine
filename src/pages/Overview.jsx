import { TESTS } from '../tests/registry.js';
import { getTrials, summarizeBaseline, usualRange } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen } from '../lib/status.js';
import { BASELINE_TRIALS } from '../components/SaveTrial.jsx';
import { formatMetric } from '../components/ResultCards.jsx';
import Trend from '../components/Trend.jsx';

export default function Overview({ athlete, onOpenTest }) {
  const rows = TESTS.map((test) => {
    const trials = getTrials(athlete, test.id);
    const baseN = summarizeBaseline(athlete, test.id)?.n ?? 0;
    return { test, trials, baseN, check: latestCheck(athlete, test) };
  });
  const overall = overallStatus(rows.map((r) => r.check));
  const baselineDone = rows.filter((r) => r.baseN >= BASELINE_TRIALS).length;

  return (
    <section className="overview">
      <OverallBanner overall={overall} rows={rows} baselineDone={baselineDone} />

      <div className="test-grid">
        {rows.map(({ test, trials, baseN, check }) => {
          const def = test.metrics[test.headline];
          const status = check && STATUS[check.comparison.status];
          return (
            <article className="test-card" key={test.id}>
              <header>
                <h3>{test.label}</h3>
                {status && <span className={`chip ${status.cls}`}>{status.short}</span>}
              </header>
              <p className="muted small">{test.measures}</p>
              <dl className="facts">
                <div>
                  <dt>Baseline</dt>
                  <dd>
                    {Math.min(baseN, BASELINE_TRIALS)} of {BASELINE_TRIALS}
                    {baseN >= BASELINE_TRIALS ? ' ✓' : ''}
                  </dd>
                </div>
                <div>
                  <dt>Latest check</dt>
                  <dd>{check ? formatWhen(check.trial.at) : '—'}</dd>
                </div>
                {check && (
                  <div>
                    <dt>{def.label}</dt>
                    <dd>
                      {formatMetric(check.trial.metrics[test.headline], def)} {def.unit}
                    </dd>
                  </div>
                )}
              </dl>
              <p className="trend-title small">{def.label} over time</p>
              <Trend
                trials={trials}
                metric={test.headline}
                def={def}
                band={usualRange(athlete, test.id, test.headline, def)}
              />
              <button onClick={() => onOpenTest(test.id)}>
                {baseN < BASELINE_TRIALS ? 'Record baseline' : 'Run a check'}
              </button>
            </article>
          );
        })}
      </div>

      <Guide />
    </section>
  );
}

function OverallBanner({ overall, rows, baselineDone }) {
  if (overall) {
    const s = STATUS[overall];
    const dates = rows.filter((r) => r.check).map((r) => r.check.trial.at).sort();
    return (
      <div className={`status-banner ${s.cls}`}>
        <span className="muted small">Overall, from the latest check of each test</span>
        <b>{s.title}</b>
        <span>{s.text}</span>
        <span className="muted small">
          Checks from {formatWhen(dates[0])}
          {dates.length > 1 && dates[0] !== dates[dates.length - 1]
            ? ` to ${formatWhen(dates[dates.length - 1])}`
            : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="status-banner muted">
      <b>No post-hit checks yet</b>
      <span>
        Baselines complete for {baselineDone} of {TESTS.length} tests. Record {BASELINE_TRIALS}{' '}
        baseline trials per test while healthy; after a hit, run each test as a check and the
        overall result appears here.
      </span>
    </div>
  );
}

function Guide() {
  return (
    <div className="guide">
      <h2>What each test is for</h2>
      <div className="table-scroll">
        <table className="guide-table">
          <thead>
            <tr>
              <th>Test</th>
              <th>What it checks</th>
              <th>Best at catching</th>
              <th>Watch out for</th>
            </tr>
          </thead>
          <tbody>
            {TESTS.map((t) => (
              <tr key={t.id}>
                <td>
                  <b>{t.label}</b>
                  <div className="muted small">{t.time} · {t.device}</div>
                </td>
                <td>{t.system}</td>
                <td>{t.bestAt}</td>
                <td>{t.limits}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>How they fit together</h3>
      <ul className="guide-points">
        <li>
          <b>Concussion doesn't look the same in everyone.</b> One athlete mostly loses balance,
          another mostly has eye-movement problems, another mostly slows down. Each test watches a
          different system, so they won't always agree, and a normal result on one test never
          clears an athlete by itself.
        </li>
        <li>
          <b>Symptoms are fast but subjective; the other three are objective.</b> If an athlete
          says they feel fine but their balance or eye tracking is off, trust the measurement.
        </li>
        <li>
          <b>They recover on different clocks.</b> Balance often returns to normal within days;
          thinking speed and eye movements can lag behind. That's why return-to-play needs every
          test back in range, not just one.
        </li>
        <li>
          <b>How the overall call works:</b> each test compares the athlete to their own baseline.
          One test worse than usual means <i>Monitor</i>. Two tests worse, or one clearly worse,
          means <i>Remove from play and refer</i>.
        </li>
        <li>
          <b>Next step for the data:</b> with baselines and checks from many athletes, the CSV
          export (History tab) lets us measure how strongly the tests agree with each other and
          which combination catches the most.
        </li>
      </ul>
    </div>
  );
}
