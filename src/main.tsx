import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { syncViewportHeight } from './lib/portal'
import { initInstallPrompt } from './lib/pwa'
import { registerServiceWorker } from './lib/sw-register'
import './index.css'

// Keeps --knr-vvh honest on iPhones (keyboard / collapsing browser chrome).
syncViewportHeight()

// Listen for `beforeinstallprompt` from the very first paint: Chrome can fire
// it before the dashboard mounts, and an event missed there cannot be replayed.
initInstallPrompt()

// Offline shell for the installed app. Registered after first paint (see the
// module) and skipped entirely in dev.
registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter: every route lives after `#`, so a refresh on GitHub Pages
        can never 404 (no server-side rewrites needed). */}
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
