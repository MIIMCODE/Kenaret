import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/useAuth'
import { syncViewportHeight } from './lib/portal'
import './index.css'

// Keeps --knr-vvh honest on iPhones (keyboard / collapsing browser chrome).
syncViewportHeight()

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
