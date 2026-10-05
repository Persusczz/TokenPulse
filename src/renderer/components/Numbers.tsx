import { animate } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from '../state'

const DIGITS = '0123456789'.split('')

/** Rolling-digit counter; place values are keyed from the right so they stay stable */
export function Odometer({ text, className }: { text: string; className?: string }) {
  const chars = [...text]
  return (
    <span className={`odo ${className ?? ''}`} aria-label={text}>
      {chars.map((ch, i) => {
        const key = chars.length - i
        if (!/\d/.test(ch))
          return (
            <span key={`s${key}`} className="odo-sym">
              {ch}
            </span>
          )
        return (
          <span key={`d${key}`} className="odo-digit" aria-hidden>
            <span className="odo-strip" style={{ transform: `translateY(${-Number(ch) * 10}%)` }}>
              {DIGITS.map((n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        )
      })}
    </span>
  )
}

/** Number that tweens to its new value; formatting runs per frame without re-rendering */
export function AnimatedNumber({ value, format }: { value: number; format: (v: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  /** value currently on screen, which may be mid-tween */
  const shown = useRef(value)
  const fmt = useRef(format)
  fmt.current = format
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const paint = (v: number) => {
      shown.current = v
      if (ref.current) ref.current.textContent = fmt.current(v)
    }
    if (reduced || shown.current === value) {
      paint(value)
      return
    }
    const c = animate(shown.current, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: paint })
    return () => c.stop()
  }, [value, reduced])

  // a format change (e.g. currency) repaints the settled value
  useEffect(() => {
    if (ref.current) ref.current.textContent = format(shown.current)
  }, [format])

  // React never re-renders the text; the effects own it after mount
  const [initial] = useState(() => format(value))
  return <span ref={ref}>{initial}</span>
}
