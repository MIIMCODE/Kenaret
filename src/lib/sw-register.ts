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
        // `sw.js` keeps a stable URL, so a cached copy would hide a deploy.
        updateViaCache: 'none',
      })

      // A new deploy is ready: activate it immediately so the *next* push uses
      // the new code. Without this a waiting worker can sit by until every tab
      // closes, which on a phone that is never closed means "forever" — and the
      // old worker keeps showing the old notification icon.
      //
      // `updateViaCache: 'none'` matters just as much: `sw.js` is not
      // content-hashed, so without it the browser can keep serving a stale copy
      // from the HTTP cache and never notice a new version exists.
      const activate = (worker: ServiceWorker | null) => {
        if (worker) worker.postMessage({ type: 'SKIP_WAITING' })
      }

      if (registration.waiting && navigator.serviceWorker.controller) activate(registration.waiting)

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            activate(installing)
          }
        })
      })

      // The first install has no controller; claiming then gives one without a
      // reload, so the very first notification already uses this worker.
      void navigator.serviceWorker.ready
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
