import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker with user-prompted updates
let updateAvailableCallback = null;
let offlineReadyCallback = null;

const updateSW = registerSW({
  onNeedRefresh() {
    // In Capacitor native apps, updates come via the APK — skip the prompt and let
    // the service worker apply silently.
    if (window.Capacitor?.isNativePlatform()) return;
    if (updateAvailableCallback) {
      updateAvailableCallback(updateSW);
    }
  },
  onOfflineReady() {
    // Notify App component that offline mode is ready
    if (offlineReadyCallback) {
      offlineReadyCallback();
    }
  },
  onRegisteredSW(swUrl, registration) {
    // Check for updates every hour (reduced from 5 min)
    if (registration) {
      setInterval(() => {
        registration.update()
      }, 60 * 60 * 1000)
    }
  }
})

// Export callbacks for App component to register
export function registerUpdateCallback(callback) {
  updateAvailableCallback = callback;
}

export function registerOfflineCallback(callback) {
  offlineReadyCallback = callback;
}

// StrictMode intentionally double-mounts in dev; that raced OAuth getRedirectResult. Production
// builds do not double-invoke effects, which is why SSO worked there. Skip StrictMode in dev so
// local behavior matches production for auth.
ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? (
    <App />
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
)
