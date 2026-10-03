import { useScreenTop, useTestRunning } from '../../lib/focus.js';
import { useEffect, useRef, useState } from 'react';
import { createLandmarker, openCamera, startTracking, measureLight, EYES } from './faceTracker.js';
import {
  PURSUIT, CALIBRATION, METRICS, targetX, fitCalibration, frameIssue, computePursuit,
} from './pursuit.js';
import TracePlot from './TracePlot.jsx';
import ResultPanel, { BaselineProgress } from '../../components/ResultPanel.jsx';
import { say, hush } from '../../lib/cues.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Phones and laptops have different cameras, screens, and viewing distances,
// so each keeps its own baseline: 'eye' (laptop) and 'eyePhone'.
export const EYE_DEVICES = {
  laptop: {
    test: 'eye',
    label: 'Laptop',
    tips: ["Sit about an arm's length (50 cm) from the screen.", 'Face a window or lamp so your face is well lit.'],
  },
  phone: {
    test: 'eyePhone',
    label: 'Phone',
    tips: ['Turn the phone sideways and prop it up at eye level, about 30 cm away.', 'Face a window or lamp so your face is well lit.'],
  },
};

export function detectDevice() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    return coarse && Math.min(screen.width, screen.height) < 600 ? 'phone' : 'laptop';
  } catch {
    return 'laptop';
  }
}

// On its own, the test shows a short intro and the scan opens in a popup (the
// camera runs only while it's open). In the Run-all flow (guided) it runs
// inline, against the baseline for the device it's on.
export default function EyeTest(props) {
  const [device, setDevice] = useState(detectDevice);
  const [open, setOpen] = useState(false);
  useScreenTop(`${device}:${open}`);
  const { test, tips, label } = EYE_DEVICES[device];
  const { subject, canSeeData } = props;

  if (props.guided) return <EyeScan {...props} test={test} />;

  return (
    <section className="test">
      <header className="test-head">
        <h2>Eye pursuit</h2>
        <p className="muted">
          Follow a friendly little face with your eyes. The camera tracks your irises to measure
          how smoothly they keep up.
        </p>
      </header>
      <div className="panel eye-launch">
        <div className="eye-launch-art" aria-hidden><DotBuddy /></div>
        <div className="eye-launch-body">
          <p className="small muted" id="eye-device-label">Which device are you using?</p>
          <div className="segmented" role="group" aria-labelledby="eye-device-label">
            {Object.entries(EYE_DEVICES).map(([id, d]) => (
              <button key={id} className={device === id ? 'active' : ''} aria-pressed={device === id}
                onClick={() => setDevice(id)}>
                {d.label}
              </button>
            ))}
          </div>
          <ul className="tips">
            {tips.map((t) => <li key={t}>{t}</li>)}
          </ul>
          <p className="muted small">Each device keeps its own baseline, because cameras differ.</p>
          {canSeeData && <BaselineProgress subjectUid={subject.uid} test={test} />}
          <button className="primary big-btn" onClick={() => setOpen(true)}>Open eye scan</button>
        </div>
      </div>
      {open && <EyeScan {...props} test={test} deviceLabel={label} tips={tips} onClose={() => setOpen(false)} />}
    </section>
  );
}

