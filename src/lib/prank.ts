import { useSyncExternalStore } from 'react'

/**
 * Whether the prank is currently on screen.
 *
 * `LiquidBackground` and `BottomNav` are mounted *outside* `<Routes>` — that is
 * deliberate, and R18 depends on it. But the prank has to hide them: a fake hack
 * that still has the site's pink glass drifting behind it, and a bottom bar you
 * could tap, is a hack that has already failed.
 *
 * So the answer is a store rather than a prop. Nothing needs to re-mount; the
 * two shell components subscribe and step aside for a moment.
 */

let active = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function setPrankActive(next: boolean) {
  if (active === next) return
  active = next
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return active
}

/** Server snapshot: the prank is never active on a first paint. */
function getServerSnapshot() {
  return false
}

export function usePrankActive(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/* ── once per session ─────────────────────────────────────────────────────── */

/**
 * The prank is a *first-time* experience, not a recurring one.
 *
 * Played every visit it stops being a surprise and starts being an obstacle —
 * and the second time it is not even a surprise. `sessionStorage` is the right
 * scope: closing the tab is what "tomorrow" looks like to a browser, and the
 * couple only gets one first evening.
 */
const SEEN_KEY = 'kenaret.pranked'

export function hasPranked(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    // No storage (private mode): skip the prank rather than risk trapping
    // someone who cannot record that they saw it.
    return true
  }
}

export function markPranked() {
  try {
    sessionStorage.setItem(SEEN_KEY, '1')
  } catch {
    // Nothing to do; the worst case is one extra prank in this tab.
  }
}

/** Dev escape hatch: `?noprank=1` skips it, for tests and screenshots. */
export function prankDisabledByQuery(search: string): boolean {
  return new URLSearchParams(search).get('noprank') === '1'
}
