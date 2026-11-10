-- ------------------------------------------------------------------
-- 0007 — Reminders
--
-- The app promises «روزهای مهم را از قبل یادت می‌اندازد». Until now nothing
-- did. This migration builds the delivery side, entirely inside Supabase so the
-- site stays 100% static:
--
--   1. a Nowruz table   — the only fact needed to convert between Gregorian
--                         and Jalali. It is generated from jalaali-js (the
--                         exact library the client uses) and verified date by
--                         date, so the email and the app can never disagree.
--   2. reminder_prefs   — per-user switch and per-kind toggles. A missing row
--                         means "defaults", so existing users need no backfill.
--   3. reminder_log     — one row per (user, kind, event) so a re-run can never
--                         mail anybody twice.
--   4. reminder_queue   — "who must be told what, tomorrow" as plain SQL.
--   5. send_reminders   — groups it into one email per person and posts through
--                         Resend via pg_net. A missing API key is harmless.
-- ------------------------------------------------------------------

-- ============================================================== Nowruz
-- One row per Jalali year: the Gregorian date of 1 Farvardin.
create table if not exists public.jalali_years (
  jy     int primary key,
  nowruz date not null
);

comment on table public.jalali_years is
  'Gregorian date of 1 Farvardin for each Jalali year. Generated from jalaali-js so both runtimes agree.';

