import { useEffect, useState } from 'react'
import { useMotionLevel } from '../state'

/**
 * Water-like rings spreading from the centre of the parent (which must be
 * positioned) each time `trigger` changes to a new truthy value.
 */
export function PulseRings({ trigger, color = 'var(--accent)', rings = 3 }: { trigger: number; color?: string; rings?: number }) {
  const level = useMotionLevel()
  const [waves, setWaves] = useState<number[]>([])
  useEffect(() => {
    if (trigger && level) setWaves((w) => [...w.slice(-2), trigger])
  }, [trigger]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = level >= 3 ? rings + 1 : level === 1 ? 1 : rings
  return (
    <span className="pulse-rings" aria-hidden>
      {waves.map((id) => (
        <span key={id} className="pulse-wave" style={{ ['--c' as string]: color }}>
          {Array.from({ length: n }, (_, i) => (
            <i
              key={i}
              style={{ animationDelay: `${i * 0.24}s` }}
              onAnimationEnd={i === n - 1 ? () => setWaves((w) => w.filter((x) => x !== id)) : undefined}
            />
          ))}
        </span>
      ))}
    </span>
  )
}
