# Technical Design Document (TDD)

> **Status:** Living document — updated as architecture evolves
> **Last updated:** 2026-04-16 (navigation redesign; item-events `itemKey`; effective purchase aggregation via `purchaseSemantics.js`)

---

## 1. Architecture Overview

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **UI Framework** | React 18 | Component model, hooks for state, wide ecosystem |
| **Build Tool** | Vite 5 | Fast HMR, ESM-native, simple config |
| **Styling** | Tailwind CSS 3 | Utility-first, no CSS files to manage, responsive breakpoints |
| **Font** | Plus Jakarta Sans (Google Fonts) | Clean, modern sans-serif suitable for mobile UI |
| **Auth** | Firebase Auth (email/password, Google, Apple) | Managed auth with token refresh, persistence options; SSO via `signInWithPopup` on web |
| **Primary Database** | Firebase Realtime Database | Real-time listeners (`onValue`), simple JSON model, offline SDK support |
| **Secondary Database** | Cloud Firestore | Server-side query support for admin role checks |
| **Offline Storage** | IndexedDB (raw API) | Structured client-side storage for offline-first behavior |
| **PWA** | vite-plugin-pwa + Workbox | Service worker generation, precaching, runtime caching |
| **Icons** | lucide-react | Tree-shakeable SVG icons |
| **Hosting** | Firebase Hosting | Integrated with Firebase services, CDN, SSL |

### Dependency Philosophy

Minimal dependencies. No state management library (Redux, Zustand), no routing library (React Router), no form library. React hooks handle all state. Navigation is a simple `currentPage` state variable. This keeps the bundle small and reduces upgrade burden.

---

## 2. Single-File Component Architecture

### Decision

The entire React application lives in a single file: `src/App.jsx` (~2000+ lines).

### Rationale

- **Simplicity** — no import/export ceremony; everything is in one place
- **Searchability** — Cmd+F finds anything instantly
- **Iterative development** — the app was built incrementally in conversation-driven sessions; splitting files adds overhead without clear benefit at this scale
- **Shared state** — most components need access to the same state (list, user, categories, mode); a single file avoids prop drilling or context boilerplate

### Tradeoffs

- File is large and requires discipline to navigate
- Not suitable if team grows beyond 1-2 developers
- No code splitting at the component level (but Vite handles chunk splitting for dependencies)

### Exceptions

These concerns are extracted into separate files:
- `src/firebase.js` — Firebase initialization (shared across modules)
- `src/offlineStorage.js` — IndexedDB operations (complex async logic, reusable)
- `src/logger.js` — Logging system (standalone concern, used across modules)
- `src/DebugPanel.jsx` — Debug panel UI (admin-only, conditionally rendered)
- `src/AdminLogViewer.jsx` — Log viewer UI (admin-only, conditionally rendered)
- `src/LogAnalytics.jsx` — Log analytics dashboard (admin-only, conditionally rendered)

### Components within App.jsx

| Component | Purpose |
|---|---|
| `Login` | Authentication form (sign in, sign up, password reset) |
| `AdminPanel` | Invitation code management, log access |
| `App` (default export) | Main application shell, shopping list, edit suggestions |

---

## 3. Data Model

### Why Two Databases?

The app uses **Firebase Realtime Database** for most data and **Cloud Firestore** for admin records only.

**Realtime Database** was chosen for shopping data because:
- Real-time listeners (`onValue`) provide instant sync with minimal code
- Simple JSON tree model matches the app's data shape
- Lower cost for frequent small read/write operations (shopping list updates)

**Firestore** is used only for the `admins` collection because:
- Firestore security rules can query `exists()` on documents, enabling server-side admin checks
- Realtime Database security rules cannot query sibling nodes as flexibly
- The `isAdmin()` helper in Firestore rules checks `exists(/databases/$(database)/documents/admins/$(request.auth.uid))`

This is a pragmatic split, not an architectural preference for polyglot persistence.

### Realtime Database Schema

