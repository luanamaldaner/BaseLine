// Live state for the signed-in user: profile, team, roster, and the results
// they're allowed to see (their own as an athlete, the whole team as coach).
// Pages read it synchronously through useSession(); writes go to Firestore.

import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, onSnapshot, query, where, writeBatch, deleteDoc, setDoc, updateDoc,
} from 'firebase/firestore';
import { auth, db, recordCheckFn } from './firebase.js';

const empty = () => ({
  authChecked: false,
  user: null,
  profile: undefined, // undefined = loading, null = none yet
  team: undefined,
  members: new Map(), // uid -> { uid, name, joinedAt }
  trials: new Map(), // id -> trial
  trialsReady: false,
  error: null,
});

let state = empty();
const listeners = new Set();
let unsubs = { profile: null, team: [] };

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function useSession() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}

export const getSession = () => state;

function stopTeam() {
  unsubs.team.forEach((u) => u());
  unsubs.team = [];
}

function startTeam(teamId, uid, role) {
  stopTeam();
  const fail = (e) => set({ error: e.message });
  unsubs.team.push(
    onSnapshot(doc(db, 'teams', teamId), (d) => set({ team: d.exists() ? { id: d.id, ...d.data() } : null }), fail),
    onSnapshot(collection(db, 'teams', teamId, 'members'), (snap) => {
      const members = new Map(snap.docs.map((d) => [d.id, { uid: d.id, ...d.data() }]));
      set({ members });
      // Removed by the coach: clear the stale team link on our profile.
      if (role === 'athlete' && !snap.metadata.fromCache && !members.has(uid)) {
        updateDoc(doc(db, 'users', uid), { teamId: null }).catch(fail);
      }
    }, fail),
    onSnapshot(
      role === 'coach'
        ? collection(db, 'teams', teamId, 'trials')
        : query(collection(db, 'teams', teamId, 'trials'), where('subjectUid', '==', uid)),
      (snap) => set({
        trials: new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }])),
        trialsReady: true,
      }),
      fail,
    ),
  );
}

onAuthStateChanged(auth, (user) => {
  unsubs.profile?.();
  stopTeam();
  state = { ...empty(), authChecked: true, user };
  listeners.forEach((fn) => fn());
  if (!user) return;
  let teamKey = null;
  unsubs.profile = onSnapshot(
    doc(db, 'users', user.uid),
    (d) => {
      const profile = d.exists() ? d.data() : null;
      set({ profile });
      const key = profile?.teamId ? `${profile.teamId}:${profile.role}` : null;
      if (key !== teamKey) {
        teamKey = key;
        if (key) startTeam(profile.teamId, user.uid, profile.role);
        else {
          stopTeam();
          set({ team: null, members: new Map(), trials: new Map(), trialsReady: false });
        }
      }
    },
    (e) => set({ error: e.message, profile: null }),
  );
});

// ---------------------------------------------------------------- actions

const uid = () => auth.currentUser.uid;
const now = () => new Date().toISOString();

export const logOut = () => signOut(auth);

export function createProfile(role, name) {
  return setDoc(doc(db, 'users', uid()), { role, name: name.trim().slice(0, 60), teamId: null });
}

// No 0/O/1/I so codes are easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export async function createTeam(teamName) {
  const me = uid();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const teamRef = doc(collection(db, 'teams'));
    const batch = writeBatch(db);
    batch.set(teamRef, {
      name: teamName.trim().slice(0, 60),
      coachUid: me,
      coachName: state.profile.name,
      code,
      createdAt: now(),
    });
    batch.set(doc(db, 'joinCodes', code), { teamId: teamRef.id });
    batch.update(doc(db, 'users', me), { teamId: teamRef.id });
    try {
      await batch.commit();
      return;
    } catch (e) {
      // A taken code fails the write; try another one.
      if (e.code !== 'permission-denied' || attempt === 4) throw e;
    }
  }
}

export async function joinTeam(rawCode) {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Team codes are 6 letters and numbers.');
  const lookup = await getDoc(doc(db, 'joinCodes', code));
  if (!lookup.exists()) throw new Error('No team with that code. Check it with your coach.');
  const { teamId } = lookup.data();
  const me = uid();
  const batch = writeBatch(db);
  batch.set(doc(db, 'teams', teamId, 'members', me), { name: state.profile.name, code, joinedAt: now() });
  batch.update(doc(db, 'users', me), { teamId });
  await batch.commit();
}

export async function leaveTeam() {
  const me = uid();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'teams', state.profile.teamId, 'members', me));
  batch.update(doc(db, 'users', me), { teamId: null });
  await batch.commit();
}

export function removeMember(memberUid) {
  return deleteDoc(doc(db, 'teams', state.profile.teamId, 'members', memberUid));
}

// A measurement that couldn't be computed (NaN/Infinity) is stored as null.
const clean = (metrics) =>
  Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, Number.isFinite(v) ? v : null]));

// Your own baseline. Written directly (works offline, syncs later).
export function saveBaseline(test, metrics) {
  const ref = doc(collection(db, 'teams', state.profile.teamId, 'trials'));
  const trial = { subjectUid: uid(), testerUid: uid(), test, kind: 'baseline', at: now(), metrics: clean(metrics) };
  setDoc(ref, trial).catch((e) => set({ error: `Saving failed: ${e.message}` }));
  return { id: ref.id, ...trial };
}

// A post-hit check on anyone on the team (including yourself). The server
// compares it to their baseline and returns the call.
export async function submitCheck(subjectUid, test, metrics) {
  const res = await recordCheckFn({ teamId: state.profile.teamId, subjectUid, test, metrics: clean(metrics) });
  return res.data;
}

export function deleteTrial(id) {
  return deleteDoc(doc(db, 'teams', state.profile.teamId, 'trials', id));
}
