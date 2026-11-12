import { supabase } from './supabase'

/**
 * جشن — the celebration day.
 *
 * The *date logic lives in the database*, deliberately. Two browsers, two
 * timezones, one shared truth about whether tonight is the monthiversary —
 * letting the client decide would mean her phone could say yes while his said
 * no. So this file is thin on purpose: it asks, it renders, it writes only
 * through RPCs.
 */

export type CelebrationKind = 'monthiversary' | 'anniversary' | 'milestone'

export interface CelebrationCandidate {
  kind: CelebrationKind
  ordinal: number
  title: string
  subtitle: string
  /** True once either partner has opened tonight's celebration. */
  opened: boolean
  celebration_id: string | null
}

export interface CelebrationMusic {
  storage_path: string
  display_name: string
  mime_type: string | null
  size_bytes: number
}

export interface CelebrationState {
  ok: boolean
  reason?: string
  /** Needed by Settings to build the storage path; PairingState has no couple. */
  couple_id?: string
  today?: string
  anniversary_date?: string | null
  today_candidate?: CelebrationCandidate | null
  music?: CelebrationMusic | null
}

export interface CelebrationNote {
  id: string
  author_id: string
  body: string
  created_at: string
}

export interface Celebration {
  id: string
  kind: CelebrationKind
  ordinal: number
  day: string
  title: string
  subtitle: string
  opened_at: string
  notes: CelebrationNote[]
}

/** Persian error copy. Keys mirror the codes raised by the SQL. */
const MESSAGES: Record<string, string> = {
  NO_ACTIVE_COUPLE: 'برای جشن، اول باید به هم وصل باشید.',
  NOT_TODAY: 'امشب شب جشن نیست.',
  ALREADY_WRITTEN: 'پیامت را قبلاً نوشته‌ای؛ هر کس یک پیام.',
  EMPTY_NOTE: 'پیام خالی است.',
  NOTE_TOO_LONG: 'پیام بیش از اندازه بلند است.',
  NOT_YOUR_CELEBRATION: 'این جشن مال شما نیست.',
  BAD_PATH: 'مسیر فایل درست نیست.',
  BAD_NAME: 'نام فایل درست نیست.',
  BAD_SIZE: 'حجم فایل درست نیست.',
  MUSIC_TOO_BIG: 'این آهنگ از ۱۵ مگابایت بزرگ‌تر است.',
  MUSIC_WRONG_TYPE: 'فقط فایل صوتی می‌توانی بارگذاری کنی.',
}

/** Pulls the raised code out of a PostgREST error and hands back Persian copy. */
function describe(error: unknown): string {
  const raw = error as { message?: string; code?: string } | null
  const text = `${raw?.message ?? ''} ${raw?.code ?? ''}`

  for (const [code, copy] of Object.entries(MESSAGES)) {
    if (text.includes(code)) return copy
  }
  return 'یک لحظه مشکل پیش آمد. دوباره تلاش کن.'
}

export async function fetchCelebrationState(): Promise<CelebrationState> {
  const { data, error } = await supabase.rpc('celebration_state')
  if (error) throw new Error(describe(error))
  return (data ?? { ok: false }) as CelebrationState
}

/**
 * Registers tonight's celebration (or re-opens it) and returns its notes.
 *
 * Called both by the automatic path and by the manual button; the SQL is
 * idempotent, so opening twice is harmless and never loses a written note.
 */
export async function openCelebration(kind: CelebrationKind, ordinal: number): Promise<Celebration> {
  const { data, error } = await supabase.rpc('open_celebration', {
    p_kind: kind,
    p_ordinal: ordinal,
  })
  if (error) throw new Error(describe(error))
  return data as Celebration
}

export async function writeCelebrationNote(celebrationId: string, body: string): Promise<CelebrationNote> {
  const { data, error } = await supabase.rpc('write_celebration_note', {
    p_celebration_id: celebrationId,
    p_body: body,
  })
  if (error) throw new Error(describe(error))
  return data as CelebrationNote
}

/* ── music ───────────────────────────────────────────────────────────────── */

/** Must stay in step with the bucket's `file_size_limit` in the migration. */
export const MUSIC_MAX_BYTES = 15 * 1024 * 1024

const MUSIC_TYPES = [
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-m4a',
]

export function musicFileError(file: File): string | null {
  if (file.size > MUSIC_MAX_BYTES) return 'MUSIC_TOO_BIG'
  if (!MUSIC_TYPES.includes(file.type)) return 'MUSIC_WRONG_TYPE'
  return null
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
}

/**
 * Uploads the couple's one track and points the row at it.
 *
 * The old object is removed *after* the row has moved on, so a failed upload
 * never leaves the pair with no music at all.
 */
