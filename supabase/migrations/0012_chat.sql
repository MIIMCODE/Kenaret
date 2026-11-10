-- ============================================================
-- 0012 — گفت‌وگو: a real two-way chat
--
-- Rounds 1–11 deliberately kept this app free of a text inbox: warmth
-- was three taps and nothing else, and the README said in as many words
-- that "the moment it grows a message box it becomes another inbox to
-- feel guilty about". The user has now asked for the message box, and
-- the usage data backs them up: warmth had been tapped exactly zero
-- times. A feature nobody uses is not a safeguard, it is a gap.
--
-- So this is a real chat, with the constraints that make one survivable
-- between two people who are not running a support desk:
--
--   · couple-scoped — a message belongs to the couple, and dies with it
--   · RPC-only writes — no direct insert grant, so a client cannot plant
--     a message in someone else's couple
--   · edits and deletes are allowed, but an edit is *marked*; silently
--     rewriting something the other person already read is a lie
--   · reads are tracked per message per user, so unread is exact
--   · it reuses `push_queue` completely: a new message is one row with
--     the topic `msg:<id>`, so duplicate delivery remains impossible by
--     the same unique constraint that guards every other notification
-- ============================================================

-- ------------------------------------------------------------
-- 1. Messages
-- ------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,
  sender_id   uuid not null references public.profiles (id) on delete cascade,

  -- 2000 characters: long enough to say the thing you were avoiding,
  -- short enough that it stays a message and not an essay.
  body        text not null default '',

  /** `text` is the default. `image` bodies are empty and point at `media_path`. */
  kind        text not null default 'text'
              check (kind in ('text', 'image')),

  /** Object path inside the private `chat-media` bucket. */
  media_path  text,
  media_w     int,
  media_h     int,

  /** Set when the sender edits. The UI shows «ویرایش‌شده». */
  edited_at   timestamptz,
  /** Soft delete: the other person's copy says «پیام حذف شد» rather than vanishing. */
  deleted_at  timestamptz,

  created_at  timestamptz not null default now(),

  -- A message must actually carry something, unless it was deleted.
  constraint messages_has_content check (
    deleted_at is not null
    or (kind = 'text' and char_length(body) > 0)
    or (kind = 'image' and media_path is not null)
  ),
  constraint messages_body_len check (char_length(body) <= 2000)
);

comment on table public.messages is
  'Couple-scoped chat messages. RPC-only writes; a message belongs to the couple, not to the sender.';

-- Pagination is always "newest first, before a cursor".
create index if not exists messages_couple_created_idx
  on public.messages (couple_id, created_at desc, id desc);

-- ------------------------------------------------------------
-- 2. Read receipts
--
-- One row per (message, reader). A message is unread for you if the
-- other person sent it and there is no row for you. This is exact, it
-- survives multiple devices, and it makes "seen" a real signal rather
-- than a guess.
-- ------------------------------------------------------------
create table if not exists public.message_reads (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (message_id, user_id)
);

comment on table public.message_reads is
  'Per-message, per-user read state. Absence of a row means unread.';

create index if not exists message_reads_user_idx on public.message_reads (user_id);

-- ------------------------------------------------------------
-- 3. RLS — read only, and only your own couple
-- ------------------------------------------------------------
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

drop policy if exists messages_select_own_couple on public.messages;
create policy messages_select_own_couple on public.messages
  for select to authenticated
  using (couple_id = public.current_couple_id());

drop policy if exists message_reads_select_own on public.message_reads;
create policy message_reads_select_own on public.message_reads
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.messages m
      where m.id = message_reads.message_id
        and m.couple_id = public.current_couple_id()
    )
  );

-- There is deliberately no insert/update/delete policy: every write goes
-- through the functions below. A direct `insert into public.messages`
-- from the browser is rejected by RLS, not merely discouraged.

revoke all on public.messages from public, anon, authenticated;
grant select on public.messages to authenticated;
revoke all on public.message_reads from public, anon, authenticated;
grant select on public.message_reads to authenticated;

