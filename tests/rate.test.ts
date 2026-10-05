import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { ZERO_COST } from '../src/main/pricing/cost'
import { blockWindow, computeRate, lowerBound, spendBetween } from '../src/main/rate'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 3, 15, 30, 20).getTime()

let n = 0
const e = (ts: number, p: Partial<CostedEntry> = {}): CostedEntry => ({
  key: `r${n++}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's',
  project: 'p',
  projectPath: 'p',
  input: 100,
  output: 600,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 300,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { ...ZERO_COST, total: 0.5 },
  ...p
})

describe('computeRate', () => {
  const entries = [
    e(NOW - 3 * HOUR),
    e(NOW - 30 * MIN),
    e(NOW - 4 * MIN),
    e(NOW - 2 * MIN),
    e(NOW - 30_000),
    e(NOW - 10_000, { cacheRead: 5300 })
  ]
  const r = computeRate(entries, NOW)

  it('buckets the last hour per minute, ending at the current minute', () => {
    expect(r.perMinute).toHaveLength(60)
    expect(r.perMinute.at(-1)!.t).toBe(Math.floor(NOW / MIN) * MIN)
    expect(r.perMinute.reduce((s, p) => s + p.requests, 0)).toBe(5)
    // NOW is hh:30:20, so the entry 30 s ago belongs to the previous minute
    expect(r.perMinute.at(-1)!.tokens).toBe(6000)
    expect(r.perMinute.at(-2)!.tokens).toBe(1000)
  })

  it('reports the last minute, the 5-minute average and output speed', () => {
    expect(r.tokensPerMin).toBe(7000)
    expect(r.tokensPerMin5).toBe((3 * 1000 + 6000) / 5)
    expect(r.outputPerSec).toBeCloseTo((4 * 600) / 300)
    expect(r.requestsPerMin).toBeCloseTo(4 / 5)
    expect(r.costPerHour).toBeCloseTo(2.5)
  })

  it('finds today’s busiest minute and scales the gauge above it', () => {
    expect(r.peakPerMin).toBe(6000)
    expect(r.peakAt).toBe(Math.floor((NOW - 10_000) / MIN) * MIN)
    expect(r.scale).toBeGreaterThanOrEqual(50_000)
  })

  it('is quiet with no recent data', () => {
    const q = computeRate([e(NOW - 2 * HOUR)], NOW)
    expect(q.tokensPerMin).toBe(0)
    expect(q.perMinute.every((p) => p.tokens === 0)).toBe(true)
  })
})

describe('5h window helpers', () => {
  it('opens a window at the hour of the first response after the last one closed', () => {
    const t0 = new Date(2026, 9, 3, 9, 40).getTime()
    const list = [e(t0 - 7 * HOUR), e(t0), e(t0 + HOUR), e(t0 + 4 * HOUR)]
    const w = blockWindow(list, t0 + 4 * HOUR + MIN)!
    expect(w.start).toBe(new Date(2026, 9, 3, 9).getTime())
    expect(w.end - w.start).toBe(5 * HOUR)
    expect(blockWindow(list, w.end + 1)).toBeNull()
  })

  it('sums spend in a half-open range', () => {
    const list = [e(1000), e(2000), e(3000)]
    expect(lowerBound(list, 2000)).toBe(1)
    expect(spendBetween(list, 1000, 3000)).toBeCloseTo(1)
  })
})
