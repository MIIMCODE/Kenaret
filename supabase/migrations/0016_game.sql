-- ============================================================
-- 0016 — رودررو: a game for exactly two people
--
-- Not a content library. A *shared deck* that the couple writes together.
--
-- The design follows from one observation: a game between two people is only
-- interesting if it knows things about them. A generic deck of "truth or dare"
-- cards is fun for one evening and then never opened again, because by the
-- third round you have read them all — and none of them are about you. So the
-- deck is theirs: it starts with a set of hand-written starters, and every
-- card either one of them adds becomes part of the game permanently.
--
-- That has two consequences for the schema:
--
--   · Cards are couple-scoped, never global. One couple's deck must never
--     appear in another couple's game, and there is no cross-couple read path.
--   · Seeded starters are marked with `builtin` so the UI can tell "we wrote
--     this" from "the app gave us this" — without it, the starter pack would
--     quietly become part of their voice and it would be dishonest.
--
-- Two things testing caught that the first draft got wrong, kept here so they
-- are not reintroduced:
--
--   · A `together` card is answered by *both* people, so checking the answerer
--     against `asked_of`/`asked_by` locks the partner out. Membership in the
--     couple is the correct check.
--   · `game_add_card`'s rate limit must ignore the seeded starter pack.
--     Counting it locks a brand-new couple out of their own card list for an
--     hour, because seeding inserts 76 rows at once.
--
-- Turn-taking is server-side. The client cannot decide whose turn it is; the
-- next player is derived from the last turn and handed back by the RPC. A
-- tampered client can therefore cheat at the game, but only by asking the
-- database to lie — which is a different class of problem than a scoring bug.
--
-- Card levels: آرام / جسور / رک. The couple picks the *ceiling* and may lower
-- it at any moment. Nothing above the ceiling is ever dealt.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The deck
-- ------------------------------------------------------------
create table if not exists public.game_cards (
  id         uuid primary key default gen_random_uuid(),
  couple_id  uuid not null references public.couples (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,

  kind       text not null check (kind in ('truth', 'dare', 'together')),
  level      int  not null check (level between 1 and 3),

  body       text not null check (char_length(btrim(body)) between 3 and 280),

  /**
   * True for the starter pack. Kept so the list can be filtered ("only ours"),
   * and so a future migration can retire or reword starters without touching
   * anything the couple wrote.
   */
  builtin    boolean not null default false,

  /**
   * Soft delete, not `delete`. A card that has been played is part of the
   * couple's history; removing it should not rewrite what happened. The dealing
   * functions never pick a retired card.
   */
  retired_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists game_cards_deck_idx
  on public.game_cards (couple_id, level, kind)
  where retired_at is null;

comment on table public.game_cards is
  'The couple''s own deck. Couple-scoped: there is no global deck and no cross-couple read path.';

alter table public.game_cards enable row level security;

-- Both halves read the same deck; that is the point of a shared game.
drop policy if exists game_cards_select_own_couple on public.game_cards;
create policy game_cards_select_own_couple on public.game_cards
  for select to authenticated
  using (couple_id = public.current_couple_id());

-- No insert/update/delete policies: every write goes through the RPCs below,
-- so the rate limit and the length checks cannot be sidestepped by a client.
revoke all on public.game_cards from public, anon, authenticated;
grant select on public.game_cards to authenticated;

-- ------------------------------------------------------------
-- 2. One turn
--
-- Note the partial unique index on (couple_id) where `outcome is null` below.
-- It is not decoration: it is what makes "one card on the table" true under
-- concurrency, and it is the reason `game_deal` catches unique_violation.
-- ------------------------------------------------------------
create table if not exists public.game_turns (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples (id) on delete cascade,

  /** The card that was dealt. Kept by id even if the card is later retired. */
  card_id     uuid not null references public.game_cards (id) on delete cascade,

  /** Who the card was put *to* — i.e. whose turn it was. */
  asked_of    uuid not null references public.profiles (id) on delete cascade,
  /** Who drew it. For a `together` card this is also who tapped. */
  asked_by    uuid not null references public.profiles (id) on delete cascade,

  /**
   * The answer, when there is one. Null while the turn is open.
   *
   * `together` cards are *not* answered through this column: both halves type
   * into `together_answers`, because "do this together" has two answers.
   */
  answer      text check (answer is null or char_length(btrim(answer)) between 1 and 600),
  answered_at timestamptz,

  /** A turn nobody answered must not block the game forever. */
  skipped_at  timestamptz,

  /** NULL / 'skip' / 'done' — derived once, stored so both see the same thing. */
  outcome     text check (outcome is null or outcome in ('answered', 'skipped')),

  created_at  timestamptz not null default now()
);

create index if not exists game_turns_recent_idx
  on public.game_turns (couple_id, created_at desc);

/**
 * At most one *open* turn per couple — enforced by the database, not by a
 * check the caller runs first.
 *
 * Testing found the race: two tabs deal at the same moment, both see "no open
 * turn", and both insert. A check-then-insert cannot see the other
 * transaction; a partial unique index can, and turns the race into the same
 * friendly TURN_IN_PROGRESS error instead of two cards on the table.
 */
create unique index if not exists game_turns_one_open_idx
  on public.game_turns (couple_id) where outcome is null;

comment on table public.game_turns is
  'One dealt card. Answers live here for truth/dare; together cards have one answer per person.';

alter table public.game_turns enable row level security;

drop policy if exists game_turns_select_own_couple on public.game_turns;
create policy game_turns_select_own_couple on public.game_turns
  for select to authenticated
  using (couple_id = public.current_couple_id());

revoke all on public.game_turns from public, anon, authenticated;
grant select on public.game_turns to authenticated;

-- ------------------------------------------------------------
-- 3. Both halves of a "do it together" card
-- ------------------------------------------------------------
-- A `together` card asks the pair to do something, then each of them says how
-- it went. One row per person, and the turn only closes when both exist.
create table if not exists public.game_together_answers (
  turn_id    uuid not null references public.game_turns (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 600),
  created_at timestamptz not null default now(),
  primary key (turn_id, user_id)
);

alter table public.game_together_answers enable row level security;

drop policy if exists game_together_select_own_couple on public.game_together_answers;
create policy game_together_select_own_couple on public.game_together_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.game_turns t
      where t.id = game_together_answers.turn_id
        and t.couple_id = public.current_couple_id()
    )
  );

