import { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '../lib/firebase.js';

const MESSAGES = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter a password.',
  'auth/weak-password': 'Use at least 6 characters for the password.',
  'auth/email-already-in-use': 'There’s already an account with that email. Log in instead.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/user-not-found': 'No account with that email.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/network-request-failed': 'No internet connection. Signing in needs a connection the first time.',
};

const friendly = (e) => MESSAGES[e?.code] ?? 'Something went wrong. Try again.';

export default function AuthScreen() {
  const [mode, setMode] = useState('login'); // login | signup | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email.trim(), password);
      else if (mode === 'signup') await createUserWithEmailAndPassword(auth, email.trim(), password);
      else {
        await sendPasswordResetEmail(auth, email.trim());
        setNotice('Check your email for a link to reset your password.');
      }
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  const switchTo = (m) => {
    setMode(m);
    setError(null);
    setNotice(null);
  };

  const title = { login: 'Log in', signup: 'Create an account', reset: 'Reset password' }[mode];

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand gate-brand">
          <span className="logo" aria-hidden>◎</span> Baseline
        </div>
        <h1>{title}</h1>
        <p className="muted">
          {mode === 'signup'
            ? 'Coaches and athletes both sign up here. Next you’ll choose which you are.'
            : mode === 'reset'
              ? 'Enter your email and we’ll send a reset link.'
              : 'Log in to your team. Your results sync across every device you use.'}
        </p>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          required
        />
        {mode !== 'reset' && (
          <input
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'signup' ? 'Password (6+ characters)' : 'Password'}
            aria-label="Password"
            required
          />
        )}
        {error && <div className="form-error">{error}</div>}
        {notice && <div className="form-notice">{notice}</div>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'One moment…' : title}
        </button>
        <div className="auth-links small">
          {mode === 'login' && (
            <>
              <button type="button" className="link" onClick={() => switchTo('signup')}>Create an account</button>
              <button type="button" className="link" onClick={() => switchTo('reset')}>Forgot password?</button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" className="link" onClick={() => switchTo('login')}>Back to log in</button>
          )}
        </div>
      </form>
    </div>
  );
}
