-- ------------------------------------------------------------------
-- 0006 — Ask the person who sent the connection request first.
--
-- Product decision: the one who "reached out" (the requester) is the one
-- prompted with «تاریخ آشنایی‌اتون کی بوده؟» right after the couple goes
-- active. If they cannot remember, they hand it to their partner with the
-- «یادم نیست، از … بپرس» button (already supported by set_anniversary).
--
-- 0005 pointed the question at the addressee; this migration flips the
-- default direction and repairs any couple that is still waiting for an
-- answer it never received.
-- ------------------------------------------------------------------

create or replace function public.couples_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
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

    -- First time we go active: point the question at the requester (the
    -- person who typed the partner's code), falling back to the addressee.
    if tg_op = 'UPDATE' and old.status <> 'active' then
      new.anniversary_asked_user_id := coalesce(
        old.anniversary_asked_user_id,
        new.requester_id,
        new.addressee_id
      );
    elsif tg_op = 'INSERT' then
      new.anniversary_asked_user_id := coalesce(
        new.anniversary_asked_user_id,
        new.requester_id,
        new.addressee_id
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
$fn$;

-- Repair couples created under the 0005 default: unanswered, never handed
-- off, and currently pointing at the addressee → give the turn to the
-- requester instead.
update public.couples c
   set anniversary_asked_user_id = c.requester_id
 where c.status = 'active'
   and c.anniversary_date is null
   and c.anniversary_reassigned_at is null
   and c.anniversary_asked_user_id = c.addressee_id
   and c.anniversary_asked_user_id is distinct from c.requester_id;

comment on column public.couples.anniversary_asked_user_id is
  'Whose turn it is to answer «تاریخ آشنایی». Starts with the requester, moves to the partner on hand-off, cleared once a date is saved.';
