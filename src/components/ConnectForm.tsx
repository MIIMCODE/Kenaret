import { useState } from 'react'
import Alert from './Alert'
import Spinner from './Spinner'
import { requestPartner } from '../lib/api'
import { toPersianError } from '../lib/errors'

interface Props {
  /** Own code — used to block pasting your own code before hitting the server. */
  ownCode: string | null
  onConnected: (status: 'pending' | 'active') => void
  onSuccessMessage?: (message: string) => void
}

const ALLOWED = /^[A-HJ-NP-Z2-9]*$/

export default function ConnectForm({ ownCode, onConnected, onSuccessMessage }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleChange(raw: string) {
    // Normalize: uppercase, strip everything that isn't in our alphabet.
    const cleaned = raw
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8)

    if (!ALLOWED.test(cleaned)) {
      setError('این کد حروف غیرمجاز دارد. کدها بدون حرف‌های O، I و رقم‌های ۰ و ۱ هستند.')
    } else {
      setError(null)
    }
    setCode(cleaned)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setError(null)

    if (code.length !== 8) {
      setError('کد باید ۸ کاراکتر باشد.')
      return
    }

    if (ownCode && code === ownCode) {
      setError('این کد خودت است! کد شریکت را وارد کن.')
      return
    }

    setLoading(true)
    try {
      const result = await requestPartner(code)
      setCode('')
      if (result.status === 'active') {
        onSuccessMessage?.('وصل شدید! 🎉 حالا می‌توانید پروفایل هم را ببینید.')
      } else {
        onSuccessMessage?.('درخواستت فرستاده شد. وقتی شریکت تأیید کند، به هم وصل می‌شوید.')
      }
      onConnected(result.status)
    } catch (requestError) {
      setError(toPersianError(requestError, 'درخواست فرستاده نشد. دوباره تلاش کن.'))
    } finally {
      setLoading(false)
    }
  }

  const progress = Math.min(code.length, 8)

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label className="label" htmlFor="partner-code">
        کد شریکت را وارد کن
      </label>

      <div className="relative">
        <input
          id="partner-code"
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={8}
          className="field text-center font-mono text-[22px] font-extrabold tracking-[0.3em] placeholder:tracking-[0.2em] placeholder:text-[15px]"
          placeholder="ABCD2345"
          value={code}
          disabled={loading}
          onChange={(event) => handleChange(event.target.value)}
        />
        <div className="pointer-events-none absolute inset-x-4 bottom-1.5 flex gap-1" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full transition-colors ${
                index < progress ? 'bg-blush-400' : 'bg-blush-100'
              }`}
            />
          ))}
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <button type="submit" className="btn-primary w-full" disabled={loading || code.length !== 8}>
        {loading ? <Spinner className="h-4 w-4" /> : null}
        {loading ? 'در حال ارسال...' : 'فرستادن درخواست'}
      </button>

      <p className="hint text-center">
        کد شریکت ۸ کاراکتر است: حروف انگلیسی بزرگ و رقم (بدون 0، O، 1 و I).
      </p>
    </form>
  )
}
