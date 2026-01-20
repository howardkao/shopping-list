# Shopping List App - Deployment Guide

A collaborative shopping list app with email authentication, invitation codes, and real-time synchronization.

## Features

- 🔐 Email/password authentication
- 👥 First user automatically becomes admin
- 🎫 Invitation code system for new users
- 📝 Categorized shopping lists
- ✅ Check off items as you shop
- 🔄 Real-time synchronization across devices
- 📱 Mobile-friendly responsive design
- 💾 Persistent storage with Firebase

## Prerequisites

Before you begin, make sure you have:
- Node.js installed (version 16 or higher)
- A Firebase account (free tier is fine)
- Basic command line knowledge

## Step 1: Set Up Firebase

### 1.1 Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"** or **"Create a project"**
3. Enter a project name (e.g., "my-shopping-list")
4. Accept terms and click **Continue**
5. Disable Google Analytics (optional) and click **Create project**
6. Wait for project creation, then click **Continue**

### 1.2 Enable Authentication

1. In the Firebase Console, click **"Authentication"** from the left menu
2. Click **"Get started"**
3. Click the **"Sign-in method"** tab
4. Click **"Email/Password"**
5. Toggle **"Enable"** to ON
6. Click **"Save"**

### 1.3 Set Up Firestore Database

1. In the Firebase Console, click **"Firestore Database"** from the left menu
2. Click **"Create database"**
3. Select **"Start in test mode"** (we'll secure it later)
4. Choose your preferred location (closer to you is better)
5. Click **"Enable"**

### 1.4 Set Up Realtime Database

1. In the Firebase Console, click **"Realtime Database"** from the left menu
2. Click **"Create Database"**
3. Select your preferred location
4. Select **"Start in test mode"**
5. Click **"Enable"**

### 1.5 Get Your Firebase Configuration

1. In the Firebase Console, click the **gear icon** ⚙️ next to "Project Overview"
2. Click **"Project settings"**
3. Scroll down to **"Your apps"**
4. Click the **web icon** `</>`
5. Enter an app nickname (e.g., "Shopping List Web")
6. **Don't** check "Also set up Firebase Hosting" (we'll do this separately)
7. Click **"Register app"**
8. **Copy the firebaseConfig object** - you'll need this in the next step!

It will look something like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

## Step 2: Configure Your Project

### 2.1 Extract the Project Files

1. Extract the shopping-list-app.zip file to a folder on your computer
2. Open a terminal/command prompt
3. Navigate to the project folder:
   ```bash
   cd path/to/shopping-list-app
   ```

### 2.2 Update Firebase Configuration

1. Open the file `src/firebase.js` in a text editor
2. Replace the placeholder config with your actual Firebase config from Step 1.5
3. Save the file

**Before:**
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  // ...
};
```

**After:**
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef123456"
};
```

### 2.3 Update Firebase Project ID

1. Open the file `.firebaserc` in a text editor
2. Replace `YOUR_PROJECT_ID_HERE` with your actual Firebase project ID
3. Save the file

**Before:**
```json
{
  "projects": {
    "default": "YOUR_PROJECT_ID_HERE"
  }
}
```

**After:**
```json
{
  "projects": {
    "default": "your-project"
  }
}
```

## Step 3: Install Dependencies

In your terminal, run:

```bash
npm install
```

This will install all the necessary packages. It may take a few minutes.

## Step 4: Test Locally (Optional but Recommended)

Before deploying, you can test the app locally:

```bash
npm run dev
```

This will start a local development server. Open the URL shown in your terminal (usually http://localhost:5173) in your browser to test the app.

Press `Ctrl+C` to stop the local server when you're done testing.

## Step 5: Deploy to Firebase Hosting

### 5.1 Install Firebase CLI

If you haven't already, install the Firebase command line tools globally:

```bash
npm install -g firebase-tools
```

### 5.2 Login to Firebase

```bash
firebase login
```

This will open your browser. Sign in with the same Google account you used for the Firebase Console.

### 5.3 Build Your App

Create the production build:

```bash
npm run build
```

This creates an optimized version of your app in the `dist` folder.

### 5.4 Deploy to Firebase

```bash
firebase deploy
```

Wait for the deployment to complete. You'll see a message like:

```
✔  Deploy complete!

Hosting URL: https://your-project.web.app
```

## Step 6: Access Your App

1. Open the Hosting URL in your browser (it will be in the format: `https://your-project.web.app`)
2. Create your first account - this user will automatically become the admin
3. As admin, go to Menu → Admin Panel to generate invitation codes for other users

## Step 7: Add to Home Screen (Mobile)

### iPhone:
1. Open the app in Safari
2. Tap the Share button
3. Tap "Add to Home Screen"
4. Tap "Add"

### Android:
1. Open the app in Chrome
2. Tap the menu (three dots)
3. Tap "Add to Home Screen"
4. Tap "Add"

## Making Updates

When you want to make changes to your app:

1. Edit the code
2. Test locally: `npm run dev`
3. Build: `npm run build`
4. Deploy: `firebase deploy`

## Security Rules (Important!)

The test mode rules allow anyone to read/write your database. Here's how to secure your app:

### Firestore Rules

In the Firebase Console, go to Firestore Database → Rules and replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /admins/{userId} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

### Realtime Database Rules

In the Firebase Console, go to Realtime Database → Rules and replace with:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Click **"Publish"** for both.

## Troubleshooting

### "npm: command not found"
- Install Node.js from https://nodejs.org

### "firebase: command not found"
- Run: `npm install -g firebase-tools`
- If that doesn't work, try with sudo: `sudo npm install -g firebase-tools`

### Build fails with Firebase config error
- Make sure you replaced ALL the placeholder values in `src/firebase.js`
- Check that your Firebase config is complete and valid

### Can't sign in after deploying
- Make sure Email/Password authentication is enabled in Firebase Console
- Check the browser console for error messages
- Verify your Firebase config is correct in `src/firebase.js`

### App loads but data doesn't sync
- Check that both Realtime Database and Firestore are created
- Verify the database URLs in your Firebase config
- Check the database rules

## Need Help?

If you run into issues:
1. Check the browser console for errors (F12 → Console tab)
2. Verify all Firebase services are enabled
3. Make sure your Firebase config is correct
4. Try testing locally first with `npm run dev`

## Project Structure

```
shopping-list-app/
├── src/
│   ├── App.jsx          # Main application component
│   ├── firebase.js      # Firebase configuration
│   ├── main.jsx         # React entry point
│   └── index.css        # Global styles
├── index.html           # HTML template
├── package.json         # Dependencies and scripts
├── vite.config.js       # Vite configuration
├── tailwind.config.js   # Tailwind CSS configuration
├── firebase.json        # Firebase hosting configuration
└── .firebaserc          # Firebase project configuration
```

## Tech Stack

- **Frontend:** React 18
- **Styling:** Tailwind CSS
- **Icons:** Lucide React
- **Build Tool:** Vite
- **Authentication:** Firebase Auth
- **Database:** Firebase Realtime Database + Firestore
- **Hosting:** Firebase Hosting
