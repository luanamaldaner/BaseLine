import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { saveAvatar, useSession, describeError } from '../lib/session.js';
import Avatar from './Avatar.jsx';
import DotEmoji, { DOT_PRESETS, presetId } from './DotEmoji.jsx';
import { CloseIcon } from './Icons.jsx';
import { useModalDialog } from '../lib/modal.js';

const SIZE = 192; // stored photos are 192x192 JPEGs, about 10-40 KB

// Photos are resized locally; choosing a file never writes to the account.
async function toAvatarPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('That file isn’t an image we can read. Try a JPG or PNG.'));
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext('2d');
    context.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
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

const draftFrom = (avatar) => avatar?.kind === 'dot'
  ? { kind: 'dot', dot: presetId(avatar.dot) }
  : avatar?.kind === 'photo' ? { kind: 'photo', photo: avatar.photo } : null;

// Choices stay inside the dialog until Save is acknowledged by the server.
export default function ProfilePicture({ onClose, onSave = saveAvatar }) {
  const session = useSession();
  const initialRef = useRef(draftFrom(session.avatars?.get(session.user.uid)));
  const [draft, setDraft] = useState(initialRef.current);
  const [busy, setBusy] = useState(false);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const dialogRef = useRef(null);
  const busyRef = useRef(false);
  const photoToken = useRef(0);
  const aliveRef = useRef(true);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initialRef.current);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; photoToken.current++; };
  }, []);

  function close() {
    if (busyRef.current) return;
    photoToken.current++;
    onClose();
  }
  useModalDialog(dialogRef, close);

  function choose(avatar) {
    if (busyRef.current) return;
    photoToken.current++;
    setPreparingPhoto(false);
    setDraft(avatar);
    setError(null);
  }

  async function save() {
    if (busyRef.current || preparingPhoto || !dirty) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      if (aliveRef.current) onClose();
    } catch (error) {
      if (aliveRef.current) setError(describeError(error));
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  }

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busyRef.current) return;
    const token = ++photoToken.current;
    setPreparingPhoto(true);
    setError(null);
    try {
      const photo = await toAvatarPhoto(file);
      if (aliveRef.current && token === photoToken.current) setDraft({ kind: 'photo', photo });
    } catch (error) {
      if (aliveRef.current && token === photoToken.current) setError(error.message);
    } finally {
      if (aliveRef.current && token === photoToken.current) setPreparingPhoto(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <div className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="pfp-title" aria-describedby="pfp-description" aria-busy={busy} tabIndex={-1} ref={dialogRef}>
        <header className="modal-head">
          <div>
            <h2 id="pfp-title">Profile picture</h2>
            <p id="pfp-description" className="muted small">Choose a picture, then save it for your team and coach to see.</p>
          </div>
          <button className="ghost small-btn modal-close" onClick={close} disabled={busy} aria-label="Cancel profile picture changes"><CloseIcon size={18} /></button>
        </header>

        <div className="pfp-content">
          <div className="pfp-current">
            <div className="pfp-preview">
              {draft?.kind === 'photo'
                ? <img className="avatar avatar-photo" src={draft.photo} alt="Selected profile picture preview" width={96} height={96} />
                : draft?.kind === 'dot'
                  ? <span className="avatar avatar-dot" style={{ width: 96, height: 96 }}><DotEmoji mood="happy" preset={draft.dot} size={96} label="Selected Dot preview" /></span>
                  : <Avatar name={session.profile.name} size={96} />}
              <span className="muted small">Preview</span>
            </div>
            <div className="pfp-actions">
              <input ref={fileRef} type="file" accept="image/*" hidden disabled={busy} onChange={onFile} />
              <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>Upload a photo</button>
              <button className="ghost" disabled={busy || !draft} onClick={() => choose(null)}>Use my initials</button>
            </div>
          </div>

          <h3 className="pfp-sub">Or pick a Dot</h3>
          <div className="pfp-dots" role="group" aria-label="Dot pictures">
            {Object.entries(DOT_PRESETS).map(([id, preset]) => {
              const selected = draft?.kind === 'dot' && presetId(draft.dot) === id;
              return (
                <button key={id} className={'pfp-dot ' + (selected ? 'on' : '')} aria-pressed={selected}
                  disabled={busy} aria-label={preset.label + ' Dot'} onClick={() => choose({ kind: 'dot', dot: id })}>
                  <DotEmoji mood="happy" preset={id} size={52} />
                  <span className="small">{preset.label}</span>
                </button>
              );
            })}
          </div>

          {error && <div className="callout warn" role="alert">{error} Your selection is still here; retry saving or cancel.</div>}
          {preparingPhoto && <p className="muted small pfp-status" role="status">Preparing your photo…</p>}
          {busy && <p className="muted small pfp-status" role="status">{session.server?.ok === false ? 'Waiting for a connection to finish saving…' : 'Saving your picture…'}</p>}
          <p className="muted small">Photos are cropped to a square and shrunk before they’re saved.</p>
        </div>
        <footer className="pfp-footer row">
          <button className="ghost" onClick={close} disabled={busy}>Cancel</button>
          <button className="primary" onClick={save} disabled={busy || preparingPhoto || !dirty}>
            {busy ? 'Saving…' : error ? 'Retry save' : 'Save picture'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
