import { builtinAvatarUrl, supabase } from './supabase'

export interface BuiltinAvatar {
  file: string
  label: string
}

/**
 * 16 avatars shipped with the site under /public/avatars.
 * They are decorative illustrations (no external assets, nothing to fetch at runtime).
 */
export const BUILTIN_AVATARS: BuiltinAvatar[] = [
  { file: 'ava-01.svg', label: 'قلب صورتی' },
  { file: 'ava-02.svg', label: 'ماه و ستاره' },
  { file: 'ava-03.svg', label: 'گربه ملوس' },
  { file: 'ava-04.svg', label: 'خرس کوچک' },
  { file: 'ava-05.svg', label: 'گل رز' },
  { file: 'ava-06.svg', label: 'پروانه' },
  { file: 'ava-07.svg', label: 'ابر بارانی' },
  { file: 'ava-08.svg', label: 'خورشید خانم' },
  { file: 'ava-09.svg', label: 'کبوتر نامه‌بر' },
  { file: 'ava-10.svg', label: 'فنجان قهوه' },
  { file: 'ava-11.svg', label: 'ساحل و صدف' },
  { file: 'ava-12.svg', label: 'شب پرستاره' },
  { file: 'ava-13.svg', label: 'آدم‌برفی' },
  { file: 'ava-14.svg', label: 'برگ پاییزی' },
  { file: 'ava-15.svg', label: 'کیک تولد' },
  { file: 'ava-16.svg', label: 'قایق کاغذی' },
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
