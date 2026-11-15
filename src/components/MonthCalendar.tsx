import { useMemo, useRef } from 'react'
import {
  monthGrid,
  shiftMonth,
  type CalendarEvent,
  type MonthCell,
  type WindowRange,
} from '../lib/calendar'
import { toPersianDigits } from '../lib/jalali'

/**
 * The month grid.
 *
 * Why a grid at all: the page used to list only "the next N days", which for a
 * couple three weeks in meant one or two rows and a lot of empty space. A
 * calendar that shows two things looks broken even when it is working. The grid
 * answers the actual question — "what does this month look like" — and the
 * upcoming list sits underneath as the short version.
 *
 * Details that matter on a phone:
 * · Six rows, always, so paging between months does not make the page jump.
 * · Persian week starts on Saturday; Friday's number is tinted.
 * · Days outside the month are dimmed but still tappable, and their events are
 *   still drawn — a birthday on the 1st of next month should be visible while
 *   you are looking at the end of this one.
 * · Selected day is a full-width list underneath, not a popover: popovers fight
 *   with the on-screen keyboard and get clipped at the bottom of the viewport.
 */

const WEEKDAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const

export default function MonthCalendar({
  jy,
  jm,
  events,
  today,
  selected,
  onSelect,
  onChangeMonth,
  onGoToday,
  windows,
}: {
  jy: number
  jm: number
  events: CalendarEvent[]
  today: string
  selected: string | null
  onSelect: (iso: string) => void
  onChangeMonth: (jy: number, jm: number) => void
  onGoToday: () => void
  /**
   * Period windows to shade. `own` is the reader's cycle, `partner` is hers.
   * Optional so the component still renders if the caller has no data — a
   * calendar with no shading is still a calendar.
   */
  windows?: { own?: WindowRange[]; partner?: WindowRange[] }
}) {
  const grid = useMemo(
    () => monthGrid(jy, jm, events, today, windows),
    [jy, jm, events, today, windows],
  )

  const step = (delta: number) => {
    const next = shiftMonth(jy, jm, delta)
    onChangeMonth(next.jy, next.jm)
  }

  const hasOwn = (windows?.own?.length ?? 0) > 0
  const hasPartner = (windows?.partner?.length ?? 0) > 0

  /*
    Swipe to change month.

    Paging a calendar by tapping a 32px arrow eight times is the most common
    complaint-shaped interaction on this page, and a horizontal swipe is what
    every calendar on the phone already does.

    Three details keep it from misfiring:
      · only the horizontal axis counts — a vertical drag is a scroll, and the
        page must not change month because somebody scrolled past the grid
      · the threshold is 44px, not 10: a tap that smears slightly is still a tap
      · `touch-action: pan-y` on the grid lets the browser own vertical
        scrolling while we own horizontal, so neither fights the other
  */
  const touch = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  })

  const swipeHandlers = {
    style: { touchAction: 'pan-y' as const },
    onTouchStart: (event: React.TouchEvent) => {
      const point = event.touches[0]
      if (!point) return
      touch.current = { x: point.clientX, y: point.clientY, active: true }
    },
    onTouchEnd: (event: React.TouchEvent) => {
      if (!touch.current.active) return
      const point = event.changedTouches[0]
      touch.current.active = false
      if (!point) return

      const dx = point.clientX - touch.current.x
      const dy = point.clientY - touch.current.y
      // Horizontal intent only, and clearly so.
      if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      // RTL: a swipe to the right (dx > 0) reveals the *previous* month,
      // because that is the direction the dates run in this layout.
      step(dx > 0 ? -1 : 1)
    },
  }

  return (
    <section className="card overflow-hidden p-3" aria-label="تقویم ماه">
      {/* ---- header ---- */}
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="ماه قبل"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-[#ffefda] hover:text-[#c4194a]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M9 6l6 6-6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="text-center">
          <p className="text-[13.5px] font-extrabold text-ink-900">{grid.label}</p>
          <button
            type="button"
            onClick={onGoToday}
            className="mt-0.5 text-[10px] font-bold text-blush-800 hover:underline"
          >
            برو به امروز
          </button>
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="ماه بعد"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-[#ffefda] hover:text-[#c4194a]"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M15 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* ---- weekday header ---- */}
      <div className="grid grid-cols-7 gap-1 px-0.5 pb-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-[10px] font-bold text-ink-500/70"
            aria-hidden="true"
          >
            {label}
          </div>
        ))}
      </div>

      {/* ---- the grid ---- */}
      <div
        className="grid grid-cols-7 gap-1"
        {...swipeHandlers}
      >
        {grid.weeks.flat().map((cell) => (
          <DayCell
            key={cell.iso}
            cell={cell}
            selected={selected === cell.iso}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* ---- legend ----
          Only rendered when there is something to explain. A legend for an
          empty calendar is furniture. */}
      {(hasOwn || hasPartner) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t-2 border-[#1a1424] pt-2">
          {hasOwn && (
            <span className="flex items-center gap-1 text-[9.5px] font-bold text-[#4a3f5c]">
              <span
                aria-hidden="true"
                className="block h-2.5 w-2.5 border border-[#1a1424]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(26,20,36,0.30) 0 1.5px, transparent 1.5px 5px)',
                }}
              />
              چرخه‌ی تو
            </span>
          )}
          {hasPartner && (
            <span className="flex items-center gap-1 text-[9.5px] font-bold text-[#4a3f5c]">
              <span
                aria-hidden="true"
                className="block h-2.5 w-2.5 border border-[#1a1424]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(103,59,184,0.32) 0 1.5px, transparent 1.5px 5px)',
                }}
              />
              چرخه‌ی او
            </span>
          )}
          <span className="flex items-center gap-1 text-[9.5px] font-bold text-[#4a3f5c]">
            <span aria-hidden="true" className="block h-2.5 w-2.5 bg-[#ff4d6d] border border-[#1a1424]" />
            انتخاب
          </span>
        </div>
      )}
    </section>
  )
}

