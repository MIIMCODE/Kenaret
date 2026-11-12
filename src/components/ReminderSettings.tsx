import { useEffect, useState } from 'react'
import Alert from './Alert'
import Spinner from './Spinner'
import { useAuth } from '../hooks/useAuth'
import { fetchReminderLog, fetchReminderPrefs, saveReminderPrefs } from '../lib/api'
import { toPersianError } from '../lib/errors'
import { anniversaryLabel } from '../lib/anniversary'
import type { ReminderLogRow, ReminderPrefs } from '../types/database'

/**
 * Reminder controls.
 *
 * The copy is deliberately honest about the one thing that can stop mail from
 * arriving: until SMTP/Resend is configured the app cannot deliver it. Rather
 * than hide that, the panel says so once, quietly, and points at the calendar
 * which always works.
 */
export default function ReminderSettings({ isGirl }: { isGirl: boolean }) {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null)
  const [log, setLog] = useState<ReminderLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let active = true
    setLoading(true)
    Promise.all([fetchReminderPrefs(user.id), fetchReminderLog(user.id, 5)])
      .then(([nextPrefs, nextLog]) => {
        if (!active) return
        setPrefs(nextPrefs)
        setLog(nextLog)
      })
      .catch((loadError) => {
        if (active) setError(toPersianError(loadError, 'تنظیم یادآوری‌ها خوانده نشد.'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [user])

  async function toggle(key: keyof ReminderPrefs, value: boolean) {
    if (!user || !prefs) return
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    setSaving(key)
    setError(null)
    setNotice(null)
    try {
      await saveReminderPrefs(user.id, { [key]: value })
      setNotice('ذخیره شد.')
    } catch (saveError) {
      setPrefs(prefs) // roll back the optimistic flip
      setError(toPersianError(saveError, 'ذخیره نشد. دوباره تلاش کن.'))
    } finally {
      setSaving(null)
    }
  }

  if (loading || !prefs) {
    return (
      <section className="card p-5">
        <h2 className="text-[14px] font-extrabold text-ink-900">یادآوری‌ها</h2>
        <Spinner className="mx-auto my-4 h-5 w-5 text-blush-500" />
      </section>
    )
  }

  const disabled = !prefs.enabled

  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-[14px] font-extrabold text-ink-900">یادآوری‌ها</h2>
        <p className="mt-1 text-[11px] leading-5 text-ink-500">
          یک روز قبل با ایمیل خبرت می‌کنیم — سالگرد، ماهگرد، تولد و روزهای شمردنی.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Row
        title="یادآوری‌ها فعال باشند"
        hint="اگر خاموش شود، هیچ ایمیل و هیچ یادآوری‌ای در زنگوله نمی‌آید. «دلم تنگ شده»ی شریکت اما همیشه می‌رسد."
        checked={prefs.enabled}
        busy={saving === 'enabled'}
        onChange={(value) => void toggle('enabled', value)}
      />

      <div className={disabled ? 'space-y-3 opacity-50' : 'space-y-3'}>
        <Row
          title="سالگرد و ماهگرد"
          hint="سالگرد آشنایی و هر ماه با هم بودن"
          checked={prefs.want_anniversary}
          disabled={disabled}
          busy={saving === 'want_anniversary'}
          onChange={(value) => void toggle('want_anniversary', value)}
        />
        <Row
          title="تولدها"
          hint="تولد خودت و شریکت"
          checked={prefs.want_birthday}
          disabled={disabled}
          busy={saving === 'want_birthday'}
          onChange={(value) => void toggle('want_birthday', value)}
        />
        {isGirl && (
          <Row
            title="پیش‌بینی پریود"
            hint="برای خودت؛ یادآوری شریکت فقط اگر خودت اشتراک‌گذاری را روشن کرده باشی"
            checked={prefs.want_period}
            disabled={disabled}
            busy={saving === 'want_period'}
            onChange={(value) => void toggle('want_period', value)}
          />
        )}
      </div>

      <p className="rounded-xl bg-lilac-100/60 px-3 py-2 text-[10px] leading-5 text-ink-700">
        این یادآوری‌ها همیشه در زنگوله‌ی بالای صفحه می‌آیند، حتی اگر ایمیلی نرسد. ایمیل یک کانال
        اضافه است، نه جایگزین.
      </p>

      {log.length > 0 && (
        <details className="rounded-xl border border-blush-100 bg-blush-50/70 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-bold text-ink-700">
            آخرین یادآوری‌های فرستاده‌شده
          </summary>
          <ul className="mt-2 space-y-1.5">
            {log.map((item) => (
              <li key={item.id} className="space-y-0.5 text-[10.5px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-700">
                    {kindLabel(item.kind)} — {anniversaryLabel(item.event_iso)}
                  </span>
                  <span
                    className={
                      item.status === 'sent'
                        ? 'font-bold text-emerald-600'
                        : item.status === 'failed'
                          ? 'font-bold text-red-600'
                          : item.status === 'skipped'
                            ? 'font-bold text-ink-500'
                            : 'font-bold text-blush-800'
                    }
                  >
                    {statusLabel(item.status)}
                  </span>
                </div>
                {item.status === 'failed' && (
                  <p className="leading-4 text-[9.5px] text-red-500">
                    {failureHint(item.detail)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function Row({
  title,
  hint,
  checked,
  disabled = false,
  busy = false,
  onChange,
}: {
  title: string
  hint: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-start justify-between gap-3 rounded-2xl border border-blush-100 px-3.5 py-3 transition ${
        disabled ? 'cursor-not-allowed bg-[#fdf6f8]' : 'bg-[#fdf6f8] hover:bg-white'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-[12px] font-bold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[10px] leading-5 text-ink-500">{hint}</span>
      </span>

      <span className="relative mt-0.5 flex shrink-0 items-center">
        {busy && <Spinner className="absolute -right-6 h-4 w-4 text-blush-500" />}
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled || busy}
          onChange={(event) => onChange(event.target.checked)}
        />
        {/*
          The rail and the knob are one component in index.css (`.switch-rail` /
          `.switch-knob`) so the two can never drift apart mid-slide. The only
          thing passed in here is the state, as a data attribute: it keeps the
          existing `peer` input and its focus-visible ring working exactly as
          before, and it means the glass recipe lives in the stylesheet where
          the rest of it is.
        */}
        <span
          aria-hidden="true"
          data-on={checked}
          className="switch-rail peer-focus-visible:ring-4 peer-focus-visible:ring-blush-200"
        >
          <span aria-hidden="true" className="switch-knob" />
        </span>
      </span>
    </label>
  )
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'yearly':
      return 'سالگرد'
    case 'monthly':
      return 'ماهگرد'
    case 'birthday':
      return 'تولد'
    case 'milestone':
      return 'روز شمردنی'
    case 'period':
      return 'پریود'
    case 'period_partner':
      return 'حال شریک'
    default:
      return kind
  }
}

function statusLabel(status: ReminderLogRow['status']): string {
  switch (status) {
    case 'sent':
      return 'فرستاده شد'
    case 'skipped':
      return 'در انتظار سرویس ایمیل'
    case 'failed':
      return 'ناموفق'
    default:
      return 'در صف'
  }
}

/**
 * A failed send is only useful if it says why. The commonest reason by far is
 * that the mail provider has not verified a sending domain yet, which shows up
 * as a 403 that mentions the account owner's own address.
 */
function failureHint(detail: string | null): string {
  if (!detail) return 'فرستاده نشد.'
  if (detail.includes('testing emails') || detail.includes('verify a domain')) {
    return 'سرویس ایمیل هنوز دامنه‌ی فرستنده را تأیید نکرده؛ تا آن موقع فقط به ایمیل صاحب حساب می‌فرستد.'
  }
  if (detail.startsWith('403')) return 'سرویس ایمیل اجازه‌ی این ارسال را نداد.'
  if (detail.startsWith('429')) return 'تعداد ارسال‌ها زیاد شد؛ بعداً دوباره تلاش می‌شود.'
  return 'فرستاده نشد.'
}
