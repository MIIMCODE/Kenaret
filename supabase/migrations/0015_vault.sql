-- ============================================================
-- 0015 — فضای خصوصی: a locked room for the two of you
--
-- This is not "an album with a password". A password on the door would be
-- theatre: the photographs would still sit in a bucket in plain sight, and
-- anyone with the service key — us included — could open them. So the room is
-- locked *from the inside*:
--
--   · Every photograph and every note is encrypted **in the browser** with
--     AES-256-GCM before it is uploaded. The bytes that reach storage are
--     indistinguishable from noise.
--   · The key is random, generated once, and never leaves the device in the
--     clear. It is stored here only *wrapped* — encrypted with a key derived
--     from the PIN nobody else knows (PBKDF2-SHA256, 310 000 rounds).
--   · Lose the PIN and the content is gone. That is not a policy we chose to
--     be harsh about; it is the arithmetic. We cannot reset it because we
--     cannot read it.
--
-- Because the server cannot read any of it, the server also cannot:
--   · search it, moderate it, or index it (which is why there is no full-text
--     search and no thumbnail pipeline here);
--   · tell what is inside. `kind` is the only thing in the clear, and it says
--     'photo' or 'note' — nothing more.
--
-- No push notification either. A banner on a lock screen that says "something
-- new in your private space" is precisely the thing that should not appear
-- while someone else is holding your phone. The room is quiet by design.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The wrapped key
--
-- One row per couple. Everything needed to *attempt* a key derivation lives
-- here (salt, IV, wrapped key); nothing needed to *succeed* without the PIN.
-- ------------------------------------------------------------
create table if not exists public.vault_keys (
  couple_id   uuid primary key references public.couples (id) on delete cascade,

  /** base64, 16 bytes. Per-couple so the same PIN gives a different key. */
  kdf_salt    text not null,
  /** PBKDF2 rounds, stored explicitly so we can raise it later without breaking old vaults. */
  kdf_iters   int  not null default 310000,
  /** base64, 12 bytes. IV for unwrapping the data key. */
  wrap_iv     text not null,
  /** base64: AES-GCM ciphertext of the 32-byte data key. */
  wrapped_key text not null,

  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.vault_keys is
  'Wrapped vault data key. Useless without the couple PIN: we cannot unwrap it, so we cannot reset it.';

-- Both halves must be able to read the wrapping material to open the room.
alter table public.vault_keys enable row level security;

drop policy if exists vault_keys_select_own_couple on public.vault_keys;
create policy vault_keys_select_own_couple on public.vault_keys
  for select to authenticated
  using (couple_id = public.current_couple_id());

-- Writes go through vault_setup() only, so a partner cannot silently swap the
-- wrapped key to a PIN they know and lock the other one out.
revoke all on public.vault_keys from public, anon, authenticated;
grant select on public.vault_keys to authenticated;

-- ------------------------------------------------------------
-- 2. The contents
-- ------------------------------------------------------------
create table if not exists public.vault_items (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,

  kind        text not null check (kind in ('photo', 'note')),

  /**
   * For a photo: object path in the private `vault` bucket.
   * For a note: null, because a note is small enough to live in its own
   * ciphertext column and does not need a round trip to storage.
   */
  storage_path text,

  /** base64 IV used to encrypt the stored bytes. */
  media_iv    text,

  /** base64 ciphertext: the caption of a photo, or the body of a note. */
  body_cipher text,
  /** base64 IV for `body_cipher`. */
  body_iv     text,

  width       int,
  height      int,
  created_at  timestamptz not null default now(),

  constraint vault_item_shape check (
    (kind = 'photo' and storage_path is not null and media_iv is not null)
    or (kind = 'note' and body_cipher is not null and body_iv is not null)
  )
);

comment on table public.vault_items is
  'Ciphertext only. The server stores no readable photograph, caption or note.';

create index if not exists vault_items_couple_created_idx
  on public.vault_items (couple_id, created_at desc);

alter table public.vault_items enable row level security;

drop policy if exists vault_items_select_own_couple on public.vault_items;
create policy vault_items_select_own_couple on public.vault_items
  for select to authenticated
  using (couple_id = public.current_couple_id());

revoke all on public.vault_items from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. vault_setup — performed once, by whoever opens the room first
-- ------------------------------------------------------------
create or replace function public.vault_setup(
  p_salt    text,
  p_iv      text,
  p_wrapped text,
  p_iters   int default 310000
)
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

  if coalesce(btrim(p_salt), '') = ''
     or coalesce(btrim(p_iv), '') = ''
     or coalesce(btrim(p_wrapped), '') = '' then
    raise exception 'BAD_KEY_MATERIAL' using errcode = 'check_violation';
  end if;

  -- Deliberately not an upsert. If the room already exists, a second setup
  -- would replace the wrapped key and every photograph inside would become
  -- permanently unreadable — including for the person who just wrote it.
  if exists (select 1 from public.vault_keys k where k.couple_id = v_couple) then
    raise exception 'ALREADY_SETUP' using errcode = 'check_violation';
  end if;

  insert into public.vault_keys (couple_id, kdf_salt, kdf_iters, wrap_iv, wrapped_key, created_by)
  values (v_couple, btrim(p_salt), greatest(100000, p_iters), btrim(p_iv), btrim(p_wrapped), v_uid);

  return jsonb_build_object('ok', true);
end;
$fn$;

revoke all on function public.vault_setup(text, text, text, int) from public, anon;
grant execute on function public.vault_setup(text, text, text, int) to authenticated;

-- ------------------------------------------------------------
-- 4. vault_state — what the door should show before it opens
--
-- The PIN is never checked on the server. We cannot check it: we do not have
-- it, and the verifier is the wrapped key itself — decryption either succeeds
-- or it does not. This function therefore knows only whether a room *exists*.
-- ------------------------------------------------------------
create or replace function public.vault_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_k      public.vault_keys;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select * into v_k from public.vault_keys k where k.couple_id = v_couple;

  return jsonb_build_object(
    'configured', v_k.couple_id is not null,
    'kdf_salt', v_k.kdf_salt,
    'kdf_iters', v_k.kdf_iters,
    'wrap_iv', v_k.wrap_iv,
    'wrapped_key', v_k.wrapped_key,
    'created_by', v_k.created_by,
    'created_at', v_k.created_at,
    'items', (select count(*) from public.vault_items i where i.couple_id = v_couple)
  );
end;
$fn$;

revoke all on function public.vault_state() from public, anon;
grant execute on function public.vault_state() to authenticated;

-- ------------------------------------------------------------
-- 5. vault_add
-- ------------------------------------------------------------
create or replace function public.vault_add(
  p_kind       text,
  p_path       text    default null,
  p_media_iv   text    default null,
  p_body       text    default null,
  p_body_iv    text    default null,
  p_width      int     default null,
  p_height     int     default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_path   text := nullif(btrim(coalesce(p_path, '')), '');
  v_id     uuid;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.vault_keys k where k.couple_id = v_couple) then
    raise exception 'VAULT_LOCKED' using errcode = 'check_violation';
  end if;

  if v_kind not in ('photo', 'note') then
    raise exception 'UNKNOWN_KIND' using errcode = 'check_violation';
  end if;

  -- Same prefix rule as every other bucket: an object must belong to this
  -- couple, so one couple can never attach another couple's file.
  if v_kind = 'photo' then
    if v_path is null or v_path not like (v_couple::text || '/%') then
      raise exception 'BAD_PATH' using errcode = 'check_violation';
    end if;
    if coalesce(btrim(p_media_iv), '') = '' then
      raise exception 'BAD_PATH' using errcode = 'check_violation';
    end if;
  else
    if coalesce(btrim(p_body), '') = '' or coalesce(btrim(p_body_iv), '') = '' then
      raise exception 'EMPTY_NOTE' using errcode = 'check_violation';
    end if;
  end if;

  -- Ciphertext is opaque, so the usual content checks cannot apply. A rate
  -- limit can, and it is the only thing standing between a stolen session and
  -- a filled-up bucket.
  select count(*) into v_recent
  from public.vault_items i
  where i.couple_id = v_couple and i.created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.vault_items (
    couple_id, user_id, kind, storage_path, media_iv, body_cipher, body_iv, width, height
  )
  values (
    v_couple, v_uid, v_kind, v_path, nullif(btrim(p_media_iv), ''),
    nullif(btrim(p_body), ''), nullif(btrim(p_body_iv), ''),
    p_width, p_height
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$fn$;

revoke all on function public.vault_add(text, text, text, text, text, int, int) from public, anon;
grant execute on function public.vault_add(text, text, text, text, text, int, int) to authenticated;

-- ------------------------------------------------------------
-- 6. vault_list — paged backwards, newest first
-- ------------------------------------------------------------
create or replace function public.vault_list(
  p_before timestamptz default null,
  p_limit  int         default 40
)
returns table (
  id           uuid,
  user_id      uuid,
  kind         text,
  storage_path text,
  media_iv     text,
  body_cipher  text,
  body_iv      text,
  width        int,
  height       int,
  created_at   timestamptz
)
language plpgsql
stable
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

  return query
    select i.id, i.user_id, i.kind, i.storage_path, i.media_iv,
           i.body_cipher, i.body_iv, i.width, i.height, i.created_at
    from public.vault_items i
    where i.couple_id = v_couple
      and (p_before is null or i.created_at < p_before)
    order by i.created_at desc
    limit least(greatest(coalesce(p_limit, 40), 1), 80);
end;
$fn$;

revoke all on function public.vault_list(timestamptz, int) from public, anon;
grant execute on function public.vault_list(timestamptz, int) to authenticated;

-- ------------------------------------------------------------
-- 7. vault_delete — removes the row, hands back the path
--
-- The storage object is ciphertext and cannot be reached from SQL, so the
-- caller deletes it after this returns. Returning the path (rather than
-- leaving the client to remember it) keeps the two halves of one deletion in
-- one place. If the follow-up delete fails, the worst case is an unreadable
-- block of noise in a private bucket — not a leak.
-- ------------------------------------------------------------
create or replace function public.vault_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_path   text;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select i.storage_path into v_path
  from public.vault_items i
  where i.id = p_id and i.couple_id = v_couple;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  delete from public.vault_items where id = p_id and couple_id = v_couple;

  return jsonb_build_object('ok', true, 'path', v_path);
end;
$fn$;

revoke all on function public.vault_delete(uuid) from public, anon;
grant execute on function public.vault_delete(uuid) to authenticated;

-- ------------------------------------------------------------
-- 8. A room with no key is a dead room
--
-- If the couple row disappears, vault_keys cascades and the wrapped key is
-- gone with it — the ciphertext in the bucket becomes unopenable forever,
-- which is the correct outcome of a break-up, not a bug.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 9. Storage: private, ciphertext only
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vault',
  'vault',
  false,
  16 * 1024 * 1024,
  -- Encrypted bytes are not an image any more; there is no real MIME type for
  -- them. Pinning the bucket to octet-stream also documents that nothing here
  -- is meant to be served or rendered directly.
  array['application/octet-stream', 'binary/octet-stream']
)
on conflict (id) do nothing;

drop policy if exists vault_media_read on storage.objects;
create policy vault_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists vault_media_insert on storage.objects;
create policy vault_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );

drop policy if exists vault_media_delete on storage.objects;
create policy vault_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vault'
    and (storage.foldername(name))[1] = public.current_couple_id()::text
  );
