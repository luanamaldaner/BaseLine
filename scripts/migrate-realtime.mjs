import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { adminFetch } from './firebase-admin-rest.mjs';

const PROJECT = 'dte-hackathon';
const DATABASE = 'https://dte-hackathon-default-rtdb.firebaseio.com';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export function decode(value) {
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, decode(v)]));
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  for (const key of ['stringValue', 'booleanValue', 'timestampValue']) if (key in value) return value[key];
  throw new Error('Unexpected Firestore value type; migration stopped.');
}

export function compact(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(compact);
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([k, v]) => [k, compact(v)]).filter(([, v]) => v !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function toRealtime(documents) {
  const target = { profiles: {}, teams: {}, members: {}, trials: {}, ranges: {}, history: {}, avatars: {}, joinCodes: {}, recordReaders: {} };
  const put = (collection, id, key, value) => { (target[collection][id] ??= {})[key] = value; };
  for (const { path, data } of documents) {
    const [collection, id, child, key] = path.split('/');
    if (collection === 'users' && !child) {
      target.profiles[id] = { role: data.role, name: data.name, ...(data.consentedAt ? { consentedAt: data.consentedAt } : {}), teamIds: {} };
    } else if (collection === 'teams' && !child) target.teams[id] = data;
    else if (collection === 'joinCodes' && !child) target.joinCodes[id] = data;
    else if (collection === 'teams' && ['members', 'ranges', 'history', 'avatars'].includes(child)) put(child, id, key, data);
  }
  // Memberships, not stale profile arrays, determine active access.
  for (const [teamId, team] of Object.entries(target.teams)) {
    const coach = target.profiles[team.coachUid];
    if (coach?.role === 'coach') coach.teamIds[teamId] = true;
    for (const athlete of Object.keys(target.members[teamId] ?? {})) {
      const profile = target.profiles[athlete];
      if (!profile || profile.role !== 'athlete') throw new Error('A membership has no athlete profile; inspect the backup before migrating.');
      profile.teamIds[teamId] = true;
      ((target.recordReaders[athlete] ??= {})[team.coachUid] ??= {})[teamId] = true;
    }
  }
  // Merge the legacy and current records, preferring the immutable user record.
  for (const { path, data } of documents) {
    const [collection, teamId, child, id] = path.split('/');
    if (collection !== 'teams' || child !== 'trials') continue;
    if (!data.subjectUid) throw new Error('Legacy trial missing subjectUid.');
    put('trials', data.subjectUid, id, { ...data, ...(data.kind === 'check' ? { teamId } : {}) });
  }
  for (const { path, data } of documents) {
    const [collection, uid, child, id] = path.split('/');
    if (collection !== 'users' || child !== 'trials') continue;
    if (data.subjectUid !== uid) throw new Error('Trial owner mismatch.');
    put('trials', uid, id, data);
  }
  return compact(target) ?? {};
}

const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, sort(value[k])])) : value;
}
export const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex');

function validateBackup(backup) {
  if (backup?.project !== PROJECT || !backup.target || backup.digest !== digest(backup.target)) {
    throw new Error('Backup project or checksum mismatch.');
  }
  if (!Number.isFinite(Date.parse(backup.exportedAt))) throw new Error('Backup export date is missing or invalid.');
}

