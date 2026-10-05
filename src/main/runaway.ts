import type { RunawayAlert } from '@shared/types'
import { tokensOf, type CostedEntry } from './aggregate'
import { lowerBound } from './rate'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const WINDOW = 5 * MIN

export type Sensitivity = 'low' | 'medium' | 'high'
/** a burst is this many times the usual heavy 5 minutes … */
const FACTOR: Record<Sensitivity, number> = { low: 5, medium: 3.5, high: 2.5 }
/** … and never less than this (USD, API-equivalent) */
const FLOOR: Record<Sensitivity, number> = { low: 8, medium: 5, high: 3 }
/** responses in a row with the same output size that count as a loop */
const LOOP_RUN: Record<Sensitivity, number> = { low: 18, medium: 14, high: 10 }

/**
 * The usual heavy 5 minutes: the 90th percentile of per-session 5-minute
 * API-equivalent cost over the last 7 days. 0 while there is too little history.
 */
export function runawayBaseline(entries: CostedEntry[], now: number): number {
  const buckets = new Map<string, number>()
  for (let i = lowerBound(entries, now - 7 * DAY); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    const k = `${e.sessionId}|${Math.floor(e.ts / WINDOW)}`
    buckets.set(k, (buckets.get(k) ?? 0) + e.cost.total)
  }
  const vals = [...buckets.values()].filter((v) => v > 0).sort((a, b) => a - b)
  return vals.length < 12 ? 0 : vals[Math.floor(vals.length * 0.9)]
}

/**
 * Sessions burning far faster than usual in the last 5 minutes ("burst"), or
 * repeating the same response over and over in the last 10 ("loop": the same
 * output size many times in a row, as when a tool call keeps failing the
 * same way).
 */
export function detectRunaway(
  entries: CostedEntry[],
  now: number,
  o: { baseline: number; sensitivity: Sensitivity }
): Omit<RunawayAlert, 'held'>[] {
  const bySession = new Map<string, CostedEntry[]>()
  for (let i = lowerBound(entries, now - 10 * MIN); i < entries.length && entries[i].ts <= now; i++) {
    const e = entries[i]
    if (!e.sessionId) continue
    const list = bySession.get(e.sessionId) ?? []
    list.push(e)
    bySession.set(e.sessionId, list)
  }
  const threshold = Math.max(FLOOR[o.sensitivity], o.baseline * FACTOR[o.sensitivity])
  const out: Omit<RunawayAlert, 'held'>[] = []
  for (const [sessionId, list] of bySession) {
    const recent = list.filter((e) => e.ts > now - WINDOW)
    const cost5 = recent.reduce((s, e) => s + e.cost.total, 0)
    const tokens5 = recent.reduce((s, e) => s + tokensOf(e), 0)
    const last = list[list.length - 1]
    let repeats = 0
    if (last.output > 0) {
      const tol = Math.max(2, last.output * 0.01)
      for (let j = list.length - 1; j >= 0 && list[j].output > 0 && Math.abs(list[j].output - last.output) <= tol; j--) repeats++
    }
    const base = {
      sessionId,
      project: last.project,
      cost5,
      tokens5,
      requests5: recent.length,
      ratio: o.baseline > 0 ? cost5 / o.baseline : 0,
      repeats,
      at: now
    }
    if (repeats >= LOOP_RUN[o.sensitivity]) out.push({ ...base, kind: 'loop' })
    else if (recent.length >= 3 && cost5 >= threshold) out.push({ ...base, kind: 'burst' })
  }
  return out
}
