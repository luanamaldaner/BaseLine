import { useEffect, useRef, useState } from 'react';
import { saveAvatar, useSession, describeError } from '../lib/session.js';
import Avatar from './Avatar.jsx';
import DotEmoji, { DOT_PRESETS } from './DotEmoji.jsx';
import { CloseIcon } from './Icons.jsx';

const SIZE = 192; // stored photos are 192x192 JPEGs, about 10-40 KB

// A square, center-cropped, shrunk copy of the chosen image as a JPEG data
// URL: small enough to store with the team and load instantly.
async function toAvatarPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file isn’t an image we can read. Try a JPG or PNG.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    let quality = 0.85;
    let data = canvas.toDataURL('image/jpeg', quality);
    while (data.length > 110000 && quality > 0.4) {
      quality -= 0.15;
      data = canvas.toDataURL('image/jpeg', quality);
    }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Popup to set your profile picture: upload a photo, pick a Dot, or go back
// to initials.
export default function ProfilePicture({ onClose }) {
  const s = useSession();
  const me = s.user.uid;
  const current = s.avatars?.get(me);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Changes show right away on this device; then we wait for the team copy.
  async function save(avatar) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await saveAvatar(avatar);
      setSaved(true);
    } catch (e) {
      setError(e?.code === 'permission-denied'
        ? 'Changed on this device. Your team will see it once the app’s latest database update is published (ask whoever deploys the app).'
        : `Changed on this device. It couldn’t reach your team yet: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await save({ kind: 'photo', photo: await toAvatarPhoto(file) });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="pfp-title" tabIndex={-1} ref={dialogRef}>
        <header className="modal-head">
          <div>
            <h2 id="pfp-title">Profile picture</h2>
            <p className="muted small">Your team and coach see it next to your name.</p>
          </div>
          <button className="ghost small-btn modal-close" onClick={onClose} aria-label="Close"><CloseIcon size={18} /></button>
        </header>

        <div className="pfp-current">
          <Avatar name={s.profile.name} uid={me} size={96} />
          <div className="pfp-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
            <button className="primary" onClick={() => fileRef.current?.click()}>Upload a photo</button>
            {current && <button className="ghost" onClick={() => save(null)}>Use my initials</button>}
          </div>
        </div>

        <h3 className="pfp-sub">Or pick a Dot</h3>
        <div className="pfp-dots" role="group" aria-label="Dot pictures">
          {Object.entries(DOT_PRESETS).map(([id, p]) => {
            const on = current?.kind === 'dot' && current.dot === id;
            return (
              <button key={id} className={`pfp-dot ${on ? 'on' : ''}`} aria-pressed={on}
                aria-label={`${p.label} Dot`} onClick={() => save({ kind: 'dot', dot: id })}>
                <DotEmoji mood="happy" preset={id} size={52} />
                <span className="small">{p.label}</span>
              </button>
            );
          })}
        </div>

        {error && <div className="callout warn">{error}</div>}
        {busy && <p className="muted small">Saved on this device. Sharing with your team…</p>}
        {saved && !busy && <p className="saved">Saved. Your team sees it too.</p>}
        <p className="muted small">Photos are cropped to a square and shrunk before they’re saved.</p>
      </div>
    </div>
  );
}
