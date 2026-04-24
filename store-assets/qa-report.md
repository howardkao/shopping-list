# WP-10 Integration QA Report

**Branch:** `native/integration-qa`
**Date:** 2026-04-24
**Scope:** static cross-platform audit of the multi-platform release candidate (web PWA + iOS simulator + Android emulator). Read-only pass with fixes for any blockers found.

This report is authoritative for static code review only. Items flagged **`live-test`** require a running simulator / device / sandbox account and are out of scope for a static pass; they move onto the launch playbook.

---

## Summary

| Area | Result |
|---|---|
| Auth (email + SSO + reset + reauth) | **PASS (static)** — all flows wired, redirect/native split correct. |
| Core list (add / check / remove / qty / taxonomy move) | **PASS** — every gated write calls `assertWriteAllowed`; `toggleDone` correctly ungated per PAYWALL_SPEC §4. |
| Subscriptions | **PASS (static)** — RC init, restore, cross-member broadcast, trial fallback, platform-mismatch Manage hint. |
| Offline | **PASS** — household-scoped taxonomy, circuit breakers, cached user resilient to token loss. |
| Analytics | **PASS with fix** — one bug found and fixed: `platform` user property hardcoded `'web'`. |
| Platform polish | **PASS with fix** — one bug found and fixed: Android status bar background. |
| Android back button | **PASS with fix** — paywall + onboarding edge cases fixed. |
| Apple compliance (3.1.2) | **PASS (static)** — restore visible, legal links, no external payment in native binary. |
| Web build / `cap:sync` | **PASS** — both succeed after fixes. |

---

## Fixes landed on this branch

### 1. `platform` analytics user property was hardcoded on native (`src/App.jsx`)
`setAnalyticsUserProperties` ran with `platform: 'web'` for every user, even iOS and Android builds. The hardcode dated from WP-2 (before native analytics existed). Downstream impact: any platform-based segmentation in GA4 / Firebase Analytics would have attributed every native session to the web channel, making subscription funnel + onboarding funnel by platform unanalyzable.

Fix: swap `'web'` for `Capacitor.getPlatform()` (returns `'web'`, `'ios'`, or `'android'`). Now aligned with the event-level `platform` param already used in `subscriptions.js` (`trial_started`, `subscription_started`, etc.).

### 2. `StatusBar.setBackgroundColor` was guarded by iOS platform check (`src/App.jsx`)
The call was inside `if (Capacitor.getPlatform() === 'ios')`. `setBackgroundColor` is **Android-only** (no-op on iOS per `@capacitor/status-bar` v8 docs). Result:
- iOS: `setBackgroundColor` did nothing — harmless, but never worked as the author intended.
- Android: the call never ran. The status bar fell back to Capacitor's default `colorPrimaryDark` (`#303F9F`, dark blue), because no `colors.xml` override exists in `android/app/src/main/res/values/`. Users saw a dark-blue status bar under a white coral-branded header — visually broken.

Fix: move `setBackgroundColor` to the Android branch alongside `setOverlaysWebContent(false)` and set it to `#FFFFFF` so the status bar matches the white app header. `Style.Light` (dark icons on light bg) stays correct.

### 3. Android hardware back button ignored the paywall and onboarding modals (`src/App.jsx`)
The `CapacitorApp.addListener('backButton', ...)` chain covered most modal surfaces (admin panel, delete account, item sheet, pin-edit mode, legal pages, menu) but **not** `paywallTrigger`. Pressing Android back while the PaywallSheet was open would either skip to a lower-priority branch (close a menu) or hit `CapacitorApp.exitApp()`, dismissing the entire app instead of the paywall.

The listener effect also had `if (!showLogin && onboardingActive) return undefined;` which refused to register the listener during onboarding — meaning Android back did nothing on the onboarding screen, not even exit the app. The effect dependency array `[showLogin, onboardingActive]` also caused the listener to tear down and re-register on every auth/onboarding state change.

Fixes:
- Added `paywallTrigger` / `setPaywallTrigger` to `androidNavRef` so the listener can dismiss the paywall first.
- Added an explicit `r.onboardingActive` branch that `exitApp()`s (matches default Android behavior — onboarding has no prior screen).
- Removed the early-return on onboarding and the dep array; the listener now registers once on mount and reads live state through the ref. This also fixes the churn of tearing down / re-registering the native listener on every state change.

---

## Audit matrix (per WP-10 task list)

### Auth — **PASS (static)**

