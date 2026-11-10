export type Gender = 'girl' | 'boy'

export interface Profile {
  id: string
  gender: Gender | null
  display_name: string | null
  /** Gregorian ISO date. Rendered as Jalali in the UI. */
  birth_date: string | null
  interests: string[]
  /** `builtin:<file>` or `storage:<object-path>` */
  avatar_url: string | null
  pairing_code: string
  onboarding_step: number
  onboarding_completed: boolean
  created_at: string
  updated_at: string
}

export interface PeriodSettings {
  user_id: string
  last_period_start: string
  cycle_length: number
  period_length: number
  is_regular: boolean
  created_at: string
  updated_at: string
}

export type CoupleStatus = 'pending' | 'active'

export interface CoupleRequestSummary {
  couple_id: string
  user_id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
}

export interface AnniversaryState {
  needs_answer: boolean
  date: string | null
  asked_user_id: string | null
  /** True when the question is waiting on the signed-in user. */
  is_your_turn: boolean
  set_by: string | null
}

/** The next time the two of them will actually be in the same place. */
export interface ReunionState {
  /** `YYYY-MM-DD`, Gregorian — the UI converts to Jalali. */
  meet_on: string
  note: string | null
  created_by?: string | null
}

/** The three things one tap can mean. Deliberately not a message. */
export type WarmthKind = 'miss' | 'hug' | 'cheer'

export interface WarmthSignal {
  id: string
  kind: WarmthKind
  from_name: string
  created_at: string
}

export interface PairingState {
  pairing_code: string | null
  partner: {
    id: string
    display_name: string | null
    avatar_url: string | null
    interests: string[]
    birth_date: string | null
    gender: Gender | null
  } | null
  incoming: CoupleRequestSummary[]
  outgoing: CoupleRequestSummary[]
  /** Present once an active partner exists. */
  anniversary?: AnniversaryState | null
  /** Null until either partner pins a date; cleared by either of them too. */
  reunion?: ReunionState | null
}

export interface ReminderPrefs {
  enabled: boolean
  want_anniversary: boolean
  want_birthday: boolean
  want_period: boolean
}

export interface ReminderLogRow {
  id: number
  kind: string
  event_iso: string
  channel: 'email' | 'in_app'
  status: 'queued' | 'sent' | 'failed' | 'skipped'
  detail: string | null
  created_at: string
}

// ------------------------------------------------------------------
// Cycle sharing
// ------------------------------------------------------------------

export type CyclePhase = 'period' | 'pms' | 'calm'

/**
 * What a partner is allowed to know about her cycle.
 *
 * `shared: false` means she has not (or no longer) shared it — and then there
 * is genuinely nothing here: no dates, no lengths, not even a "she has data".
 */
export type PartnerCycleStatus =
  | { shared: false }
  | {
      shared: true
      phase: CyclePhase
      /** Days until the next window starts; 0 when it has already started. */
      days_until: number
      /** Days left in the current window; 0 outside it. */
      days_left: number
    }

// ------------------------------------------------------------------
// Push notifications
// ------------------------------------------------------------------

/** Why a device cannot receive push, when it cannot. */
export type PushUnsupportedReason =
  | 'no-window'
  | 'unsupported'
  | 'ios-not-installed'
  | 'insecure'

export interface PushCapability {
  supported: boolean
  reason?: PushUnsupportedReason
  permission?: NotificationPermission
  /** Null until the caller has actually looked. */
  subscribed?: boolean | null
  standalone?: boolean
  ios?: boolean
}

export interface PushConfig {
  /** False when the server has no VAPID keys configured. */
  enabled: boolean
  /** The applicationServerKey, base64url. */
  public_key: string | null
}

export interface PushDevice {
  id: string
  user_agent: string | null
  created_at: string
  last_ok_at: string | null
}
