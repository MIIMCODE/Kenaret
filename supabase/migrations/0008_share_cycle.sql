-- ------------------------------------------------------------------
-- 0008 — Sharing the cycle, without leaking it
--
-- Until now `period_settings` was strictly owner-only, so there was no way for
-- a partner to know "she is having a hard week" — the one thing that actually
-- helps somebody be supportive.
--
-- The wrong fix is to grant the partner SELECT on period_settings: they would
-- then own her raw history, her cycle length and every stored date forever.
-- Instead this migration grants a scoped, revocable view of a **status**:
--
--   share_cycle_with_partner()  → explicit opt-in, one tap
--   stop_sharing_cycle()        → revoke at any moment; the card disappears
--   partner_cycle_status()      → a coarse phase + a countdown, never a date
--
-- Even while sharing is on the partner receives no stored date, no cycle
-- length and no period length. RLS on period_settings is untouched.
--
-- Consent is bound to the *couple* row: `unlink_partner()` deletes that row and
-- the consent cascades away with it, so re-pairing with someone new never
-- inherits an old yes.
-- ------------------------------------------------------------------

create table if not exists public.cycle_shares (
  owner_id   uuid primary key references public.profiles (id) on delete cascade,
  couple_id  uuid references public.couples (id) on delete cascade,
  enabled    boolean not null default true,
  shared_at  timestamptz not null default now(),
  revoked_at timestamptz
);

comment on table public.cycle_shares is
  'Explicit, revocable consent from a girl to show her active partner a coarse cycle phase. Bound to one couple; never grants access to period_settings.';

alter table public.cycle_shares enable row level security;

-- Owner-only. There is deliberately no partner read policy: the partner path
-- goes exclusively through the SECURITY DEFINER function below, so no client
-- can enumerate who shares what.
drop policy if exists cycle_shares_owner on public.cycle_shares;
create policy cycle_shares_owner on public.cycle_shares
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select, insert, update, delete on public.cycle_shares to authenticated;
revoke all on public.cycle_shares from anon;

-- ------------------------------------------------------------ is it shared?
create or replace function public.cycle_is_shared()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.cycle_shares s
    join public.couples c on c.id = s.couple_id and c.status = 'active'
    where s.owner_id = auth.uid()
      and s.enabled
      and s.revoked_at is null
  )
$$;

-- ------------------------------------------------------------ opt in / out
create or replace function public.share_cycle_with_partner()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_uid    uuid := auth.uid();
  v_gender text;
  v_starts date;
  v_couple uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select gender into v_gender from public.profiles where id = v_uid;
  if v_gender is distinct from 'girl' then
    raise exception 'NOT_A_GIRL' using errcode = 'check_violation';
  end if;

  select id into v_couple
  from public.couples
  where status = 'active' and (requester_id = v_uid or addressee_id = v_uid)
  limit 1;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select last_period_start into v_starts from public.period_settings where user_id = v_uid;
  if v_starts is null then
    raise exception 'NO_CYCLE_DATA' using errcode = 'no_data_found';
  end if;

  insert into public.cycle_shares (owner_id, couple_id, enabled, shared_at, revoked_at)
  values (v_uid, v_couple, true, now(), null)
  on conflict (owner_id) do update
    set couple_id  = excluded.couple_id,
        enabled    = true,
        shared_at  = now(),
        revoked_at = null;

  return jsonb_build_object('shared', true);
end;
$fn$;

create or replace function public.stop_sharing_cycle()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  update public.cycle_shares
     set enabled = false,
         revoked_at = now()
   where owner_id = v_uid;

  return jsonb_build_object('shared', false);
end;
$fn$;

-- ---------------------------------------------------- what the partner sees
/**
 * The cycle *status* for the signed-in partner, or `{ shared: false }`.
 *
 * Returns words and countdowns only:
 *   phase      'period' | 'pms' | 'calm'
 *   days_until days until the next window opens (0 = today)
 *   days_left  days remaining in the current window (0 outside it)
 *
 * No stored date, no cycle length, no period length ever leaves this function.
 * If she has not shared, revoked it, or the couple is gone: `{ shared: false }`.
 */
