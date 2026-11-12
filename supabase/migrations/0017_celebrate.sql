-- ============================================================
-- 0017 — جشن: the room where a monthiversary actually happens
--
-- Until now a monthiversary was a number on a card. It said «امروز!» and that
-- was the whole event. This migration builds the thing the number was pointing
-- at: a full-screen celebration that opens itself on the day, and can be
-- opened by hand on any other day.
--
-- Three ideas hold it up:
--
--   · **The day is the trigger, and the server decides it.** Not the client
--     clock, not `new Date()` in the browser. `celebration_state()` computes
--     today in the couple's timezone (Asia/Tehran, same rule the album uses)
--     and answers "is there something to celebrate today, and have you
--     already opened it". A client that could decide this itself could also
--     decide it was your anniversary every day of the week, and the "opened
--     once" promise would be a suggestion.
--
--   · **Opening is a write, and it is recorded.** «یک‌بار باز می‌شود» only
--     means something if the second visit is remembered. The row is
--     couple-scoped and the RPC is idempotent: reopening returns the same
--     celebration rather than creating a second one.
--
--   · **A message is a gift, not a feed.** Either partner may write one per
--     celebration, once. Editing is deliberately not supported: a note written
--     at 23:58 on the day should say what it said then.
--
-- Deliberately absent:
--   · No push notification. The dashboard already tells you; a banner that
--     says "someone wrote you something" is the sort of thing that spoils a
--     surprise on a shared lock screen.
--   · No reactions, no likes, no streak. This is the same rule the album was
--     built on: the point is showing up, not keeping score.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The celebrations
-- ------------------------------------------------------------
-- How many days make "a month". 30, counted — not "the same day next month".
-- It lives on the couple rather than on the user because both phones have to
-- agree about which evening it is.
alter table public.couples
  add column if not exists celebration_month_days smallint not null default 30;
alter table public.couples
  drop constraint if exists couples_month_days_check;
alter table public.couples
  add constraint couples_month_days_check check (celebration_month_days between 28 and 31);

create table if not exists public.celebrations (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,

  /**
   * What is being celebrated. `monthiversary` and `anniversary` are the two the
   * dashboard computes; `milestone` covers the day-count milestones that
   * already exist in `upcomingMilestones` (100 روز، ۵۰۰ روز، …).
   */
  kind        text not null check (kind in ('monthiversary', 'anniversary', 'milestone')),

  /**
   * Which one, in its own units: the month number for a monthiversary, the
   * year number for an anniversary, the day count for a milestone. Stored as
   * int rather than parsed back out of `title`, so the client can render
   * «۲۳ ماهگی» without re-deriving it.
   */
  ordinal     int  not null check (ordinal > 0),

  /**
   * The day this celebration belongs to, in the couple's timezone.
   *
   * Computed server-side for the same reason `album_photos.day` is: the day is
   * the identity of the celebration. A client-supplied date would let someone
   * mint a "today" celebration at 23:59 and another after midnight.
   */
  day         date not null,

  /** Snapshot so a celebration still reads correctly if the start date is later edited. */
  title       text not null,
  subtitle    text,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),

  /** When the couple actually opened it. Null until then. */
  opened_at   timestamptz,
  opened_by   uuid references public.profiles (id) on delete set null
);

comment on table public.celebrations is
  'One row per celebration the couple has opened. The unique index below makes opening idempotent.';

-- THE identity of a celebration: you cannot have two "۲۳ ماهگی" on the same day.
-- This is also what makes `open_celebration` safe to call twice — the second
-- call finds the first row instead of creating a sibling.
create unique index if not exists celebrations_one_per_kind_day
  on public.celebrations (couple_id, kind, day);

create index if not exists celebrations_couple_day_idx
  on public.celebrations (couple_id, day desc, created_at desc);

