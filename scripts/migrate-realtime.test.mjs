import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, compact, toRealtime, digest, planTrialReconciliation, reconcileTrials } from './migrate-realtime.mjs';

test('Firestore decoding preserves nested booleans, zero values, timestamps and missing metrics', () => {
  assert.deepEqual(decode({ mapValue: { fields: {
    heat: { booleanValue: false }, n: { integerValue: '0' },
    at: { timestampValue: '2026-10-03T12:00:00Z' }, metrics: { mapValue: { fields: { sway: { nullValue: null } } } },
  } } }), { heat: false, n: 0, at: '2026-10-03T12:00:00Z', metrics: { sway: null } });
  assert.deepEqual(compact({ n: 0, heat: false, metrics: { sway: null }, teamId: null }), { n: 0, heat: false });
});

const doc = (path, data) => ({ path, data });
const source = [
  doc('users/a', { role: 'athlete', name: 'Athlete', teamIds: ['removed'], coachUids: ['removedCoach'], consentedAt: '2026-10-01T12:00:00Z' }),
  doc('users/c', { role: 'coach', name: 'Coach', teamIds: [] }),
  doc('teams/t', { name: 'Team', coachUid: 'c', coachName: 'Coach', code: 'ABCDEF', createdAt: '2026-10-01T12:00:00Z' }),
  doc('teams/t/members/a', { name: 'Athlete', code: 'ABCDEF', joinedAt: '2026-10-01T12:00:00Z' }),
  doc('joinCodes/ABCDEF', { teamId: 't' }),
];
test('migration rebuilds active access from memberships instead of stale profile grants', () => {
  const result = toRealtime(source);
  assert.deepEqual(result.profiles.a.teamIds, { t: true });
  assert.deepEqual(result.profiles.c.teamIds, { t: true });
  assert.equal(result.profiles.a.consentedAt, '2026-10-01T12:00:00Z');
  assert.deepEqual(result.recordReaders, { a: { c: { t: true } } });
  assert.equal(result.profiles.a.coachUids, undefined);
  assert.deepEqual(result.joinCodes.ABCDEF, { teamId: 't' });
});

test('migration merges trial locations by stable ID, retaining canonical data and private fields', () => {
  const legacy = { subjectUid: 'a', testerUid: 'c', kind: 'check', test: 'reaction', metrics: { medianMs: 250 }, conditions: { heat: false } };
  const newer = { ...legacy, teamId: 't', metrics: { medianMs: 275 } };
  const history = { concussions: 0, adhd: false, vision: false, vestibular: false, updatedAt: '2026-10-01T12:00:00Z' };
  const avatar = { kind: 'dot', dot: 'teal', updatedAt: '2026-10-01T12:00:00Z' };
  const result = toRealtime([...source, doc('teams/t/trials/r', legacy), doc('users/a/trials/r', newer),
    doc('teams/t/history/a', history), doc('teams/t/avatars/a', avatar)]);
  assert.equal(Object.keys(result.trials.a).length, 1);
  assert.deepEqual(result.trials.a.r, newer);
  assert.deepEqual(result.history.t.a, history);
  assert.deepEqual(result.avatars.t.a, avatar);
  assert.equal(result.teams.t.history, undefined);
});

test('migration refuses orphan memberships and mismatched trial owners', () => {
  assert.throws(() => toRealtime(source.filter((d) => d.path !== 'users/a')), /no athlete profile/);
  assert.throws(() => toRealtime([...source, doc('users/a/trials/x', { subjectUid: 'someone-else' })]), /owner mismatch/);
});

const baselineTrial = { subjectUid: 'a', testerUid: 'a', kind: 'baseline', test: 'reaction', at: '2026-10-03T12:00:00Z', metrics: { medianMs: 250 } };
const backup = (target, hour = 12) => ({ project: 'dte-hackathon', exportedAt: '2026-10-03T' + hour + ':00:00Z', target, digest: digest(target) });
const initialTarget = { profiles: { a: { name: 'Athlete', role: 'athlete' } }, trials: { a: { original: baselineTrial } } };

