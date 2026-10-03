// Balance test in the modified-BESS format: three 20 s stances, eyes closed,
// phone held flat against the chest. The phone's accelerometer measures sway;
// an examiner taps for errors the phone can't feel.

export const STANCES = [
  {
    id: 'double',
    label: 'Feet together',
    how: 'Stand with your feet side by side, touching.',
  },
  {
    id: 'single',
    label: 'Single leg',
    how: 'Stand on your non-dominant leg. Bend the other knee so that foot is off the ground.',
  },
  {
    id: 'tandem',
    label: 'Heel to toe',
    how: 'One foot in front of the other, front heel touching back toe. Non-dominant foot in back.',
  },
];

export const BALANCE = {
  durationMs: 20000,
  countdownS: 5,
  settleMs: 500, // ignore the first moment after "go"
  smoothMs: 200, // averages out hand tremor and sensor noise
  stumbleAccel: 4, // m/s^2 jolt away from the stance average = stumble/step
  stumbleGapMs: 1000, // one stumble per second at most
  minRateHz: 20,
};

export const METRICS = {
  sway: {
    label: 'Sway',
    unit: '',
    digits: 0,
    scale: 100,
    worse: 'higher',
    explain: 'Average body sway across all three stances, from the phone\'s motion sensor. Lower is steadier.',
  },
  singleSway: {
    label: 'Single-leg sway',
    unit: '',
    digits: 0,
    scale: 100,
    worse: 'higher',
    explain: 'Sway on the hardest stance alone, where balance problems tend to show first.',
  },
  errors: {
    label: 'Errors',
    unit: '',
    digits: 0,
    worse: 'higher',
    minSpread: 1,
    explain: 'Stumbles the phone felt plus errors the examiner counted (eyes opened, foot moved). Lower is better.',
    rate: (v) => (v <= 3 ? 'good' : v <= 6 ? 'ok' : 'poor'),
  },
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// samples: [{ t (ms), a: [x, y, z] }] accelerationIncludingGravity, m/s^2.
// Returns { ok, sway, stumbles, rateHz } for one stance.
export function scoreStance(samples) {
  const use = samples.filter((s) => s.t >= BALANCE.settleMs);
  if (use.length < 10) return { ok: false, reason: 'No motion sensor readings.' };
  const seconds = (use[use.length - 1].t - use[0].t) / 1000;
  const rateHz = use.length / Math.max(seconds, 0.001);
  if (rateHz < BALANCE.minRateHz) {
    return { ok: false, reason: `Motion sensor too slow (${rateHz.toFixed(0)} readings/s).` };
  }

  // Gravity direction = average acceleration over the stance. Sway is the
  // motion perpendicular to it, so phone orientation doesn't matter.
  const mean = [0, 1, 2].map((k) => use.reduce((s, p) => s + p.a[k], 0) / use.length);
  const g = Math.hypot(...mean) || 1;
  const up = mean.map((v) => v / g);
  const horizontal = (a) => {
    const d = [a[0] - mean[0], a[1] - mean[1], a[2] - mean[2]];
    const along = dot(d, up);
    return [d[0] - along * up[0], d[1] - along * up[1], d[2] - along * up[2]];
  };

  // Stumbles: big jolts in the raw signal.
  const stumbleTimes = [];
  for (const p of use) {
    const d = [p.a[0] - mean[0], p.a[1] - mean[1], p.a[2] - mean[2]];
    const last = stumbleTimes[stumbleTimes.length - 1] ?? -Infinity;
    if (Math.hypot(...d) > BALANCE.stumbleAccel && p.t - last > BALANCE.stumbleGapMs) {
      stumbleTimes.push(p.t);
    }
  }
  // A stumble already counts as an error; keep it out of the sway score.
  const nearStumble = (t) => stumbleTimes.some((s) => Math.abs(t - s) < 500);

  // Sway: RMS of the smoothed horizontal signal.
  const half = BALANCE.smoothMs / 2;
  let lo = 0, hi = 0;
  const sum = [0, 0, 0];
  let sq = 0, n = 0;
  for (let i = 0; i < use.length; i++) {
    const t = use[i].t;
    while (hi < use.length && use[hi].t <= t + half) {
      for (let k = 0; k < 3; k++) sum[k] += use[hi].a[k];
      hi++;
    }
    while (use[lo].t < t - half) {
      for (let k = 0; k < 3; k++) sum[k] -= use[lo].a[k];
      lo++;
    }
    if (nearStumble(t)) continue;
    const count = hi - lo;
    const h = horizontal(sum.map((v) => v / count));
    sq += dot(h, h);
    n++;
  }

  return { ok: true, sway: Math.sqrt(sq / Math.max(n, 1)), stumbles: stumbleTimes.length, rateHz };
}

// stances: { [id]: { samples, taps } }
export function computeBalance(stances) {
  const scored = {};
  for (const s of STANCES) {
    const r = scoreStance(stances[s.id]?.samples ?? []);
    if (!r.ok) return { ok: false, reason: `${s.label}: ${r.reason}` };
    scored[s.id] = { ...r, taps: stances[s.id].taps, errors: r.stumbles + stances[s.id].taps };
  }
  const sways = STANCES.map((s) => scored[s.id].sway);
  return {
    ok: true,
    metrics: {
      sway: sways.reduce((a, b) => a + b, 0) / sways.length,
      singleSway: scored.single.sway,
      errors: STANCES.reduce((n, s) => n + scored[s.id].errors, 0),
    },
    stances: scored,
  };
}
