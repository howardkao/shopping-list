import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence } from 'firebase/auth';
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

const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();

if (import.meta.env.PROD && !recaptchaSiteKey) {
  throw new Error(
    'Missing VITE_RECAPTCHA_SITE_KEY. Firebase App Check is required in production builds; add it to your hosting env (reCAPTCHA v3 site key from Google + registered in Firebase App Check).'
  );
}

if (typeof self !== 'undefined' && import.meta.env.DEV) {
  const debugToken = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || '').trim();
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
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

// Initialize Firebase services
// Use initializeAuth to set persistence from the start (IndexedDB preferred for mobile, fallback to localStorage)
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence]
});
export const database = getDatabase(app);
export default app;
