import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Reuse an existing authorized Firebase CLI login. Never print credentials or
// persist a new service-account key. FIREBASE_TOOLS_ROOT points to its package.
let tokenPromise;
export async function adminFetch(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !(
    parsed.hostname.endsWith('.googleapis.com') ||
    parsed.hostname === 'dte-hackathon-default-rtdb.firebaseio.com'
  )) throw new Error('Unexpected Firebase administration endpoint.');
  if (!tokenPromise) {
    const root = process.env.FIREBASE_TOOLS_ROOT;
    if (!root) throw new Error('Set FIREBASE_TOOLS_ROOT to your installed firebase-tools package.');
    const require = createRequire(resolve(root, 'package.json'));
    const auth = require(resolve(root, 'lib/auth.js'));
    const account = auth.getProjectDefaultAccount(process.cwd());
    if (!account) throw new Error('Run firebase login before migrating.');
    tokenPromise = auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes ?? []);
  }
  const token = (await tokenPromise).access_token;
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Firebase request failed (${response.status}): ${body.error?.message ?? 'request rejected'}`);
  }
  return response;
}
