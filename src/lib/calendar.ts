import {
  addDaysIso,
  daysBetweenIso,
  isoToJalali,
  jalaliDateClamped,
  jalaliMonthLength,
  jalaliMonthsBetween,
  jalaliToIso,
  persianWeekday,
  JALALI_MONTHS,
  toPersianDigits,
  todayIso,
} from './jalali'
import { anniversaryLabel } from './anniversary'

/**
 * The shared calendar: everything either partner is allowed to see on one
 * timeline.
 *
 * Nothing here talks to the network — the database hands over the facts
 * (anniversary date, both birth dates, the girl's own cycle settings) and this
 * module turns them into "what is coming up, and in how many days".
 */

export type EventKind =
  | 'yearly' // سالگرد آشنایی
  | 'monthly' // ماهگرد
  | 'birthday' // تولد
  | 'milestone' // ۱۰۰ روز با هم …
  | 'period' // شروع پریود (خصوصی)
  | 'period_end' // پایان پریود (خصوصی)

export interface CalendarEvent {
  /** Stable key, e.g. `yearly`, `birthday:me`, `period:2026-01-04`. */
  key: string
  kind: EventKind
  title: string
  /** Gregorian ISO of the event. */
  iso: string
  /** Days from the reference day until the event (0 = today). */
  daysUntil: number
  emoji: string
  /** Private events are only ever built for their owner. */
  private?: boolean
  /** Extra line shown under the title. */
  detail?: string
}

export interface PeriodTimings {
  /** Gregorian ISO of the last period start. */
  lastStart: string
  cycleLength: number
  periodLength: number
  isRegular: boolean
}

export interface UpcomingOptions {
  /** Gregorian ISO start date of the relationship, if known. */
  anniversary: string | null
  /** Your own birth date. */
  myBirth: string | null
  /** Partner's birth date. */
  partnerBirth: string | null
  /** Used for «تولد سارا». */
  partnerName?: string | null
  /**
   * Only ever pass this for the owner's own account. The partner's row is not
   * readable by RLS, and this function must not invent one.
   */
  period?: PeriodTimings | null
  /** Reference day; defaults to today. */
  from?: string
  /** How many days ahead to look. */
  horizon?: number
}

const DAY_MILESTONES: { days: number; title: string; emoji: string }[] = [
  { days: 100, title: '۱۰۰ روز با هم', emoji: '💯' },
  { days: 200, title: '۲۰۰ روز با هم', emoji: '🌱' },
  { days: 365, title: 'یک‌سالگی', emoji: '🎉' },
  { days: 500, title: '۵۰۰ روز با هم', emoji: '🌿' },
  { days: 730, title: 'دو‌سالگی', emoji: '🎊' },
  { days: 1000, title: '۱۰۰۰ روز با هم', emoji: '✨' },
  { days: 1095, title: 'سه‌سالگی', emoji: '🌟' },
  { days: 1500, title: '۱۵۰۰ روز با هم', emoji: '💫' },
  { days: 2000, title: '۲۰۰۰ روز با هم', emoji: '🏆' },
]

/**
 * Predicted cycle starts on or after `from`.
 *
 * Exact math for regular cycles; for irregular ones it is the average, which is
 * why every label around it says «تخمینی».
 */
export function periodStarts(
  timings: PeriodTimings,
  from: string,
  count = 6,
): { iso: string; daysUntil: number }[] {
  const { lastStart, cycleLength } = timings
  if (!Number.isFinite(cycleLength) || cycleLength < 15 || cycleLength > 60) return []

  const elapsed = daysBetweenIso(lastStart, from)
  // A cycle that starts exactly today still counts, hence ceil().
  const cyclesSoFar = elapsed <= 0 ? 0 : Math.ceil(elapsed / cycleLength)
  const out: { iso: string; daysUntil: number }[] = []

  for (let i = 0; i < count; i += 1) {
    const iso = addDaysIso(lastStart, (cyclesSoFar + i) * cycleLength)
    out.push({ iso, daysUntil: daysBetweenIso(from, iso) })
  }
  return out
}

/** True when `iso` falls inside a predicted bleeding window. */
export function isPeriodDay(timings: PeriodTimings, iso: string): boolean {
  const starts = periodStarts(timings, addDaysIso(iso, -70), 8)
  return starts.some((start) => {
    const diff = daysBetweenIso(start.iso, iso)
    return diff >= 0 && diff < timings.periodLength
  })
}

/**
 * The next cycle start that is still today or later, plus the day the current
 * or next window ends. Used by the dashboard countdown.
 */
export function nextPeriod(timings: PeriodTimings, from = todayIso()) {
  const [next] = periodStarts(timings, from, 1)
  if (!next) return null
  return {
    startIso: next.iso,
    endIso: addDaysIso(next.iso, timings.periodLength - 1),
    daysUntil: next.daysUntil,
  }
}

/**
 * The full "what's coming up" list, nearest first.
 */
