import { useState } from 'react';
import { addTrial, summarizeBaseline } from '../lib/baseline.js';

export const BASELINE_TRIALS = 3;

// "Baseline: 2 of 3 trials recorded"
export function BaselineProgress({ athlete, test }) {
  const n = summarizeBaseline(athlete, test)?.n ?? 0;
  return (
    <p className="muted small">
      Baseline: {Math.min(n, BASELINE_TRIALS)} of {BASELINE_TRIALS} trials recorded
      {n >= BASELINE_TRIALS ? ' ✓' : ''}
    </p>
  );
}

// Shown above the result cards when there's nothing to compare against yet.
export function NoBaselineNote({ athlete }) {
  return (
    <div className="callout">
      <b>No baseline yet for {athlete}.</b> Save this as a baseline trial. Record{' '}
      {BASELINE_TRIALS} while healthy; later tests are compared to them.
    </div>
  );
}

// Save as baseline / post-hit check / discard.
export default function SaveTrial({ athlete, test, metrics, onDiscard }) {
  const [saved, setSaved] = useState(null);
  const hasBaseline = !!summarizeBaseline(athlete, test);

  if (saved) {
    return (
      <p className="saved">
        Saved as {saved === 'baseline' ? 'a baseline trial' : 'a post-hit check'}.
      </p>
    );
  }

  const save = (kind) => {
    addTrial(athlete, test, kind, metrics);
    setSaved(kind);
  };

  return (
    <div className="row">
      <button className="primary" onClick={() => save('baseline')}>
        Save as baseline trial
      </button>
      <button onClick={() => save('check')} disabled={!hasBaseline}>
        Save as post-hit check
      </button>
      <button className="ghost" onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}
