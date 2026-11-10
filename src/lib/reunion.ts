import { addDaysIso, daysBetweenIso, formatJalaliLong, toPersianDigits, weekdayName } from './jalali'
import type { WarmthKind, WarmthSignal } from '../types/database'

/**
 * How the dashboard talks about a reunion date.
 *
 * The whole point of this feature is that the number gets *smaller* every
 * morning, so the phrasing has to change as it does — «۱۹ روز مانده» and
 * «امروز میبینیش» should not read like the same sentence with a swapped
 * number.
 */

export interface ReunionView {
  /** Days from `today` to the reunion. 0 means today. */
  days: number
  /** False once the date has passed (a stale row the server would reject). */
  upcoming: boolean
  /** Big number for the countdown, already in Persian digits. */
  count: string
  /** Short unit under the number: «روز» or, on the last day, «امروز». */
  unit: string
  /** The sentence above the number. */
  lead: string
  /** e.g. `۲۹ آبان ۱۴۰۵` */
  dateLabel: string
  /** e.g. `جمعه` — the weekday, because that is how people plan. */
  weekday: string
}

const UNIT_DAYS = 'روز'

/** Pure so the copy is testable without a DOM or a clock. */
export function reunionView(meetOn: string, today: string): ReunionView {
  const days = daysBetweenIso(today, meetOn)
  const dateLabel = formatJalaliLong(meetOn)
  const weekday = weekdayName(meetOn)

  if (days < 0) {
    return {
      days,
      upcoming: false,
      count: toPersianDigits(Math.abs(days)),
      unit: UNIT_DAYS,
      lead: 'این دیدار گذشت',
      dateLabel,
      weekday,
    }
  }

  if (days === 0) {
    return {
      days,
      upcoming: true,
      count: 'امروز',
      unit: 'میبینیش',
      lead: 'بالاخره رسید',
      dateLabel,
      weekday,
    }
  }

  if (days === 1) {
    return {
      days,
      upcoming: true,
      count: 'فردا',
      unit: 'میبینیش',
      lead: 'فقط یک خواب',
      dateLabel,
      weekday,
    }
  }

  return {
    days,
    upcoming: true,
    count: toPersianDigits(days),
    unit: UNIT_DAYS,
    lead: 'تا دیدار بعدی',
    dateLabel,
    weekday,
  }
}

/**
 * The bell line for a reunion, used one day ahead of the email text so the
 * two channels never disagree.
 */
export function reunionReminderLine(meetOn: string, today: string): string {
  const days = daysBetweenIso(today, meetOn)
  if (days === 0) return 'امروز میبینیش'
  if (days === 1) return 'فردا میبینیش'
  return `${toPersianDigits(days)} روز تا دیدارت`
}

/** Tomorrow, as the date default when the editor opens. */
export function defaultReunionDate(today: string): string {
  return addDaysIso(today, 7)
}

/**
 * A warmth signal resolved for the bell.
 *
 * Kept separate from `InAppReminder` because it is not a date on a calendar —
 * it has no `daysUntil`, cannot be "upcoming", and disappears once seen.
 */
export interface WarmthLine {
  key: string
  /** «دلم برات تنگ شده» etc. */
  label: string
  emoji: string
  /** «محمد رضا همین حالا فرستاد» */
  sentence: string
}

const WARMTH_META: Record<WarmthKind, { label: string; emoji: string; verb: string }> = {
  miss: { label: 'دلم برات تنگ شده', emoji: '🤍', verb: 'دلت را تنگ کرده' },
  hug: { label: 'بغل', emoji: '🫂', verb: 'بغلش را فرستاده' },
  cheer: { label: 'قوت قلب', emoji: '☀️', verb: 'قوت‌قلبت را فرستاده' },
}

/** Resolves one server row. Unknown kinds are dropped rather than guessed. */
export function toWarmthLine(signal: WarmthSignal): WarmthLine | null {
  const meta = WARMTH_META[signal.kind]
  if (!meta) return null
  return {
    key: signal.id,
    label: meta.label,
    emoji: meta.emoji,
    sentence: `${signal.from_name || 'شریکت'} ${meta.verb}`,
  }
}
