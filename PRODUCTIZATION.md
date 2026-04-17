# Productization Roadmap

This document tracks the ongoing effort to productize this app for public, multi-household release. Updated at the end of each working session. Maintained by both the developer and the AI coding agent.

---

## Current State of the App (as of 2026-04-10)

- **Single-household only**: all authenticated users share one Firebase namespace at the root level (`/shopping-list`, `/shopping-history`, `/common-items`, etc.). There is no concept of household isolation.
- **Hardcoded, personal categories**: `CATEGORIES` (App.jsx:33) contains Bay Area-specific store names (Ranch 99, Berkeley Bowl, Costco Bulk Foods). Not suitable for general audiences.
- **Hardcoded, personal default suggestions**: `DEFAULT_ITEMS` (App.jsx:85) reflects the owner's household preferences.
- **First user = global admin**: Admin status is granted to whoever registers first. This doesn't generalize to multi-household.
- **PWA with offline support**: Service worker + IndexedDB already in place; solid mobile story without app stores.
- **Firebase stack**: Auth (email/password), Realtime Database (shopping data + invite codes), Firestore (admin records only).
- **Invite code system**: Already exists for controlling who can join, but codes are global and not scoped to a household.
- **Production logging**: Client-side events logged to Firebase, viewable by admin.

---

## Repository Strategy

**Single repo.** Both single-household and multi-household work live here. When the multi-household refactor happens, a self-hoster who creates one household gets the single-household experience — the code doesn't need to distinguish. No second repo, no cherry-picking, no divergence.

**License: Elastic License 2.0 (ELv2).** Source is publicly readable (portfolio signal, employer evaluation). Self-hosting for personal/non-commercial use is permitted. Running it as a commercial hosted service or monetizing it (e.g. subscriptions, freemium) is prohibited. This is "source available," not OSI "open source" — that distinction doesn't matter for portfolio purposes.

**Why this combination works for the goals:**
- Employers can read the full codebase and try the hosted product (30-day free trial when launched) without deploying anything themselves
- No competitor can legally spin up a competing hosted service
- No maintenance burden of two repos

### Public repo readiness checklist
- [x] Add `LICENSE` file (MIT) — 2026-04-10
- [x] Rewrite README for generic self-hosting audience — 2026-04-10
- [x] Audit git history for accidentally committed secrets — 2026-04-10 (clean: no secrets ever committed; dist/ removed before any keyed builds)
- [x] Genericize `CATEGORIES` and `DEFAULT_ITEMS` in `src/App.jsx` — 2026-04-10 (replaced Bay Area-specific values with neutral generic defaults; added comments pointing users to edit them)
- [x] Internal planning docs moved to `.gitignore` — 2026-04-10 (`PRODUCTIZATION.md`, `CLAUDE.md`, `AGENTS.md`, `LOGGING.md`, and the two strategy/spec docs; un-tracked the three that were already in git)

---

## Open Decisions

- [ ] **Business model**: free trial + annual subscription — details below still open
  - Leading option: ~$5-10/year after 2-month free trial
  - [ ] **Price point**: $5/year (impulse buy, low revenue) vs $8-10/year (doubles revenue, still cheap). AnyList comparable at $12/year.
  - [ ] **Trial length**: 2 months (8+ shopping trips, enough to invest in taxonomy) vs 3 months (safer but may lose conversion signal). Must be configured in App Store Connect + Play Console.
  - [ ] **Post-trial behavior**: read-only mode (preserves data, gates adding)? degraded mode (disable sync/collaboration)? full lockout? nag-based?
  - [ ] **Subscription scope**: per-household (one person pays, all benefit — better UX) vs per-user (higher revenue, feels petty for $5). RevenueCat supports either via entitlement mapping.
  - [ ] **Web vs in-app pricing**: uniform ($5 everywhere) or web discount ($5 web / $6 in-app to offset 15% platform fee)? Most apps keep uniform.
- [x] **App store strategy**: Capacitor wrapper for both iOS App Store and Google Play — decided 2026-04-12
  - Plan documented in `NATIVE_APP_PLAN.md`
- [ ] **RTDB vs Firestore for household data**: RTDB is simpler and already used, but Firestore is more cost-efficient at scale and supports finer-grained security rules
  - Leading option: stay on RTDB for now; revisit if cost becomes real

**Decided:**
- Users belong to exactly one household (no multi-membership)
- Household naming deferred (no name field for now)
- Household IDs: Firebase push IDs (via `push()`) — time-ordered, non-guessable, no extra dependency
- Invite codes: extend to 16 characters (enumeration-infeasible); email-based invites post-launch
- Invite codes stored under `/households/{householdId}/inviteCodes/`

---

## Work Items

### Must-Have (pre-launch blockers)

> **Public / app-store launch gate:** Do not treat Privacy Policy + ToS as “done” until the **Legal: final Privacy + ToS pass** item below is checked. The in-app documents are a starting point, not substitute for counsel review.

- [x] **Multi-household data isolation** — 2026-04-10
  - Restructure DB paths: `/households/{householdId}/shopping-list`, etc.
  - Update all Firebase reads/writes in App.jsx to be household-scoped
  - Firebase rules: enforce that users can only read/write their own household
  - Invite codes become household-scoped (generated by household admin, grant access to that household on redemption)
  - Household creator becomes the household admin (replace global first-user logic)
  - User record tracks which household(s) they belong to
- [x] **Customizable categories** — stored per-household in Firebase, seeded from code on first setup — 2026-04-10 (UI to add/remove/reorder categories deferred)
- [x] **Generic default suggestions** — seeded from code constants on first household setup — 2026-04-10
- [x] **Account deletion + data cleanup** — 2026-04-10
- [x] **Privacy Policy + Terms of Service** — 2026-04-17 (`src/LegalPages.jsx`; linked from login + Account)
- [ ] **Legal: final Privacy + ToS pass before public or app-store launch** — Counsel reviews `src/LegalPages.jsx`; add real **operator legal name**, **contact email** (and support process), and **governing law / venue**; verify every described practice matches production (Firebase products in use, optional Analytics, log retention and admin visibility, account deletion, data locations). Update in-app copy after review.
- [x] **Firebase App Check** — client: reCAPTCHA v3 + `initializeAppCheck` in `src/firebase.js` (2026-04-17). **Console:** register web app in App Check, monitor, then enforce RTDB (optionally Auth); register dev debug tokens.
- [ ] **Google + Apple SSO** — reduces signup friction; Apple SSO required by guideline 4.8 if Google SSO is offered
- [ ] **Subscription system (RevenueCat)** — Apple IAP + Google Play Billing + Stripe, unified cross-platform
- [ ] **Cross-platform analytics (Firebase Analytics)** — unified event tracking across web, iOS, Android

### Should-Have

- [x] **Stronger invite code security** — codes extended to 16 characters; stored in household path + global lookup index — 2026-04-10
- [ ] **Firebase `.validate` rules for data size** — prevent malicious users from writing arbitrarily large payloads
- [ ] **Capacitor native apps (iOS + Android)** — see `NATIVE_APP_PLAN.md` for full plan
- [x] **Generic onboarding flow** — guide new household through setting up aisles/categories and reviewing initial suggestions — 2026-04-14 (welcome + wizard-mode SuggestionsEditor, gated on `taxonomy/onboarding_completed`)
- [x] **Taxonomy redesign (aisles + user-editable categories + library)** — shipped in app 2026-04-14–15; legacy taxonomy code + RTDB paths removed from the client and household rules thereafter. PRD §4–§6 and TDD §3 describe the shipped model.
  - Seed catalog: `src/seedCatalog.js` (as of 2026-04-17: 10 aisles, 54 categories, 353 items; `starred` rows seed visible shortcuts, the rest seed into per-category `library`)
  - Runtime data: `households/{hid}/taxonomy/{aisles,categories,visible-items,library}` with Firebase push ids (seed slugs are mapped at bootstrap / migration)
  - Settings + onboarding: `src/SuggestionsEditor.jsx` + `src/Onboarding.jsx`; Shop/Add are aisle-grouped against v2 taxonomy
  - Historical migration for pre-v2 households: `scripts/migrate-to-taxonomy-v2.cjs` (+ related scripts under `scripts/`); not part of normal operations for new households (`src/householdBootstrap.js`)
  - **Still open (outside web app):** `voice-mcp/` context reads still point at legacy household paths for suggestions/history — needs a v2 read pass before voice traffic scales (`CLAUDE.md` notes this gap)

### Nice-to-Have / Post-Launch

- [ ] **Firestore migration for household data** — more cost-efficient at 10k+ households; requires significant refactor
- [ ] **Push notifications** — notify household members when the list changes (Capacitor plugin: `@capacitor/push-notifications`)
- [ ] **Push notifications** — notify household members when the list changes (limited on iOS PWA pre-16.4)

