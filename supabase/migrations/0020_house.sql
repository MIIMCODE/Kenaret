-- =====================================================================
-- 0020 — remove «رودررو», and build the house
-- ---------------------------------------------------------------------
-- Two things, and the first one is a funeral.
--
-- 1. «رودررو» (the couple's question game) is gone: the page, the API, the
--    types, the dashboard row, the route, and — here — the tables. The user
--    asked for a complete removal and, asked explicitly, chose to wipe the
--    data rather than archive it. So this is a hard drop, not a soft one.
--
-- 2. In its place: a house that gets built.
--
--    One house per couple. Every day the couple is together adds a brick. The
--    house grows, storey by storey, until either they marry — and live in it —
--    or they part, and it falls down.
--
-- Design notes
--   · The brick count is DERIVED, never stored. `bricks = days together + 1`.
--     A stored counter would need a daily cron job, and would silently drift
--     the first time that job failed. A count computed from the anniversary
--     date is always right, even offline, even in five years.
--   · The house is NOT owned by the couple row. `unlink_partner()` deletes the
--     couples row outright, so a plain `references couples on delete cascade`
--     would erase the ruins at the exact moment they are created. Instead a
--     trigger snapshots the state of the house before the couple disappears,
--     and the two members keep read access to their own ruins forever.
--   · A ruined house is frozen by trigger, not by convention. Once
--     `state = 'ruined'` there is no write path back: no brick, no rebuild,
--     no second marriage.
--   · A new couple starts a NEW house. A past ruin is a memory, not a draft.
-- =====================================================================

-- =====================================================================
-- 1. the funeral
-- =====================================================================
-- Explicit, in dependency order, rather than relying on cascade: if anything
-- else ever took a reference to these tables we want this migration to fail
-- loudly here instead of half-succeeding.
drop function if exists public.game_add_card(text, integer, text);
drop function if exists public.game_answer(uuid, text);
drop function if exists public.game_cards_page(text, integer, text, integer, integer);
drop function if exists public.game_deal(text);
drop function if exists public.game_retire_card(uuid);
drop function if exists public.game_seed();
drop function if exists public.game_set_level(integer, boolean);
drop function if exists public.game_skip(uuid);
drop function if exists public.game_state();

drop table if exists public.game_together_answers;
drop table if exists public.game_turns;
drop table if exists public.game_cards;
drop table if exists public.game_settings;

-- =====================================================================
-- 2. the house
-- =====================================================================
create table if not exists public.houses (
  id         uuid primary key default gen_random_uuid(),

  -- Who is in it. Deliberately NOT a foreign key to `couples`: the couple row
  -- is deleted on unlinking and the house has to outlive it. There is exactly
  -- one active couple per user (enforced in 0003), so a pair of user ids
  -- identifies a house precisely.
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,

  -- The day they count from. Copied from `couples.anniversary_date` when the
  -- house is founded, because that column disappears with the couple — and a
  -- ruin whose foundation date was lost cannot say how many bricks it held.
  began_on   date not null,

  state      text not null default 'building'
             check (state in ('building', 'home', 'ruined')),

  -- Filled when the couple marries. `home` freezes the brick count: the two
  -- of them now live in the house instead of decorating it.
  became_home_on date,
  -- Filled when they part.
  ruined_on  timestamptz,

  -- A ruin keeps a reason so the page can say why it stopped.
  ruin_reason text check (ruin_reason is null or char_length(ruin_reason) <= 60),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint houses_two_people check (requester_id <> addressee_id),
  constraint houses_home_has_date check (state <> 'home' or became_home_on is not null),
  constraint houses_ruin_has_date check (state <> 'ruined' or ruined_on is not null)
);

-- One *live* house per pair; a ruined one does not block a new beginning.
create unique index if not exists houses_one_live_per_pair_idx
  on public.houses (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  )
  where state <> 'ruined';

-- Two single-column indexes, not one composite: a member may appear in either
-- column, so neither column alone can lead a composite index usefully.
create index if not exists houses_requester_idx on public.houses (requester_id);
create index if not exists houses_addressee_idx on public.houses (addressee_id);

comment on table public.houses is
  'One house per couple. Bricks are derived from began_on, never stored. A ruined house is permanently frozen and readable by both members.';
comment on column public.houses.began_on is
  'Copied from couples.anniversary_date at foundation; survives the deletion of the couple row.';

drop trigger if exists houses_touch_trg on public.houses;
create trigger houses_touch_trg
  before update on public.houses
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------- RLS
alter table public.houses enable row level security;

-- Both members read their house, ruined or not.
drop policy if exists houses_read_members on public.houses;
create policy houses_read_members on public.houses
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Reads only, exactly like the calendar: every write is an RPC below, so a
-- client cannot forge `began_on` (and thus grant itself bricks) or resurrect
-- a ruin.
revoke all on public.houses from anon, authenticated;
grant select on public.houses to authenticated;

-- =====================================================================
-- 3. the brick maths
-- =====================================================================
/**
 * How many bricks a house holds.
 *
 * Derived on the spot from `began_on`, so it is right on every device, after
 * any amount of time, with no job to run and nothing to drift. A house founded
 * today holds exactly one brick — the day it began counts.
 *
 * A finished house freezes at its end date instead of continuing to count days
 * the couple did not spend together.
 */
create or replace function public.house_bricks(h public.houses)
returns int
language sql
stable
as $fn$
  select greatest(
    1,
    (
      coalesce(h.became_home_on, h.ruined_on::date, current_date) - h.began_on
    ) + 1
  )::int;
$fn$;

/**
 * The shape of a house at a given number of bricks.
 *
 * This is the whole game. The house is not a counter with a picture next to
 * it — it has a *plan*, and bricks fill it in order. Thresholds are cumulative
 * and doubling-ish, so the early days feel fast and the later ones feel earned:
 *
 *   1     پی — the foundation stone
 *   7     دیوارها — four walls, a week in
 *   30    سقف — a roof over it, the first month
 *   90    پنجره — it starts to let light in
 *   180   اتاق — a second room
 *   365   چراغ — a light on in the window, one year
 *   500   باغ — a garden around it
 *   730   طبقه‌ی دوم — a second storey
 *   1000  درِ چوبی — a real door
 *   1460  آشپزخانه — it smells like food
 *   1825  پنج سال — five years of it
 *   2555  کتابخانه — shelves and things
 *   3650  خانه — ten years: it is simply home
 *
 * Past the last stage the house keeps counting but stops changing shape —
 * a finished house is finished.
 */
create or replace function public.house_stages()
returns table (
  at_bricks int,
  slug      text,
  title     text,
  note      text
)
language sql
immutable
as $fn$
  values
    (1,    'foundation', 'پی',           'اولین آجر. یک روز با هم.'),
    (7,    'walls',      'دیوارها',      'چهار دیوار، یک هفته.'),
    (30,   'roof',       'سقف',          'بالای سرتان جا دارد.'),
    (90,   'windows',    'پنجره',        'حالا نور می‌آید داخل.'),
    (180,  'room',       'اتاق',         'یک اتاق دیگر اضافه شد.'),
    (365,  'lamp',       'چراغ',         'یک سال — و چراغی که روشن است.'),
    (500,  'garden',     'باغ',          'دور خانه سبز شد.'),
    (730,  'storey',     'طبقه‌ی دوم',   'خانه بزرگ‌تر شد.'),
    (1000, 'door',       'درِ چوبی',     'یک در که فقط برای شما باز می‌شود.'),
    (1460, 'kitchen',    'آشپزخانه',     'بوی غذا می‌آید.'),
    (1825, 'fiveyears',  'پنج سال',      'پنج سال با هم.'),
    (2555, 'library',    'کتابخانه',     'قفسه‌ها پر شدند.'),
    (3650, 'home',       'خانه',         'ده سال — این دیگر فقط یک ساختمان نیست.')
$fn$;

-- =====================================================================
-- 4. founding, building, marrying
-- =====================================================================
/**
 * The caller's live house, founded on first open if it does not exist yet.
 *
 * `/house` is a room off the hallway with no tab of its own, so it can be
 * opened by either partner at any time; this is idempotent and safe to call
 * on every visit. Founding requires an active couple and an anniversary date,
 * because a house with no foundation cannot count bricks.
 */
create or replace function public.house_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples;
  v_house  public.houses;
  v_bricks int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  -- Live house for the current couple, if there is one.
  select * into v_couple
  from public.couples
  where status = 'active'
    and (requester_id = v_uid or addressee_id = v_uid)
  limit 1;

  if found then
    select * into v_house
    from public.houses
    where state <> 'ruined'
      and (
        (requester_id = v_couple.requester_id and addressee_id = v_couple.addressee_id)
        or (requester_id = v_couple.addressee_id and addressee_id = v_couple.requester_id)
      )
    limit 1;
  end if;

  -- Ruins — always readable, and the only thing this function returns
  -- once a couple has parted.
  if v_house.id is null then
    return jsonb_build_object(
      'house', null,
      'can_found', coalesce(v_couple.id is not null and v_couple.anniversary_date is not null, false),
      'has_anniversary', coalesce(v_couple.anniversary_date is not null, false),
      'ruins', coalesce((
        select jsonb_agg(to_jsonb(r) order by r.ruined_on desc)
        from (
          select id,
                 house_bricks(h) as bricks,
                 began_on,
                 ruined_on,
                 state
          from public.houses h
          where h.state = 'ruined'
            and (h.requester_id = v_uid or h.addressee_id = v_uid)
        ) r
      ), '[]'::jsonb)
    );
  end if;

  v_bricks := public.house_bricks(v_house);

  return jsonb_build_object(
    'house', jsonb_build_object(
      'id', v_house.id,
      'state', v_house.state,
      'began_on', v_house.began_on,
      'became_home_on', v_house.became_home_on,
      'bricks', v_bricks,
      -- The highest stage reached. A subselect, not a `record` variable: an
      -- unassigned plpgsql record raises when you touch a field, and "no stage
      -- yet" is a perfectly normal answer for a house founded today.
      'stage', (
        select to_jsonb(s)
        from public.house_stages() s
        where s.at_bricks <= v_bricks
        order by s.at_bricks desc
        limit 1
      ),
      'next', (
        select to_jsonb(s)
        from public.house_stages() s
        where s.at_bricks > v_bricks
        order by s.at_bricks asc
        limit 1
      ),
      -- What is already standing, oldest first: the page draws these in order.
      'stages', coalesce((
        select jsonb_agg(to_jsonb(s) order by s.at_bricks)
        from public.house_stages() s
        where s.at_bricks <= v_bricks
      ), '[]'::jsonb)
    ),
    'can_found', true,
    'has_anniversary', true,
    'ruins', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.ruined_on desc)
      from (
        select id,
               house_bricks(h) as bricks,
               began_on,
               ruined_on,
               state
        from public.houses h
        where h.state = 'ruined'
          and (h.requester_id = v_uid or h.addressee_id = v_uid)
      ) r
    ), '[]'::jsonb)
  );