```
/
├── users/{uid}
│   ├── email: string
│   ├── displayName: string
│   ├── createdAt: number (timestamp)
│   └── isFirstUser: boolean
│
├── inviteCodes/{codeId}
│   ├── code: string (8-char uppercase alphanumeric)
│   ├── expiresAt: number (timestamp, 7 days from creation)
│   ├── used: boolean
│   ├── usedBy: string (email, set when used)
│   └── usedAt: number (timestamp, set when used)
│
├── households/{householdId}/shopping-list: Array<{id, itemKey, name, category, quantity?, done, addedBy?, addedAt?}>
│
├── households/{householdId}/meta/quantityDefaults: Record<string, string>
│
├── households/{householdId}/taxonomy/
│   ├── migrated: boolean (flag — bootstrap/migration ran)
│   ├── migrated_at: number (server timestamp)
│   ├── aisles/{aisleId}: { name, order }
│   │   (order is the user-controlled walk-the-store ordering; persisted, not derived)
│   ├── categories/{categoryId}: { name, aisleId | null, hidden: boolean }
│   │   (aisleId is null iff hidden=true; hidden categories live in a global page-bottom section)
│   ├── visible-items/{categoryId}: Array<{id, name}>
│   │   (items rendered as quick-add tiles in Add mode for that category)
│   └── library/{categoryId}: Array<{id, name}>
│       (autocomplete pool for that category — seed unstarred + history + previously-removed items)
│
│   All v2 taxonomy data lives under a single `taxonomy/` namespace so it
│   cannot collide with the legacy `categories`, `common-items`, and
│   `less-common-items` siblings during the rollout window.
│
├── households/{householdId}/members/{uid}
│   ├── displayName: string
│   └── email: string
│
├── households/{householdId}/item-events/{pushId}
│   ├── ts: number (ms since epoch)
│   ├── uid: string (who performed the action)
│   ├── name: string (lowercased)
│   ├── category: string
│   ├── action: "added" | "checked" | "unchecked" | "removed"
│   ├── source?: "typed" | "quickAdd"  (only set for "added")
│   └── qty?: number
│
└── logs/{userId}/{sessionId}/{logId}
    ├── timestamp: number
    ├── sessionId: string
    ├── level: "debug" | "info" | "warn" | "error"
    ├── category: string
    ├── message: string
    ├── data: object
    ├── url: string
    ├── userAgent: string
    └── serverTimestamp: ServerValue.TIMESTAMP
```

### Firestore Schema

```
/admins/{uid}
├── email: string
└── createdAt: number (timestamp)
```

### Data Sharing Model

Shopping list, history, and item suggestions are **global** — all authenticated users share the same data. There is no per-user data isolation for shopping data. This is intentional: the app serves a single household.

User records and logs are **per-user** (keyed by UID).

---

## 4. Category Name Encoding

### Problem

Firebase Realtime Database key paths cannot contain: `.`, `#`, `$`, `[`, `]`, `/`

Categories are now user-editable, so display names may legitimately contain any of those characters. To avoid encoding entirely, `visible-items` and `library` are keyed by **category id** (a stable push-id), not by name. The encoding helpers below remain for legacy data and for any debugging path that uses display names.

### Solution

`encodeCategory()` and `decodeCategory()` functions perform bidirectional string replacement:

| Character | Encoded as |
|---|---|
| `/` | `___SLASH___` |
| `.` | `___DOT___` |
| `#` | `___HASH___` |
| `$` | `___DOLLAR___` |
| `[` | `___LBRACKET___` |
| `]` | `___RBRACKET___` |

### Why not URL encoding or Base64?

The verbose placeholder approach was chosen for readability in the Firebase console. When inspecting the database, `PHARMACY ___SLASH___ OTC` is immediately recognizable; `PHARMACY%20%2F%20OTC` or a Base64 string is not.

---

## 5. Authentication Implementation

### Online Flow

1. User signs in via one of three paths on the Login screen:
   - Email/password: `signInWithEmailAndPassword()` / `createUserWithEmailAndPassword()`
   - Google SSO: `signInWithPopup(auth, new GoogleAuthProvider())`
   - Apple SSO: `signInWithPopup(auth, new OAuthProvider('apple.com'))`
2. `onAuthStateChanged` listener fires → sets `user` state
3. App reads `/users/{uid}` to resolve `householdId`; admin status = `household.adminUid === uid`
4. On new-user sign-up (email/password or SSO without prior user record), the shared helper `setupHouseholdForUser(newUser, { signupType, inviteCode, displayName })` writes `/users/{uid}`, either seeds a new household (new admin) or redeems an invite code (joiner)

### SSO specifics