revoke all on public.game_together_answers from public, anon, authenticated;
grant select on public.game_together_answers to authenticated;

-- ------------------------------------------------------------
-- 4. Per-couple settings
-- ------------------------------------------------------------
create table if not exists public.game_settings (
  couple_id   uuid primary key references public.couples (id) on delete cascade,

  /**
   * The loudest card that may be dealt: 1 آرام, 2 جسور, 3 رک.
   * Lowering this is immediate and retroactive — the deal function reads it
   * every time, so a card already in the deck stops being dealt the moment
   * the ceiling drops. That is the behaviour someone lowering it expects.
   */
  max_level   int not null default 2 check (max_level between 1 and 3),

  /** Only deal cards this couple has not seen yet, until the deck is exhausted. */
  avoid_repeats boolean not null default true,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.game_settings enable row level security;

drop policy if exists game_settings_select_own_couple on public.game_settings;
create policy game_settings_select_own_couple on public.game_settings
  for select to authenticated
  using (couple_id = public.current_couple_id());

revoke all on public.game_settings from public, anon, authenticated;
grant select on public.game_settings to authenticated;

-- ------------------------------------------------------------
-- 5. game_seed — give a new couple their starter deck
--
-- Called on first open. `on conflict do nothing`-style guarding is done by
-- checking for any builtin card, so opening the page twice never doubles the
-- deck. The starters are written in the register the two of them actually use:
-- plain spoken Persian, no therapy-speak.
-- ------------------------------------------------------------
create or replace function public.game_seed()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_have   int;
  v_added  int := 0;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select count(*) into v_have
  from public.game_cards c
  where c.couple_id = v_couple and c.builtin;

  if v_have > 0 then
    return jsonb_build_object('seeded', false, 'builtin', v_have);
  end if;

  insert into public.game_cards (couple_id, created_by, kind, level, body, builtin)
  values
    -- آرام: easy openers, nothing that costs anything to answer
    (v_couple, null, 'truth', 1, 'اولین چیزی که در من دیدی چه بود؟', true),
    (v_couple, null, 'truth', 1, 'اولین پیامی که بهم دادی رو یادت هست؟', true),
    (v_couple, null, 'truth', 1, 'کدوم عادت من رو بیشتر از همه دوست داری؟', true),
    (v_couple, null, 'truth', 1, 'بهترین روزی که با هم گذروندیم کِی بود؟', true),
    (v_couple, null, 'truth', 1, 'آهنگی که وقتی میشنوی یاد من میافتی؟', true),
    (v_couple, null, 'truth', 1, 'غذایی که دوست داری برات درست کنم؟', true),
    (v_couple, null, 'truth', 1, 'کجای شهر رو با من بیشتر دوست داری؟', true),
    (v_couple, null, 'truth', 1, 'یک چیزی که ازم یاد گرفتی؟', true),
    (v_couple, null, 'truth', 1, 'بیشتر دلم برات تنگ میشه یا برای حرف زدنمون؟', true),
    (v_couple, null, 'truth', 1, 'چیزی که همیشه میخواستی ازم بپرسی ولی نپرسیدی؟', true),
    (v_couple, null, 'truth', 1, 'من رو با سه کلمه توصیف کن.', true),
    (v_couple, null, 'truth', 1, 'کدوم خاطرهی ما رو اگه میتونستی دوباره زندگی کنی؟', true),
    (v_couple, null, 'truth', 1, 'چیزی که این روزها ذهنت رو بیشتر از همه پر کرده؟', true),
    (v_couple, null, 'truth', 1, 'بچگیات چطور بود؟ یک تصویر ازش بگو.', true),
    (v_couple, null, 'truth', 1, 'وقتی حالت بد است، چه چیزی آرومت میکنه؟', true),
    (v_couple, null, 'truth', 1, 'یک ترس کوچیک که کمتر کسی میدونه؟', true),
    (v_couple, null, 'truth', 1, 'آخرین باری که بهم فکر کردی و خندیدی کِی بود؟', true),
    (v_couple, null, 'truth', 1, 'دوست داری پنج سال دیگه کجای زندگیمون باشیم؟', true),
    (v_couple, null, 'truth', 1, 'چیزی که از من میخوای بیشتر انجام بدم؟', true),
    (v_couple, null, 'truth', 1, 'چیزی که از من میخوای کمتر انجام بدم؟', true),

    -- جسور: costs a little; the answers are worth more
    (v_couple, null, 'truth', 2, 'بدترین عادت من چیه؟ واقعاً بگو.', true),
    (v_couple, null, 'truth', 2, 'یک بار که از دستم ناراحت شدی و نگفتی؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که تو رابطهی قبلیت یاد گرفتی و با من عوض شد؟', true),
    (v_couple, null, 'truth', 2, 'کِی بیشتر از همه حسودیت شد؟', true),
    (v_couple, null, 'truth', 2, 'یک چیز که بهم نگفتی چون میترسیدی ناراحت شم؟', true),
    (v_couple, null, 'truth', 2, 'بزرگترین ترست دربارهی ما دو نفر چیه؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که فکر میکنی من در مورد خودم اشتباه میدونم؟', true),
    (v_couple, null, 'truth', 2, 'کِی حس کردی من رو نمیشناسم؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که از خودت نمیگی ولی دوست داری بگویی؟', true),
    (v_couple, null, 'truth', 2, 'یک چیزی که فکر میکنی ما هیچوقت در موردش حرف نزدیم؟', true),
    (v_couple, null, 'truth', 2, 'بدترین چیزی که یک نفر میتونه بهت بگه چیه؟', true),
    (v_couple, null, 'truth', 2, 'کدوم رفتار من رو نمیفهمی؟', true),
    (v_couple, null, 'truth', 2, 'کِی به خودت گفتی «این آدم اشتباهه»؟ چه چیزی نظرت رو عوض کرد؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که دوست داری در مورد خانوادهت بدونی؟', true),
    (v_couple, null, 'truth', 2, 'یک آرزوی که به کسی نگفتی؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که در خودت دوست نداری و میخوای عوض شه؟', true),
    (v_couple, null, 'truth', 2, 'اگه یک سال وقت داشتیم، با هم چی میکردیم؟', true),
    (v_couple, null, 'truth', 2, 'یک بار که فکر کردی من رو از دست میدی؟', true),
    (v_couple, null, 'truth', 2, 'بیشتر از چی میترسی: تنهایی یا درک نشدن؟', true),
    (v_couple, null, 'truth', 2, 'چیزی که فکر میکنی من در مورد تو نمیدونم و باید بدانم؟', true),

    -- رک: no cushion. Still about care, not shock.
    (v_couple, null, 'truth', 3, 'اگه هیچکس قضاوت نمیکرد، چه کاری میکردی؟', true),
    (v_couple, null, 'truth', 3, 'یک چیز که به هیچکس نگفتی و حالا میگویی؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که از رابطهمون میترسی و تا حالا نگفتی؟', true),
    (v_couple, null, 'truth', 3, 'کِی حس کردی عاشق شدی؟ دقیقاً همان لحظه چه بود؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که اگه برای همیشه از دست میدادی، بیشتر از همه دلت میشد؟', true),
    (v_couple, null, 'truth', 3, 'یک حقیقت در مورد خودت که ممکنه نظرم رو عوض کنه؟', true),
    (v_couple, null, 'truth', 3, 'کدوم حرف من هنوز توی گوشته؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که در من هست و بهت آسیب زده؟', true),
    (v_couple, null, 'truth', 3, 'بزرگترین ترس زندگیت چیه؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که فکر میکنی هیچوقت نمیفهمم؟', true),
    (v_couple, null, 'truth', 3, 'اگه میتونستی یک چیز رو در گذشتهت عوض کنی، چی بود؟', true),
    (v_couple, null, 'truth', 3, 'میخوای بعد از ما چی بمونه؟', true),
    (v_couple, null, 'truth', 3, 'صادقانه: به رابطهمون چند از ده میدی؟ چرا؟', true),
    (v_couple, null, 'truth', 3, 'یک چیزی که از خودت خجالت میکشی؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که دوست داری هیچوقت از تو ندونم؟', true),
    (v_couple, null, 'truth', 3, 'به من بیشتر از چیزی که میگم اعتماد داری؟', true),
    (v_couple, null, 'truth', 3, 'کِی از من خسته شدی؟', true),
    (v_couple, null, 'truth', 3, 'اگه امروز آخرین روز بود، چه میگفتی؟', true),
    (v_couple, null, 'truth', 3, 'چیزی که فکر میکنی من باید عوض کنم تا ما بهتر بشیم؟', true),
    (v_couple, null, 'truth', 3, 'چه چیزی رو هنوز نپذیرفتی در مورد خودت؟', true),

    -- آرام: dares that cost nothing but a little embarrassment
    (v_couple, null, 'dare', 1, 'یک ویس ۱۰ ثانیهای بفرست که فقط بخندی.', true),
    (v_couple, null, 'dare', 1, 'یک عکس بچگیات بفرست.', true),
    (v_couple, null, 'dare', 1, 'آهنگ مورد علاقهات رو بفرست، همین حالا.', true),
    (v_couple, null, 'dare', 1, 'یک چیز که امروز خوشحالت کرد رو تعریف کن.', true),
    (v_couple, null, 'dare', 1, 'یک نقاشی از من بکش — حتی با گوشی.', true),
    (v_couple, null, 'dare', 1, 'یک compliment که هیچوقت بهم نگفتی بگو.', true),
    (v_couple, null, 'dare', 1, 'سه چیزی که در این لحظه میبینی و حست رو بگو.', true),
    (v_couple, null, 'dare', 1, 'یک ایموجی که حست رو نشون میده بفرست.', true),
    (v_couple, null, 'dare', 1, 'یک خاطره از ما که هیچکس دیگهای نمیدونه رو بگو.', true),
    (v_couple, null, 'dare', 1, 'ده ثانیه ساکت بمان و بعد اولین فکرت رو بگو.', true),
    (v_couple, null, 'dare', 1, 'یک جمله که دوست داری هر روز از من بشنوی رو بگو.', true),
    (v_couple, null, 'dare', 1, 'یک چیز که الان دلت میخواد بخوری رو بگو واینجا.', true),
    (v_couple, null, 'dare', 1, 'اسم من رو با لحن یک نفر دیگه بگو (ویس).', true),
    (v_couple, null, 'dare', 1, 'یک شکلک بساز و سنپش کن.', true),
    (v_couple, null, 'dare', 1, 'یک عکس از جاییکه الان هستی بفرست.', true),
    (v_couple, null, 'dare', 1, 'یک آهنگ پخش کن و بگو چرا.', true),
    (v_couple, null, 'dare', 1, 'یک چیزی که امروز یاد گرفتی رو بگو.', true),
    (v_couple, null, 'dare', 1, 'به من یک لقب بده که تا حالا نداشتم.', true),
    (v_couple, null, 'dare', 1, 'یک آرزو کن و بلند بگو.', true),
    (v_couple, null, 'dare', 1, 'یک بار بگو «ممنونم که هستی» و بگو چرا.', true),

    -- جسور: dares with a bit of edge
    (v_couple, null, 'dare', 2, 'یک ویس بفرست و توش یک راز کوچیک بگو.', true),
    (v_couple, null, 'dare', 2, 'یک عکس بفرست که هیچوقت به کسی نشون ندادی.', true),
    (v_couple, null, 'dare', 2, 'یک چیزی که ازم میترسی رو بگو.', true),
    (v_couple, null, 'dare', 2, 'یک بار بهم بگو از کدوم کارم بدم میاد.', true),
    (v_couple, null, 'dare', 2, 'یک پیام بنویس و پاکش نکن — هرچی هست.', true),
    (v_couple, null, 'dare', 2, 'یک چیز که دوست داشتی در اولین دیدار میگفتی رو بگو.', true),
    (v_couple, null, 'dare', 2, 'یک چیزی از من که به کسی نگفتی رو بگو.', true),
    (v_couple, null, 'dare', 2, 'یک اعتراف کوچیک، هرچی که باشه.', true),
    (v_couple, null, 'dare', 2, 'یک چیزی که دلت میخواد بهم بگی ولی رودربایستی داری.', true),
    (v_couple, null, 'dare', 2, 'یک چیز که فکر میکنی من اشتباه میکنم رو بگو.', true),
    (v_couple, null, 'dare', 2, 'یک بار بگو کِی بیشتر از همه به من افتخار کردی.', true),
    (v_couple, null, 'dare', 2, 'یک حرف که سه ساله میخوای بزنی رو بزن.', true),
    (v_couple, null, 'dare', 2, 'یک چیز که از من پنهان کردی رو بگو (هرچی که هست).', true),
    (v_couple, null, 'dare', 2, 'یک چیزی که فکر میکنی بهم گفتنش ناراحتت میکنه.', true),
    (v_couple, null, 'dare', 2, 'یک بار صادقانه بگو چه چیزی در من آزارت میده.', true),
    (v_couple, null, 'dare', 2, 'یک چیزی که دوست داری در رابطهمون عوض شه.', true),
    (v_couple, null, 'dare', 2, 'یک پیام به من بفرست که فقط یک کلمه باشه: واقعیترین کلمه.', true),
    (v_couple, null, 'dare', 2, 'یک چیزی که همیشه میخواستی بدونی رو بپرس.', true),
    (v_couple, null, 'dare', 2, 'یک بار بگو از کدوم کار خودت خجالت میکشی.', true),
    (v_couple, null, 'dare', 2, 'یک چیز که بهم گفتی و پشیمونی رو بگو.', true),

    -- رک
    (v_couple, null, 'dare', 3, 'یک چیز که فکر میکنی اگه بگم، رابطهمون عوض میشه رو بگو.', true),
    (v_couple, null, 'dare', 3, 'یک بار کامل صادق باش: چیزی که در من دوست نداری؟', true),
    (v_couple, null, 'dare', 3, 'یک چیز که تا حالا به هیچکس نگفتی رو بگو.', true),
    (v_couple, null, 'dare', 3, 'یک حقیقت که ممکنه ناراحتت کنه رو بگو.', true),
    (v_couple, null, 'dare', 3, 'بگو کِی به جدایی فکر کردی.', true),
    (v_couple, null, 'dare', 3, 'بگو چیزی که ازش میترسی در مورد ما.', true),
    (v_couple, null, 'dare', 3, 'بگو یک چیزی که هرگز نبخشیدی.', true),
    (v_couple, null, 'dare', 3, 'بگو چه چیزی در خودت رو دوست نداری.', true),
    (v_couple, null, 'dare', 3, 'بگو بزرگترین دروغی که به خودت گفتی.', true),
    (v_couple, null, 'dare', 3, 'بگو چه چیزی رو هنوز هضم نکردی.', true),
    (v_couple, null, 'dare', 3, 'بگو چه چیزی رو دوست داری من هیچوقت نفهمم.', true),
    (v_couple, null, 'dare', 3, 'بگو صادقانه، من رو چقدر میشناسی؟', true),
    (v_couple, null, 'dare', 3, 'بگو چیزی که فکر میکنی بین ما حل نشده.', true),
    (v_couple, null, 'dare', 3, 'بگو یک چیز که از خودت میترسی.', true),
    (v_couple, null, 'dare', 3, 'بگو چه چیزی رو نمیخوای دربارهی من بدونی.', true),
    (v_couple, null, 'dare', 3, 'بگو بزرگترین آرزوت چیه و چرا.', true),
    (v_couple, null, 'dare', 3, 'بگو چه چیزی تو رو از من دور میکنه.', true),
    (v_couple, null, 'dare', 3, 'بگو اگه من نبودم، الان کجا بودی.', true),
    (v_couple, null, 'dare', 3, 'بگو چیزی که از گفتنش میترسی.', true),
    (v_couple, null, 'dare', 3, 'بگو یک چیز که تو رو به گریه میاندازه.', true),

    -- باهم: done together, both answer
    (v_couple, null, 'together', 1, 'هر دو یک عکس از جاییکه الان هستید بفرستید.', true),
    (v_couple, null, 'together', 1, 'هر دو یک آهنگ بفرستید — ببینیم چقدر شبیهیم.', true),
    (v_couple, null, 'together', 1, 'هر دو سه چیزی که الان حس میکنید رو بنویسید.', true),
    (v_couple, null, 'together', 1, 'هر دو یک خاطره از اولین دیدار بنویسید.', true),
    (v_couple, null, 'together', 1, 'هر دو بگید امروز چه چیزی خوشحالتون کرد.', true),
    (v_couple, null, 'together', 1, 'هر دو یک چیز که از هم یاد گرفتید بنویسید.', true),
    (v_couple, null, 'together', 1, 'هر دو یک آرزو برای ماه آینده بنویسید.', true),
    (v_couple, null, 'together', 1, 'هر دو بگید الان چه حسی به هم دارید — یک کلمه.', true),
    (v_couple, null, 'together', 1, 'هر دو یک چیز که دلتون میخواد با هم انجام بدید بنویسید.', true),
    (v_couple, null, 'together', 1, 'هر دو بگید بهترین چیزی که این هفته داشتید چی بود.', true),
    (v_couple, null, 'together', 2, 'هر دو یک چیزی که از هم پنهان کردید بنویسید.', true),
    (v_couple, null, 'together', 2, 'هر دو بگید چه چیزی در رابطه سخته.', true),
    (v_couple, null, 'together', 2, 'هر دو یک چیز که میخواید عوض شه بنویسید.', true),
    (v_couple, null, 'together', 2, 'هر دو بگید کِی بیشتر از همه به هم نیاز داشتید.', true),
    (v_couple, null, 'together', 2, 'هر دو یک ترس خودتون رو بنویسید.', true),
    (v_couple, null, 'together', 2, 'هر دو بگید چه چیزی در هم دوست دارید که بهش نگفتید.', true),
    (v_couple, null, 'together', 2, 'هر دو یک چیز که میخواید در آینده با هم بسازید بنویسید.', true),
    (v_couple, null, 'together', 2, 'هر دو بگید چیزی که فکر میکنید طرف مقابل نمیدونه.', true),
    (v_couple, null, 'together', 3, 'هر دو بگید بزرگترین ترستون دربارهی ما چیه.', true),
    (v_couple, null, 'together', 3, 'هر دو یک حقیقت که هیچوقت نگفتید بنویسید.', true),
    (v_couple, null, 'together', 3, 'هر دو بگید چه چیزی رو نبخشیدید.', true),
    (v_couple, null, 'together', 3, 'هر دو بگویید اگه امروز آخرین روز بود چه میگفتید.', true),
    (v_couple, null, 'together', 3, 'هر دو صادقانه بگید رابطهمون رو چطور میبینید.', true),
    (v_couple, null, 'together', 3, 'هر دو یک چیز که از خودتون میترسید بنویسید.', true);

  get diagnostics v_added = row_count;

  insert into public.game_settings (couple_id) values (v_couple)
  on conflict (couple_id) do nothing;

  return jsonb_build_object('seeded', true, 'builtin', v_added);
end;
$fn$;

revoke all on function public.game_seed() from public, anon;
grant execute on function public.game_seed() to authenticated;

-- ------------------------------------------------------------
-- 6. game_state — everything the page needs, in one round trip
-- ------------------------------------------------------------
create or replace function public.game_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_set     public.game_settings;
  v_open    public.game_turns;
  v_open_card public.game_cards;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select * into v_set from public.game_settings s where s.couple_id = v_couple;

  -- The open turn, if any. One at a time: the game is a conversation, and two
  -- open cards would let one person race ahead and lose the thread.
  select * into v_open
  from public.game_turns t
  where t.couple_id = v_couple and t.outcome is null
  order by t.created_at desc
  limit 1;

  if v_open.id is not null then
    select * into v_open_card from public.game_cards c where c.id = v_open.card_id;
  end if;

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'max_level', coalesce(v_set.max_level, 2),
      'avoid_repeats', coalesce(v_set.avoid_repeats, true)
    ),
    'counts', jsonb_build_object(
      'total',   (select count(*) from public.game_cards c
                   where c.couple_id = v_couple and c.retired_at is null),
      'builtin', (select count(*) from public.game_cards c
                   where c.couple_id = v_couple and c.retired_at is null and c.builtin),
      'ours',    (select count(*) from public.game_cards c
                   where c.couple_id = v_couple and c.retired_at is null and not c.builtin),
      'played',  (select count(*) from public.game_turns t where t.couple_id = v_couple)
    ),
    'open_turn', case when v_open.id is null then null else jsonb_build_object(
      'id',        v_open.id,
      'card_id',   v_open.card_id,
      'kind',      v_open_card.kind,
      'level',     v_open_card.level,
      'body',      v_open_card.body,
      'asked_of',  v_open.asked_of,
      'asked_by',  v_open.asked_by,
      -- who is allowed to answer this turn, from the server's point of view
      'can_answer', v_open.asked_of = v_uid and (
        v_open_card.kind <> 'together' or not exists (
          select 1 from public.game_together_answers a
          where a.turn_id = v_open.id and a.user_id = v_uid
        )
      ),
      'together_answers', (
        select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'body', a.body)
                                  order by a.created_at), '[]'::jsonb)
        from public.game_together_answers a where a.turn_id = v_open.id
      ),
      'created_at', v_open.created_at
    ) end,
    'recent', (
      select coalesce(jsonb_agg(row order by created_at desc), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'id', t.id, 'card_id', t.card_id, 'kind', c.kind, 'level', c.level,
          'body', c.body, 'answer', t.answer,
          'asked_of', t.asked_of, 'asked_by', t.asked_by,
          'outcome', t.outcome, 'answered_at', t.answered_at,
          'created_at', t.created_at
        ) as row, t.created_at
        from public.game_turns t
        join public.game_cards c on c.id = t.card_id
        where t.couple_id = v_couple and t.outcome is not null
        order by t.created_at desc
        limit 12
      ) s
    )
  );
