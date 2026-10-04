// Sound, speech, and vibration cues shared by every test and the guided flow.
//
// The athlete may be young, concussed, or have their eyes closed, so the
// screen is never the only channel: every instruction is also spoken, and
// transitions get a beep and a buzz (see buzz() for iPhones).

let audioCtx = null;
let audioUnlocked = false;
let resuming = null;
let playbackSession = false;

// iOS 17+ exposes a playback session that is independent of the ringer.
// Opt in only after a user asks for sound; do not run silent media loops.
function configurePlayback() {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      playbackSession = navigator.audioSession.type === 'playback';
    }
  } catch { playbackSession = false; }
  return playbackSession;
}

function resumeAudio() {
  try {
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'running') return Promise.resolve(audioCtx);
    if (!resuming) {
      // Invoke resume synchronously inside the tap handler, before any await.
      resuming = Promise.resolve(audioCtx.resume()).then(() => audioCtx.state === 'running' ? audioCtx : null)
        .catch(() => null).finally(() => { resuming = null; });
    }
    return resuming;
  } catch { return Promise.resolve(null); }
}

export const soundSettings = () => ({ unlocked: audioUnlocked, playbackSession });

export function beep(freq = 880, ms = 180) {
  if (!audioUnlocked) return Promise.resolve(false);
  return resumeAudio().then((context) => {
    if (!context) return false;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(context.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start();
    osc.stop(context.currentTime + ms / 1000);
    return true;
  }).catch(() => false); // the screen still shows the cue
}

// Mobile browsers only allow audio after a tap; call this from a click handler
// once and later beeps work without one.
export function unlockAudio() {
  audioUnlocked = true;
  configurePlayback();
  return resumeAudio().then((context) => ({ audioStarted: !!context, playbackSession }));
}

// Call directly from a button. Speech begins within that same user gesture;
// the tone waits for AudioContext.resume so a suspended context cannot eat it.
export function checkSound() {
  const ready = unlockAudio();
  const speechAvailable = say('Sound check. Keep your media volume up.');
  return ready.then(async (settings) => ({ ...settings, audioStarted: await beep(880, 300), speechAvailable }));
}

export function say(text, { rate = 0.95 } = {}) {
  if (!audioUnlocked) return false;
  try {
    configurePlayback();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

export function hush() {
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

// Vibration. Android browsers support navigator.vibrate; iPhone browsers
// don't. Since iOS 18, though, Safari plays a real haptic "tick" from the
// Taptic Engine when a switch-style checkbox is toggled, including when its
// label is clicked from code. That's unofficial and could change in a later
// iOS, so it's only a backup: on iPhones the beep and voice stay the main cue.
let hapticLabel = null;
function iosTick() {
  try {
    if (!hapticLabel) {
      const box = document.createElement('div');
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      input.id = 'haptic-switch';
      input.tabIndex = -1;
      hapticLabel = document.createElement('label');
      hapticLabel.htmlFor = input.id;
      box.append(input, hapticLabel);
      document.body.append(box);
    }
    hapticLabel.click();
  } catch {
    /* no haptics: sound is still the cue */
  }
}

// pattern: ms, or [on, off, on, ...] like navigator.vibrate.
export function buzz(pattern) {
  if (navigator.vibrate) return navigator.vibrate(pattern);
  // iPhone: each tick is very short, so fill each "on" stretch with ticks
  // every 80 ms to make it feel like a buzz.
  const segments = Array.isArray(pattern) ? pattern : [pattern];
  let t = 0;
  segments.forEach((ms, i) => {
    if (i % 2 === 0) for (let k = 0; k < ms; k += 80) setTimeout(iosTick, t + k);
    t += ms;
  });
}
