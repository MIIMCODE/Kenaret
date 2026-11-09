import { supabase } from './supabase'
import type { Gender, PairingState, PeriodSettings } from '../types/database'

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
