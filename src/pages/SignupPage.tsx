import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { authRedirectUrl, supabase } from '../lib/supabase'
import { toPersianError } from '../lib/errors'

const MIN_PASSWORD = 6

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setError(null)

    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('ایمیل معتبری وارد کن.')
    if (password.length < MIN_PASSWORD) return setError('رمز عبور باید حداقل ۶ کاراکتر باشد.')
    if (password !== confirm) return setError('رمز عبور و تکرارش یکسان نیستند.')

    setLoading(true)
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        // PKCE + HashRouter friendly: the code lands on #/auth/callback.
        emailRedirectTo: authRedirectUrl(),
      },
    })
    setLoading(false)

    if (signUpError) {
      setError(toPersianError(signUpError))
      return
    }

    // If email confirmation is enabled (it is), no session is returned yet.
    if (!data.session) {
      setSentTo(cleanEmail)
      return
    }
  }

  if (sentTo) {
    return (
      <AuthShell title="یه قدم مونده ✉️">
        <div className="space-y-4">
          <p className="text-[13.5px] leading-7 text-ink-700">
            لینک تأیید به{' '}
            <span dir="ltr" className="font-bold text-blush-600">
              {sentTo}
            </span>{' '}
            فرستادیم. روی لینک داخل ایمیل بزن تا حسابت فعال بشه. اگر ندیدی، پوشه‌ی اسپم را هم چک کن.
          </p>

          <Alert tone="info">
            بعد از تأیید، مستقیم می‌رسی به مرحله‌ی معرفی خودت: جنسیت، اسم، تاریخ تولد و
            علاقه‌مندی‌هات.
          </Alert>

          <button
            type="button"
            onClick={async () => {
              setLoading(true)
              const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email: sentTo,
                options: { emailRedirectTo: authRedirectUrl() },
              })
              setLoading(false)
              if (resendError) setError(toPersianError(resendError))
              else alert('ایمیل تأیید دوباره فرستاده شد.')
            }}
            disabled={loading}
            className="btn-ghost w-full"
          >
            {loading ? <Spinner className="h-4 w-4" /> : null}
            ایمیل را دوباره بفرست
          </button>

          {error && <Alert tone="error">{error}</Alert>}

          <Link to="/login" className="block text-center text-[13px] font-bold text-blush-600 hover:underline">
            برگشت به صفحه‌ی ورود
          </Link>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="به کنارت خوش آمدی"
      subtitle="با ایمیل ثبت‌نام کن؛ بعدش چند سؤال کوتاه ازت می‌پرسیم و کد جفت‌شدنت را می‌گیری."
      footer={
        <span>
          قبلاً ثبت‌نام کردی؟{' '}
          <Link to="/login" className="font-bold text-blush-600 hover:underline">
            وارد شو
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="signup-email">
            ایمیل
          </label>
          <input
            id="signup-email"
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
          <label className="label" htmlFor="signup-password">
            رمز عبور
          </label>
          <input
            id="signup-password"
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
          <label className="label" htmlFor="signup-confirm">
            تکرار رمز عبور
          </label>
          <input
            id="signup-confirm"
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
          {loading ? 'در حال ساخت حساب...' : 'ساخت حساب'}
        </button>

        <p className="text-center text-[11px] leading-5 text-ink-500">
          با ثبت‌نام، قوانین استفاده از کنارت را می‌پذیری. اطلاعاتت فقط برای تو و شریک فعالته.
        </p>
      </form>
    </AuthShell>
  )
}
