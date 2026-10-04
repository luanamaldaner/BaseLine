import { useState, useLayoutEffect, useRef } from 'react';
import { useScreenTop } from './lib/focus.js';
import { HomeIcon, HistoryIcon, BookIcon, SymptomsIcon, UsersIcon } from './components/Icons.jsx';
import { useSession, logOut, teamIdsOf, retrySync, retryTrial } from './lib/session.js';
import { serviceErrorMessage } from './lib/serviceErrors.js';
import AuthScreen from './pages/AuthScreen.jsx';
import { ProfileSetup, TeamSetup } from './pages/Setup.jsx';
import Overview, { Guide } from './pages/Overview.jsx';
import History from './pages/History.jsx';
import RunTest from './pages/RunTest.jsx';
import { HistoryLine } from './components/MedicalHistory.jsx';
import { Roster, CoachTeam, AthleteTeam, InviteOffer } from './pages/Team.jsx';
import { Logo, APP_NAME } from './brand.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import Tour, { tourSeen, markTourSeen } from './components/Tour.jsx';
import { ConsentScreen, PrivacyDialog } from './pages/Privacy.jsx';
import { useCoachAlerts } from './components/Alerts.jsx';
import { BackIcon } from './components/Icons.jsx';
import Avatar from './components/Avatar.jsx';
import ProfilePicture from './components/ProfilePicture.jsx';

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
  if (s.profile === undefined) return <Splash text={s.error ?? 'Loading your account…'} retry={!!s.error} />;
  if (s.profileConfirmed === false) return <Splash text={s.error ?? 'Loading your account…'} retry={!!s.error} />;
  if (!s.profile) return <ProfileSetup email={email} />;
  if (!s.profile.consentedAt) return <ConsentScreen email={email} profile={s.profile} />;
  if (!teamIdsOf(s.profile).length) return <TeamSetup role={s.profile.role} email={email} />;
  if (s.teams.size < teamIdsOf(s.profile).length || !s.trialsReady) return <Splash text={s.error ?? 'Loading your teams…'} retry={!!s.error} />;
  return s.profile.role === 'coach' ? <CoachApp s={s} /> : <AthleteApp s={s} />;
}

// Results not yet on the server, and whether the server can be reached at
// all. Nothing is shown when everything is synced and reachable.
function SyncStatus({ s }) {
  const n = s.pendingWrites ?? 0;
  const down = s.server && !s.server.ok;
  const failedIds = [...(s.trialWrites?.entries() ?? [])].filter(([, entry]) => entry.status === 'failed').map(([id]) => id);
  const failed = failedIds.length;
  if (!n && !down && !s.syncError && !failed) return null;
  const results = `${n} result${n === 1 ? '' : 's'}`;
  return (
    <div className={`sync-status ${down || s.syncError || failed ? 'bad' : 'warn'}`} role="status">
      {s.syncError && <p>{serviceErrorMessage(s.syncError)}</p>}
      {n > 0 && <p>{results} waiting for Firebase confirmation. Keep this device’s browser data so queued results can upload when service resumes.</p>}
      {failed > 0 && <>
        <p>{failed} result{failed === 1 ? '' : 's'} could not upload. They are stored on this device. Keep this browser’s data and retry when connected.</p>
        <RetryFailedResults ids={failedIds} />
      </>}
      {down && !s.syncError && <p>Cloud sync is unavailable. Check your connection, then retry.</p>}
      <RetryConnection />
    </div>
  );
}

function RetryFailedResults({ ids }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await Promise.all(ids.map((id) => retryTrial(id))); }
    catch (e) { setError(serviceErrorMessage(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button className="small-btn" onClick={retry} disabled={busy}>{busy ? 'Retrying results…' : 'Retry failed results'}</button>
    {error && <p role="alert">{error}</p>}
  </>;
}

function RetryConnection() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function retry() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await retrySync(); }
    catch (e) { setError(serviceErrorMessage(e)); }
    finally { setBusy(false); }
  }
  return <>
    <button className="ghost small-btn" onClick={retry} disabled={busy}>{busy ? 'Checking connection…' : 'Retry connection'}</button>
    {error && <p role="alert">{error}</p>}
  </>;
}

function Splash({ text, retry = false }) {
  return (
    <div className="gate">
      <ThemeToggle fab />
      <p className="muted" role="status">{text}</p>
      {retry && <RetryConnection />}
    </div>
  );
}

// uid -> name for everyone this user can see (for "run by" labels).
function nameMap(s) {
  const names = new Map([...s.members.values()].map((m) => [m.uid, m.name]));
  for (const team of s.teams.values()) names.set(team.coachUid, team.coachName);
  names.set(s.user.uid, s.profile.name);
  return names;
}

