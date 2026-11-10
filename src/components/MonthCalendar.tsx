import { useMemo } from 'react'
import {
  monthGrid,
  shiftMonth,
  type CalendarEvent,
  type MonthCell,
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
}: {
  jy: number
  jm: number
  events: CalendarEvent[]
  today: string
  selected: string | null
  onSelect: (iso: string) => void
  onChangeMonth: (jy: number, jm: number) => void
  onGoToday: () => void
}) {
  const grid = useMemo(() => monthGrid(jy, jm, events, today), [jy, jm, events, today])

  const step = (delta: number) => {
    const next = shiftMonth(jy, jm, delta)
    onChangeMonth(next.jy, next.jm)
  }

  return (
    <section className="card overflow-hidden p-3" aria-label="تقویم ماه">
      {/* ---- header ---- */}
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="ماه قبل"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-blush-50 hover:text-blush-600"
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
            className="mt-0.5 text-[10px] font-bold text-blush-600 hover:underline"
          >
            برو به امروز
          </button>
        </div>

        <button
          type="button"
          onClick={() => step(1)}
          aria-label="ماه بعد"
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-500 transition hover:bg-blush-50 hover:text-blush-600"
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
      <div className="grid grid-cols-7 gap-1">
        {grid.weeks.flat().map((cell) => (
          <DayCell
            key={cell.iso}
            cell={cell}
            selected={selected === cell.iso}
            onSelect={onSelect}
          />
        ))}
      </div>
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

  return (
    <button
      type="button"
      onClick={() => onSelect(cell.iso)}
      aria-label={label}
      aria-pressed={selected}
      aria-current={cell.isToday ? 'date' : undefined}
      className={[
        'relative flex aspect-square flex-col items-center justify-center rounded-xl text-[12px] transition',
        cell.inMonth ? 'text-ink-900' : 'text-ink-500/35',
        cell.isToday ? 'font-extrabold' : 'font-semibold',
        selected
          ? 'bg-blush-500 text-white shadow-soft'
          : cell.isToday
            ? 'bg-blush-100 text-blush-700'
            : 'hover:bg-blush-50',
        !cell.inMonth && !selected ? 'hover:bg-transparent' : '',
      ].join(' ')}
    >
      <span className={isFriday && !selected && !cell.isToday ? 'text-blush-600' : ''}>
        {toPersianDigits(cell.day)}
      </span>

      {cell.events.length > 0 && (
        <span className="mt-0.5 flex h-1 items-center gap-[2px]" aria-hidden="true">
          {cell.events.slice(0, 3).map((event, index) => (
            <span
              key={event.key + index}
              className={`block h-1 w-1 rounded-full ${
                selected ? 'bg-white' : event.private ? 'bg-lilac-500' : 'bg-blush-500'
              }`}
            />
          ))}
          {extra > 0 && (
            <span
              className={`text-[7px] leading-none font-bold ${
                selected ? 'text-white' : 'text-ink-500'
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
