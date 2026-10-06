import { useEffect, useRef, type RefObject } from 'react'
import type { Intensity } from '@shared/types'
import type { MotionScale } from '../state'
import { onFrame, onQuality, sceneScale } from '../frames'

/** What a scene reads every frame (kept in a ref so props never restart the loop) */
export interface Live {
  intensity: Intensity
  vivid: number
  /** performance.now() of the latest batch of new usage */
  pulseAt: number
  /** tokens behind it */
  size: number
}

export interface Scene {
  init(w: number, h: number): void
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, live: Live): void
}

export const TAU = Math.PI * 2
export const rand = (a: number, b: number) => a + Math.random() * (b - a)

/** Runs a canvas scene at `fps`, at `res` x device pixels; still (one frame) when motion is off */
export function useScene(ref: RefObject<HTMLCanvasElement | null>, level: MotionScale, live: RefObject<Live>, make: () => Scene, res = 1, fps = 30): void {
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const scene = make()
    let w = 0
    let h = 0
    // a new size lays the scene out again; a new resolution (the frame clock easing off) only redraws it
    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * res * sceneScale()
      const nw = canvas.clientWidth
      const nh = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(nw * dpr))
      canvas.height = Math.max(1, Math.round(nh * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (nw !== w || nh !== h) {
        w = nw
        h = nh
        scene.init(w, h)
      }
      scene.draw(ctx, w, h, 0, live.current!)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    const offQuality = onQuality(resize)
    const speed = level >= 3 ? 1.25 : level === 1 ? 0.6 : 1
    const stop = level > 0 ? onFrame(fps, (dt) => scene.draw(ctx, w, h, Math.min(0.08, dt) * speed, live.current!), 'scene') : null
    return () => {
      stop?.()
      offQuality()
      ro.disconnect()
    }
  }, [level, res]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface SceneProps {
  intensity: Intensity
  level: MotionScale
  pulse: number
  size?: number
  vivid: number
  /** scenes that also come in a light version */
  dark?: boolean
}

export function useLive({ intensity, pulse, size = 0, vivid }: SceneProps): RefObject<Live> {
  const live = useRef<Live>({ intensity, vivid, pulseAt: -1e9, size })
  live.current.intensity = intensity
  live.current.vivid = vivid
  useEffect(() => {
    if (!pulse) return
    live.current.pulseAt = performance.now()
    live.current.size = size
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps
  return live
}

/** seconds since the last pulse */
export const since = (l: Live) => (performance.now() - l.pulseAt) / 1000

// ---------------------------------------------------------------- 赛博霓虹

/**
 * Synthwave night: a striped sun sinking into a neon horizon, wireframe
 * mountains, and a magenta grid racing toward you (faster with usage). Each
 * batch of new usage sends a bright scan wave down the grid.
 */
export function NeonGrid(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  useScene(ref, p.level, live, () => {
    let stars: { x: number; y: number; r: number; p: number }[] = []
    let far: number[] = []
    let near: number[] = []
    let t = 0
    return {
      init(w, h) {
        const hy = h * 0.36
        stars = Array.from({ length: Math.round((w * hy) / 2600) }, () => ({ x: Math.random() * w, y: Math.random() * hy * 0.95, r: rand(0.5, 1.6), p: Math.random() * TAU }))
        far = Array.from({ length: 26 }, () => Math.random())
        near = Array.from({ length: 18 }, () => Math.random())
      },
      draw(ctx, w, h, dt, l) {
        t += dt * (0.5 + l.intensity * 0.45)
        const hy = h * 0.36
        const vx = w * 0.57
        const glow = 0.55 + l.vivid * 0.6
        const sky = ctx.createLinearGradient(0, 0, 0, h)
        sky.addColorStop(0, '#06020e')
        sky.addColorStop(0.36, '#2b0a40')
        sky.addColorStop(0.361, '#13031f')
        sky.addColorStop(1, '#040008')
        ctx.globalCompositeOperation = 'source-over'
        ctx.fillStyle = sky
        ctx.fillRect(0, 0, w, h)
        for (const s of stars) {
          ctx.globalAlpha = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(t * 3 + s.p))
          ctx.fillStyle = '#ffe9ff'
          ctx.fillRect(s.x, s.y, s.r, s.r)
        }
        ctx.globalAlpha = 1
        // the sun, cut by widening stripes toward the horizon
        const R = Math.max(80, h * 0.2)
        const sun = ctx.createLinearGradient(0, hy - R, 0, hy)
        sun.addColorStop(0, '#ffe96b')
        sun.addColorStop(0.5, '#ff8a4c')
        sun.addColorStop(1, '#ff2bd6')
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, 0, w, hy)
        ctx.clip()
        const halo = ctx.createRadialGradient(vx, hy - R * 0.4, R * 0.5, vx, hy - R * 0.4, R * 2.4)
        halo.addColorStop(0, `rgba(255,60,200,${0.35 * glow})`)
        halo.addColorStop(1, 'rgba(255,60,200,0)')
        ctx.fillStyle = halo
        ctx.fillRect(0, 0, w, hy)
        ctx.fillStyle = sun
        ctx.beginPath()
        ctx.arc(vx, hy - R * 0.15, R, 0, TAU)
        ctx.fill()
        ctx.globalCompositeOperation = 'destination-out'
        for (let i = 0; i < 7; i++) {
          const y = hy - R * 0.15 - R * 0.5 + i * R * 0.17 + ((t * 8) % (R * 0.17))
          const th = 1 + i * 1.6
          ctx.fillRect(vx - R - 2, y, R * 2 + 4, th)
        }
        ctx.globalCompositeOperation = 'source-over'
        // wireframe mountains in front of the sun
        const ridge = (pts: number[], amp: number, fill: string, stroke: string, off: number) => {
          ctx.beginPath()
          ctx.moveTo(0, hy)
          pts.forEach((v, i) => {
            const x = (i / (pts.length - 1)) * w
            const peak = Math.abs(x - vx) < w * 0.12 ? 0.2 : 1
            ctx.lineTo(x, hy - (0.25 + v * 0.75) * amp * peak + off)
          })
          ctx.lineTo(w, hy)
          ctx.closePath()
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = stroke
          ctx.lineWidth = 1.2
          ctx.shadowColor = stroke
          ctx.shadowBlur = 8 * glow
          ctx.stroke()
          ctx.shadowBlur = 0
        }
        ridge(far, h * 0.11, '#1a0629', 'rgba(255,60,214,0.7)', 0)
        ridge(near, h * 0.06, '#0d0218', 'rgba(33,230,255,0.75)', 2)
        ctx.restore()
        // the horizon
        ctx.strokeStyle = '#ff4fd8'
        ctx.lineWidth = 2
        ctx.shadowColor = '#ff4fd8'
        ctx.shadowBlur = 20 * glow
        ctx.beginPath()
        ctx.moveTo(0, hy)
        ctx.lineTo(w, hy)
        ctx.stroke()
        ctx.shadowBlur = 0
        // the grid: rails to the vanishing point, cross lines rushing in
        ctx.globalCompositeOperation = 'lighter'
        const depth = h - hy
        const sb = w / 9
        for (let i = -14; i <= 14; i++) {
          const g = ctx.createLinearGradient(0, hy, 0, h)
          g.addColorStop(0, 'rgba(255,43,214,0)')
          g.addColorStop(1, `rgba(255,43,214,${0.75 * glow})`)
          ctx.strokeStyle = g
          ctx.lineWidth = 1.3
          ctx.beginPath()
          ctx.moveTo(vx + i * 2, hy)
          ctx.lineTo(vx + i * sb * 1.6, h + 4)
          ctx.stroke()
        }
        const phase = (t * 0.9) % 1
        for (let k = 0; k < 26; k++) {
          const z = k + 1 - phase
          const y = hy + depth / z
          if (y > h + 4) continue
          const a = Math.min(1, 1.6 / z) * 0.8 * glow
          ctx.strokeStyle = `rgba(255,43,214,${a.toFixed(3)})`
          ctx.lineWidth = Math.max(0.6, 2.2 / z)
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(w, y)
          ctx.stroke()
        }
        // a scan wave after new usage
        const s = since(l)
        if (s < 1.1) {
          const z = Math.max(0.4, 26 * (1 - s / 1.1) ** 2.2)
          const y = hy + depth / z
          const band = ctx.createLinearGradient(0, y - 18, 0, y + 18)
          band.addColorStop(0, 'rgba(125,249,255,0)')
          band.addColorStop(0.5, `rgba(125,249,255,${0.75 * (1 - s / 1.1)})`)
          band.addColorStop(1, 'rgba(125,249,255,0)')
          ctx.fillStyle = band
          ctx.fillRect(0, y - 18, w, 36)
        }
        ctx.globalCompositeOperation = 'source-over'
      }
    }
  })
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 北欧极光

/**
 * Polar night over snowy peaks: three curtains of aurora fold and sway across
 * the sky (livelier with usage); new usage sends a bright ripple along them.
 */
export function Borealis(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let stars: { x: number; y: number; r: number; p: number; f: number }[] = []
      let peaks: HTMLCanvasElement | null = null
      const tex: HTMLCanvasElement[] = []
      let t = 0
      // a vertical light strip per curtain: bright green foot, teal body, violet crown
      const STOPS: [string, string, string][] = [
        ['rgba(90,255,170,1)', 'rgba(40,220,190,0.55)', 'rgba(150,90,255,0)'],
        ['rgba(120,255,200,0.9)', 'rgba(60,200,255,0.45)', 'rgba(200,110,255,0)'],
        ['rgba(200,120,255,0.8)', 'rgba(120,90,255,0.4)', 'rgba(80,60,200,0)']
      ]
      for (const [a, b, c] of STOPS) {
        const cv = document.createElement('canvas')
        cv.width = 1
        cv.height = 256
        const g = cv.getContext('2d')!
        const lg = g.createLinearGradient(0, 256, 0, 0)
        lg.addColorStop(0, 'rgba(90,255,170,0)')
        lg.addColorStop(0.06, a)
        lg.addColorStop(0.35, b)
        lg.addColorStop(1, c)
        g.fillStyle = lg
        g.fillRect(0, 0, 1, 256)
        tex.push(cv)
      }
      return {
        init(w, h) {
          stars = Array.from({ length: Math.round((w * h) / 3800) }, () => ({ x: Math.random() * w, y: Math.random() * h * 0.8, r: rand(0.4, 1.5), p: Math.random() * TAU, f: rand(0.5, 2.5) }))
          // two ranges of peaks with snowy ridges, drawn once
          peaks = document.createElement('canvas')
          const dpr = window.devicePixelRatio || 1
          peaks.width = Math.max(1, Math.round(w * dpr))
          peaks.height = Math.max(1, Math.round(h * dpr))
          const g = peaks.getContext('2d')!
          g.scale(dpr, dpr)
          const range = (base: number, amp: number, n: number, col: string, snow: string) => {
            const pts: [number, number][] = []
            for (let i = 0; i <= n; i++) {
              const x = (i / n) * w
              const y = base - amp * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + n) * Math.cos(i * 0.6))) - (i % 2 ? amp * 0.25 : 0)
              pts.push([x, y])
            }
            g.beginPath()
            g.moveTo(0, h)
            pts.forEach(([x, y]) => g.lineTo(x, y))
            g.lineTo(w, h)
            g.closePath()
            g.fillStyle = col
            g.fill()
            g.strokeStyle = snow
            g.lineWidth = 1.4
            g.beginPath()
            pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
            g.stroke()
          }
          range(h * 0.86, h * 0.16, 11, '#0a1a26', 'rgba(200,235,255,0.35)')
          range(h * 0.97, h * 0.12, 8, '#040c13', 'rgba(220,240,255,0.25)')
        },
        draw(ctx, w, h, dt, l) {
          t += dt * (0.55 + l.intensity * 0.35)
          const glow = 0.5 + l.vivid * 0.7
          const sky = ctx.createLinearGradient(0, 0, 0, h)
          sky.addColorStop(0, '#01040d')
          sky.addColorStop(0.55, '#061a2b')
          sky.addColorStop(1, '#0d2c3c')
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          ctx.fillStyle = sky
          ctx.fillRect(0, 0, w, h)
          ctx.fillStyle = '#eaf6ff'
          for (const s of stars) {
            ctx.globalAlpha = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.f + s.p))
            ctx.fillRect(s.x, s.y, s.r, s.r)
          }
          ctx.globalCompositeOperation = 'lighter'
          const ps = since(l)
          const ripple = ps < 2.4 ? w * (ps / 2.4) * 1.3 - w * 0.15 : -1e9
          const step = 3
          for (let r = 0; r < 3; r++) {
            const base = h * (0.42 + r * 0.07)
            const H = h * (0.34 - r * 0.06)
            for (let x = -step; x < w + step; x += step) {
              const yb = base + Math.sin(x * 0.0035 + t * 0.32 + r * 1.7) * h * 0.06 + Math.sin(x * 0.012 - t * 0.55 + r) * h * 0.018
              const fold = 0.5 + 0.5 * Math.sin(x * 0.026 + t * 1.15 + r * 2.1 + Math.sin(x * 0.004 + t * 0.2) * 3)
              const edge = Math.min(1, x / (w * 0.08), (w - x) / (w * 0.08))
              const wave = Math.exp(-(((x - ripple) / 70) ** 2))
              const a = (0.12 + 0.55 * fold * fold + wave * 0.6) * edge * glow * (r === 2 ? 0.7 : 1)
              if (a <= 0.01) continue
              ctx.globalAlpha = Math.min(1, a)
              const hh = H * (0.75 + 0.35 * fold + wave * 0.2)
              ctx.drawImage(tex[r], x, yb - hh, step + 0.6, hh)
            }
          }
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          if (peaks) ctx.drawImage(peaks, 0, 0, w, h)
        }
      }
    },
    0.6
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 墨水纸本

