import { useEffect, useRef, useState } from 'react'
import { isReset } from '@shared/rewind'
import { useMotionLevel } from '../state'

/**
 * How a quota bar or ring moves. New usage makes it surge up with a bright
 * head; a window that resets rewinds it like a tape: it runs backwards,
 * faster and faster, down to zero, flashes, and fills to the new reading.
 *
 *   grow    rising to a higher reading (also the first fill on mount)
 *   rewind  running back to zero after a reset
 *   zero    the moment it hits zero
 *   refill  from zero to the new window's reading
 */
export type QuotaPhase = 'idle' | 'grow' | 'rewind' | 'zero' | 'refill'

export interface QuotaMotion {
  /** the value on screen, 0–100 */
  v: number
  phase: QuotaPhase
  /** what the latest rise added, in points (0 for the first fill) */
  delta: number
  /** counts animations, as a key to restart one-shot effects */
  run: number
}

const GROW_MS = 1000
const REWIND_MS = 1300
const ZERO_MS = 280
const REFILL_MS = 750

const outCubic = (t: number) => 1 - (1 - t) ** 3
/** a tape rewinding: slow to start, then racing */
const rewindEase = (t: number) => t ** 2.2


/** Where an animation stands `t` ms in: value and phase, or done */
function frame(kind: 'grow' | 'rewind', from: number, to: number, t: number): { v: number; phase: QuotaPhase; done: boolean } {
  if (kind === 'grow') {
    const k = Math.min(1, t / GROW_MS)
    return { v: from + (to - from) * outCubic(k), phase: k < 1 ? 'grow' : 'idle', done: k >= 1 }
  }
  if (t < REWIND_MS) {
    const k = t / REWIND_MS
    // a little judder on the way back, like a tape head skipping
    const judder = Math.sin(t / 22) * Math.min(1.2, from * 0.02) * (1 - k)
    return { v: Math.max(0, from * (1 - rewindEase(k)) + judder), phase: 'rewind', done: false }
  }
  if (t < REWIND_MS + ZERO_MS) return { v: 0, phase: 'zero', done: false }
  const k = Math.min(1, (t - REWIND_MS - ZERO_MS) / REFILL_MS)
  return { v: to * outCubic(k), phase: k < 1 ? 'refill' : 'idle', done: k >= 1 }
}

export function useQuotaMotion(pct: number, resetsAt: string | null | undefined): QuotaMotion {
  const level = useMotionLevel()
  const target = Math.max(0, Math.min(100, pct))
  const [m, setM] = useState<QuotaMotion>(() => ({ v: level ? 0 : target, phase: 'idle', delta: 0, run: 0 }))
  const shown = useRef(level ? 0 : target)
  const last = useRef<{ pct: number; reset: number } | null>(null)
  const runs = useRef(0)

  useEffect(() => {
    const reset = resetsAt ? Date.parse(resetsAt) : NaN
    const prev = last.current
    last.current = { pct: target, reset }
    if (!level) {
      shown.current = target
      setM((x) => ({ ...x, v: target, phase: 'idle' }))
      return
    }
    const from = shown.current
    const kind = prev && isReset(prev, target, reset) ? 'rewind' : 'grow'
    if (kind === 'grow' && Math.abs(target - from) < 0.05) {
      shown.current = target
      setM((x) => (x.phase === 'idle' && x.v === target ? x : { ...x, v: target, phase: 'idle' }))
      return
    }
    const run = ++runs.current
    const delta = kind === 'grow' && prev && target > prev.pct ? target - prev.pct : 0
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const f = frame(kind, from, target, now - t0)
      shown.current = f.v
      setM({ v: f.v, phase: f.phase, delta, run })
      if (!f.done) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, resetsAt, level])

  return m
}

/** The small "⏪ 重置" / "已刷新" tag a rewinding meter shows */
export function RewindTag({ phase }: { phase: QuotaPhase }) {
  if (phase === 'rewind') return <span className="q-tag rw">⏪ 重置</span>
  if (phase === 'zero' || phase === 'refill') return <span className="q-tag fresh">已刷新</span>
  return null
}
