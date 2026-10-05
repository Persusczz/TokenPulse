import { describe, expect, it } from 'vitest'
import type { UsageEntry } from '@shared/types'
import { BUNDLED_ROWS } from '../src/main/pricing/bundled'
import { computeCost } from '../src/main/pricing/cost'

const opus55 = BUNDLED_ROWS.find((r) => r.id === 'claude-opus-5-5')!
const opts = { webSearchPer1k: 10, usGeoMultiplier: 1.1 }

const entry = (p: Partial<UsageEntry>): UsageEntry => ({
  key: 'k',
  ts: 0,
  model: 'claude-opus-5-5',
  sessionId: 's',
  project: 'p',
  projectPath: 'p',
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  webSearch: 0,
  speed: 'standard',
  geo: null,
  ...p
})

describe('computeCost', () => {
  it('matches the cost Claude Code reported for a real session', () => {
    // cost-state of session 5188627c: claude-opus-5-5 costUSD = 0.4023172
    const c = computeCost(entry({ input: 18, output: 7315, cacheRead: 384566, cacheWrite1h: 22379 }), opus55, opts)
    expect(c.total).toBeCloseTo(0.4023172, 9)
  })

  it('prices 5m and 1h cache writes separately', () => {
    const c = computeCost(entry({ cacheWrite5m: 1e6, cacheWrite1h: 1e6 }), opus55, opts)
    expect(c.cacheWrite).toBeCloseTo(13)
  })

  it('computes cache savings against base input', () => {
    const c = computeCost(entry({ cacheRead: 1e6 }), opus55, opts)
    expect(c.cacheRead).toBeCloseTo(0.2)
    expect(c.cacheSavings).toBeCloseTo(3.8)
  })

  it('applies fast mode rates and scales cache rates with them', () => {
    const c = computeCost(entry({ speed: 'fast', input: 1e6, output: 1e6, cacheWrite5m: 1e6, cacheRead: 1e6 }), opus55, opts)
    expect(c.input).toBeCloseTo(8)
    expect(c.output).toBeCloseTo(40)
    expect(c.cacheWrite).toBeCloseTo(10)
    expect(c.cacheRead).toBeCloseTo(0.4)
  })

  it('applies the US geo multiplier to tokens but not web search', () => {
    const c = computeCost(entry({ geo: 'us', input: 1e6, webSearch: 3 }), opus55, opts)
    expect(c.input).toBeCloseTo(4.4)
    expect(c.webSearch).toBeCloseTo(0.03)
  })

  it('charges only web search when the model is unknown', () => {
    const c = computeCost(entry({ input: 1e6, webSearch: 1 }), null, opts)
    expect(c.total).toBeCloseTo(0.01)
  })
})
