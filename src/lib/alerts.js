// Alerts for the coach: a post-hit check someone else ran that came back
// yellow (monitor) or red (refer / no baseline).
//
// The coach's app already receives every team result live, so alerts are
// worked out here, with no server. "Seen" is remembered per coach on this
// device. While the app is open (even in a background tab) the browser can
// also show a system notification.

import { getSession } from './session.js';

// Tests run together (e.g. "All three") arrive as separate checks; ones on the
// same athlete within this window are one alert.
const GROUP_MS = 15 * 60 * 1000;
const RANK = { monitor: 1, refer: 2, 'no-baseline': 2 };

const seenKey = (uid) => `alerts-seen:${uid}`;

export function getSeen(uid) {
  try {
    return localStorage.getItem(seenKey(uid)) ?? '';
  } catch {
    return '';
  }
}

export function markSeen(uid, at = new Date().toISOString()) {
  try {
    localStorage.setItem(seenKey(uid), at);
  } catch {
    /* private mode: alerts just stay unread */
  }
}

// Newest first: [{ id, subjectUid, at, level: 'monitor' | 'refer', tests, testerUid }]
export function coachAlerts() {
  const s = getSession();
  const me = s.user?.uid;
  const flagged = [...s.trials.values()]
    .filter((t) => t.kind === 'check' && RANK[t.status] && t.testerUid !== me)
    .sort((a, b) => a.at.localeCompare(b.at));

  const groups = [];
  for (const t of flagged) {
    const g = groups.find((x) => x.subjectUid === t.subjectUid && Date.parse(t.at) - Date.parse(x.last) <= GROUP_MS);
    if (g) {
      g.items.push(t);
      g.last = t.at;
    } else {
      groups.push({ subjectUid: t.subjectUid, first: t.at, last: t.at, items: [t] });
    }
  }

  return groups
    .map((g) => {
      const reds = g.items.filter((t) => RANK[t.status] === 2).length;
      const yellows = g.items.length - reds;
      return {
        id: `${g.subjectUid}:${g.first}`,
        subjectUid: g.subjectUid,
        at: g.last,
        // Same rule as the overall call: any red, or two yellows, is red.
        level: reds || yellows >= 2 ? 'refer' : 'monitor',
        tests: [...new Set(g.items.map((t) => t.test))],
        testerUid: g.items[g.items.length - 1].testerUid,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
