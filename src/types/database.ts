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

// ------------------------------------------------------------------
// گفت‌وگو (chat)
// ------------------------------------------------------------------

/** A message as the client sees it, newest-first pages from `chat_messages`. */
export interface ChatMessage {
  id: string
  sender_id: string
  /** Empty for an image/voice, and for anything that was deleted. */
  body: string
  kind: 'text' | 'image' | 'voice'
  media_path: string | null
  media_w: number | null
  media_h: number | null
  /** `HH:MM:SS` from Postgres; only set for voice notes. */
  duration: string | null
  reply_to: string | null
  /** The quoted line, resolved server-side so no second request is needed. */
  reply_body: string | null
  reply_kind: string | null
  forward: boolean
  pinned: boolean
  /** Non-null once the sender changed the text. The UI marks it. */
  edited_at: string | null
  /** Soft delete: the other person keeps the shape of the thread. */
  deleted_at: string | null
  created_at: string
  /** True only on your own messages, once your partner has read them. */
  seen: boolean
}

// ------------------------------------------------------------------
// آلبوم ما (album)
// ------------------------------------------------------------------

/** One photo, as `album_range` / `album_on_this_day` return it. */
export interface AlbumPhoto {
  id: string
  /** Gregorian ISO of the couple-local day it belongs to. */
  day: string
  user_id: string
  /** Object path in the private `album` bucket. */
  storage_path: string
  width: number | null
  height: number | null
  /** Set when the *other* person put a heart on it. */
  reacted_at: string | null
  created_at: string
  /** Only from `album_on_this_day()`. */
  years_ago?: number
  months_ago?: number
}

export interface AlbumStats {
  photos: number
  /** Days with at least one photo. Only ever grows — not a streak. */
  days: number
  /** Days where both of you added one. */
  both: number
  mine_today: boolean
  theirs_today: boolean
}

// ------------------------------------------------------------------
// فضای خصوصی (vault)
// ------------------------------------------------------------------

/** The wrapping material. Useless without the PIN — see `src/lib/vault.ts`. */
export interface VaultState {
  configured: boolean
  kdf_salt: string | null
  kdf_iters: number | null
  wrap_iv: string | null
  wrapped_key: string | null
  created_by: string | null
  created_at: string | null
  /** How many things are inside. A count is all the server can know. */
  items: number
}

/** One row of `vault_list()`. Everything readable is still encrypted here. */
export interface VaultItem {
  id: string
  user_id: string
  kind: 'photo' | 'note'
  storage_path: string | null
  media_iv: string | null
  body_cipher: string | null
  body_iv: string | null
  width: number | null
  height: number | null
  created_at: string
}
