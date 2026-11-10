// push-send — encrypts and delivers Web Push. See migration 0011.
//
// Called every five minutes by pg_cron -> pg_net, AND called by the browser
// from the "send a test" button. Those two callers need different things, which
// is what this file is shaped around.
//
// The browser path is the fussy one. `supabase.functions.invoke()` sends
// `Authorization` and `Content-Type: application/json`, which forces a CORS
// preflight — and a function that answers OPTIONS with 405 and sends no
// `Access-Control-Allow-*` headers makes the browser reject the response
// before the app ever sees it. So:
//
//   · OPTIONS is answered explicitly, with the headers the browser asks for;
//   · every response (including errors) carries those headers, because a 500
//     without them also looks like a network failure to the client;
//   · the worker token header is allowed through, for manual admin runs.
//
// Auth is still two narrow doors: the cron worker's shared token, or a
// signed-in user's own JWT (which may only reach that user's devices).

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@kenaret.app'
const WORKER_TOKEN = Deno.env.get('PUSH_WORKER_TOKEN') ?? ''

const BATCH = 40
const CONCURRENCY = 8

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** Headers every response needs, including the preflight and any error. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, x-worker-token',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })

type Identity = { mode: 'worker' } | { mode: 'user'; userId: string }

async function authenticate(req: Request): Promise<Identity | null> {
  const token = req.headers.get('x-worker-token')
  if (WORKER_TOKEN && token && token === WORKER_TOKEN) return { mode: 'worker' }

  const authz = req.headers.get('authorization') ?? ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7) : null
  if (!jwt) return null

  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data?.user) return null
  return { mode: 'user', userId: data.user.id }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function isGone(statusCode: number | undefined): boolean {
  return statusCode === 404 || statusCode === 410
}

interface Job {
  queue_id: number
  user_id: string
  subscription_id: string
  endpoint: string
  p256dh: string
  auth: string
  title: string
  body: string | null
  url: string | null
  topic: string
}

Deno.serve(async (req) => {
  // The preflight. Answering this is what makes the browser-side test work.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: CORS })
  }

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  try {
    const who = await authenticate(req)
    if (!who) return json({ error: 'unauthorized' }, 401)

    if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
      return json({ error: 'VAPID keys are not configured' }, 500)
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

    let limit = BATCH
    try {
      const body = await req.json()
      if (who.mode === 'worker' && typeof body?.limit === 'number') {
        limit = Math.min(Math.max(body.limit, 1), BATCH)
      }
    } catch {
      // Cron sends no body; that is fine.
    }

    // A user-triggered run is always scoped to that user. The id comes from the
    // verified JWT, never from the request body.
    const onlyUser = who.mode === 'user' ? who.userId : null

    // push_dispatch claims rows atomically (for update skip locked), so a cron
    // run and a manual test cannot send the same notification twice.
    const { data: jobs, error: dispatchError } = await admin.rpc('push_dispatch', {
      p_limit: limit,
      p_user: onlyUser,
    })

    if (dispatchError) {
      console.error('push_dispatch failed', dispatchError)
      return json({ error: dispatchError.message }, 500)
    }

    const queue = ((jobs ?? []) as Job[]).filter((job) => !onlyUser || job.user_id === onlyUser)

    if (queue.length === 0) {
      return json({ ok: true, claimed: 0, sent: 0, failed: 0, mode: who.mode })
    }

    const results = await mapLimit(queue, CONCURRENCY, async (job) => {
      const payload = JSON.stringify({
        title: job.title,
        body: job.body ?? '',
        url: job.url ?? '/app',
        topic: job.topic,
      })

      try {
        await webpush.sendNotification(
          { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
          payload,
          { TTL: 60 * 60 * 12, urgency: 'normal' },
        )
        // Name the device explicitly: the previous version guessed, and a dead
        // phone could revoke a healthy one.
        await admin.rpc('push_finish', {
          p_queue_id: job.queue_id,
          p_ok: true,
          p_subscription: job.subscription_id,
        })
        return { queue_id: job.queue_id, ok: true as const }
      } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode
        const message = (error as Error)?.message ?? 'send failed'
        // 404/410 means the subscription is dead; 429/5xx deserve a retry.
        await admin.rpc('push_finish', {
          p_queue_id: job.queue_id,
          p_ok: false,
          p_error: `${statusCode ?? 'ERR'} ${message}`.slice(0, 300),
          p_gone: isGone(statusCode),
          p_subscription: job.subscription_id,
        })
        return { queue_id: job.queue_id, ok: false as const, statusCode }
      }
    })

    const sent = results.filter((r) => r.ok).length
    return json({
      ok: true,
      claimed: queue.length,
      sent,
      failed: queue.length - sent,
      mode: who.mode,
    })
  } catch (error) {
    // Even an unexpected throw must stay CORS-readable, otherwise the browser
    // reports a network error and the real cause is hidden.
    console.error('push-send crashed', error)
    return json({ error: (error as Error)?.message ?? 'internal error' }, 500)
  }
})
