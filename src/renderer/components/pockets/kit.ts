import type { PocketLive, Shape } from '../Pocket'

/** drawing helpers shared by the pocket scenes */

export const TAU = Math.PI * 2
export const rnd = (a: number, b: number) => a + Math.random() * (b - a)
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
export const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

/** 1 at a batch of new usage, easing to 0 over `over` seconds */
export const kick = (l: PocketLive, over = 1.6) => (l.since < over ? (1 - l.since / over) ** 2 : 0)

/** true once for each new batch of usage */
export function pulses() {
  let prev = 1e9
  return (l: PocketLive) => {
    const fresh = l.since < prev
    prev = l.since
    return fresh
  }
}

/** where a scene puts its busy part on each surface: away from the numbers */
export function focus(shape: Shape, w: number, h: number): { x: number; y: number; s: number } {
  if (shape === 'orb') return { x: w * 0.5, y: h * 0.4, s: Math.min(w, h) }
  if (shape === 'capsule') return { x: w * 0.86, y: h * 0.5, s: h * 1.6 }
  // the island opens wide with numbers right across: its busy part keeps small, at the far end
  if (shape === 'island') return { x: w * 0.9, y: h * 0.5, s: Math.min(h * 1.3, w * 0.22) }
  return { x: w * 0.76, y: h * 0.48, s: Math.min(h * 1.15, w * 0.5) }
}

export function vgrad(ctx: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]): void {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  for (const [o, c] of stops) g.addColorStop(o, c)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** a soft round light */
export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number): void {
  if (r <= 0 || a <= 0) return
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${Math.min(1, a)})`)
  g.addColorStop(0.4, `rgba(${rgb},${Math.min(1, a) * 0.35})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
}

export function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0, r), 0, TAU)
  ctx.fill()
}

/** stars that twinkle, laid out in proportions */
export interface Star {
  u: number
  v: number
  r: number
  p: number
  f: number
}
export const starsOf = (n: number, top = 1): Star[] => Array.from({ length: n }, () => ({ u: Math.random(), v: Math.random() * top, r: rnd(0.4, 1.3), p: Math.random() * TAU, f: rnd(0.5, 2) }))
export function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], w: number, h: number, t: number, a: number, color = '#fff'): void {
  ctx.fillStyle = color
  for (const s of stars) {
    ctx.globalAlpha = a * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.f * 2 + s.p)))
    ctx.fillRect(s.u * w, s.v * h, s.r, s.r)
  }
  ctx.globalAlpha = 1
}

/** a ridge line across the width from a few heights, smoothed */
export function ridge(ctx: CanvasRenderingContext2D, w: number, h: number, pts: number[], base: number, fill: string | CanvasGradient, shift = 0): void {
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(0, h)
  const n = pts.length
  for (let i = 0; i <= 40; i++) {
    const u = i / 40
    const x = u * w
    const f = (((u + shift) % 1) + 1) % 1
    const k = f * (n - 1)
    const a = Math.floor(k)
    const b = Math.min(n - 1, a + 1)
    const m = k - a
    const v = pts[a] + (pts[b] - pts[a]) * (0.5 - Math.cos(m * Math.PI) / 2)
    ctx.lineTo(x, h * (base - v))
  }
  ctx.lineTo(w, h)
  ctx.closePath()
  ctx.fill()
}

/** a bird of two strokes, flapping */
export function bird(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, flap: number, color: string): void {
  const up = Math.sin(flap) * s * 0.55
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(0.8, s * 0.16)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - s, y - up)
  ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.25 - up * 0.3, x, y)
  ctx.quadraticCurveTo(x + s * 0.45, y - s * 0.25 - up * 0.3, x + s, y - up)
  ctx.stroke()
}

/** short-lived particles */
export interface Bit {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  r: number
  c: string
}
export function stepBits(bits: Bit[], dt: number, gravity = 0, drag = 0): Bit[] {
  return bits.filter((b) => {
    b.life -= dt
    b.vy += gravity * dt
    if (drag) {
      b.vx *= Math.exp(-drag * dt)
      b.vy *= Math.exp(-drag * dt)
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    return b.life > 0
  })
}
