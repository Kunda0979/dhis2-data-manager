import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import RuntimeErrorBoundary from './components/common/RuntimeErrorBoundary.jsx'
import './index.css'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .catch(() => undefined)
}

if ('caches' in window) {
  window.caches.keys()
    .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
    .catch(() => undefined)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RuntimeErrorBoundary>
      <App />
    </RuntimeErrorBoundary>
  </React.StrictMode>,
)
