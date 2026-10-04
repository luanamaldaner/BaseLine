import { useScreenTop } from '../lib/focus.js';
import { useEffect, useRef, useState } from 'react';
import { testById } from '../tests/registry.js';
import { REACTION } from '../tests/reaction/reaction.js';
import { PURSUIT, CALIBRATION } from '../tests/eye/pursuit.js';
import { BALANCE } from '../tests/balance/balance.js';
import { compare, summarizeBaseline, BASELINE_TRIALS } from '../lib/baseline.js';
import { saveBaseline, submitCheck } from '../lib/session.js';
import { STATUS, overallStatus } from '../lib/status.js';
import { say, hush, beep, unlockAudio } from '../lib/cues.js';
import ResultCards from '../components/ResultCards.jsx';
import { ActionCard } from '../components/ResultPanel.jsx';
import { useConditions } from '../lib/conditions.js';
import { TestDemo } from '../components/Mascot.jsx';
import { baselineConcerns } from '../lib/validity.js';
import DotEmoji from '../components/DotEmoji.jsx';
import ResultSaveStatus from '../components/ResultSaveStatus.jsx';
import { serviceErrorMessage } from '../lib/serviceErrors.js';
import MeasurementIssue, { VISION_CORRECTION_GUIDANCE } from '../tests/eye/MeasurementIssue.jsx';

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
    examiner: `Face toward the light, an arm’s length from the screen. ${VISION_CORRECTION_GUIDANCE}`,
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
    soundNote: 'Keep media volume up and check sound before starting. Your ringer can stay off on supported browsers. Use Focus or Do Not Disturb to reduce interruptions.',
    skippable: true, // needs a phone's motion sensor
  },
];

