// ============================================================
// push-send — encrypts and delivers Web Push
//
// Called every five minutes by pg_cron → pg_net (see migration 0011), and
// callable by a signed-in user for a one-off "test on this phone".
//
// It is the only place in the stack that holds the VAPID private key, and the
// only place that does RFC 8291 encryption — SQL has no business doing either.
//
// Why `npm:web-push` instead of hand-rolled crypto: the aes128gcm header, the
// HKDF info strings and the VAPID JWT are all easy to get subtly wrong, and a
// subtly-wrong push fails *silently* on the device. A maintained library is the
// honest choice; it is pinned to an exact version so a surprise major release
// cannot change the wire format under us.
//
// Auth is one of two narrow doors:
//   · the cron worker presents a shared token that exists only in Supabase's
//     function secrets and in the vault row the cron function reads;
//   · a signed-in user presents their own JWT, and may only reach their own
//     devices (`p_user` is pinned to them server-side, not trusted from input).
// ============================================================

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@kenaret.app'
const WORKER_TOKEN = Deno.env.get('PUSH_WORKER_TOKEN') ?? ''

/** Cap per invocation: a backlog must not blow the wall-clock limit. */
const BATCH = 40
const CONCURRENCY = 8

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
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

/** Runs `fn` over `items` with a small, fixed parallelism. */
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

/** A push-service status that means "this endpoint will never work again". */
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
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

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

  // `push_dispatch` claims rows atomically (`for update skip locked`), so a
  // cron run and a manual test cannot send the same notification twice.
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
      await admin.rpc('push_finish', { p_queue_id: job.queue_id, p_ok: true })
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
})
