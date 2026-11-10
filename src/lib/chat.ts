import { supabase } from './supabase'
import { formatJalaliLong, toPersianDigits, todayIso, weekdayName } from './jalali'
import type { ChatMessage } from '../types/database'

/**
 * Client-side helpers for گفت‌وگو.
 *
 * Everything that decides *what may be sent* lives in the database — these
 * functions only shape the bytes and the copy. Nothing here is a security
 * boundary, and nothing here should be mistaken for one.
 */

// ------------------------------------------------------------------
// Time
// ------------------------------------------------------------------

/** `۱۴:۳۲` — the clock time of a single message. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return toPersianDigits(`${hh}:${mm}`)
}

/** Local calendar day of an ISO timestamp, as `YYYY-MM-DD`. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * The separator to draw above a message, or null if it belongs to the same
 * day as the one before it.
 *
 * Chat without day separators is a wall of bubbles with no sense of time
 * passing — which is exactly what this app is about.
 */
export function dayLabel(iso: string): string | null {
  const day = localDay(iso)
  if (day === todayIso()) return 'امروز'

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(
    yesterday.getDate(),
  ).padStart(2, '0')}`
  if (day === y) return 'دیروز'

  // Within a week, the weekday is how people actually say it («سه‌شنبه»).
  if (Date.now() - new Date(iso).getTime() < 6 * 24 * 60 * 60 * 1000) {
    return weekdayName(day)
  }

  // Older than that: the Jalali date, e.g. «۱۲ آبان».
  return formatJalaliLong(day).split(' ').slice(0, 2).join(' ')
}

// ------------------------------------------------------------------
// Images
// ------------------------------------------------------------------

export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export function validateChatImage(file: File): string | null {
  if (!CHAT_IMAGE_TYPES.includes(file.type as (typeof CHAT_IMAGE_TYPES)[number])) {
    return 'فقط عکس با فرمت JPG، PNG یا WEBP مجاز است.'
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    return 'حجم عکس نباید بیشتر از ۱۰ مگابایت باشد.'
  }
  return null
}

/**
 * Uploads into `chat-media/<couple-id>/<random>.<ext>` and returns the object
 * path, which is what `send_image()` stores.
 *
 * The couple id is the first path segment on purpose: the storage policy is a
 * prefix check against `current_couple_id()`, so an object placed anywhere else
 * is unreadable by anyone. `send_image()` re-checks the same prefix, so a
 * tampered client cannot attach someone else's file either.
 */
export async function uploadChatImage(coupleId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safe = /^(jpe?g|png|webp)$/.test(extension)
    ? extension.replace('jpeg', 'jpg')
    : file.type === 'image/png'
      ? 'png'
      : file.type === 'image/webp'
        ? 'webp'
        : 'jpg'

  const name = `${crypto.randomUUID()}.${safe}`
  const path = `${coupleId}/${name}`

  const { error } = await supabase.storage.from('chat-media').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (error) throw error

  return path
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()
const SIGNED_TTL = 60 * 60 * 6

/** A short-lived URL for a private chat image. Cached so scrolling is not a storm of requests. */
export async function resolveChatImage(path: string): Promise<string | null> {
  const cached = signedUrlCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url

  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, SIGNED_TTL)
  if (error || !data?.signedUrl) return null

  signedUrlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000,
  })
  return data.signedUrl
}

/** Reads an image's intrinsic size so the bubble can reserve space before it loads. */
export function readImageSize(file: File): Promise<{ width: number; height: number } | null> {
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


// ------------------------------------------------------------------
// Voice notes
// ------------------------------------------------------------------

export const CHAT_AUDIO_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/mpeg',
  'audio/m4a',
] as const

/** Uploads a recording into the same couple-prefixed bucket as photos. */
export async function uploadChatVoice(
  coupleId: string,
  blob: Blob,
  extension: string,
): Promise<string> {
  const path = `${coupleId}/voice-${crypto.randomUUID()}.${extension}`

  const { error } = await supabase.storage.from('chat-media').upload(path, blob, {
    cacheControl: '31536000',
    contentType: blob.type || 'audio/webm',
    upsert: false,
  })
  if (error) throw error

  return path
}

/** A short-lived URL for a private voice note. */
export async function resolveChatAudio(path: string): Promise<string | null> {
  return resolveChatImage(path) // identical mechanism, same private bucket
}

/**
 * Trims a long message for the quoted line inside a reply.
 *
 * Quoting the whole thing defeats the point: the reply already sits under the
 * original, so the quote is a reminder of *which* message, not a copy of it.
 */
export function quoteLine(message: { body: string; kind: string; reply_kind?: string | null }): string {
  if (message.kind === 'image') return '📷 عکس'
  if (message.kind === 'voice') return '🎙 پیام صوتی'
  const body = message.body.trim().replace(/\s+/g, ' ')
  return body.length > 60 ? `${body.slice(0, 60)}…` : body
}


/**
 * An optimistic message, in exactly the shape the server returns.
 *
 * Built here rather than inline so that adding a column to `ChatMessage` is a
 * single compile error instead of a silently-undefined field on every bubble.
 */
export function draftMessage(input: {
  id: string
  senderId: string
  body?: string
  kind?: ChatMessage['kind']
  mediaPath?: string | null
  mediaW?: number | null
  mediaH?: number | null
  duration?: string | null
  replyTo?: string | null
  replyBody?: string | null
  replyKind?: string | null
  createdAt?: string
}): ChatMessage {
  return {
    id: input.id,
    sender_id: input.senderId,
    body: input.body ?? '',
    kind: input.kind ?? 'text',
    media_path: input.mediaPath ?? null,
    media_w: input.mediaW ?? null,
    media_h: input.mediaH ?? null,
    duration: input.duration ?? null,
    reply_to: input.replyTo ?? null,
    reply_body: input.replyBody ?? null,
    reply_kind: input.replyKind ?? null,
    forward: false,
    pinned: false,
    edited_at: null,
    deleted_at: null,
    created_at: input.createdAt ?? new Date().toISOString(),
    seen: false,
  }
}
