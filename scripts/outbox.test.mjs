import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndexedDbOutboxStore, createTrialOutbox } from '../src/lib/outbox.js';

const clone = (value) => structuredClone(value);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const result = { id: 'stable-id', path: 'trials/athlete/stable-id', trial: { subjectUid: 'athlete', test: 'reaction', metrics: { medianMs: 250 }, kind: 'baseline' } };

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    load: async (ownerId) => clone([...rows.values()].filter((entry) => entry.ownerId === ownerId)),
    put: async (entry) => { rows.set(JSON.stringify([entry.ownerId, entry.id]), clone(entry)); },
    remove: async (ownerId, id) => { rows.delete(JSON.stringify([ownerId, id])); },
  };
}

function sharedTabs() {
  const rows = new Map(), tabs = new Set();
  return () => {
    const listeners = new Set();
    const emit = (entry, status = entry.status) => {
      for (const tab of tabs) if (tab !== listeners) for (const listener of tab) {
        queueMicrotask(() => listener({ ownerId: entry.ownerId, id: entry.id, status }));
      }
    };
    tabs.add(listeners);
    return {
      rows,
      load: async (ownerId) => clone([...rows.values()].filter((entry) => entry.ownerId === ownerId)),
      put: async (entry) => { rows.set(JSON.stringify([entry.ownerId, entry.id]), clone(entry)); emit(entry); },
      fail: async (entry) => {
        const key = JSON.stringify([entry.ownerId, entry.id]);
        if (!rows.has(key)) return false;
        rows.set(key, clone(entry)); emit(entry); return true;
      },
      remove: async (ownerId, id) => { rows.delete(JSON.stringify([ownerId, id])); emit({ ownerId, id }, 'saved'); },
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    };
  };
}

test('a result is durable before enqueue resolves or any cloud write starts', async () => {
  const storage = memoryStore();
  const disk = deferred(), network = deferred();
  const put = storage.put;
  storage.put = async (entry) => { await disk.promise; await put(entry); };
  const writes = [];
  let last;
  const queue = createTrialOutbox({ ownerId: 'tester', storage,
    write: (entry) => { writes.push(entry); return network.promise; }, onChange: (state) => { last = state; } });
  let resolved = false;
  const queued = queue.enqueue(result).then(() => { resolved = true; });
  await tick();
  assert.equal(resolved, false);
  assert.equal(writes.length, 0);
  disk.resolve();
  await queued;
  assert.equal(storage.rows.size, 1);
  assert.equal(last.get(result.id).status, 'pending');
  assert.deepEqual(writes, [result]);
  network.resolve();
  await tick();
  assert.equal(last.get(result.id).status, 'saved');
  assert.equal(storage.rows.size, 0);
  queue.close();
});

test('reload restores the same trial ID and payload only for its owner', async () => {
  const storage = memoryStore();
  await storage.put({ ...result, ownerId: 'tester', status: 'pending' });
  await storage.put({ ...result, id: 'other-id', ownerId: 'other-account', status: 'pending' });
  const writes = [];
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: (entry) => { writes.push(entry); return new Promise(() => {}); } });
  await queue.ready;
  await tick();
  assert.deepEqual(writes, [result]);
  assert.equal(storage.rows.size, 2);
  queue.close();
});

test('remote failures survive reload and retry the same id without duplicate sends', async () => {
  const storage = memoryStore();
  const denial = Object.assign(new Error('Access denied'), { code: 'PERMISSION_DENIED' });
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: async () => { throw denial; } });
  await queue.enqueue(result);
  await tick();
  assert.equal([...storage.rows.values()][0].status, 'failed');
  queue.close();
  const writes = [];
  const next = createTrialOutbox({ ownerId: 'tester', storage, write: async (entry) => { writes.push(entry); } });
  await next.ready;
  await tick();
  assert.equal(writes.length, 0, 'failed writes wait for an explicit retry');
  await Promise.all([next.retry(result.id), next.retry(result.id)]);
  await tick();
  assert.deepEqual(writes, [result]);
  assert.equal(storage.rows.size, 0);
  next.close();
});

test('storage failures never start a cloud write or return a false saved receipt', async () => {
  let writes = 0;
  const storage = memoryStore();
  storage.put = async () => { throw Object.assign(new Error('Disk full'), { name: 'QuotaExceededError' }); };
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: async () => { writes++; } });
  await assert.rejects(queue.enqueue(result), { name: 'QuotaExceededError' });
  assert.equal(writes, 0);
  assert.equal(storage.rows.size, 0);
  queue.close();
});

test('signing out during durable preparation keeps the old owner entry but does not launch a write', async () => {
  const storage = memoryStore(), disk = deferred();
  const put = storage.put;
  storage.put = async (entry) => { await disk.promise; await put(entry); };
  let writes = 0;
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: async () => { writes++; } });
  const pending = queue.enqueue(result);
  await tick();
  queue.close();
  disk.resolve();
  await assert.rejects(pending, /account changed/);
  await tick();
  assert.equal(writes, 0);
  assert.equal([...storage.rows.values()][0].ownerId, 'tester');
});

