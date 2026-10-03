// Baseline sanity checks. A baseline that's far worse than a healthy athlete
// usually scores makes a later post-hit check look fine, whether it was a bad
// day, a bad setup, or someone tanking it on purpose ("sandbagging", a known
// problem with baseline concussion tests). These don't block saving; they
// ask for a redo first.
//
// The cutoffs are deliberately generous starting points, not clinical norms:
// tune them once there's volunteer data. Eye timing includes camera delay.

const CHECKS = {
  reaction: (m) => [
    m.medianMs > 450 && `Median reaction time of ${Math.round(m.medianMs)} ms is slower than almost all healthy athletes.`,
    m.mistakes >= 3 && `${m.mistakes} early taps. Wait for green before tapping.`,
  ],
  eye: (m) => [
    m.gain < 0.6 && `The eyes moved at ${Math.round(m.gain * 100)}% of the dot’s speed. Healthy eyes usually keep up.`,
    m.onTarget < 40 && `The eyes were on the dot only ${Math.round(m.onTarget)}% of the time.`,
  ],
  balance: (m) => [
    m.errors > 15 && `${m.errors} balance errors is a lot for a healthy athlete.`,
  ],
};
CHECKS.eyePhone = CHECKS.eye;

// Reasons this looks like a poor baseline (empty if it looks fine).
export function baselineConcerns(test, metrics) {
  return (CHECKS[test]?.(metrics) ?? []).filter(Boolean);
}
