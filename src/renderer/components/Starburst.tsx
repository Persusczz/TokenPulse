import { useEffect, useRef } from 'react'
import shape from '@shared/starburst.json'
import type { Intensity } from '@shared/types'
import { useMotionLevel } from '../state'

const RAD = Math.PI / 180
/** rotation speed (deg/s) and ray "breathing" amplitude per intensity level */
const SPEED = [5, 24, 70, 170]
const BREATH = [0.02, 0.05, 0.09, 0.14]
const SPARKS = 12

interface Spark {
  a: number
  v: number
  d: number
  life: number
  r: number
}

export function rayPath(angleDeg: number, len: number): string {
  const a = (angleDeg - 90) * RAD
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const nx = -dy
  const ny = dx
  const wb = shape.baseWidth
  const wt = shape.tipWidth
  const tx = dx * len
  const ty = dy * len
  const f = (n: number) => n.toFixed(4)
  return (
    `M${f(nx * wb)} ${f(ny * wb)}` +
    `L${f(tx + nx * wt)} ${f(ty + ny * wt)}` +
    `A${wt} ${wt} 0 0 0 ${f(tx - nx * wt)} ${f(ty - ny * wt)}` +
    `L${f(-nx * wb)} ${f(-ny * wb)}Z`
  )
}

export const STATIC_PATHS = shape.rays.map((r) => rayPath(r.a, r.l))
export const SPARK_CORE = shape.core

/**
 * Claude-style spark. Spins and breathes faster with usage intensity; `pulse`
 * changes trigger a short scale bump and (standard motion and up) a burst of sparks.
 */
export function Starburst({
  size = 64,
  intensity = 0,
  pulse = 0,
  animated = true
}: {
  size?: number
  intensity?: Intensity
  pulse?: number
  animated?: boolean
}) {
  const motion = useMotionLevel()
  const reduced = motion === 0
  const gRef = useRef<SVGGElement>(null)
  const raysRef = useRef<(SVGPathElement | null)[]>([])
  const sparkRef = useRef<(SVGCircleElement | null)[]>([])
  const state = useRef({ angle: 0, speed: SPEED[0], t: 0, bump: 0, sparks: [] as Spark[] })
  const target = useRef(intensity)
  target.current = intensity

  useEffect(() => {
    if (!pulse) return
    const s = state.current
    s.bump = 1
    if (motion < 2 || !animated) return
    const n = motion === 3 ? SPARKS : 7
    const base = Math.random() * 360
    s.sparks = Array.from({ length: n }, (_, i) => ({
      a: (base + (360 / n) * i + Math.random() * 18) * RAD,
      v: 1.4 + Math.random() * 1.2,
      d: 0.55,
      life: 0.7 + Math.random() * 0.3,
      r: 0.05 + Math.random() * 0.05
    }))
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!animated || reduced) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = state.current
      const lvl = target.current
      s.speed += (SPEED[lvl] - s.speed) * Math.min(1, dt * 1.5)
      s.angle = (s.angle + s.speed * dt) % 360
      s.t += dt * (1 + lvl)
      s.bump = Math.max(0, s.bump - dt * 2.2)
      const scale = 1 + 0.12 * Math.sin(Math.PI * s.bump)
      gRef.current?.setAttribute('transform', `rotate(${s.angle.toFixed(2)}) scale(${scale.toFixed(4)})`)
      const amp = BREATH[lvl]
      shape.rays.forEach((r, i) => {
        const len = r.l * (1 + amp * Math.sin(s.t * 2.1 + i * 1.7))
        raysRef.current[i]?.setAttribute('d', rayPath(r.a, len))
      })
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
        el.setAttribute('r', Math.max(0, p.r * Math.min(1, p.life * 2)).toFixed(3))
        el.setAttribute('opacity', Math.max(0, Math.min(1, p.life * 1.6)).toFixed(2))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animated, reduced])

  const glow = animated ? [0, 3, 7, 12][intensity] : 0
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.12 -1.12 2.24 2.24"
      className="starburst"
      style={{
        flex: 'none',
        overflow: 'visible',
        filter: glow ? `drop-shadow(0 0 ${glow}px rgba(var(--accent-rgb), 0.55))` : undefined,
        transition: 'filter 600ms'
      }}
      aria-hidden
    >
      <g ref={gRef} fill="var(--accent)">
        <circle r={shape.core} />
        {STATIC_PATHS.map((d, i) => (
          <path key={i} ref={(el) => void (raysRef.current[i] = el)} d={d} />
        ))}
      </g>
      {animated && (
        <g fill="var(--accent)">
          {Array.from({ length: SPARKS }, (_, i) => (
            <circle key={i} ref={(el) => void (sparkRef.current[i] = el)} r="0" />
          ))}
        </g>
      )}
    </svg>
  )
}
