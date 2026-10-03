import { useState } from 'react';
import { saveHistory } from '../lib/session.js';

// Pre-existing conditions that shift baselines and recovery: prior
// concussions, ADHD, vision problems, vestibular (balance) problems. Entered
// by the athlete, shown to the coach beside results. Lives in
// teams/{id}/history/{uid}, readable only by the athlete and the coach,
// never on the member doc the whole team can see.

const FLAGS = [
  ['adhd', 'ADHD'],
  ['vision', 'Vision problems'],
  ['vestibular', 'Balance or inner-ear problems'],
];

// "2 prior concussions · ADHD" or null when nothing is recorded.
export function describeHistory(h) {
  if (!h) return null;
  const parts = [];
  if (h.concussions > 0) parts.push(`${h.concussions} prior concussion${h.concussions === 1 ? '' : 's'}`);
  for (const [key, label] of FLAGS) if (h[key]) parts.push(label);
  return parts.length ? parts.join(' · ') : null;
}

// One line for the coach, beside an athlete's results.
export function HistoryLine({ history }) {
  const text = describeHistory(history);
  if (!text) return null;
  return (
    <p className="history-line" title="Pre-existing conditions the athlete recorded. These shift baselines and recovery.">
      <b>History:</b> {text}
    </p>
  );
}

// The athlete's own form.
export function HistoryForm({ history }) {
  const [concussions, setConcussions] = useState(history?.concussions ?? 0);
  const [flags, setFlags] = useState(
    Object.fromEntries(FLAGS.map(([key]) => [key, !!history?.[key]])),
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveHistory({ concussions, ...flags });
      setSaved(true);
    } catch (e) {
      setError(e?.message || 'Couldn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="history-form panel" data-tour="history-form">
      <h3>Medical history <span className="muted small">(optional)</span></h3>
      <p className="muted small">
        These change what a normal result looks like and how long recovery takes, so your coaches
        see them next to your results. Only you and your coaches can see this.
      </p>
      <label className="history-count">
        Prior concussions
        <input
          type="number" min="0" max="20" inputMode="numeric"
          value={concussions}
          onChange={(e) => setConcussions(e.target.value)}
        />
      </label>
      {FLAGS.map(([key, label]) => (
        <label className="history-flag" key={key}>
          <input
            type="checkbox"
            checked={flags[key]}
            onChange={(e) => setFlags({ ...flags, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
      {error && <div className="callout danger">{error}</div>}
      <div className="row">
        <button className="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="saved">Saved.</span>}
      </div>
    </div>
  );
}
