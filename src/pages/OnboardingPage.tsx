import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import ProgressBar from '../components/ProgressBar'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import GenderStep from '../components/onboarding/GenderStep'
import IdentityStep from '../components/onboarding/IdentityStep'
import PeriodStep, { type PeriodDraft } from '../components/onboarding/PeriodStep'
import InterestsStep from '../components/onboarding/InterestsStep'
import AvatarStep from '../components/onboarding/AvatarStep'
import JalaliDatePicker from '../components/JalaliDatePicker'
import { useAuth } from '../hooks/useAuth'
import {
  fetchPeriodSettings,
  savePeriodSettings,
  updateProfile,
  type ProfilePatch,
} from '../lib/api'
import { uploadAvatar } from '../lib/avatars'
import { toPersianError } from '../lib/errors'
import { daysBetweenIso, isoToJalali, todayIso } from '../lib/jalali'
import type { Gender } from '../types/database'

/**
 * Step map
 *  1. gender (always)
 *  2. identity: name + birth date (always)
 *  3. period: girls only — skipped for boys
 *  4. interests
 *  5. avatar
 *
 * Each step persists immediately, and `profiles.onboarding_step` records where
 * the user stopped so the form can resume after a refresh or on another device.
 */

type StepKey = 'gender' | 'identity' | 'period' | 'interests' | 'avatar'

interface Draft {
  gender: Gender | null
  displayName: string
  birthDate: string | null
  interests: string[]
  avatarUrl: string | null
  period: PeriodDraft
}

const EMPTY_DRAFT: Draft = {
  gender: null,
  displayName: '',
  birthDate: null,
  interests: [],
  avatarUrl: null,
  period: { lastPeriodStart: null, cycleLength: 28, periodLength: 5, isRegular: true },
}

