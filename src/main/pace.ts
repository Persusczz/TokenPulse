import type { Pace, UsageSource } from '@shared/types'
import { tokensOf, type CostedEntry } from './aggregate'

const MIN = 60_000
const HOUR = 60 * MIN

export interface PaceWindow {
  key: string
  label: string
  source: UsageSource
  /** percent used, as reported */
  pct: number
  resetsAt: number
  durationMs: number
}

/** First index with ts >= t (entries sorted by time) */
function lowerBound(entries: CostedEntry[], t: number): number {
  let lo = 0
  let hi = entries.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (entries[mid].ts < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * A window's pace against an even line from its start to its reset. Local
 * usage (API-equivalent cost, or tokens when unpriced) is scaled to the
 * reported percentage to draw the curve; the projection blends the recent
 * pace (last 45 min of a 5h window, last day of a week) with the average.
 */
export function computePace(entries: CostedEntry[], w: PaceWindow, now: number): Pace {
  const end = w.resetsAt
  const start = end - w.durationMs
  const elapsed = Math.max(MIN, Math.min(w.durationMs, now - start))
  const ideal = Math.max(0, Math.min(100, ((now - start) / w.durationMs) * 100))
  const win = entries.slice(lowerBound(entries, start), lowerBound(entries, now + 1))
  const byCost = win.some((e) => e.cost.total > 0)
  const weight = (e: CostedEntry) => (byCost ? e.cost.total : tokensOf(e))
  const total = win.reduce((s, e) => s + weight(e), 0)
  const scale = total > 0 ? w.pct / total : 0

  // the curve, thinned to at most ~90 points
  const curve: { t: number; pct: number }[] = [{ t: start, pct: 0 }]
  const step = Math.max(1, Math.ceil(win.length / 90))
  let acc = 0
  win.forEach((e, i) => {
    acc += weight(e)
    if (i % step === step - 1) curve.push({ t: e.ts, pct: acc * scale })
  })
  curve.push({ t: Math.min(now, end), pct: w.pct })

  const recentMs = Math.min(elapsed, w.durationMs <= 6 * HOUR ? 45 * MIN : 24 * HOUR)
  const recent = win.slice(lowerBound(win, now - recentMs)).reduce((s, e) => s + weight(e), 0) * scale
  const avgRate = w.pct / elapsed
  const rate = total > 0 ? 0.7 * (recent / recentMs) + 0.3 * avgRate : avgRate
  const left = Math.max(0, end - now)
  const projected = w.pct + rate * left
  const eta = rate > 0 && w.pct < 100 ? now + (100 - w.pct) / rate : null
  return {
    key: w.key,
    label: w.label,
    source: w.source,
    pct: w.pct,
    start,
    end,
    ideal,
    lead: w.pct - ideal,
    pctPerHour: rate * HOUR,
    projected,
    etaFull: eta !== null && eta < end ? eta : null,
    unused: Math.max(0, 100 - projected),
    curve
  }
}

export interface WasteRule {
  /** how long before the reset to remind */
  leadMs: number
  /** percent that would go unused */
  minUnused: number
}

/** 5h windows: the chosen lead time, 35% unused; weekly windows: the last day, 25% unused */
export const wasteRule = (p: Pace, leadMin: number): WasteRule =>
  p.end - p.start <= 6 * HOUR ? { leadMs: leadMin * MIN, minUnused: 35 } : { leadMs: 24 * HOUR, minUnused: 25 }

/** The window resets soon with a good share of it unused */
export function wasteDue(p: Pace, now: number, rule: WasteRule): boolean {
  const left = p.end - now
  return left > 0 && left <= rule.leadMs && p.unused >= rule.minUnused
}
