import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as assess from '../shared/assess.js';
import { serviceErrorMessage } from '../src/lib/serviceErrors.js';

const source = readFileSync(new URL('../src/lib/session.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"].*?['"];\s*/gm, '')
  .replaceAll('import.meta.env.DEV', 'false').replace(/\bexport /g, '');
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));
const baseline = { subjectUid: 'me', testerUid: 'me', test: 'reaction', kind: 'baseline', at: '2026-10-01T12:00:00.000Z', metrics: { medianMs: 250, spreadMs: 30, mistakes: 0 } };
const team = (coachUid = 'coach', code = 'ABCDEF') => ({ coachUid, name: 'Team', coachName: 'Coach', code, createdAt: baseline.at });
const member = { name: 'Me', code: 'ABCDEF', joinedAt: baseline.at };
const athlete = { role: 'athlete', name: 'Me', teamIds: { t1: true } };

function setup(initial = {}, options = {}) {
  if (options.server && !options.server.initialized) {
    options.server.data = plain(options.server.data);
    options.server.initialized = true;
  }
  const data = options.server?.data ?? plain(initial), streams = new Map(), writes = [], reads = [], timers = [], queues = [];
  let authCallback, serial = 0;
  let isConnected = data['.info']?.connected === true;
  const auth = { currentUser: null };
  const local = new Map();
  const at = (path) => path === '.info/connected' ? isConnected
    : path.split('/').filter(Boolean).reduce((obj, key) => obj?.[key], data) ?? null;
  const assign = (path, value) => {
    const parts = path.split('/').filter(Boolean); let node = data;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    if (value === null) delete node[parts.at(-1)]; else node[parts.at(-1)] = plain(value);
  };
  const snap = (path) => ({ val: () => at(path), exists: () => at(path) !== null, key: path.split('/').at(-1) });
  const emit = (path) => { for (const entry of streams.get(path) ?? []) if (entry.active) entry.next(snap(path)); };
  const notifyLocal = (path) => {
    if (!isConnected && path !== '.info/connected') return;
    for (const key of streams.keys()) if (key === path || key.startsWith(path + '/') || path.startsWith(key + '/')) emit(key);
  };
  if (options.server) options.server.clients.add(notifyLocal);
  const notify = (path) => options.server ? options.server.clients.forEach((client) => client(path)) : notifyLocal(path);
  const write = async (reference, value) => {
    writes.push({ path: reference.path, value: plain(value) });
    if (options.write) await options.write(reference.path, value);
    assign(reference.path, value); notify(reference.path);
  };
  const context = vm.createContext({
    ...assess, serviceErrorMessage, auth, realtimeDb: {}, console, crypto: globalThis.crypto,
    localStorage: { getItem: (key) => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) },
    recoverLegacyTrials: async () => ({ recovered: 0, skipped: 0, errors: [] }),
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); timers.push(ms); return timer; }, clearTimeout,
    useSyncExternalStore: () => {}, onAuthStateChanged: (_, fn) => { authCallback = fn; }, signOut: () => {},
    ref: (_, path) => {
      if (path === '') throw new Error('ref() path argument cannot be empty');
      return { path: path ?? '', key: path?.split('/').at(-1) };
    },
    push: (parent) => { const key = (options.clientId ?? '') + 'new' + ++serial; return { path: parent.path + '/' + key, key }; },
    get: async (reference) => { reads.push(reference.path); return snap(reference.path); },
    writeValue: write, remove: (reference) => write(reference, null),
    update: async (reference, patch) => {
      if (options.update) await options.update(reference, patch);
      writes.push({ path: reference.path, patch: plain(patch) });
      const paths = Object.entries(patch).map(([key, value]) => { const path = [reference.path, key].filter(Boolean).join('/'); assign(path, value); return path; });
      for (const path of paths) notify(path);
    },
    runTransaction: async (reference, change) => { const result = change(at(reference.path)); if (result !== undefined) await write(reference, result); return { snapshot: snap(reference.path), committed: result !== undefined }; },
    onValue: (reference, next, error) => {
      const entry = { active: true, next, error };
      if (!streams.has(reference.path)) streams.set(reference.path, []);
      streams.get(reference.path).push(entry);
      queueMicrotask(() => { if (entry.active && !options.manualStreams?.includes(reference.path)) next(snap(reference.path)); });
      return () => { entry.active = false; };
    },
    createTrialOutbox: ({ ownerId, write: send, onChange }) => {
      const jobs = new Map(); let closed = false;
      const publish = () => { if (!closed) onChange(new Map(jobs)); };
      const run = (entry) => {
        entry.status = 'pending'; publish();
        send(entry).then(() => { entry.status = 'saved'; publish(); }, (error) => { entry.status = 'failed'; entry.error = error.message; publish(); });
      };
      const queue = { ownerId, jobs, ready: Promise.resolve(),
        enqueue: async (item) => { if (options.persist) await options.persist(item); const entry = { ...item, status: 'pending' }; jobs.set(item.id, entry); run(entry); return entry; },
        retry: async (id) => { const entry = jobs.get(id); if (entry?.status === 'failed') run(entry); return entry; },
        retryAll: async () => { for (const entry of jobs.values()) if (entry.status === 'failed') run(entry); }, close: () => { closed = true; },
      };
      queues.push(queue); return queue;
    },
  });
  vm.runInContext(source + '\nglobalThis.api = { getSession, setState, startTeams, stopTeams, createProfile, createTeam, joinTeam, leaveTeam, removeMember, saveHistory, saveBaseline, submitCheck, deleteTrial, syncRanges, retrySync, retryTrial, saveAvatar, recordConsent };', context);
  const login = async (id = 'me') => { auth.currentUser = { uid: id }; authCallback(auth.currentUser); await flush(); };
  const setConnection = (value) => {
    isConnected = value; emit('.info/connected');
    if (value) for (const path of streams.keys()) if (path !== '.info/connected') emit(path);
  };
  const fail = (path, error) => { for (const entry of streams.get(path) ?? []) if (entry.active) entry.error?.(error); };
  return { api: context.api, data, at, assign, emit, fail, streams, writes, reads, timers, queues, login, auth, setConnection, local };
}

