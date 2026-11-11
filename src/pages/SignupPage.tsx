import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { authRedirectUrl, supabase } from '../lib/supabase'
import { toPersianError } from '../lib/errors'
import ResendPanel from '../components/ResendPanel'
import { errorCodeOf } from '../lib/errors'

const MIN_PASSWORD = 6

/** True when Supabase refused to send the confirmation email because of its cap. */
function isMailRateLimit(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string } | null
  if (!e) return false
  const code = errorCodeOf(error)
  return (
    code === 'over_email_send_rate_limit' ||
    e.code === 'over_email_send_rate_limit' ||
    e.status === 429 ||
    /email.*rate limit|rate limit.*email/i.test(e.message ?? '')
  )
}

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  /** Shown when the mailer's hourly cap is hit: account exists, mail did not go. */
  const [deliveryBusy, setDeliveryBusy] = useState(false)

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
      // Hitting the mailer cap is not a failure of the visitor's action: the
      // account may well have been created, so we lead them forward instead of
      // showing a dead end.
      if (isMailRateLimit(signUpError)) {
        setDeliveryBusy(true)
        setSentTo(cleanEmail)
        return
      }
      setError(toPersianError(signUpError))
      return
    }

    // With email confirmation on, Supabase returns no session until the link is
    // clicked. With confirmation off, we get a session and go straight in.
    if (!data.session) {
      // Supabase deliberately reports an existing address as "success, no
      // session" to avoid leaking which emails are registered.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setError('این ایمیل قبلاً ثبت شده است. از صفحه‌ی ورود وارد شو یا رمزت را بازیابی کن.')
        return
      }
      setSentTo(cleanEmail)
      return
    }

    navigate('/onboarding', { replace: true })
  }

  if (sentTo) {
    return (
      <AuthShell title="یه قدم مونده ✉️">
        <div className="space-y-4">
          <p className="text-[13.5px] leading-7 text-ink-700">
            لینک تأیید به{' '}
            <span dir="ltr" className="font-bold text-blush-800">
              {sentTo}
            </span>{' '}
            فرستادیم. روی لینک داخل ایمیل بزن تا حسابت فعال بشه. اگر ندیدی، پوشه‌ی اسپم را هم چک کن.
          </p>

          <Alert tone="info">
            بعد از تأیید، مستقیم می‌رسی به مرحله‌ی معرفی خودت: جنسیت، اسم، تاریخ تولد و
            علاقه‌مندی‌هات.
          </Alert>

          {deliveryBusy && (
            <Alert tone="info">
              حسابت ساخته شد، فقط سرویس ایمیل این لحظه شلوغه و فرستادن ایمیل تأیید را کمی عقب
              انداخته. نگران نباش — حسابت از بین نمی‌رود. کمی بعد دوباره درخواست بده، یا اگر عجله
              داری به{' '}
              <Link to="/login" className="font-bold underline">
                صفحه‌ی ورود
              </Link>{' '}
              برو.
            </Alert>
          )}

          <Alert tone="info">
            اگر ایمیل را در چند دقیقه‌ی آینده نگرفتی، اسپم را چک کن. راه دیگری هم هست: به{' '}
            <Link to="/login" className="font-bold underline">
              صفحه‌ی ورود
            </Link>{' '}
            برو؛ اگر حسابت فعال باشد و ایمیلت تأیید نشده باشد، همان‌جا می‌توانی دوباره درخواست تأیید بدهی.
          </Alert>

          <ResendPanel
            email={sentTo}
            onResend={async () => {
              const { error: resendError } = await supabase.auth.resend({
                type: 'signup',
                email: sentTo,
                options: { emailRedirectTo: authRedirectUrl() },
              })
              return !resendError
            }}
          />

          {error && <Alert tone="error">{error}</Alert>}

          <Link to="/login" className="block text-center text-[13px] font-bold text-blush-800 hover:underline">
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
          <Link to="/login" className="font-bold text-blush-800 hover:underline">
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
