import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import {
  addAlbumPhoto,
  fetchAlbum,
  fetchAlbumStats,
  fetchAlbumToday,
  fetchCurrentCouple,
  fetchOnThisDay,
  fetchPairingState,
  reactToAlbumPhoto,
  replaceAlbumPhoto,
} from '../lib/api'
import {
  dayFull,
  dayHeading,
  groupByDay,
  prepareAlbumFile,
  relativeDay,
  resolveAlbumPhoto,
  uploadAlbumPhoto,
  validateAlbumFile,
  type AlbumDay,
} from '../lib/album'
import { toPersianError } from '../lib/errors'
import { toPersianDigits } from '../lib/jalali'
import { useAuth } from '../hooks/useAuth'
import type { AlbumPhoto, AlbumStats } from '../types/database'

/**
 * آلبوم ما.
 *
 * One photo from each of you per day, and the **day** is the unit: a spread
 * with his half and her half rather than a feed of posts. No captions, no
 * comments, one heart from the other person — if you want to say something,
 * the chat is a tap away.
 *
 * There is deliberately no streak. A streak that breaks teaches people to add
 * a photo out of obligation, and an app that makes a couple feel behind is the
 * opposite of what this is for. `stats.days` only ever goes up.
 */

const PAGE_DAYS = 45

