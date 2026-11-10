import { builtinAvatarUrl, supabase } from './supabase'

export interface BuiltinAvatar {
  file: string
  label: string
}

/**
 * 11 avatars shipped with the site under /public/avatars.
 *
 * These are illustrations generated for Kenaret (soft 3D, rounded clay look),
 * committed as 256×256 WebP — a few kilobytes each, so the whole picker is
 * lighter than a single photograph and nothing is fetched at runtime.
 *
 * The 1024×1024 PNG masters live in `design/avatars/` — kept out of `public/`
 * so they are never published. `design/avatars/prepare-avatars.sh` rebuilds the
 * WebP files above from them.
 */
export const BUILTIN_AVATARS: BuiltinAvatar[] = [
  { file: 'ava-01.webp', label: 'قلب صورتی' },
  { file: 'ava-02.webp', label: 'ماه و ستاره' },
  { file: 'ava-03.webp', label: 'گربه ملوس' },
  { file: 'ava-04.webp', label: 'خرس کوچک' },
  { file: 'ava-05.webp', label: 'گل رز' },
  { file: 'ava-06.webp', label: 'پروانه' },
  { file: 'ava-07.webp', label: 'ابر بارانی' },
  { file: 'ava-08.webp', label: 'خورشید خانم' },
  { file: 'ava-09.webp', label: 'کبوتر نامه‌بر' },
  { file: 'ava-10.webp', label: 'فنجان قهوه' },
  { file: 'ava-11.webp', label: 'ساحل و صدف' },
]

export const AVATAR_PREFIX = {
  builtin: 'builtin:',
  storage: 'storage:',
} as const

export function builtinAvatar(file: string): string {
  return `${AVATAR_PREFIX.builtin}${file}`
}

export function storageAvatar(path: string): string {
  return `${AVATAR_PREFIX.storage}${path}`
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 12 // 12h — the bucket is private

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>()

/**
 * Resolves whatever is stored in `profiles.avatar_url` into a usable <img src>.
 * Storage objects live in a private bucket, so we hand out short-lived signed URLs.
 */
export async function resolveAvatarSrc(avatarUrl: string | null | undefined): Promise<string | null> {
  if (!avatarUrl) return null

  if (avatarUrl.startsWith(AVATAR_PREFIX.builtin)) {
    return builtinAvatarUrl(avatarUrl.slice(AVATAR_PREFIX.builtin.length))
  }

  if (avatarUrl.startsWith(AVATAR_PREFIX.storage)) {
    const path = avatarUrl.slice(AVATAR_PREFIX.storage.length)
    const cached = signedUrlCache.get(path)
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.url

    const { data, error } = await supabase.storage.from('avatars').createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error || !data?.signedUrl) return null
    signedUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    })
    return data.signedUrl
  }

  // Legacy / absolute URLs (e.g. an old Gravatar link) pass through untouched.
  if (avatarUrl.startsWith('http')) return avatarUrl

  return null
}

export const AVATAR_MAX_BYTES = 3 * 1024 * 1024 // 3 MB, matches the bucket limit
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export function validateAvatarFile(file: File): string | null {
  if (!AVATAR_ALLOWED_TYPES.includes(file.type as (typeof AVATAR_ALLOWED_TYPES)[number])) {
    return 'فقط عکس با فرمت JPG، PNG، WEBP یا GIF مجاز است.'
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'حجم عکس نباید بیشتر از ۳ مگابایت باشد.'
  }
  return null
}

/**
 * Uploads to `avatars/<user-id>/<name>` and returns the stored
 * `storage:<path>` reference for `profiles.avatar_url`.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const safeExtension = /^(jpe?g|png|webp|gif)$/.test(extension) ? extension : 'jpg'
  const filename = `avatar-${Date.now()}.${safeExtension}`
  const path = `${userId}/${filename}`

  const { error } = await supabase.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: true,
  })
  if (error) throw error

  return storageAvatar(path)
}
