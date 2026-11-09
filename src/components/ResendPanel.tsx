import { useEffect, useRef, useState } from 'react'
import Alert from './Alert'

/** Seconds the visitor has to wait before the "try again" button unlocks. */
const DEFAULT_WAIT = 180

interface Props {
  /** Email address the confirmation link was sent to. */
  email: string
  /** Re-sends the confirmation mail, returning true when it went out. */
  onResend: () => Promise<boolean>
}

/**
 * The moment the mailer is throttled is the moment a visitor is most likely to
 * give up. Instead of a red error we show a calm «سایت شلوغه» card with a
 * countdown, keep the account intact, and always leave a way forward.
 */
export default function ResendPanel({ email, onResend }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sent' | 'busy'>('idle')
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (secondsLeft <= 0) return
    timer.current = window.setTimeout(() => setSecondsLeft((value) => value - 1), 1000)
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [secondsLeft])

  async function handleResend() {
    if (sending || secondsLeft > 0) return
    setSending(true)
    setStatus('idle')
    const ok = await onResend()
    setSending(false)
    setStatus(ok ? 'sent' : 'busy')
    if (!ok) setSecondsLeft(DEFAULT_WAIT)
  }

  const locked = secondsLeft > 0 || sending

  return (
    <div className="space-y-3">
      <p className="text-center text-[11px] leading-5 text-ink-500">
        حسابت ساخته شده و جایی نمی‌رود؛ فقط تأیید ایمیل مانده.
      </p>

      <button type="button" onClick={() => void handleResend()} disabled={locked} className="btn-ghost w-full">
        {sending ? 'در حال ارسال...' : 'ایمیل را دوباره بفرست'}
      </button>

      {secondsLeft > 0 && (
        <Alert tone="info">
          سایت این لحظه شلوغه و سرویس ایمیل مهلت می‌خواهد — ولی حسابت ساخته شده و جای هیچ نگرانی‌ای
          نیست. تا <span className="font-extrabold">{secondsLeft.toLocaleString('fa-IR')}</span> ثانیه‌ی
          دیگر صبر کن، دوباره فرصت می‌گیری. اگر ایمیل دستت نرسید، می‌توانی همین الان با همان ایمیل به
          صفحه‌ی ورود بروی و رمزت را بازیابی کنی.
        </Alert>
      )}

      {status === 'sent' && secondsLeft === 0 && (
        <Alert tone="success">ایمیل دوباره فرستاده شد. صندوق ورودی و اسپم را چک کن.</Alert>
      )}

      {email && (
        <p className="text-center text-[10.5px] leading-5 text-ink-500">
          این ایمیل برای <span dir="ltr" className="font-bold">{email}</span> فرستاده شد.
        </p>
      )}
    </div>
  )
}
