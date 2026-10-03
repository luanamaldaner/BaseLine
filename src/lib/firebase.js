import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// Web app config. These values identify the project; they are not secrets.
// Access is controlled by Firebase Auth + firestore.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyB2Qxv_jX9ZWCv5SXU8RC4V_Xd5-wawoPY',
  authDomain: 'dte-hackathon.firebaseapp.com',
  projectId: 'dte-hackathon',
  storageBucket: 'dte-hackathon.firebasestorage.app',
  messagingSenderId: '238436929454',
  appId: '1:238436929454:web:2a904c1d1b06b2bac1c23f',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Offline cache: tests keep saving on bad Wi-Fi and sync when it's back.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
