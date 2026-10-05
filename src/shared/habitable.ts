/**
 * The habitable zone of a quota window: the burn rate that uses exactly what
 * is left by the reset. Faster is too hot (it runs dry early), much slower is
 * too cold (quota goes unused), in between is just right.
 */
export interface Habitability {
  /** percent per hour right now */
  rate: number
  /** percent per hour that lands on 100% at the reset */
  ideal: number
  /** rate / ideal; Infinity when nothing is left */
  ratio: number
  zone: 'hot' | 'habitable' | 'cold' | 'empty'
}

export const HOT = 1.15
export const COLD = 0.6

export function habitability(pct: number, rate: number, end: number, now: number): Habitability {
  const left = Math.max(0, 100 - pct)
  const hours = Math.max(1 / 60, (end - now) / 3_600_000)
  const ideal = left / hours
  if (left <= 0) return { rate, ideal: 0, ratio: Infinity, zone: 'empty' }
  const ratio = rate / Math.max(1e-6, ideal)
  return { rate, ideal, ratio, zone: ratio > HOT ? 'hot' : ratio < COLD ? 'cold' : 'habitable' }
}
