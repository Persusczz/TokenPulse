import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import { cssVar, useMotionLevel } from '../state'

interface Drop {
  x: number
  y: number
  vy: number
  r: number
}
interface Splash {
  x: number
  y: number
  vx: number
  vy: number
  life: number
}
interface Bubble {
  x: number
  y: number
  r: number
  v: number
}
/** a ring spreading on the surface where a drop landed */
interface Ring {
  x: number
  born: number
}
/** a wave travelling outward along the surface from an impact */
interface Impulse {
  x: number
  born: number
}
/** liquid spilling over the rim and running down the outside of the tank */
interface Spill {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  side: -1 | 1
  onWall: boolean
}

/** liquid colour by fill level: sage -> amber -> clay -> red */
const STOPS: [number, [number, number, number]][] = [
  [0, [106, 154, 85]],
  [0.5, [201, 154, 46]],
  [0.8, [217, 119, 87]],
  [1, [208, 59, 59]]
]

function levelColor(l: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, l))
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i]
    const [p0, c0] = STOPS[i - 1]
    if (x <= p1) {
      const t = (x - p0) / (p1 - p0)
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

const BUBBLE_RATE = [0.4, 1.6, 4, 9]
/** seconds a drop takes to swell at the pipette tip, and the pause before the next */
const FORM_S = 0.26
const GAP_S = 0.12
const RING_LIFE = 1.25
const MAX_QUEUE = 10

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

interface Geo {
  left: number
  right: number
  top: number
  bottom: number
  /** orb centre and radius */
  cx: number
  cy: number
  R: number
  /** traces the vessel outline as the current path */
  trace: (ctx: CanvasRenderingContext2D) => void
  /** pipette tip */
  tipX: number
  tipY: number
  /** pipette drawing scale */
  k: number
}

function geometry(shape: 'tank' | 'orb', w: number, h: number): Geo {
  if (shape === 'orb') {
    const R = Math.min(w, h) / 2 - 3
    const cx = w / 2
    const cy = h / 2
    return {
      left: cx - R,
      right: cx + R,
      top: cy - R,
      bottom: cy + R,
      cx,
      cy,
      R,
      trace: (ctx) => {
        ctx.beginPath()
        ctx.arc(cx, cy, R, 0, Math.PI * 2)
      },
      tipX: cx,
      tipY: cy - R + R * 0.34,
      k: Math.max(0.55, R / 70)
    }
  }
  const vx = 14
  const vy = 6
  const vw = w - 2 * vx
  const vh = h - vy - 2
  const radius = Math.min(26, vw / 5)
  return {
    left: vx,
    right: vx + vw,
    top: vy,
    bottom: vy + vh,
    cx: vx + vw / 2,
    cy: vy + vh / 2,
    R: radius,
    trace: (ctx) => roundRect(ctx, vx, vy, vw, vh, radius),
    // right of the centred amount text, left of the capacity ticks
    tipX: vx + vw * 0.9 - 6,
    tipY: vy + 40,
    k: 1
  }
}

/**
 * Liquid gauge. `level` is the fill (may exceed 1). Each change of `pour.id`
 * queues `pour.count` drops from an eye-dropper; every drop rings the surface
 * where it lands. `shape` picks a rounded tank or a round orb.
 */
export function EnergyTank({
  level,
  intensity,
  pour,
  theme,
  shape = 'tank',
  pixelScale = 1,
  glass = false
}: {
  level: number
  intensity: Intensity
  pour: { id: number; count: number }
  theme: string
  shape?: 'tank' | 'orb'
  /** extra canvas resolution when the page is CSS-zoomed */
  pixelScale?: number
  /** see-through vessel, for a backdrop behind it */
  glass?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const motion = useMotionLevel()
  const reduced = motion === 0
  const st = useRef({
    lv: 0,
    target: level,
    intensity,
    phase: 0,
    t: 0,
    ripple: 0,
    queue: 0,
    nextDrip: 0,
    forming: null as { r: number; max: number; age: number } | null,
    lastRelease: -9,
    dropper: 0,
    squeeze: 0,
    drops: [] as Drop[],
    splashes: [] as Splash[],
    bubbles: [] as Bubble[],
    rings: [] as Ring[],
    impulses: [] as Impulse[],
    spills: [] as Spill[],
    spillAcc: 0,
    /** pooled overflow at the left and right foot of the tank */
    pool: [0, 0],
    glass,
    bubbleAcc: 0,
    w: 0,
    h: 0,
    colors: { border: '#d6d3c6', surface: '#f5f4ef', accent: '#c6613f', text: '#8a8880' },
    draw: (_dt: number) => {}
  })
  st.current.target = level
  st.current.intensity = intensity
  st.current.glass = glass

  useEffect(() => {
    st.current.colors = {
      border: cssVar('--border-strong'),
      surface: cssVar('--surface-2'),
      accent: cssVar('--accent-strong'),
      text: cssVar('--text-3')
    }
    if (reduced) st.current.draw(0)
  }, [theme, reduced])

  useEffect(() => {
    if (!pour.id || reduced) return
    const s = st.current
    const n = motion === 1 ? 1 : pour.count + (motion === 3 ? 1 : 0)
    s.queue = Math.min(MAX_QUEUE, s.queue + n)
  }, [pour.id, pour.count, reduced]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ctx = canvas.getContext('2d')!
    const s = st.current

    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * pixelScale
      s.w = wrap.clientWidth
      s.h = wrap.clientHeight
      canvas.width = Math.round(s.w * dpr)
      canvas.height = Math.round(s.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (reduced) s.draw(0)
    }

    const drawDropper = (g: Geo, liquid: [number, number, number]) => {
      const a = s.dropper
      if (a < 0.02) return
      const { tipX: x, tipY: y, k } = g
      const top = y - 20 * k
      const bw = 11 * k
      const bh = (9 - s.squeeze * 3) * k
      ctx.save()
      ctx.globalAlpha = a
      // rubber bulb, squeezed as a drop is released
      ctx.fillStyle = s.colors.accent
      roundRect(ctx, x - bw / 2, top - bh, bw, bh + 2 * k, 5 * k)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.fillRect(x - 5.5 * k, top - 0.5 * k, 11 * k, 2.5 * k)
      // glass tube tapering to the tip
      ctx.beginPath()
      ctx.moveTo(x - 3.6 * k, top + 2 * k)
      ctx.lineTo(x - 3.6 * k, y - 8 * k)
      ctx.lineTo(x - 1.1 * k, y)
      ctx.lineTo(x + 1.1 * k, y)
      ctx.lineTo(x + 3.6 * k, y - 8 * k)
      ctx.lineTo(x + 3.6 * k, top + 2 * k)
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,255,255,0.42)'
      ctx.fill()
      ctx.save()
      ctx.clip()
      ctx.fillStyle = `rgb(${liquid.join(',')})`
      ctx.fillRect(x - 4 * k, y - 15 * k, 8 * k, 16 * k)
      ctx.restore()
      ctx.strokeStyle = s.colors.text
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.restore()
    }

    s.draw = (dt: number) => {
      const { w, h, colors } = s
      if (!w || !h) return
      s.t += dt
      s.lv = reduced ? s.target : s.lv + (s.target - s.lv) * Math.min(1, dt * 2.2)
      s.phase += dt * (1.2 + s.intensity * 0.9)
      s.ripple *= Math.exp(-dt * 2.4)
      s.squeeze = Math.max(0, s.squeeze - dt * 4)

      const g = geometry(shape, w, h)
      const span = g.right - g.left
      const fill = Math.min(s.lv, 1)
      const surfaceY = g.bottom - (g.bottom - g.top) * fill
      // the pipette hangs a little above the liquid (within the top of the tank)
      if (shape === 'tank') g.tipY = Math.min(Math.max(surfaceY - 14, g.top + 24), g.tipY)
      // brimming over: the surface sloshes harder
      const amp = (fill > 0.002 ? 2.5 + s.intensity * 1.6 : 0) + s.ripple * 5 + Math.min(4, Math.max(0, s.lv - 1) * 10)
      const lambda = Math.max(90, span / 1.6)
      const liquid = levelColor(s.lv)
      const bump = (x: number) => {
        let d = 0
        for (const im of s.impulses) {
          const age = s.t - im.born
          const dx = Math.abs(x - im.x)
          if (age < 0 || age > 2.4 || dx > age * 150 + 6) continue
          d += 3.6 * Math.exp(-age * 2) * Math.cos(dx * 0.17 - age * 14) * Math.exp(-dx * 0.02)
        }
        return d
      }
      const waveY = (x: number, off: number, a: number) =>
        surfaceY + a * Math.sin(((x - g.left) / lambda) * Math.PI * 2 + s.phase + off) + (fill > 0.002 ? bump(x) * (off ? 0.6 : 1) : 0)
      const landY = (x: number) => (fill > 0.002 ? waveY(x, 0, amp) : g.bottom - 2)

      ctx.clearRect(0, 0, w, h)

      // vessel
      g.trace(ctx)
      ctx.fillStyle = colors.surface
      ctx.globalAlpha = s.glass ? 0.3 : 1
      ctx.fill()
      ctx.globalAlpha = 1

      ctx.save()
      g.trace(ctx)
      ctx.clip()

      if (fill > 0.002) {
        const [r, gr, b] = liquid
        // back wave
        ctx.beginPath()
        ctx.moveTo(g.left, h)
        for (let x = g.left; x <= g.right; x += 4) ctx.lineTo(x, waveY(x, 2.1, amp * 0.8) - 3)
        ctx.lineTo(g.right, h)
        ctx.closePath()
        ctx.fillStyle = `rgba(${r},${gr},${b},0.35)`
        ctx.fill()
        // front wave
        ctx.beginPath()
        ctx.moveTo(g.left, h)
        for (let x = g.left; x <= g.right; x += 4) ctx.lineTo(x, waveY(x, 0, amp))
        ctx.lineTo(g.right, h)
        ctx.closePath()
        const grad = ctx.createLinearGradient(0, surfaceY, 0, g.bottom)
        grad.addColorStop(0, `rgba(${r},${gr},${b},0.92)`)
        grad.addColorStop(1, `rgba(${Math.round(r * 0.72)},${Math.round(gr * 0.72)},${Math.round(b * 0.72)},0.95)`)
        ctx.fillStyle = grad
        ctx.fill()
        // surface highlight
        ctx.beginPath()
        for (let x = g.left; x <= g.right; x += 4) {
          const y = waveY(x, 0, amp)
          if (x === g.left) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'
        ctx.lineWidth = 1.5
        ctx.stroke()

        // light refracted through the liquid: a bright band under the surface and slow caustics
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(g.left, h)
        for (let x = g.left; x <= g.right; x += 4) ctx.lineTo(x, waveY(x, 0, amp))
        ctx.lineTo(g.right, h)
        ctx.closePath()
        ctx.clip()
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'
        ctx.lineWidth = 4
        ctx.beginPath()
        for (let x = g.left; x <= g.right; x += 4) {
          const y = waveY(x, 0, amp) + 6
          if (x === g.left) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.translate(0, surfaceY - 10)
        ctx.transform(1, 0, -0.35, 1, 0, 0)
        const bandW = span * 0.14
        for (let i = 0; i < 3; i++) {
          const x0 = g.left - span * 0.2 + ((s.t * 14 + i * span * 0.5) % (span * 1.7))
          const band = ctx.createLinearGradient(x0, 0, x0 + bandW, 0)
          band.addColorStop(0, 'rgba(255,255,255,0)')
          band.addColorStop(0.5, 'rgba(255,255,255,0.1)')
          band.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = band
          ctx.fillRect(x0, 0, bandW, g.bottom - surfaceY + 10)
        }
        ctx.restore()

        // bubbles
        if (!reduced) {
          s.bubbleAcc += dt * BUBBLE_RATE[s.intensity] * (span / 200)
          while (s.bubbleAcc > 1) {
            s.bubbleAcc -= 1
            s.bubbles.push({
              x: g.left + 8 + Math.random() * (span - 16),
              y: g.bottom - 4,
              r: 1.2 + Math.random() * 2.4,
              v: 14 + Math.random() * 26 + s.intensity * 8
            })
          }
          ctx.fillStyle = 'rgba(255,255,255,0.4)'
          s.bubbles = s.bubbles.filter((bb) => {
            bb.y -= bb.v * dt
            bb.x += Math.sin(bb.y / 9) * 0.25
            if (bb.y < waveY(bb.x, 0, amp) + bb.r) return false
            ctx.beginPath()
            ctx.arc(bb.x, bb.y, bb.r, 0, Math.PI * 2)
            ctx.fill()
            return true
          })
        }
      }

      // rings where drops landed, flattened as if seen from slightly above
      if (s.rings.length) {
        ctx.lineWidth = 1.3
        s.rings = s.rings.filter((rg) => {
          const age = s.t - rg.born
          if (age > RING_LIFE) return false
          if (age < 0) return true
          const p = age / RING_LIFE
          const rad = 3 + p * span * (shape === 'orb' ? 0.32 : 0.26)
          ctx.strokeStyle = `rgba(255,255,255,${(0.65 * (1 - p) ** 1.6).toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(rg.x, landY(rg.x), rad, rad * 0.28, 0, 0, Math.PI * 2)
          ctx.stroke()
          return true
        })
      }

      // round-vessel shading: a cylinder lit from the left, or a sphere darker at the rim
      if (shape === 'tank') {
        const sh = ctx.createLinearGradient(g.left, 0, g.right, 0)
        sh.addColorStop(0, 'rgba(0,0,0,0.16)')
        sh.addColorStop(0.16, 'rgba(0,0,0,0)')
        sh.addColorStop(0.32, 'rgba(255,255,255,0.1)')
        sh.addColorStop(0.5, 'rgba(255,255,255,0)')
        sh.addColorStop(0.84, 'rgba(0,0,0,0)')
        sh.addColorStop(1, 'rgba(0,0,0,0.2)')
        ctx.fillStyle = sh
        ctx.fillRect(g.left, g.top, span, g.bottom - g.top)
      } else {
        const edge = ctx.createRadialGradient(g.cx, g.cy, g.R * 0.6, g.cx, g.cy, g.R)
        edge.addColorStop(0, 'rgba(0,0,0,0)')
        edge.addColorStop(1, 'rgba(0,0,0,0.24)')
        ctx.fillStyle = edge
        ctx.fillRect(g.left, g.top, span, span)
      }

      // capacity ticks
      if (shape === 'tank') {
        ctx.strokeStyle = colors.border
        ctx.lineWidth = 1
        for (const t of [0.25, 0.5, 0.75]) {
          const y = g.bottom - (g.bottom - g.top) * t
          ctx.beginPath()
          ctx.moveTo(g.right - 12, y)
          ctx.lineTo(g.right, y)
          ctx.stroke()
        }
      }
      ctx.restore()

      // overflow glow
      if (s.lv > 1) {
        ctx.save()
        ctx.shadowColor = 'rgba(208,59,59,0.6)'
        ctx.shadowBlur = 14 + 6 * Math.sin(s.phase * 3)
        g.trace(ctx)
        ctx.strokeStyle = 'rgba(208,59,59,0.8)'
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()
      } else {
        g.trace(ctx)
        ctx.strokeStyle = colors.border
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // glass highlights
      ctx.save()
      if (shape === 'tank') {
        const top = g.top + 16
        const bot = g.bottom - 16
        const hl = ctx.createLinearGradient(0, top, 0, bot)
        hl.addColorStop(0, 'rgba(255,255,255,0)')
        hl.addColorStop(0.2, 'rgba(255,255,255,0.42)')
        hl.addColorStop(0.7, 'rgba(255,255,255,0.12)')
        hl.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = hl
        roundRect(ctx, g.left + 7, top, 6, bot - top, 3)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.28)'
        roundRect(ctx, g.right - 9, top + 20, 2.5, (bot - top) * 0.5, 1.2)
        ctx.fill()
      } else {
        const gx = g.cx - g.R * 0.38
        const gy = g.cy - g.R * 0.42
        const sp = ctx.createRadialGradient(gx, gy, 0, gx, gy, g.R * 0.6)
        sp.addColorStop(0, 'rgba(255,255,255,0.32)')
        sp.addColorStop(1, 'rgba(255,255,255,0)')
        ctx.fillStyle = sp
        g.trace(ctx)
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.32)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(g.cx, g.cy, g.R - 3, 0.12 * Math.PI, 0.55 * Math.PI)
        ctx.stroke()
        ctx.translate(g.cx - g.R * 0.44, g.cy - g.R * 0.56)
        ctx.rotate(-0.62)
        ctx.fillStyle = 'rgba(255,255,255,0.72)'
        ctx.beginPath()
        ctx.ellipse(0, 0, g.R * 0.17, g.R * 0.065, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()

      if (reduced) return

      // overflowing: liquid spills over the rim, runs down the outside and pools at the foot
      if (shape === 'tank') {
        const over = s.lv - 1
        if (over > 0.001) {
          s.spillAcc += dt * Math.min(16, over * 30 + 4)
          while (s.spillAcc > 1) {
            s.spillAcc -= 1
            const side = Math.random() < 0.5 ? -1 : 1
            s.spills.push({
              x: side < 0 ? g.left + 6 : g.right - 6,
              y: g.top + 2,
              vx: side * (30 + Math.random() * 40),
              vy: -20 - Math.random() * 30,
              r: 1.5 + Math.random() * 1.7,
              side,
              onWall: false
            })
          }
        }
        s.pool = s.pool.map((p) => Math.max(0, p - dt * 0.6))
        const spill = `rgb(${liquid.join(',')})`
        ctx.fillStyle = spill
        ctx.strokeStyle = `rgba(${liquid.join(',')},0.55)`
        ctx.lineCap = 'round'
        s.spills = s.spills.filter((p) => {
          const wall = p.side < 0 ? g.left - p.r - 0.5 : g.right + p.r + 0.5
          if (!p.onWall) {
            p.vy += 600 * dt
            p.x += p.vx * dt
            p.y += p.vy * dt
            if ((p.side < 0 && p.x <= wall) || (p.side > 0 && p.x >= wall)) {
              p.onWall = true
              p.x = wall
              p.vy = Math.max(p.vy, 10)
            }
          } else {
            // viscous run down the wall
            p.vy = Math.min(150, p.vy + 260 * dt)
            p.y += p.vy * dt
          }
          if (p.y >= g.bottom - 1) {
            const i = p.side < 0 ? 0 : 1
            s.pool[i] = Math.min(12, s.pool[i] + 0.5)
            return false
          }
          if (p.onWall) {
            ctx.lineWidth = p.r * 1.1
            ctx.beginPath()
            ctx.moveTo(p.x, Math.max(g.top, p.y - Math.min(26, p.vy * 0.18)))
            ctx.lineTo(p.x, p.y)
            ctx.stroke()
          }
          ctx.beginPath()
          ctx.ellipse(p.x, p.y, p.r * 0.85, p.r * (p.onWall ? 1.5 : 1.1), 0, 0, Math.PI * 2)
          ctx.fill()
          return true
        })
        s.pool.forEach((pr, i) => {
          if (pr < 0.2) return
          ctx.beginPath()
          ctx.ellipse(i ? g.right + 2 : g.left - 2, g.bottom, 3 + pr, (3 + pr) * 0.32, 0, 0, Math.PI * 2)
          ctx.fill()
        })
        if (over > 0.001) {
          // beads hanging on the rim
          for (const x of [g.left + 4, g.right - 4]) {
            ctx.beginPath()
            ctx.arc(x, g.top + 1.5, 2.6 + Math.sin(s.t * 6 + x) * 0.5, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      }

      // the eye-dropper: drops swell at the tip, fall and ring the surface
      const busy = s.queue > 0 || !!s.forming || s.drops.length > 0 || s.t - s.lastRelease < 1.4
      s.dropper += ((busy ? 1 : 0) - s.dropper) * Math.min(1, dt * 6)
      if (!s.forming && s.queue > 0 && s.t >= s.nextDrip && s.dropper > 0.6) {
        s.forming = { r: 0, max: (2.8 + Math.random() * 1.2) * g.k, age: 0 }
        s.queue--
      }
      drawDropper(g, liquid)
      const dropFill = `rgb(${liquid.join(',')})`
      if (s.forming) {
        const f = s.forming
        f.age += dt
        f.r = f.max * Math.min(1, f.age / FORM_S)
        ctx.fillStyle = dropFill
        ctx.beginPath()
        ctx.ellipse(g.tipX, g.tipY + f.r * 0.95, f.r * 0.9, f.r * (1 + 0.15 * Math.sin(f.age * 40)), 0, 0, Math.PI * 2)
        ctx.fill()
        if (f.age >= FORM_S) {
          s.drops.push({ x: g.tipX, y: g.tipY + f.r, vy: 20, r: f.r })
          s.forming = null
          s.squeeze = 1
          s.lastRelease = s.t
          s.nextDrip = s.t + GAP_S
        }
      }
      s.drops = s.drops.filter((d) => {
        d.vy += 1100 * dt
        d.y += d.vy * dt
        const sy = landY(d.x)
        if (d.y >= sy) {
          s.ripple = Math.min(1.4, s.ripple + 0.12)
          for (let k = 0; k < 3; k++) s.rings.push({ x: d.x, born: s.t + k * 0.11 })
          s.impulses = [...s.impulses.slice(-5), { x: d.x, born: s.t }]
          for (let k = 0; k < 5; k++) {
            s.splashes.push({ x: d.x, y: sy, vx: (Math.random() - 0.5) * 120, vy: -70 - Math.random() * 90, life: 0.5 })
          }
          return false
        }
        const stretch = 1 + Math.min(0.9, d.vy / 700)
        ctx.fillStyle = dropFill
        ctx.beginPath()
        ctx.ellipse(d.x, d.y, d.r * 0.85, d.r * stretch, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.6)'
        ctx.beginPath()
        ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.28, 0, Math.PI * 2)
        ctx.fill()
        return true
      })
      if (s.splashes.length) {
        ctx.fillStyle = dropFill
        s.splashes = s.splashes.filter((p) => {
          p.life -= dt
          p.vy += 520 * dt
          p.x += p.vx * dt
          p.y += p.vy * dt
          if (p.life <= 0) return false
          ctx.globalAlpha = Math.max(0, p.life / 0.5)
          ctx.beginPath()
          ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
          return true
        })
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    resize()

    if (reduced) {
      s.draw(0)
      return () => ro.disconnect()
    }
    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      s.draw(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [reduced, shape, pixelScale])

  useEffect(() => {
    if (reduced) st.current.draw(0)
  }, [level, reduced])

  return (
    <div className={`tank-wrap${shape === 'orb' ? ' orb' : ''}`} ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}
