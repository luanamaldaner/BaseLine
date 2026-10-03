// Every test in one place: its metrics, its headline metric for trend charts,
// and what it's for.
//
// TESTS are what you can run. RESULT_TESTS are what results are stored and
// scored under: the eye test keeps separate laptop ('eye') and phone
// ('eyePhone') baselines, so it appears twice there.

import { METRICS as BALANCE_METRICS } from './balance/balance.js';
import { METRICS as REACTION_METRICS } from './reaction/reaction.js';
import { METRICS as EYE_METRICS } from './eye/pursuit.js';
import BalanceTest from './balance/BalanceTest.jsx';
import ReactionTest from './reaction/ReactionTest.jsx';
import EyeTest from './eye/EyeTest.jsx';

export const TESTS = [
  {
    id: 'balance',
    label: 'Balance',
    Component: BalanceTest,
    metrics: BALANCE_METRICS,
    headline: 'sway',
    time: '2 min',
    device: 'Phone',
    measures: 'How steady the athlete stands with eyes closed, in three stances.',
    system: 'Inner ear (vestibular) and body-position sense',
    bestAt: 'An objective sign that is hard to fake. Balance problems are common in the first days after a concussion.',
    limits: 'Balance often recovers within a few days, so a normal result later does not mean the brain has healed. Fatigue and leg injuries also affect it.',
  },
  {
    id: 'reaction',
    label: 'Reaction time',
    Component: ReactionTest,
    metrics: REACTION_METRICS,
    headline: 'medianMs',
    time: '1 min',
    device: 'Phone or laptop',
    measures: 'How fast the brain notices a signal and responds.',
    system: 'Processing speed and attention',
    bestAt: 'Slowed thinking the athlete may not notice. In studies it can stay slow after symptoms have cleared.',
    limits: 'Different devices give different times, so always use the same kind. Sleep, effort, and practice shift it too.',
  },
  {
    id: 'eye',
    label: 'Eye pursuit',
    Component: EyeTest,
    metrics: EYE_METRICS,
    headline: 'onTarget',
    time: '1 min',
    device: 'Phone or laptop',
    variants: ['eye', 'eyePhone'],
    measures: 'How smoothly the eyes follow a moving dot.',
    system: 'Eye-movement control, closely linked to the inner ear',
    bestAt: 'Visual problems behind complaints like blurry vision or trouble reading, which symptom lists can miss. Hard to fake.',
    limits: 'A camera is noisier than a clinical eye tracker. Lighting, glasses, and head movement all affect it. Phone and laptop results are compared only to the same device.',
  },
];

const eye = TESTS.find((t) => t.id === 'eye');
export const RESULT_TESTS = [
  ...TESTS.filter((t) => t !== eye),
  { ...eye, label: 'Eye pursuit (laptop)', device: 'Laptop' },
  { ...eye, id: 'eyePhone', label: 'Eye pursuit (phone)', device: 'Phone' },
];

export const testById = Object.fromEntries(RESULT_TESTS.map((t) => [t.id, t]));