export default function AlbumPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [photos, setPhotos] = useState<AlbumPhoto[]>([])
  const [stats, setStats] = useState<AlbumStats | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const [memory, setMemory] = useState<AlbumPhoto[]>([])
  const [partner, setPartner] = useState<{ id: string; name: string; avatar: string | null } | null>(
    null,
  )
  const [coupleId, setCoupleId] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const [viewer, setViewer] = useState<AlbumDay | null>(null)

  const fileRef = useRef<HTMLInputElement | null>(null)
  /** `add` when today is empty, `replace` when you already posted. */
  const pendingMode = useRef<'add' | 'replace'>('add')

  // ----------------------------------------------------------------
  // Load
  // ----------------------------------------------------------------
  const load = useCallback(async () => {
    try {
      const state = await fetchPairingState()
      if (!state.partner) {
        navigate('/app', { replace: true })
        return
      }
      setPartner({
        id: state.partner.id,
        name: state.partner.display_name ?? 'شریکت',
        avatar: state.partner.avatar_url,
      })

      const couple = await fetchCurrentCouple()
      setCoupleId(couple?.id ?? null)

      const todayIso = await fetchAlbumToday()
      setToday(todayIso)

      // A generous window: the album page is a place you scroll, not a
      // month view, so load ~45 days back from today.
      const to = todayIso
      const fromDate = new Date(todayIso + 'T00:00:00')
      fromDate.setDate(fromDate.getDate() - PAGE_DAYS)
      const from = fromDate.toISOString().slice(0, 10)

      const [rows, numbers, memories] = await Promise.all([
        fetchAlbum(from, to),
        fetchAlbumStats(),
        fetchOnThisDay(),
      ])

      setPhotos(rows)
      setStats(numbers)
      setMemory(memories)
      setError(null)
    } catch (err) {
      setError(toPersianError(err, 'آلبوم بارگذاری نشد.'))
    } finally {
      setLoading(false)
    }
  }, [navigate])

  useEffect(() => {
    void load()
  }, [load])

  // ----------------------------------------------------------------
  // Uploading
  // ----------------------------------------------------------------
  const pick = useCallback(
    (mode: 'add' | 'replace') => {
      pendingMode.current = mode
      setError(null)
      fileRef.current?.click()
    },
    [],
  )

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !coupleId || !user?.id || !today) return

      const problem = validateAlbumFile(file)
      if (problem) {
        setError(problem)
        return
      }

      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        // Shrink first: a 6 MB camera photo on a mobile connection is a long
        // wait for something nobody will zoom into.
        const prepared = await prepareAlbumFile(file)
        const path = await uploadAlbumPhoto(coupleId, user.id, today, prepared.file)

        if (pendingMode.current === 'replace') {
          await replaceAlbumPhoto(path, prepared.width, prepared.height)
          setNotice('عکس امروز عوض شد.')
        } else {
          await addAlbumPhoto(path, prepared.width, prepared.height)
          setNotice('عکس امروزت گذاشته شد 🤍')
        }

        await load()
      } catch (err) {
        setError(toPersianError(err))
      } finally {
        setBusy(false)
        if (fileRef.current) fileRef.current.value = ''
      }
    },
    [coupleId, load, today, user?.id],
  )

  // ----------------------------------------------------------------
  // Reacting
  // ----------------------------------------------------------------
  const react = useCallback(
    async (photo: AlbumPhoto) => {
      try {
        const reacted = await reactToAlbumPhoto(photo.id)
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === photo.id ? { ...p, reacted_at: reacted ? new Date().toISOString() : null } : p,
          ),
        )
        setViewer((prev) => {
          if (!prev) return prev
          const patch = (slot: AlbumPhoto | null) =>
            slot && slot.id === photo.id
              ? { ...slot, reacted_at: reacted ? new Date().toISOString() : null }
              : slot
          const mine = patch(prev.mine)
          const theirs = patch(prev.theirs)
          return { ...prev, mine, theirs }
        })
      } catch (err) {
        setError(toPersianError(err))
      }
    },
    [],
  )

  // ----------------------------------------------------------------
  // Derived
  // ----------------------------------------------------------------
  const days = useMemo(() => groupByDay(photos, user?.id), [photos, user?.id])

  const mineToday = stats?.mine_today ?? false
  const theirsToday = stats?.theirs_today ?? false

  if (loading) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <div className="page">
          <Spinner className="mx-auto mt-20 h-8 w-8 text-blush-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4 pb-32">
        <section>
          <p className="text-[12px] font-semibold text-ink-500">آلبوم ما</p>
          <h1 className="mt-0.5 text-[23px] font-extrabold leading-9 text-ink-900">
            یک عکس، هر روز
          </h1>
          <p className="mt-1 text-[11.5px] leading-6 text-ink-500">
            هر کدام روزی یک عکس. روز که کامل شود، کنار هم می‌نشیند.
          </p>
        </section>

        {error && (
          <div className="rounded-2xl bg-red-50 px-4 py-2.5 text-[12px] font-bold text-red-600">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-2xl bg-mint-100 px-4 py-2.5 text-[12px] font-bold text-mint-500">
            {notice}
          </div>
        )}

        {/* ---- today ---- */}
        <section className="card overflow-hidden p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-extrabold text-ink-900">امروز</p>
            {stats && stats.days > 0 && (
              <p className="text-[10.5px] text-ink-500">
                {toPersianDigits(stats.days)} روز
                {stats.both > 0 && ` · ${toPersianDigits(stats.both)} روز کامل`}
              </p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <TodaySlot
              label="تو"
              filled={mineToday}
              photo={days.find((d) => d.day === today)?.mine ?? null}
              busy={busy}
              onPick={() => pick(mineToday ? 'replace' : 'add')}
              accent="blush"
            />
            <TodaySlot
              label={partner?.name ?? 'شریکت'}
              filled={theirsToday}
              photo={days.find((d) => d.day === today)?.theirs ?? null}
              busy={false}
              onPick={() => undefined}
              accent="lilac"
              avatarSrc={partner?.avatar}
            />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />

          {mineToday ? (
            <button
              type="button"
              onClick={() => pick('replace')}
              disabled={busy}
              className="btn-ghost mt-3 w-full !py-2.5 text-[12px]"
            >
              عوض کردن عکس امروز
            </button>
          ) : (
            <button
              type="button"
              onClick={() => pick('add')}
              disabled={busy}
              className="btn-soft mt-3 w-full !py-2.5 text-[12.5px]"
            >
              {busy ? 'در حال گذاشتن…' : 'گذاشتن عکس امروز'}
            </button>
          )}

          {!theirsToday && !mineToday && (
            <p className="mt-2 text-center text-[10.5px] leading-5 text-ink-500">
              هر وقت عکس گذاشتی، شریکت خبردار می‌شود.
            </p>
          )}
          {!theirsToday && mineToday && (
            <p className="mt-2 text-center text-[10.5px] leading-5 text-ink-500">
              عکس تو هست — به {partner?.name ?? 'شریکت'} خبر دادیم.
            </p>
          )}
        </section>

        {/* ---- memory: on this day ---- */}
        {memory.length > 0 && (
          <section className="card p-4">
            <p className="text-[12px] font-extrabold text-ink-900">در چنین روزی</p>
            <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
              {memory.map((item) => (
                <MemoryThumb key={item.id} photo={item} />
              ))}
            </div>
          </section>
        )}

        {/* ---- the album ---- */}
        {days.length === 0 ? (
          <section className="card p-6 text-center">
            <p className="text-[26px]" aria-hidden="true">
              📷
            </p>
            <p className="mt-2 text-[13px] font-bold text-ink-900">آلبوم هنوز خالی است</p>
            <p className="mx-auto mt-1 max-w-[19rem] text-[11.5px] leading-6 text-ink-500">
              اولین عکس را بگذار. از فردا، هر روز یک خانهٔ تازه در این صفحه پر می‌شود.
            </p>
          </section>
        ) : (
          <div className="space-y-2.5">
            {days.map((day) => (
              <DayRow
                key={day.day}
                day={day}
                partnerName={partner?.name ?? 'شریکت'}
                onOpen={() => setViewer(day)}
                onReact={react}
              />
            ))}
          </div>
        )}

        {days.length > 0 && (
          <p className="pt-1 text-center text-[10.5px] leading-5 text-ink-500">
            عکس‌ها فقط برای شما دو نفر است. حذفشان از تنظیمات.
          </p>
        )}
      </main>

      {/* ---- viewer ---- */}
      {viewer && (
        <PhotoViewer
          day={viewer}
          onClose={() => setViewer(null)}
          onReact={react}
          partnerName={partner?.name ?? 'شریکت'}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// Today's slot
// ------------------------------------------------------------------
function TodaySlot({
  label,
  filled,
  photo,
  busy,
  onPick,
  accent,
  avatarSrc,
}: {
  label: string
  filled: boolean
  photo: AlbumPhoto | null
  busy: boolean
  onPick: () => void
  accent: 'blush' | 'lilac'
  avatarSrc?: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!photo?.storage_path) return
    let alive = true
    void resolveAlbumPhoto(photo.storage_path).then((next) => {
      if (alive) setUrl(next)
    })
    return () => {
      alive = false
    }
  }, [photo?.storage_path])

  const ring = accent === 'blush' ? 'border-blush-200 bg-blush-50' : 'border-lilac-300 bg-lilac-100/50'

  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy || (accent === 'lilac' && !filled)}
      className={`relative flex aspect-[4/5] flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed transition ${ring} ${
        filled ? 'border-solid' : ''
      } disabled:opacity-90`}
      aria-label={filled ? `عکس ${label} برای امروز` : `${label} امروز عکسی نگذاشته`}
    >
      {filled && url ? (
        <img src={url} alt={`عکس ${label} امروز`} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          {accent === 'lilac' ? (
            <Avatar src={avatarSrc} name={label} size={40} />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-blush-500">
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </span>
          )}
          <p className="mt-2 px-2 text-[10.5px] font-bold text-ink-500">
            {accent === 'lilac' ? 'هنوز عکسی نگذاشته' : 'عکس امروزت را بگذار'}
          </p>
        </>
      )}

      <span
        className={`absolute bottom-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-extrabold backdrop-blur ${
          filled ? 'bg-black/45 text-white' : 'bg-white/80 text-ink-700'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

// ------------------------------------------------------------------
// One day's spread
// ------------------------------------------------------------------
function DayRow({
  day,
  partnerName,
  onOpen,
  onReact,
}: {
  day: AlbumDay
  partnerName: string
  onOpen: () => void
  onReact: (photo: AlbumPhoto) => void
}) {
  const relative = relativeDay(day.day)

  return (
    <section className="card overflow-hidden p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-[11.5px] font-extrabold text-ink-900">
          {relative ?? dayHeading(day.day)}
        </p>
        <p className="text-[10px] text-ink-500">
          {day.both ? 'هر دو' : day.mine ? 'فقط تو' : `فقط ${partnerName}`}
        </p>
      </div>

      <div className={`grid gap-1.5 ${day.both ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {day.mine && <Half photo={day.mine} alt="عکس تو" onOpen={onOpen} onReact={onReact} mine />}
        {day.theirs && (
          <Half
            photo={day.theirs}
            alt={`عکس ${partnerName}`}
            onOpen={onOpen}
            onReact={onReact}
            mine={false}
          />
        )}
      </div>
    </section>
  )
}

function Half({
  photo,
  alt,
  onOpen,
  onReact,
  mine,
}: {
  photo: AlbumPhoto
  alt: string
  onOpen: () => void
  onReact: (photo: AlbumPhoto) => void
  mine: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void resolveAlbumPhoto(photo.storage_path).then((next) => {
      if (alive) setUrl(next)
    })
    return () => {
      alive = false
    }
  }, [photo.storage_path])

  const aspect = photo.width && photo.height ? photo.width / photo.height : 4 / 5

  return (
    <div className="relative overflow-hidden rounded-2xl bg-blush-50">
      <button type="button" onClick={onOpen} className="block w-full" aria-label={alt}>
        {url ? (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            style={{ aspectRatio: String(aspect) }}
            className="w-full object-cover"
          />
        ) : (
          <div className="w-full animate-pulse bg-blush-100" style={{ aspectRatio: String(aspect) }} />
        )}
      </button>

      {/* Your own photo cannot be hearted — the point is that somebody else saw it. */}
      {!mine && (
        <button
          type="button"
          onClick={() => onReact(photo)}
          aria-label={photo.reacted_at ? 'برداشتن قلب' : 'گذاشتن قلب'}
          aria-pressed={Boolean(photo.reacted_at)}
          className={`absolute bottom-1.5 left-1.5 flex h-8 items-center gap-1 rounded-full px-2.5 backdrop-blur transition ${
            photo.reacted_at ? 'bg-white/90 text-blush-800' : 'bg-black/35 text-white'
          }`}
        >
          <span className="text-[13px] leading-none">{photo.reacted_at ? '🤍' : '♡'}</span>
        </button>
      )}
    </div>
  )
}

function MemoryThumb({ photo }: { photo: AlbumPhoto }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void resolveAlbumPhoto(photo.storage_path).then((next) => {
      if (alive) setUrl(next)
    })
    return () => {
      alive = false
    }
  }, [photo.storage_path])

  const label =
    (photo.years_ago ?? 0) >= 1
      ? `${toPersianDigits(photo.years_ago!)} سال قبل`
      : `${toPersianDigits(photo.months_ago ?? 0)} ماه قبل`

  return (
    <div className="w-24 shrink-0">
      <div className="h-24 w-24 overflow-hidden rounded-2xl bg-blush-50">
        {url ? (
          <img src={url} alt={dayFull(photo.day)} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="h-full w-full animate-pulse bg-blush-100" />
        )}
      </div>
      <p className="mt-1 text-center text-[9.5px] font-bold text-ink-500">{label}</p>
    </div>
  )
}

