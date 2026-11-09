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
}
