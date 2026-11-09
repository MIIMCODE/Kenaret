-- ============================================================
-- 0003 — couples
-- Pairing via 8-character codes. All state transitions go through
-- SECURITY DEFINER RPCs so a client can never forge a status
-- change or connect without knowing the partner's code.
-- ============================================================

create table if not exists public.couples (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending', 'active')),
  -- Only set when the request becomes active.
  activated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint couples_no_self check (requester_id <> addressee_id),
  constraint couples_unique_pair unique (requester_id, addressee_id)
);

comment on table public.couples is
  'Pending / active pairing between two users. Only the two parties can read their own row.';

create index if not exists couples_requester_idx on public.couples (requester_id);
create index if not exists couples_addressee_idx on public.couples (addressee_id);

drop trigger if exists couples_touch_trg on public.couples;
create trigger couples_touch_trg
  before update on public.couples
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Invariant guard: at most one partner per user, no self pairing.
-- Runs for every writer (including the RPCs).
-- ------------------------------------------------------------
create or replace function public.couples_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.requester_id = new.addressee_id then
    raise exception 'a user cannot be paired with themselves' using errcode = 'check_violation';
  end if;

  if new.status = 'active' then
    -- Neither side may already have another active couple.
    if exists (
      select 1 from public.couples c
      where c.id <> new.id
        and c.status = 'active'
        and (c.requester_id in (new.requester_id, new.addressee_id)
             or c.addressee_id in (new.requester_id, new.addressee_id))
    ) then
      raise exception 'one of the two users already has an active partner'
        using errcode = 'unique_violation';
    end if;
    new.activated_at := coalesce(new.activated_at, now());
  else
    new.activated_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists couples_guard_trg on public.couples;
create trigger couples_guard_trg
  before insert or update on public.couples
  for each row execute function public.couples_guard();

-- ------------------------------------------------------------
-- Helper: id of the caller's ACTIVE partner (or null)
-- SECURITY DEFINER so it can read couples without RLS recursion.
-- ------------------------------------------------------------
create or replace function public.current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
           when c.requester_id = auth.uid() then c.addressee_id
           else c.requester_id
         end
  from public.couples c
  where c.status = 'active'
    and auth.uid() is not null
    and (c.requester_id = auth.uid() or c.addressee_id = auth.uid())
  limit 1;
$$;

-- ------------------------------------------------------------
-- Helper: can `p_owner`'s avatar be seen by the caller?
-- True for yourself, your active partner, and anyone with whom
-- you have a pending request.
-- ------------------------------------------------------------
create or replace function public.can_view_avatar(p_owner text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null or p_owner is null then
    return false;
  end if;

  -- Never let a malformed folder name raise an exception inside a policy.
  begin
    v_owner := p_owner::uuid;
  exception when others then
    return false;
  end;

  if v_owner = auth.uid() then
    return true;
  end if;

  return exists (
    select 1 from public.couples c
    where (c.requester_id = auth.uid() and c.addressee_id = v_owner)
       or (c.addressee_id = auth.uid() and c.requester_id = v_owner)
  );
end;
$$;

-- ------------------------------------------------------------
-- RPC: send a connection request using the partner's code
-- ------------------------------------------------------------
create or replace function public.request_partner(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_code      text;
  v_target    public.profiles%rowtype;
  v_couple_id uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));

  if v_code = '' then
    raise exception 'EMPTY_CODE' using errcode = 'invalid_parameter_value';
  end if;

  if v_code !~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' then
    raise exception 'CODE_FORMAT'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_target from public.profiles p where p.pairing_code = v_code;

  if not found then
    raise exception 'CODE_NOT_FOUND'
      using errcode = 'no_data_found';
  end if;

  if v_target.id = v_uid then
    raise exception 'SELF_CODE'
      using errcode = 'check_violation';
  end if;

  if not v_target.onboarding_completed then
    raise exception 'TARGET_INCOMPLETE'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.couples c
    where c.status = 'active'
      and (c.requester_id = v_uid or c.addressee_id = v_uid)
  ) then
    raise exception 'SELF_HAS_PARTNER'
      using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.couples c
    where c.status = 'active'
      and (c.requester_id = v_target.id or c.addressee_id = v_target.id)
  ) then
    raise exception 'TARGET_HAS_PARTNER'
      using errcode = 'unique_violation';
  end if;

  if exists (
    select 1 from public.couples c
    where c.status = 'pending'
      and c.requester_id = v_uid
      and c.addressee_id = v_target.id
  ) then
    raise exception 'ALREADY_REQUESTED'
      using errcode = 'unique_violation';
  end if;

  -- A pending request from the other side? Accept it instead.
  select c.id into v_couple_id
  from public.couples c
  where c.status = 'pending'
    and c.requester_id = v_target.id
    and c.addressee_id = v_uid
  limit 1;

  if v_couple_id is not null then
    update public.couples set status = 'active' where id = v_couple_id;
    return jsonb_build_object('status', 'active', 'couple_id', v_couple_id);
  end if;

  insert into public.couples (requester_id, addressee_id, status)
  values (v_uid, v_target.id, 'pending')
  returning id into v_couple_id;

  return jsonb_build_object('status', 'pending', 'couple_id', v_couple_id);