test('team joins and leaves atomically maintain profile links and coach access per shared team', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team(), t2: team() },
    members: { t1: { me: member } }, joinCodes: { ABCDEF: { teamId: 't2' } }, recordReaders: { me: { coach: { t1: true } } } });
  await h.login(); await h.api.joinTeam('abcdef'); await h.api.joinTeam('ABCDEF');
  assert.equal(h.at('profiles/me/teamIds/t2'), true);
  assert.equal(h.at('recordReaders/me/coach/t2'), true);
  assert.equal(h.writes.filter((w) => w.patch?.['members/t2/me']).length, 1);
  await h.api.leaveTeam('t1');
  assert.equal(h.at('profiles/me/teamIds/t1'), null);
  assert.equal(h.at('recordReaders/me/coach/t1'), null);
  assert.equal(h.at('recordReaders/me/coach/t2'), true);
});

test('new consent records only its timestamp once without requiring age confirmation', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: { role: 'athlete', name: 'Me' } } });
  await h.login();
  await h.api.recordConsent();
  const consentedAt = h.at('profiles/me/consentedAt');
  assert.match(consentedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(h.at('profiles/me/ageConfirmedAt'), null);
  assert.deepEqual(Object.keys(h.writes[0].patch), ['consentedAt']);
  await h.api.recordConsent();
  assert.equal(h.writes.length, 1);
  assert.equal(h.at('profiles/me/consentedAt'), consentedAt);
});

test('existing consent is unchanged when the profile has no age confirmation', async () => {
  const original = { ...athlete, consentedAt: '2026-10-01T12:00:00.000Z' };
  const h = setup({ '.info': { connected: true }, profiles: { me: original } });
  await h.login();
  await h.api.recordConsent();
  assert.equal(h.writes.length, 0);
  assert.equal(h.at('profiles/me/consentedAt'), original.consentedAt);
  assert.equal(h.at('profiles/me/name'), original.name);
  assert.deepEqual(h.at('profiles/me/teamIds'), original.teamIds);
  assert.equal(h.at('profiles/me/ageConfirmedAt'), null);
});

