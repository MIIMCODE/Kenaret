import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Avatar from '../components/Avatar'
import PairingCodeCard from '../components/PairingCodeCard'
import ConnectForm from '../components/ConnectForm'
import PartnerCard from '../components/PartnerCard'
import RequestList from '../components/RequestList'
import AnniversaryCard from '../components/AnniversaryCard'
import AnniversarySetup from '../components/AnniversarySetup'
import { FullPageLoader } from '../components/Spinner'
import { useAuth } from '../hooks/useAuth'
import {
  cancelRequest,
  fetchPairingState,
  respondToRequest,
  unlinkPartner,
} from '../lib/api'
import { toPersianError } from '../lib/errors'
import { formatJalaliLong } from '../lib/jalali'
import type { CoupleRequestSummary, PairingState } from '../types/database'

export default function DashboardPage() {
  const { profile, refreshProfile } = useAuth()
  const [state, setState] = useState<PairingState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingAnniversary, setEditingAnniversary] = useState(false)

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
      !confirm(
        'مطمئنی می‌خواهی ارتباط را قطع کنی؟ اطلاعات خصوصی هر کدام باقی می‌ماند، اما دیگر پروفایل هم را نمی‌بینید.',
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
        {/* Greeting */}
        <section className="animate-fade-up">
          <p className="text-[12px] font-semibold text-ink-500">سلام 👋</p>
          <h1 className="mt-0.5 text-[23px] font-extrabold leading-9 text-ink-900">
            {profile?.display_name ?? 'دوست من'}
            <span className="mr-2 text-[15px] font-medium text-ink-500">خوش اومدی</span>
          </h1>
        </section>

        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {/* ==== Connected ==== */}
        {hasPartner && partner && (
          <>
            <PartnerCard partner={partner} onUnlink={handleUnlink} />

            {/* Relationship start date: the heart of the couple dashboard */}
            {state.anniversary && state.anniversary.needs_answer && state.anniversary.is_your_turn && (
              <section className="card animate-fade-up p-5">
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
                <section className="card animate-fade-up p-5 text-center">
                  <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-blush-100 text-blush-500">
                    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.7" />
                      <path d="M12 7.6V12l3 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    </svg>
                  </span>
                  <h3 className="mt-2.5 text-[14px] font-extrabold text-ink-900">منتظر تاریخ آشنایی</h3>
                  <p className="mx-auto mt-1 max-w-[19rem] text-[11.5px] leading-6 text-ink-500">
                    این سؤال را برای {partner.display_name ?? 'شریکت'} فرستادیم. همین‌که تاریخ را ثبت کند،
                    شمارنده‌ی «با هم بودن» و روزهای مهم برای هر دویتان فعال می‌شود.
                  </p>
                  <p className="mt-2 text-[10.5px] text-ink-500">
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
                />
              )}

            {editingAnniversary && state.anniversary?.date && (
              <section className="card animate-fade-up p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[14px] font-extrabold text-ink-900">ویرایش تاریخ شروع</h3>
                  <button
                    type="button"
                    onClick={() => setEditingAnniversary(false)}
                    className="rounded-lg px-2 py-1 text-[11px] font-bold text-ink-500 hover:text-ink-700"
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

            <section className="card p-5">
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
                  <span className="text-[10px] font-bold text-ink-500">وصل</span>
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
                className="-mt-2 w-full rounded-xl py-1.5 text-[11.5px] font-semibold text-ink-500 transition hover:text-red-500"
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
              <section className="card p-5">
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
              <p className="text-center text-[11.5px] leading-5 text-ink-500">
                وقتی شریکت درخواستت را قبول کرد، همین‌جا می‌بینیش.
              </p>
            )}
          </>
        )}

        {/* Quick links */}
        <section className="grid grid-cols-2 gap-3 pt-1">
          <Link to="/settings" className="card flex items-center gap-2.5 p-4 transition hover:shadow-soft">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blush-100 text-blush-600">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.7" />
                <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-[12.5px] font-bold text-ink-900">پروفایل من</p>
              <p className="text-[10.5px] text-ink-500">عکس، اسم و علاقه‌ها</p>
            </div>
          </Link>

          <div className="card flex items-center gap-2.5 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lilac-100 text-lilac-500">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3.5" y="5" width="17" height="15" rx="4" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 3v4M16 3v4M3.5 10h17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="text-[12.5px] font-bold text-ink-900">روزهای مهم</p>
              <p className="text-[10.5px] text-ink-500">به‌زودی</p>
            </div>
          </div>
        </section>

        <p className="pt-2 text-center text-[10.5px] leading-5 text-ink-500">
          داده‌های پریود فقط برای خود صاحب حساب قابل مشاهده است.
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
        {me && <span className="mr-1 text-[10px] font-medium text-ink-500">(تو)</span>}
      </p>
      {birth && <p className="text-[10.5px] text-ink-500">{formatJalaliLong(birth)}</p>}
    </div>
  )
}
