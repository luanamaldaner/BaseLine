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
  // null | 'local' (showing here, waiting for the server) | 'synced'
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState(null);

  // The change shows here right away; the button never waits on the server.
  async function save() {
    setError(null);
    let pending;
    try {
      pending = saveHistory({ concussions, ...flags });
    } catch (e) {
      setError(e?.message || 'Couldn’t save. Try again.');
      return;
    }
    setSaved('local');
    try {
      await pending;
      setSaved('synced');
    } catch (e) {
      setSaved(null);
      setError(/permission.denied/i.test(e?.code ?? '')
        ? 'Couldn’t share this with your coach yet: the app’s latest database update isn’t published (ask whoever deploys the app).'
        : e?.message || 'Couldn’t save. Try again.');
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
        <button className="primary" onClick={save}>Save</button>
        {saved === 'local' && <span className="muted small">Sending to your coach…</span>}
        {saved === 'synced' && <span className="saved">Saved. Your coach can see it.</span>}
      </div>
    </div>
  );
}
