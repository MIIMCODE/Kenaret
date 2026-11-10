import { useMemo } from 'react'
import {
  anniversaryLabel,
  daysUntilLabel,
  nextMonthlyAnniversary,
  nextYearlyAnniversary,
  togetherSince,
  upcomingMilestones,
} from '../lib/anniversary'

interface Props {
  /** Gregorian ISO start date of the relationship. */
  date: string
  /** Opens the edit screen (settings). */
  onEdit?: () => void
  /** Name of the partner who set the date, for the tiny credit line. */
  setByName?: string | null
  isMine?: boolean
}

/**
 * The bright centre of the dashboard once a couple has a start date:
 * how long you have been together, the next monthiversary, the next
 * yearly anniversary and the milestones just ahead.
 */
export default function AnniversaryCard({ date, onEdit, setByName, isMine = false }: Props) {
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

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] bg-clay-100 p-5 shadow-neo">
      {/* soft decorative blobs */}
      <span className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-blush-200/40 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-10 -right-6 h-28 w-28 rounded-full bg-lilac-300/30 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-ink-700">با هم بودن</p>
            <p className="mt-1 text-[26px] font-extrabold leading-9 text-ink-900">{duration.shortLabel}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-700">
              از {anniversaryLabel(date)}
              <span className="mx-1.5 text-blush-600">•</span>
              {duration.totalDays.toLocaleString('fa-IR')} روز
            </p>
          </div>

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 rounded-xl bg-clay-100 px-2.5 py-1.5 text-[10.5px] font-bold text-blush-800 shadow-neo-sm transition-shadow hover:shadow-neo active:shadow-neo-in-sm"
            >
              ویرایش
            </button>
          )}
        </div>

        {isToday && (
          <p className="mt-3 rounded-2xl bg-clay-200 px-3 py-2 text-center text-[12px] font-bold text-blush-800 shadow-neo-in-sm">
            🎉 امروز یکی از روزهای خاص شماست!
          </p>
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
                  className="flex items-center justify-between gap-2 rounded-xl bg-clay-200 px-3 py-2 shadow-neo-in-sm"
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
  // Raised, so the countdown pair reads as two controls sitting on the slab.
  // Text colours are the deep steps: the light ones fail on clay.
  const styles =
    accent === 'blush'
      ? 'bg-clay-100 text-blush-800 shadow-neo-sm'
      : 'bg-clay-100 text-lilac-700 shadow-neo-sm'
  return (
    <div className={`rounded-2xl px-3 py-2.5 ${styles}`}>
      <p className="text-[10px] font-semibold text-ink-700">{eyebrow}</p>
      <p className="mt-0.5 text-[14px] font-extrabold">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium text-ink-700">{sub}</p>
    </div>
  )
}

function toFa(value: number): string {
  return value.toLocaleString('fa-IR', { useGrouping: false })
}
