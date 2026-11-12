import { useEffect, useRef, useState } from 'react'
import Alert from './Alert'
import {
  fetchCelebrationState,
  removeCelebrationMusic,
  resolveCelebrationMusic,
  uploadCelebrationMusic,
  type CelebrationMusic,
} from '../lib/celebrate'
import { toPersianError } from '../lib/errors'
import { toPersianDigits } from '../lib/jalali'

/**
 * آهنگ جشن — the one track A plays on the celebration screen.
 *
 * One song per couple, not a library. A library needs a picker, a search, a
 * "which one did we use last time" — and the answer to all three is the same
 * song anyway. Replacing it is the whole interface.
 */
export default function CelebrationMusicSettings() {
  const [music, setMusic] = useState<CelebrationMusic | null>(null)
  const [coupleId, setCoupleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const state = await fetchCelebrationState().catch(() => null)
        if (cancelled) return

        setMusic(state?.music ?? null)
        setCoupleId(state?.couple_id ?? null)

        if (state?.music) {
          const url = await resolveCelebrationMusic(state.music.storage_path)
          if (!cancelled) setPreviewUrl(url)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function upload(file: File) {
    if (!coupleId) {
      setError('برای بارگذاری آهنگ باید به هم وصل باشید.')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const next = await uploadCelebrationMusic(coupleId, file)
      setMusic(next)
      const url = await resolveCelebrationMusic(next.storage_path)
      setPreviewUrl(url)
      setNotice('آهنگ جشن ذخیره شد.')
    } catch (uploadError) {
      setError(toPersianError(uploadError, 'بارگذاری آهنگ انجام نشد.'))
    } finally {
      setBusy(false)
      // Let the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await removeCelebrationMusic()
      setMusic(null)
      setPreviewUrl(null)
      setNotice('آهنگ حذف شد.')
    } catch (removeError) {
      setError(toPersianError(removeError, 'آهنگ حذف نشد.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="text-[14px] font-extrabold text-ink-900">آهنگ جشن</h2>
        <p className="mt-1 text-[11.5px] leading-6 text-ink-700">
          یک آهنگ برای شب‌های خاصتان. در صفحه‌ی جشن خودش پخش می‌شود.
        </p>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <p className="text-[12px] text-ink-700">دارم می‌گردم…</p>
      ) : music ? (
        <div className="well space-y-3 rounded-2xl p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-bold text-ink-900">♪ {music.display_name}</p>
              <p className="mt-0.5 text-[10.5px] text-ink-700">{formatSize(music.size_bytes)}</p>
            </div>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="tile shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-bold text-blush-800 transition hover:brightness-[1.03] disabled:opacity-50"
            >
              حذف
            </button>
          </div>

          {previewUrl && (
            <audio controls src={previewUrl} preload="none" className="w-full" dir="ltr">
              مرورگرت پخش صدا را پشتیبانی نمی‌کند.
            </audio>
          )}
        </div>
      ) : (
        <p className="text-[11.5px] leading-6 text-ink-700">
          هنوز آهنگی انتخاب نکرده‌اید. یک فایل صوتی تا ۱۵ مگابایت.
        </p>
      )}

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav,audio/webm,audio/x-m4a"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
          }}
        />
        <button
          type="button"
          disabled={busy || !coupleId}
          onClick={() => inputRef.current?.click()}
          className="btn-ghost w-full disabled:opacity-50"
        >
          {busy ? 'دارم بارگذاری می‌کنم…' : music ? 'انتخاب آهنگ دیگر' : 'انتخاب آهنگ'}
        </button>
      </div>
    </section>
  )
}

/** Persian byte size — megabytes with one decimal, because 14.7 reads better than ۱۵۴۰۹۰۰۰. */
function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${toPersianDigits(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`
  }
  const mb = (bytes / (1024 * 1024)).toFixed(1).replace('.', '٫')
  return `${toPersianDigits(mb)} مگابایت`
}
