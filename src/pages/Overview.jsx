import { useLayoutEffect, useRef, useState } from 'react';
import { TESTS, RESULT_TESTS } from '../tests/registry.js';
import { getTrials, summarizeBaseline, usualRange, BASELINE_TRIALS } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen, baselinesComplete } from '../lib/status.js';
import { formatMetric } from '../components/ResultCards.jsx';
import Trend from '../components/Trend.jsx';
import { TestBadge, TEST_THEME } from '../components/Icons.jsx';
import Avatar from '../components/Avatar.jsx';
import { getSession } from '../lib/session.js';
import DotEmoji from '../components/DotEmoji.jsx';

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
    baseN: summarizeBaseline(subjectUid, test.id)?.recorded ?? 0,
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
      <div className="player-card" data-tour="dash-header">
        <Avatar name={name || '?'} uid={subjectUid} />
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

      <div className="test-grid" data-tour="test-grid">
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
                    {check ? formatMetric(check.trial.metrics[test.headline], def) : 'None yet'}
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
                  {Math.min(baseN, BASELINE_TRIALS)} of {BASELINE_TRIALS}{!needsBaseline && <> <DotEmoji mood="happy" size={19} label="complete" /></>}
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

// Tips for getting a clean result, per test (shown in the guide tabs).
const HOW_TO = {
  balance: [
    'Shoes off, on a firm floor, phone held flat against the chest with both hands.',
    'Turn the volume up and Silent mode off: the beep and voice are the only cues with eyes closed.',
    'Someone stands right next to the athlete and counts errors after each stance.',
  ],
  reaction: [
    'Sit down and use the same device every time: phones and laptops give different times.',
    'Dominant hand, held the same way each time.',
    'Tapping before the box turns green counts as a mistake.',
  ],
  eye: [
    'Face a window or lamp, about an arm’s length from a laptop or 30 cm from a phone.',
    'Glasses off if possible. Keep the head still and move only the eyes.',
    'Phone and laptop each keep their own baseline, so compare like with like.',
  ],
};

// Reference info at the bottom of the dashboard, as tabs: one per test, plus
// how the tests fit together and how the overall call is made.
export function Guide() {
  const tabs = [
    ...TESTS.map((t) => ({ id: t.id, label: t.label, test: t })),
    { id: 'together', label: 'How they fit together' },
    { id: 'call', label: 'How the call works' },
  ];
  const [active, setActive] = useState(tabs[0].id);
  const [dir, setDir] = useState(1); // 1 = moved right, -1 = moved left (which way content slides)
  const [pill, setPill] = useState(null); // where the sliding highlight sits
  const refs = useRef({});

  const select = (id) => {
    const from = tabs.findIndex((t) => t.id === active);
    const to = tabs.findIndex((t) => t.id === id);
    if (to !== from) setDir(to > from ? 1 : -1);
    setActive(id);
  };

  // Slide the highlight under the active tab (and keep it there on resize).
  useLayoutEffect(() => {
    const place = () => {
      const el = refs.current[active];
      if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [active]);

  // Arrow keys move between tabs (the standard tabs keyboard pattern).
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.id === active);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length].id;
    select(next);
    refs.current[next]?.focus();
  };

  const tab = tabs.find((t) => t.id === active);

  return (
    <section className="guide">
      <h2>Learn more</h2>
      <p className="muted guide-intro">What each test measures, how to get a clean result, and how the overall call is made.</p>
      <div className="info-tabs" data-tour="learn-tabs" role="tablist" aria-label="About the tests" onKeyDown={onKey}>
        {pill && <span className="info-pill" aria-hidden="true" style={pill} />}
        {tabs.map((t) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            role="tab"
            id={`guide-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`guide-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className={active === t.id ? 'active' : ''}
            onClick={() => select(t.id)}
          >
            {t.test && <TestBadge id={t.id} size={26} />}
            {t.label}
          </button>
        ))}
      </div>

      <div className="info-panel" role="tabpanel" id={`guide-panel-${tab.id}`} aria-labelledby={`guide-tab-${tab.id}`}>
        {/* key: each tab's content slides in from the side it came from */}
        <div key={tab.id} className={`info-slide ${dir > 0 ? 'from-right' : 'from-left'}`}>
          {tab.test ? <TestInfo test={tab.test} /> : tab.id === 'together' ? <Together /> : <HowTheCallWorks />}
        </div>
      </div>
    </section>
  );
}

function TestInfo({ test }) {
  return (
    <div className="info-grid">
      <div className="info-head">
        <TestBadge id={test.id} size={48} />
        <div>
          <h3>{test.label}</h3>
          <p className="muted">{test.measures}</p>
        </div>
        <span className="tile-meta">{test.time} · {test.device}</span>
      </div>
      <div className="info-block">
        <h4>What it checks</h4>
        <p>{test.system}</p>
      </div>
      <div className="info-block">
        <h4>Best at catching</h4>
        <p>{test.bestAt}</p>
      </div>
      <div className="info-block">
        <h4>Watch out for</h4>
        <p>{test.limits}</p>
      </div>
      <div className="info-block">
        <h4>Getting a clean result</h4>
        <ul>{(HOW_TO[test.id] ?? []).map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  );
}

function Together() {
  return (
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
    </ul>
  );
}

function HowTheCallWorks() {
  return (
    <div className="info-grid">
      <p>
        Each test compares the athlete to <b>their own baseline</b>: {BASELINE_TRIALS} trials
        recorded while healthy. A result counts as worse than usual when it falls well outside
        their normal range.
      </p>
      <ul className="call-legend">
        <li><span className="chip ok">Normal</span> Every test is within their usual range.</li>
        <li><span className="chip warn">Monitor</span> One test is worse than usual. Keep them out of contact and retest.</li>
        <li><span className="chip bad">Refer</span> Two tests worse, one clearly worse, or no baseline to compare against. Remove from play and have a clinician see them.</li>
      </ul>
      <p className="muted small">
        A screening tool, not a diagnosis. When in doubt, sit them out.
      </p>
    </div>
  );
}
