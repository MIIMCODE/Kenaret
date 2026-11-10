-- ============================================================
-- 0011 — Push notifications (the bell that reaches a closed app)
--
-- Until now every reminder needed someone to open Kenaret. The bell is honest
-- but silent, and email is still blocked by an unverified sending domain. This
-- adds the third channel: a real Web Push notification on the phone.
--
-- How it fits together:
--
--   push_subscriptions   one row per browser/device that said yes
--   push_dispatch()      Security-definer worker: claims work, returns payloads
--   push_finish()        records the outcome, prunes dead endpoints
--   pg_cron ─(every 5m)→ pg_net → edge function `push-send` → Deno web-push
--   └→ the push service → the phone
--
-- The encryption lives in the edge function on purpose. Web Push bodies are
-- ECDH + HKDF + AES-128-GCM per RFC 8291; SQL has no business doing that, and
-- a race inside a single transaction would be invisible to the user.
--
-- Why the queue is *claimed* rather than read: the cron job and the edge
-- function can both fire at once, and a notification is user-visible. A row
-- leaves `pending` exactly once (`for update skip locked`), so a reminder
-- cannot be delivered twice, and a crash mid-send leaves it `claimed` where a
-- later sweep retries it — and where the unique constraint stops a duplicate.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Who wants to be reached, and where
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  /** The push service URL. Unique per device+browser, not per user. */
  endpoint      text not null,
  /** Base64url P-256 public key of the browser's subscription (65 bytes raw). */
  p256dh        text not null,
  /** Base64url 16-byte auth secret. */
  auth          text not null,
  /** Best-effort UA, only to help a human recognise the device in a list. */
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_ok_at    timestamptz,
  last_error    text,
  /** Set when the push service said the endpoint is gone (404/410). */
  revoked_at    timestamptz,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_key_len check (char_length(p256dh) between 80 and 100),
  constraint push_subscriptions_auth_len check (char_length(auth) between 20 and 30)
);

comment on table public.push_subscriptions is
  'One row per device that granted notification permission. Writes are RPC-only; a user only ever sees their own rows.';

create index if not exists push_subscriptions_user_live_idx
  on public.push_subscriptions (user_id) where revoked_at is null;

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- ------------------------------------------------------------
-- 2. What is waiting to be pushed
-- ------------------------------------------------------------
create table if not exists public.push_queue (
  id          bigserial primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete cascade,
  /**
   * What this is *about*, e.g. `reunion:2026-11-29` or `warmth:<uuid>`.
   * The unique constraint over (user, topic) is what makes a duplicate
   * notification impossible even if everything else races.
   */
  topic       text not null,
  title       text not null,
  body        text,
  url         text,
  status      text not null default 'pending'
              check (status in ('pending', 'claimed', 'sent', 'failed', 'skipped')),
  attempts    int not null default 0,
  claimed_at  timestamptz,
  sent_at     timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),
  constraint push_queue_once_per_topic unique (user_id, topic)
);

comment on table public.push_queue is
  'Outbox for Web Push. `(user_id, topic)` is unique, so the same reunion or hug can never be pushed twice.';

create index if not exists push_queue_pending_idx
  on public.push_queue (created_at) where status in ('pending', 'claimed');

alter table public.push_queue enable row level security;
-- No policies at all: nobody reads or writes this through the API. The worker
-- functions are the only door, and they are not executable by clients.

revoke all on public.push_queue from anon, authenticated;

-- ------------------------------------------------------------
-- 3. Subscribing (one device at a time)
-- ------------------------------------------------------------
/**
 * Stores or refreshes this device's subscription.
 *
 * Called again on every app load with the *current* subscription, because a
 * browser silently rotates endpoints. Upserting on `endpoint` keeps the row
 * count stable and revives a previously revoked device.
 */
create or replace function public.push_subscribe(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_ua  text := nullif(left(coalesce(p_user_agent, ''), 180), '');
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_endpoint), '') = '' then
    raise exception 'ENDPOINT_REQUIRED' using errcode = 'null_value_not_allowed';
  end if;

  if p_endpoint !~ '^https://' then
    raise exception 'ENDPOINT_INVALID' using errcode = 'check_violation';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, btrim(p_endpoint), p_p256dh, p_auth, v_ua)
  on conflict (endpoint) do update
    set user_id   = excluded.user_id,
        p256dh    = excluded.p256dh,
        auth      = excluded.auth,
        user_agent = coalesce(excluded.user_agent, public.push_subscriptions.user_agent),
        revoked_at = null,
        last_error = null
  returning id into v_id;

  return jsonb_build_object('subscription_id', v_id);