- **Email signup:** invite code is pre-validated via the public `/inviteCodes/{code}` index **before** `createUserWithEmailAndPassword`; `EMAIL_SIGNUP_IN_PROGRESS_KEY` blocks `onAuthStateChanged` from dismissing the Login screen mid-signup. Errors surface through `humanizeAuthError`.
- **Google / Apple SSO (native):** uses `@capacitor-firebase/authentication` with `skipNativeAuth: true` + `signInWithCredential`. Apple flow includes `rawNonce`. Account-exists-with-different-credential produces the linking UI.
- **Google / Apple SSO (web):** `signInWithRedirect` + `getRedirectResultOnce` with session phases (`pre_redirect` / `awaiting_household` / `delete_account`) resumed on load. Password-reset emails route through `/signin?mode=resetPassword&oobCode=…`.
- **Account linking:** pending credential stashed in state + session storage key `SSO_LINK_UI_KEY` survives a re-render round-trip. After password sign-in, `linkWithCredential` attaches the SSO provider.
- **Password reset:** `sendPasswordResetEmail` with explicit `continueUrl`; `confirmPasswordReset` flow is in-app (`passwordLinkAction`).
- **Delete account reauth:** password (`EmailAuthProvider.credential` + `reauthenticateWithCredential`), SSO native (plugin + `reauthenticateWithCredential`), SSO web (`reauthenticateWithRedirect` resumed via `SSO_SESSION_KEY.phase === 'delete_account'`).

**`live-test`:** real Google / Apple sandbox sign-in on iOS simulator + Android emulator + web (custom `myprovisions.app` auth domain); verify Apple guideline 4.8 auto-present of Apple SSO on iOS; account-linking round-trip.

### Core list — **PASS**

