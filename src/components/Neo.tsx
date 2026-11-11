/**
 * The two pieces that survived the move from neo-morphism to liquid glass.
 *
 * The file keeps its name because half the app imports from it and a rename
 * would be churn for no gain. What it contains changed:
 *
 *   · `LiquidBackground` replaced `NeoBackdrop`. Same idea — a soft moving
 *     colour field behind the page — but it is no longer decoration on one
 *     screen. It is mounted once in App, for every route, because glass with
 *     nothing behind it is just a grey box.
 *
 *   · `NeoStat` kept its name and its gradient digits, and lost its inset
 *     shadows. A number can no longer be "pressed into" a translucent pane;
 *     it sits in a `.well` now, which reads as recessed by being slightly
 *     darker than the glass around it.
 */

/**
 * The moving colour field the whole site's glass samples.
 *
 * This used to be a neo-morphism prop: three soft blobs behind the dashboard so
 * the clay surface never looked like flat paper. In the liquid-glass language it
 * is not decoration any more — it is the *light source*. A frosted pane over a
 * flat background is indistinguishable from a grey box; the depth only appears
 * when a gradient of colour passes underneath it. So this now carries the four
 * brand colours (pink, peach, lilac, a little sky) at ~80px blur, drifting over
 * 20–30s.
 *
 * It is mounted ONCE, in App, outside <Routes>. Reasons, in order of how much
 * they matter:
 *   1. Mounting it per page would restart the 24s drift on every navigation —
 *      the background would visibly *jump* each time you switched tabs.
 *   2. Four 40vmax blurred elements are the most expensive thing in the app;
 *      one instance for the lifetime of the session is the cheapest possible
 *      arrangement.
 *   3. It is `position: fixed`, so where it sits in the tree does not matter,
 *      but how often it re-renders does.
 *
 * `aria-hidden` because it carries no information; `pointer-events: none` so it
 * can never intercept a tap. Under prefers-reduced-motion the drift stops in
 * CSS — the colours stay, the movement does not.
 */
export function LiquidBackground() {
  return (
    <div aria-hidden="true" className="liquid-bg">
      <div className="liquid-blob liquid-blob--pink" />
      <div className="liquid-blob liquid-blob--peach" />
      <div className="liquid-blob liquid-blob--lilac" />
      <div className="liquid-blob liquid-blob--sky" />
    </div>
  )
}

/**
 * A number in a recessed tile.
 *
 * Recessed rather than raised, deliberately, and that has not changed: a raised
 * tile reads as "a button, tap me", and these are readouts. In glass the recess
 * is expressed by the `.well` fill — a shade darker than the card around it,
 * with the light coming from inside — because you cannot dent a translucent
 * surface with an inset shadow the way you could with clay.
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
  /*
    Both ends of each gradient must clear 4.5:1 on their own, because a gradient
    means every pixel in between gets sampled too — and these digits are small
    enough to be "normal text", not large. They sit in a `.well` inside a card,
    so the surface underneath is the lightest one on the page and the figures
    have to hold up there.

    Measured on the worst composite (well on card on the pink blob at full
    strength): blush-800 → 5.3, blush-900 → 9.0, lilac-700 → 7.0,
    lilac-900 → 11.3. `blush-700` at 4.29 was the one that did not clear, which
    is why the pink gradient starts a step darker than the lilac one.
  */
  const digit =
    tone === 'pink'
      ? 'bg-gradient-to-b from-blush-800 to-blush-900 bg-clip-text text-transparent'
      : 'bg-gradient-to-b from-lilac-700 to-lilac-900 bg-clip-text text-transparent'

  return (
    <div className="well flex-1 basis-0 rounded-3xl p-3">
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
