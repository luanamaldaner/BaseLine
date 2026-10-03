import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as assess from '../shared/assess.js';
import { serviceErrorMessage } from '../src/lib/serviceErrors.js';

// Exercise session transitions without connecting to the live project.
const source = readFileSync(new URL('../src/lib/session.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"].*?['"];\s*/gm, '')
  .replaceAll('import.meta.env.DEV', 'false')
  .replace(/\bexport /g, '');

function setup(initial = {}, role = 'athlete', options = {}) {
  const data = new Map(Object.entries(initial));
  const streams = new Map();
  const writes = [];
  const reads = [];
  const timers = [];
  const auth = { currentUser: { uid: 'me' } };
  let serial = 0;
  const ref = (...parts) => {
    if (typeof parts[0] === 'object') {
      const parent = parts.shift();
      if (parent.path) parts.unshift(parent.path);
    }
    const path = parts.join('/');
    return { path, id: path.split('/').at(-1) };
  };
  const snapshot = (r, metadata = {}) => ({
    id: r.id, ref: r, exists: () => data.has(r.path), data: () => data.get(r.path),
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
  });
  const tx = () => {
    const pending = [];
    return {
      get: async (r) => snapshot(r),
      set: (r, value) => pending.push(['set', r, value]),
      update: (r, value) => pending.push(['update', r, value]),
      delete: (r) => pending.push(['delete', r]),
      commit: async () => {
        for (const [op, r, value] of pending) {
          writes.push({ op, path: r.path, value });
          if (op === 'delete') data.delete(r.path);
          else data.set(r.path, op === 'update' ? { ...data.get(r.path), ...value } : value);
        }
      },
    };
  };
  const context = vm.createContext({
    ...assess, serviceErrorMessage, auth, db: {}, console, crypto: globalThis.crypto,
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); timers.push({ fn, ms }); return timer; }, clearTimeout,
    useSyncExternalStore: () => {}, onAuthStateChanged: () => {}, signOut: () => {},
    collection: ref,
    doc: (...parts) => parts.length === 1 ? ref(parts[0], 'new' + ++serial) : ref(...parts),
    query: (r, filter) => ({ ...r, filter }), where: (field, op, value) => ({ field, value }),
    getDocFromServer: async (r) => { reads.push(r.path); if (options.readError) throw options.readError; return snapshot(r); },
    getDocsFromServer: async (r) => ({ docs: [...data.keys()]
      .filter((path) => path.startsWith(r.path + '/') && path.split('/').length === r.path.split('/').length + 1)
      .filter((path) => !r.filter || data.get(path)[r.filter.field] === r.filter.value)
      .map((path) => snapshot(ref(path))) }),
    onSnapshot: (r, ...args) => {
      const next = typeof args[0] === 'function' ? args[0] : args[1];
      const error = typeof args[0] === 'function' ? args[1] : args[2];
      const entry = { r, next, error, active: true };
      if (!streams.has(r.path)) streams.set(r.path, []);
      streams.get(r.path).push(entry);
      return () => { entry.active = false; };
    },
    runTransaction: async (_, fn) => { const batch = tx(); const result = await fn(batch); await batch.commit(); return result; },
    writeBatch: tx,
    setDoc: async (r, value) => {
      writes.push({ op: 'set', path: r.path, value });
      if (options.setDoc) await options.setDoc(r, value);
      data.set(r.path, value);
    },
    updateDoc: async (r, value) => data.set(r.path, { ...data.get(r.path), ...value }),
    deleteDoc: async (r) => { writes.push({ op: 'delete', path: r.path }); data.delete(r.path); },
  });
  vm.runInContext(source + '\nglobalThis.api = { set, getSession, startTeams, stopTeam, migrateProfile, createProfile, createTeam, joinTeam, leaveTeam, saveHistory, saveBaseline, submitCheck, deleteTrial, watchProfile, syncRanges, retryTrial, retrySync };', context);
  const api = context.api;
  api.set({ user: auth.currentUser, profile: data.get('users/me') ?? { role, name: 'Me', teamIds: ['t1'], teamId: 't1' } });
  const emit = (path, items, metadata = {}) => {
    for (const entry of streams.get(path) ?? []) {
      if (!entry.active) continue;
      const snap = items === null ? snapshot(ref(path), metadata) : {
        docs: items.map(([id, value, meta = {}]) => ({ id, ref: ref(path, id), data: () => value, metadata: { hasPendingWrites: false, ...meta } })),
        metadata: { fromCache: false, hasPendingWrites: false, ...metadata },
      };
      entry.next(snap);
    }
  };
  const fail = (path, error) => { for (const entry of streams.get(path) ?? []) if (entry.active) entry.error(error); };
  return { api, data, streams, writes, reads, timers, emit, fail, auth };
}

