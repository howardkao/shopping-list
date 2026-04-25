import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapacitorApp } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';
import { Plus, Check, X, Search, CheckCircle, Loader2, Menu, Trash2, LogOut, Shield, Mail, Lock, Copy, ChevronDown, ChevronLeft, ChevronRight, ShoppingCart, ClipboardList, ClipboardPen, RefreshCw, Settings, History, UserCircle, BarChart3, Pin, AlertTriangle, Eye, EyeOff, ScrollText, Home, KeyRound, Users } from 'lucide-react';
import { auth, database } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithRedirect,
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithRedirect,
  getRedirectResult,
  linkWithCredential
} from 'firebase/auth';
import { ref, set, get, remove, onValue, push, update } from 'firebase/database';
import {
  initOfflineDB,
  saveShoppingListLocally,
  loadShoppingListLocally,
  saveTaxonomyV2Locally,
  loadTaxonomyV2Locally,
  saveQuantityDefaultsLocally,
  loadQuantityDefaultsLocally,
  getLastSyncTime,
  saveCachedUser,
  loadCachedUser,
  clearCachedUser
} from './offlineStorage';
import { logger } from './logger';
import { trackEvent, setAnalyticsUserId, setAnalyticsUserProperties } from './analytics';
import {
  initSubscriptions,
  shutdownSubscriptions,
  listenToSubscriptionChanges,
  getSubscriptionStatus,
  assertWriteAllowed,
  openPaywall,
  setPaywallOpener,
  purchaseSubscription,
  restorePurchases,
  getAnnualPackageDisplay,
  customerHasPremiumAccess,
  setHouseholdTrialEndsAt,
  refreshCustomerInfo,
  TRIAL_DAYS,
} from './subscriptions';
import { humanizeAuthError } from './authErrors';
import DebugPanel from './DebugPanel';
import SuggestionsEditor from './SuggestionsEditor';
import Onboarding from './Onboarding';
import { PrivacyPolicyPage, TermsOfServicePage } from './LegalPages';
import { bootstrapHouseholdTaxonomy } from './householdBootstrap';
import { formatAisleNameForDisplay } from './aisleDisplay';
import {
  dormantShortcuts,
  promotionCandidates,
  topPurchased,
  userContributions,
} from './itemAnalytics';
import { computeEffectiveCheckEvents, lastEffectivePurchaseTimestamp } from './purchaseSemantics.js';
import {
  eventMonthKey,
  pushHouseholdItemEvent,
  getHouseholdItemEventsMerged,
} from './itemEventsSharding';
// categoryClassifier is used internally by itemAnalytics

const generateId = () => Math.random().toString(36).substr(2, 9);

/** Public SPA routes for legal pages (Firebase hosting rewrites + in-app history). */
const LEGAL_PATH_PRIVACY = '/privacy';
const LEGAL_PATH_TERMS = '/terms';

function legalViewFromPathname(pathname) {
  if (pathname === LEGAL_PATH_PRIVACY) return 'privacy';
  if (pathname === LEGAL_PATH_TERMS) return 'terms';
  return null;
}

/**
 * RTDB shopping-list is an object keyed by item id (`{<id>: item, …}`). Older households
 * may still return a true array until the migration script has run; both shapes are
 * tolerated. Sorted by `addedAt` so insertion order is preserved across the mixed key
 * space (push keys vs. legacy stringified Date.now()).
 */
function snapshotShoppingListToArray(val) {
  if (val == null) return [];
  const rows = Array.isArray(val)
    ? val.filter((row) => row != null)
    : (typeof val === 'object'
      ? Object.entries(val)
          .filter(([, row]) => row != null)
          .map(([key, row]) => (row.id != null ? row : { ...row, id: key }))
      : []);
  return rows.slice().sort((a, b) => (Number(a?.addedAt) || 0) - (Number(b?.addedAt) || 0));
}

const formatRelativeTime = (timestamp) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** Local calendar + local clock; "today at 1:30pm", "yesterday at 2:30pm", or "4/7 at 11:30am". */
const formatLocalDateTimePhrase = (ms) => {
  if (ms == null || Number.isNaN(ms)) return '';
  try {
    const d = new Date(ms);
    const now = new Date();
    const sameLocalDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    let timePart = d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    timePart = timePart.replace(/\s*([AP]M)/i, (_, ap) => ap.toLowerCase());

    if (sameLocalDay(d, now)) return `today at ${timePart}`;
    if (sameLocalDay(d, yesterday)) return `yesterday at ${timePart}`;
    return `${d.getMonth() + 1}/${d.getDate()} at ${timePart}`;
  } catch {
    return '';
  }
};

/**
 * Redeem an invite code or create a new household for a just-authenticated user
 * (email/password or SSO). Writes `users/{uid}`, `households/{hid}/members/{uid}`,
 * and seeds taxonomy for new households. Throws human-readable errors on validation
 * failure; callers are responsible for logging and surfacing messages to the user.
 */
async function setupHouseholdForUser(newUser, { signupType, inviteCode, displayName }) {
  const trimmedName = (displayName || '').trim();
  if (!trimmedName) {
    throw new Error('Please enter your name');
  }

  const now = Date.now();

  if (signupType === 'join') {
    if (!inviteCode) {
      throw new Error('Please enter your invitation code.');
    }
    const code = inviteCode.trim().toUpperCase();
    logger.info('Auth', 'Join: reading invite code', { code, uid: newUser.uid });
    const codeSnapshot = await get(ref(database, `inviteCodes/${code}`));
    const codeData = codeSnapshot.val();
    logger.info('Auth', 'Join: invite code data', { found: !!codeData, used: codeData?.used, hasHouseholdId: !!codeData?.householdId });
    if (!codeData || Date.now() > new Date(codeData.expiresAt).getTime()) {
      throw new Error("That invite code isn't valid or has expired.");
    }
    if (codeData.used) {
      throw new Error('That invite code has already been used.');
    }
    const householdId = codeData.householdId;

    // Write user record first so the security rule check on /inviteCodes (which
    // requires auth.uid's householdId to match) passes for the subsequent writes.
    logger.info('Auth', 'Join: writing user record', { uid: newUser.uid, householdId });
    await set(ref(database, `users/${newUser.uid}`), {
      email: newUser.email,
      displayName: trimmedName,
      createdAt: now,
      householdId
    });
    logger.info('Auth', 'Join: user record written, marking invite code used');
    await set(ref(database, `inviteCodes/${code}/used`), true);
    await set(ref(database, `inviteCodes/${code}/usedBy`), newUser.email);
    await set(ref(database, `inviteCodes/${code}/usedAt`), now);
    logger.info('Auth', 'Join: invite code marked used, writing household copies');
    await set(ref(database, `households/${householdId}/inviteCodes/${code}/used`), true);
    await set(ref(database, `households/${householdId}/inviteCodes/${code}/usedBy`), newUser.email);
    await set(ref(database, `households/${householdId}/inviteCodes/${code}/usedAt`), now);
    logger.info('Auth', 'Join: writing member record', { householdId, uid: newUser.uid });
    await set(ref(database, `households/${householdId}/members/${newUser.uid}`), {
      displayName: trimmedName,
      email: newUser.email
    });
    logger.info('Auth', 'Join: complete', { householdId, uid: newUser.uid });
    return householdId;
  }

  // Create a new household
  const newHouseholdRef = push(ref(database, 'households'));
  const householdId = newHouseholdRef.key;
  await set(newHouseholdRef, {
    adminUid: newUser.uid,
    createdAt: now,
    trialEndsAt: now + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  });
  await set(ref(database, `users/${newUser.uid}`), {
    email: newUser.email,
    displayName: trimmedName,
    createdAt: now,
    householdId
  });
  await set(ref(database, `households/${householdId}/members/${newUser.uid}`), {
    displayName: trimmedName,
    email: newUser.email
  });

  try {
    const result = await bootstrapHouseholdTaxonomy(householdId);
    logger.info('Auth', 'Household taxonomy seeded', { householdId, ...result });
  } catch (seedErr) {
    logger.error('Auth', 'Household taxonomy seed failed', { householdId, error: seedErr.message });
  }
  logger.info('Auth', 'New household created', { householdId, adminUid: newUser.uid });

  return householdId;
}

const SSO_SESSION_KEY = 'shopping_list_sso_ctx';
const SSO_LINK_UI_KEY = 'shopping_list_sso_link_ui';
/** Set while email signup is in flight so onAuthStateChanged doesn't dismiss the login screen before household setup completes. */
const EMAIL_SIGNUP_IN_PROGRESS_KEY = 'shopping_list_email_signup_in_progress';

/** OAuth credential for account-exists linking after redirect; not JSON-serializable. */
let pendingOAuthLink = null;

/** React 18 Strict Mode runs effects twice in dev; concurrent getRedirectResult calls race (second returns null). */
let getRedirectResultPromise = null;
function getRedirectResultOnce() {
  if (!getRedirectResultPromise) {
    getRedirectResultPromise = getRedirectResult(auth);
  }
  return getRedirectResultPromise;
}

/** Firebase JS `AuthCredential` from `@capacitor-firebase/authentication` when using `skipNativeAuth: true`. */
function buildFirebaseCredentialFromNativePlugin(providerType, pluginResult) {
  const c = pluginResult?.credential;
  if (providerType === 'google') {
    return GoogleAuthProvider.credential(c?.idToken, c?.accessToken);
  }
  const apple = new OAuthProvider('apple.com');
  return apple.credential({
    idToken: c?.idToken,
    rawNonce: c?.nonce
  });
}

async function deleteAccountDataAndAuth(user, householdId, isAdmin) {
  if (isAdmin && householdId) {
    const inviteCodesSnap = await get(ref(database, `households/${householdId}/inviteCodes`));
    const inviteCodes = inviteCodesSnap.val();
    if (inviteCodes) {
      await Promise.all(
        Object.keys(inviteCodes).map((code) => remove(ref(database, `inviteCodes/${code}`)))
      );
    }
    await remove(ref(database, `households/${householdId}`));
  }
  await remove(ref(database, `users/${user.uid}`));
  await clearCachedUser();
  await deleteUser(user);
  logger.info('Auth', 'Account deleted successfully', { uid: user.uid });
}

