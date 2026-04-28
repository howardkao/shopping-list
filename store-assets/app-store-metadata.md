# App Store Metadata — Provisions

## iOS App Store Connect

### App Information

**App Name** (30 chars max)
```
Provisions
```

**Subtitle** (30 chars max)
```
Shared household shopping
```

**Description** (4000 chars max)
```
Provisions is the shopping list that remembers.

Most of what you buy is the same every week. Yet every shopping list app makes you type it all again. Provisions is built around what your household actually buys — your standing items, organized by where you find them in the store.

ROUTINE SHOPPING IS 80% OF SHOPPING
• One partner notices the coffee is low on Tuesday. The other finishes the bread on Friday. Both are in the list before either of you shops.
• Tap what's running low. Your list is done in seconds.
• Organized in the order you walk your store. No backtracking. No forgetting.

ONE PRICE FOR YOUR WHOLE HOUSEHOLD
Subscribe once. All household members get full access. Invite family to add items, check things off, and sync in real-time.

TWO-MONTH FREE TRIAL
Start free. No card required. Cancel anytime during your trial.

PROVISIONS PRO INCLUDES
• Real-time household sync — see updates instantly
• Unlimited items and shortcuts — organize your way
• Invite household members — everyone contributes

Terms of Use: https://myprovisions.app/terms
Privacy Policy: https://myprovisions.app/privacy

The shopping list you actually use. The way you actually shop.
```

**Keywords** (100 chars max)
```
shopping list, household, shared, grocery, family
```

**Promotional Text** (170 chars max) — *optional, can promote trial or launch offers*
```
Two months free. No card required. $3.99/year after trial, covers your whole household.
```

### Subscription Description

**Provisions Pro** (what appears on the subscription/purchase sheet in App Store)
```
Name: Provisions Pro
Description: Household sync and unlimited shortcuts.
```
*Note: Terms of Use and Privacy Policy links are included in the main App Description above to satisfy EULA requirements while staying within the 45-character subscription description limit.*

### Metadata

**Age Rating:** 4+

**Category:** Shopping

**Support URL:** `https://myprovisions.app/support`

**Privacy Policy URL:** `https://myprovisions.app/privacy`

**Terms of Use (EULA) URL:** `https://myprovisions.app/terms`

---

## Android Google Play

### Store Listing

**Title** (50 chars max)
```
Provisions: Shared Shopping List
```

**Short Description** (80 chars max)
```
Stop retyping groceries. Provisions remembers what you buy.
```

**Full Description** (4000 chars max)
```
Provisions is the shopping list that remembers what your household actually buys.

STOP RETYPING THE SAME GROCERIES EVERY WEEK
Most of what you buy is the same from week to week. You buy milk. You buy bread. You buy coffee. Yet every shopping list app makes you type them all again.

Provisions is built around the routine — your household's standing items, organized by where you find them in your store.

HOW IT WORKS
One partner notices the coffee is running low on Tuesday. The other sees the bread is stale on Friday. By the time anyone goes shopping, both items are already on the list. Tap what's running low. Your list is done in seconds.

ORGANIZE BY YOUR STORE LAYOUT
Aisles and categories mapped to your store. Walk your store, not in circles.

SHARE WITH YOUR HOUSEHOLD
Invite family members to add items in real-time. Contributions sync instantly. One subscription covers everyone.

PROVISIONS PRO SUBSCRIPTION
• Real-time household sync
• Unlimited items and shortcuts
• Invite household members
• Full access after 2-month free trial

$3.99/year. No additional charges. Cancel anytime.

Terms of Use: https://myprovisions.app/terms
Privacy Policy: https://myprovisions.app/privacy

Start your free trial today. No card required.
```

### Subscription Description

**Provisions Pro** (what appears on the subscription/purchase sheet in Play Store)
```
Real-time household sync. Unlimited items and shortcuts. Invite household members.

$3.99 per year after 2-month free trial. Renews automatically.
```

### Store Information

**Content Rating:** All ages (no mature content)

---

## Subscription Messaging (Both Stores)

### What's Included (the 3-bullet paywall set)

Used in both in-app paywall and store subscription details:

```
✓ Real-time household sync
✓ Unlimited items and shortcuts
✓ Invite household members
```

### Trial + Pricing Statement

Consistent across all surfaces:

```
2 months free. Then $3.99 per year. One price covers your whole household.
```

---

## Notes for Store Configuration

1. **iOS App Store Connect**
   - Create subscription group "Provisions Pro"
   - Annual subscription product ID: `com.provisionsapp.shoppinglist.paid.annual`
   - Price tier: $3.99 USD/year
   - **Do NOT configure an introductory offer** — trial is handled by Firebase, not the App Store
   - Subscription description will be shown to users during purchase flow

2. **Android Google Play Console**
   - Base plan: `provisions_paid:provisions-202604` or similar slug
   - Billing period: Annual
   - Price: $3.99 USD/year
   - **Do NOT configure a trial or promo pricing** — trial is Firebase-based
   - Subscription description shown during checkout

3. **Metadata Review**
   - Verify "Provisions" trademark cleared in target jurisdictions
   - Ensure Privacy Policy URL points to live `src/LegalPages.jsx` (privacy tab)
   - Ensure Terms of Service URL also available from legal pages
   - Both URLs must be accessible and match legal counsel review

4. **Localization** (out of scope for WP-8, but listed for reference)
   - Metadata here is English-US only
   - Translation to other languages deferred post-launch