---

## Cost Model

Firebase Blaze (pay-as-you-go) pricing:
- Storage: $5/GB
- Downloads: $1/GB (the main cost driver for RTDB — full path sync on each connection)

Estimated per-household data footprint: ~100KB (shopping list, history, common/less-common items)

| Active Households | Monthly Storage | Monthly Download | Estimated Monthly Cost |
|---|---|---|---|
| 100 | ~10MB | ~2.5GB | ~$2.50 |
| 1,000 | ~100MB | ~25GB | ~$25 |
| 10,000 | ~1GB | ~250GB | ~$255 |
| 100,000 | ~10GB | ~2.5TB | ~$2,550 |

*Download estimate assumes 8 app opens/day × 2 users/household × 100KB/open. PWA caching can reduce this 50–80% for active users.*

Firebase Spark (free) plan covers ~400 households on download alone (10GB/month limit).

---

## Security Risks Log

- **Invite code enumeration**: any authenticated user can attempt to redeem codes; 8-char alphanumeric codes are brute-forceable at scale → fix: scope codes to household, add rate limiting
- **`isFirstUser` flag is self-reported**: used to gate global log access; no server-side enforcement → fix: replace with proper Firestore admin/household-admin check post-refactor
- **No data size limits in Firebase rules**: malicious users can write large strings → fix: add `.validate` constraints
- **Email duplicated in RTDB**: user email stored in `/users/{uid}/email` *and* Firebase Auth → probably unnecessary; clean up in multi-household refactor
- **No rate limiting on signup**: beyond Firebase defaults; App Check will help
- **GDPR exposure**: if EU users sign up, need documented data deletion path

---

## Session Log

### 2026-04-17 — Design review 9.2 (Household Insights copy)
- **`src/App.jsx` (`InsightsModal`):** Removed tier / internal analytics jargon; plain-English section titles and blurbs; member rows use `members` display names (email fallback, then “Unknown member”) instead of truncated UIDs; friendlier error and empty states.

### 2026-04-17 — Design review 4.3 (Add autocomplete flip)
- **`src/App.jsx`:** Per-aisle Add autocomplete measures space below the input on **open** (`visualViewport.height` fallback `innerHeight`); if space below is under 200px, dropdown uses `bottom-full mb-2` instead of `top-full mt-2`. Flip cleared when the dropdown closes for that aisle.

### 2026-04-17 — Design review 6.1 + 6.3 (Onboarding / SuggestionsEditor)
- **`src/SuggestionsEditor.jsx`:** Removed onboarding "Step 2 of 2" label (6.1). Removed wizard **Reset to defaults** control and `onReset` / `resetEnabled` props (6.3); wizard footer is **Done** only, right-aligned. No `App.jsx` taxonomy reset handler existed to remove.
- **`PRD.md`:** §6a flow updated to match shipped onboarding (Done; no reset).

### 2026-04-17 — Firebase App Check (client)
- **`src/firebase.js`:** `initializeAppCheck` + `ReCaptchaV3Provider` immediately after `initializeApp`, before Auth/RTDB; production runtime throws if `VITE_RECAPTCHA_SITE_KEY` is missing; dev sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN` (`true` or `VITE_APPCHECK_DEBUG_TOKEN`); skip init in dev when key absent (one `console.info`).
- **`.env.example`:** `VITE_RECAPTCHA_SITE_KEY`, optional `VITE_APPCHECK_DEBUG_TOKEN` (dev).
- **`TDD.md`:** App Check subsection + env list.
- **Ops:** reCAPTCHA v3 key → Firebase App Check → register app → ship → monitor → enforce RTDB (see plan “When to turn on strict checking”).

### 2026-04-17 — Unified design-review PR: Pass 11, pin copy, documentation sync
- **Commit:** `88b9e7b` on branch `design-review-pass`.
- **`src/App.jsx`:** Offline banner uses Lucide **`AlertTriangle`** instead of the ⚠️ emoji (10.1). Removed the floating admin **Bug** FAB and `bottom-28` positioning; debug panel remains via **`Ctrl+Shift+D`** and **`?debug=true`** (10.3). B1 dormancy card copy uses **pin(s)**; delete-account warning uses **pinned items**.
- **Deleted:** `palette-mockup.html` (disposable 2.2 comparison artifact after sign-off).
- **`src/SuggestionsEditor.jsx`:** Settings page heading **Pinned items**; empty/merge helper copy uses pinned terminology.
- **`src/LegalPages.jsx`:** Privacy policy data-inventory bullet uses **pinned quick-add items** alongside library.
- **`DESIGN_REVIEW.md`:** Shipped items (2.2–3.5, 4.2, 5.1–5.4, 6.1, 6.3, 7.1–7.2, 8.1–8.2, 8.4, 10.1, 10.3) marked **`implemented`** with pointers here; 7.1 notes invite field has no reveal toggle (plaintext code).
- **`PRD.md` / `TDD.md`:** Item bottom sheet, Shop/Add row interactions, single-column layout, sync hide-when-healthy, safe-area + debug access, `humanizeAuthError` in **`src/authErrors.js`**.
- **`CLAUDE.md`:** Debug access line matches no floating bug button.

### 2026-04-17 — PRODUCTIZATION: taxonomy checkbox reconciled
- Marked **Taxonomy redesign** should-have item as complete; refreshed sub-bullets to match shipped v2 paths, current seed counts, and bootstrap/migration story.
- Called out **`voice-mcp/`** as the remaining consumer of legacy read paths (separate follow-up, not a second “taxonomy redesign” project).

### 2026-04-17 — Firebase Analytics (SDK)
- **`src/firebase.js`:** Optional GA4 via `getAnalytics` when `VITE_FIREBASE_MEASUREMENT_ID` is set; `measurementId` merged into web config; initialization gated on `isSupported()`; `analytics` exported for future `logEvent` calls.
- **Docs:** `.env.example` and `README.md` note the optional measurement ID (Firebase Console → Project settings → Your apps).

### 2026-04-17 — Design review: close out remaining items (2.2 → 10.3)
- Debated and recorded decisions for every remaining design-review item except the two branding items (2.1a, 2.1b) the user asked to defer. All decisions captured in `DESIGN_REVIEW.md` with discussion, rationale, and implementation notes for the synthesis chat.
- **Visual hierarchy (2.2 → chose Option A, folds in 3.5):** item names → `text-gray-800`, Shop aisle headers bolded to match Add mode, quick-add tile rows get `#FFF5F5` background + dark name, coral retained only on actionable/stateful surfaces. Tokenize-first refactor deferred to bundle with dark mode. Produced disposable `palette-mockup.html` (A vs B vs Current) to break a text-only impasse — kept in place for synthesis chat reference, delete after merge.
- **Unified row-tap model (4.2 expanded, closes pencil-icon affordance):** row tap = current mode's primary action (toggle done in Shop / add in Add-tile / remove in Add-list); right-side chevron opens sheet; left-side icon is visual affordance + redundant tap target. Pencil replaced with chevron.
- **Bottom-sheet per-item affordances (5.2 expanded):** "Shortcut settings" retires. Replaced with two muted rows under metadata — (1) `AISLE › Category` breadcrumb that *is* the move control, (2) state-aware shortcut button ("Add to shortcuts" / "Remove from shortcuts"). Extends to list rows and library items; absorbs the ad-hoc "Add as a shortcut?" CTA paths (A1 promotion card flagged for possible retirement by synthesis chat).
- **Onboarding trim (6.1 decided, 6.2 rejected):** drop "Step 2 of 2" numbering; the editor already scoped down to aisle customization (shortcut editing removed out-of-band), so 6.2's overwhelm concern is resolved.
- **Destructive / power affordances removed:** "Reset to defaults" dropped from onboarding *and* Settings (6.3). Floating debug button removed in all envs (10.3) — keyboard shortcut + `?debug=true` remain.
- **Touch + keyboard hygiene:** checkboxes / pencils / + / X buttons get invisible hit-zone expansion to ≥44×44 without resizing the visible glyph (3.3). Bottom-fixed elements (nav bar + wizard footer) hide when any input is focused (8.2). Autocomplete dropdown flips above its input when space below is limited (4.3). Safe-area audit to be done at implementation time across bottom-fixed elements and top notch (8.1).
- **Polish:** Shop-mode empty state replaces aisle grid when list is empty (3.1). Checked items stay in place but dim more aggressively — no sort change (3.2). "Online" sync pill hides when online + connected; only renders for offline/syncing/error (3.4). "Last purchased: unknown" → "No purchase history" (5.1). "Name"/"Quantity" labels restyled smaller/lighter — *kept* (accessibility preservation); saved this as a standing `feedback_accessibility.md` memory so future polish sessions don't regress semantic HTML (5.4). Session-expired modal: emoji → Lucide `Lock`, `bg-blue-600` → coral (2.3). Offline banner ⚠️ → Lucide `AlertTriangle` (10.1).
- **Login:** humanized Firebase auth error mapping with generic fallback; parallel invite-code error copy (7.2). Eye icon toggle on **password** fields (7.1); invite code field stayed plaintext (no toggle) in shipped unified PR.
- **Mobile bottom sheet:** both X visible on mobile *and* real swipe-to-dismiss (5.3).
- **Multi-column layout removed** from large screens — single column at all breakpoints (8.4).
- **Insights modal** kept in place but all developer-speak trimmed (tier labels, UIDs, internal function/field names) — no rebuild (9.2).
- **Rejected:** 4.1 (global search — the per-aisle "search" is really add-with-autocomplete; a global field would force an aisle-picker step on every novel item). 4.4 ("No items" copy rewrite — user disagreed). 10.2 (Purchase History sort — alphabetical serves the "when did I last buy X" use case). 6.2 (resolved out-of-band).
- **Deferred:** 7.3 (invite-code formatting → will be obsoleted by email/SMS URL invites). 8.3 (dark mode → post-launch, bundled with theme-token refactor). 9.1 (Account identity surfaces → wait for household naming).
- No code changes this session; `DESIGN_REVIEW.md` updated throughout with discussion/decision/implementation notes. `palette-mockup.html` produced and left in place for synthesis chat reference.

