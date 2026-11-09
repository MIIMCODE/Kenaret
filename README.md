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

---

## Database & security

Migrations live in [`supabase/migrations`](supabase/migrations):

| File | Contents |
| --- | --- |
| `0001_profiles.sql` | profiles, pairing-code generator, signup trigger |
| `0002_period_settings.sql` | private cycle data (girls only) |
| `0003_couples.sql` | couples, pairing RPCs, helper functions |
| `0004_storage.sql` | private `avatars` bucket and its policies |

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

### Email delivery — **currently disabled on purpose**

Supabase's built-in mailer has two hard limitations that make it unusable for
real signups:

1. **2 emails per hour**, project-wide (`rate_limit_email_sent`). A third
   signup in the same hour fails with *"email rate limit exceeded"* — and the
   user row is never created.
2. It **only delivers to the project owner's address**, so partners never
   receive a confirmation link even when a send "succeeds".

Because of that, **email confirmation is currently turned off**
(`mailer_autoconfirm: true`). Signup and login work immediately with no email
involved: `signUp()` returns a session, and the app goes straight to
onboarding. The `/auth/callback` route and the PKCE handling stay in place, so
nothing needs to change in the code when you turn confirmation back on.

**To re-enable email confirmation properly:**

1. Supabase dashboard → **Project Settings → Authentication → SMTP Settings** →
   add a provider (Resend, Brevo, SendGrid, Gmail SMTP, …) with its host, port,
   user, password and a verified sender address.
2. **Authentication → Providers → Email** → turn **Confirm email** back on.
3. Raise **Authentication → Rate Limits → Emails per hour** to something
   realistic (e.g. 30–100).

The app already handles that mode — it shows a "check your inbox" screen and
warns the user if delivery is misconfigured instead of leaving them stuck.

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