end;
$fn$;

/**
 * Forgets this device.
 *
 * Also used when the browser reports the subscription is gone: the endpoint
 * may already be dead, so the caller passes it instead of an id.
 */
create or replace function public.push_unsubscribe(p_endpoint text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  update public.push_subscriptions s
     set revoked_at = now()
   where s.user_id = v_uid
     and s.revoked_at is null
     and (p_endpoint is null or s.endpoint = p_endpoint);

  get diagnostics v_n = row_count;
  return jsonb_build_object('revoked', v_n);
end;
$fn$;

/** For the settings screen "this phone / that laptop" list. */
create or replace function public.my_push_devices()
returns table (id uuid, user_agent text, created_at timestamptz, last_ok_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select s.id, s.user_agent, s.created_at, s.last_ok_at
  from public.push_subscriptions s
  where s.user_id = auth.uid() and s.revoked_at is null
  order by s.created_at desc;
$fn$;

revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
revoke all on function public.push_unsubscribe(text) from public, anon;
revoke all on function public.my_push_devices() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.my_push_devices() to authenticated;

/**
 * The VAPID public key, for browsers that want to subscribe.
 *
 * Public by definition — every subscriber already receives it — but it lives
 * in vault so rotating the VAPID pair is a secret update, not a rebuild.
 * Readable by `anon` on purpose: the key is needed *before* sign-up gating
 * matters and leaks nothing on its own.
 */
create or replace function public.push_config()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v_pub text;
begin
  select decrypted_secret into v_pub
  from vault.decrypted_secrets where name = 'vapid_public_key' limit 1;

  return jsonb_build_object(
    'enabled', v_pub is not null and length(v_pub) > 60,
    'public_key', v_pub
  );
end;
$fn$;

revoke all on function public.push_config() from public;
grant execute on function public.push_config() to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Enqueueing
-- ------------------------------------------------------------
/**
 * Materialises the next few days of reminders into the outbox.
 *
 * Reads the very same `reminder_queue()` the mail job and the bell read, so a
 * push can never say something the other two channels would not. The unique
 * `(user_id, topic)` constraint means running this repeatedly is free: a row
 * that already went out is simply not inserted again.
 *
 * Only dates *ahead* are queued; anything already past is silently skipped,
 * which is what keeps the 08:00-ish sweep from pushing yesterday's news.
 */
create or replace function public.push_enqueue_reminders(p_days int default 2)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_days int := least(greatest(coalesce(p_days, 2), 1), 7);
  d date;
  r record;
  v_added int := 0;
  v_body text;
  v_url text;
begin
  for i in 0..v_days loop
    d := current_date + i;

    for r in
      select q.user_id, q.kind, q.event_iso, q.title, q.display_name
      from public.reminder_queue(d) q
    loop
      v_body := case r.kind
                  when 'reunion'  then 'فردا همدیگه رو میبینید 🤍'
                  when 'birthday' then 'تولدت مبارک 🎂'
                  when 'period'   then 'فردا شروعش است — کمی مهربان‌تر باش با خودت'
                  when 'period_partner' then 'فردا حال شریکت خوب نیست؛ یک اشاره‌ی گرم بفرست'
                  else 'یک روز مهم پیشِ روست'
                end;

      v_url := case r.kind
                 when 'reunion' then '/app'
                 when 'period'  then '/dates'
                 when 'period_partner' then '/app'
                 else '/dates'
               end;

      insert into public.push_queue (user_id, topic, title, body, url)
      values (
        r.user_id,
        r.kind || ':' || r.event_iso::text,
        r.title,
        v_body,
        v_url
      )
      on conflict (user_id, topic) do nothing;

      if found then
        v_added := v_added + 1;
      end if;
    end loop;
  end loop;

  return v_added;
end;
$fn$;

/**
 * Queues a warmth signal for the recipient's phone.
 *
 * Called from `send_warmth()`, so the push and the in-app bell are the same
 * event: if the tap succeeded, the phone is already being told.
 */
create or replace function public.push_enqueue_warmth(
  p_target  uuid,
  p_from    uuid,
  p_kind    text,
  p_warmth  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_name text;
  v_title text;
  v_body  text;
begin
  select coalesce(display_name, 'شریکت') into v_name
  from public.profiles where id = p_from;

  v_title := case p_kind
               when 'miss'  then v_name || ' دلت را تنگ کرده 🤍'
               when 'hug'   then v_name || ' یک بغل فرستاد 🫂'
               when 'cheer' then v_name || ' قوت‌قلبت را فرستاد ☀️'
               else v_name || ' بهت فکر می‌کند'
             end;
  v_body := 'برای دیدنش زنگوله را باز کن';

  insert into public.push_queue (user_id, topic, title, body, url)
  values (p_target, 'warmth:' || p_warmth::text, v_title, v_body, '/app')
  on conflict (user_id, topic) do nothing;
end;
$fn$;

revoke all on function public.push_enqueue_reminders(int) from public, anon, authenticated;
revoke all on function public.push_enqueue_warmth(uuid, uuid, text, uuid) from public, anon, authenticated;

/**
 * Parks rows whose owner has no live device once they have exhausted retries.
 *
 * Without this, an account that never installed the app accumulates `pending`
 * rows forever, and the queue stops being a useful signal. Rows that are still
 * *waiting* (attempts 0) are left alone on purpose: a phone may subscribe
 * tomorrow and should still get tomorrow's reminder.
 */
create or replace function public.push_reap()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_n int;
begin
  update public.push_queue q
     set status = 'skipped',
         claimed_at = null,
         last_error = coalesce(q.last_error, 'NO_DEVICE')
   where q.status = 'pending'
     and q.attempts >= 5
     and not exists (
       select 1 from public.push_subscriptions s
       where s.user_id = q.user_id and s.revoked_at is null
     );

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.push_reap() from public, anon, authenticated;

/**
 * Seeds one throwaway row so the "send a test" button always has something.
 *
 * The five-minute cron normally drains the queue, so by the time somebody taps
 * test there is usually nothing pending — and the first version then reported
 * a cheerful "sent" with zero sent, which reads exactly like a broken feature.
 */
create or replace function public.push_seed_test()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  -- Only worth doing when this account actually has a live device; otherwise
  -- the caller is told "this phone isn't registered" instead of a fake success.
  if not exists (
    select 1 from public.push_subscriptions s
    where s.user_id = v_uid and s.revoked_at is null
  ) then
    return 0;
  end if;

  insert into public.push_queue (user_id, topic, title, body, url, status)
  values (
    v_uid,
    'test:' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'کنارت — آزمایشی 🤍',
    'اگر این را می‌بینی، نوتیفیکیشن کار می‌کند.',
    '/app',
    'pending'
  )
  on conflict (user_id, topic) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

revoke all on function public.push_seed_test() from public, anon;
grant execute on function public.push_seed_test() to authenticated;

-- ------------------------------------------------------------
-- 5. The worker: claim, then report back
-- ------------------------------------------------------------
/**
 * Hands the edge function its next batch and marks those rows claimed.
 *
 * Returns one entry per *live device*, because the same reminder must reach a
 * phone and a laptop, and the encryption is per subscription.
 *
 * `for update skip locked` is the whole point: two concurrent workers each get
 * a different batch, and neither blocks. Rows stuck in `claimed` because the
 * function died are picked up again after ten minutes.
 */
create or replace function public.push_dispatch(p_limit int default 20, p_user uuid default null)
returns table (
  queue_id        bigint,
  user_id         uuid,
  subscription_id uuid,
  endpoint        text,
  p256dh          text,
  auth            text,
  title           text,
  body            text,
  url             text,
  topic           text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_take int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  -- Reclaim work whose worker vanished mid-flight.
  update public.push_queue q
     set status = 'pending', claimed_at = null
   where q.status = 'claimed'
     and q.claimed_at < now() - interval '10 minutes';

  return query
  with picked as (
    select q.id
    from public.push_queue q
    where q.status = 'pending'
      and q.attempts < 5
      and (p_user is null or q.user_id = p_user)
      and exists (
        select 1 from public.push_subscriptions s
        where s.user_id = q.user_id and s.revoked_at is null
      )
    order by q.created_at
    limit v_take
    for update skip locked
  ),
  claimed as (
    update public.push_queue q
       set status = 'claimed',
           claimed_at = now(),
           attempts = q.attempts + 1
      from picked
     where q.id = picked.id
    returning q.id, q.user_id, q.topic, q.title, q.body, q.url
  )
  select c.id,
         c.user_id,
         s.id,
         s.endpoint,
         s.p256dh,
         s.auth,
         c.title,
         c.body,
         c.url,
         c.topic
  from claimed c
  join public.push_subscriptions s
    on s.user_id = c.user_id and s.revoked_at is null
  order by c.id, s.created_at;
end;
$fn$;

/**
 * Records what happened to one queue row.
 *
 * `failed` with a 404/410 means the endpoint is dead for good, so it is
 * revoked here — that is how the table stays honest without a cleanup job.
 */
create or replace function public.push_finish(
  p_queue_id      bigint,
  p_ok            boolean,
  p_error         text default null,
  p_gone          boolean default false,
  p_subscription  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_user uuid;
begin
  update public.push_queue q
     set status     = case
                        when p_ok then 'sent'
                        when q.attempts >= 5 then 'failed'
                        else 'pending'
                      end,
         sent_at    = case when p_ok then now() else q.sent_at end,
         claimed_at = null,
         last_error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 300) end
   where q.id = p_queue_id
  returning q.user_id into v_user;

  -- Act on the device that was actually pushed to. An earlier version
  -- revoked *any* live device of that user whose last_ok_at was still null,
  -- so one dead phone could silence a perfectly healthy one.
  if p_subscription is not null and p_gone then
    update public.push_subscriptions s
       set revoked_at = coalesce(s.revoked_at, now()),
           last_error = left(coalesce(p_error, 'gone'), 300)
     where s.id = p_subscription;
  elsif p_subscription is not null and p_ok then
    update public.push_subscriptions s
       set last_ok_at = now(), last_error = null
     where s.id = p_subscription;
  end if;
end;
$fn$;

revoke all on function public.push_finish(bigint, boolean, text, boolean, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6. Warmth now also rings the phone
-- ------------------------------------------------------------
/**
 * Same contract as before, plus one enqueue on success. A failed push never
 * fails the tap: the signal is already stored, and the bell will show it.
 */
create or replace function public.send_warmth(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_recent  int;
  v_hourly  int;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if p_kind not in ('miss', 'hug', 'cheer') then
    raise exception 'UNKNOWN_KIND' using errcode = 'check_violation';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  v_partner := public.current_partner_id();

  select count(*) into v_recent
  from public.warmth w
  where w.couple_id = v_couple
    and w.from_id = v_uid
    and w.kind = p_kind
    and w.created_at > now() - interval '2 minutes';

  if v_recent > 0 then
    return jsonb_build_object('sent', false, 'reason', 'ALREADY_SENT');
  end if;

  select count(*) into v_hourly
  from public.warmth w
  where w.couple_id = v_couple
    and w.from_id = v_uid
    and w.created_at > now() - interval '1 hour';

  if v_hourly >= 5 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.warmth (couple_id, from_id, kind)
  values (v_couple, v_uid, p_kind)
  returning id into v_id;

  begin
    perform public.push_enqueue_warmth(v_partner, v_uid, p_kind, v_id);
  exception when others then
    -- The gesture already happened; a push problem must not undo it.
    null;
  end;

  return jsonb_build_object('sent', true, 'partner_id', v_partner);
end;
$fn$;

-- ------------------------------------------------------------
-- 7. The cron job
-- ------------------------------------------------------------
/**
 * Every five minutes: top up the outbox, then ask the edge function to send.
 *
 * `push_dispatch()` is public-readable by the edge function only (see 0012).
 * The net call is fire-and-forget: pg_net returns a request id immediately and
 * the outcome is recorded by `push_finish()` from inside the function.
 *
 * The URL is read from a vault secret so this migration can ship without
 * hard-coding the project ref twice.
 */
create or replace function public.push_cron_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_url   text;
  v_token text;
  v_added int;
  v_req   bigint;
begin
  v_added := public.push_enqueue_reminders(2);

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'push_function_url' limit 1;

  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'push_worker_token' limit 1;

  if v_url is null then
    return jsonb_build_object('queued', v_added, 'sent', false, 'reason', 'NO_URL');
  end if;

  select net.http_post(
           url := v_url,
           headers := jsonb_build_object(
                        'content-type', 'application/json',
                        'x-worker-token', coalesce(v_token, '')
                      ),
           body := jsonb_build_object('source', 'cron'),
           timeout_milliseconds := 5000
         )
  into v_req;

  return jsonb_build_object('queued', v_added, 'sent', true, 'request_id', v_req);
end;
$fn$;

revoke all on function public.push_cron_tick() from public, anon, authenticated;

-- Scheduled idempotently: drop any previous job of the same name first.
do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'kenaret-push' limit 1;
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule('kenaret-push', '*/5 * * * *', 'select public.push_cron_tick()');
end $$;