test('adding missing consent preserves a legacy age confirmation without rewriting it', async () => {
  const ageConfirmedAt = '2026-10-01T12:00:00.000Z';
  const h = setup({ '.info': { connected: true }, profiles: { me: { role: 'athlete', name: 'Me', ageConfirmedAt } } });
  await h.login();
  await h.api.recordConsent();
  assert.deepEqual(Object.keys(h.writes[0].patch), ['consentedAt']);
  assert.equal(h.at('profiles/me/ageConfirmedAt'), ageConfirmedAt);
});

test('another device can confirm consent during the write without requiring a legacy age field', async () => {
  const remoteTimestamp = '2026-10-02T12:00:00.000Z';
  let h;
  h = setup({ '.info': { connected: true }, profiles: { me: { role: 'athlete', name: 'Me' } } }, {
    update: async (reference) => {
      h.assign(`${reference.path}/consentedAt`, remoteTimestamp);
      throw Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED' });
    },
  });
  await h.login();
  await h.api.recordConsent();
  assert.equal(h.at('profiles/me/consentedAt'), remoteTimestamp);
  assert.equal(h.at('profiles/me/ageConfirmedAt'), null);
  assert.equal(h.writes.length, 0);
});

test('a rejected consent write is not mistaken for another device confirming it', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: { role: 'athlete', name: 'Me' } } }, {
    update: async () => { throw Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED' }); },
  });
  await h.login();
  await assert.rejects(h.api.recordConsent(), (error) => error.code === 'PERMISSION_DENIED');
  assert.equal(h.at('profiles/me/consentedAt'), null);
});

test('leave removes private team history, cutoff and avatar copies without deleting results', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } },
    trials: { me: { b: baseline } }, history: { t1: { me: { concussions: 1 } } }, avatars: { t1: { me: { kind: 'dot', dot: 'happy' } } } });
  await h.login(); await h.api.leaveTeam('t1');
  assert.equal(h.at('history/t1/me'), null); assert.equal(h.at('avatars/t1/me'), null);
  assert.equal(h.at('ranges/t1/me_reaction'), null);
  assert.deepEqual(h.at('trials/me/b'), baseline);
});

test('equal cutoff maps with different key order never create repeated writes', async () => {
  const lim = assess.limitsFrom(assess.summarize([baseline]), assess.SPECS.reaction);
  lim.limits = Object.fromEntries(Object.entries(lim.limits).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, { limit: v.limit, worse: v.worse }]));
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } },
    trials: { me: { b: baseline } }, ranges: { t1: { me_reaction: { subjectUid: 'me', test: 'reaction', ...lim } } } });
  await h.login();
  for (let i = 0; i < 30; i++) h.emit('ranges/t1');
  await flush(); assert.equal(h.writes.length, 0);
  assert.equal(h.reads.length, 0); assert.equal(h.timers.length, 0);
});

test('one coach record listener per athlete remains until the last shared team is left', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: { role: 'coach', name: 'Me', teamIds: { t1: true, t2: true } } },
    teams: { t1: team('me'), t2: team('me') }, members: { t1: { a: member }, t2: { a: member } } });
  await h.login(); assert.equal(h.streams.get('trials/a').length, 1);
  h.assign('members/t1/a', null); h.emit('members/t1'); assert.equal(h.streams.get('trials/a')[0].active, true);
  h.assign('members/t2/a', null); h.emit('members/t2'); assert.equal(h.streams.get('trials/a')[0].active, false);
});

