import { Link, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
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

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 10.4 12 3.6l8 6.8V19a1.9 1.9 0 0 1-1.9 1.9h-3.4v-5.2a2.7 2.7 0 0 0-5.4 0v5.2H5.9A1.9 1.9 0 0 1 4 19z"
        stroke="currentColor"
        strokeWidth={stroke(active)}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={active ? 'currentColor' : 'none'}
        fillOpacity={active ? 0.14 : 0}
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

  /* ------------------------------------------------------------------
     The sliding indicator.

     Two separate operations, and confusing them is what made the previous
     attempt look like "no animation at all":

       · placeNow()  — JUMP. No animation. Runs on load, on every route
                       change that did not come from a tap, and on resize.
       · slideTo(el) — SLIDE. Runs on a tap, and measures **the element that
                       was tapped** rather than whoever currently carries
                       `aria-current`.

     That last point matters. React commits the new `aria-current` on its own
     schedule relative to the click handler, so reading "the active tab" from
     inside the handler can measure the tab you are leaving. Measuring the
     tapped element is deterministic and is also literally what was asked for.

     Geometry comes from offsetLeft/offsetWidth. Both are physical pixels from
     the left padding edge of the offsetParent (the bar, which is
     `position: relative`). Under RTL a tab's offsetLeft is already its real
     left edge, and translateX is physical too, so nothing needs flipping.
     ------------------------------------------------------------------ */
  const barRef = useRef<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLSpanElement | null>(null)
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>())
  /** The label the bubble is currently sitting on, to detect navigations that
   *  did not come from a tap (back button, notification). */
  const shownFor = useRef<string | null>(null)

  /** Physical offset of a tab inside the bar, in px from the bar's left edge. */
  const measure = useCallback((el: HTMLElement) => {
    const bar = barRef.current
    const relativeToBar = !bar || el.offsetParent === bar ? 0 : bar.offsetLeft
    return { x: el.offsetLeft - relativeToBar, w: el.offsetWidth }
  }, [])

  const activeTabEl = useCallback(
    () =>
      Array.from(tabRefs.current.values()).find(
        (el) => el.getAttribute('aria-current') === 'page',
      ) ?? null,
    [],
  )

  /** Jump — never animated. */
  const placeNow = useCallback(() => {
    const bubble = indicatorRef.current
    if (!bubble) return
    const el = activeTabEl()
    if (!el) {
      bubble.style.opacity = '0'
      return
    }
    const { x, w } = measure(el)

    /*
      Already exactly where it belongs? Then there is nothing to place.

      This guard is load-bearing. The layout effect below runs on every
      `pathname` change — including the one a tap just caused — and without it
      it would strip `is-sliding` from a slide that had only just started, so
      every tap would snap. Skipping when the geometry already matches leaves
      a slide in progress untouched, while a genuine resize (where the numbers
      DO differ) still repositions.
    */
    const same =
      Math.abs((parseFloat(bubble.style.width) || 0) - w) < 0.5 &&
      Math.abs((parseFloat(/translateX\(([-\d.]+)px\)/.exec(bubble.style.transform)?.[1] ?? 'NaN') || 0) - x) < 0.5

    if (same && bubble.style.opacity === '1') return

    bubble.classList.remove('is-sliding')
    bubble.style.transition = 'none'
    bubble.style.width = `${w}px`
    bubble.style.transform = `translateX(${x}px)`
    bubble.style.opacity = '1'
    shownFor.current = el.getAttribute('aria-label')

    // Commit the un-animated position before transitions come back; without
    // this a jump can inherit the previous slide's interpolation.
    void bubble.offsetWidth
    bubble.style.transition = ''
  }, [activeTabEl, measure])

  /** Slide — animated, to a tab that was just tapped. */
  const slideTo = useCallback(
    (el: HTMLElement) => {
      const bubble = indicatorRef.current
      if (!bubble) return
      const { x, w } = measure(el)

      bubble.style.transition = ''
      bubble.classList.add('is-sliding')
      bubble.style.width = `${w}px`
      bubble.style.transform = `translateX(${x}px)`
      bubble.style.opacity = '1'
      shownFor.current = el.getAttribute('aria-label')
    },
    [measure],
  )

  /** Before first paint: jump onto the active tab, no animation. */
  useLayoutEffect(() => {
    placeNow()
  }, [placeNow, pathname, hasPartner])

  /** A route change that did not come from a tap (back button, a notification)
   *  still has to land the bubble correctly — by jumping, not sliding. */
  useEffect(() => {
    const el = activeTabEl()
    if (!el) return
    if (shownFor.current !== el.getAttribute('aria-label')) placeNow()
  }, [pathname, activeTabEl, placeNow])

  /** Resize and late-arriving web fonts both move the tabs under the bubble. */
  useEffect(() => {
    const onResize = () => placeNow()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    if (document.fonts?.ready) void document.fonts.ready.then(onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [placeNow])

  const tabs: Tab[] = [
    {
      /**
       * خانه is first because in RTL it is the rightmost tab, and rightmost is
       * where a Persian reader looks first. The logo in the header still goes
       * home too — but once there is a tab for it, a second unlabelled door is
       * just something else to decode.
       */
      to: '/app',
      label: 'خانه',
      match: (p) => p === '/app' || p === '/app/',
      icon: (a) => <HomeIcon active={a} />,
    },
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
    <nav aria-label="بخش‌های کنارت" className="nav-root">
      <div ref={barRef} className="nav-bar">
        {/*
          The bubble is the FIRST child on purpose: in paint order it comes
          before the tabs, so it sits underneath the icons and labels without
          needing a negative z-index (which would put it behind the bar's own
          translucent background).
        */}
        <span ref={indicatorRef} aria-hidden="true" className="nav-indicator" />

        {visible.map((tab) => {
          const active = tab.match(pathname)
          const badge = tab.to === '/chat' ? unreadLabel : null
          return (
            <Link
              key={tab.to}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.to, el)
                else tabRefs.current.delete(tab.to)
              }}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className="nav-item"
              onClick={(event) => {
                const el = event.currentTarget
                /*
                  The animation is started here, by hand, rather than by an
                  effect reacting to the route.

                  An effect runs *after* React has already moved
                  `aria-current`, so by the time it measured, the browser had
                  the new layout and the old transform — and whether it
                  interpolated came down to frame timing. Doing it in the click
                  handler means: add the class, then move. One frame, always a
                  slide.
                */
                if (active) return
                // Measure and move in the same handler, using THIS element.
                slideTo(el)
              }}
            >
              <span className="nav-icon">
                {tab.icon(active)}
                {badge && <span className="nav-badge">{badge}</span>}
              </span>
              <span className="nav-label">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
