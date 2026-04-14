# Product Requirements Document (PRD)

> **Status:** Living document — updated as features evolve
> **Last updated:** 2026-04-14

---

## 1. Product Vision

A collaborative household shopping list app designed for a small group of trusted users (family/household). The app enables real-time collaboration on a shared shopping list, with curated item suggestions organized by store category. It works offline, syncs automatically when connectivity returns, and runs as an installable PWA on mobile devices.

### Target Users

- A single household (family or roommates) sharing one shopping list
- Primary use case: grocery shopping at multiple stores (standard grocery, Costco, Ranch 99 / Asian markets)
- Users range from tech-savvy to non-technical; the UI must be simple and forgiving

### Core Value Proposition

- **One shared list** — everyone sees the same items in real time
- **Smart suggestions** — frequently-bought items are one tap away, organized by store section
- **Works offline** — the app is usable without connectivity (critical for in-store use with poor signal)
- **Invite-only access** — only people with a valid invitation code can join

---

## 2. Authentication & Access Control

### Requirements


| Requirement         | Detail                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Auth method         | Email/password via Firebase Auth                                                              |
| Display name        | Required during sign-up; existing users without one are prompted on next login                 |
| First user          | Automatically becomes admin; no invitation code required                                      |
| Subsequent users    | Must provide a valid, unused invitation code during sign-up                                   |
| Invitation codes    | 8 characters, uppercase alphanumeric; expire after 7 days                                     |
| Code management     | Admins generate codes via Admin Panel; codes are single-use                                   |
| Password reset      | Available from the login screen via email                                                     |
| Session persistence | Auth tokens persisted to IndexedDB (preferred) with localStorage fallback                     |
| Offline auth        | Previously authenticated users can access the app offline via cached credentials in IndexedDB |


### Admin Privileges

- Generate and view invitation codes
- View production logs (own logs real-time, all-user analytics)
- Access debug panel (bug icon, Ctrl+Shift+D, or `?debug=true`)

---

## 3. Shopping List Features

The shopping list is **shared** — all authenticated users read and write the same list.

### Item Structure

Each item on the list has:

- `id` — unique identifier
- `itemKey` — stable identity separate from the display name
- `name` — display name
- `category` — one of the predefined categories
- `quantity` — numeric quantity (default 1)
- `done` — boolean checked-off state
- `addedBy` — uid of the user who added the item (nullable for legacy items)
- `addedAt` — timestamp when the item was added (nullable for legacy items)

### Two Modes

#### Shop Mode (default)

- View current list items grouped by category
- Tap an item to toggle its `done` state (check off / uncheck)
- Checked-off items show with strikethrough styling
- Categories with items auto-expand; empty categories collapse
- Purpose: use while walking through the store

#### Add Mode

- Switch via toggle button in the toolbar
- Shows item suggestions organized by category
- Tap the `+` on a suggestion to instantly add it to the shopping list (with quantity 1)
- Tap anywhere else on the suggestion row to open the item bottom sheet
- Items already on the list are visually indicated
- Existing list checkboxes are disabled in Add Mode so the mode stays focused on building the list
- Search bar filters suggestions across all categories
- History-based suggestions: previously added items appear in search results
- Categories auto-expand to show available suggestions
- Purpose: quickly build/update the list before or during a shopping trip

### Quantity Management

- Quantity is optional
- If a quantity is present, it displays inline in the list as `item - quantity`
- The list row shows a subtle pencil affordance instead of a quantity control
- Quantity is edited from the item bottom sheet as plaintext with quick numeric picks
- Re-adding an item reuses its most recently saved quantity when available

### Item Detail Bottom Sheet

- Tap an item name to open a slide-up bottom sheet with item metadata
- Shows "Added by {name} {timestamp}" (who added the item and when)
- Shows "Last purchased {relative time}" derived from item-events (most recent `checked` event)
- Dismissed by tapping the backdrop
- Checkbox and quantity tap targets remain unaffected

### Real-Time Sync

- All changes sync to Firebase Realtime Database immediately when online
- Multiple users see changes in real time
- Visual indicator shows online/offline status and pending sync operations

---

## 4. Item Suggestion System

### Two-Tier Organization

