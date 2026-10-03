// Live state for the signed-in user: profile, team, roster, and the results
// they're allowed to see (their own as an athlete, the whole team as coach).
// Pages read it synchronously through useSession(); writes go to Firestore.
//
// Checks on teammates: an athlete's app publishes only their baseline
// cutoffs (teams/{teamId}/ranges/{uid}_{test}), never their results. A
// tester's phone judges a check against those cutoffs, so it can show the
// call without being able to read the teammate's data.

import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, onSnapshot, query, where, writeBatch, deleteDoc, setDoc, updateDoc, getDocFromServer,
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import {
  SPECS, TEST_IDS, ACTIONS, summarize, compareToSummary, limitsFrom, judge,
} from '../../shared/assess.js';

const empty = () => ({
  authChecked: false,
  user: null,
  profile: undefined, // undefined = loading, null = none yet
  team: undefined,
  members: new Map(), // uid -> { uid, name, joinedAt }
  trials: new Map(), // id -> trial
  trialsReady: false,
  ranges: new Map(), // `${uid}_${test}` -> { subjectUid, test, n, limits }
  history: new Map(), // uid -> { concussions, adhd, vision, vestibular, updatedAt } (own, or everyone's as coach)
  error: null,
});

let state = empty();
const listeners = new Set();
let unsubs = { profile: null, team: [] };

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

// Dev only (stripped from production builds): load fake state from the
// browser console to work on logged-in screens without an account, e.g.
//   __previewSession({ authChecked: true, user: { uid: 'c1' }, profile: {...}, ... })
if (import.meta.env.DEV) window.__previewSession = set;

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
    onSnapshot(
      doc(db, 'teams', teamId),
      { includeMetadataChanges: true },
      (d) => {
        // "Team not found" from an empty cache isn't real: wait for the server.
        if (!d.exists() && d.metadata.fromCache) return;
        set({ team: d.exists() ? { id: d.id, ...d.data() } : null });
      },
      fail,
    ),
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
      (snap) => {
        set({
          trials: new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }])),
          trialsReady: true,
        });
        // Keep my published cutoffs in step with my baselines.
        if (role === 'athlete' && !snap.metadata.fromCache) syncRanges(uid);
      },
      fail,
    ),
    onSnapshot(collection(db, 'teams', teamId, 'ranges'), (snap) => {
      set({ ranges: new Map(snap.docs.map((d) => [d.id, d.data()])) });
    }, fail),
    // Pre-existing conditions: the coach sees everyone's, an athlete their own.
    role === 'coach'
      ? onSnapshot(collection(db, 'teams', teamId, 'history'), (snap) => {
          set({ history: new Map(snap.docs.map((d) => [d.id, d.data()])) });
        }, fail)
      : onSnapshot(doc(db, 'teams', teamId, 'history', uid), (d) => {
          set({ history: d.exists() ? new Map([[uid, d.data()]]) : new Map() });
        }, fail),
  );
}

let profileRetry = null;

// Live connection to the signed-in user's profile.
//
// "No profile" (which sends someone through onboarding) is only believed when
// the SERVER says so. An empty offline cache, a slow connection, or a blocked
// stream says nothing about the account, so those stay on the loading screen
// with a message and keep asking, instead of treating a set-up account as new.
function watchProfile(user) {
  unsubs.profile?.();
  clearTimeout(profileRetry);
  const ref = doc(db, 'users', user.uid);
  let teamKey = null;
  let serverAnswered = false;

  const apply = (d) => {
    const profile = d.exists() ? d.data() : null;
    set({ profile, error: null });
    const key = profile?.teamId ? `${profile.teamId}:${profile.role}` : null;
    if (key !== teamKey) {
      teamKey = key;
      if (key) startTeam(profile.teamId, user.uid, profile.role);
      else {
        stopTeam();
        set({ team: null, members: new Map(), trials: new Map(), trialsReady: false, ranges: new Map(), history: new Map() });
      }
    }
  };

  // Ask the server directly until it answers.
  const askServer = () => {
    if (serverAnswered || auth.currentUser?.uid !== user.uid) return;
    getDocFromServer(ref).then(
      (d) => {
        serverAnswered = true;
        apply(d);
      },
      () => {
        set({ error: 'Can’t reach the server. Check your connection; trying again…' });
        profileRetry = setTimeout(askServer, 4000);
      },
    );
  };

  unsubs.profile = onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (d) => {
      if (!d.metadata.fromCache) serverAnswered = true;
      if (d.exists() || serverAnswered) apply(d); // a profile anywhere is a profile
      else askServer();
    },
    (e) => {
      console.error('Profile connection failed', e);
      set({ error: `Can’t load your account (${e.code ?? e.message}). Retrying…` });
      profileRetry = setTimeout(() => {
        if (auth.currentUser?.uid === user.uid) watchProfile(user);
      }, 3000);
    },
  );
}

onAuthStateChanged(auth, (user) => {
  unsubs.profile?.();
  clearTimeout(profileRetry);
  stopTeam();
  state = { ...empty(), authChecked: true, user };
  listeners.forEach((fn) => fn());
  if (user) watchProfile(user);
});

// Resolves when the write is confirmed, or rejects after `ms` so a button
// never stays stuck on a dead connection.
function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('This is taking too long. Check your connection and try again.')), ms),
    ),
  ]);
}

// ---------------------------------------------------------------- actions

