import { useEffect, useRef, useState } from 'react';
import { testById } from '../tests/registry.js';
import { REACTION } from '../tests/reaction/reaction.js';
import { PURSUIT, CALIBRATION } from '../tests/eye/pursuit.js';
import { BALANCE } from '../tests/balance/balance.js';
import { compare, summarizeBaseline } from '../lib/baseline.js';
import { saveBaseline, submitCheck } from '../lib/session.js';
import { STATUS, overallStatus } from '../lib/status.js';
import { say, hush, beep, unlockAudio } from '../lib/cues.js';
import ResultCards from '../components/ResultCards.jsx';
import { ActionCard } from '../components/ResultPanel.jsx';

// The three objective tests, one after the other, for an athlete who may be
// young or concussed: one instruction per screen, every instruction spoken,
// no numbers shown until the end, one save for everything.
//
// Order is least to most provocative, with a single posture change at the end:
// reaction (seated, provokes nothing) -> eye pursuit (seated, needs a still
// head and a clean calibration, so before anyone has stood on one leg with
// their eyes shut) -> balance (the only test with a fall risk and the one most
// likely to bring on dizziness; nothing after it to contaminate).
const STEPS = [
  {
    id: 'reaction',
    title: 'Reaction time',
    time: 'about 1 minute',
    athlete: [
      'Sit down.',
      'Tap the box the moment it turns green.',
      'If you tap too early, just wait for the next one.',
    ],
    examiner: 'Hand them the device. Dominant hand, same way every time.',
    spoken: 'Sit down. Tap the box as soon as it turns green.',
    autoSpeak: false, // eyes are open: reading is enough, speech on request
  },
  {
    id: 'eye',
    title: 'Eyes',
    time: 'about 1 minute',
    athlete: [
      'Stay seated. Keep your head still.',
      'Look at each dot until it moves.',
      'Then follow the moving dot with your eyes only.',
    ],
    examiner: 'Face toward the light, an arm’s length from the screen. Glasses off if they can.',
    spoken: 'Keep your head still. Look at each dot. Then follow the moving dot with just your eyes.',
    autoSpeak: false,
  },
  {
    id: 'balance',
    title: 'Balance',
    time: 'about 2 minutes',
    athlete: [
      'Stand up. Shoes off.',
      'Hold the phone flat on your chest with both hands.',
      'When you hear the beep, close your eyes and stand still.',
    ],
    examiner: 'Stand right next to them. After each stance, count what you saw: eyes opened, a step, hands off the chest.',
    spoken: 'Stand up and take your shoes off. Hold the phone flat on your chest. When you hear the beep, close your eyes and stand still.',
    // Eyes will be closed: the beep and the voice are the only cues, so this
    // one always speaks, and the screen warns about anything that mutes it.
    autoSpeak: true,
    soundNote: 'Turn the volume up and switch off Silent mode and Do Not Disturb. On an iPhone the ring switch mutes the beep and the voice.',
    skippable: true, // needs a phone's motion sensor
  },
];

// ?quick — a demo-length run for a 3-minute pitch slot. The modules export
// their settings as plain objects, so a short run is a matter of overriding
// them once before anything starts.
if (new URLSearchParams(window.location.search).has('quick')) {
  Object.assign(REACTION, { practice: 1, trials: 5, minValid: 4 });
  Object.assign(PURSUIT, { moveMs: 6000 });
  CALIBRATION.points = [0.2, 0.5, 0.8];
  Object.assign(BALANCE, { durationMs: 8000, countdownS: 3 });
}

