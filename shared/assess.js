// Baseline comparison used everywhere in the app (own results, the coach's
// view, and checks on teammates), so a result is judged the same way.
//
// SPECS: for each test, each metric's bad direction and (optionally) the
// smallest spread to assume when an athlete's baseline barely varies.
//   worse: 'higher' | 'lower' | 'away' (any change from baseline is bad)

export const SPECS = {
  balance: {
    sway: { worse: 'higher' },
    singleSway: { worse: 'higher' },
    errors: { worse: 'higher', minSpread: 1 },
  },
  reaction: {
    medianMs: { worse: 'higher' },
    spreadMs: { worse: 'higher' },
    mistakes: { worse: 'higher', minSpread: 1 },
  },
  eye: {
    onTarget: { worse: 'lower' },
    gain: { worse: 'lower' },
    saccadeRate: { worse: 'higher' },
    lagMs: { worse: 'higher' },
  },
};
// The eye test on a phone: same metrics, but its own baseline, because a
// phone's camera, screen size, and viewing distance differ from a laptop's.
SPECS.eyePhone = SPECS.eye;

// Every metric a test may store (eye also stores trackingError, unscored).
export const METRIC_KEYS = {
  balance: ['sway', 'singleSway', 'errors'],
  reaction: ['medianMs', 'spreadMs', 'mistakes'],
  eye: ['onTarget', 'gain', 'saccadeRate', 'lagMs', 'trackingError'],
  eyePhone: ['onTarget', 'gain', 'saccadeRate', 'lagMs', 'trackingError'],
};

export const TEST_IDS = Object.keys(SPECS);
export const BASELINE_TRIALS = 3;

// With only a few baseline trials the SD is unreliable (often ~0), so never
// let it drop below this fraction of the mean.
const MIN_REL_SD = 0.1;
export const FLAG_Z = 2;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

// baselines: [{ metrics }] -> { n, stats: { name: { mean, sd, n } } } or null
export function summarize(baselines) {
  if (!baselines.length) return null;
  const stats = {};
  for (const name of Object.keys(baselines[0].metrics)) {
    const xs = baselines.map((t) => t.metrics[name]).filter(Number.isFinite);
    if (xs.length) stats[name] = { mean: mean(xs), sd: sd(xs), n: xs.length };
  }
  return { n: baselines.length, stats };
}

export function spreadFor(stat, def) {
  return Math.max(stat.sd, Math.abs(stat.mean) * MIN_REL_SD, def.minSpread ?? 0, 1e-9);
}

// Compare one result to a baseline summary.
// 0 flagged metrics = normal, 1 = monitor, 2+ = refer.
export function compareToSummary(summary, metrics, spec) {
  if (!summary) return { status: 'no-baseline', flags: 0, baselineTrials: 0, rows: [] };
  const rows = [];
  for (const [name, def] of Object.entries(spec)) {
    const s = summary.stats[name];
    const value = metrics[name];
    if (!s || !Number.isFinite(value)) continue;
    const z = (value - s.mean) / spreadFor(s, def);
    const worseZ = def.worse === 'lower' ? -z : def.worse === 'away' ? Math.abs(z) : z;
    rows.push({ name, value, mean: s.mean, sd: s.sd, z, flagged: worseZ > FLAG_Z });
  }
  const flags = rows.filter((r) => r.flagged).length;
  const status = flags === 0 ? 'normal' : flags === 1 ? 'monitor' : 'refer';
  return { status, flags, baselineTrials: summary.n, rows };
}

// Cutoffs a teammate's phone needs to judge a check without seeing any
// results: for each metric, the value past which it counts as flagged
// (mean ± 2 spreads, on the "worse" side). Same verdicts as compareToSummary.
export function limitsFrom(summary, spec) {
  if (!summary) return null;
  const limits = {};
  for (const [name, def] of Object.entries(spec)) {
    const s = summary.stats[name];
    if (!s || def.worse === 'away') continue;
    const spread = spreadFor(s, def);
    limits[name] = {
      worse: def.worse,
      limit: def.worse === 'lower' ? s.mean - FLAG_Z * spread : s.mean + FLAG_Z * spread,
    };
  }
  return { n: summary.n, limits };
}

// Status of a check from cutoffs alone.
export function judge(limitsDoc, metrics) {
  if (!limitsDoc || !limitsDoc.n) return 'no-baseline';
  let flags = 0;
  for (const [name, { worse, limit }] of Object.entries(limitsDoc.limits)) {
    const v = metrics[name];
    if (!Number.isFinite(v)) continue;
    if (worse === 'lower' ? v < limit : v > limit) flags++;
  }
  return flags === 0 ? 'normal' : flags === 1 ? 'monitor' : 'refer';
}

// What a tester is told to do, by status. No numbers: safe to show anyone.
export const ACTIONS = {
  normal: {
    title: 'Within their normal range',
    action: 'No change from their baseline on this test. Keep watching for symptoms.',
  },
  monitor: {
    title: 'Monitor',
    action: 'Slightly worse than their baseline. Keep them out of contact for now and tell the coach.',
  },
  refer: {
    title: 'Remove from play',
    action: 'Clearly worse than their baseline. Remove them from play now and get the coach.',
  },
  'no-baseline': {
    title: 'No baseline on file',
    action: 'There is nothing to compare against. Treat it as a possible concussion: remove them from play and tell the coach.',
  },
};
