# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
- `npm run dev` - Start Vite development server
- `npm run build` - Build for production (outputs to `dist/`)
- `npm run preview` - Preview production build locally

### Firebase Deployment
- `firebase deploy` - Deploy to Firebase Hosting
- `firebase deploy --only hosting` - Deploy only the hosting component
- `firebase deploy --only database` - Deploy only database rules
- `firebase deploy --only firestore` - Deploy only Firestore rules

## Environment Setup

Firebase configuration is loaded from environment variables prefixed with `VITE_`. Copy `.env.example` to `.env` and fill in your Firebase project credentials:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

## Architecture Overview

### Technology Stack
- **Frontend:** React 18 (single-file App.jsx component)
- **Build Tool:** Vite
- **Styling:** Tailwind CSS with custom styling for Plus Jakarta Sans font
- **Authentication:** Firebase Auth (email/password)
- **Data Storage:**
  - Firebase Realtime Database for shopping items and invitation codes
  - Firestore for admin records only

### Data Model

The app uses **two separate Firebase databases**:

#### Realtime Database Structure
```
├── users/{uid}
│   ├── email
│   ├── createdAt
│   └── isFirstUser
├── inviteCodes/{codeId}
│   ├── code
│   ├── expiresAt
│   ├── used
│   ├── usedBy (optional)
│   └── usedAt (optional)
├── shopping-list (array of items)
├── shopping-history (array of item names)
├── common-items/{encodedCategory}
│   └── array of {id, name}
└── less-common-items/{encodedCategory}
    └── array of {id, name}
```

#### Firestore Structure
```
└── admins/{uid}
    ├── email
    └── createdAt
```

**Why two databases?** Admin data is stored in Firestore to allow secure server-side queries (checking if a user is admin). Shopping list data uses Realtime Database for simpler real-time synchronization.

### Category Name Encoding

Category names contain Firebase-invalid characters (`/`, `.`, `#`, `$`, `[`, `]`). The `encodeCategory()` and `decodeCategory()` functions handle conversion:
- Categories are encoded when saving to Firebase
- Categories are decoded when reading from Firebase
- See `encodeCategory()` in src/App.jsx:33-40

### Authentication Flow

1. **First user:** Automatically becomes admin (no invitation code required)
2. **Subsequent users:** Require a valid, unused invitation code
3. **Admin users:** Can generate invitation codes via Admin Panel
4. **Password reset:** Users can request password reset emails from the login screen

### Key Components (App.jsx)

- **Login:** Email/password authentication with invite code system
- **AdminPanel:** Generate and manage invitation codes (admin-only)
- **App (main):** Two-page application:
  - **Shopping List page** (`currentPage === 'list'`):
    - Two modes: "Shop" mode (check off items) and "Add" mode (quick-add from suggestions)
    - Categories auto-expand based on mode and content
    - Real-time sync with Firebase
    - Online/offline status indicator
  - **Edit Suggestions page** (`currentPage === 'edit'`):
    - Manage common vs less-common items per category
    - Add, edit, delete, and toggle item visibility
    - Items sorted alphabetically within categories

### UI/UX Features

- **Scroll behavior:** Header hides on scroll down, reappears on scroll up. Toolbar becomes sticky when scrolling.
- **Scroll fade effects:** During fast scrolling (>800px/s), certain UI elements fade or desaturate for improved readability
- **Responsive design:** Mobile-first with multi-column layouts on larger screens (md: 2 cols, lg: 3 cols)
- **Real-time status:** Visual indicators for online/offline status and pending sync operations

### State Management

All state is managed via React hooks in the main App component:
- `user` and `isAdmin` - Authentication state
- `list` - Current shopping list items
- `history` - Set of previously added item names (for search suggestions)
- `commonItems` and `lessCommonItems` - Item suggestions by category
- `quickAddMode` - Toggle between Shop and Add modes
- `expandedCategories` - Track which categories are expanded/collapsed

### Firebase Security Rules

- **Realtime Database:** Users can read/write their own data and all authenticated users can access shopping list, history, and item suggestions
- **Firestore:** Only admins can read admin collection; no direct writes allowed (admins created through app logic)

### Predefined Categories

Categories are defined in `CATEGORIES` constant (App.jsx:14) and cannot be changed at runtime:
```
['VEGGIES', 'FRUIT', 'MEAT & FISH', 'DELI, DAIRY, EGGS', 'FROZEN',
 'DRY GOODS', 'BAKING, SPICES & OILS', 'PREPARED FOODS',
 'PHARMACY / OTC', 'TARGET / AMAZON / COSTCO', 'COSTCO BULK FOODS',
 'RANCH 99 / WEEE / BERKELEY BOWL']
```

## Production Logging System

A comprehensive logging system automatically captures client-side events for debugging:

- **Automatic collection**: Always enabled, logs stored in Firebase for 30 days
- **Log categories**: Auth, Network, Firebase, Sync, OfflineStorage, App, Error
- **Admin access**: View logs via Admin Panel → "View Production Logs"
- **Debug panel**: Available to admins via bug icon, Ctrl+Shift+D, or ?debug=true
- **Retention**: Automatic cleanup after 30 days (runs daily on login)
- **Storage**: Firebase (`/logs/{userId}/{sessionId}/`) + IndexedDB (offline)

See `LOGGING.md` for detailed documentation.

## Notes

- The entire React application is contained in a single file: `src/App.jsx`
- Default item suggestions are defined in `DEFAULT_ITEMS` object (App.jsx:17-30)
- Invitation codes expire after 7 days and are 8 characters long (uppercase alphanumeric)
- Shopping list items have structure: `{id, name, category, quantity, done}`
