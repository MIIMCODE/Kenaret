import { useEffect, useMemo, useRef, useState } from 'react'
import {
  JALALI_MONTHS,
  isoToJalali,
  jalaliMonthLength,
  jalaliToIso,
  persianWeekday,
  todayIso,
  toPersianDigits,
} from '../lib/jalali'

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
  /** Year shown first when nothing is selected (e.g. 1378 for a birth date). */
  defaultYear?: number
  error?: string
  id?: string
}

const WEEK_HEADS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']

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
  const today = isoToJalali(todayIso())!

  const [viewYear, setViewYear] = useState(selected?.jy ?? defaultYear ?? today.jy)
  const [viewMonth, setViewMonth] = useState(selected?.jm ?? today.jm)
  const [yearMode, setYearMode] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)

  // Re-sync the visible month whenever the value changes from the outside.
  useEffect(() => {
    if (selected) {
      setViewYear(selected.jy)
      setViewMonth(selected.jm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
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
  }

  function pick(jd: number) {
    const iso = jalaliToIso(viewYear, viewMonth, jd)
    if (!iso || isDisabled(iso)) return
    onChange(iso)
    setOpen(false)
    setYearMode(false)
  }

  const display = selected
    ? toPersianDigits(`${selected.jd} ${JALALI_MONTHS[selected.jm - 1]} ${selected.jy}`)
    : ''

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: monthLength }, (_, i) => i + 1),
  ]
  // Pad the tail so the grid always renders whole rows.
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="relative" ref={wrapRef}>
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}

      <button
        id={id}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`field flex items-center justify-between text-right ${
          error ? 'border-red-300 ring-2 ring-red-100' : ''
        }`}
      >
        <span className={display ? 'text-ink-900' : 'text-ink-500/60'}>
          {display || placeholder}
        </span>
        <CalendarIcon />
      </button>

      {error && <p className="mt-1.5 text-[12px] font-medium text-red-500">{error}</p>}

      {open && (
        <div
          role="dialog"
          aria-label="انتخاب تاریخ شمسی"
          className="absolute z-50 mt-2 w-full min-w-[19rem] animate-fade-up rounded-3xl border border-blush-100 bg-white p-3 shadow-soft"
        >
          {/* Header */}
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="ماه قبل"
              className="rounded-xl p-2 text-blush-600 transition hover:bg-blush-50"
            >
              <ChevronRight />
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setYearMode((v) => !v)}
                className="rounded-xl px-2 py-1 text-sm font-bold text-ink-900 transition hover:bg-blush-50"
              >
                {toPersianDigits(viewYear)}
                <span className="mx-1 text-[10px] text-ink-500">▾</span>
              </button>
              <span className="text-sm font-bold text-blush-600">
                {JALALI_MONTHS[viewMonth - 1]}
              </span>
            </div>

            <button
              type="button"
              onClick={() => stepMonth(1)}
              aria-label="ماه بعد"
              className="rounded-xl p-2 text-blush-600 transition hover:bg-blush-50"
            >
              <ChevronLeft />
            </button>
          </div>

          {yearMode ? (
            <div className="grid max-h-56 grid-cols-4 gap-1 overflow-y-auto p-1">
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => {
                    setViewYear(y)
                    setYearMode(false)
                  }}
                  className={`rounded-xl py-2 text-[13px] font-semibold transition ${
                    y === viewYear
                      ? 'bg-blush-500 text-white'
                      : 'text-ink-700 hover:bg-blush-50'
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
                  <div
                    key={`${d}-${i}`}
                    className="py-1 text-center text-[11px] font-bold text-ink-500"
                  >
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, index) => {
                  if (day === null) {
                    return <div key={`empty-${index}`} className="h-9" />
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
                      className={`h-9 rounded-xl text-[13px] font-semibold transition ${
                        isSelected
                          ? 'bg-blush-500 text-white shadow-soft'
                          : disabled
                            ? 'cursor-not-allowed text-ink-500/30'
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

          <div className="mt-2 flex items-center justify-between border-t border-blush-100 pt-2">
            <button
              type="button"
              onClick={() => {
                setViewYear(today.jy)
                setViewMonth(today.jm)
              }}
              className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-blush-600 transition hover:bg-blush-50"
            >
              برو به امروز
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setYearMode(false)
              }}
              className="rounded-xl px-3 py-1.5 text-[12px] font-semibold text-ink-500 transition hover:bg-blush-50"
            >
              بستن
            </button>
          </div>
        </div>
      )}

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