- Custom Firebase Auth domain (`myprovisions.app`, set via `VITE_FIREBASE_AUTH_DOMAIN`) keeps the OAuth consent screen on our brand instead of the raw `*.firebaseapp.com` URL
- Capacitor native SSO must set the same domain via `plugins.FirebaseAuthentication.authDomain` in `capacitor.config.ts`; otherwise native Apple/Google flows can fall back to the default `*.firebaseapp.com` handler and drift from the redirect URLs registered with the providers
- Current workaround: `scripts/patch-capacitor-firebase-auth.js` patches `@capacitor-firebase/authentication` on Android because version 8.2.0 applies `setCustomAuthDomain(...)` but fails to read `authDomain` from Capacitor config
- Capacitor native builds do **not** use the Firebase JS popup/redirect OAuth recovery path. `src/firebase.js` omits `browserPopupRedirectResolver` on native, and `App.jsx` skips `getRedirectResult()` when `Capacitor.isNativePlatform()` so iOS WKWebView does not stall auth initialization waiting on unsupported web redirect behavior.
- New SSO users in **signin** mode, or existing SSO users without a `/users/{uid}` record, are routed to an in-app "Complete your household setup" screen (`awaitingHousehold` state) that collects displayName and either creates a new household or accepts an invite code — same helper as the email/password path
- SSO popups can be cancelled; `auth/popup-closed-by-user` and `auth/cancelled-popup-request` are swallowed silently. If the user cancels the post-popup household setup, `deleteUser()` tears down the half-created Firebase Auth account so the next attempt is clean
- **Account linking:** on `auth/account-exists-with-different-credential`, the pending SSO credential is extracted via `GoogleAuthProvider.credentialFromError()` / `OAuthProvider.credentialFromError()` and stashed in state; the user re-enters their password, and `linkWithCredential()` attaches the SSO provider to the existing email/password account in one round-trip

### Account deletion

- Password accounts: `reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password))`
- SSO accounts: `reauthenticateWithPopup(user, provider)` where `provider` matches `user.providerData[0].providerId` (`google.com` → `GoogleAuthProvider`, `apple.com` → `OAuthProvider('apple.com')`)
- Both branches share the same teardown (`finishDeletion`): invite-code index cleanup for admins, household removal for admins, `/users/{uid}` delete, cached-user clear, `deleteUser(auth.currentUser)`

### Offline-First Auth

1. On successful login, user info (uid, email, isAdmin) is cached to IndexedDB via `saveCachedUser()`
2. On app load, `loadCachedUser()` checks IndexedDB before Firebase auth resolves
3. If cached user exists and Firebase is unreachable, the app renders with cached credentials
4. When Firebase auth eventually resolves, the cached state is updated or cleared
5. On explicit logout, `clearCachedUser()` removes the cached credentials

### Token Persistence

Firebase Auth is configured with `indexedDBLocalPersistence` (primary) and `browserLocalPersistence` (fallback). This is set in `src/firebase.js` and ensures auth tokens survive page refreshes and app restarts, even on mobile Safari where localStorage can be purged.

### Invitation Code Flow

1. Admin generates code via Admin Panel → writes to `/inviteCodes/{codeId}` with 7-day expiration
2. New user enters code during sign-up
3. App reads all invite codes, finds matching unused code
4. Marks code as used (sets `used: true`, `usedBy`, `usedAt`)
5. Proceeds with account creation
6. Code validation happens client-side (reads all codes, finds match) — acceptable for the small user base

---

## 6. State Management

### Approach

All state lives in React hooks within the main `App` component. No external state management library, no React Context.

### Quantity UX

- Quantity is optional and may be blank on a list item.
- The list row renders quantity inline only when present, using a hyphen delimiter.
- A subdued pencil icon replaces the old inline quantity control.
- Quantity editing moved into the item bottom sheet.
- The bottom sheet keeps quantity as plaintext but adds quick numeric presets that rewrite the leading number while preserving any trailing text.
- Last-used quantities are cached in IndexedDB metadata and reused when the same item is added again.

### Add Mode Interaction

- **Unified row model** (Shop + Add): **row tap = mode’s primary action**; **right chevron** opens `ItemBottomSheet`; **left control** (`+`, `X`, checkbox) remains a redundant tap target.
  - Add **quick-add tile:** row tap adds; `+` adds; chevron opens sheet.
  - Add **list row:** row tap removes; `X` removes; chevron opens sheet.
  - Shop **list row:** row tap toggles done; checkbox toggles done; chevron opens sheet.
- High-frequency buttons use expanded invisible hit zones (`p-2.5 -m-2.5` pattern) toward a ≥44×44 tap target without oversized glyphs.
- Per-aisle autocomplete dropdown **flips above** the input when space below the field is under ~200px on open (`visualViewport` / `window.innerHeight`), decided once per open.

