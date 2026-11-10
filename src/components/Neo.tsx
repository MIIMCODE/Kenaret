/**
 * The two pieces the dashboard's neo-morphic look is built from.
 *
 * Neo-morphism has one requirement that is easy to get wrong: the surface and
 * the thing extruded from it must be the *same* material. Put a white card on
 * a white page and you get a sticker; put it on the same warm clay the shadows
 * were sampled from and it reads as pressed out. So both the background and
 * the raised elements below use the `clay` ramp, and every shadow on the
 * dashboard comes from the same light direction — upper left, always.
 */

/**
 * Ambient colour behind the page.
 *
 * Three very large, very soft blobs drifting out of phase. The point is not
 * decoration you look at; it is that the clay surface never looks like flat
 * paper, which is what makes extruded elements believable. `aria-hidden`
 * because it carries no information, and `pointer-events-none` so it can
 * never intercept a tap.
 *
 * Fixed positioning keeps it out of the scroll flow, so it costs no layout.
 */
export function NeoBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute -top-24 right-[-10%] h-[26rem] w-[26rem] animate-blob-a rounded-full opacity-70"
        style={{
          background:
            'radial-gradient(circle at 35% 35%, rgba(255, 175, 200, 0.55) 0%, rgba(255, 175, 200, 0) 68%)',
          filter: 'blur(18px)',
        }}
      />
      <div
        className="absolute left-[-14%] top-[28%] h-[30rem] w-[30rem] animate-blob-b rounded-full opacity-60"
        style={{
          background:
            'radial-gradient(circle at 60% 40%, rgba(214, 198, 242, 0.55) 0%, rgba(214, 198, 242, 0) 70%)',
          filter: 'blur(22px)',
        }}
      />
      <div
        className="absolute bottom-[-12%] right-[6%] h-[22rem] w-[22rem] animate-blob-a rounded-full opacity-50"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(255, 214, 191, 0.5) 0%, rgba(255, 214, 191, 0) 70%)',
          filter: 'blur(20px)',
          animationDelay: '-8s',
        }}
      />
    </div>
  )
}

/**
 * A number, pressed into a clay tile.
 *
 * Recessed rather than raised, deliberately: a raised tile reads as "a button,
 * tap me", and these are readouts. The inset shadows make the digits sit *in*
 * the surface, which is the one thing neo-morphism does better than a flat
 * design can.
 */
export function NeoStat({
  value,
  unit,
  label,
  tone = 'pink',
}: {
  value: string | number
  unit: string
  label: string
  tone?: 'pink' | 'lilac'
}) {
  // Both ends of each gradient must clear 3:1 against clay-200 on their own,
  // because a gradient means every pixel in between is sampled too. The light
  // tints this design started with (blush-400, lilac-300) sat near 2:1.
  const digit =
    tone === 'pink'
      ? 'bg-gradient-to-b from-blush-700 to-blush-900 bg-clip-text text-transparent'
      : 'bg-gradient-to-b from-lilac-700 to-lilac-900 bg-clip-text text-transparent'

  return (
    <div className="flex-1 basis-0 rounded-3xl bg-clay-200 p-3 shadow-neo-in">
      {/* ink-700, not ink-500: on the recessed tile ink-500 measures 3.31:1,
          below the 4.5:1 floor for text this small. */}
      <p className="text-center text-[10.5px] font-bold leading-none text-ink-700">{label}</p>
      <div className="mt-2 flex items-baseline justify-center gap-1">
        <span className={`text-[26px] font-extrabold leading-none tabular-nums ${digit}`}>
          {value}
        </span>
        <span className="text-[10px] font-bold text-ink-700">{unit}</span>
      </div>
    </div>
  )
}
