import { useState } from 'react';
import { TESTS, RESULT_TESTS } from '../tests/registry.js';
import { exportCsv } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen, baselinesComplete } from '../lib/status.js';
import { removeMember, leaveTeam } from '../lib/session.js';
import { download } from './History.jsx';
import Avatar from '../components/Avatar.jsx';
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
export function Roster({ members, coachName, onOpen, onRunCheck }) {
  const rows = members
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
        <circle cx="20" cy="20" r={r} className="ring-fill"
          strokeDasharray={`${(done / total) * c} ${c}`} transform="rotate(-90 20 20)" />
      </svg>
      <span className="ring-text" aria-hidden>{done}/{total}</span>
      <span className="sr-only">Baselines complete for {done} of {total} tests</span>
    </span>
  );
}

// Coach: join code + manage athletes.
export function CoachTeam({ team, members, names }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(team.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const remove = (m) => {
    if (confirm(`Remove ${m.name} from ${team.name}? Their results stay saved.`)) {
      removeMember(m.uid).catch((e) => alert(`Couldn't remove: ${e.message}`));
    }
  };

  return (
    <section className="team-page">
      <h2>{team.name}</h2>
      <div className="code-card">
        <span className="muted small">Team code</span>
        <div className="code">{team.code}</div>
        <button className="small-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <p className="muted small">
          Athletes sign up, choose <b>Athlete</b>, and enter this code.
        </p>
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
export function AthleteTeam({ team, members }) {
  const leave = () => {
    if (confirm(`Leave ${team.name}? Your results stay with the team's coach.`)) {
      leaveTeam().catch((e) => alert(`Couldn't leave: ${e.message}`));
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