insert into public.jalali_years (jy, nowruz) values
  (1290, '1911-03-22'),
  (1291, '1912-03-21'),
  (1292, '1913-03-21'),
  (1293, '1914-03-22'),
  (1294, '1915-03-22'),
  (1295, '1916-03-21'),
  (1296, '1917-03-21'),
  (1297, '1918-03-22'),
  (1298, '1919-03-22'),
  (1299, '1920-03-21'),
  (1300, '1921-03-21'),
  (1301, '1922-03-22'),
  (1302, '1923-03-22'),
  (1303, '1924-03-21'),
  (1304, '1925-03-21'),
  (1305, '1926-03-22'),
  (1306, '1927-03-22'),
  (1307, '1928-03-21'),
  (1308, '1929-03-21'),
  (1309, '1930-03-21'),
  (1310, '1931-03-22'),
  (1311, '1932-03-21'),
  (1312, '1933-03-21'),
  (1313, '1934-03-21'),
  (1314, '1935-03-22'),
  (1315, '1936-03-21'),
  (1316, '1937-03-21'),
  (1317, '1938-03-21'),
  (1318, '1939-03-22'),
  (1319, '1940-03-21'),
  (1320, '1941-03-21'),
  (1321, '1942-03-21'),
  (1322, '1943-03-22'),
  (1323, '1944-03-21'),
  (1324, '1945-03-21'),
  (1325, '1946-03-21'),
  (1326, '1947-03-22'),
  (1327, '1948-03-21'),
  (1328, '1949-03-21'),
  (1329, '1950-03-21'),
  (1330, '1951-03-22'),
  (1331, '1952-03-21'),
  (1332, '1953-03-21'),
  (1333, '1954-03-21'),
  (1334, '1955-03-22'),
  (1335, '1956-03-21'),
  (1336, '1957-03-21'),
  (1337, '1958-03-21'),
  (1338, '1959-03-22'),
  (1339, '1960-03-21'),
  (1340, '1961-03-21'),
  (1341, '1962-03-21'),
  (1342, '1963-03-21'),
  (1343, '1964-03-21'),
  (1344, '1965-03-21'),
  (1345, '1966-03-21'),
  (1346, '1967-03-21'),
  (1347, '1968-03-21'),
  (1348, '1969-03-21'),
  (1349, '1970-03-21'),
  (1350, '1971-03-21'),
  (1351, '1972-03-21'),
  (1352, '1973-03-21'),
  (1353, '1974-03-21'),
  (1354, '1975-03-21'),
  (1355, '1976-03-21'),
  (1356, '1977-03-21'),
  (1357, '1978-03-21'),
  (1358, '1979-03-21'),
  (1359, '1980-03-21'),
  (1360, '1981-03-21'),
  (1361, '1982-03-21'),
  (1362, '1983-03-21'),
  (1363, '1984-03-21'),
  (1364, '1985-03-21'),
  (1365, '1986-03-21'),
  (1366, '1987-03-21'),
  (1367, '1988-03-21'),
  (1368, '1989-03-21'),
  (1369, '1990-03-21'),
  (1370, '1991-03-21'),
  (1371, '1992-03-21'),
  (1372, '1993-03-21'),
  (1373, '1994-03-21'),
  (1374, '1995-03-21'),
  (1375, '1996-03-20'),
  (1376, '1997-03-21'),
  (1377, '1998-03-21'),
  (1378, '1999-03-21'),
  (1379, '2000-03-20'),
  (1380, '2001-03-21'),
  (1381, '2002-03-21'),
  (1382, '2003-03-21'),
  (1383, '2004-03-20'),
  (1384, '2005-03-21'),
  (1385, '2006-03-21'),
  (1386, '2007-03-21'),
  (1387, '2008-03-20'),
  (1388, '2009-03-21'),
  (1389, '2010-03-21'),
  (1390, '2011-03-21'),
  (1391, '2012-03-20'),
  (1392, '2013-03-21'),
  (1393, '2014-03-21'),
  (1394, '2015-03-21'),
  (1395, '2016-03-20'),
  (1396, '2017-03-21'),
  (1397, '2018-03-21'),
  (1398, '2019-03-21'),
  (1399, '2020-03-20'),
  (1400, '2021-03-21'),
  (1401, '2022-03-21'),
  (1402, '2023-03-21'),
  (1403, '2024-03-20'),
  (1404, '2025-03-21'),
  (1405, '2026-03-21'),
  (1406, '2027-03-21'),
  (1407, '2028-03-20'),
  (1408, '2029-03-20'),
  (1409, '2030-03-21'),
  (1410, '2031-03-21'),
  (1411, '2032-03-20'),
  (1412, '2033-03-20'),
  (1413, '2034-03-21'),
  (1414, '2035-03-21'),
  (1415, '2036-03-20'),
  (1416, '2037-03-20'),
  (1417, '2038-03-21'),
  (1418, '2039-03-21'),
  (1419, '2040-03-20'),
  (1420, '2041-03-20'),
  (1421, '2042-03-21'),
  (1422, '2043-03-21'),
  (1423, '2044-03-20'),
  (1424, '2045-03-20'),
  (1425, '2046-03-21'),
  (1426, '2047-03-21'),
  (1427, '2048-03-20'),
  (1428, '2049-03-20'),
  (1429, '2050-03-21'),
  (1430, '2051-03-21'),
  (1431, '2052-03-20'),
  (1432, '2053-03-20'),
  (1433, '2054-03-21'),
  (1434, '2055-03-21'),
  (1435, '2056-03-20'),
  (1436, '2057-03-20'),
  (1437, '2058-03-21'),
  (1438, '2059-03-21'),
  (1439, '2060-03-20'),
  (1440, '2061-03-20'),
  (1441, '2062-03-20'),
  (1442, '2063-03-21'),
  (1443, '2064-03-20'),
  (1444, '2065-03-20'),
  (1445, '2066-03-20'),
  (1446, '2067-03-21'),
  (1447, '2068-03-20'),
  (1448, '2069-03-20'),
  (1449, '2070-03-20'),
  (1450, '2071-03-21'),
  (1451, '2072-03-20'),
  (1452, '2073-03-20'),
  (1453, '2074-03-20'),
  (1454, '2075-03-21'),
  (1455, '2076-03-20'),
  (1456, '2077-03-20'),
  (1457, '2078-03-20'),
  (1458, '2079-03-21'),
  (1459, '2080-03-20'),
  (1460, '2081-03-20'),
  (1461, '2082-03-20'),
  (1462, '2083-03-21'),
  (1463, '2084-03-20'),
  (1464, '2085-03-20'),
  (1465, '2086-03-20'),
  (1466, '2087-03-21'),
  (1467, '2088-03-20'),
  (1468, '2089-03-20'),
  (1469, '2090-03-20'),
  (1470, '2091-03-21')
