// Sanity check for the eye-pursuit metrics on synthetic recordings.
// Run: npm test
//
// A camera can't be scripted, so the measurement layer is validated against
// signals whose true lag and gain we already know. Samples are in the shape
// EyeTest feeds computePursuit: { t, h, issue }, with an identity calibration
// so the eye reading IS the screen fraction. EyeTest and pursuit.js change
// often; this is what catches a metric quietly breaking.

import { PURSUIT, targetX, computePursuit } from '../src/tests/eye/pursuit.js';

const FPS = 60;
const IDENTITY = { ok: true, a: 1, b: 0, r2: 1, yaw: 0, eyeDiff: 0 };

// Deterministic pseudo-noise so a run is reproducible.
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2;

/** A recording where the eye trails the dot by `lagMs` at gain `gain`. */
function synth({ lagMs = 0, gain = 1, noise = 0, saccadeEvery = 0 }) {
  seed = 12345;
  const samples = [];
  const n = Math.round((PURSUIT.moveMs / 1000) * FPS);
  // A catch-up saccade is a step, not a spike: the eye jumps toward the dot
  // and STAYS there, then falls behind again. A one-frame blip is a landmark
  // glitch, and the despike filter is right to erase it.
  let held = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / FPS) * 1000;
    const target = targetX(t);
    const pursuit = 0.5 + (targetX(t - lagMs) - 0.5) * gain;
    if (saccadeEvery && i % Math.round(FPS * saccadeEvery) === 0 && i > 0) held = (target - pursuit) * 0.9;
    samples.push({ t, h: pursuit + held + rand() * noise, issue: null });
  }
  return samples;
}

const cases = [
  { name: 'perfect tracking',            opts: { lagMs: 0,   gain: 1.0 } },
  { name: 'healthy lag (120 ms)',        opts: { lagMs: 120, gain: 1.0 } },
  { name: 'reduced gain (0.7)',          opts: { lagMs: 120, gain: 0.7 } },
  { name: 'noisy but tracking',          opts: { lagMs: 120, gain: 1.0, noise: 0.006 } },
  { name: 'anticipating (-80 ms)',       opts: { lagMs: -80, gain: 1.0, noise: 0.004 } },
  { name: 'saccadic (impaired pursuit)', opts: { lagMs: 160, gain: 0.6, noise: 0.005, saccadeEvery: 0.6 } },
];

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) { failed++; console.log(`  FAIL ${label}: ${detail}`); }
};

console.log('case                        | lag ms | gain | on target | jumps/s');
console.log('----------------------------|--------|------|-----------|--------');
const by = {};
for (const c of cases) {
  const r = computePursuit(synth(c.opts), IDENTITY);
  check(`${c.name} produces a result`, r.ok, r.reason);
  by[c.name] = r;
  if (!r.ok) continue;
  const m = r.metrics;
  console.log(
    `${c.name.padEnd(27)} | ${m.lagMs.toFixed(0).padStart(6)} | ${m.gain.toFixed(2).padStart(4)} |` +
    ` ${m.onTarget.toFixed(0).padStart(8)}% | ${m.saccadeRate.toFixed(2).padStart(6)}`,
  );
}
const M = (name) => by[name]?.metrics ?? {};

check('lag recovery', Math.abs(M('healthy lag (120 ms)').lagMs - 120) <= 20,
  `got ${M('healthy lag (120 ms)').lagMs} ms, expected ~120`);
check('gain recovery', Math.abs(M('reduced gain (0.7)').gain - 0.7) <= 0.1,
  `got ${M('reduced gain (0.7)').gain?.toFixed(2)}, expected ~0.70`);
check('healthy lag stays on target', M('healthy lag (120 ms)').onTarget > 95,
  `on target only ${M('healthy lag (120 ms)').onTarget?.toFixed(0)}% with a normal 120 ms lag`);
// Against a predictable sinusoid the eye can lead the target. A lag search
// that cannot go negative pins these to zero and bills anticipation as error.
check('anticipation is recovered as negative lag', Math.abs(M('anticipating (-80 ms)').lagMs + 80) <= 20,
  `got ${M('anticipating (-80 ms)').lagMs} ms, expected ~-80`);
check('anticipation stays on target', M('anticipating (-80 ms)').onTarget > 95,
  `on target only ${M('anticipating (-80 ms)').onTarget?.toFixed(0)}%`);
check('reduced gain lowers on-target', M('reduced gain (0.7)').onTarget < M('healthy lag (120 ms)').onTarget,
  'a 0.7 gain did not reduce time on target');
check('saccades detected only when present',
  M('saccadic (impaired pursuit)').saccadeRate > 0.3 && M('healthy lag (120 ms)').saccadeRate < 0.1,
  `impaired ${M('saccadic (impaired pursuit)').saccadeRate?.toFixed(2)}/s vs healthy ${M('healthy lag (120 ms)').saccadeRate?.toFixed(2)}/s`);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
