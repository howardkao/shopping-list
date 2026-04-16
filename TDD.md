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
| **Auth** | Firebase Auth (email/password) | Managed auth with token refresh, persistence options |
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

1. User enters email/password on the Login screen
2. Firebase Auth `signInWithEmailAndPassword()` or `createUserWithEmailAndPassword()`
3. `onAuthStateChanged` listener fires → sets `user` state
4. Admin check: `getDoc(doc(firestore, 'admins', user.uid))` → sets `isAdmin`
5. On sign-up: user record written to `/users/{uid}` in Realtime Database
6. First user: additionally written to Firestore `admins` collection

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

- Suggestion rows use a split interaction model: the `+` button adds immediately, while tapping the row body opens the bottom sheet.
- The bottom sheet for suggestions exposes an explicit add action so users can review the item before adding it.

### Navigation chrome (responsive)

- The previous in-page Shop/Add+Clear toolbar (with scroll-based "sticky" promotion) was removed in favor of a breakpoint-flipped chrome:
  - **Mobile (`< lg`):** controls live in a fixed bottom nav bar (`fixed bottom-0` with `pb-safe`, `lg:hidden`). Header still hides on scroll-down for content focus, but the bottom bar is always visible.
  - **Desktop (`>= lg`):** controls live in the always-visible top header alongside expanded nav links.
- The deprecated `showStickyToolbar` state and `toolbarRef` were removed. Scroll handler retains only the header-hide-on-scroll behavior and the velocity-based fade-effect detection.
- The Clear control is **contextual** on mobile: a chip rendered conditionally on `doneCount > 0`, with a CSS entry animation (`animate-chip-in`, defined in `src/index.css`). The `key` prop on the chip uses the boolean `hasDone` so React re-mounts (and re-runs the entry animation) on each transition from no-done to has-done.
- The first-run tooltip is gated by a localStorage flag (`tend.clearChipTooltipSeen.v1`); a `useEffect` keyed on the boolean `hasDone` boundary fires the show/hide logic exactly once per device per fresh-install.

### Item Bottom Sheet: Advanced Suggestion Config

- `ItemBottomSheet` accepts `aisles` and `categories` props plus a per-open `suggestionConfig` attached to the item (only present when opened via `openSuggestionSheet`).
- `suggestionConfig` carries `{ categoryId, aisleId, onMove(toCatId), onRemove() }`. Both handlers close the sheet on success.
- `moveSuggestionToCategory(suggestionId, fromCatId, toCatId)` in `App.jsx` performs a single multi-path RTDB `update()` across `taxonomy/visible-items/{fromCatId}` / `{toCatId}` and `taxonomy/library/{fromCatId}` / `{toCatId}`. The item preserves its visible-vs-library bucket on move. If an item with the same (case-insensitive) name already exists at the destination, the source entry is deleted and no new entry is created at the destination.
- `removeSuggestionEverywhere(suggestionId, catId)` deletes the item from both `visible-items` and `library` under its current category in a single `update()`.
- The advanced panel holds draft aisle/category state locally; it does not touch RTDB until Save. Cancel and backdrop tap discard silently.
- The sheet no longer renders a trailing Save button for name/quantity; those fields commit on blur and on close via existing handlers (`updateItemName`, `updateQuantity`, `renameTaxonomySuggestionById`, `updateSuggestionQuantity`).

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
4. **Self-cleaning** — 30-day retention enforced automatically

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
| Debug Panel | `src/DebugPanel.jsx` | Bug icon, Ctrl+Shift+D, `?debug=true` |
| Log Viewer | `src/AdminLogViewer.jsx` | Admin Panel → "My Logs (Real-time)" |
| Log Analytics | `src/LogAnalytics.jsx` | Admin Panel → "Log Analytics (All Users)" |

### Retention & Cleanup

- Cleanup runs on user login (10s delay) and every 24 hours
- IndexedDB: deletes entries older than 30 days via cursor scan
- Firebase: deletes entire sessions where the oldest log exceeds 30 days

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
```

These are **not secrets** (Firebase client config is public by design). Security is enforced by Firebase security rules, not by hiding the config.

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

`src/purchaseSemantics.js` defines a **two-hour undo window**: per list identity, an `unchecked` within two hours of the latest unmatched `checked` voids that check (LIFO). Surviving checks are **effective purchases** — used for purchase history, last-purchased UI, and shortcut promote/demote analytics.

Pure functions in `src/itemAnalytics.js`: `buildItemStats`, `topPurchased`, `dormantQuickAddCandidates`, `promotionCandidates`, `userContributions`, `eventSummary`. They consume the raw stream but treat `checked` counts and `lastCheckedTs` as **effective** only (via `computeEffectiveCheckEvents`). All operate on the in-memory event array — no server-side aggregation. At ~10–20 events/day per household this is trivial well past 1 year of history.

### Surfacing

Currently exposed via the AdminPanel → "View Household Insights" modal (admin-only). End-user UX surfacing (promote prompts, demote prompts, "due now" strips) is deferred — Tier 0/1 ships as the data foundation; UX comes after we see what real data looks like.

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
