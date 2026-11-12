import { supabase } from './supabase'

/**
 * The four calls that drive the prank.
 *
 * Kept apart from `celebrate.ts` on purpose. The celebration module carries the
 * whole feature — notes, music, error tables, presentation strings — and the
 * prank watcher runs on *every* page for *every* signed-in visitor, almost
 * always finding nothing. Bundling the celebration into that path costs ~5 kB
 * of root bundle to answer a question whose answer is "no" almost every time.
 */

export interface PrankStatus {
  /** One field decides: an expired prank is not pending. */
  pending: boolean
  expired?: boolean
  /** The sender's own device asking about its own prank. */
  mine?: boolean
  armed_at?: string
}

export interface PrankArmedState {
  armed: boolean
  armed_by_me?: boolean
  played?: boolean
  armed_at?: string
}

/**
 * Arms the prank for the *other* phone.
 *
 * The target is decided in SQL, never here: a client that names its own target
 * is a client that can prank itself, or somebody else's partner.
 */
export async function armPrank(): Promise<void> {
  const { error } = await supabase.rpc('arm_prank')
  if (error) throw error
}

/** "Is one waiting for me right now?" — a read, safe to poll. */
export async function fetchPrankPending(): Promise<PrankStatus> {
  const { data, error } = await supabase.rpc('prank_pending')
  if (error) return { pending: false }
  return (data ?? { pending: false }) as PrankStatus
}

/**
 * Marks it played. Called *after* the screen has been shown, so a crash
 * mid-prank does not swallow it.
 */
export async function consumePrank(): Promise<void> {
  const { error } = await supabase.rpc('consume_prank')
  if (error) throw error
}

/** For the sender's own button, so it can say «آماده است». */
export async function fetchPrankStatus(): Promise<PrankArmedState> {
  const { data, error } = await supabase.rpc('prank_status')
  if (error) return { armed: false }
  return (data ?? { armed: false }) as PrankArmedState
}