const baseline = { subjectUid: 'me', testerUid: 'me', test: 'reaction', kind: 'baseline', at: '2026-10-01T12:00:00.000Z', metrics: { medianMs: 250, spreadMs: 30, mistakes: 0 } };
const team = (coachUid = 'coach') => ({ coachUid, name: 'Team', coachName: 'Coach', code: 'ABCDEF' });
const member = { name: 'Me', joinedAt: '2026-10-01T12:00:00.000Z', code: 'ABCDEF' };
const plain = (value) => JSON.parse(JSON.stringify(value));

test('Firestore sorted map keys do not rewrite identical cutoffs', async () => {
  const { api, emit, writes } = setup();
  const lim = assess.limitsFrom(assess.summarize([baseline]), assess.SPECS.reaction);
  const sorted = Object.fromEntries(Object.entries(lim.limits).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => [key, { limit: value.limit, worse: value.worse }]));
  api.startTeams(['t1'], 'me', 'athlete');
  emit('teams/t1/members', [['me', member]]);
  emit('users/me/trials', [['b', baseline]]);
  emit('teams/t1/trials', []);
  for (let i = 0; i < 20; i++) emit('teams/t1/ranges', [['me_reaction', { subjectUid: 'me', test: 'reaction', n: lim.n, limits: sorted }]]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 0);
  api.stopTeam();
});

test('pending results survive reload status and a rejected restored result can be retried', async () => {
  const { api, emit, data } = setup();
  api.startTeams(['t1'], 'me', 'athlete');
  emit('users/me/trials', [['queued', baseline, { hasPendingWrites: true }]], { fromCache: true, hasPendingWrites: true });
  assert.equal(api.getSession().pendingWrites, 1);
  emit('users/me/trials', []);
  assert.equal(api.getSession().pendingWrites, 0);
  assert.equal(api.getSession().trialWrites.get('queued').status, 'failed');
  await api.retryTrial('queued');
  assert.equal(api.getSession().trialWrites.get('queued').status, 'saved');
  assert.deepEqual(plain(data.get('users/me/trials/queued')), baseline);
  api.stopTeam();
});

test('migration preserves ids, external tester, conditions and phone eye results; safe twice', async () => {
  const check = { ...baseline, kind: 'check', test: 'eyePhone', testerUid: 'teammate', status: 'monitor',
    metrics: { onTarget: 80, gain: 1, saccadeRate: 2, lagMs: 100, trackingError: 5 },
    conditions: { rested: true, place: 'quiet', light: 'shade', device: 'phone' } };
  const { api, data, writes } = setup({
    'users/me': { role: 'athlete', name: 'Me', teamId: 't1', consentedAt: baseline.at },
    'teams/t1': team(), 'teams/t1/members/me': member,
    'teams/t1/trials/b': baseline, 'teams/t1/trials/c': check,
  });
  await Promise.all([api.migrateProfile('me'), api.migrateProfile('me')]);
  await api.migrateProfile('me');
  assert.deepEqual(plain(data.get('users/me/trials/c')), { ...check, teamId: 't1' });
  assert.equal(data.get('users/me/trials/b').teamId, null);
  assert.deepEqual(plain(data.get('users/me').teamIds), ['t1']);
  assert.deepEqual(plain(data.get('users/me').coachUids), ['coach']);
  assert.equal(data.get('users/me').consentedAt, baseline.at);
  assert.equal(writes.filter((w) => w.path.includes('/trials/')).length, 2);
  assert.ok(data.has('teams/t1/trials/b'));
});

test('join and leave keep a coach who still has another shared team', async () => {
  const { api, data } = setup({
    'users/me': { role: 'athlete', name: 'Me', teamIds: ['t1'], teamId: 't1', coachUids: ['coach'] },
    'teams/t1': team(), 'teams/t2': team(), 'teams/t1/members/me': member,
    'joinCodes/ABCDEF': { teamId: 't2' },
  });
  await api.joinTeam('abcdef');
  await api.joinTeam('ABCDEF');
  assert.deepEqual(plain(data.get('users/me').teamIds), ['t1', 't2']);
  assert.deepEqual(plain(data.get('users/me').coachUids), ['coach']);
  await api.leaveTeam('t1');
  assert.equal(data.get('users/me').teamId, 't2');
  assert.deepEqual(plain(data.get('users/me').coachUids), ['coach']);
  await api.leaveTeam('t2');
  assert.deepEqual(plain(data.get('users/me').coachUids), []);
  assert.equal(data.get('users/me').teamId, null);
});

