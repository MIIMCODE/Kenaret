import { daysBetweenIso, isoToJalali, JALALI_MONTHS, toPersianDigits, todayIso } from './jalali'

/**
 * Relationship-anniversary maths.
 *
 * All dates are Gregorian ISO (`YYYY-MM-DD`) on the way in and out; only the
 * labels are Jalali.
 */

export interface TogetherDuration {
  /** The Gregorian ISO date the duration was measured from. */
  startIso: string
  years: number
  months: number
  days: number
  totalDays: number
  /** Human readable, e.g. «۲ سال و ۳ ماه و ۵ روز» */
  label: string
  /** Compact form for small chips, e.g. «۲ سال و ۳ ماه» */
  shortLabel: string
}

/**
 * Calendar-accurate elapsed time between two dates.
 * Months are counted on the calendar (not as 30-day blocks) so that
 * "one month after 31 May" lands on 1 July, which is what people expect.
 */
export function togetherSince(startIso: string, endIso: string = todayIso()): TogetherDuration {
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const [ey, em, ed] = endIso.split('-').map(Number)

  const totalDays = Math.max(0, daysBetweenIso(startIso, endIso))

  if (endIso <= startIso) {
    return {
      startIso,
      years: 0,
      months: 0,
      days: 0,
      totalDays: 0,
      label: 'امروز شروع شد',
      shortLabel: 'امروز',
    }
  }

  let years = ey - sy
  let months = em - sm
  let days = ed - sd

  if (days < 0) {
    months -= 1
    // Borrow from the previous month, but measure that month from the START
    // DAY rather than its total length. Example: 31 Jan -> 1 Mar.
    //   simple borrow: +28 (Feb) then 1 - 31 = -30  -> wrong
    //   this version:  (28 - 31 + 1) + 1 = -1 + 1   -> 1 day   ✔
    const prevMonth = em === 1 ? 12 : em - 1
    const prevYear = em === 1 ? ey - 1 : ey
    const prevMonthLength = daysInGregorianMonth(prevYear, prevMonth)

    // Clamp the start day to the borrowed month's length: 31 Jan lands on the
    // 29th/28th of February, so the "days left" start from there.
    const borrowFrom = Math.min(sd, prevMonthLength)
    days = ed + (prevMonthLength - borrowFrom)
  }

  if (months < 0) {
    years -= 1
    months += 12
  }

  // Guard against "2 months 30 days" style output when the end month is longer.
  const endMonthLength = daysInGregorianMonth(ey, em)
  while (days >= endMonthLength) {
    days -= endMonthLength
    months += 1
    if (months >= 12) {
      months -= 12
      years += 1
    }
  }

  const parts: string[] = []
  if (years > 0) parts.push(`${fa(years)} سال`)
  if (months > 0) parts.push(`${fa(months)} ماه`)
  if (days > 0) parts.push(`${fa(days)} روز`)
  if (parts.length === 0) parts.push('کمتر از یک روز')

  const shortParts: string[] = []
  if (years > 0) shortParts.push(`${fa(years)} سال`)
  if (months > 0) shortParts.push(`${fa(months)} ماه`)
  if (shortParts.length === 0) shortParts.push(`${fa(days)} روز`)

  return {
    startIso,
    years,
    months,
    days,
    totalDays,
    label: parts.join(' و '),
    shortLabel: shortParts.join(' و '),
  }
}

function daysInGregorianMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/**
 * A month is 30 days — counted, not "the same day next month".
 * ---------------------------------------------------------------------------
 * This used to walk calendar months, which made October 31 days long and put
 * the first monthiversary on day 31 instead of day 30. For a couple counting
 * days, that is simply the wrong evening, and it disagreed with the database —
 * the card said "day 31" while the room stayed shut.
 *
 * The rule now matches `celebration_candidates()` exactly: an anniversary is
 * any day that lands on a multiple of the block. Keep the two in step.
 */
export const MONTH_DAYS = 30

/** Adds days to a Gregorian ISO date without a date library. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * The next monthiversary, counting in 30-day blocks.
 *
 * A 12-block anniversary is a *yearly* one — the same boundary the database
 * uses — so `nextMonthlyAnniversary` skips those days rather than promising a
 * "12 month" banner the room would refuse to open.
 */
