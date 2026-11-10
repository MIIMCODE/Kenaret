# کنارت (Kenaret)

A soft, private web app for long-distance couples. Mobile-first, fully static,
and entirely in Persian with an RTL layout.

**Live:** https://miimcode.github.io/Kenaret/

---

## Stack

| Layer | Choice |
| --- | --- |
| Build | Vite 7 + React 19 + TypeScript |
| Styling | Tailwind CSS 3, Vazirmatn (bundled locally) |
| Backend | Supabase (Auth, Postgres, Storage) |
| Routing | `HashRouter` — a refresh can never 404 on GitHub Pages |
| Hosting | GitHub Pages, static build under `/Kenaret/` |

There is **no server code**. Everything the browser can do is limited by
Postgres Row Level Security and `SECURITY DEFINER` RPCs.

---

## Features

### Auth
- Email + password sign-up and sign-in via Supabase Auth.
- **PKCE** flow with email confirmation. The confirmation link comes back to
  `https://miimcode.github.io/Kenaret/#/auth/callback`, which works with
  `HashRouter` (the code is read from the query string *or* the hash, then the
  URL is scrubbed so a refresh cannot replay it).
- Signed-out visitors can only reach the landing page and the auth pages;
  every other route is guarded client-side.

### Onboarding (runs once, resumable)
1. Gender — دختر / پسر
2. Name + birth date (Jalali picker, stored as Gregorian)
3. Period setup — **girls only**: last period start, cycle length (28),
   period length (5), regular or not
4. Interests — preset tags + a free-text custom one
5. Profile photo — upload from the gallery or pick one of **16 built-in
   avatars**

A progress bar tracks the steps. Each step is saved immediately, and
`profiles.onboarding_step` records the position, so leaving and coming back
(including on another device) resumes where you stopped.

### Pairing
- Every profile gets a unique **8-character code** using the alphabet
  `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — no `O`, `0`, `I` or `1`.
- Enter your partner's code to send a request; they must accept it.
- Rules enforced in the database: no self-pairing, exactly one active partner
  per user, clear Persian errors for invalid or unknown codes.
- Once connected, both partners see each other's name, photo, interests and
  birth date.

### روزهای مهم (the shared calendar)
- One page (`/dates`) with the yearly anniversary, the next monthiversary, day
  milestones, both birthdays and — for the account owner only — the next
  period window, grouped by Jalali month.
- Birthdays and anniversaries are computed on the **Jalali** calendar, which is
  the one people celebrate; 30 Esfand clamps to 29 in a non-leap year instead
  of vanishing.
- Reminders arrive **one day before** by email, switchable per kind in settings.
  The job runs inside Supabase (pg_cron + pg_net), so the site stays static.

### Cycle sharing (opt-in, one tap, revocable)
The girl's period data stays her own by default. She can choose — from
Settings → «اطلاعات پریود» → **«به اشتراک بگذار»** — to let her partner see a
*status*, and nothing more:

| She sees | He sees |
| --- | --- |
| her real dates and window | «این روزها پریود است» / «نزدیک پریود است» / «روزهای آرامش» |
| a loud banner while sharing is on | a countdown in days, never a date |
| «خاموشش کن» at any time | the card disappears the moment she does |

How it is enforced, not just promised:

- `period_settings` RLS is untouched — the partner has **no** SELECT grant, and
  `cycle_shares` has no partner read policy either. The only partner path is
  `partner_cycle_status()`, a `security definer` function that returns words.
- Consent is bound to the **couple** row, so `unlink_partner()` deletes it:
  re-pairing with somebody new never inherits an old yes.
- `reminder_queue()` only produces the «فردا برای … روز سختی است» row while the
  share for *that* couple is on, so turning it off also stops the emails.

#### Turning email reminders on

Two scheduled jobs and one Vault secret. Until the secret exists every attempt
is recorded as `skipped` and the calendar keeps working — nothing is lost.

1. Get an API key from [Resend](https://resend.com) (free tier is fine) and
   verify a sending domain, or use their test sender.
2. Store it in Vault (never in the repo):

   ```sql
   select vault.create_secret('re_xxxxxxxx', 'resend_api_key');
   ```

3. Enable the extensions and schedule both passes — 08:00 Tehran time:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select cron.schedule(
     'kenaret-reminders',
     '30 4 * * *',                -- 04:30 UTC = 08:00 Asia/Tehran
     $$ select public.send_reminders(); $$
   );

   select cron.schedule(
     'kenaret-reminder-reconcile',
     '40 4 * * *',                -- ten minutes later
     $$ select public.reconcile_reminder_delivery(); $$
   );
   ```

