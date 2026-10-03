import { useEffect, useRef, useState } from 'react';
import { REST_MINUTES, deviceType } from '../lib/conditions.js';
import { beep, buzz } from '../lib/cues.js';

// "Before you start": three quick taps about rest, place, and light, so a
// check is run in conditions that match the baseline. Calls onReady with the
// answers, which are saved with every result.
//
// kind: 'check' (post-hit) or 'baseline' (wording only).
export default function ConditionsGate({ kind, onReady, onBack }) {
  const [rested, setRested] = useState(null);
  const [place, setPlace] = useState(null);
  const [light, setLight] = useState(null);
  const [heat, setHeat] = useState(null);
  const [pain, setPain] = useState(null);
  const [timerEnd, setTimerEnd] = useState(null);
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const done = rested !== null && place && light && heat !== null && pain !== null;
  const ready = () => onReady({ rested, place, light, heat, pain, device: deviceType() });

  if (timerEnd) {
    return (
      <RestTimer
        end={timerEnd}
        onDone={() => { setTimerEnd(null); setRested(true); }}
        onSkip={() => setTimerEnd(null)}
        onCancel={() => setTimerEnd(null)}
      />
    );
  }

  return (
    <section className="gate-before panel">
      <p className="eyebrow">Before you start</p>
      <h2 ref={headingRef} tabIndex={-1}>Set up for a fair comparison</h2>
      <p className="muted">
        Results are compared to the athlete’s own baseline, so test in the same kind of
        conditions every time: a quiet, shaded spot with their back to the field.
      </p>

      <Question
        label={`Has the athlete rested at least ${REST_MINUTES} minutes since playing or exercising?`}
        value={rested}
        onChange={setRested}
        options={[[true, 'Yes, rested'], [false, 'No, just came off']]}
      />
      {rested === false && (
        <div className="callout warn">
          Hard exercise alone makes balance and reaction time worse for {REST_MINUTES}–20 minutes, which
          can look like a concussion.{' '}
          {kind === 'check' && 'If you suspect a concussion, keep them out of play while they rest.'}
          <div className="row">
            <button className="small-btn" onClick={() => setTimerEnd(Date.now() + REST_MINUTES * 60_000)}>
              Start a {REST_MINUTES}-minute rest timer
            </button>
          </div>
        </div>
      )}

      <Question
        label="Where are you testing?"
        value={place}
        onChange={setPlace}
        options={[['quiet', 'Quiet spot'], ['sideline', 'Loud sideline']]}
      />
      {place === 'sideline' && (
        <p className="hint">If you can, move behind the bench or into the medical tent, facing away from the game.</p>
      )}

      <Question
        label="What’s the light like?"
        value={light}
        onChange={setLight}
        options={[['indoor', 'Indoors'], ['shade', 'Shade'], ['sun', 'Direct sun']]}
      />
      {light === 'sun' && (
        <p className="hint">Sun washes out the screen and puts the face in shadow. Move into shade if you can.</p>
      )}

      <Question
        label="Overheated, or no water in the last hour?"
        value={heat}
        onChange={setHeat}
        options={[[false, 'No, fine'], [true, 'Yes']]}
      />
      {heat === true && (
        <p className="hint">Heat and dehydration slow thinking and balance on their own. Water and shade first, if you can.</p>
      )}

      <Question
        label="Any other injury or pain right now?"
        value={pain}
        onChange={setPain}
        options={[[false, 'No'], [true, 'Yes']]}
      />
      {pain === true && (
        <p className="hint">Pain, a limp, or worry about an injury makes every test worse. It gets noted with the result; it isn’t concussion.</p>
      )}

      <div className="row">
        <button className="primary big-btn" disabled={!done} onClick={ready}>Continue</button>
        {onBack && <button className="ghost" onClick={onBack}>Back</button>}
      </div>
      {done && rested === false && <p className="muted small">Continuing anyway: this will be noted with the results.</p>}
    </section>
  );
}

function Question({ label, value, onChange, options }) {
  return (
    <fieldset className="question">
      <legend>{label}</legend>
      <div className="choices">
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v}
            onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RestTimer({ end, onDone, onSkip, onCancel }) {
  const [now, setNow] = useState(Date.now());
  const left = Math.max(0, end - now);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (left === 0) {
      beep(880, 300);
      buzz([400, 150, 400]);
    }
  }, [left === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <section className="gate-before panel rest-timer">
      <p className="eyebrow">Rest</p>
      <h2>Sit them down in the shade</h2>
      <div className="rest-count" role="timer" aria-live="off">{m}:{String(s).padStart(2, '0')}</div>
      <p className="muted">Water, no screens, no running around. We’ll beep when it’s time.</p>
      <div className="row">
        <button className="primary big-btn" disabled={left > 0} onClick={onDone}>Rested, continue</button>
        <button className="ghost" onClick={onSkip}>Stop the timer early</button>
      </div>
    </section>
  );
}
