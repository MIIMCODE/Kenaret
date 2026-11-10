-- ============================================================
-- 0014 — آلبوم ما: one photo a day, from both of you
--
-- The idea is not "a gallery". A gallery is somewhere you go when you
-- remember to. This is a *daily* thing: each of you adds one photo per day,
-- and the day itself becomes the unit — a spread with his half and her half,
-- not a post with likes under it.
--
-- The constraint is the feature:
--
--   · **One photo per person per day.** Enforced by a unique index, not by
--     the UI. That is what makes it feel like showing up together rather
--     than posting into a feed.
--   · **No captions, no comments.** If you want to say something, the chat
--     is one tap away. A caption box turns a photograph into content.
--   · **One reaction, and only one.** A single 🤍 from the other person. A
--     picker of six emoji would make the choice the point.
--
-- Deliberately absent: streaks. A streak that breaks teaches people to add a
-- photo out of obligation, and an app that makes a couple feel behind is the
-- opposite of the point. The count that is shown is total days shared, which
-- only ever goes up.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The photos
-- ------------------------------------------------------------
create table if not exists public.album_photos (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples (id) on delete cascade,
  /**
   * The *local* day of the photo, in the couple's timezone (Asia/Tehran).
   *
   * Computed server-side, never sent by the client: the day-lock is the whole
   * feature, and a client-supplied date would let someone post yesterday's
   * slot twice. Both halves of this couple live in the same timezone, so one
   * fixed zone is correct — and at 00:30 Tehran the day flips, which is what
   * anyone here would expect.
   */
  day           date not null,
  user_id       uuid not null references public.profiles (id) on delete cascade,

  /** Object path in the private `album` bucket: `<couple>/<day>/<user>-<uuid>.<ext>`. */
  storage_path  text not null,
  width         int,
  height        int,

  /** Set by the *other* person. One heart, once. */
  reacted_by    uuid references public.profiles (id) on delete set null,
  reacted_at    timestamptz,

  created_at    timestamptz not null default now()
);

comment on table public.album_photos is
  'One photo per person per day, couple-scoped. The unique index below is the day-lock.';

-- THE day lock. Not a trigger, not a check in the RPC alone: a unique index
-- means two concurrent requests cannot both win.
create unique index if not exists album_one_per_person_per_day
  on public.album_photos (couple_id, day, user_id);

-- "the album in chronological order" and "what happened on this date before"
create index if not exists album_couple_day_idx
  on public.album_photos (couple_id, day desc);

-- ------------------------------------------------------------
-- 2. RLS — read only, own couple
-- ------------------------------------------------------------
alter table public.album_photos enable row level security;

drop policy if exists album_select_own_couple on public.album_photos;
create policy album_select_own_couple on public.album_photos
  for select to authenticated
  using (couple_id = public.current_couple_id());

-- No insert/update/delete policy on purpose: every write goes through the
-- functions below, so a client can neither backdate a photo nor react to its
-- own with a forged `reacted_by`.
revoke all on public.album_photos from public, anon, authenticated;
grant select on public.album_photos to authenticated;

-- ------------------------------------------------------------
-- 3. Today, as the database sees it
-- ------------------------------------------------------------
create or replace function public.album_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Tehran')::date;
$$;

comment on function public.album_today() is
  'The couple-local day. Every album day is computed here, never trusted from the client.';

revoke all on function public.album_today() from public, anon;
grant execute on function public.album_today() to authenticated;