const uid = () => auth.currentUser.uid;
const now = () => new Date().toISOString();

export const logOut = () => signOut(auth);

// Agreement to the privacy notice, saved once on the profile.
export function recordConsent() {
  return withTimeout(updateDoc(doc(db, 'users', uid()), { consentedAt: now() }));
}

export async function createProfile(role, name) {
  const ref = doc(db, 'users', uid());
  // Never overwrite a profile that already exists: a stale screen can show
  // onboarding to an account that is already set up.
  let existing;
  try {
    existing = await withTimeout(getDocFromServer(ref));
  } catch {
    throw new Error('Can’t reach the server. Check your connection and try again.');
  }
  if (existing.exists()) {
    watchProfile(auth.currentUser);
    return;
  }
  const data = { role, name: name.trim().slice(0, 60), teamId: null };
  await withTimeout(setDoc(ref, data));
  // Don't depend on the live connection to move on.
  if (!state.profile) set({ profile: data });
  watchProfile(auth.currentUser);
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
      await withTimeout(batch.commit());
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
  await withTimeout(batch.commit());
}

export async function leaveTeam() {
  const me = uid();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'teams', state.profile.teamId, 'members', me));
  batch.update(doc(db, 'users', me), { teamId: null });
  await withTimeout(batch.commit());
}

// Your own pre-existing conditions, readable by you and the coach.
export function saveHistory({ concussions, adhd, vision, vestibular }) {
  const data = {
    concussions: Math.max(0, Math.min(20, Math.round(Number(concussions) || 0))),
    adhd: !!adhd,
    vision: !!vision,
    vestibular: !!vestibular,
    updatedAt: now(),
  };
  return withTimeout(setDoc(doc(db, 'teams', state.profile.teamId, 'history', uid()), data));
}

export function removeMember(memberUid) {
  return deleteDoc(doc(db, 'teams', state.profile.teamId, 'members', memberUid));
}

// A measurement that couldn't be computed (NaN/Infinity) is stored as null.
const clean = (metrics) =>
  Object.fromEntries(Object.entries(metrics).map(([k, v]) => [k, Number.isFinite(v) ? v : null]));

const baselinesOf = (subjectUid, test) =>
  [...state.trials.values()].filter((t) => t.subjectUid === subjectUid && t.test === test && t.kind === 'baseline');

const sameLimits = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Publish (or remove) a subject's cutoffs from the baselines this device can
// see. Athletes do it for themselves; the coach after deleting a baseline.
export function syncRanges(subjectUid) {
  const teamId = state.profile?.teamId;
  if (!teamId) return;
  for (const test of TEST_IDS) {
    const id = `${subjectUid}_${test}`;
    const lim = limitsFrom(summarize(baselinesOf(subjectUid, test)), SPECS[test]);
    const current = state.ranges.get(id);
    const ref = doc(db, 'teams', teamId, 'ranges', id);
    if (!lim) {
      if (current) deleteDoc(ref).catch(() => {});
    } else if (!current || current.n !== lim.n || !sameLimits(current.limits, lim.limits)) {
      setDoc(ref, { subjectUid, test, ...lim }).catch((e) => set({ error: `Saving cutoffs failed: ${e.message}` }));
    }
  }
}

function addTrialDoc(trial) {
  const ref = doc(collection(db, 'teams', state.profile.teamId, 'trials'));
  const fail = (e) => set({ error: `Saving failed: ${e.message}` });
  setDoc(ref, trial).catch((e) => {
    // Rules deployed before the conditions tag existed reject it; save the
    // result without the tag rather than lose it.
    if (e.code === 'permission-denied' && trial.conditions) {
      const { conditions, ...plain } = trial; // eslint-disable-line no-unused-vars
      setDoc(ref, plain).catch(fail);
    } else fail(e);
  });
  return { id: ref.id, ...trial };
}

// Optional testing-conditions tag (see lib/conditions.js); left off if empty.
const withConditions = (trial, conditions) =>
  conditions && Object.keys(conditions).length ? { ...trial, conditions } : trial;

// Your own baseline. Works offline; syncs later.
export function saveBaseline(test, metrics, conditions) {
  return addTrialDoc(withConditions(
    { subjectUid: uid(), testerUid: uid(), test, kind: 'baseline', at: now(), metrics: clean(metrics) },
    conditions,
  ));
}

// A post-hit check on anyone on the team (including yourself), judged on this
// device against the subject's published cutoffs. Works offline.
// Returns the call; plus the full comparison when the viewer may see data.
export async function submitCheck(subjectUid, test, metrics, conditions) {
  const m = clean(metrics);
  const status = judge(state.ranges.get(`${subjectUid}_${test}`), m);
  addTrialDoc(withConditions({ subjectUid, testerUid: uid(), test, kind: 'check', at: now(), metrics: m, status }, conditions));
  const canSeeData = subjectUid === uid() || state.profile.role === 'coach';
  const comparison = canSeeData
    ? compareToSummary(summarize(baselinesOf(subjectUid, test)), m, SPECS[test])
    : undefined;
  return { status, ...ACTIONS[status], comparison };
}

export async function deleteTrial(id) {
  const trial = state.trials.get(id);
  await deleteDoc(doc(db, 'teams', state.profile.teamId, 'trials', id));
  // A removed baseline changes the cutoffs teammates judge against.
  if (trial?.kind === 'baseline') syncRanges(trial.subjectUid);
}
