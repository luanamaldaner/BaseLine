import { useState } from 'react';
import { createProfile, createTeam, joinTeam, logOut } from '../lib/session.js';

function Shell({ title, intro, children, email }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand gate-brand">
          <span className="logo" aria-hidden>◎</span> Baseline
        </div>
        <h1>{title}</h1>
        {intro && <p className="muted">{intro}</p>}
        {children}
        <p className="muted small gate-account">
          Signed in as {email} ·{' '}
          <button type="button" className="link" onClick={logOut}>Log out</button>
        </p>
      </div>
    </div>
  );
}

// Step 1: coach or athlete, and a display name.
export function ProfileSetup({ email }) {
  const [role, setRole] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createProfile(role, name);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Shell title="Are you a coach or an athlete?" email={email}>
      <form className="setup-form" onSubmit={submit}>
        <div className="role-pick">
          {[
            ['athlete', 'Athlete', 'Record your baselines, see your own results, and test teammates after a hit.'],
            ['coach', 'Coach', 'Create a team, see every player’s results, and run checks on anyone.'],
          ].map(([id, label, text]) => (
            <button
              type="button"
              key={id}
              className={`role-card ${role === id ? 'on' : ''}`}
              onClick={() => setRole(id)}
              aria-pressed={role === id}
            >
              <b>{label}</b>
              <span className="muted small">{text}</span>
            </button>
          ))}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={role === 'coach' ? 'Your name (e.g. Coach Rivera)' : 'Your name'}
          aria-label="Your name"
          maxLength={60}
        />
        <p className="muted small">You can’t switch between coach and athlete later.</p>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit" disabled={!role || !name.trim() || busy}>
          Continue
        </button>
      </form>
    </Shell>
  );
}

// Step 2: coach creates a team; athlete joins with a code.
export function TeamSetup({ role, email, notice }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const coach = role === 'coach';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (coach) await createTeam(value);
      else await joinTeam(value);
    } catch (err) {
      setError(
        err.code === 'permission-denied'
          ? coach
            ? 'Couldn’t create the team. Try again.'
            : 'That code didn’t work. Check it with your coach.'
          : err.message,
      );
      setBusy(false);
    }
  }

  return (
    <Shell
      title={coach ? 'Create your team' : 'Join your team'}
      intro={
        coach
          ? 'You’ll get a 6-character code to give your athletes.'
          : 'Enter the 6-character code from your coach.'
      }
      email={email}
    >
      {notice && <div className="callout warn small">{notice}</div>}
      <form className="setup-form" onSubmit={submit}>
        <input
          value={value}
          onChange={(e) => setValue(coach ? e.target.value : e.target.value.toUpperCase())}
          placeholder={coach ? 'Team name (e.g. UF Club Soccer)' : 'Team code'}
          aria-label={coach ? 'Team name' : 'Team code'}
          maxLength={coach ? 60 : 7}
          autoCapitalize={coach ? 'words' : 'characters'}
          autoComplete="off"
          className={coach ? '' : 'code-input'}
        />
        {error && <div className="form-error">{error}</div>}
        <button className="primary" type="submit" disabled={!value.trim() || busy}>
          {busy ? 'One moment…' : coach ? 'Create team' : 'Join team'}
        </button>
      </form>
    </Shell>
  );
}
