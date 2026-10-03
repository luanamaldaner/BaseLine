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
  collection, doc, onSnapshot, query, where, writeBatch, deleteDoc, setDoc, updateDoc, getDocFromServer, getDocsFromServer, runTransaction,
} from 'firebase/firestore';
import { auth, db } from './firebase.js';
import {
  SPECS, TEST_IDS, ACTIONS, summarize, compareToSummary, limitsFrom, judge,
} from '../../shared/assess.js';

const empty = () => ({
  authChecked: false,
  user: null,
  profile: undefined, // undefined = loading, null = none yet
  profileConfirmed: false,
  teams: new Map(),
  rangesByTeam: new Map(),
  members: new Map(), // uid -> { uid, name, joinedAt }
  trials: new Map(), // id -> trial
  trialsReady: false,
  rangesReady: false,
  recordsReady: new Set(),
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
if (import.meta.env.DEV) window.__previewSession = (patch) => set({ profileConfirmed: true, ...patch });

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

export const teamIdsOf = (profile) => profile?.teamIds ?? (profile?.teamId ? [profile.teamId] : []);

function startTeams(teamIds, uid, role) {
  stopTeam();
  let active = true;
  const teams = new Map(), rosters = new Map(), sources = new Map(), rangesByTeam = new Map();
  const records = new Map(), ready = new Set(), confirmed = new Set(), expected = new Set(teamIds.map((id) => 'legacy:' + id));
  const histories = new Map();
  const publishHistory = (teamId, docs) => {
    if (!active) return;
    histories.set(teamId, docs);
    const history = new Map();
    for (const id of teamIds) for (const [athlete, data] of histories.get(id) ?? []) {
      const previous = history.get(athlete);
      if (!previous || Date.parse(data.updatedAt) > Date.parse(previous.updatedAt)) history.set(athlete, data);
    }
    set({ history });
  };
  const rosterReady = new Set();
  const rangeReady = new Set();
  set({ teams: new Map(), members: new Map(), trials: new Map(), trialsReady: false, rangesReady: false, recordsReady: new Set(), ranges: new Map(), rangesByTeam: new Map(), history: new Map() });
  unsubs.team.push(() => { active = false; records.forEach((u) => u()); });
  const fail = (e) => { if (active) set({ error: e.message }); };
  const publish = () => {
    if (!active) return;
    const trials = new Map();
    for (const [key, docs] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
      for (const [id, t] of docs) {
        const previous = trials.get(id);
        trials.set(id, { ...t, paths: [...(previous?.paths ?? []), t.path] });
      }
    }
    const trialsReady = rosterReady.size === teamIds.length && [...expected].every((key) => ready.has(key));
    const rangesReady = rangeReady.size === teamIds.length &&
      teamIds.every((id) => confirmed.has('legacy:' + id));
    const recordsReady = new Set([...confirmed].filter((key) => key.startsWith('record:')).map((key) => key.slice(7)));
    set({ trials, trialsReady, rangesReady, recordsReady });
    if (trialsReady) {
      if (role === 'athlete') syncRanges(uid);
      else for (const id of recordsReady) syncRanges(id);
    }
  };
  const listenTrials = (key, ref) => {
    expected.add(key);
    return onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
      if (!active) return;
      sources.set(key, new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data(), path: d.ref.path }])));
      if (!snap.metadata.fromCache) ready.add(key);
      if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) confirmed.add(key);
      else confirmed.delete(key);
      publish();
    }, (e) => {
      if (!active) return;
      sources.delete(key);
      confirmed.delete(key);
      // An older athlete has not granted record access until their next login.
      if (role === 'coach' && key.startsWith('record:') && e.code === 'permission-denied') {
        ready.add(key);
        const timer = setTimeout(() => {
          if (active && state.members.has(key.slice(7))) records.set(key.slice(7), listenTrials(key, ref));
        }, 5000);
        records.set(key.slice(7), () => clearTimeout(timer));
      } else fail(e);
      publish();
    });
  };
  if (role === 'athlete') unsubs.team.push(listenTrials('record:' + uid, collection(db, 'users', uid, 'trials')));
  for (const teamId of teamIds) {
    unsubs.team.push(role === 'coach'
      ? onSnapshot(collection(db, 'teams', teamId, 'history'), (snap) => {
          publishHistory(teamId, new Map(snap.docs.map((d) => [d.id, d.data()])));
        }, fail)
      : onSnapshot(doc(db, 'teams', teamId, 'history', uid), (d) => {
          publishHistory(teamId, d.exists() ? new Map([[uid, d.data()]]) : new Map());
        }, fail));
    unsubs.team.push(onSnapshot(doc(db, 'teams', teamId), { includeMetadataChanges: true }, (d) => {
      if (!active || (!d.exists() && d.metadata.fromCache)) return;
      if (d.exists()) teams.set(teamId, { id: teamId, ...d.data() });
      set({ teams: new Map(teams) });
    }, fail));
    if (role === 'athlete') unsubs.team.push(onSnapshot(doc(db, 'teams', teamId, 'members', uid), { includeMetadataChanges: true }, (d) => {
      if (active && !d.metadata.fromCache && !d.metadata.hasPendingWrites && !d.exists()) leaveTeam(teamId).catch(fail);
    }, fail));
    unsubs.team.push(onSnapshot(collection(db, 'teams', teamId, 'members'), { includeMetadataChanges: true }, (snap) => {
      if (!active) return;
      rosters.set(teamId, snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
      if (!snap.metadata.fromCache) rosterReady.add(teamId);
      const members = new Map();
      for (const [id, list] of rosters) for (const m of list) {
        const previous = members.get(m.uid);
        members.set(m.uid, { ...m, teamIds: [...(previous?.teamIds ?? []), id] });
      }
      set({ members });
      if (role === 'coach') {
        for (const [id, stop] of records) if (!members.has(id)) {
          stop(); records.delete(id); sources.delete('record:' + id); expected.delete('record:' + id); ready.delete('record:' + id); confirmed.delete('record:' + id);
        }
        for (const id of members.keys()) if (!records.has(id)) records.set(id, listenTrials('record:' + id, collection(db, 'users', id, 'trials')));
      }
      publish();
    }, fail));
    unsubs.team.push(listenTrials('legacy:' + teamId, role === 'coach'
      ? collection(db, 'teams', teamId, 'trials')
      : query(collection(db, 'teams', teamId, 'trials'), where('subjectUid', '==', uid))));
    unsubs.team.push(onSnapshot(collection(db, 'teams', teamId, 'ranges'), { includeMetadataChanges: true }, (snap) => {
      if (!active) return;
      rangesByTeam.set(teamId, new Map(snap.docs.map((d) => [d.id, d.data()])));
      if (!snap.metadata.fromCache) rangeReady.add(teamId);
      const ranges = new Map();
      for (const list of rangesByTeam.values()) for (const [id, value] of list) {
        if (!ranges.has(id) || value.n > ranges.get(id).n) ranges.set(id, value);
      }
      set({ ranges, rangesByTeam: new Map(rangesByTeam) });
      publish();
    }, fail));
  }
}

