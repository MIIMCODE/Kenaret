import { Link, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import Avatar from './Avatar'
import { fetchCurrentCouple, fetchUnreadMessages } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

/**
 * The tab bar.
 *
 * It replaced the header's row of buttons. A row of round icons in the corner
 * is a desktop pattern — on a phone it puts four of the most-used destinations
 * at the furthest reachable point on the screen, which is why the big apps put
 * them at the bottom, inside the thumb's arc. This is a floating pill, centred,
 * with the current tab lifted into it.
 *
 * Order matters and is not alphabetical: گفت‌وگوها first, because it is the one
 * you open without thinking; روزها and آلبوم next, because they are the two
 * places with something *yours* inside; پروفایل last.
 *
 * What is deliberately absent: a fifth "home" tab. The logo in the header is
 * already the way home, and two doors to the same page is one too many.
 *
 * The bar is fixed, so every page needs room underneath — `.page` already
 * carries `pb-28`, which is why nothing here changes the page layout.
 */

interface Tab {
  to: string
  label: string
  match: (pathname: string) => boolean
  icon: (active: boolean) => ReactElement
}

const stroke = (active: boolean) => (active ? 2.05 : 1.75)

function ChatIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"
        stroke="currentColor"
        strokeWidth={stroke(active)}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.16 : 0}
      />
    </svg>
  )
}

function DaysIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.4"
        y="5.2"
        width="17.2"
        height="15"
        rx="4"
        stroke="currentColor"
        strokeWidth={stroke(active)}
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.14 : 0}
      />
      <path d="M8 3.2v3.6M16 3.2v3.6M3.4 10.2h17.2" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
    </svg>
  )
}

function AlbumIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.2"
        y="5"
        width="17.6"
        height="14"
        rx="3.6"
        stroke="currentColor"
        strokeWidth={stroke(active)}
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.14 : 0}
      />
      <circle cx="8.6" cy="10" r="1.55" fill="currentColor" />
      <path
        d="M4.2 16.6l4.4-3.9a2 2 0 0 1 2.7 0L20 19.4"
        stroke="currentColor"
        strokeWidth={stroke(active)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function BottomNav() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const [hasPartner, setHasPartner] = useState<boolean | null>(null)
  const [unread, setUnread] = useState(0)
  const timer = useRef<number | null>(null)

  /**
   * One poll for both badges.
   *
   * `ChatBell` already owns the chat count and the tab title, so the number
   * here comes from the same RPC rather than a second implementation. The
   * warmth count rides along because the bell moved off the header with it.
   */
  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const couple = await fetchCurrentCouple()
        if (cancelled) return
        setHasPartner(couple !== null)
        if (couple) {
          const count = await fetchUnreadMessages()
          if (!cancelled) setUnread(count)
        }
      } catch {
        // A badge that fails to refresh is not worth an error.
      }
    }

    void refresh()
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    timer.current = window.setInterval(tick, 20000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      cancelled = true
      if (timer.current !== null) window.clearInterval(timer.current)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [pathname])

  const tabs: Tab[] = [
    {
      to: '/chat',
      label: 'گفت‌وگوها',
      match: (p) => p.startsWith('/chat'),
      icon: (a) => <ChatIcon active={a} />,
    },
    {
      to: '/dates',
      label: 'روزها',
      match: (p) => p.startsWith('/dates'),
      icon: (a) => <DaysIcon active={a} />,
    },
    {
      to: '/album',
      label: 'آلبوم',
      match: (p) => p.startsWith('/album'),
      icon: (a) => <AlbumIcon active={a} />,
    },
    {
      to: '/settings',
      label: 'پروفایل',
      match: (p) => p.startsWith('/settings'),
      icon: () => <Avatar src={profile?.avatar_url} name={profile?.display_name} size={24} />,
    },
  ]

  // No partner yet: the chat tab would only bounce back to the dashboard.
  const visible = hasPartner === false ? tabs.filter((t) => t.to !== '/chat') : tabs
  const unreadLabel = unread > 9 ? '۹+' : unread > 0 ? unread.toLocaleString('fa-IR') : null

  return (
    <nav
      aria-label="بخش‌های کنارت"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="pointer-events-auto flex items-stretch gap-0.5 rounded-full border border-white/70 bg-white/85 px-1.5 py-1.5 shadow-[0_12px_34px_-14px_rgba(58,48,56,0.45)] backdrop-blur-xl">
        {visible.map((tab) => {
          const active = tab.match(pathname)
          const badge = tab.to === '/chat' ? unreadLabel : null
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={`relative flex min-w-[68px] flex-col items-center gap-1 rounded-full px-3 py-2 transition ${
                active ? 'bg-blush-500/12 text-blush-600' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              <span className="relative">
                {tab.icon(active)}
                {badge && (
                  <span className="absolute -top-1.5 -left-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-blush-500 px-1 text-[9px] font-extrabold leading-none text-white">
                    {badge}
                  </span>
                )}
              </span>
              <span className={`text-[10.5px] leading-none ${active ? 'font-extrabold' : 'font-medium'}`}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
