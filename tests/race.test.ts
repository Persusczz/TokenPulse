import { describe, expect, it } from 'vitest'
import type { PromptMark } from '../src/shared/types'
import type { CostedEntry } from '../src/main/aggregate'
import { raceSeries, starMap } from '../src/main/race'

const HOUR = 3600_000
let n = 0
function entry(ts: number, sessionId: string, cost: number): CostedEntry {
  return {
    key: `k${n++}`,
    ts,
    model: 'claude-opus-4',
    sessionId,
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
    cost: { input: cost, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 }
  }
}
const mark = (sessionId: string, ts: number, text: string): PromptMark => ({ key: `${sessionId}@${ts}`, sessionId, ts, text, project: 'G:\\code\\demo', source: 'claude' })
function indexOf(marks: PromptMark[]): Map<string, PromptMark[]> {
  const m = new Map<string, PromptMark[]>()
  for (const p of [...marks].sort((a, b) => a.ts - b.ts)) m.set(p.sessionId, [...(m.get(p.sessionId) ?? []), p])
  return m
}

// Wednesday 2026-10-07, noon local time
const NOW = new Date(2026, 9, 7, 12, 0).getTime()
const at = (month: number, day: number, h: number) => new Date(2026, month - 1, day, h, 0).getTime()

describe('the star map', () => {
  it('draws each prompt with its cost and joins a session into one constellation', () => {
    const marks = [mark('a', at(10, 6, 9), 'first'), mark('a', at(10, 6, 10), 'second'), mark('b', at(10, 7, 8), 'other')]
    const entries = [entry(at(10, 6, 9) + 60_000, 'a', 1), entry(at(10, 6, 10) + 60_000, 'a', 2), entry(at(10, 6, 10) + 120_000, 'a', 0.5), entry(at(10, 7, 8) + 60_000, 'b', 4)]
    const m = starMap(entries, indexOf(marks), 30, NOW)
    expect(m.prompts.map((p) => [p.text, p.cost])).toEqual([
      ['first', 1],
      ['second', 2.5],
      ['other', 4]
    ])
    const a = m.sessions.find((s) => s.id === 'a')!
    expect(a).toMatchObject({ prompts: 2, cost: 3.5, first: at(10, 6, 9), last: at(10, 6, 10) })
    // the planets: what each model took
    expect(m.models).toEqual([{ name: 'claude-opus-4', source: 'claude', cost: 7.5, tokens: 4000, requests: 4 }])
  })

  it('starts on the first day with records instead of leaving the map empty on the left', () => {
    const marks = [mark('a', at(9, 30, 14), 'old'), mark('b', at(10, 7, 8), 'new')]
    const entries = [entry(at(9, 30, 14) + 60_000, 'a', 1), entry(at(10, 7, 8) + 60_000, 'b', 1)]
    const m = starMap(entries, indexOf(marks), 30, NOW)
    expect(m.asked).toBe(30)
    expect(m.days).toBe(8) // 9/30 … 10/7
    expect(m.from).toBe(at(9, 30, 0))
    expect(m.since).toBe(at(9, 30, 14) + 60_000)
    expect(m.prompts).toHaveLength(2)
  })

  it('keeps at least three days, and the whole span when records go back further', () => {
    const today = starMap([entry(at(10, 7, 8) + 60_000, 'b', 1)], indexOf([mark('b', at(10, 7, 8), 'x')]), 7, NOW)
    expect(today.days).toBe(3)
    expect(today.from).toBe(at(10, 5, 0))
    expect(starMap([], new Map(), 30, NOW).days).toBe(3)
    // older history: a quiet stretch inside the span stays on the map
    const old = starMap(
      [entry(at(9, 1, 8) + 60_000, 'c', 1), entry(at(10, 6, 8) + 60_000, 'b', 1)],
      indexOf([mark('c', at(9, 1, 8), 'y'), mark('b', at(10, 6, 8), 'z')]),
      7,
      NOW
    )
    expect(old.days).toBe(7)
    expect(old.from).toBe(at(10, 1, 0))
    expect(old.prompts.map((p) => p.text)).toEqual(['z'])
  })
})

describe('this week against last week', () => {
  const entries = [entry(at(9, 28, 10), 's', 1), entry(at(9, 30, 10), 's', 2), entry(at(10, 5, 9), 's', 3), entry(at(10, 7, 11), 's', 4)]

  it('runs both weeks hour by hour from Monday, this one only up to now', () => {
    const r = raceSeries(entries, 'week', NOW)
    expect(r.start).toBe(at(10, 5, 0))
    expect(r.prevStart).toBe(at(9, 28, 0))
    expect(r.steps).toBe(168)
    expect(r.cur).toHaveLength(60) // Monday 00:00 to Wednesday noon
    expect(r.cur[59].cost).toBe(7)
    expect(r.prev).toHaveLength(168)
    expect(r.prev[9].cost).toBe(0) // the hour that ends at 10:00 Monday
    expect(r.prev[10].cost).toBe(1)
    expect(r.prev[167].cost).toBe(3)
  })

  it('runs months day by day', () => {
    const r = raceSeries(entries, 'month', NOW)
    expect(r.start).toBe(at(10, 1, 0))
    expect(r.prevStart).toBe(at(9, 1, 0))
    expect(r.steps).toBe(31)
    expect(r.prevSteps).toBe(30)
    expect(r.cur.at(-1)!.cost).toBe(7)
    expect(r.prev.at(-1)!.cost).toBe(3)
  })
})