-- ------------------------------------------------------------
-- 4. Which couple is this?
--
-- The media bucket is keyed on the couple id, so the client must know it to
-- build an upload path. `get_pairing_state()` deliberately does not carry it
-- (the dashboard has no use for it), so this is a separate, minimal accessor.
-- ------------------------------------------------------------
create or replace function public.current_couple()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'id', c.id,
           'partner_id',
             case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
         )
  from public.couples c
  where c.status = 'active'
    and (c.requester_id = auth.uid() or c.addressee_id = auth.uid())
  limit 1;
$$;

revoke all on function public.current_couple() from public, anon;
grant execute on function public.current_couple() to authenticated;

-- ------------------------------------------------------------
-- 5. Sending
-- ------------------------------------------------------------
create or replace function public.send_message(p_body text)
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

  -- Rate limit in the database, not the UI: 30 messages a minute is far
  -- above a human typing and far below a runaway loop.
  select count(*) into v_recent
  from public.messages m
  where m.couple_id = v_couple
    and m.sender_id = v_uid
    and m.created_at > now() - interval '1 minute';

  if v_recent >= 30 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.messages (couple_id, sender_id, body)
  values (v_couple, v_uid, v_body)
  returning id into v_id;

  -- The sender has obviously read their own message.
  insert into public.message_reads (message_id, user_id)
  values (v_id, v_uid)
  on conflict do nothing;

  perform public.push_enqueue_chat_message(v_id, v_couple, v_uid, v_body);

  return jsonb_build_object('id', v_id, 'created_at', now());
end;
$fn$;

revoke all on function public.send_message(text) from public, anon;
grant execute on function public.send_message(text) to authenticated;

-- ------------------------------------------------------------
-- 6. Sending an image
-- ------------------------------------------------------------
create or replace function public.send_image(p_path text, p_w int default null, p_h int default null)
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

  -- The object must live under this couple's prefix, so one couple can
  -- never attach another couple's photo to a message.
  if v_path not like (v_couple::text || '/%') then
    raise exception 'BAD_PATH' using errcode = 'check_violation';
  end if;

  select count(*) into v_recent
  from public.messages m
  where m.couple_id = v_couple
    and m.sender_id = v_uid
    and m.created_at > now() - interval '1 minute';

  if v_recent >= 30 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.messages (couple_id, sender_id, kind, media_path, media_w, media_h)
  values (v_couple, v_uid, 'image', v_path, p_w, p_h)
  returning id into v_id;

  insert into public.message_reads (message_id, user_id) values (v_id, v_uid) on conflict do nothing;

  perform public.push_enqueue_chat_message(v_id, v_couple, v_uid, '📷 عکس فرستاد');

  return jsonb_build_object('id', v_id, 'created_at', now());
end;
$fn$;

revoke all on function public.send_image(text, int, int) from public, anon;
grant execute on function public.send_image(text, int, int) to authenticated;

-- ------------------------------------------------------------
-- 7. Reading — a page of history, newest first
-- ------------------------------------------------------------
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
    m.edited_at,
    m.deleted_at,
    m.created_at,
    -- `seen` means "your partner has read it", which is only meaningful
    -- on messages *you* sent. Computed on the server so the client never
    -- has to infer it from a read row it may not be allowed to see.
    (
      m.sender_id = auth.uid()
      and exists (
        select 1 from public.message_reads r
        where r.message_id = m.id and r.user_id <> m.sender_id
      )
    ) as seen
  from public.messages m
  where m.couple_id = v_couple
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc, m.id desc
  limit v_limit;
end;
$fn$;

revoke all on function public.chat_messages(timestamptz, int) from public, anon;
grant execute on function public.chat_messages(timestamptz, int) to authenticated;

-- ------------------------------------------------------------
-- 8. Unread count — cheap, read-only, safe to poll
-- ------------------------------------------------------------
create or replace function public.unread_message_count()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(count(*), 0)::int
  from public.messages m
  where m.couple_id = public.current_couple_id()
    and m.sender_id <> auth.uid()
    and m.deleted_at is null
    and not exists (
      select 1 from public.message_reads r
      where r.message_id = m.id and r.user_id = auth.uid()
    );
$$;

revoke all on function public.unread_message_count() from public, anon;
grant execute on function public.unread_message_count() to authenticated;

