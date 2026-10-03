// Per-athlete trial storage + baseline comparison. Shared by every test.
//
// A trial is { at, kind, metrics: { name: number } }, where kind is
// 'baseline' (healthy, preseason) or 'check' (after a hit).
//
// Each test exports a METRICS spec telling compare() which direction is worse:
//   { trackingError: { label, unit, worse: 'higher' }, gain: { ..., worse: 'lower' } }
// Use worse: 'away' for metrics where any deviation from baseline is bad.

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
  return Object.keys(load()).sort();
}

export function getTrials(athlete, test) {
  return load()[athlete]?.[test] ?? [];
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

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Mean and SD of every metric across the athlete's baseline trials.
export function summarizeBaseline(athlete, test) {
  const trials = getTrials(athlete, test).filter((t) => t.kind === 'baseline');
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

// Compare one trial's metrics to the athlete's baseline.
// Returns per-metric { value, mean, sd, z, flagged } and an overall status.
export function compare(athlete, test, metrics, spec) {
  const base = summarizeBaseline(athlete, test);
  if (!base) return { status: 'no-baseline', rows: [] };
  const rows = [];
  for (const [name, def] of Object.entries(spec)) {
    const s = base.stats[name];
    const value = metrics[name];
    if (!s || !Number.isFinite(value)) continue;
    const spread = Math.max(s.sd, Math.abs(s.mean) * MIN_REL_SD, 1e-9);
    const z = (value - s.mean) / spread;
    const worseZ = def.worse === 'lower' ? -z : def.worse === 'away' ? Math.abs(z) : z;
    rows.push({ name, ...def, value, mean: s.mean, sd: s.sd, z, flagged: worseZ > FLAG_Z });
  }
  const flags = rows.filter((r) => r.flagged).length;
  const status = flags === 0 ? 'normal' : flags === 1 ? 'monitor' : 'refer';
  return { status, flags, baselineTrials: base.n, rows };
}
