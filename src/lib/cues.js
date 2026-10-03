// Sound, speech, and vibration cues shared by every test and the guided flow.
//
// The athlete may be young, concussed, or have their eyes closed, so the
// screen is never the only channel: every instruction is also spoken, and
// transitions get a beep and a buzz where the device supports them.

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

export const buzz = (pattern) => navigator.vibrate?.(pattern);
