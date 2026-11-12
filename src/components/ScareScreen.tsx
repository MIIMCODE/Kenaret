import { useEffect, useRef, useState } from 'react'

/**
 * «گوشیت هک شده» — the prank before the surprise.
 *
 * ---------------------------------------------------------------------------
 * The ethics of this, written down before the code, because a fake hack screen
 * is not a joke you get to make casually.
 *
 * What this refuses to do:
 *
 *  · **It never fakes a real threat.** No big red lock, no pretend ransomware,
 *    no invented antivirus, no "your photos were uploaded". Those teach
 *    nothing, and a person who half-believes one of them has been genuinely
 *    frightened rather than playfully fooled. The tone is «دستت رو رو کردم» —
 *    "I got you" — not "you are in danger".
 *
 *  · **It reveals itself.** Every few seconds a line of the fake terminal
 *    undercuts the threat: a love note among the "files", a `♥` where a
 *    filename should be. Anyone who reads it instead of panicking should
 *    suspect the truth before the timer runs out.
 *
 *  · **It has a floor.** Tapping the screen ends it immediately, the skip
 *    button is visible the whole time, and it closes itself after 12 seconds
 *    whether or not anyone touches anything.
 *
 *  · **It respects `prefers-reduced-motion`.** The glitch is the joke; motion
 *    sensitivity is not a preference you get to override for a punchline. The
 *    screen stays, the shake and the static do not.
 *
 * The one thing it is allowed to be is *convincing on the surface*, for about
 * ten seconds, to somebody who is about to be very happy. That is the whole
 * trick — and it only works if it is ultimately a compliment.
 */

const LINES = [
  '> متصل شدن به دستگاه…',
  '> خواندن پیام‌ها… ۱٫۲۴۰ پیام',
  '> پیدا کردن مخاطب موردعلاقه…',
  '> پیدا کردن گالری… ۳٫۹۷۱ عکس',
  '> پیدا کردن تمام عکس‌هایی که دوبار درش کردی… ۱ عکس',
  '> پیدا کردن تمام شب‌هایی که تا دیروقت حرف زدی…',
  '> رفتن به حریم خصوصی… ⚠ این‌جا ممنوعه',
  '> این‌جا فقط دو نفر جا دارن. برای همین این‌جا رو نمی‌خونم.',
  '> هیچ‌چیزِ خصوصی‌ای خوانده نشد. همه‌اش شوخی بود 🙂',
]

const TICK_MS = 340
/** Total seconds before it plays itself out, however far along it is. */
const TOTAL_MS = 12_000

export interface ScareProps {
  /** Called when the reveal should take over. */
  onReveal: () => void
  /** The name to put on the "hello" line at the end. */
  name?: string | null
}

export default function ScareScreen({ onReveal, name }: ScareProps) {
  const [line, setLine] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [glitch, setGlitch] = useState(true)

  const revealed = useRef(false)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced.current) setGlitch(false)

    // The lines are the clock, not a fake progress bar: the fake "progress" is
    // exactly what makes the screen feel like a real tool doing real work.
    const tick = window.setInterval(() => {
      setLine((n) => Math.min(LINES.length - 1, n + 1))
    }, TICK_MS)

    // A hard stop. The last line is the confession; give it a beat to be read,
    // then leave by itself even if nobody taps.
    const end = window.setTimeout(() => reveal(), TOTAL_MS)

    return () => {
      window.clearInterval(tick)
      window.clearTimeout(end)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function reveal() {
    if (revealed.current) return
    revealed.current = true
    setLeaving(true)
    // Let the fade play, then hand over. Under reduced motion the fade is
    // skipped in CSS, so the timeout is the only thing keeping them waiting.
    window.setTimeout(onReveal, reduced.current ? 160 : 520)
  }

  const atEnd = line >= LINES.length - 1

  return (
    <div
      className={`scare ${leaving ? 'scare--out' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="شوخی — گوشی هک نشده"
      onClick={reveal}
    >
      {/* Static, scanlines and a vignette. All CSS, no images. */}
      <div aria-hidden="true" className={`scare__static ${glitch ? '' : 'scare__static--still'}`} />
      <div aria-hidden="true" className="scare__scan" />
      <div aria-hidden="true" className="scare__vignette" />

      <div className="relative z-10 flex min-h-dvh flex-col justify-between px-5 py-8">
        {/* ── the fake alert ── */}
        <header className={`scare__panel ${glitch ? 'scare__shake' : ''}`}>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="scare__led" />
            <span className="scare__mono scare__mono--latin text-[10px] text-[#7ef7b7]">
              CONNECTION ESTABLISHED
            </span>
          </div>

          <h1 className="scare__mono mt-4 text-[26px] font-black leading-tight text-[#e9fff3]">
            گوشیت رو دیدم
          </h1>
          <p className="scare__mono mt-2 text-[12.5px] leading-6 text-[#8ff0c0]">
            {name ? `${name} جان، ` : ''}یک لحظه صبر کن…
          </p>
        </header>

        {/* ── the terminal ── */}
        <div className="scare__panel scare__panel--wide my-6">
          <ul className="space-y-1.5" dir="rtl">
            {LINES.slice(0, line + 1).map((text, i) => {
              const isLast = i === LINES.length - 1
              const isCurrent = i === line
              return (
                <li
                  key={text}
                  className={`scare__mono text-[11.5px] leading-6 ${
                    isLast ? 'text-[#ffd166]' : 'text-[#7ef7b7]'
                  } ${isCurrent ? 'scare__type' : 'opacity-70'}`}
                >
                  {text}
                  {isCurrent && !atEnd && <span aria-hidden="true" className="scare__caret" />}
                </li>
              )
            })}
          </ul>

          {/* A fake progress bar that stalls just short of the end — the joke
              is that the tool never gets to finish what it started. */}
          <div aria-hidden="true" className="scare__bar mt-4">
            <span
              className="scare__barfill"
              style={{ width: `${Math.min(94, ((line + 1) / LINES.length) * 100)}%` }}
            />
          </div>
        </div>

        {/* ── the way out, always visible ── */}
        <footer className="text-center">
          <p className="scare__mono text-[10.5px] leading-6 text-[#6fd8a4]">
            {atEnd ? 'شوخی بود. تا ۳…' : 'می‌خواهی همین‌جا تمومش کنم؟'}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              reveal()
            }}
            className="scare__button mt-2 px-5 py-2.5 text-[12.5px] font-bold"
          >
            {atEnd ? 'ببین چی شده' : 'کافیه، نشونم بده'}
          </button>
        </footer>
      </div>
    </div>
  )
}
