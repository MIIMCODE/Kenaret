import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { usePortalHost, useScrollLock } from '../lib/portal'
import { fetchReminderPrefs, fetchUpcomingReminders } from '../lib/api'
import { BELL_WINDOW_DAYS, bellSummary, toReminders, type InAppReminder } from '../lib/reminders'
import { toPersianDigits } from '../lib/jalali'

/**
 * The reminder bell.
 *
 * Email delivery depends on a verified sending domain, so until that exists the
 * bell is the *only* thing that reliably reaches the user. It reads the very
 * same `reminder_queue()` the nightly mail job reads — one source of truth, so
 * the bell can never promise something the email would not say.
 *
 * On phones the list opens as a bottom sheet in a portal (the same pattern as
 * the Jalali picker) because an in-header dropdown would be clipped by the
 * sticky header and squeezed at 320 px.
 */
export default function ReminderBell() {
  const [items, setItems] = useState<InAppReminder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const portalTarget = usePortalHost()

  useScrollLock(open)

  const { user } = useAuth()

  const load = useCallback(async () => {
    try {
      if (!user) return
      // The bell honours the same switches as the mail job: a kind the user
      // turned off must not come back through a different door.
      const [rows, prefs] = await Promise.all([
        fetchUpcomingReminders(BELL_WINDOW_DAYS),
        fetchReminderPrefs(user.id).catch(() => null),
      ])
      const allowed = rows.filter((row) => {
        if (!prefs) return true
        if (!prefs.enabled) return false
        if (row.kind === 'birthday') return prefs.want_birthday
        if (row.kind === 'yearly' || row.kind === 'monthly' || row.kind === 'milestone')
          return prefs.want_anniversary
        if (row.kind === 'period' || row.kind === 'period_partner') return prefs.want_period
        return true
      })
      setItems(toReminders(allowed))
    } catch {
      // A failed bell must never surface an error banner; it just stays quiet.
      setItems([])
    } finally {
      setLoaded(true)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  // Re-read when the tab comes back: a day may have passed while it was hidden.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const close = useCallback(() => {
    setClosing(true)
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
    }, 140)
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const count = items.length
  const label =
    count === 0
      ? 'یادآوری‌ها؛ چیزی پیشِ رو نیست'
      : `یادآوری‌ها؛ ${toPersianDigits(count)} مورد پیشِ رو`

  const sheet = open && (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="presentation"
      style={{ height: 'var(--knr-vvh, 100dvh)' }}
    >
      <div
        className={`absolute inset-0 bg-ink-900/35 backdrop-blur-[2px] transition-opacity duration-150 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="یادآوری‌های نزدیک"
        className={`relative m-0 w-full max-w-md ${closing ? 'animate-sheet-out' : 'animate-sheet-in'}`}
      >
        <div className="max-h-[var(--knr-vvh,100dvh)] overflow-y-auto overscroll-contain rounded-t-[28px] border border-blush-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-soft sm:rounded-3xl sm:pb-3">
          <div className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-blush-100 sm:hidden" />

          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-extrabold text-ink-900">یادآوری‌ها</h2>
            <button
              type="button"
              onClick={close}
              className="rounded-xl px-2.5 py-1.5 text-[12px] font-bold text-ink-500 transition hover:bg-blush-50 hover:text-ink-700"
            >
              بستن
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-ink-500">{bellSummary(items)}</p>

          {count === 0 ? (
            <div className="rounded-2xl bg-blush-50 px-4 py-6 text-center">
              <p className="text-[22px]" aria-hidden="true">
                🌱
              </p>
              <p className="mt-1.5 text-[12px] font-bold text-ink-900">فعلاً خبری نیست</p>
              <p className="mt-1 text-[11px] leading-5 text-ink-500">
                سالگرد، ماهگرد، تولد و روزهای شمردنی یک روز قبل همین‌جا خبر می‌دهند.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex items-center gap-3 rounded-2xl border border-blush-100 bg-white px-3 py-2.5"
                >
                  <span className="text-[17px]" aria-hidden="true">
                    {item.emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-bold text-ink-900">{item.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-500">{item.dateLabel}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-extrabold ${
                      item.daysUntil === 0 ? 'bg-blush-500 text-white' : 'bg-blush-50 text-blush-700'
                    }`}
                  >
                    {item.when}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            to="/dates"
            onClick={close}
            className="btn-ghost mt-3 w-full !py-2.5 text-[12px]"
          >
            دیدن همه‌ی روزهای مهم
          </Link>

          <p className="mt-2 text-center text-[10px] leading-5 text-ink-500">
            همین‌ها یک روز قبل با ایمیل هم می‌آیند — اگر در تنظیمات روشن باشد.
          </p>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-blush-600"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 8.5a6 6 0 1 0-12 0c0 4.2-1.6 5.6-1.6 5.6h15.2S18 12.7 18 8.5z"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M10.2 18.2a2 2 0 0 0 3.6 0"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>

        {loaded && count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blush-500 px-1 text-[9.5px] font-extrabold text-white shadow-soft">
            {toPersianDigits(count)}
          </span>
        )}
      </button>

      {sheet && portalTarget ? createPortal(sheet, portalTarget) : null}
    </>
  )
}
