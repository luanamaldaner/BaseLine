import { useEffect, useRef, useState } from 'react';
import { useTestRunning } from '../../lib/focus.js';
import { REACTION, METRICS, randomDelay, computeReaction } from './reaction.js';
import ResultPanel, { BaselineProgress } from '../../components/ResultPanel.jsx';
import { say } from '../../lib/cues.js';

const TEST = 'reaction';

// Guided mode (the Run-all flow): no header, intro, or results of its own.
// It starts when `startSignal` changes and reports through `onFinished`.
export default function ReactionTest({ subject, isSelf, canSeeData, guided = false, startSignal = 0, onFinished }) {
  const padRef = useRef(null);
  const textRef = useRef(null);
  const run = useRef(null); // mutable state of the running test
  const [phase, setPhase] = useState('intro'); // intro | running | results
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const [runId, setRunId] = useState(0);

  // The pad is driven straight through the DOM so the green appears on the
  // very next frame, with no React render in between.
  const setPad = (state, text) => {
    if (padRef.current) padRef.current.dataset.state = state;
    if (textRef.current) textRef.current.textContent = text;
  };

  const clearTimers = () => {
    const r = run.current;
    if (!r) return;
    clearTimeout(r.timer);
    clearTimeout(r.lapseTimer);
    cancelAnimationFrame(r.raf);
  };

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (guided && startSignal > 0) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  function start() {
    // A second tap before the first render would restart the test mid-trial.
    if (run.current && run.current.state !== 'done') return;
    clearTimers();
    run.current = {
      index: 0, // includes practice trials
      times: [],
      falseStarts: 0,
      lapses: 0,
      state: 'idle',
      onset: 0,
    };
    setResult(null);
    setRunId((n) => n + 1);
    setPhase('running');
    // Wait one tick for the pad to mount.
    setTimeout(nextTrial, 0);
  }

  const total = REACTION.practice + REACTION.trials;
  const isPractice = () => run.current.index < REACTION.practice;

  function updateProgress() {
    const i = run.current.index;
    setProgress(
      i < REACTION.practice
        ? `Practice ${i + 1} of ${REACTION.practice}`
        : `Tap ${i - REACTION.practice + 1} of ${REACTION.trials}`,
    );
  }

  function nextTrial() {
    const r = run.current;
    if (r.index >= total) return finish();
    updateProgress();
    r.state = 'wait';
    setPad('wait', 'Wait for green…');
    r.timer = setTimeout(() => {
      r.raf = requestAnimationFrame(() => {
        r.state = 'go';
        r.onset = performance.now();
        setPad('go', 'TAP!');
        // Refine onset to the start of the frame after the green was drawn.
        r.raf = requestAnimationFrame((ts) => {
          if (r.state === 'go') r.onset = ts;
        });
        r.lapseTimer = setTimeout(lapse, REACTION.lapseMs);
      });
    }, randomDelay());
  }

  function lapse() {
    const r = run.current;
    if (r.state !== 'go') return;
    r.state = 'feedback';
    if (!isPractice()) r.lapses++;
    setPad('bad', 'Too slow');
    r.index++;
    r.timer = setTimeout(nextTrial, REACTION.feedbackMs);
  }

  function respond(t) {
    const r = run.current;
    if (!r || phase !== 'running') return;
    if (r.state === 'wait') {
      // False start: same trial again.
      clearTimeout(r.timer);
      cancelAnimationFrame(r.raf);
      r.state = 'feedback';
      if (!isPractice()) r.falseStarts++;
      setPad('bad', 'Too early! Wait for green.');
      r.timer = setTimeout(nextTrial, REACTION.feedbackMs * 1.5);
    } else if (r.state === 'go') {
      clearTimeout(r.lapseTimer);
      cancelAnimationFrame(r.raf);
      r.state = 'feedback';
      const ms = Math.max(0, t - r.onset);
      if (!isPractice()) r.times.push(ms);
      setPad('shown', `${Math.round(ms)} ms`);
      r.index++;
      r.timer = setTimeout(nextTrial, REACTION.feedbackMs);
    }
  }

  function finish() {
    const r = run.current;
    r.state = 'done';
    const res = computeReaction(r.times, r.falseStarts, r.lapses);
    setResult(res);
    setPhase('results');
    if (guided) onFinished?.(res);
  }

  function abort() {
    clearTimers();
    run.current = null;
    setPhase('intro');
    if (guided) onFinished?.({ ok: false, aborted: true });
  }

  // Space / Enter also respond (laptop). Esc stops the test.
  useEffect(() => {
    if (phase !== 'running') return;
    const onKey = (e) => {
      if (e.key === 'Escape') return abort();
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault();
        respond(e.timeStamp);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useTestRunning(phase === 'running');

  return (
    <section className="test">
      {!guided && (
        <header className="test-head">
          <h2>Reaction time</h2>
          <p className="muted">
            Tap as soon as the box turns green. {REACTION.practice} practice taps, then{' '}
            {REACTION.trials} scored ones. About a minute.
          </p>
        </header>
      )}

      {phase === 'running' ? (
        <>
          <div className="row reaction-head">
            <span className="muted">{progress}</span>
            <button className="ghost small-btn" onClick={abort}>Stop</button>
          </div>
          <div
            ref={padRef}
            className="reaction-pad"
            data-state="wait"
            onPointerDown={(e) => {
              e.preventDefault();
              respond(e.timeStamp);
            }}
          >
            <span ref={textRef}>Wait for green…</span>
          </div>
          <p className="muted small reaction-hint">Tap the box, or press Space on a keyboard.</p>
        </>
      ) : guided ? null : (
        <div className="panel reaction-intro">
          <ul className="tips">
            <li>Use the same device every time; phones and laptops give different times.</li>
            <li>Tapping before green counts as a mistake.</li>
            <li>Use your dominant hand, the same way each time.</li>
          </ul>
          <button
            className="ghost speak-btn"
            onClick={() => say('Tap the box as soon as it turns green. If you tap too early, just wait for the next one. Use your usual hand.')}
          >
            🔊 Read the instructions to me
          </button>
          <div className="row">
            <button className="primary" onClick={start}>
              {phase === 'results' ? 'Run again' : 'Start test'}
            </button>
          </div>
          {phase !== 'results' && canSeeData && <BaselineProgress subjectUid={subject.uid} test={TEST} />}
        </div>
      )}

      {!guided && phase === 'results' && result && (
        <div className="results">
          {!result.ok ? (
            <div className="callout danger">Test didn't work: {result.reason} Run it again.</div>
          ) : (
            <>
              <ResultPanel
                key={runId}
                subject={subject}
                isSelf={isSelf}
                canSeeData={canSeeData}
                test={TEST}
                metrics={result.metrics}
                spec={METRICS}
                onDiscard={() => { setResult(null); setPhase('intro'); }}
              >
                <TapStrip times={result.times} />
              </ResultPanel>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// One bar per scored tap, in order, so slow-downs and outliers are visible.
function TapStrip({ times }) {
  const max = Math.max(500, ...times);
  return (
    <div className="plot-wrap">
      <h3>Every tap</h3>
      <p className="muted small">Each bar is one tap, in order. Taller = slower.</p>
      <div className="tap-strip">
        {times.map((ms, i) => (
          <div key={i} className="tap-bar" title={`Tap ${i + 1}: ${Math.round(ms)} ms`}>
            <div style={{ height: `${(ms / max) * 100}%` }} />
            <span>{Math.round(ms)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