test('legacy and record merge deduplicates and waits before publishing cutoffs to every team', async () => {
  const { api, emit, writes } = setup();
  api.set({ profile: { role: 'athlete', teamIds: ['t1', 't2'], teamId: 't1' } });
  api.startTeams(['t1', 't2'], 'me', 'athlete');
  emit('teams/t1/members', [['me', member]]);
  emit('teams/t2/members', [['me', member]]);
  emit('users/me/trials', [['b', { ...baseline, teamId: null }]]);
  emit('teams/t1/trials', [['b', baseline]]);
  emit('teams/t1/ranges', []);
  emit('teams/t2/ranges', []);
  assert.equal(writes.length, 0);
  emit('teams/t2/trials', [['c', { ...baseline, at: '2026-10-02T12:00:00.000Z' }]]);
  assert.equal(api.getSession().trials.size, 2);
  assert.equal(api.getSession().trials.get('b').teamId, null);
  assert.equal(api.getSession().trials.get('b').paths.length, 2);
  assert.deepEqual(plain(api.getSession().members.get('me').teamIds), ['t1', 't2']);
  assert.deepEqual(writes.filter((w) => w.path.endsWith('me_reaction')).map((w) => w.path).sort(),
    ['teams/t1/ranges/me_reaction', 'teams/t2/ranges/me_reaction']);
  api.stopTeam();
  const before = api.getSession();
  emit('teams/t1/trials', []);
  assert.equal(api.getSession(), before);
});

test('coach has one record listener per athlete, retained until last shared team is left', () => {
  const { api, emit, streams } = setup({}, 'coach');
  api.startTeams(['t1', 't2'], 'me', 'coach');
  emit('teams/t1/members', [['a', member]]);
  emit('teams/t2/members', [['a', member]]);
  assert.equal(streams.get('users/a/trials').length, 1);
  emit('teams/t1/members', []);
  assert.ok(streams.get('users/a/trials')[0].active);
  emit('teams/t2/members', []);
  assert.equal(streams.get('users/a/trials')[0].active, false);
  api.stopTeam();
});

test('a teammate saves to the subject record and receives no numerical comparison', async () => {
  const { api, data } = setup();
  api.set({ members: new Map([['a', { uid: 'a', teamIds: ['t1'] }]]),
    ranges: new Map([['a_reaction', { n: 3, limits: { medianMs: { worse: 'higher', limit: 300 } } }]]) });
  const result = await api.submitCheck('a', 'reaction', { medianMs: 400, spreadMs: 30, mistakes: 0 }, { rested: true });
  assert.equal(result.status, 'monitor');
  assert.equal(result.comparison, undefined);
  const saved = data.get('users/a/trials/new1');
  assert.equal(saved.teamId, 't1');
  assert.equal(saved.subjectUid, 'a');
  assert.equal(saved.testerUid, 'me');
  assert.equal(saved.conditions.rested, true);
  await assert.rejects(api.submitCheck('outsider', 'reaction', baseline.metrics), /shared team/);
});

test('deleting a merged result removes each known copy', async () => {
  const { api, writes } = setup();
  api.set({ trials: new Map([['b', { ...baseline, id: 'b', paths: ['teams/t1/trials/b', 'users/me/trials/b'] }]]) });
  await api.deleteTrial('me', 'b');
  assert.deepEqual(writes.map((w) => w.path).sort(), ['teams/t1/trials/b', 'users/me/trials/b']);
});

test('creating an existing profile never overwrites it', async () => {
  const original = { role: 'coach', name: 'Original', teamId: 't1', teamIds: ['t1'] };
  const { api, data, writes } = setup({ 'users/me': original }, 'coach');
  await api.createProfile('athlete', 'Replacement');
  assert.equal(data.get('users/me'), original);
  assert.equal(writes.length, 0);
  api.stopTeam();
});

test('cached missing profile is never treated as server-confirmed absence', async () => {
  const { api, emit, data } = setup({ 'users/me': { role: 'coach', name: 'Me', teamIds: ['t1'], teamId: 't1' } }, 'coach');
  api.watchProfile({ uid: 'me' });
  await new Promise((resolve) => setImmediate(resolve));
  const profile = api.getSession().profile;
  data.delete('users/me');
  emit('users/me', null, { fromCache: true });
  assert.equal(api.getSession().profile, profile);
  api.stopTeam();
});

test('a coach creates another team while preserving the legacy first team and team limit', async () => {
  const { api, data } = setup({ 'users/me': { role: 'coach', name: 'Me', teamId: 't1', teamIds: ['t1'] } }, 'coach');
  await api.createTeam('Second team');
  assert.equal(data.get('users/me').teamId, 't1');
  const ids = data.get('users/me').teamIds;
  assert.equal(ids.length, 2);
  assert.equal(data.get('teams/' + ids[1]).name, 'Second team');
  data.set('users/me', { ...data.get('users/me'), teamIds: Array.from({ length: 10 }, (_, i) => 't' + (i + 1)) });
  await assert.rejects(api.createTeam('Too many'), /up to 10/);
});

