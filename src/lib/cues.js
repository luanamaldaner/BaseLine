// Sound, speech, and vibration cues shared by every test and the guided flow.
//
// The athlete may be young, concussed, or have their eyes closed, so the
// screen is never the only channel: every instruction is also spoken, and
// transitions get a beep and a buzz (see buzz() for iPhones).

let audioCtx = null;

export function beep(freq = 880, ms = 180) {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + ms / 1000);
  } catch {
    /* no audio: the screen still shows the cue */
  }
}

// Mobile browsers only allow audio after a tap; call this from a click handler
// once and later beeps work without one.
export const unlockAudio = () => beep(660, 1);

export function say(text, { rate = 0.95 } = {}) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    speechSynthesis.speak(u);
  } catch {
    /* speech unsupported */
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
