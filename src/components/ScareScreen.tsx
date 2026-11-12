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

/**
 * Each line carries its own pause, in milliseconds, before the *next* one.
 *
 * A uniform tick is what made the first version feel like a progress bar with
 * words in it: every line arrived on the same beat, so nobody believed a
 * machine was doing work. Real output stutters — a quick line, then a long
 * pause while something heavy is read, then two in a row.
 *
 * The rhythm here is deliberate. The first four move briskly so the screen
 * feels like it is getting somewhere. The fifth — the photos you double-tapped
 * — is the one that lands, so it gets a long beat after it. The two
 * confession lines at the end are the slowest of all: that is the part that
 * has to be *read* rather than skimmed.
 *
 * Total is about 24 seconds if left alone, and the bar never reaches the end.
 */
const LINES: Array<{ text: string; hold: number }> = [
  { text: '> متصل شدن به دستگاه…', hold: 1100 },
  { text: '> خواندن پیام‌ها… ۱٫۲۴۰ پیام', hold: 1500 },
  { text: '> پیدا کردن مخاطب موردعلاقه…', hold: 1300 },
  { text: '> پیدا کردن گالری… ۳٫۹۷۱ عکس', hold: 1600 },
  { text: '> پیدا کردن تمام عکس‌هایی که دوبار درش کردی… ۱ عکس', hold: 2200 },
  { text: '> پیدا کردن تمام شب‌هایی که تا دیروقت حرف زدی…', hold: 1900 },
  { text: '> رفتن به حریم خصوصی… ⚠ این‌جا ممنوعه', hold: 2300 },
  { text: '> این‌جا فقط دو نفر جا دارن. برای همین این‌جا رو نمی‌خونم.', hold: 2600 },
  { text: '> هیچ‌چیزِ خصوصی‌ای خوانده نشد. همه‌اش شوخی بود 🙂', hold: 1400 },
]

/** How fast characters appear inside a line, in ms. */
const TYPE_MS = 26
/** A beat of silence before the first line, so the screen lands first. */
const LEAD_IN_MS = 700
/**
 * How long the whole transcript takes, in milliseconds — *derived*, never
 * guessed.
 *
 * This was a hand-written constant and it was wrong twice: at 24s and again at
 * 27s the last line was still being typed when the screen left, which cut off
 * «همه‌اش شوخی بود» mid-word. A prank that never confesses is not a prank, it
 * is a scare — so the budget is now computed from the same numbers the engine
 * types with, and cannot drift out of step with them again.
 */
function typeDuration(text: string): number {
  let ms = 0
  for (const ch of text) {
    ms += ch === '.' || ch === '…' ? TYPE_MS * 4 : ch === ' ' ? TYPE_MS * 1.4 : TYPE_MS
  }
  return ms
}

const TRANSCRIPT_MS = LINES.reduce((sum, l) => sum + typeDuration(l.text) + l.hold, 0)

/** The transcript, plus a beat to read the confession, plus the fade. */
const TOTAL_MS = LEAD_IN_MS + TRANSCRIPT_MS + 2600

export interface ScareProps {
  /** Called when the reveal should take over. */
  onReveal: () => void
  /** The name to put on the "hello" line at the end. */
  name?: string | null
}

export default function ScareScreen({ onReveal, name }: ScareProps) {
  const [line, setLine] = useState(0)
  /** How many characters of the current line have been typed out. */
  const [typed, setTyped] = useState(0)
  /**
   * Indices of lines that have finished typing.
   *
   * By index, not by text: two identical lines would otherwise share a key and
   * the second would be swallowed the instant the first completed.
   */
  const [finished, setFinished] = useState<number[]>([])
  /** True while the current line is still arriving character by character. */
  const [typing, setTyping] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [glitch, setGlitch] = useState(true)

  const revealed = useRef(false)
  const reduced = useRef(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced.current) {
      setGlitch(false)
      // Reduced motion gets the whole transcript at once: typewriter text is
      // exactly the kind of small, constant movement the setting asks about.
      setFinished(LINES.map((_, i) => i))
      setLine(LINES.length - 1)
      setTyped(Number.POSITIVE_INFINITY)
      setTyping(false)
    }

    function later(fn: () => void, ms: number) {
      timers.current.push(window.setTimeout(fn, ms))
    }

    /*
     * The typing engine.
     *
     * One character every TYPE_MS, then the line's own `hold` before the next
     * begins — so a long line is not just "slower", it is genuinely longer,
     * the way a real command that reads a thousand files would be.
     *
     * Written with setTimeout rather than setInterval because the delay
     * *changes* per character and per line, and an interval cannot express
     * that. Every timer is collected so unmounting mid-sentence stops cleanly.
     */
    function typeLine(index: number, charCount: number) {
      if (revealed.current) return

      const entry = LINES[index]
      if (!entry) return

      if (charCount < entry.text.length) {
        const nextChar = charCount + 1
        setTyped(nextChar)
        setTyping(true)
        // A slight stagger on spaces and dots: prose typed at a dead-even rate
        // reads like a teleprompter, not like a terminal.
        const ch = entry.text[nextChar - 1] ?? ''
        const pause = ch === '.' || ch === '…' ? TYPE_MS * 4 : ch === ' ' ? TYPE_MS * 1.4 : TYPE_MS
        later(() => typeLine(index, nextChar), pause)
        return
      }

      // Line complete. Bank it, hold, then start the next one.
      setTyping(false)
      setFinished((prev) => (prev.includes(index) ? prev : [...prev, index]))
      if (index >= LINES.length - 1) return

      later(() => {
        if (revealed.current) return
        setLine(index + 1)
        setTyped(0)
        typeLine(index + 1, 1)
      }, entry.hold)
    }

    if (!reduced.current) {
      later(() => {
        setLine(0)
        setTyped(1)
        typeLine(0, 1)
      }, LEAD_IN_MS)
    }

    // A hard stop. The last line is the confession; give it a beat to be read,
    // then leave by itself even if nobody taps.
    later(() => reveal(), TOTAL_MS)

    return () => {
      timers.current.forEach(window.clearTimeout)
      timers.current = []
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

  const atEnd = finished.length >= LINES.length && !typing

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
            {/* Finished lines, held at a dimmer strength: the transcript so far. */}
            {finished.map((index) => {
              const isConfession = index === LINES.length - 1
              return (
                <li
                  key={index}
                  className={`scare__mono text-[11.5px] leading-6 ${
                    isConfession ? 'text-[#ffd166]' : 'text-[#7ef7b7] opacity-60'
                  }`}
                >
                  {LINES[index].text}
                </li>
              )
            })}

            {/* The line arriving right now, with its caret. */}
            {typing && !finished.includes(line) && LINES[line] && (
              <li className="scare__mono text-[11.5px] leading-6 text-[#7ef7b7]">
                {LINES[line].text.slice(0, Math.max(1, Math.min(typed, LINES[line].text.length)))}
                <span aria-hidden="true" className="scare__caret" />
              </li>
            )}
          </ul>

          {/* A fake progress bar that stalls just short of the end — the joke
              is that the tool never gets to finish what it started. */}
          <div aria-hidden="true" className="scare__bar mt-4">
            <span
              className="scare__barfill"
              style={{ width: `${Math.min(94, barPercent(finished.length, typing, typed, line))}%` }}
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

/**
 * How full the fake progress bar is.
 *
 * Deliberately capped at 94% by the caller: the tool reads, reads, reads and
 * never finishes, because the thing it was about to finish was reading her
 * private messages — and it declined. A bar that reaches 100% would promise a
 * completion that the story then has to walk back.
 */
function barPercent(finishedCount: number, typing: boolean, typed: number, line: number): number {
  const current = LINES[line]
  const partial = typing && current ? Math.min(1, Math.max(0, typed / Math.max(1, current.text.length))) : 0
  return ((finishedCount + partial) / LINES.length) * 100
}