function targetServer(initial, { beforePut, missingEtag = false } = {}) {
  const data = structuredClone(initial), requests = [], versions = new Map();
  const get = (path) => path.split('/').reduce((value, key) => value?.[key], data) ?? null;
  const put = (path, value) => {
    const parts = path.split('/'); let node = data;
    for (const key of parts.slice(0, -1)) node = node[key] ??= {};
    node[parts.at(-1)] = structuredClone(value);
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const request = async (url, options = {}) => {
    const path = decodeURIComponent(new URL(url).pathname.slice(1).replace(/\.json$/, ''));
    requests.push({ path, ...options });
    if (options.method === 'PUT') {
      beforePut?.({ path, put });
      if (options.headers?.['if-match'] !== '"' + (versions.get(path) ?? 0) + '"') throw new Error('Firebase request failed (412): request rejected');
      put(path, JSON.parse(options.body));
    }
    return { json: async () => structuredClone(get(path)), headers: { get: () => missingEtag ? null : '"' + (versions.get(path) ?? 0) + '"' } };
  };
  return { data, requests, request };
}

test('reconciliation only considers newly exported canonical trial IDs and reports configuration changes', () => {
  const fresh = { ...initialTarget,
    profiles: { ...initialTarget.profiles, newcomer: { name: 'New athlete', role: 'athlete' } },
    teams: { newTeam: { name: 'New team' } }, members: { newTeam: { newcomer: { name: 'New athlete' } } },
    trials: { a: { original: { ...baselineTrial, metrics: { medianMs: 999 } }, late: baselineTrial } },
  };
  const plan = planTrialReconciliation(backup(initialTarget), backup(fresh, 13));
  assert.deepEqual(plan.candidates.map((candidate) => candidate.path), ['trials/a/late']);
  assert.deepEqual(plan.sourceTrialChanges, { added: 1, changed: 1, removed: 0 });
  assert.equal(plan.configurationChanges.profiles.added, 1);
  assert.equal(plan.configurationChanges.teams.added, 1);
  assert.equal(plan.configurationChanges.members.added, 1);
  assert.equal(plan.warnings.length, 2);
});

test('reconciliation creates missing new trials conditionally while preserving live deletions and access', async () => {
  const fresh = { ...initialTarget, trials: { a: { original: baselineTrial, late: { ...baselineTrial, at: '2026-10-03T12:30:00Z' } } } };
  // The athlete deliberately deleted "original" in RTDB after cutover.
  const live = { profiles: initialTarget.profiles, members: { liveTeam: { a: { name: 'Current name' } } }, recordReaders: { a: { currentCoach: { liveTeam: true } } } };
  const server = targetServer(live);
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request });
  assert.equal(report.created, 1);
  assert.equal(report.conflicts.length, 0);
  assert.equal(server.data.trials.a.original, undefined);
  assert.deepEqual(server.data.trials.a.late, fresh.trials.a.late);
  assert.deepEqual(server.data.profiles, live.profiles);
  assert.deepEqual(server.data.members, live.members);
  assert.deepEqual(server.data.recordReaders, live.recordReaders);
  assert.equal(server.requests.some((request) => request.path.endsWith('/original')), false);
  const writes = server.requests.filter((request) => request.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'trials/a/late');
  assert.equal(writes[0].headers['if-match'], '"0"');
  assert.equal(server.requests.find((request) => request.path === 'trials/a/late').headers['X-Firebase-ETag'], 'true');
});

test('identical recovered trials skip; differing target trials report conflict without overwrite', async () => {
  const fresh = { ...initialTarget, trials: { a: { ...initialTarget.trials.a, same: baselineTrial, different: baselineTrial } } };
  const changed = { ...baselineTrial, metrics: { medianMs: 900 } };
  const server = targetServer({ profiles: initialTarget.profiles, trials: { a: { same: baselineTrial, different: changed } } });
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request });
  assert.equal(report.alreadyPresent, 1);
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].path, 'trials/a/different');
  assert.deepEqual(server.data.trials.a.different, changed);
  assert.equal(server.requests.some((request) => request.method === 'PUT'), false);
});

test('missing owners block trial creation and new profiles are never imported implicitly', async () => {
  const fresh = { profiles: { newAthlete: { role: 'athlete', name: 'New' } }, trials: { newAthlete: { late: { ...baselineTrial, subjectUid: 'newAthlete' } } } };
  const server = targetServer({ profiles: initialTarget.profiles });
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request });
  assert.equal(report.created, 0);
  assert.match(report.conflicts[0].reason, /owner profile is missing/);
  assert.equal(server.data.profiles.newAthlete, undefined);
  assert.equal(server.data.trials, undefined);
  assert.equal(server.requests.length, 1);
});

test('a concurrent different creation rejects If-Match and cannot be overwritten', async () => {
  const fresh = { ...initialTarget, trials: { a: { late: baselineTrial } } };
  const concurrent = { ...baselineTrial, metrics: { medianMs: 450 } };
  const server = targetServer({ profiles: initialTarget.profiles }, { beforePut: ({ path, put }) => put(path, concurrent) });
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request });
  assert.equal(report.created, 0);
  assert.equal(report.conflicts.length, 1);
  assert.match(report.conflicts[0].reason, /conditional write was rejected/);
  assert.deepEqual(server.data.trials.a.late, concurrent);
});

test('a concurrent identical recovery is acknowledged as already present', async () => {
  const fresh = { ...initialTarget, trials: { a: { late: baselineTrial } } };
  const server = targetServer({ profiles: initialTarget.profiles }, { beforePut: ({ path, put }) => put(path, baselineTrial) });
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request });
  assert.equal(report.alreadyPresent, 1);
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.created, 0);
});

test('dry-run reports possible creations without writing and missing ETags fail closed', async () => {
  const fresh = { ...initialTarget, trials: { a: { late: baselineTrial } } };
  const server = targetServer({ profiles: initialTarget.profiles });
  const report = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: server.request, dryRun: true });
  assert.equal(report.wouldCreate, 1);
  assert.equal(report.created, 0);
  assert.equal(server.requests.some((request) => request.method === 'PUT'), false);
  const missing = targetServer({ profiles: initialTarget.profiles }, { missingEtag: true });
  const failed = await reconcileTrials(backup(initialTarget), backup(fresh, 13), { request: missing.request });
  assert.match(failed.errors[0].message, /refusing an unguarded write/);
  assert.equal(missing.requests.some((request) => request.method === 'PUT'), false);
});

test('invalid checksums, reversed dates and invalid ownership stop reconciliation before target access', async () => {
  let requests = 0;
  const options = { request: async () => { requests++; throw new Error('Must not run'); } };
  await assert.rejects(reconcileTrials({ ...backup(initialTarget), digest: 'bad' }, backup(initialTarget, 13), options), /checksum mismatch/);
  await assert.rejects(reconcileTrials(backup(initialTarget, 13), backup(initialTarget), options), /predates/);
  const invalid = { trials: { a: { late: { ...baselineTrial, subjectUid: 'other' } } } };
  await assert.rejects(reconcileTrials(backup(initialTarget), backup(invalid, 13), options), /owner mismatch/);
  assert.equal(requests, 0);
});