export default function Flow({ subject, isSelf, canSeeData, onDone }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [stage, setStage] = useState('intro'); // intro | ready | running | failed | summary
  const [attempt, setAttempt] = useState(0); // remount key: a retry or a stop gets a fresh test
  const [startSignal, setStartSignal] = useState(0);
  const [results, setResults] = useState({});
  const [failure, setFailure] = useState(null);
  const [readAloud, setReadAloud] = useState(false); // speaker button tapped on this ready screen
  // Taps arrive faster than React re-renders, so state alone can't stop a
  // double-tap from starting a test twice or skipping two tests at once.
  const startedRef = useRef(false); // a start has been issued for this ready screen
  const advancedRef = useRef(-1); // last step index that was advanced past

  const step = STEPS[stepIdx];
  const test = testById[step.id];

  // Speak the instructions when a ready screen appears, only for the test
  // that needs it; the others have a speaker button instead.
  useEffect(() => {
    if (stage === 'ready' && step.autoSpeak) say(step.spoken);
    return hush;
  }, [stage, stepIdx]);

  function readInstructions() {
    unlockAudio();
    setReadAloud(true);
    say(step.spoken);
  }

  function goReady() {
    startedRef.current = false;
    setReadAloud(false);
    setAttempt((n) => n + 1);
    setStartSignal(0);
    setStage('ready');
  }

  function begin() {
    unlockAudio();
    advancedRef.current = -1;
    setStepIdx(0);
    setResults({});
    goReady();
  }

  function start() {
    if (startedRef.current) return;
    startedRef.current = true;
    unlockAudio();
    setStartSignal((n) => n + 1);
    setStage('running');
  }

  function stop() {
    hush();
    goReady();
  }

  function advance(nextResults) {
    if (advancedRef.current === stepIdx) return;
    advancedRef.current = stepIdx;
    beep(990, 150);
    if (stepIdx + 1 < STEPS.length) {
      setStepIdx(stepIdx + 1);
      goReady();
    } else {
      setResults(nextResults);
      setStage('summary');
    }
  }

  function finished(result) {
    if (result.aborted) return stop();
    if (!result.ok) {
      setFailure(result.reason);
      setStage('failed');
      return;
    }
    const next = { ...results, [step.id]: result };
    setResults(next);
    advance(next);
  }

  const skip = () => advance(results);

  function retry() {
    setFailure(null);
    goReady();
  }

  if (stage === 'intro') {
    return (
      <section className="flow">
        <h2>Three short tests, one after the other</h2>
        <ol className="flow-steps">
          {STEPS.map((s) => (
            <li key={s.id}>
              <b>{s.title}</b> <span className="muted">{s.time}</span>
            </li>
          ))}
        </ol>
        <p className="muted">
          About four minutes. The screen says what to do and reads it out loud. No scores are shown
          until the end. You can stop at any point.
        </p>
        <div className="row">
          <button className="primary big-btn" onClick={begin}>Begin</button>
          <button className="ghost" onClick={onDone}>Back</button>
        </div>
      </section>
    );
  }

  if (stage === 'summary') {
    return (
      <Summary subject={subject} isSelf={isSelf} canSeeData={canSeeData} results={results} onDone={onDone} />
    );
  }

  const Test = test.Component;
  const mounted = stage === 'ready' || stage === 'running';

  return (
    <section className="flow">
      <header className="flow-head">
        <span className="muted">Test {stepIdx + 1} of {STEPS.length}</span>
        <h2>{step.title}</h2>
      </header>

      {stage === 'ready' && (
        <div className="flow-ready">
          <ol className="flow-instr">
            {step.athlete.map((line) => <li key={line}>{line}</li>)}
          </ol>
          {!step.autoSpeak && (
            <button className="ghost speak-btn" onClick={readInstructions}>
              🔊 {readAloud ? 'Read it again' : 'Read this to me'}
            </button>
          )}
          {step.soundNote && <div className="callout flow-sound">🔈 <b>Sound on.</b> {step.soundNote}</div>}
          <p className="flow-examiner"><b>Examiner:</b> {step.examiner}</p>
          <div className="row">
            <button className="primary big-btn" onClick={start}>Start</button>
            {step.skippable && <button className="ghost" onClick={skip}>Skip this test</button>}
            <button className="ghost" onClick={onDone}>Stop everything</button>
          </div>
        </div>
      )}

      {stage === 'running' && (
        <div className="row flow-running-bar">
          <button className="ghost small-btn" onClick={stop}>Stop this test</button>
          {step.skippable && <button className="ghost small-btn" onClick={skip}>Skip this test</button>}
        </div>
      )}

      {stage === 'failed' && (
        <div className="flow-ready">
          <div className="callout danger">That didn’t work: {failure}</div>
          <div className="row">
            <button className="primary big-btn" onClick={retry}>Try again</button>
            <button className="ghost" onClick={skip}>Skip this test</button>
            <button className="ghost" onClick={onDone}>Stop everything</button>
          </div>
        </div>
      )}

      {/* Mounted from the ready screen so a camera or sensor is already warm
          when Start is pressed. The key gives a retry or a stop a fresh test. */}
      {mounted && (
        <div className={stage === 'ready' ? 'flow-warm' : ''}>
          <Test
            key={`${step.id}:${attempt}`}
            subject={subject}
            isSelf={isSelf}
            canSeeData={canSeeData}
            guided
            speak={step.autoSpeak || readAloud}
            startSignal={startSignal}
            onFinished={finished}
          />
        </div>
      )}
    </section>
  );
}