-- ------------------------------------------------------------
-- 4. Adding today's photo
-- ------------------------------------------------------------
create or replace function public.album_add(
  p_path   text,
  p_width  int default null,
  p_height int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_day    date := public.album_today();
  v_path   text := btrim(coalesce(p_path, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  -- The object must live under this couple's prefix, so one couple can never
  -- attach another couple's photograph to its own day.
  if v_path not like (v_couple::text || '/%') then
    raise exception 'BAD_PATH' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.album_photos a
    where a.couple_id = v_couple and a.day = v_day and a.user_id = v_uid
  ) then
    raise exception 'ALREADY_TODAY' using errcode = 'check_violation';
  end if;

  insert into public.album_photos (couple_id, day, user_id, storage_path, width, height)
  values (v_couple, v_day, v_uid, v_path, p_width, p_height)
  returning id into v_id;

  perform public.push_enqueue_album(v_id, v_couple, v_uid);

  return jsonb_build_object('id', v_id, 'day', v_day);
end;
$fn$;

revoke all on function public.album_add(text, int, int) from public, anon;
grant execute on function public.album_add(text, int, int) to authenticated;

-- ------------------------------------------------------------
-- 5. Replacing today's photo
--
-- The lock is "one per day", not "one chance". A terrible photo at 8am and a
-- good one at night is normal, so replacing is allowed — but only *today*, and
-- only your own, and the reaction is cleared because it was for a different
-- photograph.
-- ------------------------------------------------------------
create or replace function public.album_replace(
  p_path   text,
  p_width  int default null,
  p_height int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_day    date := public.album_today();
  v_path   text := btrim(coalesce(p_path, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if v_path not like (v_couple::text || '/%') then
    raise exception 'BAD_PATH' using errcode = 'check_violation';
  end if;

  update public.album_photos
     set storage_path = v_path,
         width = p_width,
         height = p_height,
         -- The heart was for the old photo; replacing the photo must not
         -- inherit it, or the app would claim someone loved an image they
         -- never saw.
         reacted_by = null,
         reacted_at = null
   where couple_id = v_couple
     and day = v_day
     and user_id = v_uid
  returning id into v_id;

  if v_id is null then
    raise exception 'NOTHING_TODAY' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('id', v_id, 'day', v_day);
end;
$fn$;

revoke all on function public.album_replace(text, int, int) from public, anon;
grant execute on function public.album_replace(text, int, int) to authenticated;

-- ------------------------------------------------------------
-- 6. Reading a range
--
-- Takes Gregorian bounds rather than a Jalali month: the client already owns
-- Jalali conversion, and duplicating that maths in SQL would be two things to
-- keep in sync for no gain.
-- ------------------------------------------------------------
create or replace function public.album_range(p_from date, p_to date)
returns table (
  id           uuid,
  day          date,
  user_id      uuid,
  storage_path text,
  width        int,
  height       int,
  reacted_at   timestamptz,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_couple uuid := public.current_couple_id();
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    return;
  end if;

  return query
  select a.id, a.day, a.user_id, a.storage_path, a.width, a.height, a.reacted_at, a.created_at
  from public.album_photos a
  where a.couple_id = v_couple
    and a.day between p_from and p_to
  order by a.day desc, a.created_at asc;
end;
$fn$;

revoke all on function public.album_range(date, date) from public, anon;
grant execute on function public.album_range(date, date) to authenticated;

-- ------------------------------------------------------------
-- 7. "یک سال قبل، امروز" — and one month, six months, a year
--
-- Same calendar day in earlier periods. This is the one feature that makes an
-- album worth keeping: it hands you the memory instead of waiting to be
-- scrolled to.
-- ------------------------------------------------------------
create or replace function public.album_on_this_day()
returns table (
  id           uuid,
  day          date,
  user_id      uuid,
  storage_path text,
  width        int,
  height       int,
  years_ago    int,
  months_ago   int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_couple uuid := public.current_couple_id();
  v_today  date := public.album_today();
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    return;
  end if;

  return query
  select a.id, a.day, a.user_id, a.storage_path, a.width, a.height,
         extract(year from age(v_today, a.day))::int,
         extract(month from age(v_today, a.day))::int
  from public.album_photos a
  where a.couple_id = v_couple
    -- Same day-of-month, in a strictly earlier month. `- interval '1 month'`
    -- on the 31st lands on the 28th/30th, which is exactly the intent.
    and extract(day from a.day) = extract(day from v_today)
    and date_trunc('month', a.day) < date_trunc('month', v_today)
  order by a.day desc
  limit 12;
end;
$fn$;

revoke all on function public.album_on_this_day() from public, anon;
grant execute on function public.album_on_this_day() to authenticated;

-- ------------------------------------------------------------
-- 8. Reacting
--
-- One heart, from the other person, once. Your own photo cannot be reacted
-- to — the point of a reaction is that somebody else saw it.
-- ------------------------------------------------------------
create or replace function public.album_react(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_row    public.album_photos;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select * into v_row from public.album_photos where id = p_id for update;

  if not found or v_row.couple_id <> v_couple then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  if v_row.user_id = v_uid then
    raise exception 'OWN_PHOTO' using errcode = 'check_violation';
  end if;

  -- Toggle, so a mistaken tap can be undone without a second function.
  if v_row.reacted_by is not null then
    update public.album_photos set reacted_by = null, reacted_at = null where id = p_id;
    return jsonb_build_object('reacted', false);
  end if;

  update public.album_photos set reacted_by = v_uid, reacted_at = now() where id = p_id;
  return jsonb_build_object('reacted', true);
end;
$fn$;

revoke all on function public.album_react(uuid) from public, anon;
grant execute on function public.album_react(uuid) to authenticated;

-- ------------------------------------------------------------
-- 9. The numbers the header shows
--
-- `days_together` only ever grows and never scolds: it counts days where at
-- least one photo exists, which is a record, not a target.
-- ------------------------------------------------------------
create or replace function public.album_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_couple uuid := public.current_couple_id();
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    return jsonb_build_object('photos', 0, 'days', 0, 'both', 0, 'mine_today', false, 'theirs_today', false);
  end if;

  return jsonb_build_object(
    'photos', (select count(*) from public.album_photos a where a.couple_id = v_couple),
    'days',   (select count(distinct a.day) from public.album_photos a where a.couple_id = v_couple),
    'both',   (select count(*) from (
                 select a.day from public.album_photos a
                 where a.couple_id = v_couple
                 group by a.day having count(distinct a.user_id) > 1
               ) d),
    'mine_today', exists (
      select 1 from public.album_photos a
      where a.couple_id = v_couple and a.day = public.album_today() and a.user_id = auth.uid()
    ),
    'theirs_today', exists (
      select 1 from public.album_photos a
      where a.couple_id = v_couple and a.day = public.album_today() and a.user_id <> auth.uid()
    )
  );
end;
$fn$;

revoke all on function public.album_stats() from public, anon;
grant execute on function public.album_stats() to authenticated;

-- ------------------------------------------------------------
-- 10. Push: "she added today's photo"
--
-- Topic is `album:<day>:<user>`, so one notification per person per day — the
-- unique (user, topic) constraint that guards every other notification guards
-- this one too.
-- ------------------------------------------------------------
create or replace function public.push_enqueue_album(
  p_photo  uuid,
  p_couple uuid,
  p_owner  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_target uuid;
  v_name   text;
  v_day    date;
begin
  select case when c.requester_id = p_owner then c.addressee_id else c.requester_id end
    into v_target
  from public.couples c
  where c.id = p_couple;

  if v_target is null then
    return;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'شریکت')
    into v_name
  from public.profiles p
  where p.id = p_owner;

  select a.day into v_day from public.album_photos a where a.id = p_photo;

  insert into public.push_queue (user_id, topic, title, body, url)
  values (
    v_target,
    'album:' || coalesce(v_day::text, p_photo::text) || ':' || p_owner::text,
    'آلبوم امروز',
    coalesce(v_name, 'شریکت') || ' عکس امروزش را گذاشت 🤍',
    '/album'
  )
  on conflict (user_id, topic) do nothing;
end;
$fn$;

-- Server-side only: a client must not be able to inject a notification.
revoke all on function public.push_enqueue_album(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 11. Storage: a private bucket, same prefix rule as chat
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'album',
  'album',
  false,
  12 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists album_media_read on storage.objects;
create policy album_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'album'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists album_media_insert on storage.objects;
create policy album_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'album'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists album_media_delete on storage.objects;
create policy album_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'album'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );
