# Provisions — Pre-Launch UAT Checklist

**Tester:** _______________________  
**Date:** _______________________  
**Build / git SHA:** _______________________  
**RC sandbox:** iOS ☐  Android ☐  

Legend: ✅ Pass | ❌ Fail | ⚠️ Issue (note below) | — Not tested / N/A

> Before starting: read `store-assets/qa-report.md` to skip items already verified in the WP-10 static audit.  
> Platform columns: **W** = Web (Chrome desktop) | **iS** = iOS Simulator | **A** = Android physical

---

## P0 — Auth

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| A1 | Email signup → "New household" → seeds taxonomy → onboarding runs → lands in Shop mode | | | | |
| A2 | Email signup → "Join with code" → valid 16-char code → joins existing household | | | | |
| A3 | Email signup → invalid invite code → clear error, no account created | | | | |
| A4 | Email signup → expired invite code → rejected with error | | | | |
| A5 | Login / logout round-trip (email + password) | | | | |
| A6 | Password reset: request email → follow link → set new password → sign in succeeds | | | | |
| A7 | Google SSO: web redirect flow (custom domain myprovisions.app) | ✅ | — | — | |
| A8 | Google SSO: Android native plugin | — | — | | |
| A9 | Apple SSO: iOS Simulator — Apple sign-in sheet auto-presents (guideline 4.8) | — | | — | |
| A10 | Account linking: try Google SSO when email account already exists → link prompt → links successfully | | | | |
| A11 | Delete account: reauth via email → account removed, household data cleaned up | | | | |
| A12 | After logout, no household data visible to the previous session (verify Firebase Console or fresh login) | | | | |

---

## P0 — Core list operations

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| L1 | Add item via quick-add tile (Add mode) | | | | |
| L2 | Add item via free-text search → autocomplete match | | | | |
| L3 | Add item via free-text search → novel item (no autocomplete match) | | | | |
| L4 | Check item done → item moves to Done section | | | | |
| L5 | Uncheck done item → moves back to active section | | | | |
| L6 | "Clear done" removes all checked items | | | | |
| L7 | Remove individual item (swipe / long-press / delete) | | | | |
| L8 | Edit item name inline → blurring commits change | | | | |
| L9 | Edit item quantity inline → blurring commits change | | | | |
| L10 | Items persist across app restart (kill + relaunch; verify Firebase sync + IndexedDB) | | | | |
| L11 | Switch between Shop mode and Add mode; state preserved | | | | |
| L12 | Item bottom sheet opens on tap; name/qty editable; closes on swipe-down | | | | |

---

## P0 — Subscription / paywall

> Requires RevenueCat sandbox. Use StoreKit sandbox on iOS Simulator; Play billing sandbox on Android.

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| S1 | New household: trial active; Account page shows trial countdown | | | | |
| S2 | Trial active: all write operations succeed (addItem, removeItem, etc.) | | | | |
| S3 | Simulate trial expired (set `trialEndsAt` to past in Firebase Console) → paywall appears | | | | |
| S4 | Post-trial: `toggleDone` (check off item) still works (must not be gated) | | | | |
| S5 | Post-trial: `addItem` is blocked; paywall is shown | | | | |
| S6 | Purchase subscription (iOS Simulator StoreKit sandbox) | — | | — | |
| S7 | Purchase subscription (Android Play sandbox) | — | — | | |
| S8 | Restore purchases: active subscription → entitlement restored, paywall dismissed | | | | |
| S9 | Restore purchases: no subscription → "no active subscription" message | | | | |
| S10 | Cross-member broadcast: member A subscribes (incognito tab or second device) → member B sees status update without reload | | | | |
| S11 | Manage subscription deep-link → iOS: App Store subscriptions page | — | | — | |
| S12 | Manage subscription deep-link → Android: Play Store subscriptions page | — | — | | |
| S13 | No Stripe / external-payment link visible anywhere in iOS build | — | | — | |
| S14 | `via {store}` hint shown when RC entitlement store mismatches current platform | | | | |