// The scan itself. Guided mode (the Run-all flow): no header, intro, or
// results of its own. The camera warms up on mount; the sweep starts when
// `startSignal` changes and the outcome goes to `onFinished`.
// onClose: shown in a popup.
// `speak`: read the walk-through aloud. Off by default — the eyes are open,
// so the text on the stage is enough; the athlete opts in with the speaker
// button (or the flow passes it through).
function EyeScan({
  subject, isSelf, canSeeData, guided = false, speak = false, startSignal = 0, onFinished, test, deviceLabel,
  tips = [], onClose,
}) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const dotRef = useRef(null);
  const sinkRef = useRef(null); // receives samples during calibration/pursuit
  const phaseRef = useRef('preview');
  const abortRef = useRef(false);

  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [phase, setPhaseState] = useState('preview'); // preview | calibrate | pursuit | results
  const [stageText, setStageText] = useState('');
  const [stageCount, setStageCount] = useState(null); // 3, 2, 1 before each part
  const [dotCountdown, setDotCountdown] = useState(false); // ring around the dot before it moves
  const [readAloud, setReadAloud] = useState(false); // standalone speaker button
  const runningRef = useRef(false); // runTest in flight
  const speakRef = useRef(false);
  speakRef.current = guided ? speak : readAloud;
  const [live, setLive] = useState(null);
  const testingRef = useRef(false); // calibration or sweep running
  const env = useRef({ frames: 0, multiFace: 0 }); // frames with a second face, during the test
  const lastSample = useRef(null);
  const [result, setResult] = useState(null);
  const [runId, setRunId] = useState(0); // fresh save buttons per run

  useTestRunning(phase === 'calibrate' || phase === 'pursuit');

  const setPhase = (p) => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  // Camera + model + tracking loop, alive for the life of the component.
  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let landmarker = null;
    let stop = null;

    (async () => {
      try {
        const s = await openCamera();
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        const lm = await createLandmarker();
        if (cancelled) return lm.close();
        landmarker = lm;

        let frames = 0, fpsStart = performance.now(), fps = 0, lastUi = 0, smoothH = NaN;
        let lastLight = 0, light = null;
        const noses = []; // last second of nose positions, for the shake check
        stop = startTracking(video, landmarker, (s) => {
          sinkRef.current?.(s);
          lastSample.current = s;
          if (testingRef.current) {
            env.current.frames++;
            if (s.faces > 1) env.current.multiFace++;
          }
          if (s.face) {
            noses.push({ t: s.t, ...s.nose, span: s.eyeSpanPx });
            while (noses.length && s.t - noses[0].t > 1000) noses.shift();
            if (s.t - lastLight > 500) {
              lastLight = s.t;
              try { light = measureLight(video, s.lm); } catch { light = null; }
            }
          }
          frames++;
          if (s.t - fpsStart >= 1000) {
            fps = (frames * 1000) / (s.t - fpsStart);
            frames = 0;
            fpsStart = s.t;
          }
          if (Number.isFinite(s.h)) {
            smoothH = Number.isFinite(smoothH) ? smoothH + 0.4 * (s.h - smoothH) : s.h;
          }
          if (phaseRef.current === 'preview' || phaseRef.current === 'results') {
            drawOverlay(overlayRef.current, video, s);
          }
          if (s.t - lastUi > 100) {
            lastUi = s.t;
            setLive({
              face: s.face, h: smoothH, yaw: s.yaw, blink: s.blink, fps,
              faces: s.faces, eyeSpanPx: s.eyeSpanPx, light, shake: shakeOf(noses),
            });
          }
        });
        setStatus('ready');
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || String(e));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      stop?.();
      stream?.getTracks().forEach((t) => t.stop());
      landmarker?.close();
    };
  }, []);

  useEffect(() => {
    if (guided && startSignal > 0 && status === 'ready') runTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal, status]);

  // Esc aborts a running test.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') abortRef.current = true;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const moveDot = (x) => {
    if (dotRef.current) dotRef.current.style.left = `${x * 100}%`;
  };

  const checkAbort = () => {
    if (abortRef.current) throw new Error('aborted');
  };

  // Spoken instruction, then a 3-2-1 on screen. The athlete may be young or
  // concussed, and the first calibration dot used to appear the instant the
  // overlay did, before they had settled: those samples were junk.
  async function walkThrough(text) {
    setStageText(text);
    if (speakRef.current) say(text);
    await sleep(2200);
    checkAbort();
    for (let n = 3; n > 0; n--) {
      setStageCount(n);
      await sleep(1000);
      checkAbort();
    }
    setStageCount(null);
  }

  async function runTest() {
    // A second tap before the first render would run two tests over each other.
    if (runningRef.current) return;
    // A second face means the tracker may follow the wrong person.
    if (lastSample.current?.faces > 1) {
      const reason = 'Two faces are in view. Ask anyone nearby to step out of the camera’s view, then try again.';
      setResult({ ok: false, reason });
      setPhase('results');
      if (guided) onFinished?.({ ok: false, reason });
      return;
    }
    runningRef.current = true;
    env.current = { frames: 0, multiFace: 0 };
    testingRef.current = true;
    abortRef.current = false;
    setResult(null);
    setRunId((n) => n + 1);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen is nice-to-have */
    }
    setPhase('calibrate');
    setStageText('');
    await sleep(50);

    try {
      await walkThrough('Keep your head still. A dot will appear. Look right at it, and when it jumps, look at the new spot.');
      setStageText('Look at the dot.');
      // 1. Calibration: map eye ratio -> screen position.
      const calibPoints = [];
      for (const x of CALIBRATION.points) {
        moveDot(x);
        const samples = [];
        const start = performance.now();
        sinkRef.current = (s) => {
          if (s.t - start >= CALIBRATION.settleMs && s.face && !s.blink) samples.push(s);
        };
        await sleep(CALIBRATION.dwellMs);
        checkAbort();
        calibPoints.push({ x, samples });
      }
      sinkRef.current = null;
      const calib = fitCalibration(calibPoints);
      if (!calib.ok) throw new Error(calib.reason);

      // 2. Pursuit: follow the moving dot. No text on screen here: the athlete
      // is already looking at the dot, and reading would pull their eyes off
      // it. A ring closing around the dot counts down instead (and the
      // instruction is spoken if read-aloud is on).
      setPhase('pursuit');
      setStageText('');
      moveDot(0.5);
      if (speakRef.current) say('Now follow the face with your eyes only. Keep your head still.');
      await sleep(1200);
      checkAbort();
      setDotCountdown(true);
      await sleep(3000);
      setDotCountdown(false);
      checkAbort();
      await sleep(PURSUIT.holdMs);
      checkAbort();

      const samples = [];
      const t0 = performance.now();
      sinkRef.current = (s) => samples.push({ t: s.t - t0, h: s.h, issue: frameIssue(s, calib) });
      await new Promise((resolve) => {
        const frame = () => {
          const t = performance.now() - t0;
          if (t >= PURSUIT.moveMs || abortRef.current) return resolve();
          moveDot(targetX(t));
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      sinkRef.current = null;
      checkAbort();

      const r = computePursuit(samples, calib);
      // Compare against the baseline as it stands, before this trial is saved.
      testingRef.current = false;
      const multiFacePct = env.current.frames ? (100 * env.current.multiFace) / env.current.frames : 0;
      setResult({ ...r, calib, multiFacePct });
      setPhase('results');
      if (guided) onFinished?.({ ...r, calib, multiFacePct, testId: test });
    } catch (e) {
      sinkRef.current = null;
      if (e.message === 'aborted') {
        setPhase('preview');
        if (guided) onFinished?.({ ok: false, aborted: true });
      } else {
        setResult({ ok: false, reason: e.message });
        setPhase('results');
        if (guided) onFinished?.({ ok: false, reason: e.message });
      }
    } finally {
      runningRef.current = false;
      testingRef.current = false;
      setStageCount(null);
      setDotCountdown(false);
      hush();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }

  const testing = phase === 'calibrate' || phase === 'pursuit';
  const quality = result?.ok ? qualityWarnings(result) : [];

  const content = (
    <section className="test">
      {!guided && !onClose && (
        <header className="test-head">
          <h2>Eye pursuit</h2>
          <p className="muted">
            Follow a moving dot with your eyes. The camera tracks your irises to measure how
            smoothly they keep up.
          </p>
        </header>
      )}

      {status === 'error' && (
        <div className="callout danger">
          Camera or model failed to start: {error}
          <br />
          Allow camera access, and use https:// or localhost.
        </div>
      )}

      {/* Stays rendered during the test (under the stage overlay): a display:none
          video can stop delivering frames in some browsers. */}
      <div className="eye-layout">
        <div className="camera">
          <video ref={videoRef} playsInline muted />
          <canvas ref={overlayRef} />
          {status === 'loading' && <div className="camera-msg">Starting camera + face model…</div>}
        </div>

        {onClose ? (
          <ScanGuide
            live={live} ready={status === 'ready'} done={phase === 'results'} tips={tips}
            onStart={runTest}
            readAloud={readAloud}
            onReadAloud={() => {
              setReadAloud(true);
              say('Keep your head still and move only your eyes. A little face will appear: look right at its nose, and when it jumps, look at the new spot. Then follow it as it glides side to side.');
            }}
            progress={canSeeData && <BaselineProgress subjectUid={subject.uid} test={test} />}
          />
        ) : (
        <div className="panel">
          <h3>Setup check</h3>
          <LiveSignal live={live} />
          {guided ? null : (<>
          <ul className="tips">
            <li>Face well lit, camera at eye level.</li>
            <li>Remove glasses if you can.</li>
            <li>Keep your head still; move only your eyes.</li>
            <li>Press Esc to stop a test.</li>
          </ul>
          <button
            className="ghost speak-btn"
            onClick={() => {
              setReadAloud(true);
              say('Sit an arm\u2019s length from the screen with your face well lit. Keep your head still and move only your eyes. A dot will appear: look right at it, and when it jumps, look at the new spot. Then follow the moving dot.');
            }}
          >
            🔊 {readAloud ? 'Read it again' : 'Read the instructions to me'}
          </button>
          <div className="row">
            <button className="primary" disabled={status !== 'ready'} onClick={runTest}>
              {phase === 'results' ? 'Run again' : 'Start test'}
            </button>
          </div>
          {phase !== 'results' && canSeeData && <BaselineProgress subjectUid={subject.uid} test={test} />}
          </>)}
        </div>
        )}
      </div>

      {testing && (
        <div className="stage">
          <div ref={dotRef} className={`dot ${phase === 'calibrate' ? 'pulse' : ''}`}>
            <DotBuddy />
            {dotCountdown && (
              <svg className="dot-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="46" pathLength="100" />
              </svg>
            )}
          </div>
          {stageCount !== null && <div className="stage-count">{stageCount}</div>}
          {stageText && <div className="stage-text">{stageText}</div>}
        </div>
      )}

      {!guided && phase === 'results' && result && (
        <div className="results">
          {!result.ok ? (
            <div className="callout danger">
              Test didn't work: {result.reason} Check the setup panel and run it again.
            </div>
          ) : (
            <>
              {quality.length > 0 && (
                <div className="callout warn">
                  <b>Retest recommended.</b>
                  {quality.map((q) => <div key={q}>{q}</div>)}
                </div>
              )}

              <ResultPanel
                key={runId}
                subject={subject}
                isSelf={isSelf}
                canSeeData={canSeeData}
                test={test}
                metrics={result.metrics}
                spec={METRICS}
                onDiscard={() => { setResult(null); setPhase('preview'); }}
              >
              <div className="plot-wrap">
                <h3>Eyes vs. dot</h3>
                <p className="muted small">
                  Gray is where the dot was; blue is where your eyes were. The closer the two
                  lines, the better the tracking. Red dots mark catch-up jumps. Gaps are blinks or
                  moments the tracker lost your eyes.
                </p>
                <TracePlot trace={result.trace} />
              </div>
              </ResultPanel>
              <p className="muted small">
                Calibration fit {(result.calib.r2 * 100).toFixed(0)}% · usable frames{' '}
                {(result.validFraction * 100).toFixed(0)}%
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
  if (!onClose) return content;
  return (
    <EyeModal title="Eye scan" subtitle={`${deviceLabel} baseline · ${isSelf ? 'testing yourself' : subject.name}`}
      busy={testing} onClose={onClose}>
      {content}
    </EyeModal>
  );
}

function qualityWarnings(r) {
  const out = [];
  const total = r.trace.filter((p) => p.t >= PURSUIT.skipMs).length || 1;
  const pct = (n) => Math.round((100 * n) / total);
  if (r.calib.r2 < 0.85) out.push('Calibration was shaky. Keep your head still and look right at each dot.');
  if (pct(r.issues.head) > 10) out.push(`Head turned during ${pct(r.issues.head)}% of the test. Move only your eyes.`);
  if (pct(r.issues.face) > 10) out.push(`Face lost during ${pct(r.issues.face)}% of the test. Improve the lighting or move closer.`);
  if (pct(r.issues.blink) > 15) out.push(`Eyes closed during ${pct(r.issues.blink)}% of the test.`);
  if (pct(r.issues.glitch) > 15) out.push(`Tracker glitched during ${pct(r.issues.glitch)}% of the test. Try better light or removing glasses.`);
  if (r.multiFacePct > 5) out.push('Someone else’s face came into view. The tracker may have followed the wrong person.');
  return out;
}

// Camera / environment checks before a scan. Each is [label, ok, how to fix].
// Thresholds are starting points, tuned by eye on a laptop webcam and a phone.
const MIN_EYE_SPAN_PX = 70; // ~60 cm from a 720p webcam; farther = too few iris pixels
const MIN_FACE_LIGHT = 70; // 0-255 average brightness of the face
const BACKLIGHT_GAP = 45; // face this much darker than the whole frame = light behind them
const MAX_SHAKE = 0.12; // nose wobble over a second, in eye-widths

function shakeOf(noses) {
  if (noses.length < 10) return 0;
  const mx = noses.reduce((a, n) => a + n.x, 0) / noses.length;
  const my = noses.reduce((a, n) => a + n.y, 0) / noses.length;
  const sd = Math.sqrt(noses.reduce((a, n) => a + (n.x - mx) ** 2 + (n.y - my) ** 2, 0) / noses.length);
  const span = noses.reduce((a, n) => a + n.span, 0) / noses.length;
  return span ? sd / span : 0;
}

export function cameraChecks(live) {
  const face = !!live?.face;
  const facing = face && Number.isFinite(live.yaw) && Math.abs(live.yaw) < 0.08;
  const lit = live?.light;
  const dim = face && lit && lit.face < MIN_FACE_LIGHT;
  const backlit = face && lit && lit.scene - lit.face > BACKLIGHT_GAP;
  return [
    { id: 'face', label: 'We can see your face', ok: face, fix: 'Move into the frame and face the light.', required: true },
    { id: 'one', label: 'Only one face in view', ok: face && live.faces === 1, fix: 'Ask anyone behind or beside them to step out of the camera’s view.', required: true },
    { id: 'near', label: 'Close enough to the camera', ok: face && live.eyeSpanPx >= MIN_EYE_SPAN_PX, fix: 'Move a little closer to the screen.' },
    { id: 'light', label: 'Face is well lit', ok: face && lit && !dim && !backlit,
      fix: backlit ? 'There’s bright light behind them. Turn so they face the light, not the sky or a window.' : 'Too dark. Face a window or lamp, or move into brighter shade.' },
    { id: 'steady', label: 'Camera and head are steady', ok: face && live.shake < MAX_SHAKE, fix: 'Prop the phone or laptop on something solid, and keep your head still.' },
    { id: 'straight', label: 'Looking straight at the screen', ok: facing, fix: 'Turn your head so your nose points at the screen.' },
    { id: 'eyes', label: 'Eyes open', ok: face && !live.blink, fix: 'Open your eyes wide; take glasses off if they glare.' },
  ];
}

function LiveSignal({ live }) {
  if (!live) return <p className="muted">Waiting for camera…</p>;
  const pct = Number.isFinite(live.h) ? Math.min(Math.max(live.h, 0), 1) * 100 : null;
  const facing = Number.isFinite(live.yaw) && Math.abs(live.yaw) < 0.08;
  const env = Object.fromEntries(cameraChecks(live).map((c) => [c.id, c.ok]));
  const rows = [
    ['Face', !live.face ? 'not found' : live.faces > 1 ? 'two faces in view' : 'found', live.face && live.faces === 1],
    ['Head', !live.face ? '—' : facing ? 'facing screen' : 'turn to face screen', live.face && facing],
    ['Eyes', !live.face ? '—' : live.blink ? 'closed' : 'open', live.face && !live.blink],
    ['Distance', !live.face ? '—' : env.near ? 'good' : 'move closer', env.near],
    ['Light', !live.face ? '—' : env.light ? 'good' : 'face the light', env.light],
    ['Steady', !live.face ? '—' : env.steady ? 'yes' : 'prop it up', env.steady],
    ['Camera', live.fps ? `${live.fps.toFixed(0)} fps` : '…', live.fps >= 20],
  ];
  return (
    <div className="live">
      {rows.map(([label, text, ok]) => (
        <div className="live-row" key={label}>
          <span>{label}</span>
          <b className={ok ? 'ok' : 'bad'}>{text}</b>
        </div>
      ))}
      <div className="meter">
        {pct !== null && <div className="meter-dot" style={{ left: `${pct}%` }} />}
      </div>
      <p className="muted small">Look left and right: the dot should follow smoothly.</p>
    </div>
  );
}

// Eye corners + iris centers over the (mirrored) camera preview.
function drawOverlay(canvas, video, s) {
  if (!canvas) return;
  const w = video.videoWidth, h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!s.lm) return;
  const r = Math.max(2, w / 320);
  for (const eye of EYES) {
    const a = s.lm[eye.a], b = s.lm[eye.b], iris = s.lm[eye.iris];
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = r / 2;
    ctx.beginPath();
    ctx.moveTo(a.x * w, a.y * h);
    ctx.lineTo(b.x * w, b.y * h);
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = s.blink ? '#ef476f' : '#06d6a0';
    ctx.beginPath();
    ctx.arc(iris.x * w, iris.y * h, r * 1.6, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// Popup around the scan. Esc or the backdrop closes it, except mid-test
// (then Esc stops the test instead).
function EyeModal({ title, subtitle, busy, onClose, children }) {
  const ref = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    ref.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && !busyRef.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="eye-modal-title" tabIndex={-1} ref={ref}>
        <header className="modal-head">
          <div>
            <h2 id="eye-modal-title">{title}</h2>
            <p className="muted small">{subtitle}</p>
          </div>
          <button className="ghost small-btn modal-close" onClick={onClose} aria-label="Close eye scan">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

// The target: a small round face. Its nose sits exactly at the center, so
// there is one clear point to look at; the eyes blink now and then.
function DotBuddy() {
  return (
    <svg className="buddy" viewBox="-24 -24 48 48" width="100%" height="100%" aria-hidden="true">
      <circle r="20" className="buddy-body" />
      <ellipse cx="-11" cy="4.5" rx="3.6" ry="2.4" className="buddy-cheek" />
      <ellipse cx="11" cy="4.5" rx="3.6" ry="2.4" className="buddy-cheek" />
      <g className="buddy-eyes">
        <ellipse cx="-6.5" cy="-5" rx="2.4" ry="3.2" />
        <ellipse cx="6.5" cy="-5" rx="2.4" ry="3.2" />
        <circle cx="-5.7" cy="-6.2" r="0.9" className="buddy-shine" />
        <circle cx="7.3" cy="-6.2" r="0.9" className="buddy-shine" />
      </g>
      <circle r="2.3" className="buddy-nose" />
      <path d="M-4.5 6.5q4.5 4 9 0" className="buddy-smile" />
    </svg>
  );
}

// The popup's setup, one step at a time: get in position, check the camera
// can see you, then what's about to happen and Start. The camera preview
// stays on beside it the whole time.
const GUIDE_STEPS = ['Position', 'Camera', 'Ready'];

function ScanGuide({ live, ready, done, tips, onStart, readAloud, onReadAloud, progress }) {
  const [step, setStep] = useState(0);
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, [step, done]);

  const checks = cameraChecks(live);
  const allGood = checks.every((c) => c.ok);
  const canGo = checks.filter((c) => c.required).every((c) => c.ok);

  if (done) {
    return (
      <div className="panel scan-guide">
        <p className="eyebrow">All done</p>
        <h3 ref={headingRef} tabIndex={-1}>Nice work!</h3>
        <p className="muted">Your results are below. If something went wrong, run it again.</p>
        <button className="big-btn" onClick={onStart}>Run again</button>
      </div>
    );
  }

  return (
    <div className="panel scan-guide">
      <ol className="guide-steps" aria-label="Setup steps">
        {GUIDE_STEPS.map((label, i) => (
          <li key={label} className={i < step ? 'done' : i === step ? 'current' : ''}
            aria-current={i === step ? 'step' : undefined}>
            <span className="guide-num" aria-hidden>{i < step ? '✓' : i + 1}</span>
            <span className="guide-label">{label}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <h3 ref={headingRef} tabIndex={-1}>Get in position</h3>
          <ul className="guide-list">
            {tips.map((t) => <li key={t}>{t}</li>)}
            <li>Take glasses off if you can.</li>
            <li>Keep your head still. Only your eyes will move.</li>
          </ul>
          <button className="primary big-btn" onClick={() => setStep(1)}>I’m in position</button>
        </>
      )}

      {step === 1 && (
        <>
          <h3 ref={headingRef} tabIndex={-1}>Camera check</h3>
          {!ready ? (
            <p className="muted">Starting the camera…</p>
          ) : (
            <ul className="guide-checks" aria-live="polite">
              {checks.map(({ id, label, ok, fix }) => (
                <li key={id} className={ok ? 'ok' : ''}>
                  <span className="check-mark" aria-hidden>{ok ? '✓' : ''}</span>
                  <span>
                    <b>{label}</b>
                    {!ok && <span className="muted small"> {fix}</span>}
                    <span className="sr-only">{ok ? ': yes' : ': not yet'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className={allGood ? 'guide-ok' : 'muted small'}>
            {allGood ? 'Looks great!' : canGo ? 'You can continue, but fixing the rest gives a cleaner result.' : 'The dots on the camera show where we see your eyes.'}
          </p>
          <div className="row">
            <button className="primary big-btn" disabled={!ready || !canGo} onClick={() => setStep(2)}>Next</button>
            <button className="ghost" onClick={() => setStep(0)}>Back</button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h3 ref={headingRef} tabIndex={-1}>Here’s what happens</h3>
          <ol className="guide-list numbered">
            <li>A little face pops up. Look at its nose until it jumps to a new spot.</li>
            <li>Then it glides side to side. Follow it with just your eyes.</li>
            <li>It takes about 30 seconds. Press Esc to stop at any time.</li>
          </ol>
          <button className="ghost speak-btn" onClick={onReadAloud}>
            🔊 {readAloud ? 'Read it again' : 'Read this to me'}
          </button>
          {progress}
          <div className="row">
            <button className="primary big-btn" disabled={!ready} onClick={onStart}>Start</button>
            <button className="ghost" onClick={() => setStep(1)}>Back</button>
          </div>
        </>
      )}
    </div>
  );
}
