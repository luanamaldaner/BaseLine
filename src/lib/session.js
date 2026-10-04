// Only the signed-in profile, its teams and authorized records have listeners.
import { useSyncExternalStore } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { ref, push, get, set as writeValue, update, remove, onValue, runTransaction } from 'firebase/database';
import { auth, realtimeDb } from './firebase.js';
import { createTrialOutbox } from './outbox.js';
import { serviceErrorMessage } from './serviceErrors.js';
import { SPECS, TEST_IDS, METRIC_KEYS, ACTIONS, summarize, compareToSummary, limitsFrom, judge } from '../../shared/assess.js';
import { recoverLegacyTrials } from './legacyRecovery.js';

const empty = () => ({
  authChecked: false, user: null, profile: undefined, profileConfirmed: false,
  teams: new Map(), members: new Map(), trials: new Map(), ranges: new Map(), rangesByTeam: new Map(),
  history: new Map(), avatars: new Map(), trialsReady: false, rangesReady: false, recordsReady: new Set(),
  pendingWrites: 0, trialWrites: new Map(), syncError: null, server: null, error: null,
});
let state = empty();
const listeners = new Set();
const setState = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
export const getSession = () => state;
export const useSession = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
export const teamIdsOf = (profile) => Array.isArray(profile?.teamIds) ? profile.teamIds
  : Object.keys(profile?.teamIds ?? (profile?.teamId ? { [profile.teamId]: true } : {}));
const normalizeProfile = (profile) => profile ? { ...profile, teamIds: teamIdsOf(profile), teamId: teamIdsOf(profile)[0] ?? null } : null;
const r = (path) => path ? ref(realtimeDb, path) : ref(realtimeDb);
const now = () => new Date().toISOString();
const uid = () => { if (!auth.currentUser) throw new Error('Sign in to continue.'); return auth.currentUser.uid; };
const values = (snapshot) => Object.entries(snapshot.val() ?? {});
// RTDB removes null-valued keys. Restore the full metric shape so a missing
// first measurement does not hide later valid baseline measurements.
const normalizedTrial = (id, trial) => ({ id, ...trial,
  metrics: Object.fromEntries((METRIC_KEYS[trial.test] ?? Object.keys(trial.metrics ?? {})).map((key) => [key, trial.metrics?.[key] ?? null])),
  teamId: trial.teamId ?? null, path: `trials/${trial.subjectUid}/${id}` });
let connected = false;
let profileStop = null, connectionStop = null, teamStops = [], outbox = null;
let generation = 0, teamKey = null, latestJobs = new Map(), recordTrials = new Map();
const rangeWrites = new Map();
let recoveryPending = false, recoveredSubjects = new Set();

function recoverDeviceResults() {
  if (!outbox || recoveryPending) return;
  const subjects = [state.user.uid, ...state.members.keys()].filter((id) => !recoveredSubjects.has(id));
  if (!subjects.length) return;
  recoveryPending = true;
  const current = generation, queue = outbox, ownerId = state.user.uid;
  recoverLegacyTrials({ ownerId, subjectIds: subjects, teamIds: teamIdsOf(state.profile),
    enqueue: (item) => queue.enqueue(item), isActive: () => current === generation,
  }).then(({ errors }) => {
    if (current !== generation) return;
    if (errors.length) reportError(errors[0]);
    else subjects.forEach((id) => recoveredSubjects.add(id));
  }).catch((error) => { if (current === generation) reportError(error); })
    .finally(() => { if (current === generation) recoveryPending = false; });
}

function reportError(error) {
  const message = serviceErrorMessage(error);
  setState({ error: message, syncError: { code: error.code ?? 'unknown', message } });
}

async function confirmed(promise, ms = 12000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The server has not confirmed this change yet. Check your connection before trying again.')), ms);
    })]);
  } catch (error) {
    const formatted = new Error(serviceErrorMessage(error)); formatted.code = error.code; throw formatted;
  } finally { clearTimeout(timer); }
}
function requireConnection() {
  if (!connected) {
    const error = new Error('Connect to the internet to change teams or account settings. Results can still be queued on this device.');
    error.code = 'unavailable'; throw error;
  }
}
function stopTeams() {
  teamStops.forEach((stop) => stop()); teamStops = []; teamKey = null;
  rangeWrites.clear(); recordTrials = new Map();
}
function publishTrials() {
  const trials = new Map();
  for (const [subject, records] of recordTrials) for (const [id, trial] of records) trials.set(id, normalizedTrial(id, { ...trial, subjectUid: subject }));
  const allowed = (trial) => trial.subjectUid === state.user?.uid || (state.profile?.role === 'coach' && state.members.has(trial.subjectUid));
  for (const [id, job] of latestJobs) if (job.status === 'pending' && allowed(job.trial)) trials.set(id, normalizedTrial(id, job.trial));
  setState({ trials });
}
function publishJobs(jobs) {
  latestJobs = jobs;
  const trialWrites = new Map([...jobs].map(([id, job]) => [id, { status: job.status, ...(job.error ? { error: job.error } : {}) }]));
  setState({ trialWrites, pendingWrites: [...jobs.values()].filter((job) => job.status === 'pending').length });
  publishTrials();
  for (const subject of state.recordsReady) syncRanges(subject);
}