const migrating = new Map();
function migrateProfile(userId) {
  if (!migrating.has(userId)) migrating.set(userId, copyLegacyProfile(userId).finally(() => migrating.delete(userId)));
  return migrating.get(userId);
}

async function copyTeamTrials(userId, teamId) {
  const old = await withTimeout(getDocsFromServer(query(collection(db, 'teams', teamId, 'trials'), where('subjectUid', '==', userId))));
  for (const trial of old.docs) {
    const target = doc(db, 'users', userId, 'trials', trial.id);
    await withTimeout(runTransaction(db, async (tx) => {
      if (!(await tx.get(target)).exists()) tx.set(target, { ...trial.data(), teamId: trial.data().kind === 'check' ? teamId : null });
    }));
  }
}

async function copyLegacyProfile(userId) {
  try {
    const ref = doc(db, 'users', userId);
    const profile = (await withTimeout(getDocFromServer(ref))).data();
    if (!profile || (profile.teamIds && (!profile.teamId || profile.teamId === profile.teamIds[0]))) return;
    let teamIds = [...teamIdsOf(profile)];
    let coachUids = [...(profile.coachUids ?? [])];
    const oldLink = profile.teamId && (!profile.teamIds || !teamIds.includes(profile.teamId));
    if (oldLink && profile.teamIds && profile.role === 'athlete') {
      // An older client may have left its first team before joining another.
      const memberships = await Promise.all(teamIds.map((id) => withTimeout(getDocFromServer(doc(db, 'teams', id, 'members', userId)))));
      for (let i = 0; i < teamIds.length; i++) if (!memberships[i].exists()) await copyTeamTrials(userId, teamIds[i]);
      teamIds = teamIds.filter((id, i) => memberships[i].exists());
      const remaining = await Promise.all(teamIds.map((id) => withTimeout(getDocFromServer(doc(db, 'teams', id)))));
      coachUids = [...new Set(remaining.filter((d) => d.exists()).map((d) => d.data().coachUid))];
    }
    if (oldLink) {
      const team = await withTimeout(getDocFromServer(doc(db, 'teams', profile.teamId)));
      const member = profile.role === 'athlete'
        ? await withTimeout(getDocFromServer(doc(db, 'teams', profile.teamId, 'members', userId))) : null;
      const belongs = team.exists() && (member?.exists() || team.data().coachUid === userId);
      if (belongs && !teamIds.includes(profile.teamId)) teamIds.push(profile.teamId);
      if (belongs && profile.role === 'athlete' && !coachUids.includes(team.data().coachUid)) coachUids.push(team.data().coachUid);
    }
    if (profile.role === 'athlete' && oldLink) {
      await copyTeamTrials(userId, profile.teamId);
    }
    await withTimeout(runTransaction(db, async (tx) => {
      const latest = (await tx.get(ref)).data();
      if (JSON.stringify(latest.teamIds) === JSON.stringify(profile.teamIds) && latest.teamId === profile.teamId) {
        tx.update(ref, { teamIds, teamId: teamIds[0] ?? null, ...(profile.role === 'athlete' ? { coachUids } : {}) });
      }
    }));
  } catch (e) {
    if (auth.currentUser?.uid === userId) {
      set({ error: 'Moving your saved results could not finish. Retrying…' });
      setTimeout(() => { if (auth.currentUser?.uid === userId) migrateProfile(userId).catch(() => {}); }, 5000);
    }
    throw e;
  }
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
  let active = true;

  const apply = (d) => {
    if (!active || auth.currentUser?.uid !== user.uid) return;
    const profile = d.exists() ? d.data() : null;
    set({ profile, profileConfirmed: state.profileConfirmed || !d.metadata.fromCache, error: null });
    const ids = teamIdsOf(profile);
    const key = profile ? JSON.stringify([ids, profile.role]) : null;
    if (profile && !d.metadata.fromCache && !d.metadata.hasPendingWrites &&
      (!profile.teamIds || (profile.teamId && profile.teamId !== profile.teamIds[0]))) migrateProfile(user.uid).catch(() => {});
    if (key !== teamKey) {
      teamKey = key;
      if (key) startTeams(ids, user.uid, profile.role);
      else {
        stopTeam();
        set({ teams: new Map(), members: new Map(), trials: new Map(), trialsReady: false, rangesReady: false, recordsReady: new Set(), ranges: new Map(), rangesByTeam: new Map(), history: new Map() });
      }
    }
  };

  // Ask the server directly until it answers.
  const askServer = () => {
    if (!active || serverAnswered || auth.currentUser?.uid !== user.uid) return;
    getDocFromServer(ref).then(
      (d) => {
        if (!active || serverAnswered || auth.currentUser?.uid !== user.uid) return;
        serverAnswered = true;
        apply(d);
      },
      () => {
        if (!active || serverAnswered || auth.currentUser?.uid !== user.uid) return;
        set({ error: 'Can’t reach the server. Check your connection; trying again…' });
        profileRetry = setTimeout(askServer, 4000);
      },
    );
  };

  const stop = onSnapshot(
    ref,
    { includeMetadataChanges: true },
    (d) => {
      if (!active) return;
      if (!d.metadata.fromCache) serverAnswered = true;
      if (d.exists() || !d.metadata.fromCache) apply(d); // a profile anywhere is a profile
      else askServer();
    },
    (e) => {
      if (!active) return;
      console.error('Profile connection failed', e);
      set({ error: `Can’t load your account (${e.code ?? e.message}). Retrying…` });
      profileRetry = setTimeout(() => {
        if (auth.currentUser?.uid === user.uid) watchProfile(user);
      }, 3000);
    },
  );
  unsubs.profile = () => { active = false; stop(); };
  askServer();
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
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      { timer = setTimeout(() => reject(new Error('This is taking too long. Check your connection and try again.')), ms); },
    ),
  ]).finally(() => clearTimeout(timer));
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
  const data = { role, name: name.trim().slice(0, 60), teamId: null, teamIds: [], ...(role === 'athlete' ? { coachUids: [] } : {}) };
  const saved = await withTimeout(runTransaction(db, async (tx) => {
    const current = await tx.get(ref);
    if (current.exists()) return current.data();
    tx.set(ref, data);
    return data;
  }));
  // Don't depend on the live connection to move on.
  if (!state.profile) set({ profile: saved });
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
  await migrateProfile(me);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const teamRef = doc(collection(db, 'teams'));
    try {
      await withTimeout(runTransaction(db, async (tx) => {
        const ref = doc(db, 'users', me);
        const profile = (await tx.get(ref)).data();
        const ids = teamIdsOf(profile);
        if (ids.length >= 10) throw new Error('You can have up to 10 teams.');
        tx.set(teamRef, {
          name: teamName.trim().slice(0, 60), coachUid: me, coachName: profile.name, code, createdAt: now(),
        });
        tx.set(doc(db, 'joinCodes', code), { teamId: teamRef.id });
        tx.update(ref, { teamIds: [...ids, teamRef.id], teamId: ids[0] ?? teamRef.id });
      }));
      return;
    } catch (e) {
      // A taken code fails the write; try another one.
      if (e.code !== 'permission-denied' || attempt === 4) throw e;
    }
  }
}

