import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { UsageEntry } from '@shared/types'
import { computeRanges, type CostedEntry } from '../src/main/aggregate'
import { UsageArchive } from '../src/main/archive'
import { UsageStore } from '../src/main/collector/store'
import { ZERO_COST } from '../src/main/pricing/cost'

const row = (key: string, output: number, ts = 1_700_000_000_000): UsageEntry => ({
  key,
  ts,
  model: 'claude-opus-5-5',
  sessionId: 's',
  project: 'p',
  projectPath: 'p',
  input: 1,
  output,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  webSearch: 0,
  speed: 'standard',
  geo: null
})

describe('UsageArchive', () => {
  it('appends new and grown rows only, and the largest copy wins on load', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'tp-arch-')), 'archive.jsonl')
    const a = new UsageArchive(path)
    expect(await a.save([row('a', 5), row('b', 7)])).toBe(2)
    expect(await a.save([row('a', 5), row('b', 7)])).toBe(0)
    expect(await a.save([row('a', 9)])).toBe(1)
    appendFileSync(path, '{"torn":\n')

    const b = new UsageArchive(path)
    await b.load()
    expect(b.entries.size).toBe(2)
    expect(b.entries.get('a')!.output).toBe(9)
  })

  it('seeds a store so deleted logs keep counting', () => {
    const s = new UsageStore()
    s.seed([row('a', 3), row('a', 2)])
    expect(s.entries.get('a')!.output).toBe(3)
    expect(s.revision).toBe(1)
  })
})

describe('computeRanges', () => {
  it('totals every range and reports coverage', () => {
    const now = new Date(2026, 9, 3, 12).getTime()
    const c = (ts: number): CostedEntry => ({ ...row(String(ts), 10, ts), cost: { ...ZERO_COST, total: 1 } })
    const o = computeRanges([c(now - 3600_000), c(now - 3 * 86400_000), c(now - 20 * 86400_000)], now, 0)
    expect(o.chips.map((x) => [x.range, x.tokens, x.cost])).toEqual([
      ['today', 11, 1],
      ['7d', 22, 2],
      ['30d', 33, 3],
      ['month', 11, 1],
      ['all', 33, 3]
    ])
    expect(o.activeDays).toBe(3)
    expect(o.firstTs).toBe(now - 20 * 86400_000)
  })
})