// focus: a test screen. The test's own bar replaces the header, tabs, and
// footer so the test gets the whole screen on a phone.
function Frame({ s, tabs, tab, setTab, focus = false, unread = 0, children }) {
  const [privacy, setPrivacy] = useState(false);
  const [editingPicture, setEditingPicture] = useState(false);
  // Guided tour: from the Tutorial button, and once on first visit.
  const [touring, setTouring] = useState(() => !focus && !tourSeen(s.user.uid));
  const endTour = () => { markTourSeen(s.user.uid); setTouring(false); };

  // Tab transitions: a pill that slides to the active tab, and the page
  // sliding in from the side of the tab you came from.
  const tabRefs = useRef({});
  const navRef = useRef(null);
  const [pill, setPill] = useState(null);
  const order = tabs.map(([id]) => id);
  const prevTab = useRef(tab);
  const dirRef = useRef(1);
  if (prevTab.current !== tab) {
    dirRef.current = order.indexOf(tab) >= order.indexOf(prevTab.current) ? 1 : -1;
    prevTab.current = tab;
  }
  useLayoutEffect(() => {
    if (focus) return undefined;
    const place = () => {
      if (window.matchMedia('(max-width: 640px)').matches) {
        setPill(null);
        return;
      }
      const el = tabRefs.current[tab];
      if (el) {
        const next = { left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop, height: el.offsetHeight };
        setPill((current) => current && Object.keys(next).every((key) => current[key] === next[key]) ? current : next);
      }
    };
    place();
    // Fonts and alert counts can resize a tab without resizing the window.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (navRef.current) observer?.observe(navRef.current);
    Object.values(tabRefs.current).forEach((el) => { if (el) observer?.observe(el); });
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [tab, focus, tabs.length]);
  return (
    <div className={`app${focus ? ' focus' : ''}`}>
      {!focus && (
        <>
          <header className="topbar">
            <div className="brand">
              <Logo /> <span className="brand-name">{APP_NAME}</span>
            </div>
            <span className="team-name" title={s.teams.size === 1 ? [...s.teams.values()][0].name : `${s.teams.size} teams`}>
              {s.teams.size === 1 ? [...s.teams.values()][0].name : `${s.teams.size} teams`}
            </span>
            <div className="account-name" title={`${s.profile.name} (${s.profile.role})`}>
              <button className="ghost avatar-btn" onClick={() => setEditingPicture(true)}
                aria-label="Change your profile picture" title="Change your profile picture">
                <Avatar name={s.profile.name} uid={s.user.uid} size={34} />
              </button>
              <b>{s.profile.name}</b> <span className="muted small">{s.profile.role}</span>
            </div>
            <div className="header-actions">
              <a className="merch-header-link" href="/merch" title="Explore the Dot merchandise collection">
                <span aria-hidden="true">✨</span> Dot merch
              </a>
              <button className="ghost small-btn tutorial-btn" data-tour="tutorial" aria-label="Open tutorial" title="Open tutorial" onClick={() => setTouring(true)}>
                <span className="tutorial-icon" aria-hidden>?</span><span className="tutorial-label">Tutorial</span>
              </button>
              <ThemeToggle />
              <button className="ghost small-btn logout-btn" onClick={logOut}>Log out</button>
            </div>
          </header>
          <nav className="tabs" ref={navRef} aria-label="Main navigation">
            {pill && <span className="tab-pill" aria-hidden="true" style={pill} />}
            {tabs.map(([id, label, shortLabel, Icon]) => (
              <button key={id} ref={(el) => { tabRefs.current[id] = el; }} className={id === tab ? 'active' : ''} aria-current={id === tab ? 'page' : undefined} onClick={() => setTab(id)}>
                <span className="tab-desktop">{label}</span>
                <span className="tab-phone">
                  <span className="tab-icon"><Icon />{id === 'roster' && unread > 0 && (
                    <span className="tab-badge" aria-label={unread + ' unread alerts'}>{unread}</span>
                  )}</span>
                  <span>{shortLabel}</span>
                </span>
              </button>
            ))}
          </nav>
        </>
      )}
      {s.error && <div className="callout danger">{s.error}</div>}
      <main>
        {!focus && s.profile.role === 'athlete' && <InviteOffer />}
        {focus ? children : (
          <div key={tab} className={`page-slide ${dirRef.current > 0 ? 'from-right' : 'from-left'}`}>{children}</div>
        )}
      </main>
      <SyncStatus s={s} />
      {!focus && (
        <footer className="muted small">
          Screening tool, not a diagnosis. Any athlete with a suspected concussion should be
          removed from play and evaluated by a clinician.{' '}
          <button type="button" className="link" onClick={() => setPrivacy(true)}>Privacy</button>
          {' · '}<a href="/merch">Dot collection · Coming soon</a>
        </footer>
      )}
      {privacy && <PrivacyDialog onClose={() => setPrivacy(false)} />}
      {editingPicture && <ProfilePicture onClose={() => setEditingPicture(false)} />}
      {touring && !focus && <Tour role={s.profile.role} setTab={setTab} onClose={endTour} />}
    </div>
  );
}

function AthleteApp({ s }) {
  const me = s.user.uid;
  const [tab, setTab] = usePersisted('tab:athlete', 'me');
  const [pick, setPick] = usePersisted('pick:athlete', { subjectUid: null, testId: null });
  useScreenTop(tab);
  const members = [...s.members.values()].sort((a, b) => a.name.localeCompare(b.name));
  const people = [{ uid: me, name: s.profile.name, teamIds: teamIdsOf(s.profile) }, ...members.filter((m) => m.uid !== me)];
  const openTest = (testId) => {
    setPick({ subjectUid: me, testId });
    setTab('test');
  };

  return (
    <Frame
      s={s}
      tab={tab}
      focus={tab === 'test' && !!pick.subjectUid && !!pick.testId}
      setTab={(t) => { if (t === 'test') setPick({ subjectUid: null, testId: null }); setTab(t); }}
      tabs={[['me', 'My dashboard', 'Dashboard', HomeIcon], ['test', 'Run a test', 'Test', SymptomsIcon], ['history', 'My history', 'History', HistoryIcon], ['team', 'Team', 'Team', UsersIcon], ['learn', 'Learn more', 'Learn', BookIcon]]}
    >
      {tab === 'me' && <Overview subjectUid={me} isSelf onOpenTest={openTest} />}
      {tab === 'test' && <RunTest teams={s.teams} people={people} selfUid={me} isCoach={false} pick={pick} setPick={setPick} />}
      {tab === 'history' && <History subjectUid={me} subjectName={s.profile.name} isSelf names={nameMap(s)} />}
      {tab === 'team' && <AthleteTeam teams={s.teams} members={members} history={s.history.get(me)} />}
      {tab === 'learn' && <Guide />}
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
  useScreenTop(`${tab}:${player}:${playerTab}`);
  const selected = members.find((m) => m.uid === player);
  const alerts = useCoachAlerts(s.user.uid, names);
  const openPlayer = (uid) => { setPlayer(uid); setPlayerTab('dashboard'); setTab('roster'); };

  const openTestFor = (uid, testId) => {
    setPick({ subjectUid: uid, testId });
    setTab('test');
  };

  return (
    <Frame
      s={s}
      tab={tab}
      focus={tab === 'test' && !!pick.subjectUid && !!pick.testId}
      setTab={(t) => {
        if (t === 'roster') setPlayer(null);
        if (t === 'test') setPick({ subjectUid: null, testId: null });
        setTab(t);
      }}
      unread={alerts.unread.length}
      tabs={[
        ['roster', <>Home{alerts.unread.length > 0 && (
          <span className="tab-badge" aria-label={`${alerts.unread.length} unread alerts`}>{alerts.unread.length}</span>
        )}</>, 'Home', HomeIcon],
        ['test', 'Run a check', 'Check', SymptomsIcon],
        ['team', 'Team', 'Team', UsersIcon],
        ['learn', 'Learn more', 'Learn', BookIcon],
      ]}
    >
      {tab === 'roster' && !selected && (
        <Roster
          members={members}
          teams={s.teams}
          coachName={s.profile.name}
          onOpen={(uid) => { setPlayer(uid); setPlayerTab('dashboard'); }}
          alerts={alerts}
          names={names}
          onOpenPlayer={openPlayer}
          onRunCheck={() => { setPick({ subjectUid: null, testId: null }); setTab('test'); }}
        />
      )}
      {tab === 'roster' && selected && (
        <section>
          <div className="row player-head">
            <button className="ghost small-btn" onClick={() => setPlayer(null)}><BackIcon size={16} /> Roster</button>
            <span className="grow" />
            <div className="seg">
              {[['dashboard', 'Dashboard'], ['history', 'History']].map(([id, label]) => (
                <button key={id} className={playerTab === id ? 'on' : ''} onClick={() => setPlayerTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <HistoryLine history={s.history.get(selected.uid)} />
          {playerTab === 'dashboard' ? (
            <Overview subjectUid={selected.uid} isSelf={false} onOpenTest={(testId) => openTestFor(selected.uid, testId)} />
          ) : (
            <History subjectUid={selected.uid} subjectName={selected.name} isSelf={false} names={names} />
          )}
        </section>
      )}
      {tab === 'test' && <RunTest teams={s.teams} people={members} selfUid={null} isCoach pick={pick} setPick={setPick} />}
      {tab === 'team' && <CoachTeam teams={s.teams} members={members} names={names} />}
      {tab === 'learn' && <Guide />}
    </Frame>
  );
}
