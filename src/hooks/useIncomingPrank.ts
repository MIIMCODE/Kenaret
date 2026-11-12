import { useEffect, useRef, useState } from 'react'
import { prankDisabledByQuery, setPrankActive } from '../lib/prank'
import { consumePrank, fetchPrankPending } from '../lib/prankApi'

/**
 * Watches for a prank somebody sent me.
 *
 * ---------------------------------------------------------------------------
 * Why this is an overlay and not a route.
 *
 * The sender's plan is "tell her to open the app" — which means the prank has
 * to land wherever she already is, not on a page she has to navigate to. A
 * route would require her to tap something, and the tapping is exactly what
 * would defuse it. So the whole app becomes the prank surface for twelve
 * seconds, and then goes back to whatever she was doing.
 *
 * How it behaves:
 *
 *  · Polls while the app is visible, and checks again immediately on focus —
 *    someone who just opened the app sees it within a second, not within a
 *    poll interval.
 *  · Fires **only when the app is in the foreground**. A prank that plays
 *    while the phone is in a pocket is a prank nobody saw, and worse, one that
 *    has already been consumed by the time she looks.
 *  · Is consumed only *after* it has actually been shown, so a crash or a
 *    closed tab leaves it armed rather than silently eating the surprise.
 *  · Never fires for the sender's own device — `prank_pending()` returns
 *    `pending: false` for them, and that is decided in SQL.
 */

const POLL_MS = 15_000

export type PrankPhase = 'idle' | 'scare' | 'reveal'

export interface IncomingPrank {
  phase: PrankPhase
  /** Move the sequence along. */
  toReveal: () => void
  finish: () => void
}

export function useIncomingPrank(enabled: boolean): IncomingPrank {
  const [phase, setPhase] = useState<PrankPhase>('idle')
  const armedRef = useRef(false)
  const checkingRef = useRef(false)
  /**
   * "Shown, but the server has not confirmed it."
   *
   * Separate from `armedRef` because they fail differently. If the consume
   * call is lost to a flaky network and we simply cleared `armedRef`, the next
   * poll fifteen seconds later would find it still pending and play the whole
   * thirty seconds again — the one outcome worse than not pranking at all is
   * pranking twice. So a shown-but-unconsumed prank blocks *replay* and
   * retries the consume instead.
   */
  const needsConsumeRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (prankDisabledByQuery(window.location.search)) return

    let cancelled = false

    function visible() {
      return document.visibilityState === 'visible'
    }

    async function check() {
      if (cancelled || armedRef.current || checkingRef.current) return
      // The one condition that matters: nobody is looking, so nobody is
      // surprised. Leave it armed until she actually comes back to the app.
      if (!visible()) return

      checkingRef.current = true
      try {
        // A prank that has already been shown but never acknowledged: finish
        // that bookkeeping before looking for another one.
        if (needsConsumeRef.current) {
          await consumePrank()
          needsConsumeRef.current = false
          return
        }

        const status = await fetchPrankPending()
        if (cancelled || !status.pending) return
        armedRef.current = true
        setPhase('scare')
      } finally {
        checkingRef.current = false
      }
    }

    void check()

    const interval = window.setInterval(() => void check(), POLL_MS)
    const onVisible = () => {
      if (visible()) void check()
    }

    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  // Hide the app shell (background + tab bar) while it plays, and lock the
  // page underneath so a swipe does not scroll the real app behind the fake
  // terminal.
  useEffect(() => {
    if (phase === 'idle') return

    setPrankActive(true)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
      setPrankActive(false)
    }
  }, [phase])

  return {
    phase,
    toReveal: () => setPhase('reveal'),
    finish: () => {
      setPhase('idle')
      needsConsumeRef.current = true

      // The server is told only after the screen has actually been shown, so a
      // crash mid-prank leaves it armed rather than silently eating the
      // surprise. If this call fails, `check()` retries it and blocks any
      // replay in the meantime.
      void consumePrank()
        .then(() => {
          needsConsumeRef.current = false
          armedRef.current = false
        })
        .catch(() => {
          // Stays blocked. The next check retries the consume rather than
          // starting the prank over.
        })
    },
  }
}
