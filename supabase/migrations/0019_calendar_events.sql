-- =====================================================================
-- 0019 — the shared calendar becomes writable
-- ---------------------------------------------------------------------
-- Until now «روزهای مهم» could only *read*: birthdays, anniversaries and
-- milestones were derived from data the couple had entered elsewhere. There
-- was nowhere to put the things that are only true for them — the first
-- visit, a trip, an exam, «امتحانم ساعت ۹».
--
-- This adds exactly one table for that, plus two functions that exist for a
-- privacy reason rather than a convenience one (see BELOW).
--
-- Design notes
--   · events belong to a COUPLE, not a user. A private event is private by
--     `visibility = 'private'` + `created_by`, not by living somewhere else,
--     so a couple event and a private event live in the same list and the
--     same grid.
--   · writes go through RPCs, never through the table. The table is
--     select-only for clients, so nobody can insert a row onto another
--     couple's id or flip somebody else's private event public.
--   · dates are Gregorian `date` in the DB, exactly like `reunions` and
--     `profiles.birth_date`; the Jalali calendar is a presentation concern.
-- =====================================================================

-- ------------------------------------------------------------------ table
create table if not exists public.calendar_events (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples (id) on delete cascade,
  title      text not null,
  -- Optional and short: «فرودگاه امام، پرواز ۸ صبح».
  note       text,
  event_on   date not null,
  -- An emoji, not an icon name: the set is open and the picker is free.
  emoji      text not null default '📌',
  visibility text not null default 'couple'
             check (visibility in ('couple', 'private')),
  -- Who wrote it. Kept even for a couple event, so the list can say
  -- «محمدرضا اضافه کرد» and so a private row has an owner to check against.
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint calendar_events_title_len check (char_length(btrim(title)) between 1 and 80),
  constraint calendar_events_note_len  check (note is null or char_length(note) <= 200),
  constraint calendar_events_emoji_len check (char_length(emoji) between 1 and 8)
);

comment on table public.calendar_events is
  'Couple-authored calendar entries. visibility=private rows are readable only by created_by.';
comment on column public.calendar_events.event_on is
  'Gregorian date. May be in the past (memories) or the future (plans).';

create index if not exists calendar_events_couple_date_idx
  on public.calendar_events (couple_id, event_on);

drop trigger if exists calendar_events_touch_trg on public.calendar_events;
create trigger calendar_events_touch_trg
  before update on public.calendar_events
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------- RLS
alter table public.calendar_events enable row level security;

drop policy if exists calendar_events_read on public.calendar_events;
create policy calendar_events_read on public.calendar_events
  for select to authenticated
  using (
    couple_id = public.current_couple_id()
    and (visibility = 'couple' or created_by = auth.uid())
  );

-- Reads only: writes go through the RPCs below, so a client cannot forge a
-- couple_id or publish somebody else's private row.
revoke all on public.calendar_events from anon, authenticated;
grant select on public.calendar_events to authenticated;

-- --------------------------------------------------------------- mutations
/**
 * Adds an entry to the caller's couple calendar.
 *
 * `p_visibility` is 'couple' (both see it) or 'private' (only the author).
 * The date is free — past dates are deliberate and allowed, because a calendar
 * that refuses to remember last Tuesday is a to-do list.
 */
