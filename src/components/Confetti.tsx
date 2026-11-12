import { useEffect, useRef } from 'react'

/**
 * کاغذرنگی — confetti and fireworks on a single canvas.
 *
 * Hand-written rather than a library: the site has no dependencies it does not
 * need, and this is ~180 lines of physics that would otherwise be 30 kB of
 * someone else's API surface.
 *
 * Three rules keep a celebration from becoming an assault:
 *   · a hard particle cap, so a phone never drops frames
 *   · `prefers-reduced-motion` gets the confetti *pre-settled* — the colours
 *     and the moment survive, the movement does not
 *   · the canvas stops drawing entirely once every particle has landed, so an
 *     idle celebration page is not a permanent 60 fps loop
 */

interface ConfettiPiece {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  rot: number
  spin: number
  color: string
  /** 0–1: how long it has lived, for the fade. */
  life: number
  shape: 'rect' | 'circle'
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  color: string
  life: number
  decay: number
}

/** Blush → lilac → mint → gold. Warm first: the page is a love letter, not a rave. */
const COLORS = ['#f9628b', '#ffaec3', '#d6c6f2', '#a98ce0', '#4cb894', '#ffd166', '#ff84a5']

const MAX_PARTICLES = 320
const GRAVITY = 0.055
const DRAG = 0.994

export interface ConfettiProps {
  /** Re-fires the burst whenever it changes. */
  burstKey?: number | string
  /** Fires a firework from a random point instead of a falling curtain. */
  fireworks?: number
  className?: string
}

export default function Confetti({ burstKey = 0, fireworks = 0, className }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const piecesRef = useRef<ConfettiPiece[]>([])
  const sparksRef = useRef<Spark[]>([])
  const frameRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const reducedRef = useRef(false)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })

  /* ── sizing ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedRef.current = media.matches
    const onMotionChange = () => {
      reducedRef.current = media.matches
    }
    media.addEventListener('change', onMotionChange)

    function resize() {
      const element = canvasRef.current
      if (!element) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = element.clientWidth
      const h = element.clientHeight
      element.width = Math.round(w * dpr)
      element.height = Math.round(h * dpr)
      sizeRef.current = { w, h, dpr }
      const ctx = element.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      media.removeEventListener('change', onMotionChange)
    }
  }, [])

  /* ── the burst ──────────────────────────────────────────────────────── */

  useEffect(() => {
    const { w, h } = sizeRef.current
    if (!w || !h) return

    // Reduced motion: drop a still, scattered handful in once and never animate.
    if (reducedRef.current) {
      if (piecesRef.current.length === 0) {
        piecesRef.current = Array.from({ length: 70 }, () => stillPiece(w, h))
        draw()
      }
      return
    }

    piecesRef.current = Array.from({ length: 150 }, () => fallingPiece(w, h))

    // Two bursts of sparks, off-centre, so the two people each get one.
    if (fireworks > 0) {
      burstAt(w * 0.28, h * 0.3)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        burstAt(w * 0.72, h * 0.26)
      }, 260)
    }

    start()
    // `burstKey` is the trigger, not a value the effect reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstKey])

  function fallingPiece(w: number, h: number): ConfettiPiece {
    return {
      x: Math.random() * w,
      // Start above the fold and stagger the entry, so it reads as snowfall
      // rather than a wall of paper.
      y: -20 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 1.6,
      vy: 1.6 + Math.random() * 2.6,
      w: 5 + Math.random() * 7,
      h: 8 + Math.random() * 10,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.16,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      life: 0,
      shape: Math.random() > 0.75 ? 'circle' : 'rect',
    }
  }

  function stillPiece(w: number, h: number): ConfettiPiece {
    const piece = fallingPiece(w, h)
    piece.y = Math.random() * h
    return piece
  }

  function burstAt(x: number, y: number) {
    const count = 42
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3
      const speed = 2.2 + Math.random() * 4.4
      sparksRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 1.4 + Math.random() * 2.2,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
        decay: 0.008 + Math.random() * 0.012,
      })
    }
    if (sparksRef.current.length > MAX_PARTICLES) {
      sparksRef.current = sparksRef.current.slice(-MAX_PARTICLES)
    }
  }

  /* ── the loop ───────────────────────────────────────────────────────── */

  function start() {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = window.requestAnimationFrame(tick)
  }

  function tick() {
    const { h } = sizeRef.current
    let alive = 0

    for (const piece of piecesRef.current) {
      piece.vy += GRAVITY
      piece.vx *= DRAG
      piece.vy *= DRAG
      // A paper flutter: horizontal sway driven by its own rotation, which is
      // what makes confetti look like paper instead of pebbles.
      piece.x += piece.vx + Math.sin(piece.rot) * 0.9
      piece.y += piece.vy
      piece.rot += piece.spin
      piece.life += 1

      if (piece.y < h + 40 && piece.life < 900) alive += 1
    }

    for (const spark of sparksRef.current) {
      spark.vx *= 0.965
      spark.vy = spark.vy * 0.965 + GRAVITY * 0.7
      spark.x += spark.vx
      spark.y += spark.vy
      spark.life -= spark.decay
      if (spark.life > 0) alive += 1
    }

    sparksRef.current = sparksRef.current.filter((s) => s.life > 0)

    draw()

    if (alive > 0) {
      frameRef.current = window.requestAnimationFrame(tick)
    } else {
      piecesRef.current = []
      sparksRef.current = []
      frameRef.current = null
    }
  }

  function draw() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const { w, h } = sizeRef.current
    ctx.clearRect(0, 0, w, h)

    for (const piece of piecesRef.current) {
      if (piece.y > h + 40) continue
      // Fade out over the last stretch of its life so nothing pops.
      const alpha = piece.life > 700 ? Math.max(0, 1 - (piece.life - 700) / 200) : 1
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(piece.x, piece.y)
      ctx.rotate(piece.rot)
      ctx.fillStyle = piece.color
      if (piece.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, piece.w / 2, 0, Math.PI * 2)
        ctx.fill()
      } else {
        // Squash horizontally with the rotation: the piece turning edge-on.
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h)
      }
      ctx.restore()
    }

    for (const spark of sparksRef.current) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, spark.life)
      ctx.fillStyle = spark.color
      // A glow, because a firework is light, not grit.
      ctx.shadowBlur = 10
      ctx.shadowColor = spark.color
      ctx.beginPath()
      ctx.arc(spark.x, spark.y, spark.r, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ''}`}
    />
  )
}