function Login({ onLoginSuccess, onOpenPrivacy, onOpenTerms, initialMode, initialSignupType, initialInviteCode }) {
  const [mode, setMode] = useState(initialMode ?? 'signin');
  const [signupType, setSignupType] = useState(initialSignupType ?? 'create'); // 'create' | 'join'
  const [signupStep, setSignupStep] = useState('choice'); // 'choice' | 'auth'  — two-step signup wizard
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  /** SSO account linking: when an SSO attempt fails with account-exists-with-different-credential,
   *  we stash the SSO credential + email + which provider was attempted, then prompt for the
   *  existing password so we can sign in + linkWithCredential. */
  const [pendingCredential, setPendingCredential] = useState(null);
  const [pendingLinkEmail, setPendingLinkEmail] = useState('');
  const [pendingLinkProvider, setPendingLinkProvider] = useState('');
  /** SSO signup on the signin screen: if OAuth succeeds but users/{uid} doesn't exist, we route
   *  the user into a post-SSO household-choice step (redirect flow resumes via sessionStorage). */
  const [awaitingHousehold, setAwaitingHousehold] = useState(false);
  /** `/signin?mode=resetPassword&oobCode=…` — finish reset in-app (avoids racing `getRedirectResult`). */
  const [passwordLinkAction, setPasswordLinkAction] = useState(null);
  const [newPasswordFromEmail, setNewPasswordFromEmail] = useState('');
  const [confirmNewPasswordFromEmail, setConfirmNewPasswordFromEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    let sp;
    try {
      sp = new URLSearchParams(window.location.search);
    } catch {
      return undefined;
    }
    if (sp.get('mode') !== 'resetPassword') return undefined;
    const oob = sp.get('oobCode');
    if (!oob) return undefined;

    setPasswordLinkAction('checking');
    setError('');
    setSuccess('');

    verifyPasswordResetCode(auth, oob)
      .then((accountEmail) => {
        if (cancelled) return;
        setPasswordLinkAction({ email: accountEmail, oobCode: oob });
        if (accountEmail) setEmail(accountEmail);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Auth', 'Password reset link verify failed', {
          error: err.message,
          code: err.code
        });
        setPasswordLinkAction('invalid');
        setError(humanizeAuthError(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (pendingOAuthLink) {
      const p = pendingOAuthLink;
      pendingOAuthLink = null;
      setPendingCredential(p.credential);
      setPendingLinkEmail(p.email);
      setPendingLinkProvider(p.providerType);
      if (p.email) setEmail(p.email);
      setPassword('');
      setError(
        'An account already exists with this email. Enter your password below to link your accounts.'
      );
    }
    try {
      const raw = sessionStorage.getItem(SSO_SESSION_KEY);
      if (!raw) return;
      const ctx = JSON.parse(raw);
      if (ctx.phase === 'awaiting_household') {
        setAwaitingHousehold(true);
        setMode(ctx.mode || 'signup');
        setSignupType(ctx.signupType || 'create');
        setInviteCode(ctx.inviteCode || '');
        setDisplayName(ctx.displayName || '');
      }
    } catch {
      sessionStorage.removeItem(SSO_SESSION_KEY);
    }
  }, []);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();
    setLoading(true);
    setError('');
    setSuccess('');
    logger.info('Auth', 'Sign in attempt', { email: trimmedEmail });
    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      logger.info('Auth', 'Sign in successful', { email: trimmedEmail });
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      logger.error('Auth', 'Sign in failed', { email: trimmedEmail, error: err.message, code: err.code });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const explicitContinue = (import.meta.env.VITE_PASSWORD_RESET_CONTINUE_URL || '').trim();
      const continueUrl =
        explicitContinue ||
        (typeof window !== 'undefined' && window.location?.origin
          ? `${window.location.origin}/signin`
          : '');
      const actionCodeSettings = continueUrl
        ? { url: continueUrl, handleCodeInApp: false }
        : undefined;
      await sendPasswordResetEmail(auth, trimmedEmail, actionCodeSettings);
      setSuccess('Password reset email sent. Check your inbox.');
    } catch (err) {
      logger.error('Auth', 'Password reset failed', { email: trimmedEmail, error: err.message, code: err.code });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    const trimmedEmail = email.trim();
    logger.info('Auth', 'Sign up attempt', { email: trimmedEmail, signupType });
    const signupFlow = signupType === 'join' ? 'join' : 'new_household';
    trackEvent('signup_started', { method: 'email', flow: signupFlow });

    try {
      const trimmedName = displayName.trim();
      if (!trimmedName) {
        setError('Please enter your name');
        setLoading(false);
        return;
      }
      if (signupType === 'join' && !inviteCode) {
        setError('Please enter your invitation code.');
        setLoading(false);
        return;
      }

      // Pre-validate invite code BEFORE creating the auth user. /inviteCodes is
      // publicly readable, so this works without auth. Doing it here prevents
      // creating an orphaned Firebase Auth account when the code is wrong.
      if (signupType === 'join') {
        const code = inviteCode.trim().toUpperCase();
        const codeSnap = await get(ref(database, `inviteCodes/${code}`));
        const codeData = codeSnap.val();
        if (!codeData || Date.now() > new Date(codeData.expiresAt).getTime()) {
          setError("That invite code isn't valid or has expired.");
          setLoading(false);
          return;
        }
        if (codeData.used) {
          setError('That invite code has already been used.');
          setLoading(false);
          return;
        }
      }

      // Block onAuthStateChanged from dismissing the login screen until household
      // setup finishes. Without this, the login UI disappears as soon as the auth
      // user is created, silently swallowing any error from setupHouseholdForUser.
      sessionStorage.setItem(EMAIL_SIGNUP_IN_PROGRESS_KEY, '1');
      const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      await setupHouseholdForUser(userCredential.user, {
        signupType,
        inviteCode,
        displayName: trimmedName
      });

      logger.info('Auth', 'Sign up completed successfully');
      trackEvent('signup_completed', { method: 'email', flow: signupFlow });
      if (signupType === 'join') {
        trackEvent('invite_code_redeemed', {});
      }
      sessionStorage.removeItem(EMAIL_SIGNUP_IN_PROGRESS_KEY);
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      sessionStorage.removeItem(EMAIL_SIGNUP_IN_PROGRESS_KEY);
      logger.error('Auth', 'Sign up failed', { email: trimmedEmail, error: err.message, code: err.code });
      trackEvent('signup_abandoned', {
        method: 'email',
        flow: signupFlow,
        step: String(err.code || 'error'),
      });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const buildSsoProvider = (providerType) => {
    if (providerType === 'google') {
      const p = new GoogleAuthProvider();
      p.setCustomParameters({ prompt: 'select_account' });
      return p;
    }
    const p = new OAuthProvider('apple.com');
    p.addScope('email');
    p.addScope('name');
    return p;
  };

  const handleSsoSignIn = async (providerType) => {
    setLoading(true);
    clearMessages();
    logger.info('Auth', 'SSO sign-in attempt', {
      providerType,
      mode,
      signupType,
      native: Capacitor.isNativePlatform()
    });

    if (Capacitor.isNativePlatform()) {
      try {
        sessionStorage.setItem(
          SSO_SESSION_KEY,
          JSON.stringify({
            phase: 'pre_redirect',
            mode,
            signupType,
            inviteCode,
            displayName,
            providerType
          })
        );
        const pluginResult =
          providerType === 'google'
            ? await FirebaseAuthentication.signInWithGoogle({
                skipNativeAuth: true,
                customParameters: [{ key: 'prompt', value: 'select_account' }]
              })
            : await FirebaseAuthentication.signInWithApple({
                skipNativeAuth: true,
                scopes: ['email', 'name']
              });
        const oauthCred = buildFirebaseCredentialFromNativePlugin(providerType, pluginResult);
        const userCred = await signInWithCredential(auth, oauthCred);

        const rawCtx = sessionStorage.getItem(SSO_SESSION_KEY);
        let ctx;
        try {
          ctx = rawCtx ? JSON.parse(rawCtx) : null;
        } catch {
          ctx = null;
        }
        if (!ctx || ctx.phase !== 'pre_redirect') {
          sessionStorage.removeItem(SSO_SESSION_KEY);
          return;
        }

        const ssoUser = userCred.user;
        const {
          mode: ctxMode,
          signupType: ctxSignupType,
          inviteCode: ctxInvite,
          displayName: storedName
        } = ctx;

        const userRecSnap = await get(ref(database, `users/${ssoUser.uid}`));
        const existing = userRecSnap.val();
        if (existing?.householdId) {
          logger.info('Auth', 'SSO returning user (native), proceeding to app');
          sessionStorage.removeItem(SSO_SESSION_KEY);
          if (onLoginSuccess) onLoginSuccess();
          return;
        }

        const ssoDisplayName = (ssoUser.displayName || '').trim();
        const storedTrim = (storedName || '').trim();
        if (ctxMode === 'signup' && (ssoDisplayName || storedTrim)) {
          await setupHouseholdForUser(ssoUser, {
            signupType: ctxSignupType,
            inviteCode: ctxInvite,
            displayName: ssoDisplayName || storedTrim
          });
          logger.info('Auth', 'SSO household setup completed (native)', { signupType: ctxSignupType });
          sessionStorage.removeItem(SSO_SESSION_KEY);
          if (onLoginSuccess) onLoginSuccess();
          return;
        }

        sessionStorage.setItem(
          SSO_SESSION_KEY,
          JSON.stringify({
            phase: 'awaiting_household',
            mode: ctxMode,
            signupType: ctxSignupType,
            inviteCode: ctxInvite,
            displayName: ssoDisplayName || storedTrim
          })
        );
        setAwaitingHousehold(true);
        setMode(ctxMode || 'signup');
        setSignupType(ctxSignupType || 'create');
        setInviteCode(ctxInvite || '');
        setDisplayName(ssoDisplayName || storedTrim);
      } catch (err) {
        sessionStorage.removeItem(SSO_SESSION_KEY);
        if (err.code === 'auth/account-exists-with-different-credential') {
          const inferredProvider = err.customData?.providerId === 'google.com' ? 'google' : 'apple';
          const cred =
            inferredProvider === 'google'
              ? GoogleAuthProvider.credentialFromError(err)
              : OAuthProvider.credentialFromError(err);
          setPendingCredential(cred);
          setPendingLinkEmail(err.customData?.email || '');
          setPendingLinkProvider(inferredProvider);
          if (err.customData?.email) setEmail(err.customData.email);
          setPassword('');
          setError(
            'An account already exists with this email. Enter your password below to link your accounts.'
          );
          sessionStorage.setItem(SSO_LINK_UI_KEY, '1');
        } else if (
          err.code === 'auth/popup-closed-by-user' ||
          err.code === 'auth/cancelled-popup-request'
        ) {
          logger.info('Auth', 'SSO native flow cancelled', { providerType });
        } else {
          logger.error('Auth', 'SSO native sign-in failed', {
            providerType,
            error: err.message,
            code: err.code
          });
          setError(humanizeAuthError(err));
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      sessionStorage.setItem(
        SSO_SESSION_KEY,
        JSON.stringify({
          phase: 'pre_redirect',
          mode,
          signupType,
          inviteCode,
          displayName,
          providerType
        })
      );
      await signInWithRedirect(auth, buildSsoProvider(providerType));
    } catch (err) {
      sessionStorage.removeItem(SSO_SESSION_KEY);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        logger.info('Auth', 'SSO redirect cancelled before navigation', { providerType });
      } else {
        logger.error('Auth', 'SSO redirect failed to start', {
          providerType,
          error: err.message,
          code: err.code
        });
        setError(humanizeAuthError(err));
      }
      setLoading(false);
    }
  };

  const handleLinkAccounts = async () => {
    const linkEmail = (pendingLinkEmail || '').trim();
    if (!pendingCredential || !linkEmail || !password) return;
    setLoading(true);
    clearMessages();
    logger.info('Auth', 'Account linking attempt', {
      provider: pendingLinkProvider,
      email: linkEmail
    });
    try {
      const pwdCred = await signInWithEmailAndPassword(auth, linkEmail, password);
      await linkWithCredential(pwdCred.user, pendingCredential);
      logger.info('Auth', 'Account linking successful', {
        provider: pendingLinkProvider,
        uid: pwdCred.user.uid
      });
      setPendingCredential(null);
      setPendingLinkEmail('');
      setPendingLinkProvider('');
      sessionStorage.removeItem(SSO_LINK_UI_KEY);
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      logger.error('Auth', 'Account linking failed', {
        provider: pendingLinkProvider,
        error: err.message,
        code: err.code
      });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const cancelLinking = () => {
    sessionStorage.removeItem(SSO_LINK_UI_KEY);
    setPendingCredential(null);
    setPendingLinkEmail('');
    setPendingLinkProvider('');
    setPassword('');
    clearMessages();
  };

  const handleCompleteSsoHousehold = async () => {
    let u = auth.currentUser;
    if (!u) {
      const deadline = Date.now() + 2500;
      while (!u && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 80));
        u = auth.currentUser;
      }
    }
    if (!u) {
      setError('Your sign-in session expired. Please try again.');
      setAwaitingHousehold(false);
      return;
    }
    setLoading(true);
    clearMessages();
    try {
      const trimmedName = displayName.trim();
      if (!trimmedName) {
        setError('Please enter your name');
        setLoading(false);
        return;
      }
      if (signupType === 'join' && !inviteCode) {
        setError('Please enter your invitation code.');
        setLoading(false);
        return;
      }
      await setupHouseholdForUser(u, {
        signupType,
        inviteCode,
        displayName: trimmedName
      });
      logger.info('Auth', 'SSO household setup completed', { signupType });
      sessionStorage.removeItem(SSO_SESSION_KEY);
      setAwaitingHousehold(false);
      if (onLoginSuccess) onLoginSuccess();
    } catch (err) {
      logger.error('Auth', 'SSO household setup failed', { error: err.message, code: err.code });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const dismissPasswordLinkFlow = () => {
    window.history.replaceState({}, '', '/signin');
    setPasswordLinkAction(null);
    setNewPasswordFromEmail('');
    setConfirmNewPasswordFromEmail('');
    clearMessages();
  };

  const handleConfirmPasswordFromEmailLink = async (e) => {
    e?.preventDefault();
    if (!passwordLinkAction || passwordLinkAction === 'checking' || passwordLinkAction === 'invalid') {
      return;
    }
    const { oobCode } = passwordLinkAction;
    if (newPasswordFromEmail !== confirmNewPasswordFromEmail) {
      setError('Passwords do not match.');
      return;
    }
    if (newPasswordFromEmail.length < 6) {
      setError(humanizeAuthError({ code: 'auth/weak-password' }));
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await confirmPasswordReset(auth, oobCode, newPasswordFromEmail);
      window.history.replaceState({}, '', '/signin');
      setPasswordLinkAction(null);
      setNewPasswordFromEmail('');
      setConfirmNewPasswordFromEmail('');
      setSuccess('Your password was updated. Sign in below.');
      logger.info('Auth', 'Password reset from email link completed');
    } catch (err) {
      logger.error('Auth', 'confirmPasswordReset failed', {
        error: err.message,
        code: err.code
      });
      setError(humanizeAuthError(err));
    }
    setLoading(false);
  };

  const cancelSsoHouseholdSetup = async () => {
    const current = auth.currentUser;
    setLoading(true);
    clearMessages();
    try {
      if (current) {
        await deleteUser(current).catch((err) => {
          logger.warn('Auth', 'Could not delete incomplete SSO user; signing out instead', {
            error: err.message
          });
          return firebaseSignOut(auth);
        });
      }
    } finally {
      sessionStorage.removeItem(SSO_SESSION_KEY);
      setAwaitingHousehold(false);
      setDisplayName('');
      setInviteCode('');
      setPassword('');
      setMode('signin');
      setLoading(false);
    }
  };

  const passwordLinkBlocking =
    passwordLinkAction === 'checking' ||
    (typeof passwordLinkAction === 'object' && passwordLinkAction !== null);

  const subtitle = passwordLinkBlocking
    ? 'Set a new password'
    : pendingCredential
      ? 'Link your account'
      : awaitingHousehold
        ? 'Finish setting up your account'
        : mode === 'signin'
          ? 'Sign in to your account'
          : signupStep === 'choice'
            ? "Let's get your household set up"
            : signupType === 'join'
              ? 'Join your household'
              : 'Create your account';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#F7F7F7' }}>
      <div className="bg-white rounded-3xl shadow-lg p-8 max-w-md w-full border border-gray-200">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ backgroundColor: '#FF7A7A' }}>
            <Mail size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            <a href="/" style={{ color: 'inherit', textDecoration: 'none' }}>Provisions</a>
          </h1>
          <p className="text-gray-600 font-medium">{subtitle}</p>
        </div>

        {passwordLinkAction === 'checking' && (
          <div className="flex flex-col items-center justify-center gap-4 py-8 text-gray-600">
            <Loader2 className="animate-spin" size={36} style={{ color: '#FF7A7A' }} aria-hidden />
            <p className="text-sm font-medium">Verifying reset link…</p>
          </div>
        )}

        {passwordLinkAction && typeof passwordLinkAction === 'object' && (
          <form
            className="space-y-4"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && newPasswordFromEmail && confirmNewPasswordFromEmail) {
                handleConfirmPasswordFromEmailLink(e);
              }
            }}
          >
            <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-4 leading-relaxed">
              Choose a new password for <span className="font-semibold">{passwordLinkAction.email}</span>.
            </p>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">New password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
                <input
                  name="new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={newPasswordFromEmail}
                  onChange={(e) => setNewPasswordFromEmail(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 rounded-lg"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Confirm new password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
                <input
                  name="confirm-new-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmNewPasswordFromEmail}
                  onChange={(e) => setConfirmNewPasswordFromEmail(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                  autoComplete="new-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </div>
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={
                loading || !newPasswordFromEmail || !confirmNewPasswordFromEmail
              }
              className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
              style={{
                backgroundColor:
                  loading || !newPasswordFromEmail || !confirmNewPasswordFromEmail
                    ? undefined
                    : '#FF7A7A'
              }}
            >
              {loading ? 'Saving…' : 'Save password'}
            </button>
            <button
              type="button"
              onClick={dismissPasswordLinkFlow}
              disabled={loading}
              className="w-full text-sm font-semibold text-gray-600 hover:underline transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {passwordLinkAction === 'invalid' && (
          <div className="space-y-4">
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">
                {error}
              </div>
            )}
            <button
              type="button"
              onClick={dismissPasswordLinkFlow}
              className="w-full text-white py-3 rounded-xl font-bold transition-colors hover:opacity-90"
              style={{ backgroundColor: '#FF7A7A' }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {pendingCredential && (
          <form
            className="space-y-4"
            autoComplete="on"
            onSubmit={(e) => {
              e.preventDefault();
              if (!loading && password) handleLinkAccounts();
            }}
          >
            <p className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-xl p-4 leading-relaxed">
              An account for <span className="font-semibold">{pendingLinkEmail}</span> already exists with a password. Sign in with your password to link {pendingLinkProvider === 'google' ? 'Google' : 'Apple'} sign-in to it.
            </p>
            <input
              type="email"
              name="email"
              value={pendingLinkEmail}
              autoComplete="username"
              readOnly
              hidden
              aria-hidden="true"
              tabIndex={-1}
            />
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                  autoComplete="current-password"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 rounded-lg"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
              style={{ backgroundColor: (loading || !password) ? undefined : '#FF7A7A' }}
            >
              {loading ? 'Linking...' : 'Sign in and link'}
            </button>
            <button
              type="button"
              onClick={cancelLinking}
              disabled={loading}
              className="w-full text-sm font-semibold text-gray-600 hover:underline transition-colors"
            >
              Cancel
            </button>
          </form>
        )}

        {!pendingCredential && awaitingHousehold && (
          <div className="space-y-4">
            <div className="flex rounded-xl overflow-hidden border-2 border-gray-200">
              <button onClick={() => { setSignupType('create'); clearMessages(); }} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${signupType === 'create' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={signupType === 'create' ? { backgroundColor: '#FF7A7A' } : {}}>New household</button>
              <button onClick={() => { setSignupType('join'); clearMessages(); }} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${signupType === 'join' ? 'text-white' : 'text-gray-600 hover:bg-gray-50'}`} style={signupType === 'join' ? { backgroundColor: '#FF7A7A' } : {}}>Join with code</button>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Jane" className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors" />
            </div>
            {signupType === 'join' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Invitation Code</label>
                <input type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1'))} placeholder="16-character code" className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors font-mono tracking-wider" />
              </div>
            )}
            {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
            <button
              onClick={handleCompleteSsoHousehold}
              disabled={loading}
              className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
              style={{ backgroundColor: loading ? undefined : '#FF7A7A' }}
            >
              {loading ? 'Loading...' : signupType === 'create' ? 'Create Household' : 'Join Household'}
            </button>
            <button
              onClick={cancelSsoHouseholdSetup}
              disabled={loading}
              className="w-full text-sm font-semibold text-gray-600 hover:underline transition-colors"
            >
              Cancel and sign out
            </button>
          </div>
        )}

        {!pendingCredential && !awaitingHousehold && !passwordLinkBlocking && passwordLinkAction !== 'invalid' && mode === 'signup' && signupStep === 'choice' && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => { setSignupType('create'); setSignupStep('auth'); clearMessages(); }}
              disabled={loading}
              className="w-full flex items-start gap-4 text-left p-5 border-2 border-gray-900 rounded-2xl bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: '#FFE8E8' }}>
                <Home size={22} style={{ color: '#FF7A7A' }} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-base text-gray-900">Create a new household</div>
                <div className="text-sm text-gray-500 mt-0.5">Start fresh — invite others later</div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-gray-400 mt-1" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => { setSignupType('join'); setSignupStep('auth'); clearMessages(); }}
              disabled={loading}
              className="w-full flex items-start gap-4 text-left p-5 border-2 border-gray-200 rounded-2xl bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-gray-100">
                <KeyRound size={22} className="text-gray-500" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <div className="font-bold text-base text-gray-900">Join an existing household</div>
                <div className="text-sm text-gray-500 mt-0.5">Use the invite code you were sent</div>
              </div>
              <ChevronRight size={18} className="shrink-0 text-gray-400 mt-1" aria-hidden="true" />
            </button>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => { setMode('signin'); setSignupStep('choice'); clearMessages(); }}
                className="w-full text-sm font-semibold hover:underline"
                style={{ color: '#FF7A7A' }}
              >
                Already have an account? Sign in
              </button>
            </div>
          </div>
        )}

        {!pendingCredential && !awaitingHousehold && !passwordLinkBlocking && passwordLinkAction !== 'invalid' && (mode === 'signin' || (mode === 'signup' && signupStep === 'auth')) && (
          <div className="space-y-4">
            {mode === 'signup' && (
              <button
                type="button"
                onClick={() => { setSignupStep('choice'); clearMessages(); }}
                disabled={loading}
                className="text-sm font-semibold text-gray-500 hover:text-gray-700 flex items-center gap-1 -mt-2"
              >
                <ChevronLeft size={16} aria-hidden="true" />
                Back
              </button>
            )}

            {mode === 'signup' && signupType === 'join' && (
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Invitation code</label>
                <input
                  type="text"
                  name="inviteCode"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1'))}
                  placeholder="16-character code"
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors font-mono tracking-wider text-center"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleSsoSignIn('google')}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3 border-2 border-gray-900 rounded-xl font-semibold text-gray-900 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                <span>Continue with Google</span>
              </button>
              <button
                type="button"
                onClick={() => handleSsoSignIn('apple')}
                disabled={loading}
                className="w-full flex items-center justify-center gap-3 py-3 border-2 border-gray-900 rounded-xl font-semibold text-gray-900 bg-white hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                <span>Continue with Apple</span>
              </button>
            </div>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px bg-gray-200 flex-1" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">or</span>
              <div className="h-px bg-gray-200 flex-1" />
            </div>

            <form
              className="space-y-4"
              autoComplete="on"
              onSubmit={(e) => {
                e.preventDefault();
                if (loading) return;
                if (mode === 'signin') handleSignIn();
                else handleSignUp();
              }}
            >
              {mode === 'signup' && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
                  <input
                    type="text"
                    name="name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                    autoComplete="name"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 text-gray-400" size={20} />
                  <input
                    type="email"
                    name="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                    autoComplete={mode === 'signin' ? 'username' : 'email'}
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
                  <input
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-12 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-700 rounded-lg"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
              {success && <div className="bg-green-50 text-green-600 px-4 py-3 rounded-xl text-sm font-medium border border-green-200">{success}</div>}
              <button type="submit" disabled={loading} className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90" style={{ backgroundColor: loading ? undefined : '#FF7A7A' }}>
                {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : signupType === 'create' ? 'Create Household' : 'Join Household'}
              </button>
              {mode === 'signin' && (
                <button type="button" onClick={handleResetPassword} disabled={loading} className="w-full text-sm font-semibold hover:underline text-gray-600 transition-colors">
                  Forgot password?
                </button>
              )}
              <button type="button" onClick={() => { const next = mode === 'signin' ? 'signup' : 'signin'; setMode(next); setSignupStep('choice'); clearMessages(); }} className="w-full text-sm font-semibold hover:underline" style={{ color: '#FF7A7A' }}>
                {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
              </button>
            </form>
          </div>
        )}

        <p className="mt-8 pt-6 border-t border-gray-100 text-center text-xs text-gray-500 leading-relaxed">
          By continuing, you agree to the{' '}
          <button type="button" onClick={onOpenTerms} className="font-semibold underline decoration-gray-300 hover:decoration-gray-600 text-gray-600">
            Terms of Service
          </button>{' '}
          and{' '}
          <button type="button" onClick={onOpenPrivacy} className="font-semibold underline decoration-gray-300 hover:decoration-gray-600 text-gray-600">
            Privacy Policy
          </button>
          .
        </p>
      </div>
    </div>
  );
}

function AuthLoginScreen({ onLoginSuccess, legalView, onOpenLegal, onCloseLegal, initialMode, initialSignupType, initialInviteCode }) {
  if (legalView === 'privacy') {
    return <PrivacyPolicyPage onBack={onCloseLegal} />;
  }
  if (legalView === 'terms') {
    return <TermsOfServicePage onBack={onCloseLegal} />;
  }
  return (
    <Login
      onLoginSuccess={onLoginSuccess}
      onOpenPrivacy={() => onOpenLegal('privacy')}
      onOpenTerms={() => onOpenLegal('terms')}
      initialMode={initialMode}
      initialSignupType={initialSignupType}
      initialInviteCode={initialInviteCode}
    />
  );
}

function UpdateToast({ onUpdate, onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-up">
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg" style={{ backgroundColor: '#FFE5E5' }}>
            <RefreshCw size={20} className="text-[#FF7A7A]" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 text-sm mb-1">
              Update Available
            </h3>
            <p className="text-gray-600 text-xs mb-3">
              A new version is ready. Reload to get the latest features.
            </p>
            <div className="flex gap-2">
              <button
                onClick={onUpdate}
                className="flex-1 px-3 py-2 text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
                style={{ backgroundColor: '#FF7A7A' }}
              >
                Reload Now
              </button>
              <button
                onClick={onDismiss}
                className="px-3 py-2 text-gray-600 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-colors"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OfflineReadyToast({ onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50 animate-slide-up">
      <div className="bg-white rounded-xl shadow-lg border-2 border-gray-200 p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-green-100">
            <CheckCircle size={20} className="text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 text-sm mb-1">
              Ready to Work Offline
            </h3>
            <p className="text-gray-600 text-xs mb-3">
              You can now use this app without an internet connection.
            </p>
            <button
              onClick={onDismiss}
              className="px-3 py-2 text-gray-600 rounded-lg font-semibold text-sm hover:bg-gray-100 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function insightsMemberLabel(members, uid) {
  const m = members?.[uid];
  const name = m?.displayName?.trim();
  if (name) return name;
  if (m?.email) return m.email;
  return 'Unknown member';
}

const ITEM_LOG_ACTIONS = new Set(['added', 'removed', 'checked', 'unchecked', 'renamed']);

/** Past-tense verb for list activity modal copy only ("Jane checked", not "Purchased"). */
function itemLogActionVerbModal(action) {
  if (action === 'added') return 'added';
  if (action === 'removed') return 'removed';
  if (action === 'checked') return 'checked';
  if (action === 'unchecked') return 'unchecked';
  if (action === 'renamed') return 'renamed';
  return action || 'recorded';
}

function HouseholdItemEventLogModal({ onClose, members, eventsNewestFirst }) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-3xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="household-item-event-log-title"
      >
        <div className="p-5 border-b border-gray-200 shrink-0">
          <h2 id="household-item-event-log-title" className="text-xl font-bold text-gray-800">
            List activity log
          </h2>
          <p className="text-gray-600 text-xs font-medium mt-1">
            Adds, removals, renames, purchases, and unchecks. Newest first.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {eventsNewestFirst.length === 0 ? (
            <div className="text-gray-500 text-sm py-8 text-center">No list activity recorded yet.</div>
          ) : (
            <ul className="space-y-2">
              {eventsNewestFirst.map((e, i) => (
                <li
                  key={`${e.ts}-${i}-${e.prevName || ''}-${e.name || ''}-${e.action || ''}`}
                  className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100 text-sm"
                >
                  <div className="text-xs text-gray-500 min-w-0 leading-snug">
                    <span className="tabular-nums text-gray-500">{formatLocalDateTimePhrase(e.ts)}</span>
                    <span className="text-gray-400"> · </span>
                    <span className="font-semibold text-gray-800">{insightsMemberLabel(members, e.uid)}</span>
                    <span className="text-gray-600"> {itemLogActionVerbModal(e.action)}</span>
                  </div>
                  <div className="mt-1 font-semibold text-gray-800 break-words text-sm min-w-0">
                    {e.action === 'renamed' && e.prevName ? (
                      <>
                        <span className="text-gray-600 font-medium">{e.prevName}</span>
                        <span className="text-gray-400 font-normal mx-0.5">→</span>
                        <span>{e.name || '(unnamed)'}</span>
                      </>
                    ) : (
                      <>{e.name || '(unnamed)'}</>
                    )}
                    {e.category ? (
                      <span className="text-gray-500 font-medium text-xs"> · {e.category}</span>
                    ) : null}
                    {e.qty != null && Number(e.qty) !== 1 ? (
                      <span className="text-gray-500 font-medium text-xs"> · qty {e.qty}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="p-4 border-t border-gray-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function HouseholdInsightsPage({ householdId, liveBucketMonthKey, liveBucketVal, members }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [events, setEvents] = useState([]);
  const [commonByCat, setCommonByCat] = useState({});
  const [categoriesV2, setCategoriesV2] = useState({});
  const [visibleByCatId, setVisibleByCatId] = useState({});
  const [eventLogOpen, setEventLogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [evList, visSnap, catSnap] = await Promise.all([
          getHouseholdItemEventsMerged(database, householdId, {
            liveBucketMonthKey,
            liveBucketVal,
          }),
          get(ref(database, `households/${householdId}/taxonomy/visible-items`)),
          get(ref(database, `households/${householdId}/taxonomy/categories`)),
        ]);
        if (cancelled) return;
        const visRaw = visSnap.val() || {};
        const catRaw = catSnap.val() || {};
        // Build visibleItemsByCategoryId (keyed by catId) for new analytics API
        const visByCatId = {};
        const cByCat = {};
        for (const [catId, items] of Object.entries(visRaw)) {
          const arr = Array.isArray(items) ? items : Object.values(items || {});
          const filtered = arr.filter(Boolean);
          visByCatId[catId] = filtered;
          const name = catRaw[catId]?.name;
          if (name) cByCat[name] = filtered;
        }
        setEvents(evList);
        setCommonByCat(cByCat);
        setCategoriesV2(catRaw);
        setVisibleByCatId(visByCatId);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId, liveBucketMonthKey, liveBucketVal]);

  const top = events.length ? topPurchased(events, { limit: 15 }) : [];
  const promote = events.length ? promotionCandidates(events, visibleByCatId, categoriesV2) : [];
  const dormant = Object.keys(visibleByCatId).length ? dormantShortcuts(events, visibleByCatId, categoriesV2) : [];
  const users = events.length ? userContributions(events) : [];

  const itemLogEventsNewestFirst = useMemo(() => {
    const rows = events.filter((e) => e && ITEM_LOG_ACTIONS.has(e.action));
    rows.sort((a, b) => b.ts - a.ts);
    return rows;
  }, [events]);

  return (
    <div className="max-w-2xl mx-auto px-4 pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Household Insights</h1>
        <p className="text-gray-600 font-medium text-sm mt-1">Based on what your household adds, purchases, and removes from the list.</p>
      </div>
      <div className="space-y-6 text-sm">
          {loading && <div className="text-gray-500">Loading…</div>}
          {error && (
            <div className="text-red-600">
              <p className="font-medium">Could not load insights.</p>
              <p className="text-xs text-gray-500 mt-1 font-normal">
                Check your connection and try again.
                {import.meta.env.DEV && error ? (
                  <span className="block mt-1 font-mono text-gray-400 break-all">{error}</span>
                ) : null}
              </p>
            </div>
          )}
          {!loading && !error && !events.length && (
            <div className="text-gray-500">Not enough activity to show patterns yet. Add items and record what you purchase as you shop to build history.</div>
          )}
          {!loading && !error && events.length > 0 && (
            <>
              <section>
                <h3 className="font-bold text-gray-800 mb-2">Top items</h3>
                <p className="text-xs text-gray-500 mb-2">Purchased most often, all time.</p>
                {top.length === 0 ? <div className="text-gray-500">No purchases yet.</div> : (
                  <div className="space-y-1">
                    {top.map(s => (
                      <div key={s.key} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{s.name}</span> <span className="text-gray-500 text-xs">· {s.category}</span></div>
                        <div className="text-gray-600">{s.checked}× purchased</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Purchased often, not a shortcut</h3>
                <p className="text-xs text-gray-500 mb-2">Purchased several times recently, but not among the shortcuts you use while planning your list. You may see the same suggestions when you&apos;re planning your list.</p>
                {promote.length === 0 ? <div className="text-gray-500">None right now.</div> : (
                  <div className="space-y-1">
                    {promote.map(c => (
                      <div key={`${c.categoryId || c.category}::${c.name}`} className="flex justify-between items-center bg-amber-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{c.name}</span> <span className="text-gray-500 text-xs">· {c.category}</span></div>
                        <div className="text-gray-600">{c.checkedCount}× purchased</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Shortcuts without recent use</h3>
                <p className="text-xs text-gray-500 mb-2">Shortcuts with no recent additions or purchases. What counts as recent depends on the category. You may see the same list when you&apos;re planning your list.</p>
                {dormant.length === 0 ? <div className="text-gray-500">None right now.</div> : (
                  <div className="space-y-1">
                    {dormant.slice(0, 30).map(d => (
                      <div key={`${d.categoryId}::${d.name}`} className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-semibold">{d.name}</span> <span className="text-gray-500 text-xs">· {d.categoryName}</span></div>
                        <div className="text-gray-600 text-right max-w-[11rem] shrink-0">
                          {d.daysSinceLastUse == null
                            ? 'No recent activity'
                            : `${d.daysSinceLastUse} ${d.daysSinceLastUse === 1 ? 'day' : 'days'} since last added or purchased`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="font-bold text-gray-800 mb-2">Household activity</h3>
                <p className="text-xs text-gray-500 mb-2">Additions, purchases, and removals per person.</p>
                {users.length === 0 ? (
                  <div className="text-gray-500">No per-person breakdown yet. We can&apos;t tell who added, purchased, or removed items.</div>
                ) : (
                  <div className="space-y-1">
                    {users.map(u => (
                      <div key={u.uid} className="flex justify-between items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                        <div className="font-medium text-gray-800 truncate min-w-0">{insightsMemberLabel(members, u.uid)}</div>
                        <div className="text-gray-600 text-xs shrink-0">Added {u.added} · Purchased {u.checked} · Removed {u.removed}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
      </div>
      {!loading && !error && (
        <div className="mt-8 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => setEventLogOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl border-2 border-gray-200 bg-white text-gray-700 font-semibold text-sm hover:bg-gray-50 transition-colors"
          >
            <ScrollText size={18} className="text-gray-500 shrink-0" aria-hidden />
            View full list activity log
          </button>
          <p className="text-center text-xs text-gray-500 mt-2">
            Adds, removals, renames, purchases, and unchecks — same data as insights, full timeline.
          </p>
        </div>
      )}
      {eventLogOpen && (
        <HouseholdItemEventLogModal
          onClose={() => setEventLogOpen(false)}
          members={members}
          eventsNewestFirst={itemLogEventsNewestFirst}
        />
      )}
    </div>
  );
}

function AdminPanel({ onClose, householdId, members, adminUid }) {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSentTo, setInviteSentTo] = useState(null);
  const [inviteError, setInviteError] = useState(null);

  useEffect(() => {
    if (!householdId) return;
    const codesRef = ref(database, `households/${householdId}/inviteCodes`);
    const unsubscribe = onValue(codesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const codesArray = Object.entries(data)
          .map(([code, val]) => ({ id: code, code, ...val }))
          .filter(c => !c.used && Date.now() <= new Date(c.expiresAt).getTime());
        setInvitations(codesArray);
      } else {
        setInvitations([]);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [householdId]);

  const generateCode = () => {
    // Exclude visually ambiguous chars: O (vs 0), I (vs 1), L (vs 1)
    const chars = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 16; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  };

  const createInvitation = async () => {
    if (!householdId) return;
    if (!assertWriteAllowed('gated_action')) return;
    setCreating(true);
    setInviteError(null);
    setInviteSentTo(null);
    const code = generateCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    const codeData = { code, expiresAt: expiresAt.toISOString(), used: false, createdAt: Date.now(), householdId };

    await set(ref(database, `households/${householdId}/inviteCodes/${code}`), codeData);
    await set(ref(database, `inviteCodes/${code}`), { householdId, expiresAt: expiresAt.toISOString(), used: false, createdAt: Date.now() });
    trackEvent('invite_code_generated', {});

    const emailToSend = inviteEmail.trim();
    if (emailToSend) {
      setInviteSending(true);
      try {
        const workerUrl = (import.meta.env.VITE_INVITE_WORKER_URL || '').replace(/\/$/, '');
        const res = await fetch(`${workerUrl}/send-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, inviteeEmail: emailToSend, householdId }),
        });
        const data = await res.json();
        if (data.ok) {
          setInviteSentTo(emailToSend);
          setInviteEmail('');
        } else {
          setInviteError(data.error || 'Failed to send invite email.');
        }
      } catch {
        setInviteError('Could not reach invite service. Copy the code below and share it manually.');
      } finally {
        setInviteSending(false);
      }
    }

    setCreating(false);
  };

  const deleteInvitation = async (code) => {
    if (!assertWriteAllowed('gated_action')) return;
    await remove(ref(database, `households/${householdId}/inviteCodes/${code}`));
    await remove(ref(database, `inviteCodes/${code}`));
  };

  const copy = (code) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-3xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-2xl font-bold text-gray-800">Household</h2>
          </div>
        <div className="p-6 flex-1 overflow-y-auto space-y-6">
          {members && Object.keys(members).length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Users size={16} className="text-gray-400" />
                <span className="text-sm font-bold text-gray-500 uppercase tracking-wide">Members</span>
              </div>
              <div className="space-y-2">
                {Object.entries(members).map(([uid, m]) => (
                  <div key={uid} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
                    <span className="font-medium text-gray-800">{m.displayName || m.email}</span>
                    {uid === adminUid && (
                      <span className="text-xs font-bold text-white rounded-full px-2.5 py-0.5" style={{ backgroundColor: '#FF7A7A' }}>Admin</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wide">Invite codes</span>
            </div>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="Invitee's email (optional)"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 mb-3"
          />
          <button onClick={createInvitation} disabled={creating || inviteSending} className="w-full text-white py-3.5 rounded-xl font-bold hover:opacity-90 disabled:bg-gray-300 flex items-center justify-center gap-2 mb-3 transition-opacity" style={{ backgroundColor: (creating || inviteSending) ? undefined : '#10B981' }}>
            <Plus size={20} strokeWidth={2.5} />
            {inviteSending ? 'Sending invite…' : creating ? 'Creating…' : 'Create New Code'}
          </button>
          {inviteSentTo && (
            <p className="text-sm text-green-600 font-medium text-center mb-3">Invite sent to {inviteSentTo}</p>
          )}
          {inviteError && (
            <p className="text-sm text-red-500 font-medium text-center mb-3">{inviteError}</p>
          )}
          {loading ? (
            <div className="text-center py-8 text-gray-500 font-medium">Loading...</div>
          ) : invitations.length === 0 ? (
            <div className="text-center py-8 text-gray-500 font-medium">No active codes</div>
          ) : (
            <div className="space-y-3">
              {invitations.map(inv => (
                <div key={inv.id} className="bg-gray-50 rounded-2xl p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl font-mono font-bold" style={{ color: '#FF7A7A' }}>{inv.code}</span>
                    <div className="flex gap-2">
                      <button onClick={() => copy(inv.code)} className="p-2 text-gray-600 hover:text-gray-800 rounded-lg transition-colors">
                        {copiedCode === inv.code ? <CheckCircle size={20} className="text-green-600" /> : <Copy size={20} />}
                      </button>
                      <button onClick={() => deleteInvitation(inv.id)} className="p-2 text-gray-600 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={20} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 font-medium">Expires: {new Date(inv.expiresAt).toLocaleString()}</p>
                  {inv.inviteeEmail && (
                    <p className="text-xs text-gray-400 mt-0.5">Sent to: {inv.inviteeEmail}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          </div>
        </div>
        <div className="p-6 border-t border-gray-200">
          <button onClick={onClose} className="w-full bg-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-300 transition-colors">Close</button>
        </div>
      </div>
    </div>
</>
  );
}

function DisplayNamePrompt({ user, householdId, onSaved }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Please enter your name'); return; }
    setLoading(true);
    setError('');
    try {
      await set(ref(database, `users/${user.uid}/displayName`), trimmed);
      if (householdId) {
        await set(ref(database, `households/${householdId}/members/${user.uid}`), {
          displayName: trimmed,
          email: user.email
        });
      }
      onSaved(trimmed);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">What's your name?</h2>
          <p className="text-gray-600 font-medium mt-1">This helps your household know who added items</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Your name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane"
              className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-gray-300 focus:outline-none transition-colors"
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
        </div>
        <div className="p-6 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            className="w-full text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
            style={{ backgroundColor: loading || !name.trim() ? undefined : '#FF7A7A' }}
          >
            {loading ? 'Saving...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemBottomSheet({ item, members, lastPurchasedTs, aisles, categories, onClose }) {
  const [nameDraft, setNameDraft] = useState(item.name || '');
  const [quantityDraft, setQuantityDraft] = useState(item.quantity || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [configOpen, setConfigOpen] = useState(false);
  const [configAisleId, setConfigAisleId] = useState(item.suggestionConfig?.aisleId || '');
  const [configCatId, setConfigCatId] = useState(item.suggestionConfig?.categoryId || '');
  const [pinActionLoading, setPinActionLoading] = useState(false);
  const [promotedConfig, setPromotedConfig] = useState(null);
  const [translateY, setTranslateY] = useState(0);
  const dragStartYRef = useRef(null);

  const suggestionConfig = promotedConfig || item.suggestionConfig || null;
  const aisleMap = aisles || {};
  const categoryMap = categories || {};

  const orderedAisles = Object.entries(aisleMap)
    .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
    .map(([id, a]) => ({ id, name: a?.name || '' }));

  const categoriesForAisle = (aisleId) =>
    Object.entries(categoryMap)
      .filter(([, c]) => c?.aisleId === aisleId)
      .sort(([, a], [, b]) => (a?.order ?? 0) - (b?.order ?? 0))
      .map(([id, c]) => ({ id, name: c?.name || '' }));

  /** Props are a snapshot; compare commits to last persisted values, not stale `item`. */
  const lastCommittedNameRef = useRef(String(item.name ?? ''));
  const lastCommittedQtyRef = useRef(String(item.quantity ?? ''));

  useEffect(() => {
    setNameDraft(item.name || '');
    setSaveError('');
  }, [item.itemKey, item.id, item.name]);

  useEffect(() => {
    setQuantityDraft(item.quantity || '');
  }, [item]);

  useEffect(() => {
    lastCommittedNameRef.current = String(item.name ?? '');
    lastCommittedQtyRef.current = String(item.quantity ?? '');
  }, [item.itemKey, item.id, item.name, item.quantity]);

  // Reset picker + drag state when the underlying item changes (sheet reopen).
  useEffect(() => {
    setConfigOpen(false);
    setPromotedConfig(null);
    setPinActionLoading(false);
    setTranslateY(0);
    setConfigAisleId(item.suggestionConfig?.aisleId || '');
    setConfigCatId(item.suggestionConfig?.categoryId || '');
  }, [item.itemKey, item.id]);

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(item.name || '');
      return;
    }
    if (trimmed === String(item.name ?? '').trim()) return;
    if (item.onNameChange) {
      setIsSaving(true);
      setSaveError('');
      try {
        await item.onNameChange(item.itemKey, trimmed);
      } catch (err) {
        setSaveError(err?.message || 'Failed to save name');
        throw err;
      } finally {
        setIsSaving(false);
      }
      lastCommittedNameRef.current = trimmed;
    }
  };

  const commitQuantity = async (nextValue) => {
    const trimmed = String(nextValue ?? '').trim();
    if (trimmed === lastCommittedQtyRef.current.trim()) return;
    if (item.onQuantityChange) {
      await item.onQuantityChange(item.itemKey, trimmed);
      lastCommittedQtyRef.current = trimmed;
    }
  };

  const nudgeQuantity = async (delta) => {
    const current = quantityDraft.trim();
    const match = current.match(/^(\d+)(\s+.*)?$/);
    const currentNumber = match ? Number(match[1]) : 0;
    const remainder = match?.[2] || (current && !match ? ` ${current}` : '');
    const nextNumber = Math.max(1, currentNumber + delta);
    const nextValue = `${nextNumber}${remainder}`.trim();
    setQuantityDraft(nextValue);
    await commitQuantity(nextValue);
  };

  const handleClose = async () => {
    try {
      await commitName();
      await commitQuantity(quantityDraft);
      onClose();
    } catch {
      // Keep the sheet open if the save fails so the user can retry.
    }
  };

  const addedByName = item.addedBy && members[item.addedBy]
    ? members[item.addedBy].displayName
    : null;
  const addedAtFormatted = item.addedAt ? formatLocalDateTimePhrase(item.addedAt) : null;

  const lastPurchasedFormatted = lastPurchasedTs
    ? formatRelativeTime(lastPurchasedTs)
    : null;

  // Swipe-to-dismiss on mobile (handle only, not sheet body — avoids fighting internal scroll).
  const handleDragStart = (e) => {
    dragStartYRef.current = e.touches?.[0]?.clientY ?? null;
  };
  const handleDragMove = (e) => {
    if (dragStartYRef.current == null) return;
    const currentY = e.touches?.[0]?.clientY ?? dragStartYRef.current;
    const delta = Math.max(0, currentY - dragStartYRef.current);
    setTranslateY(delta);
  };
  const handleDragEnd = () => {
    if (dragStartYRef.current == null) return;
    dragStartYRef.current = null;
    const SHEET_DISMISS_PX = 100;
    if (translateY >= SHEET_DISMISS_PX) {
      void handleClose();
    } else {
      setTranslateY(0);
    }
  };

  // Backdrop fades proportionally with the sheet drag.
  const backdropOpacity = translateY > 0
    ? Math.max(0, 1 - translateY / 300)
    : 1;

  // Breadcrumb (taxonomy position) for the two-row block.
  const breadcrumbCategoryId = suggestionConfig?.categoryId || item.categoryId || null;
  const breadcrumbAisleId = suggestionConfig?.aisleId
    || (breadcrumbCategoryId ? categoryMap[breadcrumbCategoryId]?.aisleId || null : null);
  const breadcrumbAisleName = breadcrumbAisleId && aisleMap[breadcrumbAisleId]?.name
    ? formatAisleNameForDisplay(aisleMap[breadcrumbAisleId].name)
    : null;
  const breadcrumbCategoryName = breadcrumbCategoryId && categoryMap[breadcrumbCategoryId]?.name
    ? categoryMap[breadcrumbCategoryId].name
    : null;
  const hasBreadcrumb = Boolean(breadcrumbAisleName && breadcrumbCategoryName);
  const canEditTaxonomy = Boolean(suggestionConfig);
  const showUnpin = Boolean(suggestionConfig?.onRemove);
  const showPin = Boolean(item.promoteToShortcut && !showUnpin);
  const canPinAction = Boolean(showUnpin || showPin);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-4"
      onClick={handleClose}
    >
      <div
        className="absolute inset-0 bg-black/40 transition-opacity md:bg-black/50"
        style={{ opacity: backdropOpacity }}
      />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-xl animate-slide-up md:max-h-[85vh] md:max-w-md md:overflow-hidden md:rounded-3xl md:border md:border-gray-200 md:animate-none md:shadow-xl md:flex md:flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ transform: translateY > 0 ? `translateY(${translateY}px)` : undefined, transition: dragStartYRef.current == null ? 'transform 200ms ease-out' : 'none' }}
      >
        <div
          className="flex justify-center pt-3 pb-1 md:hidden touch-none"
          onTouchStart={handleDragStart}
          onTouchMove={handleDragMove}
          onTouchEnd={handleDragEnd}
        >
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-6 pt-2 md:flex-1 md:flex md:flex-col md:min-h-0 md:overflow-y-auto md:pt-6 md:pb-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-medium text-gray-500">Name</p>
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                className="w-full text-lg font-bold text-gray-800 md:text-xl bg-transparent border border-transparent rounded-xl px-0 py-1 -mx-0 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30 focus:border-[#FF7A7A]/40"
                aria-label="Item name"
              />
              {saveError && (
                <p className="text-xs font-medium text-red-600">{saveError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving}
              className="flex flex-shrink-0 p-2 -mr-2 -mt-1 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
              aria-label="Close"
            >
              <X size={22} />
            </button>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500">Quantity</p>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="text"
                  value={quantityDraft}
                  onChange={(e) => setQuantityDraft(e.target.value)}
                  onBlur={() => commitQuantity(quantityDraft)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder="Optional"
                  className="flex-1 bg-transparent text-sm font-medium text-gray-700 placeholder:text-gray-400 focus:outline-none min-w-0"
                />
                <button
                  type="button"
                  onClick={() => nudgeQuantity(-1)}
                  className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center"
                  aria-label="Decrease quantity"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => nudgeQuantity(1)}
                  className="h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <div className="mt-8 space-y-1 text-xs text-gray-400">
            {(addedByName || addedAtFormatted) && (
              <p>
                {addedByName ? `Added by ${addedByName}` : 'Added'}
                {addedAtFormatted ? ` · ${addedAtFormatted}` : ''}
              </p>
            )}
            <p>{lastPurchasedFormatted ? `Last purchased: ${lastPurchasedFormatted}` : 'No purchase history'}</p>
          </div>

          {item.promotionHint && (
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs text-amber-800">
                Bought {item.promotionHint.checkedCount}× recently
              </p>
            </div>
          )}

          {(hasBreadcrumb || canPinAction) && (
            <div className="mt-6 space-y-2">
              {hasBreadcrumb && (
                canEditTaxonomy ? (
                  <button
                    type="button"
                    onClick={() => {
                      setConfigAisleId(suggestionConfig.aisleId || '');
                      setConfigCatId(suggestionConfig.categoryId || '');
                      setConfigOpen(open => !open);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 hover:bg-gray-100 text-left"
                  >
                    <span className="flex-1 text-xs text-gray-500">
                      <span className="font-semibold tracking-wide">{breadcrumbAisleName}</span>
                      <span className="mx-1.5 text-gray-300">›</span>
                      <span>{breadcrumbCategoryName}</span>
                    </span>
                    <ChevronRight size={14} className={`text-gray-400 transition-transform ${configOpen ? 'rotate-90' : ''}`} />
                  </button>
                ) : (
                  <div className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50">
                    <span className="flex-1 text-xs text-gray-500">
                      <span className="font-semibold tracking-wide">{breadcrumbAisleName}</span>
                      <span className="mx-1.5 text-gray-300">›</span>
                      <span>{breadcrumbCategoryName}</span>
                    </span>
                  </div>
                )
              )}

              {canEditTaxonomy && configOpen && (
                <div className="rounded-xl bg-gray-50 p-4 space-y-3">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-500">Aisle</label>
                    <select
                      value={configAisleId}
                      onChange={(e) => {
                        const nextAisle = e.target.value;
                        setConfigAisleId(nextAisle);
                        const opts = categoriesForAisle(nextAisle);
                        setConfigCatId(opts[0]?.id || '');
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30"
                    >
                      {orderedAisles.map(a => (
                        <option key={a.id} value={a.id}>{formatAisleNameForDisplay(a.name)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-gray-500">Category</label>
                    <select
                      value={configCatId}
                      onChange={async (e) => {
                        const nextCat = e.target.value;
                        setConfigCatId(nextCat);
                        if (!nextCat) return;
                        if (nextCat === suggestionConfig.categoryId) {
                          setConfigOpen(false);
                          return;
                        }
                        try {
                          await suggestionConfig.onMove(nextCat);
                        } catch {
                          /* silently fail */
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#FF7A7A]/30"
                    >
                      {categoriesForAisle(configAisleId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {canPinAction && (
                showUnpin ? (
                  <div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (pinActionLoading) return;
                        setPinActionLoading(true);
                        try {
                          await suggestionConfig.onRemove();
                        } catch {
                          /* keep sheet open; button re-enabled in finally */
                        } finally {
                          setPinActionLoading(false);
                        }
                      }}
                      disabled={pinActionLoading}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-red-200 bg-white text-red-600 text-sm font-semibold hover:bg-red-50 disabled:opacity-50"
                    >
                      <Pin size={14} />
                      {pinActionLoading ? 'Unpinning…' : 'Unpin'}
                    </button>
                    <p className="text-xs text-gray-400 text-center mt-1.5">Remove from shortcuts</p>
                  </div>
                ) : showPin ? (
                  <div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (pinActionLoading) return;
                        setPinActionLoading(true);
                        try {
                          const config = await item.promoteToShortcut();
                          if (config) setPromotedConfig(config);
                        } catch {
                          /* silently fail */
                        } finally {
                          setPinActionLoading(false);
                        }
                      }}
                      disabled={pinActionLoading}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border bg-white text-sm font-semibold hover:bg-[#FFF5F5] disabled:opacity-50"
                      style={{ color: '#FF7A7A', borderColor: 'rgba(255, 122, 122, 0.4)' }}
                    >
                      <Pin size={14} fill="currentColor" />
                      {pinActionLoading ? 'Pinning…' : 'Pin'}
                    </button>
                    <p className="text-xs text-gray-400 text-center mt-1.5">Keep as a shortcut in Plan mode</p>
                  </div>
                ) : null
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteAccountModal({ user, householdId, isAdmin, onClose, onDeleted }) {
  const providerId = user?.providerData?.[0]?.providerId || 'password';
  const isSso = providerId === 'google.com' || providerId === 'apple.com';
  const providerLabel = providerId === 'google.com' ? 'Google' : providerId === 'apple.com' ? 'Apple' : '';

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const finishDeletion = async () => {
    await deleteAccountDataAndAuth(user, householdId, isAdmin);
    onDeleted();
  };

  const handleDeletePassword = async () => {
    if (!password) return;
    setLoading(true);
    setError('');
    logger.info('Auth', 'Account deletion initiated', { uid: user.uid, isAdmin, provider: 'password' });
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await finishDeletion();
    } catch (err) {
      logger.error('Auth', 'Account deletion failed', { uid: user.uid, error: err.message, code: err.code });
      setError(humanizeAuthError(err));
      setLoading(false);
    }
  };

  const handleDeleteSso = async () => {
    setLoading(true);
    setError('');
    logger.info('Auth', 'Account deletion initiated (SSO reauth)', {
      uid: user.uid,
      isAdmin,
      provider: providerId,
      native: Capacitor.isNativePlatform()
    });
    try {
      if (Capacitor.isNativePlatform()) {
        const pluginResult =
          providerId === 'google.com'
            ? await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true })
            : await FirebaseAuthentication.signInWithApple({ skipNativeAuth: true });
        const cred = buildFirebaseCredentialFromNativePlugin(
          providerId === 'google.com' ? 'google' : 'apple',
          pluginResult
        );
        await reauthenticateWithCredential(auth.currentUser, cred);
        await finishDeletion();
        return;
      }
      sessionStorage.setItem(
        SSO_SESSION_KEY,
        JSON.stringify({
          phase: 'delete_account',
          uid: user.uid,
          householdId,
          isAdmin
        })
      );
      const provider = providerId === 'google.com'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com');
      await reauthenticateWithRedirect(auth.currentUser, provider);
    } catch (err) {
      sessionStorage.removeItem(SSO_SESSION_KEY);
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        setLoading(false);
        return;
      }
      logger.error('Auth', 'Account deletion failed', { uid: user.uid, error: err.message, code: err.code });
      setError(humanizeAuthError(err));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-800">Delete Account</h2>
          <p className="text-gray-600 font-medium mt-1">This action cannot be undone</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 font-medium">
            {isAdmin
              ? 'Your account and all household data will be permanently deleted — including the shopping list, history, and all pinned items. Other household members will lose access.'
              : 'Your account will be removed. The household and its data will remain accessible to other members.'}
          </div>
          {isSso ? (
            <div className="text-sm text-gray-700 font-medium">
              Reauthenticate with {providerLabel} to confirm deletion.
            </div>
          ) : (
            <form
              id="delete-account-password-form"
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!loading && password) handleDeletePassword();
              }}
            >
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Enter your password to confirm</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 text-gray-400" size={20} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-4 py-3 border-2 border-red-200 rounded-xl focus:border-red-400 focus:outline-none transition-colors"
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
              </div>
            </form>
          )}
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{error}</div>}
        </div>
        <div className="p-6 border-t border-gray-200 flex gap-3">
          <button type="button" onClick={onClose} disabled={loading} className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-300 transition-colors disabled:opacity-50">Cancel</button>
          <button
            type={isSso ? 'button' : 'submit'}
            form={isSso ? undefined : 'delete-account-password-form'}
            onClick={isSso ? handleDeleteSso : undefined}
            disabled={loading || (!isSso && !password)}
            className="flex-1 text-white py-3 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
            style={{ backgroundColor: loading || (!isSso && !password) ? undefined : '#EF4444' }}
          >
            {loading
              ? 'Deleting...'
              : isSso
                ? `Reauthenticate with ${providerLabel} & Delete`
                : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PaywallSheet({ trigger, status, onClose, onOpenLegal, onSubscriptionChanged }) {
  const [priceDisplay, setPriceDisplay] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [successText, setSuccessText] = useState('');
  const isNative = Capacitor.isNativePlatform();
  const wasInTrial = Boolean(status?.inTrial);

  useEffect(() => {
    let cancelled = false;
    if (isNative) {
      getAnnualPackageDisplay().then((d) => {
        if (!cancelled && d?.priceString) setPriceDisplay(d.priceString);
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [isNative]);

  const priceLine = priceDisplay || '$3.99 per year';

  const handleSubscribe = async () => {
    setErrorText('');
    setSuccessText('');
    setLoading(true);
    try {
      const result = await purchaseSubscription();
      if (result?.success) {
        onSubscriptionChanged?.();
        setSuccessText('You\'re all set. Thanks for subscribing!');
        setTimeout(() => onClose?.(), 900);
      } else if (result?.cancelled) {
        // user cancelled — silent
      } else if (result?.unavailable) {
        setErrorText('Subscription checkout is not yet available on the web. Please use the iOS or Android app.');
      } else {
        setErrorText('Purchase failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setErrorText('');
    setSuccessText('');
    setRestoring(true);
    try {
      const result = await restorePurchases();
      if (result?.success) {
        const active = customerHasPremiumAccess(result.customerInfo);
        if (active) {
          onSubscriptionChanged?.();
          setSuccessText('Subscription restored.');
          setTimeout(() => onClose?.(), 900);
        } else {
          setErrorText('No active subscription found on this account.');
        }
      } else if (result?.unavailable) {
        setErrorText('Restore is not available on the web.');
      } else {
        setErrorText('Could not restore purchases. Please try again.');
      }
    } finally {
      setRestoring(false);
    }
  };

  const headline = wasInTrial
    ? 'Subscribe to keep editing Provisions'
    : 'Your trial has ended';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center sm:p-4 z-50">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full sm:max-w-md border-t sm:border border-gray-200 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-center py-3 sm:hidden">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>
        <div className="px-6 pt-2 pb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">{headline}</h2>
            <p className="text-gray-600 font-medium mt-1 text-sm">
              You can still shop your list and check items off. Subscribe to add items, edit shortcuts, and invite family.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>
        <div className="px-6 pb-2">
          <div className="rounded-2xl border border-gray-200 p-5 bg-gray-50">
            <div className="text-3xl font-bold text-gray-800">{priceLine}</div>
            <div className="text-sm text-gray-600 font-medium mt-1">
              2 months free, then billed annually.
            </div>
          </div>
        </div>
        <ul className="px-6 py-4 space-y-2 text-sm text-gray-700 font-medium">
          <li className="flex items-start gap-2">
            <Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#FF7A7A' }} />
            <span>Real-time household sync</span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#FF7A7A' }} />
            <span>Unlimited items and shortcuts</span>
          </li>
          <li className="flex items-start gap-2">
            <Check size={18} className="mt-0.5 flex-shrink-0" style={{ color: '#FF7A7A' }} />
            <span>Invite household members</span>
          </li>
        </ul>
        {(errorText || successText) && (
          <div className="px-6 pb-2">
            {errorText && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm font-medium border border-red-200">{errorText}</div>
            )}
            {successText && (
              <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl text-sm font-medium border border-green-200">{successText}</div>
            )}
          </div>
        )}
        <div className="px-6 py-4 space-y-3">
          <button
            type="button"
            onClick={handleSubscribe}
            disabled={loading || restoring}
            className="w-full text-white py-3.5 rounded-xl font-bold disabled:bg-gray-300 transition-colors hover:opacity-90"
            style={{ backgroundColor: loading || restoring ? undefined : '#FF7A7A' }}
          >
            {loading ? 'Starting…' : 'Subscribe'}
          </button>
          <button
            type="button"
            onClick={handleRestore}
            disabled={loading || restoring}
            className="w-full text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-100 transition-colors disabled:opacity-50"
          >
            {restoring ? 'Restoring…' : 'Restore purchases'}
          </button>
        </div>
        <div className="px-6 pb-6 text-xs text-gray-500 text-center">
          By subscribing you agree to our{' '}
          <button type="button" className="underline" onClick={() => onOpenLegal?.('terms')}>Terms of Service</button>
          {' '}and{' '}
          <button type="button" className="underline" onClick={() => onOpenLegal?.('privacy')}>Privacy Policy</button>.
          {trigger ? <span className="sr-only"> Trigger: {trigger}.</span> : null}
        </div>
      </div>
    </div>
  );
}

function PurchaseHistory({ householdId, liveBucketMonthKey, liveBucketVal, aisles = {}, categories = {} }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  /** Raw groups from Firebase (no aisle labels); `null` until first fetch completes for this household. */
  const [baseDayGroups, setBaseDayGroups] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBaseDayGroups(null);
    (async () => {
      try {
        const events = await getHouseholdItemEventsMerged(database, householdId, {
          liveBucketMonthKey,
          liveBucketVal,
        });
        if (cancelled) return;

        // Effective purchases only (see purchaseSemantics.js — uncheck within 2h voids prior check)
        const dayMap = new Map(); // dateStr -> Map(rowKey -> { name, category, categoryId?, qty, count, quantityLabel })
        for (const e of computeEffectiveCheckEvents(events)) {
          const dateStr = new Date(e.ts).toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
          if (!dayMap.has(dateStr)) dayMap.set(dateStr, new Map());
          const items = dayMap.get(dateStr);
          const key = e.itemKey != null && String(e.itemKey).trim() !== ''
            ? `k:${String(e.itemKey)}`
            : `${(e.category || '').toLowerCase()}::${(e.name || '').toLowerCase()}`;
          if (!items.has(key)) {
            items.set(key, {
              name: e.name,
              category: e.category,
              categoryId: e.categoryId || null,
              qty: e.qty || 1,
              quantityLabel: (e.quantityLabel && String(e.quantityLabel).trim()) || '',
              count: 0,
            });
          }
          const item = items.get(key);
          if (e.categoryId && !item.categoryId) item.categoryId = e.categoryId;
          item.count++;
          if (e.qty) item.qty = e.qty;
          if (e.quantityLabel && String(e.quantityLabel).trim()) {
            item.quantityLabel = String(e.quantityLabel).trim();
          }
        }

        // Build sorted groups (newest first); aisle labels applied in useMemo when taxonomy is available
        const groups = [];
        for (const [dateStr, items] of dayMap) {
          const purchased = Array.from(items.values()).filter(i => i.count > 0);
          if (purchased.length > 0) {
            purchased.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name));
            groups.push({ dateStr, items: purchased });
          }
        }
        groups.sort((a, b) => b.dateStr.localeCompare(a.dateStr));

        setBaseDayGroups(groups);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [householdId, liveBucketMonthKey, liveBucketVal]);

  const dayGroups = useMemo(() => {
    if (baseDayGroups == null) return [];
    const catIdToAisleDisplay = {};
    for (const [catId, cat] of Object.entries(categories)) {
      if (!cat?.aisleId) continue;
      const aisleName = aisles[cat.aisleId]?.name;
      if (aisleName != null && String(aisleName).trim() !== '') {
        catIdToAisleDisplay[catId] = formatAisleNameForDisplay(aisleName);
      }
    }
    const catNameLowerToAisleDisplay = {};
    for (const cat of Object.values(categories)) {
      if (!cat?.name || !cat?.aisleId) continue;
      const aisleName = aisles[cat.aisleId]?.name;
      if (aisleName == null || String(aisleName).trim() === '') continue;
      catNameLowerToAisleDisplay[String(cat.name).toLowerCase()] = formatAisleNameForDisplay(aisleName);
    }
    const aisleLabelForRow = (row) => {
      if (row.categoryId && catIdToAisleDisplay[row.categoryId]) {
        return catIdToAisleDisplay[row.categoryId];
      }
      const k = (row.category || '').toLowerCase();
      if (k && catNameLowerToAisleDisplay[k]) return catNameLowerToAisleDisplay[k];
      return '';
    };
    return baseDayGroups.map((group) => {
      const items = group.items
        .map((row) => {
          const aisleLabel = aisleLabelForRow(row);
          return { ...row, aisleLabel: aisleLabel || (row.category || '') };
        })
        .sort((a, b) => (a.aisleLabel || '').localeCompare(b.aisleLabel || '') || a.name.localeCompare(b.name));
      return { dateStr: group.dateStr, items };
    });
  }, [baseDayGroups, aisles, categories]);

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
  };

  if (loading) return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-gray-400">Loading purchase history...</div></div>;
  if (error) return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-red-500">Error: {error}</div></div>;
  if (baseDayGroups != null && dayGroups.length === 0) {
    return <div className="max-w-2xl mx-auto px-4"><div className="text-center py-12 text-gray-400 text-sm">No purchases yet. Check off items on your shopping list to start tracking.</div></div>;
  }

  return (
    <div className="max-w-2xl mx-auto px-4">
      <div className="space-y-4">
        {dayGroups.map(group => (
          <div key={group.dateStr} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-100">
              <h3 className="font-bold text-gray-700 text-sm">{formatDate(group.dateStr)}</h3>
              <span className="text-xs text-gray-400">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-100">
              {group.items.map((item, i) => {
                const qtyText = (item.quantityLabel && item.quantityLabel.trim())
                  || (item.qty > 1 ? String(item.qty) : '');
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <Check size={16} className="text-gray-300 flex-shrink-0" />
                    <span className="flex-1 min-w-0 text-sm font-semibold text-gray-700">
                      {item.name}
                      {qtyText ? (
                        <span className="ml-1 text-gray-400 font-medium">{qtyText}</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-gray-400 uppercase tracking-wide flex-shrink-0">{item.aisleLabel}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  // WP-A: Extract ?code= param for email invite links early, before state init
  let inviteCodeFromUrl = '';
  try {
    const sp = new URLSearchParams(window.location.search);
    inviteCodeFromUrl = sp.get('code') || '';
  } catch (e) {
    // Ignore URL parsing errors
  }

  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [householdId, setHouseholdId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [paywallTrigger, setPaywallTrigger] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(() => getSubscriptionStatus());
  const [showAdmin, setShowAdmin] = useState(false);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [currentPage, setCurrentPage] = useState(() => legalViewFromPathname(window.location.pathname) || 'list');
  const [showMenu, setShowMenu] = useState(false);
  const [list, setList] = useState([]);
  const [aislesV2, setAislesV2] = useState({});
  const [categoriesV2, setCategoriesV2] = useState({});
  const [visibleItemsV2, setVisibleItemsV2] = useState({});
  const [libraryItemsV2, setLibraryItemsV2] = useState({});
  const [onboardingCompleted, setOnboardingCompleted] = useState(null);
  const [quickAddMode, setQuickAddMode] = useState(false);
  /** Bulk pin surface: only entered from Plan mode; keeps `quickAddMode` true. */
  const [pinEditMode, setPinEditMode] = useState(false);
  const [pinEditTriggerAisleId, setPinEditTriggerAisleId] = useState(null);
  /** B1 entry only: `${categoryId}::${suggestionId}` keys for amber pin rings. */
  const [pinEditDormantHighlightSet, setPinEditDormantHighlightSet] = useState(null);
  const [categorySearches, setCategorySearches] = useState({});
  const [aisleHighlightedIndex, setAisleHighlightedIndex] = useState({});
  const [loading, setLoading] = useState(true);
  const [pendingOps, setPendingOps] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const [keyboardInputFocused, setKeyboardInputFocused] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [localDataLoaded, setLocalDataLoaded] = useState(false);
  /** Raw taxonomy blob from IndexedDB; applied only when `householdId` matches `blob.householdId`. */
  const [localTaxonomyV2Blob, setLocalTaxonomyV2Blob] = useState(null);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [showHeader, setShowHeader] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  /** Clear chip first-run tooltip: shows once per device when chip first appears. localStorage-gated. */
  const [showClearChipTooltip, setShowClearChipTooltip] = useState(false);
  const scrollTimeoutRef = useRef(null);
  /** When leaving in-app Privacy/ToS via browser back, restore this `currentPage`. */
  const legalReturnPageRef = useRef('list');
  const prevQuickAddMode = useRef(quickAddMode);
  /** Last aisle-id key we applied shop default expansion for (empty = not yet seeded in shop). */
  const shopAisleDefaultsKeyRef = useRef('');
  /** When this differs from `householdId`, reset shop aisle refs so switching accounts re-applies defaults. */
  const shopAisleDefaultsHouseholdIdRef = useRef(null);
  /** Shop mode: previous snapshot of whether each aisle had any list items (for auto-collapse when emptied). */
  const prevShopAisleHadItemsRef = useRef({});
  /** First timestamp when onboarding UI is shown (for `onboarding_completed` duration). */
  const onboardingEnteredAtRef = useRef(null);
  /** `null` until first post-auth mode baseline; then used to emit `mode_switched` only on real toggles. */
  const quickAddModeAnalyticsRef = useRef(null);
  /** Per-aisle Plan search inputs — measure for autocomplete flip (design review 4.3). */
  const aisleAddSearchInputRefs = useRef({});
  const prevAisleAutocompleteOpenRef = useRef({});
  /** When true, per-aisle autocomplete renders above the input (decided once per open). */
  const [aisleAutocompleteFlipUp, setAisleAutocompleteFlipUp] = useState({});

  // --- A1/B1 suggestion intelligence ---
  const [suggestionDismissals, setSuggestionDismissals] = useState({});
  const [promotionCandidatesCache, setPromotionCandidatesCache] = useState([]);
  const [dormantShortcutsCache, setDormantShortcutsCache] = useState([]);
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const smoothedVelocity = useRef(0);
  const pinEditReturnScrollY = useRef(0);
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [showOfflineToast, setShowOfflineToast] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showLoginExplicitly, setShowLoginExplicitly] = useState(
    () => ['/signin', '/signup', LEGAL_PATH_PRIVACY, LEGAL_PATH_TERMS].includes(window.location.pathname)
  );

  const loginInitialMode = window.location.pathname === '/signup' ? 'signup' : (inviteCodeFromUrl ? 'signup' : 'signin');
  const loginInitialSignupType = inviteCodeFromUrl ? 'join' : 'create';
  const loginInitialInviteCode = inviteCodeFromUrl;

  const [loginLegalView, setLoginLegalView] = useState(() => legalViewFromPathname(window.location.pathname));
  const [needsDisplayName, setNeedsDisplayName] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [members, setMembers] = useState({});
  const [householdCreatedAt, setHouseholdCreatedAt] = useState(null);
  /** Calendar month for RTDB `onValue` on `item-events-by-month/{month}` (rollover ~45s). */
  const [itemEventsListenerMonth, setItemEventsListenerMonth] = useState(() => eventMonthKey(Date.now()));
  /** Live snapshot for `itemEventsListenerMonth`; null until first listener callback. */
  const [liveItemEventsMonthVal, setLiveItemEventsMonthVal] = useState(null);
  /** PWA banner shown once per device via localStorage. */
  const [showPWABanner, setShowPWABanner] = useState(false);
  /** WP-A: Dismissable notice when authenticated user tries to use an invite link. */
  const [showInviteAlreadyAuthenticatedNotice, setShowInviteAlreadyAuthenticatedNotice] = useState(false);

  const orderedV2AisleIds = Object.keys(aislesV2)
    .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0));
  const v2CategoriesByAisle = orderedV2AisleIds.reduce((acc, aisleId) => {
    acc[aisleId] = [];
    return acc;
  }, {});
  const v2CategoryNameById = {};
  for (const [catId, cat] of Object.entries(categoriesV2)) {
    if (!cat) continue;
    v2CategoryNameById[catId] = cat.name;
    if (cat.aisleId && v2CategoriesByAisle[cat.aisleId]) {
      v2CategoriesByAisle[cat.aisleId].push(catId);
    }
  }
  const categoryIdByName = Object.entries(categoriesV2).reduce((acc, [catId, cat]) => {
    if (cat?.name) acc[cat.name] = catId;
    return acc;
  }, {});
  const categoryNameForId = (catId) => categoriesV2[catId]?.name || null;
  const normalizeListItem = (item) => {
    const categoryId = item?.categoryId || categoryIdByName[item?.category] || null;
    const category = item?.category || categoryNameForId(categoryId) || '';
    // `id` doubles as the RTDB path key, so coerce to string consistently. Legacy items
    // stored with numeric Date.now() ids become their string form; new push-key ids pass through.
    const id = item?.id != null && item.id !== '' ? String(item.id) : generateId();
    return {
      ...item,
      id,
      categoryId,
      category,
      itemKey: item?.itemKey || id,
    };
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedItemLastPurchased, setSelectedItemLastPurchased] = useState(null);
  const [quantityDefaults, setQuantityDefaults] = useState({});
  const authResolvedRef = useRef(false);
  /** Latest UI state for Android hardware back (listener must not close over stale React state). */
  const androidNavRef = useRef(null);
  const getStableItemKey = (item) => item?.itemKey || String(item?.id || '');
  const currentEditor = user?.uid || 'unknown';
  const stampRecord = (record) => ({
    ...record,
    updatedAt: Date.now(),
    updatedBy: currentEditor,
  });

  useEffect(() => {
    if (!Object.keys(aislesV2).length || !Object.keys(categoriesV2).length) return;
    saveTaxonomyV2Locally({
      ...(householdId ? { householdId } : {}),
      aisles: aislesV2,
      categories: categoriesV2,
      visibleItems: visibleItemsV2,
      library: libraryItemsV2,
    });
  }, [householdId, aislesV2, categoriesV2, visibleItemsV2, libraryItemsV2]);

  // Legacy: categories that were "hidden" or lost an aisle are reassigned to the first aisle (merge is how categories are removed now).
  useEffect(() => {
    if (!householdId) return;
    const firstAisleId = Object.keys(aislesV2)
      .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0))[0];
    if (!firstAisleId) return;
    const aisleKeySet = new Set(Object.keys(aislesV2));
    let categoriesPointingAtKnownAisle = 0;
    for (const c of Object.values(categoriesV2)) {
      if (c?.aisleId && aisleKeySet.has(c.aisleId)) categoriesPointingAtKnownAisle++;
    }
    const totalCats = Object.keys(categoriesV2).length;
    // Stale IndexedDB from another household yields ids that match no aisle; without this guard
    // every category would be moved to aisle #1 (Produce) before Firebase overwrites state.
    if (totalCats >= 10 && categoriesPointingAtKnownAisle === 0 && aisleKeySet.size >= 3) {
      return;
    }
    const base = `households/${householdId}/taxonomy`;
    const updates = {};
    for (const [cid, c] of Object.entries(categoriesV2)) {
      if (!c) continue;
      const aisleMissing = !c.aisleId || !aislesV2[c.aisleId];
      if (c.hidden === true || aisleMissing) {
        updates[`${base}/categories/${cid}`] = stampRecord({
          ...c,
          hidden: false,
          aisleId: firstAisleId,
        });
      }
    }
    if (Object.keys(updates).length === 0) return;
    update(ref(database), updates).catch((err) => {
      logger.error('App', 'taxonomy legacy category migration failed', { error: err.message });
    });
  }, [householdId, aislesV2, categoriesV2]);

  // Check for debug mode in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      setShowDebugPanel(true);
      logger.info('Debug', 'Debug panel activated via URL parameter');
    }

    // Keyboard shortcut: Ctrl+Shift+D to toggle debug panel
    const handleKeyPress = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        setShowDebugPanel(prev => !prev);
        logger.info('Debug', 'Debug panel toggled via keyboard shortcut');
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname;
      const legal = legalViewFromPathname(path);

      if (path === '/signin' || path === '/signup') {
        setLoginLegalView(null);
        return;
      }
      if (path === LEGAL_PATH_PRIVACY || path === LEGAL_PATH_TERMS) {
        setLoginLegalView(legal);
        setCurrentPage(legal);
        return;
      }
      if (path === '/app' || path.startsWith('/app/')) {
        setLoginLegalView(null);
        setCurrentPage((prev) =>
          prev === 'privacy' || prev === 'terms' ? (legalReturnPageRef.current || 'list') : prev
        );
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Track whether a text-input element is focused so bottom-fixed chrome can
  // hide while the mobile soft keyboard is up (decision 8.2).
  useEffect(() => {
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT') {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        return t !== 'checkbox' && t !== 'radio' && t !== 'button' && t !== 'submit';
      }
      return tag === 'TEXTAREA' || el.isContentEditable === true;
    };
    const onFocusIn = (e) => { if (isTextInput(e.target)) setKeyboardInputFocused(true); };
    const onFocusOut = () => {
      // Defer so the next focusin (if any) fires first.
      setTimeout(() => {
        if (!isTextInput(document.activeElement)) setKeyboardInputFocused(false);
      }, 0);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = null;

    const goAppAfterSso = () => {
      if (cancelled) return;
      setShowLoginExplicitly(false);
      setLoginLegalView(null);
      window.history.replaceState({}, '', '/app');
      setCurrentPage('list');
      setQuickAddMode(false);
    };

    const processOAuthRedirect = async () => {
      if (Capacitor.isNativePlatform()) return;
      // Password-reset emails append ?mode=resetPassword&oobCode=… (e.g. after / → /signin bounce).
      // Do not run getRedirectResult here: it competes with email-action handling and can break the flow.
      try {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get('mode') === 'resetPassword' && sp.get('oobCode')) {
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const result = await getRedirectResultOnce();
        if (cancelled) return;

        const raw = sessionStorage.getItem(SSO_SESSION_KEY);
        if (!raw) return;

        let ctx;
        try {
          ctx = JSON.parse(raw);
        } catch {
          sessionStorage.removeItem(SSO_SESSION_KEY);
          return;
        }

        if (ctx.phase === 'delete_account') {
          sessionStorage.removeItem(SSO_SESSION_KEY);
          if (result?.user?.uid === ctx.uid) {
            try {
              await deleteAccountDataAndAuth(result.user, ctx.householdId, ctx.isAdmin);
            } catch (e) {
              logger.error('Auth', 'Delete account after SSO redirect failed', {
                error: e.message,
                code: e.code
              });
            }
          }
          return;
        }

        if (ctx.phase === 'awaiting_household') {
          return;
        }

        if (ctx.phase !== 'pre_redirect') {
          sessionStorage.removeItem(SSO_SESSION_KEY);
          return;
        }

        if (!result) {
          sessionStorage.removeItem(SSO_SESSION_KEY);
          return;
        }

        sessionStorage.removeItem(SSO_SESSION_KEY);

        const ssoUser = result.user;
        const { mode, signupType, inviteCode, displayName: storedName } = ctx;

        const userRecSnap = await get(ref(database, `users/${ssoUser.uid}`));
        const existing = userRecSnap.val();
        if (existing?.householdId) {
          logger.info('Auth', 'SSO returning user (redirect), proceeding to app');
          goAppAfterSso();
          return;
        }

        const ssoDisplayName = (ssoUser.displayName || '').trim();
        const storedTrim = (storedName || '').trim();
        if (mode === 'signup' && (ssoDisplayName || storedTrim)) {
          await setupHouseholdForUser(ssoUser, {
            signupType,
            inviteCode,
            displayName: ssoDisplayName || storedTrim
          });
          goAppAfterSso();
          return;
        }

        sessionStorage.setItem(
          SSO_SESSION_KEY,
          JSON.stringify({
            phase: 'awaiting_household',
            mode,
            signupType,
            inviteCode,
            displayName: ssoDisplayName || storedTrim
          })
        );
        setShowLoginExplicitly(true);
      } catch (err) {
        sessionStorage.removeItem(SSO_SESSION_KEY);
        if (err.code === 'auth/account-exists-with-different-credential') {
          const providerType = err.customData?.providerId === 'google.com' ? 'google' : 'apple';
          const cred =
            providerType === 'google'
              ? GoogleAuthProvider.credentialFromError(err)
              : OAuthProvider.credentialFromError(err);
          pendingOAuthLink = {
            credential: cred,
            email: err.customData?.email || '',
            providerType
          };
          sessionStorage.setItem(SSO_LINK_UI_KEY, '1');
          setShowLoginExplicitly(true);
        } else if (
          err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request'
        ) {
          logger.error('Auth', 'OAuth redirect getRedirectResult failed', {
            error: err.message,
            code: err.code
          });
        }
      }
    };

    (async () => {
      logger.info('Auth', 'Auth initialization started');
      await processOAuthRedirect();
      if (cancelled) return;
      await auth.authStateReady();
      if (cancelled) return;

      loadCachedUser().then(cachedUser => {
        if (cachedUser && !authResolvedRef.current) {
          logger.info('Auth', 'Loaded cached user', {
            uid: cachedUser.uid,
            email: cachedUser.email,
            isAdmin: cachedUser.isAdmin
          });
          setUser({
            uid: cachedUser.uid,
            email: cachedUser.email,
            cached: true
          });
          setIsAdmin(cachedUser.isAdmin || false);
          setHouseholdId(cachedUser.householdId || null);
          logger.setUserId(cachedUser.uid);
          setAnalyticsUserId(cachedUser.uid);
        } else {
          logger.debug('Auth', 'No cached user found or user already set');
        }
      }).catch(err => {
        logger.error('Auth', 'Failed to load cached user', { error: err.message });
      });

      unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      authResolvedRef.current = true;
      logger.info('Auth', 'onAuthStateChanged fired', {
        hasUser: !!firebaseUser,
        uid: firebaseUser?.uid,
        email: firebaseUser?.email
      });

      let blockDismissLogin =
        sessionStorage.getItem(SSO_LINK_UI_KEY) === '1' ||
        sessionStorage.getItem(EMAIL_SIGNUP_IN_PROGRESS_KEY) === '1';
      try {
        const pending = sessionStorage.getItem(SSO_SESSION_KEY);
        if (pending) {
          const o = JSON.parse(pending);
          if (o.phase === 'awaiting_household') blockDismissLogin = true;
        }
      } catch {
        /* ignore */
      }

      if (firebaseUser) {
        setUser(firebaseUser);
        if (!blockDismissLogin) setShowLoginExplicitly(false);
        logger.setUserId(firebaseUser.uid);
        setAnalyticsUserId(firebaseUser.uid);

        // End splash immediately: profile/household RTDB reads are not needed to paint the shell.
        setAuthLoading(false);
        logger.debug('Auth', 'Auth loading completed');

        // Load household membership and derive admin status from household record.
        // Retry a few times: onAuthStateChanged fires immediately after createUserWithEmailAndPassword,
        // before the signup handler has finished writing the user record to the DB.
        void (async () => {
          // Seed from cache first so taxonomy/isAdmin gating render immediately offline.
          // Without this, the network `get`s below hang on cold-load + airplane mode and
          // householdId is never set, leaving aislesV2/categoriesV2 empty.
          const cachedSeed = await loadCachedUser().catch(() => null);
          const seededFromCache = cachedSeed?.uid === firebaseUser.uid;
          let userHouseholdId = seededFromCache ? (cachedSeed.householdId || null) : null;
          let isAdminUser = seededFromCache ? !!cachedSeed.isAdmin : false;
          if (seededFromCache) {
            setIsAdmin(isAdminUser);
            if (userHouseholdId) setHouseholdId(userHouseholdId);
          }

          // Bound RTDB reads so an offline session can't leave this IIFE pending forever.
          // 5s is generous enough for fresh-signup races (see retry loop) while keeping
          // recovery snappy when the network is genuinely down.
          const withTimeout = (p, ms) => Promise.race([
            p,
            new Promise((_, reject) => setTimeout(
              () => reject(new Error(`network read timed out after ${ms}ms`)),
              ms
            )),
          ]);

          try {
            let userRecord = await withTimeout(get(ref(database, `users/${firebaseUser.uid}`)), 5000);
            let retries = 0;
            while (!userRecord.val() && retries < 4) {
              await new Promise(r => setTimeout(r, 120));
              userRecord = await withTimeout(get(ref(database, `users/${firebaseUser.uid}`)), 5000);
              retries++;
              if (!userRecord.val()) {
                logger.debug('Auth', 'User record not yet written, retrying', { retries });
              }
            }
            const fetchedHouseholdId = userRecord.val()?.householdId || null;
            if (fetchedHouseholdId) userHouseholdId = fetchedHouseholdId;
            if (!userRecord.val()?.displayName) {
              setNeedsDisplayName(true);
            }
            if (userHouseholdId) {
              const [adminSnap, trialSnap, createdAtSnap] = await Promise.all([
                withTimeout(get(ref(database, `households/${userHouseholdId}/adminUid`)), 5000),
                withTimeout(get(ref(database, `households/${userHouseholdId}/trialEndsAt`)), 5000),
                withTimeout(get(ref(database, `households/${userHouseholdId}/createdAt`)), 5000),
              ]);
              isAdminUser = adminSnap.val() === firebaseUser.uid;
              const rawTrialEndsAt = trialSnap.val();
              const rawCreatedAt = createdAtSnap.val();
              if (rawCreatedAt) setHouseholdCreatedAt(rawCreatedAt);
              // Prefer explicit trialEndsAt; fall back to createdAt + TRIAL_DAYS for households
              // created before this field existed.
              const effectiveTrialEndsAt = rawTrialEndsAt
                ?? (rawCreatedAt ? rawCreatedAt + TRIAL_DAYS * 24 * 60 * 60 * 1000 : null);
              setHouseholdTrialEndsAt(effectiveTrialEndsAt);
            }
          } catch (err) {
            // Cached seed (if any) is already applied; the live listeners below will
            // reconcile once the network returns.
            logger.warn('Auth', 'Network household read failed/timed out; using cached values', {
              error: err.message,
              code: err.code,
              hadCachedSeed: seededFromCache
            });
          }
          setIsAdmin(isAdminUser);
          setHouseholdId(userHouseholdId);

          logger.info('Auth', 'User authenticated', {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            householdId: userHouseholdId,
            isAdmin: isAdminUser
          });

          saveCachedUser({
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            isAdmin: isAdminUser,
            householdId: userHouseholdId
          })
            .then(() => {
              logger.debug('Auth', 'Cached user saved to IndexedDB');
            })
            .catch((err) => {
              logger.error('Auth', 'Failed to save cached user', { error: err.message });
            });
        })();
      } else {
        // No Firebase session — stop RTDB log writes (avoids PERMISSION_DENIED after sign-out or token loss)
        logger.setUserId(null);
        setAnalyticsUserId(null);
        logger.warn('Auth', 'Firebase auth returned null user');

        // Be more lenient: if we have a cached user, keep using it even if online
        // only clear if we have no cached user at all
        const cachedUser = await loadCachedUser().catch(() => null);
        if (!cachedUser) {
          logger.info('Auth', 'No cached user and Firebase auth is null - clearing auth state');
          setUser(null);
          setIsAdmin(false);
          setHouseholdId(null);
        } else {
          logger.info('Auth', 'Firebase auth is null but keeping cached user', {
            uid: cachedUser.uid,
            email: cachedUser.email,
            online: navigator.onLine
          });
          // We keep the 'user' state as the cached user (set during init)
          // This prevents aggressive logouts when token refresh fails
        }
        setAuthLoading(false);
        logger.debug('Auth', 'Auth loading completed');
      }
    });
    })();

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // WP-A: Store invite code from URL and clear the param
  const inviteCodeFromUrlRef = useRef(inviteCodeFromUrl);
  useEffect(() => {
    if (inviteCodeFromUrl) {
      // Clear the ?code= from URL to avoid confusion
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [inviteCodeFromUrl]);

  // WP-A: Handle authenticated user trying to access an invite link
  useEffect(() => {
    if (!authResolvedRef.current || !inviteCodeFromUrlRef.current) return;
    if (!user) return; // User not authenticated, normal flow handled above

    // User is authenticated and has an invite code in the URL
    if (householdId) {
      // User is already in a household
      setShowInviteAlreadyAuthenticatedNotice(true);
      logger.warn('Auth', 'Authenticated user with household tried to access invite link');
    } else if (user) {
      // User is authenticated but has no household (edge case: post-SSO before household choice)
      // Attempt to redeem the code directly using existing join logic
      logger.info('Auth', 'Authenticated user without household accessing invite link - will attempt to join');
      // This case would need special handling in setupHouseholdForUser,
      // but for MVP we'll just show the notice
      setShowInviteAlreadyAuthenticatedNotice(true);
    }
  }, [authResolvedRef.current, user, householdId]);

  // Register PWA update callbacks
  useEffect(() => {
    if (typeof window === 'undefined') return;

    import('./main.jsx').then(({ registerUpdateCallback, registerOfflineCallback }) => {
      registerUpdateCallback((updateSW) => {
        setPendingUpdate(() => updateSW);
        setShowUpdateToast(true);
      });

      registerOfflineCallback(() => {
        setShowOfflineToast(true);
        setTimeout(() => setShowOfflineToast(false), 5000);
      });
    }).catch(err => {
      console.error('Failed to register PWA callbacks:', err);
    });
  }, []);

  const handleUpdate = useCallback(() => {
    if (pendingUpdate) {
      pendingUpdate(true);
    }
  }, [pendingUpdate]);

  const handleDismissUpdate = useCallback(() => {
    setShowUpdateToast(false);
  }, []);

  const handleDismissOffline = useCallback(() => {
    setShowOfflineToast(false);
  }, []);

  // Monitor pendingOps changes
  useEffect(() => {
    logger.info('Sync', 'Pending operations count changed', {
      pendingOps,
      isOnline,
      isConnected,
      timestamp: Date.now()
    });
  }, [pendingOps]);

  // Monitor connection state changes
  useEffect(() => {
    logger.info('Network', 'Connection state changed', {
      isOnline,
      isConnected,
      navigatorOnLine: navigator.onLine,
      timestamp: Date.now()
    });
  }, [isOnline, isConnected]);

  // Handle token refresh when returning to app after inactivity
  useEffect(() => {
    const handleVisibilityChange = async () => {
      logger.info('App', 'Visibility change detected', {
        hidden: document.hidden,
        hasUser: !!user,
        navigatorOnLine: navigator.onLine
      });

      // When user returns to the app
      if (!document.hidden && user) {
        // Only try to refresh if we're online
        if (!navigator.onLine) {
          logger.info('Auth', 'Skipping token refresh (offline)', {
            navigatorOnLine: navigator.onLine
          });
          return;
        }

        try {
          // Get fresh token (this will refresh if expired/expiring)
          const currentUser = auth.currentUser;
          if (currentUser) {
            logger.info('Auth', 'Attempting token refresh on app resume');
            // Get token (refreshes only if necessary)
            await currentUser.getIdToken();
            logger.info('Auth', 'Token refreshed successfully on app resume');
          } else {
            logger.info('Auth', 'No current user for token refresh on resume - waiting for onAuthStateChanged');
          }
        } catch (error) {
          logger.error('Auth', 'Token refresh failed on app resume', {
            error: error.message,
            code: error.code,
            stack: error.stack
          });
          // Don't force logout on network errors - let user work offline
          if (error.code === 'auth/network-request-failed') {
            logger.info('Auth', 'Network error during token refresh - continuing in offline mode');
          }
        }
      }
    };

    const handleOnline = async () => {
      logger.info('Network', 'Network came back online, attempting token refresh', {
        hasUser: !!user
      });

      // When network comes back, try to refresh the token
      if (user) {
        try {
          const currentUser = auth.currentUser;
          if (currentUser) {
            await currentUser.getIdToken();
            logger.info('Auth', 'Token refreshed successfully after coming back online');
          } else {
            logger.info('Auth', 'No current user for token refresh yet after coming online - waiting for onAuthStateChanged');
          }
        } catch (error) {
          logger.error('Auth', 'Token refresh failed after coming online', {
            error: error.message,
            code: error.code
          });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  // Load data from IndexedDB on mount (before Firebase connects)
  useEffect(() => {
    async function loadLocalData() {
      logger.info('OfflineStorage', 'Loading local data from IndexedDB');
      try {
        const offlineDb = await initOfflineDB();
        logger.debug(
          'OfflineStorage',
          offlineDb ? 'IndexedDB initialized' : 'IndexedDB unavailable (offline cache disabled for this session)'
        );

        const [localList, localTaxonomyV2, localQuantityDefaults, syncTime] = await Promise.all([
          loadShoppingListLocally(),
          loadTaxonomyV2Locally(),
          loadQuantityDefaultsLocally(),
          getLastSyncTime()
        ]);

        logger.info('OfflineStorage', 'Local data loaded', {
          hasLocalList: !!localList,
          listItemCount: localList?.length || 0,
          taxonomyV2AislesCount: Object.keys(localTaxonomyV2?.aisles || {}).length,
          taxonomyV2CategoriesCount: Object.keys(localTaxonomyV2?.categories || {}).length,
          lastSyncTime: syncTime
        });

        if (localList !== null && localList !== undefined) {
          setList(localList.map(normalizeListItem));
        }
        setLocalTaxonomyV2Blob(localTaxonomyV2 ?? null);
        if (syncTime) {
          setLastSyncTime(syncTime);
        }
        if (localQuantityDefaults && typeof localQuantityDefaults === 'object') {
          setQuantityDefaults(localQuantityDefaults);
        }

        setLocalDataLoaded(true);
        setLoading(false);
        logger.info('OfflineStorage', 'Local data load completed successfully');
      } catch (error) {
        logger.error('OfflineStorage', 'Failed to load local data', {
          error: error.message,
          stack: error.stack
        });
        setLocalDataLoaded(true);
        setLoading(false);
      }
    }

    loadLocalData();
  }, []);

  // Offline taxonomy: only merge IndexedDB snapshot when it belongs to this household.
  useEffect(() => {
    if (!localDataLoaded || !householdId) return;
    const blob = localTaxonomyV2Blob;
    if (!blob || blob.householdId !== householdId) return;
    setAislesV2(blob.aisles || {});
    setCategoriesV2(blob.categories || {});
    setVisibleItemsV2(blob.visibleItems || {});
    setLibraryItemsV2(blob.library || {});
  }, [localDataLoaded, householdId, localTaxonomyV2Blob]);

  useEffect(() => {
    const id = setInterval(() => {
      const n = eventMonthKey(Date.now());
      setItemEventsListenerMonth((prev) => (prev !== n ? n : prev));
    }, 45000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user || !householdId) {
      setLiveItemEventsMonthVal(null);
      return undefined;
    }
    const r = ref(database, `households/${householdId}/item-events-by-month/${itemEventsListenerMonth}`);
    const unsub = onValue(r, (snap) => {
      setLiveItemEventsMonthVal(snap.val() || {});
    });
    return () => {
      unsub();
    };
  }, [user?.uid, householdId, itemEventsListenerMonth]);

  useEffect(() => {
    if (!user || !householdId) {
      logger.debug('Firebase', 'Skipping Firebase listeners (no user or household)');
      return;
    }

    logger.info('Firebase', 'Setting up Firebase listeners', { userId: user.uid, householdId });

    // Monitor Firebase connection status
    const connectedRef = ref(database, '.info/connected');
    const unsubConnected = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val() === true;
      logger.info('Firebase', 'Firebase connection state changed', {
        connected,
        navigatorOnLine: navigator.onLine,
        timestamp: Date.now()
      });
      setIsConnected(connected);
    });

    // Monitor browser online/offline status
    const handleOnline = () => {
      logger.info('Network', 'Browser online event handler', {
        navigatorOnLine: navigator.onLine,
        firebaseConnected: isConnected,
        timestamp: Date.now()
      });
      setIsOnline(true);
    };

    const handleOffline = () => {
      logger.warn('Network', 'Browser offline event handler', {
        navigatorOnLine: navigator.onLine,
        firebaseConnected: isConnected,
        timestamp: Date.now()
      });
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set initial online status
    const initialOnline = navigator.onLine;
    setIsOnline(initialOnline);
    logger.info('Network', 'Initial network status', {
      navigatorOnLine: initialOnline,
      timestamp: Date.now()
    });

    const hPath = `households/${householdId}`;
    const listRef = ref(database, `${hPath}/shopping-list`);
    const quantityDefaultsRef = ref(database, `${hPath}/quantity-defaults`);

    logger.debug('Firebase', 'Setting up data listeners');

    const unsubList = onValue(listRef, (snapshot) => {
      const data = snapshotShoppingListToArray(snapshot.val()).map(normalizeListItem);
      logger.info('Firebase', 'Shopping list data received', {
        itemCount: data.length,
        timestamp: Date.now()
      });
      setList(data);
      saveShoppingListLocally(data).then(() => {
        logger.debug('OfflineStorage', 'Shopping list saved to IndexedDB');
      });
      setLastSyncTime(Date.now());
    }, (error) => {
      logger.error('Firebase', 'Shopping list listener error', {
        error: error.message,
        code: error.code
      });
    });

    const membersRef = ref(database, `households/${householdId}/members`);
    const unsubMembers = onValue(membersRef, (snapshot) => {
      setMembers(snapshot.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Members listener error', { error: error.message, code: error.code });
    });

    const unsubQuantityDefaults = onValue(quantityDefaultsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setQuantityDefaults(data);
      saveQuantityDefaultsLocally(data);
    }, (error) => {
      logger.error('Firebase', 'Quantity defaults listener error', { error: error.message, code: error.code });
    });

    const aislesRef       = ref(database, `${hPath}/taxonomy/aisles`);
    const categoriesV2Ref = ref(database, `${hPath}/taxonomy/categories`);
    const visibleRef      = ref(database, `${hPath}/taxonomy/visible-items`);
    const libraryRef      = ref(database, `${hPath}/taxonomy/library`);
    const onboardingRef   = ref(database, `${hPath}/taxonomy/onboarding_completed`);

    const unsubAisles = onValue(aislesRef, (snap) => {
      setAislesV2(snap.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Aisles listener error', { error: error.message, code: error.code });
    });
    const unsubCategoriesV2 = onValue(categoriesV2Ref, (snap) => {
      setCategoriesV2(snap.val() || {});
    }, (error) => {
      logger.error('Firebase', 'Categories v2 listener error', { error: error.message, code: error.code });
    });
    const unsubVisible = onValue(visibleRef, (snap) => {
      const raw = snap.val() || {};
      // Stored as { catId: Array | { pushId: {id, name} } }. Normalize to arrays.
      const norm = {};
      for (const [catId, v] of Object.entries(raw)) {
        if (Array.isArray(v)) norm[catId] = v.filter(Boolean);
        else if (v && typeof v === 'object') norm[catId] = Object.values(v);
        else norm[catId] = [];
      }
      setVisibleItemsV2(norm);
    }, (error) => {
      logger.error('Firebase', 'Visible items listener error', { error: error.message, code: error.code });
    });
    const unsubLibrary = onValue(libraryRef, (snap) => {
      const raw = snap.val() || {};
      const norm = {};
      for (const [catId, v] of Object.entries(raw)) {
        if (Array.isArray(v)) norm[catId] = v.filter(Boolean);
        else if (v && typeof v === 'object') norm[catId] = Object.values(v);
        else norm[catId] = [];
      }
      setLibraryItemsV2(norm);
    }, (error) => {
      logger.error('Firebase', 'Library items listener error', { error: error.message, code: error.code });
    });
    const unsubOnboarding = onValue(onboardingRef, (snap) => {
      const v = snap.val();
      setOnboardingCompleted(v === null || v === undefined ? null : v === true);
    }, (error) => {
      logger.error('Firebase', 'Onboarding flag listener error', { error: error.message, code: error.code });
    });

    const trialEndsAtRef = ref(database, `${hPath}/trialEndsAt`);
    const unsubTrialEndsAt = onValue(trialEndsAtRef, (snap) => {
      const val = snap.val();
      setHouseholdTrialEndsAt(typeof val === 'number' ? val : null);
      setSubscriptionStatus(getSubscriptionStatus());
    });

    // When any household member subscribes or cancels, they write subscriptionUpdatedAt.
    // All other members hear this and re-fetch from RevenueCat so their gating stays current.
    let lastSubscriptionUpdatedAt = null;
    const subscriptionUpdatedAtRef = ref(database, `${hPath}/subscriptionUpdatedAt`);
    const unsubSubscriptionUpdatedAt = onValue(subscriptionUpdatedAtRef, (snap) => {
      const val = snap.val();
      if (val && val !== lastSubscriptionUpdatedAt) {
        lastSubscriptionUpdatedAt = val;
        refreshCustomerInfo().then(() => setSubscriptionStatus(getSubscriptionStatus()));
      }
    });

    setLoading(false);

    return () => {
      unsubConnected();
      setIsConnected(false);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubList();
      unsubMembers();
      unsubQuantityDefaults();
      unsubAisles();
      unsubCategoriesV2();
      unsubVisible();
      unsubLibrary();
      unsubOnboarding();
      unsubTrialEndsAt();
      unsubSubscriptionUpdatedAt();
    };
  }, [user?.uid, householdId]);

  const save = async (key, value) => {
    if (!householdId) {
      logger.warn('Firebase', 'Save skipped: missing householdId', { key });
      return;
    }
    const fullKey = `households/${householdId}/${key}`;
    const opId = Date.now();
    logger.info('Firebase', 'Starting Firebase save operation', {
      opId,
      key: fullKey,
      dataType: Array.isArray(value) ? 'array' : typeof value,
      ...(Array.isArray(value) ? { itemCount: value.length } : {})
    });

    setPendingOps(p => {
      const newCount = p + 1;
      logger.debug('Sync', 'Pending operations increased', {
        opId,
        pendingOps: newCount
      });
      return newCount;
    });

    try {
      await set(ref(database, fullKey), value);
      logger.info('Firebase', 'Firebase save completed', {
        opId,
        key,
        success: true
      });
    } catch (error) {
      logger.error('Firebase', 'Firebase save failed', {
        opId,
        key,
        error: error.message,
        code: error.code,
        stack: error.stack
      });
      // Don't throw - let Firebase handle offline queueing
      // The error is logged, and Firebase will retry when back online
    } finally {
      setPendingOps(p => {
        const newCount = p - 1;
        logger.debug('Sync', 'Pending operations decreased', {
          opId,
          pendingOps: newCount
        });
        return newCount;
      });
    }
  };

  /**
   * Per-item shopping-list writes via RTDB multi-path update. Replaces the prior
   * `save('shopping-list', wholeArray)` which used `set` and overwrote concurrent
   * offline edits from other household members on reconnect (one user's `set`
   * would clobber another's). With multi-path update, two clients editing
   * different items merge cleanly; field-level paths (e.g. `${id}/done`) also let
   * concurrent edits to the same item on different fields co-exist.
   *
   * pathToValue keys are paths under `shopping-list/`, e.g.
   *   { "<id>": <fullItem> }            // add
   *   { "<id>/done": true }             // toggle a field
   *   { "<id>": null }                  // remove
   *   { "<id1>": null, "<id2>": null }  // batched remove (clearDone)
   */
  const writeShoppingList = async (pathToValue, extraUpdates = null) => {
    if (!householdId) {
      logger.warn('Firebase', 'writeShoppingList skipped: missing householdId');
      return;
    }
    const updates = { ...(extraUpdates || {}) };
    for (const [path, value] of Object.entries(pathToValue)) {
      updates[`households/${householdId}/shopping-list/${path}`] = value;
    }
    const opId = Date.now();
    setPendingOps(p => p + 1);
    try {
      await update(ref(database), updates);
      logger.info('Firebase', 'shopping-list multi-path update completed', {
        opId,
        paths: Object.keys(pathToValue).length,
      });
    } catch (error) {
      logger.error('Firebase', 'shopping-list multi-path update failed', {
        opId,
        error: error.message,
        code: error.code,
      });
    } finally {
      setPendingOps(p => p - 1);
    }
  };

  const persistQuantityDefaults = async (nextDefaults) => {
    setQuantityDefaults(nextDefaults);
    await save('quantity-defaults', nextDefaults);
    await saveQuantityDefaultsLocally(nextDefaults);
  };

  const getDefaultQuantityForItem = (itemKey, name) => {
    const key = String(itemKey || '');
    const legacyKey = (name || '').trim().toLowerCase();
    return quantityDefaults[key] || quantityDefaults[legacyKey] || '';
  };

  /** When a list item has a taxonomy category, ensure its name exists in that category's library (not visible/suggestions). */
  const ensureListItemNameInLibrary = async (name, categoryId) => {
    if (!householdId || !categoryId) return;
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const vis = visibleItemsV2[categoryId] || [];
    const lib = libraryItemsV2[categoryId] || [];
    if (vis.some(i => i.name.toLowerCase() === lower)) return;
    if (lib.some(i => i.name.toLowerCase() === lower)) return;
    const base = `households/${householdId}/taxonomy`;
    const itemId = push(ref(database, `${base}/library/${categoryId}`)).key;
    const nextLib = [...lib, stampRecord({ id: itemId, name: trimmed })].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    setLibraryItemsV2(prev => ({ ...prev, [categoryId]: nextLib }));
    try {
      await update(ref(database), {
        [`${base}/library/${categoryId}`]: nextLib,
      });
    } catch (err) {
      logger.warn('App', 'ensureListItemNameInLibrary failed', { error: err.message, categoryId });
    }
  };

  const logItemEvent = (event) => {
    if (!householdId) return;
    const payload = {
      ts: Date.now(),
      uid: user?.uid || 'unknown',
      name: (event.name || '').toLowerCase(),
      category: event.category || '',
      action: event.action,
    };
    if (event.categoryId) payload.categoryId = event.categoryId;
    if (event.itemKey != null && String(event.itemKey).trim() !== '') {
      payload.itemKey = String(event.itemKey).trim().slice(0, 80);
    }
    if (event.source) payload.source = event.source;
    if (event.qty != null) payload.qty = Number(event.qty);
    const qLabel = (event.quantityLabel != null && String(event.quantityLabel).trim())
      ? String(event.quantityLabel).trim().slice(0, 100)
      : '';
    if (qLabel) payload.quantityLabel = qLabel;
    const prevRaw = event.prevName != null ? String(event.prevName).trim() : '';
    if (prevRaw) payload.prevName = prevRaw.toLowerCase().slice(0, 200);
    pushHouseholdItemEvent(database, householdId, payload).catch((err) => {
      logger.warn('App', 'item-event write failed', { error: err.message, action: payload.action });
    });
  };

  const addItem = (name, category, source = 'quickAdd', itemKey = generateId(), categoryIdOverride = null) => {
    if (!assertWriteAllowed('gated_action')) return;
    const defaultQuantity = getDefaultQuantityForItem(itemKey, name);
    const categoryIdResolved = categoryIdOverride || categoryIdByName[category] || null;
    // Push key (alphanumeric, server-collision-free) doubles as the RTDB path key
    // and the item's React identity. Avoids Date.now() collisions on rapid taps.
    const newId = push(ref(database, `households/${householdId}/shopping-list`)).key;
    const newItem = stampRecord({
      id: newId,
      itemKey,
      name,
      category,
      categoryId: categoryIdResolved,
      quantity: defaultQuantity,
      done: false,
      addedBy: user?.uid || null,
      addedAt: Date.now(),
    });
    const newList = [...list, newItem];
    setList(newList);
    writeShoppingList({ [newId]: newItem });
    saveShoppingListLocally(newList);
    logItemEvent({
      name,
      category,
      categoryId: categoryIdResolved,
      action: 'added',
      source,
      qty: Number(defaultQuantity) || 1,
      quantityLabel: (defaultQuantity || '').trim() || undefined,
    });
    void ensureListItemNameInLibrary(name, categoryIdResolved);
    const gaSource =
      source === 'quickAdd' ? 'quick_add' : source === 'search' ? 'search' : 'typed';
    trackEvent('list_item_added', { source: gaSource });
  };

  const getItemCategoryId = (item) => item?.categoryId || categoryIdByName[item?.category] || null;
  const getShoppingCategoryName = (item) => {
    const catId = getItemCategoryId(item);
    return (catId && categoryNameForId(catId)) || item?.category || '';
  };

  const toggleDone = (id) => {
    const target = list.find(item => item.id === id);
    if (!target) return;
    const nextDone = !target.done;
    const newList = list.map(item => item.id === id ? stampRecord({ ...item, done: nextDone }) : item);
    setList(newList); // Optimistic update
    writeShoppingList({
      [`${id}/done`]: nextDone,
      [`${id}/updatedAt`]: Date.now(),
      [`${id}/updatedBy`]: currentEditor,
    });
    saveShoppingListLocally(newList);
    logItemEvent({
      name: target.name,
      category: getShoppingCategoryName(target),
      categoryId: getItemCategoryId(target),
      itemKey: getStableItemKey(target),
      action: target.done ? 'unchecked' : 'checked',
      qty: Number(target.quantity) || 1,
      quantityLabel: (target.quantity || '').trim() || undefined,
    });
    if (!target.done) {
      trackEvent('list_item_checked', {});
    }
  };

  const updateQuantity = (itemKey, qty) => {
    if (!assertWriteAllowed('gated_action')) return;
    setList((prevList) => {
      const matches = prevList.filter(item => getStableItemKey(item) === itemKey);
      const nextList = prevList.map(item =>
        getStableItemKey(item) === itemKey
          ? stampRecord({ ...item, itemKey: getStableItemKey(item), quantity: qty })
          : item
      );
      const updates = {};
      const stamp = Date.now();
      for (const m of matches) {
        updates[`${m.id}/quantity`] = qty;
        updates[`${m.id}/itemKey`] = getStableItemKey(m);
        updates[`${m.id}/updatedAt`] = stamp;
        updates[`${m.id}/updatedBy`] = currentEditor;
      }
      writeShoppingList(updates);
      saveShoppingListLocally(nextList);

      const target = prevList.find(item => getStableItemKey(item) === itemKey);
      if (target) {
        const nextDefaults = { ...quantityDefaults };
        if (qty && qty.trim()) nextDefaults[itemKey] = qty.trim();
        else delete nextDefaults[itemKey];
        persistQuantityDefaults(nextDefaults);
      }

      return nextList;
    });
  };

  const loadLastPurchasedForItemQuery = async (query) => {
    if (!householdId) {
      setSelectedItemLastPurchased(null);
      return;
    }
    try {
      const all = await getHouseholdItemEventsMerged(database, householdId, {
        liveBucketMonthKey: itemEventsListenerMonth,
        liveBucketVal: liveItemEventsMonthVal,
      });
      if (!all.length) {
        setSelectedItemLastPurchased(null);
        return;
      }
      setSelectedItemLastPurchased(lastEffectivePurchaseTimestamp(all, query, {}));
    } catch (err) {
      logger.warn('App', 'Failed to fetch last purchased for item', { error: err.message });
    }
  };

  const computeRenameOutcome = (prevList, itemKey, trimmed, vis, lib) => {
    const target = prevList.find(item => getStableItemKey(item) === itemKey);
    if (!target || !trimmed) return null;
    const targetName = String(target.name ?? '').trim();
    if (trimmed === targetName) return null;

    const oldNameLower = targetName.toLowerCase();
    const targetStableKey = getStableItemKey(target);
    const renamedTarget = stampRecord({ ...target, itemKey: targetStableKey, name: trimmed });
    const nextList = [];
    const orphanIds = [];
    for (const item of prevList) {
      const sameLogicalRow = getStableItemKey(item) === itemKey;
      const orphanWithOldName = !sameLogicalRow
        && (item.categoryId || item.category) === (target.categoryId || target.category)
        && String(item.name ?? '').trim().toLowerCase() === oldNameLower;
      if (orphanWithOldName) {
        orphanIds.push(item.id);
        continue;
      }
      nextList.push(sameLogicalRow ? renamedTarget : item);
    }

    const renameBucket = (bucketMap) => {
      const out = {};
      let changed = false;
      for (const [catId, items] of Object.entries(bucketMap || {})) {
        const renamed = (items || []).map((s) =>
          String(s?.name ?? '').trim().toLowerCase() === oldNameLower ? { ...s, name: trimmed } : s
        );
        const hitChange = renamed.some((s, i) => s !== items[i]);
        if (!hitChange) { out[catId] = items; continue; }
        changed = true;
        const seen = new Set();
        const deduped = [];
        for (const s of renamed.sort((a, b) => a.name.localeCompare(b.name))) {
          const key = String(s.name ?? '').trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(s);
        }
        out[catId] = deduped;
      }
      return changed ? out : null;
    };
    const nextVisible = renameBucket(vis);
    const nextLibrary = renameBucket(lib);
    return {
      nextList,
      nextVisible,
      nextLibrary,
      renamedTarget,
      orphanIds,
      renameLog: {
        oldName: targetName,
        newName: trimmed,
        category: getShoppingCategoryName(target),
        categoryId: getItemCategoryId(target),
        itemKey: targetStableKey,
      },
    };
  };

  const updateItemName = async (itemKey, nextName) => {
    if (!assertWriteAllowed('gated_action')) return;
    const trimmed = (nextName || '').trim();
    let outcome = null;
    // Run synchronously so `outcome` is set before persistence / item-events (React 18 may defer plain setList updaters).
    flushSync(() => {
      setList((prevList) => {
        outcome = computeRenameOutcome(prevList, itemKey, trimmed, visibleItemsV2, libraryItemsV2);
        return outcome ? outcome.nextList : prevList;
      });
    });
    if (!outcome) return;

    const renameUpdates = {
      [`${outcome.renamedTarget.id}/name`]: outcome.renamedTarget.name,
      [`${outcome.renamedTarget.id}/itemKey`]: outcome.renamedTarget.itemKey,
      [`${outcome.renamedTarget.id}/updatedAt`]: outcome.renamedTarget.updatedAt,
      [`${outcome.renamedTarget.id}/updatedBy`]: outcome.renamedTarget.updatedBy,
    };
    for (const orphanId of outcome.orphanIds) {
      renameUpdates[orphanId] = null;
    }
    writeShoppingList(renameUpdates);
    saveShoppingListLocally(outcome.nextList);
    if (outcome.renameLog) {
      logItemEvent({
        name: outcome.renameLog.newName,
        prevName: outcome.renameLog.oldName,
        category: outcome.renameLog.category,
        categoryId: outcome.renameLog.categoryId,
        itemKey: outcome.renameLog.itemKey,
        action: 'renamed',
      });
    }
    if (outcome.nextVisible) {
      setVisibleItemsV2(outcome.nextVisible);
      save('taxonomy/visible-items', outcome.nextVisible);
    }
    if (outcome.nextLibrary) {
      setLibraryItemsV2(outcome.nextLibrary);
      save('taxonomy/library', outcome.nextLibrary);
    }

    setSelectedItem(si => (si && getStableItemKey(si) === itemKey ? { ...si, name: trimmed } : si));
    const row = outcome.nextList.find(li => getStableItemKey(li) === itemKey);
    void loadLastPurchasedForItemQuery({
      name: trimmed,
      itemKey,
      categoryName: row ? getShoppingCategoryName(row) : '',
      categoryId: row ? getItemCategoryId(row) : null,
    });
  };

  const renameTaxonomySuggestionById = (categoryId, suggestionId, trimmed) => {
    if (!categoryId || !suggestionId) return;
    if (!assertWriteAllowed('gated_action')) return;

    const renameIdInList = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return null;
      const target = arr.find((i) => i.id === suggestionId);
      if (!target) return null;
      if (String(target.name ?? '').trim() === trimmed) return null;
      const renamed = arr.map((i) => (i.id === suggestionId ? { ...i, name: trimmed } : i));
      const seen = new Set();
      const deduped = [];
      for (const s of renamed.sort((a, b) => a.name.localeCompare(b.name))) {
        const key = String(s.name ?? '').trim().toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(s);
      }
      return deduped;
    };

    const nextVisSlice = renameIdInList(visibleItemsV2[categoryId]);
    const nextLibSlice = renameIdInList(libraryItemsV2[categoryId]);
    if (nextVisSlice === null && nextLibSlice === null) return;

    if (nextVisSlice !== null) {
      const nextVisible = { ...visibleItemsV2, [categoryId]: nextVisSlice };
      setVisibleItemsV2(nextVisible);
      save('taxonomy/visible-items', nextVisible);
    }
    if (nextLibSlice !== null) {
      const nextLibrary = { ...libraryItemsV2, [categoryId]: nextLibSlice };
      setLibraryItemsV2(nextLibrary);
      save('taxonomy/library', nextLibrary);
    }
  };

  const moveSuggestionToCategory = async (suggestionId, fromCatId, toCatId) => {
    if (!taxonomyBase || !suggestionId || !fromCatId || !toCatId || fromCatId === toCatId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const fromVis = visibleItemsV2[fromCatId] || [];
    const fromLib = libraryItemsV2[fromCatId] || [];
    const fromVisEntry = fromVis.find(i => i.id === suggestionId);
    const fromLibEntry = fromLib.find(i => i.id === suggestionId);
    const moving = fromVisEntry || fromLibEntry;
    if (!moving) return;
    const wasVisible = !!fromVisEntry;

    const nameLower = String(moving.name ?? '').trim().toLowerCase();
    const toVis = visibleItemsV2[toCatId] || [];
    const toLib = libraryItemsV2[toCatId] || [];
    const duplicate = toVis.some(i => i.name.toLowerCase() === nameLower)
      || toLib.some(i => i.name.toLowerCase() === nameLower);

    const nextFromVis = fromVis.filter(i => i.id !== suggestionId);
    const nextFromLib = fromLib.filter(i => i.id !== suggestionId);
    const nextTo = duplicate
      ? null
      : [...(wasVisible ? toVis : toLib), stampRecord({ id: moving.id, name: moving.name })]
          .sort((a, b) => a.name.localeCompare(b.name));

    const nextVisibleState = { ...visibleItemsV2, [fromCatId]: nextFromVis };
    const nextLibraryState = { ...libraryItemsV2, [fromCatId]: nextFromLib };
    if (nextTo && wasVisible) nextVisibleState[toCatId] = nextTo;
    if (nextTo && !wasVisible) nextLibraryState[toCatId] = nextTo;

    setVisibleItemsV2(nextVisibleState);
    setLibraryItemsV2(nextLibraryState);

    const updates = {
      [`${taxonomyBase}/visible-items/${fromCatId}`]: nextFromVis.length > 0 ? nextFromVis : null,
      [`${taxonomyBase}/library/${fromCatId}`]: nextFromLib.length > 0 ? nextFromLib : null,
    };
    if (nextTo && wasVisible) updates[`${taxonomyBase}/visible-items/${toCatId}`] = nextTo;
    if (nextTo && !wasVisible) updates[`${taxonomyBase}/library/${toCatId}`] = nextTo;
    await update(ref(database), updates);
  };

  const removeSuggestionEverywhere = async (suggestionId, catId) => {
    if (!taxonomyBase || !suggestionId || !catId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const vis = visibleItemsV2[catId] || [];
    const lib = libraryItemsV2[catId] || [];
    const demoted = vis.find(i => i.id === suggestionId);
    if (demoted) {
      const nextVis = vis.filter(i => i.id !== suggestionId);
      const nextLib = lib.some(i => i.id === suggestionId) ? lib : [...lib, demoted];
      setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
      setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
      await update(ref(database), {
        [`${taxonomyBase}/visible-items/${catId}`]: nextVis.length > 0 ? nextVis : null,
        [`${taxonomyBase}/library/${catId}`]: nextLib,
      });
    } else {
      const nextLib = lib.filter(i => i.id !== suggestionId);
      if (nextLib.length === lib.length) return;
      setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
      await update(ref(database), {
        [`${taxonomyBase}/library/${catId}`]: nextLib.length > 0 ? nextLib : null,
      });
    }
  };

  /** Same DB path as ItemBottomSheet Pin / `promoteToShortcut` — list row → visible-items. */
  const promoteListItemToVisibleShortcut = async (item) => {
    const catId = getItemCategoryId(item);
    const trimmed = String(item.name || '').trim();
    if (!catId || !trimmed || !taxonomyBase) return null;
    if (!assertWriteAllowed('gated_action')) return null;
    const vis = visibleItemsV2[catId] || [];
    const lib = libraryItemsV2[catId] || [];
    const lower = trimmed.toLowerCase();
    if (vis.some(i => i.name.toLowerCase() === lower)) return null;
    const libItem = lib.find(i => i.name.toLowerCase() === lower);
    const newId = libItem?.id || push(ref(database, `${taxonomyBase}/visible-items/${catId}`)).key;
    const entry = stampRecord({ id: newId, name: trimmed, createdAt: libItem?.createdAt || Date.now() });
    const nextVis = [...vis, entry];
    const nextLib = libItem ? lib.filter(i => i.id !== libItem.id) : lib;
    setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
    if (libItem) setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
    const updates = { [`${taxonomyBase}/visible-items/${catId}`]: nextVis };
    if (libItem) updates[`${taxonomyBase}/library/${catId}`] = nextLib.length > 0 ? nextLib : null;
    await update(ref(database), updates);
    return { newId, catId };
  };

  const updateSuggestionQuantity = (itemKey, qty) => {
    if (!assertWriteAllowed('gated_action')) return;
    const nextDefaults = { ...quantityDefaults };
    const t = String(qty ?? '').trim();
    if (t) nextDefaults[itemKey] = t;
    else delete nextDefaults[itemKey];
    void persistQuantityDefaults(nextDefaults);
  };

  const findShortcutForListItem = (item) => {
    const nameLower = String(item?.name ?? '').trim().toLowerCase();
    if (!nameLower) return null;
    const preferredCatId = getItemCategoryId(item);
    const searchIn = (catId) => {
      const vis = (visibleItemsV2[catId] || []).find(s => s.name.toLowerCase() === nameLower);
      if (vis) return { suggestionId: vis.id, categoryId: catId };
      return null;
    };
    if (preferredCatId) {
      const hit = searchIn(preferredCatId);
      if (hit) return hit;
    }
    for (const catId of Object.keys(categoriesV2)) {
      if (catId === preferredCatId) continue;
      const hit = searchIn(catId);
      if (hit) return hit;
    }
    return null;
  };

  const findLibraryMatchForListItem = (item) => {
    const nameLower = String(item?.name ?? '').trim().toLowerCase();
    if (!nameLower) return null;
    const preferredCatId = getItemCategoryId(item);
    const searchIn = (catId) => {
      const lib = (libraryItemsV2[catId] || []).find(s => s.name.toLowerCase() === nameLower);
      if (lib) return { suggestionId: lib.id, categoryId: catId };
      return null;
    };
    if (preferredCatId) {
      const hit = searchIn(preferredCatId);
      if (hit) return hit;
    }
    for (const catId of Object.keys(categoriesV2)) {
      if (catId === preferredCatId) continue;
      const hit = searchIn(catId);
      if (hit) return hit;
    }
    return null;
  };

  const openItemSheet = async (item) => {
    const itemKey = getStableItemKey(item);
    const base = { ...item, itemKey, onQuantityChange: updateQuantity, onNameChange: updateItemName };
    // Surface pin/promote affordances in both Shop and Plan mode so the sheet's
    // breadcrumb + Pin button work universally (per Pass 2 / decision 5.2).
    const makeListItemPinnedSuggestionConfig = (suggestionId, fromCatId, pinOptions = {}) => {
      const allowUnpin = pinOptions.allowUnpin !== false;
      const cfg = {
        categoryId: fromCatId,
        aisleId: categoriesV2[fromCatId]?.aisleId || null,
        onMove: async (toCatId) => {
          await moveSuggestionToCategory(suggestionId, fromCatId, toCatId);
          const toCategoryName = categoriesV2[toCatId]?.name || '';
          setList(prev => {
            const matches = prev.filter(li => getStableItemKey(li) === itemKey);
            const next = prev.map(li =>
              getStableItemKey(li) === itemKey
                ? { ...li, categoryId: toCatId, category: toCategoryName }
                : li
            );
            const updates = {};
            const stamp = Date.now();
            for (const m of matches) {
              updates[`${m.id}/categoryId`] = toCatId;
              updates[`${m.id}/category`] = toCategoryName;
              updates[`${m.id}/updatedAt`] = stamp;
              updates[`${m.id}/updatedBy`] = currentEditor;
            }
            writeShoppingList(updates);
            saveShoppingListLocally(next);
            return next;
          });
          setSelectedItem(prev => {
            if (!prev || getStableItemKey(prev) !== itemKey) return prev;
            return {
              ...prev,
              categoryId: toCatId,
              category: toCategoryName,
              suggestionConfig: makeListItemPinnedSuggestionConfig(suggestionId, toCatId, { allowUnpin }),
            };
          });
        },
      };
      if (allowUnpin) {
        cfg.onRemove = async () => {
          await removeSuggestionEverywhere(suggestionId, fromCatId);
          setSelectedItem(prev => {
            if (!prev || getStableItemKey(prev) !== itemKey) return prev;
            const next = { ...prev };
            delete next.suggestionConfig;
            const catId = getItemCategoryId(next);
            if (catId) {
              next.promoteToShortcut = async () => {
                const promoted = await promoteListItemToVisibleShortcut(next);
                if (!promoted) return null;
                const { newId, catId: pinnedCatId } = promoted;
                return makeListItemPinnedSuggestionConfig(newId, pinnedCatId);
              };
            }
            return next;
          });
        };
      }
      return cfg;
    };
    const matchVis = findShortcutForListItem(item);
    const matchLib = matchVis ? null : findLibraryMatchForListItem(item);
    if (matchVis) {
      base.suggestionConfig = makeListItemPinnedSuggestionConfig(matchVis.suggestionId, matchVis.categoryId);
    } else if (matchLib) {
      base.suggestionConfig = makeListItemPinnedSuggestionConfig(matchLib.suggestionId, matchLib.categoryId, {
        allowUnpin: false,
      });
      const catId = getItemCategoryId(item);
      if (catId) {
        base.promoteToShortcut = async () => {
          const promoted = await promoteListItemToVisibleShortcut(item);
          if (!promoted) return null;
          const { newId, catId: pinnedCatId } = promoted;
          return makeListItemPinnedSuggestionConfig(newId, pinnedCatId);
        };
      }
    } else {
      const catId = getItemCategoryId(item);
      if (catId) {
        base.promoteToShortcut = async () => {
          const promoted = await promoteListItemToVisibleShortcut(item);
          if (!promoted) return null;
          const { newId, catId: pinnedCatId } = promoted;
          return makeListItemPinnedSuggestionConfig(newId, pinnedCatId);
        };
      }
    }
    // Promotion hint: only when the name is not already a visible shortcut tile.
    if (!matchVis) {
      const lower = String(item.name || '').toLowerCase();
      const candidate = promotionCandidatesCache.find(c =>
        (c.name || '').toLowerCase() === lower
      );
      if (candidate) base.promotionHint = candidate;
    }
    setSelectedItem(base);
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemQuery({
      name: item.name,
      itemKey: getStableItemKey(item),
      categoryName: getShoppingCategoryName(item),
      categoryId: getItemCategoryId(item),
    });
  };

  const openSuggestionSheet = async (cat, suggestion) => {
    const categoryId = suggestion.catId || categoryIdByName[cat] || null;
    const suggestionId = suggestion.id;
    const defaultQty = getDefaultQuantityForItem(suggestionId, suggestion.name);
    const onNameChange = categoryId
      ? async (itemKey, nextName) => {
          const trimmed = (nextName || '').trim();
          if (!trimmed) return;
          renameTaxonomySuggestionById(categoryId, itemKey, trimmed);
          setSelectedItem(si =>
            si && String(si.itemKey) === String(itemKey) ? { ...si, name: trimmed } : si
          );
          void loadLastPurchasedForItemQuery({
            name: trimmed,
            itemKey: suggestionId,
            categoryName: cat,
            categoryId,
          });
        }
      : undefined;
    const makeAddSuggestionTaxonomyConfig = (sid, cid) => ({
      categoryId: cid,
      aisleId: categoriesV2[cid]?.aisleId || null,
      onMove: async (toCatId) => {
        await moveSuggestionToCategory(sid, cid, toCatId);
        setSelectedItem(prev => {
          if (!prev || prev.itemKey !== sid) return prev;
          const catName = categoriesV2[toCatId]?.name || '';
          return {
            ...prev,
            categoryId: toCatId,
            category: catName,
            suggestionConfig: makeAddSuggestionTaxonomyConfig(sid, toCatId),
          };
        });
      },
      onRemove: async () => {
        await removeSuggestionEverywhere(sid, cid);
        setSelectedItem(null);
      },
    });
    const suggestionConfig = categoryId
      ? makeAddSuggestionTaxonomyConfig(suggestionId, categoryId)
      : null;
    const item = {
      ...suggestion,
      category: cat,
      categoryId,
      itemKey: suggestionId,
      quantity: (suggestion.quantity || '').trim() || defaultQty,
      onQuantityChange: updateSuggestionQuantity,
      ...(onNameChange ? { onNameChange } : {}),
      ...(suggestionConfig ? { suggestionConfig } : {}),
    };
    setSelectedItem(item);
    setSelectedItemLastPurchased(null);
    await loadLastPurchasedForItemQuery({
      name: suggestion.name,
      itemKey: suggestionId,
      categoryName: cat,
      categoryId,
    });
  };

  const doneCount = list.reduce((n, item) => n + (item.done ? 1 : 0), 0);

  const clearDone = () => {
    if (!assertWriteAllowed('gated_action')) return;
    const doneIds = list.filter(item => item.done).map(item => item.id);
    if (!doneIds.length) return;
    const newList = list.filter(item => !item.done);
    setList(newList); // Optimistic update
    const updates = Object.fromEntries(doneIds.map(id => [id, null]));
    writeShoppingList(updates);
    saveShoppingListLocally(newList);
  };

  /**
   * First-run tooltip for the Clear chip. Shows once per device when chip first appears, then never again
   * (localStorage flag). Auto-dismisses after 4s. Tapping the chip itself dismisses naturally because
   * clearing all done items unmounts the chip.
   */
  const hasDone = doneCount > 0;
  useEffect(() => {
    if (!hasDone) {
      setShowClearChipTooltip(false);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const FLAG = 'provisions.clearChipTooltipSeen.v1';
      if (window.localStorage.getItem(FLAG)) return;
      setShowClearChipTooltip(true);
      window.localStorage.setItem(FLAG, '1');
      const t = window.setTimeout(() => setShowClearChipTooltip(false), 4000);
      return () => window.clearTimeout(t);
    } catch {
      // localStorage unavailable (private mode, blocked, etc.) — silently skip the teaching moment.
    }
  }, [hasDone]);

  const removeItem = (id) => {
    if (!assertWriteAllowed('gated_action')) return;
    const target = list.find(item => item.id === id);
    const newList = list.filter(item => item.id !== id);
    setList(newList); // Optimistic update
    writeShoppingList({ [id]: null });
    saveShoppingListLocally(newList);
    if (target && !target.done) {
      if (target.quantity && target.quantity.trim()) {
        const nextDefaults = { ...quantityDefaults, [getStableItemKey(target)]: target.quantity.trim() };
        persistQuantityDefaults(nextDefaults);
      }
      logItemEvent({
        name: target.name,
        category: getShoppingCategoryName(target),
        categoryId: getItemCategoryId(target),
        action: 'removed',
        qty: Number(target.quantity) || 1,
        quantityLabel: (target.quantity || '').trim() || undefined,
      });
    }
  };

  const addFromAisleSearch = (aisleId, suggestion) => {
    if (!assertWriteAllowed('gated_action')) return;
    let catId = suggestion.catId;
    if (!catId) catId = (v2CategoriesByAisle[aisleId] || [])[0] || null;
    const categoryName = catId ? v2CategoryNameById[catId] : (aislesV2[aisleId]?.name || '');
    const addSource = suggestion.suggestionId != null ? 'search' : 'typed';
    addItem(suggestion.name, categoryName, addSource, generateId(), catId);
    setCategorySearches(prev => ({ ...prev, [aisleId]: '' }));
    setAisleHighlightedIndex(prev => ({ ...prev, [aisleId]: -1 }));
  };

  const getAisleSuggestions = (aisleId) => {
    const search = (categorySearches[aisleId] || '').toLowerCase().trim();
    if (!search) return [];
    const listNames = new Set(list.map(i => i.name.toLowerCase()));
    const catIds = v2CategoriesByAisle[aisleId] || [];
    const seen = new Set();
    const out = [];
    for (const catId of catIds) {
      const vis = visibleItemsV2[catId] || [];
      const lib = libraryItemsV2[catId] || [];
      for (const item of vis) {
        const lower = item.name.toLowerCase();
        if (seen.has(lower) || listNames.has(lower)) continue;
        if (lower.includes(search)) {
          seen.add(lower);
          out.push({ name: item.name, catId, suggestionId: item.id, fromVisible: true });
          if (out.length >= 10) return out;
        }
      }
      for (const item of lib) {
        const lower = item.name.toLowerCase();
        if (seen.has(lower) || listNames.has(lower)) continue;
        if (lower.includes(search)) {
          seen.add(lower);
          out.push({ name: item.name, catId, suggestionId: item.id, fromVisible: false });
          if (out.length >= 10) return out;
        }
      }
    }
    return out;
  };

  const getAisleDropdownItems = (aisleId) => {
    const raw = (categorySearches[aisleId] || '').trim();
    if (!raw) return [];
    const base = getAisleSuggestions(aisleId);
    const rawLc = raw.toLowerCase();
    const hasExact = base.some(s => s.name.toLowerCase() === rawLc);
    return hasExact ? base : [{ name: raw, catId: null, suggestionId: null, fromVisible: false }, ...base];
  };

  const AUTOCOMPLETE_MIN_SPACE_BELOW = 200;
  useLayoutEffect(() => {
    const prev = prevAisleAutocompleteOpenRef.current;
    const nextOpen = {};
    for (const aisleId of orderedV2AisleIds) {
      const trimmed = (categorySearches[aisleId] || '').trim();
      const expanded = Boolean(expandedCategories[aisleId]);
      const open = Boolean(quickAddMode && !pinEditMode && expanded && trimmed);
      nextOpen[aisleId] = open;
      const wasOpen = Boolean(prev[aisleId]);
      if (open && !wasOpen) {
        const el = aisleAddSearchInputRefs.current[aisleId];
        if (el) {
          const rect = el.getBoundingClientRect();
          const vh = window.visualViewport?.height ?? window.innerHeight;
          const spaceBelow = vh - rect.bottom;
          setAisleAutocompleteFlipUp((s) => ({ ...s, [aisleId]: spaceBelow < AUTOCOMPLETE_MIN_SPACE_BELOW }));
        }
      }
      if (!open && wasOpen) {
        setAisleAutocompleteFlipUp((s) => {
          if (!(aisleId in s)) return s;
          const { [aisleId]: _removed, ...rest } = s;
          return rest;
        });
      }
    }
    prevAisleAutocompleteOpenRef.current = nextOpen;
  }, [categorySearches, expandedCategories, quickAddMode, pinEditMode, aislesV2]);

  const organized = orderedV2AisleIds.map((aisleId) => {
    const catIds = v2CategoriesByAisle[aisleId] || [];
    const catIdSet = new Set(catIds);
    const catNames = new Set(catIds.map(id => v2CategoryNameById[id]).filter(Boolean));
    const aisleListItems = list.filter((i) => {
      const cid = getItemCategoryId(i);
      if (cid) return catIdSet.has(cid);
      return catNames.has(i.category);
    });
    const taken = new Set(list.map(i => i.name.toLowerCase()));
    const quickItems = quickAddMode
      ? catIds.flatMap(cid => (visibleItemsV2[cid] || [])
          .filter(v => !taken.has(v.name.toLowerCase()))
          .map(v => ({ ...v, catId: cid, catName: v2CategoryNameById[cid] })))
      : [];
    const all = [
      ...aisleListItems.map(i => ({ type: 'list', data: i, key: i.name.toLowerCase() })),
      ...quickItems.map(i => ({ type: 'quick', data: i, key: i.name.toLowerCase() })),
    ].sort((a, b) => a.key.localeCompare(b.key));
    const aisleName = aislesV2[aisleId]?.name || '';
    return {
      aisleId,
      aisleName,
      aisleNameDisplay: formatAisleNameForDisplay(aisleName),
      items: all,
      has: all.length > 0,
      categoryIdSet: catIdSet,
      categoryNames: catNames,
    };
  });

  /** Shop mode: only show aisles that have at least one list item (checked items still count). */
  const aislesForListUi = quickAddMode ? organized : organized.filter((g) => g.has);

  useEffect(() => {
    const modeChanged = prevQuickAddMode.current !== quickAddMode;
    prevQuickAddMode.current = quickAddMode;

    const aisleIdsKey = Object.keys(aislesV2)
      .sort((a, b) => (aislesV2[a]?.order ?? 0) - (aislesV2[b]?.order ?? 0))
      .join('\0');
    // Must match `organized` list filtering: if we have a category id, only that id's membership
    // in this aisle counts — do not fall back to name (duplicate names across aisles would
    // otherwise mark multiple aisles as "having" one item).
    const hasItemsInAisle = (g) => list.some((item) => {
      const cid = getItemCategoryId(item);
      if (cid) return g.categoryIdSet.has(cid);
      return g.categoryNames.has(item.category);
    });

    if (quickAddMode) {
      if (modeChanged) {
        const initial = {};
        organized.forEach((g) => {
          initial[g.aisleId] = true;
        });
        setExpandedCategories(initial);
        shopAisleDefaultsKeyRef.current = '';
        prevShopAisleHadItemsRef.current = {};
      }
      return;
    }

    const nextHadItems = {};
    organized.forEach((g) => {
      nextHadItems[g.aisleId] = hasItemsInAisle(g);
    });

    if (householdId !== shopAisleDefaultsHouseholdIdRef.current) {
      shopAisleDefaultsHouseholdIdRef.current = householdId;
      shopAisleDefaultsKeyRef.current = '';
      prevShopAisleHadItemsRef.current = {};
    }

    // Shop: collapsed by default; expand only when applying defaults (enter shop / first aisle load / aisle set change), not on every list update.
    if (modeChanged) {
      const initial = {};
      organized.forEach((g) => {
        initial[g.aisleId] = hasItemsInAisle(g);
      });
      setExpandedCategories(initial);
      shopAisleDefaultsKeyRef.current = aisleIdsKey;
      prevShopAisleHadItemsRef.current = nextHadItems;
      return;
    }

    if (aisleIdsKey !== shopAisleDefaultsKeyRef.current) {
      if (shopAisleDefaultsKeyRef.current === '') {
        const initial = {};
        organized.forEach((g) => {
          initial[g.aisleId] = hasItemsInAisle(g);
        });
        setExpandedCategories(initial);
      } else {
        setExpandedCategories((prev) => {
          const next = { ...prev };
          for (const g of organized) {
            if (!(g.aisleId in next)) next[g.aisleId] = false;
          }
          const idSet = new Set(organized.map((g) => g.aisleId));
          for (const id of Object.keys(next)) {
            if (!idSet.has(id)) delete next[id];
          }
          return next;
        });
      }
      shopAisleDefaultsKeyRef.current = aisleIdsKey;
    } else {
      const prevHad = prevShopAisleHadItemsRef.current;
      const toCollapse = [];
      const toExpand = [];
      for (const g of organized) {
        if (prevHad[g.aisleId] === true && !nextHadItems[g.aisleId]) {
          toCollapse.push(g.aisleId);
        }
        // List often arrives after taxonomy: first effect had an empty list and collapsed
        // everything; when items sync, expand aisles that now have items (not after a manual
        // collapse while the aisle still had stock — then prevHad stayed true).
        if (nextHadItems[g.aisleId] && prevHad[g.aisleId] !== true) {
          toExpand.push(g.aisleId);
        }
      }
      if (toCollapse.length > 0 || toExpand.length > 0) {
        setExpandedCategories((p) => {
          const n = { ...p };
          for (const id of toCollapse) n[id] = false;
          for (const id of toExpand) n[id] = true;
          return n;
        });
      }
    }

    prevShopAisleHadItemsRef.current = nextHadItems;
  }, [quickAddMode, list, aislesV2, categoriesV2, householdId]);

  // --- A1/B1: Load events and compute candidates when entering Plan mode ---
  useEffect(() => {
    if (!quickAddMode || !householdId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [evList, dismissSnap] = await Promise.all([
          getHouseholdItemEventsMerged(database, householdId, {
            liveBucketMonthKey: itemEventsListenerMonth,
            liveBucketVal: liveItemEventsMonthVal,
          }),
          get(ref(database, `households/${householdId}/suggestion-dismissals`)),
        ]);
        if (cancelled) return;

        const dismissRaw = dismissSnap.val() || {};
        setSuggestionDismissals(dismissRaw);

        const now = Date.now();
        const isDismissed = (key) => {
          const d = dismissRaw[key];
          if (!d) return false;
          if (d.resurfaceAfter === null || d.resurfaceAfter === undefined) {
            return d.dismissCount >= 2;
          }
          return d.resurfaceAfter > now;
        };

        const promo = promotionCandidates(evList, visibleItemsV2, categoriesV2, { now });
        const filtered = promo.filter(c => {
          const key = `${c.categoryId || c.category}::${(c.name || '').toLowerCase()}::promote`;
          return !isDismissed(key);
        });
        setPromotionCandidatesCache(filtered);

        const dormant = dormantShortcuts(evList, visibleItemsV2, categoriesV2, { now });
        const filteredDormant = dormant.filter(d => {
          const key = `${d.categoryId}::${(d.name || '').toLowerCase()}::demote`;
          return !isDismissed(key);
        });
        setDormantShortcutsCache(filteredDormant);
      } catch (err) {
        logger.warn('App', 'A1/B1 candidate computation failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [
    quickAddMode,
    householdId,
    itemEventsListenerMonth,
    liveItemEventsMonthVal,
    visibleItemsV2,
    categoriesV2,
  ]);

  const dismissSuggestion = async (key, action) => {
    if (!householdId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const existing = suggestionDismissals[key];
    const count = (existing?.dismissCount || 0) + 1;
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    const record = {
      action,
      dismissedAt: Date.now(),
      resurfaceAfter: count >= 2 ? null : Date.now() + NINETY_DAYS,
      dismissCount: count,
    };
    setSuggestionDismissals(prev => ({ ...prev, [key]: record }));
    try {
      await set(ref(database, `households/${householdId}/suggestion-dismissals/${key}`), record);
    } catch (err) {
      logger.warn('App', 'dismissal write failed', { error: err.message, key });
    }
  };

  /** Density nudge: `dismissCount` stores pinned-item threshold at dismiss (resurface when count ≥ threshold + 4). */
  const recordDensityDismissal = async (aisleId, thresholdAtDismiss) => {
    if (!householdId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const key = `density::${aisleId}`;
    const record = {
      action: 'density-dismissed',
      dismissedAt: Date.now(),
      resurfaceAfter: null,
      dismissCount: thresholdAtDismiss,
    };
    setSuggestionDismissals(prev => ({ ...prev, [key]: record }));
    try {
      await set(ref(database, `households/${householdId}/suggestion-dismissals/${key}`), record);
    } catch (err) {
      logger.warn('App', 'density dismissal write failed', { error: err.message, key });
    }
  };

  const enterPinEditMode = (aisleId, dormantHighlightSet = null) => {
    if (!assertWriteAllowed('gated_action')) return;
    if (typeof window !== 'undefined') pinEditReturnScrollY.current = window.scrollY;
    setPinEditTriggerAisleId(aisleId);
    setPinEditDormantHighlightSet(dormantHighlightSet);
    setPinEditMode(true);
  };

  const finalizePinEdit = (visibleSnap, dormantSet, scrollY) => {
    if (dormantSet && dormantSet.size > 0) {
      dormantSet.forEach((combined) => {
        const sep = combined.indexOf('::');
        if (sep < 0) return;
        const categoryId = combined.slice(0, sep);
        const suggestionId = combined.slice(sep + 2);
        const row = (visibleSnap[categoryId] || []).find(s => s.id === suggestionId);
        if (!row) return;
        void dismissSuggestion(`${categoryId}::${String(row.name).toLowerCase()}::demote`, 'keep');
      });
      setDormantShortcutsCache(prev =>
        prev.filter(d => !dormantSet.has(`${d.categoryId}::${d.suggestionId}`)),
      );
    }
    setPinEditMode(false);
    setPinEditTriggerAisleId(null);
    setPinEditDormantHighlightSet(null);
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
      });
    }
  };

  const exitPinEditMode = () => {
    finalizePinEdit(visibleItemsV2, pinEditDormantHighlightSet, pinEditReturnScrollY.current);
  };

  const handlePinEditToggle = async (row) => {
    if (row.type === 'quick') {
      const qi = row.data;
      await removeSuggestionEverywhere(qi.id, qi.catId);
      return;
    }
    const li = row.data;
    const match = findShortcutForListItem(li);
    if (match) {
      await removeSuggestionEverywhere(match.suggestionId, match.categoryId);
    } else {
      await promoteListItemToVisibleShortcut(li);
    }
  };

  useLayoutEffect(() => {
    if (!pinEditMode || !pinEditTriggerAisleId) return;
    const id = `pin-edit-aisle-${pinEditTriggerAisleId}`;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }, [pinEditMode, pinEditTriggerAisleId]);

  useEffect(() => {
    if (quickAddMode || !pinEditMode) return;
    finalizePinEdit(visibleItemsV2, pinEditDormantHighlightSet, pinEditReturnScrollY.current);
  }, [quickAddMode, pinEditMode]);

  const handlePromotionAccept = async (candidate) => {
    if (!assertWriteAllowed('gated_action')) return;
    const catId = candidate.categoryId || categoryIdByName[(candidate.category || '').toLowerCase()];
    if (!catId || !taxonomyBase) return;
    const trimmed = (candidate.name || '').trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const vis = visibleItemsV2[catId] || [];
    const lib = libraryItemsV2[catId] || [];
    if (vis.some(i => i.name.toLowerCase() === lower)) return;
    const libItem = lib.find(i => i.name.toLowerCase() === lower);
    const newId = libItem?.id || push(ref(database, `${taxonomyBase}/visible-items/${catId}`)).key;
    const entry = stampRecord({ id: newId, name: trimmed, createdAt: libItem?.createdAt || Date.now() });
    const nextVis = [...vis, entry].sort((a, b) => a.name.localeCompare(b.name));
    const nextLib = libItem ? lib.filter(i => i.id !== libItem.id) : lib;
    setVisibleItemsV2(prev => ({ ...prev, [catId]: nextVis }));
    if (libItem) setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
    const updates = { [`${taxonomyBase}/visible-items/${catId}`]: nextVis };
    if (libItem) updates[`${taxonomyBase}/library/${catId}`] = nextLib.length > 0 ? nextLib : null;
    await update(ref(database), updates);
    setPromotionCandidatesCache(prev => prev.filter(c => c.name !== candidate.name || c.category !== candidate.category));
  };

  const handlePromotionDismiss = (candidate) => {
    if (!assertWriteAllowed('gated_action')) return;
    const key = `${candidate.categoryId || candidate.category}::${(candidate.name || '').toLowerCase()}::promote`;
    dismissSuggestion(key, 'not-interested');
    setPromotionCandidatesCache(prev => prev.filter(c => c.name !== candidate.name || c.category !== candidate.category));
  };

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollingDown = currentScrollY > lastScrollY.current;
      const scrollingUp = currentScrollY < lastScrollY.current;

      // Header visibility - hide when scrolling down past 50px, show when scrolling up.
      // List toolbar (mobile bottom / desktop top) stays fixed; on desktop its offset follows the header.
      if (scrollingDown && currentScrollY > 50) {
        setShowHeader(false);
        setShowMenu(false); // Close menu when hiding header
      } else if (scrollingUp) {
        setShowHeader(true);
      }

      // Detect scrolling for fade effects - only at moderate to fast speeds
      const now = Date.now();
      const timeDelta = Math.max(now - lastScrollTime.current, 1);
      const scrollDelta = Math.abs(currentScrollY - lastScrollY.current);
      const instantVelocity = (scrollDelta / timeDelta) * 1000; // pixels per second

      // Smooth the velocity to avoid flickering
      smoothedVelocity.current = smoothedVelocity.current * 0.7 + instantVelocity * 0.3;

      const velocityThreshold = 800; // pixels per second

      if (smoothedVelocity.current >= velocityThreshold) {
        setIsScrolling(true);
        if (scrollTimeoutRef.current) {
          clearTimeout(scrollTimeoutRef.current);
        }
        scrollTimeoutRef.current = setTimeout(() => {
          setIsScrolling(false);
          smoothedVelocity.current = 0;
        }, 150);
      }

      lastScrollTime.current = now;

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentPage]);

  useEffect(() => {
    const inOnboarding =
      Boolean(user) &&
      !needsDisplayName &&
      Object.keys(aislesV2).length > 0 &&
      Object.keys(categoriesV2).length > 0 &&
      onboardingCompleted === false;
    if (inOnboarding) {
      if (onboardingEnteredAtRef.current == null) {
        onboardingEnteredAtRef.current = Date.now();
      }
    } else if (!user || onboardingCompleted === true) {
      onboardingEnteredAtRef.current = null;
    }
  }, [user, needsDisplayName, aislesV2, categoriesV2, onboardingCompleted]);

  useEffect(() => {
    if (!user?.uid || !householdId) return;
    setAnalyticsUserProperties({
      platform: Capacitor.getPlatform(),
      household_role: isAdmin ? 'admin' : 'member',
    });
  }, [user?.uid, householdId, isAdmin]);

  useEffect(() => {
    setPaywallOpener(setPaywallTrigger);
    return () => setPaywallOpener(null);
  }, []);

  useEffect(() => {
    const unsubscribe = listenToSubscriptionChanges(() => {
      setSubscriptionStatus(getSubscriptionStatus());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!householdId) return;
    let cancelled = false;
    initSubscriptions(householdId)
      .then(() => {
        if (!cancelled) setSubscriptionStatus(getSubscriptionStatus());
      })
      .catch((err) => logger.error('Subscriptions', 'init failed', { error: err?.message }));
    return () => { cancelled = true; };
  }, [householdId]);

  const handleSubscriptionChanged = useCallback(() => {
    if (!householdId) return;
    set(ref(database, `households/${householdId}/subscriptionUpdatedAt`), Date.now()).catch(() => {});
  }, [householdId]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      refreshCustomerInfo().then(() => setSubscriptionStatus(getSubscriptionStatus()));
    });
    return () => { listener.then((h) => h.remove()); };
  }, []);

  useEffect(() => {
    if (!user?.uid || !householdId) {
      quickAddModeAnalyticsRef.current = null;
      return;
    }
    if (quickAddModeAnalyticsRef.current === null) {
      quickAddModeAnalyticsRef.current = quickAddMode;
      return;
    }
    if (quickAddModeAnalyticsRef.current === quickAddMode) return;
    quickAddModeAnalyticsRef.current = quickAddMode;
    trackEvent('mode_switched', { to: quickAddMode ? 'add' : 'shop' });
  }, [quickAddMode, user?.uid, householdId]);

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const handleLoginSuccess = useCallback(() => {
    setShowLoginExplicitly(false);
    setLoginLegalView(null);
    window.history.replaceState({}, '', '/app');
    // Login is an early return in this component; list/Shop state would otherwise persist (e.g. Account page).
    setCurrentPage('list');
    setQuickAddMode(false);
  }, []);

  const enterAddMode = () => {
    if (!assertWriteAllowed('gated_action')) return;
    setQuickAddMode(true);
  };

  const openLoginLegalView = useCallback((view) => {
    const path = view === 'privacy' ? LEGAL_PATH_PRIVACY : LEGAL_PATH_TERMS;
    window.history.pushState({ loginLegal: view }, '', path);
    setLoginLegalView(view);
  }, []);

  const closeLoginLegalView = useCallback(() => {
    if (window.history.state?.loginLegal) {
      window.history.back();
      return;
    }
    window.history.replaceState({}, '', '/signin');
    setLoginLegalView(null);
  }, []);

  const openAppLegalPage = useCallback((page) => {
    legalReturnPageRef.current = currentPage;
    setCurrentPage(page);
    const path = page === 'privacy' ? LEGAL_PATH_PRIVACY : LEGAL_PATH_TERMS;
    window.history.pushState({ appLegal: true }, '', path);
  }, [currentPage]);

  const closeAppLegalPage = useCallback(() => {
    if (window.history.state?.appLegal) {
      window.history.back();
      return;
    }
    window.history.replaceState({}, '', '/app');
    setCurrentPage(legalReturnPageRef.current || 'account');
  }, []);

  const handleSignOut = async () => {
    setShowMenu(false);
    setCurrentPage('list');
    setQuickAddMode(false);
    logger.info('Auth', 'Sign out initiated');
    try {
      await logger.flush();
      logger.setUserId(null);
      setAnalyticsUserId(null);
      await shutdownSubscriptions();
      setSubscriptionStatus(getSubscriptionStatus());
      // Clear IndexedDB auth before signOut so onAuthStateChanged never re-adopts a stale cached user
      await clearCachedUser();
      await firebaseSignOut(auth);
      setUser(null);
      setIsAdmin(false);
      setHouseholdId(null);
      setHouseholdCreatedAt(null);
      setShowLoginExplicitly(true);
      setLoginLegalView(null);
      if (legalViewFromPathname(window.location.pathname)) {
        window.history.replaceState({}, '', '/signin');
      }
      logger.info('Auth', 'Sign out successful, cached user cleared');
    } catch (error) {
      logger.error('Auth', 'Sign out failed', {
        error: error.message,
        code: error.code
      });
    }
  };

  // Offline-first loading: show cached data immediately if available
  // Only block if: no cached data AND (still auth loading OR not logged in)
  const hasCachedData = localDataLoaded && (
    list.length > 0
    || Object.keys(aislesV2).length > 0
    || Object.keys(categoriesV2).length > 0
  );
  
  // Re-auth when we have local list data but no Firebase session. Use auth.currentUser
  // (not React `user`) so we don't flash "Session Expired" after OAuth redirect while
  // onAuthStateChanged / setUser haven't run yet.
  const needsReauth =
    hasCachedData && !auth.currentUser && !authLoading && navigator.onLine;

  // Show login screen if:
  // 1. Explicitly requested
  // 2. No cached data AND (finished auth loading OR not logged in)
  const showLogin = showLoginExplicitly || (!hasCachedData && !authLoading && !user);

  const onboardingActive =
    Boolean(user) &&
    !needsDisplayName &&
    Object.keys(aislesV2).length > 0 &&
    Object.keys(categoriesV2).length > 0 &&
    onboardingCompleted === false;

  androidNavRef.current = {
    showLogin,
    loginLegalView,
    closeLoginLegalView,
    showMenu,
    setShowMenu,
    currentPage,
    setCurrentPage,
    showAdmin,
    setShowAdmin,
    showDeleteAccount,
    setShowDeleteAccount,
    selectedItem,
    setSelectedItem,
    showDebugPanel,
    setShowDebugPanel,
    closeAppLegalPage,
    exitPinEditMode,
    pinEditMode,
    onboardingActive,
    needsReauth,
    setShowLoginExplicitly,
    paywallTrigger,
    setPaywallTrigger,
  };

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || authLoading) return;
    void SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {});
  }, [authLoading]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void (async () => {
      try {
        await StatusBar.setStyle({ style: Style.Light });
        if (Capacitor.getPlatform() === 'android') {
          await StatusBar.setOverlaysWebContent({ overlay: false });
          // setBackgroundColor is Android-only (no-op / throws on iOS). Match the white app
          // header so the status bar flows visually with it; Style.Light keeps icons dark.
          await StatusBar.setBackgroundColor({ color: '#FFFFFF' });
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn('Native', 'StatusBar setup failed', { error: err?.message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    const sub = CapacitorApp.addListener('backButton', () => {
      const r = androidNavRef.current;
      if (!r) return;

      // Highest-priority: modal surfaces that should close without further navigation.
      if (r.paywallTrigger) {
        r.setPaywallTrigger(null);
        return;
      }

      if (r.showLogin) {
        if (r.loginLegalView) {
          r.closeLoginLegalView();
          return;
        }
        void CapacitorApp.exitApp();
        return;
      }

      if (r.onboardingActive) {
        // Onboarding has no prior screen; back closes the app (matches default Android behavior).
        void CapacitorApp.exitApp();
        return;
      }

      if (r.showDebugPanel) {
        r.setShowDebugPanel(false);
        return;
      }
      if (r.showAdmin) {
        r.setShowAdmin(false);
        return;
      }
      if (r.showDeleteAccount) {
        r.setShowDeleteAccount(false);
        return;
      }
      if (r.selectedItem) {
        r.setSelectedItem(null);
        return;
      }
      if (r.pinEditMode) {
        r.exitPinEditMode();
        return;
      }
      if (r.needsReauth) {
        r.setShowLoginExplicitly(true);
        return;
      }
      if (r.showMenu) {
        r.setShowMenu(false);
        return;
      }
      if (r.currentPage === 'privacy' || r.currentPage === 'terms') {
        r.closeAppLegalPage();
        return;
      }
      if (r.currentPage !== 'list') {
        r.setCurrentPage('list');
        r.setShowMenu(false);
        return;
      }
      void CapacitorApp.exitApp();
    });

    return () => {
      void sub.remove();
    };
  }, []);

  useEffect(() => {
    // PWA banner: show once per device (web only, not in native Capacitor)
    // Disabled until apps are approved on App Store + Google Play.
    if (Capacitor.isNativePlatform()) return;
    return; // Banner gated: enable when native apps are live

    const BANNER_KEY = 'provisions.appStoreBannerSeen.v1';
    if (!localStorage.getItem(BANNER_KEY)) {
      setShowPWABanner(true);
      const timer = setTimeout(() => setShowPWABanner(false), 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (showLogin) {
    return (
      <AuthLoginScreen
        onLoginSuccess={handleLoginSuccess}
        legalView={loginLegalView}
        onOpenLegal={openLoginLegalView}
        onCloseLegal={closeLoginLegalView}
        initialMode={loginInitialMode}
        initialSignupType={loginInitialSignupType}
        initialInviteCode={loginInitialInviteCode}
      />
    );
  }

  // If we have cached data, show the app regardless of auth state (unless explicitly signing in)
  if (hasCachedData) {
    // Auth can happen in background, we already have data to show
  } else {
    // No cached data, need to check auth
    if (authLoading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
    if (!user) {
      return (
        <AuthLoginScreen
          onLoginSuccess={handleLoginSuccess}
          legalView={loginLegalView}
          onOpenLegal={openLoginLegalView}
          onCloseLegal={closeLoginLegalView}
          initialMode={loginInitialMode}
          initialSignupType={loginInitialSignupType}
          initialInviteCode={loginInitialInviteCode}
        />
      );
    }
    if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F7F7F7' }}><div className="text-gray-600 font-semibold">Loading...</div></div>;
  }

  // --- Taxonomy v2 handlers (wired to SuggestionsEditor) ---------------------
  const taxonomyBase = householdId ? `households/${householdId}/taxonomy` : null;
  async function taxoRenameAisle(aisleId, name) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const trimmed = (name ?? '').trim();
    const payload = stampRecord({ name: trimmed });
    setAislesV2(prev => ({
      ...prev,
      [aisleId]: stampRecord({ ...(prev[aisleId] || {}), name: trimmed }),
    }));
    await update(ref(database, `${taxonomyBase}/aisles/${aisleId}`), payload);
  }
  async function taxoAddAisle(name) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const newRef = push(ref(database, `${taxonomyBase}/aisles`));
    const order = Object.keys(aislesV2).length;
    const trimmed = (name ?? '').trim();
    const payload = stampRecord({ name: trimmed, order });
    setAislesV2(prev => ({
      ...prev,
      [newRef.key]: stampRecord({ name: trimmed, order }),
    }));
    await set(newRef, payload);
  }
  async function taxoDeleteAisle(aisleId) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const hasCategories = Object.values(categoriesV2).some((c) => c?.aisleId === aisleId);
    if (hasCategories) return;
    const nextAisles = { ...aislesV2 };
    delete nextAisles[aisleId];
    setAislesV2(nextAisles);
    await remove(ref(database, `${taxonomyBase}/aisles/${aisleId}`));
  }
  async function taxoReorderAisles(orderedIds) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const updates = {};
    orderedIds.forEach((id, i) => { updates[`${taxonomyBase}/aisles/${id}`] = stampRecord({ ...(aislesV2[id] || {}), order: i }); });
    setAislesV2(prev => {
      const next = { ...prev };
      orderedIds.forEach((id, i) => {
        if (next[id]) next[id] = stampRecord({ ...next[id], order: i });
      });
      return next;
    });
    await update(ref(database), updates);
  }
  async function taxoRenameCategory(catId, name) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const payload = stampRecord({ name });
    setCategoriesV2(prev => ({
      ...prev,
      [catId]: stampRecord({ ...(prev[catId] || {}), name }),
    }));
    await update(ref(database, `${taxonomyBase}/categories/${catId}`), payload);
  }
  async function taxoAddCategory(aisleId, name) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const newRef = push(ref(database, `${taxonomyBase}/categories`));
    const payload = stampRecord({ name, aisleId, hidden: false });
    setCategoriesV2(prev => ({
      ...prev,
      [newRef.key]: stampRecord({ name, aisleId, hidden: false }),
    }));
    await set(newRef, payload);
  }
  async function taxoMoveCategory(catId, aisleId) {
    if (!taxonomyBase) return;
    if (!assertWriteAllowed('gated_action')) return;
    const payload = stampRecord({ aisleId, hidden: false });
    setCategoriesV2(prev => ({
      ...prev,
      [catId]: stampRecord({ ...(prev[catId] || {}), aisleId, hidden: false }),
    }));
    await update(ref(database, `${taxonomyBase}/categories/${catId}`), payload);
  }
  async function taxoMergeCategory(fromCatId, intoCatId) {
    if (!taxonomyBase || !fromCatId || !intoCatId || fromCatId === intoCatId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const fromCat = categoriesV2[fromCatId];
    const toCat = categoriesV2[intoCatId];
    if (!fromCat || !toCat) return;
    if (fromCat.aisleId !== toCat.aisleId || !fromCat.aisleId) return;

    const toVis = [...(visibleItemsV2[intoCatId] || [])];
    const toLib = [...(libraryItemsV2[intoCatId] || [])];
    const fromVis = visibleItemsV2[fromCatId] || [];
    const fromLib = libraryItemsV2[fromCatId] || [];

    const usedIds = new Set([...toVis, ...toLib].map((i) => i.id));
    const nameSeen = new Set(
      [...toVis, ...toLib].map((i) => String(i.name ?? '').trim().toLowerCase()),
    );
    const allocId = (preferredId) => {
      if (preferredId && !usedIds.has(preferredId)) {
        usedIds.add(preferredId);
        return preferredId;
      }
      const nid = push(ref(database, `${taxonomyBase}/visible-items/${intoCatId}`)).key;
      usedIds.add(nid);
      return nid;
    };

    const nextVis = [...toVis];
    const nextLib = [...toLib];
    for (const item of fromVis) {
      const k = String(item.name ?? '').trim().toLowerCase();
      if (!k || nameSeen.has(k)) continue;
      nameSeen.add(k);
      nextVis.push(stampRecord({ id: allocId(item.id), name: item.name }));
    }
    for (const item of fromLib) {
      const k = String(item.name ?? '').trim().toLowerCase();
      if (!k || nameSeen.has(k)) continue;
      nameSeen.add(k);
      nextLib.push(stampRecord({ id: allocId(item.id), name: item.name }));
    }
    nextVis.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    nextLib.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const toName = toCat.name || '';

    setCategoriesV2((prev) => {
      const next = { ...prev };
      delete next[fromCatId];
      return next;
    });
    setVisibleItemsV2((prev) => {
      const next = { ...prev };
      next[intoCatId] = nextVis;
      delete next[fromCatId];
      return next;
    });
    setLibraryItemsV2((prev) => {
      const next = { ...prev };
      next[intoCatId] = nextLib;
      delete next[fromCatId];
      return next;
    });

    let movedItemIds = [];
    setList((prev) => {
      movedItemIds = prev.filter(li => getItemCategoryId(li) === fromCatId).map(li => li.id);
      const mapped = prev.map((li) =>
        getItemCategoryId(li) === fromCatId
          ? { ...li, categoryId: intoCatId, category: toName }
          : li,
      );
      saveShoppingListLocally(mapped);
      return mapped;
    });

    try {
      const merged = {
        [`${taxonomyBase}/categories/${fromCatId}`]: null,
        [`${taxonomyBase}/visible-items/${fromCatId}`]: null,
        [`${taxonomyBase}/library/${fromCatId}`]: null,
        [`${taxonomyBase}/visible-items/${intoCatId}`]: nextVis.length > 0 ? nextVis : null,
        [`${taxonomyBase}/library/${intoCatId}`]: nextLib.length > 0 ? nextLib : null,
      };
      const stamp = Date.now();
      const listBase = `households/${householdId}/shopping-list`;
      for (const id of movedItemIds) {
        merged[`${listBase}/${id}/categoryId`] = intoCatId;
        merged[`${listBase}/${id}/category`] = toName;
        merged[`${listBase}/${id}/updatedAt`] = stamp;
        merged[`${listBase}/${id}/updatedBy`] = currentEditor;
      }
      await update(ref(database), merged);
    } catch (err) {
      logger.error('App', 'taxoMergeCategory failed', { error: err.message });
    }
  }
  async function taxoRemoveLibraryItem(catId, itemId) {
    if (!taxonomyBase || !catId || !itemId) return;
    if (!assertWriteAllowed('gated_action')) return;
    const lib = libraryItemsV2[catId] || [];
    if (!lib.some(i => i.id === itemId)) return;
    const nextLib = lib.filter(i => i.id !== itemId);
    setLibraryItemsV2(prev => ({ ...prev, [catId]: nextLib }));
    await update(ref(database), {
      [`${taxonomyBase}/library/${catId}`]: nextLib.length > 0 ? nextLib : null,
    });
  }

  const completeOnboarding = async () => {
    if (!householdId) return;
    // Do not gate this behind premium: native users without entitlement would hit
    // assertWriteAllowed → paywall_viewed analytics while PaywallSheet is not mounted
    // (onboarding uses an early return), so Done would appear to do nothing.
    const startedAt = onboardingEnteredAtRef.current;
    try {
      await set(ref(database, `households/${householdId}/taxonomy/onboarding_completed`), true);
      const durationSeconds =
        startedAt != null ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
      trackEvent('onboarding_completed', { duration_seconds: durationSeconds });
      onboardingEnteredAtRef.current = null;
    } catch (err) {
      logger.error('Firebase', 'Failed to mark onboarding complete', { error: err.message });
    }
  };

  if (onboardingActive) {
    return (
      <>
        <Onboarding
          displayName={members?.[user.uid]?.displayName}
          aisles={aislesV2}
          categories={categoriesV2}
          visibleItems={visibleItemsV2}
          libraryItems={libraryItemsV2}
          onRenameAisle={taxoRenameAisle}
          onAddAisle={taxoAddAisle}
          onDeleteAisle={taxoDeleteAisle}
          onReorderAisles={taxoReorderAisles}
          onRenameCategory={taxoRenameCategory}
          onAddCategory={taxoAddCategory}
          onMoveCategory={taxoMoveCategory}
          onMergeCategory={taxoMergeCategory}
          onComplete={completeOnboarding}
        />
        {paywallTrigger && (
          <PaywallSheet
            trigger={paywallTrigger}
            status={subscriptionStatus}
            onClose={() => setPaywallTrigger(null)}
            onSubscriptionChanged={handleSubscriptionChanged}
            onOpenLegal={(view) => {
              const path = view === 'privacy' ? LEGAL_PATH_PRIVACY : LEGAL_PATH_TERMS;
              window.history.pushState({}, '', path);
              setPaywallTrigger(null);
              setCurrentPage(view);
            }}
          />
        )}
      </>
    );
  }

  // Account page derived values
  const accountDisplayName = members?.[user?.uid]?.displayName || user?.displayName || '';
  const accountSub = subscriptionStatus;
  const accountManageUrl = Capacitor.getPlatform() === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
  const currentPlatformStore = Capacitor.getPlatform() === 'ios' ? 'APP_STORE' : 'PLAY_STORE';
  const subStore = accountSub?.store ?? null;
  const subOnOtherPlatform = accountSub?.active && !accountSub?.inTrial
    && subStore && subStore !== 'PROMOTIONAL' && subStore !== currentPlatformStore;
  const subStoreName = subStore === 'APP_STORE' ? 'App Store'
    : subStore === 'PLAY_STORE' ? 'Google Play'
    : null;
  const fmtDate = (ms) => ms
    ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

        * {
          font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }

        .scroll-fade-full {
          transition: none;
        }
        .scroll-fade-full.is-scrolling {
          opacity: 0;
          transition: opacity 0.1s ease-out;
        }

        .scroll-fade-border {
          transition: none;
        }
        .scroll-fade-border.is-scrolling {
          border-color: transparent;
          transition: border-color 0.1s ease-out;
        }

        .scroll-fade-partial {
          transition: none;
        }
        .scroll-fade-partial.is-scrolling {
          opacity: 0.5;
          filter: grayscale(100%);
          transition: opacity 0.1s ease-out, filter 0.1s ease-out;
        }

        .scroll-fade-bg {
          transition: none;
        }
        .scroll-fade-bg.is-scrolling {
          transition: background-color 0.1s ease-out;
        }
      `}</style>
      <div className={`min-h-screen scroll-fade-bg ${isScrolling ? 'is-scrolling' : ''}`} style={{ backgroundColor: isScrolling ? '#FFFFFF' : '#F7F7F7' }}>
        {/* PWA promotion banner — web only, dismissed after 8s or tap. */}
        {showPWABanner && (
          <div className="fixed top-0 left-0 right-0 bg-amber-50 border-b border-amber-200 z-[51] pt-safe">
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-amber-900 flex-1">
                Provisions is now on the <a href="https://apps.apple.com/app/provisions/id123" className="font-bold underline hover:no-underline">App Store</a> and <a href="https://play.google.com/store/apps/details?id=com.provisionsapp.shoppinglist" className="font-bold underline hover:no-underline">Google Play</a>.
              </p>
              <button
                onClick={() => {
                  setShowPWABanner(false);
                  localStorage.setItem('provisions.appStoreBannerSeen.v1', '1');
                }}
                className="shrink-0 p-1 hover:bg-amber-100 rounded transition-colors"
                aria-label="Close"
              >
                <X size={18} className="text-amber-900" />
              </button>
            </div>
          </div>
        )}

        {/* WP-A: Dismissable notice for authenticated user with invite link */}
        {showInviteAlreadyAuthenticatedNotice && (
          <div className="fixed top-0 left-0 right-0 bg-blue-50 border-b border-blue-200 z-[51] pt-safe" style={{ marginTop: showPWABanner ? '48px' : '0' }}>
            <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-blue-900 flex-1">
                You're already in a household — this invite link won't work while signed in.
              </p>
              <button
                onClick={() => setShowInviteAlreadyAuthenticatedNotice(false)}
                className="shrink-0 p-1 hover:bg-blue-100 rounded transition-colors"
                aria-label="Close"
              >
                <X size={18} className="text-blue-900" />
              </button>
            </div>
          </div>
        )}

        {/* Header — hamburger + wordmark only; sync pill top-right. Scrolls off-screen on scroll-down (all breakpoints). */}
        <div
          className={`fixed top-0 left-0 right-0 bg-white shadow-sm z-50 transition-transform duration-300 pt-safe ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}
        >
          <div className="max-w-2xl lg:max-w-6xl mx-auto px-4 py-3">
            <div className="flex items-center gap-2 lg:gap-3">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Menu"
              >
                <Menu size={22} className="text-gray-700" />
              </button>

              <button
                onClick={() => { setCurrentPage('list'); setShowMenu(false); }}
                className="flex-1 lg:flex-none flex flex-col items-center lg:items-start min-w-0"
              >
                <span
                  className={`font-bold text-xl ${currentPage !== 'list' ? 'hidden' : ''}`}
                  style={{ color: '#FF7A7A' }}
                >
                  Provisions
                </span>
                {currentPage !== 'list' && (
                  <span className="flex flex-col items-center lg:items-start">
                    <span className="text-[9px] font-bold tracking-[0.18em] uppercase leading-none mb-0.5" style={{ color: '#FF7A7A' }}>
                      Provisions
                    </span>
                    <span className="text-base font-bold leading-tight text-gray-800">
                      {currentPage === 'history'
                        ? 'Purchase History'
                        : currentPage === 'insights'
                          ? 'Household Insights'
                          : currentPage === 'settings'
                            ? 'Settings'
                            : 'Account'}
                    </span>
                  </span>
                )}
              </button>

              {/* Balances the hamburger on the left so the wordmark is truly centered on mobile */}
              <div className="lg:hidden shrink-0 w-[30px]" aria-hidden />

            </div>
          </div>
          {(!isOnline || !isConnected || pendingOps > 0) && (
            <div
              className={`fixed right-3 z-50 flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5 rounded-full pointer-events-none transition-colors ${
                !isOnline || !isConnected ? 'bg-red-100' : 'bg-blue-100'
              }`}
              style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
              aria-label={!isOnline || !isConnected ? 'Offline' : 'Syncing'}
            >
              {!isOnline || !isConnected ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs font-medium text-red-600">Offline</span>
                </>
              ) : (
                <>
                  <Loader2 size={14} className="text-blue-600 animate-spin" />
                  <span className="text-xs font-medium text-blue-600">Syncing</span>
                </>
              )}
            </div>
          )}
          {showMenu && (
            <div className="absolute top-full left-0 right-0 bg-white shadow-lg border-t border-gray-200">
              <div className="max-w-2xl lg:max-w-6xl mx-auto">
                <button onClick={() => { setCurrentPage('list'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'list' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'list' ? '#FF7A7A' : '#374151' }}><ClipboardList size={20} />List</button>
                <button onClick={() => { setCurrentPage('history'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'history' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'history' ? '#FF7A7A' : '#374151' }}><History size={20} />Purchase History</button>
                <button onClick={() => { setCurrentPage('insights'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'insights' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'insights' ? '#FF7A7A' : '#374151' }}><BarChart3 size={20} />Household Insights</button>
                <button onClick={() => { setCurrentPage('settings'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 border-b border-gray-100 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'settings' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'settings' ? '#FF7A7A' : '#374151' }}><Settings size={20} />Settings</button>
                <button onClick={() => { setCurrentPage('account'); setShowMenu(false); }} className={`w-full text-left px-6 py-4 font-semibold transition-colors hover:bg-gray-50 flex items-center gap-2 ${currentPage === 'account' ? 'bg-red-50' : ''}`} style={{ color: currentPage === 'account' ? '#FF7A7A' : '#374151' }}><UserCircle size={20} />Account</button>
              </div>
            </div>
          )}
        </div>

        {/* Desktop list: Shop/Plan + Clear — fixed below header (not inside it); slides up when header hides, like mobile bottom bar. Always visible on desktop even when keyboard/autocomplete is active. */}
        {currentPage === 'list' && (
          <div
            className="hidden lg:block fixed left-0 right-0 z-40 px-3 pt-3 pointer-events-none transition-[top] duration-300 ease-out"
            style={{
              top: showHeader
                ? 'calc(env(safe-area-inset-top, 0px) + 4.25rem)'
                : 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
            }}
          >
            <div className="max-w-2xl lg:max-w-6xl mx-auto">
              <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-lg p-1.5 flex gap-1 pointer-events-auto items-center">
                {pinEditMode ? (
                  <>
                    <div className="flex-1 text-center font-bold text-sm text-gray-800 py-3">Edit pins</div>
                    <button
                      type="button"
                      onClick={exitPinEditMode}
                      className="shrink-0 px-5 py-3 rounded-xl font-bold text-sm text-white"
                      style={{ backgroundColor: '#FF7A7A' }}
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setQuickAddMode(false)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${!quickAddMode ? 'text-white' : 'text-gray-600'}`}
                      style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                      aria-pressed={!quickAddMode}
                    >
                      <ShoppingCart size={18} strokeWidth={2.5} />
                      Shop
                    </button>
                    <button
                      onClick={enterAddMode}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${quickAddMode ? 'text-white' : 'text-gray-600'}`}
                      style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                      aria-pressed={quickAddMode}
                    >
                      <ClipboardPen size={18} strokeWidth={2.5} />
                      Plan
                    </button>
                  </>
                )}
              </div>
              {doneCount > 0 && (
                <div className="flex justify-center mt-2 pointer-events-auto relative">
                  {showClearChipTooltip && (
                    <div
                      className="animate-tooltip-in absolute left-1/2 -top-12 -translate-x-1/2 bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg whitespace-nowrap"
                      aria-hidden="true"
                    >
                      All done with these? Tap to clear.
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                    </div>
                  )}
                  <button
                    key={`clear-chip-desktop-${hasDone}`}
                    onClick={clearDone}
                    className="animate-chip-in flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg active:scale-95 transition-transform"
                    style={{ backgroundColor: '#FF7A7A' }}
                    aria-label={`Clear ${doneCount} done item${doneCount === 1 ? '' : 's'}`}
                  >
                    <Check size={14} strokeWidth={2.5} />
                    Clear {doneCount} done
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {(!isOnline || !isConnected) && (
          <div className="bg-red-600 text-white px-4 py-2 text-sm font-medium flex items-center justify-center gap-2">
            <AlertTriangle size={16} className="shrink-0 text-white" aria-hidden />
            <span>
              You&apos;re offline. {lastSyncTime ? `Last synced ${formatRelativeTime(lastSyncTime)}.` : ''} Changes will sync when connection is restored.
            </span>
          </div>
        )}

        <div
          className={`lg:pb-6 ${currentPage === 'list' ? 'pb-32' : 'pb-6'} ${
            currentPage === 'list'
              ? 'pt-[calc(5rem+env(safe-area-inset-top,0px))] lg:pt-[calc(10.5rem+env(safe-area-inset-top,0px))]'
              : 'pt-[calc(5rem+env(safe-area-inset-top,0px))]'
          }`}
        >
          {currentPage === 'privacy' ? (
            <PrivacyPolicyPage onBack={closeAppLegalPage} />
          ) : currentPage === 'terms' ? (
            <TermsOfServicePage onBack={closeAppLegalPage} />
          ) : currentPage === 'account' ? (
            <div className="max-w-2xl mx-auto px-4 flex min-h-[calc(100dvh-5.5rem)] flex-col">
              <div className="space-y-3 shrink-0">

                {/* Account info */}
                <div className="bg-white rounded-2xl border border-gray-200 px-6 py-4 space-y-2">
                  <div>
                    <p className="font-semibold text-gray-800">{user?.email}</p>
                    {accountDisplayName && <p className="text-sm text-gray-500">{accountDisplayName}</p>}
                  </div>
                  {householdId && (
                    <div className="border-t border-gray-100 pt-2 space-y-1">
                      <span className="text-xs text-gray-400 uppercase tracking-wide">Household</span>
                      <button
                        className="flex items-center gap-1.5 text-xs font-mono text-gray-500 hover:text-gray-700 transition-colors"
                        onClick={() => navigator.clipboard?.writeText(householdId)}
                        title="Tap to copy household ID"
                      >
                        {householdId}
                        <Copy size={11} className="shrink-0 text-gray-400" />
                      </button>
                      {householdCreatedAt && (
                        <p className="text-xs text-gray-400">Created {fmtDate(householdCreatedAt)}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Subscription status (native only) */}
                {Capacitor.isNativePlatform() && (
                  <div className="bg-white rounded-2xl border border-gray-200 px-6 py-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {accountSub?.inTrial ? (
                          <>
                            <p className="font-semibold text-gray-800">Free trial</p>
                            <p className="text-sm text-gray-500">Ends {fmtDate(accountSub.expiresAt)}</p>
                          </>
                        ) : accountSub?.active ? (
                          <>
                            <p className="font-semibold text-gray-800">Provisions Pro</p>
                            <p className="text-sm text-gray-500">{accountSub.expiresAt ? `Renews ${fmtDate(accountSub.expiresAt)}` : 'Active'}</p>
                          </>
                        ) : accountSub?.loaded ? (
                          <>
                            <p className="font-semibold text-gray-800">No active subscription</p>
                            <p className="text-sm text-gray-500">Your free trial has ended</p>
                          </>
                        ) : (
                          <p className="text-sm text-gray-400">Loading…</p>
                        )}
                      </div>
                      {accountSub?.active && !accountSub?.inTrial && (
                        subOnOtherPlatform ? (
                          <span className="text-xs text-gray-400 shrink-0 mt-0.5 text-right">
                            via {subStoreName || 'other platform'}
                          </span>
                        ) : (
                          <button
                            onClick={() => window.open(accountManageUrl, '_system')}
                            className="text-sm font-semibold shrink-0 mt-0.5"
                            style={{ color: '#FF7A7A' }}
                          >
                            Manage
                          </button>
                        )
                      )}
                    </div>
                    {accountSub?.loaded && (accountSub?.inTrial || !accountSub?.active) && (
                      <div className="border-t border-gray-100 pt-3 space-y-2">
                        <button
                          onClick={() => openPaywall('account_subscribe')}
                          className="w-full py-2.5 rounded-xl font-semibold text-sm text-white transition-colors"
                          style={{ backgroundColor: '#FF7A7A' }}
                        >
                          Subscribe — $3.99/year
                        </button>
                        <button
                          onClick={() => openPaywall('account_restore')}
                          className="w-full py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Restore purchases
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button onClick={() => setShowAdmin(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                  <Users size={20} />Invite Household Members
                </button>
                <button onClick={handleSignOut} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-500 hover:bg-red-50 transition-colors">
                  <LogOut size={20} />Sign Out
                </button>
              </div>
              <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-gray-500 pt-6 shrink-0">
                <button
                  type="button"
                  onClick={() => { openAppLegalPage('privacy'); setShowMenu(false); }}
                  className="font-semibold underline decoration-gray-300 hover:decoration-gray-600"
                >
                  Privacy Policy
                </button>
                <span className="text-gray-300 select-none" aria-hidden="true">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => { openAppLegalPage('terms'); setShowMenu(false); }}
                  className="font-semibold underline decoration-gray-300 hover:decoration-gray-600"
                >
                  Terms of Service
                </button>
              </div>
              <div className="mt-auto shrink-0 border-t border-gray-200 pt-10 pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.25rem))]">
                <button onClick={() => setShowDeleteAccount(true)} className="w-full bg-white rounded-2xl border border-gray-200 px-6 py-4 flex items-center gap-3 font-semibold text-red-400 hover:bg-red-50 transition-colors text-sm">
                  <Trash2 size={18} />Delete Account
                </button>
              </div>
            </div>

          ) : currentPage === 'list' ? (
            <div className="max-w-2xl mx-auto px-4">
              {/* Shop/Plan: mobile = bottom fixed bar; desktop = top fixed bar (see block after header). */}
              {!quickAddMode && list.length === 0 ? (
                <div className="mt-12 mx-auto max-w-sm rounded-2xl border border-gray-200 bg-white p-8 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-4 bg-gray-50">
                    <ShoppingCart size={24} className="text-gray-400" />
                  </div>
                  <p className="text-gray-700 font-semibold mb-1">Your list is empty</p>
                  <p className="text-sm text-gray-500 mb-5">Tap Plan to start building your list.</p>
                  <button
                    type="button"
                    onClick={enterAddMode}
                    className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
                    style={{ backgroundColor: '#FF7A7A' }}
                  >
                    Plan your list
                  </button>
                </div>
              ) : (
              <div className="space-y-3">
                {aislesForListUi.map(g => {
                  const search = categorySearches[g.aisleId] || '';
                  const quickAddDropdown = getAisleDropdownItems(g.aisleId);
                  const isExpanded = expandedCategories[g.aisleId];

                  return (
                    <div
                      key={g.aisleId}
                      id={`pin-edit-aisle-${g.aisleId}`}
                      className={`space-y-2 bg-white border border-gray-200 rounded-2xl scroll-fade-border ${isScrolling ? 'is-scrolling' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCategory(g.aisleId)}
                        className={`w-full px-4 flex items-center transition-colors ${
                          quickAddMode ? 'py-4 gap-3' : 'py-2.5 gap-2.5'
                        } ${isExpanded ? 'rounded-t-2xl' : 'rounded-2xl'} hover:bg-gray-50`}
                        style={{ opacity: isScrolling && !quickAddMode ? 0.12 : 1, transition: 'opacity 0.1s ease-out' }}
                      >
                        {isExpanded ? (
                          <ChevronDown size={quickAddMode ? 20 : 14} className={quickAddMode ? 'text-gray-400' : 'text-gray-300'} />
                        ) : (
                          <ChevronRight size={quickAddMode ? 20 : 14} className={quickAddMode ? 'text-gray-400' : 'text-gray-300'} />
                        )}
                        <h3 className={`flex-1 text-left uppercase text-sm ${quickAddMode ? 'tracking-wide font-bold text-gray-700' : 'tracking-widest font-medium text-gray-400'}`}>{g.aisleNameDisplay}</h3>
                      </button>

                      {isExpanded && (
                        <>
                          {quickAddMode && !pinEditMode && (() => {
                            const pinCount = Array.from(g.categoryIdSet || []).reduce(
                              (n, cid) => n + (visibleItemsV2[cid] || []).length,
                              0,
                            );
                            const densityDismiss = suggestionDismissals[`density::${g.aisleId}`];
                            const showDensityNudge = pinCount > 12
                              && (!densityDismiss || densityDismiss.action !== 'density-dismissed'
                                || pinCount >= (Number(densityDismiss.dismissCount) + 4));
                            if (!showDensityNudge) return null;
                            return (
                              <div className="mx-4 mb-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2.5">
                                <p className="text-xs text-gray-700">
                                  Lots of pinned items here — trim for faster scanning?
                                </p>
                                <div className="mt-2 flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    className="text-xs font-bold"
                                    style={{ color: '#FF7A7A' }}
                                    onClick={() => enterPinEditMode(g.aisleId, null)}
                                  >
                                    Trim
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-gray-600"
                                    onClick={() => void recordDensityDismissal(g.aisleId, pinCount)}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          {quickAddMode && !pinEditMode && (
                            <div className={`relative z-20 px-4 pb-3 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}>
                              <div className="relative">
                                <Search className="absolute left-3 top-3 text-gray-400" size={18} />
                                <input
                                  ref={(el) => { aisleAddSearchInputRefs.current[g.aisleId] = el; }}
                                  type="text"
                                  value={search}
                                  onChange={(e) => {
                                    setCategorySearches(prev => ({ ...prev, [g.aisleId]: e.target.value }));
                                    setAisleHighlightedIndex(prev => ({ ...prev, [g.aisleId]: -1 }));
                                  }}
                                  onKeyDown={(e) => {
                                    const items = quickAddDropdown;
                                    const cur = aisleHighlightedIndex[g.aisleId] ?? -1;
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setAisleHighlightedIndex(prev => ({ ...prev, [g.aisleId]: items.length === 0 ? -1 : (cur + 1) % items.length }));
                                    } else if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setAisleHighlightedIndex(prev => ({ ...prev, [g.aisleId]: items.length === 0 ? -1 : cur <= 0 ? items.length - 1 : cur - 1 }));
                                    } else if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const idx = cur >= 0 ? cur : 0;
                                      if (items[idx]) addFromAisleSearch(g.aisleId, items[idx]);
                                    } else if (e.key === 'Escape') {
                                      setCategorySearches(prev => ({ ...prev, [g.aisleId]: '' }));
                                      setAisleHighlightedIndex(prev => ({ ...prev, [g.aisleId]: -1 }));
                                    }
                                  }}
                                  placeholder={`Add to ${g.aisleNameDisplay}...`}
                                  className="w-full pl-10 pr-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm bg-white focus:border-gray-300 focus:outline-none transition-colors"
                                />
                                {search.trim() && (
                                  <div
                                    className={`absolute left-0 right-0 w-full bg-white border-2 border-gray-200 rounded-xl shadow-lg z-30 max-h-60 overflow-y-auto ${
                                      aisleAutocompleteFlipUp[g.aisleId] ? 'bottom-full mb-2' : 'top-full mt-2'
                                    }`}
                                  >
                                    {quickAddDropdown.map((s, i) => {
                                      const highlighted = (aisleHighlightedIndex[g.aisleId] ?? -1) === i;
                                      const showLibraryRemove = Boolean(
                                        s.catId && s.suggestionId && s.fromVisible === false
                                      );
                                      const rowKey = s.suggestionId && s.catId
                                        ? `${s.catId}-${s.suggestionId}`
                                        : `${i}-${s.name}`;
                                      return (
                                        <div
                                          key={rowKey}
                                          className="flex items-stretch w-full border-b last:border-b-0"
                                        >
                                          <button
                                            type="button"
                                            onClick={() => addFromAisleSearch(g.aisleId, s)}
                                            className={`flex-1 min-w-0 text-left px-4 py-3 text-sm font-medium ${highlighted ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                          >
                                            {s.name}
                                          </button>
                                          {showLibraryRemove ? (
                                            <button
                                              type="button"
                                              className={`flex-shrink-0 px-3 py-3 text-gray-400 hover:text-gray-700 ${highlighted ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void taxoRemoveLibraryItem(s.catId, s.suggestionId);
                                              }}
                                              aria-label={`Remove ${s.name} from library`}
                                            >
                                              <X size={18} />
                                            </button>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="overflow-hidden rounded-b-2xl">
                          {g.items.length > 0 ? (
                            <div className="pb-3">
                              {g.items.map((item, idx) => {
                                if (pinEditMode && quickAddMode) {
                                  if (item.type === 'list') {
                                    const li = item.data;
                                    const match = findShortcutForListItem(li);
                                    const isPinned = Boolean(match);
                                    const hlKey = match ? `${match.categoryId}::${match.suggestionId}` : null;
                                    const showDormantRing = Boolean(hlKey && pinEditDormantHighlightSet?.has(hlKey));
                                    return (
                                      <div
                                        key={li.id}
                                        className={`flex items-center gap-3 py-3 px-4 border-t border-gray-100 scroll-fade-border ${isScrolling ? 'is-scrolling' : ''} ${li.done ? 'opacity-60' : ''}`}
                                      >
                                        <button
                                          type="button"
                                          onClick={() => void handlePinEditToggle(item)}
                                          className={`flex-shrink-0 p-2 -m-1 rounded-full transition-colors hover:bg-gray-100 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${showDormantRing ? 'ring-2 ring-amber-300 ring-offset-1' : ''}`}
                                          aria-label={isPinned ? `Unpin ${li.name}` : `Pin ${li.name}`}
                                        >
                                          <Pin
                                            size={20}
                                            strokeWidth={2}
                                            className={isPinned ? 'text-[#FF7A7A]' : 'text-gray-400'}
                                            fill={isPinned ? 'currentColor' : 'none'}
                                          />
                                        </button>
                                        <span className={`flex-1 text-left font-semibold text-sm ${li.done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                                          {li.name}
                                        </span>
                                      </div>
                                    );
                                  }
                                  const qi = item.data;
                                  const hlKey = `${qi.catId}::${qi.id}`;
                                  const showDormantRing = Boolean(pinEditDormantHighlightSet?.has(hlKey));
                                  return (
                                    <div
                                      key={`qa-${idx}`}
                                      className={`w-full flex items-center gap-3 py-3 px-4 transition-colors border-t border-gray-100 scroll-fade-border hover:bg-gray-50 ${isScrolling ? 'is-scrolling' : ''}`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => void handlePinEditToggle(item)}
                                        className={`flex-shrink-0 p-2 -m-1 rounded-full transition-colors hover:bg-gray-100 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''} ${showDormantRing ? 'ring-2 ring-amber-300 ring-offset-1' : ''}`}
                                        aria-label={`Unpin ${qi.name}`}
                                      >
                                        <Pin
                                          size={20}
                                          strokeWidth={2}
                                          className="text-[#FF7A7A]"
                                          fill="currentColor"
                                        />
                                      </button>
                                      <span className="flex-1 text-left font-semibold text-sm" style={{ color: '#FF7A7A' }}>
                                        {qi.name}
                                      </span>
                                    </div>
                                  );
                                }
                                if (item.type === 'list') {
                                  const li = item.data;
                                  // Row tap opens the same sheet as the caret; check/remove stay on the left control only.
                                  const handleRowOpenDetails = () => { void openItemSheet(li); };
                                  return (
                                    <div
                                      key={li.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={handleRowOpenDetails}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowOpenDetails(); } }}
                                      className={`flex items-center gap-3 py-3 px-4 border-t border-gray-100 scroll-fade-border cursor-pointer ${isScrolling ? 'is-scrolling' : ''} ${li.done ? 'opacity-60' : ''}`}
                                    >
                                      {quickAddMode ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); removeItem(li.id); }}
                                          className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                          aria-label={`Remove ${li.name} from list`}
                                        >
                                          <span className="block w-6 h-6 rounded-md border-2 border-gray-200 bg-white flex items-center justify-center text-gray-400">
                                            <X size={16} strokeWidth={2.5} />
                                          </span>
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); toggleDone(li.id); }}
                                          className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                          aria-label={li.done ? `Mark ${li.name} as not done` : `Mark ${li.name} as done`}
                                        >
                                          <span
                                            className={`block w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${li.done ? 'border-transparent' : 'border-gray-300 bg-white'}`}
                                            style={{ backgroundColor: li.done ? '#FF7A7A' : undefined }}
                                          >
                                            {li.done && <Check size={16} className="text-white" strokeWidth={3} />}
                                          </span>
                                        </button>
                                      )}
                                      <span
                                        className={`flex-1 text-left font-semibold text-sm ${li.done ? 'line-through text-gray-400' : ''}`}
                                        style={{ color: li.done ? undefined : '#FF7A7A' }}
                                      >
                                        {li.name}
                                        {li.quantity && li.quantity.trim() && (
                                          <span className="ml-1 text-gray-400 font-medium">
                                            {li.quantity}
                                          </span>
                                        )}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); openItemSheet(li); }}
                                        className={`p-2.5 -m-2.5 rounded-full transition-colors text-gray-300 hover:text-gray-500 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                        aria-label={`Open details for ${li.name}`}
                                      >
                                        <ChevronRight size={18} strokeWidth={2} />
                                      </button>
                                    </div>
                                  );
                                }
                                const qi = item.data;
                                const handleTileAdd = () => addItem(qi.name, qi.catName || g.aisleName, 'quickAdd', qi.id, qi.catId);
                                const handleTileOpenDetails = () => { void openSuggestionSheet(qi.catName || g.aisleName, qi); };
                                return (
                                  <div
                                    key={`qa-${idx}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleTileOpenDetails}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleTileOpenDetails(); } }}
                                    className={`w-full flex items-center gap-3 py-3 px-4 transition-colors border-t border-gray-100 scroll-fade-border cursor-pointer hover:bg-gray-50 ${isScrolling ? 'is-scrolling' : ''}`}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleTileAdd(); }}
                                      className={`flex-shrink-0 p-2.5 -m-2.5 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                      aria-label={`Add ${qi.name} to list`}
                                    >
                                      <span className="block w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: '#FF7A7A' }}>
                                        <Plus size={16} className="text-white" strokeWidth={2.5} />
                                      </span>
                                    </button>
                                    <span className="flex-1 text-left font-semibold text-sm text-gray-800">
                                      {qi.name}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); openSuggestionSheet(qi.catName || g.aisleName, qi); }}
                                      className={`p-2.5 -m-2.5 rounded-full transition-colors text-gray-300 hover:text-gray-500 scroll-fade-full ${isScrolling ? 'is-scrolling' : ''}`}
                                      aria-label={`Open details for ${qi.name}`}
                                    >
                                      <ChevronRight size={18} strokeWidth={2} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="px-4 pb-4"><div className="text-center py-6 text-gray-400 text-sm italic">No items</div></div>
                          )}
                          {/* B1: Dormant pins hint */}
                          {quickAddMode && !pinEditMode && (() => {
                            const catIds = g.categoryIdSet || new Set();
                            const aisleDormant = dormantShortcutsCache.filter(d => catIds.has(d.categoryId));
                            if (aisleDormant.length === 0) return null;
                            const n = aisleDormant.length;
                            const dormantKeySet = new Set(
                              aisleDormant.map(d => `${d.categoryId}::${d.suggestionId}`),
                            );
                            return (
                              <div className="mx-4 mb-3 rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
                                <p className="text-xs text-gray-600">
                                  <span className="font-semibold text-gray-700">{n} pin{n === 1 ? '' : 's'}</span>
                                  {' '}you haven&apos;t used in 6+ weeks — review?
                                </p>
                                <div className="mt-2 flex flex-wrap gap-3">
                                  <button
                                    type="button"
                                    className="text-xs font-bold"
                                    style={{ color: '#FF7A7A' }}
                                    onClick={() => enterPinEditMode(g.aisleId, dormantKeySet)}
                                  >
                                    Review
                                  </button>
                                  <button
                                    type="button"
                                    className="text-xs font-bold text-gray-600"
                                    onClick={() => {
                                      const skip = new Set(
                                        aisleDormant.map(d => `${d.categoryId}::${d.suggestionId}`),
                                      );
                                      aisleDormant.forEach((d) => {
                                        const key = `${d.categoryId}::${(d.name || '').toLowerCase()}::demote`;
                                        dismissSuggestion(key, 'not-now');
                                      });
                                      setDormantShortcutsCache(prev =>
                                        prev.filter(d => !skip.has(`${d.categoryId}::${d.suggestionId}`)),
                                      );
                                    }}
                                  >
                                    Not now
                                  </button>
                                </div>
                              </div>
                            );
                          })()}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          ) : currentPage === 'history' ? (
            <PurchaseHistory
              householdId={householdId}
              liveBucketMonthKey={itemEventsListenerMonth}
              liveBucketVal={liveItemEventsMonthVal}
              aisles={aislesV2}
              categories={categoriesV2}
            />
          ) : currentPage === 'insights' ? (
            householdId ? (
              <HouseholdInsightsPage
                householdId={householdId}
                liveBucketMonthKey={itemEventsListenerMonth}
                liveBucketVal={liveItemEventsMonthVal}
                members={members}
              />
            ) : (
              <div className="max-w-2xl mx-auto px-4 text-center py-12 text-gray-500 text-sm">
                Household insights are unavailable until your household is loaded.
              </div>
            )
          ) : currentPage === 'settings' ? (
            <SuggestionsEditor
              aisles={aislesV2}
              categories={categoriesV2}
              visibleItems={visibleItemsV2}
              libraryItems={libraryItemsV2}
              onRenameAisle={taxoRenameAisle}
              onAddAisle={taxoAddAisle}
              onDeleteAisle={taxoDeleteAisle}
              onReorderAisles={taxoReorderAisles}
              onRenameCategory={taxoRenameCategory}
              onAddCategory={taxoAddCategory}
              onMoveCategory={taxoMoveCategory}
              onMergeCategory={taxoMergeCategory}
              accordionAisles
            />
          ) : null}
        </div>

        {/* Mobile bottom nav — Shop/Plan + Clear (desktop uses the fixed top dock after the header). */}
        {currentPage === 'list' && !keyboardInputFocused && (
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 pt-3 pb-safe pointer-events-none">
            {doneCount > 0 && (
              <div className="flex justify-center mb-2 pointer-events-auto relative">
                {showClearChipTooltip && (
                  <div
                    className="animate-tooltip-in absolute left-1/2 -top-12 -translate-x-1/2 bg-gray-900 text-white text-xs font-medium px-3 py-2 rounded-lg shadow-lg whitespace-nowrap"
                    aria-hidden="true"
                  >
                    All done with these? Tap to clear.
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
                  </div>
                )}
                <button
                  key={`clear-chip-${hasDone}`}
                  onClick={clearDone}
                  className="animate-chip-in flex items-center gap-1.5 px-4 py-2 rounded-full text-white text-xs font-bold shadow-lg active:scale-95 transition-transform"
                  style={{ backgroundColor: '#FF7A7A' }}
                  aria-label={`Clear ${doneCount} done item${doneCount === 1 ? '' : 's'}`}
                >
                  <Check size={14} strokeWidth={2.5} />
                  Clear {doneCount} done
                </button>
              </div>
            )}
            <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-lg p-1.5 flex gap-1 pointer-events-auto items-center">
              {pinEditMode ? (
                <>
                  <div className="flex-1 text-center font-bold text-sm text-gray-800 py-3">Edit pins</div>
                  <button
                    type="button"
                    onClick={exitPinEditMode}
                    className="shrink-0 px-5 py-3 rounded-xl font-bold text-sm text-white"
                    style={{ backgroundColor: '#FF7A7A' }}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setQuickAddMode(false)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${!quickAddMode ? 'text-white' : 'text-gray-600'}`}
                    style={{ backgroundColor: !quickAddMode ? '#FF7A7A' : 'transparent' }}
                    aria-pressed={!quickAddMode}
                  >
                    <ShoppingCart size={18} strokeWidth={2.5} />
                    Shop
                  </button>
                  <button
                    onClick={enterAddMode}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-3 rounded-xl font-bold text-sm transition-all ${quickAddMode ? 'text-white' : 'text-gray-600'}`}
                    style={{ backgroundColor: quickAddMode ? '#FF7A7A' : 'transparent' }}
                    aria-pressed={quickAddMode}
                  >
                    <ClipboardPen size={18} strokeWidth={2.5} />
                    Plan
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {showAdmin && <AdminPanel householdId={householdId} members={members} adminUid={user?.uid} onClose={() => setShowAdmin(false)} />}
      {showDeleteAccount && user && (
        <DeleteAccountModal
          user={user}
          householdId={householdId}
          isAdmin={isAdmin}
          onClose={() => setShowDeleteAccount(false)}
          onDeleted={() => setShowDeleteAccount(false)}
        />
      )}
      {paywallTrigger && (
        <PaywallSheet
          trigger={paywallTrigger}
          status={subscriptionStatus}
          onClose={() => setPaywallTrigger(null)}
          onSubscriptionChanged={handleSubscriptionChanged}
          onOpenLegal={(view) => {
            const path = view === 'privacy' ? LEGAL_PATH_PRIVACY : LEGAL_PATH_TERMS;
            window.history.pushState({}, '', path);
            setPaywallTrigger(null);
            setCurrentPage(view);
          }}
        />
      )}
      {needsDisplayName && user && (
        <DisplayNamePrompt
          user={user}
          householdId={householdId}
          onSaved={() => setNeedsDisplayName(false)}
        />
      )}
      {selectedItem && (
        <ItemBottomSheet
          item={selectedItem}
          members={members}
          lastPurchasedTs={selectedItemLastPurchased}
          aisles={aislesV2}
          categories={categoriesV2}
          onClose={() => setSelectedItem(null)}
        />
      )}
      {showUpdateToast && (
        <UpdateToast
          onUpdate={handleUpdate}
          onDismiss={handleDismissUpdate}
        />
      )}
      {showOfflineToast && (
        <OfflineReadyToast
          onDismiss={handleDismissOffline}
        />
      )}
      {showDebugPanel && (
        <DebugPanel onClose={() => setShowDebugPanel(false)} />
      )}
      {needsReauth && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3 bg-gray-50">
              <Lock size={24} className="text-gray-500" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Session Expired</h2>
            <p className="text-sm text-gray-600 mb-5">Your session has ended. Please sign in again to continue.</p>
            <button
              onClick={() => setShowLoginExplicitly(true)}
              className="w-full py-3 px-4 text-white font-semibold rounded-xl transition-colors hover:opacity-90"
              style={{ backgroundColor: '#FF7A7A' }}
            >
              Sign In
            </button>
          </div>
        </div>
      )}
    </>
  );
}