test('denied coach record read never deletes existing published cutoffs', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: { role: 'coach', name: 'Me', teamIds: { t1: true } } }, teams: { t1: team('me') },
    members: { t1: { a: member } }, ranges: { t1: { a_reaction: { subjectUid: 'a', test: 'reaction', n: 3, limits: {} } } } }, { manualStreams: ['trials/a'] });
  await h.login(); h.fail('trials/a', { code: 'PERMISSION_DENIED' }); await flush();
  assert.equal(h.api.getSession().trialsReady, true);
  assert.equal(h.api.getSession().recordsReady.has('a'), false);
  assert.equal(h.writes.length, 0);
});

test('saving waits for durable local storage, then shows queued before remote acknowledgement', async () => {
  let durable, remote;
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } }, {
    persist: () => new Promise((resolve) => { durable = resolve; }),
    write: (path) => path.startsWith('trials/') ? new Promise((resolve) => { remote = resolve; }) : undefined,
  });
  await h.login(); let returned = false;
  const saved = h.api.saveBaseline('reaction', baseline.metrics).then((trial) => { returned = true; return trial; });
  await flush(); assert.equal(returned, false); assert.equal(h.writes.length, 0);
  durable(); const trial = await saved;
  assert.equal(h.api.getSession().trialWrites.get(trial.id).status, 'pending'); assert.equal(h.api.getSession().pendingWrites, 1);
  remote(); await flush(); assert.equal(h.api.getSession().trialWrites.get(trial.id).status, 'saved'); assert.equal(h.api.getSession().pendingWrites, 0);
});

test('teammate check saves privately under the subject and exposes no numerical comparison', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member, a: member } } });
  await h.login();
  const result = await h.api.submitCheck('a', 'reaction', baseline.metrics, { rested: true }); await flush();
  assert.equal(result.comparison, undefined); assert.ok(result.trialId);
  assert.equal(h.at(`trials/a/${result.trialId}`).testerUid, 'me');
  assert.equal(h.at(`trials/a/${result.trialId}`).conditions.rested, true);
  assert.equal(h.api.getSession().trials.has(result.trialId), false);
  await assert.rejects(h.api.submitCheck('outsider', 'reaction', baseline.metrics), /shared team/);
});

test('incomplete or nonfinite eye captures cannot be saved as baselines or normal checks', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } });
  await h.login();
  const valid = { onTarget: 95, gain: 1, saccadeRate: 0.5, lagMs: 100 };
  for (const testId of ['eye', 'eyePhone']) {
    const invalid = [undefined, null, {}, Object.fromEntries(Object.keys(valid).map((key) => [key, null]))];
    for (const key of Object.keys(valid)) {
      for (const value of [undefined, null, NaN, Infinity]) invalid.push({ ...valid, [key]: value });
    }
    for (const metrics of invalid) {
      assert.throws(() => h.api.saveBaseline(testId, metrics), /Measurement unreliable\. Repeat the eye test/);
      await assert.rejects(h.api.submitCheck('me', testId, metrics), /Measurement unreliable\. Repeat the eye test/);
    }
  }
  assert.equal(h.writes.length, 0);
  assert.equal(h.queues[0].jobs.size, 0);
  assert.equal(h.api.getSession().trials.size, 0);
});

test('valid concerning eye checks retain their grade when vision history is present', async () => {
  const baselineMetrics = { onTarget: 95, gain: 1, saccadeRate: 0.5, lagMs: 100 };
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } });
  await h.login();
  for (const testId of ['eye', 'eyePhone']) {
    await h.api.saveBaseline(testId, baselineMetrics); await flush();
    const metrics = { onTarget: 25, gain: 0.3, saccadeRate: 0.5, lagMs: 280 };
    const first = await h.api.submitCheck('me', testId, metrics);
    await h.api.saveHistory({ concussions: 0, adhd: false, vision: true, vestibular: false });
    const withHistory = await h.api.submitCheck('me', testId, metrics);
    assert.equal(first.status, 'refer');
    assert.equal(withHistory.status, 'refer');
    assert.equal(withHistory.comparison.status, 'refer');
    assert.deepEqual(h.at(`trials/me/${withHistory.trialId}`).metrics, metrics);
  }
});

