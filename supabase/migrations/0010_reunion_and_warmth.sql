-- ============================================================
-- 0010 — The next reunion, and everyday warmth
--
-- Two gaps this closes:
--
--   1. A couple that is far apart needs a *target*. «۱۹ روز تا دیدارمون»
--      turns distance into a countdown instead of a weight.
--   2. `reminder_prefs` only knows four on/off kinds, email is still blocked
--      by an unverified sending domain, and nothing in the app lets two
--      people actually *reach* each other. This adds one deliberate tap: a
--      warm signal that lands in the partner's bell.
--
-- Both tables are couple-scoped and both die with the couple row, exactly
-- like `cycle_shares`. Neither widens what anybody can read.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reunion plans (دیدار بعدی)
-- ------------------------------------------------------------
create table if not exists public.reunions (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples (id) on delete cascade,
  meet_on    date not null,
  -- Optional and short: «فرودگاه امام، پرواز ۸ صبح».
  note       text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reunions_note_len check (note is null or char_length(note) <= 140)
);

comment on table public.reunions is
  'The next time a couple will be physically together. One row per couple; either partner may set or clear it.';

create unique index if not exists reunions_one_per_couple
  on public.reunions (couple_id);

drop trigger if exists reunions_touch_trg on public.reunions;
create trigger reunions_touch_trg
  before update on public.reunions
  for each row execute function public.touch_updated_at();

alter table public.reunions enable row level security;

drop policy if exists reunions_own_couple on public.reunions;
create policy reunions_own_couple on public.reunions
  for select to authenticated
  using (couple_id = public.current_couple_id());

-- Reads only: writes go through set_reunion()/clear_reunion(), so a client
-- cannot pin a reunion onto somebody else's couple.
revoke all on public.reunions from anon, authenticated;
grant select on public.reunions to authenticated;

/**
 * Pins or moves the next reunion for the caller's couple.
 *
 * The date may be today (they might be meeting in a few hours) but never in
 * the past: a "next time" behind you is a bug the user cannot see.
 */
