import { useEffect, useRef, useState } from 'react'
import { sendWarmth } from '../lib/api'
import { toPersianError } from '../lib/errors'
import type { WarmthKind } from '../types/database'

const OPTIONS: { kind: WarmthKind; emoji: string; label: string; sent: string }[] = [
  { kind: 'miss', emoji: '🤍', label: 'دلم تنگ شده', sent: 'فرستادیم — می‌بیندش' },
  { kind: 'hug', emoji: '🫂', label: 'بغل', sent: 'بغل رسید به دستش' },
  { kind: 'cheer', emoji: '☀️', label: 'قوت قلب', sent: 'قوت قلب رفت' },
]

/**
 * Three taps, no text box.
 *
 * This is the whole feature: a way to reach across without starting a
 * conversation. Warmth is not a chat — there is no message, no thread and no
 * history page — so the buttons stay three, and each one settles into a small
 * confirmation instead of opening anything.
 *
 * A repeat of the same tap inside two minutes comes back `ALREADY_SENT`; that
 * is a double-tap, not a failure, so it still shows the cheerful state.
 */
export default function WarmthButtons({ partnerName }: { partnerName?: string | null }) {
  const [sentKind, setSentKind] = useState<WarmthKind | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<WarmthKind | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current)
    },
    [],
  )

  async function handleTap(option: (typeof OPTIONS)[number]) {
    setBusy(option.kind)
    setError(null)
    try {
      await sendWarmth(option.kind)
      setSentKind(option.kind)
      setNotice(option.sent)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        setSentKind(null)
        setNotice(null)
      }, 3200)
    } catch (err) {
      setError(toPersianError(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-5 border-t border-clay-300 py-4">
      <p className="mb-2 text-[11.5px] font-bold text-ink-700">
        خبری ازت بگیر{partnerName ? ` به ${partnerName}` : ''}
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        {OPTIONS.map((option) => {
          const active = sentKind === option.kind
          return (
            // Pressed in when chosen, raised when not: the shadow carries the
            // state, so there is no border to fight with it.
            <button
              key={option.kind}
              type="button"
              onClick={() => void handleTap(option)}
              disabled={busy !== null}
              aria-pressed={active}
              className={`flex flex-col items-center gap-1 rounded-2xl px-1.5 py-2.5 text-[11px] font-bold transition-shadow duration-200 disabled:opacity-60 ${
                active
                  ? 'bg-clay-200 text-blush-800 shadow-neo-in-sm'
                  : 'bg-clay-100 text-ink-700 shadow-neo-sm hover:shadow-neo'
              }`}
            >
              <span className="text-[18px] leading-none" aria-hidden="true">
                {option.emoji}
              </span>
              <span className="truncate">{busy === option.kind ? '…' : option.label}</span>
            </button>
          )
        })}
      </div>

      {notice && (
        <p role="status" className="mt-2 rounded-xl bg-mint-100 px-3 py-1.5 text-[11px] font-bold text-mint-700">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-600">
          {error}
        </p>
      )}
      <p className="mt-2 text-[10px] leading-5 text-ink-700">
        بی‌متن، بی‌گفت‌وگو — فقط یک اشاره که در زنگوله‌اش می‌نشیند. روزی چند بار بیشتر نه.
      </p>
    </div>
  )
}
