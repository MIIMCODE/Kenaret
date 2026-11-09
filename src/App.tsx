import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useAuth } from './hooks/useAuth'
import { FullPageLoader } from './components/Spinner'
import { isSupabaseConfigured } from './lib/supabase'

import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AuthCallbackPage from './pages/AuthCallbackPage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/DashboardPage'
import SettingsPage from './pages/SettingsPage'
import NotFoundPage from './pages/NotFoundPage'
import ConfigMissingPage from './pages/ConfigMissingPage'

/** Sends signed-out visitors to /login and remembers where they were headed. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, profile, profileLoading } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageLoader label="داریم حسابت را چک می‌کنیم..." />

  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // Keep the user inside onboarding until it is finished.
  const needsOnboarding = profile ? !profile.onboarding_completed : true
  const onOnboarding = location.pathname.startsWith('/onboarding')

  if (profileLoading && !profile) return <FullPageLoader />

  if (needsOnboarding && !onOnboarding && !profileLoading) {
    return <Navigate to="/onboarding" replace />
  }

  if (!needsOnboarding && onOnboarding) {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}

/** Auth pages are only for signed-out users. */
function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageLoader />
  if (status === 'signed-in') return <Navigate to="/app" replace />
  return <>{children}</>
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])
  return null
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissingPage />

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<LandingPage />} />

        <Route
          path="/login"
          element={
            <RequireGuest>
              <LoginPage />
            </RequireGuest>
          }
        />
        <Route
          path="/signup"
          element={
            <RequireGuest>
              <SignupPage />
            </RequireGuest>
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <OnboardingPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireAuth>
              <SettingsPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
