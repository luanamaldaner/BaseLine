// Fictional records for the explicitly marked demo team. No production reads,
// random values, Auth calls, credentials, or consent records belong here.
import { SPECS, TEST_IDS, summarize, limitsFrom, judge } from '../shared/assess.js';

export const DEMO_NAMES = Object.freeze({
  coach: 'Coach Morgan (DEMO)',
  healthy: 'Alex Morgan (DEMO)',
  monitor: 'Casey Rivera (DEMO)',
  refer: 'Jordan Lee (DEMO)',
  newcomer: 'Sam Taylor (DEMO)',
});
const ATHLETES = ['healthy', 'monitor', 'refer', 'newcomer'];
const DAY = 86400000;
const MINUTE = 60000;
const round = (value) => Math.round(value * 10000) / 10000;
const keyIsValid = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[.#$\[\]/\x00-\x1f\x7f]/.test(value);

function baselineMetrics(test, person, variation) {
  const delta = [-0.04, 0.02, -0.01, 0.03][variation];
  const factor = 1 + person * 0.06;
  if (test === 'balance') return {
    sway: round(0.28 * factor * (1 + delta)),
    singleSway: round(0.43 * factor * (1 - delta)), errors: [1, 2, 1, 2][variation],
  };
  if (test === 'reaction') return {
    medianMs: Math.round((278 + person * 12) * (1 + delta)),
    spreadMs: Math.round((34 + person * 4) * (1 - delta)), mistakes: [0, 1, 0, 0][variation],
  };
  const phone = test === 'eyePhone';
  return {
    onTarget: round((phone ? 89 : 94) - person + delta * 20),
    gain: round((phone ? 0.92 : 0.97) - person * 0.015 + delta * 0.12),
    saccadeRate: round((phone ? 0.25 : 0.2) + person * 0.025 + delta * 0.4),
    lagMs: Math.round((phone ? 145 : 118) + person * 9 + delta * 100),
    trackingError: round((phone ? 0.065 : 0.045) + person * 0.003 + delta * 0.03),
  };
}

function checkMetrics(test, person, episode, scenario) {
  const metrics = baselineMetrics(test, person, episode);
  // Change the measurements, then let the same scoring code as the app
  // determine the label. A single reaction metric crosses the monitor cutoff;
  // the refer example crosses two. Eye phone/laptop remain separate baselines.
  if (test === 'reaction' && scenario !== 'healthy' && episode > 0) {
    metrics.medianMs = scenario === 'refer' && episode === 2 ? 455 : 410;
    if (scenario === 'refer' && episode === 2) metrics.spreadMs = 92;
  }
  return metrics;
}

const conditions = (test, kind, rested = true) => ({
  rested, heat: false, pain: false,
  place: kind === 'baseline' ? 'quiet' : 'sideline',
  light: test === 'eye' ? 'indoor' : 'shade',
  device: test === 'eye' ? 'laptop' : 'phone',
});

/** Build only demo-owned RTDB branches; the caller performs scoped writes. */
export function buildDemoData({ uids, teamId, code, referenceAt }) {
  const roles = ['coach', ...ATHLETES];
  if (!uids || roles.some((role) => !keyIsValid(uids[role])) || new Set(roles.map((role) => uids[role])).size !== roles.length) {
    throw new Error('Supply five distinct valid demo account IDs.');
  }
  if (!keyIsValid(teamId) || !/^[A-Z0-9]{6}$/.test(code ?? '')) throw new Error('Supply a valid demo team ID and six-character code.');
  if (typeof referenceAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(referenceAt) || !Number.isFinite(Date.parse(referenceAt))) {
    throw new Error('Supply an explicit UTC reference timestamp.');
  }
  const referenceMs = Date.parse(referenceAt);
  const at = (daysAgo, minutesAgo = 0) => new Date(referenceMs - daysAgo * DAY - minutesAgo * MINUTE).toISOString();
  const createdAt = at(20);
  const data = {
    profiles: {},
    teams: { [teamId]: { name: 'Demo Falcons (fictional)', coachUid: uids.coach, coachName: DEMO_NAMES.coach, code, createdAt } },
    joinCodes: { [code]: { teamId } },
    members: { [teamId]: {} },
    recordReaders: {}, trials: {}, ranges: { [teamId]: {} },
    history: { [teamId]: {} }, avatars: { [teamId]: {} },
  };
  for (const role of roles) {
    data.profiles[uids[role]] = { role: role === 'coach' ? 'coach' : 'athlete', name: DEMO_NAMES[role], teamIds: { [teamId]: true } };
  }
  const dots = { coach: 'sunny', healthy: 'mint', monitor: 'sky', refer: 'berry', newcomer: 'grape' };
  for (const role of roles) data.avatars[teamId][uids[role]] = { kind: 'dot', dot: dots[role], updatedAt: createdAt };

  const scenarios = {};
  for (const [person, scenario] of ATHLETES.entries()) {
    const subjectUid = uids[scenario], records = {};
    data.members[teamId][subjectUid] = { name: DEMO_NAMES[scenario], code, joinedAt: createdAt };
    data.recordReaders[subjectUid] = { [uids.coach]: { [teamId]: true } };
    data.history[teamId][subjectUid] = {
      concussions: scenario === 'refer' ? 1 : 0,
      adhd: scenario === 'monitor', vision: scenario === 'newcomer', vestibular: false, updatedAt: createdAt,
    };
    const add = (test, kind, index, trialAt, metrics, extra = {}) => {
      const id = `demo_v1_${scenario}_${kind}_${test}_${index + 1}`;
      records[id] = { subjectUid, testerUid: kind === 'baseline' ? subjectUid : uids.coach,
        test, kind, at: trialAt, metrics, conditions: conditions(test, kind, !(scenario === 'monitor' && kind === 'check' && index > 0)), ...extra };
    };
    const latestStatusByTest = {};
    for (const [testIndex, test] of TEST_IDS.entries()) {
      const count = scenario === 'newcomer' ? (test === 'balance' || test === 'reaction' ? 2 : 0) : 4;
      for (let index = 0; index < count; index++) {
        add(test, 'baseline', index, at(14 - index * 3, 60 - testIndex * 12), baselineMetrics(test, person, index));
      }
      const baselines = Object.values(records).filter((trial) => trial.kind === 'baseline' && trial.test === test);
      const range = limitsFrom(summarize(baselines), SPECS[test]);
      if (range) data.ranges[teamId][`${subjectUid}_${test}`] = { subjectUid, test, ...range };
      if (scenario === 'newcomer') {
        if (test === 'eyePhone') {
          const metrics = baselineMetrics(test, person, 0);
          const status = judge(range, metrics);
          add(test, 'check', 0, at(0, 15), metrics, { teamId, status });
          latestStatusByTest[test] = status;
        }
        continue;
      }
      for (const [episode, daysAgo] of [3, 1, 0].entries()) {
        const metrics = checkMetrics(test, person, episode, scenario);
        const status = judge(range, metrics);
        add(test, 'check', episode, at(daysAgo, 60 - testIndex * 12), metrics, { teamId, status });
        latestStatusByTest[test] = status;
      }
    }
    data.trials[subjectUid] = records;
    scenarios[scenario] = { uid: subjectUid, name: DEMO_NAMES[scenario], latestStatusByTest,
      expectedOverall: scenario === 'healthy' ? 'normal' : scenario === 'newcomer' ? null : scenario,
      baselines: Object.values(records).filter((trial) => trial.kind === 'baseline').length,
      checks: Object.values(records).filter((trial) => trial.kind === 'check').length,
    };
  }
  const trials = Object.values(data.trials).flatMap(Object.values);
  return { data, metadata: {
    version: 1, fictional: true, timeZone: 'America/New_York', referenceAt: new Date(referenceMs).toISOString(),
    teamId, teamName: data.teams[teamId].name, code, accounts: roles.length, athletes: ATHLETES.length,
    baselines: trials.filter((trial) => trial.kind === 'baseline').length,
    checks: trials.filter((trial) => trial.kind === 'check').length, trials: trials.length, scenarios,
  } };
}
