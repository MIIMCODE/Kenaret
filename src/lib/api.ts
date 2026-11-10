import { supabase } from './supabase'
import type { ReminderQueueRow } from './reminders'
import type {
  AlbumPhoto,
  AlbumStats,
  ChatMessage,
  Gender,
  PairingState,
  PartnerCycleStatus,
  PeriodSettings,
  ReminderLogRow,
  ReminderPrefs,
  PushConfig,
  PushDevice,
  ReunionState,
  GameState,
  GameCardsPage,
  GameKind,
  GameSource,
  VaultItem,
  VaultState,
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

// ------------------------------------------------------------------
// Push notifications
// ------------------------------------------------------------------

/**
 * The VAPID public key the browser must subscribe with.
 *
 * Read from the edge function's secret at request time, so rotating the key
 * only means updating a secret — not shipping a new build.
 */
export async function fetchPushConfig(): Promise<PushConfig> {
  const { data, error } = await supabase.rpc('push_config')
  if (error) throw error
  const row = (data ?? {}) as { enabled?: boolean; public_key?: string | null }
  return { enabled: row.enabled === true, public_key: row.public_key ?? null }
}

export async function registerPushSubscription(input: {
  endpoint: string
  p256dh: string
  auth: string
  user_agent?: string | null
}): Promise<void> {
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.user_agent ?? null,
  })
  if (error) throw error
}

/** Pass the endpoint to forget one device, or null to forget them all. */
export async function deletePushSubscription(endpoint: string | null): Promise<void> {
  const { error } = await supabase.rpc('push_unsubscribe', { p_endpoint: endpoint })
  if (error) throw error
}

/**
 * Runs the push worker for the caller only.
 *
 * The edge function derives the user from the JWT — this passes no id — so the
 * "send a test" button can only ever reach the caller's own devices.
 */
export async function invokePushSend(): Promise<{ sent: number; failed: number }> {
  const { data, error } = await supabase.functions.invoke('push-send', { method: 'POST', body: {} })
  if (error) throw error
  const row = (data ?? {}) as { sent?: number; failed?: number }
  return { sent: Number(row.sent ?? 0), failed: Number(row.failed ?? 0) }
}

export async function fetchPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase.rpc('my_push_devices')
  if (error) throw error
  return (data ?? []) as PushDevice[]
}

/**
 * Seeds one throwaway notification for the caller, so the "test" button works
 * even when the cron job has already drained the queue.
 *
 * Returns 0 when the account has no live device — which the UI reports as
 * "this phone isn't registered yet" rather than a fake success.
 */
export async function seedTestPush(): Promise<number> {
  const { data, error } = await supabase.rpc('push_seed_test')
  if (error) throw error
  return Number(data ?? 0)
}

// ------------------------------------------------------------------
// گفت‌وگو (chat)
// ------------------------------------------------------------------

/**
 * The active couple's id and partner id.
 *
 * The chat media bucket is keyed on the couple id, so the client needs it to
 * build an upload path. `get_pairing_state()` deliberately does not carry it —
 * it is used by the dashboard, and widening it would leak the id into a payload
 * that has no use for it.
 */
export async function fetchCurrentCouple(): Promise<{ id: string; partner_id: string } | null> {
  const { data, error } = await supabase.rpc('current_couple')
  if (error) throw error
  if (!data) return null
  return data as { id: string; partner_id: string }
}

/**
 * One page of history, newest first.
 *
 * `before` is the cursor: pass the oldest `created_at` you already hold to walk
 * backwards. The server caps the page at 100 and returns `seen` only where it
 * means something (your own messages, once your partner read them).
 */