function startTeams(ids, userId, role, retain = false) {
  const retainedRecords = retain ? recordTrials : null;
  stopTeams();
  if (retainedRecords) recordTrials = retainedRecords;
  teamKey = JSON.stringify([ids, role]);
  let active = true;
  const teams = retain ? new Map(state.teams) : new Map();
  const rosters = new Map(), rangesByTeam = new Map(), histories = new Map(), avatarsByTeam = new Map();
  const readyRosters = new Set(), readyRanges = new Set(), readyRecords = new Set(), settledRecords = new Set(), records = new Map();
  const fail = (error) => { if (active) reportError(error); };
  if (!retain) setState({ teams, members: new Map(), trials: new Map(), ranges: new Map(), rangesByTeam, history: new Map(), avatars: new Map(), trialsReady: false, rangesReady: false, recordsReady: new Set() });
  teamStops.push(() => { active = false; records.forEach((stop) => stop()); });
  const publish = () => {
    if (!active) return;
    const ready = readyRosters.size === ids.length && [...records.keys()].every((id) => settledRecords.has(id));
    setState({ trialsReady: ready || (retain && state.trialsReady), rangesReady: readyRanges.size === ids.length, recordsReady: new Set(readyRecords) });
    if (ready || !retain) publishTrials();
    if (ready) {
      for (const id of readyRecords) syncRanges(id);
      recoverDeviceResults();
    }
  };
  const listenRecord = (subject) => {
    // Install the key before onValue: cached callbacks may run immediately.
    records.set(subject, () => {});
    const stop = onValue(r(`trials/${subject}`), (snapshot) => {
      if (!active) return;
      recordTrials.set(subject, new Map(values(snapshot))); readyRecords.add(subject); settledRecords.add(subject); publish();
    }, (error) => {
      if (!active) return;
      settledRecords.add(subject);
      if (role !== 'coach' || !String(error.code).toLowerCase().includes('permission')) fail(error);
      publish();
    });
    records.set(subject, stop);
  };
  if (role === 'athlete') listenRecord(userId);
  for (const teamId of ids) {
    teamStops.push(onValue(r(`teams/${teamId}`), (snapshot) => {
      if (!active) return;
      if (snapshot.exists()) teams.set(teamId, { id: teamId, ...snapshot.val() }); else teams.delete(teamId);
      setState({ teams: new Map(teams) });
    }, fail));
    teamStops.push(onValue(r(`members/${teamId}`), (snapshot) => {
      if (!active) return;
      rosters.set(teamId, values(snapshot)); readyRosters.add(teamId);
      const members = new Map();
      for (const [id, roster] of rosters) for (const [subject, member] of roster) {
        const previous = members.get(subject);
        members.set(subject, { uid: subject, ...member, teamIds: [...(previous?.teamIds ?? []), id] });
      }
      setState({ members });
      if (role === 'coach') {
        for (const [id, stop] of records) if (!members.has(id)) { stop(); records.delete(id); readyRecords.delete(id); settledRecords.delete(id); recordTrials.delete(id); }
        for (const id of members.keys()) if (!records.has(id)) listenRecord(id);
      }
      publish();
    }, fail));
    teamStops.push(onValue(r(`ranges/${teamId}`), (snapshot) => {
      if (!active) return;
      rangesByTeam.set(teamId, new Map(values(snapshot).map(([id, item]) => [id, { ...item, limits: item.limits ?? {} }]))); readyRanges.add(teamId);
      const ranges = new Map();
      for (const list of rangesByTeam.values()) for (const [id, value] of list) if (!ranges.has(id) || value.n > ranges.get(id).n) ranges.set(id, value);
      setState({ ranges, rangesByTeam: new Map(rangesByTeam) }); publish();
    }, fail));
    const path = role === 'coach' ? `history/${teamId}` : `history/${teamId}/${userId}`;
    teamStops.push(onValue(r(path), (snapshot) => {
      if (!active) return;
      histories.set(teamId, role === 'coach' ? values(snapshot) : snapshot.exists() ? [[userId, snapshot.val()]] : []);
      const history = new Map();
      for (const list of histories.values()) for (const [id, item] of list) if (!history.has(id) || item.updatedAt > history.get(id).updatedAt) history.set(id, item);
      setState({ history });
    }, fail));
    teamStops.push(onValue(r(`avatars/${teamId}`), (snapshot) => {
      if (!active) return;
      avatarsByTeam.set(teamId, values(snapshot));
      const avatars = new Map();
      for (const list of avatarsByTeam.values()) for (const [id, item] of list) if (!avatars.has(id) || item.updatedAt > avatars.get(id).updatedAt) avatars.set(id, item);
      mergeLocalAvatar(avatars, userId);
      setState({ avatars });
    }, fail));
  }
  publish();
}

