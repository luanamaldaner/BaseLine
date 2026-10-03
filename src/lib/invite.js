// Team invite links: https://<site>/?join=K7Q4MX (what the coach's QR code
// opens). The code is kept until the athlete has signed up and joined, so
// they never have to type it.

const KEY = 'pendingJoin';

const normalize = (raw) => (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Call once at startup: moves ?join=CODE out of the address bar into storage.
export function captureInvite() {
  const params = new URLSearchParams(location.search);
  const code = normalize(params.get('join'));
  if (!params.has('join')) return;
  if (code.length === 6) {
    try {
      localStorage.setItem(KEY, code);
    } catch {
      /* private mode: the athlete can still type the code */
    }
  }
  params.delete('join');
  const rest = params.toString();
  history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
}

export function pendingInvite() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const inviteUrl = (code) => `${location.origin}/?join=${code}`;
