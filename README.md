# Household Shopping List

A self-hosted collaborative shopping list app for a single household. Built with React and Firebase — deploy your own copy in about 20 minutes.

**What it does:**
- Shared, real-time shopping list across all household members' devices
- Organize items by category; check them off as you shop
- Suggestion system — items you've bought before surface as quick-adds
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
   - **Firestore Database** → Create database → Start in **production mode**
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
```

### 4. Deploy Firebase security rules

```bash
firebase login
firebase use --add   # select your project
firebase deploy --only database,firestore
```

### 5. Customize for your household

Before your first deploy, edit two constants in `src/App.jsx`:

**Categories** (line ~33) — replace with the stores and sections that match how you shop:
```js
const CATEGORIES = ['PRODUCE', 'MEAT & FISH', 'DAIRY & EGGS', 'FROZEN', 'DRY GOODS', ...];
```

**Default suggestions** (line ~85) — seed items you buy regularly in each category:
```js
const DEFAULT_ITEMS = {
  'PRODUCE': ['broccoli', 'carrots', 'onions'],
  'DAIRY & EGGS': ['eggs', 'milk', 'butter'],
  ...
};
```

You can also edit these from within the app after setup, but starting with sensible defaults saves time.

### 6. Run locally or deploy

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

## First use and admin setup

1. Open the app and register the **first account** — this account automatically becomes the admin. Use a real email you control.
2. As admin, open the **Admin Panel** (shield icon) to generate invite codes for other household members.
3. Share each invite code privately. Each code is single-use and expires after 7 days.
4. Other household members register using their invite code — they're then in your shared list.

> **There's no separate admin-creation step.** Whoever registers first is the admin. If you're setting this up for your household, register yourself first before sharing the URL.

---

## How the app works

**Shopping list** — add items with a category, check them off as you shop. Checked items move to the bottom; clear them all at once when you're done.

**Add mode vs Shop mode** — toggle between browsing your suggestion library (Add mode) and checking off the active list (Shop mode).

**Suggestion library** — items are organized as "common" (shown by default) and "less common" (shown on demand). Edit the library from the Edit Suggestions page.

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
| Admin data | Firestore |
| Hosting | Firebase Hosting |
| Offline | Service Worker + IndexedDB |

---

## License

[Elastic License 2.0](LICENSE) — source available, free for personal and non-commercial use. You may not offer this software as a hosted or managed service to third parties.
