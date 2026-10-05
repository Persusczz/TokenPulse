import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ripple } from '../effects'
import { AnimatedNumber } from './Numbers'

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className="spark" />
  const w = 100
  const h = 30
  const max = Math.max(...values, 1e-9)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 6)] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('')
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={`${line}L${w} ${h}L0 ${h}Z`} fill={color} opacity="0.1" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}

/** KPI tile; flashes briefly when its value grows */
export function StatTile({
  label,
  color,
  value,
  format,
  sub,
  spark
}: {
  label: string
  color?: string
  value: number
  format: (v: number) => string
  sub?: ReactNode
  spark?: number[]
}) {
  const prev = useRef(value)
  const el = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)
  /** the latest increase, floated up as "+N" (token tiles only) */
  const [delta, setDelta] = useState<{ id: number; text: string } | null>(null)
  useEffect(() => {
    if (value > prev.current && prev.current > 0) {
      setFlash(true)
      if (el.current) ripple(el.current, undefined, 'ripple soft')
      if (color) setDelta((d) => ({ id: (d?.id ?? 0) + 1, text: `+${format(value - prev.current)}` }))
      const t = setTimeout(() => setFlash(false), 900)
      prev.current = value
      return () => clearTimeout(t)
    }
    prev.current = value
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={el} className={`card tile${flash ? ' flash' : ''}`} style={color ? ({ '--tile-c': color } as CSSProperties) : undefined}>
      <div className="tile-label">
        {color && <span className="swatch" style={{ background: color }} />}
        {label}
        {delta && (
          <span key={delta.id} className="tile-delta">
            {delta.text}
          </span>
        )}
      </div>
      <div className="tile-value">
        <AnimatedNumber value={value} format={format} />
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
      {spark && <Sparkline values={spark} color={color ?? 'var(--accent)'} />}
    </div>
  )
}
