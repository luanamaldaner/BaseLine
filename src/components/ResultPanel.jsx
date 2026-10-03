import { useState } from 'react';
import { compare, summarizeBaseline, BASELINE_TRIALS } from '../lib/baseline.js';
import { saveBaseline, submitCheck } from '../lib/session.js';
import { ACTIONS } from '../../shared/assess.js';
import ResultCards from './ResultCards.jsx';
import { useConditions } from '../lib/conditions.js';
import { baselineConcerns } from '../lib/validity.js';
import DotEmoji from './DotEmoji.jsx';

// "Baseline: 2 of 3 trials recorded" (only for people allowed to see it).
export function BaselineProgress({ subjectUid, test }) {
  const n = summarizeBaseline(subjectUid, test)?.recorded ?? 0;
  return (
    <p className="muted small">
      Baseline: {Math.min(n, BASELINE_TRIALS)} of {BASELINE_TRIALS} trials recorded
      {n >= BASELINE_TRIALS && <> <DotEmoji mood="happy" size={19} label="complete" /></>}
    </p>
  );
}

const ACTION_CLS = { normal: 'ok', monitor: 'warn', refer: 'bad', 'no-baseline': 'bad' };

// The big "what to do" card after a post-hit check. No numbers.
export function ActionCard({ result, subjectName }) {
  return (
    <div className={`action-card ${ACTION_CLS[result.status]}`}>
      <span className="muted small">{subjectName}</span>
      <b>{result.title}</b>
      <p>{result.action}</p>
    </div>
  );
}

// What happens after a test finishes, depending on who ran it on whom:
//   self:      full results; save as a baseline or a post-hit check
//   coach:     full results; submit a post-hit check
//   teammate:  no numbers; submit a post-hit check and get only the call
//              (judged against the teammate's published cutoffs)
// `children` (graphs etc.) are shown only to people allowed to see the data.
export default function ResultPanel({ subject, isSelf, canSeeData, test, metrics, spec, onDiscard, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // { kind: 'baseline' } | { kind: 'check', result }
  const [concerns, setConcerns] = useState(null); // why this baseline looks off, before saving
  const conditions = useConditions();

  const preview = canSeeData && summarizeBaseline(subject.uid, test) ? compare(subject.uid, test, metrics) : null;

  async function check() {
    setBusy(true);
    setError(null);
    try {
      const result = await submitCheck(subject.uid, test, metrics, conditions);
      setSaved({ kind: 'check', result });
    } catch (e) {
      setError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function baseline(force = false) {
    if (!force) {
      const c = [
        ...(conditions?.rested === false ? ['They hadn’t rested since exercising, which drags scores down.'] : []),
        ...(conditions?.heat === true ? ['They were overheated or short on water, which drags scores down.'] : []),
        ...(conditions?.pain === true ? ['They had another injury or pain, which drags scores down.'] : []),
        ...baselineConcerns(test, metrics),
      ];
      if (c.length) return setConcerns(c);
    }
    setConcerns(null);
    saveBaseline(test, metrics, conditions);
    setSaved({ kind: 'baseline' });
  }

  if (saved?.kind === 'check') {
    const comparison = saved.result.comparison ?? preview;
    return (
      <div className="result-panel">
        <ActionCard result={saved.result} subjectName={isSelf ? 'Your result' : subject.name} />
        {canSeeData && comparison && (
          <ResultCards metrics={metrics} spec={spec} comparison={comparison} />
        )}
        {canSeeData && children}
        <p className="saved">Saved as a post-hit check{canSeeData ? '' : '. Only they and the coach can see the numbers'}.</p>
      </div>
    );
  }

  if (saved?.kind === 'baseline') {
    return (
      <div className="result-panel">
        <ResultCards metrics={metrics} spec={spec} comparison={null} />
        {children}
        <p className="saved">Saved as a baseline trial.</p>
        <BaselineProgress subjectUid={subject.uid} test={test} />
      </div>
    );
  }

  return (
    <div className="result-panel">
      {canSeeData ? (
        <>
          {isSelf && !preview && (
            <div className="callout">
              <b>No baseline yet.</b> Save this as a baseline trial. Record {BASELINE_TRIALS} while
              healthy; post-hit checks are compared to them.
            </div>
          )}
          <ResultCards metrics={metrics} spec={spec} comparison={preview} />
          {children}
        </>
      ) : (
        <div className="callout">
          <b>Test finished for {subject.name}.</b> Submit it as a post-hit check to get the call.
          Their numbers go only to them and the coach.
        </div>
      )}
      {error && <div className="callout danger">{error}</div>}
      {concerns && (
        <div className="callout warn concerns" role="alert">
          <b>This doesn’t look like a typical healthy baseline.</b>
          <ul>{concerns.map((c) => <li key={c}>{c}</li>)}</ul>
          <span className="small">Baselines should be the athlete’s best effort: a poor one makes later checks look fine.</span>
          <div className="row">
            <button className="primary" onClick={onDiscard}>Redo the test</button>
            <button className="ghost" onClick={() => baseline(true)}>Save anyway</button>
          </div>
        </div>
      )}
      <div className="row">
        {isSelf && (
          <button className="primary" onClick={() => baseline()} disabled={busy}>
            Save as baseline trial
          </button>
        )}
        <button className={isSelf ? '' : 'primary'} onClick={check} disabled={busy}>
          {busy ? 'Checking…' : isSelf ? 'Save as post-hit check' : 'Submit post-hit check'}
        </button>
        <button className="ghost" onClick={onDiscard} disabled={busy}>
          Discard
        </button>
      </div>
    </div>
  );
}

export { ACTIONS };
