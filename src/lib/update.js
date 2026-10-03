import { useEffect, useState } from 'react';

// Tells a running app when a newer build has been deployed. A phone that
// resumes the app from the background doesn't reload it, so without this it
// keeps running the old version until someone force-closes it.
//
// Each build's main script has a new hashed name (/assets/index-XXXX.js), so
// "is there an update" is just "does the live page point at a different one".

const SCRIPT = /\/assets\/index-[\w-]+\.js/;
const CHECK_EVERY_MS = 5 * 60 * 1000;

const running = () =>
  document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;

async function latest() {
  const res = await fetch(`/?v=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return null;
  return (await res.text()).match(SCRIPT)?.[0] ?? null;
}

export function useUpdateAvailable() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    // Dev server has no hashed bundle; nothing to compare.
    if (!import.meta.env.PROD) return undefined;
    let stopped = false;

    const check = async () => {
      try {
        const [now, live] = [running(), await latest()];
        if (!stopped && now && live && now !== live) setAvailable(true);
      } catch {
        /* offline: try again next time */
      }
    };

    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    const timer = setInterval(check, CHECK_EVERY_MS);
    check();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      clearInterval(timer);
    };
  }, []);

  return available;
}