### Navigation chrome (responsive)

- The previous in-page Shop/Add+Clear toolbar (with scroll-based "sticky" promotion) was removed in favor of a breakpoint-flipped chrome:
  - **Mobile (`< lg`):** controls live in a fixed bottom nav bar (`fixed bottom-0` with `pb-safe`, `lg:hidden`). Header still hides on scroll-down for content focus, but the bottom bar is always visible.
  - **Desktop (`>= lg`):** controls live in the always-visible top header alongside expanded nav links.
- The deprecated `showStickyToolbar` state and `toolbarRef` were removed. Scroll handler retains only the header-hide-on-scroll behavior and the velocity-based fade-effect detection.
- The Clear control is **contextual** on mobile: a chip rendered conditionally on `doneCount > 0`, with a CSS entry animation (`animate-chip-in`, defined in `src/index.css`). The `key` prop on the chip uses the boolean `hasDone` so React re-mounts (and re-runs the entry animation) on each transition from no-done to has-done.
- The first-run tooltip is gated by a localStorage flag (`tend.clearChipTooltipSeen.v1`); a `useEffect` keyed on the boolean `hasDone` boundary fires the show/hide logic exactly once per device per fresh-install.

### Item Bottom Sheet

- `ItemBottomSheet` in `App.jsx` accepts `aisles`, `categories`, optional `suggestionConfig`, and list-row items with enough context to resolve taxonomy + pin state.
- **Breadcrumb + inline pickers:** tapping `AISLE › Category` expands inline aisle/category controls; moves use `moveSuggestionToCategory` / equivalent list-item paths. Draft picker state does not write RTDB until the user commits from the picker flow (same semantics as the retired umbrella "settings" panel).
- **Pin / Unpin:** visible-item → library uses demotion (`removeSuggestionEverywhere` or unpin path); library → visible uses the shared promote helper (`handlePromotionAccept` / `promoteListItemToVisibleShortcut`). Labels in UI: **Pin** / **Unpin** (user-facing vocabulary).
- `suggestionConfig` (when present) still carries `{ categoryId, aisleId, onMove(toCatId), onRemove() }` for compatibility with suggestion opens.
- **Dismiss:** backdrop tap and **X** (mobile + desktop); **swipe-down on the handle only** uses `transform: translateY` with threshold snap/close. Bottom padding respects safe-area (`pb-safe` / max env inset).
- Name/quantity commit on blur and on close — no separate Save for those fields.
- Firebase Auth errors shown in the login and delete-account flows are passed through **`humanizeAuthError`** in **`src/authErrors.js`** (raw errors still logged).

### Item Identity

- Shopping list rows now carry a stable `itemKey` separate from the editable display name.
- Name edits only update the display field, not the underlying identity.
- Quantity defaults are keyed by `itemKey`, so renaming an item does not fork its stored identity.

### Key State Variables

| State | Type | Source | Purpose |
|---|---|---|---|
| `user` | object/null | Firebase Auth | Current authenticated user |
| `isAdmin` | boolean | Firestore query | Whether user has admin privileges |
| `list` | array | Realtime DB + IndexedDB | Current shopping list items |
| `history` | Set | Realtime DB + IndexedDB | Previously added item names |
| `aisles` | array | Realtime DB + IndexedDB | Ordered aisle list (id, name, order) |
| `categories` | array | Realtime DB + IndexedDB | Categories with aisle assignment + hidden flag |
| `visibleItems` | object | Realtime DB + IndexedDB | Visible (quick-add) items keyed by category id |
| `libraryItems` | object | Realtime DB + IndexedDB | Autocomplete library keyed by category id |
| `quickAddMode` | boolean | local | Whether Add mode is active (vs Shop mode) |
| `expandedCategories` | Set | local | Which categories are expanded |
| `currentPage` | string | local | Current page ('list' or 'edit') |

---

## 7. Planned Voice Add Architecture

### Design Goal

Add Claude-driven voice capture without introducing a second categorization model that drifts from the app's existing suggestion system.

### Planned Service Shape

A small Cloudflare Worker-backed service lives in `voice-mcp/` and is responsible for:

1. Loading current shopping context from Realtime Database
2. Deterministically resolving candidate items against existing suggestions
3. Returning unresolved items for Claude-side category judgment
4. Writing final items back to the shared `shopping-list`

