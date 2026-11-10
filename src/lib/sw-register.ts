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
