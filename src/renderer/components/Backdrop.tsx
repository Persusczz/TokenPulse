import { useEffect, useRef, type CSSProperties } from 'react'
import { accentHex } from '@shared/accents'
import { ambient } from '@shared/ambient'
import { crossed, TOKEN_MARKS } from '@shared/milestones'
import type { Intensity, Settings } from '@shared/types'
import { cssVar, useApp, useData, useMotionLevel, useNow, type MotionScale } from '../state'
import { FlowField } from './FlowField'
import { GalaxyField } from './GalaxyField'
import { StarField } from './StarField'
import { Abyss, Borealis, InkWash, NeonGrid } from './ThemeScenes'
import { Astral, ClaudeGlow, CodexNight, Dune, PaperDesk, Sakura } from './ThemeScenes2'
import { Eclipse, Firefly, Lunar, Orrery, Rain, Trails } from './ThemeScenes3'
import { Bauhaus, Crystal, DigitalRain, Fireworks, Lanterns, LavaLamp } from './ThemeScenes4'
import { DayCycleScene, usePlace } from './DayCycle'
import { Cyberpunk, Mystic, Xianxia } from './ThemeScenes5'
import { KoiPond, PixelQuest, Ukiyo } from './ThemeScenes6'
import { onFrame } from '../frames'

/** Backdrop palette for the current settings, quota and intensity (shared with the floating window) */
export function useAmbient(settings: Settings | null, intensity: Intensity) {
  const { quota } = useApp()
  const now = useNow(60_000)
  const five = quota?.windows.find((w) => w.key === 'session' || w.key === 'five_hour')
  return ambient({
    hour: new Date(now).getHours(),
    quotaPct: five ? five.utilization : null,
    intensity,
    adaptive: settings?.adaptiveBackdrop ?? true,
    // Codex alone on view tints the backdrop in its colour
    accent: accentHex(settings)
  })
}

/** Strength of the flow shader for a backdrop strength and mood */
export const flowGlow = (vivid: number, moodGlow: number, dark: boolean) => vivid * (0.62 + moodGlow * 0.55) * (dark ? 0.78 : 1)

interface Ring {
  x: number
  y: number
  age: number
  life: number
  max: number
  strong: boolean
}
interface Fall {
  x: number
  y: number
  ty: number
  v: number
}

/** ambient ripples per second at each usage intensity */
const RATE = [0.16, 0.4, 0.9, 1.8]
const DENSITY: Record<MotionScale, number> = { 0: 0, 1: 0.5, 2: 1, 3: 1.5 }

function rgbOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '217,119,87'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

/** A still-water surface: rings spread at random, more often while usage is intense; new usage drips in from above */
function RippleField({ intensity, level, pulse, theme, vivid }: { intensity: Intensity; level: MotionScale; pulse: number; theme: string; vivid: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ intensity, level, vivid, rgb: '217,119,87', rings: [] as Ring[], falls: [] as Fall[], acc: 0, w: 0, h: 0 })
  st.current.intensity = intensity
  st.current.level = level
  st.current.vivid = vivid

  useEffect(() => {
    st.current.rgb = rgbOf(cssVar(theme.startsWith('dark') ? '--accent-strong' : '--accent'))
  }, [theme])

  useEffect(() => {
    const s = st.current
    if (!pulse || !level || !s.w) return
    for (let i = 0; i < (level >= 3 ? 3 : 1); i++) {
      s.falls.push({ x: s.w * (0.1 + Math.random() * 0.8), y: -30, ty: s.h * (0.3 + Math.random() * 0.62), v: 200 })
    }
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!level) return
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const s = st.current
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      s.w = canvas.clientWidth
      s.h = canvas.clientHeight
      canvas.width = Math.round(s.w * dpr)
      canvas.height = Math.round(s.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    addEventListener('resize', resize)
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      s.acc += dt * RATE[s.intensity] * DENSITY[s.level]
      while (s.acc > 1) {
        s.acc -= 1
        s.rings.push({ x: Math.random() * s.w, y: Math.random() * s.h, age: 0, life: 3 + Math.random() * 1.6, max: 50 + Math.random() * 90, strong: false })
      }
      ctx.clearRect(0, 0, s.w, s.h)
      ctx.lineWidth = 1 + s.vivid
      const boost = 0.6 + s.vivid * 1.2
      s.falls = s.falls.filter((f) => {
        f.v += 2600 * dt
        f.y += f.v * dt
        if (f.y >= f.ty) {
          s.rings.push({ x: f.x, y: f.ty, age: 0, life: 3.6, max: 160, strong: true })
          return false
        }
        const tail = Math.min(46, f.v * 0.035)
        const g = ctx.createLinearGradient(0, f.y - tail, 0, f.y)
        g.addColorStop(0, `rgba(${s.rgb},0)`)
        g.addColorStop(1, `rgba(${s.rgb},0.55)`)
        ctx.strokeStyle = g
        ctx.beginPath()
        ctx.moveTo(f.x, f.y - tail)
        ctx.lineTo(f.x, f.y)
        ctx.stroke()
        return true
      })
      s.rings = s.rings.filter((r) => {
        r.age += dt
        const p = r.age / r.life
        if (p >= 1) return false
        for (let k = 0; k < 3; k++) {
          const rad = p * r.max - k * 13
          if (rad <= 0) continue
          const a = Math.min(1, (1 - p) ** 2 * (r.strong ? 0.5 : 0.28) * (1 - k * 0.3) * boost)
          ctx.strokeStyle = `rgba(${s.rgb},${a.toFixed(3)})`
          ctx.beginPath()
          ctx.ellipse(r.x, r.y, rad, rad * 0.42, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
        return true
      })
    }
    const stop = onFrame(60, (_dt, now) => tick(now), 'ripples')
    return () => {
      stop()
      removeEventListener('resize', resize)
    }
  }, [level])

  return <canvas ref={ref} className="ripple-field" />
}

