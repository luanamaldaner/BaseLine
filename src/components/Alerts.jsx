import { useEffect, useRef, useState } from 'react';
import { coachAlerts, getSeen, markSeen, notificationsSupported } from '../lib/alerts.js';
import { formatWhen } from '../lib/status.js';
import { testById } from '../tests/registry.js';
import { beep } from '../lib/cues.js';
import Avatar from './Avatar.jsx';

const LEVEL = {
  refer: { cls: 'bad', title: 'Remove from play', text: 'Clearly worse than their baseline.' },
  monitor: { cls: 'warn', title: 'Monitor', text: 'Slightly worse than their baseline.' },
};

// Unread alerts for the coach, plus a system notification (and a beep) for
// each new one that arrives while the app is open. Returns what the UI needs.
export function useCoachAlerts(coachUid, names) {
  const [seen, setSeen] = useState(() => getSeen(coachUid));
  const alerts = coachAlerts();
  const unread = alerts.filter((a) => a.at > seen);
  const known = useRef(null); // alert ids present when the app opened

  useEffect(() => {
    const ids = new Set(alerts.map((a) => a.id));
    if (known.current === null) {
      known.current = ids; // don't notify for old alerts on load
      return;
    }
    const fresh = alerts.filter((a) => !known.current.has(a.id) && a.at > seen);
    fresh.forEach((a) => {
      known.current.add(a.id);
      beep(a.level === 'refer' ? 660 : 880, 250);
      if (notificationsSupported() && Notification.permission === 'granted') {
        const name = names.get(a.subjectUid) ?? 'An athlete';
        new Notification(`${name}: ${LEVEL[a.level].title}`, {
          body: `${LEVEL[a.level].text} Post-hit check, ${formatWhen(a.at)}.`,
          tag: a.id,
        });
      }
    });
  });

  const dismissAll = () => {
    const at = alerts[0]?.at ?? new Date().toISOString();
    markSeen(coachUid, at);
    setSeen(at);
  };
  const dismiss = (alert) => {
    // Seen is a single "everything up to here" time; dismissing the newest
    // alert therefore clears all; an older one clears it and anything older.
    const at = alert.at > seen ? alert.at : seen;
    markSeen(coachUid, at);
    setSeen(at);
  };

  return { alerts, unread, dismiss, dismissAll };
}

export function AlertsPanel({ unread, names, onOpen, onDismiss, onDismissAll }) {
  const [perm, setPerm] = useState(() => (notificationsSupported() ? Notification.permission : 'unsupported'));

  if (!unread.length && perm !== 'default') return null;

  return (
    <section className="alerts" aria-labelledby="alerts-title" aria-live="polite">
      <div className="section-head">
        <h2 id="alerts-title">
          {unread.length ? `${unread.length} alert${unread.length === 1 ? '' : 's'}` : 'Alerts'}
        </h2>
        {unread.length > 1 && <button className="ghost small-btn" onClick={onDismissAll}>Mark all as seen</button>}
      </div>

      {perm === 'default' && (
        <div className="alert-optin">
          <span>Get a notification when a check comes back yellow or red, even if this tab is in the background.</span>
          <button className="small-btn" onClick={() => Notification.requestPermission().then(setPerm)}>
            Turn on notifications
          </button>
        </div>
      )}

      {unread.map((a) => {
        const lv = LEVEL[a.level];
        const name = names.get(a.subjectUid) ?? 'Unknown athlete';
        const by = names.get(a.testerUid);
        return (
          <div className="alert-card" data-level={lv.cls} key={a.id}>
            <Avatar name={name} uid={a.subjectUid} />
            <div className="alert-main">
              <b>{name} · <span className={lv.cls}>{lv.title}</span></b>
              <span className="muted small">
                {a.tests.map((t) => testById[t]?.label ?? t).join(', ')} · {formatWhen(a.at)}
                {by ? ` · checked by ${by}` : ''}
              </span>
            </div>
            <div className="alert-actions">
              <button className="primary small-btn" onClick={() => { onDismiss(a); onOpen(a.subjectUid); }}>View</button>
              <button className="ghost small-btn" onClick={() => onDismiss(a)} aria-label={`Dismiss alert for ${name}`}>Dismiss</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
