import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { calendarDays, modelRows, todaySessions } from '../src/main/overviewData'

const MIN = 60_000
const HOUR = 60 * MIN
const NOW = new Date(2026, 9, 7, 18, 0).getTime() // a Wednesday
const TODAY = new Date(2026, 9, 7).getTime()

let n = 0
const e = (ts: number, o: Partial<CostedEntry> = {}, cost = 0.5): CostedEntry => ({
  key: `o${n++}`,
  ts,
  model: 'opus',
  sessionId: 's1',
  project: 'app',
  projectPath: '/app',
  input: 100,
  output: 400,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 500,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { input: cost, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 },
  source: 'claude',
  ...o
})

describe('overview: calendar', () => {
  it('lays out 12 weeks from a Monday up to today, with each day’s numbers', () => {
    const entries = [e(TODAY - 2 * 86_400_000 + 9 * HOUR), e(TODAY + 9 * HOUR, { model: 'haiku', project: 'web' }), e(TODAY + 10 * HOUR, { sessionId: 's2' })]
    const days = calendarDays(entries, NOW, (m) => m)
    expect(new Date(days[0].t).getDay()).toBe(1)
    expect(days[days.length - 1].t).toBe(TODAY)
    expect(days).toHaveLength(11 * 7 + 3)
    const today = days[days.length - 1]
    expect(today).toMatchObject({ tokens: 2000, cost: 1, messages: 2, sessions: 2, busiest: 9 })
    expect(today.projects.map((p) => p.name).sort()).toEqual(['app', 'web'])
    expect(days[days.length - 3].tokens).toBe(1000)
  })
})

describe('overview: today’s sessions', () => {
  it('spans each session from its first to its last response, in 10-minute steps', () => {
    // entries come sorted by time
    const list = todaySessions([e(TODAY - HOUR), e(TODAY + 9 * HOUR), e(TODAY + 9 * HOUR + 25 * MIN), e(TODAY + 11 * HOUR, { sessionId: 'b', source: 'codex', model: 'gpt' })], NOW, (m) => m)
    expect(list.map((s) => s.id)).toEqual(['s1', 'b'])
    expect(list[0]).toMatchObject({ start: TODAY + 9 * HOUR, end: TODAY + 9 * HOUR + 25 * MIN, messages: 2, model: 'opus' })
    expect(list[0].bins).toEqual([1000, 0, 1000])
    expect(list[1]).toMatchObject({ source: 'codex', model: 'gpt' })
  })
})

describe('overview: models', () => {
  it('adds up each model and the questions it answered', () => {
    const rows = modelRows([e(TODAY + HOUR), e(TODAY + 2 * HOUR), e(TODAY + 3 * HOUR, { model: 'haiku' }, 0.05)], TODAY, NOW, (m) => m, [
      { models: ['opus'], cost: 1 } as never,
      { models: ['haiku'], cost: 0.05 } as never
    ])
    expect(rows.map((r) => [r.name, r.messages, r.prompts])).toEqual([
      ['opus', 2, 1],
      ['haiku', 1, 1]
    ])
    expect(rows[0]).toMatchObject({ tokens: 2000, cost: 1, output: 800, cacheRead: 1000, promptCost: 1 })
  })
})
