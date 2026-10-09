import { describe, expect, it } from 'vitest'
import { computeAchievements } from '../src/main/achievements'
import type { CostedEntry } from '../src/main/aggregate'
import { classOf, quotaStar, remnantOf, remnants, sessionStars, stageOf, stellarType } from '../src/main/cosmos'
import { achLines, spark, starLines, starSummary, weekLines } from '../src/main/sky'
import type { Pace, Remnant, WindowRecord } from '../src/shared/types'

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

const pace = (o: Partial<Pace>): Pace => ({
  key: 'claude_5h',
  label: 'Claude 5 小时',
  source: 'claude',
  pct: 40,
  start: 0,
  end: 5 * HOUR,
  ideal: 40,
  lead: 0,
  pctPerHour: 20,
  projected: 80,
  etaFull: null,
  unused: 20,
  curve: [],
  ...o
})

const win = (start: number, peak: number, hitAt: number | null = null): WindowRecord => ({ source: 'claude', start, end: start + 5 * HOUR, peak, hitAt, samples: [], estimated: false })

describe('the quota as stars', () => {
  it('ages the star with the quota', () => {
    expect([0, 9, 10, 34, 35, 69, 70, 89, 90, 99, 100].map(stageOf)).toEqual([
      'nebula',
      'nebula',
      'protostar',
      'protostar',
      'main',
      'main',
      'giant',
      'giant',
      'supergiant',
      'supergiant',
      'supernova'
    ])
  })

  it('leaves a remnant by the peak', () => {
    expect([remnantOf(30, false), remnantOf(60, false), remnantOf(95, false), remnantOf(80, true), remnantOf(100, false)]).toEqual(['dwarf', 'neutron', 'nebula', 'blackhole', 'blackhole'])
  })

  it('times the stages still to come and predicts the remnant', () => {
    const now = 2 * HOUR
    const s = quotaStar(pace({ pct: 40, start: 0, end: 6 * HOUR, pctPerHour: 20, projected: 120 }), pace({ key: 'claude_7d', pct: 30, start: 0, end: 7 * DAY, ideal: 20, projected: 90 }), now)
    expect(s.stage).toBe('main')
    expect(s.next.find((n) => n.stage === 'giant')!.at).toBe(now + 1.5 * HOUR)
    expect(s.next.find((n) => n.stage === 'supernova')!.at).toBe(now + 3 * HOUR)
    expect(s.fate).toBe('blackhole')
    expect(s.week?.pct).toBe(30)
    const slow = quotaStar(pace({ pct: 40, pctPerHour: 2, projected: 46 }), null, now)
    expect(slow.next.find((n) => n.stage === 'giant')!.at).toBeNull()
    expect(slow.fate).toBe('dwarf')
  })

  it('turns closed windows into remnants with their tokens', () => {
    const t0 = new Date(2026, 9, 1, 8).getTime()
    const list = [entry(t0 + HOUR), entry(t0 + 2 * HOUR), entry(t0 + 6 * HOUR)]
    const r = remnants([win(t0, 100, t0 + 2 * HOUR), win(t0 + 5 * HOUR, 30), win(t0 + 20 * HOUR, 10)], { claude: list, codex: [] }, t0 + 21 * HOUR)
    expect(r.map((x) => x.kind)).toEqual(['blackhole', 'dwarf'])
    expect(r[0].tokens).toBe(20_000)
    expect(r[1].tokens).toBe(10_000)
  })
})

describe('sessions as stars', () => {
  it('classes sessions by tokens per active minute, gaps over half an hour left out', () => {
    expect(['O', 'B', 'A', 'F', 'G', 'K', 'M'].map((c, i) => classOf([4e6, 2e6, 1e6, 5e5, 3e5, 1e5, 1e3][i]) === c)).toEqual(Array(7).fill(true))
    const t0 = new Date(2026, 9, 1, 8).getTime()
    const big = (ts: number, id: string, tok: number) => entry(ts, { sessionId: id, input: tok, output: 0, cacheRead: 0 })
    // two bursts an hour apart: 10 active minutes, not 70
    const list = [big(t0, 'a', 1e6), big(t0 + 10 * MIN, 'a', 1e6), big(t0 + 70 * MIN, 'a', 1e6), big(t0, 'b', 10_000), big(t0 + 2 * MIN, 'b', 10_000)]
    const stars = sessionStars(list, t0 + DAY)
    const a = stars.find((s) => s.id === 'a')!
    expect(a.minutes).toBe(10)
    expect(a.rate).toBe(300_000)
    expect(a.cls).toBe('G')
    expect(stars.find((s) => s.id === 'b')!.cls).toBe('M')
  })

  it('makes you a star: steady, a black hole, or a binary', () => {
    const now = new Date(2026, 9, 20, 20).getTime()
    // starting at different hours, or it would be a clockwork pulsar
    const days = Array.from({ length: 12 }, (_, i) => entry(now - i * DAY - (3 + (i % 5) * 2) * HOUR, { input: 5_000_000, sessionId: `s${i}` }))
    expect(stellarType(days, [], now).kind).toBe('star')
    expect(stellarType(days, [], now).cls).toBe('G')
    const holes: Remnant[] = Array.from({ length: 5 }, (_, i) => ({ source: 'claude', start: now - i * DAY, end: now - i * DAY + 5 * HOUR, peak: 100, hitAt: now - i * DAY + HOUR, kind: 'blackhole', tokens: 0, cost: 0, estimated: false }))
    expect(stellarType(days, holes, now).kind).toBe('blackhole')
    const two = [...days, ...days.map((e) => ({ ...e, key: `${e.key}x`, source: 'codex' as const, sessionId: `${e.sessionId}x` }))]
    expect(stellarType(two, [], now).kind).toBe('binary')
    expect(stellarType([], [], now).kind).toBe('dust')
  })
})

