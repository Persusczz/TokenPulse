import { useEffect, useMemo, useRef, useState } from 'react'
import { placeOf, sunTimes, type Place } from '@shared/astro'
import { dayLabel, mix, nextLabel, rgbText, seasonAt, skyAt, smooth, uiColors, type Season, type SeasonState, type SkyState } from '@shared/daycycle'
import { useApp, useSource } from '../state'
import { DayLife, dayStatus } from './DayLife'
import { rand, TAU, useLive, useScene, type SceneProps } from './ThemeScenes'
import { drawMoon } from './ThemeScenes3'

// ---------------------------------------------------------------- the clock

/**
 * The time the day/night theme shows: the real clock, or a time-lapse that
 * runs a whole day in a few dozen seconds. Screenshots can pin a time with
 * window.__tpDayAt (epoch ms); it then runs on from there in real time.
 */
let warp: { real: number; from: number; rate: number; until: number } | null = null
const warpSubs = new Set<() => void>()
const tell = () => warpSubs.forEach((f) => f())
declare global {
  interface Window {
    __tpDayAt?: number
    __tpDayAtSet?: number
    /** pins the theme's clock (screenshots); null goes back to the real one */
    __tpSetDay?: (at: number | null) => void
    /** pins the season (screenshots) */
    __tpSeason?: Season
    /** sets off something in the sky now: balloon, plane, shower, rainbow, aurora, sat, jump, nova (screenshots) */
    __tpDayEvent?: (name: string) => void
  }
}
window.__tpSetDay = (at) => {
  window.__tpDayAt = at ?? undefined
  window.__tpDayAtSet = Date.now()
  tell()
}

export function dayNow(): number {
  const real = Date.now()
  if (warp) {
    if (real < warp.until) return warp.from + (real - warp.real) * warp.rate
    warp = null
    setTimeout(tell, 0)
  }
  if (window.__tpDayAt) return window.__tpDayAt + (real - (window.__tpDayAtSet ?? real))
  return real
}

/** a whole day in `seconds`, starting now */
export function startTimelapse(seconds = 40): void {
  const now = Date.now()
  warp = { real: now, from: dayNow(), rate: 86_400 / seconds, until: now + seconds * 1000 }
  tell()
}

export function stopTimelapse(): void {
  warp = null
  tell()
}

export function useTimelapse(): boolean {
  const [on, setOn] = useState(!!warp)
  useEffect(() => {
    const f = () => setOn(!!warp && Date.now() < warp.until)
    warpSubs.add(f)
    return () => void warpSubs.delete(f)
  }, [])
  return on
}

export function usePlace(): Place {
  const { settings } = useApp()
  const p = settings?.skyPlace
  return useMemo(() => placeOf(p), [p?.lat, p?.lon, p?.name]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The sky now, refreshed every `ms` (four times a second while a time-lapse runs) */
export function useSky(ms: number, on = true): SkyState {
  const place = usePlace()
  const lapse = useTimelapse()
  const [s, setS] = useState(() => skyAt(dayNow(), place))
  // a time-lapse starting or stopping, or the clock pinned: show it at once
  useEffect(() => {
    const f = () => setS(skyAt(dayNow(), place))
    warpSubs.add(f)
    return () => void warpSubs.delete(f)
  }, [place])
  useEffect(() => {
    if (!on) return
    setS(skyAt(dayNow(), place))
    const t = setInterval(() => setS(skyAt(dayNow(), place)), lapse ? 250 : ms)
    return () => clearInterval(t)
  }, [place, ms, lapse, on])
  return s
}

const PALETTE_KEYS = Object.keys(uiColors(skyAt(0, { name: '', lat: 0, lon: 0 })))

/**
 * With the 昼夜 pack on, the app's own colours follow the sky: written onto
 * <html> as they change (every 20 s, smoothly, or fast during a time-lapse),
 * removed again when the pack goes. Codex alone keeps its own accent.
 */
export function useDayPalette(): void {
  const { settings } = useApp()
  const source = useSource()
  const on = settings?.themePack === 'daylight'
  const sky = useSky(20_000, on)
  useEffect(() => {
    const st = document.documentElement.style
    if (!on) {
      for (const k of PALETTE_KEYS) st.removeProperty(k)
      return
    }
    for (const [k, v] of Object.entries(uiColors(sky))) {
      if ((source === 'codex' || source === 'workbuddy') && /^--(accent|s1|q4|q5)/.test(k)) st.removeProperty(k)
      else st.setProperty(k, v)
    }
  }, [on, sky, source])
  useEffect(() => () => PALETTE_KEYS.forEach((k) => document.documentElement.style.removeProperty(k)), [])
}

// ---------------------------------------------------------------- the scene

/** the season at t: the real one, or the one a screenshot pinned */
export function seasonNow(t: number, lat: number): SeasonState {
  const pinned = window.__tpSeason
  if (!pinned) return seasonAt(t, lat)
  const real = seasonAt(t, lat)
  return { ...real, season: pinned, k: { spring: 0, summer: 0, autumn: 0, winter: 0, [pinned]: 1 } }
}

/** what autumn and spring do to the land's five layers, far to near */
const AUTUMN = ['#9a6a3a', '#b0602a', '#a2482a', '#6e3a1e', '#2a1a10']
const SPRING = ['#7fa0c0', '#6b9a7a', '#4f8a4a', '#3a6a34', '#1a2e1a']

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const vnoise = (x: number, seed: number) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i, seed) + (hash(i + 1, seed) - hash(i, seed)) * u
}
const fbm = (x: number, seed: number) => vnoise(x, seed) * 0.55 + vnoise(x * 2.1, seed + 7) * 0.27 + vnoise(x * 4.3, seed + 13) * 0.13 + vnoise(x * 9.1, seed + 29) * 0.05

