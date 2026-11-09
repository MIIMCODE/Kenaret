-- ============================================================
-- 0002 — period_settings (girls only)
-- Private cycle data. Only the owner can read or write it.
-- The prediction itself is a later phase; this only stores the
-- inputs the user provides during onboarding.
-- ============================================================

create table if not exists public.period_settings (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  last_period_start date not null,
  cycle_length      smallint not null default 28 check (cycle_length between 15 and 60),
  period_length     smallint not null default 5 check (period_length between 1 and 15),
  is_regular        boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.period_settings is
  'Private cycle data. RLS: owner only — a partner can never read this table, even when connected.';
comment on column public.period_settings.last_period_start is
  'Gregorian date (ISO) of the first day of the last period.';

-- ------------------------------------------------------------
-- Keep updated_at fresh
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists period_settings_touch_trg on public.period_settings;
create trigger period_settings_touch_trg
  before update on public.period_settings
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Period settings belong to girls only
-- ------------------------------------------------------------
create or replace function public.period_settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.gender = 'girl'
  ) then
    raise exception 'period_settings are only available for female profiles'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists period_settings_guard_trg on public.period_settings;
create trigger period_settings_guard_trg
  before insert or update on public.period_settings
  for each row execute function public.period_settings_guard();

-- ------------------------------------------------------------
-- Row Level Security: owner only, no partner access whatsoever
-- ------------------------------------------------------------
alter table public.period_settings enable row level security;

drop policy if exists period_settings_owner_select on public.period_settings;
create policy period_settings_owner_select on public.period_settings
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists period_settings_owner_insert on public.period_settings;
create policy period_settings_owner_insert on public.period_settings
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists period_settings_owner_update on public.period_settings;
create policy period_settings_owner_update on public.period_settings
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists period_settings_owner_delete on public.period_settings;
create policy period_settings_owner_delete on public.period_settings
  for delete to authenticated
  using (user_id = auth.uid());
