import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
