import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { buildCycles } from '../src/main/cycles'
import { ZERO_COST } from '../src/main/pricing/cost'
import { noteWeek, type LoggedWeek } from '../src/main/windowHistory'

const H = 3_600_000
const D = 24 * H
const T0 = Date.UTC(2026, 9, 5, 0)
const at = (h: number, m = 0) => T0 + h * H + m * 60_000

let n = 0
const e = (ts: number, p: Partial<CostedEntry> = {}): CostedEntry => ({
  key: `k${n++}`,
  ts,
  model: 'opus',
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
  cost: { ...ZERO_COST, total: 1 },
  ...p
})
const label = (m: string) => m.toUpperCase()

describe('quota cycles', () => {
  it('opens 5-hour windows at the first response after the last one closed, rounded down to the hour', () => {
    const entries = [e(at(10, 20)), e(at(11)), e(at(14, 59), { model: 'sonnet', sessionId: 's2' }), e(at(15, 10)), e(at(21, 30))]
    const c = buildCycles({ kind: '5h', entries, known: [], current: null, from: at(0), now: at(22), label })
    expect(c.map((x) => [x.start, x.end])).toEqual([
      [at(10), at(15)],
      [at(15), at(20)],
      [at(21), at(26)]
    ])
    expect(c[0]).toMatchObject({ tokens: 300, cost: 3, messages: 3, sessions: 2, input: 30, output: 60, cacheRead: 120, cacheWrite: 90, estimated: true, current: false, pct: null })
    expect(c[0].models).toEqual([
      { name: 'OPUS', cost: 2, tokens: 200 },
      { name: 'SONNET', cost: 1, tokens: 100 }
    ])
    expect(c[2].current).toBe(true)
  })

  it('uses the windows the provider reported, and fits worked-out ones around them', () => {
    const entries = [e(at(10, 20)), e(at(12, 30)), e(at(17, 40))]
    const known = [{ start: at(12, 23), end: at(17, 23), pct: 64, hitAt: null }]
    const c = buildCycles({ kind: '5h', entries, known, current: null, from: at(0), now: at(18), label })
    expect(c.map((x) => [x.start, x.end, x.estimated, x.pct])).toEqual([
      [at(10), at(12, 23), true, null],
      [at(12, 23), at(17, 23), false, 64],
      [at(17, 23), at(22, 23), true, null]
    ])
    expect(c[2].current).toBe(true)
  })

  it('keeps a reported window with nothing in the logs (used elsewhere) but drops empty guesses', () => {
    const known = [{ start: at(1), end: at(6), pct: 30, hitAt: null }, { start: at(7), end: at(12), pct: 0, hitAt: null }]
    const c = buildCycles({ kind: '5h', entries: [], known, current: null, from: at(0), now: at(20), label })
    expect(c.map((x) => x.pct)).toEqual([30])
  })

  it('steps weekly windows back from the open one', () => {
    const open = { start: at(9) - 4 * D, end: at(9) + 3 * D, pct: 41, hitAt: null }
    const entries = [e(open.start - 12 * D), e(open.start - 2 * D), e(open.start + D), e(open.start + 2 * D)]
    const c = buildCycles({ kind: '7d', entries, known: [], current: open, from: at(0) - 30 * D, now: at(12), label })
    expect(c.map((x) => [x.start, x.end, x.current, x.estimated])).toEqual([
      [open.start - 14 * D, open.start - 7 * D, false, true],
      [open.start - 7 * D, open.start, false, true],
      [open.start, open.end, true, false]
    ])
    expect(c[2]).toMatchObject({ messages: 2, pct: 41 })
  })

  it('lets the open reading of a window win over an older record of it', () => {
    const known = [{ start: at(8), end: at(13), pct: 20, hitAt: null }]
    const current = { start: at(8, 2), end: at(13, 2), pct: 35, hitAt: null }
    const c = buildCycles({ kind: '5h', entries: [e(at(9))], known, current, from: at(0), now: at(10), label })
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ start: at(8, 2), pct: 35, current: true })
  })

  it('ends a week where a new one started early, and closes the seconds between windows', () => {
    const W = 7 * D
    const a = { start: at(0) - 5 * D, end: at(0) + 2 * D, pct: 27, hitAt: null }
    const b = { start: at(0) - 2 * D, end: at(0) - 2 * D + W, pct: 57, hitAt: null }
    const entries = [e(at(0) - 4 * D), e(at(0) - D)]
    const c = buildCycles({ kind: '7d', entries, known: [a], current: b, from: at(0) - 6 * D, now: at(1), label })
    expect(c.map((x) => [x.start, x.end, x.messages, x.estimated])).toEqual([
      [a.start, b.start, 1, false],
      [b.start, b.end, 1, false]
    ])
    const five = [
      { start: at(9, 48), end: at(14, 48), pct: 27, hitAt: null },
      { start: at(14, 48) + 35_000, end: at(19, 48) + 35_000, pct: 63, hitAt: null }
    ]
    const d = buildCycles({ kind: '5h', entries: [e(at(14, 48) + 10_000)], known: five, current: null, from: at(0), now: at(23), label })
    expect(d.map((x) => [x.start, x.estimated, x.messages])).toEqual([
      [at(9, 48), false, 1],
      [at(14, 48) + 35_000, false, 0]
    ])
  })

  it('keeps one record per weekly window, with its peak', () => {
    const weeks: LoggedWeek[] = []
    expect(noteWeek(weeks, 20, at(100))).toBe(true)
    expect(noteWeek(weeks, 35, at(100) + 120_000)).toBe(true)
    expect(noteWeek(weeks, 30, at(100))).toBe(false)
    expect(noteWeek(weeks, 5, at(100) + 7 * D)).toBe(true)
    expect(weeks).toEqual([
      { end: at(100), peak: 35 },
      { end: at(100) + 7 * D, peak: 5 }
    ])
  })
})