function watchProfile(user, retain = false) {
  profileStop?.(); const current = generation;
  profileStop = onValue(r(`profiles/${user.uid}`), (snapshot) => {
    if (current !== generation) return;
    const profile = normalizeProfile(snapshot.val()); setState({ profile, profileConfirmed: true });
    const ids = teamIdsOf(profile), key = profile ? JSON.stringify([ids, profile.role]) : null;
    if (profile && (key !== teamKey || retain)) { startTeams(ids, user.uid, profile.role, retain && key === teamKey); retain = false; }
    else if (!profile) stopTeams();
  }, (error) => { if (current === generation) reportError(error); });
}
onAuthStateChanged(auth, (user) => {
  generation++; const current = generation;
  profileStop?.(); connectionStop?.(); stopTeams(); outbox?.close();
  outbox = null; latestJobs = new Map(); connected = false;
  recoveryPending = false; recoveredSubjects = new Set();
  setState({ ...empty(), authChecked: true, user });
  if (!user) return;
  connectionStop = onValue(r('.info/connected'), (snapshot) => {
    if (current !== generation) return;
    connected = snapshot.val() === true;
    setState({ server: { ok: connected, at: Date.now(), ...(connected ? {} : { code: 'unavailable' }) } });
  });
  outbox = createTrialOutbox({ ownerId: user.uid,
    write: ({ path, trial }) => writeValue(r(path), trial),
    onChange: (jobs) => { if (current === generation) publishJobs(jobs); },
    onError: (error) => { if (current === generation) reportError(error); },
  });
  outbox.ready.catch((error) => { if (current === generation) reportError(error); });
  watchProfile(user);
});
if (import.meta.env.DEV) window.__previewSession = (patch) => setState({ profileConfirmed: true, ...patch });

