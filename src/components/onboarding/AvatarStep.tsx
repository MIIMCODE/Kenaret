import { useRef, useState } from 'react'
import {
  BUILTIN_AVATARS,
  AVATAR_PREFIX,
  builtinAvatar,
  validateAvatarFile,
} from '../../lib/avatars'
import { builtinAvatarUrl } from '../../lib/supabase'
import Alert from '../Alert'
import Spinner from '../Spinner'

interface Props {
  /** Current value: `builtin:<file>` | `storage:<path>` | null */
  value: string | null
  /** Uploads the file and returns the stored `storage:<path>` reference. */
  onUpload: (file: File) => Promise<string>
  onChange: (next: string | null) => void
  /** Shown under the picker as a live preview name. */
  displayName?: string | null
}

export default function AvatarStep({ value, onUpload, onChange, displayName }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  const isUploaded = value?.startsWith(AVATAR_PREFIX.storage)
  const selectedBuiltin = value?.startsWith(AVATAR_PREFIX.builtin)
    ? value.slice(AVATAR_PREFIX.builtin.length)
    : null

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = validateAvatarFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setUploading(true)
    const objectUrl = URL.createObjectURL(file)
    setLocalPreview(objectUrl)

    try {
      const reference = await onUpload(file)
      onChange(reference)
    } catch (uploadError) {
      console.error(uploadError)
      setError('آپلود عکس انجام نشد. اتصال اینترنت یا حجم فایل را بررسی کن.')
      setLocalPreview(null)
    } finally {
      setUploading(false)
    }
  }

  const previewSrc = localPreview ?? (selectedBuiltin ? builtinAvatarUrl(selectedBuiltin) : null)

  return (
    <div className="space-y-5">
      {/* Preview + upload */}
      <div className="flex items-center gap-4">
        <div className="relative h-[76px] w-[76px] shrink-0">
          <div className="h-full w-full overflow-hidden rounded-full bg-blush-100 ring-4 ring-white shadow-soft">
            {previewSrc ? (
              <img src={previewSrc} alt="پیش‌نمایش عکس پروفایل" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl text-blush-400">
                {(displayName?.trim()?.[0] ?? '؟').toUpperCase()}
              </div>
            )}
          </div>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
              <Spinner className="h-5 w-5 text-blush-500" />
            </div>
          )}
        </div>

        <div className="flex-1">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className="btn-ghost w-full !py-2.5 text-[13px]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 16V4m0 0L8 8m4-4l4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {isUploaded ? 'عوض کردن عکس' : 'انتخاب از گالری'}
          </button>
          <p className="hint mt-1.5 text-center">JPG، PNG یا WEBP — حداکثر ۳ مگابایت</p>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="relative flex items-center gap-3">
        <div className="h-px flex-1 bg-blush-100" />
        <span className="text-[11.5px] font-semibold text-ink-500">یا یکی از این‌ها را انتخاب کن</span>
        <div className="h-px flex-1 bg-blush-100" />
      </div>

      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-4">
        {BUILTIN_AVATARS.map((avatar) => {
          const active = selectedBuiltin === avatar.file
          return (
            <button
              key={avatar.file}
              type="button"
              onClick={() => {
                setError(null)
                setLocalPreview(null)
                onChange(builtinAvatar(avatar.file))
              }}
              aria-pressed={active}
              aria-label={avatar.label}
              title={avatar.label}
              className={`aspect-square overflow-hidden rounded-2xl border-2 transition-all duration-200 ${
                active
                  ? 'border-blush-500 shadow-soft scale-[1.03]'
                  : 'border-transparent hover:border-blush-200'
              }`}
            >
              <img
                src={builtinAvatarUrl(avatar.file)}
                alt={avatar.label}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
          )
        })}
      </div>

      <p className="hint">
        اگر هیچ‌کدام را نپسندی، بعداً از تنظیمات می‌توانی عوضش کنی. بدون عکس هم می‌شود ادامه داد.
      </p>
    </div>
  )
}
