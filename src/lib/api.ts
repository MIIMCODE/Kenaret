import { supabase } from './supabase'
import type { ReminderQueueRow } from './reminders'
import type {
  Gender,
  PairingState,
  PartnerCycleStatus,
  PeriodSettings,
  ReminderLogRow,
  ReminderPrefs,
  ReunionState,
  WarmthKind,
  WarmthSignal,
} from '../types/database'

export interface ProfileRow {
  id: string
  gender: Gender | null
  display_name: string | null
  birth_date: string | null
  interests: string[]
  avatar_url: string | null
  pairing_code: string
  onboarding_step: number
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

const PROFILE_COLUMNS =
  'id, gender, display_name, birth_date, interests, avatar_url, pairing_code, onboarding_step, onboarding_completed, created_at, updated_at'

export async function fetchProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .single()

  if (error) throw error
  return data as ProfileRow
}

export interface ProfilePatch {
  gender?: Gender
  display_name?: string
  birth_date?: string
  interests?: string[]
  avatar_url?: string | null
  onboarding_step?: number
  onboarding_completed?: boolean
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw error
  return data as ProfileRow
}

export async function fetchPeriodSettings(userId: string): Promise<PeriodSettings | null> {
  const { data, error } = await supabase
    .from('period_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (data as PeriodSettings | null) ?? null
}

export interface PeriodPatch {
  last_period_start: string
  cycle_length: number
  period_length: number
  is_regular: boolean
}

export async function savePeriodSettings(userId: string, patch: PeriodPatch): Promise<void> {
  const { error } = await supabase
    .from('period_settings')
    .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })

  if (error) throw error
}

export async function fetchPairingState(): Promise<PairingState> {
  const { data, error } = await supabase.rpc('get_pairing_state')
  if (error) throw error
  return data as PairingState
}

export async function requestPartner(code: string): Promise<{ status: 'pending' | 'active' }> {
  const { data, error } = await supabase.rpc('request_partner', { p_code: code })
  if (error) throw error
  return data as { status: 'pending' | 'active' }
}

export async function respondToRequest(coupleId: string, accept: boolean): Promise<{ status: string }> {
  const { data, error } = await supabase.rpc('respond_to_request', {
    p_couple_id: coupleId,
    p_accept: accept,
  })
  if (error) throw error
  return data as { status: string }
}

export async function cancelRequest(coupleId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_request', { p_couple_id: coupleId })
  if (error) throw error
}

export async function unlinkPartner(): Promise<void> {
  const { error } = await supabase.rpc('unlink_partner')
  if (error) throw error
}

// ------------------------------------------------------------------
// Anniversary
// ------------------------------------------------------------------

export type AnniversaryResult =
  | { status: 'saved'; anniversary_date: string }
  | { status: 'reassigned'; asked_user_id: string }

/** Saves the relationship start date, or hands the question to the partner. */
export async function setAnniversary(
  date: string | null,
  handToPartner = false,
): Promise<AnniversaryResult> {
  const { data, error } = await supabase.rpc('set_anniversary', {
    p_date: date,
    p_hand_to_partner: handToPartner,
  })
  if (error) throw error
  return data as AnniversaryResult
}

// ------------------------------------------------------------------
// Reminders
// ------------------------------------------------------------------

const REMINDER_COLUMNS = 'enabled, want_anniversary, want_birthday, want_period'

/**
 * The visitor's reminder settings.
 *
 * A missing row means "everything on", so a brand-new account needs no insert
 * and no backfill — the defaults live in the database.
 */
