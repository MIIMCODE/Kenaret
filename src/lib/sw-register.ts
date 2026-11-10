let deferred: Promise<void> | null = null

/**
 * Called once, after the app is usable.
 *
 * Skipped entirely in the Vite dev server on purpose: a cached
 * `index.html`/asset in development is one of the most confusing bugs there is,
 * and the site ships no hashed-hash service worker that could go stale silently.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return

  if (deferred) return
  deferred = (async () => {
    try {
      const base = import.meta.env.BASE_URL
      const registration = await navigator.serviceWorker.register(`${base}sw.js`, {
        scope: base,
      })

      // A new deploy is ready: refresh once the page is idle so the next launch
      // is guaranteed to be the new build, without yanking the page mid-tap.
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    } catch {
      // A failed registration must never break the app — it only means the
      // installed launch will need the network, which is the old behaviour.
    }
  })()
}

/**
 * Lets a tapped notification steer the *already-open* app.
 *
 * The service worker focuses the existing window and posts the route it was
 * asked to open; without this listener that message lands nowhere and the tap
 * just looks like it did nothing. `navigate` is passed in rather than imported
 * so this module stays usable outside React.
 */
export function listenForNotificationNavigation(
  navigate: (path: string) => void,
  baseUrl: string,
): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {}

  function onMessage(event: MessageEvent) {
    const data = event.data as { type?: string; url?: string } | undefined
    if (data?.type !== 'KENARET_NAVIGATE' || !data.url) return

    try {
      const target = new URL(data.url)
      const base = new URL(baseUrl, window.location.origin)
      // Only in-app paths are followed; an absolute foreign URL is ignored.
      if (target.origin !== window.location.origin) return
      const route = target.pathname.startsWith(base.pathname)
        ? target.pathname.slice(base.pathname.length - 1)
        : target.pathname
      navigate(`${route}${target.search}${target.hash}`)
    } catch {
      // Malformed message: ignore rather than navigate somewhere arbitrary.
    }
  }

  navigator.serviceWorker.addEventListener('message', onMessage)
  return () => navigator.serviceWorker.removeEventListener('message', onMessage)
}