on conflict (jy) do nothing;

revoke all on public.jalali_years from anon, authenticated;

/** Jalali year that contains `p_date`. */
create or replace function public.jalali_year_of(p_date date)
returns int language sql stable as $$
  select coalesce(
    (select jy from public.jalali_years where nowruz <= p_date order by jy desc limit 1),
    extract(year from p_date)::int - 621
  )
$$;

/** Gregorian date at the start of a Jalali year. */
create or replace function public.nowruz_of(p_jy int)
returns date language sql stable as $$
  select nowruz from public.jalali_years where jy = p_jy
$$;

/** Days in a Jalali month, straight from the table. */
create or replace function public.jalali_month_length(p_jy int, p_jm int)
returns int language sql stable as $$
  select case
           when p_jm <= 6 then 31
           when p_jm <= 11 then 30
           else (public.nowruz_of(p_jy + 1) - public.nowruz_of(p_jy))::int - 336
         end
$$;

/** Gregorian date → Jalali parts. */
create or replace function public.to_jalali(p_date date)
returns table (jy int, jm int, jd int)
language sql stable as $$
  with start as (
    select y.jy, y.nowruz, (p_date - y.nowruz)::int as offset
    from public.jalali_years y
    where y.nowruz <= p_date
    order by y.jy desc
    limit 1
  )
  select
    s.jy,
    case when s.offset <= 185 then 1 + s.offset / 31 else 7 + (s.offset - 186) / 30 end,
    case when s.offset <= 185 then (s.offset % 31) + 1 else ((s.offset - 186) % 30) + 1 end
  from start s
$$;

/** Jalali → Gregorian date. */
create or replace function public.from_jalali(p_jy int, p_jm int, p_jd int)
returns date language sql stable as $$
  select public.nowruz_of(p_jy)
         + case when p_jm <= 7 then (p_jm - 1) * 31 else 186 + (p_jm - 7) * 30 end
         + (p_jd - 1)
$$;

/** Same, but clamps the day to the month's real length (Esfand 31 → 29/30). */
create or replace function public.from_jalali_clamped(p_jy int, p_jm int, p_jd int)
returns date language sql stable as $$
  select public.from_jalali(p_jy, p_jm, least(p_jd, public.jalali_month_length(p_jy, p_jm)))
$$;

revoke all on function public.jalali_year_of(date)            from public, anon, authenticated;
revoke all on function public.nowruz_of(int)                  from public, anon, authenticated;
revoke all on function public.jalali_month_length(int, int)   from public, anon, authenticated;
revoke all on function public.to_jalali(date)                 from public, anon, authenticated;
revoke all on function public.from_jalali(int, int, int)      from public, anon, authenticated;
revoke all on function public.from_jalali_clamped(int, int, int) from public, anon, authenticated;

-- ============================================================== settings
create table if not exists public.reminder_prefs (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  enabled          boolean not null default true,
  want_anniversary boolean not null default true,
  want_birthday    boolean not null default true,
  want_period      boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.reminder_prefs enable row level security;

drop policy if exists reminder_prefs_own on public.reminder_prefs;
create policy reminder_prefs_own on public.reminder_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.reminder_prefs to authenticated;
revoke all on public.reminder_prefs from anon;

drop trigger if exists reminder_prefs_touch on public.reminder_prefs;
create trigger reminder_prefs_touch
  before update on public.reminder_prefs
  for each row execute function public.touch_updated_at();

-- =================================================================== log
create table if not exists public.reminder_log (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  event_iso  date not null,
  channel    text not null default 'email' check (channel in ('email', 'in_app')),
  status     text not null default 'queued'
             check (status in ('queued', 'sent', 'failed', 'skipped')),
  detail     text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, event_iso, channel)
);

alter table public.reminder_log enable row level security;

drop policy if exists reminder_log_own_read on public.reminder_log;
create policy reminder_log_own_read on public.reminder_log
  for select using (user_id = auth.uid());

grant select on public.reminder_log to authenticated;
revoke all on public.reminder_log from anon;