end;
$fn$;

/**
 * Founds the house, if it does not exist.
 *
 * Split from `house_state()` because a read-only function should stay
 * read-only; the page calls this only when the user presses the button.
 */
create or replace function public.house_found()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple public.couples;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_couple
  from public.couples
  where status = 'active'
    and (requester_id = v_uid or addressee_id = v_uid)
  limit 1;

  if not found then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if v_couple.anniversary_date is null then
    raise exception 'NO_ANNIVERSARY' using errcode = 'no_data_found';
  end if;

  select id into v_id
  from public.houses
  where state <> 'ruined'
    and (
      (requester_id = v_couple.requester_id and addressee_id = v_couple.addressee_id)
      or (requester_id = v_couple.addressee_id and addressee_id = v_couple.requester_id)
    )
  limit 1;

  if v_id is not null then
    return jsonb_build_object('house_id', v_id, 'already', true);
  end if;

  insert into public.houses (requester_id, addressee_id, began_on)
  values (
    least(v_couple.requester_id, v_couple.addressee_id),
    greatest(v_couple.requester_id, v_couple.addressee_id),
    v_couple.anniversary_date
  )
  returning id into v_id;

  return jsonb_build_object('house_id', v_id, 'already', false);
end;
$fn$;

/**
 * They married. The house stops growing and becomes the place they live.
 *
 * Either partner may do this — a marriage is not a unilateral act, but this is
 * a private app for two people, and asking for two separate confirmations
 * would mean one of them can strand the other by never opening the page.
 * The page asks twice before calling.
 */
