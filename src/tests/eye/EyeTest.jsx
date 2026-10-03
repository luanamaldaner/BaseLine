import { useEffect, useRef, useState } from 'react';
import { createLandmarker, openCamera, startTracking, EYES } from './faceTracker.js';
import {
  PURSUIT, CALIBRATION, METRICS, targetX, fitCalibration, computePursuit,
} from './pursuit.js';
import { addTrial, compare, summarizeBaseline } from '../../lib/baseline.js';
import TracePlot from './TracePlot.jsx';
import ResultsTable from '../../components/ResultsTable.jsx';

const TEST = 'eye';
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
  const [saved, setSaved] = useState(null);

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
        stream = await openCamera();
        if (cancelled) return;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        landmarker = await createLandmarker();
        if (cancelled) return;

        let frames = 0, fpsStart = performance.now(), fps = 0, lastUi = 0;
        stop = startTracking(video, landmarker, (s) => {
          sinkRef.current?.(s);
          frames++;
          if (s.t - fpsStart >= 1000) {
            fps = (frames * 1000) / (s.t - fpsStart);
            frames = 0;
            fpsStart = s.t;
          }
          if (phaseRef.current === 'preview') drawOverlay(overlayRef.current, video, s);
          if (s.t - lastUi > 120) {
            lastUi = s.t;
            setLive({ face: s.face, h: s.h, v: s.v, blink: s.blink, fps });
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
    setSaved(null);
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
        const hs = [];
        const start = performance.now();
        sinkRef.current = (s) => {
          if (s.t - start >= CALIBRATION.settleMs && s.face && !s.blink) hs.push(s.h);
        };
        await sleep(CALIBRATION.dwellMs);
        checkAbort();
        calibPoints.push({ x, hs });
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
      sinkRef.current = (s) => samples.push({ t: s.t - t0, h: s.h, valid: s.face && !s.blink });
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
      setResult({ ...r, calib });
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
    if (!athlete || !result?.ok) return;
    // Compare against the baseline as it was before this trial is added.
    const comparison = kind === 'check' ? compare(athlete, TEST, result.metrics, METRICS) : null;
    addTrial(athlete, TEST, kind, result.metrics);
    setSaved({ kind, comparison });
  }

  const base = athlete ? summarizeBaseline(athlete, TEST) : null;
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
          <h3>Live signal</h3>
          <LiveSignal live={live} />
          <ul className="tips">
            <li>Sit ~50 cm (arm's length) from the screen, face well lit.</li>
            <li>Remove glasses if you can.</li>
            <li>Keep your head still; move only your eyes.</li>
            <li>Press Esc to stop a test.</li>
          </ul>
          <div className="row">
            <button
              className="primary"
              disabled={status !== 'ready' || !athlete}
              onClick={runTest}
            >
              {phase === 'results' ? 'Run again' : 'Start test'}
            </button>
            {!athlete && <span className="muted">Enter an athlete name first.</span>}
          </div>
          {athlete && (
            <p className="muted small">
              {base ? `${base.n} baseline trial(s) on file for ${athlete}.` : `No baseline yet for ${athlete}.`}
            </p>
          )}
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
            <div className="callout danger">Test failed: {result.reason}</div>
          ) : (
            <>
              {quality.length > 0 && (
                <div className="callout warn">
                  {quality.map((q) => <div key={q}>{q}</div>)}
                </div>
              )}
              <TracePlot trace={result.trace} />
              <ResultsTable metrics={result.metrics} spec={METRICS} comparison={saved?.comparison} />
              <p className="muted small">
                Calibration fit R² {result.calib.r2.toFixed(2)} · usable frames{' '}
                {(result.validFraction * 100).toFixed(0)}% · {result.saccades} saccades
              </p>
              {saved ? (
                <p className="saved">
                  Saved as {saved.kind === 'baseline' ? 'a baseline trial' : 'a post-hit check'}.
                </p>
              ) : (
                <div className="row">
                  <button onClick={() => save('baseline')}>Save as baseline trial</button>
                  <button onClick={() => save('check')} disabled={!base}>
                    Save as post-hit check
                  </button>
                  <button className="ghost" onClick={() => { setResult(null); setPhase('preview'); }}>
                    Discard
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function qualityWarnings(r) {
  const out = [];
  if (r.calib.r2 < 0.85) out.push(`Weak calibration (R² ${r.calib.r2.toFixed(2)}). Retest with better light and a still head.`);
  if (r.validFraction < 0.85) out.push(`Face/eyes lost in ${((1 - r.validFraction) * 100).toFixed(0)}% of frames. Retest.`);
  return out;
}

function LiveSignal({ live }) {
  if (!live) return <p className="muted">Waiting for frames…</p>;
  const pct = Number.isFinite(live.h) ? Math.min(Math.max(live.h, 0), 1) * 100 : null;
  return (
    <div className="live">
      <div className="live-row">
        <span>Face</span>
        <b className={live.face ? 'ok' : 'bad'}>{live.face ? 'detected' : 'not found'}</b>
      </div>
      <div className="live-row">
        <span>Eyes</span>
        <b className={live.blink ? 'bad' : 'ok'}>{live.face ? (live.blink ? 'closed' : 'open') : '—'}</b>
      </div>
      <div className="live-row">
        <span>Frame rate</span>
        <b>{live.fps ? `${live.fps.toFixed(0)} fps` : '…'}</b>
      </div>
      <div className="live-row">
        <span>Iris position</span>
        <b>{Number.isFinite(live.h) ? live.h.toFixed(3) : '—'}</b>
      </div>
      <div className="meter">
        {pct !== null && <div className="meter-dot" style={{ left: `${pct}%` }} />}
      </div>
      <p className="muted small">Look left and right: the dot should move smoothly.</p>
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