create index if not exists reminder_log_user_idx
  on public.reminder_log (user_id, created_at desc);

-- ================================================================== queue
/**
 * Everything that should be mentioned to somebody about `p_day`.
 *
 * One row per (person, kind, event) whose date is `p_day`. send_reminders()
 * calls this with tomorrow. The rules mirror src/lib/calendar.ts:
 *  - yearly and monthly anniversary of the couple's start date
 *  - the person's own birthday (Jalali)
 *  - day milestones 100/200/365/500/730/1000/1095/1500/2000 together
 *  - the girl's own next period start — emitted only for the row owner; the
 *    function is SECURITY DEFINER for the join, never joins a partner in.
 */
create or replace function public.reminder_queue(p_day date default current_date)
returns table (
  user_id      uuid,
  email        text,
  display_name text,
  kind         text,
  event_iso    date,
  title        text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  p         record;
  start_j   record;
  birth_j   record;
  today_j   record;
  this_j    record;
  cand      date;
  yearly    date;
  monthly   date;
  step      int;
  total     int;
  n_year    int;
  n_month   int;
  n_days    int;
  cycle     record;
  cycle_no  int;
  period_at date;
begin
  select * into today_j from public.to_jalali(p_day);

  for p in
    select pr.id, pr.display_name, pr.birth_date, pr.gender, u.email,
           coalesce(rp.enabled, true)          as enabled,
           coalesce(rp.want_anniversary, true) as want_anniversary,
           coalesce(rp.want_birthday, true)    as want_birthday,
           coalesce(rp.want_period, true)      as want_period,
           c.anniversary_date
    from public.profiles pr
    join auth.users u on u.id = pr.id
    left join public.reminder_prefs rp on rp.user_id = pr.id
    left join public.couples c
           on c.status = 'active'
          and (c.requester_id = pr.id or c.addressee_id = pr.id)
    where u.email_confirmed_at is not null
  loop
    continue when not p.enabled;

    -- -------------------------------------------------- relationship dates
    if p.anniversary_date is not null and p.want_anniversary then
      select * into start_j from public.to_jalali(p.anniversary_date);

      yearly := public.from_jalali_clamped(today_j.jy, start_j.jm, start_j.jd);
      n_year := today_j.jy - start_j.jy;
      if yearly < p_day then
        yearly := public.from_jalali_clamped(today_j.jy + 1, start_j.jm, start_j.jd);
        n_year := n_year + 1;
      end if;
      if yearly = p_day then
        user_id := p.id; email := p.email; display_name := p.display_name;
        kind := 'yearly'; event_iso := yearly;
        title := case when n_year >= 2 then n_year || ' سال با هم' else 'سالگرد آشنایی' end;
        return next;
      end if;

      monthly := null;
      for step in 1..14 loop
        total := (start_j.jm - 1) + step;
        cand := public.from_jalali_clamped(
                  start_j.jy + (total / 12), (total % 12) + 1, start_j.jd);
        if cand >= p_day then
          monthly := cand;
          exit;
        end if;
      end loop;
      if monthly = p_day then
        select * into this_j from public.to_jalali(monthly);
        n_month := (this_j.jy - start_j.jy) * 12 + (this_j.jm - start_j.jm);
        if n_month >= 1 then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'monthly'; event_iso := monthly; title := n_month || ' ماه با هم';
          return next;
        end if;
      end if;

      foreach n_days in array array[100, 200, 365, 500, 730, 1000, 1095, 1500, 2000] loop
        if p.anniversary_date + n_days = p_day then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'milestone'; event_iso := p_day;
          title := case
                     when n_days = 365 then 'یک‌سالگی'
                     when n_days = 730 then 'دو‌سالگی'
                     when n_days = 1095 then 'سه‌سالگی'
                     else n_days || ' روز با هم'
                   end;
          return next;
        end if;
      end loop;
    end if;

    -- ------------------------------------------------------------ birthday
    if p.birth_date is not null and p.want_birthday then
      select * into birth_j from public.to_jalali(p.birth_date);
      cand := public.from_jalali_clamped(today_j.jy, birth_j.jm, birth_j.jd);
      if cand < p_day then
        cand := public.from_jalali_clamped(today_j.jy + 1, birth_j.jm, birth_j.jd);
      end if;
      if cand = p_day then
        user_id := p.id; email := p.email; display_name := p.display_name;
        kind := 'birthday'; event_iso := cand; title := 'تولدت';
        return next;
      end if;
    end if;

    -- -------------------------------------------------------------- period
    if p.gender = 'girl' and p.want_period then
      select ps.last_period_start, ps.cycle_length
        into cycle
      from public.period_settings ps
      where ps.user_id = p.id;

      if found and cycle.cycle_length between 15 and 60 then
        cycle_no := greatest(0, ceil((p_day - cycle.last_period_start)::numeric / cycle.cycle_length)::int);
        period_at := cycle.last_period_start + (cycle_no * cycle.cycle_length);
        if period_at = p_day then
          user_id := p.id; email := p.email; display_name := p.display_name;
          kind := 'period'; event_iso := period_at; title := 'شروع پریود';
          return next;
        end if;
      end if;
    end if;
  end loop;
end;
$fn$;

revoke all on function public.reminder_queue(date) from public, anon, authenticated;

-- =================================================================== send
/**
 * Mails everybody whose reminder falls tomorrow.
 *
 * The unique index on reminder_log makes each (user, kind, event) happen
 * exactly once, so running twice is safe. With no `resend_api_key` in Vault the
 * rows are still claimed and marked `skipped`: the in-app calendar keeps working
 * and nothing is lost.
 */
create or replace function public.send_reminders(p_day date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_key     text;
  v_from    text := 'کنارت <onboarding@resend.dev>';
  v_site    text := 'https://miimcode.github.io/Kenaret/';
  v_body    text;
  v_queued  int := 0;
  v_skipped int := 0;
  r         record;
  e         record;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'resend_api_key'
  limit 1;

  for r in
    select q.user_id, q.email, q.display_name
    from public.reminder_queue(p_day + 1) q
    group by q.user_id, q.email, q.display_name
  loop
    v_body := '';

    for e in
      select * from public.reminder_queue(p_day + 1) q where q.user_id = r.user_id
      order by q.event_iso
    loop
      begin
        insert into public.reminder_log (user_id, kind, event_iso, channel, status)
        values (r.user_id, e.kind, e.event_iso, 'email',
                case when v_key is null then 'skipped' else 'queued' end);
      exception when unique_violation then
        v_skipped := v_skipped + 1;
        continue;
      end;

      v_body := v_body || format('<p dir="rtl"><b>%s</b> — فردا</p>', e.title);
    end loop;

    continue when v_body = '';

    if v_key is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_key
                 ),
      body    := jsonb_build_object(
                   'from', v_from,
                   'to', r.email,
                   'subject', 'کنارت — فردا یک روز مهم داری',
                   'html', format(
                     '<div dir="rtl" style="font-family:Tahoma,sans-serif;line-height:2;font-size:15px">'
                     '<p>سلام %s،</p>%s'
                     '<p style="margin-top:18px"><a href="%s">در کنارت ببین</a></p>'
                     '<p style="color:#8a818a;font-size:12px">این ایمیل را از تنظیمات کنارت می‌توانی خاموش کنی.</p>'
                     '</div>',
                     coalesce(r.display_name, 'دوست من'),
                     v_body,
                     v_site
                   )
                 )
    );

    update public.reminder_log l
       set status = 'sent'
     where l.user_id = r.user_id
       and l.channel = 'email'
       and l.status = 'queued'
       and l.event_iso = p_day + 1;

    v_queued := v_queued + 1;
  end loop;

  return jsonb_build_object('queued', v_queued, 'skipped', v_skipped, 'for_day', p_day + 1);
end;
$fn$;

revoke all on function public.send_reminders(date) from public, anon, authenticated;

comment on table public.reminder_prefs is
  'Per-user reminder switch. A missing row means "defaults", so no backfill is needed.';
comment on function public.reminder_queue(date) is
  'Who should be reminded about p_day. Mirrors src/lib/calendar.ts.';
