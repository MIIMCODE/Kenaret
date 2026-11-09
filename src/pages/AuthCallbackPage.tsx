import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchProfile } from '../lib/api'
import { toPersianError } from '../lib/errors'

type Phase = 'working' | 'error'

/**
 * Target of every Supabase email link (confirmation + recovery).
 *
 * With PKCE + HashRouter the URL arrives as one of:
 *   https://site/Kenaret/?code=xxxx#/auth/callback      (confirmation)
 *   https://site/Kenaret/#/auth/callback?code=xxxx      (some Supabase versions)
 *   https://site/Kenaret/?token_hash=...&type=signup    (token-hash templates)
 *   https://site/Kenaret/#access_token=...&refresh_token=...  (implicit fallback)
 *
 * We handle all of them, then drop the parameters so a refresh can't replay them.
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const { status, refreshProfile } = useAuth()
  const [phase, setPhase] = useState<Phase>('working')
  const [message, setMessage] = useState<string>('داریم ایمیلت را تأیید می‌کنیم...')
  const [error, setError] = useState<string | null>(null)
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    void (async () => {
      const search = new URLSearchParams(window.location.search)
      const hashParams = new URLSearchParams(
        window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '',
      )

      const code = search.get('code') ?? hashParams.get('code')
      const tokenHash = search.get('token_hash') ?? hashParams.get('token_hash')
      const type = search.get('type') ?? hashParams.get('type')
      const errorDescription =
        search.get('error_description') ?? hashParams.get('error_description')
      const errorCode = search.get('error') ?? hashParams.get('error')

      // Supabase rejected the link itself (expired, already used, ...).
      if (errorCode || errorDescription) {
        setPhase('error')
        setError(
          errorCode === 'access_denied' || /expired/i.test(errorDescription ?? '')
            ? 'این لینک منقضی شده یا قبلاً استفاده شده. دوباره درخواست بده.'
            : (errorDescription ?? 'لینک تأیید معتبر نیست.'),
        )
        return
      }

      try {
        // 1) The SDK may already have exchanged the code on init because
        //    `detectSessionInUrl` is enabled — check for that first so we
        //    never try to redeem a single-use code twice.
        let session = (await supabase.auth.getSession()).data.session
        let exchangeError: unknown = null

        if (!session && code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          exchangeError = error
          session = (await supabase.auth.getSession()).data.session
        } else if (!session && tokenHash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type as 'signup' | 'recovery' | 'email' | 'email_change' | 'invite' | 'magiclink',
          })
          exchangeError = error
          session = (await supabase.auth.getSession()).data.session
        }

        if (exchangeError && !session) throw exchangeError

        if (!session) {
          setPhase('error')
          setError('نتوانستیم وارد حسابت شویم. لینک ممکن است منقضی شده باشد.')
          return
        }

        // Clean the URL so a refresh doesn't try to replay the one-time code.
        window.history.replaceState({}, '', `${import.meta.env.BASE_URL}#/auth/callback`)

        const profile = await refreshProfile().catch(() => null)
        const resolved = profile ?? (await fetchProfile(session.user.id).catch(() => null))

        if (resolved?.onboarding_completed) {
          setMessage('ورودت را تأیید کردیم. خوش برگشتی 💗')
          navigate('/app', { replace: true })
        } else {
          setMessage('ایمیلت تأیید شد! حالا خودت را معرفی کن ✨')
          navigate('/onboarding', { replace: true })
        }
      } catch (callbackError) {
        setPhase('error')
        setError(toPersianError(callbackError, 'تأیید ایمیل انجام نشد. دوباره تلاش کن.'))
      }
    })()
  }, [navigate, refreshProfile])

  // If the AuthProvider resolves first, stop showing the spinner.
  useEffect(() => {
    if (phase !== 'working' || status !== 'signed-in') return
    // Slight delay so the user sees the success copy rather than a flash.
    const timeout = setTimeout(() => {
      void (async () => {
        const profile = await refreshProfile()
        navigate(profile?.onboarding_completed ? '/app' : '/onboarding', { replace: true })
      })()
    }, 600)
    return () => clearTimeout(timeout)
  }, [phase, status, navigate, refreshProfile])

  return (
    <AuthShell title={phase === 'error' ? 'یه مشکلی پیش آمد' : 'تأیید ایمیل'}>
      {phase === 'error' ? (
        <div className="space-y-4">
          <Alert tone="error">{error}</Alert>
          <div className="flex flex-col gap-2">
            <Link to="/login" className="btn-primary w-full">
              برگشت به ورود
            </Link>
            <p className="text-center text-[12px] text-ink-500">
              می‌توانی از صفحه‌ی ورود، ایمیل تأیید را دوباره بفرستی.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Spinner className="h-7 w-7 text-blush-500" />
          <p className="text-[13px] leading-6 text-ink-500">{message}</p>
        </div>
      )}
    </AuthShell>
  )
}
