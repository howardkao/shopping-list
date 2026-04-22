import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { trackEvent } from './analytics';
import { logger } from './logger';

const ENTITLEMENT_ID = 'premium';
const OFFERING_ID = (import.meta.env.VITE_REVENUECAT_OFFERING || 'main').trim();

function nativePlatformKey() {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return (import.meta.env.VITE_REVENUECAT_IOS_KEY || '').trim() || null;
  if (platform === 'android') return (import.meta.env.VITE_REVENUECAT_ANDROID_KEY || '').trim() || null;
  return null;
}

/** Module state: latest CustomerInfo from RevenueCat, or null before first fetch. */
let latestCustomerInfo = null;
let configuredAppUserId = null;
let listenerId = null;
let subscribers = new Set();
let paywallOpener = null;
let lastEntitlementActive = null;

function entitlementIsActive(info) {
  if (!info || !info.entitlements) return false;
  const active = info.entitlements.active || {};
  return Boolean(active[ENTITLEMENT_ID]);
}

function entitlementInTrial(info) {
  if (!info || !info.entitlements) return false;
  const ent = info.entitlements.active?.[ENTITLEMENT_ID];
  if (!ent) return false;
  const period = String(ent.periodType || '').toUpperCase();
  return period === 'TRIAL' || period === 'INTRO';
}

function handleCustomerInfoUpdate(info) {
  const prev = latestCustomerInfo;
  latestCustomerInfo = info || null;

  const nowActive = entitlementIsActive(latestCustomerInfo);
  if (lastEntitlementActive !== null && lastEntitlementActive !== nowActive) {
    if (nowActive) {
      const platform = Capacitor.getPlatform();
      if (entitlementInTrial(latestCustomerInfo)) {
        trackEvent('trial_started', { platform });
      } else {
        trackEvent('subscription_started', { platform, plan: 'annual' });
      }
    } else {
      trackEvent('subscription_cancelled', { platform: Capacitor.getPlatform() });
    }
  } else if (lastEntitlementActive === true && nowActive) {
    const prevPurchase = prev?.entitlements?.active?.[ENTITLEMENT_ID]?.latestPurchaseDateMillis;
    const nextPurchase = latestCustomerInfo?.entitlements?.active?.[ENTITLEMENT_ID]?.latestPurchaseDateMillis;
    if (prevPurchase && nextPurchase && nextPurchase > prevPurchase) {
      trackEvent('subscription_renewed', { platform: Capacitor.getPlatform() });
    }
  }
  lastEntitlementActive = nowActive;

  for (const cb of subscribers) {
    try { cb(latestCustomerInfo); } catch { /* ignore subscriber error */ }
  }
}

/**
 * Initialize RevenueCat with householdId as the App User ID.
 * No-ops on web (entitlement enforcement via Stripe/web SDK is future work).
 */
export async function initSubscriptions(householdId) {
  if (!Capacitor.isNativePlatform()) return;
  if (!householdId) return;
  const apiKey = nativePlatformKey();
  if (!apiKey) {
    logger.warn('Subscriptions', 'Missing RevenueCat API key for platform; skipping init');
    return;
  }
  try {
    if (configuredAppUserId && configuredAppUserId !== householdId) {
      await Purchases.logOut().catch(() => {});
      configuredAppUserId = null;
    }
    if (!configuredAppUserId) {
      if (import.meta.env.DEV) {
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG }).catch(() => {});
      }
      await Purchases.configure({ apiKey, appUserID: householdId });
      configuredAppUserId = householdId;
      if (listenerId === null) {
        const result = await Purchases.addCustomerInfoUpdateListener(handleCustomerInfoUpdate);
        listenerId = result;
      }
    } else if (configuredAppUserId !== householdId) {
      // Already configured; switch user.
      const res = await Purchases.logIn({ appUserID: householdId });
      configuredAppUserId = householdId;
      if (res?.customerInfo) handleCustomerInfoUpdate(res.customerInfo);
    }
    // Prime state with an initial fetch so gating can react quickly.
    try {
      const { customerInfo } = await Purchases.getCustomerInfo();
      handleCustomerInfoUpdate(customerInfo);
    } catch (err) {
      logger.warn('Subscriptions', 'getCustomerInfo failed during init', { message: err?.message });
    }
  } catch (err) {
    logger.error('Subscriptions', 'RevenueCat configure failed', { message: err?.message });
  }
}

/** Tear down listener and forget state (e.g. on sign-out). */
export async function shutdownSubscriptions() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (listenerId !== null) {
      await Purchases.removeCustomerInfoUpdateListener({ listenerToRemove: listenerId }).catch(() => {});
      listenerId = null;
    }
    if (configuredAppUserId) {
      await Purchases.logOut().catch(() => {});
    }
  } finally {
    configuredAppUserId = null;
    latestCustomerInfo = null;
    lastEntitlementActive = null;
  }
}

