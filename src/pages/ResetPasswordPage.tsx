import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { toPersianError } from '../lib/errors'

/**
 * Lands here from the recovery email link (#/reset-password).
 * The PKCE code exchange is handled by AuthCallbackPage-style logic in
 * supabase-js; we just wait for a session, then let the user set a password.
 */
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      // Supabase may put `?code=` on the query string; hash routing keeps it
      // before the `#`, so read it from the real search params.
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const tokenHash = params.get('token_hash')
      const type = params.get('type')

      if (code) {
        await supabase.auth.exchangeCodeForSession(code)
        window.history.replaceState({}, '', `${import.meta.env.BASE_URL}#/reset-password`)
      } else if (tokenHash && type) {
        await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'recovery' })
        window.history.replaceState({}, '', `${import.meta.env.BASE_URL}#/reset-password`)
      }

      if (!active) return
      const { data } = await supabase.auth.getSession()
      setReady(Boolean(data.session))
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setError(null)

    if (password.length < 6) return setError('رمز عبور باید حداقل ۶ کاراکتر باشد.')
    if (password !== confirm) return setError('رمز عبور و تکرارش یکسان نیستند.')

    setLoading(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateError) return setError(toPersianError(updateError))
    setDone(true)
    setTimeout(() => navigate('/app', { replace: true }), 1600)
  }

  return (
    <AuthShell title="رمز جدید" subtitle="یک رمز تازه انتخاب کن و دوباره وارد شو.">
      {done ? (
        <Alert tone="success">رمزت عوض شد ✨ داریم می‌بریمت داخل کنارت...</Alert>
      ) : !ready ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-blush-500">
            <Spinner className="h-5 w-5" />
            <span className="text-[13px] text-ink-500">داریم لینک را بررسی می‌کنیم...</span>
          </div>
          <Alert tone="info">
            اگر این پیام ماند، لینک منقضی شده است.{' '}
            <Link to="/forgot-password" className="font-bold underline">
              دوباره درخواست بده
            </Link>
            .
          </Alert>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="new-password">
              رمز جدید
            </label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              className="field text-left"
              placeholder="حداقل ۶ کاراکتر"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading}
            />
          </div>
          <div>
            <label className="label" htmlFor="new-password-confirm">
              تکرار رمز جدید
            </label>
            <input
              id="new-password-confirm"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              className="field text-left"
              placeholder="رمز را دوباره بنویس"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={loading}
            />
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <Spinner className="h-4 w-4" /> : null}
            {loading ? 'در حال ذخیره...' : 'ذخیره‌ی رمز جدید'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
