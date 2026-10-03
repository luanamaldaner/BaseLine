import { useEffect, useState, useSyncExternalStore } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase.js';
import { startSync, stopSync, subscribe, getVersion, isReady } from './lib/store.js';
import { listAthletes, localDataCount, importLocalData } from './lib/baseline.js';
import AuthScreen from './pages/AuthScreen.jsx';
import { TESTS } from './tests/registry.js';
import Overview from './pages/Overview.jsx';
import History from './pages/History.jsx';

const TABS = [
  { id: 'overview', label: 'Overview' },
  ...TESTS.map((t) => ({ id: t.id, label: t.label })),
  { id: 'history', label: 'History' },
];

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [syncError, setSyncError] = useState(null);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setSyncError(null);
        if (u) startSync(u.uid, (e) => setSyncError(e.message));
        else stopSync();
      }),
    [],
  );

  // Re-render whenever the synced data changes (this device or another).
  useSyncExternalStore(subscribe, getVersion);

  if (user === undefined) return <Splash text="Loading…" />;
  if (!user) return <AuthScreen />;
  if (!isReady()) return <Splash text="Loading your athletes…" />;
  return <Workspace user={user} syncError={syncError} />;
}

function Splash({ text }) {
  return (
    <div className="gate">
      <p className="muted">{text}</p>
    </div>
  );
}

function Workspace({ user, syncError }) {
  const [tab, setTab] = useState('overview');
  const [athlete, setAthlete] = useState('');

  if (!athlete) {
    return (
      <NameGate
        email={user.email}
        onContinue={(name) => { setAthlete(name); setTab('overview'); }}
      />
    );
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
      {syncError && (
        <div className="callout danger">Couldn’t reach the database: {syncError}</div>
      )}

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

function NameGate({ email, onContinue }) {
  const [name, setName] = useState('');
  const [imported, setImported] = useState(null);
  const known = listAthletes();
  const localCount = imported === null ? localDataCount() : 0;
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
          maxLength={100}
          aria-label="Athlete name"
        />
        <button className="primary" type="submit" disabled={!trimmed}>
          Continue
        </button>
        {localCount > 0 && (
          <div className="callout small">
            {localCount} result{localCount === 1 ? '' : 's'} from before accounts are saved on this
            device.{' '}
            <button type="button" className="link" onClick={() => setImported(importLocalData())}>
              Add them to this account
            </button>
          </div>
        )}
        {imported !== null && <p className="form-notice small">Added {imported} saved results.</p>}
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
        <p className="muted small gate-account">
          Signed in as {email} ·{' '}
          <button type="button" className="link" onClick={() => signOut(auth)}>Log out</button>
        </p>
      </form>
    </div>
  );
}
