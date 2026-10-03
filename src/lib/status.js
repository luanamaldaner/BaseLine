// Combines per-test results into one overall call.

import { getTrials, compare } from './baseline.js';

export const STATUS = {
  normal: { cls: 'ok', short: 'Normal', title: 'Normal', text: 'Every test is within this athlete’s usual range.' },
  monitor: { cls: 'warn', short: 'Monitor', title: 'Monitor', text: 'One test is worse than usual. Watch for symptoms and retest.' },
  refer: { cls: 'bad', short: 'Refer', title: 'Remove from play and refer', text: 'Results are clearly worse than usual. Have this athlete seen by a clinician.' },
  'no-baseline': { cls: 'muted', short: 'No baseline', title: 'No baseline', text: 'Nothing to compare against yet.' },
};

// Latest post-hit check for one test, judged against the baselines that
// existed when it was taken.
export function latestCheck(athlete, test) {
  const checks = getTrials(athlete, test.id).filter((t) => t.kind === 'check');
  if (!checks.length) return null;
  const trial = checks.reduce((a, b) => (a.at > b.at ? a : b));
  return { trial, comparison: compare(athlete, test.id, trial.metrics, test.metrics, trial.at) };
}

// Overall: any test at "refer", or two or more tests at "monitor", means
// refer; a single "monitor" means monitor. Tests agree only partly (they
// measure different systems), so one flag is enough to keep watching.
export function overallStatus(checks) {
  const statuses = checks.filter(Boolean).map((c) => c.comparison.status).filter((s) => s !== 'no-baseline');
  if (!statuses.length) return null;
  const monitors = statuses.filter((s) => s === 'monitor').length;
  if (statuses.includes('refer') || monitors >= 2) return 'refer';
  return monitors === 1 ? 'monitor' : 'normal';
}

export function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
