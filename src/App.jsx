import { useState } from 'react';
import { listAthletes } from './lib/baseline.js';
import { TESTS } from './tests/registry.js';
import Overview from './pages/Overview.jsx';
import History from './pages/History.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  ...TESTS.map((t) => ({ id: t.id, label: t.label })),
  { id: 'history', label: 'History' },
];

export default function App() {
  const [tab, setTab] = useState('overview');
  const [athlete, setAthlete] = useState('');

  if (!athlete) {
    return <NameGate onContinue={(name) => { setAthlete(name); setTab('overview'); }} />;
  }

  const test = TESTS.find((t) => t.id === tab);
  let page;
  if (tab === 'overview') page = <Overview athlete={athlete} onOpenTest={setTab} />;
  else if (tab === 'history') page = <History athlete={athlete} onAthleteDeleted={() => setAthlete('')} />;
  else page = <test.Component athlete={athlete} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◎</span> Baseline
        </div>
        <div className="athlete">
          Testing <b>{athlete}</b>
          <button className="ghost small-btn" onClick={() => setAthlete('')}>
            Switch athlete
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={t.id === tab ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* key: remount per athlete and tab so pages always read fresh data */}
      <main key={`${athlete}:${tab}`}>{page}</main>

      <footer className="muted small">
        Screening tool, not a diagnosis. Any athlete with a suspected concussion should be
        removed from play and evaluated by a clinician.
      </footer>
    </div>
  );
}

function NameGate({ onContinue }) {
  const [name, setName] = useState('');
  const known = listAthletes();
  const trimmed = name.trim();

  const submit = (e) => {
    e.preventDefault();
    if (trimmed) onContinue(trimmed);
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand gate-brand">
          <span className="logo" aria-hidden>◎</span> Baseline
        </div>
        <h1>Who's being tested?</h1>
        <p className="muted">
          Enter the athlete's name. Results are saved under it and compared to their own
          baseline.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Athlete name"
          aria-label="Athlete name"
        />
        <button className="primary" type="submit" disabled={!trimmed}>
          Continue
        </button>
        {known.length > 0 && (
          <div className="gate-known">
            <p className="muted small">Or pick a returning athlete:</p>
            <div className="chips">
              {known.map((a) => (
                <button type="button" key={a} onClick={() => onContinue(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
