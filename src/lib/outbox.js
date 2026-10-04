// A durable queue belongs to the signed-in tester, even when the result belongs
// to a teammate. Entries keep the original ID and payload through every retry.
const DATABASE = 'baseline-result-outbox';
const STORE = 'trials';
const storageKey = (ownerId, id) => JSON.stringify([ownerId, id]);

function storageError(cause) {
  const error = new Error(cause?.name === 'QuotaExceededError'
    ? 'This browser is out of storage space. The result has not been saved. Free up space and retry.'
    : 'This browser could not store the result safely. Keep this page open and retry before leaving.');
  error.name = cause?.name === 'QuotaExceededError' ? 'QuotaExceededError' : 'Error';
  error.code = 'storage-unavailable';
  error.cause = cause;
  return error;
}

export function createIndexedDbOutboxStore(indexedDB = globalThis.indexedDB) {
  let connection;
  let channel;
  const subscribers = new Set();
  const notify = (entry, status = entry.status) => {
    // No measurements leave IndexedDB through this channel, only wake-up IDs.
    let broadcast;
    try {
      broadcast = channel ?? (typeof globalThis.BroadcastChannel === 'function' ? new globalThis.BroadcastChannel(DATABASE) : null);
      broadcast?.postMessage({ ownerId: entry.ownerId, id: entry.id, status });
    }
    catch { /* Visibility and explicit retry also rescan the durable queue. */ }
    finally { if (broadcast && broadcast !== channel) broadcast.close(); }
  };
  const open = () => {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!indexedDB) return reject(storageError());
      let request;
      let rejected = false;
      const fail = (cause) => { rejected = true; reject(storageError(cause)); };
      try { request = indexedDB.open(DATABASE, 1); }
      catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('ownerId', 'ownerId');
        }
      };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('Close other Baseline tabs and retry.'));
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    }).catch((error) => { connection = null; throw error; });
    return connection;
  };

  const transaction = async (mode, operation) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      let request;
      try {
        tx = db.transaction(STORE, mode);
        request = operation(tx.objectStore(STORE));
      } catch (error) { reject(storageError(error)); return; }
      // An individual request succeeding is not enough: the transaction must
      // commit before the UI may call an enqueue durable.
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(storageError(tx.error ?? request.error));
      tx.onerror = () => {}; // The transaction's abort reports the failure once.
    });
  };

  return {
    load: (ownerId) => transaction('readonly', (store) => store.index('ownerId').getAll(ownerId)),
    put: async (entry) => {
      await transaction('readwrite', (store) => store.put({ ...entry, key: storageKey(entry.ownerId, entry.id) }));
      notify(entry);
    },
    fail: async (entry) => {
      // Another tab may already have acknowledged and removed this entry.
      // A late rejected request must never recreate that old queue row.
      const persisted = await transaction('readwrite', (store) => {
        const outcome = { result: false };
        const current = store.get(storageKey(entry.ownerId, entry.id));
        current.onsuccess = () => {
          if (!current.result) return;
          store.put({ ...entry, key: storageKey(entry.ownerId, entry.id) });
          outcome.result = true;
        };
        return outcome;
      });
      if (persisted) notify(entry);
      return persisted;
    },
    remove: async (ownerId, id) => {
      await transaction('readwrite', (store) => store.delete(storageKey(ownerId, id)));
      notify({ ownerId, id }, 'saved');
    },
    subscribe: (listener) => {
      subscribers.add(listener);
      if (!channel && typeof globalThis.BroadcastChannel === 'function') {
        try {
          channel = new globalThis.BroadcastChannel(DATABASE);
          channel.onmessage = ({ data }) => { for (const subscriber of subscribers) subscriber(data); };
        } catch { /* Retry and visibility are available without BroadcastChannel. */ }
      }
      return () => {
        subscribers.delete(listener);
        if (!subscribers.size) { channel?.close(); channel = null; }
      };
    },
  };
}

const failureDetails = (error) => ({ code: error?.code ?? 'unknown', message: error?.message ?? String(error) });
const clone = (value) => structuredClone(value);
const sameValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
};