// ------------------------------------------------------------------
// Full-screen viewer
// ------------------------------------------------------------------
function PhotoViewer({
  day,
  onClose,
  onReact,
  partnerName,
}: {
  day: AlbumDay
  onClose: () => void
  onReact: (photo: AlbumPhoto) => void
  partnerName: string
}) {
  const slots = [
    day.mine ? { photo: day.mine, mine: true, name: 'تو' } : null,
    day.theirs ? { photo: day.theirs, mine: false, name: partnerName } : null,
  ].filter(Boolean) as { photo: AlbumPhoto; mine: boolean; name: string }[]

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink-900/95"
      role="dialog"
      aria-modal="true"
      aria-label={dayFull(day.day)}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[12.5px] font-bold text-white/90">{dayFull(day.day)}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="بستن"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-8">
        {slots.map(({ photo, mine, name }) => (
          <ViewerPhoto key={photo.id} photo={photo} mine={mine} name={name} onReact={onReact} />
        ))}
      </div>
    </div>
  )
}

function ViewerPhoto({
  photo,
  mine,
  name,
  onReact,
}: {
  photo: AlbumPhoto
  mine: boolean
  name: string
  onReact: (photo: AlbumPhoto) => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void resolveAlbumPhoto(photo.storage_path).then((next) => {
      if (alive) setUrl(next)
    })
    return () => {
      alive = false
    }
  }, [photo.storage_path])

  return (
    <div className="flex flex-col items-center">
      <div className="w-full overflow-hidden rounded-3xl bg-white/5">
        {url ? (
          <img src={url} alt={`عکس ${name}`} className="max-h-[60dvh] w-full object-contain" />
        ) : (
          <div className="h-64 w-full animate-pulse bg-white/10" />
        )}
      </div>

      <div className="mt-2 flex w-full items-center justify-between">
        <p className="text-[11px] font-bold text-white/70">{name}</p>
        {!mine && (
          <button
            type="button"
            onClick={() => onReact(photo)}
            aria-pressed={Boolean(photo.reacted_at)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition ${
              photo.reacted_at ? 'bg-white text-blush-800' : 'bg-white/15 text-white'
            }`}
          >
            <span aria-hidden="true">{photo.reacted_at ? '🤍' : '♡'}</span>
            {photo.reacted_at ? 'قلب زدی' : 'قلب'}
          </button>
        )}
      </div>
    </div>
  )
}
