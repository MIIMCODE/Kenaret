import { useEffect, useState } from 'react'
import JalaliDatePicker from './JalaliDatePicker'
import { clearReunion, saveReunion } from '../lib/api'
import { defaultReunionDate, reunionView } from '../lib/reunion'
import { daysBetweenIso, todayIso, toPersianDigits } from '../lib/jalali'
import { toPersianError } from '../lib/errors'
import type { ReunionState } from '../types/database'

interface Props {
  reunion: ReunionState | null
  /** Called after a successful save/clear so the dashboard can refetch. */
  onChanged: (next: ReunionState | null, message: string) => void
  partnerName?: string | null
}

/**
 * The next reunion: a countdown, or an invitation to set one.
 *
 * Distance is the hardest part of these relationships, and a couple that is
 * apart usually *does* know the next date — they just have no shared place to
 * keep it. The countdown is the point: it should shrink every morning.
 *
 * Either partner may set or clear it, because either one may be the first to
 * know. There is deliberately no "requested by / confirm" dance.
 */
export default function ReunionCard({ reunion, onChanged, partnerName }: Props) {
  const [editing, setEditing] = useState(false)
  const [draftDate, setDraftDate] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = todayIso()
  const view = reunion ? reunionView(reunion.meet_on, today) : null

  useEffect(() => {
    if (!editing) return
    setDraftDate(reunion && reunion.meet_on >= today ? reunion.meet_on : defaultReunionDate(today))
    setDraftNote(reunion?.note ?? '')
    setError(null)
  }, [editing, reunion, today])

  async function handleSave() {
    if (!draftDate) {
      setError('اول تاریخ را انتخاب کن.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await saveReunion(draftDate, draftNote)
      setEditing(false)
      const days = daysBetweenIso(today, saved.meet_on)
      onChanged(
        saved,
        days === 0
          ? 'ثبت شد — امروز میبینیش 🤍'
          : `ثبت شد؛ ${toPersianDigits(days)} روز تا دیدارتون.`,
      )
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleClear() {
    setBusy(true)
    setError(null)
    try {
      await clearReunion()
      setEditing(false)
      onChanged(null, 'شمارنده برداشته شد.')
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(false)
    }
  }

  // ------------------------------------------------ nothing set yet
  if (!reunion || !view) {
    if (!editing) {
      return (
        <section className="card animate-fade-up rounded-[1.75rem] p-5">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-lilac-100 text-lilac-700"
              aria-hidden="true"
            >
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 7.5h16M8 4v3.5M16 4v3.5M5.6 7.5h12.8A1.6 1.6 0 0 1 20 9.1v9.3a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V9.1a1.6 1.6 0 0 1 1.6-1.6z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M12 12.2c-.8-1.3-2.6-1.3-3.2 0-.5 1 .2 2.1 3.2 4.1 3-2 3.7-3.1 3.2-4.1-.6-1.3-2.4-1.3-3.2 0z"
                  fill="currentColor"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-extrabold text-ink-900">دیدار بعدی کِیه؟</h3>
              <p className="mt-1 text-[11.5px] leading-6 text-ink-700">
                تاریخش را بگذار تا از همین حالا روزها را با هم بشماریم
                {partnerName ? ` — ${partnerName} هم می‌بیندش` : ''}.
              </p>
              <button type="button" onClick={() => setEditing(true)} className="btn-ghost mt-3 w-full">
                ثبت تاریخ دیدار
              </button>
            </div>
          </div>
        </section>
      )
    }
    return (
      <section className="card animate-fade-up rounded-[1.75rem] p-5">
        <Editor
          draftDate={draftDate}
          setDraftDate={setDraftDate}
          draftNote={draftNote}
          setDraftNote={setDraftNote}
          busy={busy}
          error={error}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
          canClear={false}
          onClear={handleClear}
        />
      </section>
    )
  }

  // ------------------------------------------------ editing an existing one
  if (editing) {
    return (
      <section className="card animate-fade-up rounded-[1.75rem] p-5">
        <Editor
          draftDate={draftDate}
          setDraftDate={setDraftDate}
          draftNote={draftNote}
          setDraftNote={setDraftNote}
          busy={busy}
          error={error}
          onCancel={() => setEditing(false)}
          onSave={handleSave}
          canClear
          onClear={handleClear}
        />
      </section>
    )
  }

  // ------------------------------------------------ the countdown
  const isPast = !view.upcoming
  const isNear = view.days <= 1

  return (
    <section className="card relative animate-fade-up overflow-hidden rounded-[1.75rem] p-5">
      {/* The two blobs are behind the content and clipped by the card, which
          is what keeps the countdown from looking like plain text on paper. */}
      <span className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-blush-200/50 blur-2xl" />
      <span className="pointer-events-none absolute -bottom-12 -left-8 h-28 w-28 rounded-full bg-lilac-300/40 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold text-ink-700">
            {isPast ? 'دیدار گذشته' : view.lead}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="tile shrink-0 rounded-xl px-2.5 py-1.5 text-[10.5px] font-bold text-blush-800 transition hover:brightness-[1.03]"
          >
            {isPast ? 'تاریخ تازه' : 'ویرایش'}
          </button>
        </div>

        <div className="mt-2 flex items-end gap-2">
          <span
            className={`text-[40px] font-extrabold leading-none ${
              isNear ? 'text-blush-800' : 'text-ink-900'
            }`}
          >
            {view.count}
          </span>
          <span className="mb-1.5 text-[13px] font-bold text-ink-700">{view.unit}</span>
        </div>

        <p className="mt-2 text-[12px] font-semibold text-ink-700">
          {view.weekday}
          <span className="mx-1.5 text-blush-800">•</span>
          {view.dateLabel}
        </p>

        {reunion.note && (
          <p className="well mt-2.5 rounded-2xl px-3 py-2 text-[11.5px] leading-6 text-ink-700">
            {reunion.note}
          </p>
        )}

        {isNear && view.upcoming && (
          <p className="well mt-3 rounded-2xl px-3 py-2 text-center text-[11.5px] font-bold text-blush-800">
            {view.days === 0 ? '🤍 امروز، بالاخره' : '🤍 فردا همین موقع کنار همید'}
          </p>
        )}

        {isPast && (
          <p className="well mt-3 rounded-2xl px-3 py-2 text-center text-[11px] font-semibold text-ink-700">
            این تاریخ گذشت. برای دیدار بعدی یک تاریخ تازه بگذار.
          </p>
        )}

        <p className="mt-3 text-[10px] leading-5 text-ink-700">
          یک روز قبلش، هم این‌جا و هم با ایمیل خبردار می‌شوید.
        </p>
      </div>
    </section>
  )
}

function Editor({
  draftDate,
  setDraftDate,
  draftNote,
  setDraftNote,
  busy,
  error,
  onCancel,
  onSave,
  canClear,
  onClear,
}: {
  draftDate: string | null
  setDraftDate: (iso: string) => void
  draftNote: string
  setDraftNote: (value: string) => void
  busy: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
  canClear: boolean
  onClear: () => void
}) {
  return (
    <div className="animate-fade-up">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-extrabold text-ink-900">تاریخ دیدار</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-2 py-1 text-[11px] font-bold text-ink-700 hover:text-ink-900"
        >
          بستن
        </button>
      </div>

      <JalaliDatePicker
        id="reunion-date"
        value={draftDate}
        onChange={setDraftDate}
        label="کِی همدیگه رو می‌بینید؟"
        placeholder="انتخاب تاریخ دیدار"
        minIso={todayIso()}
      />

      <label className="mt-3 block">
        <span className="mb-1 block text-[11.5px] font-bold text-ink-700">
          یادداشت <span className="font-medium text-ink-700">(اختیاری)</span>
        </span>
        <input
          type="text"
          value={draftNote}
          onChange={(event) => setDraftNote(event.target.value)}
          maxLength={140}
          placeholder="مثلاً فرودگاه، پرواز ۸ صبح"
          className="input text-[12.5px]"
        />
      </label>

      {error && (
        <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-[11.5px] font-semibold text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={busy || !draftDate}
        className="btn-primary mt-3 w-full disabled:opacity-60"
      >
        {busy ? 'در حال ثبت…' : 'ثبت دیدار'}
      </button>

      {canClear && (
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="mt-2 w-full rounded-xl py-2 text-[11.5px] font-semibold text-ink-700 transition hover:text-red-500 disabled:opacity-60"
        >
          پاک کردن شمارنده
        </button>
      )}
    </div>
  )
}
