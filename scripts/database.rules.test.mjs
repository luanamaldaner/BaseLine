// Local emulator only: never sends fixtures, writes, or admin credentials to a
// real Firebase project. Run under `firebase emulators:exec --only database
// --project demo-dte-hackathon --config firebase.emulators.json
// "node --test scripts/database.rules.test.mjs"`.
import { afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase/app';
import { connectDatabaseEmulator, getDatabase, get, ref, set, update, remove, onValue } from 'firebase/database';

const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
assert.match(host ?? '', /^(127\.0\.0\.1|localhost):\d+$/, 'Start the local database emulator first; production tests are forbidden.');
const project = 'demo-dte-hackathon';
const namespace = project + '-default-rtdb';
const base = `http://${host}`;
const apps = [];
let serial = 0;
const at = '2026-10-03T12:00:00.000Z';
const athlete = (name = 'Athlete') => ({ role: 'athlete', name, consentedAt: at });
const coach = (name = 'Coach') => ({ role: 'coach', name, consentedAt: at });
const metadata = (coachUid = 'c', code = 'ABCDEF') => ({ name: 'Team', coachUid, coachName: 'Coach', code, createdAt: at });
const membership = (name = 'Athlete', code = 'ABCDEF') => ({ name, code, joinedAt: at });
const history = { concussions: 1, adhd: false, vision: false, vestibular: false, updatedAt: at };
const baseline = (uid = 'a') => ({ subjectUid: uid, testerUid: uid, kind: 'baseline', test: 'reaction', at, metrics: { medianMs: 240, spreadMs: 20, mistakes: 0 } });
const check = (subject = 'b', tester = 'a') => ({ ...baseline(subject), testerUid: tester, kind: 'check', teamId: 't1', status: 'normal', conditions: { rested: true, place: 'quiet', device: 'phone' } });
const fixture = () => ({
  profiles: { a: { ...athlete(), teamIds: { t1: true } }, b: { ...athlete('Other athlete'), teamIds: { t1: true } }, c: { ...coach(), teamIds: { t1: true } }, d: coach('Other coach'), outsider: athlete('Outsider') },
  teams: { t1: metadata() }, joinCodes: { ABCDEF: { teamId: 't1' } },
  members: { t1: { a: membership(), b: membership('Other athlete') } },
  recordReaders: { a: { c: { t1: true } }, b: { c: { t1: true } } },
  trials: { a: { original: baseline() } }, history: { t1: { a: history } },
  ranges: { t1: { a_reaction: { subjectUid: 'a', test: 'reaction', n: 3, limits: { medianMs: { worse: 'higher', limit: 320 } } } } },
  avatars: { t1: { a: { kind: 'dot', dot: 'mint', updatedAt: at } } },
});

async function admin(path, value) {
  const response = await fetch(`${base}/${path}.json?ns=${namespace}`, {
    method: 'PUT', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  });
  assert.equal(response.status, 200, await response.text());
}
function client(uid) {
  const app = initializeApp({ projectId: project, apiKey: 'emulator-only', databaseURL: `https://${namespace}.firebaseio.com` }, 'rules-' + ++serial);
  apps.push(app);
  const db = getDatabase(app);
  const [hostname, port] = host.split(':');
  connectDatabaseEmulator(db, hostname, Number(port), uid ? { mockUserToken: { sub: uid, user_id: uid } } : undefined);
  return {
    read: (path) => get(path ? ref(db, path) : ref(db)),
    put: (path, value) => set(ref(db, path), value),
    patch: (value) => update(ref(db), value),
    delete: (path) => remove(ref(db, path)),
    watch: (path, next, error) => onValue(ref(db, path), next, error),
  };
}
const denied = (promise) => assert.rejects(promise, /permission.denied/i);
const joinPatch = (uid, teamId = 't1', code = 'ABCDEF', coachUid = 'c') => ({
  [`members/${teamId}/${uid}`]: membership('Athlete', code), [`profiles/${uid}/teamIds/${teamId}`]: true, [`recordReaders/${uid}/${coachUid}/${teamId}`]: true,
});
const leavePatch = (uid, teamId = 't1', coachUid = 'c') => ({
  [`members/${teamId}/${uid}`]: null, [`profiles/${uid}/teamIds/${teamId}`]: null, [`recordReaders/${uid}/${coachUid}/${teamId}`]: null,
  [`history/${teamId}/${uid}`]: null, [`avatars/${teamId}/${uid}`]: null,
  ...Object.fromEntries(['balance', 'reaction', 'eye', 'eyePhone'].map((test) => [`ranges/${teamId}/${uid}_${test}`, null])),
});

before(async () => { await admin('.settings/rules', JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'))); });
beforeEach(async () => { await admin('', fixture()); });
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => deleteApp(app))); });

