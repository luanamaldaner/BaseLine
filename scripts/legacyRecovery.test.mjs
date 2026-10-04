import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/lib/legacyRecovery.js', import.meta.url), 'utf8')
  .replace(/^import.*\n/gm, '').replace(/\bexport /g, '');
const trial = { subjectUid: 'me', testerUid: 'me', kind: 'baseline', test: 'reaction', metrics: { medianMs: 250 }, at: '2026-10-03T18:00:00.000Z' };
const doc = (id, data = trial, pending = true) => ({ id, data: () => data, metadata: { hasPendingWrites: pending } });
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(records, storage = new Map(), overrides = {}) {
  const events = [];
  const context = vm.createContext({ db: {},
    collection: (_, ...parts) => parts.join('/'),
    stopLegacyFirestoreNetwork: async () => { events.push('network-disabled'); },
    getDocsFromCache: async (path) => { events.push(`cache:${path}`); return { docs: records[path] ?? [] }; },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { events.push('marker'); storage.set(key, value); } },
    ...overrides,
  });
  vm.runInContext(source + '\nglobalThis.recover = recoverLegacyTrials;', context);
  return { recover: context.recover, events, storage };
}

test('network is disabled before cache reads and only this tester’s pending results are recovered', async () => {
  const other = { ...trial, subjectUid: 'teammate', kind: 'check', teamId: 'team', status: 'normal' };
  const { recover, events } = setup({
    'users/me/trials': [doc('mine'), doc('confirmed', trial, false), doc('someone-else', { ...trial, testerUid: 'coach' })],
    'users/teammate/trials': [doc('teammate-check', other)],
  });
  const queued = [];
  const result = await recover({ ownerId: 'me', subjectIds: ['teammate', 'me'], enqueue: async (entry) => { events.push('queued'); queued.push(entry); } });
  assert.equal(events[0], 'network-disabled');
  assert.equal(result.recovered, 2);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(plain(queued), [
    { id: 'mine', path: 'trials/me/mine', trial },
    { id: 'teammate-check', path: 'trials/teammate/teammate-check', trial: other },
  ]);
  assert.ok(events.indexOf('marker') > events.indexOf('queued'));
});

test('a recovery marker is not written until durable enqueue has completed', async () => {
  const { recover, storage } = setup({ 'users/me/trials': [doc('mine')] });
  let complete;
  const pending = recover({ ownerId: 'me', enqueue: () => new Promise((resolve) => { complete = resolve; }) });
  await tick();
  assert.equal(storage.size, 0);
  complete();
  await pending;
  assert.equal(storage.size, 1);
});

test('an imported result stays skipped after a new browser session while another owner is isolated', async () => {
  const records = { 'users/me/trials': [doc('mine')] }, storage = new Map();
  await setup(records, storage).recover({ ownerId: 'me', enqueue: async () => {} });
  let enqueues = 0;
  const result = await setup(records, storage).recover({ ownerId: 'me', enqueue: async () => { enqueues++; } });
  assert.equal(enqueues, 0);
  assert.equal(result.skipped, 1);
  assert.ok(storage.has('baseline:recovered-firestore:me'));
  assert.equal(storage.has('baseline:recovered-firestore:another-account'), false);
});

test('failed durable enqueue is reported and remains retryable without deleting the original cache', async () => {
  const { recover, storage } = setup({ 'users/me/trials': [doc('mine')] });
  const failure = await recover({ ownerId: 'me', enqueue: async () => { throw new Error('Disk unavailable'); } });
  assert.equal(failure.errors.length, 1);
  assert.match(failure.errors[0].message, /original result has not been removed/);
  assert.equal(storage.size, 0);
  const retry = await recover({ ownerId: 'me', enqueue: async () => {} });
  assert.equal(retry.recovered, 1);
});

test('an auth change after cached reading prevents enqueue under the next account', async () => {
  let active = true;
  const { recover, storage } = setup({}, new Map(), {
    getDocsFromCache: async () => { active = false; return { docs: [doc('mine')] }; },
  });
  let enqueues = 0;
  await recover({ ownerId: 'me', isActive: () => active, enqueue: async () => { enqueues++; } });
  assert.equal(enqueues, 0);
  assert.equal(storage.size, 0);
});

test('failure disabling Firestore network prevents cache processing', async () => {
  let reads = 0;
  const { recover } = setup({}, new Map(), {
    stopLegacyFirestoreNetwork: async () => { throw new Error('Cache initialization failed'); },
    getDocsFromCache: async () => { reads++; return { docs: [] }; },
  });
  const result = await recover({ ownerId: 'me', enqueue: async () => {} });
  assert.equal(reads, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Keep this browser’s stored data/);
});

test('team-scoped pending checks recover their source team and duplicate record copies keep one ID', async () => {
  const check = { ...trial, subjectUid: 'teammate', kind: 'check', status: 'normal' };
  const { recover } = setup({
    'users/me/trials': [doc('baseline')],
    'teams/team-one/trials': [doc('baseline'), doc('check', check), doc('old-outsider', { ...check, subjectUid: 'former-member' })],
  });
  const queued = [];
  const result = await recover({ ownerId: 'me', subjectIds: ['teammate'], teamIds: ['team-one'], enqueue: async (entry) => queued.push(entry) });
  assert.equal(result.recovered, 2);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(plain(queued), [
    { id: 'baseline', path: 'trials/me/baseline', trial },
    { id: 'check', path: 'trials/teammate/check', trial: { ...check, teamId: 'team-one' } },
  ]);
});

test('the new app disables its legacy network immediately at startup and shares the promise with recovery', async () => {
  const startup = readFileSync(new URL('../src/lib/firebase.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"].*?['"];\s*/gm, '')
    .replace('import.meta.env', 'testEnv').replace(/\bexport /g, '');
  const events = [];
  const pending = new Promise(() => {});
  const context = vm.createContext({
    testEnv: { VITE_FIREBASE_API_KEY: 'test' },
    initializeApp: () => ({}), initializeAuth: () => ({}), getDatabase: () => ({}),
    indexedDBLocalPersistence: {}, browserLocalPersistence: {},
    initializeFirestore: () => { events.push('initialized'); return {}; },
    persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    disableNetwork: () => { events.push('disabled'); return pending; },
  });
  vm.runInContext(startup + '\nglobalThis.stop = stopLegacyFirestoreNetwork;', context);
  assert.deepEqual(events, ['initialized', 'disabled']);
  assert.equal(context.stop(), context.stop());
  assert.deepEqual(events, ['initialized', 'disabled']);
});
