import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Avatar from '../components/Avatar'
import Spinner from '../components/Spinner'
import JalaliDatePicker from '../components/JalaliDatePicker'
import AnniversaryCard from '../components/AnniversaryCard'
import AnniversarySetup from '../components/AnniversarySetup'
import CycleShareSettings from '../components/CycleShareSettings'
import ReminderSettings from '../components/ReminderSettings'
import PushSettings from '../components/PushSettings'
import { useAuth } from '../hooks/useAuth'
import { fetchPairingState, fetchPeriodSettings, savePeriodSettings, updateProfile } from '../lib/api'
import { validateAvatarFile, uploadAvatar } from '../lib/avatars'
import { toPersianError } from '../lib/errors'
import { formatJalaliLong, todayIso } from '../lib/jalali'
import { INTEREST_OPTIONS, MAX_INTERESTS } from '../lib/constants'
import type { AnniversaryState, PeriodSettings } from '../types/database'

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile, signOut } = useAuth()

  const [name, setName] = useState('')
  const [birthDate, setBirthDate] = useState<string | null>(null)
  const [interests, setInterests] = useState<string[]>([])
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMessage, setProfileMessage] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [period, setPeriod] = useState<PeriodSettings | null>(null)
  const [periodLoading, setPeriodLoading] = useState(false)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [periodMessage, setPeriodMessage] = useState<string | null>(null)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [cycleLength, setCycleLength] = useState(28)
  const [periodLength, setPeriodLength] = useState(5)
  const [isRegular, setIsRegular] = useState(true)
  const [lastPeriodStart, setLastPeriodStart] = useState<string | null>(null)

  const [anniversary, setAnniversary] = useState<AnniversaryState | null>(null)
  const [partnerName, setPartnerName] = useState<string | null>(null)
  const [partnerId, setPartnerId] = useState<string | null>(null)
  const [editingAnniversary, setEditingAnniversary] = useState(false)
  const [anniversaryNotice, setAnniversaryNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    setName(profile.display_name ?? '')
    setBirthDate(profile.birth_date)
    setInterests(profile.interests ?? [])
  }, [profile])

  const loadAnniversary = useCallback(async () => {
    try {
      const state = await fetchPairingState()
      setAnniversary(state.anniversary ?? null)
      setPartnerName(state.partner?.display_name ?? null)
      setPartnerId(state.partner?.id ?? null)
    } catch {
      // Settings stays usable even if the couple state cannot be read.
      setAnniversary(null)
    }
  }, [])

  useEffect(() => {
    void loadAnniversary()
  }, [loadAnniversary])

  useEffect(() => {
    if (!profile || profile.gender !== 'girl' || !user) return
    let active = true
    setPeriodLoading(true)
    fetchPeriodSettings(user.id)
      .then((data) => {
        if (!active) return
        setPeriod(data)
        if (data) {
          setCycleLength(data.cycle_length)
          setPeriodLength(data.period_length)
          setIsRegular(data.is_regular)
          setLastPeriodStart(data.last_period_start)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPeriodLoading(false)
      })
    return () => {
      active = false
    }
  }, [profile, user])

  if (!user || !profile) return null

  async function saveProfile() {
    if (savingProfile) return
    setProfileMessage(null)
    setProfileError(null)

    const trimmed = name.trim()
    if (trimmed.length < 2) return setProfileError('اسمت باید حداقل ۲ حرف باشد.')
    if (!birthDate) return setProfileError('تاریخ تولدت را انتخاب کن.')

    setSavingProfile(true)
    try {
      await updateProfile(user!.id, {
        display_name: trimmed,
        birth_date: birthDate,
        interests,
      })
      await refreshProfile()
      setProfileMessage('پروفایلت ذخیره شد ✨')
      setTimeout(() => setProfileMessage(null), 3000)
    } catch (saveError) {
      setProfileError(toPersianError(saveError, 'ذخیره نشد. دوباره تلاش کن.'))
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = validateAvatarFile(file)
    if (validationError) return setAvatarError(validationError)

    setAvatarError(null)
    setUploading(true)
    try {
      const reference = await uploadAvatar(user!.id, file)
      await updateProfile(user!.id, { avatar_url: reference })
      await refreshProfile()
    } catch (uploadError) {
      setAvatarError(toPersianError(uploadError, 'آپلود عکس انجام نشد.'))
    } finally {
      setUploading(false)
    }
  }

  async function savePeriod() {
    if (periodSaving) return
    if (!lastPeriodStart) return setPeriodError('اولین روز آخرین پریودت را انتخاب کن.')

    setPeriodSaving(true)
    setPeriodError(null)
    setPeriodMessage(null)
    try {
      await savePeriodSettings(user!.id, {
        last_period_start: lastPeriodStart,
        cycle_length: clamp(cycleLength, 15, 60),
        period_length: clamp(periodLength, 1, 15),
        is_regular: isRegular,
      })
      const fresh = await fetchPeriodSettings(user!.id)
      setPeriod(fresh)
      setPeriodMessage('اطلاعات پریود ذخیره شد.')
      setTimeout(() => setPeriodMessage(null), 3000)
    } catch (saveError) {
      setPeriodError(toPersianError(saveError, 'ذخیره نشد. دوباره تلاش کن.'))
    } finally {
      setPeriodSaving(false)
    }
  }

  function toggleInterest(tag: string) {
    setInterests((current) => {
      if (current.includes(tag)) return current.filter((item) => item !== tag)
      if (current.length >= MAX_INTERESTS) return current
      return [...current, tag]
    })
  }

  const customInterests = interests.filter(
    (tag) => !(INTEREST_OPTIONS as readonly string[]).includes(tag),
  )

  return (
    <div className="min-h-dvh">
      <AppHeader />

      <main className="page space-y-4">
        <div className="flex items-center gap-2">
          <Link
            to="/app"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-blush-600"
            aria-label="بازگشت"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <h1 className="text-[19px] font-extrabold text-ink-900">تنظیمات</h1>
        </div>

        {/* ---------- Profile ---------- */}
        <section className="card p-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Avatar src={profile.avatar_url} name={profile.display_name} size={72} ring />
              {uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
                  <Spinner className="h-5 w-5 text-blush-500" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-extrabold text-ink-900">{profile.display_name ?? 'بی‌نام'}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-500">
                {profile.gender === 'girl' ? 'دختر' : profile.gender === 'boy' ? 'پسر' : '—'}
                {' • '}
                عضو از {formatJalaliLong(profile.created_at.slice(0, 10))}
              </p>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="mt-2 rounded-xl bg-blush-50 px-3 py-1.5 text-[11.5px] font-bold text-blush-700 transition hover:bg-blush-100"
              >
                تغییر عکس پروفایل
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleAvatar}
              />
            </div>
          </div>
          {avatarError && <Alert tone="error" className="mt-3">{avatarError}</Alert>}
        </section>

        {/* ---------- Relationship start date ---------- */}
        {anniversary && (
          <section className="card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-extrabold text-ink-900">تاریخ آشنایی</h2>
              {anniversary.date && !editingAnniversary && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingAnniversary(true)
                    setAnniversaryNotice(null)
                  }}
                  className="rounded-xl bg-blush-50 px-3 py-1.5 text-[11px] font-bold text-blush-700 transition hover:bg-blush-100"
                >
                  تغییر تاریخ
                </button>
              )}
            </div>

            {anniversaryNotice && <Alert tone="success">{anniversaryNotice}</Alert>}

            {editingAnniversary || !anniversary.date ? (
              <AnniversarySetup
                compact
                partnerName={partnerName}
                initialDate={anniversary.date}
                onDone={(result) => {
                  setEditingAnniversary(false)
                  setAnniversaryNotice(
                    result === 'saved'
                      ? 'تاریخ آشنایی ذخیره شد.'
                      : `سؤال برای ${partnerName ?? 'شریکت'} فرستاده شد.`,
                  )
                  void loadAnniversary()
                }}
                onSkip={anniversary.date ? () => setEditingAnniversary(false) : undefined}
              />
            ) : (
              <AnniversaryCard
                date={anniversary.date}
                setByName={partnerName}
                isMine={anniversary.set_by !== null && anniversary.set_by !== partnerId}
              />
            )}
          </section>
        )}

        {/* ---------- Editable profile ---------- */}
        <section className="card space-y-4 p-5">
          <h2 className="text-[14px] font-extrabold text-ink-900">اطلاعات من</h2>

          <div>
            <label className="label" htmlFor="settings-name">
              اسم
            </label>
            <input
              id="settings-name"
              className="field"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <JalaliDatePicker
            id="settings-birth"
            label="تاریخ تولد (شمسی)"
            value={birthDate}
            onChange={setBirthDate}
            maxIso={todayIso()}
            minIso="1930-01-01"
            defaultYear={1380}
          />

          <div>
            <p className="label">علاقه‌مندی‌ها</p>
            <div className="flex flex-wrap gap-2">
              {INTEREST_OPTIONS.map((tag) => {
                const active = interests.includes(tag)
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleInterest(tag)}
                    aria-pressed={active}
                    disabled={!active && interests.length >= MAX_INTERESTS}
                    className={`chip ${active ? 'chip-active' : ''} ${
                      !active && interests.length >= MAX_INTERESTS ? 'cursor-not-allowed opacity-40' : ''
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
              {customInterests.map((tag) => (
                <button key={tag} type="button" onClick={() => toggleInterest(tag)} className="chip chip-active">
                  {tag} <span className="mr-1 text-[11px] opacity-80">×</span>
                </button>
              ))}
            </div>
          </div>

          {profileError && <Alert tone="error">{profileError}</Alert>}
          {profileMessage && <Alert tone="success">{profileMessage}</Alert>}

          <button type="button" onClick={saveProfile} disabled={savingProfile} className="btn-primary w-full">
            {savingProfile ? <Spinner className="h-4 w-4" /> : null}
            {savingProfile ? 'در حال ذخیره...' : 'ذخیره‌ی تغییرات'}
          </button>
        </section>

        {/* ---------- Period (girls only) ---------- */}
        {profile.gender === 'girl' && (
          <section className="card space-y-4 p-5">
            <div>
              <h2 className="text-[14px] font-extrabold text-ink-900">پیش‌بینی پریود</h2>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-500">
                🔒 این اطلاعات فقط برای خودت قابل مشاهده است.
              </p>
            </div>

            {periodLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-ink-500">
                <Spinner className="h-4 w-4 text-blush-400" /> در حال بارگذاری...
              </div>
            ) : (
              <>
                <JalaliDatePicker
                  id="settings-period"
                  label="اولین روز آخرین پریودت"
                  value={lastPeriodStart}
                  onChange={setLastPeriodStart}
                  maxIso={todayIso()}
                />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="settings-cycle">
                      طول چرخه
                    </label>
                    <input
                      id="settings-cycle"
                      type="number"
                      inputMode="numeric"
                      min={15}
                      max={60}
                      className="field"
                      value={cycleLength}
                      onChange={(event) => setCycleLength(Number(event.target.value))}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="settings-period-length">
                      طول پریود
                    </label>
                    <input
                      id="settings-period-length"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={15}
                      className="field"
                      value={periodLength}
                      onChange={(event) => setPeriodLength(Number(event.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <p className="label">چرخه‌ات منظم است؟</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'منظم', value: true },
                      { label: 'نامنظم', value: false },
                    ].map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => setIsRegular(option.value)}
                        aria-pressed={isRegular === option.value}
                        className={`rounded-2xl border px-3 py-2.5 text-[12.5px] font-bold transition ${
                          isRegular === option.value
                            ? 'border-blush-400 bg-blush-500 text-white'
                            : 'border-blush-200 bg-white text-ink-700'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {periodError && <Alert tone="error">{periodError}</Alert>}
                {periodMessage && <Alert tone="success">{periodMessage}</Alert>}

                <button
                  type="button"
                  onClick={savePeriod}
                  disabled={periodSaving}
                  className="btn-soft w-full"
                >
                  {periodSaving ? <Spinner className="h-4 w-4" /> : null}
                  {period ? 'به‌روزرسانی اطلاعات پریود' : 'ذخیره‌ی اطلاعات پریود'}
                </button>

                <p className="text-[11px] leading-5 text-ink-500">
                  روزهای بعدی از همین اعداد تخمین زده می‌شوند؛ در صفحه‌ی «روزهای مهم» می‌بینی‌شان.
                </p>

                <CycleShareSettings hasCycle={Boolean(period)} />
              </>
            )}
          </section>
        )}

<ReminderSettings isGirl={profile.gender === 'girl'} />

        {/* ---------- Notifications on the phone ---------- */}
        <PushSettings />

        {/* ---------- Account ---------- */}
        <section className="card space-y-3 p-5">
          <h2 className="text-[14px] font-extrabold text-ink-900">حساب</h2>
          <div className="rounded-2xl bg-blush-50 px-4 py-3">
            <p className="text-[11px] text-ink-500">ایمیل</p>
            <p dir="ltr" className="mt-0.5 text-left text-[12.5px] font-bold text-ink-900">
              {user.email}
            </p>
          </div>

          <Link to="/forgot-password" className="btn-ghost w-full !py-2.5 text-[12.5px]">
            تغییر رمز عبور
          </Link>

          <button
            type="button"
            onClick={() => {
              if (confirm('از حسابت خارج می‌شوی؟')) {
                void signOut().then(() => navigate('/', { replace: true }))
              }
            }}
            className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] font-bold text-red-600 transition hover:bg-red-100"
          >
            خروج از حساب
          </button>
        </section>

        <p className="pb-4 text-center text-[10.5px] leading-5 text-ink-500">
          کنارت • نسخه ۱.۰
        </p>
      </main>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}