create or replace function public.house_marry()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid   uuid := auth.uid();
  v_house public.houses;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_house
  from public.houses
  where requester_id = v_uid or addressee_id = v_uid
  order by (state = 'ruined') asc, created_at desc
  limit 1;

  if not found then
    raise exception 'NO_HOUSE' using errcode = 'no_data_found';
  end if;

  if v_house.state = 'ruined' then
    raise exception 'HOUSE_ALREADY_RUINED' using errcode = 'check_violation';
  end if;

  if v_house.state = 'home' then
    return jsonb_build_object('house_id', v_house.id, 'already', true);
  end if;

  update public.houses
     set state = 'home',
         became_home_on = current_date
   where id = v_house.id;

  return jsonb_build_object('house_id', v_house.id, 'already', false);
end;
$fn$;

revoke all on function public.house_state() from public, anon;
revoke all on function public.house_found() from public, anon;
revoke all on function public.house_marry() from public, anon;

grant execute on function public.house_state() to authenticated;
grant execute on function public.house_found() to authenticated;
grant execute on function public.house_marry() to authenticated;

comment on function public.house_state() is
  'The caller''s live house (with derived bricks and the stage plan) plus any ruins they belong to.';
comment on function public.house_found() is
  'Founds the couple''s house on their anniversary date. Idempotent.';
