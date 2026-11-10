/* eslint-disable no-restricted-globals */
/**
 * Kenaret service worker — "cold start without bars".
 *
 * Its one job is to make the *app shell* load when the phone has no usable
 * network: opening the installed icon should show the app, not a dinosaur.
 *
 * The strategy is deliberately conservative:
 *
 *   · Network-first for navigations. A deploy is picked up on the next launch,
 *     and only a failed fetch falls back to the cached shell.
 *   · Cache-first only for content-hashed build assets (/assets/*), which can
 *     never change under the same URL.
 *   · Everything else (Supabase API, auth, avatars in the private bucket) is
 *     never cached. Private data must never be served from a disk cache.
 *
 * Bump VERSION when this file's caching behaviour changes; it is not derived
 * from the build, because a new hash on every deploy would empty the cache.
 */

const VERSION = 'v1'
const SHELL_CACHE = `kenaret-shell-${VERSION}`
const ASSET_CACHE = `kenaret-assets-${VERSION}`

const SHELL_URLS = ['./', './index.html', './manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('kenaret-') && !key.endsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

/** Never let a Supabase call or a signed URL end up in a cache. */
function isPrivate(url) {
  return (
    url.hostname.endsWith('.supabase.co') ||
    url.pathname.includes('/storage/v1/') ||
    url.pathname.includes('/auth/v1/') ||
    url.pathname.includes('/rest/v1/')
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isPrivate(url)) return

  // ---- navigations: the network decides, the cache is the parachute ----
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy))
          return response
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE)
          return (
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('', { status: 503, statusText: 'offline' })
          )
        }),
    )
    return
  }

  // ---- hashed build output: cache-first, immutable ----
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  // ---- icons, fonts, the OG image: stale-while-revalidate ----
  if (/\.(png|webp|svg|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        const network = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone())
            return response
          })
          .catch(() => hit)
        return hit || network
      }),
    )
  }
})