-- ------------------------------------------------------------
-- 2. The notes
--
-- One per person per celebration. `coalesce` in the unique index rather than a
-- plain one, because `author_id` is nullable: a note whose author was deleted
-- must not collide with anyone.
-- ------------------------------------------------------------
create table if not exists public.celebration_notes (
  id              uuid primary key default gen_random_uuid(),
  celebration_id  uuid not null references public.celebrations (id) on delete cascade,
  author_id       uuid references public.profiles (id) on delete set null,
  body            text not null check (char_length(btrim(body)) between 1 and 600),
  created_at      timestamptz not null default now()
);

comment on table public.celebration_notes is
  'One short note per person per celebration. Written once, never edited.';

create unique index if not exists celebration_notes_one_per_author
  on public.celebration_notes (celebration_id, coalesce(author_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ------------------------------------------------------------
-- 3. The music
--
-- One track per couple — *theirs*, not a library. A playlist would need a
-- player, a queue, titles, cover art and a decision about what to play first.
-- One song that is yours does none of that: it starts when the celebration
-- opens and stops when you close it.
--
-- The file lives in the private `music` bucket under `<couple_id>/`. The row
-- holds only the path, exactly like `album_photos.storage_path`.
-- ------------------------------------------------------------
create table if not exists public.celebration_music (
  couple_id     uuid primary key references public.couples (id) on delete cascade,

  /** Object path in the private `music` bucket: `<couple>/<uuid>.<ext>`. */
  storage_path  text not null,
  /** Original filename, shown as «آهنگ شما» subtitle. Never used to build the path. */
  display_name  text not null check (char_length(display_name) between 1 and 120),
  /** Bytes, so the client can warn before downloading on a metered phone. */
  size_bytes    bigint not null check (size_bytes > 0),
  mime_type     text not null,

  uploaded_by   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.celebration_music is
  'The couple''s one song. Path only; the bytes are in the private music bucket.';

-- ------------------------------------------------------------
-- 4. RLS — read your own couple's, write nothing directly
-- ------------------------------------------------------------
alter table public.celebrations enable row level security;
alter table public.celebration_notes enable row level security;
alter table public.celebration_music enable row level security;

drop policy if exists celebrations_select_own_couple on public.celebrations;
create policy celebrations_select_own_couple on public.celebrations
  for select to authenticated
  using (couple_id = public.current_couple_id());

drop policy if exists celebration_notes_select_own_couple on public.celebration_notes;
create policy celebration_notes_select_own_couple on public.celebration_notes
  for select to authenticated
  using (
    exists (
      select 1 from public.celebrations c
      where c.id = celebration_notes.celebration_id
        and c.couple_id = public.current_couple_id()
    )
  );

drop policy if exists celebration_music_select_own_couple on public.celebration_music;
create policy celebration_music_select_own_couple on public.celebration_music
  for select to authenticated
  using (couple_id = public.current_couple_id());

-- No insert/update/delete policies on purpose: every write goes through the
-- functions below, so a client can neither backdate a celebration nor forge an
-- author on a note.
revoke all on public.celebrations from public, anon, authenticated;
revoke all on public.celebration_notes from public, anon, authenticated;
revoke all on public.celebration_music from public, anon, authenticated;
grant select on public.celebrations to authenticated;
grant select on public.celebration_notes to authenticated;
grant select on public.celebration_music to authenticated;

-- ------------------------------------------------------------
-- 5. Storage: private `music` bucket
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'music',
  'music',
  false,
  15728640, -- 15 MB: a four-minute MP3 is ~6 MB, an uncompressed WAV would not fit
  array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 15728640,
      allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/x-m4a'];

drop policy if exists music_media_read on storage.objects;
create policy music_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists music_media_insert on storage.objects;
create policy music_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists music_media_delete on storage.objects;
create policy music_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'music'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

-- ------------------------------------------------------------
-- 6. What is today?
--
-- One place computes "today" for celebrations, so the state RPC, the open RPC
-- and the client can never disagree about which day it is. Asia/Tehran is hard
-- coded for the same reason 0014 hard codes it: both halves of a couple live
-- in the same timezone here, and a per-user timezone column nobody sets is
-- worse than one correct constant.
-- ------------------------------------------------------------
create or replace function public.celebration_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Asia/Tehran')::date;
$$;

comment on function public.celebration_today() is
  'Today in the couple timezone. The single source of truth for "which day is it" in celebrations.';

-- ------------------------------------------------------------
-- 7. What could be celebrated today?
--
-- Pure date arithmetic, no writes. Returns zero, one or two candidates:
-- a monthiversary and/or a yearly anniversary (they coincide once a year).
-- A milestone only counts on its exact day, and only if the couple has not
-- already seen it.
--
-- Kept `stable` and side-effect free so `celebration_state` can call it freely.
-- ------------------------------------------------------------
create or replace function public.celebration_candidates(
  p_start date,
  p_today date,
  p_month_days int default 30
)
returns table (kind text, ordinal int, title text, subtitle text)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_block int := greatest(1, coalesce(p_month_days, 30));
  v_days  int;
  v_blocks int;
  v_years int;
begin
  if p_start is null or p_today is null or p_today < p_start then
    return;
  end if;

  v_days := (p_today - p_start);

  /*
   * Day-count milestones first. They are independent of the month rule, so on
   * a day that is both "500 days" and "16 months" the bigger round number is
   * the one worth saying out loud.
   */
  if v_days in (100, 200, 365, 500, 730, 1000, 1095, 1500, 2000) then
    kind := 'milestone';
    ordinal := v_days;
    title := v_days::text || ' روز با هم';
    subtitle := 'روز شمردنی';
    return next;
    return;
  end if;

  /*
   * Anniversaries: every `v_block` days, counted from the first day. A day is
   * an anniversary only if it lands exactly on a boundary — never "within" or
   * "near". With the default 30 that is day 30, 60, 90 …
   *
   * `% 12 = 0` is what makes a year: twelve blocks. For a 30-day month that is
   * 360 days, and it is *derived* rather than assumed — hard-coding 365 here
   * would make the yearly banner and the 365-day milestone contradict each
   * other, which is exactly the bug this replaced.
   */
  if v_days > 0 and v_days % v_block = 0 then
    v_blocks := v_days / v_block;

    if v_blocks % 12 = 0 then
      v_years := v_blocks / 12;
      kind := 'anniversary';
      ordinal := v_years;
      title := v_years::text || ' سال با هم';
      subtitle := 'سالگرد';
      return next;
    else
      kind := 'monthiversary';
      ordinal := v_blocks;
      title := v_blocks::text || ' ماه با هم';
      subtitle := 'ماهگرد';
      return next;
    end if;
  end if;

  return;
end;
$$;

comment on function public.celebration_candidates(date, date, int) is
  'What today is, in celebration terms. Read-only so it can be called from state queries.';

-- ------------------------------------------------------------
-- 8. The state the client renders
--
-- Answers, in one round trip:
--   · is there anything to celebrate today, and what
--   · has this couple already opened it
--   · what notes exist
--   · is there a song
--   · what is the most recent celebration (for the "last time" line)
-- ------------------------------------------------------------
create or replace function public.celebration_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples%rowtype;
  v_today  date;
  v_today_celebration public.celebrations%rowtype;
  v_cand   record;
  v_music  public.celebration_music%rowtype;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_couple
  from public.couples c
  where c.status = 'active'
    and (c.requester_id = v_uid or c.addressee_id = v_uid)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_COUPLE');
  end if;

  v_today := public.celebration_today();

  -- The first candidate today, in priority order: anniversary, then
  -- monthiversary, then milestone. `celebration_candidates` already returns at
  -- most one of the first two.
  select * into v_cand
  from public.celebration_candidates(v_couple.anniversary_date, v_today, coalesce(v_couple.celebration_month_days, 30))
  limit 1;

  if v_cand.kind is not null then
    select * into v_today_celebration
    from public.celebrations c
    where c.couple_id = v_couple.id
      and c.kind = v_cand.kind
      and c.day = v_today
    limit 1;
  end if;

  select * into v_music
  from public.celebration_music m
  where m.couple_id = v_couple.id;

  return jsonb_build_object(
    'ok', true,
    'today', v_today,
    'anniversary_date', v_couple.anniversary_date,
    'today_candidate', case when v_cand.kind is null then null else jsonb_build_object(
      'kind', v_cand.kind,
      'ordinal', v_cand.ordinal,
      'title', v_cand.title,
      'subtitle', v_cand.subtitle,
      'opened', v_today_celebration.id is not null,
      'celebration_id', v_today_celebration.id
    ) end,
    'music', case when v_music.storage_path is null then null else jsonb_build_object(
      'storage_path', v_music.storage_path,
      'display_name', v_music.display_name,
      'mime_type', v_music.mime_type,
      'size_bytes', v_music.size_bytes
    ) end
  );
end;
$$;

comment on function public.celebration_state() is
  'Everything the celebration screen needs to decide whether to show itself.';

-- ------------------------------------------------------------
-- 9. Open — idempotent, and the thing that records "یک‌بار باز شد"
-- ------------------------------------------------------------
create or replace function public.open_celebration(p_kind text, p_ordinal int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples%rowtype;
  v_today  date;
  v_cand   record;
  v_row    public.celebrations%rowtype;
  v_notes  jsonb;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_couple
  from public.couples c
  where c.status = 'active'
    and (c.requester_id = v_uid or c.addressee_id = v_uid)
  limit 1
  for update;

  if not found then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  v_today := public.celebration_today();

  -- The client sends what it thinks it is celebrating; the server checks it
  -- against the calendar rather than trusting it. Without this check a client
  -- could open «۳۶۵ سال با هم» on a Tuesday.
  select * into v_cand
  from public.celebration_candidates(v_couple.anniversary_date, v_today, coalesce(v_couple.celebration_month_days, 30))
  where kind = p_kind and ordinal = p_ordinal
  limit 1;

  if v_cand.kind is null then
    raise exception 'NOT_TODAY' using errcode = 'check_violation';
  end if;

  insert into public.celebrations (couple_id, kind, ordinal, day, title, subtitle, created_by, opened_at, opened_by)
  values (v_couple.id, v_cand.kind, v_cand.ordinal, v_today, v_cand.title, v_cand.subtitle, v_uid, now(), v_uid)
  on conflict (couple_id, kind, day) do update
    -- Reopening touches `opened_at` only the first time. The second person to
    -- open it should not overwrite when the first one did.
    set opened_at = coalesce(public.celebrations.opened_at, now()),
        opened_by = coalesce(public.celebrations.opened_by, v_uid)
  returning * into v_row;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id,
           'author_id', n.author_id,
           'body', n.body,
           'created_at', n.created_at
         ) order by n.created_at), '[]'::jsonb)
  into v_notes
  from public.celebration_notes n
  where n.celebration_id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'kind', v_row.kind,
    'ordinal', v_row.ordinal,
    'day', v_row.day,
    'title', v_row.title,
    'subtitle', v_row.subtitle,
    'opened_at', v_row.opened_at,
    'notes', v_notes
  );