export const logOut = () => signOut(auth);
export async function recordConsent({ ageConfirmed = false } = {}) {
  requireConnection();
  const owner = uid(), profileRef = r(`profiles/${owner}`);
  const profile = (await confirmed(get(profileRef))).val();
  if (uid() !== owner) throw new Error('Your account changed. Sign in again before continuing.');
  if (!profile) throw new Error('Your profile is still loading. Try again.');
  if (!profile.ageConfirmedAt && !ageConfirmed) throw new Error('Confirm that you are 14 or older before continuing.');
  const timestamp = now(), patch = {};
  if (!profile.consentedAt) patch.consentedAt = timestamp;
  if (!profile.ageConfirmedAt) patch.ageConfirmedAt = timestamp;
  if (!Object.keys(patch).length) return;
  try {
    await confirmed(update(profileRef, patch));
  } catch (error) {
    // Another signed-in device can confirm the same immutable fields between
    // our read and update. Its confirmation is sufficient; never replace it.
    if (!String(error.code).toLowerCase().replaceAll('_', '-').includes('permission-denied')) throw error;
    const current = (await confirmed(get(profileRef))).val();
    if (!current?.consentedAt || !current?.ageConfirmedAt) throw error;
  }
}
export async function createProfile(role, name) {
  requireConnection();
  const result = await confirmed(runTransaction(r(`profiles/${uid()}`), (current) => current ? undefined : { role, name: name.trim().slice(0, 60) }));
  if (result.snapshot.exists()) setState({ profile: normalizeProfile(result.snapshot.val()), profileConfirmed: true });
}
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export async function createTeam(name) {
  requireConnection(); const me = uid(), profile = state.profile;
  if (profile?.role !== 'coach') throw new Error('Only coaches can create teams.');
  if (teamIdsOf(profile).length >= 10) throw new Error('You can have up to 10 teams.');
  const id = push(r('teams')).key;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    if ((await confirmed(get(r(`joinCodes/${code}`)))).exists()) continue;
    await confirmed(update(r(), {
      [`teams/${id}`]: { name: name.trim().slice(0, 60), coachUid: me, coachName: profile.name, code, createdAt: now() },
      [`joinCodes/${code}`]: { teamId: id }, [`profiles/${me}/teamIds/${id}`]: true,
    })); return;
  }
  throw new Error('Could not create a unique team code. Please try again.');
}
export async function lookupTeam(rawCode) {
  requireConnection(); const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 6) throw new Error('Team codes are 6 letters and numbers.');
  const lookup = await confirmed(get(r(`joinCodes/${code}`)));
  if (!lookup.exists()) throw new Error('No team with that code. Check it with your coach.');
  const id = lookup.val().teamId, team = await confirmed(get(r(`teams/${id}`)));
  if (!team.exists()) throw new Error('That team no longer exists.');
  return { id, ...team.val() };
}
export async function joinTeam(code) {
  const team = await lookupTeam(code), me = uid(), profile = state.profile;
  if (profile?.role !== 'athlete') throw new Error('Only athletes can join teams.');
  if (teamIdsOf(profile).includes(team.id)) return;
  if (teamIdsOf(profile).length >= 10) throw new Error('You can have up to 10 teams.');
  const membership = await confirmed(get(r(`members/${team.id}/${me}`)));
  const patch = { [`profiles/${me}/teamIds/${team.id}`]: true, [`recordReaders/${me}/${team.coachUid}/${team.id}`]: true };
  if (!membership.exists()) patch[`members/${team.id}/${me}`] = { name: profile.name, code: team.code, joinedAt: now() };
  const history = state.history.get(me); if (history) patch[`history/${team.id}/${me}`] = history;
  await confirmed(update(r(), patch));
}
async function membershipPatch(teamId, memberUid) {
  const team = state.teams.get(teamId) ?? (await confirmed(get(r(`teams/${teamId}`)))).val();
  const patch = { [`members/${teamId}/${memberUid}`]: null, [`profiles/${memberUid}/teamIds/${teamId}`]: null, [`history/${teamId}/${memberUid}`]: null, [`avatars/${teamId}/${memberUid}`]: null };
  if (team?.coachUid) patch[`recordReaders/${memberUid}/${team.coachUid}/${teamId}`] = null;
  for (const test of TEST_IDS) patch[`ranges/${teamId}/${memberUid}_${test}`] = null;
  return patch;
}
export async function leaveTeam(teamId) { requireConnection(); await confirmed(update(r(), await membershipPatch(teamId, uid()))); }
export async function removeMember(teamId, memberUid) { requireConnection(); await confirmed(update(r(), await membershipPatch(teamId, memberUid))); }
export async function saveHistory({ concussions, adhd, vision, vestibular }) {
  requireConnection();
  const me = uid(), history = { concussions: Math.max(0, Math.min(20, Math.round(Number(concussions) || 0))), adhd: !!adhd, vision: !!vision, vestibular: !!vestibular, updatedAt: now() };
  const patch = {}; for (const teamId of teamIdsOf(state.profile)) patch[`history/${teamId}/${me}`] = history;
  await confirmed(update(r(), patch));
}

