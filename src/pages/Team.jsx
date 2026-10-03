import { useEffect, useState } from 'react';
import { TESTS, RESULT_TESTS } from '../tests/registry.js';
import { exportCsv } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen, baselinesComplete } from '../lib/status.js';
import { removeMember, leaveTeam, createTeam, joinTeam, lookupTeam, useSession, teamIdsOf } from '../lib/session.js';
import { download } from './History.jsx';
import Avatar from '../components/Avatar.jsx';
import QrCode from '../components/QrCode.jsx';
import { inviteUrl, pendingInvite, clearInvite } from '../lib/invite.js';
import { AlertsPanel } from '../components/Alerts.jsx';
import { UsersIcon, ShieldIcon, PulseIcon, AlertIcon, ArrowIcon } from '../components/Icons.jsx';

const RANK = { refer: 0, monitor: 1, normal: 2, none: 3 };

export function playerSummary(uid) {
  const checks = RESULT_TESTS.map((t) => latestCheck(uid, t));
  const overall = overallStatus(checks) ?? 'none';
  const lastCheck = checks.filter(Boolean).map((c) => c.trial.at).sort().pop() ?? null;
  const baselinesDone = baselinesComplete(uid);
  return { overall, lastCheck, baselinesDone };
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

// Coach home: a way straight into a check, team numbers, and everyone on the
// team with flagged players first.
export function Roster({ members, teams, coachName, onOpen, onRunCheck, alerts, names, onOpenPlayer }) {
  const [filter, setFilter] = useState('');
  const rows = members.filter((m) => !filter || m.teamIds.includes(filter))
    .map((m) => ({ ...m, ...playerSummary(m.uid) }))
    .sort((a, b) => RANK[a.overall] - RANK[b.overall] || a.name.localeCompare(b.name));
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
  const stats = [
    { label: 'Athletes', value: rows.length, Icon: UsersIcon, tone: '' },
    { label: 'Baselines complete', value: rows.filter((r) => r.baselinesDone === TESTS.length).length, Icon: ShieldIcon, tone: '' },
    { label: 'Checked this week', value: rows.filter((r) => r.lastCheck && r.lastCheck >= weekAgo).length, Icon: PulseIcon, tone: 'gold' },
    { label: 'Need attention', value: rows.filter((r) => r.overall === 'refer' || r.overall === 'monitor').length, Icon: AlertIcon, tone: 'danger' },
  ];

  return (
    <section className="home-grid">
      {alerts && (
        <AlertsPanel
          unread={alerts.unread} names={names} onOpen={onOpenPlayer}
          onDismiss={alerts.dismiss} onDismissAll={alerts.dismissAll}
        />
      )}
      <div className="hero">
        <p className="eyebrow">{greeting()}{coachName ? `, ${coachName.split(' ')[0]}` : ''}</p>
        <h1>Someone took a hit?</h1>
        <p className="hero-sub">Run a full check in about 4 minutes. We’ll guide you through every step and give you a clear call.</p>
        <button className="primary big-btn" onClick={onRunCheck}>
          Run a check <ArrowIcon size={20} />
        </button>
      </div>

      <div className="stats" aria-label="Team summary">
        {stats.map(({ label, value, Icon, tone }) => (
          <div className={`stat ${tone}`} key={label}>
            <span className="stat-icon"><Icon size={22} /></span>
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </div>
        ))}
      </div>

      <div className="home-section">
        <div className="section-head">
          <h2>Roster</h2>
          {teams.size > 1 && <select aria-label="Filter by team" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All teams</option>
            {[...teams.values()].map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>}
          {rows.length > 0 && <span className="muted small">Flagged players first. Tap one to see their results.</span>}
        </div>
        {!rows.length ? (
          <div className="empty">
            <UsersIcon size={36} />
            <p><b>No athletes yet.</b> Give them the team code from the Team tab.</p>
          </div>
        ) : (
          <ul className="athlete-list">
            {rows.map((r) => {
              const st = STATUS[r.overall];
              return (
                <li key={r.uid}>
                  <button className="athlete-card" data-status={st?.cls} onClick={() => onOpen(r.uid)}>
                    <Avatar name={r.name} />
                    <span className="athlete-main">
                      <b>{r.name}</b>
                      <span className="team-tags">{r.teamIds.map((id) => <span className="chip muted" key={id}>{teams.get(id)?.name}</span>)}</span>
                      <span className="muted small">
                        {r.lastCheck ? `Checked ${formatWhen(r.lastCheck)}` : 'No checks yet'}
                      </span>
                    </span>
                    <Ring done={r.baselinesDone} total={TESTS.length} />
                    <span className={`chip ${st?.cls ?? 'muted'}`}>{st ? st.short : 'No checks'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// How many tests have a full baseline, as a small ring.
function Ring({ done, total }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" title={`Baselines complete for ${done} of ${total} tests`}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <circle cx="20" cy="20" r={r} className="ring-track" />
        {done > 0 && (
          <circle cx="20" cy="20" r={r} className="ring-fill"
            strokeDasharray={`${(done / total) * c} ${c}`} transform="rotate(-90 20 20)" />
        )}
      </svg>
      <span className="ring-text" aria-hidden>{done}/{total}</span>
      <span className="sr-only">Baselines complete for {done} of {total} tests</span>
    </span>
  );
}

// Coach: join code + manage athletes.
function CoachTeamCard({ team, members, names }) {
  const [copied, setCopied] = useState(null); // 'code' | 'link'
  const link = inviteUrl(team.code);
  const copy = (what, text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const share = async () => {
    const text = `Join ${team.name} on Baseline: ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${team.name}`, text, url: link });
      } catch {
        /* cancelled */
      }
    } else copy('link', link);
  };
  const remove = (m) => {
    if (confirm(`Remove ${m.name} from ${team.name}? Their results stay saved.`)) {
      removeMember(team.id, m.uid).catch((e) => alert(`Couldn't remove: ${e.message}`));
    }
  };

  return (
    <section className="team-page">
      <h2>{team.name}</h2>
      <div className="code-card invite-card">
        <div className="invite-qr">
          <QrCode text={link} label={`QR code to join ${team.name}`} />
        </div>
        <div className="invite-info">
          <span className="muted small">Scan to join</span>
          <p className="small">
            Athletes point their phone camera here. It opens the app with this team filled in.
          </p>
          <span className="muted small">Or use the team code</span>
          <div className="code">{team.code}</div>
          <div className="row">
            <button className="small-btn" onClick={() => copy('code', team.code)}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </button>
            <button className="small-btn" onClick={share}>
              {copied === 'link' ? 'Link copied' : 'Share invite link'}
            </button>
          </div>
        </div>
      </div>
      <div className="row">
        <h3 className="grow">Athletes ({members.length})</h3>
        <button
          className="small-btn"
          disabled={!members.length}
          onClick={() => download(`${team.name.replace(/[^\w-]+/g, '_')}-results.csv`, exportCsv(members.map((m) => m.uid), names))}
        >
          Download team CSV
        </button>
      </div>
      <div className="trial-list">
        {members.map((m) => (
          <div className="trial member" key={m.uid}>
            <div className="trial-main">
              <b>{m.name}</b>
              <div className="muted small">Joined {formatWhen(m.joinedAt)}</div>
            </div>
            <button className="ghost small-btn danger-text" onClick={() => remove(m)}>Remove</button>
          </div>
        ))}
      </div>
    </section>
  );
}

// Athlete: their team + leave.
function AthleteTeamCard({ team, members }) {
  const leave = () => {
    if (confirm(`Leave ${team.name}? Your results stay in your record.`)) {
      leaveTeam(team.id).catch((e) => alert(`Couldn't leave: ${e.message}`));
    }
  };
  return (
    <section className="team-page">
      <h2>{team.name}</h2>
      <p className="muted">Coach: {team.coachName}</p>
      <h3>Teammates ({members.length})</h3>
      <ul className="teammates">
        {members.map((m) => <li key={m.uid}>{m.name}</li>)}
      </ul>
      <p className="muted small">
        You can run post-hit checks on any teammate. You only ever see your own numbers; your
        coach sees everyone’s.
      </p>
      <button className="danger-btn" onClick={leave}>Leave team</button>
    </section>
  );
}

export function CoachTeam({ teams, members, names }) {
  return <div className="team-pages">
    {[...teams.values()].map((team) => <CoachTeamCard key={team.id} team={team}
      members={members.filter((m) => m.teamIds.includes(team.id))} names={names} />)}
    <TeamForm coach />
  </div>;
}

export function AthleteTeam({ teams, members }) {
  return <div className="team-pages">
    {[...teams.values()].map((team) => <AthleteTeamCard key={team.id} team={team}
      members={members.filter((m) => m.teamIds.includes(team.id))} />)}
    <TeamForm />
  </div>;
}

function TeamForm({ coach = false }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      if (coach) await createTeam(value);
      else await joinTeam(value);
      setValue('');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>{coach ? 'Create another team' : 'Join another team'}</h2>
    <form className="setup-form" onSubmit={submit}>
      <input aria-label={coach ? 'Team name' : 'Team code'} placeholder={coach ? 'Team name' : 'Team code'}
        maxLength={coach ? 60 : 6} value={value} onChange={(e) => setValue(coach ? e.target.value : e.target.value.toUpperCase())} />
      {error && <div className="form-error">{error}</div>}
      <button className="primary" disabled={busy || !value.trim()}>{busy ? 'One moment…' : coach ? 'Create team' : 'Join team'}</button>
    </form>
  </section>;
}

export function InviteOffer() {
  const s = useSession();
  const [code, setCode] = useState(pendingInvite);
  const [team, setTeam] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const dismiss = () => { clearInvite(); setCode(null); };
  useEffect(() => {
    if (!code) return;
    let active = true;
    lookupTeam(code).then((t) => {
      if (!active) return;
      if (teamIdsOf(s.profile).includes(t.id)) dismiss();
      else setTeam(t);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [code, s.profile]);
  if (!code) return null;
  async function join() {
    setBusy(true); setError(null);
    try { await joinTeam(code); dismiss(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="callout">
    <h2>{team ? 'Join ' + team.name + '?' : 'Team invite'}</h2>
    {error && <p className="form-error">{error}</p>}
    <div className="row">
      <button className="primary" disabled={!team || busy} onClick={join}>{busy ? 'Joining…' : 'Join team'}</button>
      <button className="ghost" disabled={busy} onClick={dismiss}>Dismiss</button>
    </div>
  </section>;
}