comment on function public.house_marry() is
  'Turns the building house into a home and freezes its brick count. Irreversible.';

-- =====================================================================
-- 5. when they part, the house falls
-- =====================================================================
/**
 * Snapshots the house before the couple row is deleted.
 *
 * `unlink_partner()` deletes the `couples` row. If the house hung off it by a
 * foreign key it would vanish with it — and the user explicitly asked that the
 * ruin remain. So this trigger runs BEFORE DELETE, leaves the house standing
 * as a ruin owned by the two people rather than by the couple, and records the
 * day it stopped.
 *
 * A house that had already become a home is not ruined by a later unlink: the
 * marriage happened, and the record of it should not be rewritten by a
 * separation.
 */
create or replace function public.couples_ruin_house()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.houses
     set state = 'ruined',
         ruined_on = now(),
         ruin_reason = 'جدا شدید'
   where state = 'building'
     and (
       (requester_id = old.requester_id and addressee_id = old.addressee_id)
       or (requester_id = old.addressee_id and addressee_id = old.requester_id)
     );

  return old;
end;
$fn$;

drop trigger if exists couples_ruin_house_trg on public.couples;
create trigger couples_ruin_house_trg
  before delete on public.couples
  for each row execute function public.couples_ruin_house();

/**
 * A ruin is frozen. No brick, no rebuild, no second marriage.
 *
 * Enforced in the database rather than by remembering not to offer the button:
 * the whole point of a ruin is that it cannot be un-ruined.
 */
create or replace function public.houses_guard_state()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if old.state = 'ruined' and new.state <> 'ruined' then
    raise exception 'HOUSE_IS_RUINED' using errcode = 'check_violation';
  end if;

  -- A home does not go back to being a building site.
  if old.state = 'home' and new.state = 'building' then
    raise exception 'HOUSE_IS_HOME' using errcode = 'check_violation';
  end if;

  -- Neither the people nor the foundation may be rewritten after the fact:
  -- that would be a way to mint bricks.
  new.requester_id := old.requester_id;
  new.addressee_id := old.addressee_id;
  new.began_on     := old.began_on;

  return new;
end;
$fn$;

drop trigger if exists houses_guard_state_trg on public.houses;
create trigger houses_guard_state_trg
  before update on public.houses
  for each row execute function public.houses_guard_state();

revoke all on function public.couples_ruin_house() from public, anon, authenticated;
revoke all on function public.houses_guard_state() from public, anon, authenticated;