/**
 * Ink wash on paper: misty layered mountains, a vermilion sun, birds, and
 * drifting fog; each batch of new usage drops ink that blooms into the paper.
 */
export function InkWash(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let paper: HTMLCanvasElement | null = null
      let drops: { x: number; y: number; age: number; r: number; seed: number }[] = []
      let birds: { x: number; y: number; v: number; s: number; p: number }[] = []
      let t = 0
      return {
        init(w, h) {
          paper = document.createElement('canvas')
          const dpr = window.devicePixelRatio || 1
          paper.width = Math.max(1, Math.round(w * dpr))
          paper.height = Math.max(1, Math.round(h * dpr))
          const g = paper.getContext('2d')!
          g.scale(dpr, dpr)
          g.fillStyle = '#f3ede0'
          g.fillRect(0, 0, w, h)
          // fibres
          g.strokeStyle = 'rgba(120,100,70,0.05)'
          g.lineWidth = 0.6
          for (let i = 0; i < (w * h) / 900; i++) {
            const x = Math.random() * w
            const y = Math.random() * h
            const a = Math.random() * TAU
            const l = rand(3, 14)
            g.beginPath()
            g.moveTo(x, y)
            g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
            g.stroke()
          }
          // the sun
          g.fillStyle = 'rgba(196,58,44,0.55)'
          g.beginPath()
          g.arc(w * 0.8, h * 0.2, Math.max(26, h * 0.055), 0, TAU)
          g.fill()
          // mountains in three washes, far to near
          const layers = [
            { base: 0.62, amp: 0.26, col: [120, 128, 138], a: 0.32, n: 0.004 },
            { base: 0.78, amp: 0.2, col: [72, 76, 82], a: 0.45, n: 0.006 },
            { base: 0.94, amp: 0.16, col: [28, 28, 32], a: 0.6, n: 0.009 }
          ]
          layers.forEach((L, li) => {
            const pts: [number, number][] = []
            const seed = li * 13.7
            for (let x = 0; x <= w; x += 4) {
              const n =
                Math.sin(x * L.n + seed) * 0.5 +
                Math.sin(x * L.n * 2.3 + seed * 2) * 0.25 +
                Math.sin(x * L.n * 5.1 + seed * 3) * 0.12 +
                Math.sin(x * L.n * 11 + seed) * 0.05
              pts.push([x, h * L.base - (0.5 + n) * h * L.amp])
            }
            const top = Math.min(...pts.map((q) => q[1]))
            const grad = g.createLinearGradient(0, top, 0, h * L.base + h * 0.12)
            grad.addColorStop(0, `rgba(${L.col.join(',')},${L.a})`)
            grad.addColorStop(0.55, `rgba(${L.col.join(',')},${L.a * 0.35})`)
            grad.addColorStop(1, `rgba(${L.col.join(',')},0)`)
            g.beginPath()
            g.moveTo(0, h)
            pts.forEach(([x, y]) => g.lineTo(x, y))
            g.lineTo(w, h)
            g.closePath()
            g.fillStyle = grad
            g.fill()
            // the brush along the ridge, thick and thin
            for (let i = 1; i < pts.length; i++) {
              g.strokeStyle = `rgba(${L.col.map((c) => c * 0.6).join(',')},${L.a * 0.9})`
              g.lineWidth = 0.6 + Math.abs(Math.sin(i * 0.07 + seed)) * (1.6 + li)
              g.beginPath()
              g.moveTo(pts[i - 1][0], pts[i - 1][1])
              g.lineTo(pts[i][0], pts[i][1])
              g.stroke()
            }
          })
          birds = Array.from({ length: 4 }, (_, i) => ({ x: rand(0, w), y: h * rand(0.12, 0.3), v: rand(8, 16), s: rand(5, 9), p: i }))
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          if (paper) ctx.drawImage(paper, 0, 0, w, h)
          // fog drifting between the ranges
          for (let i = 0; i < 3; i++) {
            const y = h * (0.58 + i * 0.13)
            const x = ((t * (6 + i * 3) + i * w * 0.4) % (w * 1.6)) - w * 0.3
            const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.45)
            g.addColorStop(0, 'rgba(250,247,240,0.55)')
            g.addColorStop(1, 'rgba(250,247,240,0)')
            ctx.fillStyle = g
            ctx.save()
            ctx.translate(x, y)
            ctx.scale(1, 0.16)
            ctx.translate(-x, -y)
            ctx.fillRect(x - w * 0.45, y - w * 0.45, w * 0.9, w * 0.9)
            ctx.restore()
          }
          // birds: two strokes each, wings beating
          ctx.strokeStyle = 'rgba(30,28,26,0.75)'
          ctx.lineCap = 'round'
          for (const b of birds) {
            b.x += b.v * dt
            if (b.x > w + 20) b.x = -20
            const flap = Math.sin(t * 5 + b.p) * b.s * 0.5
            ctx.lineWidth = 1.3
            ctx.beginPath()
            ctx.moveTo(b.x - b.s, b.y - flap)
            ctx.quadraticCurveTo(b.x - b.s * 0.4, b.y - b.s * 0.2, b.x, b.y)
            ctx.quadraticCurveTo(b.x + b.s * 0.4, b.y - b.s * 0.2, b.x + b.s, b.y - flap)
            ctx.stroke()
          }
          // ink blooming from each new batch
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const n = Math.max(1, Math.min(3, Math.round(Math.log10(l.size + 10) - 3)))
            for (let i = 0; i < n; i++) drops.push({ x: w * rand(0.05, 0.95), y: h * rand(0.1, 0.9), age: 0, r: rand(26, 60) * (1 + l.intensity * 0.2), seed: Math.random() * 10 })
          }
          drops = drops.filter((d) => {
            d.age += dt
            if (d.age > 6) return false
            const k = Math.sqrt(Math.min(1, d.age / 2.2))
            const fade = Math.min(1, (6 - d.age) / 2.5)
            for (let j = 0; j < 7; j++) {
              const a = d.seed + j * 0.9
              const rr = d.r * k * (0.45 + 0.35 * Math.abs(Math.sin(a * 3)))
              const ox = Math.cos(a) * d.r * k * 0.35
              const oy = Math.sin(a * 1.3) * d.r * k * 0.3
              const g = ctx.createRadialGradient(d.x + ox, d.y + oy, 0, d.x + ox, d.y + oy, rr)
              g.addColorStop(0, `rgba(20,20,24,${0.22 * fade})`)
              g.addColorStop(0.7, `rgba(20,20,24,${0.12 * fade})`)
              g.addColorStop(1, 'rgba(20,20,24,0)')
              ctx.fillStyle = g
              ctx.beginPath()
              ctx.arc(d.x + ox, d.y + oy, rr, 0, TAU)
              ctx.fill()
            }
            return true
          })
        }
      }
    },
    1,
    24
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- 深海

