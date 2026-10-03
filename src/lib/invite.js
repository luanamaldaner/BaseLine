// Team invite links: https://<site>/?join=K7Q4MX (what the coach's QR code
// opens). The code is kept until the athlete has signed up and joined, so
// they never have to type it.

const KEY = 'pendingJoin';
let captured = null;

const normalize = (raw) => (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Call once at startup: moves ?join=CODE out of the address bar into storage.
export function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = normalize(params.get('join'));
  if (!params.has('join')) return;
  if (code.length === 6) {
    captured = code;
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* Keep the invite for this visit when storage is unavailable. */
    }
  }
  params.delete('join');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}

export function pendingInvite() {
  try {
    return captured ?? localStorage.getItem(KEY);
  } catch {
    return captured;
  }
}

export function clearInvite() {
  captured = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const inviteUrl = (code) => `${location.origin}/?join=${code}`;
