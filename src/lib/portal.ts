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
 * `overflow: hidden` alone is not trustworthy on iOS — momentum scrolling can
 * still drag the page behind the sheet, which reads as "the calendar moved by
 * itself". On touch devices we therefore pin <body> with `position: fixed`
 * (the technique every scroll-lock library ends up using), remembering the
 * offset and restoring it when the sheet closes. Desktops keep the simpler
 * overflow lock, plus padding compensation so the layout does not shift when
 * the scrollbar disappears.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return

    const body = document.body
    const html = document.documentElement
    const scrollY = window.scrollY || 0
    const previous = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
    }

    const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false

    if (isTouch) {
      // Pin the body; fixed descendants still resolve against the viewport.
      body.style.position = 'fixed'
      body.style.top = `-${scrollY}px`
      body.style.width = '100%'
    } else {
      const scrollbar = window.innerWidth - html.clientWidth
      if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
    }

    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    html.style.overscrollBehavior = 'contain'

    return () => {
      body.style.overflow = previous.bodyOverflow
      body.style.position = previous.bodyPosition
      body.style.top = previous.bodyTop
      body.style.width = previous.bodyWidth
      body.style.paddingRight = previous.bodyPaddingRight
      html.style.overflow = previous.htmlOverflow
      html.style.overscrollBehavior = previous.htmlOverscroll
      // Un-pinning the body drops the page back to the top; put it back where
      // the visitor left it so closing the calendar is invisible.
      if (isTouch && scrollY > 0) window.scrollTo(0, scrollY)
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

/**
 * Creates (once) and returns the portal host after mount.
 *
 * Doing this in an effect rather than during render keeps rendering pure:
 * React StrictMode renders twice, and creating DOM nodes as a side effect of
 * rendering is exactly the kind of thing that breaks under it.
 */
export function usePortalHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHost(portalHost())
  }, [])
  return host
}

/** Keeps a ref pointing at the freshly rendered node. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  ref.current = value
  return ref
}
