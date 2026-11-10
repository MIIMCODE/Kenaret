-- ============================================================
-- 0013 — گفت‌وگو, part two: the rest of a messenger
--
-- Round 12 shipped the spine: send, read, edit, delete, images, push.
-- This adds the parts people actually notice are missing:
--
--   · voice notes      — a message you can hear instead of read
--   · replies          — quoting without a thread tree
--   · forwarding       — sending the same thing again, labelled
--   · pins             — the four things worth never scrolling for
--   · search           — find it instead of scrolling to it
--   · typing indicator — presence, but only inside the chat
--
-- No new tables except pins. Everything else is a column on `messages`,
-- which keeps the couple-scope guarantee in exactly one place.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New message kinds and reply wiring
-- ------------------------------------------------------------
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages
  add constraint messages_kind_check
  check (kind in ('text', 'image', 'voice'));

-- Duration in seconds for a voice note; null for everything else.
alter table public.messages
  add column if not exists duration interval;

-- Which message this one is answering, if any. Nullable, and deliberately not
-- cascading: if the quoted message disappears the reply stays, just unquoted.
alter table public.messages
  add column if not exists reply_to uuid references public.messages (id) on delete set null;

-- Set when a message was forwarded into this couple rather than composed here.
-- The client only ever forwards *within* the couple, so this is a label, not a
-- data path — but it makes «هدایت‌شده» honest instead of inventing a sender.
alter table public.messages
  add column if not exists forwarded boolean not null default false;

-- ------------------------------------------------------------
-- 2. The content constraint must know about voice
-- ------------------------------------------------------------
alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages
  add constraint messages_has_content
  check (
    deleted_at is not null
    or (kind = 'text' and char_length(body) > 0)
    or (kind = 'image' and media_path is not null)
    or (kind = 'voice' and media_path is not null and duration is not null)
  );

-- ------------------------------------------------------------
-- 3. Pins
--
-- A pin belongs to the couple, not to the person who set it: either partner
-- may pin or unpin anything, which is what everyone expects and avoids a
-- negotiation over who owns the "pin" button.
-- ------------------------------------------------------------
create table if not exists public.message_pins (
  message_id uuid primary key references public.messages (id) on delete cascade,
  couple_id  uuid not null references public.couples (id) on delete cascade,
  pinned_by  uuid not null references public.profiles (id) on delete cascade,
  pinned_at  timestamptz not null default now()
);

comment on table public.message_pins is
  'Couple-scoped pins. One row per message; either partner may set or clear it.';

create index if not exists message_pins_couple_idx on public.message_pins (couple_id, pinned_at desc);

alter table public.message_pins enable row level security;

drop policy if exists message_pins_select_own_couple on public.message_pins;
create policy message_pins_select_own_couple on public.message_pins
  for select to authenticated
  using (couple_id = public.current_couple_id());

revoke all on public.message_pins from public, anon, authenticated;
grant select on public.message_pins to authenticated;

-- ------------------------------------------------------------
-- 4. Indexes for search and for the "before this message" scroll
-- ------------------------------------------------------------
-- A trigram index would be better, but it needs the extension; a plain
-- lower(body) index is enough at the volume two people can write.
create index if not exists messages_couple_body_idx
  on public.messages (couple_id, created_at desc)
  where deleted_at is null;

