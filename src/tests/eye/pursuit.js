// Smooth-pursuit test: target motion, calibration fit, frame checks, metrics.
// Positions are in screen widths (0 = left edge, 1 = right edge).
import { calibrationIssue, captureQuality, unreliableMeasurement, temporalCoverage, MAX_SAMPLE_GAP_MS } from './quality.js';

export const PURSUIT = {
  // Dot sweeps 0.2 -> 0.8 of screen width. Wider sweeps push the iris into
  // the eye corners, where the eyelid covers it and the landmarks get noisy.
  amplitude: 0.3,
  freqHz: 0.4, // one full left-right-left cycle every 2.5 s
  holdMs: 1200, // dot sits at center before moving
  moveMs: 12500, // 5 cycles
  skipMs: 1000, // ignore pursuit initiation at the start
};

export const CALIBRATION = {
  points: [0.2, 0.35, 0.5, 0.65, 0.8], // same range the dot covers
  dwellMs: 1600, // time on each point
  settleMs: 600, // ignore the eye's jump to the new point
  minSamples: 5,
};

// Frame rejection (see frameIssue).
const HEAD_TURN_LIMIT = 0.1; // ~10 degrees of head turn from calibration
const EYE_DIFF_LIMIT = 0.08; // left/right eye readings disagree by this much

// Eye velocity this far from the target's velocity (in multiples of the
// target's peak velocity) is treated as a saccade, not pursuit.
const SACCADE_VEL_FACTOR = 1.5;
// ...and it only counts if the eye actually jumped at least this far.
const SACCADE_MIN_JUMP = 0.04;
// Eyes count as "on the dot" within this distance (screen widths).
const ON_TARGET_WINDOW = 0.07;

// What each metric means, for the results screen. `rate` is a rough guide for
// a webcam test, not a clinical cutoff; the real check is the comparison to
// the athlete's own baseline.
export const METRICS = {
  onTarget: {
    label: 'On target',
    unit: '%',
    digits: 0,
    worse: 'lower',
    explain: 'How much of the test your eyes were on the dot. Higher is better.',
    rate: (v) => (v >= 75 ? 'good' : v >= 55 ? 'ok' : 'poor'),
  },
  gain: {
    label: 'Smoothness',
    unit: '%',
    digits: 0,
    worse: 'lower',
    scale: 100,
    explain: "How fast your eyes moved compared to the dot. 100% means they matched the dot's speed.",
    rate: (v) => (v >= 0.8 && v <= 1.2 ? 'good' : v >= 0.65 ? 'ok' : 'poor'),
  },
  saccadeRate: {
    label: 'Catch-up jumps',
    unit: 'per sec',
    digits: 1,
    worse: 'higher',
    explain: 'How often your eyes fell behind and had to jump to catch the dot. Lower is better.',
    rate: (v) => (v <= 0.6 ? 'good' : v <= 1.2 ? 'ok' : 'poor'),
  },
  lagMs: {
    label: 'Delay',
    unit: 'ms',
    digits: 0,
    worse: 'higher',
    explain: 'How far behind the dot your eyes were. Includes camera delay, so it only means something next to your own baseline.',
  },
};

const TWO_PI = 2 * Math.PI;
export const PEAK_VEL = PURSUIT.amplitude * TWO_PI * PURSUIT.freqHz; // widths/s

// tMs = time since the dot started moving.
export function targetX(tMs) {
  if (tMs < 0) return 0.5;
  return 0.5 + PURSUIT.amplitude * Math.sin((TWO_PI * PURSUIT.freqHz * tMs) / 1000);
}

