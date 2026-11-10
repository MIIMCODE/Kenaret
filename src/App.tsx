import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { listenForNotificationNavigation } from './lib/sw-register'
import { syncSubscription } from './lib/push'
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
import ChatPage from './pages/ChatPage'
import DatesPage from './pages/DatesPage'
import NotFoundPage from './pages/NotFoundPage'
import ConfigMissingPage from './pages/ConfigMissingPage'

/**
 * Sends signed-out visitors to /login and keeps signed-in users inside the
 * onboarding flow until it is finished.
 *
 * Important: while the profile is still loading we show a spinner instead of
 * guessing — guessing would bounce a returning user into onboarding for a
 * frame, or worse, right after the PKCE callback.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { status, profile, profileLoading } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <FullPageLoader label="داریم حسابت را چک می‌کنیم..." />

  if (status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const onOnboarding = location.pathname.startsWith('/onboarding')

  // We have a session but not the profile yet — wait rather than redirect.
  if (!profile) {
    if (profileLoading) return <FullPageLoader label="داریم پروفایلت را می‌خوانیم..." />
    return <ProfileLoadError />
  }

  if (!profile.onboarding_completed && !onOnboarding) {
    return <Navigate to="/onboarding" replace />
  }

  if (profile.onboarding_completed && onOnboarding) {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}

/** The session is valid but the profile row could not be read. */
function ProfileLoadError() {
  const { refreshProfile, signOut } = useAuth()
  return (
    <div className="mx-auto flex min-h-[70dvh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-[14px] font-bold text-ink-900">پروفایلت بارگذاری نشد</p>
      <p className="text-[12.5px] leading-6 text-ink-500">
        اتصال اینترنتت را بررسی کن و دوباره تلاش کن.
      </p>
      <button type="button" onClick={() => void refreshProfile()} className="btn-primary w-full">
        تلاش دوباره
      </button>
      <button
        type="button"
        onClick={() => void signOut()}
        className="text-[12px] font-semibold text-ink-500 underline"
      >
        خروج از حساب
      </button>
    </div>
  )
}

/** Auth pages are only for signed-out users. */
function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') return <FullPageLoader />
  if (status === 'signed-in') return <Navigate to="/app" replace />
  return <>{children}</>
}

/**
 * Keeps this device's push subscription current, and lets a tapped
 * notification steer the app.
 *
 * The re-sync is silent: permission was already granted, so no prompt appears
 * — this only exists because browsers rotate push endpoints without telling
 * anyone, which would otherwise leave a phone quietly unreachable.
 */
function PushBridge() {
  const navigate = useNavigate()
  const { user } = useAuth()

  useEffect(() => {
    const off = listenForNotificationNavigation(navigate, import.meta.env.BASE_URL)
    return off
  }, [navigate])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      try {
        if (!cancelled) await syncSubscription()
      } catch {
        // A failed re-sync only means the old endpoint may be stale; the app
        // itself is unaffected.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  return null
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
      <PushBridge />
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
          path="/chat"
          element={
            <RequireAuth>
              <ChatPage />
            </RequireAuth>
          }
        />
        <Route
          path="/dates"
          element={
            <RequireAuth>
              <DatesPage />
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