create or replace function public.partner_cycle_status()
returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_start   date;
  v_cycle   int;
  v_period  int;
  v_today   date := current_date;
  v_next    date;
  v_offset  int;
  v_phase   text;
  v_left    int := 0;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  -- Consent must point at the couple that is active *right now*.
  select s.owner_id into v_owner
  from public.cycle_shares s
  join public.couples c
    on c.id = s.couple_id
   and c.status = 'active'
   and (c.requester_id = v_uid or c.addressee_id = v_uid)
   and s.owner_id = case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
  where s.enabled and s.revoked_at is null
  limit 1;

  if v_owner is null then
    return jsonb_build_object('shared', false);
  end if;

  select last_period_start, cycle_length, period_length
    into v_start, v_cycle, v_period
  from public.period_settings
  where user_id = v_owner;

  if v_start is null or v_cycle is null or v_cycle < 15 or v_cycle > 60 then
    return jsonb_build_object('shared', false);
  end if;

  if v_period is null or v_period < 1 then
    v_period := 5;
  end if;

  v_next := v_start + (greatest(0, ceil((v_today - v_start)::numeric / v_cycle)::int) * v_cycle);
  while v_next < v_today loop
    v_next := v_next + v_cycle;
  end loop;

  v_offset := v_today - v_next;

  if v_offset >= -1 and v_offset < v_period then
    v_phase := 'period';
    v_left  := v_period - v_offset;
  elsif v_offset < -1 and v_offset >= -(v_period + 3) then
    v_phase := 'pms';
  else
    v_phase := 'calm';
  end if;

  return jsonb_build_object(
           'shared', true,
           'phase', v_phase,
           'days_until', greatest(0, -v_offset),
           'days_left', greatest(0, v_left)
         );
end;
$fn$;

revoke all on function public.cycle_is_shared() from public, anon;
revoke all on function public.share_cycle_with_partner() from public, anon;
revoke all on function public.stop_sharing_cycle() from public, anon;
revoke all on function public.partner_cycle_status() from public, anon;

grant execute on function public.cycle_is_shared() to authenticated;
grant execute on function public.share_cycle_with_partner() to authenticated;
grant execute on function public.stop_sharing_cycle() to authenticated;
grant execute on function public.partner_cycle_status() to authenticated;

comment on function public.partner_cycle_status() is
  'Coarse cycle phase for an active partner, only while she has shared it. Never returns raw stored dates.';
comment on function public.share_cycle_with_partner() is
  'Opt-in: show an active partner a coarse cycle phase. Revoked by stop_sharing_cycle() and by unlinking.';

-- ------------------------------------------------------------------
-- Reminders: honour the share, and stop pretending a queued mail is sent
-- ------------------------------------------------------------------

alter table public.reminder_log
  add column if not exists sent_at timestamptz,
  add column if not exists net_request_id bigint;

comment on column public.reminder_log.net_request_id is
  'pg_net request id; reconcile_reminder_delivery() turns the queued row into sent or failed from the real HTTP status.';

create index if not exists reminder_log_pending_idx
  on public.reminder_log (net_request_id)
  where status = 'queued' and net_request_id is not null;

/**
 * Replaces the old period branch of the queue so a partner's reminder is only
 * produced while she shares it. Pairing is read from `couples` rather than
 * current_partner_id(): the nightly job runs with no JWT, so auth.uid() is null
 * there and an auth-based lookup would silently never fire.
 */
create or replace function public.reminder_queue(p_day date default current_date)
returns table (
  user_id uuid, email text, display_name text, kind text, event_iso date, title text
)
language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare
  p record; start_j record; birth_j record; today_j record; this_j record;
  cand date; yearly date; monthly date;
  step int; total int; n_year int; n_month int; n_days int;
  cycle record; cycle_no int; period_at date;
  v_owner uuid; v_s record; v_partner_name text;