function DayCell({
  cell,
  selected,
  onSelect,
}: {
  cell: MonthCell
  selected: boolean
  onSelect: (iso: string) => void
}) {
  // At most three dots; beyond that the count is more honest than the dots.
  const extra = cell.events.length > 3 ? cell.events.length - 3 : 0
  const isFriday = new Date(cell.iso.slice(0, 10) + 'T00:00:00').getDay() === 5

  const label =
    cell.events.length === 0
      ? toPersianDigits(cell.day)
      : `${toPersianDigits(cell.day)}، ${toPersianDigits(cell.events.length)} رویداد`

  /*
    Period shading is a *diagonal hatch*, not a fill.

    Two reasons. A flat fill would fight the selection block (pink) and the
    today block (ink) for the same cell, and one of the three would lose. A
    hatch is a texture, so it composes with any fill underneath it, and it is
    also the honest visual for "predicted": a solid colour would say this
    already happened.

    `own` is ink; `partner` is lilac. Neither uses pink, which is reserved for
    "selected" — a colour that means two things means nothing.
  */
  const hatch =
    cell.period === 'own'
      ? 'repeating-linear-gradient(45deg, rgba(26,20,36,0.30) 0 1.5px, transparent 1.5px 5px)'
      : cell.period === 'partner'
        ? 'repeating-linear-gradient(45deg, rgba(103,59,184,0.32) 0 1.5px, transparent 1.5px 5px)'
        : undefined

  return (
    <button
      type="button"
      onClick={() => onSelect(cell.iso)}
      aria-label={label}
      aria-pressed={selected}
      aria-current={cell.isToday ? 'date' : undefined}
      style={hatch ? { backgroundImage: hatch } : undefined}
      className={[
        'relative flex aspect-square flex-col items-center justify-center rounded-none text-[12px] transition',
        /*
          Padding days used to be 35% ink, which measured 2.04:1 — under
          even the large-text floor. A calendar that shows last month's dates
          more faintly than it shows its own *numbers* is fine; showing them
          unreadably is not. #7a7089 is 4.66:1, and the distinction is carried
          by colour plus the lack of events rather than by near-invisibility.
        */
        cell.inMonth ? 'text-[#1a1424]' : 'text-[#7a7089]',
        cell.isToday ? 'font-black' : 'font-bold',
        selected
          ? 'bg-[#ff4d6d] font-black text-[#1a1424]'
          : cell.isToday
            ? 'bg-[#1a1424] text-[#ffe9d6]'
            : 'hover:bg-[#ffefda]',
        !cell.inMonth && !selected ? 'hover:bg-transparent' : '',
      ].join(' ')}
    >
      <span
        className={
          isFriday && !selected && !cell.isToday ? 'text-[#c4194a] font-black' : ''
        }
      >
        {toPersianDigits(cell.day)}
      </span>

      {cell.events.length > 0 && (
        <span className="mt-0.5 flex h-1 items-center gap-[2px]" aria-hidden="true">
          {cell.events.slice(0, 3).map((event, index) => (
            <span
              key={event.key + index}
              className={`block h-1 w-1 rounded-full ${
                selected
                  ? 'bg-[#1a1424]'
                  : cell.isToday
                    ? 'bg-[#ffe9d6]'
                    : event.private
                      ? 'bg-[#5b3bb8]'
                      : 'bg-[#c4194a]'
              }`}
            />
          ))}
          {extra > 0 && (
            <span
              className={`text-[7px] leading-none font-black ${
                selected || cell.isToday ? 'text-[#ffe9d6]' : 'text-[#4a3f5c]'
              }`}
            >
              +
            </span>
          )}
        </span>
      )}
    </button>
  )
}