---

## P0 — Household isolation (Firebase Rules)

Run `npm run test:rules` after starting the emulator. All assertions are automated.

| # | Test | Automated | Notes |
|---|------|-----------|-------|
| R1 | User A cannot read household B's shopping list | ✓ rules.test.js | |
| R2 | User A cannot write to household B | ✓ rules.test.js | |
| R3 | Global invite code index readable pre-auth | ✓ rules.test.js | |
| R4 | Member can write invite code for their own household only | ✓ rules.test.js | |
| R5 | `trialEndsAt` write-once: second write rejected | ✓ rules.test.js | |
| R6 | Logs readable/writable by owner uid only | ✓ rules.test.js | |
| R7 | Invite code write rejected when `inviteeEmail` is absent or doesn't match caller | ✓ rules.test.js | Added with WP-E |

---

## P0 — Offline

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| O1 | Enable airplane mode → add items → re-enable → items sync to Firebase | | | | |
| O2 | Offline banner appears when disconnected; disappears on reconnect | | | | |
| O3 | App loads usable shell when fully offline (cached list + taxonomy visible) | | | | |
| O4 | No IDB error spam in DevTools console when WebView rejects IDB (check emulator DevTools) | — | — | | |

---

## P0 — Platform polish

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| P1 | iOS Simulator: Dynamic Island / notch — header content not obscured (pt-safe inset) | — | | — | |
| P2 | Android physical: status bar is white (#FFFFFF), not dark blue, under the white header | — | — | | |
| P3 | Android: hardware back button while paywall is open → dismisses paywall | — | — | | |
| P4 | Android: hardware back during onboarding → exits app (no no-op, no crash) | — | — | | |
| P5 | Android: hardware back sequence: paywall → login screen → exit | — | — | | |
| P6 | Splash screen fades out after auth check (not stuck on splash) | — | | | |
| P7 | Safe-area insets: bottom nav not obscured by iPhone home indicator | — | | — | |

---

## P0 — Apple compliance (3.1.2)

| # | Test | iS | Notes |
|---|------|-------|-------|
| AC1 | "Restore Purchases" button visible in PaywallSheet on iOS | | |
| AC2 | Subscription terms shown before purchase: $3.99/year, ToS link, Privacy Policy link | | |
| AC3 | No external payment (Stripe) UI reachable from any screen in iOS build | | |
| AC4 | App Store metadata includes auto-renewal disclosure (check store-assets/app-store-metadata.md) | | |

---

## P1 — Invite codes

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| I1 | Admin generates invite code → 16-char alphanumeric, 7-day expiry shown in admin panel | | | | |
| I2 | Admin revokes code → subsequent redemption rejected with error | | | | |
| I3 | Code is single-use: second signup with same code fails | | | | |
| I4 | All members (admin and non-admin) can see and generate invite codes | | | | |
| I5 | Admin enters invitee email → taps Send → invite worker called → email delivered to recipient | | — | — | |
| I6 | Recipient taps deep link in email → join-with-code screen opens with code pre-filled | | | | |
| I7 | Deep link on iOS native: invite URL opens the app (not browser) and pre-populates code | — | | — | |
| I8 | Deep link on Android native: invite URL opens the app (not browser) and pre-populates code | — | — | | |
| I9 | Invite email content: correct household name and inviter identity shown (spot-check template) | | — | — | |
| I10 | `inviteeEmail` stored on RTDB invite record after email send (verify in Firebase Console) | | — | — | |

---

## P1 — Onboarding

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| ON1 | New household: onboarding screens render in order and complete | | | | |
| ON2 | After completion, `onboarding_completed = true` in Firebase; onboarding does not re-show on next login | | | | |
| ON3 | Admin always has trial immediately after signup (no paywall during or after onboarding) | | | | |

---

## P1 — Taxonomy editor

| # | Test | W | iS | A | Notes |
|---|------|---|----|---|-------|
| T1 | Admin can reorder aisles via drag handles (touch on mobile) | | | | |
| T2 | Admin can rename a category | | | | |
| T3 | Admin can merge a category → shortcuts + library items preserved in target | | | | |
| T4 | Aisle deletion blocked when categories still exist (no delete option shown) | | | | |
| T5 | All members (admin and non-admin) can edit taxonomy (add/rename/reorder aisles and categories); no controls are hidden based on role | | | | |

---

## P1 — Analytics DebugView

> Enable DebugView per platform before this section:  
> - Web: add `?analytics_debug=1` to URL or use Firebase Analytics Debugger Chrome extension  
> - iOS: pass `-FIRAnalyticsDebugEnabled` launch arg in Xcode  
> - Android: `adb shell setprop debug.firebase.analytics.app <package-name>`

| # | Event | W | iS | A | Notes |
|---|-------|---|----|---|-------|
| AN1 | `signup_completed` fires with `platform` = `web`/`ios`/`android` (not hardcoded `web`) | | | | |
| AN2 | `trial_started` fires at onboarding completion | | | | |
| AN3 | `list_item_added` fires with correct `source` (`quickAdd` or `typed`) | | | | |
| AN4 | `paywall_viewed` fires when paywall appears | | | | |
| AN5 | `subscription_started` fires after successful purchase | | | | |
| AN6 | After logout, subsequent DebugView events show no user ID (anonymous) | | | | |

---

## P1 — PWA

| # | Test | W (Safari iOS) | W (Chrome Android) | Notes |
|---|------|----------------|--------------------|-------|
| PW1 | "Add to Home Screen" / "Install app" prompt appears | | | |
| PW2 | Installed PWA launches without browser chrome | | | |
| PW3 | Installed PWA: app shell loads when offline (service worker cache hit) | | | |

---

## P1 — Multi-member list sync

> Use incognito window (Web) or iOS Simulator + Android physical device in parallel.

| # | Test | W | iS+A | Notes |
|---|------|---|------|-------|
| M1 | Member A adds item → member B sees it within ~3 seconds (no reload) | | | |
| M2 | Member A checks item → member B sees it checked | | | |
| M3 | Member A removes item → member B sees it removed | | | |

---

## P2 — Admin features

| # | Test | W | Notes |
|---|------|---|-------|
| AD1 | Insights modal: top purchased items, dormant items, per-user contributions render | | |
| AD2 | Event log: recent adds/checks/removes show names, timestamps, user attribution | | |
| AD3 | Debug panel accessible to admin via Ctrl+Shift+D or `?debug=true` | | |
| AD4 | Debug panel accessible to all members (admin and non-admin) via Ctrl+Shift+D or `?debug=true` | | |

---

## P2 — Voice MCP

| # | Test | Result | Notes |
|---|------|--------|-------|
| VM1 | `node --test voice-mcp/test/` → all 5 tests pass | | |
| VM2 | Live voice command "add milk and eggs" → items appear in correct categories | | |

---

## P2 — App Check / Firebase Console checks

| # | Check | Done | Notes |
|---|-------|------|-------|
| FC1 | Firebase Console: RTDB enforcement is OFF (monitor-only) — do not enable until native App Check is wired | | |
| FC2 | Firebase Console: App Check reCAPTCHA v3 is in monitor mode on web | | |

---

## Post-test sign-off

| Area | Pass / Fail / Deferred | Owner | Notes |
|------|----------------------|-------|-------|
| Auth | | | |
| Core list | | | |
| Subscriptions | | | |
| Household isolation (rules tests) | | | |
| Offline | | | |
| Platform polish | | | |
| Apple compliance | | | |
| Legal review (`src/LegalPages.jsx`) | | | **BLOCKER** — must complete before store submission |

**Ready to submit:** ☐ Yes ☐ No — blockers: _______________________