begin
  select * into today_j from public.to_jalali(p_day);

  for p in
    select pr.id, pr.display_name, pr.birth_date, pr.gender, u.email,
           coalesce(rp.enabled, true) as enabled,
           coalesce(rp.want_anniversary, true) as want_anniversary,
           coalesce(rp.want_birthday, true) as want_birthday,
           coalesce(rp.want_period, true) as want_period,
           c.anniversary_date, c.id as couple_id
    from public.profiles pr
    join auth.users u on u.id = pr.id
    left join public.reminder_prefs rp on rp.user_id = pr.id
    left join public.couples c
           on c.status = 'active' and (c.requester_id = pr.id or c.addressee_id = pr.id)
    where u.email_confirmed_at is not null
  loop
    continue when not p.enabled;

    if p.anniversary_date is not null and p.want_anniversary then
      select * into start_j from public.to_jalali(p.anniversary_date);

      yearly := public.from_jalali_clamped(today_j.jy, start_j.jm, start_j.jd);
      n_year := today_j.jy - start_j.jy;
      if yearly < p_day then
        yearly := public.from_jalali_clamped(today_j.jy + 1, start_j.jm, start_j.jd);
        n_year := n_year + 1;
      end if;
      if yearly = p_day then
        user_id := p.id; email := p.email; display_name := p.display_name;
        kind := 'yearly'; event_iso := yearly;
        title := case when n_year >= 2 then n_year || ' سال با هم' else 'سالگرد آشنایی' end;
        return next;
      end if;

      monthly := null;
      for step in 1..14 loop
        total := (start_j.jm - 1) + step;
        cand := public.from_jalali_clamped(start_j.jy + (total / 12), (total % 12) + 1, start_j.jd);
        if cand >= p_day then
          monthly := cand;
          exit;
        end if;
      end loop;
      if monthly = p_day then
        select * into this_j from public.to_jalali(monthly);
        n_month := (this_j.jy - start_j.jy) * 12 + (this_j.jm - start_j.jm);
        if n_month >= 1 then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'monthly'; event_iso := monthly; title := n_month || ' ماه با هم';
          return next;
        end if;
      end if;

      foreach n_days in array array[100, 200, 365, 500, 730, 1000, 1095, 1500, 2000] loop
        if p.anniversary_date + n_days = p_day then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'milestone'; event_iso := p_day;
          title := case
                     when n_days = 365 then 'یک‌سالگی'
                     when n_days = 730 then 'دو‌سالگی'
                     when n_days = 1095 then 'سه‌سالگی'
                     else n_days || ' روز با هم'
                   end;
          return next;
        end if;
      end loop;
    end if;

    if p.birth_date is not null and p.want_birthday then
      select * into birth_j from public.to_jalali(p.birth_date);
      cand := public.from_jalali_clamped(today_j.jy, birth_j.jm, birth_j.jd);
      if cand < p_day then
        cand := public.from_jalali_clamped(today_j.jy + 1, birth_j.jm, birth_j.jd);
      end if;
      if cand = p_day then
        user_id := p.id; email := p.email; display_name := p.display_name;
        kind := 'birthday'; event_iso := cand; title := 'تولدت';
        return next;
      end if;
    end if;

    if p.gender = 'girl' and p.want_period then
      select ps.last_period_start, ps.cycle_length into cycle
      from public.period_settings ps where ps.user_id = p.id;

      if found and cycle.cycle_length between 15 and 60 then
        cycle_no := greatest(0, ceil((p_day - cycle.last_period_start)::numeric / cycle.cycle_length)::int);
        period_at := cycle.last_period_start + (cycle_no * cycle.cycle_length);
        if period_at = p_day then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'period'; event_iso := period_at; title := 'شروع پریود';
          return next;
        end if;
      end if;
    end if;

    -- Her partner, only while she shares it for this couple.
    if p.gender = 'boy' and p.want_period and p.couple_id is not null then
      select case when c.requester_id = p.id then c.addressee_id else c.requester_id end
        into v_owner
      from public.couples c
      where c.id = p.couple_id;

      if v_owner is not null and exists (
        select 1 from public.cycle_shares s
        where s.owner_id = v_owner
          and s.couple_id = p.couple_id
          and s.enabled and s.revoked_at is null
      ) then
        select ps.last_period_start, ps.cycle_length into v_s
        from public.period_settings ps where ps.user_id = v_owner;

        if found and v_s.cycle_length between 15 and 60 then
          cycle_no := greatest(0, ceil((p_day - v_s.last_period_start)::numeric / v_s.cycle_length)::int);
          period_at := v_s.last_period_start + (cycle_no * v_s.cycle_length);
          if period_at = p_day then
            select pr.display_name into v_partner_name from public.profiles pr where pr.id = v_owner;
            user_id := p.id; email := p.email; display_name := p.display_name;
            kind := 'period_partner'; event_iso := period_at;
            title := 'فردا برای ' || coalesce(v_partner_name, 'شریکت') || ' روز سختی است';
            return next;
          end if;
        end if;
      end if;
    end if;
  end loop;
end;
$fn$;

revoke all on function public.reminder_queue(date) from public, anon, authenticated;