-- ------------------------------------------------------------
-- 9. Marking read
--
-- `p_until` lets the client say "everything up to here", which is what
-- opening the screen actually means. Defaulting to now() covers the case
-- where the client has no cursor.
-- ------------------------------------------------------------
create or replace function public.mark_messages_read(p_until timestamptz default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_until  timestamptz := coalesce(p_until, now());
  v_added  int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  if v_couple is null then
    return 0;
  end if;

  with fresh as (
    insert into public.message_reads (message_id, user_id)
    select m.id, v_uid
    from public.messages m
    where m.couple_id = v_couple
      and m.sender_id <> v_uid
      and m.created_at <= v_until
      and m.deleted_at is null
    on conflict (message_id, user_id) do nothing
    returning 1
  )
  select count(*) into v_added from fresh;

  return v_added;
end;
$fn$;

revoke all on function public.mark_messages_read(timestamptz) from public, anon;
grant execute on function public.mark_messages_read(timestamptz) to authenticated;

-- ------------------------------------------------------------
-- 10. Editing and deleting
--
-- Only your own message, only not-deleted, only within 15 minutes for an
-- edit. An edit is stamped so the other person can see the message moved;
-- a silent rewrite would be indistinguishable from them misremembering.
-- ------------------------------------------------------------
create or replace function public.edit_message(p_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.messages where id = p_id for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  if v_row.sender_id <> v_uid then
    raise exception 'NOT_YOURS' using errcode = 'insufficient_privilege';
  end if;

  if v_row.deleted_at is not null then
    raise exception 'DELETED' using errcode = 'check_violation';
  end if;

  if v_row.kind <> 'text' then
    raise exception 'NOT_EDITABLE' using errcode = 'check_violation';
  end if;

  if char_length(v_body) = 0 then
    raise exception 'EMPTY_MESSAGE' using errcode = 'check_violation';
  end if;

  if char_length(v_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'check_violation';
  end if;

  update public.messages
     set body = v_body, edited_at = now()
   where id = p_id;

  return jsonb_build_object('id', p_id, 'edited_at', now());
end;
$fn$;

revoke all on function public.edit_message(uuid, text) from public, anon;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.delete_message(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_row  public.messages;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.messages where id = p_id for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  if v_row.sender_id <> v_uid then
    raise exception 'NOT_YOURS' using errcode = 'insufficient_privilege';
  end if;

  -- Soft delete, and blank the body: the row stays so the other person's
  -- thread keeps its shape instead of silently closing a gap.
  update public.messages
     set deleted_at = now(), body = '', media_path = null
   where id = p_id;

  return jsonb_build_object('id', p_id);
end;
$fn$;

revoke all on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

-- ------------------------------------------------------------
-- 11. The push notification
--
-- Deliberately routed through the existing queue rather than a direct
-- send: one row, topic `msg:<id>`, so the same unique constraint that
-- makes every other notification duplicate-proof protects this too.
--
-- The body is truncated hard. A notification is a nudge to open the app,
-- not a place to read the message — and a phone on a lock screen is not
-- a private surface.
-- ------------------------------------------------------------
create or replace function public.push_enqueue_chat_message(
  p_message uuid,
  p_couple  uuid,
  p_sender  uuid,
  p_body    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_target uuid;
  v_name   text;
  v_body   text;
begin
  select case when c.requester_id = p_sender then c.addressee_id else c.requester_id end
    into v_target
  from public.couples c
  where c.id = p_couple;

  if v_target is null then
    return;
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'شریکت')
    into v_name
  from public.profiles p
  where p.id = p_sender;

  v_body := left(coalesce(p_body, ''), 120);
  if v_body = '' then
    v_body := 'برای دیدنش باز کن';
  end if;

  insert into public.push_queue (user_id, topic, title, body, url)
  values (v_target, 'msg:' || p_message::text, coalesce(v_name, 'شریکت'), v_body, '/chat')
  on conflict (user_id, topic) do nothing;
end;
$fn$;

-- Server-side only: a client must not be able to inject a notification.
revoke all on function public.push_enqueue_chat_message(uuid, uuid, uuid, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------
-- 12. Storage bucket for chat images
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  10 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Objects live at `<couple_id>/<uuid>.<ext>`, so the first path segment is
-- the couple and the policy below is a plain prefix check.
drop policy if exists chat_media_read on storage.objects;
create policy chat_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists chat_media_delete on storage.objects;
create policy chat_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );
