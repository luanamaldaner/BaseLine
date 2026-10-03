// Combines per-test results into one overall call.

import { getTrials, compare, summarizeBaseline, BASELINE_TRIALS } from './baseline.js';
import { TESTS } from '../tests/registry.js';

export const STATUS = {
  normal: { cls: 'ok', short: 'Normal', title: 'Normal', text: 'Every test is within this athlete’s usual range.' },
  monitor: { cls: 'warn', short: 'Monitor', title: 'Monitor', text: 'One test is worse than usual. Watch for symptoms and retest.' },
  refer: { cls: 'bad', short: 'Refer', title: 'Remove from play and refer', text: 'Results are clearly worse than usual. Have this athlete seen by a clinician.' },
  'no-baseline': { cls: 'muted', short: 'No baseline', title: 'No baseline', text: 'Nothing to compare against yet.' },
};

// Latest post-hit check for one test, judged against the baselines that
// existed when it was taken.
export function latestCheck(subjectUid, test) {
  const checks = getTrials(subjectUid, test.id).filter((t) => t.kind === 'check');
  if (!checks.length) return null;
  const trial = checks.reduce((a, b) => (a.at > b.at ? a : b));
  return { trial, comparison: compare(subjectUid, test.id, trial.metrics, trial.at) };
}

// Overall: any test at "refer", or two or more tests at "monitor", means
// refer; a single "monitor" means monitor. A check with no baseline to
// compare against counts as "refer", matching what the tester was told.
export function overallStatus(checks) {
  const statuses = checks.filter(Boolean).map((c) =>
    c.comparison.status === 'no-baseline' ? 'refer' : c.comparison.status,
  );
  if (!statuses.length) return null;
  const monitors = statuses.filter((s) => s === 'monitor').length;
  if (statuses.includes('refer') || monitors >= 2) return 'refer';
  return monitors === 1 ? 'monitor' : 'normal';
}

// How many of the runnable tests have a full baseline (on any device).
export function baselinesComplete(subjectUid) {
  return TESTS.filter((t) =>
    (t.variants ?? [t.id]).some((id) => (summarizeBaseline(subjectUid, id)?.n ?? 0) >= BASELINE_TRIALS),
  ).length;
}

export function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