const baselinesOf = (subject, test) => [...state.trials.values()].filter((t) => t.subjectUid === subject && t.test === test && t.kind === 'baseline');
const sameLimits = (a, b) => {
  if (!a || !b) return a === b;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => b[key] && a[key].limit === b[key].limit && a[key].worse === b[key].worse);
};
export function syncRanges(subject) {
  if (!connected || !state.trialsReady || !state.rangesReady || !state.recordsReady.has(subject)) return;
  if ([...latestJobs.values()].some((job) => job.status === 'pending' && job.trial.subjectUid === subject && job.trial.kind === 'baseline')) return;
  const ids = subject === state.user?.uid ? teamIdsOf(state.profile) : state.members.get(subject)?.teamIds ?? [];
  for (const teamId of ids) for (const test of TEST_IDS) {
    const id = `${subject}_${test}`, path = `ranges/${teamId}/${id}`;
    const lim = limitsFrom(summarize(baselinesOf(subject, test)), SPECS[test]);
    const current = state.rangesByTeam.get(teamId)?.get(id);
    if (!lim ? !current : current?.n === lim.n && sameLimits(current.limits, lim.limits)) continue;
    if (rangeWrites.has(path)) continue;
    const token = {}, currentGeneration = generation; rangeWrites.set(path, token);
    let saved = false;
    writeValue(r(path), lim ? { subjectUid: subject, test, ...lim } : null).then(() => { saved = true; }).catch((error) => {
      if (currentGeneration === generation && rangeWrites.get(path) === token) reportError(error);
    }).finally(() => {
      if (rangeWrites.get(path) !== token) return;
      rangeWrites.delete(path);
      // Another device's result may arrive while these cutoffs are being
      // acknowledged. Recompute once with the latest records so an older
      // in-flight write cannot leave a stale baseline count indefinitely.
      if (saved && currentGeneration === generation) syncRanges(subject);
    });
  }
}
const clean = (metrics) => Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, Number.isFinite(value) ? value : null]));
const withConditions = (trial, conditions) => conditions && Object.keys(conditions).length ? { ...trial, conditions } : trial;
async function addTrial(trial) {
  const owner = uid(), queue = outbox;
  if (!queue) throw new Error('Your account is still loading. Try saving again.');
  const id = push(r(`trials/${trial.subjectUid}`)).key; await queue.ready;
  if (auth.currentUser?.uid !== owner) throw new Error('Your account changed. Sign in again before saving this result.');
  await queue.enqueue({ id, path: `trials/${trial.subjectUid}/${id}`, trial }); return { id, ...trial };
}
export function saveBaseline(test, metrics, conditions) {
  return addTrial(withConditions({ subjectUid: uid(), testerUid: uid(), test, kind: 'baseline', at: now(), metrics: clean(metrics) }, conditions));
}
export async function submitCheck(subjectUid, test, metrics, conditions) {
  const teamId = teamIdsOf(state.profile).find((id) => state.members.get(subjectUid)?.teamIds.includes(id));
  if (!teamId) throw new Error('This athlete is no longer on a shared team.');
  const m = clean(metrics), status = judge(state.ranges.get(`${subjectUid}_${test}`), m);
  const trial = await addTrial(withConditions({ subjectUid, testerUid: uid(), test, kind: 'check', teamId, at: now(), metrics: m, status }, conditions));
  const canSee = subjectUid === uid() || state.profile.role === 'coach';
  return { status, ...ACTIONS[status], trialId: trial.id, ...(canSee ? { comparison: compareToSummary(summarize(baselinesOf(subjectUid, test)), m, SPECS[test]) } : {}) };
}
export async function deleteTrial(subjectUid, id) {
  requireConnection(); const trial = state.trials.get(id);
  if (!trial || trial.subjectUid !== subjectUid) return;
  if (state.trialWrites.get(id)?.status === 'pending') throw new Error('Wait for this result to finish syncing before deleting it.');
  await confirmed(remove(r(`trials/${subjectUid}/${id}`)));
}
export const retryTrial = (id) => outbox?.retry(id);
export async function retrySync() {
  if (!auth.currentUser) return;
  setState({ error: null, syncError: null }); watchProfile(auth.currentUser, true); await outbox?.retryAll();
  recoverDeviceResults();
}

export const describeError = serviceErrorMessage;
const localAvatarKey = (who) => `avatar:${who}`;
function mergeLocalAvatar(avatars, me) {
  let local;
  try { local = JSON.parse(localStorage.getItem(localAvatarKey(me))); } catch { return; }
  if (!local || (avatars.get(me)?.updatedAt ?? '') >= local.updatedAt) return;
  if (local.kind === 'none') avatars.delete(me); else avatars.set(me, local);
}
export function saveAvatar(avatar) {
  const me = uid(), record = avatar ? { ...avatar, updatedAt: now() } : { kind: 'none', updatedAt: now() };
  try { localStorage.setItem(localAvatarKey(me), JSON.stringify(record)); } catch { /* device storage unavailable */ }
  const avatars = new Map(state.avatars);
  if (avatar) avatars.set(me, record); else avatars.delete(me);
  setState({ avatars });
  const patch = {};
  // Preserve the removal's timestamp so another device's older local avatar
  // cannot override the change when it receives the live update.
  for (const team of teamIdsOf(state.profile)) patch[`avatars/${team}/${me}`] = record;
  return confirmed(update(r(), patch));
}
