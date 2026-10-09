import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { buildCycles, measureWeekShare, weekShares, type QuotaReading } from '../src/main/cycles'
import { ZERO_COST } from '../src/main/pricing/cost'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeWindowLog, noteWeek, type LoggedWeek } from '../src/main/windowHistory'

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

  it("shares each week's reading out over its 5-hour windows by cost", () => {
    const W = 7 * D
    const last = { start: at(0) - W, end: at(0), pct: 40, hitAt: null }
    const open = { start: at(0), end: at(0) + W, pct: 12, hitAt: null }
    const entries = [e(at(-30), { cost: { ...ZERO_COST, total: 3 } }), e(at(-29), { cost: { ...ZERO_COST, total: 1 } }), e(at(2), { cost: { ...ZERO_COST, total: 2 } }), e(at(10), { cost: { ...ZERO_COST, total: 4 } })]
    const now = at(11)
    const seven = buildCycles({ kind: '7d', entries, known: [last], current: open, from: now - 70 * D, now, label })
    const five = buildCycles({ kind: '5h', entries, known: [], current: null, from: now - 7 * D, now, label })
    weekShares(five, seven, entries)
    // last week: $4 for 40%, this week: $6 for 12%
    expect(five.map((c) => [c.start, c.weekPct, c.weekEst])).toEqual([
      [at(-30), 40, false],
      [at(2), 4, false],
      [at(10), 8, false]
    ])
  })

  it('borrows the nearest rate for a week that has no usable reading yet', () => {
    const W = 7 * D
    const last = { start: at(0) - W, end: at(0), pct: 50, hitAt: null }
    const open = { start: at(0), end: at(0) + W, pct: 1, hitAt: null }
    const entries = [e(at(-20), { cost: { ...ZERO_COST, total: 10 } }), e(at(3), { cost: { ...ZERO_COST, total: 2 } })]
    const seven = buildCycles({ kind: '7d', entries, known: [last], current: open, from: at(-200), now: at(4), label })
    const five = buildCycles({ kind: '5h', entries, known: [], current: null, from: at(-100), now: at(4), label })
    weekShares(five, seven, entries)
    expect(five.map((c) => [c.weekPct, c.weekEst])).toEqual([
      [50, false],
      [10, true]
    ])
    // no weekly reading at all: nothing to go by
    const bare = buildCycles({ kind: '5h', entries, known: [], current: null, from: at(-100), now: at(4), label })
    weekShares(bare, [], entries)
    expect(bare.map((c) => c.weekPct)).toEqual([null, null])
  })

  it('measures a window by the 7-day readings when it opened and closed', () => {
    const E = at(100)
    const r = (t0: number, t1: number, five: number | null, pct: number, end = E): QuotaReading => ({ t0, t1, five, pct, end })
    const w1 = { start: at(10), end: at(15), current: false }
    const w2 = { start: at(16), end: at(21), current: false }
    const rs = [r(at(9), at(9, 30), null, 20), r(at(10, 5), at(12), at(15), 22), r(at(12, 1), at(14, 58), at(15), 26), r(at(16, 2), at(20, 59), at(21), 30)]
    // opened after a quiet reading, closed read near its end
    expect(measureWeekShare(w1, rs, false)).toBe(6)
    // opened right where the last window was read near its end
    expect(measureWeekShare(w2, rs, false)).toBe(4)
    // the closing reading came hours early and the next one is in another window: unknown
    const early = [r(at(9), at(9), null, 20), r(at(10, 5), at(12), at(15), 22), r(at(16, 2), at(16, 30), at(21), 30)]
    expect(measureWeekShare(w1, early, false)).toBeNull()
    // ...but a reading in the quiet after it closes it
    expect(measureWeekShare(w1, [...early.slice(0, 2), r(at(15, 20), at(15, 40), null, 25), early[2]], false)).toBe(5)
    // with no reading before it, one in its first minutes opens it
    expect(measureWeekShare(w1, [r(at(10, 4), at(14, 55), at(15), 24)], false)).toBe(0)
    expect(measureWeekShare(w1, [r(at(11), at(14, 55), at(15), 24)], false)).toBeNull()
    // a reading taken mid-way through the window before can't open it (more may have been used after)
    expect(measureWeekShare(w2, [r(at(10, 5), at(12), at(15), 22), r(at(16, 30), at(20, 59), at(21), 30)], false)).toBeNull()
    // unless every response logs a reading, as Codex does
    expect(measureWeekShare(w2, [r(at(10, 5), at(12), at(15), 22), r(at(16, 2), at(17), at(21), 30)], true)).toBe(8)
    // the open window: so far
    expect(measureWeekShare({ ...w2, current: true }, [r(at(15, 10), at(15, 10), null, 26), r(at(16, 2), at(17), at(21), 28)], false)).toBe(2)
  })

  it('adds both parts when the week turns over inside a window', () => {
    const E1 = at(13)
    const E2 = E1 + 7 * D
    const rs: QuotaReading[] = [
      { t0: at(9), t1: at(9), five: null, pct: 90, end: E1 },
      { t0: at(10, 3), t1: at(12, 59), five: at(15), pct: 95, end: E1 },
      { t0: at(13, 1), t1: at(14, 59), five: at(15), pct: 3, end: E2 }
    ]
    expect(measureWeekShare({ start: at(10), end: at(15), current: false }, rs, false)).toBe(8)
  })

  it('shares what measured windows leave of the week over the others by cost', () => {
    const W = 7 * D
    const week = { start: at(0), end: at(0) + W, pct: 30, hitAt: null }
    const entries = [e(at(1), { cost: { ...ZERO_COST, total: 10 } }), e(at(7), { cost: { ...ZERO_COST, total: 10 } }), e(at(13), { cost: { ...ZERO_COST, total: 10 } })]
    const now = at(14)
    const seven = buildCycles({ kind: '7d', entries, known: [], current: week, from: now - 70 * D, now, label })
    const five = buildCycles({ kind: '5h', entries, known: [], current: null, from: now - 7 * D, now, label })
    weekShares(five, seven, entries, (c) => (c.start === at(7) ? 15 : null))
    expect(five.map((c) => [c.weekPct, c.weekMeasured])).toEqual([
      [7.5, false],
      [15, true],
      [7.5, false]
    ])
  })

  it('logs a 7-day reading per change, and until when it held', () => {
    const log = new ClaudeWindowLog(join(mkdtempSync(join(tmpdir(), 'tp-pairs-')), 'window-history.json'))
    const E = at(100)
    log.recordPair(at(9), null, 20, E)
    log.recordPair(at(9, 1), null, 20, E)
    log.recordPair(at(10, 5), at(15), 20, E)
    log.recordPair(at(10, 6), at(15) + 30_000, 20, E)
    log.recordPair(at(11), at(15), 22, E)
    // an older reading arriving late is dropped
    log.recordPair(at(10), at(15), 21, E)
    log.flush()
    expect(log.pairs).toEqual([
      { t0: at(9), t1: at(9, 1), five: null, pct: 20, end: E },
      { t0: at(10, 5), t1: at(10, 6), five: at(15), pct: 20, end: E },
      { t0: at(11), t1: at(11), five: at(15), pct: 22, end: E }
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
