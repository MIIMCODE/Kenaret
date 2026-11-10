import { fetchPushConfig, registerPushSubscription, deletePushSubscription, invokePushSend } from './api'
import type { PushCapability } from '../types/database'

/**
 * Web Push from the browser side.
 *
 * Three things have to line up before a phone can be woken up, and each of
 * them fails differently — so every function here answers "why not" instead of
 * throwing a generic error at the UI:
 *
 *   1. the browser supports service workers + PushManager + Notifications;
 *   2. the page is on https (or localhost) — iOS silently refuses otherwise;
 *   3. permission has been *granted* by the person.
 *
 * On iPhone and iPad there is a fourth: Safari only exposes PushManager inside
 * an **installed** web app (Add to Home Screen). A push from a plain Safari tab
 * is impossible, so `capability()` reports that case separately rather than
 * pretending the feature is broken.
 */

const B64 = /^[A-Za-z0-9\-_]+$/

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports itself as a Mac; the touch check catches that.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** True when the page is running as an installed app, not a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4))
  const binary = atob(padded + pad)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64Url(bytes: ArrayBuffer | null): string {
  if (!bytes) return ''
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Where the app currently is, so the notification can come back to it. */
function swUrl(): string {
  return `${import.meta.env.BASE_URL}sw.js`.replace(/\/{2,}/g, '/')
}

/**
 * What this device can actually do, in terms the settings screen can render.
 *
 * Deliberately does not ask for permission — that happens only on an explicit
 * tap, because a prompt the user did not ask for is the fastest way to a
 * permanent "Block".
 */
export function capability(): PushCapability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, reason: 'no-window' }
  }

  // Read the APIs off the global: in a real browser `window` *is* the global,
  // so this is equivalent there, and it keeps capability() testable in a jsdom
  // where the two objects are distinct.
  const scope = globalThis as unknown as { PushManager?: unknown; Notification?: unknown }
  const hasApi =
    'serviceWorker' in navigator && scope.PushManager != null && scope.Notification != null

  if (!hasApi) {
    return {
      supported: false,
      reason: isIos() && !isStandalone() ? 'ios-not-installed' : 'unsupported',
    }
  }

  if (window.isSecureContext === false) {
    return { supported: false, reason: 'insecure' }
  }

  return {
    supported: true,
    permission: scope.Notification
      ? (scope.Notification as { permission: NotificationPermission }).permission
      : undefined,
    subscribed: null,
    standalone: isStandalone(),
    ios: isIos(),
  }
}

/**
 * Registers (or refreshes) this device's subscription.
 *
 * Must be called from a user gesture the first time, because it triggers the
 * browser's permission prompt.
 */
export async function enablePush(): Promise<{ ok: true; endpoint: string } | { ok: false; reason: string }> {
  const state = capability()
  if (!state.supported) return { ok: false, reason: state.reason ?? 'unsupported' }

  const notifications = (globalThis as { Notification?: typeof Notification }).Notification
  if (!notifications) return { ok: false, reason: 'unsupported' }
  const permission = await notifications.requestPermission()
  if (permission !== 'granted') {
    return {
      ok: false,
      reason: permission === 'denied' ? 'denied' : 'dismissed',
    }
  }

  const registration = await navigator.serviceWorker.register(swUrl())
  await navigator.serviceWorker.ready

  const config = await fetchPushConfig()
  if (!config.enabled || !config.public_key || !B64.test(config.public_key)) {
    return { ok: false, reason: config.enabled ? 'bad-key' : 'server-disabled' }
  }

  // Reuse the existing subscription when there is one: calling subscribe()
  // again with a different key would throw InvalidStateError.
  let subscription = await registration.pushManager.getSubscription()

  if (subscription) {
    const current = subscription.options?.applicationServerKey
    const wanted = base64UrlToBytes(config.public_key)
    const sameKey =
      current != null && bytesToBase64Url(current as ArrayBuffer) === bytesToBase64Url(wanted.buffer)
    if (!sameKey) {
      await subscription.unsubscribe()
      subscription = null
    }
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(config.public_key),
      })
    } catch (error) {
      const name = (error as Error)?.name
      // Safari throws this when the user has already blocked notifications.
      return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'subscribe-failed' }
    }
  }

  const keys = subscription.toJSON().keys ?? {}
  if (!keys.p256dh || !keys.auth) return { ok: false, reason: 'missing-keys' }

  await registerPushSubscription({
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 180) : null,
  })

  return { ok: true, endpoint: subscription.endpoint }
}

/** Turns this device off. Safe to call when nothing is subscribed. */
export async function disablePush(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  const registration = await navigator.serviceWorker.getRegistration(swUrl())
  const subscription = await registration?.pushManager.getSubscription()

  if (subscription) {
    // Tell the server *before* unsubscribing: afterwards the endpoint is
    // unrecoverable and the row would linger as a dead device.
    try {
      await deletePushSubscription(subscription.endpoint)
    } catch {
      // The local unsubscribe below still matters more than the bookkeeping.
    }
    await subscription.unsubscribe()
    return
  }

  await deletePushSubscription(null)
}

/** The current device's subscription endpoint, if any (for the toggle state). */
export async function currentEndpoint(): Promise<string | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  const registration = await navigator.serviceWorker.getRegistration(swUrl())
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint ?? null
}

/**
 * Re-registers silently on app start.
 *
 * Browsers rotate endpoints without telling anyone, so a device that is
 * already subscribed must re-upsert on every load. No prompt is involved
 * because permission was granted long ago.
 */
export async function syncSubscription(): Promise<void> {
  const state = capability()
  const notifications = (globalThis as { Notification?: typeof Notification }).Notification
  if (!state.supported || notifications?.permission !== 'granted') return

  const registration = await navigator.serviceWorker.getRegistration(swUrl())
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  const keys = subscription.toJSON().keys ?? {}
  if (!keys.p256dh || !keys.auth) return

  await registerPushSubscription({
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 180) : null,
  })
}

/**
 * Asks the server to push one notification to this account right now.
 *
 * Scoped server-side to the caller's own devices, so this cannot be used to
 * ring somebody else's phone.
 */
export async function testPush(): Promise<{ sent: number; failed: number }> {
  return invokePushSend()
}
