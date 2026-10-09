import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { buildDeck, type DeckInput } from '../src/main/tarot'
import { ARCANA, cardStory } from '../src/shared/tarot'
import { cardBack, cardFace, emptyDeck } from '../src/shared/tarotArt'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = new Date(2026, 9, 6, 21, 30).getTime()
const TODAY = new Date(2026, 9, 6).getTime()

let n = 0
function e(ts: number, o: Partial<CostedEntry> = {}, cost = 0.2): CostedEntry {
  return {
    key: `t${n++}`,
    ts,
    model: 'opus',
    sessionId: 's1',
    project: 'app',
    projectPath: '/app',
    input: 1000,
    output: 2000,
    cacheWrite5m: 500,
    cacheWrite1h: 0,
    cacheRead: 6500,
    webSearch: 0,
    speed: 'standard',
    geo: null,
    cost: { input: cost, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: cost, cacheSavings: 0 },
    source: 'claude',
    ...o
  }
}

function input(entries: CostedEntry[], o: Partial<DeckInput> = {}): DeckInput {
  return {
    now: NOW,
    view: 'claude',
    entries: [...entries].sort((a, b) => a.ts - b.ts),
    label: (m) => m,
    tool: 'claude',
    five: null,
    seven: null,
    guardAt: null,
    windows: [],
    prompts: [],
    tasks: [],
    tpm: 0,
    ...o
  }
}

// ten days in a row (the last is today) at 15:00; today also at 1 am and 9 pm
const history = Array.from({ length: 10 }, (_, d) => e(TODAY - (9 - d) * DAY + 15 * HOUR, { project: d % 2 ? 'web' : 'app' }))
const today = [e(TODAY + 1 * HOUR, { sessionId: 'night' }), e(TODAY + 21 * HOUR, { sessionId: 'evening', model: 'sonnet' }), e(TODAY + 21 * HOUR + 20_000, { sessionId: 'evening', model: 'sonnet' })]

describe('tarot: what the cards draw', () => {
  const d = buildDeck(input([...history, ...today], { tpm: 5000 }))

  it('counts today by the hour, the fastest minute and the conversations that ended', () => {
    expect(d.today.hours[1]).toBe(10_000)
    expect(d.today.hours[21]).toBe(20_000)
    expect(d.today.peak).toMatchObject({ tokens: 20_000 })
    expect(d.today.hours[15]).toBe(10_000)
    expect(d.today.cacheRead).toBe(6500 * 4)
    // the 15:00 and 1 am conversations have ended; the evening one is still open
    expect(d.endedCount).toBe(2)
    expect(d.ended.map((x) => x.project)).toEqual(['web', 'app'])
  })

  it('counts the streak, the night share, projects and the two main models', () => {
    expect(d.streak).toBe(10)
    // the last 7 days: seven afternoons (today's included), the 1 am one and the evening
    expect(d.night.share).toBeCloseTo(10_000 / 100_000, 5)
    expect(d.projects.map((p) => p.name)).toEqual(['app', 'web'])
    expect(d.lovers).toMatchObject({ a: { name: 'opus' }, b: { name: 'sonnet' } })
    expect(d.days).toHaveLength(60)
    expect(d.days[59].tokens).toBe(40_000)
  })

  it('puts Claude and Codex side by side in 全部', () => {
    const all = buildDeck(input([...history, e(NOW - HOUR, { source: 'codex' })], { view: 'all' }))
    expect(all.lovers).toMatchObject({ a: { name: 'Claude' }, b: { name: 'Codex', tokens: 10_000 } })
  })

  it('reads the week of 5-hour windows, what they left unused and what a full one is worth', () => {
    const start = NOW - 3 * DAY
    const windows = [
      { start: start, end: start + 5 * HOUR, peak: 100 },
      { start: start + DAY, end: start + DAY + 5 * HOUR, peak: 60 }
    ]
    // $20 in each window
    const spend = windows.flatMap((w) => Array.from({ length: 10 }, (_, i) => e(w.start + i * 10 * MIN, {}, 2)))
    const deck = buildDeck(input(spend, { windows, five: { pct: 30, end: NOW + 2 * HOUR }, seven: { pct: 40, start, end: start + 7 * DAY } }))
    expect(deck.wheel.map((w) => [w.peak, w.current])).toEqual([
      [100, false],
      [60, false],
      [30, true]
    ])
    expect(deck.unused).toEqual({ avg: 20, n: 2 })
    // the week: $40 for 40%, 1%/$; the windows: 5 and 3 %/$ (the median takes the upper of two) → a full one ≈ $20 ≈ 20% of the week
    expect(deck.full).toBeCloseTo(20, 5)
  })

  it('finds the costliest question against the average', () => {
    const deck = buildDeck(
      input(today, {
        prompts: [
          { cost: 1, text: '小问题' } as never,
          { cost: 1, text: '另一个' } as never,
          { cost: 10, text: '大重构' } as never
        ]
      })
    )
    expect(deck.devil).toMatchObject({ text: '大重构', cost: 10, avg: 4, over3: 0 })
  })
})

describe('tarot: the cards', () => {
  it('draws all 22 faces from a real deck and from an empty one, as clean SVG', () => {
    const deck = buildDeck(input([...history, ...today], { five: { pct: 92, end: NOW + HOUR }, seven: { pct: 55, start: NOW - 2 * DAY, end: NOW + 5 * DAY }, guardAt: 90, tpm: 8000 }))
    for (const d of [deck, emptyDeck(NOW)]) {
      for (const a of ARCANA) {
        const svg = cardFace(a.id, `u${a.id}`, { deck: d })
        expect(svg.startsWith('<svg')).toBe(true)
        expect(svg).toContain(a.name)
        expect(svg).not.toMatch(/NaN|undefined|Infinity/)
        expect(cardStory(a.id, d, (v) => `$${v.toFixed(2)}`).length).toBeGreaterThan(0)
      }
    }
    expect(cardFace(4, 'q', { deck })).toContain('92%')
    expect(cardBack('b', '#d97757')).not.toMatch(/NaN|undefined/)
  })
  it('draws WorkBuddy credits on the quota cards, which have no 5-hour or 7-day windows', () => {
    const credits = { usedPct: 48, remaining: 2998, total: 5760, today: 13.6, dailyAvg: 72, daysLeft: 41.6 }
    const d = buildDeck(input([e(TODAY + 9 * HOUR, { source: 'workbuddy' })], { view: 'workbuddy', tool: 'workbuddy', five: null, seven: null, credits }))
    expect(cardStory(4, d, String)[0]).toBe('WorkBuddy 积分已用 48%')
    expect(cardStory(18, d, String)[1]).toBe('照日均约 42 天用完')
    expect(cardFace(4, 'w', { deck: d })).toContain('WorkBuddy 积分已用')
    expect(cardFace(4, 'w', { deck: d })).not.toContain('Claude 5 小时额度')
    expect(cardFace(18, 'w', { deck: d })).toContain('约 42 天用完')
  })
})