test('creating an existing profile never overwrites its role or name', async () => {
  const original = { role: 'coach', name: 'Original' };
  const h = setup({ '.info': { connected: true }, profiles: { me: original } });
  await h.login(); await h.api.createProfile('athlete', 'Replacement');
  assert.deepEqual(h.at('profiles/me'), original); assert.equal(h.writes.length, 0);
});

test('null metrics removed by RTDB remain part of the baseline metric shape', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } },
    trials: { me: { a: { ...baseline, metrics: {} }, b: { ...baseline, at: '2026-10-02T12:00:00.000Z' } } } });
  await h.login();
  assert.equal(h.api.getSession().trials.get('a').metrics.medianMs, null);
  assert.equal(h.at('ranges/t1/me_reaction').limits.medianMs.limit,
    assess.limitsFrom(assess.summarize([baseline]), assess.SPECS.reaction).limits.medianMs.limit);
});

test('retry preserves visible loaded screens and late callbacks cannot change a different account', async () => {
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete, other: { role: 'athlete', name: 'Other' } }, teams: { t1: team() }, members: { t1: { me: member } } });
  await h.login(); assert.equal(h.api.getSession().trialsReady, true);
  await h.api.retrySync(); assert.equal(h.api.getSession().trialsReady, true);
  await h.login('other'); h.emit('profiles/me');
  assert.equal(h.api.getSession().profile.name, 'Other'); assert.equal(h.queues[0].jobs.size, 0);
});

