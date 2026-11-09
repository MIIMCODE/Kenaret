import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { fetchProfile, type ProfileRow } from '../lib/api'

type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  user: User | null
  profile: ProfileRow | null
  profileLoading: boolean
  /** Re-fetches the profile (after onboarding steps, avatar changes, etc.). */
  refreshProfile: () => Promise<ProfileRow | null>
  setProfile: (profile: ProfileRow | null) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfileState] = useState<ProfileRow | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const currentUserId = useRef<string | null>(null)

  const loadProfile = useCallback(async (userId: string | null) => {
    if (!userId) {
      setProfileState(null)
      return null
    }
    setProfileLoading(true)
    try {
      const row = await fetchProfile(userId)
      setProfileState(row)
      return row
    } catch (error) {
      console.error('[Kenaret] could not load profile', error)
      setProfileState(null)
      return null
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      const nextSession = data.session ?? null
      setSession(nextSession)
      setStatus(nextSession ? 'signed-in' : 'signed-out')
      currentUserId.current = nextSession?.user.id ?? null
      if (nextSession) void loadProfile(nextSession.user.id)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setStatus(nextSession ? 'signed-in' : 'signed-out')

      const nextUserId = nextSession?.user.id ?? null
      if (nextUserId !== currentUserId.current) {
        currentUserId.current = nextUserId
        void loadProfile(nextUserId)
      }
    })

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    // `currentUserId` is filled in by the auth listener, which can lag a few
    // milliseconds behind the PKCE callback. Falling back to the stored
    // session avoids a silent no-op in that window.
    let userId = currentUserId.current
    if (!userId) {
      const { data } = await supabase.auth.getSession()
      userId = data.session?.user.id ?? null
      currentUserId.current = userId
    }
    if (!userId) return null
    return loadProfile(userId)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfileState(null)
    currentUserId.current = null
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      profileLoading,
      refreshProfile,
      setProfile: setProfileState,
      signOut,
    }),
    [status, session, profile, profileLoading, refreshProfile, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}