export function nextMonthlyAnniversary(
  startIso: string,
  fromIso: string = todayIso(),
  blockDays: number = MONTH_DAYS,
): { iso: string; daysUntil: number; monthNumber: number } {
  const block = Math.max(1, blockDays)
  const elapsed = Math.max(0, daysBetweenIso(startIso, fromIso))
  let blocks = Math.floor(elapsed / block)

  // Land on the next boundary, and never on a yearly one.
  for (let guard = 0; guard < 24; guard += 1) {
    blocks += 1
    if (blocks % 12 !== 0) break
  }

  const iso = addDaysIso(startIso, blocks * block)
  return {
    iso,
    daysUntil: Math.max(0, daysBetweenIso(fromIso, iso)),
    monthNumber: blocks,
  }
}

/** The next yearly anniversary: every twelfth block. */
export function nextYearlyAnniversary(
  startIso: string,
  fromIso: string = todayIso(),
  blockDays: number = MONTH_DAYS,
): { iso: string; daysUntil: number; yearNumber: number } {
  const block = Math.max(1, blockDays)
  const elapsed = Math.max(0, daysBetweenIso(startIso, fromIso))
  const blocks = Math.floor(elapsed / block)
  const yearsIn = Math.floor(blocks / 12)
  const nextYear = yearsIn + 1

  const iso = addDaysIso(startIso, nextYear * 12 * block)
  return {
    iso,
    daysUntil: Math.max(0, daysBetweenIso(fromIso, iso)),
    yearNumber: nextYear,
  }
}

function isoFromParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Milestones worth celebrating, based on how long you have been together.
 * Returns only the next few, closest first.
 */
export interface Milestone {
  key: string
  title: string
  /** Gregorian ISO date of the milestone. */
  iso: string
  daysUntil: number
  emoji: string
}

export function upcomingMilestones(
  startIso: string,
  fromIso: string = todayIso(),
  limit = 3,
): Milestone[] {
  const milestones: Milestone[] = []

  // Day-based early milestones.
  const dayMilestones: { days: number; title: string; emoji: string }[] = [
    { days: 100, title: '۱۰۰ روز با هم', emoji: '💯' },
    { days: 200, title: '۲۰۰ روز با هم', emoji: '🌱' },
    { days: 365, title: 'یک‌سالگی', emoji: '🎂' },
    { days: 500, title: '۵۰۰ روز با هم', emoji: '🌿' },
    { days: 730, title: 'دو‌سالگی', emoji: '🎉' },
    { days: 1000, title: '۱۰۰۰ روز با هم', emoji: '✨' },
    { days: 1095, title: 'سه‌سالگی', emoji: '🌟' },
    { days: 1500, title: '۱۵۰۰ روز با هم', emoji: '💫' },
    { days: 2000, title: '۲۰۰۰ روز با هم', emoji: '🏆' },
  ]

  for (const item of dayMilestones) {
    const iso = addDays(startIso, item.days)
    const daysUntil = daysBetweenIso(fromIso, iso)
    if (daysUntil >= 0) {
      milestones.push({ key: `d${item.days}`, title: item.title, iso, daysUntil, emoji: item.emoji })
    }
  }

  // Jubilee years (5, 10, 15, …).
  const firstYear = Number(startIso.slice(0, 4))
  const fromYear = Number(fromIso.slice(0, 4))
  for (let anniversary = Math.max(5, fromYear - firstYear); anniversary <= fromYear - firstYear + 15; anniversary += 5) {
    const yearly = yearlyOn(startIso, anniversary)
    if (yearly < fromIso) continue
    const daysUntil = daysBetweenIso(fromIso, yearly)
    const jalaliNum = toPersianDigits(anniversary)
    milestones.push({
      key: `y${anniversary}`,
      title: `${jalaliNum} سال با هم`,
      iso: yearly,
      daysUntil,
      emoji: anniversary % 10 === 0 ? '💍' : '🎊',
    })
  }

  return milestones.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, limit)
}

function yearlyOn(startIso: string, nth: number): string {
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const year = sy + nth
  return isoFromParts(year, sm, Math.min(sd, daysInGregorianMonth(year, sm)))
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return isoFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** «۱۲ اسفند ۱۴۰۲» style label for a stored date. */
export function anniversaryLabel(iso: string): string {
  const j = isoToJalali(iso)
  if (!j) return '—'
  return toPersianDigits(`${j.jd} ${JALALI_MONTHS[j.jm - 1]} ${j.jy}`)
}

/** Turns `daysUntil` into friendly Persian copy. */
export function daysUntilLabel(days: number): string {
  if (days === 0) return 'امروز!'
  if (days === 1) return 'فردا'
  return `${fa(days)} روز دیگر`
}

function fa(value: number): string {
  return toPersianDigits(value)
}