const validKey = (key) => typeof key === 'string' && key.length > 0 && !/[.#$\[\]/\u0000-\u001f\u007f]/.test(key);
function trialEntries(target) {
  const entries = new Map();
  for (const [ownerId, records] of Object.entries(target.trials ?? {})) {
    if (!validKey(ownerId)) throw new Error('A trial owner is not a valid Realtime Database key.');
    for (const [id, trial] of Object.entries(records)) {
      if (!validKey(id) || !trial || trial.subjectUid !== ownerId) throw new Error('Invalid trial ID or trial owner mismatch.');
      entries.set(`trials/${ownerId}/${id}`, { ownerId, id, trial });
    }
  }
  return entries;
}

function flattened(value, depth, prefix = '', result = new Map()) {
  for (const [id, item] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}/${id}` : id;
    if (depth > 1) flattened(item, depth - 1, path, result);
    else result.set(path, item);
  }
  return result;
}

function changes(before, after) {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)).length,
    removed: [...before.keys()].filter((key) => !after.has(key)).length,
    changed: [...after].filter(([key, value]) => before.has(key) && canonical(before.get(key)) !== canonical(value)).length,
  };
}

// Compare two immutable source exports, never the live RTDB contents, to decide
// eligibility. An original trial deleted in the new app must stay deleted.
export function planTrialReconciliation(baseline, fresh) {
  validateBackup(baseline); validateBackup(fresh);
  if (Date.parse(fresh.exportedAt) < Date.parse(baseline.exportedAt)) throw new Error('The fresh backup predates the baseline backup.');
  const before = trialEntries(baseline.target), after = trialEntries(fresh.target);
  const candidates = [...after].filter(([path]) => !before.has(path)).map(([path, entry]) => ({ path, ...entry }));
  const sourceTrialChanges = changes(new Map([...before].map(([path, entry]) => [path, entry.trial])), new Map([...after].map(([path, entry]) => [path, entry.trial])));
  const configurationChanges = {};
  const depths = { profiles: 1, teams: 1, joinCodes: 1, members: 2, ranges: 2, history: 2, avatars: 2, recordReaders: 3 };
  for (const [collection, depth] of Object.entries(depths)) {
    const delta = changes(flattened(baseline.target[collection], depth), flattened(fresh.target[collection], depth));
    if (delta.added || delta.removed || delta.changed) configurationChanges[collection] = delta;
  }
  const warnings = [];
  if (Object.keys(configurationChanges).length) warnings.push('Source profiles, teams or related settings changed. These changes are reported only; existing target accounts, access and memberships will be preserved.');
  if (sourceTrialChanges.changed || sourceTrialChanges.removed) warnings.push('Existing source trials changed or disappeared. Previously exported trial IDs will not be recreated, modified or deleted in the target.');
  return { candidates, sourceTrialChanges, configurationChanges, warnings };
}

// The only mutations here are admin-created, previously unexported trial IDs.
// Target trial reads supply an ETag; If-Match prevents overwriting a result
// recovered by a device between this script's read and write.
export async function reconcileTrials(baseline, fresh, { request = adminFetch, dryRun = false } = {}) {
  const plan = planTrialReconciliation(baseline, fresh);
  const report = {
    mode: dryRun ? 'reconcile-dry-run' : 'reconcile', baselineExportedAt: baseline.exportedAt, freshExportedAt: fresh.exportedAt,
    candidates: plan.candidates.length, created: 0, alreadyPresent: 0, wouldCreate: 0,
    sourceTrialChanges: plan.sourceTrialChanges, configurationChanges: plan.configurationChanges, warnings: plan.warnings,
    conflicts: [], errors: [],
  };
  for (const { path, ownerId, trial } of plan.candidates) {
    const url = `${DATABASE}/${path.split('/').map(encodeURIComponent).join('/')}.json`;
    try {
      const owner = await (await request(`${DATABASE}/profiles/${encodeURIComponent(ownerId)}.json`)).json();
      if (!owner || owner.role !== 'athlete') {
        report.conflicts.push({ path, reason: owner ? 'Target owner is not an athlete; no trial created.' : 'Target owner profile is missing; no account or trial created.' });
        continue;
      }
      const response = await request(url, { headers: { 'X-Firebase-ETag': 'true' } });
      const existing = await response.json();
      if (existing !== null) {
        if (canonical(compact(existing)) === canonical(compact(trial))) report.alreadyPresent++;
        else report.conflicts.push({ path, reason: 'A different target result already exists; it was not overwritten.' });
        continue;
      }
      const etag = response.headers.get('etag');
      if (!etag) throw new Error('Target did not provide an ETag; refusing an unguarded write.');
      if (dryRun) { report.wouldCreate++; continue; }
      try {
        await request(url, { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify(trial) });
        report.created++;
      } catch (error) {
        if (error.status !== 412 && !/\(412\)/.test(error.message)) throw error;
        const current = await (await request(url)).json();
        if (canonical(compact(current)) === canonical(compact(trial))) report.alreadyPresent++;
        else report.conflicts.push({ path, reason: 'The target changed during reconciliation; the conditional write was rejected and nothing was overwritten.' });
      }
    } catch (error) {
      report.errors.push({ path, message: error.message });
    }
  }
  return report;
}

async function list(path) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(`${FIRESTORE}/${path}`);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await (await adminFetch(url)).json();
    for (const d of body.documents ?? []) docs.push({ path: d.name.split('/documents/')[1], data: decode({ mapValue: { fields: d.fields } }) });
    pageToken = body.nextPageToken;
  } while (pageToken);
  return docs;
}

async function main() {
  const reconcileIndex = process.argv.indexOf('--reconcile');
  if (reconcileIndex >= 0) {
    if (process.argv.includes('--apply') || process.argv.includes('--create')) throw new Error('Use --reconcile by itself, optionally with --dry-run.');
    const [baselinePath, freshPath] = process.argv.slice(reconcileIndex + 1, reconcileIndex + 3);
    if (!baselinePath || !freshPath || baselinePath.startsWith('--') || freshPath.startsWith('--')) {
      throw new Error('Usage: node scripts/migrate-realtime.mjs --reconcile <baseline-backup> <fresh-backup> [--dry-run]');
    }
    const [baseline, fresh] = await Promise.all([baselinePath, freshPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
    const report = await reconcileTrials(baseline, fresh, { dryRun: process.argv.includes('--dry-run') });
    console.log(JSON.stringify(report));
    if (report.conflicts.length || report.errors.length) process.exitCode = 1;
    return;
  }
  if (process.argv.includes('--dry-run')) throw new Error('--dry-run is supported only with --reconcile.');
  if (process.argv.includes('--create')) {
    const response = await adminFetch(`https://firebasedatabase.googleapis.com/v1beta/projects/${PROJECT}/locations/us-central1/instances?databaseId=${PROJECT}-default-rtdb`, { method: 'POST', body: JSON.stringify({ type: 'DEFAULT_DATABASE' }) });
    const instance = await response.json();
    console.log(JSON.stringify({ name: instance.name, databaseUrl: instance.databaseUrl, state: instance.state }));
    return;
  }
  const applyIndex = process.argv.indexOf('--apply');
  if (applyIndex >= 0) {
    const backup = JSON.parse(await readFile(process.argv[applyIndex + 1], 'utf8'));
    if (backup.project !== PROJECT || backup.digest !== digest(backup.target)) throw new Error('Backup project or checksum mismatch.');
    const before = await adminFetch(`${DATABASE}/.json`, { headers: { 'X-Firebase-ETag': 'true' } });
    const etag = before.headers.get('etag');
    const existing = await before.json();
    if (existing !== null && canonical(existing) !== canonical(backup.target)) throw new Error('Target database is not empty. Refusing to overwrite live data.');
    if (existing === null) await adminFetch(`${DATABASE}/.json`, { method: 'PUT', headers: { 'if-match': etag }, body: JSON.stringify(backup.target) });
    const verified = await (await adminFetch(`${DATABASE}/.json`)).json();
    if (digest(verified) !== backup.digest) throw new Error('Migration verification failed. Source remains unchanged.');
    console.log(JSON.stringify({ verified: true, ...backup.counts, sha256: backup.digest }));
    return;
  }
  const users = await list('users');
  const teams = await list('teams');
  const documents = [...users, ...teams, ...await list('joinCodes')];
  for (const user of users) documents.push(...await list(`${user.path}/trials`));
  for (const team of teams) for (const child of ['members', 'trials', 'ranges', 'history', 'avatars']) documents.push(...await list(`${team.path}/${child}`));
  const target = toRealtime(documents);
  const counts = { sourceDocuments: documents.length, profiles: Object.keys(target.profiles ?? {}).length, teams: Object.keys(target.teams ?? {}).length, trials: Object.values(target.trials ?? {}).reduce((n, trials) => n + Object.keys(trials).length, 0) };
  const backup = { project: PROJECT, exportedAt: new Date().toISOString(), documents, target, counts, digest: digest(target) };
  const directory = resolve('.firebase/migration');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `realtime-${Date.now()}.json`);
  await writeFile(path, JSON.stringify(backup), { flag: 'wx' });
  console.log(JSON.stringify({ backup: path, ...counts, sha256: backup.digest }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
