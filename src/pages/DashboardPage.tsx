import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import { NeoStat } from '../components/Neo'
import Alert from '../components/Alert'
import Avatar from '../components/Avatar'
import PairingCodeCard from '../components/PairingCodeCard'
import ConnectForm from '../components/ConnectForm'
import InstallHint from '../components/InstallHint'
import PartnerCard from '../components/PartnerCard'
import RequestList from '../components/RequestList'
import AnniversaryCard from '../components/AnniversaryCard'
import AnniversarySetup from '../components/AnniversarySetup'
import ReunionCard from '../components/ReunionCard'
import { FullPageLoader } from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import {
  cancelRequest,
  fetchPairingState,
  respondToRequest,
  unlinkPartner,
} from '../lib/api'
import { toPersianError } from '../lib/errors'
import {
  fetchCelebrationState,
  shouldAutoOpen,
  type CelebrationState,
} from '../lib/celebrate'
import { daysBetweenIso, formatJalaliLong, toPersianDigits, todayIso } from '../lib/jalali'
import type { CoupleRequestSummary, PairingState } from '../types/database'

export default function DashboardPage() {
  const { profile, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<PairingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingAnniversary, setEditingAnniversary] = useState(false)
  const [celebration, setCelebration] = useState<CelebrationState | null>(null)
  // Primitive, so the celebration effect below does not re-run on every poll tick.
  const paired = Boolean(state?.partner)

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true)
      try {
        const next = await fetchPairingState()
        setState(next)
        setError(null)
      } catch (loadError) {
        setError(toPersianError(loadError, 'اطلاعات جفت‌شدن بارگذاری نشد.'))
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    void load(true)
  }, [load])

  // Keep the pairing state fresh when the tab regains focus (or the partner accepts).
  useEffect(() => {
    function onFocus() {
      void load()
    }
    window.addEventListener('focus', onFocus)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(interval)
    }
  }, [load])

  /*
   * جشن — the automatic entrance.
   *
   * Runs once per mounted dashboard, and only after the pairing state has
   * loaded, so a signed-out or unpaired visitor never sees a flash of a room
   * they cannot enter. The database decides whether tonight counts; this only
   * decides whether *this device* has already shown it.
   *
   * The "already shown" marker lives in sessionStorage rather than state: a
   * reload of the dashboard is the commonest thing that happens on a phone,
   * and re-opening the celebration every reload would turn a surprise into an
   * interruption. Closing the tab resets it, which is the right scope — the
   * evening gets one entrance per visit, not one forever.
   */
  useEffect(() => {
    if (loading || !paired) return

    let cancelled = false

    async function checkCelebration() {
      try {
        const next = await fetchCelebrationState()
        if (cancelled) return
        setCelebration(next)

        const seen = readSeen()
        if (shouldAutoOpen(next, seen)) {
          markSeen(next)
          navigate('/celebrate?auto=1')
        }
      } catch {
        // A celebration that cannot be checked must not break the dashboard.
      }
    }

    void checkCelebration()
    return () => {
      cancelled = true
    }
  }, [loading, paired, navigate])

  async function handleAccept(item: CoupleRequestSummary) {
    setBusyId(item.couple_id)
    setNotice(null)
    try {
      await respondToRequest(item.couple_id, true)
      await load()
      await refreshProfile()
      setNotice('🎉 وصل شدید! حالا می‌توانید پروفایل هم را ببینید.')
    } catch (acceptError) {
      setError(toPersianError(acceptError))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDecline(item: CoupleRequestSummary) {
    if (!confirm(`درخواست ${item.display_name ?? 'این کاربر'} رد شود؟`)) return
    setBusyId(item.couple_id)
    try {
      await respondToRequest(item.couple_id, false)
      await load()
    } catch (declineError) {
      setError(toPersianError(declineError))
    } finally {
      setBusyId(null)
    }
  }

  async function handleCancel(item: CoupleRequestSummary) {
    if (!confirm('این درخواست لغو شود؟')) return
    setBusyId(item.couple_id)
    try {
      await cancelRequest(item.couple_id)
      await load()
      setNotice('درخواستت لغو شد.')
    } catch (cancelError) {
      setError(toPersianError(cancelError))
    } finally {
      setBusyId(null)
    }
  }

  async function handleUnlink() {
    if (
      // This used to say "اطلاعات خصوصی هر کدام باقی می‌ماند", which was not
      // true: `unlink_partner` deletes the couple row, and messages, album
      // photos, warmth and reunions all cascade from it. With an album full of
      // photos, that sentence would have cost someone everything they had
      // built together. Say what actually happens.
      !confirm(
        'مطمئنی می‌خواهی ارتباط را قطع کنی؟\n\n' +
          'با این کار گفت‌وگوها، عکس‌های آلبوم و همهٔ چیزهایی که با هم ساخته‌اید برای همیشه پاک می‌شود. ' +
          'این کار برگشت‌پذیر نیست.',
      )
    ) {
      return
    }
    try {
      await unlinkPartner()
      await load()
      await refreshProfile()
      setNotice('ارتباط قطع شد. کد جدیدت همیشه روی همین صفحه آماده است.')
    } catch (unlinkError) {
      setError(toPersianError(unlinkError))
    }
  }

  if (loading && !state) return <FullPageLoader label="کنارت در حال آماده‌سازی است..." />

  if (!state) {
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="page space-y-4">
          <Alert tone="error">{error ?? 'اطلاعات بارگذاری نشد.'}</Alert>
          <button type="button" onClick={() => void load(true)} className="btn-primary w-full">
            تلاش مجدد
          </button>
        </main>
      </div>
    )
  }

  const partner = state.partner
  const hasPartner = Boolean(partner)
  const hasOutgoing = state.outgoing.length > 0

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4">
        {/*
          The greeting card — the first pane of glass a user sees after signing
          in, so it sets the material for the whole page. `card` brings the
          recipe (fill, hairline, blur, reflection); the explicit radius keeps
          the 28px it has always had, which is now also `--radius-card`, so the
          two agree by construction rather than by coincidence.
        */}
        <section className="card animate-fade-up rounded-[1.75rem] p-5">
          <div className="flex items-center gap-4">
            <div className="well rounded-full p-1.5">
              <Avatar src={profile?.avatar_url} name={profile?.display_name} size={46} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11.5px] font-semibold text-ink-700">سلام 👋</p>
              <h1 className="truncate text-[22px] font-extrabold leading-8 text-ink-900">
                {profile?.display_name ?? 'دوست من'}
              </h1>
            </div>
            {/* The day, as a raised pill — it is the one thing that changes
                every morning, so it gets its own object. */}
            <div className="well rounded-2xl px-3 py-2 text-center">
              <p className="text-[13px] font-extrabold leading-none text-blush-800">
                {toPersianDigits(new Date().toLocaleDateString('fa-IR', { day: 'numeric' }))}
              </p>
              <p className="mt-1 text-[9px] font-bold leading-none text-ink-700">
                {new Date().toLocaleDateString('fa-IR', { month: 'long' })}
              </p>
            </div>
          </div>
        </section>

        {/*
          The couple's own numbers, pressed into the surface.
          Only shown once there is a start date; `daysBetweenIso` is calendar
          days, so this is "how many days we have been us", not a duration.
        */}
        {hasPartner && state.anniversary?.date && (
          <section className="flex items-stretch gap-3">
            <NeoStat
              label="با هم بوده‌ایم"
              value={toPersianDigits(Math.max(0, daysBetweenIso(state.anniversary.date, todayIso())))}
              unit="روز"
            />
            <NeoStat
              label="تا سالگرد بعدی"
              value={toPersianDigits(
                Math.max(
                  0,
                  365 - (Math.max(0, daysBetweenIso(state.anniversary.date, todayIso())) % 365),
                ),
              )}
              unit="روز"
              tone="lilac"
            />
          </section>
        )}

        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {/* ==== Connected ==== */}
        {hasPartner && partner && (
          <>
            {/* Today's photo. It is the smallest daily action in the app and
                the only one that leaves something behind. */}
            <Link
              to="/album"
              className="card flex items-center gap-3 rounded-[1.75rem] p-4 transition-shadow duration-200 hover:brightness-[1.03] active:brightness-95"
            >
              {/* The icon tile is inset, so the glyph looks stamped into the
                  card rather than floating on top of it. */}
              <span className="well flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-blush-800">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="3.5" stroke="currentColor" strokeWidth="1.7" />
                  <circle cx="8.5" cy="10" r="1.6" fill="currentColor" />
                  <path
                    d="M4 16.5l4.5-4a2 2 0 0 1 2.7 0L20 20"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-extrabold text-ink-900">آلبوم ما</p>
                <p className="truncate text-[11px] text-ink-700">یک عکس، هر روز — از هر دویتان</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-ink-700/55">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            {/* The private room. Deliberately the darkest thing on a pastel
                page: it should not look like just another tab. */}
            <Link
              to="/vault"
              /* The private room stays the darkest thing on the page — that is
                 the point of it — but its edges now follow the same two-light
                 rule, so it belongs to the same surface instead of being a
                 rectangle pasted on top. */
              className="flex items-center gap-3 rounded-[1.75rem] bg-gradient-to-l from-[#1d1017] via-[#2a1721] to-[#331b27] p-4 text-[#f4e7e2] shadow-[8px_8px_20px_rgba(180,150,150,0.45),-8px_-8px_20px_rgba(255,255,255,0.85)] transition duration-200 active:scale-[0.995] active:shadow-[inset_6px_6px_14px_rgba(0,0,0,0.55),inset_-4px_-4px_12px_rgba(255,255,255,0.06)]"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-[#f4c3d1]">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="4.5" y="10" width="15" height="10" rx="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="12" cy="15" r="1.2" fill="currentColor" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-extrabold">فضای خصوصی</p>
                <p className="truncate text-[11px] text-[#f4e7e2]/60">فقط با رمز شما دو نفر باز می‌شود</p>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-[#f4e7e2]/55">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>

            {/* The conversation. Above everything else, because it is the
                only thing here that both people touch every day. */}
            <Link
              to="/chat"
              className="card flex items-center gap-3 rounded-[1.75rem] p-4 transition-shadow duration-200 hover:brightness-[1.03] active:brightness-95"
            >
              <span className="tile flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-bl from-blush-600 to-blush-800 text-white">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-extrabold text-ink-900">گفت‌وگو</p>
                <p className="truncate text-[11px] text-ink-700">
                  فقط بین تو و {partner.display_name ?? 'شریکت'}
                </p>
              </div>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                className="shrink-0 text-ink-700/55"
              >
                <path
                  d="M15 6l-6 6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>

            <PartnerCard partner={partner} onUnlink={handleUnlink} />

            {/* Relationship start date: the heart of the couple dashboard */}
            {state.anniversary && state.anniversary.needs_answer && state.anniversary.is_your_turn && (
              <section className="card animate-fade-up rounded-[1.75rem] p-5">
                <AnniversarySetup
                  partnerName={partner.display_name}
                  onDone={(result) => {
                    setEditingAnniversary(false)
                    void load()
                    setNotice(
                      result === 'saved'
                        ? '💞 تاریخ آشنایی‌اتون ثبت شد. حالا کنارت روزهایتان را می‌شمارد.'
                        : `سؤال برای ${partner.display_name ?? 'شریکت'} فرستاده شد؛ به‌محض پاسخ، تاریخ همین‌جا می‌آید.`,
                    )
                  }}
                />
              </section>
            )}

            {state.anniversary &&
              state.anniversary.needs_answer &&
              !state.anniversary.is_your_turn && (
                <section className="card animate-fade-up rounded-[1.75rem] p-5 text-center">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blush-100 text-blush-500">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M12 7.6V12l3 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <h3 className="mt-2.5 text-[14px] font-extrabold text-ink-900">منتظر تاریخ آشنایی</h3>
                  <p className="mx-auto mt-1 max-w-[19rem] text-[11.5px] leading-6 text-ink-700">
                    این سؤال را برای {partner.display_name ?? 'شریکت'} فرستادیم. همین‌که تاریخ را ثبت کند،
                    شمارنده‌ی «با هم بودن» و روزهای مهم برای هر دویتان فعال می‌شود.
                  </p>
                  <p className="mt-2 text-[10.5px] text-ink-700">
                    یادت آمد؟ می‌توانی همین حالا خودت ثبتش کنی.
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditingAnniversary(true)}
                    className="btn-ghost mt-3 w-full"
                  >
                    خودم تاریخ را می‌دانم
                  </button>
                </section>
              )}

            {state.anniversary &&
              !state.anniversary.needs_answer &&
              state.anniversary.date &&
              !editingAnniversary && (
                <AnniversaryCard
                  date={state.anniversary.date}
                  onEdit={() => setEditingAnniversary(true)}
                  setByName={partner.display_name}
                  isMine={state.anniversary.set_by !== partner.id}
                  celebration={celebration?.today_candidate ?? null}
                />
              )}

            {editingAnniversary && state.anniversary?.date && (
              <section className="card animate-fade-up rounded-[1.75rem] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-ink-900">ویرایش تاریخ شروع</h3>
                  <button
                    type="button"
                    onClick={() => setEditingAnniversary(false)}
                    className="rounded-lg px-2 py-1 text-[11px] font-bold text-ink-700 hover:text-ink-900"
                  >
                    بستن
                  </button>
                </div>
                <AnniversarySetup
                  compact
                  partnerName={partner.display_name}
                  initialDate={state.anniversary.date}
                  onDone={() => {
                    setEditingAnniversary(false)
                    void load()
                    setNotice('تاریخ آشنایی به‌روزرسانی شد.')
                  }}
                />
              </section>
            )}

            {/* The next time they will actually be together */}
            <ReunionCard
              reunion={state.reunion ?? null}
              partnerName={partner.display_name}
              onChanged={(next, message) => {
                setState((prev) => (prev ? { ...prev, reunion: next } : prev))
                setNotice(message)
              }}
            />

            <section className="card rounded-[1.75rem] p-5">
              <h3 className="text-[14px] font-extrabold text-ink-900">شما دو نفر</h3>
              <div className="mt-4 flex items-center justify-between gap-3">
                <PersonMini
                  name={profile?.display_name ?? 'تو'}
                  avatar={profile?.avatar_url}
                  birth={profile?.birth_date}
                  me
                />
                <div className="flex flex-col items-center gap-1 text-blush-400">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="animate-pulse-heart" aria-hidden="true">
                    <path
                      d="M12 20.5C7 16.9 3.5 13.6 3.5 10.2 3.5 7.4 5.7 5.2 8.4 5.2c1.6 0 3 .8 3.6 2.1.6-1.3 2-2.1 3.6-2.1 2.7 0 4.9 2.2 4.9 5 0 3.4-3.5 6.7-8.5 10.3z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="text-[10px] font-bold text-ink-700">وصل</span>
                </div>
                <PersonMini
                  name={partner.display_name ?? 'شریک'}
                  avatar={partner.avatar_url}
                  birth={partner.birth_date}
                />
              </div>
            </section>

            {state.incoming.length > 0 && (
              <RequestList
                title="درخواست‌های جدید"
                hint="تو الان وصل هستی؛ اگر درخواستی را قبول کنی، ارتباط فعلی قطع نمی‌شود مگر اول آن را قطع کنی."
                items={state.incoming}
                actionLabel="رد کردن"
                onAction={handleDecline}
                pendingId={busyId}
              />
            )}
          </>
        )}

        {/* ==== Not connected ==== */}
        {!hasPartner && (
          <>
            <PairingCodeCard code={state.pairing_code} displayName={profile?.display_name} />

            <RequestList
              title="درخواست‌های رسیده"
              hint="این‌ها کد تو را وارد کرده‌اند و منتظر پاسخ تو هستند."
              items={state.incoming}
              actionLabel="قبول می‌کنم"
              onAction={handleAccept}
              pendingId={busyId}
            />
            {state.incoming.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const first = state.incoming[0]
                  if (first) void handleDecline(first)
                }}
                className="-mt-2 w-full rounded-xl py-1.5 text-[11.5px] font-semibold text-ink-700 transition hover:text-red-500"
              >
                رد کردن جدیدترین درخواست
              </button>
            )}

            {hasOutgoing && (
              <RequestList
                title="درخواست‌های فرستاده‌شده"
                hint="منتظر تأیید این کاربران باش."
                items={state.outgoing}
                actionLabel="لغو"
                onAction={handleCancel}
                pendingId={busyId}
                variant="outgoing"
              />
            )}

            {!hasOutgoing && (
              <section className="card rounded-[1.75rem] p-5">
                <ConnectForm
                  ownCode={state.pairing_code}
                  onConnected={() => {
                    void load()
                    void refreshProfile()
                  }}
                  onSuccessMessage={(message) => setNotice(message)}
                />
              </section>
            )}

            {hasOutgoing && state.incoming.length === 0 && (
              <p className="text-center text-[11.5px] leading-5 text-ink-700">
                وقتی شریکت درخواستت را قبول کرد، همین‌جا می‌بینیش.
              </p>
            )}
          </>
        )}

        <InstallHint />

        {/* رودررو. Its own row, not a grid cell: the game is a place you go
            together, and it should not read as a settings shortcut. */}
        <Link
          to="/game"
          className="card flex items-center gap-3 rounded-[1.75rem] p-4 transition-shadow duration-200 hover:brightness-[1.03] active:brightness-95"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-lilac-700 to-lilac-900 text-white shadow-[6px_6px_14px_rgba(103,67,159,0.22),-6px_-6px_14px_rgba(255,255,255,0.85)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3.5"
                y="5"
                width="13"
                height="15"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.7"
                transform="rotate(-8 10 12)"
              />
              <rect
                x="8"
                y="4.5"
                width="12.5"
                height="15"
                rx="2.5"
                fill="currentColor"
                fillOpacity="0.18"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M11.5 10.5h5.5M11.5 13.5h3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-extrabold text-ink-900">رودررو</p>
            <p className="truncate text-[11px] text-ink-700">یک بازی برای دو نفر — سؤال‌ها از خودتون</p>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
            className="shrink-0 text-ink-700/55"
          >
            <path
              d="M15 6l-6 6 6 6"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>

        {/* Quick links */}
        <section className="grid grid-cols-2 gap-3 pt-1">
          <Link
            to="/settings"
            className="card flex items-center gap-2.5 rounded-[1.5rem] p-4 transition-shadow duration-200 hover:brightness-[1.03] active:brightness-95"
          >
            <span className="well flex h-9 w-9 items-center justify-center rounded-xl text-blush-800">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.7" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-[12.5px] font-bold text-ink-900">پروفایل من</p>
              <p className="text-[10.5px] text-ink-700">عکس، اسم و علاقه‌ها</p>
            </div>
          </Link>

          <Link
            to="/dates"
            className="card flex items-center gap-2.5 rounded-[1.5rem] p-4 transition-shadow duration-200 hover:brightness-[1.03] active:brightness-95"
          >
            <span className="well flex h-9 w-9 items-center justify-center rounded-xl text-lilac-700">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="4" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-[12.5px] font-bold text-ink-900">روزهای مهم</p>
              <p className="text-[10.5px] text-ink-700">سالگرد، ماهگرد، تولد</p>
            </div>
          </Link>
        </section>

        <p className="pt-2 text-center text-[10.5px] leading-5 text-ink-700">
          داده‌های پریود پیش‌فرض فقط برای خود صاحب حساب است؛ اشتراک‌گذاری فقط با اجازه‌ی
          خودش روشن می‌شود.
        </p>
      </main>
    </div>
  )
}

function PersonMini({
  name,
  avatar,
  birth,
  me = false,
}: {
  name: string
  avatar: string | null | undefined
  birth: string | null | undefined
  me?: boolean
}) {
  return (
    <div className="flex flex-1 flex-col items-center text-center">
      <Avatar src={avatar} name={name} size={56} ring />
      <p className="mt-2 max-w-full truncate text-[13px] font-bold text-ink-900">
        {name}
        {me && <span className="mr-1 text-[10px] font-medium text-ink-700">(تو)</span>}
      </p>
      {birth && <p className="text-[10.5px] text-ink-700">{formatJalaliLong(birth)}</p>}
    </div>
  )
}

/* ── the once-per-session celebration marker ────────────────────────────── */

const SEEN_KEY = 'kenaret.celebrated'

function readSeen(): Set<string> {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set()
  } catch {
    // Private mode, or a value someone else wrote. Either way: show it again.
    return new Set()
  }
}

function markSeen(next: CelebrationState) {
  const candidate = next.today_candidate
  if (!candidate) return
  try {
    const seen = readSeen()
    seen.add(`${candidate.kind}:${candidate.ordinal}:${next.today}`)
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]))
  } catch {
    // Storage being unavailable must not stop the navigation that follows.
  }
}
