import { useRef, useState } from 'react';
import { recordConsent, logOut } from '../lib/session.js';
import { Brand, APP_NAME } from '../brand.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

// What the app collects and who sees it. Shown once before first use, and
// any time from the footer.
export function PrivacyNotice() {
  return (
    <div className="privacy">
      <p className="muted small">Updated October 3, 2026</p>
      <h3>Notice for parents and guardians</h3>
      <p>
        If you’re under 18, a parent or guardian must read this notice and agree before you
        use {APP_NAME}. Please review what the app saves and who can see it together.
      </p>

      <h3>A screening tool, not a diagnosis</h3>
      <p>
        {APP_NAME} compares an athlete to their own healthy baseline and flags changes. It can’t
        diagnose or rule out a concussion. Anyone with a suspected concussion should be removed
        from play and seen by a clinician, whatever the app says.
      </p>

      <h3>What’s saved</h3>
      <ul>
        <li>Your name, sign-in email, role, team memberships, and the date of your consent. Older accounts may retain a previously recorded age-confirmation date; the app no longer requests it or collects a date of birth.</li>
        <li>Test scores, screening calls, baseline cutoffs, dates, who was tested, and who ran each test.</li>
        <li>Testing conditions, such as rest, pain, heat, a quiet or sideline setting, lighting, and device type.</li>
        <li>Medical history you enter: prior concussions, ADHD, vision, and vestibular or balance problems.</li>
        <li>Your optional profile photo or Dot picture. Uploaded photos are cropped and resized.</li>
        <li>
          <b>No raw camera video or motion recordings are uploaded.</b> Test measurements are
          processed on the testing device; the app saves the resulting scores. An optional
          profile photo is a separate uploaded image.
        </li>
      </ul>

      <h3>Who sees it</h3>
      <ul>
        <li><b>You</b> see all of your own results.</li>
        <li><b>Coaches of your current teams</b> can read and delete your full saved result history, including results from other teams, and see the medical history shared with their team.</li>
        <li>
          <b>Teammates</b> can see team rosters, profile pictures, and derived baseline cutoffs.
          A teammate testing you sees the screening call in the results screen and cannot browse
          your saved record. Their device still processes your current measurement and may keep
          a queued result locally while uploading it.
        </li>
        <li>Signed-in users who look up a team can see its name, coach, and invitation details.</li>
        <li>Authorized project administrators can access cloud data. Google Firebase processes data to provide the app’s sign-in, hosting, and database services.</li>
      </ul>

      <h3>Cloud and device storage</h3>
      <p>
        Firebase Authentication manages sign-in; Firebase Realtime Database stores the active
        shared records. Your browser keeps sign-in state, preferences, and a durable queue of
        results awaiting upload, including checks you run on teammates. Older database caches
        may remain on previously used devices. Signing out does not erase all local data;
        clearing browser data can lose results that have not finished syncing.
      </p>
      <p>See Firebase’s <a href="https://firebase.google.com/support/privacy" target="_blank" rel="noreferrer">privacy and security information</a> for its processing of technical service data.</p>

      <h3>Leaving a team and deleting data</h3>
      <p>
        Leaving or being removed from a team removes that membership and its copies of your
        medical history, picture, and cutoffs. It stops that coach’s future access to your saved
        results unless you still share another team with them. Your own results remain saved.
      </p>
      <p>
        You can delete your own results; authorized coaches can also delete them. This removes
        the active result, but does not automatically erase legacy database copies, administrative
        backups, exports, or data already retained on other devices. Full account deletion is not
        available in the app. Ask the app administrator about account and stored-copy deletion;
        your coach can help you reach them.
      </p>
    </div>
  );
}

// One-time agreement before using the app.
export function ConsentScreen({ email, profile }) {
  const needsConsent = !profile?.consentedAt;
  const [screening, setScreening] = useState(false);
  const [data, setData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const busyRef = useRef(false);
  const canContinue = !needsConsent || (screening && data);

  async function agree() {
    if (!canContinue || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await recordConsent();
    } catch (e) {
      setError(e.message);
    } finally {
      busyRef.current = false;
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
        {needsConsent && <>
        <label className="check">
          <input type="checkbox" checked={screening} disabled={busy} onChange={(e) => setScreening(e.target.checked)} />
          <span>I understand {APP_NAME} is a screening tool, not a diagnosis.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={data} disabled={busy} onChange={(e) => setData(e.target.checked)} />
          <span>I agree to how my data is used above. If I’m under 18, a parent or guardian has read this notice and agrees too.</span>
        </label>
        </>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="primary" onClick={agree} disabled={!canContinue || busy}>
          {busy ? 'One moment…' : needsConsent ? 'Agree and continue' : 'Confirm and continue'}
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
