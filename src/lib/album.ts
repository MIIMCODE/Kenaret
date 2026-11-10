import { supabase } from './supabase'
import { isoToJalali, JALALI_MONTHS, toPersianDigits, todayIso } from './jalali'
import type { AlbumPhoto } from '../types/database'

/**
 * آلبوم ما — helpers.
 *
 * The unit of the album is the **day**, not the photo. Two people each add one
 * photograph; the day is the spread that holds both halves. Everything here
 * exists to turn a flat list of rows into those days.
 */

export interface AlbumDay {
  /** Gregorian ISO. */
  day: string
  /** Jalali parts for the header. */
  jy: number
  jm: number
  jd: number
  /** Whose is whose, resolved by the caller. */
  mine: AlbumPhoto | null
  theirs: AlbumPhoto | null
  /** True when both halves exist — a complete spread. */
  both: boolean
}

/**
 * Groups photos into days, newest first.
 *
 * `myId` is needed because "mine" is a fact about the signed-in user, not about
 * the row. Passing it in keeps this function pure and testable.
 */
export function groupByDay(photos: AlbumPhoto[], myId: string | undefined): AlbumDay[] {
  const byDay = new Map<string, { mine: AlbumPhoto | null; theirs: AlbumPhoto | null }>()

  for (const photo of photos) {
    const key = photo.day.slice(0, 10)
    const slot = byDay.get(key) ?? { mine: null, theirs: null }
    if (photo.user_id === myId) slot.mine = photo
    else slot.theirs = photo
    byDay.set(key, slot)
  }

  const days: AlbumDay[] = []
  for (const [day, slot] of byDay) {
    const parts = isoToJalali(day)
    if (!parts) continue
    days.push({
      day,
      jy: parts.jy,
      jm: parts.jm,
      jd: parts.jd,
      mine: slot.mine,
      theirs: slot.theirs,
      both: Boolean(slot.mine && slot.theirs),
    })
  }

  // Newest first: an album is read backwards from now.
  days.sort((a, b) => (a.day < b.day ? 1 : -1))
  return days
}

/** `شنبه ۱۹ آبان` — the heading over a single day. */
export function dayHeading(day: string): string {
  const parts = isoToJalali(day)
  if (!parts) return day
  return `${weekday(day)} ${toPersianDigits(parts.jd)} ${JALALI_MONTHS[parts.jm - 1]}`
}

/** `۱۹ آبان ۱۴۰۵` */
export function dayFull(day: string): string {
  const parts = isoToJalali(day)
  if (!parts) return day
  return toPersianDigits(`${parts.jd} ${JALALI_MONTHS[parts.jm - 1]} ${parts.jy}`)
}

/** Relative label used above a finished spread. */
export function relativeDay(day: string, today: string = todayIso()): string | null {
  if (day === today) return 'امروز'

  const d = new Date(day + 'T00:00:00')
  const t = new Date(today + 'T00:00:00')
  const diff = Math.round((t.getTime() - d.getTime()) / 86_400_000)

  if (diff === 1) return 'دیروز'
  return null
}

const PERSIAN_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

function weekday(day: string): string {
  return PERSIAN_WEEKDAYS[new Date(day + 'T00:00:00').getDay()]
}

// ------------------------------------------------------------------
// Storage
// ------------------------------------------------------------------

export const ALBUM_MAX_BYTES = 12 * 1024 * 1024
export const ALBUM_ALLOWED = ['image/jpeg', 'image/png', 'image/webp'] as const

export function validateAlbumFile(file: File): string | null {
  if (!ALBUM_ALLOWED.includes(file.type as (typeof ALBUM_ALLOWED)[number])) {
    return 'فقط عکس با فرمت JPG، PNG یا WEBP مجاز است.'
  }
  if (file.size > ALBUM_MAX_BYTES) {
    return 'حجم عکس نباید بیشتر از ۱۲ مگابایت باشد.'
  }
  return null
}

/**
 * Uploads into `album/<couple>/<day>/<user>-<uuid>.<ext>`.
 *
 * The day is in the path for two reasons: the storage policy's prefix check
 * still works, and a future cleanup job can find a month's objects without
 * joining the table. The file name carries the uploader so a path is
 * self-describing if it ever ends up in a log.
 */
export async function uploadAlbumPhoto(
  coupleId: string,
  userId: string,
  day: string,
  file: File,
): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safe = /^(jpe?g|png|webp)$/.test(extension)
    ? extension.replace('jpeg', 'jpg')
    : file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg'

  const path = `${coupleId}/${day}/${userId}-${crypto.randomUUID()}.${safe}`

  const { error } = await supabase.storage.from('album').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error

  return path
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()
const SIGNED_TTL = 60 * 60 * 6

/** Short-lived URL for a private album photo, cached so scrolling is calm. */
export async function resolveAlbumPhoto(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url

  const { data, error } = await supabase.storage.from('album').createSignedUrl(path, SIGNED_TTL)
  if (error || !data?.signedUrl) return null

  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000,
  })
  return data.signedUrl
}

/**
 * Downsizes a photo before upload.
 *
 * A phone camera writes 4–8 MB; on a metered Iranian mobile connection that is
 * a long wait for a photo nobody will zoom into. 1600px on the long edge is
 * still sharper than the screen it is viewed on. Falls back to the original
 * file if anything about canvas processing fails — a slightly large photo is
 * much better than a lost one.
 */
export async function prepareAlbumFile(
  file: File,
): Promise<{ file: File; width: number; height: number }> {
  const size = await readImageSize(file)
  if (!size) return { file, width: 0, height: 0 }

  const MAX_EDGE = 1600
  const largest = Math.max(size.width, size.height)
  if (largest <= MAX_EDGE) return { file, width: size.width, height: size.height }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = MAX_EDGE / largest
    const width = Math.round(size.width * scale)
    const height = Math.round(size.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return { file, width: size.width, height: size.height }
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.86),
    )
    if (!blob) return { file, width: size.width, height: size.height }

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return { file: new File([blob], name, { type: 'image/jpeg' }), width, height }
  } catch {
    // Older Safari has no createImageBitmap; the original still works.
    return { file, width: size.width, height: size.height }
  }
}

function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