export default function OnboardingPage() {
  const navigate = useNavigate()
  const { user, profile, profileLoading, refreshProfile } = useAuth()

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [stepIndex, setStepIndex] = useState(0)
  const [hydrated, setHydrated] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; birthDate?: string; lastPeriodStart?: string }>({})

  const [showCycleSetup, setShowCycleSetup] = useState(false)

  // ---------------------------------------------------------------
  // Which steps apply to this user?
  // ---------------------------------------------------------------
  const steps: StepKey[] = useMemo(() => {
    const list: StepKey[] = ['gender', 'identity']
    if (draft.gender === 'girl') list.push('period')
    list.push('interests', 'avatar')
    return list
  }, [draft.gender])

  const currentStep = steps[Math.min(stepIndex, steps.length - 1)]
  const isLast = stepIndex >= steps.length - 1

  // ---------------------------------------------------------------
  // Hydrate from the saved profile so the user can resume.
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!profile || hydrated) return
    let cancelled = false

    void (async () => {
      const nextDraft: Draft = {
        gender: profile.gender,
        displayName: profile.display_name ?? '',
        birthDate: profile.birth_date,
        interests: profile.interests ?? [],
        avatarUrl: profile.avatar_url,
        period: EMPTY_DRAFT.period,
      }

      if (profile.gender === 'girl') {
        const saved = await fetchPeriodSettings(profile.id).catch(() => null)
        if (saved) {
          nextDraft.period = {
            lastPeriodStart: saved.last_period_start,
            cycleLength: saved.cycle_length,
            periodLength: saved.period_length,
            isRegular: saved.is_regular,
          }
        }
      }

      if (cancelled) return
      setDraft(nextDraft)

      // Resume at the saved step (0-based, clamped to the visible steps).
      const resumeIndex = Math.min(Math.max(profile.onboarding_step - 1, 0), steps.length - 1)
      setStepIndex(resumeIndex)
      setHydrated(true)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, hydrated])

  // Keep the index valid when the step list changes (e.g. gender -> girl adds a step).
  useEffect(() => {
    if (stepIndex > steps.length - 1) setStepIndex(steps.length - 1)
  }, [steps.length, stepIndex])

  if (!user) return null
  if (profileLoading && !hydrated) return <LoadingShell />

  // ---------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------
  async function persist(patch: ProfilePatch, nextStepNumber: number) {
    const updated = await updateProfile(user!.id, { ...patch, onboarding_step: nextStepNumber })
    return updated
  }

  async function persistPeriod(period: PeriodDraft) {
    if (!period.lastPeriodStart) return
    await savePeriodSettings(user!.id, {
      last_period_start: period.lastPeriodStart,
      cycle_length: clamp(period.cycleLength, 15, 60),
      period_length: clamp(period.periodLength, 1, 15),
      is_regular: period.isRegular,
    })
  }

  // ---------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------
  function validateCurrentStep(): boolean {
    const errors: typeof fieldErrors = {}

    if (currentStep === 'gender') {
      if (!draft.gender) {
        setError('اول بگو دختری یا پسر، تا فرم را برایت آماده کنیم.')
        return false
      }
    }

    if (currentStep === 'identity') {
      const name = draft.displayName.trim()
      if (name.length < 2) errors.name = 'اسمت باید حداقل ۲ حرف باشد.'
      if (name.length > 40) errors.name = 'اسمت خیلی بلنده؛ حداکثر ۴۰ حرف.'

      if (!draft.birthDate) {
        errors.birthDate = 'تاریخ تولدت را انتخاب کن.'
      } else {
        const j = isoToJalali(draft.birthDate)
        const age = Math.floor(daysBetweenIso(draft.birthDate, todayIso()) / 365.25)
        if (!j) errors.birthDate = 'این تاریخ معتبر نیست.'
        else if (age < 13) errors.birthDate = 'برای استفاده از کنارت باید حداقل ۱۳ سال داشته باشی.'
        else if (age > 100) errors.birthDate = 'تاریخ تولد را دوباره بررسی کن.'
      }
    }

    if (currentStep === 'period') {
      if (!draft.period.lastPeriodStart) {
        errors.lastPeriodStart = 'اولین روز آخرین پریودت را انتخاب کن.'
      } else if (draft.period.lastPeriodStart > todayIso()) {
        errors.lastPeriodStart = 'این تاریخ نمی‌تواند در آینده باشد.'
      }
    }

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return false
    return true
  }

  // ---------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------
  async function handleNext() {
    if (saving) return
    setError(null)

    if (!validateCurrentStep()) return

    setSaving(true)
    try {
      const nextIndex = stepIndex + 1
      const nextStepNumber = Math.min(nextIndex + 1, 5)

      if (currentStep === 'gender') {
        await persist({ gender: draft.gender! }, nextStepNumber)
      } else if (currentStep === 'identity') {
        await persist(
          { display_name: draft.displayName.trim(), birth_date: draft.birthDate! },
          nextStepNumber,
        )
      } else if (currentStep === 'period') {
        await persistPeriod(draft.period)
        await persist({}, nextStepNumber)
      } else if (currentStep === 'interests') {
        await persist({ interests: draft.interests }, nextStepNumber)
      } else if (currentStep === 'avatar') {
        await finish()
        return
      }

      await refreshProfile()
      setStepIndex(nextIndex)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (saveError) {
      setError(toPersianError(saveError, 'ذخیره نشد. اتصالت را بررسی کن و دوباره بزن.'))
    } finally {
      setSaving(false)
    }
  }

  async function finish() {
    // Girls who skipped the cycle step can still add it from the dashboard.
    await persist(
      {
        display_name: draft.displayName.trim(),
        birth_date: draft.birthDate!,
        gender: draft.gender!,
        interests: draft.interests,
        avatar_url: draft.avatarUrl,
        onboarding_completed: true,
        onboarding_step: 5,
      },
      5,
    )
    await refreshProfile()
    navigate('/app', { replace: true })
  }

  function goBack() {
    if (stepIndex === 0) return
    setError(null)
    setFieldErrors({})
    setStepIndex((index) => Math.max(0, index - 1))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // A girl may legitimately skip the period step if she has no data at hand.
  async function skipPeriod() {
    if (saving) return
    setSaving(true)
    try {
      await persist({}, Math.min(stepIndex + 2, 5))
      await refreshProfile()
      setStepIndex((index) => index + 1)
    } catch (skipError) {
      setError(toPersianError(skipError))
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  return (
    <div className="min-h-dvh pb-10">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-5 pt-5">
        <Logo withWordmark={false} />
        <span className="text-[12px] font-semibold text-ink-500">
          سلام {draft.displayName.trim() ? draft.displayName.trim() : '👋'}
        </span>
      </header>

      <main className="mx-auto w-full max-w-md px-5 pt-4">
        <ProgressBar
          step={stepIndex + 1}
          total={steps.length}
          labels={['جنسیت', 'خودت را معرفی کن', 'پریود', 'علاقه‌مندی‌ها', 'عکس پروفایل']}
        />

        <div key={currentStep} className="mt-6 animate-fade-up">
          <h1 className="text-[19px] font-extrabold leading-8 text-ink-900">{STEP_TITLES[currentStep].title}</h1>
          {STEP_TITLES[currentStep].subtitle && (
            <p className="mt-1.5 mb-5 text-[13px] leading-6 text-ink-500">
              {STEP_TITLES[currentStep].subtitle}
            </p>
          )}

          {currentStep === 'gender' && (
            <GenderStep
              value={draft.gender}
              onChange={(gender) => {
                setError(null)
                setDraft((current) => ({ ...current, gender }))
              }}
            />
          )}

          {currentStep === 'identity' && (
            <IdentityStep
              name={draft.displayName}
              birthDate={draft.birthDate}
              onNameChange={(displayName) =>
                setDraft((current) => ({ ...current, displayName }))
              }
              onBirthDateChange={(birthDate) => setDraft((current) => ({ ...current, birthDate }))}
              errors={fieldErrors}
            />
          )}

          {currentStep === 'period' && (
            <PeriodStep
              value={draft.period}
              onChange={(patch) =>
                setDraft((current) => ({ ...current, period: { ...current.period, ...patch } }))
              }
              errors={fieldErrors}
            />
          )}

          {currentStep === 'interests' && (
            <InterestsStep
              selected={draft.interests}
              onChange={(interests) => setDraft((current) => ({ ...current, interests }))}
            />
          )}

          {currentStep === 'avatar' && (
            <AvatarStep
              value={draft.avatarUrl}
              displayName={draft.displayName}
              onUpload={async (file) => {
                const reference = await uploadAvatar(user.id, file)
                // Persist immediately so a refresh doesn't lose the upload.
                await updateProfile(user.id, { avatar_url: reference })
                await refreshProfile()
                return reference
              }}
              onChange={(avatarUrl) => setDraft((current) => ({ ...current, avatarUrl }))}
            />
          )}
        </div>

        {error && <Alert tone="error" className="mt-5">{error}</Alert>}

        {/* Actions */}
        <div className="mt-7 flex items-center gap-3">
          {stepIndex > 0 && (
            <button type="button" onClick={goBack} disabled={saving} className="btn-ghost flex-1">
              قبلی
            </button>
          )}

          {currentStep === 'period' && (
            <button type="button" onClick={skipPeriod} disabled={saving} className="btn-ghost flex-1">
              بعداً
            </button>
          )}

          <button
            type="button"
            onClick={handleNext}
            disabled={saving}
            className="btn-primary flex-[1.6]"
          >
            {saving ? <Spinner className="h-4 w-4" /> : null}
            {saving ? 'در حال ذخیره...' : isLast ? 'پایان و ورود به کنارت' : 'بعدی'}
          </button>
        </div>

        <p className="mt-4 text-center text-[11px] leading-5 text-ink-500">
          هر قدم ذخیره می‌شود؛ اگر وسط کار بیرون بروی، از همان‌جا ادامه می‌دهی.
        </p>

        {/* Optional cycle setup for girls who skipped it */}
        {currentStep === 'avatar' && draft.gender === 'girl' && !draft.period.lastPeriodStart && (
          <div className="mt-6 card p-4">
            <button
              type="button"
              onClick={() => setShowCycleSetup((value) => !value)}
              className="flex w-full items-center justify-between text-right"
            >
              <span className="text-[13.5px] font-bold text-ink-900">
                اطلاعات پریودت را بعداً وارد می‌کنی؟
              </span>
              <span className="text-[12px] font-bold text-blush-600">
                {showCycleSetup ? 'بستن' : 'همین حالا وارد کن'}
              </span>
            </button>

            {showCycleSetup && (
              <div className="mt-4 animate-fade-up">
                <JalaliDatePicker
                  label="اولین روز آخرین پریودت"
                  value={draft.period.lastPeriodStart}
                  maxIso={todayIso()}
                  onChange={(iso) =>
                    setDraft((current) => ({
                      ...current,
                      period: { ...current.period, lastPeriodStart: iso },
                    }))
                  }
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!draft.period.lastPeriodStart) {
                      setError('اول تاریخ را انتخاب کن.')
                      return
                    }
                    setSaving(true)
                    try {
                      await persistPeriod(draft.period)
                      await refreshProfile()
                      setShowCycleSetup(false)
                      setError(null)
                    } catch (periodError) {
                      setError(toPersianError(periodError))
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className="btn-soft mt-3 w-full"
                >
                  ذخیره‌ی اطلاعات پریود
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

const STEP_TITLES: Record<StepKey, { title: string; subtitle?: string }> = {
  gender: {
    title: 'خودت را معرفی کن',
    subtitle: 'با این کار تجربه‌ی کنارت را برایت شخصی می‌کنیم.',
  },
  identity: {
    title: 'کمی از خودت بگو',
    subtitle: 'اسم و تاریخ تولدت را وارد کن؛ شریکت این‌ها را می‌بیند.',
  },
  period: {
    title: 'پیش‌بینی پریود',
    subtitle: 'چند عدد ساده، تا کنارت بتواند روزهای ماهت را برایت یادآوری کند.',
  },
  interests: {
    title: 'چه چیزهایی دوست داری؟',
    subtitle: 'علاقه‌مندی‌هایت به شریکت کمک می‌کند بهانه‌ی حرف زدن پیدا کند.',
  },
  avatar: {
    title: 'عکس پروفایلت',
    subtitle: 'یک عکس از گالری یا یکی از آواتارهای آماده انتخاب کن.',
  },
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

function LoadingShell() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <Spinner className="h-7 w-7 text-blush-500" />
      <p className="text-[13px] text-ink-500">داریم فرمت را آماده می‌کنیم...</p>
    </div>
  )
}