export function createTrialOutbox({ ownerId, write, onChange = () => {}, onError = () => {}, storage = createIndexedDbOutboxStore() }) {
  if (!ownerId || typeof write !== 'function') throw new Error('A signed-in owner and result writer are required.');
  const entries = new Map();
  const writing = new Set();
  let closed = false;
  let preparing = Promise.resolve();
  let refreshing = Promise.resolve();

  const publish = () => { if (!closed) onChange(new Map([...entries].map(([id, entry]) => [id, clone(entry)]))); };
  const report = (error) => { if (!closed) onError(error); };
  const requireOpen = () => {
    if (closed) throw new Error('Your account changed. Sign in again before saving this result.');
  };

  const send = (id) => {
    const entry = entries.get(id);
    if (closed || writing.has(id) || entry?.status !== 'pending') return;
    writing.add(id);
    Promise.resolve().then(() => {
      // Auth can change between queueing and the promise's next microtask.
      if (closed) return false;
      return Promise.resolve(write({ id, path: entry.path, trial: clone(entry.trial) })).then(() => true);
    }).then(async (written) => {
      if (!written) return;
      entries.set(id, { ...entry, status: 'saved', error: null });
      publish();
      // If cleanup fails, replaying the same id/payload after reload is safe.
      // A remote acknowledgement still means the result really was saved.
      try { await storage.remove(ownerId, id); }
      catch (error) { report(error); }
    }, async (error) => {
      if (entries.get(id)?.status === 'saved') return;
      const failed = { ...entry, status: 'failed', error: failureDetails(error) };
      entries.set(id, failed);
      try {
        if (storage.fail) await storage.fail(failed);
        else await storage.put(failed);
      }
      catch (persistError) { report(persistError); }
      publish();
    }).finally(() => writing.delete(id));
  };

  const mergeStored = (saved) => {
    for (const entry of saved) {
      // Reject another user's entries even if a storage adapter returns them.
      if (entry.ownerId !== ownerId || entries.get(entry.id)?.status === 'saved' || writing.has(entry.id)) continue;
      entries.set(entry.id, { ...entry, status: entry.status === 'failed' ? 'failed' : 'pending' });
    }
    publish();
    for (const id of entries.keys()) send(id);
  };
  let initialized = false;
  let initializing;
  const initialize = () => {
    if (initialized) return Promise.resolve();
    if (!initializing) initializing = storage.load(ownerId).then((saved) => {
      mergeStored(saved); initialized = true;
    }).finally(() => { initializing = null; });
    return initializing;
  };
  const ready = initialize();
  // Allow the caller to await ready without producing an unhandled rejection
  // when it also relies on onError for its initial account-loading screen.
  ready.catch(report);

  // Serialize preparation, but never block it behind a remote connection.
  const prepare = (fn) => {
    const result = preparing.then(async () => { await initialize(); requireOpen(); return fn(); });
    preparing = result.catch(() => {});
    return result;
  };

  const refresh = (change) => {
    if (closed || (change?.ownerId && change.ownerId !== ownerId)) return;
    if (change?.status === 'saved' && entries.has(change.id)) {
      entries.set(change.id, { ...entries.get(change.id), status: 'saved', error: null });
      publish();
    }
    refreshing = refreshing.then(async () => {
      if (closed) return;
      await initialize();
      const stored = await storage.load(ownerId);
      if (!closed) mergeStored(stored);
    }).catch(report);
  };
  const unsubscribe = storage.subscribe?.(refresh);
  const onVisible = () => { if (globalThis.document?.visibilityState === 'visible') refresh(); };
  globalThis.document?.addEventListener('visibilitychange', onVisible);

  return {
    get ready() { return initialized ? Promise.resolve() : initialize(); },
    enqueue: ({ id, path, trial }) => prepare(async () => {
      if (!id || !path || !trial) throw new Error('A result ID, path and result are required.');
      const current = entries.get(id);
      if (current) {
        if (current.path !== path || !sameValue(current.trial, trial)) throw new Error('That result ID is already in use.');
        return clone(current);
      }
      const entry = { ownerId, id, path, trial: clone(trial), status: 'pending', error: null, queuedAt: Date.now() };
      await storage.put(entry);
      // If sign-out happened during the disk write, keep the durable entry for
      // its owner, but do not send it under the next account's credentials.
      requireOpen();
      entries.set(id, entry);
      publish();
      send(id);
      return clone(entry);
    }),
    retry: (id) => prepare(async () => {
      const current = entries.get(id);
      if (!current) throw new Error('This result is no longer waiting to sync.');
      if (current.status !== 'failed' || writing.has(id)) return clone(current);
      const entry = { ...current, status: 'pending', error: null };
      await storage.put(entry);
      requireOpen();
      entries.set(id, entry);
      publish();
      send(id);
      return clone(entry);
    }),
    retryAll: () => prepare(async () => {
      // Recover work left by a closed tab even if its notification was missed.
      mergeStored(await storage.load(ownerId));
      for (const [id, current] of entries) {
        if (current.status !== 'failed' || writing.has(id)) continue;
        const entry = { ...current, status: 'pending', error: null };
        await storage.put(entry);
        requireOpen();
        entries.set(id, entry);
        publish();
        send(id);
      }
    }),
    close: () => {
      closed = true;
      unsubscribe?.();
      globalThis.document?.removeEventListener('visibilitychange', onVisible);
    },
  };
}
