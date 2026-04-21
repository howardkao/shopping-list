/**
 * Native shell (Capacitor 8) for the Vite app. Web assets: `npm run build` then `npx cap sync`.
 *
 * Toolchain notes (fill in on your machine — WP-3 step 7):
 * - This repo was scaffolded in an environment where `xcodebuild` was not available (only Command Line Tools)
 *   and no Java runtime was on PATH. For iOS use full Xcode; for Android use JDK 17+ (Temurin 17 is typical) and
 *   Android Studio’s bundled Gradle.
 * - Capacitor CLI 8 expects Node >= 22 and a project `typescript` devDependency to load this `.ts` file.
 *
 * Plugins: @capacitor/status-bar and @capacitor/splash-screen are deferred to Batch 3 (WP-4).
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.provisionsapp.shoppinglist',
  appName: 'Provisions',
  webDir: 'dist',
  server: {
    cleartext: false,
  },
  ios: {
    preferredContentMode: 'mobile',
  },
};

export default config;
