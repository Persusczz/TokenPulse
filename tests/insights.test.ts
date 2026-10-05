import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { computeAchievements } from '../src/main/achievements'
import { computeValue, forecastWeekly } from '../src/main/insights'
import { planLabel } from '../src/main/quota'
import { quotaEvents } from '../src/main/quotaEvents'

const DAY = 86_400_000
let n = 0
function entry(ts: number, o: Partial<CostedEntry> = {}, cost = 1): CostedEntry {
  return {
    key: `k${n++}`,
    ts,
    model: 'claude-opus-4',
    sessionId: 's1',
    project: 'p',
    projectPath: '/p',
    input: 1000,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    webSearch: 0,
    speed: 'standard',
    geo: null,
    cost: { input: cost, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 },
    ...o
  }
}
const money = (v: number) => `$${v.toFixed(2)}`

describe('subscription value', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()
  const month = new Date(2026, 9, 1).getTime()
  // $10 a day for the first ten days
  const entries = Array.from({ length: 10 }, (_, i) => entry(month + i * DAY + 3600_000, {}, 10))

  it('measures the month against the plan price and projects it', () => {
    const v = computeValue(entries, now, { plan: 'Pro', priceSetting: null, quotaHits: 0, money })
    expect(v.planPrice).toBe(20)
    expect(v.monthCost).toBe(100)
    expect(v.multiple).toBe(5)
    expect(v.projectedMonthCost).toBeCloseTo((100 / 9.5) * 31, 5)
    expect(v.daily).toHaveLength(10)
    expect(v.daily[9].cost).toBe(100)
    expect(v.verdict).toBe('keep')
    expect(v.advice).toContain('5.0 倍')
  })

  it('suggests Max when Pro keeps hitting the 5h limit', () => {
    expect(computeValue(entries, now, { plan: 'Pro', priceSetting: null, quotaHits: 4, money }).verdict).toBe('upgrade')
    expect(computeValue(entries.slice(0, 1), now, { plan: 'Max 20x', priceSetting: null, quotaHits: 0, money }).verdict).toBe('downgrade')
    const custom = computeValue(entries, now, { plan: 'Pro', priceSetting: 17, quotaHits: 0, money })
    expect(custom.planPrice).toBe(17)
    expect(custom.priceDetected).toBe(false)
  })

  it('reads the Max tier from the login', () => {
    expect(planLabel('max', 'default_claude_max_20x')).toBe('Max 20x')
    expect(planLabel('max', 'default_claude_max_5x')).toBe('Max 5x')
    expect(planLabel('pro', 'default_claude_ai')).toBe('Pro')
    expect(planLabel(undefined, 'x')).toBeUndefined()
  })
})

describe('7-day forecast', () => {
  const now = new Date(2026, 9, 10, 12, 0).getTime()
  const resetsAt = now + 3 * DAY
  const start = resetsAt - 7 * DAY
  // 4 days in, 40% used; 10k tokens per day so far
  const entries = Array.from({ length: 40 }, (_, i) => entry(start + (i + 0.5) * (DAY / 10)))

  it('projects the window to its reset and suggests a daily share', () => {
    const f = forecastWeekly(entries, { pct: 40, resetsAt }, now)
    expect(f.available).toBe(true)
    expect(f.avgPctPerDay).toBeCloseTo(10, 5)
    expect(f.tokensPerPct).toBeCloseTo(1000, 5)
    expect(f.recentPctPerDay).toBeCloseTo(10, 5)
    expect(f.projectedPct).toBeCloseTo(70, 5)
    expect(f.etaFull).toBeNull()
    expect(f.suggestPctPerDay).toBeCloseTo(55 / 3, 5)
    expect(f.suggestTokensPerDay).toBeCloseTo((55 / 3) * 1000, 3)
    expect(f.days[0]).toEqual({ t: start, pct: 0 })
    expect(f.days[f.days.length - 1]).toEqual({ t: now, pct: 40 })
  })

  it('reports when the window runs out at this pace', () => {
    const f = forecastWeekly(entries, { pct: 80, resetsAt }, now)
    expect(f.projectedPct).toBeGreaterThan(100)
    expect(f.etaFull).toBeGreaterThan(now)
    expect(f.etaFull).toBeLessThan(resetsAt)
    expect(forecastWeekly(entries, null, now).available).toBe(false)
    expect(forecastWeekly(entries, { pct: 10, resetsAt: now - 1 }, now).available).toBe(false)
  })
})

