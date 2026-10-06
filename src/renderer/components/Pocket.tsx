import { useEffect, useRef } from 'react'
import type { BackdropStyle, Intensity, SkyPlace } from '@shared/types'
import { onFrame } from '../frames'
import type { MotionScale } from '../state'
import { POCKETS } from './pockets'

/**
 * Pocket scenes: each theme pack's own small animation for the floating
 * window (card, capsule and orb) and the dynamic island, the way the cosmos
 * has its galaxy and black hole there. Drawn for small surfaces (the busy
 * part to one side, calm where the numbers are), on the frame clock at about
 * 30 frames a second, and answering new usage in the pack's own way.
 */

export type Shape = 'card' | 'capsule' | 'orb' | 'island'

export interface PocketLive {
  /** seconds, at the motion level's pace */
  t: number
  intensity: number
  vivid: number
  /** seconds since the last batch of new usage (large when none) */
  since: number
  /** tokens in that batch */
  size: number
  /** the 5-hour window, percent */
  pct: number | null
  /** draw the dark version */
  dark: boolean
  shape: Shape
  /** where the sky is (昼夜) */
  place: SkyPlace | null
}

export interface Pocket {
  /** the scene, w × h css px; laid out by proportion, so it can be drawn at any size without starting over */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, l: PocketLive): void
  /** the pack's emblem, centred at (x, y), radius r */
  emblem(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, l: PocketLive): void
  /** whether the scene is a dark one in this theme */
  dark(themeDark: boolean): boolean
}

/** backdrops with a pocket scene */
export const hasPocket = (s: BackdropStyle | undefined | null): s is BackdropStyle => !!s && s in POCKETS

/** a pocket scene's own darkness, for the text over it */
export function pocketDark(s: BackdropStyle, themeDark: boolean): boolean {
  const make = POCKETS[s]
  return make ? make().dark(themeDark) : themeDark
}

interface Props {
  style: BackdropStyle
  shape: Shape
  dark: boolean
  intensity: Intensity
  level: MotionScale
  pulse: number
  size?: number
  pct?: number | null
  vivid: number
  place?: SkyPlace | null
  /** the window's own zoom, so the canvas stays sharp */
  pixelScale?: number
  className?: string
}

type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, l: PocketLive, p: Pocket) => void

