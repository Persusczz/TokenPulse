import type { RateStats } from '@shared/types'
import { niceCeil, startOfDay, tokensOf, type CostedEntry } from './aggregate'

const MIN = 60_000
const POINTS = 60

/** First index whose ts >= t; `entries` must be sorted by ts */
export function lowerBound(entries: CostedEntry[], t: number): number {
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
 * The 5-hour window active at `now` as seen in local logs: a window opens at
 * the first response after the previous one closed (rounded down to the hour)
 * and lasts five hours. Null when no window is open.
 */
export function blockWindow(entries: CostedEntry[], now: number): { start: number; end: number } | null {
  const span = 5 * 60 * MIN
  let start: number | null = null
  for (let i = lowerBound(entries, now - 4 * span); i < entries.length && entries[i].ts <= now; i++) {
    const t = entries[i].ts
    if (start === null || t >= start + span) start = Math.floor(t / (60 * MIN)) * 60 * MIN
  }
  return start !== null && now < start + span ? { start, end: start + span } : null
}

/** Sum of API-equivalent cost in [start, end) */
export function spendBetween(entries: CostedEntry[], start: number, end: number): number {
  let sum = 0
  for (let i = lowerBound(entries, start); i < entries.length && entries[i].ts < end; i++) sum += entries[i].cost.total
  return sum
}

/** Throughput over the last hour, per minute, plus today's busiest minute */
export function computeRate(entries: CostedEntry[], now: number): RateStats {
  const first = Math.floor(now / MIN) * MIN - (POINTS - 1) * MIN
  const perMinute = Array.from({ length: POINTS }, (_, i) => ({ t: first + i * MIN, tokens: 0, output: 0, cost: 0, requests: 0 }))
  let tokens1 = 0
  let input1 = 0
  let output1 = 0
  let tokens5 = 0
  let output5 = 0
  let requests5 = 0
  let cost60 = 0

  for (let i = lowerBound(entries, now - 60 * MIN); i < entries.length; i++) {
    const e = entries[i]
    if (e.ts > now) break
    const tk = tokensOf(e)
    cost60 += e.cost.total
    if (e.ts > now - MIN) {
      tokens1 += tk
      input1 += e.input + e.cacheWrite5m + e.cacheWrite1h
      output1 += e.output
    }
    if (e.ts > now - 5 * MIN) {
      tokens5 += tk
      output5 += e.output
      requests5++
    }
    const p = perMinute[Math.floor((e.ts - first) / MIN)]
    if (p) {
      p.tokens += tk
      p.output += e.output
      p.cost += e.cost.total
      p.requests++
    }
  }

  const minutes = new Map<number, number>()
  for (let i = lowerBound(entries, startOfDay(now)); i < entries.length && entries[i].ts <= now; i++) {
    const m = Math.floor(entries[i].ts / MIN) * MIN
    minutes.set(m, (minutes.get(m) ?? 0) + tokensOf(entries[i]))
  }
  let peakPerMin = 0
  let peakAt: number | null = null
  for (const [m, v] of minutes) {
    if (v > peakPerMin) {
      peakPerMin = v
      peakAt = m
    }
  }

  return {
    now,
    perMinute,
    tokensPerMin: tokens1,
    inputTpm: input1,
    outputTpm: output1,
    tokensPerMin5: tokens5 / 5,
    outputPerSec: output5 / 300,
    requestsPerMin: requests5 / 5,
    costPerHour: cost60,
    peakPerMin,
    peakAt,
    // the needle should rarely pin: scale to today's peak, with a floor so idle days still read sensibly
    scale: niceCeil(Math.max(peakPerMin, tokens1 * 1.1, 50_000))
  }
}
