# Baseline

A browser-based sideline concussion screen that compares each athlete to their own healthy baseline.

**[Live demo](https://baselinetest.web.app)** · **[Short demo run (?quick)](https://baselinetest.web.app/?quick)**

Built for **Dream Team Engineering Designathon 2026 — Software track**: a technology-based solution addressing a health-related challenge in sports, physical activity, or athletic participation.

## The problem

- After a hit, a sideline coach needs a clear way to identify changes that warrant medical evaluation.
- An athlete's usual performance matters: the same score can mean different things for different people.
- Baseline tests and post-hit checks need to be accessible on ordinary phones and laptops, with results available to the athlete and coach.

## What it does

Athletes record healthy baseline trials, then repeat the tests after a hit. Baseline compares the new measurements with that athlete's saved baseline and produces **Normal**, **Monitor**, or **Remove from play and refer**.

| Test | Device and procedure | Measurements |
|---|---|---|
| Balance | Phone motion sensor; phone against chest, eyes closed, three 20-second stances: feet together, single leg, heel-to-toe | Average sway, single-leg sway, detected stumbles plus examiner-counted errors |
| Reaction time | Phone or laptop; tap when the target turns green, with 3 practice and 15 scored trials | Median response time, spread of response times, early taps and missed signals |
| Eye pursuit | Webcam or front camera; MediaPipe tracks eye landmarks through calibration and a moving-target task | Time on target, pursuit gain, catch-up saccade rate, lag; tracking error is stored but not scored |

The phone eye-test variant, **`eyePhone`**, has its own baseline, separate from laptop **`eye`**, because camera, screen size, and viewing distance differ.

**Run all three** guides the athlete through reaction, eyes, then balance, with a combined save step and overall call. Spoken instructions are available for reaction and eyes and automatic for balance; beeps and vibration provide additional cues where supported. Individual tests are also available.

Dashboards show baseline progress and trends. History includes saved results, deletion, and CSV export; coaches can export the team's results. Baseline completion is marked at four trials per test: the first is practice and is not scored (the first attempt at an unfamiliar test is usually the worst), and scoring can use fewer.

## Roles and privacy

Coaches create teams. Athletes join with a six-character code or a QR invite opening `?join=CODE`; the invite survives signup so they do not need to retype it.

| Capability | Athlete | Coach |
|---|---|---|
| Record a baseline | Own baseline only | Cannot record athletes' baselines |
| Run a post-hit check | Self or any teammate | Any athlete on the team |
| View saved scores, trends, and history | Own results only | Everyone on the team |
| Delete results | Own results | Any result on the team |
| Medical history (prior concussions, ADHD, vision, balance problems) | Enter and edit their own | See each athlete's, beside their results |
| Manage membership | Leave the team | Invite or remove athletes |

A teammate running a check sees **only the call and action, never the athlete's numerical results in the UI**. The testing device processes the new measurements and judges them against published baseline cutoffs in `teams/{id}/ranges`. These documents contain cutoffs and baseline trial counts, not trial results. The new result is saved for the athlete and coach; the teammate cannot read it back.

[Firestore rules](firestore.rules) enforce result access, baseline ownership, allowed fields, and deletion rights. Athletes query only their own trials; coaches can query the team's trials. Team members can read the roster and published ranges. This protects stored results, but the tester's device still handles the current measurement and computes its status.

Coaches receive in-app alerts for checks run by others that return Monitor, Refer, or No baseline. Optional browser notifications work while the app is open, including in a background tab.

A consent screen explains screening limits and data use before first use, records `consentedAt`, and asks for parent or guardian agreement for users under 18. The privacy notice remains accessible from the footer. Only final scores are saved: **no video or raw sensor recordings are uploaded**. Leaving or removing an athlete does not delete their results; full account deletion is not a self-service feature.

## How scoring works

[shared/assess.js](shared/assess.js) defines the metric directions, baseline summaries, published cutoffs, and per-test decisions.

1. Compute each metric's mean and sample standard deviation across saved baseline trials, dropping the oldest as practice once more than three are on file.
2. Use an effective spread equal to the largest of the standard deviation, 10% of the absolute mean, the metric's floor, and a tiny numerical floor (`1e-9`). Error and mistake counts have a spread floor of 1.
3. Flag a metric only when it is more than **2 spreads worse** than the mean: above `mean + 2 × spread` for higher-is-worse metrics, or below `mean - 2 × spread` for lower-is-worse metrics.

| Flagged metrics in one test | Call |
|---|---|
| 0 | Normal |
| 1 | Monitor |
| 2 or more | Remove from play and refer |

The [overall call](src/lib/status.js) is Refer if any included test is Refer or at least two tests are Monitor; one Monitor yields Monitor. Otherwise it is Normal. A check without a baseline is stored as `no-baseline`, instructs removal from play, and counts as Refer overall. There is no team-average fallback. Missing or non-finite metric values are skipped during comparison.

**This is a screening tool, not a diagnosis. The cutoffs are not clinically validated yet.** A normal result cannot rule out concussion or clear an athlete to return to play. Anyone with a suspected concussion should be removed from play and evaluated by a clinician regardless of the app's call. A clinical validation study is the next step.

### How often a healthy athlete gets flagged

With only a few baseline trials the sample SD is a rough estimate, so "2 spreads worse than baseline" fires on healthy athletes more often than 2 SD suggests. Simulated with the app's own spread rule (`node scripts/falsepositives.mjs`), eight scored metrics, and a healthy athlete:

| Metric's real trial-to-trial variation | 3 baseline trials: any flag / "refer" | 5 trials: any flag / "refer" |
|---|---|---|
| 5% of its mean | 0.4% / 0% | 0.2% / 0% |
| 10% | 26% / 3% | 21% / 2% |
| 20% | 54% / 17% | 42% / 9% |
| 30% | 59% / 20% | 44% / 10% |

The 10%-of-mean floor on the spread handles steady metrics; for noisy ones (sway, balance errors, saccade rate, reaction spread are likely in the 20–30% band) the false "refer" rate with three baselines is around one in six. Two levers, both deliberate decisions about sensitivity versus false alarms rather than code fixes: record five baseline trials instead of three (roughly halves it), or scale the spread by a small-sample factor in `spreadFor` (a *t*-based prediction interval; makes three-trial baselines much less sensitive). Measure the real rate with healthy retests before choosing.

## Testing protocol (and why)

Every result is compared to the athlete's **own baseline**, so anything that differs between the baseline and the check can look like a concussion. The protocol keeps conditions the same, and the app enforces or records what it can.

**Set up a testing station.** A shaded, quiet spot with a firm floor and the athlete's back to the field: behind the bench or in the medical tent. They aren't watching the game, there's no crowd in the camera's view, and the light is consistent. **Record baselines in the same kind of spot**, on the same type of device.

**Before every test the app asks five questions** ([ConditionsGate](src/components/ConditionsGate.jsx)), and saves the answers with each result:

| Question | Why it matters | What the app does |
|---|---|---|
| Rested 15+ min since playing? | Hard exercise alone degrades balance and reaction time for about 15–20 minutes (documented for the BESS balance test). An athlete pulled straight off the field looks impaired because they just sprinted. | Offers a 15-minute rest timer; a baseline taken without rest gets a redo prompt. |
| Quiet spot or loud sideline? | Noise distracts the athlete and can drown out audio cues. Noise doesn't affect the camera model. | Suggests moving behind the bench or into the tent. |
| Indoors, shade, or direct sun? | Sun washes out the reaction screen and puts the face in shadow (bad for eye tracking). | Suggests moving into shade. |
| Overheated, or no water in the last hour? | Heat and dehydration slow thinking and balance on their own. | Suggests water and shade first; a baseline taken that way gets a redo prompt. |
| Any other injury or pain right now? | Pain, a limp, or fear of an injury makes every test worse, and it isn't concussion. | Noted with the result; a baseline taken that way gets a redo prompt. |

The device type (phone or laptop) is saved too. Flagged conditions show as tags in History and as columns in the CSV export, so we can later check which confounds actually moved the numbers.

**Eye test camera checks** (before Start): one face in view (the model is asked for two faces so it can notice a bystander, and refuses to start if there are two), close enough to the camera, face well lit and not backlit, camera steady (propped up, not hand-held), facing the screen, and eyes open. A second face appearing mid-test triggers a "retest" warning.

**Balance cues:** the phone is pressed to the chest, so on phones that can vibrate a long buzz means "close your eyes" and three short pulses mean "open them", with the beep and voice as backup. iPhone browsers don't support the vibration API; on iOS 18+ the app uses an unofficial workaround (toggling a hidden switch control, which plays a real haptic tick), so iPhones get a lighter tapping buzz. Because that could stop working in a future iOS, sound stays the main cue on iPhones: volume up, Silent mode and Do Not Disturb off.

**Baseline sanity checks** ([lib/validity.js](src/lib/validity.js)): a baseline far worse than a healthy athlete usually scores (very slow reactions, eyes not keeping up with the dot, many balance errors) gets a "redo?" prompt before saving. A poor baseline, whether from a bad setup or deliberately doing badly ("sandbagging", a known problem with baseline tests), makes later checks look fine. The cutoffs are generous starting points to be tuned with volunteer data.

**Pre-existing conditions** (prior concussions, ADHD, vision problems, vestibular or balance problems) shift what a normal result looks like and how long recovery takes. Athletes record them on the Team tab ([MedicalHistory](src/components/MedicalHistory.jsx)); the coach sees them beside that athlete's results. They are private to the athlete and the coach (`teams/{id}/history/{uid}`), never on the roster teammates can read.

**Practice effects:** the first baseline trial is usually the worst, and a bad first trial widens the baseline's spread and hides a later deficit. Four baseline trials are recorded and the oldest is dropped as practice (`summarize` in [shared/assess.js](shared/assess.js)); an older three-trial baseline keeps all three.

**Other confounds to watch for** (not yet measured by the app): sleep, caffeine, medication, and age (re-baseline every season).

## Tech stack

- **React + Vite** for the interface and build.
- **MediaPipe FaceLandmarker**, a pretrained model running in the browser, for camera-based eye landmarks; the model and WebAssembly assets are served with the app.
- **DeviceMotion API** for balance sensing; browser speech, audio, and vibration APIs for cues.
- **Firebase Authentication** with email/password and password reset; **Firestore** for live results and persistent offline cache; **Firebase Hosting** for deployment.
- **Installable PWA** with a manifest and production service worker that caches the app shell and fetched assets. Firestore separately caches data and queues writes for later sync.
- **No custom backend server or deployed scoring function**: measurement and scoring run on the client.

Offline use depends on a previous online visit, cached assets/data, and an existing session. Camera assets are cached when fetched; a first visit or account setup needs connectivity. Results are stored in Firestore, not solely in browser storage.

## Data model

Fields and permissions are defined in the header and validators of [firestore.rules](firestore.rules). Email/password credentials are managed by Firebase Auth.

```text
users/{uid}
  role: coach | athlete (immutable), name, teamId: string | null
  consentedAt?: ISO timestamp
joinCodes/{code}
  teamId                         # signed-in single-code lookup; no listing
teams/{id}
  name, coachUid, coachName, code, createdAt
  members/{uid}
    name, code, joinedAt
  trials/{trialId}
    subjectUid, testerUid, test, kind: baseline | check, at, metrics
    status: normal | monitor | refer | no-baseline   # checks only
    conditions?: { rested: bool, place: quiet | sideline,
                   light: indoor | shade | sun, device: phone | laptop,
                   heat: bool, pain: bool }
  history/{uid}                  # athlete + coach only; not on the roster
    concussions: 0-20, adhd, vision, vestibular: bool, updatedAt
  ranges/{subjectUid}_{test}
    subjectUid, test, n
    limits: { metric: { worse: higher | lower, limit: number } }
```

`test` is `balance`, `reaction`, `eye`, or `eyePhone`. Timestamps are ISO strings. Trial metric values are bounded numbers or `null` when unavailable:

| Test | Exact `metrics` fields |
|---|---|
| `balance` | `sway`, `singleSway`, `errors` |
| `reaction` | `medianMs`, `spreadMs`, `mistakes` |
| `eye`, `eyePhone` | `onTarget`, `gain`, `saccadeRate`, `lagMs`, `trackingError` |

## Running locally

Use Node.js/npm compatible with Vite 8. Copy `.env.example` to `.env.local` and fill in the Firebase web config. Ask a teammate for the values or retrieve them with an authorized Firebase CLI session:

```bash
firebase apps:sdkconfig WEB --project dte-hackathon
npm install
npm run dev
```

`npm install` also copies MediaPipe WebAssembly files into `public/`. The face model is in `public/models/`. The default local URL is `http://localhost:5173`.

For phone sensors and camera testing on the same LAN:

```bash
npm run dev:phone
```

Open the HTTPS network URL printed by Vite on the phone and accept the local development certificate if prompted. Grant camera/motion permissions as requested; phone mode uses a self-signed HTTPS certificate.

For logged-in screen previews without an account, development builds expose the **`__previewSession`** browser-console hook from [src/lib/session.js](src/lib/session.js). It accepts a partial session state with mock profile, team, and `Map` data. This changes local UI state only; it does not authenticate Firebase writes and is omitted from production builds.

```bash
npm test                       # eye-pursuit metrics on synthetic recordings with known lag and gain
node scripts/falsepositives.mjs  # how often the scoring rule flags a healthy athlete
```

### Deployment

The rules are part of the app: a change to `firestore.rules` (allowed condition keys, the `history` collection) must be deployed with `firebase deploy --only firestore:rules` before, or together with, the hosting build that uses it. Until then the app's fallback saves results without the conditions tag and medical history cannot be saved.

With Firebase CLI access to the project:

```bash
npm run build
firebase deploy --only hosting
```

When Firestore rules change, publish them separately:

```bash
firebase deploy --only firestore:rules
```

[firebase.json](firebase.json) serves `dist/` on the `baselinetest` Hosting site, rewrites routes to `index.html`, and points to `firestore.rules`.

## Code layout

```text
src/
  App.jsx                  Authentication/consent gates and role-specific navigation
  main.jsx                 React entry, invite capture, production service worker
  brand.jsx, styles.css    Branding and responsive styles
  pages/
    AuthScreen.jsx         Email/password signup, login, password reset
    Setup.jsx, Team.jsx    Profiles, team setup, roster, invitations, membership
    Overview.jsx           Dashboard, trends, baseline progress, test guide
    RunTest.jsx, Flow.jsx   Individual test selection and guided three-test flow
    History.jsx            Saved results, deletion, CSV download
    Privacy.jsx            Consent screen and privacy notice
  tests/
    registry.js            Test definitions and phone/laptop eye result variants
    balance/               Motion capture, stance scoring, test UI
    reaction/              Tap timing, reaction metrics, test UI
    eye/                   Camera landmarks, calibration, pursuit scoring, plots
  lib/
    firebase.js            Firebase initialization and offline persistence
    session.js             Live state, team/trial writes, published cutoffs
    baseline.js, status.js  Baseline comparisons, CSV export, overall calls
    alerts.js, invite.js    Coach alert grouping and join-link handling
    cues.js, focus.js       Speech/audio/vibration and test focus behavior
  components/              Result cards, trends, alerts, QR codes, shared UI
shared/
  assess.js                Shared scoring definitions and cutoff calculation
```

## Next steps and limitations

- **Clinical validation:** measure repeatability and compare screening calls with clinician assessments before claiming diagnostic accuracy or effectiveness.
- **Trusted scoring:** move teammate-check scoring to a Cloud Function so a tampered phone cannot submit a fabricated status. Current rules validate access and data shape, not the calculation.
- **Multiple teams per athlete/coach (in progress):** the current schema and rules support one team per account.
- **Measurement quality:** device latency, lighting, head motion, sensor support, fatigue, and test setup can affect results. Keep baseline and check conditions consistent. Skipped tests or missing metrics reduce what the overall call covers.
