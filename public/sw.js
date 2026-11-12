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
 *
 * v5: the liquid-glass reskin replaced the whole stylesheet and every visual
 * class name, so a client still holding the v4 shell would render the new
 * markup against the old CSS — unlit panels, invisible text. Bumping the
 * version is what evicts it.
 *
 * Since v2 it also receives Web Push. A push arrives as a JSON payload built
 * by the `push-send` edge function:
 *
 *     { title, body, url, topic }
 *
 * and is shown with the app's own icon. `topic` is reused so a newer
 * notification for the same subject *replaces* the older one instead of
 * stacking — two «فردا می‌بینیش» cards would look like a bug.
 */

const VERSION = 'v9'
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

// ------------------------------------------------------------------
// Push notifications
// ------------------------------------------------------------------

/**
 * Where a notification should land.
 *
 * The app is served from a sub-path (`/Kenaret/`), and the payload carries an
 * in-app route (`/app`, `/dates`). Resolving against the service worker's own
 * scope keeps that correct without hard-coding the deploy path here.
 */
function resolveUrl(path) {
  try {
    return new URL(path || './', self.registration.scope).href
  } catch {
    return self.registration.scope
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // A malformed payload must still produce *something* the user can tap.
    data = { title: 'کنارت', body: event.data ? event.data.text() : '' }
  }

  const title = (data.title || 'کنارت').toString()
  const body = (data.body || '').toString()

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // Both of these are drawn from their ALPHA CHANNEL ONLY and then tinted,
      // so a full-bleed app icon becomes a solid white rectangle — which is
      // exactly what shipped in v2: a fat white blob in the status bar.
      //
      // These are the transparent, white-on-nothing heart instead (generated
      // by `icon-gen.mjs`). `badge` is the small status-bar mark; `icon` is
      // what a collapsed notification shows on builds that honour it. The
      // full-colour app icon is irrelevant here precisely because colour is
      // discarded.
      icon: resolveUrl('icons/notification-96.png'),
      badge: resolveUrl('icons/notification-96.png'),
      dir: 'rtl',
      lang: 'fa',
      // Reusing a topic collapses duplicates of the same subject.
      tag: data.topic ? `kenaret-${data.topic}` : undefined,
      renotify: false,
      data: { url: resolveUrl(data.url || './') },
    }),
  )
})

/**
 * A tap focuses the app if it is already open, and opens it otherwise.
 *
 * Without this the notification would dismiss and do nothing, which reads as
 * "the app is broken" rather than "there is nothing to see".
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || self.registration.scope

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const sameApp = clientList.find((client) => client.url.startsWith(self.registration.scope))

      if (sameApp) {
        await sameApp.focus()
        // Best effort: send the open window to the right route.
        try {
          sameApp.postMessage({ type: 'KENARET_NAVIGATE', url: target })
        } catch {
          // Ignore: focusing alone is still useful.
        }
        return
      }

      await self.clients.openWindow(target)
    })(),
  )
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
