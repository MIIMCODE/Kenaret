import { addDaysIso, isoToJalali, toPersianDigits, todayIso } from './jalali'
import { anniversaryLabel, daysUntilLabel } from './anniversary'

/**
 * One upcoming reminder, already resolved into what the bell shows.
 *
 * Built from the same `reminder_queue()` the 08:00 email job reads, so the
 * bell and the mail can never disagree about what is coming up.
 */
export interface InAppReminder {
  /** Stable React key — `kind:event_iso`. */
  key: string
  kind: ReminderKind
  /** Gregorian ISO of the day the thing happens. */
  iso: string
  /** «سالگرد آشنایی», «تولدت», … */
  title: string
  /** «فردا» / «۳ روز دیگر» */
  when: string
  /** «۲۰ آبان ۱۴۰۵» */
  dateLabel: string
  daysUntil: number
  /** Emoji used when there is no specific artwork. */
  emoji: string
}

export type ReminderKind =
  | 'yearly'
  | 'monthly'
  | 'milestone'
  | 'birthday'
  | 'period'
  | 'period_partner'
  | 'reunion'

/** Row shape returned by the `reminder_queue` RPC (dates arrive as ISO). */
export interface ReminderQueueRow {
  kind: string
  event_iso: string
  title: string
}

const META: Record<ReminderKind, { emoji: string; fallbackTitle: string }> = {
  yearly: { emoji: '💍', fallbackTitle: 'سالگرد آشنایی' },
  monthly: { emoji: '🌙', fallbackTitle: 'ماهگرد' },
  milestone: { emoji: '🎉', fallbackTitle: 'روز شمردنی' },
  birthday: { emoji: '🎂', fallbackTitle: 'تولد' },
  period: { emoji: '🌸', fallbackTitle: 'شروع پریود' },
  period_partner: { emoji: '💗', fallbackTitle: 'حال شریکت' },
  reunion: { emoji: '🤍', fallbackTitle: 'دیدار بعدی' },
}

function isKind(value: string): value is ReminderKind {
  return Object.prototype.hasOwnProperty.call(META, value)
}

/**
 * Turns raw queue rows into bell items, sorted by date and de-duplicated.
 *
 * Rows for a day that has already passed are dropped: the queue is read for
 * "tomorrow" by the mail job, so a stale row must never show as «امروز».
 */
export function toReminders(rows: ReminderQueueRow[], today: string = todayIso()): InAppReminder[] {
  const seen = new Set<string>()
  const items: InAppReminder[] = []

  for (const row of rows) {
    if (!row?.event_iso) continue
    const iso = String(row.event_iso).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue
    if (iso < today) continue

    const kind: ReminderKind = isKind(row.kind) ? row.kind : 'milestone'
    const key = `${kind}:${iso}`
    if (seen.has(key)) continue
    seen.add(key)

    const title = (row.title ?? '').trim() || META[kind].fallbackTitle

    items.push({
      key,
      kind,
      iso,
      title,
      when: daysUntilLabel(daysBetween(today, iso)),
      dateLabel: anniversaryLabel(iso),
      daysUntil: daysBetween(today, iso),
      emoji: META[kind].emoji,
    })
  }

  return items.sort((a, b) => (a.iso === b.iso ? a.kind.localeCompare(b.kind) : a.iso < b.iso ? -1 : 1))
}

/** Whole days from `from` to `to` (both Gregorian ISO, `to` may be later). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

/**
 * The window the bell reads.
 *
 * Three days is deliberate: the nightly job mails for *tomorrow*, but a bell
 * that only ever showed tomorrow would be empty six days out of seven. A
 * short runway keeps it useful without turning it into a second calendar.
 */
export const BELL_WINDOW_DAYS = 3

export function bellRange(today: string = todayIso()): { from: string; to: string } {
  return { from: today, to: addDaysIso(today, BELL_WINDOW_DAYS) }
}

/** Persian label for the badge: 0 when there is nothing to show. */
export function badgeCount(items: InAppReminder[]): number {
  return items.length
}

/** «روزهای مهم» style summary used inside the sheet. */
export function bellSummary(items: InAppReminder[]): string {
  if (items.length === 0) return 'در این چند روز چیزی پیشِ رو نیست.'
  const today = items.filter((item) => item.daysUntil === 0).length
  if (today === items.length) return 'همه‌شان امروزند.'
  if (today > 0) return `${toPersianDigits(today)} مورد امروز، بقیه در چند روز آینده.`
  return 'چند روز مهم نزدیک است.'
}

/** Human date for a Jalali-aware header line, e.g. «۲۰ آبان». */
export function shortJalali(iso: string): string {
  const j = isoToJalali(iso)
  if (!j) return '—'
  return toPersianDigits(`${j.jd} ${monthName(j.jm)}`)
}

const MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
]

function monthName(jm: number): string {
  return MONTHS[jm - 1] ?? ''
}
