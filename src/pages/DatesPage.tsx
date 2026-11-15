import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import AddEventSheet from '../components/AddEventSheet'
import {
  deleteCalendarEvent,
  fetchCalendarEvents,
  fetchCycleShared,
  fetchMyPeriodWindows,
  fetchPairingState,
  fetchPartnerCycleStatus,
  fetchPartnerPeriodWindows,
  fetchPeriodSettings,
} from '../lib/api'
import { toPersianError } from '../lib/errors'
import {
  groupByJalaliMonth,
  isInWindow,
  nextPeriod,
  todayJalaliParts,
  upcomingEvents,
  type CalendarEvent,
  type PeriodTimings,
  type WindowRange,
} from '../lib/calendar'
import MonthCalendar from '../components/MonthCalendar'
import { anniversaryLabel, daysUntilLabel } from '../lib/anniversary'
import { addDaysIso, todayIso, weekdayName } from '../lib/jalali'
import type {
  CalendarEntry,
  PairingState,
  PartnerCycleStatus,
  PeriodWindow,
} from '../types/database'

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
  /** Days the couple wrote themselves. */
  const [entries, setEntries] = useState<CalendarEntry[]>([])
  /** Her own predicted windows (girls) — the grid shades these. */
  const [myWindows, setMyWindows] = useState<PeriodWindow[]>([])
  /** His partner's windows (boys, only while she shares). */
  const [herWindows, setHerWindows] = useState<PeriodWindow[]>([])
  /** True once she has shared, so the legend can say «چرخه‌ی او». */
  const [herWindowsShared, setHerWindowsShared] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  /** A delete that is in flight, so the row can dim instead of vanishing. */
  const [deletingId, setDeletingId] = useState<string | null>(null)

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

      /*
        Three reads that are allowed to fail independently.

        The calendar must still render if any one of them is unavailable — an
        entry list that failed to load should cost the entry list, not the
        whole page. `Promise.all` with per-call catches keeps the page useful.
      */
      const [eventRows, ownWindows, herWindowResult] = await Promise.all([
        fetchCalendarEvents().catch(() => [] as CalendarEntry[]),
        profile?.gender === 'girl'
          ? fetchMyPeriodWindows(6).catch(() => ({ windows: [] as PeriodWindow[] }))
          : Promise.resolve({ windows: [] as PeriodWindow[] }),
        profile?.gender === 'boy' && next.partner
          ? fetchPartnerPeriodWindows().catch(() => ({ shared: false, windows: [] as PeriodWindow[] }))
          : Promise.resolve({ shared: false, windows: [] as PeriodWindow[] }),
      ])

      setEntries(eventRows)
      setMyWindows(ownWindows.windows ?? [])
      setHerWindows(herWindowResult.windows ?? [])
      setHerWindowsShared(herWindowResult.shared === true)

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
      entries,
      reunion: state.reunion ?? null,
      viewerId: user?.id ?? null,
    })
    /*
      The list is "what is coming up", so a day that has already passed is
      dropped here rather than in the producer — the grid keeps them, because
      a calendar shows history and an agenda does not.
    */
    const upcoming = all.filter((event) => event.daysUntil >= 0)
    return filter === 'private' ? upcoming.filter((event) => event.private) : upcoming
  }, [state, profile?.birth_date, period, horizon, filter, entries, user?.id])

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
      entries,
      reunion: state.reunion ?? null,
      viewerId: user?.id ?? null,
    })
  }, [state, profile?.birth_date, period, entries, user?.id])

  const selectedEvents = useMemo(
    () => (selectedDay ? gridEvents.filter((event) => event.iso === selectedDay) : []),
    [gridEvents, selectedDay],
  )

  /**
   * The windows the grid shades.
   *
   * Memoised on the two arrays rather than rebuilt per render: `monthGrid`
   * receives them as a prop and re-buckets 42 cells whenever the identity
   * changes, so an inline object here would defeat its own `useMemo`.
   */
  const gridWindows = useMemo(() => {
    const own: WindowRange[] = myWindows.map((w) => ({ start: w.start, end: w.end }))
    const partner: WindowRange[] = herWindows.map((w) => ({ start: w.start, end: w.end }))
    return { own, partner }
  }, [myWindows, herWindows])

  /** Today, if it falls in a window — the header of the day sheet uses it. */
  const todayInWindow = useMemo(() => {
    const iso = todayIso()
    if (isInWindow(gridWindows.own, iso)) return 'own' as const
    if (isInWindow(gridWindows.partner, iso)) return 'partner' as const
    return null
  }, [gridWindows])

  const groups = useMemo(() => groupByJalaliMonth(events), [events])
  const today = useMemo(() => events.filter((event) => event.daysUntil === 0), [events])
  const cycle = period ? nextPeriod(period) : null
  const hasPartner = Boolean(state?.partner)

  /** Which window, if any, covers a day — used by the day sheet's subtitle. */
  const shadeOfDay = useCallback(
    (iso: string) => {
      if (isInWindow(gridWindows.own, iso)) return 'own' as const
      if (isInWindow(gridWindows.partner, iso)) return 'partner' as const
      return null
    },
    [gridWindows],
  )

  /**
   * Removes an authored entry.
   *
   * Optimistic, because the row is small and the user just confirmed by
   * tapping "حذف" twice (the sheet is already open, the button names the
   * event). A failure puts it back and says why.
   */
  const removeEntry = useCallback(
    async (event: CalendarEvent) => {
      if (!event.entryId || deletingId) return
      const id = event.entryId
      setDeletingId(id)
      try {
        await deleteCalendarEvent(id)
        setEntries((prev) => prev.filter((entry) => entry.id !== id))
        setError(null)
      } catch (deleteError) {
        setError(toPersianError(deleteError, 'این روز حذف نشد.'))
      } finally {
        setDeletingId(null)
      }
    },
    [deletingId],
  )

  if (loading && !state) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <div className="page">
          <Spinner className="mx-auto mt-20 h-8 w-8 text-[#c4194a]" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4">
        <section className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#4a3f5c]">
              تقویم مشترک
            </p>
            <h1 className="poster-type mt-1 text-[26px] text-[#1a1424]">روزهای مهم</h1>
            <p className="mt-1.5 text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
              {hasPartner
                ? 'سالگرد، ماهگرد، تولدها و روزهایی که خودتان نوشته‌اید.'
                : 'تاریخ تولد و روزهای خودت. با وصل شدن به شریکت، سالگرد هم اینجا می‌آید.'}
            </p>
          </div>

          {/* The one write action on the page, so it gets the loud button. */}
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="btn-primary mt-1 shrink-0 !px-3 !py-2 text-[12px]"
            aria-label="افزودن روز به تقویم"
          >
            <span aria-hidden="true" className="text-[15px] leading-none">
              +
            </span>
            روز جدید
          </button>
        </section>

        {error && <Alert tone="error">{error}</Alert>}

        {/* what's today */}
        {(today.length > 0 || todayInWindow) && (
          <section className="animate-fade-up border-[3px] border-[#1a1424] bg-[#ffd23f] p-4 shadow-[6px_6px_0_#1a1424]">
            <p className="eyebrow">امروز</p>
            <ul className="mt-1.5 space-y-1">
              {today.map((event) => (
                <li
                  key={event.key}
                  className="flex items-center gap-2 text-[13px] font-black text-[#1a1424]"
                >
                  <span aria-hidden="true">{event.emoji}</span>
                  {event.title}
                </li>
              ))}
              {/* A period window is a fact about today even when the exact
                  start was yesterday, so it belongs in this block and not only
                  as a hatch on the grid. */}
              {todayInWindow === 'own' && (
                <li className="flex items-center gap-2 text-[13px] font-black text-[#1a1424]">
                  <span aria-hidden="true">🌸</span>
                  در روزهای چرخه‌ات هستی
                </li>
              )}
              {todayInWindow === 'partner' && (
                <li className="flex items-center gap-2 text-[13px] font-black text-[#1a1424]">
                  <span aria-hidden="true">🌷</span>
                  او در روزهای چرخه‌اش است
                </li>
              )}
            </ul>
            {todayInWindow === 'partner' && (
              <p className="mt-1.5 text-[10px] leading-5 font-semibold text-[#1a1424]/70">
                این را فقط چون خودش اشتراک گذاشته می‌بینی.
              </p>
            )}
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
                className="rounded-none bg-[#ffefda] px-3 py-1.5 text-[11px] font-bold text-blush-800"
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
              <p className="mt-2 rounded-none bg-[#f0eaff] px-2.5 py-1.5 text-[10px] leading-5 font-semibold text-ink-700">
                اشتراک‌گذاری روشن است: شریکت فقط همین خلاصه را می‌بیند — نه تاریخ‌ها و نه طول
                چرخه. از تنظیمات می‌توانی خاموشش کنی.
              </p>
            ) : (
              <p className="mt-2 rounded-none bg-[#ffefda] px-2.5 py-1.5 text-[10px] font-semibold text-blush-800">
                این بخش فقط برای خودت دیده می‌شود، حتی شریکت هم دسترسی ندارد.
              </p>
            )}
          </section>
        )}

        {/* A quiet line when she shares: the grid is now shading her windows,
            and that should never be a surprise the user has to infer. */}
        {profile?.gender === 'boy' && herWindowsShared && herWindows.length > 0 && (
          <p className="border-2 border-[#1a1424] bg-[#f0eaff] px-3 py-2 text-[10px] leading-5 font-semibold text-[#4a3f5c]">
            روزهای چرخه‌ی او روی تقویم با خط‌های مورب بنفش نشانه خورده — اینکه خودش
            اشتراک گذاشته. طول چرخه و تاریخ‌هایش هیچ‌جا نوشته نمی‌شود.
          </p>
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
          windows={gridWindows}
        />

        {/* what is on the selected day */}
        {selectedDay && (
          <section className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-black text-[#1a1424]">
                  {anniversaryLabel(selectedDay)}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold text-[#4a3f5c]">
                  {weekdayName(selectedDay)}
                  {shadeOfDay(selectedDay) === 'own' && ' • در چرخه‌ی تو'}
                  {shadeOfDay(selectedDay) === 'partner' && ' • در چرخه‌ی او'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="shrink-0 px-2 py-1 text-[10.5px] font-bold text-[#4a3f5c] hover:bg-[#ffefda] hover:text-[#1a1424]"
              >
                بستن
              </button>
            </div>

            {selectedEvents.length === 0 ? (
              <div className="mt-2">
                <p className="text-[11.5px] leading-6 font-semibold text-[#4a3f5c]">
                  این روز چیزی در تقویم نیست.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSheetOpen(true)
                  }}
                  className="btn-soft mt-2 w-full !py-2 text-[12px]"
                >
                  برای این روز چیزی بنویس
                </button>
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {selectedEvents.map((event) => (
                  <li key={event.key} className="flex items-start gap-2">
                    <span aria-hidden="true" className="mt-0.5">
                      {event.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-bold text-[#1a1424]">
                        {event.title}
                        {event.private && (
                          <span className="mr-1.5 align-middle text-[9px] font-black text-[#5b3bb8]">
                            خصوصی
                          </span>
                        )}
                      </p>
                      {event.detail && (
                        <p className="mt-0.5 text-[10.5px] leading-5 font-semibold text-[#4a3f5c]">
                          {event.detail}
                        </p>
                      )}
                    </div>

                    {/* Only authored rows can be removed, and a private one
                        only by its author — the server enforces both, this
                        just avoids offering a button that will fail. */}
                    {event.entryId && (event.private === false || event.mine) && (
                      <button
                        type="button"
                        disabled={deletingId === event.entryId}
                        onClick={() => void removeEntry(event)}
                        className="shrink-0 px-1.5 py-1 text-[10px] font-bold text-[#c4194a] hover:bg-[#ffefda] disabled:opacity-40"
                        aria-label={`حذف ${event.title}`}
                      >
                        {deletingId === event.entryId ? '…' : 'حذف'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* the sheet that adds one */}
        <AddEventSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          initialDate={selectedDay}
          onCreated={(entry) => {
            setEntries((prev) => [...prev, entry])
            setSelectedDay(entry.event_on)
          }}
        />

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
                <span className="h-[3px] flex-1 bg-[#1a1424]" />
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

/**
 * One row in the agenda.
 *
 * Four kinds of day now share this row, and the only thing that has to be
 * legible at a glance is *which* — hence three accent plates rather than one
 * neutral chip:
 *   · today      → yellow, because today is the loudest fact on the page
 *   · authored   → cyan, and it says who wrote it
 *   · private    → lilac, so nobody has to guess why they cannot see it
 *   · everything else (derived) → white
 */
function EventRow({ event }: { event: CalendarEvent }) {
  const today = event.daysUntil === 0
  const authored = event.kind === 'custom'

  const plate = today
    ? 'bg-[#ffd23f]'
    : event.private
      ? 'bg-[#f0eaff]'
      : authored
        ? 'bg-[#d3f7fd]'
        : 'bg-white'

  return (
    <li
      className={`flex items-center gap-3 border-2 border-[#1a1424] px-3.5 py-3 ${plate}`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center border-2 border-[#1a1424] text-[15px] ${
          today ? 'bg-white' : event.private ? 'bg-[#b79cff]' : 'bg-[#ffefda]'
        }`}
        aria-hidden="true"
      >
        {event.emoji}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12.5px] font-black text-[#1a1424]">
          <span className="truncate">{event.title}</span>
          {event.private && (
            <span className="shrink-0 bg-[#5b3bb8] px-1 py-0.5 text-[8.5px] font-black text-white">
              خصوصی
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[10.5px] font-semibold text-[#4a3f5c]">
          {anniversaryLabel(event.iso)}
          {authored && event.mine !== undefined && (
            <span className="opacity-75"> • {event.mine ? 'خودت' : 'او'} نوشت</span>
          )}
          {event.detail && ` • ${event.detail}`}
        </p>
      </div>

      <span
        className={`shrink-0 border-2 border-[#1a1424] px-2 py-1 text-[10.5px] font-black ${
          today ? 'bg-[#ff4d6d] text-[#1a1424]' : 'bg-white text-[#1a1424]'
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
      className={`rounded-none px-3 py-1.5 text-[11.5px] font-bold transition ${
        active
          ? 'border-2 border-[#1a1424] bg-[#ff4d6d] font-black text-[#1a1424] shadow-[2px_2px_0_#1a1424]'
          : 'border-2 border-[#1a1424] bg-white font-bold text-[#4a3f5c] hover:bg-[#ffefda]'
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
        <span className="rounded-none bg-[#f0eaff] px-2 py-0.5 text-[9.5px] font-bold text-ink-700">
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

      <p className="mt-2.5 rounded-none bg-[#ffefda] px-2.5 py-1.5 text-[10px] leading-5 font-semibold text-blush-800">
        این خلاصه را خودش با تو به اشتراک گذاشته و هر لحظه می‌تواند خاموشش کند.
      </p>
    </section>
  )
}

function toPersianDigits(value: number): string {
  return String(value).replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])
}