/**
 * Window background behind the content. Adaptive colours follow the time of
 * day, the usage intensity and the 5h quota (warming toward red near the limit).
 */
export function Backdrop({ theme, paint, animated }: { theme: string; paint: string; animated?: boolean }) {
  const { settings, lastUpdate } = useApp()
  const live = useData(() => window.api.getLive(), [], 30_000)
  const level = useMotionLevel()
  const chosen = settings?.backdrop ?? 'plain'
  // big screen and wallpaper always move: a still choice falls back to the flow
  const style = animated && chosen === 'plain' ? 'flow' : chosen
  // the star atlas draws today's sign
  const sign = useData(() => (style === 'astral' ? window.api.getSign() : Promise.resolve(null)), [style], 120_000)
  const intensity = (live?.intensity ?? 0) as Intensity
  const amb = useAmbient(settings, intensity)
  const place = usePlace()
  // today's tokens passing a milestone: the cosmos answers with a supernova
  const prevTokens = useRef<number | null>(null)
  // switching tools changes the count: the next reading is a new baseline
  const source = settings?.sourceFilter
  useEffect(() => void (prevTokens.current = null), [source])
  useEffect(() => {
    const v = live?.today.tokens
    if (v === undefined) return
    if (prevTokens.current !== null && crossed(prevTokens.current, v, TOKEN_MARKS)) document.dispatchEvent(new CustomEvent('tp-nova'))
    prevTokens.current = v
  }, [live?.today.tokens])
  if (!settings || style === 'plain') return null

  const vivid = settings.backdropVivid
  const pulse = lastUpdate?.addedTokens ? lastUpdate.at : 0
  const vars = {
    '--b1': amb.colors[0],
    '--b2': amb.colors[1],
    '--b3': amb.colors[2],
    '--b4': amb.colors[3],
    '--glow': amb.glow,
    '--heat': amb.heat,
    '--vivid': vivid
  } as CSSProperties

  return (
    <div className={`backdrop backdrop-${style}`} style={vars} data-mood={amb.mood} aria-hidden>
      {style === 'galaxy' && (
        <GalaxyField
          colors={amb.colors}
          intensity={intensity}
          level={level}
          pulse={pulse}
          size={lastUpdate?.addedTokens ?? 0}
          dark={theme === 'dark'}
          vivid={vivid}
          heat={amb.heat}
        />
      )}
      {style === 'flow' && <FlowField colors={amb.colors} glow={flowGlow(vivid, amb.glow, theme === 'dark')} intensity={intensity} level={level} pulse={pulse} />}
      {style === 'stars' && (
        <StarField
          colors={amb.colors}
          intensity={intensity}
          level={level}
          pulse={pulse}
          size={lastUpdate?.addedTokens ?? 0}
          dark={theme === 'dark'}
          vivid={vivid}
        />
      )}
      {style === 'aurora' && (
        <div className="aurora">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {style === 'ripples' && <RippleField intensity={intensity} level={level} pulse={pulse} theme={paint} vivid={vivid} />}
      {style === 'paper' && <PaperDesk intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`p-${theme}`} />}
      {style === 'sakura' && <Sakura intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`s-${theme}`} />}
      {style === 'dune' && <Dune intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`d-${theme}`} />}
      {style === 'astral' && <Astral intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} zodiac={sign?.zodiac} key={`a-${theme}`} />}
      {style === 'neon' && (
        <>
          <NeonGrid intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />
          <span className="neon-scan" />
        </>
      )}
      {style === 'borealis' && <Borealis intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'ink' && (
        <>
          <InkWash intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />
          <span className="paper-grain" />
        </>
      )}
      {style === 'abyss' && <Abyss intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'orrery' && <Orrery intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`o-${theme}`} />}
      {style === 'lunar' && <Lunar intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`l-${theme}`} />}
      {style === 'eclipse' && <Eclipse intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`e-${theme}`} />}
      {style === 'trails' && <Trails intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`t-${theme}`} />}
      {style === 'rain' && <Rain intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`r-${theme}`} />}
      {style === 'firefly' && <Firefly intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`f-${theme}`} />}
      {style === 'lava' && <LavaLamp intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`lv-${theme}`} />}
      {style === 'crystal' && <Crystal intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`cr-${theme}`} />}
      {style === 'matrix' && <DigitalRain intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`mx-${theme}`} />}
      {style === 'fireworks' && <Fireworks intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`fw-${theme}`} />}
      {style === 'lantern' && <Lanterns intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`ln-${theme}`} />}
      {style === 'daylight' && <DayCycleScene intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} place={place} />}
      {style === 'bauhaus' && <Bauhaus intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`bh-${theme}`} />}
      {style === 'mystic' && <Mystic intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'cyber' && <Cyberpunk intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'xianxia' && <Xianxia intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'koi' && <KoiPond intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`k-${theme}`} />}
      {style === 'ukiyo' && <Ukiyo intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`u-${theme}`} />}
      {style === 'pixel' && <PixelQuest intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} />}
      {style === 'claude' && <ClaudeGlow intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`c-${theme}`} />}
      {style === 'codex' && <CodexNight intensity={intensity} level={level} pulse={pulse} size={lastUpdate?.addedTokens ?? 0} vivid={vivid} dark={theme === 'dark'} key={`x-${theme}`} />}
      <span className="backdrop-tint" />
    </div>
  )
}
