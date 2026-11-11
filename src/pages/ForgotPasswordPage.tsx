import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { supabase } from '../lib/supabase'
import { toPersianError } from '../lib/errors'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setError(null)

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return setError('ایمیلت را وارد کن.')

    setLoading(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}#/reset-password`,
    })
    setLoading(false)

    if (resetError) return setError(toPersianError(resetError))
    setSent(true)
  }

  return (
    <AuthShell
      title="بازیابی رمز عبور"
      subtitle="ایمت را وارد کن؛ لینک تنظیم رمز جدید برایت می‌فرستیم."
      footer={
        <Link to="/login" className="font-bold text-blush-800 hover:underline">
          برگشت به صفحه‌ی ورود
        </Link>
      }
    >
      {sent ? (
        <Alert tone="success">
          اگر این ایمیل در کنارت ثبت شده باشد، لینک بازیابی برایش فرستاده شد. صندوق ورودی و اسپم را
          چک کن.
        </Alert>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="label" htmlFor="forgot-email">
              ایمیل
            </label>
            <input
              id="forgot-email"
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

          {error && <Alert tone="error">{error}</Alert>}

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? <Spinner className="h-4 w-4" /> : null}
            {loading ? 'در حال ارسال...' : 'ارسال لینک بازیابی'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
