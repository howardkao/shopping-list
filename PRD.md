# Product Requirements Document (PRD)

> **Status:** Living document — updated as features evolve
> **Last updated:** 2026-04-16 (navigation redesign; contextual Clear chip; effective purchase semantics for analytics + last purchased)

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
- `category` — the category the item belongs to (categories are user-editable; see §6)
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
- Shows "Last purchased {relative time}" derived from item-events: most recent **effective** purchase (a `checked` event not voided by an `unchecked` within two hours on the same list identity; see `purchaseSemantics.js`)
- Name and quantity commit on blur and on close; there is no explicit save button on the sheet itself
- Dismissed by tapping the backdrop
- Checkbox and quantity tap targets remain unaffected

#### Advanced configuration (Add-mode suggestions only)

- When the sheet is opened for a suggestion tile, a muted breadcrumb row appears below the metadata: `AISLE › Category` with a pencil icon
- Tapping the breadcrumb row expands an inline advanced-config panel in place (not a separate page)
- The panel exposes: an aisle dropdown, a category dropdown (filtered by the selected aisle), and a destructive "Remove from suggestions" action with a two-step confirmation
- The panel has its own explicit **Save** and **Cancel** buttons — advanced edits do not save on blur
- Save commits a category move (preserving the item's visible-vs-library bucket) and closes the sheet; Cancel (or backdrop tap) discards the advanced draft silently
- Removing from suggestions deletes the item from both `visible-items` and `library` under its current category and closes the sheet
- List-item sheets (opened from a shopping-list row) do not show the advanced panel

### Real-Time Sync

- All changes sync to Firebase Realtime Database immediately when online
- Multiple users see changes in real time
- Visual indicator shows online/offline status and pending sync operations

---

## 4. Item Suggestion System

### Single-Tier Visibility Model

Each category has one set of **visible items** — every visible item appears as a quick-add tile in Add mode. There is no second "less common" tier.

Behind the visible items is the **library**: a per-household pool of every item the autocomplete knows about. The library contains:

- Seed items not initially marked as visible (the unstarred entries in the seed catalog)
- Items the user has previously added to the shopping list (legacy "history" merges into the library)
- Items the user has previously made visible and then removed from a category

The library is never displayed as tiles. It surfaces only through autocomplete, both in the Add page search bar and in the Settings → Suggestions editor.

### Shop / Add mode layout

The shopping list groups by **aisle**, not by category. Category names are not shown in Shop or Add mode — the aisle is the only heading the shopper sees. Within an aisle, list items and (in Add mode) visible-item tiles from every category in that aisle are flattened and alphabetized together. The per-aisle search bar autocompletes against the union of visible + library items across every category in that aisle; when the user selects a suggestion, the item is filed under its correct category behind the scenes. A novel typed name routes to the aisle's first category.

Categories are still first-class in Settings (they govern item grouping for promotion / move / hide / delete), but they are deliberately invisible during shopping to keep the list scannable.

### Promotion / Demotion

- A library item becomes **visible** when the user adds it through the Settings editor's autocomplete (or types a brand-new name there).
- A visible item becomes **library-only** when the user removes it from the visible set in the editor. Its autocomplete entry is preserved.

### Default Items (seed)

On first setup, each seed category is populated from a curated catalog of ~300 items. ~50 of these are marked as visible-by-default; the remaining ~250 are seeded into the library so autocomplete works on day one without surfacing 300 tiles.

### Item Structure (suggestions)

Visible items and library entries share the same shape:

- `id` — unique identifier
- `name` — display name
- `category` — the category the item belongs to (library entries also carry this so autocomplete can place them on add)

---

## 5. Settings → Suggestions Page (Aisle & Category Editor)

A dedicated page for managing the household's aisles, categories, and visible items. The same component is used in onboarding step 2 (with wizard chrome and reorder mode on by default) and as the standalone Settings page (without chrome, reorder mode off by default).

### Layout

- All aisles render as collapsed rows in current order, with a category-count badge per aisle.
- A "Hidden categories ({N})" section sits at the page bottom, omitted when empty.
- A **+ Add aisle** action sits below the aisle list.

### Aisle interactions

- Tap an aisle row to expand it inline; categories appear underneath.
- Inline rename via tapping the aisle name when expanded.
- Overflow `⋯` menu offers *Rename* and *Delete aisle*. Delete is disabled while the aisle still contains categories — its tooltip directs the user to move or delete those categories first.
- Aisles can be deleted outright. There is no "hidden aisle" state.

### Aisle reordering

- Reorder is gated behind a "Reorder aisles" mode. In Settings, the mode is off by default and toggled via a header button. In onboarding, the mode is on by default with framing copy that explains why ordering matters ("drag aisles into the order you walk your store").
- In reorder mode, every aisle row shows a drag handle, all aisles auto-collapse, and tap-to-expand and overflow are suppressed.
- Reorder is never required to advance through onboarding — the seed order is a reasonable default.

### Category interactions

- Tap a category row to expand it inline to the visible-items editor.
- Inline rename via tapping the category name when expanded.
- Overflow `⋯` menu:
  - *Rename*
  - *Move to…* opens a sheet listing all aisles (current aisle disabled). One-time copy at the top of the sheet notes that categories don't remember their original aisle.
  - *Hide category* — single tap, no confirmation. Moves the category out of its aisle into the page-bottom Hidden section. Item data is preserved while hidden.
- Categories cannot be deleted directly. They must first be hidden.

### Visible-items editor (expanded category)

- A wrapped grid of pill chips, one per visible item. Each chip has the item name and a small `×` that demotes it to library-only.
- A single **Add an item…** input below the grid.
  - Typing autocompletes against the library.
  - Tapping a suggestion adds it as a visible chip.
  - Typing a brand-new name and pressing Enter creates the item, adds it to the visible chips, and adds it to the library.
- Empty-state copy: "No suggestions yet. Add some above."

### Hidden categories section

- Each hidden category row has an overflow `⋯` with:
  - *Unhide* — opens a "Move to aisle…" sheet. The user must pick an aisle; a category cannot return to limbo. On selection, the category appears in that aisle with all items intact.
  - *Delete permanently* — confirmation modal naming what's lost: the visible items in that category and the library/autocomplete entries associated with it. Items in other categories are unaffected. The action cannot be undone.

### Add aisle / add category

- **+ Add aisle** opens an inline name input at the bottom of the aisle list. Commit creates an empty aisle (no seed categories).
- **+ Add category** appears at the bottom of an expanded aisle. Commit creates an empty category in that aisle.

### Out of scope (v1)

- Reordering categories within an aisle, or items within a category. Categories follow insertion order; items sort alphabetically.
- Bulk hide / delete / move operations.
- Cross-aisle search inside the editor.
- Recovering deleted aisles, categories, or items.

---

## 6. Aisle & Category System

### Three-Tier Taxonomy

The app organizes shopping data in three tiers: **aisle → category → item**.

- **Aisles** are the top-level grouping. Their order represents the path the user walks through a store, and is therefore user-controlled.
- **Categories** live under exactly one aisle. They group related items.
- **Items** live under exactly one category. The same item name may exist independently under multiple categories (e.g. "tomato" in *vegetable* and in *canned goods*); these are separate entries.

### Seed Taxonomy

A new household is seeded with 9 aisles and 52 categories (defined in the seed catalog). Both are fully editable after onboarding.

### Aisle Behavior

- Renameable, addable, deletable, reorderable.
- Deletion requires the aisle to contain no categories (move or delete its categories first).
- Aisles do not have a "hidden" state. If you don't want an aisle, delete it.
- New aisles are created empty. They have no seed categories.

### Category Behavior

- Renameable, addable, hideable, movable between aisles.
- Reassignment between aisles is destructive: a category does not remember its original aisle.
- Categories cannot be deleted directly — they must first be hidden. Hidden categories live in a global page-bottom section, unattached to any aisle.
- Unhiding a category requires selecting an aisle to place it into.
- Permanent deletion of a hidden category is destructive: the category's visible items and its library/autocomplete entries are lost. Items in other categories are unaffected.
- New categories are created empty (no seed items).

### Item Behavior

- Items are scoped to one category. Deleting their category deletes them.
- Categories expand/collapse independently in the shopping list view.
- Auto-expansion behavior differs by mode (Shop vs Add).

---

## 6a. Onboarding

### Goals

- Establish the user's mental model: this app is meant to mirror *how they shop*, not enforce a canonical taxonomy.
- Get the user to a usable Shop mode quickly, with reasonable defaults they can edit later.

### Flow

1. **Welcome** — short intro framing the app as a tool to align with the user's shopping pattern. Copy: "Let's set up your shopping aisles."
2. **Aisle & Category Editor** — the same component used in Settings (see §5), with wizard chrome and reorder mode on by default. Framing copy: "Drag aisles into the order you walk your store. You can rearrange or edit anything later in Settings." Primary action: **Looks good →**. Secondary: **Reset to defaults** (enabled only after edits).
3. **Land in Shop mode** — the user is dropped into an empty Shop view with a one-time hint pointing at the Add toggle. Building the first list is normal use, not onboarding.

### Notes

- Onboarding is single-pass for now. Users can re-edit aisles, categories, and visible items in Settings at any time.
- No store selection step. Stores are not part of the data model.
- The editor is identical in onboarding and Settings; only the wizard chrome and the default reorder-mode flag differ.

---

## 7. UI/UX Requirements

### Layout

- **Mobile-first** responsive design
- Single-column on small screens
- Multi-column on larger screens (2 columns at md breakpoint, 3 at lg)
- Plus Jakarta Sans font family

### Navigation chrome

The app treats **Shop and Add as co-equal primary modes** of the list page. Other pages (History, Settings, Account) are deliberately tertiary. Navigation chrome adapts to breakpoint:

- **Mobile (< lg):** Top header is minimal — hamburger menu (left), **Shopping List** title (center), small sync dot (right). The header hides on scroll-down to free content space; it reappears on scroll-up. A **fixed bottom nav bar** carries the primary controls: Shop/Add segmented toggle and a contextual Clear chip that appears above the bar when there are checked items. The bottom bar is always visible regardless of scroll. The hamburger menu drops down from the header for tertiary navigation (Shopping List, History, Settings, Account).
- **Desktop (lg+):** A single always-visible top toolbar carries everything: **Shopping List** title (left), Shop/Add segmented toggle (only on the list page), Clear button (only on the list page when items are checked), nav links (List / History / Settings / Account), and the sync pill (right). The hamburger expands inline because horizontal space is plentiful. No bottom bar.

### Clear chip behavior (mobile)

- Renders only when `doneCount > 0`. Disappears when there's nothing to clear.
- **Entry animation:** slides up from the nav bar with a subtle bounce on every appearance.
- **Always present on resume:** if a session opens with items already checked, the chip is visible from load (no transition required).
- **First-run tooltip:** the very first time the chip appears for a device, a one-time callout appears above it ("All done with these? Tap to clear.") that auto-dismisses after ~4s. State is persisted via localStorage flag (`tend.clearChipTooltipSeen.v1`).
- Label includes a live count: `Clear N done`.

### Scroll Behavior

- **Header** (mobile only) hides on scroll down, reappears on scroll up.
- **Bottom nav bar** (mobile only) is fixed-positioned and never hides — it's the always-reachable home for Shop/Add and Clear.
- **Scroll fade effects** — during fast scrolling (>800px/s), UI elements fade or desaturate to improve readability of content while the list is in motion.

### Status Indicators

- **Online/offline indicator** — visual feedback for connectivity state. On mobile, a colored dot in the header. On desktop, a full pill with text label.
- **Pending sync badge** — shows pending sync state via spinner + "Syncing" label (desktop) or blue dot (mobile).
- **Last sync time** — relative timestamp (e.g., "2 minutes ago") shown in the offline banner.

### Safe-area insets

Fixed bottom elements (the mobile bottom nav bar) use `padding-bottom: max(env(safe-area-inset-bottom), 0.75rem)` so the iOS home indicator does not overlap the controls.

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
- Shop-mode `checked` / `unchecked` events may include `itemKey` (stable list identity). **Effective purchases** (used for purchase history, last-purchased, and shortcut intelligence) apply a two-hour rule: an `unchecked` within two hours of the latest still-open `checked` for the same identity voids that check (accidental tap + correction).
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
- 21-day rolling retention; Firebase log cleanup at most weekly per account; IndexedDB prunes each session
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
- Logs: 21-day rolling retention; remote cleanup at most weekly
- Invitation codes: persist after use (for audit trail)

### Browser Support

- Modern mobile browsers (Safari iOS, Chrome Android)
- Desktop Chrome, Firefox, Safari
- PWA install supported on Chrome and Safari
