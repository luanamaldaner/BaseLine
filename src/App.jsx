import { useState } from 'react';
import { listAthletes } from './lib/baseline.js';
import EyeTest from './tests/eye/EyeTest.jsx';
import BalanceTest from './tests/balance/BalanceTest.jsx';
import ReactionTest from './tests/reaction/ReactionTest.jsx';
import SymptomsTest from './tests/symptoms/SymptomsTest.jsx';

const TABS = [
  { id: 'symptoms', label: 'Symptoms', Component: SymptomsTest },
  { id: 'balance', label: 'Balance', Component: BalanceTest },
  { id: 'reaction', label: 'Reaction', Component: ReactionTest },
  { id: 'eye', label: 'Eye pursuit', Component: EyeTest },
];

export default function App() {
  const [tab, setTab] = useState('eye');
  const [athlete, setAthlete] = useState('');

  if (!athlete) return <NameGate onContinue={setAthlete} />;

  const { Component } = TABS.find((t) => t.id === tab);

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

      <main>
        {/* key: remount per athlete so no state leaks between people */}
        <Component key={athlete} athlete={athlete} />
      </main>

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
