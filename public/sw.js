// Offline shell. Same-origin GETs only: Firebase traffic (other origins) is
// never touched; pending results use the app's IndexedDB upload queue.
//   - Page loads: network first, so a deploy shows up right away; fall back
//     to the last copy when offline.
//   - Built files, the face model, wasm, icons: cache first (names change
//     when contents change, except model/wasm, versioned by CACHE below).
const CACHE = 'baseline-v3-dot';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest?v=dot-1', '/icon.svg?v=dot-1'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const CACHE_FIRST = /^\/(assets|models|mediapipe-wasm)\/|\.(png|svg|webmanifest)$/;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      // 'no-cache' = always check with the server, never trust a stored copy.
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  if (CACHE_FIRST.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
      ),
    );
  }
});