export async function lookupTeam(rawCode) {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Team codes are 6 letters and numbers.');
  const lookup = await withTimeout(getDocFromServer(doc(db, 'joinCodes', code)));
  if (!lookup.exists()) throw new Error('No team with that code. Check it with your coach.');
  const team = await withTimeout(getDocFromServer(doc(db, 'teams', lookup.data().teamId)));
  if (!team.exists()) throw new Error('That team no longer exists.');
  return { id: team.id, ...team.data() };
}

export async function joinTeam(rawCode) {
  const team = await lookupTeam(rawCode);
  const me = uid();
  const history = state.history.get(me);
  await migrateProfile(me);
  await withTimeout(runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', me);
    const profile = (await tx.get(ref)).data();
    const ids = teamIdsOf(profile);
    if (ids.includes(team.id)) return;
    if (ids.length >= 10) throw new Error('You can have up to 10 teams.');
    const coaches = [...new Set([...(profile.coachUids ?? []), team.coachUid])];
    if (coaches.length > 20) throw new Error('You can share with up to 20 coaches.');
    tx.set(doc(db, 'teams', team.id, 'members', me), { name: profile.name, code: team.code, joinedAt: now() });
    tx.update(ref, { teamIds: [...ids, team.id], teamId: ids[0] ?? team.id, coachUids: coaches });
  }));
  if (history) withTimeout(runTransaction(db, async (tx) => {
    const membership = await tx.get(doc(db, 'teams', team.id, 'members', me));
    const ref = doc(db, 'teams', team.id, 'history', me);
    const existing = await tx.get(ref);
    if (membership.exists() && (!existing.exists() || Date.parse(history.updatedAt) > Date.parse(existing.data().updatedAt))) tx.set(ref, history);
  })).catch(() => {});
}