### 2026-04-16 — Header wordmark: Shopping List
- **`src/App.jsx`:** Top header center label changed from **Tend** back to **Shopping List** (tap still returns to the list page).

### 2026-04-16 — Navigation redesign: mobile bottom bar, desktop top toolbar, contextual Clear chip
- **Architecture:** Shop and Add are co-equal primary modes. Mobile gets a fixed **bottom nav bar** (`lg:hidden`) carrying Shop/Add segmented + a contextual **Clear chip**. Desktop (`lg+`) flips to a single always-visible top toolbar that carries brand wordmark, Shop/Add toggle (when on list page), Clear button (when items checked), inline nav links (List / History / Settings / Account), and the sync pill.
- **Header (mobile):** restructured to hamburger left + **Tend** wordmark center + sync dot right. Wordmark is the brand name (previously the header showed page-title text like "Shopping List" / "Settings"). Tapping the wordmark returns to the list page.
- **Clear chip discoverability:** three layered techniques — (1) entry animation: chip slides up from the nav bar with a brief bounce on every appearance via the `animate-chip-in` keyframe. (3) always present on resume: chip is rendered conditionally on `doneCount > 0`, so opening the app with items already checked shows the chip immediately. (4) one-time first-run tooltip: a small "All done with these? Tap to clear." callout above the chip the very first time it appears for a device, gated by `localStorage['tend.clearChipTooltipSeen.v1']`, auto-dismisses after 4s.
- **Removed:** `showStickyToolbar` state, `toolbarRef`, the in-page sticky toolbar, and the original page-top toolbar. Scroll handler retained header-hide-on-scroll + fast-scroll fade effects.
- **CSS additions (`src/index.css`):** `chip-in` keyframe + `.animate-chip-in`, `tooltip-in` keyframe + `.animate-tooltip-in`, `.pb-safe` utility (`max(env(safe-area-inset-bottom), 0.75rem)`) for iOS home-indicator clearance.
- **Other:** `doneCount` derived value introduced (replaces inline `list.filter(i => i.done).length` in three places); content padding adjusted to `pb-32 lg:pb-6` on the list page so the bottom bar doesn't overlap content. Floating debug button (admin-only) repositioned to `bottom-28` on mobile so it sits above the bottom bar.
- **Docs:** PRD §7 (UI/UX Requirements) rewritten to describe the breakpoint-flipped chrome + Clear chip behavior + safe-area handling. TDD §6 (state management) gained a new **Navigation chrome (responsive)** subsection. `nav-mockups.html` (disposable design artifact from this session) deleted after sign-off.
- **Build:** `npm run build` clean.

### 2026-04-16 — Data-driven suggestion management (A1 promotion + B1 dormancy)
- **New modules:** `src/categoryClassifier.js` (perishability tier classification: fresh/packaged/pantry/nonfood via seed-ID lookup, keyword scan, fallback) and rewritten `src/itemAnalytics.js` (category-aware analytics over the `item-events` stream).
- **A1 — Promotion prompts:** When a user adds an item in Add mode that has been checked off ≥3× within the category's promotion window (21d fresh/packaged, 42d pantry/nonfood) and isn't already a visible shortcut, an amber inline card asks "Add as a shortcut?" with Yes/No. Auto-dismisses after 8 seconds.
- **B1 — Dormant shortcut cleanup:** At the bottom of each aisle in Add mode, a gray card flags shortcuts with no activity beyond the category's dormancy window. Expandable "Manage cleanup" with per-item Remove/Keep buttons. Remove demotes to library; Keep dismisses (90-day cooldown, permanent after 2 dismissals).
- **Per-category thresholds:** dormantDays and minEventAge are now tier-specific (fresh 21d, packaged 35d, pantry 70d, nonfood 90d) instead of a single global 56-day guard. Tighter thresholds serve double duty: cleanup + teaching users that a curated shortcut list is the app's differentiating value.
- **`createdAt` on shortcuts:** New visible-item entries now carry `createdAt` timestamp (bootstrap, promote-to-shortcut, A1 acceptance). Dormancy check skips shortcuts newer than their category's dormancy window.
- **Dismissal persistence:** `suggestion-dismissals` path in Firebase with escalation model (first dismiss → 90-day cooldown, second → permanent suppress).
- **`categoryId` on events:** All `logItemEvent` calls now include `categoryId` for richer analytics.
- **InsightsModal updated** to use new `promotionCandidates` + `dormantShortcuts` APIs instead of legacy wrappers.
- **DB rules:** Added `suggestion-dismissals` and `categoryId` validation under `item-events`.
- Deployed hosting + database rules. Build clean.

