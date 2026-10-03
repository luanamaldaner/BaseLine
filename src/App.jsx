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
  const { Component } = TABS.find((t) => t.id === tab);
  const name = athlete.trim();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◎</span> Baseline
        </div>
        <label className="athlete">
          Athlete
          <input
            list="athletes"
            value={athlete}
            onChange={(e) => setAthlete(e.target.value)}
            placeholder="Name"
          />
          <datalist id="athletes">
            {listAthletes().map((a) => <option key={a} value={a} />)}
          </datalist>
        </label>
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
        <Component athlete={name} />
      </main>

      <footer className="muted small">
        Screening tool, not a diagnosis. Any athlete with a suspected concussion should be
        removed from play and evaluated by a clinician.
      </footer>
    </div>
  );
}
