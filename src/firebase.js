import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAnalytics, isSupported } from 'firebase/analytics';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';

// Your web app's Firebase configuration
const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  ...(measurementId ? { measurementId } : {})
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth must initialize before App Check so signInWithRedirect / getRedirectResult is not raced by
// reCAPTCHA App Check network work (same issue class as firebase.auth() ordering in the docs).
// Use initializeAuth to set persistence from the start (IndexedDB preferred for mobile, fallback to localStorage)
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver
});
export const database = getDatabase(app);

const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();

// Enable debug mode for local development or when a debug token is provided
if (typeof self !== 'undefined') {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const debugToken = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || '').trim();
  
  if (import.meta.env.DEV || isLocal || debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  }
}

if (recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
} else if (import.meta.env.DEV) {
  console.info(
    '[firebase] App Check not initialized (no VITE_RECAPTCHA_SITE_KEY). RTDB will fail once App Check enforcement is on; set the key and register a debug token in Firebase Console for local dev.'
  );
}

/** Set after async `isSupported()` check; null if Analytics is disabled or unsupported. */
export let analytics = null;

if (measurementId) {
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {});
}

export default app;
