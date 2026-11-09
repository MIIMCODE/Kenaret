import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * True when the build was given a Supabase URL + anon key.
 * These are injected at build time from GitHub Actions Variables/Secrets.
 * Only the URL and the *anon/publishable* key are ever used on the client —
 * the service_role key must never appear in this repo.
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  // Fail loudly in development instead of throwing a cryptic error later.
  console.warn(
    '[Kenaret] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing. ' +
      'Add them to .env.local (dev) or to GitHub Actions variables/secrets (CI).',
  )
}

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'public-anon-key', {
  auth: {
    // PKCE is required for the email-confirmation magic link flow.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

/** Where Supabase sends the user after they confirm their email. */
export function authRedirectUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/auth/callback`
}

/** Public URL of a shipped avatar, e.g. `builtin:ava-1.svg` -> `/Kenaret/avatars/ava-1.svg`. */
export function builtinAvatarUrl(file: string): string {
  return `${import.meta.env.BASE_URL}avatars/${file}`
}
