import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Register service worker with periodic sync
const updateSW = registerSW({
  onNeedRefresh() {
    // Auto-update when new content is available
    updateSW(true)
  },
  onOfflineReady() {
    console.log('App ready for offline use')
  },
  onRegisteredSW(swUrl, registration) {
    // Check for updates every 5 minutes
    if (registration) {
      setInterval(() => {
        registration.update()
      }, 5 * 60 * 1000)
    }
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