end;
$fn$;

revoke all on function public.game_state() from public, anon;
grant execute on function public.game_state() to authenticated;

-- ------------------------------------------------------------
-- 7. game_deal — put a card on the table
-- ------------------------------------------------------------
-- Turn-taking lives here, not in the client. Rules:
--   · Nobody may deal while a turn is open. Answer or skip first.
--   · The dealer is whoever tapped, so `asked_of` is the *other* person —
--     except for `together` cards, which are asked of the drawer so that both
--     of them can answer it.
--   · Only cards at or below the ceiling are eligible.
--   · If `avoid_repeats`, cards already dealt are excluded; once the eligible
--     deck is empty the restriction lifts rather than dead-ending the game.
create or replace function public.game_deal(p_kind text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_couple  uuid;
  v_partner uuid;
  v_max     int;
  v_avoid   boolean;
  v_kind    text := nullif(lower(btrim(coalesce(p_kind, ''))), '');
  v_card    public.game_cards;
  v_recent  int;
  v_turn    uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  -- Settings are read as two scalars rather than a record: the row may not
  -- exist yet if a couple opens the game before the seed has run.
  v_max   := coalesce((select s.max_level from public.game_settings s where s.couple_id = v_couple), 2);
  v_avoid := coalesce((select s.avoid_repeats from public.game_settings s where s.couple_id = v_couple), true);

  if v_kind is not null and v_kind not in ('truth', 'dare', 'together') then
    raise exception 'UNKNOWN_KIND' using errcode = 'check_violation';
  end if;

  -- Same guard style as chat: one counter, checked before the write. The game
  -- is slower than chat by nature, so the ceiling can be low without being
  -- annoying — 120 deals an hour is far beyond real play.
  select count(*) into v_recent
  from public.game_turns t
  where t.couple_id = v_couple and t.created_at > now() - interval '1 hour';

  if v_recent >= 120 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  -- Serialise deals for this couple, so the open-turn check below and the
  -- insert that follows cannot be interleaved with another session's.
  perform 1 from public.couples c where c.id = v_couple for update;

  if exists (
    select 1 from public.game_turns t
    where t.couple_id = v_couple and t.outcome is null
  ) then
    raise exception 'TURN_IN_PROGRESS' using errcode = 'check_violation';
  end if;

  -- The other person.
  select case when c.requester_id = v_uid then c.addressee_id else c.requester_id end
    into v_partner
  from public.couples c
  where c.id = v_couple;

  if v_partner is null then
    raise exception 'NO_PARTNER' using errcode = 'no_data_found';
  end if;

  -- Choose a card. `order by random()` is fine at this size (a few hundred
  -- rows for one couple); an index-backed alternative would be premature.
  select c.* into v_card
  from public.game_cards c
  where c.couple_id = v_couple
    and c.retired_at is null
    and c.level <= v_max
    and (v_kind is null or c.kind = v_kind)
    and (
      not v_avoid
      or not exists (
        select 1 from public.game_turns t
        where t.couple_id = v_couple and t.card_id = c.id
      )
    )
  order by random()
  limit 1;

  -- Deck exhausted under the no-repeat rule: deal a repeat rather than nothing.
  if v_card.id is null then
    select c.* into v_card
    from public.game_cards c
    where c.couple_id = v_couple
      and c.retired_at is null
      and c.level <= v_max
      and (v_kind is null or c.kind = v_kind)
    order by random()
    limit 1;
  end if;

  if v_card.id is null then
    raise exception 'EMPTY_DECK' using errcode = 'no_data_found';
  end if;

  begin
    insert into public.game_turns (couple_id, card_id, asked_of, asked_by)
    values (
      v_couple,
      v_card.id,
      case when v_card.kind = 'together' then v_uid else v_partner end,
      v_uid
    )
    returning id into v_turn;
  exception when unique_violation then
    -- The partial index caught a concurrent deal. Same message as the check
    -- above, so the client never has to know which one won the race.
    raise exception 'TURN_IN_PROGRESS' using errcode = 'check_violation';
  end;

  return public.game_state();
end;
$fn$;

revoke all on function public.game_deal(text) from public, anon;
grant execute on function public.game_deal(text) to authenticated;

-- ------------------------------------------------------------
-- 8. game_answer — close a turn
--
-- For truth/dare: the person the card was put to writes the answer.
-- For together cards: *both* people write, and the turn closes only when the
-- second one arrives. Writing twice is not allowed; editing an answer is,
-- because people re-read what they wrote and want to add a sentence.
-- ------------------------------------------------------------
create or replace function public.game_answer(p_turn uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_turn   public.game_turns;
  v_kind   text;
  v_body   text := btrim(coalesce(p_body, ''));
  v_have   int;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if char_length(v_body) < 1 then
    raise exception 'EMPTY_ANSWER' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 600 then
    raise exception 'ANSWER_TOO_LONG' using errcode = 'check_violation';
  end if;

  select * into v_turn
  from public.game_turns t
  where t.id = p_turn and t.couple_id = v_couple
  for update;

  if v_turn.id is null then
    raise exception 'NO_SUCH_TURN' using errcode = 'no_data_found';
  end if;
  if v_turn.outcome is not null then
    raise exception 'TURN_CLOSED' using errcode = 'check_violation';
  end if;

  select c.kind into v_kind from public.game_cards c where c.id = v_turn.card_id;

  if v_kind = 'together' then
    -- Both halves answer a together card, so the person answering is not
    -- necessarily the one it was "asked of". The right check is membership in
    -- this couple, which current_couple_id() has already established.
    if not exists (
      select 1 from public.couples c
      where c.id = v_couple and v_uid in (c.requester_id, c.addressee_id)
    ) then
      raise exception 'NOT_YOUR_TURN' using errcode = 'insufficient_privilege';
    end if;

    insert into public.game_together_answers (turn_id, user_id, body)
    values (p_turn, v_uid, v_body)
    on conflict (turn_id, user_id) do update set body = excluded.body;

    select count(*) into v_have
    from public.game_together_answers a where a.turn_id = p_turn;

    if v_have >= 2 then
      update public.game_turns
      set outcome = 'answered', answered_at = now()
      where id = p_turn;
    end if;
  else
    if v_turn.asked_of <> v_uid then
      raise exception 'NOT_YOUR_TURN' using errcode = 'insufficient_privilege';
    end if;

    update public.game_turns
    set answer = v_body, answered_at = now(), outcome = 'answered'
    where id = p_turn;
  end if;

  return public.game_state();
end;
$fn$;

revoke all on function public.game_answer(uuid, text) from public, anon;
grant execute on function public.game_answer(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 9. game_skip — a turn nobody answered must not wedge the game
-- ------------------------------------------------------------
create or replace function public.game_skip(p_turn uuid)
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

  -- Either person may skip: waiting for the other to come back online is the
  -- one thing that would make this feel like an obligation instead of a game.
  update public.game_turns t
  set outcome = 'skipped', skipped_at = now()
  where t.id = p_turn and t.couple_id = v_couple and t.outcome is null;

  if not found then
    raise exception 'NO_SUCH_TURN' using errcode = 'no_data_found';
  end if;

  return public.game_state();
end;
$fn$;

revoke all on function public.game_skip(uuid) from public, anon;
grant execute on function public.game_skip(uuid) to authenticated;

-- ------------------------------------------------------------
-- 10. game_add_card — the deck is theirs
--
-- Writes go through here so the checks are not client-side only: length,
-- level range, kind, and a rolling cap so one person cannot paste in a
-- thousand cards in a minute.
-- ------------------------------------------------------------
create or replace function public.game_add_card(
  p_kind text,
  p_level int,
  p_body text
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
  v_body   text := btrim(coalesce(p_body, ''));
  v_recent int;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if v_kind not in ('truth', 'dare', 'together') then
    raise exception 'UNKNOWN_KIND' using errcode = 'check_violation';
  end if;
  if p_level is null or p_level < 1 or p_level > 3 then
    raise exception 'UNKNOWN_LEVEL' using errcode = 'check_violation';
  end if;
  if char_length(v_body) < 3 then
    raise exception 'CARD_TOO_SHORT' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 280 then
    raise exception 'CARD_TOO_LONG' using errcode = 'check_violation';
  end if;

  -- Count only cards the couple wrote. The seeded starter pack lands in one
  -- transaction and would otherwise eat the hourly budget, locking a
  -- brand-new couple out of their own card list for an hour.
  select count(*) into v_recent
  from public.game_cards c
  where c.couple_id = v_couple and not c.builtin
    and c.created_at > now() - interval '1 hour';

  if v_recent >= 60 then
    raise exception 'TOO_MANY' using errcode = 'check_violation';
  end if;

  insert into public.game_cards (couple_id, created_by, kind, level, body, builtin)
  values (v_couple, v_uid, v_kind, p_level, v_body, false)
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$fn$;

revoke all on function public.game_add_card(text, int, text) from public, anon;
grant execute on function public.game_add_card(text, int, text) to authenticated;

-- ------------------------------------------------------------
-- 11. game_cards_page — the list
--
-- Paged and filterable, because this is the screen people return to when they
-- want to *find* a card they wrote. Ordered newest-first for their own cards
-- and by level for the starters, so the list does not interleave randomly.
-- ------------------------------------------------------------
create or replace function public.game_cards_page(
  p_kind    text default null,
  p_level   int  default null,
  p_source  text default null,   -- 'builtin' | 'ours' | null
  p_limit   int  default 50,
  p_offset  int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_kind   text := nullif(lower(btrim(coalesce(p_kind, ''))), '');
  v_source text := nullif(lower(btrim(coalesce(p_source, ''))), '');
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  if v_source is not null and v_source not in ('builtin', 'ours') then
    raise exception 'UNKNOWN_SOURCE' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'total', (
      select count(*) from public.game_cards c
      where c.couple_id = v_couple and c.retired_at is null
        and (v_kind is null or c.kind = v_kind)
        and (p_level is null or c.level = p_level)
        and (v_source is null
             or (v_source = 'builtin' and c.builtin)
             or (v_source = 'ours' and not c.builtin))
    ),
    'cards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'level', c.level, 'body', c.body,
        'builtin', c.builtin, 'created_by', c.created_by, 'created_at', c.created_at
      ) order by c.builtin asc, c.created_at desc), '[]'::jsonb)
      from public.game_cards c
      where c.couple_id = v_couple and c.retired_at is null
        and (v_kind is null or c.kind = v_kind)
        and (p_level is null or c.level = p_level)
        and (v_source is null
             or (v_source = 'builtin' and c.builtin)
             or (v_source = 'ours' and not c.builtin))
      order by c.builtin asc, c.created_at desc
      limit v_limit offset v_offset
    )
  );
