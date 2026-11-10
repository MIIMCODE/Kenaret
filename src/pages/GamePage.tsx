import { useCallback, useEffect, useState } from 'react'
import AppHeader from '../components/AppHeader'
import Alert from '../components/Alert'
import Spinner from '../components/Spinner'
import { NeoBackdrop } from '../components/Neo'
import { useAuth } from '../hooks/useAuth'
import {
  addGameCard,
  answerGameTurn,
  dealGameCard,
  fetchGameCards,
  fetchGameState,
  retireGameCard,
  seedGameDeck,
  setGameLevel,
  skipGameTurn,
} from '../lib/api'
import { toPersianError } from '../lib/errors'
import { toPersianDigits } from '../lib/jalali'
import type {
  GameCard,
  GameCounts,
  GameKind,
  GameOpenTurn,
  GameSettings,
  GameSource,
  GameTurn,
} from '../types/database'

/**
 * رودررو.
 *
 * A game for exactly two people, built on one idea: the deck is *theirs*.
 *
 * A generic set of cards is fun for one evening and then never opened again —
 * by the third round you have read them all, and none of them are about you.
 * So the starter pack is only a beginning, and every card either of them adds
 * stays in the game. The list below the table is therefore not a settings
 * screen; it is half the feature.
 *
 * Three things this page deliberately does NOT do:
 *
 *   · It does not decide whose turn it is. The server answers that, and
 *     `can_answer` is used verbatim — duplicating the rule here (which also
 *     has to handle `together` cards answered by both) would eventually
 *     disagree with the database.
 *   · It does not hide the level ceiling behind a menu. Someone should be able
 *     to lower it in one tap, mid-game, without explaining themselves.
 *   · It does not treat a skip as a failure. The turn history shows skipped
 *     cards plainly, because "we both passed on that one" is part of the
 *     evening.
 */
