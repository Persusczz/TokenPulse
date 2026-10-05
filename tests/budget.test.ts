import { describe, expect, it } from 'vitest'
import type { LiveStats } from '@shared/types'
import { checkBudgets, pruneFired } from '../src/main/budget'
import { DEFAULT_SETTINGS } from '../src/main/settings'

const NOW = new Date(2026, 9, 3, 12).getTime()
const live = (todayCost: number, monthCost = 0): LiveStats => ({
  now: NOW,
  today: { tokens: 0, cost: todayCost, messages: 0 },
  monthCost,
  tokensPerMin: 0,
  costPerHour: 0,
  intensity: 0,
  projectedTodayCost: 0,
  capacity: 1,
  capacityFromBudget: false,
  dailyAvgCost: 0,
  lastEntryAt: null,
  totalEntries: 0
})

describe('checkBudgets', () => {
  const s = { ...DEFAULT_SETTINGS, dailyBudget: 10, monthlyBudget: 100 }

  it('fires 80% once, then 100% once', () => {
    const fired = new Set<string>()
    expect(checkBudgets(live(8.5), s, fired).map((a) => a.key)).toEqual(['d:2026-10-03:0.8'])
    expect(checkBudgets(live(9), s, fired)).toEqual([])
    expect(checkBudgets(live(10.2), s, fired).map((a) => a.key)).toEqual(['d:2026-10-03:1'])
    expect(checkBudgets(live(12), s, fired)).toEqual([])
  })

  it('skips the 80% alert when jumping past 100%', () => {
    const fired = new Set<string>()
    const alerts = checkBudgets(live(0, 150), s, fired)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].title).toBe('本月预算已用完')
    expect(checkBudgets(live(0, 150), s, fired)).toEqual([])
  })

  it('does nothing without budgets', () => {
    expect(checkBudgets(live(1e6, 1e6), DEFAULT_SETTINGS, new Set())).toEqual([])
  })

  it('prunes keys of past periods', () => {
    const fired = new Set(['d:2026-10-02:0.8', 'd:2026-10-03:1', 'm:2026-09:1', 'm:2026-10:0.8'])
    pruneFired(fired, NOW)
    expect([...fired]).toEqual(['d:2026-10-03:1', 'm:2026-10:0.8'])
  })
})