create or replace function public.set_reunion(p_date date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_row    public.reunions;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if p_date is null then
    raise exception 'DATE_REQUIRED' using errcode = 'null_value_not_allowed';
  end if;

  if p_date < current_date then
    raise exception 'DATE_IN_PAST' using errcode = 'check_violation';
  end if;

  if v_note is not null and char_length(v_note) > 140 then
    v_note := left(v_note, 140);
  end if;

  insert into public.reunions (couple_id, meet_on, note, created_by)
  values (v_couple, p_date, v_note, v_uid)
  on conflict (couple_id) do update
    set meet_on    = excluded.meet_on,
        note       = excluded.note,
        updated_at = now();

  select * into v_row from public.reunions where couple_id = v_couple;

  return jsonb_build_object(
           'reunion', jsonb_build_object(
             'meet_on', v_row.meet_on,
             'note', v_row.note,
             'created_by', v_row.created_by,
             'updated_at', v_row.updated_at
           )
         );
end;
$fn$;

/** Removes the countdown. Either partner may do this. */
create or replace function public.clear_reunion()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  delete from public.reunions where couple_id = v_couple;
  return jsonb_build_object('reunion', null);
end;
$fn$;

revoke all on function public.set_reunion(date, text) from public, anon;
revoke all on function public.clear_reunion() from public, anon;
grant execute on function public.set_reunion(date, text) to authenticated;
grant execute on function public.clear_reunion() to authenticated;

-- ------------------------------------------------------------
-- 2. Warmth signals (دلم برات تنگ شده)
-- ------------------------------------------------------------
create table if not exists public.warmth (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples (id) on delete cascade,
  from_id    uuid not null references public.profiles (id) on delete cascade,
  -- The three things people actually mean with one tap.
  kind       text not null check (kind in ('miss', 'hug', 'cheer')),
  created_at timestamptz not null default now(),
  -- Set when the recipient's bell consumed it. Null = not yet seen.
  seen_at    timestamptz
);

comment on table public.warmth is
  'One-tap signals between partners. Not a chat: no text, no threads, no history page.';

create index if not exists warmth_pending_idx
  on public.warmth (couple_id, seen_at) where seen_at is null;

create index if not exists warmth_recent_idx
  on public.warmth (couple_id, created_at desc);

alter table public.warmth enable row level security;

drop policy if exists warmth_read_own_couple on public.warmth;
create policy warmth_read_own_couple on public.warmth
  for select to authenticated
  using (couple_id = public.current_couple_id());

revoke all on public.warmth from anon, authenticated;
grant select on public.warmth to authenticated;

/**
 * Sends one signal to the partner.
 *
 * Rate-limited in the database, not the UI: five per hour per sender keeps the
 * gesture meaningful and the partner's bell calm. Repeating the *same* kind
 * inside two minutes returns `ALREADY_SENT` instead of stacking, because that
 * is what a double-tap on a phone actually means.
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

  insert into public.warmth (couple_id, from_id, kind) values (v_couple, v_uid, p_kind);

  return jsonb_build_object('sent', true, 'partner_id', v_partner);
end;
$fn$;

revoke all on function public.send_warmth(text) from public, anon;
grant execute on function public.send_warmth(text) to authenticated;

/**
 * What the partner's bell should show — and the acknowledgement itself.
 *
 * Only signals addressed to me (`from_id <> auth.uid()`), only the last day,
 * and calling it marks them seen. That is why there is no "mark as read"
 * button anywhere in the UI.
 */
create or replace function public.my_warmth()
returns table (id uuid, kind text, from_name text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    return;
  end if;

  return query
    select w.id, w.kind, coalesce(p.display_name, 'شریکت'), w.created_at
    from public.warmth w
    left join public.profiles p on p.id = w.from_id
    where w.couple_id = v_couple
      and w.from_id <> v_uid
      and w.seen_at is null
      and w.created_at > now() - interval '24 hours'
    order by w.created_at;

  update public.warmth w
     set seen_at = now()
   where w.couple_id = v_couple
     and w.from_id <> v_uid
     and w.seen_at is null
     and w.created_at > now() - interval '24 hours';
end;
$fn$;

revoke all on function public.my_warmth() from public, anon;
grant execute on function public.my_warmth() to authenticated;

-- ------------------------------------------------------------
-- 3. Western digits in reminder titles
-- ------------------------------------------------------------
/**
 * «۱ ماه با هم», not «1 ماه با هم».
 *
 * The queue builds some titles by concatenating a number, which produced Latin
 * digits while every other surface rendered Persian ones. Fixed here rather
 * than in the UI so the email text matches the bell text exactly.
 */
create or replace function public.fa_digits(p_value text)
returns text
language sql immutable
set search_path = public, pg_temp
as $fn$
  select translate(p_value, '0123456789', '۰۱۲۳۴۵۶۷۸۹');
$fn$;

comment on function public.fa_digits(text) is
  'Western digits to Persian-Indic, so reminder titles match the rest of the UI.';

-- ------------------------------------------------------------
-- 4. reminder_queue: the reunion is a day worth reminding about
-- ------------------------------------------------------------
/**
 * Re-declared to add the reunion row; everything else is unchanged from 0008,
 * including the consent check on a partner's cycle.
 *
 * The reunion reminder is the only one in this app pointing at something
 * good, so it goes out the day before: «فردا می‌بینیش».
 */
create or replace function public.reminder_queue(p_day date default current_date)
returns table (
  user_id uuid, email text, display_name text, kind text, event_iso date, title text
)
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
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
           c.anniversary_date, c.id as couple_id, rn.meet_on
    from public.profiles pr
    join auth.users u on u.id = pr.id
    left join public.reminder_prefs rp on rp.user_id = pr.id
    left join public.couples c
           on c.status = 'active' and (c.requester_id = pr.id or c.addressee_id = pr.id)
    left join public.reunions rn on rn.couple_id = c.id
    where u.email_confirmed_at is not null
  loop
    continue when not p.enabled;

    -- ---------------------------------------------- reunion (the future)
    if p.meet_on = p_day then
      user_id := p.id; email := p.email; display_name := p.display_name;
      kind := 'reunion'; event_iso := p.meet_on; title := 'فردا می‌بینیش';
      return next;
    end if;

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
        title := case
                   when n_year >= 2 then public.fa_digits(n_year::text) || ' سال با هم'
                   else 'سالگرد آشنایی'
                 end;
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
          kind := 'monthly'; event_iso := monthly;
          title := public.fa_digits(n_month::text) || ' ماه با هم';
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
                     else public.fa_digits(n_days::text) || ' روز با هم'
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

-- ------------------------------------------------------------
-- 5. get_pairing_state(): expose the reunion
-- ------------------------------------------------------------
create or replace function public.get_pairing_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  with me as (
    select pairing_code from public.profiles where id = v_uid
  ),
  my_couple as (
    select c.* from public.couples c
    where c.status = 'active' and (c.requester_id = v_uid or c.addressee_id = v_uid)
    limit 1
  ),
  partner as (
    select p.id, p.display_name, p.avatar_url, p.interests, p.birth_date, p.gender
    from my_couple c
    join public.profiles p
      on p.id = case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
  ),
  reunion as (
    select r.meet_on, r.note, r.created_by
    from public.reunions r
    join my_couple c on c.id = r.couple_id
  ),
  incoming as (
    select jsonb_agg(jsonb_build_object(
             'couple_id', c.id,
             'user_id', p.id,
             'display_name', p.display_name,
             'avatar_url', p.avatar_url,
             'created_at', c.created_at
           ) order by c.created_at desc) as items
    from public.couples c
    join public.profiles p on p.id = c.requester_id
    where c.status = 'pending' and c.addressee_id = v_uid
  ),
  outgoing as (
    select jsonb_agg(jsonb_build_object(
             'couple_id', c.id,
             'user_id', p.id,
             'display_name', p.display_name,
             'avatar_url', p.avatar_url,
             'created_at', c.created_at
           ) order by c.created_at desc) as items
    from public.couples c
    join public.profiles p on p.id = c.addressee_id
    where c.status = 'pending' and c.requester_id = v_uid
  )
  select jsonb_build_object(
           'pairing_code', (select pairing_code from me),
           'partner', (select to_jsonb(partner) from partner),
           'reunion', (select to_jsonb(reunion) from reunion),
           'incoming', coalesce((select items from incoming), '[]'::jsonb),
           'outgoing', coalesce((select items from outgoing), '[]'::jsonb)
         )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_pairing_state() from public, anon;
grant execute on function public.get_pairing_state() to authenticated;

/**
 * How many signals are waiting, *without* consuming them.
 *
 * The badge needs a number on every page load, but `my_warmth()` is the
 * acknowledgement itself. Counting through that would mark a hug seen while
 * the sheet was still closed — the user would get the badge, open the bell,
 * and find nothing. So the count is a separate, read-only call.
 */
create or replace function public.unseen_warmth_count()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(count(*), 0)::int
  from public.warmth w
  where w.couple_id = public.current_couple_id()
    and w.from_id <> auth.uid()
    and w.seen_at is null
    and w.created_at > now() - interval '24 hours';
$fn$;

revoke all on function public.unseen_warmth_count() from public, anon;
grant execute on function public.unseen_warmth_count() to authenticated;
