import { describe, expect, it } from 'vitest'
import type { CostedEntry } from '../src/main/aggregate'
import { computePatterns, dayNightPhase } from '../src/main/patterns'
import { DEFAULT_SETTINGS, sanitize } from '../src/main/settings'
import { placeOf, sunTimes } from '../src/shared/astro'
import { PACK_KEYS, PACKS } from '../src/shared/packs'

const HOUR = 3600_000
const DAY = 24 * HOUR
const BEIJING = { name: '北京', lat: 39.9, lon: 116.4 }
/** a city in this computer's time zone, so local days and the sun agree */
const HERE = placeOf(null)

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

describe('2.3 settings and packs', () => {
  it('keeps the place and the day / night packs', () => {
    const s = sanitize({ skyPlace: { name: '上海', lat: 31.234, lon: 121.474 }, dayNight: true, dayPack: 'lunar', nightPack: 'trails', backdrop: 'orrery', themePack: 'firefly' }, DEFAULT_SETTINGS)
    expect(s.skyPlace).toEqual({ name: '上海', lat: 31.23, lon: 121.47 })
    expect([s.dayNight, s.dayPack, s.nightPack, s.backdrop, s.themePack]).toEqual([true, 'lunar', 'trails', 'orrery', 'firefly'])
    expect(sanitize({ skyPlace: { name: 'x', lat: 120, lon: 0 } }, DEFAULT_SETTINGS).skyPlace).toBeNull()
    expect(sanitize({ skyPlace: null }, s).skyPlace).toBeNull()
    expect(sanitize({ dayPack: 'nope' }, s).dayPack).toBe('lunar')
  })

  it('every pack points at a backdrop the settings accept', () => {
    for (const k of PACK_KEYS) expect(sanitize({ backdrop: PACKS[k].backdrop }, { ...DEFAULT_SETTINGS, backdrop: 'plain' }).backdrop).toBe(PACKS[k].backdrop)
  })
})

describe('patterns', () => {
  it('counts hours, weekdays and project → model flows', () => {
    const now = new Date(2026, 9, 4, 20).getTime()
    const at = (d: number, h: number) => new Date(2026, 9, d, h, 10).getTime()
    const list = [entry(at(4, 9)), entry(at(4, 9), { project: 'q', model: 'gpt-5.5', source: 'codex' }), entry(at(4, 14)), entry(at(1, 9))]
    const p = computePatterns(list, 'today', now, (m) => (m.startsWith('gpt') ? 'GPT-5.5' : 'Opus 5.5'))
    expect(p.hours[9]).toBe(20_000)
    expect(p.hours[14]).toBe(10_000)
    // the 1st is a Thursday, the 4th a Sunday
    expect(p.week[6][9]).toBe(20_000)
    expect(p.week[3][9]).toBe(10_000)
    expect(p.allTokens).toBe(40_000)
    expect(p.dailyAvg).toBe(20_000)
    expect(p.flows.map((f) => `${f.project}>${f.model}`).sort()).toEqual(['p>Opus 5.5', 'q>GPT-5.5'])
    // one ring a day for the last 120 days, today last
    expect(p.days).toHaveLength(120)
    expect(p.days[119].tokens).toBe(30_000)
    expect(p.days[119].codex).toBe(10_000)
  })

  it('merges small projects and models into 其他', () => {
    const now = new Date(2026, 9, 4, 20).getTime()
    const list = Array.from({ length: 8 }, (_, i) => entry(now - HOUR, { project: `p${i}`, model: `m${i % 6}`, cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, webSearch: 0, total: 8 - i, cacheSavings: 0 } }))
    const p = computePatterns(list, 'today', now, (m) => m)
    expect(new Set(p.flows.map((f) => f.project)).size).toBe(6)
    expect(p.flows.some((f) => f.project === '其他项目')).toBe(true)
    expect(p.flows.some((f) => f.model === '其他模型')).toBe(true)
  })
})

describe('day and night', () => {
  it('knows which part of the day it is, with a stable id per sunrise / sunset', () => {
    const day = new Date(2026, 5, 10).getTime()
    const s = sunTimes(day + 12 * HOUR, HERE)
    expect(dayNightPhase(s.rise! + 15 * 60_000, HERE).day).toBe(true)
    expect(dayNightPhase(s.set! + 15 * 60_000, HERE).day).toBe(false)
    expect(dayNightPhase(s.rise! + HOUR, HERE).id).toBe(dayNightPhase(s.rise! + 5 * HOUR, HERE).id)
    // before dawn still belongs to last night, the one that began at yesterday's sunset
    expect(dayNightPhase(day + 2 * HOUR, HERE).id).toBe(dayNightPhase(day - DAY + 23 * HOUR, HERE).id)
  })
})
