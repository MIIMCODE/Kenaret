import { useEffect, useRef, useState } from 'react'

/**
 * Mirrors the *visual* viewport height into `--knr-vvh`.
 *
 * iOS Safari reports `100dvh` as the full screen even while the keyboard or
 * the browser chrome is covering part of it, which is how a bottom sheet ends
 * up half cut. visualViewport knows the truth; we publish it as a CSS var and
 * every sheet sizes itself from that.
 */
export function syncViewportHeight(): () => void {
  const vv = window.visualViewport
  const root = document.documentElement

  function apply() {
    const height = vv?.height ?? window.innerHeight
    root.style.setProperty('--knr-vvh', `${Math.round(height)}px`)
  }

  apply()
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('orientationchange', apply)
  window.addEventListener('resize', apply)

  return () => {
    vv?.removeEventListener('resize', apply)
    vv?.removeEventListener('scroll', apply)
    window.removeEventListener('orientationchange', apply)
    window.removeEventListener('resize', apply)
  }
}

/** Lazily created host element that sits directly under <body>. */
export function portalHost(id = 'knr-portal'): HTMLElement | null {
  if (typeof document === 'undefined') return null
  let host = document.getElementById(id)
  if (!host) {
    host = document.createElement('div')
    host.id = id
    // The host itself must never create a stacking context or catch taps.
    host.style.position = 'relative'
    host.style.zIndex = '1000'
    document.body.appendChild(host)
  }
  return host
}

/**
 * Locks page scrolling while a floating layer is open.
 *
 * iOS Safari is deliberately blunt here: `overflow: hidden` on <body> alone is
 * not enough, and because the page width changes when the scrollbar is hidden
 * on desktop we compensate with a matching right padding so nothing jumps.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    const body = document.body
    const html = document.documentElement
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
    }
    const scrollbar = window.innerWidth - html.clientWidth
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'contain'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`

    return () => {
      body.style.overflow = previous.bodyOverflow
      body.style.paddingRight = previous.bodyPaddingRight
      html.style.overflow = previous.htmlOverflow
      html.style.overscrollBehavior = previous.htmlOverscroll
    }
  }, [active])
}

/**
 * Tracks whether the visual viewport reports an open on-screen keyboard.
 * On iPhones the calendar used to be pushed under the keyboard when a native
 * month/year input grabbed focus, which is exactly the "half cut" the user saw.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const viewport = vv
    function update() {
      // A visible viewport noticeably shorter than the window means a keyboard.
      setOpen(window.innerHeight - viewport.height > 140)
    }
    update()
    viewport.addEventListener('resize', update)
    return () => viewport.removeEventListener('resize', update)
  }, [])

  return open
}

/** True once the component has mounted (safe place to touch `document`). */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}

/** Keeps a ref pointing at the freshly rendered node. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
