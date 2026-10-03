import { useState } from 'react';
import { TESTS } from '../tests/registry.js';
import { summarizeBaseline, exportCsv, BASELINE_TRIALS } from '../lib/baseline.js';
import { STATUS, latestCheck, overallStatus, formatWhen } from '../lib/status.js';
import { removeMember, leaveTeam } from '../lib/session.js';
import { download } from './History.jsx';

const RANK = { refer: 0, monitor: 1, normal: 2, none: 3 };

export function playerSummary(uid) {
  const checks = TESTS.map((t) => latestCheck(uid, t));
  const overall = overallStatus(checks) ?? 'none';
  const lastCheck = checks.filter(Boolean).map((c) => c.trial.at).sort().pop() ?? null;
  const baselinesDone = TESTS.filter((t) => (summarizeBaseline(uid, t.id)?.n ?? 0) >= BASELINE_TRIALS).length;
  return { overall, lastCheck, baselinesDone };
}

// Coach: everyone on the team, flagged players first.
export function Roster({ members, onOpen }) {
  const rows = members
    .map((m) => ({ ...m, ...playerSummary(m.uid) }))
    .sort((a, b) => RANK[a.overall] - RANK[b.overall] || a.name.localeCompare(b.name));

  if (!rows.length) {
    return <div className="callout">No athletes yet. Give them the team code from the Team tab.</div>;
  }

  return (
    <section className="roster">
      <h2>Roster</h2>
      <div className="roster-list">
        {rows.map((r) => {
          const s = STATUS[r.overall];
          return (
            <button key={r.uid} className={`roster-row ${s?.cls ?? ''}`} onClick={() => onOpen(r.uid)}>
              <span className="roster-name">{r.name}</span>
              <span className="roster-meta muted small">
                Baselines {r.baselinesDone}/{TESTS.length}
                {r.lastCheck ? ` · checked ${formatWhen(r.lastCheck)}` : ''}
              </span>
              <span className={`chip ${s?.cls ?? 'muted'}`}>{s ? s.short : 'No checks'}</span>
            </button>
          );
        })}
      </div>
    </section>
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