export async function uploadCelebrationMusic(coupleId: string, file: File): Promise<CelebrationMusic> {
  const problem = musicFileError(file)
  if (problem) throw new Error(MESSAGES[problem] ?? 'فایل مناسب نیست.')

  const extension = EXTENSION_BY_TYPE[file.type] ?? 'mp3'
  const path = `${coupleId}/${crypto.randomUUID()}.${extension}`

  const { error: uploadError } = await supabase.storage.from('music').upload(path, file, {
    cacheControl: '31536000',
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) throw new Error(describe(uploadError))

  const displayName = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'آهنگ ما'

  const { data, error } = await supabase.rpc('set_celebration_music', {
    p_storage_path: path,
    p_display_name: displayName,
    p_size_bytes: file.size,
    p_mime_type: file.type,
  })

  if (error) {
    // The row never took the path — don't leave the object orphaned in the bucket.
    await supabase.storage.from('music').remove([path])
    throw new Error(describe(error))
  }

  const replaced = (data as { replaced_path?: string | null } | null)?.replaced_path
  if (replaced) {
    // Best effort: an orphaned object is a smaller problem than a broken upload.
    void supabase.storage.from('music').remove([replaced])
  }
  signedMusicCache.delete(path)

  return {
    storage_path: path,
    display_name: displayName,
    mime_type: file.type,
    size_bytes: file.size,
  }
}

export async function removeCelebrationMusic(): Promise<void> {
  const { data, error } = await supabase.rpc('remove_celebration_music')
  if (error) throw new Error(describe(error))

  const removed = (data as { removed_path?: string | null } | null)?.removed_path
  if (removed) {
    signedMusicCache.delete(removed)
    void supabase.storage.from('music').remove([removed])
  }
}

const signedMusicCache = new Map<string, { url: string; expiresAt: number }>()
const MUSIC_SIGNED_TTL = 60 * 60 * 6

/** Signed URL for the private track. The audio element can only take a URL. */
export async function resolveCelebrationMusic(path: string): Promise<string | null> {
  const cached = signedMusicCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url

  const { data, error } = await supabase.storage.from('music').createSignedUrl(path, MUSIC_SIGNED_TTL)
  if (error || !data?.signedUrl) return null

  signedMusicCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + (MUSIC_SIGNED_TTL - 60) * 1000,
  })
  return data.signedUrl
}

/* ── presentation ────────────────────────────────────────────────────────── */

/**
 * The line written under the headline.
 *
 * Personalised by *kind* rather than by name, because the message is about the
 * two of them as a pair — dropping one name in would make it a message to one
 * person, which is exactly what a shared celebration is not.
 */
export function celebrationMessage(kind: CelebrationKind, ordinal: number): string {
  if (kind === 'anniversary') {
    if (ordinal === 1) return 'یک سال گذشت، و هر روزش ارزش جشن گرفتن دارد.'
    if (ordinal % 10 === 0) return `${ordinal} سال با هم؛ عددی که فقط از عشق ساخته می‌شود.`
    return `${ordinal} سال با هم، و هنوز هم اولِ راه‌ایم.`
  }
  if (kind === 'milestone') {
    if (ordinal === 365) return '۳۶۵ روز، یک دور کامل دور خورشید، کنار هم.'
    if (ordinal === 730) return 'دو سال روزشماری؛ هر روزش را جدا شمردیم.'
    return `${ordinal} روز با هم. شمردنش سخت است، زندگی‌کردنش نه.`
  }
  if (ordinal === 1) return 'یک ماه گذشت. اولین ماهِ خیلی‌های دیگر.'
  if (ordinal === 12) return '۱۲ ماه با هم؛ یک سال کامل از بودن.'
  if (ordinal % 12 === 0) return `${ordinal / 12} سال با هم، شمرده‌شده ماه به ماه.`
  return `${ordinal} ماه با هم. ماه‌ها زود می‌گذرند وقتی کنار هم‌اند.`
}

/** Short label for the dashboard chip. */
export function candidateLabel(candidate: CelebrationCandidate): string {
  if (candidate.kind === 'anniversary') return `${candidate.ordinal} سال با هم`
  if (candidate.kind === 'milestone') return `${candidate.ordinal} روز با هم`
  return `${candidate.ordinal} ماه با هم`
}

/**
 * The live counter, as four numbers.
 *
 * Measured from the anniversary date at midnight *local* time. The dashboard
 * already shows a day count; this one ticks, which is the whole point of
 * putting it on the celebration screen.
 */
export function togetherCounter(since: string, now: Date = new Date()) {
  const start = new Date(`${since}T00:00:00`)
  const elapsed = Math.max(0, now.getTime() - start.getTime())
  const totalSeconds = Math.floor(elapsed / 1000)

  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
  }
}

/** True when the celebration is happening today and has not been opened yet. */
export function shouldAutoOpen(state: CelebrationState | null, seen: Set<string>): boolean {
  const candidate = state?.today_candidate
  if (!state?.ok || !candidate) return false
  if (candidate.opened) return false
  return !seen.has(`${candidate.kind}:${candidate.ordinal}:${state.today}`)
}