/**
 * The deep sea: light beams from the surface sway over dark water, marine
 * snow sinks, plankton glows, jellyfish pulse upward and bubbles rise (more
 * with usage); new usage releases a burst of bubbles and a glow.
 */
export function Abyss(p: SceneProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const lastPulse = useRef(0)
  useScene(
    ref,
    p.level,
    live,
    () => {
      let snow: { x: number; y: number; v: number; r: number }[] = []
      let glowers: { x: number; y: number; p: number; r: number; hue: number }[] = []
      let bubbles: { x: number; y: number; v: number; r: number; p: number }[] = []
      let jellies: { x: number; y: number; s: number; p: number; hue: number }[] = []
      let t = 0
      let acc = 0
      return {
        init(w, h) {
          snow = Array.from({ length: Math.round((w * h) / 9000) }, () => ({ x: Math.random() * w, y: Math.random() * h, v: rand(4, 14), r: rand(0.5, 1.6) }))
          glowers = Array.from({ length: Math.round((w * h) / 22000) }, () => ({ x: Math.random() * w, y: h * rand(0.3, 1), p: Math.random() * TAU, r: rand(1, 2.4), hue: Math.random() }))
          jellies = [
            { x: w * 0.82, y: h * 0.62, s: Math.max(26, h * 0.05), p: 0, hue: 0 },
            { x: w * 0.12, y: h * 0.78, s: Math.max(18, h * 0.035), p: 2, hue: 1 },
            { x: w * 0.46, y: h * 0.9, s: Math.max(14, h * 0.028), p: 4, hue: 0.5 }
          ]
          bubbles = []
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const glow = 0.5 + l.vivid * 0.7
          const sea = ctx.createLinearGradient(0, 0, 0, h)
          sea.addColorStop(0, '#0b4f73')
          sea.addColorStop(0.3, '#06304e')
          sea.addColorStop(1, '#010813')
          ctx.globalCompositeOperation = 'source-over'
          ctx.globalAlpha = 1
          ctx.fillStyle = sea
          ctx.fillRect(0, 0, w, h)
          // beams from the surface
          ctx.globalCompositeOperation = 'lighter'
          for (let i = 0; i < 7; i++) {
            const x0 = w * (0.08 + i * 0.14) + Math.sin(t * 0.18 + i * 1.7) * w * 0.03
            const bw = w * (0.025 + 0.02 * Math.abs(Math.sin(i * 2.3)))
            const len = h * (0.7 + 0.2 * Math.sin(i))
            const slant = len * 0.28
            const g = ctx.createLinearGradient(0, 0, 0, len)
            const a = (0.1 + 0.06 * Math.sin(t * 0.6 + i * 1.3)) * glow
            g.addColorStop(0, `rgba(160,230,255,${a})`)
            g.addColorStop(1, 'rgba(160,230,255,0)')
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.moveTo(x0 - bw / 2, 0)
            ctx.lineTo(x0 + bw / 2, 0)
            ctx.lineTo(x0 + slant + bw * 1.8, len)
            ctx.lineTo(x0 + slant - bw * 1.8, len)
            ctx.closePath()
            ctx.fill()
          }
          // the surface shimmering above
          ctx.strokeStyle = `rgba(200,245,255,${0.12 * glow})`
          ctx.lineWidth = 1
          for (let k = 0; k < 4; k++) {
            ctx.beginPath()
            for (let x = 0; x <= w; x += 12) {
              const y = 6 + k * 9 + Math.sin(x * 0.02 + t * (1 + k * 0.3) + k) * 4
              if (x) ctx.lineTo(x, y)
              else ctx.moveTo(x, y)
            }
            ctx.stroke()
          }
          // marine snow
          ctx.fillStyle = 'rgba(220,240,255,0.35)'
          for (const s of snow) {
            s.y += s.v * dt
            s.x += Math.sin(t * 0.5 + s.y * 0.01) * 4 * dt
            if (s.y > h) {
              s.y = -4
              s.x = Math.random() * w
            }
            ctx.fillRect(s.x, s.y, s.r, s.r)
          }
          // plankton glowing
          const flash = Math.max(0, 1 - since(l) / 1.6)
          for (const g of glowers) {
            const a = (0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.4 + g.p)) + flash * 0.6) * glow
            const rr = g.r * 4
            const grd = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, rr)
            const c = g.hue < 0.6 ? '70,240,255' : '125,255,200'
            grd.addColorStop(0, `rgba(${c},${Math.min(1, a)})`)
            grd.addColorStop(1, `rgba(${c},0)`)
            ctx.fillStyle = grd
            ctx.fillRect(g.x - rr, g.y - rr, rr * 2, rr * 2)
            g.x += Math.sin(t * 0.3 + g.p) * 3 * dt
            g.y -= 2 * dt
            if (g.y < h * 0.25) g.y = h
          }
          // jellyfish: a pulsing bell with trailing tentacles, drifting up
          for (const j of jellies) {
            const beat = Math.sin(t * 1.6 + j.p)
            j.y -= (6 + Math.max(0, beat) * 10) * dt * (1 + l.intensity * 0.2)
            j.x += Math.sin(t * 0.25 + j.p) * 4 * dt
            if (j.y < -j.s * 4) {
              j.y = h + j.s * 2
              j.x = w * rand(0.05, 0.95)
            }
            const bw = j.s * (1 + 0.12 * beat)
            const bh = j.s * (0.75 - 0.1 * beat)
            const col = j.hue < 0.4 ? '255,120,220' : j.hue < 0.8 ? '120,200,255' : '180,140,255'
            const bell = ctx.createRadialGradient(j.x, j.y, 0, j.x, j.y, bw)
            bell.addColorStop(0, `rgba(${col},${0.5 * glow})`)
            bell.addColorStop(1, `rgba(${col},0.04)`)
            ctx.fillStyle = bell
            ctx.beginPath()
            ctx.ellipse(j.x, j.y, bw, bh, 0, Math.PI, 0)
            ctx.quadraticCurveTo(j.x, j.y + bh * 0.25, j.x - bw, j.y)
            ctx.fill()
            ctx.strokeStyle = `rgba(${col},${0.35 * glow})`
            ctx.lineWidth = 1
            for (let k = 0; k < 5; k++) {
              const x0 = j.x - bw * 0.7 + (k / 4) * bw * 1.4
              ctx.beginPath()
              ctx.moveTo(x0, j.y)
              for (let s = 1; s <= 8; s++) ctx.lineTo(x0 + Math.sin(t * 2 + k + s * 0.7 + j.p) * 3, j.y + s * j.s * 0.28)
              ctx.stroke()
            }
          }
          // bubbles, more while usage is intense, a burst on new usage
          acc += dt * [0.6, 1.5, 3, 6][l.intensity]
          while (acc > 1) {
            acc -= 1
            bubbles.push({ x: Math.random() * w, y: h + 6, v: rand(30, 70), r: rand(1.5, 4), p: Math.random() * TAU })
          }
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            const cx = w * rand(0.3, 0.8)
            for (let i = 0; i < 22; i++) bubbles.push({ x: cx + rand(-40, 40), y: h + rand(0, 60), v: rand(60, 140), r: rand(2, 6), p: Math.random() * TAU })
          }
          ctx.globalCompositeOperation = 'source-over'
          bubbles = bubbles.filter((b) => {
            b.y -= b.v * dt
            b.x += Math.sin(t * 3 + b.p) * 12 * dt
            if (b.y < -10) return false
            ctx.strokeStyle = 'rgba(210,245,255,0.55)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.arc(b.x, b.y, b.r, 0, TAU)
            ctx.stroke()
            ctx.fillStyle = 'rgba(255,255,255,0.5)'
            ctx.fillRect(b.x - b.r * 0.4, b.y - b.r * 0.5, 1.2, 1.2)
            return true
          })
        }
      }
    },
    0.75
  )
  return <canvas ref={ref} className="scene-canvas" />
}