test('the same account on phone and desktop receives both concurrent results and remote deletions', async () => {
  const server = { data: { '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } }, clients: new Set() };
  const phone = setup({}, { server, clientId: 'phone-' });
  const desktop = setup({}, { server, clientId: 'desktop-' });
  await Promise.all([phone.login(), desktop.login()]);
  const [a, b] = await Promise.all([
    phone.api.saveBaseline('reaction', baseline.metrics),
    desktop.api.saveBaseline('reaction', { ...baseline.metrics, medianMs: 400 }),
  ]);
  await flush();
  assert.notEqual(a.id, b.id);
  for (const device of [phone, desktop]) {
    assert.equal(device.api.getSession().trials.size, 2);
    assert.equal(device.api.getSession().trials.get(a.id).metrics.medianMs, 250);
    assert.equal(device.api.getSession().trials.get(b.id).metrics.medianMs, 400);
    assert.equal(device.api.getSession().pendingWrites, 0);
    assert.equal(device.api.getSession().ranges.get('me_reaction').n, 2);
  }
  const before = phone.writes.length + desktop.writes.length;
  for (let i = 0; i < 10; i++) { phone.emit('ranges/t1'); desktop.emit('ranges/t1'); }
  await flush(); assert.equal(phone.writes.length + desktop.writes.length, before);
  await desktop.api.deleteTrial('me', a.id); await flush();
  assert.equal(phone.api.getSession().trials.has(a.id), false);
  assert.equal(desktop.api.getSession().trials.has(a.id), false);
  assert.equal(phone.api.getSession().ranges.get('me_reaction').n, 1);
});

test('offline phone result reaches the signed-in desktop only after reconnect and acknowledgement', async () => {
  const server = { data: { '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } }, clients: new Set() };
  let reconnectWrite;
  const phone = setup({}, { server, clientId: 'phone-', write: (path) => path.startsWith('trials/') ? new Promise((resolve) => { reconnectWrite = resolve; }) : undefined });
  const desktop = setup({}, { server, clientId: 'desktop-' });
  await Promise.all([phone.login(), desktop.login()]);
  phone.setConnection(false);
  const trial = await phone.api.saveBaseline('reaction', baseline.metrics);
  assert.equal(phone.api.getSession().pendingWrites, 1);
  assert.equal(phone.api.getSession().trials.has(trial.id), true);
  assert.equal(desktop.api.getSession().trials.has(trial.id), false);
  assert.equal(desktop.api.getSession().pendingWrites, 0);
  phone.setConnection(true); reconnectWrite(); await flush();
  assert.equal(phone.api.getSession().pendingWrites, 0);
  assert.equal(desktop.api.getSession().trials.get(trial.id).metrics.medianMs, 250);
});

test('team and history changes propagate to the other device without reloading or polling', async () => {
  const server = { data: { '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team(), t2: team() }, members: { t1: { me: member } }, joinCodes: { ABCDEF: { teamId: 't2' } } }, clients: new Set() };
  const phone = setup({}, { server, clientId: 'phone-' });
  const desktop = setup({}, { server, clientId: 'desktop-' });
  await Promise.all([phone.login(), desktop.login()]);
  await phone.api.joinTeam('ABCDEF'); await flush();
  assert.deepEqual(plain(desktop.api.getSession().profile.teamIds), ['t1', 't2']);
  await phone.api.saveHistory({ concussions: 2, adhd: true });
  assert.equal(desktop.api.getSession().history.get('me').concussions, 2);
  await desktop.api.leaveTeam('t1'); await flush();
  assert.deepEqual(plain(phone.api.getSession().profile.teamIds), ['t2']);
  assert.equal(phone.api.getSession().teams.has('t1'), false);
  assert.equal(phone.api.getSession().history.get('me').concussions, 2);
});

test('removing an avatar on desktop overrides the phone’s older locally cached choice', async () => {
  const server = { data: { '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } } }, clients: new Set() };
  const phone = setup({}, { server, clientId: 'phone-' });
  const desktop = setup({}, { server, clientId: 'desktop-' });
  await Promise.all([phone.login(), desktop.login()]);
  await phone.api.saveAvatar({ kind: 'dot', dot: 'mint' });
  assert.equal(desktop.api.getSession().avatars.get('me').kind, 'dot');
  await desktop.api.saveAvatar(null);
  assert.equal(phone.api.getSession().avatars.get('me')?.kind, 'none');
  assert.equal(server.data.avatars.t1.me.kind, 'none');
});

test('profile picture caching changes only after remote acknowledgement', async () => {
  let acknowledge;
  const original = { kind: 'dot', dot: 'yellow', updatedAt: '2026-10-01T12:00:00Z' };
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } }, avatars: { t1: { me: original } } }, {
    update: () => new Promise((resolve) => { acknowledge = resolve; }),
  });
  await h.login();
  h.local.set('avatar:me', JSON.stringify(original));
  const saving = h.api.saveAvatar({ kind: 'dot', dot: 'blue' });
  await flush();
  assert.equal(h.api.getSession().avatars.get('me').dot, 'yellow');
  assert.equal(JSON.parse(h.local.get('avatar:me')).dot, 'yellow');
  assert.equal(h.at('avatars/t1/me/dot'), 'yellow');
  acknowledge();
  await saving;
  assert.equal(h.api.getSession().avatars.get('me').dot, 'blue');
  assert.equal(JSON.parse(h.local.get('avatar:me')).dot, 'blue');
  assert.equal(h.at('avatars/t1/me/dot'), 'blue');
});

test('rejected and offline avatar saves preserve the previous avatar and cache', async () => {
  const original = { kind: 'dot', dot: 'yellow', updatedAt: '2026-10-01T12:00:00Z' };
  const h = setup({ '.info': { connected: true }, profiles: { me: athlete }, teams: { t1: team() }, members: { t1: { me: member } }, avatars: { t1: { me: original } } }, {
    update: async () => { throw Object.assign(new Error('Permission denied'), { code: 'PERMISSION_DENIED' }); },
  });
  await h.login();
  h.local.set('avatar:me', JSON.stringify(original));
  await assert.rejects(h.api.saveAvatar({ kind: 'dot', dot: 'red' }), /Permission denied/);
  assert.equal(h.api.getSession().avatars.get('me').dot, 'yellow');
  assert.equal(JSON.parse(h.local.get('avatar:me')).dot, 'yellow');
  assert.equal(h.at('avatars/t1/me/dot'), 'yellow');
  h.setConnection(false);
  await assert.rejects(h.api.saveAvatar(null), /Connect to the internet/);
  assert.equal(JSON.parse(h.local.get('avatar:me')).dot, 'yellow');
});