Items are organized into two visibility tiers per category:


| Tier                  | Purpose                      | Visibility in Add Mode                                 |
| --------------------- | ---------------------------- | ------------------------------------------------------ |
| **Common items**      | Frequently purchased items   | Always shown as quick-add buttons                      |
| **Less-common items** | Occasionally purchased items | Hidden by default; shown via "Show less common" toggle |


### Default Items

On first setup (when no items exist in Firebase), the app seeds each category with a set of default common items. These defaults are hardcoded in the app as a starting point.

### Item Structure (suggestions)

Each suggestion item has:

- `id` — unique identifier
- `name` — display name

### Shopping History

- When an item is added to the shopping list, its name is recorded in a history set
- History items appear as search suggestions, even if they're not in the common/less-common lists
- History persists across sessions

---

## 5. Edit Suggestions Page

A dedicated page for managing the suggestion items that appear in Add Mode.

### Features

- Accessible via navigation (separate from the shopping list page)
- Shows all categories with their common and less-common items
- **Add items** — add new items to any category (common or less-common tier)
- **Edit items** — rename existing items inline
- **Delete items** — remove items from suggestions
- **Toggle tier** — move items between common and less-common
- Items sorted alphabetically within each category
- Changes sync to Firebase in real time

---

## 6. Category System

### Predefined Categories

The app uses a fixed set of 12 categories reflecting the stores and sections the household shops at:

1. VEGGIES
2. FRUIT
3. MEAT & FISH
4. DELI, DAIRY, EGGS
5. FROZEN
6. DRY GOODS
7. BAKING, SPICES & OILS
8. PREPARED FOODS
9. PHARMACY / OTC
10. TARGET / AMAZON / COSTCO
11. COSTCO BULK FOODS
12. RANCH 99 / WEEE / BERKELEY BOWL

### Category Behavior

- Categories cannot be added, removed, or renamed at runtime
- Category order is fixed (defined in code)
- Categories expand/collapse independently
- Auto-expansion behavior differs by mode (Shop vs Add)

---

## 7. UI/UX Requirements

### Layout

- **Mobile-first** responsive design
- Single-column on small screens
- Multi-column on larger screens (2 columns at md breakpoint, 3 at lg)
- Plus Jakarta Sans font family

### Scroll Behavior

- **Header** hides on scroll down, reappears on scroll up
- **Toolbar** becomes sticky when scrolling past its natural position
- **Scroll fade effects** — during fast scrolling (>800px/s), UI elements fade or desaturate to improve readability of content while the list is in motion

### Status Indicators

- **Online/offline indicator** — visual feedback for connectivity state
- **Pending sync badge** — shows count of operations waiting to sync
- **Last sync time** — relative timestamp (e.g., "2 minutes ago")

### Navigation

- Two-page structure: Shopping List and Edit Suggestions
- Navigation via toolbar/header controls

---

## 8. Offline & PWA Requirements

### Offline-First Behavior

- App is installable as a PWA (Add to Home Screen)
- All app assets cached by service worker for offline access
- Previously authenticated users can load the app and view their last-synced data offline
- User credentials cached in IndexedDB for offline authentication
- Shopping list, history, and item suggestions cached locally in IndexedDB
- Changes made offline sync automatically when connectivity returns

### PWA Configuration

- `registerType: 'prompt'` — users are prompted to update when a new version is available (not auto-updated)
- Standalone display mode (no browser chrome)

---

## 9. Planned Voice Add Requirements

### Goal

Allow a household member to speak a shopping request naturally through Claude and have the request update the shared shopping list with behavior that mirrors the existing autocomplete flow.

### Voice Add Behavior

- Claude extracts item candidates from a spoken utterance (for example, "add apples and bananas and ground pork")
- Existing known items should resolve to their current canonical name and category when possible
- Items already on the list should be ignored rather than duplicated or quantity-bumped
- Unknown items should be added to the list only; they should not auto-update suggestions
- Fuzzy matching should be conservative
- Novel-item categorization should only choose from the fixed category list
- Low-confidence novel items should trigger a follow-up question instead of a blind guess

### Integration Shape