test('private data and root collections reject anonymous and broad signed-in reads', async () => {
  const guest = client();
  for (const path of ['', 'profiles/a', 'teams/t1', 'members/t1', 'trials/a', 'history/t1/a', 'ranges/t1']) await denied(guest.read(path));
  const user = client('a');
  for (const path of ['', 'profiles', 'teams', 'joinCodes', 'trials', 'history', 'recordReaders']) await denied(user.read(path));
  assert.equal((await user.read('joinCodes/ABCDEF')).val().teamId, 't1');
  assert.equal((await client('outsider').read('teams/t1')).val().name, 'Team');
});

test('profiles are private, roles and consent immutable, and team links cannot be forged', async () => {
  const user = client('new');
  await user.put('profiles/new', { role: 'athlete', name: 'New athlete' });
  await user.put('profiles/new/consentedAt', at);
  await user.put('profiles/new/name', 'Updated name');
  await denied(user.put('profiles/new/role', 'coach'));
  await denied(user.delete('profiles/new/consentedAt'));
  await denied(user.put('profiles/new/consentedAt', '2026-10-04T12:00:00.000Z'));
  await denied(user.delete('profiles/new'));
  await denied(user.put('profiles/new/teamIds/rogue', true));
  await denied(client('new2').put('profiles/new2', { role: 'athlete', name: 'Bypass', teamIds: { t1: true } }));
  await denied(client('b').read('profiles/a'));
  await denied(client('c').put('profiles/a/name', 'Changed by coach'));
  await denied(client('a').put('profiles/a/unexpected', 'anything'));
});

test('age confirmation is owner-only, immutable, and can be added without rewriting prior consent', async () => {
  const owner = client('a');
  await denied(client('c').put('profiles/a/ageConfirmedAt', at));
  await denied(owner.put('profiles/a/ageConfirmedAt', true));
  await owner.put('profiles/a/ageConfirmedAt', at);
  const profile = (await owner.read('profiles/a')).val();
  assert.equal(profile.consentedAt, at);
  assert.equal(profile.ageConfirmedAt, at);
  await denied(owner.delete('profiles/a/ageConfirmedAt'));
  await denied(owner.put('profiles/a/ageConfirmedAt', '2026-10-04T12:00:00.000Z'));
  const newcomer = client('new');
  await newcomer.put('profiles/new', { role: 'athlete', name: 'New athlete' });
  await newcomer.patch({ 'profiles/new/consentedAt': at, 'profiles/new/ageConfirmedAt': at });
  assert.equal((await newcomer.read('profiles/new')).val().ageConfirmedAt, at);
});

test('coach creation atomically reserves the code, team and profile link; collisions stay protected', async () => {
  const user = client('d');
  const patch = { 'teams/t2': metadata('d', 'GHJKLM'), 'joinCodes/GHJKLM': { teamId: 't2' }, 'profiles/d/teamIds/t2': true };
  await user.patch(patch);
  assert.equal((await user.read('teams/t2')).val().coachUid, 'd');
  await denied(user.put('teams/t3', metadata('d', 'NPQRST')));
  await denied(user.put('joinCodes/ABCDEF', { teamId: 't2' }));
  await denied(user.patch({ 'teams/t4': metadata('d', 'ABCDEF'), 'joinCodes/ABCDEF': { teamId: 't4' }, 'profiles/d/teamIds/t4': true }));
  await denied(client('a').patch({ 'teams/rogue': metadata('a', 'UVWXYZ'), 'joinCodes/UVWXYZ': { teamId: 'rogue' }, 'profiles/a/teamIds/rogue': true }));
  await denied(client('c').put('teams/t1/name', 'Mutated team'));
});

test('joining validates the code and grants only the matching coach reader link atomically', async () => {
  const user = client('outsider');
  await denied(user.patch(joinPatch('outsider', 't1', 'WRONGX')));
  await denied(user.patch({ 'members/t1/outsider': membership(), 'profiles/outsider/teamIds/t1': true }));
  await denied(user.patch(joinPatch('outsider', 't1', 'ABCDEF', 'd')));
  await user.patch(joinPatch('outsider'));
  assert.ok((await user.read('members/t1')).hasChild('outsider'));
  await denied(client('d').put('recordReaders/outsider/d/t1', true));
  await denied(user.put('recordReaders/outsider/d/t1', true));
  await denied(user.patch({ 'profiles/a/teamIds/t1': null }));
});

