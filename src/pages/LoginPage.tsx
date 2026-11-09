import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { toPersianError } from '../lib/errors'
import ResendPanel from '../components/ResendPanel'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const redirectTo = (location.state as { from?: string } | null)?.from

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return

    setError(null)
    setNotice(null)
    setNeedsConfirmation(false)

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return setError('ایمیلت را وارد کن.')
    if (!password) return setError('رمز عبورت را وارد کن.')

    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    })
    setLoading(false)

    if (signInError) {
      if (signInError.code === 'email_not_confirmed' || /email not confirmed/i.test(signInError.message)) {
        setNeedsConfirmation(true)
      }
      setError(toPersianError(signInError))
      return
    }

    navigate(redirectTo && redirectTo !== '/login' ? redirectTo : '/app', { replace: true })
  }

  /** Returns true when a fresh confirmation mail actually left the building. */
  async function resendConfirmation(): Promise<boolean> {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError('اول ایمیلت را وارد کن.')
      return false
    }

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
      options: {
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback`,
      },
    })

    if (resendError) {
      setError(null)
      return false
    }
    setError(null)
    setNotConfirmation()
    return true
  }

  function setNotConfirmation() {
    setNeedsConfirmation(false)
    setNotice('ایمیل تأیید دوباره فرستاده شد. صندوق ورودی و پوشه‌ی اسپم را چک کن.')
  }

  return (
    <AuthShell
      title="خوش برگشتی"
      subtitle="وارد شو تا دوباره کنار هم باشیم."
      footer={
        <span>
          حساب نداری؟{' '}
          <Link to="/signup" className="font-bold text-blush-600 hover:underline">
            ثبت‌نام کن
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="email">
            ایمیل
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            className="field text-left"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="label !mb-0" htmlFor="password">
              رمز عبور
            </label>
            <Link
              to="/forgot-password"
              className="text-[12px] font-semibold text-blush-600 hover:underline"
            >
              فراموش کردی؟
            </Link>
          </div>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              dir="ltr"
              className="field pl-12 text-left"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute inset-y-0 left-0 flex w-11 items-center justify-center text-ink-500 transition hover:text-blush-600"
              aria-label={showPassword ? 'پنهان کردن رمز' : 'نمایش رمز'}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </button>
          </div>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {needsConfirmation && (
          <div className="space-y-2.5 rounded-2xl border border-blush-200 bg-blush-50/70 p-3.5">
            <p className="text-[11.5px] leading-6 text-ink-700">
              ایمیلت هنوز تأیید نشده. لازم نیست چیزی را از نو بسازی؛ فقط روی لینک داخل ایمیل بزن.
              اگر ایمیل نیامده، دوباره بفرست — این‌جا گیر نمی‌کنی.
            </p>
            <ResendPanel email={email.trim().toLowerCase()} onResend={resendConfirmation} />
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? <Spinner className="h-4 w-4" /> : null}
          {loading ? 'در حال ورود...' : 'ورود'}
        </button>
      </form>
    </AuthShell>
  )
}

function Eye() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4l16 16M9.9 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.3 8.1A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}
