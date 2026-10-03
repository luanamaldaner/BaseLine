import { useState } from 'react';
import { recordConsent, logOut } from '../lib/session.js';
import { Brand, APP_NAME } from '../brand.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

// What the app collects and who sees it. Shown once before first use, and
// any time from the footer.
export function PrivacyNotice() {
  return (
    <div className="privacy">
      <h3>A screening tool, not a diagnosis</h3>
      <p>
        {APP_NAME} compares an athlete to their own healthy baseline and flags changes. It can’t
        diagnose or rule out a concussion. Anyone with a suspected concussion should be removed
        from play and seen by a clinician, whatever the app says.
      </p>

      <h3>What’s saved</h3>
      <ul>
        <li>Your name, email (for logging in), and team.</li>
        <li>Test results: scores like sway, reaction time, and eye-tracking numbers, with the date and who ran the test.</li>
        <li>
          <b>No video or sensor recordings.</b> The camera and motion sensor are processed on the
          phone or laptop running the test; only the final scores are saved.
        </li>
      </ul>

      <h3>Who sees it</h3>
      <ul>
        <li><b>You</b> see all of your own results.</li>
        <li><b>Your coach</b> sees results for everyone on the team.</li>
        <li>
          <b>A teammate who tests you</b> sees only the call (for example “Remove from play”),
          never your numbers. To make that call, teammates’ phones receive your baseline cutoffs,
          not your results.
        </li>
        <li>Nobody outside your team can see your data.</li>
      </ul>

      <h3>Deleting</h3>
      <p>
        You can delete any of your own results, and your coach can delete any result on the team.
        Leaving a team stops you from using it; to delete your account entirely, ask your coach or
        the app’s team.
      </p>

      <h3>Under 18?</h3>
      <p>A parent or guardian should read this and agree before you use the app.</p>
    </div>
  );
}

// One-time agreement before using the app.
export function ConsentScreen({ email }) {
  const [screening, setScreening] = useState(false);
  const [data, setData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await recordConsent();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <ThemeToggle fab />
      <div className="gate-card consent-card">
        <Brand className="gate-brand" />
        <h1>Before you start</h1>
        <PrivacyNotice />
        <label className="check">
          <input type="checkbox" checked={screening} onChange={(e) => setScreening(e.target.checked)} />
          <span>I understand {APP_NAME} is a screening tool, not a diagnosis.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={data} onChange={(e) => setData(e.target.checked)} />
          <span>I agree to how my data is used above. If I’m under 18, a parent or guardian agrees too.</span>
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary" onClick={agree} disabled={!screening || !data || busy}>
          {busy ? 'One moment…' : 'Agree and continue'}
        </button>
        <p className="muted small gate-account">
          Signed in as {email} ·{' '}
          <button type="button" className="link" onClick={logOut}>Log out</button>
        </p>
      </div>
    </div>
  );
}

// The notice as a dialog, opened from the footer.
export function PrivacyDialog({ onClose }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Privacy" onClick={(e) => e.stopPropagation()}>
        <div className="row dialog-head">
          <h2 className="grow">Privacy</h2>
          <button className="ghost small-btn" onClick={onClose}>Close</button>
        </div>
        <PrivacyNotice />
      </div>
    </div>
  );
}