test('only the subject and a shared coach can read numerical results and history', async () => {
  assert.ok((await client('a').read('trials/a')).exists());
  assert.ok((await client('c').read('trials/a')).exists());
  assert.ok((await client('c').read('history/t1')).exists());
  assert.ok((await client('a').read('history/t1/a')).exists());
  for (const user of ['b', 'd', 'outsider']) {
    await denied(client(user).read('trials/a'));
    await denied(client(user).read('history/t1/a'));
  }
  await denied(client('a').read('history/t1'));
  assert.ok((await client('b').read('members/t1')).exists());
  assert.ok((await client('b').read('ranges/t1')).exists());
  assert.ok((await client('b').read('avatars/t1')).exists());
  await denied(client('outsider').read('ranges/t1'));
  await denied(client('outsider').read('avatars/t1'));
});

test('teammates can submit checks and replay identical results but never read or edit them', async () => {
  const tester = client('a'), value = check();
  await tester.put('trials/b/newcheck', value);
  await denied(tester.read('trials/b/newcheck'));
  await tester.put('trials/b/newcheck', value);
  for (const changed of [
    { ...value, metrics: { ...value.metrics, medianMs: 400 } },
    { ...value, status: 'refer' }, { ...value, at: '2026-10-04T12:00:00.000Z' },
    { ...value, conditions: { ...value.conditions, rested: false } }, { ...value, conditions: null },
    { ...value, testerUid: 'b' }, { ...value, extra: true },
  ]) await denied(tester.put('trials/b/newcheck', changed));
  await denied(client('outsider').put('trials/b/outsider', check('b', 'outsider')));
  await denied(tester.put('trials/b/impersonation', check('b', 'c')));
  await client('c').put('trials/b/coachcheck', check('b', 'c'));
  await denied(tester.delete('trials/b/newcheck'));
  await client('c').delete('trials/b/newcheck');
});

test('baselines require their owner and enforce metric, condition, and result schemas', async () => {
  const user = client('a');
  await user.put('trials/a/newbaseline', baseline());
  await user.put('trials/a/newbaseline', baseline());
  await denied(client('b').put('trials/a/foreign', baseline()));
  await denied(client('c').put('trials/c/coachbaseline', baseline('c')));
  for (const value of [
    { ...baseline(), testerUid: 'b' }, { ...baseline(), teamId: 't1' }, { ...baseline(), status: 'normal' },
    { ...baseline(), at: 'yesterday' }, { ...baseline(), metrics: { medianMs: 1000001 } },
    { ...baseline(), metrics: { medianMs: '250' } }, { ...baseline(), metrics: { sway: 1 } },
    { ...baseline(), metrics: { medianMs: 250, extra: 1 } }, { ...baseline(), conditions: { secret: true } },
    { ...baseline(), conditions: { rested: 'yes' } }, { ...baseline(), unexpected: true },
  ]) await denied(user.put('trials/a/invalid', value));
  await user.put('trials/a/nullmetrics', { ...baseline(), metrics: { medianMs: null, spreadMs: null, mistakes: null } });
  await user.put('trials/a/eyerecord', { ...baseline(), test: 'eyePhone', metrics: { gain: 1, trackingError: 3, lagMs: 120 } });
  await user.delete('trials/a/newbaseline');
});

test('leaving one of two shared teams preserves access and leaving the last revokes it', async () => {
  const seed = fixture();
  seed.teams.t2 = metadata('c', 'GHJKLM'); seed.joinCodes.GHJKLM = { teamId: 't2' };
  seed.profiles.c.teamIds.t2 = true;
  await admin('', seed);
  const user = client('a');
  await user.patch(joinPatch('a', 't2', 'GHJKLM'));
  await denied(user.delete('members/t1/a'));
  await denied(user.delete('recordReaders/a/c/t1'));
  await denied(user.patch({ 'members/t1/a': null, 'profiles/a/teamIds/t1': null, 'recordReaders/a/c/t1': null }));
  await user.patch(leavePatch('a'));
  assert.ok((await client('c').read('trials/a')).exists());
  assert.equal((await client('c').read('history/t1')).hasChild('a'), false);
  await user.patch(leavePatch('a', 't2'));
  await denied(client('c').read('trials/a'));
  assert.ok((await user.read('trials/a')).exists());
  await user.put('trials/a/original', baseline());
});