// Your own pre-existing conditions, shared with every current team.
export function saveHistory({ concussions, adhd, vision, vestibular }) {
  const me = uid();
  const ids = teamIdsOf(state.profile);
  const data = {
    concussions: Math.max(0, Math.min(20, Math.round(Number(concussions) || 0))),
    adhd: !!adhd, vision: !!vision, vestibular: !!vestibular, updatedAt: now(),
  };
  return withTimeout(runTransaction(db, async (tx) => {
    const memberships = await Promise.all(ids.map((id) => tx.get(doc(db, 'teams', id, 'members', me))));
    ids.forEach((id, i) => {
      if (memberships[i].exists()) tx.set(doc(db, 'teams', id, 'history', me), data);
    });
  }));
}

export async function leaveTeam(teamId) {
  const me = uid();
  await migrateProfile(me);
  await copyTeamTrials(me, teamId);
  await withTimeout(runTransaction(db, async (tx) => {
    const ref = doc(db, 'users', me);
    const profile = (await tx.get(ref)).data();
    const ids = teamIdsOf(profile).filter((id) => id !== teamId);
    const teams = await Promise.all(ids.map((id) => tx.get(doc(db, 'teams', id))));
    const coachUids = [...new Set(teams.filter((d) => d.exists()).map((d) => d.data().coachUid))];
    tx.delete(doc(db, 'teams', teamId, 'members', me));
    tx.update(ref, { teamIds: ids, teamId: ids[0] ?? null, coachUids });
  }));
}