describe('new achievements', () => {
  it('collects weekdays, hours, tools and remnants, and keeps secrets', () => {
    const t0 = new Date(2026, 9, 5, 0, 0, 30).getTime() // a Monday, at midnight
    const list = Array.from({ length: 7 }, (_, i) => entry(t0 + i * DAY + 12 * HOUR + 21 * MIN))
    list.push(entry(t0), entry(t0 + 3 * HOUR, { source: 'codex', sessionId: 'c' }))
    list.sort((a, b) => a.ts - b.ts)
    const rem: Remnant[] = (['dwarf', 'neutron', 'nebula', 'blackhole'] as const).map((kind, i) => ({ source: 'claude', start: t0 + i * 5 * HOUR, end: t0 + (i + 1) * 5 * HOUR, peak: [20, 60, 95, 100][i], hitAt: kind === 'blackhole' ? t0 + 18 * HOUR : null, kind, tokens: 0, cost: 0, estimated: false }))
    const a = Object.fromEntries(computeAchievements(list, {}, { remnants: rem, now: t0 + 8 * DAY }).map((x) => [x.id, x]))
    expect(a.weekdays.unlocked).toBe(true)
    expect(a.weekdays.kind).toBe('collect')
    expect(a.weekdays.items!.every((x) => x.got)).toBe(true)
    expect(a['two-tools'].unlocked).toBe(true)
    expect(a.midnight).toMatchObject({ unlocked: true, kind: 'secret' })
    expect(a.palindrome.unlocked).toBe(true)
    expect(a['remnant-set'].unlocked).toBe(true)
    expect(a.supernova.unlocked).toBe(true)
    expect(a.speedrun.unlocked).toBe(false)
    expect(a.shichen.items!.filter((x) => x.got).map((x) => x.label)).toEqual(['子', '寅', '午'])
    expect(a['packs-8'].progress).toBe(0)
  })
})

describe('telegram text', () => {
  it('draws sparklines and the week', () => {
    expect(spark([0, 1, 2, 4, 8])).toBe('·▁▂▄█')
    const now = new Date(2026, 9, 20, 20).getTime()
    const lines = weekLines([entry(now - HOUR), entry(now - DAY)], now, (n) => `$${n}`)
    expect(lines[0]).toContain('最近 7 天')
    expect(lines.filter((l) => l.includes('█')).length).toBeGreaterThanOrEqual(2)
  })

  it('writes /star and /ach', () => {
    const now = new Date(2026, 9, 20, 10).getTime()
    const star = quotaStar(pace({ pct: 75, start: now - HOUR, end: now + 4 * HOUR, pctPerHour: 10, projected: 115 }), null, now)
    const c = { stars: [star], remnants: [], sessions: [], me: stellarType([], [], now), projects: [], meteors: [], zhr: { rate: 0, at: null }, calendar: { start: now, end: now, events: [] } }
    const text = starLines(c).join('\n')
    expect(text).toContain('红巨星')
    expect(text).toContain('超新星')
    expect(text).toContain('太热')
    expect(starSummary(c, now)).toContain('星际尘埃')
    const ach = achLines(computeAchievements([])).join('\n')
    expect(ach).toContain('隐藏成就已找到 0 /')
    // secrets never show their names before they are found
    expect(ach).not.toContain('午夜钟声')
  })
  it('counts only Claude Code and Codex as the two tools: WorkBuddy is neither', () => {
    const t0 = new Date(2026, 9, 5, 10, 0).getTime()
    const list = [entry(t0), entry(t0 + MIN, { source: 'workbuddy', sessionId: 'w' })]
    const a = Object.fromEntries(computeAchievements(list, {}, { remnants: [], now: t0 + DAY }).map((x) => [x.id, x]))
    expect(a['two-tools'].unlocked).toBe(false)
    expect(a['two-tools'].hint).toBe('已用 1 / 2 个')
  })
})
