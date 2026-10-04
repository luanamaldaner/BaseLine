import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  disableNetwork,
} from 'firebase/firestore';

// Web app config comes from .env.local (not committed; see .env.example).
// Access to active data is controlled by Firebase Auth + database.rules.json.
const env = import.meta.env;
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
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

// Realtime Database is the active store. Authentication stays on the same
// project, so existing accounts and passwords continue to work.
export const realtimeDb = getDatabase(app);

// Legacy cache access only. Keep the original cache settings so upgrades can
// recover results queued by old versions on this exact browser. Disable the
// network immediately, before profile/roster loading or recovery can start;
// otherwise the old queue might flush before the cache bridge can inspect it.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  experimentalForceLongPolling: true,
});

let legacyNetworkDisabled;
export function stopLegacyFirestoreNetwork() {
  if (!legacyNetworkDisabled) {
    legacyNetworkDisabled = disableNetwork(db).catch((error) => { legacyNetworkDisabled = null; throw error; });
  }
  return legacyNetworkDisabled;
}
// Recovery awaits this same operation and surfaces failures. The startup
// catch avoids an unhandled rejection before an account has finished loading.
stopLegacyFirestoreNetwork().catch(() => {});
