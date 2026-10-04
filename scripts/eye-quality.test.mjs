import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CALIBRATION, PURSUIT, targetX, computePursuit, fitCalibration, frameIssue } from '../src/tests/eye/pursuit.js';
import { summarize, compareToSummary, limitsFrom, judge, SPECS } from '../shared/assess.js';

const calibration = { ok: true, a: 1, b: 0, r2: 1, yaw: 0, eyeDiff: 0 };
const samples = ({ gain = 1, lagMs = 120, issue, count = 600, interval = (PURSUIT.moveMs - PURSUIT.skipMs) / 600 } = {}) =>
  Array.from({ length: count }, (_, i) => {
    const t = PURSUIT.skipMs + i * interval;
    return { t, h: 0.5 + (targetX(t - lagMs) - 0.5) * gain, issue: issue?.(i) ?? null };
  });
const baseline = summarize(Array.from({ length: 3 }, () => ({
  metrics: { onTarget: 95, gain: 1, saccadeRate: 0.5, lagMs: 100 },
})));
const assertUnreliable = (result, reason) => {
  assert.equal(result.ok, false);
  assert.equal(result.status, 'unreliable');
  assert.equal(Object.hasOwn(result, 'metrics'), false, 'A failed capture must not expose metrics for saving or grading');
  assert.match(result.reason, reason);
};

test('extensive face loss is a measurement failure instead of a worse-function score', () => {
  const result = computePursuit(samples({ gain: 0.3, lagMs: 280, issue: (i) => i % 100 < 15 ? null : 'face' }), calibration);
  assert.ok(result.validFraction < 0.2);
  assertUnreliable(result, /Face lost/);
});

test('each existing capture warning blocks scoring, including multiple faces in the run', () => {
  for (const [issue, count, reason] of [['head', 66, /Head turned/], ['face', 66, /Face lost/], ['blink', 96, /Eyes closed/], ['glitch', 96, /landmarks were unreliable/]]) {
    assertUnreliable(computePursuit(samples({ issue: (i) => i < count ? issue : null }), calibration), reason);
  }
  assertUnreliable(computePursuit(samples(), { ...calibration, r2: 0.44 }), /Calibration was shaky/);
  assertUnreliable(computePursuit(samples(), calibration, { multiFacePct: 6 }), /Someone else/);
});

test('the existing quality boundaries still allow modest isolated capture loss', () => {
  const result = computePursuit(samples({ issue: (i) => i < 60 ? 'face' : null }), { ...calibration, r2: 0.85 }, { multiFacePct: 5 });
  assert.equal(result.ok, true);
  assert.ok(result.metrics.onTarget > 95);
});

test('a repeatable but noisy phone calibration can produce a result', () => {
  const result = computePursuit(samples(), { ...calibration, r2: 0.55 });
  assert.equal(result.ok, true);
  assert.ok(result.metrics.onTarget > 95);
});

test('too few usable or nonconsecutive frames provide no saveable metrics', () => {
  assertUnreliable(computePursuit(samples({ count: 29 }), calibration), /Too few usable frames/);
  // Sparse video has missing recording time, even when every frame is valid.
  assertUnreliable(computePursuit(samples({ count: 60, interval: 200 }), calibration), /recording had long gaps/);
  // Coverage passes, but the central differences still span too much time
  // for the existing velocity calculation. NaN gain must not be unflagged.
  assertUnreliable(computePursuit(samples({ count: 166, interval: 70 }), calibration), /consecutive usable frames/);
});

test('coverage uses the configured sweep length, including the existing quick demonstration mode', () => {
  const original = PURSUIT.moveMs;
  try {
    PURSUIT.moveMs = 6000;
    const result = computePursuit(samples(), calibration);
    assert.equal(result.ok, true);
    assert.equal(result.coverageFraction, 1);
  } finally {
    PURSUIT.moveMs = original;
  }
});

test('a camera that silently stops emitting frames or stalls cannot produce a score', () => {
  const earlyStop = computePursuit(samples({ count: 35, interval: 1000 / 30 }), calibration);
  assert.equal(earlyStop.validFraction, 1, 'All emitted frames can be good even when most of the run is missing');
  assertUnreliable(earlyStop, /stopped before the test finished/);
  const longGap = computePursuit(samples().filter((s) => s.t < 5000 || s.t > 7000), calibration);
  assertUnreliable(longGap, /recording had long gaps/);
});

test('different capture failures cannot hide a large combined loss below individual warning limits', () => {
  const result = computePursuit(samples({ issue: (i) => i < 60 ? 'face' : i < 120 ? 'head' : i < 210 ? 'blink' : i < 300 ? 'glitch' : null }), calibration);
  assert.equal(result.validFraction, 0.5);
  assertUnreliable(result, /Only 50% of recorded frames were usable/);
});

test('nonfinite landmark values are capture issues and cannot produce a passing result', () => {
  assert.equal(frameIssue({ face: true, h: 0.5, yaw: NaN, eyeDiff: 0 }, calibration), 'glitch');
  assert.equal(frameIssue({ face: true, h: 0.5, yaw: 0, eyeDiff: Infinity }, calibration), 'glitch');
  assertUnreliable(computePursuit(samples().map((s) => ({ ...s, h: NaN })), calibration), /unreliable/);
});

test('unusable or inconsistent calibration fails before an eye-function score exists', () => {
  const points = CALIBRATION.points.map((x) => ({ x, samples: Array.from({ length: 5 }, () => ({ h: x, yaw: 0, eyeDiff: 0 })) }));
  assert.equal(fitCalibration(points).ok, true);
  assertUnreliable(fitCalibration(points.map((p) => ({ ...p, samples: p.samples.map((s) => ({ ...s, h: NaN })) }))), /not detected/);
  const inconsistent = [0.2, 0.7, 0.3, 0.8, 0.5];
  assertUnreliable(fitCalibration(points.map((p, i) => ({ ...p, samples: p.samples.map((s) => ({ ...s, h: inconsistent[i] })) }))), /Calibration was shaky/);
});

test('reliably captured low gain, low on-target time and high lag remain concerning', () => {
  const result = computePursuit(samples({ gain: 0.3, lagMs: 280 }), calibration);
  assert.equal(result.ok, true);
  assert.equal(result.validFraction, 1);
  assert.ok(result.metrics.onTarget < 40);
  assert.ok(result.metrics.gain < 0.6);
  assert.ok(result.metrics.lagMs > 250);
  for (const id of ['eye', 'eyePhone']) {
    assert.equal(compareToSummary(baseline, result.metrics, SPECS[id]).status, 'refer');
    assert.equal(judge(limitsFrom(baseline, SPECS[id]), result.metrics), 'refer');
  }
});

test('glasses or vision metadata cannot discount a reliably captured concerning result', () => {
  const recording = samples({ gain: 0.3, lagMs: 280 });
  const plain = computePursuit(recording, calibration);
  const withMetadata = computePursuit(recording, { ...calibration, glasses: true, vision: true });
  assert.deepEqual(withMetadata.metrics, plain.metrics);
  assert.equal(compareToSummary(baseline, withMetadata.metrics, SPECS.eye).status, 'refer');
});
