// Live in-memory copy of the signed-in user's trials, kept in sync with
// Firestore (users/{uid}/trials). Pages read it synchronously; writes update
// the copy immediately and go to Firestore, which queues them when offline.

import {
  collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase.js';

let uid = null;
let unsubscribe = null;
let trials = new Map(); // id -> { id, athlete, test, kind, at, metrics }
let version = 0;
let ready = false;
const listeners = new Set();

function emit() {
  version++;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getVersion = () => version;
export const isReady = () => ready;

const trialsCol = () => collection(db, 'users', uid, 'trials');

export function startSync(userId, onError) {
  stopSync();
  uid = userId;
  ready = false;
  unsubscribe = onSnapshot(
    trialsCol(),
    (snap) => {
      trials = new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
      ready = true;
      emit();
    },
    (err) => {
      ready = true;
      onError?.(err);
      emit();
    },
  );
}

export function stopSync() {
  unsubscribe?.();
  unsubscribe = null;
  uid = null;
  trials = new Map();
  ready = false;
  emit();
}

export function allTrialsRaw() {
  return [...trials.values()];
}

export function putTrial({ athlete, test, kind, at, metrics }) {
  const ref = doc(trialsCol());
  // A measurement that couldn't be computed (NaN/Infinity) is stored as null.
  const clean = Object.fromEntries(
    Object.entries(metrics).map(([k, v]) => [k, Number.isFinite(v) ? v : null]),
  );
  const trial = { athlete: athlete.slice(0, 100), test, kind, at, metrics: clean };
  trials.set(ref.id, { id: ref.id, ...trial });
  emit();
  setDoc(ref, trial).catch((e) => console.error('Saving trial failed', e));
  return { id: ref.id, ...trial };
}

export function removeTrials(ids) {
  if (!ids.length) return;
  ids.forEach((id) => trials.delete(id));
  emit();
  if (ids.length === 1) {
    deleteDoc(doc(trialsCol(), ids[0])).catch((e) => console.error('Delete failed', e));
    return;
  }
  // Batches are limited to 500 writes.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    ids.slice(i, i + 450).forEach((id) => batch.delete(doc(trialsCol(), id)));
    batch.commit().catch((e) => console.error('Delete failed', e));
  }
}
