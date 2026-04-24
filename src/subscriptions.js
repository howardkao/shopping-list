import { Capacitor } from '@capacitor/core';
import { Purchases, LOG_LEVEL, PURCHASES_ERROR_CODE } from '@revenuecat/purchases-capacitor';
import { trackEvent } from './analytics';
import { logger } from './logger';

const ENTITLEMENT_ID = 'Provisions Pro';
const OFFERING_ID = (import.meta.env.VITE_REVENUECAT_OFFERING || 'default').trim();

/** Store product IDs that unlock premium (fallback when `entitlements.active` is empty — e.g. Xcode StoreKit 2 + restore). */
const PREMIUM_SUBSCRIPTION_PRODUCT_IDS = [
  'com.provisionsapp.shoppinglist.paid.annual', // iOS
  'provisions_paid:provisions-202604',           // Android
];

function nativePlatformKey() {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return (import.meta.env.VITE_REVENUECAT_IOS_KEY || '').trim() || null;
  if (platform === 'android') return (import.meta.env.VITE_REVENUECAT_ANDROID_KEY || '').trim() || null;
  return null;
}

const TRIAL_DAYS = 60;

/** Module state: latest CustomerInfo from RevenueCat, or null before first fetch. */
let latestCustomerInfo = null;
let configuredAppUserId = null;
let listenerId = null;
let subscribers = new Set();
let paywallOpener = null;
let lastEntitlementActive = null;
/** Unix ms timestamp when the household's trial ends; null until loaded. */
let householdTrialEndsAt = null;

/** Called by App.jsx once trialEndsAt (or a createdAt-based fallback) is known. */
export function setHouseholdTrialEndsAt(ts) {
  householdTrialEndsAt = (typeof ts === 'number' && !Number.isNaN(ts)) ? ts : null;
}

export { TRIAL_DAYS };

/**
 * Whether CustomerInfo grants premium access. Prefer RC entitlements; fall back to active SKUs /
 * latest expiration when the entitlement map is empty (known quirk after restore in some
 * StoreKit test / SK2 paths even though POST /receipts succeeded).
 */
export function customerHasPremiumAccess(info) {
  if (!info) return false;
  const entActive = info.entitlements?.active?.[ENTITLEMENT_ID];
  if (entActive) return true;

  const subs = info.activeSubscriptions;
  if (Array.isArray(subs) && subs.some((id) => PREMIUM_SUBSCRIPTION_PRODUCT_IDS.includes(id))) {
    return true;
  }

  const allIds = info.allPurchasedProductIdentifiers;
  if (!Array.isArray(allIds) || !PREMIUM_SUBSCRIPTION_PRODUCT_IDS.some((id) => allIds.includes(id))) {
    return false;
  }
  const latest = info.latestExpirationDate;
  if (!latest) return false;
  const t = new Date(latest).getTime();
  return !Number.isNaN(t) && t > Date.now();
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
  if (import.meta.env.DEV && info) {
    const ent = info.entitlements?.active?.[ENTITLEMENT_ID];
    logger.info('Subscriptions', 'CustomerInfo update', {
      platform: Capacitor.getPlatform(),
      entitlementActive: !!ent,
      entitlementStore: ent?.store ?? null,
      activeSubscriptions: info.activeSubscriptions,
      allPurchasedProductIdentifiers: info.allPurchasedProductIdentifiers,
      latestExpirationDate: info.latestExpirationDate,
    });
  }

  const nowActive = customerHasPremiumAccess(latestCustomerInfo);
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
    // If the household is changing, immediately clear stale customer info and
    // notify subscribers so the UI shows "Loading…" instead of the previous
    // household's data while RC fetches fresh data for the new App User ID.
    if (configuredAppUserId !== householdId && latestCustomerInfo !== null) {
      latestCustomerInfo = null;
      for (const cb of subscribers) { try { cb(null); } catch { /* ignore */ } }
    }

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
    householdTrialEndsAt = null;
  }
}

/** Returns { active, inTrial, expiresAt } from local cache. */
export function getSubscriptionStatus() {
  if (!Capacitor.isNativePlatform()) {
    // Web: entitlement enforcement not wired (Stripe + RC web SDK is future work).
    return { active: true, inTrial: false, expiresAt: null, loaded: false, platform: 'web' };
  }

  // RC takes precedence: if a paid subscription is already active, show that — not trial.
  if (latestCustomerInfo && customerHasPremiumAccess(latestCustomerInfo)) {
    const ent = latestCustomerInfo.entitlements?.active?.[ENTITLEMENT_ID] || null;
    let expiresAt = ent?.expirationDateMillis ?? null;
    if (expiresAt == null && latestCustomerInfo.latestExpirationDate) {
      const parsed = Date.parse(latestCustomerInfo.latestExpirationDate);
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
    // 'APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'PROMOTIONAL' | null
    const store = ent?.store ?? null;
    return { active: true, inTrial: false, expiresAt, store, loaded: true, platform: 'native' };
  }

  // No active paid subscription — check the Firebase trial window.
  if (householdTrialEndsAt !== null && Date.now() < householdTrialEndsAt) {
    return { active: true, inTrial: true, expiresAt: householdTrialEndsAt, loaded: true, platform: 'native' };
  }

  // Trial over and no RC entitlement.
  if (!latestCustomerInfo) {
    return { active: false, inTrial: false, expiresAt: null, loaded: false, platform: 'native' };
  }
  return { active: false, inTrial: false, expiresAt: null, loaded: true, platform: 'native' };
}

/**
 * Single source-of-truth for client write gating.
 *
 * Policy:
 * - Web: allow (no enforcement until Stripe/web SDK lands).
 * - Within trial window (household.trialEndsAt): allow regardless of RC state.
 * - Native before first customerInfo response: allow (avoids blocking signup/onboarding
 *   during the ~hundreds-of-ms RC init window; expired users get gated once info arrives).
 * - Native with loaded customerInfo: allow only when premium access is present
 *   (entitlement active, or active subscription SKU / valid expiration fallback).
 */
export function isWriteAllowed() {
  if (!Capacitor.isNativePlatform()) return true;
  if (latestCustomerInfo && customerHasPremiumAccess(latestCustomerInfo)) return true;
  if (householdTrialEndsAt !== null && Date.now() < householdTrialEndsAt) return true;
  if (!latestCustomerInfo) return true;
  return false;
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

/** Re-fetch CustomerInfo from RC and notify subscribers. No-op on web or before init. */
export async function refreshCustomerInfo() {
  if (!Capacitor.isNativePlatform() || !configuredAppUserId) return;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    handleCustomerInfoUpdate(customerInfo);
  } catch (err) {
    logger.warn('Subscriptions', 'refreshCustomerInfo failed', { message: err?.message });
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