### Why Not Let Claude Decide Everything?

Because the app already has household-specific truth:

- canonical item names live in `common-items` and `less-common-items`
- category placement already reflects how this household shops

Claude should not override known mappings. It should only help with genuinely novel items.

### Planned Operation Flow

1. Claude parses the utterance into item candidates
2. Worker resolves exact and conservative fuzzy matches
3. Worker skips anything already on the list
4. Worker returns unresolved items plus category context
5. Claude selects a fixed category for unresolved items with a confidence score
6. Worker writes the final result in the existing list item shape

### Service Operations

- `GET /context`
- `POST /resolve`
- `POST /add`

These are intentionally transport-agnostic business operations. A remote MCP transport can be layered on top once connector wiring is finalized.
| `isOnline` | boolean | browser events | Connectivity status |

### Data Flow

1. Firebase `onValue` listeners provide real-time updates → update React state
2. State changes trigger re-renders → UI updates
3. User actions dispatch writes to Firebase → triggers `onValue` → state updates
4. Simultaneously, data is saved to IndexedDB as a local cache
5. On offline load, state is hydrated from IndexedDB

---

## 7. Offline-First Architecture

### IndexedDB Stores

Defined in `src/offlineStorage.js`:

| Store | Key | Contents |
|---|---|---|
| `shoppingList` | `'current'` | Full shopping list array |
| `aisles` | `'current'` | Ordered aisle list |
| `categories` | `'current'` | Categories with aisle assignment + hidden flag |
| `visibleItems` | category id | Visible items array per category |
| `libraryItems` | category id | Library/autocomplete items array per category |
| `syncQueue` | auto-increment | Queued offline operations |
| `meta` | `'lastSync'`, `'cachedUser'` | Sync timestamps, cached auth |

### Sync Strategy

- **Online:** Firebase `onValue` is the source of truth; IndexedDB is updated as a mirror
- **Offline:** IndexedDB serves cached data; changes queue in the sync queue store
- **Reconnect:** Queued operations replay against Firebase; `onValue` listeners re-sync state

### Optimistic Updates

When the user makes a change (add/check/delete item):
1. State is updated immediately (optimistic)
2. Firebase write is attempted
3. If online, Firebase `onValue` confirms the update
4. If offline, change is queued for later sync

---

## 8. PWA Configuration

### Service Worker

Generated by `vite-plugin-pwa` using Workbox.

**Registration type:** `prompt` — the user is notified when an update is available and can choose to reload. This prevents unexpected mid-shopping refreshes.

### Precaching

All static assets are precached on install:
- `**/*.{js,css,html,ico,png,svg,woff,woff2}`

### Runtime Caching

| URL Pattern | Strategy | Cache Name | Max Age |
|---|---|---|---|
| `gstatic.com/*` (Firebase SDK) | CacheFirst | `firebase-sdk-cache` | 7 days |
| `fonts.googleapis.com/*` | StaleWhileRevalidate | `google-fonts-cache` | 1 year |

### Manifest

```json
{
  "name": "Shopping List",
  "short_name": "Shopping",
  "display": "standalone",
  "theme_color": "#FF7A7A",
  "background_color": "#f3f4f6",
  "start_url": "/"
}
```

---

## 9. Logging System Architecture

### Design Principles

1. **Non-blocking** — logging never throws or blocks the UI
2. **Batched writes** — Firebase writes are batched to reduce API calls
3. **Dual storage** — IndexedDB (always) + Firebase (when online)
4. **Self-cleaning** — 21-day retention; Firebase cleanup at most weekly per user (`logsLastRemoteCleanupAt`)

### Architecture

```
User action → logger.info/warn/error()
                  ↓
          [In-memory buffer (500 entries)]
                  ↓                    ↓
         [IndexedDB (local)]    [Firebase batch queue]
                                       ↓
                              [Flush on: batch full (10),
                               timer (5s), page hide,
                               reconnect, periodic (60s)]
                                       ↓
                              [Firebase: /logs/{uid}/{session}/{id}]
```

### Session Tracking

Each app load generates a unique `SESSION_ID` (`session_{timestamp}_{random}`). All logs from that session share the ID, enabling session-level debugging.

### Automatic Event Capture

The logger automatically captures (no explicit calls needed):
- `window.error` — unhandled errors with stack traces
- `window.unhandledrejection` — unhandled promise rejections
- `online`/`offline` events — connectivity changes
- `visibilitychange` — app foreground/background
- Application start — environment info