end;
$$;

-- ------------------------------------------------------------
-- RPC: accept / decline an incoming request
-- ------------------------------------------------------------
create or replace function public.respond_to_request(p_couple_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples%rowtype;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_couple from public.couples c where c.id = p_couple_id for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'no_data_found';
  end if;

  if v_couple.addressee_id <> v_uid then
    raise exception 'NOT_YOURS' using errcode = 'insufficient_privilege';
  end if;

  if v_couple.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = 'check_violation';
  end if;

  if not coalesce(p_accept, false) then
    delete from public.couples where id = v_couple.id;
    return jsonb_build_object('status', 'declined');
  end if;

  if exists (
    select 1 from public.couples c
    where c.status = 'active' and c.id <> v_couple.id
      and (c.requester_id in (v_couple.requester_id, v_couple.addressee_id)
           or c.addressee_id in (v_couple.requester_id, v_couple.addressee_id))
  ) then
    raise exception 'SOMEONE_HAS_PARTNER' using errcode = 'unique_violation';
  end if;

  update public.couples set status = 'active' where id = v_couple.id;

  -- Any other pending request of either side is no longer meaningful.
  delete from public.couples
  where status = 'pending'
    and id <> v_couple.id
    and (requester_id in (v_couple.requester_id, v_couple.addressee_id)
         or addressee_id in (v_couple.requester_id, v_couple.addressee_id));

  return jsonb_build_object('status', 'active', 'couple_id', v_couple.id);
end;
$$;

-- ------------------------------------------------------------
-- RPC: withdraw an outgoing pending request
-- ------------------------------------------------------------
create or replace function public.cancel_request(p_couple_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  delete from public.couples
  where id = p_couple_id
    and status = 'pending'
    and requester_id = v_uid;

  if not found then
    raise exception 'NOT_CANCELLABLE' using errcode = 'no_data_found';
  end if;
end;
$$;

-- ------------------------------------------------------------
-- RPC: end an active partnership (either side)
-- ------------------------------------------------------------
create or replace function public.unlink_partner()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.couples
  where status = 'active'
    and (requester_id = v_uid or addressee_id = v_uid);
end;
$$;

-- ------------------------------------------------------------
-- RPC: everything the dashboard needs, in one round-trip
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
  partner as (
    select p.id, p.display_name, p.avatar_url, p.interests, p.birth_date, p.gender
    from public.couples c
    join public.profiles p
      on p.id = case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
    where c.status = 'active'
      and (c.requester_id = v_uid or c.addressee_id = v_uid)
    limit 1
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
           'incoming', coalesce((select items from incoming), '[]'::jsonb),
           'outgoing', coalesce((select items from outgoing), '[]'::jsonb)
         )
  into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------
-- Function privileges: only signed-in users may call these.
-- ------------------------------------------------------------
revoke all on function public.request_partner(text) from public, anon;
revoke all on function public.respond_to_request(uuid, boolean) from public, anon;
revoke all on function public.cancel_request(uuid) from public, anon;
revoke all on function public.unlink_partner() from public, anon;
revoke all on function public.get_pairing_state() from public, anon;
revoke all on function public.current_partner_id() from public, anon;
revoke all on function public.can_view_avatar(text) from public, anon;

grant execute on function public.request_partner(text) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.unlink_partner() to authenticated;
grant execute on function public.get_pairing_state() to authenticated;
grant execute on function public.current_partner_id() to authenticated;
grant execute on function public.can_view_avatar(text) to authenticated;

-- ------------------------------------------------------------
-- Row Level Security
-- Clients may only READ their own couple rows. Every write goes
-- through the RPCs above.
-- ------------------------------------------------------------
alter table public.couples enable row level security;

drop policy if exists couples_select_participants on public.couples;
create policy couples_select_participants on public.couples
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies: writes are RPC-only.
revoke insert, update, delete on public.couples from anon, authenticated;

-- Explicit table grants: clients only ever read their own rows.
revoke all on public.profiles from anon;
revoke delete on public.profiles from authenticated;
grant select, insert, update on public.profiles to authenticated;

revoke all on public.couples from anon;
grant select on public.couples to authenticated;

-- ------------------------------------------------------------
-- Profiles: now that couples exists, let active partners read
-- each other's profile. Period data is NOT part of this.
-- ------------------------------------------------------------
drop policy if exists profiles_select_partner on public.profiles;
create policy profiles_select_partner on public.profiles
  for select to authenticated
  using (id = public.current_partner_id());