test('an acknowledgement with failed local cleanup safely replays the identical payload after reload', async () => {
  const storage = memoryStore();
  const remove = storage.remove;
  storage.remove = async () => { throw new Error('Cleanup interrupted'); };
  const writes = [], errors = [];
  let last;
  const queue = createTrialOutbox({ ownerId: 'tester', storage,
    write: async (entry) => { writes.push(entry); }, onChange: (state) => { last = state; }, onError: (error) => errors.push(error) });
  await queue.enqueue(result);
  await tick();
  assert.equal(last.get(result.id).status, 'saved');
  assert.equal(storage.rows.size, 1);
  assert.equal(errors.length, 1);
  queue.close();
  storage.remove = remove;
  const next = createTrialOutbox({ ownerId: 'tester', storage, write: async (entry) => { writes.push(entry); } });
  await next.ready;
  await tick();
  assert.deepEqual(writes, [result, result]);
  assert.equal(storage.rows.size, 0);
  next.close();
});

test('reusing an ID accepts identical content but rejects a changed result', async () => {
  const storage = memoryStore();
  let writes = 0;
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: () => { writes++; return new Promise(() => {}); } });
  await queue.enqueue(result);
  await queue.enqueue({ ...result, trial: { kind: 'baseline', metrics: { medianMs: 250 }, test: 'reaction', subjectUid: 'athlete' } });
  await assert.rejects(queue.enqueue({ ...result, trial: { ...result.trial, kind: 'check' } }), /already in use/);
  assert.equal(writes, 1);
  queue.close();
});

test('missing IndexedDB reports a storage error instead of silently using volatile memory', async () => {
  const storage = createIndexedDbOutboxStore(null);
  await assert.rejects(storage.load('tester'), /could not store the result safely/);
});

test('an already-open same-account tab resumes work after the saving tab closes', async () => {
  const tab = sharedTabs(), storageA = tab(), storageB = tab();
  const pending = deferred();
  let secondTabState;
  const writes = [];
  const first = createTrialOutbox({ ownerId: 'tester', storage: storageA, write: () => pending.promise });
  const second = createTrialOutbox({ ownerId: 'tester', storage: storageB,
    write: async (entry) => { writes.push(entry); }, onChange: (state) => { secondTabState = state; } });
  await Promise.all([first.ready, second.ready]);
  await first.enqueue(result);
  first.close();
  await tick();
  await tick();
  assert.deepEqual(writes, [result]);
  assert.equal(secondTabState.get(result.id).status, 'saved');
  assert.equal(storageB.rows.size, 0);
  // A request rejected after sign-out cannot recreate the entry another tab
  // already synchronized and removed from the queue.
  pending.reject(new Error('The old connection closed'));
  await tick();
  assert.equal(storageB.rows.size, 0);
  second.close();
});

test('another tab’s acknowledgement wins over a late failure and account broadcasts stay isolated', async () => {
  const tab = sharedTabs(), firstRequest = deferred();
  const storage = tab();
  let firstState, outsiderWrites = 0;
  const first = createTrialOutbox({ ownerId: 'tester', storage, write: () => firstRequest.promise, onChange: (state) => { firstState = state; } });
  const second = createTrialOutbox({ ownerId: 'tester', storage: tab(), write: async () => {} });
  const outsider = createTrialOutbox({ ownerId: 'different-account', storage: tab(), write: async () => { outsiderWrites++; } });
  await Promise.all([first.ready, second.ready, outsider.ready]);
  await first.enqueue(result);
  await tick();
  assert.equal(firstState.get(result.id).status, 'saved');
  firstRequest.reject(new Error('Stale failure'));
  await tick();
  assert.equal(firstState.get(result.id).status, 'saved');
  assert.equal(storage.rows.size, 0);
  assert.equal(outsiderWrites, 0);
  first.close(); second.close(); outsider.close();
});

test('Retry sync rescans disk for work left by a tab whose notification was missed', async () => {
  const storage = memoryStore(), writes = [];
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: async (entry) => { writes.push(entry); } });
  await queue.ready;
  await storage.put({ ...result, ownerId: 'tester', status: 'pending' });
  await queue.retryAll();
  await tick();
  assert.deepEqual(writes, [result]);
  assert.equal(storage.rows.size, 0);
  queue.close();
});

test('a transient initial storage failure can be retried without signing out', async () => {
  const storage = memoryStore();
  const load = storage.load;
  let attempts = 0;
  storage.load = async (owner) => { if (++attempts === 1) throw new Error('Storage temporarily blocked'); return load(owner); };
  const writes = [];
  const queue = createTrialOutbox({ ownerId: 'tester', storage, write: async (entry) => { writes.push(entry); } });
  await assert.rejects(queue.ready, /temporarily blocked/);
  await queue.ready;
  await queue.enqueue(result);
  await tick();
  assert.deepEqual(writes, [result]);
  queue.close();
});
