import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  JALALI_MONTHS,
  isoToJalali,
  jalaliMonthLength,
  jalaliToIso,
  persianWeekday,
  todayIso,
  toPersianDigits,
} from '../lib/jalali'
import { portalHost, useKeyboardOpen, useMounted, useScrollLock } from '../lib/portal'

interface Props {
  /** Gregorian ISO date (`YYYY-MM-DD`) or null. */
  value: string | null
  onChange: (iso: string) => void
  label?: string
  placeholder?: string
  /** Highest selectable date, Gregorian ISO. Defaults to today. */
  maxIso?: string
  /** Lowest selectable date, Gregorian ISO. */
  minIso?: string
  /** Year shown first when nothing is selected (e.g. 1395 for an anniversary). */
  defaultYear?: number
  error?: string
  id?: string
}

const WEEK_HEADS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']

/**
 * Jalali date picker.
 *
 * The calendar opens as a *modal sheet* rendered into a portal on <body>, not
 * as an absolutely positioned popover. That matters on phones: an in-flow
 * popover inside the dashboard card used to be painted under the next card
 * (the “half cut calendar” on iPhone), was squeezed by narrow viewports, and
 * could be pushed beneath the on-screen keyboard. A portal owns the whole
 * layer, so none of that can happen:
 *
 *  - fixed positioning → never clipped by a parent card or a transformed
 *    ancestor, and no horizontal squeeze on 320–390 px screens
 *  - body scroll is locked while open, so the page cannot scroll the sheet
 *    out from under the thumb
 *  - the sheet is capped at the *visual* viewport height, so the keyboard
 *    cannot cover the day grid
 *  - a native `<input type="month">` mirror lets iPhone users type a month
 *    directly instead of tapping the arrows twelve times
 */
