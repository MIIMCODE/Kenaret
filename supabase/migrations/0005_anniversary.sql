-- ============================================================
-- 0005 — relationship anniversary
--
-- Right after two people pair up, the couple is asked for the date they
-- started their relationship. That date powers the relationship age plus
-- the yearly / monthly anniversaries.
--
-- Only ONE partner is asked first. If they cannot remember, they can hand
-- the question to the other side (`reassigned`), which is stored 1:1 on
-- the couple row so both phones agree on whose turn it is.
-- ============================================================

alter table public.couples
  add column if not exists anniversary_date date,
  add column if not exists anniversary_asked_user_id uuid references public.profiles (id) on delete set null,
  add column if not exists anniversary_reassigned_at timestamptz,
  add column if not exists anniversary_set_by uuid references public.profiles (id) on delete set null,
  add column if not exists anniversary_set_at timestamptz;

comment on column public.couples.anniversary_date is
  'Gregorian ISO date the relationship started. Drives age + anniversaries.';
comment on column public.couples.anniversary_asked_user_id is
  'Whose turn it is to answer the anniversary question.';

-- A relationship cannot start in the future or before 1900.
alter table public.couples drop constraint if exists couples_anniversary_sane;
alter table public.couples
  add constraint couples_anniversary_sane check (
    anniversary_date is null
    or (anniversary_date > date '1900-01-01' and anniversary_date <= current_date + 1)
  );

-- ------------------------------------------------------------
-- Helper: the caller's ACTIVE couple row id (or null)
-- ------------------------------------------------------------
create or replace function public.current_couple_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
  from public.couples c
  where c.status = 'active'
    and auth.uid() is not null
    and (c.requester_id = auth.uid() or c.addressee_id = auth.uid())
  limit 1;
$$;

-- ------------------------------------------------------------
-- Keep the "who is asked" pointer honest whenever a couple goes active.
-- Whoever is added as the addressee (the one who accepted) is asked first,
-- falling back to the requester if that column was wiped by a cascade.
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

    -- First time we go active: point the question at the addressee.
    if tg_op = 'UPDATE' and old.status <> 'active' then
      new.anniversary_asked_user_id := coalesce(
        old.anniversary_asked_user_id,
        new.addressee_id,
        new.requester_id
      );
    elsif tg_op = 'INSERT' then
      new.anniversary_asked_user_id := coalesce(
        new.anniversary_asked_user_id,
        new.addressee_id,
        new.requester_id
      );
    end if;

    -- If the answer was already given, the question is over.
    if new.anniversary_date is not null then
      new.anniversary_asked_user_id := null;
      new.anniversary_reassigned_at := null;
    end if;
  else
    new.activated_at := null;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- RPC: answer the anniversary question
-- `p_date` may be null when `p_hand_to_partner` is true.
-- ------------------------------------------------------------
create or replace function public.set_anniversary(p_date date, p_hand_to_partner boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_couple  public.couples%rowtype;
  v_partner uuid;
  v_asked   uuid;
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

  -- Once answered, only an explicit edit (p_date, no hand-off) may change it.
  if v_couple.anniversary_date is not null and coalesce(p_hand_to_partner, false) then
    raise exception 'ALREADY_SET' using errcode = 'check_violation';
  end if;

  if coalesce(p_hand_to_partner, false) then
    v_partner := case when v_couple.requester_id = v_uid
                      then v_couple.addressee_id else v_couple.requester_id end;

    update public.couples
       set anniversary_asked_user_id = v_partner,
           anniversary_reassigned_at = now()
     where id = v_couple.id;

    return jsonb_build_object('status', 'reassigned', 'asked_user_id', v_partner);
  end if;

  if p_date is null then
    raise exception 'DATE_REQUIRED' using errcode = 'invalid_parameter_value';
  end if;

  if p_date > current_date + 1 then
    raise exception 'DATE_IN_FUTURE' using errcode = 'check_violation';
  end if;

  if p_date < date '1950-01-01' then
    raise exception 'DATE_TOO_OLD' using errcode = 'check_violation';
  end if;

  update public.couples
     set anniversary_date = p_date,
         anniversary_set_by = v_uid,
         anniversary_set_at = now(),
         anniversary_asked_user_id = null,
         anniversary_reassigned_at = null
   where id = v_couple.id;

  v_asked := null;
  return jsonb_build_object('status', 'saved', 'anniversary_date', p_date);
end;
$$;

-- ------------------------------------------------------------
-- RPC: who should be asked, and what is already known
-- Returned inside get_pairing_state(), but also handy on its own.
-- ------------------------------------------------------------
create or replace function public.get_anniversary_state()
returns jsonb
language plpgsql
stable
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

  select * into v_couple
  from public.couples c
  where c.status = 'active'
    and (c.requester_id = v_uid or c.addressee_id = v_uid)
  limit 1;

  if not found then
    return jsonb_build_object('needs_answer', false, 'anniversary_date', null, 'asked_user_id', null);
  end if;

  return jsonb_build_object(
    'needs_answer', v_couple.anniversary_date is null,
    'anniversary_date', v_couple.anniversary_date,
    'asked_user_id', v_couple.anniversary_asked_user_id,
    'is_your_turn', v_couple.anniversary_asked_user_id = v_uid
                     or v_couple.anniversary_asked_user_id is null,
    'reassigned_at', v_couple.anniversary_reassigned_at,
    'set_by', v_couple.anniversary_set_by
  );
end;
$$;

-- ------------------------------------------------------------
-- get_pairing_state(): add the anniversary block so the dashboard only
-- needs one round-trip.
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
  couple as (
    select c.*
    from public.couples c
    where c.status = 'active'
      and (c.requester_id = v_uid or c.addressee_id = v_uid)
    limit 1
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
           'outgoing', coalesce((select items from outgoing), '[]'::jsonb),
           'anniversary', (
             select jsonb_build_object(
                      'needs_answer', couple.anniversary_date is null,
                      'date', couple.anniversary_date,
                      'asked_user_id', couple.anniversary_asked_user_id,
                      'is_your_turn', couple.anniversary_asked_user_id = v_uid
                                       or couple.anniversary_asked_user_id is null,
                      'set_by', couple.anniversary_set_by
                    )
             from couple
           )
         )
  into v_result;

  return v_result;
end;
$$;

-- ------------------------------------------------------------
-- Privileges: signed-in users only.
-- ------------------------------------------------------------
revoke all on function public.set_anniversary(date, boolean) from public, anon;
revoke all on function public.get_anniversary_state() from public, anon;
revoke all on function public.current_couple_id() from public, anon;

grant execute on function public.set_anniversary(date, boolean) to authenticated;
grant execute on function public.get_anniversary_state() to authenticated;
grant execute on function public.current_couple_id() to authenticated;