export default function GamePage() {
  const { profile } = useAuth()

  const [settings, setSettings] = useState<GameSettings>({ max_level: 2, avoid_repeats: true })
  const [counts, setCounts] = useState<GameCounts>({ total: 0, builtin: 0, ours: 0, played: 0 })
  const [openTurn, setOpenTurn] = useState<GameOpenTurn | null>(null)
  const [recent, setRecent] = useState<GameTurn[]>([])

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** The draft answer for the open turn. */
  const [draft, setDraft] = useState('')
  /** Which panel is showing under the table. */
  const [tab, setTab] = useState<'deck' | 'history' | 'add'>('deck')

  const apply = useCallback((next: Awaited<ReturnType<typeof fetchGameState>>) => {
    setSettings(next.settings)
    setCounts(next.counts)
    setOpenTurn(next.open_turn)
    setRecent(next.recent)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Seeding is idempotent and cheap; doing it here means a couple never
      // meets an empty deck just because they are the first to open the page.
      await seedGameDeck()
      apply(await fetchGameState())
    } catch (err) {
      setError(toPersianError(err, 'بازی بارگذاری نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    void load()
  }, [load])

  /** Clear the draft whenever a different card lands on the table. */
  useEffect(() => {
    setDraft('')
  }, [openTurn?.id])

  async function handleDeal(kind: GameKind | null) {
    if (busy) return
    setBusy('deal')
    setError(null)
    setNotice(null)
    try {
      apply(await dealGameCard(kind))
    } catch (err) {
      setError(toPersianError(err, 'کارت رو نداد. یک‌بار دیگر بزن.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleAnswer() {
    if (!openTurn || busy) return
    const body = draft.trim()
    if (!body) return
    setBusy('answer')
    setError(null)
    try {
      const next = await answerGameTurn(openTurn.id, body)
      apply(next)
      // A `together` card stays open until the second person answers; the
      // server tells us which happened, so the copy can be honest.
      if (next.open_turn) {
        setNotice('ثبت شد — حالا نوبت اونه که جواب بده 🤍')
      } else {
        setNotice('ثبت شد 🤍')
      }
    } catch (err) {
      setError(toPersianError(err, 'جواب ثبت نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleSkip() {
    if (!openTurn || busy) return
    setBusy('skip')
    setError(null)
    try {
      apply(await skipGameTurn(openTurn.id))
      setNotice('رد شد — کارت بعدی.')
    } catch (err) {
      setError(toPersianError(err, 'رد نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleLevel(level: 1 | 2 | 3) {
    if (busy || settings.max_level === level) return
    setBusy('level')
    setError(null)
    try {
      apply(await setGameLevel(level, settings.avoid_repeats))
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(null)
    }
  }

  const me = profile?.display_name ?? 'تو'
  const askedOfMe = openTurn?.asked_of === profile?.id
  const myTogetherAnswer = openTurn?.together_answers.find((a) => a.user_id === profile?.id)

  return (
    <div className="min-h-dvh">
      <NeoBackdrop />
      <AppHeader />

      <main className="page space-y-4">
        {/* Title slab */}
        <section className="animate-fade-up rounded-[1.75rem] bg-clay-100 p-5 shadow-neo">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-clay-200 text-blush-800 shadow-neo-in-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4 4v-4H5.5A1.5 1.5 0 0 1 4 14.5z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 9.5h5M9.5 12.5h3"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[19px] font-extrabold leading-7 text-ink-900">رودررو</h1>
              <p className="mt-1 text-[11.5px] leading-5 text-ink-700">
                یک بازی برای دو نفر — سؤال‌ها از خودتون
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[10.5px] font-bold text-ink-700">
            <span className="rounded-full bg-clay-200 px-2.5 py-1 shadow-neo-in-sm">
              {toPersianDigits(counts.total)} کارت
            </span>
            <span className="rounded-full bg-clay-200 px-2.5 py-1 shadow-neo-in-sm">
              {toPersianDigits(counts.played)} دور
            </span>
            {counts.ours > 0 && (
              <span className="rounded-full bg-clay-200 px-2.5 py-1 text-blush-800 shadow-neo-in-sm">
                {toPersianDigits(counts.ours)} از خودتون
              </span>
            )}
          </div>
        </section>

        {/* Level ceiling — one tap, always visible */}
        <LevelPicker
          value={settings.max_level}
          disabled={busy === 'level'}
          onChange={handleLevel}
        />

        {notice && <Alert tone="success">{notice}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {loading ? (
          <section className="flex items-center justify-center rounded-[1.75rem] bg-clay-100 p-10 shadow-neo">
            <Spinner className="h-6 w-6" />
          </section>
        ) : openTurn ? (
          <TurnCard
            turn={openTurn}
            askedOfMe={askedOfMe}
            myAnswer={myTogetherAnswer?.body}
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            onAnswer={handleAnswer}
            onSkip={handleSkip}
          />
        ) : (
          <DealCard busy={busy === 'deal'} onDeal={handleDeal} counts={counts} />
        )}

        {/* Under the table: deck / history / write a card */}
        <div className="flex gap-2">
          {(
            [
              ['deck', 'کارت‌ها'],
              ['history', 'دورهای قبل'],
              ['add', 'کارت جدید'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`flex-1 basis-0 rounded-2xl px-3 py-2.5 text-[12px] font-bold transition-shadow duration-200 ${
                tab === key
                  ? 'bg-clay-200 text-blush-800 shadow-neo-in-sm'
                  : 'bg-clay-100 text-ink-700 shadow-neo-sm hover:shadow-neo'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'deck' && <DeckList counts={counts} onChanged={load} />}
        {tab === 'history' && <HistoryList turns={recent} me={profile?.id ?? null} />}
        {tab === 'add' && (
          <AddCardForm
            partnerName={undefined}
            onAdded={async (message) => {
              setNotice(message)
              apply(await fetchGameState())
            }}
          />
        )}

        <p className="pt-2 text-center text-[10.5px] leading-5 text-ink-700">
          هر دو نفر می‌توانید کارت اضافه کنید و سطح بازی را عوض کنید. کارت‌های خودتان را
          می‌توانید از فهرست بردارید؛ کارت‌های پیش‌فرض می‌مانند تا فهرست مشترک‌تان معنی داشته باشد.
          <span className="mx-1.5 text-blush-600">•</span>
          {me}
        </p>
      </main>
    </div>
  )
}

/* ============================================================
   The level ceiling
   ============================================================ */

const LEVELS: { value: 1 | 2 | 3; label: string; hint: string }[] = [
  { value: 1, label: 'آرام', hint: 'شروع نرم، بدون رودربایستی' },
  { value: 2, label: 'جسور', hint: 'کمی هزینه دارد، جوابش می‌ارزد' },
  { value: 3, label: 'رک', hint: 'بدون بالش، ولی درباره‌ی هم' },
]

function LevelPicker({
  value,
  disabled,
  onChange,
}: {
  value: 1 | 2 | 3
  disabled: boolean
  onChange: (level: 1 | 2 | 3) => void
}) {
  return (
    <section className="rounded-[1.75rem] bg-clay-100 p-4 shadow-neo">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[12.5px] font-extrabold text-ink-900">تا کجا بریم؟</h2>
        <p className="text-[10.5px] text-ink-700">هر وقت خواستی عوضش کن</p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="سطح کارت‌ها">
        {LEVELS.map((level) => {
          const active = value === level.value
          return (
            <button
              key={level.value}
              type="button"
              onClick={() => onChange(level.value)}
              disabled={disabled}
              aria-pressed={active}
              className={`rounded-2xl px-2 py-2.5 text-center transition-shadow duration-200 disabled:opacity-60 ${
                active
                  ? 'bg-clay-200 shadow-neo-in-sm'
                  : 'bg-clay-100 shadow-neo-sm hover:shadow-neo'
              }`}
            >
              <span
                className={`block text-[12.5px] font-extrabold ${
                  active ? 'text-blush-800' : 'text-ink-700'
                }`}
              >
                {level.label}
              </span>
              <span className="mt-1 block text-[9.5px] leading-4 text-ink-700">{level.hint}</span>
            </button>
          )
        })}
      </div>
      <p className="mt-2.5 text-[10px] leading-5 text-ink-700">
        فقط کارت‌های این سطح یا پایین‌تر رو می‌شه. اگر پایین بیاری، از همین لحظه اعمال می‌شه.
      </p>
    </section>
  )
}

/* ============================================================
   The table
   ============================================================ */

function DealCard({
  busy,
  onDeal,
  counts,
}: {
  busy: boolean
  onDeal: (kind: GameKind | null) => void
  counts: GameCounts
}) {
  const empty = counts.total === 0
  return (
    <section className="animate-fade-up rounded-[1.75rem] bg-clay-100 p-5 shadow-neo">
      <p className="text-center text-[11.5px] leading-6 text-ink-700">
        {empty
          ? 'هنوز کارتی توی دسته نیست. از تب «کارت جدید» یکی بنویس.'
          : 'یک کارت بکش — هر کس کارت رو کشید، کارت مال اون یکی می‌شه.'}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <DealButton
          label="حقیقت"
          hint="یک سؤال"
          disabled={busy || empty}
          onClick={() => onDeal('truth')}
          accent="blush"
        />
        <DealButton
          label="جرئت"
          hint="یک کار"
          disabled={busy || empty}
          onClick={() => onDeal('dare')}
          accent="lilac"
        />
        <DealButton
          label="باهم"
          hint="دو جواب"
          disabled={busy || empty}
          onClick={() => onDeal('together')}
          accent="mint"
        />
      </div>

      <button
        type="button"
        onClick={() => onDeal(null)}
        disabled={busy || empty}
        className="mt-2 w-full rounded-2xl bg-clay-100 py-3 text-[12.5px] font-extrabold text-ink-900 shadow-neo-sm transition-shadow duration-200 hover:shadow-neo active:shadow-neo-in-sm disabled:opacity-50"
      >
        {busy ? 'دارم می‌کشم…' : 'هر چی شد، بکش'}
      </button>
    </section>
  )
}

function DealButton({
  label,
  hint,
  disabled,
  onClick,
  accent,
}: {
  label: string
  hint: string
  disabled: boolean
  onClick: () => void
  accent: 'blush' | 'lilac' | 'mint'
}) {
  // Each gradient must clear 4.5:1 behind white at *both* ends, and these
  // buttons also carry 9.5px labels at white/90. blush-600 is only 3.74:1, so
  // the pink starts at #bf2f59 — 5.58:1, and 4.79:1 for the small text.
  const tone =
    accent === 'blush'
      ? 'from-[#bf2f59] to-blush-800 shadow-neo-pink'
      : accent === 'lilac'
        ? 'from-lilac-700 to-lilac-900 shadow-[8px_8px_18px_rgba(103,67,159,0.25),-8px_-8px_18px_rgba(255,255,255,0.85)]'
        : 'from-[#1c6b55] to-[#145246] shadow-[8px_8px_18px_rgba(28,107,85,0.25),-8px_-8px_18px_rgba(255,255,255,0.85)]'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-b ${tone} px-2 py-3 text-white transition duration-200 active:scale-[0.98] disabled:opacity-50`}
    >
      <span className="text-[13px] font-extrabold">{label}</span>
      <span className="text-[9.5px] font-medium text-white/90">{hint}</span>
    </button>
  )
}

function TurnCard({
  turn,
  askedOfMe,
  myAnswer,
  draft,
  setDraft,
  busy,
  onAnswer,
  onSkip,
}: {
  turn: GameOpenTurn
  askedOfMe: boolean
  myAnswer?: string
  draft: string
  setDraft: (value: string) => void
  busy: string | null
  onAnswer: () => void
  onSkip: () => void
}) {
  const isTogether = turn.kind === 'together'
  const kindLabel = turn.kind === 'truth' ? 'حقیقت' : turn.kind === 'dare' ? 'جرئت' : 'باهم'
  const answeredByOther = isTogether && turn.together_answers.length === 1 && !myAnswer

  return (
    <section className="animate-fade-up rounded-[1.75rem] bg-clay-100 p-5 shadow-neo">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-clay-200 px-2.5 py-1 text-[10.5px] font-extrabold text-blush-800 shadow-neo-in-sm">
          {kindLabel}
        </span>
        <span className="text-[10px] font-bold text-ink-700">
          {LEVELS.find((l) => l.value === turn.level)?.label}
        </span>
      </div>

      {/* The card itself: pressed into the surface, because the words are the
          object here and the panel around them should recede. */}
      <p className="mt-3 rounded-2xl bg-clay-200 p-4 text-center text-[15px] font-extrabold leading-8 text-ink-900 shadow-neo-in">
        {turn.body}
      </p>

      {isTogether && (
        <p className="mt-2.5 text-center text-[10.5px] leading-5 text-ink-700">
          این کارت جواب هر دوی شماست؛ وقتی هر دو نوشتید بسته می‌شه.
        </p>
      )}

      {/* Answers already written on a together card */}
      {isTogether && turn.together_answers.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {turn.together_answers.map((a) => (
            <li
              key={a.user_id}
              className="rounded-xl bg-clay-200 px-3 py-2 text-[11.5px] leading-6 text-ink-700 shadow-neo-in-sm"
            >
              <span className="font-bold text-ink-900">
                {a.user_id === turn.asked_by ? 'کسی که کشید' : 'اون یکی'}:
              </span>{' '}
              {a.body}
            </li>
          ))}
        </ul>
      )}

      {turn.can_answer ? (
        <div className="mt-3">
          <label className="mb-1.5 block text-[11.5px] font-bold text-ink-700" htmlFor="game-answer">
            {isTogether ? 'جواب تو' : 'جواب'}
          </label>
          <textarea
            id="game-answer"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 600))}
            rows={3}
            maxLength={600}
            placeholder="هرچی دلت می‌خواد بنویس…"
            className="field resize-none text-[13px] leading-6"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onAnswer}
              disabled={!draft.trim() || busy !== null}
              className="flex-1 basis-0 rounded-2xl bg-gradient-to-b from-[#bf2f59] to-blush-800 py-3 text-[12.5px] font-extrabold text-white shadow-neo-pink transition duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === 'answer' ? 'دارم می‌فرستم…' : 'ثبتش کن'}
            </button>
            <button
              type="button"
              onClick={onSkip}
              disabled={busy !== null}
              className="rounded-2xl bg-clay-100 px-4 py-3 text-[12px] font-bold text-ink-700 shadow-neo-sm transition-shadow duration-200 hover:shadow-neo active:shadow-neo-in-sm disabled:opacity-50"
            >
              رد کن
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-clay-200 p-3.5 text-center shadow-neo-in-sm">
          <p className="text-[11.5px] font-bold text-ink-900">
            {askedOfMe ? 'جوابت ثبت شد' : 'منتظر جوابش'}
          </p>
          <p className="mt-1 text-[10.5px] leading-5 text-ink-700">
            {answeredByOther
              ? 'اون جوابش رو نوشت؛ تو هم بنویس تا کارت بسته شه.'
              : 'کارت روی میزه — هر وقت جواب داد، دوباره اینجا می‌بینیش.'}
          </p>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy !== null}
            className="mt-2.5 rounded-xl bg-clay-100 px-3.5 py-2 text-[11px] font-bold text-blush-800 shadow-neo-sm transition-shadow hover:shadow-neo disabled:opacity-50"
          >
            برو کارت بعدی
          </button>
        </div>
      )}
    </section>
  )
}

/* ============================================================
   The list — half the feature
   ============================================================ */

function DeckList({ counts, onChanged }: { counts: GameCounts; onChanged: () => Promise<void> }) {
  const [source, setSource] = useState<GameSource | null>(null)
  const [kind, setKind] = useState<GameKind | null>(null)
  const [cards, setCards] = useState<GameCard[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const page = await fetchGameCards({ source, kind, limit: 100 })
      setCards(page.cards)
      setTotal(page.total)
    } catch (err) {
      setError(toPersianError(err, 'فهرست کارت‌ها نیامد.'))
    } finally {
      setLoading(false)
    }
  }, [source, kind])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRetire(card: GameCard) {
    if (removing) return
    setRemoving(card.id)
    setError(null)
    try {
      await retireGameCard(card.id)
      setCards((prev) => prev.filter((c) => c.id !== card.id))
      setTotal((n) => Math.max(0, n - 1))
      await onChanged()
    } catch (err) {
      setError(toPersianError(err, 'برداشتن کارت نشد.'))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section className="rounded-[1.75rem] bg-clay-100 p-4 shadow-neo">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-extrabold text-ink-900">دسته‌ی شما</h2>
        <span className="text-[10.5px] font-bold text-ink-700">
          {toPersianDigits(total)} کارت
        </span>
      </div>

      {/* Two rows of small filters, pressed in when chosen */}
      <div className="flex gap-1.5" role="group" aria-label="منبع کارت">
        {(
          [
            [null, 'همه'],
            ['builtin', `پیش‌فرض ${counts.builtin ? `(${toPersianDigits(counts.builtin)})` : ''}`],
            ['ours', `خودتان ${counts.ours ? `(${toPersianDigits(counts.ours)})` : ''}`],
          ] as const
        ).map(([value, label]) => (
          <SmallFilter
            key={String(value)}
            active={source === value}
            onClick={() => setSource(value as GameSource | null)}
          >
            {label}
          </SmallFilter>
        ))}
      </div>

      <div className="mt-1.5 flex gap-1.5" role="group" aria-label="نوع کارت">
        {(
          [
            [null, 'همه'],
            ['truth', 'حقیقت'],
            ['dare', 'جرئت'],
            ['together', 'باهم'],
          ] as const
        ).map(([value, label]) => (
          <SmallFilter
            key={String(value)}
            active={kind === value}
            onClick={() => setKind(value as GameKind | null)}
          >
            {label}
          </SmallFilter>
        ))}
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {loading ? (
        <div className="mt-4 flex justify-center py-6">
          <Spinner className="h-5 w-5" />
        </div>
      ) : cards.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-clay-200 px-3 py-4 text-center text-[11.5px] leading-6 text-ink-700 shadow-neo-in-sm">
          با این فیلتر کارتی نیست. از تب «کارت جدید» یکی بنویس.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {cards.map((card) => (
            <li
              key={card.id}
              className="flex items-start gap-2 rounded-2xl bg-clay-200 px-3 py-2.5 shadow-neo-in-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="rounded-md bg-clay-100 px-1.5 py-0.5 text-[9px] font-extrabold text-blush-800 shadow-neo-sm">
                    {card.kind === 'truth' ? 'حقیقت' : card.kind === 'dare' ? 'جرئت' : 'باهم'}
                  </span>
                  <span className="text-[9px] font-bold text-ink-700">
                    {LEVELS.find((l) => l.value === card.level)?.label}
                  </span>
                  {card.builtin ? (
                    <span className="text-[9px] text-ink-700">پیش‌فرض</span>
                  ) : (
                    <span className="text-[9px] font-bold text-lilac-700">از خودتان</span>
                  )}
                </div>
                <p className="text-[12px] leading-6 text-ink-900">{card.body}</p>
              </div>
              {!card.builtin && (
                <button
                  type="button"
                  onClick={() => void handleRetire(card)}
                  disabled={removing === card.id}
                  aria-label="برداشتن این کارت"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-clay-100 text-[13px] font-bold text-ink-700 shadow-neo-sm transition hover:text-red-500 disabled:opacity-50"
                >
                  {removing === card.id ? '·' : '×'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SmallFilter({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl px-2.5 py-1.5 text-[10.5px] font-bold transition-shadow duration-200 ${
        active
          ? 'bg-clay-200 text-blush-800 shadow-neo-in-sm'
          : 'bg-clay-100 text-ink-700 shadow-neo-sm hover:shadow-neo'
      }`}
    >
      {children}
    </button>
  )
}

function HistoryList({ turns, me }: { turns: GameTurn[]; me: string | null }) {
  if (turns.length === 0) {
    return (
      <section className="rounded-[1.75rem] bg-clay-100 p-6 text-center shadow-neo">
        <p className="text-[11.5px] leading-6 text-ink-700">
          هنوز دوری بازی نکردید. اولین کارت رو بکشید.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-[1.75rem] bg-clay-100 p-4 shadow-neo">
      <h2 className="mb-2.5 text-[13px] font-extrabold text-ink-900">دورهای قبل</h2>
      <ul className="space-y-2">
        {turns.map((turn) => {
          const answeredByMe = turn.asked_of === me
          return (
            <li key={turn.id} className="rounded-2xl bg-clay-200 px-3 py-2.5 shadow-neo-in-sm">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="rounded-md bg-clay-100 px-1.5 py-0.5 text-[9px] font-extrabold text-blush-800 shadow-neo-sm">
                  {turn.kind === 'truth' ? 'حقیقت' : turn.kind === 'dare' ? 'جرئت' : 'باهم'}
                </span>
                {turn.outcome === 'skipped' && (
                  <span className="text-[9px] font-bold text-ink-700">رد شد</span>
                )}
              </div>
              <p className="text-[11.5px] leading-6 text-ink-900">{turn.body}</p>
              {turn.answer && (
                <p className="mt-1.5 rounded-lg bg-clay-100 px-2 py-1.5 text-[11px] leading-6 text-ink-700 shadow-neo-sm">
                  <span className="font-bold text-ink-900">
                    {answeredByMe ? 'جواب تو' : 'جوابش'}:
                  </span>{' '}
                  {turn.answer}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/* ============================================================
   Writing a card
   ============================================================ */

const KIND_OPTIONS: { value: GameKind; label: string; hint: string }[] = [
  { value: 'truth', label: 'حقیقت', hint: 'یک سؤال از اون یکی' },
  { value: 'dare', label: 'جرئت', hint: 'یک کار که باید انجام بده' },
  { value: 'together', label: 'باهم', hint: 'هر دو جواب می‌دهید' },
]

function AddCardForm({
  onAdded,
}: {
  partnerName?: string
  onAdded: (message: string) => Promise<void>
}) {
  const [kind, setKind] = useState<GameKind>('truth')
  const [level, setLevel] = useState<1 | 2 | 3>(2)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remaining = 280 - body.length
  const tooShort = body.trim().length < 3

  async function submit() {
    if (busy || tooShort) return
    setBusy(true)
    setError(null)
    try {
      await addGameCard(kind, level, body.trim())
      setBody('')
      await onAdded('کارت اضافه شد — از همین حالا توی دسته‌ست 🤍')
    } catch (err) {
      setError(toPersianError(err, 'کارت اضافه نشد. یک‌بار دیگر تلاش کن.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-[1.75rem] bg-clay-100 p-4 shadow-neo">
      <h2 className="text-[13px] font-extrabold text-ink-900">کارت جدید</h2>
      <p className="mt-1 text-[10.5px] leading-5 text-ink-700">
        هر چی بنویسید توی دسته‌ی مشترک می‌مونه و هر دو نفرش می‌بینید.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="نوع کارت">
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setKind(option.value)}
            aria-pressed={kind === option.value}
            className={`rounded-2xl px-2 py-2 text-center transition-shadow duration-200 ${
              kind === option.value
                ? 'bg-clay-200 shadow-neo-in-sm'
                : 'bg-clay-100 shadow-neo-sm hover:shadow-neo'
            }`}
          >
            <span
              className={`block text-[11.5px] font-extrabold ${
                kind === option.value ? 'text-blush-800' : 'text-ink-700'
              }`}
            >
              {option.label}
            </span>
            <span className="mt-0.5 block text-[9px] leading-4 text-ink-700">{option.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-1.5" role="group" aria-label="سطح کارت">
        {LEVELS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setLevel(option.value)}
            aria-pressed={level === option.value}
            className={`flex-1 basis-0 rounded-xl px-2 py-1.5 text-[10.5px] font-bold transition-shadow duration-200 ${
              level === option.value
                ? 'bg-clay-200 text-blush-800 shadow-neo-in-sm'
                : 'bg-clay-100 text-ink-700 shadow-neo-sm'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <label className="mb-1.5 block text-[11.5px] font-bold text-ink-700" htmlFor="new-card">
          متن کارت
        </label>
        <textarea
          id="new-card"
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, 280))}
          rows={3}
          maxLength={280}
          placeholder={
            kind === 'truth'
              ? 'مثلاً: کِی بیشتر از همه به من افتخار کردی؟'
              : kind === 'dare'
                ? 'مثلاً: یک ویس بفرست و توش یه چیز که هیچ‌وقت نگفتی بگو.'
                : 'مثلاً: هر دو یک آرزو برای ماه آینده بنویسید.'
          }
          className="field resize-none text-[13px] leading-6"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-ink-700">
            {tooShort ? 'حداقل ۳ حرف' : `${toPersianDigits(remaining)} حرف مانده`}
          </span>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || tooShort}
        className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#bf2f59] to-blush-800 py-3 text-[12.5px] font-extrabold text-white shadow-neo-pink transition duration-200 active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? 'دارم اضافه می‌کنم…' : 'اضافه‌اش کن'}
      </button>
    </section>
  )
}
