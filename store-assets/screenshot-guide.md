# App Store Screenshot Guide — Provisions

## Overview

Screenshots are the primary way users evaluate your app before downloading. This guide specifies which simulator configurations to use, which app screens to capture, and how to present them.

**Key principles:**
- Show the core value proposition in the first 1–2 screenshots
- Use a complete, lived-in household (pre-populated taxonomy and list) for realism
- Avoid blank screens or tutorial overlays
- Text overlays are used sparingly — focus on the UI itself

---

## iOS App Store

### Simulator Specifications

Use **Xcode 15+** with these simulators to capture:

1. **iPhone 15 Pro Max (6.7")**
   - Represents the larger, modern flagship
   - Primary viewport for all US/Western markets
   - Default status bar (with Dynamic Island or notch)

2. **iPhone SE (2nd gen, 4.7")**
   - Smaller phone option for variability
   - Shows responsive layout at compact widths
   - Good contrast to the large phone

### Screenshots (6–8 total, ordered left-to-right, top-to-bottom)

All screenshots should show:
- Status bar visible (time ~9:41, signal + WiFi + battery at 100%)
- No debug panel or development indicators
- Device in Light mode
- Typical iOS system fonts

#### Screenshot 1: Shop Mode — The Core Experience (6.7" + 5.5")
**File:** `ios_1_shop_mode.png` (6.7") + `ios_1_shop_mode_small.png` (5.5")

**Setup:**
- Display household with 3+ aisles, each with 2–3 items
- First aisle (e.g., "Produce") expanded, showing items like "Apples", "Carrots", "Spinach"
- 1–2 items marked checked (✓) in the first aisle
- Show the coral check icon + item crossed out
- Bottom nav visible: Shop (active) + Add toggle + Clear chip (visible since items are checked)

**What this conveys:**
- The quick-add, organized-by-aisle core experience
- Checked-item state and the Clear action
- Multi-aisle navigation without tabs

**Optional overlay text:** "Tap to check. Swipe to clear." (place top-left, white/semi-transparent)

#### Screenshot 2: Add Mode — Suggest Library (6.7" + 5.5")
**File:** `ios_2_add_mode.png` (6.7") + `ios_2_add_mode_small.png` (5.5")

**Setup:**
- Same household, now in Add mode (bottom nav toggle active)
- Top of screen shows the aisle bar and search input (empty or pre-populated with an aisle)
- Below: quick-add tiles (visible shortcuts) from that aisle — e.g., "Milk", "Bread", "Eggs"
- Tiles are coral + text, tappable
- A few library items visible below the quick-add area (grayed out, for autocomplete reference)

**What this conveys:**
- The routine, one-tap re-add experience
- Quick-add shortcuts prominently featured
- Search/suggestions ready to go

**Optional overlay text:** "Tap to add. No typing." (place bottom-left)

#### Screenshot 3: Item Sheet — Bottom Sheet (6.7" only)
**File:** `ios_3_item_sheet.png` (6.7")

**Setup:**
- Shop mode, tap an item (e.g., "Apples") to open the bottom sheet
- Sheet shows:
  - Item name + edit field
  - Quantity field (pre-filled, e.g., "3")
  - Aisle › Category breadcrumb (tappable)
  - "Add to shortcuts" button or "Remove from shortcuts" if already pinned
  - Metadata row (e.g., "Added by Sarah, 2 days ago")
- Show swipe-to-dismiss gesture indicator at the top (small gray pill)

**What this conveys:**
- Inline editing without leaving the list
- Shortcut curation UX
- Household attribution (coordination signal)

**No overlay text.** Let the UI speak.

#### Screenshot 4: Paywall — Trial Ending / Read-Only (6.7" + 5.5")
**File:** `ios_4_paywall_trial_ending.png` (6.7") + `ios_4_paywall_trial_ending_small.png` (5.5")

**Setup:**
- Paywall sheet in the foreground
- Headline: "Subscribe to keep editing Provisions"
- Price: "$3.99 per year" (or localized with RC price display)
- "2 months free, then billed annually."
- Three feature bullets (✓):
  - Real-time household sync
  - Unlimited items and shortcuts
  - Invite household members
- Two buttons: "Subscribe" (coral) + "Restore purchases" (outline)
- Legal footer visible

**What this conveys:**
- Clear pricing and trial terms
- Feature differentiation
- Trust signals (legal links, restore option)

**Optional overlay text:** None — this is a key screen, no need to explain.

#### Screenshot 5: Household Management / Account (6.7" only)
**File:** `ios_5_household_account.png`

**Setup:**
- Account page visible (accessed from nav)
- Shows:
  - Display name field (e.g., "Sarah")
  - Household members list with 2+ member names (e.g., "Sarah, Alex")
  - Subscription status row: "Provisions Pro — Renews Apr 28, 2027" or "Trial ends Apr 30, 2026"
  - "Invite code" section with a sample 16-char code (visible, copyable)
  - "Delete account" button (red/destructive, at bottom)

**What this conveys:**
- Multi-member household is real and integrated
- Invite workflow is discoverable
- Subscription details are transparent
- Data control (delete account) is available

**Optional overlay text:** "Invite your household" (place above invite code)

---

## Android Google Play

### Simulator Specifications

Use **Android Studio 2023.2+** with these emulators:

1. **Pixel 8 Pro (6.7", API 34)**
   - Flagship Android phone, modern screen ratio
   - Primary for US market

2. **Pixel 5 (6.0", API 34)**
   - Mid-range alternative, slightly narrower
   - Shows responsive layout flexibility

3. **Pixel Tablet (11.0", API 34)** — *optional*
   - Tablet variant if supporting landscape/tablets
   - Deferred if app is phone-only

### Screenshots (5–6 total)

Structure mirrors iOS but can be more flexible on Android. Use the same 5 core screens:

1. **Shop Mode** (`android_1_shop_mode.png`, `android_1_shop_mode_tablet.png`)
2. **Add Mode** (`android_2_add_mode.png`)
3. **Item Sheet** (`android_3_item_sheet.png`)
4. **Paywall** (`android_4_paywall.png`)
5. **Account/Household** (`android_5_account.png`)

Same setup and messaging as iOS. Adjust for Android system chrome:
- Status bar styling (system font, system icons)
- Navigation (bottom nav for phone, top nav if present)
- Adaptive layout (same content, responsive padding/spacing)

---

## Screenshot Capture Workflow

### Preparation

Before capturing, set up the test household:

1. **Test Account Setup**
   ```
   Email: test@myprovisions.app (or similar)
   Household: "Demo Household"
   Members: 2+ (e.g., "Sarah", "Alex")
   ```

2. **Seed the Household with Data**
   - All 10 aisles visible
   - 3–5 items per aisle
   - At least one item marked checked (for Shop mode screenshots)
   - At least one quick-add tile pinned (for Add mode screenshots)
   - Invite code generated and visible in Account

3. **Device / Simulator Setup**
   - Light mode (no dark mode variants for launch)
   - System time: 9:41 AM (standard iOS simulator default, Android: adjust to match)
   - Battery at 100%
   - WiFi + cellular connected (full signal)
   - No notifications in the tray

### Capture Process

**iOS (Xcode simulator):**
```bash
# Using Xcode Device Organizer:
1. Open simulator
2. Navigate to the desired screen
3. Hardware → Device → Screenshot (or cmd+S)
4. Saved to ~/Library/Developer/Xcode/DerivedData/.../Logs/System.log (or desktop)

# Or use xcrun:
xcrun simctl io booted screenshot ~/Desktop/ios_screenshot.png
```

**Android (Android Studio):**
```bash
# Using Android Studio Logcat:
1. Run app in emulator
2. Device → Take Screenshot (button in Device File Explorer)
3. Saved to local machine

# Or use adb:
adb exec-out screencap -p > ~/Desktop/android_screenshot.png
```

### Image Processing

After capture:

1. **Crop to device frame** — remove any extra UI outside the device boundaries
2. **Resize for store submission:**
   - iOS: 5.5" variant should be 1242 × 2688 px (or equivalent ratio)
   - iOS: 6.7" variant should be 1290 × 2796 px
   - Android: 1440 × 3120 px (Pixel 8 Pro standard)
3. **Optional: Add subtle white border** around each screenshot (1–2 px) for clarity
4. **Name files consistently:** `ios_N_description.png`, `android_N_description.png`

### Overlay Text (if used)

Minimal overlays only — the UI is the marketing. If adding text:
- White text, center-aligned, placed top-left or bottom-left
- Font: Helvetica Neue, 48–56 pt, medium weight
- Background: semi-transparent black (0.3–0.5 alpha) for readability
- Padding: 20 px from edge

Example text (do NOT add unless clarifying a non-obvious action):
- "Tap to check. Swipe to clear."
- "Tap to add. No typing."
- "Invite your household"

---

## Checklist Before Submission

- [ ] 6–8 iOS screenshots captured (5.5" and 6.7" variants)
- [ ] 5–6 Android screenshots captured (phone at minimum, tablet optional)
- [ ] All filenames follow convention: `platform_N_description.png`
- [ ] All images are RGB (not CMYK)
- [ ] All images are PNG format, under 1 MB each
- [ ] Device chrome is visible (status bar, safe areas)
- [ ] No debug indicators, console logs, or development UI
- [ ] Test account and invite code are live (not placeholder stubs)
- [ ] Text overlays (if any) are readable and on-brand
- [ ] Review with non-technical stakeholders to ensure clarity

---

## Notes for Future Submissions

- **Seasonal updates:** Update paywall and household screenshots every few months to keep store listings fresh
- **Localization:** When translating app, translate overlay text and confirm layouts work in other languages
- **Dark mode:** If dark mode is added, create a second set of screenshots with dark theme
- **Tablet support:** If Android tablet support launches, add tablet-landscape variants to App Store (separate region)
