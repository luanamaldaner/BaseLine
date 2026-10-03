// Per-athlete trial storage + baseline comparison. Shared by every test.
//
// Storage: the browser's localStorage on this device, under one key. Nothing is
// sent to a server, so each device keeps its own athletes; clearing browser
// data erases them. exportCsv() is the backup / analysis path.
//
// A trial is { at, kind, metrics: { name: number } }, where kind is
// 'baseline' (healthy, preseason) or 'check' (after a hit).
//
// Each test exports a METRICS spec telling compare() which direction is worse:
//   { medianMs: { label, unit, worse: 'higher', minSpread?: 20 }, ... }
// worse: 'higher' | 'lower' | 'away' (any change from baseline is bad).
// minSpread: smallest spread to assume, in metric units, for metrics whose
// baseline is often flat (e.g. 0 symptoms every time).

const KEY = 'baseline:v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

function save(db) {
  localStorage.setItem(KEY, JSON.stringify(db));
}

export function listAthletes() {
  return Object.keys(load()).sort((a, b) => a.localeCompare(b));
}

export function getTrials(athlete, test) {
  return load()[athlete]?.[test] ?? [];
}

// Every trial for an athlete, newest first: [{ test, at, kind, metrics }]
export function allTrials(athlete) {
  const tests = load()[athlete] ?? {};
  return Object.entries(tests)
    .flatMap(([test, trials]) => trials.map((t) => ({ test, ...t })))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export function addTrial(athlete, test, kind, metrics) {
  const db = load();
  db[athlete] ??= {};
  db[athlete][test] ??= [];
  const trial = { at: new Date().toISOString(), kind, metrics };
  db[athlete][test].push(trial);
  save(db);
  return trial;
}

export function deleteTrial(athlete, test, at) {
  const db = load();
  const trials = db[athlete]?.[test];
  if (!trials) return;
  db[athlete][test] = trials.filter((t) => t.at !== at);
  save(db);
}

export function deleteAthlete(athlete) {
  const db = load();
  delete db[athlete];
  save(db);
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
