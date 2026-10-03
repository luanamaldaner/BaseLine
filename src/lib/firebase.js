import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'firebase/firestore';

// Web app config comes from .env.local (not committed; see .env.example).
// Access to data is controlled by Firebase Auth + firestore.rules.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
if (!firebaseConfig.apiKey) {
  throw new Error('Missing Firebase config: copy .env.example to .env.local and fill it in.');
}

export const app = initializeApp(firebaseConfig);

// Stay signed in across reloads and app switches: IndexedDB first, falling
// back to localStorage where IndexedDB is unavailable.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});

// Offline cache: results keep saving on bad Wi-Fi and sync when it's back.
//
// Single-tab manager: with the multi-tab one, only one "primary" tab talks to
// the network and the others hand it their writes. On a phone that primary
// can be a frozen background Safari tab or a suspended installed app, and the
// tab in use queues writes forever: results show locally and never sync.
//
// Forced long polling: on some networks (campus and venue Wi-Fi, carrier
// proxies) Firestore's streaming transport opens but writes are never
// acknowledged, with the same symptom. The SDK's auto-detect only catches a
// failed handshake, not a stream that hangs.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  experimentalForceLongPolling: true,
});
