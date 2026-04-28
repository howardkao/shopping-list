import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { Capacitor } from '@capacitor/core';
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
  // Use your real site host (e.g. myprovisions.app) when it is on Auth authorized domains + Hosting.
  // Note: password-reset *emails* still default to project.firebaseapp.com until you set the action URL
  // in Firebase Console → Authentication → Templates (see “Customize action URL” in the docs).
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
const isNativePlatform = Capacitor.isNativePlatform();

// Auth must initialize before App Check so signInWithRedirect / getRedirectResult is not raced by
// reCAPTCHA App Check network work (same issue class as firebase.auth() ordering in the docs).
// Use initializeAuth to set persistence from the start (IndexedDB preferred for mobile, fallback to localStorage)
const authConfig = {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
};
if (!isNativePlatform) {
  authConfig.popupRedirectResolver = browserPopupRedirectResolver;
}

export const auth = initializeAuth(app, authConfig);
export const database = getDatabase(app);

const recaptchaSiteKey = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || '').trim();

// App Check debug token: dev-only. Wrapping in `import.meta.env.DEV` lets Vite statically
// replace the condition with `false` and tree-shake the entire branch from production
// builds, so the debug token literal is never inlined into the public bundle (which would
// neutralize App Check enforcement for everyone).
if (import.meta.env.DEV && typeof self !== 'undefined' && !isNativePlatform) {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const debugToken = (import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || '').trim();
  if (isLocal || debugToken) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true;
  }
}

if (!isNativePlatform && recaptchaSiteKey) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
} else if (!isNativePlatform && import.meta.env.DEV) {
  console.info(
    '[firebase] App Check not initialized (no VITE_RECAPTCHA_SITE_KEY). RTDB will fail once App Check enforcement is on; set the key and register a debug token in Firebase Console for local dev.'
  );
}

/** Set after async `isSupported()` check; null if Analytics is disabled or unsupported. */
export let analytics = null;

if (!isNativePlatform && measurementId) {
  isSupported()
    .then((supported) => {
      if (supported) {
        analytics = getAnalytics(app);
      }
    })
    .catch(() => {});
}

export default app;