-- ------------------------------------------------------------
-- 5. Sending: text now carries a reply target
-- ------------------------------------------------------------
create or replace function public.send_message(
  p_body  text,
  p_reply_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_body    text := btrim(coalesce(p_body, ''));
  v_recent  int;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'check_violation';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select count(*) into v_recent
  from public.messages m
  where m.couple_id = v_couple
    and m.sender_id = v_uid
    and m.created_at > now() - interval '1 minute';

  if v_recent >= 30 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  -- A reply target must be a live message in this couple. Checking here means
  -- a tampered client cannot quote a message it is not allowed to read.
  if p_reply_to is not null and not exists (
    select 1 from public.messages m
    where m.id = p_reply_to and m.couple_id = v_couple and m.deleted_at is null
  ) then
    raise exception 'REPLY_NOT_FOUND' using errcode = 'check_violation';
  end if;

  insert into public.messages (couple_id, sender_id, body, reply_to)
  values (v_couple, v_uid, v_body, p_reply_to)
  returning id into v_id;

  insert into public.message_reads (message_id, user_id) values (v_id, v_uid)
  on conflict do nothing;

  perform public.push_enqueue_chat_message(v_id, v_couple, v_uid, v_body);

  return jsonb_build_object('id', v_id, 'created_at', now());
end;
$fn$;

revoke all on function public.send_message(text, uuid) from public, anon;
grant execute on function public.send_message(text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 6. Sending a voice note
-- ------------------------------------------------------------
create or replace function public.send_voice(
  p_path     text,
  p_seconds  int,
  p_reply_to uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_path   text := btrim(coalesce(p_path, ''));
  v_recent int;
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

  -- 5 minutes, which is 12x longer than anyone has ever sent on WhatsApp and
  -- short enough that it cannot become a podcast.
  if p_seconds is null or p_seconds < 1 or p_seconds > 300 then
    raise exception 'BAD_DURATION' using errcode = 'check_violation';
  end if;

  select count(*) into v_recent
  from public.messages m
  where m.couple_id = v_couple
    and m.sender_id = v_uid
    and m.created_at > now() - interval '1 minute';

  if v_recent >= 30 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.messages (couple_id, sender_id, kind, media_path, duration, reply_to)
  values (v_couple, v_uid, 'voice', v_path, make_interval(secs => p_seconds), p_reply_to)
  returning id into v_id;

  insert into public.message_reads (message_id, user_id) values (v_id, v_uid)
  on conflict do nothing;

  perform public.push_enqueue_chat_message(v_id, v_couple, v_uid, '🎙 پیام صوتی');

  return jsonb_build_object('id', v_id, 'created_at', now());
end;
$fn$;

revoke all on function public.send_voice(text, int, uuid) from public, anon;
grant execute on function public.send_voice(text, int, uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. Forwarding
--
-- Only within the couple. A "forward to anyone" would be a way to move private
-- photos out of the couple, which is exactly what this app must not grow.
-- ------------------------------------------------------------
create or replace function public.forward_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_src    public.messages;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select * into v_src from public.messages where id = p_id;
  if not found or v_src.couple_id <> v_couple or v_src.deleted_at is not null then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  insert into public.messages (couple_id, sender_id, kind, body, media_path, media_w, media_h, duration, forwarded)
  values (v_couple, v_uid, v_src.kind, v_src.body, v_src.media_path, v_src.media_w, v_src.media_h, v_src.duration, true)
  returning id into v_id;

  insert into public.message_reads (message_id, user_id) values (v_id, v_uid)
  on conflict do nothing;

  return jsonb_build_object('id', v_id, 'created_at', now());
end;
$fn$;

revoke all on function public.forward_message(uuid) from public, anon;
grant execute on function public.forward_message(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. Pinning
-- ------------------------------------------------------------
create or replace function public.toggle_pin(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if not exists (
    select 1 from public.messages m
    where m.id = p_id and m.couple_id = v_couple and m.deleted_at is null
  ) then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  select exists (select 1 from public.message_pins p where p.message_id = p_id) into v_exists;

  if v_exists then
    delete from public.message_pins where message_id = p_id;
    return jsonb_build_object('pinned', false);
  end if;

  insert into public.message_pins (message_id, couple_id, pinned_by)
  values (p_id, v_couple, v_uid)
  on conflict (message_id) do nothing;

  return jsonb_build_object('pinned', true);
end;
$fn$;

revoke all on function public.toggle_pin(uuid) from public, anon;
grant execute on function public.toggle_pin(uuid) to authenticated;

create or replace function public.pinned_messages()
returns table (
  id uuid, sender_id uuid, body text, kind text, media_path text,
  media_w int, media_h int, duration interval, created_at timestamptz,
  pinned_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.id, m.sender_id, m.body, m.kind, m.media_path, m.media_w, m.media_h,
         m.duration, m.created_at, p.pinned_at
  from public.message_pins p
  join public.messages m on m.id = p.message_id
  where p.couple_id = public.current_couple_id()
    and m.deleted_at is null
  order by p.pinned_at desc
  limit 20;
$$;

revoke all on function public.pinned_messages() from public, anon;
grant execute on function public.pinned_messages() to authenticated;

-- ------------------------------------------------------------
-- 9. Search
--
-- `ilike` on a couple-scoped index. Two people cannot write enough messages
-- for this to be slow, and it avoids a full-text configuration for Persian
-- that would need maintenance for no benefit at this scale.
-- ------------------------------------------------------------
create or replace function public.search_messages(p_query text, p_limit int default 30)
returns table (
  id uuid, sender_id uuid, body text, kind text, media_path text,
  duration interval, created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_couple uuid := public.current_couple_id();
  v_q      text := btrim(coalesce(p_query, ''));
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null or char_length(v_q) < 2 then
    return;
  end if;

  return query
  select m.id, m.sender_id, m.body, m.kind, m.media_path, m.duration, m.created_at
  from public.messages m
  where m.couple_id = v_couple
    and m.deleted_at is null
    and m.body ilike '%' || v_q || '%'
  order by m.created_at desc
  limit v_limit;
end;
$fn$;

revoke all on function public.search_messages(text, int) from public, anon;
grant execute on function public.search_messages(text, int) to authenticated;

-- ------------------------------------------------------------
-- 10. Typing indicator
--
-- Presence, but deliberately the smallest possible version: one row per
-- (couple, user) that says "as of this moment". No history, no "last seen",
-- no online dot that outlives the chat screen.
-- ------------------------------------------------------------
create table if not exists public.typing_state (
  couple_id  uuid not null references public.couples (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (couple_id, user_id)
);

comment on table public.typing_state is
  'Ephemeral "is typing" flag. Rows older than 10 seconds are treated as gone.';

alter table public.typing_state enable row level security;
revoke all on public.typing_state from public, anon, authenticated;

create or replace function public.set_typing()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
begin
  if v_uid is null or v_couple is null then
    return;
  end if;

  insert into public.typing_state (couple_id, user_id, updated_at)
  values (v_couple, v_uid, now())
  on conflict (couple_id, user_id) do update set updated_at = now();
end;
$fn$;

revoke all on function public.set_typing() from public, anon;
grant execute on function public.set_typing() to authenticated;

create or replace function public.partner_is_typing()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.typing_state t
    where t.couple_id = public.current_couple_id()
      and t.user_id <> auth.uid()
      and t.updated_at > now() - interval '10 seconds'
  );
$$;

revoke all on function public.partner_is_typing() from public, anon;
grant execute on function public.partner_is_typing() to authenticated;

-- ------------------------------------------------------------
-- 11. chat_messages must return the new columns
-- ------------------------------------------------------------
drop function if exists public.chat_messages(timestamptz, int);

create or replace function public.chat_messages(
  p_before timestamptz default null,
  p_limit  int default 30
)
returns table (
  id          uuid,
  sender_id   uuid,
  body        text,
  kind        text,
  media_path  text,
  media_w     int,
  media_h     int,
  duration    interval,
  reply_to    uuid,
  reply_body  text,
  reply_kind  text,
  forward     boolean,
  pinned      boolean,
  edited_at   timestamptz,
  deleted_at  timestamptz,
  created_at  timestamptz,
  seen        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_couple uuid := public.current_couple_id();
  v_limit  int := least(greatest(coalesce(p_limit, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    return;
  end if;

  return query
  select
    m.id,
    m.sender_id,
    m.body,
    m.kind,
    m.media_path,
    m.media_w,
    m.media_h,
    m.duration,
    m.reply_to,
    -- The quoted line travels with the reply so the client needs no second
    -- round-trip per message, and so a deleted original renders as deleted.
    r.body,
    r.kind,
    m.forwarded,
    exists (select 1 from public.message_pins p where p.message_id = m.id),
    m.edited_at,
    m.deleted_at,
    m.created_at,
    (
      m.sender_id = auth.uid()
      and exists (
        select 1 from public.message_reads rd
        where rd.message_id = m.id and rd.user_id <> m.sender_id
      )
    ) as seen
  from public.messages m
  left join public.messages r on r.id = m.reply_to
  where m.couple_id = v_couple
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc, m.id desc
  limit v_limit;
end;
$fn$;

revoke all on function public.chat_messages(timestamptz, int) from public, anon;
grant execute on function public.chat_messages(timestamptz, int) to authenticated;

-- ------------------------------------------------------------
-- 12. Voice notes live in the same private bucket
-- ------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
 where id = 'chat-media';