test('migration keeps an existing copy and reconciles a later old-client join', async () => {
  const copy = { ...baseline, teamId: null, at: '2026-10-02T12:00:00.000Z' };
  const { api, data } = setup({
    'users/me': { role: 'athlete', name: 'Me', teamIds: ['t1'], teamId: 't2', coachUids: ['c1'] },
    'teams/t1': team('c1'), 'teams/t1/members/me': member,
    'teams/t2': team('c2'), 'teams/t2/members/me': member,
    'teams/t2/trials/b': baseline, 'users/me/trials/b': copy,
  });
  await api.migrateProfile('me');
  assert.equal(data.get('users/me/trials/b'), copy);
  assert.deepEqual(plain(data.get('users/me').teamIds), ['t1', 't2']);
  assert.deepEqual(plain(data.get('users/me').coachUids), ['c1', 'c2']);
  assert.equal(data.get('users/me').teamId, 't1');
});

test('merged flagged checks still produce one coach alert per run', () => {
  const { api, emit } = setup({}, 'coach');
  api.startTeams(['t1', 't2'], 'me', 'coach');
  emit('teams/t1/members', [['a', member]]);
  emit('teams/t2/members', [['a', member]]);
  const check = { ...baseline, subjectUid: 'a', testerUid: 'teammate', kind: 'check', status: 'monitor' };
  emit('teams/t1/trials', [['c', check]]);
  emit('teams/t2/trials', []);
  emit('users/a/trials', [['c', { ...check, teamId: 't1' }]]);
  const alerts = readFileSync(new URL('../src/lib/alerts.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*/gm, '').replace(/\bexport /g, '');
  const context = vm.createContext({ getSession: api.getSession });
  vm.runInContext(alerts + '\nglobalThis.result = coachAlerts();', context);
  assert.equal(context.result.length, 1);
  assert.equal(context.result[0].level, 'monitor');
  assert.deepEqual(plain(context.result[0].tests), ['reaction']);
  api.stopTeam();
});


test('history merges newest per athlete across coach teams and resets on team changes', () => {
  const { api, emit } = setup({}, 'coach');
  const older = { concussions: 1, adhd: false, vision: false, vestibular: false, updatedAt: '2026-10-01T12:00:00.000Z' };
  const newer = { ...older, concussions: 2, updatedAt: '2026-10-02T12:00:00.000Z' };
  api.startTeams(['t1', 't2'], 'me', 'coach');
  emit('teams/t2/history', [['a', newer]]);
  emit('teams/t1/history', [['a', older], ['b', older]]);
  assert.equal(api.getSession().history.get('a'), newer);
  assert.equal(api.getSession().history.get('b'), older);
  emit('teams/t2/history', []);
  assert.equal(api.getSession().history.get('a'), older);
  api.startTeams(['t2'], 'me', 'coach');
  assert.equal(api.getSession().history.size, 0);
  emit('teams/t1/history', [['a', newer]]);
  assert.equal(api.getSession().history.size, 0);
  api.stopTeam();
});

test('athlete merges own history, saves only current memberships and copies history when joining', async () => {
  const older = { concussions: 1, adhd: false, vision: false, vestibular: false, updatedAt: '2026-10-01T12:00:00.000Z' };
  const newer = { ...older, concussions: 2, updatedAt: '2026-10-02T12:00:00.000Z' };
  const { api, emit, data, writes } = setup({
    'users/me': { role: 'athlete', name: 'Me', teamIds: ['t1', 't2', 'removed'], teamId: 't1', coachUids: ['coach'] },
    'teams/t1/members/me': member, 'teams/t2/members/me': member,
    'teams/t1/history/me': older, 'teams/t2/history/me': newer,
    'teams/t3': team(), 'joinCodes/ABCDEF': { teamId: 't3' },
  });
  api.startTeams(['t1', 't2', 'removed'], 'me', 'athlete');
  emit('teams/t2/history/me', null);
  emit('teams/t1/history/me', null);
  assert.equal(api.getSession().history.get('me'), newer);
  await api.saveHistory({ ...newer, concussions: 30 });
  const saved = data.get('teams/t1/history/me');
  assert.equal(saved.concussions, 20);
  assert.deepEqual(plain(data.get('teams/t2/history/me')), plain(saved));
  assert.equal(writes.filter((w) => w.path.includes('/history/')).length, 2);
  assert.ok(!data.has('teams/removed/history/me'));
  emit('teams/t1/history/me', null);
  await api.joinTeam('ABCDEF');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(data.get('teams/t3/history/me')), plain(saved));
  api.startTeams([], 'me', 'athlete');
  assert.equal(api.getSession().history.size, 0);
  api.stopTeam();
});