test('coaches can remove athletes with immediate revocation, without editing other profile fields', async () => {
  const user = client('c');
  await user.patch(leavePatch('a'));
  await denied(client('c').read('trials/a'));
  assert.equal((await client('a').read('profiles/a')).hasChild('teamIds/t1'), false);
  await denied(client('d').patch(leavePatch('b')));
  await denied(user.put('profiles/b/consentedAt', at));
  await denied(user.delete('profiles/b'));
});

test('ranges allow authorized bounded cutoffs but cannot carry private or arbitrary data', async () => {
  const value = { subjectUid: 'a', test: 'reaction', n: 3, limits: { medianMs: { worse: 'higher', limit: 300 } } };
  await client('a').put('ranges/t1/a_reaction', value);
  await client('c').put('ranges/t1/a_reaction', { ...value, n: 4 });
  await denied(client('b').put('ranges/t1/a_reaction', value));
  await denied(client('a').put('ranges/t1/wrongid', value));
  for (const changed of [
    { ...value, n: 0 }, { ...value, n: 3.5 }, { ...value, private: 'data' },
    { ...value, limits: { medianMs: { worse: 'higher', limit: 1000001 } } },
    { ...value, limits: { sway: { worse: 'higher', limit: 1 } } },
    { ...value, limits: { medianMs: { worse: 'higher', limit: 300, private: true } } },
  ]) await denied(client('a').put('ranges/t1/a_reaction', changed));
  await client('a').put('ranges/t1/a_reaction', { ...value, limits: {} });
});

test('avatars are team-visible, owner-edited, bounded JPEG photos or known Dot presets', async () => {
  const user = client('a');
  await user.put('avatars/t1/a', { kind: 'dot', dot: 'grape', updatedAt: at });
  await user.put('avatars/t1/a', { kind: 'photo', photo: 'data:image/jpeg;base64,AAAA', updatedAt: at });
  await user.put('avatars/t1/a', { kind: 'none', updatedAt: at });
  await client('c').put('avatars/t1/c', { kind: 'dot', dot: 'sunny', updatedAt: at });
  await denied(client('b').put('avatars/t1/a', { kind: 'dot', dot: 'mint', updatedAt: at }));
  for (const value of [
    { kind: 'dot', dot: 'unknown', updatedAt: at },
    { kind: 'photo', photo: 'https://example.com/photo.jpg', updatedAt: at },
    { kind: 'photo', photo: 'data:image/jpeg;base64,' + 'A'.repeat(120000), updatedAt: at },
    { kind: 'dot', dot: 'mint', updatedAt: at, private: true },
    { kind: 'none', dot: 'mint', updatedAt: at },
  ]) await denied(user.put('avatars/t1/a', value));
  await client('c').delete('avatars/t1/a');
});

test('separate devices on the same account receive live results and preserve concurrent writes', async () => {
  const phone = client('a'), laptop = client('a');
  const observed = (device, path) => {
    let stop, timer;
    const promise = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Another device did not receive its live result')), 5000);
      stop = device.watch(path, (snapshot) => { if (snapshot.exists()) resolve(snapshot.val()); }, reject);
    });
    return promise.finally(() => { clearTimeout(timer); stop?.(); });
  };
  const onLaptop = observed(laptop, 'trials/a/from-phone');
  const onPhone = observed(phone, 'trials/a/from-laptop');
  const phoneValue = baseline(), laptopValue = check('a', 'a');
  await Promise.all([phone.put('trials/a/from-phone', phoneValue), laptop.put('trials/a/from-laptop', laptopValue)]);
  assert.deepEqual(await onLaptop, phoneValue);
  assert.deepEqual(await onPhone, laptopValue);
  const saved = (await client('a').read('trials/a')).val();
  assert.ok(saved.original && saved['from-phone'] && saved['from-laptop']);
});

test('removing the last shared team cancels an already connected coach health listener', async () => {
  const reader = client('c');
  let stop, timer, resolveFirst, rejectFirst, resolveDenied, rejectDenied;
  const initial = new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
  const cancelled = new Promise((resolve, reject) => { resolveDenied = resolve; rejectDenied = reject; });
  timer = setTimeout(() => rejectDenied(new Error('The removed coach retained a live health listener')), 5000);
  stop = reader.watch('trials/a', (snapshot) => { if (snapshot.exists()) resolveFirst(); }, (error) => {
    if (/permission.denied/i.test(error.message)) resolveDenied(); else { rejectFirst(error); rejectDenied(error); }
  });
  try {
    await initial;
    await client('a').patch(leavePatch('a'));
    await cancelled;
  } finally { clearTimeout(timer); stop?.(); }
});