/** a canvas that keeps drawing `paint` with the pack's pocket, its live values kept current */
function usePocket(ref: React.RefObject<HTMLCanvasElement | null>, props: Props, paint: Paint): void {
  const live = useRef<PocketLive>({ t: 0, intensity: props.intensity, vivid: props.vivid, since: 1e9, size: 0, pct: props.pct ?? null, dark: props.dark, shape: props.shape, place: props.place ?? null })
  const l = live.current
  l.intensity = props.intensity
  l.vivid = props.vivid
  l.pct = props.pct ?? null
  l.shape = props.shape
  l.place = props.place ?? null
  const pulseAt = useRef(0)
  useEffect(() => {
    if (!props.pulse) return
    pulseAt.current = performance.now()
    l.size = props.size ?? 0
  }, [props.pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current
    const make = POCKETS[props.style]
    if (!canvas || !make) return
    const ctx = canvas.getContext('2d')!
    const pocket = make()
    live.current.dark = pocket.dark(props.dark)
    let w = 0
    let h = 0
    let dpr = 1
    const fit = () => {
      dpr = (window.devicePixelRatio || 1) * (props.pixelScale ?? 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
    }
    const frame = (dt: number) => {
      const lv = live.current
      lv.t += dt
      lv.since = pulseAt.current ? (performance.now() - pulseAt.current) / 1000 : 1e9
      if (!w || !h) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, w, h)
      paint(ctx, w, h, dt, lv, pocket)
    }
    const ro = new ResizeObserver(() => {
      fit()
      frame(0)
    })
    ro.observe(canvas)
    fit()
    // a still first frame a moment into the scene, so nothing starts empty
    live.current.t = 6
    frame(0)
    const speed = props.level >= 3 ? 1.25 : props.level === 1 ? 0.6 : 1
    const stop = props.level > 0 ? onFrame(30, (dt) => frame(Math.min(0.1, dt) * speed), 'pocket') : null
    return () => {
      stop?.()
      ro.disconnect()
    }
  }, [props.style, props.dark, props.level, props.pixelScale]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** a veil over the scene where the text sits: darker or lighter to the scene's own tone */
function veil(ctx: CanvasRenderingContext2D, w: number, h: number, l: PocketLive): void {
  const ink = l.dark ? '0,0,0' : '255,255,255'
  if (l.shape === 'island') {
    ctx.fillStyle = `rgba(0,0,0,${h < 46 ? 0.34 : 0.42})`
    ctx.fillRect(0, 0, w, h)
    return
  }
  if (l.shape === 'orb') return
  const g = ctx.createLinearGradient(0, 0, w, 0)
  const a = l.shape === 'capsule' ? 0.42 : l.dark ? 0.4 : 0.5
  g.addColorStop(0, `rgba(${ink},${a})`)
  g.addColorStop(0.55, `rgba(${ink},${a * 0.45})`)
  g.addColorStop(1, `rgba(${ink},0)`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

/** The pack's scene behind a panel's content */
export function PocketScene(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  usePocket(ref, p, (ctx, w, h, dt, l, pocket) => {
    pocket.draw(ctx, w, h, dt, l)
    veil(ctx, w, h, l)
  })
  return <canvas ref={ref} className={`pocket-canvas${p.className ? ` ${p.className}` : ''}`} aria-hidden />
}

/** The pack's emblem, animated, in place of the tool's mark */
export function PocketEmblem(p: Omit<Props, 'shape'> & { shape?: Shape }) {
  const ref = useRef<HTMLCanvasElement>(null)
  usePocket(ref, { ...p, shape: p.shape ?? 'island' }, (ctx, w, h, _dt, l, pocket) => {
    pocket.emblem(ctx, w / 2, h / 2, Math.min(w, h) / 2 - 1, l)
  })
  return <canvas ref={ref} className={`pocket-emblem${p.className ? ` ${p.className}` : ''}`} aria-hidden />
}

/**
 * The floating window's orb in a pack's colours: the scene inside the circle
 * and the 5-hour window as a ring of light round its rim.
 */
export function PocketOrb(p: Omit<Props, 'shape'>) {
  const ref = useRef<HTMLCanvasElement>(null)
  const accent = useRef('217,119,87')
  useEffect(() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim()
    if (v) accent.current = v
  }, [p.style, p.dark])
  usePocket(ref, { ...p, shape: 'orb' }, (ctx, w, h, dt, l, pocket) => {
    const r = Math.min(w, h) / 2 - 3
    const cx = w / 2
    const cy = h / 2
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    pocket.draw(ctx, w, h, dt, l)
    // calm in the middle, where the reading sits
    const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    const ink = l.dark ? '0,0,0' : '255,255,255'
    v.addColorStop(0, `rgba(${ink},${l.dark ? 0.42 : 0.5})`)
    v.addColorStop(0.62, `rgba(${ink},${l.dark ? 0.2 : 0.24})`)
    v.addColorStop(1, `rgba(${ink},0)`)
    ctx.fillStyle = v
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
    // the rim: the 5-hour window filling clockwise from the top
    const pct = l.pct
    ctx.lineCap = 'round'
    ctx.lineWidth = 4
    ctx.strokeStyle = l.dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'
    ctx.beginPath()
    ctx.arc(cx, cy, r - 2, 0, Math.PI * 2)
    ctx.stroke()
    if (pct !== null && pct > 0) {
      const end = -Math.PI / 2 + (Math.min(100, pct) / 100) * Math.PI * 2
      const hot = pct >= 90 ? '229,72,77' : pct >= 75 ? '240,160,40' : accent.current
      ctx.shadowColor = `rgba(${hot},0.9)`
      ctx.shadowBlur = 8
      ctx.strokeStyle = `rgb(${hot})`
      ctx.beginPath()
      ctx.arc(cx, cy, r - 2, -Math.PI / 2, end)
      ctx.stroke()
      ctx.shadowBlur = 0
      // a spark riding the end of the arc
      const sx = cx + Math.cos(end) * (r - 2)
      const sy = cy + Math.sin(end) * (r - 2)
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 7)
      g.addColorStop(0, 'rgba(255,255,255,0.95)')
      g.addColorStop(1, `rgba(${hot},0)`)
      ctx.fillStyle = g
      ctx.fillRect(sx - 7, sy - 7, 14, 14)
    }
  })
  return <canvas ref={ref} className="pocket-orb" aria-hidden />
}
