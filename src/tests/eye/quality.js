// Capture checks, not measures of eye function or clinical thresholds.
// Per-cause boundaries come from the existing webcam setup warnings. The
// same 10% loss budget now also covers combined causes and missing video
// time. These engineering checks are not clinically validated cutoffs.
// A failed capture cannot support a baseline or post-hit comparison.
export const MIN_CAPTURE_FRACTION = 0.9;
// Existing maximum time spanned by the pursuit velocity calculation.
export const MAX_SAMPLE_GAP_MS = 120;

// A stopped camera emits no "face lost" samples. Measure covered recording
// time as well as the quality of frames that happened to arrive. Two samples
// can bridge at most the existing velocity gap; longer holes stay missing.
export function temporalCoverage(samples, startMs, endMs) {
  const halfGap = MAX_SAMPLE_GAP_MS / 2;
  let coveredMs = 0, coveredUntil = startMs;
  for (const { t } of samples) {
    if (!Number.isFinite(t)) continue;
    const start = Math.max(startMs, t - halfGap);
    const end = Math.min(endMs, t + halfGap);
    if (end > coveredUntil) {
      coveredMs += Math.max(0, end - Math.max(start, coveredUntil));
      coveredUntil = end;
    }
  }
  return endMs > startMs ? coveredMs / (endMs - startMs) : 0;
}
export function unreliableMeasurement(reasons) {
  const list = Array.isArray(reasons) ? reasons : [reasons];
  return { ok: false, status: 'unreliable', reason: list.join(' '), reasons: list };
}

export function calibrationIssue(calib) {
  if (!calib?.ok || ![calib.a, calib.b, calib.r2, calib.yaw, calib.eyeDiff].every(Number.isFinite)) {
    return 'The camera could not calibrate eye position. Check the setup and repeat the test.';
  }
  if (calib.r2 < 0.85) return 'Calibration was shaky. Keep your head still and look right at each dot.';
  return null;
}

export function captureQuality({ calib, totalFrames, usableFrames, issues, multiFacePct = 0, coverageFraction = 1 }) {
  const reasons = [];
  const calibration = calibrationIssue(calib);
  if (calibration) reasons.push(calibration);
  if (usableFrames < 30) reasons.push('Too few usable frames (face lost, eyes closed, or head turned).');
  if (!totalFrames || usableFrames / totalFrames < MIN_CAPTURE_FRACTION) {
    reasons.push(`Only ${totalFrames ? Math.round(100 * usableFrames / totalFrames) : 0}% of recorded frames were usable. Check the camera setup and repeat the test.`);
  }
  if (coverageFraction < MIN_CAPTURE_FRACTION) {
    reasons.push('The camera recording had long gaps or stopped before the test finished. Repeat the test with the camera running throughout.');
  }
  // Preserve the existing rounded-percentage warning boundaries.
  const pct = (n) => Math.round((100 * (n ?? 0)) / (totalFrames || 1));
  if (pct(issues.head) > 10) reasons.push(`Head turned during ${pct(issues.head)}% of the test. Move only your eyes.`);
  if (pct(issues.face) > 10) reasons.push(`Face lost during ${pct(issues.face)}% of the test. Improve the lighting or move closer.`);
  if (pct(issues.blink) > 15) reasons.push(`Eyes closed during ${pct(issues.blink)}% of the test.`);
  if (pct(issues.glitch) > 15) reasons.push(`Eye landmarks were unreliable during ${pct(issues.glitch)}% of the test. Improve the lighting and reduce glare.`);
  if (multiFacePct > 5) reasons.push('Someone else’s face came into view. The tracker may have followed the wrong person.');
  return reasons.length ? unreliableMeasurement(reasons) : { ok: true };
}
