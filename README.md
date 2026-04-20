# Provisions

A self-hosted collaborative shopping list app for a single household. Built with React and Firebase — deploy your own copy in about 20 minutes.

**What it does:**
- Shared, real-time shopping list across all household members' devices
- Organize items by category; check them off as you shop
- Suggestion system — items you've bought before surface as shortcut tiles in Plan mode
- Works offline; syncs when connectivity returns
- Invite-code system so only your household can sign in
- Mobile-friendly PWA (add to home screen on iOS/Android)

---

## Prerequisites

- [Node.js](https://nodejs.org/) 16+
- A [Firebase](https://firebase.google.com/) account (free Spark plan is sufficient for a single household)
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`

---

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project
2. Enable these services:
   - **Authentication** → Sign-in method → Email/Password
   - **Realtime Database** → Create database → Start in **locked mode**
   - **Hosting** (optional — only needed if you want to use Firebase Hosting)

### 2. Get your Firebase config

In the Firebase Console: Project Settings → General → Your apps → Add app → Web. Copy the config object — you'll need the values in the next step.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in `.env` with your Firebase project's values:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project-id.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
# Optional — enables Firebase / Google Analytics (measurement ID from Firebase Console → Project settings)
# VITE_FIREBASE_MEASUREMENT_ID=G-XXXXXXXXXX
VITE_RECAPTCHA_SITE_KEY=...   # reCAPTCHA v3 site key; register in Firebase Console → App Check (required for production)
```

### 4. Deploy Firebase security rules

```bash
firebase login
firebase use --add   # select your project
firebase deploy --only database
```

### 5. Run locally or deploy

**Local dev:**
```bash
npm install
npm run dev
```

**Deploy to Firebase Hosting:**
```bash
npm run build
firebase deploy --only hosting
```

---

## First use and household setup

1. Open the app and register the **first account** — choose "New household" to create one. The creator becomes the household admin. Use a real email you control.
2. A first-run onboarding flow walks you through the seeded aisles, categories, and suggested items so you can reorder, rename, hide, or add whatever matches how you shop.
3. Admins can open **Invite Household Members** to generate 16-character invite codes. Each code is single-use and expires after 7 days. Share each code privately.
4. Other household members register with an invite code and land in the same shared list.

---

## How the app works

**Shopping list** — add items, check them off as you shop. Items are grouped by aisle so they appear in the order you walk the store.

**Plan mode vs Shop mode** — toggle between browsing suggestion tiles and curating the list (Plan mode) and checking off the active list (Shop mode).

**Suggestions** — every household is seeded with aisles, categories, and items. Items in each category are either **visible** (shown as shortcut tiles in Plan mode) or in the **library** (searchable via autocomplete). Edit the taxonomy from Settings → Suggestions.

**Offline support** — the app caches data locally and works without a connection. Changes sync automatically when you're back online.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18 |
| Build | Vite |
| Styling | Tailwind CSS |
| Auth | Firebase Auth (email/password) |
| Shopping data | Firebase Realtime Database |
| Hosting | Firebase Hosting |
| Offline | Service Worker + IndexedDB |

---

## License

[Elastic License 2.0](LICENSE) — source available, free for personal and non-commercial use. You may not offer this software as a hosted or managed service to third parties.
