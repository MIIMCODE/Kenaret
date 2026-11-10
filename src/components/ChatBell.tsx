import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { fetchUnreadMessages } from '../lib/api'
import { useAuth } from '../hooks/useAuth'

/**
 * The chat button in the header, with an unread count.
 *
 * The count is polled rather than pushed: push already covers "the app is
 * closed", and a second realtime channel just to make a number tick is a lot
 * of machinery for something the next page load would fix anyway. The poll
 * stops while the tab is hidden — a sleeping phone should not wake up every
 * 15 seconds to ask whether anybody loves it.
 *
 * The badge is read-only. Opening the chat is what marks messages read, not
 * this component — otherwise merely glancing at the header would consume the
 * notification.
 */

const POLL_MS = 15000

const BASE_TITLE = 'کنارت | همیشه کنارت'

export default function ChatBell() {
  const { user } = useAuth()
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const timer = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      setUnread(await fetchUnreadMessages())
    } catch {
      // A badge that fails to refresh is not worth an error banner.
    }
  }, [user])

  // The tab title is the one place a web app can signal "something arrived"
  // without a permission prompt, so the count goes there too.
  useEffect(() => {
    document.title = unread > 0 ? `(${unread.toLocaleString('fa-IR')}) ${BASE_TITLE}` : BASE_TITLE
    return () => {
      document.title = BASE_TITLE
    }
  }, [unread])

  useEffect(() => {
    if (!user) {
      setUnread(0)
      return
    }

    void refresh()

    // Re-count on navigation: coming back from the chat must clear it at once.
    const start = () => {
      if (timer.current !== null) return
      timer.current = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh()
      }, POLL_MS)
    }
    const stop = () => {
      if (timer.current === null) return
      window.clearInterval(timer.current)
      timer.current = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, user, location.pathname])

  return (
    <Link
      to="/chat"
      aria-label={unread > 0 ? `گفت‌وگو، ${unread} پیام خوانده‌نشده` : 'گفت‌وگو'}
      className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-ink-500 shadow-card transition hover:text-blush-600"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {unread > 0 && (
        <span className="absolute -top-0.5 -left-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blush-500 px-1 text-[9.5px] font-extrabold leading-none text-white">
          {unread > 9 ? '۹+' : unread.toLocaleString('fa-IR')}
        </span>
      )}
    </Link>
  )
}
