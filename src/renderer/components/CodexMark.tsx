import { useEffect, useId, useRef } from 'react'
import type { Intensity, SourceView } from '@shared/types'
import { useHasCodex, useHasWorkBuddy, useMotionLevel, useSource } from '../state'
import { Starburst } from './Starburst'
import { onFrame } from '../frames'
import { WorkBuddyMark } from '../../features/workbuddy/WorkBuddyMark'
import { CODEX_CORE as CORE, CODEX_KNOT as KNOT } from '@shared/codexKnot'

/** per intensity level: the knot's turn (deg/s), its breath, the beam's turn, the light's strength */
const SPEED = [4, 18, 52, 130]
const BREATH = [0.012, 0.022, 0.035, 0.05]
const BEAM = [70, 110, 170, 260]
const SHINE = [0.45, 0.6, 0.75, 0.9]
/** the colours flowing across the bands, deg/s */
const HUE = [18, 30, 48, 80]
/** turns of the spark that runs along the knot's edges, per second */
const TRACE = [0.06, 0.1, 0.16, 0.26]
const SPARKS = 10

interface Spark {
  a: number
  v: number
  d: number
  life: number
}

/**
 * Codex's mark: the OpenAI knot in Codex's colours. It turns and breathes
 * faster with usage intensity, a beam of light sweeps across its bands, a
 * spark runs along their edges and the hexagon in the middle glows like a
 * core. `pulse` changes bump it, send out a ring and (standard motion and
 * up) throw sparks.
 */
export function CodexMark({ size = 64, intensity = 0, pulse = 0, animated = true }: { size?: number; intensity?: Intensity; pulse?: number; animated?: boolean }) {
  const motion = useMotionLevel()
  const live = animated && motion > 0
  const id = useId().replace(/[^\w-]/g, '')
  const spinRef = useRef<SVGGElement>(null)
  const gradRef = useRef<SVGLinearGradientElement>(null)
  const beamRef = useRef<SVGRectElement>(null)
  const traceRef = useRef<SVGPathElement>(null)
  const coreRef = useRef<SVGPolygonElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const sparkRef = useRef<(SVGCircleElement | null)[]>([])
  const st = useRef({ angle: 0, speed: SPEED[0], beam: 0, trace: 0, hue: 0, t: 0, bump: 0, sparks: [] as Spark[] })
  const target = useRef(intensity)
  target.current = intensity

  useEffect(() => {
    if (!pulse) return
    const s = st.current
    s.bump = 1
    if (motion < 2 || !animated) return
    const base = Math.random() * Math.PI * 2
    s.sparks = Array.from({ length: SPARKS }, (_, i) => ({ a: base + (i / SPARKS) * Math.PI * 2, v: 16 + Math.random() * 12, d: 8, life: 0.7 + Math.random() * 0.3 }))
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!live) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = st.current
      const lvl = target.current
      s.speed += (SPEED[lvl] - s.speed) * Math.min(1, dt * 1.5)
      s.angle = (s.angle + s.speed * dt) % 360
      s.beam = (s.beam + BEAM[lvl] * dt) % 360
      s.trace = (s.trace + TRACE[lvl] * dt) % 1
      s.hue = (s.hue - HUE[lvl] * dt) % 360
      s.t += dt
      s.bump = Math.max(0, s.bump - dt * 2.2)
      const kick = Math.sin(Math.PI * s.bump)
      const scale = 1 + BREATH[lvl] * Math.sin(s.t * 1.7) + 0.1 * kick
      spinRef.current?.setAttribute('transform', `rotate(${s.angle.toFixed(2)}) scale(${scale.toFixed(4)})`)
      gradRef.current?.setAttribute('gradientTransform', `rotate(${s.hue.toFixed(2)})`)
      const beam = beamRef.current
      if (beam) {
        beam.setAttribute('transform', `rotate(${s.beam.toFixed(2)})`)
        beam.setAttribute('opacity', Math.min(1, SHINE[lvl] + 0.5 * kick).toFixed(3))
      }
      const trace = traceRef.current
      if (trace) {
        trace.setAttribute('stroke-dashoffset', (-s.trace).toFixed(4))
        trace.setAttribute('opacity', Math.min(1, SHINE[lvl] + 0.1 + 0.4 * kick).toFixed(3))
      }
      // the core breathes, and flares with each new response
      coreRef.current?.setAttribute('opacity', Math.min(1, 0.4 + 0.12 * lvl + 0.18 * Math.sin(s.t * 2.4) + 0.6 * s.bump).toFixed(3))
      const ring = ringRef.current
      if (ring) {
        const k = 1 - s.bump
        ring.setAttribute('r', s.bump > 0 ? (9 + 7 * k).toFixed(2) : '0')
        ring.setAttribute('opacity', (0.8 * s.bump).toFixed(3))
        ring.setAttribute('stroke-width', (0.25 + 0.8 * s.bump).toFixed(3))
      }
      for (let i = 0; i < SPARKS; i++) {
        const el = sparkRef.current[i]
        const p = s.sparks[i]
        if (!el) continue
        if (!p || p.life <= 0) {
          if (el.getAttribute('r') !== '0') el.setAttribute('r', '0')
          continue
        }
        p.life -= dt
        p.d += p.v * dt
        p.v *= Math.exp(-dt * 2.5)
        el.setAttribute('cx', (Math.cos(p.a) * p.d).toFixed(2))
        el.setAttribute('cy', (Math.sin(p.a) * p.d).toFixed(2))
        el.setAttribute('r', Math.max(0, 0.85 * Math.min(1, p.life * 2)).toFixed(3))
        el.setAttribute('opacity', Math.max(0, Math.min(1, p.life * 1.6)).toFixed(2))
      }
    }
    const stop = onFrame(30, (_dt, now) => tick(now), 'mark')
    return () => stop()
  }, [live])

  const glow = animated ? [0, 3, 7, 12][intensity] : 0
  // the beam and the edge light are lost on a small mark
  const fine = live && size >= 32
  return (
    <svg
      width={size}
      height={size}
      viewBox="-13.4 -13.4 26.8 26.8"
      className="codex-mark"
      style={{ flex: 'none', overflow: 'visible', filter: glow ? `drop-shadow(0 0 ${glow}px rgba(var(--codex-rgb), 0.6))` : undefined, transition: 'filter 600ms' }}
      aria-hidden
    >
      <defs>
        <linearGradient ref={gradRef} id={`${id}g`} x1="-12" y1="-12" x2="12" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--codex-mark-hi, var(--codex-hi))" />
          <stop offset="0.55" stopColor="var(--codex)" />
          <stop offset="1" stopColor="var(--codex-deep)" />
        </linearGradient>
        {/* the beam: brightest along its middle, fading at both edges */}
        <linearGradient id={`${id}b`} x1="0" y1="-3.4" x2="0" y2="3.4" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}c`}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="var(--codex-hi)" />
          <stop offset="1" stopColor="var(--codex)" stopOpacity="0.15" />
        </radialGradient>
        <clipPath id={`${id}k`}>
          <path d={KNOT} transform="translate(-12 -12)" />
        </clipPath>
      </defs>
      {live && <circle ref={ringRef} r="0" fill="none" stroke="var(--codex-hi)" />}
      <g ref={spinRef}>
        <polygon ref={coreRef} points={CORE} fill={`url(#${id}c)`} opacity={live ? 0.45 : 0.3} />
        <path d={KNOT} transform="translate(-12 -12)" fill={`url(#${id}g)`} />
        {fine && (
          // light that only falls on the bands: a beam sweeping across them, and sparks running along their edges
          <g clipPath={`url(#${id}k)`} style={{ opacity: 'var(--codex-mark-shine, 1)' }}>
            <rect ref={beamRef} x="0" y="-3.4" width="15" height="6.8" fill={`url(#${id}b)`} opacity="0" />
            <path
              ref={traceRef}
              d={KNOT}
              transform="translate(-12 -12)"
              pathLength={1}
              fill="none"
              stroke="#fff"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeDasharray="0.05 0.2"
              opacity="0"
            />
          </g>
        )}
      </g>
      {live && (
        <g fill="var(--codex-hi)">
          {Array.from({ length: SPARKS }, (_, i) => (
            <circle key={i} ref={(el) => void (sparkRef.current[i] = el)} r="0" />
          ))}
        </g>
      )}
    </svg>
  )
}