export async function fetchMessages(before: string | null = null, limit = 30): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('chat_messages', {
    p_before: before,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

/** Sends a text message. The push to the partner is queued inside the RPC. */
export async function sendMessage(
  body: string,
  replyTo: string | null = null,
): Promise<{ id: string; created_at: string }> {
  const { data, error } = await supabase.rpc('send_message', {
    p_body: body,
    p_reply_to: replyTo,
  })
  if (error) throw error
  return data as { id: string; created_at: string }
}

/** Sends an already-uploaded image. `path` must start with the couple id. */
export async function sendImage(
  path: string,
  width?: number | null,
  height?: number | null,
): Promise<{ id: string; created_at: string }> {
  const { data, error } = await supabase.rpc('send_image', {
    p_path: path,
    p_w: width ?? null,
    p_h: height ?? null,
  })
  if (error) throw error
  return data as { id: string; created_at: string }
}

/** How many of the partner's messages are unread. Read-only, safe to poll. */
export async function fetchUnreadMessages(): Promise<number> {
  const { data, error } = await supabase.rpc('unread_message_count')
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * Marks everything up to `until` as read for the signed-in user.
 *
 * Returns how many were newly marked, so the caller can tell whether the badge
 * actually needs to drop instead of re-rendering unconditionally.
 */
export async function markMessagesRead(until?: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('mark_messages_read', { p_until: until ?? null })
  if (error) throw error
  return Number(data ?? 0)
}

export async function editMessage(id: string, body: string): Promise<void> {
  const { error } = await supabase.rpc('edit_message', { p_id: id, p_body: body })
  if (error) throw error
}

export async function deleteMessage(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_message', { p_id: id })
  if (error) throw error
}


/** A voice note: an already-uploaded object plus its length in seconds. */
export async function sendVoice(
  path: string,
  seconds: number,
  replyTo: string | null = null,
): Promise<{ id: string; created_at: string }> {
  const { data, error } = await supabase.rpc('send_voice', {
    p_path: path,
    p_seconds: Math.max(1, Math.round(seconds)),
    p_reply_to: replyTo,
  })
  if (error) throw error
  return data as { id: string; created_at: string }
}

/**
 * Re-sends an existing message as a new one, marked `forwarded`.
 *
 * Deliberately couple-scoped server-side: there is no "forward to a contact"
 * because the only contact in this app is the other half of the couple, and a
 * general forward would be a way to move a private photo out of it.
 */
export async function forwardMessage(id: string): Promise<{ id: string; created_at: string }> {
  const { data, error } = await supabase.rpc('forward_message', { p_id: id })
  if (error) throw error
  return data as { id: string; created_at: string }
}

/** Pins or unpins; returns the state after the toggle. Either partner may do it. */
export async function togglePin(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_pin', { p_id: id })
  if (error) throw error
  return Boolean((data as { pinned?: boolean })?.pinned)
}

export async function fetchPinned(): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('pinned_messages')
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

/**
 * Full-text-ish search over the couple's messages.
 *
 * Returns nothing under two characters, on purpose: a single letter matches
 * almost everything and would look like a broken result list.
 */
export async function searchMessages(query: string, limit = 30): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('search_messages', {
    p_query: query,
    p_limit: limit,
  })
  if (error) throw error
  return (data ?? []) as ChatMessage[]
}

/**
 * Says "I am typing" for the partner to see.
 *
 * Fire-and-forget: a dropped typing signal must never surface to the user, and
 * the server treats anything older than ten seconds as absent anyway.
 */
export async function setTyping(): Promise<void> {
  await supabase.rpc('set_typing').then(
    () => undefined,
    () => undefined,
  )
}

export async function partnerIsTyping(): Promise<boolean> {
  const { data, error } = await supabase.rpc('partner_is_typing')
  if (error) return false
  return Boolean(data)
}


// ------------------------------------------------------------------
// آلبوم ما (album)
// ------------------------------------------------------------------

/**
 * Photos between two Gregorian days, inclusive.
 *
 * Gregorian bounds rather than a Jalali month: the client already owns Jalali
 * conversion, and doing that maths again in SQL would be two things to keep in
 * sync for nothing.
 */
export async function fetchAlbum(from: string, to: string): Promise<AlbumPhoto[]> {
  const { data, error } = await supabase.rpc('album_range', { p_from: from, p_to: to })
  if (error) throw error
  return (data ?? []) as AlbumPhoto[]
}

/** The database's idea of "today", in the couple's timezone. */
export async function fetchAlbumToday(): Promise<string> {
  const { data, error } = await supabase.rpc('album_today')
  if (error) throw error
  return String(data)
}

/**
 * Adds today's photo. Throws `ALREADY_TODAY` when today's slot is taken.
 *
 * The day is decided server-side (`album_today()`), never sent from here — the
 * day-lock is the whole feature and a client-supplied date would defeat it.
 */
export async function addAlbumPhoto(
  path: string,
  width?: number | null,
  height?: number | null,
): Promise<{ id: string; day: string }> {
  const { data, error } = await supabase.rpc('album_add', {
    p_path: path,
    p_width: width ?? null,
    p_height: height ?? null,
  })
  if (error) throw error
  return data as { id: string; day: string }
}

/** Swaps today's photo. Clears the heart, because it was for another image. */
export async function replaceAlbumPhoto(
  path: string,
  width?: number | null,
  height?: number | null,
): Promise<{ id: string; day: string }> {
  const { data, error } = await supabase.rpc('album_replace', {
    p_path: path,
    p_width: width ?? null,
    p_height: height ?? null,
  })
  if (error) throw error
  return data as { id: string; day: string }
}

export async function fetchAlbumStats(): Promise<AlbumStats> {
  const { data, error } = await supabase.rpc('album_stats')
  if (error) throw error
  const row = (data ?? {}) as Partial<AlbumStats>
  return {
    photos: Number(row.photos ?? 0),
    days: Number(row.days ?? 0),
    both: Number(row.both ?? 0),
    mine_today: row.mine_today === true,
    theirs_today: row.theirs_today === true,
  }
}

/** Photos that share today's day-of-month in an earlier month. */
export async function fetchOnThisDay(): Promise<AlbumPhoto[]> {
  const { data, error } = await supabase.rpc('album_on_this_day')
  if (error) throw error
  return (data ?? []) as AlbumPhoto[]
}

/** One heart, from the other person. Toggles, so a mis-tap is undoable. */
export async function reactToAlbumPhoto(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('album_react', { p_id: id })
  if (error) throw error
  return Boolean((data as { reacted?: boolean })?.reacted)
}

// ------------------------------------------------------------------
// فضای خصوصی — the server only ever stores ciphertext here.
// ------------------------------------------------------------------

export async function fetchVaultState(): Promise<VaultState> {
  const { data, error } = await supabase.rpc('vault_state')
  if (error) throw error
  const row = (data ?? {}) as Partial<VaultState>
  return {
    configured: row.configured === true,
    kdf_salt: row.kdf_salt ?? null,
    kdf_iters: row.kdf_iters ?? null,
    wrap_iv: row.wrap_iv ?? null,
    wrapped_key: row.wrapped_key ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
    items: Number(row.items ?? 0),
  }
}

export async function setupVault(material: {
  salt: string
  iv: string
  wrapped: string
  iters: number
}): Promise<void> {
  const { error } = await supabase.rpc('vault_setup', {
    p_salt: material.salt,
    p_iv: material.iv,
    p_wrapped: material.wrapped,
    p_iters: material.iters,
  })
  if (error) throw error
}

export async function fetchVaultItems(before?: string | null): Promise<VaultItem[]> {
  const { data, error } = await supabase.rpc('vault_list', {
    p_before: before ?? null,
    p_limit: 40,
  })
  if (error) throw error
  return (data ?? []) as VaultItem[]
}

export async function addVaultPhoto(photo: {
  path: string
  mediaIv: string
  body?: string | null
  bodyIv?: string | null
  width?: number | null
  height?: number | null
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('vault_add', {
    p_kind: 'photo',
    p_path: photo.path,
    p_media_iv: photo.mediaIv,
    p_body: photo.body ?? null,
    p_body_iv: photo.bodyIv ?? null,
    p_width: photo.width ?? null,
    p_height: photo.height ?? null,
  })
  if (error) throw error
  return data as { id: string }
}

export async function addVaultNote(note: {
  body: string
  bodyIv: string
}): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('vault_add', {
    p_kind: 'note',
    p_body: note.body,
    p_body_iv: note.bodyIv,
  })
  if (error) throw error
  return data as { id: string }
}

/** Deletes the row and returns the storage path so the caller can drop the file too. */
export async function deleteVaultItem(id: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('vault_delete', { p_id: id })
  if (error) throw error
  return ((data as { path?: string | null })?.path ?? null) as string | null
}

// ------------------------------------------------------------------
// رودررو — the game
//
// Every write is an RPC. The deck, the turn rules and the rate limits all
// live in the database (migration 0016); this file only carries the calls.
// `game_deal`, `game_answer`, `game_skip` and `game_set_level` all return the
// whole new state, so the page never has to re-fetch after acting.
// ------------------------------------------------------------------

/** Gives a new couple their starter deck. Idempotent. */
export async function seedGameDeck(): Promise<{ seeded: boolean; builtin: number }> {
  const { data, error } = await supabase.rpc('game_seed')
  if (error) throw error
  const row = (data ?? {}) as { seeded?: boolean; builtin?: number }
  return { seeded: Boolean(row.seeded), builtin: Number(row.builtin ?? 0) }
}

export async function fetchGameState(): Promise<GameState> {
  const { data, error } = await supabase.rpc('game_state')
  if (error) throw error
  const row = (data ?? {}) as Partial<GameState>
  return {
    settings: {
      max_level: (row.settings?.max_level ?? 2) as GameState['settings']['max_level'],
      avoid_repeats: row.settings?.avoid_repeats ?? true,
    },
    counts: {
      total: Number(row.counts?.total ?? 0),
      builtin: Number(row.counts?.builtin ?? 0),
      ours: Number(row.counts?.ours ?? 0),
      played: Number(row.counts?.played ?? 0),
    },
    // The RPC returns JSON `null` here when the table is free; normalise it so
    // callers can just test truthiness.
    open_turn: row.open_turn ?? null,
    recent: row.recent ?? [],
  }
}

/** Deals a card. `kind` narrows the draw; omit it for any kind. */
export async function dealGameCard(kind?: GameKind | null): Promise<GameState> {
  const { data, error } = await supabase.rpc('game_deal', { p_kind: kind ?? null })
  if (error) throw error
  return (data ?? {}) as GameState
}

export async function answerGameTurn(turnId: string, body: string): Promise<GameState> {
  const { data, error } = await supabase.rpc('game_answer', { p_turn: turnId, p_body: body })
  if (error) throw error
  return (data ?? {}) as GameState
}

export async function skipGameTurn(turnId: string): Promise<GameState> {
  const { data, error } = await supabase.rpc('game_skip', { p_turn: turnId })
  if (error) throw error
  return (data ?? {}) as GameState
}

export async function addGameCard(
  kind: GameKind,
  level: 1 | 2 | 3,
  body: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc('game_add_card', {
    p_kind: kind,
    p_level: level,
    p_body: body,
  })
  if (error) throw error
  return (data ?? {}) as { id: string }
}

export async function fetchGameCards(
  opts: {
    kind?: GameKind | null
    level?: 1 | 2 | 3 | null
    source?: GameSource | null
    limit?: number
    offset?: number
  } = {},
): Promise<GameCardsPage> {
  const { data, error } = await supabase.rpc('game_cards_page', {
    p_kind: opts.kind ?? null,
    p_level: opts.level ?? null,
    p_source: opts.source ?? null,
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  })
  if (error) throw error
  const row = (data ?? {}) as Partial<GameCardsPage>
  return { total: Number(row.total ?? 0), cards: row.cards ?? [] }
}

/** Removes one of *your* cards. Starter cards are locked in the database. */
export async function retireGameCard(cardId: string): Promise<{ retired: string }> {
  const { data, error } = await supabase.rpc('game_retire_card', { p_card: cardId })
  if (error) throw error
  return (data ?? {}) as { retired: string }
}

export async function setGameLevel(
  maxLevel: 1 | 2 | 3,
  avoidRepeats?: boolean,
): Promise<GameState> {
  const { data, error } = await supabase.rpc('game_set_level', {
    p_max_level: maxLevel,
    p_avoid_repeats: avoidRepeats ?? null,
  })
  if (error) throw error
  return (data ?? {}) as GameState
}
