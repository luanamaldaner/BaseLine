// How often a HEALTHY athlete gets flagged by the scoring rule in
// shared/assess.js ("worse than 2 spreads from your own baseline", with
// spread = max(sample SD, 0.1 * |mean|, minSpread)), as a function of how many
// baseline trials were recorded and how noisy the metric is.
// Run: node scripts/falsepositives.mjs
//
// The 10%-of-mean floor caps the damage when a few baseline trials happen to
// land close together and the sample SD comes out tiny; it does nothing for
// metrics whose real variation is larger than that.
function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const RUNS = 300000;
const MIN_REL_SD = 0.1;
console.log('true CV = the metric\'s real trial-to-trial variation as a fraction of its mean');
console.log('');
console.log('true CV | n | P(one metric flags) | P(>=1 of 8) | P(>=2 of 8) = "refer"');
console.log('--------|---|---------------------|-------------|----------------------');
for (const cv of [0.05, 0.1, 0.2, 0.3]) {
  for (const n of [3, 5]) {
    let flags = 0;
    for (let r = 0; r < RUNS; r++) {
      const mean = 100, sd = cv * 100;
      const xs = Array.from({ length: n }, () => mean + sd * gauss());
      const m = xs.reduce((a, b) => a + b, 0) / n;
      const s = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (n - 1));
      const spread = Math.max(s, MIN_REL_SD * Math.abs(m));
      const x = mean + sd * gauss();
      if ((x - m) / spread > 2) flags++;
    }
    const p = flags / RUNS;
    const none = (1 - p) ** 8, one = 8 * p * (1 - p) ** 7;
    console.log(
      `${String(cv).padStart(7)} | ${n} | ${(p * 100).toFixed(1).padStart(18)}% | ${((1 - none) * 100).toFixed(1).padStart(10)}% | ${((1 - none - one) * 100).toFixed(1).padStart(10)}%`,
    );
  }
}
