-- ------------------------------------------------------------------
-- 0009 — In-app reminders (the bell)
--
-- Email delivery is blocked until a sending domain is verified at Resend, so
-- the bell is the only reminder channel that reliably reaches anyone. It must
-- therefore read exactly what the mail job reads: `reminder_queue()`.
--
-- That function is deliberately not executable by clients (it is a definer
-- function that can describe a partner's cycle *if she consented*). Handing it
-- to the client would either break that or leak the whole queue. So this
-- migration adds one narrow door:
--
--   my_upcoming_reminders(days) → only rows where user_id = auth.uid()
--
-- `reminder_queue(p_day)` is day-exact by design — it answers "what happens on
-- that date". A window therefore has to be built by asking it once per day.
-- ------------------------------------------------------------------

create or replace function public.my_upcoming_reminders(p_days int default 3)
returns table (kind text, event_iso date, title text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid  uuid := auth.uid();
  v_days int := least(greatest(coalesce(p_days, 3), 1), 14);
  d      date;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  -- Capped at 14 days: this feeds a badge, not a second calendar.
  for i in 0..v_days loop
    d := current_date + i;
    return query
      select q.kind, q.event_iso, q.title
      from public.reminder_queue(d) q
      where q.user_id = v_uid
      order by q.event_iso, q.kind;
  end loop;
end;
$fn$;

revoke all on function public.my_upcoming_reminders(int) from public, anon;
grant execute on function public.my_upcoming_reminders(int) to authenticated;

comment on function public.my_upcoming_reminders(int) is
  'The signed-in user''s own reminders for the next few days, assembled day by day from the day-exact reminder_queue(). Clients cannot execute reminder_queue() directly.';
