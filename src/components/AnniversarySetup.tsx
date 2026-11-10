import { useState } from 'react'
import Alert from './Alert'
import JalaliDatePicker from './JalaliDatePicker'
import Spinner from './Spinner'
import { setAnniversary } from '../lib/api'
import { toPersianError } from '../lib/errors'
import { todayIso } from '../lib/jalali'
import { anniversaryLabel, togetherSince } from '../lib/anniversary'

interface Props {
  /** Name of the partner, used inside the hand-off confirmation. */
  partnerName?: string | null
  /** What to do after the date is saved (or handed off). */
  onDone: (result: 'saved' | 'reassigned') => void
  /** Called when the user backs out of the optional prompt. */
  onSkip?: () => void
  /** Hide the skip link when the question is mandatory. */
  compact?: boolean
  /** Pre-fill when the couple already has a date and is editing it. */
  initialDate?: string | null
}

/**
 * The «تاریخ آشنایی‌اتون کی بوده؟» question.
 *
 * The date is deliberately optional to *remember*: anyone who cannot recall it
 * can hand the very same question to their partner with one tap, so nobody is
 * ever stuck on this screen.
 */
export default function AnniversarySetup({
  partnerName,
  onDone,
  onSkip,
  compact = false,
  initialDate = null,
}: Props) {
  const [date, setDate] = useState<string | null>(initialDate)
  const [saving, setSaving] = useState(false)
  const [handingOff, setHandingOff] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const who = partnerName?.trim() || 'شریکت'
  const busy = saving || handingOff
  const preview = date ? togetherSince(date) : null

  async function handleSave() {
    if (!date || busy) return
    setSaving(true)
    setError(null)
    try {
      await setAnniversary(date, false)
      onDone('saved')
    } catch (saveError) {
      setError(toPersianError(saveError, 'تاریخ ذخیره نشد. دوباره تلاش کن.'))
    } finally {
      setSaving(false)
    }
  }

  async function handleHandOff() {
    if (busy) return
    if (!confirm(`سؤال «تاریخ آشنایی‌اتون کی بوده؟» برای ${who} فرستاده شود؟`)) return
    setHandingOff(true)
    setError(null)
    try {
      await setAnniversary(null, true)
      onDone('reassigned')
    } catch (handOffError) {
      setError(toPersianError(handOffError, 'درخواست فرستاده نشد. دوباره تلاش کن.'))
    } finally {
      setHandingOff(false)
    }
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      <div className="text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-clay-200 text-blush-800 shadow-neo-in-sm">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.5" y="5" width="17" height="15" rx="4" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path
              d="M12 18.2c-1.9-1.4-3.2-2.6-3.2-3.9 0-.9.7-1.6 1.6-1.6.6 0 1.2.3 1.6.9.4-.6 1-.9 1.6-.9.9 0 1.6.7 1.6 1.6 0 1.3-1.3 2.5-3.2 3.9z"
              fill="currentColor"
            />
          </svg>
        </span>
        <h2 className="mt-3 text-[17px] font-extrabold text-ink-900">تاریخ آشنایی‌اتون کی بوده؟</h2>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-[12px] leading-6 text-ink-700">
          با این تاریخ، کنارت حساب می‌کند چند وقت است با هم هستید، ماهگرد و سالگردتان را نشانت می‌دهد و
          روزهای مهم را از قبل یادت می‌اندازد.
        </p>
      </div>

      <JalaliDatePicker
        value={date}
        onChange={setDate}
        label="تاریخ شروع رابطه"
        placeholder="تاریخ را انتخاب کن"
        maxIso={todayIso()}
        minIso="1950-01-01"
        defaultYear={1395}
        id="anniversary-date"
      />

      {preview && (
        <div className="rounded-2xl bg-clay-200 px-4 py-3 text-center shadow-neo-in-sm">
          <p className="text-[11px] font-semibold text-ink-700">یعنی تا امروز</p>
          <p className="mt-0.5 text-[14px] font-extrabold text-blush-800">{preview.label}</p>
          <p className="mt-1 text-[10.5px] text-ink-700">شروع از {anniversaryLabel(preview.startIso)}</p>
        </div>
      )}

      {error && <Alert tone="error">{error}</Alert>}

      <div className="space-y-2.5">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!date || busy}
          className="btn-primary w-full"
        >
          {saving ? <Spinner className="h-4 w-4" /> : 'همین درست است، ذخیره کن'}
        </button>

        <button
          type="button"
          onClick={() => void handleHandOff()}
          disabled={busy}
          className="btn-ghost w-full"
        >
          {handingOff ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 12h14m0 0-4.5-4.5M18 12l-4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              یادم نیست، از {who} بپرس
            </>
          )}
        </button>
      </div>

      <p className="text-center text-[10.5px] leading-5 text-ink-500">
        هر زمان خواستی می‌توانی از تنظیمات تغییرش بدهی.
      </p>

      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="w-full rounded-xl py-1 text-[11.5px] font-semibold text-ink-500 transition hover:text-ink-700"
        >
          فعلاً رد کن
        </button>
      )}
    </div>
  )
}
