import { collection, getDocsFromCache } from 'firebase/firestore';
import { db, stopLegacyFirestoreNetwork } from './firebase.js';

// The server migration cannot see measurements still queued in an older phone
// tab. Read that browser's Firestore cache without allowing its old write queue
// to resume, and hand only this tester's pending results to the durable outbox.
const importedByOwner = new Map();
const recovering = new Map();
const markerKey = (ownerId) => `baseline:recovered-firestore:${ownerId}`;
const recoveryError = (message, cause) => Object.assign(new Error(message), { code: 'legacy-recovery-failed', cause });

function importedIds(ownerId) {
  if (importedByOwner.has(ownerId)) return importedByOwner.get(ownerId);
  let ids = [];
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(markerKey(ownerId)) ?? '[]');
    if (Array.isArray(saved)) ids = saved.filter((id) => typeof id === 'string');
  } catch { /* Same-ID replay remains safe if a marker cannot be read. */ }
  const result = new Set(ids);
  importedByOwner.set(ownerId, result);
  return result;
}

function remember(ownerId, id) {
  const imported = importedIds(ownerId);
  imported.add(id);
  try {
    if (!globalThis.localStorage) throw new Error('Browser storage is unavailable.');
    globalThis.localStorage.setItem(markerKey(ownerId), JSON.stringify([...imported]));
  } catch (cause) {
    throw recoveryError('Your older result is safely queued, but this browser could not remember the recovery. It may retry the same result next time; it will keep the same result ID.', cause);
  }
}

export async function recoverLegacyTrials({ ownerId, subjectIds, teamIds = [], enqueue, isActive = () => true }) {
  const result = { recovered: 0, skipped: 0, errors: [] };
  if (!ownerId || !isActive()) return result;
  try { await stopLegacyFirestoreNetwork(); }
  catch (cause) {
    result.errors.push(recoveryError('Could not safely open older results on this device. Keep this browser’s stored data and retry sync.', cause));
    return result;
  }
  const imported = importedIds(ownerId);
  const subjects = new Set([ownerId, ...(subjectIds ?? [])]);
  const sources = [
    ...[...subjects].map((subjectUid) => ({ parts: ['users', subjectUid, 'trials'], subjectUid })),
    ...[...new Set(teamIds)].map((teamId) => ({ parts: ['teams', teamId, 'trials'], teamId })),
  ];
  for (const source of sources) {
    if (!isActive()) break;
    let snapshot;
    try { snapshot = await getDocsFromCache(collection(db, ...source.parts)); }
    catch (cause) {
      result.errors.push(recoveryError('Could not read some older results on this device. Keep this browser’s stored data and retry sync.', cause));
      continue;
    }
    for (const doc of snapshot.docs) {
      if (!isActive()) break;
      let trial = doc.data();
      const subjectUid = source.subjectUid ?? trial.subjectUid;
      const marker = `${subjectUid}/${doc.id}`;
      if (!doc.metadata.hasPendingWrites || trial.testerUid !== ownerId || imported.has(marker)) {
        result.skipped++;
        continue;
      }
      if (trial.subjectUid !== subjectUid) {
        result.errors.push(recoveryError('An older result could not be recovered because its athlete record does not match. The original is still stored on this device.'));
        continue;
      }
      if (typeof subjectUid !== 'string' || !subjects.has(subjectUid)) {
        result.skipped++;
        continue;
      }
      if (source.teamId) {
        // Older team-scoped documents do not include a teamId field. The
        // canonical RTDB check needs it; a baseline never keeps a team link.
        trial = { ...trial };
        if (trial.kind === 'check') trial.teamId = source.teamId;
        else if (trial.kind === 'baseline') delete trial.teamId;
      }
      const key = `${ownerId}/${marker}`;
      if (recovering.has(key)) {
        try { await recovering.get(key); result.skipped++; }
        catch (error) { result.errors.push(error); }
        continue;
      }
      const recover = async () => {
        if (!isActive()) return false;
        try {
          await enqueue({ id: doc.id, path: `trials/${subjectUid}/${doc.id}`, trial });
        } catch (cause) {
          throw recoveryError('An older result could not be queued safely. Keep this browser’s stored data and retry sync; the original result has not been removed.', cause);
        }
        // This marker is written only after the new outbox has committed to
        // IndexedDB. A crash before it causes harmless same-ID replay.
        if (isActive()) remember(ownerId, marker);
        return true;
      };
      const pending = recover();
      recovering.set(key, pending);
      try { if (await pending) result.recovered++; }
      catch (error) { result.errors.push(error); }
      finally { recovering.delete(key); }
    }
  }
  return result;
}