### Admin Tools

| Tool | File | Access |
|---|---|---|
| Debug Panel | `src/DebugPanel.jsx` | Ctrl+Shift+D, `?debug=true` (no floating launcher) |
| Log Viewer | `src/AdminLogViewer.jsx` | Admin Panel → "My Logs (Real-time)" |
| Log Analytics | `src/LogAnalytics.jsx` | Admin Panel → "Log Analytics (All Users)" |

### Retention & Cleanup

- Cleanup runs on user login (10s delay) and every 24 hours
- IndexedDB: deletes entries older than 21 days via cursor scan (each session after user id is set)
- Firebase: deletes entire sessions where the oldest log exceeds 21 days; full-tree read gated to at most once per 7 days via `users/{uid}/logsLastRemoteCleanupAt`

---

## 10. Firebase Security Rules

### Realtime Database (`database.rules.json`)

| Path | Read | Write |
|---|---|---|
| `/users/{uid}` | Owner only | Owner only (or new record) |
| `/inviteCodes` | Any authenticated user | Any authenticated user (unused codes only) |
| `/shopping-list` | Any authenticated user | Any authenticated user |
| `/shopping-history` | Any authenticated user | Any authenticated user |
| `/households/{hid}/aisles` | Household members | Household members |
| `/households/{hid}/categories` | Household members | Household members |
| `/households/{hid}/visible-items` | Household members | Household members |
| `/households/{hid}/library` | Household members | Household members |
| `/logs` (root) | Admin only (isFirstUser) | — |
| `/logs/{uid}` | Owner only | Owner only |

**Key design choice:** Shopping data is readable/writable by any authenticated user because the app serves a single household. There is no per-user data isolation for list data.

### Firebase App Check (web client)

- **Initialization:** `src/firebase.js` calls `initializeAppCheck` with **reCAPTCHA v3** (`ReCaptchaV3Provider`) immediately after `initializeApp` and before Auth/RTDB so pre-auth reads (e.g. invite code lookup) attach tokens.
- **Env:** `VITE_RECAPTCHA_SITE_KEY` (required in production — runtime throws on load if missing). Dev-only optional `VITE_APPCHECK_DEBUG_TOKEN` (register the same value under Firebase Console → App Check → Debug tokens); if unset in dev, `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` so the SDK prints a one-time debug token to the browser console.
- **Enforcement:** toggled in Firebase Console (Realtime Database, optionally Auth) after monitoring verified traffic; **voice-mcp** uses a service account REST path and is unaffected by web App Check enforcement.
- **Capacitor native builds:** `src/firebase.js` skips the **web** App Check path entirely on `Capacitor.isNativePlatform()`. The current native shell still uses the Firebase JS SDK for Auth/RTDB, but reCAPTCHA v3 App Check is web-only and caused opaque WKWebView startup failures on iOS. Native App Check attestation remains future work.

### Firestore (`firestore.rules`)

| Collection | Read | Write |
|---|---|---|
| `/admins/{uid}` | Admin only (`exists()` check) | Denied (created via app logic, not direct writes) |
| Everything else | Denied | Denied |

**Why deny writes to admins?** Admin records are created during the first-user signup flow in `App.jsx`. Preventing direct writes ensures only the app's logic (which checks `isFirstUser`) can grant admin status.

---

## 11. Build & Deployment Pipeline

### Build

```bash
npm run build    # Vite production build → dist/
```

Vite handles:
- JSX transformation (via `@vitejs/plugin-react`)
- Tailwind CSS processing (PostCSS)
- Tree-shaking and code splitting
- Service worker generation (vite-plugin-pwa)
- Environment variable injection (`VITE_*` → `import.meta.env`)

### Deployment

```bash
firebase deploy                    # Full deploy (hosting + rules)
firebase deploy --only hosting     # App code only
firebase deploy --only database    # Realtime Database rules only
firebase deploy --only firestore   # Firestore rules only
```

Firebase Hosting serves the `dist/` directory. There is no CI/CD pipeline; deployments are manual.

### Environment Variables

