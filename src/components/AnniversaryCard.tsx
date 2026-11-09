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
    <section className="relative overflow-hidden rounded-3xl border border-white bg-gradient-to-bl from-blush-50 via-white to-lilac-100/70 p-5 shadow-card">
      {/* soft decorative blobs */}
      <span className="pointer-events-none absolute -left-6 -top-8 h-24 w-24 rounded-full bg-blush-200/40 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-10 -right-6 h-28 w-28 rounded-full bg-lilac-300/30 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold text-ink-500">با هم بودن</p>
            <p className="mt-1 text-[26px] font-extrabold leading-9 text-ink-900">{duration.shortLabel}</p>
            <p className="mt-0.5 text-[11.5px] text-ink-500">
              از {anniversaryLabel(date)}
              <span className="mx-1.5 text-blush-300">•</span>
              {duration.totalDays.toLocaleString('fa-IR')} روز
            </p>
          </div>

          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 rounded-xl border border-blush-200 bg-white/80 px-2.5 py-1.5 text-[10.5px] font-bold text-blush-600 transition hover:bg-white"
            >
              ویرایش
            </button>
          )}
        </div>

        {isToday && (
          <p className="mt-3 rounded-2xl bg-blush-500/10 px-3 py-2 text-center text-[12px] font-bold text-blush-700">
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
                  className="flex items-center justify-between gap-2 rounded-xl bg-white/70 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-ink-700">
                    <span aria-hidden="true">{item.emoji}</span>
                    <span className="truncate">{item.title}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] font-bold text-blush-600">
                    {daysUntilLabel(item.daysUntil)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {setByName && (
          <p className="mt-3 text-[10px] text-ink-500">
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
  const styles =
    accent === 'blush'
      ? 'border-blush-200 bg-white/80 text-blush-600'
      : 'border-lilac-200 bg-white/80 text-lilac-600'
  return (
    <div className={`rounded-2xl border px-3 py-2.5 ${styles}`}>
      <p className="text-[10px] font-semibold text-ink-500">{eyebrow}</p>
      <p className="mt-0.5 text-[14px] font-extrabold">{value}</p>
      <p className="mt-0.5 text-[10px] font-medium text-ink-500">{sub}</p>
    </div>
  )
}

function toFa(value: number): string {
  return value.toLocaleString('fa-IR', { useGrouping: false })
}
