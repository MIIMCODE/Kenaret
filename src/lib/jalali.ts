import jalaali from 'jalaali-js'

/**
 * Jalali (Shamsi) <-> Gregorian helpers.
 *
 * The database ALWAYS stores Gregorian ISO dates (`YYYY-MM-DD`); everything the
 * user sees is Jalali. Keep that boundary exactly here.
 */

export const JALALI_MONTHS = [
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
] as const

/** Persian names for the Gregorian months, used only for subtle hints. */
const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'] as const

export const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)])
}

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

export interface JalaliParts {
  jy: number
  jm: number
  jd: number
}

/** `YYYY-MM-DD` (Gregorian) -> Jalali parts. Returns null for bad input. */
export function isoToJalali(iso: string | null | undefined): JalaliParts | null {
  if (!iso) return null
  const [gy, gm, gd] = iso.slice(0, 10).split('-').map(Number)
  if (!gy || !gm || !gd) return null
  try {
    const { jy, jm, jd } = jalaali.toJalaali(gy, gm, gd)
    return { jy, jm, jd }
  } catch {
    return null
  }
}

/** Jalali parts -> `YYYY-MM-DD` (Gregorian). Returns null for an invalid date. */
export function jalaliToIso(jy: number, jm: number, jd: number): string | null {
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null
  const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd)
  return `${String(gy).padStart(4, '0')}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`
}

/** Local (not UTC) `YYYY-MM-DD` for "today". */
export function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const [y1, m1, d1] = fromIso.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = toIso.slice(0, 10).split('-').map(Number)
  const a = Date.UTC(y1, m1 - 1, d1)
  const b = Date.UTC(y2, m2 - 1, d2)
  return Math.round((b - a) / 86_400_000)
}

/** e.g. `۱۲ اسفند ۱۳۷۶` */
export function formatJalaliLong(iso: string | null | undefined): string {
  const parts = isoToJalali(iso)
  if (!parts) return '—'
  return toPersianDigits(`${parts.jd} ${JALALI_MONTHS[parts.jm - 1]} ${parts.jy}`)
}

/** Weekday index in the Persian week (0 = شنبه). */
export function persianWeekday(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const jsDay = new Date(y, m - 1, d).getDay() // 0 = Sunday
  return (jsDay + 1) % 7 // Saturday -> 0
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[persianWeekday(iso)]
}

export function jalaliMonthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm)
}

export function todayJalali(): JalaliParts {
  return isoToJalali(todayIso())!
}

/** Full Gregorian date object from Jalali parts, in local time. */
export function jalaliToLocalDate(jy: number, jm: number, jd: number): Date {
  return jalaali.jalaaliToDateObject(jy, jm, jd)
}
