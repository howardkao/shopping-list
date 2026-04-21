import { logEvent, setUserId, setUserProperties } from 'firebase/analytics';
import { analytics } from './firebase';

function flushPendingUserId() {
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
      flushPendingUserId();
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
  if (!analytics) return;
  try {
    flushPendingUserId();
    logEvent(analytics, name, params || {});
  } catch {
    /* ignore */
  }
}

/** @param {string | null | undefined} uid Firebase Auth uid, or null on sign-out */
export function setAnalyticsUserId(uid) {
  pendingUserId = uid === undefined || uid === '' ? null : uid;
  if (analytics) {
    flushPendingUserId();
    return;
  }
  if (pendingUserId !== undefined) scheduleUserIdRetry();
}

/** @param {Record<string, string>} props GA4 user properties (string values) */
export function setAnalyticsUserProperties(props) {
  if (!analytics || !props) return;
  try {
    flushPendingUserId();
    setUserProperties(analytics, props);
  } catch {
    /* ignore */
  }
}