/** Returns { active, inTrial, expiresAt } from local cache. */
export function getSubscriptionStatus() {
  if (!Capacitor.isNativePlatform()) {
    // Web: entitlement enforcement not wired (Stripe + RC web SDK is future work).
    return { active: true, inTrial: false, expiresAt: null, loaded: false, platform: 'web' };
  }
  if (!latestCustomerInfo) {
    return { active: false, inTrial: false, expiresAt: null, loaded: false, platform: 'native' };
  }
  const ent = latestCustomerInfo.entitlements?.active?.[ENTITLEMENT_ID] || null;
  return {
    active: Boolean(ent),
    inTrial: entitlementInTrial(latestCustomerInfo),
    expiresAt: ent?.expirationDateMillis ?? null,
    loaded: true,
    platform: 'native',
  };
}

/**
 * Single source-of-truth for client write gating.
 *
 * Policy:
 * - Web: allow (no enforcement until Stripe/web SDK lands).
 * - Native before first customerInfo response: allow (avoids blocking signup/onboarding
 *   during the ~hundreds-of-ms RC init window; expired users get gated once info arrives).
 * - Native with loaded customerInfo: allow only when `premium` entitlement is active
 *   (includes trial/intro periods).
 */
export function isWriteAllowed() {
  if (!Capacitor.isNativePlatform()) return true;
  if (!latestCustomerInfo) return true;
  return entitlementIsActive(latestCustomerInfo);
}

/** Gate helper: if blocked, fires paywall and returns false. */
export function assertWriteAllowed(trigger = 'gated_action') {
  if (isWriteAllowed()) return true;
  openPaywall(trigger);
  return false;
}

export function setPaywallOpener(fn) {
  paywallOpener = typeof fn === 'function' ? fn : null;
}

export function openPaywall(trigger = 'gated_action') {
  const platform = Capacitor.getPlatform();
  trackEvent('paywall_viewed', { platform, trigger });
  if (paywallOpener) {
    try { paywallOpener(trigger); } catch { /* ignore */ }
  } else {
    logger.warn('Subscriptions', 'openPaywall called with no registered opener', { trigger });
  }
}

/** Subscribe to RC CustomerInfo changes (renewals, restores, expirations). */
export function listenToSubscriptionChanges(callback) {
  if (typeof callback !== 'function') return () => {};
  subscribers.add(callback);
  if (latestCustomerInfo) {
    try { callback(latestCustomerInfo); } catch { /* ignore */ }
  }
  return () => { subscribers.delete(callback); };
}

async function findAnnualPackage() {
  const offerings = await Purchases.getOfferings();
  const offering = offerings.all?.[OFFERING_ID] || offerings.current || null;
  if (!offering) throw new Error('No RevenueCat offering available');
  const pkg = offering.annual || offering.availablePackages?.[0] || null;
  if (!pkg) throw new Error('No package in RevenueCat offering');
  return pkg;
}

/**
 * Triggers the native purchase sheet for the annual package.
 * On web, delegates to Stripe checkout stub (future work).
 */
export async function purchaseSubscription() {
  if (!Capacitor.isNativePlatform()) {
    const { redirectToStripeCheckout } = await import('./stripe-checkout.js');
    return redirectToStripeCheckout();
  }
  const pkg = await findAnnualPackage();
  try {
    const result = await Purchases.purchasePackage({ aPackage: pkg });
    handleCustomerInfoUpdate(result.customerInfo);
    return { success: true, customerInfo: result.customerInfo };
  } catch (err) {
    const code = err?.code;
    const cancelled = code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || err?.userCancelled;
    if (cancelled) return { success: false, cancelled: true };
    logger.error('Subscriptions', 'purchasePackage failed', { code, message: err?.message });
    return { success: false, error: err };
  }
}

/** Apple-mandated restore flow; returns updated CustomerInfo. */
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) return { success: false, unavailable: true };
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    handleCustomerInfoUpdate(customerInfo);
    return { success: true, customerInfo };
  } catch (err) {
    logger.error('Subscriptions', 'restorePurchases failed', { message: err?.message });
    return { success: false, error: err };
  }
}

/**
 * Fetch the current offering's annual package display data for the paywall.
 * Returns null if RC not configured or offering not available.
 */
export async function getAnnualPackageDisplay() {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    const pkg = await findAnnualPackage();
    const product = pkg.product || {};
    return {
      priceString: product.priceString || null,
      currencyCode: product.currencyCode || null,
      productIdentifier: product.identifier || null,
    };
  } catch {
    return null;
  }
}