Every write handler in PAYWALL_SPEC §4 Table 1 is gated:
- `addItem`, `clearDone`, `removeItem`, `updateQuantity`, `updateItemName`, `renameTaxonomySuggestionById`, `moveSuggestionToCategory`, `removeSuggestionEverywhere`, `promoteListItemToVisibleShortcut`, `updateSuggestionQuantity`, `addFromAisleSearch`, `dismissSuggestion`, `recordDensityDismissal`, `enterPinEditMode`, `handlePromotionAccept`, `handlePromotionDismiss`, `enterAddMode` (Add-mode gate), all `taxo*` handlers, `AdminPanel.createInvitation` / `deleteInvitation`.
- `toggleDone` intentionally **not** gated (Apple shop-use-case compliance — expired users can still shop).
- `completeOnboarding` intentionally **not** gated (onboarding creates the trial window, so writes are always allowed; and the paywall was unreachable from onboarding before this QA pass — see fix #3).

### Subscriptions — **PASS (static)**

- `initSubscriptions(householdId)` configures RC with `householdId` as the App User ID; handles household switch (clears `latestCustomerInfo`, logs out, re-configures).
- `isWriteAllowed()` resolution order matches PAYWALL_SPEC §2.4: web → allow; RC paid → allow; in Firebase trial → allow; before first `customerInfo` → allow; else deny.
- `refreshCustomerInfo()` fires on `appStateChange → isActive` and on `subscriptionUpdatedAt` broadcast. RC remains authoritative.
- `handleSubscriptionChanged()` writes `households/{hid}/subscriptionUpdatedAt = Date.now()` so other household members re-fetch.
- Trial window: `households/{hid}/trialEndsAt` read with `createdAt + TRIAL_DAYS` fallback for legacy households.
- Account page subscription panel correctly renders trial / active / no-sub states and surfaces a non-clickable `via {store}` hint when the RC entitlement's `store` doesn't match the current platform.
- `customerHasPremiumAccess` has the documented StoreKit 2 / restore fallback (`activeSubscriptions` + `allPurchasedProductIdentifiers` + `latestExpirationDate`).

**Observations (non-blocking):**

- The paywall pricing block always reads *"$3.99 per year. 2 months free, then billed annually."* — even when `headline` shows *"Your trial has ended"*. Post-trial, this is technically misleading (the Firebase-tracked 2-month trial already elapsed; the purchase does **not** grant another 2 months because store-side intro offers are intentionally disabled — see PAYWALL_SPEC §1a). Matches the spec (§4.3 "Offer" line is `$3.99 per year + 2 months free, then billed annually`), so not a fix, but flagging for the copy review before launch.
- The entitlement ID `'Provisions Pro'` contains a space. RC allows this but most SDKs / dashboards prefer lowercase-alphanumeric. The code handles it consistently; the fallback SKU match covers the StoreKit 2 quirk. Leave as-is unless RC support raises it.

**`live-test`:** sandbox purchase on iOS + Android; restore purchases (no active sub / active sub); trial-end transition (RC receives no-entitlement event); cross-platform: subscribe on iOS → entitlement visible on Android & web; offline-to-online RC cache refresh; cross-member broadcast (member A subscribes → member B sees status update without restart).

### Offline — **PASS**

- IndexedDB `DB_VERSION = 2` drops the retired `shoppingHistory` / `commonItems` / `lessCommonItems` stores.
- Offline taxonomy cache is **household-scoped** (`blob.householdId === householdId` check on hydrate) so signing into a different household never merges stale aisles.
- `offlineStorage.js` and `logger.js` each have a session-level circuit breaker (`offlineIdbDisabled` / `localLogsIdbDisabled`) with one-shot `console.warn`, so a Capacitor WebView rejecting IDB does not spam the console on every write.
- Cached user (`loadCachedUser`) is load-on-mount before `auth.authStateReady()` so the app shell renders immediately; `onAuthStateChanged(null)` retains the cached user when the issue is network / token refresh (matches session log 2026-04-14 resilience work).
- `save()` no-ops when `householdId` is missing — deleted-account race is covered.

**`live-test`:** airplane-mode → add items → re-enable → verify sync round-trip on all three platforms; IndexedDB reset (Safari Private / WebView low-storage); verify sync pill appears/disappears correctly.

### Analytics — **PASS (after fix #1)**

- All documented events fire: `signup_started` / `signup_completed` / `signup_abandoned` / `invite_code_redeemed` / `invite_code_generated` / `onboarding_completed` (with `duration_seconds`) / `list_item_added` (with `source`) / `list_item_checked` / `mode_switched` / `paywall_viewed` / `trial_started` / `subscription_started` / `subscription_cancelled` / `subscription_renewed`.
- `analytics.js` splits native vs web correctly: native uses `@capacitor-firebase/analytics`; web uses the Firebase JS SDK's `logEvent`.
- `setAnalyticsUserId(null)` is called on sign-out so subsequent events are anonymous.

**`live-test`:** verify events appear in Firebase Console → Analytics → DebugView on web, iOS simulator, Android emulator.

### Platform polish — **PASS (after fix #2 and #3)**

- `SplashScreen.hide({ fadeOutDuration: 220 })` fires once `authLoading === false`, native-only.
- `StatusBar.setStyle({ style: Style.Light })` is correct for the white app header (dark icons on light bg). Android now also gets `setOverlaysWebContent({ overlay: false }) + setBackgroundColor('#FFFFFF')`.
- `appStateChange → isActive` triggers `refreshCustomerInfo()`.
- `@capacitor/app` `backButton` listener now handles (in order): paywall → login → onboarding → debug panel → admin panel → delete account → item sheet → pin-edit → reauth → menu → legal pages → non-list page → exit.
- Safe-area handling: `pt-safe` on the header; `pb-safe` on the mobile bottom nav; `max(env(safe-area-inset-bottom), …)` on the Delete Account footer and the item bottom sheet.

**`live-test`:** iPhone with Dynamic Island (status bar look, header clearance); Pixel gesture navigation vs 3-button back; splash duration subjectively; status bar icons visible on both header + offline banner.

### Apple compliance (3.1.2) — **PASS (static)**

- **Restore purchases** button visible in `PaywallSheet` (native + web). Web shows `{ unavailable: true }` error — not exposed on iOS binary.
- **Subscription terms pre-purchase:** $3.99/year + "2 months free, then billed annually" + Terms of Service + Privacy Policy links. Store metadata (`store-assets/app-store-metadata.md`) carries the auto-renewal disclosure that Apple requires in the description.
- **No external payment in iOS binary:** `src/stripe-checkout.js` is imported **dynamically** inside an `if (!Capacitor.isNativePlatform())` branch of `purchaseSubscription()`; the module never loads in the iOS bundle. Searched source for `stripe` / external-URL mentions — none surface in native UI copy.
- **Account page:** subscription row shows Subscribe + Restore on native; Manage deep-links to `apps.apple.com/account/subscriptions` on iOS. No web-checkout links inside the iOS binary.

---

## Known issues deferred to live-test or launch prep

1. **Paywall pricing block post-trial copy** — "2 months free, then billed annually" is literally true of the Firebase-tracked trial but misleading next to the "Your trial has ended" headline. Reconsider during legal / launch copy review.
2. **App Check on native** — native App Check attestation is not wired (per `TDD.md`); RTDB enforcement should be left off until native attestation is added (already documented under "Known gaps").
3. **voice-mcp legacy paths** — unrelated to WP-10 but previously documented: worker still reads `common-items` / `less-common-items` / `shopping-history`. Must not be enabled for production traffic until v2-read refactor ships.
4. **Vite chunk-size warning** — `index-*.js` is 882 KB (220 KB gzipped). Non-blocking; reasonable for a single-page Capacitor webview; consider `manualChunks` if the download cost becomes relevant.

---

## Verification

- `npm run build` — clean (one pre-existing Vite chunk-size advisory; unrelated).
- `npm run cap:sync` — clean, all 6 plugins registered on both iOS and Android.
- No new files added; one file changed (`src/App.jsx`, +19 / -6).
