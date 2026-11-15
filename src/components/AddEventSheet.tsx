import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import JalaliDatePicker from './JalaliDatePicker'
import { addCalendarEvent } from '../lib/api'
import { toPersianError } from '../lib/errors'
import { formatJalaliLong, todayIso } from '../lib/jalali'
import { usePortalHost, useScrollLock } from '../lib/portal'
import type { CalendarEntry, CalendarVisibility } from '../types/database'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-selected day when the sheet is opened from a day cell. */
  initialDate?: string | null
  /** Called with the new row so the page can splice it in without a refetch. */
  onCreated: (entry: CalendarEntry) => void
}

/**
 * The emoji set.
 *
 * Deliberately small and *emotional* rather than complete. A full emoji
 * keyboard in a modal is unusable on a phone, and these eight cover what a
 * couple actually puts on a calendar: a date, a trip, a party, a deadline, a
 * memory. `📌` is the default because it means nothing in particular.
 */
const EMOJI = ['📌', '❤️', '✈️', '🎂', '🎉', '📚', '🏠', '⭐'] as const

/**
 * «یک روز اضافه کن»
 *
 * The one write path in the calendar. Everything else on this page is derived
 * from data the couple entered elsewhere; this is where they put the things
 * only they know about.
 *
 * It is a portal sheet for the same reason every other sheet on the site is
 * one (see JalaliDatePicker): an in-flow panel inside a card is clipped,
 * squeezed on 320px screens, and pushed under the keyboard. It also reuses
 * `JalaliDatePicker`, which is itself a portal — the two nest correctly
 * because the picker is appended after this sheet in the DOM.
 */
export default function AddEventSheet({ open, onClose, initialDate, onCreated }: Props) {
  const portalTarget = usePortalHost()
  useScrollLock(open)

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [emoji, setEmoji] = useState<string>(EMOJI[0])
  const [date, setDate] = useState<string>(initialDate ?? todayIso())
  const [visibility, setVisibility] = useState<CalendarVisibility>('couple')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  /**
   * Reset on every open, not on mount.
   *
   * The component stays mounted so the close animation can finish; resetting
   * in a mount effect would mean a second open shows the *previous* draft,
   * which is how a "just add a date" sheet turns into a data-loss report.
   */
  useEffect(() => {
    if (!open) return
    setTitle('')
    setNote('')
    setEmoji(EMOJI[0])
    setDate(initialDate ?? todayIso())
    setVisibility('couple')
    setError(null)
    setBusy(false)
  }, [open, initialDate])

  const close = useCallback(() => {
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      onClose()
    }, 140)
  }, [onClose])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  const submit = async () => {
    if (busy) return
    const clean = title.trim()
    if (!clean) {
      setError('یک عنوان بنویس.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const entry = await addCalendarEvent({
        title: clean,
        eventOn: date,
        emoji,
        note: note.trim() || null,
        visibility,
      })
      onCreated(entry)
      close()
    } catch (submitError) {
      setError(toPersianError(submitError, 'این روز ذخیره نشد.'))
      setBusy(false)
    }
  }

  if (!open || !portalTarget) return null

  const sheet = (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="presentation"
      style={{ height: 'var(--knr-vvh, 100dvh)' }}
    >
      <div
        className={`absolute inset-0 scrim transition-opacity duration-150 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="افزودن روز به تقویم"
        className={`relative m-0 w-full max-w-md ${
          closing ? 'animate-sheet-out' : 'animate-sheet-in'
        }`}
      >
        <div className="glass glass-thick max-h-[var(--knr-vvh,100dvh)] overflow-y-auto overscroll-contain px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-[#1a1424] sm:hidden" />

          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-[14px] font-black text-[#1a1424]">یک روز اضافه کن</h2>
            <button
              type="button"
              onClick={close}
              className="px-2.5 py-1.5 text-[12px] font-bold text-[#4a3f5c] transition hover:bg-[#ffefda] hover:text-[#1a1424]"
            >
              بستن
            </button>
          </div>

          {/* ---- the day ---- */}
          <div className="mb-3">
            <span className="label">کدام روز؟</span>
            <JalaliDatePicker
              value={date}
              onChange={setDate}
              label=""
              placeholder="انتخاب روز"
              minIso="1970-01-01"
            />
            <p className="mt-1.5 text-[10.5px] font-semibold text-[#4a3f5c]">
              {formatJalaliLong(date)} — روزهای گذشته هم می‌شوند؛ برای خاطره‌ها.
            </p>
          </div>

          {/* ---- the title ---- */}
          <div className="mb-3">
            <label className="label" htmlFor="cal-title">
              چی بود؟
            </label>
            <input
              id="cal-title"
              className="field text-[14px]"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="مثلاً: اولین دیدار"
              maxLength={80}
              autoComplete="off"
            />
          </div>

          {/* ---- the emoji ---- */}
          <div className="mb-3">
            <span className="label">نشانه</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="انتخاب نشانه">
              {EMOJI.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setEmoji(option)}
                  aria-pressed={emoji === option}
                  className={`flex h-10 w-10 items-center justify-center border-2 border-[#1a1424] text-[16px] transition ${
                    emoji === option
                      ? 'bg-[#ffd23f] shadow-[2px_2px_0_#1a1424]'
                      : 'bg-white hover:bg-[#ffefda]'
                  }`}
                >
                  <span aria-hidden="true">{option}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ---- who sees it ---- */}
          <div className="mb-3">
            <span className="label">کی ببیند؟</span>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="دیده شدن">
              <button
                type="button"
                onClick={() => setVisibility('couple')}
                aria-pressed={visibility === 'couple'}
                className={`border-2 border-[#1a1424] px-2 py-2 text-[11px] font-black transition ${
                  visibility === 'couple'
                    ? 'bg-[#5eead4] shadow-[2px_2px_0_#1a1424]'
                    : 'bg-white text-[#4a3f5c] hover:bg-[#ffefda]'
                }`}
              >
                هر دویتان
              </button>
              <button
                type="button"
                onClick={() => setVisibility('private')}
                aria-pressed={visibility === 'private'}
                className={`border-2 border-[#1a1424] px-2 py-2 text-[11px] font-black transition ${
                  visibility === 'private'
                    ? 'bg-[#b79cff] shadow-[2px_2px_0_#1a1424]'
                    : 'bg-white text-[#4a3f5c] hover:bg-[#ffefda]'
                }`}
              >
                فقط برای خودم
              </button>
            </div>
            <p className="mt-1.5 text-[10px] leading-5 font-semibold text-[#4a3f5c]">
              {visibility === 'couple'
                ? 'این روز در تقویم هر دویتان می‌آید.'
                : 'فقط تو می‌بینی‌اش. حتی شریکت هم دسترسی ندارد — دقیقاً مثل چرخه.'}
            </p>
          </div>

          {/* ---- the note ---- */}
          <div className="mb-3">
            <label className="label" htmlFor="cal-note">
              یک خط توضیح <span className="font-bold opacity-60">(اختیاری)</span>
            </label>
            <textarea
              id="cal-note"
              className="field min-h-[3rem] resize-y text-[13px]"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="مثلاً: فرودگاه امام، پرواز ۸ صبح"
              maxLength={200}
              rows={2}
            />
          </div>

          {error && <p className="mb-2 text-[11.5px] font-bold text-[#c4194a]">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="btn-ghost flex-1 !py-2.5 text-[12.5px]"
            >
              بی‌خیال
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !title.trim()}
              className="btn-primary flex-[1.4] !py-2.5 text-[12.5px]"
            >
              {busy ? 'در حال ذخیره…' : 'ذخیره کن'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, portalTarget)
}
