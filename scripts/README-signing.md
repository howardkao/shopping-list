# Build Signing & Release Guide

Step-by-step instructions for signing and submitting Provisions to the App Store and Google Play.

---

## iOS

### 1. Prerequisites

- Full Xcode (not just Command Line Tools) installed from the Mac App Store.
- Active Apple Developer Program membership.
- App ID `com.provisionsapp.shoppinglist` registered in [Apple Developer → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).

### 2. Configure automatic signing in Xcode

Automatic signing is already enabled in the Xcode project (`CODE_SIGN_STYLE = Automatic`). You only need to assign your team once:

1. Open `ios/App/App.xcworkspace` in Xcode (always use the `.xcworkspace`, not `.xcodeproj`).
2. In the Project Navigator, select the **App** project (top item).
3. Select the **App** target → **Signing & Capabilities** tab.
4. Under **Signing (Release)**, set **Team** to your Apple Developer account.
5. Xcode writes your Team ID (`DEVELOPMENT_TEAM = XXXXXXXXXX`) into `App.xcodeproj/project.pbxproj` automatically.
6. Verify there are no red "No account" or "No matching provisioning profiles" errors.

> Your Team ID is a 10-character alphanumeric string visible at
> [developer.apple.com → Membership](https://developer.apple.com/account).

### 3. Archive the build

1. Connect a real device *or* choose **Any iOS Device (arm64)** from the scheme destination — you cannot archive against a simulator.
2. In Xcode menu: **Product → Archive**.
3. Wait for the archive to complete. The Organizer window opens automatically.

### 4. Upload to App Store Connect (TestFlight)

1. In the Organizer, select the new archive and click **Distribute App**.
2. Choose **App Store Connect** → **Upload**.
3. Leave all checkboxes at their defaults (bitcode, symbols, manage version numbers).
4. Sign in with your Apple ID when prompted.
5. Xcode validates and uploads. This typically takes 2-5 minutes.

After upload, App Store Connect processes the build for ~15 minutes before it appears in TestFlight.

### 5. Submit for TestFlight internal testing

1. Open [App Store Connect → TestFlight](https://appstoreconnect.apple.com/).
2. Select your app → **TestFlight** tab.
3. Wait for the build status to change from "Processing" to a green checkmark.
4. Under **Internal Testing**, click the **+** next to the build to add it.
5. Internal testers (your Apple ID and any other Developer/Admin accounts) can install immediately.

### 6. Submit for App Store Review

Once internal testing passes:

1. App Store Connect → **App Store** tab → **+VERSION** (or edit the existing version).
2. Under **Build**, click **+** and select the TestFlight build.
3. Fill out release notes.
4. Click **Submit for Review**.

First submission with IAP typically receives extra scrutiny. Verify:
- **Restore Purchases** button is visible and functional.
- Subscription terms (price, duration, cancellation) are shown before the purchase confirmation.
- Privacy Policy URL is set in App Store Connect.

---

## Android

### 1. Generate the upload keystore (run once)

Google Play uses an **upload key** to verify that updates come from you. Run this once and store the result securely:

```bash
keytool -genkey -v \
  -keystore provisions-upload.keystore \
  -alias provisions-upload \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

When prompted:
- **Keystore password:** choose a strong password (save it; you cannot recover it)
- **Key password:** can be the same as the keystore password
- **Distinguished name fields:** your name / organization / country are fine

> **Critical:** losing this keystore means you can never update the app on Play. Google does
> offer a key recovery process, but it is slow and not guaranteed.
>
> Store the keystore and passwords in **1Password** (or equivalent). Do **not** commit it to
> the repository — `*.keystore` and `*.jks` are in `.gitignore`.

### 2. Set environment variables

Before running the build script, export the four required vars in your shell (or add them to a local `.env` file that you source manually):

```bash
export ANDROID_KEYSTORE_PATH="/path/to/provisions-upload.keystore"
export ANDROID_KEYSTORE_PASSWORD="your-keystore-password"
export ANDROID_KEY_ALIAS="provisions-upload"
export ANDROID_KEY_PASSWORD="your-key-password"
```

### 3. Run the release build

```bash
./scripts/build-android-release.sh
```

This script:
1. Validates all four env vars and checks that the keystore file exists.
2. Runs `npm run cap:sync` to build the web app and copy assets into `android/`.
3. Runs `./gradlew bundleRelease` from the `android/` directory.
4. Reports the output path on success.

Output: `android/app/build/outputs/bundle/release/app-release.aab`

### 4. Upload to Play Console internal testing

1. Open [Google Play Console](https://play.google.com/console/) → select the Provisions app.
2. **Testing → Internal testing → Create new release**.
3. Upload the `.aab` file from step 3.
4. Add release notes and click **Save → Review release → Start rollout to Internal testing**.
5. Internal testers receive the update within minutes (no review required for internal testing).

### 5. Promote to production

Once internal testing passes:

1. Play Console → **Testing → Internal testing** → select the release → **Promote release → Production**.
2. Set rollout percentage (10% is typical for first release; increase after confirming no crashes).
3. First submission typically takes 1-3 days for review.

---

## Version bumps

Before each release, update the version in two places:

- **iOS:** `ios/App/App/Info.plist` → `CFBundleShortVersionString` (display) and `CFBundleVersion` (build number, increment for each upload)
- **Android:** `android/app/build.gradle` → `versionName` (display) and `versionCode` (must increment for each upload)

Keep the two display versions in sync (`versionName` = `CFBundleShortVersionString`).
