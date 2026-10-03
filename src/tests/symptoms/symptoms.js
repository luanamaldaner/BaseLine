// Symptom checklist in the SCAT format: 22 symptoms, each rated 0 (none) to
// 6 (severe). Scores: number of symptoms (0-22) and total severity (0-132).

export const SYMPTOMS = [
  'Headache',
  'Pressure in head',
  'Neck pain',
  'Nausea or vomiting',
  'Dizziness',
  'Blurred vision',
  'Balance problems',
  'Sensitivity to light',
  'Sensitivity to noise',
  'Feeling slowed down',
  'Feeling like "in a fog"',
  'Don\'t feel right',
  'Difficulty concentrating',
  'Difficulty remembering',
  'Fatigue or low energy',
  'Confusion',
  'Drowsiness',
  'More emotional',
  'Irritability',
  'Sadness',
  'Nervous or anxious',
  'Trouble falling asleep',
];

export const SCALE = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Mild' },
  { value: 3, label: 'Moderate' },
  { value: 4, label: 'Moderate' },
  { value: 5, label: 'Severe' },
  { value: 6, label: 'Severe' },
];

export const METRICS = {
  count: {
    label: 'Symptoms',
    unit: 'of 22',
    digits: 0,
    worse: 'higher',
    // Baselines are often 0 every time; flag 2+ new symptoms, not 1.
    minSpread: 0.5,
    explain: 'How many symptoms were reported at all. Lower is better.',
    rate: (v) => (v === 0 ? 'good' : v <= 2 ? 'ok' : 'poor'),
  },
  severity: {
    label: 'Severity',
    unit: 'of 132',
    digits: 0,
    worse: 'higher',
    minSpread: 1.5,
    explain: 'All ratings added up. Lower is better.',
    rate: (v) => (v <= 2 ? 'good' : v <= 8 ? 'ok' : 'poor'),
  },
};

export function scoreSymptoms(ratings) {
  const values = SYMPTOMS.map((s) => ratings[s] ?? 0);
  return {
    count: values.filter((v) => v > 0).length,
    severity: values.reduce((a, b) => a + b, 0),
  };
}
