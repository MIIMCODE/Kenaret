import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Confetti from '../components/Confetti'
import Reveal from '../components/Reveal'
import ScareScreen from '../components/ScareScreen'
import Spinner from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import { fetchAlbum, fetchPairingState } from '../lib/api'
import { resolveAlbumPhoto } from '../lib/album'
import {
  celebrationMessage,
  fetchCelebrationState,
  openCelebration,
  resolveCelebrationMusic,
  togetherCounter,
  writeCelebrationNote,
  type Celebration,
  type CelebrationKind,
  type CelebrationState,
} from '../lib/celebrate'
import { toPersianError } from '../lib/errors'
import { anniversaryLabel, nextMonthlyAnniversary, nextYearlyAnniversary } from '../lib/anniversary'
import {
  hasPranked,
  markPranked,
  prankDisabledByQuery,
  setPrankActive,
} from '../lib/prank'
import type { AlbumPhoto } from '../types/database'

/**
 * جشن — the celebration screen.
 *
 * A full-screen, once-in-a-while room: dark, warm, and loud, deliberately a
 * different temperature from the rest of the app. Everything else here is a
 * quiet glass surface you read; this one is a thing that happens to you.
 *
 * Reached two ways, which is why it owns the auto-open logic:
 *   · automatically, once, on the evening itself (`?auto=1`)
 *   · from the dashboard card, any time after
 *
 * The *decision* about whether tonight is a celebration is never taken here —
 * `celebration_state()` answers that in Asia/Tehran, so both phones agree.
 */

/** How many polaroids the album wall holds before it fades out. */
const POLAROID_LIMIT = 9
const POLAROID_DAYS = 400

