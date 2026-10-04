import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/lib/cues.js', import.meta.url), 'utf8').replace(/\bexport /g, '');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(options = {}) {
  const events = [], contexts = [], oscillators = [], gains = [];
  let sessionType = 'auto';
  const navigator = {};
  if (options.session !== 'unsupported') {
    const session = {};
    Object.defineProperty(session, 'type', {
      get: () => sessionType,
      set: (value) => {
        events.push('session:' + value);
        if (options.session === 'throw-set') throw new Error('Session type not supported');
        sessionType = value;
      },
    });
    Object.defineProperty(navigator, 'audioSession', {
      get: () => { if (options.session === 'throw-get') throw new Error('Session API unavailable'); return session; },
    });
  }
  class AudioContext {
    constructor() {
      events.push('context:created');
      if (options.constructorFails) throw new Error('Audio unavailable');
      this.state = options.state ?? 'running';
      this.currentTime = 10;
      this.destination = {};
      contexts.push(this);
    }
    resume() {
      events.push('context:resume');
      if (options.resume) return options.resume(this, events);
      this.state = 'running';
      return Promise.resolve();
    }
    createOscillator() {
      const oscillator = {
        frequency: { value: 0 },
        connect: (target) => target,
        start: () => {
          events.push('oscillator:start');
          if (options.oscillatorFails) throw new Error('Audio device failed');
        },
        stop: (at) => { oscillator.stoppedAt = at; events.push('oscillator:stop'); },
        disconnect: () => events.push('oscillator:disconnect'),
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      const gain = { gain: { value: 0 }, connect: () => this.destination, disconnect: () => events.push('gain:disconnect') };
      gains.push(gain);
      return gain;
    }
  }
  const window = options.noAudio ? {} : options.webkitOnly ? { webkitAudioContext: AudioContext } : { AudioContext };
  const context = vm.createContext({
    window, navigator, setTimeout, clearTimeout,
    ...(options.noSpeech ? {} : {
      speechSynthesis: {
        cancel: () => events.push('speech:cancel'),
        speak: () => events.push('speech:speak'),
      },
      SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    }),
  });
  vm.runInContext(source + '\nglobalThis.api = { beep, unlockAudio, say, hush, checkSound, soundSettings };', context);
  return { api: context.api, events, contexts, oscillators, gains, get sessionType() { return sessionType; } };
}

test('importing cues never creates audio, changes session mode, or autoplays', async () => {
  const h = setup();
  assert.deepEqual(h.events, []);
  assert.equal(h.sessionType, 'auto');
  assert.equal(h.api.soundSettings().unlocked, false);
  assert.equal(await h.api.beep(), false);
  assert.equal(h.api.say('Unrequested sound'), false);
  assert.deepEqual(h.events, []);
});

test('the explicit unlock requests playback mode when the browser supports it', async () => {
  const h = setup();
  const settings = await h.api.unlockAudio();
  assert.equal(settings.audioStarted, true);
  assert.equal(settings.playbackSession, true);
  assert.equal(h.sessionType, 'playback');
  assert.equal(h.events[0], 'session:playback');
  assert.equal(h.api.soundSettings().unlocked, true);
  assert.equal(h.oscillators.length, 0, 'unlock does not run a silent looping sound');
  assert.equal(await h.api.beep(660, 200), true);
  assert.equal(h.oscillators[0].frequency.value, 660);
  assert.equal(h.oscillators[0].stoppedAt, 10.2);
  h.oscillators[0].onended();
  assert.ok(h.events.includes('oscillator:disconnect'));
  assert.ok(h.events.includes('gain:disconnect'));
});

test('unsupported or throwing AudioSession APIs still allow ordinary browser audio', async () => {
  for (const session of ['unsupported', 'throw-get', 'throw-set']) {
    const h = setup({ session });
    const settings = await h.api.unlockAudio();
    assert.equal(settings.playbackSession, false);
    assert.equal(settings.audioStarted, true);
    assert.equal(await h.api.beep(), true);
  }
});

test('resume starts synchronously in the gesture and a suspended context cannot swallow the beep', async () => {
  const resumed = deferred();
  const h = setup({ state: 'suspended', resume: (context, events) => resumed.promise.then(() => {
    context.state = 'running';
    events.push('context:running');
  }) });
  const unlocking = h.api.unlockAudio();
  assert.ok(h.events.includes('context:resume'), 'resume must be invoked before the gesture handler returns');
  const tone = h.api.beep();
  await tick();
  assert.equal(h.oscillators.length, 0, 'no oscillator is scheduled while resume is pending');
  assert.equal(h.events.filter((event) => event === 'context:resume').length, 1, 'concurrent cues share the resume attempt');
  resumed.resolve();
  await unlocking;
  assert.equal(await tone, true);
  assert.ok(h.events.indexOf('context:running') < h.events.indexOf('oscillator:start'));
});

test('a sound check requests speech during the gesture and waits for audio before the tone', async () => {
  const resumed = deferred();
  const h = setup({ state: 'suspended', resume: (context) => resumed.promise.then(() => { context.state = 'running'; }) });
  const checking = h.api.checkSound();
  assert.ok(h.events.includes('speech:speak'));
  assert.equal(h.oscillators.length, 0);
  resumed.resolve();
  const result = await checking;
  assert.equal(result.audioStarted, true);
  assert.equal(result.playbackSession, true);
  assert.equal(result.speechAvailable, true);
  assert.equal(h.oscillators.length, 1);
});

test('resume rejection and audio-device failures are reported without rejected cue promises', async () => {
  const h = setup({ state: 'suspended', resume: () => Promise.reject(new Error('Playback blocked')) });
  assert.equal((await h.api.unlockAudio()).audioStarted, false);
  assert.equal(await h.api.beep(), false);
  assert.equal(h.oscillators.length, 0);
  const broken = setup({ oscillatorFails: true });
  await broken.api.unlockAudio();
  assert.equal(await broken.api.beep(), false);
});

test('missing audio and speech APIs fail gracefully, while WebKit AudioContext remains supported', async () => {
  const missing = setup({ noAudio: true, noSpeech: true, session: 'unsupported' });
  const result = await missing.api.checkSound();
  assert.equal(result.audioStarted, false);
  assert.equal(result.speechAvailable, false);
  assert.equal(result.playbackSession, false);
  assert.doesNotThrow(() => missing.api.hush());
  const webkit = setup({ webkitOnly: true, session: 'unsupported' });
  await webkit.api.unlockAudio();
  assert.equal(await webkit.api.beep(), true);
});

test('an audio context closed by the browser can be recreated after the user has unlocked sound', async () => {
  const h = setup();
  await h.api.unlockAudio();
  h.contexts[0].state = 'closed';
  assert.equal(await h.api.beep(), true);
  assert.equal(h.contexts.length, 2);
});
