import { useEffect, useRef, useState } from 'react';
import { useTestRunning, useScreenTop } from '../../lib/focus.js';
import { STANCES, BALANCE, METRICS, computeBalance, scoreStance } from './balance.js';
import { formatMetric } from '../../components/ResultCards.jsx';
import ResultPanel, { BaselineProgress } from '../../components/ResultPanel.jsx';
import { StanceDiagram } from '../../components/Icons.jsx';
import { BalanceDemo } from '../../components/Mascot.jsx';
import { beep, say, buzz, unlockAudio, hush } from '../../lib/cues.js';

const TEST = 'balance';
// Vibration cues: one long buzz = close your eyes; three sharp pulses = open
// them. Different enough to tell apart without looking.
const CUE_CLOSE = 600;
const CUE_OPEN = [200, 120, 200, 120, 200];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestMotionPermission() {
  // iOS needs an explicit permission prompt from a tap.
  const DME = window.DeviceMotionEvent;
  if (DME && typeof DME.requestPermission === 'function') {
    const res = await DME.requestPermission();
    if (res !== 'granted') throw new Error('Motion sensor permission was denied.');
  }
}

// Guided mode (the Run-all flow): no header, intro, or results of its own.
// `startSignal` triggers begin() (it must follow a tap, for the iOS motion
// permission prompt); the stance screens run as usual; `onFinished` gets
// the outcome.
export default function BalanceTest({ subject, isSelf, canSeeData, guided = false, startSignal = 0, onFinished }) {
  const sinkRef = useRef(null);
  const pendingRef = useRef(null); // samples of the stance just finished
  const abortRef = useRef(false);
  const lastEventRef = useRef(0);
  const wakeRef = useRef(null);
  const [phase, setPhase] = useState('intro'); // intro | ready | countdown | recording | errors | results
  const [stanceIdx, setStanceIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [errorsSeen, setErrorsSeen] = useState(0);
  const [stumblesFelt, setStumblesFelt] = useState(0); // the phone's count, shown on the errors screen
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [runId, setRunId] = useState(0);
  const dataRef = useRef({});

  // One motion listener for the life of the component.
  useEffect(() => {
    const onMotion = (e) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null) return;
      lastEventRef.current = performance.now();
      sinkRef.current?.({ t: e.timeStamp, a: [a.x, a.y, a.z] });
    };
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      abortRef.current = true;
      wakeRef.current?.release?.().catch(() => {});
    };
  }, []);

  const activeRef = useRef(false); // begin() in flight or a run under way

  useEffect(() => {
    if (guided && startSignal > 0) begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  async function begin() {
    if (activeRef.current) return;
    activeRef.current = true;
    setError(null);
    unlockAudio(); // before the permission promise can end the user gesture
    try {
      await requestMotionPermission();
    } catch (e) {
      activeRef.current = false;
      setError(e.message);
      return;
    }
    try {
      wakeRef.current = await navigator.wakeLock?.request('screen');
    } catch {
      /* screen may dim; not fatal */
    }
    // Make sure the sensor is actually producing readings.
    const t = performance.now();
    await sleep(1200);
    if (lastEventRef.current < t) {
      activeRef.current = false;
      setError(
        'No motion sensor found. Open this page on a phone (run "npm run dev:phone" and use the https:// address it prints).',
      );
      return;
    }
    dataRef.current = {};
    abortRef.current = false;
    setResult(null);
    setStanceIdx(0);
    setPhase('ready');
  }

  async function runStance() {
    unlockAudio(); // resume after a phone interruption, while this tap is active
    const stance = STANCES[stanceIdx];
    abortRef.current = false;
    setPhase('countdown');
    say('Close your eyes when you hear the beep.');
    for (let s = BALANCE.countdownS; s > 0; s--) {
      setCount(s);
      await sleep(1000);
      if (abortRef.current) return;
    }
    // Go. The phone is pressed to the chest, the best place to feel a buzz,
    // so where the phone can vibrate (Android; iPhones on iOS 18+ via a
    // haptic workaround, see lib/cues.js) a long
    // buzz is the main "close your eyes" cue and the beep is the backup. The
    // buzz itself shakes the phone, so recording starts once it has stopped.
    beep(880, 300);
    buzz(CUE_CLOSE);
    await sleep(CUE_CLOSE + 150);
    if (abortRef.current) return;
    const samples = [];
    let t0 = null;
    sinkRef.current = (s) => {
      t0 ??= s.t;
      samples.push({ t: s.t - t0, a: s.a });
    };
    setPhase('recording');
    const start = performance.now();
    while (performance.now() - start < BALANCE.durationMs) {
      setCount(Math.ceil((BALANCE.durationMs - (performance.now() - start)) / 1000));
      await sleep(200);
      if (abortRef.current) {
        sinkRef.current = null;
        return;
      }
    }
    sinkRef.current = null;
    buzz(CUE_OPEN);
    beep(880, 150);
    await sleep(220);
    beep(880, 150);
    say('Stop. Open your eyes.');

    pendingRef.current = samples;
    // Start the examiner's count at what the phone already felt, so a step
    // is never counted by both.
    const felt = scoreStance(samples);
    setStumblesFelt(felt.ok ? felt.stumbles : 0);
    setErrorsSeen(felt.ok ? felt.stumbles : 0);
    setPhase('errors');
  }

  // Examiner enters what they saw, then on to the next stance.
  function confirmErrors() {
    dataRef.current[stance.id] = { samples: pendingRef.current, taps: errorsSeen };
    pendingRef.current = null;
    if (stanceIdx + 1 < STANCES.length) {
      setStanceIdx(stanceIdx + 1);
      setPhase('ready');
    } else {
      finish();
    }
  }

  function finish() {
    activeRef.current = false;
    wakeRef.current?.release?.().catch(() => {});
    const r = computeBalance(dataRef.current);
    setResult(r);
    setRunId((n) => n + 1);
    setPhase('results');
    if (guided) onFinished?.(r);
  }

  function stop() {
    activeRef.current = false;
    abortRef.current = true;
    sinkRef.current = null;
    hush();
    wakeRef.current?.release?.().catch(() => {});
    setPhase('intro');
    if (guided) onFinished?.({ ok: false, aborted: true });
  }

  const stance = STANCES[stanceIdx];

  useScreenTop(`${phase}:${stanceIdx}`);
  useTestRunning(phase === 'countdown' || phase === 'recording');

  return (
    <section className="test">
      {!guided && (
        <header className="test-head">
          <h2>Balance</h2>
          <p className="muted">
            Three stances, 20 seconds each, eyes closed, phone held flat against the chest. The
            phone measures sway; an examiner watches and counts errors.
          </p>
        </header>
      )}

      {error && <div className="callout danger">{error}</div>}

      {phase === 'intro' && !guided && (
        <div className="panel balance-intro">
          <BalanceDemo />
          <ol className="tips">
            <li>Shoes off, firm floor. The athlete holds the phone flat against their chest with both hands.</li>
            <li>
              <b>Media volume up.</b> Use the sound check before starting. Your ringer can stay off on
              supported browsers; keep Focus or Do Not Disturb on to reduce interruptions. With eyes
              closed, you need to hear the cues for when to close and open them.
            </li>
            <li>
              An examiner watches and counts errors: opening the eyes, stepping or stumbling,
              lifting the forefoot or heel, or moving the hands off the chest. They enter the
              count after each stance.
            </li>
          </ol>
          <div className="row">
            <button className="primary" onClick={begin}>Start test</button>
          </div>
          {canSeeData && <BaselineProgress subjectUid={subject.uid} test={TEST} />}
        </div>
      )}

      {phase === 'ready' && (
        <div className="panel balance-stage">
          <div className="stance-head">
            <StanceDiagram id={stance.id} />
            <div>
              <p className="muted small">Stance {stanceIdx + 1} of {STANCES.length}</p>
              <h3 className="stance-title">{stance.label}</h3>
              <p>{stance.how}</p>
            </div>
          </div>
          <p className="muted">
            Hold the phone flat against your chest. After you press start you have{' '}
            {BALANCE.countdownS} seconds to get in position; close your eyes at the beep.
          </p>
          <div className="row">
            <button className="primary big-btn" onClick={runStance}>Start stance</button>
            <button className="ghost" onClick={stop}>Cancel</button>
          </div>
        </div>
      )}

      {(phase === 'countdown' || phase === 'recording') && (
        <div className={`balance-live ${phase}`}>
          <StanceDiagram id={stance.id} size={96} />
          <p className="muted">{stance.label}</p>
          <div className="balance-count">{count}</div>
          <p>{phase === 'countdown' ? 'Get in position…' : 'Eyes closed. Stay still.'}</p>
          <button className="ghost small-btn" onClick={stop}>Stop test</button>
        </div>
      )}

      {phase === 'errors' && (
        <div className="panel balance-stage">
          <p className="muted small">Stance {stanceIdx + 1} of {STANCES.length} done</p>
          <h3 className="stance-title">Errors</h3>
          <p className="muted">
            {stumblesFelt === 0
              ? 'The phone felt no stumbles. '
              : `The phone felt ${stumblesFelt} stumble${stumblesFelt === 1 ? '' : 's'} and started the count there. `}
            Add anything else you saw — eyes opened, forefoot or heel lifted, hands off the chest,
            a step the phone missed — or take one off if it felt a jolt that wasn’t a step.
          </p>
          <div className="stepper">
            <button onClick={() => setErrorsSeen((n) => Math.max(0, n - 1))} aria-label="One fewer">−</button>
            <span>{errorsSeen}</span>
            <button onClick={() => setErrorsSeen((n) => Math.min(10, n + 1))} aria-label="One more">+</button>
          </div>
          <div className="row">
            <button className="primary big-btn" onClick={confirmErrors}>
              {stanceIdx + 1 < STANCES.length ? 'Next stance' : 'See results'}
            </button>
            <button className="ghost" onClick={stop}>Cancel</button>
          </div>
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
                <StanceBars stances={result.stances} />
              </ResultPanel>
            </>
          )}
          <div className="row">
            <button className="ghost" onClick={begin}>Run again</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StanceBars({ stances }) {
  const max = Math.max(...STANCES.map((s) => stances[s.id].sway));
  return (
    <div className="panel">
      <h3>By stance</h3>
      <p className="muted small">Sway on each stance. Longer bar = more sway.</p>
      {STANCES.map((s) => {
        const st = stances[s.id];
        return (
          <div className="stance-row" key={s.id}>
            <span>{s.label}</span>
            <div className="stance-track">
              <div style={{ width: `${(st.sway / max) * 100}%` }} />
            </div>
            <span className="stance-val">
              {formatMetric(st.sway, METRICS.sway)} · {st.errors} error{st.errors === 1 ? '' : 's'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