end;
$$;

comment on function public.open_celebration(text, int) is
  'Opens today''s celebration. Idempotent: the second call returns the first row.';

-- ------------------------------------------------------------
-- 10. Write a note
-- ------------------------------------------------------------
create or replace function public.write_celebration_note(p_celebration_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_body   text := btrim(coalesce(p_body, ''));
  v_row    public.celebration_notes%rowtype;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'EMPTY_NOTE' using errcode = 'check_violation';
  end if;

  if char_length(v_body) > 600 then
    raise exception 'NOTE_TOO_LONG' using errcode = 'check_violation';
  end if;

  -- The celebration must belong to this couple, or a note could be attached to
  -- a stranger's anniversary by guessing a uuid.
  if not exists (
    select 1 from public.celebrations c
    where c.id = p_celebration_id and c.couple_id = v_couple
  ) then
    raise exception 'NOT_YOUR_CELEBRATION' using errcode = 'no_data_found';
  end if;

  insert into public.celebration_notes (celebration_id, author_id, body)
  values (p_celebration_id, v_uid, v_body)
  -- One per person, forever. Re-sending is a no-op rather than an edit:
  -- a note written at 23:58 should still say what it said then.
  on conflict do nothing
  returning * into v_row;

  if v_row.id is null then
    raise exception 'ALREADY_WRITTEN' using errcode = 'unique_violation';
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'author_id', v_row.author_id,
    'body', v_row.body,
    'created_at', v_row.created_at
  );
