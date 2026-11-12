import { useEffect, useState } from 'react'

/**
 * The other half of the prank: the moment the green terminal breaks.
 *
 * Structure matters more than decoration here. The reveal is three beats and
 * they must land in order, because the *timing* is the joke:
 *
 *   1. the screen cracks — the fake threat falls apart, in the same typeface
 *   2. a pause. One second of nothing, which is the longest second on the page
 *   3. «...شوخی بود» then the actual reason they are here
 *
 * If beat 3 arrived with beat 1 there would be no relief, and relief is the
 * entire feeling being bought. A scare that resolves instantly is just a jump.
 */

export interface RevealProps {
  /** What tonight actually is: «۱ ماه با هم». */
  title: string
  /** «ماهگرد» / «سالگرد». */
  subtitle: string
  /** Called once the reveal has finished playing. */
  onDone: () => void
}

const BEAT_MS = 1100

export default function Reveal({ title, subtitle, onDone }: RevealProps) {
  const [beat, setBeat] = useState(0)

  useEffect(() => {
    const timers = [
      window.setTimeout(() => setBeat(1), BEAT_MS),
      window.setTimeout(() => setBeat(2), BEAT_MS * 2),
      window.setTimeout(() => setBeat(3), BEAT_MS * 3),
    ]
    const finish = window.setTimeout(onDone, BEAT_MS * 3 + 900)

    return () => {
      timers.forEach(window.clearTimeout)
      window.clearTimeout(finish)
    }
    // `onDone` is a stable callback from the parent's effect scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="reveal" role="status" aria-live="polite">
      {/* The crack: a white tearing line across the green, drawn by a clip-path
          that opens outward. Pure CSS so it cannot cost a frame. */}
      <div aria-hidden="true" className={`reveal__crack ${beat >= 1 ? 'reveal__crack--open' : ''}`} />

      <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-7 text-center">
        <p
          className={`reveal__line text-[12.5px] font-bold tracking-[0.28em] transition-opacity duration-500 ${
            beat >= 1 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          پیام خطا
        </p>

        <p
          className={`reveal__mono mt-3 text-[15px] leading-8 transition-all duration-700 ${
            beat >= 1 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          هیچ‌کس گوشیت رو هک نکرده.
        </p>

        <p
          className={`reveal__mono mt-1 text-[15px] leading-8 transition-all duration-700 ${
            beat >= 2 ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          یه نفر فقط حواسش بهت بوده. 🙂
        </p>

        {/* The turn: from green terminal to warm paper, in one element. */}
        <div
          className={`mt-8 transition-all duration-1000 ${
            beat >= 3 ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-95 opacity-0'
          }`}
        >
          <p className="text-[10.5px] font-bold tracking-[0.3em] text-[#ffc9d7]">{subtitle}</p>
          <p className="celebrate-headline mt-2 text-[34px] font-black leading-tight">{title}</p>
        </div>
      </div>
    </div>
  )
}