export function upcomingEvents(options: UpcomingOptions): CalendarEvent[] {
  const from = options.from ?? todayIso()
  const horizon = options.horizon ?? 120
  const events: CalendarEvent[] = []

  const daysOf = (iso: string) => daysBetweenIso(from, iso)
  const within = (iso: string) => {
    const days = daysOf(iso)
    return days >= 0 && days <= horizon
  }

  // ---- relationship anniversaries -------------------------------------
  if (options.anniversary) {
    const start = options.anniversary
    const startJ = isoToJalali(start)
    const fromJ = isoToJalali(from)

    if (startJ && fromJ) {
      // Yearly: same Jalali month/day, in this Jalali year or the next.
      const thisYear = jalaliDateClamped(fromJ.jy, startJ.jm, startJ.jd)
      let yearly = thisYear && thisYear >= from ? thisYear : null
      let yearNumber = yearly ? fromJ.jy - startJ.jy : 0

      if (!yearly) {
        yearly = jalaliDateClamped(fromJ.jy + 1, startJ.jm, startJ.jd)
        yearNumber = fromJ.jy + 1 - startJ.jy
      }

      if (yearly && within(yearly)) {
        events.push({
          key: 'yearly',
          kind: 'yearly',
          title: yearNumber >= 2 ? `${fa(yearNumber)} سال با هم` : 'سالگرد آشنایی',
          iso: yearly,
          daysUntil: daysOf(yearly),
          emoji: '🎂',
          detail: `از ${anniversaryLabel(start)}`,
        })
      }

      // Monthly: the first monthiversary that is not in the past.
      for (let step = 1; step <= 14; step += 1) {
        const total = startJ.jm - 1 + step
        const jy = startJ.jy + Math.floor(total / 12)
        const jm = (total % 12) + 1
        const iso = jalaliDateClamped(jy, jm, startJ.jd)
        if (!iso || iso < from) continue
        if (within(iso)) {
          const n = jalaliMonthsBetween(start, iso)
          events.push({
            key: 'monthly',
            kind: 'monthly',
            title: `${fa(n)} ماه با هم`,
            iso,
            daysUntil: daysOf(iso),
            emoji: '💞',
          })
        }
        break
      }
    }

    // Day milestones.
    for (const mark of DAY_MILESTONES) {
      const iso = addDaysIso(start, mark.days)
      if (within(iso)) {
        events.push({
          key: `d${mark.days}`,
          kind: 'milestone',
          title: mark.title,
          iso,
          daysUntil: daysOf(iso),
          emoji: mark.emoji,
        })
      }
    }
  }

  // ---- birthdays -------------------------------------------------------
  // Birthdays follow the Jalali calendar: that is the day people celebrate.
  events.push(...birthdayEvents('birthday:me', 'تولد تو', options.myBirth, from, horizon))
  events.push(
    ...birthdayEvents(
      'birthday:partner',
      options.partnerName ? `تولد ${options.partnerName}` : 'تولد شریکت',
      options.partnerBirth,
      from,
      horizon,
    ),
  )

  // ---- private cycle events -------------------------------------------
  if (options.period) {
    const starts = periodStarts(options.period, from, 3)
    for (const start of starts.slice(0, 2)) {
      events.push({
        key: `period:${start.iso}`,
        kind: 'period',
        title: 'شروع پریود',
        iso: start.iso,
        daysUntil: start.daysUntil,
        emoji: '🌸',
        private: true,
        detail: options.period.isRegular ? undefined : 'تخمینی — چرخه‌ات نامنظم است',
      })
      const endIso = addDaysIso(start.iso, options.period.periodLength - 1)
      events.push({
        key: `period_end:${endIso}`,
        kind: 'period_end',
        title: 'پایان پریود',
        iso: endIso,
        daysUntil: daysOf(endIso),
        emoji: '🌷',
        private: true,
      })
    }
  }

  return events.sort((a, b) => a.daysUntil - b.daysUntil)
}

function birthdayEvents(
  key: string,
  title: string,
  birth: string | null,
  from: string,
  horizon: number,
): CalendarEvent[] {
  if (!birth) return []
  const birthJ = isoToJalali(birth)
  const fromJ = isoToJalali(from)
  if (!birthJ || !fromJ) return []

  const candidates = [
    jalaliDateClamped(fromJ.jy, birthJ.jm, birthJ.jd),
    jalaliDateClamped(fromJ.jy + 1, birthJ.jm, birthJ.jd),
  ].filter((iso): iso is string => !!iso)

  for (const iso of candidates) {
    if (iso < from) continue
    const days = daysBetweenIso(from, iso)
    if (days > horizon) continue

    const age = Number(iso.slice(0, 4)) - Number(birth.slice(0, 4))
    return [
      {
        key,
        kind: 'birthday',
        title,
        iso,
        daysUntil: days,
        emoji: '🎈',
        // Persian birthdays are counted by Jalali age, which is a year off on
        // average half the time — say the calendar age, plainly.
        detail: age > 0 ? `${fa(age)} ساله می‌شود` : undefined,
      },
    ]
  }
  return []
}

