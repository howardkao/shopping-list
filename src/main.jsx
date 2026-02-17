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
    // Notify App component that update is available
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
