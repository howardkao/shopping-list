import { Capacitor } from '@capacitor/core';
import { FirebaseAnalytics } from '@capacitor-firebase/analytics';
import { logEvent, setUserId, setUserProperties } from 'firebase/analytics';
import { analytics } from './firebase';

function isNativeAnalytics() {
  return Capacitor.isNativePlatform();
}

function flushPendingUserIdWeb() {
  if (!analytics || pendingUserId === undefined) return;
  try {
    setUserId(analytics, pendingUserId);
  } catch {
    /* ignore */
  }
}

/** @type {string | null | undefined} undefined = never set via this module */
let pendingUserId = undefined;

/** Retry briefly until `firebase.js` finishes async `getAnalytics()` (live `analytics` binding). */
function scheduleUserIdRetry() {
  const started = Date.now();
  const id = window.setInterval(() => {
    if (analytics) {
      window.clearInterval(id);
      flushPendingUserIdWeb();
      return;
    }
    if (Date.now() - started > 12000) window.clearInterval(id);
  }, 200);
}

/**
 * @param {string} name GA4 event name
 * @param {Record<string, string | number | boolean> | undefined} [params]
 */
export function trackEvent(name, params) {
  if (isNativeAnalytics()) {
    void FirebaseAnalytics.logEvent({ name, params: params || {} }).catch(() => {});
    return;
  }
  if (!analytics) return;
  try {
    flushPendingUserIdWeb();
    logEvent(analytics, name, params || {});
  } catch {
    /* ignore */
  }
}

/** @param {string | null | undefined} uid Firebase Auth uid, or null on sign-out */
export function setAnalyticsUserId(uid) {
  const normalized = uid === undefined || uid === '' ? null : uid;
  if (isNativeAnalytics()) {
    void FirebaseAnalytics.setUserId({ userId: normalized }).catch(() => {});
    return;
  }
  pendingUserId = normalized;
  if (analytics) {
    flushPendingUserIdWeb();
    return;
  }
  if (pendingUserId !== undefined) scheduleUserIdRetry();
}

/** @param {Record<string, string>} props GA4 user properties (string values) */
export function setAnalyticsUserProperties(props) {
  if (!props) return;
  if (isNativeAnalytics()) {
    for (const [key, value] of Object.entries(props)) {
      const v = value === undefined || value === null ? null : String(value);
      void FirebaseAnalytics.setUserProperty({ key, value: v }).catch(() => {});
    }
    return;
  }
  if (!analytics) return;
  try {
    flushPendingUserIdWeb();
    setUserProperties(analytics, props);
  } catch {
    /* ignore */
  }
}
