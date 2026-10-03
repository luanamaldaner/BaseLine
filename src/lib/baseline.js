// Per-athlete trial storage + baseline comparison. Shared by every test.
//
// Storage: Firestore, under the signed-in account (users/{uid}/trials), via
// the live in-memory copy in store.js. The same login sees the same data on
// every device; the Firestore offline cache keeps saves working without
// signal. exportCsv() is the backup / analysis path.
//
// A trial is { at, kind, metrics: { name: number } }, where kind is
// 'baseline' (healthy, preseason) or 'check' (after a hit).
//
// Each test exports a METRICS spec telling compare() which direction is worse:
//   { medianMs: { label, unit, worse: 'higher', minSpread?: 20 }, ... }
// worse: 'higher' | 'lower' | 'away' (any change from baseline is bad).
// minSpread: smallest spread to assume, in metric units, for metrics whose
// baseline is often flat (e.g. 0 symptoms every time).

import { allTrialsRaw, putTrial, removeTrials } from './store.js';

export function listAthletes() {
  return [...new Set(allTrialsRaw().map((t) => t.athlete))].sort((a, b) => a.localeCompare(b));
}

export function getTrials(athlete, test) {
  return allTrialsRaw()
    .filter((t) => t.athlete === athlete && t.test === test)
    .sort((a, b) => a.at.localeCompare(b.at));
}

// Every trial for an athlete, newest first: [{ id, test, at, kind, metrics }]
export function allTrials(athlete) {
  return allTrialsRaw()
    .filter((t) => t.athlete === athlete)
    .map(({ id, test, at, kind, metrics }) => ({ id, test, at, kind, metrics }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function addTrial(athlete, test, kind, metrics) {
  return putTrial({ athlete, test, kind, at: new Date().toISOString(), metrics });
}

export function deleteTrial(athlete, test, at) {
  removeTrials(
    allTrialsRaw()
      .filter((t) => t.athlete === athlete && t.test === test && t.at === at)
      .map((t) => t.id),
  );
}

export function deleteAthlete(athlete) {
  removeTrials(allTrialsRaw().filter((t) => t.athlete === athlete).map((t) => t.id));
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Mean and SD of every metric across the athlete's baseline trials.
// `before` (ISO time) limits it to baselines recorded before that moment, so an
// old check is judged against the baseline that existed at the time.
export function summarizeBaseline(athlete, test, before) {
  const trials = getTrials(athlete, test).filter(
    (t) => t.kind === 'baseline' && (!before || t.at < before),
  );
  if (trials.length === 0) return null;
  const names = Object.keys(trials[0].metrics);
  const stats = {};
  for (const name of names) {
    const xs = trials.map((t) => t.metrics[name]).filter(Number.isFinite);
    if (xs.length) stats[name] = { mean: mean(xs), sd: sd(xs), n: xs.length };
  }
  return { n: trials.length, stats };
}

// With only a couple of baseline trials the SD is unreliable (often ~0), so
// never let it drop below this fraction of the mean.
const MIN_REL_SD = 0.1;
const FLAG_Z = 2;

function spreadFor(stat, def) {
  return Math.max(stat.sd, Math.abs(stat.mean) * MIN_REL_SD, def.minSpread ?? 0, 1e-9);
}

// The band compare() treats as normal for one metric: mean ± 2 spreads.
export function usualRange(athlete, test, metric, def) {
  const s = summarizeBaseline(athlete, test)?.stats[metric];
  if (!s) return null;
  const spread = spreadFor(s, def);
  return { lo: s.mean - FLAG_Z * spread, hi: s.mean + FLAG_Z * spread };
}

// Compare one trial's metrics to the athlete's baseline.
// Returns per-metric { value, mean, sd, z, flagged } and an overall status:
// 0 flags = normal, 1 = monitor, 2+ = refer.
export function compare(athlete, test, metrics, spec, before) {
  const base = summarizeBaseline(athlete, test, before);
  if (!base) return { status: 'no-baseline', rows: [] };
  const rows = [];
  for (const [name, def] of Object.entries(spec)) {
    const s = base.stats[name];
    const value = metrics[name];
    if (!s || !Number.isFinite(value)) continue;
    const spread = spreadFor(s, def);
    const z = (value - s.mean) / spread;
    const worseZ = def.worse === 'lower' ? -z : def.worse === 'away' ? Math.abs(z) : z;
    rows.push({ name, ...def, value, mean: s.mean, sd: s.sd, z, flagged: worseZ > FLAG_Z });
  }
  const flags = rows.filter((r) => r.flagged).length;
  const status = flags === 0 ? 'normal' : flags === 1 ? 'monitor' : 'refer';
  return { status, flags, baselineTrials: base.n, rows };
}

// One row per trial, every metric as a column. For backups and for analysing
// how the tests relate once there's data from many athletes.
export function exportCsv(athletes = listAthletes()) {
  const rows = athletes.flatMap((athlete) =>
    allTrials(athlete).map((t) => ({ athlete, test: t.test, at: t.at, kind: t.kind, ...t.metrics })),
  );
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

// Results saved in this browser before accounts existed (localStorage).
const LEGACY_KEY = 'baseline:v1';

function legacyData() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function localDataCount() {
  return Object.values(legacyData())
    .flatMap((tests) => Object.values(tests))
    .reduce((n, trials) => n + trials.length, 0);
}

// Copies the old on-device results into the signed-in account, then clears them.
export function importLocalData() {
  let n = 0;
  for (const [athlete, tests] of Object.entries(legacyData())) {
    for (const [test, trials] of Object.entries(tests)) {
      for (const t of trials) {
        putTrial({ athlete, test, kind: t.kind, at: t.at, metrics: t.metrics });
        n++;
      }
    }
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  return n;
}