function sprite(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [o, col] of stops) gr.addColorStop(o, col)
  g.fillStyle = gr
  g.fillRect(0, 0, size, size)
  return c
}

/** degrees of sky across the window's width */
const FOV = 200
const SIDEREAL = TAU / 86_164

interface Star {
  r: number
  a: number
  size: number
  tw: number
  warm: number
}
interface Cloud {
  x: number
  y: number
  s: number
  v: number
  puffs: { dx: number; dy: number; r: number }[]
}
interface Flock {
  x: number
  y: number
  vx: number
  vy: number
  birds: { dx: number; dy: number; ph: number; s: number }[]
}

/**
 * A mountain lake through a real day: the sky, the sun and the moon (where
 * they really are for the chosen place), stars turning around the pole with
 * the Milky Way, clouds lit from below at dawn and dusk, ridges hazed by
 * distance and rimmed by low sun, the whole sky mirrored in the lake with a
 * glitter path, dawn mist, and window lights coming on along the shore as it
 * gets dark (and going out late at night). New usage sends a flock of birds
 * up from the shore by day, a shooting star by night; busier usage, more wind.
 */
export function DayCycleScene(p: SceneProps & { place: Place; quiet?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const live = useLive(p)
  const placeRef = useRef(p.place)
  placeRef.current = p.place
  const lastPulse = useRef(0)
  const lifeRef = useRef<DayLife | null>(null)
  // today's tokens passing a milestone: a rainbow by day, an aurora by night
  useEffect(() => {
    // a preview tile's sky keeps to itself
    if (p.quiet) return
    const nova = () => lifeRef.current?.force('nova')
    const fire = (name: string) => lifeRef.current?.force(name)
    document.addEventListener('tp-nova', nova)
    // the backdrop's scene owns the hook; a preview tile takes it only while it plays
    const before = window.__tpDayEvent
    window.__tpDayEvent = fire
    return () => {
      document.removeEventListener('tp-nova', nova)
      if (window.__tpDayEvent === fire) window.__tpDayEvent = before
    }
  }, [p.quiet])
  useScene(
    ref,
    p.level,
    live,
    () => {
      let W = 0
      let H = 0
      let hy = 0
      let shore = 0
      let poleX = 0
      let poleY = 0
      let ridges: { path: Path2D; mirror: Path2D; pts: [number, number][] }[] = []
      let ground: Path2D | null = null
      let pines: { x: number; base: number; ht: number; path: Path2D; ph: number }[] = []
      let cabin = { x: 0, y: 0, w: 0, h: 0 }
      const life = new DayLife(!p.quiet)
      lifeRef.current = life
      let season: SeasonState | null = null
      let stars: Star[] = []
      let dust: Star[] = []
      let clouds: Cloud[] = []
      let lights: { x: number; y: number; k: number; late: number; s: number }[] = []
      let flocks: Flock[] = []
      let meteors: { x: number; y: number; vx: number; vy: number; life: number }[] = []
      let puff: HTMLCanvasElement | null = null
      let warm: HTMLCanvasElement | null = null
      let soft: HTMLCanvasElement | null = null
      let layer: HTMLCanvasElement | null = null
      let lctx: CanvasRenderingContext2D | null = null
      let sky: SkyState | null = null
      let skyAtMs = 0
      let t = 0
      let nextMeteor = 8
      let nextFlock = 6

      const sunXY = (az: number, alt: number) => {
        const facing = placeRef.current.lat >= 0 ? 180 : 0
        const d = ((az - facing + 540) % 360) - 180
        const k = Math.max(-0.3, Math.min(1.08, alt / 68))
        return [W * (0.5 + d / FOV), hy - k * (hy - H * 0.07)] as const
      }

      const spawnFlock = (fromShore: boolean) => {
        const dir = Math.random() < 0.5 ? 1 : -1
        const n = 5 + Math.floor(Math.random() * 7)
        flocks.push({
          x: fromShore ? rand(0.2, 0.8) * W : dir > 0 ? -60 : W + 60,
          y: fromShore ? shore - 10 : rand(0.12, 0.42) * H,
          vx: dir * rand(38, 62),
          vy: fromShore ? -rand(26, 40) : rand(-4, 4),
          birds: Array.from({ length: n }, (_, i) => ({ dx: -dir * (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 12 + rand(-3, 3), dy: Math.ceil(i / 2) * 7 + rand(-2, 2), ph: Math.random() * TAU, s: rand(3.2, 5) }))
        })
      }
      const spawnMeteor = () => {
        const a = rand(0.3, 0.7)
        meteors.push({ x: rand(0.1, 0.9) * W, y: rand(0.04, 0.3) * H, vx: Math.cos(a) * 640 * (Math.random() < 0.5 ? 1 : -1), vy: Math.sin(a) * 640, life: 1 })
      }

      return {
        init(w, h) {
          W = w
          H = h
          hy = Math.round(h * 0.7)
          shore = Math.round(h * 0.9)
          poleX = w * 0.5
          poleY = hy + h * 0.95
          puff = sprite(96, [
            [0, 'rgba(255,255,255,1)'],
            [0.45, 'rgba(255,255,255,0.75)'],
            [1, 'rgba(255,255,255,0)']
          ])
          warm = sprite(48, [
            [0, 'rgba(255,214,140,1)'],
            [0.25, 'rgba(255,180,90,0.55)'],
            [1, 'rgba(255,160,60,0)']
          ])
          soft = sprite(64, [
            [0, 'rgba(255,255,255,0.5)'],
            [1, 'rgba(255,255,255,0)']
          ])
          layer = document.createElement('canvas')
          layer.width = Math.max(1, Math.ceil(w / 2))
          layer.height = Math.max(1, Math.ceil(hy / 2))
          lctx = layer.getContext('2d')!
          // ridges far to near: peaky mountains, rounder hills, a tree line
          const specs = [
            { base: 0.07, amp: 0.17, f: 3, seed: 1, pow: 1.6 },
            { base: 0.05, amp: 0.1, f: 4.5, seed: 2, pow: 1.2 },
            { base: 0.025, amp: 0.06, f: 7, seed: 3, pow: 1 },
            { base: 0.008, amp: 0.028, f: 11, seed: 4, pow: 1 }
          ]
          ridges = specs.map((sp, li) => {
            const pts: [number, number][] = []
            for (let x = -8; x <= w + 8; x += 6) {
              let y = hy - h * (sp.base + sp.amp * fbm((x / w) * sp.f, sp.seed) ** sp.pow)
              // pines along the nearest ridge
              if (li === 3) y -= hash(Math.floor(x / 6), 9) > 0.35 ? (x % 12 === 0 ? 5 + hash(x, 3) * 7 : 1) : 0
              pts.push([x, y])
            }
            const path = new Path2D()
            const mirror = new Path2D()
            path.moveTo(-8, hy + 1)
            mirror.moveTo(-8, hy - 1)
            for (const [x, y] of pts) {
              path.lineTo(x, y)
              mirror.lineTo(x, 2 * hy - y)
            }
            path.lineTo(w + 8, hy + 1)
            mirror.lineTo(w + 8, hy - 1)
            path.closePath()
            mirror.closePath()
            return { path, mirror, pts }
          })
          // the near shore with tall pines at both edges and a cabin
          ground = new Path2D()
          ground.moveTo(-10, h + 10)
          for (let x = -10; x <= w + 10; x += 10) ground.lineTo(x, shore + 4 + Math.sin(x * 0.011) * 5 + Math.sin(x * 0.037 + 1) * 3)
          ground.lineTo(w + 10, h + 10)
          ground.closePath()
          // each pine is its own path around its foot, so it can sway in the wind
          const pine = (cx: number, base: number, ht: number) => {
            const path = new Path2D()
            const tiers = 6
            for (let i = 0; i < tiers; i++) {
              const y0 = -(ht * i) / tiers - ht * 0.12
              const half = (ht * 0.32 * (tiers - i)) / tiers
              path.moveTo(-half, y0)
              path.lineTo(0, y0 - ht * 0.34)
              path.lineTo(half, y0)
              path.closePath()
            }
            path.rect(-ht * 0.025, -ht * 0.14, ht * 0.05, ht * 0.15)
            pines.push({ x: cx, base, ht, path, ph: Math.random() * TAU })
          }
          const tall = Math.min(h * 0.36, 300)
          pines = []
          ;[
            [0.025, 1],
            [0.07, 0.78],
            [0.11, 0.6],
            [0.9, 0.7],
            [0.95, 0.95],
            [0.985, 0.62]
          ].forEach(([fx, k]) => pine(w * fx, shore + 8, tall * k))
          cabin = { x: w * 0.8, y: shore - h * 0.045, w: h * 0.07, h: h * 0.045 }
          ground.rect(cabin.x, cabin.y, cabin.w, cabin.h)
          ground.rect(cabin.x + cabin.w * 0.68, cabin.y - cabin.h * 0.75, cabin.w * 0.12, cabin.h * 0.5)
          ground.moveTo(cabin.x - cabin.w * 0.12, cabin.y)
          ground.lineTo(cabin.x + cabin.w / 2, cabin.y - cabin.h * 0.6)
          ground.lineTo(cabin.x + cabin.w * 1.12, cabin.y)
          ground.closePath()
          // stars on an annulus around the pole below the horizon, so turning never empties the sky
          const rMin = poleY - hy
          const rMax = Math.hypot(w / 2, poleY)
          const area = Math.PI * (rMax * rMax - rMin * rMin)
          const n = Math.min(5200, Math.round(area / 1500))
          stars = Array.from({ length: n }, () => ({ r: Math.sqrt(rand(rMin * rMin, rMax * rMax)), a: Math.random() * TAU, size: Math.random() < 0.06 ? rand(1.6, 2.4) : rand(0.6, 1.4), tw: Math.random() * TAU, warm: Math.random() }))
          // the Milky Way: dust along one band of the sphere
          dust = Array.from({ length: Math.min(4000, Math.round(n * 0.8)) }, () => {
            const along = Math.random() * TAU
            const off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.11
            return { r: rMin + (rMax - rMin) * (0.55 + off + 0.25 * Math.sin(along * 2)), a: along, size: rand(0.5, 1.1), tw: Math.random() * TAU, warm: Math.random() }
          })
          clouds = Array.from({ length: 8 }, (_, i) => {
            const s = rand(0.7, 1.4) * Math.min(1, w / 1400)
            return {
              x: Math.random() * (w + 400) - 200,
              y: H * (0.06 + (i / 8) * 0.34) + rand(-12, 12),
              s,
              v: rand(5, 13) * (0.6 + i / 10),
              puffs: Array.from({ length: 9 + Math.floor(Math.random() * 6) }, (_, k) => ({ dx: (k - 6) * 26 * s + rand(-10, 10), dy: -Math.abs(Math.sin(k * 0.7)) * 22 * s + rand(-6, 6), r: rand(34, 62) * s }))
            }
          })
          lights = []
          for (let i = 0; i < 26; i++) {
            const side = i < 18 ? rand(0.04, 0.34) : rand(0.58, 0.74)
            lights.push({ x: side * w, y: hy - rand(2, 9), k: hash(i, 21), late: hash(i, 22), s: rand(0.7, 1.3) })
          }
          flocks = []
          meteors = []
          sky = null
          season = null
          life.init({ w, h, hy, shore, cabin, puff: puff!, soft: soft!, warm: warm! })
        },
        draw(ctx, w, h, dt, l) {
          t += dt
          const nowMs = dayNow()
          // the sky changes slowly: worked out twice a second (every frame in a time-lapse)
          if (!sky || !season || Math.abs(nowMs - skyAtMs) > 500) {
            sky = skyAt(nowMs, placeRef.current)
            season = seasonNow(nowMs, placeRef.current.lat)
            skyAtMs = nowMs
          }
          const s = sky
          const sea = season
          const wind = 1 + l.intensity * 0.45
          const [sx, sy] = sunXY(s.az, s.alt)
          const [mx, my] = sunXY(s.moon.az, s.moon.alt)
          const dayK = 1 - s.dark
          life.update(dt, s, sea, l, wind, sx)
          // the land in the season's colours: autumn hills, fresh spring green, wintry far ridges
          const land = s.land.map((c, i) => {
            let out = c
            if (sea.k.autumn > 0.01) out = mix(out, AUTUMN[i], sea.k.autumn * [0.16, 0.3, 0.4, 0.3, 0][i] * (0.35 + 0.65 * dayK))
            if (sea.k.spring > 0.01) out = mix(out, SPRING[i], sea.k.spring * [0.1, 0.18, 0.25, 0.2, 0][i] * (0.35 + 0.65 * dayK))
            if (sea.k.winter > 0.01) out = mix(out, mix('#c8d4e6', s.zenith, 0.3 + 0.5 * s.dark), sea.k.winter * [0.3, 0.22, 0.12, 0.05, 0][i])
            return out
          })

          // ---- sky
          const g = ctx.createLinearGradient(0, 0, 0, hy)
          g.addColorStop(0, s.zenith)
          g.addColorStop(0.55, s.middle)
          g.addColorStop(1, s.horizon)
          ctx.fillStyle = g
          ctx.fillRect(0, 0, w, hy + 2)
          // the light around the sun: a wide warm band along the horizon when it is low
          if (s.glow > 0.01) {
            const gx = Math.max(-w * 0.3, Math.min(w * 1.3, sx))
            const gy = Math.min(sy, hy)
            const R = w * (0.35 + 0.5 * (1 - smooth(0, 30, s.alt)))
            const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, R)
            rg.addColorStop(0, `rgba(${rgbText(s.sun)},${(0.55 * s.glow).toFixed(3)})`)
            rg.addColorStop(0.35, `rgba(${rgbText(mix(s.sun, s.horizon, 0.5))},${(0.22 * s.glow).toFixed(3)})`)
            rg.addColorStop(1, `rgba(${rgbText(s.horizon)},0)`)
            ctx.fillStyle = rg
            ctx.fillRect(0, 0, w, hy + 2)
          }
          // the belt of Venus: a pink band opposite the sun in twilight
          const belt = smooth(-7, -2, s.alt) * (1 - smooth(1, 6, s.alt))
          if (belt > 0.01) {
            const bx = sx < w / 2 ? w * 0.85 : w * 0.15
            const bg = ctx.createRadialGradient(bx, hy, 0, bx, hy, w * 0.55)
            bg.addColorStop(0, `rgba(255,150,170,${(0.28 * belt).toFixed(3)})`)
            bg.addColorStop(1, 'rgba(255,150,170,0)')
            ctx.fillStyle = bg
            ctx.fillRect(0, 0, w, hy + 2)
          }

          // ---- stars and the Milky Way, turning around the pole with the real sky
          const moonLight = s.moon.alt > 0 ? s.moon.fraction : 0
          if (s.stars > 0.01) {
            const turn = SIDEREAL * (nowMs / 1000) * (placeRef.current.lat >= 0 ? 1 : -1)
            ctx.fillStyle = '#dfe6ff'
            const way = s.stars * (1 - moonLight * 0.7) * 0.5
            if (way > 0.02) {
              for (const d of dust) {
                const a = d.a + turn
                const x = poleX + d.r * Math.cos(a)
                const y = poleY + d.r * Math.sin(a)
                if (x < 0 || x > w || y < 0 || y > hy) continue
                ctx.globalAlpha = way * (0.35 + 0.35 * d.warm) * Math.min(1, (hy - y) / (h * 0.12))
                ctx.fillRect(x, y, d.size, d.size)
              }
            }
            for (const st of stars) {
              const a = st.a + turn
              const x = poleX + st.r * Math.cos(a)
              const y = poleY + st.r * Math.sin(a)
              if (x < 0 || x > w || y < 0 || y > hy) continue
              const tw = 0.6 + 0.4 * Math.sin(t * (1.3 + st.warm) + st.tw)
              // stars fade into the haze near the horizon
              ctx.globalAlpha = Math.min(1, s.stars * tw * Math.min(1, (hy - y) / (h * 0.1)) * (st.size > 1.5 ? 1 : 0.8))
              ctx.fillStyle = st.warm > 0.85 ? '#ffe2c0' : st.warm < 0.12 ? '#cfe0ff' : '#f4f6ff'
              ctx.fillRect(x, y, st.size, st.size)
            }
            ctx.globalAlpha = 1
          }

          life.drawAurora(ctx, l.vivid)

          // ---- the moon: pale by day, with a halo at night
          if (s.moon.alt > -3 && mx > -60 && mx < w + 60) {
            const r = Math.max(10, Math.min(w, h) * 0.024)
            if (s.dark > 0.3 && soft) {
              ctx.globalAlpha = 0.5 * s.dark * (0.4 + s.moon.fraction)
              ctx.drawImage(soft, mx - r * 7, my - r * 7, r * 14, r * 14)
            }
            ctx.globalAlpha = 0.35 + 0.65 * s.dark
            drawMoon(ctx, mx, my, r, s.moon.phase, true)
            ctx.globalAlpha = 1
          }

          // ---- the sun, with rays while it is low
          if (s.alt > -2) {
            const r = Math.max(14, Math.min(w, h) * 0.03)
            const halo = ctx.createRadialGradient(sx, sy, r * 0.6, sx, sy, r * 7)
            halo.addColorStop(0, `rgba(${rgbText(s.sun)},${(0.75 * Math.min(1, s.glow)).toFixed(3)})`)
            halo.addColorStop(1, `rgba(${rgbText(s.sun)},0)`)
            ctx.fillStyle = halo
            ctx.fillRect(sx - r * 7, sy - r * 7, r * 14, r * 14)
            const rays = smooth(-1, 3, s.alt) * (1 - smooth(14, 26, s.alt)) * l.vivid
            if (rays > 0.02) {
              ctx.save()
              ctx.globalCompositeOperation = 'lighter'
              for (let i = 0; i < 11; i++) {
                const a = (i / 11) * TAU + t * 0.03 + Math.sin(t * 0.2 + i) * 0.04
                const len = Math.max(w, h) * (0.5 + 0.3 * hash(i, 5))
                const wid = 0.035 + 0.03 * hash(i, 6)
                const rg = ctx.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len)
                rg.addColorStop(0, `rgba(${rgbText(s.sun)},${(0.13 * rays).toFixed(3)})`)
                rg.addColorStop(1, `rgba(${rgbText(s.sun)},0)`)
                ctx.fillStyle = rg
                ctx.beginPath()
                ctx.moveTo(sx, sy)
                ctx.lineTo(sx + Math.cos(a - wid) * len, sy + Math.sin(a - wid) * len)
                ctx.lineTo(sx + Math.cos(a + wid) * len, sy + Math.sin(a + wid) * len)
                ctx.closePath()
                ctx.fill()
              }
              ctx.restore()
            }
            const disc = ctx.createRadialGradient(sx - r * 0.2, sy - r * 0.2, 0, sx, sy, r)
            disc.addColorStop(0, mix(s.sun, '#ffffff', 0.7))
            disc.addColorStop(1, s.sun)
            ctx.fillStyle = disc
            ctx.beginPath()
            // flattened a little by the air near the horizon
            ctx.ellipse(sx, sy, r, r * (s.alt < 3 ? 0.88 : 1), 0, 0, TAU)
            ctx.fill()
          }

          // ---- clouds, lit from below when the sun is low, silver at night
          if (layer && lctx && puff) {
            const L = layer
            lctx.globalCompositeOperation = 'source-over'
            lctx.clearRect(0, 0, L.width, L.height)
            for (const c of clouds) {
              c.x += c.v * wind * dt
              if (c.x - 260 * c.s > w) c.x = -260 * c.s - Math.random() * 200
              for (const pf of c.puffs) {
                const R = pf.r
                lctx.drawImage(puff, (c.x + pf.dx - R) / 2, (c.y + pf.dy - R) / 2, R, R)
              }
            }
            lctx.globalCompositeOperation = 'source-atop'
            const low = 1 - smooth(4, 16, s.alt)
            const cg = lctx.createLinearGradient(0, 0, 0, L.height)
            cg.addColorStop(0, low > 0.5 ? s.cloudShade : s.cloudLit)
            cg.addColorStop(1, low > 0.5 ? s.cloudLit : mix(s.cloudLit, s.cloudShade, 0.45))
            lctx.fillStyle = cg
            lctx.fillRect(0, 0, L.width, L.height)
            ctx.globalAlpha = 0.5 + 0.38 * dayK
            ctx.drawImage(L, 0, 0, w, hy)
            ctx.globalAlpha = 1
          }
          life.drawWeather(ctx, dt, s, l.vivid)
          life.drawAir(ctx, dt, s, sx, wind)

          // ---- the land: ridges hazed by distance, the low sun catching their tops
          const rim = smooth(-2, 2, s.alt) * (1 - smooth(10, 22, s.alt))
          // snow on the highest peaks all year, further down in winter
          const snowLine = [h * (0.07 + 0.17 * (0.8 - 0.32 * sea.k.winter)), h * (0.05 + 0.1 * (0.78 - 0.4 * sea.k.winter))]
          const snow = mix('#f4f7ff', mix(s.zenith, '#c8d4f0', 0.4), s.dark * 0.75)
          ridges.forEach((r, i) => {
            ctx.fillStyle = land[i]
            ctx.fill(r.path)
            if (i < 2 && (i === 0 || sea.k.winter > 0.05)) {
              ctx.save()
              ctx.clip(r.path)
              ctx.globalAlpha = i === 0 ? 0.55 + 0.4 * sea.k.winter : sea.k.winter * 0.85
              ctx.fillStyle = snow
              ctx.fillRect(0, 0, w, hy - snowLine[i])
              ctx.restore()
              ctx.globalAlpha = 1
            }
            if (rim > 0.02 && i < 3) {
              const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, w * 0.7)
              rg.addColorStop(0, `rgba(${rgbText(s.sun)},${(0.7 * rim * (1 - i * 0.25)).toFixed(3)})`)
              rg.addColorStop(1, `rgba(${rgbText(s.sun)},0)`)
              ctx.strokeStyle = rg
              ctx.lineWidth = 1.6
              ctx.beginPath()
              r.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
              ctx.stroke()
            }
            // mist settles in the valleys between the ridges at dawn
            if (s.mist > 0.02 && i < 3) {
              const top = hy - h * (0.04 + 0.03 * (2 - i))
              const mg = ctx.createLinearGradient(0, top, 0, hy)
              mg.addColorStop(0, `rgba(${rgbText(mix(s.horizon, '#ffffff', 0.4))},0)`)
              mg.addColorStop(1, `rgba(${rgbText(mix(s.horizon, '#ffffff', 0.4))},${(0.45 * s.mist).toFixed(3)})`)
              ctx.fillStyle = mg
              ctx.fillRect(0, top, w, hy - top)
            }
          })

          // ---- the lake: the sky mirrored, the ridges upside down, a glitter path under the sun or moon
          const lg = ctx.createLinearGradient(0, hy, 0, shore)
          lg.addColorStop(0, mix(s.horizon, s.middle, 0.35))
          lg.addColorStop(0.5, mix(s.middle, s.zenith, 0.5))
          lg.addColorStop(1, mix(s.zenith, '#000000', 0.35))
          ctx.fillStyle = lg
          // down to the bottom edge: the shore's wavy top must never leave a strip unpainted
          ctx.fillRect(0, hy, w, h - hy)
          ctx.globalAlpha = 0.72
          ridges.forEach((r, i) => {
            ctx.fillStyle = mix(land[i], s.zenith, 0.2)
            ctx.fill(r.mirror)
          })
          ctx.globalAlpha = 1
          // the reflection fades with depth
          const fade = ctx.createLinearGradient(0, hy, 0, shore)
          fade.addColorStop(0, 'rgba(0,0,0,0)')
          fade.addColorStop(1, `rgba(${rgbText(mix(s.zenith, '#000000', 0.5))},0.55)`)
          ctx.fillStyle = fade
          ctx.fillRect(0, hy, w, shore - hy + 2)
          const glitter = (x: number, color: string, k: number, width: number) => {
            if (k <= 0.01 || x < -100 || x > w + 100) return
            for (let i = 0; i < 46; i++) {
              const y = hy + 3 + (i / 46) ** 1.4 * (shore - hy - 6)
              const spread = width * (0.25 + 0.75 * ((y - hy) / (shore - hy)))
              const dx = (hash(i, 31) - 0.5) * 2 * spread + Math.sin(t * 1.7 + i) * 4
              const len = 6 + hash(i, 32) * 26 * (0.4 + (y - hy) / (shore - hy))
              ctx.globalAlpha = k * (0.35 + 0.65 * Math.max(0, Math.sin(t * (2 + hash(i, 33) * 3) + i * 1.3)))
              ctx.fillStyle = color
              ctx.fillRect(x + dx - len / 2, y, len, 1.4)
            }
            ctx.globalAlpha = 1
          }
          if (s.alt > -1) glitter(sx, mix(s.sun, '#ffffff', 0.35), Math.min(1, s.glow) * (s.alt < 25 ? 1 : 0.55), w * (0.03 + 0.06 * (1 - smooth(0, 30, s.alt))))
          if (s.moon.alt > 0 && s.dark > 0.4) glitter(mx, '#e8eeff', s.dark * (0.3 + 0.7 * s.moon.fraction), w * 0.025)
          // ripples drifting across
          ctx.strokeStyle = `rgba(${rgbText(mix(s.horizon, '#ffffff', 0.5))},${(0.05 + 0.06 * dayK).toFixed(3)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          for (let i = 0; i < 30; i++) {
            const y = hy + 6 + hash(i, 41) * (shore - hy - 10)
            const x = ((hash(i, 42) * w + t * (6 + i * 0.5) * wind) % (w + 120)) - 60
            const len = 18 + hash(i, 43) * 50 * ((y - hy) / (shore - hy) + 0.3)
            ctx.moveTo(x, y)
            ctx.lineTo(x + len, y)
          }
          ctx.stroke()
          // a bright seam where the far shore meets the water
          ctx.fillStyle = `rgba(${rgbText(mix(s.horizon, '#ffffff', 0.3))},${(0.25 + 0.2 * dayK).toFixed(3)})`
          ctx.fillRect(0, hy, w, 1)

          // ---- window lights along the far shore, reflected as long streaks
          if (s.lights > 0.01 && warm) {
            const solar = (((nowMs - sunTimes(nowMs, placeRef.current).noon) / 3_600_000 + 36) % 24 + 24) % 24
            // after one in the morning most of the houses have gone to sleep
            const sleepy = solar > 1 && solar < 5
            for (const L of lights) {
              const on = s.lights > L.k && !(sleepy && L.late > 0.3)
              if (!on) continue
              const a = Math.min(1, (s.lights - L.k) * 4) * (0.75 + 0.25 * Math.sin(t * 3 + L.k * 40))
              const r = 2.2 * L.s
              ctx.globalAlpha = a
              ctx.drawImage(warm, L.x - r * 4, L.y - r * 4, r * 8, r * 8)
              ctx.fillStyle = '#ffe6b0'
              ctx.fillRect(L.x - 0.8, L.y - 0.8, 1.6, 1.6)
              ctx.globalAlpha = a * 0.35
              ctx.drawImage(warm, L.x - r * 1.6 + Math.sin(t * 2 + L.k * 9) * 1.5, hy + 2, r * 3.2, (shore - hy) * 0.3)
            }
            ctx.globalAlpha = 1
          }

          life.drawLake(ctx, dt, s)

          // ---- the near shore, pines swaying (harder while usage is busy) and the cabin with its windows
          if (ground) {
            ctx.fillStyle = land[4]
            ctx.fill(ground)
            for (const pn of pines) {
              const lean = (Math.sin(t * 0.9 + pn.ph) * 0.012 + Math.sin(t * 2.3 + pn.ph * 2) * 0.004) * wind + (wind - 1) * 0.02
              ctx.save()
              ctx.setTransform(ctx.getTransform().translate(pn.x, pn.base).multiply(new DOMMatrix([1, 0, -lean, 1, 0, 0])))
              ctx.fill(pn.path)
              ctx.restore()
            }
            if (s.lights > 0.15 && warm) {
              const a = Math.min(1, (s.lights - 0.15) * 2)
              const wy = cabin.y + cabin.h * 0.35
              for (const fx of [0.22, 0.62]) {
                const wx = cabin.x + cabin.w * fx
                ctx.globalAlpha = a * 0.8
                ctx.drawImage(warm, wx - cabin.h * 0.6, wy - cabin.h * 0.6, cabin.h * 1.4, cabin.h * 1.4)
                ctx.globalAlpha = a
                ctx.fillStyle = '#ffd98a'
                ctx.fillRect(wx, wy, cabin.w * 0.16, cabin.h * 0.3)
              }
              ctx.globalAlpha = 1
            }
          }

          // ---- dawn mist drifting low over the water
          if (s.mist > 0.02 && soft) {
            for (let i = 0; i < 9; i++) {
              const x = ((hash(i, 51) * w + t * (8 + i) * wind) % (w + 400)) - 200
              const y = hy + (hash(i, 52) - 0.4) * (shore - hy) * 0.6
              ctx.globalAlpha = 0.5 * s.mist
              ctx.drawImage(soft, x - 220, y - 30, 440, 60)
            }
            ctx.globalAlpha = 1
          }

          // ---- life: birds by day, shooting stars by night, and one for each batch of new usage
          if (l.pulseAt > lastPulse.current) {
            lastPulse.current = l.pulseAt
            if (s.stars > 0.5) {
              spawnMeteor()
              if (l.size > 200_000) spawnMeteor()
            } else spawnFlock(true)
          }
          nextFlock -= dt
          if (nextFlock <= 0) {
            // most active around sunrise and sunset
            const busy = s.alt > -3 && s.alt < 30 ? 1 + 2 * (1 - smooth(4, 20, s.alt)) : 0
            if (busy && flocks.length < 3) spawnFlock(false)
            nextFlock = busy ? rand(14, 30) / busy : 10
          }
          nextMeteor -= dt
          if (nextMeteor <= 0) {
            if (s.stars > 0.6) spawnMeteor()
            nextMeteor = rand(25, 60)
          }
          const birdColor = mix(land[3], '#000000', 0.25)
          ctx.strokeStyle = birdColor
          ctx.lineWidth = 1.4
          ctx.lineCap = 'round'
          flocks = flocks.filter((f) => {
            f.x += f.vx * dt
            f.y += f.vy * dt
            f.vy *= 0.995
            ctx.beginPath()
            for (const b of f.birds) {
              const x = f.x + b.dx
              const y = f.y + b.dy + Math.sin(t * 1.5 + b.ph) * 2
              const flap = Math.sin(t * 9 + b.ph)
              ctx.moveTo(x - b.s, y - b.s * 0.25 - flap * b.s * 0.5)
              ctx.quadraticCurveTo(x - b.s * 0.4, y - b.s * 0.3, x, y)
              ctx.quadraticCurveTo(x + b.s * 0.4, y - b.s * 0.3, x + b.s, y - b.s * 0.25 - flap * b.s * 0.5)
            }
            ctx.stroke()
            return f.x > -200 && f.x < w + 200 && f.y > -80
          })
          meteors = meteors.filter((m) => {
            m.x += m.vx * dt
            m.y += m.vy * dt
            m.life -= dt * 1.1
            if (m.life <= 0 || m.y > hy) return false
            const tail = 0.16
            const mg = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail, m.y - m.vy * tail)
            mg.addColorStop(0, `rgba(255,255,255,${(0.9 * m.life).toFixed(3)})`)
            mg.addColorStop(1, 'rgba(180,200,255,0)')
            ctx.strokeStyle = mg
            ctx.lineWidth = 1.6
            ctx.beginPath()
            ctx.moveTo(m.x, m.y)
            ctx.lineTo(m.x - m.vx * tail, m.y - m.vy * tail)
            ctx.stroke()
            return true
          })
          life.drawShore(ctx, dt, s, sea, wind)
          life.drawFront(ctx, s)
        }
      }
    },
    1,
    30
  )
  return <canvas ref={ref} className="scene-canvas" />
}

// ---------------------------------------------------------------- the sidebar clock

const clockOf = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })

/**
 * The sidebar's 昼夜 clock: today's sky as a ring (each quarter hour in its
 * real colour) with the clock in the middle, the sun or the moon where the
 * day stands, the time of day and the time now (what comes next is in the
 * tooltip). A click plays the whole day as a time-lapse.
 */
export function DayClock() {
  const place = usePlace()
  const sky = useSky(10_000)
  const lapse = useTimelapse()
  const day = new Date(sky.t).toDateString()
  // the ring: local hours clockwise with noon at the top and sunrise on the left, the way the sun crosses the scene
  const ring = useMemo(() => {
    const d = new Date(sky.t)
    d.setHours(0, 0, 0, 0)
    const start = d.getTime()
    return Array.from({ length: 96 }, (_, i) => skyAt(start + i * 15 * 60_000, place))
  }, [day, place]) // eslint-disable-line react-hooks/exhaustive-deps
  const label = dayLabel(sky.t, place)
  const next = useMemo(() => nextLabel(sky.t, place), [Math.floor(sky.t / 60_000), place]) // eslint-disable-line react-hooks/exhaustive-deps
  const term = useMemo(() => seasonNow(sky.t, place.lat).term, [Math.floor(sky.t / 3_600_000), place]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = new Date(sky.t)
  const frac = (d.getHours() * 60 + d.getMinutes()) / 1440
  const R = 26
  const pos = (f: number, r = R) => [32 + r * Math.sin((f - 0.5) * TAU), 32 - r * Math.cos((f - 0.5) * TAU)] as const
  const [hx, hy] = pos(frac)
  const up = sky.alt > -0.8
  return (
    <button
      className={`day-clock phase-${sky.phase}${lapse ? ' lapse' : ''}`}
      onClick={() => (lapse ? stopTimelapse() : startTimelapse())}
      title={`${next ? `${clockOf(next.at)} 进入${next.label}\n` : ''}${lapse ? '点一下回到现在' : '点一下：40 秒看完一整天'}`}
    >
      <span className="day-clock-dial">
      {up && <i className="day-clock-glow" style={{ left: `${(hx / 64) * 100}%`, top: `${(hy / 64) * 100}%` }} />}
      <svg viewBox="0 0 64 64" aria-hidden>
        {ring.map((s, i) => {
          const [x1, y1] = pos(i / 96)
          const [x2, y2] = pos((i + 1.15) / 96)
          return <path key={i} d={`M${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`} stroke={mix(s.middle, s.horizon, 0.35)} strokeWidth="7" fill="none" />
        })}
        <circle cx={hx} cy={hy} r={up ? 5 : 4.2} fill={up ? sky.sun : '#eef2ff'} className={up ? 'day-clock-sun' : 'day-clock-moon'} />
        <text x="32" y="33" className="day-clock-time">
          {clockOf(sky.t)}
        </text>
      </svg>
      </span>
      <span className="day-clock-text">
        <b>
          {label}
          <em className="day-term"> · {term}</em>
        </b>
        <small>
          {dayStatus.text ? <span className="day-event">{dayStatus.text}</span> : place.name}
          {` · 现在 ${clockOf(sky.t)}`}
        </small>
      </span>
    </button>
  )
}
