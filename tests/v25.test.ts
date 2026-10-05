import { describe, expect, it } from 'vitest'
import { computeAchievements } from '../src/main/achievements'
import type { CostedEntry } from '../src/main/aggregate'
import { cosmicCalendar, meteors, projectPlanets, zhr } from '../src/main/cosmos'
import { habitability } from '../src/shared/habitable'
import type { PromptCost, Remnant } from '../src/shared/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const entry = (ts: number, o: Partial<CostedEntry> = {}): CostedEntry => ({
  key: `k${ts}${Math.random()}`,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's1',
  project: 'p',
  projectPath: 'G:\\p',
  input: 1000,
  output: 1000,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 8000,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 1, cacheSavings: 0 },
  ...o
})

describe('the habitable zone', () => {
  it('compares the burn rate with the one that lasts exactly until the reset', () => {
    const now = 0
    // 60% left over 4 hours: 15%/h is just right
    expect(habitability(40, 15, 4 * HOUR, now)).toMatchObject({ ideal: 15, zone: 'habitable' })
    expect(habitability(40, 30, 4 * HOUR, now).zone).toBe('hot')
    expect(habitability(40, 5, 4 * HOUR, now).zone).toBe('cold')
    expect(habitability(100, 5, 4 * HOUR, now).zone).toBe('empty')
  })
})

describe('more of the sky', () => {
  it('makes projects planets, biggest first, with their sessions and last activity', () => {
    const now = new Date(2026, 9, 20, 20).getTime()
    const list = [
      entry(now - HOUR, { project: 'a', sessionId: 'x' }),
      entry(now - 2 * HOUR, { project: 'a', sessionId: 'y' }),
      entry(now - 3 * DAY, { project: 'b', source: 'codex', model: 'gpt-5.5' }),
      entry(now - 40 * DAY, { project: 'old' })
    ]
    const p = projectPlanets(list, now)
    expect(p.map((x) => x.project)).toEqual(['a', 'b'])
    expect(p[0]).toMatchObject({ sessions: 2, last: now - HOUR, source: 'claude' })
    expect(p[1].source).toBe('codex')
    expect(p[0].share + p[1].share).toBeCloseTo(1)
  })

  it('finds the densest hour of meteors', () => {
    const t0 = new Date(2026, 9, 20, 9).getTime()
    const ts = [0, 10, 20, 30, 70, 80, 200].map((m) => ({ ts: t0 + m * MIN }))
    expect(zhr(ts)).toEqual({ rate: 4, at: t0 })
    expect(zhr([])).toEqual({ rate: 0, at: null })
    const pc = (ts: number, text: string): PromptCost => ({ key: text, sessionId: 's', project: 'p', source: 'claude', ts, text, cost: 1, tokens: 10, output: 1, requests: 1, durationMs: 0, models: [] })
    expect(meteors([pc(t0 + 5, 'b'), pc(t0, '  a  \n x')]).map((m) => m.text)).toEqual([' a x', 'b'])
  })

  it('squeezes the history into a cosmic year', () => {
    const t0 = new Date(2026, 0, 1).getTime()
    const list = [entry(t0), entry(t0 + 10 * DAY, { source: 'codex', input: 5e6 })]
    const cal = cosmicCalendar(list, [{ title: '单日破亿', icon: '✺', at: t0 + 5 * DAY, tier: 3 }], t0 + 20 * DAY)
    expect(cal.start).toBe(t0)
    expect(cal.events.map((e) => e.kind)).toEqual(['origin', 'ach', 'origin', 'record'])
    expect(cosmicCalendar([], [], 5).events).toEqual([])
  })
})

describe('achievements of the sky', () => {
  it('finds dark energy, eight planets, a meteor storm and habitable windows', () => {
    const t0 = new Date(2026, 9, 5, 10).getTime()
    const list = [entry(t0, { input: 0, output: 100_000, cacheRead: 11_000_000 }), ...Array.from({ length: 8 }, (_, i) => entry(t0 + i * HOUR + MIN, { project: `p${i}`, projectPath: `G:\\p${i}` }))]
    const prompts = Array.from({ length: 30 }, (_, i) => t0 + i * MIN)
    const rem: Remnant[] = Array.from({ length: 5 }, (_, i) => ({ source: 'claude', start: t0 - (i + 1) * 5 * HOUR, end: t0 - i * 5 * HOUR, peak: 85, hitAt: null, kind: 'nebula', tokens: 0, cost: 0, estimated: false }))
    const a = Object.fromEntries(computeAchievements(list, {}, { remnants: rem, prompts, now: t0 + DAY }).map((x) => [x.id, x]))
    expect(a['dark-energy'].unlocked).toBe(true)
    expect(a['eight-planets'].unlocked).toBe(true)
    expect(a['meteor-storm'].unlocked).toBe(true)
    expect(a['habitable-5'].unlocked).toBe(true)
    const none = Object.fromEntries(computeAchievements([entry(t0)], {}, { prompts: prompts.slice(0, 5), now: t0 + DAY }).map((x) => [x.id, x]))
    expect(none['meteor-storm'].progress).toBeCloseTo(5 / 30)
    expect(none['eight-planets'].unlocked).toBe(false)
  })
})
