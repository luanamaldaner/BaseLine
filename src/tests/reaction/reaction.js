// Simple visual reaction time: tap as soon as the pad turns green.
//
// Absolute times include screen and touchscreen/mouse latency, which differ by
// device, so (like eye-pursuit lag) they only mean something against the same
// athlete's baseline on the same kind of device.

export const REACTION = {
  practice: 3, // not scored
  trials: 15,
  minDelayMs: 1000, // random wait before green
  maxDelayMs: 3500,
  lapseMs: 1500, // no tap by then = too slow
  feedbackMs: 800,
  minValid: 8, // fewer scored taps than this = test failed
};

export const METRICS = {
  medianMs: {
    label: 'Reaction time',
    unit: 'ms',
    digits: 0,
    worse: 'higher',
    explain: 'Typical time from green to tap (the median). Lower is faster.',
    rate: (v) => (v <= 330 ? 'good' : v <= 420 ? 'ok' : 'poor'),
  },
  spreadMs: {
    label: 'Consistency',
    unit: 'ms',
    digits: 0,
    worse: 'higher',
    explain: 'How much your times varied (middle half of taps). Lower is steadier.',
    rate: (v) => (v <= 60 ? 'good' : v <= 110 ? 'ok' : 'poor'),
  },
  mistakes: {
    label: 'Mistakes',
    unit: '',
    digits: 0,
    worse: 'higher',
    explain: 'Taps before green, plus greens missed completely. Lower is better.',
    rate: (v) => (v <= 1 ? 'good' : v <= 3 ? 'ok' : 'poor'),
  },
};

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function randomDelay() {
  return REACTION.minDelayMs + Math.random() * (REACTION.maxDelayMs - REACTION.minDelayMs);
}

// times: scored reaction times (ms); falseStarts, lapses: counts.
export function computeReaction(times, falseStarts, lapses) {
  if (times.length < REACTION.minValid) {
    return { ok: false, reason: 'Not enough taps landed on green to score the test.' };
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    ok: true,
    metrics: {
      medianMs: quantile(sorted, 0.5),
      spreadMs: quantile(sorted, 0.75) - quantile(sorted, 0.25),
      mistakes: falseStarts + lapses,
    },
    times,
    falseStarts,
    lapses,
  };
}