All Firebase config is injected at build time via Vite's `import.meta.env`:

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_DATABASE_URL
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_RECAPTCHA_SITE_KEY          # App Check (reCAPTCHA v3); required in production
# VITE_APPCHECK_DEBUG_TOKEN      # optional; dev-only fixed App Check debug token
# VITE_FIREBASE_MEASUREMENT_ID    # optional; GA4 web
# VITE_REVENUECAT_IOS_KEY         # native iOS RevenueCat public SDK key (appl_…)
# VITE_REVENUECAT_ANDROID_KEY     # native Android RevenueCat public SDK key (goog_…)
# VITE_REVENUECAT_OFFERING        # optional; override default offering id ("main")
# VITE_STRIPE_CHECKOUT_URL        # optional; web Stripe checkout stub (web gating not enforced yet)
```

These are **not secrets** (Firebase client config is public by design). Security is enforced by Firebase security rules, not by hiding the config. The reCAPTCHA **site key** is also public by design; it is still required for App Check to initialize in production. RevenueCat **public SDK keys** are also safe to ship in the client.

---

## 11b. Subscriptions (RevenueCat)

`src/subscriptions.js` wraps `@revenuecat/purchases-capacitor`. Initialization uses **household ID** as the RevenueCat App User ID so the entitlement is per-household; all members of the household share the same subscription without mirroring state to RTDB.

Flow:

1. On native (`Capacitor.isNativePlatform()`), after household load, `initSubscriptions(householdId)` calls `Purchases.configure({ apiKey, appUserID: householdId })` and registers a `CustomerInfo` listener.
2. `isWriteAllowed()` is the single source of truth for write gating. It returns `true` on web (no enforcement until Stripe/web SDK lands), `true` on native when customerInfo has not yet loaded (avoids a UX stall in the first few hundred ms after init), and `!!customerInfo.entitlements.active.premium` once loaded.
3. `assertWriteAllowed(trigger)` is the gate used at every handler site in `App.jsx` (see PAYWALL_SPEC.md §4). If blocked, it fires `openPaywall(trigger)` which renders the `PaywallSheet` component with `paywall_viewed` analytics.
4. Paywall actions: `purchaseSubscription()` calls `Purchases.purchasePackage({ aPackage })` with the offering's annual package (fallback: first `availablePackages`); `restorePurchases()` satisfies Apple's restore requirement. Web `purchaseSubscription()` delegates to `src/stripe-checkout.js` (stub — redirects to `VITE_STRIPE_CHECKOUT_URL` when configured).
5. Lifecycle analytics: `trial_started`, `subscription_started`, `subscription_cancelled`, `subscription_renewed` fire from the listener when the entitlement transitions.
6. Sign-out calls `shutdownSubscriptions()` which removes the listener and `Purchases.logOut()`s; the next household's admin triggers a fresh `configure` / `logIn`.

Web enforcement and native App Check attestation are both **future work**. The web path currently does not gate writes.

---

## 11a. Item Event Logging (Tier 0/1 analytics)

### Purpose

A behavioral event stream per household that records every list mutation. Foundation for frequency-based suggestions (Tier 1) and any future cadence/seasonal/co-occurrence work (Tiers 2+).

### Schema

Events live at `/households/{householdId}/item-events/{pushId}`. Push IDs give us free time-ordering. Each event:

| Field | Notes |
|---|---|
| `ts` | Client clock (ms). Acceptable for analytics; not used for security. |
| `uid` | Author of the action. Enables per-user splits. |
| `name` | Always lowercased on write so consumers can trust equality checks. |
| `category` | Snapshot of the category at event time. |
| `itemKey` | Optional; present on `checked` / `unchecked` from shop toggles when known. Groups pairing with legacy `name`+`category` rows. |
| `action` | `added` (item put on the list), `checked` (proxy for purchased), `unchecked` (mistake correction), `removed` (only logged when an unchecked item is removed — cleared/checked items don't need a separate removed event since `checked` already represents the buy). |
| `source` | Only on `added`: `typed` if added from search/free-text, `quickAdd` if tapped from suggestions. Used to drive promotion candidates. |
| `qty` | Quantity at the time of the event. Important for the future Costco/stockpiling mitigation (Tier 2). |

### Write path

Logged inline from `addItem`, `toggleDone`, and `removeItem` in `App.jsx` via a fire-and-forget `logItemEvent` helper. Failures are warned, not thrown — logging must never block the UI or break a mutation. The voice-mcp Cloudflare worker is a separate writer to `shopping-list` and currently does **not** generate events; that's a known gap to close before voice traffic grows.

### Aggregation

`src/purchaseSemantics.js` defines a **two-hour undo window**: per list identity, an `unchecked` within two hours of the latest unmatched `checked` voids that check (LIFO). Surviving checks are **effective purchases** — used for purchase history, last-purchased UI, and pin/promotion analytics.

Pure functions in `src/itemAnalytics.js`: `buildItemStats`, `topPurchased`, `dormantShortcuts`, `promotionCandidates`, `userContributions`, `eventSummary` (and legacy `dormantQuickAddCandidates`). They consume the raw stream but treat `checked` counts and `lastCheckedTs` as **effective** only (via `computeEffectiveCheckEvents`). All operate on the in-memory event array — no server-side aggregation. At ~10–20 events/day per household this is trivial well past 1 year of history.

### Surfacing

**Account → Household Insights** (`InsightsModal` in `App.jsx`): read-only summaries for any household member (consumer-facing copy). Add mode also uses `promotionCandidates` / `dormantShortcuts` for inline promote and cleanup cards.

### Retention

No automatic cleanup yet. Plan: prune events older than 1 year on a daily login hook, keeping a rolling window per household. Defer until events actually accumulate.

### Security rules

Per-event validation in `database.rules.json` under `households/$hid/item-events/$eventId`. Read/write inherits from the household-level gate (must be a member). Each field is type/length/regex-checked; `$other: false` rejects unknown fields.

---

## 12. Data Migration Patterns

### Item Format Migration

The `migrateItems()` function handles legacy item formats. Originally, suggestion items were stored as plain strings (`["apples", "bananas"]`). The current format uses objects with IDs (`[{id: "abc123", name: "apples"}]`).

On load, if items are detected in the old string format, `migrateItems()` converts them to the object format and writes back to Firebase.

### Default Item Seeding

When a new household is created, the app seeds `aisles`, `categories`, `visible-items`, and `library` from the seed catalog (`SEED_AISLES`, `SEED_CATEGORIES`, `SEED_ITEMS`). The catalog marks ~50 of ~300 items as visible-by-default; the rest are seeded into the library for autocomplete.

### Common-items / Less-common-items / History → Library Migration

For existing households, a one-time migration converts the legacy `common-items`, `less-common-items`, and `shopping-history` paths into the new `aisles` / `categories` / `visible-items` / `library` shape:

1. Materialize a `categories` array from the existing distinct category names. Assign each to a default aisle using a name-based mapping table (with anything unmatched grouped under a "MISC" aisle the user can clean up).
2. Move all `common-items[cat]` entries into `visible-items[catId]`.
3. Merge `less-common-items[cat]` entries plus `shopping-history` names that aren't already visible into `library[catId]`. History entries with no known category land under "MISC".
4. Generate aisle ordering from the seed default for any aisles that match by name; user-added or unmatched aisles append to the end.
5. Leave the legacy paths in place for one release as a rollback safety net, then delete in a follow-up cleanup script.

Migration runs server-side (Node script in `scripts/`), one-time per household, gated by a `migration.taxonomy_v2: true` flag on the household record.

### Category Encoding Migration

No migration was needed — category encoding was implemented before any data was stored. If the encoding scheme ever changes, a migration script would need to re-key all items in Firebase.

---

## 13. Key Technical Decisions Log

| Decision | Choice | Alternatives Considered | Rationale |
|---|---|---|---|
| State management | React hooks (useState/useEffect) | Redux, Zustand, Context API | App state is simple enough; hooks avoid dependency and boilerplate |
| File structure | Single App.jsx | Multi-file component tree | Simplicity for solo/duo development; easy to search and refactor |
| Database | Firebase Realtime DB | Firestore only, Supabase, custom backend | Real-time sync out of the box, generous free tier, offline SDK |
| Admin storage | Firestore | Realtime DB custom claims, Cloud Functions | `exists()` in security rules enables simple admin checks |
| Offline storage | Raw IndexedDB | localForage, Dexie, localStorage | No additional dependency; full control over schema |
| PWA framework | vite-plugin-pwa | Custom service worker, next-pwa | Integrates with Vite build; Workbox handles caching strategies |
| Category encoding | Verbose placeholders | URL encoding, Base64, sanitization | Readable in Firebase console for debugging |
| Auth persistence | IndexedDB (primary) | localStorage only | More reliable on mobile Safari; survives storage pressure |
| PWA update | Prompt (manual) | Auto-update | Prevents unexpected page reloads during shopping |
| Logging destination | Firebase RTDB | Cloud Logging, Sentry, custom backend | Already using Firebase; no additional service needed |
