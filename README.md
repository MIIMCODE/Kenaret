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