export default function CelebrationPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [state, setState] = useState<CelebrationState | null>(null)
  const [celebration, setCelebration] = useState<Celebration | null>(null)
  const [photos, setPhotos] = useState<Array<{ path: string; url: string; tilt: number }>>([])
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [musicUrl, setMusicUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [burst, setBurst] = useState(0)
  const [now, setNow] = useState(() => new Date())
  const [muted, setMuted] = useState(false)
  /**
   * The prank. 'scare' → 'reveal' → 'done'. Starts at 'done' for every path
   * that is not a fresh automatic entrance, so a manual visit or a repeat
   * never sees it.
   */
  const [prank, setPrank] = useState<'scare' | 'reveal' | 'done'>('done')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const requestedRef = useRef(false)

  const myNote = useMemo(
    () => celebration?.notes.find((n) => n.author_id === user?.id) ?? null,
    [celebration, user?.id],
  )
  const theirNote = useMemo(
    () => celebration?.notes.find((n) => n.author_id !== user?.id) ?? null,
    [celebration, user?.id],
  )

  /* ── load ───────────────────────────────────────────────────────────── */

  const load = useCallback(async () => {
    try {
      const [next, pairing] = await Promise.all([
        fetchCelebrationState(),
        fetchPairingState().catch(() => null),
      ])
      setState(next)
      setPartnerName(pairing?.partner?.display_name ?? null)
      setError(null)

      // A celebration to show, in order of preference: tonight's, if it is
      // tonight; otherwise the most recent one, so the URL is never a blank
      // page when someone bookmarks it.
      const candidate = next.today_candidate
      if (next.ok && candidate) {
        const opened = await openCelebration(candidate.kind, candidate.ordinal)
        setCelebration(opened)
        setBurst((n) => n + 1)
      }

      if (next.music) {
        const url = await resolveCelebrationMusic(next.music.storage_path)
        setMusicUrl(url)
      }
    } catch (loadError) {
      setError(toPersianError(loadError, 'جشن بارگذاری نشد.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /* ── the prank ──────────────────────────────────────────────────────── */
  /*
   * When it plays: only on `?auto=1` — the dashboard opening the room by
   * itself — and only when there is genuinely something to celebrate and this
   * tab has not seen the prank yet.
   *
   * It never plays on a manual visit, because the second time is not a
   * surprise, and it never plays when the database says tonight is not the
   * night, because "fake hack → nothing happened" is not a joke, it is a lie.
   */
  useEffect(() => {
    if (loading || prank !== 'done') return
    if (!state?.ok || !state.today_candidate) return
    if (params.get('auto') !== '1') return
    if (prankDisabledByQuery(window.location.search)) return
    if (hasPranked()) return

    markPranked()
    setPrank('scare')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, state?.ok, state?.today_candidate])

  /*
   * Hide the app shell while the prank is on. The background and the tab bar
   * are mounted outside <Routes>, so a fake hack with the site's pink glass
   * drifting behind it would give the game away in the first frame.
   */
  useEffect(() => {
    const active = prank !== 'done'
    setPrankActive(active)

    /*
     * Lock the page under it. Both overlays are `position: fixed`, but the
     * celebration behind them is taller than the viewport — without this, a
     * swipe over the fake terminal scrolls the real page underneath it, which
     * is the one interaction that would instantly give the prank away.
     */
    if (active) {
      const previous = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = previous
        setPrankActive(false)
      }
    }

    return () => setPrankActive(false)
  }, [prank])

  /* ── the album wall ─────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false

    async function loadPhotos() {
      const today = state?.today
      if (!today) return

      try {
        const to = today
        const from = isoShift(today, -POLAROID_DAYS)
        const rows = await fetchAlbum(from, to)

        /*
         * Spread the picks across the whole window rather than taking the
         * newest nine, which would all come from the same fortnight.
         *
         * `album_range` returns newest-first, so take one from each end and
         * alternate — the wall then reads as a spectrum of the relationship
         * rather than as a run of one month.
         */
        const picked = spread(rows, POLAROID_LIMIT)
        const resolved = await Promise.all(
          picked.map(async (row: AlbumPhoto) => {
            const url = await resolveAlbumPhoto(row.storage_path)
            if (!url) return null
            // A fixed tilt per photo: random would reshuffle on every render.
            const tilt = tiltFor(row.storage_path)
            return { path: row.storage_path, url, tilt }
          }),
        )
        if (!cancelled) setPhotos(resolved.filter((p): p is NonNullable<typeof p> => p !== null))
      } catch {
        // A missing album must not break the celebration — it is decoration.
      }
    }

    void loadPhotos()
    return () => {
      cancelled = true
    }
  }, [state?.today])

  /* ── the ticking counter ────────────────────────────────────────────── */

  useEffect(() => {
    if (!state?.anniversary_date) return
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [state?.anniversary_date])

  /* ── music ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicUrl) return
    audio.volume = 0.45
    // Browsers refuse autoplay without a gesture, and `?auto=1` arrives from a
    // tap on the dashboard so it usually works — but a refusal is silent and
    // harmless: the play button is right there.
    void audio.play().then(
      () => setMuted(false),
      () => setMuted(true),
    )
  }, [musicUrl])

  /* ── the automatic entrance ─────────────────────────────────────────── */
  /*
   * `?auto=1` means "the dashboard sent me here on its own". If the database
   * does not agree that tonight is a celebration, bounce back rather than
   * showing an empty amphitheatre. A *manual* visit is never bounced — that is
   * the difference between an interruption and an invitation.
   */
  useEffect(() => {
    if (loading || requestedRef.current) return
    requestedRef.current = true

    const cameFromDashboard = params.get('auto') === '1'
    if (cameFromDashboard && state?.ok && !state.today_candidate) {
      navigate('/app', { replace: true })
    }
  }, [loading, params, state, navigate])

  /* ── writing the note ───────────────────────────────────────────────── */

  async function submitNote(e: React.FormEvent) {
    e.preventDefault()
    if (!celebration) return
    const body = note.trim()
    if (!body) return

    setNoteBusy(true)
    try {
      const written = await writeCelebrationNote(celebration.id, body)
      setCelebration((prev) => (prev ? { ...prev, notes: [...prev.notes, written] } : prev))
      setNote('')
    } catch (writeError) {
      setError(toPersianError(writeError, 'پیام ذخیره نشد.'))
    } finally {
      setNoteBusy(false)
    }
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="celebrate-shell flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    )
  }

  const counter = state?.anniversary_date ? togetherCounter(state.anniversary_date, now) : null
  const kind: CelebrationKind = celebration?.kind ?? state?.today_candidate?.kind ?? 'monthiversary'
  const ordinal = celebration?.ordinal ?? state?.today_candidate?.ordinal ?? 1

  const headline = celebration?.title ?? state?.today_candidate?.title ?? 'جشن'
  const eyebrow = celebration?.subtitle ?? state?.today_candidate?.subtitle ?? ''

  const prankTitle = celebration?.title ?? state?.today_candidate?.title ?? 'جشن'
  const prankSubtitle = celebration?.subtitle ?? state?.today_candidate?.subtitle ?? ''

  return (
    <div className="celebrate-shell relative min-h-dvh w-full overflow-x-hidden pb-16">
      {/*
        The prank sits *over* the real page rather than replacing it, so the
        page underneath is already loaded and the reveal has somewhere to
        land — no spinner between "you have been hacked" and "happy month".
      */}
      {prank === 'scare' && (
        <ScareScreen
          onReveal={() => setPrank('reveal')}
          name={partnerName}
        />
      )}
      {prank === 'reveal' && (
        <Reveal
          title={prankTitle}
          subtitle={prankSubtitle}
          onDone={() => setPrank('done')}
        />
      )}

      {/* The one heavy filter on this screen; everything else is a plain fill. */}
      <Confetti burstKey={burst} fireworks={1} className="fixed z-0" />

      {/* ── top bar ── */}
      <header className="relative z-10 mx-auto flex w-full max-w-lg items-center justify-between px-4 pt-4">
        <Link
          to="/app"
          className="celebrate-pill px-3 py-2 text-[11.5px] font-bold"
          aria-label="بازگشت به خانه"
        >
          ← خانه
        </Link>

        {musicUrl && (
          <button
            type="button"
            onClick={() => {
              const audio = audioRef.current
              if (!audio) return
              if (audio.paused) {
                void audio.play().then(() => setMuted(false), () => setMuted(true))
              } else {
                audio.pause()
                setMuted(true)
              }
            }}
            className="celebrate-pill px-3 py-2 text-[11.5px] font-bold"
            aria-pressed={!muted}
          >
            {muted ? '♪ پخش آهنگ' : '❚❚ ساکت'}
          </button>
        )}
      </header>

      <main className="relative z-10 mx-auto w-full max-w-lg px-4">
        {/* ── the headline ── */}
        <section className="mt-6 text-center">
          <p className="text-[11px] font-bold tracking-[0.3em] text-[#ffc9d7]">{eyebrow}</p>

          <h1 className="celebrate-headline mt-2 text-[38px] font-black leading-[1.15]">
            {toFa(headline)}
          </h1>

          <p className="mx-auto mt-3 max-w-[19rem] text-[13px] leading-7 text-[#f6e6ec]">
            {celebrationMessage(kind, ordinal)}
          </p>

          {state?.anniversary_date && (
            <p className="mt-1.5 text-[11px] text-[#e3c9d4]">
              از {anniversaryLabel(state.anniversary_date)}
            </p>
          )}
        </section>

        {/* ── the live counter ── */}
        {counter && (
          <section className="celebrate-card mt-6 rounded-[1.75rem] p-4">
            <p className="text-center text-[10.5px] font-bold text-[#ffc9d7]">با هم بوده‌ایم</p>

            {/*
              Days get their own row. They are the number that means something;
              hours and minutes exist to make the page feel alive, and pushing
              all four into one grid would make the smallest number the
              loudest thing on the card.
            */}
            <div className="mt-3">
              <CounterCell value={toFa(counter.days)} label="روز کنار هم" big />
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <CounterCell value={pad(counter.hours)} label="ساعت" />
              <CounterCell value={pad(counter.minutes)} label="دقیقه" />
              <CounterCell value={pad(counter.seconds)} label="ثانیه" />
            </div>
          </section>
        )}

        {/* ── the polaroid wall ── */}
        {photos.length > 0 && (
          <section className="mt-7">
            <p className="mb-3 text-center text-[10.5px] font-bold tracking-[0.2em] text-[#ffc9d7]">
              قاب‌هایی از ما
            </p>

            <div className="celebrate-polaroids">
              {photos.map((photo, index) => (
                <figure
                  key={photo.path}
                  className="celebrate-polaroid"
                  style={{
                    '--tilt': `${photo.tilt}deg`,
                    animationDelay: `${index * 90}ms`,
                  } as React.CSSProperties}
                >
                  <img src={photo.url} alt="" loading="lazy" className="h-full w-full object-cover" />
                </figure>
              ))}
            </div>
          </section>
        )}

        {/* ── the two notes ── */}
        {celebration && (
          <section className="mt-7 space-y-3">
            <p className="text-center text-[10.5px] font-bold tracking-[0.2em] text-[#ffc9d7]">
              پیام‌های ما
            </p>

            {theirNote && (
              <NoteCard
                body={theirNote.body}
                author={partnerName ?? 'او'}
                mine={false}
              />
            )}

            {myNote ? (
              <NoteCard body={myNote.body} author={profile?.display_name ?? 'تو'} mine />
            ) : (
              <form onSubmit={submitNote} className="celebrate-card rounded-[1.5rem] p-3.5">
                <label htmlFor="celebration-note" className="text-[11px] font-bold text-[#ffc9d7]">
                  یک پیام برای او
                </label>
                <textarea
                  id="celebration-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 600))}
                  rows={3}
                  placeholder="امشب چه چیزی را می‌خواهی برای همیشه بنویسی؟"
                  className="celebrate-input mt-2 w-full resize-none rounded-xl px-3 py-2.5 text-[12.5px] leading-6"
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-[#e3c9d4]">
                    {toFa(note.length)} از ۶۰۰
                  </span>
                  <button
                    type="submit"
                    disabled={noteBusy || note.trim().length === 0}
                    className="celebrate-button px-4 py-2 text-[12px] font-extrabold disabled:opacity-50"
                  >
                    {noteBusy ? 'دارم می‌نویسم…' : 'ثبت پیام'}
                  </button>
                </div>
              </form>
            )}

            {theirNote && myNote && (
              <p className="pt-1 text-center text-[10.5px] leading-6 text-[#e3c9d4]">
                هر دو پیام نوشته شد. این شب، امضاشده ماند.
              </p>
            )}
          </section>
        )}

        {/*
          Opening the room on an ordinary evening is not an error, so it does
          not get an error message. The room is always open; it just has
          nothing to give you tonight except the next date to look forward to.
        */}
        {!celebration && !error && state?.today_candidate === null && state?.anniversary_date && (
          <UpcomingCelebration
            date={state.anniversary_date}
            photos={photos.length}
            hasMusic={Boolean(state.music)}
          />
        )}

        {!celebration && !error && state?.today_candidate !== null && state?.ok === false && (
          <section className="celebrate-card mt-6 rounded-[1.75rem] p-5 text-center">
            <p className="text-[13px] font-bold text-[#fff2f6]">جشن مالِ دو نفر است</p>
            <p className="mt-1.5 text-[11.5px] leading-6 text-[#e3c9d4]">
              برای دیدن این صفحه باید به هم وصل باشید.
            </p>
            <Link to="/app" className="celebrate-button mt-4 inline-block px-5 py-2.5 text-[12px]">
              بازگشت به خانه
            </Link>
          </section>
        )}

        {error && (
          <p className="mt-4 rounded-2xl bg-[#4a1024]/70 px-4 py-3 text-center text-[12px] font-semibold text-[#ffd9e3]">
            {error}
          </p>
        )}

        <p className="mt-8 text-center text-[10px] leading-6 text-[#c9a9b8]">
          {state?.music ? `♪ ${state.music.display_name}` : 'بدون آهنگ'}
          {state?.music ? '' : ' — از تنظیمات یکی بارگذاری کن.'}
        </p>
      </main>

      {musicUrl && <audio ref={audioRef} src={musicUrl} loop preload="metadata" />}
    </div>
  )
}

/* ── small pieces ──────────────────────────────────────────────────────── */

/**
 * The ordinary evening.
 *
 * Shows the *next* celebration rather than an apology: a room you can walk
 * into any day of the year, which happens to be decorated for one specific
 * evening. Telling someone "not tonight" when they came here on purpose is a
 * door slammed in their face; telling them "seventeen days" is the same
 * information, given as something to look forward to.
 */
function UpcomingCelebration({
  date,
  photos,
  hasMusic,
}: {
  date: string
  photos: number
  hasMusic: boolean
}) {
  const { monthly, yearly } = useMemo(() => {
    return {
      monthly: nextMonthlyAnniversary(date),
      yearly: nextYearlyAnniversary(date),
    }
  }, [date])

  const next = monthly.daysUntil <= yearly.daysUntil ? monthly : yearly
  const isYearly = next === yearly

  return (
    <section className="celebrate-card mt-6 overflow-hidden rounded-[1.75rem] p-5 text-center">
      <p className="text-[10px] font-bold tracking-[0.2em] text-[#ffc9d7]">جشن بعدی</p>

      <p className="celebrate-headline mt-2 text-[30px] font-black leading-tight">
        {toFa(next.daysUntil === 0 ? 'امشب' : next.daysUntil)}
      </p>
      <p className="mt-1 text-[12px] font-bold text-[#f6e6ec]">
        {next.daysUntil === 0 ? 'شب جشن است' : 'روز مانده'}
      </p>

      <p className="mt-3 text-[12.5px] leading-6 text-[#e3c9d4]">
        {isYearly ? `${toFa(yearly.yearNumber)} سالگی` : `${toFa(monthly.monthNumber)} ماهگی`}
        {' — '}
        {anniversaryLabel(next.iso)}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-right">
        <div className="celebrate-well rounded-xl px-3 py-2">
          <p className="text-[9.5px] font-semibold text-[#e3c9d4]">قاب‌های آلبوم</p>
          <p className="celebrate-digits mt-0.5 text-[16px] font-black">{toFa(photos)}</p>
        </div>
        <div className="celebrate-well rounded-xl px-3 py-2">
          <p className="text-[9.5px] font-semibold text-[#e3c9d4]">آهنگ شب</p>
          <p className="mt-0.5 text-[13px] font-extrabold text-[#fff2f6]">
            {hasMusic ? 'انتخاب شده' : 'انتخاب نشده'}
          </p>
        </div>
      </div>

      {!hasMusic && (
        <Link
          to="/settings"
          className="mt-3 inline-block text-[11.5px] font-bold text-[#ffc9d7] underline underline-offset-4"
        >
          از تنظیمات یک آهنگ انتخاب کن
        </Link>
      )}

      <div>
        <Link to="/app" className="celebrate-button mt-4 inline-block px-5 py-2.5 text-[12px]">
          بازگشت به خانه
        </Link>
      </div>
    </section>
  )
}

function CounterCell({ value, label, big }: { value: string; label: string; big?: boolean }) {
  return (
    <div className="celebrate-well rounded-xl px-2 py-2.5 text-center">
      <p className={`celebrate-digits font-black ${big ? 'text-[34px] leading-none' : 'text-[19px]'}`}>
        {value}
      </p>
      <p className="mt-1 text-[9.5px] font-semibold text-[#e3c9d4]">{label}</p>
    </div>
  )
}

function NoteCard({ body, author, mine }: { body: string; author: string; mine: boolean }) {
  return (
    <article className={`celebrate-card rounded-[1.5rem] p-3.5 ${mine ? '' : 'celebrate-theirs'}`}>
      <p className="text-[10px] font-bold text-[#ffc9d7]">{author}</p>
      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-6 text-[#fff2f6]">{body}</p>
    </article>
  )
}

/* ── helpers ───────────────────────────────────────────────────────────── */

/** Persian digits, no grouping — a counter that reads ۱٫۲۳۴ is not a clock. */
function toFa(value: number | string): string {
  if (typeof value === 'number') {
    return value.toLocaleString('fa-IR', { useGrouping: false })
  }
  return value.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
}

function pad(value: number): string {
  return toFa(String(value).padStart(2, '0'))
}

/** Gregorian ISO shifted by days, without pulling in a date library. */
function isoShift(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Picks `count` rows evenly across the list, so the wall spans the whole
 * relationship instead of the last two weeks of it.
 *
 * It walks the list in the order it was given (which for the album is
 * newest-first) and always takes the first and last item — so the wall opens
 * with today's photo and closes with one from the beginning.
 */
function spread<T>(rows: T[], count: number): T[] {
  if (rows.length <= count) return rows
  const step = (rows.length - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => rows[Math.round(i * step)])
}

/** A stable pseudo-random tilt, hashed from the path. */
function tiltFor(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const unit = (Math.abs(hash) % 1000) / 1000
  return (unit - 0.5) * 9
}
