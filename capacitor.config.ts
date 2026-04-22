/// <reference types="@capacitor-firebase/authentication" />

/**
 * Native shell (Capacitor 8) for the Vite app. Use `npm run cap:sync` (build + temporary
 * `dist/index.html` for Capacitor + sync + cleanup). Plain `npm run build` leaves no root
 * `index.html` so Firebase can serve `landing.html` at `/`.
 *
 * Toolchain notes (fill in on your machine — WP-3 step 7):
 * - This repo was scaffolded in an environment where `xcodebuild` was not available (only Command Line Tools)
 *   and no Java runtime was on PATH. For iOS use full Xcode; for Android use JDK 17+ (Temurin 17 is typical) and
 *   Android Studio’s bundled Gradle.
 * - Capacitor CLI 8 expects Node >= 22 and a project `typescript` devDependency to load this `.ts` file.
 *
 * Plugins: WP-4 added @capacitor/status-bar, @capacitor/splash-screen, @capacitor/app.
 *
 * **Native Google Sign-In (WP-5):** Add `GoogleService-Info.plist` (iOS) and `google-services.json` (Android)
 * from Firebase Console → Project settings → Your apps. Without them, Google SSO fails at runtime on device/simulator.
 *
 * **WP-6 (Firebase Analytics, iOS):** `analytics_default_allow_ad_personalization_signals: false` is applied in
 * `ios/App/App/Info.plist` as `GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS` = NO (Capacitor config
 * does not merge arbitrary plist keys).
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.provisionsapp.shoppinglist',
  appName: 'Provisions',
  webDir: 'dist',
  server: {
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
  ios: {
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#FFFFFF',
    },
    FirebaseAuthentication: {
      // Keep native OAuth flows on the same branded Auth domain as the web app so Apple/Google
      // provider return URLs stay aligned across PWA and Capacitor builds.
      authDomain: 'myprovisions.app',
      providers: ['google.com', 'apple.com'],
    },
  },
};

export default config;
