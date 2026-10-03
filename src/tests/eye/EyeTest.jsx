import { useEffect, useRef, useState } from 'react';
import { createLandmarker, openCamera, startTracking, EYES } from './faceTracker.js';
import {
  PURSUIT, CALIBRATION, METRICS, targetX, fitCalibration, frameIssue, computePursuit,
} from './pursuit.js';
import { addTrial, compare, summarizeBaseline } from '../../lib/baseline.js';
import TracePlot from './TracePlot.jsx';
import ResultCards from '../../components/ResultCards.jsx';

const TEST = 'eye';
const BASELINE_TRIALS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function EyeTest({ athlete }) {
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
  const [live, setLive] = useState(null);
  const [result, setResult] = useState(null);
  const [savedKind, setSavedKind] = useState(null);
  const [, bump] = useState(0); // re-render after saving a trial

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
        stop = startTracking(video, landmarker, (s) => {
          sinkRef.current?.(s);
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
            setLive({ face: s.face, h: smoothH, yaw: s.yaw, blink: s.blink, fps });
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

  async function runTest() {
    abortRef.current = false;
    setResult(null);
    setSavedKind(null);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      /* fullscreen is nice-to-have */
    }
    setPhase('calibrate');
    setStageText('Keep your head still. Look at each dot until it moves.');
    await sleep(50);

    try {
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

      // 2. Pursuit: follow the moving dot.
      setPhase('pursuit');
      setStageText('Follow the dot with your eyes only. Keep your head still.');
      moveDot(0.5);
      await sleep(PURSUIT.holdMs);
      checkAbort();
      setStageText('');

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
      const comparison = r.ok && summarizeBaseline(athlete, TEST)
        ? compare(athlete, TEST, r.metrics, METRICS)
        : null;
      setResult({ ...r, calib, comparison });
      setPhase('results');
    } catch (e) {
      sinkRef.current = null;
      if (e.message === 'aborted') {
        setPhase('preview');
      } else {
        setResult({ ok: false, reason: e.message });
        setPhase('results');
      }
    } finally {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }

  function save(kind) {
    if (!result?.ok) return;
    addTrial(athlete, TEST, kind, result.metrics);
    setSavedKind(kind);
    bump((n) => n + 1);
  }

  const base = summarizeBaseline(athlete, TEST);
  const baseN = base?.n ?? 0;
  const testing = phase === 'calibrate' || phase === 'pursuit';
  const quality = result?.ok ? qualityWarnings(result) : [];

  return (
    <section className="test">
      <header className="test-head">
        <h2>Eye pursuit</h2>
        <p className="muted">
          Follow a moving dot with your eyes. The camera tracks your irises to measure how
          smoothly they keep up.
        </p>
      </header>

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

        <div className="panel">
          <h3>Setup check</h3>
          <LiveSignal live={live} />
          <ul className="tips">
            <li>Sit ~50 cm (arm's length) from the screen, face well lit.</li>
            <li>Remove glasses if you can.</li>
            <li>Keep your head still; move only your eyes.</li>
            <li>Press Esc to stop a test.</li>
          </ul>
          <div className="row">
            <button className="primary" disabled={status !== 'ready'} onClick={runTest}>
              {phase === 'results' ? 'Run again' : 'Start test'}
            </button>
          </div>
          <p className="muted small">
            Baseline: {Math.min(baseN, BASELINE_TRIALS)} of {BASELINE_TRIALS} trials recorded
            {baseN >= BASELINE_TRIALS ? ' ✓' : ''}
          </p>
        </div>
      </div>

      {testing && (
        <div className="stage">
          <div ref={dotRef} className={`dot ${phase === 'calibrate' ? 'pulse' : ''}`} />
          {stageText && <div className="stage-text">{stageText}</div>}
        </div>
      )}

      {phase === 'results' && result && (
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

              {!result.comparison && (
                <div className="callout">
                  <b>No baseline yet for {athlete}.</b> Save this as a baseline trial. Record{' '}
                  {BASELINE_TRIALS} while healthy; later tests are compared to them.
                </div>
              )}

              <ResultCards metrics={result.metrics} spec={METRICS} comparison={result.comparison} />

              <div className="plot-wrap">
                <h3>Eyes vs. dot</h3>
                <p className="muted small">
                  Gray is where the dot was; blue is where your eyes were. The closer the two
                  lines, the better the tracking. Red dots mark catch-up jumps. Gaps are blinks or
                  moments the tracker lost your eyes.
                </p>
                <TracePlot trace={result.trace} />
              </div>

              {savedKind ? (
                <p className="saved">
                  Saved as {savedKind === 'baseline' ? 'a baseline trial' : 'a post-hit check'}.
                </p>
              ) : (
                <div className="row">
                  <button className="primary" onClick={() => save('baseline')}>
                    Save as baseline trial
                  </button>
                  <button onClick={() => save('check')} disabled={!base}>
                    Save as post-hit check
                  </button>
                  <button className="ghost" onClick={() => { setResult(null); setPhase('preview'); }}>
                    Discard
                  </button>
                </div>
              )}
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
  return out;
}

function LiveSignal({ live }) {
  if (!live) return <p className="muted">Waiting for camera…</p>;
  const pct = Number.isFinite(live.h) ? Math.min(Math.max(live.h, 0), 1) * 100 : null;
  const facing = Number.isFinite(live.yaw) && Math.abs(live.yaw) < 0.08;
  const rows = [
    ['Face', live.face ? 'found' : 'not found', live.face],
    ['Head', !live.face ? '—' : facing ? 'facing screen' : 'turn to face screen', live.face && facing],
    ['Eyes', !live.face ? '—' : live.blink ? 'closed' : 'open', live.face && !live.blink],
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
