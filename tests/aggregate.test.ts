import { describe, expect, it } from 'vitest'
import {
  addDays,
  bucketStarts,
  computeLive,
  computeSessions,
  computeSummary,
  niceCeil,
  rangeBounds,
  startOfDay,
  type CostedEntry
} from '../src/main/aggregate'
import { ZERO_COST } from '../src/main/pricing/cost'

const NOW = new Date(2026, 9, 3, 15, 30).getTime()

let n = 0
const e = (ts: number, p: Partial<CostedEntry> = {}): CostedEntry => ({
  key: `k${n++}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's1',
  project: 'demo',
  projectPath: 'demo',
  input: 10,
  output: 20,
  cacheWrite5m: 30,
  cacheWrite1h: 0,
  cacheRead: 40,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { ...ZERO_COST, input: 0.5, output: 0.5, total: 1 },
  ...p
})

const label = (m: string) => m

describe('rangeBounds', () => {
  it('today runs midnight to midnight with yesterday-to-same-time comparison', () => {
    const b = rangeBounds('today', NOW, null)
    expect(b.start).toBe(new Date(2026, 9, 3).getTime())
    expect(b.end).toBe(new Date(2026, 9, 4).getTime())
    expect(b.prev).toEqual([new Date(2026, 9, 2).getTime(), new Date(2026, 9, 2, 15, 30).getTime()])
    expect(bucketStarts(b)).toHaveLength(24)
  })

  it('7d and 30d include today', () => {
    expect(bucketStarts(rangeBounds('7d', NOW, null))).toHaveLength(7)
    expect(rangeBounds('7d', NOW, null).start).toBe(new Date(2026, 8, 27).getTime())
    expect(bucketStarts(rangeBounds('30d', NOW, null))).toHaveLength(30)
  })

  it('month spans the calendar month and compares month-to-date', () => {
    const b = rangeBounds('month', NOW, null)
    expect(b.start).toBe(new Date(2026, 9, 1).getTime())
    expect(b.end).toBe(new Date(2026, 10, 1).getTime())
    expect(bucketStarts(b)).toHaveLength(31)
    expect(b.prev?.[0]).toBe(new Date(2026, 8, 1).getTime())
  })

  it('all switches to weekly buckets past 120 days', () => {
    expect(rangeBounds('all', NOW, addDays(NOW, -30)).unit).toBe('day')
    const b = rangeBounds('all', NOW, addDays(NOW, -200))
    expect(b.unit).toBe('week')
    expect(new Date(b.start).getDay()).toBe(1)
  })
})

describe('computeSummary', () => {
  const today = startOfDay(NOW)
  const entries = [
    e(today + 3600_000, { sessionId: 'a' }),
    e(today + 2 * 3600_000, { sessionId: 'b', project: 'other', model: 'claude-haiku-4-5' }),
    e(today - 3600_000, { sessionId: 'c' }),
    e(addDays(today, -1) + 3600_000)
  ]

  it('totals only entries inside the range', () => {
    const s = computeSummary(entries, 'today', NOW, label)
    expect(s.totals.messages).toBe(2)
    expect(s.totals.tokens).toBe(200)
    expect(s.totals.cost).toBeCloseTo(2)
    expect(s.totals.sessions).toBe(2)
    expect(s.buckets[1].tokens).toBe(100)
    expect(s.buckets[2].tokens).toBe(100)
    expect(s.previous).toEqual({ tokens: 100, cost: 1 })
    expect(s.cacheHitRate).toBeCloseTo(40 / 80)
    expect(s.byModel.map((m) => m.name)).toEqual(expect.arrayContaining(['claude-opus-5-5', 'claude-haiku-4-5']))
    expect(s.byProject.map((p) => p.name).sort()).toEqual(['demo', 'other'])
  })

  it('includes a heatmap only for all', () => {
    expect(computeSummary(entries, '7d', NOW, label).heatmap).toBeNull()
    const heat = computeSummary(entries, 'all', NOW, label).heatmap!
    expect(heat.at(-1)?.tokens).toBe(200)
  })
})

describe('computeLive', () => {
  it('reports burn rate, intensity and budget capacity', () => {
    const entries = [e(NOW - 60_000, { input: 100_000 }), e(addDays(NOW, -2))]
    const live = computeLive(entries, NOW, 20)
    expect(live.today.messages).toBe(1)
    expect(live.tokensPerMin).toBeCloseTo((100_000 + 90) / 10)
    expect(live.intensity).toBeGreaterThan(0)
    expect(live.capacity).toBe(20)
    expect(live.capacityFromBudget).toBe(true)
    expect(live.dailyAvgCost).toBe(1)
    // 1.5x the daily average, rounded up to a nice number
    expect(computeLive(entries, NOW, null).capacity).toBe(2)
  })

  it('never overflows the adaptive capacity on a heavy first day', () => {
    const live = computeLive([e(NOW - 60_000, { cost: { ...ZERO_COST, total: 60.73 } })], NOW, null)
    expect(live.capacity).toBe(100)
    expect(live.capacityFromBudget).toBe(false)
  })

  it('rounds capacities to 1/2/2.5/5 steps', () => {
    expect([0.3, 1, 1.2, 2.2, 3, 7, 61, 240].map(niceCeil)).toEqual([0.5, 1, 2, 2.5, 5, 10, 100, 250])
  })

  it('is calm with no recent activity', () => {
    expect(computeLive([e(NOW - 3 * 3600_000)], NOW, null).intensity).toBe(0)
  })
})

describe('computeSessions', () => {
  it('groups by session with reported cost', () => {
    const rows = computeSessions([e(NOW - 1000, { sessionId: 'x' }), e(NOW, { sessionId: 'x' })], new Map([['x', 2.5]]), label)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ messages: 2, cost: 2, reportedCost: 2.5 })
  })
})