end;
$fn$;

revoke all on function public.game_cards_page(text, int, text, int, int) from public, anon;
grant execute on function public.game_cards_page(text, int, text, int, int) to authenticated;

-- ------------------------------------------------------------
-- 12. game_retire_card — remove one of *your* cards from the deck
--
-- Only cards the couple wrote. The starter pack is not deletable: it is a
-- fixed reference point, and removing it would make "our deck" mean nothing.
-- ------------------------------------------------------------
create or replace function public.game_retire_card(p_card uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_uid    uuid := auth.uid();
  v_couple uuid;
  v_builtin boolean;
begin
  if v_uid is null then
    raise exception 'auth required' using errcode = 'insufficient_privilege';
  end if;

  v_couple := public.current_couple_id();
  if v_couple is null then
    raise exception 'NO_ACTIVE_COUPLE' using errcode = 'no_data_found';
  end if;

  select c.builtin into v_builtin
  from public.game_cards c
  where c.id = p_card and c.couple_id = v_couple and c.retired_at is null;

  if not found then
    raise exception 'NO_SUCH_CARD' using errcode = 'no_data_found';
  end if;

  if v_builtin then
    raise exception 'BUILTIN_LOCKED' using errcode = 'check_violation';
  end if;

  update public.game_cards set retired_at = now() where id = p_card;

  return jsonb_build_object('retired', p_card);
end;
$fn$;

revoke all on function public.game_retire_card(uuid) from public, anon;
grant execute on function public.game_retire_card(uuid) to authenticated;

-- ------------------------------------------------------------
-- 13. game_set_level — the ceiling, changeable at any time
-- ------------------------------------------------------------
create or replace function public.game_set_level(p_max_level int, p_avoid_repeats boolean default null)
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

  if p_max_level is null or p_max_level < 1 or p_max_level > 3 then
    raise exception 'UNKNOWN_LEVEL' using errcode = 'check_violation';
  end if;

  insert into public.game_settings (couple_id, max_level, avoid_repeats, updated_at)
  values (v_couple, p_max_level, coalesce(p_avoid_repeats, true), now())
  on conflict (couple_id) do update
    set max_level = excluded.max_level,
        avoid_repeats = coalesce(p_avoid_repeats, public.game_settings.avoid_repeats),
        updated_at = now();

  return public.game_state();
end;
$fn$;

revoke all on function public.game_set_level(int, boolean) from public, anon;
grant execute on function public.game_set_level(int, boolean) to authenticated;
