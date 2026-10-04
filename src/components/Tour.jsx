import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dot } from './Mascot.jsx';

// Guided tour: dims the page, spotlights one part of the app at a time, and
// explains it in a card, with Dot as the guide. Steps can switch tabs first.
// Started from the Tutorial button, and once automatically for new users.

// target: a [data-tour="..."] name, or none for a centered card.
const STEPS = {
  coach: [
    { title: 'Hi, I’m Dot!', body: 'I’ll show you around in under a minute. You can skip any time.' },
    { tab: 'roster', target: 'home-cta', title: 'Someone took a hit?', body: 'Start here. Run a check and we’ll guide you through each test, then give you a clear call: normal, monitor, or refer.' },
    { tab: 'roster', target: 'stats', title: 'Your team at a glance', body: 'How many athletes have baselines, who was checked this week, and who needs attention.' },
    { tab: 'roster', target: 'roster', title: 'Your roster', body: 'Flagged players come first. Tap anyone to see their dashboard and history.' },
    { tab: 'test', target: 'people', title: 'Run a check', body: 'Pick who you’re testing, then run all three tests in a row or just one.' },
    { tab: 'team', target: 'team-code', title: 'Invite your athletes', body: 'Athletes scan this QR code or type the team code to join. They record their own healthy baselines.' },
    { tab: 'learn', target: 'learn-tabs', title: 'Learn more', body: 'What each test measures, how to get a clean result, and how the call is made.' },
    { target: 'tutorial', title: 'That’s it!', body: 'Come back to this tour any time with the Tutorial button.' },
  ],
  athlete: [
    { title: 'Hi, I’m Dot!', body: 'I’ll show you around in under a minute. You can skip any time.' },
    { tab: 'me', target: 'dash-header', title: 'Your dashboard', body: 'Start by recording your baseline while you’re healthy: run all three tests, three times.' },
    { tab: 'me', target: 'test-grid', title: 'Each test', body: 'Your baseline progress and results for balance, reaction time, and eye tracking.' },
    { tab: 'test', target: 'people', title: 'Test yourself or a teammate', body: 'Test yourself for baselines. After a hit, test a teammate: you’ll see what to do, never their numbers.' },
    { tab: 'history', target: 'history', title: 'Your history', body: 'Every result you’ve saved, newest first.' },
    { tab: 'team', target: 'history-form', title: 'Medical history', body: 'Prior concussions and conditions like ADHD change what normal looks like. Only you and your coach see this.' },
    { tab: 'learn', target: 'learn-tabs', title: 'Learn more', body: 'What each test measures and how to get a clean result.' },
    { target: 'tutorial', title: 'That’s it!', body: 'Come back to this tour any time with the Tutorial button.' },
  ],
};

const PAD = 8; // spotlight padding around the target

