# Dream Team Engineering - Software Track

# Baseline
*A free, browser-based concussion screen that compares each athlete to their own healthy self.*

**Prompt:** Develop a technology-based solution that addresses a health-related challenge in sports, physical activity, or athletic participation.

## Problem
- The CDC estimates **1.6–3.8 million** sports and recreation concussions in the US every year, and many go unreported or are never assessed.
- Many high schools and most youth leagues have **no athletic trainer** on the sideline, so a volunteer coach makes the return-to-play call by eye.
- Validated tools exist, but they need trained staff (SCAT6), a paid subscription (Sway), or dedicated eye-tracking hardware costing thousands of dollars (EyeBOX).

## Users and buyers
- **Users:** youth and high school coaches, parents.
- **Buyers:** school districts, club leagues, state athletic associations, youth sports insurers.

## How it works
1. **Preseason:** each athlete records a baseline in about 5 minutes (1 practice run + 2–3 recorded trials, averaged, with the natural spread saved).
2. **After a hit:** the coach runs the same 5-minute check on the sideline.
3. **Result:** 🟢 normal · 🟡 monitor · 🔴 remove from play and refer to a clinician.

## Tests
| Test | Device | Measures |
|---|---|---|
| **Symptom checklist** | Phone | 22 standard symptoms rated 0–6 (SCAT format) |
| **Balance** | Phone motion sensor, held to chest | Sway in 3 stances (feet together, single leg, heel-to-toe), 20 s each, eyes closed |
| **Reaction time** | Phone screen | Median and spread of tap delays over 15 randomly timed trials |
| **Eye pursuit** | Laptop or phone front camera | Tracking error, pursuit gain, and catch-up saccades while following a moving dot |

**Why these go together:** concussion presents differently in different athletes: some mainly show balance deficits, others eye-movement or reaction deficits. Clinical tools (SCAT6, VOMS) test several domains for this reason, and balance and eye control share the vestibular system.

**Scoring:** each metric is compared to the athlete's own baseline. A result more than 2 standard deviations worse is flagged. One flag → 🟡 monitor. Two or more flags, or significant symptoms → 🔴 remove and refer.

## Baseline protocol
- Record preseason, healthy and rested (no hard exercise right before). Re-record each season.
- Standardized setup: same device type, face ~50 cm from camera, good lighting, same dot path and speed; phone flat against chest for balance; shoes off, firm floor.
- 1 practice run, then 2–3 recorded trials; store mean + standard deviation per metric.
- Quality checks: retest if the face is lost in >15% of frames; drop blink frames; flag balance trials with a step or fall.
- No baseline on file → compare to team averages with a "low confidence" label.

## Novelty
- Smooth-pursuit eye testing with an ordinary camera instead of dedicated hardware.
- Multiple domains in one 5-minute check; most free tools test only one.
- No install, no hardware: a web link built for sidelines without a medical professional.

## Tech
- React web app, deployed on Vercel (HTTPS is required for camera and motion sensors).
- **Google MediaPipe FaceLandmarker** (pretrained, no training needed): 478 face landmarks including iris centers and eye corners.
- Browser DeviceMotion API for balance.
- Local storage for baselines; no backend.
- Our work is the measurement layer: iris-position signal, calibration (simple regression from a few fixation points), pursuit and sway metrics, baseline comparison.

## Running it
First copy `.env.example` to `.env.local` and fill in the Firebase web config (ask a
teammate, or run `firebase apps:sdkconfig WEB --project dte-hackathon`).

```bash
npm install          # also copies MediaPipe's wasm into public/
npm run dev          # http://localhost:5173 (laptop webcam)
npm run dev:phone    # HTTPS on your LAN, for testing sensors/camera on a phone
```
The face model ships in `public/models/`, so the app works offline.

## Code layout
```
src/App.jsx                  name gate + tabs (Overview, 4 tests, History)
src/pages/Overview.jsx       dashboard: overall status, per-test cards + trends, test guide
src/pages/History.jsx        every saved result by date/time, delete, CSV export
src/tests/registry.js        one entry per test: metrics, headline metric, what it's for
src/lib/baseline.js          storage, baseline mean/SD, comparison, CSV export
src/lib/status.js            combines per-test results into one overall call
src/components/              ResultCards, SaveTrial, Trend
src/tests/symptoms/          22-symptom checklist, 0-6 each (SCAT format)
src/tests/balance/           3 stances x 20 s, eyes closed, phone accelerometer + examiner errors
src/tests/reaction/          3 practice + 15 scored taps
src/tests/eye/               webcam iris tracking, smooth-pursuit metrics
```

## Where data is stored
In the browser's localStorage on the device running the app. Nothing is uploaded, so
each phone/laptop has its own records and clearing browser data erases them. The
History tab exports CSV (one athlete or all) for backups and analysis.

## Adding a test
1. Build the UI in `src/tests/<name>/`. Produce one flat object of numbers per trial, e.g. `{ medianMs: 284, iqrMs: 41 }`.
2. Export a spec saying which direction is worse, plus a plain-English `explain` and optional `rate(value)` guide:
   `{ medianMs: { label: 'Median RT', unit: 'ms', worse: 'higher', digits: 0 } }`
   (`worse` is `'higher'`, `'lower'`, or `'away'` for any change from baseline).
3. Save with `addTrial(athlete, '<name>', 'baseline' | 'check', metrics)`.
4. For a check, call `compare(athlete, '<name>', metrics, spec)` **before** saving it, and render `<ResultCards metrics spec comparison />`.

See `src/tests/eye/EyeTest.jsx` for the full pattern.

## Positioning
A **screening tool, not a diagnosis**: it tells a coach without a trainer when to pull an athlete and get them seen.

## Team roles
1. **Eye tracking:** MediaPipe, calibration, pursuit metrics, eye-vs-dot graph.
2. **Balance + reaction:** sensor capture, sway and reaction metrics.
3. **App flow + UI:** profiles, baseline storage, test flow, results screen.
4. **Pitch + writeup:** 1–4 page writeup, README, repeatability data from volunteers, backup demo video.

## Timeline
| By | Done |
|---|---|
| 6 PM Sat | Symptoms + balance + reaction working end to end |
| 2 AM | Eye tracking producing the eye-vs-dot graph |
| 8 AM | All tests feed one combined result; volunteer baselines recorded |
| 10 AM | Feature freeze, writeup, backup demo video |
| 12 PM Sun | Submit on Devpost |

## Pitch (3 min)
1. **Hook:** A volunteer coach sees a kid take a hit. Should they go back in? Right now, that call is a guess.
2. **Gap:** validated tools need trainers or expensive hardware; many youth sidelines have neither.
3. **Live demo:** baseline → teammate spins ~10 times → retest → balance flag fires. Then the eye test with the eye-vs-dot graph.
4. **Proof:** test-retest repeatability across volunteers.
5. **Business + next steps:** free for teams, paid dashboards for districts and leagues; validation study against clinician assessment, then FDA clearance as a screening aid.