export function targetVel(tMs) {
  if (tMs < 0) return 0;
  return PEAK_VEL * Math.cos((TWO_PI * PURSUIT.freqHz * tMs) / 1000);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// points: [{ x, samples: [{ h, yaw, eyeDiff }] recorded while looking at x }]
// Fits screenX = a * eyeRatio + b by least squares on each point's median,
// and records the head pose / eye difference to check later frames against.
export function fitCalibration(points) {
  const usable = points
    .filter((p) => Number.isFinite(p.x))
    .map((p) => ({ ...p, samples: p.samples.filter((s) => [s.h, s.yaw, s.eyeDiff].every(Number.isFinite)) }))
    .filter((p) => p.samples.length >= CALIBRATION.minSamples);
  if (usable.length < 3) {
    return unreliableMeasurement('Face/eyes not detected on enough calibration points.');
  }
  const pts = usable.map((p) => ({ x: p.x, h: median(p.samples.map((s) => s.h)) }));
  const all = usable.flatMap((p) => p.samples);
  const n = pts.length;
  const mh = pts.reduce((s, p) => s + p.h, 0) / n;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    sxy += (p.h - mh) * (p.x - mx);
    sxx += (p.h - mh) ** 2;
    syy += (p.x - mx) ** 2;
  }
  if (sxx === 0) return unreliableMeasurement('Eye position did not change between points.');
  const a = sxy / sxx;
  const calib = {
    ok: true,
    a,
    b: mx - a * mh,
    r2: (sxy * sxy) / (sxx * syy),
    yaw: median(all.map((s) => s.yaw)),
    eyeDiff: median(all.map((s) => s.eyeDiff)),
    points: pts,
  };
  const issue = calibrationIssue(calib);
  return issue ? { ...calib, ...unreliableMeasurement(issue) } : calib;
}

// Why a frame can't be trusted, or null if it's fine.
export function frameIssue(s, calib) {
  if (!s.face || !Number.isFinite(s.h)) return 'face';
  if (s.blink) return 'blink';
  if (![s.yaw, s.eyeDiff].every(Number.isFinite)) return 'glitch';
  if (Math.abs(s.yaw - calib.yaw) > HEAD_TURN_LIMIT) return 'head';
  if (Math.abs(s.eyeDiff - calib.eyeDiff) > EYE_DIFF_LIMIT) return 'glitch';
  return null;
}

// 3-point median over runs of valid samples: knocks out single-frame landmark
// glitches without smearing real saccade steps.
function despike(pts) {
  const out = pts.map((p) => p.gaze);
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i - 1].valid && pts[i].valid && pts[i + 1].valid) {
      out[i] = median([pts[i - 1].gaze, pts[i].gaze, pts[i + 1].gaze]);
    }
  }
  return out;
}

