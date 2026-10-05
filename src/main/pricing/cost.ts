import type { CostParts, PriceRow, UsageEntry } from '@shared/types'

export const ZERO_COST: CostParts = {
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  webSearch: 0,
  total: 0,
  cacheSavings: 0
}

export interface CostOptions {
  webSearchPer1k: number
  usGeoMultiplier: number
}

const M = 1e6

/**
 * Cost of one response. Fast mode swaps in the fast input/output rates and
 * scales cache rates by the same factor (caching multipliers stack on fast
 * pricing); US inference geography multiplies every token category.
 */
export function computeCost(e: UsageEntry, row: PriceRow | null, opts: CostOptions): CostParts {
  const webSearch = (e.webSearch * opts.webSearchPer1k) / 1000
  if (!row) return { ...ZERO_COST, webSearch, total: webSearch }

  let inP = row.input
  let outP = row.output
  let w5 = row.cacheWrite5m
  let w1 = row.cacheWrite1h
  let cr = row.cacheRead
  if (e.speed === 'fast' && row.fastInput && row.fastOutput) {
    const k = row.fastInput / row.input
    inP = row.fastInput
    outP = row.fastOutput
    w5 *= k
    w1 *= k
    cr *= k
  }
  const g = e.geo === 'us' ? opts.usGeoMultiplier : 1
  const input = (e.input * inP * g) / M
  const output = (e.output * outP * g) / M
  const cacheWrite = ((e.cacheWrite5m * w5 + e.cacheWrite1h * w1) * g) / M
  const cacheRead = (e.cacheRead * cr * g) / M
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    webSearch,
    total: input + output + cacheWrite + cacheRead + webSearch,
    cacheSavings: (e.cacheRead * (inP - cr) * g) / M
  }
}
