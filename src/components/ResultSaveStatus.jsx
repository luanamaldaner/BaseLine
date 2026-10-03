import { useState } from 'react';
import { retryTrial, useSession } from '../lib/session.js';
import { serviceErrorMessage } from '../lib/serviceErrors.js';

// A result is available on another device only after Firestore acknowledges it.
// Keep a failed save tied to its original id so Retry cannot duplicate a trial.
export default function ResultSaveStatus({ ids, label }) {
  const session = useSession();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(null);
  const writes = ids.map((id) => ({ id, ...session.trialWrites?.get(id) }));
  const failed = writes.filter((write) => write.status === 'failed');
  const synced = writes.length > 0 && writes.every((write) => write.status === 'saved');
  const error = retryError ?? failed[0]?.error ?? session.syncError;

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await Promise.all(failed.map((write) => retryTrial(write.id)));
    } catch (e) {
      setRetryError(serviceErrorMessage(e));
    } finally {
      setRetrying(false);
    }
  }

  if (synced) return <p className="saved" role="status">{label} saved to your account. Available on your other signed-in devices.</p>;

  return <div className={`callout ${failed.length ? 'danger' : 'warn'}`} role={failed.length ? 'alert' : 'status'}>
    <p>{failed.length
      ? `${label} could not sync to your account.`
      : `${label} waiting to sync. Other devices will show ${ids.length === 1 ? 'it' : 'them'} after syncing finishes.`}</p>
    {error && <p className="small">{serviceErrorMessage(error)}</p>}
    {failed.length > 0 && <button className="small-btn" disabled={retrying} onClick={retry}>
      {retrying ? 'Retrying…' : 'Retry sync'}
    </button>}
  </div>;
}