### 2026-04-16 — Native app plan: SSO, subscriptions, analytics, pricing strategy
- Expanded `NATIVE_APP_PLAN.md` from 5 phases to 8: added Google + Apple SSO (Phase 1), RevenueCat subscriptions (Phase 4), Firebase Analytics (Phase 5). Estimated ~9-13 sessions total.
- **SSO decision:** Add both Google and Apple SSO. Apple guideline 4.8 requires Apple SSO if any third-party social login is offered. Email/password alone wouldn't require it, but adding Google SSO triggers the requirement. Firebase Auth supports both natively; Capacitor plugin `@capacitor-firebase/authentication` handles native dialogs.
- **Subscriptions decision:** RevenueCat to unify Apple IAP (15% fee), Google Play Billing (15%), and Stripe (~3% web). Free under $2.5K/mo revenue. Handles cross-platform entitlements, receipt validation, and subscription status.
- **Analytics decision:** Firebase Analytics — free, native Capacitor plugin, same ecosystem, RevenueCat integration built in. Core event taxonomy defined (20+ events across acquisition, engagement, subscription, technical health). Disable IDFA to skip iOS ATT prompt.
- **Pricing discussion (not decided):** ~$5-10/year after 2-month free trial. Per-household subscription (one person pays, all benefit). Post-trial behavior leading toward read-only mode (can view/check items, can't add/edit). Open decisions added to PRODUCTIZATION.md.
- Added SSO, subscriptions, and analytics as must-have work items in PRODUCTIZATION.md.
- No code changes this session; planning only.

### 2026-04-15 — Edit suggestions from the Add-view bottom sheet + legacy Firestore cleanup
- **Feature:** `ItemBottomSheet` (`src/App.jsx`) gained an advanced-config panel for suggestion items. When the sheet is opened via `openSuggestionSheet`, a muted `AISLE › Category` breadcrumb row with a pencil icon appears below the metadata block. Tapping expands an inline panel with aisle + category dropdowns and a two-step "Remove from suggestions" destructive action. The panel has its own explicit **Save** / **Cancel** buttons; advanced edits do not save on blur, backdrop tap discards silently. List-item sheets are untouched.
- New handlers in `App.jsx`: `moveSuggestionToCategory(suggestionId, fromCatId, toCatId)` does a single multi-path RTDB `update()` across `taxonomy/visible-items/*` and `taxonomy/library/*`, preserving the item's visible-vs-library bucket and dedupe-deleting if the destination already has a same-named entry. `removeSuggestionEverywhere(suggestionId, catId)` deletes from both paths under the current category.
- Removed the trailing Save button from `ItemBottomSheet` — name/quantity already commit on blur and on close via existing handlers.
- **Legacy Firestore cleanup:** `firestore` / `doc` / `setDoc` / `getDoc` imports were unused since the 2026-04-10 admins-in-RTDB refactor. Removed from `src/firebase.js` and `src/App.jsx`. Deleted `firestore.rules` and the `firestore` block in `firebase.json`.
- **README rewrite:** dropped Firestore setup step, flat `CATEGORIES`/`DEFAULT_ITEMS` customization instructions, and "Admin data | Firestore" row; replaced the "first use" section with new-household signup + v2 taxonomy onboarding.
- **CLAUDE.md full rewrite** to current v2 state (aisle→category→item model, household-scoped paths, current components, known voice-mcp gap). The old doc still described flat `CATEGORIES`, `encodeCategory`, `common-items`/`less-common-items`, Firestore admins, and the retired "Edit Suggestions page."
- Voice MCP worker untouched (known gap — still reads legacy `common-items`/`less-common-items`/`shopping-history` for context summary).
- Deployed hosting + database rules. Build clean. PRD §3 (Item Detail Bottom Sheet) and TDD §Add Mode Interaction updated.

### 2026-04-14 — Strip legacy taxonomy (code + data)
- Reseeded the single existing household (`-OptMtfCe4g2mjg2iZYw`) with the full v2 catalog, preserving legacy names as `"<NAME> (legacy)"` categories in mapped aisles (`scripts/reseed-with-legacy.cjs`, new). User reorganized aisles in the editor, then ran `scripts/merge-legacy-into-seed.cjs` (new) which merged items into seed categories via exact + fuzzy substring match; 22 exact/fuzzy moves, ~90 items parked in auto-created per-aisle "Other" categories, 14 legacy categories deleted after emptying. Shopping-list items remapped accordingly.
- With only one household and it now fully v2-native, stripped all legacy-taxonomy code paths from `src/App.jsx`: removed `CATEGORIES`, `DEFAULT_ITEMS`, `encodeCategory`/`decodeCategory`, `migrateItems`; removed state for `categories`, `commonItems`, `lessCommonItems`, `history`, `taxonomyMigrated` and the orphaned Edit-page state; removed Firebase listeners for the four legacy paths and the `taxonomy/migrated` flag; removed the `hasV2Taxonomy` gate, `displayCategories`, and `legacySettingsTaxonomy`; deleted orphaned handlers (`toggleQuickAdd`, `deleteSuggestion`, `finishEditName`, `addNewSuggestion`, `getAvailable`, `getSuggestions`, `getQuickAddDropdownItems`, `addFromSearch`, `saveCommonItems`, `saveLessCommonItems`); simplified `organized`, `getAisleSuggestions`, `addFromAisleSearch`, and `addItem`; rewrote rename-propagation in `updateItemName` to mutate v2 `visible-items` + `library` instead of the legacy maps.
- `InsightsModal` now reads v2 `visible-items` + `categories` (category-name keys built from `categoryRaw[catId].name`) instead of `common-items` + encoded keys.
- `src/offlineStorage.js`: bumped `DB_VERSION` 1 → 2; new version deletes the `shoppingHistory`, `commonItems`, `lessCommonItems` IDB object stores via `deleteObjectStore`. Removed the corresponding save/load exports.
- `database.rules.json`: dropped `categories`, `common-items`, `less-common-items`, `shopping-history` rule blocks under `households/{hid}/`.
- Deleted the legacy Firebase nodes on the one migrated household.
- Deployed: DB rules + hosting. Build clean.
- Left in place as historical artifacts: the migration / reseed / merge scripts under `scripts/`.

### 2026-04-14 — Onboarding wrapper + aisle-level Shop/Add rendering
- **Shop / Add mode now groups by aisle, not category.** `organized` in `App.jsx` rebuilt to produce one entry per aisle, with list items + visible-item tiles from every category in that aisle flattened and alphabetized together. Category names are no longer visible in Shop/Add; the aisle header is the only label. Per-aisle autocomplete searches the union of visible + library across all categories in the aisle; novel typed adds route to the aisle's first category (quick-add tiles and library matches carry their specific `catId` through `addItem`). `addItem` gained an optional `categoryIdOverride` to avoid name-based inference when the caller already knows the target category.
- Legacy (pre-v2) households still render — each legacy category becomes a pseudo-aisle so the new render path stays unified. No visible change for them.
- **Onboarding wrapper built.** New `src/Onboarding.jsx`: welcome panel → `SuggestionsEditor` in `onboarding={true}` mode (reorder-on, framing copy) → "Looks good →" CTA. Gated on a new `households/{hid}/taxonomy/onboarding_completed` flag (validated in `database.rules.json`). `householdBootstrap.js` seeds the flag as `false`; `scripts/migrate-to-taxonomy-v2.cjs` seeds it as `true` for existing households so they don't get bounced through onboarding on next login. Completion writes the flag via `set()`. The onboarding screen replaces the entire app shell (no header/toolbar) while active.
- Verified `npm run build` clean. Not wired: a dev-only "replay onboarding" shortcut; deferred until we see how real new-household traffic behaves.

### 2026-04-14 — Review response (pass 1 follow-up)
- **Fixed #1 (rule rejects hide):** relaxed `taxonomy/categories/$categoryId/aisleId` validator to accept null in addition to strings. Hide writes set `aisleId: null` to make hidden-category state explicit rather than relying on implicit removal semantics.
- **Fixed #4 (orphan shopping-list items on delete):** `SuggestionsEditor` now accepts `getCategoryListItemCount`; the delete-confirm modal shows a "Can't delete yet" state when active shopping-list items still reference the category, and hides the destructive action. The App.jsx handler also defensively re-checks before issuing the delete (guards against stale-UI races).
- **Declined #2 (library filter on promote):** the current disjoint model (visible ∪ library, never both) matches the PRD §4 prose: "A visible item gets demoted to library by being deleted from the visible list — it doesn't disappear from autocomplete." Autocomplete is powered by `library`; a visible item doesn't need to be there because it's already a quick-add tile. Flagging here in case the user wants to re-open the model design — it's a one-line implementation swap either way.
- **#3 (Shop/Add still read legacy) stays open** — genuinely the remaining gap. Tracked as its own follow-up below. Requires a meaningful rewrite of the shopping-list rendering (group by aisle → v2 category; Add mode tiles from `visible-items`; autocomplete against `library`; and a bridge for shopping-list items that still carry legacy category name strings).

### 2026-04-14 — Taxonomy redesign: implementation pass 1
- Added `src/seedCatalog.js` (9 aisles, 52 categories, 273 items, 54 starred) — matches PRD §6 + §6a.
- Added `src/householdBootstrap.js` — seeds new households atomically via a single multi-path `update()`; gated on the `taxonomy/migrated` flag.
- Added `scripts/migrate-to-taxonomy-v2.cjs` — per-household migration from legacy `common-items` + `less-common-items` + `shopping-history` into the new shape. Supports `<hid>`, `--all`, `--dry-run`. Legacy paths left in place as a rollback safety net.
- Added `src/SuggestionsEditor.jsx` — self-contained component used by both Settings and (future) onboarding. Pure data props + callback API. Implements the PRD §5 interaction spec: aisle list with collapse/expand, inline rename, reorder mode (up/down arrows instead of drag — honest tradeoff vs. a new dependency), hide-then-delete for categories, Move-to-aisle sheet, global hidden-categories section, destructive-delete confirmation with item + library counts, visible-items chip editor with autocomplete against the library.
- Updated `database.rules.json` — new taxonomy paths under `households/{hid}/taxonomy/` with validation on aisle/category fields; legacy `categories` / `common-items` / `less-common-items` rules untouched.
- Wired into `src/App.jsx`: new Firebase listeners for all v2 paths (running alongside legacy listeners), 11 callback handlers for the editor, bootstrap call in the "New household" signup branch, Settings page swapped to render `SuggestionsEditor`.
- **Important namespace decision:** everything v2 lives under `households/{hid}/taxonomy/` rather than sibling top-level keys, to avoid any collision with the legacy `categories` / `common-items` paths during rollout. TDD §3 updated to match.
- Intentional simplification: reorder uses up/down arrow buttons, not long-press drag. Onboarding framing copy should say "use the arrows to reorder" when onboarding wrapper is built.
- **Not yet done (scoped to future sessions):**
  - Wire Shop / Add modes to read from `visibleItemsV2` + `libraryItemsV2` instead of `commonItems` + `lessCommonItems`. The editor writes v2; the shopping UI still reads legacy. Until wired, editor changes don't affect what tiles appear in Add mode.
  - Onboarding wrapper around `SuggestionsEditor` with welcome step + "Looks good →" landing in Shop mode.
  - Legacy cleanup script (delete `common-items` / `less-common-items` / legacy `categories` after successful migration window).
  - Run `migrate-to-taxonomy-v2.cjs --all --dry-run` against prod to validate mapping assumptions before any real writes.
- Build verified clean (`npm run build`); rules JSON validates.

### 2026-04-14 — Taxonomy redesign + onboarding (design only; no code yet)
- Decided on a 3-tier aisle → category → item taxonomy. Aisles and categories are both seeded but fully user-editable; items live under exactly one category.
- Replaced the two-tier *common / less-common* suggestion model with a single-tier **visible items** + a per-category **library** (autocomplete-only). The legacy `shopping-history` set merges into the library.
- Aisles are deletable outright (no hidden state), and reorderable — order represents the path the user walks the store. Reorder is gated behind a "Reorder aisles" mode (off by default in Settings, on by default during onboarding, with framing copy).
- Categories use a hide-then-delete model. Hidden categories live in a global page-bottom section, unattached to any aisle. Unhiding requires picking an aisle. Permanent deletion is destructive (loses visible items and library entries for that category) and surfaces an explicit confirmation.
- Onboarding becomes single-pass: welcome → editor (same component as Settings, with wizard chrome and reorder mode on by default) → land in Shop mode. No store selection step. Skip path always available.
- Seed catalog defined: 9 aisles, 52 categories, ~300 items with ~50 ★starred (visible-by-default); the rest seed into the library.
- PRD updated: §3 (item structure), §4 (single-tier visible + library), §5 (new Settings → Suggestions editor spec), §6 (3-tier taxonomy + behaviors), new §6a (onboarding flow).
- TDD updated: §3 (new Firebase schema with `aisles`, `categories`, `visible-items`, `library` keyed by category id), §4 (encoding now optional — categories keyed by stable ids), §6 (state variables), §7 (IndexedDB stores), §10 (security paths), §12 (migration plan from legacy paths).
- Implementation work items added under Should-Have. No code changes this session.

### 2026-04-15 — List view: aisle headers and expand/collapse defaults
- Removed the per-aisle badge count from Shop and Add list headers.
- Shop: aisles default collapsed; default expansion (aisles with at least one list item) applies when entering Shop, on first taxonomy load, and when the aisle set changes — not on every list edit, so manual expand/collapse persists while shopping.
- Add: entering Add still expands all aisles.

### 2026-04-15 — Shop: collapse aisle when it no longer has list items
- **Gap:** Default expansion was only recomputed on Shop entry / taxonomy changes. Clearing or moving the last item out of an aisle left `expandedCategories` stuck `true`, so empty aisles stayed open.
- **Change:** `src/App.jsx` — track `prevShopAisleHadItemsRef`; on list-only updates in Shop mode, set any aisle that went from “had items” to “no items” to collapsed (`false`). User can still tap to expand an empty aisle; switching to Add mode clears the snapshot as before.

### 2026-04-15 — Add mode: suggestion sheet name/quantity persist
- **Problem:** `ItemBottomSheet` only persisted name/quantity when `onNameChange` / `onQuantityChange` were attached; list rows got those from `openItemSheet`, but Add-mode suggestions used `openSuggestionSheet` without handlers — edits appeared possible but did not save.
- **Change:** `src/App.jsx` — `renameTaxonomySuggestionById` updates the suggestion’s display name in `taxonomy/visible-items` and/or `taxonomy/library` by stable item `id` (with same name dedupe as list renames); `updateSuggestionQuantity` writes household `quantity-defaults` keyed by suggestion id (same key `addItem` uses when adding from a tile). `openSuggestionSheet` wires both callbacks, resolves `categoryId` from `suggestion.catId` as fallback, and pre-fills quantity from defaults.

### 2026-04-14 — Add mode tap target consistency
- Changed add-mode suggestion rows so only the `+` button adds an item immediately
- Tapping the rest of a suggestion row now opens the item bottom sheet instead of bypassing the sheet
- Extended the bottom sheet with an explicit add action for suggestion rows so the add flow stays accessible from the sheet

### 2026-04-14 — Stable item identity for renames
- Added immutable `itemKey` to shopping-list rows so display name edits do not change item identity
- Keyed quantity defaults off `itemKey` instead of the mutable display name
- Normalized legacy list items on load so older records still work
- Updated docs to reflect that renaming only affects the display name

### 2026-04-14 — Optional quantity with reusable defaults
- Made shopping list quantity optional instead of mandatory
- Replaced inline list-view quantity controls with a subtle pencil edit affordance
- Moved quantity editing into the item bottom sheet with plaintext entry plus quick numeric presets
- Inline list rows now append quantity as `item - quantity` only when a value exists
- Cached last-used quantities by item name so re-adding an item reuses its most recent quantity

### 2026-04-14 — Add mode checkbox lockout
- Disabled item checkboxes while Add Mode is active so that mode remains focused on building the list rather than toggling completion state
- Updated PRD to document the Add Mode behavior change

### 2026-04-12 — Item bottom sheet + user display names
- Added `displayName` field to user records and signup flow (required "Your name" field on signup form)
- Existing users without a `displayName` see a one-time blocking modal on next login prompting them to set one
- Added `/households/{hid}/members/{uid}` directory: stores `{ displayName, email }` per member, readable by all household members (solves uid→name resolution without opening global `/users` reads)
- Extended shopping list item shape: `{ ..., addedBy: uid, addedAt: timestamp }` — new items carry attribution metadata
- Built `ItemBottomSheet` component: tap an item name to see a slide-up sheet with "Added by {name} {time}" and "Last purchased {relative time}" (derived from item-events `checked` actions, fetched on-demand)
- Voice MCP: `add_resolved_items` now accepts optional `addedByUid` field, threaded through `resolution.js → firebaseRealtime.js`. Item events use the passed uid instead of hardcoded `'voice-mcp'`.
- Database rules updated: `displayName` validated on `/users/{uid}`, `members` directory added under households with per-uid write gating
- PRD + TDD updated with new item fields, members directory, and bottom sheet feature

### 2026-04-11 — Tier 0/1 analytics: item event logging
- Added `/households/{hid}/item-events/{pushId}` event stream — schema: `{ts, uid, name, category, action, source?, qty?}`. Push IDs give time-ordering for free.
- Wired `addItem`, `toggleDone`, `removeItem` in `App.jsx` to emit events via a fire-and-forget `logItemEvent` helper. `addFromSearch` passes `source: 'typed'`; quick-add taps default to `source: 'quickAdd'`. Removed events only emitted for unchecked items (clearing checked items doesn't need a separate signal — `checked` already represents the buy).
- Voice MCP worker is a known gap: it writes to `shopping-list` directly and currently does not emit events. To be addressed before voice traffic grows.
- Tier 1 aggregation in new `src/itemAnalytics.js` (pure functions): `buildItemStats`, `topPurchased`, `dormantQuickAddCandidates`, `promotionCandidates`, `userContributions`, `eventSummary`.
- Surfaced via Admin Panel → "View Household Insights" modal. Read-only inspection — no end-user UX built yet (deferred until we see real data and decide on the UX patterns from the prior brainstorm).
- Added per-event validation rules in `database.rules.json`; deployed via `firebase deploy --only database`.
- Voice MCP worker (`voice-mcp/src/firebaseRealtime.js`) now emits an `added` event per item with `source: 'voice'` and `uid: 'voice-mcp'` inside `appendItemsToShoppingList`. Fire-and-forget; list writes never block on event logging. **Worker NOT yet redeployed** — run `wrangler deploy` in `voice-mcp/` to ship. Existing tests pass (10/10).
- No retention policy yet; defer until events accumulate.

### 2026-04-10 — Account deletion + data cleanup
- Added `DeleteAccountModal` component with password re-authentication (Firebase requires re-auth before `deleteUser`)
- Admin deletion: removes global invite code index entries → deletes household node → deletes user record → deletes Firebase Auth account → clears IndexedDB cache
- Non-admin deletion: removes user record + Auth account only; household and its data persist for remaining members
- Warning copy differs by role so users understand impact before confirming
- "Delete Account" added to the hamburger menu (below Sign Out, smaller/lighter to reduce accidental taps)
- Deletion order matters: household/user record deleted while auth is still valid, `clearCachedUser()` called before `deleteUser()` so `onAuthStateChanged(null)` correctly transitions to login screen

### 2026-04-10 — Security hardening: invite code isolation and log access
- Fixed `/inviteCodes/{code}` write rule: writers must be a member of the household referenced in the code (both for creates and deletes). Zero trust between households.
- Removed in-app log viewer from Admin Panel UI. Logging backend unchanged — logs still written to Firebase for debugging via console. In multi-tenant, customers shouldn't have access to log data; developer uses Firebase console directly.
- Within a household, any member can manage invite codes (high-trust model); admin distinction is UI-only for this action.

### 2026-04-10 — Multi-household refactor (primary architectural blocker)
- Migrated live data to `/households/{householdId}/...` via one-time Node script (`scripts/migrate-to-households.cjs`)
- All Firebase reads/writes now household-scoped; `householdId` loaded from user record after auth
- Admin status derived from `household.adminUid === user.uid` (Firestore admins collection retired)
- Signup flow: explicit "New household" / "Join with code" toggle — no more first-user magic
- Invite codes: 16 chars, stored at `/households/{householdId}/inviteCodes/{code}` (for admin panel) + `/inviteCodes/{code}` global lookup index (publicly readable, for signup validation without auth)
- Database rules rewritten: household data gated on user's `householdId`, global invite code index publicly readable
- Deployed to production

### 2026-04-10 — Repo strategy and licensing decisions
- Decided on single repo for both single-household and multi-household work (no divergence, no cherry-picking)
- Switched license from MIT to Elastic License 2.0 (ELv2): source available, personal use allowed, commercial hosting prohibited
- Portfolio goal served by readable code + hosted 30-day free trial; employers don't need to self-deploy

### 2026-04-10 — Seed-only defaults; categories stored in Firebase
- `CATEGORIES` and `DEFAULT_ITEMS` constants are now seed values only
- On first setup (empty DB), both are written to Firebase (`/categories` and `/common-items`) by the Firebase listeners
- All subsequent sessions read from Firebase (not from code constants)
- `categories` is now a React state variable; all rendering uses state, not the constant
- `categories` cached in IndexedDB alongside other data for offline support
- `/categories` path added to database security rules
- Existing households unaffected — their data is already in Firebase and takes precedence

### 2026-04-10 — Public repo readiness work
- Added `LICENSE` (MIT)
- Rewrote `README.md` for self-hosting audience: Firebase setup steps, first-use flow, customization instructions
- Audited git history — clean, no secrets ever committed
- Genericized `CATEGORIES` and `DEFAULT_ITEMS` in `src/App.jsx` (neutral defaults, comments directing users to edit)
- Added internal planning docs to `.gitignore`; un-tracked `AGENTS.md`, `CLAUDE.md`, `LOGGING.md` from git index
- **Public repo readiness checklist: complete**

### 2026-04-11 — Voice MCP: household-scoped RTDB paths
- Root cause: after multi-household migration, the web app listens on `households/{householdId}/fridge-notes` (and other keys under that prefix), but the Cloudflare MCP worker still used root paths via the REST API, so `set_fridge_notes` succeeded while the UI showed stale household data.
- Fix: `voice-mcp/src/firebaseRealtime.js` prefixes all RTDB reads/writes with `households/{FIREBASE_HOUSEHOLD_ID}/` when that env var is set; documented in README and `.dev.vars.example`. Operators must set `FIREBASE_HOUSEHOLD_ID` (Wrangler secret in prod) to the household’s ID.

### 2026-04-14 — IndexedDB failure handling (new-user / cleared-site-data testing)
- **Problem:** When IndexedDB could not open (e.g. `UnknownError: Internal error opening backing store`), the logger retried on every log line and emitted two `console.error` messages each time, flooding the console. Offline storage had the same pattern on repeated saves.
- **Change:** Session-level circuit breaker in `src/logger.js` and `src/offlineStorage.js`: after the first open or persistent write failure, skip IndexedDB for the rest of the tab session and emit at most one `console.warn` with context. `initOfflineDB()` now resolves to `null` on failure; `App.jsx` logs whether the offline DB initialized.

### 2026-04-14 — Logger: Firebase flush rejected `undefined` in log payloads
- **Problem:** `save()` logged `itemCount: undefined` for non-array writes; Firebase RTDB `push()` rejects any `undefined` property, so batched remote logging failed with `value argument contains undefined in property '...data.itemCount'`.
- **Change:** `src/App.jsx` — only include `itemCount` when the saved value is an array (conditional spread).

### 2026-04-15 — Item detail sheet: spacing before metadata
- `ItemBottomSheet` (`src/App.jsx`): added `mt-14` between the quantity field and the “Added by” / “Last purchased” block so mobile bottom sheet and desktop modal both have a clearer visual break (roughly one field row of space).

### 2026-04-15 — Taxonomy: merge-only category removal (no hide / no delete category)
- **Change:** Removed **Hide category**, the hidden-categories section, **Unhide**, and **Delete permanently** for categories. **Merge into…** is the only way to remove a category while keeping suggestions + library data. `App.jsx` drops `taxoHideCategory`, `taxoUnhideCategory`, `taxoDeleteCategory`; `taxoDeleteAisle` no-ops if the aisle still has categories (and no longer nulls category rows locally). One-time migration: categories that were hidden or lost an aisle id are reassigned to the first aisle with `hidden: false`. `CLAUDE.md` taxonomy notes updated.

### 2026-04-15 — Settings Shortcuts: merge category into sibling
- **Change:** `SuggestionsEditor` category overflow menu adds **Merge into…** (disabled when the aisle has only one category). Bottom sheet lists other categories in the same aisle; choosing one moves all visible + library entries into the target (case-insensitive name dedup with the target kept), reassigns shopping-list rows to the target category, and removes the source category. `App.jsx`: `taxoMergeCategory`. `Onboarding` passes `onMergeCategory` for parity.

### 2026-04-15 — Post-login navigation: Shop mode (not Account)
- **Problem:** After sign-out from the Account page, signing back in showed Account again because `currentPage` / `quickAddMode` live in `App` state while `<Login />` is only an early return — state was not cleared.
- **Change:** `src/App.jsx` — `handleLoginSuccess` sets `currentPage` to `list` and `quickAddMode` to false; same reset on `handleSignOut`; both `<Login />` entry points use `handleLoginSuccess`.

### 2026-04-15 — Purchase history: quantity matches list/add styling
- **Change:** `item-events` optionally stores `quantityLabel` (trimmed quantity string, max 100 chars) alongside numeric `qty`; Firebase rules updated. Purchase history renders quantity inline after the item name (`ml-1 text-gray-400 font-medium`), same pattern as the shopping list add row. Legacy events without a label still show a plain numeric suffix when `qty > 1` (no `x` prefix). `voice-mcp` includes `quantityLabel` on added events when a non-empty quantity string is present.

### 2026-04-15 — Item sheet: name/quantity edits persist reliably
- **Problem:** `ItemBottomSheet` compared drafts to stale `item` props (`selectedItem` is a snapshot). After one successful save, a second edit could be skipped (e.g. clearing quantity) or mis-detected. `updateItemName` also ran taxonomy updates and `save()` inside a `setList` functional updater (impure in React).
- **Change:** `src/App.jsx` — last-committed refs for name/quantity in the sheet; `computeRenameOutcome` + side effects after `setList` for renames; `snapshotShoppingListToArray` for RTDB list snapshots; `save()` no-op with log when `householdId` is missing; `normalizeListItem` stable `itemKey` when `id` is `0`. `database.rules.json` — allow `quantity-defaults` (was blocked by `$other: false`, so default quantity writes failed).

### 2026-04-15 — Aisle names: Title Case in data, ALL CAPS in UI
- **Seed / migration scripts:** `SEED_AISLES` names in `src/seedCatalog.js` (and mirrored `scripts/migrate-to-taxonomy-v2.cjs`, misc aisle in `scripts/reseed-with-legacy.cjs`) are now Title Case; MISC aisle label stored as `Misc`.
- **Display:** `src/aisleDisplay.js` exports `formatAisleNameForDisplay` (`.toUpperCase()`); list page aisle headers and placeholders use it; `SuggestionsEditor` shows uppercase for aisle labels, move-to-aisle list, and delete confirm, while inline rename still edits the stored string.
- **Writes:** `taxoRenameAisle` / `taxoAddAisle` trim names before save. Existing households keep prior strings until edited or re-seeded.

### 2026-04-15 — Add mode: library backfill + quick-delete from autocomplete
- **Library backfill:** When any item is added to the shopping list via `addItem`, if it resolves to a taxonomy `categoryId` and the name is not already in that category’s visible (quick-add) or library set, it is appended to `taxonomy/library/{catId}` (sorted by name). Typed/custom names therefore become autocomplete-only library entries without promoting to suggestions.
- **Autocomplete UI:** Add-mode aisle search rows that come from the library show an **X** control to remove that entry from the library only; visible (suggestion / quick-add) matches do not show X. The free-text “add as typed” row has no X.

### 2026-04-15 — Seed taxonomy: sentence-case category names
- `src/seedCatalog.js` — `SEED_CATEGORIES` display names use sentence case (first word and acronyms like OTC capitalized; remaining words lowercase, including after `&`). New households pick this up from bootstrap; existing households are unchanged.

### 2026-04-15 — Settings Shortcuts: single expanded aisle
- **Change:** `SuggestionsEditor` accepts optional `accordionAisles`; when true, expanding an aisle collapses any other expanded aisle (tapping the open aisle still collapses it). Enabled for Settings only; onboarding wizard keeps independent multi-expand behavior.

### 2026-04-15 — Shop mode: aisle expand defaults match list grouping
- **Problem:** `hasItemsInAisle` (used when entering Shop / re-applying defaults) fell back to category **name** even when `categoryId` was set but did not belong to that aisle. Duplicate category names across aisles (or id vs string mismatch) could mark many or all aisles as “having items,” so Add→Shop expanded every aisle despite the UI only showing list rows in the correct aisles.
- **Change:** `src/App.jsx` — align `hasItemsInAisle` with `organized`’s `aisleListItems` filter: if `getItemCategoryId` returns a value, only `categoryIdSet.has(cid)` counts (no name fallback).

### 2026-04-15 — Shop mode: aisle expansion after switching accounts
- **Problem:** After signing out, into another household, out again, and back into the original account, Shop showed every aisle collapsed even when aisles had list items. Add→Shop reapplied defaults and fixed it. `shopAisleDefaultsKeyRef` still held the *other* household’s aisle key, so the “aisle set changed” branch merged expansion state and defaulted unknown aisle ids to collapsed instead of re-running the “enter Shop” `hasItemsInAisle` defaults.
- **Change:** `src/App.jsx` — `shopAisleDefaultsHouseholdIdRef`: when `householdId` changes, reset `shopAisleDefaultsKeyRef` and `prevShopAisleHadItemsRef` so the next sync uses the same full default expansion as first load.

### 2026-04-15 — Settings Shortcuts: category item preview capped at five
- **Change:** `SuggestionsEditor` category subtitle lists at most five item names (shortcuts first, then library, same dedupe as before); if the category has more, the line ends with `, ...`.

### 2026-04-15 — Onboarding step 2: single header + Done CTA
- **Change:** Removed duplicate outer title/instructions and the extra bottom button from `Onboarding.jsx` (wizard chrome in `SuggestionsEditor` already provides step label, copy, and primary action). Renamed wizard primary button from “Looks good →” to **Done**.

### 2026-04-15 — Seed catalog: Frozen meals library
- **`src/seedCatalog.js`:** Add frozen mac and cheese and chicken pot pie (new households only).

### 2026-04-15 — Seed catalog: Deli prepared library
- **`src/seedCatalog.js`:** Removed generic `dips`; added guacamole, tzatziki, spinach artichoke dip, olive tapenade (new households only).

### 2026-04-15 — Seed catalog: fewer shortcuts + naming
- **`src/seedCatalog.js`:** Demoted listed items to library; **chuck roast** → **beef chuck**; **paper towel** → **paper towels**, **trash bag** → **trash bags** (new households only).

### 2026-04-15 — Seed catalog: trims (beef, pork, yogurt, sweeteners, pastries)
- **`src/seedCatalog.js`:** Drop beef sausage, turkey kielbasa, generic pork sausage, drinkable yogurt / yogurt cups / tubes, stevia, cakes & pies; rename beef franks → beef hotdogs.

### 2026-04-15 — Seed catalog: packaged + bakery + household overhaul
- **`src/seedCatalog.js`:** Frozen produce through baby reworked (specific SKUs, plural names where requested, drops/renames per review). **International** replaced with **Latin American**, **East Asian**, **Southeast Asian**, and **Kosher** grocery categories; **tahini** → condiments; **tortilla chips** → snacks; **salsa** only in deli prepared. **Bread & rolls** + **Tortillas & flatbreads** merged into **Breads & tortillas**. Broths → soups; OTC list per user; etc.
- **`src/categoryClassifier.js`:** Tier keys for new categories; packaged keyword list updated.

### 2026-04-15 — Seed catalog: Eggs library
- **`src/seedCatalog.js`:** Add egg substitute (new households only).

### 2026-04-15 — Seed taxonomy: Dairy & Eggs + butter + deli prepared placement
- **`src/seedCatalog.js`:** Aisle slug `deli-dairy-eggs` → `dairy-eggs`, name **Dairy & Eggs**. Category `butter-spreads` → `butter-dairy-spreads` (**Butter & dairy spreads**). **Deli prepared** under **Prepared Foods & Bakery**; seed **hummus** moved to `deli-prepared`.
- **`src/categoryClassifier.js`:** `butter-dairy-spreads` / `deli-prepared` tier keys and comments updated.
- **`scripts/migrate-to-taxonomy-v2.cjs`**, **`scripts/reseed-with-legacy.cjs`:** `SEED_AISLES` / `LEGACY_TO_AISLE` use `dairy-eggs`.

### 2026-04-15 — Seed catalog: Yogurt library
- **`src/seedCatalog.js`:** Added vanilla/strawberry yogurt, whole milk and low-fat yogurt, skyr, kefir, drinkable yogurt, yogurt tubes (new households only).

### 2026-04-15 — Seed catalog: Cheese flavor + form
- **`src/seedCatalog.js`:** Cheese library expands sliced/shredded/grated lines; drops generic `sliced cheese`; adds fresh mozzarella, grated parmesan, sliced swiss, sliced provolone, shredded Mexican blend (new households only).

### 2026-04-15 — Seed catalog: Plant-based protein trim
- **`src/seedCatalog.js`:** Removed Beyond burger, Impossible ground, and veggie sausage (new households only).

### 2026-04-15 — Seed catalog: Deli meat naming
- **`src/seedCatalog.js`:** Renamed `turkey slices` → `sliced turkey`, `ham slices` → `sliced ham` (new households only).

### 2026-04-15 — Seed catalog: Seafood trim
- **`src/seedCatalog.js`:** Removed tuna steak, crab legs, lobster tails, and calamari from seafood seed (new households only).

### 2026-04-15 — Seed catalog: Seafood shortcuts + library
- **`src/seedCatalog.js`:** Shrimp promoted to shortcut with salmon; library adds halibut, trout, catfish, mahi mahi, red snapper, scallops, crab legs, lobster tails, mussels, clams, oysters, calamari (new households only).

### 2026-04-15 — Seed catalog: non-pork sausage library
- **`src/seedCatalog.js`:** Beef: beef sausage, beef franks. Poultry: chicken sausage, turkey sausage, turkey kielbasa. Plant-based protein: plant-based sausage, veggie sausage (new households only).

### 2026-04-15 — Seed catalog: Pork sausage library
- **`src/seedCatalog.js`:** Keep generic sausage; add Italian sausage, breakfast sausage, bratwurst, chorizo, and kielbasa (new households only).

### 2026-04-15 — Seed catalog: Poultry library
- **`src/seedCatalog.js`:** Add chicken drumsticks (new households only).

### 2026-04-15 — Seed catalog: Beef shortcuts, library, patties
- **`src/seedCatalog.js`:** Shortcuts add chuck roast and brisket; library adds flank steak, skirt steak, beef short ribs, and hamburger patties (new households only).

### 2026-04-15 — Seed catalog: Vegetable shortcuts vs library
- **`src/seedCatalog.js`:** Garlic, bell peppers, spinach, broccoli, and cucumbers demoted to library (new households only).

### 2026-04-15 — Seed catalog: Fruit shortcuts vs library
- **`src/seedCatalog.js`:** Lemons and avocados demoted to library; oranges promoted to shortcuts (new households only).

### 2026-04-15 — Account: Household Insights + invite wording
- **Account page:** “Household Insights” is a first-level action (opens the same modal as before) for any signed-in user with a `householdId`; “Admin Panel” row renamed to **Invite Household Members** (admins only).
- **Modal:** Former admin modal title/subtitle updated to **Invite Household Members** / invitation-code copy; insights entry removed from inside that modal (`src/App.jsx`).

### 2026-04-16 — Purchase History: show aisle (not category)
- **`src/App.jsx`:** Purchase History resolves each row’s **aisle** from current taxonomy (`categoryId` on item-events, else category name → aisle). Uses `formatAisleNameForDisplay` for the right-hand label; falls back to stored category label only when no taxonomy match. Item-events fetch stays keyed on `householdId`; labels refresh via `useMemo` when taxonomy loads.

### 2026-04-16 — Bugfix: new household showed all categories under Produce
- **Cause:** IndexedDB `taxonomyV2` was global (not household-scoped). Stale categories from another household had `aisleId` keys that did not exist in the new household’s aisles map; the legacy “orphan category → first aisle” migration then reassigned **every** category to Produce (54+ in UI).
- **`src/App.jsx`:** Persist `householdId` in the taxonomy snapshot; hydrate from IndexedDB only when `blob.householdId === householdId`. Guard the legacy migration when no category references any known aisle but many categories exist (stale cross-household graph).
- **`src/offlineStorage.js`:** Document `householdId` on the saved taxonomy object.

### 2026-04-16 — Purchase semantics (2h check/uncheck pairing)
- **`src/purchaseSemantics.js`:** Central model — an `unchecked` within two hours of the latest unmatched `checked` voids that check (per `itemKey` or legacy name+category).
- **`src/itemAnalytics.js`:** `buildItemStats`, `promotionCandidates`, `userContributions`, and `eventSummary` count only **effective** checks (promote/demote and insights stay aligned).
- **`src/App.jsx`:** Purchase History and bottom-sheet “last purchased” use the same semantics; shop toggles log optional `itemKey` on check/uncheck.
- **`database.rules.json`:** Allow optional `itemKey` on item-events writes.

### 2026-04-16 — Account: delete action bottom-aligned
- **`src/App.jsx`:** Account page uses a full-viewport-height column so **Delete Account** sits at the bottom with a top divider and generous bottom padding (including `safe-area-inset-bottom`) to separate it from Sign out and reduce accidental taps near the screen edge.

### 2026-04-17 — Legal launch reminder (PRODUCTIZATION + CLAUDE + source)
- **`PRODUCTIZATION.md`:** Blockquote under Must-Have + new unchecked **Legal: final Privacy + ToS pass before public or app-store launch** (counsel, contact, entity, governing law, accuracy vs production).
- **`CLAUDE.md`:** Session-start reminder that this checklist item must be completed before public/app-store launch.
- **`src/LegalPages.jsx`:** File header comment pointing to the same checklist.

### 2026-04-17 — Privacy Policy + Terms of Service
- **`src/LegalPages.jsx`:** New in-app **Privacy Policy** and **Terms of Service** (effective date 2026-04-17); covers Firebase Auth/RTDB, optional Analytics, IndexedDB, household sharing, logs, operator/self-host framing.
- **`src/App.jsx`:** `AuthLoginScreen` wraps login + legal sub-views; `loginLegalView` state; footer on login (“By continuing…”). **Account** page links open the same documents with back to Account.

### 2026-04-17 — Logging: 21-day retention, weekly remote cleanup marker
- **`src/logger.js`:** `LOG_RETENTION_DAYS` 21; Firebase session cleanup at most every 7 days using `get(users/{uid}/logsLastRemoteCleanupAt)` before any full `get(logs/{uid})`; after cleanup, `set(logsLastRemoteCleanupAt, Date.now())`. IndexedDB still pruned each session.
- **`database.rules.json`:** `users/{uid}/logsLastRemoteCleanupAt` (number).
- **`LOGGING.md`**, **`CLAUDE.md`**, **`PRD.md`**, **`TDD.md`**, **`AdminLogViewer.jsx`**, **`LogAnalytics.jsx`:** Copy and date-range options aligned with 21 days.

### 2026-04-17 — Item events: monthly shards + index + live current month
- **Schema:** `households/{hid}/item-events-by-month/{YYYY-MM}/{pushId}` for new writes; `item-events-index/{YYYY-MM}/updatedAt` for per-month staleness; legacy flat `item-events` still **read** and merged for existing data.
- **`src/itemEventsSharding.js`:** `pushHouseholdItemEvent`, `getHouseholdItemEventsMerged` (parallel month `get`s + IndexedDB cache when `updatedAt` matches), `eventMonthKey` (local calendar month).
- **`src/App.jsx`:** `onValue` on current month bucket (rollover interval); Insights, Purchase History, Add-mode analytics, and last-purchased use merged loader with live month snapshot.
- **`src/offlineStorage.js`:** `loadItemEventsBucketCache` / `saveItemEventsBucketCache` (META store).
- **`database.rules.json`:** Rules for `item-events-by-month` and `item-events-index`.
- **`voice-mcp/src/firebaseRealtime.js`:** Voice `added` events POST to monthly path; PATCH index `updatedAt`.

### 2026-04-17 — List UI: revert coral row tint; Shop names coral again
- **`src/App.jsx`:** Add-mode quick-add / pin-edit tile rows use `hover:bg-gray-50` instead of a fixed `#FFF5F5` fill; pin icon hover uses gray instead of rose. **Shop** list rows: item names back to `#FF7A7A` when not done (Add-mode list rows stay neutral gray). Quick-add suggestion names use coral again (aligned with `main`).

### 2026-04-17 — Design review pass 10: pin-edit mode, density nudge, B1 card
- **`src/App.jsx`:** Add **pin-edit mode** (Edit pins + Done) from Add mode only — replaces Shop/Add chrome on mobile and desktop, hides per-aisle search, same aisle row order as Add with pin-only row chrome (Firebase pin/unpin via shared promote helper + `removeSuggestionEverywhere`). B1 entry highlights dormant shortcuts with an amber ring; **Done** applies implicit **keep** dismissals for still-pinned dormant items. **Density nudge** card when an aisle has more than 12 pinned shortcuts (`density::{aisleId}` dismissals with +4 escalation). **B1** card revised to Review / Not now (batch `not-now` dismissals per dormant item).

### 2026-04-17 — Auth: minimal RTDB read for admin
- **`src/App.jsx`:** On sign-in, admin is derived from `get(households/{id}/adminUid)` instead of downloading the entire household subtree (saves duplicate bulk download before per-path listeners attach).

### 2026-04-17 — Firebase: production deploy (hosting + database)
- **`npm run build`** then **`firebase deploy`** to `kao-family-shopping-list`: shipped current `dist/` (item-events sharding, logging retention/cleanup, adminUid read, etc.) and re-released RTDB rules. Hosting: https://kao-family-shopping-list.web.app

### 2026-04-17 — Shop/Add list rows: tap opens details (caret), not left control
- **`src/App.jsx`:** Tapping the list row (or quick-add suggestion row) opens the same bottom sheet as the chevron; check/uncheck, remove-from-list, and add-from-tile remain explicit taps on the left control only.

### 2026-04-17 — Item bottom sheet: stay open on taxonomy move / unpin
- **`src/App.jsx`:** List-item and Add-suggestion `suggestionConfig.onMove` no longer calls `setSelectedItem(null)`; taxonomy handlers rebuild config with the new category id so the sheet stays open. After **Unpin**, the sheet keeps **Pin** via refreshed `promoteToShortcut`. **Unpin** button uses `finally` so loading state clears when the sheet stays mounted.

### 2026-04-17 — List item sheet: edit taxonomy for library-only catalog matches
- **`src/App.jsx`:** `findLibraryMatchForListItem` mirrors shortcut lookup against `libraryItemsV2`. List rows whose name exists only in a category’s **library** (not visible shortcuts) get the same expandable aisle/category controls as pinned items; **Pin** is shown instead of **Unpin** until promoted. Promotion hint still suppressed only when a **visible** shortcut exists.

### 2026-04-17 — Header: stable title when sync/offline pill appears
- **`src/App.jsx`:** Mobile header wraps the status pill in a fixed `min-w` slot (`lg:min-w-0` on desktop) so the flex-centered **Shopping List** title no longer shifts when the pill mounts or unmounts.

### 2026-04-17 — Add mode: per-aisle autocomplete not clipped by aisle card
- **`src/App.jsx`:** Aisle cards no longer use `overflow-hidden` on the outer wrapper (it clipped the absolute-positioned suggestion list). Rounded corners: collapse header uses `rounded-2xl`, expanded header `rounded-t-2xl`; list / empty / dormant block sits in an inner `overflow-hidden rounded-b-2xl` wrapper. Per-aisle search row uses `relative z-20` and the dropdown `z-30` so it stacks above following rows when it overlaps.

### 2026-04-16 — Seed catalog: Fruit / Veggies aisles, Asian grocery rows
- **`src/seedCatalog.js`:** Replaced single **Produce** aisle with **Fruit** and **Veggies**; **Vegetables** display name (slug `vegetable` unchanged); **Fresh herbs** under Veggies. Packaged Foods: merged **East Asian** + **Southeast Asian** into **East & Southeast Asian groceries** (`east-southeast-asian-foods`); added **South Asian groceries** (six library items: basmati rice, ghee, red lentils, tikka masala simmer sauce, garam masala, papadums).
- **`src/categoryClassifier.js`:** Tier map + keyword `veggies` for renames.
- **`scripts/migrate-to-taxonomy-v2.cjs`**, **`scripts/reseed-with-legacy.cjs`:** `SEED_AISLES` / `LEGACY_TO_AISLE` aligned with new aisle slugs (`fruit` / `veggies`; legacy `PRODUCE` → `fruit`, `RANCH 99…` → `veggies`).

### 2026-04-10 — Initial productization planning
- Discussed what's needed to go from single-household personal app to public multi-household product
- Identified multi-household data isolation as the primary architectural blocker (all data currently shared at root level)
- Mapped cost model on Firebase Blaze; PWA caching is main lever for download cost reduction
- Reviewed security gaps in current rules; invite code enumeration and self-reported admin flag are top concerns
- Evaluated business model options; leading toward free tier + freemium
- Evaluated iOS vs Android distribution; defer iOS App Store, pursue PWA + Android TWA
- **No code changes made this session; planning only**
