import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import {
  fetchCycleShared,
  fetchPairingState,
  fetchPartnerCycleStatus,
  fetchPeriodSettings,
} from '../lib/api'
import { toPersianError } from '../lib/errors'
import {
  groupByJalaliMonth,
  nextPeriod,
  todayJalaliParts,
  upcomingEvents,
  type CalendarEvent,
  type PeriodTimings,
} from '../lib/calendar'
import MonthCalendar from '../components/MonthCalendar'
import { anniversaryLabel, daysUntilLabel } from '../lib/anniversary'
import { addDaysIso, todayIso } from '../lib/jalali'
import type { PairingState, PartnerCycleStatus } from '../types/database'

type Filter = 'all' | 'private'

export default function DatesPage() {
  const { user, profile } = useAuth()
  const [state, setState] = useState<PairingState | null>(null)
  const [period, setPeriod] = useState<PeriodTimings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  /**
   * A year, not four months.
   *
   * At 120 days a couple three weeks in saw two rows — nothing from before
   * today, and nothing beyond January. That reads as "the calendar is broken"
   * even though the maths was right. A calendar should hold a year.
   */
  const [horizon, setHorizon] = useState(370)
  /** Which Jalali month the grid is showing. */
  const [month, setMonth] = useState(() => todayJalaliParts())
  /** The day whose events are listed under the grid. */
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  /** Girls: is my cycle currently visible to my partner? */
  const [sharingCycle, setSharingCycle] = useState(false)
  /** Boys: the coarse status her share allows — or `{ shared: false }`. */
  const [partnerCycle, setPartnerCycle] = useState<PartnerCycleStatus>({ shared: false })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await fetchPairingState()
      setState(next)

      // Period settings are owner-only; only the girl's own account can read
      // them, which is exactly the guarantee the page relies on.
      if (profile?.gender === 'girl' && user) {
        const settings = await fetchPeriodSettings(user.id)
        setPeriod(
          settings
            ? {
                lastStart: settings.last_period_start,
                cycleLength: settings.cycle_length,
                periodLength: settings.period_length,
                isRegular: settings.is_regular,
              }
            : null,
        )
      } else {
        setPeriod(null)
      }

      if (profile?.gender === 'girl') {
        setSharingCycle(await fetchCycleShared().catch(() => false))
        setPartnerCycle({ shared: false })
      } else if (profile?.gender === 'boy' && next.partner) {
        setPartnerCycle(await fetchPartnerCycleStatus().catch(() => ({ shared: false }) as const))
      } else {
        setPartnerCycle({ shared: false })
      }
      setError(null)
    } catch (loadError) {
      setError(toPersianError(loadError, 'روزهای مهم بارگذاری نشد.'))
    } finally {
      setLoading(false)
    }
  }, [profile?.gender, user])

  useEffect(() => {
    void load()
  }, [load])

  const events = useMemo(() => {
    if (!state) return []
    const all = upcomingEvents({
      anniversary: state.anniversary?.date ?? null,
      myBirth: profile?.birth_date ?? null,
      partnerBirth: state.partner?.birth_date ?? null,
      partnerName: state.partner?.display_name ?? null,
      period,
      horizon,
    })
    return filter === 'private' ? all.filter((event) => event.private) : all
  }, [state, profile?.birth_date, period, horizon, filter])

  /**
   * The grid needs every event in the visible month, including days that have
   * already passed — a calendar that hides last Tuesday is not a calendar.
   * So it gets its own full-year set, generated from the first cell of the
   * month rather than from today.
   */
  const gridEvents = useMemo(() => {
    if (!state) return []
    return upcomingEvents({
      anniversary: state.anniversary?.date ?? null,
      myBirth: profile?.birth_date ?? null,
      partnerBirth: state.partner?.birth_date ?? null,
      partnerName: state.partner?.display_name ?? null,
      period,
      // Start 45 days before today so the leading padding of the current month
      // and the whole previous month still carry their dots.
      from: addDaysIso(todayIso(), -45),
      horizon: 460,
    })
  }, [state, profile?.birth_date, period])

  const selectedEvents = useMemo(
    () => (selectedDay ? gridEvents.filter((event) => event.iso === selectedDay) : []),
    [gridEvents, selectedDay],
  )

  const groups = useMemo(() => groupByJalaliMonth(events), [events])
  const today = useMemo(() => events.filter((event) => event.daysUntil === 0), [events])
  const cycle = period ? nextPeriod(period) : null
  const hasPartner = Boolean(state?.partner)

  if (loading && !state) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <div className="page">
          <Spinner className="mx-auto mt-20 h-8 w-8 text-blush-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4">
        <section>
          <p className="text-[12px] font-semibold text-ink-500">تقویم مشترک</p>
          <h1 className="mt-0.5 text-[23px] font-extrabold leading-9 text-ink-900">روزهای مهم</h1>
          <p className="mt-1 text-[11.5px] leading-6 text-ink-500">
            {hasPartner
              ? 'سالگرد، ماهگرد، تولدها و روزهای شمردنی — همه در یک جا.'
              : 'تاریخ تولد و روزهای خودت. با وصل شدن به شریکت، سالگرد و ماهگرد هم اینجا می‌آید.'}
          </p>
        </section>

        {error && <Alert tone="error">{error}</Alert>}

        {/* what's today */}
        {today.length > 0 && (
          <section className="animate-fade-up rounded-3xl border border-blush-200 bg-gradient-to-bl from-blush-50 to-lilac-100/60 p-4">
            <p className="text-[11px] font-bold text-blush-800">امروز</p>
            <ul className="mt-1.5 space-y-1">
              {today.map((event) => (
                <li key={event.key} className="flex items-center gap-2 text-[13px] font-semibold text-ink-900">
                  <span aria-hidden="true">{event.emoji}</span>
                  {event.title}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* the couple's anchor */}
        {state?.anniversary?.date ? (
          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-ink-500">تاریخ آشنایی</p>
                <p className="mt-0.5 text-[14px] font-extrabold text-ink-900">
                  {anniversaryLabel(state.anniversary.date)}
                </p>
              </div>
              <Link
                to="/settings"
                className="rounded-xl bg-blush-50 px-3 py-1.5 text-[11px] font-bold text-blush-800"
              >
                تغییر
              </Link>
            </div>
          </section>
        ) : (
          hasPartner && (
            <section className="card p-4">
              <p className="text-[12px] leading-6 text-ink-700">
                هنوز تاریخ آشنایی ثبت نشده. با ثبتش، سالگرد و ماهگرد و شمارنده‌ی روزها برای هر
                دویتان فعال می‌شود.
              </p>
              <Link to="/app" className="btn-soft mt-2.5 w-full !py-2.5 text-[12.5px]">
                ثبت تاریخ آشنایی
              </Link>
            </section>
          )
        )}

        {/* private cycle summary — never leaves the owner's account */}
        {cycle && (
          <section className="card p-4">
            <p className="text-[11px] font-semibold text-ink-500">چرخه‌ی تو</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[15px] font-extrabold text-ink-900">
                {cycle.daysUntil === 0 ? 'امروز' : daysUntilLabel(cycle.daysUntil)}
              </span>
              <span className="text-[11.5px] text-ink-500">تا شروع پریود بعدی</span>
            </div>
            <p className="mt-1 text-[10.5px] leading-5 text-ink-500">
              {anniversaryLabel(cycle.startIso)} تا {anniversaryLabel(cycle.endIso)}
              {!period?.isRegular && ' • تخمینی، چون چرخه‌ات نامنظم است'}
            </p>
            {sharingCycle ? (
              <p className="mt-2 rounded-xl bg-lilac-100 px-2.5 py-1.5 text-[10px] leading-5 font-semibold text-ink-700">
                اشتراک‌گذاری روشن است: شریکت فقط همین خلاصه را می‌بیند — نه تاریخ‌ها و نه طول
                چرخه. از تنظیمات می‌توانی خاموشش کنی.
              </p>
            ) : (
              <p className="mt-2 rounded-xl bg-blush-50 px-2.5 py-1.5 text-[10px] font-semibold text-blush-800">
                این بخش فقط برای خودت دیده می‌شود، حتی شریکت هم دسترسی ندارد.
              </p>
            )}
          </section>
        )}

        {/* what she chose to share with him — a phase, never a date */}
        {profile?.gender === 'boy' && partnerCycle.shared && (
          <PartnerCycleCard status={partnerCycle} name={state?.partner?.display_name ?? null} />
        )}

        {/* ---- the month grid: the real calendar ---- */}
        <MonthCalendar
          jy={month.jy}
          jm={month.jm}
          events={gridEvents}
          today={todayIso()}
          selected={selectedDay}
          onSelect={(iso) => setSelectedDay((prev) => (prev === iso ? null : iso))}
          onChangeMonth={(jy, jm) => {
            setMonth({ jy, jm })
            setSelectedDay(null)
          }}
          onGoToday={() => {
            setMonth(todayJalaliParts())
            setSelectedDay(todayIso())
          }}
        />

        {/* what is on the selected day */}
        {selectedDay && (
          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] font-extrabold text-ink-900">
                {anniversaryLabel(selectedDay)}
              </p>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="text-[10.5px] font-bold text-ink-500 hover:text-blush-600"
              >
                بستن
              </button>
            </div>

            {selectedEvents.length === 0 ? (
              <p className="mt-2 text-[11.5px] leading-6 text-ink-500">
                این روز چیزی در تقویم نیست. می‌توانی همان روز یک دیدار بگذاری یا فقط برای خودت
                علامتش بزنی.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {selectedEvents.map((event) => (
                  <li key={event.key} className="flex items-center gap-2">
                    <span aria-hidden="true">{event.emoji}</span>
                    <span className="text-[12.5px] font-bold text-ink-900">{event.title}</span>
                    {event.detail && (
                      <span className="text-[10.5px] text-ink-500">— {event.detail}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* filters */}
        <div className="flex gap-2">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
            همه
          </FilterChip>
          {period && (
            <FilterChip active={filter === 'private'} onClick={() => setFilter('private')}>
              فقط برای من
            </FilterChip>
          )}
        </div>

        {/* the timeline */}
        {groups.length === 0 ? (
          <section className="card p-6 text-center">
            <p className="text-[26px]" aria-hidden="true">
              🌱
            </p>
            <p className="mt-2 text-[13px] font-bold text-ink-900">در این بازه چیزی نیست</p>
            <p className="mx-auto mt-1 max-w-[18rem] text-[11.5px] leading-6 text-ink-500">
              {filter === 'private'
                ? 'برای دیدن روزهای دوره‌ات، اول تاریخ آخرین پریودت را در تنظیمات کامل کن.'
                : 'در این بازه رویدادی نیست — ولی تقویم ماه بالاتر همهٔ روزها را نشان می‌دهد.'}
            </p>
            <Link to="/settings" className="btn-ghost mt-3 inline-flex !py-2.5 text-[12.5px]">
              رفتن به تنظیمات
            </Link>
          </section>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-[12px] font-extrabold text-ink-900">{group.label}</h2>
                <span className="h-px flex-1 bg-gradient-to-l from-transparent via-blush-200 to-transparent" />
              </div>
              <ul className="space-y-2">
                {group.events.map((event) => (
                  <EventRow key={event.key} event={event} />
                ))}
              </ul>
            </section>
          ))
        )}

        {events.length > 0 && (
          <button
            type="button"
            onClick={() => setHorizon((value) => (value >= 370 ? 60 : 370))}
            className="btn-ghost w-full !py-2.5 text-[12.5px]"
          >
            {horizon >= 370 ? 'فقط دو ماه آینده' : 'دیدن یک سال کامل'}
          </button>
        )}

        <Link to="/settings" className="block text-center text-[11.5px] font-bold text-blush-800 hover:underline">
          تنظیم یادآوری‌ها
        </Link>

        <p className="pt-1 text-center text-[10.5px] leading-5 text-ink-500">
          یادآوری‌ها یک روز قبل با ایمیل می‌آیند و هر لحظه از تنظیمات خاموش‌شدنی‌اند.
        </p>
      </main>
    </div>
  )
}

function EventRow({ event }: { event: CalendarEvent }) {
  const today = event.daysUntil === 0
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${
        today ? 'border-blush-300 bg-blush-50/80' : event.private ? 'border-lilac-200 bg-lilac-100/40' : 'border-blush-100 bg-white'
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[15px] ${
          event.private ? 'bg-lilac-100' : 'bg-blush-50'
        }`}
        aria-hidden="true"
      >
        {event.emoji}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-bold text-ink-900">{event.title}</p>
        <p className="mt-0.5 text-[10.5px] text-ink-500">
          {anniversaryLabel(event.iso)}
          {event.detail && ` • ${event.detail}`}
        </p>
      </div>

      <span
        className={`shrink-0 rounded-lg px-2 py-1 text-[10.5px] font-extrabold ${
          today ? 'bg-[#bf2f59] text-white' : 'tile text-blush-800'
        }`}
      >
        {daysUntilLabel(event.daysUntil)}
      </span>
    </li>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl px-3 py-1.5 text-[11.5px] font-bold transition ${
        active ? 'bg-[#bf2f59] text-white' : 'bg-white/80 text-ink-500 hover:bg-white'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * What he sees while she shares her cycle.
 *
 * Three words, no dates: «پریود», «نزدیک پریود», «روزهای آرام». The countdown is
 * to a *window*, not a stored date, and there is no link that opens her data —
 * turning the share off makes this card disappear entirely.
 */
function PartnerCycleCard({
  status,
  name,
}: {
  status: Exclude<PartnerCycleStatus, { shared: false }>
  name: string | null
}) {
  const who = name ?? 'شریکت'

  const copy =
    status.phase === 'period'
      ? {
          emoji: '🩸',
          label: 'این روزها پریود است',
          hint:
            status.days_left > 0
              ? `حدود ${toPersianDigits(status.days_left)} روز دیگر ادامه دارد.`
              : 'کمی همدلی بیشتر این روزها معجزه می‌کند.',
        }
      : status.phase === 'pms'
        ? {
            emoji: '🌧',
            label: `نزدیک پریود است (حدود ${toPersianDigits(status.days_until)} روز دیگر)`,
            hint: 'این یکی‌دو روز ممکن است حوصله‌اش کم باشد؛ آرام‌تر رفتار کن.',
          }
        : {
            emoji: '🌤',
            label: 'روزهای آرامش',
            hint:
              status.days_until > 0
                ? `پریود بعدی حدود ${toPersianDigits(status.days_until)} روز دیگر شروع می‌شود.`
                : 'الان در دوره‌ی پریود نیست.',
          }

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-ink-500">حال {who}</p>
        <span className="rounded-lg bg-lilac-100 px-2 py-0.5 text-[9.5px] font-bold text-ink-700">
          با اجازه‌ی خودش
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-2.5">
        <span className="text-[22px]" aria-hidden="true">
          {copy.emoji}
        </span>
        <div className="min-w-0">
          <p className="text-[13.5px] font-extrabold text-ink-900">{copy.label}</p>
          <p className="mt-0.5 text-[10.5px] leading-5 text-ink-500">{copy.hint}</p>
        </div>
      </div>

      <p className="mt-2.5 rounded-xl bg-blush-50 px-2.5 py-1.5 text-[10px] leading-5 font-semibold text-blush-800">
        این خلاصه را خودش با تو به اشتراک گذاشته و هر لحظه می‌تواند خاموشش کند.
      </p>
    </section>
  )
}

function toPersianDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])
}