export async function fetchReminderPrefs(userId: string): Promise<ReminderPrefs> {
  const { data, error } = await supabase
    .from('reminder_prefs')
    .select(REMINDER_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return (
    (data as ReminderPrefs | null) ?? {
      enabled: true,
      want_anniversary: true,
      want_birthday: true,
      want_period: true,
    }
  )
}

export async function saveReminderPrefs(userId: string, prefs: Partial<ReminderPrefs>): Promise<void> {
  const { error } = await supabase
    .from('reminder_prefs')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' })

  if (error) throw error
}

/** What has already been mailed about this account (owner can read only their own). */
export async function fetchReminderLog(userId: string, limit = 8): Promise<ReminderLogRow[]> {
  const { data, error } = await supabase
    .from('reminder_log')
    .select('id, kind, event_iso, channel, status, detail, created_at')

    .eq('user_id', userId)
    .eq('channel', 'email')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return (data ?? []) as ReminderLogRow[]
}

// ------------------------------------------------------------------
// Cycle sharing (opt-in, revocable, and never a data grant)
// ------------------------------------------------------------------

/** Has the signed-in girl turned sharing on for her current partner? */
export async function fetchCycleShared(): Promise<boolean> {
  const { data, error } = await supabase.rpc('cycle_is_shared')
  if (error) throw error
  return data === true
}

/** The single deliberate action that turns sharing on. */
export async function shareCycleWithPartner(): Promise<void> {
  const { error } = await supabase.rpc('share_cycle_with_partner')
  if (error) throw error
}

/** Turns it off again and stamps the revocation time. */
export async function stopSharingCycle(): Promise<void> {
  const { error } = await supabase.rpc('stop_sharing_cycle')
  if (error) throw error
}

/**
 * What the partner sees. Returns `{ shared: false }` when she has not shared —
 * there is no partial answer, and no raw period data is ever returned.
 */
export async function fetchPartnerCycleStatus(): Promise<PartnerCycleStatus> {
  const { data, error } = await supabase.rpc('partner_cycle_status')
  if (error) throw error
  return (data as PartnerCycleStatus | null) ?? { shared: false }
}

// ------------------------------------------------------------------
// In-app reminders (the bell)
// ------------------------------------------------------------------

/**
 * The caller's own reminders for the next few days.
 *
 * Backed by `my_upcoming_reminders()`, which wraps the day-exact
 * `reminder_queue()` — clients are not allowed to execute that one directly,
 * so a partner's cycle can only ever arrive through its consent check.
 */
export async function fetchUpcomingReminders(days = 3): Promise<ReminderQueueRow[]> {
  const { data, error } = await supabase.rpc('my_upcoming_reminders', { p_days: days })
  if (error) throw error
  return (data ?? []) as ReminderQueueRow[]
}

// ------------------------------------------------------------------
// The next reunion
// ------------------------------------------------------------------

/**
 * Pins (or moves) the next time they will be together.
 *
 * The server owns every rule here — date not in the past, one row per couple,
 * couple-scoped — so the UI only has to report what came back.
 */
export async function saveReunion(meetOn: string, note?: string | null): Promise<ReunionState> {
  const { data, error } = await supabase.rpc('set_reunion', {
    p_date: meetOn,
    p_note: note?.trim() ? note.trim() : null,
  })
  if (error) throw error
  return (data as { reunion: ReunionState }).reunion
}

export async function clearReunion(): Promise<void> {
  const { error } = await supabase.rpc('clear_reunion')
  if (error) throw error
}

// ------------------------------------------------------------------
// Warmth (دلم برات تنگ شده)
// ------------------------------------------------------------------

export type WarmthResult = { sent: true } | { sent: false; reason: 'ALREADY_SENT' }

/**
 * One tap to the partner's bell.
 *
 * A repeat of the same kind within two minutes is not an error — it is a
 * double-tap, and the server answers `ALREADY_SENT` so the button can settle
 * instead of flashing a failure at someone being affectionate.
 */
export async function sendWarmth(kind: WarmthKind): Promise<WarmthResult> {
  const { data, error } = await supabase.rpc('send_warmth', { p_kind: kind })
  if (error) throw error
  return data as WarmthResult
}

/**
 * Unseen warmth from the partner — and the read receipt itself.
 *
 * Calling this marks the signals seen, so the bell cannot show the same hug
 * twice. Only the last 24 hours; a signal from three days ago is not news.
 */
export async function fetchWarmth(): Promise<WarmthSignal[]> {
  const { data, error } = await supabase.rpc('my_warmth')
  if (error) throw error
  return (data ?? []) as WarmthSignal[]
}

/**
 * How many warmth signals are waiting — read-only.
 *
 * Separate from `fetchWarmth()` so that a badge refresh on page load cannot
 * consume a signal nobody has looked at yet.
 */
export async function fetchUnseenWarmth(): Promise<number> {
  const { data, error } = await supabase.rpc('unseen_warmth_count')
  if (error) throw error
  return Number(data ?? 0)
}
