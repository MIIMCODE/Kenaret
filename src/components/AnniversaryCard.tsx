import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  MONTH_DAYS,
  anniversaryLabel,
  daysUntilLabel,
  nextMonthlyAnniversary,
  nextYearlyAnniversary,
  togetherSince,
  upcomingMilestones,
} from '../lib/anniversary'
import type { CelebrationCandidate } from '../lib/celebrate'

interface Props {
  /** Gregorian ISO start date of the relationship. */
  date: string
  /** Opens the edit screen (settings). */
  onEdit?: () => void
  /** Name of the partner who set the date, for the tiny credit line. */
  setByName?: string | null
  isMine?: boolean
  /**
   * Tonight's celebration, when there is one. Turning a card into a door is
   * the whole reason the page exists — a countdown that only ever counts is a
   * countdown you stop believing in.
   */
  celebration?: CelebrationCandidate | null
}

/**
 * The bright centre of the dashboard once a couple has a start date:
 * how long you have been together, the next monthiversary, the next
 * yearly anniversary and the milestones just ahead.
 */
export default function AnniversaryCard({
  date,
  onEdit,
  setByName,
  isMine = false,
  celebration = null,
}: Props) {
  const data = useMemo(() => {
    const duration = togetherSince(date)
    return {
      duration,
      monthly: nextMonthlyAnniversary(date),
      yearly: nextYearlyAnniversary(date),
      milestones: upcomingMilestones(date, undefined, 3),
    }
  }, [date])

  const { duration, monthly, yearly, milestones } = data
  const isToday = monthly.daysUntil === 0 || yearly.daysUntil === 0

  /*
   * The ring: how far into the current month-of-togetherness we are.
   *
   * A plain day count says how long; it does not say how *close to the next
   * one* you are, which is the number people actually feel. 0 → 1 across the
   * month, drawn as a circle so the card has one graphic instead of four
   * numbers in a row.
   */
  /*
   * The ring is a 30-day block, filled by days — not a calendar month. A month
   * here is 30 days by definition (see `MONTH_DAYS`), so the ring spans exactly
   * that: 0 on the morning after one anniversary, full on the evening of the
   * next. A ring measured in calendar months would fill on a different day
   * from the one the room opens on.
   */
  const ring = useMemo(() => {
    const span = MONTH_DAYS
    const elapsed = Math.min(span, Math.max(0, span - monthly.daysUntil))
    return { ratio: elapsed / span, elapsed, span }
  }, [monthly.daysUntil])

  return (
    <section className="card relative overflow-hidden rounded-[1.75rem] p-5">
      {/* soft decorative blobs */}
      {/* Halftone discs, not glows: a printed poster decorates with a dot
          screen, and a blurred blob is the one shape this design cannot
          justify. Offset off the corner so it reads as a print overrun. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-5 -top-6 h-20 w-20 rounded-full border-[3px] border-[#1a1424]/25"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(26,20,36,0.22) 1.5px, transparent 1.6px)',
          backgroundSize: '7px 7px',
        }}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-8 -right-4 h-24 w-24 rounded-full border-[3px] border-[#1a1424]/20"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgba(26,20,36,0.18) 1.5px, transparent 1.6px)',
          backgroundSize: '7px 7px',
        }}
      />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-ink-700">با هم بودن</p>
            <p className="mt-1 text-[26px] font-extrabold leading-9 text-ink-900">{duration.shortLabel}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-700">
              از {anniversaryLabel(date)}
              <span className="mx-1.5 text-blush-800">•</span>
              {duration.totalDays.toLocaleString('fa-IR')} روز
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ProgressRing
              ratio={ring.ratio}
              label={toFa(ring.elapsed)}
              sub={`از ${toFa(ring.span)}`}
            />
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="tile-hover tile self-start px-2.5 py-1.5 text-[10.5px] font-black text-[#1a1424] transition"
              >
                ویرایش
              </button>
            )}
          </div>
        </div>

        {/*
          The door. When tonight is a celebration the card stops being a
          readout and becomes the entrance to the full-screen room — which is
          the only way a card can feel like it is *for* something.
        */}
        {celebration ? (
          <Link
            to="/celebrate?auto=1"
            className="mt-3 flex items-center justify-between gap-2 overflow-hidden border-[3px] border-[#1a1424] bg-[#b79cff] px-3.5 py-3 text-[#1a1424] shadow-[4px_4px_0_#1a1424] transition duration-100 active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_#1a1424]"
          >
            <span className="min-w-0">
              <span className="block text-[10px] font-black uppercase tracking-wider opacity-70">
                {celebration.subtitle} امشب
              </span>
              <span className="mt-0.5 block truncate text-[14px] font-black">
                {celebration.title} 🎉
              </span>
              <span className="mt-0.5 block text-[10px] font-semibold opacity-70">
                {celebration.opened ? 'جشن باز شده — دوباره سر بزن' : 'آماده‌ی جشن است'}
              </span>
            </span>
            <span aria-hidden="true" className="text-[20px]">✨</span>
          </Link>
        ) : (
          isToday && (
            <p className="well mt-3 px-3 py-2 text-center text-[12px] font-black text-[#1a1424]">
              🎉 امروز یکی از روزهای خاص شماست!
            </p>
          )
        )}

        {/* countdown pair */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Countdown
            eyebrow={monthly.daysUntil === 0 ? 'ماهگرد امروز' : `${toFa(monthly.monthNumber)} ماهگی`}
            value={daysUntilLabel(monthly.daysUntil)}
            sub={`${anniversaryLabel(monthly.iso)}`}
            accent="blush"
          />
          <Countdown
            eyebrow={yearly.daysUntil === 0 ? 'سالگرد امروز' : `${toFa(yearly.yearNumber)} سالگی`}
            value={daysUntilLabel(yearly.daysUntil)}
            sub={`${anniversaryLabel(yearly.iso)}`}
            accent="lilac"
          />
        </div>

        {milestones.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-bold text-ink-700">روزهای مهم پیشِ رو</p>
            <ul className="mt-2 space-y-1.5">
              {milestones.map((item) => (
                <li
                  key={item.key}
                  className="well flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-ink-700">
                    <span aria-hidden="true">{item.emoji}</span>
                    <span className="truncate">{item.title}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] font-bold text-blush-800">
                    {daysUntilLabel(item.daysUntil)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {setByName && (
          <p className="mt-3 text-[10px] text-ink-700">
            این تاریخ را {isMine ? 'خودت' : setByName} ثبت کرده
            {onEdit ? '؛ اگر اشتباه است از ویرایش عوضش کن.' : '.'}
          </p>
        )}
      </div>
    </section>
  )
}

function Countdown({
  eyebrow,
  value,
  sub,
  accent,
}: {
  eyebrow: string
  value: string
  sub: string
  accent: 'blush' | 'lilac'
}) {
  // Two small controls sitting on the card, so they are tiles rather than
  // panes — a card shadow on a 40px chip buries it in its own darkness.
  // Text colours are the deep steps: blush-800 is 5.3:1 on the worst glass and
  // lilac-700 is 5.7:1; their lighter neighbours do not clear 4.5.
  /* Flat accent plates. The two countdowns are the loudest numbers on the
     dashboard, so each gets its own poster colour rather than a tint; ink
     on #ff4d6d is 5.59:1 and on #b79cff 7.88:1. */
  const styles =
    accent === 'blush'
      ? 'border-[#1a1424] bg-[#ff4d6d] shadow-[3px_3px_0_#1a1424]'
      : 'border-[#1a1424] bg-[#b79cff] shadow-[3px_3px_0_#1a1424]'
  return (
    <div className={`border-2 px-3 py-2.5 text-[#1a1424] ${styles}`}>
      <p className="text-[10px] font-bold opacity-70">{eyebrow}</p>
      <p className="mt-0.5 text-[14px] font-black">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold opacity-70">{sub}</p>
    </div>
  )
}

function toFa(value: number): string {
  return value.toLocaleString('fa-IR', { useGrouping: false })
}

/**
 * The progress ring.
 *
 * SVG rather than a conic-gradient because it needs a rounded cap at the end
 * of the arc — a gradient stop is square, and a square end on a thin ring
 * looks like a rendering bug at this size.
 */
function ProgressRing({ ratio, label, sub }: { ratio: number; label: string; sub: string }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  const clamped = Math.min(1, Math.max(0, ratio))
  const dash = circumference * clamped

  return (
    <div className="relative grid h-[74px] w-[74px] shrink-0 place-items-center">
      <svg viewBox="0 0 74 74" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="37" cy="37" r={radius} fill="none" stroke="#1a1424" strokeOpacity="0.18" strokeWidth="6" />
        <circle
          cx="37"
          cy="37"
          r={radius}
          fill="none"
          stroke="#ff4d6d"
          strokeWidth="6"
          strokeLinecap="butt"
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="text-center leading-none">
        <p className="text-[13px] font-black text-[#1a1424]">{label}</p>
        <p className="mt-0.5 text-[8.5px] font-bold text-[#4a3f5c]">{sub}</p>
      </div>
    </div>
  )
}