- A lightweight remote worker/service will load live shopping context from Firebase
- The worker will deterministically resolve candidate items against existing suggestion data
- Claude will only supply category judgment for items the worker cannot match confidently
- Theme color: `#FF7A7A`
- App icon: SVG format

### Caching Strategy

- **Static assets** — precached by service worker (all JS, CSS, HTML, images, fonts)
- **Firebase SDK** — CacheFirst with 7-day expiration
- **Google Fonts** — StaleWhileRevalidate with 1-year expiration

---

## 9. Admin Features

### Admin Panel

Accessible only to admin users (first registered user) via the menu.


| Feature                  | Description                                                |
| ------------------------ | ---------------------------------------------------------- |
| Generate invitation code | Creates a new 8-char code with 7-day expiration            |
| View invitation codes    | Lists all codes with status (used/unused, expiry, used-by) |
| View production logs     | Real-time log viewer with filters and export               |
| Log analytics            | Aggregated insights across all users                       |
| Debug panel              | Floating panel for real-time log monitoring                |


---

## 9a. Item Event Logging (analytics foundation)

### Purpose

Capture every list mutation (add / check / uncheck / remove) as a per-household event stream. This is the data layer for future suggestion intelligence: promote/demote candidates, "probably due" predictions, household insights.

### Behavior

- Every time an item is added, checked, unchecked, or removed-while-unchecked, an event is appended to `/households/{hid}/item-events`.
- Adds carry a `source` flag (`typed` vs `quickAdd`) so we can detect items the user keeps typing that should be promoted to quick-add.
- Logging is fire-and-forget — never blocks the UI, never breaks a mutation.
- No end-user UX is built on this data yet. It's collected now so it exists when we want to use it.

### Admin surface

Admins can open the Admin Panel → "View Household Insights" to see Tier 1 aggregates: top purchased items, promotion candidates, dormant quick-add items, per-user activity, and a summary of the event stream.

### Privacy posture

Events stay inside the household namespace and are gated by the same household membership rules as the rest of the household data. Cross-household aggregation is **not** part of this tier and would require explicit opt-in.

---

## 10. Logging & Observability

### Requirements

- Logging is always enabled (no opt-in/opt-out)
- Logs stored in Firebase Realtime Database under `/logs/{userId}/{sessionId}/`
- Logs also stored locally in IndexedDB for offline access
- 30-day rolling retention (automatic cleanup runs daily on login)
- Log levels: DEBUG (dev only), INFO, WARN, ERROR
- In production, only INFO/WARN/ERROR are sent to Firebase

### Log Categories

- **Auth** — login, logout, signup, token refresh, cached user operations
- **Network** — online/offline events, Firebase connection state
- **Firebase** — read/write operations with timing
- **Sync** — data synchronization events
- **OfflineStorage** — IndexedDB operations
- **App** — lifecycle events (start, visibility changes)
- **Error** — unhandled errors and promise rejections

### Admin Log Access

- **My Logs (Real-time)** — per-user log viewer with date/level/category filters
- **Log Analytics (All Users)** — aggregated dashboard showing common issues, user impact, error trends
- **Debug Panel** — floating real-time panel (bug icon, Ctrl+Shift+D, `?debug=true`)

### Performance

- Logs are batched (up to 10 entries or 5-second flush interval)
- Periodic sync every 60 seconds
- Immediate flush on page hide/unload and when coming back online
- Logging never blocks app functionality

---

## 11. Non-Functional Requirements

### Performance

- App should load and be interactive within 3 seconds on a typical mobile connection
- Offline mode should load instantly from cache
- Real-time sync should feel instantaneous (<500ms for list updates)

### Security

- All data access requires authentication
- Users can only write their own log data
- Admins (first user) can read all logs for analytics
- Invitation codes are single-use and time-limited
- No sensitive data (passwords, tokens) is ever logged
- Firebase security rules enforce access control at the database level

### Data Retention

- Shopping list and history: persisted indefinitely
- Item suggestions: persisted indefinitely
- Logs: 30-day rolling retention (automatic cleanup)
- Invitation codes: persist after use (for audit trail)

### Browser Support

- Modern mobile browsers (Safari iOS, Chrome Android)
- Desktop Chrome, Firefox, Safari
- PWA install supported on Chrome and Safari
