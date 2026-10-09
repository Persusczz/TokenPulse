import { useEffect, useId, useRef } from 'react'
import type { Intensity } from '@shared/types'
import { useMotionLevel } from '../../renderer/state'
import { onFrame } from '../../renderer/frames'

/** frame turn (deg/s), light laps along the W per second, and breathing, per intensity level */
const SPEED = [5, 16, 40, 96]
const FLOW = [0.18, 0.4, 0.75, 1.35]
const BREATH = [0.015, 0.03, 0.05, 0.08]
const SPARKS = 10
/** the W of WorkBuddy's mark, centred */
const W_PATH = 'M-0.536 -0.362L-0.315 0.362L0 -0.142L0.315 0.362L0.536 -0.362'
const FRAME = 0.82

/**
 * WorkBuddy's mark: the W inside a rounded frame, in WorkBuddy's green. The
 * frame turns and breathes faster with usage intensity, a light runs along
 * the W, and `pulse` changes bump it and (standard motion and up) throw sparks.
 */
export function WorkBuddyMark({ size = 28, intensity = 0, pulse = 0, animated = true }: { size?: number; intensity?: Intensity; pulse?: number; animated?: boolean }) {
  const motion = useMotionLevel()
  const live = animated && motion > 0
  const id = useId().replace(/:/g, '')
  const frameRef = useRef<SVGGElement>(null)
  const markRef = useRef<SVGGElement>(null)
  const flowRef = useRef<SVGPathElement>(null)
  const sparkRef = useRef<(SVGCircleElement | null)[]>([])
  const st = useRef({ angle: 0, speed: SPEED[0], run: 0, t: 0, bump: 0, sparks: [] as { a: number; v: number; d: number; life: number }[] })
  const target = useRef(intensity)
  target.current = intensity

  useEffect(() => {
    if (!pulse) return
    const s = st.current
    s.bump = 1
    if (motion < 2 || !animated) return
    const base = Math.random() * Math.PI * 2
    s.sparks = Array.from({ length: SPARKS }, (_, i) => ({ a: base + (i / SPARKS) * Math.PI * 2, v: 1.2 + Math.random(), d: 0.62, life: 0.7 + Math.random() * 0.3 }))
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
      s.run = (s.run + FLOW[lvl] * dt) % 1
      s.t += dt * (1 + lvl)
      s.bump = Math.max(0, s.bump - dt * 2.2)
      const breathe = 1 + BREATH[lvl] * Math.sin(s.t * 2)
      frameRef.current?.setAttribute('transform', `rotate(${s.angle.toFixed(2)}) scale(${breathe.toFixed(4)})`)
      markRef.current?.setAttribute('transform', `scale(${(1 + 0.14 * Math.sin(Math.PI * s.bump)).toFixed(4)})`)
      // a bright stretch of the stroke travels the W end to end
      flowRef.current?.setAttribute('stroke-dashoffset', (1.74 - s.run * 1.46).toFixed(4))
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
  }, [live])

  const glow = animated ? [0, 3, 7, 12][intensity] : 0
  const r = FRAME * 0.32
  return (
    <svg
      width={size}
      height={size}
      viewBox="-1.12 -1.12 2.24 2.24"
      className="workbuddy-mark"
      aria-label="WorkBuddy"
      style={{ flex: 'none', overflow: 'visible', filter: glow ? `drop-shadow(0 0 ${glow}px rgba(var(--workbuddy-rgb), 0.6))` : undefined, transition: 'filter 600ms' }}
    >
      <defs>
        <linearGradient id={`${id}g`} x1="-1" y1="-1" x2="1" y2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--workbuddy-hi)" />
          <stop offset="0.55" stopColor="var(--workbuddy)" />
          <stop offset="1" stopColor="var(--workbuddy-deep)" />
        </linearGradient>
      </defs>
      <g ref={frameRef}>
        <rect x={-FRAME} y={-FRAME} width={FRAME * 2} height={FRAME * 2} rx={r} fill="none" stroke={`url(#${id}g)`} strokeWidth="0.09" opacity="0.6" />
        {/* a bead of light on the frame's corner, turning with it */}
        {animated && <circle cx={FRAME - r * 0.3} cy={-FRAME + r * 0.3} r="0.07" fill="var(--workbuddy-hi)" opacity="0.9" />}
      </g>
      <g ref={markRef}>
        <path d={W_PATH} fill="none" stroke={`url(#${id}g)`} strokeWidth="0.17" strokeLinecap="round" strokeLinejoin="round" />
        {animated && (
          <path ref={flowRef} d={W_PATH} fill="none" stroke="var(--workbuddy-hi)" strokeWidth="0.1" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="0.22 1.3" strokeDashoffset="1.74" opacity="0.95" />
        )}
      </g>
      {animated && (
        <g fill="var(--workbuddy)">
          {Array.from({ length: SPARKS }, (_, i) => (
            <circle key={i} ref={(el) => void (sparkRef.current[i] = el)} r="0" />
          ))}
        </g>
      )}
    </svg>
  )
}
