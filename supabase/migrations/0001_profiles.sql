-- ============================================================
-- 0001 — profiles
-- Every authenticated user gets exactly one profile row.
-- The row is created automatically on signup and holds the
-- onboarding progress so the multi-step form can be resumed.
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Table
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  gender             text check (gender in ('girl', 'boy')),
  display_name       text check (
                       display_name is null
                       or char_length(btrim(display_name)) between 1 and 40
                     ),
  -- Dates are ALWAYS stored as Gregorian ISO dates, even though the UI
  -- uses a Jalali (Shamsi) picker.
  birth_date         date check (birth_date is null or birth_date > date '1900-01-01'),
  interests          text[] not null default '{}'::text[],
  -- Either 'builtin:<avatar-file>' or 'storage:<object-path>'
  avatar_url         text,
  -- 8 chars, uppercase letters + digits, generated server-side.
  pairing_code       text not null unique,
  onboarding_step    smallint not null default 1 check (onboarding_step between 1 and 6),
  onboarding_completed boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- A profile can only be flagged "complete" when the essentials exist.
  constraint profiles_complete_when_flagged check (
    not onboarding_completed
    or (gender is not null and display_name is not null and birth_date is not null)
  )
);

comment on table public.profiles is 'Kenaret user profiles. Readable by the owner and by the active partner only.';
comment on column public.profiles.birth_date is 'Gregorian date (ISO). The UI shows it in the Jalali calendar.';
comment on column public.profiles.avatar_url is 'builtin:<file> for shipped avatars, storage:<path> for uploads.';

-- ------------------------------------------------------------
-- Pairing code generator
-- Alphabet intentionally excludes O / 0 / I / 1 (and is unambiguous).
-- ------------------------------------------------------------
create or replace function public.generate_pairing_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  bytes bytea;
  i int;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    bytes := extensions.gen_random_bytes(8);
    candidate := '';
    for i in 0..7 loop
      candidate := candidate || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    end loop;

    if not exists (select 1 from public.profiles p where p.pairing_code = candidate) then
      return candidate;
    end if;

    if attempt >= 20 then
      raise exception 'could not generate a unique pairing code';
    end if;
  end loop;
end;
$$;

revoke all on function public.generate_pairing_code() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Keep server-owned columns immutable and always assign a code
-- ------------------------------------------------------------
create or replace function public.profiles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Clients may never choose their own pairing code.
  new.pairing_code := public.generate_pairing_code();
  new.created_at := now();
  new.updated_at := now();
  if new.onboarding_step < 1 or new.onboarding_step > 6 then
    new.onboarding_step := 1;
  end if;
  return new;
end;
$$;

create or replace function public.profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.id := old.id;
  new.pairing_code := old.pairing_code;
  new.created_at := old.created_at;
  new.updated_at := now();

  -- If the profile stops being a girl profile, private cycle data must go.
  if new.gender is distinct from old.gender and new.gender is distinct from 'girl' then
    delete from public.period_settings where user_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_before_insert_trg on public.profiles;
create trigger profiles_before_insert_trg
  before insert on public.profiles
  for each row execute function public.profiles_before_insert();

drop trigger if exists profiles_before_update_trg on public.profiles;
create trigger profiles_before_update_trg
  before update on public.profiles
  for each row execute function public.profiles_before_update();

-- ------------------------------------------------------------
-- Auto-create a profile when a user signs up
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for users created before the trigger existed.
insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No delete policy on purpose: deleting an account is handled by auth.
