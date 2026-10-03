// Reading results and comparing them to an athlete's baseline.
//
// Results from the athlete record and legacy teams are merged by session.js.
// Athletes receive their own results; coaches receive their athletes' records.
// Scoring comes from shared/assess.js.

import { getSession } from './session.js';
import { SPECS, summarize, compareToSummary, spreadFor, FLAG_Z } from '../../shared/assess.js';

export { BASELINE_TRIALS } from '../../shared/assess.js';

const trials = () => [...getSession().trials.values()];

// One athlete's results for one test, oldest first.
export function getTrials(subjectUid, test) {
  return trials()
    .filter((t) => t.subjectUid === subjectUid && t.test === test)
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Every result for an athlete, newest first.
export function allTrials(subjectUid) {
  return trials()
    .filter((t) => t.subjectUid === subjectUid)
    .sort((a, b) => b.at.localeCompare(a.at));
}

// Baseline summary; `before` (ISO time) limits it to baselines recorded
// before then, so an old check is judged against the baseline of its day.
export function summarizeBaseline(subjectUid, test, before) {
  return summarize(
    getTrials(subjectUid, test).filter((t) => t.kind === 'baseline' && (!before || t.at < before)),
  );
}

export function compare(subjectUid, test, metrics, before) {
  return compareToSummary(summarizeBaseline(subjectUid, test, before), metrics, SPECS[test]);
}

// The band compare() treats as normal for one metric: mean ± 2 spreads.
export function usualRange(subjectUid, test, metric) {
  const s = summarizeBaseline(subjectUid, test)?.stats[metric];
  const def = SPECS[test][metric];
  if (!s || !def) return null;
  const spread = spreadFor(s, def);
  return { lo: s.mean - FLAG_Z * spread, hi: s.mean + FLAG_Z * spread };
}

// One row per result, every metric as a column. names: uid -> display name.
export function exportCsv(subjectUids, names) {
  const rows = subjectUids.flatMap((uid) =>
    allTrials(uid).map((t) => ({
      athlete: names.get(uid) ?? uid,
      test: t.test,
      at: t.at,
      kind: t.kind,
      status: t.status ?? '',
      tested_by: names.get(t.testerUid) ?? '',
      rested: t.conditions?.rested ?? '',
      place: t.conditions?.place ?? '',
      light: t.conditions?.light ?? '',
      device: t.conditions?.device ?? '',
      heat: t.conditions?.heat ?? '',
      pain: t.conditions?.pain ?? '',
      ...t.metrics,
    })),
  );
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
