import { TESTS, RESULT_TESTS } from '../tests/registry.js';
import { getTrials, summarizeBaseline, usualRange, BASELINE_TRIALS } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen, baselinesComplete } from '../lib/status.js';
import { formatMetric } from '../components/ResultCards.jsx';
import Trend from '../components/Trend.jsx';
import { TestBadge, TEST_THEME } from '../components/Icons.jsx';
import Avatar from '../components/Avatar.jsx';
import { getSession } from '../lib/session.js';

// Display name for anyone this viewer can see.
function nameOf(uid) {
  const s = getSession();
  if (s.user?.uid === uid) return s.profile?.name ?? '';
  return s.members.get(uid)?.name ?? '';
}

// One athlete's dashboard. Seen by the athlete themselves and by the coach.
// isSelf: the viewer is this athlete (so buttons say "Record baseline").
export default function Overview({ subjectUid, isSelf, onOpenTest }) {
  const all = RESULT_TESTS.map((test) => ({
    test,
    trials: getTrials(subjectUid, test.id),
    baseN: summarizeBaseline(subjectUid, test.id)?.n ?? 0,
    check: latestCheck(subjectUid, test),
  }));
  // The eye test has a laptop and a phone baseline. Show the phone card only
  // once there's phone data, and the laptop card unless only phone data exists.
  const has = (id) => all.find((r) => r.test.id === id).trials.length > 0;
  const rows = all.filter((r) =>
    r.test.id === 'eyePhone' ? has('eyePhone') : r.test.id === 'eye' ? has('eye') || !has('eyePhone') : true,
  );
  const overall = overallStatus(all.map((r) => r.check));
  const baselineDone = baselinesComplete(subjectUid);
  const name = nameOf(subjectUid);
  const lastCheck = all.filter((r) => r.check).map((r) => r.check.trial.at).sort().pop();
  const st = overall && STATUS[overall];

  return (
    <section className="overview">
      <div className="player-card">
        <Avatar name={name || '?'} />
        <div className="player-main">
          <p className="eyebrow">{isSelf ? 'My dashboard' : 'Player dashboard'}</p>
          <h1>{name}</h1>
          <p className="muted">
            Baselines {baselineDone} of {TESTS.length}
            {lastCheck ? ` · Last check ${formatWhen(lastCheck)}` : ' · No checks yet'}
          </p>
        </div>
        <span className={`chip big-chip ${st?.cls ?? 'muted'}`}>{st ? st.short : 'No checks'}</span>
        {onOpenTest && (
          <button className="primary big-btn player-cta" onClick={() => onOpenTest('all')}>
            Run all three tests
          </button>
        )}
      </div>

      <OverallBanner overall={overall} rows={all} baselineDone={baselineDone} isSelf={isSelf} />

      <div className="test-grid">
        {rows.map(({ test, trials, baseN, check }) => {
          const def = test.metrics[test.headline];
          const status = check && STATUS[check.comparison.status];
          const needsBaseline = baseN < BASELINE_TRIALS;
          return (
            <article className="test-card" key={test.id} style={{ '--tc': TEST_THEME[test.id]?.color }}>
              <header>
                <TestBadge id={test.id} size={40} />
                <div className="test-card-title">
                  <h3>{test.label}</h3>
                  <span className="muted small">{test.measures}</span>
                </div>
              </header>

              <div className="test-card-stat">
                <span className="muted small">{check ? `Latest ${def.label.toLowerCase()}` : 'Latest check'}</span>
                <span className="stat-row">
                  <span className="stat-big">
                    {check ? formatMetric(check.trial.metrics[test.headline], def) : '—'}
                    {check && <small> {def.unit}</small>}
                  </span>
                  {status && <span className={`chip ${status.cls}`}>{status.short}</span>}
                </span>
                <span className="muted small">{check ? formatWhen(check.trial.at) : 'No post-hit checks yet'}</span>
              </div>

              <div className="baseline-meter">
                <span className="muted small">Baseline</span>
                <span className="segments" aria-hidden>
                  {Array.from({ length: BASELINE_TRIALS }, (_, i) => (
                    <i key={i} className={i < baseN ? 'on' : ''} />
                  ))}
                </span>
                <span className="small">
                  {Math.min(baseN, BASELINE_TRIALS)} of {BASELINE_TRIALS}{needsBaseline ? '' : ' ✓'}
                </span>
              </div>

              <p className="trend-title small">{def.label} over time</p>
              <Trend
                trials={trials}
                metric={test.headline}
                def={def}
                band={usualRange(subjectUid, test.id, test.headline)}
              />
              {onOpenTest && (
                <button className="test-card-btn" onClick={() => onOpenTest(test.id)}>
                  {isSelf && needsBaseline ? 'Record baseline' : 'Run a check'}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <Guide />
    </section>
  );
}

function OverallBanner({ overall, rows, baselineDone, isSelf }) {
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
        Baselines complete for {baselineDone} of {TESTS.length} tests.{' '}
        {isSelf
          ? `Record ${BASELINE_TRIALS} baseline trials of each test while you're healthy. After a hit, anyone on the team can run a check on you.`
          : `Athletes record ${BASELINE_TRIALS} baseline trials of each test themselves while healthy. After a hit, run checks and the overall call appears here.`}
      </span>
    </div>
  );
}

export function Guide() {
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
          <b>All three are objective.</b> They measure what the body does, not what the athlete
          says, so they still work when a player wants to stay in the game and plays down how they
          feel.
        </li>
        <li>
          <b>They recover on different clocks.</b> Balance often returns to normal within days;
          thinking speed and eye movements can lag behind. That's why return-to-play needs every
          test back in range, not just one.
        </li>
        <li>
          <b>How the overall call works:</b> each test compares the athlete to their own baseline.
          One test worse than usual means <i>Monitor</i>. Two tests worse, one clearly worse, or a
          check with no baseline to compare against means <i>Remove from play and refer</i>.
        </li>
      </ul>
    </div>
  );
}