export default function Tour({ role, setTab, onClose }) {
  const steps = STEPS[role] ?? STEPS.athlete;
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState(null); // highlighted box, kept inside the window
  const [ready, setReady] = useState(false); // target found and measured for this step
  const [cardPos, setCardPos] = useState(null);
  const cardRef = useRef(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  // Pages normally slide in on tab change; hold them still during the tour so
  // the highlight is measured where things actually end up.
  useEffect(() => {
    document.documentElement.classList.add('touring');
    return () => document.documentElement.classList.remove('touring');
  }, []);

  // The tour is an overlay, not a page. Keep swipes and mouse-wheel scrolling
  // inside its card so a phone never moves the dashboard behind the prompt.
  const blockBackgroundScroll = (event) => {
    if (!cardRef.current?.contains(event.target)) event.preventDefault();
  };

  // The target's box plus padding, clipped to the window so a tall section
  // doesn't send the highlight off-screen.
  const measure = () => {
    const el = step.target && document.querySelector(`[data-tour="${step.target}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const top = Math.max(8, r.top - PAD);
    const left = Math.max(8, r.left - PAD);
    const bottom = Math.min(window.innerHeight - 8, r.bottom + PAD);
    const right = Math.min(window.innerWidth - 8, r.right + PAD);
    return { top, left, width: right - left, height: bottom - top };
  };

  // New step: switch tab, wait for the target to render, scroll it into view,
  // then measure. Nothing is shown in between, so nothing jumps around.
  useEffect(() => {
    if (step.tab) setTab(step.tab);
    setReady(false);
    setSpot(null);
    setCardPos(null);
    if (!step.target) {
      setReady(true);
      return undefined;
    }
    let tries = 0;
    let timer;
    const find = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) {
        if (tries++ < 30) timer = setTimeout(find, 50);
        else setReady(true); // never appeared: show the card centered instead
        return;
      }
      const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
      el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'instant' });
      // measure once the scroll has been applied
      timer = setTimeout(() => {
        setSpot(measure());
        setReady(true);
      }, 30);
    };
    timer = setTimeout(find, 40);
    return () => clearTimeout(timer);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the target if the window is resized or scrolled.
  useEffect(() => {
    if (!step.target || !ready) return undefined;
    const update = () => setSpot(measure());
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [i, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Place the card using its real size: below the highlight if it fits,
  // else above, else pinned to the bottom of the window. Always fully on
  // screen.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !ready) return;
    if (!spot) { setCardPos(null); return; }
    const h = card.offsetHeight, w = card.offsetWidth, gap = 14, m = 16;
    const vh = window.innerHeight, vw = window.innerWidth;
    let top;
    if (vh - (spot.top + spot.height) >= h + gap + m) top = spot.top + spot.height + gap;
    else if (spot.top >= h + gap + m) top = spot.top - gap - h;
    else top = vh - h - m;
    const left = Math.min(Math.max(m, spot.left + spot.width / 2 - w / 2), vw - w - m);
    setCardPos({ top: Math.round(top), left: Math.round(left) });
  }, [spot, ready, i]);

  useLayoutEffect(() => { if (ready) cardRef.current?.focus(); }, [i, ready]);

  // Keyboard: arrows move, Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && !last) setI((n) => n + 1);
      else if (e.key === 'ArrowLeft' && i > 0) setI((n) => n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, last, onClose]);

  const centered = ready && !spot;
  const placed = ready && (centered || cardPos);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
      onTouchMove={blockBackgroundScroll} onWheel={blockBackgroundScroll}>
      {spot ? (
        <div key={i} className="tour-spot" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        key={`card-${i}`}
        className={`tour-card ${centered ? 'centered' : ''}${i === 0 ? ' tour-welcome' : ''}`}
        style={{ ...(cardPos && !centered ? cardPos : {}), visibility: placed ? 'visible' : 'hidden' }}
        ref={cardRef}
        tabIndex={-1}
      >
        <div className="tour-head">
          <svg viewBox="44 58 152 142" className="tour-dot" aria-hidden="true" shapeRendering="geometricPrecision">
            <Dot arms={i === 0 || last ? 'wave' : 'rest'} />
          </svg>
          <div>
            <p className="eyebrow">{i === 0 ? 'Welcome to Baseline' : `Step ${i + 1} of ${steps.length}`}</p>
            <h2 id="tour-title">{step.title}</h2>
          </div>
        </div>
        <p className="tour-body" id="tour-body">{step.body}</p>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((_, n) => <i key={n} className={n === i ? 'on' : n < i ? 'done' : ''} />)}
        </div>
        <div className="tour-actions">
          <button className="ghost small-btn" onClick={onClose}>{last ? 'Close' : 'Skip tour'}</button>
          <span className="grow" />
          {i > 0 && <button className="small-btn" onClick={() => setI(i - 1)}>Back</button>}
          <button className="primary small-btn" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'Done' : i === 0 ? 'Show me' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Has this person already seen the tour on this device?
const seenKey = (uid) => `tour-seen:${uid}`;
export function tourSeen(uid) {
  try { return !!localStorage.getItem(seenKey(uid)); } catch { return true; }
}
export function markTourSeen(uid) {
  try { localStorage.setItem(seenKey(uid), '1'); } catch { /* private mode */ }
}