// samples: [{ t (ms since motion start), h (eye ratio), issue (null if ok) }]
export function computePursuit(samples, calib, { multiFacePct = 0 } = {}) {
  const pts = samples.map((s) => {
    const gaze = calib?.a * s.h + calib?.b;
    const issue = s.issue || (!Number.isFinite(gaze) ? 'glitch' : null);
    return {
      t: s.t,
      target: targetX(s.t),
      gaze: issue ? NaN : gaze,
      valid: !issue,
      issue,
      saccade: false,
    };
  });
  const clean = despike(pts);
  pts.forEach((p, i) => (p.gaze = clean[i]));

  const analysed = pts.filter((p) => p.t >= PURSUIT.skipMs && p.t <= PURSUIT.moveMs);
  const use = analysed.filter((p) => p.valid);
  const validFraction = analysed.length ? use.length / analysed.length : 0;
  const issues = { face: 0, blink: 0, head: 0, glitch: 0 };
  for (const p of analysed) if (p.issue) issues[p.issue]++;
  const coverageFraction = temporalCoverage(analysed, PURSUIT.skipMs, PURSUIT.moveMs);
  const diagnostics = { validFraction, coverageFraction, issues, trace: pts };
  const quality = captureQuality({ calib, totalFrames: analysed.length, usableFrames: use.length, issues, multiFacePct, coverageFraction });
  if (!quality.ok) return { ...quality, ...diagnostics };

  // Lag: the delay that best lines the gaze trace up with the target, judged
  // by residual variance so a constant left/right offset doesn't bias it.
  // Includes camera latency, which is constant per device, so compare lag
  // only against the same athlete's baseline on the same device.
  let lagMs = 0, bestVar = Infinity;
  for (let lag = -150; lag <= 400; lag += 5) {
    let s1 = 0, s2 = 0;
    for (const p of use) {
      const r = p.gaze - targetX(p.t - lag);
      s1 += r;
      s2 += r * r;
    }
    const variance = s2 / use.length - (s1 / use.length) ** 2;
    if (variance < bestVar) { bestVar = variance; lagMs = lag; }
  }

  // Remove the constant offset (small head shifts after calibration move the
  // whole trace sideways; that's drift, not an eye-movement problem).
  const offset = median(use.map((p) => p.gaze - targetX(p.t - lagMs)));
  for (const p of pts) if (p.valid) p.gaze -= offset;

  const onTarget =
    (100 * use.filter((p) => Math.abs(p.gaze - targetX(p.t - lagMs)) <= ON_TARGET_WINDOW).length) /
    use.length;
  const trackingError =
    100 * Math.sqrt(use.reduce((s, p) => s + (p.gaze - p.target) ** 2, 0) / use.length);

  // Velocities by central difference across valid neighbours.
  const vel = [];
  for (let i = 1; i < analysed.length - 1; i++) {
    const p0 = analysed[i - 1], p = analysed[i], p2 = analysed[i + 1];
    const dt = (p2.t - p0.t) / 1000;
    if (!p0.valid || !p.valid || !p2.valid || dt <= 0 || dt > MAX_SAMPLE_GAP_MS / 1000) continue;
    vel.push({ i, ev: (p2.gaze - p0.gaze) / dt, tv: targetVel(p.t - lagMs) });
  }

  // Saccades: runs of consecutive frames where the eye moves much faster than
  // the target, with a real net jump. Marked once, at the start of the jump.
  let saccades = 0;
  const fast = new Set(
    vel.filter((v) => Math.abs(v.ev - v.tv) > SACCADE_VEL_FACTOR * PEAK_VEL).map((v) => v.i),
  );
  const inSaccade = new Set();
  for (let i = 0; i < analysed.length; i++) {
    if (!fast.has(i) || fast.has(i - 1)) continue;
    let j = i;
    while (fast.has(j + 1)) j++;
    const before = analysed[i - 1], after = analysed[j + 1];
    if (before?.valid && after?.valid && Math.abs(after.gaze - before.gaze) >= SACCADE_MIN_JUMP) {
      saccades++;
      analysed[i].saccade = true;
      for (let k = i; k <= j; k++) inSaccade.add(k);
    }
  }

  // Gain: least-squares slope of eye velocity on target velocity, using
  // pursuit-only frames while the target is moving reasonably fast.
  let num = 0, den = 0;
  for (const v of vel) {
    if (inSaccade.has(v.i) || Math.abs(v.tv) < 0.3 * PEAK_VEL) continue;
    num += v.ev * v.tv;
    den += v.tv * v.tv;
  }
  const gain = den > 0 ? num / den : NaN;

  const seconds = (analysed[analysed.length - 1].t - analysed[0].t) / 1000;
  const metrics = { onTarget, gain, saccadeRate: saccades / seconds, lagMs, trackingError };
  // Sparse or stalled video can leave no consecutive samples for velocity.
  // Never turn an unavailable metric into a normal (or worse) function score.
  if (!Object.values(metrics).every(Number.isFinite)) {
    return { ...unreliableMeasurement('The recording did not contain enough consecutive usable frames. Check the camera and repeat the test.'), ...diagnostics };
  }

  return {
    ok: true,
    metrics,
    saccades,
    validFraction,
    coverageFraction,
    issues,
    trace: pts,
  };
}