/** Groups events by their Jalali month, for the month-by-month list. */
export function groupByJalaliMonth(
  events: CalendarEvent[],
): { key: string; label: string; events: CalendarEvent[] }[] {
  const groups: { key: string; label: string; events: CalendarEvent[] }[] = []
  for (const event of events) {
    const j = isoToJalali(event.iso)
    if (!j) continue
    const key = `${j.jy}-${j.jm}`
    let group = groups.find((g) => g.key === key)
    if (!group) {
      group = { key, label: `${JALALI_MONTHS[j.jm - 1]} ${toPersianDigits(j.jy)}`, events: [] }
      groups.push(group)
    }
    group.events.push(event)
  }
  return groups
}

function fa(value: number): string {
  return toPersianDigits(value)
}

// ------------------------------------------------------------------
// Month grid — a real calendar, not a list of far-off dates
//
// The page used to render only "the next N days", which for a couple three
// weeks in meant one or two rows and a lot of empty space. A calendar should
// answer "what does this month look like", so the grid below is the primary
// view and the upcoming list is the secondary one.
// ------------------------------------------------------------------

export interface MonthCell {
  /** Gregorian ISO of the day. */
  iso: string
  /** Jalali day number, 1-31. */
  day: number
  /** False for the leading/trailing padding that completes the week. */
  inMonth: boolean
  isToday: boolean
  /** Everything that lands on this day, in render order. */
  events: CalendarEvent[]
}

export interface MonthGrid {
  jy: number
  jm: number
  label: string
  /** 6 rows of 7, always — so the grid never jumps height between months. */
  weeks: MonthCell[][]
}

/** Persian week starts on Saturday. */
function persianWeekdayOf(iso: string): number {
  return persianWeekday(iso) // 0 = Saturday, defined in jalali.ts
}

/**
 * Builds one Jalali month, padded to whole weeks.
 *
 * Events are bucketed by date first, so a day with four things on it shows four
 * dots rather than being found four times by a linear scan per cell.
 */
export function monthGrid(
  jy: number,
  jm: number,
  events: CalendarEvent[],
  today: string = todayIso(),
): MonthGrid {
  const byIso = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const list = byIso.get(event.iso)
    if (list) list.push(event)
    else byIso.set(event.iso, [event])
  }

  const length = jalaliMonthLength(jy, jm)
  const firstIso = jalaliDateClamped(jy, jm, 1)
  const cells: MonthCell[][] = []
  const pad = firstIso ? persianWeekdayOf(firstIso) : 0

  let row: MonthCell[] = []

  // Leading padding from the previous month.
  for (let i = pad; i > 0; i -= 1) {
    const iso = addDaysIso(firstIso!, -i)
    const parts = isoToJalali(iso)
    row.push({
      iso,
      day: parts?.jd ?? 0,
      inMonth: false,
      isToday: iso === today,
      events: byIso.get(iso) ?? [],
    })
  }

  for (let d = 1; d <= length; d += 1) {
    const iso = jalaliToIso(jy, jm, d)
    if (!iso) continue
    row.push({
      iso,
      day: d,
      inMonth: true,
      isToday: iso === today,
      events: byIso.get(iso) ?? [],
    })
    if (row.length === 7) {
      cells.push(row)
      row = []
    }
  }

  // Trailing padding to finish the last week.
  if (row.length > 0) {
    let step = 1
    while (row.length < 7) {
      const iso = addDaysIso(jalaliToIso(jy, jm, length)!, step)
      const parts = isoToJalali(iso)
      row.push({
        iso,
        day: parts?.jd ?? 0,
        inMonth: false,
        isToday: iso === today,
        events: byIso.get(iso) ?? [],
      })
      step += 1
    }
    cells.push(row)
  }

  // Always six rows: a calendar that grows and shrinks as you page wobbles.
  while (cells.length < 6) {
    const last = cells[cells.length - 1][6].iso
    const next: MonthCell[] = []
    for (let i = 1; i <= 7; i += 1) {
      const iso = addDaysIso(last, i)
      const parts = isoToJalali(iso)
      next.push({
        iso,
        day: parts?.jd ?? 0,
        inMonth: false,
        isToday: iso === today,
        events: byIso.get(iso) ?? [],
      })
    }
    cells.push(next)
  }

  return {
    jy,
    jm,
    label: `${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`,
    weeks: cells.slice(0, 6),
  }
}

/** The Jalali month `delta` months away from the given one (delta may be negative). */
export function shiftMonth(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  const total = jm - 1 + delta
  return { jy: jy + Math.floor(total / 12), jm: (((total % 12) + 12) % 12) + 1 }
}

/** Today as `{ jy, jm }`, for initialising the month grid. */
export function todayJalaliParts(iso: string = todayIso()): { jy: number; jm: number } {
  const parts = isoToJalali(iso)
  return { jy: parts?.jy ?? 1405, jm: parts?.jm ?? 1 }
}