/**
 * Sends tomorrow's reminders and records only what actually happened.
 *
 * pg_net delivers asynchronously, so this function must not claim success: it
 * stores the request id and leaves the row `queued`. The next pass settles it
 * from the real HTTP reply. Without that split, a rejected mail (a 403 from an
 * unverified sending domain, say) would be recorded as `sent` forever.
 */
create or replace function public.send_reminders(p_day date default current_date)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_key    text;
  v_from   text := 'کنارت <onboarding@resend.dev>';
  v_site   text := 'https://miimcode.github.io/Kenaret/';
  v_body   text;
  v_req_id bigint;
  v_queued int := 0;
  v_skipped int := 0;
  r record;
  e record;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'resend_api_key' limit 1;

  for r in
    select q.user_id, q.email, q.display_name
    from public.reminder_queue(p_day + 1) q
    group by q.user_id, q.email, q.display_name
  loop
    v_body := '';

    for e in
      select * from public.reminder_queue(p_day + 1) q where q.user_id = r.user_id
      order by q.event_iso, q.kind
    loop
      begin
        insert into public.reminder_log (user_id, kind, event_iso, channel, status)
        values (r.user_id, e.kind, e.event_iso, 'email',
                case when v_key is null then 'skipped' else 'queued' end);
      exception when unique_violation then
        v_skipped := v_skipped + 1;
        continue;
      end;
      v_body := v_body || format('<p dir="rtl" style="margin:0 0 6px"><b>%s</b> — فردا</p>', e.title);
    end loop;

    continue when v_body = '';

    if v_key is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_req_id := net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object(
                   'from', v_from,
                   'to', r.email,
                   'subject', 'کنارت — فردا یک روز مهم داری',
                   'html', format(
                     '<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:2;font-size:15px">'
                     '<p>سلام %s،</p>%s'
                     '<p style="margin-top:18px"><a href="%s" style="color:#f9628b;font-weight:bold">در کنارت ببین</a></p>'
                     '<p style="color:#8a818a;font-size:12px">این ایمیل را از تنظیمات کنارت می‌توانی خاموش کنی.</p>'
                     '</div>',
                     coalesce(r.display_name, 'دوست من'), v_body, v_site)
                 )
    );

    update public.reminder_log l
       set net_request_id = v_req_id
     where l.user_id = r.user_id
       and l.channel = 'email'
       and l.status = 'queued'
       and l.event_iso = p_day + 1
       and l.net_request_id is null;

    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('queued', v_queued, 'skipped', v_skipped, 'for_day', p_day + 1);
end;
$fn$;

/** Settles queued rows from the real HTTP reply. Run a few minutes after send. */
create or replace function public.reconcile_reminder_delivery()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_sent int := 0;
  v_failed int := 0;
  v_pending int := 0;
  r record;
begin
  for r in
    select l.id, l.net_request_id, n.status_code, n.content::text as body
    from public.reminder_log l
    join net._http_response n on n.id = l.net_request_id
    where l.status = 'queued' and l.net_request_id is not null
  loop
    if r.status_code between 200 and 299 then
      update public.reminder_log
         set status = 'sent', sent_at = now(), detail = null
       where id = r.id;
      v_sent := v_sent + 1;
    else
      update public.reminder_log
         set status = 'failed',
             detail = left(coalesce(r.status_code::text || ' ', '') || coalesce(r.body, ''), 400)
       where id = r.id;
      v_failed := v_failed + 1;
    end if;
  end loop;

  select count(*) into v_pending
  from public.reminder_log
  where status = 'queued' and net_request_id is not null;

  return jsonb_build_object('sent', v_sent, 'failed', v_failed, 'still_pending', v_pending);
end;
$fn$;

revoke all on function public.send_reminders(date) from public, anon, authenticated;
revoke all on function public.reconcile_reminder_delivery() from public, anon, authenticated;

-- Two passes: send at 08:00 Tehran (04:30 UTC), settle the outcomes ten
-- minutes later. Requires `create extension pg_cron; create extension pg_net;`
-- and the `resend_api_key` Vault secret.
select cron.unschedule(jobid) from cron.job where jobname in ('kenaret-reminders', 'kenaret-reminder-reconcile');

select cron.schedule('kenaret-reminders', '30 4 * * *', $$ select public.send_reminders(); $$);
select cron.schedule('kenaret-reminder-reconcile', '40 4 * * *', $$ select public.reconcile_reminder_delivery(); $$);