/**
 * The mark of the tool on view: Claude's spark, Codex's knot, WorkBuddy's W, or
 * for 全部 the spark with the other tools in use circling it, half a turn apart.
 */
export function SourceMark({ size = 64, intensity = 0, pulse = 0, animated = true, source }: { size?: number; intensity?: Intensity; pulse?: number; animated?: boolean; source?: SourceView }) {
  const current = useSource()
  const hasCodex = useHasCodex()
  const hasWorkBuddy = useHasWorkBuddy()
  const s = source ?? current
  if (s === 'workbuddy') return <WorkBuddyMark size={size} intensity={intensity} pulse={pulse} animated={animated} />
  if (s === 'codex') return <CodexMark size={size} intensity={intensity} pulse={pulse} animated={animated} />
  if (s === 'claude') return <Starburst size={size} intensity={intensity} pulse={pulse} animated={animated} />
  const small = Math.max(10, Math.round(size * 0.44))
  const moons = hasCodex || !hasWorkBuddy ? (hasWorkBuddy ? (['codex', 'workbuddy'] as const) : (['codex'] as const)) : (['workbuddy'] as const)
  return (
    <span className="dual-mark" style={{ width: size, height: size, ['--orbit' as string]: `${Math.round(size * 0.5)}px` }}>
      <Starburst size={Math.round(size * 0.86)} intensity={intensity} pulse={pulse} animated={animated} />
      {moons.map((m, i) => {
        // the second moon runs half an orbit ahead; its own turn keeps it upright
        const lead = i ? { animationDelay: '-4.5s' } : undefined
        return (
          <span key={m} className="dual-orbit" style={lead} aria-hidden>
            <span className="dual-moon" style={lead}>
              {m === 'codex' ? <CodexMark size={small} intensity={intensity} pulse={pulse} animated={animated} /> : <WorkBuddyMark size={small} intensity={intensity} pulse={pulse} animated={animated} />}
            </span>
          </span>
        )
      })}
    </span>
  )
}
