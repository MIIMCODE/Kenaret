/**
 * "Add to home screen" detection.
 *
 * The point of installing Kenaret is that it stops being a browser tab: no
 * address bar, its own icon, and a cold start straight into the app.
 *
 * Two very different worlds have to be handled:
 *
 *   Android / desktop Chrome ship `beforeinstallprompt` and will show a native
 *   install dialog if we hold on to the event and call `prompt()`.
 *
 *   iOS Safari has no such API at all — Apple expects the user to be told, in
 *   words, to tap the Share button and pick «افزودن به صفحهی خانه». So the UI
 *   decides between "install now" and "here is how", and this module only
 *   answers the questions the UI asks.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<(available: boolean) => void>()

export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep it for the moment the user actually wants it, and stop Chrome from
    // showing its own mini-infobar on top of our own UI.
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    listeners.forEach((fn) => fn(true))
  })
}

/** Subscribe to "installable" changes; returns an unsubscribe function. */
export function onInstallAvailable(fn: (available: boolean) => void): () => void {
  listeners.add(fn)
  fn(Boolean(deferredPrompt))
  return () => listeners.delete(fn)
}

/** True when the browser can show a real install dialog right now. */
export function canPromptInstall(): boolean {
  return Boolean(deferredPrompt)
}

/** Opens the native install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
  if (choice.outcome === 'accepted') {
    deferredPrompt = null
    listeners.forEach((fn) => fn(false))
  }
  return choice.outcome === 'accepted'
}

/** Is the app already running as an installed app (not a browser tab)? */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // iOS Safari reports installed home-screen apps here, not in matchMedia.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone / iPad (iPadOS 13+ reports itself as a Mac with touch). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iOS = /iPad|iPhone|iPod/.test(ua)
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOS || iPadOS
}

/**
 * Should the "add to home screen" card be shown at all?
 *
 * Only when it can actually help: never inside the installed app, and on iOS
 * only in Safari — Chrome/Firefox on iOS cannot add to the home screen, so a
 * hint there would be wrong.
 */
export function shouldOfferInstall(): boolean {
  if (isStandalone()) return false
  if (canPromptInstall()) return true
  if (!isIos()) return false
  const ua = navigator.userAgent
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

const SEEN_KEY = 'kenaret:install-hint-seen'

/** Dismissal lasts a while, so the hint never nags. */
export function installHintDismissed(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY)
    if (!seen) return false
    const days = (Date.now() - Number(seen)) / 86_400_000
    return Number.isFinite(days) && days < 14
  } catch {
    return false
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* private mode — the hint will simply appear again next launch */
  }
}