export function removeMember(teamId, memberUid) {
  return withTimeout(deleteDoc(doc(db, 'teams', teamId, 'members', memberUid)));
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
  if (!state.trialsReady || !state.rangesReady || !state.recordsReady.has(subjectUid)) return;
  const ids = subjectUid === state.user?.uid ? teamIdsOf(state.profile) : state.members.get(subjectUid)?.teamIds ?? [];
  for (const teamId of ids) {
    for (const test of TEST_IDS) {
      const id = `${subjectUid}_${test}`;
      const lim = limitsFrom(summarize(baselinesOf(subjectUid, test)), SPECS[test]);
      const current = state.rangesByTeam.get(teamId)?.get(id);
      const ref = doc(db, 'teams', teamId, 'ranges', id);
      if (!lim) {
        if (current) withTimeout(deleteDoc(ref)).catch(() => {});
      } else if (!current || current.n !== lim.n || !sameLimits(current.limits, lim.limits)) {
        withTimeout(setDoc(ref, { subjectUid, test, ...lim })).catch((e) => set({ error: `Saving cutoffs failed: ${e.message}` }));
      }
    }
  }
}

function addTrialDoc(trial) {
  const ref = doc(collection(db, 'users', trial.subjectUid, 'trials'));
  withTimeout(setDoc(ref, trial)).catch((e) => set({ error: 'Saving failed: ' + e.message }));
  return { id: ref.id, ...trial };
}

// Optional testing-conditions tag (see lib/conditions.js); left off if empty.
const withConditions = (trial, conditions) =>
  conditions && Object.keys(conditions).length ? { ...trial, conditions } : trial;

// Your own baseline. Works offline; syncs later.
export function saveBaseline(test, metrics, conditions) {
  return addTrialDoc(withConditions(
    { subjectUid: uid(), testerUid: uid(), test, kind: 'baseline', teamId: null, at: now(), metrics: clean(metrics) },
    conditions,
  ));
}

// A post-hit check on anyone on the team (including yourself), judged on this
// device against the subject's published cutoffs. Works offline.
// Returns the call; plus the full comparison when the viewer may see data.
export async function submitCheck(subjectUid, test, metrics, conditions) {
  const teamId = teamIdsOf(state.profile).find((id) => state.members.get(subjectUid)?.teamIds.includes(id));
  if (!teamId) throw new Error('This athlete is no longer on a shared team.');
  const m = clean(metrics);
  const status = judge(state.ranges.get(`${subjectUid}_${test}`), m);
  addTrialDoc(withConditions({ subjectUid, testerUid: uid(), test, kind: 'check', teamId, at: now(), metrics: m, status }, conditions));
  const canSeeData = subjectUid === uid() || state.profile.role === 'coach';
  const comparison = canSeeData
    ? compareToSummary(summarize(baselinesOf(subjectUid, test)), m, SPECS[test])
    : undefined;
  return { status, ...ACTIONS[status], comparison };
}

export async function deleteTrial(subjectUid, id) {
  const trial = state.trials.get(id);
  if (!trial || trial.subjectUid !== subjectUid) return;
  const batch = writeBatch(db);
  for (const path of trial.paths ?? [trial.path]) batch.delete(doc(db, path));
  await withTimeout(batch.commit());
  if (trial.kind === 'baseline') syncRanges(subjectUid);
}
