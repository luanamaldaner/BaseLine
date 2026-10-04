import { useState } from 'react';
import { checkSound, soundSettings } from '../lib/cues.js';

export default function SoundCheck({ eyesClosed = false }) {
  const [settings, setSettings] = useState(() => soundSettings().unlocked ? soundSettings() : null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  async function check() {
    if (busy) return;
    setBusy(true);
    const result = await checkSound();
    setSettings(result);
    setChecked(true);
    setBusy(false);
  }
  return <div className="callout flow-sound">
    <p><b>Sound check.</b> {settings?.playbackSession
      ? 'Keep your ringer off and media volume up. Use Focus or Do Not Disturb to reduce interruptions.'
      : settings
        ? 'Turn media volume up. If you hear nothing, this browser may need Silent mode turned off. Use Focus or Do Not Disturb to reduce interruptions.'
        : 'Turn media volume up. Check sound to confirm whether your ringer can stay off.'}</p>
    {eyesClosed && <p>Before closing your eyes, make sure you can hear both the tone and the voice. Keep an examiner beside you.</p>}
    <button type="button" className="ghost small-btn" disabled={busy} onClick={check}>{busy ? 'Checking…' : 'Check sound'}</button>
    {checked && <p className="small" role="status">{!settings.audioStarted
      ? 'The tone could not start. Tap Check sound again and check your media volume and audio output.'
      : !settings.speechAvailable
        ? 'This browser cannot read instructions aloud. Follow the screen and have your examiner give the spoken cues.'
        : 'Listen for a tone and “Sound check.” If either is missing, check media volume and Bluetooth output before starting.'}</p>}
  </div>;
}