// For whoever ran it, not the athlete mid-test: one overall call, then each
// test. Numbers only for people allowed to see them (the athlete themselves
// and the coach); a teammate running a check sees only what to do.
function Summary({ subject, isSelf, canSeeData, results, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null); // { kind: 'baseline' } | { kind: 'check', byTest }

  const done = STEPS.filter((s) => results[s.id]?.ok);
  // The id results are stored and scored under: the eye test reports 'eye'
  // (laptop) or 'eyePhone', since each device keeps its own baseline.
  const tid = (s) => results[s.id]?.testId ?? s.id;
  const previews = Object.fromEntries(
    done.map((s) => [
      s.id,
      canSeeData && summarizeBaseline(subject.uid, tid(s)) ? compare(subject.uid, tid(s), results[s.id].metrics) : null,
    ]),
  );

  // Overall call: from the server-judged checks once submitted, else from the
  // on-device preview against the baseline as it stands.
  const calls = saved?.kind === 'check'
    ? done.map((s) => ({ comparison: { status: saved.byTest[s.id].status } }))
    : done.map((s) => previews[s.id] && { comparison: previews[s.id] }).filter(Boolean);
  const overall = overallStatus(calls);
  const status = overall && STATUS[overall];

  function saveAllBaseline() {
    for (const s of done) saveBaseline(tid(s), results[s.id].metrics);
    setSaved({ kind: 'baseline' });
  }

  async function submitAllChecks() {
    setBusy(true);
    setError(null);
    try {
      const byTest = {};
      for (const s of done) byTest[s.id] = await submitCheck(subject.uid, tid(s), results[s.id].metrics);
      setSaved({ kind: 'check', byTest });
    } catch (e) {
      setError(e?.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flow">
      <h2>All done</h2>

      {status ? (
        <div className={`status-banner ${status.cls}`}>
          <span className="muted small">Overall, against {isSelf ? 'your' : `${subject.name}’s`} own baseline</span>
          <b>{status.title}</b>
          <span>{status.text}</span>
        </div>
      ) : (
        <div className="status-banner muted">
          <b>{canSeeData ? 'No baseline to compare against yet' : `Tests finished for ${subject.name}`}</b>
          <span>
            {canSeeData
              ? 'Save these as baseline trials. After three, a post-hit run gets an overall call here.'
              : 'Submit them as post-hit checks to get the call. The numbers go only to them and the coach.'}
          </span>
        </div>
      )}

      {error && <div className="callout danger">{error}</div>}

      {saved ? (
        <p className="saved">
          Saved {done.length} result{done.length === 1 ? '' : 's'} as{' '}
          {saved.kind === 'baseline' ? 'baseline trials' : 'post-hit checks'}.
        </p>
      ) : (
        <div className="row">
          {isSelf && (
            <button className="primary big-btn" onClick={saveAllBaseline} disabled={busy}>
              Save all as baseline
            </button>
          )}
          <button className={`big-btn ${isSelf ? '' : 'primary'}`} onClick={submitAllChecks} disabled={busy}>
            {busy ? 'Checking…' : isSelf ? 'Save all as post-hit check' : 'Submit all as post-hit checks'}
          </button>
        </div>
      )}

      {STEPS.map((s) => {
        const r = results[s.id];
        const call = saved?.kind === 'check' ? saved.byTest[s.id] : null;
        return (
          <div className="flow-result" key={s.id}>
            <h3>{s.title}</h3>
            {!r?.ok ? (
              <p className="muted">Skipped.</p>
            ) : (
              <>
                {call && <ActionCard result={call} subjectName={isSelf ? 'Your result' : subject.name} />}
                {canSeeData && (
                  <ResultCards
                    metrics={r.metrics}
                    spec={testById[s.id].metrics}
                    comparison={call?.comparison ?? previews[s.id]}
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      <div className="row">
        <button className="ghost" onClick={onDone} disabled={busy}>Done</button>
      </div>
    </section>
  );
}
