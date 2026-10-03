// Smooth-pursuit test: target motion, calibration fit, and metrics.
// Positions are in screen widths (0 = left edge, 1 = right edge).

export const PURSUIT = {
  amplitude: 0.4, // dot sweeps 0.1 -> 0.9 of screen width
  freqHz: 0.4, // one full left-right-left cycle every 2.5 s
  holdMs: 1200, // dot sits at center before moving
  moveMs: 12500, // 5 cycles
  skipMs: 1000, // ignore pursuit initiation at the start
};

export const CALIBRATION = {
  points: [0.1, 0.3, 0.5, 0.7, 0.9],
  dwellMs: 1500, // time on each point
  settleMs: 600, // ignore the eye's jump to the new point
  minSamples: 5,
};

// Eye velocity this far from the target's velocity (in multiples of the
// target's peak velocity) is treated as a saccade, not pursuit.
const SACCADE_VEL_FACTOR = 1.5;
// ...and it only counts if the eye actually jumped at least this far.
const SACCADE_MIN_JUMP = 0.03;

export const METRICS = {
  trackingError: { label: 'Tracking error', unit: '% width', worse: 'higher', digits: 1 },
  gain: { label: 'Pursuit gain', unit: '', worse: 'lower', digits: 2 },
  saccadeRate: { label: 'Catch-up saccades', unit: '/s', worse: 'higher', digits: 2 },
  lagMs: { label: 'Lag', unit: 'ms', worse: 'higher', digits: 0 },
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

// points: [{ x, hs: [eye ratios recorded while looking at x] }]
// Fits screenX = a * eyeRatio + b by least squares on each point's median.
export function fitCalibration(points) {
  const usable = points.filter((p) => p.hs.length >= CALIBRATION.minSamples);
  if (usable.length < 3) {
    return { ok: false, reason: 'Face/eyes not detected on enough calibration points.' };
  }
  const pts = usable.map((p) => ({ x: p.x, h: median(p.hs) }));
  const n = pts.length;
  const mh = pts.reduce((s, p) => s + p.h, 0) / n;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) {
    sxy += (p.h - mh) * (p.x - mx);
    sxx += (p.h - mh) ** 2;
    syy += (p.x - mx) ** 2;
  }
  if (sxx === 0) return { ok: false, reason: 'Eye position did not change between points.' };
  const a = sxy / sxx;
  const b = mx - a * mh;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { ok: true, a, b, r2, points: pts };
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

// samples: [{ t (ms since motion start), h (eye ratio), valid }]
export function computePursuit(samples, calib) {
  const pts = samples.map((s) => ({
    t: s.t,
    target: targetX(s.t),
    gaze: s.valid ? calib.a * s.h + calib.b : NaN,
    valid: s.valid && Number.isFinite(s.h),
    saccade: false,
  }));
  const clean = despike(pts);
  pts.forEach((p, i) => (p.gaze = clean[i]));

  const analysed = pts.filter((p) => p.t >= PURSUIT.skipMs);
  const use = analysed.filter((p) => p.valid);
  const validFraction = analysed.length ? use.length / analysed.length : 0;
  if (use.length < 30) {
    return { ok: false, reason: 'Too few usable frames (face lost or eyes closed).', validFraction, trace: pts };
  }

  // Lag: the delay that best lines the gaze trace up with the target.
  // Includes camera latency, which is constant per device, so compare lag
  // only against the same athlete's baseline on the same device.
  let lagMs = 0, bestErr = Infinity;
  for (let lag = -100; lag <= 400; lag += 5) {
    let err = 0;
    for (const p of use) err += (p.gaze - targetX(p.t - lag)) ** 2;
    if (err < bestErr) { bestErr = err; lagMs = lag; }
  }

  const trackingError =
    100 * Math.sqrt(use.reduce((s, p) => s + (p.gaze - p.target) ** 2, 0) / use.length);

  // Velocities by central difference across valid neighbours.
  const vel = [];
  for (let i = 1; i < analysed.length - 1; i++) {
    const p0 = analysed[i - 1], p = analysed[i], p2 = analysed[i + 1];
    const dt = (p2.t - p0.t) / 1000;
    if (!p0.valid || !p.valid || !p2.valid || dt <= 0 || dt > 0.12) continue;
    vel.push({ i, ev: (p2.gaze - p0.gaze) / dt, tv: targetVel(p.t - lagMs) });
  }

  // Saccades: runs of consecutive frames where the eye moves much faster than
  // the target, with a real net jump.
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
      for (let k = i; k <= j; k++) {
        inSaccade.add(k);
        analysed[k].saccade = true;
      }
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

  return {
    ok: true,
    metrics: {
      trackingError,
      gain,
      saccadeRate: saccades / seconds,
      lagMs,
    },
    saccades,
    validFraction,
    trace: pts,
  };
}
