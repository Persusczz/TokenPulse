import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import { cssVar, type MotionScale } from '../state'

const TAU = Math.PI * 2

function rgbOf(c: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim())
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Sizes a canvas to its box at device resolution; returns the css size */
function fit(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, scale = 1): { w: number; h: number } {
  const dpr = (window.devicePixelRatio || 1) * scale
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(h * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h }
}

interface Star {
  r: number
  a: number
  size: number
  hue: number
  arm: number
}

/**
 * A small spiral galaxy turning behind the floating window's content, in the
 * accent colour, with twinkling background stars. Turns faster with usage;
 * each pulse flares the core.
 */
export function MiniGalaxy({ intensity, level, pulse, theme, pixelScale = 1 }: { intensity: Intensity; level: MotionScale; pulse: number; theme: string; pixelScale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ intensity, level, flare: 0, rgb: [217, 119, 87] as [number, number, number], dark: true })
  st.current.intensity = intensity
  st.current.level = level
  useEffect(() => {
    st.current.rgb = rgbOf(cssVar('--accent'), [217, 119, 87])
    st.current.dark = theme.startsWith('dark')
  }, [theme])
  useEffect(() => {
    if (pulse) st.current.flare = 1
  }, [pulse])

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let size = fit(canvas, ctx, pixelScale)
    const stars: Star[] = Array.from({ length: 360 }, () => {
      const r = Math.pow(Math.random(), 0.7)
      return { r, a: Math.random() * TAU, size: 0.5 + Math.random() * 1.1, hue: Math.random(), arm: Math.random() < 0.75 ? (Math.random() < 0.5 ? 0 : Math.PI) : -1 }
    })
    const bg = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: 0.4 + Math.random(), p: Math.random() * TAU, f: 0.6 + Math.random() * 2 }))
    let t = 0
    let raf = 0
    let last = performance.now()
    const draw = (dt: number) => {
      const s = st.current
      const { w, h } = size
      t += dt * (0.25 + s.intensity * 0.35)
      s.flare = Math.max(0, s.flare - dt * 0.8)
      ctx.clearRect(0, 0, w, h)
      // deep space wash
      const g0 = ctx.createRadialGradient(w * 0.72, h * 0.5, 0, w * 0.72, h * 0.5, Math.max(w, h) * 0.8)
      g0.addColorStop(0, s.dark ? 'rgba(40,28,70,0.55)' : 'rgba(60,50,110,0.18)')
      g0.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g0
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = s.dark ? 'lighter' : 'source-over'
      for (const b of bg) {
        ctx.globalAlpha = (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * b.f * 3 + b.p))) * (s.dark ? 0.8 : 0.4)
        ctx.fillStyle = s.dark ? '#fff' : '#4a3f66'
        ctx.fillRect(b.x * w, b.y * h, b.r, b.r)
      }
      // the galaxy sits to the right, behind the numbers' quiet side
      const cx = w * 0.74
      const cy = h * 0.48
      const R = Math.min(w * 0.42, h * 1.1)
      const [cr, cg, cb] = s.rgb
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.35)
      core.addColorStop(0, `rgba(255,240,220,${0.55 + s.flare * 0.4})`)
      core.addColorStop(0.35, `rgba(${cr},${cg},${cb},${0.25 + s.flare * 0.3})`)
      core.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 1
      ctx.fillStyle = core
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2)
      for (const p of stars) {
        const ang = p.arm < 0 ? p.a + t * 0.4 : p.arm + Math.log(p.r + 0.05) * 2.4 + t * 0.4 + (p.a - Math.PI) * 0.12
        const x = cx + Math.cos(ang) * p.r * R
        const y = cy + Math.sin(ang) * p.r * R * 0.42
        const near = 1 - p.r
        ctx.globalAlpha = Math.min(1, (0.25 + near * 0.75) * (s.dark ? 0.9 : 0.55))
        ctx.fillStyle = p.hue < 0.5 ? `rgb(${cr},${cg},${cb})` : p.hue < 0.85 ? (s.dark ? '#cfdcff' : '#4b5fb0') : '#fff2d8'
        ctx.fillRect(x, y, p.size, p.size)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }
    const ro = new ResizeObserver(() => {
      size = fit(canvas, ctx, pixelScale)
      draw(0)
    })
    ro.observe(canvas)
    draw(0)
    if (st.current.level > 0) {
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        if (now - last < 33) return
        draw(Math.min(0.08, (now - last) / 1000))
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [level, pixelScale])

  return <canvas ref={ref} className="mini-cosmos" />
}