// ?quick: a demo-length run for a 3-minute pitch slot. The modules export
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
  const [repeatFromSummary, setRepeatFromSummary] = useState(false);
  const [readAloud, setReadAloud] = useState(false); // speaker button tapped on this ready screen
  // Taps arrive faster than React re-renders, so state alone can't stop a
  // double-tap from starting a test twice or skipping two tests at once.
  const startedRef = useRef(false); // a start has been issued for this ready screen
  const advancedRef = useRef(-1); // last step index that was advanced past

  useScreenTop(`${stepIdx}:${stage}:${attempt}`);
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
    setRepeatFromSummary(false);
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
    if (!result.ok || result.status === 'unreliable' || !result.metrics) {
      setFailure(result);
      setResults({ ...results, [step.id]: result });
      setStage('failed');
      return;
    }
    const next = { ...results, [step.id]: result };
    setResults(next);
    if (repeatFromSummary) {
      setRepeatFromSummary(false);
      setStage('summary');
      return;
    }
    advance(next);
  }

  const skip = () => {
    if (repeatFromSummary) {
      setRepeatFromSummary(false);
      setStage('summary');
    } else advance(results);
  };

  function repeatEye() {
    advancedRef.current = -1;
    setStepIdx(STEPS.findIndex((entry) => entry.id === 'eye'));
    setFailure(null);
    setRepeatFromSummary(true);
    goReady();
  }

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
      <Summary subject={subject} isSelf={isSelf} canSeeData={canSeeData} results={results} onDone={onDone} onRepeatEye={repeatEye} />
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
          <TestDemo test={step.id} />
          <ol className="flow-instr">
            {step.athlete.map((line) => <li key={line}>{line}</li>)}
          </ol>
          {!step.autoSpeak && (
            <button className="ghost speak-btn" onClick={readInstructions}>
              <DotEmoji mood="talk" size={24} /> {readAloud ? 'Read it again' : 'Read this to me'}
            </button>
          )}
          {step.soundNote && <div className="callout flow-sound"><DotEmoji mood="sound" size={24} /> <b>Sound on.</b> {step.soundNote}</div>}
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
          {failure?.status === 'unreliable'
            ? <MeasurementIssue result={failure} onRepeat={retry} />
            : <div className="callout danger">That didn’t work: {failure?.reason}</div>}
          <div className="row">
            {failure?.status !== 'unreliable' && <button className="primary big-btn" onClick={retry}>Try again</button>}
            <button className="ghost" onClick={skip}>{failure?.status === 'unreliable' ? 'Continue without an eye result' : 'Skip this test'}</button>
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
export function Summary({ subject, isSelf, canSeeData, results, onDone, onRepeatEye }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [concerns, setConcerns] = useState(null); // why these baselines look off, before saving
  const conditions = useConditions();
  const [saved, setSaved] = useState(null); // { kind: 'baseline' } | { kind: 'check', byTest }
  const [progress, setProgress] = useState(null);
  const queuedRef = useRef({ kind: null, byTest: {} });
  const busyRef = useRef(false);

  const done = STEPS.filter((s) => results[s.id]?.ok && results[s.id]?.status !== 'unreliable' && results[s.id]?.metrics);
  const hasUnreliable = STEPS.some((s) => results[s.id]?.status === 'unreliable');
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

  async function saveAllBaseline(force = false) {
    if (busyRef.current || saved || !done.length || queuedRef.current.kind === 'check') return;
    if (!force) {
      const c = [
        ...(conditions?.rested === false ? ['They hadn’t rested since exercising, which drags scores down.'] : []),
        ...(conditions?.heat === true ? ['They were overheated or short on water, which drags scores down.'] : []),
        ...(conditions?.pain === true ? ['They had another injury or pain, which drags scores down.'] : []),
        ...done.flatMap((s) => baselineConcerns(tid(s), results[s.id].metrics).map((m) => `${s.title}: ${m}`)),
      ];
      if (c.length) return setConcerns(c);
    }
    setConcerns(null);
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const s of done) {
        if (queuedRef.current.byTest[s.id]) continue;
        const trial = await saveBaseline(tid(s), results[s.id].metrics, conditions);
        queuedRef.current.kind = 'baseline';
        queuedRef.current.byTest[s.id] = trial;
        setProgress({ kind: 'baseline', byTest: { ...queuedRef.current.byTest } });
      }
      setSaved({ kind: 'baseline', byTest: { ...queuedRef.current.byTest } });
    } catch (e) {
      setError(serviceErrorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submitAllChecks() {
    if (busyRef.current || saved || !done.length || queuedRef.current.kind === 'baseline') return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      for (const s of done) {
        if (queuedRef.current.byTest[s.id]) continue;
        const result = await submitCheck(subject.uid, tid(s), results[s.id].metrics, conditions);
        queuedRef.current.kind = 'check';
        queuedRef.current.byTest[s.id] = result;
        setProgress({ kind: 'check', byTest: { ...queuedRef.current.byTest } });
      }
      setSaved({ kind: 'check', byTest: { ...queuedRef.current.byTest } });
    } catch (e) {
      setError(serviceErrorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="flow">
      <h2>{hasUnreliable ? 'Completed results — eye capture needs repeating' : 'All done'}</h2>

      {status && !(hasUnreliable && overall === 'normal') ? (
        <div className={`status-banner ${status.cls}`}>
          <span className="muted small">Overall, against {isSelf ? 'your' : `${subject.name}’s`} own baseline</span>
          <b>{status.title}</b>
          <span>{status.text}</span>
        </div>
      ) : hasUnreliable ? (
        <div className="status-banner warn">
          <b>Eye measurement unavailable</b>
          <span>The eye capture was unreliable and is excluded from grading. Only completed, reliable tests can be saved below.</span>
        </div>
      ) : (
        <div className="status-banner muted">
          <b>{canSeeData ? 'No baseline to compare against yet' : `Tests finished for ${subject.name}`}</b>
          <span>
            {canSeeData
              ? `Save these as baseline trials. After ${BASELINE_TRIALS}, a post-hit run gets an overall call here.`
              : 'Submit them as post-hit checks to get the call. The numbers go only to them and the coach.'}
          </span>
        </div>
      )}

      {error && <div className="callout danger" role="alert">
        {error}
        {progress && <p className="small">Retry to save the remaining results. Results already recorded will not be duplicated.</p>}
      </div>}
      {concerns && (
        <div className="callout warn concerns" role="alert">
          <b>This doesn’t look like a typical healthy baseline.</b>
          <ul>{concerns.map((c) => <li key={c}>{c}</li>)}</ul>
          <span className="small">Baselines should be the athlete’s best effort: a poor one makes later checks look fine.</span>
          <div className="row">
            <button className="primary" onClick={onDone} disabled={busy}>Don’t save, start again</button>
            <button className="ghost" onClick={() => saveAllBaseline(true)} disabled={busy}>Save anyway</button>
          </div>
        </div>
      )}

      {progress && <ResultSaveStatus
        ids={Object.values(progress.byTest).map((result) => progress.kind === 'baseline' ? result.id : result.trialId)}
        label={`${Object.keys(progress.byTest).length} ${progress.kind === 'baseline' ? 'baseline trial' : 'post-hit check'}${Object.keys(progress.byTest).length === 1 ? '' : 's'}`}
        recordLabel={isSelf ? 'your account' : `${subject.name}’s record`}
      />}
      {!saved && (
        <div className="row">
          {isSelf && (
            <button className="primary big-btn" onClick={() => saveAllBaseline()} disabled={busy || !done.length || progress?.kind === 'check'}>
              {progress?.kind === 'baseline' ? 'Retry remaining baselines' : 'Save all as baseline'}
            </button>
          )}
          <button className={`big-btn ${isSelf ? '' : 'primary'}`} onClick={submitAllChecks} disabled={busy || !done.length || progress?.kind === 'baseline'}>
            {busy ? 'Recording…' : progress?.kind === 'check' ? 'Retry remaining checks' : isSelf ? 'Save all as post-hit check' : 'Submit all as post-hit checks'}
          </button>
        </div>
      )}

      {STEPS.map((s) => {
        const r = results[s.id];
        const call = saved?.kind === 'check' ? saved.byTest[s.id] : null;
        return (
          <div className="flow-result" key={s.id}>
            <h3>{s.title}</h3>
            {r?.status === 'unreliable' ? (
              <MeasurementIssue result={r} onRepeat={!saved && !progress ? onRepeatEye : undefined} />
            ) : !r?.ok ? (
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
