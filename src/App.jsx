import { useState } from 'react';
import { useSession, logOut } from './lib/session.js';
import AuthScreen from './pages/AuthScreen.jsx';
import { ProfileSetup, TeamSetup } from './pages/Setup.jsx';
import Overview from './pages/Overview.jsx';
import History from './pages/History.jsx';
import RunTest from './pages/RunTest.jsx';
import { Roster, CoachTeam, AthleteTeam } from './pages/Team.jsx';

// UI state that should survive a reload (phones reload tabs in the background).
function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v) => {
    setValue(v);
    try {
      sessionStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  };
  return [value, set];
}

export default function App() {
  const s = useSession();
  const email = s.user?.email;

  if (!s.authChecked) return <Splash text="Loading…" />;
  if (!s.user) return <AuthScreen />;
  if (s.profile === undefined) return <Splash text="Loading your account…" />;
  if (!s.profile) return <ProfileSetup email={email} />;
  if (!s.profile.teamId) return <TeamSetup role={s.profile.role} email={email} />;
  if (s.team === undefined || !s.trialsReady) return <Splash text="Loading your team…" />;
  if (s.team === null) {
    return <TeamSetup role={s.profile.role} email={email} notice="That team no longer exists." />;
  }
  return s.profile.role === 'coach' ? <CoachApp s={s} /> : <AthleteApp s={s} />;
}

function Splash({ text }) {
  return (
    <div className="gate">
      <p className="muted">{text}</p>
    </div>
  );
}

// uid -> name for everyone this user can see (for "run by" labels).
function nameMap(s) {
  const names = new Map([...s.members.values()].map((m) => [m.uid, m.name]));
  names.set(s.team.coachUid, s.team.coachName);
  names.set(s.user.uid, s.profile.name);
  return names;
}

function Frame({ s, tabs, tab, setTab, children }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>◎</span> Baseline
          <span className="team-name muted">{s.team.name}</span>
        </div>
        <div className="athlete">
          <span>
            <b>{s.profile.name}</b> <span className="muted small">{s.profile.role}</span>
          </span>
          <button className="ghost small-btn" onClick={logOut}>Log out</button>
        </div>
      </header>
      <nav className="tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={id === tab ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {s.error && <div className="callout danger">{s.error}</div>}
      <main>{children}</main>
      <footer className="muted small">
        Screening tool, not a diagnosis. Any athlete with a suspected concussion should be
        removed from play and evaluated by a clinician.
      </footer>
    </div>
  );
}

function AthleteApp({ s }) {
  const me = s.user.uid;
  const [tab, setTab] = usePersisted('tab:athlete', 'me');
  const [pick, setPick] = usePersisted('pick:athlete', { subjectUid: null, testId: null });
  const members = [...s.members.values()].sort((a, b) => a.name.localeCompare(b.name));
  const people = [{ uid: me, name: s.profile.name }, ...members.filter((m) => m.uid !== me)];
  const openTest = (testId) => {
    setPick({ subjectUid: me, testId });
    setTab('test');
  };

  return (
    <Frame
      s={s}
      tab={tab}
      setTab={(t) => { if (t === 'test') setPick({ subjectUid: null, testId: null }); setTab(t); }}
      tabs={[['me', 'My dashboard'], ['test', 'Run a test'], ['history', 'My history'], ['team', 'Team']]}
    >
      {tab === 'me' && <Overview subjectUid={me} isSelf onOpenTest={openTest} />}
      {tab === 'test' && <RunTest people={people} selfUid={me} isCoach={false} pick={pick} setPick={setPick} />}
      {tab === 'history' && <History subjectUid={me} subjectName={s.profile.name} isSelf names={nameMap(s)} />}
      {tab === 'team' && <AthleteTeam team={s.team} members={members} />}
    </Frame>
  );
}

function CoachApp({ s }) {
  const [tab, setTab] = usePersisted('tab:coach', 'roster');
  const [player, setPlayer] = usePersisted('player:coach', null);
  const [playerTab, setPlayerTab] = usePersisted('playerTab:coach', 'dashboard');
  const [pick, setPick] = usePersisted('pick:coach', { subjectUid: null, testId: null });
  const members = [...s.members.values()].sort((a, b) => a.name.localeCompare(b.name));
  const names = nameMap(s);
  const selected = members.find((m) => m.uid === player);

  const openTestFor = (uid, testId) => {
    setPick({ subjectUid: uid, testId });
    setTab('test');
  };

  return (
    <Frame
      s={s}
      tab={tab}
      setTab={(t) => {
        if (t === 'roster') setPlayer(null);
        if (t === 'test') setPick({ subjectUid: null, testId: null });
        setTab(t);
      }}
      tabs={[['roster', 'Roster'], ['test', 'Run a check'], ['team', 'Team']]}
    >
      {tab === 'roster' && !selected && (
        <Roster members={members} onOpen={(uid) => { setPlayer(uid); setPlayerTab('dashboard'); }} />
      )}
      {tab === 'roster' && selected && (
        <section>
          <div className="row player-head">
            <button className="ghost small-btn" onClick={() => setPlayer(null)}>← Roster</button>
            <h2 className="grow">{selected.name}</h2>
            <div className="seg">
              {[['dashboard', 'Dashboard'], ['history', 'History']].map(([id, label]) => (
                <button key={id} className={playerTab === id ? 'on' : ''} onClick={() => setPlayerTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {playerTab === 'dashboard' ? (
            <Overview subjectUid={selected.uid} isSelf={false} onOpenTest={(testId) => openTestFor(selected.uid, testId)} />
          ) : (
            <History subjectUid={selected.uid} subjectName={selected.name} isSelf={false} names={names} />
          )}
        </section>
      )}
      {tab === 'test' && <RunTest people={members} selfUid={null} isCoach pick={pick} setPick={setPick} />}
      {tab === 'team' && <CoachTeam team={s.team} members={members} names={names} />}
    </Frame>
  );
}