describe('achievements', () => {
  it('unlocks with the time the condition was first met and reports progress otherwise', () => {
    const d0 = new Date(2026, 8, 1, 10).getTime()
    const list = [
      // eight days in a row
      ...Array.from({ length: 8 }, (_, i) => entry(d0 + i * DAY)),
      // a big day: 2M tokens, high cache share
      entry(d0 + 9 * DAY, { input: 50_000, cacheRead: 1_950_000 }, 120),
      // three models
      entry(d0 + 9 * DAY + 1000, { model: 'claude-sonnet-4' }),
      entry(d0 + 9 * DAY + 2000, { model: 'claude-haiku-4' }),
      // night owl: 50 responses after midnight
      ...Array.from({ length: 50 }, (_, i) => entry(new Date(2026, 8, 12, 2, i).getTime()))
    ]
    const a = Object.fromEntries(computeAchievements(list).map((x) => [x.id, x]))
    expect(a['streak-7'].unlocked).toBe(true)
    expect(a['streak-7'].at).toBe(new Date(2026, 8, 7).getTime())
    expect(a['streak-30'].unlocked).toBe(false)
    expect(a['streak-30'].hint).toBe('最长连续 8 天')
    expect(a['day-1m'].unlocked).toBe(true)
    expect(a['day-10m'].unlocked).toBe(false)
    expect(a['day-10m'].progress).toBeCloseTo(0.2, 2)
    expect(a['cache-master'].unlocked).toBe(true)
    expect(a['big-day'].unlocked).toBe(true)
    expect(a.polyglot.unlocked).toBe(true)
    expect(a['night-owl'].unlocked).toBe(true)
    expect(a['night-owl'].at).toBe(new Date(2026, 8, 12, 2, 49).getTime())
    expect(a.guardian.unlocked).toBe(false)
    expect(a['streak-3'].at).toBe(new Date(2026, 8, 3).getTime())
    expect(computeAchievements([], { guard: { n: 2, first: 5 } }).find((x) => x.id === 'guardian')).toMatchObject({ unlocked: true, at: 5 })
  })

  it('has many badges in groups and tiers, with unique ids', () => {
    const list = computeAchievements([])
    expect(list.length).toBeGreaterThanOrEqual(45)
    expect(new Set(list.map((x) => x.id)).size).toBe(list.length)
    expect(new Set(list.map((x) => x.group))).toEqual(new Set(['volume', 'streak', 'time', 'efficiency', 'sessions', 'explore', 'guardian', 'cosmos', 'collect']))
    expect(list.filter((x) => x.tier === 4).length).toBeGreaterThanOrEqual(5)
    expect(list.every((x) => !x.unlocked && x.hint && x.progress === 0)).toBe(true)
  })

  it('reads parallel sessions, hours of the day, projects, search and fast mode', () => {
    const t0 = new Date(2026, 8, 20, 9, 0).getTime()
    const list = [
      // three sessions in the same ten minutes, then a fourth project
      ...['a', 'b', 'c'].map((s, i) => entry(t0 + i * 60_000, { sessionId: s, projectPath: `/p${i}` })),
      entry(t0 + 3600_000, { projectPath: '/p3', webSearch: 2 }),
      entry(t0 + 7200_000, { projectPath: '/p4', speed: 'fast' }),
      // every hour of one day
      ...Array.from({ length: 24 }, (_, h) => entry(new Date(2026, 8, 21, h, 30).getTime()))
    ].sort((x, y) => x.ts - y.ts)
    const a = Object.fromEntries(computeAchievements(list).map((x) => [x.id, x]))
    expect(a['multi-3'].unlocked).toBe(true)
    expect(a['multi-5'].hint).toBe('最多 3 个会话同时工作')
    expect(a['projects-5'].unlocked).toBe(true)
    expect(a.web).toMatchObject({ unlocked: true, hint: '已搜索 2 次' })
    expect(a.fast.unlocked).toBe(true)
    expect(a['round-clock'].unlocked).toBe(true)
    expect(a['all-hours'].at).toBe(new Date(2026, 8, 21, 23, 30).getTime())
  })

  it('unlocks app badges from counters, the tenth event for the bigger ones', () => {
    const a = Object.fromEntries(
      computeAchievements([], { tasks: { n: 12, first: 100, at10: 900 }, remote: { n: 1, first: 7 }, guard: { n: 3, first: 1 } }).map((x) => [x.id, x])
    )
    expect(a['task-1']).toMatchObject({ unlocked: true, at: 100 })
    expect(a['task-10']).toMatchObject({ unlocked: true, at: 900 })
    expect(a.remote.at).toBe(7)
    expect(a['guard-10']).toMatchObject({ unlocked: false, progress: 0.3, hint: '已暂停 3 次' })
    expect(a.sentinel.unlocked).toBe(false)
  })
})

describe('quota events', () => {
  const r = (pct: number, resetsAt = 1000) => ({ pct, resetsAt })
  it('reports crossings once per window and resets of busy windows', () => {
    expect(quotaEvents(null, { five: r(95), week: null })).toEqual([])
    expect(quotaEvents({ five: r(70), week: r(10) }, { five: r(92), week: r(12) })).toEqual([
      { kind: 'cross', window: 'five', pct: 92, mark: 90, resetsAt: 1000, key: 'five:1000:90' }
    ])
    // a new window after a busy one
    const reset = quotaEvents({ five: r(96, 1000), week: null }, { five: r(2, 2000), week: null })
    expect(reset).toEqual([{ kind: 'reset', window: 'five', pct: 2, resetsAt: 2000, key: 'five:reset:1000' }])
    // a quiet window rolling over says nothing
    expect(quotaEvents({ five: r(20, 1000), week: null }, { five: r(1, 2000), week: null })).toEqual([])
    expect(quotaEvents({ five: null, week: r(74) }, { five: null, week: r(76) })[0]).toMatchObject({ window: 'week', mark: 75 })
  })
})