4. Check it worked:

   ```sql
   select * from public.reminder_log order by created_at desc limit 20;
   select public.reminder_queue(current_date + 1);  -- who would be mailed
   ```

Run `send_reminders()` by hand any time — the unique index on `reminder_log`
makes a second run a no-op rather than a duplicate email.

**Delivery is confirmed in two passes on purpose.** pg_net only *queues* the
request, so `send_reminders()` stores the request id and leaves the row
`queued`; `reconcile_reminder_delivery()` then reads the real HTTP reply and
marks the row `sent` or `failed` with the provider's message. Skipping the
second pass would let a rejected mail look delivered.

> **Known limitation until a domain is verified at
> [resend.com/domains](https://resend.com/domains):** Resend's test mode only
> accepts the account owner's own address as a recipient, and every other
> address is refused with `403 ... you can only send testing emails to your own
> email address`. Those rows now show up as `failed` with that reason in
> Settings → «تاریخچه‌ی یادآوری‌ها», instead of silently vanishing. Verifying a
> domain and changing the `from` address in `send_reminders()` lifts the limit.

### In-app reminders (the bell)
A bell in the header shows everything coming up in the next **three days** —
tomorrow's anniversary, a birthday, a milestone, or her own period — with a
Persian-digit badge and a bottom sheet listing each one.

It matters because it is the channel that *works today*: email still needs a
verified sending domain, so a mail may 403 while the bell always fires.

- Backed by **`my_upcoming_reminders(days)`**, which wraps the same
  `reminder_queue()` the nightly mail job reads, so the bell and the email can
  never disagree. `reminder_queue()` itself stays un-executable by clients: it
  is a definer function that can describe a partner's cycle *when she
  consented*, so exposing it directly would leak the whole queue. The wrapper
  returns only `user_id = auth.uid()` rows and caps the window at 14 days.
- `reminder_queue(p_day)` is **day-exact**, not a range — it answers "what
  happens on this date". The wrapper therefore asks it once per day in the
  window. (Reading it for `current_date` and expecting the next three days was
  the first version of this feature, and it silently showed nothing.)
- The bell honours the same switches as the mail job (`reminder_prefs`): a kind
  the user turned off never comes back through a different door.
- A failed load is silent — no error banner, no badge. An empty bell says so
  plainly and links to «روزهای مهم».

### دیدار بعدی (the next reunion)
A couple who are apart usually *know* the next date they will be together — they
just have no shared place to keep it. The dashboard card turns that date into a
countdown, so «۱۹ روز مانده» shrinks every morning instead of distance being a
vague weight.

- One row per couple (`reunions`, unique on `couple_id`), an optional 140-char
  note for the practical detail («فرودگاه، پرواز ۸ صبح»), and a Jalali date
  picker for the day itself.
- **Either partner may set, move or clear it.** There is no
  request/confirm dance: either one may be the first to find out.
- The copy changes with the number rather than swapping a digit into one
  sentence: «تا دیدار بعدی / ۱۹ روز», «فقط یک خواب / فردا میبینیش»,
  «بالاخره رسید / امروز میبینیش». A date in the past is labelled as past —
  never counted upwards.
- `reminder_queue()` gained a `reunion` branch, so the nightly job mails
  «فردا میبینیش» the day before and the bell shows the same line. Both partners
  get it; the reminders master switch does silence it, like every other date.
- Writes are RPC-only (`set_reunion`, `clear_reunion`) with `select` as the only
  grant on the table, so a client cannot pin a reunion onto another couple.
  Dates in the past are rejected with `DATE_IN_PAST`.

### warmth — «دلم برات تنگ شده» without starting a conversation
Three taps on the partner card — **🤍 دلم تنگ شده**, **🫂 بغل**, **☀️ قوت قلب** —
and the signal appears in the partner's bell on their next visit.

It is deliberately **not a chat**: no text, no threads, no history page, nothing
to keep up with. That constraint is the feature — the moment it grows a message
box it becomes another inbox to feel guilty about.

- `warmth` is couple-scoped like `cycle_shares`; writes are RPC-only.
- `send_warmth(kind)` rate-limits **in the database**, not the UI: five per hour
  per sender (`TOO_MANY`), and repeating the *same* kind within two minutes
  returns `ALREADY_SENT` — that is what a double-tap on a phone means, so the
  button still settles into its happy state instead of flashing an error.
- Reading is the acknowledgement. `my_warmth()` returns the partner's unseen
  signals from the last 24 h **and marks them seen**, so a hug shows exactly
  once and no «mark as read» button exists.
- The badge needs a number without consuming anything, so a second read-only
  function `unseen_warmth_count()` exists. Counting through `my_warmth()` was
  the first design and it marked hugs seen while the sheet was still closed —
  the user got a badge, opened the bell, and found nothing.
- Warmth **ignores the reminders master switch**. A reminder is the app talking
  to you; a hug is your partner. Silencing dates must not block the person, and
  `ReminderSettings` says so in the switch's hint.

### نوتیفیکیشن روی گوشی (Web Push)
The bell only speaks to someone who has already opened the app. Web Push is the
third channel — after the in-app bell and email — and the only one that reaches a
**closed** app.

The pipeline, bottom to top:

```
pg_cron (*/5)  →  push_cron_tick()  →  pg_net  →  edge fn `push-send`
                                                      │  RFC 8291 encrypt + VAPID
                                                      ▼
                                              the push service → the phone
```

- **`push_subscriptions`** — one row per device that granted permission.
  `SELECT` is limited to your own rows; writes are RPC-only.
- **`push_queue`** — an outbox with `unique (user_id, topic)`, where `topic` is
  `reunion:2026-11-29` or `warmth:<uuid>`. That constraint, not application
  logic, is what makes a duplicate notification impossible.
- **`push_dispatch()`** claims rows with `for update skip locked`. The cron job
  and a manual "test" can run at the same time; each gets a different batch, and
  a row leaves `pending` exactly once. Rows whose worker died are re-claimed
  after ten minutes, and the unique constraint stops the retry becoming a
  second notification.
- **`push-send`** is the only place holding the VAPID private key and the only
  place doing RFC 8291 encryption. `npm:web-push` is used rather than hand-rolled
  crypto because the aes128gcm header, HKDF info strings and VAPID JWT are easy
  to get *subtly* wrong — and a subtly-wrong push fails silently on the device.
- **Reminders feed the queue from `reminder_queue()`**, the same function the
  bell and the mail job read, so no channel can promise something the others
  would not say. **`send_warmth()`** enqueues directly, so a hug is on the
  phone before the page has finished updating; a push failure never fails the
  gesture.
- A **410/404** from the push service marks the device revoked (it will never
  work again); **429/5xx** returns the row to `pending` for a retry. Both are
  recorded in `push_queue.last_error`.

#### The three states people actually land in
Push fails in ways that look identical to a user ("the switch does nothing"), so
each one gets its own screen:

| Situation | What the card says |
| --- | --- |
| Android/desktop, not yet on | A switch, plus what will actually be sent |
| Blocked at the browser/OS level | Instructions — no API can undo a "Block" |
| iPhone in a Safari **tab** | "Install it first": iOS exposes no `PushManager` outside an installed app |

Permission is requested **only on an explicit tap**. A prompt shown on page load
is the fastest way to get permanently blocked, which is worse than never asking.

Other behaviours worth knowing:

- The edge function **must answer CORS**. `functions.invoke()` sends
  `Authorization` and `Content-Type: application/json`, which forces a
  preflight; a function that answers `OPTIONS` with `405` and omits
  `Access-Control-Allow-*` makes the browser discard the response, and the
  caller sees what looks like a network failure. Every response — including
  `401`/`500` — carries the headers, because an error without them is equally
  unreadable.
- The test button **seeds its own row** (`push_seed_test`) before asking the
  worker to send. The five-minute cron normally drains the queue, so without
  this the button would report `sent: 0` and look broken.
- `push_finish()` acts on the `subscription_id` the worker pushed to. Revoking
  by `user_id` would let one dead phone silence a working one on the same
  account.
- The VAPID **public** key is handed to browsers by `push_config()`, so it lives
  in vault and rotating the pair is a secret update rather than a rebuild.
- The subscription is silently re-upserted on every app start, because browsers
  rotate push endpoints without telling anyone.
- Tapping a notification focuses an open window and posts the intended route to
  it (`/app`, `/dates`); a foreign URL in that message is ignored.
- The service worker sets `tag` from `topic`, so a newer notification for the
  same subject replaces the older one instead of stacking.

### Installing on the phone (PWA)
Kenaret installs to the home screen and then behaves like an app: its own
icon, no address bar, and a cold start straight into the dashboard.

- **Icons** are generated from the brand heart (`favicon.svg`) into
  `public/icons/`: 192/512 for the manifest, a **maskable** pair whose heart
  sits inside Android's 80 % safe circle, and a real **180×180 PNG** for iOS
  (Safari ignores SVG for `apple-touch-icon` — the card simply did not appear
  before this). `favicon-32/16` cover the browser tab.
- **`public/manifest.webmanifest`** is RTL/Persian, `display: standalone`,
  `start_url: ./index.html#/app`, and its `scope` stays inside `/Kenaret/`.
- **Install hint** (`InstallHint`, bottom of the dashboard): Android/desktop get
  a button that opens the real install dialog via the captured
  `beforeinstallprompt`; iPhone gets the two taps in Safari's share sheet,
  because Apple ships no install API. It never renders inside the installed
  app, and dismissing it hides it for two weeks. Chrome/Firefox on iOS are
  skipped on purpose — they cannot add to the home screen at all.
- **Service worker** (`public/sw.js`) gives the installed app an offline shell:
  network-first navigations (so a deploy is picked up on the next launch),
  cache-first for content-hashed `/assets/*`, and **nothing** from
  `supabase.co` ever cached — API, auth and signed avatar URLs bypass the
  worker entirely, so private data is never served off a disk cache.
  Bump `VERSION` in that file when the caching rules change.

> On iOS the icon only appears after **Share → Add to Home Screen**; there is no
> automatic prompt, by design of Safari.

### Relationship start date
- Right after a couple connects, the partner who sent the request is asked
  «تاریخ آشنایی‌اتون کی بوده؟» in the dashboard, with a Jalali picker.
- If they cannot remember, **«یادم نیست، از … بپرس»** hands the same question
  to the other partner; the first person then sees "منتظر تاریخ" and can still
  answer it themselves if they remember first.
- Once a date exists the dashboard shows the age of the relationship, the next
  monthly anniversary, the next yearly anniversary and the nearest milestones
  (100/200/365/500/730/1000/1500/2000 days, plus 5-year jubilees).
- The date can be corrected later from Settings → «تاریخ آشنایی».

---

## Database & security

Migrations live in [`supabase/migrations`](supabase/migrations):

| File | Contents |
| --- | --- |
| `0001_profiles.sql` | profiles, pairing-code generator, signup trigger |
| `0002_period_settings.sql` | private cycle data (girls only) |
| `0003_couples.sql` | couples, pairing RPCs, helper functions |
| `0004_storage.sql` | private `avatars` bucket and its policies |
| `0005_anniversary.sql` | relationship start date, turn bookkeeping, RPCs |
| `0006_ask_requester_first.sql` | ask the requester first; repair pending turns |
| `0007_reminders.sql` | Jalali↔Gregorian tables, reminder queue + mailer |
| `0008_share_cycle.sql` | consent-based cycle sharing, partner-aware queue |
| `0009_in_app_reminders.sql` | the bell's `my_upcoming_reminders()` |
| `0010_reunion_and_warmth.sql` | reunion countdown, warmth signals, reunion reminder |
| `0011_push_subscriptions.sql` | Web Push: subscriptions, outbox, worker RPCs, cron |

**RLS is the only security layer, so the rules are strict:**

- `profiles` — you can read/write your own row; an **active partner** can read
  yours. Nobody else can.
- `period_settings` — **owner only**. A partner cannot read cycle data even
  while connected (verified). The row is deleted if the profile stops being a
  girl profile.
- `couples` — clients may only `SELECT` rows they participate in. There are
  **no** `INSERT`/`UPDATE`/`DELETE` grants at all: every state change goes
  through the RPCs `request_partner`, `respond_to_request`, `cancel_request`
  and `unlink_partner`, which check `auth.uid()` themselves.
- `push_subscriptions` / `push_queue` — you can read **your own** devices and
  nothing else; the outbox has no policies at all and is reachable only through
  the worker functions, which are not executable by clients.
- `reunions` / `warmth` — `SELECT` for the active couple only, writes revoked
  entirely. Everything goes through `set_reunion`, `clear_reunion`,
  `send_warmth` and `my_warmth`, each of which resolves the couple from
  `auth.uid()` itself, so a client cannot address another couple's row.
- `storage.objects` — writes are limited to `<your-uid>/…`; reads are limited to
  you, your active partner, and the other side of a pending request. The
  `avatars` bucket is private (3 MB, image MIME types only), and URLs are
  short-lived signed links.
- A trigger enforces the one-active-partner invariant for *any* writer, and
  pairing codes are always generated server-side so a client can never choose
  its own.

---

## Local development

```bash
npm install
cp .env.example .env.local     # then fill in the two values
npm run dev                    # http://localhost:5173/Kenaret/
```

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

Only the project URL and the **anon/publishable** key are ever used on the
client. The `service_role` key must never appear in this repository or in the
frontend.

Other scripts: `npm run typecheck`, `npm run build`, `npm run preview`.

---

## Deployment

`.github/workflows/deploy.yml` builds the site and publishes it to GitHub Pages
on every push to `main`, using the official Pages actions (source:
**GitHub Actions**).

The Supabase URL and anon key are resolved in this order:

1. Repository **Variables**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (Settings → Secrets and variables → Actions → Variables)
2. [`public/public-config.json`](public/public-config.json) — a **client-safe**
   fallback that only ever holds the URL and the anon key.

Add the variables above to override the fallback, e.g. if you move to a
different Supabase project.

### Supabase Auth configuration

- Site URL: `https://miimcode.github.io/Kenaret/`
- Redirect URLs: `https://miimcode.github.io/Kenaret/`,
  `https://miimcode.github.io/Kenaret/**`, plus the two `#/auth/callback` and
  `#/reset-password` entries, and the local dev equivalents
  (`http://localhost:5173/Kenaret/**`).

### Email delivery — confirmation is **on**, the mailer is the bottleneck

**Email confirmation is enabled** (`mailer_autoconfirm: false`): a new account
must click the link before it can sign in. The `/auth/callback` route, the PKCE
exchange and the "check your inbox" screen all handle that flow.

What still holds the experience back is Supabase's **built-in** mailer:

1. **2 emails per hour**, project-wide (`rate_limit_email_sent`). A third send
   in the same hour returns *"email rate limit exceeded"*.
2. It **only delivers to the project owner's address**, so in practice most
   visitors never receive the link.

The app is built to survive that. When the cap is hit, signup does *not* show a
red error and throw the visitor away: it keeps the account, shows a calm
«سایت این لحظه شلوغه» card with a live countdown, disables the resend button
until the window passes, and reminds them their account already exists. The
same panel handles the "email not verified" case on the login page.

**To make delivery work for everyone** (dashboard, once — nothing to redeploy):

1. **Project Settings → Authentication → SMTP Settings** → add a provider
   (Resend, Brevo, SendGrid, Gmail SMTP, …) with host, port, user, password and
   a verified sender address. This also lifts the owner-only restriction.
2. **Authentication → Rate Limits → Emails per hour** → raise it to something
   realistic (e.g. 30–100).
3. Optional: **Authentication → Email Templates** → translate the confirmation
   mail to Persian.

---

## Repository layout

```
src/
  components/         shared UI (Jalali picker, avatars, cards, …)
    onboarding/       one component per onboarding step
  hooks/useAuth.tsx   session + profile context and route guards
  lib/                supabase client, API calls, Jalali helpers, error copy
  pages/              landing, auth, onboarding, dashboard, settings
public/
  avatars/            16 built-in SVG avatars
supabase/migrations/  applied to the Supabase project
```