export default function JalaliDatePicker({
  value,
  onChange,
  label,
  placeholder = 'انتخاب تاریخ',
  maxIso,
  minIso,
  defaultYear,
  error,
  id,
}: Props) {
  const [open, setOpen] = useState(false)
  const selected = isoToJalali(value)
  const today = useMemo(() => isoToJalali(todayIso())!, [])

  const [viewYear, setViewYear] = useState(selected?.jy ?? defaultYear ?? today.jy)
  const [viewMonth, setViewMonth] = useState(selected?.jm ?? today.jm)
  const [yearMode, setYearMode] = useState(false)
  const [closing, setClosing] = useState(false)

  const mounted = useMounted()
  const keyboardOpen = useKeyboardOpen()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const monthInputRef = useRef<HTMLInputElement>(null)

  useScrollLock(open)

  // Re-sync the visible month whenever the value changes from the outside.
  useEffect(() => {
    if (selected) {
      setViewYear(selected.jy)
      setViewMonth(selected.jm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const close = useCallback(() => {
    setClosing(true)
    // Let the exit animation finish, then unmount.
    window.setTimeout(() => {
      setOpen(false)
      setClosing(false)
      setYearMode(false)
      triggerRef.current?.focus({ preventScroll: true })
    }, 140)
  }, [])

  // Escape closes; focus stays inside the sheet while it is open.
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // Move focus into the sheet without scrolling the page behind it.
  useEffect(() => {
    if (open) sheetRef.current?.focus({ preventScroll: true })
  }, [open])

  const monthLength = jalaliMonthLength(viewYear, viewMonth)
  const firstWeekday = useMemo(() => {
    const iso = jalaliToIso(viewYear, viewMonth, 1)
    return iso ? persianWeekday(iso) : 0
  }, [viewYear, viewMonth])

  const years = useMemo(() => {
    const maxYear = maxIso ? (isoToJalali(maxIso)?.jy ?? today.jy) : today.jy
    const minYear = minIso ? (isoToJalali(minIso)?.jy ?? 1300) : 1300
    const list: number[] = []
    for (let y = maxYear; y >= minYear; y -= 1) list.push(y)
    return list
  }, [maxIso, minIso, today.jy])

  function isDisabled(iso: string): boolean {
    if (maxIso && iso > maxIso) return true
    if (minIso && iso < minIso) return true
    return false
  }

  function clampView() {
    // Keep the visible month inside the allowed range so the arrows can never
    // walk the user into an all-disabled calendar.
    const firstAllowed = minIso ? isoToJalali(minIso) : null
    const lastAllowed = maxIso ? isoToJalali(maxIso) : null
    if (firstAllowed && (viewYear < firstAllowed.jy || (viewYear === firstAllowed.jy && viewMonth < firstAllowed.jm))) {
      setViewYear(firstAllowed.jy)
      setViewMonth(firstAllowed.jm)
      return true
    }
    if (lastAllowed && (viewYear > lastAllowed.jy || (viewYear === lastAllowed.jy && viewMonth > lastAllowed.jm))) {
      setViewYear(lastAllowed.jy)
      setViewMonth(lastAllowed.jm)
      return true
    }
    return false
  }

  function stepMonth(delta: number) {
    let m = viewMonth + delta
    let y = viewYear
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setViewMonth(m)
    setViewYear(y)
    // Correct on the next paint if we stepped past a boundary.
    window.setTimeout(clampView, 0)
  }

  function pick(jd: number) {
    const iso = jalaliToIso(viewYear, viewMonth, jd)
    if (!iso || isDisabled(iso)) return
    onChange(iso)
    close()
  }

  function pickToday() {
    if (isDisabled(todayIso())) return
    onChange(todayIso())
    close()
  }

  /** Native month picker (iPhone/Android) → jump straight to that month. */
  function onNativeMonth(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value // "YYYY-MM" (Gregorian)
    if (!raw) return
    const [gy, gm] = raw.split('-').map(Number)
    if (!gy || !gm) return
    const j = isoToJalali(`${gy}-${String(gm).padStart(2, '0')}-01`)
    if (!j) return
    setViewYear(j.jy)
    setViewMonth(j.jm)
    setYearMode(false)
  }

  const nativeMonthValue = useMemo(() => {
    const iso = jalaliToIso(viewYear, viewMonth, 1)
    return iso ? iso.slice(0, 7) : ''
  }, [viewYear, viewMonth])

  const display = selected
    ? toPersianDigits(`${selected.jd} ${JALALI_MONTHS[selected.jm - 1]} ${selected.jy}`)
    : ''

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: monthLength }, (_, i) => i + 1),
  ]
  // Pad the tail so the grid always renders whole rows.
  while (cells.length % 7 !== 0) cells.push(null)

  const sheet = open && (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center sm:items-center"
      role="presentation"
      // Cap at the visual viewport so the keyboard can never hide the grid.
      style={{ height: 'var(--knr-vvh, 100dvh)' }}
    >
      {/* Scrim: tapping it closes, exactly like a native picker. */}
      <div
        className={`absolute inset-0 bg-ink-900/35 backdrop-blur-[2px] transition-opacity duration-150 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={close}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="انتخاب تاریخ شمسی"
        tabIndex={-1}
        className={`relative m-0 w-full max-w-md outline-none ${
          closing ? 'animate-sheet-out' : 'animate-sheet-in'
        }`}
      >
        <div className="max-h-[var(--knr-vvh,100dvh)] overflow-y-auto overscroll-contain rounded-t-[28px] border border-blush-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-soft sm:rounded-3xl sm:pb-3">
          {/* drag handle (phones only) */}
          <div className="mx-auto mb-2 h-1.5 w-11 rounded-full bg-blush-100 sm:hidden" />

          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-[13.5px] font-extrabold text-ink-900">انتخاب تاریخ</h2>
            <button
              type="button"
              onClick={close}
              aria-label="بستن تقویم"
              className="rounded-xl px-2.5 py-1.5 text-[12px] font-bold text-ink-500 transition hover:bg-blush-50 hover:text-ink-700"
            >
              بستن
            </button>
          </div>

          {/* Header: month stepping + jump-to-year */}
          <div className="mb-2 flex items-center justify-between gap-1 rounded-2xl bg-blush-50/60 px-1 py-1">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="ماه قبل"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-blush-600 transition hover:bg-white active:scale-95"
            >
              <ChevronRight />
            </button>

            <div className="flex min-w-0 flex-1 flex-col items-center">
              <button
                type="button"
                onClick={() => setYearMode((v) => !v)}
                className="rounded-lg px-2 py-0.5 text-[13px] font-extrabold text-ink-900 transition hover:bg-white"
              >
                {JALALI_MONTHS[viewMonth - 1]} {toPersianDigits(viewYear)}
                <span className="mr-1 inline-block text-[9px] text-ink-500">▾</span>
              </button>

              {/* iPhone-friendly direct month jump */}
              <button
                type="button"
                onClick={() => {
                  const el = monthInputRef.current
                  if (!el) return
                  if (typeof el.showPicker === 'function') el.showPicker()
                  else {
                    el.focus()
                    el.click()
                  }
                }}
                className="mt-0.5 rounded-lg px-1.5 text-[10.5px] font-semibold text-blush-600"
              >
                پرش به ماه و سال
              </button>
            </div>

            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="ماه بعد"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-blush-600 transition hover:bg-white active:scale-95"
            >
              <ChevronLeft />
            </button>
          </div>

          {/* The native picker is the raw input; only its own UI is shown. */}
          <input
            ref={monthInputRef}
            type="month"
            tabIndex={-1}
            aria-hidden="true"
            value={nativeMonthValue}
            onChange={onNativeMonth}
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />

          {yearMode ? (
            <div className="grid max-h-[46dvh] grid-cols-4 gap-1 overflow-y-auto overscroll-contain p-1">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setViewYear(y)
                    setYearMode(false)
                    window.setTimeout(clampView, 0)
                  }}
                  className={`rounded-xl py-2.5 text-[13px] font-semibold transition ${
                    y === viewYear ? 'bg-blush-500 text-white' : 'text-ink-700 hover:bg-blush-50'
                  }`}
                >
                  {toPersianDigits(y)}
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-7 gap-1">
                {WEEK_HEADS.map((d, i) => (
                  <div key={`${d}-${i}`} className="py-1 text-center text-[11px] font-bold text-ink-500">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, index) => {
                  if (day === null) {
                    return <div key={`empty-${index}`} className="h-11" aria-hidden="true" />
                  }
                  const iso = jalaliToIso(viewYear, viewMonth, day)
                  const disabled = !iso || isDisabled(iso)
                  const isSelected =
                    !!selected &&
                    selected.jy === viewYear &&
                    selected.jm === viewMonth &&
                    selected.jd === day
                  const isToday =
                    today.jy === viewYear && today.jm === viewMonth && today.jd === day

                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={disabled}
                      onClick={() => pick(day)}
                      aria-current={isToday ? 'date' : undefined}
                      aria-label={iso ? toPersianDigits(`${day} ${JALALI_MONTHS[viewMonth - 1]} ${viewYear}`) : undefined}
                      // 44 px targets: the iOS minimum for a comfortable tap.
                      className={`h-11 rounded-xl text-[14px] font-semibold transition active:scale-95 ${
                        isSelected
                          ? 'bg-blush-500 text-white shadow-soft'
                          : disabled
                            ? 'cursor-not-allowed text-ink-500/25'
                            : isToday
                              ? 'bg-blush-50 text-blush-700 ring-1 ring-blush-200'
                              : 'text-ink-700 hover:bg-blush-50'
                      }`}
                    >
                      {toPersianDigits(day)}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="mt-3 flex items-center gap-2 border-t border-blush-100 pt-3">
            <button type="button" onClick={pickToday} className="btn-soft flex-1 py-2.5 text-[13px]">
              امروز
            </button>
            <button type="button" onClick={close} className="btn-ghost flex-1 py-2.5 text-[13px]">
              انصراف
            </button>
          </div>

          {keyboardOpen && <div className="h-2" aria-hidden="true" />}
        </div>
      </div>
    </div>
  )

  return (
    <div>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}

      <button
        id={id}
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`field flex items-center justify-between text-right ${
          error ? 'border-red-300 ring-2 ring-red-100' : ''
        }`}
      >
        <span className={display ? 'text-ink-900' : 'text-ink-500/60'}>{display || placeholder}</span>
        <CalendarIcon />
      </button>

      {error && <p className="mt-1.5 text-[12px] font-medium text-red-500">{error}</p>}

      {mounted && sheet && portalHost() ? createPortal(sheet, portalHost()!) : null}

      <input type="hidden" value={value ? `${value}` : ''} readOnly />
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="4" stroke="#f9628b" strokeWidth="1.7" />
      <path d="M8 3v4M16 3v4M3 10h18" stroke="#f9628b" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