create or replace function public.add_calendar_event(
  p_title      text,
  p_event_on   date,
  p_emoji      text default '📌',
  p_note       text default null,
  p_visibility text default 'couple'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_couple uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_emoji text := coalesce(nullif(btrim(coalesce(p_emoji, '')), ''), '📌');
  v_vis   text := coalesce(nullif(btrim(coalesce(p_visibility, '')), ''), 'couple');
  v_row   public.calendar_events;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if p_event_on is null then
    raise exception 'DATE_REQUIRED' using errcode = 'null_value_not_allowed';
  end if;

  if v_title = '' then
    raise exception 'EMPTY_TITLE' using errcode = 'check_violation';
  end if;

  if char_length(v_title) > 80 then
    v_title := left(v_title, 80);
  end if;

  if v_note is not null and char_length(v_note) > 200 then
    v_note := left(v_note, 200);
  end if;

  if char_length(v_emoji) > 8 then
    v_emoji := left(v_emoji, 8);
  end if;

  if v_vis not in ('couple', 'private') then
    raise exception 'BAD_VISIBILITY' using errcode = 'check_violation';
  end if;

  insert into public.calendar_events
    (couple_id, title, note, event_on, emoji, visibility, created_by)
  values
    (v_couple, v_title, v_note, p_event_on, v_emoji, v_vis, v_uid)
  returning * into v_row;

  return jsonb_build_object(
           'event', jsonb_build_object(
             'id', v_row.id,
             'title', v_row.title,
             'note', v_row.note,
             'event_on', v_row.event_on,
             'emoji', v_row.emoji,
             'visibility', v_row.visibility,
             'created_by', v_row.created_by
           )
         );
end;
$fn$;

/**
 * Deletes an entry.
 *
 * A couple entry may be removed by either partner — they share it, and a
 * shared thing nobody can tidy up is a trap. A PRIVATE entry may only be
 * removed by its author, which is the one case where the couple rule must not
 * apply.
 */
create or replace function public.delete_calendar_event(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_row    public.calendar_events;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select * into v_row
  from public.calendar_events
  where id = p_id and couple_id = v_couple;

  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  if v_row.visibility = 'private' and v_row.created_by <> v_uid then
    raise exception 'NOT_YOUR_EVENT' using errcode = 'insufficient_privilege';
  end if;

  delete from public.calendar_events where id = p_id;

  return jsonb_build_object('deleted', p_id);
end;
$fn$;

revoke all on function public.add_calendar_event(text, date, text, text, text) from public, anon;
revoke all on function public.delete_calendar_event(uuid) from public, anon;

grant execute on function public.add_calendar_event(text, date, text, text, text) to authenticated;
grant execute on function public.delete_calendar_event(uuid) to authenticated;

-- =====================================================================
-- BELOW — two read paths that exist because of consent
-- =====================================================================
-- The owner can read her own axis with a plain select. The PARTNER cannot,
-- and must not: `period_settings` is owner-only by policy. But the calendar is
-- now a shared surface, and the question «is Tuesday a red day?» has to be
-- answerable there without handing him her stored dates.
--
-- So both functions return a *window* (a start and an end), computed from her
-- settings, and only while `cycle_shares` is on and the couple is active.
-- A window is the minimum needed to shade cells; it says nothing about her
-- cycle length, and it is exactly what she already agreed to by turning the
-- share on. `stop_sharing_cycle()` and unlinking both revoke it instantly
-- because every call re-checks the share.
-- =====================================================================

/**
 * Her own upcoming windows — no consent needed, it is her data.
 */
create or replace function public.my_period_windows(p_months int default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_start  date;
  v_cycle  int;
  v_period int;
  v_horizon date;
  v_windows jsonb := '[]'::jsonb;
  v_next   date;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select last_period_start, cycle_length, period_length
    into v_start, v_cycle, v_period
  from public.period_settings
  where user_id = v_uid;

  if v_start is null or v_cycle is null or v_cycle < 15 or v_cycle > 60 then
    return jsonb_build_object('windows', v_windows);
  end if;

  if v_period is null or v_period < 1 then
    v_period := 5;
  end if;
  if v_period > 15 then
    v_period := 15;
  end if;

  -- Begin at the window that contains today (or the next one if today is
  -- between windows), then walk forward.
  v_next := v_start + (greatest(0, ceil((current_date - v_start)::numeric / v_cycle)::int) * v_cycle);
  while v_next < current_date - 1 loop
    v_next := v_next + v_cycle;
  end loop;

  v_horizon := (least(greatest(p_months, 1), 12) * 31) + current_date;

  while v_next <= v_horizon loop
    v_windows := v_windows || jsonb_build_object(
      'start', v_next,
      'end',   v_next + (v_period - 1)
    );
    v_next := v_next + v_cycle;
  end loop;

  return jsonb_build_object('windows', v_windows);
end;
$fn$;

/**
 * Her partner's windows — a coarse phase today, plus the next two windows,
 * and ONLY while she has shared her cycle with the active couple.
 *
 * Deliberately returns no cycle length, no last start, and at most three
 * windows: enough to shade the calendar for the next month or two, not enough
 * to reconstruct her cycle history.
 */
create or replace function public.partner_period_windows()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_owner   uuid;
  v_start   date;
  v_cycle   int;
  v_period  int;
  v_next    date;
  v_windows jsonb := '[]'::jsonb;
  v_count   int := 0;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  -- Same consent join as partner_cycle_status: the share must point at the
  -- couple that is active right now.
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
    return jsonb_build_object('shared', false, 'windows', v_windows);
  end if;

  select last_period_start, cycle_length, period_length
    into v_start, v_cycle, v_period
  from public.period_settings
  where user_id = v_owner;

  if v_start is null or v_cycle is null or v_cycle < 15 or v_cycle > 60 then
    return jsonb_build_object('shared', false, 'windows', v_windows);
  end if;

  if v_period is null or v_period < 1 then
    v_period := 5;
  end if;
  if v_period > 15 then
    v_period := 15;
  end if;

  v_next := v_start + (greatest(0, ceil((current_date - v_start)::numeric / v_cycle)::int) * v_cycle);
  while v_next < current_date - 1 loop
    v_next := v_next + v_cycle;
  end loop;

  -- Three windows, and no more. The third one reaches ~2 cycles out, which
  -- covers any month grid the user can page to without turning this into a
  -- history dump.
  while v_count < 3 loop
    v_windows := v_windows || jsonb_build_object(
      'start', v_next,
      'end',   v_next + (v_period - 1)
    );
    v_next := v_next + v_cycle;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('shared', true, 'windows', v_windows);
end;
$fn$;

revoke all on function public.my_period_windows(int) from public, anon;
revoke all on function public.partner_period_windows() from public, anon;

grant execute on function public.my_period_windows(int) to authenticated;
grant execute on function public.partner_period_windows() to authenticated;

comment on function public.my_period_windows(int) is
  'The caller''s own predicted period windows. Owner-only; no consent needed.';
comment on function public.partner_period_windows() is
  'Up to three predicted period windows for an active partner, only while she shares. Never exposes cycle length or last start.';

-- =====================================================================
-- reminders for authored events
-- =====================================================================
-- The existing reminder pipeline builds its queue from derived dates. Custom
-- entries are a different shape (one row per event, owned by the couple), so
-- they get their own additive producer; `reminder_queue()` is untouched.

/**
 * Authored calendar entries happening on `p_day`, for the people who may see
 * them. A private entry only notifies its author.
 */
create or replace function public.calendar_reminder_rows(p_day date default current_date)
returns table (
  user_id      uuid,
  kind         text,
  event_iso    date,
  title        text,
  event_id     uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    m.user_id,
    'custom'::text,
    e.event_on,
    e.title,
    e.id
  from public.calendar_events e
  join public.couples c on c.id = e.couple_id
  -- Both members, one row each; a private entry keeps only the author's row.
  cross join lateral (values (c.requester_id), (c.addressee_id)) as m(user_id)
  where e.event_on = p_day
    and c.status = 'active'
    and (e.visibility = 'couple' or m.user_id = e.created_by)
    -- The bell switch. A missing prefs row means "on", which is what the
    -- rest of the reminder system assumes too.
    and coalesce(
      (select p.enabled from public.reminder_prefs p where p.user_id = m.user_id),
      true
    );
$fn$;

revoke all on function public.calendar_reminder_rows(date) from public, anon;
grant execute on function public.calendar_reminder_rows(date) to authenticated;

comment on function public.calendar_reminder_rows(date) is
  'Authored calendar entries on a day, addressed to the people allowed to see them. Rows, not emails.';