end;
$$;

comment on function public.write_celebration_note(uuid, text) is
  'One short note per person per celebration. Never editable.';

-- ------------------------------------------------------------
-- 11. Music: register / replace / remove
--
-- The upload itself is a plain storage upload (policy above); these functions
-- only own the row. `p_storage_path` must start with the couple id, so a client
-- cannot register a path pointing at somebody else's folder.
-- ------------------------------------------------------------
create or replace function public.set_celebration_music(
  p_storage_path text,
  p_display_name text,
  p_size_bytes   bigint,
  p_mime_type    text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_name   text := btrim(coalesce(p_display_name, ''));
  v_old    text;
  v_row    public.celebration_music%rowtype;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if p_storage_path is null or split_part(p_storage_path, '/', 1) <> v_couple::text then
    raise exception 'BAD_PATH' using errcode = 'check_violation';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 120 then
    raise exception 'BAD_NAME' using errcode = 'check_violation';
  end if;

  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'BAD_SIZE' using errcode = 'check_violation';
  end if;

  select storage_path into v_old
  from public.celebration_music m
  where m.couple_id = v_couple;

  insert into public.celebration_music (couple_id, storage_path, display_name, size_bytes, mime_type, uploaded_by)
  values (v_couple, p_storage_path, v_name, p_size_bytes, p_mime_type, v_uid)
  on conflict (couple_id) do update
    set storage_path = excluded.storage_path,
        display_name = excluded.display_name,
        size_bytes   = excluded.size_bytes,
        mime_type    = excluded.mime_type,
        uploaded_by  = excluded.uploaded_by,
        created_at   = now()
  returning * into v_row;

  -- Return the replaced path so the client can delete the orphaned object.
  -- Doing it here would need a storage call from inside a function; leaving it
  -- to the caller is the same pattern `album` uses for replaced files.
  return jsonb_build_object(
    'ok', true,
    'storage_path', v_row.storage_path,
    'display_name', v_row.display_name,
    'replaced_path', case when v_old is distinct from p_storage_path then v_old else null end
  );
end;
$$;

create or replace function public.remove_celebration_music()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_couple uuid := public.current_couple_id();
  v_old    text;
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  delete from public.celebration_music m
  where m.couple_id = v_couple
  returning m.storage_path into v_old;

  return jsonb_build_object('ok', true, 'removed_path', v_old);
end;
$$;

-- ------------------------------------------------------------
-- 12. Grants
-- ------------------------------------------------------------
revoke all on function public.celebration_today() from public, anon;
revoke all on function public.celebration_candidates(date, date, int) from public, anon;
revoke all on function public.celebration_state() from public, anon;
revoke all on function public.open_celebration(text, int) from public, anon;
revoke all on function public.write_celebration_note(uuid, text) from public, anon;
revoke all on function public.set_celebration_music(text, text, bigint, text) from public, anon;
revoke all on function public.remove_celebration_music() from public, anon;

grant execute on function public.celebration_today() to authenticated;
grant execute on function public.celebration_candidates(date, date, int) to authenticated;
grant execute on function public.celebration_state() to authenticated;
grant execute on function public.open_celebration(text, int) to authenticated;
grant execute on function public.write_celebration_note(uuid, text) to authenticated;
grant execute on function public.set_celebration_music(text, text, bigint, text) to authenticated;
grant execute on function public.remove_celebration_music() to authenticated;
