import { useEffect, useRef } from 'react'
import type { Intensity, SourceView } from '@shared/types'
import { useMotionLevel, useSource } from '../state'
import { Starburst } from './Starburst'
import { onFrame } from '../frames'

/** rotation speed (deg/s) and breathing per intensity level, like the spark's */
const SPEED = [4, 18, 52, 130]
const BREATH = [0.02, 0.05, 0.08, 0.12]
const PETALS = 6
const SPARKS = 10

/** one loop of the knot: a capsule tangent to the ring at angle `a` */
function petal(a: number, grow: number): string {
  const r = 0.46
  const len = 0.5 * grow
  const w = 0.2
  const cx = Math.cos(a) * r
  const cy = Math.sin(a) * r
  // along the tangent
  const tx = -Math.sin(a)
  const ty = Math.cos(a)
  const nx = Math.cos(a)
  const ny = Math.sin(a)
  const f = (n: number) => n.toFixed(4)
  const p1 = [cx - tx * len + nx * w, cy - ty * len + ny * w]
  const p2 = [cx + tx * len + nx * w, cy + ty * len + ny * w]
  const p3 = [cx + tx * len - nx * w, cy + ty * len - ny * w]
  const p4 = [cx - tx * len - nx * w, cy - ty * len - ny * w]
  return `M${f(p1[0])} ${f(p1[1])}L${f(p2[0])} ${f(p2[1])}A${w} ${w} 0 0 0 ${f(p3[0])} ${f(p3[1])}L${f(p4[0])} ${f(p4[1])}A${w} ${w} 0 0 0 ${f(p1[0])} ${f(p1[1])}Z`
}

interface Spark {
  a: number
  v: number
  d: number
  life: number
}

/**
 * Codex's mark: six interlocking loops around a terminal prompt, in Codex's
 * own colour. Turns and breathes faster with usage intensity; `pulse`
 * changes bump it and (standard motion and up) throw sparks.
 */
export function CodexMark({ size = 64, intensity = 0, pulse = 0, animated = true }: { size?: number; intensity?: Intensity; pulse?: number; animated?: boolean }) {
  const motion = useMotionLevel()
  const reduced = motion === 0
  const gRef = useRef<SVGGElement>(null)
  const petals = useRef<(SVGPathElement | null)[]>([])
  const sparkRef = useRef<(SVGCircleElement | null)[]>([])
  const st = useRef({ angle: 0, speed: SPEED[0], t: 0, bump: 0, sparks: [] as Spark[] })
  const target = useRef(intensity)
  target.current = intensity

  useEffect(() => {
    if (!pulse) return
    const s = st.current
    s.bump = 1
    if (motion < 2 || !animated) return
    const base = Math.random() * Math.PI * 2
    s.sparks = Array.from({ length: SPARKS }, (_, i) => ({ a: base + (i / SPARKS) * Math.PI * 2, v: 1.3 + Math.random(), d: 0.6, life: 0.7 + Math.random() * 0.3 }))
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animated || reduced) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = st.current
      const lvl = target.current
      s.speed += (SPEED[lvl] - s.speed) * Math.min(1, dt * 1.5)
      s.angle = (s.angle + s.speed * dt) % 360
      s.t += dt * (1 + lvl)
      s.bump = Math.max(0, s.bump - dt * 2.2)
      const scale = 1 + 0.12 * Math.sin(Math.PI * s.bump)
      gRef.current?.setAttribute('transform', `rotate(${s.angle.toFixed(2)}) scale(${scale.toFixed(4)})`)
      for (let i = 0; i < PETALS; i++) {
        const grow = 1 + BREATH[lvl] * Math.sin(s.t * 2 + i * 1.3)
        petals.current[i]?.setAttribute('d', petal((i / PETALS) * Math.PI * 2, grow))
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
        el.setAttribute('cx', (Math.cos(p.a) * p.d).toFixed(3))
        el.setAttribute('cy', (Math.sin(p.a) * p.d).toFixed(3))
        el.setAttribute('r', Math.max(0, 0.07 * Math.min(1, p.life * 2)).toFixed(3))
        el.setAttribute('opacity', Math.max(0, Math.min(1, p.life * 1.6)).toFixed(2))
      }
    }
    const stop = onFrame(30, (_dt, now) => tick(now), 'mark')
    return () => stop()
  }, [animated, reduced])

  const glow = animated ? [0, 3, 7, 12][intensity] : 0
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.12 -1.12 2.24 2.24"
      className="codex-mark"
      style={{ flex: 'none', overflow: 'visible', filter: glow ? `drop-shadow(0 0 ${glow}px rgba(var(--codex-rgb), 0.6))` : undefined, transition: 'filter 600ms' }}
      aria-hidden
    >
      <defs>
        <linearGradient id="codex-grad" x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--codex-hi)" />
          <stop offset="0.55" stopColor="var(--codex)" />
          <stop offset="1" stopColor="var(--codex-deep)" />
        </linearGradient>
      </defs>
      <g ref={gRef}>
        {Array.from({ length: PETALS }, (_, i) => (
          <path key={i} ref={(el) => void (petals.current[i] = el)} d={petal((i / PETALS) * Math.PI * 2, 1)} fill="none" stroke="url(#codex-grad)" strokeWidth="0.11" />
        ))}
      </g>
      {/* the terminal prompt stays upright */}
      <path d="M-0.24 -0.16L-0.06 0L-0.24 0.16M0.02 0.17H0.24" fill="none" stroke="var(--codex)" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round" />
      {animated && (
        <g fill="var(--codex)">
          {Array.from({ length: SPARKS }, (_, i) => (
            <circle key={i} ref={(el) => void (sparkRef.current[i] = el)} r="0" />
          ))}
        </g>
      )}
    </svg>
  )
}

/**
 * The mark of the tool on view: Claude's spark, Codex's knot, or for 全部 the
 * spark with the knot circling it.
 */
export function SourceMark({ size = 64, intensity = 0, pulse = 0, animated = true, source }: { size?: number; intensity?: Intensity; pulse?: number; animated?: boolean; source?: SourceView }) {
  const current = useSource()
  const s = source ?? current
  if (s === 'codex') return <CodexMark size={size} intensity={intensity} pulse={pulse} animated={animated} />
  if (s === 'claude') return <Starburst size={size} intensity={intensity} pulse={pulse} animated={animated} />
  const small = Math.max(10, Math.round(size * 0.44))
  return (
    <span className="dual-mark" style={{ width: size, height: size, ['--orbit' as string]: `${Math.round(size * 0.5)}px` }}>
      <Starburst size={Math.round(size * 0.86)} intensity={intensity} pulse={pulse} animated={animated} />
      <span className="dual-orbit" aria-hidden>
        <span className="dual-moon">
          <CodexMark size={small} intensity={intensity} pulse={pulse} animated={animated} />
        </span>
      </span>
    </span>
  )
}