interface Mote {
  r: number
  phi: number
  size: number
  heat: number
}
interface Fall {
  r: number
  phi: number
  life: number
}

/**
 * A black hole whose accretion disk is the 5h quota: the fuller the window,
 * the brighter, thicker and hotter the disk (red near the limit), with an
 * arc around the orb showing the percentage. New usage spirals in.
 */
export function BlackHole({
  pct,
  intensity,
  level,
  pulse,
  pixelScale = 1,
  gauge = true,
  className = 'black-hole'
}: {
  /** 0–100, or null without quota data */
  pct: number | null
  intensity: Intensity
  level: MotionScale
  pulse: number
  pixelScale?: number
  /** draw the percentage arc around the edge */
  gauge?: boolean
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ pct, intensity, falls: [] as Fall[], flare: 0, rgb: [217, 119, 87] as [number, number, number] })
  st.current.pct = pct
  st.current.intensity = intensity
  useEffect(() => {
    st.current.rgb = rgbOf(cssVar('--accent'), [217, 119, 87])
  })
  useEffect(() => {
    if (!pulse) return
    const s = st.current
    s.flare = 1
    for (let i = 0; i < 14; i++) s.falls.push({ r: 4.4 + Math.random() * 0.8, phi: Math.random() * TAU, life: 1 })
  }, [pulse])

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let size = fit(canvas, ctx, pixelScale)
    const motes: Mote[] = Array.from({ length: 620 }, () => {
      const r = 1.6 + 3.2 * Math.pow(Math.random(), 1.4)
      return { r, phi: Math.random() * TAU, size: 0.9 + Math.random() * 1.6, heat: Math.random() }
    })
    const bg = Array.from({ length: 50 }, () => ({ a: Math.random() * TAU, d: Math.sqrt(Math.random()), r: 0.4 + Math.random() * 0.9, p: Math.random() * TAU }))
    let t = 0
    let raf = 0
    let last = performance.now()
    const draw = (dt: number) => {
      const s = st.current
      const { w, h } = size
      const S = Math.min(w, h)
      const cx = w / 2
      // with the gauge (the orb) the hole sits above the middle, leaving room for the numbers
      const cy = gauge ? h * 0.4 : h / 2
      const rs = S * (gauge ? 0.095 : 0.12)
      const fill = s.pct === null ? 0.35 : Math.max(0.06, Math.min(1, s.pct / 100))
      const hot = s.pct !== null && s.pct >= 90 ? 1 : s.pct !== null && s.pct >= 75 ? 0.5 : 0
      t += dt
      s.flare = Math.max(0, s.flare - dt * 0.9)
      ctx.clearRect(0, 0, w, h)
      // the orb: deep space inside a circle
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, S * 0.48, 0, TAU)
      ctx.clip()
      const sky = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5)
      sky.addColorStop(0, '#120c22')
      sky.addColorStop(1, '#05040b')
      ctx.fillStyle = sky
      ctx.fillRect(0, 0, w, h)
      for (const b of bg) {
        ctx.globalAlpha = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + b.p))
        ctx.fillStyle = '#fff'
        ctx.fillRect(cx + Math.cos(b.a) * b.d * S * 0.47, cy + Math.sin(b.a) * b.d * S * 0.47, b.r, b.r)
      }
      const tilt = 0.26
      const [ar, ag, ab] = s.rgb
      const colour = (heat: number, a: number) => {
        // inner motes white-hot, outer in the accent; near the limit everything reddens
        const r = Math.round(255 * heat + ar * (1 - heat))
        const g = Math.round((236 * heat + ag * (1 - heat)) * (1 - hot * 0.45))
        const b2 = Math.round((200 * heat + ab * (1 - heat)) * (1 - hot * 0.6))
        return `rgba(${r},${g},${b2},${a.toFixed(3)})`
      }
      const speed = 0.7 + s.intensity * 0.5
      // Keplerian: the inner disk races
      for (const m of motes) m.phi += (dt * speed * 2.2) / Math.pow(m.r, 1.5)
      /** the disk's glow as a soft elliptical band; the near half is drawn after the shadow */
      const band = (front: boolean) => {
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.beginPath()
        ctx.rect(0, front ? cy : 0, w, front ? h - cy : cy)
        ctx.clip()
        for (const [k, a] of [
          [1.9, 0.55],
          [2.7, 0.32],
          [3.6, 0.16]
        ] as const) {
          ctx.strokeStyle = colour(Math.max(0, 1.2 - k * 0.3), Math.min(1, a * (0.35 + fill * 0.9) * (1 + s.flare * 0.5)))
          ctx.lineWidth = rs * (0.55 + fill * 0.6)
          ctx.shadowColor = colour(0.6, 0.8)
          ctx.shadowBlur = rs * 0.8
          ctx.beginPath()
          ctx.ellipse(cx, cy, rs * k, rs * k * tilt, 0, 0, TAU)
          ctx.stroke()
        }
        ctx.restore()
      }
      band(false)
      const drawMotes = (front: boolean) => {
        ctx.globalCompositeOperation = 'lighter'
        for (const m of motes) {
          // only the fill share of the disk is lit
          if (m.heat > fill + 0.08) continue
          const x = Math.cos(m.phi) * m.r * rs
          const y = Math.sin(m.phi) * m.r * rs * tilt
          if (y > 0 !== front) continue
          // the far side behind the shadow is hidden
          if (!front && x * x + y * y < (rs * 1.05) ** 2) continue
          const doppler = 1 + 0.6 * (-Math.cos(m.phi))
          const heat = Math.max(0, 1 - (m.r - 1.6) / 3.2)
          ctx.fillStyle = colour(heat, Math.min(1, (0.25 + heat * 0.6) * doppler * (0.7 + s.flare * 0.6)))
          ctx.fillRect(cx + x, cy + y, m.size, m.size)
        }
        ctx.globalCompositeOperation = 'source-over'
      }
      drawMotes(false)
      // lensed light of the far side, bent over the top of the shadow
      ctx.globalCompositeOperation = 'lighter'
      const halo = ctx.createRadialGradient(cx, cy, rs * 0.95, cx, cy, rs * (2.1 + fill))
      halo.addColorStop(0, colour(1, 0.55 + fill * 0.35 + s.flare * 0.2))
      halo.addColorStop(0.25, colour(0.6, 0.22 + fill * 0.2))
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, rs * (2.1 + fill), 0, TAU)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      // the shadow
      ctx.fillStyle = '#000'
      ctx.beginPath()
      ctx.arc(cx, cy, rs, 0, TAU)
      ctx.fill()
      // photon ring
      ctx.strokeStyle = colour(1, 0.85)
      ctx.lineWidth = Math.max(0.8, rs * 0.07)
      ctx.beginPath()
      ctx.arc(cx, cy, rs * 1.04, 0, TAU)
      ctx.stroke()
      band(true)
      drawMotes(true)
      // matter spiralling in after new usage
      ctx.globalCompositeOperation = 'lighter'
      s.falls = s.falls.filter((f) => {
        f.r -= dt * (1.6 + (4.6 - f.r) * 0.8)
        f.phi += dt * 3.2 / Math.max(0.6, f.r)
        f.life = Math.min(1, (f.r - 1) / 1.2)
        if (f.r <= 1.05) return false
        const x = Math.cos(f.phi) * f.r * rs
        const y = Math.sin(f.phi) * f.r * rs * tilt
        ctx.fillStyle = colour(1, Math.max(0, f.life))
        ctx.beginPath()
        ctx.arc(cx + x, cy + y, 1.6, 0, TAU)
        ctx.fill()
        return true
      })
      ctx.globalCompositeOperation = 'source-over'
      ctx.restore()
      // the percentage, as an arc around the orb
      if (gauge && s.pct !== null) {
        const p = Math.max(0, Math.min(100, s.pct)) / 100
        ctx.lineCap = 'round'
        ctx.lineWidth = Math.max(2, S * 0.03)
        ctx.strokeStyle = 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.arc(cx, cy, S * 0.47, 0, TAU)
        ctx.stroke()
        ctx.strokeStyle = hot >= 1 ? '#e05252' : hot > 0 ? '#ec835a' : `rgb(${ar},${ag},${ab})`
        ctx.shadowColor = ctx.strokeStyle
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(cx, cy, S * 0.47, -Math.PI / 2, -Math.PI / 2 + p * TAU)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
    }
    const ro = new ResizeObserver(() => {
      size = fit(canvas, ctx, pixelScale)
      draw(0)
    })
    ro.observe(canvas)
    draw(0.016)
    if (level > 0) {
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick)
        if (now - last < 30) return
        draw(Math.min(0.08, (now - last) / 1000))
        last = now
      }
      raf = requestAnimationFrame(tick)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [level, pixelScale, gauge])

  return <canvas ref={ref} className={className} />
}
