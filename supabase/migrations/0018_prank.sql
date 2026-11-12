-- ============================================================
-- 0018 — شوخی از راه دور
-- ------------------------------------------------------------
-- One couple, one armed prank.
--
-- A prank is *sent*, not *scheduled*: one partner arms it, the other's device
-- picks it up the next time it comes to the foreground, and it is consumed so
-- it can never fire twice. That is the whole state machine, and it fits in
-- four columns.
-- ============================================================

create table if not exists public.prank_sends (
  couple_id   uuid primary key references public.couples(id) on delete cascade,
  armed_by    uuid not null references public.profiles(id) on delete cascade,
  armed_at    timestamptz not null default now(),
  -- Null until the other person's phone has played it.
  consumed_at timestamptz
);

comment on table public.prank_sends is
  'One row per couple. Armed by one partner, consumed by the other. A prank is a thing you send, once.';

alter table public.prank_sends enable row level security;

-- No policies at all: the table is reachable only through the RPCs below.
revoke all on public.prank_sends from public, anon, authenticated;

-- ------------------------------------------------------------ arm
--
-- Whoever taps the button is the sender; the OTHER person is the target, and
-- that is decided here rather than sent from the client — a client that can
-- name its own target is a client that can prank itself.
create or replace function public.arm_prank()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_couple public.couples%rowtype;
  v_target uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_couple from public.couples c
  where c.status = 'active' and (c.requester_id = v_uid or c.addressee_id = v_uid)
  limit 1;

  if not found then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  v_target := case when v_couple.requester_id = v_uid then v_couple.addressee_id else v_couple.requester_id end;

  insert into public.prank_sends (couple_id, armed_by, armed_at, consumed_at)
  values (v_couple.id, v_uid, now(), null)
  on conflict (couple_id) do update
    set armed_by = v_uid, armed_at = now(), consumed_at = null;

  return jsonb_build_object('ok', true, 'target_id', v_target, 'armed_at', now());
end;
$$;

-- ------------------------------------------------------------ pending
--
-- The target's phone asks "is there one for me?". Safe to poll: this reports
-- armed state without consuming it, so a fifteen-second poll cannot eat the
-- prank.
create or replace function public.prank_pending()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_row public.prank_sends%rowtype;
  v_stale boolean;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if v_couple is null then
    return jsonb_build_object('pending', false);
  end if;

  select * into v_row from public.prank_sends p where p.couple_id = v_couple;

  if not found or v_row.consumed_at is not null then
    return jsonb_build_object('pending', false);
  end if;

  -- The sender's own device must never play its own prank.
  if v_row.armed_by = v_uid then
    return jsonb_build_object('pending', false, 'mine', true);
  end if;

  /*
   * Expiry is the same field, not a second one.
   *
   * This first returned `pending: true, expired: true` for a stale prank —
   * two fields answering one question, and the client had to know to check the
   * second. Expired means NOT pending.
   */
  v_stale := v_row.armed_at < now() - interval '2 hours';
  return jsonb_build_object(
    'pending', not v_stale,
    'expired', v_stale,
    'armed_at', v_row.armed_at
  );
end;
$$;

-- ------------------------------------------------------------ consume
create or replace function public.consume_prank()
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  -- `armed_by <> v_uid`: the sender cannot consume their own prank, which is
  -- what stops "arm, then accidentally eat it" from ever being possible.
  update public.prank_sends
     set consumed_at = now()
   where couple_id = v_couple
     and consumed_at is null
     and armed_by <> v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------ status
--
-- For the sender's own button, so it can say «آماده است» instead of making
-- them wonder whether the tap registered.
create or replace function public.prank_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_couple uuid := public.current_couple_id();
  v_row public.prank_sends%rowtype;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;
  if v_couple is null then
    return jsonb_build_object('armed', false);
  end if;

  select * into v_row from public.prank_sends p where p.couple_id = v_couple;
  if not found then
    return jsonb_build_object('armed', false);
  end if;

  return jsonb_build_object(
    'armed', v_row.consumed_at is null and v_row.armed_at > now() - interval '2 hours',
    'armed_by_me', v_row.armed_by = v_uid,
    'played', v_row.consumed_at is not null,
    'armed_at', v_row.armed_at
  );
end;
$$;

revoke all on function public.arm_prank() from public, anon;
revoke all on function public.prank_pending() from public, anon;
revoke all on function public.consume_prank() from public, anon;
revoke all on function public.prank_status() from public, anon;
grant execute on function public.arm_prank() to authenticated;
grant execute on function public.prank_pending() to authenticated;
grant execute on function public.consume_prank() to authenticated;
grant execute on function public.prank_status() to authenticated;
